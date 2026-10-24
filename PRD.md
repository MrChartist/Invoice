# Product Requirements & Architecture Document (PRD)

**Project Name:** Mr. Chartist Invoice
**Version:** 3.1.0+ (Full Accounting & GST Edition — roadmap phases 0–3 complete, see `docs/ROADMAP.md`)
**Status:** Stable for daily use. GST, e-Invoice, e-Way and Tally outputs are **working papers** — verify with your CA before filing.
**Official Site:** [https://mrchartist.com](https://mrchartist.com)

---

## 1. Product Overview

Mr. Chartist Invoice is a professional, local-first web application for financial consultants, Indian traders,
businesses and freelancers to issue GST-compliant invoices and keep everyday business accounts — with no backend
server, no account, and no subscription. It runs entirely in the browser and works offline as an installable app.

---

## 2. Core Pillars

1. **Data privacy**: 100% of data lives on the user's device (`localStorage` / IndexedDB). No telemetry, no cloud
   database, no tracking, no third-party requests (fonts are self-hosted; a strict CSP blocks remote origins).
2. **Professional documents**: 26 templates plus a Design Studio, A4 / A5 / 80 mm thermal paper, UPI QR codes, and a
   bilingual (English + Hindi) layout.
3. **Historical integrity (snapshotting)**: each saved document embeds the sender profile it was issued with, so
   editing your business details or bank account never alters past invoices.
4. **Offline-first PWA**: precached app shell, folder backups (Chrome/Edge File System Access API), works with no
   network.
5. **GST & accounting workflow**: CGST/SGST/IGST, cess, TCS, TDS, RCM, exports/SEZ/LUT, GSTR-1/3B working papers,
   books, BRS, inventory, Tally XML.
6. **No backend, minimal open-source dependencies** (React, Zustand, React Router, jsPDF, html-to-image,
   qrcode.react, lucide-react, clsx, uuid).

---

## 3. Key Feature Modules

### 3.1 Sales & Document Management
- **Document types**: Tax Invoice / Invoice, Quotation, Sales Order, Proforma, Delivery Challan, Credit Note and Debit Note.
- **Conversions**: Quotation → Sales Order / Proforma → Invoice ⇄ Delivery Challan (the original is kept and linked).
  Credit and debit notes are raised against issued invoices and linked to them.
- **Sales orders** (`SO/FY25-26/0001`): a non-tax order document (never revenue, GST, books, receivables or stock).
  It converts **partially** into challans and invoices — each conversion pre-fills only the quantity still pending — and
  shows ordered / delivered / invoiced per line with status Open / Partly fulfilled / Fulfilled / Closed.
- **Purchase orders** (`PO/FY25-26/0001`, Expenses → Purchase orders): vendor, lines, expected date, printable PO;
  "Convert to bill" pre-fills the bill with what is still to be received; status Open / Partly received / Received / Closed.
- **Quotation outcomes**: Accepted / Declined recorded by the user; Expired and Converted derived automatically.
- **Series numbering**: Indian financial-year series (`INV/FY25-26/0001`, resets 1 April; own series per document
  type, e.g. `CRN/`, `DBN/`), per-profile prefixes, Rule 46 duplicate refusal, a gap warning at save time and a
  whole-year series-gap list on the GST Documents tab.
- **Fast entry**: Tally-style keys (Enter adds a line, Ctrl/⌘+Enter or Ctrl+S saves), inline type-ahead for clients and
  catalogue items, command palette (Ctrl+K), first-run setup wizard.
- **Ship-to / consignee address**, taxable freight option (Sec 15), foreign-currency documents with an exchange rate.
- **Recurring invoices** with schedules, generated in the background.
- **Credit control**: per-client credit limit and credit days; the editor warns (never blocks) when outstanding + the
  new invoice exceeds the limit, a bill is older than the credit period, or the client's cheques bounced.
- **Cheque register** (`/cheques`): cheques received / issued with deposit, clearing (records the payment), bounce
  (reverses it) and cancel; post-dated cheque reminders in the notification bell; cheque printing on CTS-2010 leaves
  with mm offsets, amount in Indian-system words and A/C Payee crossing.
- **Cash planning**: 30/90/180-day cash-flow forecast (weekly, from open invoices shifted by each client's payment
  delay, bills, cheques, recurring schedules); realised exchange gain/loss on foreign receipts and a period-end
  revaluation report; party and item profitability.
- **Time & billable costs** (`/time`): a running timer (start / pause / stop, survives reloads, header pill), weekly
  timesheet grid, manual entries, mileage log, per-entry rounding (6/10/15/30 min, nearest or up), CSV / .xlsx export.
  "Bill" turns a client's unbilled hours (unit HRS, SAC 998311 by default), re-billable expenses (cost + markup, or a
  0% Rule 33 pure-agent reimbursement) and trips into a new draft invoice; deleting or cancelling that invoice frees
  them again.
- **Attachments**: receipt photos and PDFs on purchase bills, expenses and invoices (photos downscaled, PDFs up to
  3 MB, type checked by magic bytes), stored once on the device and carried in backups; never printed. Unused files are
  cleaned up on delete or from the storage-health panel.
- **Custom fields**: user-defined text / number / date fields on documents, items and clients / vendors, optionally
  printed in a "Details" box (and under item lines). Saved invoices keep the labels they were saved with; the sales
  register CSV gains a column per field used.
- **Sharing**: the PDF itself through the OS share sheet (WhatsApp, mail), a self-contained "client copy" web page with
  a Pay-with-UPI button, WhatsApp / e-mail / SMS text with UPI links.
- **Reminders**: stage-based templates (upcoming, due today, polite / firm / final overdue, thank-you) in English and
  Hinglish with UPI payment links; a reminder log; "Payments to chase" ranked by an explainable priority score (days
  overdue, amount, the client's other overdue bills, ignored reminders).

### 3.2 GST & Compliance Engine
- **Intra- vs inter-state tax**: automatic CGST + SGST vs IGST from place of supply and GSTIN state code.
- **Advanced tax**: cess, TCS, TDS (date-keyed section rates), reverse charge, SEZ / export / LUT / deemed export,
  exact paise rounding. Statutory values that change over time live in `src/lib/tax-rules.ts`, keyed by effective date.
- **e-Invoice & e-Way**: offline IRP v1.1 e-Invoice JSON (INV / CRN / DBN, preceding-document details filled from the
  linked invoice, export details) and e-Way Bill JSON generators, with pre-flight validation. The IRN, Ack No and signed
  QR returned by the IRP are entered back and printed on every template. Bulk: one IRP / e-Way JSON for many invoices
  (each preflighted, blocked ones listed with reasons) and bulk import of the IRP response file (JSON or CSV) into the
  saved IRN / Ack / QR. (The app does not call the IRP.)
- **GST reports**: GSTR-1 (B2B, B2CL by date-keyed threshold, B2CS, CDNR/CDNUR with C/D notes classified by the
  original invoice, EXP with shipping-bill fields, nil, HSN summary split B2B/B2C with the 4/6-digit rule, documents
  issued) as offline-tool JSON and section CSVs; GSTR-3B (3.1, 3.2, 4 incl. imports, RCM and 4B(1)/4B(2) reversals, 5)
  as JSON, CSV and a printable summary; aggregate-turnover support. Section CSVs are also offered as .xlsx.
- **GSTR-2B / IMS matcher**: load the portal's GSTR-2B (JSON or Excel) locally; documents are matched to purchase
  bills on supplier GSTIN + normalised bill number with value / tax / date tolerances and classified as matched,
  value mismatch, in 2B only, in books only (ITC at risk, Sec 16(2)(aa)) or ITC not available. An IMS worksheet
  (Accept / Reject / Pending per document) exports as CSV or .xlsx, missing bills can be created from 2B lines, and
  GSTR-3B Table 4A(5) from the books is compared with the 2B-restricted figure (the 3B report is not changed).
- **GSTR-9 working paper**: annual Tables 4-9, 17 and 18 from the 12 monthly GSTR-1 / 3B papers and purchase bills
  (6B inputs / services split, 6C/6D RCM, imports, Table 7 reversals by rule, Table 9 set-off with credit carried
  forward), differences GSTR-1 vs 3B vs books, the ₹2 crore optional-filing note; JSON working paper, CSV and print.
  Advances, amendments (Pt V) and 8A (GSTR-2B) are not computed.
- **Compliance calendar**: GSTR-1 / IFF / GSTR-3B / GSTR-9 due dates for monthly or QRMP filers, filed tracking,
  Sec 50 interest and late-fee estimates, reminders in the notification bell.

### 3.3 Accounts, Books & Banking
- **Late fee per client** (optional): % p.a. or flat ₹ with grace days on the client; "Add late fee" on an overdue
  bill creates a new draft invoice with one line (interest engine maths, period lock respected, original untouched).
- **Receivables**: party ledgers, aging by days overdue (Not due, 1–30, 31–60, 61–90, 90+), DSO, printable statements,
  payment receipts (`RCPT/FY/…`) with amount in words, bulk mark-paid, TDS receivable register with 26AS/AIS CSV
  matching and Form 16A tracking.
- **Purchases & payables**: vendor bills and expenses, ITC tracking, RCM, imports (Bill of Entry), ITC reversal reasons,
  Sec 17(5) blocked credit, period-locked; MSME (Udyam) vendors with 45/15-day limits, Sec 43B(h) disallowance and
  MSMED interest.
- **Books**: Day Book, Cash Book, Bank Book, Profit & Loss (accrual and cash basis), plus a double-entry ledger:
  Schedule III chart of accounts, journal / contra / payment / receipt vouchers, trial balance, ledger drill-down,
  Schedule III balance sheet with a fixed-asset register (Income-tax Act WDV depreciation) and an AS 3 cash-flow
  statement. Books are derived from documents and payments: every invoice, note, receipt, bill and supplier payment
  posts automatically (computed on the fly, never stored twice), and manual vouchers cover capital, loans, drawings,
  GST payments and other adjustments (`docs/features/ledger.md`).
- **Cost centres / projects & budgets** (Books → Projects / Budgets): tag invoices (or single lines), bills, expenses,
  voucher lines, time and mileage with a project, department or branch; a Project P&L shows income, direct costs,
  margin and net per cost centre plus Unallocated, tying to the P&L. Budgets per Indian FY and income / expense
  account (optionally per cost centre), annual-spread or monthly, with month / quarter / YTD budget vs actual,
  favourable / adverse variance, CSV / .xlsx, and "copy last year's actuals ± x%" (`docs/features/cost-centres-budgets.md`).
- **Bank reconciliation (BRS)**: CSV statement import with auto-detected HDFC, ICICI, SBI, Axis and Kotak layouts,
  scored match suggestions you confirm, printable BRS.
- **Inventory**: FIFO and weighted-average costing, stock positions, shortage warnings while drafting an invoice.
  Opt-in per item: **batches** with MFG / expiry / MRP on bills, FEFO batch pre-selected on sales, expired batches
  need confirmation, expiry alerts (bell + Inventory, window configurable, default 30 days), stock by batch;
  **serial / IMEI numbers** (one per unit on bills, picked from stock on sales, never sold twice, returned by a credit
  note that names them) with warranty months and a serial lookup (bill, vendor, invoice, client, warranty status).
  **Godowns** appear once a second godown exists: godown per bill / invoice line, stock per godown, stock transfer
  vouchers `STR/FY25-26/0001` (period lock + audit, no books posting). Costing stays company-wide.
- **Controls**: audit trail of every change with a tamper-evident hash chain and exportable head hash; "lock books up
  to" period lock enforced in the data layer with PIN-guarded, audited overrides.

### 3.4 Data Portability & Accountant Handoff
- **Tally Prime XML**: sales, credit notes, receipts (with TDS receivable), purchases, freight and export conversions.
- **CSV registers**: generic sales / purchase / receipt registers that import into Zoho Books, Vyapar or Busy with
  column mapping; CSV import wizard for clients, items and invoices.
- **Backup & encryption**: JSON export/import with validation and an undo copy, automatic folder backups (optionally
  AES-GCM-256 encrypted with a stored non-extractable key, read back after writing), passphrase-encrypted exports,
  storage-health panel.
- **Security**: PIN lock (PBKDF2-SHA-256, 600k iterations, lockout, idle lock, locks every tab), strict CSP via
  headers and a build-time meta tag. A 4–6 digit PIN is a lock screen, not encryption of the stored data; use vault
  mode for that.
- **Vault mode** (optional): the whole store encrypted at rest with AES-256 under a passphrase-wrapped key, unlocked
  at start-up; a lost passphrase means lost data (no recovery by design).
- **Separate companies**: several businesses on one device, each with its own data, numbering, settings, backups
  and vault; switch from the sidebar. The PIN is shared; erase/backup/restore act on the open company.
- **Erase all data**: requires typing `ERASE`; also clears the undo copy, backup key, backup-folder link and vault.

---

## 4. Technical Architecture

- **Frontend**: React 19 + TypeScript 6 (strict) + Vite 8 (Rolldown bundler); every page except Dashboard and Login is
  code-split.
- **State**: Zustand (`src/store/useInvoiceStore.ts`) for the editor; storage layer in `src/lib/storage.ts` with
  versioned migrations (`src/lib/migrations.ts`).
- **Styling**: vanilla CSS + CSS Modules with tokens in `src/index.css`. No Tailwind.
- **PDF**: `html-to-image` + `jspdf` (multi-page, client-side). **QR**: `qrcode.react`. **Icons**: `lucide-react`.
- **Quality**: node:test unit and integration tests, Playwright end-to-end journey and offline/service-worker checks in
  CI, bundle-size budgets.

---

## 5. Known Limitations

- GST, e-Invoice, e-Way Bill and Tally outputs are working papers, not portal-validated; JSON key layouts that are not
  verified against the current offline tools are marked in the code. Verify with your CA.
- No direct portal / IRP / bank / payment-gateway connection (by design: no server).
- Bank reconciliation treats bank as a single account.
- The ledger does not value closing stock or handle fixed-asset disposals automatically — post them with a journal
  voucher. Realised exchange differences are posted automatically when a receipt carries its realised rate;
  unrealised (period-end revaluation) differences are reported only — post the reversing journal if your CA wants it.
- RCM and import bills: the ledger credits the tax to "GST payable — reverse charge" / "IGST payable on imports";
  the purchases module and Tally export still carry the bill total (including that tax) as the supplier balance.
- Exchange gain/loss is computed only for receipts where the realised rate is entered (no automatic FX rates — no
  server). GST always uses the invoice-date rate; exchange differences never change GST figures.
- Cheques link to a single invoice / bill; clearing does not auto-record against foreign-currency invoices. The
  cash-flow forecast is an estimate from due dates, payment history, bills, cheques and schedules (taxes, loans and
  salaries only when entered as bills).
- `.xlsx` is read and written by a built-in, dependency-free reader/writer (first sheet for imports). Legacy `.xls`,
  `.ods`, password-protected and ZIP64 workbooks are not supported; save them as `.xlsx` or CSV.
- The GSTR-2B matcher reads B2B/B2BA/CDNR/CDNRA from the Excel download and additionally ISD / IMPG / IMPGSEZ from
  the JSON; supplier credit notes are not recorded in purchases, so they show as "in 2B only".
- Pure-agent reimbursements are billed as 0% lines but the underlying expense still shows in Books / P&L as a cost
  (and the reimbursement as income); the Rule 33 conditions are the user's call — verify with your CA.
- Cost-centre allocations are not included in the Tally XML or accounting CSVs; one cost centre per line (no
  percentage splits), one level of grouping.
- Editing or removing lines on a bill-from-time invoice does not unlink the entries; only deleting or cancelling the
  invoice frees them.
- Attachments live in browser storage like everything else: a few hundred receipts make backups large (base64 JSON);
  without IndexedDB (localStorage fallback) only a handful fit. Duplicated / converted documents do not copy them.
- Custom fields are not available on purchase bills / expenses or recurring templates and are not part of the GSTR,
  e-Invoice or Tally outputs.
- Data lives in one browser; use backups (or the encrypted folder backup) to move between devices.

---

## 6. Non-Commercial Licensing

Released under the **Mr. Chartist Non-Commercial Source License**. Free for individuals and businesses to use
internally; commercial resale, white-labeling, or hosting as a paid commercial SaaS product is strictly prohibited.
