const CACHE = 'tc-v31';
const SHELL = ['./', './index.html', './app.js', './mail.js', './config.js', './style.css', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './badge-96.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Nur die eigenen Dateien werden gecacht, niemals Daten aus der Datenbank.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request)));
});

self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: 'Trampolin Training', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Trampolin Training', { body: d.body || '', icon: 'icon-192.png', badge: 'badge-96.png', data: d.data || null }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const go = e.notification.data;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((l) => {
    const mine = l.filter((c) => c.url.startsWith(self.registration.scope));
    if (mine[0]) { if (go) mine[0].postMessage({ go }); return mine[0].focus(); }
    const q = go ? `?go=${encodeURIComponent(JSON.stringify(go))}` : '';
    return clients.openWindow(self.registration.scope + q);
  }));
});
