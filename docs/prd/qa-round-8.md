# QA round 8: hands-on audit of Round 8 (trading: TR-A distributor, TR-B commodity / mandi, TR-C agents and tax rules)

Status: findings for the fix loop. Baseline: branch `claude/elegant-cannon-cwapiv` at `1d06bd2` (TR-A, TR-B and TR-C
merged). `npm test` passed in full (2,682 tests). Every finding below was reproduced on that commit.

Method:
- **Data layer.** Node probes through the repo's test harness (`tests/helpers/shim.ts`, `tests/helpers/world.ts`).
  They call the same lib APIs the screens call: `saveArrival` / `savePatti` / `postPatti`, `postBrokerage` /
  `deleteBrokeragePosting`, `saveClaim` / `settleClaim` / `unsettleClaim` / `deleteClaim`, `issuePriceDrop` /
  `undoPriceDrop` / `claimPriceDrop`, `partyInterest` / `raiseInterest`, `createLateFeeInvoice`, `recordPackMove` /
  `removePackMove` / `chargeUnreturned`, `restoreEntries`, `buildGstReport`, `preflightEInvoice`, `preflightEway`,
  `buildTallyModel`, `createCreditNote`, `calculateInvoice`, and role checks through `setActorProvider`.
- **Static review** of the Round 8 modules (`src/lib/trade/tr-*.ts`, `trading-rules.ts`, the recycle-bin hooks, the
  GST / e-Invoice / e-Way / Tally readers that see the new lines).
- No browser run was needed: every finding reproduces at the data layer.

Probe files: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa8/probes/`
(`zz-qa8-ledger.test.ts`, `zz-qa8-gst.test.ts`, `zz-qa8-access.test.ts`, `zz-qa8-disc.test.ts`, `zz-qa8-rcm.test.ts`). They were run from
`tests/` and moved out afterwards (nothing committed). To run one, copy it into `tests/` and run
`node --experimental-strip-types --import ./tests/hooks/register.mjs --test tests/<file>.test.ts`. Each scenario prints
one `#` line per check. Below, `qa8/` means the probes folder above, and a letter (A, B …) is the probe's test name.

This doc reports bugs only. It proposes no new features.

Severity:
- **P0:** money or data is wrong, data is lost, or there is a security issue.
- **P1:** a flow is broken, a stated Round 8 invariant is broken, or a tax document comes out wrong.
- **P2:** friction or a cosmetic or printing error.

---

## 1. Summary

| # | Sev | Area | Finding |
|---|---|---|---|
| T1 | P0 | Agency / patti | The patti gross is qty × rate × (1 − line %). It ignores the invoice-level discount and tax-inclusive prices, so the principal is credited more than the sale earned and Sales goes negative |
| T2 | P0 | Recycle bin | The "Brokerage", "Trade claim" and "Packaging deposit" journals are not in `OWNED_VOUCHERS`. After an undo, restoring the journal from the bin posts it a second time. Restoring a brokerage posting row also creates two overlapping postings |
| T3 | P1 | Agency / patti | Each patti on a lot deducts the lot's **whole** arrival advance again. Two pattis on one lot understate the net payable by the advance |
| T4 | P1 | Interest | A bill that already has a late-fee invoice is offered again in the interest run (and the reverse). The same overdue period is charged twice |
| T5 | P1 | Interest | No undo for an interest run. If its draft is deleted or cancelled, its bills stay "charged to" that date, so that interest can never be raised again |
| T6 | P1 | Interest / GST | The interest draft for an export (LUT) or SEZ bill is a B2B invoice with 18% IGST. The principal supply was zero-rated |
| T7 | P1 | Price drop / claims | Back-references are not released: (a) deleting a price-drop claim leaves `claim_id`, so the run can never be claimed again; (b) undoing a claimed run keeps its claim, which can still be settled; (c) cancelling one price-drop note by hand keeps the run "issued", so those bills can never get a new note |
| T8 | P1 | Packaging | When the draft invoice that charges unreturned crates is deleted, its closing "in" movement stays. The crates read as returned, and the movement cannot be removed |
| T9 | P1 | GST / pure agent | A pure-agent ("outside", Rule 33) charge line is reported as a **nil-rated supply** in GSTR-1 Table 8 and GSTR-3B 3.1(c). It also gives an "NA" HSN row and an HSN_MISSING warning, and **blocks** e-Invoice (ITEM_HSN error) and e-Way (EWB_HSN) JSON |
| T10 | P1 | Year-end | No year-end checklist row lists unsettled agency lots (PRD §C1 / §8 row 7, TR22). The only signal is a count inside the Agency tab, which is hidden when the agency pack is off |
| T11 | P2 | Discounts | With the 6-decimal effective %, a per-unit or a 3-step chain discount does not give the exact net on large lines (−₹0.17 on 1,00,000 × ₹333 less ₹5/unit; +₹0.05 on 12.5+7.5+2.5) |
| T12 | P2 | Weight / print | A partial credit note (and a GST price-drop note) on a weighed line keeps the original `wt`. It prints "120 BAG … = 5,940 kg" on a 10 QTL return |
| T13 | P2 | Tally | With inventory on, every charge line ("Market fee", "Dharmada") and every agency line becomes a Tally stock item of ours |
| T14 | P2 | RCM prompt | The notified-goods prompt fires for any 0801 HSN from a farmer (coconuts, Brazil nuts). It also fires for silk yarn from every supplier, because every vendor counts as a "maker" |
| T15 | P2 | Agency | Overselling a lot, or selling a cancelled lot, is only flagged in the LotPicker. Nothing refuses it on save, and sales of a cancelled lot can never be settled on a patti |
| T16 | P2 | Profile switch | When a trade profile turns a pack off, the discount sub-row, weight row and charges strip stop mounting. Editing a saved document then leaves `disc_chain`, `wt` and charge lines stale, but they still print and still feed brokerage bases |

### What was verified and is correct

- **Registrations.**
  - Every Round 8 table is listed in `backup.ts` (`RECORD_TABLES` / `ID_TABLES`), `sync-engine.ts` (`DATED`; `NUMBERED`
    for TCL / PDR / ARR / PAT / IND) and `open-export-schema.ts`.
  - `tr-registry` is imported by every writer, by the sync engine and by the recycle bin.
- **Roles.** A viewer is refused by every R8 writer and by a raw `setTable` on R8 tables (arrivals, party rates,
  pack moves, charge heads, interest settings). A clerk is refused interest settings. The 194Q card swallows a
  non-owner's edit.
- **Numbering.** The R8 series run by Indian FY: `TCL/FY26-27/0001`, then `0002` after deleting `0001`, then
  `TCL/FY27-28/0001` on 1 Apr 2027. A deleted claim's number is not reused.
- **Agency stock and ledger.**
  - Agency lines are skipped by the stock engine and the stock checks.
  - The patti journal balances. After a posted patti, the principal's ledger equals gross less the advance.
  - Cancelling a patti or an arrival removes its journal. Restoring that journal from the bin is refused
    (`Bikri patti` / `Arrival advance` are in `OWNED_VOUCHERS`).
- **Weight billing and charges.**
  - The net weight becomes the quantity, and stock = quantity × `unit_factor`.
  - In-value charge lines merge into the goods' HSN row with quantity 0.
  - Charge lines are not brokered.
- **194H on brokerage.**
  - Threshold, catch-up, the 1 Oct 2024 5% → 2% change and 206AA behave as documented.
  - Undo removes the journal and the TDS row.
- **Statutory rule values.** 206C(1F), 206CC, 194Q ₹10 crore, raw cotton RCM from 15 Nov 2017, composition limits and
  the special-category state codes match the cited sources.
- **Financial price-drop notes.** They carry no tax and are skipped by GST / e-Invoice / e-Way readers through
  `isNonGstFinancialNote`.

---

## 2. Findings

### T1 — P0 — Patti gross ignores invoice-level discount and tax-inclusive prices

- **Cause:** `agencySales` (`src/lib/trade/tr-arrivals.ts:71`) values an agency line as
  `qty × rate × (1 − discount_percent)`.
  - It never runs `calculateInvoice`, so it misses the document-level discount (`discount_type` / `discount_rate`).
  - With `price_includes_tax`, the rate includes GST, and that GST is counted as gross.
  - `buildPatti` (`tr-patti.ts:79–91`) and `pattiJournal` post that gross: Dr "Agency sales transferred" / Cr principal.
- **Repro (`qa8/zz-qa8-ledger.test.ts` A2):**
  1. Take a registered principal and a jaggery lot (5% GST).
  2. Sale 1: 5 QTL × ₹4,000 with a 10% invoice discount. Taxable ₹18,000.
  3. Sale 2: 5 QTL × ₹4,200, tax-inclusive. Taxable ₹20,000.
  4. Result: patti gross is **₹41,000**, but the sales' taxable value is **₹38,000**.
  5. The principal is credited ₹3,000 too much. The contra Sales ledger is debited ₹3,000 more than the sales, so
     Sales shows a ₹3,000 loss.
- **Fix:** Value agency lines from `calculateInvoice(calcInputFromRecord(inv)).lines`, matched by line id
  (`taxable`, which is after the document discount and net of inclusive tax). Convert to INR with `inrTotals` for
  foreign-currency invoices.

### T2 — P0 — Restoring an undone Brokerage / Trade claim / Packaging deposit journal double-posts

- **Cause:** `OWNED_VOUCHERS` (`src/lib/trust/recycle-bin.ts:200–220`) lists only the TR-C classes ("Arrival
  advance", "Bikri patti").
  - TR-A's "Trade claim" (`tr-claims.ts:144`) and "Packaging deposit" (`tr-packaging.ts:97–98`) are missing.
  - So is TR-B's "Brokerage" (`tr-brokers-post.ts:61`).
  - After `deleteBrokeragePosting` / `unsettleClaim` / `removePackMove`, the bin restores the journal on its own.
  - Nothing guards the `brokerage_postings` row either: it comes back next to a re-post, so two postings cover the
    same period.
- **Repro (`qa8/zz-qa8-ledger.test.ts` B, C, D):**
  - **B:**
    1. Post brokerage for October, then undo it.
    2. Restore the journal. The restore is not refused.
    3. Post October again. Result: **2 Brokerage journals**.
    4. Restore the posting row. Result: **2 postings** for the same broker and period, and only one 194H TDS row.
  - **C:** Settle a claim (financial), unsettle it, restore the "Trade claim" journal, then settle again. Result:
    **2 journals** (Dr principal / Cr Scheme claims received, twice).
    - GST mode: the supplier credit note removed by `unsettleClaim` restores freely. The ITC reversal comes back
      while the claim says "sent".
  - **D:** Remove a deposit movement, then restore its receipt. Result: the voucher comes back with no movement
    (a deposit with no crates).
- **Fix:**
  - Add `{ classes: ['Brokerage'], tables: ['brokerage_postings'] }`, `{ classes: ['Trade claim'], tables:
    ['trade_claims'] }` and `{ classes: ['Packaging deposit'], tables: ['packaging_moves'] }` to `OWNED_VOUCHERS`.
  - Register restore hooks for `brokerage_postings` and `packaging_moves`: refuse unless the named voucher is live or
    comes back as a companion. For `brokerage_postings`, also re-check the overlap.
  - Register a `purchase_returns` hook: refuse a supplier note whose `trade_claims` row no longer names it as
    `settlement.return_id`.

### T3 — P1 — A second patti on the same lot deducts the full advance again

- **Cause:** `buildPatti` (`tr-patti.ts:97`) sums `advance` over the chosen lots on every patti. It does not subtract
  what earlier live pattis on those lots already recovered.
  - The journal is right: the advance sits once on the principal's ledger.
  - The printed and shared `net_payable` is wrong.
- **Repro (A):**
  1. Lot of 40 QTL with a ₹20,000 advance.
  2. Sell 20 QTL at ₹5,000 and post patti 1. Net ₹80,000.
  3. Sell 20 QTL more and post patti 2. Net **₹80,000**; it should be ₹1,00,000.
  4. Result: the two nets sum to ₹1,60,000, but the principal is owed ₹1,80,000.
- **Fix:** For each lot, `advance` = arrival advance − Σ `advance` already taken on other live pattis of that lot.
  Store the per-lot split on the patti.

### T4 — P1 — Interest run and late-fee invoice both charge the same overdue period

- **Cause:**
  - `partyInterest` (`tr-interest.ts:103`) skips the late-fee **documents** (`inv.late_fee_for`). It does not skip a
    bill that already **has** a late-fee invoice (`lateFeeRaisedFor`).
  - `createLateFeeInvoice` (`late-fee.ts:284`) checks only `late_fee_for` and ignores `interest_runs`.
- **Repro (F):**
  1. A party with an 18% p.a. late-fee term; ₹1,00,000 due 31 Jul.
  2. `createLateFeeInvoice` on 31 Oct gives INV/0002 for ₹4,536.99.
  3. Result: `partyInterest('2026-10-31')` still lists INV/0001 from 1 Aug to 31 Oct, ₹4,536.99.
- **Fix:**
  - In `partyInterest`, treat a live late-fee invoice for bill X as a charge up to its as-of date: feed it into
    `chargedTo`.
  - In `createLateFeeInvoice`, refuse (or start after) a bill already on an `interest_runs` row.

### T5 — P1 — Interest run cannot be undone; deleted drafts still count as charged

- **Cause:**
  - `chargedTo` (`tr-interest.ts:82`) reads every `interest_runs` row, whatever state its `invoice_ids` are in.
  - There is no undo or delete for a run (no UI, no API).
  - The interest drafts are ordinary drafts: deleting or cancelling one is allowed.
- **Repro (G):**
  1. Raise interest to 31 Oct.
  2. Delete the draft.
  3. Result: `partyInterest('2026-10-31')` returns nothing. The ₹4,536.99 is lost for good.
- **Fix:**
  - Count a run's bills only while its invoice for that party is live (not deleted / Cancelled).
  - Or add `undoInterestRun`, which cancels the drafts and marks the run undone, and hook draft deletion to it.

### T6 — P1 — Interest draft for an export / SEZ bill charges IGST

- **Cause:** `buildInterestInvoice` (`tr-interest.ts:138–142`) builds a fresh draft.
  - It takes each line's `principalTaxRate` and derives `gst_mode` from the place of supply.
  - It never carries the bill's `supply_type` (EXPORT_LUT / EXPORT_WITH_PAYMENT / SEZ_*).
  - Interest forms part of the value of the principal supply (the module's own G6 / TR18 note), so it is zero-rated
    too.
- **Repro (I):**
  1. Take a foreign client and a ₹1,00,000 EXPORT_LUT bill at a nominal 18%.
  2. Raise interest.
  3. Result: the draft is INVOICE, supply B2B, IGST, POS 99, taxable ₹4,536.99, **IGST ₹816.66**.
- **Fix:**
  - Group a party's bills by `supply_type`.
  - Copy `supply_type` (and LUT data) from the bill to the interest draft (one draft per supply type).
  - Or give a zero-rated bill's line a 0% effective rate under the same supply type. The same applies to
    `buildChargeInvoice` for SEZ customers.

### T7 — P1 — Price-drop runs and claims keep stale back-references

- **Cause:**
  - `deleteClaim` (`tr-claims.ts:172`) never clears `price_drops.claim_id`, so `claimPriceDrop` (`tr-price-drop.ts:181`)
    refuses for good.
  - `undoPriceDrop` (`tr-price-drop.ts:155`) does not check or reject the run's claim.
  - `coveredPairs` (`:48`) treats every row of an "issued" run as covered, even when that customer's note was
    cancelled from the invoice list.
- **Repro (E, E2):**
  1. Claim a run, then delete the draft claim. Re-claiming is refused: "Run PDR/FY26-27/0001 is already claimed."
  2. Claim a run, then undo the run. The claim stays a draft for ₹200, and `settleClaim` books it as income against
     the principal.
  3. Cancel a run's only note by hand, then issue the same drop again. It is refused: "No customer bought these items
     … already on a price-drop run". The run still reads `issued`.
- **Fix:**
  - `deleteClaim` and `markClaim(…, 'rejected')` on a `price_drop` claim clear the run's `claim_id`.
  - `undoPriceDrop` refuses while a live claim exists, or rejects that claim.
  - `coveredPairs` counts only rows whose note is still live.

### T8 — P1 — Deleting the crate-charge draft leaves the crates marked returned

- **Cause:** `chargeUnreturned` (`tr-packaging.ts:138–151`) records the closing `in` movement at once, against a
  **draft** invoice.
  - Nothing reacts when that draft is deleted or cancelled.
  - `removePackMove` refuses any movement with `charge_invoice_id` (`:114`).
- **Repro (H):**
  1. A balance of 5 crates; charge the 5.
  2. Delete the draft invoice.
  3. Result: the balance stays **0**, and removing the movement is refused: "cancel that invoice instead" (the
     invoice is already gone).
- **Fix:** Let `removePackMove` drop a movement whose `charge_invoice_id` is no longer live (missing or Cancelled). Or
  record the movement only when the invoice is issued, and show the orphan in the Packaging tab.

### T9 — P1 — Pure-agent charge line reported as a nil-rated supply; blocks e-Invoice / e-Way

- **Cause:** `chargeLine` (`tr-charges.ts:84–93`) gives an `outside` head `hsn: ''` and `tax_rate: 0`.
  - `gst-reports.ts:856 / :1208` route every 0% line to Table 8 (nil-rated) and 3B 3.1(c). Rule 33 amounts are not a
    supply at all.
  - Counting them as nil-rated turnover also inflates exempt turnover used for Rule 42 reversal.
  - e-Invoice validation needs an HSN on every item.
  - e-Way puts the line in `itemList` with `hsnCode: 0`.
  - No reader knows `charge_head_id`, except the HSN-quantity tweak.
- **Repro (`qa8/zz-qa8-gst.test.ts`):**
  1. B2B tax invoice: rice 100 kg × ₹50 at 5%, plus "Dharmada" ₹200 as an `outside` charge.
  2. Result:
     - GSTR-1 `nil` is `[{INTRAB2B, nil: 200}]`, and 3B `nilExempt.intra` is 200.
     - The HSN table has `["NA", 0, 200]`, plus an `HSN_MISSING` issue.
     - `preflightEInvoice` gives the error `ITEM_HSN: Item 2 "Dharmada": HSN/SAC code is missing`.
     - `preflightEway` gives `EWB_HSN`.
- **Fix:**
  - Treat `charge_head_id` lines of an `outside` head as non-supply in the GST readers. Leave them out of nil and HSN,
    and keep them in the document total. The reader can check the line's description or stamp `pure_agent: true` on
    the line.
  - Leave them out of e-Invoice `ItemList` (add the amount to `OthChrg`) and out of the e-Way `itemList` (into
    `otherValue`).

### T10 — P1 — Unsettled agency lots are not on the year-end checklist

- **Cause:** `unsettledLots` is used only in `AgencyTab.tsx:63`. `src/lib/year-end.ts` has no step for it (steps
  `integrity … auditor_pack`, `:114–201`).
  - PRD §C1 and §8 row 7 (TR22) require "unsettled lots listed **and on the year-end checklist**".
  - With the agency pack off (trade profile switched), even the tab count is hidden. The agency sales still sit in
    Sales and P&L.
- **Repro:**
  1. Agency sale on a lot, with no patti.
  2. Open Books → Year-end. No row mentions the lot.
  3. Switch the trade profile to Distributor. Nothing anywhere mentions it.
- **Fix:** Add a year-end step that runs whenever any arrival exists, whatever the pack. List `unsettledLots(...)`,
  with a link to Distribution → Agency.

### T11 — P2 — Effective discount % is rounded to 6 decimals, so large lines miss the exact net

- **Cause:** `r6` in `effectivePercent` (`tr-discounts.ts:14, :31`). A per-unit amount ÷ rate is rarely a 6-decimal
  number. The 3-step chain 12.5 + 7.5 + 2.5 = 21.0859375% has 7 decimals.
- **Repro (`qa8/zz-qa8-disc.test.ts`):**

  | Line | Taxable | Exact | Difference |
  |---|---|---|---|
  | 1,00,000 × ₹333 less ₹5/unit | 3,27,99,999.83 | 3,28,00,000 | −0.17 |
  | 12.5 + 7.5 + 2.5 on 10,000 × ₹1,000 | 78,91,406.30 | 78,91,406.25 | +0.05 |

- **Fix:** Keep more precision (10 decimals). Or, when `disc_per_unit` is set, check the computed net against
  `qty × (rate × chain − per unit)` and nudge the % to the nearest value that reproduces it.

### T12 — P2 — Weighing printed on a partial credit note / rate-difference note

- **Cause:**
  - `buildCreditNote` copies `...line.item` (`documents.ts:548`), and `gstDropNote` copies `...l`, with a new
    quantity but the original `wt`.
  - `trackingText` prints `weightText(item.wt)` whenever `wt` exists (`paper-helpers.ts:28`), without `wtHolds`.
- **Repro (W):**
  1. Weighed sale: 120 bags, 59.4 QTL.
  2. Credit note for 10 QTL.
  3. Result: `wtHolds` = false, and it still prints "120 BAG · gross 6,072 kg − tare 72 kg − dhalta 60 kg = 5,940 kg".
- **Fix:** Drop `wt` when a credit or price-drop note changes the quantity. Or print it only when `wtHolds(line)`.

### T13 — P2 — Tally XML turns charge lines and agency lines into our stock items

- **Cause:** `lineItems` (`tally-xml.ts:348`) maps every named line to a stock-item inventory entry when
  `includeInventory` is on.
- **Repro (`qa8/zz-qa8-gst.test.ts`):** The stock items are `["Dharmada","OTH",""]` next to `["Rice","KGS",…]`. Agency
  lines (principal's goods) would likewise drive Tally's own stock negative.
- **Fix:** Skip lines with `charge_head_id` or `arrival_id` from the inventory entries. Post them to a ledger (charges →
  the other-charges ledger, agency → the sales ledger as an accounting line).

### T14 — P2 — RCM notified-goods prompt over-matches

- **Cause:** `supplierKinds` (`tr-statutory.ts:99`) always includes `'maker'`. The HSN match is by 4-digit prefix both
  ways (`:114`).
  - Every 0801 line from an agriculturist matches the cashew entry. 0801 also covers coconuts and Brazil nuts; the
    notification covers only cashew nuts, not shelled or peeled (0801 31).
  - Every 5004–5006 line from any registered trader prompts silk-yarn RCM.
- **Repro:**
  - `rcmGoodsMatches([{ hsn: '08011100' }], ['maker', 'agriculturist'], '2026-10-01')` returns the cashew row.
  - `supplierKinds({ gstin: '27…' })` returns `['maker']`.
- **Fix:**
  - Make the cashew prefix `080131`.
  - Add `maker` only on an explicit vendor flag (or `principal_kind`).

### T15 — P2 — Lot oversell / cancelled lot is only a warning

- **Cause:** `lotShortage` is shown by `LotPicker.tsx:40` only. The save gate (`stock-tracking.ts:377`) skips agency
  lines entirely.
  - A sale can exceed the lot, or name a cancelled arrival.
  - `buildPatti` drops cancelled lots, so those sales can never be settled (see T10).
- **Fix:** Add the lot check to the sale gate (`saleLimitGate` / `stockIssues`) as an error for a cancelled lot and
  for a shortage.

### T16 — P2 — Switching a pack off leaves trade snapshots stale on edit

- **Cause:** `ItemsTable.tsx:53–55` and `SummaryPanel.tsx:63–64` mount `LineDiscountCell`, `LineWeightRow` and
  `ChargesStrip` only while the pack or setting is on. The snapshot fields still print, and still feed bases:
  `discountText`, `weightText`, and `lineBags` in brokerage.
- **Repro:**
  1. Under the Commodity profile, save a weighed sale with charges and an "18 + 4" chain.
  2. Switch to the Wholesaler profile and edit the quantity, rate or %.
  3. Result: `wt`, `disc_chain` and the charge-line amounts no longer match, but the print still shows them.
- **Fix:** Mount the reconcilers whenever a document already carries the fields (`wt`, `disc_chain`,
  `charge_head_id`), not only when the pack is on. Or drop the snapshots on save when they no longer hold.
