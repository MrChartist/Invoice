# Round 15 — travel, tour and event businesses (+ size recovery)

Spec: `docs/prd/round-15.md`. One section per package; each records its bundle numbers (gzip -9, KiB, the method of
`scripts/check-bundle-size.mjs`). Working papers — verify with your CA.

## §A — R15-A: size recovery and cross-cutting (A1–A4)

### A1 Initial-module chunk group

`vite.config.ts`: `build.rolldownOptions.output.codeSplitting.groups` = `vendor-react` (30), `vendor-ui` (30),
`app-initial` (`tags: ['$initial']`, 20). Rolldown folds `app-initial` into the entry chunk; no lazy module joins it
(first paint stays at 4 files). `check-bundle-size.mjs`: entry budget 100 kB, ≤ 5 initial files; initial 185 / total
3,500 unchanged. Pinned by `tests/bundle-config.test.ts`. Production e2e and `scripts/verify-offline.mjs` pass.

| Build | Chunks | Initial | Entry | Total | Initial files | Cross-chunk `import{…}from` |
|---|---|---|---|---|---|---|
| Baseline `d15cae9` (`manualChunks`) | 997 | 184.8 | 71.2 | 3,425.6 | 13 | 7,234 |
| A1 on `d15cae9` | 988 | 182.5 | 88.4 | 3,382.2 | 4 | 5,768 |
| Baseline after QA17 merge (`661604a`) | 997 | 184.8 | 71.2 | 3,426.0 | 13 | 7,236 |
| A1 on `661604a` | 988 | 182.4 | 88.4 | 3,383.2 (−42.8) | 4 | 5,770 |
| **R15-A complete (A1–A4)** | 990 | **182.6** | **88.6** | **3,388.7** | 4 | — |

A1 saving on the merged base: total −42.8 kB, initial −2.4 kB (above the 30 kB stop rule).

### A2 Audit-append coalescing (PERF-3, part)

`audit.record` appends to an in-memory working copy of the log; the table is written once per synchronous task (a
microtask), or earlier by `audit.flush()`, by a read of the log's key (`storage.onPendingKey`: `readRaw` of the key
flushes) or when the batch passes the row limit (so archive rollover is that of one-by-one appends). A raw write /
removal of the key by anyone else (restore, demo removal, erase) drops the batch — as before, when its rows were
written first and then overwritten. Hash chain, row shapes and the segment format are unchanged; vault sealing stays
inside `storage.ts`. Flush call sites: backup build, sync run, `pagehide` (`main.tsx`); the auditor pack reads through
`audit.fullRows()`, which flushes. Measured (`tests/perf.test.ts`, 5,000 invoices): one write for 16 events (was one
per event). Tests: `tests/audit-coalesce.test.ts`; four existing tests that read raw storage now call `audit.flush()`.
First paint: ≈ +0.14 kB (entry 88.4 → 88.6 with the preload-map entries of A3's lazy chunks).

### A3 Party netting

`src/lib/netting.ts` + `components/receivables/NettingDialog.tsx` (lazy). A customer who is also a supplier (same name
or GSTIN, or `Vendor.client_id` set on the supplier form) is offered **Netting** on its Receivables → Ageing row; the
supplier form has the link row and a Netting link; Ctrl+K "Netting". The user ticks open invoices and bills; the amount
is ≤ min(Σ receivable, Σ payable), split oldest first. Posting: one `localDb.payments.record` receipt per (invoice,
bill) pair with `method: 'netting'`, then `exchange_purchase_id` = the bill (the R9 / R12 no-cash marker — no new
marker, `no-cash.ts` untouched) and `netting_id`; the ledger posts Dr Sundry creditors / Cr Debtors (party). The bill
side: the shared roll-up `exchangeSettled` (now beside R9's URD sync in `rt-doc-hooks.ts`, re-exported by netting.ts)
and `syncNettedPaid` keep the bill's `amount_paid` / `exchange_paid`; bill-wise payables show the live netting rows as
dated adjustments (a receipt deleted elsewhere frees the bill there at once). All or nothing (`withTablesRollback`),
`books.edit`, period lock, one audit line each way. Refused: URD vouchers (R12 cycle bills are not offered), unpaid RCM
(the user confirms "RCM paid"), currency mismatch. Clerks: refused with "needs the owner's approval" (cap ₹0) — see
deviations. Reverse removes the receipts through the data layer (recycle bin).

Size (vs A1 on the merged base): NettingDialog chunk 3.97 kB (dialog + engine + strings), Receivables +0.33,
palette +0.14, rt-registry +0.15, billwise +0.12, help +0.04 ≈ **4.75 kB** against the 4 kB cap after cut 2 (printable
/ WhatsApp netting statement dropped) and string trimming.

### A4 2026 housekeeping

- `ita2025.ts`: `'206C1G-tour'` → `Sec 394(1) [Table: Sl. No. 8]` (`verified: true`, Finance Bill 2026 cl. 73(f);
  Memorandum ¶8, TV3). `actKey` maps a 206C(1G) / TCS / overseas code or label naming a tour to it; LRS keeps Sl. No. 7.
- `tds-rules.ts`: `MANPOWER_WORK_RULES` (from 2026-04-01, unverified, TV23) and `manpowerHint`; the bill / expense TDS
  panel shows the hint when the bill names manpower and a 194J limb is picked.
- Size ≈ 0.6 kB (tds strings, tds-rules, ita2025, the TDS panel in the Expenses chunk).

### Deviations

- A2: `beforeunload` → `pagehide` (fires on mobile and bfcache; the microtask flush already ran before any event).
  `sync-engine.ts` flushes though `audit_log` is not synced (harmless).
- A3: the "existing approval queue" is document-based (`approvals.ts` holds invoices); a clerk's netting is refused with
  "needs the owner's approval" instead of being queued. The netting receipts also write the normal per-receipt
  payment lines (localDb), besides the one netting line. The creditor sub-ledger line uses the client's name (the
  existing exchange posting), so a hand-linked vendor with another name nets in the client's name.
- A3 over its cap by ≈ 0.75 kB (see above).
- CA ids TV26 / TV27 are cited in code comments only; help / glossary cite no TV id until the lead copies §9 into
  `docs/CA_REVIEW.md` §15 (the CA-id regexes already accept `TV`).

## §B — R15-B: travel core (packs `travel`, `events`; B1–B4)

### What shipped

| Item | Where |
|---|---|
| B1 profile | `SERVICE_KINDS` / `ServiceKind` gain `travel`; settings `travel_kind` (`tour_operator`, `agent`, `inbound`, `events`, `other`). `shop-presets.ts` `TRAVEL_KINDS`, `TRAVEL_LANDING`, `applyTravelKind(kind, { registered, currentPacks, alsoTravel })`: business type `services`, `service_kind: 'travel'`, modules services + accounts + purchases + time (`registered` adds `gst`), packs in union (`travel`; `events` for planners, + `travel` with "We also book travel"), due days 7. Packs `travel` / `events` (`industry-packs.ts`; `PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE`, `PACK_ROUTES` unchanged). Object `travel_settings` (`travel/tv-settings.ts`: owner only, audited, synced as a singleton, backed up; unknown C / D keys kept): `regime_default`, `regime_ok`, `iata`, `consolidators`, `fee_defaults`, `tcs`, `air_value`, `statement_maps`, `switches`. `travel/tv-profile.ts` `tvProfileOf` / `travelSwitchesFor` / `applyTravelSwitches` (regime default and switches of the PRD table; values the user set are kept; agent's IATA / BSP tick). Wizard: Services → "Travel, tours and events" → `TravelKindPicker` (inside the wizard chunk); Settings → Features "Travel profile" for every services company (+ Custom); Features row `adv.travelProfile`. Checklist (`checklist-steps.ts`, only with `travel_kind`): `firstTrip`, `firstSupplier` (every kind), `regime` (tour operator — done when the owner picks the default on the desk), `firstStatement` (agent — an `import_runs` row of kind `supplier_statement`, C2), `firstEvent` (events). Demo: `demo/profile-travel.ts` (packs `travel` / `events`): a Goa package at 5 % with three bookings (one held). |
| B2 trips | `travel/tv-trips.ts`: a trip / event IS a project cost centre with `CostCentre.tv` (`TripInfo`: code, kind, scope, destination, dates, passengers by name and type only, regime, currency, status; `cost-centres.ts` keeps `tv`, one line). Code `<YY><MM>-<seq>` suggested, unique per company; no series. Table `travel_bookings` (`travel/tv-bookings.ts`, dated by `start`, `doc.create`, audited, recycle bin, period lock): component (16), supplier, PNR / ref., dates, cost in currency at `fx`, sell, pure agent, status held / confirmed / cancelled, `bill_id`, `line_ref`, notes (+ C's `commission`, `cancel`). Billed is derived from `line_ref` (`liveLines` / `isBilled`: the line must still be on a live invoice). |
| B2 costing | `travel/tv-costing.ts` (pure): per component and in total — cost (INR at `fx`; a supplier bill tagged to the booking wins: taxable when ITC is claimed, else total; void bills skipped; untagged-booking bills of the trip as "other"), sell, margin, margin %, unconfirmed, unbilled, supplier unpaid, cancellation loss (C3 fills `cancel`), commission (C4). `tripMargins` reads only the trips that start in the period (2,400 trips: one month in well under 200 ms). |
| B2 Bill | `travel/tv-bill.ts` `billTrip` through `buildBillDraft` (the R3-B path): `to5` / `to18` / `exempt_outside` → one gross package line (SAC and rate from the rule by date; exempt = R10 `sv.exempt: 'EXEMPT'`); `agent` → one 18 % fee line (Σ sell − Σ pure-agent cost) + one pure-agent line per pass-through booking at cost (`charge_head_id: 'rule33'`, `PURE_AGENT_CHARGE`). Document cost centre = the trip; `tv` snapshot; bookings get `line_ref` in one all-or-nothing write. Cancelled and billed bookings are left out. |
| B3 regimes | `travel-rules.ts` `TRAVEL_REGIME_RULES` (rows 2017-07-01 and 2025-09-22, `verified: false`, TV8–TV10, TV32): rate, SAC, ITC rule and printed sentence of `to5` / `to18` / `agent` / `exempt_outside`. `travel/tv-regime.ts` `regimeRule`, `tvSnapshot`, `regimeMix` (5 % mixed with another taxed rate warns; pure-agent recoveries never count). Editor: lazy `TravelRows` (packs on): trip + regime pick → `cost_centre_id` and `tv` (C / D sub-objects kept); the mixing warning. |
| B3 ITC block | `travel/tv-itc.ts`: `tripTag` (a bill of a `to5` trip carries `PurchaseRecord.tv.regime: 'to5'`, except a booking of component `package`), `itcOverrides` (bills of 5 % trips still claiming ITC, with the reason), `auditItcOverride`, `tvExceptions` (GST guards, lazy, travel companies only: `TV_MIX`, `TV_ITC_5`). Bill form: lazy `TripPick` (trip + booking) unticks ITC on a 5 % trip; claiming it needs a reason (refused without one; audited on save). GSTR-3B / purchase register read the existing `itc_eligible` — no GST reader changed. The month's overrides are listed on the Trips view. |
| B4 paper | Record key **`tv`** (`R15_RECORD_KEYS = ['tv']`, spread into `R9_RECORD_KEYS` — the round's B first-paint token). Lazy `parts/TravelBlock.tsx` (+ `travel-paper.module.css`, accent / template variables only) after `ProfBlock`, before `GstBody`, never on receipt paper: trip / event code, destination, dates, lead passenger, pax count and the regime sentence, from `tv` only (`travel/tv-print.ts`). `paper-helpers.ts` `tvLineText` (C1's ticket particulars under a line, in `trackingText`). |
| Desk | `TIME_TABS` row `trips` (pack `travel`, also `events`); `Time.tsx` mounts `components/travel/TripsDesk.tsx` through `import.meta.glob('../components/travel/*Desk.tsx')`. Views (`&view=`): `trips` (files with sell / cost / margin % / unbilled / supplier unpaid, status filter, new file, the open file's costing and bookings with add / confirm / remove, Bill, regime default, the month's trip margin and the 5 % ITC overrides) and `bookings` (filters all / unconfirmed / unbilled / supplier unpaid / next 7 days). C / D add one lazy entry each to the desk's `VIEWS`. |
| Wiring | `travel/tv-shared.ts` (`TV_TABLES`, `TV_OBJECTS`, `TV_PACKS`, `TV_DATED`), `travel/tv-registry.ts` (`TV_TABLE_ACTIONS`, `TV_WATCHED`; imported by every writer, `sync-engine.ts`, `trust/recycle-bin.ts`), backup `RECORD_TABLES` / `ID_TABLES`, sync `DATED`, open-export rows (`travel_settings`, `travel_bookings`), `DEMO_EXTRA_TABLES`. Help topics `time:trips`, `time:trips:trips`, `time:trips:bookings` (≤ 160 characters, TV ids); Ctrl+K `time.trips`; palette `r15.*`; reach / discover strings (packs, checklist, Features row). Strings: `i18n/areas/travel-r15b.ts` (shared words for C / D: trip, booking, supplier, passengers, sell, cost, margin, cancellation, refund, TCS; lists as comma strings read by `tvList`). Types: `types/travel-r15.ts` (B declares C / D's `tv` sub-objects, `Vendor.tv`, `Client.tv`). |
| Tests / e2e | `tv-profile`, `tv-registry`, `tv-rules` (import graph, `verified`), `tv-pack-gate`, `tv-trips` (+ volume), `tv-costing`, `tv-bill`, `tv-regime`, `tv-itc`, `tv-print`; `purchase-contract` (B's readers); `industry-packs`, `sv-profile`, `features-catalog`, `invoice-store` updated. E2E step "R15-B travel core". |

### API for R15-C / R15-D

- **Types**: `TvSnapshot.lines[lineId].tkt` (`TvTicket`), `tcs`, `event`, `pos_note`; `TripInfo.event` (`TvEvent`);
  `TravelBooking.commission` / `cancel`; `TravelSettings.air_value` / `statement_maps` / `tcs`; `Vendor.tv.kind`,
  `Client.tv`. Do not add record or line keys.
- **Names / registry**: add tables to `TV_TABLES` / `TV_DATED` and rows in `tv-registry.ts` (your block); writers
  `import './tv-registry'`. Backup / sync / open-export rows in `// R15-C` / `// R15-D` blocks.
- **Desk**: add `statements` (C), `tcs` / `events` (D) as one `lazy(() => import('./XView'))` entry each in
  `TripsDesk.tsx` `VIEWS`, their `PACK_TABS` rows (`r15.trips.*` labels in `palette-destinations.ts`), help topics
  `time:trips:<view>` and Ctrl+K text. Shared bits: `tv-ui.tsx` (`Field`, `ListSelect`), `tv-run.ts` (`runWith`, `pct`,
  `TvViewProps`), `BookingTable` (C adds Cancel / Ticket actions there).
- **Bill / snapshot**: `tripLines` (pure) and `billTrip`; `tvSnapshot(trip, regime, date)`; `regimeRule(regime, date)`.
  `TravelRows` keeps other `tv` sub-objects — D adds its chips below it. `tvLineText` already prints `tkt`.

### Deviations (R15-B)

- **Cut 3 applied** (size): no itinerary rows on the paper (`tv.itin` not written). Cut 4 had nothing to cut (no
  per-pax costing columns were built).
- **Over the 14 kB cap** (see Bundle): ≈ +3.0 kB after cut 3 and string trimming. No further B item is on the cut list.
- **PACK_TABS**: only B's desk and views are listed (C / D add theirs with their views — no stubs; the R14 precedent).
- **Wizard landing** for `events` is `/time?tab=trips&view=events`; until D merges the desk falls back to `trips`.
- **Cost-centre form**: no lazy row — trips are edited on the Trips desk (the cost centre keeps `tv` through
  `projectFields`; Books → cost centres never drops it).
- **Passenger types**: the new-file form takes names (adults); child / infant come from data (demo, import) — the model
  and cleaning support all three.
- **GST guards**: the "ITC on 5 % trips" check is an invoice check (`TV_ITC_5` on a 5 % invoice whose trip has a bill
  claiming ITC) plus the month list on the Trips view, since GST guards walk invoices.
- **ITC reason without a reason**: the bill is refused with an English message (one string in the Expenses chunk).
- **Agent fee SAC** 998552 and the fee = sell − pure-agent cost rule are asked as **TV32 / TV33** (new; §15 of
  `docs/CA_REVIEW.md`, total 496 → 529).

### Bundle (R15-B)

Measured with `vite build` + gzip -9 (the budget script's method); before = `claude/elegant-cannon-cwapiv` at
`8fe19a0` / `38cb024` (same tree, R15-A merged), after = this branch.

| Budget | Before | After | Delta | Cap |
|---|---|---|---|---|
| Initial JS (first paint) | 186,954 B (182.6 kB) | 186,978 B (182.6 kB) | **+24 B** (the `tv` token and the entry's lazy-chunk map) | ≈ 0 ✓; 4 initial files |
| Total JS | 3,470,024 B (3,388.7 kB) | 3,487,472 B (3,405.7 kB) | **+17.0 kB** | 14 kB ✗ (+3.0) |

Breakdown (gz): Trips desk chunk 5.5 kB (desk, both views, costing, bill), strings 2.3 kB (EN + HI), shared
`tv-ui` / `tv-bookings` / `tv-regime` / `tv-settings` / `tv-profile` / `tv-registry` chunks 3.0 kB, editor and bill rows
1.6 kB (+ 0.35 kB in the bill form), ITC / guard 0.7 kB (+0.3 in `gst-guards`), paper 0.75 kB, demo 0.6 kB, picker
0.3 kB, wizard / Features / Time wiring 0.55 kB, help / reach / discover / palette / checklist 1.1 kB, open-export / backup
/ sync rows 0.3 kB. Further options for the lead (not on the PRD cut list): drop the month's trip-margin table from the
trips view (≈ −0.5 kB; the costing per file stays), drop the picker hints (≈ −0.3 kB), fold `tv-profile` into
`tv-settings` (≈ −0.15 kB).

## §D — R15-D: outbound, TCS and events (D1–D3)

### What shipped

| Item | Where |
|---|---|
| D1 rules | `travel-rules.ts` `// R15-D`: `TOUR_PACKAGE_TCS_RULES` (none → 5 % from 2020-10-01 → 5 % / 20 % slabs over ₹7 lakh from 2023-10-01 → ₹10 lakh from 2025-04-01 → 2 % flat from 2026-04-01), `TCS_NO_PAN_RULES` (10 % floor from 2020-10-01; higher of 2 × rate or 5 % from 2026-04-01), `EVENT_RULES` (SAC 998596, 18 %). Every row `verified: false` (TV1, TV2, TV5, TV22). `tax-rules.ts` untouched. |
| D1 engine | `travel/tv-tcs.ts`: `tourTcs` (date, base, buyer FY aggregate, PAN, non-resident, stand-alone test `isTourPackage`: travel + stay or a `package` booking; the user's "overseas tour package" tick overrides, TV4), `priorTourBase` (same buyer, same FY, live flagged invoices on or before the date), `tcsPatch` → the invoice's existing `tcs_enabled` / `tcs_rate` / `tcs_base` / `tcs_label` + `tv.tcs {rate, base, label, slab?, nr?, force?, no_pan?}`; the invoice maths computes `tcs_amount`. A crossing invoice stores the blended rate (6 decimals) and prints the split. Labels: `206C(1G) overseas tour package 5 % / 20 %` before 2026-04-01, `Sec 394(1) Sl. 8 — overseas tour package 2 %` after (A4's `actKey` maps both to `206C1G-tour`). |
| D1 register | No new reader: `tcsRowsLite` / `tcsCollections` / Form 27EQ / 143 read `tcs_amount` as today. `tds-rules.ts` `TCS_27EQ_CODES`: one row `/overseas tour/` with a **blank code** ("to confirm", TV7), placed before the LRS `/1G/` row (see deviations). `tds-returns.ts` `form27EQ`: a blank code takes its reference from the row's own label (fixes the luxury-goods row too). View `tcs`: per buyer per FY (invoices, base, TCS), quarter totals, PAN missing, near the threshold (≥ 80 %, slab years), the TCS base setting (`travel_settings.tcs.base`, owner, TV6), link to `/tds`. |
| D1 paper | `parts/travel/TcsLine.tsx` in `TravelBlock`: the TCS label and split, and the POS note, from `tv` only. |
| D2 POS | `travel/tv-pos.ts` `travelPos`: Indian client Sec 12(2) (GSTIN State, else address on record; hotel hint under the agent regime, Sec 12(3)); foreign tourist / agent (`Client.tv`, state 96 or `ps.country`) inbound or domestic → "POS India, not an export" (13(3)(b)); outbound → offers `exempt_outside`. `tripExportCheck` reuses R14 `ps-export-check.ts` (class `physical`, abroad only when outbound) when the user marked an export. `dmcHint`: a foreign DMC's bill on an outbound trip → "no import RCM? verify" (TV20); the bill's RCM default is unchanged. |
| D2 / D3 editor | `components/travel/TvChips.tsx` (lazy from `TravelRows` once a trip is picked): POS chip + "Use this POS" (sets the place of supply, snapshots `tv.pos_note`), the exempt button, the export check, the event fee rule, and the TCS chip + "Apply TCS" with the package / non-resident ticks. |
| D3 events | `travel/tv-events.ts`: `cleanEvent` / `saveEvent` (`CostCentre.tv.event` through `saveTrip`), `eventBudget` (approved / booked / billed / paid per head = component id; an unbudgeted component shows with 0; cancelled bookings left out; bills through `readPurchase`), `eventMoney` (invoiced / received on the event's live invoices, the client's open advances via `advanceBalance`), `eventPos` (Sec 12(7)(a)), `vendorTdsHint` (contract work → 194C / Sl. 6(i); artist → 194J / Sl. 6(iii); manpower → contractor only from 2026-04-01 via A4's `MANPOWER_WORK_RULES`). View `events`: particulars + budget heads form, the sheet (over-budget heads in `--destructive`), money line with the margin, POS, each vendor's TDS hint. `TripPick` (bill form) shows the TDS hint and the DMC hint for the picked booking. |
| Wiring | `TripsDesk` `VIEWS` `tcs` / `events` (one lazy chunk, `r15d-views.ts`); `PACK_TABS` rows; palette `r15.trips.tcs` / `r15.trips.events`; help `time:trips:tcs`, `time:trips:events`; Ctrl+K `time.trips` text; strings `i18n/areas/travel-r15d.ts`. No new table, key or series. Tests: `tv-tcs`, `tv-pos`, `tv-events`, purchase contract (event budget). E2E step "R15-D". |

### Deviations (R15-D)

- **27EQ row placement**: the tour-package row is inserted before the LRS row, not appended — `find` takes the first
  match and the old-Act label "206C(1G) overseas tour package" would otherwise get the LRS code `6CQ`.
- **Events margin** = invoiced to the client − cost per head (vendor bills, else booked cost); the trips view's costing
  (sell-based) is not reused, to keep the events chunk off `tv-costing`.
- **TDS hint date** = the booking's service date (the bill form has no date in `TripPick`), TV36.
- **FX** (D2 #4): no change — B's booking form already keeps `cost_currency` / `fx` per booking; the invoice uses its own
  exchange rate. Cut 2 applied (chip only, no POS rows in the trips view); cut 1 (vendor-advance column) not built.
- **Demo**: no event / outbound sample data added (`profile-travel.ts` unchanged; size).
- **CA ids** TV34–TV36 added (§15 total 529 → 532).

### Bundle (R15-D)

Before = `claude/elegant-cannon-cwapiv` (868e287, same tree as 6ea5407), after = this branch; gzip -9.

| Budget | Before | After | Delta | Cap |
|---|---|---|---|---|
| Initial JS | 186,978 B (182.6 kB) | 186,982 B (182.6 kB) | +4 B (lazy-chunk map) | 0 ✓; 4 initial files |
| Total JS | 3,487,472 B (3,405.7 kB) | 3,502,273 B (3,420.2 kB) | **+14.5 kB** | 9 kB ✗ (+5.5) |

Breakdown (gz): POS + events engine with the D strings 3.9 kB, views chunk (TCS + events) 2.7, TCS engine 1.7, editor
chips 1.7, rules +0.4 (in a now separate `travel-rules` chunk), chunk re-split of B's shared modules (`tv-trips`,
`tv-run`, `TravelRows` ↔ `tv-ui` / `tv-regime`) ≈ 1.5, bill-form hints 0.2, paper 0.15, help / palette / packs 0.35.
Options for the lead: drop the export-check line in the chip (≈ −0.2), drop the vendor TDS list in the events view (it
stays on the bill form, ≈ −0.3), drop the "near the threshold" list (history years only, ≈ −0.15).
