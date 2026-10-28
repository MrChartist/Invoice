# Round 19 — freight forwarders, customs brokers (CHA), courier franchisees and 3PL warehouses

PRD: `docs/prd/round-19.md`. CA items: `docs/CA_REVIEW.md` §19 (LG1–LG44). Working papers — verify with your CA.

## R19-A — Logistics core (profile, plumbing, job file, charge heads, paper)

### What it does

- **Profile (A1).** A wizard card "Freight forwarding, customs clearance, courier or warehouse" (not a business type)
  and a Settings → Features "Logistics profile" row (every `transport` company, and any company that has one; "Custom"
  clears it, nothing is deleted). `applyLogisticsKind(kind, { registered, ownLorries, extra, currentPacks })`
  (`shop-presets.ts`) writes business type `transport`, **explicit** `modules` = the `transport` preset ∪ `time` (an
  unregistered firm drops `gst`), `logistics_kind`, due days 30, the GST tax-invoice template and an **explicit**
  `industry_packs` list = the company's ∪ the kind's packs (`forwarder` → `logistics`; `cha` / `multi` → `logistics`,
  `customs`; `courier` → `logistics`, `courier`; `warehouse` → `logistics`, `warehouse`; `multi` adds the ticked
  `courier` / `warehouse`) ∪ `transport` only when "We also run our own lorries" is ticked — so the R5-B pack the type
  implies is never switched on by the profile. Landing: `/time?tab=shipments&view=jobs` (`courier` → `&view=courier`,
  `warehouse` → `&view=storage`; until D adds those views the desk opens Jobs). `PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE`
  and `PACK_ROUTES` are unchanged (every kind keeps `time`). The R14 `exportsvc` tab (and its Ctrl+K row) lists
  `logistics` in `alsoPacks` (exports of services to overseas agents).
- **Desk.** One `TIME_TABS` row `shipments` (pack `logistics`, `alsoPacks` customs / courier / warehouse), mounted from
  `Time.tsx` by file name through `import.meta.glob` over `components/logistics/*Desk.tsx` (the R14–R17 pattern).
  `ShipmentsDesk.tsx` holds the view map: A writes `jobs` and `rates`; B–D add their views in their own `// R19-x`
  block — views, never tabs (C / D add the `pack` filter with their pack views).
- **Job file (A2).** Table `lg_jobs` (dated by `date`, `doc.create`, audited `Job file`, synced, backed up, open export,
  recycle bin with a restore hook: the client must live and no live job may hold the same HBL / HAWB). Numbers from the
  one Round 19 series `JOB` (`JOB/FY26-27/0001`; `logistics_settings.job_prefix` gives a branch prefix such as
  `JOB-BOM`; numbers are never reused — a deleted job's number stays in `series_counters`). The form: date, status,
  direction, mode (multimodal legs), client, overseas agent, ports, destination country, incoterm, shipper / consignee,
  salesperson, branch; references by mode (HAWB / MAWB / flight, or HBL / MBL / vessel / voyage), shipping bill or bill
  of entry (+ IGM for imports); containers for FCL; packages, gross kg, CBM and dimension lines with the chargeable
  weight worked out live. Validation (`lg-job.ts`): errors block (date, client, ports, destination country for an
  export by sea / air, container shape 4 letters + 7 digits, HBL / HAWB unique per company); hints never do (ISO 6346
  check digit, SB / BOE date more than 30 days before the job). Close stamps `closed_on`; re-open clears it (both logged
  by the watched table). The jobs view: one FY with filters (status, mode, direction, client, agent), totals of jobs /
  chargeable kg / TEU, status chips, New job, Duplicate job (same parties / lane / mode, enquiry, no refs).
- **Chargeable weight.** `chargeableWeight({ gross_kg, dims, cbm, mode, settings })` (`lg-weight.ts`, pure): air =
  max(gross, Σ l·w·h·n ÷ 6000), courier ÷ 5000, both rounded up to 0.5 kg; sea LCL = W/M, max(CBM, gross ÷ 1000),
  rounded up to 0.01; other modes the gross. The divisors are settings (`logistics_settings.volumetric`, LG33), never
  rule rows. The seed: 5 × 120 × 100 × 50 cm = 3.0 m³ → 500 kg against 480 kg gross.
- **Charge heads (A3).** `logistics_settings.heads: LgHead[]` — kind (22 kinds), role (`own` / `pure_agent` / `exempt`),
  unit, default rate, currency, SAC, `pos_rule` (`auto` → `transport` for freight / courier / GTA, `intermediary` for
  commission, else `general` — `posRuleOf`, read by B2), `exempt_if`. "Default heads" adds 13 heads with SACs from
  `LG_SAC_RULES` (996521 sea, 996531 air, 996712 clearance, 996713 C&F / origin / documentation / handling, 996729
  storage, 996791 GTA …, LG5) and roles (duty, CFS, port, DO, insurance → pure agent, LG10 / LG36 / LG37; demurrage own,
  LG35); it never overwrites an edited head. `lgRateFor(kind, date, legs)` gives the mode rate by the document date from
  `LG_RATE_RULES` (vessel 5 % with the ITC note; air 18 %; multimodal 12 % to 21 Sep 2025, then 5 % / 18 % with an air
  leg; containers by rail; courier and supporting services 18 %), B's regime engine reads it.
- **Paper (A4).** `parts/LogisticsBlock.tsx` (lazy, after `SocietyBlock`, before `GstBody`, never on receipt paper)
  prints from `lg` only: job no., direction / mode, route (with the country), house / master bill, flight or vessel /
  voyage, shipping bill or bill of entry with its date, packages, gross / chargeable kg, CBM and `lg.pos_reason` (B's
  place-of-supply sentence). `lgLineText` (paper-helpers, after `hsLineText`) prints "Recovered at actual (Rule 33)"
  under a `rule33` line of a job document. Documents without `lg` print exactly as before.
- **Checklist, help, Ctrl+K, demo.** Steps `lgHeads` (every kind), `lgJob` and `lgBill` (not for a courier / warehouse
  kind) — only with `logistics_kind`; C adds `lgDeposit`, D `lgManifest` / `lgStorage`. Help topics `time:shipments`,
  `…:jobs`, `…:rates`; Ctrl+K title `time.shipments`, palette labels `r19.*`, synonyms (`job file`, `freight
  forwarder`, `जॉब` …). Demo company only (`demo/profile-logistics.ts`, dispatched by the `logistics` pack): job
  JOB/FY…/0001 (export, air, BOM → SIN, 500 kg chargeable) for the dataset's first client and the default heads with
  air freight at USD 2.00 / kg (the heads object is written by `fillDemo` only in the Demo company and only when absent).

### Storage

| Key / field | Kind | Backed up | Synced | Audited | Right |
|---|---|---|---|---|---|
| `lg_jobs` | table, dated (`date`), series `JOB` | yes | yes | yes (`Job file`) | `doc.create` |
| `logistics_settings` | object (singleton) | yes | yes | on save | `settings.manage` |
| settings `logistics_kind` | additive | yes | yes | yes | — |
| record key `lg` (`R19_RECORD_KEYS`) | additive | yes | yes | yes | — |

### Build plumbing

- `vite.config.ts`: `safeFamilyGroup(graph, 'f-logistics', familyRe('logistics', 'logistics-rules', 'logistics-r19',
  'lg-registry'), 12)`; `tests/bundle-config.test.ts` pins it. The registry is a lazy leaf (sync / recycle bin import
  it); `lg-settings.ts` / `lg-save.ts` import the registry, so they ride in the desk chunk; every pure engine and the
  rule file are in `f-logistics` (`tests/lg-rules.test.ts` reads `build-meta/chunks.json`).
- `LG` is in every CA-id regex, before `G` (`CA_LIST_RE` has no leading `\b`): `tests/docs-links.test.ts` and
  `tests/help-registry.test.ts` prove `LG1` is read whole, never as `G1`, and `G1` alone still reads as `G1`.
- `src/lib/logistics-rules.ts`: sections R19-A (`LG_SAC_RULES`, `LG_RATE_RULES`, `LG_EXEMPT_RULES`), R19-B
  (`LG_POS_RULES`, `OCEAN_RCM_RULES`, `EINV_EXEMPT_RULES`), R19-C (`CBLR_RULES`); keyed rows read with `keyedAt`. Rows
  not used yet are tree-shaken. `verified: true` exactly for PRD §2.4 rows 1–4, 6–10, 13–15, 28 (the source says
  "Read (R19)"); ocean-freight RCM, the GTA e-Invoice exemption, CBLR retention and KYC are `verified: false`.
- `src/types/logistics-r19.ts` declares every package's fields (A–D) in one commit; `store/invoice-defaults.ts` adds the
  one token `R19_RECORD_KEYS = ['lg']`.

### Decisions and cuts

- **Cuts at the 11 kB cap (PRD §3, in order).** Cut 1: no containers line / table on the paper (the containers stay on
  the job and in `lg.containers` for later parts). Cut 2: no lane rate sheets — no `lg_rate_sheets` table is registered
  (its type `LgRateSheet` stays declared), so no "Quote from sheet" and no quotation → job (`lg.quote` / `lg.lane` stay
  declared); each head's own rate is the default. Cut 3: no CSV / XLSX job import. Beyond the list (still over the cap
  after cuts 1–3): no ETD / ETA and seal inputs on the form (the fields stay on the record), no delete button
  (`deleteJob` exists for the data layer — recycle bin, live-document refusal; a job is cancelled by its status), no
  salesperson / branch filters (both on the job for D4), no Round 19 glossary terms (B–D may add up to 8).
- **No `lg-profile.ts`.** The profile patch lives in `shop-presets.ts` with the R12–R18 ones, and the profile writes
  nothing else (the heads come from "Default heads"), so the PRD's `lg-profile.ts` was not needed.
- **Writers in `lg-save.ts`** (jobs) and `lg-settings.ts` (the object): they import the registry, so they are outside
  the family (the R18 `hs-units-save.ts` precedent); `lg-job.ts` / `lg-weight.ts` / `lg-heads.ts` / `lg-print.ts` are
  pure.
- **GTA SAC.** The default GTA head takes 996791 from `LG_SAC_RULES` (annexure row read this round) instead of
  `gtaSac` through `lg-tax-io.ts`, so A needs no bridge; B's regime engine reads the GTA *rate* through `lg-tax-io.ts`.
- **Registry D rows.** `lg_manifests` / `lg_storage` are not registered by A (no writer yet): D adds its block to
  `lg-registry.ts`, `lg-shared.ts` (`LG_TABLES`, `LG_DATED`), `backup.ts`, `sync-engine.ts`, the open export and the
  recycle bin.
- **Paper styles.** The block reuses the R17 particulars box (`manpower-paper.module.css`, template variables only), as
  the R18 society block does, instead of a new `logistics-paper.module.css`.
- **Demo.** The job's client is the dataset's first client (a profile cannot add clients); the overseas agent comes
  with D's agent accounts.

### API for R19-B / C / D

- Names: `LG_TABLES.jobs`, `LG_OBJECTS.settings`, `LG_PACKS`, `LG_SERIES.jobs`, `LG_DATED` (`lg-shared.ts`). Rights /
  labels: append a block to `LG_TABLE_ACTIONS` / `LG_WATCHED` (`lg-registry.ts`); every writer `import './lg-registry'`.
- Jobs: `loadJobs()`, `saveJob(input, prefix?) → { job, hints }`, `setJobStatus(id, status, today)`, `deleteJob(id)`
  (`lg-save.ts`); pure `validateJob`, `cleanJob`, `filterJobs(jobs, { fy, status, mode, dir, client, agent,
  salesperson, branch })`, `jobTotals`, `duplicateJob`, `nextJobNumber(date, rows, prefix?)`, `jobPrefix`,
  `containerCheck`, `LG_STATUSES` / `LG_DIRS` / `LG_MODES` / `LG_SIZES` (`lg-job.ts`). B writes `LgJob.charges`, C
  `kyc_ok` / `auth`, D `courier` (declared).
- Weight: `chargeableWeight`, `volumeCm3`, `VOLUMETRIC_DEFAULT` (`lg-weight.ts`).
- Heads: `defaultHeads(date)`, `posRuleOf(head)`, `lgRateFor(kind, date, legs)`, `sacFor(kind, date)`, `headOk`,
  `LG_HEAD_KINDS` / `LG_ROLES` / `LG_UNITS` (`lg-heads.ts`).
- Settings: `readLogisticsSettings()`, `lgDefaultsFor(cur?)` (USD, kg, `split: 'pos_currency'`, `accrue: true`,
  `disb_posting: 'gross'`, volumetric 6000 / 5000 / 1000), `saveLogisticsSettings(patch)` (keeps keys it does not
  know), `addDefaultHeads(date)` (`lg-settings.ts`).
- Rules: `keyedAt(rows, key, date)`; `LG_POS_RULES` (`domestic` 12(8), `export` proviso from 2019-02-01,
  `cross_border` 13(9) → 13(2) from 2023-10-01), `OCEAN_RCM_RULES`, `EINV_EXEMPT_RULES`, `LG_EXEMPT_RULES`, `CBLR_RULES`.
- Paper: `logisticsPaper(lg)` (`lg-print.ts`); C / D add `parts/logistics/*.tsx` arms inside `LogisticsBlock`; the
  snapshot `LgSnapshot` (`lg.heads`, `regime`, `pos_reason`, `fx`, `disb`, `manifest_id`, `storage_id`, `agent`,
  `period`, `count`, `kg`) is declared for every package.
- Strings: shared words in `lgT` / `lgList` (`i18n/areas/logistics-r19a.ts`); B–D add `logistics-r19b…d.ts` (literal
  Hindi objects). Desk views: one entry each in `ShipmentsDesk.tsx` `VIEWS`.
- Tests: `tests/lg-{profile,registry,rules,pack-gate,job,heads,print}.test.ts`; the e2e step "R19-A logistics core".

### Bundle (R19-A)

Baseline measured on this branch before the first R19-A commit (`df085ff`, `vite build` + `check-bundle-size`): initial
182.8 kB (4 files), entry 88.8 kB, core 3,195.3 kB, Hindi pack 351.6 kB, Hindi in core 21.6 kB, `lazy-leaves` 17.4 kB.
Normalized = chunk hashes stripped from names and contents before gzip -9 (raw totals move ±1 kB between builds).

| Budget | Before | After | Change (normalized) | Cap |
|---|---|---|---|---|
| Initial JS (first paint) | 182.8 kB (4 files) | 182.8 kB (4 files) | **−1 B** (entry, runtime, vendor chunks otherwise identical) | 0 ✓ |
| Entry chunk | 88.8 kB | 88.8 kB | 0 | — |
| Core precache (English) | 3,195.3 kB | 3,206.9 kB | **+11,259 B = 10.99 kB** | 11 kB ✓ (at the cap) |
| Hindi pack | 351.6 kB | 354.0 kB | +2.33 kB (`lang-hi-logistics` 1.96 kB + wiring areas) | 8 kB ✓ |
| Hindi left in core | 21.6 kB | 21.6 kB | 0 | 0 ✓ |
| `lazy-leaves` | 17.4 kB | 17.6 kB | +124 B (`logistics/lg-registry.ts`) | 0.3 kB ✓ |

Chunks (normalized gz): `f-logistics` 4.05 kB (rules A rows used, job / weight / heads / print engines, shared names,
`logistics-r19a` English), ShipmentsDesk 4.13 kB (desk, jobs view, job form, rates view, `lg-save`, `lg-settings`,
`lg-ui` / `lg-form`), the picker in the wizard pickers chunk 0.41 kB, `profile-logistics` 0.39 kB, LogisticsBlock
0.32 kB, wiring ≈ 1.9 kB (shop-presets 0.22, wizard 0.20, checklist 0.19, help 0.18, Features 0.17, reach 0.15, Ctrl+K
0.12, Time 0.11, recycle bin 0.09, packs 0.08, paper mount 0.08, open export 0.06, palette 0.06 …).
