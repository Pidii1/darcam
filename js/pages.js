/* Darcam — router + pages */
'use strict';

const Pages = (() => {
    const view = () => $('#view');
    let navTok = 0;
    let lastRoute = '';

    function parse() {
        const h = location.hash.replace(/^#\/?/, '') || 'home';
        const [path, qs] = h.split('?');
        const parts = path.split('/');
        return { name: parts[0] || 'home', id: decodeURIComponent(parts[1] || ''), q: new URLSearchParams(qs || ''), path };
    }

    function setTitle(t) { $('#tbTitle').textContent = t || ''; }
    function render(html) { view().innerHTML = html; hydrateIcons(view()); }
    const alive = (tok) => tok === navTok;
    function errBox(e) { return `<div class="empty err">${ic('info')}<p>${esc(e && e.message ? e.message : 'Something went wrong. Try again.')}</p></div>`; }
    function fill(sel, html) { const el = view().querySelector(sel); if (el) { el.innerHTML = html; hydrateIcons(el); Bus.emit('page'); } }

    async function go() {
        const r = parse();
        const tok = ++navTok;
        const sameSearch = r.name === 'search' && lastRoute.startsWith('search');
        lastRoute = r.path;
        $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === r.name || (r.name === 'liked' && a.dataset.route === 'library') || (r.name === 'playlist' && a.dataset.route === 'library')));
        UI.renderSideLibrary();
        UI.closeMenu();
        if (!sameSearch) view().scrollTop = 0;
        document.body.dataset.page = r.name;
        const fn = routes[r.name] || routes.home;
        try { await fn(r, tok); } catch (e) { console.error(e); if (alive(tok)) render(errBox(e)); }
        Bus.emit('page');
    }

    // ================= HOME =================
    function quickItem(t, listId, i) {
        return `<div class="quick ${Player.current() && Player.current().id === t.id ? 'is-current' : ''}" data-list="${listId}" data-i="${i}" data-id="${esc(t.id)}" role="button" tabindex="0">
            ${UI.art(T.cover(t), 'quick-art')}<span class="quick-title">${esc(T.title(t))}</span><span class="fab sm" data-act="play">${ic('play')}</span></div>`;
    }

    async function home(r, tok) {
        setTitle('Home');
        const recent = Store.recent().map(Catalog.normalize);
        const liked = Store.liked().map(Catalog.normalize);
        const seen = new Set();
        const quick = [...recent, ...liked].filter((t) => !seen.has(t.id) && seen.add(t.id)).slice(0, 8);
        const qid = UI.regList(quick, { type: 'quick', name: 'Quick picks' });
        const pls = Store.playlists();

        render(`
            <div class="page home">
                <header class="home-head">
                    <h1>${greeting()}</h1>
                    <a class="icon-btn mob-only" href="#/settings" aria-label="Settings">${ic('settings')}</a>
                </header>
                ${quick.length ? `<div class="quick-grid">${quick.map((t, i) => quickItem(t, qid, i)).join('')}</div>`
                    : `<div class="welcome glass-soft"><div class="welcome-mark">${LOGO_SVG}</div><div><h3>Welcome to Darcam</h3><p>No account, no login. Search for a song, press play, and all your playlists stay on this device.</p><a class="btn primary" href="#/search">${ic('search')}<span>Search songs</span></a></div></div>`}
                <section class="sec" id="secTop"><div class="sec-head"><h2>Top 10 Malaysia</h2></div><div class="top10">${UI.skeletonList(10)}</div></section>
                ${recent.length ? UI.section('Recently played', UI.tileRow(recent.slice(0, 16), { type: 'recent', name: 'Recently played' })) : ''}
                <div id="secMix"></div>
                <div id="secForYou"></div>
                <div id="secArtists"></div>
                <section class="sec" id="secTrend"><div class="sec-head"><h2>Trending in Malaysia</h2></div>${UI.skeletonRow()}</section>
                ${pls.length ? UI.section('Your playlists', `<div class="hrow">${pls.map((p) => `<a class="tile" href="#/playlist/${esc(p.id)}"><div class="tile-art">${UI.localPlaylistCover(p)}</div><div class="tile-title">${esc(p.name)}</div><div class="tile-sub">${p.tracks.length} songs</div></a>`).join('')}</div>`) : ''}
                <section class="sec" id="secGlobal"><div class="sec-head"><h2>Global hits</h2></div>${UI.skeletonRow()}</section>
                <section class="sec" id="secKR"><div class="sec-head"><h2>K-Pop now</h2></div>${UI.skeletonRow()}</section>
                <section class="sec" id="secID"><div class="sec-head"><h2>Popular in Indonesia</h2></div>${UI.skeletonRow()}</section>
            </div>`);

        const chartSec = async (sel, region, title, transform, which) => {
            try {
                const tr = await Catalog.chart(region, 25, which);
                if (!alive(tok)) return;
                const html = transform ? transform(tr) : UI.tileRow(tr, { type: 'chart', name: title });
                fill(sel, `<div class="sec-head"><h2>${esc(title)}</h2></div>` + html);
            } catch (e) { if (alive(tok)) fill(sel, `<div class="sec-head"><h2>${esc(title)}</h2></div>` + errBox(e)); }
        };
        chartSec('#secTop', 'MY', 'Top 10 Malaysia', (tr) => {
            const top = tr.filter((t) => t.kind === 'song').concat(tr.filter((t) => t.kind !== 'song')).slice(0, 10);
            return `<div class="top10">${UI.trackList(top, { type: 'chart', name: 'Top 10 Malaysia' }, { rank: true, cls: 'cols' })}</div>`;
        });
        chartSec('#secTrend', 'MY', 'Trending in Malaysia', (tr) => UI.tileRow(tr, { type: 'chart', name: 'Trending in Malaysia' }), 'trending');
        chartSec('#secGlobal', 'US', 'Global hits');
        chartSec('#secKR', 'KR', 'K-Pop now');
        chartSec('#secID', 'ID', 'Popular in Indonesia');

        // "For you": based on the artist you play most
        const counts = {};
        recent.slice(0, 30).forEach((t) => { const a = t.artists && t.artists[0] && t.artists[0].name; if (a && a !== 'Unknown') counts[a] = (counts[a] || 0) + 1; });
        const fav = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (fav) {
            fill('#secForYou', `<section class="sec"><div class="sec-head"><h2>Because you listened to ${esc(fav[0])}</h2></div>${UI.skeletonRow()}</section>`);
            try {
                const tr = await Catalog.radio(recent.find((t) => t.artists[0].name === fav[0]));
                if (alive(tok)) fill('#secForYou', UI.section('Because you listened to ' + fav[0], UI.tileRow(tr.slice(0, 16), { type: 'radio', name: 'For you' })));
            } catch (e) { if (alive(tok)) fill('#secForYou', ''); }
        }
        // Daily Mix: made once a day from what you play most
        const special = (id, name, sub, kind) => `<a class="tile mix" href="#/mix/${id}"><div class="tile-art"><div class="mix-special ${kind}"><small>${kind === 'radar' ? 'NEW THIS WEEK' : 'LAST 30 DAYS'}</small><b>${esc(name)}</b></div><span class="fab" data-act="play-mix" data-mix="${id}">${ic('play')}</span></div><div class="tile-title">${esc(name)}</div><div class="tile-sub">${esc(sub)}</div></a>`;
        let mixState = { mixes: DailyMix.cached(), radar: Radar.cached() };
        const showMix = () => {
            if (!alive(tok)) return;
            const rep = Radar.onRepeat();
            const tiles = [];
            if (mixState.radar && mixState.radar.tracks.length) tiles.push(special('radar', 'Release Radar', mixState.radar.sub, 'radar'));
            if (rep.tracks.length >= 5) tiles.push(special('repeat', 'On Repeat', 'The songs you play the most right now', 'repeat'));
            (mixState.mixes || []).forEach((m) => tiles.push(`<a class="tile mix" href="#/mix/${m.n}"><div class="tile-art">${DailyMix.cover(m)}<span class="fab" data-act="play-mix" data-mix="${m.n}">${ic('play')}</span></div><div class="tile-title">Daily Mix ${m.n}</div><div class="tile-sub">${esc(m.sub)}</div></a>`));
            if (tiles.length) fill('#secMix', UI.section('Made for you', `<div class="hrow">${tiles.join('')}</div>`));
        };
        showMix();
        if (!mixState.mixes) DailyMix.get().then((m) => { mixState.mixes = m; showMix(); }).catch(() => {});
        if (!mixState.radar) Radar.get().then((r) => { mixState.radar = r; showMix(); }).catch(() => {});
        // Artists you might like: from the singers you play and like most
        const pool = Store.liked().concat(recent.slice(0, 30)).map(Catalog.normalize).filter((t) => !t.pending && t.artists && t.artists[0] && t.artists[0].name !== 'Unknown');
        const seeds = []; const seenA = new Set();
        pool.forEach((t) => { const n = t.artists[0].name.toLowerCase(); if (!seenA.has(n) && seeds.length < 2) { seenA.add(n); seeds.push(t); } });
        if (seeds.length) {
            try {
                const arts = await Catalog.relatedArtists(seeds, [...seenA]);
                if (alive(tok) && arts.length) fill('#secArtists', UI.section('Artists you might like', `<div class="hrow">${arts.map(UI.artistTile).join('')}</div>`));
            } catch (e) {}
        }
    }

    // ================= SEARCH =================
    // Moods & genres: each opens a page of YouTube Music playlists and songs for it
    const MOODS = [
        ['chill', 'Chill', 'chill songs playlist', 'chill vibes', '#0ea5e9', '#1e3a8a'],
        ['galau', 'Galau', 'lagu galau sedih playlist', 'lagu galau', '#6366f1', '#312e81'],
        ['workout', 'Workout', 'workout gym music playlist', 'workout songs', '#f97316', '#b91c1c'],
        ['romance', 'Romance', 'lagu cinta romantis playlist', 'lagu cinta romantis', '#ff4f93', '#be123c'],
        ['focus', 'Focus', 'focus study music playlist', 'study music', '#22c55e', '#065f46'],
        ['party', 'Party', 'party hits playlist', 'party songs', '#eab308', '#a16207'],
        ['sleep', 'Sleep', 'sleep relaxing music playlist', 'sleep music', '#475569', '#0f172a'],
        ['drive', 'Road trip', 'road trip songs playlist', 'road trip songs', '#14b8a6', '#134e4a'],
        ['throwback', 'Throwback 2000s', 'lagu 2000an playlist', 'lagu hits 2000an', '#a855f7', '#581c87'],
    ];
    const GENRES = [
        ['malay', 'Pop Melayu', 'lagu melayu terbaru playlist', 'lagu melayu terbaru', '#eab308', '#92400e'],
        ['indo', 'Indonesia', 'lagu indonesia terpopuler playlist', 'lagu indonesia terpopuler', '#ef4444', '#7f1d1d'],
        ['indie', 'Indie', 'indie indonesia malaysia playlist', 'indie indonesia', '#14b8a6', '#134e4a'],
        ['kpop', 'K-Pop', 'kpop hits playlist', 'kpop hits', '#a855f7', '#581c87'],
        ['hiphop', 'Hip-Hop', 'hip hop hits playlist', 'hip hop hits', '#64748b', '#1e293b'],
        ['rnb', 'R&B', 'rnb hits playlist', 'rnb hits', '#f43f5e', '#881337'],
        ['rock', 'Rock', 'rock hits playlist', 'rock hits', '#dc2626', '#450a0a'],
        ['acoustic', 'Acoustic', 'acoustic cover playlist', 'acoustic cover', '#d97706', '#78350f'],
        ['jpop', 'J-Pop & Anime', 'jpop anime songs playlist', 'anime opening songs', '#ec4899', '#831843'],
        ['dangdut', 'Dangdut', 'dangdut terpopuler playlist', 'dangdut terpopuler', '#10b981', '#064e3b'],
        ['nasyid', 'Nasyid', 'nasyid terbaik playlist', 'nasyid terbaik', '#0d9488', '#134e4a'],
        ['lofi', 'Lo-fi', 'lofi beats playlist', 'lofi beats', '#8b5cf6', '#2e1065'],
    ];
    const moodTile = ([k, n, , , c1, c2]) => `<a class="mood-tile" href="#/genre/${k}" style="--c1:${c1};--c2:${c2}"><span>${esc(n)}</span><i></i></a>`;
    async function genre(r, tok) {
        const g = MOODS.concat(GENRES).find((x) => x[0] === r.id);
        if (!g) { render(`<div class="empty big">${ic('music')}<p>Not found</p></div>`); return; }
        const [k, name, plQ, songQ, c1, c2] = g;
        setTitle(name);
        render(`<div class="page">
            <header class="genre-hero" style="--c1:${c1};--c2:${c2}"><span class="hero-type">${MOODS.some((m) => m[0] === k) ? 'Mood' : 'Genre'}</span><h1>${esc(name)}</h1></header>
            <div id="gPl">${UI.section('Playlists', UI.skeletonRow(6))}</div>
            <div id="gSongs">${UI.section('Songs', UI.skeletonList(8))}</div>
        </div>`);
        Catalog.searchPlaylists(plQ).then((pl) => { if (alive(tok)) fill('#gPl', pl.length ? UI.section('Playlists', `<div class="hrow">${pl.map(UI.playlistTile).join('')}</div>`) : ''); }).catch(() => alive(tok) && fill('#gPl', ''));
        Catalog.searchSongs(songQ).then((tr) => { if (alive(tok)) fill('#gSongs', tr.length ? UI.section('Songs', UI.trackList(tr.slice(0, 20), { type: 'genre', name })) : ''); }).catch((e) => alive(tok) && fill('#gSongs', errBox(e)));
    }
    const TABS = [['all', 'All'], ['songs', 'Songs'], ['lyrics', 'By lyrics'], ['videos', 'Videos'], ['artists', 'Artists'], ['playlists', 'Playlists']];

    function searchBox(q) {
        return `<form class="sbox" id="sbox" autocomplete="off" role="search">
            ${ic('search')}
            <input id="sinput" type="search" enterkeyhint="search" placeholder="Songs, artists or lyrics…" value="${esc(q || '')}" aria-label="Search">
            <button type="button" class="icon-btn sm sclear" id="sclear" aria-label="Clear" ${q ? '' : 'hidden'}>${ic('x')}</button>
            <div class="suggest glass" id="suggest" hidden></div>
        </form>`;
    }

    function historyList() {
        const hs = Store.searches();
        if (!hs.length) return '';
        const items = hs.map((h, i) => {
            if (h.type === 'query') return `<div class="hist" data-hq="${esc(h.q)}"><span class="hist-ic">${ic('history')}</span><span class="hist-text"><b>${esc(h.q)}</b><small>Search</small></span><button class="icon-btn sm" data-hdel="${i}" aria-label="Remove">${ic('x')}</button></div>`;
            const it = h.item;
            if (h.type === 'artist') return `<a class="hist" href="#/artist/${esc(it.id)}"><span class="hist-art round">${UI.art(it.image, '', it.name)}</span><span class="hist-text"><b>${esc(it.name)}</b><small>Artist</small></span><button class="icon-btn sm" data-hdel="${i}" aria-label="Remove">${ic('x')}</button></a>`;
            const t = Catalog.normalize(it);
            const lid = UI.regList([t], { type: 'search', name: 'Search', search: true });
            return `<div class="hist" data-list="${lid}" data-i="0" data-id="${esc(t.id)}"><span class="hist-art">${UI.art(T.cover(t))}</span><span class="hist-text"><b>${esc(T.title(t))}</b><small>Song · ${esc(T.artist(t))}</small></span><button class="icon-btn sm" data-hdel="${i}" aria-label="Remove">${ic('x')}</button></div>`;
        }).join('');
        return `<section class="sec"><div class="sec-head"><h2>Recent searches</h2><button class="sec-more link" data-hclear>Clear</button></div><div class="hist-list">${items}</div></section>`;
    }

    async function search(r, tok) {
        const q = (r.q.get('q') || '').trim();
        const tab = r.q.get('tab') || 'all';
        setTitle(q ? q : 'Search');
        const existing = $('#sbox');
        if (existing && document.activeElement === $('#sinput') && !q) return; // typing on the idle page

        if (!q) {
            render(`<div class="page search">
                <h1 class="page-h">Search</h1>
                ${searchBox('')}
                <div id="shist">${historyList()}</div>
                <section class="sec"><div class="sec-head"><h2>Moods</h2></div><div class="moods">${MOODS.map(moodTile).join('')}</div></section>
                <section class="sec"><div class="sec-head"><h2>Genres</h2></div><div class="moods">${GENRES.map(moodTile).join('')}</div></section>
                </div>`);
            wireSearchBox();
            return;
        }

        render(`<div class="page search has-q">
            ${searchBox(q)}
            <div class="chips">${TABS.map(([k, n]) => `<a class="chip ${k === tab ? 'on' : ''}" href="#/search?q=${encodeURIComponent(q)}${k === 'all' ? '' : '&tab=' + k}">${n}</a>`).join('')}</div>
            <div id="sres">${tab === 'all' ? `<div class="res-top">${'<div class="top-card sk"></div>'}${UI.skeletonList(4)}</div>${UI.skeletonRow()}` : (tab === 'songs' || tab === 'lyrics') ? UI.skeletonList(10) : UI.skeletonRow(8, tab === 'videos')}</div>
        </div>`);
        wireSearchBox();
        Store.pushSearch({ type: 'query', q });

        const src = { type: 'search', name: '“' + q + '”', search: true };
        try {
            let html = '';
            if (tab === 'all') {
                const res = await Catalog.searchAll(q);
                if (!alive(tok)) return;
                if (!res.all.length && !res.artists.length && !res.playlists.length) { fill('#sres', `<div class="empty">${ic('search')}<p>No results for “${esc(q)}”</p><small>Try a different spelling or fewer words.</small></div>`); return; }
                const top = res.top;
                let topHtml = '';
                if (top && top.type === 'artist') {
                    topHtml = `<a class="top-card" href="#/artist/${esc(top.id)}" data-hist-artist='${esc(JSON.stringify({ id: top.id, name: top.name, image: top.image }))}'>
                        <div class="top-art round">${UI.art(top.image, '', top.name, top.image_fb)}</div><div class="top-name">${esc(top.name)}</div><div class="top-type"><span class="tag">Artist</span></div>
                        <span class="fab lg" data-act="play-artist" data-aid="${esc(top.id)}">${ic('play')}</span></a>`;
                } else if (top) {
                    const lid = UI.regList(res.all, src);
                    const ti = res.all.indexOf(top);
                    topHtml = `<div class="top-card" data-list="${lid}" data-i="${ti}" data-id="${esc(top.id)}" role="button">
                        <div class="top-art">${UI.art(T.cover(top))}</div><div class="top-name">${esc(T.title(top))}</div><div class="top-type"><span class="tag">${top.kind === 'video' ? 'Video' : 'Song'}</span> ${esc(T.artist(top))}</div>
                        <span class="fab lg" data-act="play">${ic('play')}</span></div>`;
                }
                const songs = res.songs.filter((t) => !(top && top.id === t.id)).slice(0, 4);
                html = `<div class="res-top"><div><h2 class="h2">Top result</h2>${topHtml}</div><div><h2 class="h2">Songs</h2>${UI.trackList(songs, src, { noIndex: true })}</div></div>`
                    + (res.artists.length ? UI.section('Artists', `<div class="hrow">${res.artists.map(UI.artistTile).join('')}</div>`, `#/search?q=${encodeURIComponent(q)}&tab=artists`) : '')
                    + (res.videos.length ? UI.section('Videos', UI.tileRow(res.videos, { ...src, videoAuto: true }, { video: true }), `#/search?q=${encodeURIComponent(q)}&tab=videos`) : '')
                    + (res.playlists.length ? UI.section('Playlists', `<div class="hrow">${res.playlists.map(UI.playlistTile).join('')}</div>`, `#/search?q=${encodeURIComponent(q)}&tab=playlists`) : '');
            } else if (tab === 'songs') {
                const tr = await Catalog.searchSongs(q); if (!alive(tok)) return;
                html = UI.trackList(tr, src, { empty: 'No songs found' });
            } else if (tab === 'lyrics') {
                const tr = await Catalog.searchLyrics(q); if (!alive(tok)) return;
                html = `<p class="muted small" style="margin:0 0 10px">Songs that have “${esc(q)}” in their lyrics</p>` + UI.trackList(tr, src, { empty: 'No song found with these words. Try a few more words of the lyrics.' });
            } else if (tab === 'videos') {
                const tr = await Catalog.searchVideos(q); if (!alive(tok)) return;
                const lid = UI.regList(tr, { ...src, videoAuto: true });
                html = tr.length ? `<div class="grid video">${tr.map((t, i) => UI.tile(t, lid, i, { video: true })).join('')}</div>` : '<div class="empty">No videos</div>';
            } else if (tab === 'artists') {
                const ar = await Catalog.searchArtists(q); if (!alive(tok)) return;
                html = ar.length ? `<div class="grid">${ar.map(UI.artistTile).join('')}</div>` : '<div class="empty">No artists</div>';
            } else if (tab === 'playlists') {
                const pl = await Catalog.searchPlaylists(q); if (!alive(tok)) return;
                html = pl.length ? `<div class="grid">${pl.map(UI.playlistTile).join('')}</div>` : '<div class="empty">No playlists</div>';
            }
            fill('#sres', html);
        } catch (e) { if (alive(tok)) fill('#sres', errBox(e)); }
    }

    function wireSearchBox() {
        const form = $('#sbox'), inp = $('#sinput'), box = $('#suggest'), clear = $('#sclear');
        if (!form) return;
        let sel = -1, items = [];
        const submit = (q) => { q = (q || '').trim(); if (!q) return; box.hidden = true; inp.blur(); location.hash = '#/search?q=' + encodeURIComponent(q); };
        const paint = () => {
            box.innerHTML = items.map((s, i) => `<button type="button" class="sug ${i === sel ? 'on' : ''}" data-sug="${esc(s.q)}">${ic(s.hist ? 'history' : 'search')}<span>${esc(s.q)}</span>${ic('arrowRight', 'sug-go')}</button>`).join('');
            box.hidden = !items.length || document.activeElement !== inp;
        };
        const update = debounce(async () => {
            const q = inp.value.trim();
            const hist = Store.searches().filter((h) => h.type === 'query' && (!q || h.q.toLowerCase().startsWith(q.toLowerCase()))).slice(0, q ? 3 : 5).map((h) => ({ q: h.q, hist: true }));
            items = hist; sel = -1; paint();
            if (q.length < 2) return;
            const sug = await Catalog.suggest(q);
            if (inp.value.trim() !== q) return;
            items = hist.concat(sug.filter((s) => !hist.some((h) => h.q.toLowerCase() === s.toLowerCase())).map((s) => ({ q: s }))).slice(0, 9);
            paint();
        }, 160);
        inp.addEventListener('input', () => { clear.hidden = !inp.value; update(); });
        inp.addEventListener('focus', update);
        inp.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 160));
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(-1, sel - 1); paint(); }
            else if (e.key === 'Escape') { box.hidden = true; }
        });
        form.addEventListener('submit', (e) => { e.preventDefault(); submit(sel > -1 && items[sel] ? items[sel].q : inp.value); });
        box.addEventListener('mousedown', (e) => e.preventDefault());
        box.addEventListener('click', (e) => { const b = e.target.closest('[data-sug]'); if (b) { inp.value = b.dataset.sug; submit(b.dataset.sug); } });
        clear.addEventListener('click', () => { inp.value = ''; clear.hidden = true; inp.focus(); if (location.hash.includes('q=')) location.hash = '#/search'; });
        if (!inp.value && !UI.mobile()) setTimeout(() => inp.focus(), 50);

        const hist = $('#shist');
        if (hist) hist.addEventListener('click', (e) => {
            const del = e.target.closest('[data-hdel]');
            if (del) { e.preventDefault(); e.stopPropagation(); Store.removeSearch(+del.dataset.hdel); hist.innerHTML = historyList(); return; }
            if (e.target.closest('[data-hclear]')) { Store.clearSearches(); hist.innerHTML = ''; return; }
            const hq = e.target.closest('[data-hq]');
            if (hq) submit(hq.dataset.hq);
        }, true);
    }

    // artist "top result" interactions
    document.addEventListener('click', async (e) => {
        const pa = e.target.closest('[data-act="play-artist"]');
        if (pa) {
            e.preventDefault(); e.stopPropagation();
            try { const d = await Catalog.artist(pa.dataset.aid); Player.playList(d.top, 0, { type: 'artist', id: pa.dataset.aid, name: d.artist.name }); } catch (err) { UI.toast(err.message, 'error'); }
            return;
        }
        const ha = e.target.closest('[data-hist-artist]');
        if (ha) { try { Store.pushSearch({ type: 'artist', item: JSON.parse(ha.dataset.histArtist) }); } catch (err) {} }
        const at = e.target.closest('.page.search a.tile.artist');
        if (at) { const id = at.getAttribute('href').split('/').pop(); Store.pushSearch({ type: 'artist', item: { id, name: at.querySelector('.tile-title').textContent, image: (at.querySelector('img') || {}).src } }); }
    }, true);

    // ================= ARTIST =================
    async function artist(r, tok) {
        setTitle('');
        render(`<div class="page artist"><div class="hero artist-hero sk"><div class="hero-inner"><div class="hero-art round"></div><div class="hero-text"><div class="sk-line"></div><div class="sk-line short"></div></div></div></div>${UI.skeletonList(5)}</div>`);
        const d = await Catalog.artist(r.id);
        if (!alive(tok)) return;
        const a = d.artist;
        setTitle(a.name);
        const songs = d.top.filter((t) => t.kind === 'song');
        const vids = d.top.filter((t) => t.kind === 'video');
        const popular = d.top.slice(0, 10);
        const src = { type: 'artist', id: a.id, name: a.name };
        render(`<div class="page artist">
            <header class="hero artist-hero" ${a.banner ? `style="--banner:url('${esc(a.banner)}')"` : `style="--banner:url('${esc(a.image)}')"`}>
                <div class="hero-inner">
                    <div class="hero-art round">${UI.art(a.image, '', a.name, a.image_fb)}</div>
                    <div class="hero-text">
                        <span class="hero-type">Artist</span>
                        <h1 class="hero-title">${esc(a.name)}</h1>
                        <div class="hero-meta">${a.followers ? fmtCount(a.followers) + ' followers' : ''}</div>
                    </div>
                </div>
            </header>
            <div class="actions">
                <button class="fab xl" data-pact="play" aria-label="Play">${ic('play')}</button>
                <button class="icon-btn lg" data-pact="shuffle" aria-label="Shuffle">${ic('shuffle')}</button>
                <button class="btn ghost" data-pact="radio">${ic('radio')}<span>Radio</span></button>
                <button class="btn follow-btn ${Follow.is(a.name) ? 'on' : ''}" data-pact="follow">${Follow.is(a.name) ? 'Following' : 'Follow'}</button>
            </div>
            <div id="secLatest"></div>
            ${UI.section('Popular', UI.trackList(popular, src, { cls: 'compact' }))}
            ${vids.length ? UI.section('Videos', UI.tileRow(vids, { ...src, videoAuto: true }, { video: true })) : ''}
            ${songs.length > 10 ? UI.section('More songs', UI.tileRow(songs.slice(10), src)) : ''}
            ${d.playlists.length ? UI.section('Albums & playlists', `<div class="hrow">${d.playlists.map(UI.playlistTile).join('')}</div>`) : ''}
            <div id="secFans">${UI.section('Fans also like', UI.skeletonRow(6))}</div>
        </div>`);
        view().querySelector('.actions').addEventListener('click', (e) => {
            const b = e.target.closest('[data-pact]'); if (!b) return;
            if (b.dataset.pact === 'play') Player.playList(d.top, 0, src);
            if (b.dataset.pact === 'shuffle') Player.playList(shuffleArr(d.top), 0, src);
            if (b.dataset.pact === 'radio') UI.startRadio(d.top[0]);
            if (b.dataset.pact === 'follow') {
                const on = Follow.toggle({ name: a.name, id: a.id, image: a.image });
                b.classList.toggle('on', on); b.textContent = I18n.t(on ? 'Following' : 'Follow');
                UI.toast(on ? 'You’ll see new songs from ' + a.name + ' in Release Radar' : 'Unfollowed ' + a.name);
                if (on) Follow.check(true);
            }
        });
        if (Follow.is(a.name)) Follow.markSeen(a.name);
        Catalog.newFrom(a.name).then((news) => {
            if (!alive(tok) || !news.length) return;
            const t = news[0], fresh = t.ago && t.ago < 30 * 86400;
            const lsrc = { type: 'artist', id: a.id, name: a.name + ' · new' };
            const lid = UI.regList(news.slice(0, 1), lsrc);
            fill('#secLatest', `<section class="sec"><div class="sec-head"><h2>Latest release</h2></div>
                <div class="tlist"><div class="trow latest-row" data-list="${lid}" data-i="0" data-id="${esc(t.id)}">
                    <div class="trow-main">${UI.art(T.cover(t), 'trow-art', T.title(t))}<div class="trow-text"><div class="trow-title">${esc(T.title(t))}</div><div class="trow-sub">${esc(Radar.ago(t.ago) || 'Single')}</div></div></div>
                    ${fresh ? '<span class="new-badge">NEW</span>' : ''}<div class="trow-dur">${T.dur(t)}</div>
                    <button class="icon-btn sm trow-more" data-act="more">${ic('more')}</button></div></div></section>`);
        }).catch(() => {});
        try {
            const fans = d.related && d.related.length ? d.related : await Catalog.relatedArtists(d.top.slice(0, 2), [a.name]);
            if (alive(tok)) fill('#secFans', fans.filter((x) => x.id !== a.id).length ? UI.section('Fans also like', `<div class="hrow">${fans.filter((x) => x.id !== a.id).map(UI.artistTile).join('')}</div>`) : '');
        } catch (e) { if (alive(tok)) fill('#secFans', ''); }
    }

    // ================= REMOTE PLAYLIST =================
    async function playRemotePlaylist(pid) {
        try { UI.toast('Loading playlist…'); const d = await Catalog.playlist(pid); Player.playList(d.tracks, 0, { type: 'list', id: pid, name: d.info.name }); }
        catch (e) { UI.toast(e.message, 'error'); }
    }
    async function list(r, tok) {
        setTitle('');
        render(`<div class="page"><div class="hero sk"><div class="hero-inner"><div class="hero-art"></div><div class="hero-text"><div class="sk-line"></div></div></div></div>${UI.skeletonList(8)}</div>`);
        const d = await Catalog.playlist(r.id);
        if (!alive(tok)) return;
        const total = d.tracks.reduce((s, t) => s + (t.duration_ms || 0), 0) / 1000;
        const src = { type: 'list', id: r.id, name: d.info.name };
        setTitle(d.info.name);
        render(`<div class="page">
            <header class="hero" style="--banner:url('${esc(d.info.image_lg || d.info.image || '')}')">
                <div class="hero-inner"><div class="hero-art">${UI.art(d.info.image_lg || d.info.image)}</div>
                <div class="hero-text"><span class="hero-type">${pid && (Store.playlist(pid) || {}).smart ? 'Smart playlist' : 'Playlist'}</span><h1 class="hero-title">${esc(d.info.name)}</h1>
                <div class="hero-meta">${esc(d.info.owner || '')} · ${d.tracks.length} songs${total ? ' · ' + Math.round(total / 60) + ' min' : ''}</div></div></div>
            </header>
            <div class="actions">
                <button class="fab xl" data-pact="play">${ic('play')}</button>
                <button class="icon-btn lg" data-pact="shuffle" title="Shuffle">${ic('shuffle')}</button>
                <button class="icon-btn lg smart-btn" data-pact="smart" title="Smart Shuffle: shuffle + songs with the same vibe">${ic('shuffleSmart')}</button>
                <button class="btn ghost" data-pact="save">${ic('plus')}<span>Save to Library</span></button>
            </div>
            ${UI.trackList(d.tracks, src, { empty: 'This playlist is empty' })}
        </div>`);
        view().querySelector('.actions').addEventListener('click', (e) => {
            const b = e.target.closest('[data-pact]'); if (!b) return;
            if (b.dataset.pact === 'play') Player.playList(d.tracks, 0, src);
            if (b.dataset.pact === 'shuffle') Player.playList(shuffleArr(d.tracks), 0, src);
            if (b.dataset.pact === 'smart') Player.playSmart(d.tracks, src);
            if (b.dataset.pact === 'save') {
                const p = Store.createPlaylist(d.info.name);
                d.tracks.forEach((t) => Store.addToPlaylist(p.id, t));
                if (d.info.image_lg) Store.setPlaylistCover(p.id, d.info.image_lg);
                UI.toast('Saved to Library', 'success');
            }
        });
    }

    // ================= DAILY MIX =================
    async function mix(r, tok) {
        setTitle('Daily Mix');
        render(`<div class="page"><div class="hero sk"><div class="hero-inner"><div class="hero-art"></div><div class="hero-text"><div class="sk-line"></div></div></div></div>${UI.skeletonList(8)}</div>`);
        if (r.id === 'radar' || r.id === 'repeat') return specialMix(r, tok);
        const mixes = await DailyMix.get();
        if (!alive(tok)) return;
        const m = (mixes || []).find((x) => String(x.n) === String(r.id));
        if (!m) { render(`<div class="empty big">${ic('music')}<p>Play a few songs first, and your Daily Mixes will show up here.</p><a class="btn primary" href="#/search">${ic('search')}<span>Search songs</span></a></div>`); return; }
        const src = { type: 'mix', id: 'mix' + m.n, name: 'Daily Mix ' + m.n };
        const total = m.tracks.reduce((a, t) => a + (t.duration_ms || 0), 0) / 1000;
        setTitle('Daily Mix ' + m.n);
        render(`<div class="page">
            <header class="hero"><div class="hero-inner"><div class="hero-art">${DailyMix.cover(m)}</div>
                <div class="hero-text"><span class="hero-type">Made for you</span><h1 class="hero-title">Daily Mix ${m.n}</h1>
                <p class="hero-desc">${esc(m.sub)}. New songs every day.</p>
                <div class="hero-meta">${m.tracks.length} songs${total ? ' · ' + Math.round(total / 60) + ' min' : ''}</div></div></div></header>
            <div class="actions">
                <button class="fab xl" data-pact="play">${ic('play')}</button>
                <button class="icon-btn lg" data-pact="shuffle" title="Shuffle">${ic('shuffle')}</button>
                <button class="icon-btn lg smart-btn" data-pact="smart" title="Smart Shuffle">${ic('shuffleSmart')}</button>
                <button class="btn ghost" data-pact="save">${ic('plus')}<span>Save to Library</span></button>
            </div>
            ${UI.trackList(m.tracks, src)}
        </div>`);
        view().querySelector('.actions').addEventListener('click', (e) => {
            const b = e.target.closest('[data-pact]'); if (!b) return;
            const a = b.dataset.pact;
            if (a === 'play') Player.playList(m.tracks, 0, src);
            if (a === 'shuffle') Player.playList(shuffleArr(m.tracks.slice()), 0, src);
            if (a === 'smart') Player.playSmart(m.tracks, src);
            if (a === 'save') { Store.importPlaylist({ name: 'Daily Mix ' + m.n + ' · ' + new Date().toLocaleDateString(), description: m.sub, tracks: m.tracks }); UI.toast('Saved to Library', 'success'); }
        });
    }

    async function specialMix(r, tok) {
        const radar = r.id === 'radar';
        const d = radar ? await Radar.get() : Radar.onRepeat();
        if (!alive(tok)) return;
        const name = radar ? 'Release Radar' : 'On Repeat';
        setTitle(name);
        if (!d || !d.tracks.length) { render(`<div class="empty big">${ic('music')}<p>${radar ? 'No new songs from your artists yet this week' : 'Play your favourite songs a few times and they’ll show up here'}</p></div>`); return; }
        const src = { type: 'mix', id: r.id, name };
        render(`<div class="page">
            <header class="hero"><div class="hero-inner"><div class="hero-art"><div class="mix-special ${r.id === 'radar' ? 'radar' : 'repeat'} big"><small>${radar ? 'NEW THIS WEEK' : 'LAST 30 DAYS'}</small><b>${name}</b></div></div>
                <div class="hero-text"><span class="hero-type">Made for you</span><h1 class="hero-title">${name}</h1>
                <p class="hero-desc">${radar ? esc(d.sub) + '. Updated every week.' : 'The songs you’ve played the most in the last 30 days.'}</p>
                <div class="hero-meta">${d.tracks.length} songs</div></div></div></header>
            <div class="actions">
                <button class="fab xl" data-pact="play">${ic('play')}</button>
                <button class="icon-btn lg" data-pact="shuffle" title="Shuffle">${ic('shuffle')}</button>
                <button class="btn ghost" data-pact="save">${ic('plus')}<span>Save to Library</span></button>
            </div>
            ${UI.trackList(d.tracks, src)}
        </div>`);
        view().querySelector('.actions').addEventListener('click', (e) => {
            const b = e.target.closest('[data-pact]'); if (!b) return;
            if (b.dataset.pact === 'play') Player.playList(d.tracks, 0, src);
            if (b.dataset.pact === 'shuffle') Player.playList(shuffleArr(d.tracks.slice()), 0, src);
            if (b.dataset.pact === 'save') { Store.importPlaylist({ name: name + ' · ' + new Date().toLocaleDateString(), tracks: d.tracks }); UI.toast('Saved to Library', 'success'); }
        });
    }

    // ================= SHARED LINKS =================
    const appBtn = (path) => Site.onWeb() ? `<a class="btn ghost" href="darcam://${path}">${ic('expand')}<span>Open in Darcam app</span></a>` : '';
    async function sharedSong(r, tok) {
        setTitle('');
        render(`<div class="page"><div class="hero sk"><div class="hero-inner"><div class="hero-art"></div><div class="hero-text"><div class="sk-line"></div></div></div></div></div>`);
        const t = await Catalog.track(r.id);
        if (!alive(tok)) return;
        setTitle(T.title(t));
        const src = { type: 'shared', name: 'Shared with you' };
        render(`<div class="page">
            <header class="hero" style="--banner:url('${esc(T.coverLg(t))}')"><div class="hero-inner"><div class="hero-art">${UI.art(T.coverLg(t))}</div>
                <div class="hero-text"><span class="hero-type">Shared song</span><h1 class="hero-title">${esc(T.title(t))}</h1><div class="hero-meta">${esc(T.artist(t))}</div></div></div></header>
            <div class="actions"><button class="fab xl" data-pact="play">${ic('play')}</button><button class="btn ghost" data-pact="radio">${ic('radio')}<span>Song radio</span></button><button class="btn ghost" data-pact="like">${ic('heart')}<span>Like</span></button>${appBtn('s/' + r.id)}</div>
        </div>`);
        view().querySelector('.actions').addEventListener('click', (e) => {
            const b = e.target.closest('[data-pact]'); if (!b) return;
            if (b.dataset.pact === 'play') Player.playList([t], 0, src);
            if (b.dataset.pact === 'radio') UI.startRadio(t);
            if (b.dataset.pact === 'like') UI.toggleLike(t);
        });
    }
    async function sharedList(r, tok) {
        setTitle('Shared playlist');
        let d;
        try { d = await ShareLink.decode(r.id); } catch (e) { render(`<div class="empty big">${ic('music')}<p>This link is broken or incomplete</p></div>`); return; }
        if (!alive(tok)) return;
        const tracks = (d.t || []).map((a) => {
            const [y, name, artist, sec] = a;
            if (!y) return { id: 'imp_' + Math.abs([...(name + '|' + artist)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)).toString(36), pending: true, name, artists: [{ name: artist || 'Unknown', id: '' }], album: { name: artist, images: [{ url: '' }] }, cover: '', cover_lg: '', duration_ms: sec * 1000, kind: 'song', _n: 1 };
            return { id: y, youtube_id: y, name, artists: [{ name: artist || 'Unknown', id: '' }], album: { name: artist, images: [{ url: `https://i.ytimg.com/vi/${y}/mqdefault.jpg` }] }, cover: `https://i.ytimg.com/vi/${y}/mqdefault.jpg`, cover_lg: `https://i.ytimg.com/vi/${y}/hqdefault.jpg`, duration_ms: sec * 1000, kind: 'song', _n: 1 };
        });
        const src = { type: 'shared', name: d.n };
        setTitle(d.n);
        render(`<div class="page">
            <header class="hero"><div class="hero-inner"><div class="hero-art">${UI.localPlaylistCover({ tracks, coverImage: null })}</div>
                <div class="hero-text"><span class="hero-type">Shared playlist</span><h1 class="hero-title">${esc(d.n)}</h1><div class="hero-meta">${tracks.length} songs</div></div></div></header>
            <div class="actions"><button class="fab xl" data-pact="play">${ic('play')}</button><button class="icon-btn lg" data-pact="shuffle">${ic('shuffle')}</button><button class="btn ghost" data-pact="save">${ic('plus')}<span>Save to Library</span></button>${appBtn('p/' + r.id)}</div>
            ${UI.trackList(tracks, src)}
        </div>`);
        view().querySelector('.actions').addEventListener('click', (e) => {
            const b = e.target.closest('[data-pact]'); if (!b) return;
            if (b.dataset.pact === 'play') Player.playList(tracks, 0, src);
            if (b.dataset.pact === 'shuffle') Player.playList(shuffleArr(tracks.slice()), 0, src);
            if (b.dataset.pact === 'save') { const p = Store.importPlaylist({ name: d.n, description: 'Shared with you', tracks }); UI.toast('Saved to Library', 'success'); location.hash = '#/playlist/' + p.id; }
        });
    }
    function jamLink(r) { Jam.join(r.id); location.replace('#/home'); }

    // ================= WRAPPED =================
    function wrapped(r) {
        setTitle('Darcam Wrapped');
        const now = new Date();
        const ranges = {
            month: [Stats.day(new Date(now.getFullYear(), now.getMonth(), 1)), Stats.day(), now.toLocaleString('en', { month: 'long' })],
            year: [now.getFullYear() + '-01-01', Stats.day(), String(now.getFullYear())],
            all: ['0000', '9999', 'All time'],
        };
        const which = ranges[r.q.get('p')] ? r.q.get('p') : 'month';
        const [from, to, label] = ranges[which];
        const d = Stats.range(from, to);
        const mins = Math.round(d.secs / 60);
        const tabs = `<div class="chips">${Object.entries(ranges).map(([k, v]) => `<a class="chip ${k === which ? 'on' : ''}" href="#/wrapped?p=${k}">${k === 'month' ? 'This month' : k === 'year' ? 'This year' : 'All time'}</a>`).join('')}</div>`;
        if (!d.secs) {
            render(`<div class="page wrapped"><h1 class="page-h">Darcam Wrapped</h1>${tabs}<div class="empty big">${ic('chart')}<p>Nothing here yet</p><small>Darcam counts what you listen to on this device. Play some songs and come back.</small></div></div>`);
            return;
        }
        // last 30 days chart
        const days = [];
        for (let i = 29; i >= 0; i--) { const x = new Date(); x.setDate(x.getDate() - i); const k = Stats.day(x); days.push([k, (Stats.data.days[k] || { s: 0 }).s]); }
        const maxD = Math.max(...days.map((x) => x[1]), 1);
        const topSongs = d.topSongs.slice(0, 10).map(Stats.toTrack);
        const src = { type: 'wrapped', name: 'Your top songs · ' + label };
        const ta = d.topArtists[0], ts = d.topSongs[0];
        const bestDay = Object.entries(d.byDay).sort((a, b) => b[1] - a[1])[0];
        render(`<div class="page wrapped">
            <header class="page-head"><h1 class="page-h">Darcam Wrapped</h1><div class="head-btns"><button class="btn primary" data-wr="share">${ic('image')}<span>Share as a picture</span></button></div></header>${tabs}
            <div class="wr-hero">
                <div class="wr-big"><span>${label}</span><b>${mins.toLocaleString()}</b><small>minutes listened</small></div>
                <div class="wr-facts">
                    <div><b>${d.topSongs.length}</b><small>songs</small></div>
                    <div><b>${d.topArtists.length}</b><small>artists</small></div>
                    <div><b>${d.plays}</b><small>plays</small></div>
                </div>
            </div>
            <div class="wr-cards">
                ${ta ? `<div class="wr-card"><img src="${esc(ta.c)}" alt=""><div><small>Top artist</small><b>${esc(ta.name)}</b><span>${Math.round(ta.s / 60)} min</span></div></div>` : ''}
                ${ts ? `<div class="wr-card"><img src="${esc(ts.c)}" alt=""><div><small>Top song</small><b>${esc(ts.name)}</b><span>${ts.n} plays · ${esc(ts.a)}</span></div></div>` : ''}
                ${bestDay ? `<div class="wr-card"><div class="wr-ic">${ic('clock')}</div><div><small>Biggest day</small><b>${new Date(bestDay[0]).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short' })}</b><span>${Math.round(bestDay[1] / 60)} min</span></div></div>` : ''}
            </div>
            <section class="sec"><div class="sec-head"><h2>Top artists</h2></div>
                <ol class="wr-artists">${d.topArtists.slice(0, 5).map((a, i) => `<li><span class="wr-rank">${i + 1}</span><img src="${esc(a.c)}" alt=""><b>${esc(a.name)}</b><small>${Math.round(a.s / 60)} min</small></li>`).join('')}</ol>
            </section>
            <section class="sec"><div class="sec-head"><h2>Top songs</h2><button class="btn ghost sm" data-wr="play">${ic('play')}<span>Play all</span></button></div>
                ${UI.trackList(topSongs, src, { rank: true })}
            </section>
            <section class="sec"><div class="sec-head"><h2>Last 30 days</h2></div>
                <div class="wr-chart">${days.map(([k, v]) => `<div class="wr-bar" title="${k}: ${Math.round(v / 60)} min"><i style="height:${Math.max(2, (v / maxD) * 100)}%"></i></div>`).join('')}</div>
                <div class="wr-axis"><span>30 days ago</span><span>Today</span></div>
            </section>
        </div>`);
        const pb = view().querySelector('[data-wr="play"]');
        if (pb) pb.onclick = () => Player.playList(topSongs, 0, src);
        view().querySelector('[data-wr="share"]').onclick = () => StoryCard.shareWrapped({ label: which === 'month' ? label : which === 'year' ? label : 'all time', mins, topArtists: d.topArtists, topSongs: d.topSongs, songs: d.topSongs.length, artists: d.topArtists.length });
    }

    // ================= LOCAL PLAYLIST / LIKED =================
    function collectionPage({ title, type, cover, tracks, src, meta, editable, pid, desc }) {
        const total = tracks.reduce((s, t) => s + (t.duration_ms || 0), 0) / 1000;
        setTitle(title);
        render(`<div class="page">
            <header class="hero ${type === 'liked' ? 'liked' : ''}">
                <div class="hero-inner">
                    <div class="hero-art ${editable ? 'editable' : ''}" ${editable ? 'data-pact="cover" title="Change picture"' : ''}>${cover}${editable ? `<span class="hero-edit">${ic('image')}</span>` : ''}</div>
                    <div class="hero-text"><span class="hero-type">${pid && (Store.playlist(pid) || {}).smart ? 'Smart playlist' : 'Playlist'}</span>
                        <h1 class="hero-title" ${editable ? 'data-pact="rename" title="Rename"' : ''}>${esc(title)}</h1>
                        ${desc ? `<p class="hero-desc">${esc(desc)}</p>` : ''}
                        <div class="hero-meta">${meta || ''}${tracks.length} songs${total ? ' · ' + Math.round(total / 60) + ' min' : ''}</div></div>
                </div>
            </header>
            <div class="actions">
                <button class="fab xl" data-pact="play" ${tracks.length ? '' : 'disabled'}>${ic('play')}</button>
                <button class="icon-btn lg" data-pact="shuffle" title="Shuffle" ${tracks.length ? '' : 'disabled'}>${ic('shuffle')}</button>
                <button class="icon-btn lg smart-btn" data-pact="smart" title="Smart Shuffle: shuffle + songs with the same vibe" ${tracks.length ? '' : 'disabled'}>${ic('shuffleSmart')}</button>
                ${editable ? `<button class="icon-btn lg" data-pact="more">${ic('more')}</button>` : ''}
            </div>
            ${tracks.length ? UI.trackList(tracks, src) : `<div class="empty big">${ic(type === 'liked' ? 'heart' : 'music')}<p>${type === 'liked' ? 'Songs you like will appear here' : 'This playlist is empty'}</p><small>Tap ${type === 'liked' ? 'the heart' : '⋯ → Add to playlist'} on any song.</small><a class="btn primary" href="#/search">${ic('search')}<span>Search songs</span></a></div>`}
            ${tracks.length ? '<div id="plRecs"></div><div id="plArtists"></div>' : ''}
        </div>`);
        const actions = view();
        actions.addEventListener('click', (e) => {
            const b = e.target.closest('[data-pact]'); if (!b) return;
            const a = b.dataset.pact;
            if (a === 'play') Player.playList(tracks, 0, src);
            if (a === 'shuffle') Player.playList(shuffleArr(tracks), 0, src);
            if (a === 'smart') Player.playSmart(tracks, src);
            if (a === 'rename' || a === 'cover') editDetails(pid);
            if (a === 'more') UI.openMenu(b, [
                (Store.playlist(pid) || {}).smart ? { icon: 'sparkle', label: 'Edit rules', run: () => Tidy.editor(pid) } : null,
                { icon: 'edit', label: 'Edit details', run: () => editDetails(pid) },
                (Store.playlist(pid) || {}).smart ? null : { icon: 'check', label: 'Remove duplicates', run: () => Tidy.removeDupes(pid) },
                (Store.playlist(pid) || {}).smart ? null : { icon: 'queue', label: 'Merge playlists', run: () => Tidy.merge(pid) },
                { icon: 'pin', label: (Store.playlist(pid) || {}).pinned ? 'Unpin' : 'Pin to the top', run: () => { const pp = Store.playlist(pid); Store.updatePlaylist(pid, { pinned: !pp.pinned }); UI.toast(pp.pinned ? 'Pinned' : 'Unpinned'); } },
                { icon: 'folder', label: 'Move to folder', run: () => { const names = [...new Set(Store.playlists().map((x) => x.folder).filter(Boolean))]; UI.promptModal('Folder name' + (names.length ? ' (e.g. ' + names.slice(0, 3).join(', ') + ')' : ''), (Store.playlist(pid) || {}).folder || '', (v) => { Store.updatePlaylist(pid, { folder: v }); UI.toast('Moved to ' + v); }, 'Move'); } },
                { icon: 'share', label: 'Share playlist link', run: () => ShareLink.playlist(Store.playlist(pid)) },
                { icon: 'image', label: 'Change cover picture', run: () => editDetails(pid, true) },
                '-',
                { icon: 'trash', label: 'Delete playlist', danger: true, run: () => UI.confirmModal('Delete playlist?', `“${title}” will be deleted from this device. This can’t be undone.`, 'Delete', () => { Store.deletePlaylist(pid); location.hash = '#/library'; }) },
            ]);
        });
        if (tracks.length) recommendFor(tracks, src, pid && (Store.playlist(pid) || {}).smart ? null : pid);
    }

    // Shrink a picked photo to a square cover we can keep on the device
    function pickCover(cb) {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = () => {
            const f = inp.files[0]; if (!f) return;
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas'); const S = 480; c.width = c.height = S;
                const side = Math.min(img.width, img.height);
                c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
                URL.revokeObjectURL(img.src); cb(c.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = () => UI.toast('That picture couldn’t be opened', 'error');
            img.src = URL.createObjectURL(f);
        };
        inp.click();
    }
    function editDetails(pid, pickNow) {
        const p = Store.playlist(pid); if (!p) return;
        let cover = p.coverImage || null;
        const coverHtml = () => cover ? `<img src="${esc(cover)}" alt="">` : UI.localPlaylistCover({ ...p, coverImage: null });
        UI.modal(`<h3>Edit details</h3>
            <form data-f class="ed-grid">
                <button type="button" class="ed-cover" data-ed="pick" title="Choose photo">${coverHtml()}<span class="ed-over">${ic('image')}<b>Choose photo</b></span></button>
                <div class="ed-fields">
                    <input class="field" name="name" value="${esc(p.name)}" maxlength="60" placeholder="Name" autocomplete="off">
                    <textarea class="field" name="desc" rows="4" maxlength="300" placeholder="Add an optional description">${esc(p.description || '')}</textarea>
                </div>
                <div class="modal-actions ed-actions"><button type="button" class="btn ghost" data-ed="remove" ${p.coverImage ? '' : 'hidden'}>Remove photo</button><span style="flex:1"></span><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div>
            </form>`, (m, close) => {
            const box = m.querySelector('.ed-cover'), rm = m.querySelector('[data-ed="remove"]');
            const repaint = () => { box.innerHTML = coverHtml() + `<span class="ed-over">${ic('image')}<b>Choose photo</b></span>`; rm.hidden = !cover; };
            const choose = () => pickCover((url) => { cover = url; repaint(); });
            box.onclick = choose;
            rm.onclick = () => { cover = null; repaint(); };
            m.querySelector('[data-f]').onsubmit = (e) => {
                e.preventDefault();
                const name = e.target.elements.name.value.trim() || p.name;
                try { Store.updatePlaylist(pid, { name, description: e.target.elements.desc.value.trim(), coverImage: cover }); }
                catch (err) { UI.toast('Picture too big to save', 'error'); return; }
                close(); UI.toast('Playlist updated', 'success'); go();
            };
            if (pickNow) choose();
        });
    }

    const eq0 = () => '<span class="num">♪</span>';
    // "Recommended" songs + artists under a playlist, Spotify style
    async function recommendFor(tracks, src, pid) {
        const tok = navTok;
        const playable = tracks.filter((t) => !t.pending);
        const seeds = shuffleArr((playable.length ? playable : tracks).slice()).slice(0, 3);
        fill('#plRecs', UI.section('Recommended', UI.skeletonList(4)));
        let recs = [];
        try { recs = await Catalog.vibe(seeds, { limit: 40 }); } catch (e) {}
        if (!alive(tok)) return;
        const have = new Set(tracks.map((t) => t.id).concat(tracks.map((t) => (t.name || '').toLowerCase())));
        recs = recs.filter((t) => !have.has(t.id) && !have.has((t.name || '').toLowerCase()));
        let shown = 0;
        const draw = () => {
            const page = recs.slice(shown, shown + 6);
            if (!page.length) { fill('#plRecs', ''); return; }
            const rsrc = { type: 'radio', name: 'Recommended' };
            const lid = UI.regList(page, rsrc);
            fill('#plRecs', `<section class="sec"><div class="sec-head"><div><h2>Recommended</h2><small class="sec-sub">Based on the songs in this playlist</small></div>
                ${recs.length > 6 ? `<button class="btn ghost sm" data-rec="refresh">${ic('sync')}<span>Refresh</span></button>` : ''}</div>
                <div class="tlist rec-list">${page.map((t, i) => `<div class="trow" data-list="${lid}" data-i="${i}" data-id="${esc(t.id)}">
                    <div class="trow-idx">${eq0()}<span class="pi">${ic('play')}</span></div>
                    <div class="trow-main">${UI.art(T.cover(t), 'trow-art', T.title(t))}<div class="trow-text"><div class="trow-title">${esc(T.title(t))}</div><div class="trow-sub">${esc(T.artist(t))}</div></div></div>
                    <div class="trow-dur">${T.dur(t)}</div>
                    ${pid ? `<button class="btn ghost sm rec-add" data-rec="add" data-ri="${i}">Add</button>` : `<button class="icon-btn sm trow-more" data-act="more">${ic('more')}</button>`}
                </div>`).join('')}</div></section>`);
            const box = view().querySelector('#plRecs');
            box.onclick = (e) => {
                const r = e.target.closest('[data-rec]'); if (!r) return;
                e.stopPropagation();
                if (r.dataset.rec === 'refresh') { shown = (shown + 6) % recs.length; draw(); }
                if (r.dataset.rec === 'add') {
                    const t = page[+r.dataset.ri];
                    if (pid && Store.addToPlaylist(pid, t)) {
                        UI.toast('Added to playlist', 'success');
                        recs = recs.filter((x) => x.id !== t.id);
                        const ex = Store.playlist(pid); if (ex) { tracks = ex.tracks.map(Catalog.normalize); }
                        draw();
                    }
                }
            };
        };
        draw();
        // artists
        try {
            const own = [...new Set(tracks.map((t) => t.artists && t.artists[0] && t.artists[0].name).filter(Boolean))];
            const arts = await Catalog.relatedArtists(seeds, own);
            if (alive(tok) && arts.length) fill('#plArtists', UI.section('Artists you might like', `<div class="hrow">${arts.map(UI.artistTile).join('')}</div>`));
        } catch (e) {}
    }

    function playlist(r) {
        const p = Store.playlist(r.id);
        if (!p) { render(`<div class="empty big">${ic('music')}<p>Playlist not found</p><a class="btn" href="#/library">Go to Library</a></div>`); return; }
        if (p.smart) Tidy.refreshAll();
        collectionPage({ title: p.name, type: 'playlist', cover: UI.localPlaylistCover(p), tracks: p.tracks.map(Catalog.normalize), src: { type: 'playlist', id: p.id, name: p.name }, editable: true, pid: p.id, desc: p.description });
    }
    function liked() {
        collectionPage({ title: 'Liked Songs', type: 'liked', cover: `<div class="liked-cover">${ic('heartFill')}</div>`, tracks: Store.liked().map(Catalog.normalize), src: { type: 'liked', name: 'Liked Songs' } });
    }

    // ================= LIBRARY =================
    function library(r) {
        setTitle('Your Library');
        const tab = (r && r.q && r.q.get('tab')) || 'playlists';
        const sort = LS.get('dc_lib_sort', 'recent');
        const pls = Store.playlists().slice();
        const sorters = {
            recent: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
            az: (a, b) => a.name.localeCompare(b.name),
            size: (a, b) => b.tracks.length - a.tracks.length,
            artist: (a, b) => ((a.tracks[0] && T.artist(a.tracks[0])) || 'zzz').localeCompare((b.tracks[0] && T.artist(b.tracks[0])) || 'zzz'),
        };
        pls.sort(sorters[sort] || sorters.recent);
        const card = (p) => `<a class="lib-card" href="#/playlist/${esc(p.id)}">${UI.localPlaylistCover(p, 'lib-art')}<span class="lib-text"><b>${esc(p.name)}</b><small>${p.folder ? esc(p.folder) + ' · ' : ''}${p.tracks.length} songs</small></span>${p.pinned ? `<span class="lib-pin" title="Pinned">${ic('pin')}</span>` : ''}</a>`;
        const tabs = `<div class="chips">${[['playlists', 'Playlists'], ['following', 'Following'], ['folders', 'Folders'], ['history', 'History']].map(([k, n]) => `<a class="chip ${k === tab ? 'on' : ''}" href="#/library${k === 'playlists' ? '' : '?tab=' + k}">${n}</a>`).join('')}</div>`;
        const head = `<header class="page-head"><h1 class="page-h">Library</h1><div class="head-btns"><button class="btn ghost" data-action="import-playlist">${ic('download')}<span>Import</span></button><button class="btn ghost" data-lib="more">${ic('more')}<span>More</span></button><button class="btn ghost" data-action="new-playlist">${ic('plus')}<span>New playlist</span></button></div></header>`;
        let body = '';
        if (tab === 'history') { history(); return; }
        if (tab === 'following') {
            if (!library._fb) { library._fb = true; Bus.on('follow', () => { if (/tab=following/.test(location.hash)) library(parse()); }); }
            const fl = Follow.list();
            body = fl.length ? `<div class="lib-tools"><span class="muted small">Green dot = something new since you last looked</span><button class="btn ghost sm" data-lib="check">${ic('sync')}<span>Check for new songs</span></button></div>
                <div class="follow-grid">${fl.map((a) => { const t = Follow.latest(a.name); return `<a class="follow-card" href="${a.id ? '#/artist/' + esc(a.id) : '#/search?q=' + encodeURIComponent(a.name)}"><span class="follow-art">${UI.art(a.image, '', a.name)}${Follow.isNew(a) ? '<i class="follow-dot" title="New song"></i>' : ''}</span><b>${esc(a.name)}</b><small>${t ? esc(t.name) : '&nbsp;'}</small></a>`; }).join('')}</div>`
                : `<div class="empty big">${ic('user')}<p>No artists followed yet</p><small>Open an artist and tap Follow. New songs show up here and in Release Radar.</small><a class="btn primary" href="#/search">${ic('search')}<span>Search songs</span></a></div>`;
        } else
        if (tab === 'folders') {
            const folders = {};
            Store.playlists().forEach((p) => { if (p.folder) (folders[p.folder] = folders[p.folder] || []).push(p); });
            const names = Object.keys(folders).sort((a, b) => a.localeCompare(b));
            body = names.length ? `<div class="lib-grid">${names.map((n) => `<a class="lib-card" href="#/folder/${encodeURIComponent(n)}"><span class="lib-art folder">${ic('folder')}</span><span class="lib-text"><b>${esc(n)}</b><small>Folder · ${folders[n].length} playlist${folders[n].length === 1 ? '' : 's'}</small></span></a>`).join('')}</div>`
                : `<div class="empty big">${ic('folder')}<p>No folders yet</p><small>Open a playlist, tap ⋯ and choose “Move to folder”.</small></div>`;
        } else {
            const pinned = pls.filter((p) => p.pinned), rest = pls.filter((p) => !p.pinned);
            body = `<div class="lib-tools"><label class="lib-sort">${ic('sort')}<select class="field sm" id="libSort">${[['recent', 'Recently added'], ['az', 'A–Z'], ['artist', 'Artist'], ['size', 'Most songs']].map(([k, n]) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
                <div class="lib-grid">
                    <a class="lib-card" href="#/liked"><span class="lib-art liked">${ic('heartFill')}</span><span class="lib-text"><b>Liked Songs</b><small>${Store.liked().length} songs</small></span></a>
                    ${pinned.map(card).join('')}
                    <a class="lib-card" href="#/wrapped"><span class="lib-art wrapped">${ic('chart')}</span><span class="lib-text"><b>Darcam Wrapped</b><small>Your listening stats</small></span></a>
                    <button class="lib-card" data-action="jam"><span class="lib-art jam">${ic('users')}</span><span class="lib-text"><b>Listen together</b><small>Start or join a Jam</small></span></button>
                    <button class="lib-card" data-action="transfer"><span class="lib-art transfer">${ic('qr')}</span><span class="lib-text"><b>Move to another device</b><small>Send your library with a QR code</small></span></button>
                    ${rest.map(card).join('')}
                </div>`;
        }
        render(`<div class="page library">${head}${tabs}${body}</div>`);
        const sel = view().querySelector('#libSort');
        if (sel) sel.addEventListener('change', () => { LS.set('dc_lib_sort', sel.value); library(r); });
        view().querySelectorAll('[data-lib]').forEach((b) => b.onclick = () => {
            if (b.dataset.lib === 'more') UI.openMenu(b, [
                { icon: 'sparkle', label: 'Smart playlist', run: () => Tidy.editor() },
                { icon: 'queue', label: 'Merge playlists', run: () => Tidy.merge() },
            ]);
            if (b.dataset.lib === 'check') { b.disabled = true; UI.toast('Checking…'); Follow.check(true).then(() => { if (location.hash.includes('following')) library(r); }); }
        });
    }
    function folder(r) {
        const name = r.id;
        const pls = Store.playlists().filter((p) => p.folder === name);
        setTitle(name);
        render(`<div class="page library"><header class="page-head"><h1 class="page-h">${esc(name)}</h1>
            <div class="head-btns"><button class="btn ghost" data-folder="rename">${ic('edit')}<span>Rename</span></button><button class="btn ghost" data-folder="remove">${ic('trash')}<span>Remove folder</span></button></div></header>
            ${pls.length ? `<div class="lib-grid">${pls.map((p) => `<a class="lib-card" href="#/playlist/${esc(p.id)}">${UI.localPlaylistCover(p, 'lib-art')}<span class="lib-text"><b>${esc(p.name)}</b><small>${p.tracks.length} songs</small></span></a>`).join('')}</div>` : `<div class="empty">This folder is empty</div>`}</div>`);
        view().querySelectorAll('[data-folder]').forEach((b) => b.onclick = () => {
            if (b.dataset.folder === 'rename') UI.promptModal('Rename folder', name, (v) => { pls.forEach((p) => Store.updatePlaylist(p.id, { folder: v })); location.hash = '#/folder/' + encodeURIComponent(v); });
            else UI.confirmModal('Remove folder?', 'The playlists stay in your Library; only the folder goes.', 'Remove', () => { pls.forEach((p) => Store.updatePlaylist(p.id, { folder: '' })); location.hash = '#/library?tab=folders'; });
        });
    }
    function history() {
        setTitle('History');
        const all = History.all();
        const dayName = (ts) => { const d = new Date(ts), t = new Date(); const k = (x) => x.toDateString(); if (k(d) === k(t)) return 'Today'; t.setDate(t.getDate() - 1); if (k(d) === k(t)) return 'Yesterday'; return d.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short' }); };
        render(`<div class="page library"><header class="page-head"><h1 class="page-h">Library</h1></header>
            <div class="chips"><a class="chip" href="#/library">Playlists</a><a class="chip" href="#/library?tab=folders">Folders</a><a class="chip on" href="#/library?tab=history">History</a></div>
            <div class="hist-tools"><input class="field" id="histQ" placeholder="Search your history" autocomplete="off"><span class="muted small">${all.length.toLocaleString()} songs played</span>${all.length ? '<button class="btn ghost sm" data-hist="clear">Clear</button>' : ''}</div>
            <div id="histList"></div></div>`);
        const draw = (q) => {
            const nq = (q || '').toLowerCase();
            const rows = all.filter((h) => !nq || (h.n + ' ' + h.a).toLowerCase().includes(nq)).slice(0, 400);
            if (!rows.length) { fill('#histList', `<div class="empty">${all.length ? 'Nothing matches' : 'Songs you play for 30 seconds or more show up here'}</div>`); return; }
            let html = '', cur = '';
            const groups = [];
            rows.forEach((h) => { const g = dayName(h.at); if (g !== cur) { groups.push({ g, items: [] }); cur = g; } groups[groups.length - 1].items.push(h); });
            groups.forEach((grp) => {
                const tracks = grp.items.map((h) => Stats.toTrack({ id: h.y, y: h.y, name: h.n, a: h.a, aid: h.aid, c: h.c, d: h.d }));
                html += `<section class="sec"><div class="sec-head"><h2>${esc(grp.g)}</h2></div>${UI.trackList(tracks, { type: 'history', name: 'History' }, { noIndex: true })}</section>`;
            });
            fill('#histList', html);
        };
        draw('');
        const q = view().querySelector('#histQ');
        q.addEventListener('input', debounce(() => draw(q.value), 200));
        const c = view().querySelector('[data-hist="clear"]');
        if (c) c.onclick = () => UI.confirmModal('Clear history?', 'Your full listening history on this device will be deleted. Wrapped stats stay.', 'Clear', () => { History.clear(); Store.clearRecent(); history(); });
    }

    // ================= SETTINGS =================
    function settings() {
        setTitle('Settings');
        const s = Store.settings;
        const tog = (k, label, desc) => `<label class="set-row"><span><b>${label}</b><small>${desc}</small></span><input type="checkbox" class="switch" data-set="${k}" ${s[k] ? 'checked' : ''}></label>`;
        const langs = [['en', 'English'], ['ms', 'Malay'], ['id', 'Indonesian'], ['zh-CN', '中文'], ['ja', '日本語'], ['ko', '한국어'], ['ta', 'தமிழ்'], ['ar', 'العربية']];
        render(`<div class="page settings">
            <h1 class="page-h">Settings</h1>
            <section class="set-group"><h3>Playback</h3>
                ${tog('autoplay', 'Autoplay', 'Play similar songs when the queue ends')}
                <label class="set-row"><span><b>Crossfade</b><small>The next song fades in while the current one fades out</small></span>
                    <select class="field sm" data-set="crossfade">${[[0, 'Off'], [2, '2 s'], [4, '4 s'], [6, '6 s (default)'], [8, '8 s'], [10, '10 s'], [12, '12 s']].map(([v, n]) => `<option value="${v}" ${parseFloat(s.crossfade ?? 6) === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
                <div class="set-row"><span><b>Car mode</b><small>Big buttons for when your phone is in a car holder</small></span><button class="btn ghost sm" data-sact="car">${ic('car')}<span>Open</span></button></div>
            </section>
            <section class="set-group"><h3>Language</h3>
                <div class="set-row"><span><b>App language</b><small>Song names and lyrics stay as they are</small></span>
                    <div class="seg2" data-notr>${[['en', 'English'], ['ms', 'Bahasa Melayu']].map(([k, n]) => `<button class="${I18n.lang === k ? 'on' : ''}" data-lang="${k}">${n}</button>`).join('')}</div></div>
            </section>
            <section class="set-group"><h3>Lyrics</h3>
                ${tog('lyricsKaraoke', 'Karaoke effect', 'Fill the current line as it’s sung')}
                ${tog('lyricsBlur', 'Focus on current line', 'Blur the lines further away, like Apple Music')}
                ${tog('lyricsInNotif', 'Lyrics outside the app', 'Show the current line in the Dynamic Island and music notification')}
                <label class="set-row"><span><b>Lyrics text size</b><small>Small, medium or large</small></span>
                    <select class="field sm" data-set="lyricsSize"><option value="s" ${s.lyricsSize === 's' ? 'selected' : ''}>Small</option><option value="m" ${s.lyricsSize === 'm' ? 'selected' : ''}>Medium</option><option value="l" ${s.lyricsSize === 'l' ? 'selected' : ''}>Large</option></select></label>
                <label class="set-row"><span><b>Lyrics timing</b><small>If lyrics show before the singer, delay them more</small></span>
                    <select class="field sm" data-set="lyricsDelay">${[[0, 'No delay'], [0.2, '0.2 s later'], [0.35, '0.35 s later (default)'], [0.5, '0.5 s later'], [0.75, '0.75 s later'], [1, '1 s later'], [1.5, '1.5 s later']].map(([v, n]) => `<option value="${v}" ${parseFloat(s.lyricsDelay ?? 0.35) === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
                <label class="set-row"><span><b>Video behind lyrics</b><small>Play the music video softly behind the lyrics</small></span>
                    <select class="field sm" data-set="videoBg">${[['off', 'Off'], ['on', 'On'], ['wifi', 'Wi-Fi only']].map(([v, n]) => `<option value="${v}" ${(s.videoBg || 'wifi') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
                <label class="set-row"><span><b>Translate to</b><small>Language for the Translate button</small></span>
                    <select class="field sm" data-set="translateTo">${langs.map(([k, n]) => `<option value="${k}" ${s.translateTo === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            </section>
            <section class="set-group" id="islandGroup" hidden><h3>Dynamic Island</h3>
                <label class="set-row"><span><b>Show Dynamic Island</b><small>Song and lyrics at the top of the screen when you leave Darcam</small></span><input type="checkbox" class="switch" id="islandOn"></label>
                <div class="set-row"><span><b>Island log</b><small id="ilogTxt">Last buttons pressed in the island or notification</small></span><button class="btn ghost sm" id="ilogBtn">Show</button></div>
                <div class="set-row" id="overlayRow" hidden><span><b>“Display over other apps” permission</b><small id="overlayTxt">Android needs this for the island</small></span><button class="btn primary sm" id="overlayBtn">Allow</button></div>
            </section>
            <section class="set-group" id="winGroup" hidden><h3>Windows</h3>
                <label class="set-row"><span><b>Keep playing when the window is closed</b><small>Darcam stays next to the clock. Right-click it there to quit.</small></span><input type="checkbox" class="switch" id="wTray"></label>
                <label class="set-row"><span><b>Start with Windows</b><small>Open Darcam when you sign in</small></span><input type="checkbox" class="switch" id="wLogin"></label>
                <label class="set-row"><span><b>Show what you play on Discord</b><small>“Listening to … on Darcam” on your Discord profile. Needs the Discord app open on this PC and a Darcam Application ID (below).</small></span><input type="checkbox" class="switch" id="wDiscord"></label>
                <details class="adv"><summary>Discord Application ID</summary>
                    <p class="muted small">One-time setup (free): open <b>discord.com/developers/applications</b> → <b>New Application</b> → name it <b>Darcam</b> → copy the <b>Application ID</b> and paste it here. The name you give it is what Discord shows (“Listening to Darcam”).</p>
                    <input class="field sm" id="wDiscordId" inputmode="numeric" placeholder="e.g. 1234567890123456789" style="min-width:260px">
                </details>
            </section>
            <section class="set-group"><h3>Sharing &amp; Jam</h3>
                <label class="set-row"><span><b>Your Darcam website</b><small>${Site.onWeb() ? 'This website: ' + esc(Site.base()) : 'Where you put the web version (with yt.php and jam.php). Share links and Jam use it.'}</small></span>${Site.onWeb() ? '' : `<input class="field sm" id="siteIn" placeholder="example.com/darcam" value="${esc(localStorage.getItem('dc_site') || '')}" style="min-width:220px">`}</label>
                <label class="set-row"><span><b>Your name</b><small>Friends see it in a Jam</small></span><input class="field sm" id="nameIn" maxlength="24" placeholder="Your name" value="${esc(localStorage.getItem('dc_name') || '')}"></label>
            </section>
            <section class="set-group" id="notifGroup" ${window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? '' : 'hidden'}><h3>Notifications</h3>
                <label class="set-row"><span><b>New songs from artists you follow</b><small>A notification when an artist you follow releases a song (checked while Darcam is open or playing)</small></span><input type="checkbox" class="switch" id="notifNew" ${ReleaseNotify.on() ? 'checked' : ''}></label>
            </section>
            <section class="set-group"><h3>Updates</h3>
                <div class="set-row"><span><b>Check for updates</b><small>${Site.base() ? 'From ' + esc(Site.base()) + 'version.json' : 'Set your Darcam website above first'}</small></span><button class="btn ghost sm" data-sact="update">Check now</button></div>
            </section>
            <section class="set-group desk-only"><h3>Keyboard shortcuts</h3>
                <div class="kbd-list">${Shortcuts.LIST.map(([k, d]) => `<div><span>${esc(d)}</span><kbd>${esc(k)}</kbd></div>`).join('')}</div>
            </section>
            <section class="set-group"><h3>Your data</h3>
                <p class="muted small">Darcam has no accounts. Your playlists, likes and history stay on this device only. Make a backup to move them to another device.</p>
                <div class="set-btns">
                    <button class="btn ghost" data-sact="export">${ic('download')}<span>Backup library</span></button>
                    <button class="btn ghost" data-sact="import">${ic('upload')}<span>Restore backup</span></button>
                    <button class="btn ghost" data-sact="clear-search">${ic('history')}<span>Clear search history</span></button>
                    <button class="btn ghost" data-sact="clear-cache">${ic('trash')}<span>Clear cache</span></button>
                </div>
                <input type="file" id="importPick" accept="application/json,.json" hidden>
            </section>
            <section class="set-group" id="installGroup" ${window.__dcInstall ? '' : 'hidden'}><h3>App</h3>
                <div class="set-row"><span><b>Install Darcam</b><small>Open it from your home screen like a normal app</small></span><button class="btn primary sm" data-sact="install">Install</button></div>
            </section>
            <section class="set-group"><h3>Advanced</h3>
                <div class="set-row"><span><b>Test search engine</b><small id="itResult">Checks search, autoplay, artist pages and charts</small></span><button class="btn ghost sm" data-sact="it-test">Test</button></div>
            </section>
            <footer class="about"><span class="about-mark">${LOGO_SVG}</span><div><b>darcam</b><small>Version ${APP_VERSION} · no account, no ads</small></div></footer>
        </div>`);
        const v = view();
        const siteIn = v.querySelector('#siteIn'), nameIn = v.querySelector('#nameIn');
        if (window.darcamNative && window.darcamNative.winPrefs) {
            v.querySelector('#winGroup').hidden = false;
            window.darcamNative.winPrefs().then((p) => {
                v.querySelector('#wTray').checked = !!p.closeToTray; v.querySelector('#wLogin').checked = !!p.openAtLogin;
                v.querySelector('#wDiscord').checked = !!p.discord; v.querySelector('#wDiscordId').value = p.discordId || '';
            });
            const setP = (o) => { window.darcamNative.setWinPrefs(o); UI.toast('Saved'); };
            v.querySelector('#wTray').addEventListener('change', (e) => { e.stopPropagation(); setP({ closeToTray: e.target.checked }); });
            v.querySelector('#wLogin').addEventListener('change', (e) => { e.stopPropagation(); setP({ openAtLogin: e.target.checked }); });
            v.querySelector('#wDiscord').addEventListener('change', (e) => {
                e.stopPropagation();
                if (e.target.checked && !v.querySelector('#wDiscordId').value.trim()) { v.querySelector('.set-group#winGroup details').open = true; UI.toast('Paste your Darcam Application ID first'); }
                setP({ discord: e.target.checked });
            });
            v.querySelector('#wDiscordId').addEventListener('change', (e) => { e.stopPropagation(); setP({ discordId: e.target.value }); });
        }
        v.querySelectorAll('[data-lang]').forEach((b) => b.onclick = () => { if (b.dataset.lang !== I18n.lang) I18n.set(b.dataset.lang); });
        const nn = v.querySelector('#notifNew');
        if (nn) nn.addEventListener('change', (e) => { e.stopPropagation(); ReleaseNotify.set(e.target.checked); const pl = window.Capacitor.Plugins.DarcamIsland; if (e.target.checked && pl && pl.requestNotifications) pl.requestNotifications().catch(() => {}); UI.toast('Saved'); });
        if (siteIn) siteIn.addEventListener('change', (e) => { e.stopPropagation(); Site.set(siteIn.value); UI.toast('Saved'); });
        if (nameIn) nameIn.addEventListener('change', (e) => { e.stopPropagation(); localStorage.setItem('dc_name', nameIn.value.trim().slice(0, 24)); UI.toast('Saved'); });
        v.addEventListener('change', (e) => {
            const el = e.target.closest('[data-set]'); if (!el) return;
            Store.setSetting(el.dataset.set, el.type === 'checkbox' ? el.checked : el.value);
            Lyrics.render();
            UI.toast('Saved');
        });
        v.addEventListener('click', (e) => {
            const b = e.target.closest('[data-sact]'); if (!b) return;
            const a = b.dataset.sact;
            if (a === 'export') {
                const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
                const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'darcam-backup-' + new Date().toISOString().slice(0, 10) + '.json'; link.click();
                setTimeout(() => URL.revokeObjectURL(link.href), 2000);
            }
            if (a === 'import') $('#importPick').click();
            if (a === 'car') CarMode.open();
            if (a === 'update') Updater.check(true);
            if (a === 'clear-search') { Store.clearSearches(); UI.toast('Search history cleared'); }
            if (a === 'clear-cache') { Object.keys(localStorage).filter((k) => /^(dc_cache_v2:|yt_cache_v1:|dc_lyrics)/.test(k)).forEach((k) => localStorage.removeItem(k)); UI.toast('Cache cleared'); }
            if (a === 'it-test') {
                const out = $('#itResult'); out.textContent = 'Testing…'; b.disabled = true;
                Catalog.testUnlimited().then((r) => {
                    out.innerHTML = ['search', 'radio', 'artists', 'artistPage', 'charts'].map((k) => `<span style="display:block">${esc({ search: 'Search', radio: 'Autoplay', artists: 'Artists', artistPage: 'Artist page', charts: 'Charts' }[k])}: ${esc(r[k] || '—')}</span>`).join('') + `<span style="display:block">Time: ${r.ms} ms</span>`;
                }).finally(() => (b.disabled = false));
            }
            if (a === 'install' && window.__dcInstall) { window.__dcInstall.prompt(); window.__dcInstall.userChoice.finally(() => { window.__dcInstall = null; $('#installGroup').hidden = true; }); }
        });
        // Dynamic Island controls (Android / Windows app only)
        if (window.DarcamBridge && DarcamBridge.island.native()) {
            const g = $('#islandGroup'); g.hidden = false;
            const refresh = async () => {
                const st = await DarcamBridge.island.status();
                $('#islandOn').checked = st.enabled !== false;
                const needs = DarcamBridge.island.isAndroid() && !st.overlay;
                $('#overlayRow').hidden = !needs;
            };
            refresh();
            $('#islandOn').addEventListener('change', (e) => { DarcamBridge.island.setEnabled(e.target.checked); UI.toast(e.target.checked ? 'Dynamic Island on' : 'Dynamic Island off'); });
            $('#overlayBtn').addEventListener('click', () => DarcamBridge.island.requestOverlay());
            $('#ilogBtn').addEventListener('click', () => {
                const l = DarcamBridge.island.log();
                const names = { '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };
                $('#ilogTxt').innerHTML = l.length ? l.map((r) => `<span style="display:block">${esc(r.at)} · <b>${esc(r.c)}</b> · ${esc(names[r.before] ?? r.before)} → ${esc(names[r.after] ?? r.after)} (app: ${esc(r.was)} → ${esc(r.now)})</span>`).join('') : 'Nothing yet: press a button in the island, then come back here';
            });
            document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#islandGroup')) refresh(); });
        }
        $('#importPick').addEventListener('change', async (e) => {
            const f = e.target.files[0]; if (!f) return;
            try { Store.importJSON(await f.text()); UI.toast('Library restored', 'success'); } catch (err) { UI.toast('That backup file isn’t valid', 'error'); }
        });
    }

    const routes = { home, search, artist, list, playlist, liked, library, settings, mix, wrapped, folder, genre, s: sharedSong, p: sharedList, jam: jamLink };
    return { go, playRemotePlaylist };
})();
