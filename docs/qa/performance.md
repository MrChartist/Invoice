# Performance, offline and security-header QA

Measured on the production build (`vite build`, Vite 8 / rolldown) at base commit `c9dfa2f`, headless
Chromium 1194 via Playwright 1.56, served from loopback with the headers in `public/_headers`.
Re-run everything with:

```bash
npm run build
npm run check:size                 # bundle budgets (gzip)
node scripts/verify-offline.mjs    # service worker / offline / update / CSP-on-routes (exit 1 on failure)
node tests/perf/run.mjs            # load, memory (300 invoices), typing latency, CSP sweep (PDF, QR, logo, SW)
THROTTLE=1 node tests/perf/run.mjs # same under ~Fast 4G (40 ms RTT, 1.6 Mbit/s) + 4x CPU slowdown
DIST_DIR=/path/to/other/dist node tests/perf/run.mjs   # compare another build
```

None of these are part of `npm test`. Playwright is deliberately not a project dependency (resolved
from the global install, or `npm i -D playwright` locally).

## 1. Bundle size

The "457 kB main chunk" in the brief does not exist at this commit: the entry chunk was 130 kB. The real
problem was different: `InvoicePreview.tsx` statically imports `jspdf` + `html-to-image` and the old
`manualChunks` put them into `vendor-pdf` (613 kB raw / 181 kB gz), which `index.html` then
`modulepreload`ed. So the **PDF stack was downloaded and parsed on every first paint**, even on the login page.
`framer-motion` was named in `manualChunks` but is neither installed nor imported (dead reference, removed).

| JS needed before first paint | raw | gzip |
|---|---|---|
| Before (HEAD) | 1001 kB | 295 kB |
| After `vite.config.ts` change only (this branch) | 807 kB | 241 kB |
| After config + the two `src/` diffs below (measured on a scratch copy) | 277 kB | ~90 kB |

Total JS (everything, incl. lazy chunks) is ~345-361 kB gz in all variants; it simply is no longer on the
critical path.

Per-chunk, before: `index` 130.5 / 29.8 gz, `vendor-react` 229.8 / 73.4, `vendor-ui` 27.4 / 10.1,
`vendor-pdf` 613.1 / 181.5, `index.es` (jspdf's canvg) 151.4 / 48.9, `purify` 22.4 / 8.8.
After config+src: `index` 17.0 / 5.0, `vendor-react` 230.9 / 73.8, `vendor-ui` 28.3 / 10.5, five route chunks
(2-21 kB gz each), `jspdf` 399.6 / 129.7, `html2canvas` 199.6 / 46.8, `index.es` 151.4 / 48.9, `purify` 22.4 / 8.8
(the last four are loaded only on first "Download PDF").

### What changed in `vite.config.ts`
- Vendor chunks only for `react*` and `lucide-react`/`qrcode.react`/`zustand`/`clsx` (long-term cacheable).
- **No manual chunk for the PDF stack.** Tried it: rolldown hoists a shared CJS-interop helper into
  `vendor-pdf`, so `vendor-react` imports from it and the PDF chunk is preloaded anyway (+180 kB gz).
  Letting `import()` split it naturally gives clean lazy chunks.
- `target: 'es2022'`, `chunkSizeWarningLimit` raised to 650 (jspdf is lazy); real budgets live in
  `scripts/check-bundle-size.mjs` (initial 100 kB gz, entry 6 kB gz, total 400 kB gz, ~10 % over the
  optimised result). `rolldownOptions` retained.

### REQUIRED `src/` diffs (lead applies; CI budget check fails until they land)

1. `src/components/preview/InvoicePreview.tsx` - load the PDF libs on demand:
```diff
-import { toPng } from 'html-to-image';
-import { jsPDF } from 'jspdf';
@@ const handleExportPDF = async () => {
     if (!previewRef.current) return;
     try {
+      const [{ toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
       const dataUrl = await toPng(previewRef.current, { quality: 1, pixelRatio: 3, cacheBust: true });
```
2. `src/App.tsx` - route-level code splitting (all pages are currently eager):
```diff
-import { useState } from 'react';
+import { lazy, Suspense, useState } from 'react';
-import { Dashboard } from './pages/Dashboard';
-import { Transactions } from './pages/Transactions';
-import { InvoiceCreator } from './pages/InvoiceCreator';
-import { Clients } from './pages/Clients';
-import { Settings } from './pages/Settings';
+const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
+const Transactions = lazy(() => import('./pages/Transactions').then(m => ({ default: m.Transactions })));
+const InvoiceCreator = lazy(() => import('./pages/InvoiceCreator').then(m => ({ default: m.InvoiceCreator })));
+const Clients = lazy(() => import('./pages/Clients').then(m => ({ default: m.Clients })));
+const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
@@
-      <Routes>
+      <Suspense fallback={null}><Routes>
@@
-      </Routes>
+      </Routes></Suspense>
```
(Better: put `<Suspense>` inside `DashboardLayout` around its children so the sidebar stays mounted while a
route chunk loads. `react-refresh/only-export-components` is unaffected.) Because `sw.js` precaches every
chunk, lazy routes still work offline.

3. **Register the service worker** (nothing in `src/` or `index.html` registers it today - verified: "app registers
   sw by itself: false"). In `src/main.tsx`, after `render(...)`:
```ts
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // A new build is installed and waiting: tell the user, and on "Reload" do
      //   reg.waiting?.postMessage('SKIP_WAITING'); then location.reload() on 'controllerchange'.
      reg.addEventListener('updatefound', () => { /* optional toast */ });
    }).catch(() => { /* offline support is optional */ });
  });
}
```
   Without the toast the new version simply activates on the next full close/reopen of all tabs.

### Recommended `src/` follow-ups (not required for the budgets)
- **Third-party avatars break offline, leak the user's name and the "no network calls" rule**:
  `src/layouts/DashboardLayout.tsx:96` and `src/pages/InvoiceCreator.tsx:286` load
  `https://api.dicebear.com/7.x/.../svg?seed=<name>`. Under the CSP (`img-src 'self' data: blob:`) they are
  blocked (11-36 violations per session). Replace with a local initials circle, e.g.
  `<span className="avatar">{(name||'?').slice(0,2).toUpperCase()}</span>`. If you must keep it, add
  `https://api.dicebear.com` to `img-src` in all four header files and accept that it is offline-broken.
- `src/index.css:7` `@import url(fonts.googleapis.com...)` duplicates the `<link>` in `index.html` (two requests,
  render-blocking CSS chain). Delete the `@import`. Better still: self-host the 5 font families under
  `public/fonts` (woff2) to make first paint independent of Google and let CSP drop the Google origins.
- `/transactions` with 300 invoices produces 235-280 ms long tasks (unvirtualised table). Window/paginate the list
  (e.g. render 50 rows, "show more"), and memoise the row component.

## 2. Runtime measurements (loopback, desktop CPU)

Load (median of 3 cold loads, no service worker), `/` and `/invoice`:

| | FCP | LCP | CLS | transfer |
|---|---|---|---|---|
| Before, unthrottled | 308-400 / 336-424 ms | 740-816 / 768-872 ms | 0 | 1002 kB |
| After config+src, unthrottled | 536-620 / 560-692 ms | 968-1084 / 988-1124 ms | 0 | 305-364 kB |
| Before, Fast 4G + 4x CPU | 5880 / 6120 ms | 6328 / 6580 ms | 0 | 1002 kB |
| After config+src, Fast 4G + 4x CPU | 2600 / 3416 ms | 3080 / 3984 ms | 0 | 305-364 kB |

Honest caveat: on loopback (zero latency, unlimited bandwidth) the lazy version is ~150-250 ms *slower* to FCP, because
routes now load as a request waterfall (entry, then route chunk, then its shared chunks) and nothing is saved by
sending fewer bytes. On the throttled profile (the realistic one) first paint drops from ~5.9 s to ~2.6 s (-56 %). With
the service worker installed, repeat visits are served from cache and the waterfall disappears. If the loopback
regression matters, mitigate by adding `import('./pages/Dashboard')` prefetch in an idle callback after first render,
or keep `Dashboard` eager and lazy-load only the other routes. CLS is 0 on both
screens. Google Fonts are unreachable in this sandbox (expected, requests aborted by the harness).

SPA route transitions (click nav link to painted route): 80-125 ms before; 110-210 ms after lazy routes on the first visit to
each route (one chunk fetch), then instant. Use `<Suspense>` inside the layout to avoid a blank flash.

300 invoices (seeded via localStorage, 422 kB JSON): JS heap 7.0 MB on `/`, 9.8-10.3 MB on `/transactions`,
6.6 MB on `/clients` (empty-store baseline 5.8-6.3 MB). No leaks or page errors. Long tasks: `/` 54 ms, `/clients` 72 ms,
`/transactions` 180-280 ms (see follow-up above). Reading and `JSON.parse`-ing the whole table on every render is
the likely cost; cache the parsed table in the store.

**Typing latency, `/invoice` with 20 line items** (keydown to next painted frame, 48 keystrokes):
median 14.9-17.7 ms, p95 23-40 ms, max 34-53 ms (budget 50 ms: met). With 4x CPU throttling median 52 ms, p95 73-75 ms.
Cause of the headroom problem: **the whole editor re-renders on every keystroke** because
`src/pages/InvoiceCreator.tsx:14` does `const invoice = useInvoiceStore();` (no selector, subscribes to the
entire store) and `src/components/preview/InvoicePreview.tsx:58` does the same even while the preview modal is
closed (`return null` happens after the hooks, so it also re-renders and re-runs its `useMemo`). Every `updateItem`
produces a new store object, so all 20 rows, the client form and the totals re-render for one character.
Suggested fix (src, not required): split rows into `React.memo(ItemRow)` that select their own item
(`useInvoiceStore(s => s.items.find(i => i.id === id))`, with `useShallow` where an object is returned),
select actions individually (`useInvoiceStore(s => s.updateItem)`), and render `<InvoicePreviewModal>` only when
`isPreviewOpen` (or split it into a wrapper that does not subscribe until open).

## 3. Service worker audit

`public/sw.js` did not exist at this base commit, so it was written from scratch (and `public/offline.html`):

- **Install**: fetches `/precache-manifest.json` (emitted by `scripts/gen-precache.mjs`, run by the npm
  `postbuild` hook) and caches every file in `dist/assets` plus `/`, `/offline.html`, `/manifest.json`,
  `/logo.png`, `/icons.svg` (13 files, ~1.1 MB with the logo). `addAll` is atomic; on any failure
  (404, offline, quota) the half-filled cache is deleted and the install fails, leaving the old worker in charge.
  This was a real bug found by the test (a failed install left a stray `mci-...` cache) and fixed.
- **Every route works offline after the first visit**, including `/invoice/abc` deep links and lazy route chunks
  that were never visited online (all chunks precached). Decision: yes, precache all chunks (JS+CSS total
  ~0.5 MB gz) rather than runtime-cache lazily.
- **Navigations** are network-first (fresh deploys win), fall back to the cached shell `/`, then `/offline.html`.
  The shell is stored under `/` (not `/index.html`) so a host that redirects `/index.html` to `/` cannot poison the
  cache with a redirected response.
- **Assets** cache-first; runtime cache only for same-origin 200s under `/assets/`; `cache.put` wrapped in try/catch (storage full never breaks a response).
- **Never cached / never intercepted**: `/sw.js`, `/precache-manifest.json`, non-GET, cross-origin (Google Fonts).
  Offline the font CSS fails, text renders in fallback fonts; verified the app renders (tests abort font hosts).
- **Updates**: `sw.js` is stamped with a content hash (`__BUILD_ID__`, includes the worker source itself), cache name
  `mci-<build>`. New worker installs and **waits** (a running page keeps the hashed chunks it needs); it takes over on
  `postMessage('SKIP_WAITING')` or when all tabs close; `activate` deletes older `mci-*` caches and claims clients.

`node scripts/verify-offline.mjs` (25 checks, all pass): registration, control, precache completeness, naming,
sw.js/manifest not cached, offline reload of 7 routes with the origin server *refusing connections* (Chromium's
`setOffline` does not cover service-worker fetches, so the harness drops sockets itself), no CSP violations or page
errors, update-waits, old-cache cleanup, broken-deploy rejection (manifest lists a 404) keeps old worker + cache.

Limits: real `QuotaExceededError` on install cannot be forced in headless Chromium; it is covered by the same
code path as the 404 case. iOS Safari evicts caches after ~7 days without use (backups remain the user's
safety net, see `docs/features/pwa-backup.md` if present on the lead's branch).

## 4. Content-Security-Policy

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:;
connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; worker-src 'self'; manifest-src 'self';
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
```
Deviations from the brief, both required by real behaviour found in testing:
- `connect-src` additionally allows the two Google Fonts hosts: **`html-to-image` `fetch()`es the Google Fonts CSS/woff2
  to embed fonts in the PDF** - with `connect-src 'self'` the PDF export logged 4 violations (and would drop the fonts).
- `font-src` allows `data:` (embedded fonts produced by html-to-image) and `manifest-src 'self'` is explicit.
`'unsafe-inline'` is needed in `style-src` only because React uses `style={{...}}` attributes widely; scripts are
fully locked down (the only inline `<script>` is `type="application/ld+json"`, which is data and not blocked).

Delivered in `public/_headers` (Netlify/Cloudflare Pages), `vercel.json`, `netlify.toml`, `public/.htaccess`
(Apache), together with nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP, HSTS, immutable
caching for `/assets/*` and `no-cache` for `index.html`, `sw.js`, `precache-manifest.json`, `manifest.json`.
Keep the four copies in sync.

**Meta alternative** (for hosts that cannot send headers; `frame-ancestors` is ignored in meta). Put it first in `<head>` of `index.html`:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'">
```

**Verification** (production build, served with these headers, `tests/perf/run.mjs` + `verify-offline.mjs`):
0 violations on `/`, `/invoice`, `/invoice/abc`, `/transactions`, `/clients`, `/settings`; service worker registers
(`worker-src`); logo upload produces a `data:image/png` that loads; the UPI QR renders (canvas); PDF export
downloads `Invoice_draft.pdf` with no violations and no page errors. The only violations anywhere are the dicebear
avatars (section 1 follow-up), reported separately and excluded from the pass/fail.
Google Fonts themselves cannot be loaded in the sandbox, so allowance for those origins was verified by the absence
of violations when the harness aborts them at the network layer (a CSP block would be reported first).

## 5. CI

`.github/workflows/ci.yml`: npm cache (setup-node), `npm ci`, typecheck, lint, test, build (runs `postbuild`),
`check:size` budget, upload `dist` artifact (14 days), concurrency cancel, 10 min timeout, read-only
permissions, no secrets. Separate non-blocking `audit` job (`npm audit --omit=dev --audit-level=high`).
**The budget step fails until the src diffs in section 1 are applied** (initial JS 241 kB gz vs budget 100).
Override with `BUDGET_*_GZ_KB` env vars if you want to stage the rollout.

## 6. Dependency audit

- `npm audit --omit=dev` found 4 issues: `react-router`/`react-router-dom` (high; open redirect in `<Link>`/`useNavigate`
  is reachable in this SPA), `dompurify` and `fflate` (moderate, via jspdf). `npm audit fix --omit=dev` updated
  `package-lock.json` only (no `package.json` range changes) and now reports 0 vulnerabilities; build, lint, tests and
  all QA scripts pass on the fixed lockfile.
- Unused: `uuid` is in `dependencies` but never imported (`src/lib/storage.ts` has its own `generateId`) - remove
  it. `framer-motion` was referenced only in the old `manualChunks` (not installed). `clsx` is used in one file (fine).
- Duplicates in `npm ls --all`: none that matter (`semver`, `ignore`, `eslint-visitor-keys`, `@rolldown/pluginutils`
  are dev-only). Optional peer warnings (esbuild, jiti, less...) are Vite's optional peers.
- `engines.node >=22` added to `package.json` (needed by `node --test` with `--experimental-strip-types`).
