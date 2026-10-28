# Round 11 — construction (feature notes and the API for CN-B / CN-C / CN-D)

PRD: `docs/prd/round-11.md`. CA items: `docs/CA_REVIEW.md` §11 (CN1–CN28). Every GST / TDS / cess figure here is a
working paper — verify with your CA. One section per package; each package records its own bundle numbers.

## CN-A — Construction profile and the bill paper

### What shipped

| Item | Where |
|---|---|
| A1 profile | `construction_kind` (settings, additive) under business type `contractor`: civil, subcontractor, builder, interiors, mep, labour, other. `shop-presets.ts` `CONSTRUCTION_KINDS` / `CONSTRUCTION_PROFILES` / `applyConstructionKind(kind, { registered })`; switches in `construction/cn-profile.ts` (`constructionSwitchesFor`, `applyConstructionSwitches(kind, { government })`) written to the company object `construction_settings` (`cn-settings.ts`, owner only, audited, backed up, synced as a singleton). Picker `components/construction/ConstructionKindPicker.tsx` in the setup wizard and Settings → Features (+ "Custom"; the government question for civil / sub-contractor / MEP). Pack `realty` (`industry-packs.ts`), Features rows `pack.realty` and `adv.construction`. Checklist steps `constructionProfile`, `contract`, `boq`, `realtyProject`, `units`, `paymentPlan`, `labourContract`. `PACK_OF_TYPE` / `PACK_ROUTES` unchanged — existing contractor companies see what they saw. |
| A2 tax classes, PoS = site | `construction/cn-tax.ts` (`classRate`, `rateDiffers`, `suggestedRate`, `worksPlaceOfSupply`, `otherStateNotice`, `mixedSupplyInstall`, `reclassAsWorks`); `construction-rules.ts` `WORKS_CLASS_RULES` (CN1 default: government / earthwork / sub-contract 18% from 2025-09-22, `verified: false`). `saveRaBill` sets the bill's place of supply to the site State (contract → BOQ `boq_terms.header.site` / `boq_terms.site`) and re-derives IGST / CGST + SGST. Declarations (`cn-print.ts` `worksDeclarations`) print on works documents. |
| A3 contract particulars | Snapshot `boq_terms.cn.header` (`cnHeaderSnapshot`) written by `saveRaBill` through one call (`cn-snapshot-io.ts` `raSnapshotFor`); line snapshot `boq_terms.cn.lines[lineId]` (`ref`, `mb`, `cls`, `kind`, `approval`, `substitutes`, BOQ / previous / cumulative qty and amount). Paper: `WorksHeaderBlock` (contract box), `worksLineText` sub-line under every line in both item tables, RA title "Tax Invoice — Running Account Bill No. n" / "— Final Bill" (`raDocTitle`), "Site" instead of "Ship to". Editor: lazy `creator/ContractPanel.tsx` (DocumentMetaCard; works pack on, or a document with the snapshot / an RA number). Measurement form: period from / to, date of measurement, MB per line (already) reaching the bill. |
| A4 abstract | `cn-abstract.ts` (`buildAbstract`, `deviationSplit`, `splitDeviation`, `deviationWarnings`, `itemKind`), `cn-sections.ts`. Snapshotted at save in `boq_terms.cn.abstract`; printed as the following page `WorksAbstractPage` (sections A BOQ / B extra / C substituted / D deviation with sub-totals, then gross, GST, deductions, net payable). Quantity beyond BOQ × (1 + deviation %) (default 25%, `DEVIATION_DEFAULTS`; contract → BOQ `deviation_pct` → settings) becomes a `-d` "Deviation — …" line; the measurement form warns. Line classes `extra` / `substituted` (approval, replaced item no.) on the measurement form. "Recompute abstract" on the RA register re-snapshots DRAFT bills only (`recomputeDraftSnapshot`). `pwd` paper: `RaItemsTable` replaces the item table on non-gst layouts. The standalone RA register abstract gained the MB column. |
| A5 deductions | `WorksDeductionsBlock`: `ra_deductions` grouped Statutory / Recoveries / Held / Other (`cn-print.ts` `DEDUCTION_GROUP` covers the six CN-B kinds), bill amount, total deductions, **Net payable** (from `ra_net_payable`) in figures and words (Hindi on bilingual paper), notes (GST on the full value; GST TDS u/s 51; labour cess), declarations, contractor's certificate (`DEFAULT_CERTIFICATE`, settings text) and, with `signoff_boxes`, "Measured by / Checked by / Passed for payment". `FooterBlocks` skips "Less: TDS" / its balance line for documents with `ra_deductions` (IT TDS printed once). |

All paper parts are one lazy chunk (`parts/WorksPaper.tsx`), mounted by `TemplateEngine` only when the document has
`boq_terms.cn` or `ra_no`, never on receipt paper; the PDF, share link and print copies render `TemplateEngine`, so they
carry the same paper and page 2. Paper strings: `i18n/areas/construction-r11-paper.ts`; UI strings:
`construction-r11a.ts`; picker: `construction-r11-pick.ts`.

### API for CN-B / CN-C / CN-D

- **Types** (`src/types/construction-r11.ts`, one block per package): `CnSnapshot` (`boq_terms.cn`) with `header`,
  `lines`, `abstract`, `paper`, `certificate`, `deviation_pct` (A) and `pv` (B, `CnPvSnapshot`), `jv` (B), `demand`
  (C, `CnDemandSnapshot`) — fill your sub-object's fields in your block. `ConstructionSettings` (switches; `views` per
  `CnWorksView`). `BoqTerms.site` / `header` / `deviation_pct`. `RaDeductionKind` gained `secured_advance`,
  `material_recovery`, `water_power`, `hire_charges`, `advance_interest`, `withheld` (labels in `DEDUCTION_LABELS`,
  print groups in `DEDUCTION_GROUP`; their maths and `DEDUCTION_KINDS` rows are CN-B's).
- **Contract → bill header (B1):** rows of table `works_contracts` with `boq_id` (or `boq_ids`) and the `ContractLike`
  fields (`name_of_work`, `agreement_no` / `_date`, `work_order_no` / `_date`, `tender_ref`, `client_office`,
  `engineer`, `site { address, state_code }`, `contract_value`, `stipulated_start` / `_completion`,
  `extended_completion`, `deviation_pct`, `jv_note`) are read by `contractOfBoq` and win over the BOQ's typed header in
  `cnHeaderSnapshot`; the site's State becomes the bill's place of supply.
- **Registry:** `construction/cn-registry.ts` — add your tables to `CN_TABLE_ACTIONS` / `CN_WATCHED` in your block and
  `import './cn-registry'` in every writer. **The first package that adds a table also adds
  `import './construction/cn-registry';` to `sync-engine.ts` and `import '../construction/cn-registry';` to
  `trust/recycle-bin.ts`** (CN-A has no table; adding them in A cost +54 B on first paint through the entry's preload
  map — see Budget) and extends `tests/cn-registry.test.ts`.
- **Rules:** `construction-rules.ts` sections `// CN-B` … `// CN-D` (rows `CnRule<T>` = `Versioned<T> & { verified }`).
- **Paper:** export `PvWorkingPage` (B) / `DemandBlock` (C) from `parts/WorksPaper.tsx` (placeholders return null);
  `TemplateEngine` already mounts them when `boq_terms.cn.pv` / `.demand` is set. Keep paper parts free of imports that
  the preview chunk also uses (pass helpers as props, as `RaItemsTable` / `WorksDeductionsBlock` do) or a new shared
  chunk appears.
- **Works views:** append your view ids to `VIEWS` in `WorksTab.tsx` with a lazy mount; list a view when
  `worksViewOn(readConstructionSettings(), view)` (or it is the current view). The profile already switches the views
  on (`CONSTRUCTION_SWITCHES`). Add its `PACK_TABS` row, help topic (`topics-packs.ts`) and palette label
  (`r11T` in `palette-destinations.ts`).
- **Builder desk (C):** replace the lazy target `R11Stub` in `Receivables.tsx` (`RealtyDesk`) with your desk.
- **Series:** `SWO`, `SCB`, `BKG`, `DMD`, `MUS`, `PLG`, `PVB` are unused (pinned free by `tests/cn-registry.test.ts`).

### Deviations from the PRD (CN-A)

- Works views (contracts … pnl) are **not** listed as stubs: the stubs, their help topics and palette rows cost ~1.5 kB
  of a budget already over its share; each package adds its own view with its screen. A profile landing on a view that
  does not exist yet opens the BOQ view. The realty tab exists with a one-line stub (builder landing).
- `sync-engine.ts` / `recycle-bin.ts` registry imports deferred to the first package with a table (first-paint rule).
- `gst-guards.ts` class-rate notice and `bill-guard.ts` realty no-ITC caution are not wired (**wired in R16-D3**: GST guard
  `CN_CLASS_RATE` from the lazy `construction/cn-guard.ts`, CN1; the realty caution also covers bills not charged to a
  project, PF18): the class-rate notice
  shows in the editor's Contract & RA panel; the realty caution belongs with CN-C's classes.
- Sample data (`demo/profile-works.ts` dispatcher and blocks) not added; existing works sample rows unchanged.
- Settings switches beyond the picker (paper style, certificate text, deviation %) have no separate Settings form:
  the profile writes them; per document the paper style is chosen in the editor panel.
- `DEDUCTION_KINDS` (BOQ deduction-set editor) is unchanged; CN-B adds rows with their maths.
- `tests/features-catalog.test.ts`: advanced options 21 → 22 (the construction profile row).

### Budget (CN-A)

Measured against `claude/elegant-cannon-cwapiv` at `aa7a504` (same machine, `vite build`, gzip -9):

| | Before | After | Δ |
|---|---|---|---|
| Initial JS (first paint) | 189,038 B | 189,025 B | ≈ 0 kB (entry content unchanged; ± hash noise) |
| Total JS | 2,855,361 B | 2,878,262 B | +22.4 kB (2,810.8 kB of 2,900) |

Breakdown of the total (gz): engines `cn-tax` chunk (cn-tax / snapshot / abstract / rules / UI strings) 7.5 kB,
paper chunk 3.2 kB + paper strings 1.6 kB, editor panel 2.2 kB, `cn-print` / sections 1.5 kB, picker in the shared
picker chunk 1.2 kB, settings 0.9 kB, profile 0.5 kB, help topics + glossary 0.7 kB, checklist / reach / Features /
wizard / palette / Ctrl+K rows ≈ 2.1 kB, the rest in host chunks. **Over the 15 kB CN-A share by ≈ 7.4 kB**; total JS
stays at ≈ 2,811 kB of 2,900 kB. Trimmed already: paper parts in one chunk, paper-only strings, pure section module,
no stub views.

## CN-B — Contractor finance

Works views `contracts`, `advances`, `escalation`, `guarantees` (one lazy chunk `cn-finance-views`, listed by
`worksViewOn`; `PACK_TABS` rows with `twT` labels `view.*`, help topics `time:works:*`). Tables `works_contracts`
(`master.edit`), `secured_advances` (`doc.create`, dated), `price_variations` (`doc.create`, dated, numbered `PVB/FY…`),
`bank_guarantees` (`books.edit`, dated `issued_on`): registered in `cn-registry.ts`, `backup.ts`, `sync-engine.ts`
(`DATED` / `NUMBERED`), the open-export schema; audited and binned. CN-B added the deferred `cn-registry` imports to
`sync-engine.ts` / `trust/recycle-bin.ts` (CN-C merged the same lines; kept once). Every figure is a working paper —
verify with your CA.

### What shipped

| Item | Where |
|---|---|
| B1 contract register | `cn-contracts.ts`: `saveContract` / `cleanContract` (one contract per BOQ; EOTs sorted, each after the previous date; derived `extended_completion` and `jv_note` so CN-A's `contractOfBoq` → header snapshot prints them), `delayDays`, `ldExposure` (value × % per week × weeks from the last EOT granted **without** LD, capped; informational only), `contractSummary` (billed, % billed, cash received via `movedNoCash`, retention held, days left / delay), `contractRules` (contract retention / SD / water + electricity % win over the BOQ deduction set). `ContractsView.tsx`: register, form (EOTs typed as "date ref [LD]"), "Create / import the BOQ" link; BOQ panel links back. |
| B2 advances | `cn-advances.ts`: `simpleInterest` (365-day year), `scheduleTarget` / `recoveryThisBill` (max of the BOQ rule and the straight-line schedule `recover_from_pct` 10 → `recover_by_pct` 80, capped at the balance), `advanceDeductions` (rows `advance_recovery` + `advance_interest`, `ref_id` = the advance, interest from the last bill or the advance date), `advanceStatus` (behind-schedule flag). Contract `advance_terms` (defaults `ADVANCE_DEFAULTS`). `recoverAdvance` now applies each advance separately (`ref_id`; old rows fall back to the BOQ's `advance_id`). `cn-secured.ts`: 75% of materials at site, receipt journal Dr bank \| Cr "Secured advance from clients" (class `Secured advance`, no GST), recovered on RA bills by quantity used (average rate × %) or a typed amount, never past the balance; "recovered" is read from live RA bills; delete removes row + journal together. `AdvancesView.tsx`. |
| B3 price variation | `cn-escalation.ts`: `pvFormula` (PV = M × W × Σ share × (I − I0)/I0, shares must total 100), `pvWorkValue` (RA bills of the period, extra / deviation lines excluded when the clause says so), `savePv` (PVB/FY…, no overlapping period), `billPv` (PV > 0 → works invoice at the RA bills' rate; PV < 0 → credit note linked to the period's last RA bill in `doc_links`, `sec34Deadline` warning), `cancelPv`, `readIndexSheet` (user's own CSV / XLSX). Snapshot `boq_terms.cn.pv` (`CnPvSnapshot` / `CnPvRow`), printed by `parts/PvWorkingPage.tsx` (paper strings `p.pv*`). `EscalationView.tsx`. |
| B4 recoveries | `cn-recoveries.ts`: `wastageRecovery` (±3% band, excess at 2× issue rate, shortfall at the issue rate — `RECOVERY_DEFAULTS`), `recoveryRow`, `cnBillDeductions` — the one call `saveRaBill` makes (contract advances, secured advance, typed recoveries; `RaRequest.recoveries`). Kinds: `material_recovery`, `water_power` (also a BOQ `DEDUCTION_KINDS` row), `hire_charges`, `withheld` (reason + `release_on`, held bucket), `ld` (label carries the delay vs the contract; paper note "not a supply, Circular 178/10/2022"). Receipts: `recordDeductionRow` handles every clearing kind (`CLEARING_KINDS`): no-cash receipt into "RA deductions clearing" + journal (class `RA deduction`, `ra_journal_id`) to "Material issued by client", "Water & electricity — site", "Plant hire charges", "Interest on mobilisation advance", "Liquidated damages", "Secured advance from clients"; `releaseHeld` takes `withheld` / `ld` (cash). `RaReceiptPanel` / `RetentionPanel` offer the rows. Measurement form: lazy `BillRecoveries.tsx`. Editor `ContractPanel` lists the deductions, net payable and a PV statement no. |
| B5 guarantees & closure | `cn-guarantees.ts`: register, `expiringGuarantees` (≤ 30 days), `extendGuarantee` (history), `closeGuarantee` (released / invoked), `bgCommission`, `contractDeposits` / `linkDeposit` (R5-C6 deposits paid, additive `contract_id`). `cn-closure.ts`: checklist (final bill, completion, DLP over, retention, SD / EMD, BGs, PV final, no-claim, material reco) derived where possible, ticks / waivers with reason, `closeContract`. `cn-alerts.ts` (via `works-alerts.ts`): BG expiry, secured advance > 90 days, advance not recovered at its "fully by" %, withheld > 90 days. `GuaranteesView.tsx`; closure in `ContractsView`. |

Restore safety: `OWNED_VOUCHERS` row for `Secured advance`; hooks: a secured advance comes back with its journal, a PV
statement only while no live statement covers its period; recovery receipts use the existing paired `RA deduction`
path. Tests: `cn-contracts`, `cn-advances`, `cn-escalation`, `cn-recoveries`, `cn-guarantees`, `cn-registry` (CN-B
block). E2E step "R11-B contractor finance".

### Deviations from the PRD (CN-B)

- Deduction kinds use CN-A's union names (`secured_advance`, `water_power`, `hire_charges`), not the PRD's
  (`secured_advance_recovery`, `water_electricity`, `hire_recovery`).
- `measurements.ts` (A-owned) gained one guarded call (`contractRules` + `cnBillDeductions`) and `RaRequest.recoveries`;
  `MeasurementForm.tsx` mounts the lazy recoveries form.
- Secured advance: `recovered[]` is derived from live RA bills (not stored); proposal by quantity typed on the bill (D4
  coefficients not used). Bank pick: main bank / cash only.
- Client material recovered is booked to an expense-type account "Material issued by client" at receipt; no stock inward
  (CN9 stock path left to CN-D4). Free-issue material is quantity only (not entered on the bill).
- PV is billed as a separate supplementary invoice / credit note only (no "line on the next RA bill" option).
- BG commission and margin FD are recorded on the register, not posted (booked where paid).
- EMD / SD: deposits are recorded in Recurring → Leases → Deposits and linked to the contract here (`deposits.ts` untouched).
- The contract field is `deviation_pct` (CN-A's `ContractLike` name), not `deviation_limit_pct`.

### Budget (CN-B)

Measured against `claude/elegant-cannon-cwapiv` at `ecf2e55` (CN-A + CN-C), same machine, `vite build`, gzip -9:

| | Before | After | Δ |
|---|---|---|---|
| Initial JS (first paint) | 189,104 B | 189,123 B | +19 B (registry imports; ≤ 60 B) |
| Total JS | 2,906,512 B | 2,930,522 B | +24.0 kB (2,861.8 kB of 3,000) |

Breakdown (gz): views 8.3 kB, strings + form helpers 3.7 kB, contract / advance / secured engines 3.9 kB, guarantees +
closure 1.1 kB, recoveries 1.0 kB, recoveries form 1.0 kB, bell 0.8 kB, Works tab mounts 0.7 kB, receipts 0.5 kB, help
0.45 kB, PV paper 0.4 kB + strings 0.45 kB, rules 0.3 kB, the rest in host chunks. **Over the 12 kB share by ≈ 12 kB.**
Trimmed already: one chunk for the four views, spec-driven forms, common words reused from the works area strings,
no `deposits.ts` / `boq.ts` / `measurements.ts` imports from the views (each had split a shared chunk).

## CN-C — Builders and developers (pack `realty`)

Desk: **Receivables → Realty** (`/receivables?tab=realty&view=…`, one lazy chunk `components/construction/RealtyDesk.tsx`,
strings `i18n/areas/construction-r11c.ts`, English + Hindi). Engines in `src/lib/construction/cn-*.ts`; every writer
imports `./cn-registry`. Rules (`construction-rules.ts` `// CN-C`, every row dated, `source`, `verified: false`):
`REALTY_RATE_RULES`, `REALTY_AFFORDABLE_RULES`, `REALTY_INTEREST_RULES`, `RERA_DEPOSIT_RULES`, `REALTY_194IA_RULES`,
`REALTY_PROCUREMENT_RULES`. The Sec 34 limit reuses `nextFyCutoff` (`gst-penalties.ts`); no new tax-rules row.

### What shipped

| Item | Where |
|---|---|
| C1 projects, towers, units | `cn-realty-projects.ts` (table `realty_projects`: RERA no. / validity, RERA (70%) and collection accounts, State, city class, GST scheme `n03_2019` / `old_option` + typed rate, CC / OC dates, towers with % completion; a project is also a cost centre of kind `project`; its RERA account carries `BankAccount.rera_project_id`, kept by `bank-accounts.ts` `clean`). `cn-units.ts` (table `realty_units`: tower / floor / unit no., type, carpet sq m, saleable sq ft, rate per sq ft, PLC, status; bulk add "A-101 …" skipping existing numbers; status moves; CSV). Grid by tower and floor with status badges (surface tokens); tap = hold / free. |
| C1 / C3 tax maths | `cn-realty-tax.ts`: affordable test (carpet ≤ 60 sq m metro / 90 sq m other AND ≤ ₹45 lakh, both inclusive), `unitClass` at booking, `landSplit` (land one-third; 1.5% / 7.5% on two-thirds = 1% / 5%; before 1 Apr 2019 the 12% / 18% with-ITC row; old option = typed rate), `splitTax`, `afterCc`, `preAgreementWarning` (Sec 13 10%), `tds194ia` (≥ ₹50 lakh or stamp value; label `sectionText('194IA', date)` → "Sec 393(1) [Table: Sl. No. 3(i)] [old 194-IA]" from 1 Apr 2026). |
| C2 bookings | `cn-bookings.ts` (table `realty_bookings`, `BKG/FY…` via `series_counters`, dated `date`): cost sheet (`defaultCostSheet`: basic, PLC, parking / club / development taxable; stamp duty, registration, maintenance deposit, corpus pass-through), `agreementValue` excludes pass-through, class snapshot, unit → booked; agreement / registration (unit → registered) / possession; interest waiver (audited row edit); delete only without receipts / demands. Receipts = advance receipt vouchers (`advances.ts`, `AdvanceInput.booking` → `AdvanceRecord.booking_id` / `pass_through`), place of supply = property State, GST at the class rate, none on pass-through or after CC; the payer (loan bank) goes in the note. Desk: 10% warning and 194-IA hint per booking, allotment letter print (`cn-allotment-print.ts`). |
| C3 plans, demands | `cn-plans.ts` (`payment_plans`, stages sum to 100, "Booking 10, Plinth 15 …" parser; `stage_certificates`, one per tower and stage). `cn-demands.ts`: `candidates` (live bookings in the tower on a plan with the stage), `raiseDemands` (all or nothing): per booking one TAX_INVOICE in the invoice series + `DMD/FY…` and the snapshot `boq_terms.cn.demand` (unit, tower, carpet, RERA no., stage / %, agreement value, demanded so far, received, earlier billed, interest, land working, RERA account, plan); open booking advances adjusted (`applyAdvance`); a stage is demanded once per booking; on / after CC a `BILL_OF_SUPPLY` with `exempt_kind: 'NON_GST'` and the Sch III note. Interest on delay: owed on earlier demands × rate × days since the last due date (settings rate, default `REALTY_INTEREST_RULES`), a taxable line at the unit rate. Ageing per booking (0–30 / 31–60 / 61–90 / 90+), WhatsApp link per demand. Paper: `parts/DemandBlock.tsx` (in `WorksPaper`), strings in `construction-r11-paper.ts` `// CN-C`. Builder settings (interest rate, forfeiture % / amount, allotment terms) live in `construction_settings.realty` (owner). |
| C4 RERA account | `cn-rera.ts`: `collections` (booking advances net of refunds + money paid against demands, `movedNoCash` rows and pass-through skipped), `reraStatement` per month (collected, 70% required, deposited = received into the RERA account + "transfer in" entries, withdrawn, cumulative shortfall, balance), `withdrawalWarnings` (over deposits / over completion % × deposits / missing engineer-architect-CA certificate refs — warnings only), table `rera_withdrawals` (`kind` withdrawal / deposit), QPR CSV per tower, year statement CSV. |
| C5 cancellations | `cn-cancellations.ts`: `proposal` (received − forfeiture − GST on demands past the Sec 34(2) date), `cancelBooking`: full credit notes for demands inside the window (`createCreditNote`), refund vouchers (Rule 51) from open booking advances, the rest `refund_pending`; forfeiture → optional (draft) journal Dr Debtors / Cr "Forfeiture income"; booking `cancelled` with its snapshot; unit available. Print with the Circular 188/20/2022-GST note when GST stays paid. |
| C5 80% test | `cn-procurement80.ts` (reads purchases via `readPurchase` / `readPurchaseLines`, added to `tests/purchase-contract.test.ts`): per project cost centre and FY; exclusions by HSN (2710 / 2711 / 2716) and words (TDR, FSI, lease premium, electricity, diesel, capital goods…); cement from unregistered suppliers at its own rate by bill date (28% → 18% from 22 Sep 2025); 18% RCM on the rest of the shortfall; "Book RCM liability" = optional journal Dr "RCM on procurement shortfall (no ITC)" (project cost centre) / Cr RCM payable. |

Registry, storage, help: `cn-registry.ts` CN-C block (`realty_projects` / `realty_units` / `payment_plans` `master.edit`,
`realty_bookings` / `stage_certificates` `doc.create`, `rera_withdrawals` `books.edit`; all audited); **the deferred
imports are in** (`sync-engine.ts` → `./construction/cn-registry`, `trust/recycle-bin.ts` → `../construction/cn-registry`).
`backup.ts` both lists, `sync-engine.ts` `DATED` (bookings `date`, certificates `certified_on`, RERA entries `date`) and
`NUMBERED` (bookings), open-export meanings. Restore hooks (`recycle-bin.ts`): a deleted booking is refused ("book the
unit again" — the delete freed the unit), a unit needs its live project, a certificate is refused next to a re-made one.
Help topics `receivables:realty:<view>` (8, `topics-packs.ts`), `PACK_TABS` rows and palette labels `r11.realty.<view>`,
glossary `rera-account`, `deemed-land`. Tests: `cn-units`, `cn-bookings`, `cn-demands`, `cn-rera`, `cn-cancellations`,
`cn-procurement80` (+ registry, no-cash, purchase-contract rows). E2E step "R11-C builder desk".

### Deviations from the PRD (CN-C)

- **GSTR-1 value of a demand:** the demand line carries the full stage value at the **effective** rate (1% / 5%, a GST
  slab), so GSTR-1 shows the full value at 1% / 5%; the paper prints the land one-third working (taxable two-thirds at
  1.5% / 7.5%, CGST + SGST halves). Reporting the two-thirds at 7.5% needs a non-slab line rate the GST tables flag —
  left for CN18. Tax amounts are identical (to the paisa in the tests).
- The RERA account is chosen on the project form (which flags the bank account `rera_project_id`) instead of a
  "RERA account of project" select on the bank-account form.
- Pass-through collections are advance vouchers with `pass_through: true` and no GST (customer advances, a liability),
  not a separate "Pass-through collections" ledger; they stay out of the agreement value, demands and RERA 70%.
- Deposits into the RERA account = receipts made straight into it + "transfer in" rows on `rera_withdrawals`
  (`kind: 'deposit'`); contra vouchers in the books are not read.
- Cement from unregistered suppliers is taxed at its rate in full; the 18% applies to the shortfall beyond it.
- Cancellation refunds of money already adjusted against demands are reported as "still to pay" (paid from Payments);
  a deleted booking is not restorable from the bin (book the unit again).
- Broker commission (194H bill) and reminders through follow-ups: wired in PENDING 14 (`construction/cn-realty-extras.ts`).
  The booking form takes a broker (vendor) and brokerage %; "Broker bill (194H)" on a booking drafts a purchase bill
  (`purchase_drafts`; SAC 997222, 18% GST with a GSTIN, IGST out of State, 194H on the bill) once, linked as
  `broker.draft_id`; "Remind" on a demand-ageing row logs an R2-A follow-up (WhatsApp, next action in 7 days) for the
  buyer. The plan table on the demand paper is a one-line stage list.
- `bill-guard.ts` realty no-ITC caution (left by CN-A) is not wired. (QA11 C9 wired it for bills charged to a project;
  R16-D3 adds every other ITC bill of a builder, with an audited override — PF18.)

### Budget (CN-C)

Measured against `claude/elegant-cannon-cwapiv` at `e6a3ab9` (same machine, `vite build`, gzip -9):

| | Before | After | Δ |
|---|---|---|---|
| Initial JS (first paint) | 189,104 B | 189,104 B | 0 B (the registry imports only add preload-list entries; within hash noise) |
| Total JS | 2,881,385 B | 2,906,512 B | +24.5 kB (2,838.4 kB of 3,000) |

Breakdown (gz): the desk chunk 20.1 kB (UI ≈ 8 kB, engines ≈ 7.5 kB, EN + HI strings ≈ 4.5 kB), demand paper +0.6 kB
and paper strings +0.9 kB, help topics + glossary + palette + `PACK_TABS` rows ≈ 2 kB, registry / backup / sync /
export / restore-hook rows ≈ 0.6 kB. **Over the 14 kB CN-C share by ≈ 10.5 kB** — the 15 items (eight views, five
engines with prints) do not fit 14 kB with Hindi; total JS stays well inside the 3,000 kB budget.

## CN-D — Site operations (Works views `subcon`, `labour`, `plant`, `reco`, `pnl`)

Screens: **Time → Works** views, listed when the construction profile switches them on (`construction_settings.views`;
their URLs always open). One lazy chunk `components/construction/SiteOps.tsx` (Sub-contracts, Labour, Plant, Material
reco, Site P&L views + `site-ui.tsx` / `site-kit.ts`), strings `i18n/areas/construction-r11d.ts` (English + Hindi); tab
labels in the small `works/site-views.ts`. Engines in `src/lib/construction/cn-*.ts`; every writer imports
`./cn-registry`. Rules (`construction-rules.ts` `// CN-D`, dated, `source`, `verified: false`): `WASTAGE_BAND_DEFAULTS`
(−3% / +3%, penal 2), `COEFFICIENT_STARTERS` (typical, non-statutory), `LABOUR_WITHHOLD_DEFAULTS` (10%). Sec 40A(3)
reuses `CASH_PAYMENT_LIMIT_RULES` through `retail/rt-cash-guard.ts` (`cashPaymentLimit`); plant SAC / TDS reuses CN-A's
`PLANT_HIRE_SAC_RULES`.

### What shipped

| Item | Where |
|---|---|
| D1 work orders | `cn-subcon.ts`: table `sub_work_orders` (`SWO/FY…`): vendor, BOQ, site godown + cost centre, lines "From BOQ" at a rate % of ours (or typed), deduction rules (retention %, advance-recovery %, other), TDS section (default 194C by PAN). `boqMargins` = (our rate − his rate) × his billed qty (shown in the site P&L). Also the CN-D table names (`SD`) and row helpers. |
| D1 bills | `cn-subcon-bill.ts`: table `sub_measurements` (`SCB/FY…`, cumulative / this qty + M-book). Saving makes one `PURCHASE` bill through `purchasesDb.save` (lines = this-bill qty at WO rates, SAC 9954, PoS = his State, GST only when he has a GSTIN), TDS through `resolveBillTds` (194C on the value before GST, thresholds, ITA 2025 labels) and the snapshot `PurchaseRecord.cn_sub` (abstract, deductions, TDS, net). Retention / material / plant-hire / other recoveries → ONE journal "Sub-contractor deductions" Dr Sundry creditors (party) │ Cr "Retention payable to sub-contractors" / "Material recovered from sub-contractors" / "Plant hire recoveries" / "Other recoveries — sub-contractors"; its amount is rolled into the bill's `amount_paid`, so the bill's balance, status and payables show the **net due**. Advance recovery = bill-wise Agst Ref adjustment of his open advances (`adjustAgainstBill`). Cancel removes the bill and journal (recycle bin) and frees the quantities; retention payable per sub-contractor with "Release" (PAYMENT voucher, class "Retention release"). Abstract print "Sub-contractor bill". |
| D1 payables | `billwise.ts` one guarded line: on a `cn_sub` bill the journal part shows as an adjustment "Sub-contract deductions (journal)" (the net due ages). |
| D2 compliance | `cn-labour-compliance.ts`: table `labour_compliance` (vendor × month; PF TRRN / amount / file, ESI challan / amount / file, wage register file, licence; pending / proved / waived — proved needs TRRN + challan). Files through the attachments store (`labour_compliance` added to `ATTACHMENT_OWNER_TABLES`). `withholdFor` = max(hold % of the bill, PF + ESI) until proved / waived; `labourBills` lists labour contractors' bills with balance, hold and "pay now" (warning, never a block); hold % in `construction_settings.labour_withhold_pct`. Manpower supply bill = a DRAFT tax invoice, SAC 998519 at the `manpower` class rate, lines Wages / Statutory contributions / Service charge; compliance annexure print. |
| D2 muster | `cn-muster.ts`: `site_labour` (name, trade, daily / OT rate, typed minimum wage, phone, ID ref, site) and `muster_days` (one row per site per day; present 0 / ½ / 1, OT hours). `wageSheet` (gross = days × rate + OT − advances; cash-limit and minimum-wage warnings); `settleWeek` → `MUS/FY…` + one PAYMENT voucher "Site wages" Dr "Site labour wages" (site cost centre) │ Cr "Advances to site labour" │ Cr cash / bank; the days are locked; "Undo" removes the voucher (recycle bin). Not linked to payroll. |
| D3 plant | `cn-plant.ts`: equipment = fixed asset with `cn_equipment` (kind, reg no., hour meter, internal / hire-out rate per hour, fuel range — `ledger/assets.ts` now keeps the field through normalise / edit) or `hired_equipment`; log sheets `plant_logs` (`PLG/FY…`, hours ≤ 24); `monthSummary` (utilisation %, L/h flagged outside the range); `hireRecoveryFor` (logs charged to a sub-contractor at the hire-out rate → `hire_recovery` on his next bill, logs marked `recovered_in`); `internalCharges` (own plant at own sites, memo). `cn-plant-hire.ts`: `hireProposal` / `bookHireIn` — month-end bill (hour / day / month basis), 194-I(a) without operator, 194C (by PAN) with, labels by `sectionText`, once per machine and month (`cn_sub.kind 'hire'`); `hireOutInvoice` (draft invoice at SAC per rule, 18%); shared `draftInvoice`. |
| D4 reconciliation | `cn-reco.ts` on top of `works/sites.ts` (new export `siteOpening`): per site and material — opening, received own (transfers, `lineFactor`), client issue free (qty only) / against recovery, theoretical, actual, variation %, band (terms per material on the site godown `Godown.cn_reco`, else defaults), beyond band (over + short), recovery rate (issue rate × penal), recovery (only where the client issued material), closing. Client issues typed on the site; RA-bill `material_recovery` rows that carry `item_id` / `qty` are also read. CSV and print "Material reconciliation statement"; starter coefficients table. Sites panel links to it. |
| D5 site P&L | `cn-site-pnl.ts` (`sitePnl` pure, `gatherSitePnl` reads every source once): revenue = RA bills of the BOQ + sales documents of its cost centre (taxable; gross / net payable), less credit notes; costs — materials (`siteCostByCentre`) less material recovered from sub-contractors, sub-contractor bills (net of "other" recoveries), labour-contractor bills, muster wages, plant (hire bills split by the month's log hours per site + internal charge − hire recovered), other bills / expenses of the cost centre; each purchase is classified once through `readPurchase`. Memo: measured-not-billed (draft measurements × BOQ rate), typed "not measured" and cost to complete per group (`BoqTerms.site_pnl`), remaining contract value, expected margin; held amounts from `raDueSplit`; retention payable. CSV and print; Books → Projects links to it. |

Registry / storage: `cn-registry.ts` CN-D block (`sub_work_orders`, `sub_measurements`, `labour_compliance`,
`muster_days`, `plant_logs` `doc.create`; `site_labour`, `hired_equipment` `master.edit`; all audited); `backup.ts` both
lists; `sync-engine.ts` `DATED` (work orders, bills, muster days, logs) and `NUMBERED` (SWO, SCB, PLG; MUS lives on the
muster rows, guarded by `series_counters`); open-export meanings. Restore rules (`recycle-bin.ts`): the deductions
journal and the site-wages voucher are owned vouchers (refused once undone where posted); a sub-contractor bill cancelled
from its measurement is refused (measure again). Help topics `time:works:{subcon,labour,plant,reco,pnl}`, `PACK_TABS`
rows, palette labels `r11.*`, synonyms, the `time.works` Ctrl+K title. Tests: `cn-subcon`, `cn-labour`, `cn-plant`,
`cn-reco`, `cn-site-pnl` (+ registry and purchase-contract rows). E2E step "R11-D site desk". CA items CN29–CN31.

### Deviations from the PRD (CN-D)

- One lazy chunk for the five views (the PRD's five view files are separate modules inside it) instead of five chunks.
- Material and plant recoveries on a sub-contractor bill are credited to recovery ledgers by journal, not a debit note /
  stock credit at site; material issued through `job-work.ts` challans is not read (typed on the bill instead).
- Retention is moved to its liability at the bill (journal), so the payables ageing simply ages the net due; the
  "guarded call" is the relabelled adjustment in `billwise.ts`.
- The sub-contractor abstract is an HTML print, not the `WorksAbstractPage` component (keeps the paper chunk apart).
- Labour hold: shown on the Labour view with a "pay now" figure; the Purchases payment dialog is not changed.
- Client-issued material: quantities only in the reconciliation (typed on the site godown, or CN-B4 rows if they ever
  carry an item and quantity — CN-B's rows do not today); no stock inward is booked for it (left by CN-B4; free issue
  never valued). Attachments on the final-bill closure checklist (B5): since PENDING 14 the closure box has the shared
  attachments panel (`WorksContract.attachments`, `setClosureFiles`; `works_contracts` is an attachment owner table).
- Site P&L is per BOQ (contract) and its project cost centre; other vouchers' expense lines tagged to the cost centre
  are not read (purchases / expenses are); muster wages are read from the "Site wages" vouchers.
- Minimum wage is typed per worker (not a per-trade table).

### Budget (CN-D)

Measured against `claude/elegant-cannon-cwapiv` at `3a46851` (CN-A + CN-B + CN-C), same machine, `vite build`, gzip -9:

| | Before | After | Δ |
|---|---|---|---|
| Initial JS (first paint) | 189,123 B | 189,140 B | +17 B (≤ 40 B; `PACK_TABS` rows) |
| Total JS | 2,930,522 B | 2,959,630 B | +29.1 kB (2,890.3 kB of 3,000) |

Breakdown (gz): the site chunk 25.0 kB (EN + HI strings ≈ 5.8 kB, eight engines with three prints ≈ 9 kB, five views ≈
10 kB), help topics + palette + synonyms + `PACK_TABS` ≈ 1.2 kB, registry / backup / sync / export / restore rows ≈
0.5 kB, Works tab / Books link / billwise / assets ≈ 0.4 kB, the rest chunk-split overhead. **Over the 11 kB share by ≈
18 kB**: D1–D5 are five full screens (work orders + measured bills + retention, compliance + manpower bill + muster,
equipment + logs + hire in / out, reconciliation + terms + client issues, P&L + WIP) with Hindi; total JS stays inside the
3,000 kB budget. Trimmed already: one chunk, shared form helpers, no new icons, the rule file reached only through lazy
engines, the payables / assets edits are single guarded lines.

## QA round 11 (fixes; report `docs/prd/qa-round-11.md`)

- Cancellation: a forfeiture kept out of an open booking advance closes it — additive `AdvanceRecord.forfeits[]`
  (`{ id, date, amount, booking_id, journal_id }`, read by `advanceBalance` as `forfeited`); the journal (Dr Advances from
  customers | Cr GST paid on advances | Cr Forfeiture income) is posted. A forfeiture wholly out of Debtors stays a draft.
- Owned journals: "Sub-contractor deductions", "Site wages", "Secured advance", "Booking forfeiture" are deleted only
  from their own screens (`vouchers.ts` `OWNED_JOURNALS`); a measured sub-contractor bill only from Sub-contracts.
- RA bills: GST TDS u/s 51 off under the proviso (`gstTdsProvisoApplies`: our State = site State ≠ client's GSTIN State).
- Site P&L: client recoveries on our RA bills are costs; draft RA bills are WIP; PV bills carry `boq_id` + cost centre.
- Builders: sub-contractor / hire-in bills of a 1% / 5% project take no ITC (`noItcCentre`); the bill form cautions.
- Recycle bin: a demand / RA bill / PV bill is not restored next to the one made again. Plant logs: `recovered_invoice_id`.
- Delay interest is simple (earlier interest and its GST left out of the amount owed).
