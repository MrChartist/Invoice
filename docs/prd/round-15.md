# PRD — Round 15: travel, tour and event businesses (tour operators, travel and ticketing agents, inbound DMCs, event and wedding planners), plus a size-recovery and cross-cutting package

Status: draft for build · Drafted 2026-10-27 · Baseline: branch `claude/elegant-cannon-cwapiv` at `ca0438f`. Merged on
the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–16, Round 7 (hotel), Round 8 (trading), Round 9 (retail), Round 10
(services), Round 11 (construction), Round 12 (agriculture), Round 13 (manufacturing) and Round 14 (professional firms).
No other round is being built in parallel.

Companion documents:
- `docs/CA_REVIEW.md` §15: the travel and cross-cutting CA items **TV1–TV31** (§9 of this PRD). The lead copies them
  there when the PRD is accepted. `TV` is a new prefix. The prefixes already used are `A B C D G H I M P Q R S T X AC AG
  CN HT MF PS QA RT SV TR`.
- Sources: §2.8 of this PRD. Each entry gives the URL and the claim taken from it. **P** = primary text read this
  round, **S** = secondary source (press, blog, review site), **V** = vendor's own claim.

Every item follows `AGENTS.md`:
- **Local-first and serverless.** No IATA BSPlink, GDS (Amadeus / Sabre / Galileo), airline, consolidator, hotel
  bed-bank, OTA, RBI / AD-bank, TRACES, income-tax, GST, IRP or e-Way calls. The app uses files the user picks,
  `wa.me` / `mailto:` links and the device only.
- **Styling.** Vanilla CSS Modules with tokens. Templates use the `accent` variable only (Critical Rule 5).
- **Invoice snapshots never change.** Everything a travel invoice prints is snapshotted on the document (`tv`).
- **Numbering.** Indian-FY numbering for any series. Round 15 adds no series.
- **Dates.** Bare dates are parsed as local days.
- **Statutory values.** They are date-keyed and append-only, and live in a rule file kept out of first paint. Every
  row carries `verified`. **A row is `verified: true` only when its value was read in a primary text this round.**
  This is stricter than R14, which also accepted two agreeing secondary sources.
- **Outputs are working papers.** GST, TCS, TDS and place-of-supply outputs carry "verify with your CA" (Critical
  Rule 10).

---

## 1. Problem statement

### 1.1 Which vertical is left

Fourteen rounds have covered most Indian SME segments in depth (§2.2 has the candidate table). The candidates the lead
listed are already largely served:

| Candidate | What the app already has | Left over | Verdict |
|---|---|---|---|
| Logistics / courier / freight forwarders | R5-B consignment notes (LR), GTA options, vehicles, trips, freight / FX (`freight-fx.md`), e-Way | Ocean / air freight forwarder's house-bill margin, Sec 13(9) POS | Partial overlap. Later round |
| Education institutes / coaching | R5-C fee plans and runs, R10 `coaching` kind (`sv-coaching-refund.ts`, classes / batches), exempt column | Little | Covered |
| Pharmacy chains vs hospitals (IPD) | R9 pharmacy pack, R4-B store chains, R10 clinic desk with IPD admissions / rooms / payer claims | Little | Covered |
| Automobile dealers / service | R9 electronics serial desk (VIN / engine no. reuse), R9 `used` godown + margin scheme (Rule 32(5)), R10 workshop job cards with vehicle assets, 206C(1F) motor-vehicle TCS (`trading-rules.ts`), GST 2.0 rows | OEM incentive credit notes, RTO / insurance pass-through, demo vehicles, the stuck compensation-cess credit | Mostly covered. Smaller gain |
| **Travel / tour operators / event agents** | Pure-agent plumbing (`trade/pure-agent.ts`, R14 `ps-disb`), hotel rules (R7), currency master, TCS register / 27EQ (`tds-payables.ts`), LUT, R14 export check | **Everything specific:** trip file, tour-operator 5 % vs 18 % regimes, air-ticket valuation (Rule 32(3)), BSP / consolidator statements, cancellations, commission income, **TCS on overseas packages (2 % flat from 1 Apr 2026)**, event budgets, POS for events | **Chosen** |
| Printing / packaging job work | R13 `press` pack (printing), R13 job cards, `job-work.ts`, ITC-04 | Little | Covered |
| IT / SaaS subscription billing | Recurring (`recurring.ts`), deferrals (R2-C2), R14 `svcexport` (exports, EDF, platforms) | Proration, usage metering, MRR | Partial. Later round |
| Co-operative societies | NPO / fees / leases (R5-C), Sec 80P not modelled | Housing-society maintenance (₹7,500 / member exemption), member billing | Distinct vertical. Candidate for Round 16 |

**Travel, tour and event businesses** are the largest group with nothing specific in the app today. They are also
where 2026 changed the rules for invoices:
- **Finance Act 2026** cut TCS on overseas tour packages from 5 % / 20 % to a **flat 2 % with no threshold**, from
  1 Apr 2026 (Sec 394(1) Table Sl. No. 8). The Finance Bill clause 73 and the Memorandum were read (P).
- **GST 2.0 (22 Sep 2025)** changed the air-fare and hotel rates that travel invoices pass through.

In India this work is done today in Tally plus spreadsheets or in a separate online back office (§2.1). An offline
app with real books, GSTR-1 and 27EQ has a clear edge here.

### 1.2 What travel businesses cannot do in the app today

Checked against the code at `ca0438f` (§2.6):

1. **No trip / event file.** A booking spans flights, hotels, transfers, visa, insurance and sightseeing from five
   suppliers for one client and one set of passengers. There is no file to hold it, no cost-vs-sell sheet, and no
   margin per trip.
2. **No GST regime choice for tours.** A tour operator either charges 5 % on the gross package **without ITC** (N
   11/2017-CT(R) Sl. 23 item (ii), as reported) or charges 18 % with ITC. An agent bills only a service fee and passes
   the rest through as pure agent. The editor has no notion of these regimes:
   - nothing prints the 5 % declaration;
   - nothing stops ITC being claimed on a 5 % trip's hotel bill;
   - an agent's pass-through fares are typed as 0 % lines and reported **nil-rated** unless the R8 / R14 pure-agent
     sentinel is used by hand.
3. **Air tickets.** Rule 32(3) lets an air travel agent value the booking service at **5 % of the basic fare
   (domestic) / 10 % (international)**, as reported. There is no ticket line (ticket no., PNR, sector, basic fare,
   taxes / YQ) and no deemed-value calculation.
4. **Supplier statements.** Airline tickets are settled through IATA BSP (fortnightly) or a consolidator, and hotels
   through bed-banks. Statements arrive as CSV / XLSX. Nothing imports or matches them against bookings or bills, so
   ADMs / ACMs and missed refunds go unnoticed.
5. **Cancellations and refunds.** A cancellation has a supplier charge, the agency's own fee (GST at the principal
   supply's rate per Circular 178/10/2022, as reported), a refund due from the supplier and a refund owed to the
   client. Only the hotel module (R7 `hotel/cancellation.ts`) handles cancellations, and only for its own rooms.
6. **Commission income.** Airline PLB, hotel and insurer commissions are invoices **to the principal**. 194H TDS
   (2 % from 1 Oct 2024, already in `tax-rules.ts`) is expected on them. For insurance agents the insurer pays GST
   under reverse charge (N 13/2017-CT(R) entry, as reported). None of this is set up for the trade.
7. **TCS on overseas tour packages.** `TCS_PRESET_RULES` (first paint) offers only the LRS remittance preset at 20 %.
   - Nothing computes the seller's TCS on an overseas package: 5 % (Oct 2020); 5 % / 20 % above ₹7 lakh (Oct 2023);
     ₹10 lakh threshold (Apr 2025); **2 % flat (Apr 2026)**.
   - `ita2025.ts` labels **every** 206C(1G) collection "Sec 394(1) Table Sl. No. 7". The Memorandum (P) puts LRS at
     Sl. No. 7 and **tour packages at Sl. No. 8**, so the app's 2025-Act label for tour packages is wrong (TV3).
   - ROADMAP 23d (Finance Act 2026 TCS rates) is still open.
8. **Outbound vs inbound.** Nothing tells the user that:
   - an inbound tour for a foreign tourist performed in India is not an export;
   - a tour operator's service to a foreign tourist for a tour **wholly outside India** is exempt (entry to confirm,
     TV10);
   - an Indian client's outbound package carries TCS.
9. **Events.** An event or wedding planner works to a client budget with dozens of vendors (venue, decor, catering,
   artists, AV, manpower). There is no budget-vs-actual sheet. Nothing applies the Sec 12(7) IGST place-of-supply
   rule for organising events, as recalled. Nothing hints that artists' fees, event contracts and (from 1 Apr 2026)
   **supply of manpower** fall under the contractor TDS limb.

### 1.3 Cross-cutting gaps every user feels

The leaders' 2025–26 releases and our own measurements give four cross-cutting items. One of them frees the bundle
headroom that every later round needs.

1. **The bundle is at its limits.** First paint is **184.8 / 185 kB** and total JS **3,425.6 / 3,500 kB**. Measured
   this round on `ca0438f`: 997 JS chunks with **7,234 cross-chunk import statements**. Each lazy chunk re-imports
   10 small first-paint modules (storage, dates, gstin, invoice-calc, tax-rules, validators …) one by one.
   - **Fix:** merging the first-paint app modules into **one chunk** with rolldown's `codeSplitting` groups (a
     `$initial` tag group).
   - **Measured result:** total **−43.4 kB** and first paint **−2.3 kB** (§2.7).
   - **Checks on that build:** all **587** production e2e checks passed, the offline / service-worker checks passed,
     and `check:size` was green.
   - This pays for Round 15 and leaves headroom for Round 16.
2. **Save is slow on big companies (PERF-3, open since perf round 4).** A save on a 15k-invoice company still does
   ≈ 13 audit-log rewrites of ≈ 2 MB each. Coalescing the appends of one save into one write removes most of that
   wait. The file is on first paint, so the change is capped at +0.1 kB.
3. **Netting of a party who is both customer and supplier.** Zoho Books shipped it in Oct 2026 (V). Tally does it by
   nature, because a party is one ledger. Traders, manufacturers, travel agents (consolidators, hotels, other
   agents), farmers (R12 already does it for cycles) and contractors all have parties on both sides.
   - Today a user writes a journal by hand, and the bills on both sides stay "open".
   - The existing no-cash marker `exchange_purchase_id` already posts a receipt as "Dr Sundry creditors (party) / Cr
     Debtors" (R9 buy-back, R12 farmer set-off). A guided netting dialog can reuse it with **no new marker**.
4. **2026 statutory housekeeping that touches every payer.** From the Finance Bill 2026 (P):
   - **supply of manpower** becomes "work" under Sec 402(47), so contractor TDS (Sec 393(1) Table Sl. 6(i),
     1 % / 2 %) applies from 1 Apr 2026 instead of the fees-for-technical-services limb;
   - the 206C(1G) tour-package label error noted above.

**Goal of Round 15:** ship **15 items in four work packages** with mostly disjoint files, inside a **net-negative**
size budget:
- **R15-A: size recovery and cross-cutting.** Initial-module chunk group, audit-append coalescing, party netting,
  2026 statutory housekeeping. 4 items, merged **first**.
- **R15-B: travel core.** Travel profile, trip / event files with bookings and costing, GST regimes for tours,
  travel paper. 4 items.
- **R15-C: air tickets and supplier settlement.** Ticket lines with Rule 32(3), BSP / consolidator / bed-bank
  statement import and match, cancellations / refunds / re-issues, commission income. 4 items.
- **R15-D: outbound, TCS and events.** TCS on overseas tour packages (seller), outbound / inbound place-of-supply and
  export check, event budgets and vendor TDS hints. 3 items.

### 1.4 How the travel profile switches on (no clutter for others)

- **No new `BusinessType`.** `shop-mode.ts` is first paint and stays untouched.
  - R10's service picker gets one more kind, **`travel`**: `SERVICE_KINDS` in `shop-presets.ts` (lazy) and the
    `ServiceKind` union in `types/services-r10.ts` (type only, zero bytes).
  - Under it, the additive settings field **`travel_kind`** (the R12 `agri_kind` … R14 `prof_kind` approach):

  | `travel_kind` | Who | Packs turned on | Lands on | Why |
  |---|---|---|---|---|
  | `tour_operator` | Holiday / pilgrimage / group-tour operator selling packages (domestic and outbound) | `travel` | `/time?tab=trips&view=trips` | Packages, 5 % / 18 % regimes, TCS on outbound |
  | `agent` | Travel / ticketing agent (IATA or via consolidator), hotel / visa / insurance booking | `travel` | `/time?tab=trips&view=bookings` | Service fee + pure agent, Rule 32(3), BSP / consolidator statements, commissions |
  | `inbound` | Inbound tour operator / DMC serving foreign tourists and foreign agents | `travel` | `/time?tab=trips&view=trips` | Foreign currency, export / POS check, exempt tours wholly outside India |
  | `events` | Event manager, wedding planner, MICE / conference organiser | `events` (+ `travel` when they also book travel) | `/time?tab=trips&view=events` | Budgets, vendors, Sec 12(7) POS, vendor TDS |
  | `other` | Any other travel / tourism service | `travel` | `/time?tab=trips` | Shared core only |

- **Two new packs** in `industry-packs.ts` (lazy module; `PackId` is a type, zero bytes): `travel` and `events`.
  `PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE` and `PACK_ROUTES` are unchanged.
- **Placement: one desk, never a new route or sidebar item.**
  - One new row in `TIME_TABS` (`page-tabs.ts`): `{ id: 'trips', pack: 'travel', alsoPacks: ['events'] }`.
  - The desk `components/travel/TripsDesk.tsx` is mounted lazily from `Time.tsx` by an `import.meta.glob` over
    `components/travel/*Desk.tsx` (the R14 pattern).
  - **Five views in total** across B–D, in `&view=`: `trips` (B), `bookings` (B, with C's ticket and cancellation
    actions), `statements` (C), `tcs` (D), `events` (D).
- Settings → Features shows a **"Travel profile"** row for every `services` company (and "Custom"). Turning a pack off
  deletes nothing.
- The **travel paper** (R15-B4) is not pack-gated. It prints whenever a document carries the `tv` snapshot.

### 1.5 Budgets the packages must respect

Measured by the PRD author on `ca0438f` (`vite build` + `scripts/check-bundle-size.mjs`, gzip -9, KiB):

| Budget | Now | Limit | Headroom | Round 15 share |
|---|---|---|---|---|
| Initial JS (first paint, gz) | **184.8 kB** | 185 kB | 0.2 kB | **net ≤ −2.0 kB** (A1 −2.3 measured; B's `tv` token ≈ +0.005; A2 ≤ +0.1) |
| Entry chunk (gz) | 71.2 kB | 90 kB | 18.8 kB | becomes **88.4 kB** after A1: the entry now holds all first-paint app code. A1 raises the entry budget to **100 kB** with a note; first paint stays the hard limit |
| Total JS (gz) | **3,425.6 kB** | 3,500 kB | 74.4 kB | **gross ≤ +39 kB** (A3 + A4 ≤ 5, B ≤ 14, C ≤ 11, D ≤ 9); **net ≤ −4 kB** after A1's −43.4 |

**Lesson from Round 14.** R14 planned 60 kB and measured **+128.4 kB** (3,295.9 → 3,424.3 kB; PS-A +43.5, PS-B
+27.3, PS-C +25.6, PS-D +32.7, per `docs/features/prof-r14.md`). That is 2.1 × the plan; R13 was 2.5 ×. The breakdowns
show where it went:
- strings EN + HI: 2.3–3.9 kB a desk;
- host-page wiring: 2–3.5 kB a package;
- engines per view: 1–2 kB each;
- help, palette, demo and rows: ≈ 1 kB each.

Round 15 is therefore planned at **one desk with five views** and **≈ 15 items**, and enforces **hard caps per
package with a pre-ranked cut list** (§3). It is not "plan and hope".

Rules, stricter than R14:
- **First paint.** A1 (−2.3 kB) merges before anything else.
  - The only other first-paint bytes are A2's coalescing (≤ +0.1 kB; `audit.ts` is reached from `localDb.ts`) and
    B's one record-key token `tv` (`R15_RECORD_KEYS = ['tv']` spread into `R9_RECORD_KEYS`; R12–R14 measured +4 to
    +15 B each).
  - No `PACK_ROUTES`, `PACK_OF_TYPE`, `TABLE_ACTIONS`, `WATCHED_TABLES`, `no-cash.ts`, `tax-rules.ts`, `shop-mode.ts`
    or shell edit.
- **Total.** The caps are A3 ≤ 4 kB, A4 ≤ 1 kB, B ≤ 14 kB, C ≤ 11 kB, D ≤ 9 kB (strings, help, palette and demo
  included).
  - A package that reaches its cap stops and drops items in the §3 cut order. It does not ask for more.
  - Each package measures after every commit (`npm run build && npm run check:size`) and writes the numbers in its
    section of `docs/features/travel-r15.md`.
- **One string area per package**, ≤ 1.2 kB gz each: `travel-r15b.ts`, `travel-r15c.ts`, `travel-r15d.ts`, plus
  `netting-r15a.ts` for A3. Words used by more than one package (trip, booking, supplier, passenger, sell, cost,
  margin, cancellation, refund, TCS) live **once** in `travel-r15b.ts` and are imported by C / D.
  - Hindi covers labels and buttons.
  - Help is **≤ 160 characters** per topic in each language, with statutory detail by CA id (`ca: ['TV4']`).
- **No new shared components, no stubs, no CSV / print extras** beyond those listed. Reuse:
  - lists, grids and controls: `LinesGrid`, `ItemFilterBar`, `controls.module.css`;
  - pure agent: `PURE_AGENT_CHARGE` / `charge_head_id: 'rule33'`;
  - FX: R14 `ps-fx-rates.ts`;
  - export check: R14 `ps-export-check.ts`;
  - imports: the import wizard's mapper (`import-mapping.ts`) and `xlsx.ts` (dynamic import);
  - credit notes: `documents.createCreditNote`;
  - purchase returns: `purchase-returns`;
  - TCS / 27EQ: `tds-payables.ts` (`tcsRowsLite`).
- **Rule data is a chunk.** Statutory values go in **`src/lib/travel-rules.ts`** (new). It is imported only by lazy
  travel screens and engines, never by `tax-rules.ts`, `shop-mode.ts` or the shell (`tests/tv-rules.test.ts` checks
  the import graph). Values that already live elsewhere stay there:
  - 194H and other TDS rates: `tax-rules.ts` / `tds-rules.ts`;
  - hotel tariff bands: `hotel/hotel-rules.ts`;
  - 2025-Act labels: `ita2025.ts`, which A4 appends to;
  - FEMA realisation: `trade/trade-rules.ts`.
- **Icons: reuse only** (grep before use; a new name fails review). Candidates already imported on the baseline:
  - `Globe` (outbound / inbound), `Building2` (hotels), `Receipt` (tickets), `FileText`, `Banknote` (commissions);
  - `Percent` (TCS), `Scale` (netting), `Calendar` (events), `Users` (passengers), `Search`, `ClipboardList`
    (bookings).
  - `Ticket`, `Plane`, `Luggage` and `PartyPopper` are **not** imported (grep on `ca0438f`). B re-greps before its
    first commit and substitutes `ClipboardList` for any icon not already imported.

### 1.6 Non-goals

These need a server, an industry system or a regulator, or are outside billing and books:
- **Live connections.** GDS / NDC booking, BSPlink or IATA ARC downloads, airline / consolidator / bed-bank APIs, OTA
  channel managers, live fares or FX, card / UPI payment collection, visa portals. The app reads files the user
  downloads.
- **Credentials.** IATA accreditation or bank-guarantee tracking beyond a reminder; GST portal, IRP, TRACES or Form
  143 (27EQ) upload. The app produces JSON / FVU-ready rows only where it already does.
- **Money-changing.** Full-fledged money changer (FFMC) business (Rule 32(2) forex valuation, RBI FFMC returns). A
  tour operator's own forex purchase is an ordinary purchase.
- **CRM and operations.** Lead CRM, itinerary builder with maps, vouchers sent to suppliers by e-mail automatically,
  passenger manifest / APIS, passport scanning (OCR).
- **Size changes deferred.** Moving Hindi strings out of every lazy chunk (≈ 440 kB gz of Devanagari literals, §2.7)
  is measured and reported but **not built** in Round 15. It changes what the offline precache holds for English users
  and needs the lead's decision (§8 Q4).
- **Other deferred work.** Row-level storage of the `invoices` table (the remaining 0.5 s stringify of PERF-3)
  touches the storage contract and is left for a perf round.

---

## 2. Findings

### 2.1 What the leaders shipped in 2025–26 (research)

Independent reviews of Indian SME software are thin. Most of what follows is the vendors' own release notes (V),
which is the right source for "what shipped".

| Product | What shipped / where it stands (2025–26) | Relevance to the app | Source |
|---|---|---|---|
| TallyPrime 7.0 (released **19 Dec 2025**), 7.2 | **7.0:** Auto Backup (scheduled, TallyDrive or local); PrimeBanking payments; **SmartFind** across loaded companies; cancel e-Way + e-Invoice + voucher together; GSTR-3B as one JSON / Excel; **IMS**: ITC reductions for amended invoices, per-invoice declared ITC, remarks; JSON data exchange; faster loading. **7.2:** purchase-order print templates, extended e-Invoicing sessions, GSTR-9 export, TDS / TCS filing updates | The app has auto / encrypted backups, Ctrl+K "All companies" search, `einvoice-cancel.ts`, IMS file with remarks (`ims-file.ts`), GSTR-9, open export. **No gap opened by 7.x** except banking (⛔ offline) | V help.tallysolutions.com release notes 7.0; V tallysolutions.com Darpan product update |
| Tally for travel | Pages for "travel agency billing", "tour packages GST", "profit or loss per trip" | Shows the demand. No BSP matching, no tour-package TCS working, as far as the pages show | V tallysolutions.com/billing-software/travel, /gst-software/tour-packages |
| Zoho Books (India) 2026 | **Mar:** TDS / TCS rates for the Income-tax Act 2025. **Apr:** IMS integration (online), "Reconcile e-Invoices" tab, TDS challan import, bulk write-off. **Jul:** terminal payments with dynamic QR (Paytm / PhonePe). **Oct:** HSN / SAC mandatory + type validation + code search, delivery-challan bulk import / filters, **netting of linked customer and vendor balances**, subtotal rows (non-India editions) | IMS online and terminal payments are ⛔ (network). HSN master / validation exists (`hsn-master.ts`). Delivery challans exist. **Netting is missing → A3** | V help.zoho.com product updates (Apr, Jul, Oct 2026); S outlookbusiness |
| Busy | Travel-agency accounting page (GST invoicing, e-Invoice, e-Way) | Generic; nothing travel-specific beyond SAC lists | V busy.in/accounting-software/travel |
| Vyapar | "Travel agency accounting software" page (automatic GST on travel services) | Generic | V vyaparapp.in travel page |
| myBillBook / Khatabook | Comparisons rank Vyapar deeper on invoicing, Khatabook cheaper / more languages, myBillBook rated highest by aggregators. No travel features | Our Hindi, offline and statutory depth already exceed them | S techjockey, getapp / softwareadvice (aggregators) |
| Marg ERP | Not re-researched this round (pharma / distribution focus; covered in R8 / R9) | — | — |
| QuickBooks | Intuit stopped QuickBooks for India (sign-ups closed Jul 2022; shutdown announced for 31 Jan 2023, reported extended to 30 Apr 2023) | Not a competitor in India; QuickBooks-style netting / bank rules already mirrored | V Intuit community; S thepaypers, inc42, profitbooks |
| Travel back-office tools (global / Indian) | BSP / ARC reconciliation, agent credit, supplier payments; CSV out to Tally | **BSP / consolidator matching is a separate product category.** Indian job listings ask for "Tally + BSP + GST on tour-operator margins + TCS" by hand | V phptravels.com; V peakflo.co; S talentmate job listing (2026) |

**What carries over to an offline app:**
- **A trip file as the unit of truth.** Client, passengers, components, suppliers, cost vs sell and regime, on top of
  the existing cost centre (the R14 matter precedent).
- **Statement matching.** BSP / consolidator / bed-bank files imported and matched to bookings and bills, so ADMs,
  ACMs, missed refunds and commission short-payments surface.
- **Statutory papers the CA asks for:** 5 % regime with the ITC block, Rule 32(3), pure-agent exclusion in GSTR-1,
  TCS on outbound packages in 27EQ / Form 143, cancellation GST, 194H receivable.

Offline work, Hindi, real books (GSTR-1 / 3B, 27EQ, Tally export), the recycle bin and full audit are our edge.

### 2.2 Candidate verticals scored

Value 1–5 (5 = a large SME segment that meets the gap every day, with nothing in the app). Effort S = 1, M = 2, L = 3.

| Candidate | Size of segment (as reported) | Already in the app | Value | Effort | Score |
|---|---|---|---|---|---|
| **Travel, tour & events** | Many small agencies, operators and planners; no reliable count found (TV31) | Plumbing only (pure agent, hotel rules, TCS register) | **5** | M | **2.5** |
| Co-operative / housing societies | Very many housing societies; distinct statute (state co-op Acts, 80P) | NPO pieces | 4 | L | 1.3 |
| Automobile dealers | Large dealer networks (FADA) | Serial, used-goods, workshop, 206C(1F), GST 2.0 | 3 | M | 1.5 |
| Freight forwarders | Many | R5-B, freight-fx | 3 | M | 1.5 |
| SaaS subscription billing | Growing | Recurring, deferrals, svcexport | 2 | M | 1.0 |
| Education / coaching, hospitals IPD, printing | — | R5-C / R10 / R13 | 1 | — | — |

### 2.3 Anatomy of a travel / event business's documents (every element needs a place)

"Doc" is where the element must print. "Today" is the baseline. Items close each row.

| # | Element | Who | Doc | Today | → |
|---|---|---|---|---|---|
| 1 | Trip / event file code, destination, travel dates, lead passenger and passenger count | all | invoice header, statement | cost-centre name on a line | B2, B4 |
| 2 | Regime declaration: "Tour operator service — GST 5 % on the gross amount; no ITC taken (N 11/2017-CT(R) Sl. 23(ii))" or "Service charge — GST 18 %; air fare / hotel / visa fee recovered as pure agent (Rule 33)" | operators, agents | invoice | — | B3, B4 |
| 3 | Package price incl. accommodation and transport stated as the gross amount | operators (5 % regime) | invoice | free text | B3 |
| 4 | Air ticket rows: passenger, airline, ticket no., PNR, sector, class, basic fare, taxes / YQ / YR, airline GST | agents | invoice, annexure | typed lines | C1 |
| 5 | Agency service fee, and the deemed value for GST (5 % / 10 % of basic fare) | air agents | invoice | — | C1 |
| 6 | Pure-agent components shown separately (visa fee, embassy fee, insurance premium, airport tax) | agents, operators (18 % regime) | invoice | 0 % lines reported nil-rated unless the sentinel is used | B3, C1 |
| 7 | TCS on overseas tour package: rate, base, PAN, Sec 394(1) Sl. 8 label | outbound sellers | invoice footer, 27EQ / Form 143 | LRS preset only, wrong Sl. no. label | D1, A4 |
| 8 | Cancellation: supplier charge, agency fee + GST, refund to client | all | credit note / cancellation invoice | hotel module only | C3 |
| 9 | Supplier statement match (BSP / consolidator / bed-bank) and ADM / ACM | agents | register | — | C2 |
| 10 | Commission invoice to airline / hotel / insurer, expected 194H TDS | agents | invoice to principal, TDS register | generic | C4 |
| 11 | Foreign-currency package for a foreign agent / tourist, exchange rate, POS / export note | inbound DMCs | invoice | currency + LUT exist; no travel POS note | D2 |
| 12 | Event budget vs actual, vendor list, client advances | event planners | budget sheet, invoice | — | D3 |
| 13 | Event POS: "Place of supply — location of the registered recipient / where the event is held (Sec 12(7) IGST)" | event planners | invoice | generic POS | D3 |
| 14 | Netting statement: receivable and payable of one party set off | every business with two-sided parties | journal, both ledgers | manual journal, bills stay open | A3 |

### 2.4 Statutory rules (as understood; every row is a CA item)

**Confidence:** H = statute / official text read or long settled; M = consistent secondary sources or recalled text;
L = sources conflict or nothing found.

**`verified`:** `true` only when the value was read in a primary text this round (the Finance Bill 2026 text and the
Memorandum were read; nothing else primary was reachable: the CBIC tax-information site and the GSTN advisory host
returned 503, and the budget-speech PDF was refused). Every row is also a CA item (§9).

| Rule | What applies | App today | Source | Confidence / `verified` |
|---|---|---|---|---|
| TCS — overseas tour package, 2026 | Income-tax Act 2025 **Sec 394(1) Table Sl. No. 8**: from **1 Apr 2026**, **2 %** on sale of an "overseas tour programme package" (incl. travel / hotel stay / boarding / lodging / related expenditure), **no threshold** (clauses (a) / (b) both replaced by 2 %); collected by the seller. The Memorandum gives the reason: "shifting of business from domestic tour operators to overseas tour operators". Finance Act 2026 (No. 4 of 2026) received assent on 30 Mar 2026 (as reported); the Lok Sabha passed it with 32 amendments, so the enacted clause was not read | Not modelled; `TCS_PRESET_RULES` has LRS 20 % only; ROADMAP 23d open | **P** Finance Bill 2026 cl. 73(f) and Memorandum (indiabudget.gov.in, read); S taxmann, livelaw, freepressjournal (enacted), businesstoday, outlookmoney, patronaccounting, tdsman | H / `verified: false` (Bill read, Act not) → **TV1 ★** |
| TCS — overseas tour package, before 2026 | 206C(1G)(b): **5 %** from 1 Oct 2020 (no threshold; Finance Act 2020); from **1 Oct 2023**: 5 % up to ₹7 lakh per buyer per FY, **20 %** above; from **1 Apr 2025**: threshold **₹10 lakh** (Finance Act 2025) | — | S KPMG flash alert 2023, cleartax, taxheal, taxguru, tdsman (agree); Memorandum 2026 states the 5 % / 20 % / ₹10 lakh "current" structure (P, as the current law at the time) | H / `verified: false` for 2020 / 2023 rows; the 2025 row's figures are restated in the Memorandum (P) → TV2 |
| TCS label, 2025 Act | LRS is **Sl. No. 7**; tour package **Sl. No. 8** (Memorandum ¶6, ¶8; Bill cl. 73(e), (f)) | `ita2025.ts` maps all 206C(1G) to "Sl. No. 7" | **P** Bill / Memorandum | H / `verified: true` (numbering in the Bill as introduced) → **TV3 ★** |
| TCS — what counts as a package | A package offering a visit abroad that includes travel **and** hotel / boarding / lodging or similar; a stand-alone international air ticket or a stand-alone hotel booking is not a package (CBDT clarification, as reported) | — | S traveltradejournal, taxheal, tdsman | M / `verified: false` → TV4 |
| TCS — non-resident buyer, PAN absent | No TCS when the buyer is a non-resident not in India (CBDT notification, as reported, Jun 2022); without PAN the higher rate applies (206CC: twice the rate or 5 %, whichever is higher; 10 % for 1G at its introduction — as reported); 2025-Act counterpart of 206CC not checked | — | S taxscan (non-resident), taxheal; Finance Act 2020 proposal (as reported) | M / `verified: false` → TV5 |
| TCS — base | TCS on the amount received from the buyer; whether GST charged on the package is included is not settled in the sources found (the CBDT circular on 206C(1H) excluded GST only for 1H, as recalled) | `tcs_base` field exists on invoices | Recalled | L / `verified: false` → TV6 (default: on the invoice total incl. GST, user may switch to taxable value) |
| TCS — collection code (27EQ / Form 143) | Code for tour packages to confirm; the app's existing 1G LRS mapping `6CQ` in `tds-rules.ts` also to re-check | `tds-rules.ts` `{ match: /1G/, code: '6CQ' }` | — | L / `verified: false` → TV7 |
| Tour operator — 5 % regime | N 11/2017-CT(R) Sl. 23 item (ii) (heading 9985): tour operator services at **2.5 % + 2.5 %**, **condition: no ITC** on goods / services used, **except ITC of input tour-operator services** from another tour operator (as amended, as reported); invoice to state that the charge is the **gross amount including accommodation and transportation** (as reported). Continues after N 15/2025-CT(R) (17 Sep 2025, from 22 Sep 2025) per most sources; one source reads the structure as revised | — | S busy.in (SAC 998555), taxclue, razorpay, taxaj, bajajfinserv; P not reachable (CBIC site 503) | M / `verified: false` → **TV8 ★** |
| Tour operator — definition | "Tour operator": a person engaged in planning, scheduling, organising, arranging tours (may include accommodation, sightseeing or similar) by any mode of transport, incl. a tour-operator service (Explanation to N 11/2017-CT(R), recalled) | — | Recalled | M / `verified: false` → TV8 |
| Tour operator — 18 % option | Without the Sl. 23(ii) condition, tour-operator / travel-arrangement services fall at 18 % with ITC (residual entry of heading 9985, as reported). Sources describe 5 % and 18 % as alternatives chosen per supply; whether one operator may use both for different packages is not settled | — | S taxclue, bajajfinserv, busy.in | M / `verified: false` → TV9 |
| Exempt — foreign tourist, tour wholly outside India | Services by a tour operator to a foreign tourist in relation to a tour conducted **wholly outside India** exempt (entry in N 12/2017-CT(R) / N 9/2017-IT(R); entry number given as "54A" by one source, to confirm) | Exempt column exists (`sv.exempt` R10) | S busy.in; recalled | M / `verified: false` → TV10 |
| Air travel agent — Rule 32(3) | Value of air-ticket booking service by an air travel agent, **at the agent's option**: **5 % of the basic fare (domestic)**, **10 % (international)**; "basic fare" = the part of the fare on which commission is normally paid by the airline; else the actual value (service fee + commission). GST at **18 %** on the value (SAC 998551, as reported) | — | S gstzen, caclub, teachoo, studycafe, fintaxblog, taxaj (agree) | H (rule) / `verified: false` → **TV11 ★** |
| Air passenger transport (passed through) | Economy **5 %** (no ITC); **other than economy 18 %** (with ITC) from **22 Sep 2025** (12 % before); rate by date of booking / payment per sources (cut-over details differ) | Generic rate table (GST 2.0 rows in `tax-rules.ts`) | S angelone, busy.in, axis bank, bajajfinserv, theweek (IATA) | H (rates) / `verified: false` → TV12 |
| Hotel accommodation (passed through / in a package) | ≤ ₹7,500 per unit per day **5 % without ITC** from 22 Sep 2025; above **18 %** | `hotel/hotel-rules.ts` (R7) | S taxguru (and R7 sources) | H / existing rows, unchanged → TV13 (cross-ref HT items) |
| Pure agent (Rule 33) | Visa / embassy fees, insurance premium, airport taxes recovered at actual are outside value only when **all** Rule 33 conditions hold (the R14 PS3 test) | `isPureAgentLine`, R14 `ps-disb` guard | R14 sources (P CBIC Rule 33 page heading, S) | H / reuse → TV14 (cross-ref PS3) |
| Cancellation charges | Circular **178/10/2022-GST** (3 Aug 2022): cancellation charges for hotel / air / rail bookings are consideration for the same supply (tolerating a contract change) and **taxed at the rate of the principal supply**; genuine compensation for breach differs | `hotel/cancellation.ts` (rooms only) | S RSM (circular summary), taxo.online, advocategandhi, getswipe; P not read | M / `verified: false` → **TV15 ★** |
| Commission from airlines / hotels | Agent's commission / incentive (PLB) from an airline or hotel is the agent's own taxable supply at 18 % to that principal; **194H** TDS expected (2 % from 1 Oct 2024; 2025 Act Sec 393 table — label via `ita2025.ts`) | 194H in `tax-rules.ts` / `tds-rules.ts` | Existing rows (T items) | H / reuse → TV16 |
| Insurance agent commission | Services by an insurance agent to an insurance company: **reverse charge** (insurer pays; N 13/2017-CT(R), as recalled). An agent who makes only RCM supplies need not register (Sec 23(2), recalled, the R14 PS2 point) | `rcm.ts` outward RCM | Recalled | M / `verified: false` → TV17 |
| POS — tour operator | No special rule for tour operators found: default Sec 12(2) IGST (registered recipient → its location; else address on record / supplier's location). Hotel / accommodation components: Sec 12(3) (location of the property; property outside India → recipient's location, as recalled). Passenger transport: Sec 12(9) | Generic POS | Recalled | M / `verified: false` → TV18 |
| POS — inbound tours for foreign tourists | Services requiring the physical presence of the recipient performed in India → POS India (Sec 13(3)(b), as recalled): not an export even when paid in foreign currency | R14 `ps-export-check.ts` (generic) | Recalled | M / `verified: false` → TV19 |
| Foreign DMC bills to an Indian operator | Services performed wholly outside India by a non-resident to an Indian operator: no import RCM where the POS is outside India (Sec 13, as recalled; to confirm per component) | Import-of-services RCM on bills (`rcm.ts`) | Recalled | L / `verified: false` → TV20 |
| POS — organising events | Sec 12(7)(a) IGST: services of **organising** a cultural, artistic, sporting, scientific, educational or entertainment event (incl. conference, fair, exhibition, celebration): to a **registered** person → that person's location; to an **unregistered** person → where the event is held (if in India), else the recipient's location (as recalled; one source reads "organising" as outside 12(7) and under 12(2)) | Generic POS | Recalled; S search summary disagreeing | M / `verified: false` → **TV21 ★** |
| Event management rate | Event management / organisation services at 18 % (SAC 998596, as reported) | Generic | S (SAC lists) | M / `verified: false` → TV22 |
| TDS on event payments | Event contracts, catering, decor, sound / light: contractor limb (194C → Sec 393(1) Table Sl. 6(i), 1 % individual / HUF, 2 % others); artists / anchors: professional fees limb (194J → Sl. 6(iii), 10 %); **supply of manpower = "work" from 1 Apr 2026** (Sec 402(47) amended), i.e. Sl. 6(i) | 194C / 194J rows exist | **P** Memorandum ("Application of TDS on supply of manpower", cl. 78) for manpower; rest recalled / existing rows | H (manpower: Bill read) / `verified: false` (Act not read) → **TV23 ★** |
| e-Invoice | Mandatory above **₹5 crore** AATO (since 1 Aug 2023); for AATO **≥ ₹10 crore**, IRP rejects documents older than **30 days** (from 1 Apr 2025, GSTN advisory 5 Nov 2024); no 2026 change found | `einvoice*.ts` (existing late-IRN warning, `late-fee-irn-demo.md`) | S taxmann, tallysolutions, gstgyaan; P GSTN advisory PDF on mahagst.gov.in not reachable (503) | H / existing → TV24 (no module change) |
| IMS / GSTR-3B | Liability in 3B auto-populated from GSTR-1 and hard-locked (advisory Oct 2024); ITC lock deferred; GSTR-1A to correct Table 3.2; IMS offline tool advisory 23 Apr 2026 (as reported) | `ims-file.ts`, `gstr2b.ts`, GSTR-1A follow-up open (8.66) | S cleartax, EY, vjmglobal, GST Council newsletter Apr 2026 | M / no module change → TV25 |

### 2.5 What changed in 2025–2026 for these businesses (and what the app holds today)

| Change | Date | App today | Round 15 |
|---|---|---|---|
| TCS on overseas tour packages **2 % flat, no threshold** (Sec 394(1) Sl. 8) | 1 Apr 2026 | Not modelled | D1: dated rows in `travel-rules.ts`; sets the invoice TCS fields (TV1) |
| Tour-package label Sl. 8 vs LRS Sl. 7 | 1 Apr 2026 | All 1G → Sl. 7 | A4: one appended mapping row in `ita2025.ts` (TV3) |
| Supply of manpower = "work" (contractor TDS) | 1 Apr 2026 | 194C / 194J by the user's pick | A4: one dated hint row in `tds-rules.ts` labels (TV23) |
| TCS on liquor / scrap / minerals 2 %, tendu 2 % | 1 Apr 2026 | ✅ already in `trading-rules.ts` (R8 / R13) | — |
| GST 2.0: economy air 5 %, other classes 18 %; hotel ≤ ₹7,500 5 % no ITC | 22 Sep 2025 | Rate tables (generic + R7) | B3 / C1 read them; no new rate rows |
| Tour operator 5 % no-ITC entry kept under N 15/2025-CT(R) (as reported) | 22 Sep 2025 | — | B3 (TV8) |
| 194H 2 % | 1 Oct 2024 | ✅ `tax-rules.ts` | C4 reuses |
| e-Invoice 30-day limit at AATO ≥ ₹10 crore | 1 Apr 2025 | ✅ existing warning | — |

### 2.6 Verified against the code (`ca0438f`)

Verdicts: **Exists** (done; file given), **Partial** (part done; gap named), **Missing**. Each row was checked by
reading the file named or by grep. The greps (`tour`, `travel`, `PNR`, `ticket_no`, `BSP`, `basic fare`, `Rule 32(3)`,
`overseas tour`, `netting`) found zero hits in billing code. `travel` appears only in payroll exemptions.

| Area | Verdict | Where | → |
|---|---|---|---|
| Pure-agent line recognised by GSTR-1 / e-Invoice / e-Way | Exists | `trade/pure-agent.ts` (`PURE_AGENT_CHARGE`, `isPureAgentLine`), R14 `prof/ps-disb.ts` + guard | B3, C1 reuse |
| Hotel tariff bands, 5 % / 18 %, cancellation | Exists (own rooms) | `hotel/hotel-rules.ts`, `hotel/cancellation.ts`, `hotel/agent-commission.ts` (the hotel's side of a travel agent's commission) | B3 reads rates; C3 is the agent's side |
| TCS on invoices | Exists (fields) | `InvoiceRecord.tcs_enabled / tcs_rate / tcs_base / tcs_label / tcs_amount` (`types/invoice.ts`); presets from `tax-rules.ts` `TCS_PRESET_RULES` (first paint) | D1 writes the fields from a lazy rule; **no edit to `tax-rules.ts`** |
| TCS register / 27EQ / Form 143 | Exists | `tds-payables.ts` (`tcsRowsLite`, challans), `ita2025.ts` labels | D1 rows flow in; A4 fixes the label |
| 206C(1G) 2025-Act label | **Wrong for tour packages** | `ita2025.ts` `'206C1G' → 'Sec 394(1) [Table: Sl. No. 7]'` | A4 (TV3) |
| Exempt / nil / non-GST column | Exists | R10 `sv.exempt` (`types/services-r10.ts`) | B3 (exempt foreign-tourist tours) |
| Export / POS checker for services | Exists (generic) | R14 `prof/ps-export-check.ts`, `ps-pos.ts` | D2 adds travel rules as inputs |
| Currency master and FX rows | Exists | 8H currency master, `fx.ts`, R14 `ps-fx-rates.ts` | B2 / D2 |
| Cost centres as projects / matters | Exists | 6.16 cost centres, R14 `CostCentre.ps` | B2 (`CostCentre.tv`) |
| Import wizard and runs | Exists | `import-mapping.ts` (`ImportKind`), `import-openings.ts`, table `import_runs` (R6-C3) | C2 writes an `import_runs` row per statement |
| No-cash receipt marker for party set-off | Exists | `exchange_purchase_id` (R9 `rt-buyback.ts`, R12 `ag-cycle-post.ts`); posting Dr Sundry creditors (party) / Cr Debtors in `ledger/postings.ts`; `movedNoCash` in `no-cash.ts` | A3 reuses; **no new marker** |
| Netting (customer ↔ supplier) | **Missing** | grep `netting`, `set off against supplier`: none | A3 |
| Audit appends per save | **Partial** | `audit.ts` writes the audit table per record (`setTable(AUDIT_TABLE, …)`), ≈ 13 × 2 MB per save on the perf-round-4 dataset (`docs/prd/perf-round-4.md`, PERF-3) | A2 |
| Code splitting | **Partial** | `vite.config.ts` `manualChunks` for `vendor-react` / `vendor-ui` only; 10 first-paint app modules ship as separate chunks that every lazy chunk imports | A1 |
| Service picker | Exists | `components/services-r10/ServiceKindPicker.tsx`, `shop-presets.ts` `SERVICE_KINDS` / `applyServiceKind`, R14 `applyProfKind` pattern | B1 |

### 2.7 Size measurements (this round, `ca0438f`)

Production build with the repo's `vite build`. Gzip level 9 over `dist/assets/*.js`, the method of
`scripts/check-bundle-size.mjs`.

| Build | Chunks | Total JS gz | Initial gz | Entry gz | Cross-chunk `import{…}from` statements | Raw JS |
|---|---|---|---|---|---|---|
| Baseline (`manualChunks`) | 997 | **3,425.6 kB** | **184.8 kB** | 71.2 kB | 7,234 (391 kB raw) | 10,096 kB |
| **A1: `codeSplitting.groups` with an `app-initial` group (`tags: ['$initial']`)** | 988 | **3,382.2 kB (−43.4)** | **182.5 kB (−2.3)** | 88.4 kB | 5,768 (337 kB raw) | 9,987 kB |
| Rejected: one group per `src/components/<folder>` (with the `$initial` group) | 663 | 3,607.9 kB (+182) | 188.4 kB | — | — | — |
| Rejected: the same without the `$initial` group | 699 | 3,902.5 kB | 1,513.5 kB (pulls lazy code into first paint) | — | — | — |
| Rejected: a "tiny modules" group (≤ 1.5 kB / ≤ 4 kB modules) | 841 / 763 | 3,566.1 / 3,608.5 kB | 187.0 / 187.9 kB | — | — | — |
| Rejected: `app-initial` with `maxSize: 150000` (split into 5) | 993 | 3,410.5 kB | 187.5 kB (over) | — | — | — |

**The A1 build was checked end to end.** The author built it with the same plugins minus the CSP-meta plugin (headers
are served by the harness) and ran `gen-precache.mjs` on it. Then:
- `tests/e2e/smoke.mjs`: **587 checks passed**, 0 CSP violations, 0 page errors;
- `scripts/verify-offline.mjs`: **all offline checks passed** (precache, broken-deploy rejection, quota-safe runtime
  cache);
- `check-bundle-size.mjs`: initial 182.5 / 185, entry 88.4 / 90, total 3,382.2 / 3,500, all OK.

The experiment config was removed from the tree. A1 re-does the change properly in `vite.config.ts` (§4).

Other numbers for the lead:
- **Small chunks.** 327 chunks are under 1 kB gz (173 kB in all). Concatenated they would gzip to 108 kB, but the
  rejected rows show that naive grouping costs more through duplication than it saves. Only the first-paint group pays.
- **Hindi in every chunk.** 183 chunks contain Devanagari. The Devanagari string literals total ≈ 1,519 kB raw and
  ≈ 440 kB gz when compressed alone, ≈ 13 % of the precache. They ship inside each lazy chunk, beside the English
  strings (`defineArea(en, hi)`), so English users download them too. Splitting them out would not lower "total JS"
  unless the precache stops installing Hindi chunks for English users. That is a product decision (§8 Q4), not
  part of Round 15.

### 2.8 Sources

P = primary; S = secondary; V = vendor. Accessed 27 Oct 2026.

Statute, Budget and regulators:
- **P** Finance Bill 2026 (as introduced), clause 73 amending Sec 394(1) Table — Sl. No. 1, 2, 4, 5 → 2 %;
  Sl. No. 7(a) (LRS education / medical) 5 % → 2 %; **Sl. No. 8 (a) and (b) → 2 %**; clause 75 (Sec 397 from 1 Oct
  2026) — https://www.indiabudget.gov.in/doc/Finance_Bill.pdf
- **P** Memorandum explaining the Finance Bill 2026 — "Rationalisation of TCS rates" (¶6 LRS Sl. 7, ¶8 tour package
  Sl. 8, table, effective 1 Apr 2026, clause 73); "Application of TDS on supply of manpower" (Sec 393(1) Sl. 6(i) /
  6(ii) / 6(iii), Sec 402(47), clause 78, effective 1 Apr 2026) — https://www.indiabudget.gov.in/doc/memo.pdf
- S Finance Act 2026 enacted (No. 4 of 2026, 30 Mar 2026) — https://www.taxmann.com/post/blog/finance-act-receives-assent-of-the-president/ ;
  https://www.livelawbiz.com/top-stories/union-budget-central-govt-notifies-finance-act-528353 ;
  https://www.freepressjournal.in/business/government-notifies-finance-act-2026-implements-key-tax-changes-from-april
- S TCS 2 % on tour packages (Budget 2026) — https://www.businesstoday.in/amp/personal-finance/tax/story/budget-2026-fm-sitharaman-proposes-major-tcs-changes-on-overseas-tour-packages-education-medical-purposes-513917-2026-02-01 ;
  https://www.outlookmoney.com/tax/budget-2026-big-relief-for-overseas-travel-education-as-budget-cuts-tcs-sharply ;
  https://www.patronaccounting.com/blog/tcs-rate-changes-april-2026-overseas-travel-lrs-education-liquor ;
  https://blog.tdsman.com/2026/05/tcs-on-foreign-remittances-and-overseas-tour-packages-section-3941-206c1g/ ;
  https://travtalkindia.com/otoai-ey-engagement-delivers-tcs-relief-for-indias-outbound-travel-trade/
- S TCS on tour packages 2020–2025 (5 %; 5 % / 20 % above ₹7 lakh from Oct 2023; ₹10 lakh from Apr 2025) —
  https://assets.kpmg.com/content/dam/kpmg/xx/pdf/2023/09/fa23-172.pdf ; https://cleartax.in/s/tcs-on-overseas-tour-package ;
  https://www.taxheal.com/?p=100778 ; https://taxguru.in/?p=1002080 ; https://blog.tdsman.com/2025/07/section-206c1g-tcs-on-foreign-remittances-and-tour-packages/
- S Package definition / non-resident buyers — https://traveltradejournal.com/understanding-tcs-on-overseas-tour-packages/ ;
  https://www.taxscan.in/?p=200886 ; https://www.taxheal.com/no-tcs-on-sale-of-overseas-tour-package-to-non-resident-individuals-by-domestic-tour-operator.html
- S Tour operator 5 % / 18 %, SAC 998555, N 15/2025-CT(R) (17 Sep 2025, from 22 Sep 2025) — https://busy.in/sac-code-998555/ ;
  https://taxclue.in/guide/gst-on-tour-package ; https://razorpay.com/learn/gst-on-tours-and-travels/ ;
  https://www.taxaj.com/learn/?p=496 ; https://www.bajajfinserv.in/gst-on-tour-operator ; https://www.taxheal.com/15-2025-central-tax-rate.html
  (preamble only; CBIC PDF https://taxinformation.cbic.gov.in/view-pdf/1010453/ENG/Notifications returned 503) ;
  https://www.ey.com/content/dam/ey-unified-site/ey-com/en-in/alerts-hub/2025/09/gst-council-announces-major-rate-rationalization-and-trade-facilitation-measures.pdf
- S Rule 32(3) — https://gstzen.in/a/determination-of-value-in-respect-of-certain-supplies-cgst-rule-32.html ;
  https://www.caclub.in/rule-32-of-cgst-rules-2017-determination-of-value-in-respect-of-certain-supplies ;
  https://studycafe.in/rule-32-cgst-rules-determination-value-respect-certain-supplies-16256.html ;
  https://www.taxaj.com/learn/gst-on-commission-air-tickets-travel-agents/
- S Air fares under GST 2.0 — https://oga-prod.angelone.in/news/taxation/gst-on-air-travel-in-india-economy-5-premium-18-effective-september-22-2025 ;
  https://busy.in/gst-rates/flight-tickets ; https://www.theweek.in/wire-updates/business/2025/09/04/del73-avi-gst-airfares-iata.html
- S Hotel ≤ ₹7,500 at 5 % — https://taxguru.in/?p=1049288
- S Circular 178/10/2022 (cancellation charges) — https://www.rsm.global/india/sites/default/files/media/RSM%20India/Publications/Feb%202023/rsm_india_newsflash_summary_of_gst_circulars_clarifying_gst_applicability_on_liquidated_damages_notice_pay_recovery_etc._and_clarifications_on_several_rate_related_aspects.pdf ;
  https://taxo.online/latest-news/06-08-2022-gst-applicable-on-hotel-travel-bookings-cancellation-charges/
- S GST 2.0 and the auto sector's cess credit (for the candidate table) — https://www.autocarpro.in/news/fada-moves-supreme-court-over-%e2%82%b92500-crore-cess-issue-after-gst-20-129333 ;
  https://www.taxclue.in/guide/gst-on-motor-vehicle
- S e-Invoice ₹5 crore, 30-day rule at ₹10 crore — https://www.taxmann.com/post/blog/time-limit-of-30-days-for-reporting-e-invoice-on-irp-portal-for-taxpayers-with-aato-of-10-crores-and-above-gstn-update/ ;
  https://tallysolutions.com/business-guides/e-invoicing-compliance-rules-in-2026/ ; GSTN advisory on mahagst.gov.in (503)
- S GSTR-3B auto-population / IMS — https://ey.com/en_in/technical/alerts-hub/2024/10/gstn-issues-advisory-on-hard-locking-of-auto-populated-values-in-form-gstr-3b ;
  https://www.gstcouncil.gov.in/sites/default/files/2026-05/newsletter_april_issue.pdf (listing only)

Vendors and market:
- V TallyPrime 7.0 release notes — https://help.tallysolutions.com/release-notes-tallyprime-7-0 ; https://tallysolutions.com/darpan/product-update-tallyprime-7-0/
- V Tally travel pages — https://tallysolutions.com/billing-software/travel/ ; https://tallysolutions.com/gst-software/tour-packages
- V Zoho Books product updates — https://help.zoho.com/portal/en/community/topic/zoho-books-product-updates-october-2026 ;
  https://help.zoho.com/portal/en/community/topic/zoho-books-product-updates-july-2026 ;
  https://help.zoho.com/portal/en/community/topic/zoho-books-product-updates-april-2026-16-4-2026 ; S https://www.outlookbusiness.com/news/zohos-finance-suite-sees-50-revenue-growth-in-india-introduces-key-feature-updates
- V Busy travel — https://busy.in/accounting-software/travel/ ; V Vyapar travel — https://vyaparapp.in/free/small-business-accounting-software/travel-agency
- S Vyapar / myBillBook / Khatabook comparisons — https://techjockey.com/compare/khatabook-vs-vyapar ; https://www.getapp.com/finance-accounting-software/a/vyapar/compare/mybillbook/
- V / S QuickBooks India exit — https://quickbooks.intuit.com/community/importing-and-exporting-data-86/migrating-out-of-quickbooks-177756 ;
  https://thepaypers.com/fintech/news/quickbooks-will-exit-the-indian-market-in-2023 ; https://profitbooks.net/quickbooks-shutting-down-india-business/
- V Travel back-office category — https://phptravels.com/travel-accounting-systems-integration ; https://peakflo.co/blog/accounting-software-for-travel-agencies ;
  S https://www.talentmate.com/jobs/india/hyderabad/accountant-travel-and-tourism-onsite-hyderabad/2609-5325-13907
- Build tooling (A1): rolldown 1.0.0-rc.17 `CodeSplittingGroup` (`tags: ['$initial']`, `priority`, `maxSize`,
  `entriesAware`) — `node_modules/rolldown/dist/shared/define-config-*.d.mts` (read); Vite 8.0.10.

---

## 3. Ranked list: what to build now

Value 1–5. Effort S = 1, M = 2, L = 3. Score = value ÷ effort. **Cut** = the order a package drops items when it hits
its size cap (1 = first to go).

| Rank | Id | Gap | Who needs it | Value | Effort | Score | Pkg | Cut |
|---|---|---|---|---|---|---|---|---|
| 1 | A1 | Initial-module chunk group (−43.4 kB total, −2.3 kB first paint) | every user, every later round | 5 | S | 5.0 | A | never |
| 2 | A4 | 2026 housekeeping: tour-package Sl. 8 label, manpower = work | every TCS collector / TDS payer | 4 | S | 4.0 | A | never |
| 3 | B1 | Travel profile (picker, packs, desk tab, checklist, help, sample data) | all travel / event businesses | 5 | S | 5.0 | B | never |
| 4 | D1 | TCS on overseas tour packages (2 % from 1 Apr 2026; history rows) | outbound sellers | 5 | S | 5.0 | D | never |
| 5 | B3 | GST regimes for tours (5 % no-ITC with ITC block / 18 % / agent + pure agent / exempt) | operators, agents | 5 | M | 2.5 | B | never |
| 6 | B2 | Trip / event files, bookings, costing and trip margin | all | 5 | M | 2.5 | B | 4 (drop per-pax costing columns) |
| 7 | C1 | Air-ticket lines with Rule 32(3) deemed value | ticketing agents | 5 | M | 2.5 | C | never |
| 8 | B4 | Travel paper (`tv` snapshot block) | all | 4 | S | 4.0 | B | 3 (drop the itinerary rows; keep header + declaration) |
| 9 | A2 | Audit-append coalescing (PERF-3 part) | heavy users | 4 | S | 4.0 | A | never (≤ 0.1 kB) |
| 10 | A3 | Party netting (customer ↔ supplier set-off) | traders, manufacturers, agents, contractors | 4 | M | 2.0 | A | 2 (drop the printable netting statement; keep the voucher) |
| 11 | C3 | Cancellations, refunds, re-issues | all | 4 | M | 2.0 | C | 3 (drop re-issue; keep cancel + refund) |
| 12 | C2 | BSP / consolidator / bed-bank statement import and match | agents | 4 | M | 2.0 | C | 2 (drop the bed-bank preset; keep generic mapping) |
| 13 | D2 | Outbound / inbound POS and export check | operators, DMCs | 3 | S | 3.0 | D | 2 (chip only, no view rows) |
| 14 | C4 | Commission income (airline / hotel / insurer), 194H expected | agents | 3 | S | 3.0 | C | 1 |
| 15 | D3 | Event budgets, Sec 12(7) POS, vendor TDS hints | event planners | 4 | M | 2.0 | D | 1 (budget view stays; drop the vendor-advance column) |
| — | — | GDS / BSPlink live sync, online payments, itinerary builder | — | 4 | L | 1.3 | no (network / outside books) | — |
| — | — | Hindi-out-of-chunks precache change | English users | 3 | M | 1.5 | no (lead decision, §8 Q4) | — |
| — | — | Row-level `invoices` storage (rest of PERF-3) | heavy users | 4 | L | 1.3 | no (storage contract) | — |

All 15 are planned. The cut column, not a renegotiation, decides what happens at a cap.

---

## 4. Specifications (15 items)

Conventions for every item:
- **Logic and tests.**
  - Pure logic for travel goes in `src/lib/travel/tv-*.ts` (new folder) and A3's in `src/lib/netting.ts`. Both are
    tested with `node:test` in `tests/tv-*.test.ts` / `tests/netting.test.ts`.
  - UI checks are `step(...)` blocks in `tests/e2e/smoke.mjs` (§7).
  - Existing files are edited only where §6 says.
- **Components.**
  - Travel components live in `src/components/travel/`: `TripsDesk.tsx` (lazy, glob-mounted by `Time.tsx`) and its
    five lazy views (`TripsView`, `BookingsView`, `StatementsView`, `TcsView`, `EventsView`).
  - Editor / form rows are lazy parts, each mounted only when the travel pack is on: `TravelRows` on the invoice
    editor, `TicketRows` (C1), `TripPick` on the purchase-bill form.
  - The template part is `src/components/templates/parts/TravelBlock.tsx` (lazy; the R12 `AgriBlock` / R13
    `MfgBlock` / R14 `ProfBlock` pattern).
  - The netting dialog is `src/components/receivables/NettingDialog.tsx` (lazy).
- **Strings.** One area per package (§1.5). Hindi uses the trade's words: यात्रा फ़ाइल, टूर पैकेज, टूर ऑपरेटर, ट्रैवल
  एजेंट, यात्री, हवाई टिकट, मूल किराया, कर व शुल्क, सेवा शुल्क, शुद्ध एजेंट के रूप में वसूली, रद्दीकरण शुल्क, धनवापसी,
  दोबारा टिकट, आपूर्तिकर्ता विवरण, कमीशन, प्रोत्साहन, विदेशी टूर पैकेज, स्रोत पर कर संग्रह (TCS), विदेशी पर्यटक,
  कार्यक्रम (इवेंट), आयोजन स्थल, कलाकार, बजट बनाम वास्तविक, मार्जिन, आपसी समायोजन (नेटिंग).
- **Storage.** New company tables `mrchartist_inv_<table>` go through `getTable` / `setTable`. Each is registered in:
  - `backup.ts` (`RECORD_TABLES` / `ID_TABLES`);
  - the open-export schema (`trust/open-export-schema.ts`);
  - `sync-engine.ts` `DATED` when dated;
  - **`src/lib/travel/tv-registry.ts`** (`TV_TABLE_ACTIONS`, `TV_WATCHED`), registered at runtime, never in
    first-paint `access.ts` / `audit-edits.ts`. Every writer module and the two all-table lazy writers
    (`sync-engine.ts`, `trust/recycle-bin.ts`) import it for its side effect (`tests/tv-registry.test.ts`).

  Table and object names live in `src/lib/travel/tv-shared.ts`. Additive record fields come by declaration merging in
  `src/types/travel-r15.ts`, one file with one `declare module` block per package. Each table gets one row in
  `docs/ARCHITECTURE.md` (lead).
- **Volume.** Tickets are the high-volume item: a busy agency issues 5,000–20,000 tickets a year.
  - Round 15 adds **no per-ticket table**. Ticket details live on the invoice line snapshot (`tv.lines[lineId]`).
  - A statement's rows are stored **inside** its `supplier_statements` row (≤ 2,000 rows per statement; larger files
    are split by month on import).
  - A test builds one year of 20,000 tickets and 26 BSP statements. It checks that matching one statement reads only
    the invoices dated in its billing period ± 45 days.
- **Invoice snapshots.**
  - Everything Round 15 stores on an invoice lives under the record key **`tv`**: one object, with each package
    owning its sub-fields (§6). Templates read them from the record only.
  - A purchase bill tagged to a trip carries `PurchaseRecord.tv` (`trip_id`, `booking_id`, `regime`). B checks that
    `readPurchase` passes the key through, and adds `tv` to the purchase keep-list if it does not.
- **Numbers.** **No new series.** Trip codes are the agency's own (`<YY><MM>-<seq>` suggested, editable, unique per
  company), stored on the cost centre. Statements keep the supplier's own numbers.
- **Guards.**
  - Destructive calls use `requireAccess`, and writes in a locked period use `assertUnlocked`.
  - Money goes through `round2`.
  - Every delete goes through `setTable` on a watched table, so the recycle bin gets the row.
  - Every multi-table write uses `withTablesRollback` (`table-txn.ts`).
- **Packs.** A desk tab is listed only when its pack is on (its URL still opens it). Tables are not read while their
  pack is off (`tests/tv-pack-gate.test.ts`, like `tests/mf-pack-gate.test.ts`).
- **Help.**
  - Every new tab and view gets a topic (`tests/help-registry.test.ts` fails otherwise) and a Ctrl+K title in
    `src/i18n/areas/discover-r6-tabs.ts`. Statutory topics cite the TV ids.
  - **A adds `TV` to the CA-id regexes** in `tests/help-registry.test.ts`, `tests/help-glossary.test.ts` and
    `tests/docs-links.test.ts` (both the `cited` and the `ca: [...]` regex).
  - `TV` cannot collide with `T…` ids because the regexes need a digit right after the prefix. A's test case for
    `TV1` proves it.
- **Cash readers.** **No new receipt marker.** A3 reuses `exchange_purchase_id`, so `movedNoCash` and the no-cash
  readers are not edited. A3 adds two netting cases to `tests/no-cash-readers.test.ts`: a netting receipt never
  reaches the cash book, Today or the bank reconciliation.
- **Purchases contract.** Every new module that reads `purchases` (A3, B2, B3, C2, C3, D3) is added to
  `tests/purchase-contract.test.ts` and reads bills through `readPurchase`.
- **Rule file shape.** `src/lib/travel-rules.ts` rows are `{ from: 'YYYY-MM-DD', value, source, verified }`,
  append-only. They are read with the shared `ruleAt` helper.

### R15-A — Size recovery and cross-cutting (merge first)

#### A1 Initial-module chunk group

**User story.** As every user I get a lighter first load and faster screen opens, and every later round has headroom.

**Acceptance criteria.**
1. `vite.config.ts` replaces `manualChunks` with `build.rolldownOptions.output.codeSplitting.groups`:
   ```ts
   codeSplitting: {
     groups: [
       { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 30 },
       { name: 'vendor-ui', test: /node_modules[\\/](lucide-react|qrcode\.react|zustand|clsx)[\\/]/, priority: 30 },
       // R15-A1: every first-paint app module in ONE chunk (measured −43.4 kB total, −2.3 kB initial).
       { name: 'app-initial', tags: ['$initial'], priority: 20 },
     ],
   },
   ```
   - The existing comment about **never** adding a manual chunk for the PDF stack stays, and is extended: "`app-initial`
     captures `$initial` modules only; never add a group that can capture `jspdf` / `html-to-image`".
   - The vendor chunks keep their names (long-term caching, `_headers`).
2. **Measured, not assumed.** A1's commit records in `docs/features/travel-r15.md` §A:
   - before / after numbers (initial, entry, total, chunk count, cross-chunk import statements);
   - must hold: total **≤ 3,385 kB** and initial **≤ 183.0 kB** on the A1 commit. If rolldown or the tree changed and
     the saving is below 30 kB, A1 stops and reports to the lead before B starts.
3. `scripts/check-bundle-size.mjs`:
   - `BUDGET_ENTRY` 90 → **100 kB**, with a note that since A1 the entry chunk holds all first-paint app code, so
     initial (185) is the binding limit;
   - a new check: initial files ≤ **5** (entry + runtime + three named groups).
   - Initial and total budgets are unchanged (185 / 3,500).
4. The production e2e (`npm run test:e2e`), `npm run verify:offline` and `npm run build` pass. The author's run of the
   same configuration passed 587 / 587 e2e checks and all offline checks (§2.7).
5. `docs/qa/performance.md` gets a paragraph on the group. `AGENTS.md` (lead) gets one line under Stack: "code
   splitting: `codeSplitting.groups` (vendor-react, vendor-ui, app-initial); do not change to `rollupOptions` /
   `manualChunks`".

**Files.** Edit: `vite.config.ts`, `scripts/check-bundle-size.mjs`, `docs/qa/performance.md`. New test
`tests/bundle-config.test.ts`. It parses `vite.config.ts` as text and asserts:
- the three group names, with priorities 30 / 30 / 20;
- `tags: ['$initial']`;
- no group whose `test` matches `jspdf` or `html-to-image`.

**Risks.** Any change to any first-paint module now invalidates one 88 kB chunk instead of one of ten small ones. This
is acceptable: the PWA precaches the whole release anyway. Rolldown is an RC: pin the current `vite` / `rolldown`
versions in the lockfile, which is already the case.

#### A2 Audit-append coalescing (PERF-3, part)

**User story.** As a user with a large company, saving an invoice does not hang while the audit log is rewritten a
dozen times.

**Acceptance criteria.**
1. `audit.ts` gathers the records appended during one synchronous task (one save) in an in-memory queue. It writes the
   audit table **once**, in a microtask, preserving order and the hash chain. Archive-segment rollover (`auditSegments`,
   `AUDIT_ARCHIVE_PREFIX`) runs on the flushed batch.
2. `audit.flush()` is exported. It is called by backup export, sync push, the auditor pack, `beforeunload` and the
   tests, so nothing reads a stale log.
3. `tests/audit-coalesce.test.ts` checks four things:
   - one save that records 13 events → **one** `setTable(AUDIT_TABLE, …)`;
   - the chain verifies (`verifyChain` or the existing verifier);
   - a crash between record and flush loses nothing already flushed;
   - the order is the same as before.
4. `tests/perf.test.ts` (perf round 4 harness) records the audit-write count per save: **≈ 13 → 1**.
5. First paint **≤ +0.1 kB**: `audit.ts` is reached from `localDb.ts`, which is first paint.

**Files.** Edit: `audit.ts` (and the flush call sites `backup.ts`, `sync-engine.ts`, `trust/auditor-pack*`, one
`beforeunload` in `main.tsx`, reviewed by the lead). New test.

#### A3 Party netting (customer ↔ supplier set-off)

*Seen in:* Zoho Books (Oct 2026, "Netting"), Tally (party as one ledger).

**User story.** My consolidator also buys packages from me. I owe them ₹1,80,000 and they owe me ₹65,000. I open
Netting on the party, tick their open bills on both sides, and the app sets off ₹65,000 in one step. Both sides show
the bills settled, and the books show one journal.

**Acceptance criteria.**
1. **Who.** A party qualifies when a client and a vendor share the same name or GSTIN (exact match; a link can be set
   by hand on the vendor form: `Vendor.client_id`, additive). The dialog opens from:
   - Receivables, as a row action;
   - the vendor's payables view;
   - Ctrl+K "Netting".
2. **What.** The dialog lists the open customer invoices and the open supplier bills (bill-wise, oldest first). The
   user picks amounts; the netting amount is ≤ min(Σ receivable picked, Σ payable picked).
3. **Posting with no new marker.** For each picked customer invoice, a receipt row (`transactions`) is written with
   `exchange_purchase_id` = the picked supplier bill and `method: 'netting'` (display only), so that:
   - `movedNoCash` already skips it;
   - `ledger/postings.ts` already posts it Dr Sundry creditors (party) / Cr Debtors (party).

   For the supplier side:
   - A **generalised roll-up** `exchangeSettled(purchaseId, payments)` (new, in `netting.ts`) adds the live netting
     rows to the bill's paid amount.
   - It is used by the payables reader through one call in `billwise.ts` (reviewed by the lead). R9 `syncUrdPaid`
     keeps its own URD semantics and is not changed; it calls the same helper.
   - A deleted or cancelled netting receipt frees both sides.
4. **One action, one audit line, all or nothing** (`withTablesRollback`). The period lock applies. A clerk needs
   `books.edit`. A netting above the company cap (default ₹0, so every netting by a clerk) goes to the existing approval
   queue (`approvals.ts`).
5. **Guards:**
   - refused when a picked bill is under GST reverse charge with unpaid RCM;
   - refused when it is a URD buy-back (R9 has its own exchange flow);
   - refused when the bills are in different currencies;
   - an RCM or TDS on the bill is untouched (TDS stays on the original payment flow).
6. **Print** (cut 2): a "Netting statement" (both columns, net) through the existing statement print. WhatsApp text via
   `share.ts`.
7. **Undo:** "Reverse netting" deletes the receipt rows through the data layer (recycle bin).

**Files.** New: `src/lib/netting.ts`, `components/receivables/NettingDialog.tsx`, `src/i18n/areas/netting-r15a.ts`.
Edit: `billwise.ts` (one call), `retail/rt-doc-hooks.ts` (`urdSettled` uses the shared helper, behaviour unchanged),
Receivables row actions (one lazy item), the vendor form (one lazy link row), the palette list. Tests:
- `tests/netting.test.ts`: pick, partial, cap, approval, reverse, currency mismatch, URD refusal, ledger TB balanced,
  receivables and payables both reduced, cash book unchanged;
- `tests/no-cash-readers.test.ts`: two cases appended.

**Budget.** ≤ 4 kB gz (all lazy).

#### A4 2026 statutory housekeeping

**Acceptance criteria.**
1. **Tour-package label (TV3).** `ita2025.ts` gains a mapping key `'206C1G-tour'` → `'Sec 394(1) [Table: Sl. No. 8]'`
   (`verified: true`, source "Finance Bill 2026 cl. 73(f); Memorandum ¶8"). The code-to-key parser maps labels and
   codes containing "tour" to it. The LRS key keeps Sl. No. 7. Old stored codes are never renamed (`AGENTS.md`).
2. **Manpower = work (TV23).** `tds-rules.ts` gains one dated label row (from `2026-04-01`) on the contractor family:
   "Sec 393(1) Table Sl. 6(i) — contractor / **supply of manpower** (Sec 402(47) from 1 Apr 2026)". The payables
   section picker shows a one-line hint when a bill's item or ledger name contains "manpower" and the user picked the
   professional / technical limb. `verified: false` (Bill read, Act not).
3. ROADMAP 23d is updated (lead): the tour-package rate is delivered by D1 for sellers. LRS rates are bank-collected
   and stay out of the app.

**Files.** Edit: `ita2025.ts`, `tds-rules.ts` (appended rows only), the payables section picker (one lazy hint).
Tests: `tests/ita2025.test.ts` (new key, parser), `tests/tds-rules.test.ts` (dated row). **Budget** ≤ 1 kB, lazy.

### R15-B — Travel core (packs `travel`, `events`)

#### B1 Travel profile

**User story.** When I set up the app I pick "Services", then "Travel, tours and events", then *Tour operator*. The app
turns on the Trips desk, lands me on Time → Trips, and the checklist asks for my GST regime, my first supplier
(consolidator / airline / hotel) and my first trip.

**Acceptance criteria.**
1. `PackId` gains `travel` and `events` (appended to `PACK_IDS`). `PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE` and
   `PACK_ROUTES` are unchanged.
2. `SERVICE_KINDS` gains `'travel'` (`shop-presets.ts`, lazy), and `ServiceKind` gains `'travel'` (type only).
3. Settings fields `travel_kind?: 'tour_operator' | 'agent' | 'inbound' | 'events' | 'other'` and the object
   **`travel_settings`** (`settings.manage`, audited, synced as a singleton). `travel_settings` holds:
   - `regime_default: 'to5' | 'to18' | 'agent'` (B3);
   - `iata: { code?, bsp?: boolean }`;
   - `consolidators: vendor ids[]`;
   - `fee_defaults: { domestic, international }`;
   - `tcs: { base: 'total' | 'taxable' }` (D1).
4. `applyTravelKind(kind, { registered, currentPacks })` (`shop-presets.ts`, the R12–R14 pattern) returns business type
   `services`, `service_kind: 'travel'`, modules (`PRESETS.services` + `accounts` + `purchases`; `registered` adds
   `gst`; `time` always kept so `/time` stays visible), packs in union with `currentPacks`, landing (§1.4), due days 7,
   and switches:

   | kind | `regime_default` | switches |
   |---|---|---|
   | tour_operator | `to5` | ITC block on 5 % trips; TCS on outbound; package costing |
   | agent | `agent` | ticket rows; statements; commissions; pure agent on |
   | inbound | `to18` | foreign currency; export / POS chip; exempt-outside-India prompt |
   | events | `to18` (events) | budgets; Sec 12(7) chip; vendor TDS hints |
   | other | `to18` | trips and bookings only |

5. **Wizard.** The R10 service picker gets one card, "Travel, tours and events" (lazy sub-step, inside the wizard
   chunk). It asks the kind, "Registered under GST?" and, for `agent`, "IATA / BSP or consolidator?". Settings →
   Features shows "Travel profile" for every `services` company. Changing it never deletes data.
6. **Checklist steps** (`checklist-steps.ts`, append-only, only with `travel_kind`):
   - every kind: `firstTrip`, `firstSupplier`;
   - tour_operator: `regime`;
   - agent: `firstStatement` (counts an `import_runs` row of kind `supplier_statement`);
   - events: `firstEvent`.
7. **Sample data** (R6-B4) in `src/lib/demo/profile-travel.ts`, only in the Demo company, ≤ 0.6 kB gz. One block per
   kind:
   - a Goa package (5 %) with three bookings;
   - a Dubai package (TCS 2 %);
   - two domestic tickets with a BSP statement of four rows (one ADM);
   - a wedding with a budget of ₹18 lakh and six vendors.

**Files.** New: `src/lib/travel/{tv-profile,tv-registry,tv-settings,tv-shared}.ts`, `src/lib/travel-rules.ts`
(scaffold with one section per package), `src/types/travel-r15.ts` (scaffold), `src/components/travel/TravelKindPicker.tsx`,
`src/lib/demo/profile-travel.ts`. Edit:
- `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`;
- the R10 service picker (one lazy card), `FeaturesPanel.tsx`;
- `page-tabs.ts` (the `trips` row), `Time.tsx` (the glob mount);
- the demo dispatcher.

**Tests.** `tests/tv-profile.test.ts`:
- each kind's type / modules / packs / landing / switches;
- `registered` adds `gst`;
- packs union with existing packs;
- `PACK_OF_TYPE` / `PACK_ROUTES` unchanged;
- a services company without `travel_kind` unchanged.

Also extend `tests/industry-packs.test.ts`, and add `tests/tv-registry.test.ts`, `tests/tv-rules.test.ts` (import
graph) and `tests/tv-pack-gate.test.ts`.

#### B2 Trip / event files, bookings and costing

**User story.** A family of four books Kerala for 6 nights. I open a trip file, add flights (consolidator), three
hotels, a cab and a houseboat with cost and sell. The file shows ₹2,46,000 sell vs ₹2,08,500 cost, a 15.2 % margin and
what is still unconfirmed. "Bill" makes a draft invoice in the trip's regime.

**Acceptance criteria.**
1. **Trip file = cost centre** (kind `project`, the R14 matter precedent) with `CostCentre.tv`:
   - `code`, `kind: 'trip' | 'event'`, `scope: 'domestic' | 'outbound' | 'inbound'`;
   - `destination`, `start`, `end`;
   - `pax: { name, type: 'adult' | 'child' | 'infant' }[]` (names only; passport numbers are **not** stored — DPDP,
     §6);
   - `client_id`, `regime` (B3), `currency` (default INR), `status: 'enquiry' | 'confirmed' | 'travelled' |
     'closed' | 'cancelled'`.

   Budgets, cost-centre P&L and reports work unchanged.
2. **Table `travel_bookings`** (dated by `start`, synced, audited, right `doc.create`). Each row has:
   - `id`, `trip_id`;
   - `component: 'air' | 'rail' | 'bus' | 'hotel' | 'transfer' | 'sightseeing' | 'visa' | 'insurance' | 'package'
     (bought from another operator) | 'venue' | 'catering' | 'decor' | 'artist' | 'av' | 'manpower' | 'other'`;
   - `vendor_id`, `ref` (PNR / confirmation), `start`, `end`, `qty`;
   - `cost`, `cost_currency`, `fx` (rate at booking), `sell`, `pure_agent?: boolean`;
   - `status: 'held' | 'confirmed' | 'cancelled'`;
   - `bill_id?` (the supplier bill when booked), `line_ref?` (invoice + line once billed), `notes`.
3. **Views on the Trips desk.**
   - `trips`: files with sell, cost, margin %, unbilled, unpaid supplier and status filter.
   - `bookings`: all components with filters (unconfirmed, unbilled, supplier unpaid, travelling in the next 7 days).
4. **Costing.** It shows per component and in total cost (INR at `fx`), sell and margin. In the 5 % regime it adds a
   note that input ITC is blocked. Per-pax columns are cut 4.
5. **"Bill"** builds a draft invoice through the existing draft builder (the R14 `ps-prebill` / R3-B "Unbilled → Bill"
   path):
   - in `to5` / `to18` regimes: one package line (gross) with optional detail rows on the paper;
   - in `agent`: one fee line plus pure-agent lines (`charge_head_id: 'rule33'`, `PURE_AGENT_CHARGE`) per pass-through
     component.

   Billed state is derived from `line_ref` (no stored flag that can drift).
6. **Supplier bills.** The purchase-bill form gets a lazy `TripPick` row: trip and booking. It writes
   `PurchaseRecord.tv` (`trip_id`, `booking_id`). Costing reads actual bills over booking costs when present.
7. **Trip margin report** (inside `trips`): sell − cost − cancellation losses + commissions (C4) per trip and per month.
   It reads only the trips in the period (volume test).

**Files.** New: `src/lib/travel/{tv-trips,tv-bookings,tv-costing,tv-bill}.ts`,
`components/travel/{TripsDesk,TripsView,BookingsView,TripPick}.tsx`, `src/i18n/areas/travel-r15b.ts`. Edit: the cost-centre
form (one lazy row), the purchase-bill form (one lazy row). Tests: `tests/tv-trips.test.ts`, `tests/tv-costing.test.ts`,
`tests/tv-bill.test.ts`, volume.

#### B3 GST regimes for tours

**User story.** As a tour operator I sell a Goa package at ₹60,000 under the 5 % regime. The invoice says it is the
gross amount including stay and transport, and that no ITC is taken. When I enter the hotel's bill for that trip, the
app marks its ITC as not eligible. As an agent I bill only my ₹2,500 service fee at 18 % and recover the hotel and the
fares at actual.

**Acceptance criteria.**
1. **Regimes** (`TRAVEL_REGIME_RULES` in `travel-rules.ts`, dated, `verified: false`, TV8–TV10):

   | Regime | Line(s) | Rate (from the rule by document date) | ITC | Declaration |
   |---|---|---|---|---|
   | `to5` tour operator, gross | package line, SAC 998555 (rule) | 5 % (2.5 + 2.5 / IGST 5) | **blocked** on the trip's inputs except bookings of component `package` from another tour operator | "Tour operator service — the amount is the gross amount charged including accommodation and transportation; GST 5 % without ITC (N 11/2017-CT(R) Sl. 23(ii)). Verify with your CA." |
   | `to18` tour operator / travel arrangement | package line | 18 % | allowed | — |
   | `agent` | service-fee line 18 % + pure-agent lines (outside value) | 18 % on the fee | allowed (fee) | "Fares / hotel / visa fees recovered at actual as a pure agent (Rule 33)." |
   | `exempt_outside` (foreign tourist, tour wholly outside India) | package line | 0 %, `sv.exempt: 'EXEMPT'` | per CA (TV10) | "Exempt — tour operator service to a foreign tourist for a tour wholly outside India (entry to confirm)." |

2. **ITC block.**
   - A purchase bill tagged to a `to5` trip gets `itc_eligible: false` suggested (prefilled, the user may override with
     a reason, audited).
   - GSTR-3B Table 4 and the purchase register read the existing field, so no GST reader changes.
   - A month-end check ("ITC claimed on 5 % trips") lists overrides.
3. **One regime per invoice.** Mixing a 5 % package line with 18 % fee lines on one invoice shows a warning (TV9),
   never a block.
4. **Pure-agent lines** reuse `charge_head_id: 'rule33'` and the R14 `ps-disb` guard (conditions checklist). GSTR-1 /
   e-Invoice / e-Way recognise them unchanged.
5. **Snapshot.** The invoice snapshots `tv.regime`, `tv.decl` (the printed sentence) and `tv.trip` (code, destination,
   dates, pax count).

**Files.** New: `src/lib/travel/{tv-regime,tv-itc}.ts`, `components/travel/TravelRows.tsx` (editor lazy row: trip pick,
regime chip). Edit: the invoice editor (one lazy row mount), the GST guards source list (one lazy check "ITC on 5 %
trips"). Tests: `tests/tv-regime.test.ts` (rates by date, declaration, mixing warning, exempt column),
`tests/tv-itc.test.ts`.

#### B4 Travel paper

**Acceptance criteria.**
1. `TravelBlock.tsx` (lazy, mounted in `TemplateEngine.tsx` after `ProfBlock`, before `GstBody`, never on `receipt`)
   prints, from `tv` only:
   - trip code, destination, dates, lead passenger and pax count;
   - the regime declaration;
   - up to 6 itinerary rows (date, component, description) — cut 3;
   - C1's ticket table and D1's TCS line, through `switch` arms in their own part files `parts/travel/*.tsx`.
2. Old invoices render unchanged (snapshot compare in `tests/tv-print.test.ts`). Colours come from `accent` only.
3. `paper-helpers.ts`: `tvLineText` (ticket particulars in the line description) appended after the R14 helpers.

**Files.** New: `components/templates/parts/TravelBlock.tsx`, `src/lib/travel/tv-print.ts`, `travel-paper.module.css`.
Edit: `TemplateEngine.tsx` (one lazy import + mount), `paper-helpers.ts`, `invoice-defaults.ts` (one token).

### R15-C — Air tickets and supplier settlement

#### C1 Air-ticket lines with Rule 32(3)

**User story.** I issue two Delhi–Mumbai economy tickets (basic fare ₹4,200 each, taxes ₹1,150) and charge ₹300 per
ticket. Under the deemed-value option the app values my service at 5 % of the basic fare (₹420) and charges 18 % GST
on it. The fares go through as pure agent, and GSTR-1 shows only my taxable value.

**Acceptance criteria.**
1. **Ticket rows** (`TicketRows.tsx`, lazy, editor; also from a booking of component `air`). Each line carries, under
   `tv.lines[lineId].tkt`:
   - `pax`, `airline`, `ticket_no` (13 digits, checksum not enforced), `pnr`;
   - `sector`, `class: 'economy' | 'other'`, `intl: boolean`;
   - `basic`, `taxes`, `airline_gst`.

   The fare total (basic + taxes + airline GST) goes on a pure-agent line (`charge_head_id: 'rule33'`). The airline's
   GST is the airline's tax collected through the agent, shown, not ours (TV11, TV12).
2. **Value method** (`travel_settings.air_value: 'deemed' | 'actual'`, per invoice override; `AIR_AGENT_VALUE_RULES`
   in `travel-rules.ts`):
   - `deemed`: one service line of value = 5 % (domestic) / 10 % (international) of Σ basic fare. GST at the rule's
     rate (18 %) on that value.
   - The agency's own fee to the client is then **inside** the deemed value. When the fee exceeds the deemed value,
     the app shows "the deemed value is an option; your fee is higher — check with your CA" (TV11) and keeps the
     deemed value.
   - `actual`: one service-fee line at 18 % on the fee.
   - Commission received from the airline (C4) is billed to the airline separately in either method.
3. **HSN / SAC** from the rule (998551, `verified: false`). e-Invoice: the deemed-value line is the taxable item and
   pure-agent fares go to `OthChrg` (existing behaviour of `isPureAgentLine`).
4. **Annexure** (cut 3): a ticket list page through the existing R3-B4 annexure component, with one optional column
   set.

**Files.** New: `src/lib/travel/{tv-air,tv-air-value}.ts`, `components/templates/parts/travel/TicketTable.tsx`,
`components/travel/TicketRows.tsx`. Tests: `tests/tv-air.test.ts`:
- deemed 5 % / 10 %;
- actual;
- fee above deemed;
- GSTR-1 shows only the service value (no nil row for fares);
- e-Invoice `OthChrg`;
- an international + domestic mix on one invoice;
- dates before / after 22 Sep 2025 for passed-through airline GST.

#### C2 Supplier statements (BSP / consolidator / bed-bank)

**User story.** Every fortnight I download the BSP billing file and import it. The app matches 212 of 215 tickets to my
invoices and bookings, and flags one ADM of ₹3,500, one refund I never passed on and one ticket I never billed.

**Acceptance criteria.**
1. **Import** through the import wizard's mapper (`import-mapping.ts`: a new `ImportKind` `'supplier_statement'`,
   mapped like clients / items; XLSX via dynamic `xlsx.ts`). Presets for fields:
   - BSP (document no. = ticket no., type TKTT / RFND / ADMA / ACMA, gross fare, taxes, commission, net remit);
   - consolidator (generic: date, ticket / ref, pax, gross, commission, net);
   - bed-bank (booking ref, check-in, amount) — cut 2.

   The user edits the mapping once and it is remembered in `travel_settings.statement_maps`. One `import_runs` row is
   written per import (R6-C3 contract).
2. **Table `supplier_statements`** (dated by `period_end`, synced, audited, right `books.edit`). Each row has:
   - `id`, `vendor_id`, `kind: 'bsp' | 'consolidator' | 'bedbank'`;
   - `period_start`, `period_end`, `ref`;
   - `rows: { doc_no, type, date?, pax?, gross, taxes, commission, net, match?: { kind: 'invoice_line' | 'booking' |
     'bill'; id }, status: 'matched' | 'diff' | 'missing' | 'ours_only' }[]` (≤ 2,000; larger files split by month);
   - `totals`, `bill_id?`.
3. **Match** (`tv-match.ts`, pure):
   - by ticket no. / PNR / booking ref, within the period ± 45 days;
   - a difference over ₹1 → `diff`;
   - ADMA → an "ADM" row with a "Record as expense / dispute" action;
   - RFND → "refund to pass on" when the client invoice has no credit note (links to C3);
   - our tickets missing from the statement → `ours_only`.
4. **Make the bill** — one action:
   - BSP / consolidator net payable → a purchase bill (the consolidator's GST invoice on its service charge as a
     taxable line; fares as pure-agent / non-GST cost lines);
   - commission shown as earned on the supplier side for net-remit statements.

   Nothing posts without the action. The bill flows into payables, BRS and Tally export unchanged.
5. **View** `statements`: list, open one, filters by status, totals, "make bill", CSV of differences (cut 3).

**Files.** New: `src/lib/travel/{tv-statements,tv-match,tv-statement-bill}.ts`, `components/travel/StatementsView.tsx`.
Edit: `import-mapping.ts` (one kind + field list), the import wizard's kind list (one row). Tests:
`tests/tv-statements.test.ts` (presets, mapping memory, split by month, `import_runs` row) and `tests/tv-match.test.ts`
(matched / diff / ADM / refund / ours_only, ±45 days, volume).

#### C3 Cancellations, refunds and re-issues

**User story.** A client cancels a ₹48,000 package two weeks out. The hotel keeps ₹6,000 and the airline refunds the
fare less ₹3,000. I charge a ₹1,500 cancellation fee. The app makes the credit note for the refund to the client, the
fee invoice line with GST, and the supplier refund receivable, and the trip shows the loss.

**Acceptance criteria.**
1. **Cancel** on a booking or a whole trip opens one dialog:
   - supplier charge (from the statement or typed);
   - agency fee;
   - refund due from the supplier;
   - refund to the client.
2. **Documents:**
   - client side: a credit note on the original invoice through `documents.createCreditNote` (GST reversed pro rata on
     the taxable part), and a new invoice line or invoice for the agency's cancellation fee;
   - the fee's GST rate follows the **principal supply** (Circular 178/10/2022, TV15): 5 % in `to5`, 18 % for an
     agency fee in `agent` / `to18`, the hotel band for a retained hotel charge billed by us as principal;
   - supplier side: a supplier credit note / purchase return (`purchase-returns`) for the refund due, or the statement
     refund row (C2).
3. **Re-issue** (cut 3): an exchange of a ticket. The old line's fare is reversed, the new fare is added, and the fare
   difference and re-issue fee land on one new invoice.
4. **Trip result:** cancellation charges not recovered are shown as a loss on the trip margin (B2).
5. **Guards:** a cancelled booking cannot be billed again; a refund cannot exceed what was billed; the period lock
   applies.

**Files.** New: `src/lib/travel/tv-cancel.ts`, `components/travel/CancelDialog.tsx`. Tests: `tests/tv-cancel.test.ts`
(credit note amounts, fee rate by regime, supplier return, re-issue, guards, receivables after).

#### C4 Commission income (airlines, hotels, insurers)

**Acceptance criteria.**
1. **Commission invoices to principals.** A "Commission due" list from bookings with `commission` (from statements or
   typed per booking). "Bill commission" makes one invoice per principal per period at 18 %, with 194H expected TDS
   shown (rate by date from the existing rules).
2. **Insurance commission:** the invoice to an insurer is marked **reverse charge** (recipient pays; the existing
   outward RCM flag, `rcm.ts`), TV17.
3. The TDS receivable register (existing) lists the expected 194H. The 26AS / AIS match works unchanged.

**Files.** New: `src/lib/travel/tv-commission.ts` (a panel inside `StatementsView`). Tests: `tests/tv-commission.test.ts`.
**Cut 1** for C.

### R15-D — Outbound, TCS and events

#### D1 TCS on overseas tour packages (seller)

**User story.** I sell a Dubai package for ₹3,40,000 on 10 May 2026. The app collects TCS at 2 % (₹6,800) under
Sec 394(1) Table Sl. No. 8, prints it, and puts it in my TCS register for Form 143. An invoice of 10 Feb 2026 for
₹12 lakh to the same buyer would have shown 5 % on the first ₹10 lakh and 20 % on the rest.

**Acceptance criteria.**
1. **Rule rows** (`TOUR_PACKAGE_TCS_RULES` in `travel-rules.ts`, append-only):

   | from | value | source | verified |
   |---|---|---|---|
   | 2017-07-01 | none | not in force | true (no levy) |
   | 2020-10-01 | `{ rate: 5, above: 0 }` | Finance Act 2020, Sec 206C(1G)(b) | false |
   | 2023-10-01 | `{ slabs: [{ upTo: 700000, rate: 5 }, { rate: 20 }], perBuyerFy: true }` | Finance Act 2023 | false |
   | 2025-04-01 | `{ slabs: [{ upTo: 1000000, rate: 5 }, { rate: 20 }], perBuyerFy: true }` | Finance Act 2025 (restated as "current" in the 2026 Memorandum) | false |
   | 2026-04-01 | `{ rate: 2, above: 0 }` | Finance Bill 2026 cl. 73(f) / Memorandum ¶8 (Act not read) | false |

   Plus `TCS_NO_PAN_RULES`:
   - 2020-10-01 → 10 % for 1G;
   - 2026-04-01 → the higher of twice the rate or 5 % (TV5).

   Both are `verified: false`.
2. **When.** The trip's `scope: 'outbound'` (or the user's tick "overseas tour programme package") and the package
   includes travel **and** stay (TV4: a stand-alone international ticket or hotel shows "not a package — no TCS (as
   reported)", user may override). The buyer is not a non-resident outside India (TV5; prompt).
3. **How.**
   - The invoice gets `tcs_enabled`, `tcs_rate`, `tcs_base` (`travel_settings.tcs.base`, default `'total'`, TV6) and
     `tcs_label` "Sec 394(1) Sl. 8 — overseas tour package 2 %" (before 2026: "206C(1G) overseas tour package 5 %").
   - `tcs_amount` is computed by the existing invoice maths.
   - Slab years (2023-26) use the buyer's FY aggregate of earlier packages (only invoices with the travel TCS flag)
     and split the rate on the crossing invoice.
   - **No edit to `tax-rules.ts`** — the generic TCS picker is unchanged.
4. **Register.** Rows reach `tcsRowsLite` / the TCS register as today. The collection code is taken from a new
   `tds-rules.ts` row appended by D, which is blank with "to confirm — verify with your CA" until TV7 is answered. The
   2025-Act label comes from A4's `206C1G-tour` key.
5. **View** `tcs`: TCS collected per buyer per FY, PAN missing, buyers near the old threshold (history years), the
   Form 143 / 27EQ period totals, and links to the existing challan screen.

**Files.** New: `src/lib/travel/tv-tcs.ts`, `components/travel/TcsView.tsx`,
`components/templates/parts/travel/TcsLine.tsx`. Edit: `tds-rules.ts` (one appended row). Tests: `tests/tv-tcs.test.ts`:
- every dated row;
- slab crossing;
- 2 % from 2026-04-01 at any amount;
- no-PAN rate;
- stand-alone ticket refusal;
- non-resident prompt;
- base total vs taxable;
- the register row and label.

#### D2 Outbound / inbound place of supply and export check

**Acceptance criteria.**
1. A **travel POS chip** in `TravelRows` (lazy) reads the trip `scope`, the client's registration and country, and the
   components. It shows:
   - domestic / outbound for an Indian client: POS by Sec 12(2) (registered → its State; else the address on record),
     with hotel components outside the package under Sec 12(3) (TV18);
   - **inbound for a foreign tourist / agent:** "Performed in India — POS India, **not an export** even in foreign
     currency (Sec 13(3)(b), as recalled)" (TV19). Taxable, regime as chosen;
   - **tour wholly outside India for a foreign tourist:** offers the `exempt_outside` regime (TV10).
2. **Foreign supplier bills** (a DMC abroad performing services abroad) show "no import RCM where the place of supply is
   outside India — verify" (TV20). The existing import-RCM default on bills is not changed; the chip only suggests.
3. Reuses R14 `ps-export-check.ts` for the Sec 2(6) conditions when the user marks a supply as export.
4. FX: package costing in foreign currency uses the currency master's rate at booking (`tv.fx` snapshot per booking).
   The invoice uses the existing invoice exchange rate.

**Files.** New: `src/lib/travel/tv-pos.ts` (+ one `switch` arm in `TravelRows`). Tests: `tests/tv-pos.test.ts`.
**Cut 2** for D: chip only, no rows in the trips view.

#### D3 Events: budgets, Sec 12(7) POS and vendor TDS hints

**User story.** A wedding with a client budget of ₹18 lakh: venue, decor, catering for 400, a band, an anchor, sound
and light, and 20 helpers. The budget sheet shows the approved vs booked vs billed amounts per head, the client's
advances, the margin, and each vendor's TDS section.

**Acceptance criteria.**
1. **Event file** = a trip file with `kind: 'event'` (B2). It adds `tv.event`: `{ venue, city, state, date_from,
   date_to, guests, budget: { head, approved }[] }`. Bookings of components `venue` / `catering` / `decor` / `artist`
   / `av` / `manpower` / `other` are the vendors.
2. **View** `events`: budget heads (approved, booked, billed by vendors, paid), client advances (existing advances,
   5.3), margin, and over-budget heads in the danger token. The vendor-advance column is cut 1.
3. **POS chip** (Sec 12(7)(a), TV21): registered client → client's State; unregistered → the event's State (if in
   India); event abroad → client's location. It is shown on the invoice draft and snapshotted in `tv.pos_note`.
4. **Vendor TDS hints** on the vendor's bill via the existing TDS payables picker (no new section logic; TV23):
   - catering, decor, sound, light, venue (as a contract) → contractor limb (Sl. 6(i) / 194C);
   - artists and anchors → professional limb (Sl. 6(iii) / 194J);
   - **manpower → contractor limb from 1 Apr 2026** (A4).
5. **Pure-agent venue** (client contracts the venue, we pay on its behalf) only through the R14 Rule 33 checklist
   (TV14).
6. Rate of the event-management fee from `EVENT_RULES` (18 %, SAC 998596, `verified: false`, TV22).

**Files.** New: `src/lib/travel/tv-events.ts`, `components/travel/EventsView.tsx`, `src/i18n/areas/travel-r15d.ts`.
Tests: `tests/tv-events.test.ts` (budget roll-up, advances, POS by registration and venue State, TDS hints by
component and date).

---

## 5. Work packages

Four packages, each one agent in its own worktree.

**Merge order:** **A first** (it changes the bundle layout everyone measures against, and it adds `TV` to the CA-id
regexes). Then **B** (profile, registry, rules / types / shared scaffolds, the `tv` record key, template mount, the
`trips` tab and desk with B's views). **C and D** follow in any order and can run in parallel; they share only the
registry, rules, types, demo, help and the desk's view map. There are no stubs: each package adds its own views to
the desk's lazy view map, its help topics and its Ctrl+K titles.

### R15-A — Size recovery and cross-cutting (A1–A4)

- **Owned (new):** `src/lib/netting.ts`, `components/receivables/NettingDialog.tsx`, `src/i18n/areas/netting-r15a.ts`;
  tests `bundle-config`, `audit-coalesce`, `netting`.
- **Owned (edit):**
  - `vite.config.ts`, `scripts/check-bundle-size.mjs`, `docs/qa/performance.md`;
  - `audit.ts` + flush call sites (`backup.ts`, `sync-engine.ts`, auditor pack, `main.tsx` `beforeunload`), reviewed by
    the lead;
  - `billwise.ts` (one call), `retail/rt-doc-hooks.ts` (shared helper, unchanged behaviour), the Receivables row-action
    list, the vendor form (one lazy link row), the palette;
  - `ita2025.ts` and `tds-rules.ts` (appended rows only);
  - the payables section picker (one lazy hint);
  - `tests/no-cash-readers.test.ts`, `tests/perf.test.ts`, `tests/ita2025.test.ts`, `tests/tds-rules.test.ts`;
  - `tests/help-registry.test.ts`, `tests/help-glossary.test.ts`, `tests/docs-links.test.ts` (`TV` in the regexes);
  - `tests/purchase-contract.test.ts` (netting reader).
- **Budget:** first paint **−2.3 kB measured (A1), ≤ +0.1 kB (A2)**; total −43.4 kB (A1) + ≤ 4 kB (A3) + ≤ 1 kB (A4).

### R15-B — Travel core (B1–B4)

- **Owned (new):**
  - `src/lib/travel/tv-{profile,registry,settings,shared,trips,bookings,costing,bill,regime,itc,print}.ts`,
    `src/lib/travel-rules.ts`, `src/types/travel-r15.ts`;
  - `components/travel/{TravelKindPicker,TripsDesk,TripsView,BookingsView,TripPick,TravelRows}.tsx`;
  - `components/templates/parts/TravelBlock.tsx` + `travel-paper.module.css`;
  - `src/i18n/areas/travel-r15b.ts`, `src/lib/demo/profile-travel.ts`;
  - `docs/features/travel-r15.md` (one doc for the round; each package edits only its section);
  - tests `tv-profile`, `tv-registry`, `tv-rules`, `tv-pack-gate`, `tv-trips`, `tv-costing`, `tv-bill`, `tv-regime`,
    `tv-itc`, `tv-print`.
- **Owned (edit):**
  - `industry-packs.ts`, `shop-presets.ts`, `types/services-r10.ts` (one union member), `features-catalog.ts`,
    `checklist-steps.ts`, the R10 service picker, `FeaturesPanel.tsx`;
  - `page-tabs.ts` (row `trips`), `Time.tsx` (glob mount);
  - `TemplateEngine.tsx`, `paper-helpers.ts`, `invoice-defaults.ts` (one token);
  - the invoice editor (one lazy row), the cost-centre form and purchase-bill form (one lazy row each), the GST guards
    source list (one lazy check);
  - `tests/purchase-contract.test.ts` (B's readers).
- **Budget:** first paint ≈ +0.005 kB (the `tv` token); total ≤ 14 kB gz.

### R15-C — Air tickets and supplier settlement (C1–C4)

- **Owned (new):** `src/lib/travel/tv-{air,air-value,statements,match,statement-bill,cancel,commission}.ts`;
  `components/travel/{TicketRows,StatementsView,CancelDialog}.tsx`; `components/templates/parts/travel/TicketTable.tsx`;
  `src/i18n/areas/travel-r15c.ts`; tests `tv-air`, `tv-statements`, `tv-match`, `tv-cancel`, `tv-commission`.
- **Owned (edit):** `import-mapping.ts` (one kind), the import wizard's kind list (one row), the desk's view map (adds
  `statements`), `BookingsView` (two action buttons: Cancel, Ticket — one lazy import each).
- **Shared (§6):** rules (`// R15-C`), types (`// R15-C`), registry block, demo block, `tv` sub-objects `lines`.
- **Budget:** total ≤ 11 kB gz.

### R15-D — Outbound, TCS and events (D1–D3)

- **Owned (new):** `src/lib/travel/tv-{tcs,pos,events}.ts`; `components/travel/{TcsView,EventsView}.tsx`;
  `components/templates/parts/travel/TcsLine.tsx`; `src/i18n/areas/travel-r15d.ts`; tests `tv-tcs`, `tv-pos`,
  `tv-events`.
- **Owned (edit):** `tds-rules.ts` (one appended collection-code row), the desk's view map (adds `tcs`, `events`),
  `TravelRows` (two `switch` arms: POS chip, TCS chip).
- **Shared (§6):** rules, types, registry, demo, help, `tv` sub-objects `tcs`, `event`, `pos_note`.
- **Budget:** total ≤ 9 kB gz.

**Combined:** first paint **net ≈ −2.2 kB** (A1 −2.3, A2 ≤ +0.1, B +0.005); total JS **gross ≤ +39 kB, net ≈ −4 kB**.
Each package runs `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run check:size` on its
branch, and again after rebase. A runs `npm run test:e2e` and `npm run verify:offline` too.

---

## 6. Shared-file protocol

| File | Who | Rule |
|---|---|---|
| `vite.config.ts`, `scripts/check-bundle-size.mjs` | A | One commit. Later packages never edit them. A package that wants more room cuts items (§3) |
| `src/types/travel-r15.ts` | B creates | One `declare module` block per package, marked `// R15-B` … `// R15-D`. B declares for every package in one commit: record key `tv?: TvSnapshot` with sub-objects `trip`, `regime`, `decl` (B), `lines[lineId].tkt` (C), `tcs`, `event`, `pos_note` (D); settings `travel_kind`, `travel_settings`; `CostCentre.tv`; `PurchaseRecord.tv`; `Vendor.tv` (`kind: 'airline' \| 'consolidator' \| 'bsp' \| 'hotel' \| 'bedbank' \| 'dmc' \| 'venue' \| 'artist' \| 'other'`); `Client.tv` (`foreign_tourist?`, `non_resident?`). A declares `Vendor.client_id` in `types/purchases.ts` merging (one optional field) |
| `src/store/invoice-defaults.ts` | B | **One edit:** `export const R15_RECORD_KEYS = ['tv'] as const;` and the token in the existing `R9_RECORD_KEYS` spread (after R14's). No line key |
| `src/lib/travel-rules.ts` | B creates | Sections `// R15-B` (`TRAVEL_REGIME_RULES`), `// R15-C` (`AIR_AGENT_VALUE_RULES`, `AIR_SAC_RULES`, `CANCEL_FEE_RATE_RULES`), `// R15-D` (`TOUR_PACKAGE_TCS_RULES`, `TCS_NO_PAN_RULES`, `EVENT_RULES`). Every row has `from`, `source`, `verified` |
| `src/lib/ita2025.ts`, `tds-rules.ts` | A (labels, manpower), D (collection-code row) | **Appended rows only.** Reviewed by the lead; existing tests pass unchanged |
| `src/lib/tax-rules.ts`, `hotel/hotel-rules.ts`, `trade/trade-rules.ts`, `prof-rules.ts` | — | **Not edited** |
| `src/lib/travel/tv-registry.ts` | B creates | `TV_TABLE_ACTIONS` / `TV_WATCHED`, one block per package. B: `travel_settings`, `travel_bookings`; C: `supplier_statements`. `tests/tv-registry.test.ts` pins both maps |
| `src/lib/backup.ts`, `sync-engine.ts` (`DATED`), `trust/open-export-schema.ts` | each its own rows | Append-only blocks `// R15-B`, `// R15-C` |
| `src/components/templates/TemplateEngine.tsx` | B | One lazy import + mount of `TravelBlock` (after `ProfBlock`; before `GstBody`; never on `receipt`). C / D add only `switch` arms in their own files `parts/travel/*.tsx` |
| `paper-helpers.ts` | B | `tvLineText` appended after the R14 helpers |
| `src/lib/industry-packs.ts` | B | Two ids; `PACK_TABS` block `// R15` (the desk and all five views, written by B from this PRD's ids; packages correct their rows after rebase) |
| `src/pages/page-tabs.ts` | B | One `TIME_TABS` row `trips`. C / D add **views**, not tabs |
| `components/travel/TripsDesk.tsx` (view map) | B creates, C / D append | One lazy entry per view, in a `// R15-x` block each |
| `src/pages/Time.tsx` | B | One `import.meta.glob` over `components/travel/*Desk.tsx` |
| `src/lib/shop-presets.ts`, `checklist-steps.ts`, `features-catalog.ts`, the R10 service picker, `FeaturesPanel.tsx` | B | Appended blocks `// R15`, after the R14 blocks |
| `billwise.ts`, `retail/rt-doc-hooks.ts` | A | One shared helper `exchangeSettled`; URD behaviour unchanged (`tests/rt-buyback*.test.ts` pass unchanged) |
| `audit.ts` | A | Queue + flush only; record shapes, hash chain and segment format unchanged |
| `import-mapping.ts` | C | One `ImportKind` and its field list; existing kinds unchanged |
| `src/lib/help/topics-*.ts`, `glossary.ts`, `src/i18n/areas/discover-r6-tabs.ts` | A, B, C, D | Each package writes its own topics and Ctrl+K titles in its own `// R15-x` block, in the same commit as its views. Glossary ≤ 10 terms for the round |
| `src/lib/demo/profile-travel.ts` | B creates | Dispatcher by `travel_kind`; one block per package; ≤ 0.6 kB gz in all |
| `tests/purchase-contract.test.ts` | A, B, C, D | Each appends its reader modules |
| `tests/e2e/smoke.mjs` | A, B, C, D | One appended `step(...)` block each, in merge order |
| `docs/features/travel-r15.md` | B creates (A writes §A first in its own section when it merges) | One section per package; each records its bundle numbers there |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md`, `docs/CA_REVIEW.md` | lead | After merge, the lead adds:<br>- the Round 15 section, table rows and settings keys;<br>- the `travel-rules.ts` note;<br>- "Round 15 invoice snapshots live under the record key `tv`";<br>- "every module that writes a Round 15 table must `import './tv-registry'`";<br>- "netting reuses `exchange_purchase_id`; no new no-cash marker";<br>- the `codeSplitting` note (A1);<br>- §15 TV items |

### Storage summary

| Key / field | Package | Kind | Backed up | Synced | Audited | Right (`tv-registry`) |
|---|---|---|---|---|---|---|
| `travel_settings` (regime default, IATA / BSP, consolidators, fee defaults, air value method, statement maps, TCS base) | B (sub-fields C / D) | object | yes | yes (singleton) | yes | `settings.manage` |
| `travel_bookings` | B | table, dated (`start`) | yes | yes | yes | `doc.create` |
| `supplier_statements` | C | table, dated (`period_end`) | yes | yes | yes | `books.edit` |
| settings `travel_kind`; `service_kind: 'travel'` | B | additive | yes | yes | yes | — |
| record key `tv` (sub-objects B–D, `lines`) | B (sub-fields C / D) | additive record key (one first-paint token) | yes | yes | yes | — |
| `CostCentre.tv`, `PurchaseRecord.tv`, `Vendor.tv`, `Client.tv`, `Vendor.client_id` | A / B | additive | yes | yes | yes | — |
| Netting receipts (`transactions` rows with `exchange_purchase_id`, `method: 'netting'`) | A | existing table, existing marker | yes | yes | yes | `books.edit` |
| Accounts by name: "Commission income — airlines / hotels", "Cancellation charges recovered", "Cancellation losses", "ADM charges" | B / C | created on first use | — | — | — | — |

No migration (everything is additive).

Passenger names and buyer PANs are personal data (DPDP Act 2023). They stay on the device and in the user's own backups
and open exports, like every other table. **Passport numbers, dates of birth and visa copies are not stored by Round 15**
(an attachment the user adds stays under the existing attachments feature and its rules).

---

## 7. E2E steps (production build, `tests/e2e/smoke.mjs`)

1. **R15-A:**
   - `check:size` limits (initial files ≤ 5); the app boots with no page error; the existing 587 checks pass.
   - One save on the Demo company writes the audit table once; Edit log still shows the event.
   - Netting:
     - a party that is both client and vendor: receivable ₹65,000, payable ₹1,80,000;
     - Netting ₹65,000 → both bills settled / reduced, cash book unchanged, TB balanced;
     - Reverse → both open again;
     - Ctrl+K "Netting" finds it.
2. **R15-B:**
   - Fresh company → wizard → Services → Travel → *Tour operator*, registered → lands on `/time?tab=trips&view=trips`;
     Time shows the Trips desk only.
   - New trip "Goa — Mehta family", 4 pax, regime 5 %; add a hotel booking (cost ₹42,000) and a cab; sell ₹60,000 →
     margin shown.
   - "Bill" → draft with one package line at 5 % and the declaration. Enter the hotel's bill tagged to the trip → ITC
     not eligible prefilled.
   - An old Demo invoice renders unchanged. F1 opens help.
3. **R15-C:**
   - *Agent* profile: two domestic economy tickets (basic ₹4,200 each) + ₹300 fee each, deemed method → service value
     ₹420, GST ₹75.60. GSTR-1 shows taxable ₹420 and no nil row for the fares. The e-Invoice JSON keeps the fares in
     `OthChrg`.
   - Import a 4-row BSP file → 2 matched, 1 ADM ₹3,500, 1 refund to pass on → "make bill" creates the purchase bill.
   - Cancel one ticket: airline refund less ₹3,000, our fee ₹500 → credit note + fee line at 18 %; the trip shows the
     loss.
4. **R15-D:**
   - Outbound Dubai package dated 10 May 2026, ₹3,40,000 → TCS 2 % = ₹6,800, label "Sec 394(1) Sl. 8". The TCS register
     shows the row.
   - The same package dated 10 Feb 2026 for ₹12 lakh → 5 % on ₹10 lakh + 20 % on ₹2 lakh.
   - Inbound tour for a foreign agent → chip "POS India — not an export".
   - Wedding: budget ₹18 lakh, six vendors → the events view shows over-budget decor. The manpower vendor's bill hints
     the contractor limb (date ≥ 1 Apr 2026). An unregistered client with a Jaipur venue → POS Rajasthan.

---

## 8. Open questions — with the default the builders will use

The owner asked for no questions, so each one has a default that the packages implement. A CA answer later changes a
dated rule row or a setting default, never the design.

| # | Question | Default chosen | Why |
|---|---|---|---|
| 1 | New business type or a sub-profile? | `service_kind: 'travel'` + `travel_kind`, under `services`. | Zero shell bytes; the R10 / R14 pattern. |
| 2 | Where do the screens live? | One desk tab `trips` on `/time` with five views. | Lean (R14 had six desks); `/time` is the services home; no `PACK_ROUTES` row. |
| 3 | Trip storage | Trip = cost centre + `CostCentre.tv`; components in `travel_bookings`. | Cost-centre P&L, budgets and reports already work; one small table. |
| 4 | Hindi out of the lazy chunks? | **Not in Round 15.** The measurement is reported (≈ 440 kB gz); the lead decides whether English installs may skip Hindi chunks (Hindi then needs one online visit after switching). | Changes offline behaviour; no budget need this round after A1. |
| 5 | Entry-chunk budget after A1 | Raise to 100 kB; initial (185) stays the hard limit; ≤ 5 initial files. | The entry chunk now *is* the first-paint app code. |
| 6 | Netting marker | Reuse `exchange_purchase_id` (no new marker). | R9 / R12 precedent; `movedNoCash` and postings already right. |
| 7 | Netting party match | Same name or GSTIN, or a hand link `Vendor.client_id`. | Parties are sub-ledgers by name; a hand link covers spelling differences. |
| 8 | Clerk netting | Always to the approval queue (cap ₹0 by default). | Moves two parties' balances; owner sees it first. |
| 9 | Tour-operator regime per company or per trip? | Per trip, with a company default; mixing on one invoice warns. | Sources describe both as options; consistency is the CA's call (TV9). |
| 10 | ITC on 5 % trips | Prefilled "not eligible" on bills tagged to the trip; override with an audited reason; month-end list of overrides. | The condition of Sl. 23(ii) (TV8); inputs of another tour operator stay eligible. |
| 11 | Air-ticket valuation | Deemed (Rule 32(3)) by default for `agent`; actual selectable; per invoice override. | The option belongs to the agent; deemed is common in practice (TV11). |
| 12 | Fee above the deemed value | Keep the deemed value; show a "check with your CA" note. | Rule text is an option; sources do not settle it (TV11). |
| 13 | Airline GST collected through the agent | Shown on the ticket row; part of the pure-agent recovery; never our output tax. | It is the airline's supply. |
| 14 | Statement storage | Rows inside one `supplier_statements` row (≤ 2,000; split by month). | No per-ticket table (volume). |
| 15 | Statement posting | Nothing posts until "make bill". | Matching is a check; the bill is the accounting event. |
| 16 | Cancellation fee rate | Rate of the principal supply (5 % in `to5`, 18 % for agency fees; hotel band for a retained hotel charge billed as principal). | Circular 178/10/2022 as reported (TV15). |
| 17 | TCS base | Invoice total incl. GST by default; switch to taxable value in settings. | No settled source (TV6); the conservative base. |
| 18 | Stand-alone overseas ticket or hotel | No TCS, with a note; user may override. | CBDT clarification as reported (TV4). |
| 19 | Non-resident buyer | Prompted; no TCS when ticked "non-resident, not in India". | CBDT notification as reported (TV5). |
| 20 | TCS slab years (2023-26) | Buyer's FY aggregate of earlier flagged invoices; split on the crossing invoice. | Matches the "aggregate of amounts" wording (TV2). |
| 21 | Collection code for 27EQ / Form 143 | Blank with "to confirm" until TV7 is answered. | No source found; a wrong code fails the FVU. |
| 22 | Inbound tours for foreigners | Taxable, POS India; never auto-zero-rated. | Sec 13(3)(b) as recalled (TV19). |
| 23 | Foreign DMC bills | Suggest "no import RCM" only; existing default unchanged. | L confidence (TV20). |
| 24 | Event POS | Sec 12(7)(a) by registration and venue State. | As recalled; one source differs (TV21). |
| 25 | Manpower TDS | Contractor limb from 1 Apr 2026 (hint only). | Finance Bill 2026 / Memorandum, cl. 78 (TV23). |
| 26 | Passport data | Not stored. | DPDP minimisation; not needed for invoices or returns. |
| 27 | Budget overrun | A package at its cap drops items in §3's cut order; no extension. | R13 / R14 overran 2.1–2.5 ×. |

---

## 9. CA review items (TV1–TV31) — for `docs/CA_REVIEW.md` §15

★ = changes what a document prints or a return reports. The defaults are those of §8.

| Id | Question for the CA | Default in the app |
|---|---|---|
| TV1 ★ | Confirm the enacted Sec 394(1) Table Sl. No. 8 (Finance Act 2026): 2 % on overseas tour packages from 1 Apr 2026, no threshold. | 2 % flat from 2026-04-01 (`verified: false` until the Act text is read) |
| TV2 | Confirm the history rows: 5 % from 1 Oct 2020; 5 % / 20 % above ₹7 lakh from 1 Oct 2023; ₹10 lakh from 1 Apr 2025; per buyer per FY. | As listed |
| TV3 ★ | 2025-Act label for tour packages: Sl. No. 8 (LRS Sl. No. 7). | Sl. 8 for tour packages |
| TV4 | Is a stand-alone international air ticket or a stand-alone overseas hotel booking outside "overseas tour programme package"? Is a package with travel + stay always inside? | No TCS on stand-alone items, with a note |
| TV5 | Non-resident buyer exclusion (notification and conditions); the 2025-Act no-PAN rate for Sl. 8. | Prompt; no-PAN = max(2 × rate, 5 %) from 2026 |
| TV6 | TCS base: invoice total incl. GST or taxable value? | Total incl. GST (setting) |
| TV7 ★ | Form 143 / 27EQ collection code for tour packages (and re-check `6CQ` for 1G LRS). | Blank, "to confirm" |
| TV8 ★ | N 11/2017-CT(R) Sl. 23(ii) after N 15/2025-CT(R): rate, ITC condition (input tour-operator services allowed?), invoice wording, definition of tour operator. | 5 %, ITC blocked except input tour-operator services, gross-amount declaration |
| TV9 | May one operator use 5 % for some packages and 18 % for others? Mixed lines on one invoice? | Per trip; warning on mixing |
| TV10 | Exemption for tour-operator services to a foreign tourist for a tour wholly outside India: entry number and conditions. | `exempt_outside` regime, Table 8 exempt column |
| TV11 ★ | Rule 32(3) for air travel agents: 5 % / 10 % of basic fare; "basic fare"; whether the agent's fee above that is also taxable; SAC. | Deemed default; fee inside the deemed value; SAC 998551 |
| TV12 | Air fare rates passed through (economy 5 %, other 18 % from 22 Sep 2025); cut-over by booking or travel date. | Shown on ticket rows as the airline's tax |
| TV13 | Hotel bands for packages (≤ ₹7,500 5 % no ITC). Cross-ref R7 HT items. | Existing `hotel-rules.ts` |
| TV14 | Rule 33 for visa / embassy fees, insurance premium, airport taxes and venue payments on behalf. Cross-ref PS3. | R14 checklist guard |
| TV15 ★ | Cancellation charges (Circular 178/10/2022): rate of the principal supply for our cancellation fee in each regime; supplier charges retained. | As §8 Q16 |
| TV16 | Commission / PLB from airlines and hotels: GST at 18 % to the principal; 194H expected. | As stated |
| TV17 | Insurance agent's commission: RCM by the insurer; registration of an agent making only RCM supplies. | Outward RCM flag on the insurer's invoice |
| TV18 | POS for tour-operator services to Indian clients (Sec 12(2)); hotel components (Sec 12(3)); property outside India. | Chip as §4 D2 |
| TV19 ★ | Inbound tours for foreign tourists performed in India: POS India, not an export? | Taxable, POS India |
| TV20 | Foreign DMC services performed abroad for an Indian operator: import RCM or out of scope? | Suggest "no RCM"; default unchanged |
| TV21 ★ | Sec 12(7)(a) for event organisers: registered → recipient; unregistered → venue State; event abroad. | As stated |
| TV22 | Event management SAC and rate (998596, 18 %). | As stated |
| TV23 ★ | Supply of manpower as "work" from 1 Apr 2026 (Sec 402(47), Sec 393(1) Sl. 6(i)); artists under Sl. 6(iii). | Hints only |
| TV24 | e-Invoice thresholds unchanged in 2026 (₹5 crore; 30-day rule at ₹10 crore)? | Existing behaviour |
| TV25 | IMS / 3B auto-population status in 2026 (ITC lock?). | No change |
| TV26 | Netting: any GST or TDS effect when a receivable and a payable of one party are set off by journal (none expected)? Presentation on the ledgers. | Journal via the no-cash receipt; TDS untouched |
| TV27 | Netting with a party under RCM or TDS on the bill: allowed after RCM is paid / TDS deducted? | Refused while RCM is unpaid; TDS untouched |
| TV28 | ITC override on a 5 % trip: is any input (e.g. office rent) affected, or only the trip's inputs? | Only bills tagged to the trip |
| TV29 | Trip-margin presentation for a tour operator in the books (gross vs net of pass-through)? | Gross sales and purchases (as invoiced); pure-agent recoveries gross (expense + recovery), as today (R14 PS3 decision) |
| TV30 | Cancellation loss vs cost of sales in the P&L. | "Cancellation losses" expense |
| TV31 | (Market) No reliable count of travel agencies / tour operators in India was found; IATA / TAAI / IATO / OTOAI membership numbers if useful. | — |

---

## 10. Test plan (summary)

| Layer | What | Where |
|---|---|---|
| Unit (node:test) | Every engine in `src/lib/travel/` and `src/lib/netting.ts`; rule rows by date (`tv-rules` also checks the import graph: `travel-rules.ts` reachable only from lazy modules); registry maps; pack gate; snapshot print compare; purchase contract; no-cash readers (netting) | `tests/tv-*.test.ts`, `tests/netting.test.ts`, `tests/audit-coalesce.test.ts`, `tests/bundle-config.test.ts` |
| Volume | 20,000 tickets + 26 statements: one statement match reads only its period ± 45 days; trip-margin month reads only that month's trips; audit writes per save = 1 | `tests/tv-match.test.ts`, `tests/tv-trips.test.ts`, `tests/perf.test.ts` |
| Statutory regression | TCS rows at 2023-09-30 / 2023-10-01 / 2025-03-31 / 2025-04-01 / 2026-03-31 / 2026-04-01; air value at 5 % / 10 %; regime rates before / after 2025-09-22; manpower hint before / after 2026-04-01 | `tests/tv-tcs.test.ts`, `tests/tv-air.test.ts`, `tests/tv-regime.test.ts`, `tests/tds-rules.test.ts` |
| Existing suites | Must pass unchanged: `rt-buyback*`, `ag-cycle*`, `ps-disb*`, `gst-reports*`, `einvoice*`, `tds-payables*`, `hotel*`, `help-registry`, `docs-links`, `i18n-areas`, `industry-packs` | — |
| E2E | §7, appended `step(...)` blocks; plus the full existing smoke after A1 | `tests/e2e/smoke.mjs` |
| Offline | `npm run verify:offline` after A1 and after the last merge | `scripts/verify-offline.mjs` |
| Size | `npm run check:size` per commit; numbers in `docs/features/travel-r15.md` per package | `scripts/check-bundle-size.mjs` |

---

## 11. Size budget per package (gz)

| Package | First paint | Total (cap) | Planned split | Stop rule |
|---|---|---|---|---|
| R15-A | **−2.3** (A1, measured) / ≤ +0.1 (A2) | **−43.4** (A1, measured) / ≤ +4 (A3) / ≤ +1 (A4) | Netting dialog 2.0, `netting.ts` 0.9, strings 0.6, rows / palette 0.5; A4 rows 0.6 | A1 below −30 kB → stop and report before B. A3 at 4 kB → cut 2 |
| R15-B | ≈ +0.005 (`tv`) | **≤ 14** | Desk + 2 views 5.0, engines (trips, bookings, costing, bill, regime, itc) 3.5, strings 1.2, picker 1.0, paper part 1.0, rows 1.0, help / palette / checklist / packs 0.8, demo 0.5 | At 14 kB → cuts 3, 4 |
| R15-C | 0 | **≤ 11** | Statements view + match 3.5, ticket rows + value 2.2, cancel dialog + engine 2.2, statement bill 0.9, strings 1.0, commission 0.7, help 0.5 | At 11 kB → cuts 1, 2, 3 |
| R15-D | 0 | **≤ 9** | Events view + engine 3.0, TCS view + engine 2.5, POS chip 0.8, TCS line 0.4, strings 1.0, rules 0.6, help 0.5 | At 9 kB → cuts 1, 2 |
| **Round** | **net ≈ −2.2** | **gross ≤ +39, net ≈ −4** | — | Total must stay ≤ 3,500 kB at every merge (it will be ≈ 3,420 kB) |

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A1's saving shrinks or breaks after other changes land (rolldown RC behaviour, a new first-paint module that is also dynamically imported) | M | M | A1 merges first, measured on its commit, with a stop rule (< 30 kB → report). `tests/bundle-config.test.ts` pins the config. The e2e and offline suites ran green on the exact config |
| A1 changes chunk names other docs or headers rely on | L | L | Vendor names kept; `_headers` / precache use globs (`gen-precache.mjs` lists files) |
| Feature packages overrun again (R13 2.5 ×, R14 2.1 ×) | **H** | M | Hard caps with a pre-ranked cut list; one desk, five views; strings shared through one area; no stubs; numbers per commit. Even at 2 × the gross (78 kB) the round lands near 3,460 kB < 3,500 thanks to A1 |
| Audit coalescing loses an event on a crash or reorders the chain | L | **H** | Microtask flush within the same task; flush before backup / sync / auditor pack / unload; chain and order tests; segment format unchanged |
| Netting double-counts or leaves a bill open | M | H | Derived roll-up (`exchangeSettled`) instead of stored flags; all-or-nothing transaction; tests on both ledgers and the TB; refusal for URD / RCM-unpaid / currency mismatch |
| Statutory values wrong (most are `verified: false`) | M | H | Dated, append-only rows; every output labelled "verify with your CA"; TV1–TV30 for the CA; nothing auto-files |
| TCS base / code uncertainty fails a Form 143 upload | M | M | Code blank until TV7 is answered; base is a visible setting |
| Tour-operator 5 % misuse (ITC claimed) | M | H | Prefilled "not eligible" on trip bills; override needs a reason (audited); month-end list |
| Statement formats vary by consolidator | H | L | Generic mapper with remembered mappings; BSP preset only; nothing posts until "make bill" |
| Personal data (passenger names, PANs) | L | M | No passport / DOB fields; device-local; DPDP note in the help |
| The travel profile clutters other service companies | L | L | Pack-gated tab, tables not read while off (`tv-pack-gate`), `travel_kind` absent = today |
