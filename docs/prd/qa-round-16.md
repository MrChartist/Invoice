# QA round 16: adversarial pass over MF-D (food / FMCG and the statutory desk) and QA15's open items

Status: findings fixed in the same loop, each with a regression test in `tests/qa16-mfg.test.ts` (all ten fail on the
baseline source — P5 and P7 because the helper they test did not exist, the old code path being the one shown under the
finding). Baseline: branch `claude/elegant-cannon-cwapiv` at `fbb9d60` (MF-A … MF-D merged). The whole suite passed on
the baseline (3,414 / 3,414).

Method: the MF-D flows walked at the data layer with the repo's harness (`tests/helpers/world.ts`), plus a static review
of `src/lib/mfg/mf-{costcards,food,shelf,shelf-floor,msme-recv,msme-form1,incentives,authorisations,conversion,
inventories,inventories-live}.ts`, `msme.ts` (`traderExcluded`), `trade/export-incentives.ts` (`appendix`),
`production/orders.ts` (`buildOutputVoucher` `conversion`), `ledger/notes-auto.ts` (`inventoryRows`), the year-end step
`wip_statement`, `LineTracking.tsx`, `OutputDialog.tsx`, `AaBoeSwitch.tsx`, and the MF-D desks:
- cost card from the BOM → yield, batch cost, pack cost and margins; what-if at the latest purchase rate (free goods,
  alternate units);
- food output: batch / packed date / best-before into the R4-A output dialog; FEFO with a client's minimum shelf life
  (auto-pick, "split across batches"); near-expiry buckets; scheme presets → R8 schemes; Circular 251 note;
- MSE receivables (payments, buyer TDS, credit notes, write-offs) against the payables maths; Form-1 half-years, due
  dates and rows; 43B(h) with trader-flagged suppliers;
- incentive claim → recognition → receipt, and the same journals from Books / the recycle bin;
- AA / EPCG: default dates, EO by quantity and value, imports, BOE duty-foregone memo, RoDTEP 4R / 4RE;
- D5 conversion off (byte-identical journal, existing test re-read) and on (dated switch, normal-capacity cap, once only);
- D6 split vs the valuer; the note's balancing row; the year-end WIP statement taken after the year end.

Severity: **P0** money or data wrong, data lost, security; **P1** a flow broken, an invariant broken, or a tax figure
wrong; **P2** friction, a working-paper figure off, cosmetic.

---

## 1. Summary

| # | Sev | Area | Finding | Fix | Test |
|---|---|---|---|---|---|
| P1 | P1 | MSE receivables (D3) | Credit notes were ignored: a sale fully credited (goods returned, rate difference) still showed the whole bill unpaid, with **Sec 16 interest** on it, in the reminder and in the **interest-claim letter** sent to the buyer | `mseReceivables(…, links)`: linked credit notes (issued, not cancelled, up to the as-of day) settle the bill from their date like a receipt; `MsmeView` passes `doc_links` | `P1` |
| P2 | P1 | FEFO floor (D2) | "Split across batches" (shown when the picked batch is short) used plain FEFO — the shortest-life batches **first**, exactly the ones below the client's 70% / n-day minimum the auto-pick had just skipped | `fefoAllocate` / `splitLineByFefo` take an optional `keep` predicate (absent = as before); `LineTracking` passes `meetsFloor` when the client has a floor | `P2` |
| P3 | P1 | Year-end WIP (D5 / D6) | The WIP statement and the year-end step amount were taken from **today's** documents and statuses: run in May for 31 March, an order closed in April vanished and April's issues were counted as year-end WIP | `liveWipStatement(date)` reads issues / returns / outputs / write-offs dated up to `date` and treats an order closed after `date` as open; `memoConversion` likewise | `P3` |
| P4 | P1 | Incentives (D4) | A grant's recognition or receipt journal could be **deleted in Books** while the claim still said "recognised" / "received" — books and register disagreed, and the claim could never be recognised again ("Already recognised") | `OWNED_JOURNALS` row `Government grant` → `incentive_claims.voucher_ids`: refused with "reverse it with a journal" while the claim counts it (a hand-entered journal of that class with no claim deletes as before) | `P4` |
| P5 | P1 | Press job ticket (QA15 open) | The job ticket's BOM line issued the paper as **sheets** unless the item's unit was exactly `KG`: `KGS` / `Kgs` / `MT` items got the sheet count as kilograms, `REAM` items 500× too much; "actual sheets issued" showed kg | `paperIssueQty` (kg / g / tonne by the break's kg per sheet, reams of 500, else sheets); `actualPaper` converts the issued quantity back to sheets | `P5` |
| P6 | P1 | Capacity (QA15 open: holidays across weeks) | A work centre with a **shutdown of a full working week** (Diwali, annual maintenance) made the Load view and the promise date throw "has no working hours" for every order due near it | `assertHours` judges the weekly pattern without holidays; the loading loops already skip holidays (horizon 400 days) | `P6` |
| P7 | P2 | Food output (D1 / D2) | The output dialog fixed the batch's MFG date and best-before to the day it **opened**: a back-dated output got MFG = today and expiry = today + shelf life | `outputFoodDates(order, item, date, typed)`: MFG = packed date, else the output date; expiry follows the date until typed | `P7` |
| P8 | P2 | AA register (D4) | Every line of an invoice tagged to an AA counted towards its export obligation — another product, crates, freight — overstating the EO quantity / value and understating duty at risk | `eoStatus`: an AA counts only its `items_export` items (EPCG, value of any goods, unchanged) | `P8` |
| P9 | P2 | RoDTEP 4R / 4RE (D4) | `appendix` was stored but nothing ever set or showed it, so a RoDTEP row on an export under an AA was silently Appendix 4R | New RoDTEP row on an invoice carrying `mf.export_aa` defaults to `4RE` (a chosen value wins; edits keep the stored one); the register shows the appendix | `P9` |
| P10 | P2 | Garments bundles (QA15 open) | A piece rejected in-house after its bundle came back stitched was recorded on the bundle but **left stock** untouched (the pieces were already in stock from the Material In) | `recordStep` refuses rejects on a bundle already in stock (`reported`), pointing to Manufacturing → Rejections; finishing steps still record | `P10` |

### What was verified and is correct

- **D5 off = byte-identical.** With no switch row the output dialog passes no `conversion` and `buildOutputVoucher` returns
  `costs: []` exactly as MF-A did; `tests/mf-conversion.test.ts` compares `JSON.stringify`. On: one `mf_conv` line, earlier
  `mf_conv` lines subtracted, cards and vouchers read up to the output date, overhead capped at `normal_hours` for the FY.
- **D6 split.** `inventorySplit` values every item with the valuer's own maths (last running value ≤ day, negative = nil,
  paise) and sums to `inventoryValuer`; the note's "Other inventories" row absorbs typed closing stock / ledger balances;
  a branch scope or a manual valuer prints the one-line note as before.
- **Cost cards.** Rates from dated standard cost / opening rate; what-if per base unit (`unitCost ÷ unitFactor`, free
  goods spread over paid + free by `readPurchaseLines`); versions by `effective_from`.
- **Shelf floor.** `remainingLife` / `meetsFloor` (a batch with no MFG date never meets a % floor, one with no expiry always
  does); the auto-pick and the shortfall text work in base units (`lineFactor`).
- **Form-1.** Half-years Apr–Sep (due 31 Oct) / Oct–Mar (due 30 Apr), rows unpaid at the half-year end > 45 days after the
  bill, reasons kept per bill; the compliance calendar's next two due dates.
- **43B(h) traders.** `traderExcluded` only takes flagged suppliers out of the 43B(h) totals and lists them
  (`excludedTraders` absent when none — earlier results unchanged); Sec 16 interest on the payables side still includes
  them (MF94).
- **Incentive journals.** Paise-exact, balanced, period lock through `saveVoucher`, receipt refused before recognition
  and above the recognised amount.
- **Registry / backup / sync / open export.** `cost_cards`, `export_authorisations`, `incentive_claims` in `MF_TABLES` /
  `MF_DATED`, backup, sync `DATED`, open-export schema, `DEMO_EXTRA_TABLES`; every writer imports `./mf-registry`.
- **Hindi / help / Ctrl+K (B / C / D desks).** Every key of the seven R13 B / C / D string areas has a Hindi string (none
  equal to the English, none left in English words); the Ctrl+K titles of the Garments, Food and Statutory desks now name
  the inverted-duty refund, FSSAI / near expiry and Form-1 / AA / EPCG views (en + hi).
- **375 px.** New smoke check: the eight MF-D desk views (Food ×3, Statutory ×4, Floor → WIP) show no horizontal page scroll
  at 375 px (wide tables scroll inside their box).

### Not changed (noted, for the lead)

- **CMT-stitched pieces in the order's output count (MF82).** Unchanged pending the CA's answer: counting them on the order
  would need a second, cost-free output record next to the Material In, which is exactly what QA15 M1 removed.
- **Job-worker scrap in kg.** `scrap_at_jw` stays in the challan's unit (fabric metres): ITC-04 reports the losses in the
  unit of the goods sent, and a kg figure needs a per-lot metres-per-kg factor the cut plan does not hold. Typed as metres.
- **E-way sub-type 6 JSON.** The builder keeps `supplyType 'O'` + sub-type 6 for a job worker returning the principal's
  goods; references disagree on whether the NIC portal accepts "job work returns" with an outward supply type (some list
  it under inward only). The JSON now carries a note with the fallback (the principal generates it as Inward) — MF92.
  Not changed without the schema.
- **Dated MRP lead days** are calendar days (not working days of the centre) — as documented in MF-A; a shutdown is seen
  by the load view and the promise date, not by MRP release dates.
- **Incentive write-down.** A claim received for less than recognised keeps the difference as a receivable; there is no
  "write off the shortfall" action (reverse by journal) — MF96.
- **Export credit notes** do not reduce an AA's export obligation (credit notes carry no `mf.export_aa`) — MF91.

---

## 2. Findings

### P1 — P1 — MSE receivable interest on credited bills

- **Repro:** profile MICRO with Udyam → sale ₹1,00,000 to a GSTIN buyer on 1 Jan → credit note ₹1,00,000 on 10 Jan (goods
  returned) → Statutory → MSME on 12 May: the bill shows ₹1,00,000 unpaid and Sec 16 interest; the letter claims it.
- **Fix:** `mf-msme-recv.ts` `mseReceivables(invoices, payments, asOf, links = [])`; `MsmeView.tsx`. CA item MF90.

### P2 — P1 — FEFO split ignores the client's minimum shelf life

- **Repro:** client `min_shelf_pct` 70 → line of 7 → the auto-pick takes the long-life batch; type 12 → "split across
  batches" → the 28%-life batch comes first.
- **Fix:** `stock-tracking.ts` `fefoAllocate` / `splitLineByFefo` optional `keep`; `LineTracking.tsx` passes
  `meetsFloor`. Without a floor the split is unchanged (existing `stock-tracking` test).

### P3 — P1 — Year-end WIP statement as of today

- **Repro:** order released 10 Mar, 50 kg issued 20 Mar, 30 kg 15 Apr, closed 25 Apr → year-end wizard FY 2025-26 in May:
  no WIP (order closed); before closing, 80 kg shown at 31 Mar.
- **Fix:** `mf-inventories-live.ts` `liveWipStatement` (documents ≤ date, closed after date = open);
  `mf-conversion.ts` `memoConversion` (`closed_at`). CA item MF95.

### P4 — P1 — Grant journal deleted from Books

- **Fix:** `ledger/vouchers.ts` `OWNED_JOURNALS['Government grant']`. CA item MF96.

### P5 — P1 — Paper unit on the job ticket

- **Repro:** paper item in `KGS` → Make job ticket for 10,000 → BOM line 2,700 (sheets) instead of 313.548 kg; `REAM` →
  2,700 reams.
- **Old path:** `String(unit).toUpperCase() === 'KG' ? kg : sheets`.
- **Fix:** `mf-estimates.ts` `paperIssueQty`, `sheetsPer`, `actualPaper` (sheets).

### P6 — P1 — Shutdown week stops the load view

- **Repro:** centre Mon–Sat with holidays 9–14 Nov → an order due 14 Nov → Floor → Load: "Work centre … has no working
  hours".
- **Fix:** `mf-capacity.ts` `assertHours` (weekly pattern without holidays).

### P7 — P2 — Food batch dates fixed to the dialog's day

- **Old path:** `foodOutputDefaults(order, item, todayInput())` once, and `mfg_date: food.mfg_date` on save.
- **Fix:** `mf-food.ts` `outputFoodDates`; `OutputDialog.tsx` (expiry follows the output date until typed).

### P8 — P2 — AA obligation counts other lines

- **Fix:** `mf-authorisations.ts` `eoStatus` (AA: `items_export` items only). CA item MF91.

### P9 — P2 — RoDTEP appendix never set

- **Fix:** `trade/export-incentives.ts` `incentivesDb.save` (`underAa`); `IncentivesTab.tsx` shows it. CA item MF93.

### P10 — P2 — In-house reject of a stitched bundle

- **Fix:** `mf-bundles.ts` `recordStep`. CA item MF94 (reject route) — with MF82.

### E2E — "Execution context was destroyed" in QA-3 F4 / F5

- **Cause:** the demo flow reloads **twice** by design (switch to the Demo company; then `reloadAfterFlush` once the sample
  data is in IndexedDB). The step waited for `#company-switch` (present after the FIRST load) and for the rows (visible
  just before the second reload), then ran `page.evaluate` / `count()` while the second reload tore the page down. Not an
  app bug: both reloads are needed (QA-3 F4 — a bare reload lost the data).
- **Fix (test):** the step counts `load` events per page and settles only after the second one (`settled`), and in-page reads
  retry once across a navigation (`stable`).

---

## 3. Checks and budget

`tsc -b` clean; `eslint .` 0 errors (27 warnings, as before); `node --test` 3,424 / 3,424 (ten new P regressions, each
re-run against the baseline source and failing there); `vite build` + `postbuild` ok; bundle check ok; `node --check
tests/e2e/smoke.mjs` ok; Playwright smoke (`E2E_TIMEOUT=60000`): see the report. `npm run …` exits 216 in this sandbox, so each
command was run directly.

Budget (vite build, gzip -9): first paint 189,212 B (baseline `fbb9d60` 189,216 B: **−4 B**, lazy-map churn); total JS
3,375,024 B (+1,229 B: editor / production / press / capacity / statutory chunks, the e2e-only smoke check, Ctrl+K titles).
No new icon names.

## 4. CA questions

MF90 (credit notes and Sec 16 interest), MF91 (AA export obligation items, export credit notes), MF92 (e-way sub-type 6
supply type), MF93 (RoDTEP 4RE on AA exports), MF94 (traders and Sec 16; rejects after CMT), MF95 (year-end WIP as on
31 March), MF96 (grant journals and short receipts) — `docs/CA_REVIEW.md` §13; total 417 → 424.
