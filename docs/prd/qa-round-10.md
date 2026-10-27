# QA round 10: hands-on audit of Round 9 (retail shops: RT-A kirana / shared, RT-B pharmacy, RT-C apparel, RT-D electronics, RT-E jewellery)

Status: findings for the fix loop. Baseline: branch `claude/elegant-cannon-cwapiv` at `aa7a504` (RT-A to RT-E merged). The
existing Round 9 suites pass: `tests/rt-*.test.ts`, `purchase-contract` and `no-cash-readers`, 172 tests. Every finding
below was reproduced on that commit.

Method:
- **Data layer.** Node probes through the repo's test harness (`tests/helpers/shim.ts`, `tests/helpers/world.ts`). They
  call the same lib APIs the screens call:
  - RT-D buy-back / exchange / finance: `recordBuyBack`, `applyExchange`, `undoExchange`, `openVouchers`,
    `marginLines`, `recordFinance`, `recordDisbursement`.
  - RT-A deliveries: `moveDelivery`, `settleRider`.
  - RT-D repairs and RT-E jewellery: `addJob`, `updateJob`, `setClaim`, `billJob`, `recordKarigar`, `recordOldGold`,
    `addTags`.
  - RT-C alterations: `addAlteration`, `makeTailorBill`.
  - Guards: `liveSaleGuards`, `sameDayCash`, `cashReceiptIssue`, `panGuard`, `liveMrpIssues`, `syncBands`.
  - Readers: `buildGstReport`, `turnoverOf`, `buildVouchers` / `cashBook`, `loadLedger`, `buildTallyModel`,
    `loadPositions`, `localDb.invoices.remove` / `setStatus`, `restoreEntry`, `deleteVoucher`.
- **Static review** of `src/lib/retail/*.ts`, the R9 parts of `gst-reports.ts`, `books.ts`, `tally-xml.ts`,
  `ledger/postings.ts`, `inventory.ts`, `stock-tracking.ts`, `trust/recycle-bin.ts`, and the desk screens that call
  them (`DevicesDesk.tsx`, `JewelleryDesk.tsx`, `Pos.tsx`).
- No browser run was needed: every finding reproduces at the data layer. Where a finding depends on what a screen
  does, the screen code is cited.

Probe files: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa10/probes/`. They were run
from `tests/` and moved out afterwards (nothing committed). The files are `zz-qa10-bb`, `-margin`, `-rider`, `-kar`,
`-bin`, `-svc`, `-cash`, `-band`, `-tally`, `-fee`, `-mrp`, `-fy` and `-lock`, each `.test.ts`.

To run one, copy it into `tests/` and run
`node --experimental-strip-types --import ./tests/hooks/register.mjs --test tests/<file>.test.ts`. Each scenario prints
one `#` line per check. Below, `qa10/x` means probe file `zz-qa10-x.test.ts`, and a letter (A, B …) is the probe's
test name.

This doc reports bugs only. It proposes no new features.

Severity:
- **P0:** money or data is wrong, data is lost, or there is a security issue.
- **P1:** a flow is broken, a stated Round 9 invariant is broken, or a tax document comes out wrong.
- **P2:** friction, or a cosmetic or printing error.

---

## 1. Summary

| # | Sev | Area | Finding |
|---|---|---|---|
| R1 | P0 | RT-D3 / E3 exchange | `applyExchange` and `openVouchers` ignore what was already paid on a URD voucher. A buy-back (or old gold) paid to the customer in cash is offered again as an exchange and settles a sale. The customer is paid twice: voucher `amount_paid` ₹36,000 on an ₹18,000 voucher |
| R2 | P0 | RT-E4 karigar | A karigar receipt takes the issued metal out at cost and brings the finished pieces in at ₹0, with or without tags. 50 g of ₹10,000/g gold leaves the closing stock: ₹10,00,000 becomes ₹5,15,600 |
| R3 | P1 | RT-A3 rider cash | The Books cash book counts COD cash twice: once as the receipt (as counter cash) and again when the rider settles. Cash book closing ₹2,480 against a ledger cash of ₹1,240 |
| R4 | P1 | RT-D3 margin scheme | The margin scheme's "cost" part (0%) is reported as a **nil-rated** supply: GSTR-1 Table 8, 3B 3.1(c), an HSN 8517 @ 0% row, and Rule 42 exempt turnover (E = ₹18,000 of F = ₹21,389.83) |
| R5 | P1 | Tally / exchange | In the Tally export the exchange receipt debits a separate "Sundry creditors — exchange" ledger and credits the customer again. The customer's ledger (one ledger, under Sundry Creditors) is understated by the exchange value |
| R6 | P1 | Recycle bin / exchange | Deleting a sale settled by exchange removes the exchange receipt, but the voucher stays "paid". The ledger owes the customer ₹18,000, payables shows nothing, and the voucher is offered for exchange again |
| R7 | P1 | Recycle bin / exchange | Restoring an exchange receipt (after *Undo*) does not raise the voucher's `amount_paid` again. Payables shows ₹18,000 due while the ledger shows ₹0, so the customer can be paid again |
| R8 | P1 | RT-D2 finance | Deleting or cancelling a finance sale leaves the DO and its transfer journal in place. The financier still owes ₹33,600 for a bill that no longer exists, and the clearing account sits at −₹33,600 |
| R9 | P1 | RT-D4 repairs | A job whose parts are all under warranty makes no invoice, so it is never stamped as billed. Each *Bill job* click issues the warranty parts out of stock again (5 → 2 after three clicks) |
| R10 | P1 | RT-D / E cash guard | Sec 269ST is checked per day only. One bill paid ₹1,90,000 in cash yesterday and ₹50,000 in cash today passes even in *block* mode |
| R11 | P1 | RT-A2 MRP guard | A batch MRP typed on a bill line in an alternate unit (strip of 10, MRP ₹62) is read as the MRP per base unit. The guard stays silent until a strip sells above ₹620 |
| R12 | P2 | RT-D3 margin scheme | "Refused for a registered buyer" is checked only when the button is pressed. A bill with margin lines saves to a GSTIN buyer and reaches GSTR-1 B2B as ₹3,389.83 @ 18% on a ₹22,000 sale |
| R13 | P2 | RT-D cash guard | The POS strip's `sameDayCash` nets refund (negative) rows; the payment dialog's `cashFromCustomer` does not. With a refund the same day, the counter under-counts the day's cash receipts |
| R14 | P2 | RT-E3 old gold | An old-gold voucher needs PAN at **≥** ₹2,00,000. A sale needs it only **above** ₹2,00,000 (Rule 114B, "exceeding"). Exactly ₹2,00,000 is refused on the voucher |
| R15 | P2 | RT-D2 finance fee | The financier's fee bill (draft) has `amount_paid` 0 once posted, but the disbursement voucher already settled it. Payables shows ₹1,180 due while the ledger shows ₹0 |
| R16 | P2 | RT-C3 tailor bill | Discarding the tailor-bill draft leaves its slips stamped with `tailor_bill_id`. They can never be billed again and cannot be deleted |
| R17 | P2 | RT-A3 rider settlement | The rider-settlement journal can be deleted in Books; the settlement row stays. The Z report shows ₹0 with the rider, the ledger shows ₹1,240, and re-settling is refused |

### What was verified and is correct

- **Price bands (RT-C1).** Exclusive ₹2,500.00 → 5%, ₹2,500.01 → 18%. Inclusive ₹2,625.00 → 5%, ₹2,625.01 → 18%. An
  invoice discount of ₹200 on ₹2,700 → 5% on ₹2,500. Three pieces at ₹2,500.01 → 18%. A second sync pass is stable
  (qa10/band). The ₹2,625–₹2,950 inclusive gap lands in 18%, as documented (RT2).
- **Cash / PAN boundaries.**
  - 269ST: ₹1,99,999.99 passes and ₹2,00,000 is blocked.
  - PAN on a sale: ₹2,00,000 passes and ₹2,00,000.01 needs PAN (qa10/cash G3).
- **Indian FY numbering.**
  - URD, ALT, SVC and KAR restart at 0001 on 1 Apr: `…/FY26-27/0001` on 31 Mar 2027, then `…/FY27-28/0001`.
  - A deleted ALT number is not reissued (qa10/fy).
- **Period lock.** These are refused inside a locked period: buy-back, old gold, the warranty swap and desk tags into
  stock (qa10/lock).
- **Finance ledger.** On the happy path the transfer row's bank side is remapped to the clearing ledger, and the
  transfer nets to zero (existing `rt-finance` suite).
- **Existing suites.** These pass: `rt-*`, `purchase-contract` and `no-cash-readers`.

---

## 2. Findings

### R1 — P0 — A URD voucher already paid in cash is settled again by exchange (customer paid twice)

- **Cause:**
  - `openVouchers` (`src/lib/retail/rt-buyback.ts:48–50`) computes the value left as `total − exchangedFrom(...)`.
  - `applyExchange` does the same (`:162` `left = total − exchangedFrom`).
  - Neither looks at the voucher's `amount_paid`, which a cash or bank purchase payment (`paymentsDb.record`) raises.
  - The POS *Exchange* tender (`DevicesDesk.tsx` `PosDevices`, `vouchers = openVouchers(...)`), the Devices
    *Buy-back* list and the jewellery *Old gold* list therefore all offer a voucher that has already been paid out.
  - `oldGoldVouchers` (`rt-old-gold.ts:99`) shows `open = total − amount_paid` correctly, so the two screens disagree.
- **Repro (qa10/bb A):**
  1. Buy back a phone for ₹18,000 (`URD/FY26-27/0001`).
  2. Pay the customer ₹18,000 in cash (`paymentsDb.record`). `amount_paid` is 18,000, yet `openVouchers` still shows
     `left` = **18,000**.
  3. Sell the same customer a ₹59,000 phone and call `applyExchange`. It is **accepted**:
     - the sale's balance falls to ₹41,000;
     - the voucher's `amount_paid` becomes **₹36,000** on an ₹18,000 voucher;
     - the ledger shows creditor Ravi at **+₹18,000** (Dr), so he owes us what we paid him twice.
- **Fix:**
  - Compute left = `total − max(amount_paid, exchanged)`. `amount_paid` already includes the exchanges, so this is
    simply `balanceOf(p)`.
  - Use it in `openVouchers`, `applyExchange` and the tenders.
  - Refuse when it is ≤ 0.

### R2 — P0 — Karigar receipt writes the issued metal's value off the stock

- **Cause:**
  - `recordKarigar` moves stock with zero-rate adjustments (`rt-karigar.ts:91–95` `move(...)` → `rate: 0`).
  - On a receipt it consumes the metal from the karigar's wip godown at cost (`:130`): an outflow at the moving
    average.
  - It brings the pieces in by weight or pieces at rate 0 (`:131–134`). The stock engine (`inventory.ts` step, `rate =
    ev.rate ?? c.unit()`) values them at the item's current unit cost, which is **₹0** for a new design item.
  - With tags, `addTags(..., { toStock: true })` is called **without** a `cost` (`:136`), so every tag also comes in at
    ₹0. The desk's own tag form values tags at net × buy rate; the karigar path does not.
  - The metal's value simply leaves closing stock. RT21 says "metal with karigars stays in stock valuation".
- **Repro (qa10/kar K1, K2):**
  1. Fine gold 24K: 100 g at ₹10,000. Stock value is ₹10,00,000.
  2. Issue 50 g to Salim. Value is unchanged at ₹10,00,000 (correct).
  3. **K1:** receive 52.1 g of bangles (GMS item, no tags) at 91.6% with 1.5% wastage. Stock value is now
     **₹5,15,600**: the bangles count 52.1 g at **₹0**, and the 48.44 g of gold consumed are gone.
  4. **K2:** do the same with four tags. The chains count 4 pcs at **₹0**, and the value is again ₹5,15,600.
- **Fix:**
  - Carry the consumed cost into the receipt: value the incoming pieces at (consumed metal cost + labour) ÷ pieces /
    grams. Use a production / stock-journal style pair, or pass `rate` on the in-moves.
  - Give `addTags` a `cost` from the same split.
  - Add a test that issue + receipt keeps total stock value ≥ the metal value.

### R3 — P1 — Books cash book counts rider COD cash twice

- **Cause:**
  - `books.ts` `buildVouchers` (`:487–515`) puts every receipt row whose method is Cash into the **cash** book. It skips
    only `movedNoCash` rows, and COD rows tagged `rider_id` are deliberately not `movedNoCash`.
  - `manualCashVouchers` (`:657–678`) then adds the *Rider settlement* journal (Dr Cash) as a second cash receipt. Only
    the "RA deduction" and "Finance transfer" classes are skipped (`:674`).
  - The ledger handles this correctly (`ledger/postings.ts:305` debits "Cash with riders"); the Books cash book, the
    cash balance it feeds and the simple balance sheet do not.
  - `docs/features/retail-r9.md` §A3 says "Books: the settlement moves it into Cash".
- **Repro (qa10/rider C):**
  1. COD order of ₹1,240, delivered by Raju.
  2. Settle Raju with ₹1,240 counted.
  3. Results:
     - `buildVouchers(...)` cash rows: the COD receipt (Bharat Traders) and the "Rider settlement";
     - `cashBook(..., 'cash', FY26)` closing is **₹2,480**;
     - ledger cash (`A.cash`) is ₹1,240.
- **Fix:**
  - In `buildVouchers`, route a cash receipt with `rider_id` to the rider ledger (or leave it out of the cash book), so
    only the settlement journal brings it into Cash.
  - Add the case to `tests/no-cash-readers.test.ts` / `rt-delivery.test.ts` (cash book closing = ledger cash).

### R4 — P1 — Margin-scheme cost part reported as a nil-rated supply (GSTR-1 Table 8, 3B 3.1(c), HSN, Rule 42)

- **Cause:**
  - `marginLines` (`rt-buyback.ts:70–86`) splits the resale into a "cost" line at **0%**, which keeps HSN 8517, and a
    margin line at the device's rate.
  - No GST reader knows the `margin` marker. `gst-reports.ts` `isNilLine` (`:852`) treats the cost line as nil-rated:
    - Table 8 `nil` (`:1216–1223`);
    - 3B 3.1(c) `nilExempt` (`:1620–1624`);
    - an HSN row "8517 @ 0%".
  - `institutions/common-credit.ts` `turnoverOf` (`:126–128`) counts that nil value as **exempt turnover E** for the
    Rule 42 / 43 common-credit reversal, so a second-hand dealer reverses ITC for a "supply" that is the margin
    scheme's purchase value.
  - Under Rule 32(5) the value of supply is the margin. The purchase-value part is not a nil-rated supply of a phone.
- **Repro (qa10/margin B):**
  1. Buy back an iPhone for ₹18,000.
  2. Resell it for ₹22,000 inclusive with `marginLines`. The bill is ₹22,000 with tax ₹610.17 (correct).
  3. GSTR-1 shows:
     - B2CS: 18% on ₹3,389.83 (correct);
     - **nil**: `INTRAB2C nil 18,000`;
     - **HSN**: `[8517, 0%, 18,000]` and `[8517, 18%, 3,389.83]`.
  4. 3B 3.1(c) intra is **18,000**. `turnoverOf` gives **E = 18,000, F = 21,389.83**, so 84% of common ITC would be
     reversed.
- **Fix:**
  - Keep `margin.part === 'cost'` lines out of every outward GST table (`buildGstr1` rate / nil / HSN, `buildGstr3b`
    nil) and out of `turnoverOf`. Report only the margin line.
  - Mark it with a CA note (RT12).
  - Add a `purchase-contract`-style guard test: "a margin cost line is in no GST table".

### R5 — P1 — Tally export double-counts an exchange against the customer

- **Cause:**
  - `tally-xml.ts:557` maps the exchange receipt's cash side to the no-cash ledger "Sundry creditors — exchange"
    (parent Sundry Creditors) and credits the customer.
  - The URD purchase voucher credits the **same** party name, and `addLedger` (`:389–392`) merges the debtor and the
    vendor into one ledger "Ravi Kumar" under **Sundry Creditors**.
  - So in Tally the customer is credited twice (purchase + receipt), and a phantom "Sundry creditors — exchange" Dr
    remains.
  - The app's own ledger instead debits Creditors with the customer as party (`postings.ts:305/310`) and nets
    correctly.
  - The receipts CSV (`accounting-export.ts:317`) names the same no-cash ledger.
- **Repro (qa10/tally T1):** buy back ₹18,000 from Ravi; sell him ₹59,000; apply the exchange. Tally then has:
  - Sales: Ravi Dr 59,000;
  - Purchase URD: Ravi Cr 18,000;
  - Receipt: "Sundry creditors — exchange" Dr 18,000 / Ravi Cr 18,000;
  - ledgers: one "Ravi Kumar" under **Sundry Creditors** plus "Sundry creditors — exchange".
  - Ravi nets **Dr 23,000**. The books say ₹41,000 is due, and ₹18,000 sits in the exchange ledger.
- **Fix:**
  - Export the exchange as a Journal: Dr the customer's **creditor** ledger (Agst Ref the URD number) / Cr the
    customer's **debtor** ledger (Agst Ref the invoice).
  - Keep debtor and creditor ledgers distinct when a name is both, e.g. a "(Creditor)" suffix, as the app's party
    split already does.
  - Do the same in the receipts CSV.

### R6 — P1 — Deleting a sale settled by exchange leaves the voucher "paid" and re-offers it

- **Cause:**
  - `localDb.invoices.remove` (`localDb.ts:491–511`) drops the bill's receipt rows, including the
    `exchange_purchase_id` row.
  - No hook lowers the URD voucher's `amount_paid`, which `applyExchange` raised (`rt-buyback.ts:170`). Payables still
    shows the voucher settled.
  - The ledger, which reads the rows, again owes the customer.
  - Because `exchangedFrom` is now 0, `openVouchers` re-offers the full value (see R1).
- **Repro (qa10/bin D1):**
  1. Buy back ₹18,000, sell, apply the exchange, then delete the sale.
  2. The voucher shows `amount_paid` **18,000** and `balanceOf` **0**.
  3. The ledger shows creditor Ravi at **−18,000** (owed).
  4. The exchange row count is 0.
- **Fix:**
  - On invoice delete (and on a receipt-row removal by any path), give back `amount_paid` for every
    `exchange_purchase_id` row. Better: derive the voucher's paid amount from payments + exchange rows instead of
    storing it twice.
  - Restore must re-apply it (R7).

### R7 — P1 — Restoring an exchange receipt from the recycle bin leaves the voucher payable

- **Cause:**
  - `undoExchange` (`rt-buyback.ts:176–185`) removes the receipt row and lowers the voucher's `amount_paid`.
  - The recycle-bin hook for `transactions` (`trust/recycle-bin.ts:268–272`) lets the row come back while the voucher
    is live, but nothing raises `amount_paid` again.
- **Repro (qa10/bin D2):**
  1. Apply an exchange, *Undo* it, then `restoreEntry` the binned receipt.
  2. The exchange row is back and the sale balance is ₹41,000.
  3. The ledger creditor is **0** (settled), but the voucher has `amount_paid` **0** and `balanceOf` **₹18,000**.
  4. Payables asks to pay the customer ₹18,000 that the exchange already settled.
- **Fix:**
  - In the hook, raise the voucher's `amount_paid` by the row amount on restore (capped at the total), or refuse
    unless the voucher is still open by that much.
  - Or derive `amount_paid` (see R6).

### R8 — P1 — Deleting or cancelling a finance sale leaves the DO and its transfer journal

- **Cause:**
  - `recordFinance` (`rt-finance.ts:124–160`) posts a receipt row (`ra_journal_id`) on the bill and a *Finance
    transfer* journal (Dr financier / Cr clearing), and saves a `finance_deals` row.
  - `localDb.invoices.remove` drops the receipt row with the bill. The journal and the deal stay: nothing hooks the
    invoice delete.
  - Cancelling (`setStatus('Cancelled')`) keeps the row, so the cancelled customer is left in credit.
- **Repro (qa10/bin D3, D4):** a ₹42,000 TV with a ₹33,600 loan.
  - **D3 (delete the bill):**
    - the deal is still open (₹33,600);
    - the ledger shows debtor "Bajaj Finserv" at **33,600**;
    - the clearing ledgers net **−33,600**.
  - **D4 (cancel the bill):** "Bajaj Finserv" debtor **33,600**, and the customer debtor at **−33,600**.
- **Fix:**
  - Refuse to delete or cancel a bill that has a live `finance_deals` row ("cancel the DO first", as for an exchange).
  - Or cancel the deal with it: `cancelDeal` when it has no disbursement, else refuse.

### R9 — P1 — A fully-covered warranty job can be "billed" again and again, issuing the parts each time

- **Cause:**
  - `billJob` (`rt-service-jobs.ts:212–237`) adds the warranty moves first (`:218`).
  - It stamps `invoice_id` only when an invoice was saved (`:236`). With nothing chargeable (every part under
    warranty, no labour), the job is never marked billed.
  - The *Bill job* button stays (`DevicesDesk.tsx:255`, shown while `!j.invoice_id`). Each click issues the warranty
    parts out of stock again.
  - `deleteJob` is also still allowed and leaves those moves behind.
- **Repro (qa10/svc S1):**
  1. Display stock: 5.
  2. Job with one warranty part (`item_id` set); claim sent, then approved.
  3. Call `billJob` three times. Each returns `undefined`, the job's `invoice_id` stays `undefined`, and stock is
     **2**.
- **Fix:**
  - Stamp the job when its warranty moves are made (e.g. `warranty_issued_at` / `billed: true`, or `warranty_move_ids`)
    and refuse a second issue.
  - Hide the button once done.
  - Make `deleteJob` remove those moves (or refuse).

### R10 — P1 — Sec 269ST is not applied to one bill paid in cash over several days

- **Cause:**
  - `liveSaleGuards` → `cashFromCustomer` (`rt-cash-guard.ts:64–69`) and `sameDayCash` (`:31–36`) count only cash
    dated the **same day**.
  - 269ST also bars ₹2 lakh or more "in respect of a single transaction" whatever the days. The bill's own earlier
    cash on other days is never added.
- **Repro (qa10/cash G1):**
  1. Guard *block*.
  2. A ₹3,00,000 necklace bill (PAN on file) received ₹1,90,000 in cash on 19 Jul.
  3. On 20 Jul `liveSaleGuards(bill, 50,000)` returns **[]**. Cash on the one bill is ₹2,40,000.
- **Fix:**
  - Add the bill's own cash receipts on any date (excluding no-cash rows and refunds) to `earlier` in both the POS strip
    and the payment dialog.
  - Keep the same-day per-person sum as is.

### R11 — P1 — Batch MRP typed per alternate unit is read as per base unit (MRP guard silent)

- **Cause:**
  - The stock engine copies a bill line's `mrp` onto the batch unchanged (`inventory.ts:567`, `mrp: line.mrp`). It does
    not divide by the line's `unitFactor`, while the rate is converted (`:559`).
  - `liveMrpIssues` (`stock-tracking.ts:851`) compares the selling price **per base unit** with that MRP.
  - The bill line's MRP field (`BillLineTracking.tsx:89–96`) is labelled just "MRP", next to a line in STRIP.
- **Repro (qa10/mrp M1):**
  1. Paracetamol, base unit TAB, alternate STRIP × 10, batch-tracked.
  2. Bill line: 10 STRIP at ₹40, MRP 62. Guard *block*.
  3. Selling 1 STRIP at ₹90 gives no issue, and ₹620 gives none either. ₹621 is the first to give "₹62.10 a unit … above
     the MRP ₹62.00".
  4. The 7U "block above MRP" check shares the same batch MRP (`stock-tracking.ts:803–809`).
- **Fix:**
  - Store batch MRP per base unit (`line.mrp / unitFactor`) in the purchase event, as the rate is.
  - Label the field "MRP per <line unit>".
  - Pin it with a test, as RT-B3 already converts ceilings.

### R12 — P2 — Margin scheme saved on a bill to a registered buyer

- **Cause:** `marginIssue` (`rt-buyback.ts:89–90`) is checked only by the *Margin scheme* button (`DevicesDesk.tsx:284`).
  No save gate re-checks it when the party changes afterwards.
- **Repro (qa10/margin B2):**
  1. Margin lines on a bill to Bharat Traders (GSTIN), saved through the store.
  2. GSTR-1 B2B: `rate 18, txval 3,389.83` on a ₹22,000 sale. The registered buyer's ITC is ₹610.17 on a
     margin-scheme supply.
- **Fix:** add a save gate (editor and POS) that refuses margin lines when the client has a GSTIN.

### R13 — P2 — POS cash guard nets refunds; the payment dialog does not

- **Cause:**
  - `sameDayCash` (`rt-cash-guard.ts:35`) sums every cash row of the customer that day, including negative refund
    rows.
  - `cashFromCustomer` (`:68`) keeps only `amount > 0`. Module comment: "refunds … are never counted as receipts".
- **Repro (qa10/cash G2):**
  1. ₹1,50,000 cash received, then a −₹1,00,000 cash refund row the same day.
  2. `sameDayCash` returns **50,000**, so a further ₹1,40,000 cash passes (`cashReceiptIssue` → null). Receipts that
     day total ₹2,90,000.
- **Fix:** filter `num(p.amount) > 0` in `sameDayCash`, or have the POS use `cashFromCustomer`.

### R14 — P2 — Old-gold PAN threshold is "≥" while the sale rule is "above"

- **Cause:** `recordOldGold` (`rt-old-gold.ts:66`) uses `v.value >= limit`. `panGuard` (`rt-cash-guard.ts:83`) uses
  `> limit`. The rule row is the same (Rule 114B, "exceeding ₹2 lakh").
- **Repro (qa10/cash G4):** 20 g × 100% × ₹10,000 = ₹2,00,000 exactly, without PAN, is **refused**. A ₹2,00,000 sale
  passes.
- **Fix:** use `>` (one rule), or document the stricter voucher rule as a deliberate choice.

### R15 — P2 — Financier's fee bill shows as unpaid after posting

- **Cause:**
  - `recordDisbursement` (`rt-finance.ts:179–197`) settles the fee against the financier's creditor balance in its
    voucher (Dr Creditors — fee).
  - It drafts the fee bill with `amount_paid: 0`, and posting a draft keeps 0 (`purchase-approvals.ts:149`).
- **Repro (qa10/fee P1):**
  1. Disburse ₹32,420 with a ₹1,180 fee, then post the fee draft.
  2. The bill's `balanceOf` is **1,180** and `payablesOutstanding` is **1,180**.
  3. The ledger shows creditor "Bajaj Finserv" at **0**.
  4. Paying it from Payables would pay the fee twice.
- **Fix:** mark the posted fee bill paid by the disbursement voucher (`amount_paid = fee`, a note naming the voucher),
  or create it already settled.

### R16 — P2 — Discarding a tailor-bill draft locks its alteration slips

- **Cause:**
  - `makeTailorBill` (`rt-alterations.ts:150–168`) stamps the slips with the draft id.
  - `tailorJobs` (`:66`) skips any slip with `tailor_bill_id`, and `deleteAlteration` (`:142`) refuses one.
  - Nothing clears the stamp when the draft is discarded.
- **Repro (qa10/fee P2):** deliver a slip, *Make tailor bill*, then discard the draft. `tailorJobs` is now **0** (the
  slip cannot be billed again), and deleting the slip is refused: "delete the tailor bill first".
- **Fix:** treat a stamp whose draft / bill no longer exists as unbilled (in `tailorJobs` and `deleteAlteration`), or
  clear it on draft removal.

### R17 — P2 — A rider-settlement journal deleted in Books orphans the settlement

- **Cause:**
  - `settleRider` (`rt-delivery.ts:191`) posts a class "Rider settlement" journal and stores a `rider_settlements` row
    that marks the COD receipts settled.
  - The class is not in `OWNED_VOUCHERS` (`trust/recycle-bin.ts:201–227`), and nothing refuses `deleteVoucher` on it.
- **Repro (qa10/rider C2):**
  1. Settle ₹1,240, then `deleteVoucher(settlement.voucher_id)`. It is **allowed**.
  2. `liveCashWithRiders` gives **0**, the ledger shows "Cash with riders" at **1,240**, and `settleRider` again fails
     with "This rider holds no unsettled cash".
- **Fix:**
  - Register the class as owned by `rider_settlements`: refuse the Books delete, or offer *Undo settlement*, which
    removes the row and the journal together.
  - Restore the pair as one entry.

---

## 3. Notes for the fix loop

- R1, R6 and R7 share one root: the URD voucher stores `amount_paid` separately from the receipt rows that settle it.
  Deriving "settled by exchange" from the rows, and "paid" from purchase payments plus exchange rows, fixes all
  three.
- R4 and R12 both need the GST readers to understand `InvoiceItem.margin`. A single helper (like `isNonGstFinancialNote`
  for financial credit notes) should be used by GSTR-1, 3B, HSN, e-Invoice and `turnoverOf`.
- Working-paper wording ("verify with your CA") is present on every R9 output checked; none of the findings above
  concern it.
