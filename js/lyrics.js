/* Darcam — lyrics: finding, karaoke sync, translation, romanization. */
'use strict';

const Lyrics = (() => {
    const S = {
        track: null, result: null, items: [], active: -1,
        el: null, scroller: null, lineEls: [],
        userScrollAt: 0, translate: false, romanize: false,
        tr: null, rm: null, loading: false, token: 0,
        shareMode: false, picked: new Set(),
    };
    const OFFSETS = () => LS.get('dc_ly_offset', {});
    const manualOffset = (id) => { const o = OFFSETS(); return Object.prototype.hasOwnProperty.call(o, id) ? o[id] : null; };
    // Music videos often have a longer intro than the audio the lyrics were timed to.
    function autoOffset() {
        const r = S.result; if (!r || !r.synced || !r.lrcDur || !S.track) return 0;
        const cur = Player.current();
        const vdur = (cur && cur.id === S.track.id && Player.state.duration) || (S.track.duration_ms || 0) / 1000;
        const diff = vdur - r.lrcDur;
        return diff >= 5 && diff <= 90 ? -diff : 0;
    }
    const offsetFor = (id) => { const m = manualOffset(id); return m !== null ? m : autoOffset(); };
    // LRC times usually mark the moment just before the singer starts, and audio reaches
    // the speakers a little after the player reports it, so lyrics are shown slightly later.
    const lyricsDelay = () => { const d = parseFloat(Store.settings.lyricsDelay); return isFinite(d) ? d : 0.35; };

    // ---------- providers ----------
    const LRCLIB = 'https://lrclib.net/api/';
    function proxyUrl(endpoint, params) {
        return 'lyrics_proxy.php?endpoint=' + endpoint + '&' + params;
    }
    async function lrclib(endpoint, params) {
        try { return await fetchJSON(LRCLIB + endpoint + '?' + params, { timeout: 9000 }); }
        catch (e) {
            if (e.status === 404) return null;
            try { return await fetchJSON(proxyUrl(endpoint, params), { timeout: 9000 }); } catch (e2) { return null; }
        }
    }

    // Supports normal LRC and "enhanced" LRC with per-word times: [00:45.38]<00:45.38>Never <00:45.76>gonna
    const TAG = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g;
    const toSec = (m, s, f) => (+m) * 60 + (+s) + (f ? +('0.' + String(f).padEnd(3, '0')) : 0);
    function parseLRC(lrc) {
        const out = [];
        (lrc || '').split(/\r?\n/).forEach((row) => {
            const tags = [...row.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
            if (!tags.length) return;
            const body = row.replace(/\[[^\]]*\]/g, '');
            let words = null;
            if (TAG.test(body)) {
                TAG.lastIndex = 0;
                words = [];
                const parts = body.split(TAG); // [pre, m, s, f, text, m, s, f, text, ...]
                for (let i = 1; i + 3 < parts.length + 1; i += 4) {
                    const w = parts[i + 3] || '';
                    if (w.trim()) words.push({ t: toSec(parts[i], parts[i + 1], parts[i + 2]), w });
                }
                if (!words.length) words = null;
            }
            const text = body.replace(TAG, '').replace(/\s+/g, ' ').trim();
            tags.forEach((m) => out.push({ t: toSec(m[1], m[2], m[3]), text, words }));
        });
        return out.sort((a, b) => a.t - b.t);
    }

    function score(rec, title, artist, dur) {
        if (!rec) return -1;
        let s = 0;
        if (rec.syncedLyrics) s += 100; else if (rec.plainLyrics) s += 30; else if (rec.instrumental) s += 10;
        if (dur && rec.duration) { const d = Math.abs(rec.duration - dur); s += d <= 2 ? 60 : d <= 5 ? 40 : d <= 10 ? 15 : -20; }
        const n = (x) => (x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        if (n(rec.trackName) === n(title)) s += 25; else if (n(rec.trackName).includes(n(title)) || n(title).includes(n(rec.trackName))) s += 10;
        if (artist && n(rec.artistName).includes(n(artist).slice(0, 8))) s += 20;
        return s;
    }

    function toResult(rec, source = 'LRCLIB') {
        if (!rec) return null;
        if (rec.syncedLyrics) {
            const lines = parseLRC(rec.syncedLyrics);
            if (lines.filter((l) => l.text).length >= 3) return { synced: true, lines, source, recId: rec.id, lrcDur: rec.duration || 0 };
        }
        if (rec.plainLyrics) return { synced: false, text: rec.plainLyrics, source, recId: rec.id };
        if (rec.instrumental) return { instrumental: true, source };
        return null;
    }

    async function find(track) {
        const title = T.title(track), artist = (track.artists && track.artists[0] && track.artists[0].name) || '';
        const dur = (track.duration_ms || 0) / 1000 || (Player.state.duration || 0);
        const q = (k, v) => k + '=' + encodeURIComponent(v);
        const tasks = [];
        if (artist && dur) tasks.push(lrclib('get', [q('track_name', title), q('artist_name', artist), q('duration', Math.round(dur))].join('&')).then((r) => (r ? [r] : [])));
        if (artist) tasks.push(lrclib('search', q('track_name', title) + '&' + q('artist_name', artist)));
        tasks.push(lrclib('search', q('q', (title + ' ' + artist).trim())));
        const lists = await Promise.all(tasks.map((p) => p.catch(() => null)));
        const all = [].concat(...lists.filter(Array.isArray));
        all.sort((a, b) => score(b, title, artist, dur) - score(a, title, artist, dur));
        for (const rec of all.slice(0, 6)) { const r = toResult(rec); if (r) return r; }
        // last resort: plain lyrics
        if (artist) {
            try {
                const j = await fetchJSON('https://api.lyrics.ovh/v1/' + encodeURIComponent(artist) + '/' + encodeURIComponent(title), { timeout: 8000 });
                if (j && j.lyrics && j.lyrics.length > 20) return { synced: false, text: j.lyrics, source: 'lyrics.ovh' };
            } catch (e) {}
        }
        return null;
    }

    // cache (7 days, ~120 songs)
    function cacheGet(id) {
        const c = LS.get('dc_lyrics:' + id, null);
        return c && c.exp > Date.now() ? c.r : null;
    }
    function cacheSet(id, r, days = 7) {
        const idx = LS.get('dc_lyrics_idx', []).filter((x) => x !== id);
        idx.unshift(id);
        idx.slice(120).forEach((x) => LS.del('dc_lyrics:' + x));
        LS.set('dc_lyrics_idx', idx.slice(0, 120));
        LS.set('dc_lyrics:' + id, { exp: Date.now() + days * 864e5, r });
    }

    // ---------- build timeline (adds "• • •" for long instrumental gaps) ----------
    function estDur(text) { return clamp(0.8 + (text || '').length * 0.075, 1.2, 7); }
    function timeline(lines) {
        const out = [];
        const clean = lines.filter((l, i) => l.text || (i > 0 && lines[i - 1].text));
        if (clean.length && clean[0].t > 4) out.push({ t: 0.5, end: clean[0].t - 0.3, dots: true });
        clean.forEach((l, i) => {
            const nx = clean[i + 1];
            if (!l.text) { if (nx && nx.t - l.t > 6) out.push({ t: l.t, end: nx.t - 0.3, dots: true }); return; }
            // fill the line at the pace it's actually sung: until just before the next line
            let end = nx ? Math.min(nx.t - 0.2, l.t + Math.max(estDur(l.text) * 1.8, 3)) : l.t + estDur(l.text) * 1.8;
            if (l.words && l.words.length) end = Math.min(nx ? nx.t : 1e9, l.words[l.words.length - 1].t + clamp(0.25 + l.words[l.words.length - 1].w.length * 0.07, 0.35, 1.2));
            out.push({ t: l.t, end, text: l.text, words: l.words, next: nx ? nx.t : l.t + 8 });
            // only real instrumental breaks get the "• • •" (not slow, long-held lines)
            const sungUntil = l.words && l.words.length ? end : l.t + estDur(l.text) * 1.8;
            if (nx && nx.text && nx.t - l.t > 10 && nx.t - sungUntil > 6) out.push({ t: sungUntil + 0.5, end: nx.t - 0.3, dots: true });
        });
        return out;
    }

    // ---------- translation / romanization ----------
    async function gtx(text, tl, dt) {
        const u = 'https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=auto&tl=' + tl + '&dt=' + dt.join('&dt=') + '&q=' + encodeURIComponent(text);
        return fetchJSON(u, { timeout: 12000 });
    }
    function chunks(lines, max = 5000) {
        // measured in encoded URL length, so long Korean/Japanese lyrics are split safely
        const out = []; let cur = [];
        let len = 0;
        lines.forEach((l) => { const n = encodeURIComponent(l).length + 3; if (len + n > max && cur.length) { out.push(cur); cur = []; len = 0; } cur.push(l); len += n; });
        if (cur.length) out.push(cur);
        return out;
    }
    async function translateLines(lines, tl) {
        const res = []; let src = '';
        for (const part of chunks(lines)) {
            const j = await gtx(part.join('\n'), tl, ['t']);
            src = src || j[2];
            const txt = (j[0] || []).map((s) => s[0] || '').join('');
            let arr = txt.split('\n');
            if (arr.length !== part.length) arr = await Promise.all(part.map((l) => gtx(l, tl, ['t']).then((r) => (r[0] || []).map((s) => s[0]).join('')).catch(() => '')));
            res.push(...arr);
        }
        return { lines: res, src };
    }
    async function romanizeLines(lines) {
        const res = [];
        for (const part of chunks(lines)) {
            const j = await gtx(part.join('\n'), 'en', ['t', 'rm']);
            const segs = j[0] || [];
            const rm = (segs[segs.length - 1] || [])[3] || '';
            let arr = rm.split('\n');
            if (arr.length !== part.length) {
                arr = [];
                for (let i = 0; i < part.length; i += 6) {
                    const batch = await Promise.all(part.slice(i, i + 6).map((l) => (l.trim() ? gtx(l, 'en', ['t', 'rm']).then((r) => { const s = r[0] || []; return (s[s.length - 1] || [])[3] || ''; }).catch(() => '') : Promise.resolve(''))));
                    arr.push(...batch);
                }
            }
            res.push(...arr);
        }
        return res;
    }
    const NON_LATIN = /[Ѐ-ӿ֐-׿؀-ۿऀ-෿฀-๿ᄀ-ᇿ぀-ヿ㄰-㆏㐀-鿿가-힯]/;

    // ---------- rendering ----------
    function sizeClass() { return 'ly size-' + (Store.settings.lyricsSize || 'm') + (Store.settings.lyricsBlur ? ' blur' : '') + (Store.settings.lyricsKaraoke ? ' karaoke' : ''); }

    function header(r) {
        const canRm = r && ((r.synced && r.lines.some((l) => NON_LATIN.test(l.text))) || (!r.synced && r.text && NON_LATIN.test(r.text)));
        const has = r && (r.synced || r.text);
        return `<div class="ly-tools">
            ${has ? `<button class="chip sm ${S.translate ? 'on' : ''}" data-ly="translate">${ic('translate')}<span>Translate</span></button>` : ''}
            ${canRm ? `<button class="chip sm ${S.romanize ? 'on' : ''}" data-ly="romanize">${ic('romanize')}<span>Romanize</span></button>` : ''}
            ${r && r.synced ? `<button class="chip sm ${S.syncMode ? 'on' : ''}" data-ly="sync" title="Tap the line you hear to line the lyrics up">${ic('sync')}<span>Sync</span></button>` : ''}
            <button class="icon-btn sm" data-ly="menu" aria-label="Lyrics options">${ic('more')}</button>
        </div>${S.syncMode ? '<div class="ly-syncbar">Tap the line you hear right now</div>' : ''}${S.shareMode ? `<div class="ly-sharebar"><span>Pick up to 4 lines</span><button class="btn ghost sm" data-ly="share-cancel">Cancel</button><button class="btn primary sm" data-ly="share-go" ${S.picked.size ? '' : 'disabled'}>${ic('share')}<span>Share${S.picked.size ? ' (' + S.picked.size + ')' : ''}</span></button></div>` : ''}`;
    }

    function render() {
        if (!S.el) return;
        const r = S.result, t = S.track;
        S.lineEls = []; S.active = -1;
        if (!t) { S.el.innerHTML = `<div class="ly-empty">${ic('lyrics')}<p>Play a song to see lyrics</p></div>`; return; }
        if (S.loading) {
            S.el.innerHTML = `<div class="${sizeClass()}"><div class="ly-loading"><span></span><span></span><span></span></div></div>`;
            return;
        }
        if (!r) { S.el.innerHTML = notFound(); return; }
        if (r.instrumental) { S.el.innerHTML = `<div class="ly-empty">${ic('music')}<p>Instrumental</p><small>This song has no lyrics</small></div>`; return; }

        const off = r.synced ? offsetFor(t.id) : 0;
        const adj = r.synced && Math.abs(off) >= 0.1 ? ` · timing ${off > 0 ? '+' : ''}${off.toFixed(1)}s ${manualOffset(t.id) !== null ? '(your sync)' : '(adjusted for this version)'}` : '';
        const src = `<div class="ly-source">Lyrics by ${esc(r.source)}${r.synced ? '' : ' · not synced'}${adj}</div>`;
        if (r.synced) {
            S.items = timeline(r.lines);
            let ti = 0;
            const html = S.items.map((it, i) => {
                if (it.dots) return `<div class="ly-line ly-dots" data-i="${i}"><i></i><i></i><i></i></div>`;
                const tr = S.translate && S.tr ? S.tr[ti] : '', rm = S.romanize && S.rm ? S.rm[ti] : '';
                ti++;
                const wordsHtml = !rm && it.words ? it.words.map((w, k) => `<span class="w" data-k="${k}">${esc(w.w)}</span>`).join('') : '';
                return `<div class="ly-line${wordsHtml ? ' has-words' : ''}" data-i="${i}"><span class="ly-text">${wordsHtml || esc(rm || it.text)}</span>${rm ? `<span class="ly-sub orig">${esc(it.text)}</span>` : ''}${tr ? `<span class="ly-sub">${esc(tr)}</span>` : ''}</div>`;
            }).join('');
            S.el.innerHTML = `<div class="${sizeClass()}${S.syncMode ? ' sync-mode' : ''}${S.shareMode ? ' share-mode' : ''}">${header(r)}<div class="ly-scroll" tabindex="0"><div class="ly-pad top"></div>${html}${src}<div class="ly-pad"></div></div><button class="ly-resync" data-ly="resync">${ic('sync')}<span>Back to current line</span></button></div>`;
            if (S.shareMode) S.el.querySelectorAll('.ly-line').forEach((l) => { const k = l.dataset.i != null ? 'i' + l.dataset.i : 'p' + l.dataset.p; l.classList.toggle('picked', S.picked.has(k)); });
        } else {
            const lines = r.text.split(/\r?\n/);
            let k = 0;
            const html = lines.map((l) => {
                if (!l.trim()) return '<div class="ly-gap"></div>';
                const tr = S.translate && S.tr ? S.tr[k] : '', rm = S.romanize && S.rm ? S.rm[k] : '';
                k++;
                return `<div class="ly-line plain" data-p="${i}"><span class="ly-text">${esc(rm || l)}</span>${tr ? `<span class="ly-sub">${esc(tr)}</span>` : ''}</div>`;
            }).join('');
            S.items = [];
            S.el.innerHTML = `<div class="${sizeClass()} is-plain">${header(r)}<div class="ly-scroll" tabindex="0"><div class="ly-pad top sm"></div>${html}${src}<div class="ly-pad sm"></div></div></div>`;
        }
        S.scroller = S.el.querySelector('.ly-scroll');
        S.lineEls = $$('.ly-line[data-i]', S.el);
        const markUser = () => { S.userScrollAt = performance.now(); S.el.classList.add('user-scrolled'); };
        ['wheel', 'touchmove', 'pointerdown', 'keydown'].forEach((ev) => S.scroller.addEventListener(ev, markUser, { passive: true }));
        tick(true);
    }

    function notFound(list) {
        const t = S.track;
        return `<div class="ly-empty ly-nf">
            ${ic('lyrics')}
            <p>No lyrics found</p>
            <small>Try searching yourself: fix the title or artist name</small>
            <form class="ly-search" data-ly-form>
                <input class="field" name="title" value="${esc(T.title(t))}" placeholder="Song title" autocomplete="off">
                <input class="field" name="artist" value="${esc((t.artists && t.artists[0] && t.artists[0].name) || '')}" placeholder="Artist" autocomplete="off">
                <button class="btn primary" type="submit">${ic('search')}<span>Search lyrics</span></button>
            </form>
            <div class="ly-results">${list || ''}</div>
        </div>`;
    }

    async function manualSearch(title, artist) {
        const box = S.el && S.el.querySelector('.ly-results');
        if (box) box.innerHTML = '<div class="ly-loading sm"><span></span><span></span><span></span></div>';
        const q = 'track_name=' + encodeURIComponent(title) + (artist ? '&artist_name=' + encodeURIComponent(artist) : '');
        let list = await lrclib('search', q);
        if (!list || !list.length) list = await lrclib('search', 'q=' + encodeURIComponent(title + ' ' + artist));
        list = (list || []).filter((r) => r.syncedLyrics || r.plainLyrics).slice(0, 12);
        S._manual = list;
        if (!box) return;
        box.innerHTML = list.length ? list.map((r, i) => `<button class="ly-pick" data-ly-pick="${i}">
            <span class="ly-pick-t">${esc(r.trackName)}</span>
            <span class="ly-pick-s">${esc(r.artistName)} · ${fmtTime(r.duration)} ${r.syncedLyrics ? '<em>synced</em>' : ''}</span></button>`).join('')
            : '<small>No results. Try a different spelling.</small>';
    }

    // ---------- sync loop ----------
    function findActive(t) {
        const it = S.items; let lo = 0, hi = it.length - 1, ans = -1;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (it[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
        if (ans > -1 && it[ans].dots && t > it[ans].end) return ans; // keep dots until next line
        return ans;
    }

    function setActive(i, instant) {
        if (i === S.active) return;
        const prev = S.lineEls[S.active];
        if (prev) { prev.classList.remove('active'); prev.style.removeProperty('--p'); if (prev._w) prev._w.forEach((sp) => { sp._s = 0; sp.className = 'w'; sp.style.removeProperty('--wp'); }); }
        S.active = i;
        S.lineEls.forEach((el, k) => {
            const d = i < 0 ? 3 : Math.min(Math.abs(k - i), 4);
            el.dataset.d = d;
            el.classList.toggle('past', i > -1 && k < i);
        });
        const el = S.lineEls[i];
        if (el) {
            el.classList.add('active');
            if (performance.now() - S.userScrollAt > 3500) scrollTo(el, instant);
        }
    }

    function scrollTo(el, instant) {
        if (!S.scroller || !el) return;
        const top = el.offsetTop - S.scroller.clientHeight * 0.36 + el.offsetHeight / 2;
        S.scroller.scrollTo({ top, behavior: instant ? 'auto' : 'smooth' });
        S.el.classList.remove('user-scrolled');
    }

    function tick(instant) {
        if (!S.el || !S.items.length || !S.lineEls.length) return;
        const t = Player.time() + offsetFor(S.track && S.track.id) - lyricsDelay();
        const i = findActive(t);
        setActive(i, instant === true);
        const it = S.items[i], el = S.lineEls[i];
        if (it && el) {
            if (it.words && el.classList.contains('has-words')) {
                if (!el._w) el._w = $$('.w', el);
                const ws = it.words;
                for (let k = 0; k < ws.length; k++) {
                    const st = ws[k].t, en = k + 1 < ws.length ? ws[k + 1].t : it.end;
                    const sp = el._w[k]; if (!sp) continue;
                    if (t >= en) { if (sp._s !== 2) { sp._s = 2; sp.className = 'w done'; sp.style.removeProperty('--wp'); } }
                    else if (t >= st) { if (sp._s !== 1) { sp._s = 1; sp.className = 'w cur'; } sp.style.setProperty('--wp', (clamp((t - st) / Math.max(0.12, en - st), 0, 1) * 100).toFixed(1) + '%'); }
                    else if (sp._s) { sp._s = 0; sp.className = 'w'; sp.style.removeProperty('--wp'); }
                }
            } else {
                const p = clamp((t - it.t) / Math.max(0.3, (it.end - it.t)), 0, 1);
                el.style.setProperty('--p', (p * 100).toFixed(1) + '%');
            }
        }
        if (S.el.classList.contains('user-scrolled') && performance.now() - S.userScrollAt > 3500) {
            const a = S.lineEls[S.active]; if (a) scrollTo(a);
        }
    }

    // ---------- public ----------
    async function load(track) {
        const token = ++S.token;
        S.track = track; S.result = null; S.tr = null; S.rm = null; S.items = [];
        if (!track) { render(); return; }
        const cached = cacheGet(track.id);
        if (cached !== null && cached !== undefined) { S.result = cached || null; S.loading = false; render(); return; }
        S.loading = true; render();
        let r = null;
        try { r = await find(track); } catch (e) { console.warn(e); }
        if (token !== S.token) return;
        S.loading = false; S.result = r;
        cacheSet(track.id, r || false, r ? 14 : 1);
        render();
        if (S.translate) doTranslate(); if (S.romanize) doRomanize();
    }

    function textLines() {
        const r = S.result; if (!r) return [];
        return r.synced ? timeline(r.lines).filter((x) => !x.dots).map((x) => x.text) : r.text.split(/\r?\n/).filter((l) => l.trim());
    }

    async function doTranslate() {
        const lines = textLines(); if (!lines.length) return;
        const tl = Store.settings.translateTo || 'en';
        const token = S.token;
        Bus.emit('toast', { msg: 'Translating lyrics…' });
        try {
            const { lines: out, src } = await translateLines(lines, tl);
            if (token !== S.token) return;
            if (src && src.split('-')[0] === tl.split('-')[0]) {
                Bus.emit('toast', { msg: 'Lyrics are already in that language' });
                S.translate = false; render(); return;
            }
            S.tr = out; render();
        } catch (e) { S.translate = false; Bus.emit('toast', { msg: 'Translation failed', type: 'error' }); render(); }
    }
    async function doRomanize() {
        const lines = textLines(); if (!lines.length) return;
        const token = S.token;
        Bus.emit('toast', { msg: 'Romanizing lyrics…' });
        try { const out = await romanizeLines(lines); if (token !== S.token) return; S.rm = out; render(); }
        catch (e) { S.romanize = false; Bus.emit('toast', { msg: 'Romanize failed', type: 'error' }); render(); }
    }

    function setOffset(delta) {
        if (!S.track) return;
        const o = OFFSETS(); o[S.track.id] = Math.round((offsetFor(S.track.id) + delta) * 10) / 10;
        LS.set('dc_ly_offset', o);
        Bus.emit('toast', { msg: 'Lyrics offset ' + ((o[S.track.id] || 0) > 0 ? '+' : '') + (o[S.track.id] || 0).toFixed(1) + 's' });
    }

    function mount(el) {
        S.el = el;
        el.addEventListener('click', (e) => {
            const pick = e.target.closest('[data-ly-pick]');
            if (pick) {
                const rec = S._manual[+pick.dataset.lyPick];
                const r = toResult(rec);
                if (r) { S.result = r; S.tr = S.rm = null; cacheSet(S.track.id, r, 60); render(); Bus.emit('toast', { msg: 'Lyrics saved for this song', type: 'success' }); }
                return;
            }
            const b = e.target.closest('[data-ly]');
            if (b) {
                const a = b.dataset.ly;
                if (a === 'translate') { S.translate = !S.translate; if (S.translate && !S.tr) doTranslate(); else render(); }
                else if (a === 'romanize') { S.romanize = !S.romanize; if (S.romanize && !S.rm) doRomanize(); else render(); }
                else if (a === 'sync') { S.syncMode = !S.syncMode; render(); }
                else if (a === 'resync') { S.userScrollAt = 0; const x = S.lineEls[S.active]; if (x) scrollTo(x); }
                else if (a === 'menu') Bus.emit('lyrics-menu', b);
                else if (a === 'share-cancel') { S.shareMode = false; render(); }
                else if (a === 'share-go') {
                    const texts = [...S.el.querySelectorAll('.ly-line.picked .ly-text')].map((x) => x.textContent.trim()).filter(Boolean);
                    S.shareMode = false; render();
                    if (texts.length) LyricCard.open(S.track, texts);
                }
                return;
            }
            // share mode: tap lines to pick them
            const pl = e.target.closest('.ly-line[data-i], .ly-line[data-p]');
            if (S.shareMode && pl) {
                if (pl.classList.contains('ly-dots')) return;
                const key = (pl.dataset.i != null ? 'i' : 'p') + (pl.dataset.i != null ? pl.dataset.i : pl.dataset.p);
                if (S.picked.has(key)) S.picked.delete(key);
                else if (S.picked.size < 4) S.picked.add(key);
                else Bus.emit('toast', { msg: 'Up to 4 lines' });
                pl.classList.toggle('picked', S.picked.has(key));
                const go = S.el.querySelector('[data-ly="share-go"]');
                if (go) { go.disabled = !S.picked.size; go.querySelector('span').textContent = 'Share' + (S.picked.size ? ' (' + S.picked.size + ')' : ''); }
                return;
            }
            const line = e.target.closest('.ly-line[data-i]');
            if (line && S.items.length && S.syncMode) {
                const it = S.items[+line.dataset.i];
                if (it && !it.dots) {
                    const o = OFFSETS();
                    o[S.track.id] = Math.round((it.t - Player.time() + lyricsDelay()) * 10) / 10;
                    LS.set('dc_ly_offset', o);
                    S.syncMode = false; S.userScrollAt = 0;
                    Bus.emit('toast', { msg: 'Lyrics synced for this song', type: 'success' });
                    render();
                }
                return;
            }
            if (line && S.items.length) {
                const it = S.items[+line.dataset.i];
                if (it) { S.userScrollAt = 0; Player.seek(Math.max(0, it.t - offsetFor(S.track.id))); if (!Player.state.playing) Player.play(); }
            }
        });
        el.addEventListener('submit', (e) => {
            const f = e.target.closest('[data-ly-form]'); if (!f) return;
            e.preventDefault();
            manualSearch(f.elements['title'].value.trim(), f.elements['artist'].value.trim());
        });
        render();
    }

    return {
        mount, load, tick, render, setOffset,
        openManual() { if (!S.el || !S.track) return; S.el.innerHTML = notFound(); },
        startShare() {
            if (!S.track || !S.result) { Bus.emit('toast', { msg: 'No lyrics to share for this song' }); return; }
            S.shareMode = true; S.syncMode = false; S.picked = new Set();
            // start with the line being sung
            const it = S.items[S.active]; if (it && !it.dots && S.items.length) S.picked.add('i' + S.active);
            render();
            if (!UI.npOpen) UI.openNP('lyrics');
        },
        get state() { return S; },
        resetSync() { if (!S.track) return; const o = OFFSETS(); delete o[S.track.id]; LS.set('dc_ly_offset', o); render(); Bus.emit('toast', { msg: 'Sync reset' }); },
        hasManualSync() { return !!(S.track && manualOffset(S.track.id) !== null); },
        currentLine() { const it = S.items[S.active]; return it && !it.dots ? it.text : ''; },
        // For the Dynamic Island / notification: works whether or not the lyrics view is open
        lineAt(t) {
            const it = S.items;
            if (!it.length || !S.track) return { cur: '', next: '', synced: !!(S.result && S.result.synced), progress: 0 };
            t += offsetFor(S.track.id) - lyricsDelay();
            let lo = 0, hi = it.length - 1, a = -1;
            while (lo <= hi) { const m = (lo + hi) >> 1; if (it[m].t <= t) { a = m; lo = m + 1; } else hi = m - 1; }
            const cur = it[a], nx = it.slice(a + 1).find((x) => !x.dots);
            let p = cur ? clamp((t - cur.t) / Math.max(0.3, cur.end - cur.t), 0, 1) : 0;
            if (cur && cur.words && cur.words.length) {
                const ws = cur.words; let k = -1;
                for (let i = 0; i < ws.length; i++) if (ws[i].t <= t) k = i;
                if (k < 0) p = 0;
                else { const en = k + 1 < ws.length ? ws[k + 1].t : cur.end; p = (k + clamp((t - ws[k].t) / Math.max(0.12, en - ws[k].t), 0, 1)) / ws.length; }
            }
            return { cur: cur && !cur.dots ? cur.text : (cur && cur.dots ? '♪' : ''), next: nx ? nx.text : '', synced: true, progress: p, index: a, items: it };
        },
    };
})();
