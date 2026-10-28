# Round 18 — co-operative housing societies, apartment owners' associations and RWAs

PRD: `docs/prd/round-18.md`. CA items: `docs/CA_REVIEW.md` §18 (HS1–HS44). Working papers — verify with your CA.

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
  (water by inlets and lift charges are typed per unit; MH's default bases fall back accordingly). Cut 3: **no CSV / XLSX
  unit import** (and so no `import_runs` row of kind `society_units`); units are added one by one. Further trims to
  stay at the cap: the unit grid filters by wing and occupancy (not use), the unit form has no joint-owner, floor or
  per-slot-kind fields (the shape keeps them), no delete button (a unit is edited; deletes, when added, go through
  `setTable` on the watched table → recycle bin), the owner is typed / picked by name (no phone field), no bill-day or
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
