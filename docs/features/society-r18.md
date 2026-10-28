# Round 18 — co-operative housing societies, apartment owners' associations and RWAs

PRD: `docs/prd/round-18.md`. CA items: `docs/CA_REVIEW.md` §18 (HS1–HS64). Working papers — verify with your CA.

## R18-A — Society core (profile, units and members, tariff, paper)

### What it does

- **Profile (A1).** A wizard card "Housing society / apartment association / RWA" (not a business type) and a Settings →
  Features "Society profile" row (every `nonprofit` / `services` company, and any company that has one; "Custom"
  clears it, nothing is deleted). `applySocietyKind(kind, { registered, currentPacks })` (`shop-presets.ts`) writes
  business type `nonprofit` (`services` for `agency`), the type's modules + `recurring` / `accounts` / `banking`
  (`registered` adds `gst`), `society_kind`, due days 15, the GST tax-invoice template, and an **explicit**
  `industry_packs` list = the company's ∪ `society` (the `nonprofit` type's donations pack is never switched on by it).
  Landing: `/recurring?tab=society&view=units` (`agency`: `&view=bills`, B). `PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE` and
  `PACK_ROUTES` are unchanged (every kind keeps `recurring`). Books → Funds and GST reports → Common credit list
  `society` in `alsoPacks` (Books now filters with `visiblePackTabs`).
- **Desk.** One `RECURRING_TABS` row `society` (pack `society`), mounted lazily from `Recurring.tsx`
  (`components/society/SocietyDesk.tsx`, views in `&view=`): A writes `units` and `heads` (label "Tariff"); B–D add
  their views to `VIEWS` in their own `// R18-x` block — views, never tabs.
- **Units and members (A2).** Table `society_units` (`master.edit`, audited, synced, backed up, open export; not dated).
  The form: wing (the code is suggested from it: `A-101` → `A-102`), code (unique per company, case / spaces ignored),
  use, carpet / super area, undivided %, construction cost, parking slots (a count; `P1…`), the owner (picked from the
  client list by name or created with the typed name), occupancy and tenant (recorded, never billed — HS34), and the
  unit's own amount for every `typed` head (property tax as assessed — HS44). Saving re-links members:
  `Client.hs = { unit_ids, role }` (owner / joint / tenant; the owner role wins; a client with no unit left loses `hs`),
  in one `withTablesRollback` over units and clients. The grid filters by wing and occupancy, totals carpet area, cost
  and slots, and warns (never blocks) when undivided interest does not add up to 100 ± 0.01 %.
- **Unit import (A2 criterion 4, closed after R18).** Units view → "Import CSV / XLSX" (and "Template"): CSV through
  `csv.ts`, XLSX through the dynamic `xlsx.ts` (`marketplace/file-read.ts`), headers scored by `import-mapping.ts`'s
  `scoreHeader` (all three, and `backup.ts`, load only when a file is chosen). Template `code, wing, use, carpet_area,
  super_area, undivided_pct, construction_cost, owner, phone, email, occupancy, tenant, parking` (`tenant` may be a name
  or yes / no; `parking` a count or slot names). `planUnitsImport` (`hs-units-import.ts`, pure) previews each row: an
  existing code is updated (only the columns given), a new one created; owners / tenants match clients by name (another
  phone is a warning; an existing client is never changed), unknown names are listed and created on "Import". Any row
  error blocks the import; `applyUnitsImport` (`hs-units-save.ts`) re-plans on live data, writes units, new members and
  links in one `withTablesRollback`, then one `import_runs` row of kind `society_units` (fail-soft). One undo copy
  (`saveSafetySnapshot('import')`) is taken first; "Undo import" restores it.
- **Tariff (A3).** `society_settings.heads: HsHead[]` — kind (14 kinds; `statutory` = pass-through dues, `outsider` =
  non-member income), basis (`per_unit`, `area_carpet`, `area_super`, `undivided_pct`, `cost_pct_pa`, `per_slot`
  (+ `slot_rates` by kind), `pct_of_head` (non-occupancy: % of the `service` heads, let units only), `typed`,
  `fixed_member`), rate, SAC (member heads 999598, `outsider` 997212, none for `statutory`, HS9 / HS10), on / off,
  from / to. `unitCharges(unit, heads, period)` (`hs-tariff.ts`, pure) gives each head's amount for the period (month ×
  cycle months, paise-rounded per head) and its basis text; `chargeTotals` splits member heads (counted in B's ₹7,500
  test), statutory dues and non-member income. Periods: `YYYY-MM`, `YYYY-Qn`, `YYYY-Hn` — FY quarters / halves of the FY
  starting in April of YYYY (`periodRange`, `periodOf`).
- **State rule sets.** `STATE_SOCIETY_RULES` (`society-rules.ts`) are data rows by State code and date (MH 27, KA 29,
  TN 33, DL 07), read with `stateRuleAt(state, date, confirmed)`: interest cap, non-occupancy cap, fund minimums,
  education ₹ / member, default bases per head kind, audit due months, register style. "Apply State defaults" creates the
  seven-head tariff (service, sinking, repair, property tax, parking, non-occupancy, education) with the State's bases
  and rates, or fills zero rates of an existing tariff (a basis or rate the user typed is kept). Hints, never blocks:
  `fundLow` (sinking / repair below the State minimum, HS27), `nocHigh` (non-occupancy above the cap, HS19), `proposed`
  (the KA Bill rows, `in_force: false`, apply only after "In force for us" → `society_settings.confirmed`, HS33).
- **Preview.** The tariff view shows the current period's bill of the first 50 units (member charges, statutory dues
  outside GST, total) with totals for all units. B adds the ₹7,500 test column.
- **Paper (A4).** `parts/SocietyBlock.tsx` (lazy, after `ManpowerBlock`, before `GstBody`, never on receipt paper)
  prints from `hs` only: unit (and wing), area, member(s), period, due date, the heads table (head, basis, amount; ≤ 16
  rows) and `hs.decl` (B's regime sentence). `hsLineText` (paper-helpers, after `mpLineText`) prints a head's basis
  under its line when B fills `hs.heads[].line_id`. Documents without `hs` print exactly as before.
- **Checklist, help, Ctrl+K, demo.** Steps `societyUnits` / `societyTariff` (only with `society_kind`; B adds
  `societyRun`, D `societyFunds` / `societyAudit`). Help topics `recurring:society`, `…:units`, `…:heads`; Ctrl+K titles
  (`discover-r6-tabs`), palette labels `r18.*`, synonyms (`maintenance bill`, `मेंटेनेंस` …). Demo company only: "Demo
  Sunshine CHS" units A-101, A-102 (let out), A-901 (two slots), shop S-1 and the MH tariff (`demo/profile-society.ts`;
  the tariff object is written by `fillDemo` only in the Demo company and only when absent).

### Storage

| Key / field | Kind | Backed up | Synced | Audited | Right |
|---|---|---|---|---|---|
| `society_units` | table (not dated) | yes | yes | yes (`Society unit`) | `master.edit` |
| `society_settings` (state, cycle, bill day, due days, heads, area unit, confirmed; B–D sub-fields) | object | yes | singleton | on save | `settings.manage` |
| settings `society_kind` | additive | yes | yes | yes | — |
| `Client.hs` (`unit_ids`, `role`, `member_no?`) | additive | yes | yes | yes | — |
| record key `hs` (`R18_RECORD_KEYS`) | additive | yes | yes | yes | — |

`society_settings` is not written when the profile is picked: `societyDefaultsFor(senderState, stored)` fills the
defaults (sender's State, monthly, bill day 1, 15 days, sq ft) when the desk reads it, so a company that never opens the
desk stores nothing.

### Decisions and deviations

- **Cuts at the 11 kB cap (PRD §3, in order).** Cut 1: no "How your bill is worked out" footnote (`hs.explain` is
  declared but not printed; the heads table carries each basis). Cut 2: no `per_inlet` / `per_lifted_unit` bases
  (water by inlets and lift charges are typed per unit; MH's default bases fall back accordingly). Cut 3: no CSV / XLSX
  unit import — *closed later*: see "Unit import" below. Further trims to
  stay at the cap: the unit grid filters by wing and occupancy (not use), the unit form has no joint-owner, floor or
  per-slot-kind fields (the shape keeps them), no delete button — *closed later*: the form has "Delete" and a "Closed"
  tick; `deleteUnit` refuses while a bill / run names the unit (close it instead) or a member is linked (clear owner /
  tenant first, so a restore never has to re-link clients), else `setTable` on the watched table → recycle bin, the owner is typed / picked by name (no phone field), no bill-day or
  area-unit input (defaults), no separate paper CSS (the R17 particulars box styles are shared), no glossary terms.
- **No `hs-profile.ts` / `hs-units-import.ts` / `UnitForm`-level member sub-form.** The profile's defaults live in
  `hs-settings.ts` (`societyDefaultsFor`), read lazily; the wizard and Features write only the settings patch.
- **Entity form.** `EntityType` gains `cooperative` / `association` in D2 (type only); the wizard does not write the
  annual pack's entity type in A (D does, with the label map).
- **PACK_TABS.** A lists the desk and its own two views; B–D append their view rows (the R17 practice), so every listed
  row has a help topic.
- **Rows `verified: true`** are exactly: `SOCIETY_GST_RATE_RULES@2017-07-01`, `SOCIETY_SAC_RULES@2017-07-01`, the KA Bill
  row and the TN Act row (texts read this round; the KA row is `in_force: false`, its date a placeholder).
- **E2E** picks the profile in Settings → Features (as R15-B / R17-A), sets the tariff before the units (property tax
  is typed per unit), then checks the preview (A-101 ₹6,710, A-102 ₹7,010, A-901 ₹12,010 — GST is B's).

### API for R18-B / C / D

- Names: `HS_TABLES` (B adds `runs: 'society_runs'`), `HS_OBJECTS.settings`, `HS_DATED` (B: `society_runs: 'date'`, plus
  the `sync-engine.ts` DATED row), `HS_PACKS` — `src/lib/society/hs-shared.ts`. Registry blocks: `HS_TABLE_ACTIONS` /
  `HS_WATCHED` in `hs-registry.ts` (B: `society_runs: 'doc.create'`, label "Society run"); extend
  `tests/hs-registry.test.ts`; add the table to `backup.ts` (both lists) and `trust/open-export-schema.ts`.
- Types (all declared in `src/types/society-r18.ts`): `HsSnapshot` (`unit`, `period`, `due`, `heads`, `explain`, B
  `run_id` / `test` / `regime` / `decl` / `levy`, C `arrears` / `interest`, D `funds`), `SocietyRun`, `SocietySettings`
  (B `gst`, `run_limit`; C `interest`, `allocation`, `certificate_validity_days`; D `funds`, `fund_transfer`, `audit`),
  `SocietyUnit` (C `certificates`, `transfers`; D `share_cert`, `nominees`, `admitted_on`), `ClientHs`.
- Settings: `readSocietySettings()`, `saveSocietySettings(patch)` (owner; keeps unknown keys; cleans heads),
  `societyDefaultsFor(state, stored)` — `hs-settings.ts` (imports the registry).
- Units: `loadUnits()`, `saveUnit(input)`, `addMember(name)` (`hs-units-save.ts`); pure `validateUnit`, `cleanUnit`
  (keeps C / D fields), `memberLinks(units, clients)`, `memberNames`, `sortUnits`, `filterUnits`, `unitTotals`,
  `unitWarnings`, `suggestCode` (`hs-units.ts`).
- Tariff: `unitCharges(unit, heads, period, { member?, areaUnit? })` → `HsHeadRow[]` (`member: false` leaves out
  `fixed_member` heads for a member's second unit), `chargeTotals(rows)` → `{ member, statutory, outsider, total }`,
  `periodRange`, `periodOf`, `sacFor(kind, date)`, `stateRule(state, date, confirmed)`, `pendingStateRule`,
  `applyStateDefaults`, `newHead`, `tariffHints`, `HEAD_KINDS`, `BASES`, `CYCLES` (`hs-tariff.ts`).
- Rules: `society-rules.ts` sections `// R18-B` (`RWA_LIMIT_RULES`, `RWA_VALUATION_RULES`, `REG_THRESHOLD_RULES`) and
  `// R18-D` (`INCOME_TAX_SOCIETY_RULES`) are empty and wait for their packages; `STATE_SOCIETY_RULES` holds
  `interest_cap_pct` (C1: split a segment at a row date), `audit_due_months` and `registers` (D3).
- Paper: `societyPaper(hs)` / `periodText` (`hs-print.ts`); `SocietyBlock.tsx` already prints `hs.decl`; C / D add
  `parts/society/*.tsx` parts (arrears memo, interest line, fund note). B fills `hs.heads[].line_id` so `hsLineText`
  prints the basis under each line.
- Desk: add views to `VIEWS` in `components/society/SocietyDesk.tsx` (`HsViewProps = { notify }`, shared `Field` in
  `hs-ui.tsx`, `row` / `numIn` in `hs-form.ts`); strings in `society-r18b/c/d.ts` (`defineArea(en, hi)` with literal
  Hindi; shared words in `hsT`). Append PACK_TABS rows `r18.society.<view>` (+ palette label, help topic, synonyms).
- Checklist: add steps to `HS_STEPS` / `HsStep` and `societyFacts()` in `checklist-steps.ts` (+ `STEP_ORDER`, `ck.*`).
- Demo: append a block to `demo/profile-society.ts` (`society_runs` must join `DEMO_EXTRA_TABLES`).

### Bundle (R18-A)

Before = `claude/elegant-cannon-cwapiv` at `7bcccac`, after = this branch; `vite build` + gzip -9 (`check-bundle-size`).
Normalized = chunk hashes stripped from names and contents before gzip (raw totals move ±1 kB between builds from hashes
alone).

| Budget | Before | After | Delta | Cap |
|---|---|---|---|---|
| Initial JS (first paint) | 182.2 kB (4 files) | 182.2 kB (4 files) | **0 B** normalized (entry, runtime, vendor chunks byte-identical) | 0 ✓ |
| Entry chunk | 88.2 kB | 88.2 kB | 0 B | — |
| Core precache (English) | 3,136.9 kB | 3,147.1–3,148.7 kB | +10.2 … +11.8 raw across identical-size builds (hash noise); **+11.00 kB normalized** | 11 kB ✓ (at the cap) |
| Hindi pack | 344.9 kB | 346.5 kB | +1.6 kB (`lang-hi-society` 1.39 kB + wiring areas) | 8 kB ✓ |
| Hindi left in core | 21.4 kB | 21.4 kB | 0 | 0 ✓ |
| `lazy-leaves` | 16.8 kB | 17.4 kB | +0.57 kB (`society/hs-registry.ts`, `demo/profile-society.ts`) | 0.3 kB ✗ (see below) |

Chunks (normalized gz): `f-society` 4.52 kB (rules, tariff, units, print, shared, `society-r18a` English), SocietyDesk
3.99 kB (desk, units view, unit form, tariff view, `hs-units-save`, `hs-settings`, `hs-ui` / `hs-form`), SocietyBlock
0.45 kB (+0.07 kB: the R17 particulars CSS module now a shared chunk), picker 0.24 kB, wiring ≈ 1.2 kB (help 0.19,
wizard 0.13, checklist 0.13, presets 0.12, Ctrl+K 0.10, TemplateEngine 0.09, Features 0.07, Recurring 0.07, reach 0.06,
open export 0.06, demo dispatcher 0.06, palette 0.06, packs 0.04, discover 0.04).

`lazy-leaves` grows by 0.57 kB against the PRD's 0.3 kB guidance: the registry must stay a leaf (sync / recycle bin
import it) and the demo profile is a dynamic import from `demo/profiles.ts` (PRD path), so neither can join `f-society`;
the leaves group stays within its 20 kB limit (17.4 kB).

## R18-B — Billing run and GST

### What it does

- **Billing run (B1).** Society → **Bills** (`&view=bills`): a period (`YYYY-MM`, `YYYY-Qn`, `YYYY-Hn`), bill date (the
  period's first month, `bill_day`) and due date (`due_days`); the plan line ("Planned: n bills (b bills of supply, t tax
  invoices, p plain, o non-member). Already billed: k. No member: …"); **Run period** issues every bill in **one
  `issueBatch`** (`sourceId: 'hs:<period>'`, `sourceKind: 'recurring'`, `mode: 'issue'`, `force: true`), numbered in each
  document's own FY series (tax invoices; `BOS` for exempt bills), period lock / approvals / sender snapshot intact, and
  records a `society_runs` row (`id`, `period`, `date`, `due`, `batch_run_id`, `unit_ids`, `counts`, `totals` by head,
  `levy?`, `undone?`) — all in one `withTablesRollback` over invoices, series counters, batch runs and runs. **Undo run**
  needs a reason: `undoBatch` cancels the documents (never deleted; numbers stay reserved) and marks the run undone; the
  period can then run again. The runs table lists period, date, documents by kind, total and status; "Open" lists the
  run's documents (unit, number → the document, regime chip, total, a WhatsApp link per bill — no bulk sender).
- **Idempotent.** Per (unit, period, document kind `main` / `outsider` / `levy:<name>`): billed state is derived from the
  live documents whose `hs.unit.id` / `hs.period` match (`billedKeys`, `billKind`), never stored. A run reads the units,
  the period's live bills and the society settings only.
- **One document per unit** (`planSocietyRun`, pure, `hs-run.ts`), units sorted by code; a unit without an owner is
  skipped ("No member"); a non-member head (`outsider`) goes on its own document, never mixed. A member's second unit
  pays `fixed_member` heads once (the owner's first unit by code). `run_limit` caps the bills of one run; the next run
  picks up the rest. Lines per head (SAC in `hsn`: the head's, else 999598 / 997212), no round-off; `hs` = unit, period,
  due, heads (each with `line_id`, so `hsLineText` prints the basis under its line), `run_id`, `test`, `regime`, `decl`,
  `levy?` (+ C / D sub-fields through `runExtras`).
- **GST per unit (B2, `hs-regime.ts`).** `hsRegime({ date, months, rows, registered, kind, valuation, outsider })`:
  counted = every head but `statutory` and `outsider` (interest and levies counted); limit `RWA_LIMIT_RULES` (₹5,000 from
  2017-07-01, ₹7,500 from 2018-01-25) × the cycle's months; the test is per unit. Regimes: `unregistered` (sender has no
  GSTIN → plain `INVOICE`, no tax), `agency` (`society_kind = 'agency'` → tax invoice 18 % on every non-statutory head),
  `exempt77c` (≤ limit → `BILL_OF_SUPPLY`, `exempt_kind: 'EXEMPT'`), `taxable_whole` (default, Circular 109 Q5 → tax
  invoice 18 % on the whole counted amount), `taxable_excess` (Tariff → "₹7,500 test" = above the limit; one exempt line
  `limit × months` with `sv.exempt: 'EXEMPT'` and each counted head's share of the rest at 18 %), `outsider` (18 %).
  Statutory heads are pure-agent lines on every regime (`charge_head_id: 'rule33'` + `PURE_AGENT_CHARGE`, no SAC).
  The printed sentence is `hs.decl` (SocietyBlock). The rate is `SOCIETY_GST_RATE_RULES`. No GST reader was changed:
  tests prove an exempt bill lands in GSTR-1 Table 8 exempt, a taxable one in B2CS 18 % (B2B with a member's GSTIN,
  e-Invoice with the dues in `OthChrg`), the pass-through dues outside Table 8, B2CS and the HSN summary.
  The Tariff preview gains the regime chip column.
- **GST view (B3, `&view=gst`, `hs-turnover.ts`).** FY-to-date turnover of all live issued documents (exempt and
  taxable; credit notes reduce; pure-agent recoveries out, via `recoveryValue` passed in) against `REG_THRESHOLD_RULES`
  (₹20 lakh; ₹10 lakh rows for 13 / 14 / 15 / 16 `verified: false`), the units above the limit in the last run's period,
  the Circular 109 Q2 both-conditions table with the society's row highlighted, the hint "Registration may be required
  (Sec 22 / Circular 109 Q2). Verify with your CA." for an unregistered society in the taxable row, the period's exempt /
  taxable turnover with a link to GST reports → Common credit (which reads the same bills through GSTR-3B; no Rule 42
  change), and the pending Madras HC note (`pending-changes.ts` row `hs2_valuation`, area `society`, HS2).
- **Inward RCM hint (B3 cut 2 — kept).** Purchases → bill form: one lazy row (`components/society/parts/RcmHint.tsx`,
  `society` pack only) for a registered society's bill with a 99852x line from a supplier whose PAN is not a company's,
  not yet marked reverse charge: "Security services from a non-body-corporate supplier: reverse charge (N 13/2017-CT(R)
  entry 14). Verify with your CA (HS15)." (`rcmHint`, the rule row read from `manpower-rules.ts` by the component).
- **Special levy (B4 cut 1 — kept).** Bills → "Special levy": name, kind, basis (per unit, carpet / super area,
  undivided %), total → a one-off run (`society_runs.levy`, documents `hs.levy`) shared by the basis (paise residue on
  the last unit, `levyShares`), tested with the unit's regular bill of that month (its counted amount per month, HS3);
  a levy over the limit is taxed on its own whole amount (HS45). Once per unit and levy name; undo as B1.
- **Storage.** `society_runs`: backed up (both lists), synced (`DATED` by `date`), open export, audited ("Society run"),
  right `doc.create` (runtime registry), Demo removal clears it (`DEMO_EXTRA_TABLES`; no sample run). Recycle bin:
  a society bill comes back only while no live bill holds the same unit × period × kind; a run row only while no live
  run holds its period / levy — a restore never bills twice.
- **Help, Ctrl+K, checklist.** Topics `recurring:society:bills` / `…:gst`, palette labels `r18.society.bills` / `.gst`,
  PACK_TABS rows, synonyms (`maintenance bill`, `billing run`, `special levy`, `रखरखाव बिल`; `7500`, `bill of supply`,
  `20 lakh`), the Ctrl+K title of `recurring.society` extended; checklist step `societyRun` (rows of `society_runs`).

### Decisions and deviations

- **Volume.** Planning 2,000 units is one pure pass (under 1.5 s in the test), but issuing is bounded by `localDb.invoices.save`, which
  re-serialises the whole invoices table per document (`setTable` → `JSON.stringify`, first-paint storage): 300 bills ≈
  1.7 s, **2,000 bills ≈ 145 s** on the build machine (O(n²)). A bulk-save path would edit first-paint `storage.ts` /
  `localDb.ts` (0 B first-paint rule), so R18-B does not: the test issues 200 bills in one batch under 3 s, and
  `society_settings.run_limit` splits a large society's run into parts (each run continues where the last stopped);
  quarterly billing remains the documented answer. **For the lead:** a `localDb.invoices.saveMany` (one `setTable`). *Fixed after R18-B: see "Platform fix" below (2,000 bills ≈ 0.6 s).*
- **Bills / GST views are in the desk chunk** (static imports): five small lazy chunks cost ≈ 2.7 kB more in wrappers.
- **Common credit link** carries no pre-filled figures: the Rule 42 tab already reads the run's bills through the
  GSTR-3B engine (exempt Bills of Supply in 3.1(c)); the GST view shows the period's exempt / taxable for comparison.
- **The document value** (`taxable_value`) of a bill includes the 0 % pass-through line (invoice-calc, unchanged);
  GSTR-1 / 3B / HSN / e-Invoice and the turnover monitor leave it out (`isPureAgentLine` / `recoveryValue`).
- **Pending note**: the Madras HC row is a court order, not a Council recommendation; its own sentence says so (What's
  new prints it under the generic pending heading). `recommended_on` holds the year only (the order date was not read).
- **Rows `verified: true`** added: `RWA_LIMIT_RULES@2017-07-01` (Sl. 77(c) text), `@2018-01-25` (via Circular 109 Q1),
  `RWA_VALUATION_RULES@2019-07-22`, `REG_THRESHOLD_RULES` general row (Circular 109 Q2). Not verified: the 2025-09-22
  limit row and the special-category threshold rows.
- **CA items** HS45–HS51 (levy with an exempt regular bill, the excess-only invoice shape, B2B members / e-Invoice,
  non-member heads on a member's unit, special-category thresholds, the PAN body-corporate test, no round-off).

### API for R18-C / D

- Run engine (`hs-run.ts`, pure): `planSocietyRun(period, units, heads, ctx: RunCtx)` → `{ bills: UnitBill[], skipped,
  counts, totals, commercial }`; **`runExtras(unit, ctx)` → `{ rows: HsHeadRow[]; hs?: Partial<HsSnapshot> }`** — C adds
  its arrears memo / interest row (kind `other` is counted; give it a `head_id` such as `interest`) and `hs.arrears` /
  `hs.interest` in its `// R18-C` block, D its fund tags in `// R18-D` (the `hs` part is merged into the main bill only).
  `billKind(hs)`, `periodBills(invoices, period)`, `billedKeys`, `levyShares`.
- Regime (`hs-regime.ts`): `hsRegime(RegimeIn) → RegimeOut { regime, doc, counted, limit, months, rate, decl }`,
  `regimeLines(rows, regime) → HsLine[]`, `isCounted(row)`.
- Bridge (`hs-issue-io.ts`): `planRun({ period, date, due, levy? }, runId?)`, `issueRun(input) → { run?, invoices, plan,
  held }`, `undoRun(id, reason)`, `loadRuns()`, `societySettings()` (stored settings with the profile's defaults).
- Turnover (`hs-turnover.ts`): `fyTurnover(invoices, from, to, recovery)`, `regThreshold(state, date)`,
  `unitsAbove(invoices, period)`, `position(turnover, threshold, above)`, `rcmHint(bill, vendor, registered, rule)`.
- Strings `society-r18b.ts` (`hsbT`); `components/society/parts/RegimeChip.tsx`.

### Bundle (R18-B)

Before = `claude/elegant-cannon-cwapiv` at `34badc4` / `24d55d4` (same tree), after = this branch; `vite build` + gzip -9.
Normalized = chunk hashes stripped before gzip.

| Budget | Before | After | Delta | Cap |
|---|---|---|---|---|
| Initial JS (first paint) | 182.2 kB (4 files) | 182.2 kB (4 files) | **0 B** normalized (index, runtime, vendor chunks byte-identical) | 0 ✓ |
| Entry chunk | 88.2 kB | 88.2 kB | 0 B | — |
| Core precache (English) | 3,148.7 kB | 3,156.2 kB | +7.5 raw; **+8.04 kB normalized** | 10 kB ✓ |
| Hindi pack | 346.5 kB | 347.6 kB | +1.1 kB (`lang-hi-society` +0.82, pending +0.17, wiring) | — |
| Hindi left in core | 21.4 kB | 21.5 kB | +0.05 kB rounding: the two help-topic Hindi titles (`topics-packs`, the R18-A pattern) | — |
| `lazy-leaves` | 17.4 kB | 17.4 kB | +21 B (registry rows) | — |

Chunks (normalized gz): `f-society` 4.52 → 7.69 kB (+3.36: `hs-run`, `hs-regime`, `hs-turnover`, rules, `society-r18b`
English), SocietyDesk 3.99 → 7.33 kB (+3.52: Bills / GST views, regime chip, `hs-issue-io` bridge), RcmHint 0.32 kB,
recycle-bin +0.25, pending-changes +0.24, wiring ≈ 0.5 (help 0.15, Ctrl+K 0.14, palette 0.05, open export 0.05, purchase
form 0.07, checklist 0.02). Both cut items (levy, RCM hint) fit and are kept.

## Platform fix — one write per batch (`localDb.invoices.saveMany`)

R18-B found that issuing N documents in one batch was O(N²): every `localDb.invoices.save` re-serialised the whole
invoices table (and `clients.upsert` the whole clients table), so 2,000 society bills took ≈ 145 s.

- `localDb.invoices.saveMany(list)` runs, for each document in order, exactly the checks of `save` (roles, rights,
  period lock, approval and credit holds, the Rule 46 clash) against the rows saved before it, numbers it in its series
  (a per-call index of the keys in use and the last number given per series keeps it linear; series high-water marks
  still count), and writes the invoices table **once**; then each document's audit row, credit-note re-settlement and
  attachment release, and one `clients.upsertMany` / `items.upsertMany` for the parties and lines learnt. `save(x)` is
  `saveMany([x])[0]`, so a single save is unchanged.
- `clients.upsertMany` (and `upsert`): the shared parsed rows with only the changed rows replaced; a party learnt again
  unchanged writes nothing (it still takes the rights check the write would have made).
- The credit gate (`holdIfCreditBlocked` → `creditGate`) now receives the rows the document is saved against, so the
  second bill of a party in a batch counts the first (as one save after another did).
- `withIssueSnapshot` builds the receivables report once per run while the invoices table is unchanged (the party
  balance before the run, R6-C5).
- `issueBatch` uses the bulk path for a batch of services (every line `type: 'Service'`, no agency lot); a batch with
  stock lines keeps one save after another (its stock checks must see the batch's earlier documents).
- Audit: the same rows; within one batch the documents' rows come first, then the parties learnt (before: interleaved).
- Timings (one `issueRun`, this machine, `node:test`; before → after): 200 bills 1.11 s → 0.14 s; 600: 7.9 s → 0.14 s;
  1,000: 25.7 s → 0.20 s; **2,000: ≈ 145 s (R18-B's measurement) → 0.42 s** (the next month, reading 2,000 earlier bills
  and their receipts for arrears: 0.80 s). Tests: `tests/invoices-save-many.test.ts` (bulk = sequential:
  numbers, rows, clients, catalogue, audit; one write; a clash fails the batch whole; viewer refused; credit gate;
  2,000 bills); R18-B's volume test now issues all 2,000 planned bills in one batch under 3 s.
- First paint: **+204 B** gz normalized (`index` chunk; target ≤ 0.2 kB); core +0.37 kB (khata-actions, batch-invoices).

## R18-C — Dues, interest and collections

### What it does

- **Arrears and interest (C1, `hs-dues.ts`, pure).** For each live society bill of a unit: what it still owes on a day
  (receipts and credit notes reduce it from their date; inside a bill the interest line first, then the
  interest-bearing principal, then the pass-through dues — HS53). Simple interest on the open principal from the day
  after the due date (+ `grace_days`; `from: 'bill'` counts from the bill date) to the day before the next period, at
  `min(society_settings.interest.pct, State cap on that day)` (`rateOn`; the cap alone when no rate is typed): the MH row
  change of 2026-06-22 (21 % → 12 %) splits the period by day. The balance segments come from `computeInterest` (passed
  in by the bridge, 365 days, a receipt counts from the next day); never on interest (HS38) or on `rule33` lines (HS6);
  on a taxable bill the GST is in the base (HS52). Days up to the latest live bill's `hs.interest.through` were charged
  and are never charged again; an undone run frees its days. Interest needs an interest rule (`society_settings.interest`;
  none by default, so R18-B companies see no change).
- **On the next bill (`runExtras`, `// R18-C`).** `planRun` passes the dues index (all live society bills, receipts,
  `doc_links` credit notes) and `asOf` = the day before the period: `hs.arrears = { amount, as_of }` (a memo printed under
  the header — the old bills stay the receivable) and, when ≥ `min_amount`, an "Interest on arrears" row (kind `other`,
  counted in the ₹7,500 test, takes the bill's regime, HS7; its basis "21 Oct – 31 Oct @ 12 % on ₹5,510" prints under the
  line) with `hs.interest = { amount, from, to, pct, on, through }`. PRD §7: A-101's November bill ₹6,729.93, exempt
  (₹5,529.93 counted).
- **Dues view (`&view=dues`, C1–C3).** As-at date; per unit with open dues: member, months overdue, open dues, billed
  interest still open, interest to date (not yet billed), the last promise (R2-A4 `collection_notes`); filters by wing and
  ageing (1+ / 3+ months). Per unit: **Receipt** (amount and date → the split `allocate` suggests, interest first unless
  `allocation: 'oldest_first'`, each amount editable → `savePartyReceipt`, the khata receipt: one row per bill, the rest
  on account); **Waive interest** (amount ≤ open interest, reason and general-body resolution → one financial credit note
  per bill, `createFinancialNote`, no GST, audited — HS55); **Dues certificate** (principal, interest to the date, bills
  dated after it; `<unit>/DC/<n>`, valid `certificate_validity_days` (30), logged in `society_units.certificates`, shown
  and printable — HS56); **Transfer** (date, new member, premium, "dues settled" — refused while dues are open without
  the tick; `transferUnit` + `saveUnit` move the owner and re-link `Client.hs`; later bills go to the new member — HS57);
  **Statement** (the member's R2-A statement in Receivables, one per member for multi-unit owners); **Remind** (WhatsApp
  in the society wording). "Notice-board list" prints unit and amount only (no phone numbers). "Use society reminder
  wording" stores `SOCIETY_TEMPLATES` (English / Hinglish, every scheduled stage) in the R2-A5 reminder schedule.
- **Reminders never threaten (C3, `hs-reminders.ts`).** No word about water, power, lift, access, parking, gas,
  disconnection or withholding any service (`tests/hs-reminders.test.ts` greps every text; KA s.20(6) proviso, HS33).
- **Bank receipts matched by unit (C4 — kept).** `matchUnitInNarration` (pure, `hs-bank-match.ts`): `A-101`, `A101`,
  `A/101`, `101A`, `FLAT 101 A` (a code without a wing only after FLAT / UNIT / SHOP), exactly one unit; `amountFits` = an
  open bill or the whole dues. The reconcile strip (`RuleSuggestions.tsx`) lazy-loads `hs-bank-io.ts` only for a society
  and adds "receipt from the member" suggestions (label `A-101 = open bill`) for credits no rule or match caught; the
  existing bank-rules apply step settles the oldest bills (HS58).

### Decisions and deviations

- **No new table, no new key.** Certificates and transfers live on the unit (A declared them); interest / arrears under
  `hs`; receipts are ordinary receipt rows (no marker; `no-cash.ts` untouched).
- **The receipt form is the Dues view's**, saving through the khata's `savePartyReceipt`; the shared receipt dialogs were
  not edited (no pre-fill hook in them).
- **Statement columns.** The member statement is the existing R2-A statement (interest is a line of the bill there); no
  extra arrears / interest / fund columns were added.
- **Bank match amounts** compare open bills only (no interest to date), so the bridge needs neither `computeInterest` nor
  the society settings and stays in `f-society`.
- **CA items** HS52–HS58.

### API for R18-D

- `duesIndex(invoices, payments, links)`, `billDue(bill, events, asOf)`, `rateOn(settings, day)`,
  `unitDues(unitId, asOf, ix, settings, computeInterest)` → `{ arrears, interest, on, from, to, pct, bills }`,
  `allocate(amount, bills, mode)`, `duesRow(...)` (`hs-dues.ts`); bridge `loadDues`, `receiptSplit`, `recordUnitReceipt`,
  `waiveInterest`, `issueCertificate`, `transferMembership`, `applySocietyWording`, `reminderLink`, `printText`
  (`hs-dues-io.ts`); `transferError`, `transferUnit`, `nextCertificate` (`hs-transfer.ts`); strings `hscT`.

### Bundle (R18-C)

Before = this branch after the platform fix, after = R18-C; `vite build` + gzip -9, chunk hashes stripped (normalized).

| Budget | Delta | Cap |
|---|---|---|
| Initial JS (first paint) | 0 B | 0 ✓ |
| Core precache (English) | **+6.07 kB** (`f-society` +3.36: dues / transfer / reminders / bank match / strings; SocietyDesk +2.34: Dues view + `hs-dues-io`; RuleSuggestions +0.23; help, palette, Ctrl+K, packs ≈ 0.4) | 9 kB ✓ |
| Hindi pack | +0.69 kB (`lang-hi-society` +0.65) | — |
| Hindi left in core | 0 | 0 ✓ |

All four C items fit; nothing was cut.

## R18-D — Funds, accounts and statutory

### What it does

- **Funds (D1, `hs-funds.ts` + bridge `hs-books-io.ts`).** "Map funds" (owner) creates — once, by name — three R5-C4
  fund cost centres (nature `restricted`) "Sinking fund", "Repair and maintenance fund", "Major repair fund", their reserve
  ledgers (group Reserves) and `society_settings.funds`. From then on the run tags every fund-head line with its fund's
  `cost_centre_id` and the bill carries `hs.funds` (`hs-run.ts`, `// R18-D`). "Transfer for <period>" (`books.edit`) posts
  ONE manual journal (class "Society fund transfer", dated the period end; FY mode `fund_transfer: 'year_end'` → `FY2026`,
  dated 31 March): per fund Dr Sales (fund-tagged) / Cr the fund's reserve (fund-tagged) for the contributions billed in
  the period (bills, not receipts — HS39) less what the transfer journals dated in the period already moved — so a re-run
  posts nothing and a cancelled run is reversed by a new journal. The R5-C4 fund statement still shows the contribution as
  the fund's receipt (sales −, reserve +). PRD §7: sinking ₹2,250, repair ₹6,750. The Funds view (`&view=funds`) shows per
  fund for a FY: opening, billed, transferred, spent (utilisation), closing, the State minimum hints (`fundMinimum`, MH
  0.25 % / 0.75 % a year of the construction cost, HS27/HS60) and a link to Books → Funds.
- **I&E and R&P (D2).** `EntityType` gains `cooperative` / `association` (`types/books-r2.ts`); the annual pack's entity
  select offers them. For these the pack prints (same builders, same figures) "Income and Expenditure Account", "Excess of
  income over expenditure / (expenditure over income)", "I. FUNDS AND LIABILITIES" / "II. PROPERTY AND ASSETS", "Members'
  funds", share capital / members' contributions and "Reserve fund and other funds" (`notes-auto.ts` titles), and a
  **Receipts and Payments account** page + XLSX sheet (`hs-rp.ts`, pure over posting lines: opening and closing of the cash
  and real bank ledgers — clearing accounts left out by `AnnualPackTab` through `pickableBankAccounts` — receipts and
  payments by the other ledger of each cash voucher; contra nets out). The four existing entity types print exactly as
  before (`tests/annual-pack.test.ts`). The draft line stays.
- **Registers and audit (D3, `hs-registers.ts`, `hs-alerts.ts`).** The Registers view (`&view=registers`): List of
  members (MH "Form J"; elsewhere "Register of members", from the State row's `registers`), I register (MH, with the
  transfers count), share register, nomination register — printed (`escHtml`); per member the admission date, share
  certificate and nominees (`name:share %:relation`, no ID numbers) are edited on the unit. Audit tracker per FY
  (`society_settings.audit`): auditor, appointed, due date (State `audit_due_months` after 31 March — TN 3, KA 6 — else
  typed, `HsAudit.due_on`), report and (MH) rectification dates, status chip. The bell's `society` gate loads `hs-alerts`
  (`hsNotices`, explicit pack only): an unreported audit from 30 days before its due date, critical from 7 days / overdue.
- **Income tax (D4 — kept, `hs-itax.ts`).** Registers → Income tax: the FY's mutual receipts (member heads incl. interest
  billed to members) vs non-mutual income (non-member heads + interest / dividend income ledgers, read from the ledger),
  and for a co-operative society the deduction lines by the FY (`INCOME_TAX_SOCIETY_RULES`: Sec 80P(2)(c)(ii) / (2)(d) up
  to FY 2025-26, Sec 149(2)(c) / (2)(d) of the 2025 Act from 1 Apr 2026; ₹50,000 cap; both `verified: false`), the
  co-operative-bank flag (HS21) and the TDS note (existing payables rows, HS23). Nothing posts.
- **Checklist, help, Ctrl+K.** Steps `societyFunds` (funds mapped) / `societyAudit` (an audit row); topics
  `recurring:society:funds` / `…:registers`; palette labels, PACK_TABS rows, synonyms (`sinking fund`, `J register`,
  `80P`, `सदस्य सूची` …), the Ctrl+K title extended.

### Decisions and deviations

- **No new table.** Funds are existing cost centres / reserve ledgers / manual vouchers; audit rows sit in
  `society_settings`; register fields on the unit. `HsAudit.due_on` added in the types' R18-D block.
- **Idempotence by date range**, not by a reference string: a journal moves billed − already moved in the period; a FY
  journal counts its periods' journals. *QA21 W4:* a journal counts by the period in its narration (`— 2026-10`,
  `— FY2026`); a transfer whose range another transfer only partly covers (a month after the year-end or quarter journal)
  is refused, so modes cannot be mixed in a way that double-moves or reverses a fund.
- **"Excess only" valuation:** the exempt-portion line is not fund-tagged, so the fund statement then shows only the
  tagged part (HS59).
- **R&P lives in the f-society chunk** (`annual-pack.ts` imports `hs-rp.ts` statically): opening the annual pack loads
  that chunk (no extra precache bytes).
- **Income tax** reads no purchase bill (so `tests/purchase-contract.test.ts` is unchanged); the alerts / itax tests sit
  in `tests/hs-registers.test.ts`.
- **Demo:** no D block (funds are mapped on first use; no sample audit).
- **CA items** HS59–HS64.

### Bundle (R18-D)

Before = R18-C, after = R18-D (normalized).

| Budget | Delta | Cap |
|---|---|---|
| Initial JS (first paint) | 0 B | 0 ✓ |
| Core precache (English) | **+6.31 kB** (SocietyDesk +2.56: Funds / Registers views; `f-society` +2.10: funds, registers, alerts, itax, R&P, rules, strings; annual pack +0.57; fund-statement split into its own chunk +1.30 / r5c chunks −0.08 net; help, Ctrl+K, checklist, bell ≈ 0.5) | 9 kB ✓ |
| Hindi pack | +0.90 kB | — |
| Hindi left in core | 0 | 0 ✓ |

Round 18 after D (raw `check-bundle-size`): initial 182.3 kB (4 files), core 3,168.5 kB, Hindi pack 349.2 kB, Hindi in
core 21.5 kB, `lazy-leaves` 17.4 kB.

## QA round 21 (`docs/prd/qa-round-21.md`)

- **Place of supply (W2, HS65):** society bills take the building's State (`BatchContext.pos`), never a member's
  out-of-State address / GSTIN; `agency` keeps the client's place.
- **Transfer (W3, HS66):** `unitDues(…, owner)` — the run, the Dues row, the receipt split, the waiver and the bank hint
  read only the current member's bills; the dues certificate and the transfer check read the whole unit.
- **Funds (W4, HS67):** overlapping transfer ranges refused (see Decisions above).
- **Undo / waiver (W5, W6, HS70):** undo refused (naming the units) while a run bill carries a receipt or a live credit
  note; a waiver over several bills is one rollback.
- **R&P (W7):** clearing / client-money bank ledgers are left out whether the account is active or not
  (`nonCashBankLedgerIds`). **Hindi (W8):** unit validation / warnings and the bridges' errors. **Bin (W9):** a unit
  restores only while no live unit holds its code.
