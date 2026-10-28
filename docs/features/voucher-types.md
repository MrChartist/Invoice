# Voucher types, bill-wise voucher entry and books import (7Q)

Gap ids **P1-13** (Voucher Types master) and **P1-21** (Excel import of ledgers, vendors, stock items, vouchers) from
`docs/GAP_ANALYSIS.md`, and ROADMAP **7.19** (bill-wise references, voucher classes, single-entry mode on Gateway voucher
entry) and **7.49** (Tally import of inventory quantities, Excel TB template, per-FY auditor export, TDS challans in the
Tally export). Everything is a **working paper — verify with your CA**.

| | |
|---|---|
| Lib | `src/lib/voucher-series.ts` (numbering — first paint, tiny), `src/lib/voucher-types.ts` (master, lazy), `src/lib/gateway/voucher-refs.ts` (pure) + `voucher-refs-save.ts` (writes), `src/lib/import-books.ts` (books import engine), `src/lib/tally-import-stock.ts`, `src/lib/audit-export.ts`, `src/lib/tally-tds.ts` |
| UI | `src/components/voucher-types/{VoucherTypesScreen,VoucherTypeSelect}.tsx` (lazy), Gateway `VoucherEntry.tsx`, Books `VoucherEditor.tsx`, invoice editor `DocumentMetaCard.tsx`, import wizard (`ImportWizard.tsx`, `ChooseFileStep.tsx`), `TallyImport.tsx`, `components/audit/AuditorExport.tsx` |
| Strings | `src/i18n/areas/voucher-types.ts` (`vtT`, English + Hindi); a few keys in `masters.ts`, `gateway.ts`, `migration.ts` |
| Tests | `tests/voucher-types.test.ts`, `tests/gateway-billwise.test.ts`, `tests/import-books.test.ts`, `tests/tally-import-stock.test.ts`, `tests/migration-followups.test.ts`; e2e step "voucher types (P1-13) + Gateway single entry …" in `tests/e2e/smoke.mjs` |

## 1. Voucher Types master (P1-13)

**Where.** Accounts Info → "Voucher types" (`/books?tab=coa&m=voucher-types`, `mastersHref('voucher-types')`), Gateway
Create / Alter → **Y** Voucher type. Role `master.edit` to create / alter.

**Table `voucher_types`** (backed up — `RECORD_TABLES` + `ID_TABLES`; `TABLE_ACTIONS: master.edit`; every row change in the
edit log, `WATCHED_TABLES`; a master, so not in the sync-engine DATED / NUMBERED lists):

| field | meaning |
|---|---|
| `id`, `name` (unique), `base` | base type: `SALES` · `CREDIT_NOTE` · `DEBIT_NOTE` · `RECEIPT` · `PAYMENT` · `CONTRA` · `JOURNAL` (purchase bills keep the supplier's number, so no purchase base) |
| `prefix` (A–Z 0–9 -, ≤ 12) · `suffix?` (≤ 8) | the series; a built-in prefix (INV, CRN, DBN, RV, PV, CV, JV, STR, PO, ADV, RCPT, …) only with a suffix; prefix + suffix unique across types |
| `start_number?` (default 1) · `width?` (digits, default 4) · `restart?` (`monthly`; absent = every FY) | numbering |
| `print_title?` · `template_id?` · `godown_id?` | sales / note types: defaults applied to the document when the type is chosen |
| `bank_account_id?` | receipt / payment / contra types: default cash / bank ledger on Gateway entry |
| `use_for_pos?` | sales types: POS bills are numbered in this type (one type at most — marking another clears it) |
| `inactive?` | hidden from pickers; documents already numbered keep the type and their numbers |

**Numbering contract (Critical Rule 4 kept).** The built-in default type of each base is implicit and never stored: a
document or voucher **without** `voucher_type_id` is numbered exactly as before (`INV/FY25-26/0001`, `RV/FY25-26/0001`;
`tests/localDb.test.ts` unchanged). A user type numbers `<prefix>/FY<yy-yy>/<seq><suffix>`:
- yearly restart: one series per Indian FY (1 April – 31 March, local-day parsing);
- monthly restart: the calendar month joins the prefix — `RET-04/FY26-27/0001` — so each month restarts at 1 and the
  number still reads as an FY series (gap report, GSTR-1 documents-issued, duplicate check);
- next number = one above every number of that series already used, the starting number − 1 and the high-water mark in
  `series_counters` (key `<prefix>[-MM][~<suffix>]/FY<yy-yy>`), recorded on every save — a deleted latest number is never
  issued again.

**Where a type applies.**
- *Invoice editor*: "Voucher type" picker on the Document card, **only when a user type exists for the document's base**
  (lazy chunk, no first-paint cost). Choosing a type sets `voucher_type_id` and applies its print title, template and
  godown; changing the document to another base drops it. Disabled once an existing document has its number.
- *Invoices* (additive `InvoiceRecord.voucher_type_id`, `print_title`; in `RECORD_KEYS` and `normalizeRecord`):
  `localDb.invoices.nextNumber(date, docType, prefix, voucherTypeId)`; `localDb.invoices.save` records the counter.
  `print_title` is a **snapshot** on the document (Rule 3), printed instead of the document label by every layout.
  Conversions, credit / debit notes from an invoice and late-fee invoices start in their own default series
  (`voucher_type_id` / `print_title` not copied). Recurring runs use the template's type; POS uses the `use_for_pos` type.
- *Manual vouchers* (additive `ManualVoucher.voucher_type_id`): picker in the Gateway voucher entry and the Books voucher
  editor when a type of that base exists; `saveVoucher` numbers through the type and keeps a voucher's number on edit
  while its type stays (an inactive type keeps its vouchers).

## 2. Gateway voucher entry: bill-wise references, voucher classes, single entry (7.19)

- **Voucher class** — free text with a list of the classes already used (`knownClasses`); stored in the existing
  `voucher_class` field (register filter).
- **Single-entry mode** (Contra / Payment / Receipt; toggle "Entry mode", remembered per tab in sessionStorage): an
  **Account** (cash / bank ledger) at the top and particulars below, all on one side — Payment and Contra debit the
  particulars, Receipt credits them; the Account line takes the total. Saved as an ordinary double-entry voucher
  (`singleToLines`). A voucher with two cash / bank lines on the Account side cannot be shown single-entry
  (`linesToSingle` returns null; the screen says so). The type's default bank pre-fills the Account.
- **Bill-wise details** open for the party line:
  - *Receipt*, credit to a customer (Sundry Debtors): rows **Agst Ref** (open invoices / opening bills with what is due),
    **New Ref** (name), **Advance**, **On Account**; "Allocate oldest first". Saved with `saveReceiptVoucher`
    (`bill-allocation.ts`) — the voucher and its receipt rows in **one step, all or nothing**; the non-bill remainder is
    one row noted "New ref <name>" / "Advance" / "On account" (additive `remainder_note`). Alter re-reads them.
  - *Payment*, debit to a supplier (Sundry Creditors), **new vouchers**: saved as a **supplier payment** through
    `billwise.ts` `recordSupplierPayment` inside one table rollback (`purchase_payments`, `purchases`,
    `vendor_payments`): Agst Ref rows per bill, the rest New Ref / Advance / On Account. It is then posted by the ledger
    from those rows (bills page, payables ageing, Tally export) and is **not** also a PV voucher (no double count).
    Shape: exactly one supplier Dr line and one Cash / bank-ledger Cr line, else the screen explains.
- Period lock, roles (`books.edit`, `payment.record`) and the audit trail apply through those APIs.

## 3. Excel / CSV import of books data (P1-21)

The import wizard (Settings → Data → Import, Clients page) offers four more kinds — **owner only** (`data.restore`),
because they rewrite the books like a restore:

| kind | columns (synonyms auto-mapped) | written through |
|---|---|---|
| Ledgers & opening balances | name*, group* (Tally group names, Schedule III heads or your groups), code, alias, opening Dr / Cr **or** one signed column ("1,500 Cr", "-1500"), GSTIN | `saveUserAccount`; Sundry Debtors / Creditors groups → `localDb.clients.upsert` / `vendorsDb.save`; openings in **one** `saveOpenings` call (one opening voucher) |
| Suppliers | name*, GSTIN (checked), PAN (else from the GSTIN), state, email, phone, address, Udyam, opening payable (Cr by default, "Dr" = advance) | `vendorsDb.save` (+ `saveOpenings`) |
| Stock items | name*, stock group (created once by name), unit (normalised), HSN, GST %, opening qty / rate (or value ÷ qty), selling rate, reorder level, SKU | `stockGroupsDb.save`, `stockDb.saveItem` |
| Vouchers | voucher no.*, date*, type* (Journal / Payment / Receipt / Contra only), ledger* (chart name / alias, or a customer / supplier → Debtors / Creditors with the party), debit / credit, narration, cost centre (created by name) | `saveVoucher` — **manual vouchers only**, class "Excel import"; never invoices or bills |

- **Dry run first**: the review step is the dry run (`buildBooksPreview` writes nothing): unknown groups / ledgers, bad
  GSTINs, unbalanced vouchers, locked dates, numbers already in the books (never overwritten) are errors per row.
- **One undo copy**: `saveSafetySnapshot('import')` before writing; "Undo this import" on the result screen (or
  Settings → Data) restores it in one step.
- **Templates**: each kind has a downloadable CSV template; **"Trial balance template (openings)"** (`trialBalanceTemplateRows`)
  is the 7.49 Excel-TB path — ledger, group, opening Dr, opening Cr; parties become clients / vendors.
- **Untrusted input**: 25 MB file cap and the table limits of `csv.ts` / `xlsx.ts`; cells trimmed and capped at 500
  characters; names compared as plain strings (group lookups use `Object.hasOwn`, so "__proto__" is just text); the
  error-rows CSV goes through the formula-guarded `toCsv`.

## 4. Migration & audit follow-ups (7.49)

- **Tally import of inventory quantities** (`tally-import-stock.ts`): the item lines of Sales / Purchase / Credit /
  Debit Note / Stock Journal vouchers (`ALLINVENTORYENTRIES`, `INVENTORYENTRIESIN` / `OUT`; direction from
  `ISDEEMEDPOSITIVE`) become `stock_moves` where the stock item matches (existing item, alias, or one the same import
  creates); godown by name; another unit converts through the item's alternate units, else the line is refused.
  `ref_type: 'tally'`, `ref_id: <voucher tag>#<line>` — re-import adds nothing. Written by `stockDb.addMove` (period
  lock, role, audit). **Never GST documents.** A quantity-only stock journal now plans as `stock_only` (its quantities
  import; no voucher), not as an error. The dry run shows "Stock quantities: n to add · m skipped".
- **Excel TB template path** — see §3.
- **Per-FY auditor export** (Settings → Activity → "Auditor export (FY)", `audit-export.ts`): every audit row of the
  chosen Indian FY (local day of each instant, archive segments included) with `prev` / `hash`, plus the verification of
  the whole chain, the chain head, the FY's first `prev` and last `hash` — CSV (formula-guarded) and JSON.
- **TDS / TCS challans in the Tally export** (`tally-tds.ts`, one call line in `tally-xml.ts`): each challan becomes a
  Payment — Dr TDS Payable <section> (linked deductions), TDS / TCS payable (rest), interest & fees | Cr bank / cash —
  from exactly what the ledger posts (`withTdsChallans` reads `loadLedger()` when the Export Center builds its source).

## Shared-file edits

`src/lib/localDb.ts` (nextNumber 4th argument, counter on save), `src/store/useInvoiceStore.ts` (RECORD_KEYS + the type on
save), `src/store/invoice-defaults.ts` (normalise 2 fields), `src/types/invoice.ts` (2 additive fields),
`src/components/templates/{TemplateEngine,parts/GstBody,parts/PaperHeader,parts/ReceiptBody}.tsx` (print title),
`src/lib/{documents,late-fee}.ts` (do not copy the type), `src/lib/{pos,recurring}.ts` (one numbering call each),
`src/lib/ledger/vouchers.ts` (type numbering), `src/lib/bill-allocation.ts` (remainder note), `src/lib/backup.ts`,
`src/lib/access.ts`, `src/lib/audit-edits.ts` (table lists), `src/lib/import-mapping.ts` / `importers.ts` (kinds),
`src/lib/tally-import.ts` / `tally-import-apply.ts` (inventory lines, stock step), `src/lib/tally-xml.ts` (one call line),
`src/components/exports/ExportCenter.tsx` (challan postings), `src/components/masters/{screens.ts,MastersPanel.tsx}`,
`src/lib/gateway/menu.ts`. First-paint JS grew by about 0.45 kB gz (the numbering helper used by the save path).

## Not done

- Voucher types for purchase bills, stock vouchers and payroll series (they keep their own fixed series).
- Bill-wise references when **altering** a saved payment voucher (only new payments become supplier payments), and on
  journals; bill-wise on payables still needs the exact two-line shape.
- Excel import of sales / purchase vouchers (they come in as documents through the opening-invoices kind, or not at all).
- Tally import: batches / serials on item lines, quantities of vouchers whose items are not in the file or the books.
- Audit segment compression and archiving old FYs to a "history" company (rest of 7.49).
