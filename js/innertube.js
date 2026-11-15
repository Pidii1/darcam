/* Darcam — "unlimited" engine: talks to YouTube / YouTube Music the way their own apps do.
   No key and no daily limit. Windows / Android talk to YouTube directly; the web version goes
   through yt.php on the same server (a web page isn't allowed to reach YouTube itself).
   Unofficial: YouTube can change it at any time. */
'use strict';

const InnerTube = (() => {
    const CLIENTS = {
        music: { host: 'music.youtube.com', name: 'WEB_REMIX', version: '1.20251110.01.00' },
        web: { host: 'www.youtube.com', name: 'WEB', version: '2.20251110.01.00' },
    };
    const isCap = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    const viaElectron = () => !!(window.darcamNative && window.darcamNative.innertube);
    const supported = () => true;
    const enabled = () => true;
    const direct = () => viaElectron() || isCap();
    let failStreak = 0, pausedUntil = 0;

    async function post(kind, endpoint, body) {
        const c = CLIENTS[kind];
        const payload = { context: { client: { clientName: c.name, clientVersion: c.version, hl: 'en', gl: 'MY' } }, ...body };
        const url = `https://${c.host}/youtubei/v1/${endpoint}?prettyPrint=false`;
        let j;
        if (viaElectron()) j = await window.darcamNative.innertube(url, payload);
        else if (isCap()) {
            const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            j = await r.json();
        } else {
            // web: same-server relay
            const r = await fetch('yt.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: kind, endpoint, body: payload }) });
            if (r.status === 404) throw new Error('yt.php is missing on this server');
            if (!r.ok) throw new Error('HTTP ' + r.status);
            j = await r.json();
        }
        if (!j || typeof j !== 'object') throw new Error('Empty answer');
        return j;
    }
    // after repeated failures, rest for a while and let the key-based API do the work
    async function call(kind, endpoint, body) {
        if (Date.now() < pausedUntil) throw new Error('Engine resting');
        try { const j = await post(kind, endpoint, body); failStreak = 0; return j; }
        catch (e) { if (++failStreak >= 4) { pausedUntil = Date.now() + 10 * 60e3; failStreak = 0; } throw e; }
    }

    // ---------- tiny helpers for the nested answers ----------
    function* walk(o, key) {
        if (Array.isArray(o)) { for (const x of o) yield* walk(x, key); return; }
        if (o && typeof o === 'object') for (const k in o) { if (k === key) yield o[k]; yield* walk(o[k], key); }
    }
    const all = (o, key) => [...walk(o, key)];
    const first = (o, key) => { for (const v of walk(o, key)) return v; return undefined; };
    const text = (t) => !t ? '' : t.simpleText != null ? t.simpleText : (t.runs || []).map((r) => r.text).join('');
    const secs = (s) => { const p = String(s || '').trim().split(':').map(Number); if (!p.length || p.some(isNaN)) return 0; return p.reduce((a, b) => a * 60 + b, 0); };
    const num = (s) => { const m = String(s || '').replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i); if (!m) return 0; return Math.round(+m[1] * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1)); };
    const https = (u) => (u || '').replace(/^\/\//, 'https://');
    const bigImg = (u) => https(u).replace(/=s\d+(-[^=]*)?$/, '=s400$1').replace(/=w\d+-h\d+/, '=w400-h400');

    return { supported, enabled, direct, call, all, first, text, secs, num, https, bigImg };
})();
