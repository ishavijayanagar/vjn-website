/* Sandesha PWA — minimal SW for installability; network-first for everything */
const CACHE = 'sandesha-shell-v18';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API / auth / live data — network only
  const path = url.pathname;
  const isShell =
    path === '/' ||
    path === '/index.html' ||
    path === '/manifest.webmanifest' ||
    path === '/sw.js' ||
    path.startsWith('/css/') ||
    path.startsWith('/js/') ||
    path.startsWith('/icons/') ||
    path === '/config.js';

  if (!isShell) return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && path !== '/config.js') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
  );
});
