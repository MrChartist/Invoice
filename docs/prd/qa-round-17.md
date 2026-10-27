# QA round 17: cross-package pass over Round 14 (professional firms, PS-A … PS-D)

Status: findings fixed in the same loop, each with a regression test in `tests/qa17-prof.test.ts` (all nine fail on the
baseline source — R4 because the guard it tests did not exist, R5 on the picker the settlement panel used). Baseline:
branch `claude/elegant-cannon-cwapiv` at `ca0438f` (PS-A, PS-B, PS-C, PS-D merged; `fb3b378` is the same tree with a
merge commit on top, merged before the final checks). The whole suite passed on the baseline (3,563 / 3,563).

Method: the seams between the four packages, which were built in parallel and integrated late, walked at the data layer
with the repo's harness (`tests/helpers/world.ts`), plus a static review of `src/lib/prof/*.ts`, `prof-rules.ts`, the
Round 14 rows in `tds-rules.ts`, `trade/trade-rules.ts`, `trade/pure-agent.ts`, `trade/export-register.ts`,
`bank-accounts.ts`, `today.ts`, `cash-forecast.ts`, `sales-reports.ts`, `ledger/vouchers.ts` (`OWNED_JOURNALS`),
`trust/recycle-bin.ts` (restore hooks, `OWNED_VOUCHERS`), `backup.ts`, `sync-engine.ts`, `open-export-schema.ts`,
`ledger/notes-auto.ts`, the payment dialog and the Round 14 desks:
- pure-agent (Rule 33) lines of PS-B against PS-D's 194J fee base and 44ADA receipts, PS-C's export check, Rule 89(4)
  paper, EDF, threshold card and realisation clock;
- client money against every cash / bank reader and picker, the to-fees office receipt, the recycle bin;
- the partners' year-end run and monthly credits against Books, the TDS register, the annual pack and the bin;
- design stage bills (PS-B) against the export check (PS-C);
- statutory values against the dated rows (web-checked where noted).

Severity: **P0** money or data wrong, data lost, security; **P1** a flow broken, an invariant broken, or a tax figure
wrong; **P2** friction, a working-paper figure off, cosmetic.

---

## 1. Summary

| # | Sev | Area | Finding | Fix | Test |
|---|---|---|---|---|---|
| R1 | P1 | Partners (D1 / D2) × Books | A year-end appropriation journal or a monthly partner credit could be **deleted in Books** while its `partner_runs` row stayed: the FY still said "posted" (a re-run refused), the 194T row stayed in the register, partner statements and the annual pack disagreed with the ledger | `OWNED_JOURNALS` rows for `Partners appropriation` and `Partner credit` → `partner_runs.voucher_ids` ("undo it in Time → Firm"); the run's own undo still deletes them (the row goes first) | `R1` |
| R2 | P1 | Sec 40(b) book profit (D1) | Interest on capital above the 12 % cap was **deducted in full** from book profit although the excess is disallowed: book profit, and so the allowable remuneration, came out too low (deed at 15 % on ₹10 lakh: allowable ₹5.58 lakh instead of ₹5.76 lakh) | `computeRun`: book profit adds back `interestDisallowed`; `ps-partner-run.test.ts` figures corrected (they pinned the old maths) | `R2` |
| R3 | P1 | Pure-agent lines (B1) × D3 / D4 / C3 / C5 | Each reader treated Rule 33 recoveries its own way: the **GST threshold card** counted them as turnover; the **Rule 89(4) paper** counted them in the domestic turnover and in the zero-rated receipts; the 194J / 44ADA **fee base** apportioned by gross line amounts, so a line discount on the fee moved part of it onto the recovery (₹9,090.91 instead of ₹9,000); PS-B's exact `feeTdsBase` was never wired (dead duplicate) | One test `isRecovery` + `recoveryValue(doc)` (invoice-calc order: line %, share of the invoice discount) in `trade/pure-agent.ts`; `feeBase` works the lines out again (`calculateInvoice`) without recoveries (194J hint, chase, 44ADA); threshold and Rule 89(4) subtract `recoveryValue`, receipts are scaled by the fee share; `feeTdsBase` removed. EDF value and the realisation register keep the **full** invoice value (FEMA: the whole amount is to be realised — PS82) | `R3` |
| R4 | P1 | Client money (B3) × receipts | The office receipt a **to-fees** client-money entry makes could be removed alone in the invoice's payment dialog: the invoice reopened while the client-money journal still showed the money moved out of the trust account (books and register no longer tie; the money "vanished") | `assertNotClientMoneyReceipt` (`ps-client-money.ts`, loaded only for a `CMV/` reference) refuses it, pointing to Time → Client money (whose delete removes both) | `R4` |
| R5 | P2 | Client money × marketplace | PS-B made `pickableBankAccounts('brs')` offer client-money accounts (right for statements), but the marketplace settlement panel used `'brs'` to pick the **payout** bank — a settlement could be posted into clients' money | New purpose `'payout'` (no clearing, no client money; no runtime branch added) used by `SettlementsPanel` | `R5` |
| R6 | P1 | Design stage bill (B4) × export check (C1) | A stage bill for a client abroad on a house in India took the property's State as place of supply, but PS-C's Sec 2(6) check never saw the property: with the client abroad it passed condition (iii) and the bill could be zero-rated as an export | `createStageBill` snapshots `ps.export = { pos_class: 'property', property_state }`, so the check reads Sec 13(4) and fails (iii) for an Indian property | `R6` |
| R7 | P2 | Annual pack partners' note (D1) | The partner-wise capital / current table had no column for 194T TDS (the credit is net of it) or interest on drawings, so no row **footed** to its closing balance | Column "TDS 194T and other" (closing − the other columns, or a passed value) | `R7` |
| R8 | P1 | 194T (D2) × TDS register | A 194T deduction posted by a partner credit or the year-end run could be deleted in the TDS register while its journal still credited TDS payable (26Q paper short, run inconsistent) | `deleteManualDeduction` refuses a row a live `partner_runs` row names; the run's undo still removes it | `R8` |
| R9 | P1 | FEMA realisation (C2, goods too) | The dated rows held **15 months** up to 30 Sep 2026; the First Amendment Regulations 2026 (FEMA 23(R)/(8)/2026-RB of 5 Jun 2026) restored 9 months from 5 Jun 2026, so every export invoiced / shipped 5 Jun – 30 Sep 2026 showed a due date six months late | New dated row `2026-06-05 → 9` inserted in date order (no row edited; source marked verify, PS83); help text updated; `ps-fema.test.ts` figures that pinned 15 months for Sep 2026 corrected | `R9` |

### What was verified and is correct

- **Statutory rows.** 40(b)(v) ₹1.5 / 3 lakh slabs (2009) and ₹3 / 6 lakh from FY 2024-25 (90 % / 60 %); interest cap 12 %;
  194T 10 % from 1 Apr 2025, ₹20,000 FY aggregate per partner; 44ADA ₹50 lakh, ₹75 lakh when cash ≤ 5 % from FY 2023-24,
  deemed 50 %; the Sec 13(8)(b) omission by Sec 157 of the Finance Act 2026 from assent (30 Mar 2026 — commentary agrees no
  separate commencement; still `verified: false`, PS4); FEMA 2026 regulations from 1 Oct 2026: 9 months (12 for INR);
  N 13/2017 entry 2 (RCM to a business entity) and N 12/2017 entry 45 (advocate to an advocate, to a non-business, to a
  business entity under the threshold; a senior advocate's supply to an advocate not exempted — PS54). 194J threshold
  ₹50,000 from 1 Apr 2025. The 2025-Act rows stay `verified: false`.
- **Client money vs cash readers.** Receipts / payments / cheques / e-payments never offer a client-money account
  (`pickableBankAccounts`); Today, payment modes, collection lag and the cash-forecast opening skip it (one predicate,
  Today inline); the trust bank's own book and BRS see its vouchers (correct: it is a real bank); CMV journals delete only
  with their voucher (`OWNED_JOURNALS`) and never restore alone; the bin refuses the office receipt without its voucher.
  Partners' drawings are posted from cash or the main bank only.
- **Coverage.** Every Round 14 table (`engagements`, `conflict_checks`, `partners`, `partner_runs`, `udin_register`,
  `client_money`, `edf_register`) is in backup `RECORD_TABLES` / `ID_TABLES`, sync `DATED` (and `NUMBERED` for ENG / CMV),
  the open-export schema, `PS_TABLE_ACTIONS` and `PS_WATCHED`; `prof_settings` is backed up / synced as a singleton.
  Restore hooks exist for engagements, EDF rows, partner runs (with journals and 194T rows), CMV vouchers and their
  office receipts. Writers import `ps-registry` (`tests/ps-registry.test.ts`, `ps-d-registry.test.ts`); help topics
  cover every tab and view (`tests/help-registry.test.ts`); every area has EN + HI keys (`defineArea` types).
- **Dates.** No `new Date(str)` on a bare day in Round 14 (`new Date(y, m, d)` only); FY bounds from the string.
- **Export check vs pure-agent lines.** A timesheet reimbursement line is type `Service`, so a services export with one
  stays a services export (invoice-date clock, EDF, refund).

### Not wired (left as found, P2 — the engines exist with tests, no screen calls them)

`ps-disb.ts` unrecovered list / ageing / write-off / schedule, `ps-media.ts` billing lines / commission / TDS / snapshot,
`ps-legal.ts` `appearanceLines` (per-appearance billing on the pre-bill), `ps-fx-rates.ts` `atClosing`,
`ps-partners.ts` `deletePartner`, `ps-conflicts.ts` `deleteCheck`, `ps-property-pos.ts` `isPropertyExport` (R6 snapshots
the property instead). Tree-shaken, so they cost no bytes; wiring them is feature work for the lead to schedule.

## 2. Size

| Budget | Before (`ca0438f` / `fb3b378`) | After | Delta |
|---|---|---|---|
| Initial JS (first paint) | 184.8 kB | 184.8 kB | 0 |
| Total JS | 3,425.6 kB | 3,426.1 kB | +0.5 kB (`recoveryValue`, the guards) |

The 8 kB trim was **not reached**. Measured on the built chunks (gzip -9):
- Round 14 strings are already terse (47.5 kB raw EN + HI over 952 keys; the long ones are the working-paper notes with
  their PS ids). Cutting them by a third would save ≈ 1.5 kB and lose wording the CA review relies on.
- Lib error / notice strings: ≈ 2.2 kB raw in all of `lib/prof`.
- Dead code (above) is already tree-shaken.
- Merging chunks is where the bytes are: the thirteen small shared libs (`ps-shared`, `ps-snapshot`, `ps-pos`,
  `ps-registry`, `ps-settings`, `ps-d-settings`, `ps-profile`, `ps-staff`, `ps-legal`, `ps-disb`, `ps-disb-guard`,
  `ps-media`, `ps-ro`) gzip to 6.5 kB apart and 4.7 kB together (−1.8 kB); the four shared string areas −1.2 kB; Matters +
  WIP desks −1.0 kB; the export desk with its four lazy parts −1.7 kB; Firm desk + partner engines + threshold −1.0 kB.
  A rolldown `manualChunks` / `codeSplitting` group would do it, but rolldown captures each module's dependencies into
  the group (`includeDependenciesRecursively`, on by default), which pulled `storage`, `access`, `tax-rules` … into the
  group and first paint to 310 kB in the trial; turning that off is app-wide and needs `strictExecutionOrder`. Left for
  the lead: the safe route is to merge the small libs into fewer files (names in AGENTS.md / docs would move).

## 3. Regression tests

`tests/qa17-prof.test.ts` (R1–R9). Updated existing tests that pinned the old behaviour: `ps-partner-run.test.ts`
(book profit 476,000 with the cap add-back), `ps-fema.test.ts` (9 months for 5 Jun – 30 Sep 2026), `ps-disb.test.ts`
(the fee base now comes from `ps-tds-recv.ts`).

## 4. CA questions

PS81–PS85 in `docs/CA_REVIEW.md` §14.10.
