// Lyrics proxy (Vercel version of lyrics_proxy.php): passes requests to lrclib.net
const { cors, sendJson, fetchTimeout } = require('./_util');

module.exports = async (req, res) => {
    cors(res, 'GET');
    if (req.method === 'OPTIONS') return sendJson(res, 200, {});
    const u = new URL(req.url, 'http://x');
    const endpoint = u.searchParams.get('endpoint');
    if (!['search', 'get'].includes(endpoint)) return sendJson(res, 400, { error: 'Invalid endpoint' });
    u.searchParams.delete('endpoint');
    const qs = u.searchParams.toString();
    try {
        const r = await fetchTimeout('https://lrclib.net/api/' + endpoint + (qs ? '?' + qs : ''), { headers: { Accept: 'application/json', 'User-Agent': 'Darcam/1.0 (lyrics proxy)' } }, 15000);
        const text = await r.text();
        if (r.status < 200 || r.status >= 300) return sendJson(res, 502, { error: 'Proxy failed', details: 'HTTP ' + r.status });
        res.setHeader('Cache-Control', 'public, s-maxage=86400');
        return sendJson(res, 200, text);
    } catch (e) {
        return sendJson(res, 502, { error: 'Proxy failed', details: String(e && e.message || e) });
    }
};
