# QA round 13: hands-on audit of Round 12 (agriculture: AG-A farm base, AG-B dairy, AG-C mills, AG-D cold storage / inputs / FPO)

Status: findings fixed in the same loop, each with a regression test in `tests/qa13-agri.test.ts`. Baseline: branch
`claude/elegant-cannon-cwapiv` at `89d168b` (AG-A, AG-B, AG-C), then `789a935` once AG-D (cold storage, input dealers,
FPO / co-op) landed while the audit ran; AG-D was reviewed after that merge. The Round 12 suites (`tests/ag-*.test.ts`,
`purchase-contract`, `no-cash-readers`, `help-registry`) pass on both commits.

Method:
- **Real flows at the data layer**, through the repo's test harness (`tests/helpers/shim.ts`, `world.ts`, `ag-dairy.ts`,
  `mill.ts`), calling the same lib APIs the desks call:
  - dairy society: `addEntry` → `closeShift` (stock journal) → `makeMilkCycle` → `closeMilkCycle` / `closeCycle` with feed
    set-off → `payCycle`; `reopenShift` / `reopenCycle`; `saveDispatch` → `billDispatch`; milk cards `billCard`;
    `milkReco`;
  - rice miller: `openSlip` → `recordTare` → `voucherFromSlip` (FPV) / `addPaddyLot` (CMR, JWP) / `receiveForJob`;
    `runBatch` → `millMonths`; `addDelivery`; `millingChargesInvoice` (Circular 153 test); the 25 kg rule through
    `agExceptions`;
  - FPO / cold store: `addLot` → `transferBags` / `issueGatePass` (lien, rent bill) → `undoGatePass`; `giveLoan` →
    `repayLoan` → `undoRepayment` / `deleteLoan`; `allotShares` → `deleteShareRow`;
  - shared: `restoreEntry` (recycle bin) after every undo, `loadPositions` (stock), `preflightEway`, `normalizeRecord`.
- **Static review** of `src/lib/agri/*`, `agri-rules.ts`, the agri desks, the R12 rows of `backup.ts`, `sync-engine.ts`,
  `open-export-schema.ts`, `trust/recycle-bin.ts`, `demo/profile-agri.ts`, the stock reader (`inventory.ts`) and the
  e-Way preflight.

Severity:
- **P0:** money or data is wrong, data is lost, or there is a security issue.
- **P1:** a flow is broken, a stated Round 12 invariant is broken, or a tax document / return figure comes out wrong.
- **P2:** friction, a working-paper figure is off, or a cosmetic or printing error.

---

## 1. Summary

| # | Sev | Area | Finding | Fix | Test |
|---|---|---|---|---|---|
| G1 | P0 | AG-A4 cycles | **A cycle in which one farmer's deductions exceeded his milk money could not be paid** ("Amount exceeds the balance"): the pooled bill's `amount_paid` was `min(deductions, gross)`, so the other farmers' net no longer fitted. In the next cycle the carried-in recovery was never settled, leaving a phantom payable on every such bill | `amount_paid = gross − Σ net` — the bill's balance is exactly the farmers' net, whatever the deductions and carries | `G1` |
| G2 | P1 | AG-A4 / recycle bin | After **reopen + close again**, the first close's pooled bill, set-off receipt and deductions journal could be restored from the bin next to the new ones: the milk purchased twice (GSTR-3B Table 5, purchase register), the feed invoice set off twice, the deductions posted twice | `purchases` hook (a cycle bill only while its cycle names it), `transactions` hook (a set-off on a cycle bill only while a cycle lists the receipt), "Farmer cycle deductions" in `OWNED_VOUCHERS` | `G2` |
| G3 | P1 | AG-B3 milk bills | A **shift reopened and changed after the milk-bill draft** was made still closed with the draft's stale lines: purchase / farmer bills ≠ the shift sheet and the stock. A deleted milk draft could also be restored next to the bill made again for the same centre and period (milk paid twice) | `closeCycle` checks a milk draft against its tagged shifts (all closed, each farmer's amount equal) — "make the milk bill again"; `farmer_cycles` restore hook | `G3`, `G3b` |
| G4 | P0 | AG-B4 dispatch | **Milk sent to the union left stock twice**: the dispatch's consume journal and again the bill (its line "Cow milk", HSN 0401, matched the stock item — in kg, on the union's figures). 50 L collected, 40 L sent and billed → stock −30 L | The stock reader skips a milk-dispatch bill (`ag.kind === 'milk_sale'` with `ag.milk`); milk-card bills still move stock | `G4` |
| G5 | P2 | AG-C4 leftover | The "e-Way bill may not be needed for exempt goods" note existed only in `ewayHint` | `validateEway` warns `EWB_EXEMPT` (same text) when every goods line is at nil; CA AG82 | `G5` |
| G6 | P1 | AG-C4 25 kg rule | The class-rate notice and the 25 kg rule only saw lines carrying `ag_class`, which editor / POS lines never do: a **labelled 25 kg rice bag sold at nil was never flagged**. No way to mark a counter sale from a bigger bag (C4-2 leftover) | The hook takes the class from the stock item (by name); a line selling less than one pack (kg sold < `ag_pack_kg`, alternate units converted) is a loose counter sale — the POS "loose from bag" flag, derived, no new UI; CA AG81 | `G6` |
| G7 | P2 | AG-A5 lines | `normalizeRecord` dropped `ag_class` from lines, so opening a milk bill, milling-charges draft or feed invoice in the editor and saving it lost the class (feed set-off read as "input", the loose-produce declaration and the class notice disappeared) | `ag_class` added to the kept line keys | `G7` |
| G8 | P0 | AG-A4 set-off | **One feed invoice could be set off twice**: two drafts (or a remade one) pulled the same unpaid invoice and both closed — ₹400 feed, ₹800 receipts, the farmer short-paid. A draft whose feed invoice was paid in cash since closed with the stale amount | `closeCycle` refuses a feed / input set-off above the invoice's open balance at close ("make the draft again") | `G8` |
| G9 | P1 | AG-B4 / B5 | A **cancelled** milk-card or dispatch bill still counted as "billed": the card could not be corrected or billed again (the message said "cancel the bill to change it") | `liveBill` — a cancelled or deleted bill frees the card / dispatch | `G9` |
| G10 | P1 | AG-D1 / D3 lien | **Pledged bags could leave the borrower by "Transfer to another depositor"** — the gate-pass lien check was not applied, so the loan's security walked out on the receiver's child lot | `transferBags` applies the same lien / release-LTV rule | `G10` |
| G11 | P1 | AG-D3 / D5 recycle bin | An undone loan repayment, a deleted loan's disbursement and a deleted share allotment / surrender / forfeiture voucher could be **restored from the bin and post again** (no owner) | "Loan against produce" and the three share classes in `OWNED_VOUCHERS` | `G11` |
| G12 | P2 | AG-D1 gate pass / lots | `undoGatePass` left the pass's rent bill live, so a pass issued again billed the release (handling, month rent) twice; a lot under an open loan could be deleted | Undo refused while a live rent bill names the pass; delete refused while an open loan names the lot | `G10`, `G12` |
| G13 | P2 | AG-C5 mill report | Own intake read a bill line in an alternate unit wrongly (10 bags × 0.5 QTL → "5 kg") — a `lineFactor` miss | Base units × the item's kg per unit when the line carries a factor | `G13` |
| G14 | P2 | AG-A3 194Q | The 194Q prompt's FY base ignored the farmer's shares of pooled cycles (the pooled bill is in the centre's name) | `fyPurchasesOf` adds his lines on non-draft cycles of the FY; CA AG84 | `G14` |
| G15 | P2 | AG-A3 / AG-C1 | Deleting a farmer voucher made from a weighbridge slip left the slip "used" for ever; the voucher's Pay default used the total (an RCM voucher's tax is not the farmer's) | `deleteFarmerVoucher` frees the slip; restore refused once the slip made another voucher; Pay defaults to `balanceOf` | `G15` |
| G16 | P2 | dates / demo | CMR `saveAgreement` / `removePaddyLot` defaulted "today" to the UTC date; demo mill numbers used today's FY for rows dated in the old FY (first week of April) | `todayInput()`; each demo number in its own date's FY | `G16` |

### What was verified and is correct

- **Tax maths.** Milk, paneer (from 22 Sep 2025), loose cereals / pulses / flour: nil on a bill of supply with the loose
  produce declaration; pre-packaged ≤ 25 kg labelled at 5% (`PACKED_25KG_RULES`, exactly 25 in); milling for PDS: the
  Circular 153 test per bill (≤ 25% goods → exempt entry 3A, bill of supply; else 5%, tax invoice); job milling 5% for a
  registered principal, typed otherwise; storage of agricultural produce nil (entry 54(e)), other storage 18%; farmer
  vouchers carry the agriculturist declaration or the RCM line for notified goods (`reverse_charge`, the supplier's
  payable excludes the RCM tax); Rule 6DD(e) note instead of the 40A(3) warning only for agriculturists / pooled cycles.
- **Stock.** Milk enters stock once per closed shift; the pooled cycle purchase is skipped by `stock_by_shift`; rejected
  cans never enter; dispatch takes the sent litres out (now once — G4). CMR / job-milling paddy is a JWP register (never
  stock, kept out of the bank statement); cold-store lots are custody only — no stock reader touches `cold_lots`.
- **GSTR-3B Table 5.** One pooled exempt purchase per cycle; FPV vouchers once each; no set-off or journal creates a
  purchase (and, after G2, none can come back from the bin).
- **Cash / bank readers.** Feed set-offs reuse `exchange_purchase_id`; no agri module computes cash from receipts on its
  own; loan disbursements / repayments are real money vouchers (no marker needed). `no-cash-readers` unchanged.
- **Purchases contract.** Every agri reader goes through `readPurchase` / `readPurchaseLines` (`purchase-contract` R12
  cases).
- **Storage coverage.** All R12 tables (A–D) are in both backup lists and the open-export schema; dated / numbered tables
  sync by date (`farm_batches`, `farmer_cycles`, `milk_rate_charts`, `milk_shifts`, `milk_dispatches`,
  `weighbridge_slips`, and AG-D's lots / loans / shares); every writer imports `./ag-registry` (`ag-registry`,
  `ag-d-registry` tests).
- **Local dates and FY numbering.** `cyclePeriod`, shift dates, CYB / MDS / WBS / CMR / CSR / GPO / LAS / SHC numbers by
  the document's own date; a dispatch re-dated across 31 March takes a new number (`numberFitsFy`).
- **Large data.** One shift row per centre per date per shift (730 rows a year for a 300-farmer centre); a day reads ≤ 2
  rows; building a 10-day bill walks ≤ 20 rows.
- **Hindi / help / Ctrl+K.** Every R12 desk / view has English + Hindi strings (type-checked parity), a help topic and a
  Ctrl+K title (`help-registry`).
- **Demo company.** The agri profile writes only into the Demo company; the dairy block's shifts carry no stock journal
  by design (sample rows), the mill block's JWP rows are the principal's register.

### Not changed (noted)

- **Two devices entering cans into the same shift at once** sync as a row conflict (one row per shift); the conflict is
  listed for the user, nothing is merged entry by entry. One counter per centre and shift is the expected use.
- **Milling-charges bills are not tied to deliveries**: the desk suggests the delivered quantity, but billing the same
  rice twice is not refused (no link on the bill to the agreement beyond the snapshot).
- **A farmer's negative carry** is not added to his receivable on the Farmers view (the next cycle recovers it; AG80).
- **Allotment from application money** does not check the application balance (receipts may also feed that ledger).

---

## 2. Findings

### G1 — P0 — A cycle with an over-deducted farmer could not be paid

- **Repro:** Ram ₹1,000 of milk, ₹1,500 advance recovered; Sita ₹1,000 → close → Pay → "Amount exceeds the balance of
  500.00" (cash due ₹1,000). Next cycle: Ram ₹1,000, carried −₹500 → paid ₹500, the bill stays ₹500 "unpaid" for ever.
- **Fix:** `amount_paid = max(gross − Σ net, 0)`; the ledger is unchanged (the deductions journal still debits the
  pooled account with the full deductions; a farmer's carry shows as a debit there until the next cycle).

### G2 — P1 — Reopened cycle documents restorable next to the re-close

- **Repro:** close a cycle with a feed set-off → reopen → close again → Recycle bin → restore the first pooled bill (or
  the first set-off receipt, which brought the bill with it as a companion, or the first deductions journal).
- **Fix:** three hooks in `trust/recycle-bin.ts`; a stray delete of the live pooled bill (its cycle still names it)
  still restores.

### G3 — P1 — Stale milk drafts

- **Repro:** make the 1–10 Nov bill → reopen the 2 Nov morning shift → add a can → close it → close the bill: the farmer
  bills and the pooled purchase miss the can that is in stock.
- **Fix:** `milkDraftFresh` in `ag-cycle-post.ts` (also guards Farm → Cycles); a hand-typed milk cycle with no shift
  sheet is left alone. Restore hook refuses a milk draft next to a milk cycle of the same centre and overlapping period.

### G4 — P0 — Dispatched milk left stock twice

- **Fix:** one guarded line in `collectEvents` (`inventory.ts`, a lazy chunk), next to the R8 agency-line rule.

### G5 — P2 — e-Way note for exempt goods

- **Fix:** `EWB_EXEMPT` warning in `validateEway` (the e-Way / e-Invoice dialog's preflight), before the ₹50,000 note.

### G6 — P1 — 25 kg rule never reached typed sales; loose from a bag

- **Fix:** `agExceptions` (`ag-hooks.ts`): class = line class, else the stock item's; `counterLoose` when the line sells
  less than one pack (`kgPer` units, litres, or packs × `ag_pack_kg`, alternate units through `unit_factor`).

### G7 — P2 — Line class dropped by the editor

- **Fix:** `R9_LINE_KEYS` gains `ag_class` (first-paint store module, +4 B gzip).

### G8 — P0 — Feed invoice set off twice

- **Fix:** at close each set-off is checked against the invoice's open balance at that moment (receipts recorded
  earlier in the same close count); the whole close rolls back.

### G9 — P1 — Cancelled milk bills

- **Fix:** `liveBill(id)` in `ag-dispatch.ts`, used by dispatch edit / delete / bill and the card's `billed`.

### G10 — P1 — Lien bypassed by a transfer

- **Fix:** `transferBags` → `liensOn` + `releaseCovered` (as the gate pass); no owner override on a transfer.

### G11 — P1 — Loan and share vouchers restored from the bin

- **Fix:** `OWNED_VOUCHERS` rows: a restore is allowed only while the loan / share row still names the voucher.

### G12 — P2 — Gate-pass undo and pledged lots

- **Fix:** `undoGatePass` refuses while a live rent bill carries the pass's `out_id`; `deleteLot` refuses while an open
  loan names the lot.

### G13 — P2 — Mill intake in alternate units

- **Fix:** `millMonths` own intake: `quantity × unitFactor × kgPer(item unit)` when the line has a factor.

### G14 — P2 — 194Q base

- **Fix:** `fyPurchasesOf(vendorId, date, purchases, cycles)`; Farm → Vouchers passes the cycles.

### G15 — P2 — Voucher delete and its weighbridge slip

- **Fix:** `deleteFarmerVoucher` (`ag-vouchers.ts`), `purchases` restore hook on `ag.voucher.wbs_id`; Pay defaults to
  `balanceOf(bill)`.

### G16 — P2 — Local dates

- **Fix:** `todayInput()` in `ag-cmr.ts` / `ag-mill-bom.ts`; `profile-agri.ts` numbers by each row's date.

---

## 3. AG-C leftovers wired in

- **e-Way note for exempt goods** — G5 (in the existing e-Way preflight, lazy).
- **POS "loose from bag"** — G6: derived from the quantity sold against the stock item's pack size, so a POS or editor
  line of 5 kg from a labelled 25 kg bag is loose without a new control, string or icon.

## 4. Checks and budget

`tsc -b` clean; `eslint .` 0 errors (27 warnings, as before); `node --test` 3,268 / 3,268 (the 17 regressions in
`tests/qa13-agri.test.ts` fail on `789a935` and pass after the fixes); `vite build` + `postbuild` ok; bundle check ok;
Playwright smoke (`E2E_TIMEOUT=60000`) all checks passed (511 PASS lines). `npm run …` exits 216 in this sandbox, so each
command was run directly.

Budget (vite build, gzip -9, against `789a935`): first paint 189,147 B → 189,149 B (**+2 B**: `ag_class` in the editor's
kept line keys, G7); total JS 3,210,900 B → 3,210,909 B (**+9 B**: ≈ +1.3 kB of lazy fixes — recycle-bin hooks +0.37,
cycle checks +0.3, `ag-hooks` +0.21, `ag-vouchers` +0.2, e-Way note +0.07 — offset by `ag-loans` now sharing the
`ag-cold-lots` chunk for the transfer lien check, −0.4 kB net). No new icon.

## 5. CA questions added

AG80 (pooled account debit for a carried farmer), AG81 ★ (loose sale from a labelled bag), AG82 (e-Way for nil goods),
AG83 (dispatch stock vs the union's bill), AG84 (194Q with pooled cycles) — `docs/CA_REVIEW.md` §12.9.
