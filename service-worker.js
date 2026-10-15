/* Mochi's Room — Service Worker
   - Pre-caches the app shell
   - Runtime-caches CDN assets (Firebase, Google Fonts)
   - Falls back to offline.html when navigation fails
*/

const VERSION = 'mochi-v1.0.0';
const APP_SHELL_CACHE = `mochi-shell-${VERSION}`;
const RUNTIME_CACHE = `mochi-runtime-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.json'
];

const CDN_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://www.gstatic.com',
  'https://cdn.jsdelivr.net'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then(cache =>
      Promise.all(
        APP_SHELL.map(url =>
          cache.add(url).catch(err => console.warn('[SW] skip', url, err.message))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== APP_SHELL_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCDN = CDN_ORIGINS.some(o => url.href.startsWith(o));

  // Firebase realtime database — always go to network (never cache)
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('firebasedatabase.app')) {
    return;
  }

  if (!isSameOrigin && !isCDN) return;
  if (!url.protocol.startsWith('http')) return;

  // Navigation requests — network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const copy = res.clone();
          caches.open(APP_SHELL_CACHE).then(c => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(request)
            .then(c => c || caches.match('./index.html'))
            .then(c => c || caches.match('./offline.html'))
        )
    );
    return;
  }

  // Same-origin static assets — cache-first
  if (isSameOrigin) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(APP_SHELL_CACHE).then(c => c.put(request, copy)).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  // CDN assets — stale-while-revalidate
  if (isCDN) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(cache =>
        cache.match(request).then(cached => {
          const fetchPromise = fetch(request)
            .then(res => {
              if (res && res.status === 200) cache.put(request, res.clone()).catch(() => {});
              return res;
            })
            .catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
  }
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});