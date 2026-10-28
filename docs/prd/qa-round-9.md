# QA round 9: hands-on audit of Round 7 (hotel / lodging pack: R7-A front office, R7-B folio and billing, R7-C compliance and reports)

Status: findings for the fix loop. Baseline: branch `claude/elegant-cannon-cwapiv` at `188f91c` (R7-A, R7-B and R7-C
merged). The existing hotel suites pass (`tests/hotel-*.test.ts`, 89 tests). Every finding below was reproduced on that
commit.

Method:
- **Data layer.** Node probes through the repo's test harness (`tests/helpers/shim.ts`, `tests/helpers/hotel.ts`,
  `tests/helpers/world.ts`). They call the same lib APIs the screens call: `saveReservation`, `takeAdvance`,
  `closeReservation`, `checkIn`, `runNight` / `runAudit`, `postCharge`, `voidLine`, `draftFor` / `saveCheckout`,
  `advancesFor`, `chargeCancellation`, `chargeOrderToRoom` / `undoRoomCharge` / `chargePosToRoom`, `premisesNow`,
  `hotelGuards`, `nightStats` / `occupancyByDay`, `buildGstReport`, `preflightEInvoice`, `computeStock`,
  `genericChanges`, `localDb.invoices.remove`.
- **Static review** of `src/lib/hotel/*.ts`, `FolioView.tsx`, `HotelGstTab.tsx`, `RoomPicker.tsx` and the readers the
  hotel documents reach (GST reports, advances, stock, edit log, recycle bin).
- No browser run was needed: every finding reproduces at the data layer. Where a finding depends on what the screen
  does (for example "the folio UI posts an unlinked allowance"), the screen code is cited.

Probe files: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa9/probes/`
(`zz-qa9-premises.test.ts`, `zz-qa9-money.test.ts`, `zz-qa9-flow.test.ts`, `zz-qa9-adv.test.ts`,
`zz-qa9-incl.test.ts`, `zz-qa9-ctr.test.ts`). They were run from `tests/` and moved out afterwards (nothing committed).
To run one, copy it into `tests/` and run
`node --experimental-strip-types --import ./tests/hooks/register.mjs --test tests/<file>.test.ts`. Each scenario prints
one `#` line per check. Below, `qa9/` means the probes folder above, and a letter (A, B …) is the probe's test name.

This doc reports bugs only. It proposes no new features.

Severity:
- **P0:** money or data is wrong, data is lost, or there is a security issue.
- **P1:** a flow is broken, a stated Round 7 invariant is broken, or a tax document comes out wrong.
- **P2:** friction or a cosmetic or printing error.

---

## 1. Summary

| # | Sev | Area | Finding |
|---|---|---|---|
| H1 | P0 | Check-out / night audit | Check-out bills only the nights the audit has posted. Nights a missed audit never posted are lost: the line is closed, so catch-up skips them. With no audit at all, check-out succeeds with **no invoice** |
| H2 | P0 | Tax-inclusive plans | In the band gap (gross ₹7,875.01–₹8,850 from 22 Sep 2025), the night is reverse-solved at 18% but billed at 5%. An ₹8,000 inclusive night is billed **₹7,118.64**. Across 22 Sep 2025, inclusive nights solved at 12% are billed at 5%, so the inclusive price is not kept |
| H3 | P0 | Meals priced separately | The folio posts the full room rate **plus** the meal share. A ₹8,000 MAP night (meals ₹1,000 inside) is billed ₹9,000. `premises.ts` assumes the meal is inside the rate, so the two disagree |
| H4 | P1 | F&B rate (known gap) | `isSpecified` (check-out) and `premisesStatus` (GST tab) disagree in three realistic cases: meals-separate plans, early check-outs and branch premises. Check-out bills F&B at 18% while the tab says 5%, or the reverse |
| H5 | P1 | Bands / discounts | An allowance posted from the folio screen has no night link. It becomes a document discount **after** banding, so a ₹8,000 night less ₹1,000 is taxed at 18% on ₹7,000. The tab's band guard then flags the app's own invoice |
| H6 | P1 | Company billing | Every allowance routes to window 1, even when the company pays the room in window 2. Window 1 then totals below zero and check-out is refused ("W1: nothing to bill") |
| H7 | P1 | Cancellation | A company-billed booking whose **company** paid the advance is invoiced to the guest (B2C) on cancellation. The company's advance is not applied: it is refunded in full, and the guest's invoice stays unpaid |
| H8 | P1 | Advances | At check-out, advances are matched by guest name. Another booking's advance from a guest with the same name is offered and pre-ticked, and it is consumed |
| H9 | P1 | Reports / night audit | After an early check-out, the room still counts as occupied until the booked departure. If it is resold, it counts twice and ADR halves |
| H10 | P1 | Year-end interim | The night audit offers the 31 March interim only after the audit has moved the business date to 1 April. The interim invoice is dated 1 April (next FY) and carries the March nights |
| H11 | P1 | Recycle bin / folio | Deleting a check-out invoice leaves the folio "invoiced" and its lines stamped with the dead invoice id. The stay can never be billed again |
| H12 | P1 | POS charge to room | The POS "Room" tender makes one line for the whole bill at the **highest** item rate, with no HSN. Stock never moves: there is no POS bill, and the check-out line has no item |
| H13 | P1 | Restaurant charge to room | `undoRoomCharge` is not reachable from any screen. The only folio action, void, closes the order for good: it cannot be undone, re-charged or settled |
| H14 | P2 | Privacy / edit log | Reservation edits log the `guest` object as JSON, which includes the phone and email. The edit log hides those fields everywhere else |
| H15 | P2 | Night audit | "Payments by mode" leaves out advance receipts taken at the desk, so the night's cash tally is short by every deposit |
| H16 | P2 | Period lock | An in-house long stay cannot be extended once its arrival month is locked: the whole booking edit is refused |

### What was verified and is correct

- **Place of supply.**
  - A Karnataka company (GSTIN) staying at a Maharashtra property gets POS 27 with CGST + SGST.
  - The GSTR-1 B2B row carries POS 27 and CGST. The e-invoice preflight has no errors (`BuyerDtls.Pos` 27).
  - The only GSTR-1 note is the `POS_VS_GSTIN` **info** line.
  - A room advance from the same company is INTRA (CGST + SGST) at the band rate.
- **Interim then final.** The interim invoice bills the posted nights. The final invoice bills only the rest. No line
  is billed twice (qa9/K).
- **Night audit.** Catch-up runs night by night and is idempotent. Split keys keep the night posted.
- **Existing suites.** These pass: band boundaries (₹7,500.00 / ₹7,500.01, extra bed), the 22 Sep 2025 chip, OTA
  TCS_52 / PAY_9_5 / 194-O, the payout clearing netting to zero, Form C 24 h across midnight, and the D14 statistics
  formulas.

---

## 2. Findings

### H1 — P0 — Check-out after a missed night audit silently drops the un-posted nights

- **Cause:**
  - `saveCheckout` (`src/lib/hotel/checkout-save.ts:112–129`) bills only lines already on the folio
    (`billable`, `checkout.ts`). It never compares them with the stay's nights.
  - When a window has no lines, `if (!draft.lineIds.length) continue;` (`:116`) skips it with no invoice.
  - Then `markCheckedOut` (`:128`) closes the line.
  - `runNight` posts only `checked_in` lines (`night-audit.ts:111`), so the catch-up audit never posts the missing
    nights.
- **Repro (qa9/zz-qa9-flow.test.ts L, L2):**
  1. **L:** Book 20–23 Oct at ₹3,500 and check in. Run the audit for 20 Oct only; the audits for 21 and 22 are
     missed.
  2. Check out on the 23rd. Result: one invoice for **₹3,500, 1 night**.
  3. `runAudit({ today: '2026-10-24' })` posts **0** keys for 21, 22 and 23. Two nights (₹7,000 + GST) are never
     billed.
  4. **L2:** Book 20–22 Oct, check in, run no audit, then check out. Result: **0 invoices**. The line is
     `checked_out` and the folio is `invoiced`.
- **Fix:**
  - Before a **final** check-out, post every un-posted night of the line up to `min(departure, business date)`
    (`postNight` is idempotent). Or refuse with "Run the night audit first (n nights not posted)".
  - Never mark a window `invoiced` without an invoice while the stay has nights.

### H2 — P0 — Tax-inclusive plans are billed below the inclusive price (band gap, and across 22 Sep 2025)

- **Cause:**
  - `priceNight` (`pricing.ts:61`) reverse-solves the gross with `bandForInclusive`.
  - For a gross in the gap, `bandForInclusive` (`hotel-rules.ts:86`) returns the top band's rate (18%) and a value
    below ₹7,500 (`gap: true`).
  - At check-out, `buildCheckoutInvoice` bands that value again with `accommodationBand(value, day)`
    (`checkout.ts:154`). Below ₹7,500 that gives 5%.
  - The same happens for nights before 22 Sep 2025 (solved at 12%) that are invoiced after it (billed at 5%).
  - `hotelGuards` sees 5% on a value under ₹7,500 and does not flag it.
- **Repro (qa9/zz-qa9-incl.test.ts S):**

  | Plan (inclusive) | Nightly value | Invoice | Guest agreed |
  |---|---|---|---|
  | ₹8,000 × 2 nights, Oct 2026 | 6,779.66 (`gap`) | 13,559.32 + 5% = **₹14,237** | ₹16,000 |
  | ₹9,000 × 1 night | 7,627.12 | ₹9,000 at 18% (correct) | ₹9,000 |
  | ₹7,000 × 3 nights, 20–22 Sep 2025, invoiced 23 Sep | 6,250 / 6,250 / 6,666.67 | **₹20,125** at 5% | ₹21,000 |

- **Fix:**
  - For a tax-inclusive night, store the solved rate on the night (`NightPrice.rate`). Have check-out bill that rate.
  - When the invoice date's rule differs from the night's, re-solve the value from `gross` at the invoice date
    (`bandForInclusive(gross, day)`). That keeps the inclusive price (D6), and the chip shows the change.
  - For `gap`, the PRD's "take the higher band" must survive to the invoice. Carry `band_value` above ₹7,500, or
    force 18% on that line.

### H3 — P0 — Meals-separate plans bill the meal on top of the plan rate

- **Cause:**
  - `priceNight` treats `meal` as the share **inside** `total` (doc: "meal is the meal share inside total").
  - `nightLines` (`room-post.ts:76, :79`) posts `room = price.room` (the full rate) and also an `fnb` line for
    `price.meal`.
  - `premises.ts:42` reads the same night as `total − meal`. So one module thinks the meal is inside the rate and
    the other adds it on top.
- **Repro (qa9/zz-qa9-premises.test.ts A):**
  1. MAP plan with `meals_separate`, ₹8,000 for 2 adults, ₹500 meal per adult.
  2. The snapshot is `{ room: 8000, meal: 1000, total: 8000 }`. The booking value and the advance base are ₹8,000.
  3. The folio posts `room 8,000` + `fnb 1,000`. The invoice taxable value is **₹9,000** (8,000 at 18% + 1,000 at
     5%).
- **Fix:** For a meals-separate plan, post `room = price.room − price.meal` (when the meal is inside the rate) and
  the `fnb` meal line, so the folio equals `total`. Then `premises.ts` and the folio agree. If instead the meal is
  meant to be on top, `total` must include it, and `premises.ts:42` must stop subtracting it. Either way, pick one
  meaning and pin it with a test that compares folio total to `stayTotal`.

### H4 — P1 — Check-out's `isSpecified` disagrees with the GST tab's `premisesStatus` (the known gap)

- **Cause:** `draftFor` (`checkout-save.ts:61`) uses the stand-in `isSpecified(day, hs, fyMaxNight(folios, fy−1))`
  (`checkout.ts:43–66`). The GST tab and its F&B guard use `premisesNow` / `premisesStatus` (`premises.ts:95`). The
  two read different evidence:
  - **Meals separate.** `fyMaxNight` sums posted folio room lines (₹8,000). `prevFyMax` uses `total − meal`
    (₹7,000).
  - **Early check-out.** `prevFyMax` reads every snapshot night of a `checked_out` line, including nights never
    stayed. `fyMaxNight` reads only posted nights.
  - **Branch premises (D18).** `isSpecified` ignores `property_id`. It takes every property's folios and every
    declaration (no `property_id` filter, no `declError` check). `premisesStatus` is per premises. Also, the tab's
    guard always uses the **main** premises' status, even for a branch's invoices (`HotelGstTab.tsx:54, :59`).
- **Repro (qa9/zz-qa9-premises.test.ts A, B, C):** Each case sets up a stay in FY 2025-26, then compares the
  check-out F&B rate in Oct 2026 with `premisesNow(2026)`.

  | Case (FY 2025-26 history) | Check-out F&B, Oct 2026 | GST tab FY 2026-27 |
  |---|---|---|
  | A: MAP meals-separate ₹8,000 night | **18%** | not specified (prev ₹7,000) → 5% |
  | B: booked Thu ₹7,000 + Fri ₹8,400, left Friday morning | **5%** | specified (prev ₹8,400, a night never stayed) → 18% |
  | C: branch property suite ₹8,000, main property ≤ ₹3,500 | main check-out **18%** | main not specified → 5% (branch specified) |

  In A and C, the tab's F&B guard flags the app's own check-out invoices.
- **Fix:**
  - Replace `isSpecified` with `premisesNow(fyOfDay(day), res?.property_id ?? room.property_id).specified`.
  - Make `prevFyMax` read what was actually supplied: posted, non-void folio night lines after linked allowances
    (fall back to snapshots only for nights with no folio), per `property_id`.
  - In `HotelGstTab`, evaluate each invoice against its own premises (the sender profile id).

### H5 — P1 — An unlinked allowance becomes a document discount after banding

- **Cause:**
  - The folio screen posts every charge through `postCharge(...)` with no `src` (`FolioView.tsx:81`), so an allowance
    is never linked to a night.
  - `buildCheckoutInvoice` turns unlinked allowances into `discount_type: 'AMOUNT'` (`checkout.ts:135, :186`). It
    bands each night on its undiscounted value (`:153–154`).
  - D2 says the value is **after** the night's share of discounts.
- **Repro (qa9/zz-qa9-premises.test.ts D):**
  1. One ₹8,000 night.
  2. Post an allowance of ₹1,000 ("Goodwill discount") from the folio.
  3. Result: item ₹8,000 at **18%**, discount ₹1,000, taxable ₹7,000, tax ₹1,260, `hotel_band: 'high'`.
  4. `hotelGuards` returns `{kind:'band', expect:5, got:18, amount:7000}` on that invoice.
- **Fix:**
  - Let the folio screen link an allowance to a night (default: the latest posted night of the stay).
  - Or, in `buildCheckoutInvoice`, spread unlinked allowances over the night groups pro rata before banding (and over
    the other lines by value), never as a document discount.

### H6 — P1 — Allowances on a company-billed stay block check-out

- **Cause:** `windowFor` routes only `ROOM_KINDS` to window 2 (`room-post.ts:18, :23`). An allowance (even one linked
  to a night) lands in window 1.
  - Window 1 then holds a negative balance, and `saveCheckout` refuses ("nothing to bill", `checkout-save.ts:117`).
    The refusal stops every window.
  - A linked allowance that is billed alone also loses its night: the group has no base line, so it is dropped.
- **Repro (qa9/zz-qa9-premises.test.ts E, E2):**
  1. Booking billed to Acme. One ₹3,500 night is in W2 (Acme).
  2. Post a ₹500 allowance (linked in E, unlinked as the screen does in E2). It lands in W1 (guest) as −500.
  3. Check out. Result: `RES/FY26-27/0001 · W1: nothing to bill.` Nothing is saved.
- **Fix:**
  - Route an allowance to the window of the night it is linked to (or of the line it discounts). Unlinked ones go to
    the window holding room charges.
  - Allow a window whose total is ≤ 0 when another window absorbs it, or refuse with "move the allowance to W2".

### H7 — P1 — Cancellation of a company-billed booking ignores the company's advance

- **Cause:**
  - `chargeCancellation` bills the company only when `guarantee === 'company'` **and the booking has no advance**
    (`cancellation.ts:94`). Otherwise the guest is the payer (`:97`).
  - `takeAdvance` takes the advance from the **bill-to** company (`reservations.ts`, `takeAdvance`).
  - `advancesFor(folio, res)` matches the guest party, so the company's advance is never applied (`:105`).
  - The refund loop then refunds the company's whole advance (`:115`).
- **Repro (qa9/zz-qa9-money.test.ts H):**
  1. Karnataka company bill-to, `guarantee: 'company'`, policy first night.
  2. The company pays an advance of ₹7,350.
  3. Cancel inside the charge window and charge with a refund. Result:
     - Invoice to **"Asha Rao"**, no GSTIN, ₹3,675, status `Sent` (unpaid), no payment rows.
     - The company's ₹7,350 advance refunded in full (RFV).
- **Fix:** When the booking has a `bill_to` and any of its advances belongs to that client, make the company the
  payer (B2B, on its GSTIN). Apply the booking's own advances by id (`res.advance_ids`), not by payer match.

### H8 — P1 — Another booking's advance is pre-ticked at check-out (same guest name)

- **Cause:**
  - `advancesFor` (`checkout-save.ts:65–71`) asks `openAdvancesFor({ name })` for a guest window. That matches every
    advance of any guest with the same name; the booking's own are only sorted first.
  - The check-out dialog pre-ticks **all** of them (`FolioView.tsx:165`).
  - `saveAndSettle` applies them in order until the invoice is covered.
- **Repro (qa9/zz-qa9-adv.test.ts P):**
  1. Booking A for "Asha Rao", 2 nights, ₹2,000 advance.
  2. Booking B (a different phone, arriving 5 Nov) for "Asha Rao", ₹5,000 advance.
  3. Check out A. Offered: ADV/0001 ₹2,000 and **ADV/0002 ₹5,000**.
  4. Result: invoice ₹7,350, paid with `[2000 own, 5000 OTHER BOOKING]`.
- **Fix:** For a guest window, offer only `res.advance_ids` (plus advances with no booking of a matching guest id).
  Pre-tick only the booking's own.

### H9 — P1 — Early check-out keeps the room "occupied" until the booked departure

- **Cause:** `occupiedOn` (`night-audit.ts:82–83`) and `occupiedNights` (`hotel-reports.ts:57`) count `checked_out`
  lines over `lineDates` (the **booked** dates). `markCheckedOut` never shortens the line's departure or nightly
  snapshot. The same stale snapshot feeds `prevFyMax` (H4 B).
- **Repro (qa9/zz-qa9-money.test.ts I):**
  1. Book 101 for 20–23 Oct and check out on the 21st.
  2. Resell 101 for 21–22 Oct and audit the 21st.
  3. Result:
     - The audit row shows `occupied: 2` on 3 rooms (66.67%), revenue ₹3,500, **ADR ₹1,750** (true: 1 room, ADR
       ₹3,500).
     - The 22nd (no guest) reads 1 occupied (33.33%).
- **Fix:** On check-out before departure, set `line.departure` to the check-out business day (keep the booked dates in
  a separate field if needed), and trim `nightly` to the nights stayed.

### H10 — P1 — The year-end interim invoice lands in the next FY

- **Cause:**
  - `runNight` rolls the business date (`night-audit.ts:159`) before it returns `yearEnd: true` (`:161`).
  - The screen then offers the interim. `saveCheckout` dates it `business_date` = 1 April.
  - Before the audit, an interim on 31 March cannot include the 31 March night, which is not posted yet.
  - So D7's "invoice on 31 Mar for in-house guests" never yields a 31 March document for the March nights posted
    after the 30th.
- **Repro (qa9/zz-qa9-money.test.ts K):**
  1. Stay 30 Mar – 2 Apr 2027. Audit 30 and 31 Mar; the result is `yearEnd: true` with business date 2027-04-01.
  2. Take the interim. Result: **INV/FY27-28/0001**, dated 2027-04-01, nights 30 and 31 Mar, ₹7,000.
- **Fix:** Bill the year-end interim with `day: night` (the audited 31 March) in the audit result's follow-up. Or run
  it inside `runNight` after posting and before the roll, when `interim_year_end` is on.

### H11 — P1 — A deleted check-out invoice orphans the folio

- **Cause:** Nothing reacts when a hotel invoice is deleted.
  - The folio keeps `status: 'invoiced'` and its lines keep `src.invoice_id` (`checkout-save.ts:120–121`).
  - `saveCheckout` refuses an invoiced folio (`:114`).
  - There is no recycle-bin hook for `invoices` with `folio_id`.
- **Repro (qa9/zz-qa9-flow.test.ts M):**
  1. One-night stay, checked out.
  2. `localDb.invoices.remove(inv.id)`. The invoice goes to the bin.
  3. Result: the folio stays `invoiced`, with every line stamped with the deleted id. A re-bill is refused: "This
     folio is already billed."
- **Fix:**
  - On delete (or cancel) of an invoice with `folio_id`, clear `src.invoice_id` on its lines and reopen the folio.
  - Register a `restoreHook('invoices')` that re-stamps the lines only if they are still free, and refuses when they
    were billed again.

### H12 — P1 — POS "Room" tender: wrong tax, no HSN, no stock movement

- **Cause:** `chargePosToRoom` (`charge-to-room.ts:75–83`):
  - It posts **one** line for `taxable_value` with `tax_rate = max(item rates)`.
  - A non-F&B bill becomes `misc` with no `sac`, so the check-out item has `hsn: ''`.
  - No POS invoice is saved. The check-out line carries no `item_id` and a made-up name ("POS · …"), so
    `computeStock` never issues the goods.
  - The restaurant path has the same stock gap: `chargeOrderToRoom` posts one "Restaurant · KOT …" line.
- **Repro:**
  - **qa9/zz-qa9-money.test.ts J:**
    1. POS bill: water 2 × ₹50 at 18% (HSN 2201) and biscuits ₹100 at 5% (HSN 1905).
    2. Result: folio `misc 200 @18`. At check-out the item is `["POS · Packaged water, Biscuits", 200, 18, ""]`. Tax
       on these goods is ₹36 instead of ₹23 (the invoice shows ₹211 against ₹198 expected).
  - **qa9/zz-qa9-flow.test.ts N:**
    1. Stock item "Packaged water", opening 10.
    2. Sell 2 through the room tender, then check out.
    3. Result: stock **10**, sold 0.
- **Fix:** Post one folio line per POS item (or per rate × HSN), keeping `hsn`, `tax_rate`, `item_id` and `qty`. Have
  `buildCheckoutInvoice` carry them to the invoice items so GST, HSN and stock see them. For restaurant orders, carry
  the order's items (or record a stock issue for recipe / goods lines at settle).

### H13 — P1 — Restaurant charge to room cannot be undone from the screens; void loses the order

- **Cause:**
  - `undoRoomCharge` exists (`charge-to-room.ts:58`), but no component calls it.
  - On the folio the only removal is void. `findLine` ignores void lines (`:35`), so after a void, `undoRoomCharge`
    says "This order is not on a folio".
  - The order stays `settled` with `folio_id`, so it can neither be re-charged nor settled.
- **Repro (qa9/zz-qa9-ctr.test.ts T):**
  1. Charge an order to room 101.
  2. Void the line ("guest pays cash at the restaurant").
  3. Result: `undoRoomCharge` → "This order is not on a folio." `settleOrder` → "This order is already closed."
- **Fix:**
  - Add "Undo room charge" on the order (Tables) and on the folio line (kind `fnb` with `src.table_order_id`).
  - When an order-linked line is voided, reopen the order through the same path, or refuse the void and point to undo.

### H14 — P2 — The edit log shows the guest's phone and email on reservation edits

- **Cause:** `HIDDEN` (`audit-edits.ts:160`) tests only top-level keys. A reservation's `guest` object (name, phone,
  email, guest_id) is logged as JSON (`show()` → `JSON.stringify`). Check-in sets `guest.guest_id`, so every check-in
  logs it.
- **Repro (qa9/zz-qa9-flow.test.ts O):** `genericChanges` on a reservation whose `guest.guest_id` changes gives
  `Guest: {"name":"Asha Rao","phone":"9876543210","email":"asha@examp…` → `… (edited)`.
- **Fix:** Hide nested personal fields (strip `phone|email|address` keys before `show()`), or add `^guest$` to
  `HIDDEN` and log `guest.name` only.

### H15 — P2 — Night audit "payments by mode" leaves out advance receipts

- **Cause:** `runNight` totals only `localDb.payments` dated that night (`night-audit.ts:136`). Advance receipts live
  in the advances table (`takeAdvance` → `saveAdvance`), and refunds (RFV) are not netted either.
- **Repro (qa9/zz-qa9-adv.test.ts Q):**
  1. ₹5,000 cash advance on 20 Oct.
  2. Check in and audit the 20th.
  3. Result: `payments_by_mode: {}` (`advances_held: 5000`).
- **Fix:** Add the advances' receipts (by method) and subtract refunds dated on the night, through the same cash
  predicate the cash book uses.

### H16 — P2 — A long stay cannot be extended once its arrival month is locked

- **Cause:** `saveReservation` asserts the lock on the **arrival** for any edit (`reservations.ts:90`). An extension
  changes only future nights.
- **Repro (qa9/zz-qa9-adv.test.ts R):**
  1. Check in on 25 Sep for a stay to 20 Oct.
  2. Lock September.
  3. Extend to 25 Oct. Result: "Books are locked up to 30 Sep 2026 … cannot be edited."
- **Fix:** For an in-house booking, allow edits that change only nights after the lock date (departure, room move,
  occupancy from a later night). Check the lock per changed night.
