/* Mr. Chartist Invoice — app-shell service worker.
 *
 * - Same-origin only (plus Google Fonts, stale-while-revalidate). No other network calls.
 * - Navigations: network-first (3.5s budget) -> cached index.html, so SPA deep links such as
 *   /invoice/abc open offline. The shell is refreshed on every successful navigation.
 * - /assets/* (fingerprinted by Vite): cache-first; discovered at runtime and also precached
 *   from the index.html at install time.
 * - Updates: a new worker waits until the page posts {type:'SKIP_WAITING'} (UpdateToast).
 * Bump SW_VERSION to force a clean shell cache.
 */
const SW_VERSION = 'v1';
const SHELL_CACHE = `mci-shell-${SW_VERSION}`;
const ASSET_CACHE = 'mci-assets'; // fingerprinted files never collide, so it survives versions
const FONT_CACHE = 'mci-fonts';
const KEEP = [SHELL_CACHE, ASSET_CACHE, FONT_CACHE];
const MAX_ASSETS = 160;
const MAX_FONTS = 60;
const NAV_TIMEOUT_MS = 3500;
const SHELL_URL = '/index.html';
const PRECACHE = ['/manifest.json', '/logo.png', '/offline.html'];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/** Pulls same-origin /assets/... URLs out of the built index.html. */
function discoverAssets(html) {
  const found = new Set();
  const re = /(?:src|href)=["'](\/assets\/[^"'?#]+)["']/g;
  let m;
  while ((m = re.exec(html))) found.add(m[1]);
  return [...found];
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      try {
        const res = await fetch('/', { cache: 'reload' });
        if (res.ok) {
          const copy = res.clone();
          await shell.put(SHELL_URL, res);
          const assets = await caches.open(ASSET_CACHE);
          await Promise.all(
            discoverAssets(await copy.text()).map((url) =>
              fetch(url).then((r) => (r.ok ? assets.put(url, r) : undefined)).catch(() => undefined),
            ),
          );
        }
      } catch {
        /* offline during install: the shell is cached on first successful navigation */
      }
      await Promise.all(
        PRECACHE.map((url) =>
          fetch(url).then((r) => (r.ok ? shell.put(url, r) : undefined)).catch(() => undefined),
        ),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('mci-') && !KEEP.includes(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function handleNavigation(request) {
  const shell = await caches.open(SHELL_CACHE);
  const cached = await shell.match(SHELL_URL);
  const network = fetch(request).then(async (res) => {
    const type = res.headers.get('content-type') || '';
    if (res.ok && type.includes('text/html')) await shell.put(SHELL_URL, res.clone());
    return res;
  });
  try {
    // With a cached shell, don't let a slow network hold the page hostage.
    return cached ? await Promise.race([network, timeout(NAV_TIMEOUT_MS)]) : await network;
  } catch {
    network.catch(() => undefined); // swallow a late rejection
    return cached || (await shell.match('/offline.html')) || Response.error();
  }
}

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    trim(cache, max);
  }
  return res;
}

async function staleWhileRevalidate(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then(async (res) => {
      // Opaque (no-cors) font responses report status 0; cache those, never errors.
      if (res.ok || res.type === 'opaque') {
        await cache.put(request, res.clone());
        trim(cache, max);
      }
      return res;
    })
    .catch(() => undefined);
  if (hit) return hit;
  return (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;

  const url = new URL(request.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE, MAX_FONTS));
    return;
  }
  if (url.origin !== self.location.origin) return; // never touch other origins
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE, MAX_ASSETS));
    return;
  }
  // logo, manifest, icons, etc.
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE, 80));
});
