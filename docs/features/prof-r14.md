# Round 14 — professional and knowledge-services firms (feature notes and the API for PS-B / PS-C / PS-D)

PRD: `docs/prd/round-14.md` (it names this file `professional-r14.md`; the round's doc is `prof-r14.md`). CA items:
`docs/CA_REVIEW.md` §14 (PS1–PS40 from the PRD; PS41–PS44 added by PS-A in §14.7; PS-B, PS-C and PS-D number
theirs from 50, 60 and 70). Every GST / TDS / FEMA / accounting figure here is a working paper — verify with your CA. One section per package;
each package edits only its own section and records its own bundle numbers.

## PS-A — Professional profile and the practice core

### What shipped

| Item | Where |
|---|---|
| A1 profile | Settings `prof_kind` (`ca`, `legal`, `design`, `consulting`, `agency`, `freelancer`, `other`) and `prof_sub` (CA `icai` / `icsi` / `icmai`; legal `litigation` / `advisory` / `both`; design `architect` / `interior` / `engineer`; consulting / freelancer `domestic` / `exports`; agency `creative` / `media_buying`) — additive, `types/prof-r14.ts`. **No new business type**: `shop-presets.ts` `PROF_KINDS` / `PROF_SUBS` / `PROF_PROFILES` / `applyProfKind(kind, { registered, sub, firmForm, exports, currentPacks })` writes `services` + `service_kind: 'professional'`, modules (`registered` adds `gst`; `time` always kept, so `/time` stays visible and `PACK_ROUTES` is unchanged) and packs **in union with the packs the company has** (`exports` / sub `exports` add `svcexport`; a partnership or LLP adds `partners`). Seven packs `practice`, `cafirm`, `legal`, `design`, `media`, `svcexport`, `partners` (`industry-packs.ts`; `PACK_OF_TYPE` unchanged). The **firm form** is the annual pack's entity type — `prof/ps-profile.ts` `writeFirmForm` writes the current FY's `notes_to_accounts.entity_type` (one value, never a second field). Switches in the company object `prof_settings` (`prof/ps-settings.ts`: owner only, audited on save, backed up, synced as a singleton; object-valued keys of B–D kept as stored) via `ps-profile.ts` (`psSwitchesOf`, `profSwitchesFor`, `applyProfSwitches` — fills only unset switches; the advocate's enrolment / Bar Council and the CA's membership / FRN go in `prof_settings.legal` / `.ca`). Wizard: Services → Professional opens `ProfKindPicker` (kind, sub-choice, firm form, ids; inside the wizard chunk); Settings → Features "Professional profile" for every `services` company (+ "Custom"); Features row `adv.profProfile`, `PACK_HREF` rows. Checklist steps (`checklist-steps.ts`, append-only, only with `prof_kind`): `firstMatter`, `staffCapacity` (every kind), legal `enrolment`, `conflictCheck`. |
| Desks | `TIME_TABS` rows `matters` and `wip` (pack `practice`). `Time.tsx` mounts **all six desks** lazily through `import.meta.glob('../components/prof/*Desk.tsx')` keyed `matters → MattersDesk`, `wip → WipDesk`, `clientmoney → ClientMoneyDesk`, `exportsvc → ExportSvcDesk`, `firm → FirmDesk`, `cadesk → CaDesk`: a desk whose package has not merged has no file and no `TIME_TABS` row, so it is never mounted (no stubs, and `Time.tsx` is not edited again). Each desk is ONE lazy chunk with its views; a shared chunk carries `ps-ui.tsx` / `ps-run.ts` and the libs both desks use. Every tab and view has a help topic (`topics-packs.ts`, `time:matters:*`, `time:wip:*`), a palette label (`r14.*` in `palette-destinations.ts`) and a Ctrl+K title (`time.matters`, `time.wip` in `discover-r6-tabs.ts`); glossary terms `realisation`, `write-down`, `unbilled-work`. |
| A2 matters | `prof/ps-matters.ts`: a matter IS a project cost centre with `CostCentre.ps` (code, kind, practice area, court / forum, case no., parties with role / PAN / GSTIN, responsible / originating timekeeper, opened / closed, conflict check, engagement); `cost-centres.ts` keeps `ps` (one line in `projectFields`). Code unique per company, `<client code>/<seq>` suggested (`Client.ps.code`, else initials). In a `legal` profile a new matter needs a conflict check, or the owner's skip reason (audited). Matters view: list with unbilled WIP / billed / received / last activity, CSV; the client-money column appears when PS-B's `ps-client-money.ts` exports `matterBalance` (read through `import.meta.glob`, never a hard dependency). The R3-B project board, budgets and bell work unchanged. |
| A2 engagements | `prof/ps-engagements.ts` (table `engagements`, `ENG/FY…`, dated by `start`, numbered, `doc.create`): model `hourly` / `fixed` / `milestone` / `retainer` / `capped` / `success` / `blended`, fee / cap / blended rate / milestones (≤ 100 %) / success event, R3-B3 retainer link, disbursement policy, TDS section, letter quote, acceptance, renewal. A success fee (or a milestone on a share of recovery) in a `legal` / `ca` profile warns with `prof-rules.ts` `SUCCESS_FEE_PROMPT_RULES` and needs the owner's `ethics_reason` (audited, PS26). An unwaived conflict on the client or a matter party warns on a new engagement (never blocks). Delete is refused once a fee note names the engagement; the number stays used. |
| A2 letters | `prof/ps-letters.ts`: "Make letter" drafts a QUOTATION with the engagement's fee lines (`letterLines`), the profession's starter proposal sections (`LETTER_SECTIONS`: CA SA 210 headings with a UDIN note; legal; design; consulting / agency) and `ps.engagement`; the quote's 8G acceptance makes the engagement `active` (`syncAcceptances` on desk load). |
| A2 conflicts | `prof/ps-conflicts.ts` (table `conflict_checks`, dated, `master.edit`): folded names (case, punctuation, M/s, Pvt Ltd / Private Limited / LLP / & Co), PAN / GSTIN exact (a PAN also inside a GSTIN), token overlap ≥ 0.8; searches clients, suppliers, every matter's parties (closed too) and engagement titles; result clear / conflict / waived (owner, reason, consent note, audited). 5,000 parties well under 50 ms. |
| A3 pre-bill | `prof/ps-models.ts` `planBill` (pure) applies the reviewer's row edits (hours, rate, exclude = billed at 0, later = deferred) and the model: hourly with an optional target, blended, capped (date order, the crossing entry cut, the rest covered), fixed (fee less fees billed), milestone (picked, not yet billed), success (only after its event), retainer (monthly fee unless an hour-block retainer is linked). `prof/ps-prebill.ts` `createPrebillDraft` goes through **`billUnbilled`** with the edited selection (so `bill_refs`, the annexure and derived billing are unchanged), then adds fee lines (`ps.lines[id].fee`, `milestone`), marks covered lines (`covered`), fills the annexure's `standard` / `billed` row fields (`annexure.ts` `withStandard`; the timekeeper as `who`) and writes `ps` (matter, engagement, basis, `wd`). `prof/ps-writedown.ts` `docBilling` re-derives per entry what a note billed (fee lines spread by standard value; rounding to the largest entry). The bill dialog has an "Open the pre-bill" link. |
| A4 timekeepers | R10 `service_staff` + additive `ServiceStaff.ps` (weekly capacity, dated standard / cost rates, target, local-user hint). "Who" on the time form and the timer (`WhoRow`, lazy, with the pack); the rate card gains the **timekeeper level** after the task and before the project (`rate-cards.ts` optional `{ staffRate, currency }` argument; without it the result is identical). Capacity / rates on Utilisation and as a lazy row on the R10 staff form. |
| A4 reports | `ps-wip.ts` (ageing buckets from `prof_settings.wip.buckets`, write-off stamps `TimeEntry.ps.wo` / `PurchaseRecord.ps.wo` — the Unbilled list leaves them out, `timesheets.ts` one condition each; owner reverses; locked period refused), `ps-realisation.ts` (definitions printed under the table; reads only the entries the period's notes bill, dated or written off in it), `ps-utilisation.ts` (leave = payroll attendance LOP days at capacity ÷ 5), `ps-profit.ts` (cost rates never print), `ps-yearend.ts` (unbilled on the closing date less the client's 12-month billing realisation, editable; completed-service rows at nil; optional dated accrual Dr "Unbilled revenue (WIP)" Cr "Professional fees — unbilled", reversed the next day, once per closing date). |
| A5 paper | Record key **`ps`** (`R14_RECORD_KEYS = ['ps']`, spread into `R9_RECORD_KEYS` — the round's only first-paint token). `prof/ps-snapshot.ts` `psSnapshot(kind, parts)` (drops empty parts) and `mergePs`. `paper-helpers.ts`: `psLineText` inside `trackingText(item, ag, mf, ps)` (both item tables) and `psDeclaration` (B2 regime sentence, pure-agent disbursements, C1 export check, C5 unregistered — each "verify" with its PS id). `TemplateEngine.tsx`: lazy `ProfBlock` (after the parties and the R12 / R13 blocks, before the GST grid, never on receipt paper; boxes from `ps-print.ts` `psBoxes`) and lazy `ProfAnnexurePage` (after the R3-B4 annexure and the R11–R13 pages; sections from `psAnnexure`). SWIFT / IBAN / intermediary bank on the sender profile (lazy row with `practice` or `svcexport`) print in the export block of export documents only (`trade/exporter.ts`, from the sender snapshot). |
| Registrations | `prof/ps-registry.ts` (`PS_TABLE_ACTIONS`, `PS_WATCHED`, runtime), `prof/ps-shared.ts` (`PS_TABLES`, `PS_OBJECTS`, `PS_SERIES` `ENG`, `PS_RESERVED_SERIES` `CMV`, `PS_PACKS`, `PS_DATED`, `PS_NUMBERED`), `prof-rules.ts` (`WIP_DEFAULTS`, `SUCCESS_FEE_PROMPT_RULES`; sections for B–D). Backup `RECORD_TABLES` / `ID_TABLES`, sync `DATED` / `NUMBERED`, open-export rows, recycle-bin restore hook (an engagement only while its client lives). |
| Demo | `demo/profile-prof.ts` (dispatched from `demo/profiles.ts` for a Demo company with `practice`): two timekeepers with capacity and rates, a capped and a fixed-fee engagement on two matters, a waived conflict check, 14.5 h of WIP. `cost_centres`, `engagements`, `conflict_checks` in `DEMO_EXTRA_TABLES`. |
| Tests / e2e | `ps-profile`, `ps-matters`, `ps-engagements`, `ps-conflicts`, `ps-prebill`, `ps-wip`, `ps-realisation` (incl. two years of a 25-person firm), `ps-utilisation`, `ps-profit`, `ps-yearend`, `ps-print`, `ps-registry`, `ps-rules`, `ps-pack-gate`; purchase contract (A's readers). E2E step "R14-A practice desk". |

### API for PS-B / PS-C / PS-D

- **Types** (`src/types/prof-r14.ts`): PS-A declared, for everyone, the `ps` sub-objects `legal` (`PsLegalSnap`), `stage`
  (`PsStageSnap`), `media` (`PsMediaSnap`), `export` (`PsExportSnap`), `udin`, `purpose_code`, `unregistered` and the per-line
  map `ps.lines[lineId]` (`PsLine`: `udin`, `stage`, `ro`); `Client.ps` (`entity`, `small_business`, `advocate`, `country`,
  `fixed_estab_in_india`, `relation`, `tds`, `fees`); `Vendor.ps.advocate`; `PurchaseRecord.ps` (`disb`, `on_behalf`,
  `media`); `WorkType.ps` (`unit`, `currency`); `BankAccount.client_money`; `ExportIrm.ps.fira_no`; catalogue
  `InvoiceItem.ps.fee_event` (catalogue rows only). Re-declare an interface in your block to add fields (interfaces merge).
  **Do not add record or line keys** (B1's disbursement lines reuse `charge_head_id: 'rule33'`).
- **Names** (`prof/ps-shared.ts`): add your tables to `PS_TABLES` / `PS_DATED` / `PS_NUMBERED`; PS-B moves `CMV` from
  `PS_RESERVED_SERIES` into `PS_SERIES` (write it once — `tests/ps-registry.test.ts` counts `'CMV'` literals).
- **Registry** (`prof/ps-registry.ts`): add rows in your block; every writer `import './ps-registry'`. `sync-engine.ts` and
  `trust/recycle-bin.ts` already import it. Add backup / sync / open-export rows in `// R14-B` … blocks, and your tables to
  `DEMO_EXTRA_TABLES` with sample rows (`demo/profile-prof.ts`, your block).
- **Desks**: create `src/components/prof/ClientMoneyDesk.tsx` (B), `ExportSvcDesk.tsx` (C), `FirmDesk.tsx` / `CaDesk.tsx`
  (D) with a default export taking `PsDeskProps` (`components/prof/ps-run.ts`: `{ view?: string; notify }`), and add your
  `TIME_TABS` row (`page-tabs.ts`), its `TAB_LABEL` entry (`Time.tsx` `r14T`, one key each), `PACK_TABS` rows, help topics,
  palette labels (`r14T` in `palette-destinations.ts`) and the Ctrl+K title in the same commit. `Time.tsx` already mounts
  the desk by file name. Point your pack's `PACK_HREF` row at your desk. B adds the `stages` view to `MattersDesk`. Shared
  bits: `ps-ui.tsx` (`Views`, `Field`), `ps-run.ts` (`runWith`, `pct`), `use-period.tsx`; strings — your own area per
  desk (`i18n/areas/prof-r14b-*.ts` …) plus the common words in `prof-r14-common.ts` (`psT`).
- **Settings**: `readProfSettings` / `saveProfSettings` (`prof/ps-settings.ts`); keep your sub-objects as object-valued keys
  (`legal`, `ca.company_clients`, `design`, `export`, `platforms`, `client_money` …) — `cleanProfSettings` keeps them.
- **Rules** (`prof-rules.ts`): your section; dated rows with `source` and `verified`, append-only; import only from
  `lib/prof/*` (`tests/ps-rules.test.ts`).
- **Snapshot / paper**: write documents through `psSnapshot(kind, …)` / `mergePs(prev, parts)`. Add your arm to
  `ps-print.ts` `psBoxes` (purpose code, export check, EDF and UDIN rows are already there) and your annexure section to
  `psAnnexure`; `psLineText` already prints `udin`, `stage`, `ro`; `psDeclaration` already prints the legal regime, the
  pure-agent sentence, the export check and the unregistered sentence from the snapshot.
- **Pre-bill (C4, D5)**: `createPrebillDraft({ key, projectId, edits, milestoneIds, target, reason, annexure })` and
  `planBill` are the draft builder; C4 passes `{ currency }` to `resolveEntryRate` / `rateFor` (the argument exists).
- **Cash**: no new no-cash marker; client-money vouchers are not `transactions` rows (PRD §4).

### Deviations from the PRD (PS-A)

- **Doc name**: this file is `docs/features/prof-r14.md` (as asked by the lead), not `professional-r14.md`.
- **Desk mounts**: one `import.meta.glob` over `components/prof/*Desk.tsx` instead of six named `lazy(import(…))` lines —
  named imports of files that do not exist yet would not compile; with the glob B / C / D never edit `Time.tsx`'s mounts.
- **PACK_TABS / steps / landings for B–D**: only A's desks and views are in `PACK_TABS`; checklist steps of B–D
  (`clientMoneyBank`, `feeSchedule`, `linkCompanies`, `stageTemplate`, `partners`, `lut`, `edf`) and the landings
  `cadesk&view=events` (CA) and `matters&view=stages` (design) wait for their packages (no stubs): CA and design land on
  Matters until then; `PACK_HREF` of `cafirm` / `legal` / `design` / `media` points at Matters, `svcexport` / `partners` at WIP.
- **Matter picker label** on the time form: the matter's code is not added to the cost-centre picker (the project name
  shows); "Matter details" on the project form is a link to the Matters desk, where matters are edited.
- **Letter snippets**: the starter sections are written onto the quotation (`LETTER_SECTIONS`), not seeded into the
  `proposal_snippets` table.
- **Multi-currency pre-bill** (A3.6): standard and billed values are compared in the document currency; conversion of
  a foreign rate card is C4's (the resolver argument is there).
- **Write-offs** stamp the row through the table (`setTable`, the `setRebilled` pattern) — refused in a locked period,
  audited — rather than through the purchase editor.
- **Utilisation leave** comes from payroll attendance loss-of-pay days (the only leave the payroll store keeps).

### Bundle (PS-A)

Measured with `vite build` + gzip -9 (the budget script's method); before = `claude/elegant-cannon-cwapiv` at `fad67a3`
(with QA16), after = this branch merged with it.

| Budget | Before | After | Delta | Share |
|---|---|---|---|---|
| Initial JS (first paint) | 189,212 B (184.78 kB) | 189,217 B (184.78 kB) | **+5 B** (the `ps` token) | ≤ +0.03 kB ✓ |
| Total JS | 3,375,024 B (3295.9 kB) | 3,419,591 B (3339.4 kB) | **+43.5 kB** | ≤ 18 kB (PRD) / ≈ 20 kB (lead) ✗ |

**Overrun: ≈ +23.5 kB over the lead's ≈ 20 kB** (total budget 3,500 kB: 160 kB headroom left). Breakdown (gz): WIP desk 13.5 kB (six views; strings EN + HI ≈ 3 kB;
`ps-wip`, `ps-realisation`, `ps-utilisation`, `ps-profit`, `ps-yearend`, `ps-models`, `ps-prebill`), Matters desk 9.6 kB
(four views; strings ≈ 2.5 kB; `ps-matters`, `ps-letters`), the chunk the two desks share 3.4 kB (`ps-ui`, `ps-run`,
`ps-conflicts`, `ps-engagements`, `ps-writedown`, `ps-staff` parts), the picker in the wizard / Features chunk 1.4 kB,
common strings 1.4 kB, help topics 1.1 kB, demo 1.1 kB, reach strings (packs, checklist) 1.0 kB, `ps-profile` +
`ps-settings` 1.8 kB, lazy rows (`ProfRows`, `WhoRow`) 1.4 kB, paper parts (`ProfBlock`, `ProfAnnexurePage`, `ps-print`,
helpers, TemplateEngine wiring) 2.0 kB, glossary 0.7 kB, `ps-staff` 0.75 kB, `prof-rules` 0.5 kB, Time mounts 0.8 kB,
registry / shared / presets / packs / features / sync / bin / export rows ≈ 2.5 kB. Trimming options for the lead: drop
the profitability view (≈ −1.5 kB), the year-end accrual posting (keep the paper, ≈ −0.8 kB), the letters view (the
engagement list already makes letters, ≈ −0.8 kB), the CSV buttons (≈ −0.6 kB), the WIP write-off reversal (≈ −0.4 kB),
shorten the Hindi / English desk strings (≈ −1.5 kB).

## PS-C — Export of services and multi-currency (pack `svcexport`)

### What shipped

| Item | Where |
|---|---|
| C1 export check | `prof/ps-export-check.ts` `exportCheck({ invoice, client, engagement, receipts, irms, date })` — the five Sec 2(6) IGST conditions, each `ok / fail / pending / unknown` with a reason key: (i) the sender's State / GSTIN; (ii) `Client.ps.country` (else place of supply 96), an Indian establishment receiving it fails; (iii) `prof/ps-pos.ts` `servicePos` — Sec 13(2) by default, 13(4) property (State code), 13(3) / 13(5) performed / held abroad, intermediary by the dated `INTERMEDIARY_POS_RULES` (supplier's location to 29 Mar 2026, Sec 13(2) from 30 Mar 2026, PS4); (iv) pending until a receipt (`movedNoCash` skipped, an adjusted advance counts) or an IRM, then foreign exchange, or INR only when the document is marked RBI-permitted (SRVA); (v) `Client.ps.relation: 'distinct_person'` (our own branch) fails. `verdict`, `withChecks` / `snapChecks` (→ `ps.export.checks` `{ key, ok }[]` + `checked_on`, printed by PS-A's paper as "n / 5"). Editor: lazy `ExportCheckChip` under the supply type (AdvancedTaxPanel) for an export / POS 96–97 document, `svcexport` only: chip with the reasons, the purpose code (`ps.purpose_code`, default `prof_settings.export.purpose_code`, else `PURPOSE_BY_KIND[prof_kind]`), the Rule 34(2) note on a foreign document; a draft snapshots, an issued document is never rewritten; the supply type is never changed. GST preflight: `preflightIssues` loads on demand (GstReports, LUT exports of the period, `svcexport` only) — a failing condition is a **warning**, (iv) pending an info line. Desk view *checker*: every export with its result, the party's facts (country, relation, Indian establishment → `Client.ps`) and the document's (place-of-supply class, property State, abroad, INR route / settled → `ps.export`). R8 indent note (TR21): `trade/tr-indents.ts` reads the same dated rule through `ps-pos.ts` — "not an export" only before 30 Mar 2026. |
| C2 FEMA 2026 | **Appended** to `trade/trade-rules.ts`: `EXPORT_REALISATION_MONTHS_RULES` row `2026-10-01 → 9` (old 9 / 15 rows untouched; goods read it too — X1 / PS15) and `EXPORT_REALISATION_INR_MONTHS_RULES` (`2026-10-01 → 12`; earlier dates fall back to the FX rule, `exportRealisationInrMonths`). `trade/export-register.ts`: `isServicesExport` (≥ 1 line, every line a service or SAC `99…`) starts the clock on the invoice date, never flagged; INR documents take the INR rule; rows carry `services` / `inrRule` (additive). `prof/ps-fema.ts`: `realisationRule`, `servicesRows` (a document marked "settled in INR" takes 12 months, PS15 (c)), `realisationReminders`. `prof/ps-edf.ts`: table `edf_register` (dated by `date` = the month end, `books.edit`, audited, backed up, synced, open export, recycle bin restore only while no live row covers the same month × kind × currency) — `prepareEdf(month, invoices)` groups the month's issued services exports by kind (software = SAC 998313–998319 / 997331) and currency, due `EDF_RULES` (30 days after the month end; services may file by the receipt date; small-value declaration only when every invoice ≤ ₹10 lakh); `edfDb.saveDrafts` writes once per month × kind × currency; `save` (EDF no. + filed day → filed; declaration → closed); `addSoftex` (history rows before 1 Oct 2026 only); `edfDueList`. Compliance: lazy `ExportSvcCalendar` on GST → Compliance (`svcexport`): EDF due, realisation due in 30 days, past due (ask the AD bank). |
| C3 IRM / FIRA / refund | `prof/ps-brc.ts` `brcRows`: per services export the IRMs, FIRA (`ExportIrm.ps.fira_no`, typed on the realisation view), e-BRC no. / date, realised FC / ₹, charges deducted abroad (receipts not reaching the IRMs, the fee a platform receipt noted, or a write-off naming charges; flagged above ₹10 lakh) apart from the unrealised rest. `prof/ps-refund-svc.ts` `refundSvcPaper` (Rule 89(4)(C) from the payment rows: receipts dated in the period + advance adjustments on services invoices of the period by advance date; adjusted total turnover worked out or typed; maths by the existing `rule894Refund`), `statementSheet` (CSV / XLSX), `saveDraftClaim` — one DRAFT `EXPORT_LUT_ITC` row of the existing refund register, updated in place. |
| C4 FX and platforms | `prof/ps-fx-rates.ts`: `cardCurrency`, `convertRate` (via the currency master's `rateOn`, ₹ per unit), `entryConversions` (pre-bill: entries whose work type's `ps.currency` differs from the fee note's currency), `atClosing` (year-end memo, PS37). Pre-bill: lazy `FxRateRow` ("USD 55/h ≈ ₹4,620/h = INR 4620 (ref. 31-10-2026)", "Convert at the master rate" fills the rows' rates through PS-A's `edits`; the line carries the converted rate as today, nothing new is snapshotted; Rule 34(2) note). `prof/ps-platforms.ts`: `prof_settings.platforms[]` (through `readProfSettings` / `saveProfSettings`), `planPlatformReceipt` (realised rate = ₹ credited ÷ net FC), `receiveViaPlatform` — one receipt of the gross at the realised rate (existing receipt + `fx-gain.ts`), one fee bill (SAC 997159; import of services RCM IGST 18 % when the platform is non-resident and the company registered) paid from the payout bank, note "Platform: … (fees …)" (the short reason), all or nothing (`withTablesRollback`). "Receive via platform" is a lazy self-contained button in the receipt dialog (foreign invoice, `svcexport`) and on the platforms view; default purpose code there. |
| C5 threshold | `prof/ps-threshold.ts` `thresholdCard` (FY turnover at ₹: taxable, exempt, export, inter-State, net of credit notes; RCM purchases never; `REGISTRATION_THRESHOLD_RULES` ₹20 lakh / ₹10 lakh in 13, 14, 15, 16; warn 80 %, over 100 % with the crossing day). `components/prof/ThresholdView.tsx` (default export, `compact` prop): for PS-D's Firm → Threshold view, and the Dashboard insight for `prof_kind = freelancer` (InsightsPanel, lazy). Crossing shows the register → LUT → tax invoices steps. The unregistered sentence prints from PS-A's `psDeclaration`. |
| Wiring | `TIME_TABS` `exportsvc` (pack `svcexport`), `Time.tsx` label, `PACK_TABS` (desk + five views, palette labels `r14.exportsvc*`), `PACK_HREF.svcexport → /time?tab=exportsvc`, Ctrl+K `time.exportsvc`, help topics `time:exportsvc[:view]`, checklist steps `lut` / `edf` (any professional kind with `svcexport`), demo: last month's filed EDF (`edf_register` in `DEMO_EXTRA_TABLES`). Rules in `prof-rules.ts` §PS-C (`INTERMEDIARY_POS_RULES`, `EDF_RULES`, `REGISTRATION_THRESHOLD_RULES`, `PURPOSE_CODE_EXAMPLES` as a dated row, `PURPOSE_BY_KIND`). Strings `i18n/areas/prof-r14c-export.ts`, `prof-r14c-threshold.ts`. |
| Tests / e2e | `ps-export-check` (incl. the TR21 note by date), `ps-fema` (rows append-only, services clock, INR rule, goods from 1 Oct 2026, older shipments unchanged), `ps-edf` (due dates, kinds, declaration, SOFTEX, registry), `ps-refund-svc`, `ps-fx-rates`, `ps-platforms`, `ps-threshold`; `export-register.test.ts` and `tr-agency.test.ts` unchanged. E2E "R14-C export desk". CA items **PS60–PS64** (`CA_REVIEW.md` §14.2). |

### Deviations (PS-C)

- `ps.export.checks` uses PS-A's declared shape `{ key, ok }[]` (+ `checked_on`); the purpose code lives at `ps.purpose_code` (PS-A's), not under `export`. `Client.ps.relation` uses PS-A's `'distinct_person'` for "our own branch" (the PRD said `own_branch`).
- Rate-card currency is read from the work type (`WorkType.ps.currency`, the only card PS-A declared it on); conversion happens on the pre-bill (where PS-A left it), not in `resolveRate` (callers can still pass `{ currency }`).
- The platform receipt's short reason is the receipt note ("Platform: …"), not a stored field; platforms and the default purpose code live in `prof_settings` (`platforms`, `export`).
- The threshold card is a component for PS-D's Firm desk (`firm&view=threshold`), which PS-D mounts; its help topic / PACK_TABS row come with the Firm desk.
- No glossary terms (bytes); EDF / FIRA are spelled out in the help topics.

### Bundle (PS-C)

Before = `claude/elegant-cannon-cwapiv` at `36881db` (PS-A merged); after = this branch. `vite build` + gzip -9.

| Budget | Before | After | Delta |
|---|---|---|---|
| Initial JS | 189,217 B | 189,226 B | **+9 B** (lazy-import map churn) |
| Total JS | 3,419,591 B | 3,446,649 B | **+27.1 kB** (aim 15, PRD 13) ✗ |

Breakdown (gz): desk with five views + `ps-brc` / `ps-refund-svc` 6.8 kB; strings EN + HI 3.9 kB; threshold card (+ strings, engine) 1.9 kB; `ps-edf` + `ps-fema` 1.7 kB; `ps-platforms` 1.5 kB; `ps-export-check` 1.4 kB; platform dialog 1.4 kB; editor chip 1.2 kB; pre-bill FX row 1.0 kB; help topics 0.6 kB; `prof-rules` §PS-C 0.6 kB; compliance card 0.55 kB; host wiring (Time label, Insights, receipt dialog, GST preflight, editor, export register, trade rules, palette, checklist, demo, open export, recycle bin) ≈ 2.5 kB; chunk churn ≈ 0.6 kB. Trim options: the SOFTEX / platform list editing UI, the refund statement XLSX, the threshold dashboard card (≈ −0.5 kB each), shorter Hindi strings (≈ −1 kB).
