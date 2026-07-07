// ============================================================================
// Planners Dashboard — service worker (offline resilience for site connectivity).
// ----------------------------------------------------------------------------
// Strategy is NETWORK-FIRST and safe by construction:
//   • Only same-origin GET requests are handled. Writes (POST/PATCH/DELETE) and
//     ALL cross-origin requests (Supabase REST/auth) pass straight through —
//     never cached, never queued — so data operations are unaffected.
//   • Online: always fetch from the network first (so the app is never stale),
//     then update the cache in the background.
//   • Offline: fall back to the last cached copy (app shell + last-seen data
//     GETs), and to the last cached page for navigations.
// Because it tries the network first, this can only ADD an offline fallback —
// it cannot serve stale content while online. Bump CACHE to force a purge.
// ============================================================================
var CACHE = 'pd-shell-v1';

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                                   // never touch writes
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;                    // never cache Supabase / CDNs
  e.respondWith((async function () {
    try {
      var res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        var c = await caches.open(CACHE);
        c.put(req, res.clone());                                      // refresh cache on every success
      }
      return res;
    } catch (err) {
      var cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {                                  // offline navigation → last cached page
        var page = await caches.match(url.pathname) || await caches.match(url.href);
        if (page) return page;
      }
      throw err;
    }
  })());
});
