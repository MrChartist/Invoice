/* MrChartist Invoice — service worker.
 *
 * Strategy
 *  - install : fetch /precache-manifest.json (written by scripts/gen-precache.mjs) and cache
 *              EVERY listed file, so every route/lazy chunk works offline after the first visit.
 *  - navigate: network-first (fresh deploys win when online), falling back to the cached SPA
 *              shell for any path (deep links like /invoice/abc), then /offline.html.
 *  - assets  : cache-first (hashed filenames are immutable), runtime-cached when missing.
 *  - never   : /sw.js and /precache-manifest.json are never served from or written to cache;
 *              cross-origin requests (Google Fonts) are not intercepted, so offline they simply
 *              fail and the page renders with fallback fonts.
 *  - updates : BUILD_ID is stamped by gen-precache.mjs, so sw.js bytes change every build.
 *              The new worker waits until the page asks (postMessage 'SKIP_WAITING'), so a
 *              running page never loses the hashed chunks it still needs.
 */
const BUILD_ID = '__BUILD_ID__';
const PREFIX = 'mci-';
const CACHE = PREFIX + BUILD_ID;
const SHELL = '/'; // index.html is fetched/stored as "/" (avoids redirected responses)
const NEVER_CACHE = new Set(['/sw.js', '/precache-manifest.json']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch('/precache-manifest.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('precache manifest ' + res.status);
      const manifest = await res.json();
      const cache = await caches.open(CACHE);
      // addAll is atomic: if one file fails (or storage is full) the install fails,
      // the old worker stays in charge and we retry on the next visit.
      try {
        await cache.addAll(
          manifest.files.map((u) => new Request(u, { cache: 'reload' })),
        );
      } catch (err) {
        await caches.delete(CACHE); // don't leave a half-filled cache behind (quota / 404 / offline)
        throw err;
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

async function safePut(cache, request, response) {
  try {
    await cache.put(request, response);
  } catch {
    /* QuotaExceededError etc. — serving the response matters more than caching it. */
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.has(url.pathname)) return; // straight to network, browser HTTP cache rules apply

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const net = await fetch(req);
          // Cache a fresh shell for the root document only.
          if (net.ok && url.pathname === '/') {
            const cache = await caches.open(CACHE);
            await safePut(cache, SHELL, net.clone());
          }
          return net;
        } catch {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(SHELL)) ||
            (await cache.match('/offline.html')) ||
            new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const net = await fetch(req);
      // Only cache complete, same-origin 200s (never 206 partials or errors).
      if (net.ok && net.status === 200 && url.pathname.startsWith('/assets/')) {
        await safePut(cache, req, net.clone());
      }
      return net;
    })(),
  );
});
