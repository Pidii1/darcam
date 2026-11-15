// Darcam Jam on Vercel: "listen together", like a Spotify Jam.
// The host's Darcam is in charge of the music. Every 1.5 s it sends what is playing and the songs
// coming up. Friends play the same song on their own device, in sync, see the shared queue,
// add songs (they land in the host's queue with their name), and, if the host allows it,
// play / pause / skip for everyone.
// Rooms live in Upstash Redis (Vercel → Storage → Upstash) and expire after 8 hours.
// Without Redis, rooms are kept in memory, which only works while one server copy is running.
const crypto = require('crypto');
const { cors, sendJson, readBody, fetchTimeout } = require('./_util');

const TTL = 8 * 3600;            // seconds
// Upstash names its settings differently depending on how it was connected (and an optional prefix),
// so look for any of them.
function envEnding(ends) {
    for (const e of ends) { if (process.env[e]) return process.env[e]; }
    const k = Object.keys(process.env).find((n) => ends.some((e) => n.endsWith('_' + e)) && process.env[n]);
    return k ? process.env[k] : '';
}
const R_URL = envEnding(['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL', 'REDIS_REST_URL']);
const R_TOKEN = envEnding(['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_REST_TOKEN']);
const HAS_REDIS = !!(R_URL && R_TOKEN);
const ON_VERCEL = !!process.env.VERCEL;

// ---------- storage: Upstash Redis REST, or memory ----------
const mem = globalThis.__darcamJam2 || (globalThis.__darcamJam2 = new Map());
function memGet(k) { const v = mem.get(k); if (!v) return null; if (v.exp < Date.now()) { mem.delete(k); return null; } return v; }
async function redis(cmds) {
    if (R_URL && R_TOKEN) {
        const r = await fetchTimeout(R_URL.replace(/\/$/, '') + '/pipeline', {
            method: 'POST', headers: { Authorization: 'Bearer ' + R_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds),
        }, 8000);
        if (!r.ok) throw new Error('Storage error ' + r.status);
        const out = await r.json();
        return out.map((x) => { if (x.error) throw new Error(x.error); return x.result; });
    }
    return cmds.map(([c, k, ...a]) => {
        const exp = Date.now() + TTL * 1000;
        switch (c) {
            case 'GET': { const v = memGet(k); return v ? v.s : null; }
            case 'SET': { if (a.includes('NX') && memGet(k)) return null; mem.set(k, { s: a[0], exp }); return 'OK'; }
            case 'EXISTS': return memGet(k) ? 1 : 0;
            case 'HSET': { const v = memGet(k) || { h: {}, exp }; v.h = v.h || {}; v.h[a[0]] = a[1]; v.exp = exp; mem.set(k, v); return 1; }
            case 'HDEL': { const v = memGet(k); if (v && v.h) delete v.h[a[0]]; return 1; }
            case 'HGETALL': { const v = memGet(k); if (!v || !v.h) return []; return Object.entries(v.h).flat(); }
            case 'HLEN': { const v = memGet(k); return v && v.h ? Object.keys(v.h).length : 0; }
            case 'RPUSH': { const v = memGet(k) || { l: [], exp }; v.l = v.l || []; v.l.push(a[0]); v.exp = exp; mem.set(k, v); return v.l.length; }
            case 'LLEN': { const v = memGet(k); return v && v.l ? v.l.length : 0; }
            case 'LPOP': { const v = memGet(k); if (!v || !v.l || !v.l.length) return null; return v.l.splice(0, +a[0] || 1); }
            case 'EXPIRE': { const v = memGet(k); if (v) v.exp = Date.now() + (+a[0]) * 1000; return v ? 1 : 0; }
            case 'DEL': { const had = mem.has(k); mem.delete(k); return had ? 1 : 0; }
            default: throw new Error('unknown ' + c);
        }
    });
}

// ---------- helpers ----------
const K = { room: (c) => 'jam2:' + c + ':room', mem: (c) => 'jam2:' + c + ':members', adds: (c) => 'jam2:' + c + ':adds', cmds: (c) => 'jam2:' + c + ':cmds' };
const cleanStr = (s, max) => String(s == null ? '' : s).replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);
const cleanId = (s, max = 40) => String(s || '').replace(/[^A-Za-z0-9]/g, '').slice(0, max);
function cleanCover(u) {
    u = String(u || '');
    return /^https:\/\/(i\.ytimg\.com|lh3\.googleusercontent\.com|yt3\.ggpht\.com|i[0-9]\.ytimg\.com)\/[^\s"'<>]{1,400}$/.test(u) ? u : '';
}
function cleanTrack(t) {
    if (!t || typeof t !== 'object') return null;
    const id = String(t.id || '').replace(/[^A-Za-z0-9_\-]/g, '');
    if (id.length < 6 || id.length > 20) return null;
    const out = { id, name: cleanStr(t.name, 160), artist: cleanStr(t.artist, 120), dur: Math.max(0, Math.min(36000, parseInt(t.dur, 10) || 0)), cover: cleanCover(t.cover) };
    if (t.by) out.by = cleanStr(t.by, 24);
    if (t.auto) out.auto = 1;          // a suggested song (Darcam added it, nobody picked it)
    return out;
}
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
const parseList = (r) => (r == null ? [] : Array.isArray(r) ? r : [r]).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
class Fail extends Error { constructor(code, msg) { super(msg); this.code = code; } }
async function loadRoom(code) {
    const [s] = await redis([['GET', K.room(code)]]);
    if (!s) throw new Fail(404, 'The Jam has ended');
    return JSON.parse(s);
}
function membersFrom(flat, now) {
    const list = [];
    if (Array.isArray(flat)) for (let i = 1; i < flat.length; i += 2) { try { list.push(JSON.parse(flat[i])); } catch (e) {} }
    else if (flat && typeof flat === 'object') Object.values(flat).forEach((v) => { try { list.push(JSON.parse(v)); } catch (e) {} });
    return list.filter((m) => now - m.seen < 20000).sort((a, b) => (b.host ? 1 : 0) - (a.host ? 1 : 0) || a.joined - b.joined);
}
const publicRoom = (room, members) => ({ room: room.code, name: room.name, host: room.host, queue: room.queue || [], control: !!room.control, autoplay: room.autoplay !== false, members, ver: room.ver || 0 });
const isKicked = (room, id) => (room.kicked || []).includes(id);

module.exports = async (req, res) => {
    cors(res, 'POST');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return sendJson(res, 200, {});
    const now = Date.now();
    const out = (code, obj) => sendJson(res, code, { ...obj, now });
    if (req.method === 'GET') {
        // health check: is the Jam storage set up?
        let ok = true;
        if (HAS_REDIS) { try { await redis([['EXISTS', 'jam2:health']]); } catch (e) { ok = false; } }
        return out(200, { storage: HAS_REDIS ? (ok ? 'redis' : 'redis-error') : 'memory', vercel: ON_VERCEL });
    }
    if (req.method !== 'POST') return out(405, { error: 'POST only' });
    let input;
    try { input = await readBody(req, 65536); } catch (e) { return out(400, { error: 'Bad request' }); }
    if (!input || typeof input !== 'object') return out(400, { error: 'Bad request' });

    const op = input.op || '';
    let code = cleanId(input.room, 8).toUpperCase();
    const me = cleanId(input.me) || 'anon';
    const myName = cleanStr(input.name || 'Friend', 24) || 'Friend';
    const memberRec = (host, joined) => JSON.stringify({ id: me, name: myName, host, seen: now, joined: joined || now });

    try {
        if (op === 'create') {
            // On Vercel, memory isn't shared between server copies, so a Jam would "end" by itself.
            if (ON_VERCEL && !HAS_REDIS) throw new Fail(503, 'Jam isn’t set up on your Darcam website yet. In Vercel, open your project → Storage → connect Upstash (Redis), then Redeploy.');
            const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
            const token = crypto.randomBytes(16).toString('hex');
            const room = { code: '', token, name: cleanStr(input.title || 'Jam', 40) || 'Jam', created: now, control: true, ver: 1,
                host: { id: me, name: myName, track: null, pos: 0, playing: false, rate: 1, at: now }, queue: [] };
            for (let tries = 0; tries < 10; tries++) {
                code = ''; for (let i = 0; i < 5; i++) code += alphabet[crypto.randomInt(alphabet.length)];
                room.code = code;
                const [ok] = await redis([['SET', K.room(code), JSON.stringify(room), 'EX', TTL, 'NX']]);
                if (ok) {
                    await redis([['HSET', K.mem(code), me, memberRec(true)], ['EXPIRE', K.mem(code), TTL]]);
                    return out(200, { room: code, token });
                }
            }
            throw new Fail(500, 'Could not make a room, try again');
        }
        if (!code) throw new Fail(400, 'Missing room');

        if (op === 'state') {
            // host: what's playing and what's next. Gets back friends' added songs and button presses.
            const room = await loadRoom(code);
            if (!safeEq(room.token, input.token || '')) throw new Fail(403, 'Only the host can do that');
            const track = cleanTrack(input.track);
            const queue = (Array.isArray(input.queue) ? input.queue : []).slice(0, 50).map(cleanTrack).filter(Boolean);
            const changed = JSON.stringify([track && track.id, queue.map((q) => q.id + (q.by || '')), !!input.control]) !== room.sig;
            room.host = { ...room.host, name: myName, track, pos: Math.max(0, parseFloat(input.pos) || 0), playing: !!input.playing,
                rate: Math.max(0.5, Math.min(2, parseFloat(input.rate) || 1)), at: now };
            room.queue = queue;
            room.control = input.control !== false;
            room.autoplay = input.autoplay !== false;
            if (changed) { room.ver = (room.ver || 0) + 1; room.sig = JSON.stringify([track && track.id, queue.map((q) => q.id + (q.by || '')), !!input.control]); }
            const r = await redis([
                ['SET', K.room(code), JSON.stringify(room), 'EX', TTL],
                ['HSET', K.mem(code), me, memberRec(true, room.created)],
                ['EXPIRE', K.mem(code), TTL],
                ['LPOP', K.adds(code), 50],
                ['LPOP', K.cmds(code), 20],
                ['HGETALL', K.mem(code)],
            ]);
            return out(200, { ok: true, adds: parseList(r[3]), cmds: parseList(r[4]), members: membersFrom(r[5], now) });
        }
        if (op === 'get') {             // friend: follow the host
            const [s, flat] = await redis([['GET', K.room(code)], ['HGETALL', K.mem(code)]]);
            if (!s) {
                const [ended] = await redis([['GET', 'jam2:' + code + ':ended']]);
                throw new Fail(ended ? 410 : 404, 'The Jam has ended');
            }
            const room = JSON.parse(s);
            if (isKicked(room, me)) throw new Fail(403, 'The host removed you from the Jam');
            const all = membersFrom(flat, 0);
            const mine = all.find((m) => m.id === me);
            if (mine || all.length < 30) await redis([['HSET', K.mem(code), me, memberRec(false, mine && mine.joined)]]);
            const list = membersFrom(flat, now).filter((m) => m.id !== me);
            list.push({ id: me, name: myName, host: false, seen: now, joined: (mine && mine.joined) || now });
            return out(200, publicRoom(room, list.sort((a, b) => (b.host ? 1 : 0) - (a.host ? 1 : 0) || a.joined - b.joined)));
        }
        if (op === 'add') {             // friend: add a song (lands in the host's queue)
            const t = cleanTrack(input.track);
            if (!t) throw new Fail(400, 'Bad song');
            const [rs, len] = await redis([['GET', K.room(code)], ['LLEN', K.adds(code)]]);
            if (!rs) throw new Fail(404, 'The Jam has ended');
            if (isKicked(JSON.parse(rs), me)) throw new Fail(403, 'The host removed you from the Jam');
            if (len >= 50) throw new Fail(429, 'Too many songs waiting, try again in a moment');
            await redis([['RPUSH', K.adds(code), JSON.stringify({ ...t, by: myName, byId: me, next: !!input.next })], ['EXPIRE', K.adds(code), TTL]]);
            return out(200, { ok: true });
        }
        if (op === 'cmd') {             // friend: play / pause / skip for everyone (if the host allows it)
            const room = await loadRoom(code);
            if (isKicked(room, me)) throw new Fail(403, 'The host removed you from the Jam');
            const c = String(input.cmd || '');
            if (!['play', 'pause', 'next', 'prev', 'jump', 'remove'].includes(c)) throw new Fail(400, 'Bad request');
            if (c !== 'remove' && !room.control) throw new Fail(403, 'The host turned off controls for friends');
            const cmd = { cmd: c, by: myName, at: now };
            if (c === 'remove') cmd.name = cleanStr(input.name, 160);
            if (c === 'jump' || c === 'remove') { cmd.id = String(input.id || '').replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 20); cmd.i = Math.max(0, Math.min(49, parseInt(input.i, 10) || 0)); }
            await redis([['RPUSH', K.cmds(code), JSON.stringify(cmd)], ['EXPIRE', K.cmds(code), TTL]]);
            return out(200, { ok: true });
        }
        if (op === 'kick') {            // host removes someone
            const room = await loadRoom(code);
            if (!safeEq(room.token, input.token || '')) throw new Fail(403, 'Only the host can do that');
            const who = cleanId(input.who);
            if (!who || who === room.host.id) throw new Fail(400, 'Bad request');
            room.kicked = [...new Set([...(room.kicked || []), who])].slice(-100);
            const r = await redis([['SET', K.room(code), JSON.stringify(room), 'EX', TTL], ['HDEL', K.mem(code), who], ['HGETALL', K.mem(code)]]);
            return out(200, { ok: true, members: membersFrom(r[2], now) });
        }
        if (op === 'leave') {           // friend leaves
            await redis([['HDEL', K.mem(code), me]]);
            return out(200, { ok: true });
        }
        if (op === 'end') {             // host ends the Jam for everyone
            const room = await loadRoom(code);
            if (!safeEq(room.token, input.token || '')) throw new Fail(403, 'Only the host can do that');
            await redis([['DEL', K.room(code)], ['DEL', K.mem(code)], ['DEL', K.adds(code)], ['DEL', K.cmds(code)], ['SET', 'jam2:' + code + ':ended', '1', 'EX', 3600]]);
            return out(200, { ok: true });
        }
        throw new Fail(400, 'Unknown request');
    } catch (e) {
        if (e instanceof Fail) return out(e.code, { error: e.message });
        console.error(e);
        return out(500, { error: 'Storage error' });
    }
};
