# Round 10 — service businesses (feature notes and the API for SV-B / SV-C / SV-D)

PRD: `docs/prd/round-10.md`. CA items: `docs/CA_REVIEW.md` §10 (SV1–SV26). Every GST / TDS figure here is a working
paper — verify with your CA. One section per package; each package edits only its own section and records its own
bundle numbers.

## SV-A — Service profile and the shared front desk

### What shipped

| Item | Where |
|---|---|
| A1 profile | `service_kind` (settings, additive, `types/services-r10.ts`) under business type `services`: clinic, lab, salon, fitness, coaching, workshop, appliance, professional, other. `shop-presets.ts` `SERVICE_KINDS` / `SERVICE_PROFILES` / `applyServiceKind(kind, { registered, pharmacy })` (registered adds `gst`; pharmacy — clinic only — adds `inventory` and the R9 `pharmacy` pack). Switches in `services/sv-profile.ts` (`serviceSwitchesFor`, `applyServiceSwitches`) fill only unset keys of the company object `service_settings` (`sv-settings.ts`, owner only, audited on save, backed up, synced as a singleton). Picker `components/services-r10/ServiceKindPicker.tsx` in the setup wizard and Settings → Features (+ "Custom", + "Do you sell medicines from the clinic?"). Packs `clinic`, `salon`, `fitness`, `workshop` (`industry-packs.ts`, Features rows, `PACK_HREF`); Features row `adv.serviceProfile`. Checklist steps `serviceProfile` (an existing services company until it picks), `doctorProfile`, `serviceMenu`, `staff`, `labTest`, `memberPlan`, `batch`, `labourOp`, `jobCard`. `PACK_OF_TYPE` / `PACK_ROUTES` unchanged — every service profile keeps `time`, coaching keeps `recurring`. |
| Tabs | `TIME_TABS` (`page-tabs.ts`): `appointments`, `commission`, `clinic`, `members`, `workshop` (with `alsoPacks`); `Time.tsx` lists them through `visiblePackTabs` and mounts each desk lazily: `FrontDesk` (appointments + commission), `ClaimsView` (workshop `&view=claims`), `R10Stub` (clinic, members, the other workshop views) until SV-B / C / D replace their lazy target. Every R10 `PACK_TABS` row (36, incl. the fees views `batches` / `attendance` / `refunds`) has a help topic (`topics-packs.ts`), a palette label (`r10.*` in `palette-destinations.ts`), Ctrl+K titles (`time.*` in `discover-r6-tabs.ts`) and a few synonyms. |
| A2 appointment book | `services/sv-appointments.ts` (table `appointments`): booking, status flow `booked → confirmed → arrived → in_service → done → billed` / `no_show` / `cancelled` (reason required), walk-in tokens per day, `billLines` (one line per service, staff and appointment on `line.sv`, class rate by date), `appointmentDraft` (editor bill when the POS module is off), derived *billed* (`billedMap`: a live bill whose lines carry `sv.appointment_id`), no-show count, `wa.me` texts, tomorrow's list, birthdays across the year end. `sv-slots.ts`: slots over hours / step / weekly off / breaks, overlap (a warning, never a block), tokens. Desk (`FrontDesk.tsx`): day view (column per staff, click a free slot, drag to move), week view, queue with "Now serving", reminders & birthdays; Alt + ← / → day, N new; desk settings (hours, slot, rooms / chairs / bays, message templates, tax switches). `AppointmentDialog.tsx`: client (saved or walk-in), slot picker, staff, resource, services from the catalogue (minutes, price, tax class, staff per service), birthday / anniversary on a saved client. *Bill* opens `/pos?appt=<id>` (`PosAppointment.tsx`, one lazy line in `Pos.tsx`) with the services and staff, or a draft invoice. |
| A3 staff and commission | `sv-staff.ts` (tables `service_staff`, `commission_plans`), `sv-commission.ts` (`commissionFor(staff, month, data)`, pure: % of the line taxable value or ₹ per unit, item > category > kind, assist split, credit notes take back, cancelled / drafts earn nothing, redemption earns on the redeemed value, receipt basis pro rata skipping no-cash rows (`movedNoCash`), monthly slab add / replace on the excess), `sv-payouts.ts` (table `staff_payouts`: employee on payroll → payroll earning adjustment "Commission <month>"; else a journal Dr "Staff commission" Cr Sundry creditors with the staff as party and opt-in TDS 194J doctors / 194H others in the TDS register; never twice; undo through the journal / TDS / adjustment deletes). Views staff / plans / statement (`CommissionDesk.tsx`, CSV). Editor: staff per line (`SvEditor.tsx` `SvLineRow`, lazy in `ItemsTable.tsx`). |
| A4 service tax classes | `service-rules.ts` `SERVICE_CLASS_RULES` (2017-07-01 / 2022-07-18 hospital room above the limit 5% no ITC / 2025-09-22 beauty and fitness 5% no ITC; `verified: false`), `COMPOSITION_SERVICE_NOTE_RULES`. `sv-tax.ts`: `classPatch` (suggests rate / SAC / exempt column; a typed rate is kept), `rule46aApplies`, `offerSplit`, `itcCautionFor`, `svExemptLike` (Rule 42), `compositionNote`, `svExceptions`. Per-line `line.sv.exempt` (`EXEMPT` / `NIL` / `NON_GST`) reaches `gst-reports.ts` (one branch: the line's column wins in Table 8; NON_GST to 3B 3.1(e)); a 0% line without it stays nil-rated. Rule 46A: the editor snapshots `sv.rule46a` (switch on) and the paper title helper `svDocTitle` (`paper-helpers.ts`, inline test, no Round 10 import) prints "Invoice-cum-Bill of Supply" for a GSTIN-less recipient with taxable + 0% lines (GST, classic and receipt layouts). ITC caution on purchase bills (`bill-guard.ts`) and the exceptions checks `SV_RATE_OLD` / `SV_NIL_NOT_EXEMPT` (`gst-guards.ts`) come from `sv-hooks.ts`, loaded by one dynamic import in each host for service companies only. Common credit opens for clinic / salon / fitness (`PACK_GST_TABS`, `PACK_TABS` `alsoPacks`); `CommonCreditView` adds the no-ITC turnover to E (setting `no_itc_as_exempt`, default on). Composition notice: one-time line on the front desk (dismiss stores `composition_note_seen`). |
| A5 payer split and claims | `sv-claims.ts` (table `payer_claims`, `CLM/FY…`): `splitForPayer` (pure; per line approved taxable values or per head approved ÷ job total, each line divided exactly; beneficiary parts tagged `depreciation` / `excess` / `non_covered` / `disallowed`), `billClaim` (two draft invoices through the ordinary save; the job's own draft becomes the beneficiary's bill — or the payer's when the payer takes it all — so no number is skipped; record `sv.claim` and a "Part of claim CLM/…" note), `claimOutstanding`, `writeOffShort` (existing write-off, reason "Claim deduction"), `rejectAndRebill` (beneficiary re-bill, payer bill cancelled via `cancelDocument`, never deleted), `markClaimPaid`. Desk `ClaimsView.tsx`. |
| Demo | `demo/profile-services.ts` adds a front-desk block (three stylists, a plan with a slab, four appointments today) when the Demo company has a service pack; `DEMO_EXTRA_TABLES` lists the three tables. |

### API for SV-B / SV-C / SV-D

- **Types** (`src/types/services-r10.ts`): one block per package. SV-A declared every sub-field of the record key `sv`
  (`SvRecord`: `rule46a`, `claim`, `visit`, `admission`, `lab_order`, `referrer`, `membership`, `job`) and the line key
  `sv` (`SvLine`: `staff_id`, `staff_name`, `assist_id`, `assist_pct`, `exempt`, `cls`, `appointment_id`, `claim_part`,
  `redeem`, `recipe_qty`, `labour_op_id`). Both keys are in `R9_RECORD_KEYS` / `R9_LINE_KEYS` — do not add keys; put new
  snapshots under `sv`.
- **Names** (`services/sv-shared.ts`): tables, objects, series (`CLM`; `OPD`, `IPD`, `LAB`, `MEM` reserved in
  `SV_RESERVED_SERIES` — write your prefix once in your module and drop it from the reserved list).
- **Registry** (`services/sv-registry.ts`): add your rows in your block; every writer `import './sv-registry'`.
  `sync-engine.ts` and `trust/recycle-bin.ts` already import it. Add backup / sync / open-export rows in `// R10-B` …
  blocks.
- **Rules** (`service-rules.ts`): fill your section (types `HospitalRoomRule`, `CoachingRefundRule`, `RepairSacRule`
  committed); every row `{ from, value, source, verified }`, append-only.
- **Desks**: replace your lazy target in `Time.tsx` (`R10Stub` for `clinic` / `members` / `workshop`). `ClaimsView` is a
  default export — mount it from ClinicDesk `ipd` and WorkshopDesk `claims`. Help topics, palette labels and Ctrl+K
  titles for your views already exist; correct their wording in place.
- **Appointments** carry `kind: 'visit' | 'job'` for SV-B / SV-D (create the visit / job on arrival).
- **Commission**: `lineKind` reads `sv.redeem` (package redemption) and `invoice.sv.membership` (membership sale) — SV-C
  only has to set them.

### Deviations from the PRD (SV-A)

- **Freelance payout** posts a journal (Dr Staff commission, Cr Sundry creditors with the staff as party, opt-in TDS in
  the register) instead of a purchase bill — the `sales-commission.ts` pattern, with the same undo. Employees on payroll
  get a payroll adjustment tagged `bonus` (the `AdjustmentTag` union has no `incentive`; payroll types not edited).
- **Tips** (A3.6): shipped later as a 0% non-GST tip line (see "Deferred items — shipped" below), not a POS tender;
  `Payment.tip_staff` stays unused and there is no "Tips payable" liability (SV70 / SV71).
- **POS**: the staff picker per POS line shipped later (below); with "Staff required on service lines" on, a service line without staff blocks the POS save (`sv-pos.ts` `linesWithoutStaff`, reported by `PosStaff`; PENDING #21); lines from the appointment carry their
  staff. The customer-display "Now serving" line (`pos-display.ts`) is not wired; the queue view prints it.
- **Split into a tax invoice and a Bill of Supply** for a registered recipient is a note in the editor (two documents
  recommended), not an automatic split. Staff names on paper (`print_staff`) shipped later (below).
- **Hours**: the desk settings edit one open / close time for every day plus closed days (the stored shape keeps seven
  rows). Resize by drag is not built (edit minutes in the dialog). Deposit (`advance_id`): the dialog picks one of the
  client's open advances (shipped later, below).
- **Item form** `sv_class` select is not added to Settings → Items; the class is picked per line in the editor and per
  service in the appointment dialog (the line snapshots `sv.cls`). The catalogue field `sv_class` is read when present.
- **Client form** birthday / anniversary: set in the appointment dialog for a saved client (not in the client form).
- **Composition notice** shows on the front desk (not on GST → Compliance).
- **Claims**: the desk bills from a draft job bill (the job / admission engines arrive with SV-B / SV-D); per-line
  approvals are supported by the engine (`perLine`) but the desk asks for the approved total only.

### Bundle (SV-A)

Measured against `claude/elegant-cannon-cwapiv` at `5f0c499` (vite build, gzip level 9, the `check:size` method):

| | Before | After | Δ |
|---|---|---|---|
| Initial JS (first paint) | 189,130 B (184.7 kB) | 189,145 B (184.7 kB) | **+15 B (0.015 kB)** |
| Total JS | 2,961,101 B (2,891.7 kB) | 3,004,637 B (2,934.2 kB) | **+42.5 kB** |

First paint: the only shell-adjacent touch is `'sv'` appended to `R9_RECORD_KEYS` / `R9_LINE_KEYS`
(`invoice-defaults.ts` is its own lazy chunk). The service hooks are loaded by a dynamic import in `bill-guard.ts` /
`gst-guards.ts` and import neither host (an earlier static cycle split `bill-guard` into its own chunk and added a
filename to the entry's preload map: +40 B, removed). The remaining +15 B is preload-map bookkeeping of the hosts' new
lazy imports.

**Over the 14 kB share** (+42.5 kB). Breakdown (gz): front desk + appointment dialog + commission desk 10.9 kB; desk
strings en + hi 5.9 kB; claims desk 3.7 kB; engines (appointments 2.6, settings 1.5, tax 1.4, staff 0.9, rules 0.7,
hooks 0.6, slots / profile / registry / shared ≈ 1.1); editor row 1.2; help topics for all 36 Round 10 tab rows 2.0;
palette labels 0.9; reach / checklist / glossary / discover strings ≈ 2; picker 1.3; hosts (Time, Pos, ItemsTable,
GST guards, common credit, demo) ≈ 3.5. The PRD's 14 kB covered A's five items but not the Round-10-wide rows A owns
(every R10 help topic, palette label and Ctrl+K title, ≈ 3 kB) nor two languages of desk strings. Total JS stays under
the 3,000 kB budget (2,934 kB); SV-B / C / D then have ≈ 66 kB, above their planned 31 kB.

## SV-B — Clinics, dentists and diagnostic labs

### What shipped

| Item | Where |
|---|---|
| B1 patients | `services/sv-patients.ts`: `Client.patient` (UHID, age + `age_on` or a full `dob`, sex, guardian, blood group, referring doctor, allergies never printed); UHID `<prefix><yy>-<seq>` (`clinic_settings.uhid_prefix`, FY start year, editable, unique, falls back to R5-C `roll_no`); `findPatients` by UHID / phone / name (desk pickers); patients are written to `clients` directly (two patients may share a name — the name-merging `upsert` is not used). Company object `clinic_settings` (`settings.manage`, audited on save): UHID prefix, rooms, room-day rule, deposit alert, referral switch, rate-list names. `clinicDraft`: a saved draft tax invoice (Bill of Supply with every line untaxed when the profile has no GSTIN), Rule 46A switch snapshotted (`sv.rule46a`). |
| B1 OPD | `sv-opd.ts` (table `clinic_visits`, `OPD/FY…`): daily token per doctor, new / follow-up (last billed visit to the same doctor within `follow_up_days` → follow-up fee), status `waiting → with_doctor → done → billed`, `visitFromAppointment` (arrived appointments, doctor by its staff link), `billVisit` (consultation line class `health_exempt`, SAC 999312 from `HEALTH_CLASS_RULES`, the doctor's staff on the line, catalogue items added as extra lines by their class; record `sv.visit` {uhid, doctor, `doctor_reg`, token}). RT-B1 `doctors` gains `in_house`, `speciality`, `consult_fee`, `follow_up_fee`, `follow_up_days`, `staff_id`, `share` (types block `// SV-B`; `doctorsDb` reused, registry row stays RT-B's); edited in OPD → Doctors. |
| B1 paper | `paper-helpers.ts` `visitText` ("UHID … · Dr … (Reg. no. …) · Token n", printed by `AttentionLine` under the bill-to and by the receipt layout) and `svRegText` (header line in classic / GST / receipt layouts). Registrations on the sender profile (`SenderProfile.sv_regs`: CEA / state no. + validity, council, NABL, PCPNDT) in a lazy `ClinicRegsPanel` (ProfileEditor, clinic pack only). Bell (`sv-clinic-alerts.ts`, one gate line in `NotificationBell` for an explicit clinic pack): registration expiring within 60 days / expired, admissions open > 7 days, deposits short of charges by more than `deposit_alert`. |
| B1 rate list | `sv-rate-list.ts`: health-class items (catalogue + stock), second-language names and label (`rate_names`, `rate_lang`), A4 / A3, "Rates as on"; the printed signature is stored (`rates_printed`) and a price change shows "Rate list out of date — reprint". |
| B2 in-patients | `sv-ipd.ts` (table `admissions`, `IPD/FY…`): room snapshot, charges (stock items get their FEFO batch and stay `Goods` lines with their HSN so the stock reader moves them out), `roomDays` (midnight census / 24 h), `roomClass` (`HOSPITAL_ROOM_RULES`: ICU kinds exempt; > ₹5,000 a day from 2022-07-18 → `hospital_room_high` 5%), composite medicines / consumables exempt, interim print (`interimHtml`, not a document), discharge, `finalBill` (one draft, or with a payer claim the SV-A5 `billClaim` split reusing the draft), deposits = advance receipts at 0% attached by id, `applyDeposits` (existing advance adjustment after issue), refund of the excess through `refundAdvance`. Desk view mounts `ClaimsView`. |
| B3 lab | `sv-lab.ts` (tables `lab_tests`, `lab_orders` `LAB/FY…`): panels expanded without duplicates (a test inside a picked panel is not charged again), the tests snapshotted on the order, `rangeFor` (sex / age band, most specific wins), `flagOf` (H / L / CH / CL), sample flow, `enterResults` (partial / final; an edit after final keeps `history` and sets `amended_at`), delivery log, `billOrder` (exempt lines, `sv.lab_order`, referrer), `outsourcedDue` / `bookOutsourcedBill` (one purchase bill per reference lab and period, no GST / ITC, orders marked so never twice), analyser CSV paste, ranges as text, master CSV export / import. `sv-lab-report.ts` A4 report HTML (letterhead + NABL, patient block, department tables, flags bold, interpretation, two signers, "End of report", page numbers); `LabReportPrint.tsx` preview + print. Label preset `lab-sample` appended to `label-sheet.ts`. |
| B4 referrals | `sv-referrals.ts`: referral report by doctor from `sv.referrer` on visits / orders / admissions / bills (CSV); consultant fee share through the SV-A3 engine with a synthetic fee-share plan (% of the doctor's lines) or ₹ per visit; payout via `postPayout` (journal, opt-in 194J, never twice); referral payments / benefits only with `record_referral_payments` on → journal to "Referral fees — disallowable (Sec 37)" (created by name) with the caution in the narration and on the desk; 194R reminder above ₹20,000 of benefits a FY (`REFERRAL_CAUTION_RULES`). |
| Shared rows | `sv-shared` (tables, `clinic_settings`, series `OPD` / `IPD` / `LAB`, reserved list now `MEM`), `sv-registry` SV-B block, backup / sync (`DATED`, `NUMBERED`; admissions dated `admit_date`) / open-export rows (`// R10-B`), help topics (`time:clinic*` rewritten), e2e step "R10-B clinic desk", CA items SV27–SV30 (§10.6). |

### Shared-file rules

- Exempt lines carry `sv.exempt` (`clinicLine`), so they reach GSTR-1 Table 8 (exempt column) and 3B 3.1(c) through SV-A's branch.
- No cash / bank reader was added; deposits and refunds go through `advances.ts`, payouts through `sv-payouts.ts`.
- Deletes: visits / admissions / orders / tests through `setTable` (recycle bin); a row with a live bill refuses deletion
  (cancel the bill instead); numbers stay used in `series_counters`. Restoring a deleted visit / admission / order only
  brings back the row: billed state is derived from the live invoice, nothing posts again. A restored referral or
  fee-share journal is SV-A's / the voucher bin's rule (`staff_payouts` blocks a second payout of the same month).

### Deviations from the PRD (SV-B)

- Patient search by UHID / phone works in the clinic desk pickers and (shipped later) in the editor's client picker while
  the clinic pack is on.
- Consultant payout posts SV-A's journal (Dr Staff commission, Cr the doctor) with opt-in 194J, not a purchase bill.
- Referral payments post a journal to the disallowable ledger (Cr Sundry creditors, party = doctor), not a `staff_payouts`
  row; there is no tax-audit disallowance list in the app yet — the ledger name carries "disallowable (Sec 37)".
- Rate list second language: names typed per item on the desk (no automatic translation); header labels stay English.
- Interim bill and the lab report are script-free HTML prints; PDF through the browser's print.
- The doctor registration checklist step still reads `regLine` (a first-paint file); `sv_regs` is printed but not counted.
- No Demo-company clinic block.

### Bundle (SV-B)

Measured on `d6c126b` (before SV-D's merge), `vite build`, gzip level 9:

| | Before | After | Δ |
|---|---|---|---|
| Initial JS (first paint) | 189,145 B | 189,156 B | **+11 B** (the bell gate line) |
| Total JS | 3,004,637 B | 3,034,648 B | **+30.0 kB** |

After merging SV-C and SV-D (`e6761a9`): first paint 189,144 B (184.7 kB), total 3,077,346 B (3,005.2 kB of the raised 3,200 kB).

**Over the 12 kB share (+30 kB).** Breakdown (gz): clinic desk chunk 20.0 kB (seven views ≈ 10, en + hi strings ≈ 3.7,
lab / report / referral / rate-list engines ≈ 6); patients + OPD + in-patient engines (shared with the bell) 5.4 kB; bell
provider 1.0; registrations panel 0.8; hosts (Time, open export, bell, paper lines, profile, label sheet, backup, sync)
≈ 1.3; re-splitting of `sv-commission`, `sv-claims` and `rt-pharmacy-rx` into shared chunks (they were inlined into the
front desk / claims / pharmacy chunks) ≈ +1.5 net.

## SV-C — Memberships, packages, classes and attendance (salons, spas, gyms, yoga, coaching)

### What shipped

| Item | Where |
|---|---|
| C1 plans and memberships | `services/sv-members.ts` (table `member_plans`, `master.edit`, audited "Membership plan"; pure maths: `addMonths` / `baseEnd` — month ends clamp, 31 Jan + 1 month = 28 Feb — `endOf` with freezes, `statusOf`, `sessionsUsed` from live bills' `sv.redeem` lines + redeeming check-ins, `freezeError` (min / max days, max times, overlap), `unusedValue` pro rata by days (time-based) or sessions (package) at the old price, `redeemPatch`, `sessionText`, `renewals`, `forfeited`). `services/sv-memberships.ts` (table `memberships`, `doc.create`, audited "Membership", dated `start`, numbered `MEM/FY…`): `sellPlan` (ONE issued invoice for the whole price, taxed at sale — record `sv.membership`, so commission sees a membership sale; a wallet sells no bill), `freeze` / `unfreeze` (end moves by the frozen days; fee = own small bill), `upgrade` (unused value credited on one invoice for the difference with the credit on the line — or `service_settings.upgrade_mode = 'credit_note'`: a credit note on the old bill + a full bill), `transfer` (same row, history kept, fee billed to the old member), `cancelMembership` (refund none / pro rata / typed → GST credit note `valueNote` within Sec 34(2), refused past it), `renew` / `autoRenewDue` (successor from the day after the end, DRAFT bill — the desk runs it on open), `topUp` (wallet top-up = an advance receipt, GST on receipt; bonus % recorded, `useBonus` / `bonusLeft` — a discount, never cash), `deleteMembership` (refused while a live bill belongs to it). Redemption: `SvRedeem.tsx` — `RedeemChip` under each editor line (one lazy line in `ItemsTable.tsx`), `PosPackages` on the POS customer panel (salon / fitness pack, one lazy line in `Pos.tsx`): the line becomes ₹0, prints "Session 3 of 6 — MEM/…" in its description and carries `sv.redeem` (value = price ÷ sessions, SV-A's commission base); over-use, expired, frozen and uncovered items are refused. |
| C2 check-in and attendance | `services/sv-checkin.ts` (table `checkins`, `doc.create`, audited "Check-ins", dated `date`, ONE row per day): `findMembers` (MEM number, its last four digits, phone, name), `gateFor` (`service_settings.checkin_gate`, default `warn`), `checkIn` (duplicate refused, `redeem_on_checkin` packages use a session), `undoCheckin`, `footfall` (per day / hour), `notSeen` (churn list with `wa.me`). `services/sv-attendance.ts` (table `class_attendance`, `doc.create`, audited "Attendance", one row per class × day): `saveAttendance`, `attendanceOf` (late = present; held = meeting days of the month up to today, holidays skipped), `attendanceLine` → the R5-C dues reminder gains " Attendance this month: 18 / 22." (one line in `DuesPanel.tsx`). Member cards: label-sheet preset `member-card` (85.6 × 54 mm, 2 × 5; MEM number as the barcode). |
| C3 classes, PT, coaching refunds | `services/sv-classes.ts` (table `class_schedules`, `master.edit`, audited "Class / batch"): weekdays / time / dates / capacity / holidays, `occurrences`, `enrolMember` (place or wait-list), `dropMember` (first waiting moves up), `studentsOfBatch` / `setBatch` (`Enrolment.class_id`), `feeIncreaseWarning`. PT: a package plan with a trainer (`trainer_id`); each session redeemed on a bill line with the trainer as staff earns the "package redemption" commission. `services/sv-coaching-refund.ts`: `coachingRefund` (pure; refund = paid − course × used ÷ total, by days or started months; due = request + 10 days from `COACHING_REFUND_RULES`), `refundBasis` (course and paid on refundable heads: per-instalment heads unless `FeeHead.no_refund`; once-heads kept), `issueCoachingRefund` (credit notes across the instalment bills, tax reversed on the taxable part only; `Enrolment.refund`), `markRefundPaid`. Fees tab views `batches`, `attendance`, `refunds` (`FeesR10Views.tsx`, one lazy mount in `FeesTab.tsx`). |
| C4 service recipes | `services/sv-recipes.ts` `recipeReport`: kit services (`StockItem.kit` + default BOM — the engine already honours `unit_factor`, so no change to `events-kits.ts`) by product, service and staff; cost at the latest standard cost else the opening rate; `line.sv.recipe_qty` overrides per product. Members desk `recipes` view with CSV. |
| Desk | `MembersDesk.tsx` replaces `R10Stub` for Time → Members (views `plans`, `members`, `checkin`, `classes`, `recipes`); strings `i18n/areas/services-r10c.ts` (en + hi). Help topics for the members views reworded in place. |
| Shared rows | `sv-shared.ts` (5 tables, series `MEM`, dropped from `SV_RESERVED_SERIES`), `sv-registry.ts` SV-C block, backup (`// R10-C`, both lists), sync (`memberships` by `start`, `checkins` / `class_attendance` by `date`; `memberships` numbered), open-export rows, restore hooks in `trust/recycle-bin.ts` (a check-in / attendance day recorded again since stays in the bin; a membership whose sale bill now belongs to another membership stays). Demo: fitness / salon Demo companies get three plans, four members (one frozen), a week of check-ins and a yoga class. E2E step "R10-C members desk". |

### GST timing (CA items SV14, SV15, SV44–SV48)

- Membership / package: the whole price is invoiced and taxed on the sale date (Sec 13: invoice or payment, earlier).
- Redemption: a ₹0 line — the value was taxed at sale, so it is never taxed twice; it still shows the session.
- Wallet: the top-up is an advance receipt (GST on receipt); spending adjusts the advance as usual; the bonus is a
  discount on the later bill.
- Expiry / forfeiture: no GST event; `forfeited` lists the value per month for the books (**CA question SV44**).
- Upgrade (difference mode) taxes only the difference on the new bill; refunds are GST credit notes within Sec 34(2).

### Deviations from the PRD (SV-C)

- **Sale** is made from the Members desk (an issued bill, opened from the list for payment), not from a "Sell plan"
  button in the POS / editor. **Session text** prints through the line description (no `sessionText` branch in
  `paper-helpers.ts`, so no template change).
- **Auto-renew** makes the successor and a draft bill when the desk opens (not a `recurring` schedule: a schedule
  cannot create the membership row). No bell notice ("expiring this week"): the renewals list sits on the Members view.
- **`defer_package_income`** (PENDING #20, `services/sv-deferral.ts`): a switch under the forfeited list on Time → Members
  (owner; stores `defer_package_from` = the day it went on, so packages sold earlier are never touched). The sale bill
  still credits Sales in full; per ended month ONE journal (class "Package income recognised", dated the month end,
  `books.edit`) posts the net of packages sold in the month (deferred) less sessions redeemed (bills' `sv.redeem` lines +
  redeeming check-ins, × price ÷ sessions), packages expired with sessions unused and packages cancelled / upgraded in the
  month (recognised): net > 0 Dr Sales | Cr "Package income received in advance" (created on first use, other current
  liabilities), else the reverse. A month posts once (its journal names the month; delete it to post again). Sales is the
  default ledger: a company that books package income to another ledger adjusts by hand (CA item SV44).
- **Camera check-in** (PENDING #21): Check-in shows "Scan card with camera" where the browser has BarcodeDetector (the
  existing `scan/CameraScanner`, no library); one matching member is checked in, else the code fills the box. The member
  card stays a barcode of the MEM number (BarcodeDetector reads barcodes and QR alike); keyboard scanners still type it.
- **Class bookings** per occurrence (PENDING #21, `sv-class-bookings.ts`): on Members → Classes pick a day, then *Book*
  — an appointment on that date / time with `class_id` (additive), the class's staff and resource, no services. Only a
  meeting day (weekdays, dates, holidays), once per member, capped by the capacity of that day (cancelled / no-show
  bookings free the place). The term enrolment and its wait-list are unchanged.
- **Item form** "Products used per service" (PENDING #21): a lazy row on the stock-item form (salon / fitness / clinic /
  workshop pack, or an item already a kit) — product + quantity per service in its base unit; saving makes the item a
  kit (not stock itself) and writes the lines as its default BOM (`sv-recipe-form.ts`, `bomsDb.save`; other BOM fields
  kept). The bill-line override `sv.recipe_qty` is read by the report only (stock follows the BOM). Variance vs physical count: not built.
- **Fee increase** warning: `FeePlanForm` (R5-C) now calls `feeIncreaseWarning` after saving an edited plan (shipped later, below).
- **Coaching refund** records the request on the enrolment (no new table) and credits by value: the credited line keeps
  quantity 1 on a new line id, so the R5-C "creditable quantity" tracking is untouched; the total-credit cap still holds.
- **CA ids** SV44–SV48 (not sequential after SV26: SV27+ is SV-B's, SV41–SV43 SV-D's).
- **Found on the way:** saving any invoice upserts its client snapshot, and a fee bill's snapshot carries
  `enrolments` — re-saving an old fee bill (or a credit note copied from it) would reset the student's enrolments.
  `valueNote` strips `enrolments` from its snapshot; the R5-C editor path still has the hazard (lead to decide).

### Bundle (SV-C)

Measured against `claude/elegant-cannon-cwapiv` at `341fffb` (both built in the same directory, gzip level 9, the
`check:size` method):

| | Before | After | Δ |
|---|---|---|---|
| Initial JS (first paint) | 189,142 B | 189,134 B | **−8 B** (chunk-map noise; no first-paint file touched) |
| Total JS | 3,021,032 B (2,950.2 kB) | 3,045,925 B (2,974.5 kB) | **+24.3 kB** |

**Over the 12 kB aim** (PRD share 10 kB). Breakdown (each module minified alone, gz): engines ≈ 11 kB (memberships 3.8,
plan maths 2.1, coaching refund 1.3, check-in 1.2, classes 1.2, recipes 0.7, attendance 0.7); Members desk UI 5.4;
Fees views 1.9; redeem chip 1.0; strings en + hi 3.3; hosts / registries / backup / sync / export / restore hooks /
label preset / demo ≈ 1.3; re-chunking of the R5-C modules now shared with the coaching views ≈ 1. The PRD's 10 kB
assumed C1–C4 at the size of one desk; the four items carry seven engines (each with its writer, rules and history)
and two languages. Total JS stays under the raised 3,200 kB budget (2,974.5 kB).
## SV-D — Repair and service centres (vehicle workshops, AC / appliance service)

### What shipped

| Item | Where |
|---|---|
| D1 vehicles and appliances | `services/sv-assets.ts`: table `service_assets` (`master.edit`, audited "Vehicle / appliance"), kind `vehicle` / `appliance`; registration no. normalised (`normReg`, `MH12AB1234`) and unique; make, model, variant, fuel, year, VIN, engine no., colour, class (`hatch` / `sedan` / `suv` / `2W` / `3W` / `commercial`), serial / site for appliances, owner (client or name), insurer, policy no. / expiry, odometer readings (`withReading`; a reading below the last one is a warning, never a block, `odometerIssue`), next service date / km. History: `assetJobs` (newest first), `lastService`. Delete is a data-layer delete (recycle bin), refused while a job card names the asset. Company object `workshop_settings` (`settings.manage`, audited on save): checklist, job-card terms, labour rate per class, depreciation table, default service interval, parts warranty months. |
| D1 job cards | `services/sv-jobs-workshop.ts`, a thin layer over RT-D4 `retail/rt-service-jobs.ts` (same `service_jobs` table, `SVC/FY…`, `addJob` / `moveJob` / `canMove`): `openJob` adds the SV-D fields (asset, odometer in / out, fuel, customer voice, inspection checklist, promised time, bay = SV-A resource, technicians = SV-A staff, site visit + address, AMC) to the RT-D4 row. A site visit books an appointment (kind `job`, first technician) on the SV-A book. Statuses appended to RT-D4 (`types/retail-r9.ts` union + `WORKSHOP_MOVES` in `canMove`): `estimate_sent`, `awaiting_insurer`, `awaiting_parts`, `quality_check`; the phone flow is unchanged. `moveWorkshopJob` warns before *In repair* without a logged approval and, on delivery, records the odometer out and the AMC visit. Board by status with age colours (`board`). Prints (`WorkshopJobCardPrint.tsx`): job card with the terms and the customer's signature line; gate pass on delivery. `wa.me` "ready" message. |
| D2 estimates, approvals, labour | `services/sv-estimates.ts`: an estimate is a QUOTATION (status Sent, record `sv.job`) listed on the job (`quote_ids`); supplementary estimates are more quotations. `labourLine` (hours per class × class rate, unit HRS, or the op's flat price; SAC `REPAIR_SAC_RULES` by asset kind; 18%), `partLine` (stock item's HSN / rate), `subletLine` (cost + markup, repair SAC). `approveEstimate` logs `{quote_id, by, how, at, note}` and marks the quote Accepted. `billWorkshopJob`: every approved estimate's lines on ONE invoice (RT-D4's `jobLines` when no estimate was approved), parts and labour as separate lines at their own rates, AMC-covered labour dropped, issued parts settled back from WIP first, the job's advance adjusted, `doc_links` quote → invoice (`converted`), "Parts warranty until …" note, the asset's next service; a job whose claim needs two invoices is billed as a DRAFT for the split. `services/sv-labour.ts`: table `labour_ops` (`master.edit`, audited "Labour operation"; code unique), technician clock in / out (`clocks` on the job) → a NON-billable `time_entries` row with `job_id` / `staff_id` (never billed twice), `efficiency` (billed labour hours per `line.sv.staff_id` ÷ clocked hours). |
| D2 parts issue | `services/sv-parts-issue.ts`: issue = ordinary stock transfer (`STR/FY…`) main → `wip` godown "Jobs in progress" (created on first use, non-saleable); return = the reverse, never more than issued; `settleForBill` moves what is still issued back before the sale, so stock leaves once and company totals never change by an issue. Transfer ids on the job (`parts_issue`); the expanded job row shows issued vs estimated per item. |
| D3 motor claims | `services/sv-motor-claims.ts` over SV-A5 `payer_claims` (kind `motor`; `PayerClaim.mode` / `surveyor` / `survey_date` / `salvage`, declared in the SV-D block): `openMotorClaim` (job ↔ claim, salvage as a note, no stock entry), `depreciationPct` (user table first, then `MOTOR_DEPRECIATION_DEFAULTS` — insurer practice, not statute; metal by vehicle age bands), `motorSplit` (per line: approved − depreciation to the insurer; excess taken off labour lines first; tags `depreciation` / `excess` / `non_covered` / `disallowed`), `billMotorClaim` (splits the job's draft through `billClaim` — per line, or per head on the approved total), `motorBuckets` (survey pending, approval pending, delivered unpaid, short-paid). Cashless → two invoices (insurer in its own name / GSTIN, B2B); reimbursement → one invoice to the owner with "Claim with …" on it, unless the insurer client has `sv_insurer_invoice: 'insurer'` (checkbox on the claim form). The claims view mounts SV-A5's `ClaimsView` below the motor part (write-off of short payment, rejection re-bill). |
| D4 reminders and AMC | `services/sv-reminders.ts`: `nextService` (shortest op interval, else `workshop_settings.default_interval`; date = bill day + days, or earlier when the km per day from the odometer history reaches the km interval first; km = last reading + interval), `dueList` (service and insurance expiry due in 30 days / overdue), `reminderText` (en / hi `wa.me` text), `amcDue` (AMC contracts naming `asset_ids`: due visits per asset, skipped while an AMC job is open) → *Create job* (`amc_id`); delivery logs the visit with `visitFromJob` (`amc.ts`: additive `asset_ids`, `AmcVisit.job_id`, kept by `recordVisit`). |
| Desk | `components/services-r10/WorkshopDesk.tsx` (lazy in `Time.tsx`, replaces the stub and mounts the claims view): views `jobs`, `estimates`, `claims`, `reminders`, `labour`, `vehicles`; strings `i18n/areas/services-r10d.ts` (en / hi). Help topics of the six views reworded (`topics-packs.ts`); palette labels and Ctrl+K titles were already SV-A's. |
| Registry and data | `sv-shared.ts` (`assets`, `labourOps`, `workshopSettings`), `sv-registry.ts` SV-D block (`service_assets` / `labour_ops` `master.edit`, `workshop_settings` `settings.manage`; audit labels), `backup.ts` `// R10-D` rows, open-export rows. Neither table is dated or numbered (masters), so no sync row; the settings object syncs as a singleton. Every writer imports `./sv-registry` (and `../retail/rt-registry` where it writes `service_jobs`). |
| Tests | `sv-workshop-jobs`, `sv-estimates`, `sv-motor-claims`, `sv-reminders` (+ an SV-D block in `sv-registry.test.ts`); e2e step "R10-D workshop desk". |

### Deviations from the PRD (SV-D)

- **Status union**: the four workshop statuses are appended to `ServiceStatus` in `types/retail-r9.ts` (a type alias cannot be
  extended by declaration merging) and labelled in `i18n/areas/retail-r9d.ts` (the devices desk lists every job); the
  PRD said `retail-r9.ts` is not edited. `canMove` gets one additive map (`WORKSHOP_MOVES`).
- **`ServiceJobsView`** is not split out of `DevicesDesk.tsx`: the workshop board is its own (status columns, age, bay,
  technicians), so the devices desk is untouched apart from the strings.
- **Billing from estimates** writes the `doc_links` rows itself (one per approved quotation → the job bill) instead of
  `convertDocument` (which converts one source); quotations are marked Accepted on approval.
- **AMC**: `visitFromJob` lives in `amc.ts` as planned; the AMC tile and panel are unchanged; parts-warranty is a
  job-level "Parts warranty until …" note from `workshop_settings.parts_warranty_months` (serial warranty stays RT-D4's).
- **Claims split for cashless jobs** does not adjust the job's advance automatically (the draft is split first; apply
  the advance on the owner's bill). A reimbursement job adjusts it as RT-D4 does.
- **Technician time** is clocked on the job row (`clocks`) and saved as non-billable time entries; the R3-B timer is not
  reused (it is one timer per device).
- **Demo**: no workshop block in `demo/profile-services.ts`.
- **CA items** SV41–SV43 were added in `docs/CA_REVIEW.md` §10.6 (ids from 41 so they do not clash with SV-B / SV-C).

### Bundle (SV-D)

Measured against `claude/elegant-cannon-cwapiv` at `0772013` (vite build, gzip level 9, the `check:size` method):

| | Before | After | Δ |
|---|---|---|---|
| Initial JS (first paint) | 189,145 B (184.7 kB) | 189,142 B (184.7 kB) | **−3 B** (noise: nothing in the shell changed) |
| Total JS | 3,004,637 B (2,934.2 kB) | 3,021,032 B (2,950.2 kB) | **+16.0 kB** |

**Over the 10 kB aim** (+16.0 kB). Chunk view: `WorkshopDesk` 18.2 kB (which now also carries SV-A's claims view, 3.7 kB
that was its own chunk), and RT-D4's engine + strings moved out of `DevicesDesk` into a shared `rt-service-jobs` chunk
(6.1 kB in, 5.0 kB out of the devices desk: ≈ 1.1 kB of split overhead, unavoidable once two desks share the engine).
By module (minified + gzip, each alone): desk UI 6.8, strings en + hi 3.1, estimates / bill 2.5, motor claims 1.2,
reminders 1.3, assets + settings 1.5, jobs layer 1.5, labour + clocks 1.1, parts issue 0.9, prints 0.8, rules rows 0.4
(together ≈ 21 kB alone, ≈ 15 kB in one chunk). The PRD's 9 kB assumed the job board came from RT-D4; the workshop board,
the six views and both languages of their strings are new. Total JS stays under the 3,000 kB budget (2,950.2 kB).

## Deferred items — shipped (after QA round 13)

| Item | Where |
|---|---|
| SV-A staff on POS lines | `services-r10/PosStaff.tsx` (lazy; `Pos.tsx` mounts it only with a `salon` / `fitness` / `clinic` / `workshop` pack and lines on the bill): one select per line sets `sv.staff_id` / `staff_name` through `services/sv-pos.ts` `withStaff`. The editor's `SvLineRow` uses the same helper. |
| SV-A staff name on paper | Desk settings "Print the staff name under each line of the bill" (`service_settings.print_staff`). While on, a line given a staff (POS, editor, appointment `billLines`) snapshots `sv.staff_print`; the paper prints "Staff: <name>" under the line (`paper-helpers.ts` `staffText`, in `trackingText` and the 80 mm `ReceiptBody`) **only from that snapshot**, so plain invoices and bills made with the switch off print unchanged. |
| SV-A tips | Desk settings "Tips on the bill" (`tips: 'pass-through'`, default off). The POS strip adds one line "Tip — <staff>" (0%, `sv.tip`, `sv.exempt: 'NON_GST'`, the staff on it; `sv-pos.ts` `tipLine` / `setTip`, never two). Commission (`sv-commission.ts`): a tip line never earns commission and stays out of the base and the slab; the statement adds it in full (`Statement.tips`, inside `total`; on receipt basis it counts on the bill's date), a "Tips passed through" CSV row. Payout (`sv-payouts.ts`): the journal / payroll earning pays commission + tips, the row keeps `tips`, the freelancer TDS suggestion is on the commission only. Fee-share (`sv-referrals.ts`) keeps tips separate from per-visit amounts. GST and books treatment: **SV70 ★ / SV71**. |
| SV-A deposit | `AppointmentDialog.tsx`: for a saved client, a "Deposit (advance)" select of the client's open advances (`advances.ts` `openAdvancesFor`) stored in `advance_id`. The advance is applied to the bill the usual way (Receipts → Advances); nothing posts from the appointment. |
| SV-B client picker search | `services/sv-find.ts` (`uhidOf`, `patientMatch`, storage-free) is shared by the clinic desk's `findPatients` and `modals/ClientSearchModal.tsx`, which matches UHID / phone (4+ digits) and shows the UHID only while the `clinic` pack is on. |
| SV-C fee increase | `FeePlanForm.tsx` calls `feeIncreaseWarning` (lazy import after the save of an edited plan) and shows "Fee increased during the course: n enrolled student(s)…". |

Strings in English and Hindi (`services-r10a.ts`, `sales.ts`, `packs-institutions-r5.ts`); help wording updated
(`time:appointments`, `time:commission`, `time:clinic:patients`). Tests: `tests/sv-deferred.test.ts`. Bundle: see the
QA13 follow-up note in `docs/prd/qa-round-13.md` (first paint +37 B for the whole follow-up, total JS +4.4 kB).
