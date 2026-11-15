// Darcam on Vercel: shared helpers for the small server functions
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function cors(res, methods) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', methods + ', OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function sendJson(res, code, obj) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
}
async function readBody(req, max) {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    let raw = '';
    if (typeof req.body === 'string') raw = req.body;
    else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
    else {
        raw = await new Promise((ok, bad) => {
            let s = '';
            req.on('data', (c) => { s += c; if (s.length > max) { bad(new Error('too big')); req.destroy(); } });
            req.on('end', () => ok(s));
            req.on('error', bad);
        });
    }
    if (raw.length > max) throw new Error('too big');
    return JSON.parse(raw || 'null');
}
async function fetchTimeout(url, opts, ms) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ac.signal }); } finally { clearTimeout(t); }
}
module.exports = { UA, cors, sendJson, readBody, fetchTimeout };
