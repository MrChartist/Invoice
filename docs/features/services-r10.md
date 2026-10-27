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
- **Tips** (A3.6) are not built: the type `Payment.tip_staff` and the setting `tips` exist; the POS tip tender, the
  "Tips payable" liability and the payout of tips are left for a later package (default is off anyway).
- **POS**: no staff picker on the POS line and no "staff required" block yet; lines from the appointment carry their
  staff. The customer-display "Now serving" line (`pos-display.ts`) is not wired; the queue view prints it.
- **Split into a tax invoice and a Bill of Supply** for a registered recipient is a note in the editor (two documents
  recommended), not an automatic split. Staff names on paper (`print_staff`) are not printed yet.
- **Hours**: the desk settings edit one open / close time for every day plus closed days (the stored shape keeps seven
  rows). Resize by drag is not built (edit minutes in the dialog). Deposit (`advance_id`) is a stored field; the dialog
  does not pick an advance yet.
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
