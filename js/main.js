/* Darcam — boot */
'use strict';

(function boot() {
    // Opening animation: about 1.9s, tap to skip
    const sp = document.getElementById('splash');
    if (sp) {
        let gone = false;
        const hide = () => { if (gone) return; gone = true; sp.classList.add('out'); setTimeout(() => sp.remove(), 600); };
        sp.addEventListener('click', hide);
        setTimeout(hide, 1950);
    }
    UI.bind();
    Player.boot();
    window.addEventListener('hashchange', Pages.go);
    Pages.go();

    // Sticky page title once the hero scrolls away
    const v = $('#view');
    v.addEventListener('scroll', () => $('.main').classList.toggle('scrolled', v.scrollTop > 140), { passive: true });

    // Install prompt (shown in Settings)
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        window.__dcInstall = e;
        const g = $('#installGroup'); if (g) g.hidden = false;
    });

    // Service worker (website only — the native apps don't need it)
    const native = (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) || /Electron/i.test(navigator.userAgent);
    if (!native && 'serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
        window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
})();
