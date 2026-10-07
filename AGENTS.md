# Invoice — AI Context File
# Read this FIRST before making any changes.

## Project Identity
- **Name**: MrChartist Invoice Creator
- **Type**: Frontend SPA — professional, offline-first invoice generator
- **Brand**: @MrChartist · reference site https://mrchartist.com (no separate invoice subdomain launch)
- **Owner**: Rohit Singh (SEBI Registered Research Analyst, INH000015297)
- **Features**: 20+ templates, UPI QR code, multi-profile sender identities, GST-ready
  PDF export, Indian-FY invoice numbering, JSON backup/restore (File System Access API).

## Stack
- **React 19** + **TypeScript** + **Vite 8** (rolldown bundler — `vite.config.ts` uses
  `rolldownOptions`, which is correct for Vite 8; do not change it to `rollupOptions`).
- **State**: Zustand — `src/store/useInvoiceStore.ts` is the single live global store.
- **Styling**: Vanilla CSS + CSS Modules (`*.module.css`); tokens in `src/index.css`.
- **PDF**: `html-to-image` + `jspdf`. **QR**: `qrcode.react`. **Icons**: `lucide-react`.

## Architecture / Key files
- `index.html` → `src/main.tsx` → `src/App.tsx` (PIN gate + React Router shell).
- `src/pages/` — Dashboard, InvoiceCreator, Transactions, Clients, Settings, LoginPage.
- `src/store/useInvoiceStore.ts` — Zustand store (current invoice + actions).
- `src/lib/localDb.ts` — localStorage data layer + Indian-FY invoice numbering.
- `src/lib/auth.ts` — local-only PIN gate (no server).
- `src/lib/utils.ts` — `cn`, `formatCurrency`, `formatDate`, `amountInWords` (Indian system).
- `src/components/templates/{TemplateEngine.tsx,registry.ts}` — 20+ templates via 4 layouts
  (`classic`/`corporate`/`minimal`/`centered`) × CSS variables (`accent`, `fontFamily`).
- `src/components/{preview,modals,layout,ui}/` — preview/export, search modals, shell, primitives.

## localStorage keys (do not rename — breaks existing users' data)
- `mrchartist_inv_*` (via `DB_PREFIX`): `clients`, `items_catalog`, `invoices`, `transactions`.
- `mrchartist_inv_settings` — multi-profile sender identities (array).
- `mrchartist_inv_template` — selected template id.
- `mrchartist_inv_auth` — local PIN session. `theme` — light/dark.

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
7. Keep dependencies minimal; verify `npm run build` (and now `npm test`) before committing.

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

## Known tech debt (see _upgrade/ for the full audit)
- `tsconfig` does not enable `strict`; dynamic localStorage JSON uses `any` (ESLint `no-explicit-any`
  is a warning, not an error).
- `react-hooks/set-state-in-effect` kept as a warning — the app's correct localStorage-hydration
  pattern triggers it; rewriting needs care.
- `src/pages/InvoiceCreator.tsx` (459 lines) and `src/pages/Settings.tsx` (430) exceed the 300-line
  guideline; split only with full manual testing (they hold the snapshotting / multi-profile logic).
- No React error boundary at the app shell yet.
- Default sender profile in `Settings.tsx` hardcodes real bank/UPI details — consider moving to
  first-run user entry (ships in the public bundle today).
