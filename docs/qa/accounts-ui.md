# QA report: accounts-ui

Scope: Receivables, Books, Expenses, Inventory, GST reports, Exports, Recurring and the
documents / share / einvoice / import components. Tested in headless Chromium against a
production build, at 1440 / 390 px (and spot checks at other widths), light and dark.

## Verified
- All tabs, period presets and filters on every page; empty state of every page (fresh context); no console errors.
- Seeded 14, then 300 invoices + 200 purchases (incl. credit notes, partial payments, old due dates): every page loads in about 1 s, no horizontal page scroll.
- Reconciliation (small and big data): Receivables net outstanding equals the sum of `balance_due`; Books P&L sales (net of credit notes) equals GST reports FY taxable value equals the ledger sum (e.g. 18,84,392 - 1,43,450 = 17,40,942).
- Downloads are non-empty with correct headers: aging CSV, day book CSV, purchases CSV, GSTR-1 JSON, GSTR-3B CSV, Tally masters / vouchers / combined XML, accountant bundle (CSV and JSON).
- Statement viewer and print CSS (`emulateMedia print`) render a clean A4 statement.
- Modals at 390 px: Reminder, e-Invoice, Credit note, Recurring editor, Add bill, Quick expense, Import wizard (all 4 steps).
- Import wizard with a messy fixture (BOM, `;` delimiter, quoted commas and quotes, blank row, bad GSTIN, bad email, duplicate row, empty file, one-line file): parsing, validation and error messages are correct.
- Recurring date preview: month-end clamping (31 Jan -> 28 Feb -> 31 Mar) and leap-day yearly are correct.

## Defects found and fixed
1. Credit note modal (phones): the "Credit qty" input was off-screen behind a horizontal scroll, so the action looked permanently disabled. Table now stacks into per-line cards.
2. Add bill modal (phones): Rate / GST / Amount columns were off-screen. Line items now stack into cards with labels and 44 px controls.
3. Import wizard column mapping (phones): the "Your column" select, match and samples were clipped. Rows now stack.
4. Vendors tab (phones): Edit / Delete actions were off-screen; secondary columns hidden on phones.
5. Export centre: Tally "company name" and the period select clipped ("Mar 202..."); period field now full width.
6. GST reports: default month used `setMonth(-1)`, which shows the wrong month on the 31st of some months; now built from the 1st. "Print summary" failed silently when pop-ups were blocked; now shows a toast.
7. Recurring editor: "the 31th / 29th" ordinal copy; mobile item rows had no visible Qty / Rate labels (placeholders added) and a tiny delete target.
8. Receivables Statements: range presets had no selected state (now `aria-pressed` + highlight); tablist lacked arrow-key navigation (added).
9. Touch targets under 40 px on phones fixed (segmented controls, GST tabs / overview links, day-book links, debtor links). Accessible names for purchase row actions now include the bill number.
10. Contrast: small orange text used `--primary` (about 3.5:1 on paper); switched to `--brand-text` in all my modules.

## Visual changes
All seven pages now use `PageHeader` (icons removed from titles for consistency with Dashboard / Expenses); Receivables, Inventory and Recurring use `StatCard` instead of three private tile copies.

## Found, not fixed (outside my ownership)
- `src/lib/localDb.ts` `settings` read: a legacy flat **array** (as AGENTS.md describes for `mrchartist_inv_settings`) yields an empty profile (companyName ""), so Export centre shows the company-name error. Repro: set the key to `[{companyName:"X",...}]`, open /exports. Failing test: `localDb.settings.activeProfile()?.companyName === 'X'`.
- Import source auto-detect picks "Busy Accounting" for a generic CSV with a "Customer Name" header (`src/lib/importers*`).
- e-Invoice readiness copy: `PIN code must be 6 digits (found "none")` reads oddly when empty (lib).
- Shared `controls.module.css` `.segmentBtn` is about 31 px high; I worked around it only in my pages (Settings, Transactions still affected).
- `surface.statGrid` stacks four full-size cards on phones; a 2-column grid at <=480 px would shorten the page a lot.
- Backup nudge and toasts overlap at the bottom on phones (shell).
- Expenses CSV has no UTF-8 BOM whereas the other CSV exports do (lib / download helper).
- Inventory "Low stock 0 - 1 out of stock" hint is confusing when out-of-stock items are not counted as low.
- Expenses / Inventory tablists have no arrow-key roving focus or `aria-controls`.

## Tests
No pure logic changed; the existing 367 tests pass. `tsc -b`, `npm run lint` (0 errors), `npm test`, `npm run build` all pass.
