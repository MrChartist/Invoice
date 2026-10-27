# PRD — Round 13: manufacturing MSMEs beyond R4-A (engineering / fabrication job shops, textiles and garments, plastics and packaging, printing and packaging presses, food processing / FMCG small units)

Status: draft for build · Drafted 2026-10-27 · Baseline: branch `claude/elegant-cannon-cwapiv` at `6560185`. Merged on
the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–13, Round 7 (hotel), Round 8 (trading), Round 9 (retail), Round 10
(services), Round 11 (construction) and Round 12 (agriculture). No other round is being built in parallel; §5 / §6 still
list the files Round 13 shares with earlier rounds' registries.

Companion documents:
- `docs/CA_REVIEW.md` §13 — the manufacturing CA items **MF1–MF32**, added with this PRD.
- Raw research (URLs and the claim taken from each; P = primary, S = secondary, V = vendor's own claim):
  `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/r13/round13-sources.md`.

Every item follows `AGENTS.md`:
- local-first and serverless: no DGFT, ICEGATE, CPCB EPR portal, FSSAI FoSCoS, MSME Samadhaan / Udyam portal, MCA21,
  PLI-portal, e-way or GST portal calls; files, `wa.me` links, Web Serial devices the user picks and the device camera
  only;
- vanilla CSS Modules with tokens; templates use the `accent` variable only (Critical Rule 5);
- invoice snapshots never change: everything a manufacturing document prints is snapshotted on the document;
- Indian-FY numbering for every new series;
- bare dates parsed as local days;
- statutory values date-keyed and append-only, in a rule file kept out of first paint;
- GST, TCS, MSME, export-authorisation and incentive outputs labelled as working papers ("verify with your CA").

---

## 1. Problem statement

Phase 7 and Round 4 (R4-A) gave the app a solid **material** side of manufacturing, and later rounds added pieces that a
factory reuses:
- **Phase 7 / 7M / 7S** (`docs/features/manufacturing.md`, `job-work.md`): multi-level BOMs with by-products,
  co-products and scrap (fixed-rate or cost-share), manufacturing journals with batch / serial / alternate units, stock
  journals, physical stock, reorder, a single-horizon MRP (`mrp.ts`, low-level codes, buy / make, POs from the plan), job
  work out / in with Rule 55 challans, the principal's material register, Sec 143 return clocks, ITC-04 (CSV + an
  unverified JSON) and the e-way JSON for job-work **out** (sub-type 4);
- **R4-A** (`docs/features/production-r4.md`): production orders `WO/FY…` with a WIP godown, issue / output / return /
  write-off, make-to-order and MRP → orders, order costing with price / usage / yield / conversion variances, batch
  genealogy and recall, QC hold and release, landed-cost vouchers;
- **R4-C** (`trade-trust-r4.md`): exporter profile, LUT register, export realisation, IRMs / e-BRC, **RoDTEP, drawback and
  IGST-refund claims** with scrip use and sale, Bill of Entry duty;
- **R8 / R9 / R12**: distributor schemes and claims (`tr-schemes.ts`, `tr-claims.ts`), TCS presets for specified goods
  including **scrap** (`trading-rules.ts`, Sec 394(1) 2% from 1 Apr 2026), size × colour grids on bills
  (`rt-matrix.ts`), garment price-band GST (`rt-bands.ts`), the karigar fine-metal account (`rt-karigar.ts`), FSSAI on
  the agri licence register (`ag-licences.ts`), mill outturn / yield on production orders (`ag-yield.ts`);
- **books**: MSME payables with 43B(h) and MSMED Sec 16 interest (`msme.ts`, `MsmeCard`), the seller's Udyam number on
  the profile driving a 45-day note (`payment-terms.ts`), payroll with a `production` (piece-rate) pay head,
  cost centres, standard costs, the inverted-duty refund register (`gst-cash-refunds.ts`, no Rule 89(5) maths).

But the owner's test is **"each and everything has a perfect area in our invoice"**, and a job shop, a garment unit,
a moulder, a press or a namkeen unit still runs its day outside the app (§2.2, §2.4):

1. **No shop floor.** There are no work centres, no routing (operations, set-up and run times), no job card, no machine
   hours, no operator, no operation-wise rejection or scrap weight. A production order knows materials only; a
   fabrication shop's real cost is machine and labour time.
2. **No capacity and a flat MRP.** The plan has no lead times, no dated buckets and no machine load, so "can we deliver
   400 flanges by the 15th?" has no answer.
3. **WIP is valued at material cost only.** Conversion (labour, power, machine hours) never reaches the WIP or the
   finished goods in the stock engine; the inventories note has one line ("stock-in-trade / goods") where Schedule III
   asks for raw materials, WIP, finished goods, stores and spares, and scrap separately.
4. **Engineering job shops** have no drawing / revision register, no weight-based quotation (steel kg from dimensions,
   machine hours, scrap credit), no first-article / inspection report, and their **scrap sales** (turnings, off-cuts,
   punchings) carry no metal-scrap RCM / GST-TDS logic and no link to the job-card scrap weights.
5. **Garment and textile units** have no style-level cut plan (lay, plies, ratio), no lot / bundle tickets, no fabric
   consumption against standard, no cut-make-trim (CMT) flow to fabricators by bundle, and no ledger for **karigars**
   paid by the piece who are not on payroll. The 22 Sep 2025 changes (MMF fibre 18 → 5%, MMF yarn 12 → 5%, garments
   ≤ ₹2,500 a piece 5% / above 18%) have no manufacturer-side class.
6. **Plastics and packaging** have no run / shot batch with regrind %, no material balance (resin in = good + regrind +
   rejects + loss), and no EPR / recycled-content register a brand owner asks its packaging supplier for.
7. **Printing presses** quote by sheets, ups and impressions with make-ready and wastage; nothing in the app computes
   paper from GSM and sheet size, plates, impressions or a job ticket, and the printing GST split (printed goods vs
   printing job work, N 15/2025 5% entry) has no class.
8. **Food / FMCG small units** (namkeen, bakery, spices, pickles, sweets) have no batch cost card per pack, no shelf-life
   days that set best-before / expiry on the batch, no minimum-remaining-shelf-life rule at dispatch, and their FSSAI
   number is not printed on the invoice although the FSSAI order of 2021 requires it.
9. **Cross-cutting statutory gaps:** the e-way JSON for job-work **returns** (sub-type 6) is defined but never used; ITC-04
   has no job-worker reconciliation and no scrap-at-job-worker line; the seller's Udyam number is **not printed** on the
   invoice; there is no receivable-side 43B(h) view for a supplier MSE, no MSME Form-1 working paper for a company buyer;
   no Advance Authorisation / EPCG export-obligation register; no PLI / state-subsidy / interest-subvention register.

**Goal of Round 13:** ship **20 items in four work packages** with mostly disjoint files:
- **MF-A**: the manufacturing profile and the **shop-floor core** — work centres and routings, job cards with machine hours
  and scrap weight, capacity and a dated MRP, WIP with conversion cost, and the manufacturing paper — 5 items;
- **MF-B**: **engineering, plastics and printing** — drawings and revisions, weight-based job quotes, scrap and by-product
  sales, moulding / extrusion runs with regrind and EPR, print estimates and job tickets — 5 items;
- **MF-C**: **textiles and garments** — styles and cut plans, lots and bundles, CMT job work (with the job-work e-way and
  ITC-04 depth), karigar piece-rate ledger, textile tax classes and the inverted-duty working paper — 5 items;
- **MF-D**: **food / FMCG and the statutory desk** — batch cost cards and FSSAI, shelf life and distributor schemes,
  MSME both ways (43B(h), Form-1), incentives (PLI, subsidies) and export authorisations (Advance Authorisation, EPCG),
  Schedule III inventory split — 5 items.

### How the manufacturing profile switches on (no clutter for others)

- **No new `BusinessType`** (`shop-mode.ts` is first paint and stays untouched). Round 12 already writes `manufacturer`
  with `agri_kind`; Round 13 adds the parallel additive settings field **`mfg_kind`** (the R8 `trade_kind` / R9
  `retail_kind` / R11 `construction_kind` / R12 `agri_kind` approach), with a sub-choice where the trade splits:

  | `mfg_kind` | Who | Sub-choice | business_type written | Why |
  |---|---|---|---|---|
  | `engineering` | Fabrication / machining / sheet-metal / auto-component job shop, foundry, tool room | `make_to: 'drawing' \| 'catalogue'` | `manufacturer` | Already the type for factories; no "Pick your kind" step fires for a `manufacturer` without `agri_kind` today |
  | `textile` | Spinning, weaving / knitting, processing house, garment / made-ups unit, CMT fabricator | `textile_stage: 'yarn' \| 'fabric' \| 'processing' \| 'garments'` | `manufacturer` | Same |
  | `plastics` | Injection / blow moulding, extrusion, film, laminates, corrugated / flexible packaging converter | `plastics_process: 'moulding' \| 'extrusion' \| 'film' \| 'corrugation'` | `manufacturer` | Same |
  | `printing` | Offset / digital / flexo press, packaging printer, label printer | — | `manufacturer` | Same |
  | `food` | Namkeen, bakery, sweets, spices, pickles, ready-to-eat, beverages (small units, not R12 mills / dairies) | — | `manufacturer` | Same |
  | `other` | Any other factory | — | type unchanged | Shared core only |

  A company may carry **both** `agri_kind` and `mfg_kind` (a rice mill that also packs namkeen): the packs are the union;
  the landing is the one picked last. Every kind sets explicit `modules` and `industry_packs` lists, so `PACK_OF_TYPE`
  never adds a pack and every existing `manufacturer` company sees exactly what it saw.
- **Six new packs** in `industry-packs.ts` (lazy module; `PackId` is a type, zero bytes): `shopfloor` (the shared core:
  work centres, routings, job cards, capacity, WIP conversion, statutory desk), `fabrication`, `garments`, `plastics`,
  `press`, `foodmfg`. Every `mfg_kind` turns on `shopfloor` plus its own pack (`other` → `shopfloor` only).
- **Placement, never a new route or sidebar item:** desk tabs on **`/manufacturing`**, the existing lazy route of the
  `inventory` module. A new list **`MFG_PACK_TABS`** in `page-tabs.ts` (the R9 `INVENTORY_PACK_TABS` pattern; views in
  `&view=`): `floor` (pack `shopfloor`; views `centres`, `routings`, `cards`, `load`, `wip`), `shop` (pack `fabrication`;
  views `drawings`, `quotes`, `inspection`, `scrap`), `moulding` (pack `plastics`; views `runs`, `balance`, `epr`),
  `press` (views `estimates`, `tickets`, `paper`), `garments` (views `styles`, `cutplans`, `bundles`, `cmt`, `karigars`),
  `food` (pack `foodmfg`; views `costcards`, `shelflife`, `schemes`), and `statutory` (pack `shopfloor`; views `msme`,
  `incentives`, `authorisations`, `inventories`). Every kind keeps the `inventory` module, so **`PACK_ROUTES` is not
  changed** (`/manufacturing` is a module route).
- Settings → Features shows a **"Manufacturing profile"** row for every company (a trader who assembles may turn on
  `shopfloor` only), with the same choices plus "Custom". Turning a pack off deletes nothing.
- The **manufacturing paper** (MF-A5) is not pack-gated: it prints whenever a document carries the `mf` snapshot, so a
  company that turns a pack off still reprints its old drawing-referenced invoices, print-job bills and food invoices.
- **Scrap sales, Udyam on the invoice and FSSAI on the invoice** are useful to every factory: their prompts follow the
  profile, but the printed fields follow the sender snapshot / `mf` snapshot only.

### Budgets the packages must respect

Measured by the PRD author on the baseline (`vite build` + `node scripts/check-bundle-size.mjs`, gzip -9, KiB):

| Budget | Now | Limit | Headroom | Round 13 share |
|---|---|---|---|---|
| Initial JS (first paint, gz) | **184.7 kB** | 185 kB | ≈ 0.3 kB | **≤ +0.06 kB total** (target ≈ +0.02) |
| Entry chunk (gz) | 71.2 kB | 90 kB | 18.8 kB | ≤ +0.1 kB (lazy-import map churn only) |
| Total JS (gz) | **3,147.3 kB** | 3,400 kB | 252.7 kB | **≤ +60 kB** |

**Lesson from Round 12.** Its four packages were planned at 11 / 8 / 7 / 9 kB (35 kB) and measured **+47.3, +29.0,
+22.1 and +30.3 kB** (plus +10.3 kB of QA follow-up) — over three times the plan. The largest single items were the
English + Hindi string areas (≈ 6–10 kB per package), desk kits that pulled shared helpers into each desk chunk, and
bell / POS-strip helpers that became shared chunks. Round 13 therefore sets per-package budgets that include the strings
and adds the rules below; if it still overruns, the round stops at **+100 kB** (3,247 / 3,400) and the lead decides —
there is room, but first paint is the hard limit and the total is the one-time offline precache.

Rules:
- **First paint: ≈ 0 (≤ +0.06 kB), by design.**
  - **One new record key, no line key.** Everything Round 13 prints from an invoice lives under one additive record key
    **`mf`** (the manufacturing snapshot, with a per-line map `mf.lines[lineId]`), kept by `normalizeRecord` through a
    one-element `R13_RECORD_KEYS = ['mf']` spread into the existing `R9_RECORD_KEYS` list in `invoice-defaults.ts`
    (the R12 `ag` precedent: +15 B measured). The Udyam number and category print from the **sender snapshot**
    (`invoice.sender.msme_udyam`, new additive `msme_category`), so they cost no record key.
  - If first paint is above 184.95 kB when MF-A starts, MF-A stops and asks the lead before adding the key. Default:
    add `mf` (the only structured way to reprint drawing / revision, batch / best-before and print-job particulars).
  - No `PACK_ROUTES`, `PACK_OF_TYPE`, `TABLE_ACTIONS`, `WATCHED_TABLES`, `no-cash.ts`, `tax-rules.ts` or shell edit.
    Table rights and audit labels register at runtime (`src/lib/mfg/mf-registry.ts`, the `tr-registry.ts` /
    `ag-registry.ts` pattern).
  - Template additions are lazy parts (the R4-C1 `ExportBlock` / R12 `AgriBlock` pattern), mounted only when `mf` (or a
    sender Udyam / FSSAI field) is present; `TemplateEngine.tsx` is in the editor / preview chunk, not first paint.
- **Total JS for the round ≤ +60 kB gz**: MF-A ≤ 18 kB, MF-B ≤ 14 kB, MF-C ≤ 14 kB, MF-D ≤ 14 kB (strings included).
- **Everything is lazy.** No new route. Each desk tab is one lazy chunk mounted by `Manufacturing.tsx`; its views are lazy
  sub-chunks; editor, production-order and bill-modal parts are lazy sub-rows mounted only when their pack or snapshot is
  present.
- **Strings stay with their views.** Each package has one i18n area, but the area is split by desk (`mfg-r13a.ts`,
  `mfg-r13a-paper.ts` …) so a desk chunk does not carry another desk's strings; help text stays in the lazy topic files.
- **No desk kit.** Shared UI comes from existing components (`LinesGrid`, `ItemFilterBar`, `controls.module.css`); a new
  shared component is allowed only when two desks use it and it is ≤ 1 kB gz.
- **Rule data is a chunk.** Statutory values go in `src/lib/mfg-rules.ts` (new, imported only by lazy screens and engines,
  never by `tax-rules.ts`, `shop-mode.ts` or the shell). Values that already live elsewhere **stay there and are imported
  read-only**: TCS on scrap and the 27EQ code (`trading-rules.ts`), garment / footwear / made-ups price bands
  (`retail-rules.ts`), export realisation and customs (`trade/trade-rules.ts`), MSME days and the bank rate
  (`tax-rules.ts`), ITC-04 frequency (`tax-rules.ts` `ITC04_RULES`). `tests/mf-rules.test.ts` checks the import graph.
- **Help text is data.** Topics go in the existing lazy topic files (`topics-packs.ts`, `topics-statutory.ts`,
  `topics-books.ts`); glossary terms in `glossary.ts`.
- **Icons: reuse only** (grep before use; a new icon name fails review). Candidates already imported on the baseline:
  `Factory` (floor), `ClipboardCheck` (inspection, job cards), `ListTree` (routings), `Scale` (scrap weight, balance),
  `Printer` (press), `Package` (moulding / packaging), `ClipboardList` (garments desk;
  `Scissors` is **not** imported); `CalendarDays` (load, shelf life), `ShieldCheck` (FSSAI, authorisations), `Landmark` (incentives),
  `FileText`, `Receipt`, `Users` (karigars). MF-A re-greps before its first commit.
- Each package records before / after numbers in its section of `docs/features/manufacturing-r13.md`.

### Non-goals

These need a server, a regulator or partner system, a device protocol, or are outside billing and books:
- DGFT (Advance Authorisation / EPCG applications, ANF 4F EODC filing, RoDTEP / drawback claims, Appendix 4R / 4RE
  rate lookups), ICEGATE, CPCB EPR portal returns and certificates, FSSAI FoSCoS (licences, annual returns), MSME
  Samadhaan / Udyam / MCA21 filings, PLI scheme portals, e-way / GST portal upload. The app produces files and working
  papers only.
- Machine connectivity (PLC / OPC-UA / MQTT, OEE from sensors), CAD / CAM (DXF nesting, marker making), shop-floor
  barcode terminals beyond the device camera, finite scheduling with sequence optimisation (Gantt drag-and-drop with
  automatic re-sequencing), APS.
- Quality management systems (ISO / IATF document control, PPAP submission packs, SPC charts beyond a simple
  inspection report), lab testing for FSSAI, product certification (BIS, CE).
- Labour-law compliance beyond the existing payroll (contract labour licences, Factories Act registers, Code on Wages
  minimum-wage tables): the karigar ledger flags, it does not compute statutory wages.
- Cost audit under Sec 148 (cost-record formats, CRA forms): MF-D5's inventory and conversion figures help, nothing more.

---

## 2. Findings

### 2.1 What manufacturing MSMEs use and praise / complain about (research)

P = official text read; S = secondary (press, blog, review site); V = vendor's own claim. Full list in
`round13-sources.md`. Independent reviews of Indian MSME manufacturing software are thin; vendor claims are marked.

| Segment | Tools they use | Praised for | Complaints / gaps | Source |
|---|---|---|---|---|
| All small factories (accounts-first) | Tally Prime (stock journals, manufacturing journal, cost centres, job work), Busy (multi-level BOM, production orders, job work pending, WIP), Marg | GST books, job work challans, BOM, batch; "material consumption vs output" reports | No routing, machine hours or capacity; job costing by stock journals and cost centres; shop-floor time kept in registers / Excel | V tallysolutions.com (job costing guide), V busy.in (manufacturing, auto-parts, garment, packaging pages); Marg: nothing found |
| Cloud SME inventory | Zoho Inventory (composite items only), Zoho ERP (assemblies vs manufacturing orders with operations and time) | Simple bundles | "Yet to support manufacturing modules" (Zoho's own FAQ) | V zoho.com KB |
| Growing factories | ERPNext (workstations, operations, routing on the BOM, job cards with planned vs actual time, capacity-planning window, overtime / holiday flags), Odoo MRP (work centres, routings, tablet work orders with timers, OEE, subcontracting, scrap) | Shop floor, capacity errors before accepting orders, OEE dashboards | ERPNext capacity errors are blunt (raise the window or cut quantity); Odoo OEE / subcontracting in a higher-priced tier; both need implementation partners | V docs.frappe.io; S cleverence / ecosire (Odoo) |
| Garment units | Garment add-ons on ERPNext and Indian garment ERPs; Busy garment edition; Excel cut sheets | Style → size / colour matrix, cutting plan (lay, plies, ratio, marker), bundle tickets, operation-wise piece rate | "Core work orders assume one finished item and time-based routing, not a size curve produced operation by operation" (vendor); karigar payments in a notebook | V ecosire.com garment app; V busy.in garment |
| Printing presses | Print MIS (Tharstern, Solprint, Easeprint, Pentaforce / Print Fast Q), Excel estimates, Tally for books | Estimates by press speed, make-ready, paper, ink, plates, finishing; job ticket → invoice; Tally link | MIS cost and implementation; "many presses run without scientific management" (DRDO paper) | V printlogicsystem.com; S printweek.in; S indianprinterpublisher; V slideshare (Pentaforce) |
| Plastics / packaging converters | Busy packaging edition, Tally, Excel run sheets | Job-wise material and costing | Regrind and material balance by hand; brand owners now ask for EPR / recycled-content data | V busy.in packaging; S EPR guides (greensutra, agileregulatory) |
| Food / FMCG small units | Tally / Busy / Marg with batch and expiry, distributor apps | Batch, expiry, schemes | Batch cost per pack, shelf-life rules at dispatch and FSSAI fields kept outside | V busy.in FMCG; P FSSAI order (2021) |

**What carries over to an offline app:**
- **The job card as the unit of truth** — operation, work centre, operator, start / stop, good / rejected quantity, scrap
  weight, machine hours — feeding WIP, costing, capacity, piece-rate pay and scrap stock, on top of the existing
  production orders (which ERPNext / Odoo-class tools have and Tally / Busy do not).
- **Planning that answers a due date**: a dated MRP with lead times and a simple load-vs-available chart per work
  centre, with warnings, not optimisation.
- **Trade documents of each sub-sector** in the same books: drawings and inspection reports, cut plans and bundles,
  print estimates, regrind balances, batch cost cards.
- **Statutory papers** a small factory's CA asks for each year: MSME both ways, scrap TCS / GST, job-work e-way and
  ITC-04, export authorisations, incentives, Schedule III inventories.

Offline work, Hindi, the recycle bin, full audit and real books (GSTR-1 / 3B, Tally export, TDS / TCS returns) are our
edge.

### 2.2 Anatomy of the manufacturing documents (every element needs a place)

"Doc" = where it must print. "Today" = the baseline. Items close each row.

| # | Element | Who | Doc | Today | → |
|---|---|---|---|---|---|
| 1 | Udyam registration no. and category (micro / small / medium) of the seller | every MSE seller | every invoice | on the profile, drives an editor note; **not printed** | A5, D3 |
| 2 | "Payable within 45 days (MSMED Act Sec 15); interest u/s 16 beyond" clause | MSE seller to a business buyer | invoice terms | editor note only | A5, D3 |
| 3 | Customer's drawing no., revision, PO line, part no. | engineering | quote, invoice, DC, inspection report | free text | B1, A5 |
| 4 | Heat no. / material grade / test certificate ref | engineering, foundry | invoice line, inspection report | batch no. only | B1, B3 |
| 5 | Operation, work centre, machine hours, operator, good / rejected / scrap kg | every factory | job card, production report | — | A2, A3 |
| 6 | Weight-based price: raw kg (from dimensions × density), machining hours, surface treatment, scrap credit | engineering | quotation | — | B2 |
| 7 | Scrap / by-product sale: material, kg, rate, GST class, RCM / Sec 51 TDS note, TCS 394(1) | every factory | scrap invoice | TCS preset only | B3 |
| 8 | Run / shot: machine, mould / die, cavities, cycle time, resin + masterbatch + regrind kg, good / rejects | plastics | run sheet, batch label | — | B4 |
| 9 | EPR registration no., plastic category, recycled-content % | plastics / packaging supplier to brand owners | invoice, CoA | — | B4, A5 |
| 10 | Print job: size, colours, ups, sheets, impressions, paper (GSM, size, kg), plates, finishing | press | estimate, job ticket, invoice | — | B5, A5 |
| 11 | Style, colour, size breakdown, lot no., bundle no. | garments | cut report, DC to fabricator, invoice annexure | size × colour grid on bills (R9) | C1, C2, A5 |
| 12 | Fabric issued vs consumed per piece vs standard, end bits / cut waste | garments | cut report, CMT reconciliation | — | C1, C3 |
| 13 | Fabricator / karigar challan by bundle (pieces out / in / rejected / short), job rate per piece | garments, textiles | challan, karigar bill | job-work challan by item | C3, C4 |
| 14 | Price band per piece, HSN, MMF / cotton class | textiles | invoice | band on sale lines (R9) | C5 |
| 15 | Batch no., mfg / packing date, best-before / use-by, MRP, FSSAI no. | food | invoice line, DC | batch / expiry / MRP exist; FSSAI not printed | D1, D2, A5 |
| 16 | Remaining shelf life at dispatch vs the customer's minimum | food | DC, invoice | — | D2 |
| 17 | Scheme / claim reference (distributor scheme, secondary discount) | food / FMCG | invoice, claim note | R8 schemes and claims | D2 |
| 18 | e-Way bill for job-work return (sub-type 6) / job worker to job worker / supply from job worker's premises | job workers, principals | e-way JSON | out (sub-type 4) only | C3 |
| 19 | AA / EPCG no., SION / norm, EO due, duty saved, shipping bills against it | exporters | shipping-bill annexure, EO register | — | D4 |
| 20 | Incentive claims: PLI period, eligible sales, claim, received; state subsidy sanction | eligible units | register, grant note | — | D4 |
| 21 | Inventories split: raw materials, WIP, finished goods, stores and spares, packing, scrap | every company | Schedule III note | one line | A5, D5 |

### 2.3 Statutory rules (as understood; every row is a CA item)

Confidence: **H** = statute / official text read or long settled; **M** = consistent secondary sources or recalled
text; **L** = sources conflict or nothing found. **Verified** = the claim was read in a primary source this round or in
two independent secondary sources that agree; otherwise **verify with CA**.

| Rule | What applies | App today | Source | Confidence / status |
|---|---|---|---|---|
| MSE payment (MSMED Sec 15 / 16) | Pay a micro / small supplier by the agreed day, capped at 45 days from acceptance; 15 days without an agreement; compound interest at 3 × bank rate (Sec 16), not deductible (Sec 23) | `msme.ts` (payables), 45-day note on our invoices | S taxguru, taxmann, Tally | H / **verified** (existing) → MF20 |
| Sec 43B(h) | Sums due to MSEs unpaid past the Sec 15 limit deductible only on payment (AY 2024-25 on); MSE only (medium excluded); traders' Udyam (OM of 2 Jul 2021) for priority-sector lending only, so payments to pure traders are outside (as reported); 2025 Act section number by `ita2025.ts` | payables tracker; no receivable view | S taxguru, taxmann, Tally | M / verify (traders, 2025 Act section) → MF20, MF21 |
| Udyam number on the invoice | **No rule found** requiring it; buyers are told to classify suppliers from it, and a supplier that never told the buyer may not get the benefit (one view) | not printed | S taxguru, taxmann (conflicting) | L → MF22 (print it by default as practice) |
| MSME Form-1 (MCA) | Half-yearly return by a **company** with MSE dues outstanding beyond 45 days: Apr–Sep by 31 Oct, Oct–Mar by 30 Apr; supplier, PAN, amount, date due, reason; penalty figures conflict (Sec 405(4) vs 450) | — | S taxguru, cleartax, Tally help | M (form, dates) / L (penalty) → MF23 |
| GST 22 Sep 2025 — textiles | MMF fibre 18 → 5%, MMF yarn 12 → 5%; garments / made-ups ≤ ₹2,500 a piece 5%, above 18% (was 12% above ₹1,000) | Bands on sale lines (R9 `PRICE_BAND_RULES`, unverified) | P PIB note (17 Sep 2025); S newsonair, Tribune (MATEXIL), Lok Sabha reply as reported | H / **verified** (two agree, one primary) → MF1 |
| Textile job work | Job work on textiles and textile products (ch 50–63) 5% (N 11/2017 entry 26 as amended 2017); garment stitching etc. moved from 18% to 5% in Oct 2017 (as reported) | Typed rate on `jobChargesLine` | S fibre2fashion (2017), CITI (2017) | M / verify (current text) → MF2 |
| Printing | Printing job work on goods of ch 48 / 49 12 → 5% from 22 Sep 2025 (N 15/2025-CT(R) entry 26, as cited by a Gujarat AAR); the same AAR held the 5% entry **not** applicable where the paper itself is taxed at 18% (residual 18%); printed goods supplied with the printer's own paper are goods (Circular 11/11/2017, recalled); cartons / boxes 4819 12 → 5%; writing / printing paper 4802 12 → 18% (one source); plastic packaging (3923 / 3920) 18% unchanged | — | S taxguru (AAR), printweek, busy.in; Circular 11 recalled | M (cartons) / **L** (paper, job-work entry) → MF3, MF4 ★ |
| Residual job work (9988) | "Other" job work: one SAC table says 18% before and after 22 Sep 2025; a Maharashtra AAR applied 12% to 21 Sep 2025 and 18% from 22 Sep 2025 (RMC) | Typed rate | S busy.in SAC, taxguru (AAR) | **L** (conflict) → MF5 ★ |
| Packaged food | Namkeen, sauces, pasta, biscuits and similar packaged foods 12 / 18 → 5% from 22 Sep 2025 (biscuits conflicting in one "expected" table); a 30 Apr 2026 change is mentioned in one source and was not found elsewhere | Typed rates | S Lakshmikumaran & Sridharan, Business Standard (Nomura), Petpooja; busy.in (conflicting) | M / verify → MF6 ★ |
| Scrap GST | Metal scrap (ch 72–81) 18%; **RCM** when bought from an unregistered supplier (N 6/2024-CT(R), from 10 Oct 2024); **GST TDS 2%** u/s 51 on B2B metal scrap above ₹2.5 lakh (N 25/2024-CT; one source says 24/2024); paper waste 4707 12 → 5% (22 Sep 2025); plastic waste 3915 **5% or 18%** (sources conflict) | — | S vjmglobal, taxroutine, taxscan (GSTN advisory); busy.in scrap, carajput schedule | H (metal RCM, TDS) / **verified**; L (plastic waste, N no. of TDS) → MF7, MF8 ★ |
| TCS on scrap | Sec 206C(1) → Sec 394(1) Table of the 2025 Act; **1% → 2% from 1 Apr 2026** (Finance Act 2026); Form 127 replaces Form 27C for the buyer's "used for manufacturing" declaration (as reported); "scrap" = waste from manufacture or mechanical working, not usable as such (Gujarat HC Priya Blue; Madras HC) vs a broader ITAT view covering traded scrap; 27EQ code 6CE | `trading-rules.ts` `TCS_SPECIFIED_GOODS_RULES` (2% row), editor TCS presets | S tdsman, Railway Board order (17 Jun 2026), taxguru; S taxmann (HC), bcajonline | H (rate) / **verified**; M (scope, Form 127) → MF9, MF10 ★ |
| e-Way bill — job work | Inter-State movement to a job worker: e-way bill **irrespective of value**, by the principal or a registered job worker (Rule 138 proviso); intra-State ₹50,000 with State exemptions (e.g. West Bengal for job work); returns: sub-type "job work returns"; a GSTAT ruling left the principal's own goods out of the value of a return (single ruling); documents older than 180 days blocked from 1 Jan 2025 | Out (sub-type 4) only | P Rule 138 text (Goa gazette); S cleartax, Tally, taxguru | H / **verified** (rule); M (State exemptions, return value) → MF11 |
| ITC-04 | Table 4 challans; **5A** back from the same job worker incl. losses and wastes, **5B** through another job worker, **5C** supplied from the job worker's premises incl. losses and wastes; half-yearly above ₹5 crore AATO else annual; waste and scrap at a job worker may be supplied by him (registered) or by the principal from there (Sec 143(5), recalled) | Tables 4 / 5A / 5B / 5C exist; losses from Material In | P GST tutorial (ITC-04 manual); S vjmglobal, Masters India | H / **verified** (tables); M (Sec 143(5) scrap) → MF12 |
| FSSAI on invoices | Licence / registration no. on cash receipts, purchase invoices, cash memos and bills from 1 Oct 2021; not on e-way bills / system documents | Free text on the profile; `fssai` licence kind (R12) | P FSSAI order (8 Jun 2021, effective 1 Oct 2021) | H / **verified** → (FSSAI consultant; MF13 for print placement) |
| Food labelling | FSS (Labelling and Display) Regulations 2020: date of manufacture / packing and expiry / use-by mandatory; best-before optional; date format by shelf life (as summarised); compliance from 1 Jul 2022 | Batch MFG / expiry dates | P FSSAI compendium (2022); S Freyr | M / verify → MF14 |
| Distributor schemes | Circular 251/08/2025-GST (12 Sep 2025): post-sale discounts by financial / commercial credit note do not change the supply value and need no ITC reversal by the dealer; dealer promotion with separate consideration is a taxable service; builds on Circular 92/11/2019 | R8 schemes, claims (TR items) | S taxmann, EY, BDO, Tally | H / **verified** → MF15 |
| Advance Authorisation | DGFT HBP Ch. 4: duty-free (BCD, IGST, cess…) import of inputs physically incorporated (plus fuel / catalysts) against SION, self-declared (HBP 4.07) or Norms Committee norms; manufacturer or merchant tied to a supporting manufacturer; import validity 12 months, EO 18 months (items with fixed 90-day EOP); EODC via ANF 4F; shortfall → duty + interest and a penalty (5 × CIF of the shortfall per the HBP copy read) | — | P HBP 2026 Ch. 4; P myscheme.gov.in; S lawrbit, Shiprocket | H (structure) / **verified**; M (penalty, current periods) → MF16 ★ |
| EPCG | Duty-free capital goods against an EO of 6 × duty saved in 6 years, block-wise (as recalled; not re-read) | — | Recalled | M / verify → MF17 |
| RoDTEP with AA / EOU / SEZ | Extended to 31 Dec 2026 for DTA (Appendix 4R) and AA / SEZ / EOU (Appendix 4RE), rates and caps unchanged (DGFT N 41/2026-27 as reported); drawback on AA exports limited / not available for duties not paid (recalled) | RoDTEP / drawback claims (R4-C `export-incentives.ts`) | S taxguru, PIB summary | M / verify → MF18 |
| PLI and subsidies | Ind AS 20 / AS 12: recognise a grant only with reasonable assurance of compliance and receipt; income-related vs asset-related presentation; income-tax: subsidy is income (Sec 2(24)(xviii) of 1961, 2025 Act mapping not read), capital subsidy reduces actual cost (Explanation 10 to Sec 43(1), recalled); PLI MSME thresholds (₹10 crore investment etc.) only in secondary sources | — | S EY (Ind AS 20); S vyapar, civilsdaily (PLI) | M / verify → MF19 ★ |
| Inventories (AS 2, Schedule III) | Cost includes conversion; fixed production overheads absorbed on **normal capacity**, unabsorbed expensed; abnormal waste expensed; Schedule III sub-heads: raw materials, WIP, finished goods, stock-in-trade, stores and spares, loose tools, others (incl. goods in transit) | One "Inventories" line; WIP at material cost | Recalled (H) | H / verify presentation → MF24, MF25 ★ |
| Inverted duty refund | Rule 89(5): (turnover of inverted supply × net ITC on inputs ÷ adjusted total turnover) − tax payable on the inverted supply × net ITC ÷ ITC availed; input services excluded (VKC Footsteps, SC 2021, recalled) | Refund register (category `INVERTED_DUTY`), no formula | Recalled | H / verify → MF26 |
| Plastic EPR | PWM Rules (as amended 2025 / 2026): producers, importers and brand owners register on the CPCB portal; recycled-content obligation (Cat I rigid 30% in 2025-26 rising; Cat II 10%; Cat III 5%); recycled-content % on the label; FSSAI / CDSCO exemptions | — | S greensutra, agileregulatory, Grant Thornton | M → (environment consultant; MF27 for the GST class of regrind) |
| Contract piece-rate workers | Karigars / fabricators paid per piece who are not employees: TDS 194C (1% individual / HUF, 2% others; ₹30,000 single / ₹1 lakh year thresholds as recalled; 2025 Act Sec 393 labels), no TDS for a transporter-type exception; employees paid per piece go through payroll (`production` pay head) | Payroll `production` calc; R9 karigar ledger (jewellery metal only) | Recalled | M → MF28 |
| Cost records | Companies (Cost Records and Audit) Rules 2014: records above a turnover threshold for listed products (recalled) | — | Recalled | L → MF29 |

### 2.3a The 22 Sep 2025 rate rationalisation and these goods

Notification texts (N 9/2025-CT(R), 15/2025-CT(R), both 17 Sep 2025, as cited) were not read this round; every row is
"as reported" and is stored in `mfg-rules.ts` `MFG_CLASS_RULES` with `verified: false` until a CA answers MF1–MF8.

| Goods / service (HSN / SAC) | Before | From 22 Sep 2025 | Sources | Status |
|---|---|---|---|---|
| MMF fibre (5501–5507) | 18% | 5% | PIB, newsonair, MATEXIL | agree |
| MMF yarn (5401–5406, 5508–5511) | 12% | 5% | PIB, MATEXIL | agree |
| Cotton yarn / fabric, MMF fabric | 5% | 5% (no change reported) | recalled | M |
| Garments / made-ups ≤ ₹2,500 a piece | 5% (≤ ₹1,000) / 12% | 5% | PIB, Lok Sabha reply (reported) | agree (R9 band rows) |
| Garments / made-ups > ₹2,500 a piece | 12% | 18% | PIB, Lok Sabha reply | agree |
| Textile job work (9988, ch 50–63) | 5% | 5% (no change reported) | recalled / 2017 reports | M (MF2) |
| Printing job work on ch 48 / 49 goods | 12% | 5% (entry disputed where paper is 18%) | Gujarat AAR via taxguru, busy.in SAC | **L** (MF3) |
| Residual job work (9988 other) | 12% or 18% | 18% | Maharashtra AAR (RMC); busy.in SAC (18% both) | **L** (MF5) |
| Cartons, boxes (4819 10 / 20) | 12% | 5% | printweek, busy.in | agree (corrugated board conflicting) |
| Writing / printing paper (4802) | 12% | 18% | busy.in (one source) | L (MF4) |
| Plastic packaging, articles (3923, 3920–3921) | 18% | 18% | busy.in | M |
| Paper waste (4707) | 12% | 5% | busy.in, carajput | agree |
| Plastic waste (3915) | 5% / 18% | 5% / 18% | busy.in vs carajput | **L** (MF8) |
| Metal scrap (72–81 waste) | 18% | 18% (RCM from unregistered since 10 Oct 2024) | vjmglobal, taxroutine | agree |
| Namkeen, bhujia, sauces, pasta, noodles, biscuits, chocolates | 12% / 18% | 5% | L&S, Business Standard, Petpooja | agree (biscuits: one conflicting table) — MF6 |

The app ships these as **class suggestions by date** (a typed rate always wins, a "rate differs from the class (MFn)"
soft notice shows); old documents keep their rates (snapshots).

### 2.4 Verified against the code (`6560185`)

Verdicts: **Exists** (done, file given), **Partial** (part done, gap named), **Missing**. Each row was checked by grep
(`routing`, `work centre`, `machine hour`, `capacity`, `piece`, `regrind`, `impression`, `shelf`, `advance authori`,
`EPCG`, `PLI`, `metal scrap`, `MSME-1`, `work-in-progress`: zero hits in manufacturing code outside unrelated uses —
hotel folio routing, cold-storage capacity, builder drawings) or by reading the file; "→" names the Round 13 item.

#### Shop-floor core

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Sub-profile pattern, runtime registry | Exists | `applyTradeKind` … `applyAgriKind` (`shop-presets.ts`); `tr-registry.ts`, `ag-registry.ts` | Reused by A1 |
| Profile for factories | Partial | `manufacturer` type with `PRESETS.manufacturer`; `agri_kind` only for agri | `mfg_kind` → A1 |
| Pack tabs on `/manufacturing` | Missing | `MFG_TABS` is a fixed list; pack tabs exist on `/inventory` (`INVENTORY_PACK_TABS`) | `MFG_PACK_TABS` → A1 |
| BOM (multi-level, by- / co-products, scrap %) | Exists | `manufacturing.ts`, `types/manufacturing.ts` | Reused |
| Production orders, WIP godown, issue / output / close | Exists | `production/orders.ts` | Operations added → A2, A3 |
| Work centres, routings, operations | Missing | — | A2 |
| Job cards (operation log, time, operator, rejects, scrap kg) | Missing | — (only `log` milestones on the order) | A3 |
| Piece-rate pay for employees | Exists | payroll `PayHeadCalc 'production'` | Fed from job cards → A3, C4 |
| MRP | Partial | `mrp.ts` (single horizon, no lead times, no dated buckets) | Dated MRP → A4 |
| Capacity / load | Missing | — | A4 |
| Order costing and variances | Exists | `production/costing.ts` (standard conversion typed per order) | Conversion from job cards → A5 |
| WIP valued with conversion cost | Missing | WIP godown at component cost; BOM "additional cost" only on a manufacturing journal | A5 |
| QC hold, genealogy, recall | Exists | `production/qc.ts`, `genealogy.ts` | Inspection report print → B1 |
| Landed cost | Exists | `landed-voucher.ts` | — |
| Manufacturing paper on documents | Missing | `TemplateEngine.tsx` prints no drawing / batch-date / FSSAI / Udyam field | A5 |
| Udyam on the invoice | Partial | `SenderProfile.msme_udyam` (snapshotted), editor note (`payment-terms.ts` `msmeNote`) | Printed field + clause → A5 |

#### Engineering, plastics, printing

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Drawing / revision register, PO-revision match | Missing | — | B1 |
| Inspection / first-article report | Missing | QC pass / fail only | B1 |
| Weight-based quotation (dimensions → kg, hours, scrap credit) | Missing | quotation doc type exists (`QUOTATION`) | B2 |
| Scrap stock from production | Partial | BOM `scrap` outputs at a fixed rate; QC scrap journals | Scrap kg from job cards, scrap register → B3 |
| Scrap sale: TCS 394(1) preset | Exists | `trading-rules.ts` (`scrap` 2% from 2026-04-01), editor TCS presets | Prompt on scrap classes → B3 |
| Metal-scrap RCM (buy) / Sec 51 GST TDS (sell) | Missing | — | B3 |
| Run / batch with regrind, material balance | Missing | — | B4 |
| EPR / recycled-content register | Missing | — | B4 |
| Print estimate (sheets, ups, impressions, paper by GSM) | Missing | — | B5 |
| Printing GST classes | Missing | — | B5 |

#### Textiles and garments

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Size × colour variants and grid on bills | Exists | `variants.ts` (8.85), `rt-matrix.ts` (RT-C2) | Grid on production orders / cut plans → C1 |
| Garment price bands | Exists | `rt-bands.ts`, `retail-rules.ts` `PRICE_BAND_RULES` (5% / 18% at ₹2,500 from 2025-09-22) | Manufacturer-side classes → C5 |
| Cut plan (lay, plies, ratio), fabric consumption | Missing | — | C1 |
| Lot / bundle tickets and tracking | Missing | batches only | C2 |
| CMT job work by bundle | Partial | job work out / in by item (`job-work.ts`) | Bundles, pieces, shortages → C3 |
| e-Way JSON for job-work returns / job worker to job worker | Partial | `eway-job-work.ts` (sub-type 4); `EWAY_SUB_JOB_WORK_RETURN = 6` unused | C3 |
| ITC-04 depth | Partial | Tables 4 / 5A / 5B / 5C, losses (`itc04.ts`); JSON unverified | Job-worker reconciliation, scrap at job worker, challans without Material In → C3 |
| Karigar / fabricator piece-rate ledger (non-employees) | Partial | jewellery karigar fine-metal ledger (`rt-karigar.ts`) | Piece-rate ledger → C4 |
| Inverted-duty refund maths | Partial | `gst-cash-refunds.ts` register (no Rule 89(5) formula) | C5 |

#### Food / FMCG and the statutory desk

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Batch, expiry, FEFO, MRP guard | Exists | batches, `allocateFefo`, R9 MRP guard | Reused |
| Batch cost per pack (recipe, yield, packing) | Partial | order costing per production order | Cost card → D1 |
| FSSAI no. on the invoice | Partial | `fssai` licence kind (R12 `ag-licences.ts`, agri pack only) | Profile field + print → D1, A5 |
| Shelf-life days → expiry, minimum remaining shelf life at dispatch | Missing | expiry alert days only | D2 |
| Distributor schemes and claims | Exists | `tr-schemes.ts`, `tr-claims.ts`, `pricing.ts` (R8) | Food preset + Circular 251 note → D2 |
| MSME payables, 43B(h), Sec 16 interest | Exists | `msme.ts`, `MsmeCard` | Receivable side, Form-1 → D3 |
| Incentive register (PLI, subsidies) | Missing | — | D4 |
| RoDTEP / drawback / IGST refund | Exists | `trade/export-incentives.ts` (R4-C2) | AA link (4RE) → D4 |
| Advance Authorisation / EPCG | Missing | — | D4 |
| Schedule III inventory split | Missing | `notes-auto.ts` `inventoryNote` (one line) | D5 |

**Totals:** 45 rows checked (core 16, engineering / plastics / printing 10, textiles 9, food / statutory 10): **14
exist** (reused as they are), **11 partial**, **20 missing**. Round 13 closes every partial / missing row; §2.2's 21
document rows map onto them.

---

## 3. Ranked list: what to build now

Value 1–5 (5 = every business of that kind meets it every day). Effort S = 1, M = 2, L = 3. Score = value ÷ effort.

| Rank | Id | Gap | Who needs it | Value | Effort | Score | Package |
|---|---|---|---|---|---|---|---|
| 1 | MF-A1 | Manufacturing profile (picker, packs, desk tabs, checklist, help, sample data) | every factory | 5 | S | 5.0 | A |
| 2 | MF-A5 | Manufacturing paper: Udyam + MSE clause, drawing / rev, batch dates, FSSAI, print-job and CMT particulars | every factory | 5 | S | 5.0 | A |
| 3 | MF-A3 | Job cards: operations done, machine hours, operator, rejects, scrap kg | every factory | 5 | M | 2.5 | A |
| 4 | MF-A2 | Work centres and routings | every factory | 5 | M | 2.5 | A |
| 5 | MF-B3 | Scrap and by-product sales (register, GST / RCM / GST TDS, TCS 394(1)) | every factory | 5 | S | 5.0 | B |
| 6 | MF-D3 | MSME both ways: Udyam receivables 43B(h), interest claim, Form-1 paper | every MSE seller, company buyers | 5 | S | 5.0 | D |
| 7 | MF-C2 | Lots and bundle tickets | garments | 5 | M | 2.5 | C |
| 8 | MF-C1 | Styles and cut plans, fabric consumption | garments | 5 | M | 2.5 | C |
| 9 | MF-C4 | Karigar / fabricator piece-rate ledger | garments, textiles, engineering | 5 | M | 2.5 | C |
| 10 | MF-B5 | Print estimates and job tickets | presses | 5 | M | 2.5 | B |
| 11 | MF-A4 | Dated MRP and capacity load | every planner | 4 | M | 2.0 | A |
| 12 | MF-C3 | CMT job work by bundle; job-work e-way returns; ITC-04 depth | garments, every principal | 4 | M | 2.0 | C |
| 13 | MF-B1 | Drawings, revisions and inspection reports | engineering | 4 | M | 2.0 | B |
| 14 | MF-D1 | Food batch cost cards and FSSAI | food | 4 | S | 4.0 | D |
| 15 | MF-D2 | Shelf life at dispatch; distributor scheme preset | food / FMCG | 4 | S | 4.0 | D |
| 16 | MF-B2 | Weight-based job quotes | engineering | 4 | M | 2.0 | B |
| 17 | MF-B4 | Moulding / extrusion runs with regrind and EPR | plastics | 4 | M | 2.0 | B |
| 18 | MF-C5 | Textile classes and inverted-duty working paper | textiles | 3 | S | 3.0 | C |
| 19 | MF-D5 | WIP with conversion, Schedule III inventories split | every company with stock | 4 | M | 2.0 | D |
| 20 | MF-D4 | Incentives and export authorisations (PLI, subsidies, AA, EPCG) | exporters, eligible units | 3 | M | 1.5 | D |
| — | — | Machine connectivity / OEE from sensors, APS sequencing | — | 3 | L | 1.0 | no (devices, scope) |
| — | — | CAD nesting / marker making | — | 2 | L | 0.7 | no (outside billing) |
| — | — | DGFT / CPCB / FoSCoS / MCA filings | — | 3 | L | 1.0 | no (network / regulator) |

All 20 are taken. Note: the WIP-with-conversion **engine** change sits in MF-A5's twin item MF-D5 — A5 is the paper;
D5 the valuation and the inventories split, built on A3's job-card hours (see §5 for the dependency).

---

## 4. Specifications (20 items)

Conventions for every item:
- **Logic and tests.** Pure logic in `src/lib/mfg/mf-*.ts` (new folder), tested with `node:test` in `tests/mf-*.test.ts`.
  UI checks are `step(...)` blocks in `tests/e2e/smoke.mjs` (§7). Existing files are edited only where §6 says.
- **Components** in the new folder `src/components/mfg/`. Each desk is one lazy component mounted by `Manufacturing.tsx`
  (`FloorDesk`, `ShopDesk`, `MouldingDesk`, `PressDesk`, `GarmentsDesk`, `FoodDesk`, `StatutoryDesk`); its views are lazy
  sub-components. Template parts live in `src/components/templates/parts/` (`MfgBlock.tsx`, `MfgAnnexurePage.tsx`,
  `UdyamLine.tsx`), each lazy.
- **Strings.** Each package has its own i18n areas (`defineArea(en, hi)`), split per desk: `src/i18n/areas/mfg-r13a*.ts`
  … `mfg-r13d*.ts`. Hindi uses the trade's words (कार्य केंद्र, मशीन, मशीन घंटे, संचालन / ऑपरेशन, रूटिंग, जॉब कार्ड,
  कारीगर, ठेकेदार, पीस रेट, कटिंग, ले, प्लाई, लॉट, बंडल, साइज़, रंग, कपड़ा खपत, सिलाई, स्क्रैप, कबाड़, बुरादा / कतरन,
  ड्रॉइंग, संशोधन, निरीक्षण रिपोर्ट, दाना / रेज़िन, रीग्राइंड, मोल्ड, शीट, छपाई, इम्प्रेशन, प्लेट, बैच, बेस्ट बिफोर,
  उपयोग तिथि, उद्यम पंजीकरण, सूक्ष्म / लघु / मध्यम उद्यम, प्रोत्साहन, सब्सिडी, अग्रिम प्राधिकार, निर्यात दायित्व).
- **Storage.** New company tables `mrchartist_inv_<table>` go through `getTable` / `setTable`. Each is registered in:
  - `backup.ts` (`RECORD_TABLES` / `ID_TABLES`);
  - the open-export schema (`trust/open-export-schema.ts`);
  - `sync-engine.ts` `DATED` / `NUMBERED`, when dated or numbered;
  - **`src/lib/mfg/mf-registry.ts`** (`MF_TABLE_ACTIONS`, `MF_WATCHED`), registered at runtime, never in first-paint
    `access.ts` / `audit-edits.ts`. Every writer module and the two all-table lazy writers (`sync-engine.ts`,
    `trust/recycle-bin.ts`) import it for its side effect (`tests/mf-registry.test.ts`).

  Each table gets one row in `docs/ARCHITECTURE.md` (lead). Additive record fields come by declaration merging in
  `src/types/mfg-r13.ts`: one file, one `declare module` block per package. Table and series names live in
  `src/lib/mfg/mf-shared.ts` (the `tr-shared.ts` / `ag-shared.ts` pattern).
- **Volume.** Job cards are the high-volume table (a 20-machine shop on two shifts logs ≈ 30,000 operation entries a
  year). **`job_cards` holds one row per production order per operation** with an `entries` array (start / stop,
  quantities, operator), not one row per entry. A test builds a year of a 20-machine shop and checks that the load view
  for one week reads only the cards of orders open in that week.
- **Invoice snapshots.** Everything Round 13 stores on an invoice lives under the record key **`mf`** (one object; each
  package owns its sub-fields, §6). Templates read them from the record only. Purchases rows that carry manufacturing
  fields (scrap bought, karigar piece bills) carry them as `PurchaseRecord.mf` (declaration merging; `readPurchase`
  passes unknown keys through — MF-A checks and adds `mf` to the purchase keep-list if it does not).
- **Numbers.** New series go through `series-counters.ts` (`nextSeriesNumberFor` + `recordSeries`) as
  `XXX/FY<yy-yy>/<seq>`, never reused after a delete: `JCD` (job cards), `FAI` (inspection reports), `PES` (print
  estimates), `CUT` (cut plans / lots), `KPB` (karigar piece bills). None of these prefixes is in use today (checked by
  grep; MF-A adds a test). Bundles take `<lot>/<n>` inside their lot; print job tickets reuse the production order `WO`.
- **Guards.** Destructive calls use `requireAccess`. Writes in a locked period use `assertUnlocked`. Money goes through
  `round2`, quantities through the unit's decimals (`roundTypedQty`), hours through 2 decimals, weights through 3. Every
  delete goes through `setTable` on a watched table, so the recycle bin gets the row.
- **Packs.** A desk tab is listed only when its pack is on (its URL still opens it). Tables are not read while their
  pack is off (`tests/mf-pack-gate.test.ts`, like `tests/ag-pack-gate.test.ts`).
- **Help.** Every new tab / view gets a topic (`tests/help-registry.test.ts` fails otherwise) and a Ctrl+K title in
  `src/i18n/areas/discover-r6-tabs.ts`. Statutory topics cite the MF ids. The CA-id regexes in
  `tests/help-registry.test.ts`, `tests/help-glossary.test.ts` and `tests/docs-links.test.ts` (the `cited` regex) gain
  `MF` (owner A).
- **Cash readers.** **No new receipt marker.** GST TDS deducted by a scrap buyer (Sec 51) is a typed deduction on the
  receipt (the existing short-payment handling), posted to "GST TDS receivable"; a karigar's advance recovered from his
  piece bill is a purchase-side set-off (the payment voucher made earlier, Dr Karigar advances), never a receipt.
  `tests/no-cash-readers.test.ts` is unchanged; `movedNoCash` is not edited.
- **Purchases contract.** Every new module that reads `purchases` (A4, B3, C4, D3, D4) is added to
  `tests/purchase-contract.test.ts` and reads bills through `readPurchase`.
- **Stock engine.** Round 13 adds **no new stock event source** except where a spec says so (B4 regrind and C2 bundles do
  not move stock themselves; they write ordinary manufacturing / stock journals tagged with `production_order_id`). The
  one engine change is A5 / D5's conversion cost, which enters the existing voucher pool as an additional-cost line.

### MF-A — Manufacturing profile and the shop-floor core

#### MF-A1 Manufacturing profile (manufacturing picker)

**User story.** When I set up the app I pick "Factory / manufacturing", then *Garments*. The app turns on the shop-floor
and garments desks, lands me on Manufacturing → Garments → Styles, and the checklist asks for my work centres, my first
style and my fabricators.

**Acceptance criteria.**
1. `PackId` gains `shopfloor`, `fabrication`, `garments`, `plastics`, `press`, `foodmfg` (appended to `PACK_IDS`).
   `PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE` and `PACK_ROUTES` are unchanged.
2. Settings fields `mfg_kind?: 'engineering' | 'textile' | 'plastics' | 'printing' | 'food' | 'other'`, `mfg_sub?: string`
   (the sub-choice of §1) and object `mfg_settings` (`settings.manage`, audited, synced as a singleton).
   `applyMfgKind(kind, { registered, sub, currentPacks })` (`shop-presets.ts`, R12 pattern) returns business type,
   modules, packs (union with `currentPacks`, so an agri company keeps its packs), defaults and switches:

   | kind | modules | industry_packs | landing | due days | template | switches turned on |
   |---|---|---|---|---|---|---|
   | engineering | `PRESETS.manufacturer` | `shopfloor`, `fabrication` | `/manufacturing?tab=floor&view=cards` | 30 | `gst_tax_invoice` | routings; job cards; machine-hour costing; drawings; scrap register; inspection reports |
   | textile | `PRESETS.manufacturer` | `shopfloor`, `garments` | `/manufacturing?tab=garments&view=styles` | 45 | `gst_tax_invoice` | styles; cut plans (garments only); bundles; CMT; karigars; price bands on output |
   | plastics | `PRESETS.manufacturer` | `shopfloor`, `plastics` | `/manufacturing?tab=moulding&view=runs` | 30 | `gst_tax_invoice` | runs; regrind; material balance; EPR fields; scrap register |
   | printing | `PRESETS.manufacturer` | `shopfloor`, `press` | `/manufacturing?tab=press&view=estimates` | 30 | `gst_tax_invoice` | estimates; job tickets; paper stock by GSM; printing classes |
   | food | `PRESETS.manufacturer` + `pos` | `shopfloor`, `foodmfg` | `/manufacturing?tab=food&view=costcards` | 15 | `gst_tax_invoice` | batch cost cards; shelf life; FSSAI print; min shelf life at dispatch; schemes |
   | other | — (type unchanged) | `shopfloor` | `/manufacturing?tab=floor` | — | — | work centres, routings, job cards only |

   `registered` adds `gst`; every kind keeps `inventory` (so `/manufacturing` stays visible) and `payroll`.
3. Wizard: one more card "Factory / manufacturing" (lazy, inside the wizard chunk) opens the kinds and their sub-choice;
   every kind asks "Are you registered under GST?" and "Udyam number (optional)" (writes `SenderProfile.msme_udyam` and
   the new `msme_category`, validated by `validateUdyam`). Settings → Features shows "Manufacturing profile" for every
   company with the same choices plus "Custom". Changing the profile never deletes data.
4. Existing companies are unchanged (no `mfg_kind`, no step). Companies that pick a kind get checklist steps
   (`checklist-steps.ts`, append-only): every kind → `workCentres`, `udyam` (skippable); engineering → `firstDrawing`;
   textile → `firstStyle`, `fabricators`; plastics → `firstMould`; printing → `pressMaster`; food → `fssai`, `shelfLife`.
5. **Desk tabs** (`MFG_PACK_TABS` in `page-tabs.ts`, new list): `floor`, `shop`, `moulding`, `press`, `garments`, `food`,
   `statutory` (pack and views as §1). `Manufacturing.tsx` lists them after `MFG_TABS` when their pack is on (one lazy
   mount per desk). `PACK_TABS` rows in block `// R13`. If a view's package has not merged yet, A commits a one-line stub
   (`R13Stub.tsx`) that the package replaces.
6. Features catalogue (`features-catalog.ts`): one row per new pack and one "Manufacturing profile" row with `PACK_HREF`.
7. **Sample data** (R6-B4): `src/lib/demo/profile-mfg.ts`, only in the Demo company, dispatched by `mfg_kind`; each
   package adds its own block (§6): engineering — 4 work centres, a routing, 3 orders with job cards, a drawing at rev C,
   a scrap sale; textile — a style in 5 sizes × 3 colours, a cut plan of 60 plies, 12 bundles, a CMT challan, 2 karigars;
   plastics — 2 machines, a mould, 5 runs with regrind; printing — an estimate of a 4-colour carton, a job ticket;
   food — a namkeen cost card, 3 batches with best-before, a scheme; every kind — an Udyam number and one MSE receivable.

**Files.** New: `src/lib/mfg/{mf-profile,mf-registry,mf-settings,mf-shared}.ts`, `src/lib/mfg-rules.ts` (scaffold with
one section per package), `src/types/mfg-r13.ts` (scaffold), `src/components/mfg/{MfgKindPicker,FloorDesk,R13Stub}.tsx`,
`src/lib/demo/profile-mfg.ts`. Edit: `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`,
`checklist-steps.ts`, `SetupWizard.tsx`, `FeaturesPanel.tsx`, `page-tabs.ts` (`MFG_PACK_TABS`), `Manufacturing.tsx`
(lazy desk mounts), the demo dispatcher.

**Storage.** Settings fields `mfg_kind`, `mfg_sub`, `mfg_settings` (object); `SenderProfile.msme_category` (additive).

**Tests.** `tests/mf-profile.test.ts`: each kind's type / modules / packs / landing / switches; `registered` adds `gst`;
packs union with an agri company's; `PACK_OF_TYPE` / `PACK_ROUTES` unchanged; existing `manufacturer` companies
unchanged; checklist steps by kind. `tests/industry-packs.test.ts` extended with the six ids.

#### MF-A2 Work centres and routings

*Seen in:* ERPNext (workstations, operations on the BOM), Odoo (work centres, routings), Busy / Tally (none).

**User story.** As a fabrication shop I set up "Laser 1" (₹1,800 / hour, 2 shifts of 8 h, 6 days), "Press brake",
"MIG welding" (₹450 / hour labour + ₹120 power) and "Powder coating"; the bracket's routing is laser 0.05 h, bend
0.03 h, weld 0.08 h, coat (batch of 50, 2 h), with 15 min set-up on each.

**Acceptance criteria.**
1. Table `work_centres`: `{ id, name, kind: 'machine' | 'line' | 'manual' | 'outside', hourly_rate (machine), labour_rate?,
   power_rate?, overhead_rate?, shifts: [{ name, hours }], days: number[] (0–6), efficiency_pct (default 100),
   capacity_units (parallel machines / operators, default 1), holidays?: string[], cost_centre_id?, vendor_id? (outside
   processing → job work), active }`. Machine-hour rate = Σ rates (a breakdown, not a single typed number).
2. Table `routings`: `{ id, item_id, bom_id?, name, is_default, revision?, ops: [{ id, seq, name, work_centre_id,
   setup_min, run_min_per_unit | run_units_per_hour, batch_size? (for batch operations like ovens / coating), move_min?,
   inspection?: boolean, piece_rate? (₹ per unit — C4), notes }] }`. One default per item; validation refuses an
   operation without a work centre, negative times and a duplicate `seq`.
3. **Release** of a production order (R4-A) copies the default routing into the order as `ProductionOrder.mf.ops`
   (declaration merging) with planned hours = set-up + run × planned qty ÷ efficiency; changing the routing later never
   changes a released order (snapshot).
4. Standard conversion per unit = Σ (planned hours × machine-hour rate) ÷ planned qty, shown next to R4-A's typed
   `standard_conversion`; "Use routing" fills it (R4-A2 costing then uses it unchanged).
5. An `outside` work centre (plating, heat treatment) marks its operation as job work: "Send" opens the existing Material
   Out pre-filled (vendor, item, quantity), so ITC-04 sees it.
6. Import / export routings as CSV / XLSX (one row per operation).

**Files.** New: `src/lib/mfg/{mf-centres,mf-routings}.ts`, `src/components/mfg/{CentresView,RoutingsView}.tsx`. Edit:
the production-order release path (`production/orders.ts`: one guarded call copying the routing when the `shopfloor`
pack is on, §6).

**Tests.** `tests/mf-routings.test.ts`: machine-hour rate sum; planned hours by run basis and batch size; snapshot on
release; standard conversion; outside operation → Material Out prefill; validation; CSV round trip.

#### MF-A3 Job cards: operations done, machine hours, operator, rejects, scrap weight

**User story.** The welder taps his operation on the phone, starts the timer, stops at 4:40 pm with 118 good, 2
rejected (porosity) and 3.4 kg of off-cuts; the order shows bending done, welding 118 / 200, coating not started, and
the machines' hours for the day.

**Acceptance criteria.**
1. Table `job_cards` (`JCD/FY…`): **one row per order per operation** `{ id, number, order_id, op_id, work_centre_id,
   planned: { qty, hours }, entries: [{ id, date, start?, end?, hours, operator?: { kind: 'employee' | 'karigar', id },
   machine?, good, rejected, rework, reason?, scrap_kg?, scrap_item_id?, note }], status: 'open' | 'running' | 'done' }`.
   Totals are derived. Hours come from start / end (local times) or are typed; overlapping entries on one machine warn.
2. **Flow rule**: an operation cannot report more good units than the previous operation's good output (+ rework) unless
   "allow out of sequence" is set on the routing; the last operation's good quantity is the "ready to report" figure for
   R4-A's output dialog (pre-filled there; output stays an R4-A manufacturing journal).
3. **Scrap kg** on an entry is a production of the scrap item (BOM `scrap` output semantics) — written as part of the
   order's output journal (R4-A `buildOutputVoucher` gains the job cards' scrap lines through one optional argument), so
   scrap stock appears where it is made and B3 can sell it.
4. **Rejects**: rejected quantity → R4-A QC (reject → scrap journal) or rework (back to the operation); the reason list is
   a setting.
5. **Piece counts to pay**: entries with an employee operator feed payroll `production` attendance units (one optional
   import per period: "Import production units from job cards" in the payroll attendance screen, lazy row); entries with
   a karigar feed C4.
6. **Phone mode**: the `cards` view has a large-button operator screen (pick work centre → my open operations → start /
   stop / report), scan of the order's QR (existing scanner, camera).
7. Day report per work centre: hours run, set-up, idle (available − run), good / rejected, scrap kg; per operator.

**Files.** New: `src/lib/mfg/{mf-jobcards,mf-floor-report}.ts`, `src/components/mfg/{JobCardsView,OperatorScreen}.tsx`.
Edit: `production/orders.ts` (`buildOutputVoucher` optional scrap lines, one argument), the payroll attendance screen
(one lazy import row).

**Tests.** `tests/mf-jobcards.test.ts`: totals; flow rule; out-of-sequence switch; overlap warning; scrap kg into the
output journal (stock appears once); rejects to QC; production units by employee and period; a year of 20 machines loads
the week view reading only open orders.

#### MF-A4 Dated MRP and capacity load

**User story.** On Monday I see this week and the next six by day: what to buy and when to order it (supplier lead time
7 days), what to make, and that the laser is loaded at 128% in week 44; I move one order and the overload goes.

**Acceptance criteria.**
1. **Lead times**: additive `StockItem.lead_days?` (purchase) and `make_days?` (manufacture; default from the routing's
   planned hours ÷ daily available hours of its slowest work centre, rounded up).
2. **Dated MRP** (`mf-mrp-dated.ts`, built on `mrp.ts` without changing its single-horizon result): demand by due date
   from open sales orders, production orders' materials not yet issued and typed forecast lines; supply from stock, open
   POs / GRNs by expected date and production orders by due date; buckets by day / week; each item netted per bucket in
   low-level-code order; planned orders offset by lead time ("order by" date); past-due and late flags. Output rows reuse
   the existing actions ("Create purchase order", "Create production orders").
3. **Capacity load** (view `load`): for released / planned orders, the routing's remaining hours placed **backwards from
   the due date** (infinite loading) per work centre per day / week vs available hours (shifts × days × capacity units ×
   efficiency − holidays); a load chart (bars, CSS only) with over-100% highlighted; "promise date" tool: for a new
   quantity of an item, the earliest date at which forward loading fits (finite, simple, no re-sequencing).
4. Moving an order's due date or priority from the load view edits the order (audited); nothing is rescheduled
   automatically.
5. Plans saved as today in `production_plans` (R7S) with an additive `dated: true` and buckets; old plans open unchanged.

**Files.** New: `src/lib/mfg/{mf-mrp-dated,mf-capacity}.ts`, `src/components/mfg/{LoadView,DatedPlanView}.tsx`. Edit:
the MRP tab (one lazy "By date" toggle), the item form (lazy "Lead time / make days" row with `shopfloor`).

**Tests.** `tests/mf-mrp-dated.test.ts`: bucket netting; lead-time offset; past-due flags; same totals as `mrp.ts` over a
single bucket; `tests/mf-capacity.test.ts`: available hours with shifts, holidays, efficiency; backward load; promise
date; 0-hour work centre refused.

#### MF-A5 Manufacturing paper (Udyam, drawings, batch dates, FSSAI, job particulars)

**User story.** My invoice shows "Udyam: UDYAM-MH-26-0012345 (Micro)" under my GSTIN and the MSE payment clause in the
terms; the bracket line shows "Drg. 1145-B rev C · PO line 20 · Heat H2231"; a food invoice shows FSSAI no., batch,
packed on and best before; a print bill shows "4-colour + varnish, 10,000 cartons, 2,500 sheets × 4 ups".

**Acceptance criteria.**
1. **Udyam line** (`UdyamLine.tsx`, lazy; mounted under the seller's GSTIN in every layout when
   `invoice.sender.msme_udyam` is present): number and category. **On by default for registered MSEs**, a profile switch
   "Print Udyam number" (default on, MF22). The MSE payment clause ("Payment due within 45 days of acceptance — MSMED Act
   2006 Sec 15; interest u/s 16 beyond") prints in the terms when category is micro / small and the buyer has a GSTIN
   (the existing `msmeNote` test, now printed). Old invoices print from their own sender snapshot (an invoice saved
   before the field existed prints nothing new).
2. **FSSAI line**: additive `SenderProfile.fssai_no` (14 digits, validated) prints under the GSTIN when present; the R12
   `fssai` licence on the agri register fills it once if empty. Never printed on e-way JSON (FSSAI order).
3. **Snapshot** `mf` on invoices (one record key, §1): `{ kind?: 'drawing' | 'food' | 'print' | 'cmt' | 'scrap' | 'export_aa',
   header?: {...}, lines?: Record<lineId, { drawing?, rev?, po_line?, heat?, grade?, batch?, packed_on?, best_before?,
   use_by?, mrp?, style?, lot?, sizes?, epr_cat?, recycled_pct? }> }`; each package writes its sub-object through one
   `mfSnapshot(kind, …)` helper. Old documents without `mf` print unchanged.
4. **Line sub-line**: `trackingText` gains one helper call `mfLineText(item, mf)` → "Drg. 1145-B rev C · PO 20 · Heat
   H2231" / "Batch NK2610 · Packed 12/10/26 · Best before 11/01/27 · MRP ₹40" / "Style KT-22 · Lot CUT/26-27/0014 · S6 M12
   L12 XL6" printed under the line name in **both** item tables. Without `mf` it returns ''.
5. **Block** (`MfgBlock.tsx`, lazy, after `PartyPanel`, before `GstBody`, never on `receipt`): *Job particulars* (print:
   size, colours, ups, sheets, impressions, paper; engineering: customer PO, drawing list; export: AA no. and SION) —
   accent variable only.
6. **Annexure page** (`MfgAnnexurePage.tsx`, lazy, R3-B4 pattern): the size × colour breakdown of a garment invoice, the
   inspection summary of an engineering invoice (B1), the scrap weighment of a scrap invoice (B3). From the snapshot only.
7. Declarations (`mfDeclaration` in `paper-helpers.ts`): "Waste and scrap — TCS u/s 394(1) collected" on a scrap
   invoice with TCS; "Goods supplied under Advance Authorisation no. …" on an AA export; "Recycled content x% (PWM Rules)"
   when B4 sets it. Each statutory sentence carries "verify" where the CA item is open.
8. Print copies, the share link and PDF export carry the same paper (they render `TemplateEngine`).

**Files.** New: `src/components/templates/parts/{MfgBlock,MfgAnnexurePage,UdyamLine}.tsx` + `mfg-paper.module.css`,
`src/lib/mfg/{mf-snapshot,mf-print}.ts`. Edit: `TemplateEngine.tsx` (three lazy mounts, §6), `paper-helpers.ts`
(`mfLineText`, `mfDeclaration`), `invoice-defaults.ts` (`R13_RECORD_KEYS`, one spread token), the profile form
(`msme_category`, `fssai_no`, print switch — lazy row), `PaymentTermsPanel.tsx` (category select next to the Udyam field).

**Tests.** `tests/mf-print.test.ts`: Udyam line by snapshot; clause only for MSE + GSTIN buyer; FSSAI validation and
print; sub-line texts per kind; old invoices without `mf` and without the new sender fields render byte-identical (paper
HTML fixture); `mf` survives `normalizeRecord` (load → edit → save).

### MF-B — Engineering, plastics and printing (packs `fabrication`, `plastics`, `press`)

#### MF-B1 Drawings, revisions and inspection reports

**User story.** My customer sends drawing 1145-B rev C replacing rev B; the app keeps both, warns when a PO still says rev
B, prints the routing card and the inspection report with the drawing's critical dimensions, and the invoice line carries
the revision.

**Acceptance criteria.**
1. Table `drawings`: `{ id, client_id?, item_id?, number, title, revisions: [{ rev, date, note, attachment_id?,
   status: 'current' | 'superseded' | 'hold' }], characteristics?: [{ id, name, nominal, tol_minus, tol_plus, unit,
   critical? }], material_grade? }`. Attachments use the existing attachment store (PDF / image).
2. A sales order / invoice line for a drawn item takes `mf.lines[lineId].drawing / rev / po_line` (A5); a line naming a
   superseded revision warns ("PO says rev B; current is rev C"); a `hold` revision blocks release of a production order
   (owner override, audited).
3. **Inspection report** (`FAI/FY…`, table `inspection_reports`): first-article or lot inspection against the drawing's
   characteristics `{ id, number, date, kind: 'first_article' | 'lot' | 'final', order_id?, drawing_id, rev, sample,
   readings: [{ char_id, values: number[] }], result: 'pass' | 'fail' | 'deviation', inspector }`; out-of-tolerance
   readings marked; pass / fail can feed R4-A QC (release / reject) for the order's output; print (A4) and attach to the
   invoice annexure (A5-6).
4. Heat no. / material test certificate reference on purchase lines (`PurchaseRecord.mf.lines[lineId].heat`) carried to
   the output batch (the order's materials by batch, R4-A genealogy) and printed on the invoice line.

**Files.** New: `src/lib/mfg/{mf-drawings,mf-inspection}.ts`, `src/components/mfg/{ShopDesk,DrawingsView,InspectionView}.tsx`.
Edit: none outside §6 (the release guard plugs into A2's routing copy call).

**Tests.** `tests/mf-drawings.test.ts`: revision status changes; superseded warning; hold blocks release; inspection
result by tolerance; heat carried to the output batch.

#### MF-B2 Weight-based job quotes (engineering)

**User story.** A buyer asks for 500 flanges: MS plate 20 mm, OD 300, ID 160; the quote computes 6.13 kg gross per piece
from the blank, 2.9 kg net, machining 0.4 h on the VMC, zinc plating outside at ₹18 / kg, scrap credit at ₹32 / kg, 12%
margin, and makes a quotation in the editor.

**Acceptance criteria.**
1. **Shape calculator** (`mf-weight.ts`): plate / sheet (L × W × T), round bar (D × L), tube (OD, ID, L), ring / flange
   (OD, ID, T), angle / channel by kg per metre (typed), with density from a material list (MS 7.85, SS 7.93, Al 2.70,
   brass 8.50, copper 8.96 g / cc; editable "practice" values); gross (blank) and net (finished) weight; scrap kg = gross −
   net.
2. **Quote sheet** (table `job_quotes`): material (kg × rate), operations from a routing or typed (hours × machine-hour
   rate from A2), outside processing (₹ / kg or ₹ / piece), packing, freight, scrap credit (kg × scrap rate), overhead %,
   margin %; price per piece for 2–4 quantity breaks (set-up amortised).
3. "Make quotation" opens the editor with a `QUOTATION` (existing doc type) per break, lines carrying `mf` drawing /
   revision; the sheet is kept with the quotation id. Converting the quotation (existing conversions) keeps the `mf`
   snapshot.
4. A won quote's routing hours become the routing (one tap) and its material rate the BOM component's standard cost
   (`standard_costs`, dated).

**Files.** New: `src/lib/mfg/{mf-weight,mf-quotes}.ts`, `src/components/mfg/QuotesView.tsx`.

**Tests.** `tests/mf-weight.test.ts`: each shape; densities; scrap kg; `tests/mf-quotes.test.ts`: price breaks with set-up
amortisation; scrap credit; quotation draft lines; routing and standard-cost hand-over.

#### MF-B3 Scrap and by-product sales (every factory)

*Seen in:* every machine shop, press, moulder; Sec 394(1) (206C(1)); N 6/2024-CT(R) and N 25/2024-CT; Rule 138.

**User story.** At month end I sell 1.8 t of MS turnings and 240 kg of brass chips to a registered dealer; the invoice
takes the scrap class (18%), collects TCS at 2%, notes that the buyer deducts 2% GST TDS above ₹2.5 lakh, and the scrap
stock falls by the job-card weights it was made from.

**Acceptance criteria.**
1. **Scrap register** (view `scrap`, reads only): scrap made (job cards A3, BOM scrap outputs, QC scrap, job-worker
   returns), sold, in stock, by scrap item and month; value at the item's scrap rate; average realisation.
2. **Scrap classes** (`mfg-rules.ts` `SCRAP_CLASS_RULES`, date-keyed): `metal_ferrous`, `metal_nonferrous` (ch 72–81
   waste: 18%; RCM on purchase from unregistered from 2024-10-10; Sec 51 GST TDS 2% above ₹2.5 lakh B2B from 2024-10-10),
   `paper_waste` (4707: 12% → 5% from 2025-09-22), `plastic_waste` (3915: rate **unverified** — the class suggests nothing
   and shows "verify — MF8"), `textile_waste` (5% as reported, unverified), `other`. Item field `mf_scrap_class`
   (additive). A typed rate always wins.
3. **On a sale** of a scrap-class line: the editor suggests the TCS preset `206C(1) scrap` (existing preset; 2% from
   2026-04-01, from `trading-rules.ts`), with "buyer's declaration of use in manufacturing (Form 127 / earlier 27C)
   received" as a switch that drops the TCS (stored on the invoice, printed; MF10); for metal scrap to a registered
   buyer above ₹2.5 lakh, a note "Buyer deducts GST TDS 2% u/s 51 — credit after GSTR-7" (printed), and the receipt dialog
   offers the deduction as a typed short payment to "GST TDS receivable" (existing short-payment handling; no new marker).
4. **On a purchase** of metal scrap from an unregistered vendor: the bill modal shows the RCM prompt (one class check in
   the existing RCM prompt path, lazy) — "RCM applies: N 6/2024-CT(R)"; self-invoice through the existing RCM
   self-invoice flow.
5. **TCS scope note** (help + soft notice): TCS applies to scrap "from manufacture or mechanical working" (HC rulings);
   the app does not decide scope (MF9).
6. Weighment for scrap sales reuses R8 `wt` lines (gross, tare, net) and prints the weighment annexure (A5-6).

**Files.** New: `src/lib/mfg/{mf-scrap,mf-scrap-tax}.ts`, `src/components/mfg/ScrapView.tsx`. Edit: `gst-guards.ts` (one
lazy class check shared with C5 / D1, §6), the RCM prompt path (`RcmGoodsNotice.tsx`: one lazy class lookup).

**Tests.** `tests/mf-scrap.test.ts`: register sums equal job-card / BOM scrap; class rate by date; TCS preset suggested and
dropped by the declaration; GST TDS note above ₹2.5 lakh only for registered buyers and metal classes; RCM prompt only
for unregistered metal-scrap suppliers after 2024-10-10; plastic-waste class suggests no rate.

#### MF-B4 Moulding / extrusion runs with regrind, material balance and EPR (pack `plastics`)

**User story.** Machine 3 ran mould M-14 (4 cavities, 22 s cycle) for 10 hours: 6,380 good caps, 140 rejects, 3.1 kg
runners; I used 95 kg virgin PP, 4 kg masterbatch and 12 kg regrind; the run shows 92.4% material yield and the
regrind stock goes up by the runners and rejects I grind.

**Acceptance criteria.**
1. **Moulds / dies** (`mfg_settings.moulds: [{ id, name, item_id, cavities, cycle_s, shot_g?, runner_g?, life_shots?,
   shots_done }]`): life warning at 90% of `life_shots`.
2. Table `process_runs`: `{ id, date, shift?, order_id?, work_centre_id, mould_id?, hours, cycle_s?, shots?, inputs: [{ item_id,
   kind: 'virgin' | 'regrind' | 'masterbatch' | 'additive', kg, batch? }], good_qty, reject_qty, runner_kg?, purge_kg?,
   regrind_out_kg?, note }`. Expected output = hours × 3600 ÷ cycle × cavities; efficiency % = good ÷ expected.
3. **Material balance**: input kg = good × part weight + rejects × part weight + runners + purge + unaccounted loss;
   yield %; regrind % in the mix (warn above the item's `max_regrind_pct`, a customer / quality term).
4. **Posting**: a run writes **one manufacturing journal** tagged `production_order_id` (consume inputs; produce good
   units; produce the regrind item for `regrind_out_kg` at the BOM scrap rate) — the regrind is an ordinary stock item
   consumed by later runs (no new engine path).
5. **EPR register** (view `epr`): per item `mf_epr: { category: 'I' | 'II' | 'III' | 'IV', recycled_pct?, brand_owner?:
   client_id }`; monthly kg supplied by category and customer from invoices; recycled content kg from runs (regrind from
   post-consumer sources, a flag on the input item); the customer's EPR registration number on the client
   (`Client.mf.epr_no`); CSV for the brand owner. "Working paper — your EPR filing is on the CPCB portal".
6. Regrind / granules sold use the B3 scrap class `plastic_waste` (MF8) or a typed rate; regrind consumed in-house has no
   tax effect (MF27).

**Files.** New: `src/lib/mfg/{mf-runs,mf-epr}.ts`, `src/components/mfg/{MouldingDesk,RunsView,BalanceView,EprView}.tsx`.

**Tests.** `tests/mf-runs.test.ts`: expected output and efficiency; balance closes to the gram; regrind % warning; one
journal per run (stock once); mould life; `tests/mf-epr.test.ts`: kg by category and customer; recycled share.

#### MF-B5 Print estimates and job tickets (pack `press`)

**User story.** A customer wants 10,000 cartons, 4 colours + varnish on 300 GSM board; the estimate picks a 20 × 30 in
sheet with 4 ups, adds 150 sheets make-ready + 2% running wastage, shows 2,650 sheets = 309 kg of board, 5 plates,
10,600 impressions, die-cutting and pasting, and the job ticket goes to the floor.

**Acceptance criteria.**
1. **Press masters** (`mfg_settings.presses: [{ id, name, max_sheet: { w, h }, colours, impressions_per_hour, make_ready_min,
   make_ready_sheets, rate_per_1000_imp, min_charge, work_centre_id? }]`).
2. **Paper maths** (`mf-paper.ts`): ups on a sheet (both orientations, gripper / bleed margins), sheets = qty ÷ ups,
   wastage = make-ready sheets per colour pass + running %; kg = sheets × w × h (m) × GSM ÷ 1000; reams / packets;
   board in sheets or kg as the item's unit (alternate units).
3. Table `print_estimates` (`PES/FY…`): job (size, qty breaks, colours front / back, stock item, ups, press), paper, plates
   (colours × sets), impressions = sheets × colour passes, press cost (impressions ÷ 1000 × rate or hours × machine rate),
   finishing lines (lamination ₹ / sq in, varnish, die-cutting, pasting, binding, typed), outside work, margin; price per
   break; "Make quotation" (`QUOTATION`, `mf.kind = 'print'` header).
4. **Job ticket**: a won estimate creates a production order (R4-A) with the paper and plates as materials and the
   finishing steps as a routing (A2); the ticket print carries the estimate's specification; actual sheets used vs
   estimated on completion.
5. **Printing classes** (`mfg-rules.ts` `PRINT_CLASS_RULES`): `print_goods_own_paper` (supply of printed goods — goods rate
   of the printed product, Circular 11/11/2017 as recalled), `print_job_ch48_49` (printing on the customer's ch 48 / 49
   goods: 12% → 5% from 2025-09-22, "verify — MF3"; the editor notes the Gujarat AAR where the paper is 18%), `cartons_4819`
   (12% → 5% from 2025-09-22), `printing_paper_4802` (12% → 18%, one source, unverified), `print_other` (18%). Suggestions
   only; typed rate wins.

**Files.** New: `src/lib/mfg/{mf-paper,mf-estimates}.ts`, `src/components/mfg/{PressDesk,EstimatesView,TicketsView}.tsx`.

**Tests.** `tests/mf-paper.test.ts`: ups both orientations with margins; sheets and kg; make-ready; `tests/mf-estimates.test.ts`:
impressions, plates, breaks; quotation lines; ticket order materials; class by date.

### MF-C — Textiles and garments (pack `garments`)

#### MF-C1 Styles and cut plans, fabric consumption

**User story.** Style KT-22 (kurta) in S–XXL × 3 colours; I lay 60 plies of the blue fabric with a marker of S1 M2 L2
XL1 (6 pieces, 7.2 m), cut 360 pieces, and see consumption 1.20 m a piece against the 1.25 m standard and 2.4 m of end
bits.

**Acceptance criteria.**
1. **Style** = a stock item with `variant_axes` (size, colour — existing 8.85 variants) plus `StockItem.mf.style: {
   fabric_items: [{ item_id, per_piece_m, colour_map? }], trims: [{ item_id, per_piece }], size_ratio_default?,
   routing_id? }`. A production order for a style takes a **size × colour grid** of quantities (reusing `rt-matrix.ts`
   `gridCells` read-only) and becomes one order with `mf.grid`, its children's quantities summing to the planned qty.
2. Table `cut_plans` (`CUT/FY…`, the lot number): `{ id, number, date, order_id?, style_id, colour, fabric_item_id,
   fabric_batch?, lays: [{ plies, marker_ratio: Record<size, number>, marker_length_m, width_cm? }], cut: Record<size,
   number>, fabric_issued_m, end_bits_m?, cut_waste_kg? }`. Pieces cut = Σ plies × ratio; consumption = (issued −
   end bits returned) ÷ pieces; vs standard (style `per_piece_m`) → variance m and %.
3. **Stock**: fabric issued to the cut = an STR to the WIP godown tagged `production_order_id` (R4-A issue); end bits back
   = return; cut waste (kg) = the B3 scrap item `textile_waste` (journal through R4-A write-off). Cut pieces themselves are
   **not stock** until finished (WIP); bundles (C2) track them.
4. Ratio helper: from an order's size quantities and a maximum marker size, suggest marker ratios and plies (largest
   common ratio first; user edits).
5. Cut report print: lot, style, colour, ratio, plies, cut by size, consumption, signature.

**Files.** New: `src/lib/mfg/{mf-styles,mf-cutplans}.ts`, `src/components/mfg/{GarmentsDesk,StylesView,CutPlansView}.tsx`.

**Tests.** `tests/mf-cutplans.test.ts`: pieces from lays; consumption and variance; ratio suggestion sums to the order;
issue / return / waste journals (stock once); grid sums to planned qty.

#### MF-C2 Lots and bundle tickets

**User story.** Lot CUT/26-27/0014 becomes 30 bundles of 12 pieces (size, colour, shade, bundle no.); I print bundle
tickets with a QR, scan them at each operation, and see which bundles are at stitching, at the fabricator or finished.

**Acceptance criteria.**
1. A cut plan generates bundles `cut_plans.bundles: [{ no, size, colour, shade?, pieces, at: { op_id?, where: 'floor' |
   'fabricator' | 'finished' | 'rejected', party_id? }, history: [{ date, op_id, good, rejected, by? }] }]` (inside the
   lot row; bundle id `<lot>/<no>`); default bundle size a setting.
2. **Bundle tickets** print: 8 or 12 per A4, QR of the bundle id (`qrcode.react`), lot, style, size, colour, pieces, and
   tear-off coupons per operation (operation name, piece rate) for piece-rate counting.
3. **Scan** (existing camera scanner) on the operator screen (A3) records the bundle against the job card entry
   (`good` = bundle pieces unless edited); rejected pieces leave the bundle with a reason.
4. Lot status: pieces by operation and location; WIP by size; shortages (cut − finished − rejected).
5. Finishing a bundle at the last operation adds its pieces to the order's ready-to-report quantity by size; the output
   journal (R4-A) produces the variant children by size × colour.

**Files.** New: `src/lib/mfg/mf-bundles.ts`, `src/components/mfg/{BundlesView,BundleTickets}.tsx`.

**Tests.** `tests/mf-bundles.test.ts`: bundles from lays; scan updates; rejects; lot status sums; output by variant equals
finished bundles.

#### MF-C3 CMT job work by bundle; job-work e-way returns and ITC-04 depth (every principal and job worker)

**User story.** I send 20 bundles (240 cut pieces) of KT-22 to fabricator Rehmat for stitching at ₹38 a piece; he returns
232 stitched and 8 rejected; I pay him for 232. When I do dyeing for a mill (I am the job worker) I return their fabric
with an e-way bill as a job-work return.

**Acceptance criteria.**
1. **CMT out** = the existing **Material Out** challan (`JWC`) with lines by bundle: `JobWorkLine.mf?: { lot, bundles: string[],
   pieces }` (declaration merging); Material In receives by bundle (good / rejected / short); shortages flagged per
   bundle; job charges per piece from the routing operation's `piece_rate` (A2) or the fabricator's rate card (C4).
2. **e-Way JSON, more cases** (`mf-eway-jw.ts`, extending `eway-job-work.ts` without changing its sub-type 4 output):
   - **job-work return** (we are the job worker sending the principal's goods back): sub-type 6 from the principal register
     (`job_work_principal`, `JWP`) — values from the principal's challan (MF11 on the value of the principal's goods);
   - **job worker to job worker** (our goods sent onward, ITC-04 5B): supply type O, sub-type 4, from = the first job
     worker's address (dispatch-from), on the principal's challan;
   - **supply from the job worker's premises** (5C): the invoice's e-way with dispatch-from = the job worker.
   "Needed" when inter-State (irrespective of value) or above ₹50,000 intra-State; a State-exemption note setting
   (`mfg_settings.eway_jw_intra_exempt`, default off, MF11). Not portal-validated.
3. **ITC-04 depth** (additions to the working paper, `itc04.ts` read-only use plus a lazy `mf-itc04-extra.ts`):
   - **job-worker reconciliation**: per job worker and challan — sent, received back, consumed, lost / waste, supplied
     from his premises, balance with him, oldest open date and Sec 143 clock (existing `challanBalances`);
   - **waste and scrap at the job worker** (Sec 143(5)): a Material In "scrap retained / sold by job worker" line (kind
     `scrap_at_jw`, additive) reported in Table 5A / 5C losses and wastes;
   - **challans with no movement** in the period (nothing to report) listed so the user knows they are not missing.
4. **We as job worker (Job Work In)**: the principal register shows bundles / pieces when the principal sends cut pieces;
   the job-charges invoice class suggestion: `jw_textile` 5% (ch 50–63, MF2), `jw_print_ch48_49` 5% (MF3), `jw_other` 18%
   (MF5) — typed rate wins.

**Files.** New: `src/lib/mfg/{mf-cmt,mf-eway-jw,mf-itc04-extra}.ts`, `src/components/mfg/CmtView.tsx`. Edit (§6):
`job-work.ts` (one additive line kind `scrap_at_jw` in the settlement switch, reviewed by the lead), the Material Out /
In grids (one lazy bundle column with the `garments` pack).

**Tests.** `tests/mf-cmt.test.ts`: bundles out / in / short; piece bill quantities; `tests/mf-eway-jw.test.ts`: sub-type 6
JSON from a JWP return; 5B dispatch-from; needed-flag inter- vs intra-State; existing `eway-job-work` tests unchanged;
`tests/mf-itc04.test.ts`: reconciliation sums equal ITC-04 tables; scrap-at-JW reported once; existing `itc04` tests
unchanged.

#### MF-C4 Karigar / fabricator piece-rate ledger

**User story.** Twelve karigars stitch at home or on my floor and are not on payroll; each week I see pieces done by
operation (from job cards and bundle coupons), the rate per piece, advances taken, TDS where due, and pay them by UPI with
a slip.

**Acceptance criteria.**
1. Karigars are **vendors** with `Vendor.mf.karigar: { kind: 'home' | 'floor' | 'fabricator', rates: [{ op_name | op_id,
   style_id?, rate, from }], pan?, upi?, bank? }`; employees paid per piece stay in payroll (A3-5) and are never karigars.
2. **Piece bill** (`KPB/FY…`, a `purchases` row: vendor = karigar, SAC 9988 job-work line, `PurchaseRecord.mf.piece: {
   period, lines: [{ op, style, pieces, rate, amount, source: 'jobcard' | 'bundle' | 'typed', refs }] }`), built for a week
   / fortnight from job-card entries and C3 Material In receipts with that karigar; pieces rejected for his fault deducted
   (setting).
3. **Advances** to karigars are payment vouchers to "Karigar advances" (created on first use); the piece bill offers to
   recover an instalment (a journal Dr karigar | Cr Karigar advances; no receipt).
4. **TDS 194C**: the existing TDS payables flow (thresholds and rates from `tds-rules.ts`, 2025 Act labels from
   `ita2025.ts`); the bill shows "TDS 194C (Sec 393) may apply — threshold" (MF28); no-PAN higher rate from the existing
   rule.
5. **GST**: an unregistered karigar's bill has no GST and **no RCM** (job work is not a notified RCM service); a registered
   fabricator charges 5% on textile job work (C3 class) — the bill suggests it.
6. **Pay** uses the existing payment dialog / bank upload (one adapter row per karigar, the R12 farmer-cycle precedent),
   with a WhatsApp slip (`wa.me`): pieces by operation, amount, deductions, net.
7. Minimum-wage check: out of scope; the help topic says piece rates must not fall below the State's minimum wage for the
   hours worked (MF28).

**Files.** New: `src/lib/mfg/{mf-karigar,mf-piece-bill}.ts`, `src/components/mfg/KarigarsView.tsx`. Edit: `bank-upload.ts`
(one adapter, no format change — shares R12's adapter shape).

**Tests.** `tests/mf-karigar.test.ts`: rate by date and style; pieces from job cards and Material In; rejects deducted;
advance recovery journal balances; TDS prompt threshold; no RCM on unregistered; bank rows.

#### MF-C5 Textile tax classes and the inverted-duty working paper

**User story.** I buy MMF yarn (5% since 22 Sep 2025), sell fabric (5%) and kurtas at ₹899 (5%) and ₹2,999 (18%); the
editor suggests each class by date and price, and at quarter end I see whether an inverted-duty refund (Rule 89(5)) is
worth filing.

**Acceptance criteria.**
1. **Textile classes** (`mfg-rules.ts` `TEXTILE_CLASS_RULES`): `mmf_fibre` (18% → 5% from 2025-09-22), `mmf_yarn` (12% →
   5%), `cotton_yarn` (5%), `fabric` (5%), `garment` / `made_up` (→ R9 `PRICE_BAND_RULES` bands, imported read-only; the
   band is applied on **sale** lines by the existing `rt-bands.ts` when the item's `mf_class` is `garment` / `made_up`, even
   without the R9 `apparel` pack), `textile_waste`, `jw_textile` (C3). Suggestions by document date; typed rate wins; all
   `verified: false` until MF1 / MF2 are answered.
2. **Output pricing check**: on a production order of a garment style, a memo "at your price list, these sizes fall in the
   18% band" (price per piece vs ₹2,500) — helps a maker price around the band (information only).
3. **Rule 89(5) working paper** (`mf-inverted.ts`, view in the statutory desk, also linked from the R4-C refund register):
   for a period — turnover of inverted-rated supplies, adjusted total turnover, net ITC on **inputs** (goods; input
   services and capital goods excluded), tax payable on inverted supplies; maximum refund = (inverted turnover × net ITC ÷
   ATT) − (tax payable × net ITC ÷ ITC availed); refund register row pre-filled (category `INVERTED_DUTY`). Inputs and
   outputs classified by rate from the period's purchases and invoices (`readPurchase`); the user can exclude lines.
4. Help: what changed for textiles on 22 Sep 2025 (MMF rectification), with "verify" on each row.

**Files.** New: `src/lib/mfg/{mf-textile-tax,mf-inverted}.ts`, `src/components/mfg/InvertedDutyView.tsx`. Edit: the band
hook in the editor (one lazy check: `mf_class` garment / made-up turns the band on, §6).

**Tests.** `tests/mf-textile-tax.test.ts`: classes before / after 22 Sep 2025; band applied by class without the apparel
pack; typed rate wins; `tests/mf-inverted.test.ts`: formula on a fixture; input services excluded; register prefill.

### MF-D — Food / FMCG and the statutory desk (packs `foodmfg`, `shopfloor`)

#### MF-D1 Food batch cost cards and FSSAI (pack `foodmfg`)

**User story.** My aloo bhujia batch uses 40 kg besan, 60 kg potato, 22 L oil and spices; it yields 98 kg, packed into
392 × 200 g and 49 × 400 g pouches; the cost card shows ₹31.40 a 200 g pack including packing film, cartons, gas and
labour, against an MRP of ₹40 and a distributor price of ₹30.

**Acceptance criteria.**
1. **Cost card** (view `costcards`, computed; table `cost_cards` for saved versions with `effective_from`): a recipe
   (existing BOM with `batch_qty` in kg), yield % (output ÷ input weight, frying / moisture loss), pack sizes (variants or
   separate items) with packing material per pack (film, carton share, label), conversion (A2 routing or a typed ₹ per kg:
   gas, power, labour), overhead %; **cost per pack** and margin at the distributor / retailer / MRP prices (price levels,
   R8); what-if on ingredient prices (latest purchase rate vs standard).
2. **Batch record**: the production order (R4-A) of a food item takes `mf.food: { batch_no, packed_on, shelf_life_days,
   best_before?, use_by?, fssai_label? }`; output batches get `mfg_date` = packed date and `expiry_date` = packed +
   shelf life (D2) automatically; actual yield vs card yield on completion.
3. **FSSAI**: `SenderProfile.fssai_no` (A5) required to print food invoices when the `foodmfg` pack is on (soft warning,
   never a block); FSSAI licence expiry on the existing licence alerts (reuse R12 `ag-licences.ts` `fssai` kind — the
   licence register is opened to the `foodmfg` pack read-only; no edit to its writer).
4. **Food classes** (`mfg-rules.ts` `FOOD_CLASS_RULES`): `namkeen`, `biscuits`, `sauces`, `pasta_noodles`, `sweets`,
   `chocolates`, `spices_packed`, `pickles`, `rte_food` with rates by date (22 Sep 2025 rows from §2.3a, `verified: false`,
   MF6); typed rate wins.

**Files.** New: `src/lib/mfg/{mf-costcards,mf-food}.ts`, `src/components/mfg/{FoodDesk,CostCardsView}.tsx`.

**Tests.** `tests/mf-costcards.test.ts`: yield; cost per pack with packing; margin by price level; what-if; versioning
by `effective_from`; `tests/mf-food.test.ts`: batch dates from shelf life; FSSAI warning; class rates by date.

#### MF-D2 Shelf life at dispatch; distributor schemes preset (pack `foodmfg`)

**User story.** A modern-trade buyer accepts only stock with at least 70% shelf life left; when I pick batches for its
order, the app skips older batches and warns if none qualify. My trade scheme "10 + 1 on 200 g" and the quarterly
secondary discount by credit note follow Circular 251.

**Acceptance criteria.**
1. Item field `shelf_life_days` (additive; also used by D1) and client field `Client.mf.min_shelf_pct?` (or days).
2. **FEFO with a floor**: batch allocation on invoices / challans for such a client (existing `allocateFefo` callers in
   the editor, one lazy filter) skips batches whose remaining life % on the dispatch date is below the client's minimum;
   a shortfall shows "no batch with ≥ 70% life — n units qualify".
3. **Near-expiry desk** (view `shelflife`): stock by batch with remaining life %, by godown and distributor (for stock
   at a C&F / van godown); suggested actions (liquidate, return to factory); the existing expiry tab stays the list of
   expired stock.
4. **Schemes**: a "food / FMCG" preset in the R8 scheme screen (free goods, slab discount, display claim) — data only, no
   new engine; post-sale discounts by **financial credit note** (existing `FCN`, no GST) with the Circular 251/08/2025
   note ("no ITC reversal by the dealer; a separately paid promotion is a taxable service"), MF15.
5. Return of expired goods from distributors: existing credit notes; a "destroyed" reason posts a QC scrap journal (R4-A)
   and shows the Sec 17(5)(h) ITC note already used by QC.

**Files.** New: `src/lib/mfg/mf-shelf.ts`, `src/components/mfg/ShelfLifeView.tsx`. Edit: the batch allocation filter in
the editor (one lazy guarded line, §6), the R8 scheme presets (one data row).

**Tests.** `tests/mf-shelf.test.ts`: remaining-life % by date; allocation skips below the floor; shortfall message;
near-expiry buckets; scheme preset loads; FCN carries no GST.

#### MF-D3 MSME both ways: Udyam receivables, 43B(h) interest claims, Form-1 working paper (pack `shopfloor`)

**User story.** As a micro enterprise I see which buyers owe me past 45 days and the Sec 16 interest building up, and send
a polite reminder citing the Act; as a private limited company buyer I get the MSME Form-1 working paper for April–
September from my own payables.

**Acceptance criteria.**
1. **Receivable side** (view `msme`, needs `SenderProfile.msme_udyam` and category micro / small): invoices to business
   buyers (GSTIN) past the Sec 15 limit (agreed due capped at 45 days, else 15 days — `msme.paymentLimit`), with
   Sec 16 interest to date (`msmedInterest`, compound monthly at 3 × the bank rate) and "the buyer's deduction for this
   amount moves to the year of payment (43B(h))" as information; a reminder template (WhatsApp / e-mail / print) citing
   MSMED Sec 15 / 16 and, optionally, MSME Samadhaan (text only, no portal link-up); interest claim letter (A4). Nothing
   is posted: interest is income only when the user raises a debit note (existing).
2. **Payables side additions** (`MsmeCard` unchanged): **MSME Form-1 working paper** for companies (constitution from
   the profile): per half-year (Apr–Sep, Oct–Mar) — supplier, PAN, Udyam, amount due, date due, days, amount still unpaid
   beyond 45 days at the half-year end, "reason for delay" typed per row; CSV / XLSX; due-date reminder (31 Oct / 30 Apr)
   in the compliance calendar (lazy row group); "verify — MF23" on penalty / form text.
3. **Supplier classification aid**: vendors with a Udyam number but category missing are listed; a "trader (not covered
   for 43B(h))" flag on the vendor (`Vendor.mf.msme_trader`, MF21) removes them from the 43B(h) totals with a note.
4. The A5 Udyam line and clause print on our invoices (owned by A).

**Files.** New: `src/lib/mfg/{mf-msme-recv,mf-msme-form1}.ts`, `src/components/mfg/{StatutoryDesk,MsmeView}.tsx`. Edit:
`msme.ts` (one export: a `traderExcluded` filter honoured by `disallowance43Bh` — reviewed by the lead; existing tests
pass unchanged), the compliance calendar source (one lazy group).

**Tests.** `tests/mf-msme.test.ts`: receivable limit and interest equal `msme.ts` on mirrored data; only GSTIN buyers;
Form-1 half-year cut-off; unpaid-beyond-45 at the half-year end; trader flag removes from 43B(h) totals; reminder text.

#### MF-D4 Incentives and export authorisations (PLI, subsidies, Advance Authorisation, EPCG)

**User story.** I hold Advance Authorisation 0310xxxxxx for 12 t of polymer against 10 t of exported caps (SION or my own
norm); the register shows imports against it, exports made, EO balance by quantity and value, days left, and the
duty saved at risk; my state capital subsidy of ₹18 lakh sanctioned last year and the PLI claim for FY 2025-26 are
tracked to receipt.

**Acceptance criteria.**
1. Table `export_authorisations`: `{ id, kind: 'aa' | 'epcg', number, date, port?, items_import: [{ item_id, qty, unit,
   cif_value }], items_export: [{ item_id, qty, fob_value }], norm: 'sion' | 'self' | 'committee', sion_ref?, import_valid_to,
   eo_due, eo_extended_to?, duty_saved, eo_multiple? (EPCG, default 6), status: 'open' | 'eodc_applied' | 'redeemed' |
   'lapsed', eodc_ref? }`.
2. **Imports against it**: an import bill (R4-C BOE duty sheet) gets `PurchaseRecord.mf.authorisation_id`; the BOE sheet
   shows duty foregone (BCD + IGST + cess exempted) instead of duty paid (memo; nothing extra posted).
   **Exports against it**: an export invoice gets `mf.kind = 'export_aa'` header (A5: "Supplied under AA no. …"), and
   the shipping-bill fields (R4-C) carry the authorisation; RoDTEP claims on such exports use the 4RE label (R4-C register,
   additive `appendix: '4R' | '4RE'` on the claim, MF18).
3. **EO register**: quantity and value exported vs obligation; imports consumed per the norm (from manufacturing journals of
   the export items, optional); days to `eo_due`; bell 90 / 30 days before; "duty saved at risk" = duty_saved × unfulfilled
   share (memo) and the HBP shortfall note (MF16). EPCG: EO = `eo_multiple` × duty saved over the period, block-wise
   progress (MF17). Papers for ANF 4F as CSV; nothing is filed.
4. Table `incentive_claims`: `{ id, scheme: 'pli' | 'state_capital' | 'interest_subvention' | 'power' | 'sgst_reimbursement'
   | 'freight' | 'other', name, sanction_ref?, period_from, period_to, eligible_base?, rate_pct?, claimed, approved?,
   received?, kind: 'income' | 'capital', conditions?: string, recognised_on? }`; journals through `saveVoucher` (lazy):
   **recognise** (Dr Incentive receivable | Cr Government grant income — or for `capital`, Cr Capital subsidy / the
   asset's cost by the user's policy, MF19) only when the user marks "reasonable assurance" with a date; **receive**
   (receipt). Bell: claims pending > 180 days.
5. Help: PLI and grant accounting (Ind AS 20 / AS 12) and tax treatment as open CA items.

**Files.** New: `src/lib/mfg/{mf-authorisations,mf-incentives}.ts`, `src/components/mfg/{AuthorisationsView,IncentivesView}.tsx`.
Edit: `trade/export-incentives.ts` (additive `appendix` field passed through, one line, reviewed by the lead), the BOE
duty sheet (one lazy "under authorisation" switch).

**Tests.** `tests/mf-authorisations.test.ts`: EO balances by quantity and value; validity and EO dates; at-risk memo;
EPCG multiple; BOE duty foregone not posted; `tests/mf-incentives.test.ts`: recognition only after assurance; journals
balance; capital vs income; bell.

#### MF-D5 WIP with conversion cost; Schedule III inventories split (pack `shopfloor`)

**User story.** At 31 March my auditor wants raw materials, WIP, finished goods, packing material, stores and scrap
separately, with WIP including the machine and labour cost already spent on half-made orders; the app gives the split and
the working.

**Acceptance criteria.**
1. **Conversion into WIP and output** (the round's only engine change): job-card hours × the work centre's rate (A2 / A3)
   become a **conversion line** on the order's output journal (an `AdditionalCost` of mode `amount`, existing type) so the
   produced goods carry conversion (setting `mfg_settings.absorb_conversion`, **default off** — turning it on changes
   stock values from that date; the setting is dated and audited). Partially done orders: conversion spent on open job
   cards is a **memo WIP addition** at report time (not in the stock engine), shown in the inventories working.
2. **Normal-capacity rule** (AS 2): fixed overhead rates (the `overhead_rate` part of a work centre) absorb on actual hours
   but never above `normal_hours` per period (setting per work centre); the unabsorbed overhead is shown as a period cost
   in the working (MF24).
3. **Inventories split** (`mf-inventories.ts`, view `inventories`, also feeding `notes-auto.ts` `inventoryNote` through
   one optional argument): by item **class** — `StockItem.mf_inv_class?: 'raw' | 'wip' | 'finished' | 'traded' | 'stores' |
   'packing' | 'tools' | 'scrap'` (defaults: items with a BOM → finished; components only → raw; scrap outputs → scrap;
   WIP godown stock → wip; an R12 / R9 company's items keep "traded"), valued by `loadStockValuer()` positions (so Books,
   the Gateway and ratios agree) plus the memo conversion of (1); the note prints the Schedule III sub-heads with the
   previous year (MF25). Without any class the note prints as today.
4. **Year-end WIP statement** (A4 print / CSV): open orders, materials issued, output reported, WIP materials, memo
   conversion, total; feeds the year-end checklist step (existing `year_end` marks: new mark `wip_statement`).
5. Nothing posts to the ledger beyond what exists today (closing stock by report-time valuation / closing-stock journal);
   the netting rule (`netOfStockJournals`) is unchanged.

**Files.** New: `src/lib/mfg/{mf-conversion,mf-inventories}.ts`, `src/components/mfg/{WipView,InventoriesView}.tsx`. Edit:
`production/orders.ts` (`buildOutputVoucher` takes an optional conversion line — the same argument object as A3's scrap
lines, one edit owned by A, D fills it), `ledger/notes-auto.ts` (`inventoryNote` optional split rows), the year-end
marks list (one id).

**Tests.** `tests/mf-conversion.test.ts`: conversion line equals hours × rate; off by default (stock values unchanged —
existing inventory tests pass); normal-capacity cap and unabsorbed overhead; dated switch; `tests/mf-inventories.test.ts`:
split sums to the valuer total; default classes; memo conversion only in the working; note unchanged without classes.

---

## 5. Work packages

Four packages, each one agent in its own worktree. **Merge order: MF-A first** (profile, registry, rules / types / shared
scaffolds, the `mf` record key, template mounts, stubs, every desk tab, help and Ctrl+K row, the `buildOutputVoucher`
optional argument object). MF-B, MF-C and MF-D follow in any order and can run in parallel (they share only registries,
rules, types, demo and help). **D5 depends on A2 / A3** (work-centre rates and job-card hours): D5's engine work starts
after MF-A merges; D1–D4 do not wait.

MF-A owns:
- the six pack ids and the profile (`mfg_kind`, `mfg_sub`, `mfg_settings`, `SenderProfile.msme_category` /
  `fssai_no`);
- `mfg-rules.ts`, `mf-registry.ts`, `mf-shared.ts` and `types/mfg-r13.ts` scaffolds (every package's sub-field types of
  `mf` declared in one commit);
- the `R13_RECORD_KEYS` line in `invoice-defaults.ts` (the round's only first-paint byte);
- the series names `JCD`, `FAI`, `PES`, `CUT`, `KPB` (reserved in one commit);
- every template mount in `TemplateEngine.tsx` (lazy imports by the paths in this PRD);
- `MFG_PACK_TABS`, `R13Stub.tsx` and every R13 desk / view / help / Ctrl+K row (§6).

### MF-A — Profile and shop-floor core (A1–A5)

Owned (new):
- `src/lib/mfg/mf-{profile,registry,settings,shared,centres,routings,jobcards,floor-report,mrp-dated,capacity,snapshot,
  print}.ts`, `src/lib/mfg-rules.ts`;
- `src/types/mfg-r13.ts`;
- `src/components/mfg/{MfgKindPicker,FloorDesk,CentresView,RoutingsView,JobCardsView,OperatorScreen,LoadView,
  DatedPlanView,R13Stub}.tsx`;
- `src/components/templates/parts/{MfgBlock,MfgAnnexurePage,UdyamLine}.tsx` + `mfg-paper.module.css`;
- `src/i18n/areas/mfg-r13a*.ts`; `src/lib/demo/profile-mfg.ts` (dispatcher + A's floor block);
- `docs/features/manufacturing-r13.md` (one doc for the round; each package edits only its section);
- tests `mf-profile`, `mf-routings`, `mf-jobcards`, `mf-mrp-dated`, `mf-capacity`, `mf-print`, `mf-registry`, `mf-rules`,
  `mf-pack-gate`.

Owned (edit):
- `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`;
- `SetupWizard.tsx`, `FeaturesPanel.tsx`; `page-tabs.ts` (`MFG_PACK_TABS`), `Manufacturing.tsx` (lazy desk mounts);
- `TemplateEngine.tsx`, `paper-helpers.ts` (`mfLineText`, `mfDeclaration`), `invoice-defaults.ts` (one token);
- `production/orders.ts` (release copies the routing; `buildOutputVoucher` optional `{ scrapLines?, conversion? }`);
- the MRP tab (lazy "By date" toggle), the item form (lazy lead-time row), the payroll attendance screen (lazy import
  row), the profile form and `PaymentTermsPanel.tsx` (category, FSSAI, print switch);
- `tests/help-registry.test.ts`, `tests/help-glossary.test.ts`, `tests/docs-links.test.ts` (regex + `MF`),
  `tests/purchase-contract.test.ts` (A's readers).

Budget: first paint ≤ +0.06 kB (the `mf` key only, target +0.02); total ≤ 18 kB gz.

### MF-B — Engineering, plastics, printing (B1–B5)

Owned (new): `src/lib/mfg/mf-{drawings,inspection,weight,quotes,scrap,scrap-tax,runs,epr,paper,estimates}.ts`;
`src/components/mfg/{ShopDesk,DrawingsView,InspectionView,QuotesView,ScrapView,MouldingDesk,RunsView,BalanceView,EprView,
PressDesk,EstimatesView,TicketsView}.tsx`; `src/i18n/areas/mfg-r13b*.ts`; tests `mf-drawings`, `mf-weight`, `mf-quotes`,
`mf-scrap`, `mf-runs`, `mf-epr`, `mf-paper`, `mf-estimates`.

Owned (edit): `RcmGoodsNotice.tsx` (one lazy scrap-class lookup).

Shared (§6): `gst-guards.ts` hook (A's), rules (`// MF-B`), types (`// MF-B`), registry block, demo block, `mf`
sub-objects `drawing`, `print`, `scrap`.

Budget: total ≤ 14 kB gz.

### MF-C — Textiles and garments (C1–C5)

Owned (new): `src/lib/mfg/mf-{styles,cutplans,bundles,cmt,eway-jw,itc04-extra,karigar,piece-bill,textile-tax,
inverted}.ts`; `src/components/mfg/{GarmentsDesk,StylesView,CutPlansView,BundlesView,BundleTickets,CmtView,KarigarsView,
InvertedDutyView}.tsx`; `src/i18n/areas/mfg-r13c*.ts`; tests `mf-cutplans`, `mf-bundles`, `mf-cmt`, `mf-eway-jw`,
`mf-itc04`, `mf-karigar`, `mf-textile-tax`, `mf-inverted`.

Owned (edit): the Material Out / In grids (one lazy bundle column), the band hook in the editor (one lazy class check).

Shared (§6): `job-work.ts` (one additive line kind `scrap_at_jw`, reviewed by the lead), `bank-upload.ts` (adapter row),
rules, types, registry, demo, help, `mf` sub-object `cmt`.

Budget: total ≤ 14 kB gz.

### MF-D — Food / FMCG and the statutory desk (D1–D5)

Owned (new): `src/lib/mfg/mf-{costcards,food,shelf,msme-recv,msme-form1,authorisations,incentives,conversion,
inventories}.ts`; `src/components/mfg/{FoodDesk,CostCardsView,ShelfLifeView,StatutoryDesk,MsmeView,AuthorisationsView,
IncentivesView,WipView,InventoriesView}.tsx`; `src/i18n/areas/mfg-r13d*.ts`; tests `mf-costcards`, `mf-food`, `mf-shelf`,
`mf-msme`, `mf-authorisations`, `mf-incentives`, `mf-conversion`, `mf-inventories`.

Owned (edit): the batch-allocation filter (one lazy line), the R8 scheme presets (one data row), the compliance calendar
source (one lazy group), `ledger/notes-auto.ts` (`inventoryNote` optional rows), the year-end marks list (one id), the BOE
duty sheet (one lazy switch).

Shared (§6): `msme.ts` (one export, reviewed by the lead), `trade/export-incentives.ts` (additive `appendix`, reviewed by
the lead), `production/orders.ts` (fills A's `conversion` argument, no edit), rules, types, registry, demo, help, `mf`
sub-objects `food`, `export_aa`.

Budget: total ≤ 14 kB gz.

**Combined:** first paint ≤ +0.06 kB (target ≈ +0.02); total JS ≤ +60 kB (stop-and-ask at +100 kB). Each package runs
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run check:size` on its branch and again after
rebase.

---

## 6. Shared-file protocol

| File | Who | Rule |
|---|---|---|
| `src/types/mfg-r13.ts` | A creates | One `declare module` block per package, marked `// MF-A` … `// MF-D`. A declares, for every package in one commit: the record key `mf?: MfSnapshot` with sub-objects `drawing`, `print`, `scrap` (B), `cmt` (C), `food`, `export_aa` (D) and the per-line map; settings `mfg_kind`, `mfg_sub`, `mfg_settings`; `SenderProfile.msme_category`, `fssai_no`; `ProductionOrder.mf` (`ops`, `grid`, `food`); `StockItem` `lead_days`, `make_days`, `mf_scrap_class`, `mf_class`, `mf_epr`, `shelf_life_days`, `mf_inv_class`, `mf.style`; `Vendor.mf` (`karigar`, `msme_trader`); `Client.mf` (`epr_no`, `min_shelf_pct`); `PurchaseRecord.mf`; `JobWorkLine.mf`. Packages fill only their own block. |
| `src/store/invoice-defaults.ts` | A | **One edit**: `export const R13_RECORD_KEYS = ['mf'] as const;` and the token in the existing `R9_RECORD_KEYS` spread (after R12's). Nothing else; no line key. |
| `src/lib/mfg-rules.ts` | A creates | Sections `// MF-A` (none statutory: `WORK_DEFAULTS` — efficiency 100, set-up "practice"), `// MF-B` `SCRAP_CLASS_RULES`, `PRINT_CLASS_RULES`, `DENSITY_DEFAULTS` ("practice"), `// MF-C` `TEXTILE_CLASS_RULES`, `RULE_89_5_RULES`, `// MF-D` `FOOD_CLASS_RULES`, `MSME_FORM1_RULES` (half-years, due days), `AA_RULES` (validity 12 / 18 months, as read in HBP Ch. 4), `EPCG_RULES` (6 ×, unverified), `INVENTORY_HEADS` (Schedule III sub-heads). Every row has `from`, `source`, `verified`. |
| `src/lib/trading-rules.ts`, `retail-rules.ts`, `trade/trade-rules.ts`, `tax-rules.ts` | — | **Not edited.** TCS on scrap, price bands, realisation / customs, MSME days and ITC-04 frequency are imported read-only. |
| `src/lib/mfg/mf-registry.ts` | A creates | `MF_TABLE_ACTIONS` / `MF_WATCHED`, one block per package — A: `mfg_settings`, `work_centres`, `routings`, `job_cards`; B: `drawings`, `inspection_reports`, `job_quotes`, `process_runs`, `print_estimates`; C: `cut_plans`; D: `cost_cards`, `export_authorisations`, `incentive_claims`. `tests/mf-registry.test.ts` pins both maps. |
| `src/lib/backup.ts`, `sync-engine.ts` (`DATED`, `NUMBERED`), `trust/open-export-schema.ts` | each its own rows | Append-only blocks `// R13-A` … `// R13-D`. |
| `src/components/templates/TemplateEngine.tsx` | A | Three lazy imports + mounts: `UdyamLine` (under the seller GSTIN, guarded by `sender.msme_udyam` / `fssai_no`), `MfgBlock` (after `PartyPanel` and the R12 `AgriBlock`; before `GstBody`; never on `receipt`), `MfgAnnexurePage` (following page, after R11 / R12 pages). B / C / D add only their sub-object renderers inside A's parts (one `switch` arm each, in their own files `parts/mfg/*.tsx`). |
| `paper-helpers.ts` | A | `mfLineText` call inside `trackingText`, `mfDeclaration`; appended after R12 helpers. |
| `src/lib/industry-packs.ts` | A | Six ids; `PACK_TABS` block `// R13` (every desk and view). |
| `src/pages/page-tabs.ts`, `src/pages/Manufacturing.tsx` | A | New `MFG_PACK_TABS` (`floor`, `shop`, `moulding`, `press`, `garments`, `food`, `statutory`); one lazy mount per desk after the R4-A tabs. Packages never edit them. `tests/help-registry.test.ts` walks the new list. |
| `src/lib/shop-presets.ts`, `checklist-steps.ts`, `features-catalog.ts`, `SetupWizard.tsx`, `FeaturesPanel.tsx` | A | Appended blocks `// R13`, after R12 blocks. |
| `src/lib/production/orders.ts` | A (D fills) | Two edits by A: release copies the default routing (guarded by the `shopfloor` pack); `buildOutputVoucher(order, …, extra?: { scrapLines?, conversion? })`. Without `extra` the output is byte-identical (`tests/production*.test.ts` unchanged). |
| `src/lib/gst-guards.ts` | A (B, C, D use A's hook) | One lazy class-rate check over `mf_class` / `mf_scrap_class` / food classes (the R12 `ag_class` hook shape); no second edit. |
| `src/lib/job-work.ts` | C | One additive line kind `scrap_at_jw` in the settlement switch; reviewed by the lead; `tests/job-work*.test.ts` and `itc04` tests pass unchanged. |
| `src/lib/eway-job-work.ts` | C (read) | No edit; `mf-eway-jw.ts` builds the new cases with the same layout helpers (one export if needed, reviewed by the lead). |
| `src/lib/msme.ts` | D | One export (`traderExcluded` filter) honoured by `disallowance43Bh`; existing tests unchanged. |
| `src/lib/trade/export-incentives.ts` | D | Additive `appendix` field passed through; reviewed by the lead. |
| `src/lib/bank-upload.ts` | C | One adapter row (karigar piece bills) beside R12's; formats unchanged. |
| `src/lib/ledger/notes-auto.ts` | D | `inventoryNote` takes optional split rows; unchanged output without them. |
| `src/lib/help/topics-*.ts`, `glossary.ts`, `src/i18n/areas/discover-r6-tabs.ts` | A | A writes every R13 topic and Ctrl+K title in one `// R13` block per file using this PRD's view ids; packages correct their rows after rebase. |
| `src/lib/demo/profile-mfg.ts` | A creates | Dispatcher by `mfg_kind`; one block per package. |
| `tests/purchase-contract.test.ts` | A, B, C, D | Each appends its reader modules. |
| `tests/e2e/smoke.mjs` | A, B, C, D | One appended `step(...)` block each, in merge order. |
| `docs/features/manufacturing-r13.md` | A creates | One section per package; each records its bundle numbers there. |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md` | lead | After merge: the Round 13 section; table rows; settings keys; the `mfg-rules.ts` note; "Round 13 invoice snapshots live under the record key `mf`"; "every module that writes a Round 13 table must `import './mf-registry'`"; "conversion absorption is a dated setting, off by default"; "karigars are vendors, piece-rate employees stay in payroll". |
| `docs/CA_REVIEW.md` | lead | MF items are added with this PRD; packages report changes as rows in their feature-doc section. |

### Storage summary

| Key / field | Package | Kind | Backed up | Synced | Audited | Right (`mf-registry`) |
|---|---|---|---|---|---|---|
| `mfg_settings` (moulds, presses, absorb switch, eway note, reasons) | A (sub-fields B–D) | object | yes | yes (singleton) | yes | `settings.manage` |
| `work_centres` | A | table | yes | yes | yes | `master.edit` |
| `routings` | A | table | yes | yes | yes | `master.edit` |
| `job_cards` (`JCD`) | A | table, dated (first entry), numbered | yes | yes | yes | `doc.create` |
| `drawings` | B | table | yes | yes | yes | `master.edit` |
| `inspection_reports` (`FAI`) | B | table, dated, numbered | yes | yes | yes | `doc.create` |
| `job_quotes` | B | table, dated | yes | yes | yes | `doc.create` |
| `process_runs` | B | table, dated | yes | yes | yes | `doc.create` |
| `print_estimates` (`PES`) | B | table, dated, numbered | yes | yes | yes | `doc.create` |
| `cut_plans` (`CUT`, bundles inside) | C | table, dated, numbered | yes | yes | yes | `doc.create` |
| `cost_cards` | D | table, dated `effective_from` | yes | yes | yes | `master.edit` |
| `export_authorisations` | D | table, dated | yes | yes | yes | `books.edit` |
| `incentive_claims` | D | table, dated | yes | yes | yes | `books.edit` |
| settings `mfg_kind`, `mfg_sub`; `SenderProfile.msme_category`, `fssai_no` | A | additive | yes | yes | yes | — |
| record key `mf` (sub-objects `drawing`, `print`, `scrap`, `cmt`, `food`, `export_aa`, `lines`) | A (sub-fields B–D) | additive record key (one first-paint token) | yes | yes | yes | — |
| `ProductionOrder.mf`, `StockItem` fields, `Vendor.mf`, `Client.mf`, `PurchaseRecord.mf`, `JobWorkLine.mf` | A–D | additive | yes | yes | yes | — |
| Accounts by name: "Karigar advances", "GST TDS receivable", "Government grant income", "Incentive receivable", "Capital subsidy", "Scrap sales" | B / C / D | created on first use | — | — | — | — |

No migration (everything is additive). Karigars' bank / UPI details are personal data (DPDP Act 2023): they stay on the
device and in the user's own backups like every other table.

---

## 7. E2E steps (production build, `tests/e2e/smoke.mjs`)

1. **R13-A**:
   - Fresh company → wizard → "Factory / manufacturing" → *Engineering* + registered + Udyam number → lands on
     `/manufacturing?tab=floor&view=cards`; Manufacturing shows the Floor, Shop and Statutory desks only.
   - Add two work centres and a routing; release an order → planned hours; report two job-card entries with 1.2 kg
     scrap → the scrap item's stock rises once.
   - An invoice preview shows the Udyam line and the MSE clause (buyer with GSTIN); a plain invoice of an old company is
     unchanged (snapshot compare). Ctrl+K "job cards" finds the view; F1 opens help.
2. **R13-B**:
   - Drawing rev B → rev C; a line naming rev B warns. Weight quote for a flange → quotation with 2 breaks.
   - Sell 300 kg of MS turnings → the 2% TCS preset is suggested; the declaration switch drops it.
   - *Plastics*: one run with regrind → balance closes, one journal. *Printing*: an estimate → sheets, kg, impressions;
     make a quotation.
3. **R13-C**: *Textile* (garments):
   - A style S–XL × 2 colours; a cut plan of 20 plies → 80 pieces, consumption vs standard; 8 bundle tickets print.
   - Send 4 bundles to a fabricator (Material Out by bundle) → receive 3 good + 1 short; karigar piece bill for the good
     pieces; bank row.
   - A job-work return from the principal register → e-way JSON sub-type 6.
4. **R13-D**:
   - *Food*: a cost card shows cost per 200 g pack; a batch gets best-before from shelf life; a client with 70% minimum
     life skips the old batch.
   - Statutory desk: one MSE receivable past 45 days shows Sec 16 interest; the Form-1 paper lists one supplier.
   - An AA with one import and one export → EO balance; an incentive claim recognised after "assurance".
   - Inventories view splits raw / WIP / finished; with absorption off the stock value equals today's.

---

## 8. Open questions — with the default the builders will use

The owner asked for no questions, so each one has a default that the packages implement. A CA answer later changes a
dated rule row or a setting default, never the design.

| # | Question | Default chosen | Why |
|---|---|---|---|
| 1 | New business type or a sub-profile? | Sub-profile `mfg_kind` on `manufacturer`; may co-exist with `agri_kind` (packs union). | Zero shell bytes; R8–R12 pattern. |
| 2 | Where do the screens live? | Desk tabs on `/manufacturing` (`MFG_PACK_TABS`), views in `&view=`. | The factory's home route; no `PACK_ROUTES` row. |
| 3 | One pack or many? | `shopfloor` + five sub-sector packs. | A trader that assembles needs only the floor. |
| 4 | Invoice snapshot | One record key `mf`; Udyam / FSSAI from the sender snapshot. | Budget headroom 0.3 kB; R12 precedent. |
| 5 | Job-card granularity | One row per order per operation with an entries array. | Volume (≈ 30,000 entries / year). |
| 6 | Scheduling | Infinite backward loading + a forward "promise date"; no automatic re-sequencing. | Simple, explainable, offline. |
| 7 | Conversion in stock value | Dated setting, **off by default**; memo WIP conversion at report time. | Changing stock values silently would move every report (MF24). |
| 8 | Normal capacity | Typed `normal_hours` per work centre; unabsorbed fixed overhead shown as period cost. | AS 2. |
| 9 | Inventories split | Item class with defaults from BOM role; note unchanged without classes. | Schedule III; no surprise for existing users (MF25). |
| 10 | Udyam on invoices | Printed by default when the profile has it; a switch turns it off. | No rule found either way; buyers rely on it (MF22). |
| 11 | MSE clause | Printed for micro / small sellers to GSTIN buyers. | MSMED Sec 15; the existing note made visible. |
| 12 | Traders' Udyam | Vendor flag "trader" excludes from 43B(h) totals; off by default. | OM of 2 Jul 2021 as reported (MF21). |
| 13 | Form-1 | Working paper for companies only; reasons typed. | MCA order; penalty text unverified (MF23). |
| 14 | Scrap TCS | Existing 2% preset suggested on scrap classes; buyer's declaration drops it. | Sec 394(1) / Finance Act 2026 (MF9, MF10). |
| 15 | Scrap scope | The app never decides "is it scrap"; class + note. | Case law split (MF9). |
| 16 | Metal scrap GST | 18%; RCM prompt on unregistered purchases; GST TDS note on registered sales above ₹2.5 lakh. | N 6/2024-CT(R), N 25/2024-CT (MF7). |
| 17 | Plastic waste rate | No suggestion; typed rate. | Sources conflict (MF8). |
| 18 | Printing rate | Classes for own-paper goods, job work on ch 48 / 49 (5% from 22 Sep 2025, AAR note), cartons 5%, other 18%. | N 15/2025 as cited; AAR conflict (MF3). |
| 19 | Residual job work | 18% suggested from 22 Sep 2025, 12% / 18% before shown as "verify". | Conflict (MF5). |
| 20 | Textile job work | 5% suggested. | 2017 amendments as reported (MF2). |
| 21 | Garment band on output | R9 bands applied on sale lines by item class, even without the apparel pack. | One rule for makers and retailers (MF1). |
| 22 | Karigars | Vendors with piece bills (`KPB`); employees stay in payroll. | Two different laws (TDS vs payroll) (MF28). |
| 23 | GST on karigar bills | None for unregistered (no RCM); 5% suggested for registered textile job work. | MF2, MF28. |
| 24 | CMT challans | Existing job-work challans by bundle; no new document. | ITC-04 and Sec 143 already work. |
| 25 | Job-work e-way returns | Sub-type 6 from the principal register; State exemption a setting, off. | Rule 138 (MF11). |
| 26 | Scrap at the job worker | A Material In line kind reported in 5A / 5C losses and wastes. | Sec 143(5) as recalled (MF12). |
| 27 | Regrind | In-house regrind is stock with no tax effect; sale of regrind uses the plastic-waste class or a typed rate. | MF27. |
| 28 | EPR | Register and CSV for brand owners; no CPCB filing. | Regulator portal. |
| 29 | Print estimates | Sheets / ups / impressions / GSM maths; finishing typed; quotation via the existing doc type. | Print MIS practice. |
| 30 | Shelf life | `shelf_life_days` sets expiry on output batches; per-client minimum remaining life filters FEFO. | FSS labelling (MF14); trade terms. |
| 31 | FSSAI on invoice | Profile field printed under the GSTIN; soft warning for food companies; never on e-way JSON. | FSSAI order 2021. |
| 32 | Food rates | Class suggestions by date, `verified: false`. | MF6. |
| 33 | Distributor discounts | Financial credit notes with the Circular 251 note. | MF15. |
| 34 | AA / EPCG | Register, EO tracking and at-risk memo; BOE "duty foregone" memo; nothing posted; nothing filed. | HBP Ch. 4 (MF16, MF17). |
| 35 | RoDTEP on AA exports | Claim row carries Appendix 4R / 4RE. | DGFT extension to 31 Dec 2026 (MF18). |
| 36 | Incentive recognition | Only when the user records "reasonable assurance"; income vs capital by the user's policy. | Ind AS 20 / AS 12 (MF19). |
| 37 | Inverted duty | Rule 89(5) working paper; inputs only; pre-fills the existing register. | MF26. |
| 38 | Budget | ≤ +60 kB with per-desk strings; stop and ask at +100 kB; first paint ≤ +0.06 kB. | Round 12 overran 3×; first paint is the hard limit. |
