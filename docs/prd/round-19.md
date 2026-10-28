# PRD — Round 19: freight forwarders, customs brokers (CHA), courier franchises and 3PL warehouses (job files, freight billing, disbursements)

Status: draft for build · Drafted 2026-10-28 · Baseline: branch `claude/elegant-cannon-cwapiv` at `1fffeba`. Merged on
the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–21, Rounds 7–18 (R18-A … R18-D and the QA21 fixes). No other round
is being built in parallel.

Companion documents:
- `docs/CA_REVIEW.md` §19: the CA items **LG1–LG44** (§9 of this PRD). The lead copies them there when the PRD is
  accepted, and the total moves from **685 to 729**. `LG` ("logistics") is a new prefix. The prefixes in
  `docs/CA_REVIEW.md` rows on `1fffeba` are AC, AG, CN, G, HS, HT, I, MF, MP, P, PF, PS, RT, SV, T, TR, TV, X; older text
  also uses `A B C D H M Q R S`. **`LG` ends in `G`:** `CA_LIST_RE` in `tests/docs-links.test.ts` has no `\b`, so
  without `LG` in the alternation `LG1` would be read as `G1`. A adds `LG` to all three regexes and a test that `LG1`
  is read whole and never as `G1` (§4 conventions).
- Sources: §2.8. **P** = primary text read this round (file downloaded and read, or page fetched), **S** = secondary
  source (press, practitioner article, search-result extract), **V** = vendor's own claim.
- Round 18 (`docs/prd/round-18.md` §1.1, §2.2) ranked logistics next (value 3, effort M, "house-bill margin, CHA
  disbursements"). Round 5 (R5-B) built the **road GTA** side (LR / bilty, GTA option, freight bills, trips, lorry
  hire); this round builds what sits around it and is not road trucking.

Every item follows `AGENTS.md`:
- **Local-first and serverless.** No ICEGATE, e-Sanchit, shipping-line, airline, courier-network, tracking, port
  community, GST-portal or bank call. Numbers the user gets from those systems (shipping bill, bill of entry, MBL /
  MAWB, container, ICEGATE challan) are **typed or imported from a file**.
- **Styling.** Vanilla CSS Modules with tokens. Templates use the `accent` variable only (Critical Rule 5).
- **Invoice snapshots never change.** Everything a logistics document prints is snapshotted on the document (`lg`).
- **Numbering.** Indian-FY numbering. Round 19 adds **one series**, `JOB` (job files, `JOB/FY26-27/0001`, branch
  prefix allowed through `series-counters`). Invoices use the existing tax-invoice / invoice / debit-note series;
  courier dockets and house bills keep the numbers printed on them (typed, unique per company).
- **Dates.** Bare dates are parsed as local days. A manifest / storage period is `YYYY-MM`.
- **Statutory values.** Date-keyed and append-only, in a lazy rule file. A row is `verified: true` only when its value
  was read in a primary text this round (the R15–R18 rule). A recommendation (57th GST Council) is a
  `pending-changes.ts` note, never a rule row.
- **Outputs are working papers.** GST, income-tax, customs-broker and FEMA outputs carry "verify with your CA"
  (Critical Rule 10). Place-of-supply and pure-agent checks are hints with the reason shown, never blocks.

---

## 1. Problem statement

### 1.1 Which segment is left, and why this one

| Candidate | What the app already has | Left over | Verdict |
|---|---|---|---|
| **Freight forwarders, customs brokers (CHA), courier franchises, 3PL warehouses** | R5-B road GTA (LR, GTA option, freight bills, trips, lorry hire, 194C(6)); pure-agent lines (`charge_head_id: 'rule33'`, R8 / R14); foreign-currency documents and the dated currency master (3.4, 8H); FX gain / loss; netting with a party that is both client and vendor (R15-A); supplier statements import and match (R15-C); advances with a `pass_through` flag (CN-C2); LUT register, export register, BOE duty sheet (R4-C); intermediary place-of-supply rule (R14 `INTERMEDIARY_POS_RULES`); e-Way desk; `issueBatch` / `saveMany` | A **job file** (shipment) that every invoice, bill, disbursement and deposit hangs on; **place of supply per charge head** (Sec 12(8) proviso → POS 96 for export freight, Sec 13(2) after 13(9) went); rates by mode (vessel 5 %, air 18 %, multimodal 5 % / 18 %, courier 18 %, C&F / CHA 18 %); **customs-duty disbursements and client duty deposits**; overseas-agent accounts in USD; job profit; courier manifests by chargeable weight; storage billing | **Chosen** |
| Automobile dealers and multi-brand service centres | 206C(1F) motor-vehicle TCS (`TCS_1F_RULES`, Sec 394 Sl. 6 labels); R9 used-goods margin scheme (`used` godown, buy-back); R9 IMEI / serial tracking; R10 workshop jobs, estimates, motor insurance claims (`sv-motor-claims.ts`); pure-agent lines for RTO / registration | OEM incentive and trade-scheme credit notes, booking advances by chassis, insurance / finance payout commissions (insurance-agent RCM), demo-vehicle capitalisation, compensation-cess credit stuck after 22 Sep 2025 (S) | Mostly covered; value 2 |
| SaaS / subscription and usage billing | Recurring schedules (draft / issue), deferrals (R2-C), R14 `svcexport` desk (LUT, Rule 89(4) refund, FEMA realisation, EDF), retainers | Proration on plan change, metered usage, MRR / churn metrics | Gap is commercial, not statutory; small user base among this app's users; value 2 |
| Coaching institutes / hostels | R5-C fee plans and fee runs, R10 SV-C classes, memberships, **coaching refund** (`sv-coaching-refund.ts`), common credit | Hostel room allotment; accommodation exemption ≤ ₹20,000 / month / person (S) | Mostly covered; value 2 |

**Why this segment.**
1. **Size and need.** India's customs brokers alone are reported at **≈ 6,500** members of FFFAI's 31 associations
   (S, FFFAI AGM Sept 2025); freight forwarders, NVOCC agents, air-cargo agents, courier franchisees (DTDC / Trackon /
   Professional-type franchise counters) and small 3PL / bonded warehouses run in every port, ICD and city. Every one
   bills per **job**, pays large sums on the client's behalf (customs duty, CFS, port, shipping-line charges), and bills
   freight in USD. The money passing through is often 5–20 × their own fee.
2. **The leaders are cloud ERPs priced per user and still leave GST working to the accountant.** Indian forwarding
   ERPs (Siri Global Tech, BlueLogis FX, Shipmnts, FreightSetu, Rapportsoft) advertise ICEGATE links, GST e-invoices,
   job profitability and Tally posting (V); Shipmnts lists ₹3,500–6,000 per user per month (V). None of the pages read
   this round documents disbursement / duty-deposit tracking or the post-2023 place-of-supply rules (§2.1). Small
   forwarders and CHAs therefore bill from Excel / Tally and track duty money in a separate sheet.
3. **The app already holds most of the hard parts.** Pure-agent lines that GSTR-1 / e-Invoice / e-Way leave out,
   `rule33` recoveries left out of turnover (`recoveryValue`, QA17), FX documents and rate master, FX gain / loss,
   netting, statements import / match, pass-through advances, LUT and export registers, the intermediary rule, GTA
   rows. Round 19 is the job file, the per-head place-of-supply / rate engine, the disbursement and deposit ledger per
   job, agent accounts, and two volume billers (courier manifests, storage). That fits ≤ 40 kB.
4. **The law moved for exactly these businesses, and nothing in the app carries it yet:**
   - **1 Oct 2023:** Sec 13(9) IGST (cross-border transport of goods → destination) **omitted** (Finance Act 2023
     s.162); POS is now the default Sec 13(2), the recipient's location, for transport of goods and for mail / courier
     (Circular 203/15/2023-GST, **P**).
   - **Sec 12(8) proviso** (from 1 Feb 2019): export freight supplied by an Indian forwarder to an Indian exporter has
     its POS at the **foreign destination**, IGST is charged, the recipient may take ITC, and GSTR-1 reports POS
     **"96-Foreign Country"** (Circular 184/16/2022-GST, **P**).
   - **22 Sep 2025:** multimodal transport 5 % (no air leg; ITC only on transport inputs, capped at 5 %) or 18 % (an
     air leg); GTA option 18 % with ITC (was 12 %); courier / postal / local delivery 18 % (N 15/2025-CT(R), **P**).
   - **30 Mar 2026:** Sec 13(8)(b) IGST omitted — intermediary services follow Sec 13(2) (Finance Bill 2026 cl. 141,
     **P** as introduced; enactment and date **S**). Commission from overseas principals / shipping lines can now be an
     export of services.
   - **8 Oct 2026:** the 57th GST Council recommended 5 % without ITC for delivery services through e-commerce
     operators under Sec 9(5), courier and postal excluded (S) — a pending note, not a rule.

### 1.2 What a forwarder / CHA cannot do in the app today

Checked against the code at `1fffeba` (§2.6):

1. **No job file.** R5-B has LRs and trips (road). A shipment job needs mode (sea FCL / LCL, air, road, rail,
   multimodal, courier), direction (export / import / domestic / cross-trade), incoterm, ports / airports, MBL / HBL,
   MAWB / HAWB, containers, shipping bill / bill of entry numbers and dates, weights (gross, chargeable, CBM), the
   client (shipper / consignee), the overseas agent and the vendors (shipping line, airline, co-loader, CFS,
   transporter). Every invoice, bill and payment of the job must point at it.
2. **No place of supply per charge head.** An invoice has one `place_of_supply`. A forwarder's export job is two
   supplies: export air freight (POS 96, IGST, Sec 12(8) proviso) and local handling / clearance (POS = the client's
   State, CGST + SGST). Nothing splits them or explains why.
3. **No mode rates.** The editor offers slabs, not "vessel 5 % (ITC on goods other than ships not taken)", "air 18 %",
   "multimodal 5 % / 18 %", "C&F / CHA 996712 / 996713 18 %", "storage 996729 18 %", "agri-produce storage exempt".
4. **No customs-duty disbursement ledger.** CHAs pay duty through ICEGATE on the importer's behalf, plus CFS, port,
   DO and shipping-line charges in the importer's name, and recover them at actual (Rule 33). R14 PS-B1 has
   disbursements for law firms (`ps-disb.ts`), but no job link, no duty deposit, no "unrecovered by job" list.
5. **No duty deposits.** Importers send duty money in advance; it is not an advance for the CHA's own supply (no GST),
   it is applied to the reimbursement bill, and the excess is refunded. `advances.ts` has `pass_through` (CN-C2) but no
   job.
6. **No job profit.** Revenue by job, cost by job (vendor bills, accruals for bills not yet received), recoveries
   outside both, margin by job / lane / client / salesperson.
7. **No overseas-agent account.** Profit-share and freight debit / credit notes in USD with each overseas agent,
   settled net by an agent statement; FX gain / loss on settlement.
8. **No courier manifests.** Account customers of a courier franchise are billed monthly from hundreds of dockets
   priced by chargeable weight (actual vs volumetric) and zone, with COD collected on the shipper's behalf.
9. **No storage billing.** A 3PL / CFS / small warehouse bills per pallet / sq ft / CBM per day plus handling in / out;
   agricultural produce storage is exempt (Sl. 54(e)); goods held are the client's, not stock.

### 1.3 How the logistics profile switches on (no clutter for others)

- **No new `BusinessType`.** `shop-mode.ts` (first paint) is untouched. The profile is a **wizard card** (the R12 / R13
  / R18 pattern), "Freight forwarding, customs clearance, courier or warehouse", that sets business type
  **`transport`** (its preset already has purchases, accounts, banking, reports, GST, TDS, payroll, loans) and writes
  **explicit** `modules` (the preset ∪ `time`, so `/time` — where job desks live, R14 / R15 / R17 — is visible without
  touching `PACK_ROUTES`) and an **explicit** `industry_packs` list (so the R5-B `transport` pack is not switched on by
  the type unless the user ticks "We also run our own lorries / issue LRs").
- Settings field **`logistics_kind`** (additive; the R12 `agri_kind` … R18 `society_kind` approach):

  | `logistics_kind` | Who | Packs | Lands on | Why |
  |---|---|---|---|---|
  | `forwarder` | Freight forwarder / NVOCC agent / air-cargo agent | `logistics` | `/time?tab=shipments&view=jobs` | Jobs, freight billing, agents |
  | `cha` | Customs broker (CBLR 2018 licence) | `logistics`, `customs` | same | + duty deposits, disbursements, CB register |
  | `courier` | Courier franchisee / booking agent | `logistics`, `courier` | `/time?tab=shipments&view=courier` | + manifests, COD |
  | `warehouse` | 3PL / CFS / small warehouse | `logistics`, `warehouse` | `/time?tab=shipments&view=storage` | + storage billing |
  | `multi` | Forwarder + CHA (+ courier / warehouse ticked) | `logistics`, `customs` (+ ticked) | jobs | The common Indian combination |

  "We also run our own lorries" adds the existing `transport` pack (R5-B) to the list.
- **Four new packs** `logistics`, `customs`, `courier`, `warehouse` in `industry-packs.ts` (lazy; `PackId` is a type,
  zero bytes). `PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE` and `PACK_ROUTES` are unchanged.
- **Placement: one desk, never a new route or sidebar item.**
  - One new row in `TIME_TABS` (`page-tabs.ts`): `{ id: 'shipments', pack: 'logistics', alsoPacks: ['customs',
    'courier', 'warehouse'] }` (the R15 `trips` / R17 `deploy` precedent: job-based service desks live on Time).
  - The desk `components/logistics/ShipmentsDesk.tsx` is mounted from `Time.tsx` by file name through `import.meta.glob`
    over `components/logistics/*Desk.tsx` (the R14 `PS_DESK_FILES` / R15 `TV_DESK_FILES` precedent in `Time.tsx`).
  - **Eight views** in `&view=`: `jobs`, `rates` (A), `billing`, `costing` (B), `customs` (C, pack `customs`),
    `agents` (D), `courier` (D, pack `courier`), `storage` (D, pack `warehouse`). A view whose pack is off is not
    listed (its URL still opens it).
  - Existing tabs gain a pack in `alsoPacks` where they serve it: the R14 `exportsvc` tab (`/time?tab=exportsvc`, LUT /
    realisation / refund) gains `logistics` (agency commission and freight billed to overseas agents are exports of
    services). No other page changes.
- Settings → Features shows a **"Logistics profile"** row for every `transport` company (and "Custom"). Turning a
  pack off deletes nothing.
- The **job paper block** (A4) is not pack-gated: it prints whenever a document carries the `lg` snapshot.

### 1.4 Budgets the round must respect

Baseline: the lead's measurement on `1fffeba` (first paint **182.7 kB**, core **≈ 3,195 kB**); the R18-D notes in
`docs/features/society-r18.md` record 182.3 / 3,168.5 kB raw before the QA21 fixes. The PRD author did not rebuild;
**R19-A measures the baseline before its first commit** and records it in `docs/features/logistics-r19.md`.

| Budget | Now | Limit | Headroom | Round 19 share |
|---|---|---|---|---|
| Initial JS (first paint) | **182.7 kB** | 185 kB | 2.3 kB | **0** (the `lg` record-key token lands in the lazy `invoice-defaults` chunk, as `hs` did) |
| Entry chunk | ≈ 88 kB | 100 kB | ≈ 12 kB | 0 |
| Core precache (English) | **≈ 3,195 kB** | 3,300 kB | ≈ 105 kB | **≤ 40 kB gross for the whole round** (A ≤ 11, B ≤ 10, C ≤ 9, D ≤ 9; 1 kB reserve held by the lead) |
| Hindi pack | ≈ 349 kB | 400 kB | ≈ 51 kB | ≤ 8 kB (`lang-hi-logistics` family pack) |
| Hindi left in English chunks | ≈ 21.5 kB | 36 kB | ≈ 14.5 kB | **0** (literal `defineArea(en, hi)` everywhere) |
| `lazy-leaves` | ≈ 17.4 kB | 20 kB | ≈ 2.6 kB | ≤ 0.3 kB (`lg-registry.ts` only; everything else in `f-logistics`) |

After this round the core headroom is ≈ 65 kB: the lead should plan Round 20 with a smaller cap or a size round.

Calibration (English only): R18-C **+6.07 kB** for 4 items (cap 9), R18-D **+6.31 kB** for 4 items (cap 9); R17-C + D
+11.3 kB for 7 items. So **≈ 1.5–2.5 kB per item with a view, ≈ 0.8–1 kB per engine-only item**. Round 19 plans
**16 items** with a pre-ranked cut list per package (§3). A package that reaches its cap cuts; it does not ask.

Rules:
- **First paint.** Nothing. `store/invoice-defaults.ts` (the `lg` token), `industry-packs.ts`, `page-tabs.ts`,
  `Time.tsx`, `TemplateEngine.tsx`, `NotificationBell.tsx` are lazy on `1fffeba` (A re-checks `build-meta/chunks.json`:
  the initial files are `index`, `rolldown-runtime`, `vendor-react`, `vendor-ui`). No `PACK_ROUTES`, `PACK_OF_TYPE`,
  `TABLE_ACTIONS`, `WATCHED_TABLES`, `no-cash.ts`, `tax-rules.ts`, `tds-rules.ts`, `ita2025.ts`, `shop-mode.ts`,
  `dates.ts` or shell edit. Any new lucide icon is refused (§1.5).
- **Family chunk group.** A adds **one row** to `vite.config.ts`:
  `safeFamilyGroup(graph, 'f-logistics', familyRe('logistics', 'logistics-rules', 'logistics-r19', 'lg-registry'), 12)`
  and the name to `tests/bundle-config.test.ts` (the R18 test shape: the regex captures
  `src/lib/logistics/lg-job.ts`, `src/lib/logistics-rules.ts`, `src/i18n/areas/logistics-r19a.ts`; not `lg-registry.ts`
  and not `-pick` areas).
  - A module joins only if every static import is first paint, vendor or another safe member
    (`scripts/vite-safe-groups.mjs`). **Engines in `src/lib/logistics/` import only first-paint modules (`storage`,
    `invoice-calc`, `tax-rules` `ruleAt`, `dates`, `access`, `localDb` …), `logistics-rules.ts` and each other.**
  - Shared lazy code is reached only through **bridge modules `lg-*-io.ts`** (≤ 4), which stay outside the group:
    - `lg-issue-io.ts` — `localDb.invoices.save` / `saveMany`, `series-counters` (`JOB`), `trade/pure-agent.ts`
      (`PURE_AGENT_CHARGE`, `isPureAgentLine`, `recoveryValue`), `fx.ts`, `currency-rates.ts` `rateOn`;
    - `lg-books-io.ts` — `purchase-normalize.ts` `readPurchase`, purchase tagging, manual vouchers (accrual / reclass
      journals), `fx-gain.ts`, `netting.ts`, `travel/tv-statements.ts` readers (agent statements);
    - `lg-tax-io.ts` — `prof-rules.ts` `intermediaryPos`, `prof/ps-export-check.ts`, `transport-works-rules.ts`
      `gtaRate` / `gtaSac`, `tds-rules.ts`, `ita2025.ts` labels, `trade/lut-register.ts`;
    - `lg-recv-io.ts` — `advances.ts` (`saveAdvance` with `pass_through`, `applyAdvance`, `refundAdvance`), statements,
      reminders, the bell gate helper.
    Engines take their data as arguments.
  - After each package `build-meta/chunks.json` must show `f-logistics` holding every engine and the rules module; a
    test in `tests/lg-rules.test.ts` reads the family regex and the import graph.
- **Hindi.** One area per package, each `defineArea(en, hi)` with a **literal** Hindi object: `logistics-r19a.ts` …
  `logistics-r19d.ts`, ≤ 1.1 kB gz English each. Shared words (job, shipment, mode, sea, air, container, shipper,
  consignee, agent, freight, duty, deposit, disbursement, chargeable weight) live once in `logistics-r19a.ts`. The split
  puts them in `lang-hi-logistics`.
- **Help** ≤ 160 characters per topic per language; statutory detail by CA id (`ca: ['LG2']`).
- **Rule data is a chunk.** Statutory values go in **`src/lib/logistics-rules.ts`** (new), imported only by lazy
  logistics modules, never by `tax-rules.ts`, `tds-rules.ts`, `shop-mode.ts` or the shell. Values that already live
  elsewhere stay there and are reached through `lg-tax-io.ts`: GTA rates (`transport-works-rules.ts`), the intermediary
  rule (`prof-rules.ts`), TDS sections and 194C(6) (`tds-rules.ts`), Act labels (`ita2025.ts`), GST slabs
  (`tax-rules.ts`).
- **No new shared components, no stubs.** Reuse `LinesGrid`, `ItemFilterBar`, `controls.module.css`, the R15 `useRun`
  pattern, `escHtml` for every print window, `csv.ts` / dynamic `xlsx.ts` with `import-mapping.ts` for job and docket
  imports, `localDb.invoices.saveMany` for every batch, the R15-C statement importer for agent statements.

### 1.5 Icons

Every lucide icon is in the first-paint `vendor-ui` chunk; reuse only. Files importing each on `1fffeba` (single-line
import grep; multi-line imports add more): `Truck` 17, `Package` 13, `FileText` 13, `Landmark` 12, `Scale` 11,
`Receipt` 10, `Wallet` 10, `ClipboardList` 9, `Boxes` 6, `Globe` 4, `ArrowLeftRight` 4. The desk uses `Truck` (jobs),
`ClipboardList` (rates), `Receipt` (billing), `Scale` (costing), `Landmark` (customs), `Globe` (agents), `Package`
(courier), `Boxes` (storage), `Wallet` (deposits). **`Ship`, `Plane`, `Container`, `Warehouse` and `Anchor` are imported
nowhere and must not be added.** A re-greps before its first commit and substitutes `Truck` for any name that turns out
not to be imported.

### 1.6 Non-goals

- **Live connections.** ICEGATE / e-Sanchit filing or status, shipping-line / airline / courier-network booking or
  tracking APIs, port community systems, DG Shipping NVOCC registration, payment gateways, GST / TRACES portals.
- **Operational documents with legal effect.** No printable **negotiable house bill of lading** or house air waybill
  (the job stores their numbers; the document comes from the forwarder's own form / system); no shipping bill or bill
  of entry preparation; no checklist upload to ICEGATE.
- **Warehouse management.** No SKU-level stock of client goods, bin locations, pick / pack or barcode scanning for 3PL
  clients (storage is billed on typed occupancy). Bonded warehouse (Sec 58 / 58A Customs Act) registers are deferred.
- **Freight rate procurement.** No rate-request / tender management with carriers, no container tracking, no
  demurrage-free-time calculator beyond a typed amount.
- **Courier operations.** No booking app, label printing for networks, hub manifests or delivery runs; the franchisee's
  monthly account-customer billing and COD settlement only.
- **Deferred:** customs-bonded warehouse, Sec 65 MOOWR, ATA carnets, project cargo, chartering.

---

## 2. Findings

### 2.1 What the leaders offer (research)

| Product | What it does | Gap for this app's users | Source |
|---|---|---|---|
| Siri Global Tech (Siri ERP) | Cloud ERP for Indian forwarders, CHAs and 3PL: ICEGATE / e-Sanchit links, GST invoices with QR, job profitability, Tally posting; minimum three users | Cloud, per-user; no page read documents duty deposits or POS 96 | V slashdot listing; V goodfirms |
| BlueLogis FX | Forwarding ERP with "India GST, TDS, ICEGATE and Tally integration" | Same | V slashdot |
| Shipmnts | Forwarding platform; GST, TDS, e-invoicing; ICEGATE "in development"; ₹3,500–6,000 / user / month (enterprise) | Same; price | V shipmnts.com/llms.txt |
| FreightSetu, Rapportsoft | Forwarder / CHA billing with GST e-invoice | Few details published | V capterra, indiamart |
| Tally Prime | General ledger; job costing through cost centres; third-party CHA add-ons | Disbursements and deposits by hand | S practitioner guides |
| Fretron / Roado (freight billing for manufacturers' road freight) | Road freight billing, trip costing | Road only (R5-B covers) | V fretron.com blog, roado.tech |

### 2.2 Candidate segments scored

| Candidate | Size (as reported) | Already in the app | Value | Effort | Score |
|---|---|---|---|---|---|
| **Forwarders / CHA / courier / 3PL** | ≈ 6,500 customs brokers in FFFAI (S); forwarders, courier franchisees and warehouses in every city | R5-B road, pure agent, FX, netting, statements, LUT / export registers, advances `pass_through`, intermediary rule | **4** | M | **2.0** |
| Automobile dealers / multi-brand service | FADA networks (S) | 206C(1F), R9 margin scheme / serials, R10 workshop / motor claims | 2 | M | 1.0 |
| SaaS / subscriptions | Small among this app's users | Recurring, deferrals, R14 `svcexport` | 2 | M | 1.0 |
| Coaching / hostels | Many | R5-C fees, R10 classes / coaching refund | 2 | S–M | 1.3 |

### 2.3 Anatomy of a forwarder / CHA job (every element needs a place)

| # | Element | Doc / screen | Today | → |
|---|---|---|---|---|
| 1 | Job: mode, direction, incoterm, ports, MBL / HBL, MAWB / HAWB, containers, SB / BOE nos., weights, client, agent, vendors, salesperson, status | Job file | — | A2 |
| 2 | Charge heads with SAC, GST role (own supply / pure agent / exempt), POS rule and default currency; rate sheets per client / lane; quotation → job | Rates | — | A3 |
| 3 | Job reference block on every document (BL / AWB, containers, vessel / flight, ports, weights) | Paper | — | A4 |
| 4 | Billing a job: charge sheet → one invoice per (POS, currency, document kind); pure-agent lines; FX rate | Billing | Manual, one POS per invoice | B1 |
| 5 | POS and rate per head: Sec 12(8) + proviso (POS 96), Sec 13(2) after 13(9), intermediary by date, mode rates, multimodal, GTA leg | Billing | — | B2 |
| 6 | Vendor bills tagged to the job; accruals for bills not yet received; job P&L; unbilled / uncosted jobs | Costing | Cost centres only | B3 |
| 7 | Freight in USD at the Rule 34(2) rate; FX gain / loss on realisation; LUT for exports of services | Billing | 3.4 FX, R14 LUT | B4 |
| 8 | Duty and other payments on the client's behalf (ICEGATE challan, CFS, port, DO), Rule 33 checklist | Customs | R14 disbursements (matters) | C1 |
| 9 | Duty deposits from importers per job; application; refund of the excess | Customs | Advances (`pass_through`) | C2 |
| 10 | Reimbursement bill with the disbursement schedule; ageing; write-off | Customs | R14 (matters) | C3 |
| 11 | CBLR Reg 10(k) job register; client KYC; gross vs net presentation journal | Customs | — | C4 |
| 12 | Overseas agents: USD debit / credit notes, profit share, agent statement, netting | Agents | R15-A netting, R15-C statements | D1 |
| 13 | Courier manifests: dockets, volumetric weight, zone rate card, monthly bill, COD remittance | Courier | — | D2 |
| 14 | Storage billing: pallets / sq ft / CBM × days, handling in / out, agri-produce exempt | Storage | R12 cold store (agri only) | D3 |
| 15 | Alerts and reports: unbilled jobs, unrecovered disbursements, margin by lane / client / salesperson, TDS on receipts | Desk + bell | — | D4 |

### 2.4 Statutory rules (as understood; every row is a CA item)

`verified` follows the header rule: **true only when the value was read in a primary text this round.**

**GST — rates and classification**

| # | Rule | Value used by the app | From | Source read | verified | CA |
|---|---|---|---|---|---|---|
| 1 | Transport of goods in a vessel (Sl. 9(ii), Heading 9965) | 5 % (2.5 + 2.5); ITC on goods other than ships / vessels not taken | 2017-07-01 | **P** N 11/2017-CT(R) as amended to 1 Apr 2019 (CBIC consolidated text, read); not amended by N 15/2025 (**P**, its serial list read) | true | LG6 |
| 2 | Goods transport services other than (i)–(vi) — air freight (Sl. 9(vii)) | 18 % | 2018-07-26 (item renumbered by N 13/2018) | **P** same consolidated text, footnote 61 | true | LG6 |
| 3 | Multimodal transportation (Sl. 9(vi)) | 12 % | 2018-07-26 | **P** consolidated text (N 13/2018 footnote 59) | true | LG6 |
| 4 | Multimodal from 22 Sep 2025: (a) no air leg 5 %, ITC only on transport inputs and capped at 2.5 % + 2.5 %; (b) any air leg 18 %; both only for transport from a place in India to another place in India | 5 % / 18 % by `legs` | 2025-09-22 | **P** N 15/2025-CT(R) ¶(1)(a)(iv)(D) with its illustration | true | LG6, LG7 |
| 5 | GTA (Sl. 9(iii)): 5 % without ITC or, by option, 18 % with ITC (was 12 %) | Existing `GTA_RATE_RULES` (R5-B) | 2025-09-22 | **P** N 15/2025-CT(R) ¶(1)(a)(iv)(A) | true (the R5-B row says "verify"; the lead may flip it, LG8) | LG8 |
| 6 | Transport of goods in containers by rail by others than Indian Railways (Sl. 9(iv)) | 5 % without ITC or 18 % | 2025-09-22 | **P** N 15/2025-CT(R) ¶(1)(a)(iv)(B) | true | LG6 |
| 7 | Postal, courier, local delivery and other delivery services (Sl. 12, Heading 9968) | 18 % | 2025-09-22 (courier 18 % since 2017) | **P** N 15/2025-CT(R) ¶(1)(a)(vi); **P** consolidated Sl. 12 | true | LG18 |
| 8 | Supporting services in transport other than GTA (Sl. 11(ii), Heading 9967): cargo handling, CHA, C&F, storage and warehousing | 18 % | 2017-07-01 | **P** consolidated Sl. 11; not amended by N 15/2025 (**P**) | true | LG5, LG21 |
| 9 | SACs: 996511 road, 996521 coastal / transoceanic water, 996531 air, 996711 container handling, **996712 customs house agent**, **996713 clearing and forwarding**, 996719 other cargo handling, 996721 refrigerated storage, **996729 other storage and warehousing**, 996791 / 996792 GTA, 996799 other supporting transport, **996812 courier**, 996813 local delivery | Head defaults | 2017-07-01 | **P** annexure to N 11/2017-CT(R) (rows 108–164) | true | LG5 |
| 10 | Exempt: GTA transport of agricultural produce and other listed goods (Sl. 21); rail / vessel transport of listed goods (Sl. 20); loading, unloading, packing, storage or warehousing of **agricultural produce** (Sl. 54(e)); of **rice** (Sl. 24) | Head flag `exempt_if: 'agri_produce' \| 'rice'` → exempt line, Bill of Supply when the whole bill is exempt | 2017-07-01 | **P** N 12/2017-CT(R) 2017 text (Sl. 20, 21, 24, 54); later amendments **not read** | true (2017 text); "unchanged in 2026" **false** | LG21 |
| 11 | Delivery services through e-commerce operators: 5 % without ITC under Sec 9(5), courier and postal excluded | **Not a rule row** — `pending-changes.ts` note | recommended 2026-10-08 | **S** taxscan, maritimegateway | false | LG19 |
| 12 | Ocean freight on imports by a foreign shipper to a foreign shipping line (entry 10, N 10/2017-IGST(R)) — RCM on the importer, **omitted from 1 Oct 2023** (N 11–13/2023 as reported) after *Mohit Minerals* (SC, 19 May 2022) | Hint only (import job, CIF): "No IGST on ocean freight under reverse charge for imports from 1 Oct 2023" | 2023-10-01 | **S** vjmglobal, taxmann, KPMG flash | false | LG16 |

**GST — place of supply, value, documents**

| # | Rule | Value used by the app | From | Source read | verified | CA |
|---|---|---|---|---|---|---|
| 13 | Sec 12(8) IGST: transport of goods incl. mail / courier, supplier and recipient in India → (a) registered recipient: its location; (b) others: where the goods are handed over | `pos: 'recipient' \| 'handover'` | 2017-07-01 | **P** Circular 184/16/2022-GST (quotes 12(8)) | true | LG1 |
| 14 | Proviso to 12(8): transport to a place outside India → POS = the destination; IGST charged (Sec 7(5)); recipient may take ITC; GSTR-1 POS "96-Foreign Country" | Export freight heads → POS 96, IGST | 2019-02-01 | **P** Circular 184/16/2022-GST Sl. 1–4 | true | LG2, LG15 |
| 15 | Sec 13(9) IGST (supplier or recipient outside India: destination of goods, not mail / courier) omitted by s.162 Finance Act 2023 from **1 Oct 2023**; thereafter Sec 13(2) — recipient's location, else supplier's; mail / courier always 13(2) | `LG_POS_RULES` cross-border row by date | 2023-10-01 | **P** Circular 203/15/2023-GST Sl. A.1 | true | LG3 |
| 16 | Sec 13(8)(b) (intermediary → supplier's location) omitted; intermediary → Sec 13(2) | Existing `INTERMEDIARY_POS_RULES` (`2026-03-30`, `verified: false`) read through `lg-tax-io` | 2026-03-30 | **P** Finance Bill 2026 cl. 141 and Notes on Clauses (as introduced); assent / date **S** (EY, Grant Thornton, taxguru) | false (date) | LG4 |
| 17 | Pure agent: expenditure incurred as pure agent excluded from value when (i) paid on the recipient's authorisation, (ii) separately shown on the invoice, (iii) in addition to own supplies; pure agent = contract, no title, no own use, recovers actual amount only | Head role `pure_agent` → `charge_head_id: 'rule33'` line; C1 checklist of the four limbs | 2017-07-01 | **P** CGST Rule 33 (CBIC compiled Rules, read) | true | LG10 |
| 18 | Exchange rate for the value of taxable **services**: "as per the generally accepted accounting principles for the date of time of supply" (goods: the Customs-notified rate) | Rate typed or picked from the currency master (8H) for the invoice date, printed | 2017-07-27 | **P** CGST Rule 34(2) | true | LG13 |
| 19 | GTA invoice (Rule 54(3)) must show gross weight, consignor / consignee, vehicle no., goods, places, person liable | Existing R5-B LR | 2017-07-01 | **P** Rule 54(3) | true | LG8 |
| 20 | e-Invoice not required from persons in Rule 54(2) / (3) / (4) / (4A) (insurers / banks, **GTA**, passenger transport, multiplex) — N 13/2020-CT as amended | Forwarder / CHA / courier / warehouse invoices are e-invoiced above the threshold; a GTA-only invoice (R5-B) is not | 2020-10-01 | **S** taxheal reproduction (refers to Rule 54 sub-rules); Rule 54(3) **P** | false (exemption text) | LG14 |
| 21 | e-Way: an e-commerce operator or **courier agency** may furnish Part A on the consignor's authorisation | Courier manifest hint | 2018-04-01 | **P** CGST Rule 138(1) proviso and 138(7) proviso | true | LG20 |

**Income tax (Income-tax Act 2025 from 1 Apr 2026) — read through `tds-rules.ts` / `ita2025.ts` (not edited)**

| # | Rule | Value used by the app | From | Source read | verified | CA |
|---|---|---|---|---|---|---|
| 22 | Clients deduct TDS on freight / forwarding / clearing charges as payment to a contractor (old 194C → Sec 393(1) Table Sl. 6) | TDS-receivable tag on receipts (existing R14 receivable pieces through `lg-tax-io`) | existing | existing rows (`ita2025.ts`) | existing | LG23 |
| 23 | Whether TDS applies to reimbursements shown separately (CBDT Circular 715/1995 Q30, as recalled) | Default: TDS base = own charges only, editable | — | not read | false | LG23 |
| 24 | Transporter (≤ 10 goods carriages, PAN) — no TDS (194C(6)) | Existing `TDS_194C6_RULES` | existing | existing | existing | LG24 |
| 25 | Commission to sub-agents / brokerage (old 194H) | Existing rows | existing | existing | existing | LG24 |
| 26 | Freight to non-resident shipping companies taxed under Sec 172 (no TDS u/s 195; CBDT Circular 723/1995 as recalled); airlines / overseas agents under DTAA | Hint on vendor kind `shipping_line` / `airline` (foreign) | — | not read | false | LG24 |
| 27 | 206C(1F) motor vehicle (→ Sec 394 Sl. 6) not amended by the Finance Bill 2026 (cl. 73 changes Sl. 1, 2, 4, 5, 7, 8 only) | (auto candidate, not built) | 2026-04-01 | **P** Finance Bill 2026 cl. 73 (as introduced) | true (bill text) | — |

**Customs Brokers Licensing Regulations, 2018 (CBLR)**

| # | Rule | Value used by the app | Source read | verified | CA |
|---|---|---|---|---|---|
| 28 | Reg 10(k): "maintain up to date records such as bill of entry, shipping bill, transhipment application, etc., all correspondence, other papers relating to his business as Customs Broker and accounts including financial transactions in an orderly and itemised manner as may be specified by the [Pr.] Commissioner … or [Asst. / Dy.] Commissioner" | C4 job register print + CSV | **P** CESTAT Mumbai order in C/86165/2024 (quotes the regulation; regulation PDF itself not reached) | true (as quoted) | LG26 |
| 29 | Retention of records (five years reported) | Hint | **S** secondary summaries disagree on the clause letter | false | LG26 |
| 30 | Reg 10(n): verify the client's IEC, GSTIN, identity and functioning at the declared address using reliable documents | KYC checklist fields (no document copies stored) | **S** taxscan report of CESTAT order | false | LG27 |

Not found this round: the official CBLR 2018 PDF (CBIC), the consolidated N 13/2020-CT text, N 11–13/2023-IGST(R) texts,
the enacted Finance Act 2026 with its date of assent, the N 12/2017-CT(R) amendments after 2017 for Sl. 24 / 54, CBDT
Circulars 715/1995 and 723/1995, an official count of licensed customs brokers.

### 2.5 What changed in 2023–2026 for these businesses

| Change | Effective | App today | → |
|---|---|---|---|
| Sec 13(9) IGST omitted; transport of goods cross-border → Sec 13(2) (Circular 203/15/2023) | 1 Oct 2023 | — | `LG_POS_RULES`; LG3 |
| Ocean-freight RCM on imports removed (N 11–13/2023 as reported) | 1 Oct 2023 | — | Hint row, `verified: false`; LG16 |
| Circular 184/16/2022: export freight to Indian recipient → POS 96, IGST, ITC allowed | 27 Dec 2022 (clarifies the 2019 proviso) | GSTR-1 already maps POS 96 / 99 (`gst-reports.ts` `FOREIGN_POS`) | B2; LG2, LG15 |
| GST 2.0 transport rates (N 15/2025-CT(R)): multimodal 5 % / 18 %, GTA 18 % option, containers by rail, courier / delivery 18 % | 22 Sep 2025 | GTA only (R5-B) | Rule rows 4–7 |
| Income-tax Act 2025: TDS sections → Sec 393; TCS → Sec 394 | 1 Apr 2026 | `ita2025.ts` labels | Labels by date only |
| Finance Act 2026: Sec 13(8)(b) IGST omitted (intermediary → 13(2)) | 30 Mar 2026 (S) | `INTERMEDIARY_POS_RULES` | Read through `lg-tax-io`; LG4 |
| 57th GST Council: e-commerce delivery services 5 % without ITC under 9(5) | Recommendation (8 Oct 2026) | R16-D4 list | One `pending-changes.ts` entry; LG19 |

### 2.6 Verified against the code (`1fffeba`)

| Area | Finding | File |
|---|---|---|
| Road GTA | LR (`consignment_notes`, `LR` series), GTA option per FY, freight bills (SAC 996791, RCM / FCM), trips, vehicles, lorry hire with 194C(6) nil | `src/lib/transport/*.ts`, `docs/features/transport-works-r5.md` |
| GTA rates | `GTA_RATE_RULES`: 12 % → 18 % option from 2025-09-22, source "as understood — verify" | `src/lib/transport-works-rules.ts:24–30` |
| Pure agent | `PURE_AGENT_CHARGE`, `isPureAgentLine`, `isRecovery`, `recoveryValue` (left out of turnover / 194J / Rule 89(4) / 44ADA, QA17) — data only | `src/lib/trade/pure-agent.ts` (in `f-trade`: reach through a bridge) |
| Disbursements | `PurchaseRecord.ps = { disb, on_behalf, wo? }`, matter as cost centre, write-off, unrecovered list | `src/lib/prof/ps-disb.ts` |
| Advances | Receipt vouchers `ADV`, `applyAdvance`, `refundAdvance`; `AdvanceRecord.pass_through` (CN-C2: no GST, pure agent) | `src/lib/advances.ts`, `src/types/construction-r11.ts:581–589` |
| Foreign POS | GSTR-1 treats `place_of_supply` `96` / `99` as export | `src/lib/gst-reports.ts:667–712` |
| Cross-border POS | `servicePos` (13(2) default, 13(3)/(4)/(5), intermediary by date) | `src/lib/prof/ps-pos.ts`, `src/lib/prof-rules.ts:103–114` |
| FX | `fx.ts` (`inrValue`, `fxNarration`), `currency_rates` (`rateOn`), `fx-gain.ts` | `src/lib/fx.ts`, `src/lib/currency-rates.ts` |
| Netting | `postNetting` / `reverseNetting`, `Vendor.client_id`, `exchange_purchase_id` + `method: 'netting'` | `src/lib/netting.ts` |
| Statements | Supplier statement import / match (BSP, consolidator, bed bank) | `src/lib/travel/tv-statements.ts`, `tv-match.ts` |
| Ledger | Every sales line credits `A.sales` by cost centre; no per-line income ledger; pure-agent lines included (gross) | `src/lib/ledger/postings.ts:225–262` |
| Godowns | `consignment` kind = principals' goods (R8-C), non-saleable | `src/types/stock.ts:31`, `src/lib/godowns.ts:71–74` |
| Cold store | R12 `cold_lots` (agri produce, `CSR`, gate passes, rent plans) | `src/lib/agri/ag-cold-*.ts` |
| Tabs | `TIME_TABS` hosts R10 / R14 / R15 / R17 desks; `PACK_ROUTES['/time'] = ['works']`; `/time` belongs to module `time` | `src/pages/page-tabs.ts:118–143`, `src/lib/shop-mode.ts:43–98` |
| Record keys | `R9_RECORD_KEYS` spreads R12–R18 keys (`… mp, hs`) | `src/store/invoice-defaults.ts` |
| Family groups | eleven `f-*` rows, last `f-society` | `vite.config.ts:67–77` |
| CA regexes | `CA_LIST_RE` has no leading `\b` (`LG1` → `G1` unless `LG` is added) | `tests/docs-links.test.ts:15–16` |
| Nothing for jobs / HBL / MAWB / POS 96 per head / duty deposit / 996712 | grep for `996712`, `996713`, `HAWB`, `MBL`, `chargeable`, `volumetric`: none | — |

### 2.7 Size measurements

Not re-measured by the PRD author (§1.4). Family chunks on the R18 notes: `f-society` ≈ 11–12 kB, `SocietyDesk` ≈ 10 kB.
R19-A records `f-logistics` and `ShipmentsDesk` sizes after each package.

### 2.8 Sources

Accessed 28 Oct 2026.

**GST (primary first)**
- **P** Notification No. 15/2025-Central Tax (Rate), 17 Sep 2025 (CBIC file `15-2025-CTR-eng`, copy at
  https://accounts.iith.ac.in/pdf/GST/15-2025-CTR-eng1758171762.pdf — downloaded, text extracted: Sl. 9(iii) GTA 6 → 9,
  9(iv) containers by rail, 9(vi) multimodal with the illustration, 10(ia), Sl. 12 postal / courier / local delivery; the
  list of amended serial numbers (3, 7, 8, 9, 10, 12, 15, 21, 24, 26, 32, 34, 35, 38 — Sl. 11 not amended))
- **P** N 11/2017-CT(R) as amended up to 1 Apr 2019 (CBIC consolidated text, downloaded this session: Sl. 9 items (i)–(vii)
  and footnotes 52–61, Sl. 11, Sl. 12) and its annexure
  https://gstcouncil.gov.in/sites/default/files/2024-05/notification11-cgst-annexure.pdf (downloaded: SAC rows 107–164)
- **P** N 12/2017-CT(R), 28 Jun 2017 — https://gstcouncil.gov.in/sites/default/files/2024-05/download_6_0.pdf (Sl. 20,
  21, 22, 24, 54)
- **P** Circular No. 184/16/2022-GST, 27 Dec 2022 — https://gstcouncil.gov.in/sites/default/files/2024-06/cir-184-16-2022-cgst.pdf
  (downloaded, read in full)
- **P** Circular No. 203/15/2023-GST, 27 Oct 2023 — https://gstcouncil.gov.in/sites/default/files/2024-06/circular-no-203-15-2023.pdf
  (downloaded; Sl. A.1 read)
- **P** CGST Rules 2017 (CBIC compiled text, downloaded this session): Rule 33, Rule 34, Rule 54(3), Rule 138(1) and
  138(7) provisos, Rule 138E
- **P** The Finance Bill, 2026 (Bill No. 3 of 2026, as introduced in Lok Sabha; downloaded this session): cl. 141
  (IGST s.13(8)(b) omitted) and its Note on Clauses; cl. 73 (Sec 394 Table); cl. 75 (Sec 397 from 1 Oct 2026)
- S Finance Act 2026 assent / effective date — https://www.ey.com/en_in/technical/alerts-hub/2026/03/finance-bill-2026-receives-presidents-assent ;
  https://www.grantthornton.in/insights/articles/gst-on-intermediary-services/ ; https://taxclue.in/blog/intermediary-services-place-of-supply-igst-13-8-b-omitted
- S GST 2.0 transport summaries — https://taxguru.in/goods-and-service-tax/gst-rate-transport-courier-job-work-services-22-sept.html ;
  https://lakshmisri.com/newsroom/news-briefings/impact-of-gst-rate-changes-on-the-logistic-sector ;
  https://www.caclubindia.com/news/cbic-notifies-major-gst-rate-changes-on-services-effective-september-22-2025-25466.asp
- S Ocean freight RCM — https://www.vjmglobal.com/blog/no-gst-on-ocean-freight-under-reverse-charge-mechanism-on-cif-contract ;
  https://taxmann.com/post/blog/ocean-freight-reaches-destination-amid-choppy-waters ;
  https://www.in.kpmg.com/taxflashnews/KPMG-Flash-News-Mohit-Minerals-Pvt-Ltd.pdf
- S e-Invoice exemptions (N 13/2020-CT) — https://www.taxheal.com/gst-e-invoice-from-01st-oct-2020-notification-no-13-2020-central-tax.html ;
  https://news.cleartax.in/?p=6354
- S 57th GST Council — https://www.taxscan.in/gst/gst-council-recommends-5-gst-without-itc-on-delivery-services-through-e-commerce-platforms ;
  https://www.maritimegateway.com/gst-council-proposes-5-gst-on-e-commerce-deliveries-across-all-transport-modes/ ;
  https://www.taxscan.in/gst/57th-gst-council-key-recommendations-relating-to-services

**Customs brokers**
- **P** CESTAT Mumbai, order in Customs Appeal C/86165/2024 (https://cestat.gov.in/weborders/file/mumbai/414421 —
  downloaded; quotes CBLR Reg 10(k))
- S Reg 10(n) — https://www.taxscan.in/top-stories/customs-broker-not-obliged-to-conduct-physical-verification-of-importer-under-regulation-10nof-cblr-cestat-1447320 ;
  https://www.taxscan.in/?p=515859
- S FFFAI size — https://indiashippingnews.com/trending-news/fffai-elects-new-leadership-showcases-indias-trade-reforms-at-62nd-annual-general-meeting/ ;
  https://middleeast.breakbulk.com/Partner-List/federation-of-freight-forwarders-associations

**Other candidates (scoring only)**
- S used vehicles 18 % on margin, cess removal — https://cleartax.in/s/gst-old-and-used-refurbished-car ;
  https://carajput.com/blog/2500k-loss-risk-from-compensation-cess-credits-in-gst-2-0/ ;
  https://studycafe.in/gst-2-0-shake-up-auto-sector-faces-rs-2500-crore-loss-as-cess-becomes-useless-after-september-22-392479.html
- Existing app rows for 206C(1F) (`trading-rules.ts` `TCS_1F_RULES`, `ita2025.ts`) and coaching refund (`service-rules.ts`)

**Market and products**
- V https://slashdot.org/software/p/Siri-Global-Tech/ ; https://www.goodfirms.co/software/siri-freight-forwarding-software ;
  https://slashdot.org/software/p/BlueLogis/ ; https://shipmnts.com/llms.txt ; https://www.capterra.co.za/software/1109633/FreightSetu ;
  https://www.fretron.com/blog/best-freight-billing-software-india-2026/

---

## 3. Ranked list: what to build now

Value 1–5. Effort S = 1, M = 2, L = 3. Score = value ÷ effort. **Cut** = the order a package drops items at its cap
(1 = first to go; "never" items stay).

| Rank | Id | Gap | Who | Value | Effort | Score | Pkg | Cut |
|---|---|---|---|---|---|---|---|---|
| 1 | A1 | Logistics profile (wizard card, kinds, packs, desk tab, checklist, demo) + build plumbing (family group, `LG` regexes, registry, rules, `lg` key, `JOB` series) | all | 5 | S | 5.0 | A | never |
| 2 | B2 | POS and rate per charge head (12(8) + proviso, 13(2), intermediary, mode rates, multimodal, exempt) | fwd / cha / courier | 5 | S | 5.0 | B | never |
| 3 | A2 | Job file (mode, direction, refs, containers, weights, parties) + list / filters | fwd / cha | 5 | M | 2.5 | A | 3 (drop the CSV import; keep the form) |
| 4 | B1 | Billing a job (charge sheet → invoices split by POS / currency / kind, pure-agent lines) | fwd / cha | 5 | M | 2.5 | B | never |
| 5 | C1 | Disbursements on behalf (duty, CFS, port, DO) with the Rule 33 checklist | cha | 5 | M | 2.5 | C | never |
| 6 | C2 | Duty deposits per job (pass-through advance), application, refund | cha | 5 | S | 5.0 | C | never |
| 7 | A3 | Charge heads and rate sheets (client / lane), quotation → job | all | 4 | M | 2.0 | A | 2 (drop rate sheets per lane; keep heads with default rates) |
| 8 | B3 | Job costing: vendor bills tagged, accruals, job P&L, unbilled / uncosted | fwd / cha | 4 | M | 2.0 | B | 2 (drop accrual journals; keep tags + P&L) |
| 9 | A4 | Job paper block (`lg`: refs, containers, ports, weights, POS reason) | all | 4 | S | 4.0 | A | 1 (drop the container table; keep one refs line) |
| 10 | C3 | Reimbursement bill with disbursement schedule; ageing; write-off | cha | 4 | S | 4.0 | C | 3 (drop write-off; keep schedule + ageing) |
| 11 | D1 | Overseas-agent accounts (USD notes, profit share, statement, netting) | fwd | 4 | M | 2.0 | D | never |
| 12 | B4 | Freight in foreign currency (Rule 34(2) rate shown), LUT for exports of services | fwd | 3 | S | 3.0 | B | 1 (drop the LUT link; FX stays — it is the 3.4 field set) |
| 13 | D2 | Courier manifests (dockets, volumetric weight, zone card, monthly bill via `saveMany`, COD) | courier | 3 | M | 1.5 | D | 2 (drop COD remittance; keep manifests + bill) |
| 14 | C4 | CBLR Reg 10(k) job register, client KYC fields, gross / net reclass journal | cha | 3 | S | 3.0 | C | 1 (drop the reclass journal), 2 (drop KYC fields) |
| 15 | D4 | Alerts and reports (unbilled, unrecovered, margin by lane / client / salesperson, TDS on receipts) | all | 3 | S | 3.0 | D | 3 (drop TDS-on-receipts view) |
| 16 | D3 | Storage billing (pallet / sq ft / CBM × days, handling, agri exempt) via `saveMany` | warehouse | 2 | M | 1.0 | D | 1 |
| — | — | ICEGATE / e-Sanchit filing, tracking APIs | all | 4 | L | 1.3 | no (network) | — |
| — | — | HBL / HAWB negotiable document print | fwd | 2 | M | 1.0 | no (legal effect, §1.6) | — |
| — | — | 3PL SKU-level stock / bins | warehouse | 2 | L | 0.7 | no (WMS) | — |

All 16 are planned. The cut column, not a renegotiation, decides what happens at a cap.

---

## 4. Specifications (16 items)

Conventions for every item:
- **Logic and tests.** Pure logic in `src/lib/logistics/lg-*.ts` (new folder; family group `f-logistics`), bridges in
  `src/lib/logistics/lg-*-io.ts` (§1.4), tests with `node:test` in `tests/lg-*.test.ts`. UI checks are `step(...)`
  blocks in `tests/e2e/smoke.mjs` (§7).
- **Components.** `src/components/logistics/`: `ShipmentsDesk.tsx` (lazy from `Time.tsx` by glob) and one lazy view per
  `&view=`. The template part is `components/templates/parts/LogisticsBlock.tsx` (lazy; the `SocietyBlock` pattern).
- **Strings.** One area per package (§1.4). Hindi uses the trade's words: फ्रेट फ़ॉरवर्डर, कस्टम ब्रोकर (CHA), जॉब फ़ाइल,
  शिपमेंट, समुद्री / हवाई / सड़क / मल्टीमोडल, कंटेनर, शिपर, कंसाइनी, विदेशी एजेंट, भाड़ा (फ्रेट), बिल ऑफ़ लैडिंग (BL),
  एयर वेबिल (AWB), शिपिंग बिल, बिल ऑफ़ एंट्री, सीमा शुल्क (ड्यूटी), ड्यूटी जमा, प्रतिपूर्ति (रीइम्बर्समेंट), वितरण व्यय
  (डिस्बर्समेंट), देय वज़न (चार्जेबल), आयतनी वज़न (वॉल्यूमेट्रिक), कूरियर डॉकेट, मैनिफ़ेस्ट, भंडारण शुल्क, हैंडलिंग शुल्क.
- **Storage.** New company tables `mrchartist_inv_<table>` via `getTable` / `setTable`, each registered in `backup.ts`,
  `trust/open-export-schema.ts`, `sync-engine.ts` `DATED` when dated, and **`src/lib/logistics/lg-registry.ts`**
  (`LG_TABLE_ACTIONS`, `LG_WATCHED`, audit labels), registered at runtime, never in first-paint `access.ts` /
  `audit-edits.ts`. **Every module that writes a Round 19 table imports `./lg-registry`**, and so do `sync-engine.ts`
  and `trust/recycle-bin.ts` (`tests/lg-registry.test.ts`). Names live in `src/lib/logistics/lg-shared.ts`; additive
  fields by declaration merging in `src/types/logistics-r19.ts`, one `declare module` block per package.
- **Volume.** A mid-size forwarder / CHA opens 300–600 jobs a month (≈ 7,000 a year); a courier franchisee books
  2,000–5,000 dockets a month. That is why (a) a job is a **row in `lg_jobs`, not a cost centre** (the R15 trip
  precedent would put 7,000 cost centres a year into every cost-centre picker — §8 Q3), and (b) dockets live **inside
  one `lg_manifests` row per account customer × month** (the R17 muster pattern), never one row per docket. Tests build
  10,000 jobs and 60,000 dockets (12 months × 50 customers × 100) and check: the job list reads one FY's jobs; a job's
  P&L reads only documents whose `lg.job_id` matches (indexed once per render); a manifest run issues 50 bills through
  one `localDb.invoices.saveMany` under 2 s in `node:test`.
- **Invoice snapshots.** Everything Round 19 stores on an invoice lives under the record key **`lg`** (§6). Lines reuse
  existing keys: `charge_head_id: 'rule33'` (+ `PURE_AGENT_CHARGE`) for pure-agent recoveries, `hsn` for the SAC,
  `tax_rate` for the rate. **No line key is added**; the head of each line is kept in `lg.heads[lineId]`.
- **Numbers.** **One series `JOB`** (job files). Dockets, HBL / HAWB, MBL / MAWB, SB / BOE are typed, unique per company
  where the tests say so.
- **Guards.** Destructive calls use `requireAccess`; writes in a locked period use `assertUnlocked`; money through
  `round2`; deletes through `setTable` on a watched table (recycle bin); multi-table writes through
  `withTablesRollback`; batch issue only through `localDb.invoices.saveMany` (AGENTS.md "Batch issuing").
- **Packs.** The desk tab is listed only when `logistics` (or `customs` / `courier` / `warehouse`) is on. Round 19
  tables are not read while those packs are off (`tests/lg-pack-gate.test.ts`).
- **Help and Ctrl+K.** Every view gets a topic in `src/lib/help/topics-packs.ts` (block `// R19`;
  `tests/help-registry.test.ts`), a Ctrl+K title in `src/i18n/areas/discover-r6-tabs.ts` and synonyms in
  `src/lib/palette/synonyms.ts` (`'/time?tab=shipments&view=jobs': ['job file', 'shipment', 'consignment', 'जॉब']`,
  `…&view=customs': ['duty deposit', 'CHA', 'reimbursement', 'ड्यूटी']`, `…&view=courier': ['docket', 'manifest',
  'AWB', 'डॉकेट']`). **A adds `LG` to the CA-id regexes** in `tests/help-registry.test.ts`,
  `tests/help-glossary.test.ts` and `tests/docs-links.test.ts` (`CITED_RE`, `CA_LIST_RE`, the row regex), with tests
  that `LG1` is read whole, never as `G1`, and that `G1` alone still reads as `G1`.
- **Cash readers.** No new receipt marker. A duty deposit is an existing advance receipt (`pass_through`) — money moved;
  its application is the existing `advance_id` row that `movedNoCash` already skips. Agent netting uses the R15-A
  marker (`exchange_purchase_id` + `method: 'netting'`). COD collected for shippers is a receipt into a liability ledger
  (D2), cash moved. `no-cash.ts` is not edited (`tests/no-cash-readers.test.ts` unchanged).
- **Purchases contract.** Modules reading `purchases` (`lg-costing`, `lg-disb`, `lg-agents`, `lg-alerts`) are added to
  `tests/purchase-contract.test.ts` and read bills through `readPurchase` (via `lg-books-io.ts`).
- **GST readers.** No GST reader changes. Tests prove the placements (§10).
- **Rule file shape.** `src/lib/logistics-rules.ts` rows are `{ from, value, source, verified }`, append-only, read with
  the shared `ruleAt`. Sections `// R19-A` … `// R19-D` (§6).

### R19-A — Logistics core (merge first)

#### A1 Logistics profile and build plumbing

**User story.** I run a forwarding and customs-clearance firm in Navi Mumbai (registered in Maharashtra). In setup I pick
"Freight forwarding, customs clearance, courier or warehouse", then *Forwarder + customs broker*. The app lands me on
Time → Shipments → Jobs, and the checklist asks for my charge heads, my first job and my first bill.

**Acceptance criteria.**
1. `PackId` gains `logistics`, `customs`, `courier`, `warehouse` (appended to `PACK_IDS`). `PACK_OF_TYPE`,
   `PACK_OF_TYPE_INLINE`, `PACK_ROUTES` unchanged.
2. `applyLogisticsKind(kind, { registered, ownLorries, extra: ('courier' | 'warehouse')[], currentPacks })`
   (`shop-presets.ts`, lazy; the R12–R18 pattern) returns business type `transport`, modules = the `transport` preset ∪
   `['time']` (`registered` keeps `gst`; unregistered drops it), packs = `currentPacks ∪` the kind's packs (§1.3) ∪
   `transport` only when `ownLorries`, written as an explicit list, landing, due days 30, template `gst_tax_invoice`.
3. Settings field `logistics_kind?: 'forwarder' | 'cha' | 'courier' | 'warehouse' | 'multi'` and the object
   **`logistics_settings`** (`settings.manage`, audited, synced as a singleton; absent = defaults filled by
   `lgDefaultsFor`). A writes the shape for every package:
   - A: `heads: Head[]` (A3), `job_prefix?` (branch prefix for `JOB`), `default_currency` (`USD`), `weight_unit: 'kg'`;
   - B: `split: 'pos_currency' | 'single'` (default `pos_currency`, LG9), `accrue: boolean` (default true),
     `margin_alert_pct?`;
   - C: `deposit_required?: boolean`, `disb_posting: 'gross' | 'net_journal'` (default `gross`, LG11),
     `register_fields?: string[]`;
   - D: `volumetric: { air: 6000, courier: 5000, sea_kg_per_cbm: 1000 }` (cm³ per kg; commercial conventions, LG33),
     `zones?: Zone[]`, `storage_plans?: StoragePlan[]`, `cod_ledger?`.
4. **Wizard.** One lazy card "Freight forwarding, customs clearance, courier or warehouse" (sub-step in the wizard chunk):
   kind, extras (courier / warehouse for `multi`), "we also run our own lorries", registered. Settings → Features shows
   "Logistics profile". Changing it never deletes data.
5. **Checklist steps** (`checklist-steps.ts`, append-only, only with `logistics_kind`; names distinct from R5-B's):
   `lgHeads` (≥ 1 head), `lgJob` (≥ 1 `lg_jobs` row), `lgBill` (≥ 1 invoice with `lg.job_id`), `lgDeposit` (C, kind
   `cha` / `multi`: ≥ 1 deposit), `lgManifest` (D, courier), `lgStorage` (D, warehouse).
6. **Sample data** (R6-B4) in `src/lib/demo/profile-logistics.ts`, **only in the Demo company** (`demoDatabaseOpen()`
   checked by the existing dispatcher), ≤ 0.8 kB gz for the round, one block per package:
   - A: "Demo Seabird Logistics" (Maharashtra, registered), heads (§4 A3 defaults), client "Demo Exports Pvt Ltd" (MH,
     GSTIN), overseas agent "Demo Agent Pte Ltd" (Singapore, client + vendor pair), job JOB/FY26-27/0001 (export, air,
     BOM → SIN, 500 kg chargeable);
   - B: its two invoices and the co-loader bill; C: import job 0002 with a ₹2,00,000 duty deposit and the ICEGATE
     duty disbursement; D: one agent profit-share note, one courier manifest with three dockets, one storage month.
7. **Build plumbing (one commit, before any feature code):**
   - `vite.config.ts`: the `f-logistics` row (§1.4); `tests/bundle-config.test.ts` adds the name and the regex test;
   - `LG` in the three CA-id regexes (with the `G1` test);
   - `src/lib/logistics/{lg-shared,lg-registry}.ts`, `src/lib/logistics-rules.ts` (sections),
     `src/types/logistics-r19.ts` (all packages' declarations, §6);
   - `store/invoice-defaults.ts`: `export const R19_RECORD_KEYS = ['lg'] as const;` and the token in `R9_RECORD_KEYS`
     after R18's. That module is lazy; measured first paint must stay at the baseline;
   - `series-counters`: the `JOB` series is registered the way `LR` / `TRP` were (R5-B), with branch prefixes.

**Files.** New: `src/lib/logistics/{lg-shared,lg-registry,lg-settings,lg-profile}.ts`, `src/lib/logistics-rules.ts`,
`src/types/logistics-r19.ts`, `src/components/logistics/{LogisticsKindPicker,ShipmentsDesk}.tsx`,
`src/i18n/areas/logistics-r19a.ts`, `src/lib/demo/profile-logistics.ts`, `docs/features/logistics-r19.md`. Edit:
`industry-packs.ts` (ids; `PACK_TABS` block `// R19`; `exportsvc` row `alsoPacks` + `logistics`), `page-tabs.ts`
(`TIME_TABS` row), `Time.tsx` (one `import.meta.glob` row + tab branch), `shop-presets.ts`, `features-catalog.ts`,
`checklist-steps.ts`, the wizard (one lazy card), `FeaturesPanel.tsx`, the demo dispatcher, `vite.config.ts`,
`invoice-defaults.ts`, `series-counters` registration, the three regex tests.

**Tests.** `tests/lg-profile.test.ts` (each kind's type / modules / packs / landing; `time` added; `transport` pack only
with `ownLorries`; `PACK_OF_TYPE` / `PACK_ROUTES` unchanged), `tests/lg-registry.test.ts`, `tests/lg-rules.test.ts`
(import graph; every row has `from`, `source`, `verified`; the `verified: true` set is exactly §2.4's),
`tests/lg-pack-gate.test.ts`, `tests/bundle-config.test.ts`, `tests/industry-packs.test.ts` (extended),
`tests/docs-links.test.ts` (`LG1` vs `G1`).

#### A2 Job file

**User story.** Demo Exports books 500 kg by air to Singapore. I open a job, pick Export / Air, BOM → SIN, incoterm FCA,
type the MAWB from the co-loader and our HAWB, 5 cartons of 120 × 100 × 50 cm, gross 480 kg → chargeable 500 kg (volumetric), the shipping
bill number when customs gives it, and the overseas agent.

**Acceptance criteria.**
1. **Table `lg_jobs`** (dated by `date`, synced, audited, right `doc.create`; number from the `JOB` series):
   `id`, `number`, `date`, `status: 'enquiry' | 'booked' | 'in_transit' | 'arrived' | 'delivered' | 'closed' |
   'cancelled'`, `dir: 'export' | 'import' | 'domestic' | 'cross_trade'`, `mode: 'sea_fcl' | 'sea_lcl' | 'air' | 'road'
   | 'rail' | 'multimodal' | 'courier'`, `legs?: ('road' | 'rail' | 'sea' | 'air' | 'inland_water')[]` (multimodal),
   `incoterm?`, `origin`, `destination` (port / airport / ICD code or text), `dest_country?` (ISO-2), `etd?`, `eta?`,
   `client_id`, `shipper?`, `consignee?` (text), `agent_id?` (client id of the overseas agent), `salesperson?`,
   `refs: { mbl?, hbl?, mawb?, hawb?, sb_no?, sb_date?, boe_no?, boe_date?, igm?, vessel?, voyage?, flight? }`,
   `containers?: { no, size: '20' | '40' | '40HC' | '45' | 'LCL', seal? }[]`, `pkgs?`, `gross_kg?`, `chargeable_kg?`,
   `cbm?`, `dims?: { l, w, h, n }[]` (cm), `branch?`, `note?`, `closed_on?`, `updated_at`. C adds `kyc_ok?`; D adds
   `courier?`.
2. `chargeableWeight({ gross_kg, dims, mode, settings })` (pure, `lg-weight.ts`): air = max(gross, Σ l·w·h·n ÷ 6000);
   courier ÷ 5000; sea LCL = max(CBM, gross ÷ 1000) as "W/M"; rounded up to 0.5 kg (air / courier) or 0.01 CBM. The
   divisors are **settings**, not rule rows (commercial conventions, LG33).
3. **Validation:** container number shape (4 letters + 7 digits; ISO 6346 check digit as a hint), HAWB / HBL unique per
   company, SB / BOE date ≥ job date − 30 days (hint), `dest_country` required for an export by sea / air (B2 needs it).
4. **Jobs view** (`jobs`): list by FY with filters (status, mode, direction, client, agent, salesperson, branch), totals
   of jobs / chargeable kg / TEU; "New job", "Duplicate job"; status chips; a per-job page (header + tabs filled by B–D:
   charges, documents, costs, disbursements, deposits).
5. **Import** (cut 3): CSV / XLSX of jobs through `csv.ts` / dynamic `xlsx.ts` and `import-mapping.ts`; one
   `import_runs` row (kind `lg_jobs`).
6. **Close** a job: status `closed` with `closed_on`; a closed job's documents still open; re-open is audited.

**Files.** New: `src/lib/logistics/{lg-job,lg-weight,lg-jobs-import}.ts`, `components/logistics/{JobsView,JobForm}.tsx`.
Tests: `tests/lg-job.test.ts` (validation, numbering, uniqueness, chargeable weight for air / courier / LCL, ISO 6346
hint, volume 10,000 jobs).

#### A3 Charge heads and rate sheets

**User story.** My heads: air freight (per kg, USD), ocean freight (per container / W/M, USD), origin THC, documentation,
customs clearance, CFS charges (pure agent), customs duty (pure agent), transportation (GTA leg), insurance (pure agent
when in the client's name), storage. For Demo Exports, BOM → SIN air is USD 2.00 / kg.

**Acceptance criteria.**
1. `Head = { id, name, kind, role, unit, rate?, currency?, sac?, pos_rule?, exempt_if?, active }` with
   - `kind`: `freight_sea` | `freight_air` | `freight_road` | `freight_rail` | `freight_multimodal` | `courier` |
     `origin` | `destination` | `documentation` | `clearance` (CHA) | `forwarding` (C&F) | `handling` | `storage` |
     `gta` (road leg by a GTA) | `insurance` | `duty` | `cfs` | `port` | `do_charges` | `demurrage` | `commission`
     (from an overseas principal / carrier) | `other`;
   - `role`: `own` (taxable supply) | `pure_agent` (Rule 33, `rule33` line) | `exempt` (by `exempt_if`);
   - `unit`: `per_kg` | `per_cbm` | `per_wm` | `per_container` (by size) | `per_shipment` | `per_bill` | `per_pkg` |
     `per_day` | `pct_of_value` | `typed`;
   - `pos_rule` (B2): `transport` (Sec 12(8) + proviso) | `general` (12(2) / 13(2)) | `intermediary` | `auto` (by kind).
2. Default heads with SACs (§2.4 row 9): sea 996521, air 996531, road 996511, multimodal 996799 (CA LG5), courier 996812,
   clearance 996712, forwarding / origin / destination / documentation / handling 996713 (LG5, LG9), storage 996729,
   GTA 996791 (from `gtaSac` through `lg-tax-io`), commission 996713 (LG4); `duty`, `cfs`, `port`, `do_charges`
   default `pure_agent` (LG10, LG37); `insurance` default `pure_agent` (LG36); `demurrage` default `own` (LG35).
3. **Rate sheets** (cut 2) — table **`lg_rate_sheets`** (not dated, `master.edit`): `{ id, client_id?, lane: { origin,
   destination, mode }, valid_from, valid_to?, rows: { head_id, rate, currency, unit, min? }[] }`. `ratesFor(job,
   sheets, heads)` picks client + lane, else lane, else head default; `min` charge applied.
4. **Quotation → job:** a quotation (existing `QUOTATION` doc) built from a rate sheet carries `lg = { quote: true,
   lane }`; "Make job" copies parties / lane / heads into a new job (the existing quotation status flow is unchanged).
5. **Rates view** (`rates`): heads grid; rate sheets list with validity; "Quote from sheet".

**Files.** New: `src/lib/logistics/{lg-heads,lg-rates}.ts`, `components/logistics/RatesView.tsx`. Rule rows `// R19-A`:
`LG_SAC_RULES`, `LG_RATE_RULES` (§2.4 rows 1–8, keyed by head kind and `legs`), `LG_EXEMPT_RULES` (rows 10).
Tests: `tests/lg-heads.test.ts` (defaults, SACs, roles; rate sheet precedence and validity; minimum charge;
quotation → job copies).

#### A4 Job paper block

**Acceptance criteria.**
1. `LogisticsBlock.tsx` (lazy, mounted in `TemplateEngine.tsx` after `SocietyBlock`, before `GstBody`, never on
   `receipt`) prints from `lg` only: job no., direction / mode, origin → destination, HBL / MBL or HAWB / MAWB, vessel /
   voyage or flight, SB / BOE no. and date, containers (≤ 8, then "+ N more") (cut 1), packages, gross / chargeable kg,
   CBM, and the **POS reason** line from B2 ("Place of supply: outside India — Sec 12(8) proviso, IGST"), plus C's
   disbursement schedule and D's manifest / storage summaries through `switch` arms in `parts/logistics/*.tsx`.
2. Old invoices render unchanged (snapshot compare in `tests/lg-print.test.ts`). Colours from `accent` only.
3. `paper-helpers.ts`: `lgLineText` appended after `hsLineText`.

**Files.** New: `components/templates/parts/LogisticsBlock.tsx`, `src/lib/logistics/lg-print.ts`,
`logistics-paper.module.css`. Edit: `TemplateEngine.tsx` (one lazy import + mount), `paper-helpers.ts`.

### R19-B — Billing, GST and job costing

#### B1 Billing a job

**User story.** Job 0001 is delivered. Its charge sheet shows air freight USD 1,000 (500 kg × USD 2.00) at ₹84.00 =
₹84,000; origin handling ₹5,000; documentation ₹2,000; customs clearance ₹3,500; airline terminal charges ₹1,800 paid
for the client. "Bill job" makes two invoices: freight (POS 96, IGST 18 %) and local charges (POS Maharashtra, CGST +
SGST, with the ₹1,800 recovery outside the taxable value).

**Acceptance criteria.**
1. `chargeSheet(job, heads, rates, extra)` (pure, `lg-bill.ts`) lists the job's charges (head, qty from the job's
   weights / containers / days, rate, currency, amount, role, B2 regime). The user may add, edit or remove lines before
   billing; the sheet is a draft, not stored (built again from the job + typed lines kept on the job as
   `lg_jobs.charges?: { head_id, qty, rate, currency, amount, note? }[]`).
2. `planJobBills(job, sheet, ctx)` returns drafts grouped by **(POS, currency, document kind)** (`split:
   'pos_currency'`): document kind = tax invoice (registered sender), Bill of Supply (whole group exempt), invoice
   (unregistered sender), debit note to an agent (D1). `split: 'single'` puts every line on one document and is
   refused when the lines need different POS (a message, LG9).
3. Each draft carries `lg = { job_id, job_no, mode, dir, refs, ports, weights, heads: { [lineId]: headId }, regime,
   pos_reason, fx? }`; pure-agent lines carry `charge_head_id: 'rule33'` + `PURE_AGENT_CHARGE`; lines carry `hsn` (SAC)
   and `tax_rate` from B2.
4. **Issue** through `lg-issue-io.ts` → `localDb.invoices.saveMany(drafts)` (one write, numbered like `save`), inside
   `withTablesRollback([lg_jobs])` that stamps the job's billed lines. **Billed state is derived** from live invoices
   whose `lg.job_id` matches and whose `lg.heads` name the head (cancelling an invoice frees its lines). A head already
   billed is skipped and listed.
5. **Month-end "Bill delivered jobs"**: every delivered, unbilled job of the month → one `saveMany` call for all their
   drafts (volume: 600 jobs → ≈ 1,000 documents; the R2-B1 batch limit is not involved).
6. **Billing view** (`billing`): unbilled / part-billed / billed jobs with amounts by currency; per-job drill to its
   documents; "Bill job", "Bill delivered jobs (month)"; "Share" through the existing share-message builder.

**Files.** New: `src/lib/logistics/{lg-bill,lg-issue-io}.ts`, `components/logistics/BillingView.tsx`,
`src/i18n/areas/logistics-r19b.ts`. Tests: `tests/lg-bill.test.ts` (split by POS / currency, single-split refusal,
idempotent re-bill, cancel frees lines, month batch through one `saveMany`, volume 600 jobs).

#### B2 Place of supply and rate per head

**Acceptance criteria.**
1. `lgRegime({ date, head, job, sender, recipient })` (pure, `lg-regime.ts`) returns `{ pos, mode: 'IGST' |
   'CGST_SGST' | 'NONE', rate, itc_note?, exempt?, reason, ca }`, by the document date:

   | Case | Rule (date-keyed) | POS | Tax | Reason printed |
   |---|---|---|---|---|
   | Transport head, supplier and recipient in India, goods to a place in India | 12(8)(a) / (b) | Registered recipient's State; unregistered: where handed over (the job's origin State) | CGST + SGST if same State as sender, else IGST | "Sec 12(8) IGST Act" |
   | Transport head (incl. courier), supplier and recipient in India, **goods to a place outside India** | 12(8) proviso (from 2019-02-01) | **96** (foreign destination) | **IGST** (Sec 7(5)) | "Place of supply outside India — Sec 12(8) proviso; IGST (Circular 184/16/2022-GST)" |
   | Any head, recipient outside India (overseas agent / foreign client) | 13(9) to 2023-09-30 (transport: destination); **13(2)** from 2023-10-01 | Recipient's location → 96 | Export of services under LUT (zero-rated) when Sec 2(6) is met (checked through `lg-tax-io` → `ps-export-check`), else IGST | "Sec 13(2) IGST Act (13(9) omitted from 1 Oct 2023, Circular 203/15/2023-GST)" |
   | `intermediary` head (commission from an overseas principal / carrier) | `intermediaryPos(date)` (R14 row) | supplier's location until 2026-03-29; 13(2) from 2026-03-30 | IGST / CGST + SGST until then; export from then if 2(6) met | by date (LG4) |
   | Non-transport head (handling, documentation, clearance, storage) for a recipient in India | 12(2) | Registered recipient's location | per States | "Sec 12(2)" |
   | Storage of agricultural produce / rice | Sl. 54(e) / 24 | as above | exempt (Bill of Supply if the whole group) | "Exempt — N 12/2017-CT(R) Sl. 54(e)" |
   | Multimodal | Sl. 9(vi) | as transport | 12 % to 2025-09-21; from 2025-09-22: 18 % if any `air` leg, else 5 % with the ITC note; only domestic-to-domestic — an international multimodal job uses the air / sea head rates (LG6) | "N 15/2025-CT(R)" |
   | GTA leg (road by a GTA vendor, re-billed) | existing GTA rows | as transport | the GTA option's rate (`gtaRate`) — or, when the forwarder is itself the GTA, the R5-B LR flow | "Sec 12(8); GTA" (LG8) |

2. `pos_rule: 'auto'` maps `freight_*`, `courier`, `gta` to `transport`; `commission` to `intermediary`; the rest to
   `general`. A head whose `pos_rule` the user changed is printed with the user's reason (audited setting).
3. **Composite supply** (LG9): by default every head is its own supply with its own POS; a setting
   `composite_with_freight: string[]` (head ids) makes those heads follow the freight's POS and rate on the same
   document. Off by default.
4. **Rates** from `LG_RATE_RULES` by head kind (and `legs` for multimodal) at the document date; vessel freight carries
   the ITC note "ITC on goods other than ships not taken" printed nowhere, shown in the editor only (LG6).
5. **Import job hints:** an import by sea on CIF terms shows "No IGST on ocean freight under reverse charge for imports
   from 1 Oct 2023 (LG16)" (`verified: false` row). Freight billed by the forwarder to the Indian importer for an import
   job is domestic transport (12(8)(a)) at the head's rate.
6. GSTR-1 / 3B / e-Invoice read the existing fields; **no GST reader changes.** Tests prove: export freight with
   `place_of_supply: '96'` billed to a registered Indian client lands in **B2B with POS 96** and IGST (Circular 184 Sl.
   4), not Table 6A; an LUT invoice to the overseas agent lands in 6A as export of services without payment; `rule33`
   lines are outside both; the e-Invoice JSON of the POS-96 B2B invoice carries `Pos: '96'` and IGST.
7. Rule rows `// R19-B`: `LG_POS_RULES` (12(8) from 2017-07-01; proviso from 2019-02-01; cross-border 13(9) to
   2023-09-30 and 13(2) from 2023-10-01 — `verified: true`), `OCEAN_RCM_RULES` (hint; `verified: false`),
   `EINV_EXEMPT_RULES` (GTA invoices; `verified: false`).

**Files.** New: `src/lib/logistics/{lg-regime,lg-tax-io}.ts`, `components/logistics/parts/RegimeChip.tsx`. Edit:
`pending-changes.ts` (one entry: 57th Council e-commerce delivery services, LG19). Tests: `tests/lg-regime.test.ts`
(dates 2019-01-31 / 02-01; 2023-09-30 / 10-01; 2025-09-21 / 22 multimodal with and without air; 2026-03-29 / 30
intermediary; registered vs unregistered recipient; agri storage exempt; composite override; GSTR-1 / e-Invoice
placement).

#### B3 Job costing

**User story.** The co-loader's bill for job 0001 (USD 800 + IGST) and the trucker's ₹2,500 arrive. I tag them to the
job. The job shows revenue ₹94,500, cost ₹69,700, margin ₹24,800 (26.2 %), with the ₹1,800 terminal charges as a
recovery outside both.

**Acceptance criteria.**
1. `PurchaseRecord.lg?: { job_id, head_id?, accrual_id? }` (additive) set from a job picker on the purchase-bill form
   (one lazy row, the R15 `TripPick` slot) and from the job page ("Add cost"). A bill may be split over jobs by line
   (`lg.lines?: Record<lineId, jobId>`) — the R17 site-bill precedent.
2. `jobPnl(job, invoices, bills, opts)` (pure, `lg-costing.ts`): revenue = taxable value of the job's invoices (credit
   notes subtract; financial credit notes left out), **excluding** `rule33` lines (`recoveryValue` through the bridge);
   cost = taxable value of tagged bills (ITC-eligible GST out; ineligible GST in), excluding pure-agent disbursements
   (C1); accruals (open estimates) added until the bill arrives; margin and %. In INR at each document's rate.
3. **Accruals** (cut 2): "Accrue expected cost" on a job line → a manual voucher Dr Freight / job cost (cost centre of
   the branch, if any) | Cr "Accrued freight costs" dated the month end, reversed on the first day of the next month
   (class `Logistics accrual`), idempotent per (job, head, month); through `lg-books-io.ts` (LG34).
4. **Costing view** (`costing`): per job revenue / cost / margin; unbilled jobs (delivered, no live invoice), uncosted
   jobs (billed, no cost and no accrual); margin by lane / client / salesperson / month (D4 adds the charts' CSV);
   jobs below `margin_alert_pct` flagged.

**Files.** New: `src/lib/logistics/{lg-costing,lg-books-io}.ts`, `components/logistics/CostingView.tsx`. Edit: the
purchase-bill form (one lazy row). Tests: `tests/lg-costing.test.ts` (seed numbers, FX documents, credit notes,
recoveries excluded, split bills, accrual reversal and idempotence); `tests/purchase-contract.test.ts` (reader added).

#### B4 Freight in foreign currency (cut 1 drops the LUT link)

**Acceptance criteria.**
1. A USD line on the charge sheet makes its group a foreign-currency document (the 3.4 fields `currency`, `fx_rate`):
   rate picked from the currency master (`rateOn`, 8H) for the invoice date or typed; the paper prints "Exchange rate
   ₹84.00 / USD (Rule 34(2) CGST Rules — as per accounting standards)" (LG13).
2. A group billed to an overseas recipient that meets Sec 2(6) uses the export-of-services supply type under the
   active LUT (existing LUT register through `lg-tax-io`); without an LUT the group is IGST "with payment" and a hint
   links to the LUT register.
3. Realisation and FX gain / loss on receipt use the existing `fx-gain.ts` path; the R14 `exportsvc` tab (now
   `alsoPacks: ['logistics']`) lists these invoices for FEMA realisation.

**Files.** In `lg-bill.ts`, `BillingView.tsx`. Tests: in `tests/lg-bill.test.ts` (rate from the master, typed rate,
LUT / no-LUT supply type, INR values).

### R19-C — Customs broker desk

#### C1 Disbursements on behalf

**User story.** For import job 0002 I pay ₹1,85,430 customs duty through ICEGATE from our account (challan no. typed),
₹12,000 CFS charges invoiced by the CFS in the importer's name, and nothing else. Both show on the job as "paid on
behalf — to recover".

**Acceptance criteria.**
1. A disbursement is an ordinary expense row (`purchases`, the R14 PS-B1 precedent) with the additive
   `PurchaseRecord.lg = { job_id, disb: 'duty' | 'cfs' | 'port' | 'do' | 'shipping_line' | 'insurance' | 'other',
   on_behalf: true, ref?: string /* ICEGATE challan / CFS invoice no. */, in_client_name?: boolean }`, no GST claimed
   (`itc_eligible: false`), vendor = the authority / CFS / line. Ledger unchanged (gross; C4 offers the net journal).
2. **Rule 33 checklist** (LG10) on each disbursement, all four shown, the save warns (never blocks) when one is unticked:
   (i) paid on the client's authorisation (the job's authorisation ref / date), (ii) shown separately on the invoice
   (automatic — C3 bills it as a `rule33` line), (iii) in addition to our own services, (iv) actual amount only, no
   title / own use (invoice in the client's name for CFS / DO / line charges).
3. `unrecovered(jobs, purchases, invoices)` (pure, `lg-disb.ts`): disbursements not on a live invoice, by job / client /
   age (0–30 / 31–60 / 61–90 / > 90).
4. Customs view (`customs`), section "Disbursements": add disbursement (duty / CFS / port / DO …), list by job, ageing.

**Files.** New: `src/lib/logistics/lg-disb.ts`, `components/logistics/CustomsView.tsx`,
`src/i18n/areas/logistics-r19c.ts`. Tests: `tests/lg-disb.test.ts` (no ITC, checklist warnings, ageing, purchase
contract).

#### C2 Duty deposits

**User story.** The importer sends ₹2,00,000 for duty before the bill of entry is assessed. After clearance the
reimbursement bill is ₹2,04,510; the deposit is applied and ₹4,510 remains due. Another job's excess deposit is refunded.

**Acceptance criteria.**
1. A deposit is an **existing advance receipt** (`advances.ts`, `ADV` series) saved through `lg-recv-io.ts` with
   `tax_rate: 0`, `pass_through: true` (CN-C2 flag: no GST, pure agent) and the additive `AdvanceRecord.lg = { job_id }`.
   No GST on the advance (LG12); the voucher prints "Deposit towards customs duty and charges payable on the client's
   behalf — not consideration for our supply".
2. **Apply** to the job's reimbursement invoice through the existing `applyAdvance` (cash readers already skip
   `advance_id` rows); **refund** the excess through `refundAdvance` (Refund Voucher) with the job in the narration.
3. **Deposit position per job**: deposits − applied − refunded vs unrecovered disbursements; "short" (spent more than
   received) and "excess" (received more than spent) chips; setting `deposit_required` warns on a duty disbursement for
   a job without enough deposit (hint, LG12).
4. Customs view, section "Deposits": add deposit, apply, refund; list by job / client.

**Files.** New: `src/lib/logistics/{lg-deposits,lg-recv-io}.ts`. Tests: `tests/lg-deposits.test.ts` (no GST, apply,
refund, short / excess, cash readers unchanged — `tests/no-cash-readers.test.ts` passes).

#### C3 Reimbursement bill, schedule and ageing

**Acceptance criteria.**
1. B1's charge sheet lists the job's unrecovered disbursements as `pure_agent` lines (one per disbursement, text = kind
   + ref, e.g. "Customs duty — ICEGATE challan 1234567 (paid on your behalf)"), plus our own heads (agency / clearance
   charges, taxable). They go on the domestic group's document (POS by 12(2) / 12(8)).
2. The paper prints a **disbursement schedule** (date, kind, ref, payee, amount) after the lines (A4 `switch` arm), and
   the total "recoverable at actual" separately from the taxable value.
3. **Write-off** (cut 3) of an unrecoverable disbursement: the R14 `writeOffDisbursement` pattern on the
   `PurchaseRecord.lg.wo = { date, reason, by }` stamp; audited; the unrecovered list leaves it out.
4. The client statement (R2-A) shows the reimbursement bills like any invoice; deposits show as advances.

**Files.** In `lg-disb.ts`, `lg-bill.ts` (`billExtras` hook created by B, empty), `parts/logistics/DisbSchedule.tsx`.
Tests: in `tests/lg-disb.test.ts` (schedule, totals, write-off, re-bill after cancel).

#### C4 CB register, KYC fields and the net-presentation journal

**Acceptance criteria.**
1. **Job register** (print window with `escHtml` + CSV): per job — job no., date, client, IEC, GSTIN, BOE / SB no. and
   date, port, invoices raised, disbursements, deposits, status — for any date range ("CBLR Reg 10(k) — records in an
   orderly and itemised manner", LG26).
2. **KYC fields** (cut 2) on the client: `Client.lg = { iec?, kyc?: { verified_on?, by?, method?: 'documents' |
   'visit' | 'both', note? } }` — numbers and dates only, **no document copies or Aadhaar / PAN images** (LG27). A job
   for a client without `kyc.verified_on` shows a hint.
3. **Net-presentation journal** (cut 1, `disb_posting: 'net_journal'`): per month, one manual voucher class
   `Logistics disbursements net` that moves recoveries billed (`rule33` lines of the month) and the matching
   disbursements out of Sales and Expenses (Dr Sales | Cr Disbursement expense, by the smaller of the two, the rest
   left in place), idempotent per month, re-run after edits reverses through a new voucher; through `lg-books-io.ts`.
   Off by default (gross is the ledger's current behaviour; LG11).

**Files.** New: `src/lib/logistics/lg-register.ts`. Tests: `tests/lg-register.test.ts` (register rows, CSV, KYC hint,
net journal amounts and idempotence; P&L totals agree with Books).

### R19-D — Agents, courier, storage and reports

#### D1 Overseas-agent accounts

**User story.** Demo Agent Pte Ltd (Singapore) handles our exports at destination; we split profit 50 / 50 on each
shipment and settle monthly by statement. On job 0001 our share owed to us is USD 150; their destination charges billed
to us are USD 60.

**Acceptance criteria.**
1. An agent is a client + vendor pair (R15-A `Vendor.client_id`) with `Vendor.lg = { kind: 'agent' | 'shipping_line' |
   'airline' | 'co_loader' | 'cfs' | 'transporter' | 'other', foreign?: boolean }`.
2. **Agent notes** on the job page: "Debit agent" (our invoice / debit note to the agent in USD — B2 regime for an
   overseas recipient: export of services under LUT when 2(6) is met, LG30) and "Agent's bill" (purchase in USD —
   import of services: the existing RCM-on-import-of-services flow, IGST at the head's rate, LG17; a hint, never
   automatic, when the head is freight on a foreign leg, LG3).
3. **Agent statement**: per agent per month, our open notes vs theirs (USD), imported agent statement rows matched by
   job / HBL through the R15-C importer (`lg-books-io` → `tv-statements` readers), differences listed.
4. **Settle**: netting through `postNetting` (R15-A, same markers) for the matched amount; the net USD paid / received
   through the existing receipt / payment with FX gain / loss (`fx-gain.ts`). A FEMA hint on set-off of export
   receivables against import payables (AD-bank conditions, LG31).
5. Agents view (`agents`): agents list with open USD balance, statement, settle.

**Files.** New: `src/lib/logistics/lg-agents.ts`, `components/logistics/AgentsView.tsx`,
`src/i18n/areas/logistics-r19d.ts`. Tests: `tests/lg-agents.test.ts` (notes in USD, POS / supply type, statement match,
netting markers, FX gain on settlement, purchase contract).

#### D2 Courier manifests (cut 2 drops COD)

**User story.** I am a courier franchisee. Demo Traders sends 3 dockets in November; one box 40 × 30 × 20 cm weighing 3
kg is charged as 5 kg. On 1 Dec I bill every account customer for November in one go.

**Acceptance criteria.**
1. **Table `lg_manifests`** (dated by the month end, synced, audited, right `doc.create`): **one row per account customer
   × month**: `{ id, client_id, period, dockets: Docket[], bill_id?, cod?: { collected, remitted: { date, amount, ref
   }[] } }`; `Docket = { no, date, network?, dest_pin?, zone, pcs, kg, dims?, chargeable_kg, service: 'standard' |
   'express' | 'cargo', charge, fsc_pct?, cod_amount?, status?: 'booked' | 'delivered' | 'rto' }`. Docket numbers unique
   per company. Import of dockets from the network's CSV (the R15-C mapping UI; 5,000 rows per file).
2. `docketCharge(d, zones, settings)` (pure, `lg-courier.ts`): chargeable = max(kg, volume ÷ 5000) rounded up to 0.5
   kg; zone rate card `{ zone, first_500g, addl_500g, min? }`; fuel surcharge % (`fsc_pct`); RTO at the card's RTO %.
3. **Monthly run**: every manifest of the period without a live bill → one tax invoice per customer (SAC 996812, 18 %,
   POS by 12(8) — the customer's State for registered customers; an international docket to a foreign consignee billed
   to an Indian shipper → POS 96 by the 12(8) proviso, IGST, on its own document) **through one
   `localDb.invoices.saveMany`**; the bill's annexure lists the dockets (print + CSV); `lg = { manifest_id, period,
   count, kg }`. Undo = cancel the bills (numbers stay used); the manifest is billable again.
4. **COD** (cut 2): COD collected on delivery is the shipper's money — a receipt into a liability ledger "COD payable to
   shippers" (created once), remitted by a payment with the manifest ref; never revenue, never an invoice line (LG40).
5. e-Way hint on a docket with declared value > ₹50,000: "The courier agency may furnish Part A on the consignor's
   authorisation (Rule 138(1) proviso)" — a hint, LG20.
6. Courier view (`courier`): manifests by month, import dockets, rate card / zones, "Bill month", COD position.

**Files.** New: `src/lib/logistics/lg-courier.ts`, `components/logistics/CourierView.tsx`. Tests: `tests/lg-courier.test.ts`
(volumetric, slabs, FSC, RTO, POS 96 split, one `saveMany` for 50 customers, undo, COD never in revenue, volume 60,000
dockets).

#### D3 Storage billing (cut 1)

**Acceptance criteria.**
1. **Table `lg_storage`** (dated by the month end, synced, audited, `doc.create`): one row per client × plan × month:
   `{ id, client_id, plan_id, period, days: { date, in?, out?, held }[] | { opening, ins, outs, closing },
   produce?: 'agri' | 'rice' | null, bill_id? }`. Plans in `logistics_settings.storage_plans`: `{ id, name, unit:
   'pallet' | 'sqft' | 'cbm' | 'mt', basis: 'per_day' | 'per_month' | 'peak', rate, handling_in?, handling_out?,
   min_monthly? }`.
2. `storageCharge(row, plan)` (pure, `lg-storage.ts`): Σ held × rate (per day) or peak × rate (per month), handling in
   / out × rates, minimum; agri produce / rice → exempt line (Sl. 54(e) / 24) on a Bill of Supply when the whole bill is
   exempt, else exempt and taxable lines on one tax invoice (LG21).
3. Monthly run through **one `saveMany`**; `lg = { storage_id, period }`. A hint for clients whose goods sit in our
   warehouse: "Your client may need to declare this warehouse as an additional place of business (LG41)".
4. Storage view (`storage`): plans, months, "Bill month".

**Files.** New: `src/lib/logistics/lg-storage.ts`, `components/logistics/StorageView.tsx`. Tests:
`tests/lg-storage.test.ts` (per-day / per-month / peak, handling, minimum, agri exempt / mixed bill, one `saveMany`).

#### D4 Alerts and reports

**Acceptance criteria.**
1. Bell (`lg-alerts.ts`, behind one `gate('logistics', 'logistics', () => import('../../lib/logistics/lg-alerts'))` row
   in `NotificationBell.tsx`): jobs delivered > 7 days and unbilled; disbursements unrecovered > 30 days; deposits short
   on a job with an assessed BOE; manifests of last month unbilled after the 5th.
2. Reports (CSV, in the costing view): margin by lane / client / salesperson / month; agent balances; disbursements
   ageing; deposits position.
3. **TDS on receipts** (cut 3): receipts from clients with TDS deducted (existing receipt TDS field) by job; the TDS base
   shown as own charges only (reimbursements out, LG23 default), labels by date through `ita2025.ts` (Sec 393 Sl. 6 from
   1 Apr 2026).

**Files.** New: `src/lib/logistics/lg-alerts.ts`. Edit: `NotificationBell.tsx` (one `gate` row). Tests:
`tests/lg-alerts.test.ts` (each notice, pack gate), `tests/lg-costing.test.ts` (reports).

---

## 5. Work packages

Four packages, each one agent in its own worktree.

**Merge order:** **A first** (family group, `LG` regexes, registry, rules / types / shared scaffolds, the `lg` record
key, the `JOB` series, template mount, the `shipments` tab and desk with `jobs` / `rates` views). Then **B** (C's
reimbursement lines and D's agent notes ride on B's billing engine and regime). **C and D** follow in either order and
can run in parallel; they share only the registry, rules, types, demo, help and the desk's view map, and each edits
`lg-bill.ts` only through the `billExtras(job, ctx)` hook that B creates empty.

### R19-A — Logistics core (A1–A4)

| | Files |
|---|---|
| Owned (new) | `src/lib/logistics/lg-{shared,registry,settings,profile,job,weight,jobs-import,heads,rates,print}.ts`, `src/lib/logistics-rules.ts`, `src/types/logistics-r19.ts`; `components/logistics/{LogisticsKindPicker,ShipmentsDesk,JobsView,JobForm,RatesView}.tsx`; `components/templates/parts/LogisticsBlock.tsx` + `logistics-paper.module.css`; `src/i18n/areas/logistics-r19a.ts`; `src/lib/demo/profile-logistics.ts`; `docs/features/logistics-r19.md`; tests `lg-profile`, `lg-registry`, `lg-rules`, `lg-pack-gate`, `lg-job`, `lg-heads`, `lg-print` |
| Owned (edit) | `vite.config.ts` (one row), `tests/bundle-config.test.ts`; `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`, the wizard card, `FeaturesPanel.tsx`; `page-tabs.ts` (`TIME_TABS` row), `Time.tsx` (one `import.meta.glob` row); `TemplateEngine.tsx`, `paper-helpers.ts`, `invoice-defaults.ts` (one token); series registration (`JOB`); `tests/help-registry.test.ts`, `tests/help-glossary.test.ts`, `tests/docs-links.test.ts` (`LG`) |
| Budget | first paint 0; core **≤ 11 kB** |

### R19-B — Billing, GST and job costing (B1–B4)

| | Files |
|---|---|
| Owned (new) | `src/lib/logistics/lg-{bill,issue-io,regime,tax-io,costing,books-io}.ts`; `components/logistics/{BillingView,CostingView}.tsx`, `components/logistics/parts/RegimeChip.tsx`; `src/i18n/areas/logistics-r19b.ts`; tests `lg-bill`, `lg-regime`, `lg-costing` |
| Owned (edit) | the desk's view map (adds `billing`, `costing`); `pending-changes.ts` (one entry); the purchase-bill form (one lazy row); `industry-packs.ts` `exportsvc` row `alsoPacks` (if A did not) |
| Shared (§6) | rules `// R19-B`, types `// R19-B`, demo block, `lg` sub-fields `heads`, `regime`, `pos_reason`, `fx`; `lg_jobs.charges`; `PurchaseRecord.lg` (job / head / accrual) |
| Budget | core **≤ 10 kB** |

### R19-C — Customs broker desk (C1–C4)

| | Files |
|---|---|
| Owned (new) | `src/lib/logistics/lg-{disb,deposits,recv-io,register}.ts`; `components/logistics/CustomsView.tsx`, `parts/logistics/DisbSchedule.tsx`; `src/i18n/areas/logistics-r19c.ts`; tests `lg-disb`, `lg-deposits`, `lg-register` |
| Owned (edit) | the desk's view map (adds `customs`); `lg-bill.ts` `billExtras` (disbursement lines) |
| Shared (§6) | rules `// R19-C` (none expected), types, demo; `PurchaseRecord.lg.disb` / `on_behalf` / `ref` / `wo`; `AdvanceRecord.lg`; `Client.lg`; `lg` sub-field `disb` |
| Budget | core **≤ 9 kB** |

### R19-D — Agents, courier, storage and reports (D1–D4)

| | Files |
|---|---|
| Owned (new) | `src/lib/logistics/lg-{agents,courier,storage,alerts}.ts`; `components/logistics/{AgentsView,CourierView,StorageView}.tsx`; `src/i18n/areas/logistics-r19d.ts`; tests `lg-agents`, `lg-courier`, `lg-storage`, `lg-alerts` |
| Owned (edit) | the desk's view map (adds `agents`, `courier`, `storage`); `NotificationBell.tsx` (one `gate` row); `lg-bill.ts` `billExtras` (agent notes) |
| Shared (§6) | rules `// R19-D` (none expected), types, demo; tables `lg_manifests`, `lg_storage` (registry block D); `Vendor.lg`; `lg` sub-fields `manifest_id`, `storage_id`, `agent` |
| Budget | core **≤ 9 kB** |

**Combined:** first paint **0** at every merge; core **≤ 39 kB gross** + 1 kB lead reserve = **≤ 40 kB**; Hindi pack
≤ 8 kB. Each package runs `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run check:size`
on its branch (one at a time), and again after rebase; the last package also runs `npm run test:e2e` and
`npm run verify:offline`.

---

## 6. Shared-file protocol

| File | Who | Rule |
|---|---|---|
| `vite.config.ts`, `tests/bundle-config.test.ts` | A | One row `f-logistics` in one commit. Later packages never edit them |
| `src/types/logistics-r19.ts` | A creates | One `declare module` block per package (`// R19-A` … `// R19-D`). A declares for every package in one commit: record key `lg?: LgSnapshot` with sub-objects `job_id`, `job_no`, `mode`, `dir`, `refs`, `ports`, `weights` (A), `heads`, `regime`, `pos_reason`, `fx` (B), `disb` (C), `manifest_id`, `storage_id`, `agent`, `period`, `count`, `kg` (D); settings `logistics_kind`, `logistics_settings`; `PurchaseRecord.lg`; `AdvanceRecord.lg`; `Client.lg`; `Vendor.lg`; the `lg_jobs` / `lg_rate_sheets` / `lg_manifests` / `lg_storage` row types |
| `src/store/invoice-defaults.ts` | A | **One edit:** `export const R19_RECORD_KEYS = ['lg'] as const;` and the token in `R9_RECORD_KEYS` after R18's. No line key |
| `src/lib/logistics-rules.ts` | A creates | Sections `// R19-A` (`LG_SAC_RULES`, `LG_RATE_RULES`, `LG_EXEMPT_RULES`), `// R19-B` (`LG_POS_RULES`, `OCEAN_RCM_RULES`, `EINV_EXEMPT_RULES`), `// R19-C` (`CBLR_RULES`: records 10(k) `verified: true`, retention and 10(n) `false`), `// R19-D` (none expected). Every row has `from`, `source`, `verified` |
| `tax-rules.ts`, `tds-rules.ts`, `ita2025.ts`, `transport-works-rules.ts`, `prof-rules.ts`, `trading-rules.ts` | — | **Not edited** (read through `lg-tax-io.ts`). The R5-B GTA row's "verify" text is a lead decision (LG8) |
| `src/lib/logistics/lg-registry.ts` | A creates | `LG_TABLE_ACTIONS` / `LG_WATCHED`, one block per package: A `lg_jobs`, `lg_rate_sheets`, `logistics_settings`; D `lg_manifests`, `lg_storage`. `tests/lg-registry.test.ts` pins both maps |
| `backup.ts`, `sync-engine.ts` (`DATED`: `lg_jobs` by `date`, `lg_manifests` / `lg_storage` by month end), `trust/open-export-schema.ts` | A, D | Append-only blocks `// R19-A`, `// R19-D` |
| `series-counters` (`JOB`) | A | One registration, branch prefixes as `LR` |
| `TemplateEngine.tsx` | A | One lazy import + mount of `LogisticsBlock` (after `SocietyBlock`, before `GstBody`, never on `receipt`). B–D add `switch` arms in `parts/logistics/*.tsx` |
| `paper-helpers.ts` | A | `lgLineText` appended after `hsLineText` |
| `industry-packs.ts` | A | Four ids; `PACK_TABS` block `// R19` (desk + eight views); `logistics` added to the `exportsvc` row's `alsoPacks` |
| `page-tabs.ts` | A | One `TIME_TABS` row `shipments`. B–D add **views**, not tabs |
| `components/logistics/ShipmentsDesk.tsx` (view map) | A creates, B–D append | One lazy entry per view in a `// R19-x` block |
| `Time.tsx` | A | One `import.meta.glob` row over `components/logistics/*Desk.tsx` and one tab branch |
| `lg-bill.ts` | B creates, C / D append | `billExtras(job, ctx)` hook: C adds disbursement lines, D adds agent notes; each in its own `// R19-x` block |
| purchase-bill form | B | One lazy job-picker row (C / D reuse it, never add another) |
| `shop-presets.ts`, `checklist-steps.ts`, `features-catalog.ts`, the wizard, `FeaturesPanel.tsx` | A | Appended blocks `// R19` after the R18 blocks |
| `NotificationBell.tsx` | D | One `gate` row |
| `pending-changes.ts` | B | One entry (57th Council e-commerce delivery services, LG19) |
| `src/lib/help/topics-packs.ts`, `glossary.ts`, `discover-r6-tabs.ts`, `palette/synonyms.ts` | A–D | Each package writes its own topics and Ctrl+K titles in its own `// R19-x` block with its views. Glossary ≤ 8 terms for the round (chargeable weight, HBL / MBL, pure agent, POS 96, duty deposit, CB register, W/M, profit share) |
| `src/lib/demo/profile-logistics.ts` | A creates | One block per package; ≤ 0.8 kB gz in all; Demo company only |
| `tests/purchase-contract.test.ts` | B, C, D | Append `lg-costing`, `lg-disb`, `lg-agents`, `lg-alerts` |
| `tests/e2e/smoke.mjs` | A–D | One appended `step(...)` block each, in merge order |
| `docs/features/logistics-r19.md` | A creates | One section per package with its bundle numbers and the `f-logistics` chunk size |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md`, `docs/CA_REVIEW.md` | lead | After merge: the Round 19 company-data paragraph in `AGENTS.md` (tables, object, `logistics_kind`, four packs, desk tab `shipments` on `/time`, series `JOB`, "Round 19 invoice snapshots live under ONE record key `lg` — never add keys", "every module that writes a Round 19 table must `import './lg-registry'`", the `f-logistics` group, "a job is a `lg_jobs` row, not a cost centre", "batch billers use `saveMany`"); table rows in ARCHITECTURE; §19 LG items and the total (685 → 729) in CA_REVIEW |

### Storage summary

| Key / field | Package | Kind | Backed up | Synced | Audited | Right (`lg-registry`) |
|---|---|---|---|---|---|---|
| `logistics_settings` (heads, split, accrue, deposits, posting, volumetric, zones, storage plans) | A (sub-fields B–D) | object | yes | yes (singleton) | yes | `settings.manage` |
| `lg_jobs` (+ B `charges`, C `kyc_ok`, D `courier`) | A | table, dated (`date`), series `JOB` | yes | yes | yes | `doc.create` |
| `lg_rate_sheets` | A | table, not dated | yes | yes | yes | `master.edit` |
| `lg_manifests` | D | table, dated (month end) | yes | yes | yes | `doc.create` |
| `lg_storage` | D | table, dated (month end) | yes | yes | yes | `doc.create` |
| settings `logistics_kind` | A | additive | yes | yes | yes | — |
| record key `lg` | A (sub-fields B–D) | additive record key (one token in the lazy `invoice-defaults` chunk) | yes | yes | yes | — |
| `PurchaseRecord.lg`, `AdvanceRecord.lg`, `Client.lg`, `Vendor.lg` | B, C, D | additive | yes | yes | yes | — |
| `import_runs` rows of kinds `lg_jobs`, `lg_dockets`, `lg_agent_statement` | A, D | existing table | yes | yes | yes | existing |
| Accrual / net-presentation vouchers; COD ledger | B, C, D | existing tables | yes | yes | yes | existing |

No migration (everything is additive). Personal data: client and consignee names / addresses as on today's client
record; KYC as dates and method only (no document images, Aadhaar or PAN copies); docket consignee names are not stored
(PIN code and zone only).

---

## 7. E2E steps (production build, `tests/e2e/smoke.mjs`)

**Rule for every step:** after any action that writes, wait for the write to reach IndexedDB with
`readJson(page, '<table>', fallback, predicate, 15000)` **before** any `page.goto`, `page.reload` or in-app navigation
that re-reads storage (the R16-B fix `d0a89fb`). Seeds written with `writeJson` are followed by a reload only after
`readJson` confirms them. A `check(...)` on stored data always uses the predicate form. Batch steps check the **count**
of new invoices with a predicate, never a single row.

Seed numbers (sender Maharashtra, registered; client Demo Exports, Maharashtra, GSTIN; rate ₹84.00 / USD on the
currency master for 2026-11-05):
- Job 0001: export, air, BOM → SIN, `dest_country: 'SG'`, gross 480 kg, dims → chargeable **500 kg**.
- Freight group (POS 96, IGST 18 %): air freight USD 1,000 → ₹84,000; IGST ₹15,120; total **₹99,120.00**.
- Local group (POS 27, CGST + SGST): handling ₹5,000 + documentation ₹2,000 + clearance ₹3,500 = ₹10,500; CGST ₹945
  + SGST ₹945; terminal charges ₹1,800 (`rule33`); total **₹14,190.00**.
- Costs: co-loader USD 800 → ₹67,200 (+ IGST ₹12,096, ITC); trucker ₹2,500 (GTA, RCM) → job revenue ₹94,500, cost
  ₹69,700, margin **₹24,800 (26.2 %)**; the ₹1,800 recovery outside both.
- Job 0002 (import, sea FCL, 1 × 40HC): deposit ₹2,00,000; duty ₹1,85,430 (ICEGATE); CFS ₹12,000 (in the client's
  name); agency charges ₹6,000 + GST ₹1,080 → reimbursement bill ₹2,04,510; after the deposit **₹4,510** due.

1. **R19-A:**
   - `check:size`: initial at the baseline, ≤ 5 initial files; the build has an `f-logistics` chunk.
   - Fresh company → wizard → "Freight forwarding, customs clearance, courier or warehouse" → *Forwarder + customs
     broker*, registered → lands on `/time?tab=shipments&view=jobs`; Time shows the Shipments tab; the sidebar gains no
     item (Time was added to modules).
   - Rates → defaults → **wait** for `logistics_settings.heads.length ≥ 10`.
   - New job (export, air, BOM → SIN, SG, dims 5 × (120 × 100 × 50 cm) = 3.0 m³ ÷ 6000 → 500 kg, gross 480) → chargeable shows 500 kg → save →
     **wait** for `lg_jobs` to hold one row with `number === 'JOB/FY26-27/0001'` → reload → the list shows it.
   - F1 opens the Shipments help; Ctrl+K "job file" finds the jobs view.
2. **R19-B:**
   - Job 0001 → set status delivered → charge sheet as seeded → "Bill job" → **wait** until `invoices` has 2 rows with
     `lg.job_id` of job 0001 → reload.
   - `page.goto('/invoice/<freight id>')`: place of supply "96 — Other Countries", IGST ₹15,120.00, total ₹99,120.00,
     the "Sec 12(8) proviso" line printed, USD 1,000 at ₹84.00 printed. Local invoice: CGST ₹945.00 + SGST ₹945.00,
     terminal charges outside GST, total ₹14,190.00.
   - "Bill job" again → "already billed" and the invoice count stays 2 (predicate).
   - Add the co-loader bill (USD 800, IGST) and the trucker bill tagged to job 0001 → **wait** for both in `purchases`
     with `lg.job_id` → Costing: revenue ₹94,500.00, cost ₹69,700.00, margin ₹24,800.00 (26.2 %).
3. **R19-C:**
   - New job 0002 (import, sea FCL) → Customs → "Add deposit" ₹2,00,000 → **wait** for the advance with
     `lg.job_id` and `pass_through: true` → "Add disbursement" duty ₹1,85,430 (ICEGATE ref) and CFS ₹12,000 → **wait**
     for two `purchases` rows with `lg.on_behalf`.
   - Bill job 0002 with agency charges ₹6,000 → **wait** for the invoice → its paper shows the disbursement schedule
     (two rows) and total ₹2,04,510.00 → "Apply deposit" → **wait** for the `advance_id` payment → balance ₹4,510.00.
   - Cash book for the day shows the ₹2,00,000 deposit once and no row for the application.
4. **R19-D:**
   - Agents: job 0001 → "Debit agent" USD 150 → **wait** for the document (export of services under the seeded LUT) →
     agent's bill USD 60 → statement shows net USD 90 receivable → "Settle by netting" → **wait** for the netting rows.
   - Courier (pack ticked in Settings → Features): import three dockets for Demo Traders (one 40 × 30 × 20 cm, 3 kg →
     5 kg) → **wait** for `lg_manifests` → "Bill month" → **wait** until the invoice count rises by exactly 1 → the
     annexure lists 3 dockets.
   - Storage (pack ticked): plan ₹15 / pallet / day + ₹50 in; 20 pallets × 30 days → "Bill month" → **wait** for the
     invoice → ₹10,000.00 + GST ₹1,800.00.
   - The bell lists "Job 0002 — disbursements unrecovered" only after its reimbursement bill is cancelled (cancel →
     **wait** for the status → reload → bell).

---

## 8. Open questions — with the default the builders will use

| # | Question | Default chosen | Why |
|---|---|---|---|
| 1 | New business type or a card? | Wizard card; `transport` + `logistics_kind`; explicit modules (+ `time`) and packs. | Zero shell bytes; R12–R18 pattern; R5-B pack stays off unless asked. |
| 2 | Where do the screens live? | One tab `shipments` on `/time`, eight views. | Job desks live there (R14 matters, R15 trips, R17 sites); `/distribution` is gated by inventory / R5-B packs. |
| 3 | Job = cost centre (R15 trip precedent) or a table? | **Table `lg_jobs`**; documents point to it by `lg.job_id`. | 7,000 jobs a year would flood every cost-centre picker; cost centres stay for branches / lanes. |
| 4 | One invoice per job or per POS? | One per (POS, currency, kind); "single" setting refused when POS differ. | One document carries one POS (GSTR-1). |
| 5 | Origin / destination charges with freight | Separate supplies, own POS (12(2)); composite setting per head. | Common practice; CA LG9. |
| 6 | Pure-agent heads | Duty, CFS, port, DO, shipping line, insurance in the client's name. | Rule 33 (P); LG10, LG36, LG37. |
| 7 | Duty deposits | Existing advance with `pass_through`, no GST. | CN-C2 precedent; cash readers unchanged. |
| 8 | Disbursements in the books | Gross (today's ledger); optional monthly net journal. | No postings change; LG11. |
| 9 | Courier dockets storage | One manifest row per customer × month. | 60,000 dockets a year (R17 muster precedent). |
| 10 | 3PL client stock | Typed occupancy only; no SKU stock; no godown kind. | WMS is a non-goal; `consignment` kind has agency semantics (R8-C). |
| 11 | Volumetric divisors | Settings (6000 / 5000 / 1,000 kg per CBM). | Commercial conventions, not law. |
| 12 | Ocean freight RCM / e-Invoice exemption for GTA | Hint / reader rows `verified: false`. | Notifications not read. |
| 13 | HBL / HAWB print | Not built. | Negotiable document; legal effect (§1.6). |
| 14 | Budget overrun | Cut in §3 order; no extension. | R13–R18 history. |

---

## 9. CA review items (LG1–LG44) — for `docs/CA_REVIEW.md` §19

★ = changes what a document prints or a return reports. Defaults as §8.

| Id | Question for the CA | Default in the app |
|---|---|---|
| LG1 ★ | Sec 12(8) IGST for domestic transport of goods (incl. courier): registered recipient → its location; unregistered → where the goods are handed over. For a forwarder's freight billed to a registered client in another State, IGST. Right? | As stated |
| LG2 ★ | Export freight (air / sea / courier) by an Indian forwarder to an Indian exporter: POS = foreign destination (12(8) proviso from 1 Feb 2019), IGST under Sec 7(5), recipient's ITC allowed (Circular 184/16/2022). Does this also apply when the forwarder only arranges the freight (agent) rather than carrying it? | POS 96, IGST |
| LG3 ★ | After Sec 13(9) was omitted (1 Oct 2023), freight and courier billed to a recipient outside India follow 13(2): an export of services when Sec 2(6) is met (LUT). Freight billed by an overseas agent to us: import of services (RCM)? | As stated; RCM hint |
| LG4 ★ | Commission / brokerage from overseas principals and carriers (intermediary): 13(8)(b) until its omission (Finance Act 2026, assent reported 30 Mar 2026); 13(2) after. Confirm the date and treatment of invoices raised before it for services after it. Cross-ref PS4. | By invoice date |
| LG5 ★ | Classification: when is a forwarder's freight a transport service (sea 5 % / air 18 % / multimodal) and when "supporting services in transport" (996713 C&F, 18 %)? Customs clearance 996712. Multimodal SAC (996799?). | Principal with own HBL / HAWB → mode rate; agent → 996713 |
| LG6 ★ | Rates: vessel 5 % (ITC on goods other than ships not taken); air 18 %; multimodal 12 % (to 21 Sep 2025), then 5 % without an air leg / 18 % with one, domestic only; international multimodal → leg rates. Any change after N 15/2025? | As stated |
| LG7 | Multimodal 5 % ITC: only on transport inputs and capped at 5 % (N 15/2025 illustration). The app shows the cap as a note on tagged bills; it does not block ITC. Enough? | Note only |
| LG8 | GTA option 18 % with ITC from 22 Sep 2025 (N 15/2025, read this round): the R5-B row still says "verify". May it be marked verified? A forwarder re-billing a GTA's road leg: GTA service (RCM / FCM) or part of its own freight? | Lead decision; hint |
| LG9 ★ | Origin / destination charges (THC, documentation, DO, BL fee) with freight: separate supplies with their own POS (default) or ancillary to the freight (composite, freight POS 96)? | Separate; composite per head setting |
| LG10 ★ | Pure agent (Rule 33): customs duty paid through the CB's ICEGATE account, CFS / port / DO / shipping-line charges invoiced in the importer's name — all four conditions met when the authorisation is in the job file? Duty paid from the importer's own ICEGATE: not on our books at all? | `rule33` lines; checklist |
| LG11 | Disbursements gross (expense + recovery) vs net (journal) in the P&L; Sec 44AB turnover; reimbursements outside the registration turnover (as PS82). | Gross; optional net journal |
| LG12 | Client duty deposits: not an advance for our supply (no GST on receipt, no Rule 50 receipt voucher tax); presentation as a liability; refund of the excess. | Advance `pass_through`, 0 % |
| LG13 | Rule 34(2): exchange rate for services "as per GAAP for the date of time of supply". RBI / FBIL reference rate or bank TT rate? Is a typed rate acceptable? | Currency master or typed |
| LG14 ★ | e-Invoice: forwarders / CHAs / couriers / warehouses above the threshold must e-invoice; a GTA's invoice is exempt (N 13/2020 via Rule 54(3)). A forwarder that also issues LRs: mixed? | As stated |
| LG15 ★ | GSTR-1: export freight billed to an Indian registered recipient with POS 96 reported in B2B with POS "96" (Circular 184 Sl. 4), not Table 6A. Same in e-Invoice (`Pos: 96`, B2B). | As stated |
| LG16 | Ocean freight RCM on imports (entry 10, N 10/2017-IGST(R)) omitted from 1 Oct 2023 (N 11–13/2023 as reported); FOB imports with a foreign line? | Hint |
| LG17 | Overseas agent's destination / handling charges billed to us: import of services, IGST under RCM at the head's rate; ITC. | Existing RCM flow; hint |
| LG18 | Courier 18 % (9968); POS 12(8) domestic, 13(2) international (Circular 203); outbound international courier billed to an Indian shipper → 12(8) proviso (POS 96)? | As stated |
| LG19 | 57th Council: delivery services through e-commerce operators 5 % without ITC under Sec 9(5), courier excluded — notification and date? | Pending note |
| LG20 | e-Way: a courier agency may furnish Part A on the consignor's authorisation (Rule 138); the franchisee's duty when the consignor does not. | Hint |
| LG21 ★ | Warehousing 996729 18 %; storage of agricultural produce exempt (Sl. 54(e)), rice (Sl. 24) — any later amendment? Mixed bills (agri + non-agri): one tax invoice with exempt lines? | As stated |
| LG22 | 3PL storage: rent of space (194I) or service (194C) for the client's TDS; GST same 18 %? | 194C label |
| LG23 ★ | TDS by clients on freight / forwarding / clearing (Sec 393 Sl. 6, old 194C): on reimbursements shown separately (Circular 715/1995 Q30)? | Own charges only |
| LG24 | TDS on our payments: transporters 194C(6); sub-agents 194H; non-resident shipping lines (Sec 172, no 195 — Circular 723/1995); overseas agents / airlines (DTAA, 195 → Sec 393(2)?). | Existing rows; hints |
| LG25 | Customs brokerage: 194C or 194J for the client's TDS? | 194C |
| LG26 | CBLR Reg 10(k) records: does a register printed from the books meet "orderly and itemised manner as may be specified"? Retention period (five years reported)? | Register print |
| LG27 | CBLR Reg 10(n) KYC: the app stores IEC, GSTIN and a verified-on date / method only. Enough, or must copies be kept (outside the app)? | Dates only |
| LG28 | CB's own late-payment interest on unrecovered disbursements: GST (Sec 15(2)(d)) on interest charged on a reimbursement? | Not charged by default |
| LG29 | Agency commission received in foreign currency: export of services under LUT; e-BRC / FIRA; overlap with R14 `svcexport`. | Listed there |
| LG30 ★ | Profit share with overseas agents: consideration for a supply (export of services / import of services) or a mere sharing of margin outside GST? | Debit note as export of services |
| LG31 | FEMA: set-off of export receivables against import payables with the same overseas party (AD-bank conditions); netting in the books only as a working paper? | Hint |
| LG32 | Realisation of export-of-services proceeds within the FEMA period; LUT conditions. | R14 realisation list |
| LG33 | Chargeable-weight conventions (air 6000, courier 5000 cm³ per kg; sea 1 CBM = 1,000 kg): purely commercial — any tax effect? | Settings |
| LG34 | Revenue recognition of a job (on departure / arrival / delivery) and accrual of costs at the period end (AS 9 / Ind AS 115). | Bill on delivery; accrual journal |
| LG35 | Demurrage / detention recovered from the client: own supply (18 %) or pure agent when the line's invoice is in the client's name? | Own supply |
| LG36 | Cargo insurance arranged for the client: pure agent when the policy is in the client's name; else insurance-agent services (RCM entry for insurance agents)? | Pure agent |
| LG37 | DO charges / BL fees of the shipping line collected by the forwarder: pure agent if invoiced in the client's name; else re-supply at 18 %? | Pure agent |
| LG38 | "Freight collect" on imports collected from the Indian consignee for the foreign agent: our supply, or collection on behalf (outside turnover)? | Collection on behalf; agent account |
| LG39 | Rate / weight disputes: credit notes under Sec 34 by 30 Nov of the next FY; agent credit notes in USD. | Existing credit notes |
| LG40 | Courier COD collected for shippers: liability, not turnover; any Sec 52 TCS or Sec 194-O issue for a courier franchise? | Liability ledger |
| LG41 | 3PL warehouse holding client goods: the client must declare it as an additional place of business (Sec 25 / Rule 8)? Our duty? | Hint |
| LG42 | Unregistered transporters (TRANSIN) and Part B updates by a forwarder acting as transporter. | Hint |
| LG43 | (Market) ≈ 6,500 customs brokers in FFFAI's associations (as reported); official count? | — |
| LG44 | Section labels by date on TDS / TCS working papers (194C → Sec 393 Sl. 6 from 1 Apr 2026). | `ita2025.ts` |

---

## 10. Test plan (summary)

| Layer | What | Where |
|---|---|---|
| Unit (node:test) | Every engine in `src/lib/logistics/`; rule rows by date and the `verified` set; import graph (`logistics-rules.ts` only from lazy logistics modules; engines import only first-paint / family modules; bridges are exactly `lg-*-io.ts`, ≤ 4); registry maps; pack gate; print snapshot compare | `tests/lg-*.test.ts` |
| Statutory regression | POS at 2019-01-31 / 02-01 (proviso), 2023-09-30 / 10-01 (13(9) → 13(2)), 2026-03-29 / 30 (intermediary); multimodal 2025-09-21 / 22 with and without air; agri storage exempt; pure-agent lines outside value | `tests/lg-regime.test.ts`, `tests/lg-storage.test.ts` |
| Contracts with existing readers | POS-96 B2B in GSTR-1 B2B (not 6A) with IGST; LUT agent invoice in 6A; `rule33` outside GSTR-1 / 3B / e-Invoice / e-Way; deposits and applications through cash readers (`no-cash-readers`); netting markers; FX gain; purchase contract (`lg-costing`, `lg-disb`, `lg-agents`, `lg-alerts`) | `tests/lg-regime.test.ts`, `tests/lg-deposits.test.ts`, `tests/lg-agents.test.ts`, `tests/purchase-contract.test.ts` |
| Batch | Month-end job billing, courier run and storage run each make exactly one `localDb.invoices.saveMany` call (spy), numbers consecutive, all-or-nothing on a validation error | `tests/lg-bill.test.ts`, `tests/lg-courier.test.ts`, `tests/lg-storage.test.ts` |
| Volume | 10,000 jobs; 60,000 dockets in 600 manifest rows; 600-job month batch under 2 s; job P&L reads only the job's documents | `tests/lg-job.test.ts`, `tests/lg-courier.test.ts`, `tests/lg-bill.test.ts` |
| Regex | `LG1` read whole, never `G1`; `G1` still `G1` | `tests/docs-links.test.ts`, `tests/help-registry.test.ts` |
| Build | `f-logistics` in `tests/bundle-config.test.ts`; `check:size` per commit; Hindi in core unchanged | `scripts/check-bundle-size.mjs` |
| Existing suites | Must pass unchanged: `transport-*`, `freight-*`, `consignment-*`, `advances*`, `netting*`, `fx*`, `ps-disb*`, `ps-pos*`, `tv-statements*`, `gst-reports*`, `einvoice*`, `eway*`, `batch-*`, `help-registry`, `docs-links`, `i18n-areas`, `industry-packs`, `hs-*` | — |
| E2E | §7, appended `step(...)` blocks, each write awaited in IndexedDB (predicate form) before navigation | `tests/e2e/smoke.mjs` |
| Offline | `npm run verify:offline` after the last merge | `scripts/verify-offline.mjs` |

---

## 11. Size budget per package (gz, core = English precache)

| Package | First paint | Core (cap) | Planned split | Stop rule (cuts in §3 order) |
|---|---|---|---|---|
| R19-A | **0** (`lg` token in a lazy chunk) | **≤ 11** | Desk + jobs view + form 3.4, weight / job engine 1.0, heads + rates view 2.0, rules (A rows) 0.6, paper part 1.0, picker 0.7, import 0.8, strings 1.1, help / Ctrl+K / checklist / packs 0.6, demo 0.3, registry / shared / settings 0.5 | At 11 → cut 1 (container table), 2 (lane rate sheets), 3 (import) |
| R19-B | 0 | **≤ 10** | Billing engine + view 3.0, regime engine + chip + POS rules 2.2, costing engine + view 2.0, bridges (issue / tax / books) 0.9, accruals 0.6, FX / LUT 0.4, strings 0.9 | At 10 → cut 1 (LUT link), 2 (accrual journals) |
| R19-C | 0 | **≤ 9** | Disbursements + view 2.6, deposits + recv bridge 1.6, schedule part 0.6, register + CSV 1.0, KYC 0.5, net journal 0.7, strings 0.9, help 0.3 | At 9 → cut 1 (net journal), 2 (KYC fields), 3 (write-off) |
| R19-D | 0 | **≤ 9** | Agents engine + view 2.2, courier engine + view 2.4, storage engine + view 1.6, alerts + reports 0.9, strings 1.0, help 0.3 | At 9 → cut 1 (storage), 2 (COD), 3 (TDS-on-receipts view) |
| **Round** | **0** | **≤ 39 + 1 reserve = 40** | Hindi pack ≤ 8 kB (`lang-hi-logistics`) | Core stays ≤ baseline + 40 kB (≈ 3,235 kB) |

Each package writes before / after numbers (initial, entry, core, Hindi pack, Hindi in core, `f-logistics`,
`ShipmentsDesk`) in its section of `docs/features/logistics-r19.md`.

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Packages overrun (R13–R15 1.2–2.5 ×; R17 / R18 within caps) | M | M | Caps with pre-ranked cuts; one desk; shared strings in one area; reuse of `saveMany`, advances, pure-agent, netting, statements, FX; numbers per commit |
| Wrong POS / rate (export freight as 6A instead of B2B-96; composite vs separate; principal vs agent classification) — tax charged wrongly | M | **H** | Dated rows from primary texts (Circulars 184 / 203, N 15/2025, Rule 33); POS reason printed on every document; LG1–LG9 ★; per-head override audited |
| Core headroom after this round ≈ 65 kB | H | M | Lead plans Round 20 smaller or a size round; `f-logistics` stays out of core-adjacent chunks |
| Volume (7,000 jobs, 60,000 dockets a year) slows lists and P&L | M | M | Jobs as a table (not cost centres), dockets inside monthly rows, one-pass indexes, volume tests |
| Disbursement money misread as revenue (gross ledger) | M | M | Recoveries excluded from job P&L and turnover; optional net journal; LG11 |
| Deposits mishandled as taxable advances | L | H | `pass_through` + 0 % enforced by the bridge; voucher wording; tests |
| `f-logistics` captures nothing because engines import shared lazy code (`pure-agent.ts` sits in `f-trade`) | M | M | Bridges `lg-*-io.ts`; `chunks.json` check per package; import-graph test |
| CA-id regex reads `LG1` as `G1` | M | L | A adds `LG` and the explicit test |
| Unverified rows (ocean RCM, e-Invoice GTA exemption, CBLR retention / KYC, Sec 172 TDS) | H | M | `verified: false`, hints only, CA items |
| First paint creeps | L | H | One token only; `check:size` at each merge |
| Confusion with R5-B LR / freight bills | L | L | Distinct names (jobs vs LRs), help cross-links; packs are a union; "own lorries" adds R5-B explicitly |
