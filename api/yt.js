// Darcam search relay (Vercel version of yt.php).
// The web version can't call YouTube / YouTube Music from the browser, so it sends the request here.
// Only the few endpoints Darcam needs are allowed.
const { UA, cors, sendJson, readBody, fetchTimeout } = require('./_util');

const HOSTS = { music: 'music.youtube.com', web: 'www.youtube.com' };
const ENDPOINTS = ['search', 'next', 'browse'];

module.exports = async (req, res) => {
    cors(res, 'POST');
    if (req.method === 'OPTIONS') return sendJson(res, 200, {});
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
    let input;
    try { input = await readBody(req, 65536); } catch (e) { return sendJson(res, 400, { error: 'Bad request' }); }
    if (!input || typeof input !== 'object') return sendJson(res, 400, { error: 'Bad request' });

    // Spotify playlist import: read the public embed page
    if (input.spotify !== undefined) {
        const m = /^(playlist|album)\/([A-Za-z0-9]{10,40})$/.exec(String(input.spotify));
        if (!m) return sendJson(res, 400, { error: 'Bad link' });
        try {
            const r = await fetchTimeout(`https://open.spotify.com/embed/${m[1]}/${m[2]}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } }, 20000);
            if (r.status !== 200) return sendJson(res, 502, { error: 'Spotify did not answer', status: r.status });
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.end(await r.text());
        } catch (e) { return sendJson(res, 502, { error: 'Spotify did not answer', status: 0 }); }
    }

    const host = HOSTS[input.host];
    const body = input.body && typeof input.body === 'object' && !Array.isArray(input.body) ? input.body : null;
    if (!host || !ENDPOINTS.includes(input.endpoint) || !body) return sendJson(res, 400, { error: 'Not allowed' });

    try {
        const r = await fetchTimeout(`https://${host}/youtubei/v1/${input.endpoint}?prettyPrint=false`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://' + host, Referer: 'https://' + host + '/', 'Accept-Language': 'en' },
            body: JSON.stringify(body),
        }, 20000);
        const text = await r.text();
        if (r.status < 200 || r.status >= 300) return sendJson(res, 502, { error: 'YouTube did not answer', status: r.status });
        return sendJson(res, 200, text);
    } catch (e) {
        return sendJson(res, 502, { error: 'YouTube did not answer', status: 0 });
    }
};
