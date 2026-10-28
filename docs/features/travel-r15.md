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
