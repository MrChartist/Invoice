<p align="center">
  <img src="public/branding/logo-horizontal-black.svg#gh-light-mode-only" alt="Mr. Chartist" height="64" />
  <img src="public/branding/logo-horizontal-white.svg#gh-dark-mode-only" alt="Mr. Chartist" height="64" />
</p>

<h1 align="center">Mr. Chartist Invoice</h1>

<p align="center">
  <strong>Free, open-source, offline-first invoicing and light accounting for Indian businesses.<br/>GST-ready. Private by design. No server, no account, no tracking.</strong><br/>
  <sub>Built with conviction. For traders, by a trader. · <a href="https://mrchartist.com/open-source/Invoice">Guide on mrchartist.com</a></sub>
</p>

<p align="center">
  <a href=".github/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/MrChartist/Invoice/ci.yml?branch=master&style=flat-square&label=CI" /></a>
  <img alt="Version" src="https://img.shields.io/badge/version-3.1.0-1e5038?style=flat-square" />
  <img alt="Licence" src="https://img.shields.io/badge/licence-Non--Commercial%20Source-b45309?style=flat-square" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" />
  <img alt="TypeScript 6" src="https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript" />
  <img alt="Vite 8" src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite" />
  <img alt="Installable PWA" src="https://img.shields.io/badge/Installable-PWA-ee6125?style=flat-square" />
</p>

<p align="center">
  <a href="#why-this-exists">Why</a> ·
  <a href="#what-you-get">Features</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#first-run">First run</a> ·
  <a href="#privacy-security-and-limits">Privacy and limits</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="#licence">Licence</a>
</p>

---

## Why this exists

Most invoicing tools are SaaS products that keep your clients and revenue on someone else's server. This one runs **entirely in your browser**.

- Your data stays in `localStorage` on your own device.
- It works with no internet after the first load.
- You back it up as a file you control.
- There are no accounts, no analytics and no network calls. Fonts are self-hosted, so even typography makes no third-party request.

It aims to cover what a small Indian business actually reaches for in Tally, Zoho Books or Vyapar (invoicing, GST, receivables, purchases, books and a clean hand-off to an accountant) without the lock-in.

## What you get

| Area | Highlights |
|---|---|
| **Sales documents** | Tax invoices, quotations, proforma invoices, credit notes and delivery challans, with one-click conversion between them. Indian FY numbering (`INV/FY25-26/0001`, restarts every 1 April). |
| **GST engine** | CGST + SGST vs IGST from place of supply, per-line HSN/SAC and rate, GSTIN checksum validation, reverse charge, cess, TCS, TDS, tax-inclusive pricing, SEZ / export / LUT supplies, rounding modes, amount in words (Lakhs and Crores). |
| **Look and print** | 26 templates across 7 layouts, plus a **Design Studio** (accent colour, fonts, column visibility, A4 / A5 / 80 mm thermal, PAID / OVERDUE stamps). UPI "scan to pay" QR on every invoice. Multi-page PDF export and print. |
| **Collections** | Part-payments with history, receivables aging, party ledgers, printable client statements, DSO, collections trend. Payment reminders in English and Hinglish (WhatsApp, email, SMS links). Recurring invoices. |
| **Purchases and stock** | Vendors, bills, expenses, payables and input tax credit. Inventory with weighted-average or FIFO costing, low-stock alerts and sale-time shortfall warnings. |
| **Books and banking** | Day book, cash and bank book, profit and loss (accrual or cash), indicative balance sheet. Bank reconciliation for HDFC, ICICI, SBI, Axis and Kotak CSV statements: you review scored match suggestions, nothing applies until you confirm, then print a BRS. |
| **Reports and filing papers** | Sales by customer / item / month (with year-on-year), top customers, tax by rate, payment modes, item profit. GSTR-1 and GSTR-3B working papers with GSTN-offline-tool-style JSON. e-Invoice (IRP v1.1) and e-Way Bill JSON generators with pre-flight validation. |
| **Accountant hand-off** | Tally Prime XML export, Zoho / Vyapar / Busy-friendly CSV, and CSV import from the same tools. |
| **Compliance guards** | Duplicate document numbers are refused (GST Rule 46), series gaps are surfaced, every change goes to an audit trail, and a "lock books up to" date freezes filed periods (override needs your PIN). IRN, Ack No and the signed e-invoice QR print on every template once recorded. Late-fee interest is informational and never added to a total automatically. |
| **Everyday comfort** | <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> command palette, notification centre, shortcut overlay (<kbd>?</kbd>), Tally-style line entry (<kbd>Enter</kbd> adds a line, <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> saves), one-click sample data you can remove without touching your own records, light and dark themes. |
| **Resilience** | Installable PWA with an offline service worker, auto-backup to a folder you choose, passphrase-encrypted backups, 6-digit hashed PIN with lockout and idle auto-lock. |

Invoices embed a **snapshot of the sender profile** at the time you save. Editing your business details later never changes an invoice you already issued.

## Quick start

Needs Node.js 22 or newer.

```bash
git clone https://github.com/MrChartist/Invoice.git
cd Invoice
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Typecheck, production build to `dist/`, then generate the offline precache list |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc -b`, no emit |
| `npm run lint` | ESLint (`lint:fix` to auto-fix) |
| `npm test` | Unit tests with the built-in `node:test` runner, no extra dependencies |
| `npm run check:size` | Bundle-size budget used in CI |
| `npm run verify:offline` | Checks the built app and precache list for offline use |

**Deploying:** serve `dist/` from any static host. The host must return `index.html` for unknown paths (deep links such as `/invoice/abc`) and serve `sw.js` from the site root. Ready-made headers and rewrites are included for Netlify (`netlify.toml`), Vercel (`vercel.json`) and Cloudflare Pages (`public/_headers`). Please read the [licence](#licence) before hosting it for other people.

## First run

1. Choose a name and a PIN. This is a local lock screen, not an account.
2. Open **Settings → Business profiles** and add your name, GSTIN, address, bank and UPI ID. Add a logo and signature if you like.
3. Click **New invoice** and Save. Use **Preview** to download the PDF.
4. Open **Settings → Data & backup**. Download a backup, or connect a folder for automatic backups.

Want to look around first? Load the sample data from the app and remove it again when you are done.

## Privacy, security and limits

Please read this section before you rely on the app for real records.

- **Your data lives only in this browser.** Clearing site data, switching browser or using a private window loses it. Back up regularly; the app nudges you.
- **The PIN is a lock screen, not encryption.** Anyone with access to your browser profile can read `localStorage`. Use the passphrase-encrypted backup (PBKDF2-SHA-256 and AES-GCM-256 through WebCrypto) for files that leave your device.
- **GST reports, e-Invoice and e-Way JSON, and the Tally XML are working papers.** They are built offline from your data. They are *not* validated against the GST portal or a live Tally install. Always check them with your CA and try a small sample first.
- **Not handled in the GSTR helpers:** composition scheme, ISD, imports, amendments and interest.
- **Bank reconciliation** treats the bank as a single account.
- **Foreign-currency documents** are excluded from INR totals, not converted.
- **The balance sheet is indicative only.** Fixed assets, loans and GST remittances are not tracked.
- **`.xlsx` files are not read directly** (that would need a dependency). Export to CSV first.
- **Aggregate turnover** for the GSTR-1 JSON is entered by you in the GST reports screen. Verify it with your CA.

## Architecture

React 19 + TypeScript + Vite 8 (Rolldown), Zustand for the live document, vanilla CSS Modules with design tokens in `src/index.css`. PDF export uses `html-to-image` and `jspdf`; QR codes use `qrcode.react`.

```
src/
  components/   brand, creator, templates, design studio, and one folder per feature module
  layouts/      app shell (grouped sidebar, command palette, bell, PWA prompts)
  lib/          pure, tested logic (calc, GST, reports, exports, backup, auth ...)
  pages/        one file per route
  store/        Zustand store for the document being edited
  types/        persisted shapes (additive-only, never rename a stored field)
tests/          node:test suites for the logic in lib/
```

**Ground rules** (enforced in review):

- No backend and no network calls.
- No Tailwind.
- Persisted field names are additive-only.
- Money goes through `invoice-calc.ts`.
- Indian FY numbering is fixed.
- Bare `YYYY-MM-DD` dates are parsed as local days, never through `new Date(str)`.

## Documentation

| Read | For |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Module contract and the full list of storage tables |
| [`docs/features/`](docs/features) | One page per module: documents, GST reports, e-invoice, books, receivables, purchases, inventory, reconciliation, recurring, security, backup and more |
| [`docs/qa/`](docs/qa) | QA notes for sales, accounts, settings, logic and performance |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed in each release |
| [`PRD.md`](PRD.md) | Product requirements |
| [`AGENTS.md`](AGENTS.md) | Context file for AI coding assistants. Read it first if you use one |

The step-by-step guide with a local-setup walkthrough is at [mrchartist.com/open-source/Invoice](https://mrchartist.com/open-source/Invoice).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Before opening a PR, run:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

CI runs the same checks plus the bundle-size budget on every push and pull request.

## Licence

Released under the [Mr. Chartist Non-Commercial Source License](LICENSE) (version 1.0). In short:

- **Allowed:** use it for your own business or personal invoicing, self-host it for your own use, read it, modify it and contribute back.
- **Not allowed:** selling or reselling it, white-labelling it, or offering it as a paid or hosted service to others.

This is a source-available licence, not an OSI-approved open-source licence. The [LICENSE](LICENSE) file is the only authoritative text.

## Disclaimer

Mr. Chartist is a SEBI Registered Research Analyst (INH000015297). Registration granted by SEBI and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors.

This software is provided as is, without warranty. It is a tool, not tax, legal or accounting advice.
