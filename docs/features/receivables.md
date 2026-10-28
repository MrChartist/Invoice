# Receivables (party ledger and outstanding reports)

Tally-style sales ledger per party, bill-wise outstanding, aging, collections, DSO, and a printable client statement.
Read-only on `invoices`, `transactions` (payments) and `clients`. The only thing it writes is the
Form 16A flags of the TDS tab (`tds_certificates`).

- **Route:** `/receivables` (optional query: `?tab=aging|statements|collections|tds&party=<client id or "name:<lowercased name>">`)
- **Nav label / icon:** `Receivables` / `Scale` (alternatives: `HandCoins`, `BookOpenCheck`)
- **Tables used:** `invoices`, `transactions`, `clients` (read only); `tds_certificates` (TDS tab, read/write).

## Wiring the lead must add

`src/App.tsx`:

```tsx
import { Receivables } from './pages/Receivables';
// …
<Route path="/receivables" element={<DashboardLayout onLogout={() => setAuthed(false)}><Receivables /></DashboardLayout>} />
```

`src/layouts/DashboardLayout.tsx` (nav array, e.g. after Transactions):

```tsx
import { Scale } from 'lucide-react';
{ label: 'Receivables', path: '/receivables', icon: Scale },
```

Optional cross-links:

```tsx
// Clients page row action: open that client's statement
<Link to={`/receivables?tab=statements&party=${client.id}`}>Statement</Link>
// Dashboard "Pending" card
<Link to="/receivables">View aging</Link>
```

## Library: `src/lib/receivables.ts` (pure, tested in `tests/receivables.test.ts`)

| Export | Purpose |
| --- | --- |
| `buildReceivables({invoices, payments, clients, advances?, openingBills?, links?}, {currency?, now?})` | Returns `ReceivablesReport`: `parties[]` (bills, buckets, gross, creditNotes, advances, net, entries) and `totals`. |
| `buildLedger(party, from?, to?)` | `Ledger` with opening balance (everything before `from`), in-range entries with running balance, totals, closing. |
| `topDebtors(report, n)`, `debtorShare(report, party)` | Ranking of parties with a positive net. |
| `monthlyCollections(report, months, now)`, `overallEfficiency(rows)` | Billed vs credited vs received per month, with efficiency %. |
| `computeDso(report, windowDays = 90, now)` | Net receivables ÷ net sales in the window × days. `null` if there were no sales. |
| `buildStatementText({sender, party, ledger, currency})` | WhatsApp/email plain text (`*bold*` markers, open bills, UPI/bank details). |
| `statementCsv(ledger)`, `agingCsv(report)`, `toCsv`, `csvCell` | CSV with formula-injection guard. |
| `closingInWords`, `compactMoney`, `niceMax`, `dateKey`, `partyKeyOf`, `currenciesIn`, `isLedgerDoc`, `AGING_BUCKETS` | Helpers. |

### Accounting rules
- **Debit** is a live invoice (`INVOICE` / `TAX_INVOICE`). **Credit** is a payment or a `CREDIT_NOTE`.
- Draft, Cancelled, Quotation, Proforma and Delivery Challan are excluded (a Draft credit note too — the dashboard's outstanding skips it as well). Payments pointing at an excluded or unknown invoice are ignored.
- **Outward reverse charge:** a bill on which the recipient pays the GST is receivable at `receivableTotal(inv)` (`src/lib/rcm.ts`) — the taxable value (+ untaxed charges / TCS); an older record whose stored total includes the tax is read without it. The same figure drives aging, the dashboard, payment "balance", reminders, share / UPI amounts, interest and the credit-limit check; recording a payment of the taxable value marks the bill Paid.
- Party key is the client `id`, else the case-folded name (so "Beta Co" and "beta co" merge).
- **Legacy rows:** an invoice with `status: 'Paid'` or `amount_paid` greater than its payment rows gets a derived receipt for the difference. It is dated `updated_at` and flagged `derived: true`. This matches how the Transactions page marks invoices paid. A Paid invoice is settled by receipts **and** its linked credit notes, so the derived receipt is at most total − credited (a credit note never invents a receipt).
- **Amount due (`src/lib/amount-due.ts`, the one definition):** due = receivable total − TDS − received − live credit notes linked through `doc_links` (`linkedCredits`, `amountDue`). The invoice status follows it (`settledStatus`, used by `localDb` on every payment change and when a linked credit note is issued, edited, cancelled, reinstated or deleted): Paid once due ≤ 0.005, Partially Paid once a receipt or a credit note settled part of it. `balance_due` keeps its stored meaning (total − TDS − received). Reminders, due-soon / overdue notifications, the dashboard (outstanding and attention list), the Transactions balance column, record-payment and bulk "mark paid" amounts all read `amountDue`. A debit note is its own receivable document (own due date, payments and status), so it is never added to the original's due.
- **Bill-wise credit notes (`BuildInput.links`):** a live credit note linked to a live invoice of the same party is allocated to that bill: the bill's `outstanding` is net of it (`Bill.credited`), aging and the khata queue chase only the rest, and only the unallocated part (credit beyond what receipts left open, or an unlinked note) counts in `creditNotes`. Ledger entries and `net` do not change. Every app caller passes the `doc_links` table.
- **Advances:** an overpayment on an invoice, and any payment row with no `invoice_id` but a `client_id` or `client_name`, becomes an advance. These are optional additive fields on the payment row. Other modules may write them, and `ReceiptRow` documents the shape.
- **POS refunds (QA-3 F2, `BuildInput.refunds`, `posRefunds(pos_returns)`):** money paid back against a live credit note (a refund by tender, or an applied exchange whose voucher debits the whole credit) is a debit to the party and uses up that much of the note's credit before it is allocated to its bill or kept as a credit. Only returns whose refund voucher was booked count. A Paid bill's settled part still uses the gross credit, so no receipt is invented.
- **Advance receipts (5.3, `advances` table, `BuildInput.advances`):** the advance voucher is a credit when received, a refund a debit; the payment row with `advance_id` that applies it settles the bill but is shown as an information line with no amount (the money already came in with the advance). The unadjusted balance counts in `advances`. The **Advances** tab (`?tab=advances`) records, prints, applies and refunds them — see `advances.md`.
- **Net** = open bills − unallocated credit notes − advances. It always equals the ledger closing balance over the full history (tested). A negative net means the party is in credit.
- Aging buckets come from `agingBucket()` (`Not due`, `1–30`, `31–60`, `61–90`, `90+ days`) and cover bills only. Credits are shown in their own column, as Tally does.
- Reports are per currency. The page shows a currency picker only when more than one is in use.

## UI

- `src/pages/Receivables.tsx` (+ `.module.css`). Exports `Receivables`. Tabs:
  - **Aging:** stacked bar, top debtors, and a party × bucket table whose rows expand to show bills.
  - **Statements:** party and date range with presets (This FY, Last FY, Last 90 days, All time), ledger table, Copy text, Email (`mailto:`), Print/PDF.
  - **Collections:** SVG billed-vs-received chart and a month table.
  - **TDS:** the TDS receivable register (see below). `src/components/receivables/TdsTab.tsx` is `React.lazy`
    inside the page, so it and the 26AS parser load only when the tab is opened.
- `src/components/receivables/StatementDocument.tsx` is the A4 white paper. It takes `{sender, party, client?, ledger, currency?}` and forwards a ref.
- `src/components/receivables/StatementViewer.tsx` is the full-screen preview with Print, CSV and PDF. It takes `{open, onClose, onError?, ...StatementDocumentProps}`. Printing hides `#root` through a `statement-printing` body class.
- `exportUtils.ts` has `exportNodeToPdf` (dynamic import of `html-to-image` and `jspdf`, sliced into A4 pages), `downloadTextFile` and `safeFilename`.
- `Charts.tsx` has `AgingStack`, `AgeChip`, `ShareBar` and `CollectionsChart`.
- The sender profile comes from `localDb.settings.activeProfile()`, not from a per-invoice snapshot, because a statement spans many invoices.

## TDS receivable register (`src/lib/tds-register.ts`, tested in `tests/tds-register.test.ts`)

Customers deduct TDS from what they pay. Invoices already carry `tds_enabled / tds_section / tds_rate /
tds_amount`; `buildReceivables` treats the withheld TDS as settled and Tally export posts it to TDS Receivable.
The register answers "how much TDS should I see in 26AS, from whom, for which quarter, and do I have the Form 16A?".

**Client master:** `Client.pan?` (AAAAA9999A, `isValidPan`) and `Client.tan?` (AAAA99999A, `isValidTan` in
`src/lib/validators.ts`), both optional and additive. Edited in `ClientFormModal` (PAN can be filled from the
GSTIN in one click), shown under the GSTIN on the Clients page and searchable. `/clients?edit=<id>` opens a
client's editor (the TDS tab's "Add TAN" link). They are **not** added to `InvoiceRecord`; the register reads
the live client master by id and falls back to the invoice's client snapshot. No migration is needed.

| Export | Purpose |
| --- | --- |
| `tdsPeriodOf(day)`, `periodKey`, `fyLabel`, `quarterLabel`, `quarterRange`, `form16aDueDate` | Indian FY quarter maths on `YYYY-MM-DD` strings (never `new Date(str)`). Q1 Apr–Jun … Q4 Jan–Mar; 31 Mar is FY Q4, 1 Apr is the next FY's Q1. Form 16A due 15 Aug / 15 Nov / 15 Feb / 15 Jun. |
| `tdsInvoiceLines(input)` | One line per live INR invoice (`INVOICE`/`TAX_INVOICE`, not Draft/Cancelled, not credit notes) with `tds_amount > 0`, bucketed by issue date, with party key (same `partyKeyOf` as receivables), PAN/TAN, section and a `settled` flag. |
| `buildTdsRegister(input, {today?, fy?})` | Rows per quarter × deductor × section: invoice count, taxable, total, **TDS expected** (all TDS invoices), **TDS settled** (invoices paid in full: status Paid, or payments + TDS ≥ total), **pending**, and **Form 16A status** (`received` / `awaited` / `overdue` after the due date). Also quarter blocks with totals and certificate counts, overall totals and the FYs present. |
| `setCertificate(rows, change)`, `certKey`, `certificateStatus`, `TDS_CERT_TABLE` | Form 16A flag per deductor × quarter. Unticking removes the row. |
| `parseTdsCsv(text, mapping?)`, `guessTdsMapping(headers)`, `TDS_CSV_FIELDS`, `sectionCode`, `normalizeTan`, `normalizeDeductorName` | 26AS / AIS CSV reader. |
| `reconcileTds(credits, input, {tolerance?, fys?})` | Matched / only-in-26AS / only-in-books. |
| `tdsRegisterCsv(register)`, `tdsReconCsv(recon)` | CSV downloads through the shared formula-safe `toCsv`, each ending with the "verify with your CA" line. |

**`tds_certificates` table** (`mrchartist_inv_tds_certificates`, picked up by backup automatically):
`{ id: "<party key>|<fy>-Q<n>", party_key, party_name, fy, quarter, received, received_on?, certificate_no?, updated_at }`.

### 26AS / AIS CSV assumptions
- The user downloads Form 26AS Part I or the AIS TDS section and saves/exports it as a **flat CSV** (one row per
  credit). The TRACES text file with nested deductor summary rows is not parsed as such.
- Parsed with `src/lib/csv.ts` (`parseTable`): BOM, `,` `;` tab `|` delimiters, title rows above the header and
  Excel `="…"` cells are tolerated. Columns are matched by name with `scoreHeader` from `import-mapping.ts`,
  each column used once, best score first. Recognised spellings include "Name of Deductor", "Deductor Name",
  "Information Source", "TAN of Deductor", "Section" / "Section Description", "Transaction Date",
  "Date of Payment/Credit", "Amount Paid/Credited", "Amount Paid or Credited", "Tax Deducted", "TDS Deducted",
  "TDS Amount" — "Tax Deducted" wins over "TDS Deposited" when both exist.
- Required: a transaction date and a TDS amount, plus a deductor name **or** TAN. Amount paid and section are
  optional. AIS-style "ACME LTD (MUMA12345B)" yields both name and TAN.
- Dates via `importers.parseDate` (day-first: `10-May-2025`, `10/05/2025`, `2025-05-10`, `15 Feb 2026` …);
  amounts via `importers.parseNumber` (Indian grouping, `₹`, brackets). Zero-TDS rows are skipped and counted;
  "Total" rows are ignored; unreadable rows are listed with their line number.
- Section text like "194J - Fees for professional services" is reduced to the code (`194J`).
- The uploaded file is processed in memory and not stored.

### Matching rules
1. A credit is attributed to a client by TAN (client master or invoice snapshot), else by normalised name
   (case, punctuation, "M/s", "Pvt", "Ltd", "Limited", "LLP"… ignored; client name and company both tried).
2. Same deductor + same quarter: one credit ↔ one invoice whose TDS is within the tolerance (default ₹1 per entry,
   since 26AS rounds to the rupee). Same section preferred, then the smallest gap, then the closest base amount.
3. Same deductor + quarter, the leftovers on both sides agree in total (within tolerance × entries) → one
   "quarter total" match (a deductor that books several invoices in one entry).
4. Same deductor, **neighbouring** quarter (including across 31 Mar / 1 Apr), line-level → match flagged
   "other quarter" (TDS deducted on payment rather than on the invoice).
5. Everything else is **only in 26AS** (flagged when the deductor is not a known client) or **only in books**
   (limited to the FYs the file covers).

### Not done / limits
- Bucketing is by invoice date; customers who deduct on payment show up via the neighbouring-quarter rule only.
- Partly paid invoices count as pending in full (no pro-rata TDS on part payments).
- Credit notes do not reduce TDS expected. Non-INR invoices are excluded.
- No manual pairing of unmatched lines, and reconciliation results are not saved.
- Working papers only, not validated against TRACES — verify with your CA.

## Notes
- No network calls, no new dependencies. All colours use theme tokens. The statement paper keeps its own neutral palette, like the invoice paper.
- `docs/ARCHITECTURE.md`, `src/lib/stats.ts` (`isRevenueDoc`) and the `PageHeader`, `StatCard`, `NumberInput` and `types/purchases.ts` files were not present in this worktree. The page uses `surface.module.css` directly, and `isLedgerDoc` mirrors the revenue-doc rule. If `isRevenueDoc` lands, swap it in.

## Receipts and the paid-in-full step

`src/lib/receipts.ts` builds payment receipts. `RCPT/FY<yy-yy>/<seq>` is **stamped** on the payment when it is recorded
(`Payment.receipt_number`, additive; `localDb.payments.record` → `nextReceiptNumber`): one above the highest stamped
number of that FY, the count of older unstamped payments in that FY and the `series_counters` high-water mark, so a
deleted payment or a bounced cheque never renumbers another receipt and no number is issued twice. Payments recorded
before stamping keep a derived number — their date-order position among the *unstamped* payments of the FY — so their
printed numbers do not change, and new stamps start above them (decision: derive for legacy rows, continue after the
max for new ones; nothing is migrated). Advance adjustments take no RCPT number. `buildReceipt` adds the amount in words and the
balance left after that payment (net of TDS), and `receiptHtml` renders a script-free page that prints from a plain
window under the CSP (a blocked pop-up saves it as HTML instead). Each payment in the payment dialog has a Receipt
button; a payment that clears the balance shows **Paid in full** with Receipt and **Send thank-you** (the existing
`thank_you` reminder template). The reference field is labelled by method (UTR for bank/UPI, cheque number …).

## Late-fee line per client (roadmap 6.15)

Optional and off unless a client has terms. **Clients → edit client → Late-payment terms**: none, *Interest, % per
year* (`percent_pa`) or *Flat fee, ₹* (`flat`), plus grace days. Stored additively on the client as
`late_fee?: { mode: 'percent_pa' | 'flat'; rate: number; graceDays: number }` (sanitised by
`src/lib/late-fee-rule.ts`: % capped at 100, flat at ₹10 lakh, grace 0-365; a zero rate is no rule).

In **Receivables → Aging**, an overdue bill of such a client shows **Add late fee**. It creates a **new draft
invoice** (today's date, next number in the original's series and profile prefix, same client / sender / place of
supply / currency, the default due days) with one line, and opens it in the editor for review. The overdue invoice is
never edited; the new one carries `late_fee_for: <original id>` (additive `InvoiceRecord` field, cleared on duplicate,
conversion and notes), and the button disappears once a non-cancelled late-fee invoice exists for that bill.

Maths (`src/lib/late-fee.ts`, reusing `computeInterest` from `src/lib/interest.ts`):

- `percent_pa`: simple interest at the rate on a 365-day year on the unpaid balance, from the day after
  `due date + grace days` to today; part-payments and linked credit notes reduce the balance from their date; a
  settled invoice stops on the day it was cleared. Principal is total − TDS.
- `flat`: the fixed amount once the bill was unpaid for at least one day after `due date + grace days` (paid within
  grace: no fee; paid late: fee).
- Under Sec 15(2)(d) CGST Act interest / late fee for delayed payment is part of the value of supply, so the line takes
  the principal supply's GST rate (`principalTaxRate`: the rate carrying the largest taxable value on the original;
  export / LUT zero-rating carries over with the copied supply type), and the HSN / SAC and goods-or-service `type` of
  the principal supply's line (`principalItem`: the largest line at that rate), so GSTR-1's HSN summary and the
  e-Invoice get a code. Reverse charge carries over too (the new document is calculated the current way). It is a
  draft: verify with your CA and edit before issuing. Whether a fee can be charged depends on the agreement with the
  customer.
- The late-fee invoice is an **INR** document dated today: it never inherits the original's `exchange_rate` (which
  belongs to the original's date). A flat fee is a rupee figure; interest on a foreign-currency bill is worked out in
  that currency and converted at the original's exchange rate (the rate its receivable is booked at).
- Terms come from the client master (matched by id, else name + GSTIN), falling back to the client snapshot on the
  invoice.
- Period lock: when today falls inside the locked period the action refuses with the lock message (the save would also
  refuse it). Drafts, cancelled documents, quotations and invoices not yet past the grace period get no fee.

Tests: `tests/late-fee.test.ts`. The older Settings-level interest estimate (`late-fee-irn-demo.md` §2) is unchanged and
separate: it informs reminders; this rule creates the invoice line.

## Daily khata loop (8A, `docs/features/khata.md`)

- **Clients** leads with the party balance from `buildReceivables` (incl. opening bills and advances): *To collect* /
  *Advance* / *Settled*, overdue line, sort by balance, **Overdue only** chip, header totals *You'll get / You'll give*.
- **₹ Received** (Clients row, Statements tab): one receipt split over the open bills oldest first (editable), the rest
  on account, saved all or nothing by `savePartyReceipt` (`bill-allocation.ts`) — `localDb.payments.record` rows tagged
  `client_id` / `client_name` plus one invoice-less on-account row with its own `RCPT/FY…` number. Books now names the
  party on such on-account rows (it used to say "Unknown customer").
- **₹ Given**: one-line Bill of Supply (composition) / non-GST bill (no GSTIN), or the invoice editor prefilled with
  the party (`/invoice?party=<client id>`) for a GST registrant.
- **WhatsApp statement** on the aging rows, the Statements tab and the statement viewer; the viewer also has **Share
  PDF** (Web Share Level 2, download fallback) and **Web page** (static statement page with a Pay-with-UPI panel + QR).
- **Remind all overdue** / **Send everyone their balance** in the page header open the party reminder stepper.

## 8G additions
- Ageing uses `effectiveDueDate` (earliest unpaid instalment of a `payment_schedule`, else the due date).
- **Bulk actions** (ageing bucket filter): bulk remind and bulk bad-debt write-off (`write-off.ts`). See `docs/features/invoicing-ux.md` § 8.100 / 8.106.
