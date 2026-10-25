# Invoice — AI Context File
# Read this FIRST before making any changes.

## Project Identity
- **Name**: Mr. Chartist Invoice
- **Type**: Frontend SPA — professional, offline-first invoice generator
- **Brand**: @MrChartist · reference site https://mrchartist.com (no separate invoice subdomain launch)
- **Owner**: Rohit Singh (SEBI Registered Research Analyst, INH000015297)
- **Features**: invoicing + light accounting for Indian businesses — 26 templates + Design Studio, GST
  (CGST/SGST/IGST, cess, TCS, TDS, export/LUT), credit notes & conversions, recurring, receivables,
  purchases/ITC, inventory, books, GSTR-1/3B papers, e-Invoice/e-Way JSON, Tally XML, CSV import,
  PWA + encrypted/auto backups. Module contract: `docs/ARCHITECTURE.md`; per-module notes: `docs/features/`.
- **Brand source of truth**: mrchartist.com (logo `public/branding/*`, tokens in `src/index.css`; app palette = blue/gold `--pal-*`, orange kept only for the logo and the Ember template).

## Stack
- **React 19** + **TypeScript** + **Vite 8** (rolldown bundler — `vite.config.ts` uses
  `rolldownOptions`, which is correct for Vite 8; do not change it to `rollupOptions`).
- **State**: Zustand — `src/store/useInvoiceStore.ts` is the single live global store.
- **Styling**: Vanilla CSS + CSS Modules (`*.module.css`); tokens in `src/index.css`.
- **PDF**: `html-to-image` + `jspdf`. **QR**: `qrcode.react`. **Icons**: `lucide-react`.

## Architecture / Key files
- `index.html` → `src/main.tsx` → `src/App.tsx` (PIN gate + React Router shell).
- `src/pages/` — one file per route (Dashboard, InvoiceCreator, Transactions, Clients, Settings, LoginPage,
  Expenses, Receivables, Books, GstReports, Exports, Inventory, Recurring, Payroll). Design Studio lives in
  `src/components/design/`. Every page except Dashboard and Login is `React.lazy` in `src/App.tsx`; the editor chunk is prefetched on idle.
- `src/store/useInvoiceStore.ts` — Zustand store (current invoice + actions).
- `src/lib/localDb.ts` — data layer (over `src/lib/storage.ts`) + Indian-FY invoice numbering.
- `src/lib/storage.ts` — sync key/value API; data tables live in IndexedDB behind an in-memory cache loaded by
  `initStorage()` in `main.tsx` (localStorage fallback). See `docs/ARCHITECTURE.md` → Storage layer.
- `src/lib/auth.ts` — local PIN gate (PBKDF2-hashed, lockout, idle lock; `login`/`verifyPin` are async).
- `src/lib/stats.ts` — dashboard maths; `isRevenueDoc` is the single definition of "revenue".
- `src/lib/utils.ts` — `cn`, `formatCurrency`, `formatDate`, `amountInWords` (Indian system).
- `src/components/templates/{TemplateEngine.tsx,registry.ts}` — 26 templates via layouts
  (`classic`/`corporate`/`minimal`/`centered`/`gst`/`receipt`/`letterhead`) × CSS variables
  (`accent`, `fontFamily`); optional `design` prop applies Design Studio prefs (`src/lib/design-prefs.ts`).
- `src/components/{preview,modals,layout,ui}/` — preview/export, search modals, shell, primitives.

## Storage keys (do not rename — breaks existing users' data)
Same names whether a key lives in IndexedDB (data tables, via the storage cache) or localStorage (device-local
keys listed in `DEVICE_LOCAL_KEYS`, and `theme`). Never use `localStorage` directly for app data.
- `mrchartist_inv_*` (via `DB_PREFIX`): `clients`, `items_catalog`, `invoices`, `transactions`, plus the
  feature tables listed in `docs/ARCHITECTURE.md` (`vendors`, `purchases`, `recurring`, `doc_links`, `stock_moves`,
  `assets` …). Since schema v3 invoice/recurring sender snapshots hold `asset:<id>` for logo/signature; `getTable`
  resolves them, so read those tables through `getTable`/`localDb`, never raw JSON.
  Backup collects every `mrchartist_inv_*` key except device-local ones (PIN session, lockout, idle timer).
- `mrchartist_inv_settings` — multi-profile sender identities (array).
- `mrchartist_inv_template` — selected template id.
- `mrchartist_inv_auth` — hashed PIN credential of the Owner (legacy plaintext is migrated on first unlock). `theme` — light/dark.
- `mrchartist_inv_auth_users` / `mrchartist_inv_auth_guard_users` — local clerk/viewer users (hashed PINs) and their
  lockouts (6.21). Device-local, never in backups. Role checks: `can()` / `requireAccess()` in `src/lib/access.ts`
  (convenience access control, not security); new destructive data-layer calls should call `requireAccess`.
- `mrchartist_inv_companies` — device-local company registry (6.20); each company is its own IndexedDB database
  (`mrchartist_inv_kv`, `mrchartist_inv_kv__<id>`) with the same keys inside.
- Folder sync (5.7, `docs/features/sync.md`): `mrchartist_inv_sync_device` (device-local id/name), and per company
  `sync_state` / `sync_conflicts` / `sync_audit` (`SYNC_META_KEYS`: never in a backup, removed by restore/erase).
- `mrchartist_inv_lang` — device-local interface language (`en` default / `hi`, 5.4); never in backups. UI strings go
  through `t()` / `useT()` (`src/i18n/`, how-to + Hindi glossary in `docs/features/i18n.md`).
- Phase 7 company data (backed up and synced like every `mrchartist_inv_*` key):
  `mrchartist_inv_audit_archive_<0001…>` — MCA edit-log archive segments (WP-7, `AUDIT_ARCHIVE_PREFIX` in `audit.ts`;
  validated on restore, never edited in place); `mrchartist_inv_year_end` — reviewed year-end checklist steps per FY
  (WP-7); `mrchartist_inv_closing_stock` — report-time closing-stock source `{mode?, opening?, entries}` (WP-2). When
  valuation is on, closing-stock journals (year-end wizard class "Year-end closing stock") are netted off it in every
  statement (`loadStockValuer` → `netOfStockJournals`), so stock is never counted twice; use `loadStockValuer()` for
  any P&L / balance sheet so Books, the Gateway and ratios agree.
- Device-local viewing preferences, outside the `mrchartist_inv_` prefix (never backed up or synced):
  `mrchartist_report_prefs` (F12 report options per report) and `mrchartist_report_period` (shared report period,
  Alt+F2); `mrchartist_tally_terms` (Gateway "Tally terms"); `mrchartist_report_views` / `mrchartist_report_pack` (8G saved
  views and month-end pack schedule). `mrchartist_inv_save_choice` (editor split-Save choice) is in `DEVICE_LOCAL_KEYS`.

## Critical Rules — DO NOT BREAK
1. **Local-first & serverless.** No backend, DB, or network calls. Do not add axios/express
   or a server DB. Everything runs in the browser; data lives in IndexedDB/localStorage via `src/lib/storage.ts`.
2. **No TailwindCSS.** Vanilla CSS + CSS Modules only. Use CSS variables, not raw hex, in components.
3. **Invoice snapshotting.** On save, the invoice embeds a snapshot of the selected sender
   profile. The preview must read from `invoice.sender` first (fall back to global settings only
   for legacy invoices) so historical invoices never change.
4. **Indian Financial Year numbering** (Apr 1 – Mar 31), format `INV/FY25-26/0001`. Do not switch
   to calendar-year numbering. Regression-tested in `tests/localDb.test.ts`.
5. **Template engine.** Never hardcode colors in layouts; always use the `accent` prop/variable.
6. **PDF stack** stays `html-to-image` + `jspdf` (no `@react-pdf/renderer`, no server-side PDF).
7. Keep dependencies minimal; verify `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` before committing.
8. **Parse bare dates as local days** (`YYYY-MM-DD`), never `new Date(str)` — UTC parsing shifts the financial year.
9. **Purchases contract.** Modules that read `purchases` must understand `src/types/purchases.ts`;
   `tests/purchase-contract.test.ts` guards this. Add new reader modules to that test.
10. GST/e-Invoice/Tally outputs are working papers, not portal-validated — keep the "verify with your CA" wording.

## Commands
```bash
npm install      # install deps (run once after cloning / after dep changes)
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build (production)
npm run preview  # preview the production build
npm run typecheck# tsc -b (no emit)
npm run lint     # eslint .   (lint:fix to auto-fix)
npm test         # node:test on tests/**  (zero extra deps; needs Node >= 22)
npm run test:coverage # same, with a coverage table for src/
npm run test:e2e # Playwright smoke against dist/ (run `npm run build` first)
```

## Environment
No runtime secrets or environment variables are required (see `.env.example`). Any future
build-time config must use Vite's `VITE_` prefix.

## Known tech debt
- `src/` compiles with `strict: true`; `tests/` are typechecked too (`tsconfig.test.json`, non-strict —
  fixtures use partial records). ESLint `no-explicit-any` stays a warning.
- `react-hooks/set-state-in-effect` kept as a warning — the app's correct localStorage-hydration
  pattern triggers it; rewriting needs care.
- Purchases are read through the shared `readPurchase` + `splitLumpTax` (`purchase-normalize.ts`);
  `gst-reports`, `books` and `export-shared` only adapt the result to their own field names.
- Statutory values that change over time (B2CL threshold, GST slabs, TDS/TCS presets) live in
  `src/lib/tax-rules.ts`, keyed by effective date — add new values there, never overwrite old ones.
  Exception: GST interest / late-fee tables live in `src/lib/gst-penalties.ts` (same date-keyed shape) so they
  stay out of the early-loading notifications chunk, and payroll statutory values (EPF / ESI / PT / TDS u/s 192) live in
  `src/lib/payroll-rules.ts` (same shape) so the lazy payroll route does not grow the first-paint bundle.
- The bill / PO / GRN line editor sets `PurchaseLine.item_id` when a stock item is picked (WP-8) and the stock engine
  matches on it first; older lines (and typed names) still match by name + HSN, so keep that fallback.
- Alternate units: a line typed in another unit keeps quantity / rate as typed and snapshots `unit_factor` (invoice,
  bill / GRN / return, POS, stock move, stock transfer, stock journal and job-work lines); every stock reader must
  convert with `lineFactor` / `PurchaseLineCore.unitFactor` (`src/lib/units.ts`).
- Credit notes are linked to invoices through the `doc_links` table; GSTR credit/debit-note sections
  treat them as standalone documents.
- A 4-6 digit PIN is a lock screen, not encryption of the stored data; optional vault mode (`src/lib/vault.ts`) encrypts the IndexedDB store at rest. Never write the `__vault__` record or sealed (`mcv1:`) values outside `storage.ts`.
- `.xlsx` is handled by our own minimal reader/writer (`src/lib/zip.ts` + `src/lib/xlsx.ts`, native
  `DecompressionStream`/`CompressionStream`): no `.xls`/`.ods`/encrypted/ZIP64 workbooks, no styles beyond a bold
  header row on export. Imports read the first non-empty sheet. Keep it out of the shell (dynamic import).
