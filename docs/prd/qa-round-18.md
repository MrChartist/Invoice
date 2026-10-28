# QA round 18: cross-package pass over Round 15 (travel, tour & events; R15-A netting / audit coalescing)

Status: findings fixed in the same loop, each with a regression test in `tests/qa18-travel.test.ts` (T1–T5 fail on the
baseline source: T1 on the CSS / markup it pins, T3 because the function it tests did not exist) and, for T1, in the
production e2e (`tests/e2e/smoke.mjs`, `footerLaidOut` after every "Bill → editor" jump). Baseline: branch
`claude/elegant-cannon-cwapiv` at `0dad0d9` (R15-A … R15-D merged; `0521a90` is the same tree, merged before the final
checks).

Method: the known Bill-layout bug reproduced in Playwright against the production build and traced to its trigger; the
seams between R15-A … D walked at the data layer with the repo's harness (`tests/helpers/world.ts`); a static review of
`src/lib/travel/*.ts`, `travel-rules.ts`, `netting.ts`, `retail/rt-doc-hooks.ts`, `audit.ts` (coalescing), `storage.ts`
(`onPendingKey`), `documents.ts` (credit notes), `tds-returns.ts` / `tds-payables.ts` (TCS readers), `ledger/postings.ts`,
`trust/recycle-bin.ts` (restore hooks), `backup.ts`, `sync-engine.ts`, `open-export-schema.ts`, the travel desk views and
the payment dialog; statutory rows checked against primary texts where reachable.

Severity: **P0** money or data wrong, data lost, security; **P1** a flow broken, an invariant broken, or a tax figure
wrong; **P2** friction, a working-paper figure off, cosmetic.

---

## 1. Summary

| # | Sev | Area | Finding | Fix | Test |
|---|---|---|---|---|---|
| T1 | P1 | Editor × every desk "Bill" | After **Bill** on the Trips desk the editor's items footer (Add line, the trip row, the R15-D chips) had **no layout box** in Chromium until a reload. Not travel-specific: on the baseline build the same happened after Timesheets → Bill (R3-B), Workshop job → Bill, Clinic visit → Bill, IPD final bill (R10), Trips → Bill (R15-B), Ticket → draft (R15-C) and Trips → Bill (R15-D) — 7 of 7 paths checked; opening the draft by URL or a `pushState` jump to it was fine | See §2. The size container is now the lines block only (`.lines`, `container-type: inline-size`); the footer sits outside it in a plain `.wrap` column. The `@container` rules (narrow-card line layout) are unchanged — they only style the lines | `T1` (markup / CSS); e2e: `footerLaidOut` after the 7 jumps; R15-D's **reload removed** |
| T2 | P1 | Netting (A3) × payment dialog / recycle bin | Deleting one netting receipt in an invoice's payment dialog re-opened the invoice but **left the supplier bill "paid"** by it (`amount_paid` / `exchange_paid` stale: bill ₹1,80,000 netted ₹40,000 still showed ₹1,40,000 due after the receipt was gone). Bill-wise payables (live rows) and the purchase list then disagreed. R9 exchange rows had the same gap | `localDb.payments.remove`: a removed row with `exchange_purchase_id` calls the `voidHook.paid` slot, which `rt-doc-hooks.ts` sets to `syncUrdPaid` (URD vouchers + netted bills). The payment dialog loads the hook before removing such a row. Restoring the row from the bin already re-settled (QA10 R7 path) | `T2` |
| T3 | P1 | Netting (A3) × invoice delete / cancel | The hooks that free a bill's netting receipts when the **invoice** is deleted or cancelled (`voidHook.f`, R9) were loaded only for retail companies (`ensureRetailHooks`). Netting is open to every company: a travel agency deleting a netted invoice in a fresh session dropped the receipts without re-settling the bill | `needsRetailHooks()`: retail, or any receipt with `exchange_purchase_id` on record (one `peekTable` scan on the editor / Transactions chunk load) | `T3` |
| T4 | P1 | Cancellation (C3) × TCS (D1) | Cancelling an outbound package that carried TCS showed a **refund to the client ₹6,720 short**: the plan summed the lines with GST (no TCS, no invoice discount share, no round-off) while the credit note it posts credits the invoice in full, TCS included (₹3,42,720). The dialog said ₹3,15,000; the client's account showed ₹3,21,720 due to them | `cancelPlan` values each credit with `buildCreditNote` (the note's own maths); refund = Σ credit − fee with GST. Whether the TCS should be credited at all is **TV41** | `T4`; `tv-cancel.test.ts` refund now from the note (₹10,606, was ₹10,605.60 before round-off) |
| T5 | P2 | Cancellation (C3) | The credit note was dated **today** while the fee invoice, the supplier debit note and the period-lock check used the cancellation date the user entered | `CreditInput.date` (optional, additive); `createCreditNote` numbers and dates the note on it; `cancelBookings` passes the cancellation date (TV45) | `T5` |

### 2. T1 root cause

Probed in Playwright on the production build (`MutationObserver` + per-frame `getClientRects`, instrumentation of every
layout read inside the items table):

- The footer element kept its computed style (`display: flex`, visible, not `content-visibility`) but had **no layout
  object**: `getClientRects()` empty, `offsetHeight` 0, `checkVisibility()` false; everything inside it too. No app code
  wrote a style on it, no Suspense boundary hid it (no `style` mutation on any ancestor), no script read its layout
  before it broke.
- It broke in the same frame as React replaced the draft's line row (a `.body` row removed and a new one inserted just
  before the footer) inside `.wrap`, the items table's **size container** (`container-type: inline-size`; its
  `@container (max-width: 920px)` rules hide the header row and re-grid the lines). Container-query style recalc runs
  interleaved with layout; on this mutation sequence Chromium (153) left the footer, a later sibling, without a layout
  box. Only a style change on the footer itself (or a reload) re-attached it; toggling the container on `.wrap` did not.
- With `container-type` removed from `.wrap` the bug was gone (same build otherwise); with the container moved to a
  wrapper of the lines only, the footer laid out on every run and no element under `<main>` was left without a box.
- Why only after **Bill**: the desk's click creates the draft and navigates in one task, so the editor mounts with the
  blank line and swaps in the saved line before the first layout. A `pushState` jump to the same draft, or a direct
  load, mounts it after the store has the draft (no swap) — fine.

Fix at the root: the footer (where the lazy pack rows land) is no longer inside a size container; the lines keep their
container and queries. No lazy chunk or CSS-module loading issue was involved (all CSS for the route was in place).

## 3. Seams walked and found correct

- **Ticket pass-through lines (C1) and the Rule 32(3) service line** carry `charge_head_id: 'rule33'` +
  `PURE_AGENT_CHARGE`, so GSTR-1 / HSN / e-Invoice `ItemList` leave them out and e-Invoice keeps them in `OthChrg` (QA17
  pinned the shared predicate). The R15-B regime line and the ticket service line mix → `TV_MIX` warns (recoveries never
  count). No e-Way output for services.
- **TCS base (D1)**: base = invoice total − round-off − TCS (or taxable value, TV6) at the invoice's exchange rate;
  ticket fares at actual are inside the "total" base (TV6). FY boundaries: `fyOf` from the string; 31 Mar 2026 takes the
  ₹10 lakh slabs and the buyer's FY 2025-26 aggregate, 1 Apr 2026 the flat 2 % (`priorTourBase` is FY-scoped, drafts
  and cancelled documents left out). The trip-level stand-alone test on a ticket-only invoice → **TV44**.
- **Supplier statement "Make bill" (C2) vs the ITC block (B3)**: the statement bill is fares at actual, 0 % GST,
  `itc_eligible: false`, not tagged to a trip — no ITC to block or claim; bills tagged to a 5 % trip still go through
  `TripPick` (block, reason, audit).
- **Netting vs cash / bank readers**: rows carry `exchange_purchase_id` + `method: 'netting'`; `movedNoCash` keeps them
  out (guarded by `tests/no-cash-readers.test.ts`). Period lock: posting and reversal check the netting date; restoring
  a binned netting row is refused when the bill was paid since (QA10 R7 hook applies to any bill) and re-settles it.
- **Audit coalescing (A2)**: every reader goes through `readRaw` (`getTable` / `peekTable` too), which flushes; backup,
  sync and `pagehide` flush; restore / erase / demo removal drop the batch; vault sealing stays inside `storage.ts`;
  company switch and vault lock are separate tasks (the microtask flush has run).
- **Coverage**: `travel_bookings`, `supplier_statements` in backup `RECORD_TABLES` / `ID_TABLES`, sync `DATED`, the
  open-export schema, `TV_TABLE_ACTIONS` / `TV_WATCHED`, `DEMO_EXTRA_TABLES`; `travel_settings` backed up and synced as a
  singleton, in the schema. Help topics for every view, Ctrl+K, EN + HI strings (`defineArea`) — pinned by the existing
  registry / help tests. No `new Date(<bare day>)` in Round 15 code.
- **Cancellation vs the recycle bin**: deletes go through the data layer (bin); a cancelled booking is never billed
  again whatever happens to its credit note (status is stored). Deleting the cancellation credit note leaves the booking
  cancelled — P2, left as found (restore it from the bin).

## 4. Statutory check

| Item | Primary text read | Result |
|---|---|---|
| Rule 32(3) deemed value 5 % / 10 % of the basic fare, at the supplier's option (Rule 32(1)) | CGST Rules Part A as on 01.06.2021 (GST Council compilation) | Matches. `AIR_AGENT_VALUE_RULES` row → `verified: true` (source names the text); `tv-rules.test.ts` now requires a verified row to name what was read |
| Tour operator 5 % without ITC (except a tour operator's service in the same line), gross-amount bill condition | N 11/2017-CT(R) as amended to 01.04.2019 (GST Council compilation) | Rate, ITC condition and bill wording match the `to5` rule, the `package` exception in `tripTag` and the declaration. The entry is Sl. 23 **(i)**, the declaration cites 23(ii) → **TV43**. The 2025 row (N 15/2025) not reached; rows stay `verified: false` (one row also holds the 18 % / agent / exempt values not read) |
| TCS on overseas tour packages 2 % flat from 1 Apr 2026 | Finance Bill 2026 (as introduced) cl. 73(f) and the notes on clauses ("2 % irrespective of the amount … from 1st April 2026") | Matches the 2026-04-01 row. The enacted Finance Act 2026 (gazette) could not be fetched (certificate chain of egazette.gov.in incomplete; TLS checks not bypassed) → row stays `verified: false`. History rows (2020 / 2023 / 2025) not re-read |
| Sec 12(2), 12(7)(a), 13(3)(b) IGST POS | Not reached this round | Unchanged, unverified |

No rule row was edited or overwritten; no new dated row was needed.

## 5. Size

| Budget | Before (`0dad0d9`) | After | Delta |
|---|---|---|---|
| Initial JS (first paint) | 182.6 kB, 4 files | 182.6 kB, 4 files | ≈ 0 (`voidHook.paid` call in `localDb`, a few bytes) |
| Entry chunk | 88.6 kB | 88.6 kB | 0 |
| Total JS | 3,429.4 kB | 3,429.2 kB | ≈ 0 (hash noise of ± 1 kB between builds; the fixes add < 0.3 kB) |

## 6. Regression tests

`tests/qa18-travel.test.ts` (T1–T5). Updated: `tv-cancel.test.ts` (refund from the credit note), `tv-rules.test.ts`
(verified rows must name the text read), e2e `footerLaidOut` after seven Bill jumps and the R15-D step without its
reload. On the baseline build the e2e failed exactly the seven footer checks and the R15-D step (620 other checks
passed).

## 7. CA questions

TV41–TV45 in `docs/CA_REVIEW.md` §15.1 (total 536 → 541).
