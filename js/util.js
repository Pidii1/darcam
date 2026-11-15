/* Darcam — shared helpers, icons, events */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const _decoder = document.createElement('textarea');
function decodeEntities(s) {
    if (!s || s.indexOf('&') === -1) return s || '';
    _decoder.innerHTML = s;
    return _decoder.value;
}

function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtCount(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(n);
}

function debounce(fn, ms) {
    let t;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function shuffleArr(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}

/* Tiny event bus */
const Bus = {
    _h: {},
    on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return () => this.off(ev, fn); },
    off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter((f) => f !== fn); },
    emit(ev, data) { (this._h[ev] || []).forEach((f) => { try { f(data); } catch (e) { console.error(e); } }); },
};

/* Safe localStorage JSON */
const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

/* ---------- Icons (24px line set, drawn for Darcam) ---------- */
const ICONS = {
    home: '<path d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.8H9.2v5.8H5A1.5 1.5 0 0 1 3.5 19z"/>',
    homeFill: '<path fill="currentColor" stroke="none" d="M11.1 2.8a1.5 1.5 0 0 1 1.8 0l8.2 6.4c.4.3.6.7.6 1.2V19a2 2 0 0 1-2 2h-4.4a.6.6 0 0 1-.6-.6v-5.2H9.3v5.2a.6.6 0 0 1-.6.6H4.3a2 2 0 0 1-2-2v-8.6c0-.5.2-.9.6-1.2z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.2-4.2"/>',
    library: '<path d="M4.5 3.5v17M9.5 3.5v17"/><path d="m14 4 6 16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    heart: '<path d="M12 20.3 4.6 13a4.9 4.9 0 0 1 0-7 4.9 4.9 0 0 1 7 0l.4.4.4-.4a4.9 4.9 0 0 1 7 0 4.9 4.9 0 0 1 0 7z"/>',
    heartFill: '<path fill="currentColor" d="M12 20.3 4.6 13a4.9 4.9 0 0 1 0-7 4.9 4.9 0 0 1 7 0l.4.4.4-.4a4.9 4.9 0 0 1 7 0 4.9 4.9 0 0 1 0 7z"/>',
    play: '<path fill="currentColor" stroke="none" d="M7 4.9v14.2a1.3 1.3 0 0 0 2 1.1l11.2-7.1a1.3 1.3 0 0 0 0-2.2L9 3.8a1.3 1.3 0 0 0-2 1.1z"/>',
    pause: '<rect fill="currentColor" stroke="none" x="5.5" y="4" width="4.6" height="16" rx="1.4"/><rect fill="currentColor" stroke="none" x="13.9" y="4" width="4.6" height="16" rx="1.4"/>',
    prev: '<path fill="currentColor" stroke="none" d="M5 4.5h2.2v15H5z"/><path fill="currentColor" stroke="none" d="M19.5 5.6v12.8a1.2 1.2 0 0 1-1.9 1L9 13a1.2 1.2 0 0 1 0-2l8.6-6.4a1.2 1.2 0 0 1 1.9 1z"/>',
    next: '<path fill="currentColor" stroke="none" d="M16.8 4.5H19v15h-2.2z"/><path fill="currentColor" stroke="none" d="M4.5 5.6v12.8a1.2 1.2 0 0 0 1.9 1L15 13a1.2 1.2 0 0 0 0-2L6.4 4.6a1.2 1.2 0 0 0-1.9 1z"/>',
    shuffleSmart: '<path d="M16.5 13.5 20 17l-3.5 3.5"/><path d="M3.5 7H7c2 0 3 1 4 2.6l2 3.3c1 1.6 2 2.6 4 2.6"/><path d="M3.5 17H7c1.3 0 2.2-.4 2.9-1.2"/><path d="M13.6 8.2c.7-.8 1.6-1.2 2.9-1.2"/><path d="M19.5 2.5c.3 1.6 1.1 2.4 2.7 2.7-1.6.3-2.4 1.1-2.7 2.7-.3-1.6-1.1-2.4-2.7-2.7 1.6-.3 2.4-1.1 2.7-2.7z" fill="currentColor" stroke-width="1"/>',
    shuffle: '<path d="M16.5 3.5 20 7l-3.5 3.5"/><path d="M16.5 13.5 20 17l-3.5 3.5"/><path d="M3.5 7H7c2 0 3 1 4 2.6l2 3.3c1 1.6 2 2.6 4 2.6"/><path d="M3.5 17H7c1.3 0 2.2-.4 2.9-1.2"/><path d="M13.6 8.2c.7-.8 1.6-1.2 2.9-1.2H19"/>',
    repeat: '<path d="M17 3 20.5 6.5 17 10"/><path d="M3.5 11.5v-1a4 4 0 0 1 4-4h13"/><path d="M7 21 3.5 17.5 7 14"/><path d="M20.5 12.5v1a4 4 0 0 1-4 4h-13"/>',
    repeatOne: '<path d="M17 3 20.5 6.5 17 10"/><path d="M3.5 11.5v-1a4 4 0 0 1 4-4h13"/><path d="M7 21 3.5 17.5 7 14"/><path d="M20.5 12.5v1a4 4 0 0 1-4 4h-13"/><path d="M11.2 10.2 12.6 9.4v5.2"/>',
    volume: '<path d="M11 5 6.6 8.6H3.5v6.8h3.1L11 19z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6"/><path d="M18.6 6a8.6 8.6 0 0 1 0 12"/>',
    volumeLow: '<path d="M11 5 6.6 8.6H3.5v6.8h3.1L11 19z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6"/>',
    volumeMute: '<path d="M11 5 6.6 8.6H3.5v6.8h3.1L11 19z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    more: '<circle fill="currentColor" stroke="none" cx="5" cy="12" r="1.7"/><circle fill="currentColor" stroke="none" cx="12" cy="12" r="1.7"/><circle fill="currentColor" stroke="none" cx="19" cy="12" r="1.7"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    queue: '<path d="M3.5 6h11M3.5 11h11M3.5 16h7"/><path d="M18.5 17.5V6.5l2.5.8"/><circle cx="16.8" cy="17.5" r="1.9"/>',
    mic: '<rect x="9" y="2.8" width="6" height="11.4" rx="3"/><path d="M18.5 10.5v.8a6.5 6.5 0 0 1-13 0v-.8"/><path d="M12 18v3.2"/>',
    lyrics: '<path d="M5 4.5h14A2 2 0 0 1 21 6.5v9a2 2 0 0 1-2 2h-8.2l-4.6 3.6a.6.6 0 0 1-1-.5v-3.1H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z"/><path d="M7.5 9.2h9M7.5 12.8h5.5"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2.6"/><path d="M7.6 4v16M16.4 4v16M3 9.2h4.6M3 14.8h4.6M16.4 9.2H21M16.4 14.8H21"/>',
    video: '<rect x="2.8" y="5.5" width="13.4" height="13" rx="2.6"/><path d="m16.2 10.2 5-2.9v9.4l-5-2.9"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
    trash: '<path d="M4 6.5h16M9.5 6.5V4.5h5v2M18 6.5l-.8 12.6a1.5 1.5 0 0 1-1.5 1.4H8.3a1.5 1.5 0 0 1-1.5-1.4L6 6.5"/>',
    music: '<path d="M9 18V5.5l11-2v12.5"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="17.5" cy="16" r="2.6"/>',
    user: '<circle cx="12" cy="8.2" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    translate: '<path d="M4 5.5h9M8.5 3.5v2M6 5.5c.6 3.2 2.7 5.7 6 7.2"/><path d="M11 5.5c-.7 3.6-3 6.4-6.6 7.9"/><path d="m13 20.5 3.8-9 3.8 9M14.3 17.5h5"/>',
    romanize: '<path d="M4 18 8 6l4 12M5.4 14h5.2"/><path d="M14.5 10.5h5M17 8.5v2M15.2 12.5c.8 2.4 2.4 4.1 4.3 5"/><path d="M18.8 12.5c-.6 2.5-2 4.4-4.3 5.6"/>',
    check: '<path d="M20 6.5 9.2 17.3 4 12.1"/>',
    download: '<path d="M12 3.5v12M7 10.5l5 5 5-5M4.5 20.5h15"/>',
    upload: '<path d="M12 15.5v-12M7 8.5l5-5 5 5M4.5 20.5h15"/>',
    expand: '<path d="M14.5 3.5h6v6M9.5 20.5h-6v-6M20.5 3.5l-6.5 6.5M3.5 20.5l6.5-6.5"/>',
    disc: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.4"/>',
    radio: '<circle cx="12" cy="12" r="1.8"/><path d="M15.8 8.2a5.4 5.4 0 0 1 0 7.6M8.2 15.8a5.4 5.4 0 0 1 0-7.6M18.7 5.3a9.5 9.5 0 0 1 0 13.4M5.3 18.7a9.5 9.5 0 0 1 0-13.4"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 15.5"/><path d="M20 20v-4.5h-4.5"/>',
    text: '<path d="M4.5 7V4.5h15V7M9 19.5h6M12 4.5v15"/>',
    minus: '<path d="M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    image: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="9" cy="9" r="1.8"/><path d="m20.5 15-5-5-11 11"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.4"/><path d="M3.5 3.8v4.6h4.6"/><path d="M12 7.5V12l3 2"/>',
    sparkle: '<path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z"/><path d="M19 15.5c.3 1.8 1.2 2.7 3 3-1.8.3-2.7 1.2-3 3-.3-1.8-1.2-2.7-3-3 1.8-.3 2.7-1.2 3-3z"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/>',
    grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 18.5v2M18.5 14h2"/>',
    pip: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor"/>',
    camera: '<path d="M4 8.5A2 2 0 0 1 6 6.5h2l1.5-2h5L16 6.5h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
    pin: '<path d="M15 3.5 20.5 9l-3 1.2-3.7 3.7.8 4.6-1.6 1.6-4-4-5 5-.9-.9 5-5-4-4 1.6-1.6 4.6.8 3.7-3.7z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.8"/><path d="M16 14.2a5.5 5.5 0 0 1 6 5.8"/>',
    share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
    car: '<path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5"/><path d="M3.5 12h17v4.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><path d="M6 17.5v1.5M18 17.5v1.5"/><circle cx="7.5" cy="14.6" r=".6" fill="currentColor"/><circle cx="16.5" cy="14.6" r=".6" fill="currentColor"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.4 5.2 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.2-3.4-8.5s1-6.1 3.4-8.5z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>',
};
function ic(name, cls = '') {
    const p = ICONS[name] || ICONS.music;
    return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
function hydrateIcons(root = document) {
    $$('i[data-ic]', root).forEach((el) => { el.outerHTML = ic(el.dataset.ic); });
}

/* Darcam logo mark (inline, no network) */
const LOGO_TPL = `<svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="dgl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF4F93"/><stop offset="1" stop-color="#E5243B"/></linearGradient><mask id="dml"><rect width="512" height="512" fill="#fff"/><rect x="213" y="224" width="26" height="64" rx="13" fill="#000"/><rect x="251" y="194" width="26" height="124" rx="13" fill="#000"/><rect x="289" y="212" width="26" height="88" rx="13" fill="#000"/></mask></defs><path d="M138 128 H250 A128 128 0 0 1 250 384 H138 Z" transform="translate(12 0)" fill="url(#dgl)" mask="url(#dml)" stroke="url(#dgl)" stroke-width="20" stroke-linejoin="round"/></svg>`;

let _logoN = 0;
function logo() { const n = ++_logoN; return LOGO_TPL.replace(/dgl/g, 'dgl' + n).replace(/dml/g, 'dml' + n); }
Object.defineProperty(window, 'LOGO_SVG', { get: logo });

/* Dominant colour from an image (cover art) → used to tint the player */
const ColorCache = new Map();
function dominantColor(url) {
    if (!url) return Promise.resolve(null);
    if (ColorCache.has(url)) return Promise.resolve(ColorCache.get(url));
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const c = document.createElement('canvas');
                const S = 24; c.width = S; c.height = S;
                const x = c.getContext('2d', { willReadFrequently: true });
                // centre crop (covers are 16:9 thumbnails)
                const side = Math.min(img.width, img.height);
                x.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
                const d = x.getImageData(0, 0, S, S).data;
                let r = 0, g = 0, b = 0, w = 0;
                for (let i = 0; i < d.length; i += 4) {
                    const R = d[i], G = d[i + 1], B = d[i + 2];
                    const max = Math.max(R, G, B), min = Math.min(R, G, B);
                    const sat = max ? (max - min) / max : 0;
                    const lum = (R + G + B) / 3;
                    const wt = 0.15 + sat * (lum > 25 && lum < 235 ? 1 : 0.1);
                    r += R * wt; g += G * wt; b += B * wt; w += wt;
                }
                r /= w; g /= w; b /= w;
                // keep it calm: limit brightness
                const l = (r + g + b) / 3, k = l > 120 ? 120 / l : 1;
                const col = [Math.round(r * k), Math.round(g * k), Math.round(b * k)];
                ColorCache.set(url, col);
                resolve(col);
            } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

/* Simple JSONP (for search suggestions) */
let _jsonpN = 0;
function jsonp(url, timeout = 4000) {
    return new Promise((resolve, reject) => {
        const cb = '__dcj' + (++_jsonpN);
        const s = document.createElement('script');
        const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeout);
        function cleanup() { clearTimeout(t); delete window[cb]; s.remove(); }
        window[cb] = (data) => { cleanup(); resolve(data); };
        s.onerror = () => { cleanup(); reject(new Error('jsonp error')); };
        s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
        document.head.appendChild(s);
    });
}

async function fetchJSON(url, { timeout = 12000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
        const r = await fetch(url, { signal: ctrl.signal });
        const j = await r.json().catch(() => null);
        if (!r.ok) { const e = new Error((j && j.error && j.error.message) || 'HTTP ' + r.status); e.status = r.status; e.body = j; throw e; }
        return j;
    } finally { clearTimeout(t); }
}

function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Good evening';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
        return 'Good evening';
}
