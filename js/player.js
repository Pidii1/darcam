/* Darcam — playback engine + queue.
   The engine iframe stays out of sight; UI only ever talks to Player. */
'use strict';

const Player = (() => {
    const P = {
        queue: [], index: -1, original: null,
        shuffle: false, smart: false, repeat: 0,          // 0 off · 1 all · 2 one
        playing: false, buffering: false,
        source: null,                       // {type, id, name} — "Playing from …"
        duration: 0, ready: false,
        volume: Store.settings.volume ?? 80, muted: false,
        rate: 1,                            // playback speed (per song)
    };
    let yt = null, spare = null, pendingId = null, lastT = 0, lastAt = 0, errorSkipTimer = null, radioLoading = false;

    const current = () => P.queue[P.index] || null;

    // ---------- engine ----------
    function boot() {
        if (window.YT && window.YT.Player) return create();
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        s.onerror = () => Bus.emit('toast', { msg: 'Can’t reach the music service. Check your internet.', type: 'error' });
        document.head.appendChild(s);
        window.onYouTubeIframeAPIReady = create;
    }

    // Two players take turns: the second one lets the next song fade in (crossfade).
    function create() {
        const vars = { autoplay: 1, cc_load_policy: 0, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, rel: 0, playsinline: 1, enablejsapi: 1 };
        if (/^https?:/.test(location.protocol)) vars.origin = location.origin;
        const a = new YT.Player('engineFrame', {
            width: '100%', height: '100%', playerVars: vars,
            events: {
                onReady: () => {
                    P.ready = true; a._ready = true;
                    try { yt.setVolume(P.volume); P.muted ? yt.mute() : yt.unMute(); } catch (e) {}
                    if (pendingId) { const id = pendingId; pendingId = null; yt.loadVideoById(id); }
                    Bus.emit('engine-ready');
                },
                onStateChange: (e) => (e.target === yt ? onState(e.data) : onSpareState(e.target, e.data)),
                onError: (e) => (e.target === yt ? onError(e.data) : onSpareError(e.target)),
            },
        });
        yt = a;
        if (document.getElementById('engineFrame2')) {
            const b = new YT.Player('engineFrame2', {
                width: '100%', height: '100%', playerVars: { ...vars, autoplay: 0 },
                events: {
                    onReady: () => { b._ready = true; },
                    onStateChange: (e) => (e.target === yt ? onState(e.data) : onSpareState(e.target, e.data)),
                    onError: (e) => (e.target === yt ? onError(e.data) : onSpareError(e.target)),
                },
            });
            spare = b;
        }
    }

    // ---------- crossfade ----------
    // xf: { from, to, idx, track, start, dur, phase: 'loading' | 'fading' }
    let xf = null, volTimer = null;
    const xfSecs = () => { const v = parseFloat(Store.settings.crossfade); return isFinite(v) ? v : 0; };
    const slotOf = (pl) => { try { return pl.getIframe().parentElement; } catch (e) { return null; } };
    function showSlot(pl) {
        document.querySelectorAll('#engine .eng-slot').forEach((el) => el.classList.toggle('on', el === slotOf(pl)));
    }
    const vol = (pl, v) => { try { if (P.muted) pl.mute(); else { pl.unMute(); pl.setVolume(Math.round(v)); } } catch (e) {} };

    function startCrossfade() {
        const idx = P.index + 1 < P.queue.length ? P.index + 1 : (P.repeat === 1 ? 0 : -1);
        const t = P.queue[idx];
        if (!t || t.pending || !spare || !spare._ready) return false;
        const known = blocked()[t.id];
        if (known && (!t.youtube_id || t.youtube_id === t.id)) t.youtube_id = known;
        xf = { from: yt, to: spare, idx, track: t, dur: xfSecs(), phase: 'loading' };
        try { spare.setVolume(0); spare.mute(); spare.loadVideoById(t.youtube_id || t.id); } catch (e) { xf = null; return false; }
        return true;
    }
    function onSpareState(pl, s) {
        if (!xf || pl !== xf.to) return;
        if (s === YT.PlayerState.PLAYING && xf.phase === 'loading') beginFade();
    }
    function onSpareError(pl) {
        // the next song can't play here: no crossfade, the normal "song ended" path will handle it
        if (xf && pl === xf.to) { try { pl.stopVideo(); } catch (e) {} xf = null; }
    }
    function beginFade() {
        const f = xf; f.phase = 'fading'; f.start = performance.now();
        // the new song becomes the current one now (title, lyrics, island, notification)
        yt = f.to; spare = f.from;
        P.index = f.idx;
        P.duration = (f.track.duration_ms || 0) / 1000;
        lastT = 0; lastAt = performance.now();
        P.playing = true; P.buffering = false;
        showSlot(yt);
        Store.pushRecent(f.track);
        Bus.emit('track', f.track); Bus.emit('state', P); Bus.emit('queue', P);
        updateMediaSession(true);
        clearInterval(volTimer);
        volTimer = setInterval(stepFade, 50);
        stepFade();
    }
    function stepFade() {
        const f = xf; if (!f || f.phase !== 'fading') { clearInterval(volTimer); return; }
        const k = Math.min(1, (performance.now() - f.start) / (f.dur * 1000));
        // equal-power curve: no dip in loudness in the middle
        vol(f.to, P.volume * Math.sin(k * Math.PI / 2));
        vol(f.from, P.volume * Math.cos(k * Math.PI / 2));
        if (k >= 1) finishFade();
    }
    function finishFade() {
        const f = xf; xf = null; clearInterval(volTimer);
        if (!f) return;
        try { f.from.stopVideo(); } catch (e) {}
        vol(f.to, P.volume);
    }
    // user action during a crossfade: settle it straight away
    function settleFade() {
        if (!xf) return;
        if (xf.phase === 'loading') { try { xf.to.stopVideo(); } catch (e) {} xf = null; return; }
        finishFade();
    }
    // watch the clock: start the fade a few seconds before the end
    setInterval(() => {
        const cf = xfSecs();
        if (!cf || xf || !P.ready || !P.playing || P.repeat === 2) return;
        const d = P.duration, t = time();
        if (!d || d < cf * 2 + 20) return;
        const left = d - t;
        if (left <= cf + 25 && P.index >= P.queue.length - 1 && P.repeat !== 1) ensureMore();   // autoplay: get the next songs early
        if (left <= cf && left > 0.5) startCrossfade();
    }, 250);

    function onState(s) {
        const S = YT.PlayerState;
        if (s === S.PLAYING) {
            P.playing = true; P.buffering = false;
            try { yt.unloadModule('captions'); yt.unloadModule('cc'); } catch (e) {}
            try { if (Math.abs((yt.getPlaybackRate() || 1) - P.rate) > 0.01) yt.setPlaybackRate(P.rate); } catch (e) {}
            const d = yt.getDuration(); if (d) P.duration = d;
            syncTime();
        } else if (s === S.PAUSED) {
            P.playing = false; P.buffering = false; syncTime();
            keepAlive();
        } else if (s === S.BUFFERING) {
            P.buffering = true; syncTime();
        } else if (s === S.ENDED) {
            P.playing = false; P.buffering = false;
            if (P.repeat === 2) { seek(0); play(); } else next(true);
        } else if (s === S.CUED) {
            P.buffering = false;
        }
        Bus.emit('state', P);
        updateMediaSession();
    }

    // Android: when you leave the app, the system can pause the song by itself.
    // If the song stops without you pressing pause, start it again (a few tries, only right after leaving the app).
    let userPauseAt = 0, hiddenAt = 0, revive = [];
    const isApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    const markHidden = () => { hiddenAt = Date.now(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) markHidden(); });
    window.addEventListener('blur', markHidden);
    window.addEventListener('pagehide', markHidden);
    try { const A = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App; if (A && A.addListener) A.addListener('pause', markHidden); } catch (e) {}
    function keepAlive() {
        if (!isApp() || !current()) return;
        const now = Date.now();
        if (now - userPauseAt < 2000) return;                       // you pressed pause
        if (!(document.hidden || now - hiddenAt < 6000)) return;    // only when you have just left the app
        revive = revive.filter((t) => now - t < 20000);
        if (revive.length >= 4) return;                             // don't fight forever
        revive.push(now);
        setTimeout(() => { try { if (!P.playing && Date.now() - userPauseAt > 2000 && yt) yt.playVideo(); } catch (e) {} }, 350);
    }

    // Blocked song → quietly play another allowed version of the same song
    const BLOCK_KEY = 'dc_blocked';
    const blocked = () => LS.get(BLOCK_KEY, {});
    function remember(id, alt) { const b = blocked(); b[id] = alt || 0; const k = Object.keys(b); if (k.length > 800) delete b[k[0]]; LS.set(BLOCK_KEY, b); }
    let fixing = null;

    async function onError(code) {
        const t = current();
        if (!t) return;
        const tried = (t._tried = t._tried || []);
        const failedId = t.youtube_id || t.id;
        if (!tried.includes(failedId)) tried.push(failedId);
        console.warn('engine error', code, failedId);
        if (fixing === t) return;
        fixing = t;
        try {
            if (!t._alts) {
                Bus.emit('toast', { msg: 'Finding another version of this song…' });
                t._alts = await Catalog.alternatives(t, tried);
            }
            if (current() !== t) return;
            const alt = t._alts.find((a) => !tried.includes(a.id) && blocked()[a.id] === undefined);
            if (alt) {
                tried.push(alt.id);
                t.youtube_id = alt.id;                     // keep the song's own name, cover and lyrics
                if (alt.duration_ms) t.duration_ms = alt.duration_ms;
                remember(t.id, alt.id);
                fixing = null;
                P.duration = (t.duration_ms || 0) / 1000;
                lastT = 0; lastAt = performance.now(); P.buffering = true;
                if (P.ready && yt) yt.loadVideoById(alt.id);
                Bus.emit('state', P);
                return;
            }
        } catch (e) { console.warn(e); }
        fixing = null;
        remember(t.id, 0);
        Bus.emit('toast', { msg: 'This song can’t be played here. Playing the next one…', type: 'error' });
        clearTimeout(errorSkipTimer);
        errorSkipTimer = setTimeout(() => { if (current() === t) next(true); }, 900);
    }

    function syncTime() {
        try { lastT = yt.getCurrentTime() || 0; lastAt = performance.now(); } catch (e) {}
    }
    // Smooth, interpolated time for lyrics + progress
    function time() {
        if (!P.ready || !yt) return 0;
        if (P.playing && !P.buffering) {
            const est = lastT + ((performance.now() - lastAt) / 1000) * (P.rate || 1);
            return P.duration ? Math.min(est, P.duration) : est;
        }
        return lastT;
    }
    setInterval(() => { if (P.ready && yt && (P.playing || P.buffering)) { syncTime(); const d = yt.getDuration && yt.getDuration(); if (d) P.duration = d; } }, 400);

    // ---------- transport ----------
    // Imported songs only have a title + artist until first played
    const RES_KEY = 'dc_resolved';
    const resolving = {};
    function resolvePending(t) {
        if (!t || !t.pending) return Promise.resolve(t);
        const old = t.id;
        const map = LS.get(RES_KEY, {});
        const done = (f) => {
            if (!f) return null;
            const fields = { id: f.id, youtube_id: f.youtube_id || f.id, cover: f.cover, cover_lg: f.cover_lg, channelId: f.channelId || '', duration_ms: f.duration_ms || t.duration_ms, kind: f.kind || 'song', _n: 1 };
            Object.assign(t, fields); delete t.pending;
            const m = LS.get(RES_KEY, {}); m[old] = fields; LS.set(RES_KEY, m);
            Store.resolvePending(old, t);
            return t;
        };
        if (map[old]) return Promise.resolve(done(map[old]));
        if (resolving[old]) return resolving[old].then(() => { const m = LS.get(RES_KEY, {}); return m[old] ? done(m[old]) : null; });
        resolving[old] = Catalog.resolve(t).catch(() => null).then((f) => { delete resolving[old]; return done(f) ? t : null; });
        return resolving[old];
    }
    async function load(t) {
        if (!t) return;
        settleFade();
        if (t.pending) {
            P.duration = (t.duration_ms || 0) / 1000; lastT = 0; lastAt = performance.now();
            P.buffering = true; P.playing = false;
            Bus.emit('track', t); Bus.emit('state', P); Bus.emit('queue', P);
            const ok = await resolvePending(t);
            if (current() !== t) return;
            if (!ok) {
                P.buffering = false; Bus.emit('state', P);
                Bus.emit('toast', { msg: `Couldn’t find “${t.name}”. Playing the next one…`, type: 'error' });
                setTimeout(() => { if (current() === t) next(true); }, 800);
                return;
            }
        }
        // playback speed remembered for this song
        P.rate = rateFor(t);
        // match the next imported song in the background so it starts right away
        const nx = P.queue[P.index + 1]; if (nx && nx.pending) setTimeout(() => resolvePending(nx), 4000);
        P.duration = (t.duration_ms || 0) / 1000;
        lastT = 0; lastAt = performance.now();
        P.buffering = true; P.playing = false;
        const known = blocked()[t.id];
        if (known && (!t.youtube_id || t.youtube_id === t.id)) t.youtube_id = known;
        const id = t.youtube_id || t.id;
        if (P.ready && yt) yt.loadVideoById(id); else pendingId = id;
        Store.pushRecent(t);
        Bus.emit('track', t);
        Bus.emit('state', P);
        Bus.emit('queue', P);
        updateMediaSession(true);
    }

    // what the player is really doing (P.playing can lag behind when the app is in the background)
    function engineState() { try { return yt.getPlayerState(); } catch (e) { return -1; } }
    function play(check) {
        settleFade();
        if (!P.ready || !yt) return;
        if (!current()) return;
        try { if (!P.muted) { yt.unMute(); yt.setVolume(P.volume); } } catch (e) {}
        yt.playVideo();
        if (!check) return;
        // started from outside the app (island / notification): if Android didn't let it start,
        // start it muted (always allowed) and turn the sound back on once it plays
        const t0 = time(), cur = current();
        setTimeout(() => {
            if (current() !== cur) return;
            const st = engineState();
            if (st === 1) return;
            if (st === 3) {
                // stuck loading: ask for the same spot again
                setTimeout(() => {
                    if (current() !== cur || engineState() === 1) return;
                    try { yt.loadVideoById(cur.youtube_id || cur.id, Math.max(0, t0 - 0.5)); } catch (e) {}
                }, 1800);
                return;
            }
            if (st === -1 || st === 5) {
                // the video was let go (long pause in the background): load it again at the same spot
                try { yt.loadVideoById(cur.youtube_id || cur.id, Math.max(0, t0 - 0.5)); } catch (e) {}
                return;
            }
            try { yt.mute(); yt.playVideo(); } catch (e) {}
            setTimeout(() => { try { if (!P.muted) { yt.unMute(); yt.setVolume(P.volume); } } catch (e) {} }, 500);
        }, 1200);
    }
    function pause() { userPauseAt = Date.now(); settleFade(); if (P.ready && yt) yt.pauseVideo(); }
    function toggle() {
        if (!current()) { Bus.emit('toast', { msg: 'Pick a song first' }); return; }
        const st = engineState();
        const on = st === 1 || st === 3 || (st === -1 && P.playing);
        on ? pause() : play(true);
    }
    function seek(sec) {
        if (!P.ready || !yt) return;
        settleFade();
        sec = clamp(sec, 0, P.duration || sec);
        yt.seekTo(sec, true); lastT = sec; lastAt = performance.now();
        Bus.emit('seek', sec);
        updateMediaSession();
    }

    // Autoplay: add similar songs to the end of the queue (true when something was added)
    let morePromise = null;
    function ensureMore() {
        if (!Store.settings.autoplay || !current()) return Promise.resolve(false);
        if (P.index < P.queue.length - 1) return Promise.resolve(true);
        if (P.source && P.source.type === 'jam' && typeof Jam !== 'undefined' && Jam.active && !Jam.host) return Promise.resolve(false);   // in a friend's Jam the host picks the next song
        if (typeof Jam !== 'undefined' && Jam.active && Jam.host && !Jam.autoplay) return Promise.resolve(false);   // host turned off suggested songs
        if (morePromise) return morePromise;
        radioLoading = true;
        morePromise = (async () => {
            try {
                const more = await Catalog.radio(current(), { exclude: P.queue.map((q) => q.id) });
                const fresh = more.filter((t) => !P.queue.some((q) => q.id === t.id)).slice(0, 15);
                fresh.forEach((t) => (t._auto = true));     // shown as "Suggested" in a Jam
                if (!fresh.length) return false;
                P.queue.push(...fresh);
                if (P.original) P.original.push(...fresh);
                Bus.emit('queue', P);
                return true;
            } catch (e) { console.warn(e); return false; }
            finally { radioLoading = false; setTimeout(() => (morePromise = null), 0); }
        })();
        return morePromise;
    }

    async function next(auto = false) {
        if (!P.queue.length) return;
        if (P.index < P.queue.length - 1) { P.index++; return load(current()); }
        if (P.repeat === 1) { P.index = 0; return load(current()); }
        if (await ensureMore()) {
            P.index++; load(current());
            if (auto) Bus.emit('toast', { msg: 'Autoplay: more from this artist and songs with the same vibe' });
            return;
        }
        if (!auto) Bus.emit('toast', { msg: 'End of the queue' });
        pause();
    }

    function prev() {
        if (!current()) return;
        if (time() > 3 || P.index === 0) return seek(0);
        P.index--; load(current());
    }

    // ---------- queue ----------
    function playList(tracks, startIndex = 0, source = null) {
        tracks = (tracks || []).filter(Boolean).map(Catalog.normalize);
        if (!tracks.length) return;
        P.source = source;
        P.original = null;
        if (P.shuffle) {
            const first = tracks[startIndex];
            const rest = shuffleArr(tracks.filter((_, i) => i !== startIndex));
            P.original = tracks.slice();
            P.queue = [first, ...rest]; P.index = 0;
        } else { P.queue = tracks.slice(); P.index = clamp(startIndex, 0, tracks.length - 1); }
        load(current());
        if (P.smart) applySmart();
    }
    function playNext(t) {
        t = Catalog.normalize(t);
        if (!current()) return playList([t], 0);
        P.queue.splice(P.index + 1, 0, t);
        if (P.original) P.original.push(t);
        Bus.emit('queue', P);
        Bus.emit('toast', { msg: 'Playing next' });
    }
    function addToQueue(t) {
        t = Catalog.normalize(t);
        if (!current()) return playList([t], 0);
        P.queue.push(t);
        if (P.original) P.original.push(t);
        Bus.emit('queue', P);
        Bus.emit('toast', { msg: 'Added to queue' });
    }
    function jump(i) { if (i >= 0 && i < P.queue.length) { P.index = i; load(current()); } }
    function removeAt(i) {
        if (i === P.index || i < 0 || i >= P.queue.length) return;
        const [t] = P.queue.splice(i, 1);
        if (i < P.index) P.index--;
        if (P.original) P.original = P.original.filter((x) => x.id !== t.id);
        Bus.emit('queue', P);
    }
    // ---------- playback speed ----------
    const RATE_KEY = 'dc_rate';
    function rateFor(t) { const m = LS.get(RATE_KEY, {}); const r = t && m[t.youtube_id || t.id]; return r || 1; }
    function setRate(r) {
        r = Math.max(0.5, Math.min(2, Math.round(r * 100) / 100));
        syncTime();
        P.rate = r;
        try { if (yt) yt.setPlaybackRate(r); } catch (e) {}
        const t = current();
        if (t) { const m = LS.get(RATE_KEY, {}); const k = t.youtube_id || t.id; if (r === 1) delete m[k]; else m[k] = r; const ks = Object.keys(m); if (ks.length > 500) delete m[ks[0]]; LS.set(RATE_KEY, m); }
        lastAt = performance.now();
        Bus.emit('rate', P);
    }

    // drag in the queue: move an upcoming song to another upcoming spot
    function move(from, to) {
        if (from === to || from <= P.index || to <= P.index || from >= P.queue.length || to >= P.queue.length) return;
        const [t] = P.queue.splice(from, 1);
        P.queue.splice(to, 0, t);
        Bus.emit('queue', P);
    }
    function clearUpcoming() { P.queue = P.queue.slice(0, P.index + 1); P.original = null; Bus.emit('queue', P); }

    // Smart Shuffle: shuffle + songs with the same vibe mixed in
    let smartTok = 0;
    async function applySmart() {
        const base = (P.original || P.queue).filter((t) => !t.smart);
        if (!base.length) return;
        const tok = ++smartTok;
        const seeds = shuffleArr(base.filter((t) => !t.pending).slice()).slice(0, 3);
        const seedList = seeds.length ? seeds : base.slice(0, 3);
        let recs = [];
        try { recs = await Catalog.vibe(seedList, { limit: 30 }); } catch (e) { console.warn(e); }
        if (tok !== smartTok || !P.smart) return;
        const have = new Set(P.queue.map((t) => t.id));
        recs = recs.filter((t) => !have.has(t.id)).map((t) => ({ ...Catalog.normalize(t), smart: true }));
        if (!recs.length) { Bus.emit('toast', { msg: 'No recommendations right now' }); return; }
        const up = P.queue.slice(P.index + 1); const out = []; let r = 0;
        up.forEach((t, i) => { out.push(t); if ((i + 1) % 3 === 0 && r < recs.length) out.push(recs[r++]); });
        while (r < recs.length && out.length < Math.max(8, Math.round(up.length * 1.35))) out.push(recs[r++]);
        P.queue = P.queue.slice(0, P.index + 1).concat(out);
        Bus.emit('queue', P);
    }
    function removeSmart() {
        smartTok++;
        const cur = current();
        P.queue = P.queue.filter((t) => !t.smart || t === cur);
        P.index = cur ? P.queue.indexOf(cur) : -1;
    }
    function playSmart(tracks, source) {
        P.shuffle = true; P.smart = true;
        tracks = (tracks || []).filter(Boolean);
        if (!tracks.length) return;
        playList(tracks, Math.floor(Math.random() * tracks.length), source);
        Bus.emit('mode', P);
        Bus.emit('toast', { msg: 'Smart Shuffle: adding songs that fit this playlist' });
    }
    function toggleShuffle() {
        // off → shuffle → smart shuffle → off
        if (P.shuffle && !P.smart) {
            P.smart = true;
            Bus.emit('mode', P);
            Bus.emit('toast', { msg: 'Smart Shuffle on: adding songs with the same vibe' });
            applySmart();
            return;
        }
        if (P.smart) { P.smart = false; removeSmart(); }
        P.shuffle = !P.shuffle;
        const cur = current();
        if (P.shuffle) {
            P.original = P.queue.slice();
            const rest = shuffleArr(P.queue.filter((_, i) => i !== P.index));
            P.queue = cur ? [cur, ...rest] : rest; P.index = cur ? 0 : -1;
        } else if (P.original) {
            P.queue = P.original; P.original = null;
            P.index = cur ? P.queue.findIndex((t) => t.id === cur.id) : -1;
        }
        Bus.emit('mode', P); Bus.emit('queue', P);
        Bus.emit('toast', { msg: P.shuffle ? 'Shuffle on' : 'Shuffle off' });
        Bus.emit('mode', P);
    }
    function cycleRepeat() {
        P.repeat = (P.repeat + 1) % 3;
        Bus.emit('mode', P);
        Bus.emit('toast', { msg: ['Repeat off', 'Repeat all', 'Repeat one'][P.repeat] });
    }

    function setVolume(v) {
        P.volume = Math.round(clamp(v, 0, 100));
        P.muted = P.volume === 0;
        settleFade();
        if (P.ready && yt) { try { yt.setVolume(P.volume); P.muted ? yt.mute() : yt.unMute(); } catch (e) {} }
        Store.setSetting('volume', P.volume || Store.settings.volume);
        Bus.emit('volume', P);
    }
    let volBeforeMute = P.volume || 80;
    function toggleMute() {
        if (P.muted || P.volume === 0) { setVolume(volBeforeMute || 60); }
        else { settleFade(); volBeforeMute = P.volume; P.muted = true; if (yt && P.ready) yt.mute(); Bus.emit('volume', P); }
    }

    // ---------- lock screen / notification / Windows media controls ----------
    function updateMediaSession(newTrack) {
        if (!('mediaSession' in navigator)) return;
        const t = current();
        const ms = navigator.mediaSession;
        try {
            if (t && newTrack === true && !window.DarcamBridge) {
                const art = T.coverLg(t) || T.cover(t);
                ms.metadata = new MediaMetadata({
                    title: T.title(t), artist: T.artist(t), album: (P.source && P.source.name) || 'Darcam',
                    artwork: [
                        { src: T.cover(t), sizes: '320x180', type: 'image/jpeg' },
                        { src: art, sizes: '1280x720', type: 'image/jpeg' },
                    ],
                });
            }
            ms.playbackState = P.playing ? 'playing' : 'paused';
            if (P.duration && ms.setPositionState) ms.setPositionState({ duration: P.duration, playbackRate: 1, position: clamp(time(), 0, P.duration) });
        } catch (e) {}
    }
    if ('mediaSession' in navigator) {
        const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
        set('play', play); set('pause', pause);
        set('previoustrack', prev); set('nexttrack', () => next());
        set('seekto', (d) => seek(d.seekTime));
        set('seekbackward', (d) => seek(time() - (d.seekOffset || 10)));
        set('seekforward', (d) => seek(time() + (d.seekOffset || 10)));
    }

    return {
        state: P, current, time, boot,
        play, pause, toggle, seek, next, prev,
        playList, playNext, addToQueue, jump, removeAt, clearUpcoming, move, setRate,
        toggleShuffle, playSmart, resolvePending, cycleRepeat, setVolume, toggleMute,
        get engine() { return yt; },
    };
})();
