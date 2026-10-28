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
## R19-D — Agents, courier and reports

### What it does

- **Overseas agents (D1, view `agents`, pack `logistics`).** An agent is a client + vendor pair (`Vendor.client_id`,
  R15-A) with `Vendor.lg = { kind, foreign }`; "Add agent" creates both (a foreign agent: client `state_code: '96'`,
  vendor `non_resident`, `nr_country`). For a job: **"Debit agent"** (`agentNote`): our document in the agent's
  currency (profit share → the `commission` SAC, freight → the mode's SAC and rate), POS 96 by Sec 13(2), export of
  services — `EXPORT_LUT` (zero-rated, LUT number / date) when the R4-C register covers the day, else
  `EXPORT_WITH_PAYMENT` (IGST); `lg = { job_id, job_no, agent: { id, name, kind }, regime, fx, pos_reason }` (LG3,
  LG30). **"Agent's bill"** (`agentBill`): a purchase booked in ₹ at the typed rate as an import of services under
  reverse charge (IGST 18 %, ITC; `total` = taxable + IGST, the supplier is owed the taxable — `supplierPayable`
  agrees), the foreign amount in `PurchaseRecord.lg.fx = { currency, amount, rate }` (LG17); one bill number once per
  agent. **Statement** by month (or all): our open notes vs their open bills in the currency, net (> 0 = the agent owes
  us). The agent's own statement is pasted as "job or HBL / HAWB, amount (+ we owe them)" and matched by job
  (`matchStatement`); the differences are listed. **"Settle by netting"** (`settleAgent`): up to min(ours, theirs),
  only with "reverse-charge IGST paid" ticked (TV27); pairs oldest first; one receipt per (note, bill) on the note in
  its currency with `method: 'netting'`, `exchange_purchase_id`, `netting_id` (the R15-A markers, so `movedNoCash`,
  `nettings()` / `reverseNetting` and the ledger already handle them) and `realised_rate` = the bill's rate, so the
  ledger clears the creditor at the bill's ₹ and books the exchange difference against the note's rate (`fx-gain`).
  The FEMA hint (LG31) sits under it; the net receipt / payment is the existing Receivables / Purchases flow.
- **Courier manifests (D2, view `courier`, pack `courier`).** The zone card (`logistics_settings.zones`: first 500 g,
  each further 500 g, minimum, RTO %). "Import dockets" for one account customer: a CSV pasted or picked (header
  `docket,date,zone,kg,l,w,h,pcs,service,pin,value,status,intl,fsc,charge`, any order; `docket`, `date`, `zone`
  required; dd/mm/yyyy or ISO dates; ≤ 5,000 rows; all or nothing — row errors, duplicates, a docket already on any
  manifest of the company, or a billed month refuse the file). `docketCharge`: chargeable = max(kg, volume ÷ 5000) up
  to 0.5 kg (`chargeableWeight`; the divisor a setting, LG33); first 500 g + each further 500 g, the minimum, + RTO %
  on a returned docket, then + FSC %; a typed `charge` column wins. A declared value above ₹50,000 gives the e-Way hint
  (LG20). Dockets go into **one `lg_manifests` row per customer × month** (dated by the month end). **"Bill month"**
  (`billCourierMonth`): every manifest of the period without a live bill → one tax invoice per customer (SAC 996812,
  the courier rate, POS by Sec 12(8): a registered customer's State, else its State on record, else ours);
  international dockets (`intl`) on their own document with POS 96 (12(8) proviso, IGST, LG18) — all in **ONE
  `localDb.invoices.saveMany`**. One line per docket ("Courier charges", the docket in the description, so the
  catalogue learns one item); `lg = { manifest_id, period, count, kg, pos_reason }`; the paper prints a "Period" row;
  the docket annexure is a CSV per manifest. Billed state is derived from live bills (`billedManifests`); **"Undo
  month"** cancels the period's bills (never deleted; numbers stay used; a bill with a receipt stops it) and the
  manifests are billable again. A manifest no live bill names can be removed (recycle bin).
- **Reports (D4, view `reports`).** One FY's jobs: margin by lane / client / salesperson / month (`jobPnl`: revenue =
  the job's live bills in ₹ at the document rate, Rule 33 lines out; cost = taxable of bills tagged to the job, drafts
  and disbursements on the client's behalf out — LG11), agent balances, disbursements ageing (unrecovered on-behalf
  bills, recoveries settle the oldest first; 0–30 / 31–60 / 61–90 / 90+ days) — each with CSV.
- **Notices (D4).** `lg-alerts.ts` behind ONE bell gate `gate('logistics', '-', …)` (every logistics kind has the
  pack; `lgNotices` re-checks the packs on every run): a job delivered over 7 days ago (by its last status change,
  `updated_at`) with no live bill; disbursements on the client's behalf (`PurchaseRecord.lg.on_behalf`, C1) older than
  30 days not recovered on a live bill of the job (its `lg.disb` schedule, else its `rule33` lines) — so cancelling the
  reimbursement bill brings the notice back; duty paid (`lg.disb: 'duty'`) above the job's deposits
  (`AdvanceRecord.lg.job_id`, C2) once its bill of entry is in; last month's manifests unbilled after the 5th.
- **Checklist, help, Ctrl+K.** Step `lgManifest` (only with the `courier` pack; `LG_STEPS` carries an optional pack);
  help topics `time:shipments:agents` / `:courier` / `:reports`; palette labels `r19.shipments.agents` / `.courier` /
  `.reports` (the PACK_TABS rows take every Round 19 pack, as the desk does; the desk lists `courier` only with its
  pack, its URL still opens it); synonyms (`docket`, `manifest`, `AWB`, `overseas agent`, `profit share`, `job margin`
  …); the Ctrl+K title `time.shipments` names agents, courier manifests, reports.

### Storage

| Key / field | Kind | Backed up | Synced | Audited | Right |
|---|---|---|---|---|---|
| `lg_manifests` | table, dated (`date` = month end) | yes | yes | yes (`Courier manifest`) | `doc.create` |
| `logistics_settings.zones` | object field | yes | yes | on save | `settings.manage` |
| `Vendor.lg`, `PurchaseRecord.lg.fx` | additive | yes | yes | yes | — |
| `lg.manifest_id` / `period` / `count` / `kg` / `agent` / `fx` | record key `lg` | yes | yes | yes | — |

Restore hook: a manifest comes back only while its client lives, no live manifest holds the same customer × month and
none of its dockets is on another manifest.

### Decisions and cuts

- **Cuts at the 12 kB cap.** After merging the views into the desk chunk and trimming, the package still stood at
  +12.5 kB, so the PRD §3 order was followed: **cut 1 — D3 storage billing** (no `lg_storage` table registered, no
  Storage view; `LgStorageRow` / `LgStoragePlan` / `storage_plans` stay declared; LG21 / LG22 / LG41 are not used),
  **cut 2 — COD remittance** (`LgManifest.cod` / `LgDocket.cod_amount` stay declared; the reader does not fill them),
  **cut 3 — the TDS-on-receipts view**. Beyond the list: no deposits-position report (C's customs view holds deposits),
  the agent statement is a pasted list (not the R15-C mapping importer, not stored), no D demo rows, no `network`
  column, and "Agent notes" sit in the Agents view (pick the job) rather than on the job page.
- **No bridge.** D creates no `lg-*-io.ts`. Shared lazy code is reached from the components layer through
  `components/logistics/lg-d-seam.ts` (`draftBase` = `makeDraft`, `lutOn` — a dynamic import of the R4-C register,
  `fxOn` = the currency master's rate, `syncNettedPaid`, `downloadCsv`) and passed to the writers as arguments.
  **Merge note for B:** when `lg-issue-io.ts` exists, `draftBase` / `lutOn` / `fxOn` move behind it, and the agent note
  can take B's regime engine instead of `agentNote`'s fixed export-of-services rule. **For C:** the notices and the
  ageing read C's fields as A declared them (`PurchaseRecord.lg.on_behalf` / `disb`, `AdvanceRecord.lg.job_id`,
  `lg.disb` on the reimbursement bill).
- **Writers.** `lg-d-save.ts` imports the registry (outside the family) and may import `table-txn`
  (`tests/lg-rules.test.ts` names it with `lg-save.ts`). Engines `lg-doc` / `lg-courier` / `lg-agents` / `lg-alerts` /
  `lg-reports` are pure and in `f-logistics`.
- **Netting in a foreign currency.** `postNetting` refuses foreign-currency invoices, and the shared roll-up
  `exchangeSettled` summed receipt amounts as rupees. R19-D keeps the R15-A markers and makes the roll-up value a row at
  its `realised_rate` when it has one (`rt-doc-hooks.ts`, one line; INR rows have none, so R9 / R12 / R15 are
  unchanged), so the bill's `amount_paid` / `exchange_paid`, reversal (`reverseNetting`) and the ledger agree. The
  Receivables netting list shows such a row's amount in the note's currency.
- **Purchases are read as stored** (`total`, `taxable`, `cgst` / `sgst` / `igst`, `date`, `lg`); `lg-agents`,
  `lg-alerts` and `lg-reports` are in `tests/purchase-contract.test.ts`.

### API for QA

- Courier: `docketCharge(d, zones, settings)`, `docketsFromRows(rows, settings)` → `{ dockets, errors, hints }`,
  `DOCKET_COLS`, `mergeDockets`, `billedManifests(invoices)`, `planCourierRun(period, manifests, invoices, clients)`,
  `courierBill(group, ctx)`, `manifestTotals`, `docketRows` (`lg-courier.ts`); writers `loadManifests`,
  `importDockets(clientId, dockets)`, `deleteManifest(id)`, `billCourierMonth(period, date, base)`,
  `undoCourierMonth(period)` (`lg-d-save.ts`).
- Agents: `lgAgents(vendors, clients)`, `agentNote(input, ctx)`, `agentBill(input, id)`, `agentNotes`, `agentBills`,
  `agentStatement(agent, invoices, purchases, period?)`, `matchStatement(rows, statement, jobs)`, `pairAgent`,
  `AGENT_KINDS`, `NOTE_KINDS` (`lg-agents.ts`); writers `saveAgent`, `issueAgentNote(input, date, base)`,
  `saveAgentBill`, `settleAgent(agent, { amount, date, rcmPaid }, sync)` (`lg-d-save.ts`).
- Documents: `lgDoc`, `svcLine`, `partyPos`, `homeOf`, `liveBills`, `periodOf`, `monthEnd`, `prevPeriod`
  (`lg-doc.ts`); `docCtx(base, date)` (`lg-d-save.ts`).
- Notices / reports: `lgAlerts(today, data)`, `lgNotices(ctx)`, `recoveredByJob` (`lg-alerts.ts`); `jobPnl`, `marginBy`,
  `MARGIN_BY`, `disbAgeing` (`lg-reports.ts`).
- Strings: `lgdT` (`i18n/areas/logistics-r19d.ts`, literal Hindi). Tests: `tests/lg-{courier,agents,alerts}.test.ts`,
  `tests/purchase-contract.test.ts` (R19-D readers); the e2e step "R19-D agents, courier, notices".

### Bundle (R19-D)

Baseline: `origin/claude/elegant-cannon-cwapiv` at `8b3f5a3`, built in this worktree (`vite build` +
`check-bundle-size`): initial 183.0 kB (4 files), entry 89.0 kB, core 3,218.1 kB, Hindi pack 354.9 kB, Hindi in core
21.6 kB, `lazy-leaves` 17.7 kB.

| Budget | Before | After | Change | Cap |
|---|---|---|---|---|
| Initial JS (first paint) | 183.0 kB (4 files) | 183.0 kB (4 files) | 0 (entry, runtime, vendor chunks identical after hash normalisation) | 0 ✓ |
| Entry chunk | 89.0 kB | 89.0 kB | 0 | — |
| Core precache (English) | 3,218.1 kB | 3,229.7 kB | **+11.6 kB** (`check-bundle-size`); +11,519 B normalized | 12 kB ✓ |
| Hindi pack | 354.9 kB | 356.3 kB | +1.4 kB (`lang-hi-logistics` +1.28 kB; palette / reach / discover areas) | — |
| Hindi left in core | 21.6 kB | 21.6 kB | 0 (rounded; four Hindi help titles) | 0 ✓ |
| `lazy-leaves` | 17.7 kB | 17.7 kB | +29 B (`lg-registry.ts` D rows) | — |

Chunks (normalized gz): `f-logistics` +6.34 kB (now 10.39 kB: `lg-doc`, `lg-courier`, `lg-agents`, `lg-alerts`,
`lg-reports`, `logistics-r19d` English); ShipmentsDesk +4.53 kB (now 8.65 kB: Agents / Courier / Reports views,
`lg-d-save`, `lg-d-seam` — static in the desk chunk, which saved ≈ 2 kB of per-chunk overhead over lazy views);
wiring ≈ 0.65 kB (help 0.17, recycle bin 0.09, palette 0.08, Ctrl+K rows 0.07, checklist 0.04, packs 0.04, bell 0.03,
open export 0.03 …).
