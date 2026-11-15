/* =====================================================================
   DARCAM — NATIVE SHELL HELPER
   Loaded before app.js. On the website it does nothing.
   Inside the Android/iOS app (Capacitor) there is no PHP, so lyrics
   requests that normally go through lyrics_proxy.php are sent straight
   to lrclib.net (the Capacitor native HTTP layer handles CORS).
   The Windows app (Electron) serves lyrics_proxy.php itself.
   ===================================================================== */
(function () {
    'use strict';
    var isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (!isCapacitor) return;

    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        try {
            var url = typeof input === 'string' ? input : (input && input.url) || '';
            if (url.indexOf('lyrics_proxy.php') !== -1) {
                var u = new URL(url, location.href);
                var endpoint = u.searchParams.get('endpoint');
                if (endpoint === 'search' || endpoint === 'get') {
                    u.searchParams.delete('endpoint');
                    var qs = u.searchParams.toString();
                    return origFetch('https://lrclib.net/api/' + endpoint + (qs ? '?' + qs : ''), init);
                }
            }
        } catch (e) { /* fall through */ }
        return origFetch(input, init);
    };

    // Dark, edge-to-edge status bar
    document.addEventListener('DOMContentLoaded', function () {
        try {
            var SB = window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
            if (SB) {
                SB.setStyle({ style: 'DARK' });
                if (SB.setOverlaysWebView) SB.setOverlaysWebView({ overlay: true });
            }
        } catch (e) {}
    });
})();
