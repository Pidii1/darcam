/* Darcam — extras: sleep timer, keyboard shortcuts, listening stats (Wrapped), Daily Mix, lyric cards. */
'use strict';

// platform classes for CSS (Windows app / Android app)
try {
    if (window.darcamNative && window.darcamNative.toggleMini) document.documentElement.classList.add('is-electron');
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) document.documentElement.classList.add('is-cap');
} catch (e) {}

// =====================================================================
// Sleep timer: stop after N minutes or at the end of the song, fading out
// =====================================================================
const Sleep = (() => {
    let mode = null, endAt = 0, timer = null, fading = false;
    const FADE = 20;                       // seconds of fade before stopping
    const engineVol = (v) => { try { const e = Player.engine; if (e && !Player.state.muted) e.setVolume(Math.round(v)); } catch (e) {} };

    function set(min) {
        cancel(true);
        mode = 'time'; endAt = Date.now() + min * 60e3;
        start();
        Bus.emit('toast', { msg: `Sleep timer: music stops in ${min} min`, type: 'success' });
    }
    function endOfSong() {
        cancel(true);
        if (!Player.current()) { Bus.emit('toast', { msg: 'Play a song first' }); return; }
        mode = 'song';
        start();
        Bus.emit('toast', { msg: 'Sleep timer: music stops after this song', type: 'success' });
    }
    function start() { clearInterval(timer); timer = setInterval(tick, 500); Bus.emit('sleep', status()); }
    function cancel(quiet) {
        clearInterval(timer); timer = null;
        if (fading) Player.setVolume(Player.state.volume);
        fading = false; mode = null; endAt = 0;
        Bus.emit('sleep', status());
        if (!quiet) Bus.emit('toast', { msg: 'Sleep timer off' });
    }
    function left() {
        if (mode === 'time') return Math.max(0, (endAt - Date.now()) / 1000);
        if (mode === 'song') {
            // stop before a crossfade would start the next song
            const cf = parseFloat(Store.settings.crossfade) || 0;
            return Math.max(0, (Player.state.duration || 0) - Player.time() - cf - 0.6);
        }
        return 0;
    }
    function tick() {
        if (!mode) return;
        const l = left();
        const P = Player.state;
        if (mode === 'song' && !P.duration) return;
        if (l <= FADE && P.playing) {
            fading = true;
            engineVol(P.volume * Math.max(0, l / FADE));
        }
        if (l <= 0.05) {
            Player.pause();
            const v = P.volume; setTimeout(() => Player.setVolume(v), 400);
            fading = false;
            clearInterval(timer); timer = null; mode = null;
            Bus.emit('sleep', status());
            Bus.emit('toast', { msg: 'Sleep timer: music stopped. Good night 🌙' });
            return;
        }
        Bus.emit('sleep', status());
    }
    function status() { return { on: !!mode, mode, left: left() }; }
    function label() {
        if (!mode) return '';
        if (mode === 'song') return 'End of song';
        const m = Math.ceil(left() / 60); return m + ' min';
    }
    function menu(anchor) {
        UI.openMenu(anchor, [
            ...[15, 30, 45, 60, 90].map((m) => ({ icon: 'moon', label: m + ' minutes', run: () => set(m) })),
            { icon: 'music', label: 'End of this song', run: () => endOfSong() },
            mode ? '-' : null,
            mode ? { icon: 'x', label: `Turn off (${label()} left)`, run: () => cancel() } : null,
        ]);
    }
    return { set, endOfSong, cancel, status, label, menu };
})();

// =====================================================================
// Keyboard shortcuts (Windows / desktop web)
// =====================================================================
const Shortcuts = (() => {
    const LIST = [
        ['Space', 'Play / pause'], ['Ctrl + →', 'Next song'], ['Ctrl + ←', 'Previous song'],
        ['→ / ←', 'Forward / back 5 s'], ['↑ / ↓', 'Volume up / down'], ['M', 'Mute'],
        ['L', 'Lyrics'], ['H', 'Like song'], ['S', 'Shuffle'], ['R', 'Repeat'], ['Q', 'Queue'],
        ['Ctrl + K  or  /', 'Search'], ['Esc', 'Close player'],
    ];
    function typing(e) {
        const t = e.target;
        return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    }
    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.altKey) return;
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); location.hash = '#/search'; setTimeout(() => { const i = document.querySelector('.page.search input'); if (i) i.focus(); }, 80); return; }
        if (typing(e)) return;
        const P = Player.state;
        const k = e.key;
        let done = true;
        if (k === ' ' || k === 'Spacebar') Player.toggle();
        else if (ctrl && k === 'ArrowRight') Player.next();
        else if (ctrl && k === 'ArrowLeft') Player.prev();
        else if (k === 'ArrowRight') Player.seek(Player.time() + 5);
        else if (k === 'ArrowLeft') Player.seek(Player.time() - 5);
        else if (k === 'ArrowUp') Player.setVolume(Math.min(100, (P.muted ? 0 : P.volume) + 5));
        else if (k === 'ArrowDown') Player.setVolume(Math.max(0, (P.muted ? 0 : P.volume) - 5));
        else if (ctrl) done = false;
        else if (k === 'm' || k === 'M') Player.toggleMute();
        else if (k === 'l' || k === 'L') UI.toggleLyrics();
        else if (k === 'h' || k === 'H') { if (Player.current()) UI.toggleLike(Player.current()); }
        else if (k === 's' || k === 'S') Player.toggleShuffle();
        else if (k === 'r' || k === 'R') Player.cycleRepeat();
        else if (k === 'q' || k === 'Q') UI.toggleQueue();
        else if (k === '/') { location.hash = '#/search'; setTimeout(() => { const i = document.querySelector('.page.search input'); if (i) i.focus(); }, 80); }
        else done = false;
        if (done) e.preventDefault();
    });
    return { LIST };
})();

// =====================================================================
// Full listening history (every song played for 30 s or more)
// =====================================================================
const History = (() => {
    const KEY = 'dc_history';
    let list = LS.get(KEY, []);
    const save = debounce(() => { if (!LS.set(KEY, list)) { list = list.slice(0, 1500); LS.set(KEY, list); } }, 3000);
    function add(t) {
        list.unshift({ y: t.youtube_id || t.id, n: t.name, a: T.artist(t), aid: T.artistId(t), c: T.cover(t), d: t.duration_ms || 0, at: Date.now() });
        if (list.length > 3000) list.length = 3000;
        save();
    }
    const all = () => list;
    function clear() { list = []; LS.set(KEY, list); }
    return { add, all, clear };
})();

// =====================================================================
// Listening stats (for Wrapped and Daily Mix)
// =====================================================================
const Stats = (() => {
    const KEY = 'dc_stats';
    let data = LS.get(KEY, { days: {} });
    if (!data.days) data = { days: {} };
    const day = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const save = debounce(() => {
        // keep about a year and a bit
        const keys = Object.keys(data.days).sort();
        while (keys.length > 400) delete data.days[keys.shift()];
        if (!LS.set(KEY, data)) { const k2 = Object.keys(data.days).sort(); k2.slice(0, 60).forEach((k) => delete data.days[k]); LS.set(KEY, data); }
    }, 4000);
    let curId = null, counted = false, heard = 0;
    Bus.on('track', (t) => { curId = t && t.id; counted = false; heard = 0; });
    setInterval(() => {
        const t = Player.current(), P = Player.state;
        if (!t || !P.playing || P.buffering || t.pending) return;
        if (t.id !== curId) { curId = t.id; counted = false; heard = 0; }
        const d = (data.days[day()] = data.days[day()] || { s: 0, t: {} });
        d.s += 1; heard += 1;
        const e = (d.t[t.id] = d.t[t.id] || { s: 0, n: 0, name: t.name, a: T.artist(t), aid: T.artistId(t), c: T.cover(t), y: t.youtube_id || t.id, d: t.duration_ms || 0 });
        e.s += 1;
        if (!counted && heard >= 30) { counted = true; e.n += 1; History.add(t); }
        save();
    }, 1000);

    // totals between two dates (inclusive)
    function range(from, to) {
        const out = { secs: 0, plays: 0, songs: {}, artists: {}, byDay: {} };
        Object.entries(data.days).forEach(([k, d]) => {
            if (k < from || k > to) return;
            out.secs += d.s; out.byDay[k] = d.s;
            Object.entries(d.t).forEach(([id, e]) => {
                out.plays += e.n;
                const s = (out.songs[id] = out.songs[id] || { id, name: e.name, a: e.a, aid: e.aid, c: e.c, y: e.y, d: e.d, s: 0, n: 0 });
                s.s += e.s; s.n += e.n;
                const an = (e.a || '').split(/\s*,\s*/)[0];
                if (!an || an === 'Unknown') return;
                const a = (out.artists[an] = out.artists[an] || { name: an, aid: e.aid, c: e.c, s: 0, n: 0 });
                a.s += e.s; a.n += e.n;
            });
        });
        out.topSongs = Object.values(out.songs).sort((a, b) => (b.n - a.n) || (b.s - a.s));
        out.topArtists = Object.values(out.artists).sort((a, b) => (b.s - a.s));
        return out;
    }
    const toTrack = (s) => ({ id: s.y || s.id, youtube_id: s.y || s.id, name: s.name, artists: [{ name: s.a, id: s.aid || '' }], album: { name: s.a, images: [{ url: s.c }] }, cover: s.c, cover_lg: (s.c || '').replace('mqdefault', 'hqdefault') || s.c, duration_ms: s.d || 0, kind: 'song', _n: 1 });
    return { day, range, toTrack, get data() { return data; } };
})();

// =====================================================================
// Daily Mix: a few playlists made each day from the singers you play most
// =====================================================================
const DailyMix = (() => {
    const key = () => 'dc_mix_' + Stats.day();
    let building = null;
    function seeds() {
        const to = Stats.day(), d = new Date(); d.setDate(d.getDate() - 45);
        const r = Stats.range(Stats.day(d), to);
        const out = [], seen = new Set();
        r.topArtists.forEach((a) => {
            if (out.length >= 4 || seen.has(a.name.toLowerCase())) return;
            const own = r.topSongs.filter((s) => (s.a || '').split(/\s*,\s*/)[0] === a.name).slice(0, 3);
            if (!own.length) return;
            seen.add(a.name.toLowerCase());
            out.push({ artist: a.name, songs: own.map(Stats.toTrack) });
        });
        // not much history yet: use liked songs and recently played
        if (out.length < 3) {
            Store.liked().concat(Store.recent()).map(Catalog.normalize).forEach((t) => {
                if (out.length >= 4 || t.pending) return;
                const an = (T.artist(t) || '').split(/\s*,\s*/)[0];
                if (!an || an === 'Unknown' || seen.has(an.toLowerCase())) return;
                seen.add(an.toLowerCase());
                out.push({ artist: an, songs: [t] });
            });
        }
        return out;
    }
    async function build() {
        const sd = seeds();
        if (!sd.length) return [];
        const mixes = [];
        for (const s of sd) {
            try {
                const radio = await Catalog.radio(s.songs[0], { exclude: s.songs.map((t) => t.id) });
                // a few of the singer's own songs, then the radio, mixed a little
                const tracks = s.songs.slice(0, 2).concat(radio.slice(0, 28));
                if (tracks.length < 8) continue;
                const names = [...new Set(tracks.map((t) => (T.artist(t) || '').split(/\s*,\s*/)[0]).filter((x) => x && x !== 'Unknown'))];
                mixes.push({
                    n: mixes.length + 1, artist: s.artist,
                    sub: names.slice(0, 3).join(', ') + (names.length > 3 ? ' and more' : ''),
                    covers: tracks.slice(0, 4).map((t) => T.cover(t)),
                    tracks: tracks.map((t) => ({ id: t.id, youtube_id: t.youtube_id || t.id, name: t.name, artists: t.artists, album: t.album, cover: t.cover, cover_lg: t.cover_lg, duration_ms: t.duration_ms || 0, kind: t.kind, channelId: t.channelId, _n: 1 })),
                });
            } catch (e) { console.warn('mix', e.message); }
        }
        if (mixes.length) {
            Object.keys(localStorage).filter((k) => k.startsWith('dc_mix_') && k !== key()).forEach((k) => localStorage.removeItem(k));
            LS.set(key(), mixes);
        }
        return mixes;
    }
    function get() {
        const c = LS.get(key(), null);
        if (c && c.length) return Promise.resolve(c);
        if (!building) building = build().finally(() => { building = null; });
        return building;
    }
    const cached = () => LS.get(key(), null);
    const HUES = ['#e5243b', '#ff4f93', '#8b5cf6', '#f59e0b'];
    function cover(m) {
        return `<div class="mix-cover" style="--mc:${HUES[(m.n - 1) % HUES.length]}">
            <div class="mosaic">${m.covers.slice(0, 4).map((u) => `<img src="${esc(u)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`).join('')}</div>
            <span class="mix-band"><b>Daily Mix</b> ${m.n}</span></div>`;
    }
    return { get, cached, cover };
})();

// =====================================================================
// Lyric cards: a picture of a few lyric lines to share
// =====================================================================
const LyricCard = (() => {
    function loadImg(src) {
        return new Promise((res) => {
            if (!src) return res(null);
            const i = new Image(); i.crossOrigin = 'anonymous';
            i.onload = () => res(i); i.onerror = () => res(null);
            i.src = src;
        });
    }
    function wrap(ctx, text, maxW) {
        const words = text.split(/\s+/); const lines = []; let cur = '';
        words.forEach((w) => { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
        if (cur) lines.push(cur);
        return lines;
    }
    const THEMES = {
        cover: { name: 'Cover' }, dark: { name: 'Dark', bg: ['#141416', '#050505'] },
        pink: { name: 'Pink', bg: ['#ff4f93', '#e5243b'] }, cream: { name: 'Light', bg: ['#f6efe6', '#e9ddcf'], ink: '#1b1b1b' },
    };
    async function render(t, lines, theme = 'cover') {
        const W = 1080, H = 1350;
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const x = cv.getContext('2d');
        const th = THEMES[theme] || THEMES.cover;
        const img = await loadImg(T.coverLg(t)) || await loadImg(T.cover(t));
        const ink = th.ink || '#fff';
        // background
        if (theme === 'cover' && img) {
            x.filter = 'blur(60px) saturate(1.3)';
            const s = Math.max(W / img.width, H / img.height) * 1.25;
            x.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
            x.filter = 'none';
            const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(0,0,0,.6)');
            x.fillStyle = g; x.fillRect(0, 0, W, H);
        } else {
            const bg = th.bg || ['#141416', '#050505'];
            const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
            x.fillStyle = g; x.fillRect(0, 0, W, H);
        }
        // song header
        const pad = 96;
        if (img) {
            const sz = 150, r = 22;
            x.save(); x.beginPath(); x.roundRect(pad, pad, sz, sz, r); x.clip();
            const s = Math.max(sz / img.width, sz / img.height);
            x.drawImage(img, pad + (sz - img.width * s) / 2, pad + (sz - img.height * s) / 2, img.width * s, img.height * s);
            x.restore();
        }
        const tx = img ? pad + 150 + 36 : pad;
        x.fillStyle = ink; x.textBaseline = 'top';
        x.font = '800 50px Inter, "Segoe UI", system-ui, sans-serif';
        const title = wrap(x, T.title(t), W - tx - pad)[0];
        x.fillText(title, tx, pad + 28);
        x.globalAlpha = .7; x.font = '600 38px Inter, "Segoe UI", system-ui, sans-serif';
        x.fillText(wrap(x, T.artist(t), W - tx - pad)[0] || '', tx, pad + 92);
        x.globalAlpha = 1;
        // lyric lines, as big as they fit
        const text = lines.join('\n');
        let size = 84, all;
        for (; size >= 44; size -= 4) {
            x.font = `800 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
            all = []; text.split('\n').forEach((l) => all.push(...wrap(x, l, W - pad * 2)));
            if (all.length * size * 1.22 < H - 560) break;
        }
        const lh = size * 1.22, top = 360 + Math.max(0, (H - 560 - all.length * lh) / 2);
        all.forEach((l, i) => x.fillText(l, pad, top + i * lh));
        // footer
        x.globalAlpha = .85; x.font = '800 40px Inter, "Segoe UI", system-ui, sans-serif';
        x.fillText('darcam', pad, H - pad - 40);
        const w = x.measureText('darcam').width;
        x.fillStyle = theme === 'pink' ? '#fff' : '#e5243b'; x.fillText('.', pad + w + 2, H - pad - 40);
        x.globalAlpha = 1;
        return cv;
    }
    async function share(cv, t) {
        const name = ('darcam-' + T.title(t)).replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').slice(0, 60) + '.png';
        const data = cv.toDataURL('image/png');
        const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.DarcamIsland;
        if (cap && cap.shareImage) { try { await cap.shareImage({ data: data.split(',')[1], name }); return; } catch (e) {} }
        try {
            const blob = await (await fetch(data)).blob();
            const file = new File([blob], name, { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: T.title(t) }); return; }
        } catch (e) { if (e && e.name === 'AbortError') return; }
        const a = document.createElement('a'); a.href = data; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        Bus.emit('toast', { msg: 'Picture saved', type: 'success' });
    }
    async function open(t, lines) {
        let theme = 'cover', cv = null;
        UI.modal(`<h3>Share lyrics</h3>
            <div class="card-prev"><div class="card-sk">Making the picture…</div></div>
            <div class="card-themes">${Object.entries(THEMES).map(([k, v]) => `<button class="chip ${k === theme ? 'on' : ''}" data-theme="${k}">${v.name}</button>`).join('')}</div>
            <div class="modal-actions"><button class="btn ghost" data-close>Close</button><button class="btn primary" data-share>${ic('share')}<span>Share</span></button></div>`, (m, close) => {
            const prev = m.querySelector('.card-prev');
            const draw = async () => { cv = await render(t, lines, theme); cv.className = 'card-canvas'; prev.innerHTML = ''; prev.appendChild(cv); };
            m.querySelectorAll('[data-theme]').forEach((b) => b.onclick = () => { theme = b.dataset.theme; m.querySelectorAll('[data-theme]').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
            m.querySelector('[data-share]').onclick = () => { if (cv) share(cv, t); };
            draw();
        });
        document.querySelector('#modal .modal').classList.add('wide');
    }
    return { open, render, share };
})();

// =====================================================================
// Playback speed: Slowed / Normal / Sped up, or anything from 0.5× to 2×
// =====================================================================
const Speed = (() => {
    const PRESETS = [['Slowed', 0.85], ['Normal', 1], ['Sped up', 1.25]];
    const fmt = (r) => (Math.round(r * 100) / 100).toString().replace(/\.?0+$/, (m) => (m.startsWith('.') ? '' : m)) + '×';
    function label() { return fmt(Player.state.rate || 1); }
    function open() {
        if (!Player.current()) { Bus.emit('toast', { msg: 'Play a song first' }); return; }
        UI.modal(`<div class="sp-head"><h3>Playback speed</h3><b class="sp-now">${label()}</b></div>
            <div class="sp-presets">${PRESETS.map(([n, r]) => `<button class="sp-pre" data-r="${r}"><b>${n}</b><span>${fmt(r)}</span></button>`).join('')}</div>
            <input type="range" class="sp-range" min="0.5" max="2" step="0.05" value="${Player.state.rate || 1}" aria-label="Speed">
            <div class="sp-ticks"><span>0.5×</span><span>1×</span><span>1.5×</span><span>2×</span></div>
            <p class="muted small">Lyrics follow the new speed. The speed is kept for this song only.</p>
            <div class="modal-actions"><button class="btn ghost" data-close>Done</button></div>`, (m) => {
            const paint = () => {
                const r = Player.state.rate || 1;
                m.querySelector('.sp-now').textContent = label();
                m.querySelector('.sp-range').value = r;
                m.querySelectorAll('.sp-pre').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.r - r) < 0.01));
            };
            m.querySelectorAll('.sp-pre').forEach((b) => b.onclick = () => { Player.setRate(+b.dataset.r); paint(); });
            m.querySelector('.sp-range').oninput = (e) => { Player.setRate(+e.target.value); paint(); };
            paint();
        });
    }
    Bus.on('rate', () => document.querySelectorAll('[data-action="speed"]').forEach((b) => { b.querySelector('span').textContent = label(); b.classList.toggle('on', (Player.state.rate || 1) !== 1); }));
    Bus.on('track', () => setTimeout(() => Bus.emit('rate', Player.state), 0));
    return { open, label };
})();

// =====================================================================
// Karaoke: big lyrics on the whole screen (for a TV, a party, singing along)
// =====================================================================
const Karaoke = (() => {
    let el = null, timer = 0, lastKey = '';
    function open() {
        const t = Player.current();
        if (!t) { Bus.emit('toast', { msg: 'Play a song first' }); return; }
        if (el) return;
        el = document.createElement('div');
        el.className = 'kara';
        el.innerHTML = `<div class="kara-bg"></div><div class="kara-shade"></div>
            <header class="kara-top"><img class="kara-art" alt=""><div class="kara-meta"><b></b><span></span></div>
                <button class="kara-btn" data-k="close" aria-label="Exit full screen">${ic('x')}</button></header>
            <div class="kara-lines"></div>
            <footer class="kara-foot"><span class="kara-cur">0:00</span><div class="kara-track"><i></i></div><span class="kara-dur">0:00</span>
                <button class="kara-play" data-k="toggle" aria-label="Play or pause"></button></footer>`;
        document.body.appendChild(el);
        el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-k]'); if (!b) return;
            if (b.dataset.k === 'close') close();
            if (b.dataset.k === 'toggle') Player.toggle();
        });
        try { el.requestFullscreen && el.requestFullscreen().catch(() => {}); } catch (e) {}
        document.addEventListener('fullscreenchange', onFs);
        document.addEventListener('keydown', onKey, true);
        lastKey = '';
        timer = setInterval(paint, 120);
        paint();
    }
    function onFs() { if (!document.fullscreenElement && el) close(); }
    function onKey(e) { if (e.key === 'Escape' && el) { e.stopPropagation(); close(); } }
    function close() {
        clearInterval(timer);
        document.removeEventListener('fullscreenchange', onFs);
        document.removeEventListener('keydown', onKey, true);
        try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
        if (el) el.remove();
        el = null;
    }
    function paint() {
        if (!el) return;
        const t = Player.current(); if (!t) return close();
        const P = Player.state, now = Player.time();
        const key = t.id;
        if (key !== lastKey) {
            lastKey = key;
            el.querySelector('.kara-bg').style.backgroundImage = `url("${T.coverLg(t)}")`;
            el.querySelector('.kara-art').src = T.cover(t);
            el.querySelector('.kara-meta b').textContent = T.title(t);
            el.querySelector('.kara-meta span').textContent = T.artist(t);
        }
        const pb = el.querySelector('.kara-play'), k = P.playing ? 'pause' : 'play';
        if (pb.dataset.icon !== k) { pb.dataset.icon = k; pb.innerHTML = ic(k); }
        el.querySelector('.kara-cur').textContent = fmtTime(now);
        el.querySelector('.kara-dur').textContent = fmtTime(P.duration || 0);
        el.querySelector('.kara-track i').style.width = (P.duration ? Math.min(100, (now / P.duration) * 100) : 0) + '%';
        const L = Lyrics.lineAt(now);
        const box = el.querySelector('.kara-lines');
        if (!L.synced || !L.items || !L.items.length) {
            const plain = Lyrics.state && Lyrics.state.result && !Lyrics.state.result.synced;
            if (box.dataset.mode !== 'none') { box.dataset.mode = 'none'; box.innerHTML = `<div class="kara-line cur">${plain ? 'These lyrics aren’t timed, so they can’t follow the song.' : '♪'}</div>`; }
            return;
        }
        const items = L.items, i = L.index;
        const rows = [];
        for (let d = -2; d <= 3; d++) { const it = items[i + d]; rows.push(it ? (it.dots ? '♪ ♪ ♪' : it.text) : ''); }
        const sig = i + '|' + rows.join('|');
        if (box.dataset.sig !== sig) {
            box.dataset.sig = sig; box.dataset.mode = 'lines';
            box.innerHTML = rows.map((r, n) => `<div class="kara-line ${n === 2 ? 'cur' : n < 2 ? 'past' : 'next' + (n - 2)}">${n === 2 ? `<span class="kara-fill">${esc(r)}</span>` : esc(r)}</div>`).join('');
        }
        const f = box.querySelector('.kara-fill');
        if (f) f.style.setProperty('--p', Math.round((L.progress || 0) * 100) + '%');
    }
    return { open, close };
})();

// =====================================================================
// Release Radar (new songs from your artists, weekly) and On Repeat (your most played, 30 days)
// =====================================================================
const Radar = (() => {
    const week = () => { const d = new Date(); const onejan = new Date(d.getFullYear(), 0, 1); return d.getFullYear() + '-w' + Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7); };
    const key = () => 'dc_radar_' + week();
    let building = null;
    function topArtists(n) {
        const d = new Date(); d.setDate(d.getDate() - 60);
        const names = (typeof Follow !== 'undefined' ? Follow.list().map((a) => a.name) : []);
        Stats.range(Stats.day(d), Stats.day()).topArtists.forEach((a) => { if (!names.includes(a.name)) names.push(a.name); });
        Store.liked().map(Catalog.normalize).forEach((t) => { const a = (T.artist(t) || '').split(/\s*,\s*/)[0]; if (a && a !== 'Unknown' && !names.includes(a)) names.push(a); });
        return names.slice(0, n);
    }
    async function build() {
        const artists = topArtists(Math.max(8, typeof Follow !== 'undefined' ? Math.min(20, Follow.list().length) : 0));
        if (!artists.length) return null;
        const all = [];
        for (const a of artists) { try { (await Catalog.newFrom(a)).slice(0, 3).forEach((t) => all.push(t)); } catch (e) {} }
        all.sort((x, y) => (x.ago || 9e9) - (y.ago || 9e9));
        const tracks = all.slice(0, 30).map((t) => ({ id: t.id, youtube_id: t.youtube_id || t.id, name: t.name, artists: t.artists, album: t.album, cover: t.cover, cover_lg: t.cover_lg, duration_ms: t.duration_ms || 0, kind: t.kind, channelId: t.channelId, ago: t.ago, _n: 1 }));
        const names = [...new Set(tracks.map((t) => T.artist(t).split(/\s*,\s*/)[0]))];
        const res = { tracks, sub: names.length ? 'New from ' + names.slice(0, 3).join(', ') + (names.length > 3 ? ' and more' : '') : 'No new songs from your artists this week' };
        Object.keys(localStorage).filter((k) => k.startsWith('dc_radar_') && k !== key()).forEach((k) => localStorage.removeItem(k));
        LS.set(key(), res);
        return res;
    }
    function get() {
        const c = LS.get(key(), null);
        if (c) return Promise.resolve(c);
        if (!building) building = build().finally(() => { building = null; });
        return building;
    }
    const cached = () => LS.get(key(), null);
    function onRepeat() {
        const d = new Date(); d.setDate(d.getDate() - 30);
        const r = Stats.range(Stats.day(d), Stats.day());
        const tracks = r.topSongs.filter((s) => s.n >= 2).slice(0, 30).map(Stats.toTrack);
        return { tracks, plays: r.topSongs.slice(0, 30).reduce((a, s) => a + s.n, 0) };
    }
    const ago = (s) => !s ? '' : s < 86400 ? 'today' : s < 172800 ? 'yesterday' : s < 604800 ? Math.round(s / 86400) + ' days ago' : Math.round(s / 604800) + ' week' + (s >= 1209600 ? 's' : '') + ' ago';
    return { get, cached, onRepeat, ago };
})();

// =====================================================================
// Your Darcam website (for share links and Jam). The web version knows its own address.
// =====================================================================
const Site = (() => {
    const onWeb = () => /^https?:/.test(location.protocol) && !/^(127\.0\.0\.1|localhost)$/.test(location.hostname) && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    function base() {
        if (onWeb()) return location.origin + location.pathname.replace(/[^/]*$/, '');
        let s = (localStorage.getItem('dc_site') || '').trim();
        if (!s) return '';
        if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
        return s.replace(/[#?].*$/, '').replace(/\/?$/, '/').replace(/index\.html\/$/, '');
    }
    const api = (file) => (onWeb() ? file : (base() ? base() + file : ''));
    return { base, api, onWeb, set: (v) => localStorage.setItem('dc_site', (v || '').trim()) };
})();

// =====================================================================
// Share a song or a playlist with a link
// =====================================================================
const ShareLink = (() => {
    const b64u = (bytes) => { let s = ''; bytes.forEach((b) => (s += String.fromCharCode(b))); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
    async function pipe(bytes, st) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(st)).arrayBuffer()); }
    const link = (path) => (Site.base() ? Site.base() + '#/' + path : 'darcam://' + path);
    function song(t) {
        t = Catalog.normalize(t);
        if (t.pending) { Bus.emit('toast', { msg: 'Play this song once first, then share it' }); return; }
        sheet({ title: T.title(t), sub: T.artist(t), cover: T.cover(t), url: link('s/' + (t.youtube_id || t.id)), text: `${T.title(t)} – ${T.artist(t)}` });
    }
    async function playlist(p) {
        if (!p) return;
        const data = { n: p.name, t: p.tracks.slice(0, 120).map((t) => [t.pending ? '' : (t.youtube_id || t.id), t.name, T.artist(t), Math.round((t.duration_ms || 0) / 1000)]) };
        let code;
        try { code = b64u(await pipe(new TextEncoder().encode(JSON.stringify(data)), new CompressionStream('deflate-raw'))); }
        catch (e) { Bus.emit('toast', { msg: 'This device can’t make playlist links', type: 'error' }); return; }
        sheet({ title: p.name, sub: `Playlist · ${p.tracks.length} songs`, cover: p.coverImage || (p.tracks[0] && T.cover(Catalog.normalize(p.tracks[0]))) || '', url: link('p/' + code), text: `${p.name} (playlist)` });
    }
    async function decode(code) { return JSON.parse(new TextDecoder().decode(await pipe(unb64u(code), new DecompressionStream('deflate-raw')))); }
    function sheet({ title, sub, cover, url, text }) {
        const full = `${text}\n${url}`;
        UI.modal(`<div class="sh-head">${cover ? `<img src="${esc(cover)}" alt="">` : ''}<div><b>${esc(title)}</b><small>${esc(sub)}</small></div></div>
            <div class="sh-link"><input class="field" readonly value="${esc(url)}" aria-label="Link"></div>
            <div class="sh-grid">
                <button class="sh-btn" data-sh="copy">${ic('link')}<span>Copy link</span></button>
                <a class="sh-btn" href="https://wa.me/?text=${encodeURIComponent(full)}" target="_blank" rel="noopener">${ic('share')}<span>WhatsApp</span></a>
                <button class="sh-btn" data-sh="more">${ic('upload')}<span>More</span></button>
            </div>
            ${Site.base() ? '<p class="muted small">Friends with Darcam open it in the app; without it the link plays on your Darcam website.</p>' : '<p class="muted small">Only friends with the Darcam app can open this link. Add your Darcam website in Settings so everyone can open it.</p>'}
            <div class="modal-actions"><button class="btn ghost" data-close>Close</button></div>`, (m) => {
            m.querySelector('[data-sh="copy"]').onclick = async () => { try { await navigator.clipboard.writeText(url); } catch (e) { const i = m.querySelector('input'); i.select(); document.execCommand('copy'); } Bus.emit('toast', { msg: 'Link copied', type: 'success' }); };
            m.querySelector('[data-sh="more"]').onclick = async () => {
                const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.DarcamIsland;
                if (cap && cap.shareText) { try { await cap.shareText({ text: full }); return; } catch (e) {} }
                if (navigator.share) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
                try { await navigator.clipboard.writeText(full); Bus.emit('toast', { msg: 'Copied: paste it anywhere', type: 'success' }); } catch (e) {}
            };
        });
    }
    return { song, playlist, decode, link };
})();

// =====================================================================
// Jam: listen together. The host plays; friends follow and can add songs.
// =====================================================================
const Jam = (() => {
    // A Jam works like Spotify's: the host's Darcam is in charge of the music. Friends hear the same
    // song on their own device, see one shared queue, add songs with their name on them, and can
    // play / pause / skip for everyone when the host allows it. The host can reorder the queue by
    // dragging, remove songs and remove people. A Jam carries on if Darcam is closed and reopened.
    let J = null;      // { room, token?, host, members, queue, track, control, autoplay, intent, name }
    const me = (() => { let id = localStorage.getItem('dc_me'); if (!id) { id = Math.random().toString(36).slice(2, 12); localStorage.setItem('dc_me', id); } return id; })();
    const myName = () => localStorage.getItem('dc_name') || 'Friend';
    const P0 = {};     // the player's own functions (friends' buttons are routed through the Jam)
    ['toggle', 'play', 'pause', 'next', 'prev', 'playList', 'playNext', 'addToQueue', 'jump'].forEach((k) => (P0[k] = Player[k]));
    const SAVE = 'dc_jam_session';

    async function call(body) {
        const url = Site.api('jam.php');
        if (!url) throw new Error('Add your Darcam website in Settings first (Jam needs it)');
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, me, name: myName() }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { const e = new Error(j.error || (r.status === 404 ? 'The Jam has ended' : 'Jam: HTTP ' + r.status)); e.status = r.status; throw e; }
        return j;
    }
    const vid = (t) => t && (t.youtube_id || t.id);
    const isSuggested = (t) => !t._by && (t._auto || t.smart);
    const slim = (t) => t && ({ id: vid(t), name: T.title(t), artist: T.artist(t), dur: Math.round((t.duration_ms || 0) / 1000), cover: T.cover(t), by: t._by || '', auto: isSuggested(t) ? 1 : 0 });
    const toTrack = (x) => ({ id: x.id, youtube_id: x.id, name: x.name, artists: [{ name: x.artist || 'Unknown', id: '' }], album: { name: x.artist, images: [{ url: x.cover || `https://i.ytimg.com/vi/${x.id}/mqdefault.jpg` }] },
        cover: x.cover || `https://i.ytimg.com/vi/${x.id}/mqdefault.jpg`, cover_lg: x.cover ? x.cover.replace(/=w\d+-h\d+/, '=w544-h544') : `https://i.ytimg.com/vi/${x.id}/hqdefault.jpg`, duration_ms: (x.dur || 0) * 1000, kind: 'song', _n: 1, _by: x.by || '' });
    const COLORS = ['#f59e0b', '#22c55e', '#38bdf8', '#a78bfa', '#f472b6', '#fb7185', '#facc15', '#2dd4bf'];
    const colorOf = (s) => {
        const i = J ? J.members.findIndex((m) => m.name === s) : -1;   // people get colours in the order they joined
        if (i >= 0) return COLORS[i % COLORS.length];
        let h = 0; for (const c of String(s)) h = (h * 131 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length];
    };
    const avatar = (name, cls = '') => `<i class="jam-av ${cls}" style="background:${colorOf(name)}">${esc((name || '?').trim()[0] || '?').toUpperCase()}</i>`;
    const toast = (msg, type) => Bus.emit('toast', { msg, type });
    const save = () => { if (J) LS.set(SAVE, { room: J.room, token: J.token || '', host: J.host, at: Date.now() }); };
    const forget = () => localStorage.removeItem(SAVE);

    function askName(then) {
        if (localStorage.getItem('dc_name')) return then();
        UI.promptModal('Your name in the Jam', '', (v) => { localStorage.setItem('dc_name', v.slice(0, 24)); then(); }, 'Continue');
    }

    // ---------------- host ----------------
    function start() {
        askName(async () => {
            try {
                const r = await call({ op: 'create', title: myName() + '’s Jam' });
                J = hostState(r.room, r.token);
                Player.state.queue.forEach((t, i) => { if (t && !t._by && !t._auto && !t.smart && i >= Player.state.index) t._by = myName(); });
                save();
                await hostLoop();
                J.timer = setInterval(hostLoop, 1500);
                paint(); openPanel(); showInvite();
            } catch (e) { toast(e.message, 'error'); }
        });
    }
    const hostState = (room, token) => ({ room, token, host: true, members: [{ id: me, name: myName(), host: true }], control: LS.get('dc_jam_control', true),
        autoplay: LS.get('dc_jam_autoplay', true), queue: [], miss: 0, intent: !!Player.state.playing, stuck: 0 });
    const setIntent = (v) => { if (J && J.host) J.intent = !!v; };
    let sending = false, again = false;
    async function hostLoop() {
        if (!J || !J.host) return;
        if (sending) { again = true; return; }
        sending = true;
        const P = Player.state, t = Player.current();
        // if the phone or PC paused the music by itself (app in the background), start it again:
        // friends follow what the host wants, not hiccups
        let st = -1; try { st = Player.engine ? Player.engine.getPlayerState() : -1; } catch (e) {}
        if (st === 0 && P.index >= P.queue.length - 1) J.intent = false;          // the last song ended
        if (J.intent && t && !P.playing && !P.buffering) { if (++J.stuck >= 2) { J.stuck = 0; P0.play(true); } } else J.stuck = 0;
        const upcoming = P.queue.slice(P.index + 1, P.index + 51);
        try {
            const r = await call({ op: 'state', room: J.room, token: J.token, track: slim(t), queue: upcoming.map(slim), pos: Player.time(),
                playing: !!(t && J.intent), rate: P.rate || 1, control: J.control, autoplay: J.autoplay });
            const before = J.members.map((m) => m.id);
            J.members = r.members || J.members;
            if (before.length) J.members.forEach((m) => { if (!m.host && !before.includes(m.id)) toast(`${m.name} joined the Jam`); });
            (r.adds || []).forEach(addFromFriend);
            (r.cmds || []).forEach(runCmd);
            J.track = slim(Player.current()); J.queue = Player.state.queue.slice(Player.state.index + 1, Player.state.index + 51).map(slim);
            J.hostState = { playing: J.intent, pos: Player.time(), at: Date.now(), rate: P.rate || 1, dur: P.duration };
            paint(); renderPanel();
            J.miss = 0;
        } catch (e) {
            if ((e.status === 404 || e.status === 410) && ++J.miss >= 4) { toast('The Jam has ended'); stop(); }
            else console.warn('jam', e.message);
        } finally {
            sending = false;
            if (again) { again = false; setTimeout(hostLoop, 50); }
        }
    }
    function addFromFriend(x) {
        const t = toTrack(x), P = Player.state;
        if (!Player.current()) { P0.playList([t], 0, { type: 'jam', name: 'Jam' }); setIntent(true); }
        else {
            // friends' songs go after the songs people added, before suggestions (like Spotify)
            let at = P.index + 1;
            if (!x.next) while (at < P.queue.length && P.queue[at]._by) at++;
            P.queue.splice(at, 0, t);
            if (P.original) P.original.push(t);
            Bus.emit('queue', P);
        }
        toast(`${x.by} added “${x.name}”`);
    }
    function findUpcoming(id, i) {
        const P = Player.state;
        let k = P.index + 1 + (i || 0);
        if (!P.queue[k] || vid(P.queue[k]) !== id) k = P.queue.findIndex((q, n) => n > P.index && vid(q) === id);
        return k > P.index ? k : -1;
    }
    function runCmd(c) {
        if (c.cmd === 'play') { setIntent(true); P0.play(true); }
        if (c.cmd === 'pause') { setIntent(false); P0.pause(); }
        if (c.cmd === 'next') { setIntent(true); P0.next(); }
        if (c.cmd === 'prev') { setIntent(true); P0.prev(); }
        if (c.cmd === 'jump') { const k = findUpcoming(c.id, c.i); if (k > 0) { setIntent(true); P0.jump(k); } }
        if (c.cmd === 'remove') {
            // friends can only take out songs they added themselves
            const k = findUpcoming(c.id, c.i);
            if (k > 0 && Player.state.queue[k]._by === c.by) { Player.removeAt(k); toast(`${c.by} removed “${c.name || 'a song'}”`); }
            return;
        }
        const what = { play: 'pressed play', pause: 'paused', next: 'skipped', prev: 'went back', jump: 'picked a song' }[c.cmd];
        if (what) toast(`${c.by} ${what}`);
    }
    const pushSoon = debounce(() => { if (J && J.host) hostLoop(); }, 150);
    Bus.on('track', pushSoon);
    Bus.on('state', pushSoon);
    Bus.on('queue', pushSoon);

    // ---------------- friend ----------------
    function join(code, quiet) {
        code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!code) return;
        askName(async () => {
            try {
                if (J && J.room !== code) leave(true);
                J = { room: code, host: false, members: [], queue: [], track: null, control: false, lastVer: -1, miss: 0 };
                await memberLoop(true);
                if (!J) return;
                save();
                J.timer = setInterval(memberLoop, 1500);
                if (!quiet) { toast('You joined ' + (J.name || 'the Jam'), 'success'); openPanel(); }
                paint();
            } catch (e) { J = null; if (quiet) forget(); else toast(e.message, 'error'); paint(); }
        });
    }
    let reading = false;
    async function memberLoop(first) {
        if (!J || J.host || reading) return;
        reading = true;
        let g;
        try { g = await call({ op: 'get', room: J.room }); }
        catch (e) {
            reading = false;
            if (first) throw e;
            if (J && e.status === 403) { toast(e.message); stop(); return; }
            if (J && (e.status === 410 || (e.status === 404 && ++J.miss >= 4))) { toast('The Jam has ended'); stop(); }
            return;
        }
        reading = false;
        if (!J) return;
        J.miss = 0;
        if (J.lastVer >= 0 && g.ver !== J.lastVer) {
            const old = new Set(J.queue.map((q) => q.id + '|' + (q.by || '')));
            (g.queue || []).forEach((q) => { if (q.by && q.by !== myName() && !old.has(q.id + '|' + q.by)) toast(`${q.by} added “${q.name}”`); });
        }
        J.lastVer = g.ver; J.members = g.members || []; J.name = g.name; J.queue = g.queue || []; J.control = !!g.control; J.hostName = (g.host || {}).name;
        J.track = (g.host || {}).track; J.hostState = { ...(g.host || {}), at: (g.host || {}).at + (Date.now() - g.now) };   // host time → this device's clock
        paint(); renderPanel();
        follow(g);
    }
    function follow(g) {
        const h = g.host || {};
        if (!h.track) return;
        const target = h.pos + (h.playing ? ((g.now - h.at) / 1000) * (h.rate || 1) : 0) + 0.25;   // + time for the answer to arrive
        const cur = Player.current();
        if (!cur || vid(cur) !== h.track.id) {
            P0.playList([toTrack(h.track)], 0, { type: 'jam', name: 'Jam' });
            J.seekTo = target + 1.2;
            if (!h.playing) J.pauseAfterLoad = true;
            return;
        }
        if (J.seekTo != null && Player.state.playing) { Player.seek(J.seekTo); J.seekTo = null; }
        if (J.pauseAfterLoad && Player.state.playing) { P0.pause(); J.pauseAfterLoad = false; }
        if ((Player.state.rate || 1) !== (h.rate || 1)) Player.setRate(h.rate || 1);
        if (J.hold && Date.now() < J.hold) return;       // just pressed a button: give the host a moment
        // every pause button goes through the Jam, so a pause here came from the phone itself
        // (app in the background, call, etc.): keep following the host
        if (h.playing && !Player.state.playing && !Player.state.buffering) P0.play(true);
        if (!h.playing && Player.state.playing) P0.pause();
        const drift = Math.abs(Player.time() - target);
        if (h.playing && drift > (document.hidden ? 8 : 2.5)) Player.seek(target);
    }
    async function cmd(c, extra) {
        if (!J || J.host) return;
        if (c !== 'remove' && !J.control) { toast(`Only ${J.hostName || 'the host'} can control the music in this Jam`); return; }
        if (c === 'play' || c === 'pause') { J.hold = Date.now() + 2500; c === 'play' ? P0.play(true) : P0.pause(); }
        try { await call({ op: 'cmd', room: J.room, cmd: c, ...(extra || {}) }); setTimeout(memberLoop, 600); }
        catch (e) { toast(e.message, 'error'); }
    }
    async function add(t, next) {
        if (!J) return false;
        t = Catalog.normalize(t);
        if (t.pending) { try { await Player.resolvePending(t); } catch (e) {} }
        if (J.host) { t._by = myName(); next ? P0.playNext(t) : P0.addToQueue(t); return true; }
        try { await call({ op: 'add', room: J.room, track: slim(t), next: !!next }); toast(next ? 'Plays next in the Jam' : 'Added to the Jam', 'success'); setTimeout(memberLoop, 600); }
        catch (e) { toast(e.message, 'error'); }
        return true;
    }

    // buttons everywhere (player bar, island, notification, keyboard) go through here
    const guest = () => J && !J.host;
    Player.toggle = () => (guest() ? cmd(Player.state.playing ? 'pause' : 'play') : (setIntent(!Player.state.playing), P0.toggle()));
    Player.play = (...a) => (guest() ? cmd('play') : (setIntent(true), P0.play(...a)));
    Player.pause = () => (guest() ? cmd('pause') : (setIntent(false), P0.pause()));
    Player.next = (...a) => (guest() ? cmd('next') : (a[0] !== true && setIntent(true), P0.next(...a)));
    Player.prev = () => (guest() ? cmd('prev') : (setIntent(true), P0.prev()));
    Player.playNext = (t) => (guest() ? add(t, true) : (J && J.host && t && !t._by && (t._by = myName()), P0.playNext(t)));
    Player.addToQueue = (t) => (guest() ? add(t, false) : (J && J.host && t && !t._by && (t._by = myName()), P0.addToQueue(t)));
    Player.playList = (tracks, i = 0, src) => {
        if (!guest()) {
            if (J && J.host) { (tracks || []).forEach((t) => t && !t._by && (t._by = myName())); setIntent(true); }
            return P0.playList(tracks, i, src);
        }
        const t = (tracks || [])[i];
        if (t) add(t, false);
    };
    Player.jump = (i) => (guest() ? null : (setIntent(true), P0.jump(i)));
    if ('mediaSession' in navigator) {
        const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
        set('play', () => Player.play()); set('pause', () => Player.pause());
        set('previoustrack', () => Player.prev()); set('nexttrack', () => Player.next());
    }

    // ---------------- leaving / coming back ----------------
    function stop() {
        if (!J) return;
        clearInterval(J.timer);
        J = null; forget(); paint(); closePanel();
    }
    function leave(quiet) {
        if (!J) return;
        if (J.host) call({ op: 'end', room: J.room, token: J.token }).catch(() => {});
        else call({ op: 'leave', room: J.room }).catch(() => {});
        const wasHost = J.host;
        stop();
        if (!quiet) toast(wasHost ? 'You ended the Jam' : 'You left the Jam');
    }
    // Darcam was closed (or Android stopped it in the background): carry on with the same Jam
    setTimeout(() => {
        const s = LS.get(SAVE, null);
        if (!s || J || Date.now() - s.at > 8 * 3600e3) return;
        if (s.host) {
            J = hostState(s.room, s.token);
            J.intent = false;
            hostLoop().then(() => { if (!J) return; J.timer = setInterval(hostLoop, 1500); paint(); toast('Back in your Jam'); });
        } else join(s.room, true);
    }, 2500);

    // ---------------- screen ----------------
    const invite = () => (J ? (Site.base() ? Site.base() + '#/jam/' + J.room : '') : '');
    function paint() {
        let chip = document.getElementById('jamChip');
        if (!J) { if (chip) chip.remove(); document.body.classList.remove('in-jam'); return; }
        document.body.classList.add('in-jam');
        if (!chip) { chip = document.createElement('button'); chip.id = 'jamChip'; chip.className = 'jam-chip'; chip.onclick = openPanel; document.body.appendChild(chip); }
        const avs = J.members.slice(0, 4).map((m) => avatar(m.name, 'xs')).join('');
        chip.innerHTML = `<i class="jam-live"></i><span>Jam</span><span class="jam-avs">${avs}</span>${J.members.length > 4 ? `<span>+${J.members.length - 4}</span>` : ''}`;
    }
    let panelEl = null, progTimer = null;
    function openPanel() {
        if (!J) return;
        if (!panelEl) {
            panelEl = document.createElement('div');
            panelEl.className = 'jam-sheet';
            panelEl.innerHTML = `<div class="jam-back" data-jam="close"></div><aside class="jam-panel" role="dialog" aria-label="Jam"><div class="jam-body"></div></aside>`;
            document.body.appendChild(panelEl);
            panelEl.addEventListener('click', onPanelClick);
            panelEl.addEventListener('pointerdown', onGrip);
            panelEl.addEventListener('change', (e) => {
                if (!J || !J.host) return;
                if (e.target.id === 'jamControl') { J.control = e.target.checked; LS.set('dc_jam_control', J.control); toast(J.control ? 'Friends can play, pause and skip' : 'Only you can control the music'); }
                if (e.target.id === 'jamAuto') { J.autoplay = e.target.checked; LS.set('dc_jam_autoplay', J.autoplay); toast(J.autoplay ? 'Darcam adds suggested songs when the queue runs out' : 'No suggested songs: the music stops when the queue ends'); }
                hostLoop();
            });
            progTimer = setInterval(paintProgress, 500);
        }
        renderPanel(true);
        requestAnimationFrame(() => panelEl && panelEl.classList.add('show'));
    }
    function closePanel() { if (!panelEl) return; const x = panelEl; panelEl = null; clearInterval(progTimer); x.classList.remove('show'); setTimeout(() => x.remove(), 250); }
    function paintProgress() {
        if (!panelEl || !J) return;
        const bar = panelEl.querySelector('.jam-prog i'); if (!bar) return;
        const h = J.hostState || {};
        const dur = J.host ? Player.state.duration : ((J.track && J.track.dur) || 0);
        const pos = J.host ? Player.time() : (h.pos || 0) + (h.playing ? ((Date.now() - (h.at || Date.now())) / 1000) * (h.rate || 1) : 0);
        bar.style.width = (dur ? Math.min(100, (pos / dur) * 100) : 0) + '%';
        const tt = panelEl.querySelector('.jam-time'); if (tt) tt.textContent = `${fmtTime(pos)} / ${fmtTime(dur)}`;
    }
    function renderPanel(force) {
        if (!panelEl || !J || drag) return;
        const body = panelEl.querySelector('.jam-body');
        const canControl = J.host || J.control;
        const nowT = J.track;
        const playing = J.host ? J.intent : !!(J.hostState || {}).playing;
        const mine = (q) => q.by && q.by === myName();
        const byChip = (q) => q.by ? `<span class="jam-by" title="Added by ${esc(q.by)}">${avatar(q.by, 'xs')}<em>${esc(mine(q) ? 'You' : q.by)}</em></span>`
            : q.auto ? `<span class="jam-by jam-sug" title="Suggested by Darcam">${ic('sparkle')}<em>Suggested</em></span>` : '';
        const row = (q, i) => `<div class="jam-row ${canControl ? 'tap' : ''}" data-jam="jump" data-i="${i}" data-id="${esc(q.id)}">
            ${J.host ? `<span class="jam-grip" data-grip="${i}" title="Drag to reorder">${ic('grip')}</span>` : ''}
            <img class="jam-cv" src="${esc(q.cover || `https://i.ytimg.com/vi/${q.id}/mqdefault.jpg`)}" alt="" loading="lazy">
            <span class="jam-tx"><b>${esc(q.name)}</b><small>${esc(q.artist || '')}</small></span>
            ${byChip(q)}
            ${J.host || mine(q) ? `<button class="icon-btn sm" data-jam="remove" data-i="${i}" aria-label="Remove from queue">${ic('x')}</button>` : ''}</div>`;
        const html = `
            <header class="jam-head">
                <div><span class="jam-tag"><i class="jam-live"></i>JAM</span><h3>${esc(J.host ? myName() + '’s Jam' : (J.name || 'Jam'))}</h3></div>
                <button class="icon-btn" data-jam="close" aria-label="Close">${ic('x')}</button>
            </header>
            <div class="jam-people">
                ${J.members.map((m) => `<button class="jam-person ${J.host && !m.host ? 'can' : ''}" data-jam="person" data-id="${esc(m.id)}" data-name="${esc(m.name)}" title="${esc(m.name)}${m.host ? ' (host)' : ''}">${avatar(m.name, m.host ? 'host' : '')}<small>${esc(m.id === me ? 'You' : m.name)}</small>${m.host ? '<em class="jam-hostlbl">Host</em>' : ''}</button>`).join('')}
                <button class="jam-person add" data-jam="invite"><i class="jam-av plus">${ic('plus')}</i><small>Invite</small></button>
            </div>
            ${J.host ? `<div class="jam-switches">
                <label class="jam-switch"><span><b>Let friends control the music</b><small>Play, pause, skip and pick from the queue</small></span><input type="checkbox" class="switch" id="jamControl" ${J.control ? 'checked' : ''}></label>
                <label class="jam-switch"><span><b>Suggested songs</b><small>When the queue runs out, Darcam adds similar songs (marked Suggested)</small></span><input type="checkbox" class="switch" id="jamAuto" ${J.autoplay ? 'checked' : ''}></label></div>`
                : `<p class="jam-note">${J.control ? 'You can play, pause and skip for everyone. Songs you add show your name.' : `Only ${esc(J.hostName || 'the host')} can control the music. You can still add songs.`}</p>`}
            <div class="jam-sec">Now playing</div>
            ${nowT ? `<div class="jam-now">
                <img class="jam-cv lg" src="${esc(nowT.cover || `https://i.ytimg.com/vi/${nowT.id}/mqdefault.jpg`)}" alt="">
                <span class="jam-tx"><b>${esc(nowT.name)}</b><small>${esc(nowT.artist || '')}</small>${byChip(nowT)}</span>
                <div class="jam-prog"><i></i></div><span class="jam-time"></span>
                ${canControl ? `<span class="jam-ctl"><button class="icon-btn" data-jam="prev" aria-label="Previous">${ic('prev')}</button><button class="icon-btn jam-pp" data-jam="toggle" aria-label="${playing ? 'Pause' : 'Play'}">${ic(playing ? 'pause' : 'play')}</button><button class="icon-btn" data-jam="next" aria-label="Next">${ic('next')}</button></span>` : ''}
            </div>` : `<p class="jam-note">Nothing playing yet${J.host ? '. Play a song to start.' : '.'}</p>`}
            <div class="jam-sec">Up next <span>${J.queue.length ? J.queue.length + (J.queue.length === 1 ? ' song' : ' songs') : ''}${J.host && J.queue.length > 1 ? ' · drag ⠿ to reorder' : ''}</span></div>
            <div class="jam-q">${J.queue.length ? J.queue.map(row).join('') : '<p class="jam-note">The queue is empty. Add a song!</p>'}</div>
            <div class="jam-foot">
                <button class="btn primary" data-jam="add">${ic('plus')}<span>Add songs</span></button>
                <button class="btn ghost danger-t" data-jam="leave">${J.host ? 'End Jam' : 'Leave Jam'}</button>
            </div>`;
        if (force || body.dataset.h !== html) {
            const sc = body.scrollTop;
            body.innerHTML = html; body.dataset.h = html; hydrateIcons(body); body.scrollTop = sc;
        }
        paintProgress();
    }
    // host: drag a song by its ⠿ handle to change the order (mouse or finger)
    let drag = null;
    function onGrip(e) {
        const g = e.target.closest('[data-grip]');
        if (!g || !J || !J.host) return;
        e.preventDefault();
        const row = g.closest('.jam-row'), list = row.parentElement;
        const rows = [...list.querySelectorAll('.jam-row')];
        const from = +g.dataset.grip, h = row.getBoundingClientRect().height;
        drag = { from, to: from, y0: e.clientY, row, rows, h };
        row.classList.add('dragging');
        const move = (ev) => {
            if (!drag) return;
            const dy = ev.clientY - drag.y0;
            row.style.transform = `translateY(${dy}px)`;
            const to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / h)));
            if (to !== drag.to) {
                drag.to = to;
                rows.forEach((r, k) => { if (r === row) return; const shift = (from < to && k > from && k <= to) ? -h : (from > to && k < from && k >= to) ? h : 0; r.style.transform = shift ? `translateY(${shift}px)` : ''; });
            }
            const pr = panelEl.querySelector('.jam-body'), br = pr.getBoundingClientRect();   // scroll near the edges
            if (ev.clientY < br.top + 40) pr.scrollTop -= 8; else if (ev.clientY > br.bottom - 60) pr.scrollTop += 8;
        };
        const up = () => {
            window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
            const d = drag; drag = null;
            rows.forEach((r) => { r.style.transform = ''; r.classList.remove('dragging'); });
            if (d && d.to !== d.from) {
                const base = Player.state.index + 1;
                Player.move(base + d.from, base + d.to);
                J.queue = Player.state.queue.slice(base, base + 50).map(slim);
                J.justDragged = Date.now();
                hostLoop();
            }
            renderPanel(true);
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    }
    function onPanelClick(e) {
        const b = e.target.closest('[data-jam]'); if (!b || !J) return;
        if (J.justDragged && Date.now() - J.justDragged < 400) return;
        if (e.target.closest('[data-grip]')) return;
        const a = b.dataset.jam;
        if (a === 'close') closePanel();
        if (a === 'invite') showInvite();
        if (a === 'leave') { if (J.host) UI.confirmModal('End the Jam?', 'The music stops following you on everyone’s device.', 'End Jam', () => leave()); else leave(); }
        if (a === 'add') { closePanel(); if (UI.closeNP) UI.closeNP(); location.hash = '#/search'; toast('Songs you pick now go into the Jam'); }
        if (a === 'toggle') Player.toggle();
        if (a === 'next') Player.next();
        if (a === 'prev') Player.prev();
        if (a === 'person' && J.host && b.classList.contains('can')) {
            UI.openMenu(b, [{ icon: 'x', label: 'Remove ' + b.dataset.name + ' from the Jam', danger: true, run: () => kick(b.dataset.id, b.dataset.name) }]);
            return;
        }
        if (a === 'remove') {
            e.stopPropagation();
            const i = +b.dataset.i, q = J.queue[i];
            if (J.host) { Player.removeAt(Player.state.index + 1 + i); }
            else if (q) { cmd('remove', { id: q.id, i, name: q.name }); J.queue.splice(i, 1); renderPanel(true); }
            return;
        }
        if (a === 'jump' && !e.target.closest('[data-jam="remove"]')) {
            const i = +b.dataset.i;
            if (J.host) Player.jump(Player.state.index + 1 + i);
            else if (J.control) cmd('jump', { id: b.dataset.id, i });
            else toast(`Only ${J.hostName || 'the host'} can pick songs in this Jam`);
        }
    }
    async function kick(id, name) {
        try { const r = await call({ op: 'kick', room: J.room, token: J.token, who: id }); J.members = r.members || J.members.filter((m) => m.id !== id); renderPanel(true); paint(); toast(name + ' was removed from the Jam'); }
        catch (e) { toast(e.message, 'error'); }
    }
    function showInvite() {
        if (!J) return;
        const link = invite();
        const qr = (() => { try { const q = qrcode(0, 'M'); q.addData(link || J.room); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { return ''; } })();
        UI.modal(`<h3>Invite friends</h3>
            <p class="muted small">Friends scan this with their camera, open the link, or type the code in Library → Listen together.</p>
            <div class="jam-box"><div class="jam-qr">${qr}</div>
                <div class="jam-info"><small>Code</small><b class="jam-code">${esc(J.room)}</b>
                ${link ? `<button class="btn primary sm" data-inv="copy">${ic('link')}<span>Copy link</span></button>${navigator.share ? `<button class="btn ghost sm" data-inv="share">${ic('share')}<span>Share</span></button>` : ''}` : ''}</div></div>
            <div class="modal-actions"><button class="btn ghost" data-close>Done</button></div>`, (m) => {
            const c = m.querySelector('[data-inv="copy"]'); if (c) c.onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Link copied', 'success'); } catch (e) {} };
            const s = m.querySelector('[data-inv="share"]'); if (s) s.onclick = () => navigator.share({ title: 'Join my Jam on Darcam', text: 'Listen with me on Darcam. Code: ' + J.room, url: link }).catch(() => {});
        });
    }
    async function checkSetup() {
        const url = Site.api('jam.php');
        if (!url) return 'Add your Darcam website in Settings → Sharing & Jam first.';
        try {
            const r = await fetch(url, { cache: 'no-store' });
            const j = await r.json();
            if (j.storage === 'memory' && j.vercel) return 'Jam isn’t set up on your Darcam website yet. In Vercel, open your project → Storage → connect Upstash (Redis), then Redeploy.';
            if (j.storage === 'redis-error') return 'Your website can’t reach Upstash right now. Check Storage in your Vercel project.';
        } catch (e) { /* older websites have no health check */ }
        return '';
    }
    function menu() {
        if (J) return openPanel();
        checkSetup().then((warn) => { const w = document.querySelector('#modal [data-jamwarn]'); if (w && warn) { w.textContent = warn; w.hidden = false; } });
        UI.modal(`<h3>Listen together</h3>
            <p class="muted small">Start a Jam: friends hear what you play, in sync, on their own phone or PC. Everyone can add songs to one shared queue.</p>
            <p class="jam-warn" data-jamwarn hidden></p>
            <button class="btn primary" data-jam="start" style="width:100%;margin:10px 0">${ic('users')}<span>Start a Jam</span></button>
            <form data-f class="jam-join"><input class="field" name="code" placeholder="Code from a friend" maxlength="8" autocomplete="off" style="text-transform:uppercase"><button class="btn" type="submit">Join</button></form>
            <div class="modal-actions"><button class="btn ghost" data-close>Close</button></div>`, (m, close) => {
            m.querySelector('[data-jam="start"]').onclick = () => { close(); start(); };
            m.querySelector('[data-f]').onsubmit = (e) => { e.preventDefault(); const v = e.target.elements.code.value; close(); join(v); };
        });
    }
    return { start, join, leave, add, menu, panel: openPanel, get active() { return !!J; }, get host() { return !!(J && J.host); }, get autoplay() { return !J || !J.host || J.autoplay; } };
})();
