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
- Vendor chunks only for `react*` and `lucide-react`/`zustand`/`clsx` (long-term cacheable). `qrcode.react` was in
  `vendor-ui` until PERF-4 (2026-10-29), see the end of this file.
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

---

## Post-merge measurements (lead, on the integrated build)

The numbers above were taken on the older base. On the merged v3 build (every module wired in):

| | before | after lazy-loading |
|---|---|---|
| entry chunk (gz) | 138.6 kB | **81.8 kB** |
| initial JS (gz) | 226.6 kB | **173.0 kB** |
| total JS (gz) | 529.7 kB | 540.6 kB |

What changed: Transactions, Clients and Settings are `React.lazy` routes; the invoice preview modal, command palette, shortcuts overlay and Help modal load on first use; the Dashboard loads the books and inventory modules after first paint and reads credit links straight from storage.

CI budgets in `scripts/check-bundle-size.mjs` were reset to the achieved result plus ~7 % headroom (initial 185, entry 90, total 580 kB gz).

Already fixed in src before this report was written (no action needed): dicebear avatar calls removed, duplicate Google Fonts `@import` removed, jspdf/html-to-image loaded with dynamic `import()`, service worker registered in `main.tsx`.

Integration notes: `public/sw.js` merges the PWA module's worker with the build-stamped precache manifest. A manifest listing a failing file rejects the install (old worker keeps serving); no manifest at all falls back to discovering assets from `index.html`. The inline theme script moved to `public/theme-init.js` so the CSP can stay `script-src 'self'`. `node scripts/verify-offline.mjs` passes against the merged build.

---

## Long tables (Roadmap 4.3, 2026-10-24)

Measured with `PERF_ONLY=tables node tests/perf/run.mjs` (production build, headless Chromium, 1366x800,
desktop CPU, median of 3 runs). The harness seeds n invoices across n/3 parties, unlocks the PIN session
(earlier "300 invoices" rows in section 2 waited for `#root > *`, which can be the PIN screen), then:
long tasks during load, rows in the DOM, scrolling `main#main` 20 screens (one frame per step), and
clicking the "Client" sort header until the next frame.

| | max long task on load | DOM rows | longest task while scrolling | sort click |
|---|---|---|---|---|
| `/transactions` @300, before | 174 ms (193 / 229 ms tasks) | 300 | 52 ms | 574 ms |
| `/transactions` @300, after | 110 ms | 12 | 0 | 89 ms |
| `/transactions` @1000, before | 507 ms | 1000 | 56 ms | 1516 ms |
| `/transactions` @1000, after | 127 ms | 12 | 0 | 101 ms |
| `/receivables` @300 (100 parties), before | 61 ms | 100 | 0 | — |
| `/receivables` @300, after | 0 (no task over 50 ms) | 100 (under threshold) | 0 | — |
| `/receivables` @1000 (334 parties), before | 144 ms | 334 | 0 | — |
| `/receivables` @1000, after | 89 ms | 10 | 0 | — |

Two changes produce this:
1. **`Intl` formatters are cached** (`src/lib/utils.ts`). `formatCurrency`, `formatMoney`, `formatQuantity` and
   `formatDate` built a new `Intl.NumberFormat` / `DateTimeFormat` on every call; a CPU profile of the scroll test
   showed them at ~750 ms self time, far ahead of React. With only this change (virtualisation off):
   `/transactions` @300 161 ms max task, sort 483 ms; @1000 524 ms, sort 1081 ms; `/receivables` @300 62 ms.
   `formatDate` formats the local calendar day in UTC so a cached formatter is safe across time-zone changes.
2. **Row windowing** (`src/hooks/useVirtualRows.ts` + pure maths in `src/lib/virtual-window.ts`, no dependency) on the
   invoice list, the receivables party table, each party's expanded bill list and the statement ledger. It
   turns the sort click from ~0.5-1 s into ~0.1 s and keeps the DOM at a screenful at any list size.

How the windowing behaves:
- Only lists **over 100 rows** are windowed; smaller ones render exactly as before (no extra attributes).
- Real `<table>` markup stays; unmounted runs are replaced by `aria-hidden` spacer rows. Windowed tables set
  `aria-rowcount` and each row `aria-rowindex` (counting header, opening-balance, expanded detail and footer rows).
- Row heights are measured after render (keyed by row id, so re-sorting keeps them), so the 640px card layout and
  expanded receivables rows need no configuration. It follows the real scroll container (`main#main`), falling back
  to the window, and re-measures on resize via `ResizeObserver`.
- The row holding keyboard focus stays mounted when scrolled away, so Tab order and focus are never lost.
  Selection, "select all" and bulk actions operate on the data, not the DOM, so they cover off-screen rows.
- Printing renders every row (`beforeprint`).
- **Known trade-off:** browser find-in-page (Ctrl+F) only finds rows currently mounted; the page's own search box
  searches everything.

Not changed: the remaining ~100 ms task on `/transactions` is reading and parsing the invoice table plus the
route chunk; caching the parsed table in the store (section 2) is the next step.

## Component split (Roadmap 4.4, 2026-10-24)

Pure refactor of `ImportWizard` and `InvoiceCreator`. Typing latency, `/invoice` with 20 lines
(`PERF_ONLY=typing node tests/perf/run.mjs`, the section now unlocks the session and uses the current
"Item N name" labels), 5 alternating runs each against a build of the previous commit: median of run medians
20.4 ms before / 17.5 ms after, p95 31.9 / 28.0 ms — within run-to-run noise (single runs range 17-24 ms), so no
regression. `DocumentMetaCard` subscribes to its own store slice, so typing in a line no longer re-renders the
document fields. Bundle: initial JS 182.1 -> 181.6 kB gz, entry 85.0 -> 84.6 kB gz (the split itself cost
~0.25 kB; recovered with `store/pick.ts` for the long `useShallow` selectors and by loading the closed
client/item picker modals as lazy chunks right after the editor renders).

## jsPDF optional imports stubbed (Phase 6)

`html2canvas`, `canvg` (+ core-js) and `dompurify` are jsPDF's optional dynamic imports, used only by
`doc.html()` / `addSvgAsImage()`, which the app never calls (html-to-image rasterises pages). `vite.config.ts`
aliases them to `src/lib/stubs/jspdf-optional.ts` (throws if ever reached). Total JS 736.9 → 633.3 kB gz,
precache 155 → 152 files; initial JS unchanged (154.7 kB). PDF download/share verified by the e2e journey.

## Shell trim + total budget (Phase 6)

Backup actions (`auto-backup.ts` → `backup.ts`, encryption, folder writing) load on demand: the shell imports only
`auto-backup-schedule.ts` (nudge timing and config), `AutoBackupRunner` imports the runner at its first run, and the
Forgot-PIN erase imports its helpers when used. Initial JS 172.5 → 168.5 kB gz (entry 65.7 → 61.7). Lazy-loading the
reminder composer was tried and reverted: it shares `useReminderLog` with the Dashboard card, so rolldown created an
entry ↔ chunk import cycle for a ~3 kB gain. `check-bundle-size.mjs` now de-duplicates the initial list (Vite emits
the entry twice when a cycle exists). The total (offline precache) budget is 900 kB; the 185 kB initial budget is
unchanged.

## Notification bell after first paint (Phase 6)

`NotificationBellSlot` lazy-loads the bell (notification engine, compliance calendar, cheque / interest reminders)
right after first paint, showing a same-sized inert bell meanwhile; the Dashboard imports `RemindersPanel` directly
instead of through the `components/share` barrel (which pulled `ShareMenu` and the share helpers into the entry).
Initial JS 178.3 → 173.3 kB gz (entry 68.6 → 64.2).

## Initial-module chunk group (R15-A1, 2026-10-27)

`vite.config.ts` replaces `manualChunks` with rolldown's `output.codeSplitting.groups`: `vendor-react` and `vendor-ui`
(priority 30, names kept for long-term caching) and **`app-initial`** (`tags: ['$initial']`, priority 20), which puts
every module statically reachable from the entry into ONE chunk (rolldown folds it into the entry chunk). Before, ten
small first-paint app modules (`storage`, `dates`, `gstin`, `invoice-calc`, `tax-rules`, `validators`, two CSS-module
chunks …) shipped as separate chunks that every lazy chunk re-imported one by one.

| Build (gz -9, KiB) | Chunks | Initial | Entry | Total | Initial files | Cross-chunk `import{…}from` |
|---|---|---|---|---|---|---|
| Before (`manualChunks`, `d15cae9`) | 997 | 184.8 | 71.2 | 3,425.6 | 13 | 7,234 |
| After (`codeSplitting.groups`) | 988 | 182.5 | 88.4 | 3,382.2 | 4 | 5,768 |

`check-bundle-size.mjs`: the entry budget is 100 kB (the entry now *is* the first-paint app code, so the 185 kB
initial budget is the binding limit) and a new check allows at most 5 initial files. `tests/bundle-config.test.ts`
pins the three groups, the `$initial` tag and that no group can capture `jspdf` / `html-to-image`. Trade-off: any edit
to a first-paint module now invalidates one ~88 kB chunk instead of one of ten; the PWA precaches the whole release
anyway. Rejected variants (per-folder groups, a "tiny modules" group, `maxSize` splits) are measured in
`docs/prd/round-15.md` §2.7.

## R16-A — size recovery (2026-10-28)

Four levers (`docs/prd/round-16.md` §4 R16-A), measured with `npx vite build` + `scripts/check-bundle-size.mjs`
(gzip -9, KiB). "Core" = every JS file except the language packs in `dist/lang-manifest.json`: what an English device
installs and updates.

| Build | Chunks | Initial | Entry | Core precache | Hindi pack | Regional pack | Initial files |
|---|---|---|---|---|---|---|---|
| Baseline `0521a90` | 1,009 | 182.6 | 88.6 | 3,429.3 (all JS, Hindi inside) | — | — | 4 |
| A1 + A2 (hi-split, packs, safe groups, leaves) | 1,004 | 182.1 | 88.0 | 3,086.0 | 338.9 (93 files) | 20.7 | 4 |
| + A3 (`escHtml` only, cut 1) and QA18 merge | 1,004 | 182.1 | 88.1 | **3,085.6 (−343.7)** | **338.6** | **20.7** | 4 |

- **A1 Hindi split.** `scripts/vite-hi-split.mjs` (build only) rewrites the `hi` argument of all 212 `defineArea(en, hi)`
  calls into `() => import('virtual:hi/<family>/<file>~<hash>')`; the `lang-hi-<family>` group collects them (92
  family chunks + `lang-hi-core` = `hi.ts`, `lang-regional` = `regional.ts`). Hindi left in English chunks: 21.3 kB
  (help glossary / topics, keymap, WhatsApp texts, bilingual prints — allow-listed), cap 36.
- **A2 safe groups.** `scripts/vite-safe-groups.mjs`: nine `f-*` family chunks (6.6–19.7 kB) and `lazy-leaves`
  (16.7 kB, src/lib modules ≤ 3,000 B whose imports are all first paint / vendor). Safety is computed over strongly
  connected components; `check-bundle-size.mjs` re-checks every `f-*` module against its family regex and every
  leaves module's imports from `build-meta/chunks.json`.
- **A3 shared helpers.** `escHtml` (`src/lib/html-esc.ts`, escapes `'` too) replaced 25 local copies; 5 family-local
  copies that missed `'` were fixed in place (a family module importing a lazy helper would no longer be "safe").
  Measured +1.2 kB core for the esc unification and +0.1 kB more for the day-maths call sites, so per the stop rule
  only the escape was kept; `src/lib/day-math.ts` ships as a tested lazy module with no migrated call sites yet.
- **A4 budgets.** Core precache 3,300 (was "total JS" 3,500), Hindi pack 400, regional 25, Hindi-in-core 36 (1 kB per
  chunk unless allow-listed), lazy-leaves 20, initial 185 / entry 100 / ≤ 5 initial files unchanged.

Service worker: English devices never download a language pack. The page posts `{type:'lang'}` on boot and on every
switch; the worker caches the pack and keeps the choice in `mci-lang` `/__lang__`, and each install re-caches the
pack of a Hindi device. Asset cache-first no longer trims at runtime (a pack chunk fetched on a miss used to be able
to evict the precached core: `trim(…, 160)`). `scripts/verify-offline.mjs` covers the English install (no pack), the
offline switch (message, stays English), the online switch (93 / 93 cached), the offline Hindi reload and the update
re-caching a dropped pack file.

### QA round 19 (2026-10-28)

- **Stale build assets.** R16-A stopped the runtime trim of `mci-assets`, so every release used to add ≈ 3.1 MB that was
  never removed. `activate` now prunes `/assets/` files that neither the new build nor the one it replaces lists (core +
  the device's language pack; every pack while the language is unknown); a replaced shell without a manifest copy (a
  pre-R16 build) means nothing is pruned on that activation (`docs/prd/qa-round-19.md` U2, `verify-offline.mjs`).
- **One-time cost of U1.** A device upgrading from a pre-R16 worker downloads the language packs once (Hindi 340.6 kB +
  regional 20.7 kB) because that worker never recorded the language; an English device drops them on its next update.
- **`perf.test.ts` audit cap.** The R15-A2 test timed 13–16 `payments.record` calls on a 5,000-invoice table (each
  rewrites the invoices table, ≈ 40–80 ms; PERF-3 row-level storage is deferred) and capped them at 4 s; under a loaded
  parallel run it measured 4.6 s. Profiled: `audit.record` + the batch write take ≈ 6–10 ms of ≈ 1.2 s, identical on the
  R16 baseline (`0521a90`: 1,112–1,149 ms; head: 1,137–1,185 ms) — CI noise, not a regression. The test now caps the
  audit work itself (1 s) and still asserts one write per task; the saves keep their own cap in the test above (U6).
- Size: first paint 182.1 → 182.2 kB (the `controllerchange` listener and the ack wait in `src/i18n/index.ts`), entry
  88.1 → 88.2 kB, core 3,103.0 → 3,104.1 kB, Hindi pack 340.6 kB unchanged.

### PERF-3 row-level storage of `invoices` (PENDING 3, 2026-10-29)

- **Decision.** A physical chunked layout in IndexedDB (chunks of 16 rows + a head, from 128 rows on) rather than
  write coalescing: coalescing still re-serialises and re-writes the whole table on every flush (and seals all of it in
  vault mode), so it only spreads the cost. Chunks make a save O(16 rows) in both serialisation and IndexedDB write
  while the logical value (key + JSON text) stays exactly as before, so no reader, backup or sync format changes. Design
  and guarantees: [`ARCHITECTURE.md`](../ARCHITECTURE.md) → Storage layer → Row-level storage.
- **Why chunks, not one record per row.** Position chunks need no per-row manifest (a row list of 20,000 ids would be
  re-written on every append) and the chunk text is a slice of the table's JSON, so the logical text is a join, byte
  for byte. Deleting or re-ordering rows rewrites the chunks after that point (rare, and no worse than before).
- **Timings** (Node, fake IndexedDB, rows ≈ 7 KB each like the perf-round-4 dataset, median of 5; `setTable` + flush /
  `payments.record`): 5,000 invoices: save 93 + 45 ms → 1.0 + 2.6 ms, payment 103 → 1.9 ms; 20,000 invoices: save
  1,061 + 616 ms → 2.0 + 2.7 ms, payment 466 → 2.8 ms. `tests/storage-rows.test.ts` asserts one changed record per
  in-place save / payment at 2,000 and 16,000 rows and a size-independent time (generous bound).
- **One-time cost.** The first save of a big table after an update, a restore or a sync merge writes every chunk once
  (the old cost, once). In memory a chunked table holds its chunk texts instead of one string; its full text is built
  only for whole-table readers (backup, sync, open export, storage health) and kept until the next write.

### PERF-4 first-paint headroom (2026-10-29)

First paint was 184.8 / 185 kB, so no change to `storage.ts`, `localDb.ts` or the shell could land. Attribution
(sourcemap build, bytes per source module in each initial chunk) showed the largest single item that first paint does
not use was **`qrcode.react` inside `vendor-ui`** (15.8 kB raw): `VENDOR_UI` named it, so the QR library shipped with
every first paint although only lazy modules import it (invoice templates, IRN block, statements, POS UPI QR, order
pad, bundle tickets, farmer cards, customer display). The fix is one token in `vite.config.ts`: `qrcode.react` left
the `VENDOR_UI` regex; rolldown now emits it as its own lazy chunk (`esm-*.js`, one module), loaded with the first
template / QR screen (it is precached like every core chunk, so offline use is unchanged). The `Pos.tsx` comment
"qrcode.react loads only once a UPI amount is typed" is now true. `tests/bundle-config.test.ts` asserts that neither
vendor group captures `qrcode.react` (and that `vendor-ui` still matches `zustand` / `clsx`).

Both columns built with `npx vite build` in the same checkout (the preload-map order, and so a few bytes of the
entry, depend on the directory the build runs in). Before = base `b8a1a33` (same tree as `312b827`, PENDING 41 / 44 /
47); after = that base + PERF-4. On the earlier base `f395942` the change measured the same: 184.8 → 179.2 initial,
core 3,265.4 → 3,265.0.

| Chunk (gz -9, KiB) | Before `b8a1a33` | After |
|---|---|---|
| `index` (entry = app-initial) | 90.83 | 90.84 |
| `vendor-react` | 72.13 | 72.13 |
| `vendor-ui` | 21.46 (69.2 raw) | **15.81** (53.4 raw) |
| `rolldown-runtime` | 0.41 | 0.41 |
| **First paint (initial JS)** | **184.8** | **179.2 (−5.7)** |
| `esm` (`qrcode.react`, lazy) | — | 5.85 |
| Core precache | 3,270.2 | 3,269.2 (−1.0) |
| JS files | 1,059 | 1,060 |

Measured and rejected: moving `tax-rules.ts` out of first paint (it is there only because `src/types/invoice.ts`
evaluates `TDS_SECTIONS` / `TCS_PRESETS` at load and re-exports `GST_SLABS`, none used by `src/`). First paint
−3.2 kB, but `tax-rules` became a shared chunk imported by 202 lazy chunks: core **+15.8 kB** (3,265.4 → 3,280.3, on
`f395942`). A widely shared first-paint module costs one `import{…}from` per importing chunk once it leaves the entry; only modules with
few importers (like `qrcode.react`) are worth moving. Next candidates, in the same spirit: lucide icons used only on
lazy screens (every imported `lucide-react` icon still lands in `vendor-ui`, most of its 15.8 kB) — a policy change for
`AGENTS.md`, not done here.

### PERF-5 core headroom (2026-10-29)

Core precache was 3,274.6 / 3,300 kB. The bundle has no duplicated module (rolldown places each module in exactly one
chunk; checked over `build-meta/chunks.json`), so the reclaim came from what every chunk repeats: file names in
import statements and in Vite's `__vite__mapDeps` preload lists (≈ 76 kB gz over 259 lists before), CSS-module class
names, a second zlib library in the PDF chunk, and per-file overhead of tiny shared chunks. No change alters what the
app does; one adds lazy code to a shared chunk (4 below).

Each step measured with `npx vite build` + `gen-precache` + `check-bundle-size` in the same checkout, cumulative, on
base `438a13f` (tree = `f7be189`).

| # | Change | Core (gz kB) | Saved | First paint |
|---|---|---|---|---|
| 0 | base | 3,274.6 | — | 179.2 |
| 1 | `[hash:7]` file names (entry / chunk / asset; default 8) | 3,264.6 | −10.0 | 178.7 |
| 2 | first-paint files left out of the preload lists (`scripts/vite-preload-trim.mjs`) | 3,258.1 | −6.5 | 178.6 |
| 3 | `pako` aliased to `src/lib/stubs/pako-fflate.ts` | 3,245.7 | −12.4 | 178.6 |
| 4 | CSS-module names `_<local>_<file hash>` (no line number) | 3,238.1 | −7.6 | 178.0 |
| 5 | `lazy-leaves-ui` group | 3,229.7 | −8.4 | 177.8 |
| | **total** | **3,229.7** | **−44.9** | **177.8 (−1.4)** |

1. **7-character hashes.** A hash character does not compress, and every chunk name appears in ~10,000 import
   statements / preload entries. 7 is rolldown's minimum while a build has fewer than 4,096 chunks (its hash
   placeholder needs the room); it fails the build loudly, never silently, if that ever changes. 42 bits of
   content hash, per chunk name, is ample for cache busting.
2. **Preload trim.** Vite lists a dynamic import's whole static closure, so the runtime, the entry, `vendor-react` and
   `vendor-ui` were named in ~260 lists. They are always loaded before any `import()` runs (the entry is the page's
   script, the rest its `<link rel="modulepreload">`s), and `__vitePreload` skips them at run time, so dropping them
   changes no request. The plugin records the entry's static closure in a `generateBundle` (`order: 'pre'`) hook,
   before Vite writes the lists; `resolveDependencies` filters only `hostType: 'js'`, so the HTML's modulepreload links
   are untouched, and CSS deps never reach it.
3. **pako → fflate.** `fast-png` (jsPDF's PNG decoder for `addImage(…, 'PNG')`, used by letterhead bands) was the only
   importer of `pako` (20 kB gz). jsPDF already ships `fflate`; the stub implements the `Inflate` / `inflate` surface
   fast-png drives (collect IDAT chunks, inflate once on `result`) with pako's Adler-32 check, so corrupt data still
   throws. `tests/pako-fflate.test.ts` compares it with pako (chunked streams, levels 0–9, corrupt / truncated input);
   PDFs with PNG images from the jsPDF chunk of both builds were byte-identical in Chromium (4 canvases, with and
   without alpha). The PDF chunk went 125.5 → 112.5 kB gz.
4. **CSS-module names.** Vite's default `_<local>_<hash5>_<line>` puts a different line number in every class of the
   class-map objects; `generateScopedName` now gives `_<local>_<6 base64url chars of the file's SHA-256>`, one suffix
   per file (compresses). Class names are opaque: nothing in `src/`, the e2e smoke or the scripts selects by them.
5. **`lazy-leaves-ui`.** `leafGroup` takes an optional `test`; the new group (priority 8, `maxModuleSize: 1500`,
   `UI_LEAF` = `src/components|store|hooks|i18n/areas`, `.ts/.tsx` only) holds 64 small leaves that were 29 tiny shared
   chunks (`store/pick.ts`, `transport/Field.tsx`, area files…). Same safety rule as `lazy-leaves` (imports only first
   paint / vendor) and, checked by `check-bundle-size`, no stylesheet (a CSS module's styles would load with the group)
   and the same 20 kB cap: 13.2 kB. None of its modules runs code at load (top-level statements checked). Screens that
   used one of these leaves now load the 13.2 kB group (precached; ≤ 1.5 kB raw each). 2,500 bytes saved another 3.5 kB
   but made a 27 kB group; 1,000 saved 2.9 kB less.

Other numbers, before → after: entry 90.8 → 89.5, `vendor-react` / `vendor-ui` unchanged (72.13 / 15.81 → 15.80),
initial files 4 → 4, Hindi pack 361.5 → 361.4, regional 20.7 → 20.7, Hindi in core 21.7 → 21.7, `lazy-leaves` 17.7 →
17.6, JS files 1,059 → 1,030 (core 960 → 931).

Looked at and left: CSS-module JS chunks in one group (58 chunks, 15.4 kB gz) — rejected, some of those files carry
global print rules (`:global(#root)` in `InvoicePreview` / `pos`), which would apply on every screen that loads the group;
dropping preload lists altogether (`modulePreload: false`) — a load-time change, and it removes the HTML preloads the
first-paint budget measures; react-router's `development` build in `vendor-react` — same size as `production`
(NODE_ENV-guarded); jsPDF itself (118 kB gz, a prebuilt minified bundle, not tree-shakable).
