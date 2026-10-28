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

## R19-B — Billing, GST and job costing

### What it does

- **Regime per head (B2, `lg-regime.ts`, pure).** `lgRegime(head, job, ctx)` → `{ key, pos, mode, rate, supply?,
  itc_note?, reason, ca }` by the bill date. Keys: `domestic` (Sec 12(8): registered client → its State, else our State
  as the hand-over place, LG1), `export_freight` (12(8) proviso from 2019-02-01: goods to a place outside India
  (`dest_country` ≠ IN) → POS 96, IGST, reason "Place of supply outside India — Sec 12(8) proviso; IGST (Circular
  184/16/2022-GST)", LG2 / LG18), `cross_border` (client outside India: 13(9) destination of goods to 2023-09-30, 13(2)
  from 2023-10-01, mail / courier always 13(2); POS 96 → `EXPORT_LUT` when the R14 Sec 2(6) check has no failed
  condition and an LUT is on record, else `EXPORT_WITH_PAYMENT`, LG3), `intermediary` (commission to a client abroad:
  our location while the R14 rule says `supplier`, 13(2) from 2026-03-30, LG4), `general` (12(2), LG9), `exempt`
  (`role: 'exempt'` / `exempt_if` → N 12/2017-CT(R) Sl. 54(e) / 24; Bill of Supply when the whole group is exempt, lines
  carry `sv.exempt`, LG21) and `pure_agent` (Rule 33, 0 %, LG10). Rates from `LG_RATE_RULES` through `lgRateFor`
  (multimodal 12 % → 5 % / 18 % with an air leg from 2025-09-22, domestic only — an international multimodal job takes
  its legs' rate, LG6); kinds without a row take the supporting-services rate; the GTA leg takes the R5-B option's rate
  for the FY (no row = RCM) through `lg-tax-io.ts` (LG8). The ITC note (vessel / multimodal) is on the chip's hover
  only, never printed (LG6 / LG7). `regimeHints` adds the ocean-freight RCM line for CIF imports by sea from 2023-10-01
  (LG16).
- **Billing a job (B1, `lg-bill.ts`, pure; `lg-issue-io.ts`).** `chargeSheet(job, heads)` = the job's typed lines
  (`lg_jobs.charges`, saved through A's `saveJob`), else every active head with a default rate, its quantity by unit
  (`qtyOf`: kg = chargeable, CBM, W/M, containers, packages, else 1). `planJobBills(job, sheet, ctx)` groups by place of
  supply, document currency, document kind and export supply type. `split: 'single'` makes one document per currency and
  is refused when the lines need different places of supply (LG9). `composite_with_freight` heads take the freight
  head's regime and sit on its document. Each draft carries `lg = { job_id, job_no, mode, dir, refs, ports, weights,
  heads: { [lineId]: headId }, regime, pos_reason, fx? }`. Pure-agent lines get `charge_head_id: 'rule33'` +
  `PURE_AGENT_CHARGE` (no SAC); own lines get the head's SAC in `hsn` and the regime rate in `tax_rate`. Billed state is
  derived: a head on a live (not cancelled, not credit-note) document of the job is billed and skipped (`billedHeads`,
  `billState`), and cancelling a document frees its lines. `billJob(id, { date, fx })` and `billMonth('YYYY-MM', …)`
  ("Bill delivered jobs": every `delivered` job dated in the month) issue every draft through ONE
  `localDb.invoices.saveMany` inside `withTablesRollback`, status `Sent`, due by the company's due days. A job whose plan
  has an error (no exchange rate) is skipped and named; the rest are billed.
- **FX (B4).** A foreign-currency line uses the typed rate, else the currency master (`rateOn`) on the bill date. A bill
  to a client in India is in ₹, and the line text keeps "USD 2.00 × 500 = USD 1,000.00 @ ₹84.00". A bill to a client
  outside India stays in the line's currency with `exchange_rate`. `lg.fx` prints "Exchange rate ₹84.00 / USD (Rule 34(2)
  CGST Rules — as per accounting standards)" in the job block (`lg-print.ts`, LG13). An LUT supply copies the LUT's ARN
  and date from the register; without one the document is IGST with payment and the plan hints "No LUT on record".
- **Readers (LG15).** `gst-reports.ts` / `einvoice.ts` sent every POS-96 document to EXP / 6A. One narrow condition
  (`freight96`) changes that: POS 96 + `lg.regime === 'export_freight'` + a valid client GSTIN is B2B with POS 96 and
  IGST (GSTR-1 B2B, 3B 3.1(a), e-Invoice `SupTyp: B2B`, `Pos: 96`). Nothing else changes: LUT bills to an overseas
  client stay in EXP (WOPAY), and `rule33` lines stay outside GSTR-1 / 3B / e-Invoice as before.
- **Job costing (B3, `lg-costing.ts`, pure; `lg-books-io.ts`).** Revenue = the taxable value of the job's live documents
  in ₹ (`inrValue`); credit notes subtract; financial notes and pure-agent recoveries (`recoveryValue`) are left out.
  Cost = the tagged bills (`PurchaseRecord.lg.job_id`, or by line `lg.lines`) read through `readPurchase` /
  `readPurchaseLines`: taxable + GST not taken as credit; void / draft bills and C1 disbursements (`lg.on_behalf`) are
  left out. Flags: `unbilled` (delivered / closed, no live document), `uncosted` (billed, no cost), `low` (below
  `margin_alert_pct`). `groupPnl` groups by client / lane / salesperson / month. Documents and bills are indexed by job
  once.
- **Views.** Shipments → **Billing** (`billing`): the FY's jobs with their billing state and documents (links); a job's
  charge sheet (head, qty, rate, currency, amount, and the regime chip with its reason / ITC note / CA id on hover); ₹
  rate inputs per foreign currency; Save; "Bill job"; month + "Bill delivered jobs"; the LG19 pending note.
  **Costing** (`costing`): per job revenue / cost / margin / % / flags, totals, the margin alert (saved to the settings)
  and a grouped table. Purchase-bill form: one lazy job-picker row (`components/logistics/JobPick.tsx`, shown with a
  logistics pack or on a bill that already has `lg`; it keeps C's `lg` fields). Help topics `time:shipments:billing` /
  `:costing`, Ctrl+K rows `r19.shipments.billing` / `.costing`, synonyms (`freight invoice`, `POS 96`, `job profit`,
  `house bill margin` …), and the `time.shipments` title extended. Demo: the job carries the seed charge sheet (no demo
  invoices).
- **Pending note.** `pending-changes.ts` `lg19_delivery` (area `logistics`): the 57th Council's delivery services
  through e-commerce operators at 5 % without ITC under Sec 9(5), courier / postal excluded — not applied (LG19).

### Decisions and cuts

- **Cut (PRD §3 cut 2): accrual journals.** No "Accrue expected cost" and no `Logistics accrual` vouchers; `accrue` and
  `PurchaseRecord.lg.accrual_id` stay declared and unused. Costs count when a bill is tagged (LG34).
- **Also left out at the cap:** B1 "Share" (the share builder on the invoice page still works); a job-page tab (billing
  lives on its view); a UI to split one bill over jobs by line (the engine reads `lg.lines`; the picker tags the whole
  bill); the e-Invoice GTA exemption hint (`EINV_EXEMPT_RULES` unused, tree-shaken); B's demo invoices and co-loader
  bill (the demo job has its charge sheet); `RegimeChip.tsx` (the chip is the `regimeChip(g)` string in the view). The
  LUT link (cut 1) was kept: it reuses the R4-C register for a few bytes.
- **Indian client = ₹ document.** A USD charge billed to a client in India is converted on the line (the USD amount and
  rate in its text, `lg.fx` printed), so the e2e seed prints ₹99,120.00. Only a client outside India gets a USD
  document. For an unregistered client, the hand-over place of a transport head is taken as our State (the job's origin
  is a port code).
- **Bridges (3 of 4).** `lg-issue-io.ts` (localDb, `makeDraft`, `PURE_AGENT_CHARGE`, the currency master, `saveJob`);
  `lg-tax-io.ts` (`intermediaryPos` via `prof/ps-pos.ts`, because `prof-rules.ts` is imported only by Round 14 modules;
  `exportCheck`; `gtaRate`, with the `gta_options` row read directly so the transport chunk is not split; the LUT
  register); `lg-books-io.ts` (`readPurchase`, `inrValue`, `recoveryValue`). C owns `lg-recv-io.ts`.
- **The views are static in the desk chunk** (not `lazy`): lazy views split `lg-save` / `lg-ui` / `lg-form` into
  chunks of their own (+1.6 kB). `JobPick` reads `lg_jobs` with `getTable` for the same reason.
- **Volume test.** 600 delivered jobs → 1,200 documents in one `saveMany`: ≈ 0.5 s alone (PRD: under 2 s). The test
  allows 6 s because the full suite runs files in parallel on a shared CPU.

### API for R19-C / D (and QA)

- `billExtras(job, ctx)` (`lg-bill.ts`): return extra `LgCharge` lines in your `// R19-x` block (C: disbursements, with
  the `head_id` of a pure-agent head; D: agent notes). If you need data, extend `BillCtx` with optional fields and fill
  them in `lg-issue-io.ts` `planJob`. The lines go through the same regime / grouping / `lg.heads` path.
- `planJob(job, { date, fx? })`, `billJob(id, opts)`, `billMonth(month, opts)` → `{ invoices, skipped, errors, hints }`
  and `saveCharges(job, lines)` (`lg-issue-io.ts`); pure `chargeSheet`, `qtyOf`, `planJobBills`, `jobSnapshot`,
  `jobDocs`, `billedHeads`, `billState` (`lg-bill.ts`); `lgRegime`, `regimeHints`, `regimeChip`, `RegimeCtx`
  (`lg-regime.ts`); `regimeCtx(date, client, sender)`, `isForeignClient`, `lutOn` (`lg-tax-io.ts`).
- Costing: `costAlloc(bill)`, `pnlRows(jobs, docs, bills, { inr, recovery }, alertPct?)`, `groupPnl(rows, by)`
  (`lg-costing.ts`); `costBills(raw)`, `jobPnls(jobs, alertPct?)` (`lg-books-io.ts`). D4's reports can reuse `pnlRows`.
- A bill's job: `PurchaseRecord.lg.job_id` from `JobPick` (C / D reuse it; it keeps the other `lg` fields).
- `lg.regime` values: `domestic`, `export_freight`, `cross_border`, `intermediary`, `general`, `exempt`, `pure_agent`
  (from the document's first own line). Only `export_freight` is read outside Round 19 (GSTR-1 / e-Invoice B2B, above).
- Strings: `lgbT` (`i18n/areas/logistics-r19b.ts`).
- Tests: `tests/lg-{regime,bill,costing}.test.ts`, `lg-print` (FX row), `purchase-contract` (lg-costing); e2e step
  "R19-B billing, GST and job costing".

### Bundle (R19-B)

Baseline: this branch at `97ea776` (`vite build` + `check-bundle-size`): initial 183.0 kB (4 files), entry 89.0 kB, core
3,211.5 kB, Hindi pack 354.6 kB, Hindi in core 21.6 kB, `lazy-leaves` 17.6 kB. Normalized = chunk hashes stripped from
names and contents before gzip -9.

| Budget | Before | After | Change (normalized) | Cap |
|---|---|---|---|---|
| Initial JS (first paint) | 183.0 kB (4 files) | 183.0 kB (4 files) | 0 | 0 ✓ |
| Entry chunk | 89.0 kB | 88.9 kB | 0 | — |
| Core precache (English) | 3,211.5 kB | 3,221.2 kB | **+9,055 B = 8.84 kB** | 10 kB (PRD) / 14 kB (task) ✓ |
| Hindi pack | 354.6 kB | 355.3 kB | +0.73 kB (`lang-hi-logistics` +0.58, pending +0.11, palette / discover) | 8 kB (round) ✓ |
| Hindi left in core | 21.6 kB | 21.6 kB | 0 | 0 ✓ |
| `lazy-leaves` | 17.6 kB | 17.5 kB | 0 | ✓ |

Chunks (normalized gz): `f-logistics` 4.05 → 8.34 kB (+4.29: the regime, bill and costing engines, the B rule rows now
used, `logistics-r19b` English); ShipmentsDesk 4.13 → 7.67 kB (+3.55: the Billing and Costing views and the three
bridges); JobPick 0.53 kB (lazy, bill form); pending note 0.13; demo 0.12; wiring ≈ 0.45 (Expenses 0.11, help 0.10,
Ctrl+K 0.07, readers `einvoice` 0.06 / `gst-reports` 0.04, palette 0.03, packs 0.02, Time 0.02).

## R19-C — Customs broker (CHA) desk (disbursements, duty deposits, CB register, KYC)

### What it does

One view `customs` on the Shipments desk (`/time?tab=shipments&view=customs`, pack `customs` — listed only when the
pack is on; its URL still opens), `CustomsView.tsx` (in the desk chunk: a lazy view of its own split A's form helpers
into a shared chunk and cost 1.5 kB more). Pick a job; then:

- **Shipping bill / bill of entry from a file.** "Import SB / BOE numbers (CSV)": columns Job, SB / BOE no., Date
  (`YYYY-MM-DD` or `DD/MM/YYYY`), IGM; an export job takes `refs.sb_no` / `sb_date`, an import job `boe_no` / `boe_date`
  (+ `igm`). The broker exports the numbers from ICEGATE or its own system — **the app makes no ICEGATE (or any network)
  call**. All or nothing (`withTablesRollback` over `lg_jobs`), each job through `saveJob` (period lock, hints); refused
  rows are listed by row number (`docRefsFromTable` in `lg-register.ts`; `importDocRefs` in `lg-recv-io.ts`). Typing
  them on the job form (A2) is unchanged.
- **Authorisation and KYC (C1 limb (i), C4).** The job's `auth = { ref, date }` (Rule 33 limb (i)) and the client's
  `Client.lg = { iec, kyc: { verified_on, by, method } }` — numbers and dates only, no document copies (LG27). A job of a
  client without `kyc.verified_on` shows the CBLR Reg 10(n) hint.
- **Disbursements on behalf (C1).** "Add disbursement": paid for (duty / CFS / port / DO / shipping line / insurance /
  other), paid to, challan / invoice no., amount, date, "paid from our account now" (records the bill payment). The row
  is an ordinary **expense** in `purchases` (`disbRecord`): one 0 % line, `itc_eligible: false`, `pure_agent: true`,
  `billable_to_client_id` = the job's client, category "Disbursements on behalf of clients", `lg = { job_id, disb,
  on_behalf: true, ref?, in_client_name? }`. The ledger stays gross (LG11). The **Rule 33 checklist** shows the four
  limbs — (i) the job's authorisation, (ii) shown separately (automatic: it bills as a `rule33` line), (iii) in addition
  to our own services, (iv) actual amount in the client's name — and the save warns (never blocks) for each one not met
  (`rule33Gaps`, LG10).
- **Billed state, write-off, ageing (C1 / C3).** A disbursement is billed while a live (not cancelled) invoice line names
  it in `bill_refs` (the editor's billable-cost rule, re-stated as the pure `billedBy` in `lg-disb.ts`; cancelling frees it). "Write
  off" stamps `PurchaseRecord.lg.wo = { date, reason, by }` (memo, no journal, refused in a locked period; `books.edit`).
  The unrecovered list (not billed, not written off) is aged 0–30 / 31–60 / 61–90 / > 90 days per job.
- **Duty deposits (C2).** "Add deposit" saves an **existing advance receipt** (`ADV/FY…`, Receipt Voucher) through
  `saveAdvance` with `tax_rate: 0`, `pass_through: true` (CN-C2), `AdvanceRecord.lg = { job_id }` and the description
  "Deposit towards customs duty and charges payable on the client's behalf — not consideration for our supply" (LG12).
  "Apply deposit" applies the smaller of the deposit's open amount and what the chosen issued rupee invoice of the job
  still owes through `applyAdvance` (a payment with `advance_id`, which every cash reader already skips with
  `movedNoCash`; `no-cash.ts` unchanged); "Refund excess" refunds what is left through `refundAdvance` (Refund Voucher,
  the job in the note). The **position** per job (`depositPosition`): unapplied deposits against unrecovered
  disbursements + what the job's invoices still owe → "Excess ₹…" / "Short by ₹…". `deposit_required` (settings) adds
  the hint "Duty paid beyond the client's deposit by ₹…" on a duty disbursement (`depositShortfall`).
- **Reimbursement bill (C3).** `jobDisbExtras(job, today)` (`lg-recv-io.ts`) returns the job's unrecovered
  disbursements as Rule 33 lines (`charge_head_id: 'rule33'`, `description: PURE_AGENT_CHARGE`, 0 %, `bill_refs: [id]`,
  one per row, "Customs duty — 1234567 (paid on your behalf)") and the `lg.disb` schedule — **the seam for R19-B's
  `billExtras`** (B's charge sheet puts them on the job's domestic document). Until then the invoice editor's billable
  costs bill the same rows (they are `pure_agent` + `billable_to_client_id`), without the `lg` snapshot. The paper part
  `parts/logistics/DisbSchedule.tsx` (inside `LogisticsBlock`) prints the schedule (date, paid for, challan / invoice,
  paid to, ₹) and "Recoverable at actual (Rule 33, outside the taxable value): ₹…" from `lg.disb` only.
- **CB register (C4).** For a date range, one row per job: job, date, client, IEC, GSTIN, BOE / SB with date, port (the
  destination of an import, the origin of an export), live invoices and their total, disbursements, deposits, status;
  "Print" (escaped, `printHtmlDocument`) under the title from `CBLR_RULES` ("CBLR 2018 Reg 10(k): …", LG26) and "CSV"
  (formula cells neutralised).
- **Checklist, help, Ctrl+K, demo.** Step `lgDeposit` (kinds `cha` / `multi`: ≥ 1 advance with `lg.job_id`) opens the
  customs view; help topic `time:shipments:customs` (LG10–LG12, LG26, LG27); Ctrl+K row `r19.shipments.customs`
  ("Customs: duty deposits, disbursements, CB register", pack `customs`) with synonyms `duty deposit`, `CHA`,
  `reimbursement`, `ड्यूटी`; the Demo company gets import job JOB/FY…/0002 (sea FCL, 1 × 40HC, bill of entry,
  authorisation).

### Storage

No new table, object, series or record key.

| Key / field | Kind | Backed up | Synced | Audited | Right |
|---|---|---|---|---|---|
| `PurchaseRecord.lg` (`job_id`, `disb`, `on_behalf`, `ref`, `in_client_name`, `wo`) on `purchases` | additive | yes | yes | yes | `books.edit` |
| `AdvanceRecord.lg = { job_id }` (+ the existing `pass_through`) on `advances` | additive | yes | yes | yes | `payment.record` |
| `Client.lg = { iec, kyc }` | additive | yes | yes | yes | client write |
| `LgJob.auth = { ref, date }`; `refs.sb_*` / `boe_*` / `igm` from the file | additive / existing | yes | yes | yes | `doc.create` |
| record key `lg.disb` (the printed schedule) | declared by A | yes | yes | yes | — |

`advances.ts` gained one optional input `lg` (kept on edit) and keeps `pass_through` on an edit of an advance without a
booking, so a deposit edited in the Advances tab stays a deposit.

### Decisions and cuts

- **Cut 1 (PRD §3): no gross / net reclass journal.** It would post through `lg-books-io.ts` (R19-B's bridge, not on
  this base); the ledger stays gross (`disb_posting: 'gross'`, LG11). `disb_posting: 'net_journal'` is read by nothing yet.
- **No billing in C.** C does not issue the reimbursement bill: the PRD puts the charge sheet in R19-B (`lg-bill.ts`
  `billExtras`, not on this base); `jobDisbExtras` is the seam. The e2e step seeds the invoice B would issue.
- **Schedule placement.** The schedule prints inside the job block (before the lines), not after them: the block is A's
  one template mount, and C adds a part rather than a second mount.
- **Write-off uses `setTable`** on `purchases` (the R14 `writeOffDisbursement` precedent: a memo stamp allowed while the
  bill's own period is locked; the write-off date is lock-checked), so the bridge imports `lg-registry` (registry test).
- **Not built:** the demo deposit / disbursement rows (`advances` / `purchases` are not in `DEMO_EXTRA_TABLES`; only the
  import job is seeded), an `import_runs` row for the SB / BOE import, `register_fields` (the register has fixed
  columns), `LgJob.kyc_ok` (the hint reads the client), the client-statement change of C3.4 (deposits already show as
  advances), XLSX for the SB / BOE import (CSV only).
- **One bridge.** `lg-recv-io.ts` holds every shared lazy call of C (advances, purchases, `readPurchase`,
  `PURE_AGENT_CHARGE`, `csv.ts`, `lg-save`); the engines `lg-disb.ts`, `lg-deposits.ts`, `lg-register.ts` are pure and in
  `f-logistics`.

### API for R19-B / D and QA

- Engines (pure): `LG_DISB_KINDS`, `disbLabel`, `DISB_CATEGORY`, `validateDisb`, `disbRecord(input)`,
  `rule33Gaps({ auth, extra, inName })`, `billedBy(invoices, rebilledIn)`, `disbRows(sources, billed, today)`, `unrecovered`, `sumOf`, `ageBuckets`,
  `disbBillLines(rows, charge)`, `disbSchedule(lg)` (`lg-disb.ts`); `DEPOSIT_TEXT`, `depositInput`,
  `depositPosition(deps, unrecovered, owed?)`, `depositShortfall`, `applyAmount` (`lg-deposits.ts`); `registerRows`,
  `registerCsv`, `REGISTER_COLS` / `REGISTER_HEAD`, `registerTitle(date)`, `kycMissing(client)`,
  `docRefsFromTable(table, jobs)` (`lg-register.ts`).
- Bridge `lg-recv-io.ts`: `disbSource(raw)`, `loadDisb(today)`, `addDisbursement(input, pay?)`, `writeOffDisb(id, date,
  reason, by?)`, **`jobDisbExtras(job, today)` (B's seam)**, `loadDeposits()`, `addDeposit(job, receipt)`,
  `jobOpenInvoices(jobId)`, `applyDeposit(dep, invoiceId, date?)`, `refundDeposit(dep, jobNo, date, method)`,
  `saveKyc(client, lg)`, `importDocRefs(csvText)`.
- D's alerts can read `loadDisb` / `unrecovered` for "Job … — disbursements unrecovered" (a cancelled reimbursement bill
  frees its rows).
- Tests: `tests/lg-disb.test.ts`, `tests/lg-deposits.test.ts`, `tests/lg-register.test.ts`, the R19-C row of
  `tests/purchase-contract.test.ts`; `lg-profile` (the `lgDeposit` step, the customs Ctrl+K row); the e2e step "R19-C
  customs broker desk".

### Bundle (R19-C)

Baseline: the merged base `8b3f5a3` built in a separate worktree (`vite build` + `check-bundle-size`): initial
183.0 kB (4 files), entry 89.0 kB, core 3,217.4 kB, Hindi pack 354.9 kB, Hindi in core 21.6 kB, `lazy-leaves` 17.7 kB.
Normalized as in R19-A (chunk hashes stripped, gzip -9, 1 kB = 1,024 B).

| Budget | Before | After | Change (normalized) | Cap |
|---|---|---|---|---|
| Initial JS (first paint) | 183.0 kB (4 files) | 183.0 kB (4 files) | +22 B: the entry's preload file list in another order (same files, no new chunk or module; any content edit reorders it — help text alone does) | 0 |
| Entry chunk | 89.0 kB | 89.0 kB | as above | — |
| Core precache (English) | 3,217.4 kB | 3,225.8 kB | **+7,779 B = 7.60 kB** | 9 kB (PRD) ✓ |
| Hindi pack | 354.9 kB | 356.0 kB | +1.02 kB (`lang-hi-logistics` +0.98 kB, wiring areas) | 8 kB (round) ✓ |
| Hindi left in core | 21.6 kB | 21.6 kB | 0 | 0 ✓ |
| `lazy-leaves` | 17.7 kB | 17.7 kB | 0 | — |

Chunks (normalized gz): ShipmentsDesk 4.03 → 7.54 kB (+3.51 kB: CustomsView and `lg-recv-io`), `f-logistics` 3.96 →
7.34 kB (+3.39 kB: the three engines and the `logistics-r19c` English), LogisticsBlock +0.27 kB (`DisbSchedule`), demo
+0.12 kB, wiring ≈ 0.3 kB (help 0.11, checklist 0.06, Ctrl+K 0.06, advances 0.02, reach 0.02, Time 0.01, packs 0.01).
