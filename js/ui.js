/* Darcam — UI chrome: components, player bar, Now Playing, queue, menus, modals. */
'use strict';

const UI = (() => {
    const lists = new Map();       // listId → { tracks, source }
    let listSeq = 0;
    const mobile = () => window.matchMedia('(max-width: 820px)').matches;

    function regList(tracks, source) {
        const id = 'l' + (++listSeq);
        lists.set(id, { tracks, source });
        if (lists.size > 60) lists.delete(lists.keys().next().value);
        return id;
    }

    // ---------- components ----------
    // Image with a fallback URL, then a letter tile if both fail
    function art(url, cls = '', alt = '', fb = '') {
        const letter = esc(((alt || '').trim()[0] || '♪').toUpperCase());
        return url ? `<img class="${cls}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async" data-fb="${esc(fb || '')}" data-letter="${letter}" onerror="UI.imgFail(this)">`
            : `<div class="${cls} ph">${ic('music')}</div>`;
    }
    function imgFail(img) {
        const fb = img.dataset.fb;
        if (fb && img.src !== fb) { img.dataset.fb = ''; img.src = fb; return; }
        const d = document.createElement('div');
        d.className = (img.className || '') + ' ph letter';
        d.textContent = img.dataset.letter || '♪';
        img.replaceWith(d);
    }
    const isCur = (t) => { const c = Player.current(); return c && t && c.id === t.id; };
    const eq = () => '<span class="eq"><i></i><i></i><i></i></span>';

    function trackRow(t, i, listId, opts = {}) {
        t = Catalog.normalize(t);
        const liked = Store.isLiked(t.id);
        return `<div class="trow ${isCur(t) ? 'is-current' : ''}" data-list="${listId}" data-i="${i}" data-id="${esc(t.id)}" role="button" tabindex="0">
            <div class="trow-idx">${opts.rank ? `<span class="rank">${i + 1}</span>` : opts.noIndex ? '' : `<span class="num">${i + 1}</span>`}${eq()}<span class="pi">${ic('play')}</span></div>
            <div class="trow-main">
                ${art(T.cover(t), 'trow-art', T.title(t))}
                <div class="trow-text"><div class="trow-title">${esc(T.title(t))}</div><div class="trow-sub">${esc(T.artist(t))}</div></div>
            </div>
            <button class="icon-btn sm trow-like ${liked ? 'on' : ''}" data-act="like" aria-label="Like">${ic(liked ? 'heartFill' : 'heart')}</button>
            <div class="trow-dur">${T.dur(t)}</div>
            <button class="icon-btn sm trow-more" data-act="more" aria-label="More">${ic('more')}</button>
        </div>`;
    }
    function trackList(tracks, source, opts = {}) {
        if (!tracks || !tracks.length) return `<div class="empty">${esc(opts.empty || 'No songs')}</div>`;
        const id = regList(tracks.map(Catalog.normalize), source);
        return `<div class="tlist ${opts.cls || ''}">${tracks.map((t, i) => trackRow(t, i, id, opts)).join('')}</div>`;
    }

    function tile(t, listId, i, opts = {}) {
        t = Catalog.normalize(t);
        const video = opts.video || t.kind === 'video';
        return `<div class="tile ${video ? 'is-video' : ''} ${isCur(t) ? 'is-current' : ''}" data-list="${listId}" data-i="${i}" data-id="${esc(t.id)}" role="button" tabindex="0">
            <div class="tile-art">${art(video ? T.coverLg(t) : T.cover(t), '', T.title(t))}<button class="fab" data-act="play" aria-label="Play">${ic('play')}</button>${isCur(t) ? eq() : ''}</div>
            <div class="tile-title">${esc(T.title(t))}</div>
            <div class="tile-sub">${esc(opts.sub || T.artist(t))}</div>
        </div>`;
    }
    function tileRow(tracks, source, opts = {}) {
        if (!tracks || !tracks.length) return '';
        const id = regList(tracks.map(Catalog.normalize), source);
        return `<div class="hrow ${opts.video ? 'video' : ''}">${tracks.map((t, i) => tile(t, id, i, opts)).join('')}</div>`;
    }
    function artistTile(a) {
        return `<a class="tile artist" href="#/artist/${esc(a.id)}"><div class="tile-art round">${art(a.image, '', a.name, a.image_fb)}</div><div class="tile-title">${esc(a.name)}</div><div class="tile-sub">Artist</div></a>`;
    }
    function playlistTile(p) {
        return `<a class="tile" href="#/list/${esc(p.id)}"><div class="tile-art">${art(p.image, '', p.name)}<span class="fab" data-act="play-list" data-pid="${esc(p.id)}">${ic('play')}</span></div><div class="tile-title">${esc(p.name)}</div><div class="tile-sub">${esc(p.owner || 'Playlist')}${p.count ? ' · ' + p.count + ' songs' : ''}</div></a>`;
    }
    function localPlaylistCover(p, cls = '') {
        if (p.coverImage) return `<img class="${cls}" src="${esc(p.coverImage)}" alt="">`;
        const c = p.tracks.slice(0, 4).map((t) => T.cover(Catalog.normalize(t)));
        if (c.length >= 4) return `<div class="${cls} mosaic">${c.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</div>`;
        if (c.length) return `<img class="${cls}" src="${esc(c[0])}" alt="">`;
        return `<div class="${cls} ph">${ic('music')}</div>`;
    }
    function section(title, inner, more) {
        if (!inner) return '';
        const nav = /class="hrow/.test(inner) ? `<div class="sec-nav"><button class="sec-arrow" data-dir="-1" aria-label="Scroll left" disabled>${ic('chevronLeft')}</button><button class="sec-arrow" data-dir="1" aria-label="Scroll right">${ic('chevronRight')}</button></div>` : '';
        return `<section class="sec"><div class="sec-head"><h2>${esc(title)}</h2><div class="sec-tools">${more ? `<a class="sec-more" href="${more}">Show all</a>` : ''}${nav}</div></div>${inner}</section>`;
    }
    // left/right arrows for horizontal rows
    const NAV_HTML = () => `<div class="sec-nav"><button class="sec-arrow" data-dir="-1" aria-label="Scroll left" disabled>${ic('chevronLeft')}</button><button class="sec-arrow" data-dir="1" aria-label="Scroll right">${ic('chevronRight')}</button></div>`;
    function syncRowNav(sec) {
        const row = sec.querySelector('.hrow');
        if (!row || row.closest('.sec') !== sec) return;
        const head = sec.querySelector('.sec-head');
        if (head && head.closest('.sec') === sec && !head.querySelector('.sec-nav')) {
            let tools = head.querySelector('.sec-tools');
            if (!tools) { tools = document.createElement('div'); tools.className = 'sec-tools'; const more = head.querySelector('.sec-more'); if (more) tools.appendChild(more); head.appendChild(tools); }
            tools.insertAdjacentHTML('beforeend', NAV_HTML());
        }
        const btns = sec.querySelectorAll('.sec-arrow');
        if (btns.length < 2) return;
        const max = row.scrollWidth - row.clientWidth;
        sec.querySelector('.sec-nav').classList.toggle('hide', max <= 4);
        btns[0].disabled = row.scrollLeft <= 4;
        btns[1].disabled = row.scrollLeft >= max - 4;
    }
    const syncAllRowNav = () => document.querySelectorAll('.sec').forEach(syncRowNav);
    document.addEventListener('click', (e) => {
        const b = e.target.closest('.sec-arrow'); if (!b) return;
        const row = b.closest('.sec').querySelector('.hrow'); if (!row) return;
        row.scrollBy({ left: +b.dataset.dir * Math.max(200, row.clientWidth * 0.85), behavior: 'smooth' });
    });
    document.addEventListener('scroll', (e) => { const r = e.target; if (r.classList && r.classList.contains('hrow')) { const sec = r.closest('.sec'); if (sec) syncRowNav(sec); } }, true);
    window.addEventListener('resize', syncAllRowNav);
    let navRaf = 0;
    new MutationObserver(() => { cancelAnimationFrame(navRaf); navRaf = requestAnimationFrame(syncAllRowNav); }).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') { cancelAnimationFrame(navRaf); navRaf = requestAnimationFrame(syncAllRowNav); } }, true);
    function skeletonRow(n = 6, video) { return `<div class="hrow ${video ? 'video' : ''}">${Array.from({ length: n }, () => '<div class="tile sk"><div class="tile-art"></div><div class="sk-line"></div><div class="sk-line short"></div></div>').join('')}</div>`; }
    function skeletonList(n = 6) { return `<div class="tlist">${Array.from({ length: n }, () => '<div class="trow sk"><div></div><div class="trow-main"><div class="trow-art"></div><div class="trow-text"><div class="sk-line"></div><div class="sk-line short"></div></div></div></div>').join('')}</div>`; }

    // ---------- toast ----------
    let toastT;
    function toast(msg, type = '') {
        const el = $('#toast');
        el.textContent = msg;
        el.className = 'toast show ' + type;
        clearTimeout(toastT);
        toastT = setTimeout(() => (el.className = 'toast ' + type), 2400);
    }
    Bus.on('toast', (d) => toast(d.msg, d.type));

    // ---------- menu ----------
    let menuAnchor = null;
    function openMenu(anchor, items) {
        const m = $('#menu');
        menuAnchor = anchor && anchor.nodeType === 1 ? anchor : null;
        m.innerHTML = items.filter(Boolean).map((it, i) => it === '-' ? '<div class="menu-sep"></div>'
            : it.html ? `<div class="menu-block">${it.html}</div>`
            : `<button class="menu-item ${it.danger ? 'danger' : ''}" data-mi="${i}">${it.iconHTML || ic(it.icon || 'music')}<span>${esc(it.label)}</span></button>`).join('');
        const valid = items.filter(Boolean);
        m.onclick = (e) => { const b = e.target.closest('[data-mi]'); if (!b) return; closeMenu(); const it = valid[+b.dataset.mi]; it && it.run && it.run(); };
        m.classList.add('show');
        if (mobile()) { m.classList.add('sheet'); $('#scrim').classList.add('show'); m.style.cssText = ''; return; }
        m.classList.remove('sheet');
        const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y };
        const mw = m.offsetWidth, mh = m.offsetHeight;
        let x = r.right - mw, y = r.bottom + 6;
        if (x < 8) x = r.left;
        if (y + mh > innerHeight - 8) y = r.top - mh - 6;
        m.style.left = clamp(x, 8, innerWidth - mw - 8) + 'px';
        m.style.top = clamp(y, 8, innerHeight - mh - 8) + 'px';
    }
    function closeMenu() { $('#menu').classList.remove('show'); if (!$('#queue').classList.contains('open')) $('#scrim').classList.remove('show'); }

    function trackMenu(anchor, t, ctx = {}) {
        t = Catalog.normalize(t);
        const liked = Store.isLiked(t.id);
        openMenu(anchor, [
            Jam.active ? { icon: 'users', label: 'Add to Jam', run: () => Jam.add(t) } : null,
            { icon: 'play', label: 'Play next', run: () => Player.playNext(t) },
            typeof Friends !== 'undefined' && Friends.ready ? { icon: 'users', label: 'Send to a friend', run: () => Friends.sendSong(t) } : null,
            { icon: 'queue', label: 'Add to queue', run: () => Player.addToQueue(t) },
            { icon: 'plus', label: 'Add to playlist', run: () => addToPlaylistModal(t) },
            { icon: liked ? 'heartFill' : 'heart', label: liked ? 'Remove from Liked Songs' : 'Save to Liked Songs', run: () => toggleLike(t) },
            T.artistId(t) ? { icon: 'user', label: 'Go to artist', run: () => { closeNP(); location.hash = '#/artist/' + T.artistId(t); } } : null,
            { icon: 'radio', label: 'Start song radio', run: () => startRadio(t) },
            { icon: 'share', label: 'Share song link', run: () => ShareLink.song(t) },
            ctx.np ? { icon: 'users', label: Jam.active ? 'Jam' : 'Listen together (Jam)', run: () => Jam.menu() } : null,
            ctx.np ? { icon: 'clock', label: 'Playback speed: ' + Speed.label(), run: () => Speed.open() } : null,
            ctx.np ? { icon: 'expand', label: 'Full screen lyrics', run: () => Karaoke.open() } : null,
            ctx.np ? { icon: 'moon', label: Sleep.status().on ? 'Sleep timer: ' + Sleep.label() : 'Sleep timer', run: () => setTimeout(() => Sleep.menu(anchor), 0) } : null,
            ctx.np ? { icon: 'share', label: 'Share lyrics as a picture', run: () => Lyrics.startShare() } : null,
            ctx.np ? { icon: 'image', label: 'Share as a picture (Story)', run: () => StoryCard.shareNow(t) } : null,
            ctx.np ? { icon: 'car', label: 'Car mode', run: () => CarMode.open() } : null,
            ctx.playlistId ? '-' : null,
            ctx.playlistId ? { icon: 'trash', label: 'Remove from this playlist', danger: true, run: () => { Store.removeFromPlaylist(ctx.playlistId, t.id); toast('Removed from playlist'); } } : null,
        ]);
    }

    async function startRadio(t) {
        toast('Starting radio…');
        try { const more = await Catalog.radio(t); Player.playList([t, ...more], 0, { type: 'radio', name: T.title(t) + ' Radio' }); }
        catch (e) { toast(e.message, 'error'); }
    }

    function toggleLike(t) {
        if (!t) return;
        const on = Store.toggleLike(t);
        toast(on ? 'Saved to Liked Songs' : 'Removed from Liked Songs', on ? 'success' : '');
    }

    // ---------- modals ----------
    function modal(html, onMount) {
        const w = $('#modal');
        w.innerHTML = `<div class="modal-bg" data-close></div><div class="modal glass" role="dialog">${html}</div>`;
        w.classList.add('show');
        const close = () => { w.classList.remove('show'); setTimeout(() => { if (!w.classList.contains('show')) w.innerHTML = ''; }, 250); };
        w.onclick = (e) => { if (e.target.closest('[data-close]')) close(); };
        onMount && onMount(w.querySelector('.modal'), close);
        const inp = w.querySelector('input'); if (inp) setTimeout(() => inp.focus(), 60);
        return close;
    }
    function promptModal(title, value, cb, okLabel = 'Save') {
        modal(`<h3>${esc(title)}</h3><form data-f><input class="field" name="v" value="${esc(value || '')}" maxlength="60" autocomplete="off"><div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">${esc(okLabel)}</button></div></form>`,
            (m, close) => { m.querySelector('[data-f]').onsubmit = (e) => { e.preventDefault(); const v = e.target.elements.v.value.trim(); if (v) { close(); cb(v); } }; });
    }
    function confirmModal(title, text, okLabel, cb) {
        modal(`<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p><div class="modal-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" data-ok>${esc(okLabel)}</button></div>`,
            (m, close) => { m.querySelector('[data-ok]').onclick = () => { close(); cb(); }; });
    }
    function newPlaylist(thenAdd) {
        promptModal('New playlist', 'Playlist #' + (Store.playlists().length + 1), (name) => {
            const p = Store.createPlaylist(name);
            if (thenAdd) { Store.addToPlaylist(p.id, thenAdd); toast('Added to ' + name, 'success'); }
            else location.hash = '#/playlist/' + p.id;
        }, 'Create');
    }
    function addToPlaylistModal(t) {
        const pls = Store.playlists().filter((p) => !p.smart);
        modal(`<h3>Add to playlist</h3>
            <button class="pick-row new" data-new>${'<span class="pick-art ph">' + ic('plus') + '</span>'}<span>New playlist</span></button>
            <div class="pick-list">${pls.map((p) => `<button class="pick-row" data-pid="${esc(p.id)}">${localPlaylistCover(p, 'pick-art')}<span>${esc(p.name)}<small>${p.tracks.length} songs</small></span></button>`).join('')}</div>`,
            (m, close) => {
                m.onclick = (e) => {
                    if (e.target.closest('[data-new]')) { close(); newPlaylist(t); return; }
                    const b = e.target.closest('[data-pid]'); if (!b) return;
                    const ok = Store.addToPlaylist(b.dataset.pid, t);
                    close(); toast(ok ? 'Added to playlist' : 'Already in this playlist', ok ? 'success' : '');
                };
            });
    }

    // ---------- range sliders ----------
    function bindRange(el, { onInput, onCommit }) {
        let drag = false;
        const pct = (e) => { const r = el.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
        el.addEventListener('pointerdown', (e) => { drag = true; el.setPointerCapture(e.pointerId); el.classList.add('drag'); setRange(el, pct(e), true); onInput && onInput(pct(e)); });
        el.addEventListener('pointermove', (e) => { if (!drag) return; setRange(el, pct(e), true); onInput && onInput(pct(e)); });
        const end = (e) => { if (!drag) return; drag = false; el.classList.remove('drag'); onCommit && onCommit(pct(e)); };
        el.addEventListener('pointerup', end); el.addEventListener('pointercancel', () => { drag = false; el.classList.remove('drag'); });
        el.tabIndex = 0;
        el.addEventListener('keydown', (e) => {
            const cur = parseFloat(el.dataset.p || 0);
            if (e.key === 'ArrowRight') { e.preventDefault(); onCommit && onCommit(clamp(cur + 0.02, 0, 1)); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); onCommit && onCommit(clamp(cur - 0.02, 0, 1)); }
        });
    }
    function setRange(el, p, force) {
        if (el.classList.contains('drag') && !force) return;
        el.dataset.p = p;
        el.style.setProperty('--p', (p * 100).toFixed(2) + '%');
    }

    // ---------- player chrome ----------
    let npMode = Store.settings.npMode === 'video' ? 'video' : 'lyrics';
    let npOpen = false;

    function paintTrack(t) {
        const bar = $('#bar');
        bar.dataset.empty = t ? '0' : '1';
        document.body.classList.toggle('has-track', !!t);
        if (!t) return;
        $('#barArt').src = T.cover(t);
        $('#barTitle').textContent = T.title(t);
        $('#barArtist').textContent = T.artist(t);
        $('#npArt').src = T.coverLg(t);
        $('#npThumb').src = T.cover(t);
        $('#npTitle').textContent = T.title(t);
        $('#npArtist').textContent = T.artist(t);
        $('#npBg').style.backgroundImage = `url("${T.coverLg(t)}")`;
        document.title = T.title(t) + ' · ' + T.artist(t);
        paintLike();
        dominantColor(T.cover(t)).then((c) => {
            if (!c || Player.current() !== t) return;
            document.documentElement.style.setProperty('--tint', `${c[0]}, ${c[1]}, ${c[2]}`);
        });
        // highlight in lists
        $$('.is-current:not(.q)').forEach((e) => { if (e.dataset.id !== t.id) e.classList.remove('is-current'); });
        $$(`[data-id="${CSS.escape(t.id)}"]:not(.q)`).forEach((e) => e.classList.add('is-current'));
        paintCardButtons(Player.state);
        Lyrics.load(t);
        renderQueue();
    }

    function paintState(P) {
        const playing = P.playing;
        $$('[data-action="toggle"]').forEach((b) => {
            const k = playing ? 'pause' : 'play';
            if (b.dataset.icon !== k) { b.dataset.icon = k; b.innerHTML = ic(k); }
            b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
            b.classList.toggle('loading', P.buffering && !playing);
        });
        document.body.classList.toggle('is-playing', playing);
        paintCardButtons(P);
    }
    // the round play button on cards: pause icon on the song that's playing now
    function paintCardButtons(P) {
        $$('.quick [data-act="play"], .tile [data-act="play"]').forEach((b) => {
            const cur = b.closest('.is-current'), k = cur && P.playing ? 'pause' : 'play';
            if (b.dataset.icon !== k) { b.dataset.icon = k; b.innerHTML = ic(k); b.setAttribute('aria-label', k === 'pause' ? 'Pause' : 'Play'); }
        });
    }
    Bus.on('page', () => paintCardButtons(Player.state));
    function paintMode(P) {
        $$('[data-action="shuffle"]').forEach((b) => {
            b.classList.toggle('on', P.shuffle); b.classList.toggle('smart', !!P.smart);
            const h = ic(P.smart ? 'shuffleSmart' : 'shuffle'); if (b.innerHTML !== h) b.innerHTML = h;
            const lbl = P.smart ? 'Smart Shuffle on' : P.shuffle ? 'Shuffle on' : 'Shuffle off';
            b.title = lbl + ' · tap to change'; b.setAttribute('aria-label', lbl);
        });
        $$('[data-action="repeat"]').forEach((b) => { b.classList.toggle('on', P.repeat > 0); b.innerHTML = ic(P.repeat === 2 ? 'repeatOne' : 'repeat'); });
    }
    function paintVolume(P) {
        const v = P.muted ? 0 : P.volume;
        $$('[data-range="volume"]').forEach((r) => setRange(r, v / 100));
        $$('[data-action="mute"]').forEach((b) => (b.innerHTML = ic(v === 0 ? 'volumeMute' : v < 50 ? 'volumeLow' : 'volume')));
    }
    function paintLike() {
        const t = Player.current();
        const on = t && Store.isLiked(t.id);
        $$('[data-action="like-current"]').forEach((b) => { b.innerHTML = ic(on ? 'heartFill' : 'heart'); b.classList.toggle('on', !!on); });
    }

    // time loop
    let lastTxt = 0;
    function loop() {
        const P = Player.state, t = Player.time(), d = P.duration || 0;
        if (!seekDragging) $$('[data-range="seek"]').forEach((r) => setRange(r, d ? t / d : 0));
        $('#bar .mini-progress-fill').style.width = (d ? (t / d) * 100 : 0) + '%';
        const now = performance.now();
        if (now - lastTxt > 250) {
            lastTxt = now;
            const ct = fmtTime(seekDragging ? seekPreview : t), dt = fmtTime(d);
            $$('[data-time="cur"]').forEach((e) => { if (e.textContent !== ct) e.textContent = ct; });
            $$('[data-time="dur"]').forEach((e) => { if (e.textContent !== dt) e.textContent = dt; });
        }
        if (npOpen && npMode === 'lyrics') Lyrics.tick();
        if (npOpen && npMode === 'video') placeEngine();
        requestAnimationFrame(loop);
    }
    let seekDragging = false, seekPreview = 0;

    // ---------- Now Playing ----------
    function openNP(mode) {
        if (!Player.current()) { toast('Pick a song first'); return; }
        if (mode) setMode(mode);
        npOpen = true;
        const np = $('#np');
        np.classList.add('open'); np.setAttribute('aria-hidden', 'false');
        document.body.classList.add('np-open');
        if (mobile() && !history.state?.np) history.pushState({ np: 1 }, '');
        setTimeout(() => { placeEngine(); if (npMode === 'lyrics') Lyrics.tick(true); }, 420);
    }
    function closeNP(fromPop) {
        if (!npOpen) return;
        npOpen = false;
        const np = $('#np');
        np.classList.remove('open'); np.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('np-open');
        placeEngine();
        if (!fromPop && history.state && history.state.np) history.back();
    }
    function setMode(m) {
        if (m !== 'video') m = 'lyrics';
        npMode = m;
        Store.setSetting('npMode', m);
        $('#npBody').dataset.mode = m;
        $('#np').dataset.mode = m;
        const seg = $('#npSeg');
        const btns = $$('button', seg);
        const idx = btns.findIndex((b) => b.dataset.mode === m);
        btns.forEach((b, i) => b.classList.toggle('on', i === idx));
        seg.style.setProperty('--i', idx);
        if (m === 'lyrics') setTimeout(() => Lyrics.tick(true), 60);
        placeEngine();
        setTimeout(placeEngine, 380);
    }

    function placeEngine() {
        const eng = $('#engine');
        const show = npOpen && npMode === 'video' && Player.current();
        const bg = !show && npOpen && npMode === 'lyrics' && typeof VideoBg !== 'undefined' && VideoBg.on();
        $('#np').classList.toggle('vbg', !!bg);
        eng.classList.toggle('bg', !!bg);
        if (show) {
            const r = $('#npVideo').getBoundingClientRect();
            if (r.width < 10) return;
            eng.classList.add('show');
            eng.style.left = r.left + 'px'; eng.style.top = r.top + 'px';
            eng.style.width = r.width + 'px'; eng.style.height = r.height + 'px';
        } else if (bg) {
            // cover the whole screen with the 16:9 video, behind the lyrics
            // a little taller than the screen so YouTube's title strip sits above the top edge
            const W = innerWidth, H = innerHeight + 160, k = Math.max(W / 16, H / 9) * 1.04;
            const w = Math.ceil(16 * k), h = Math.ceil(9 * k);
            eng.classList.add('show');
            eng.style.left = Math.round((W - w) / 2) + 'px'; eng.style.top = Math.round((innerHeight - h) / 2) + 'px';
            eng.style.width = w + 'px'; eng.style.height = h + 'px';
        } else if (eng.classList.contains('show')) {
            eng.classList.remove('show');
            eng.style.left = eng.style.top = eng.style.width = eng.style.height = '';
        }
    }
    window.addEventListener('resize', () => { if (npOpen) placeEngine(); });
    Bus.on('track', () => setTimeout(() => { if (npOpen) placeEngine(); }, 50));

    // ---------- queue drawer ----------
    function renderQueue() {
        const box = $('#qBody'); if (!box) return;
        wireQueueGestures();
        const P = Player.state;
        const cur = Player.current();
        if (!cur) { box.innerHTML = `<div class="empty">${ic('queue')}<p>Queue kosong</p></div>`; return; }
        const up = P.queue.slice(P.index + 1);
        const id = regList(P.queue, P.source);
        box.innerHTML = `<div class="q-label">Now playing</div>${trackRowQ(cur, P.index, id, true)}
            <div class="q-label row">${up.length ? 'Next up' + (P.source && P.source.name ? ' · ' + esc(P.source.name) : '') : 'Nothing next'}
            ${up.length ? '<button class="link" data-act="clear-queue">Clear</button>' : ''}</div>
            ${up.map((t, k) => trackRowQ(t, P.index + 1 + k, id)).join('')}
            ${Store.settings.autoplay ? `<div class="q-note">${ic('radio')} Autoplay is on: when the queue ends, more songs from the same singer and with the same vibe play</div>` : ''}`;
    }
    function trackRowQ(t, i, listId, current) {
        return `<div class="trow q ${current ? 'is-current' : ''}" data-list="${listId}" data-i="${i}" data-id="${esc(t.id)}" data-q="1">
            <div class="trow-main">${art(T.cover(t), 'trow-art')}<div class="trow-text"><div class="trow-title">${esc(T.title(t))}</div><div class="trow-sub">${t.smart ? `<span class="smart-tag">${ic('sparkle')} Smart Shuffle</span> ` : ''}${esc(T.artist(t))}</div></div></div>
            ${current ? eq() : `<button class="icon-btn sm" data-act="q-remove" aria-label="Remove">${ic('x')}</button><span class="q-grip" data-grip title="Drag to reorder">${ic('grip')}</span>`}
        </div>`;
    }
    // Queue: drag the grip to reorder, swipe a row sideways to remove it
    function wireQueueGestures() {
        const box = $('#qBody'); if (!box || box._wired) return; box._wired = true;
        let drag = null, swipe = null;
        box.addEventListener('pointerdown', (e) => {
            const row = e.target.closest('.trow.q:not(.is-current)'); if (!row) return;
            if (e.target.closest('[data-grip]')) {
                e.preventDefault();
                const rows = [...box.querySelectorAll('.trow.q:not(.is-current)')];
                drag = { row, rows, from: +row.dataset.i, y0: e.clientY, h: row.offsetHeight, to: +row.dataset.i, id: e.pointerId };
                row.classList.add('dragging'); row.setPointerCapture(e.pointerId);
            } else if (e.pointerType !== 'mouse') {
                swipe = { row, x0: e.clientX, y0: e.clientY, dx: 0, id: e.pointerId, on: false };
            }
        });
        box.addEventListener('pointermove', (e) => {
            if (drag && e.pointerId === drag.id) {
                const dy = e.clientY - drag.y0;
                drag.row.style.transform = `translateY(${dy}px)`;
                const idx = drag.rows.indexOf(drag.row);
                const shift = Math.round(dy / drag.h);
                const target = Math.max(0, Math.min(drag.rows.length - 1, idx + shift));
                drag.rows.forEach((r, k) => {
                    if (r === drag.row) return;
                    let off = 0;
                    if (idx < target && k > idx && k <= target) off = -drag.h;
                    if (idx > target && k < idx && k >= target) off = drag.h;
                    r.style.transform = off ? `translateY(${off}px)` : '';
                });
                drag.to = +drag.rows[target].dataset.i;
            } else if (swipe && e.pointerId === swipe.id) {
                const dx = e.clientX - swipe.x0, dy = e.clientY - swipe.y0;
                if (!swipe.on && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) { swipe.on = true; swipe.row.setPointerCapture(e.pointerId); }
                if (swipe.on) { swipe.dx = dx; swipe.row.style.transform = `translateX(${dx}px)`; swipe.row.style.opacity = String(Math.max(.2, 1 - Math.abs(dx) / 260)); }
            }
        });
        const end = (e) => {
            if (drag && e.pointerId === drag.id) {
                const { from, to } = drag;
                drag.rows.forEach((r) => (r.style.transform = ''));
                drag.row.classList.remove('dragging');
                drag = null;
                if (from !== to) Player.move(from, to);
            } else if (swipe && e.pointerId === swipe.id) {
                const s2 = swipe; swipe = null;
                if (s2.on && Math.abs(s2.dx) > 110) { s2.row.style.transform = `translateX(${s2.dx > 0 ? 420 : -420}px)`; setTimeout(() => Player.removeAt(+s2.row.dataset.i), 160); }
                else { s2.row.style.transform = ''; s2.row.style.opacity = ''; }
            }
        };
        box.addEventListener('pointerup', end);
        box.addEventListener('pointercancel', end);
        // a swipe must not also count as a tap on the row
        box.addEventListener('click', (e) => { if (e.target.closest('[data-grip]')) { e.stopPropagation(); e.preventDefault(); } }, true);
    }
    function toggleQueue(force) {
        if (force !== false && typeof Jam !== 'undefined' && Jam.active && !$('#queue').classList.contains('open')) { Jam.panel(); return; }   // in a Jam the shared queue is the Jam screen
        const q = $('#queue');
        const open = force != null ? force : !q.classList.contains('open');
        q.classList.toggle('open', open); q.setAttribute('aria-hidden', String(!open));
        $('#scrim').classList.toggle('show', open);
        document.body.classList.toggle('queue-open', open);
        if (open) renderQueue();
    }

    // ---------- side library ----------
    function renderSideLibrary() {
        const box = $('#sideLibrary'); if (!box) return;
        const pls = Store.playlists().slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
        box.innerHTML = `<a class="lib-item" href="#/liked"><span class="lib-art liked">${ic('heartFill')}</span><span class="lib-text"><b>Liked Songs</b><small>Playlist · ${Store.liked().length} songs</small></span></a>`
            + pls.map((p) => `<a class="lib-item" href="#/playlist/${esc(p.id)}" data-pl="${esc(p.id)}">${localPlaylistCover(p, 'lib-art')}<span class="lib-text"><b>${esc(p.name)}</b><small>Playlist · ${p.tracks.length} songs</small></span></a>`).join('')
            + (pls.length ? '' : `<button class="lib-cta" data-action="new-playlist">${ic('plus')}<span>Create your first playlist</span></button>`);
        const cur = location.hash;
        $$('.lib-item', box).forEach((a) => a.classList.toggle('active', a.getAttribute('href') === cur));
    }

    // ---------- global events ----------
    function handleList(e) {
        const row = e.target.closest('[data-list][data-i]');
        if (!row) return false;
        const L = lists.get(row.dataset.list); if (!L) return false;
        const i = +row.dataset.i, t = L.tracks[i];
        const act = e.target.closest('[data-act]');
        if (act && act.dataset.act === 'more') { trackMenu(act, t, { playlistId: L.source && L.source.type === 'playlist' ? L.source.id : null }); return true; }
        if (act && act.dataset.act === 'like') { toggleLike(t); return true; }
        if (act && act.dataset.act === 'q-remove') { Player.removeAt(i); return true; }
        if (row.dataset.q) { Player.jump(i); return true; }
        if (isCur(t)) { Player.toggle(); return true; }
        Player.playList(L.tracks, i, L.source);
        if (L.source && L.source.search) Store.pushSearch({ type: 'track', item: t });
        if (t.kind === 'video' && L.source && L.source.videoAuto) openNP('video');
        return true;
    }

    function bind() {
        hydrateIcons();
        $$('[data-logo]').forEach((e) => (e.innerHTML = LOGO_SVG));

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#menu') && $('#menu').classList.contains('show') && !e.target.closest('[data-act="more"],[data-action="np-more"],[data-ly="menu"]') && !(menuAnchor && menuAnchor.contains(e.target))) closeMenu();   // the button that opened the menu doesn't close it
            if (handleList(e)) return;
            const mxPlay = e.target.closest('[data-act="play-mix"]');
            if (mxPlay && (mxPlay.dataset.mix === 'radar' || mxPlay.dataset.mix === 'repeat')) {
                e.preventDefault(); e.stopPropagation();
                const id = mxPlay.dataset.mix;
                (id === 'radar' ? Radar.get() : Promise.resolve(Radar.onRepeat())).then((d) => { if (d && d.tracks.length) Player.playList(d.tracks, 0, { type: 'mix', id, name: id === 'radar' ? 'Release Radar' : 'On Repeat' }); });
                return;
            }
            if (mxPlay) { e.preventDefault(); e.stopPropagation(); DailyMix.get().then((ms) => { const m = (ms || []).find((x) => String(x.n) === mxPlay.dataset.mix); if (m) Player.playList(m.tracks, 0, { type: 'mix', id: 'mix' + m.n, name: 'Daily Mix ' + m.n }); }); return; }
            const plPlay = e.target.closest('[data-act="play-list"]');
            if (plPlay) { e.preventDefault(); e.stopPropagation(); Pages.playRemotePlaylist(plPlay.dataset.pid); return; }
            const a = e.target.closest('[data-action]');
            if (!a) {
                if (e.target.closest('[data-act="clear-queue"]')) { Player.clearUpcoming(); return; }
                if (e.target.closest('#npVideo')) { Player.toggle(); return; }
                return;
            }
            const act = a.dataset.action;
            const map = {
                toggle: () => Player.toggle(), next: () => Player.next(), prev: () => Player.prev(),
                shuffle: () => Player.toggleShuffle(), repeat: () => Player.cycleRepeat(), mute: () => Player.toggleMute(),
                'like-current': () => toggleLike(Player.current()),
                'open-np': () => openNP(), 'close-np': () => closeNP(),
                'np-lyrics': () => (npOpen && npMode === 'lyrics' ? closeNP() : openNP('lyrics')),
                'np-video': () => (npOpen && npMode === 'video' ? closeNP() : openNP('video')),
                queue: () => toggleQueue(),
                transfer: () => Transfer.open(),
                jam: () => Jam.menu(),
                sleep: () => Sleep.menu(a),
                speed: () => Speed.open(),
                karaoke: () => Karaoke.open(),
                'mini-player': () => { try { window.darcamNative && window.darcamNative.toggleMini && window.darcamNative.toggleMini(); } catch (er) {} },
                'new-playlist': () => (a.closest('.side') || a.dataset.menu ? openMenu(a, [
                    { icon: 'plus', label: 'Create playlist', run: () => newPlaylist() },
                    { icon: 'download', label: 'Import playlist', run: () => Importer.openModal() },
                ]) : newPlaylist()),
                'import-playlist': () => Importer.openModal(),
                back: () => history.back(), forward: () => history.forward(),
                'np-artist': () => { const id = T.artistId(Player.current()); if (id) { closeNP(); location.hash = '#/artist/' + id; } },
                'np-more': () => trackMenu(a, Player.current(), { np: true }),
            };
            if (map[act]) { e.preventDefault(); map[act](); }
        });
        document.addEventListener('keydown', (e) => {
            if (e.target.closest('input, textarea, [contenteditable]')) return;
            // the other keys live in extras.js (Shortcuts)
            if (e.key === 'Escape') { if ($('#menu').classList.contains('show')) closeMenu(); else if ($('#queue').classList.contains('open')) toggleQueue(false); else closeNP(); }
        });
        $('#scrim').addEventListener('click', () => { closeMenu(); toggleQueue(false); });
        window.addEventListener('popstate', () => { if (npOpen && !(history.state && history.state.np)) closeNP(true); });

        $$('#npSeg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
        setMode(npMode);

        // NP: swipe down to close (mobile)
        let sy = null;
        $('.np-head').addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; }, { passive: true });
        $('.np-head').addEventListener('touchend', (e) => { if (sy != null && e.changedTouches[0].clientY - sy > 70) closeNP(); sy = null; });
        // mini player: swipe up opens player
        let by = null;
        $('#bar').addEventListener('touchstart', (e) => { by = e.touches[0].clientY; }, { passive: true });
        $('#bar').addEventListener('touchend', (e) => { if (by != null && by - e.changedTouches[0].clientY > 40) openNP(); by = null; });

        $$('[data-range="seek"]').forEach((r) => bindRange(r, {
            onInput: (p) => { seekDragging = true; seekPreview = p * (Player.state.duration || 0); },
            onCommit: (p) => { seekDragging = false; Player.seek(p * (Player.state.duration || 0)); },
        }));
        $$('[data-range="volume"]').forEach((r) => bindRange(r, { onInput: (p) => Player.setVolume(p * 100), onCommit: (p) => Player.setVolume(p * 100) }));

        Lyrics.mount($('#npLyrics'));
        Bus.on('lyrics-menu', (btn) => openMenu(btn, [
            { icon: 'text', label: 'Text size: ' + ({ s: 'Small', m: 'Medium', l: 'Large' }[Store.settings.lyricsSize]), run: () => { const n = { s: 'm', m: 'l', l: 's' }[Store.settings.lyricsSize] || 'm'; Store.setSetting('lyricsSize', n); Lyrics.render(); } },
            { icon: 'minus', label: 'Lyrics earlier (−0.5s)', run: () => Lyrics.setOffset(-0.5) },
            { icon: 'plus', label: 'Lyrics later (+0.5s)', run: () => Lyrics.setOffset(0.5) },
            { icon: 'share', label: 'Share lyrics as a picture', run: () => Lyrics.startShare() },
            { icon: 'search', label: 'Search other lyrics', run: () => Lyrics.openManual() },
            Lyrics.hasManualSync() ? { icon: 'sync', label: 'Reset sync for this song', run: () => Lyrics.resetSync() } : null,
        ]));

        Bus.on('track', paintTrack);
        Bus.on('state', paintState);
        Bus.on('mode', paintMode);
        Bus.on('volume', paintVolume);
        Bus.on('queue', () => { if ($('#queue').classList.contains('open')) renderQueue(); });
        Bus.on('sleep', (st) => {
            $$('[data-action="sleep"]').forEach((b) => { b.classList.toggle('on', st.on); b.dataset.badge = st.on ? (st.mode === 'song' ? '♪' : String(Math.ceil(st.left / 60))) : ''; b.title = st.on ? 'Sleep timer: ' + Sleep.label() + ' left' : 'Sleep timer'; });
        });
        Bus.on('library', (ev) => {
            paintLike(); renderSideLibrary();
            if (ev.type === 'like') $$(`.trow[data-id="${CSS.escape(ev.id)}"] .trow-like`).forEach((b) => { const on = Store.isLiked(ev.id); b.classList.toggle('on', on); b.innerHTML = ic(on ? 'heartFill' : 'heart'); });
        });
        window.addEventListener('resize', debounce(placeEngine, 50));

        paintVolume(Player.state); paintMode(Player.state); paintState(Player.state);
        renderSideLibrary();
        requestAnimationFrame(loop);
    }

    return {
        bind, regList, imgFail, trackList, trackRow, tileRow, tile, artistTile, playlistTile, localPlaylistCover, section, art,
        skeletonRow, skeletonList, toast, openMenu, closeMenu, trackMenu, modal, promptModal, confirmModal, newPlaylist,
        addToPlaylistModal, toggleLike, openNP, closeNP, renderSideLibrary, startRadio, toggleQueue,
        toggleLyrics() { npOpen && npMode === 'lyrics' ? closeNP() : openNP('lyrics'); },
        get npOpen() { return npOpen; }, get npMode() { return npMode; }, mobile,
    };
})();
