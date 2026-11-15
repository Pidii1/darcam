// Darcam friends (Vercel + Upstash).
// No accounts: each Darcam gets a friend code (public) and a secret key (kept on that device).
// Friends see each other's name, picture and what they're playing, can send each other songs
// and invite each other to a Jam. Friend requests have to be accepted.
const crypto = require('crypto');
const { cors, sendJson, readBody, fetchTimeout } = require('./_util');

function envEnding(ends) {
    for (const e of ends) { if (process.env[e]) return process.env[e]; }
    const k = Object.keys(process.env).find((n) => ends.some((e) => n.endsWith('_' + e)) && process.env[n]);
    return k ? process.env[k] : '';
}
const R_URL = envEnding(['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL', 'REDIS_REST_URL']);
const R_TOKEN = envEnding(['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_REST_TOKEN']);
const KEEP = 180 * 86400;        // a Darcam nobody opened for 6 months is forgotten

async function redis(cmds) {
    if (!R_URL || !R_TOKEN) throw new Fail(503, 'Friends need Upstash connected to your Darcam website (Vercel → Storage).');
    const r = await fetchTimeout(R_URL.replace(/\/$/, '') + '/pipeline', {
        method: 'POST', headers: { Authorization: 'Bearer ' + R_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds),
    }, 8000);
    if (!r.ok) throw new Error('Storage error ' + r.status);
    const out = await r.json();
    return out.map((x) => { if (x.error) throw new Error(x.error); return x.result; });
}
class Fail extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const K = { user: (c) => 'fr:u:' + c, friends: (c) => 'fr:f:' + c, reqs: (c) => 'fr:r:' + c, inbox: (c) => 'fr:i:' + c, names: 'fr:names' };
// names are kept in one sorted list ("pidii|NJN9KM") so people can be found by typing the start of a name
const nameKey = (name, code) => String(name || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 24) + '|' + code;
async function indexName(code, u) {
    const want = u.findable === false ? '' : nameKey(u.name, code);
    if (u.idx === want) return;
    const cmds = [];
    if (u.idx) cmds.push(['ZREM', K.names, u.idx]);
    if (want) cmds.push(['ZADD', K.names, 0, want]);
    if (cmds.length) await redis(cmds);
    u.idx = want;
}
const cleanStr = (s, max) => String(s == null ? '' : s).replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);
const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const cleanPic = (p) => (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]{100,12000}$/.test(String(p || '')) ? p : '');
function cleanCover(u) { u = String(u || ''); return /^https:\/\/(i\.ytimg\.com|lh3\.googleusercontent\.com|yt3\.ggpht\.com|i[0-9]\.ytimg\.com)\/[^\s"'<>]{1,400}$/.test(u) ? u : ''; }
function cleanTrack(t) {
    if (!t || typeof t !== 'object') return null;
    const id = String(t.id || '').replace(/[^A-Za-z0-9_\-]/g, '');
    if (id.length < 6 || id.length > 20) return null;
    return { id, name: cleanStr(t.name, 160), artist: cleanStr(t.artist, 120), dur: Math.max(0, Math.min(36000, parseInt(t.dur, 10) || 0)), cover: cleanCover(t.cover) };
}
const parse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
const flatList = (r) => (Array.isArray(r) ? r : r && typeof r === 'object' ? Object.keys(r) : []);

// what friends may see about someone
function card(code, u, now) {
    if (!u) return null;
    const online = now - (u.seen || 0) < 90000;
    return { code, name: u.name, pic: u.pic || '', seen: u.seen || 0, online,
        now: u.share !== false && u.now && now - (u.now.at || 0) < 15 * 60000 ? u.now : null,
        jam: u.share !== false && u.jam && online ? u.jam : null };
}

module.exports = async (req, res) => {
    cors(res, 'POST');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return sendJson(res, 200, {});
    const now = Date.now();
    const out = (code, obj) => sendJson(res, code, { ...obj, now });
    if (req.method !== 'POST') return out(405, { error: 'POST only' });
    let input;
    try { input = await readBody(req, 32768); } catch (e) { return out(400, { error: 'Bad request' }); }
    if (!input || typeof input !== 'object') return out(400, { error: 'Bad request' });
    const op = String(input.op || '');

    try {
        if (op === 'register') {
            // a new friend code for this Darcam
            const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
            const secret = crypto.randomBytes(24).toString('hex');
            for (let t = 0; t < 10; t++) {
                let code = ''; for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(alphabet.length)];
                const u = { name: cleanStr(input.name, 24) || 'Darcam user', pic: cleanPic(input.pic), key: hash(secret), seen: now, share: true, findable: true };
                const [ok] = await redis([['SET', K.user(code), JSON.stringify(u), 'EX', KEEP, 'NX']]);
                if (ok) { await indexName(code, u); await redis([['SET', K.user(code), JSON.stringify(u), 'EX', KEEP]]); return out(200, { code, secret }); }
            }
            throw new Fail(500, 'Try again');
        }

        // everything else: prove it's you
        const code = cleanCode(input.code);
        const [rawMe] = await redis([['GET', K.user(code)]]);
        const meU = parse(rawMe);
        if (!meU) throw new Fail(404, 'unknown');
        if (meU.key !== hash(input.secret || '')) throw new Fail(403, 'Not allowed');

        if (op === 'sync') {
            // update my name, picture and what I'm playing; get my friends, requests and messages
            meU.name = cleanStr(input.name, 24) || meU.name;
            if (input.pic !== undefined) meU.pic = cleanPic(input.pic);
            meU.share = input.share !== false;
            if (input.findable !== undefined) meU.findable = input.findable !== false;
            meU.seen = now;
            await indexName(code, meU);
            if (input.now !== undefined) meU.now = input.now ? { ...cleanTrack(input.now), playing: !!input.now.playing, at: now } : null;
            if (input.jam !== undefined) meU.jam = input.jam ? { room: cleanCode(input.jam.room), host: !!input.jam.host } : null;
            if (meU.now && !meU.now.id) meU.now = null;
            const [, fr, rq, inbox] = await redis([
                ['SET', K.user(code), JSON.stringify(meU), 'EX', KEEP],
                ['SMEMBERS', K.friends(code)],
                ['SMEMBERS', K.reqs(code)],
                ['LRANGE', K.inbox(code), 0, 49],
            ]);
            const ids = [...flatList(fr), ...flatList(rq)];
            const users = ids.length ? await redis(ids.map((c) => ['GET', K.user(c)])) : [];
            const map = {}; ids.forEach((c, i) => (map[c] = parse(users[i])));
            const friends = flatList(fr).map((c) => card(c, map[c], now)).filter(Boolean)
                .sort((a, b) => (b.online - a.online) || ((b.now ? 1 : 0) - (a.now ? 1 : 0)) || (b.seen - a.seen));
            const requests = flatList(rq).map((c) => map[c] && { code: c, name: map[c].name, pic: map[c].pic || '' }).filter(Boolean);
            const messages = (inbox || []).map(parse).filter(Boolean);
            return out(200, { friends, requests, messages, me: { code, name: meU.name, share: meU.share } });
        }
        if (op === 'find') {            // look people up by name (or code)
            const q = String(input.q || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 24);
            if (q.length < 2) return out(200, { people: [] });
            const [hits, fr, rq] = await redis([['ZRANGEBYLEX', K.names, '[' + q, '[' + q + '\uffff', 'LIMIT', 0, 25], ['SMEMBERS', K.friends(code)], ['SMEMBERS', K.reqs(code)]]);
            const codes = [...new Set((hits || []).map((h) => h.slice(h.lastIndexOf('|') + 1)))];
            const asCode = cleanCode(q);
            if (asCode.length === 6 && !codes.includes(asCode)) codes.unshift(asCode);
            const list = codes.filter((c) => c !== code).slice(0, 20);
            const users = list.length ? await redis([...list.map((c) => ['GET', K.user(c)]), ...list.map((c) => ['SISMEMBER', K.reqs(c), code])]) : [];
            const friends = new Set(flatList(fr)), asked = new Set(flatList(rq));
            const people = list.map((c, i) => { const u = parse(users[i]); return u && (u.findable !== false || c === asCode) ? { code: c, name: u.name, pic: u.pic || '', friend: friends.has(c), asksYou: asked.has(c), requested: !!users[list.length + i] } : null; }).filter(Boolean);
            return out(200, { people });
        }
        if (op === 'request') {         // send a friend request by code
            const to = cleanCode(input.to);
            if (!to || to === code) throw new Fail(400, 'That’s your own code');
            const [rawTo, already, theyAsked] = await redis([['GET', K.user(to)], ['SISMEMBER', K.friends(code), to], ['SISMEMBER', K.reqs(code), to]]);
            if (!rawTo) throw new Fail(404, 'No Darcam has that code. Check it and try again.');
            if (already) return out(200, { ok: true, already: true, name: parse(rawTo).name });
            if (theyAsked) {            // they already asked me: just become friends
                await redis([['SADD', K.friends(code), to], ['SADD', K.friends(to), code], ['SREM', K.reqs(code), to], ['SREM', K.reqs(to), code], ['EXPIRE', K.friends(code), KEEP], ['EXPIRE', K.friends(to), KEEP]]);
                return out(200, { ok: true, friends: true, name: parse(rawTo).name });
            }
            const [n] = await redis([['SCARD', K.reqs(to)]]);
            if (n >= 50) throw new Fail(429, 'They have too many requests waiting');
            await redis([['SADD', K.reqs(to), code], ['EXPIRE', K.reqs(to), KEEP]]);
            return out(200, { ok: true, sent: true, name: parse(rawTo).name });
        }
        if (op === 'accept' || op === 'decline') {
            const from = cleanCode(input.from);
            const [asked] = await redis([['SISMEMBER', K.reqs(code), from]]);
            if (!asked) throw new Fail(404, 'That request is gone');
            if (op === 'accept') await redis([['SADD', K.friends(code), from], ['SADD', K.friends(from), code], ['SREM', K.reqs(code), from], ['SREM', K.reqs(from), code], ['EXPIRE', K.friends(code), KEEP], ['EXPIRE', K.friends(from), KEEP]]);
            else await redis([['SREM', K.reqs(code), from]]);
            return out(200, { ok: true });
        }
        if (op === 'remove') {
            const who = cleanCode(input.who);
            await redis([['SREM', K.friends(code), who], ['SREM', K.friends(who), code]]);
            return out(200, { ok: true });
        }
        if (op === 'send') {            // a song or a Jam invite to a friend
            const to = cleanCode(input.to);
            const [isFriend] = await redis([['SISMEMBER', K.friends(code), to]]);
            if (!isFriend) throw new Fail(403, 'You can only send to friends');
            const msg = { id: crypto.randomBytes(6).toString('hex'), from: code, name: meU.name, pic: meU.pic || '', at: now };
            if (input.kind === 'song') { msg.kind = 'song'; msg.track = cleanTrack(input.track); msg.text = cleanStr(input.text, 140); if (!msg.track) throw new Fail(400, 'Bad song'); }
            else if (input.kind === 'jam') { msg.kind = 'jam'; msg.room = cleanCode(input.room); if (!msg.room) throw new Fail(400, 'Bad Jam'); }
            else throw new Fail(400, 'Bad request');
            await redis([['LPUSH', K.inbox(to), JSON.stringify(msg)], ['LTRIM', K.inbox(to), 0, 49], ['EXPIRE', K.inbox(to), 30 * 86400]]);
            return out(200, { ok: true });
        }
        if (op === 'clear') {           // remove messages I've seen (by id), or all
            const ids = Array.isArray(input.ids) ? input.ids.map(String) : null;
            if (!ids) { await redis([['DEL', K.inbox(code)]]); return out(200, { ok: true }); }
            const [list] = await redis([['LRANGE', K.inbox(code), 0, 49]]);
            const keep = (list || []).filter((s) => { const m = parse(s); return m && !ids.includes(m.id); });
            const cmds = [['DEL', K.inbox(code)]];
            if (keep.length) cmds.push(['RPUSH', K.inbox(code), ...keep], ['EXPIRE', K.inbox(code), 30 * 86400]);
            await redis(cmds);
            return out(200, { ok: true });
        }
        throw new Fail(400, 'Unknown request');
    } catch (e) {
        if (e instanceof Fail) return out(e.code, { error: e.message });
        console.error(e);
        return out(500, { error: 'Storage error' });
    }
};
