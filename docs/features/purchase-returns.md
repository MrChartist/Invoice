# Purchase returns, supplier notes, receipt notes (WP-3)

Tally's purchase-side **Debit Note**, **Receipt Note** and **Rejections Out**, plus the purchase-side pending
reports. Everything GST-related is a **working paper — verify with your CA**.

| | |
|---|---|
| UI | Purchases page (`/expenses?tab=returns`), tab "Returns & GRN" (lazy `ReturnsTab`): Debit / credit notes · Receipt notes (GRN) · Pending reports. Forms `ReturnModal`, `GrnModal` |
| Lib | `src/lib/purchase-returns.ts` (notes: pure + storage), `purchase-returns-gst.ts` (pure: 3B, 2B, Books), `receipt-notes.ts` (GRN, rejections, GRNI, PO outstanding), `events-returns.ts` (stock source), `ledger/postings-returns.ts`, `tally-debit-notes.ts` |
| Strings | `src/i18n/areas/purchase-returns.ts` (`prT`, English + Hindi); tab label `purT('tabReturns')` |
| Tests | `tests/purchase-returns.test.ts`, contract row in `tests/purchase-contract.test.ts` |

## Data (additive only)
- New table `purchase_returns` (`PurchaseReturn`): `kind` `DEBIT_NOTE` (our debit note) / `SUPPLIER_CN` (supplier's credit
  note received), `note_number` `DN/FY<yy-yy>/<seq>` (both kinds — it is a Debit Note voucher in our books), `date`,
  `purchase_id` + `bill_number` / `bill_date` ("Original invoice no. / date"), vendor snapshot, `supplier_note_number` /
  `supplier_note_date`, `reason` (GST reason code 01–07, `GST_NOTE_REASONS`), `goods_returned`, `lines` (`bill_line_id`,
  qty, rate, tax rate, godown / batch / serials), taxable / CGST / SGST / IGST / total, bill snapshots `itc_eligible`,
  `reverse_charge`, `import_type`, `bill_kind`, `category`, `cost_centre_id`, and `adjusted_amount`.
- New table `receipt_notes` (`ReceiptNote`): `kind` `GRN` (`GRN/FY…`) / `REJECTION_OUT` (`RJO/FY…`), vendor, `po_id`
  (GRN), `grn_id` (rejection), `challan_no`, `lines` (`po_line_id`, `grn_line_id`, rate, godown / batch / dates), `closed_on`.
- `PurchaseLine.grn_line_id` (bill line billing a GRN line); `PurchaseLineCore.grnLineId` in `readPurchaseLines`.
- Both tables: `RECORD_TABLES` / `ID_TABLES` (backups), `TABLE_ACTIONS` `books.edit`; writes call `requireAccess`;
  notes respect the period lock on the note date; audit entity `purchase`.

## Rules
- **Quantity**: a goods note line must point at a bill line; quantity ≤ billed − earlier goods notes. Any note ≤ bill
  total − earlier notes. Dated on / after the bill. Draft / cancelled bills refused.
- **GST split** follows the bill (IGST if the bill charged IGST, else CGST + SGST; none for a tax-free bill). ITC is
  reversed only when the bill claimed it.
- **Bill balance (Agst Ref)**: the note's supplier amount (total − self-assessed GST on RCM / import bills), up to the
  bill's balance, raises the bill's `amount_paid` (`adjusted_amount`) — same mechanism as advance adjustments in
  `billwise.ts`; the rest is on account (the supplier owes us). Bill-wise shows the Agst Ref and the on-account
  debit (`PayablesInput.returns`, `OpenAdvance.noteId`; not adjustable from the bill-wise tab). Deleting a note
  undoes it; a bill with a note cannot be deleted. A note without a bill (supplier CN only) is wholly on account.
- **Ledger** (`Debit Note`, id `pdn:<id>`): Dr Sundry creditors (supplier amount) | Cr **Purchase returns (5010)** —
  or the bill's expense account for an expense bill — taxable (+ GST when ITC was not claimed), Cr Input CGST / SGST /
  IGST; RCM / import bills: Dr GST payable — reverse charge / IGST payable on imports. Round off balances.
- **Stock** (`events-returns.ts`, registered in `collectEvents`): goods notes out on the note date (kind `adjustment` —
  not a sale, no COGS); GRN in on its date (kind `purchase`, valued at the weighted rate of the bills that bill it,
  else the GRN rate); a bill line with `grn_line_id` skips the quantity the GRN already brought in; rejection out =
  out on its date.
- **GSTR-3B** (`itcAdjustmentsFromNotes`, wired in `buildGstReport` via `BuildOptions.purchaseNotes`): notes dated in the
  period are negative purchase rows in the table their bill used — 4A(5) ordinary, 4A(3) + 3.1(d) reverse charge,
  4A(1) / 4A(2) imports, 4D(2) when ITC was not claimed — so 4C falls by the note's input tax. 4C is still clamped
  at 0 per head; the portal wants a negative net in 4B(2) — verify.
- **GSTR-2B**: `bookBills(purchases, state, notes)` adds notes with `sign: -1`. A 2B CN line matches only a note, by
  supplier GSTIN + the supplier's note number, else on value (flagged "number"). Enter the supplier's number on a
  DN later from the notes list (pencil). Books-side 4A(5) in `itcEffect` nets notes.
- **Books (indicative)**: accrual P&L takes the cost back on the note date; balance sheet payables / ITC / RCM payable
  fall. Cash-basis P&L is unchanged by notes.
- **Tally** (`debitNoteVouchers`, called from `buildTallyModel`; `ExportSource.purchaseReturns`): voucher type "Debit
  Note", Dr party with Agst Ref the bill number (New Ref the note number when on account), Cr "Purchase Returns"
  (Purchase Accounts), Cr Input heads, Dr RCM / customs IGST ledger, Round Off.
- **GRN**: "Convert to bill" seeds the bill form with the unbilled quantity (lines carry `grn_line_id` and `po_line_id`,
  seed carries `po_id`). A billed / rejected GRN cannot be edited or deleted (close it). Rejection quantity ≤ received −
  rejected − billed.
- **Reports**: Goods received not billed (pending qty × GRN rate, age); Purchase order outstanding (ordered − GRN accepted
  − billed directly, expected date, overdue days; closed POs excluded).

## Wiring done in shared files (one line / block each)
- `src/lib/inventory.ts`: import; `StockInputs.returnDocs`; `grnCoverage` in the purchases loop; `returnStockEvents(...)`
  after it; `liveInputs().returnDocs`.
- `src/lib/ledger/postings.ts`: import + `for (const v of purchaseReturnPostings(input.purchaseReturns, accounts)) push(v);`
- `src/lib/ledger/accounts.ts`: `A.purchaseReturns` + `def(A.purchaseReturns, '5010', 'Purchase returns (debit notes)', 'PURCHASES')`.
- `src/lib/books.ts`: `BooksData.purchaseReturns`, `loadBooksData`, accrual P&L loop, balance-sheet loop.
- `src/lib/gst-reports.ts`: `BuildOptions.purchaseNotes` + one `purchases.push(...itcAdjustmentsFromNotes(...))`.
  Callers passing it: `src/pages/GstReports.tsx`. Not yet: `ComplianceView` (late-fee cash estimate) and `gstr9.ts`.
- `src/lib/gstr2b.ts`: `BookBill.sign`, `bookBills` third parameter, sign rules in `sectionAccepts` / fuzzy / `taxDiff` /
  `itcEffect`; `Gstr2bView.tsx` passes the notes.
- `src/lib/tally-xml.ts`: `'Debit Note'` in `TallyVoucherType` + `typeOrder`, import + one call. `export-shared.ts`
  `ExportSource.purchaseReturns`; `ExportCenter.tsx` loads it.
- `src/lib/billwise.ts` (`returns` input, `noteId`), `BillwiseTab.tsx` (passes notes, hides Adjust / Delete on note rows).
- `src/lib/purchases.ts` (`remove` guard), `src/lib/purchase-normalize.ts` (`grnLineId`), `src/lib/access.ts`,
  `src/lib/backup.ts`, `src/pages/Expenses.tsx` (lazy tab + GRN → bill seed), `src/i18n/areas/purchases.ts` (`tabReturns`).

## Open
- Job work in / out + ITC-04 (P1-9), Rejections In (customer side). Sales-order outstanding is done (WP-8,
  Inventory → Order outstanding).
- Editing a note (delete and record again); serial selection on returns of serial-tracked lines (lib supports `serials`, UI does not).
- TDS on a bill with TDS deducted at booking is not adjusted by a return; GSTR-9 / 9C and the compliance late-fee
  estimate do not read notes yet; cash-basis Books P&L ignores notes.
- Editing a bill below the quantities already returned is not blocked.
- An existing user account with code 5010 would share the code with "Purchase returns".

## Statutory points to verify with a CA
- Month of ITC reduction (note date vs supplier's credit note date / 2B period) and the 4B(2) treatment of a negative net.
- A buyer-issued debit note is a commercial document; the GST credit note is the supplier's (Sec 34). We reverse ITC
  on our debit note date without waiting for the supplier's credit note.
- Reason codes 01–07 (the GSTR-1 / Tally list) — confirm the list in current use.
- RCM / import returns: reversal of the self-assessed liability together with the ITC.
