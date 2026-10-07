<p align="center">
  <img src="public/branding/logo-horizontal-black.svg#gh-light-mode-only" alt="Mr. Chartist" height="64" />
  <img src="public/branding/logo-horizontal-white.svg#gh-dark-mode-only" alt="Mr. Chartist" height="64" />
</p>

<h1 align="center">Mr. Chartist Invoice</h1>

<p align="center">
  <strong>A free, open-source, offline-first invoicing and light-accounting app for Indian businesses — GST-ready, private by design, no server.</strong><br/>
  <sub>Built with conviction. For traders, by a trader. · <a href="https://mrchartist.com">mrchartist.com</a></sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite" />
  <img src="https://img.shields.io/badge/Local--first-no%20backend-1e5038?style=flat-square" />
  <img src="https://img.shields.io/badge/Installable-PWA-ee6125?style=flat-square" />
</p>

---

## Why this exists

Most invoicing tools are SaaS products that keep your clients and revenue on someone else's server. This one runs **entirely in your browser**. Your data lives in `localStorage` on your own device, works with no internet after the first load, and can be backed up as a file you control. There are no accounts, no analytics and no network calls.

It aims to cover what a small Indian business actually reaches for in Tally, Zoho Books or Vyapar — invoicing, GST, receivables, purchases, books and hand-off to an accountant — without any of the lock-in.

## What's inside

**Sales**
- Invoices, tax invoices, quotations, proforma invoices, credit notes and delivery challans, with conversion between them
- Indian-FY numbering (`INV/FY25-26/0001`, restarts every 1 April), editable per profile
- GST done properly: CGST + SGST vs IGST from place of supply, per-line HSN/SAC and rate, GSTIN checksum validation, reverse charge, cess, TCS, TDS, tax-inclusive pricing, SEZ / export / LUT supplies, amount in words (Indian system)
- 26 templates across 4 layouts, plus a **Design Studio**: accent colour, fonts, column visibility, A4 / A5 / 80 mm thermal paper, PAID / OVERDUE stamps
- UPI "scan to pay" QR on every invoice; multi-page PDF export and print
- Recurring invoices, payment reminders (WhatsApp / email / SMS links, English & Hinglish) and share menu
- Client directory, editable item catalogue (default rate, HSN/SAC, GST, unit, bulk % rate revision), part-payments with history
- Compliance guards: duplicate document numbers are refused (GST rule 46), every change is written to an audit trail, and a "lock books up to" date freezes filed periods (override needs your PIN)
- IRN, Ack No and the signed e-invoice QR print on all templates once recorded; optional late-fee interest from *your own* invoice terms (informational, never added to a total automatically)

**Accounts & GST**
- Receivables: aging, party ledgers and printable client statements, DSO, collections trend
- Purchases & expenses with vendors, payables and input tax credit
- Inventory with weighted-average or FIFO costing, low-stock alerts and sale-time shortfall warnings
- Books: day book, cash & bank book, profit & loss (accrual or cash), indicative balance sheet
- Bank reconciliation: import HDFC / ICICI / SBI / Axis / Kotak CSV statements, review scored match suggestions (nothing is applied until you confirm), print a BRS
- Reports: sales by customer / item / month (with year-on-year), top customers, tax by rate, payment modes, expenses, item profit — all reconcile with the dashboard and Books
- GSTR-1 / GSTR-3B working papers with GSTN-offline-tool-style JSON
- e-Invoice (IRP v1.1) and e-Way Bill JSON generators with pre-flight validation
- Tally Prime XML export and Zoho / Vyapar / Busy-friendly CSV; CSV import from the same tools

**Everyday comfort**
- Ctrl/⌘ + K command palette, notification centre, keyboard shortcuts (`?`), Tally-style line entry (Enter adds a line, Ctrl/⌘+Enter saves)
- One-click sample data to explore the app, removable without touching your own records
- Light & dark themes that follow the mrchartist.com palette
- Installable PWA with a service worker, auto-backup to a folder you choose, and passphrase-encrypted backups
- Hashed PIN lock with lockout and idle auto-lock

## Quick start

```bash
git clone https://github.com/MrChartist/Invoice.git
cd Invoice
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run build` | Typecheck and production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc -b`, no emit |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (`node:test`, Node ≥ 22, no extra deps) |

Deploy `dist/` to any static host. It must serve `index.html` for unknown paths (deep links such as `/invoice/abc`) and `sw.js` from the site root.

## First run

1. Choose a name and a PIN. This is a local lock screen, not an account.
2. **Settings → Business profiles**: add your name, GSTIN, address, bank and UPI. Add a logo and signature if you like.
3. **New invoice**, then Save. Use **Preview** to download the PDF.
4. **Settings → Data & backup**: download a backup, or connect a folder for automatic backups.

## Data, privacy and limits — please read

- **Your data is only in this browser.** Clearing site data, switching browser or using a private window loses it. Back up regularly; the app nudges you.
- **The PIN is a lock screen, not encryption.** Anyone with access to your browser profile can read `localStorage`. Use the passphrase-encrypted backup for files that leave your device.
- **GST reports, e-Invoice and e-Way JSON, and the Tally XML are working papers.** They are built offline from your data and are *not* validated against the GST portal or a live Tally install. Always check them with your CA, and try a small sample first. Cess, composition scheme, ISD, imports, amendments and interest are not handled in the GSTR helpers.
- The balance sheet is indicative only — fixed assets, loans and GST remittances are not tracked.
- `.xlsx` files are not read directly (that would need a dependency); export to CSV first.

## Architecture

React 19 + TypeScript + Vite 8, Zustand for the live invoice, vanilla CSS Modules with design tokens in `src/index.css`. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module contract and table list, and [`docs/features/`](docs/features) for each module's exports and behaviour.

```
src/
  components/   brand, creator, preview, templates, ui and one folder per feature module
  layouts/      app shell (grouped sidebar, palette, bell, PWA prompts)
  lib/          pure, tested logic (calc, GST, reports, exports, backup, auth …)
  pages/        one file per route
  store/        Zustand store for the document being edited
  types/        persisted shapes (additive-only — never rename a stored field)
tests/          node:test suites for everything in lib/
```

Ground rules: no backend, no network calls, no Tailwind, persisted field names are additive-only, money goes through `invoice-calc.ts`, and Indian FY numbering is fixed.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm run typecheck && npm run lint && npm test && npm run build` before opening a PR.

## Licence and disclaimer

Mr. Chartist is a SEBI Registered Research Analyst (INH000015297). Registration granted by SEBI and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors. This software is provided as is, without warranty; it is a tool, not tax or legal advice.
