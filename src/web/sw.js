/* Omika: минимальный service worker. API, логин и история не кэшируются. */
/* global self, caches, fetch, URL */
const CACHE = 'omika-shell-v29';
const STATIC = new Set([
  '/app.js',
  '/style.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/manifest.webmanifest']))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/login' || url.pathname === '/logout') {
    return;
  }

  // Навигацию не кэшируем: внутри HTML есть состояние входа и кампании.
  if (request.mode === 'navigate') return;
  if (!STATIC.has(url.pathname)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
