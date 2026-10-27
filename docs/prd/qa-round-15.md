# QA round 15: adversarial pass over Round 13 — manufacturing (MF-A, MF-B, MF-C)

Status: findings fixed in the same loop, each with a regression test in `tests/qa15-mfg.test.ts`. Baseline: branch
`claude/elegant-cannon-cwapiv` at `4c2b8e6` (MF-A, MF-B, MF-C merged), re-merged at `e9e560a` before the report. MF-D
(food / FMCG and statutory) had not landed on the branch by the report, so its desk (`FoodDesk`, `StatutoryDesk`, `WipView`)
is still MF-A's stub and is not covered here. The whole suite passed on the baseline (3,373 / 3,373).

Method: the real flows walked end to end at the data layer with the repo's harness (`tests/helpers/world.ts`,
`tests/helpers/garments.ts`), plus a static review of `src/lib/mfg/*`, `src/components/mfg/*`, `mfg-rules.ts`,
`types/mfg-r13.ts` and the core hooks they touch (`production/orders.ts`, `OutputDialog.tsx`, `job-work.ts`,
`trust/recycle-bin.ts`):
- routing → release → job cards → output journal (scrap once) → stock; dated MRP and load (read);
- drawing hold on release, weight quote → quotation, scrap register and scrap sale (TCS 206C(1) / declaration / GST TDS
  note / RCM prompt);
- moulding run with regrind (one journal per run, edit / delete / bin); print estimate → job ticket (read);
- cut plan → bundles → CMT Material Out / In → ITC-04 `scrap_at_jw` → e-way sub-type 6 (read); karigar `KPB` piece bill
  with 194C and advance recovery; textile class / band suggestions; Rule 89(5) working paper;
- recycle-bin restores of every R13 table and the documents R13 writes; UTC-day and `new Date(bareDate)` uses in R13.

Severity: **P0** money or data wrong, data lost, security; **P1** a flow broken, an invariant broken, or a tax figure
wrong; **P2** friction, a working-paper figure off, cosmetic.

---

## 1. Summary

| # | Sev | Area | Finding | Fix | Test |
|---|---|---|---|---|---|
| M1 | P0 | CMT (C3) / bundles (C2) | Pieces stitched by a fabricator entered stock **twice**: once as the style's variants on the CMT Material In, and again when the bundles (back "on the floor") were scanned through the last step and reported as output — a second manufacturing journal producing the same pieces and consuming the order's fabric again. A received bundle could also be **received again** on the same challan (the check only asked "was it sent?"), adding the pieces to stock a second time | A bundle is received only while it is at the fabricator on that challan, and only for its pieces not yet received (`at.got` keeps a part-received bundle there); a fully received bundle is marked `reported: 'cmt:<Material In>'`, so `reportFinished` never reports it, and it cannot be sent out again as fabric | `M1` (2 tests) |
| M2 | P1 | Job cards (A3) | Scrap kg on a job-card entry with no scrap item named **never reached stock**: the output dialog called `outputExtras` without Settings' default scrap item, while the scrap register counted the same kg as "on job cards" for ever | `outputExtras` defaults to `readMfgSettings().scrap_item_id` | `M2` |
| M3 | P1 | Output journal (A3 × R4-A) | An order whose BOM has a standard scrap line of an item **and** whose job cards report actual scrap of that item posted both (e.g. 1.0 kg standard + 1.2 kg actual = 2.2 kg in stock, and a lower finished-goods cost) | The cards' items come back as `replaceScrapOf`; `buildOutputVoucher` leaves out the BOM's scrap line of those items (only when the extra is passed — a plain order's journal is unchanged); `scrapDue` and the scrap register count any scrap line of the item already posted on the order, so BOM scrap posted before the cards is not posted again | `M3` (2 tests) |
| M4 | P1 | Rule 89(5) (C5) | Exports / SEZ supplies **under LUT** (no tax, nominal rate kept) counted as "inverted rated supply" at their nominal rate with nil tax — overstating the refund — and were offered as an inverted rate; a credit note on a **nil-rated** supply reduced the adjusted total turnover | Zero-rated lines are flagged (`zero`) and stay in ATT only; ATT takes positive-rate lines only | `M4` |
| M5 | P1 | Recycle bin × piece bills (C4) | A deleted karigar piece bill that had recovered an advance came back **without** its recovery journal (the bill still showed the advance as paid while the advance ledger showed it unrecovered); the recovery journal alone could be restored without its bill (advance recovered twice once the bill was re-made) | `purchases` restore hook brings the journal back with the bill; `Karigar advance recovery` is an owned voucher class (refused alone, "restore the piece bill itself") | `M5` |

`tests/mf-scrap.test.ts`: the register fixture had a BOM scrap line and job-card lines of the same item on the same order
(the M3 double); the BOM line now sits on another order so the test keeps checking "pending counted once".

### What was verified and is correct

- **Numbering and dates.** `JCD` / `FAI` / `PES` / `CUT` / `KPB` take `…/FY26-27/0001` on Indian FY; no R13 module parses a
  bare date with `new Date(str)`; `mf-centres.addDays` / `weekday` are UTC-anchored arithmetic (correct).
- **Scrap.** Job-card scrap reaches stock once through `mf_jc` lines (after M2 / M3); the register reads base units by
  `lineFactor`, sales net of credit notes, drafts out. Scrap sale: TCS preset by date, dropped on the buyer's declaration,
  GST TDS note only for metal scrap to a GSTIN buyer above ₹2.5 lakh; RCM prompt only for an unregistered supplier.
- **Moulding run.** One journal per run; regrind consumed and made in the same run nets; edit rewrites the same journal;
  delete removes both; the bin refuses a run without its journal.
- **Cut plan.** Fabric issue / end-bit return / cut waste are one document each (guarded by `docs.*_id`); output
  consumption is capped at what the order holds, so cut waste and per-piece consumption never take more fabric than issued.
- **CMT / ITC-04.** The fabricator's scrap comes off the consumed line and is settled once as a `scrap_at_jw` loss; the
  challan balance, Table 5A and the reconciliation read the same settlements.
- **Piece bills.** One `purchases` row read through `readPurchase`; 194C by `resolveBillTds` with the Sec 393 label; the
  advance recovery is a journal (no cash row, so no `movedNoCash` reader is involved); the ledger does not post
  `amount_paid` on a bill, so the recovery is not counted twice.
- **Registry / backup / sync / open export.** Every R13 table is in `RECORD_TABLES` / `ID_TABLES`, sync `DATED` /
  `NUMBERED` where dated / numbered, the open-export schema and `MF_TABLE_ACTIONS`; every writer imports `./mf-registry`
  (existing `mf-registry` test).
- **Weight quote.** Plate / bar / tube / ring volumes and the scrap credit (gross − net) × scrap rate are right.

### Not changed (noted, for the lead)

- **Rejects after a CMT receipt.** A piece rejected in-house after its bundle came back stitched is already in stock as a
  variant; the bundle step records the reject but no stock journal moves it (as for any in-house reject, R4-A's QC desk).
- **Order output for CMT pieces.** The production order's progress does not count pieces that came back from a fabricator
  (their cost sits on the Material In and the job-charge bill) — CA item MF82.
- **Scrap at the job worker in kg.** `scrap_at_jw` is in fabric metres (the challan's unit); a fabricator's scrap weighed
  in kg is typed as metres of fabric it came from.
- **Not reached in the time box:** MF-D (not landed), the print estimate → job ticket paper issue figures, dated MRP /
  capacity edge cases (holidays across weeks), Hindi / help / Ctrl+K wording of the B and C desks beyond the registry
  tests, the e-way sub-type 6 JSON against the NIC schema, and a browser walk of the desks at 375 px.

---

## 2. Findings

### M1 — P0 — Stitched pieces counted twice

- **Repro:** Garments → CMT → send bundles 1–2 to a fabricator → receive 12 + 10 good → stock of `Kurta S Blue` = 22 →
  Bundles → scan both bundles with "last step" → Report finished: stock 44, fabric consumed again from the shop floor.
  Or: receive bundle 1 again on the same challan → stock 34.
- **Fix:** `mf-cmt.ts` `cmtInDraft` (`atFabricator`, `openPieces`), `receiveCmt` (part-received bundle stays at the
  fabricator with `at.got`; fully received → `reported: 'cmt:<id>'`), `cmtOutLine` (a stitched bundle is not sent as
  fabric). Type: `MfBundle.at.got` (optional, inside the `cut_plans` row — no record or line key).

### M2 — P1 — Default scrap item ignored on output

- **Fix:** `mf-jobcards.ts` `outputExtras(order, items, scrapItem = readMfgSettings().scrap_item_id)`.

### M3 — P1 — Standard and actual scrap both posted

- **Fix:** `mf-jobcards.ts` `cardScrapItems`, `scrapDue` (any scrap line of the item on the order counts),
  `outputExtras` → `replaceScrapOf`; `production/orders.ts` `buildOutputVoucher` extra `replaceScrapOf`;
  `OutputDialog.tsx` passes it; `mf-scrap.ts` register counts the same lines as posted. CA item MF81.

### M4 — P1 — Rule 89(5) with LUT exports

- **Fix:** `mf-inverted.ts` `IdLine.zero`, `rule895` (inverted turnover and tax payable without zero-rated lines; ATT =
  positive-rate lines), `suggestInvertedRates`. CA item MF80.

### M5 — P1 — Piece bill restore without its recovery journal

- **Fix:** `trust/recycle-bin.ts`: `OWNED_VOUCHERS` row `Karigar advance recovery` → `purchases`; `purchases` restore hook
  for `mf.piece.advance_jv_id` (`companionOr`).

---

## 3. Checks and budget

`tsc -b` clean; `eslint .` 0 errors (27 warnings, as before); `node --test` 3,380 / 3,380 (seven new M regressions; they assert the
fixed behaviour and were not re-run against `4c2b8e6`); `vite build` + `postbuild` ok; bundle check ok; `node --check tests/e2e/smoke.mjs`
ok; Playwright smoke (`E2E_TIMEOUT=60000`) — see the report. `npm run …` exits 216 in this sandbox, so each command was
run directly.

Budget (vite build, gzip -9): first paint 189,213 B (MF-B's recorded 189,216 B: **−3 B**, lazy-map churn); every change is
in lazy chunks (garments desk, job-card engine, production chunk, inverted-duty view, recycle bin). No new icon names.

## 4. CA questions

MF80 (zero-rated supplies in the Rule 89(5) paper), MF81 (standard vs actual scrap), MF82 (CMT-stitched pieces and the
order's output) — `docs/CA_REVIEW.md` §13; total 408 → 411.
