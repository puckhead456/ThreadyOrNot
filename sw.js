'use strict';

/* Thready or Not service worker.

   CACHE_VERSION is GENERATED — do not hand-edit it. `tools/sw-version.sh`
   hashes every file in PRECACHE_URLS (plus this file, minus the version line)
   and rewrites the line below; `.githooks/pre-commit` runs it when a precached
   file is staged, and the Pages workflow fails the deploy if the two disagree.

   Strategies (see swPolicy below, which is pure and unit-testable):
     production  navigation      network-first, cached index.html when offline
                 same-origin     stale-while-revalidate (serve cached, refresh
                                 in the background) so a missed version bump
                                 still heals on the next load
                 Google Fonts    stale-while-revalidate
     localhost   everything      network-first, cache only as an offline
                 (dev)           fallback, and nothing is precached — no
                                 "clear the service worker" ritual, ever
     any host    /tmp-pdf/ /test/  never touched by the cache at all
*/
const CACHE_VERSION = 'h88170bb98e';
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
  './js/diagram-geo.js',
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

/* Paths the cache must never touch, on any host: the gitignored fixture PDFs
   (~90 MB of copyrighted files) and the test pages that read them. */
const NEVER_CACHE_RE = /(^|\/)(tmp-pdf|test)\//;

/* Local development: the service worker must never get between an agent (or the
   owner) and a file they just edited. */
const IS_DEV = ['localhost', '127.0.0.1', '[::1]', '::1'].indexOf(self.location.hostname) !== -1;

/* The set of pathnames we are willing to WRITE to the cache: the precached
   shell plus icons. Everything else same-origin is served but never stored, so
   the cache cannot grow without bound (it once held 14 MB of fixture PDFs). */
const PRECACHE_PATHS = (function () {
  const set = Object.create(null);
  for (const u of PRECACHE_URLS) {
    try {
      set[new URL(u, self.location.href).pathname] = true;
    } catch (err) {
      /* ignore a malformed entry */
    }
  }
  return set;
})();

const SCOPE_PATH = new URL('./', self.location.href).pathname;

/* ------------------------------------------------------------------ *
 * swPolicy — the whole routing decision, as one pure function.
 *
 * Pure so it can be tested without a service worker: pass fake values for
 * `origin` / `dev` and it answers the same way the fetch handler will.
 *
 * @param {{url:string, mode?:string, method?:string, origin?:string, dev?:boolean}} input
 * @returns {{strategy:'skip'|'navigate'|'network-first'|'swr', store:boolean}}
 *   strategy 'skip' = do not call respondWith at all (plain network).
 *   store = may a fresh network response be written to the cache?
 * ------------------------------------------------------------------ */
function swPolicy(input) {
  const method = (input.method || 'GET').toUpperCase();
  if (method !== 'GET') return { strategy: 'skip', store: false };

  const origin = input.origin || self.location.origin;
  const dev = typeof input.dev === 'boolean' ? input.dev : IS_DEV;

  let url;
  try {
    url = new URL(input.url, origin);
  } catch (err) {
    return { strategy: 'skip', store: false };
  }

  // Fixtures and test pages: never cached, never served from cache, any host.
  if (NEVER_CACHE_RE.test(url.pathname)) return { strategy: 'skip', store: false };

  const sameOrigin = url.origin === origin;
  const isFont = FONT_HOSTS.indexOf(url.hostname) !== -1;

  // Dev: nothing is cached at all. Same-origin is network-first (cache is only
  // ever an offline fallback and is normally empty); fonts and other
  // cross-origin requests are left to the browser.
  if (dev) {
    if (!sameOrigin) return { strategy: 'skip', store: false };
    if (input.mode === 'navigate') return { strategy: 'navigate', store: false };
    return { strategy: 'network-first', store: false };
  }

  if (input.mode === 'navigate') return { strategy: 'navigate', store: true };
  if (isFont) return { strategy: 'swr', store: true };
  if (sameOrigin) {
    return { strategy: 'swr', store: cacheablePath(url.pathname) };
  }
  return { strategy: 'skip', store: false };
}

/** Is this same-origin pathname one we are willing to store? */
function cacheablePath(pathname) {
  if (PRECACHE_PATHS[pathname]) return true;
  if (pathname.indexOf(SCOPE_PATH + 'icons/') === 0) return true;
  return false;
}

// Exposed for the manual/unit check in test/sw.test.html (harmless otherwise).
self.swPolicy = swPolicy;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (!IS_DEV) {
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
      } else {
        console.info('[sw] dev mode (' + self.location.hostname + '): nothing precached.');
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      // Dev throws everything away, so a cache left over from testing a
      // production build can never serve a stale file on localhost.
      await Promise.all(
        names
          .filter((name) => IS_DEV || name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: CACHE_VERSION, dev: IS_DEV });
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const policy = swPolicy({
    url: request.url,
    mode: request.mode,
    method: request.method,
  });

  switch (policy.strategy) {
    case 'navigate':
      event.respondWith(networkFirstNavigate(request, policy.store));
      return;
    case 'network-first':
      event.respondWith(networkFirst(request, policy.store));
      return;
    case 'swr':
      event.respondWith(staleWhileRevalidate(request, policy.store, event));
      return;
    default:
      // 'skip': let it hit the network unmediated.
      return;
  }
});

async function networkFirstNavigate(request, store) {
  try {
    const networkResponse = await fetch(request);
    if (store && networkResponse && networkResponse.ok) {
      // Only open the cache when there is something to write, so dev (where
      // store is always false) never creates a cache at all.
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = (await caches.match(request)) || (await caches.match('./index.html'));
    if (cached) return cached;
    throw err;
  }
}

/* Dev: always ask the network, fall back to whatever is cached only when the
   request actually fails (offline). Nothing is written to the cache. */
async function networkFirst(request, store) {
  try {
    const networkResponse = await fetch(request);
    if (store && networkResponse && networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

/* Serve the cached copy immediately, then refresh it in the background. A
   forgotten CACHE_VERSION bump therefore heals itself on the next load instead
   of pinning an installed user to an old build forever. */
async function staleWhileRevalidate(request, store, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((networkResponse) => {
      // Opaque (type 'opaque') cross-origin responses have status 0 but are safe to cache.
      if (store && networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => cached);

  if (cached) {
    // Do not let the page's response wait on the revalidation, but do keep the
    // worker alive long enough for it to finish.
    if (event && typeof event.waitUntil === 'function') {
      try {
        event.waitUntil(networkFetch);
      } catch (err) {
        /* the event may already have settled; the refresh is best-effort */
      }
    }
    return cached;
  }
  return networkFetch;
}
