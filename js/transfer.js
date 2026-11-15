/* Darcam — move your library to another device with QR codes (no account, no server).
   The sending screen shows a short loop of QR codes; the other device scans them with its camera. */
'use strict';

const Transfer = (() => {
    const CHUNK = 850;          // characters per QR code (keeps each code easy to scan)
    const b64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
    async function pipe(bytes, stream) { const r = new Response(new Blob([bytes]).stream().pipeThrough(stream)); return new Uint8Array(await r.arrayBuffer()); }
    const zip = (s) => pipe(new TextEncoder().encode(s), new CompressionStream('deflate-raw'));
    const unzip = async (u) => new TextDecoder().decode(await pipe(u, new DecompressionStream('deflate-raw')));

    // a song as [video id, title, artist, seconds] (imported songs not played yet have no video id)
    const pack = (t) => [t.pending ? '' : (t.youtube_id || t.id), t.name || '', T.artist(t) || '', Math.round((t.duration_ms || 0) / 1000)];
    function unpack(a) {
        const [y, name, artist, sec] = a;
        if (!y) return { id: 'imp_' + Math.abs([...(name + '|' + artist)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)).toString(36), pending: true, name, artists: [{ name: artist || 'Unknown', id: '' }], album: { name: artist, images: [{ url: '' }] }, cover: '', cover_lg: '', duration_ms: sec * 1000, kind: 'song', _n: 1 };
        return { id: y, youtube_id: y, name, artists: [{ name: artist || 'Unknown', id: '' }], album: { name: artist, images: [{ url: `https://i.ytimg.com/vi/${y}/mqdefault.jpg` }] }, cover: `https://i.ytimg.com/vi/${y}/mqdefault.jpg`, cover_lg: `https://i.ytimg.com/vi/${y}/hqdefault.jpg`, duration_ms: sec * 1000, kind: 'song', _n: 1 };
    }

    async function frames() {
        const data = { v: 1, l: Store.liked().map(pack), p: Store.playlists().map((p) => ({ n: p.name, d: p.description || '', t: p.tracks.map(pack) })) };
        const text = b64u(await zip(JSON.stringify(data)));
        const id = Math.random().toString(36).slice(2, 6);
        const n = Math.max(1, Math.ceil(text.length / CHUNK));
        const out = [];
        for (let i = 0; i < n; i++) out.push(`DC1:${id}:${i + 1}/${n}:` + text.slice(i * CHUNK, (i + 1) * CHUNK));
        return { out, songs: data.l.length + data.p.reduce((a, p) => a + p.t.length, 0), lists: data.p.length, liked: data.l.length };
    }
    function qrSvg(text) {
        const q = qrcode(0, 'L'); q.addData(text, 'Byte'); q.make();
        return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
    }

    // ---------- send ----------
    async function send(box) {
        if (!Store.liked().length && !Store.playlists().length) { box.innerHTML = '<div class="empty">Your library is empty: like some songs or make a playlist first.</div>'; return () => {}; }
        let f;
        try { f = await frames(); } catch (e) { box.innerHTML = `<div class="empty err">This device can't make the code (${esc(e.message)}). Use Settings → Backup library instead.</div>`; return () => {}; }
        box.innerHTML = `<div class="tr-qr"></div>
            <p class="tr-info"><b>${f.lists} playlist${f.lists === 1 ? '' : 's'} · ${f.liked} liked song${f.liked === 1 ? '' : 's'}</b><br>On the other device open <b>Library → Move to another device → Receive</b> and point the camera here.${f.out.length > 1 ? ` Keep it pointed until all ${f.out.length} codes are read.` : ''}</p>
            ${f.out.length > 1 ? '<div class="tr-step"></div>' : ''}`;
        const q = box.querySelector('.tr-qr'), step = box.querySelector('.tr-step');
        let i = 0;
        const show = () => { q.innerHTML = qrSvg(f.out[i]); if (step) step.textContent = `${i + 1} / ${f.out.length}`; i = (i + 1) % f.out.length; };
        show();
        const t = f.out.length > 1 ? setInterval(show, 420) : null;
        return () => clearInterval(t);
    }

    // ---------- receive ----------
    async function receive(box) {
        box.innerHTML = `<div class="tr-cam"><video playsinline muted></video><div class="tr-aim"></div></div><p class="tr-info" id="trStatus">Point the camera at the QR code on the other device</p>`;
        const video = box.querySelector('video'), status = box.querySelector('#trStatus');
        let stream = null, stop = false, raf = 0;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
        } catch (e) {
            box.innerHTML = `<div class="empty err">${ic('camera')}<p>The camera couldn't be opened.</p><small>Allow camera access for Darcam, or use Settings → Backup library / Restore backup instead.</small></div>`;
            return () => {};
        }
        video.srcObject = stream; try { await video.play(); } catch (e) {}
        const detector = ('BarcodeDetector' in window) ? (() => { try { return new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { return null; } })() : null;
        const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
        const got = {}; let session = null, total = 0, busy = false;
        const cleanup = () => { stop = true; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); };
        async function read() {
            if (stop) return;
            raf = requestAnimationFrame(read);
            if (busy || video.readyState < 2) return;
            busy = true;
            try {
                let text = null;
                if (detector) { const r = await detector.detect(video); if (r && r[0]) text = r[0].rawValue; }
                else {
                    const w = 640, h = Math.round((video.videoHeight / video.videoWidth) * w) || 480;
                    cv.width = w; cv.height = h; cx.drawImage(video, 0, 0, w, h);
                    const r = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
                    if (r) text = r.data;
                }
                const m = text && text.match(/^DC1:(\w+):(\d+)\/(\d+):(.*)$/s);
                if (m) {
                    if (session !== m[1]) { session = m[1]; total = +m[3]; Object.keys(got).forEach((k) => delete got[k]); }
                    got[m[2]] = m[4];
                    const have = Object.keys(got).length;
                    status.textContent = total > 1 ? `Reading… ${have} / ${total}` : 'Got it';
                    if (have >= total) { cleanup(); await finish(Array.from({ length: total }, (_, i) => got[i + 1]).join(''), box); }
                }
            } catch (e) { /* keep scanning */ }
            busy = false;
        }
        read();
        return cleanup;
    }

    async function finish(text, box) {
        let data;
        try { data = JSON.parse(await unzip(unb64u(text))); } catch (e) { box.innerHTML = '<div class="empty err">That code couldn\'t be read. Try again.</div>'; return; }
        const liked = (data.l || []).map(unpack), lists = (data.p || []).map((p) => ({ name: p.n, description: p.d, tracks: p.t.map(unpack) }));
        box.innerHTML = `<div class="tr-done">${ic('check')}<p><b>Found ${lists.length} playlist${lists.length === 1 ? '' : 's'} and ${liked.length} liked song${liked.length === 1 ? '' : 's'}</b></p>
            <small>They'll be added to this device. Nothing here is deleted.</small>
            <button class="btn primary" data-tr="add">${ic('download')}<span>Add to my library</span></button></div>`;
        box.querySelector('[data-tr="add"]').onclick = () => {
            let nl = 0;
            liked.slice().reverse().forEach((t) => { if (!Store.isLiked(t.id)) { Store.toggleLike(t); nl++; } });
            const names = new Set(Store.playlists().map((p) => p.name));
            lists.forEach((p) => Store.importPlaylist({ name: names.has(p.name) ? p.name + ' (moved)' : p.name, description: p.description, tracks: p.tracks }));
            box.innerHTML = `<div class="tr-done">${ic('check')}<p><b>Done</b></p><small>Added ${lists.length} playlist${lists.length === 1 ? '' : 's'} and ${nl} liked song${nl === 1 ? '' : 's'}.</small></div>`;
            UI.toast('Library added', 'success');
        };
    }

    function open() {
        let stopper = () => {};
        const close = UI.modal(`<h3>Move to another device</h3>
            <div class="imp-tabs"><button class="on" data-tm="send">Send from here</button><button data-tm="recv">Receive here</button></div>
            <div class="tr-box"></div>
            <div class="modal-actions"><button class="btn ghost" data-close>Close</button></div>`, (m) => {
            const box = m.querySelector('.tr-box');
            const go = async (mode) => {
                stopper(); stopper = () => {};
                m.querySelectorAll('[data-tm]').forEach((b) => b.classList.toggle('on', b.dataset.tm === mode));
                stopper = await (mode === 'send' ? send(box) : receive(box));
            };
            m.querySelectorAll('[data-tm]').forEach((b) => b.onclick = () => go(b.dataset.tm));
            go('send');
            // stop the camera / animation when the window closes
            const w = document.getElementById('modal');
            const obs = new MutationObserver(() => { if (!w.classList.contains('show')) { stopper(); obs.disconnect(); } });
            obs.observe(w, { attributes: true, attributeFilter: ['class'] });
        });
        return close;
    }

    return { open, _frames: frames, _finish: finish };
})();
