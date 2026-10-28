# QA round 20: cross-package pass over Round 17 (security, facility-management and manpower agencies)

Status: findings fixed in the same loop, each with a regression test that fails on the baseline source:
`tests/qa20-manpower.test.ts` (V1–V9, ten tests; all ten fail on `fb0a031`'s `src/`) and the e2e step "R17-D arrears,
receivables and renewals" (V6). Baseline: branch `claude/elegant-cannon-cwapiv` at `fb0a031` (R17-A … D), re-merged at
`facb6c4` (master, same tree) before the final checks.

Method: the money paths walked at the data layer with `tests/helpers/world.ts` / `mp-world.ts` — muster → bill (duty,
hour + OT, month pro-rata / extra duties, cost-plus; one site and grouped multi-site bills; the regime split) → GSTR-1
B2B / CDNR / HSN / Table 8 / e-Invoice / e-Way, RCM totals, credit / debit notes on muster bills, arrears notes vs client
TDS (`freezeDate`), site P&L against the books' cost-centre P&L built from the ledger (`loadLedger` → `costCentrePnl`),
muster → payroll attendance vs a final run, compliance shares vs run totals; the data layer (backup / sync / open
export / `TABLE_ACTIONS` / audit / recycle bin / period lock / cost-centre deletion); a read of every Deploy-desk view
and the strings its engines build; primary statutory texts where reachable.

Severity: **P0** money or data wrong, data lost, security; **P1** a flow broken, an invariant broken, or a tax figure
wrong; **P2** friction, a working-paper figure off, cosmetic.

---

## 1. Summary

| # | Sev | Area | Finding | Fix | Test |
|---|---|---|---|---|---|
| V1 | P1 | R17-B3 grouped bills × billed state | `billMonth` skipped a plan only when **every** muster in it was billed. A bill group whose sites lock on different days: Tower A locked and billed alone (₹1,28,600), Tower B locked later → "Bill all locked" planned the group from both musters and billed **A again** (₹1,36,600 on top of the ₹1,28,600). The view's "Unbilled" column also showed the whole group's value on each row | Billing plans only musters no live bill covers (`planMonth(month, keep)`); "Bill again" re-plans only the asked site's billed muster; the already-billed codes are reported as skipped. The view uses `planUnbilled` and shows each site's own lines | V1 |
| V2 | P1 | R17-B / D × recycle bin | A deleted muster bill restored after the muster was billed again → **the duties billed twice** (no restore hook; the R17 rows had none). Same for an arrears note re-raised for the same revision and bill; a deleted `site_musters` / `site_compliance` row came back next to a newer row of the same site × month (two musters → billing / payroll read either) | Restore hooks (`recycle-bin.ts`): a muster bill only while no live bill covers its musters; an arrears note only while no live note has the same `rev_id` / `of`; muster / compliance rows only while the site lives and no row holds the same site × month | V2 |
| V3 | P1 | R17-B3 / C2 grouped bills × site P&L × books | A bill of several sites had no cost centre (document or line): the books' cost-centre P&L put the **whole bill in "Unallocated"**, while the site P&L counted only the post rows — the **service charge was in neither** site (₹13,660 of ₹1,50,260 lost from both sites); a partial credit note on the group bill took out the **full** post amounts it had copied | Lines of a multi-site bill carry `cost_centre_id` (6.16 line override) and the service charge is one line per site (arrears notes the same); `billedFor` shares a bill's taxable value by its lines' sites (older bills: by post rows). Site P&L = books' cost-centre income to the paisa, nothing unallocated | V3 |
| V4 | P2 | Cost centres × R17 rows | A site with musters, compliance rows, deployed staff or site-tagged purchase bills (`mp.site_id`) — and any site billed only on group bills — could be **deleted** from Books → Cost centres (usage counted only `cost_centre_id` on documents): its musters and proof orphaned | `CostCentreUsage.sites` counts `site_musters` / `site_compliance` rows, employees deployed there and bills tagged `mp.site_id`; the delete refuses ("mark it inactive") | V4 |
| V5 | P1 | R17-C1 compliance pack × payroll run | Shares were rounded per site independently: ₹10,000 over three sites of 10 duties = **₹9,999.99** (every amount: PF, ESI, net); and a **draft** muster at another site took its share of the run (the payroll push reads locked musters only), so the locked site showed half | Each run line is cut by cumulative duties over the month's **locked** musters in a fixed order (site, muster): share = round(amount × duties up to the row ÷ all) − round(amount × duties before ÷ all) — a person's shares add up to the run line exactly; `dutiesOf` (wage check) counts locked musters too | V5 |
| V6 | P1 | R17-D1 arrears × TDS / note date | The arrears note was dated **today** even when its bill was dated later (bills are dated the month end or the 1st of the next month; billing on the 20th): the debit note **predated its invoice**, and the client-TDS threshold test on that day did not see the bill → **no TDS** on the note (e2e: ₹1,286 instead of ₹1,325.78). A still-draft bill (left out of the FY total) gave the same | Note dated the later of today and the bill's date (`createDebitNote` takes an optional `date`, as `createCreditNote` since QA18 T5); TDS by the threshold test on that day with the bill counted, else the bill's own `mp.tds` rate | V6 ×2; e2e |
| V7 | P2 | R17-B1 musters × bills / final run | A locked muster could be unlocked, edited and re-locked after it was **billed** (the bill stayed "billed" with the old duties; "Bill" skipped it) or after the month's payroll run was **final** (the run kept the old attendance; the compliance shares then apportioned it by the new duties) — silently | Unlock refused while a live bill covers the muster ("cancel the bill, or raise a credit / debit note") or the month's run is final ("reopen it") | V7 |
| V8 | P2 | Hindi × Deploy desk | With Hindi on, English text built by the engines stayed on the desk: muster warnings (MusterView), licence / contract notices (Statutory view; also the bell), the GST TDS u/s 51 hint after billing, the RCM-only registration note, "Pop-up blocked" | Strings moved to the Round 17 areas (`manpower-r17b` `w.*` / `gstTds`, `manpower-r17d` `a.*` / `rcmOnly` / `popup`, literal Hindi); the engines translate when called (render / bell run). `mp-rules.test.ts`: an engine may import a Round 17 area (same family chunk) | V8 |
| V9 | P2 | R17-C3 labour hints × OSH Code | The contract-labour licence hint counted workers **per site** only. OSH Code Sec 45(1)(ii) also reaches "every manpower supply contractor who has employed, on any day of the preceding twelve months, fifty or more contract labour" — the agency's own people across all sites (ten sites of ten guards never set it off) | Hint `clraAll` (distinct people on the month's musters, all sites, against `CONTRACT_LABOUR_THRESHOLD_RULES`) when no OSH / contract-labour licence is on file and no site hint fired — MP45 | V9 |

## 2. Money paths walked and found right

- **Bases** (duty; hour with OT when "bill OT"; month pro-rata with the cap and "bill extra duties"; cost-plus percentages
  and uniforms as one supply) and the regime split: RCM bill total = taxable (no tax for the client to pay), GSTR-1 B2B
  `rchrg: 'Y'`, e-Invoice `RegRev: 'Y'`; a school's (Sl. 66) bill → Table 8 exempt (₹38,100 B2C intra exempt in the walk)
  and HSN rows at 0 %; e-Way: services only, no item list (`isServiceHsn`).
- **`billsOf` leaving notes out (R17-D)**: no other reader double-counts: `mpArrears` skips notes, `tdsReceivable` skips
  credit notes, `rcmOnlyNote` skips credit notes, the compliance hold list skips credit notes, `billedFor` signs credit
  notes negative and debit notes positive (V3 makes grouped notes follow their own lines).
- **Muster → payroll**: LOP = calendar days − Σ duties over locked musters, OT and extra-duty units; the push refuses a
  final month and keeps other units; rights `books.edit` + `payroll.view`, one audit row; the attendance row shape matches
  `normalizeAttendance`. Concurrent tabs: the bridge writes through `storage.ts` like the store (same cache / channel).
- **Period lock**: musters and compliance rows by the month's last day (save, lock, unlock), drafts / notes through
  `localDb.invoices.save`; the payroll run's own lock. **Dates**: no `new Date(<day>)` on a bare day in Round 17.
- **TDS FY boundary**: `expectedTds` aggregates within the FY of the document date; an arrears note dated in the next
  FY counts there.
- **Data layer**: `site_musters` / `site_compliance` in backup (record and id tables), sync (`date`), open-export
  schema, `TABLE_ACTIONS` / audit labels through `mp-registry` (every writer imports it). Alternate units: none in
  Round 17.

## 3. Statutory re-check (primary texts read in QA20)

| Rule | Read | Outcome |
|---|---|---|
| `SECURITY_RCM_RULES` 2019-01-01 | N 29/2018-CT(R) (gstcouncil.gov.in PDF): entry 14, provisos, para 2 (1 Jan 2019) | Agrees; stays verified |
| `BODY_CORPORATE_RULES` | N 13/2017 Explanation (b) ("Body Corporate" = Companies Act 2013 Sec 2(11)) in the GST Council's consolidated copy (UTGST twin, as amended to 25 Jan 2018). LLP Act 2008 Sec 3 not reachable (indiacode 403 / MCA 404) | Stays `verified: false` (LLP limb rests on the LLP Act) |
| `CONTRACT_LABOUR_THRESHOLD_RULES` 2025-11-21 (50) | OSH Code 2020 Sec 45(1)(i), (ii) — Gazette of India, Extraordinary, 29 Sep 2020 (PRS copy of the gazette) | Value agrees; commencement S.O. 5321(E) not reachable → stays `false`. New finding V9 (contractor limb) |
| `LABOUR_CODE_RULES` 2025-11-21 `ot_multiple: 2` | OSH Code Sec 27 ("twice the rate of wages in respect of overtime work") | Agrees; `wage_share` (Code on Wages Sec 2(y)) and the commencement not read → stays `false` |
| `MANPOWER_WORK_RULES` (tds-rules) | Enacted Finance Act 2026 text not found (Bill cl. 78 only, as in R17) | Stays `false` |
| `EDU_EXEMPT_RULES` | Amendments after 2017 not found in a primary copy | Unchanged |

No rule row was added or flipped.

## 4. Size

Before = `facb6c4` (`src/` of `fb0a031`), after = this branch; `vite build`, gzip -9 with chunk hashes stripped.

| Budget | Before | After | Delta |
|---|---|---|---|
| Initial JS (first paint) | 183,627 B (182.2 kB), 4 files | 183,627 B, 4 files | **0 B** |
| Core precache (English) | 3,135.3 kB | 3,136.9 kB | +1.6 raw (hash noise ±0.4) |
| `f-manpower` | 11,870 B | 12,468 B | +0.6 kB (strings for V8, V5 / V9 engines) |
| DeployDesk | 12,211 B | 12,493 B | +0.3 kB |
| `mp-payroll-io` | 1,205 B | 1,205 B | 0 |
| Hindi pack | 344.4 kB | 344.9 kB | +0.5 kB (V8 / V9 Hindi) |
| Hindi left in core / `lazy-leaves` | 21.4 / 16.8 kB | 21.4 / 16.8 kB | 0 |

## 5. Regression tests

`tests/qa20-manpower.test.ts` (V1–V9); `tests/mp-bill.test.ts` (the grouped plan now has a service-charge line per
site); `tests/mp-rules.test.ts` (engines may import a Round 17 area); e2e "R17-D" (the note's date and TDS).

## 6. CA questions

MP45 (agency-wide contract-labour licence), MP46 ★ (arrears note date and TDS), MP47 (bills of several sites: line
cost centres, service charge per site), MP48 (no unlock after billing / final run; paisa-exact apportionment) in
`docs/CA_REVIEW.md` §17 (total 611 → 615).
