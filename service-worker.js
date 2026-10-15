/* Mochi's Room — Service Worker with FCM + offline caching */

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCpxlMZiAcJwI2RuNTJ14jSaHhV-nBcW7A",
  authDomain: "mochigotchi.firebaseapp.com",
  databaseURL: "https://mochigotchi-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mochigotchi",
  storageBucket: "mochigotchi.firebasestorage.app",
  messagingSenderId: "441429859962",
  appId: "1:441429859962:web:d0a5e1af080bb394a725c3"
});

const messaging = firebase.messaging();

/* ---------- Background push handler ---------- */
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message received:', payload);

  const title = (payload.notification && payload.notification.title) || "🐉 Mochi's Room";
  const body = (payload.notification && payload.notification.body) || 'Something happened!';
  const icon = (payload.notification && payload.notification.icon) || './icon-192.png';

  const options = {
    body: body,
    icon: icon,
    badge: './icon-192.png',
    tag: (payload.data && payload.data.tag) || 'mochi-diary',
    data: payload.data || {},
    vibrate: [100, 50, 100],
    requireInteraction: false,
    renotify: false
  };

  self.registration.showNotification(title, options);
});

/* ---------- Handle notification tap ---------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('index.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./index.html');
      }
    })
  );
});

/* ---------- Offline caching ---------- */
const VERSION = 'mochi-v1.0.1';
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
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCDN = CDN_ORIGINS.some(o => url.href.startsWith(o));

  // Firebase realtime DB + FCM endpoints — never cache
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('firebasedatabase.app') ||
      url.hostname.includes('fcmregistrations.googleapis.com') ||
      url.hostname.includes('firebaseinstallations.googleapis.com')) {
    return;
  }

  if (!isSameOrigin && !isCDN) return;
  if (!url.protocol.startsWith('http')) return;

  // Navigation — network-first with offline fallback
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

  // Same-origin assets — cache-first
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
