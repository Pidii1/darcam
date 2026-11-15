/* Darcam — bridge to everything outside the app window:
   · the system media notification / lock screen / Windows media flyout (Media Session)
   · the native Dynamic Island on Android (Capacitor plugin "DarcamIsland")
   · the floating Dynamic Island window on Windows (Electron preload "darcamNative")
   It sends the song, play state, progress and the current lyric line. */
'use strict';

const DarcamBridge = (() => {
    let last = {}, lastMetaKey = '';
    const cap = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.DarcamIsland;
    const ele = () => window.darcamNative;

    function snapshot() {
        const t = Player.current(), P = Player.state;
        const time = Player.time();
        const ly = t && Store.settings.lyricsInNotif ? Lyrics.lineAt(time) : { cur: '', next: '' };
        return {
            has: !!t,
            id: t ? t.id : '',
            title: t ? T.title(t) : '',
            artist: t ? T.artist(t) : '',
            cover: t ? T.cover(t) : '',
            coverLg: t ? T.coverLg(t) : '',
            playing: !!P.playing,
            buffering: !!P.buffering,
            position: time,
            duration: P.duration || 0,
            lyric: ly.cur || '',
            nextLyric: ly.next || '',
            lyricProgress: ly.progress || 0,
            words: ly.words || null,
            liked: t ? Store.isLiked(t.id) : false,
            tint: getComputedStyle(document.documentElement).getPropertyValue('--tint').trim(),
        };
    }

    function updateMeta(s) {
        if (!('mediaSession' in navigator) || !s.has) return;
        const line = Store.settings.lyricsInNotif && s.lyric && s.lyric !== '♪' ? s.lyric : '';
        const key = s.id + '|' + line;
        if (key === lastMetaKey) return;
        lastMetaKey = key;
        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: s.title,
                artist: line ? '♪ ' + line : s.artist,
                album: line ? s.artist : ((Player.state.source && Player.state.source.name) || 'Darcam'),
                artwork: [
                    { src: s.cover, sizes: '320x180', type: 'image/jpeg' },
                    { src: s.coverLg, sizes: '1280x720', type: 'image/jpeg' },
                ],
            });
        } catch (e) {}
    }

    function push(force) {
        const s = snapshot();
        const changed = force || s.id !== last.id || s.playing !== last.playing || s.lyric !== last.lyric || s.buffering !== last.buffering || s.liked !== last.liked || Math.abs((s.lyricProgress || 0) - (last.lyricProgress || 0)) > 0.04;
        const pos = Math.abs((s.position || 0) - (last.position || 0)) > 0.9;
        if (!changed && !pos) return;
        last = s;
        updateMeta(s);
        Bus.emit('island', s);
        try { if (cap()) cap().update(s); } catch (e) {}
        try { if (ele() && ele().island) ele().island(s); } catch (e) {}
    }

    // Commands coming back from the island / notification
    // small log of commands from outside the app (Settings → Dynamic Island → Island log)
    const est = () => { try { return Player.engine ? Player.engine.getPlayerState() : 'none'; } catch (e) { return 'err'; } };
    function logCmd(c) {
        const row = { at: new Date().toTimeString().slice(0, 8), c: typeof c === 'string' ? c : JSON.stringify(c), before: est(), was: Player.state.playing ? 'playing' : 'paused' };
        setTimeout(() => {
            row.after = est(); row.now = Player.state.playing ? 'playing' : 'paused';
            const l = LS.get('dc_ilog', []); l.unshift(row); LS.set('dc_ilog', l.slice(0, 15));
            push(true);
        }, 1600);
    }
    function command(c) {
        logCmd(c);
        if (c === 'toggle') Player.toggle();
        else if (c === 'play') Player.play(true);
        else if (c === 'pause') Player.pause();
        else if (c === 'next') Player.next();
        else if (c === 'prev') Player.prev();
        else if (c === 'open') UI.openNP('lyrics');
        else if (c === 'like') UI.toggleLike(Player.current());
        else if (c && c.seek != null) Player.seek(c.seek);
    }
    try { if (ele() && ele().onCommand) ele().onCommand(command); } catch (e) {}
    try { if (cap() && cap().addListener) cap().addListener('command', (d) => command(d && d.action === 'seek' ? { seek: d.value } : d && d.action)); } catch (e) {}

    // First song on Android: ask for notifications + "display over other apps" (for the island)
    let asked = false;
    async function firstRunPermissions() {
        if (asked || !cap()) return;
        asked = true;
        try { await cap().requestNotifications(); } catch (e) {}
        if (LS.get('dc_island_asked', false)) return;
        try {
            const st = await cap().status();
            if (st.overlay) return;
            LS.set('dc_island_asked', true);
            UI.modal(`<h3>Turn on Dynamic Island?</h3>
                <p class="muted">When you leave Darcam, the song and its lyrics show at the top of your screen. Android needs the <b>“Display over other apps”</b> permission for this.</p>
                <div class="modal-actions"><button class="btn ghost" data-close>Not now</button><button class="btn primary" data-ok>Allow</button></div>`,
                (m, close) => { m.querySelector('[data-ok]').onclick = () => { close(); cap().requestOverlay(); }; });
        } catch (e) {}
    }
    Bus.on('track', () => setTimeout(firstRunPermissions, 1500));

    Bus.on('track', () => { lastMetaKey = ''; setTimeout(() => push(true), 50); });
    Bus.on('state', () => push());
    setInterval(push, 200);

    const islandApi = {
        native: () => !!(cap() || (ele() && ele().island)),
        async status() {
            if (cap()) { try { return await cap().status(); } catch (e) { return { overlay: false, enabled: true }; } }
            if (ele() && ele().islandStatus) { try { return await ele().islandStatus(); } catch (e) {} }
            return { overlay: true, enabled: true };
        },
        setEnabled(on) { try { if (cap()) cap().setEnabled({ enabled: on }); if (ele() && ele().setIslandEnabled) ele().setIslandEnabled(on); } catch (e) {} },
        requestOverlay() { try { if (cap()) return cap().requestOverlay(); } catch (e) {} },
        isAndroid: () => !!cap(),
        log: () => LS.get('dc_ilog', []),
    };
    return { command, snapshot, push, island: islandApi };
})();
window.DarcamBridge = DarcamBridge;
