const CACHE = 'tim-v6';
const PRECACHE = [
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/barcodes/JsBarcode.code128.min.js',
  './manifest.json',
  './styles.css',
  './app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith('http')) return;
  const url = new URL(e.request.url);
  // GitHub API calls (data sync) must never be cached — always live
  if (url.hostname === 'api.github.com' || url.hostname === 'raw.githubusercontent.com') return;
  const isCdn = url.hostname !== self.location.hostname;

  if (isCdn) {
    // Cache-first for CDN assets — version-locked, safe to serve stale
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok && res.status < 400) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => cached);
      })
    );
  } else {
    // Network-first for all local files (HTML, CSS, JS) — always fetch latest;
    // fall back to cache when offline. The network fetch uses cache:'no-store'
    // so it bypasses the BROWSER HTTP cache: a stale HTTP-cached app.js was
    // defeating in-app updates (the version check saw the new build, but the
    // reload kept loading the old one from disk cache). The fresh response is
    // still copied into the SW cache for offline use.
    e.respondWith(
      fetch(e.request.url, { cache: 'no-store' }).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
  }
});
