'use strict';

/* Stitchkeeper service worker.
   Bump CACHE_VERSION whenever any precached file changes. */
const CACHE_VERSION = 'v12';
const CACHE_NAME = 'stitchkeeper-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/themes.css',
  './css/xstitch.css',
  './css/sewing.css',
  './js/themes.js',
  './js/patterns.js',
  './js/pdftext.js',
  // pdf.js is lazy-loaded by PdfText, but precached so PDF import works offline.
  './js/vendor/pdf.min.js',
  './js/vendor/pdf.worker.min.js',
  './js/celebrate.js',
  './js/diagram.js',
  './js/audio.js',
  './js/store.js',
  './js/tour.js',
  // Crafts (docs/CRAFTS.md). A craft file that has not landed yet simply fails
  // its own cache.add above and the rest of the install carries on.
  './js/blobstore.js',
  './js/xstitch.js',
  './js/xstitch-photo.js',
  './js/sewing.js',
  './js/app.js',
  './js/app-xstitch.js',
  './js/app-sewing.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // One at a time, and each in its own try: a single missing (or slow —
      // pdf.worker.min.js is a megabyte) file must not fail the whole install.
      for (const url of PRECACHE_URLS) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('[sw] precache failed for', url, err);
        }
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Navigation requests: network-first, fallback to cached index.html.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigate(request));
    return;
  }

  // Google Fonts: stale-while-revalidate (opaque responses are fine to cache).
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Same-origin: cache-first, then network (and populate cache).
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else: just let it hit the network.
});

async function networkFirstNavigate(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await cache.match('./index.html');
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((networkResponse) => {
      // Opaque (type 'opaque') cross-origin responses have status 0 but are safe to cache.
      if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => cached);

  return cached || networkFetch;
}
