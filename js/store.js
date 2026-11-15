/* Darcam — local library (no account). Compatible with the old darcamDB data. */
'use strict';

const Store = (() => {
    const KEY = 'darcamDB';
    const DEFAULT_SETTINGS = {
        autoplay: true,          // keep playing similar songs when the queue ends
        lyricsSize: 'm',         // s | m | l
        lyricsBlur: true,
        lyricsKaraoke: true,
        translateTo: 'en',
        volume: 80,
        npMode: 'lyrics',
        lyricsInNotif: true,
        crossfade: 6,
        videoBg: 'wifi',          // video behind the lyrics: off | on | wifi            // seconds the songs overlap (0 = off)
        lyricsDelay: 0.35,       // seconds the lyrics wait behind the audio     // show the current lyric line in the system media notification / island
    };

    function blank() {
        return { playlists: [], likedSongs: [], recentlyPlayed: [], queue: [], settings: { ...DEFAULT_SETTINGS } };
    }

    let data = LS.get(KEY, null) || blank();
    data.playlists = data.playlists || [];
    data.likedSongs = data.likedSongs || [];
    data.recentlyPlayed = data.recentlyPlayed || [];
    data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };

    const save = debounce(() => LS.set(KEY, data), 150);
    function commit(ev) { save(); Bus.emit('library', ev || {}); }

    // Keep stored tracks small: drop anything we can rebuild
    function slim(t) {
        return {
            id: t.id, youtube_id: t.youtube_id || t.id, name: t.name, artists: t.artists, album: t.album,
            cover: t.cover, cover_lg: t.cover_lg, duration_ms: t.duration_ms || 0, kind: t.kind, channelId: t.channelId,
            ...(t.pending ? { pending: true } : {}),
        };
    }

    return {
        get settings() { return data.settings; },
        setSetting(k, v) { data.settings[k] = v; commit({ type: 'settings', key: k }); },

        // Likes
        liked() { return data.likedSongs; },
        isLiked(id) { return data.likedSongs.some((t) => t.id === id); },
        toggleLike(t) {
            const i = data.likedSongs.findIndex((x) => x.id === t.id);
            if (i > -1) data.likedSongs.splice(i, 1); else data.likedSongs.unshift(slim(t));
            commit({ type: 'like', id: t.id });
            return i === -1;
        },

        // History
        recent() { return data.recentlyPlayed; },
        pushRecent(t) {
            data.recentlyPlayed = [slim(t), ...data.recentlyPlayed.filter((x) => x.id !== t.id)].slice(0, 60);
            commit({ type: 'recent' });
        },
        clearRecent() { data.recentlyPlayed = []; commit({ type: 'recent' }); },

        // Playlists
        playlists() { return data.playlists; },
        playlist(id) { return data.playlists.find((p) => p.id === id); },
        createPlaylist(name) {
            const p = { id: 'playlist_' + Date.now(), name: name || 'New playlist', description: '', tracks: [], coverImage: null, createdAt: new Date().toISOString() };
            data.playlists.unshift(p); commit({ type: 'playlists' }); return p;
        },
        renamePlaylist(id, name) { const p = this.playlist(id); if (p) { p.name = name; commit({ type: 'playlists' }); } },
        updatePlaylist(id, patch) { const p = this.playlist(id); if (p) { Object.assign(p, patch); commit({ type: 'playlists' }); } },
        importPlaylist({ name, description = '', cover = null, tracks = [] }) {
            const p = { id: 'playlist_' + Date.now(), name: name || 'Imported playlist', description, tracks: [], coverImage: cover, createdAt: new Date().toISOString() };
            const seen = new Set();
            tracks.forEach((t) => { if (t && !seen.has(t.id)) { seen.add(t.id); p.tracks.push(slim(t)); } });
            data.playlists.unshift(p); commit({ type: 'playlists' }); return p;
        },
        // an imported song was matched to a playable one: update it everywhere
        resolvePending(oldId, t) {
            const s2 = slim(t); let hit = false;
            const fix = (arr) => arr.forEach((x, i) => { if (x.id === oldId) { arr[i] = { ...s2 }; hit = true; } });
            data.playlists.forEach((p) => fix(p.tracks)); fix(data.likedSongs); fix(data.recentlyPlayed);
            if (hit) commit({ type: 'playlists', silent: true });
        },
        setPlaylistCover(id, url) { const p = this.playlist(id); if (p) { p.coverImage = url; commit({ type: 'playlists' }); } },
        deletePlaylist(id) { data.playlists = data.playlists.filter((p) => p.id !== id); commit({ type: 'playlists' }); },
        addToPlaylist(id, t) {
            const p = this.playlist(id); if (!p) return false;
            if (p.tracks.some((x) => x.id === t.id)) return false;
            p.tracks.push(slim(t)); commit({ type: 'playlists' }); return true;
        },
        removeFromPlaylist(id, trackId) {
            const p = this.playlist(id); if (!p) return;
            p.tracks = p.tracks.filter((x) => x.id !== trackId); commit({ type: 'playlists' });
        },

        // Search history
        searches() { return LS.get('darcam_searches', []); },
        pushSearch(entry) {
            // entry: {type:'query', q} | {type:'track'|'artist'|'playlist', item}
            const key = (e) => e.type === 'query' ? 'q:' + e.q.toLowerCase() : e.type + ':' + (e.item && e.item.id);
            const list = [entry, ...this.searches().filter((e) => key(e) !== key(entry))].slice(0, 20);
            LS.set('darcam_searches', list);
        },
        removeSearch(i) { const l = this.searches(); l.splice(i, 1); LS.set('darcam_searches', l); },
        clearSearches() { LS.set('darcam_searches', []); },

        // Backup (no account, so give people a way to move their library)
        exportJSON() { return JSON.stringify({ app: 'darcam', version: 2, exportedAt: new Date().toISOString(), data }, null, 2); },
        importJSON(text) {
            const j = JSON.parse(text);
            const d = j && (j.data || j);
            if (!d || !Array.isArray(d.playlists)) throw new Error('Invalid file');
            data = { ...blank(), ...d, settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } };
            LS.set(KEY, data); Bus.emit('library', { type: 'import' });
        },
    };
})();
