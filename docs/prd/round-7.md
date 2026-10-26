# PRD — Round 7: hotel and lodging pack

Status: draft for build · Drafted 2026-10-26 · Baseline: branch `claude/elegant-cannon-cwapiv` at `40bb1db` (Phases 0–8,
Rounds 2–6, QA rounds 3, 5, 6 and 7 merged).

Companion documents:
- `docs/CA_REVIEW.md` §7 — the hotel items **HT1–HT17** that a CA must confirm.
- Raw research (URLs, the claim taken from each, and the downloaded notification texts):
  `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/r7/round7-sources.md` and its
  `dl1/` … `dl4/` folders. Source ids below (P1, S3, H1 …) refer to that file.

Every item follows `AGENTS.md`:
- local-first and serverless: no channel manager, no OTA / booking-engine API, no FRRO portal upload, no key-card or
  door-lock integration;
- vanilla CSS Modules with tokens;
- invoice snapshots never change;
- Indian-FY numbering;
- bare dates parsed as local days;
- statutory values date-keyed and append-only, in a rule file kept out of first paint;
- GST / TDS / Form C outputs labelled as working papers ("verify with your CA").

---

## 1. Problem statement

Hotels, lodges, guest houses, homestays and small resorts are a large group of Indian SMBs. Today they keep two
tools:
- a hotel property-management system (PMS) such as eZee, Hotelogix, IDS Next or Djubo, or a paper register;
- Tally, Vyapar or Excel for their accounts.

General billing apps have no room inventory, folio or night audit (source H7). Our app already has most of the money
side:
- restaurant tables and KOT (R3-A);
- POS, advances with receipt vouchers (5.3), receivables and statements;
- ECO tagging with GSTR-1 Table 14 and the Sec 9(5) value-only path;
- GST TCS and 194-O matching (R5-A5), common-credit reversal (R5-C2);
- security deposits (R5-C6), gift vouchers (R4-B);
- the ITA 2025 labels and e-invoice JSON.

What it lacks is the **front office**: rooms, rates, the room calendar, check-in, the folio, the nightly room post,
housekeeping, the check-out bill and hotel GST.

Hotel GST in India has three traps that a general invoice editor cannot handle:
1. **The rate depends on the value per unit per day** (P1, P2):
   - from 22 Sep 2025, a unit at **₹7,500 or less a day is 5% with no ITC**, and above ₹7,500 it is 18% with ITC;
   - one stay can mix both (a weekend rate, an extra bed);
   - meal plans sold at one price are a composite supply (S3).
2. **The restaurant rate depends on the hotel** (P3):
   - restaurant service in **"specified premises"** is 18% with ITC, and 5% without ITC elsewhere;
   - "specified" is decided per financial year: either any unit in the *previous* FY went above ₹7,500 a day, or an
     opt-in declaration was filed in the 1 Jan – 31 Mar window.
3. **Place of supply is always the hotel's location** (IGST Sec 12(3)(b), P5). A guest's company from another state
   gets CGST + SGST, never IGST. The editor's default (state of the recipient) is wrong for every out-of-state
   corporate guest.

Two further rules sit outside GST:
- **foreign guests** must be reported on Form C (now under the Immigration and Foreigners Act 2025) **within 24 hours**
  of arrival, with a ₹50,000 penalty per case (P6);
- **OTA bookings** bring TCS (Sec 52), 194-O and commission bills. If the hotel is not liable to register, the OTA
  pays the GST under Sec 9(5) (S6).

**Goal of Round 7:** ship **one industry pack, `hotel`**, as **15 items in three parallel work packages**:
- **R7-A** front office: pack set-up, masters, reservations, room calendar, check-in, housekeeping and night audit
  (6 items);
- **R7-B** folio and billing: folio windows and routing, charges to the room from the restaurant / POS, check-out
  invoice, company and agent bills, OTA payouts, and cancellation / no-show charges (6 items);
- **R7-C** hotel compliance and reports: the hotel GST desk, the Form C desk, and occupancy / ADR / RevPAR with the
  hotel's ledgers (3 items).

The pack is off for every existing company.

### How the pack switches on

The Round 5 mechanism (`src/lib/industry-packs.ts`) is used unchanged:
- one new `PackId` `'hotel'`;
- one new business type `'hotel'`;
- `PACK_OF_TYPE.hotel = ['hotel']`;
- one appended `PACK_TABS` block;
- `PACK_GST_TABS['hotel-gst'] = ['hotel']` (`src/lib/gst-tabs.ts`).

The pack's work screen lives **on the existing `/tables` route**, as `/tables?tab=frontdesk` with `&view=…`
sub-views. There is **no new route**, which saves about 0.25 kB of first paint (lazy route entry, nav row, preload
entry). A hotel's restaurant is already on `/tables`, and the hotel business type includes the `pos` module.

Two small changes make the screen findable:
- the sidebar's `/tables` row is labelled **"Front desk"** for a company whose business type is `hotel` (one
  conditional, §6);
- the wizard lands a hotel on `/tables?tab=frontdesk`.

With the pack off, `/tables` behaves exactly as today.

### Budgets the packages must respect

Measured on `40bb1db` with `npm run build && npm run check:size` (this PRD's run):

| Budget | Now | Limit | Headroom |
|---|---|---|---|
| Initial JS (first paint, gz) | **184.2 kB** | 185 kB | 0.8 kB |
| Entry chunk (gz) | 70.7 kB | 90 kB | 19.3 kB |
| Total JS (gz) | **2533.9 kB** | 2600 kB | 66.1 kB |

Round 8 (trading) is being planned in parallel and shares this headroom. The rules:

- **Total JS for the round ≤ +30 kB gz** (the lead's cap): A ≤ 13 kB, B ≤ 11 kB, C ≤ 6 kB. This leaves ≥ 36 kB for
  Round 8. No budget raise is asked for. A package that would exceed its share drops the items in its "cut first"
  line (§5) rather than asking for more.
- **First paint ≤ +0.3 kB gz for the round**: A ≤ +0.2 kB, B ≤ +0.05 kB, C ≤ +0.05 kB. Initial JS stays
  ≤ 184.5 kB, leaving ≥ 0.5 kB for Round 8.
- **What first paint may gain** (and nothing else):
  - type-only edits (`BusinessType`, `PackId` unions);
  - the registry rows (`backup.ts`, `audit-edits.ts`, `access.ts`, `sync-engine.ts`);
  - `RECORD_KEYS` strings;
  - the one nav-label conditional;
  - one bell gate of the existing `ensure…Alerts` shape, which returns before any import when the pack is off.
- **Everything else is lazy.**
  - The front desk is one lazy component that `Tables.tsx` loads only for `tab=frontdesk`. With
    `tab=frontdesk` it does not mount the restaurant floor, and with any other tab it does not load front-desk code.
  - Sub-views are lazy inside it.
  - The GST desk is a lazy GST tab.
  - The rule file is imported only by hotel modules.
- **Size discipline.**
  - One CSS module for the pack (`hotel.module.css`), and the restaurant / surface / controls styles reused.
  - The room calendar is a CSS grid, not a library. There are no charts: reports are tables, with an inline bar via
    CSS width.
  - Strings are terse: Hindi is required by `defineArea`, so every string costs twice.
- **Icons: reuse only.** Every `lucide-react` icon lands in the first-paint vendor chunk. Already imported and
  suggested:
  - R7-A: `Building2`, `CalendarRange`, `CalendarDays`, `KeyRound`, `Users`, `ClipboardList`, `Clock`, `Ban`;
  - R7-B: `ReceiptText`, `Receipt`, `Split`, `ArrowLeftRight`, `Wallet`, `HandCoins`, `Percent`, `XCircle`;
  - R7-C: `ShieldCheck`, `Globe`, `BarChart3`, `FileText`, `Landmark`.

  A new icon name fails review.
- Each package records before / after numbers in its feature doc.

### Non-goals

Anything that needs a server or the network. This drops:
- channel manager / OTA inventory and rate sync (Booking.com, MakeMyTrip-Goibibo, Agoda, Airbnb, Expedia), booking
  engine, payment gateway pre-authorisation;
- FRRO / Form C upload (the app prepares the data and tracks the 24-hour clock; the user files on the Bureau of
  Immigration site);
- door-lock key cards, call accounting (PABX), IPTV, minibar sensors;
- guest messaging apps or a guest portal (bills go out by the existing share / `wa.me` links only);
- multi-property consolidation in one company: each property with its own GSTIN is its own company (6.20), and a
  property in the same state is a branch profile.

Also out of scope this round: a banquet / function-hall module (Sec 12(3)(c); noted for later), spa appointments, and
revenue-management price suggestions.

---

## 2. Findings

### 2.1 How hotel PMS tools work (research)

Vendor documentation was preferred. Marketing pages are marked as secondary.

| Workflow | What the leading tools do | Source | Our app today (evidence) |
|---|---|---|---|
| **Room types, rooms, rates** | Room types with base / max occupancy; rate plans per room type with extra adult / child / bed; seasons and weekend rates; meal plans EP / CP / MAP / AP; corporate and agent rates; packages | H3 (Hotelogix FAQ: room-only rates, multiple rates and packages), H4 | Nothing room-shaped. Price levels and price lists exist for items (`price-list.ts`) |
| **Reservations & room calendar (tape chart)** | Calendar grid of rooms × dates; drag to assign / move; group bookings; tentative / confirmed / guaranteed; arrival / departure lists | H4 (arrival / departure lists, group bookings) | None |
| **Check-in & guest registration** | Guest profile, ID capture, foreign national details, registration card; Form C for foreigners within 24 h (India) | P6; H4 | Clients only (billing parties); no guest register, no ID or passport fields |
| **Folio** | Running account per stay; windows (Opera: 8) with routing by charge type to another window or another account; split / transfer charges; open folio after check-out | H1 (Opera routing), H2 (Cloudbeds folio, group folio, routing rules) | Restaurant `table_orders` is the nearest thing: a running order that is not an invoice (R3-A) |
| **Charges to the room** | Restaurant / bar / room service / laundry / minibar posted to the guest's folio | H1, H2 | Restaurant settles to a POS bill only (`buildSettleRecord`, `src/lib/restaurant/tables.ts:439`) |
| **Advances / deposits** | Advance-deposit ledger; deposits applied at check-out | H4 (advance-deposit ledger) | Advance receipt vouchers with GST (`advances.ts`, `ADV/FY…`), applied to invoices as payments with `advance_id`; refunds (`RFV`) |
| **Night audit** | Business date; post room and tax for in-house and guaranteed no-shows; no duplicates on re-run; due-outs resolved before the roll; reports | H1 (Opera End of Day), H2 (Cloudbeds 2 AM audit, service date vs transaction date), H3 | POS day close / Z report (`dayCloseDb`), not room-aware |
| **Housekeeping** | Clean / dirty / inspected / out of order / out of service; room assignments; maintenance work orders | H4 | None |
| **Company & travel-agent billing (city ledger)** | Transfer the folio balance to an AR ("city") ledger; agent commission report | H2 (balance transfer to AR), H4 (city ledger, TA commission report), H6 | Receivables, ageing and statements per client work for any invoice |
| **OTA bookings** | Channel manager syncs inventory; OTA-collect vs hotel-collect; commission | H5 (Djubo Instaconnekt) | ECO tagging `eco_gstin` / `eco_section` (`eco.ts`); TCS / 194-O credit matching (R5-A5, `marketplace/tcs-credit.ts`); no hotel payout entry |
| **Check-out invoice** | GST invoice from the folio, per window; e-invoice for B2B (Hotelogix + GSP) | H3 | Invoice engine, e-invoice JSON and the annexure page (R3-B4) exist, but nothing builds a hotel invoice |
| **Reports** | Occupancy %, ADR, RevPAR, source mix, revenue by department, guest ledger, city ledger, police / guest register | H4, H6 | Sales reports by item / customer only |

**What carries over to an offline app** (one device, or several with folder sync, which is not real time):
- a room-by-date calendar;
- a folio that is **not** a tax document until check-out (the R3-A "an order is not an invoice" pattern);
- an idempotent nightly post;
- routing by charge kind;
- a check-out builder that hands ordinary `InvoiceRecord`s to the existing engine;
- an OTA payout entry that reuses the R5-A TCS / 194-O rows;
- Form C as a prepared data sheet with a 24-hour bell.

### 2.2 Indian statutory findings

Confidence:
- **High** — read in the notification or statute text (gazette copy or government release);
- **Medium** — consistent secondary sources, or primary text that needs interpretation;
- **Low** — conflicting or one secondary source.

Every rule in §4 C1 carries the source and ends in "verify". The CA items are in `docs/CA_REVIEW.md` §7.

| # | Rule | Value used by the app | Source | Confidence |
|---|---|---|---|---|
| F1 | Hotel accommodation rate from **22 Sep 2025** | Value of supply of a unit ≤ ₹7,500 per unit per day → **5% (2.5 + 2.5), no ITC** (condition: "credit of input tax … has not been taken"); > ₹7,500 → **18% with ITC** (Sl 7(vi) residual) | P2 (N 15/2025-CT(R), 17 Sep 2025, "with effect from the 22nd day of September, 2025", Sl 7 item (i)); P1 (PIB FAQ Q71) | **High** |
| F2 | Earlier rows (for back-dated documents) | 1 Jul 2017: < ₹1,000 exempt; ₹1,000–2,499 12%; ₹2,500–7,499 18%; ≥ ₹7,500 28% (declared tariff). 1 Oct 2019: ≤ ₹1,000 exempt; ₹1,001–7,500 12%; > ₹7,500 18% (value of supply). 18 Jul 2022: exemption withdrawn, ≤ ₹7,500 12%; > ₹7,500 18%. | S2 (N 11/2017, 20/2019, 03/2022 + 04/2022-CT(R)) | Medium (dates and the band edges at ₹2,500 / ₹7,500 in 2017 need confirming) |
| F3 | "Declared tariff" is gone from 1 Apr 2025; the test is the **value of supply** (transaction value) per unit per day | Rate decided on the value actually charged per unit per night after discount, before GST | P3 (N 05/2025-CT(R): clause (xxxv) omitted from 1 Apr 2025); S1 | **High** |
| F4 | **Specified premises** for a FY | (a) any unit's value of supply above ₹7,500 a day in the **preceding FY**; or (b) opt-in (Annexure VII) filed 1 Jan – 31 Mar of the preceding FY; or (c) a new registrant's opt-in (Annexure VIII) within 15 days of the ARN. Opt-out (Annexure IX) in the same window. Declarations are per premises and continue until changed. | P3 (N 05/2025-CT(R), clause (xxxvi) and Annexures VII–IX) | **High** (text); Medium whether an opt-out can override (a) — the app says it cannot (HT3) |
| F5 | Restaurant (and outdoor catering) service | In specified premises: **18% with ITC**; otherwise **5% without ITC** | S1 (CBIC FAQ reproduction, 28 Mar 2025); P2 Sl 7(vi) Explanation (a) | Medium-high |
| F6 | Place of supply of accommodation | **Location of the property** (Sec 12(3)(b)) → CGST + SGST for every guest in India, including a company registered in another State; property outside India → recipient's location; property in several States → apportioned | P5 (IGST Act Sec 12(3)(b), (d), proviso, Explanation) | **High** |
| F7 | Meal plans and extra beds | Room + meals at one non-adjustable price = composite supply with accommodation as principal → the **whole** per-unit-per-day value (room + extra bed + plan meals) is tested and taxed at the accommodation rate; à-la-carte meals are a separate restaurant supply | S3 (WB AAR Orsino Hotels — binds only that applicant), S4 | Medium (HT2, HT6) |
| F8 | Cancellation / no-show charges | Taxed at the **same rate as the principal supply** (accommodation rate for the booked unit-night value) | S5 (Circular 178/10/2022-GST, as reported) | Medium (HT9) |
| F9 | Advances for accommodation | A service advance: GST on receipt (Sec 13(2)), via the existing advance receipt voucher | `tax-rules.ts` `ADVANCE_GST_ON_SERVICES_RULES` (existing, CA item G3) | Medium (HT10) |
| F10 | OTA (ECO) bookings | Hotel liable for registration → hotel pays GST; the OTA collects **TCS u/s 52** (0.5% from 10 Jul 2024) and deducts **194-O** (0.1% from 1 Oct 2024). Hotel **not liable** to register (u/s 22(1)) → the **OTA pays GST u/s 9(5)** (N 17/2017-CT(R)); the hotel's document carries no GST and is reported value-only. Voluntary registration below the threshold is disputed. | S6; `tax-rules.ts` `ECO_TCS_RATE_RULES`, 194-O rows (existing) | Medium (HT7) |
| F11 | ITC for a 5% hotel | No ITC on goods / services used for ≤ ₹7,500 units. A hotel with both bands reverses common credit proportionately. Credit-ledger balance as on 22 Sep 2025 reversed for fully-5% hotels (Sec 17(2) reading). | P2 condition text; S7 | Medium (HT4) |
| F12 | Luxury tax | Subsumed into GST from 1 Jul 2017; nothing to compute | Constitution (101st Amendment) — general knowledge | High |
| F13 | TDS by corporate guests | Rooms "taken on a regular basis" (earmarked rooms, specified rate and period) = rent → **194-I** (10%; from 1 Apr 2026 Sec 393(1) Table Sl 2(ii), unverified); a rate contract alone is not; 194C used by some tour operators; casual stays → usually no TDS | T1 (CBDT Circular 5/2002 as quoted; challenged in writs), T2 | Low-medium (HT12) |
| F14 | Commission paid to travel agents | 194H on commission paid by the hotel (existing 194H rows); OTA commission netted from a payout: no 194H computed (OTA side is 194-O) | `tds-rules.ts` 194H (existing) | Low (HT8) |
| F15 | Foreign guests | **Form C** (also called Form III) uploaded **within 24 hours of arrival** under the **Immigration and Foreigners Act 2025** (in force **1 Sep 2025**), Sec 8 + Rule 17 of the 2025 Rules; ₹50,000 penalty per case; check-out to be updated; registration on boi.gov.in | P6 (Govt of Goa release, 10 Dec 2025) | Medium-high (state release, not the Act text; HT13) |
| F16 | e-Invoice | Hotels are not in the exempt list; B2B invoices need an IRN when AATO > ₹5 crore (existing threshold rule) | Existing `einvoice.ts` rules | Medium (HT15) |

**Corrections to common secondary claims:**
- **No nil band below ₹1,000.** One finance site says such rooms are nil-rated after 22 Sep 2025 (S8). That is
  contradicted by S2 (the exemption ended on 18 Jul 2022) and by P2, which adds no nil band.
- **Declared tariff is not the test.** A forum answer says the declared tariff still decides the slab (S7); P3
  omitted that definition from 1 Apr 2025. The app uses the value of supply.

### 2.3 What we already have, and what is missing (verified against `src/`)

| Need | Have (file) | Missing → item |
|---|---|---|
| Pack switch, business types, Ctrl+K group | `industry-packs.ts`, `shop-presets.ts`, `CommandPalette` "Industry packs" group | `hotel` pack / type → **A1** |
| Restaurant in the hotel | `/tables`, `restaurant/{tables,kot,split-bill,orders-store}.ts`; settle via `buildSettleRecord` → POS bill | "Charge to room" settle mode → **B2** |
| POS | `pos.ts` `buildPosRecord` / `savePosBill` | "Room" tender (post to folio instead of saving a bill) → **B2** |
| Advances with GST (Rule 50) and refunds (Rule 51) | `advances.ts` (`saveAdvance`, `openAdvancesFor`, adjustment as payment with `advance_id`) | Link advance ↔ reservation; apply at check-out → **A3**, **B3** |
| Refundable damage deposit | `property/deposits.ts` (R5-C6, `security_deposits`) | Reused as is for homestays / long stays (link only) → **B3** |
| Gift vouchers | R4-B `gift_vouchers`, receipt with `gift_voucher_id` | Accepted at check-out unchanged → **B3** |
| Receivables, statements, ageing (city ledger) | `receivables.ts`, statements, follow-ups | "Bill to company / agent" builder → **B4** |
| ECO tagging, Table 14, 9(5) value-only | `eco.ts`, `gst-reports.ts` (`isEco95`, Table 14) | OTA booking source → tags; payout entry → **B5** |
| GST TCS / 194-O credit | `marketplace/tcs-credit.ts`, `eco_credits` table (R5-A5) | Rows from OTA payouts → **B5** |
| Common credit (Rule 42 / 43) | `institutions/common-credit.ts`, `PACK_GST_TABS['common-credit']` | Hotel turnover split (5%-no-ITC vs 18%) as input; `hotel` added to the tab's packs → **C1** |
| Explicit place of supply | `InvoiceRecord.place_of_supply`, `gst_mode` | Builder forces the property's state → **B3** |
| Night-wise detail page | Annexure page (R3-B4, `annexure.ts`, `InvoiceAnnexure`) | Folio rows mapped to annexure rows → **B3** |
| TDS a customer deducts | `tds_section` on invoices, TDS register, `ita2025.ts` labels | Default per company client (194-I-B / 194C / none) → **B4** |
| Cancellation fee | `late-fee.ts` (principal-rate draft invoice) shows the pattern | Policy → charge → invoice → **B6** |
| Statutory date-keyed tables out of first paint | `r5c-rules.ts`, `transport-works-rules.ts` pattern | `hotel-rules.ts` → **A1** (content specified in **C1**) |
| Bell gates | `NotificationBell.tsx` `ensure…Alerts` | Arrivals / due-outs / Form C 24 h / night audit not run / declaration window → **C2**, **A6** |
| Guest register, Form C, room status, night audit, occupancy reports | — | **A4**, **C2**, **A5**, **A6**, **C3** |

Grep evidence on `40bb1db`: `hotel`, `accommodation` (outside payroll perquisites), `9963`, `specified premises`,
`folio`, `night audit`, `Form C` and `housekeeping` find nothing in `src/` apart from the ECO comment in `eco.ts:8`
and `types/invoice.ts:348`.

---

## 3. Ranked list

Value runs 1–5 (5 = every hotel, every day). Effort is S = 1, M = 2, L = 3. Score = value ÷ effort.

| Rank | Id | Gap | Seen in | Value | Effort | Score | Pkg |
|---|---|---|---|---|---|---|---|
| 1 | R7-A1 | Hotel pack, business type, front-desk shell, rule file | R5 packs | 5 | S | 5.0 | A (lands first) |
| 2 | R7-C2 | Form C desk with the 24-hour clock | P6 | 4 | S | 4.0 | C |
| 3 | R7-A5 | Housekeeping board | eZee | 3 | S | 3.0 | A (cut first) |
| 4 | R7-B6 | Cancellation / no-show charges | Opera, Circular 178 | 3 | S | 3.0 | B |
| 5 | R7-C1 | Hotel GST desk: slab per unit-day, specified premises, ITC split | GST law (F1–F5, F11) | 5 | M | 2.5 | C |
| 6 | R7-B3 | Check-out invoice from the folio (slabs, POS = property, advances, annexure) | every PMS | 5 | M | 2.5 | B |
| 7 | R7-A3 | Reservations and room calendar | every PMS | 5 | M | 2.5 | A |
| 8 | R7-B1 | Folio windows, routing, split / transfer, void | Opera, Cloudbeds | 5 | M | 2.5 | B |
| 9 | R7-A2 | Room types, rooms, rate plans (meal plans, weekend, seasons, extras) | every PMS | 5 | M | 2.5 | A |
| 10 | R7-A4 | Check-in, guest register, walk-in | every PMS; P6 | 5 | M | 2.5 | A |
| 11 | R7-A6 | Night audit: business date, nightly post, no-shows, due-outs | Opera, Cloudbeds, Hotelogix | 4 | M | 2.0 | A |
| 12 | R7-B2 | Charge to room from Tables / POS | every PMS | 4 | M | 2.0 | B |
| 13 | R7-B4 | Company and agent billing (city ledger), TDS defaults, agent commission | eZee, Cloudbeds | 4 | M | 2.0 | B |
| 14 | R7-B5 | OTA bookings and payouts (TCS, 194-O, commission, 9(5)) | Djubo, R5-A | 4 | M | 2.0 | B (cut first) |
| 15 | R7-C3 | Occupancy / ADR / RevPAR, source mix, guest / advance / city ledgers, police register | eZee, CBSE FO text | 4 | M | 2.0 | C (cut first) |
| — | — | Banquets / function halls (Sec 12(3)(c)) | Opera S&C | 3 | L | 1.0 | later |
| — | — | Group master bill with rooming list import | Opera, Cloudbeds | 3 | M | 1.5 | later (A3 has multi-room bookings) |
| — | — | Rate suggestions / revenue management | Mews, Opera | 2 | L | 0.7 | dropped |
| — | — | Channel manager / OTA sync | Djubo, eZee | 5 | L | — | dropped (network) |

Ties are broken by value. All 15 ranked items are in scope. "Cut first" marks the item each package reduces first if it
would exceed its bundle share (§5).

**Overlap with earlier rounds (not re-specified):**
- Restaurant floor, KOT, modifiers, split bills: R3-A. B2 adds only a settle mode.
- Advances and refunds: 5.3. Security deposits: R5-C6. Gift vouchers: R4-B.
- TCS / 194-O credit matching: R5-A5. Common credit: R5-C2.
- Leases for monthly room rentals to companies: R5-C5 (a guest house letting rooms by the month uses the leases pack,
  not folios).

---

## 4. Specifications (15 items)

Conventions (same as Round 5, plus the hotel rules):

- **Logic and tests.** Pure logic goes in `src/lib/hotel/*.ts`, tested with `node:test` in `tests/hotel-*.test.ts`.
  Tested modules use no browser APIs.
- **Strings.** Strings go in one i18n area per package: `src/i18n/areas/hotel-frontdesk-r7.ts` (A),
  `hotel-billing-r7.ts` (B), `hotel-compliance-r7.ts` (C). Each uses `defineArea(en, hi)`. Trade words stay in
  English in both languages: EP / CP / MAP / AP, ADR, RevPAR, folio, Form C, OTA.
- **Pack gate.**
  - Every new view, dialog field, settle mode and bell gate checks `isPackOn(settings, 'hotel')`.
  - With the pack off, no hotel table is read and no hotel UI renders.
  - A test in each package spies on `getTable` and asserts this on `/tables`, POS and GST render.
- **Types.** All new record types are declared once in `src/types/hotel-r7.ts` (A1). Additive fields on existing
  records come by declaration merging in that same file (A1 owns it; B and C append to their own marked blocks, §6).
  `InvoiceRecord` gains:
  - `folio_id?`, `reservation_id?` and `stay?: { arrival, departure, rooms: string[], nights, adults, children }`,
    all in `RECORD_KEYS` and `normalizeRecord`;
  - `hotel_band?: 'low' | 'high' | 'mixed'` (the C1 slab result, a snapshot).
- **Engines are reused, not copied.**
  - Check-out documents are ordinary `InvoiceRecord`s saved through `localDb.invoices.save`, so GSTR-1 / 3B,
    e-invoice, receivables, books, Tally and the recycle bin see them unchanged.
  - Advances use `advances.ts`; receipts use `localDb.payments.record`.
  - Restaurant orders stay `table_orders`; POS stays `pos.ts`.
- **A folio is not a tax document.**
  - It has no GST and no number in a tax series. It is never in a GST or sales report.
  - Only the check-out (or interim) invoice is.
  - This is the R3-A rule for running orders.
- **Guards.**
  - Masters need `master.edit`. Reservations, folios, guests and night audits need `doc.create`. Voiding a posted folio
    line needs `doc.create` + a reason; above the clerk cap (B1) it needs the owner PIN (R3-A `needsOwnerPin`
    pattern). Hotel settings need `settings.manage`.
  - Every check-out invoice goes through `assertUnlocked` (period lock) like any invoice.
- **Numbering.** Reservations use `series-counters.ts` series **`RES`** (`RES/FY26-27/0001`). A folio is named after
  its reservation plus the window (`RES/FY26-27/0001 · W2`). Invoices use the normal invoice series of the sender
  profile.
- **Dates.**
  - All stay dates are local days (`YYYY-MM-DD`, Critical Rule 8). A night is identified by its start day: the
    night of 24 Oct is 24 → 25 Oct.
  - The **business date** is stored in `hotel_settings.business_date`. It moves only through night audit (A6). It is
    not the device clock, so a night audit at 2 AM still posts "yesterday".
- **Money.** Money goes through `round2` / paise. Rates in rate plans are tax-exclusive by default. A plan may be
  marked tax-inclusive; the band is then found by solving for the pre-tax value (C1 `bandForInclusive`).
- **Statutory values** live in `src/lib/hotel/hotel-rules.ts`: date-keyed `Versioned<…>` rows, append-only, each with
  a `source` ending in "verify". It is imported only by hotel modules. `tax-rules.ts` is not edited.
- **Help, Ctrl+K and CA ids.**
  - Every new view has a help topic in `src/lib/help/topics-packs.ts`, referencing HT ids.
  - Every `PACK_TABS` row has a `labelKey` in its package's area.
  - The GST tab has its Ctrl+K title in `discover-r6-tabs.ts` and synonyms in `palette/synonyms.ts`.
  - `tests/help-registry.test.ts` and `tests/palette-tabs.test.ts` must pass unchanged.

### R7-A — Front office

#### R7-A1 Hotel pack, business type and the front-desk shell

*Seen in:* R5-A1 packs; 8H shop mode.

**User story.** As the owner of a 14-room lodge, I want to say "I run a hotel / lodge" in setup and land on a front
desk, while a kirana on the same app never sees it.

**Acceptance criteria.**
1. **Pack and type.**
   - `PackId` gains `'hotel'`; `PACK_IDS` and `PACK_OF_TYPE.hotel = ['hotel']`.
   - `BusinessType` gains `'hotel'` (type only, `shop-mode.ts`).
   - `shop-presets.ts`: `BUSINESS_TYPES`, `PACK_BUSINESS_TYPES`, `PRESETS.hotel = ['pos', 'inventory', 'purchases',
     'accounts', 'banking', 'reports', 'gst', 'tds', 'payroll']`, and `BUSINESS_DEFAULTS.hotel = { defaultDueDays: 0,
     templateId: 'gst_tax_invoice', landing: '/tables?tab=frontdesk' }`.
   - Settings → Shop mode lists the pack with a one-line description. The wizard shows a "Hotel / lodge / homestay"
     card.
2. **Shell.**
   - `Tables.tsx` reads `tab`. For `tab=frontdesk` it renders the lazy `FrontDesk` component **instead of** the
     restaurant floor: the floor's memos (`loadMenu`, orders) are not run.
   - `FrontDesk` has a view strip: Board (default) · Calendar · Reservations · Folios · Housekeeping · Night audit ·
     Guests · Reports · Setup. Each view is lazy and comes from `&view=`.
   - When the pack is on, the restaurant floor's area strip gains a first "Front desk" tab (a link to
     `?tab=frontdesk`), and the front desk has a "Restaurant" link back.
3. **Sidebar.** `DashboardLayout.tsx` shows the `/tables` row as `nav.frontDesk` ("Front desk" / "फ्रंट डेस्क") when
   `business_type === 'hotel'`. This is one ternary on the label; the path is unchanged.
4. **Board view.** Today's business date, with:
   - counts: arrivals, in-house, due-outs, vacant clean, vacant dirty, OOO;
   - tiles per room: number, type, status colour, guest surname and nights left;
   - quick actions: Walk-in, New booking, Check in, Check out, Post charge.
5. **Rule file.** `src/lib/hotel/hotel-rules.ts` is created here, with exactly the rows of C1 §Rules (A1 lands the file
   so B and C build on it; C owns later appends).
6. **Store.** `src/lib/hotel/hotel-store.ts` has typed getters / setters for every hotel table. Writes run
   `requireAccess` and `assertUnlocked` where dated. A1 also adds every registry row (§6) for all three packages, so B
   and C do not edit `backup.ts`, `audit-edits.ts`, `access.ts` or `sync-engine.ts`.
7. **Never removal.** Turning the pack off hides the front desk and the bell gate. Data stays. Hotel invoices stay
   ordinary invoices everywhere.

**Files.**
- New: `src/lib/hotel/{hotel-rules,hotel-store,business-date}.ts`, `src/types/hotel-r7.ts`,
  `src/components/hotel/{FrontDesk,BoardView}.tsx`, `src/components/hotel/hotel.module.css`,
  `src/i18n/areas/hotel-frontdesk-r7.ts`, `docs/features/hotel.md`.
- Edit:
  - `src/lib/industry-packs.ts` (union, ids, `PACK_OF_TYPE`, appended `PACK_TABS` block for all three packages);
  - `src/lib/shop-mode.ts` (union only), `src/lib/shop-presets.ts`;
  - `src/pages/Tables.tsx` (tab switch + front-desk link);
  - `src/layouts/DashboardLayout.tsx` (one label ternary), `src/i18n/en.ts` / `hi.ts` (`nav.frontDesk`);
  - `src/components/settings/ShopModePanel.tsx` and `src/components/onboarding/SetupWizard.tsx` (card / checkbox
    only, if they do not already render from `PACK_IDS`).

**Storage.**
- Object `mrchartist_inv_hotel_settings`: `{ business_date, checkin_time: '12:00', checkout_time: '11:00',
  clerk_void_cap, interim_days: 30, premises: PremisesDecl[], tax_inclusive_default: false, sac_room: '996311',
  sac_fnb: '996331' }` (§7 D3).
- The rest is created by A2–A6.

**Bundle.** First paint: union types (0), registry rows, nav ternary + 2 strings, `RECORD_KEYS` (≈ +0.18 kB).
Front-desk shell ≈ 2.5 kB gz.

**Tests.** `tests/hotel-pack.test.ts`:
- type → pack, and explicit `industry_packs: []` beats the type;
- `PACK_TABS` hotel rows resolve to `/tables`;
- `isPathVisible('/tables')` for the hotel preset;
- `/tables` without `tab` never imports `components/hotel/*` (static import scan of `Tables.tsx`);
- with the pack off, no `hotel_*` `getTable` call happens on Tables render.

#### R7-A2 Room types, rooms and rate plans

*Seen in:* Hotelogix rate plans and packages (H3); eZee (H4); Opera rate codes (H1).

**User story.** As the manager, I set up Deluxe (6 rooms) and Suite (2 rooms) once. I add a CP plan with breakfast,
weekend and Diwali-season prices, ₹800 per extra bed and a corporate rate for one company. Every booking then prices
itself.

**Acceptance criteria.**
1. **Room types:** name, code, base occupancy, max occupancy, max extra beds, SAC (default 996311), sort.
2. **Rooms:** number, room type, floor, active, and the housekeeping fields (A5).
3. **Rate plans:**
   - name, code, meal plan `EP | CP | MAP | AP`;
   - per room type: rate for 1 and 2 adults, extra adult, extra child, extra bed;
   - weekend days (default Fri, Sat) with their own rates or a % uplift;
   - seasons `{ name, from, to, kind: 'pct' | 'amount' | 'override', value }` (later rows win on overlap);
   - min stay; tax-inclusive flag;
   - audience `public | corporate | agent | ota` with an optional client id (a company's or agent's own plan);
   - cancellation / no-show policy (B6 fields);
   - **meal component** per adult per day (for MAP / AP: information for the folio and annexure only; tax follows C1
     composite rule, §7 D5).
4. **Pricing function (pure).** `priceNight(plan, roomType, { night, adults, children, extraBeds })` returns
   `{ room, extraAdult, extraChild, extraBed, meal, total }` for one night, with the season and weekend applied.
   `priceStay` maps it over nights. A booking **snapshots** the nightly prices (A3), so editing a plan never reprices
   a confirmed booking unless the user asks for "Re-price".
5. **Starter data:** an empty company gets one room type "Standard", rooms 101–110 and an EP plan at ₹0, shown with
   a "set your rates" prompt (the R3-A starter pattern). Starter rows are not written until the first save.

**Files.** New: `src/lib/hotel/{rooms,rate-plans,pricing}.ts`, `src/components/hotel/{SetupView,RatePlanForm}.tsx`.

**Storage.** `hotel_room_types`, `hotel_rooms`, `hotel_rate_plans` (rows; masters).

**Bundle.** ≈ 2.5 kB gz.

**Tests.** `tests/hotel-pricing.test.ts`:
- weekend and season precedence; extra adult / child / bed; min stay;
- tax-inclusive plan reverse-solved per night;
- snapshot unchanged after a plan edit; Re-price recomputes.

#### R7-A3 Reservations and the room calendar

*Seen in:* every PMS (H1–H5).

**User story.** As the front-desk clerk, a caller wants two Deluxe rooms for 24–27 Oct with breakfast. I see what is
free on a calendar, book it, take ₹3,000 advance on UPI and send the confirmation on WhatsApp.

**Acceptance criteria.**
1. **Reservation:**
   - number `RES/FY…` (series `RES`), booked on, source `walk_in | phone | direct | company | agent | ota`;
   - for an OTA: OTA name, OTA booking ref, operator GSTIN, collect model `ota_collect | hotel_collect` (B5);
   - guest (name, phone, email, nationality; links to `hotel_guests` after check-in), bill-to (B4);
   - arrival, departure;
   - one or more **room lines** `{ room_type_id, room_id?, rate_plan_id, adults, children, extra_beds, nightly:
     NightPrice[], status }`;
   - status `tentative | confirmed | checked_in | checked_out | cancelled | no_show`;
   - guarantee `none | advance | company | card_noted`; notes.
2. **Availability.** `freeRooms(type, from, to)` excludes:
   - rooms of other live reservations whose nights overlap (departure day is free);
   - OOO rooms (A5).

   Overbooking is refused per room. A type-level booking without a room is allowed up to the free count of the type,
   with a warning when it is the last room.
3. **Calendar (tape chart).**
   - Rooms × 14 days (phone: 7) as a CSS grid, with bars for bookings coloured by status.
   - Tap an empty cell → New booking for that room and day.
   - Tap a bar → open the booking.
   - Move room / extend / shorten are buttons in the booking, not drag and drop (size; works on phones).
   - Prev / next / today navigation.
4. **Advance.** "Take advance" opens the existing advance dialog pre-filled with the guest / bill-to party and
   `supply: 'service'`. GST on the advance comes from the C1 band of the booked nights (`computeAdvanceTax`, existing).
   The advance id is stored on the reservation (`advance_ids`).
5. **Confirmation.** Share text (arrival, departure, rooms, plan, amount, advance, cancellation policy) through the
   existing share / `wa.me` link. No e-mail sending.
6. **Lists.** Arrivals, departures and in-house for a date; a search by name / phone / number.
7. **Cancel / no-show** hands to B6 for the charge. The rooms are released.

**Files.** New: `src/lib/hotel/{reservations,availability}.ts`,
`src/components/hotel/{CalendarView,ReservationForm,ReservationsView}.tsx`.

**Storage.** `hotel_reservations` (rows; DATED by `arrival`; NUMBERED `RES`).

**Bundle.** ≈ 3.5 kB gz.

**Tests.** `tests/hotel-reservations.test.ts`:
- overlap rules (the departure day is free), OOO exclusion;
- type-level count; overbooking refused;
- `RES/FY` numbering across 31 Mar → 1 Apr;
- cancel releases rooms;
- the advance carries the band-correct GST rate.

#### R7-A4 Check-in, guest register and walk-ins

*Seen in:* every PMS; Form C rules (P6).

**User story.** At 1 PM the guests arrive. I check them in to rooms 203 and 204, capture their IDs, and one guest is a
French national, so the app asks for the passport and visa details Form C needs and starts a 24-hour clock.

**Acceptance criteria.**
1. **Check-in** of a reservation room line (or a **walk-in**, which creates the reservation in one step):
   - assign / confirm the room (only vacant-clean or vacant-inspected rooms are offered, others with a warning);
   - add guests per room: one primary and others;
   - set `checked_in_at`;
   - open the folio(s) (B1 `openFolios`, from the store contract in A1);
   - mark the room occupied.
2. **Guest record** (`hotel_guests`):
   - name, phone, email, address, nationality, date of birth (optional);
   - ID type `aadhaar | passport | driving_licence | voter_id | other` and ID number;
   - optional ID image as an attachment (`assets`, existing);
   - for **non-Indian nationality**, the Form C fields: passport number, place and date of issue, expiry; visa number,
     type, place and date of issue, expiry; arrived in India on, arrived from (city / country), next destination,
     purpose, address in India. These are required before check-in completes; "Complete later" is allowed and keeps
     the C2 clock red.
   - A returning guest is matched by phone or passport and pre-filled.
3. **Privacy (§7 D9).**
   - An Aadhaar number is stored masked (`XXXX XXXX 1234`) unless the user un-ticks "store masked".
   - The guest list shows masked ids.
   - The ID image is optional and off by default.
   - A banner recommends vault mode (`vault.ts`) when guests' ID data is stored.
   - Nothing leaves the device except through the user's own backup / sync.
4. **Registration card** print (A5 / thermal via the existing print path): guest details, stay, rate, plan, signature
   line, and the hotel's terms (a settings text).
5. **Guest register** (police register) view: one row per guest per stay, by date range; print and CSV.

**Files.** New: `src/lib/hotel/{checkin,guests}.ts`, `src/components/hotel/{CheckInDialog,GuestForm,GuestsView}.tsx`.

**Storage.** `hotel_guests` (rows); check-in fields on the reservation room line (`room_id`, `checked_in_at`,
`checked_out_at`, `guest_ids`, `form_c?: { due_at, filed_at?, ref? }`).

**Bundle.** ≈ 2.5 kB gz.

**Tests.** `tests/hotel-checkin.test.ts`:
- walk-in creates a reservation + folio;
- foreign guest without passport → incomplete + `form_c.due_at` = arrival + 24 h;
- Aadhaar masking; returning-guest match;
- check-in refused on an OOO room.

#### R7-A5 Housekeeping board

*Seen in:* eZee housekeeping and maintenance (H4); Opera room status.

**User story.** As the housekeeper, I see which rooms are dirty after check-outs. I mark them clean, and the manager
inspects them. Room 108 has a broken AC, so it goes out of order until Friday.

**Acceptance criteria.**
1. Room status: `clean | dirty | inspected | ooo | oos`, plus occupancy (vacant / occupied) derived from stays.
2. **Automatic changes:**
   - check-out → dirty;
   - night audit → occupied rooms dirty (option, default on);
   - OOO with from / to / reason makes the room unavailable for A3 in that range.
3. A board grouped by floor and status, with one-tap status change. Housekeeping is usable by a clerk (`doc.create`).
4. Changes are audited through `WATCHED_TABLES` (no separate log table).

**Files.** New: `src/lib/hotel/housekeeping.ts`, `src/components/hotel/HousekeepingView.tsx`.

**Storage.** Fields on `hotel_rooms`: `hk_status`, `hk_at`, `hk_by`, `ooo?: { from, to, reason }`.

**Bundle.** ≈ 1 kB gz. **Cut first in A** (if over budget: status buttons on the Board only).

**Tests.** In `tests/hotel-checkin.test.ts`:
- check-out → dirty; OOO range blocks availability;
- inspected → clean is offered for check-in.

#### R7-A6 Night audit

*Seen in:* Opera End of Day "Post Room and Tax" with no duplicates on re-run (H1); Cloudbeds scheduled audit and
service vs transaction date (H2); Hotelogix (H3).

**User story.** At the end of the night I press "Run night audit". The app posts tonight's room charges to every
in-house folio, lists the no-shows and the guests who should have left, and moves the business date to tomorrow. If
I forgot last night, it catches up.

**Acceptance criteria.**
1. **Pre-checks** (blocking, each with a fix button):
   - due-outs still checked in → check out or extend;
   - arrivals not checked in → check in, mark no-show (B6) or keep (guaranteed bookings stay as "late arrival");
   - Form C incomplete is a warning, not a block.
2. **Post room nights.**
   - For each in-house room line and the business date's night, add folio lines from the booking's snapshot: room,
     extra bed / person, meal component as information.
   - Lines route by the folio's rules (B1).
   - The post is **idempotent**: a line key `stay:<line id>:<night>` is never posted twice, so a re-run and a
     catch-up are safe.
3. **Catch-up.** If `business_date` is older than yesterday, the audit runs night by night up to yesterday, after one
   confirmation that lists the nights.
4. **Roll.** `business_date` += 1 day. A `hotel_night_audits` row is saved with:
   - the business date, who and when;
   - posted line keys, no-shows and due-outs resolved;
   - statistics: rooms available (active − OOO), occupied, complimentary, house use, room revenue, ADR, RevPAR,
     occupancy %;
   - revenue by kind, payments by mode (from receipts dated that day);
   - open folio balance (guest ledger), advances held (advance-deposit ledger).
5. **Report** printable (A4 / thermal), with CSV.
6. **Period lock.** Posting into a locked period is refused (`assertUnlocked`). The audit stops and says which date.
7. **31 March.** When the business date is 31 Mar, the audit offers "Issue interim invoices for in-house guests"
   (B3), default **on** (§7 D7).

**Files.** New: `src/lib/hotel/{night-audit,room-post}.ts`, `src/components/hotel/NightAuditView.tsx`.

**Storage.** `hotel_night_audits` (rows; DATED by `business_date`).

**Bundle.** ≈ 2 kB gz.

**Tests.** `tests/hotel-night-audit.test.ts`:
- post once, then re-run → no new lines;
- catch-up three nights;
- no-show handoff; due-out blocks;
- statistics: ADR = room revenue ÷ occupied rooms (complimentary excluded), RevPAR = room revenue ÷ rooms available,
  occupancy = occupied ÷ available;
- refusal in a locked period;
- the 31 Mar prompt.

### R7-B — Folio and billing

#### R7-B1 Folio windows, routing, split, transfer and void

*Seen in:* Opera folio windows 1–8 and routing by transaction code with limits (H1); Cloudbeds group folio and routing
rules (H2).

**User story.** A company pays for the room and breakfast. The guest pays for the bar and the laundry. I set that once
at check-in and the right charges land on the right bill.

**Acceptance criteria.**
1. **Folio** (`hotel_folios`):
   - reservation and room-line link (or `house` for a non-staying account, e.g. a walk-in restaurant credit to a
     company — §7 D10);
   - window `1..4`; payer (guest or a client);
   - lines `{ id, key?, date (business date), kind, desc, qty, rate, amount, sac?, room_no?, src?: { table_order_id?,
     invoice_id?, night? }, void?: { by, at, reason }, moved_from? }`;
   - status `open | settled | invoiced`; `invoice_ids`.
   - **Line kinds:** `room`, `extra_bed`, `extra_person`, `meal_plan`, `fnb`, `laundry`, `minibar`, `transport`,
     `misc`, `cancellation`, `no_show`, `allowance` (a negative correction).
2. **Routing rules** on the reservation: `{ kinds: LineKind[], window }[]`. Room-type kinds default to window 1. When
   the bill-to is a company (B4), window 2 is the company's: room + meal plan go there and the rest to window 1 (the
   guest).
3. **Post charge** dialog: kind, description, qty × rate, room. Laundry, minibar and misc lines take their SAC / HSN
   from settings or a catalogue item.
4. **Split** a line by amount or qty into two windows. **Transfer** lines to another window, another in-house folio
   (room-to-room) or a company folio. `moved_from` is kept.
5. **Void** needs a reason. A clerk above `clerk_void_cap` (default 2 lines or ₹1,000 a day) needs the owner PIN
   (`checkPinWithGuard`). Voided lines stay visible, struck through. Posted room lines can be voided only with the
   reason "rate correction" or "complimentary".
6. **Balance** per window = lines − applied advances / payments. Folio print (pro-forma, marked "Not a tax invoice").

**Files.** New: `src/lib/hotel/{folio,routing}.ts`, `src/components/hotel/{FolioView,PostChargeDialog}.tsx`.

**Storage.** `hotel_folios` (rows; DATED by `opened_on`).

**Bundle.** ≈ 3 kB gz.

**Tests.** `tests/hotel-folio.test.ts`:
- routing by kind; split keeps totals; transfer room-to-room;
- void cap → PIN required; voided lines excluded from balance;
- `open → invoiced` once all windows are billed.

#### R7-B2 Charge to room from the restaurant and the POS

*Seen in:* every PMS.

**User story.** Table 4's diners are guests in room 203. The captain picks "Charge to room 203", the guest signs the
check, and the amount appears on 203's folio. No separate restaurant invoice is made.

**Acceptance criteria.**
1. With the pack on, the Tables order panel's Settle offers **"Room"** next to Cash / UPI / Card. Room picks an
   in-house room (list of in-house rooms with the primary guest's surname). It asks for a signature-line print
   (optional).
2. Settling to a room:
   - does **not** call `buildSettleRecord`;
   - adds one `fnb` line per order (not per item) with the order total before GST, `src.table_order_id` and the KOT
     numbers in the description;
   - marks the order settled with `folio_id`.

   The day-close blocker (`openOrdersBlocker`) treats it as settled.
3. POS: a **"Room"** tender behaves the same (one `fnb` or `misc` line, by the bill's lines' kind), with no POS
   invoice and no Z-report cash.
4. The restaurant's own tax is **not** charged at this point. The check-out invoice (B3) charges F&B at the C1
   restaurant rate. A **guest who leaves without staying** (non-resident) is billed at the table as today.
5. Undo: until the folio is invoiced, "Reopen" on the order removes its folio line (logged).

**Files.** New: `src/lib/hotel/charge-to-room.ts`, `src/components/hotel/RoomPicker.tsx` (lazy).
Edit: `src/components/restaurant/OrderPanel.tsx` (one pack-gated button → lazy `RoomPicker`),
`src/lib/restaurant/orders-store.ts` (one `settleToFolio` function next to `settleOrder`), `src/pages/Pos.tsx` (one
pack-gated tender → lazy `RoomPicker`).

**Storage.** Additive `TableOrder.folio_id?` (declared in `hotel-r7.ts`).

**Bundle.** ≈ 1 kB gz (lazy); first paint 0.

**Tests.** `tests/hotel-charge-to-room.test.ts`:
- order → one folio line with the pre-GST total;
- the order is settled and not in day-close blockers;
- no invoice is created;
- reopen removes the line;
- POS Room tender adds no Z-report cash.

#### R7-B3 Check-out invoice

*Seen in:* every PMS; GST rules F1–F7, F9.

**User story.** At check-out I press "Check out". The app shows each window's bill:
- the room nights at 5% (₹3,500 a night) and the one festival night at 18% (₹8,200);
- breakfast inside CP taxed with the room;
- the restaurant charges at the hotel's restaurant rate;
- the advance applied.

I take the balance on UPI and share the invoice.

**Acceptance criteria.**
1. **Build (pure)** `buildCheckoutInvoices(folio windows, ctx)` → one `InvoiceRecord` draft per window with a balance
   or lines:
   - **Client** = the window's payer: guest (B2C unless a GSTIN is given) or company / agent client.
   - **Place of supply = the property's state** (the sender profile's state, F6). `gst_mode` follows from it (intra
     for any Indian guest). A foreign guest is still intra-state (property in India, F6).
   - **Room lines.**
     - Grouped per room × rate × band: "Room 203 · Deluxe · CP · 3 nights × ₹3,500 (24–27 Oct)".
     - The band per **unit per night** comes from C1 `accommodationBand(nightValue, date)`.
     - `nightValue` = room + extra bed + extra person + meal component when the plan is composite (MAP / AP / CP),
       after the night's share of any discount, before GST (F3, F7).
     - Tax rate from the band; SAC 996311.
   - **F&B lines** (`fnb` kind, including B2 charges) at `restaurantRate(premisesStatus(fy), date)` (C1), SAC 996331.
   - **Other kinds** at the rate of their catalogue item / settings default.
   - **Cancellation / no-show** lines at the band of the night they replace (B6).
   - **Annexure.** The night-wise detail is attached as the R3-B4 annexure. Rows are mapped as `date` = night,
     `who` = room no, `description` = kind + plan, `minutes` / `billed_minutes` = 0, `rate` = `amount` = value. The
     annexure prints only on A4.
   - **Snapshot.** `stay` is snapshotted, along with `folio_id`, `reservation_id` and `hotel_band`
     (`low | high | mixed`).
   - **Rate-change nights.** Nights before a rate-change date take the rate in force on the **invoice date** (Sec 14
     reading, §7 D6). The draft shows a chip "Rate changed on <date> — n nights affected" so the user can split the
     invoice by hand if the CA advises.
2. **Settle.**
   - Open advances of the party (`openAdvancesFor`) are listed and applied by default. Gift vouchers and the R5-C6
     deposit (adjust) are offered when they exist.
   - Balance by any payment mode.
   - **Bill to company:** no payment; the invoice goes to receivables (B4).
3. **Save.**
   - Invoices are saved through `localDb.invoices.save` in one rollback block (the R3-A `withTablesRollback`
     pattern): all windows or none.
   - The folio is marked `invoiced`, the room line `checked_out_at` is set, and the room turns dirty (A5).
   - The existing post-save sheet (share, print, e-invoice JSON when B2B and AATO is above the threshold) opens.
4. **Interim invoice.**
   - For stays longer than `interim_days` (default 30, Rule 47 window, §7 D7), on 31 Mar (A6), or on demand.
   - It invoices the posted lines up to the business date and leaves the folio open. Lines already invoiced are
     marked with the invoice id and never billed twice.
5. **Unregistered hotel or 9(5) OTA stay** (B5): the document is a **Bill of Supply** (`bill-of-supply.ts`, existing)
   or a 9(5) document with `eco_section: 'PAY_9_5'` and tax 0, reported value-only (existing GSTR-1 path).
6. **Tax-inclusive plans:** the line amount is reverse-solved so the printed total equals the agreed tariff (± 1 paisa
   rounding shown).

**Files.** New: `src/lib/hotel/{checkout,checkout-save}.ts`, `src/components/hotel/CheckoutDialog.tsx`.

**Storage.** Invoices only (existing table). Folio status / invoice ids. `RECORD_KEYS` gain `folio_id`,
`reservation_id`, `stay`, `hotel_band`.

**Bundle.** ≈ 3 kB gz.

**Tests.** `tests/hotel-checkout.test.ts`:
- ₹7,500.00 → 5%; ₹7,500.01 → 18%;
- an extra bed pushes ₹7,000 + ₹800 over the threshold → 18%;
- CP meal inside the value; a discount brings ₹8,000 to ₹7,200 → 5%;
- mixed band → `hotel_band: 'mixed'`;
- out-of-state company GSTIN → CGST + SGST and `place_of_supply` = property state;
- foreign guest → intra;
- advance applied as a payment with `advance_id`;
- interim then final with no double billing;
- the 22 Sep 2025 boundary: stay 20–23 Sep invoiced 23 Sep → 5% + the chip;
- a document dated 2025-09-21 → 12%;
- all-or-none save on a period-lock refusal.

#### R7-B4 Company and travel-agent billing (city ledger)

*Seen in:* city ledger and TA commission report (H4); Cloudbeds AR transfer (H2).

**User story.** Acme Pvt Ltd sends its engineers every month. Their room and breakfast are billed to Acme on credit at
the corporate rate, Acme deducts TDS, and I see what Acme owes in Receivables.

**Acceptance criteria.**
1. **Bill-to** on the reservation: `guest | company | agent`, with the client and its routing default (room + meal
   plan to the company).
2. Company / agent invoices are ordinary credit invoices: due days from the client's terms. Ageing, statements,
   follow-ups and the TDS register work unchanged.
3. **TDS default** per client (hotel pack field on the client, declared in `hotel-r7.ts`): `none | 194I-B | 194C`
   (default `none`, §7 D11). The invoice carries `tds_section` / rate from the existing table, so the 26AS reconciler
   works. Labels go through `ita2025.ts`.
4. **Travel-agent commission.** On an agent booking with `commission_pct`, check-out shows the commission due. "Record
   commission" creates a purchase bill draft for the agent:
   - SAC 998552 (reservation services), GST per the agent's registration;
   - **194H** from the existing TDS-payable path;
   - ITC eligibility follows C1 (blocked for a fully low-band hotel, §7 D12).
5. **City ledger view** (Reports, C3) = Receivables filtered to company / agent invoices of the hotel. No new ledger.

**Files.** New: `src/lib/hotel/{bill-to,agent-commission}.ts`, `src/components/hotel/BillToPanel.tsx`.

**Storage.** Additive `Client.hotel?: { tds_default?, commission_pct?, rate_plan_id? }` (merging in `hotel-r7.ts`).

**Bundle.** ≈ 1.5 kB gz.

**Tests.** `tests/hotel-bill-to.test.ts`:
- routing default for a company;
- the invoice carries TDS 194I-B at 10% from the table;
- the agent commission bill carries 194H, and ITC is flagged ineligible when the hotel is fully low-band;
- ITA 2025 label after 1 Apr 2026.

#### R7-B5 OTA bookings and payouts

*Seen in:* Djubo / eZee channel bookings (H4, H5); R5-A settlements; GST F10.

**User story.**
- A Booking.com guest prepaid the OTA. Two weeks later the OTA pays me the net after commission, TCS and TDS. I enter
  the payout once and every booking it covers shows paid.
- My cousin's unregistered homestay sells on Airbnb, and the operator pays the GST.

**Acceptance criteria.**
1. **OTA source** on a reservation:
   - OTA name and operator GSTIN (`checkEcoGstin`, existing);
   - booking ref; collect model `ota_collect | hotel_collect`;
   - gross booking value as per the OTA.
2. **Tagging at check-out** (B3):
   - Hotel registered (sender profile has a GSTIN) → `eco_gstin` + `eco_section: 'TCS_52'`, normal tax (Table 14(a)
     path, existing).
   - Hotel **not** registered → the document is issued with `eco_section: 'PAY_9_5'`, tax 0, value-only (Table
     14(b) / 3B 3.1.1(ii) for a registered supplier, nothing for an unregistered one), with the note "GST payable by
     the e-commerce operator u/s 9(5)".
   - A voluntarily registered hotel below the threshold is treated as registered (§7 D8).
3. **Payout entry** (Folios → OTA payouts):
   - Inputs: OTA, payout date, bank, the bookings covered (picked from OTA-collect check-outs not yet paid), and per
     booking: commission (+ GST on it), TCS, 194-O.
   - Posting:
     - one receipt per invoice for its net share;
     - the **commission bill** as a purchase draft (vendor = the OTA, SAC 998552, ITC per C1);
     - TCS as an `eco_credits` row (kind `tcs`) and 194-O as a TDS-receivable row, through the R5-A5 lib
       (`marketplace/tcs-credit.ts`, lazy import — readable even when the marketplace pack is off).
   - The rows follow the existing helper-account names ("GST TCS receivable"; TDS receivable).
   - Difference ≠ 0 → refused with the gap shown.
4. A **commission and TCS summary per OTA per month** in Reports (C3).

**Files.** New: `src/lib/hotel/{ota,ota-payout}.ts`, `src/components/hotel/OtaPayoutDialog.tsx`.

**Storage.** OTA fields on `hotel_reservations`. Payout effects are ordinary receipts, purchase drafts and
`eco_credits` rows. No new table.

**Bundle.** ≈ 2 kB gz. **Cut first in B** (if over budget: payout is recorded as one receipt per booking, with a
commission-bill draft and no `eco_credits` rows).

**Tests.** `tests/hotel-ota.test.ts`:
- registered → TCS_52 and taxed; unregistered → PAY_9_5 and zero tax (value in Table 14(b) when registered);
- a payout of 3 bookings nets to zero;
- the TCS row is visible to `tcs-credit.ts`;
- 194-O at 0.1% from 1 Oct 2024 (existing rows);
- `tests/purchase-contract.test.ts` gains `ota-payout.ts` and `agent-commission.ts` (they write purchases).

#### R7-B6 Cancellation and no-show charges

*Seen in:* Opera / Cloudbeds policies; Circular 178/10/2022 (S5).

**User story.** A guest cancels a day before arrival and the policy says one night's charge. I keep that from the
advance and refund the rest with the right receipts.

**Acceptance criteria.**
1. **Policy on the rate plan:**
   - `free_until_hours` before check-in time;
   - charge `none | first_night | pct | full`, with `pct`;
   - no-show charge `first_night | full | none`.
2. **Cancel** (A3) or **no-show** (A6) computes the charge from the booking's snapshot and the policy. The user may
   waive or edit it, with a reason.
3. If the charge is > 0, a **cancellation invoice** is built through B3 (kind `cancellation` / `no_show`): the band
   and rate are those of the replaced unit-night value (F8, §7 D13).
4. The advance is applied to that invoice. The remainder is refunded with the existing refund voucher (`RFV`, Rule
   51), which reverses the advance's GST on the refunded part (existing G4 rule).
5. A company-guaranteed booking with no advance → the invoice goes to the company on credit.

**Files.** New: `src/lib/hotel/cancellation.ts`.

**Storage.** `cancellation?: { on, charge, waived?, reason?, invoice_id?, refund_id? }` on the reservation.

**Bundle.** ≈ 1 kB gz.

**Tests.** `tests/hotel-cancellation.test.ts`:
- inside / outside the free window; first-night / pct / full;
- a ₹8,000 night → an 18% cancellation invoice; a ₹3,000 night → 5%;
- advance applied, then the refund voucher for the rest;
- waive with a reason → no invoice.

### R7-C — Hotel compliance and reports

#### R7-C1 Hotel GST desk and the rule file

*Seen in:* GST law F1–F5, F11; R5-C2 common credit.

**User story.** As the owner (and my CA), I want to see which band each room-night fell in, whether this year's
restaurant must charge 18% or 5%, when the opt-in / opt-out window is open, and how much ITC I may keep.

**Rules** (`src/lib/hotel/hotel-rules.ts`; landed by A1, appended only by C):

```ts
export interface AccommodationBand { upTo: number | null; rate: number; itc: boolean; exempt?: boolean }
export interface AccommodationRule { bands: AccommodationBand[]; basis: 'declared_tariff' | 'value_of_supply' }
export const ACCOMMODATION_RATE_RULES: readonly Versioned<AccommodationRule>[] = [
  { from: '2017-07-01', value: { basis: 'declared_tariff', bands: [
      { upTo: 999.99, rate: 0, itc: false, exempt: true }, { upTo: 2499.99, rate: 12, itc: true },
      { upTo: 7499.99, rate: 18, itc: true }, { upTo: null, rate: 28, itc: true }] },
    source: 'N 11/2017 & 12/2017-CT(R) (bands as understood) — verify' },
  { from: '2019-10-01', value: { basis: 'value_of_supply', bands: [
      { upTo: 1000, rate: 0, itc: false, exempt: true }, { upTo: 7500, rate: 12, itc: true }, { upTo: null, rate: 18, itc: true }] },
    source: 'N 20/2019-CT(R) — verify' },
  { from: '2022-07-18', value: { basis: 'value_of_supply', bands: [
      { upTo: 7500, rate: 12, itc: true }, { upTo: null, rate: 18, itc: true }] },
    source: 'N 03/2022 & 04/2022-CT(R) — verify' },
  { from: '2025-09-22', value: { basis: 'value_of_supply', bands: [
      { upTo: 7500, rate: 5, itc: false }, { upTo: null, rate: 18, itc: true }] },
    source: 'N 15/2025-CT(R) Sl 7(i) (17 Sep 2025, w.e.f. 22 Sep 2025); PIB FAQ 56th Council Q71 — verify' },
];
export interface RestaurantRule { specified: { rate: number; itc: boolean }; other: { rate: number; itc: boolean } }
export const HOTEL_RESTAURANT_RATE_RULES: readonly Versioned<RestaurantRule>[] = [
  { from: '2017-11-15', value: { specified: { rate: 18, itc: true }, other: { rate: 5, itc: false } },
    source: 'N 46/2017-CT(R) (declared tariff ≥ ₹7,500) — verify' },
  { from: '2025-04-01', value: { specified: { rate: 18, itc: true }, other: { rate: 5, itc: false } },
    source: 'N 05/2025-CT(R) cl. (xxxvi) (value of supply, previous FY) — verify' },
];
export interface PremisesRule { threshold: number; window: { fromMonth: 1; fromDay: 1; toMonth: 3; toDay: 31 }; newRegDays: 15; testPreviousFy: boolean }
export const SPECIFIED_PREMISES_RULES: readonly Versioned<PremisesRule | null>[] = [
  { from: '2017-07-01', value: null, source: 'declared-tariff test (no declarations) — verify' },
  { from: '2025-04-01', value: { threshold: 7500, window: { fromMonth: 1, fromDay: 1, toMonth: 3, toDay: 31 }, newRegDays: 15, testPreviousFy: true },
    source: 'N 05/2025-CT(R) cl. (xxxvi), Annexures VII–IX — verify' },
];
export const FORM_C_HOURS_RULES: readonly Versioned<{ hours: number; penalty?: number; law: string }>[] = [
  { from: '1946-01-01', value: { hours: 24, law: 'Foreigners Act 1946; Registration of Foreigners Rules 1992 (Form C)' }, source: 'as understood — verify' },
  { from: '2025-09-01', value: { hours: 24, penalty: 50000, law: 'Immigration and Foreigners Act 2025 s.8; Rules 2025 r.17' }, source: 'Govt of Goa DIP release 10 Dec 2025 — verify' },
];
```

**Acceptance criteria.**
1. **Functions (pure):**
   - `accommodationBand(value, date)` → `{ rate, itc, exempt, band: 'low' | 'high' }`. Inclusive at `upTo`: ₹7,500.00
     is low (§7 D1).
   - `bandForInclusive(gross, date)` reverse-solves a tax-inclusive night.
   - `premisesStatus(fy, ctx)` → `{ specified: boolean, basis: 'previous_fy_value' | 'opt_in' | 'new_reg_opt_in' |
     'none', evidence }`. `ctx` holds the previous FY's highest unit-night value (from hotel invoices' `stay` / folio
     lines, or a typed figure for the year before the app) and the declarations.
   - `restaurantRate(status, date)`.
2. **Specified-premises card** (GST → Hotel tab `hotel-gst`, pack-gated via `PACK_GST_TABS`). For the current and next
   FY it shows:
   - status, basis and evidence ("Room 301 at ₹8,200 on 14 Nov 2025 → specified for FY 2026-27");
   - the **declarations register** (Annexure VII / VIII / IX): FY, kind, filed on, reference, per premises.
   - A declaration filed outside the window is refused with the window shown.
   - An opt-out cannot undo clause (a) (§7 D4): the card says "specified by law for this FY".
3. **Band report.**
   - Room-nights and value per band per month, from check-out invoices' annexure / folio lines.
   - The 5% (no-ITC) turnover and the 18% turnover feed the **R5-C2 common-credit working** as the "exempt-like" and
     "taxable" turnovers (§7 D12).
   - `PACK_GST_TABS['common-credit']` gains `'hotel'`, and `PACK_TABS`' common-credit row gains `alsoPacks` `'hotel'`.
4. **Guards** (in the desk, and as a lazy check in the existing GST exceptions when the pack is on):
   - an invoice with SAC 996311 whose rate disagrees with its band;
   - a restaurant line (SAC 99633x) whose rate disagrees with `restaurantRate`;
   - an 18% hotel purchase ITC claimed while every room-night is low-band;
   - an inter-state (IGST) hotel invoice (F6).
5. **22 Sep 2025 note.** A one-time info row for a company whose books include that date: "Fully-5% hotels reverse
   the credit-ledger balance as on 22 Sep 2025 — verify with your CA" (S7, HT4). No automatic journal.

**Files.** New: `src/lib/hotel/{hotel-gst,premises,band-report}.ts`, `src/components/hotel/HotelGstTab.tsx`.
Edit (shared, §6):
- `src/lib/gst-tabs.ts` (tab id `hotel-gst` in Tools; `PACK_GST_TABS` entries);
- `src/lib/palette/tab-index.ts` (`GST_TAB_ROWS.tools`);
- `src/i18n/areas/discover-r6-tabs.ts` (title, en + hi), `src/lib/palette/synonyms.ts` (`'specified premises',
  '7500', 'hotel gst'`);
- `src/pages/GstReports.tsx` (one lazy render line).

**Storage.** Declarations in `hotel_settings.premises`. Optional typed `prev_fy_max_value` per FY.

**Bundle.** ≈ 2.5 kB gz (rule file ≈ 0.6 kB, loaded by A / B too).

**Tests.** `tests/hotel-gst.test.ts`:
- each `ACCOMMODATION_RATE_RULES` row at its boundaries (999.99 / 1000 / 1000.01 / 7500 / 7500.01, per date);
- `bandForInclusive` round-trip;
- `premisesStatus`: previous-FY value 7,500.01 → specified; 7,500.00 → not; opt-in in window → specified next FY;
  outside the window → refused; opt-out with clause (a) true → still specified;
- `restaurantRate` per status and date;
- the common-credit inputs;
- guards fire;
- `tests/palette-tabs.test.ts` and `tests/help-registry.test.ts` pass with the new tab.

#### R7-C2 Form C desk and hotel alerts

*Seen in:* P6 (24-hour duty, ₹50,000 per case, boi.gov.in).

**User story.** As the manager, a red bell tells me a foreign guest's Form C is due in 5 hours. The desk shows every
field I must type on the portal, ready to copy. I paste the reference number back, and the bell clears.

**Acceptance criteria.**
1. **Form C desk** (Guests → Form C): foreign guests by status `due | overdue | filed | departed_not_updated`.
2. **Data sheet** per guest, in the portal's order as understood: personal, passport, visa, arrival, address in India,
   stay. Each field has a copy button, and there is a "Copy all" text block. A note says: "File on the Bureau of
   Immigration site (boi.gov.in) — this app does not upload."
3. "Mark filed" records the time and the reference. "Check-out updated" is a second tick after departure.
4. **Bell gate** `ensureHotelAlerts` (lazy, returns before import when the pack is off):
   - Form C due within 6 h / overdue;
   - arrivals today not checked in after check-in time + 4 h;
   - due-outs past check-out time;
   - night audit not run for the previous business date;
   - the specified-premises declaration window open (1 Jan – 31 Mar), once a year;
   - interim invoice due (B3).
5. A 24-hour countdown chip on the Board view for each pending foreign guest.

**Files.** New: `src/lib/hotel/{form-c,hotel-alerts}.ts`, `src/components/hotel/FormCView.tsx`.
Edit: `src/components/command/NotificationBell.tsx` (one gate, §6).

**Storage.** `form_c` on the reservation room line (A4).

**Bundle.** ≈ 1.5 kB gz. First paint ≤ +0.05 kB (the gate).

**Tests.** `tests/hotel-form-c.test.ts`:
- due = arrival + 24 h from the rule;
- an Indian guest → no row;
- overdue → bell row;
- filed clears it;
- the declaration-window alert only in Jan – Mar;
- the gate does not import when the pack is off.

#### R7-C3 Hotel reports

*Seen in:* night-audit outputs, city ledger, guest high balance (H6); eZee reports (H4).

**User story.** At month end I want occupancy, ADR and RevPAR by day and by room type, where my bookings came from, and
who owes me, without exporting to Excel.

**Acceptance criteria.** One Reports view on the front desk (`view=reports`). Each report is a table with CSV / XLSX
export (existing writers):
1. **Occupancy:** per day and per room type, for a period: available, occupied, complimentary, OOO, occupancy %, ADR,
   RevPAR. Built from night audits (A6), or from stays for days without an audit. An inline bar uses CSS width, not a
   chart library.
2. **Source mix:** room-nights and revenue by source (walk-in / direct / company / agent / each OTA).
3. **Revenue by kind:** room, F&B, laundry … per month, from check-out invoices.
4. **Guest ledger:** open folios with their balances (high-balance flag above a settings amount).
5. **Advance-deposit ledger:** open advances linked to reservations.
6. **City ledger:** receivables of company / agent clients (a filter over `receivables.ts`).
7. **OTA summary:** per OTA per month, with commission, GST on commission, TCS, 194-O and net payout (B5).
8. **Police / guest register:** the A4 register with a date range, printable.

**Files.** New: `src/lib/hotel/hotel-reports.ts`, `src/components/hotel/ReportsView.tsx`.

**Bundle.** ≈ 2 kB gz. **Cut first in C** (if over budget: items 1, 4 and 6 only).

**Tests.** `tests/hotel-reports.test.ts`:
- ADR / RevPAR / occupancy formulas (complimentary rooms count as occupied for occupancy but not for ADR, §7 D14);
- source mix totals equal the revenue totals;
- the guest ledger equals the sum of open folio balances;
- reading reports performs no writes.

---

## 5. Work packages

Three packages, each for one agent in its own worktree. Each file is owned by one package. The shared touchpoints
are append-only (§6).

**R7-A1 lands first** as its own small commit on the A branch, and is merged to the base before B and C branch off.
It brings:
- `PackId`, the business type and `PACK_TABS`;
- the rule file and the types file;
- the store, with every registry row;
- the `Tables.tsx` switch.

### R7-A — Front office (6 items)

Items:
- **A1** pack, type, shell, rule file, store, registries;
- **A2** room types / rooms / rate plans;
- **A3** reservations and calendar;
- **A4** check-in and guest register;
- **A5** housekeeping;
- **A6** night audit.

Owned files (new):
- `src/lib/hotel/{hotel-rules,hotel-store,business-date,rooms,rate-plans,pricing,reservations,availability,checkin,guests,housekeeping,night-audit,room-post}.ts`
- `src/components/hotel/{FrontDesk,BoardView,SetupView,RatePlanForm,CalendarView,ReservationForm,ReservationsView,CheckInDialog,GuestForm,GuestsView,HousekeepingView,NightAuditView}.tsx`
- `src/components/hotel/hotel.module.css`
- `src/types/hotel-r7.ts`
- `src/i18n/areas/hotel-frontdesk-r7.ts`
- `docs/features/hotel.md` (A writes the skeleton; B and C append their sections)
- tests `hotel-pack`, `hotel-pricing`, `hotel-reservations`, `hotel-checkin`, `hotel-night-audit`

Owned files (edit):
- `src/lib/industry-packs.ts`, `src/lib/shop-mode.ts` (union), `src/lib/shop-presets.ts`
- `src/pages/Tables.tsx`, `src/layouts/DashboardLayout.tsx` (label ternary), `src/i18n/en.ts` / `hi.ts` (one key)
- `ShopModePanel.tsx`, `SetupWizard.tsx` (only if they do not render from `PACK_IDS`)
- registries: `backup.ts`, `audit-edits.ts`, `access.ts`, `sync-engine.ts` — all hotel tables, in one commit (A1)
- `src/store/useInvoiceStore.ts` `RECORD_KEYS` / `normalizeRecord` (the four invoice keys B3 uses, in A1)

Icons (reuse): `Building2`, `CalendarRange`, `CalendarDays`, `KeyRound`, `Users`, `ClipboardList`, `Clock`, `Ban`.

Budget: first paint ≤ +0.2 kB gz; total JS ≤ +13 kB gz.

Cut first: A5 (status buttons on the Board only), then the calendar's phone 7-day layout (a list instead).

### R7-B — Folio and billing (6 items)

Items:
- **B1** folio windows / routing / split / transfer / void;
- **B2** charge to room (Tables, POS);
- **B3** check-out and interim invoices;
- **B4** company / agent billing, TDS default, agent commission;
- **B5** OTA bookings and payouts;
- **B6** cancellation / no-show.

Owned files (new):
- `src/lib/hotel/{folio,routing,charge-to-room,checkout,checkout-save,bill-to,agent-commission,ota,ota-payout,cancellation}.ts`
- `src/components/hotel/{FolioView,PostChargeDialog,RoomPicker,CheckoutDialog,BillToPanel,OtaPayoutDialog}.tsx`
- `src/i18n/areas/hotel-billing-r7.ts`
- tests `hotel-folio`, `hotel-charge-to-room`, `hotel-checkout`, `hotel-bill-to`, `hotel-ota`, `hotel-cancellation`

Owned files (edit):
- `src/components/restaurant/OrderPanel.tsx` (one gated button)
- `src/lib/restaurant/orders-store.ts` (`settleToFolio`)
- `src/pages/Pos.tsx` (one gated tender)
- `tests/purchase-contract.test.ts` (appends `ota-payout.ts`, `agent-commission.ts`)

Shared: `src/types/hotel-r7.ts` (its own `// R7-B` merging block: `TableOrder.folio_id`, `Client.hotel`).

Icons (reuse): `ReceiptText`, `Receipt`, `Split`, `ArrowLeftRight`, `Wallet`, `HandCoins`, `Percent`, `XCircle`.

Budget: first paint ≤ +0.05 kB gz (none expected: B's invoice keys are added by A1); total JS ≤ +11 kB gz.

Cut first: B5 reduced (see B5), then B4's commission bill (a note with the amount only).

### R7-C — Hotel compliance and reports (3 items)

Items:
- **C1** GST desk (bands, specified premises, declarations, band report, guards, common-credit input);
- **C2** Form C desk and the bell gate;
- **C3** reports.

C also owns the round's **help topics, Ctrl+K rows and e2e steps** for all three packages:
- B and A send their view lists;
- the topics are written against this PRD's view names, so C can start in parallel.

Owned files (new):
- `src/lib/hotel/{hotel-gst,premises,band-report,form-c,hotel-alerts,hotel-reports}.ts`
- `src/components/hotel/{HotelGstTab,FormCView,ReportsView}.tsx`
- `src/i18n/areas/hotel-compliance-r7.ts`
- tests `hotel-gst`, `hotel-form-c`, `hotel-reports`

Owned files (edit):
- `src/lib/gst-tabs.ts`, `src/pages/GstReports.tsx` (one lazy line)
- `src/lib/palette/tab-index.ts`, `src/lib/palette/synonyms.ts`, `src/i18n/areas/discover-r6-tabs.ts`
- `src/lib/help/topics-packs.ts` (all hotel topics)
- `src/components/command/NotificationBell.tsx` (one gate)
- `tests/e2e/smoke.mjs` (one hotel step)
- `src/lib/hotel/hotel-rules.ts` (appends after A1)

Icons (reuse): `ShieldCheck`, `Globe`, `BarChart3`, `FileText`, `Landmark`.

Budget: first paint ≤ +0.05 kB gz (bell gate); total JS ≤ +6 kB gz.

Cut first: C3 reduced (see C3).

**Combined:** ≤ +0.3 kB gz first paint (≤ 184.5 of 185 kB) and ≤ +30 kB gz total JS (≤ 2563.9 of 2600 kB). Each package
runs `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run check:size`, and records the numbers
in `docs/features/hotel.md`. The release that ships the round adds a `WHATS_NEW` entry and bumps `package.json`
together (lead; `scripts/check-whats-new.mjs`).

---

## 6. Shared-file protocol

Merge order: **R7-A1 (alone) → R7-A → R7-B → R7-C.** Each later package rebases and resolves append-only conflicts
mechanically (keep both sides). Round 8 edits the same registries. Whichever round merges second rebases; no file
here is rewritten.

| File | Who | Rule |
|---|---|---|
| `src/types/invoice.ts`, `purchases.ts`, `restaurant.ts`, `client` types | none | Not edited. Fields come by declaration merging in `src/types/hotel-r7.ts`: A1 block (`InvoiceRecord.folio_id` / `reservation_id` / `stay` / `hotel_band`; settings `hotel_settings` shape), `// R7-B` block (`TableOrder.folio_id`, `Client.hotel`), `// R7-C` block (none expected). |
| `src/lib/industry-packs.ts` | A | A1: `'hotel'` in `PackId` / `PACK_IDS` / `PACK_OF_TYPE`; one appended `// R7: hotel` block in `PACK_TABS` for all views: `/tables?tab=frontdesk` and `&view=` `calendar`, `reservations`, `folios`, `housekeeping`, `audit`, `guests`, `formc`, `reports`, `setup`. C1 adds `'hotel'` to the common-credit row's `alsoPacks` (one-token edit). |
| `src/lib/shop-mode.ts` / `shop-presets.ts` | A | Union + the `hotel` rows. `PATH_MODULE` and functions not edited. |
| `src/pages/Tables.tsx` | A | The tab switch and the front-desk link only. |
| `src/components/restaurant/OrderPanel.tsx`, `src/lib/restaurant/orders-store.ts`, `src/pages/Pos.tsx` | B | One gated button / function / tender each. |
| `src/layouts/DashboardLayout.tsx`, `src/i18n/en.ts`, `hi.ts` | A | One label ternary; one `nav.frontDesk` key each. |
| `src/store/useInvoiceStore.ts` `RECORD_KEYS` / `normalizeRecord` | A | One line with a `// R7` comment: `folio_id`, `reservation_id`, `stay`, `hotel_band`. |
| `src/lib/backup.ts` `RECORD_TABLES` / `ID_TABLES` | A | One `// Round 7 (hotel)` line: `hotel_room_types`, `hotel_rooms`, `hotel_rate_plans`, `hotel_reservations`, `hotel_folios`, `hotel_guests`, `hotel_night_audits`; object `hotel_settings`. |
| `src/lib/audit-edits.ts` `WATCHED_TABLES` | A | The same seven tables (one block). |
| `src/lib/access.ts` `TABLE_ACTIONS` | A | Room types / rooms / rate plans → `master.edit`; reservations / folios / guests / night audits → `doc.create`; `hotel_settings` → `settings.manage`. |
| `src/lib/sync-engine.ts` `DATED` / `NUMBERED` | A | DATED: `hotel_reservations` (`arrival`), `hotel_folios` (`opened_on`), `hotel_night_audits` (`business_date`). NUMBERED: `hotel_reservations` → `RES`. `hotel_settings` is an object key and syncs like `restaurant_settings` (last writer wins); check in A1 that object keys need no registry row, and add one if they do. |
| `src/lib/series-counters.ts` | none | `RES` is a new series id, used through the existing API; no edit unless the series list is closed. If it is closed, A1 appends `'RES'`. |
| `src/lib/gst-tabs.ts` | C | Tab id `hotel-gst` (Tools group); `PACK_GST_TABS['hotel-gst'] = ['hotel']`; `'hotel'` appended to `PACK_GST_TABS['common-credit']`. |
| `src/lib/palette/tab-index.ts`, `synonyms.ts`, `src/i18n/areas/discover-r6-tabs.ts` | C | `hotel-gst` in `GST_TAB_ROWS.tools`; title (en / hi); synonyms. |
| `src/lib/help/topics-packs.ts` | C | One appended `// R7 hotel` block: `tables:frontdesk` and one topic per view, plus `gst-reports:hotel-gst`. Each topic lists its HT ids. |
| `src/components/command/NotificationBell.tsx` | C | One `ensureHotelAlerts` gate after the R5 gates. Pack check inline (settings read, `'hotel'` in `industry_packs` or `business_type === 'hotel'`), before the import. |
| `src/lib/hotel/hotel-rules.ts` | A (creates), C (appends) | Rows exactly as §4 C1. Later CA answers are new dated rows. |
| `tests/purchase-contract.test.ts` | B | Appends `ota-payout.ts`, `agent-commission.ts`. |
| `tests/e2e/smoke.mjs` | C | One step (below), after the R5 steps. |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md`, `src/lib/whats-new.ts`, `package.json` | lead | Round 7 rows, storage keys, the pack rule and the version are added by the lead after merging. |

Every package must pass the five commands on its own branch, and again after rebasing on the previous package. No new
runtime dependency. No new lucide icon name.

### New storage summary

| Key / table | Pkg | Kind | Backed up | Synced | Guard |
|---|---|---|---|---|---|
| `industry_packs` value `'hotel'`, `business_type` `'hotel'` on `mrchartist_inv_settings` | A | settings values | yes | yes | `settings.manage` |
| `mrchartist_inv_hotel_settings` | A | object | yes | yes (singleton) | `settings.manage` |
| `mrchartist_inv_hotel_room_types` | A | rows | yes | yes | `master.edit` |
| `mrchartist_inv_hotel_rooms` | A | rows (incl. housekeeping fields) | yes | yes | `master.edit`; status changes `doc.create` |
| `mrchartist_inv_hotel_rate_plans` | A | rows | yes | yes | `master.edit` |
| `mrchartist_inv_hotel_reservations` | A / B | rows (DATED `arrival`, NUMBERED `RES/FY…`) | yes | yes | `doc.create` |
| `mrchartist_inv_hotel_folios` | B | rows (DATED `opened_on`) | yes | yes | `doc.create` |
| `mrchartist_inv_hotel_guests` | A | rows (personal data; vault mode advised) | yes | yes | `doc.create` |
| `mrchartist_inv_hotel_night_audits` | A | rows (DATED `business_date`) | yes | yes | `doc.create` |

- **Additive fields:**
  - `InvoiceRecord.folio_id`, `reservation_id`, `stay` and `hotel_band` (in `RECORD_KEYS` and `normalizeRecord`);
  - `TableOrder.folio_id`;
  - `Client.hotel`.
- **New numbered series:** `RES`.
- **No new device-local key.** Hotel invoices, advances, refunds, receipts, purchase drafts and `eco_credits` rows go
  into the existing tables.

### e2e step (C, after the R5 steps)

`R7: hotel pack on → set a room type, 2 rooms and an EP plan → walk-in check-in a foreign guest (Form C due shows) →
post laundry → restaurant table 1 "Charge to room" → night audit posts 1 night → check out → one invoice with a room line
at 5% (₹3,000), F&B at 5% (not specified premises), CGST + SGST, the annexure page, folio invoiced, room dirty`.
- A second sub-step sets the rate to ₹8,000: the invoice line is 18%.
- A third types a previous-FY value of ₹7,600 and sees the GST → Hotel card say "specified" and the F&B rate 18%.

---

## 7. Decisions (defaults the build follows)

The owner asked for no open questions. Each point below states the **default the build follows**. Statutory defaults
are working-paper readings, each tied to a CA item in `docs/CA_REVIEW.md` §7. A CA answer that differs becomes a new
dated row in `hotel-rules.ts` (or a settings switch), never an edit of old data.

| # | Question | Default the build follows | CA item |
|---|---|---|---|
| D1 | Is exactly ₹7,500 a night in the low band? | **Yes.** "Less than or equal to ₹7,500" → 5%; ₹7,500.01 and above → 18%. The test uses the value before GST. | HT1 |
| D2 | What is in the "value of supply per unit per day"? | Room + extra bed + extra person + meal-plan component (when the plan is sold at one price), **after** the night's share of discounts, **before** GST. À-la-carte F&B, laundry, minibar and transport are separate supplies. "Unit" = a room. A dormitory bed sold separately = a unit (setting on the room type). An hourly / day-use booking = one day. | HT2, HT6, HT14 |
| D3 | Room and F&B SAC | 996311 (room accommodation) and 996331 (restaurant service), editable in hotel settings. | HT2 |
| D4 | Can an opt-out (Annexure IX) override clause (a)? | **No.** Previous-FY value above ₹7,500 makes the premises specified by law. Opt-out only cancels an earlier opt-in. A new registrant may opt in within 15 days of the ARN. | HT3 |
| D5 | MAP / AP / CP meals: composite or separate? | **Composite** with accommodation (one invoice line per room × rate × band at the accommodation rate); the meal component is shown in the annexure for information. A plan marked "meals priced separately" makes them `fnb` lines at the restaurant rate instead. | HT6 |
| D6 | A stay that spans a rate change (e.g. 22 Sep 2025) | Sec 14 reading: all nights at the rate in force on the **invoice date**, unless an advance with GST was received earlier for those nights (the advance keeps its rate). A chip flags affected nights; the user may split by hand. | HT11 |
| D7 | When is the invoice issued for long stays and at year end? | At check-out; plus an **interim invoice every 30 days** of stay (Rule 47 window) and on 31 Mar for in-house guests (default on, can be turned off in hotel settings). | HT11 |
| D8 | OTA booking by a hotel registered voluntarily below the threshold | Treated as **registered**: the hotel pays GST, and the OTA collects TCS u/s 52. Sec 9(5) (OTA pays) applies only when the sender profile has **no GSTIN**. | HT7 |
| D9 | Guest ID data | Store masked Aadhaar by default. Passport / visa details are kept for foreign guests (Form C needs them). The ID image is optional and off by default. Vault mode is recommended in a banner. Nothing is uploaded. | HT13 |
| D10 | Restaurant credit to a non-staying company | A "house" folio with the company as payer, billed monthly or on demand through B3 at the restaurant rate. | — |
| D11 | TDS by corporate guests | Per client: `none` (default) / `194I-B` / `194C`, chosen by the user. The help text quotes Circular 5/2002 ("regular basis" = rent). The app never guesses. ITA 2025 labels from 1 Apr 2026 come through `ita2025.ts`. | HT12 |
| D12 | ITC for a hotel with both bands | The 5%-no-ITC turnover is treated as **exempt-like** in the R5-C2 Rule 42 / 43 working (reverse its share of common credit). Credit used only for 18% rooms is kept, and credit used only for 5% rooms is blocked. Agent / OTA commission ITC follows the same split. A fully low-band hotel sees "ITC not available" on hotel purchases (a warning; the user decides). | HT4, HT8 |
| D13 | Rate for cancellation / no-show charges | The band and rate of the **unit-night value the charge replaces** (first night for "first night"; each night for "full"). For "pct", the rate is the band of the booked night value, not of the charge amount. | HT9 |
| D14 | Complimentary and house-use rooms | Not a supply (no consideration): not invoiced, excluded from the band report and ADR, counted as occupied for occupancy % and shown separately. | HT17 |
| D15 | Form C timing and law | 24 hours from check-in (`FORM_C_HOURS_RULES`). The check-out update is tracked as a second tick. The penalty is shown as "up to ₹50,000 per case (as reported) — verify". | HT13 |
| D16 | e-Invoice for hotel B2B bills | The existing AATO rule applies. Hotels are not exempt, so the post-save sheet offers the IRN JSON for B2B invoices above the threshold. | HT15 |
| D17 | Composition hotels | A hotel on the Sec 10(2A) 6% scheme uses the existing composition logic: Bill of Supply, no band. The GST desk shows "composition — bands not applied". | HT16 |
| D18 | Several properties | One company per GSTIN (6.20). A second property in the same state is a branch sender profile, and its rooms carry `property_id` = the profile id. Specified-premises status is **per premises** (per profile). | HT3 |
| D19 | Where the front desk lives | `/tables?tab=frontdesk` (no new route). The sidebar label is "Front desk" for hotel companies. | — |
| D20 | Budget | ≤ +30 kB gz total and ≤ +0.3 kB first paint for the round. A package over its share drops its "cut first" items; no raise is requested. | — |
