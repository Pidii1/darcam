/* Darcam — import playlists from Spotify, YouTube Music / YouTube, or a pasted song list.
   Songs come in as "title + artist" and are matched to a playable version the first time they play. */
'use strict';

const Importer = (() => {
    const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

    function pendingTrack(title, artist, durMs, cover) {
        title = (title || '').trim(); artist = (artist || '').replace(/ /g, ' ').trim();
        return {
            id: 'imp_' + hash(title.toLowerCase() + '|' + artist.toLowerCase()), pending: true,
            name: title, artists: [{ name: artist || 'Unknown', id: '' }],
            album: { name: artist, images: [{ url: cover || '' }] },
            cover: cover || '', cover_lg: cover || '', duration_ms: durMs || 0, kind: 'song', channelId: '', _n: 1,
        };
    }

    async function fetchText(url) {
        if (window.darcamNative && window.darcamNative.fetchText) return window.darcamNative.fetchText(url);
        const isCap = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        let r;
        if (isCap) {
            try { r = await fetch(url, { credentials: 'omit' }); } catch (e) { throw new Error('This playlist couldn’t be opened. Check your connection.'); }
        } else {
            // web: same-server relay
            const m = url.match(/embed\/((?:playlist|album)\/[A-Za-z0-9]+)/);
            try { r = await fetch('yt.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spotify: m ? m[1] : '' }) }); }
            catch (e) { throw new Error('This playlist couldn’t be opened. Check your connection.'); }
            if (r.status === 404) throw new Error('yt.php is missing on this server');
        }
        if (!r.ok) throw new Error('This playlist couldn’t be opened. Make sure it is public.');
        return r.text();
    }

    function detect(link) {
        const s = (link || '').trim();
        let m = s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(?:embed\/)?(playlist|album)\/([A-Za-z0-9]+)/i) || s.match(/^spotify:(playlist|album):([A-Za-z0-9]+)/i);
        if (m) return { kind: 'spotify', type: m[1].toLowerCase(), id: m[2] };
        m = s.match(/[?&]list=([\w-]+)/);
        if (m && /youtu/i.test(s)) return { kind: 'youtube', id: m[1] };
        return null;
    }

    async function fromSpotify(type, id) {
        let html;
        try { html = await fetchText(`https://open.spotify.com/embed/${type}/${id}`); }
        catch (e) { throw e; }
        const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (!m) throw new Error('Couldn’t read this Spotify link. Make sure the playlist is public.');
        let ent;
        try { ent = JSON.parse(m[1]).props.pageProps.state.data.entity; } catch (e) { ent = null; }
        if (!ent || !Array.isArray(ent.trackList) || !ent.trackList.length) throw new Error('This Spotify playlist is empty or private.');
        const cover = (ent.coverArt && ent.coverArt.sources && ent.coverArt.sources[0] && ent.coverArt.sources[0].url) || '';
        const albumArtist = type === 'album' ? (ent.subtitle || '') : '';
        const tracks = ent.trackList.map((t) => pendingTrack(t.title, t.subtitle || albumArtist, t.duration, cover));
        return { name: ent.name || ent.title || 'Spotify playlist', description: 'Imported from Spotify', cover, tracks };
    }

    async function fromYouTube(id) {
        const d = await Catalog.playlist(id, { max: 200 });
        if (!d.tracks.length) throw new Error('This playlist is empty or private.');
        return { name: d.info.name || 'Imported playlist', description: 'Imported from YouTube Music', cover: d.info.image_lg || d.info.image || null, tracks: d.tracks };
    }

    // "Artist - Title" per line (also "1. Title — Artist" style lists)
    function fromText(text, name) {
        const tracks = [];
        (text || '').split(/\r?\n/).forEach((line) => {
            let l = line.replace(/^\s*(\d+[.)]\s*|[-•*]\s+)/, '').trim();
            if (!l) return;
            const parts = l.split(/\s+[-–—|]\s+/);
            if (parts.length >= 2) tracks.push(pendingTrack(parts.slice(1).join(' - '), parts[0]));
            else tracks.push(pendingTrack(l, ''));
        });
        if (!tracks.length) throw new Error('Paste at least one song.');
        return { name: name || 'Imported playlist', description: 'Imported song list', cover: null, tracks: tracks.slice(0, 300) };
    }

    async function run(input) {
        if (input.text) return fromText(input.text, input.name);
        const d = detect(input.link);
        if (!d) throw new Error('Paste a Spotify or YouTube Music playlist link.');
        return d.kind === 'spotify' ? fromSpotify(d.type, d.id) : fromYouTube(d.id);
    }

    function openModal() {
        UI.modal(`<h3>Import playlist</h3>
            <div class="imp-tabs" role="tablist"><button class="on" data-imp="link">From a link</button><button data-imp="text">Paste songs</button></div>
            <form data-f>
                <div class="imp-pane" data-pane="link">
                    <input class="field" name="link" placeholder="Spotify or YouTube Music playlist link" autocomplete="off">
                    <p class="imp-hint">Works with public playlists and albums. Open the playlist in Spotify or YouTube Music, tap <b>Share → Copy link</b>, and paste it here.</p>
                </div>
                <div class="imp-pane" data-pane="text" hidden>
                    <input class="field" name="name" placeholder="Playlist name" maxlength="60" autocomplete="off">
                    <textarea class="field" name="text" rows="7" placeholder="One song per line, e.g.&#10;Ungu - Cinta Dalam Hati&#10;Hindia - Evaluasi"></textarea>
                </div>
                <div class="imp-status" hidden></div>
                <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">Import</button></div>
            </form>`, (m, close) => {
            let mode = 'link';
            m.querySelectorAll('[data-imp]').forEach((b) => b.onclick = () => {
                mode = b.dataset.imp;
                m.querySelectorAll('[data-imp]').forEach((x) => x.classList.toggle('on', x === b));
                m.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== mode));
            });
            const status = m.querySelector('.imp-status');
            const btn = m.querySelector('button[type=submit]');
            m.querySelector('[data-f]').onsubmit = async (e) => {
                e.preventDefault();
                const f = e.target.elements;
                status.hidden = false; status.className = 'imp-status'; status.textContent = 'Reading playlist…';
                btn.disabled = true;
                try {
                    const d = await run(mode === 'link' ? { link: f.link.value } : { text: f.text.value, name: f.name.value.trim() });
                    const p = Store.importPlaylist(d);
                    close();
                    UI.toast(`Imported ${d.tracks.length} songs`, 'success');
                    location.hash = '#/playlist/' + p.id;
                } catch (err) {
                    status.className = 'imp-status err'; status.textContent = err.message || 'Import failed';
                    btn.disabled = false;
                }
            };
        });
    }

    return { run, detect, openModal, fromText };
})();
