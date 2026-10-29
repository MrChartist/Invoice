# QA round 25: Round 21 (fuel: petrol pumps, CNG stations, LPG distributors)

Status: findings fixed in the same pass, each with a regression test that fails on the baseline source:
`tests/qa25-fuel.test.ts` (W1–W6, seven tests; all seven fail on `bef8125`'s `src/`). Baseline: master `bef8125`
(#116 R21-A, #122 R21-B, #123 R21-C, #125 R21-D, PERF-6 #120). Two e2e flakes (R20-B, R20-D) are fixed in the same
branch (section 3).

Method: the spec (`docs/prd/round-21.md`, CA items FU1–FU30) and the notes (`docs/features/fuel-r21.md`) were read
against `src/lib/fuel/*`, `fuel-rules.ts`, `types/fuel-r21.ts`, `components/fuel/*`, `parts/FuelLines.tsx`, the e-Way
hook, `common-credit.ts` / `CommonCreditView.tsx`, POS `NozzleChip`, the wizard card and Settings → Features. Money
paths were walked at the data layer: a pump day from shift open to day close and slip billing, POS fuel sales, the
monthly stock-register voucher and the Rule 42 run.

Severity: **P0** money or data wrong, data lost, security; **P1** a flow broken, an invariant broken, or a tax figure
wrong; **P2** friction, a working-paper figure off, cosmetic.

---

## 1. Summary

| # | Sev | Area | Finding | Fix | Test |
|---|---|---|---|---|---|
| W1 | P0 | Credit slips × day close | The slip book (`CreditView` → `saveSlip`) never set `FuelSlip.shift_id` / `nozzle_id`, and `billedInShift` only takes a slip off the counter litres when both are set. Every slip's litres were billed **twice**: on the shift's counter Bill of Supply (the meter value) and again on the month-end slip bill. The counter bill also kept the slip amount as a phantom balance due (the attendant hands over slips, not cash), shown as a shortage. | `linkSlip` (`fu-slips.ts`, pure): a typed shift / nozzle is checked; otherwise the one not-posted shift of the slip day that holds a nozzle of the product, and its one such nozzle; several → "Pick the shift / nozzle"; no shift that day → no link. `saveSlip` stores the link. A slip on a day-closed shift (new, edit or delete) is refused ("undo its day close first"); an open shift with linked slips cannot be deleted. `CreditView` shows Shift / Nozzle pickers when there is more than one (existing labels). | W1 ×2 |
| W2 | P1 | Stock out of the tank | POS fuel lines (`fuelLine`) and slip-bill lines (`planSlipBills`) carried no `godown_id`, so their litres left the default godown, not the tank; the tank's engine stock was overstated and the main godown went negative (the day close was right). | `tankOf` (`fu-line.ts`): the nozzle's tank, else the one tank every nozzle / tank of the product shares. `fuelLine` sets `godown_id` (the POS strip passes it; `sig` includes it so the line updates); `planSlipBills` groups slip lines per tank and sets `godown_id` (`billSlips` passes `tankOf`). | W2 |
| W3 | P1 | Rule 42 duty exclusion / 3.1(e) check | The day-close Bill of Supply carried `fu.shift_id` but no `fu.lines`, and `dutyOf` reads only `fu.lines`. Every counter litre (most of a pump's sales) was left out of the excise + VAT exclusion from E and F, and `check31e` listed a false 3.1(e) mismatch. | `counterLines` splits each nozzle's counter litres by price segment (billed litres / ₹ come off the segments in proportion to their litres; the last segment takes the remainder, so the bill equals meter value − billed to the paisa); the day-close bill writes `fu.lines[lineId] = { litres, price_id, rsp, at }` per line. | W3 |
| W4 | P2 | Dips | A water dip above the product dip gave negative product litres (chart(mm) − chart(water mm)), saved into the register. | `dipLitres` refuses it with the reason. | W4 |
| W5 | P1 | Nozzle delete | `removeNozzle` deleted a nozzle that already had shifts (its own comment said B would deactivate it): the shift / DSR / day close could no longer price its readings ("no price in force" for an empty product), and a later re-created nozzle lost the carried opening. | A nozzle on any shift is deactivated (`active: false`); an unused one is still deleted (to the recycle bin). | W5 |
| W6 | P1 | Monthly loss voucher | "Post loss / gain for the month" counted the dip as the tank's physical stock. The books had not yet taken out unbilled slip litres (FU7: the slip bill does that later), so the voucher booked them as a loss and the slip bill took them out again (lost twice). Shifts not yet day-closed did the same with their counter litres. | `booksLag` (`fu-stock-io.ts`): the voucher counts dip + unbilled slip litres of that tank dated on or before the day; posting is refused while a shift of the month holding the tank's nozzles is not day-closed. | W6 |

## 2. Paths walked and found right

- ₹ → litres: `litresFor` keeps the amount exact and rounds litres to three decimals (₹500 at ₹94.72 = 5.279 L, line
  ₹500.00); the price in force is the latest row at or before the moment, a change exactly at the shift's open is the
  opening price, a change inside the shift splits only with a typed reading (FU9), otherwise all at the opening price.
- Shift maths: test litres never sold, wrap only within a tenth of the dial, negative sales refused, carried opening
  with an audited reason, close time before the start closes next day.
- Settlement: expected = meter value − POS bills of the shift; credit-slip collections are not receipts; the excess
  comes off cash first; receipts never exceed the bill; clearing accounts are created `clearing: true` and never
  offered by `pickableBankAccounts`; the shortage write-off is owner only (`doc.deleteIssued`) and `movedNoCash`.
- Day close: one `saveMany` for the day inside `withTablesRollback`; period lock through `saveMany`; undo removes the
  receipts (write-off included), cancels the bill (number kept, lock checked by `setStatus`) and reopens the shift.
- Slips: unique slip no., vehicle limit is a warning, billed state derived from live `fu.slip_ids`, cancelling frees.
- GST: fuel-only bill = Bill of Supply `NON_GST`; mixed B2C = Rule 46A title; mixed to a GSTIN buyer refused at the
  POS (bill the parts separately); Table 8 non-GST column and 3.1(e) via the R10 line column; e-Way leaves non-GST
  lines out (Rule 138(14)).
- Register: book = opening dip + invoice receipts − (meter − test); physical = next morning's dip; MDG band hint;
  re-posting the month edits the one voucher (`physicalLines` excludes itself).
- Registry: every Round 21 table in `fu-registry.ts` (rights, audit labels), backup, sync DATED rows, recycle bin and
  sync engine import the registry; no new lucide icon; bridges `fu-issue-io` / `fu-stock-io` / `fu-recv-io` (3 ≤ 4).

## 3. e2e flakes

- **R20-B "Alt+D then Undo"**: after Ctrl+A saves, the post-save send sheet is lazy; the step pressed Escape at once,
  and when the sheet opened late it stayed open as an `aria-modal` dialog that swallows Alt+D, so the Delete dialog
  never came. The step now waits for `[data-send-sheet]`, presses Escape, waits for it to detach and for no
  `aria-modal` dialog, then presses Alt+D. Assertions unchanged.
- **R20-D `menu-data`**: Alt+Y is handled only once the bell has lazily mounted `MenuSheets` (its `useKeyActions`
  registration); the step slept 400 ms, too short right after `verify-offline`. `MenuSheets` now sets
  `body[data-key-sheets]` after its keys are registered, and the step (both of its former sleeps) waits for it.
  Assertions unchanged.

## 4. For the owner / CA

1. **OMC netting vs. fleet-card clearing** (R21-D cut 2): day close posts fleet-card / loyalty money to the clearing
   *bank* account "Fleet-card receivable (OMC)"; a future OMC netting receipt (Dr OMC creditor / Cr OMC debtor) cannot
   clear a bank-type clearing account. Decide the design (a debtor ledger for the OMC, or a transfer from the clearing
   account) before the OMC account returns.
2. **HSN summary (GSTR-1 Table 12) for non-GST fuel**: a GSTIN holder's non-GST lines (HSN 2710 / 2711) go into the
   HSN summary at 0 % (R10 behaviour). Confirm with the CA whether non-GST supplies belong in Table 12.
3. **FU7 accrual**: W6 keeps the books right by counting unbilled slips in the monthly voucher; whether unbilled slips
   should be accrued as sales at month end (rather than billed on the next run) is still FU7.
4. **LPG distributor kind**: the wizard still offers "LPG distributor" though the LPG view was cut at R21-D; the
   landing `view=lpg` falls back to Tanks with no tabs (pack `lpg` only). Hide the kind until Round 22, or ship it.
5. **Slip after the day close**: a slip typed for a day whose shifts are all day-closed is refused (its litres are on
   the counter bill). Pumps that write the slip book next morning must undo the day close first; an alternative is a
   credit note on the counter bill. Owner's call.
6. **Opening shift 2 before closing shift 1** carries the older closing; closing shift 1 then makes shift 2 ask for an
   opening reason. Consider refusing a second open shift for the same nozzle.
7. Fuel lib refusals in `fu-slips.ts` / the new W1 / W6 messages are English only (as `fu-slips.ts` was); move them
   into `fuel-r21d` with Hindi once the em-dash pass on `src/i18n/areas/*` has landed.

## 5. Sizes (gz)

| | `bef8125` | this branch |
|---|---|---|
| Initial JS | 177.5 kB | 177.5 kB |
| Core precache | 3,288.5 kB | 3,289.4 kB (+0.9) |
| Hindi pack | 391.7 kB | 391.7 kB |
| lazy-leaves-ui | 27.7 / 28 kB | 27.7 / 28 kB |

Per chunk: `CreditView` +0.6 (slip link), `fu-stock-io` +0.3, `f-fuel` +0.2, `fu-issue-io` +0.1, `MenuSheets` +0.04.
