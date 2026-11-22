// =====================================================================
// Song poster: pick up to 5 songs from a playlist and make a picture
// (mini player cards, your own photo, light effects, stickers, text),
// always signed with the Darcam logo at the bottom.
// =====================================================================
const Poster = (() => {
    const W = 1080, H = 1920, MAX = 5, MAX_STICKERS = 30;
    const CW = 330, CH = 502; // card size before scaling
    const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';

    // ---------- small helpers ----------
    const imgCache = new Map();
    function loadImg(src, cors = true) {
        if (!src) return Promise.resolve(null);
        const key = (cors ? 'c:' : 'n:') + src;
        if (imgCache.has(key)) return imgCache.get(key);
        const p = new Promise((res) => {
            const i = new Image(); if (cors && !/^data:|^blob:/.test(src)) i.crossOrigin = 'anonymous';
            i.onload = () => res(i); i.onerror = () => res(null); i.src = src;
        });
        imgCache.set(key, p); return p;
    }
    function rnd(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
    function rr(x, X, Y, w, h, r) { x.beginPath(); if (x.roundRect) x.roundRect(X, Y, w, h, r); else x.rect(X, Y, w, h); }
    function fitText(x, t, maxW) { if (x.measureText(t).width <= maxW) return t; while (t.length > 1 && x.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; }
    // square crop that skips the black bars YouTube puts inside its thumbnails
    const cropMemo = new WeakMap();
    function cropSquare(img) {
        if (cropMemo.has(img)) return cropMemo.get(img);
        let x0 = 0, y0 = 0, x1 = img.width, y1 = img.height;
        try {
            const n = 64, c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, n, n);
            const d = x.getImageData(0, 0, n, n).data, dark = (i) => d[i] + d[i + 1] + d[i + 2] < 60;
            const rowDark = (r) => { let k = 0; for (let q = 0; q < n; q++) if (dark((r * n + q) * 4)) k++; return k > n * .92; };
            const colDark = (q) => { let k = 0; for (let r = 0; r < n; r++) if (dark((r * n + q) * 4)) k++; return k > n * .92; };
            let t = 0, b = n - 1, l = 0, rr2 = n - 1; while (t < n / 3 && rowDark(t)) t++; while (b > n * 2 / 3 && rowDark(b)) b--; while (l < n / 3 && colDark(l)) l++; while (rr2 > n * 2 / 3 && colDark(rr2)) rr2--;
            if (t || b < n - 1 || l || rr2 < n - 1) { x0 = (l + .5) / n * img.width; x1 = (rr2 + .5) / n * img.width; y0 = (t + .5) / n * img.height; y1 = (b + .5) / n * img.height; }
        } catch (e) {}
        const w = x1 - x0, h = y1 - y0, s = Math.min(w, h), out = [x0 + (w - s) / 2, y0 + (h - s) / 2, s, s];
        cropMemo.set(img, out); return out;
    }
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    // built-in stickers (white line art, drawn as SVG)
    const STICKERS = {
        bird: ['Bird', '<path d="M6 34c10-2 18-10 22-20 2 8 6 14 14 16-6 2-10 6-12 12-6-8-14-10-24-8z" fill="#fff"/><path d="M28 14c4-6 12-8 20-6-6 2-10 6-12 10" fill="#fff"/>'],
        sparkle: ['Sparkle', '<path d="M32 4c2 14 8 22 26 26-18 4-24 12-26 28-2-16-8-24-26-28 18-4 24-12 26-26z" fill="#fff"/><path d="M52 6c.8 5 3 7 8 8-5 1-7.2 3-8 8-.8-5-3-7-8-8 5-1 7.2-3 8-8z" fill="#fff"/>'],
        heart: ['Heart', '<path d="M32 56S6 40 6 22C6 13 13 7 21 7c5 0 9 3 11 7 2-4 6-7 11-7 8 0 15 6 15 15 0 18-26 34-26 34z" fill="#ff4f93"/>'],
        star: ['Star', '<path d="M32 4l8 18 20 2-15 13 5 20-18-11-18 11 5-20L4 24l20-2z" fill="#ffd34d"/>'],
        note: ['Music', '<path d="M24 10l28-6v36a8 8 0 1 1-6-7.7V14l-16 3.4V46a8 8 0 1 1-6-7.7z" fill="#fff"/>'],
        moon: ['Moon', '<path d="M40 6a24 24 0 1 0 18 34A20 20 0 0 1 40 6z" fill="#ffe7a8"/>'],
        flower: ['Flower', '<g fill="#ffb3cf"><circle cx="32" cy="16" r="11"/><circle cx="48" cy="28" r="11"/><circle cx="42" cy="46" r="11"/><circle cx="22" cy="46" r="11"/><circle cx="16" cy="28" r="11"/></g><circle cx="32" cy="32" r="8" fill="#ffd34d"/>'],
        bolt: ['Bolt', '<path d="M36 4L10 36h18l-6 24 28-34H32z" fill="#ffd34d"/>'],
        crown: ['Crown', '<path d="M6 20l14 12 12-20 12 20 14-12-6 32H12z" fill="#ffd34d"/>'],
        cloud: ['Cloud', '<path d="M18 50a12 12 0 0 1-1-24 16 16 0 0 1 30-4 13 13 0 0 1 3 28z" fill="#fff"/>'],
        disc: ['Vinyl', '<circle cx="32" cy="32" r="28" fill="#111"/><circle cx="32" cy="32" r="20" fill="none" stroke="#333" stroke-width="2"/><circle cx="32" cy="32" r="10" fill="#ff4f93"/><circle cx="32" cy="32" r="2.5" fill="#111"/>'],
        smile: ['Smile', '<circle cx="32" cy="32" r="27" fill="#ffd34d"/><circle cx="23" cy="26" r="3.5" fill="#3a2a00"/><circle cx="41" cy="26" r="3.5" fill="#3a2a00"/><path d="M20 38c6 9 18 9 24 0" stroke="#3a2a00" stroke-width="4" fill="none" stroke-linecap="round"/>'],
    };
    const stickerSrc = (k) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256">${STICKERS[k][1]}</svg>`);
    const MY_KEY = 'dc_poster_stickers';
    const mine = () => LS.get(MY_KEY, []) || [];

    const LAYOUTS = [['orbit', 'Orbit'], ['stack', 'Stack'], ['row', 'Row'], ['column', 'Column']];
    const STYLES = [['cinema', 'Cinema'], ['oldfilm', 'Old film'], ['clean', 'Clean']];
    const TONES = [['original', 'Original'], ['warm', 'Warm'], ['cool', 'Cool'], ['neon', 'Neon'], ['film', 'Film']];
    const FX = [['leak', 'Light leak'], ['flare', 'Lens flare'], ['stars', 'Stars'], ['glow', 'Glow'], ['grain', 'Film grain'], ['edge', 'Card edge']];
    const FONTS = [['bold', 'Bold', `900 {s}px ${FONT}`], ['serif', 'Serif', '700 {s}px Georgia, "Times New Roman", serif'], ['script', 'Script', 'italic 700 {s}px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive'], ['mono', 'Mono', '700 {s}px ui-monospace, Menlo, Consolas, monospace']];

    // layout slots measured from the reference: centre (fractions of the poster), size (card width / poster width),
    // rz = turn on the page, ry = turn in 3D (+ pushes the right edge away)
    function slots(layout, n) {
        const S = (x, y, w, rz, ry) => ({ x, y, w, rz, ry: ry || 0 });
        if (layout === 'orbit') {
            const Q = (S0, q) => Object.assign(S0, { q });
            const T5 = [Q(S(.198, .25, .30, -6.5, 20), [[.0568, .1203], [.3151, .118], [.3471, .3574], [.1033, .3847]]),
                Q(S(.806, .21, .30, 4.5, -20), [[.6818, .0825], [.9463, .0802], [.9174, .344], [.6488, .3155]]),
                Q(S(.500, .417, .305, 0, 0), [[.3481, .2865], [.6529, .2865], [.6529, .5462], [.3481, .5462]]),
                Q(S(.2, .724, .30, 2, 22), [[.0826, .5869], [.3471, .6101], [.3202, .8577], [.0475, .8606]]),
                Q(S(.805, .69, .30, -3.5, -19), [[.6612, .5782], [.9184, .552], [.9566, .824], [.6901, .8368]])];
            const T4 = [Q(S(.24, .29, .33, -3, 20), [[.0651, .1366], [.3771, .1395], [.4184, .4273], [.1085, .4419]]),
                Q(S(.76, .24, .33, 3, -20), [[.625, .0959], [.9401, .0872], [.9091, .3983], [.5888, .3651]]),
                Q(S(.22, .71, .33, 3, 20), [[.0826, .5465], [.3905, .5756], [.3564, .8547], [.0465, .8488]]),
                Q(S(.8, .67, .33, -3, -20), [[.6322, .5378], [.9349, .5087], [.9711, .8169], [.6612, .811]])];
            return ({ 1: [S(.5, .42, .44, 0, 0)], 2: [S(.29, .33, .36, -6, 20), S(.71, .56, .36, 4, -20)], 3: [T5[0], T5[1], S(.5, .52, .32, 0, 0)], 4: T4, 5: T5 })[n];
        }
        if (layout === 'stack') { // a fanned hand of cards across the top
            return Array.from({ length: n }, (_, i) => { const k = n > 1 ? i - (n - 1) / 2 : 0, sp = n > 1 ? Math.min(.17, .68 / (n - 1)) : 0; return S(.5 + k * sp, .182 + Math.abs(k) * Math.abs(k) * .013, n === 1 ? .36 : .26, k * 11.5, -k * 6); });
        }
        if (layout === 'row') { // one straight row along the top
            return Array.from({ length: n }, (_, i) => { const k = i - (n - 1) / 2; return S(.5 + k * .19, .168, .188, 0, 0); });
        }
        // column down the right side
        return Array.from({ length: n }, (_, i) => { const k = i - (n - 1) / 2; return S(.78, .49 + k * .177, .17, 0, -10); });
    }

    // ---------- state ----------
    let P = null;
    function fresh(tracks, sourceTracks, title) {
        return {
            songs: tracks.slice(0, MAX), source: sourceTracks, title,
            photo: null, layout: 'orbit', style: 'cinema', tone: 'warm',
            fx: { leak: .7, flare: .6, stars: .6, glow: .55, grain: 0, edge: .8 },
            cards: {}, stickers: [], order: [], stkSeq: 1, text: { value: '', font: 'bold', size: 1, y: .1, color: '#ffffff' },
            sel: null, seed: (Math.random() * 1e9) | 0,
        };
    }

    // ---------- drawing ----------
    let grainTile = null;
    function grain() {
        if (grainTile) return grainTile;
        const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); const d = x.createImageData(256, 256);
        for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
        x.putImageData(d, 0, 0); return (grainTile = c);
    }
    function palette(img) {
        if (!img) return [[60, 35, 30], [140, 80, 60]];
        try {
            const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d', { willReadFrequently: true });
            x.drawImage(img, ...cropSquare(img), 0, 0, 8, 8); const d = x.getImageData(0, 0, 8, 8).data; let a = [0, 0, 0], b = [0, 0, 0];
            for (let i = 0; i < 64; i++) { const t = i < 32 ? a : b; t[0] += d[i * 4]; t[1] += d[i * 4 + 1]; t[2] += d[i * 4 + 2]; }
            return [a.map((v) => v / 32), b.map((v) => v / 32)];
        } catch (e) { return [[60, 35, 30], [140, 80, 60]]; }
    }
    function vivid(img) {
        if (!img) return [255, 190, 150];
        try {
            const n = 24, c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, ...cropSquare(img), 0, 0, n, n);
            const d = x.getImageData(0, 0, n, n).data; let best = [0, 0, 0], wsum = 0, acc = [0, 0, 0];
            for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0, w = Math.pow(sat, 2) * (mx / 255); acc[0] += r * w; acc[1] += g * w; acc[2] += b * w; wsum += w; }
            if (wsum < 8) best = [255, 200, 165]; else best = acc.map((v) => v / wsum);
            const mx = Math.max(...best) || 1; return best.map((v) => Math.min(255, v * 255 / mx * .95 + 10));
        } catch (e) { return [255, 190, 150]; }
    }
    const TONE_RGB = { original: null, warm: [255, 150, 70], cool: [70, 140, 255], neon: [255, 60, 200], film: [220, 190, 140] };
    const mixc = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

    function drawBackground(x, covers) {
        const tone = TONE_RGB[P.tone];
        let stops = [[0, [34, 27, 28]], [.3, [46, 27, 38]], [.55, [50, 29, 40]], [.78, [76, 52, 38]], [1, [62, 44, 28]]];
        if (P.style === 'clean') stops = [[0, [28, 26, 28]], [.6, [44, 40, 42]], [1, [24, 22, 24]]];
        if (tone && P.tone !== 'warm') stops = stops.map(([o, c]) => [o, mixc(c, tone, .22)]);
        const g = x.createLinearGradient(0, 0, 0, H); stops.forEach(([o, c]) => g.addColorStop(o, rgb(c))); x.fillStyle = g; x.fillRect(0, 0, W, H);
        if (covers[0] && P.style !== 'clean') {
            x.save(); x.globalAlpha = .18; x.filter = 'blur(80px) saturate(1.2)';
            const [sx, sy, s] = cropSquare(covers[0]); x.drawImage(covers[0], sx, sy, s, s, -W * .3, H * .1, W * 1.6, W * 1.6); x.restore();
        }
        if (P.style === 'clean') return;
        // soft light from the top and the warm haze in the middle
        const sp = x.createRadialGradient(W * .5, -H * .05, 20, W * .5, H * .15, H * .7); sp.addColorStop(0, 'rgba(255,215,170,.14)'); sp.addColorStop(1, 'rgba(255,215,170,0)'); x.fillStyle = sp; x.fillRect(0, 0, W, H);
        // stage: a pale arch behind, then a wooden floor with bands
        x.save(); const ag = x.createRadialGradient(W * .5, H * .8, W * .05, W * .5, H * .8, W * .62); ag.addColorStop(0, 'rgba(255,215,175,.24)'); ag.addColorStop(.7, 'rgba(255,215,175,.12)'); ag.addColorStop(1, 'rgba(255,215,175,0)');
        x.fillStyle = ag; x.beginPath(); x.ellipse(W * .5, H * .8, W * .56, H * .21, 0, Math.PI, 0); x.fill(); x.strokeStyle = 'rgba(255,225,190,.12)'; x.lineWidth = 3; x.beginPath(); x.ellipse(W * .5, H * .8, W * .56, H * .21, 0, Math.PI, 0); x.stroke(); x.restore();
        const fy = H * .8, fg = x.createLinearGradient(0, fy, 0, H); fg.addColorStop(0, 'rgba(150,100,60,.55)'); fg.addColorStop(.35, 'rgba(120,80,45,.7)'); fg.addColorStop(1, 'rgba(50,32,18,.95)');
        x.fillStyle = fg; x.fillRect(0, fy, W, H - fy);
        x.save(); for (let k = 0; k < 7; k++) { const yy = fy + (H - fy) * Math.pow((k + 1) / 8, 1.35), hb = 6 + k * 3; const bg2 = x.createLinearGradient(0, 0, W, 0); bg2.addColorStop(0, 'rgba(255,220,170,0)'); bg2.addColorStop(.5, `rgba(255,220,170,${.09 - k * .009})`); bg2.addColorStop(1, 'rgba(255,220,170,0)'); x.fillStyle = bg2; x.fillRect(0, yy, W, hb); } x.restore();
        const ed = x.createLinearGradient(0, fy - 30, 0, fy + 40); ed.addColorStop(0, 'rgba(255,225,185,0)'); ed.addColorStop(.5, 'rgba(255,225,185,.14)'); ed.addColorStop(1, 'rgba(255,225,185,0)'); x.fillStyle = ed; x.fillRect(0, fy - 30, W, 70);
    }

    function drawPhoto(x, img) {
        const ph = P.photo; if (!ph || !img) return;
        const base = ph.fit === 'fit' ? Math.min(W / img.width, H / img.height) : Math.max(W / img.width, H / img.height);
        const s = base * ph.scale, w = img.width * s, h = img.height * s;
        x.save(); x.translate(W / 2 + ph.x * W, H / 2 + ph.y * H); x.rotate(ph.rot * Math.PI / 180); if (ph.mirror) x.scale(-1, 1);
        x.drawImage(img, -w / 2, -h / 2, w, h); x.restore();
        if (ph.cut && ph.useCut) return;
        // soft fade at the bottom so the photo sits on the stage
        const fd = x.createLinearGradient(0, H * .78, 0, H); fd.addColorStop(0, 'rgba(0,0,0,0)'); fd.addColorStop(1, 'rgba(10,6,6,.55)'); x.fillStyle = fd; x.fillRect(0, H * .78, W, H * .22);
    }
    // light leaks: soft haze in the colour of each album picture, spreading from behind its card
    function drawLeaks(x, R, covers) {
        const a = P.fx.leak; if (!a || P.style === 'clean') return;
        x.save(); x.globalCompositeOperation = 'screen';
        const n = P.songs.length;
        P.songs.forEach((t, i) => {
            const pl = cardPlace(i, n), c = vivid(covers[i]), r = W * (.42 + .1 * (i % 2));
            const g = x.createRadialGradient(pl.cx, pl.cy, 0, pl.cx, pl.cy, r); g.addColorStop(0, rgb(c, .34 * a)); g.addColorStop(.5, rgb(c, .12 * a)); g.addColorStop(1, rgb(c, 0));
            x.fillStyle = g; x.fillRect(0, 0, W, H);
        });
        x.restore();
    }
    function sparkle(x, cx, cy, s, a) {
        x.save(); x.globalAlpha = a; x.translate(cx, cy);
        const g = x.createRadialGradient(0, 0, 0, 0, 0, s * 1.4); g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(.25, 'rgba(255,250,240,.25)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.beginPath(); x.arc(0, 0, s * 1.4, 0, 7); x.fill();
        if (s > 12) { x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(-s * 3.2, 0); x.lineTo(s * 3.2, 0); x.moveTo(0, -s * 2.4); x.lineTo(0, s * 2.4); x.stroke(); }
        x.fillStyle = '#fff'; x.beginPath(); x.moveTo(0, -s * 1.5); x.quadraticCurveTo(s * .12, -s * .12, s * 1.5, 0); x.quadraticCurveTo(s * .12, s * .12, 0, s * 1.5); x.quadraticCurveTo(-s * .12, s * .12, -s * 1.5, 0); x.quadraticCurveTo(-s * .12, -s * .12, 0, -s * 1.5); x.fill();
        x.restore();
    }
    function drawStars(x, R) {
        const a = P.fx.stars; if (!a) return;
        // the big ones always sit in the same places, the small dust is random
        [[.036, .244, 26], [.966, .526, 26], [.53, .665, 30], [.077, .13, 22], [.28, .078, 9], [.555, .095, 7], [.89, .43, 8], [.765, .38, 9], [.065, .54, 8], [.46, .748, 9], [.37, .662, 7]].forEach(([fx, fy, s], i) => { if (i < 4 || R() < a + .2) sparkle(x, fx * W, fy * H, s * (.6 + .5 * a), Math.min(1, .5 + a)); });
        const n = Math.round(a * 26); for (let i = 0; i < n; i++) sparkle(x, R() * W, R() * H * .82, 2 + R() * 5, .5 + R() * .5);
    }
    function drawFlare(x) {
        const a = P.fx.flare; if (!a) return;
        const y1 = H * .205, y2 = H * .118, px = W * .37, py = y1 + (y2 - y1) * .37;
        x.save(); x.globalCompositeOperation = 'screen';
        const g = x.createLinearGradient(0, y1, W, y2); g.addColorStop(0, `rgba(255,190,140,${.35 * a})`); g.addColorStop(.37, `rgba(255,248,235,${.95 * a})`); g.addColorStop(.8, `rgba(255,220,180,${.25 * a})`); g.addColorStop(1, 'rgba(255,220,180,0)');
        x.strokeStyle = g; x.lineWidth = 3; x.shadowColor = 'rgba(255,190,130,1)'; x.shadowBlur = 24; x.beginPath(); x.moveTo(0, y1); x.lineTo(W, y2); x.stroke();
        x.lineWidth = 22; x.globalAlpha = .18; x.stroke(); x.restore();
        x.save(); x.globalCompositeOperation = 'screen'; x.filter = 'blur(40px)'; x.strokeStyle = `rgba(255,170,150,${.16 * a})`; x.lineWidth = 220; x.beginPath(); x.moveTo(-100, y1 + 60); x.lineTo(W + 100, y2 - 40); x.stroke(); x.restore();
        sparkle(x, px, py, 22, a);
        x.save(); x.globalCompositeOperation = 'screen'; const hg = x.createRadialGradient(px, py, 0, px, py, W * .22); hg.addColorStop(0, `rgba(255,200,150,${.35 * a})`); hg.addColorStop(1, 'rgba(255,200,150,0)'); x.fillStyle = hg; x.fillRect(px - W * .25, py - W * .25, W * .5, W * .5); x.restore();
    }

    function glyph(x, kind, cx, cy, s, col) {
        x.save(); x.fillStyle = col; x.strokeStyle = col; x.translate(cx, cy);
        if (kind === 'pause') { rr(x, -s * .55, -s * .7, s * .38, s * 1.4, 3); x.fill(); rr(x, s * .17, -s * .7, s * .38, s * 1.4, 3); x.fill(); }
        else { const d = kind === 'next' ? 1 : -1; for (let k = 0; k < 2; k++) { const o = (k - .5) * s * .9 * d; x.beginPath(); x.moveTo(o - s * .45 * d, -s * .6); x.lineTo(o + s * .45 * d, 0); x.lineTo(o - s * .45 * d, s * .6); x.closePath(); x.fill(); } }
        x.restore();
    }
    function heart(x, cx, cy, s, col) { x.save(); x.strokeStyle = col; x.lineWidth = 2.6; x.translate(cx, cy); x.beginPath(); x.moveTo(0, s * .8); x.bezierCurveTo(-s * 1.4, -s * .1, -s * .7, -s * 1.1, 0, -s * .35); x.bezierCurveTo(s * .7, -s * 1.1, s * 1.4, -s * .1, 0, s * .8); x.stroke(); x.restore(); }

    // one mini player card, drawn flat at 2x into its own canvas
    const K = 2;
    function cardCanvas(t, img, i, mark, backdrop) {
        const c = document.createElement('canvas'); c.width = CW * K; c.height = CH * K; const x = c.getContext('2d');
        if (backdrop) { rr(x, 0, 0, c.width, c.height, 30 * K); x.save(); x.clip(); x.drawImage(backdrop, 0, 0); x.restore(); }
        x.scale(K, K);
        const R = rnd(P.seed + i * 97), prog = .35 + R() * .4, dur = (t.duration_ms || (170 + R() * 90) * 1000) / 1000;
        const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
        // smoky glass: see-through so the light behind tints the card
        const bg = x.createLinearGradient(0, 0, 0, CH); bg.addColorStop(0, 'rgba(34,28,28,.70)'); bg.addColorStop(1, 'rgba(18,15,15,.82)');
        rr(x, 0, 0, CW, CH, 30); x.fillStyle = bg; x.fill();
        // album picture
        const ci = 31, ct = 24, cs = CW - ci * 2; rr(x, ci, ct, cs, cs, 22); x.save(); x.clip();
        if (img) x.drawImage(img, ...cropSquare(img), ci, ct, cs, cs); else { x.fillStyle = '#3a2c2c'; x.fillRect(ci, ct, cs, cs); x.fillStyle = 'rgba(255,255,255,.35)'; x.font = `700 70px ${FONT}`; x.textAlign = 'center'; x.fillText('♪', CW / 2, ct + cs / 2 + 24); x.textAlign = 'left'; }
        x.restore();
        const ink = '#fbf8f5', soft = 'rgba(251,248,245,.62)', dim = 'rgba(251,248,245,.45)';
        // little brand line
        x.strokeStyle = dim; x.lineWidth = 1.6; x.beginPath(); x.moveTo(ci + 1, 302); x.lineTo(ci + 5, 306); x.lineTo(ci + 11, 298); x.stroke();
        x.fillStyle = dim; x.font = `500 12px ${FONT}`; x.fillText('Darcam', ci + 16, 307);
        x.fillStyle = ink; x.font = `700 27px ${FONT}`; x.fillText(fitText(x, T.title(t), cs - 40), ci, 336);
        x.fillStyle = soft; x.font = `400 19px ${FONT}`; x.fillText(fitText(x, T.artist(t), cs - 40), ci, 361);
        heart(x, CW - ci - 12, 328, 12, ink);
        // progress
        const py = 388; rr(x, ci, py - 1.5, cs, 3, 2); x.fillStyle = 'rgba(255,255,255,.28)'; x.fill();
        rr(x, ci, py - 1.5, cs * prog, 3, 2); x.fillStyle = ink; x.fill(); x.beginPath(); x.arc(ci + cs * prog, py, 6.5, 0, 7); x.fill();
        x.fillStyle = dim; x.font = `500 13px ${FONT}`; x.fillText(fmt(dur * prog), ci, py + 24); x.textAlign = 'right'; x.fillText('-' + fmt(dur * (1 - prog)), CW - ci, py + 24); x.textAlign = 'left';
        // big controls
        const cy = 442; glyph(x, 'prev', CW / 2 - 68, cy, 17, ink); glyph(x, 'pause', CW / 2, cy, 19, ink); glyph(x, 'next', CW / 2 + 68, cy, 17, ink);
        // volume
        const vy = 478, spk = (X, waves) => { x.fillStyle = ink; x.beginPath(); x.moveTo(X, vy - 4); x.lineTo(X + 5, vy - 4); x.lineTo(X + 11, vy - 9); x.lineTo(X + 11, vy + 9); x.lineTo(X + 5, vy + 4); x.lineTo(X, vy + 4); x.fill(); if (waves) { x.strokeStyle = ink; x.lineWidth = 1.8; x.beginPath(); x.arc(X + 12, vy, 5, -1, 1); x.stroke(); x.beginPath(); x.arc(X + 12, vy, 9.5, -1, 1); x.stroke(); } };
        spk(ci, false); spk(CW - ci - 22, true);
        rr(x, ci + 22, vy - 1.5, cs - 58, 3, 2); x.fillStyle = 'rgba(255,255,255,.28)'; x.fill(); rr(x, ci + 22, vy - 1.5, (cs - 58) * .74, 3, 2); x.fillStyle = ink; x.fill();
        x.beginPath(); x.arc(ci + 22, vy, 3.5, 0, 7); x.fill();
        return c;
    }
    // 3D: project the card's corners (and a grid inside it) onto the poster
    function project(pl) {
        if (pl.q) {
            const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = pl.q, dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
            const den = dx1 * dy2 - dx2 * dy1, g = den ? (dx3 * dy2 - dx2 * dy3) / den : 0, h = den ? (dx1 * dy3 - dx3 * dy1) / den : 0;
            const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
            return (u, v) => { const z = g * u + h * v + 1; return [(a * u + b * v + x0) / z, (d * u + e * v + y0) / z]; };
        }
        const w = pl.w, h = w * CH / CW, D = 1700, ry = pl.ry * Math.PI / 180, rz = pl.rz * Math.PI / 180, cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
        return (u, v) => { let X = (u - .5) * w, Y = (v - .5) * h, Z = 0; const x1 = X * cy, z1 = -X * sy; const f = D / (D + z1); X = x1 * f; Y = Y * f; return [pl.cx + X * cz - Y * sz, pl.cy + X * sz + Y * cz]; };
    }
    function mesh(x, img, sp, dp, expand) {
        const NX = 6, NY = 10;
        const tri = (s0, s1, s2, d0, d1, d2) => {
            const [x0, y0] = s0, [x1, y1] = s1, [x2, y2] = s2, [u0, v0] = d0, [u1, v1] = d1, [u2, v2] = d2;
            const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1); if (!den) return;
            const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den, b = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den;
            const c = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den, d = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den;
            const e = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den, f = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den;
            const mx = (u0 + u1 + u2) / 3, my = (v0 + v1 + v2) / 3, ex = (p) => [p[0] + Math.sign(p[0] - mx) * expand, p[1] + Math.sign(p[1] - my) * expand];
            const q0 = ex(d0), q1 = ex(d1), q2 = ex(d2);
            x.save(); x.beginPath(); x.moveTo(q0[0], q0[1]); x.lineTo(q1[0], q1[1]); x.lineTo(q2[0], q2[1]); x.closePath(); x.clip();
            x.transform(a, b, c, d, e, f); x.drawImage(img, 0, 0); x.restore();
        };
        for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
            const u0 = i / NX, u1 = (i + 1) / NX, v0 = j / NY, v1 = (j + 1) / NY;
            const s00 = sp(u0, v0), s10 = sp(u1, v0), s01 = sp(u0, v1), s11 = sp(u1, v1), d00 = dp(u0, v0), d10 = dp(u1, v0), d01 = dp(u0, v1), d11 = dp(u1, v1);
            tri(s00, s10, s11, d00, d10, d11); tri(s00, s11, s01, d00, d11, d01);
        }
    }
    const warp = (x, src, pr) => mesh(x, src, (u, v) => [u * src.width, v * src.height], pr, .9);
    // card outline with rounded corners, projected into 3D
    const quad = (x, pr) => {
        const ru = 30 / CW, rv = 30 / CH, pts = [], arc = (cu, cv, a0) => { for (let k = 0; k <= 6; k++) { const a = a0 + k / 6 * Math.PI / 2; pts.push(pr(cu + Math.cos(a) * ru, cv + Math.sin(a) * rv)); } };
        arc(1 - ru, rv, -Math.PI / 2); arc(1 - ru, 1 - rv, 0); arc(ru, 1 - rv, Math.PI / 2); arc(ru, rv, Math.PI);
        x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath();
    };
    function drawCard3D(x, t, img, i, mark, pl, glowCol) {
        const pr = project(pl), gl = P.fx.glow, e = P.fx.edge, th = pl.w * .02;
        let side = pl.ry; if (pl.q) { const L = Math.hypot(pl.q[3][0] - pl.q[0][0], pl.q[3][1] - pl.q[0][1]), Rr = Math.hypot(pl.q[2][0] - pl.q[1][0], pl.q[2][1] - pl.q[1][1]); side = L > Rr * 1.02 ? 1 : Rr > L * 1.02 ? -1 : 0; }
        const bx = side > 0 ? -th : side < 0 ? th : 0, by = th * .8; // where the back of the glass shows
        // what is behind the card, blurred, for the frosted glass
        const blur = document.createElement('canvas'); blur.width = W / 4; blur.height = H / 4; const bxx = blur.getContext('2d'); if (!DRAFT) bxx.filter = 'blur(4px)'; bxx.drawImage(x.canvas, 0, 0, W / 4, H / 4);
        // soft halo hugging the card, tinted by the album picture
        if (gl > 0) { x.save(); x.shadowColor = glowCol; x.shadowBlur = 50 + 90 * gl; x.globalAlpha = .25 + .55 * gl; x.fillStyle = glowCol; quad(x, pr); x.fill(); x.restore(); }
        x.save(); x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 50; x.shadowOffsetY = 26; x.fillStyle = 'rgba(0,0,0,.35)'; quad(x, pr); x.fill(); x.restore();
        // back of the glass slab: frosted, with a thin light edge
        x.save(); x.translate(bx, by); quad(x, pr); x.clip(); x.drawImage(blur, -bx, -by, W, H); x.fillStyle = 'rgba(60,48,46,.45)'; x.fillRect(-bx, -by, W, H); x.restore();
        x.save(); x.translate(bx, by); quad(x, pr); x.lineWidth = 2.2; x.strokeStyle = `rgba(255,232,218,${.18 + .3 * e})`; x.stroke(); x.restore();
        // pull the blurred background into the card's flat space, draw the card over it, then stand it up in 3D
        const bd = document.createElement('canvas'); bd.width = CW * K; bd.height = CH * K;
        if (DRAFT) { const bc = bd.getContext('2d'); bc.fillStyle = 'rgb(70,50,48)'; bc.fillRect(0, 0, bd.width, bd.height); } else mesh(bd.getContext('2d'), blur, (u, v) => { const p = pr(u, v); return [p[0] / 4, p[1] / 4]; }, (u, v) => [u * bd.width, v * bd.height], .9);
        const cc = cardCanvas(t, img, i, mark, bd);
        warp(x, cc, pr);
        // bright rim on the front edge
        if (e > 0) {
            const p0 = pr(0, 0), p1 = pr(1, 1), rg = x.createLinearGradient(p0[0], p0[1], p1[0], p1[1]);
            rg.addColorStop(0, `rgba(255,246,238,${.55 + .4 * e})`); rg.addColorStop(.5, `rgba(255,236,224,${.12 + .2 * e})`); rg.addColorStop(1, `rgba(255,226,210,${.3 + .4 * e})`);
            x.save(); quad(x, pr); x.lineWidth = 1.6 + 1.8 * e; x.strokeStyle = rg; x.shadowColor = glowCol; x.shadowBlur = 10 * e; x.stroke(); x.restore();
        }
    }
    function cardPlace(i, n) {
        const s = slots(P.layout, n)[i], o = P.cards[i] || {};
        let q = null;
        if (s.q) { // move / scale / turn the measured corners around their centre
            const pts = s.q.map(([u, v]) => [u * W, v * H]), mx = pts.reduce((t, p) => t + p[0], 0) / 4, my = pts.reduce((t, p) => t + p[1], 0) / 4;
            const k = o.ds || 1, r = (o.dr || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r), ox = (o.dx || 0) * W, oy = (o.dy || 0) * H;
            q = pts.map(([x, y]) => { const dx = (x - mx) * k, dy = (y - my) * k; return [mx + ox + dx * c - dy * sn, my + oy + dx * sn + dy * c]; });
        }
        return { cx: (s.x + (o.dx || 0)) * W, cy: (s.y + (o.dy || 0)) * H, rz: s.rz + (o.dr || 0), ry: s.ry, w: s.w * W * (o.ds || 1), q };
    }

    function applyTone(x) {
        const t = P.tone; x.save();
        if (t === 'warm') { x.globalCompositeOperation = 'soft-light'; x.fillStyle = 'rgba(255,160,100,.14)'; x.fillRect(0, 0, W, H); }
        if (t === 'cool') { x.globalCompositeOperation = 'soft-light'; x.fillStyle = 'rgba(60,130,255,.6)'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'color'; x.fillStyle = 'rgba(40,90,200,.18)'; x.fillRect(0, 0, W, H); }
        if (t === 'neon') { x.globalCompositeOperation = 'overlay'; const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'rgba(255,40,200,.7)'); g.addColorStop(1, 'rgba(40,220,255,.65)'); x.fillStyle = g; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'color'; x.globalAlpha = .25; x.fillRect(0, 0, W, H); }
        if (t === 'film') { x.globalCompositeOperation = 'saturation'; x.fillStyle = 'rgba(128,128,128,.3)'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'soft-light'; x.fillStyle = 'rgba(255,215,160,.35)'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'lighten'; x.fillStyle = 'rgba(40,34,30,1)'; x.fillRect(0, 0, W, H); }
        x.restore();
        if (P.style === 'oldfilm') {
            x.save(); x.globalCompositeOperation = 'color'; x.fillStyle = 'rgba(170,130,80,.35)'; x.fillRect(0, 0, W, H); x.restore();
            const R = rnd(P.seed + 5); x.save(); x.strokeStyle = 'rgba(255,250,235,.25)'; x.lineWidth = 1.5;
            for (let i = 0; i < 7; i++) { const sx = R() * W; x.beginPath(); x.moveTo(sx, R() * H * .3); x.lineTo(sx + (R() - .5) * 20, H * (.5 + R() * .5)); x.stroke(); }
            for (let i = 0; i < 40; i++) { x.fillStyle = R() < .5 ? 'rgba(0,0,0,.4)' : 'rgba(255,255,240,.35)'; x.beginPath(); x.arc(R() * W, R() * H, 1 + R() * 3, 0, 7); x.fill(); }
            x.restore();
        }
        if (P.style !== 'clean') {
            const v = x.createRadialGradient(W / 2, H * .45, H * .3, W / 2, H * .45, H * .8); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${P.style === 'oldfilm' ? .75 : .62})`); x.fillStyle = v; x.fillRect(0, 0, W, H);
        }
        const gr = P.fx.grain + (P.style === 'oldfilm' ? .25 : 0);
        if (gr > 0) { x.save(); x.globalCompositeOperation = 'overlay'; x.globalAlpha = Math.min(1, gr * .55); x.fillStyle = x.createPattern(grain(), 'repeat'); x.fillRect(0, 0, W, H); x.restore(); }
    }
    function drawText(x) {
        const tx = P.text; if (!tx.value.trim()) return null;
        const f = FONTS.find((k) => k[0] === tx.font) || FONTS[0]; const size = Math.round(96 * tx.size);
        x.save(); x.font = f[2].replace('{s}', size); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = tx.color;
        x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 24; x.shadowOffsetY = 6;
        const lines = tx.value.split('\n').slice(0, 3), lh = size * 1.1, y0 = tx.y * H - (lines.length - 1) * lh / 2;
        let mw = 0; lines.forEach((l, i) => { const t = fitText(x, l, W - 80); mw = Math.max(mw, x.measureText(t).width); x.fillText(t, W / 2, y0 + i * lh); });
        x.restore(); return { cx: W / 2, cy: tx.y * H, w: mw + 30, h: lines.length * lh + 20, rot: 0 };
    }
    // soft cinematic glow over the whole picture
    function bloom(x) {
        if (P.style === 'clean' || DRAFT) return;
        const b = document.createElement('canvas'); b.width = W / 4; b.height = H / 4; const bx = b.getContext('2d'); bx.filter = 'blur(6px) brightness(1.05)'; bx.drawImage(x.canvas, 0, 0, W / 4, H / 4);
        x.save(); x.globalCompositeOperation = 'screen'; x.globalAlpha = .17; x.drawImage(b, 0, 0, W, H); x.restore();
    }
    function drawWatermark(x, icon) {
        const h = 62, label = 'Darcam'; x.save(); x.font = `800 44px ${FONT}`; const tw = x.measureText(label).width, w = h + 16 + tw, X = (W - w) / 2, Y = H * .955 - h / 2;
        x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 18; x.shadowOffsetY = 4;
        if (icon) { x.save(); rr(x, X, Y, h, h, 16); x.clip(); x.drawImage(icon, X, Y, h, h); x.restore(); }
        x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(label, X + h + 16, Y + h / 2 + 2);
        x.restore();
    }
    let hits = [];
    let DRAFT = false;
    // ---------- layers (like Canva): bottom first in P.order ----------
    const keyOf = (sel) => !sel ? null : sel.type === 'card' ? 'card:' + sel.i : sel.type === 'sticker' ? 'stk:' + (P.stickers[sel.i] || {}).id : sel.type;
    function selOf(k) { if (k.startsWith('card:')) return { type: 'card', i: +k.slice(5) }; if (k.startsWith('stk:')) { const i = P.stickers.findIndex((t) => 'stk:' + t.id === k); return i < 0 ? null : { type: 'sticker', i }; } return { type: k, i: 0 }; }
    function layers() {
        const want = [...P.songs.map((_, i) => 'card:' + i), ...(P.photo ? ['photo'] : []), ...P.stickers.map((t) => 'stk:' + t.id), ...(P.text.value.trim() ? ['text'] : [])];
        const keep = P.order.filter((k) => want.includes(k));
        want.forEach((k) => { if (!keep.includes(k)) { if (k.startsWith('card:')) { const at = keep.findIndex((z) => !z.startsWith('card:')); keep.splice(at < 0 ? keep.length : at, 0, k); } else keep.push(k); } });
        return (P.order = keep);
    }
    function moveLayer(k, how) {
        const o = layers(), i = o.indexOf(k); if (i < 0) return; o.splice(i, 1);
        const j = how === 'front' ? o.length : how === 'back' ? 0 : how === 'up' ? Math.min(o.length, i + 1) : Math.max(0, i - 1);
        o.splice(j, 0, k); P.dirty = true; refreshPanel(); redraw();
    }
    function layerName(k) {
        if (k.startsWith('card:')) { const t = P.songs[+k.slice(5)]; return ['Card', t ? T.title(t) : '']; }
        if (k === 'photo') return ['Photo', P.photo && P.photo.cut && P.photo.useCut ? 'Background removed' : 'Full photo'];
        if (k === 'text') return ['Text', P.text.value.trim().split('\n')[0]];
        return ['Sticker', ''];
    }
    function layerThumb(k) {
        if (k.startsWith('card:')) { const t = P.songs[+k.slice(5)]; return t ? UI.art(T.cover(t), 'pst-lthumb') : ''; }
        if (k === 'photo') return `<img class="pst-lthumb" src="${P.photo.cut && P.photo.useCut ? P.photo.cut : P.photo.src}" alt="">`;
        if (k.startsWith('stk:')) { const st = P.stickers.find((t) => 'stk:' + t.id === k); return st ? `<img class="pst-lthumb" src="${st.src}" alt="">` : ''; }
        return `<span class="pst-lthumb txt">Aa</span>`;
    }
    function photoBox(img) {
        const ph = P.photo, base = ph.fit === 'fit' ? Math.min(W / img.width, H / img.height) : Math.max(W / img.width, H / img.height), s = base * ph.scale;
        return { cx: W / 2 + ph.x * W, cy: H / 2 + ph.y * H, w: img.width * s, h: img.height * s, rot: ph.rot };
    }
    // only the visible part of a cut-out photo can be clicked
    const alphaMemo = new Map();
    function alphaAt(src, img, u, v) {
        let m = alphaMemo.get(src);
        if (!m) { try { const k = Math.min(1, 256 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k)); const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, c.width, c.height); m = { w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data }; } catch (e) { m = null; } alphaMemo.set(src, m); }
        if (!m) return true; const X = Math.floor(u * m.w), Y = Math.floor(v * m.h); if (X < 0 || Y < 0 || X >= m.w || Y >= m.h) return false;
        return m.d[(Y * m.w + X) * 4 + 3] > 40;
    }
    async function render(cv, ui, draft) {
        DRAFT = !!draft;
        const x = cv.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H);
        const covers = await Promise.all(P.songs.map((t) => loadImg(T.coverLg(t)).then((i) => i || loadImg(T.cover(t)))));
        const ph = P.photo; const photo = ph ? await loadImg(ph.cut && ph.useCut ? ph.cut : ph.src, false) : null;
        const mark = await loadImg('img/mark.svg', false), icon = await loadImg('img/icon-192.png', false);
        const stickerImgs = await Promise.all(P.stickers.map((s) => loadImg(s.src, false)));
        const R = rnd(P.seed); hits = [];
        drawBackground(x, covers);
        drawLeaks(x, R, covers);
        const n = P.songs.length, order = layers(), lastCard = order.reduce((m, k, i) => (k.startsWith('card:') ? i : m), -1);
        const photoSrc = ph ? (ph.cut && ph.useCut ? ph.cut : ph.src) : null;
        if (lastCard < 0) { drawFlare(x); drawStars(x, R); }
        order.forEach((k, idx) => {
            if (k.startsWith('card:')) {
                const i = +k.slice(5), t = P.songs[i]; if (!t) return;
                const pl = cardPlace(i, n);
                const vc = vivid(covers[i]), glowCol = rgb(mixc(mixc(vc, [255, 225, 200], .3), TONE_RGB[P.tone] || vc, .1), 1);
                drawCard3D(x, t, covers[i], i, mark, pl, glowCol);
                if (pl.q) { const xs = pl.q.map((p) => p[0]), ys = pl.q.map((p) => p[1]), q = pl.q, ang = Math.atan2(q[1][1] - q[0][1] + q[2][1] - q[3][1], q[1][0] - q[0][0] + q[2][0] - q[3][0]) * 180 / Math.PI;
                    hits.push({ type: 'card', i, cx: xs.reduce((a, b) => a + b) / 4, cy: ys.reduce((a, b) => a + b) / 4, w: (Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) + Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1])) / 2, h: (Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) + Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1])) / 2, rot: ang });
                } else hits.push({ type: 'card', i, cx: pl.cx, cy: pl.cy, w: pl.w, h: pl.w * CH / CW, rot: pl.rz });
            } else if (k === 'photo') {
                if (!photo) return; drawPhoto(x, photo); const bx = photoBox(photo);
                hits.push({ type: 'photo', i: 0, ...bx, test: ph.cut && ph.useCut ? (u, v) => alphaAt(photoSrc, photo, ph.mirror ? 1 - u : u, v) : null });
            } else if (k.startsWith('stk:')) {
                const i = P.stickers.findIndex((t) => 'stk:' + t.id === k), st = P.stickers[i], im = stickerImgs[i]; if (!st || !im) return;
                const base = 220 * st.s, ar = im.width / im.height, w = ar >= 1 ? base : base * ar, h = ar >= 1 ? base / ar : base;
                x.save(); x.translate(st.x * W, st.y * H); x.rotate(st.r * Math.PI / 180); if (st.m) x.scale(-1, 1); x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = 16; x.drawImage(im, -w / 2, -h / 2, w, h); x.restore();
                hits.push({ type: 'sticker', i, cx: st.x * W, cy: st.y * H, w, h, rot: st.r });
            } else if (k === 'text') { const th = drawText(x); if (th) hits.push({ type: 'text', i: 0, ...th }); }
            if (idx === lastCard) { drawFlare(x); drawStars(x, R); }
        });
        applyTone(x);
        bloom(x);
        drawWatermark(x, icon);
        if (ui && P.sel) {
            const h = hits.find((k) => k.type === P.sel.type && k.i === P.sel.i);
            if (h) {
                x.save(); x.translate(h.cx, h.cy); x.rotate(h.rot * Math.PI / 180); const bw = h.w / 2 + 14, bh = h.h / 2 + 14;
                x.lineWidth = 3; x.strokeStyle = 'rgba(255,255,255,.9)'; x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 8; rr(x, -bw, -bh, bw * 2, bh * 2, 22); x.stroke();
                x.fillStyle = '#fff'; [[-bw, -bh], [bw, -bh], [-bw, bh], [bw, bh]].forEach(([a, b]) => { x.beginPath(); x.arc(a, b, 9, 0, 7); x.fill(); });
                x.restore();
            }
        }
        return cv;
    }
    function hitAt(px, py) {
        for (let k = hits.length - 1; k >= 0; k--) {
            const h = hits[k], a = -h.rot * Math.PI / 180, dx = px - h.cx, dy = py - h.cy;
            const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
            if (h.test) { if (Math.abs(lx) <= h.w / 2 && Math.abs(ly) <= h.h / 2 && h.test(lx / h.w + .5, ly / h.h + .5)) return h; continue; }
            if (Math.abs(lx) <= h.w / 2 + 10 && Math.abs(ly) <= h.h / 2 + 10) return h;
        }
        return null;
    }

    // ---------- picking songs ----------
    function pick(tracks, title, preset) {
        const list = (tracks || []).map(Catalog.normalize).filter((t) => t && t.id);
        if (!list.length) { UI.toast('This playlist is empty'); return; }
        const chosen = new Set((preset || []).map((t) => t.id));
        UI.modal(`<div class="pp-head"><h3>Pick songs for your poster</h3><button class="btn ghost sm" data-first>Pick first 5</button></div>
            <div class="pp-count"><b>0</b> of ${MAX}</div>
            <div class="pp-list">${list.map((t) => `<label class="pp-row" data-id="${esc(t.id)}"><input type="checkbox" ${chosen.has(t.id) ? 'checked' : ''}><span class="pp-box">${ic('check')}</span>${UI.art(T.cover(t), 'pp-art')}<span class="pp-text"><b>${esc(T.title(t))}</b><small>${esc(T.artist(t))}</small></span></label>`).join('')}</div>
            <div class="modal-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-next>Next</button></div>`, (m, close) => {
            const order = (preset || []).map((t) => t.id).filter((id) => list.some((t) => t.id === id));
            const paint = () => {
                m.querySelector('.pp-count b').textContent = order.length;
                m.querySelector('[data-next]').disabled = !order.length;
                m.querySelectorAll('.pp-row').forEach((r) => { const on = order.includes(r.dataset.id); r.classList.toggle('on', on); r.querySelector('input').checked = on; r.classList.toggle('off', !on && order.length >= MAX); });
            };
            m.querySelectorAll('.pp-row input').forEach((inp) => inp.onchange = () => {
                const id = inp.closest('.pp-row').dataset.id, k = order.indexOf(id);
                if (k >= 0) order.splice(k, 1); else if (order.length < MAX) order.push(id); else UI.toast(`You can pick up to ${MAX} songs`);
                paint();
            });
            m.querySelector('[data-first]').onclick = () => { order.length = 0; list.slice(0, MAX).forEach((t) => order.push(t.id)); paint(); };
            m.querySelector('[data-next]').onclick = () => {
                const songs = order.map((id) => list.find((t) => t.id === id));
                close();
                if (P && preset) { P.songs = songs; P.cards = {}; P.sel = null; refreshPanel(); redraw(); }
                else open(songs, list, title);
            };
            paint();
        });
        document.querySelector('#modal .modal').classList.add('wide');
    }

    // ---------- the editor ----------
    let root = null, cvs = null, busy = false, again = false;
    let fullT = 0;
    function redraw(full) {
        if (!cvs) return; if (busy) { again = again || (full ? 'full' : 'draft'); return; }
        busy = true; clearTimeout(fullT);
        requestAnimationFrame(async () => {
            try { await render(cvs, true, !full); } catch (e) { console.error(e); }
            busy = false;
            if (again) { const f = again === 'full'; again = false; redraw(f); }
            else if (!full) fullT = setTimeout(() => redraw(true), 220);
        });
    }
    const chips = (list, cur, key) => `<div class="chips pst-chips">${list.map(([k, n]) => `<button class="chip ${k === cur ? 'on' : ''}" data-${key}="${k}">${n}</button>`).join('')}</div>`;
    const slider = (key, label, val, min, max, step, fmt) => `<label class="pst-sl"><span>${label}</span><b data-out="${key}">${fmt(val)}</b><input type="range" data-sl="${key}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
    const pct = (v) => Math.round(v * 100) + '%';

    function panelHTML() {
        const ph = P.photo, sel = P.sel;
        const s = sel && sel.type === 'sticker' ? P.stickers[sel.i] : null;
        const c = sel && sel.type === 'card' ? (P.cards[sel.i] || {}) : null;
        const my = mine();
        const t = (h, extra = '') => `<div class="pst-t"><span>${h}</span>${extra}</div>`;
        return `
        ${t('Songs', `<button class="pst-link" data-act="songs">${ic('edit')}Change</button>`)}
        <section class="pst-sec pst-tight"><div class="pst-songs">${P.songs.map((tr, i) => `<div class="pst-song ${sel && sel.type === 'card' && sel.i === i ? 'on' : ''}" data-song="${i}">${UI.art(T.cover(tr), 'pst-art')}<span class="pst-st"><b>${esc(T.title(tr))}</b><small>${esc(T.artist(tr))}</small></span>
                <button class="icon-btn sm" data-up="${i}" ${i ? '' : 'disabled'} title="Move up">${ic('chevronDown', 'flip')}</button><button class="icon-btn sm" data-down="${i}" ${i < P.songs.length - 1 ? '' : 'disabled'} title="Move down">${ic('chevronDown')}</button><button class="icon-btn sm" data-rm="${i}" ${P.songs.length > 1 ? '' : 'disabled'} title="Remove">${ic('x')}</button></div>`).join('')}</div></section>
        ${t('Card')}
        <section class="pst-sec">${c ? `<div class="pst-h"><b class="pst-cardname">${esc(T.title(P.songs[sel.i]))}</b><button class="chip" data-act="cardreset">Reset</button></div>
            ${slider('cs', 'Size', c.ds || 1, .5, 1.8, .01, pct)}${slider('cr', 'Rotate', c.dr || 0, -45, 45, 1, (v) => Math.round(v) + '°')}`
            : '<p class="muted small">Click a card on the picture, or a song in the list.</p>'}</section>
        ${t('Photo')}
        <section class="pst-sec">
            ${ph ? `<div class="chips pst-chips"><button class="chip" data-act="photo">Change photo</button><button class="chip" data-act="nophoto">Remove photo</button></div>
                <div class="pst-lbl">Background</div><div class="chips pst-chips"><button class="chip ${ph.useCut ? 'on' : ''}" data-act="bgcut">Remove background</button><button class="chip ${ph.useCut ? '' : 'on'}" data-act="bgkeep">Keep background</button></div>
                ${ph.cutting ? `<div class="pst-busy"><i class="pst-spin"></i>Cutting background…</div>` : ph.failed ? '<p class="muted small">Could not remove the background of this photo.</p>' : ''}
                ${slider('pscale', 'Size', ph.scale, .5, 3, .01, pct)}${slider('px', 'Move left–right', ph.x, -1, 1, .005, pct)}${slider('py', 'Move up–down', ph.y, -1, 1, .005, pct)}
                <div class="chips pst-chips"><button class="chip ${ph.fit === 'fill' ? 'on' : ''}" data-fit="fill">Fill screen</button><button class="chip ${ph.fit === 'fit' ? 'on' : ''}" data-fit="fit">Fit whole</button><button class="chip" data-act="prot">${ic('repeat')}Rotate</button></div>
                <div class="chips pst-chips"><button class="chip ${ph.mirror ? 'on' : ''}" data-act="pmirror">${ic('shuffle')}Mirror</button></div>`
                : `<button class="pst-drop" data-act="photo">${ic('image')}<span>Drag a photo here or click to choose</span></button>`}</section>
        ${t('Layers', '<span class="muted small">Top is in front</span>')}
        <section class="pst-sec">${(() => { const o = layers(), sk = keyOf(sel); return `${sk && o.includes(sk) ? `<div class="pst-ltools"><button class="chip" data-lmove="front" title="Bring to front">${ic('chevronDown', 'flip')}${ic('chevronDown', 'flip')}To front</button><button class="chip" data-lmove="up">${ic('chevronDown', 'flip')}Forward</button><button class="chip" data-lmove="down">${ic('chevronDown')}Backward</button><button class="chip" data-lmove="back">${ic('chevronDown')}${ic('chevronDown')}To back</button></div>` : '<p class="muted small">Tap a layer, or something on the picture, to move it in front or behind.</p>'}
            <div class="pst-layers">${o.slice().reverse().map((k, j) => { const [nm, sub] = layerName(k); return `<div class="pst-layer ${k === sk ? 'on' : ''}" data-lay="${esc(k)}">${layerThumb(k)}<span class="pst-st"><b>${nm}</b><small>${esc(sub || '')}</small></span><button class="icon-btn sm" data-lup="${esc(k)}" ${j ? '' : 'disabled'} title="Forward">${ic('chevronDown', 'flip')}</button><button class="icon-btn sm" data-ldown="${esc(k)}" ${j < o.length - 1 ? '' : 'disabled'} title="Backward">${ic('chevronDown')}</button></div>`; }).join('')}</div>`; })()}</section>
        ${t('Layout')}
        <section class="pst-sec">${chips(LAYOUTS, P.layout, 'layout')}</section>
        ${t('Effects')}
        <section class="pst-sec"><div class="pst-lbl">Style</div>${chips(STYLES, P.style, 'style')}<div class="pst-lbl">Colour</div>${chips(TONES, P.tone, 'tone')}
            ${FX.map(([k, n]) => slider('fx-' + k, n, P.fx[k], 0, 1, .01, pct)).join('')}</section>
        ${t('Stickers')}
        <section class="pst-sec"><div class="pst-h"><button class="chip pst-add" data-act="stkmenu">${ic('plus')}Add sticker</button><span class="muted small">${P.stickers.length} of ${MAX_STICKERS}</span></div>
            <div class="pst-stmenu" ${P.menu ? '' : 'hidden'}>${Object.keys(STICKERS).map((k) => `<button class="pst-stb" data-stk="${k}" title="${STICKERS[k][0]}"><img src="${stickerSrc(k)}" alt=""><small>${STICKERS[k][0]}</small></button>`).join('')}</div>
            <div class="pst-strow">${['bird', 'sparkle'].map((k) => `<button class="pst-stb" data-stk="${k}"><img src="${stickerSrc(k)}" alt=""><small>${STICKERS[k][0]}</small></button>`).join('')}
                ${my.map((src, i) => `<span class="pst-stb mine"><button data-mys="${i}"><img src="${src}" alt=""></button><i data-mydel="${i}" title="Delete">${ic('x')}</i></span>`).join('')}
                <button class="pst-stdrop" data-act="mystk">${ic('image')}<span>Drag a sticker here or click to choose</span></button></div>
            ${s ? `<div class="pst-selbox">${slider('ss', 'Size', s.s, .2, 3, .01, pct)}${slider('sr', 'Rotate', s.r, -180, 180, 1, (v) => Math.round(v) + '°')}
                <div class="chips pst-chips"><button class="chip ${s.m ? 'on' : ''}" data-act="smirror">Mirror</button><button class="chip" data-act="sdup">Duplicate</button><button class="chip danger" data-act="sdel">${ic('trash')}Delete</button></div></div>` : ''}</section>
        ${t('Text')}
        <section class="pst-sec"><textarea class="field pst-ta" data-text rows="2" maxlength="80" placeholder="Write something (optional)">${esc(P.text.value)}</textarea>
            ${chips(FONTS.map((f) => [f[0], f[1]]), P.text.font, 'font')}
            <div class="pst-colors">${['#ffffff', '#ffe7c2', '#ff4f93', '#ffd34d', '#7dd3fc', '#111111'].map((col) => `<button class="pst-col ${P.text.color === col ? 'on' : ''}" data-col="${col}" style="background:${col}"></button>`).join('')}</div>
            ${slider('ts', 'Text size', P.text.size, .4, 2, .01, pct)}${slider('ty', 'Text position', P.text.y, .04, .9, .005, pct)}</section>`;
    }
    function refreshPanel() {
        if (!root) return; const pill = root.querySelector('.pst-pill'); if (pill) pill.hidden = !(P.photo && P.photo.cutting); const pn = root.querySelector('.pst-panel'), st = pn.scrollTop; pn.innerHTML = panelHTML(); pn.scrollTop = st;
    }
    function pickFile(cb) {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) cb(f); }; inp.click();
    }
    function readImage(file, maxSide) {
        return new Promise((res) => {
            const url = URL.createObjectURL(file); const i = new Image();
            i.onload = () => { const k = Math.min(1, maxSide / Math.max(i.width, i.height)); const c = document.createElement('canvas'); c.width = Math.round(i.width * k); c.height = Math.round(i.height * k); c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL(file.type === 'image/png' || file.type === 'image/webp' ? 'image/png' : 'image/jpeg', .9)); };
            i.onerror = () => { URL.revokeObjectURL(url); res(null); }; i.src = url;
        });
    }
    async function setPhoto(file) {
        const src = await readImage(file, 2400); if (!src) { UI.toast('Could not open that picture', 'error'); return; }
        const want = LS.get('dc_poster_rmbg', true) !== false;
        P.photo = { src, cut: null, useCut: want, cutting: false, scale: 1, x: 0, y: 0, rot: 0, mirror: false, fit: 'fill' };
        P.order = P.order.filter((k) => k !== 'photo'); P.sel = { type: 'photo', i: 0 }; P.dirty = true;
        if (want) runCut(P.photo); refreshPanel(); redraw();
    }
    async function runCut(me) {
        me.cutting = true; me.failed = false; refreshPanel();
        try { const cut = await cutout(me.src); me.cut = cut; me.cutting = false; if (P && P.photo === me) { refreshPanel(); redraw(); } }
        catch (e) { console.warn('cutout failed', e); me.cutting = false; me.useCut = false; me.failed = true; if (P && P.photo === me) { refreshPanel(); redraw(); UI.toast('Could not remove the background of this photo, so the whole photo is shown.'); } }
    }
    // remove the photo's background on the device (MediaPipe selfie segmenter, bundled in vendor/)
    let segP = null;
    function segmenter() {
        if (!segP) segP = (async () => {
            const base = new URL('vendor/mediapipe/', location.href).href;
            const m = await import(base + 'vision_bundle.mjs');
            const fs = await m.FilesetResolver.forVisionTasks(base + 'wasm');
            return m.ImageSegmenter.createFromOptions(fs, { baseOptions: { modelAssetPath: base + 'selfie_segmenter.tflite', delegate: 'CPU' }, runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true });
        })().catch((e) => { segP = null; throw e; });
        return segP;
    }
    async function cutout(src) {
        const img = await loadImg(src, false); if (!img) throw new Error('no image');
        const seg = await segmenter();
        const k = Math.min(1, 1024 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const res = seg.segment(c), mask = res.confidenceMasks[res.confidenceMasks.length - 1], mw = mask.width, mh = mask.height, f = mask.getAsFloat32Array();
        const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh; const mx = mc.getContext('2d'), id = mx.createImageData(mw, mh);
        for (let i = 0; i < f.length; i++) { const a = Math.max(0, Math.min(1, (f[i] - .25) / .5)); id.data[i * 4 + 3] = a * 255; }
        mx.putImageData(id, 0, 0); res.confidenceMasks.forEach((m) => m.close && m.close());
        const out = document.createElement('canvas'); out.width = img.width; out.height = img.height; const ox = out.getContext('2d');
        ox.drawImage(img, 0, 0); ox.globalCompositeOperation = 'destination-in'; ox.filter = `blur(${Math.max(1, img.width / 700)}px)`; ox.drawImage(mc, 0, 0, img.width, img.height);
        return out.toDataURL('image/png');
    }
    function addSticker(src) {
        if (P.stickers.length >= MAX_STICKERS) { UI.toast(`Up to ${MAX_STICKERS} stickers`); return; }
        const R = Math.random; P.stickers.push({ id: P.stkSeq++, src, x: .25 + R() * .5, y: .2 + R() * .55, s: 1, r: Math.round((R() - .5) * 30), m: false });
        P.sel = { type: 'sticker', i: P.stickers.length - 1 }; refreshPanel(); redraw();
    }

    function open(songs, source, title) {
        P = fresh(songs, source, title);
        root = document.createElement('div'); root.className = 'pst';
        root.innerHTML = `<header class="pst-top"><button class="icon-btn" data-act="close" title="Back">${ic('chevronLeft')}</button><h2>Song poster</h2>
            <div class="pst-btns"><button class="btn primary" data-act="save">${ic('download')}<span>Save</span></button><button class="btn ghost" data-act="copy">${ic('image')}<span>Copy picture</span></button><button class="btn ghost" data-act="close">Done</button></div></header>
            <div class="pst-body"><div class="pst-stage"><div class="pst-cv"><canvas width="${W}" height="${H}"></canvas><div class="pst-pill" hidden><i class="pst-spin"></i>Cutting background…</div></div></div><aside class="pst-panel"></aside></div>`;
        document.body.appendChild(root); document.body.classList.add('pst-open');
        cvs = root.querySelector('canvas'); refreshPanel(); redraw();
        requestAnimationFrame(() => root.classList.add('show'));
        bindEditor();
        Bus.emit('poster', true);
    }
    function close(force) {
        if (!root) return;
        if (!force && P && P.dirty) {
            UI.modal(`<h3>Leave the poster?</h3><p class="muted">Your changes are not saved yet.</p><div class="modal-actions"><button class="btn ghost" data-leave>Leave</button><button class="btn primary" data-close>Stay here</button></div>`, (m, c) => { m.querySelector('[data-leave]').onclick = () => { c(); close(true); }; });
            return;
        } const r = root; r.classList.remove('show'); setTimeout(() => r.remove(), 250);
        root = null; cvs = null; P = null; document.body.classList.remove('pst-open'); document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
        if (!P) return;
        if (e.key === 'Escape') { if (P.sel) { P.sel = null; refreshPanel(); redraw(); } else close(); }
        if ((e.key === 'Delete' || e.key === 'Backspace') && P.sel && P.sel.type === 'photo' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { P.photo = null; P.sel = null; refreshPanel(); redraw(); return; }
        if ((e.key === 'Delete' || e.key === 'Backspace') && P.sel && P.sel.type === 'sticker' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { P.stickers.splice(P.sel.i, 1); P.sel = null; refreshPanel(); redraw(); }
    }
    async function exportPNG() { const c = document.createElement('canvas'); c.width = W; c.height = H; await render(c, false); return c; }
    async function save() {
        UI.toast('Making your poster…');
        try {
            const c = await exportPNG(); const name = ('darcam-poster-' + (P.title || 'songs')).replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').slice(0, 60) + '.png';
            const data = c.toDataURL('image/png');
            const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.DarcamIsland;
            if (cap && cap.shareImage) { try { await cap.shareImage({ data: data.split(',')[1], name }); P.dirty = false; return; } catch (e) {} }
            const isPhone = /Android|iPhone|iPad/i.test(navigator.userAgent);
            if (isPhone) { try { const blob = await (await fetch(data)).blob(); const file = new File([blob], name, { type: 'image/png' }); if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e && e.name === 'AbortError') return; } }
            const a = document.createElement('a'); a.href = data; a.download = name; document.body.appendChild(a); a.click(); a.remove();
            P.dirty = false; UI.toast('Poster saved', 'success');
        } catch (e) { console.error(e); UI.toast('Could not save the poster. Some song pictures may be blocked.', 'error'); }
    }
    async function copy() {
        try {
            const c = await exportPNG(); const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); UI.toast('Picture copied', 'success');
        } catch (e) { UI.toast('Copying pictures is not supported here. Use Save instead.'); }
    }

    function bindEditor() {
        document.addEventListener('keydown', onKey);
        root.addEventListener('pointerup', (e) => { if (P && !e.target.closest('.pst-top')) P.dirty = true; }, true);
        root.addEventListener('click', (e) => {
            const b = e.target.closest('button, [data-song], [data-lay]'); if (!b || !root.contains(b)) return;
            const d = b.dataset;
            if (d.act === 'close') return close();
            if (d.act === 'save') return save();
            if (d.act === 'copy') return copy();
            if (d.act === 'close' && false) return;
            if (d.act === 'songs') return pick(P.source, P.title, P.songs);
            if (d.act === 'photo') return pickFile(setPhoto);
            if (d.act === 'nophoto') { P.photo = null; if (P.sel && P.sel.type === 'photo') P.sel = null; refreshPanel(); return redraw(); }
            if (d.act === 'bgcut' || d.act === 'bgkeep') { P.photo.useCut = d.act === 'bgcut'; LS.set('dc_poster_rmbg', P.photo.useCut); if (P.photo.useCut && !P.photo.cut && !P.photo.cutting) runCut(P.photo); refreshPanel(); return redraw(); }
            if (d.lay) { const sl = selOf(d.lay); if (sl) P.sel = sl; refreshPanel(); return redraw(); }
            if (d.lup) return moveLayer(d.lup, 'up');
            if (d.ldown) return moveLayer(d.ldown, 'down');
            if (d.lmove) return moveLayer(keyOf(P.sel), d.lmove);
            if (d.act === 'prot') { P.photo.rot = (P.photo.rot + 90) % 360; return redraw(); }
            if (d.act === 'pmirror') { P.photo.mirror = !P.photo.mirror; refreshPanel(); return redraw(); }
            if (d.fit) { P.photo.fit = d.fit; refreshPanel(); return redraw(); }
            if (d.layout) { P.layout = d.layout; P.cards = {}; refreshPanel(); return redraw(); }
            if (d.style) { P.style = d.style; refreshPanel(); return redraw(); }
            if (d.tone) { P.tone = d.tone; refreshPanel(); return redraw(); }
            if (d.font) { P.text.font = d.font; refreshPanel(); return redraw(); }
            if (d.col) { P.text.color = d.col; refreshPanel(); return redraw(); }
            if (d.act === 'shuffle') { P.seed = (Math.random() * 1e9) | 0; return redraw(); }
            if (d.act === 'stkmenu') { P.menu = !P.menu; return refreshPanel(); }
            if (d.stk) { P.menu = false; return addSticker(stickerSrc(d.stk)); }
            if (d.mys !== undefined) return addSticker(mine()[+d.mys]);
            if (d.act === 'mystk') return pickFile(async (f) => { const src = await readImage(f, 512); if (!src) return UI.toast('Could not open that picture', 'error'); const l = mine(); l.unshift(src); try { LS.set(MY_KEY, l.slice(0, 24)); } catch (er) { UI.toast('Not enough space to keep this sticker'); } addSticker(src); });
            if (d.act === 'smirror') { const s = P.stickers[P.sel.i]; s.m = !s.m; refreshPanel(); return redraw(); }
            if (d.act === 'sdup') { const s = P.stickers[P.sel.i]; if (P.stickers.length >= MAX_STICKERS) return UI.toast(`Up to ${MAX_STICKERS} stickers`); P.stickers.push({ ...s, id: P.stkSeq++, x: Math.min(.95, s.x + .05), y: Math.min(.95, s.y + .04) }); P.sel = { type: 'sticker', i: P.stickers.length - 1 }; refreshPanel(); return redraw(); }
            if (d.act === 'sdel') { P.stickers.splice(P.sel.i, 1); P.sel = null; refreshPanel(); return redraw(); }
            if (d.act === 'cardreset') { delete P.cards[P.sel.i]; refreshPanel(); return redraw(); }
            const mv = (from, to) => { const [t] = P.songs.splice(from, 1); P.songs.splice(to, 0, t); const a = P.cards[from], c2 = P.cards[to]; P.cards[to] = a; P.cards[from] = c2; P.sel = null; refreshPanel(); redraw(); };
            if (d.up !== undefined) return mv(+d.up, +d.up - 1);
            if (d.down !== undefined) return mv(+d.down, +d.down + 1);
            if (d.rm !== undefined) { P.songs.splice(+d.rm, 1); P.cards = {}; P.sel = null; refreshPanel(); return redraw(); }
            if (d.song !== undefined && !e.target.closest('button')) { const i = +d.song; P.sel = P.sel && P.sel.type === 'card' && P.sel.i === i ? null : { type: 'card', i }; refreshPanel(); return redraw(); }
        });
        root.addEventListener('click', (e) => {
            const x = e.target.closest('[data-mydel]'); if (!x) return; e.stopPropagation();
            const l = mine(); l.splice(+x.dataset.mydel, 1); LS.set(MY_KEY, l); refreshPanel();
        });
        root.addEventListener('input', (e) => {
            const el = e.target;
            if (el.matches('[data-text]')) { P.text.value = el.value; if (!!el.value.trim() !== !!el.dataset.had) { el.dataset.had = el.value.trim() ? '1' : ''; clearTimeout(el._t); el._t = setTimeout(() => { const ae = document.activeElement === el, pos = el.selectionStart; refreshPanel(); if (ae) { const n = root.querySelector('[data-text]'); n.focus(); n.setSelectionRange(pos, pos); } }, 400); } return redraw(); }
            const k = el.dataset.sl; if (!k) return; const v = +el.value;
            const out = root.querySelector(`[data-out="${k}"]`);
            if (k.startsWith('fx-')) P.fx[k.slice(3)] = v;
            else if (k === 'pscale') P.photo.scale = v; else if (k === 'px') P.photo.x = v; else if (k === 'py') P.photo.y = v;
            else if (k === 'ss') P.stickers[P.sel.i].s = v; else if (k === 'sr') P.stickers[P.sel.i].r = v;
            else if (k === 'cs') (P.cards[P.sel.i] = P.cards[P.sel.i] || {}).ds = v; else if (k === 'cr') (P.cards[P.sel.i] = P.cards[P.sel.i] || {}).dr = v;
            else if (k === 'ts') P.text.size = v; else if (k === 'ty') P.text.y = v;
            if (out) out.textContent = /^(sr|cr)$/.test(k) ? Math.round(v) + '°' : pct(v);
            redraw();
        });
        // drop a photo or sticker file anywhere on the editor
        root.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add('drag'); });
        root.addEventListener('dragleave', (e) => { if (e.target === root) root.classList.remove('drag'); });
        root.addEventListener('drop', async (e) => { e.preventDefault(); root.classList.remove('drag'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f || !/^image\//.test(f.type)) return; if (e.target.closest('.pst-stdrop')) { const src = await readImage(f, 512); if (!src) return; const l = mine(); l.unshift(src); LS.set(MY_KEY, l.slice(0, 24)); addSticker(src); } else setPhoto(f); });
        // drag things on the poster
        let drag = null;
        const pt = (e) => { const r = cvs.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; };
        cvs.addEventListener('pointerdown', (e) => {
            const [px, py] = pt(e); const h = hitAt(px, py);
            cvs.setPointerCapture(e.pointerId);
            if (h) {
                const changed = !P.sel || P.sel.type !== h.type || P.sel.i !== h.i; P.sel = { type: h.type, i: h.i };
                const o = h.type === 'card' ? (P.cards[h.i] = P.cards[h.i] || {}) : h.type === 'sticker' ? P.stickers[h.i] : h.type === 'photo' ? P.photo : P.text;
                drag = { h, px, py, o, ox: h.type === 'card' ? o.dx || 0 : o.x, oy: h.type === 'card' ? o.dy || 0 : o.y };
                if (changed) refreshPanel(); redraw();
            } else {
                if (P.sel) { P.sel = null; refreshPanel(); redraw(); }
            }
        });
        cvs.addEventListener('pointermove', (e) => {
            if (!drag) { const [px, py] = pt(e); cvs.style.cursor = hitAt(px, py) ? 'move' : 'default'; return; }
            const [px, py] = pt(e), dx = (px - drag.px) / W, dy = (py - drag.py) / H;
            if (drag.photo) { P.photo.x = clamp(drag.ox + dx, -1, 1); P.photo.y = clamp(drag.oy + dy, -1, 1); }
            else if (drag.h.type === 'photo') { P.photo.x = clamp(drag.ox + dx, -1, 1); P.photo.y = clamp(drag.oy + dy, -1, 1); }
            else if (drag.h.type === 'card') { drag.o.dx = drag.ox + dx; drag.o.dy = drag.oy + dy; }
            else if (drag.h.type === 'sticker') { drag.o.x = clamp(drag.ox + dx, 0, 1); drag.o.y = clamp(drag.oy + dy, 0, 1); }
            else if (drag.h.type === 'text') { P.text.y = clamp(drag.oy + dy, .04, .9); }
            redraw();
        });
        const end = () => { if (drag && drag.h && (drag.h.type === 'text' || drag.h.type === 'photo')) refreshPanel(); drag = null; };
        cvs.addEventListener('pointerup', end); cvs.addEventListener('pointercancel', end);
        cvs.addEventListener('wheel', (e) => {
            if (!P.sel || P.sel.type === 'text') return; e.preventDefault(); const f = e.deltaY < 0 ? 1.05 : 1 / 1.05;
            if (P.sel.type === 'sticker') { const s = P.stickers[P.sel.i]; s.s = clamp(s.s * f, .2, 3); } else if (P.sel.type === 'photo') { P.photo.scale = clamp(P.photo.scale * f, .5, 3); } else { const c = (P.cards[P.sel.i] = P.cards[P.sel.i] || {}); c.ds = clamp((c.ds || 1) * f, .5, 1.8); }
            redraw(); clearTimeout(cvs._wt); cvs._wt = setTimeout(refreshPanel, 250);
        }, { passive: false });
    }

    return { pick, open, close, render };
})();
