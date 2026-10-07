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
- **Brand source of truth**: mrchartist.com (logo `public/branding/*`, tokens in `src/index.css`).

## Stack
- **React 19** + **TypeScript** + **Vite 8** (rolldown bundler — `vite.config.ts` uses
  `rolldownOptions`, which is correct for Vite 8; do not change it to `rollupOptions`).
- **State**: Zustand — `src/store/useInvoiceStore.ts` is the single live global store.
- **Styling**: Vanilla CSS + CSS Modules (`*.module.css`); tokens in `src/index.css`.
- **PDF**: `html-to-image` + `jspdf`. **QR**: `qrcode.react`. **Icons**: `lucide-react`.

## Architecture / Key files
- `index.html` → `src/main.tsx` → `src/App.tsx` (PIN gate + React Router shell).
- `src/pages/` — one file per route (Dashboard, InvoiceCreator, Transactions, Clients, Settings, LoginPage,
  Expenses, Receivables, Books, GstReports, Exports, Inventory, Recurring). Design Studio lives in
  `src/components/design/`. Heavy pages are `React.lazy` in `src/App.tsx`.
- `src/store/useInvoiceStore.ts` — Zustand store (current invoice + actions).
- `src/lib/localDb.ts` — localStorage data layer + Indian-FY invoice numbering.
- `src/lib/auth.ts` — local PIN gate (PBKDF2-hashed, lockout, idle lock; `login`/`verifyPin` are async).
- `src/lib/stats.ts` — dashboard maths; `isRevenueDoc` is the single definition of "revenue".
- `src/lib/utils.ts` — `cn`, `formatCurrency`, `formatDate`, `amountInWords` (Indian system).
- `src/components/templates/{TemplateEngine.tsx,registry.ts}` — 26 templates via layouts
  (`classic`/`corporate`/`minimal`/`centered`/`gst`/`receipt`/`letterhead`) × CSS variables
  (`accent`, `fontFamily`); optional `design` prop applies Design Studio prefs (`src/lib/design-prefs.ts`).
- `src/components/{preview,modals,layout,ui}/` — preview/export, search modals, shell, primitives.

## localStorage keys (do not rename — breaks existing users' data)
- `mrchartist_inv_*` (via `DB_PREFIX`): `clients`, `items_catalog`, `invoices`, `transactions`, plus the
  feature tables listed in `docs/ARCHITECTURE.md` (`vendors`, `purchases`, `recurring`, `doc_links`, `stock_moves` …).
  Backup collects every `mrchartist_inv_*` key except device-local ones (PIN session, lockout, idle timer).
- `mrchartist_inv_settings` — multi-profile sender identities (array).
- `mrchartist_inv_template` — selected template id.
- `mrchartist_inv_auth` — hashed PIN credential (legacy plaintext is migrated on first unlock). `theme` — light/dark.

## Critical Rules — DO NOT BREAK
1. **Local-first & serverless.** No backend, DB, or network calls. Do not add axios/express
   or a server DB. Everything runs in the browser; data lives in `localStorage`.
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
```

## Environment
No runtime secrets or environment variables are required (see `.env.example`). Any future
build-time config must use Vite's `VITE_` prefix.

## Known tech debt
- `tsconfig` does not enable `strict`; dynamic localStorage JSON uses `any` (ESLint `no-explicit-any`
  is a warning, not an error).
- `react-hooks/set-state-in-effect` kept as a warning — the app's correct localStorage-hydration
  pattern triggers it; rewriting needs care.
- Several report modules (`books`, `inventory`, `gst-reports`, `export-shared`) each carry their own
  tolerant purchase normaliser; consolidating onto `PurchaseRecord` would remove the duplication.
- `PurchaseLine.item_id` is not set by the bill form yet, so inventory matches purchases by name + HSN.
- Credit notes are linked to invoices through the `doc_links` table; GSTR credit/debit-note sections
  treat them as standalone documents.
- A 4-6 digit PIN is a lock screen, not encryption of the stored data.
- `.xlsx` import is not supported (would need a dependency); CSV only.
