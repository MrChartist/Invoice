/* Mr. Chartist Invoice — app-shell service worker.
 *
 * - Same-origin only: fonts are self-hosted (src/fonts.css), and requests to any other origin are
 *   never intercepted or cached. No other network calls.
 * - Navigations: network-first (3.5s budget) -> cached index.html, so SPA deep links such as
 *   /invoice/abc open offline. The shell is refreshed on every successful navigation.
 * - /assets/* (fingerprinted by Vite): cache-first; discovered at runtime and also precached
 *   from the index.html at install time.
 * - Install precaches EVERY file listed in /precache-manifest.json (written at build time by
 *   scripts/gen-precache.mjs), so every route, including lazy chunks never visited online,
 *   works offline after one visit. Without the manifest it falls back to discovering assets
 *   from index.html.
 * - Share target (8.20 / 8.23): a POST to /share-target (the installed app picked in the phone's share
 *   sheet) is answered here: each file goes into the `mci-share` cache on this device and the page
 *   is redirected to /share-target, which reads and clears them (src/lib/share-inbox.ts). Nothing is
 *   sent anywhere.
 * - Updates: a new worker waits until the page posts {type:'SKIP_WAITING'} (UpdateToast).
 *   BUILD_ID is stamped at build time so sw.js changes bytes on every deploy.
 * - Language packs (R16-A1): the manifest's `files` leave out the Hindi / regional chunks (`langs`). The page posts
 *   {type:'lang', lang} on boot and on every switch; the worker keeps the choice as a synthetic `/__lang__` entry in
 *   the `mci-lang` cache and caches that language's pack at once (online), replying {complete} on the message port.
 *   Install also caches the pack of the language stored by the previous worker, so a Hindi device stays Hindi
 *   offline across updates. A pack that fails to download never rejects the core install; the next message retries.
 *   QA19 U1: a device whose worker never recorded a language (it ran a release older than R16-A, where Hindi was
 *   inside every chunk) gets EVERY pack on that one update, so a Hindi device opened offline after it stays Hindi;
 *   the packs it does not use are pruned on a later update, once the page has told the worker its language.
 * - Asset pruning (QA19 U2): activate deletes /assets/ files that neither this build nor the build it replaces lists
 *   (core files, plus the device's language pack — every pack while the language is unknown). The replaced build is
 *   kept so a tab still running it can load its lazy chunks. A shell cache without a manifest copy (a pre-R16 build,
 *   or the no-manifest fallback install) means its files are unknown: nothing is pruned on that activation.
 */
const BUILD_ID = '__BUILD_ID__';
const SHELL_CACHE = `mci-shell-${BUILD_ID}`;
const ASSET_CACHE = 'mci-assets'; // fingerprinted files never collide, so it survives versions
const SHARE_CACHE = 'mci-share'; // files shared into the app, until /share-target reads them
const LANG_CACHE = 'mci-lang'; // `/__lang__`: this device's interface language (survives versions)
const KEEP = [SHELL_CACHE, ASSET_CACHE, SHARE_CACHE, LANG_CACHE];
const LANG_URL = '/__lang__';
const MANIFEST_URL = '/__manifest__'; // this build's precache manifest, kept in its shell cache
const MAX_SHARED_FILES = 10;
const MAX_SHARED_BYTES = 200 * 1024 * 1024;
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
  const manifest = await res.clone().json();
  await shell.put(MANIFEST_URL, res);
  // allSettled, not all: every fetch/put must have finished before a failed install deletes the
  // half-filled shell cache, or a straggling put could leave it behind.
  const results = await Promise.allSettled(
    manifest.files.map(async (url) => {
      const r = await fetch(new Request(url, { cache: 'reload' }));
      if (!r.ok) throw new Error('precache ' + url + ' ' + r.status);
      // Fingerprinted assets live in the long-lived cache; the shell cache is per build.
      if (url.startsWith('/assets/')) await assets.put(url, r);
      else if (url === '/' || url === '/index.html') await shell.put(SHELL_URL, r);
      else await shell.put(url, r);
    }),
  );
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      const assets = await caches.open(ASSET_CACHE);
      try {
        await precacheManifest(shell, assets);
        // Keep this device's language pack across the update (best effort: never fails the install). Language not
        // recorded but an older build installed (U1): its page never told us, so cache every pack this once.
        const lang = await deviceLang();
        const older = (await caches.keys()).some((n) => n.startsWith('mci-shell-') && n !== SHELL_CACHE);
        await cachePacks(lang ? [packOf(lang)] : older ? ['hi', 'regional'] : [], shell).catch(() => false);
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
      await pruneAssets().catch(() => undefined); // before the old shell (and its manifest copy) is deleted
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('mci-') && !KEEP.includes(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/** The language pack a language needs: Hindi has its own; the other regional languages share one. */
const packOf = (lang) => (lang === 'hi' ? 'hi' : lang && lang !== 'en' ? 'regional' : null);

/** The language the page last told a worker on this device, or null when none was ever recorded. */
async function deviceLang() {
  const hit = await (await caches.open(LANG_CACHE)).match(LANG_URL);
  return hit ? (await hit.text()).trim() || null : null;
}

/**
 * U2: delete fingerprinted files that neither this build nor the one it replaces lists. Every `mci-shell-*` cache
 * still present is one of the two; if any of them has no manifest copy its files are unknown, so nothing is deleted.
 */
async function pruneAssets() {
  const lang = await deviceLang();
  const keep = new Set();
  for (const name of (await caches.keys()).filter((n) => n.startsWith('mci-shell-'))) {
    const hit = await (await caches.open(name)).match(MANIFEST_URL);
    if (!hit) return;
    const m = await hit.json();
    for (const url of m.files || []) keep.add(url);
    for (const [pack, urls] of Object.entries(m.langs || {})) if (!lang || pack === packOf(lang)) for (const url of urls) keep.add(url);
  }
  if (!keep.size) return;
  const assets = await caches.open(ASSET_CACHE);
  for (const req of await assets.keys()) if (!keep.has(new URL(req.url).pathname)) await assets.delete(req);
}

/** This build's manifest: the copy kept at install, else the network. */
async function readManifest(shell) {
  const hit = await shell.match(MANIFEST_URL);
  if (hit) return hit.json();
  const res = await fetch('/precache-manifest.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('precache manifest ' + res.status);
  return res.json();
}

/** Caches the missing files of the given packs. Resolves true when they are all cached. */
async function cachePacks(packs, shell) {
  packs = packs.filter(Boolean);
  if (!packs.length) return true;
  const manifest = await readManifest(shell || (await caches.open(SHELL_CACHE)));
  const urls = packs.flatMap((pack) => (manifest.langs && manifest.langs[pack]) || []);
  const assets = await caches.open(ASSET_CACHE);
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      if (await assets.match(url)) return;
      const r = await fetch(url);
      if (!r.ok) throw new Error('language pack ' + url + ' ' + r.status);
      await assets.put(url, r);
    }),
  );
  return results.every((r) => r.status === 'fulfilled');
}

async function onLang(lang, port) {
  let complete = false;
  try {
    await (await caches.open(LANG_CACHE)).put(LANG_URL, new Response(String(lang), { headers: { 'content-type': 'text/plain' } }));
    complete = await cachePacks([packOf(lang)]);
  } catch {
    complete = false; // offline with no manifest copy, storage full …: the page decides (offline → stays as it was)
  }
  if (port) port.postMessage({ complete });
}

self.addEventListener('message', (event) => {
  const d = event.data;
  if (d === 'SKIP_WAITING' || (d && d.type === 'SKIP_WAITING')) self.skipWaiting();
  else if (d && d.type === 'lang' && typeof d.lang === 'string' && /^[a-z]{2}$/.test(d.lang)) {
    event.waitUntil(onLang(d.lang, event.ports && event.ports[0]));
  }
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function handleNavigation(request) {
  const shell = await caches.open(SHELL_CACHE);
  const cached = await shell.match(SHELL_URL);
  const network = fetch(request).then(async (res) => {
    const type = res.headers.get('content-type') || '';
    // Only an SPA route (no file extension) is the app shell; /offline.html etc. must never replace it.
    const isSpaRoute = !/\.[a-z0-9]+$/i.test(new URL(request.url).pathname);
    if (res.ok && isSpaRoute && type.includes('text/html')) await safePut(shell, SHELL_URL, res.clone());
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

/**
 * Fingerprinted assets: cache-first, never trimmed at runtime (R16-A1): the asset cache holds the precached build,
 * and a language-pack chunk fetched on a miss must not evict the precached core.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await safePut(cache, request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then(async (res) => {
      // Same-origin only (see the fetch handler): cache successful responses, never errors.
      if (res.ok) {
        await safePut(cache, request, res.clone());
        trim(cache, max);
      }
      return res;
    })
    .catch(() => undefined);
  if (hit) return hit;
  return (await refresh) || Response.error();
}

/** Web Share Target: keep the shared files on the device, then open /share-target. */
async function receiveShare(request) {
  let n = 0;
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    for (const old of await cache.keys()) await cache.delete(old);
    for (const f of form.getAll('file')) {
      if (n >= MAX_SHARED_FILES || typeof f === 'string' || !f || f.size > MAX_SHARED_BYTES) continue;
      const headers = { 'content-type': f.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name || 'shared-file') };
      await cache.put(`/__share/${n}`, new Response(f, { headers }));
      n++;
    }
  } catch {
    /* unreadable form / storage full: the page says nothing was received */
  }
  return Response.redirect(new URL(`/share-target?n=${n}`, self.location.origin).href, 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share-target') {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET' || request.headers.has('range')) return;

  if (url.origin !== self.location.origin) return; // never touch other origins
  if (url.pathname === '/sw.js' || url.pathname === '/precache-manifest.json') return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
  // logo, manifest, icons, etc.
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE, 80));
});
