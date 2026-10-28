# QA round 21: Round 18 (co-operative housing societies, AOAs, RWAs) and the R18 bulk save (`saveMany`)

Status: findings fixed in the same loop, each with a regression test that fails on the baseline source:
`tests/qa21-society.test.ts` (W1–W10, ten tests; all ten fail on `55d62df`'s `src/`, same tree as master `f95f5e9`) plus
one pin (bulk = one-by-one for a society run under approvals across the FY boundary). Baseline: branch
`claude/elegant-cannon-cwapiv` at `55d62df`, re-merged at `f95f5e9` (master, same tree) before the final checks.

Method: `saveMany` read against the old `save` line by line (numbering, holds, credit gate, the `voidHook`, audit,
catalogue / client learning, rollback) and every `issueBatch` caller (R2-B batch tab, R5-C fee runs / fines, deposits,
society runs) plus every loop of `localDb.invoices.save` in `src/lib` checked for a bulk path; the society money paths
walked at the data layer (run → regime → GSTR-1 B2B / B2CS / Table 8 / HSN / e-Invoice; interest by day and cap;
receipts interest first; waiver; levy; undo; transfer; certificate; funds; R&P; bank hints); the data layer (backup /
sync / open export / `TABLE_ACTIONS` / audit / recycle bin); every Society-desk view and the strings its engines
build; primary statutory texts where reachable.

Severity: **P0** money or data wrong, data lost, security; **P1** a flow broken, an invariant broken, or a tax figure
wrong; **P2** friction, a working-paper figure off, cosmetic.

---

## 1. Summary

| # | Sev | Area | Finding | Fix | Test |
|---|---|---|---|---|---|
| W1 | P2 | `saveMany` numbering | The per-call series index continued from the last number it had given, so a batch `[auto, typed INV/…/0050, auto]` gave `0001, 0050, 0002` — one save after another gives `0001, 0050, 0051` (highest + 1). A number lower than one already issued in the same batch broke "bulk = sequential" (Rule 46 order) | A document whose number was typed (not given by the index) and is new to the batch clears the index; the next auto number is read from the rows again | W1 |
| W2 | P1 | R18-B society GST × place of supply | A member with an out-of-State address or GSTIN (a company owning a flat) got **IGST** (POS = member's State, from `buildBatchDrafts`); GSTR-1 B2B POS 29 for a Pune building. A society's services are at the building (IGST Act Sec 12(3)) | `BatchContext.pos` (a fixed place of supply); society runs pass the society's own State (agency kind: unchanged). The member snapshot is untouched | W2; HS65 |
| W3 | P1 | R18-C transfer × dues | After "Transfer" (dues ticked settled while the books still showed them open), the incoming member's next bill carried the **outgoing member's arrears memo and interest** (₹24.59 on Asha's ₹6,800), his Dues row showed her bill, and his receipt split settled her bill | `unitDues(…, owner)`: the run, Dues row, receipt split, waiver and bank hint read only the current member's bills; the certificate and the transfer check read the unit | W3; HS66 |
| W4 | P1 | R18-D fund transfer journals | Journals were counted by date only: a year-end journal (dated 31 Mar) then "Transfer for 2026-10" **moved October again** (sinking ₹1,750 + repair ₹5,250 twice); "Transfer for 2027-03" then **reversed** the year-end journal; a quarter's journal then one of its months, the same (the "mixing not guarded" deviation) | A journal covers the period in its narration (`— 2026-10`, `— FY2026`); a transfer whose range another journal only partly covers is refused ("The fund transfer for FY2026 already covers part of this period …") | W4; HS67 |
| W5 | P2 | R18-B undo × C waiver / receipts | Undo cancelled a run whose bill carried an **interest-waiver credit note**: the note stayed live, a credit against a cancelled bill. A bill with a receipt made undo fail with a generic message (no unit named) | Undo refused up front, naming the units, while any run bill has a receipt or a live linked credit note | W5; HS70 |
| W6 | P2 | R18-C waiver over several bills | One note per bill without a rollback: a refusal on the second bill (e.g. paid in full later) left the first note issued | `withTablesRollback` over invoices, links, series, catalogue | W6 |
| W7 | P2 | R18-D2 Receipts and Payments | The cash set excluded clearing accounts from `bankAccountsDb.active()` only: an **inactive** clearing (marketplace / RA) account's ledger counted as cash | `nonCashBankLedgerIds(all accounts)` (`bank-ledgers.ts`), used by the annual pack | W7 |
| W8 | P2 | Hindi × Society desk | Unit validation errors, the undivided-% warning and the bridges' errors (`Map the funds first…`, `Unit not found.`, `No member.`) stayed English with Hindi on | Strings in `society-r18a` / `-c` / `-d` (literal Hindi), translated when called | W8 |
| W9 | P2 | Recycle bin × units | A deleted unit restored next to a unit created since with the same code (case / spaces ignored) → two units `A-101` | Restore hook on `society_units` | W9 |
| W10 | P2 | Bulk writers still looping `save` | Marketplace sales import (a month's orders), freight bills and agency commission bills saved one document per write (O(n²) as R18-B found for societies) | `saveMany` (one write; LR / indent rows one write) | W10 |

## 2. Paths walked and found right

- **`saveMany` vs `save`:** checks per document in order against the rows saved before it (roles, rights, period lock,
  approval hold with a provisional number, credit gate with the batch's rows, Rule 46 clash), FY series by issue date
  (both sides of 1 April), unnumbered drafts, stored drafts numbered on issue, high-water marks; nothing is written when
  any document fails (one `setTable`; `issueBatch` / society runs wrap it in `withTablesRollback`); audit rows identical
  (order: documents, then parties); one recycle-bin / sync diff per write (no deletes); vault and cross-tab go through the
  same `setTable` (no await inside the batch). Pin test: a clerk's society run under approvals (A-901 held), March and
  April runs — bulk = one-by-one (numbers, statuses, approvals, audit). Kept one-by-one on purpose: recurring
  `runDueSchedules` (a locked occurrence is skipped per document), batches with stock lines, demand / arrears flows that
  read each saved document back.
- **Regimes:** ₹7,500 × months per unit; statutory dues pure-agent (outside Table 8 / B2CS / HSN, e-Invoice `OthChrg`);
  non-member heads on their own 18 % document; unregistered → plain bills; agency → 18 %; excess → exempt line in
  Table 8 + taxable rest; interest counted in the test and taxed with the bill's regime.
- **Interest:** State cap by day (MH 21 % → 12 % on 2026-06-22), never on interest or `rule33` lines, receipts from the
  next day, days charged once (`through`), an undone run frees its days.
- **Levy:** tested with the month's regular bill, once per unit and name; undo leaves the regular bills.
- **Data layer:** `society_units` / `society_runs` / `society_settings` in backup (both lists), sync (`society_runs`
  DATED by `date`; settings a singleton), open-export schema, `TABLE_ACTIONS` / audit via `hs-registry` (every writer
  imports it, directly or through `hs-settings` / `hs-units-save`), restore hooks for bills and runs (W9 adds units).
- **Reminders:** the society templates never name a service or amenity (the R18 grep test); the generic schedule and
  party reminders carry no such wording either.
- **Bank hints:** one unit per narration; the apply step settles the member's oldest bills (HS58, unchanged).

## 3. Statutory re-check

| Rule | Read | Outcome |
|---|---|---|
| `RWA_LIMIT_RULES`, `RWA_VALUATION_RULES` | Circular 109/28/2019-GST (cbic-gst.gov.in; WB / Tripura copies) | Agrees; stays verified |
| MH `STATE_SOCIETY_RULES` 2026-06-22 (12 %) | taxguru's reproduction of the 18 Jun 2026 notification (Rule 106C-12: "not exceeding simple interest 12% per annum"); FPJ / ksandk report the Gazette of 22 Jun or effect from 30 Jun 2026 | Value agrees (secondary); no Gazette text → stays `verified: false`; date question HS68 |
| `INCOME_TAX_SOCIETY_RULES` 2026-04-01 (Sec 149) | Secondary only (incometaxindia.gov.in 403): ₹50,000 / ₹1 lakh for consumers' co-operatives, (5) co-operative banks | Stays `verified: false`; HS69 |
| N 12/2017 Sl. 77(c) after 2018 | No later amendment found in a primary copy | Unchanged |

No rule row was added or flipped.

## 4. Size

Before = `f95f5e9` (`55d62df` tree), after = this branch; `vite build`, gzip -9 with chunk hashes stripped (normalized).

| Budget | Before | After | Delta |
|---|---|---|---|
| Initial JS (first paint) | 182.3 kB, 4 files | 182.4 kB, 4 files | **+34 B** normalized (`index`: W1 in `localDb.ts`; runtime / vendor chunks byte-identical) |
| Core precache (English) | 3,168.5 kB | 3,169.7 kB | +0.97 kB normalized (SocietyDesk +0.27, `f-society` +0.23, recycle bin +0.08, bank-ledgers +0.06, Agency / Marketplace +0.05, AnnualPackTab −0.04) |
| Hindi pack | 349.2 kB | 349.4 kB | +0.27 kB (`lang-hi-society`, W8 / W4 / W5 strings) |
| Hindi left in core / `lazy-leaves` | 21.5 / 17.4 kB | 21.5 / 17.4 kB | 0 |

Every budget stays green (`check-bundle-size`).

## 5. CA questions

HS65 ★ (place of supply), HS66 (transfer and dues), HS67 (one fund-transfer mode per FY), HS68 (MH 2026 rules' date),
HS69 (Sec 149 caps), HS70 (waiver note and undo) in `docs/CA_REVIEW.md` §18 (total 679 → 685).
