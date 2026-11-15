/* Darcam — music catalogue.
   Talks to the search API, cleans titles/artists into a Spotify-like
   track model, and caches everything to keep the daily quota low. */
'use strict';

const Catalog = (() => {
    // old versions kept a search key here; it is no longer used
    try { localStorage.removeItem('yt_api_key'); localStorage.removeItem('yt_api_key_idx'); } catch (e) {}

    // ---------- cache ----------
    const CP = 'dc_cache_v2:';
    function cget(k) {
        const v = LS.get(CP + k, null);
        if (!v) return null;
        if (v.exp < Date.now()) { LS.del(CP + k); return null; }
        return v.d;
    }
    function cset(k, d, ttl) {
        if (!LS.set(CP + k, { exp: Date.now() + ttl, d })) {
            // storage full → drop old cache entries and retry once
            Object.keys(localStorage).filter((x) => x.startsWith(CP) || x.startsWith('yt_cache_v1:')).slice(0, 80).forEach((x) => localStorage.removeItem(x));
            LS.set(CP + k, { exp: Date.now() + ttl, d });
        }
    }
    const H = 3600e3;


    // ---------- metadata cleaning ----------
    const JUNK_IN_BRACKETS = /(official|video|audio|lyric|lirik|lyrics|\bm\/?v\b|\bmv\b|hd|hq|4k|8k|visuali[sz]er|music\s*video|muzik|rasmi|klip|teaser|trailer|color\s*coded|eng\s*sub|sub(title)?s?|explicit|clean|full\s*song|performance|dance\s*practice|special\s*clip|ost\b|from\s+["“]?)/i;
    const KEEP_IN_BRACKETS = /\b(live|acoustic|remix|cover|remaster(ed)?|version|edit|mix|unplugged|instrumental|sped\s*up|slowed|feat\.?|ft\.?|with)\b/i;

    function stripJunk(t) {
        let s = t;
        // brackets: (...) [...] 【...】 「...」
        s = s.replace(/\s*[\(\[【「（]([^\)\]】」）]*)[\)\]】」）]/g, (m, inner) => {
            if (/^\s*(feat\.?|ft\.?)\s/i.test(inner)) return ' (feat. ' + inner.replace(/^\s*(feat\.?|ft\.?)\s*/i, '') + ')';
            if (KEEP_IN_BRACKETS.test(inner) && !/official|video|lyric|lirik/i.test(inner)) return ' (' + inner.trim() + ')';
            return JUNK_IN_BRACKETS.test(inner) ? '' : m;
        });
        // trailing junk after | or - or ‧
        s = s.replace(/\s*[|│｜‧•]\s*(official|lyric|lirik|music|video|audio|mv|m\/v|4k|hd)[^|]*$/i, '');
        s = s.replace(/\s*[-–—]\s*(official\s*)?(music\s*)?(video\s*song|lyrical(\s*video)?|full\s*video|video|audio|lyrics?|lirik|mv|m\/v|visuali[sz]er)\s*$/i, '');
        s = s.replace(/\s+(official\s+)?(music\s+video|lyric\s+video|video\s+klip|video\s+lirik|lirik\s+video|m\/v|mv)\s*$/i, '');
        s = s.replace(/\s+official(\s+(4k|hd|mv|m\/v|video|audio|music\s*video|lyric\s*video))*\s*$/i, '');
        s = s.replace(/\s+lyrical(\s+video)?(?=\s*(\(|$))/i, '');
        s = s.replace(/\s+(ft\.?|feat\.?)\s+/i, ' feat. ');
        s = s.replace(/\s*#\w+/g, '');
        s = s.replace(/\s*[-–—|｜:]+\s*$/, '');
        s = s.replace(/\s{2,}/g, ' ').trim();
        return s;
    }

    function cleanArtist(ch) {
        return (ch || '')
            .replace(/\s*-\s*Topic$/i, '')
            .replace(/VEVO$/i, '')
            .replace(/\s*(official(\s*(channel|music))?|\bmusic\b|\btv\b)\s*$/i, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function unquote(s) {
        // 'Shut Down' / “Shut Down” → Shut Down
        return s.replace(/^\s*['"‘’“”]+\s*/, '').replace(/\s*['"‘’“”]+\s*$/, '').replace(/\s['"‘“]([^'"’”]+)['"’”]/g, ' $1').trim();
    }

    // Artist names Darcam has learned (artist channels, topic channels, searches)
    const nrm = (x) => (x || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
    // v2: older versions sometimes learned song titles as singers — start the list fresh once
    if (LS.get('dc_artists_v', 1) < 4) { LS.del('dc_artists'); LS.set('dc_artists_v', 4); }
    const KNOWN = new Set(LS.get('dc_artists', []));
    const saveKnown = debounce(() => LS.set('dc_artists', [...KNOWN].slice(-3000)), 800);
    function learnArtist(name) {
        const n = nrm(name);
        if (n.length < 2 || n.length > 40 || KNOWN.has(n)) return;
        KNOWN.add(n); saveKnown();
    }
    const firstArtist = (x) => (x || '').split(/\s*(?:&|,|\s[xX×]\s|\bfeat\.?|\bft\.?|\bwith\b|\bdan\b)\s*/i)[0];

    function pickArtist(left, right, artist, desc) {
        const L = nrm(left), R = nrm(right), A = nrm(artist);
        if (A.length > 1) {
            if (L.includes(A) || (L.length > 3 && A.includes(L))) return 'left';
            if (R.includes(A) || (R.length > 3 && A.includes(R))) return 'right';
        }
        const kl = KNOWN.has(nrm(firstArtist(left))), kr = KNOWN.has(nrm(firstArtist(right)));
        if (kl && !kr) return 'left';
        if (kr && !kl) return 'right';
        const d = String(desc || '').toLowerCase();
        // the song title is usually the one in quotes: ... iaitu 'Selesa'
        const quoted = (x) => x.length > 1 && new RegExp('[\'"‘“«]\\s*' + x.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[\'"’”»]').test(d);
        const qL = quoted(left), qR = quoted(right);
        if (qL && !qR) return 'right';
        if (qR && !qL) return 'left';
        const by = d.match(/(?:\bby|\boleh|\bdari|\bfrom|artist[e]?\s*:|penyanyi\s*:|singer\s*:|performed by|nyanyian)\s*:?\s*([^\n,|.]{2,60})/i);
        if (by) {
            const who = nrm(by[1]);
            if (R && (who.startsWith(R) || who.startsWith(nrm(firstArtist(right))))) return 'right';
            if (L && (who.startsWith(L) || who.startsWith(nrm(firstArtist(left))))) return 'left';
        }
        return 'left';
    }

    function parseMeta(rawTitle, channel, desc, tags) {
        const raw = decodeEntities(rawTitle || '');
        const ch = decodeEntities(channel || '');
        const isTopic = / - Topic$/i.test(ch);
        let artist = cleanArtist(ch);
        let title = stripJunk(raw);
        // "Song - Video Song | Movie | Actor" or "Title | A | B | C" → drop the pipe tail
        const pipes = (title.match(/\s[|｜]\s/g) || []).length;
        if (pipes >= 2 || (pipes && /\s[-–—]\s/.test(title))) title = title.split(/\s[|｜]\s/)[0];
        title = stripJunk(title);
        let halves = null;
        if (isTopic) learnArtist(artist);
        // "... - ChannelName" tails from lyric channels
        if (artist && artist.length > 2) {
            const chRx = new RegExp('\\s*[-–—|｜]\\s*' + artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
            if (chRx.test(title) && /\s[-–—]\s/.test(title.replace(chRx, ''))) title = title.replace(chRx, '');
        }
        // K-pop style: ARTIST 'Title' M/V  (no dash)
        if (!isTopic && !/\s[-–—|｜]\s/.test(title)) {
            const k = stripJunk(raw).match(/^(.{1,45}?)\s+['‘“](.{1,80}?)['’”](?=\s*(?:$|m\/?v\b|mv\b|official|teaser|special|performance|dance|\(|\[))/i);
            if (k) { learnArtist(firstArtist(k[1])); title = k[1].trim() + ' - ' + k[2].trim(); }
        }
        if (!isTopic) {
            const m = title.match(/^(.{1,70}?)\s+[-–—|｜]\s+(.+)$/) || title.match(/^(.{1,70}?)\s*[-–—]\s*['"‘“](.+?)['"’”].*$/);
            if (m) {
                const left = unquote(m[1].trim()), right = unquote(stripJunk(m[2].trim()));
                const side = pickArtist(left, right, artist, desc);
                halves = { left, right, side };
                if (side === 'right') { title = left; artist = right; } else { artist = left; title = right; }
                if (nrm(artist).includes(nrm(cleanArtist(ch))) && nrm(cleanArtist(ch)).length > 2) learnArtist(firstArtist(artist));
            }
        }
        title = unquote(stripJunk(title));
        artist = unquote(artist.replace(/\s*[xX×&,]\s*$/, ''));
        if (!title) title = raw;
        const kind = isTopic ? 'song'
            : /official\s*(music\s*)?video|\bm\/?v\b|music\s*video|video\s*klip|muzik\s*video|video\s*song|performance\s*video|dance|live\s+(at|in|on)|concert/i.test(raw) ? 'video' : 'song';
        return { title, artist: artist || 'Unknown', kind, isTopic, halves };
    }

    function thumbs(sn) {
        const t = (sn && sn.thumbnails) || {};
        const sm = (t.medium && t.medium.url) || (t.default && t.default.url) || '';
        const lg = (t.maxres && t.maxres.url) || (t.standard && t.standard.url && t.medium && t.medium.url) || (t.medium && t.medium.url) || sm;
        return { sm: sm.replace(/^http:/, 'https:'), lg: lg.replace(/^http:/, 'https:') };
    }


    function toTrack(id, sn, extra = {}) {
        const meta = parseMeta(sn.title, sn.videoOwnerChannelTitle || sn.channelTitle, sn.description, sn.tags);
        const th = thumbs(sn);
        return {
            id, youtube_id: id,
            name: meta.title,
            artists: [{ name: meta.artist, id: sn.videoOwnerChannelId || sn.channelId || '' }],
            album: { name: meta.artist, images: [{ url: th.sm }] },
            cover: th.sm, cover_lg: th.lg,
            channelId: sn.videoOwnerChannelId || sn.channelId || '',
            kind: meta.kind,
            topic: !!meta.isTopic,
            duration_ms: (extra.duration || 0) * 1000,
            views: extra.views || 0,
            _h: meta.halves,
        };
    }

    // Normalise anything stored by older versions
    function normalize(t) {
        if (!t) return t;
        if (t._n) return t;
        const out = { ...t };
        if (!t.cover_lg) {
            const meta = parseMeta(t.name, (t.artists && t.artists[0] && t.artists[0].name) || '');
            out.name = meta.title;
            out.artists = [{ name: meta.artist, id: t.channelId || '' }];
            const u = (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) || '';
            const vid = t.youtube_id || t.id;
            out.cover = t.cover || u || (vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : '');
            out.cover_lg = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : out.cover;
        }
        out._n = 1;
        return out;
    }



    // In one batch of results, the name that keeps coming back is the artist
    function consensus(tracks, hint, avoid) {
        const freq = {};
        // avoid: the song title someone typed — it shows up in every result but is never the singer
        const av = nrm(avoid || '');
        const isAv = (x) => { const n = nrm(firstArtist(x)); return av.length > 3 && (n === av || n.includes(av)); };
        const bump = (x, w = 1) => { const n = nrm(firstArtist(x)); if (n.length > 1 && !isAv(x)) freq[n] = (freq[n] || 0) + w; };
        tracks.forEach((t) => { if (t._h) { bump(t._h.left); bump(t._h.right); } else bump(t.artists[0].name, 2); });
        // only trust the hint when it really is a singer's name (not a song title typed into search)
        if (hint && KNOWN.has(nrm(firstArtist(hint)))) bump(hint, 3);
        tracks.forEach((t) => {
            const h = t._h; if (!h) return;
            const fl = freq[nrm(firstArtist(h.left))] || 0, fr = freq[nrm(firstArtist(h.right))] || 0;
            let want = fr > fl ? 'right' : fl > fr ? 'left' : h.side;
            if (isAv(h.left) && !isAv(h.right)) want = 'right';
            else if (isAv(h.right) && !isAv(h.left)) want = 'left';
            if (want !== h.side) {
                h.side = want;
                const artist = want === 'right' ? h.right : h.left, title = want === 'right' ? h.left : h.right;
                t.name = title; t.artists = [{ ...t.artists[0], name: artist }]; t.album = { ...t.album, name: artist };
            }
            if (Math.max(fl, fr) >= 3 && Math.abs(fl - fr) >= 2 && !isAv(t.artists[0].name)) learnArtist(firstArtist(t.artists[0].name));
        });
        tracks.forEach((t) => delete t._h);
        return fixSwaps(tracks);
    }
    // "Song — Singer" the wrong way round: the title is a known singer and the artist isn't
    function fixSwaps(tracks) {
        tracks.forEach((t) => {
            if (t.topic) return;
            const a = t.artists[0].name, n = nrm(firstArtist(t.name)), na = nrm(firstArtist(a));
            if (n.length > 1 && KNOWN.has(n) && !KNOWN.has(na)) { t.artists = [{ ...t.artists[0], name: t.name }]; t.name = a; t.album = { ...t.album, name: t.artists[0].name }; }
        });
        return tracks;
    }



    // =====================================================================
    // Unlimited engine (InnerTube). Every function returns null when it can't help,
    // and the caller uses the key-based API instead.
    // =====================================================================
    const IT = typeof InnerTube !== 'undefined' ? InnerTube : { enabled: () => false, supported: () => false };
    async function itGet(kind, endpoint, body, ttl) {
        const ck = 'it:' + kind + ':' + endpoint + ':' + JSON.stringify(body);
        const hit = cget(ck); if (hit) return hit;
        const j = await IT.call(kind, endpoint, body);
        cset(ck, j, ttl);
        return j;
    }
    const ytThumbs = (id) => ({ medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` }, maxres: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } });
    // a YouTube search result → Darcam track (same cleaning as the key-based results)
    function itVideo(v, opts = {}) {
        const id = v.videoId; if (!id) return null;
        const dur = IT.secs(IT.text(v.lengthText));
        if (!dur || dur < (opts.min || 45) || dur > (opts.max || 20 * 60)) return null;
        const own = (v.ownerText || v.longBylineText || {}).runs || [];
        const ch = own[0] ? own[0].text : '';
        const chId = (own[0] && own[0].navigationEndpoint && own[0].navigationEndpoint.browseEndpoint && own[0].navigationEndpoint.browseEndpoint.browseId) || '';
        const badges = (v.ownerBadges || []).map((b) => b.metadataBadgeRenderer && b.metadataBadgeRenderer.style).join(' ');
        if (/VERIFIED_ARTIST/.test(badges)) learnArtist(cleanArtist(ch));
        const desc = (v.detailedMetadataSnippets || []).map((d) => IT.text(d.snippetText)).join(' ');
        const sn = { title: IT.text(v.title), channelTitle: ch, channelId: chId, description: desc, thumbnails: ytThumbs(id) };
        const tr = toTrack(id, sn, { duration: dur, views: IT.num(IT.text(v.viewCountText)) });
        // "3 days ago" → seconds, for "new" lists
        const pm = IT.text(v.publishedTimeText).match(/(\d+)\s*(second|minute|hour|day|week|month|year)/i);
        if (pm) tr.ago = +pm[1] * ({ second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 }[pm[2].toLowerCase()]);
        return tr;
    }
    // a YouTube Music queue item (radio) → track
    function itPanel(p) {
        const id = p.videoId; if (!id) return null;
        const dur = IT.secs(IT.text(p.lengthText));
        if (dur && (dur < 45 || dur > 20 * 60)) return null;
        const by = (p.longBylineText || p.shortBylineText || {}).runs || [];
        const mvt = (IT.first(p.navigationEndpoint, 'watchEndpointMusicConfig') || {}).musicVideoType || '';
        const artistRuns = by.filter((r) => r.navigationEndpoint && r.navigationEndpoint.browseEndpoint && /ARTIST/.test(JSON.stringify(r.navigationEndpoint.browseEndpoint)));
        const who = artistRuns.length ? artistRuns.map((r) => r.text).join(', ') : (by[0] ? by[0].text : '');
        const whoId = (artistRuns[0] || by[0] || {}).navigationEndpoint ? ((artistRuns[0] || by[0]).navigationEndpoint.browseEndpoint || {}).browseId || '' : '';
        // official audio ("song") items already have a clean title + artist
        const ch = /ATV/.test(mvt) ? who + ' - Topic' : who;
        const sn = { title: IT.text(p.title), channelTitle: ch, channelId: whoId, description: '', thumbnails: ytThumbs(id) };
        return toTrack(id, sn, { duration: dur });
    }
    function itChannel(c) {
        const th = ((c.thumbnail && c.thumbnail.thumbnails) || []).slice(-1)[0];
        const raw = IT.text(c.title);
        const badges = (c.ownerBadges || []).map((b) => b.metadataBadgeRenderer && b.metadataBadgeRenderer.style).join(' ');
        // newer answers put the subscriber count in videoCountText
        const subs = Math.max(IT.num(IT.text(c.subscriberCountText).replace(/^@.*/, '')), IT.num(/subscriber/i.test(IT.text(c.videoCountText)) ? IT.text(c.videoCountText) : ''));
        const topic = / - Topic$/i.test(raw);
        return { type: 'artist', id: c.channelId, name: cleanArtist(raw), image: IT.bigImg(th && th.url), image_fb: IT.https(th && th.url), desc: IT.text(c.descriptionSnippet),
            topic, subs, strong: topic || /VERIFIED_ARTIST/.test(badges), real: topic || /VERIFIED_ARTIST/.test(badges) || subs >= 20000 };
    }
    async function itVideoItems(q) {
        const j = await itGet('web', 'search', { query: q, params: 'EgIQAQ==' }, 6 * H);
        return IT.all(j, 'videoRenderer');
    }
    function parseVideos(items, opts = {}) {
        return consensus(items.map((v) => itVideo(v, opts)).filter(Boolean), opts.hint, opts.avoid);
    }
    async function itSearchVideos(q, opts = {}) {
        return parseVideos(await itVideoItems(q), { ...opts, hint: opts.hint || q });
    }
    // What someone typed into search: a singer, or a song title? Ask for artists first, then read the songs.
    async function songQuery(q) {
        const [items, artists] = await Promise.all([itVideoItems(q), itSearchChannels(q).catch(() => [])]);
        const nq = nrm(q);
        const isArtist = KNOWN.has(nq) || artists.some((a) => nrm(a.name) === nq);
        const tracks = parseVideos(items, isArtist ? { hint: q } : { avoid: q });
        return { tracks, artists, isArtist };
    }
    async function itSearchChannels(q) {
        const j = await itGet('web', 'search', { query: q, params: 'EgIQAg==' }, 12 * H);
        const seen = new Set();
        const raw = IT.all(j, 'channelRenderer');
        // "Name - Topic" channels are made by YouTube for real artists
        raw.forEach((c) => { const t = IT.text(c.title); if (/ - Topic$/i.test(t)) learnArtist(cleanArtist(t)); });
        // only real artists (no random personal channels); one entry per name,
        // using the YouTube Music artist page ("- Topic") when there is one, in order of relevance
        const list = raw.map(itChannel).filter((a) => a.id && a.real);
        const out = [];
        list.forEach((a) => {
            const n = nrm(a.name); if (seen.has(n)) return; seen.add(n);
            const t = list.find((x) => x.topic && nrm(x.name) === n);
            out.push(t ? { ...t, image: a.image || t.image, image_fb: a.image_fb || t.image_fb } : a);
        });
        return out;
    }
    async function itRadio(videoId) {
        const j = await itGet('music', 'next', { videoId, playlistId: 'RDAMVM' + videoId, isAudioOnly: true }, 24 * H);
        return consensus(IT.all(j, 'playlistPanelVideoRenderer').map(itPanel).filter(Boolean));
    }
    // YouTube Music artist page
    async function itArtist(channelId) {
        const j = await itGet('music', 'browse', { browseId: channelId }, 24 * H);
        const h = j.header && (j.header.musicImmersiveHeaderRenderer || j.header.musicVisualHeaderRenderer || j.header.musicHeaderRenderer || Object.values(j.header)[0]);
        if (!h) return null;
        const name = cleanArtist(IT.text(h.title));
        const ths = IT.all(h, 'thumbnails').flat();
        const img = ths.length ? ths[ths.length - 1].url : '';
        learnArtist(name);
        const a = { type: 'artist', id: channelId, name, image: IT.bigImg(img), image_fb: IT.https(img), banner: '', followers: IT.num(IT.text(IT.first(h, 'subscriberCountText'))) || 0, desc: IT.text(h.description) };
        if (h === j.header.musicImmersiveHeaderRenderer && img) a.banner = IT.https(img).replace(/=w\d+-h\d+.*$/, '=w1600-h600-p-l90-rj');
        const top = [];
        IT.all(j, 'musicResponsiveListItemRenderer').forEach((it) => {
            const vid = (it.playlistItemData && it.playlistItemData.videoId) || (IT.first(it.flexColumns, 'watchEndpoint') || {}).videoId;
            if (!vid) return;
            const cols = (it.flexColumns || []).map((c) => c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text);
            const title = IT.text(cols[0]);
            const sn = { title, channelTitle: name + ' - Topic', channelId, description: '', thumbnails: ytThumbs(vid) };
            const dur = IT.secs(IT.text(IT.first(it.fixedColumns, 'text')));
            top.push(toTrack(vid, sn, { duration: dur, views: IT.num(IT.text(cols[2])) }));
        });
        const related = [], playlists = [];
        IT.all(j, 'musicCarouselShelfRenderer').forEach((c) => {
            const t = IT.text(IT.first(c.header, 'title')).toLowerCase();
            (c.contents || []).forEach((x) => {
                const r = x.musicTwoRowItemRenderer; if (!r) return;
                const th = (IT.first(r.thumbnailRenderer, 'thumbnails') || []).slice(-1)[0];
                const be = r.navigationEndpoint && r.navigationEndpoint.browseEndpoint;
                const we = r.navigationEndpoint && r.navigationEndpoint.watchEndpoint;
                if (/fans|similar|also like/.test(t) && be) related.push({ type: 'artist', id: be.browseId, name: cleanArtist(IT.text(r.title)), image: IT.bigImg(th && th.url), image_fb: IT.https(th && th.url) });
                else if (we && we.videoId && /video|single|song/.test(t)) {
                    const sn = { title: IT.text(r.title), channelTitle: name, channelId, description: '', thumbnails: ytThumbs(we.videoId) };
                    const tr = toTrack(we.videoId, sn, {}); tr.artists = [{ name, id: channelId }]; tr.views = IT.num(IT.text(r.subtitle));
                    if (!top.some((y) => y.id === tr.id)) top.push(tr);
                } else if (be && /^VL/.test(be.browseId)) playlists.push({ type: 'playlist', id: be.browseId.slice(2), name: IT.text(r.title), owner: name, image: IT.https(th && th.url), image_lg: IT.https(th && th.url) });
            });
        });
        return { artist: a, top, related, playlists };
    }
    // Artists that show up next to the seeds in YouTube Music radio
    async function itRelatedArtists(seeds, exclude) {
        const ex = new Set(exclude.map((x) => nrm(firstArtist(x))));
        const pool = [];
        for (const sd of seeds.slice(0, 2)) { try { pool.push(...(await itRadio(sd.youtube_id || sd.id))); } catch (e) {} }
        const by = {};
        pool.forEach((t) => { const nm = firstArtist(t.artists[0].name || ''); const n = nrm(nm); if (n.length < 2 || n === 'unknown' || ex.has(n) || LABEL.test(nm)) return; (by[n] || (by[n] = { name: nm, n: 0 })).n++; });
        const names = Object.values(by).sort((a, b) => b.n - a.n).slice(0, 10);
        const found = await Promise.all(names.map(async (a) => {
            try {
                const chs = await itSearchChannels(a.name);
                const na = nrm(a.name);
                const c = chs.find((c) => nrm(c.name) === na) || chs.find((c) => nrm(c.name).startsWith(na));
                return c ? { ...c, name: a.name } : null;
            } catch (e) { return null; }
        }));
        const seen = new Set();
        return found.filter((c) => c && !seen.has(c.id) && seen.add(c.id));
    }
    // YouTube Music playlist (also albums "OLAK5uy_…" and charts)
    function itListItem(it) {
        const vid = (it.playlistItemData && it.playlistItemData.videoId) || (IT.first(it.flexColumns, 'watchEndpoint') || {}).videoId;
        if (!vid) return null;
        const cols = (it.flexColumns || []).map((c) => c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text);
        const title = IT.text(cols[0]);
        const runs = (cols[1] && cols[1].runs) || [];
        const artistRuns = runs.filter((r) => r.navigationEndpoint && /ARTIST/.test(JSON.stringify(r.navigationEndpoint)));
        const by = artistRuns.length ? artistRuns.map((r) => r.text).join(', ') : (runs[0] ? runs[0].text : '');
        const byId = ((artistRuns[0] || runs[0] || {}).navigationEndpoint || {}).browseEndpoint;
        const mvt = (IT.first(it, 'watchEndpointMusicConfig') || {}).musicVideoType || '';
        const clean = /ATV|OMV/.test(mvt) && artistRuns.length;
        const dur = IT.secs(IT.text(IT.first(it.fixedColumns, 'text')));
        if (dur && (dur < 30 || dur > 30 * 60)) return null;
        let ttl = title;
        if (clean) {
            // "ARTIST - Song (Official Video)" → "Song"
            ttl = stripJunk(ttl);
            const m = ttl.match(/^(.{1,60}?)\s+[-–—|]\s+(.+)$/);
            const na = nrm(firstArtist(by)), nl = m ? nrm(m[1]) : '';
            if (m && na && (nl.includes(na) || na.includes(nl))) ttl = stripJunk(m[2]);
        }
        const sn = { title: ttl, channelTitle: clean ? by + ' - Topic' : by, channelId: (byId && byId.browseId) || '', description: '', thumbnails: ytThumbs(vid) };
        const t = toTrack(vid, sn, { duration: dur });
        if (clean) { t.artists = [{ name: by, id: (byId && byId.browseId) || '' }]; t.album = { ...t.album, name: by }; t.kind = /ATV/.test(mvt) ? 'song' : t.kind; }
        return t;
    }
    async function itPlaylist(playlistId, { max = 100 } = {}) {
        const bid = /^VL/.test(playlistId) ? playlistId : 'VL' + playlistId;
        const j = await itGet('music', 'browse', { browseId: bid }, 6 * H);
        const h = IT.first(j, 'musicResponsiveHeaderRenderer') || IT.first(j, 'musicDetailHeaderRenderer') || IT.first(j, 'musicEditablePlaylistDetailHeaderRenderer') || {};
        const ths = IT.all(h, 'thumbnails').flat();
        const img = ths.length ? IT.https(ths[ths.length - 1].url) : '';
        const info = { type: 'playlist', id: bid.slice(2), name: IT.text(h.title) || 'Playlist', owner: IT.text(h.straplineTextOne) || IT.text(h.subtitle).split(' • ').slice(-2, -1)[0] || '', image: img, image_lg: img };
        let items = IT.all(j, 'musicResponsiveListItemRenderer').map(itListItem).filter(Boolean);
        // more pages
        let token = (IT.first(IT.all(j, 'continuationItemRenderer'), 'continuationCommand') || {}).token
            || (IT.first(j, 'nextContinuationData') || {}).continuation;
        let guard = 0;
        while (token && items.length < max && guard++ < 8) {
            let cj;
            try { cj = await itGet('music', 'browse', { continuation: token }, 6 * H); } catch (e) { break; }
            const more = IT.all(cj, 'musicResponsiveListItemRenderer').map(itListItem).filter(Boolean);
            if (!more.length) break;
            items = items.concat(more);
            token = (IT.first(IT.all(cj, 'continuationItemRenderer'), 'continuationCommand') || {}).token || (IT.first(cj, 'nextContinuationData') || {}).continuation;
        }
        const seen = new Set();
        items = items.filter((t) => !seen.has(t.id) && seen.add(t.id));
        return { info, tracks: consensus(items).slice(0, max) };
    }
    async function itSearchPlaylists(q) {
        const j = await itGet('music', 'search', { query: q, params: 'EgeKAQQoAEABagwQBBAFEBUQEBAKEBE=' }, 12 * H);
        return IT.all(j, 'musicResponsiveListItemRenderer').map((it) => {
            const be = (it.navigationEndpoint || {}).browseEndpoint;
            if (!be || !/^VL/.test(be.browseId)) return null;
            const cols = (it.flexColumns || []).map((c) => IT.text(c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text));
            const th = (IT.first(it.thumbnail, 'thumbnails') || []).slice(-1)[0];
            const sub = (cols[1] || '').split(' • ');
            return { type: 'playlist', id: be.browseId.slice(2), name: cols[0], owner: sub[0] || '', image: IT.https(th && th.url), image_lg: IT.https(th && th.url) };
        }).filter(Boolean);
    }
    // Search used by matching/resolving: unlimited engine first
    async function videoSearch(q, opts = {}) { return itSearchVideos(q, opts); }

    const norm = nrm;
    function mix(same, others, ok) {
        const out = [];
        const take = (arr, i) => { while (i.v < arr.length) { const t = arr[i.v++]; if (ok(t)) { out.push(t); return true; } } return false; };
        const ia = { v: 0 }, ib = { v: 0 };
        while (out.length < 25) {
            const wantSame = out.length % 3 === 0;
            const got = wantSame ? (take(same, ia) || take(others, ib)) : (take(others, ib) || take(same, ia));
            if (!got) break;
        }
        return out;
    }
    const LABEL = /\b(records?|recordings|music|musik|entertainment|ent\.?|official|vevo|label|studios?|tv|media|productions?|channel|lyrics?|lirik|topic)\b/i;
    const JUNK = /karaoke|instrumental|\bcover\b|slowed|sped\s*up|nightcore|\b8d\b|reverb|minus\s*one|tutorial|reaction/i;

    return {
        parseMeta, normalize, cleanArtist,
        get unlimited() { return true; },
        async testUnlimited() {
            const out = {};
            const t0 = performance.now();
            try { const r = await itSearchVideos('cinta tak harus memiliki'); out.search = r.length ? `OK · ${r.length} songs · first: ${r[0].name} — ${r[0].artists[0].name}` : 'No results'; out.seed = r[0]; } catch (e) { out.search = 'Failed: ' + e.message; }
            try { const r = out.seed ? await itRadio(out.seed.id) : []; out.radio = r.length ? `OK · ${r.length} songs · next: ${r.slice(1, 4).map((t) => t.artists[0].name).join(', ')}` : 'No results'; } catch (e) { out.radio = 'Failed: ' + e.message; }
            try { const r = await itSearchChannels('Siti Nurhaliza'); out.artists = r.length ? `OK · ${r[0].name}` : 'No results'; if (r[0]) { const a = await itArtist(r[0].id); out.artistPage = a ? `OK · ${a.top.length} songs, ${a.related.length} similar artists` : 'No page'; } } catch (e) { out.artists = out.artists || ('Failed: ' + e.message); out.artistPage = 'Failed: ' + e.message; }
            try { const c = await this.chart('MY', 10); out.charts = c.length ? `OK · ${c.length} songs · #1: ${c[0].name} — ${c[0].artists[0].name}` : 'No results'; } catch (e) { out.charts = 'Failed: ' + e.message; }
            out.ms = Math.round(performance.now() - t0);
            delete out.seed;
            return out;
        },

        // "All" tab: songs/videos + artists (+ playlists)
        async searchAll(q) {
            const [sq, playlists] = await Promise.all([songQuery(q), itSearchPlaylists(q).catch(() => [])]);
            const { tracks, artists } = sq;
            fixSwaps(tracks);
            const nq0 = nrm(q);
            // the query is a song title (no artist by that name): "Kerispatih — Mengenangmu" → "Mengenangmu — Kerispatih"
            const isArtistQuery = KNOWN.has(nq0) || artists.some((a) => nrm(a.name) === nq0);
            if (!isArtistQuery && nq0.length > 3) {
                tracks.forEach((t) => {
                    const a = t.artists[0].name;
                    if (nrm(a).includes(nq0) && !nrm(t.name).includes(nq0)) { t.artists = [{ ...t.artists[0], name: t.name }]; t.name = a.replace(/[.\s]+$/, ''); t.album = { ...t.album, name: t.artists[0].name }; }
                });
            }
            // real artists first: known singers, or names the songs are credited to
            const credited = new Set(tracks.map((t) => nrm(firstArtist(t.artists[0].name))));
            const real = (a) => KNOWN.has(nrm(a.name)) || credited.has(nrm(a.name));
            // official artists, or singers the songs here are credited to; fan / personal channels drop out
            const shown = artists.filter((a) => a.strong || credited.has(nrm(a.name)));
            artists.length = 0; artists.push(...shown);
            artists.sort((a, b) => (credited.has(nrm(b.name)) ? 2 : real(b) ? 1 : 0) - (credited.has(nrm(a.name)) ? 2 : real(a) ? 1 : 0));
            const songs = tracks.filter((t) => t.kind === 'song').sort((a, b) => (b.topic ? 1 : 0) - (a.topic ? 1 : 0));
            const videos = tracks.filter((t) => t.kind === 'video');
            const nq = nrm(q);
            // typed a song title (several songs carry that name) → the song is the top result
            const titleHits = tracks.filter((t) => nq.length > 3 && nrm(t.name).includes(nq) && !nrm(t.artists[0].name).includes(nq)).length;
            let top = null;
            if (titleHits >= 2) top = songs.concat(tracks).filter((t) => nrm(t.name).includes(nq)).sort((a, b) => (b.topic ? 1e12 : 0) + (b.views || 0) - (a.topic ? 1e12 : 0) - (a.views || 0))[0];
            if (!top) top = artists.find((a) => real(a) && (nrm(a.name) === nq || (nq.length > 3 && nrm(a.name).startsWith(nq))));
            return { top: top || songs[0] || tracks[0] || null, songs: songs.length ? songs : tracks, videos, artists, playlists, all: tracks };
        },
        async searchSongs(q) {
            const tr = fixSwaps((await songQuery(q)).tracks);
            return tr.sort((a, b) => ((b.topic ? 2 : 0) + (b.kind === 'song' ? 1 : 0)) - ((a.topic ? 2 : 0) + (a.kind === 'song' ? 1 : 0)));
        },
        async searchVideos(q) {
            return (await itSearchVideos(q + ' official music video', { hint: q })).map((t) => ({ ...t, kind: 'video' }));
        },
        async searchArtists(q) { return itSearchChannels(q); },
        // one song by its video id (shared links, Jam)
        async track(id) {
            const j = await itGet('music', 'next', { videoId: id }, 7 * 24 * H);
            const p = IT.all(j, 'playlistPanelVideoRenderer').find((x) => x.videoId === id);
            const t = p && itPanel(p);
            if (!t) throw new Error('Song not found');
            return fixSwaps([t])[0];
        },
        // Songs the singer's own channels uploaded this month (no lyric / cover re-uploads)
        async newFrom(artist) {
            const na = nrm(firstArtist(artist));
            const chs = (await itSearchChannels(artist).catch(() => [])).filter((c) => { const n = nrm(c.name); return n === na || (na.length > 3 && n.startsWith(na)); });
            const own = new Set(chs.map((c) => c.id));
            const j = await itGet('web', 'search', { query: artist, params: 'EgQIBBAB' }, 12 * H);
            const tr = consensus(IT.all(j, 'videoRenderer').map((v) => itVideo(v, { min: 60, max: 9 * 60 })).filter(Boolean), artist);
            const seen = new Set();
            return tr.filter((t) => {
                if (!own.has(t.channelId)) return false;
                if (JUNK.test(t.name) || /live|concert|konser|fancam|full album|teaser|behind|interview|reaction|shorts/i.test(t.name)) return false;
                const k = nrm(t.name); if (seen.has(k)) return false; seen.add(k); return true;
            }).map((t) => ({ ...t, artists: [{ ...t.artists[0], name: t.artists[0].name === 'Unknown' ? artist : t.artists[0].name }] }));
        },
        // Find a song from a line of its lyrics (lyric videos carry the words in their title/description)
        async searchLyrics(q) {
            const items = await itVideoItems('"' + q.trim() + '" lyrics');
            // the typed words are lyrics (or the title), never the singer
            const tracks = fixSwaps(parseVideos(items, { avoid: q }));
            tracks.forEach((t) => { t.name = t.name.replace(/^(lirik|lyrics?)\s+(lagu\s+)?/i, ''); });
            const seen = new Set();
            return tracks.filter((t) => {
                if (JUNK.test(t.name + ' ' + t.artists[0].name)) return false;
                const k = nrm(t.name) + '|' + nrm(firstArtist(t.artists[0].name));
                if (seen.has(k)) return false; seen.add(k); return true;
            });
        },
        async searchPlaylists(q) { return itSearchPlaylists(q); },

        // Home charts from YouTube Music (which: 'top' | 'trending')
        async chart(region = 'MY', n = 25, which = 'top') {
            const j = await itGet('music', 'browse', { browseId: 'FEmusic_charts', formData: { selectedValues: [region] } }, 3 * H);
            const lists = [];
            IT.all(j, 'musicTwoRowItemRenderer').forEach((r) => {
                const be = r.navigationEndpoint && r.navigationEndpoint.browseEndpoint;
                if (be && /^VL/.test(be.browseId)) lists.push({ id: be.browseId.slice(2), title: IT.text(r.title) });
            });
            const pick = which === 'trending'
                ? (lists.find((l) => /trending/i.test(l.title)) || lists.find((l) => /daily top/i.test(l.title)))
                : (lists.find((l) => /daily top music videos/i.test(l.title)) || lists.find((l) => /top 100 music videos/i.test(l.title)) || lists.find((l) => !/live/i.test(l.title)));
            if (!pick) throw new Error('No charts for this country right now');
            const d = await itPlaylist(pick.id, { max: n });
            return d.tracks.slice(0, n);
        },

        async artist(channelId) {
            const d = await itArtist(channelId);
            if (!d || !d.artist.name) throw new Error('Artist not found');
            // top up with a search by name when the page is thin (label / personal channels)
            if (d.top.length < 10) {
                try {
                    const an = nrm(d.artist.name);
                    (await itSearchVideos(d.artist.name, { hint: d.artist.name }))
                        .filter((t) => nrm(t.artists[0].name).includes(an) && !d.top.some((x) => x.id === t.id))
                        .forEach((t) => d.top.push(t));
                } catch (e) {}
            }
            const seenT = new Set();
            d.top = d.top.filter((t) => { const k = nrm(t.name); if (seenT.has(k)) return false; seenT.add(k); return true; });
            return d;
        },

        async playlist(playlistId, { max = 100 } = {}) { return itPlaylist(playlistId, { max }); },

        // Same vibe: YouTube Music radio of the seeds, mixed together
        async vibe(seeds, { limit = 30 } = {}) {
            seeds = (seeds || []).filter((t) => t && t.name).slice(0, 3);
            if (!seeds.length) return [];
            const seedTitles = new Set(seeds.map((t) => nrm(t.name)));
            const seedIds = new Set(seeds.map((t) => t.youtube_id || t.id));
            const ids = [];
            for (const sd of seeds) {
                if (!sd.pending && (sd.youtube_id || sd.id)) { ids.push(sd.youtube_id || sd.id); continue; }
                // imported songs have no video yet: find one first
                try { const f = (await itSearchVideos(sd.name + ' ' + ((sd.artists && sd.artists[0] && sd.artists[0].name) || '')))[0]; if (f) ids.push(f.id); } catch (e) {}
            }
            const lists = await Promise.all(ids.map((id) => itRadio(id).catch(() => [])));
            const out = [], seenT = new Set(seedTitles);
            for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
                lists.forEach((l) => {
                    const t = l[i]; if (!t || seedIds.has(t.id) || JUNK.test(t.name + ' ' + t.artists[0].name)) return;
                    const k = nrm(t.name); if (seenT.has(k)) return; seenT.add(k); out.push(t);
                });
            }
            return out.slice(0, limit);
        },

        // Up next after a song: YouTube Music radio (same singer + same vibe)
        async radio(track, { exclude = [] } = {}) {
            if (!track || !track.name) return [];
            let id = track.youtube_id || track.id;
            if (track.pending) { const f = await this.resolve(track); if (!f) return []; id = f.id; }
            const nt = nrm(track.name), ex = new Set(exclude.concat([track.id, id]));
            const seedJunk = JUNK.test(track.name);
            const seen = new Set([nt]);
            return (await itRadio(id)).filter((t) => {
                if (ex.has(t.id)) return false;
                const tn = nrm(t.name), ta = nrm(t.artists[0].name);
                if (nt.length > 3 && (tn.includes(nt) || ta.includes(nt))) return false;
                if (!seedJunk && JUNK.test(t.name + ' ' + t.artists[0].name)) return false;
                if (seen.has(tn)) return false; seen.add(tn); return true;
            }).slice(0, 25);
        },

        async relatedArtists(seeds, exclude = []) {
            // every singer on the seeds (also features: "A, B & C")
            const ex = exclude.concat(seeds.flatMap((x) => ((x.artists && x.artists[0] && x.artists[0].name) || '').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\bwith\b)\s*/i))).filter(Boolean);
            const playable = seeds.filter((x) => !x.pending);
            if (!playable.length && seeds.length) {
                for (const sd of seeds.slice(0, 2)) { try { const f = await this.resolve(sd); if (f) playable.push(f); } catch (e) {} }
            }
            return (await itRelatedArtists(playable, ex)).slice(0, 12);
        },

        // Turn an imported "title + artist" into a playable song
        async resolve(track) {
            const found = await this.alternatives(track, [], { maxQueries: 2 });
            return found[0] || null;
        },

        // Another upload of the same song that is allowed to play here
        // (official audio / topic channel, artist upload, lyric version…)
        async alternatives(track, exclude = [], { maxQueries = 3 } = {}) {
            const title = (track.name || '').replace(/\s*\(feat\..*?\)/i, '').trim();
            const artist = (track.artists && track.artists[0] && track.artists[0].name) || '';
            const dur = (track.duration_ms || 0) / 1000;
            const nt = nrm(title), na = nrm(firstArtist(artist));
            const seen = new Set(exclude);
            const pool = [];
            const queries = [artist + ' ' + title, artist + ' ' + title + ' audio', title + ' ' + artist + ' lirik'];
            for (const q of queries.slice(0, maxQueries)) {
                try {
                    const tr = await videoSearch(q.trim(), { min: 30, max: 25 * 60, hint: artist });
                    tr.forEach((t) => { if (!seen.has(t.id)) { seen.add(t.id); pool.push(t); } });
                } catch (e) { break; }
                const good = pool.filter((t) => nrm(t.name).includes(nt) || nt.includes(nrm(t.name)));
                if (good.length >= 3) break;
            }
            const score = (t) => {
                let s = 0;
                const tn = nrm(t.name), an = nrm(t.artists[0].name);
                if (tn === nt) s += 40; else if (tn.includes(nt) || nt.includes(tn)) s += 25; else s -= 30;
                if (na && an.includes(na)) s += 20;
                if (t.topic) s += 25; else if (t.kind === 'song') s += 8;
                if (dur && t.duration_ms) { const d = Math.abs(t.duration_ms / 1000 - dur); s += d <= 4 ? 20 : d <= 15 ? 10 : d <= 40 ? 0 : -25; }
                if (/live|cover|remix|karaoke|instrumental|slowed|sped|8d|nightcore/i.test(t.name) && !/live|cover|remix|karaoke|instrumental|slowed|sped/i.test(title)) s -= 30;
                return s;
            };
            return pool.map((t) => ({ t, s: score(t) })).filter((x) => x.s > 10).sort((a, b) => b.s - a.s).map((x) => x.t);
        },

        async suggest(q) {
            if (!q || q.length < 2) return [];
            try {
                const r = await jsonp('https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&hl=en&q=' + encodeURIComponent(q));
                return ((r && r[1]) || []).map((x) => (Array.isArray(x) ? x[0] : x)).filter(Boolean).slice(0, 8);
            } catch (e) { return []; }
        },
    };
})();

/* Display helpers that work for every stored track shape */
const T = {
    title: (t) => (t && t.name) || 'Unknown',
    artist: (t) => (t && t.artists && t.artists.map((a) => a.name).join(', ')) || '',
    artistId: (t) => (t && ((t.artists && t.artists[0] && t.artists[0].id) || t.channelId)) || '',
    cover: (t) => (t && (t.cover || (t.album && t.album.images && t.album.images[0] && t.album.images[0].url))) || '',
    coverLg: (t) => (t && (t.cover_lg || t.cover)) || '',
    dur: (t) => (t && t.duration_ms ? fmtTime(t.duration_ms / 1000) : ''),
};
