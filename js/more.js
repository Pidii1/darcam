/* Darcam — 2.5 features: follow artists, new-song notifications, updates, video behind lyrics,
   car mode, Bahasa Melayu, story pictures, and playlist clean-up (duplicates, merge, smart playlists). */
'use strict';

const APP_VERSION = '2.5.6';
const isCap = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const capPlugin = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.DarcamIsland) || null;
async function getText(url) {
    // normal fetch first (the website allows it); the Windows app's own fetch only as a fallback
    try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.text();
    } catch (e) {
        if (window.darcamNative && window.darcamNative.fetchText) return window.darcamNative.fetchText(url);
        throw e;
    }
}
function openOutside(url) {
    const p = capPlugin();
    if (p && p.openUrl) { p.openUrl({ url }).catch(() => window.open(url, '_blank')); return; }
    window.open(url, '_blank');
}

// =====================================================================
// Follow artists: a list on this device, with "new song" dots
// =====================================================================
const Follow = (() => {
    const KEY = 'dc_follow';
    let list = LS.get(KEY, []);
    const save = () => { LS.set(KEY, list); Bus.emit('follow'); };
    const norm = (s) => (s || '').toLowerCase().trim();
    const find = (name) => list.find((a) => norm(a.name) === norm(name));
    function toggle(a) {
        const f = find(a.name);
        if (f) list = list.filter((x) => x !== f);
        else list.unshift({ name: a.name, id: a.id || '', image: a.image || '', at: Date.now(), seen: Date.now() });
        save();
        Object.keys(localStorage).filter((k) => k.startsWith('dc_radar_')).forEach((k) => localStorage.removeItem(k));
        return !f;
    }
    // newest release per artist, checked at most every 12 hours
    const NK = 'dc_follow_new';
    let fresh = LS.get(NK, {});
    let checking = null;
    async function check(force) {
        if (checking) return checking;
        checking = (async () => {
            let found = 0;
            for (const a of list) {
                const c = fresh[norm(a.name)];
                if (!force && c && Date.now() - c.checked < 12 * 3600e3) continue;
                try {
                    const songs = await Catalog.newFrom(a.name);
                    const t = songs[0];
                    fresh[norm(a.name)] = { checked: Date.now(), t: t ? { id: t.id, name: t.name, cover: T.cover(t), at: Date.now() - (t.ago || 0) * 1000 } : null };
                    found++;
                } catch (e) { /* try again next time */ }
            }
            if (found) { LS.set(NK, fresh); Bus.emit('follow'); }
        })().finally(() => { checking = null; });
        return checking;
    }
    const latest = (name) => (fresh[norm(name)] || {}).t || null;
    function isNew(a) { const t = latest(a.name); return !!(t && t.at > (a.seen || 0) && Date.now() - t.at < 30 * 86400e3); }
    function markSeen(name) { const f = find(name); if (f) { f.seen = Date.now(); save(); } }
    return { list: () => list, is: (name) => !!find(name), toggle, check, latest, isNew, markSeen };
})();

// =====================================================================
// New songs notification (Android): once a week, when there's something new
// =====================================================================
const ReleaseNotify = (() => {
    const on = () => LS.get('dc_notify_new', true);
    async function run() {
        if (!isCap() || !on() || !Follow.list().length) return;
        await Follow.check();
        const wk = (() => { const d = new Date(); return d.getFullYear() + '-' + Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 604800e3); })();
        if (LS.get('dc_notify_week', '') === wk) return;
        if (new Date().getDay() < 5 && new Date().getDay() !== 0) return;   // Friday, Saturday or Sunday
        const sent = LS.get('dc_notify_sent', {});
        const news = Follow.list().filter((a) => { const t = Follow.latest(a.name); return t && Date.now() - t.at < 8 * 86400e3 && sent[t.id] == null; });
        if (!news.length) return;
        const names = news.map((a) => a.name);
        const p = capPlugin(); if (!p || !p.notify) return;
        try {
            await p.notify({
                title: news.length === 1 ? 'New song from ' + names[0] : news.length + ' new songs from artists you follow',
                body: (news.length === 1 ? '“' + Follow.latest(names[0]).name + '”. ' : names.slice(0, 3).join(', ') + (names.length > 3 ? ' and more' : '') + '. ') + 'Your Release Radar is ready.',
                link: 'darcam://mix/radar',
            });
            news.forEach((a) => (sent[Follow.latest(a.name).id] = Date.now()));
            LS.set('dc_notify_sent', sent); LS.set('dc_notify_week', wk);
            Object.keys(localStorage).filter((k) => k.startsWith('dc_radar_')).forEach((k) => localStorage.removeItem(k));
        } catch (e) { console.warn('notify', e); }
    }
    function start() { setTimeout(run, 20000); setInterval(run, 6 * 3600e3); }
    return { start, run, on, set: (v) => LS.set('dc_notify_new', !!v) };
})();

// =====================================================================
// Updates: version.json on your Darcam website says what's newest
// =====================================================================
const Updater = (() => {
    const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; };
    const platform = () => (window.darcamNative && window.darcamNative.toggleMini ? 'windows' : isCap() ? 'android' : 'web');
    async function fetchInfo() {
        const u = Site.api('version.json');
        if (!u) return null;
        const j = JSON.parse(await getText(u + '?t=' + Date.now()));
        return j && j.version ? j : null;
    }
    async function check(manual) {
        let info = null;
        try { info = await fetchInfo(); } catch (e) { if (manual) UI.toast('Couldn’t check for updates. Is your Darcam website set in Settings?', 'error'); return null; }
        if (!info) { if (manual) UI.toast('Set your Darcam website first (Settings → Sharing & Jam)'); return null; }
        if (!newer(info.version, APP_VERSION)) { if (manual) UI.toast('You have the newest version (' + APP_VERSION + ')', 'success'); return null; }
        if (!manual && LS.get('dc_update_skip', '') === info.version) return info;
        show(info);
        return info;
    }
    function show(info) {
        const plat = platform();
        const url = plat === 'android' ? info.android : plat === 'windows' ? info.windows : null;
        const base = Site.base();
        const full = url && !/^https?:/i.test(url) && base ? base + url.replace(/^\//, '') : url;
        const notes = (info.notes || []).slice(0, 6);
        UI.modal(`<div class="upd">
            <div class="upd-head"><span class="upd-logo">${typeof LOGO_SVG !== 'undefined' ? LOGO_SVG : ''}</span><div><h3>Darcam ${esc(info.version)} is here</h3><small class="muted">You have ${APP_VERSION}${info.size && plat !== 'web' ? ' · ' + esc(info.size) : ''}</small></div></div>
            ${notes.length ? `<ul class="upd-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
            <div class="modal-actions col">
                <button class="btn primary" data-upd="go">${plat === 'web' ? 'Reload now' : 'Download and install'}</button>
                <button class="btn ghost" data-upd="later">Later</button>
            </div>
            ${plat === 'android' ? '<p class="muted small">Android will ask you to allow installing from your browser the first time. Your library stays.</p>' : ''}
        </div>`, (m, close) => {
            m.querySelector('[data-upd="go"]').onclick = async () => {
                close();
                if (plat === 'web') {
                    try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map((r) => r.update())); } catch (e) {}
                    location.reload();
                } else if (full) openOutside(full);
                else UI.toast('No download link for this device in version.json', 'error');
            };
            m.querySelector('[data-upd="later"]').onclick = () => { LS.set('dc_update_skip', info.version); close(); };
        });
    }
    function start() { setTimeout(() => check(false), 8000); }
    return { start, check, newer };
})();

// =====================================================================
// Video behind the lyrics (uses the player that's already playing)
// =====================================================================
const VideoBg = (() => {
    const mode = () => Store.settings.videoBg || 'wifi';     // off | on | wifi
    function on() {
        const m = mode();
        if (m === 'off') return false;
        if (m === 'wifi') {
            const c = navigator.connection;
            if (c && c.type && c.type !== 'wifi' && c.type !== 'ethernet' && c.type !== 'unknown') return false;
            if (c && c.saveData) return false;
        }
        const t = Player.current();
        return !!(t && !t.pending);
    }
    return { on, mode };
})();

// =====================================================================
// Car mode: big buttons for when the phone is in a holder
// =====================================================================
const CarMode = (() => {
    let el = null, timer = null, lock = null;
    async function keepAwake() { try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch (e) {} }
    function paint() {
        if (!el) return;
        const t = Player.current(), P = Player.state;
        el.querySelector('.car-title').textContent = t ? T.title(t) : 'Nothing playing';
        el.querySelector('.car-artist').textContent = t ? T.artist(t) : 'Pick a song first';
        const d = P.duration || 0, x = Player.time();
        el.querySelector('.car-fill').style.width = (d ? Math.min(100, (x / d) * 100) : 0) + '%';
        el.querySelector('.car-cur').textContent = fmtTime(x);
        el.querySelector('.car-dur').textContent = fmtTime(d);
        const tg = el.querySelector('[data-car="toggle"]'), k = P.playing ? 'pause' : 'play';
        if (tg.dataset.icon !== k) { tg.dataset.icon = k; tg.innerHTML = ic(k); tg.setAttribute('aria-label', P.playing ? 'Pause' : 'Play'); }
        const lk = el.querySelector('[data-car="like"]'), liked = !!(t && Store.isLiked(t.id));
        if (lk.dataset.on !== String(liked)) { lk.dataset.on = String(liked); lk.innerHTML = ic(liked ? 'heartFill' : 'heart') + `<span>${liked ? 'Liked' : 'Like'}</span>`; lk.classList.toggle('on', liked); }
        const art = el.querySelector('.car-bg');
        const cv = t ? T.coverLg(t) : '';
        if (art.dataset.src !== cv) { art.dataset.src = cv; art.style.backgroundImage = cv ? `url("${cv}")` : ''; }
    }
    function open() {
        if (el) return;
        el = document.createElement('div');
        el.className = 'car'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Car mode');
        el.innerHTML = `<div class="car-bg"></div><div class="car-shade"></div>
            <header class="car-head"><span class="car-tag">CAR MODE</span><button class="car-exit" data-car="exit">Exit</button></header>
            <div class="car-meta"><div class="car-title"></div><div class="car-artist"></div>
                <div class="car-bar"><div class="car-fill"></div></div><div class="car-times"><span class="car-cur">0:00</span><span class="car-dur">0:00</span></div></div>
            <div class="car-grid">
                <button class="car-btn" data-car="prev" aria-label="Previous">${ic('prev')}</button>
                <button class="car-btn" data-car="next" aria-label="Next">${ic('next')}</button>
                <button class="car-btn main" data-car="toggle" aria-label="Play">${ic('play')}</button>
                <button class="car-btn txt" data-car="like">${ic('heart')}<span>Like</span></button>
                <button class="car-btn txt" data-car="radio">${ic('radio')}<span>Radio</span></button>
            </div>`;
        document.body.appendChild(el);
        hydrateIcons && hydrateIcons(el);
        el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-car]'); if (!b) return;
            const a = b.dataset.car, t = Player.current();
            if (navigator.vibrate) navigator.vibrate(12);
            if (a === 'exit') close();
            if (a === 'prev') Player.prev();
            if (a === 'next') Player.next();
            if (a === 'toggle') Player.toggle();
            if (a === 'like' && t) Store.toggleLike(t);
            if (a === 'radio' && t) UI.startRadio(t);
            setTimeout(paint, 60);
        });
        // swipe left / right on the song name = next / previous
        let sx = null;
        el.querySelector('.car-meta').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
        el.querySelector('.car-meta').addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 70) dx < 0 ? Player.next() : Player.prev(); sx = null; });
        paint(); timer = setInterval(paint, 400);
        keepAwake();
        document.addEventListener('visibilitychange', onVis);
        if (!history.state || !history.state.car) history.pushState({ car: 1 }, '');
        window.addEventListener('popstate', onPop);
        requestAnimationFrame(() => el && el.classList.add('show'));
    }
    const onVis = () => { if (!document.hidden && el) keepAwake(); };
    const onPop = () => { if (el && !(history.state && history.state.car)) close(true); };
    function close(fromPop) {
        if (!el) return;
        clearInterval(timer); timer = null;
        try { lock && lock.release(); } catch (e) {}
        lock = null;
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('popstate', onPop);
        const x = el; el = null; x.classList.remove('show'); setTimeout(() => x.remove(), 250);
        if (!fromPop && history.state && history.state.car) history.back();
    }
    return { open, close, get isOpen() { return !!el; } };
})();

// =====================================================================
// Bahasa Melayu: translates the app's own words on screen (song names stay as they are)
// =====================================================================
const I18n = (() => {
    const lang = LS.get('dc_lang', 'en');
    const MS = {
        // navigation
        'Home': 'Utama', 'Search': 'Cari', 'Library': 'Pustaka', 'Your Library': 'Pustaka anda', 'Settings': 'Tetapan', 'Back': 'Kembali', 'Forward': 'Ke depan',
        'Good morning': 'Selamat pagi', 'Good afternoon': 'Selamat petang', 'Good evening': 'Selamat malam',
        'Made for you': 'Dibuat untuk anda', 'Recently played': 'Dimainkan baru-baru ini', 'Jump back in': 'Sambung semula', 'Show all': 'Tunjuk semua',
        'Trending in Malaysia': 'Trending di Malaysia', 'Popular in Indonesia': 'Popular di Indonesia', 'Global hits': 'Lagu hit dunia', 'K-Pop now': 'K-Pop sekarang',
        'Moods': 'Mood', 'Genres': 'Genre', 'Daily Mix': 'Daily Mix', 'Release Radar': 'Release Radar', 'On Repeat': 'Selalu diulang',
        'NEW THIS WEEK': 'BARU MINGGU INI', 'LAST 30 DAYS': '30 HARI LEPAS', 'Recent searches': 'Carian terkini', 'Top result': 'Hasil teratas',
        'Songs': 'Lagu', 'Artists': 'Artis', 'Playlists': 'Playlist', 'Videos': 'Video', 'Albums & playlists': 'Album & playlist', 'Popular': 'Popular',
        'More songs': 'Lagi lagu', 'Fans also like': 'Peminat juga suka', 'Artist': 'Artis', 'Playlist': 'Playlist', 'Liked Songs': 'Lagu yang disukai',
        'Songs, artists or lyrics…': 'Lagu, artis atau lirik…', 'Search songs': 'Cari lagu', 'Search lyrics': 'Cari ikut lirik',
        'No results. Try a different spelling.': 'Tiada hasil. Cuba ejaan lain.', 'Try a different spelling or fewer words.': 'Cuba ejaan lain atau kurangkan perkataan.',
        // player
        'Play': 'Main', 'Pause': 'Jeda', 'Next': 'Seterusnya', 'Previous': 'Sebelumnya', 'Shuffle': 'Kocok', 'Repeat': 'Ulang', 'Mute': 'Senyap', 'Like': 'Suka', 'Liked': 'Disukai',
        'Queue': 'Senarai main', 'Lyrics': 'Lirik', 'Video': 'Video', 'Radio': 'Radio', 'Now playing': 'Sedang dimainkan', 'Playing next': 'Main seterusnya', 'Nothing playing': 'Tiada lagu dimainkan',
        'Open player': 'Buka pemain', 'Close': 'Tutup', 'More': 'Lagi', 'Mini player': 'Pemain mini', 'Full screen': 'Skrin penuh', 'Exit full screen': 'Keluar skrin penuh',
        'Play next': 'Main seterusnya', 'Add to queue': 'Tambah ke senarai main', 'Add to playlist': 'Tambah ke playlist', 'Save to Liked Songs': 'Simpan ke Lagu yang disukai',
        'Remove from Liked Songs': 'Buang dari Lagu yang disukai', 'Go to artist': 'Pergi ke artis', 'Start song radio': 'Mulakan radio lagu', 'Share song link': 'Kongsi pautan lagu',
        'Playback speed': 'Kelajuan main', 'Full screen lyrics': 'Lirik skrin penuh', 'Sleep timer': 'Pemasa tidur', 'Share lyrics as a picture': 'Kongsi lirik sebagai gambar',
        'Remove from this playlist': 'Buang dari playlist ini', 'Add to Jam': 'Tambah ke Jam', 'Listen together (Jam)': 'Dengar bersama (Jam)', 'Car mode': 'Mod kereta',
        'Share as a picture (Story)': 'Kongsi sebagai gambar (Story)', 'Pick a song first': 'Pilih lagu dulu', 'Play a song first': 'Main lagu dulu', 'Starting radio…': 'Memulakan radio…',
        'Saved to Liked Songs': 'Disimpan ke Lagu yang disukai', 'Added to queue': 'Ditambah ke senarai main', 'Added to playlist': 'Ditambah ke playlist', 'Already in this playlist': 'Sudah ada dalam playlist ini',
        'Smart Shuffle': 'Kocok pintar', 'End of the queue': 'Hujung senarai main', 'Drag to reorder': 'Seret untuk susun',
        'Exit': 'Keluar', 'CAR MODE': 'MOD KERETA',
        // lyrics
        'No lyrics found': 'Lirik tidak dijumpai', 'This song has no lyrics': 'Lagu ini tiada lirik', 'Instrumental': 'Instrumental', 'Translate': 'Terjemah', 'Romanize': 'Rumikan',
        'Lyrics options': 'Pilihan lirik', 'Search other lyrics': 'Cari lirik lain', 'Back to current line': 'Kembali ke baris semasa', 'Share lyrics': 'Kongsi lirik',
        'Tap the line you hear right now': 'Ketik baris yang anda dengar sekarang', 'Play a song to see lyrics': 'Main lagu untuk lihat lirik',
        // library
        'New playlist': 'Playlist baru', 'Create playlist': 'Cipta playlist', 'Import': 'Import', 'Import playlist': 'Import playlist', 'Folders': 'Folder', 'History': 'Sejarah', 'Following': 'Diikuti', 'Follow': 'Ikuti',
        'Darcam Wrapped': 'Darcam Wrapped', 'Your listening stats': 'Statistik pendengaran anda', 'Listen together': 'Dengar bersama', 'Start or join a Jam': 'Mula atau sertai Jam',
        'Move to another device': 'Pindah ke peranti lain', 'Send your library with a QR code': 'Hantar pustaka dengan kod QR', 'Recently added': 'Baru ditambah', 'A–Z': 'A–Z', 'Most songs': 'Paling banyak lagu',
        'Edit details': 'Edit butiran', 'Pin to the top': 'Pin ke atas', 'Unpin': 'Nyahpin', 'Move to folder': 'Pindah ke folder', 'Share playlist link': 'Kongsi pautan playlist',
        'Change cover picture': 'Tukar gambar kulit', 'Delete playlist': 'Padam playlist', 'Remove duplicates': 'Buang lagu berganda', 'Merge playlists': 'Gabung playlist', 'Merge': 'Gabung',
        'Smart playlist': 'Playlist pintar', 'Edit rules': 'Edit peraturan', 'Recommended': 'Disyorkan', 'Refresh': 'Muat semula', 'Based on the songs in this playlist': 'Berdasarkan lagu dalam playlist ini',
        'Artists you might like': 'Artis yang mungkin anda suka', 'This playlist is empty': 'Playlist ini kosong', 'Songs you like will appear here': 'Lagu yang anda suka akan muncul di sini',
        'Play all': 'Main semua', 'No folders yet': 'Belum ada folder', 'Remove folder': 'Buang folder', 'Rename': 'Tukar nama', 'Search your history': 'Cari dalam sejarah anda',
        'Today': 'Hari ini', 'Yesterday': 'Semalam', 'Clear': 'Kosongkan', 'Top artists': 'Artis teratas', 'Top songs': 'Lagu teratas', 'Top artist': 'Artis teratas', 'Top song': 'Lagu teratas',
        'Biggest day': 'Hari paling banyak', 'minutes listened': 'minit didengar', 'songs': 'lagu', 'artists': 'artis', 'plays': 'kali main', 'This month': 'Bulan ini', 'This year': 'Tahun ini', 'All time': 'Sepanjang masa',
        'Last 30 days': '30 hari lepas', 'Nothing here yet': 'Belum ada apa-apa', 'Share as a picture': 'Kongsi sebagai gambar', 'New songs': 'Lagu baru', 'Latest release': 'Lagu terbaru',
        'No artists followed yet': 'Belum ikuti mana-mana artis', 'Open an artist and tap Follow. New songs show up here and in Release Radar.': 'Buka artis dan tekan Ikuti. Lagu baru akan muncul di sini dan dalam Release Radar.',
        // modals and common buttons
        'Cancel': 'Batal', 'Save': 'Simpan', 'Create': 'Cipta', 'Delete': 'Padam', 'Remove': 'Buang', 'Done': 'Siap', 'Add': 'Tambah', 'Share': 'Kongsi', 'Copy link': 'Salin pautan', 'Join': 'Sertai',
        'Choose photo': 'Pilih foto', 'Remove photo': 'Buang foto', 'Name': 'Nama', 'Add an optional description': 'Tambah penerangan (pilihan)', 'Saved': 'Disimpan', 'Link copied': 'Pautan disalin',
        'Playlist updated': 'Playlist dikemas kini', 'Removed from playlist': 'Dibuang dari playlist', 'Picture saved': 'Gambar disimpan', 'Making the picture…': 'Sedang buat gambar…',
        'Later': 'Nanti', 'Download and install': 'Muat turun dan pasang', 'Reload now': 'Muat semula sekarang', 'Not now': 'Bukan sekarang', 'Allow': 'Benarkan', 'Show': 'Tunjuk', 'Test': 'Uji',
        'Pink': 'Merah jambu', 'Dark': 'Gelap', 'Cover': 'Kulit album', 'Light': 'Cerah', 'From the cover': 'Dari kulit album',
        // settings
        'Playback': 'Main balik', 'Autoplay': 'Main automatik', 'Play similar songs when the queue ends': 'Main lagu serupa bila senarai habis',
        'Crossfade': 'Crossfade', 'The next song fades in while the current one fades out': 'Lagu seterusnya masuk perlahan-lahan semasa lagu sekarang hilang', 'Off': 'Tutup', 'On': 'Buka',
        'Karaoke effect': 'Kesan karaoke', 'Fill the current line as it’s sung': 'Warnakan baris semasa ia dinyanyikan', 'Focus on current line': 'Fokus pada baris semasa',
        'Blur the lines further away, like Apple Music': 'Kaburkan baris yang jauh, macam Apple Music', 'Lyrics outside the app': 'Lirik di luar app',
        'Show the current line in the Dynamic Island and music notification': 'Tunjuk baris semasa dalam Dynamic Island dan notifikasi muzik', 'Lyrics text size': 'Saiz teks lirik',
        'Small, medium or large': 'Kecil, sederhana atau besar', 'Small': 'Kecil', 'Medium': 'Sederhana', 'Large': 'Besar', 'Lyrics timing': 'Masa lirik',
        'If lyrics show before the singer, delay them more': 'Kalau lirik keluar sebelum penyanyi, lambatkan lagi', 'No delay': 'Tiada lengah', 'Translate to': 'Terjemah ke', 'Language for the Translate button': 'Bahasa untuk butang Terjemah',
        'Video behind lyrics': 'Video di belakang lirik', 'Play the music video softly behind the lyrics': 'Main video muzik di belakang lirik', 'Wi-Fi only': 'Wi-Fi sahaja',
        'Language': 'Bahasa', 'App language': 'Bahasa paparan app', 'Open': 'Buka', 'Big buttons for when your phone is in a car holder': 'Butang besar bila phone diletak pada holder dalam kereta',
        'Notifications': 'Notifikasi', 'New songs from artists you follow': 'Lagu baru dari artis yang anda ikuti', 'A notification when an artist you follow releases a song (checked while Darcam is open or playing)': 'Notifikasi bila artis yang anda ikuti keluarkan lagu (disemak semasa Darcam dibuka atau sedang main)',
        'Updates': 'Kemas kini', 'Check for updates': 'Semak kemas kini', 'Check now': 'Semak sekarang',
        'Dynamic Island': 'Dynamic Island', 'Show Dynamic Island': 'Tunjuk Dynamic Island', 'Song and lyrics at the top of the screen when you leave Darcam': 'Lagu dan lirik di atas skrin bila anda keluar dari Darcam',
        'Island log': 'Log island', 'Windows': 'Windows', 'Keep playing when the window is closed': 'Terus main bila tetingkap ditutup', 'Start with Windows': 'Buka bersama Windows',
        'Open Darcam when you sign in': 'Buka Darcam bila anda log masuk', 'Show what you play on Discord': 'Tunjuk lagu yang dimainkan di Discord', 'Sharing & Jam': 'Perkongsian & Jam',
        'Your Darcam website': 'Website Darcam anda', 'Your name': 'Nama anda', 'Friends see it in a Jam': 'Kawan nampak nama ini dalam Jam', 'Keyboard shortcuts': 'Pintasan papan kekunci',
        'Your data': 'Data anda', 'Backup library': 'Sandarkan pustaka', 'Restore backup': 'Pulihkan sandaran', 'Clear search history': 'Kosongkan sejarah carian', 'Clear cache': 'Kosongkan cache',
        'Install Darcam': 'Pasang Darcam', 'App': 'App', 'Install': 'Pasang', 'Advanced': 'Lanjutan', 'Test search engine': 'Uji enjin carian',
        'Darcam has no accounts. Your playlists, likes and history stay on this device only. Make a backup to move them to another device.': 'Darcam tiada akaun. Playlist, lagu disukai dan sejarah anda kekal dalam peranti ini sahaja. Buat sandaran untuk pindah ke peranti lain.',
        // tidy / smart
        'Duplicates found': 'Lagu berganda dijumpai', 'No duplicates in this playlist': 'Tiada lagu berganda dalam playlist ini', 'Pick the ones to join into one': 'Pilih playlist untuk digabungkan',
        'New playlist name': 'Nama playlist baru', 'Updates itself by your rules': 'Kemas kini sendiri ikut peraturan anda', 'Add a rule': 'Tambah peraturan', 'Match all rules': 'Padan semua peraturan',
        'Match any rule': 'Padan mana-mana peraturan', 'Create smart playlist': 'Cipta playlist pintar', 'Artist name has': 'Nama artis ada', 'Song title has': 'Tajuk lagu ada', 'Is liked': 'Disukai',
        'Played at least (times)': 'Dimainkan sekurang-kurangnya (kali)', 'Played in the last (days)': 'Dimainkan dalam (hari) lepas', 'Not played in the last (days)': 'Tidak dimainkan dalam (hari) lepas', 'Is in playlist': 'Ada dalam playlist',
        'Song names and lyrics stay as they are': 'Nama lagu dan lirik kekal seperti asal', 'Check for new songs': 'Semak lagu baru', 'Green dot = something new since you last looked': 'Titik hijau = ada lagu baru sejak kali terakhir anda tengok',
        'Checking…': 'Sedang semak…', 'Rules saved': 'Peraturan disimpan', 'Smart playlist created': 'Playlist pintar dicipta', 'Add at least one rule': 'Tambah sekurang-kurangnya satu peraturan',
        'Delete the old playlists after merging': 'Padam playlist lama selepas digabung', 'Pick 2 or more': 'Pilih 2 atau lebih', 'The first copy of each song stays where it is.': 'Salinan pertama setiap lagu kekal di tempatnya.',
        'Share your Wrapped': 'Kongsi Wrapped anda', 'Share what you’re playing': 'Kongsi lagu yang sedang dimainkan', 'You need at least 2 playlists to merge': 'Perlu sekurang-kurangnya 2 playlist untuk digabung',
        'Couldn’t check for updates. Is your Darcam website set in Settings?': 'Tak dapat semak kemas kini. Website Darcam dah diset dalam Tetapan?', 'Set your Darcam website first (Settings → Sharing & Jam)': 'Set website Darcam dulu (Tetapan → Perkongsian & Jam)',
        'Set your Darcam website above first': 'Set website Darcam di atas dulu', 'Smart playlist': 'Playlist pintar', 'Remove rule': 'Buang peraturan',
        'Android will ask you to allow installing from your browser the first time. Your library stays.': 'Android akan minta kebenaran pasang dari browser kali pertama. Pustaka anda kekal.',
        'Up next': 'Seterusnya', 'Add songs': 'Tambah lagu', 'Leave Jam': 'Keluar Jam', 'End Jam': 'Tamatkan Jam', 'Invite': 'Jemput', 'Invite friends': 'Jemput kawan',
        'Let friends control the music': 'Benarkan kawan kawal muzik', 'Play, pause, skip and pick from the queue': 'Main, jeda, langkau dan pilih dari senarai',
        'You can play, pause and skip for everyone.': 'Anda boleh main, jeda dan langkau untuk semua orang.', 'Start a Jam': 'Mulakan Jam', 'Code from a friend': 'Kod dari kawan',
        'Copy link': 'Salin pautan', 'Added to the Jam': 'Ditambah ke Jam', 'You left the Jam': 'Anda keluar dari Jam', 'You ended the Jam': 'Anda tamatkan Jam', 'The Jam has ended': 'Jam sudah tamat',
        'The queue is empty. Add a song!': 'Senarai kosong. Tambah lagu!', 'Songs you pick now go into the Jam': 'Lagu yang anda pilih sekarang masuk ke Jam', 'Your name in the Jam': 'Nama anda dalam Jam',
        'Friends can play, pause and skip': 'Kawan boleh main, jeda dan langkau', 'Only you can control the music': 'Hanya anda boleh kawal muzik', 'End the Jam?': 'Tamatkan Jam?',
        'Sort by': 'Susun ikut', 'Most played': 'Paling banyak dimainkan', 'Random': 'Rawak', 'Newest played': 'Terbaru dimainkan', 'Smart': 'Pintar',
    };
    const PAT = [
        [/^([\d,.]+) songs?$/, '$1 lagu'], [/^Playlist · ([\d,.]+) songs?$/, 'Playlist · $1 lagu'], [/^([\d,.]+) followers$/, '$1 pengikut'], [/^([\d,.]+) min$/, '$1 min'],
        [/^Added to (.+)$/, 'Ditambah ke $1'], [/^Version (\S+) · no account, no ads$/, 'Versi $1 · tiada akaun, tiada iklan'], [/^Folder · (\d+) playlists?$/, 'Folder · $1 playlist'],
        [/^New from (.+)$/, 'Baru dari $1'], [/^Darcam (\S+) is here$/, 'Darcam $1 sudah ada'], [/^You have (.+)$/, 'Anda ada $1'], [/^Playback speed: (.+)$/, 'Kelajuan main: $1'],
        [/^Sleep timer: (.+)$/, 'Pemasa tidur: $1'], [/^Right now: (\d+) songs?$/, 'Sekarang: $1 lagu'], [/^([\d.]+) s later$/, '$1 s lambat'], [/^([\d.]+) s later \(default\)$/, '$1 s lambat (asal)'],
        [/^(\d+) s \(default\)$/, '$1 s (asal)'], [/^Remove (\d+) extra cop(y|ies)$/, 'Buang $1 salinan lebih'], [/^(\d+) copies$/, '$1 salinan'],
    ];
    const SKIP = '.trow-title,.trow-sub,.tile-title,.tile-sub,.hero-title,.hero-desc,.np-title,.np-artist,#npLyrics,.np-lyrics,.kar,.lib-text b,.car-title,.car-artist,#barTitle,#barArtist,.mi-title,.mi-sub,.q-title,.q-sub,.lib-item b,.pick-row span,.wr-artists b,.wr-card b,.chart-title,input,textarea,script,style,code,kbd,[data-notr]';
    function tr(s) {
        const k = s.trim();
        if (!k || k.length > 400) return null;
        if (MS[k]) return s.replace(k, MS[k]);
        for (const [re, to] of PAT) if (re.test(k)) return s.replace(k, k.replace(re, to));
        return null;
    }
    function doText(n) {
        const p = n.parentElement;
        if (!p || p.closest(SKIP)) return;
        const v = tr(n.nodeValue);
        if (v != null && v !== n.nodeValue) n.nodeValue = v;
    }
    function doAttrs(el) {
        if (el.closest && el.closest('.trow,.tile') && el.matches && el.matches('.trow,.tile')) return;
        ['title', 'aria-label', 'placeholder'].forEach((a) => {
            const v = el.getAttribute && el.getAttribute(a);
            if (!v) return;
            const t = tr(v);
            if (t != null && t !== v) el.setAttribute(a, t);
        });
    }
    function walk(root) {
        if (root.nodeType === 3) { doText(root); return; }
        if (root.nodeType !== 1 || root.closest(SKIP)) return;
        doAttrs(root);
        root.querySelectorAll('[title],[aria-label],[placeholder]').forEach(doAttrs);
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n; while ((n = w.nextNode())) doText(n);
    }
    function start() {
        if (lang !== 'ms') return;
        document.documentElement.lang = 'ms';
        walk(document.body);
        new MutationObserver((ms) => {
            ms.forEach((m) => {
                if (m.type === 'characterData') doText(m.target);
                else if (m.type === 'attributes') doAttrs(m.target);
                else m.addedNodes.forEach(walk);
            });
        }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] });
    }
    function set(l) { LS.set('dc_lang', l); location.reload(); }
    return { start, set, lang, t: (s) => (lang === 'ms' ? (tr(s) ?? s) : s) };
})();

// =====================================================================
// Story pictures (1080 × 1920): Wrapped and Now playing
// =====================================================================
const StoryCard = (() => {
    const W = 1080, H = 1920, F = 'Inter, "Segoe UI", system-ui, sans-serif';
    function loadImg(src) {
        return new Promise((res) => { if (!src) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    }
    function fit(x, text, maxW) { if (x.measureText(text).width <= maxW) return text; let s = text; while (s.length > 1 && x.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; }
    function drawCover(x, img, X, Y, S, r) {
        x.save(); x.beginPath(); x.roundRect(X, Y, S, S, r); x.clip();
        if (img) {
            // YouTube 4:3 thumbnails have black bars top and bottom: skip them, then crop to a square
            let sx = 0, sy = 0, sw = img.width, sh = img.height;
            if (/i\.ytimg\.com/.test(img.src) && Math.abs(sw / sh - 4 / 3) < 0.02) { sy = sh * 0.125; sh = sh * 0.75; }
            const side = Math.min(sw, sh); sx += (sw - side) / 2; sy += (sh - side) / 2;
            x.drawImage(img, sx, sy, side, side, X, Y, S, S);
        }
        else { x.fillStyle = '#26262b'; x.fillRect(X, Y, S, S); }
        x.restore();
    }
    function background(x, theme, img) {
        if (theme === 'cover' && img) {
            x.fillStyle = '#0a0a0b'; x.fillRect(0, 0, W, H);
            x.filter = 'blur(80px) saturate(1.4)';
            const s = Math.max(W / img.width, H / img.height) * 1.3;
            x.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
            x.filter = 'none';
            const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,.15)'); g.addColorStop(1, 'rgba(0,0,0,.7)');
            x.fillStyle = g; x.fillRect(0, 0, W, H);
        } else if (theme === 'dark') {
            const g = x.createRadialGradient(W * .3, H * .2, 50, W * .5, H * .5, H * .9); g.addColorStop(0, '#2a1420'); g.addColorStop(1, '#050506');
            x.fillStyle = g; x.fillRect(0, 0, W, H);
        } else {
            const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#ff4f93'); g.addColorStop(1, '#e5243b');
            x.fillStyle = g; x.fillRect(0, 0, W, H);
        }
    }
    function footer(x, theme) {
        x.textBaseline = 'alphabetic'; x.globalAlpha = 1; x.fillStyle = '#fff';
        x.font = `900 56px ${F}`; x.fillText('darcam', 96, H - 110);
        const w = x.measureText('darcam').width;
        x.fillStyle = theme === 'pink' ? '#000' : '#e5243b'; x.fillText('.', 96 + w + 2, H - 110);
    }
    async function wrapped(info, theme) {
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const x = cv.getContext('2d');
        const ta = info.topArtists[0];
        const img = ta ? await loadImg(ta.c) : null;
        background(x, theme, img);
        x.fillStyle = '#fff'; x.textBaseline = 'top';
        x.globalAlpha = .85; x.font = `800 40px ${F}`; x.fillText(('My ' + info.label + ' on Darcam').toUpperCase(), 96, 150); x.globalAlpha = 1;
        x.font = `900 230px ${F}`; x.fillText(info.mins.toLocaleString(), 88, 230);
        x.font = `700 52px ${F}`; x.fillText('minutes listened', 96, 480);
        let y = 640;
        if (ta) {
            drawCover(x, img, 96, y, 220, 30);
            x.globalAlpha = .85; x.font = `800 34px ${F}`; x.fillText('TOP ARTIST', 360, y + 52); x.globalAlpha = 1;
            x.font = `900 72px ${F}`; x.fillText(fit(x, ta.name, W - 360 - 96), 360, y + 100);
            y += 320;
        }
        x.globalAlpha = .85; x.font = `800 34px ${F}`; x.fillText('TOP SONGS', 96, y); x.globalAlpha = 1;
        y += 70;
        info.topSongs.slice(0, 5).forEach((s, i) => {
            x.font = `900 56px ${F}`; x.fillText(String(i + 1), 96, y);
            x.font = `800 52px ${F}`; x.fillText(fit(x, s.name, W - 190 - 96), 170, y);
            x.globalAlpha = .75; x.font = `600 36px ${F}`; x.fillText(fit(x, s.a || '', W - 190 - 96), 170, y + 64); x.globalAlpha = 1;
            y += 140;
        });
        x.globalAlpha = .85; x.font = `700 38px ${F}`;
        x.fillText(`${info.songs} song${info.songs === 1 ? "" : "s"} · ${info.artists} artist${info.artists === 1 ? "" : "s"}`, 96, Math.min(y + 10, H - 260)); x.globalAlpha = 1;
        footer(x, theme);
        return cv;
    }
    async function nowPlaying(t, theme) {
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const x = cv.getContext('2d');
        const img = await loadImg(T.coverLg(t)) || await loadImg(T.cover(t));
        background(x, theme, img);
        x.fillStyle = '#fff'; x.textBaseline = 'top';
        x.globalAlpha = .85; x.font = `800 40px ${F}`; x.fillText('NOW PLAYING', 96, 170); x.globalAlpha = 1;
        const S = 820, X = (W - S) / 2, Y = 300;
        x.save(); x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 80; x.shadowOffsetY = 30; x.fillStyle = '#000'; x.beginPath(); x.roundRect(X, Y, S, S, 44); x.fill(); x.restore();
        drawCover(x, img, X, Y, S, 44);
        x.textAlign = 'center';
        let fs = 76; x.font = `900 ${fs}px ${F}`;
        while (fs > 50 && x.measureText(T.title(t)).width > W - 160) { fs -= 4; x.font = `900 ${fs}px ${F}`; }
        x.fillText(fit(x, T.title(t), W - 160), W / 2, Y + S + 90);
        x.globalAlpha = .8; x.font = `700 48px ${F}`; x.fillText(fit(x, T.artist(t), W - 160), W / 2, Y + S + 190); x.globalAlpha = 1;
        const d = Player.state.duration || 0, p = d ? Math.min(1, Player.time() / d) : 0.4;
        const by = Y + S + 300;
        x.fillStyle = 'rgba(255,255,255,.3)'; x.beginPath(); x.roundRect(96, by, W - 192, 10, 5); x.fill();
        x.fillStyle = '#fff'; x.beginPath(); x.roundRect(96, by, Math.max(10, (W - 192) * p), 10, 5); x.fill();
        x.textAlign = 'left';
        footer(x, theme);
        return cv;
    }
    const THEMES = [['pink', 'Pink'], ['cover', 'From the cover'], ['dark', 'Dark']];
    function open(title, make, nameFor) {
        let theme = 'pink', cv = null;
        UI.modal(`<h3>${esc(title)}</h3>
            <div class="card-prev story"><div class="card-sk">Making the picture…</div></div>
            <div class="card-themes">${THEMES.map(([k, n]) => `<button class="chip ${k === theme ? 'on' : ''}" data-theme="${k}">${n}</button>`).join('')}</div>
            <div class="modal-actions"><button class="btn ghost" data-close>Close</button><button class="btn primary" data-share>${ic('share')}<span>Share</span></button></div>`, (m) => {
            const prev = m.querySelector('.card-prev');
            const draw = async () => { cv = await make(theme); cv.className = 'card-canvas'; prev.innerHTML = ''; prev.appendChild(cv); };
            m.querySelectorAll('[data-theme]').forEach((b) => b.onclick = () => { theme = b.dataset.theme; m.querySelectorAll('[data-theme]').forEach((y) => y.classList.toggle('on', y === b)); draw(); });
            m.querySelector('[data-share]').onclick = () => { if (cv) LyricCard.share(cv, { name: nameFor, artists: [{ name: '' }] }); };
            draw();
        });
        document.querySelector('#modal .modal').classList.add('wide');
    }
    function shareWrapped(info) { open('Share your Wrapped', (th) => wrapped(info, th), 'wrapped ' + info.label); }
    function shareNow(t) { t = t || Player.current(); if (!t) { UI.toast('Play a song first'); return; } open('Share what you’re playing', (th) => nowPlaying(t, th), T.title(t)); }
    return { shareWrapped, shareNow };
})();

// =====================================================================
// Playlist clean-up: duplicates, merge, smart playlists
// =====================================================================
const Tidy = (() => {
    const clean = (s) => (s || '').toLowerCase().replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (m, a, b) => (/(official|video|audio|lyric|lirik|mv|hd|4k|visuali[sz]er)/.test(a || b) ? '' : m)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const keyOf = (t) => clean(T.title(Catalog.normalize(t))) + '|' + clean((T.artist(Catalog.normalize(t)) || '').split(/\s*,\s*/)[0]);
    function dupes(tracks) {
        const seen = new Map(), extra = [];
        tracks.forEach((t, i) => {
            const k1 = 'id:' + (t.youtube_id || t.id), k2 = 'k:' + keyOf(t);
            const first = seen.get(k1) ?? seen.get(k2);
            if (first != null) extra.push({ i, of: first });
            else { seen.set(k1, i); seen.set(k2, i); }
        });
        return extra;
    }
    function removeDupes(pid) {
        const p = Store.playlist(pid); if (!p) return;
        const extra = dupes(p.tracks);
        if (!extra.length) { UI.toast('No duplicates in this playlist', 'success'); return; }
        const groups = {};
        extra.forEach((e) => { groups[e.of] = (groups[e.of] || 1) + 1; });
        const rows = Object.entries(groups).slice(0, 40).map(([i, n]) => { const t = Catalog.normalize(p.tracks[i]); return `<div class="dup-row">${UI.art(T.cover(t), 'pick-art', T.title(t))}<span><b>${esc(T.title(t))}</b><small>${esc(T.artist(t))} · ${n} copies</small></span></div>`; }).join('');
        UI.modal(`<h3>Duplicates found</h3><p class="muted small">The first copy of each song stays where it is.</p><div class="pick-list">${rows}</div>
            <div class="modal-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Remove ${extra.length} extra cop${extra.length === 1 ? 'y' : 'ies'}</button></div>`, (m, close) => {
            m.querySelector('[data-ok]').onclick = () => {
                const drop = new Set(extra.map((e) => e.i));
                Store.updatePlaylist(pid, { tracks: p.tracks.filter((_, i) => !drop.has(i)) });
                close(); UI.toast(extra.length + ' removed', 'success'); Pages.go();
            };
        });
    }
    function merge(preselect) {
        const pls = Store.playlists().filter((p) => !p.smart);
        if (pls.length < 2) { UI.toast('You need at least 2 playlists to merge'); return; }
        const sel = new Set(preselect ? [preselect] : []);
        UI.modal(`<h3>Merge playlists</h3><p class="muted small">Pick the ones to join into one</p>
            <div class="pick-list merge-list">${pls.map((p) => `<label class="pick-row chk"><input type="checkbox" value="${esc(p.id)}" ${sel.has(p.id) ? 'checked' : ''}>${UI.localPlaylistCover(p, 'pick-art')}<span>${esc(p.name)}<small>${p.tracks.length} songs</small></span></label>`).join('')}</div>
            <input class="field" data-name placeholder="New playlist name" maxlength="60">
            <p class="muted small" data-sum></p>
            <label class="set-row tight"><span><b>Delete the old playlists after merging</b></span><input type="checkbox" class="switch" data-del></label>
            <div class="modal-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok disabled>Merge</button></div>`, (m, close) => {
            const nameIn = m.querySelector('[data-name]'), sum = m.querySelector('[data-sum]'), ok = m.querySelector('[data-ok]');
            let auto = true;
            nameIn.addEventListener('input', () => (auto = false));
            const calc = () => {
                const picked = pls.filter((p) => sel.has(p.id));
                const all = []; picked.forEach((p) => all.push(...p.tracks));
                const extra = dupes(all).length;
                if (auto) nameIn.value = picked.map((p) => p.name).slice(0, 3).join(' + ');
                sum.textContent = picked.length >= 2 ? `${all.length - extra} songs${extra ? ` (${extra} duplicates skipped)` : ''}` : 'Pick 2 or more';
                ok.disabled = picked.length < 2;
                return { picked, all, extra };
            };
            m.querySelectorAll('.merge-list input').forEach((c) => c.addEventListener('change', () => { c.checked ? sel.add(c.value) : sel.delete(c.value); calc(); }));
            calc();
            ok.onclick = () => {
                const { picked, all } = calc();
                const drop = new Set(dupes(all).map((e) => e.i));
                const p = Store.importPlaylist({ name: nameIn.value.trim() || 'Merged playlist', tracks: all.filter((_, i) => !drop.has(i)) });
                if (m.querySelector('[data-del]').checked) picked.forEach((x) => Store.deletePlaylist(x.id));
                close(); UI.toast('Merged into “' + p.name + '”', 'success'); location.hash = '#/playlist/' + p.id;
            };
        });
        setTimeout(() => { const n = document.querySelector('#modal [data-name]'); if (n) n.blur(); }, 80);
    }

    // ---- smart playlists ----
    const FIELDS = [
        ['artist', 'Artist name has', 'text'], ['title', 'Song title has', 'text'], ['liked', 'Is liked', 'none'],
        ['plays', 'Played at least (times)', 'num'], ['recent', 'Played in the last (days)', 'num'], ['notplayed', 'Not played in the last (days)', 'num'], ['playlist', 'Is in playlist', 'pl'],
    ];
    function pool() {
        const m = new Map();
        const add = (t) => { if (!t || t.pending) return; const k = t.youtube_id || t.id; if (!m.has(k)) m.set(k, Catalog.normalize(t)); };
        Store.liked().forEach(add);
        Store.playlists().filter((p) => !p.smart).forEach((p) => p.tracks.forEach(add));
        Object.values(Stats.range('0000', '9999').songs).forEach((s) => add(Stats.toTrack(s)));
        return [...m.values()];
    }
    function compute(rules) {
        const all = Stats.range('0000', '9999').songs;
        const since = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return Stats.range(Stats.day(d), Stats.day()).songs; };
        const cache = {};
        const liked = new Set(Store.liked().map((t) => t.youtube_id || t.id));
        const test = (t, r) => {
            const id = t.youtube_id || t.id, v = r.v;
            const plays = (s) => (s[id] || s[t.id] || { n: 0 }).n;
            switch (r.f) {
                case 'artist': return clean(T.artist(t)).includes(clean(v));
                case 'title': return clean(T.title(t)).includes(clean(v));
                case 'liked': return liked.has(id);
                case 'plays': return plays(all) >= (+v || 1);
                case 'recent': return plays(cache['r' + v] = cache['r' + v] || since(+v || 30)) > 0;
                case 'notplayed': return plays(cache['r' + v] = cache['r' + v] || since(+v || 30)) === 0;
                case 'playlist': { const p = Store.playlist(v); return !!(p && p.tracks.some((x) => (x.youtube_id || x.id) === id)); }
                default: return true;
            }
        };
        const ok = (rules.rules || []).filter((r) => r.f);
        let out = pool().filter((t) => !ok.length ? false : rules.match === 'any' ? ok.some((r) => test(t, r)) : ok.every((r) => test(t, r)));
        const n = (t) => (all[t.youtube_id || t.id] || all[t.id] || { n: 0 }).n;
        if (rules.sort === 'az') out.sort((a, b) => T.title(a).localeCompare(T.title(b)));
        else if (rules.sort === 'random') out = shuffleArr(out);
        else out.sort((a, b) => n(b) - n(a));
        return out.slice(0, +rules.limit || 200);
    }
    function refreshAll() {
        Store.playlists().filter((p) => p.smart).forEach((p) => {
            const tracks = compute(p.smart);
            const a = p.tracks.map((t) => t.id).join(','), b = tracks.map((t) => t.id).join(',');
            if (a !== b && (p.smart.sort !== 'random' || !p.tracks.length)) Store.updatePlaylist(p.id, { tracks: tracks.map((t) => ({ id: t.id, youtube_id: t.youtube_id || t.id, name: t.name, artists: t.artists, album: t.album, cover: t.cover, cover_lg: t.cover_lg, duration_ms: t.duration_ms || 0, kind: t.kind, channelId: t.channelId })) });
        });
    }
    function editor(pid) {
        const p = pid ? Store.playlist(pid) : null;
        const st = p && p.smart ? JSON.parse(JSON.stringify(p.smart)) : { match: 'all', sort: 'plays', limit: 100, rules: [{ f: 'liked' }, { f: 'plays', v: 3 }] };
        const pls = Store.playlists().filter((x) => !x.smart);
        const ruleRow = (r, i) => {
            const f = FIELDS.find((x) => x[0] === r.f) || FIELDS[0];
            const inp = f[2] === 'text' ? `<input class="field sm" data-v="${i}" value="${esc(r.v || '')}" placeholder="e.g. ST12">`
                : f[2] === 'num' ? `<input class="field sm" data-v="${i}" type="number" min="1" value="${esc(r.v || (r.f === 'plays' ? 3 : 30))}" style="width:90px">`
                : f[2] === 'pl' ? `<select class="field sm" data-v="${i}">${pls.map((x) => `<option value="${esc(x.id)}" ${x.id === r.v ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : '';
            return `<div class="rule"><select class="field sm" data-f="${i}">${FIELDS.map(([k, n]) => `<option value="${k}" ${k === r.f ? 'selected' : ''}>${n}</option>`).join('')}</select>${inp}<button class="icon-btn sm" data-del="${i}" aria-label="Remove rule">${ic('x')}</button></div>`;
        };
        UI.modal(`<h3>${p ? 'Edit rules' : 'Smart playlist'}</h3><p class="muted small">Updates itself by your rules</p>
            <input class="field" data-name placeholder="Name" maxlength="60" value="${esc(p ? p.name : 'My smart playlist')}">
            <div class="rule-top"><select class="field sm" data-match><option value="all" ${st.match !== 'any' ? 'selected' : ''}>Match all rules</option><option value="any" ${st.match === 'any' ? 'selected' : ''}>Match any rule</option></select>
                <label class="muted small">Sort by <select class="field sm" data-sort>${[['plays', 'Most played'], ['az', 'A–Z'], ['random', 'Random']].map(([k, n]) => `<option value="${k}" ${st.sort === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
            <div class="rules" data-rules></div>
            <button class="btn ghost sm" data-addrule>${ic('plus')}<span>Add a rule</span></button>
            <p class="muted small" data-count></p>
            <div class="modal-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>${p ? 'Save' : 'Create smart playlist'}</button></div>`, (m, close) => {
            const box = m.querySelector('[data-rules]'), cnt = m.querySelector('[data-count]');
            const recount = debounce(() => { const n = compute(st).length; cnt.textContent = `Right now: ${n} song${n === 1 ? '' : 's'}`; }, 150);
            const draw = () => { box.innerHTML = st.rules.map(ruleRow).join(''); hydrateIcons(box); recount(); };
            box.addEventListener('change', (e) => {
                const f = e.target.dataset.f, v = e.target.dataset.v;
                if (f != null) { st.rules[f] = { f: e.target.value, v: e.target.value === 'playlist' ? (pls[0] || {}).id : '' }; draw(); }
                if (v != null) { st.rules[v].v = e.target.value; recount(); }
            });
            box.addEventListener('input', (e) => { const v = e.target.dataset.v; if (v != null) { st.rules[v].v = e.target.value; recount(); } });
            box.addEventListener('click', (e) => { const d = e.target.closest('[data-del]'); if (d) { st.rules.splice(+d.dataset.del, 1); draw(); } });
            m.querySelector('[data-addrule]').onclick = () => { st.rules.push({ f: 'artist', v: '' }); draw(); };
            m.querySelector('[data-match]').onchange = (e) => { st.match = e.target.value; recount(); };
            m.querySelector('[data-sort]').onchange = (e) => { st.sort = e.target.value; recount(); };
            m.querySelector('[data-ok]').onclick = () => {
                st.rules = st.rules.filter((r) => r.f && (FIELDS.find((x) => x[0] === r.f)[2] === 'none' || String(r.v || '').trim()));
                if (!st.rules.length) { UI.toast('Add at least one rule'); return; }
                const name = m.querySelector('[data-name]').value.trim() || 'My smart playlist';
                let id = pid;
                if (p) Store.updatePlaylist(pid, { name, smart: st, tracks: [] });
                else { const np = Store.createPlaylist(name); id = np.id; Store.updatePlaylist(id, { smart: st }); }
                refreshAll();
                close(); UI.toast(p ? 'Rules saved' : 'Smart playlist created', 'success');
                if (location.hash === '#/playlist/' + id) Pages.go(); else location.hash = '#/playlist/' + id;
            };
            draw();
        });
        setTimeout(() => { const n = document.querySelector('#modal [data-name]'); if (n) n.blur(); }, 80);
    }
    return { removeDupes, merge, editor, refreshAll, compute, dupes };
})();

// ---------- start-up ----------
(function startMore() {
    const go = () => {
        // 2.5.1: video behind lyrics is on (Wi-Fi only) unless you turn it off yourself
        if (!LS.get('dc_vbg_251', false)) { LS.set('dc_vbg_251', true); if ((Store.settings.videoBg || 'off') === 'off') Store.setSetting('videoBg', 'wifi'); }
        I18n.start();
        // after an update: say which version you're on now
        const last = LS.get('dc_last_version', '');
        if (last && last !== APP_VERSION && Updater.newer(APP_VERSION, last)) setTimeout(() => UI.toast('Darcam updated to ' + APP_VERSION, 'success'), 1500);
        LS.set('dc_last_version', APP_VERSION);
        try { Tidy.refreshAll(); } catch (e) { console.warn(e); }
        setTimeout(() => Follow.check(), 15000);
        ReleaseNotify.start();
        Updater.start();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else setTimeout(go, 0);
})();
