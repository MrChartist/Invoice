# Round 17 — security, facility-management and manpower-supply agencies

Spec: `docs/prd/round-17.md`. One section per package; each records its bundle numbers (gzip -9, KiB, the method of
`scripts/check-bundle-size.mjs`) and the `f-manpower` chunk. Working papers — verify with your CA (`docs/CA_REVIEW.md`
§17, MP1–MP44).

## §A — R17-A: manpower core (A1–A4)

### What shipped

| Item | Where |
|---|---|
| A1 profile | `SERVICE_KINDS` / `ServiceKind` gain `manpower`; settings `manpower_kind` (`security`, `facility`, `staffing`, `labour`, `other`). `shop-presets.ts` `MANPOWER_KINDS`, `MANPOWER_LANDING`, `applyManpowerKind(kind, { registered, currentPacks })`: business type `services`, `service_kind: 'manpower'`, modules services + payroll, accounts, banking, tds, recurring, purchases, time (`registered` adds `gst`), packs in union (`manpower`; + `security` for a security agency), due days 7, template `gst_tax_invoice`. Packs `manpower` / `security` (`PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE`, `PACK_ROUTES` unchanged). Object `manpower_settings` (`manpower/mp-settings.ts`: owner only, audited, synced as a singleton, backed up; unknown B–D keys kept; the whole shape of every package is typed in `types/manpower-r17.ts`). Profile defaults `manpowerDefaultsFor` (12-hour shifts for security, else 8; calendar pro-rata; month-end bill date; service charge 0). Wizard: Services → "Security, housekeeping and manpower supply" → `ManpowerKindPicker` with the firm form (written as the annual pack's entity type through R14 `writeFirmForm`, never a second field); Settings → Features "Manpower profile" for every services company (+ Custom); Features row `adv.manpowerProfile`. Checklist (only with `manpower_kind`): `firstSite`, `firstBill` (invoices with `mp.month`). Demo: `demo/profile-manpower.ts` (packs `manpower` / `security`): Sunrise Towers (4 guards 12 h + 1 supervisor) and Green Park RWA (2 guards + 1 housekeeper). |
| Build | `vite.config.ts` row `safeFamilyGroup(graph, 'f-manpower', familyRe('manpower', 'manpower-rules', 'manpower-r17', 'mp-registry'), 12)` (pinned in `tests/bundle-config.test.ts`; `familyRe`'s new optional `except` keeps the registry a lazy leaf, see Bundle); `MP` in the CA-id regexes of `help-registry`, `help-glossary`, `docs-links` (with an `MP1` / `P1` case); `manpower/mp-shared.ts`, `manpower/mp-registry.ts` (imported by `sync-engine.ts`, `trust/recycle-bin.ts`, every writer); `manpower-rules.ts` (sections R17-A / C / D); record key **`mp`** (`R17_RECORD_KEYS`, spread into `R9_RECORD_KEYS`; no line key). |
| A2 sites | A site IS a project cost centre with `CostCentre.mp` (`SiteInfo`: code, address, State, contract from / to / ref / escalation, posts ≤ 30, bill group, status; `cost-centres.ts` keeps `mp`, one line). `manpower/mp-sites.ts` (pure / raw reads): `loadSites`, `siteLabel`, `suggestSac` (`MP_SAC_RULES`, MP5), `suggestSiteCode` (`S-<seq>`), `validateSite`, `cleanSite`, `monthValue`, `endsSoon`. Bridge `mp-sites-io.ts`: `saveSite` (`doc.create`; closed → `done`, paused → `on_hold`), `saveClientMp` (`Client.mp`: `gst_tds_only`, `composition`, `school`; `tds` typed for B4 / D2). `normalizeEmployees` keeps `Employee.mp` (one line) for B–D. |
| A3 regime | `manpower/mp-regime.ts` (pure; `firmForm()` reads the annual pack's entity type): `postRegime` / `mpRegime` (`split` for mixed posts) / `splitPosts` / `forcedRegime` / `mpRegimePatch`. Rules `MP_GST_RATE_RULES`, `SECURITY_RCM_RULES`, `BODY_CORPORATE_RULES`, `EDU_EXEMPT_RULES`, `RCM_ONLY_REG_RULES`. The patch writes the existing `reverse_charge` / `rcm_tax_excluded` and the R10 line key `sv.exempt`; no GST reader changed (test: GSTR-1 B2B `rchrg: 'Y'`, e-Invoice `RegRev: 'Y'`, Table 8 exempt). Editor: lazy `ManpowerRows` (packs on) — site, service month, regime auto / override with a reason (`mp.regime_note`). |
| A4 paper | Lazy `parts/ManpowerBlock.tsx` (+ `manpower-paper.module.css`, template variables only) after `TravelBlock`, before `GstBody`, never on receipt paper: site, service month, post summary (≤ 12 rows), the regime sentence — from `mp` only (`manpower/mp-print.ts`). `paper-helpers.ts` `mpLineText` (after `tvLineText`, in `trackingText`). |
| Desk | `TIME_TABS` row `deploy` (pack `manpower`, also `security`); `Time.tsx` mounts `components/manpower/DeployDesk.tsx` through `import.meta.glob('../components/manpower/*Desk.tsx')`. View `sites`: list (client, posts, heads, value a month at 30 duties, contract end red within 30 days, regime chip) and the site form (`SiteForm.tsx`: posts grid, contract, client flags). Shared UI `mp-ui.tsx` (`Field`, `RegimeChip`, `MpViewProps`). |
| Help / Ctrl+K | Topics `time:deploy`, `time:deploy:sites` (MP ids); Ctrl+K `time.deploy`; palette `r17.deploy`, `r17.deploy.sites`; synonyms; `PACK_TABS` rows (desk + sites). Strings `i18n/areas/manpower-r17a.ts` (shared words for B–D: site, post, duty, muster, shift, reliever, service charge, client, month, compliance; lists as comma strings read by `mpList`) and `manpower-r17a-pick.ts` (the picker, kept out of the family chunk). Every `defineArea` passes a literal Hindi object. |
| Tests / e2e | `mp-profile`, `mp-registry`, `mp-rules` (import graph, family chunk after a build, verified set), `mp-pack-gate`, `mp-sites`, `mp-regime`, `mp-print`; `industry-packs`, `features-catalog` updated. E2E step "R17-A manpower core". |

### API for R17-B / C / D

- **Types** (`types/manpower-r17.ts`, add only inside your `// R17-x` block): `MpSnapshot.muster_id` / `annex` / `tds` (B),
  `comp` (C), `arrear` (D); `MpPostRow.duties` / `amount` / `line_id` / `site` (B fills them; the paper and `mpLineText`
  already print them); `ManpowerSettings.extra_duty_type_id` / `costplus` / `print_tds` (B), `wage_revisions` (C),
  `licences` / `arrears_doc` (D); `PurchaseRecord.mp.site_id` (C); `Employee.mp.guard_licence` (D). No record or line keys.
- **Names / registry**: add `musters: 'site_musters'` (B) / `compliance: 'site_compliance'` (C) to `MP_TABLES` and
  `MP_DATED`, rows in `mp-registry.ts` (your block), `import './mp-registry'` in every writer; backup / sync / open-export
  rows in `// R17-B` / `// R17-C` blocks.
- **Sites**: `loadSites()`, `siteLabel`, `monthValue`, `MP_BASES` (`mp-sites.ts`); `saveSite`, `saveClientMp` (`mp-sites-io.ts`).
- **Regime**: `postRegime(sac, ctx)`, `splitPosts(posts, ctx)` (one invoice per group), `mpRegimePatch(record, result,
  note?)`; ctx = `{ date, entityType: firmForm(), client }` with the client's master row (for `Client.mp`).
- **Deploy (A2 criterion 5, moved to B)**: B creates `mp-payroll-io.ts` (the only importer of the payroll store) with the
  attendance push and "Deploy" (`saveEmployee({ ...e, cost_centre_id, mp: { post_id } })`), and its list in `SiteForm`.
- **Desk**: add one entry per view to `DeployDesk.tsx` `VIEWS` (`lazy(() => import('./XView'))` or static, as R15-C
  measured), its `PACK_TABS` row with an `r17.deploy.<view>` label in `palette-destinations.ts`, a help topic
  `time:deploy:<view>`, Ctrl+K text appended to `time.deploy`. Checklist steps go into `MP_STEPS` (`checklist-steps.ts`).
- **Paper**: add `parts/manpower/*.tsx` parts and mount them inside `ManpowerBlock` (B: duty annexure page).
- **Payroll**: B creates `mp-payroll-io.ts`; C appends `readRunForMonth`.

### Deviations (R17-A)

- **Cut 1 applied** (PRD §3 / §11): no per-employee annexure page in A — B's `parts/manpower/DutyAnnex.tsx` owns it.
- **Fewer files:** the profile defaults live in `mp-settings.ts` (no `mp-profile.ts`); `suggestSac` lives in
  `mp-sites.ts` (no `mp-sac.ts`). Writing sites is the bridge `mp-sites-io.ts` (it reaches `cost-centres.ts`, which is
  not first paint), so bridges are `mp-sites-io` (A) + B's `mp-payroll-io`, `mp-draft-io`, `mp-tds-io` = 4.
- **Deployed list / "Deploy" (A2 criterion 5) moved to B**, with the payroll bridge B owns: importing the payroll store
  from the desk split the shared payroll chunk (+0.4 kB) and put A over its cap. The client's TDS section / deductee
  selects (B4 / D2 data) are left to B / D; the type is declared.
- **Posts grid**: a plain table, not `LinesGrid` (that grid edits stock-item lines).
- **`PACK_TABS`**: only A's desk and `sites` rows (B–D add theirs with their views — no stubs; the R14 / R15 precedent).
  The wizard landing for `staffing` / `labour` is `view=muster`, which falls back to `sites` until B merges.
- **Checklist**: A adds `firstSite` and `firstBill`; `firstMuster` (B), `compliance` (C), `licence` (D) are theirs.
- **Regime override**: audited with the document's own save (the reason is snapshotted in `mp.regime_note`); no
  separate audit row. An override chosen without a reason stores "chosen in the editor".
- **Demo**: Green Park RWA uses a base demo client (which has a GSTIN): its guards therefore show RCM, its housekeeper
  forward charge. The base dataset's clients are not extended (`clients` is not a `DEMO_EXTRA_TABLES` table).
- **E2E**: the profile is picked in Settings → Features (as R15-B), not through a fresh company's wizard.

### Bundle (R17-A)

Before = `claude/elegant-cannon-cwapiv` at `a188df9` (QA19 merged), after = this branch; `vite build` + gzip -9. Normalized
= chunk hashes stripped before gzip (two builds differ by ≈ 1 kB raw from hashed names alone).

| Budget | Before | After | Delta | Cap |
|---|---|---|---|---|
| Initial JS (first paint) | 186,513 B (182.1 kB) | 186,541 B (182.2 kB) | **+28 B** (entry preload map only: order of `lazy-leaves` / `vendor-ui` in a dependency list; no new file, no Round 17 code) | 0 ✗ (display rounds 182.14 → 182.17) |
| Entry chunk | 88.1 kB | 88.2 kB | same +28 B | — |
| Core precache (English) | 3,102.7 kB | 3,114.0 kB | +11.3 raw; **+10.6 kB normalized** | 11 kB ✓ |
| Hindi pack | 340.6 kB | 342.4 kB | +1.8 kB (`lang-hi-manpower` 1.35 kB + wiring areas) | 8 kB ✓ |
| Hindi left in core | 21.3 kB | 21.3 kB | 0 | 0 ✓ |
| `lazy-leaves` | 16.1 kB | 16.6 kB | +0.48 kB (`demo/profile-manpower.ts`, `manpower/mp-registry.ts`) | 0.5 kB ✓ |

Chunks (normalized gz): `f-manpower` 3.5 kB (rules, regime, sites, print, shared, `manpower-r17a` English), DeployDesk
2.8 kB (desk, sites view, site form, `mp-sites-io`, `mp-ui`), ManpowerRows 1.2 kB, ManpowerBlock 0.6 kB, `mp-settings`
0.55 kB (shared by the wizard / Features and the family), wiring 2.0 kB (picker + its area 0.26 in the wizard's picker
chunk, help 0.18, wizard 0.16, presets 0.15, checklist 0.14, Time 0.13, TemplateEngine 0.13, palette / Ctrl+K 0.2,
editor 0.09, Features 0.07, the rest < 0.07 each).

First paint: the registry is excluded from the family (`familyRe(…, 'mp-registry')`) because `sync-engine.ts` and
`trust/recycle-bin.ts` import it statically — inside `f-manpower` it made every sync run load the whole family chunk
and added the chunk's file name to the entry's preload map (+38 B). As a leaf it adds no file; the remaining +28 B is
the dependency order of one map entry. Not reduced further without dropping the registry import from those two lazy
writers (AGENTS.md rule) — the lead may accept it as R15-B's +24 B was.

## §B — R17-B: duty register and billing (B1–B4)

### What shipped

| Item | Where |
|---|---|
| B1 muster | Table **`site_musters`** (`MP_TABLES.musters`; `doc.create`; watched — label "Site muster", entity `cost_centre`; backed up, synced and period-locked by `date` = the month's last day; open-export row): `{ id, site_id, month, date, rows: { employee_id, post_id, duties, ot_hours?, relief?, note? }[] (≤ 300), status: 'draft' \| 'locked', locked_at?, updated_at }`, one per site × month (a second is refused). Pure `mp-muster.ts` (`daysIn`, `monthEnd`, `prevMonth`, `loadStaff` — raw `employees` rows —, `loadMusters`, `musterOf`, `deployedAt`, `copyRows`, `postTotals`, `musterWarnings`, `validateRows`); writer `mp-muster-save.ts` (`saveMuster`, `setMusterLock`, `logMusterImport` → `import_runs` kind `muster`). Import `mp-muster-import.ts` (`mapMusterTable`: fixed template `employee_code, duties, ot_hours, post` or a day-wise sheet P / H / HD / DD / A + `OT<n>` columns; unknown codes listed). View `MusterView.tsx` (`view=muster&site=&month=`). Checklist step `firstMuster`. |
| B2 payroll | Pure `mp-attendance.ts` (`attendancePush`, `unlockedSites`); bridge `mp-payroll-io.ts` (`previewPush`, `pushAttendance`, `deployEmployee`). The push writes only the musters' people, keeps their other units, and is refused once the month's run is final. "Deployed staff" (Deploy / Release) on a saved site's form. |
| B3 bills | Pure `mp-bill.ts` (`billDate`, `postLines` per basis, `billPlans` grouped per site or client + `bill_group`, split by `splitPosts`, `billsOf`); bridge `mp-draft-io.ts` (`planMonth`, `billMonth(month, siteIds?, again?)`) → drafts through `buildBillDraft` with `mpRegimePatch`. `mp` = `{ site (one site), month, basis, regime, decl, posts (with duties / amount / line_id / site), muster_id, muster_ids (grouped), annex }`. View `BillsView.tsx` (`view=bills&month=`) with the billing settings (billing days, bill date, service charge, extra-duty type, cost-plus %, print TDS). Paper part `templates/parts/manpower/DutyAnnex.tsx` (annexure: name, code, post, duties, OT). |
| B4 TDS | Bridge `mp-tds-io.ts`: `clientTds` (R14 `expectedTds`, 194C default, rate by our firm form, label by date with `MANPOWER_WORK_RULES`) → `mp.tds`; `mp.tds_print` from "Print expected TDS" (paper line); `gstTdsHint` (`GST_TDS_51_RULES`, TDS-only Government client, never RCM) reported after billing. |
| Help / Ctrl+K | Topics `time:deploy:muster`, `time:deploy:bills`; `PACK_TABS` rows; palette `r17.deploy.muster`, `r17.deploy.bills`; Ctrl+K text appended to `time.deploy`; synonyms. Strings `i18n/areas/manpower-r17b.ts` (literal Hindi). |
| Tests / e2e | `mp-muster`, `mp-attendance`, `mp-bill` (incl. GSTR-1 B2B `rchrg: 'Y'`, e-Invoice `RegRev: 'Y'`, 18 % forward bill, volume), `mp-tds`; `mp-registry` (B block), `mp-profile` (step). E2E step "R17-B duty register and billing". |

### API for R17-C / D

- `loadMusters(month)`, `musterOf`, `daysIn`, `monthEnd`, `loadStaff` (`mp-muster.ts`); locked musters are the source of
  duties per person × site × month (C2 apportions employer PF / ESI by them, MP26).
- `billsOf(invoices, musterId)` (`mp-bill.ts`): the month's bills of a site (C2 billing, D1 arrears `mp.arrear.of`).
  `postLines(site, post, muster, settings, newId)` gives the value of a post for a month (D1 recomputes at the revised rate).
- `mp-payroll-io.ts`: C appends `readRunForMonth` — read `payroll_runs` raw (as `pushAttendance` does) rather than
  importing `payroll/store.ts` (see Deviations).
- `clientTds(client, date, base, invoices, ourForm)` (`mp-tds-io.ts`) for D2 / a debit note's expected TDS.
- `planMonth` / `billMonth` (`mp-draft-io.ts`) and the `mp` snapshot keys above. Desk views are static imports in
  `DeployDesk.tsx` (one chunk).

### Deviations (R17-B)

- **No payroll-store import.** `mp-payroll-io.ts` writes `attendance` / `employees` by the store's rules (rights
  `books.edit` + `payroll.view`, final-run refusal, `normalizeAttendance` row shape, audit row) through `storage.ts`.
  Importing `payroll/store.ts` split the shared payroll chunk (`shared` 30.3 → 9.3 + `store` 21.4 kB, +0.37 kB) and
  changed the entry's preload map (+4 B first paint). Tests read the result back through the store.
- **Drafts through `buildBillDraft`** (R3-B / R15-B), not CN-D2 `draftInvoice`: it sets the place of supply and GST mode
  from the client and takes the reverse-charge fields before totals are worked out.
- **Writers in their own file** (`mp-muster-save.ts`): a module that imports the registry cannot join `f-manpower`, so
  the pure muster engine stays in the family and the writer sits in the desk chunk.
- **Grid**: a plain table (as A), not `LinesGrid`. **Cost-plus** wages come from the post's rate per duty; the
  finalised-run apportionment is C's (C1 bridge). **Deductee** (1 % / 2 %) follows our firm form (`firmForm()`), not
  `Client.mp.tds.deductee`.
- **Grouped bills** carry `mp.muster_ids` (B's sub-field) besides `muster_id`; `site` only on a one-site bill.
- **Demo**: no sample musters (they need sample employees); the Demo company's sites are A's.
- **Views static** in `DeployDesk.tsx` (one chunk, −2.3 kB against two lazy views + a split `mp-ui` chunk).

### Bundle (R17-B)

Before = `claude/elegant-cannon-cwapiv` at `72178a1` (R17-A merged), after = this branch; `vite build` + gzip -9;
normalized = chunk hashes stripped.

| Budget | Before | After | Delta | Cap |
|---|---|---|---|---|
| Initial JS (first paint) | 182.2 kB | 182.2 kB | **0 B** (entry identical after normalizing) | 0 ✓ |
| Core precache (English) | 3,114.0 kB | 3,124.5 kB | +10.5 raw (hash noise ±0.4); **+9.4 kB normalized** | 12 kB ✓ |
| Hindi pack | 342.4 kB | 343.1 kB | +0.7 kB (`lang-hi-manpower` 1.35 → 2.04) | — |
| Hindi left in core | 21.3 kB | 21.3 kB | +8 B (two help-topic Hindi titles) | 0 ✓ (display) |
| `lazy-leaves` | 16.6 kB | 16.7 kB | +32 B (registry rows) | — |

Chunks (normalized gz): `f-manpower` 3.5 → 6.9 kB (muster / attendance / import / bill engines, `manpower-r17b`
English), DeployDesk 2.8 → 7.0 kB (+ Muster / Bills views, muster writer, deploy list, draft / TDS bridges),
`mp-payroll-io` 0.9 kB (lazy, on "Send to payroll" / "Deploy"), ManpowerBlock 0.57 → 0.78 kB (annexure + TDS line),
wiring 0.6 kB (help 0.16, Ctrl+K 0.09, open export 0.09, palette 0.03, checklist / reach / packs 0.07).

## §C — R17-C: compliance and profitability (C1–C3)

### What shipped

| Item | Where |
|---|---|
| C1 compliance pack | Table **`site_compliance`** (`MP_TABLES.compliance`; `doc.create`; watched — label "Site compliance", entity `cost_centre`; backed up, synced and period-locked by `date` = the month's last day; open-export row): `{ id, site_id, month, date, pf: { trrn?, paid_on?, amount? }, esi: { challan?, paid_on?, amount? }, attachments?, status: 'pending' \| 'proved' \| 'waived', hold?: { pct?, amount?, invoice_id? }, updated_at }`, one per site × month. Pure `mp-compliance.ts` (`siteShares`: each muster row × the month's FINAL run line × site duties ÷ the person's duties across all sites; `sumShares`, `employerCost`, `pfDue`, `esiDue`, `proofError` — proved needs the TRRN and, when ESI is due, the challan; `uan4`; `holdOf`); writer `mp-comp-save.ts` (`loadCompliance`, `saveCompliance`). `mp-payroll-io.ts` `readRunForMonth` reads `payroll_runs` raw (final runs only). View `ComplianceView.tsx` (`view=compliance&site=&month=`): shares table (name, code, UAN last four, duties, gross, PF wages, PF EE, EPF ER, EPS, ESI EE / ER, deductions, net) with totals, TRRN / challan / paid-on, status, the client's hold (% or ₹) shown against the month's bills ("release expected once proved"; nothing posts), annexure print window (`escHtml`; the same table = wage-register and ECR extract; the MP18 sentence; no bank field is ever read). Checklist step `siteProof`. |
| C2 site P&L | Pure `mp-profit.ts` (`billedFor`, `siteProfit`): billed = taxable value of the service month's documents naming the site (`mp.site`, or a grouped bill's post rows), debit notes in, credit notes out; wages / relievers / employer PF + ESI from the C1 shares; site-tagged purchase bills; margin and margin %. `mp-sites-io.ts` `siteBills(month)` reads `purchases` through `readPurchase` (taxable + tax when no ITC; void out; purchase contract test). Bill form: lazy `SitePick` row (packs `manpower` / `security`, or a tagged bill) writing `PurchaseRecord.mp = { site_id }`. View `ProfitView.tsx` (`view=profit&month=`). |
| C3 checks | Pure `mp-wage-check.ts`: `revisionFor` (latest `from` ≤ month start, matching post name / zone / skill, most specific first), `minPerDuty` (monthly minimum ÷ 26), `otPay`, `shortfalls` ((gross − OT) ÷ all duties vs the minimum; owed = shortfall × site duties), `labourHints` (OT below 2 ×, PF wages under half, fixed-term past a year, ≥ 20 / 50 workers without an OSH / contract-labour licence). Rules `LABOUR_CODE_RULES`, `CONTRACT_LABOUR_THRESHOLD_RULES` (`verified: false`). Wage revisions are typed in the compliance view (owner). Warnings only. |
| Help / Ctrl+K | Topics `time:deploy:compliance`, `time:deploy:profit`; `PACK_TABS` rows; palette `r17.deploy.compliance`, `r17.deploy.profit`; Ctrl+K text appended to `time.deploy`; synonyms. Strings `i18n/areas/manpower-r17c.ts` (literal Hindi). |
| Tests / e2e | `mp-compliance`, `mp-profit` (incl. volume), `mp-wage-check`; `mp-registry` (C block), `mp-profile` (step), `purchase-contract` (`siteBills`). E2E step "R17-C compliance and profitability". |

### Deviations (R17-C)

- **No new bridge**: the purchase read sits in the existing `mp-sites-io.ts` (bridges stay 4); the run read in `mp-payroll-io.ts`.
- **One table** on the annexure doubles as the wage-register extract (gross / deductions / net) and the ECR extract (PF
  wages, EE, EPF ER, EPS) — built from the run lines, not from `payroll/reports.ts` `pfEcrRows` (that would import the
  payroll chunk). **No attachments UI** (the `attachments` field is typed; the existing attachments feature is not wired).
- `mp.comp` is not written on bills (the proof usually follows the bill); the compliance row is the record.
- **Rule rows are all `verified: false`**: the PIB / Code texts were read by the PRD author, not re-read in this package.
- Hints use proxies (8-hour ordinary day, PF wages as "wages", a set leaving date as fixed-term) — MP39.

### Bundle (R17-C)

Before = `claude/elegant-cannon-cwapiv` at `b3848cc` (R17-B merged), after = commit `b996116`; `vite build` + gzip -9;
normalized = chunk hashes stripped.

| Budget | Before | After | Delta | Cap |
|---|---|---|---|---|
| Initial JS (first paint) | 182.2 kB | 182.2 kB | **0 B** normalized | 0 ✓ |
| Core precache (English) | 3,124.5 kB | 3,130.2 kB | **+5.8 kB normalized** | 9 kB ✓ |
| Hindi pack | 343.1 kB | 343.9 kB | +0.7 kB (`lang-hi-manpower` 2.0 → 2.7) | — |
| Hindi left in core | 21.3 kB | 21.4 kB | help-topic Hindi titles (allow-listed `topics-*`) | — |
| `lazy-leaves` | 16.8 kB | 16.8 kB | +21 B | — |

Chunks (normalized gz): `f-manpower` 6.9 → 9.1 kB, DeployDesk 7.0 → 9.4 kB, `SitePick` 0.4 kB (bill form, lazy),
`mp-payroll-io` 0.9 → 1.0 kB, wiring ≈ 0.4 kB.

## §D — R17-D: arrears, receivables and renewals (D1–D4)

### What shipped

| Item | Where |
|---|---|
| D1 arrears | `WageRevision.delta_day` / `to` / `site_ids` (D block). Pure `mp-arrears.ts`: `deltaFor` (typed increase, else new minimum − the previous matching one), `passesThrough` (`vda_pass_through` or ticked), `postArrear` (duty: duties × increase; hour / month / cost-plus: `postLines` at the revised rate − the original, cost-plus % following), `mpArrears` (one note per original bill of a month in the revision's range; service-charge line when the bill had one; `raised` derived from `mp.arrear`), `staffArrears` (what is owed to staff, all sites; link to Payroll → Arrears, no payroll write). Bridge `mp-draft-io.ts` `planArrears` / `makeArrears`: **`createDebitNote`** (DBN, dated today, `doc_links` `debit_note`) on a copy of the original with `mp = { site, month, basis, regime, decl, posts, arrear: { rev_id, from, to, of }, arrear_rows }` (no `muster_id`, TDS fields cleared) — reverse charge / `rcm_tax_excluded` carried, line SAC and rate from the original, `sv.exempt` on a Sl. 66 note; `mp.tds` = `clientTds` on the note. `arrears_doc: 'invoice'` makes a draft supplementary invoice through `buildBillDraft` instead. `billsOf` now leaves credit / debit notes out (a credit note copies the snapshot). |
| D2 TDS receivable | Pure `mp-tds-recv.ts` (`fyQuarter`, `tdsReceivable`): per client × FY quarter (bill date) — bills, taxable, expected (`mp.tds` snapshots), booked (`tds_amount`), difference, section label. The R14 Form 16A / 131 chase list and letter (`components/prof/TdsChasePanel`, lazy) below it. |
| D3 licences | `manpower_settings.licences` (PSARA per State, OSH, contract labour, trade, other) added / removed in the view; guards' licences through `mp-payroll-io.ts` `setGuardLicence` (`Employee.mp.guard_licence`). `mp-alerts.ts` (`mpAlerts` pure, `mpNotices` provider) — 60 / 30 / 7 days (`VDA_REVISION_RULES.alert_days`), expired = critical, PSARA only with `security`, site contract ends, the VDA month reminder (April / October) until a revision of the month is typed. `NotificationBell.tsx`: one `gate('manpower', '-', …)` row registering `mpNotices` (lazy, explicit pack). Checklist step `licence` (security / labour kinds). |
| D4 notes | `mp-regime.ts` `regimeNotes` (`pf8`: an RCM bill of an agency without a GSTIN → the regime chip shows the pending `rcm_self` note through `PendingNote`) and `rcmOnlyNote` (every manpower bill of the 12 months reverse charge → the N 5/2017-CT note at the top of the statutory view). |
| View / help | `StatutoryView.tsx` (`view=statutory`): arrears, TDS receivable, licences. Topic `time:deploy:statutory`; `PACK_TABS` row; palette `r17.deploy.statutory`; Ctrl+K text; synonyms. Strings `i18n/areas/manpower-r17d.ts` (literal Hindi). |
| Tests / e2e | `mp-arrears` (bases, dates, pass-through, DBN + `doc_links` + reverse charge + GSTR-1 CDNR `D` / `Y`, already raised, supplementary invoice, staff side), `mp-tds-recv`, `mp-alerts`, `mp-regime` (D4 notes), `mp-profile` (step). E2E step "R17-D arrears, receivables and renewals". |

### Deviations (R17-D)

- **`pending-changes.ts` unchanged**: PF8 already exists with area `rcm_self`; the chip mounts `PendingNote area="rcm_self"`
  (there is no per-screen id list to append to). No new pending row (the test requires PIB 8 Oct 2026 sources).
- The arrears revision form takes the **increase per duty** (the PRD user story); a minimum typed in the compliance view
  also works (new − previous). Sites without `vda_pass_through` are ticked on the revision (`site_ids`).
- The debit note's expected TDS uses R14's threshold test; an original dated after the note's date is not counted
  in the client's FY total (as for any bill).
- `VDA_REVISION_RULES` also carries the alert windows (60 / 30 / 7), `verified: false`.
- The RCM-only note shows on the statutory view, not on the Features profile panel (that panel is a shared chunk).

### Bundle (R17-D)

Before = commit `b996116` (R17-C), after = this branch; `vite build` + gzip -9; normalized = chunk hashes stripped.

| Budget | Before | After | Delta | Cap |
|---|---|---|---|---|
| Initial JS (first paint) | 182.2 kB | 182.2 kB | **0 B** normalized | 0 ✓ |
| Core precache (English) | 3,130.2 kB | 3,135.3 kB | **+5.5 kB normalized** | 7 kB ✓ |
| Hindi pack | 343.9 kB | 344.4 kB | +0.5 kB (`lang-hi-manpower` 2.7 → 3.1) | — |
| Hindi left in core | 21.4 kB | 21.4 kB | 0 | 0 ✓ |
| `lazy-leaves` | 16.8 kB | 16.8 kB | 0 | — |

Chunks (normalized gz): `f-manpower` 9.1 → 11.6 kB (arrears / TDS receivable / alerts engines, `manpower-r17d`
English), DeployDesk 9.4 → 11.9 kB (statutory view, `makeArrears`), `mp-payroll-io` 1.0 → 1.2 kB, wiring ≈ 0.3 kB.
Round 17 C + D together: **+11.3 kB** core (caps 9 + 7).
