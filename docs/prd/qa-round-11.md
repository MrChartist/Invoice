# QA round 11: hands-on audit of Round 11 (construction: CN-A profile and bill paper, CN-B contractor finance, CN-C builders, CN-D site operations)

Status: findings fixed in the same loop, each with a regression test in `tests/qa11-construction.test.ts`. Baseline:
branch `claude/elegant-cannon-cwapiv` at `f5645b2` (CN-A to CN-D merged). The existing Round 11 suites (`tests/cn-*.test.ts`,
`purchase-contract`, `no-cash-readers`, `help-registry`) pass on that commit. Every finding below was reproduced on it.

Method:
- **Real flows at the data layer.** Node probes through the repo's test harness (`tests/helpers/shim.ts`,
  `site-ops.ts`, `realty.ts`, `transport-works.ts`) call the same lib APIs the screens call:
  - contractor: `saveContract` → `saveRaBill` (measurement, recoveries, PoS = site) → `recordDeductionRow` /
    `releaseHeld`; `recordSecured`; `savePv` / `billPv`;
  - builder: `createBooking` → `recordReceipt` → `certifyStage` / `raiseDemands` → `collections` / `reraStatement`
    → `cancelBooking`; `procurement80`;
  - site: `saveWorkOrder` → `saveSubBill` / `cancelSubBill`; `markDay` / `settleWeek` / `undoSettlement`;
    `saveLog` / `bookHireIn` / `hireOutInvoice`; `gatherSitePnl` / `sitePnl`;
  - shared readers and writers: `loadLedger`, `advanceBalance`, `billwisePayables`, `deleteVoucher`,
    `purchasesDb.remove`, `localDb.invoices.remove`, `restoreEntry`, `billWarnings`.
- **Static review** of `src/lib/construction/*`, `construction-rules.ts`, `types/construction-r11.ts`, the works paper
  parts (`parts/Works*`, `RaItemsTable`, `PvWorkingPage`, `DemandBlock`), `works/measurements.ts`,
  `works/ra-receivable.ts`, `works/deductions.ts`, the R11 rows of `trust/recycle-bin.ts`, `ledger/postings.ts` and the
  construction views.
- Probe files: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa11/probes/`
  (`zz-qa11-a` site P&L / owned journals, `-b` booking cancellation / demands / RERA, `-c` recycle-bin restores). Run
  one by copying it into `tests/` and running
  `node --experimental-strip-types --import ./tests/hooks/register.mjs --test tests/<file>.test.ts`. Nothing of them is
  committed; the regressions live in `tests/qa11-construction.test.ts`.

Severity:
- **P0:** money or data is wrong, data is lost, or there is a security issue.
- **P1:** a flow is broken, a stated Round 11 invariant is broken, or a tax document / return figure comes out wrong.
- **P2:** friction, a working-paper figure is off, or a cosmetic or printing error.

---

## 1. Summary

| # | Sev | Area | Finding | Fix | Test |
|---|---|---|---|---|---|
| C1 | P1 | Repo / CN-D | A CN-D WIP commit (`d01962f`) tracked a `node_modules` **symlink** (`.gitignore` had `node_modules/`, which matches only a directory). Merged into the main checkout it became a link to itself: `npm test` / `vite` fail with `ERR_MODULE_NOT_FOUND 'clsx'`, and a fresh clone gets a dangling link | Untracked; `.gitignore` → `node_modules` | `C1` |
| C2 | P0 | CN-C5 cancellation | Forfeiture kept out of an **open booking advance** was journalled Dr Debtors. The advance stayed open for the forfeited ₹1,50,000 (refundable or applicable again — the buyer can be paid twice) and the books showed a phantom debtor next to the advance | The kept part closes the advance (`AdvanceRecord.forfeits`, read by `advanceBalance`); the journal debits "Advances from customers", releases the GST paid on that part and is posted; a forfeiture wholly out of the demands' credit stays a draft on Debtors | `C2` (×2) |
| C3 | P1 | CN-D5 site P&L | What the client recovers on our RA bills (material issued, plant hire, water & power, LD, advance interest) is booked to expense ledgers at receipt but was **not a cost** in the site P&L: margin overstated by ₹25,000 on a ₹4,50,000 bill | Counted under material / plant / other (withheld stays held) | `C3` |
| C4 | P1 | CN-B2 / CN-D1 / CN-D2 / CN-C5 | The "Sub-contractor deductions", "Site wages", "Secured advance" (and now "Booking forfeiture") vouchers could be **deleted in Books**, orphaning the row that posted them (days stay settled with no wage payment; a creditor debit with no bill; the liability gone while the advance is open) | `deleteVoucher` refuses while the owning row names the voucher; the modules let go first (`cancelSubBill`, `undoSettlement`, `deleteSecured`) | `C4 / C5` |
| C5 | P1 | CN-D1 | A measured sub-contractor bill could be **deleted from Purchases**: its measurement stayed "billed" (quantities never billable again) and the deductions journal stayed (sub-contractor ledger Dr ₹10,125 with no bill) | `purchasesDb.remove` refuses while a live measurement names the bill ("cancel it in Works → Sub-contracts") | `C4 / C5` |
| C6 | P1 | CN-A2 / R5-B5 GST TDS | With the place of supply now the **site** State, GST TDS u/s 51 was deducted even where our State and the site are one State and the client is registered in another (Sec 51(1) proviso) | `gstTdsProvisoApplies` in `saveRaBill` | `C6` |
| C7 | P2 | CN-D5 WIP | "Measured, not billed" was always ₹0: `saveRaBill` stamps the measurement `billed` even for a **draft** RA bill, and draft bills are not revenue | Counts measurements whose RA bill is a draft | `C7` |
| C8 | P2 | CN-B3 PV | The price-variation bill / credit note carried neither the BOQ nor the cost centre, so the **site P&L** (and Books → Projects) never saw it | `billPv` stamps the contract's `boq_id` (no RA number) and cost centre; the editor's "refresh from BOQ" shows only on RA bills | `C8` |
| C9 | P1 | CN-C / CN-D GST | A builder on the 1% / 5% scheme (no ITC) **claimed ITC** on sub-contractor and plant-hire bills of the project (GSTR-3B 4(A)(5) overstated); a typed bill to the project gave no caution (the documented CN-C gap) | `noItcCentre` sets `itc_eligible: false` on those bills (site cost = total); the bill form cautions (EN + HI) | `C9` |
| C10 | P1 | Recycle bin | A deleted **stage demand**, **RA bill** or **PV bill** came back next to the one made again for the same booking stage / quantities / statement — the same work billed twice | Restore hook on `invoices` refuses each case; a stray delete with nothing re-made still restores | `C10` (×2) |
| C11 | P2 | CN-C3 interest | Delay interest was charged on earlier demands' **interest lines and their GST** (compounding), though the rule is simple interest | Owed = instalments only | `C11` |
| C12 | P2 | CN-A | `R11Stub.tsx` (builder-desk placeholder) is unused since CN-C | Removed | `C1` |
| C13 | P2 | CN-D3 hire out | Deleting the hire-out **draft** invoice left its log sheets marked recovered: never recoverable on his bill, never deletable | Logs carry `recovered_invoice_id`; a deleted / cancelled invoice gives them back (`isRecovered`) | `C13` |

### What was verified and is correct

- **Land deemed one-third.** 1.5% / 7.5% on two-thirds = 1% / 5% of the value to the paisa (₹11,25,000 stage →
  ₹56,250); interest on delay taxed at the same class; after the completion certificate a non-GST bill of supply.
- **Sec 34 / Circular 188.** Credit notes for demands up to 30 November after the FY; after it the refund is net of the
  GST paid, with the note (existing `cn-cancellations` suite).
- **RERA 70%.** Collections exclude pass-through and no-cash rows (advance adjustments); refunds count negative;
  receipts straight into the RERA account count as deposited; a ₹7,50,000 booking receipt into it → required ₹5,25,000,
  shortfall 0.
- **80% test.** Exclusions, cement from unregistered suppliers at its own rate by bill date (28% → 18% on 22 Sep 2025),
  18% on the rest of the shortfall; purchases read through `readPurchase` / `readPurchaseLines`.
- **RA bill.** PoS = site State with IGST / CGST + SGST re-derived; GST on the full value with deductions below;
  194C on the value before GST; retention / SD / water + power from the contract; LD note (Circular 178).
- **Sub-contractor bill.** 194C on the value before GST, PAN-based rate, thresholds; net due in payables.
- **No-cash rows.** Every construction receipt that moved no money carries `ra_journal_id` or `advance_id`
  (`movedNoCash`); RERA, contract summary and booking readers use `movedNoCash`.
- **Registry / storage.** Every writer imports `./cn-registry` (directly or through `cn-contracts`); every table is in
  backup, sync (dated / numbered) and the open export (existing `cn-registry` suite).
- **Dates and numbering.** No `new Date(string)` in construction code; `BKG`, `DMD`, `PVB`, `SWO`, `SCB`, `MUS`, `PLG`
  are FY series held by `series_counters`.
- **Paper.** The works parts mount only with `boq_terms.cn` or an RA number, never on receipt paper — plain invoices
  print as before; demands print no works declaration or certificate.

---

## 2. Findings

### C1 — P1 — `node_modules` symlink committed to the branch

- **Cause:** `.gitignore` line `node_modules/` ignores a directory only. A worktree whose `node_modules` was a symlink
  (the documented "symlink `/home/user/Invoice/node_modules`" setup) committed it in `d01962f` ("WIP CN-D …").
- **Effect:** merging the branch into the main checkout replaced its `node_modules` directory with a link to itself.
  `node --test` fails at the first import (`Cannot find package 'clsx'`), so `npm test` and the build fail; on any
  other machine the link dangles.
- **Fix:** `git rm --cached node_modules`; `.gitignore` → `node_modules` (file or directory).
- **Note for the main checkout:** `/home/user/Invoice/node_modules` is still a self-link there; replace it with a real
  install (`rm node_modules && npm ci`) before running checks from it.

### C2 — P0 — Forfeiture leaves the buyer's advance open (refundable twice) and a phantom debtor

- **Repro (qa11/b F):** book a unit (₹75 lakh), take a ₹7,50,000 booking receipt, cancel with 2% forfeiture
  (₹1,50,000). Refund ₹6,00,000 (RFV) is right, but `advanceBalance` still shows **open ₹1,50,000**; the draft journal
  is Dr **Debtors** ₹1,50,000 / Cr Forfeiture income, so once posted the buyer shows Dr ₹1,50,000 in Debtors and
  Cr ₹1,50,000 in "Advances from customers".
- **Fix:** `cancelBooking` keeps the forfeiture first out of open booking advances (after the refunds), records it on
  the advance (`forfeits[]`, additive) — `advanceBalance` subtracts it (new optional `forfeited`), edit / delete of the
  advance is refused like a refunded one — and posts Dr "Advances from customers" | Cr "GST paid on advances" (the
  kept part's share; the GST stays paid) | Cr "Forfeiture income". The rest of a forfeiture comes out of the buyer's
  credit on the reversed demands (Dr Debtors) and, when nothing closes an advance, stays the CN-C draft. The journal
  cannot be deleted in Books while an advance names it (C4).

### C3 — P1 — Site P&L ignores the client's recoveries on our RA bills

- **Repro (qa11/a A):** RA bill ₹4,50,000 with water & power 2% (₹9,000), client cement ₹9,000, client plant
  ₹4,000, LD ₹3,000: costs all ₹0, margin ₹4,50,000.
- **Fix:** RA bills of the BOQ in the period add `material_recovery` → material, `hire_charges` → plant,
  `water_power` / `ld` / `advance_interest` → other. `withheld`, retention and SD are held, not costs.

### C4 — P1 — Construction journals deletable in Books

- **Repro (qa11/a D, E):** `deleteVoucher` on the sub-contractor deductions journal, a settled week's "Site wages"
  payment, or a secured-advance receipt succeeds; the measurement / muster days / secured-advance row still name it.
- **Fix:** `vouchers.ts` `OWNED_JOURNALS` (the QA10 R17 rule generalised): refused while the owning row names the
  voucher, with where to undo it. `cancelSubBill` and `undoSettlement` now clear the row first (the recycle-bin
  restore rules already expected that).

### C5 — P1 — Sub-contractor bill deletable from Purchases

- **Repro (qa11/a D):** `purchasesDb.remove(bill)` succeeds; measurement `SCB/…` stays `billed`, the journal stays.
- **Fix:** refused while a live `sub_measurements` row names the bill.

### C6 — P1 — GST TDS deducted under the Sec 51 proviso

- **Cause:** `saveRaBill` passed only the client's "deductor" flag. CN-A2 moved the place of supply to the site, so a
  Maharashtra contractor's Maharashtra site for a client registered in Karnataka is CGST + SGST of Maharashtra — the
  proviso case (location of supplier and place of supply in one State, recipient registered in another).
- **Fix:** `gstTdsProvisoApplies(our State, PoS, client GSTIN)` switches GST TDS off for that bill (CA item CN33).

### C7 — P2 — Draft RA bills missing from WIP

- `sitePnl` counted only measurements with status `draft`, which `saveRaBill` never writes. Fixed as above.

### C8 — P2 — PV bills missing from the site P&L

- `billPv` made the document without `boq_id` / `cost_centre_id`. Now stamped (no `ra_no`, so RA numbering, contract
  bills, PV work value and the RA register are unchanged); `ContractPanel` shows "refresh from BOQ" only on RA bills.

### C9 — P1 — Builder bills claim ITC

- Sub-contractor (`saveSubBill`) and hire-in (`bookHireIn`) bills set `itc_eligible` from the vendor's GSTIN alone. On
  a project under N 03/2019 (1% / 5%, no ITC) that overstates GSTR-3B 4(A)(5). Now `noItcCentre(cost centre)` turns it
  off; the bill form warns when a typed bill to such a project claims ITC (`bill-guard.ts`, English + Hindi).

### C10 — P1 — Recycle bin restores double-bill

- **Repro (qa11/c H, I):** delete a stage demand, raise the stage again, restore the deleted one → two demands for one
  stage. Delete RA bill 1, measure the same quantities again (RA 1 again), restore → two RA bill no. 1.
- **Fix:** an `invoices` restore hook refuses a demand when a live demand of that booking and stage exists; an RA bill
  when a live RA bill of its BOQ has the same number or was made after the delete; a PV bill / credit note unless its
  statement is still `billed` with this document.

### C11 — P2 — Delay interest compounds

- `delayInterest` took the earlier demands' totals, which include their interest lines and GST. Now the interest
  (with its GST) is left out of the amount owed. Days still run from the latest earlier due date (CN35).

### C12 — P2 — Unused stub

- `components/construction/R11Stub.tsx` had no importer after CN-C's `RealtyDesk`; removed.

### C13 — P2 — Hire-out draft discard locks log sheets

- `hireOutInvoice` marked logs `recovered_in: 'invoice'` (the draft has no number); deleting the draft never freed
  them. Logs now also carry `recovered_invoice_id`; `isRecovered` treats a deleted / cancelled invoice as not
  recovered (`hireRecoveryFor`, `hireOutInvoice`, `deleteLog`); a sub-contractor bill clears the id when it recovers them.

---

## 3. Checks and budget

- `tsc -b`, `eslint .` (0 errors), the full `node --test` suite, `vite build` + `postbuild`, the bundle check and the
  Playwright smoke (`E2E_TIMEOUT=60000`) — see the hand-off for the run. `npm run …` itself exits 216 in this sandbox
  before running a script, so each script's command was run directly.
- First paint: unchanged within hash noise (every fix sits in lazy chunks: construction engines, `vouchers`,
  `purchases`, `advances` / `advance-tax`, `bill-guard`, `recycle-bin`, `measurements`). No new icon.

## 4. CA questions added

CN32 (forfeiture of an open advance and the GST paid on it), CN33 (Sec 51 proviso reading), CN34 (builder bills without
ITC and client recoveries as site cost), CN35 (delay interest base) — `docs/CA_REVIEW.md` §11.
