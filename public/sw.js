/* Mr. Chartist Invoice — app-shell service worker.
 *
 * - Same-origin only (plus Google Fonts, stale-while-revalidate). No other network calls.
 * - Navigations: network-first (3.5s budget) -> cached index.html, so SPA deep links such as
 *   /invoice/abc open offline. The shell is refreshed on every successful navigation.
 * - /assets/* (fingerprinted by Vite): cache-first; discovered at runtime and also precached
 *   from the index.html at install time.
 * - Install precaches EVERY file listed in /precache-manifest.json (written at build time by
 *   scripts/gen-precache.mjs), so every route, including lazy chunks never visited online,
 *   works offline after one visit. Without the manifest it falls back to discovering assets
 *   from index.html.
 * - Updates: a new worker waits until the page posts {type:'SKIP_WAITING'} (UpdateToast).
 *   BUILD_ID is stamped at build time so sw.js changes bytes on every deploy.
 */
const BUILD_ID = '__BUILD_ID__';
const SHELL_CACHE = `mci-shell-${BUILD_ID}`;
const ASSET_CACHE = 'mci-assets'; // fingerprinted files never collide, so it survives versions
const KEEP = [SHELL_CACHE, ASSET_CACHE];
const MAX_ASSETS = 160;
const NAV_TIMEOUT_MS = 3500;
const SHELL_URL = '/index.html';
const PRECACHE = ['/manifest.json', '/logo.png', '/offline.html'];


/** Pulls same-origin /assets/... URLs out of the built index.html. */
function discoverAssets(html) {
  const found = new Set();
  const re = /(?:src|href)=["'](\/assets\/[^"'?#]+)["']/g;
  let m;
  while ((m = re.exec(html))) found.add(m[1]);
  return [...found];
}

/** cache.put can throw QuotaExceededError; serving the response matters more than caching it. */
async function safePut(cache, request, response) {
  try {
    await cache.put(request, response);
  } catch {
    /* storage full — carry on without caching */
  }
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

/** Fetches every manifest file into the right cache. Throws if any file fails (install retried later). */
class ManifestMissing extends Error {}

async function precacheManifest(shell, assets) {
  const res = await fetch('/precache-manifest.json', { cache: 'no-store' });
  if (!res.ok) throw new ManifestMissing('precache manifest ' + res.status);
  const manifest = await res.json();
  await Promise.all(
    manifest.files.map(async (url) => {
      const r = await fetch(new Request(url, { cache: 'reload' }));
      if (!r.ok) throw new Error('precache ' + url + ' ' + r.status);
      // Fingerprinted assets live in the long-lived cache; the shell cache is per build.
      if (url.startsWith('/assets/')) await assets.put(url, r);
      else if (url === '/' || url === '/index.html') await shell.put(SHELL_URL, r);
      else await shell.put(url, r);
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      const assets = await caches.open(ASSET_CACHE);
      try {
        await precacheManifest(shell, assets);
        return;
      } catch (err) {
        if (!(err instanceof ManifestMissing)) {
          // The manifest exists but a listed file failed (404 / quota / dropped connection):
          // reject the install so the old worker keeps serving a complete cache, and drop the
          // half-filled per-build shell cache. Fingerprinted assets already stored are harmless.
          await caches.delete(SHELL_CACHE);
          throw err;
        }
        // No manifest at all (e.g. dev server): fall back to discovering assets from index.html.
      }
      try {
        const res = await fetch('/', { cache: 'reload' });
        if (res.ok) {
          const copy = res.clone();
          await shell.put(SHELL_URL, res);
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
  const d = event.data;
  if (d === 'SKIP_WAITING' || (d && d.type === 'SKIP_WAITING')) self.skipWaiting();
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function handleNavigation(request) {
  const shell = await caches.open(SHELL_CACHE);
  const cached = await shell.match(SHELL_URL);
  const network = fetch(request).then(async (res) => {
    const type = res.headers.get('content-type') || '';
    if (res.ok && type.includes('text/html')) await safePut(shell, SHELL_URL, res.clone());
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
    await safePut(cache, request, res.clone());
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
        await safePut(cache, request, res.clone());
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

  if (url.origin !== self.location.origin) return; // never touch other origins
  if (url.pathname === '/sw.js' || url.pathname === '/precache-manifest.json') return;

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
