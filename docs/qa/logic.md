# Logic QA — money, tax and cross-module agreement

Scope: `src/lib/**`, `src/store/**`, `src/types/**`, `tests/**`. Baseline `a9cf530`.
Method: independent hand arithmetic (shown in the test comments), end-to-end scenarios through the
Zustand store and the storage-backed lib APIs, seeded fuzzing against exact BigInt paise arithmetic,
and a line-by-line review of every `src/lib/*.ts`. `npm test`: 367 -> 460 tests, all green.

Persisted field names are unchanged (additive only): new optional fields are listed under "Additive API".

## 1. Scenarios verified (all in `tests/`)

| Area | Test file | What is proven |
|---|---|---|
| (a) invoice lifecycle | `integration/lifecycle.test.ts` | Mixed 5/12/18% slabs, line discount, 5% invoice discount (pro-rata allocation re-sums exactly), shipping + other charges, round-off -> total 21,328.00 computed by hand; part payments 5,000 -> 15,000 -> remove -> full; status transitions Sent / Partially Paid / Paid / back to Sent; overdue boundary (due day is not overdue); stale editor copy cannot erase payments; cancelled docs stay cancelled |
| (b) credit note | same | Partial credit (4 of 10 units) = 3,420.00 + 615.60 GST, round-off +0.40 = 4,036.00. Dashboard billed 17,292 / outstanding 12,292, receivables net 12,292, books income 15,779.60, GSTR-1 CDNR + B2B net (taxable 15,579.99, CGST/SGST 756.20 each), 3B, books GST summary, balance sheet (plug 0) all agree; bridge income - GST taxable = 199.61 (charges + round-offs) is exact |
| (c) supply types | `integration/supply-types.test.ts` | intra (CGST+SGST), inter (IGST), B2CL / B2CS inter+intra, SEZ with/without payment, export under LUT / with IGST, POS 99 and 96, reverse charge, TDS (on taxable / on total, part payment), TCS (on total / taxable), cess (ad valorem + per unit), tax-inclusive (incl. paise), round modes. For each: invoice totals, GSTR-1 section, GSTR-3B head, e-Invoice `ValDtls` reconciles with `TotInvVal` (+ validator reports no SUM/ITEM errors), Tally voucher imbalance == 0 **and** `Round Off` holds only the genuine round-off |
| (d) five-way reconcile | `integration/reconcile.test.ts` | 10 live invoices + 1 credit note + cancelled, draft, quotation, proforma, challan and a previous-FY invoice, in 6 time zones. Books accrual income 130,100.00; GST taxable 129,999.99; receivables billed - credited 145,296.00; sales register 145,296.00; dashboard billed 145,296.00; monthly chart == KPI; Tally party debits 145,296.00. Bridge: `billed = income + GST 13,760 + cess 1,200 + TCS 236`; `income = taxable + shipping 100 + round-off 0.01`. Balance sheet balances with **no** plug |
| (e) FY boundary | `integration/fy-boundary.test.ts` | 31 Mar / 1 Apr numbering (FY25-26 continues, FY26-27 restarts at 0001) and FY filters in books, GST (FY / quarter / month), exports, receivables, presets — in 7 zones incl. Kathmandu, Honolulu, Auckland; DST (23h/25h days); instants stamped near midnight UTC |
| (f) purchases / ITC / stock | `integration/purchases-itc.test.ts` | Purchase GST split, ITC by head, blocked ITC (4D), set-off order (IGST -> IGST, CGST, SGST), carry-forward, accrual and cash-basis P&L, balance sheet plug == exactly the opening balances (150,000); inventory weighted-average and FIFO after purchase / sale / sales return, as-of date, draft / cancelled / expense bills ignored |
| (g) recurring | `integration/recurring-fy.test.ts` | Catch-up across 1 April, idempotent re-run / crashed advance / two tabs, FY numbering per issue date in 7 zones, tax setup preserved, month-end + leap-year arithmetic, 8-year-old daily schedule catches up in ms |
| (h) backup | `integration/backup-roundtrip.test.ts` | Backup -> wipe -> restore byte-identical for every table; device-local keys never leave and survive a wipe; encrypted round trip, wrong passphrase / tampering refused; hostile file (`__proto__`, foreign keys, PIN) ignored; failed restore rolls back |
| property / fuzz | `property.test.ts` | 4,000 random invoices (all supply types, modes, cess, TCS/TDS, inclusive pricing): 2dp-clean, line totals re-sum, `taxable+tax+cess+charges+TCS+round-off == total`, `balance == total - TDS - paid`, round-off bounds, idempotent recalculation through JSON + `normalizeRecord`, legacy records unchanged, single-line results equal exact BigInt arithmetic on 6,000 cases incl. exact half-paisa ties |
| performance | `perf.test.ts` | 500-line invoice 38 ms; 5,000 invoices + 5,000 purchases: summarize 9 ms, receivables 54 ms, books vouchers 161 ms / P&L 223 ms / balance sheet 451 ms, GST FY report 785 ms, accounting exports 745 ms, Tally 879 ms, inventory (200 items, 2 methods) 358 ms |

## 2. Bugs found and fixed (failing test on the old code in brackets)

Money / tax
1. **Half-paisa ties rounded the wrong way** (`11 x 1.5% = 0.165` gave 0.16; 2.8M x decimal qty gave 1 paisa low; ~0.1% of tax lines). Exact decimal arithmetic (`mulRound2`, `pctOf`, `backOutPct`, integer-paise allocation) in `invoice-calc.ts`. [`REGRESSION: tax of an exact half-paisa rounds HALF UP`, `single-line invoices match exact integer (BigInt) paise arithmetic`]
2. `round2` rounded negatives asymmetrically (-2.345 -> -2.34) so a credit note was not the mirror of its invoice; `applyRounding('nearest')` likewise. [`round2: half away from zero, symmetric...`, `REGRESSION: round2 rounds negatives symmetrically`]
3. Invoice discount went **negative** on an all-negative (return) document, breaking `subtotal - discount = taxable`. [`REGRESSION: a negative-quantity (return) line never produces a negative invoice discount`]
4. **Credit notes dropped supply type, tax-inclusive pricing, cess, TCS/TDS and round mode** (credit against an export-under-LUT invoice charged IGST; inclusive invoices credited at the wrong base). [`REGRESSION: a credit note against an export-under-LUT invoice stays zero-rated`, `... keeps the original's tax-inclusive pricing`]
5. Two part-credits that together cover an invoice were refused because each is rounded to a whole rupee (cap compared after round-off). [`credit notes cannot exceed the invoice, even across several part-credits with round-off`]
6. **GST reports, e-Invoice, e-Way, Tally item lines and accounting exports re-derived totals with a partial input** (no supply type / inclusive / cess / TCS). Result: zero-rated SEZ/export supplies reported with IGST, inclusive prices reported as exclusive, cess lost. All now use `calcInputFromRecord`. [`export under LUT`, `SEZ without payment`, `tax-inclusive` in `supply-types.test.ts`]
7. GSTR-1: zero-rated (SEZ / LUT) supplies with a registered buyer were dropped from B2B as "nil" lines; SEZ had no `inv_typ` (SEWP/SEWOP); `csamt` was hard-coded 0; cess missing from 3B (3.1(a)/(b), cash payable) and the 3B CSV. Export detection only knew POS `96` but the app's own "Other Country" code is `99` — exports were silently filed as B2CS/B2CL. [`SEZ without payment`, `export under LUT`, `export is recognised by POS 96`, `cess`]
8. e-Invoice: `SupTyp` never came from the document's supply type; deemed export built an overseas `URP` buyer; cess (`CesVal`, `CesRt/CesAmt/CesNonAdvlAmt`) absent so totals did not reconcile; TCS not in `OthChrg`; tax-inclusive items sent gross-of-tax `TotAmt` (`TotAmt - Discount != AssAmt`). [`REGRESSION: e-Invoice for a deemed export...`, `tax-inclusive lines go to the IRP ex-tax`, `cess`, `TCS 1% on total`]
9. e-Way bill: cess and TCS missing so the value breakup did not add up to `totInvValue`. [`REGRESSION: e-Way bill carries cess and TCS...`]
10. Tally: cess and TCS were swallowed by the `Round Off` ledger (a 118 TCS posted as "round-off expense"); purchases with blocked ITC were posted to *Input GST*. [`TCS 1% on total`, `cess`, `REGRESSION: Tally posts GST on a bill with BLOCKED ITC...`]
11. Accounting CSV sales register: cess/TCS hidden inside the Round Off column (new `Cess`, `TCS` columns).

Accounting consistency
12. **Books income excluded freight / other charges / round-off** (taxable only) while receivables billed the full total; the difference vanished into the balance-sheet plug. Books income = taxable + charges + round-off; cess and TCS are liabilities (in "GST payable"). [`reconcile.test.ts`, `stats, receivables, books and GST agree...`]
13. **Receivables vs dashboard disagreed on TDS**: a part-paid TDS invoice left `total - paid` outstanding in the ledger but `total - TDS - paid` on the dashboard. The ledger now clears the withheld TDS (derived "TDS withheld by customer" credit). [`REGRESSION: with TDS, a PART payment leaves exactly (total - TDS - paid) outstanding`]
14. Balance sheet ignored receipts on cancelled invoices and payments on cancelled / later-dated bills (cash moved, receivable did not) — absorbed by the plug; now customer / vendor advances. [`REGRESSION: a receipt on a cancelled invoice...`, `a payment on a cancelled bill...`]
15. Cash-basis P&L now recognises a TDS invoice's income in full when the net-of-TDS amount is received.
16. Dashboard monthly chart did not net credit notes (chart != KPI). [`reconcile.test.ts`]
17. Dashboard added USD to INR; `summarize` / `monthlyBilled` accept a `currency`. [`REGRESSION: the dashboard never adds USD to INR`]

Data integrity
18. Recording a payment on a cancelled invoice flipped it to *Paid* (resurrected revenue). [`REGRESSION: recording a payment on a cancelled document does not resurrect it`]
19. Zero / negative / NaN payments were accepted. [`a payment can never be zero, negative or NaN`]
20. Stale editor copy overwrote `amount_paid` and lost payments recorded in the modal. [`REGRESSION: saving a stale editor copy does not erase payments`]
21. Default payment date was a UTC timestamp: 01:30 IST on 1 Apr filed the receipt on 31 Mar (previous FY). [`REGRESSION: the default payment date is the LOCAL calendar day`]
22. **Sender-profile number prefix was previewed but not applied on save** (`MC/...` shown, `INV/...` saved). [`REGRESSION: a sender profile's own number prefix is used...`]
23. CRM: re-typing a client's name with blank fields wiped its GSTIN / phone / address; renaming A to B's name merged A into B; a line without HSN erased the catalogue HSN. [`REGRESSION: typing an existing client's name again...`, `renaming client A...`, `saving an invoice line without an HSN...`]
24. Recurring: schedule dropped supply type / LUT / inclusive / TCS / TDS / round mode (a recurring export started charging IGST); `nextOccurrence` scanned from 0 (quadratic catch-up); credit / debit / converted documents inherited `recurring_id`/`recurring_date` (could shadow idempotency). [`REGRESSION: a recurring export-under-LUT / TDS invoice keeps its tax setup`, `catching up a daily schedule... is fast`, `REGRESSION: converting / crediting a recurring-generated invoice...`]
25. Credit note could be raised against a Draft invoice. [`REGRESSION: a credit note cannot be raised against a draft invoice`]
26. `applyBackup` could leave a half-restored mix on a quota error (now atomic); new `restoreBackup` = exact replace, atomic. [`REGRESSION: a restore that hits the storage quota half-way rolls back`, `restoreBackup replaces...`]

Dates / locale / escaping
27. `formatDate`, `toDateInput`, `addDaysInput`, `daysOverdue`, notifications `parseDate` used `new Date('YYYY-MM-DD')` (UTC): wrong day in the Americas. `daysOverdue` floored across DST (lost a day in Europe/US). Books / exports / receivables normalised ISO instants by their UTC prefix. New `src/lib/dates.ts`. [`REGRESSION: date helpers treat a bare YYYY-MM-DD as that calendar day in every zone`, `a DST change inside the window...`, `an instant stamped late on 31 March UTC...`]
28. `amountInWords(19.999)` printed "...Nineteen and undefined Paise"; sub-rupee amounts lacked "Zero". [`REGRESSION: amountInWords never prints "undefined"...`]
29. Importer lookups used plain objects with user text as key: a cell reading `constructor` crashed state resolution / returned a function as unit; `toLocaleString('fullwide')` produced locale digits. [`REGRESSION: importer lookups ignore Object.prototype keys`]
30. Four copies of `csvCell/toCsv` with different injection guards (some turned `-5` text into `'-5`, some missed `\t`/`\r`, receivables printed `NaN`) -> one implementation in `csv.ts` (re-exported from `download`, `books`, `receivables`, `gstr-json`, `accounting-export`). [`REGRESSION: one CSV cell implementation everywhere...`]
31. Four purchase normalisers (books / GST / exports / inventory) -> `purchase-normalize.ts`. Drafts used to be exported; expenses could add stock. [`books, GST, exports and inventory read a purchase identically`, `draft / cancelled / void bills are excluded by EVERY consumer`, `an EXPENSE bill never adds stock`]
32. O(invoices x clients) party lookup in receivables -> indexed.
33. Importer stored an imported "Overdue" status (it must be derived from the due date). [`REGRESSION: an imported "Overdue" invoice is stored as Sent`]

## 3. Found but NOT fixed

- `expenseLine` (tax-inclusive quick expense) rounds the base to 2 dp, so the re-derived total can differ by one paisa from the typed gross (e.g. 100 inclusive @18% -> 100.01). Needs a per-line "inclusive" flag on `PurchaseLine`.
- Inventory treats **every** credit note line as a sales return: a "Discount" / "Rate difference" credit puts stock back. Needs the `doc_links` reason (inventory only receives invoices).
- Credit notes never credit shipping / other charges (`shipping: 0` by design), so a full credit of an invoice with freight leaves the freight uncredited.
- Deleting an invoice removes its payments but leaves its credit notes, `doc_links`, e-Invoice meta and reminders; an orphaned credit note keeps reducing the party's balance.
- `notifications`, `reminders`, the UPI link and `PaymentModal` use `balance_due`, which ignores credit notes (stats / receivables do net them) — can chase or accept more than is owed.
- No FX: books / GST / exports sum foreign-currency documents as rupees (GST reports warn `FOREIGN_CCY`); only the dashboard gained a currency filter.
- Per-line CGST/SGST split can leave invoice-level CGST and SGST differing by a few paise (odd paisa goes to SGST); GSTN has not been seen to reject it.
- Tally: no TDS journal (the TDS stays open on the party ledger), no purchase payment vouchers.
- Balance sheet shows TDS awaiting credit inside receivables (no separate asset line); receivables ledger efficiency counts the TDS credit as "received".
- Overpayment is not blocked in the lib (balance goes negative; dashboard clamps to 0).
- Reading a 5,000-invoice table costs ~60 ms per `getTable` (JSON parse); `payments.record` / `nextNumber` each do 1-2. Fine for UI actions, but a bulk script should `setTable` directly.

## 4. UI follow-ups (components are not mine)

1. Dashboard: call `summarize(invoices, now, links, 'INR')` and `monthlyBilled(invoices, n, now, 'INR')` (or one tile set per currency); the headline `billed` and the chart now agree.
2. After `PaymentModal` records / removes a payment, refresh the creator store (`useInvoiceStore.getState().loadInvoice(id)`); the lib now stops the stale save from losing money, but the screen still shows the old paid amount.
3. Restore: `DataPanel` and `EncryptedBackup` call `applyBackup` (overwrites only tables in the file). Use the new `restoreBackup(data)` for an exact, atomic replace if that is the intent.
4. Books page labels: "Sales (excl. GST)" now includes freight / other charges / round-off; balance-sheet row "GST payable" now also holds cess and TCS collected (relabel "GST, cess & TCS payable"); receivables includes TDS awaiting credit.
5. GST reports page: show the new `cess` per rate row / HSN row / totals, `payment.cess` (cash), `invTyp` (SEWP/SEWOP/DE) on B2B rows.
6. Accounting exports: sales register has new `Cess` and `TCS` columns; Tally options may expose the new ledger names `outputCess` ("Output Cess") and `tcsLedger` ("TCS Payable").
7. Receivables ledger: new derived rows "TDS withheld by customer (...)" (kind `payment`, `derived: true`) — give them a label/icon.
8. `PaymentModal` / reminders / UPI link: cap and quote `balance_due - credit notes` (use `effectiveOutstanding` from `documents.ts`).
9. Credit-note dialog: explain that shipping / other charges are not credited; Draft invoices are now refused.
10. e-Invoice modal: "Deemed export" is now a domestic supply (buyer GSTIN kept); `supply_type` of the document pre-selects `SupTyp`.
11. Inventory: when documents UI passes credit notes to stock, pass only "Sales return" notes.

## 5. Additive API

`invoice-calc`: `calcInputFromRecord`, `mulRound2`, `pctOf`, `backOutPct`, `CalcLine.nominal_rate`. `dates.ts`: `parseDay`, `isoDay`, `localDayOf`, `shiftDay`.
`csv.ts`: `csvCell`, `toCsv`, `safeText`. `purchase-normalize.ts`: `readPurchase`, `readPurchaseLines`, `isVoidStatus`.
`backup`: `restoreBackup`. `stats`: optional `currency`, `inCurrency`. `gst-reports`: `DocRow.cess/invTyp`, `Gstr1Report.totals.cess` (only when non-zero), `SetOffResult.cess`, `PDoc.zeroRated/invTyp`.
`einvoice`: `EInvItem.CesRt/CesAmt/CesNonAdvlAmt`, `EInvValDtls.CesVal`. `eway`: `EwayItem.cessNonadvol`. `export-shared`: `InvoiceAmounts.cess/tcs`, `NormalPurchase.itcEligible`.
`books`: `GstSummary.outputCess`. `tally-xml`: `outputCess`, `tcsLedger` options. `recurring`: `RecurringTemplate` tax fields.
