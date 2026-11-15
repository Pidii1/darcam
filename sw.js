/* Darcam service worker: app shell offline, everything else from the network */
const SHELL = 'darcam-shell-v10';
const FILES = ['./', './index.html', './css/darcam.css', './js/util.js', './js/store.js', './js/innertube.js', './js/catalog.js', './js/importer.js', './js/extras.js', './js/more.js', './js/transfer.js', './js/player.js', './js/lyrics.js', './js/ui.js', './js/pages.js', './js/main.js', './native.js', './img/icon-192.png', './img/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // network first so updates show up straight away; cache only as an offline fallback
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('./index.html'))));
});
