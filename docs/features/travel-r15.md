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
  existing exchange posting), so a hand-linked vendor with another name nets in the client's name. **Fixed in R16-D1:**
  a netting row (`netting_id`) now debits the bill's own supplier (`ledger/postings.ts`); R9 / R12 exchange rows unchanged (PF17).
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
  **Fixed in R16-D3:** the message is `tvT('needReason')` (English / Hindi), loaded with the travel strings on refusal.
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

## §C — R15-C: air tickets and supplier settlement (C1–C3; C4 cut)

### What shipped

| Item | Where |
|---|---|
| C1 tickets | `travel/tv-air-value.ts` (pure): `fareOf` (basic + taxes + the airline's GST — the airline's supply, recovered at actual, never our output tax), `airlineGst` (suggestion by class and date when the ticket does not show it: `AIR_FARE_GST_RULES`, other classes 12 % → 18 % from 2025-09-22, TV12), `deemedValue` (Rule 32(3): 5 % domestic / 10 % international of the basic fare, `AIR_AGENT_VALUE_RULES`, TV11), `validateTicket` (13-digit ticket no. when given), `mergeTickets`: one pure-agent fare line per ticket (`charge_head_id: 'rule33'` + `PURE_AGENT_CHARGE`, so GSTR-1 / HSN / e-Invoice ItemList leave it out and e-Invoice keeps it in `OthChrg`) with its particulars in `tv.lines[lineId].tkt`, plus ONE service line — the deemed value, or the actual fee — at SAC 998551 / 18 % (`AIR_SAC_RULES`); adding tickets again re-makes that line (`tv.air.line_id`). `tv.air` = method, fee, value, line id and the printed Rule 32(3) sentence (snapshotted; `tvPaper` appends it to the declaration). A fee above the deemed value warns and the deemed value is kept (TV11, TV34). `travel/tv-air.ts` `billTickets`: "Ticket" on an `air` booking → a draft in the agent regime through `buildBillDraft`; the booking keeps `tkt` and points at the first fare line (billed is derived, B2). `components/travel/TicketRows.tsx` (pure UI: rows, fee, method — `travel_settings.air_value` default, per document override — live value, warning) is used by the editor's `TravelRows` ("Air tickets" button, also without a trip) and by the bookings table. `paper-helpers.ts` `tvLineText` also prints the fare split (basic + taxes + airline GST). |
| C2 statements | `travel/tv-statements.ts`: BSP and consolidator presets (synonym tables scored by the importer's `scoreHeader` through the R5-A `marketplace/file-map.ts`), `readStatementRows` (TKTT / RFND / ADMA / ACMA; net defaults to gross + taxes − commission), `totalsOf` / `owed` (refunds and ACMs reduce what we owe; a disputed ADM is left out), `splitByMonth` (≤ 2,000 rows a statement), table **`supplier_statements`** (dated by `period_end`, synced, audited, `books.edit`, recycle bin, period lock; rows inside), one `import_runs` row (`supplier_statement`) per import, the user's column map remembered per preset in `travel_settings.statement_maps` (owner only; a clerk's map is not kept). `travel/tv-match.ts` (pure): by ticket no. (last 10 digits) / PNR / booking ref. within the period ± 45 days — an invoice outside the window is never opened; > ₹1 → `diff`; ADMA → ADM (record / dispute); RFND with no credit note on its invoice → "refund to pass on"; not found → `missing`; our tickets (BSP) or this supplier's bookings in the period missing from the file → `ours_only` rows. `travel/tv-statement-bill.ts` "Make bill" (the only posting): one expense bill of the net remittance, fares at actual (no GST, no ITC) and ADMs on their own line; refused when the supplier owes us, or twice. View `components/travel/StatementsView.tsx` (`&view=statements`): import form with the column fix, list with counts / commission / net, open statement filtered by status, Make bill, Match again, Remove. |
| C3 cancellations | `travel/tv-cancel.ts`: `cancelPlan` (pure; guards) and `cancelBookings` (all or nothing, `doc.create`, period lock): a credit note through `documents.createCreditNote` for each issued invoice that billed the bookings (their lines in full, GST reversed; for a ticket invoice all its tickets and the service line), a draft invoice of our fee at the principal supply's rate (`CANCEL_FEE_RATE_RULES`: 5 % in `to5`, 18 % in `to18` / `agent`, exempt abroad; TV15, TV35), a value-only debit note (`purchase-returns`) on the booking's bill for the refund due (TV36), `cancel` on each booking (charges split by cost) and the trip set `cancelled` when nothing is left. Refund to the client = billed − fee with its GST (shown before posting). Guards: a booking inside a shared package line is cancelled with its whole trip; a draft invoice must be issued first; charge + refund ≤ cost; cancelled bookings are never billed again (B2). `components/travel/CancelDialog.tsx` from the bookings table (Cancel per booking, Cancel trip inside a file). The trip's loss is B2's (supplier charge not recovered by our fee). |
| Wiring | `TV_TABLES.statements`, `TV_DATED.supplier_statements = 'period_end'`, registry block (`books.edit`, audit label "Supplier statement"), backup `RECORD_TABLES` / `ID_TABLES`, sync `DATED`, open-export row, `DEMO_EXTRA_TABLES`; types `TvSnapshot.air`, `TravelBooking.tkt`, `StatementRow`, `SupplierStatement` (`// R15-C` block); rules `AIR_AGENT_VALUE_RULES`, `AIR_SAC_RULES`, `AIR_FARE_GST_RULES`, `CANCEL_FEE_RATE_RULES` (all `verified: false`). Strings `i18n/areas/travel-r15c.ts` (shared words from `travel-r15b.ts`). Help `time:trips:statements` (in `topics-sales.ts`: the view has no `PACK_TABS` row, see deviations); Ctrl+K `time.trips` text extended. Tests `tv-air`, `tv-statements`, `tv-match` (+ 20,000-ticket / 26-statement volume), `tv-cancel`, `tv-registry`, `purchase-contract` (statement bill). E2E step "R15-C air tickets and supplier settlement". |

### Deviations (R15-C)

- **Cut 1 applied (C4 commission income)** and **cut 2 (bed-bank preset)**, size (PRD §3). Commission typed on a booking still counts in the trip margin (B2); the commission invoice to principals, 194H expected and the insurer's RCM flag are not built (TV16 / TV17 rows note it). A bed-bank file can be mapped with the consolidator preset (the `bedbank` kind stays in the type).
- **Cut 3 items not built:** re-issue, the ticket annexure page and the CSV of differences.
- **Import wizard:** no new `ImportKind`. Statements are read with the R5-A marketplace mapper (`file-map.ts` on top of `import-mapping.ts`'s `scoreHeader`, `file-read.ts` with the dynamic XLSX reader) inside the view: the wizard's kinds write master tables through its sinks, a statement is one row with match results. `import_runs` is written directly (kind `supplier_statement`, the B checklist step).
- **No `TicketTable.tsx` part:** ticket particulars print under each line (`tvLineText`, now with the fare split) and the Rule 32(3) sentence in the travel block.
- **Deemed value invoice:** the service line equals the deemed value; the fee typed is used only for the warning (and as the value under "actual"). Asked as TV34.
- **Cancellation:** full credit of the billed lines + a separate fee invoice instead of a partial credit note (no 2-decimal quantity rounding on package lines); a booking inside a shared package line is cancelled only with its trip (TV35). The supplier refund is a 0 % debit note (TV36). A retained hotel charge billed as principal takes the regime rate, not the hotel band. *Later (PENDING #8, QA18 "left
  as found"):* the cancellation's credit note cannot be deleted or marked cancelled while its booking stays cancelled
  (the status is stored, so the booking would stay cancelled with nothing credited): `localDb.invoices.remove` /
  `setStatus('Cancelled')` refuse through `assertNotTravelCancel` (the booking's `cancel.credit_note_id`, or a
  `Booking cancelled` link from an invoice that billed a cancelled booking). Chosen over un-cancelling on delete: the
  recycle bin has no after-restore hook to re-cancel, and the fee invoice / supplier debit note would be left behind.
- **Desk views static:** `StatementsView`, `CancelDialog` and `TicketRows` are in the Trips desk chunk (and `TicketRows` shared with `TravelRows`), not `lazy()` entries: each lazy import's preload list cost ≈ 0.4–1 kB, more than the code.
- **No `PACK_TABS` / palette row for `statements`:** `industry-packs.ts` is first paint (the row cost ≈ +20 B); the view is reached from the desk tab and Ctrl+K "Trips" (text extended). Its help topic therefore lives in `topics-sales.ts` (the `/time` area).
- **No demo rows** for statements (size); the table is in `DEMO_EXTRA_TABLES` so a Demo removal clears any.
- CA items **TV34–TV37** (§15, total 529 → 533). R15-D may also number from TV34 — the lead renumbers on merge.

### Bundle (R15-C)

Before = `claude/elegant-cannon-cwapiv` at `6ea5407` (same tree as `868e287`), after = this branch; both built from the
same kind of checkout. Raw = `scripts/check-bundle-size.mjs` method; normalized = the same with chunk hashes stripped
from file contents (two builds of one tree differ by ≈ 1 kB raw because hashed chunk names change the gzip stream).

| Budget | Before | After | Delta | Cap |
|---|---|---|---|---|
| Initial JS (first paint) | 182.6 kB (186,958 B) | 182.6 kB (186,985 B) | +27 B gz, **0 B raw** (same 561,180 B of normalized source; only the entry's preload-list order moved) | 0 ✓; 4 initial files |
| Total JS (normalized) | 3,388,040 B | 3,399,269 B | **+11,229 B (10.97 kB)** | 11 kB ✓ |
| Total JS (raw) | 3,488,481 B (3,406.7 kB) | 3,500,191 B (3,418.2 kB) | +11,710 B (11.4 kB, incl. hash noise) | budget 3,500 kB ✓ |

Breakdown (normalized gz): Trips desk chunk +6.1 kB (statements view + import / match / bill engines 3.3, cancel dialog +
engine 2.1, bookings actions 0.5, wiring 0.2), `TicketRows` shared chunk 3.5 kB (ticket rows, value engine, the
strings area 1.4), `file-read` / `file-map` split out of the marketplace chunks +0.4 net, `tv-regime` (rules) +0.3,
`TravelRows` +0.3, help +0.15, open export +0.1, paper +0.06, the rest < 0.1 each.

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
- **Chips inside the `TravelRows` chunk** (static import, no nested lazy chunk; smaller in total).
- **Found, not fixed (for the lead):** after **Bill** on the Trips desk (in-app navigation to `/invoice/<id>`), Chromium
  leaves the editor's whole items footer (Add line, the trip row, the chips) without a layout box (`getClientRects()`
  empty, computed `display: flex`; any style change or a reload restores it — likely the `.wrap` size container's
  relayout on that mount). Opening the draft directly or reloading is fine. The e2e step reloads after Bill.
  **Fixed in QA round 18 (T1):** the footer sat inside the lines' size container; it now sits outside it (every desk's
  Bill path was affected). The e2e reload is gone (`docs/prd/qa-round-18.md`).
- **TDS hint date** = the booking's service date (the bill form has no date in `TripPick`), TV40.
- **FX** (D2 #4): no change — B's booking form already keeps `cost_currency` / `fx` per booking; the invoice uses its own
  exchange rate. Cut 2 applied (chip only, no POS rows in the trips view); cut 1 (vendor-advance column) not built.
- **Demo**: no event / outbound sample data added (`profile-travel.ts` unchanged; size).
- **CA ids** TV38–TV40 added after R15-C's TV34–TV37 (§15 total 533 → 536).

### Bundle (R15-D)

Before = `claude/elegant-cannon-cwapiv` at 707d210 (R15-C merged), after = this branch merged onto it; gzip -9.

| Budget | Before | After | Delta | Cap |
|---|---|---|---|---|
| Initial JS | 186,985 B (182.6 kB) | 186,990 B (182.6 kB) | +5 B (lazy-chunk map) | 0 ✓; 4 initial files |
| Total JS | 3,500,191 B (3,418.2 kB) | 3,511,596 B (3,429.3 kB) | **+11.1 kB** | 9 kB ✗ (+2.1) |

Breakdown (gz): POS + events engine with the D strings (`tv-events` chunk) 3.8 kB, views chunk (TCS + events) 2.6,
TCS engine 1.7, editor chips (inside `TravelRows`) ≈ 1.2, rules +0.3 (now a separate `travel-rules` chunk), chunk
re-split of B's shared modules (`tv-ui` / `tv-regime` → `tv-bookings` / `tv-run` / `TravelRows`) ≈ 0.5, desk 0.4,
bill-form hints 0.15, paper 0.15, help / palette / packs 0.35. (Measured on the R15-B base before R15-C: +14.5 kB; the
merge with R15-C's layout and mounting the chips without a nested lazy chunk brought it down.)
Options for the lead: drop the export-check line in the chip (≈ −0.2), drop the vendor TDS list in the events view (it
stays on the bill form, ≈ −0.3), drop the "near the threshold" list (history years only, ≈ −0.15).

## §R16-C — travel and hotel leftovers (C1–C5, `docs/prd/round-16.md` §R16-C)

### What shipped

| Item | Where |
|---|---|
| C1 commission income | `travel/tv-commission.ts` `billCommission`: on a booking with `commission` (typed in the booking form), **Bill commission** in the bookings table makes a draft invoice **to the principal** — the booking's supplier, or the client linked to it (`Vendor.client_id`) — through `buildBillDraft`: one line at the principal's SAC (`principalOf`: insurance → insurer 997161, air / airline → 998551, hotel / bed bank → 998552, else 998559) and 18 % (`COMMISSION_SAC_RULES`, TV16 / TV46). Expected TDS through the R14-D receivable path (`prof/ps-tds-recv.ts` `expectedTds`): 194H rate and FY threshold from `tax-rules.ts` / `tds-rules.ts` (2 % from 1 Oct 2024, ₹20,000), on the commission before GST; an insurer deducts 194D (`INSURANCE_COMMISSION_TDS_RULES`, rate by our form from the annual pack's entity type, TV48). When it applies the draft carries `tds_enabled` / `tds_section` / `tds_rate` / `tds_on_taxable`, so the issued invoice reaches the TDS receivable register and the 16A / 131 chase list; the notice labels the section by date (`ita2025.ts` `sectionText`). An insurer's invoice carries the outward reverse-charge flag (`reverse_charge` + `rcm_tax_excluded`, `INSURANCE_AGENT_RCM_RULES`, TV17). The booking keeps `comm_ref` (invoice + line); billed is derived (`commBilled`). Trip cost centre on the invoice, `tv.trip` only (no regime sentence). The trip margin is unchanged. |
| C2 re-issue | `travel/tv-reissue.ts` `reissueTicket`: **Re-issue** on an `air` booking with tickets (`ReissueForm.tsx`, in the desk chunk): new ticket no. (13 digits), fare difference and change penalty as pure-agent lines (`charge_head_id: 'rule33'`), our re-issue fee at 18 % (the C1 airline SAC); a draft through `buildBillDraft` in the agent regime with the new ticket in `tv.lines` (`reissue_of`; no fare split printed). The booking's old ticket gets `reissued_by` and the new one is appended; the old invoice keeps its line. A negative difference → `documents.createCreditNote` on the old fare line (quantity = difference ÷ fare; the old invoice must be issued); no draft when nothing else is billed. All or nothing (TV35, TV47). |
| C3 bed-bank preset | `tv-statements.ts`: `bedbank` in `STATEMENT_KINDS` and `STATEMENT_PRESETS` (hotel name, confirmation no., check-in, nights, guest, net — the net is read as `gross`, so net = gross), `StatementRow.hotel` / `nights`, type `HOTEL` when no type column. Matching unchanged (booking ref. of this supplier's bookings). |
| C4 demo rows | `demo/profile-travel.ts` (Demo company only, through `loadDemoData`): the Sharma wedding (event, budget venue / catering / decor, three vendors — one demo vendor added), the Dubai package (outbound, dated after 1 Apr 2026) with a `to5` invoice and TCS 2 % (`tcs_*` + `tv.tcs`), and one 4-row BSP statement (2 matched, 1 ADM, 1 refund). `demo/profiles.ts` passes the travel invoices through. |
| C5 hotel | `FolioView.tsx` bill-to box: **Agent commission bill** for a reservation billed to an agent with a commission % and none recorded → `hotel/agent-commission.ts` `recordCommission` (purchase-bill draft with 194H). Closes the R7-B deviation. Strings in `hotel-billing-r7.ts`. |
| Wiring | Types `// R16-C` block in `types/travel-r15.ts` (`TravelBooking.comm_ref`, `TvTicket.reissued_by` / `reissue_of`, `StatementRow.hotel` / `nights`; no record or line key). Rules `// R16-C` rows in `travel-rules.ts` (all `verified: false`). Strings `i18n/areas/travel-r16c.ts` (+ `Bed bank` in `travel-r15c.ts` `kinds`). Help: `time:trips:bookings`, `time:trips:statements`, `tables:frontdesk:folios` texts / CA ids; Ctrl+K `time.trips` text. Tests `tv-commission` (incl. the demo rows), `tv-reissue`, `tv-statements` (bed-bank case). E2E step "R16-C commission and re-issue". CA items TV46–TV48 (§15.2). |

### Deviations (R16-C)

- **`commission.bill_id`** (PRD wording) is `comm_ref: { invoice_id, line_id }`: `commission` is a number in stored rows, and the line reference lets billed be derived like `line_ref`.
- **194H below the threshold:** a ₹1,200 commission to a principal whose FY total stays under ₹20,000 gets no TDS on the draft (the notice says so, as for 194J); the e2e step seeds an earlier ₹20,000 commission invoice so 194H applies.
- **Insurer TDS is 194D**, not 194H (TV48).
- **Demo rows not in e2e:** opening the Demo company with travel packs needs the wizard path; the rows are unit-tested (`tv-commission`). The hotel button has no e2e step (the engine is tested in `hotel-bill-to`).
- **Re-issue credit** uses a 2-decimal quantity on the old fare line, so the credited amount can differ from the difference by a few paise (TV47).

### Bundle (R16-C)

Before = `claude/elegant-cannon-cwapiv` at `9c7654b` (same tree as `cbfb46c`, R16-A merged), after = this branch;
`vite build` + gzip -9 (the budget script's method).

| Budget | Before | After | Delta | Cap |
|---|---|---|---|---|
| First paint | 182.1 kB | 182.1 kB | 0 | 0 ✓; 4 initial files |
| Core precache | 3,159,641 B (3,085.6 kB) | 3,165,083 B (3,090.9 kB) | **+5.3 kB** | 8 kB ✓ |
| Hindi pack | 346,753 B (338.6 kB) | 347,077 B (338.9 kB) | +0.3 kB | 3 kB ✓ |

Breakdown (gz, estimated, not measured per module): the Trips desk chunk (commission and re-issue engines, the re-issue form, bookings actions, strings
in English) ≈ +3.1 kB, demo rows `profile-travel` ≈ +1.0 kB (over the 0.6 kB line cap: the TCS invoice, the event and
the statement), rules +0.3, bed-bank preset / labels +0.2, hotel button +0.1, help / Ctrl+K +0.2; `ps-tds-recv` is
reused from its existing chunk.
