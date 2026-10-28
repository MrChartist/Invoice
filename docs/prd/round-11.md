# PRD — Round 11: construction (civil / EPC and road contractors, sub-contractors, builders and developers, interiors, MEP, labour contractors)

Status: draft for build · Drafted 2026-10-27 · Baseline: branch `claude/elegant-cannon-cwapiv` at `888d579`. Merged on
the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–9, Round 7 (hotel), Round 8 (TR-A, TR-B, TR-C), Round 9 RT-A … RT-C.
**Round 9 RT-D / RT-E** (`docs/prd/round-9.md`) are being built now and **Round 10** (`docs/prd/round-10.md`, services)
is planned. This round touches none of their files except the shared registries named in §6, and §5 / §6 say how the
three rounds share files and budgets.

Companion documents:
- `docs/CA_REVIEW.md` §11 — the construction CA items **CN1–CN28**, added with this PRD.
- Raw research (URLs and the claim taken from each; P = primary, S = secondary):
  `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/r11/round11-sources.md`; code
  inventory in `…/r11/code-inventory.md` (same folder).

Every item follows `AGENTS.md`:
- local-first and serverless: no CPPP / GeM / e-MB / RERA portal / bank-escrow / EPFO / ESIC calls; files, `wa.me`
  links and the device camera only;
- vanilla CSS Modules with tokens; templates use the `accent` variable only (Critical Rule 5);
- invoice snapshots never change: everything a construction document prints is snapshotted on the document;
- Indian-FY numbering for every new series;
- bare dates parsed as local days;
- statutory values date-keyed and append-only, in rule files kept out of first paint;
- GST, TDS, cess and RERA outputs labelled as working papers ("verify with your CA").

---

## 1. Problem statement

Round 5 (R5-B4 … B6) gave the `contractor` business type a **works pack** (`Time → Works`): a sales order as the BOQ,
measured RA bills (previous / this / cumulative), an RA abstract as its own HTML page, a deduction set (retention,
mobilisation-advance recovery, 194C, GST TDS u/s 51, BOCW cess, security deposit, LD, other), a "due now / held"
receivable split, the GST TDS / cess receipt journals (`ra_journal_id`), retention alerts and site godowns with
theoretical-vs-actual material. That is a good engine. But the owner's test is: **"each and everything has a perfect
area in our invoice"**, and §2.4 shows that the document a contractor actually hands over still has no place for most
of it:

1. **The printed RA bill is an ordinary invoice.** `TemplateEngine.tsx` prints none of the R5 fields: no RA bill no.,
   no name of work / agreement / work order, no "work done from – to", no BOQ item no. (`boq_ref` is stored but never
   printed), no M-book references, no previous / this / cumulative columns, no deductions, no **net payable**, no
   certificate or "measured by / checked by / passed for payment" block. The only trace is one notes line ("RA bill no.
   4 — SO/… · work order …") and the IT TDS line. The abstract is a separate HTML page reachable only from Works → RA
   register, so a shared PDF or a WhatsApp link never carries it. The invoice editor shows none of these fields
   either (`src/components/creator/*`: no reference to `ra_no`, `boq_ref` or `ra_deductions`).
2. **Contractor finance stops at the deduction set.** There is no contract register (agreement no., dates, stipulated /
   extended completion, EOT, LD cap), no **secured advance** against materials at site, no interest on mobilisation
   advance, no **price variation / escalation** (CPWD clause 10CC-type formula), no recovery of **client-issued
   materials**, water / electricity or hire charges, no **withheld** amounts, no **bank guarantee / PBG / EMD**
   register, no extra / substituted / deviation item classes beyond a single "Extra item —" line, no final-bill
   closure (no-claim certificate, retention and SD release).
3. **Builders and developers have nothing.** No project / tower / unit master with RERA registration and carpet area,
   no booking, cost sheet or allotment letter, no **construction-linked payment plan** with stage demands and demand
   letters, no 1% / 5% (without ITC) real-estate classes with the deemed one-third land value, no completion-
   certificate switch (sale after CC is not a supply), no **RERA 70% designated account** tracker, no cancellation /
   forfeiture flow, no 80% registered-procurement test.
4. **Site operations are thin.** Sub-contractors are billed to us as plain purchase bills (no back-to-back work order,
   measurement, retention or recovery); labour contractors' PF / ESI compliance is not tracked (principal-employer
   risk); daily-wage site labour has no muster; plant and machinery have no log sheet or hire bill; material
   reconciliation has no permissible-wastage band or client-material recovery; there is no **site P&L** with unbilled
   work (WIP) and cost to complete.
5. **Setup.** "Contractor" is one business type: a road contractor billing a PWD, an interior firm, an electrical
   sub-contractor, a builder selling flats and a labour contractor all get the same screens.

**Goal of Round 11:** ship **20 items in four work packages** with mostly disjoint files:
- **CN-A**: the construction profile, works-contract tax classes, and the **construction bill document and print**
  (RA bill paper, abstract page, M-book references, cumulative columns, deductions / recoveries block, certificate
  block, contract particulars) — 5 items;
- **CN-B**: contractor finance — contract register, advances (mobilisation with interest, secured, plant), price
  variation, recoveries / withheld / LD, guarantees and deposits, final bill and closure — 5 items;
- **CN-C**: builders and developers — units and RERA, bookings and cost sheets, payment plans and demand letters,
  real-estate GST classes, RERA account, cancellations, 80% procurement — 5 items;
- **CN-D**: site operations — sub-contractor work orders and bills, labour contractors and site muster, plant and
  equipment, material reconciliation, site P&L and WIP — 5 items.

### How the construction profile switches on (no clutter for others)

- The business type stays **`contractor`** (`shop-mode.ts`), so there is no new `BusinessType` and no shell bytes. The
  setup wizard and Settings → Features gain a **construction picker** when `contractor` is chosen:
  - *Civil / EPC / road contractor* (government or private works);
  - *Sub-contractor* (works for a main contractor);
  - *Builder / real-estate developer* (sells flats, shops, plots);
  - *Interiors / fit-out contractor*;
  - *Electrical / plumbing / HVAC (MEP) contractor*;
  - *Labour contractor / manpower supplier*;
  - *Other contractor* — today's preset, unchanged.

  The choice is stored as the additive settings field `construction_kind` (the R8 `trade_kind` / R9 `retail_kind` /
  R10 `service_kind` approach). It sets `modules`, an explicit `industry_packs` list and the switches in
  `construction_settings` (§4 CN-A1).
- **One new pack** in `industry-packs.ts`: `realty` (builders). Every contractor kind keeps the existing `works` pack.
  Contractor features that only some kinds need (labour muster, plant, sub-contract work orders, escalation) are
  **views of the existing Works tab**, listed by `construction_settings` switches, not new packs.
- Placement, never a new route or sidebar item:
  - Works tab on `/time` (exists) gains views; every contractor kind keeps the `time` module, so **`PACK_ROUTES` is not
    changed for `/time`**.
  - The builder desk is a tab `realty` on **`/receivables`**, which is always on (no module), so `PACK_ROUTES` needs no
    row for it either.
- `PACK_OF_TYPE` is **not** changed (`contractor` still implies `works`): every existing contractor company sees
  exactly what it saw. It gets a one-time setup-checklist step "Pick your kind of construction business".
- The **construction bill paper** (CN-A3 … A5) is not pack-gated: it prints whenever a document carries the
  construction snapshot (an RA bill, a demand, a works-contract invoice), so a company that switches the pack off
  still reprints its old bills exactly.

### Budgets the packages must respect

Lead-reported on the baseline (`npm run build && npm run check:size`):

| Budget | Now | Limit | Headroom | Shared with |
|---|---|---|---|---|
| Initial JS (first paint, gz) | **184.6 kB** | 185 kB | 0.4 kB | Round 9 RT-D/E (≤ +0.1 kB), Round 10 (+0.03 kB) |
| Entry chunk (gz) | — | 90 kB | — | |
| Total JS (gz) | **≈2750 kB** | 2900 kB | ≈150 kB | Round 9 RT-D/E (rest of ≤ 60 kB), Round 10 (≤ 45 kB) |

Rules:
- **First paint: Round 11 = 0 bytes, by design.**
  - **No new record or line key.** Everything Round 11 stores on an invoice lives under keys that `normalizeRecord`
    already keeps: the record key **`boq_terms`** (R5-B, kept verbatim) gains one sub-object **`cn`** by declaration
    merging on `BoqTerms` (the construction snapshot, including a per-line map `cn.lines[lineId]`), and new deduction
    kinds go into the existing **`ra_deductions`** array. `invoice-defaults.ts` is **not edited**.
  - The new deduction kinds extend the `RaDeductionKind` union (types only, zero bytes) — one token-list change in
    `types/transport-works-r5.ts`, the `ProgressBasis` precedent of R5-B.
  - No `PACK_ROUTES`, `TABLE_ACTIONS`, `WATCHED_TABLES`, `no-cash.ts`, `tax-rules.ts` or shell edit. Table rights and
    audit labels register at runtime (`src/lib/construction/cn-registry.ts`, the `tr-registry.ts` pattern).
  - Template additions are lazy parts (the R4-C1 `ExportBlock` pattern), mounted only when `boq_terms.cn` or `ra_no`
    is present; `TemplateEngine.tsx` is in the editor / preview chunk, not first paint (`check:size` confirms).
- **Total JS for the round ≤ +50 kB gz**: CN-A ≤ 15 kB, CN-B ≤ 10 kB, CN-C ≤ 14 kB, CN-D ≤ 11 kB.
- **Everything is lazy.** No new route. The Works tab's new views are lazy sub-chunks of `WorksTab.tsx`; the builder
  desk is one lazy chunk mounted by `Receivables.tsx`; editor, bill-modal and payment-dialog parts are lazy sub-rows
  mounted only when their pack or snapshot is present.
- **Rule data is a chunk.** Statutory values go in `src/lib/construction-rules.ts` (new, imported only by lazy screens
  and engines, never by `tax-rules.ts`, `shop-mode.ts` or the shell). Values that already live in
  `transport-works-rules.ts` (GST TDS 51, labour cess, works-contract rate) **stay there** and get new dated rows there
  (append-only); `construction-rules.ts` re-exports nothing from it. `tests/cn-rules.test.ts` checks the import graph.
- **Help text is data.** Topics go in the existing lazy topic files (`topics-packs.ts`, `topics-sales.ts`,
  `topics-statutory.ts`); glossary terms in `glossary.ts`.
- **Icons: reuse only** (grep before use; a new icon name fails review): `Building2` (sites, units — already used by
  `SitesPanel`), `Users` (labour), `Truck` (plant), `ClipboardList` (M-book, muster), `ShieldCheck` (guarantees),
  `Percent` (escalation), `Landmark` (RERA account), `Receipt`, `FileText`, `CalendarDays`, `Scale` (reconciliation) —
  all already imported on the baseline (checked by grep); there is no house icon in use, so units use `Building2`.
- **If the round needs more than 50 kB:** each package builds inside its share first and reports the overrun with a
  breakdown in its section of `docs/features/construction-r11.md`. The lead may raise `BUDGET_TOTAL_GZ_KB` from 2900 to
  **3000** in one commit, recording the reason in `scripts/check-bundle-size.mjs`. Justification prepared here:
  - total JS is the one-time offline precache, not first paint (which stays at its 185 kB limit);
  - Rounds 9 + 10 + 11 together plan ≤ 155 kB on ≈2750 kB, i.e. ≈2905 kB if all three use their full share — just
    over 2900 with no room for a QA round;
  - each vertical's code downloads into the precache once and runs only for companies with that pack on.

  Default: **do not raise** before Rounds 9–11 have measured; raise only if they overrun after trimming.
- Each package records before / after numbers in its section of `docs/features/construction-r11.md`.

### Non-goals

These need a server, a regulator system, a licence the app cannot hold, or are outside billing and books:
- Tender portals (CPPP, GeM, state e-procurement), bid preparation, e-MB portal integration (states with an
  electronic measurement book), e-filing of RERA quarterly updates, bank escrow / RERA account APIs, EPFO / ESIC
  portals, labour-licence applications.
- Scheduling (Gantt / critical path / MS Project), BIM / drawings, quality checklists with photos per stage beyond
  the existing attachments, drone / geo-tagged progress.
- Real-estate CRM (leads, site visits, broker portals), home-loan disbursement tracking with banks (the bank is shown
  only as a payer on a receipt).
- Payroll for daily-wage labour through the confidential payroll engine (the site muster is a separate, light
  record — §4 CN-D2), biometric attendance devices.
- Automatic revenue recognition entries (percentage of completion): the app shows WIP / unbilled work as a memo
  (CN-D5) and leaves the year-end entry to the accountant.

---

## 2. Findings

### 2.1 What construction businesses use and praise / complain about (research)

P = vendor's own documentation or official text; S = secondary (press, review site, blog). Full list in
`round11-sources.md`. Review samples for Indian construction apps are thin; vendor claims are marked as such.

| Segment | Tools they use | Praised for | Complaints / gaps | Source |
|---|---|---|---|---|
| SME civil contractors | Powerplay, Onsite, Excel + Tally / Busy, myBillBook | Mobile site updates, material requests, labour attendance and payment, sub-contractor ledger in one app (Powerplay claims 40,000 firms, ~40% of projects in Tier II / III towns) | Cloud-only, per-seat; RA bills still made in Excel in the client's format; books re-keyed into Tally; GST TDS / cess / retention reconciled by hand | S peakxv, realtynmore (press release Dec 2025), cbinsights |
| EPC / infra | StrategicERP, Highrise-type construction ERPs, SAP | BOQ, RA billing, sub-contract, plant | Costly, implementation-heavy; positioning only, vendor pages not read this round | L (general knowledge) |
| Builders / developers | Sell.Do and other real-estate CRMs, Tally, StrategicERP | CLP demand letters per tower when a stage is certified, interest and GST from the cost sheet, WhatsApp dispatch, receipts ledger, credit notes | CRM and books are separate; RERA 70% account and withdrawal certificates kept in Excel | S sell.do (vendor) |
| Sub-contractors | Paper RA bills, Excel | — | Retention held till DLP, TDS / GST TDS / labour cess deducted by the main contractor and never reconciled | S open.money (blog) |
| Government contractors | PWD formats on paper (CPWD-23 measurement book, CPWD-26 running account bill, CPWD-24 first and final bill, 26A secured-advance account) | The department checks the bill line by line against the M-book; final bill on separate (yellow) forms | Contractor must reproduce the department's abstract exactly; the M-book is the department's record | S PWD forms list (scribd), Tripura PWD sample bill, infralens |

**What carries over to an offline app:**
- **The bill paper** in the department's shape: RA no., period, name of work, agreement, item-wise abstract with
  M-book pages and previous / this / cumulative columns, deductions and recoveries to net payable, certificates.
- **Contract money**: advances with interest and recovery schedules, escalation by formula with typed indices,
  recoveries and withheld amounts, guarantees with expiry alerts — all our own records over ordinary invoices and
  receipts.
- **Builders**: unit master, bookings, cost sheet, stage demands with interest, RERA account tracking — the Sell.Do
  pattern without the CRM, with real books underneath.
- **Site**: back-to-back sub-contract bills, labour-contractor compliance proof, a daily muster, plant log sheets,
  reconciliation, site P&L.

Offline work, the recycle bin, full audit and real books (GSTR, Tally export, TDS returns) are our edge over the
cloud apps.

### 2.2 Anatomy of a construction bill (every element needs a place)

"Doc" = where it must print. "Today" = the baseline. Items close each row.

| # | Element | Who needs it | Doc | Today | → |
|---|---|---|---|---|---|
| 1 | Name of work, agreement / work order no. and date, tender / estimate ref | all works bills | header | `boq_terms.work_order` stored on the BOQ only; notes line | A3 |
| 2 | Client office (division / circle), engineer-in-charge | govt bills | header | — | A3 |
| 3 | Site address and its State (place of supply, Sec 12(3)) | all | header | `ship_to` prints as "Ship to"; PoS typed | A2, A3 |
| 4 | Contract value, stipulated start / completion, extended completion (EOT) | govt / EPC | header | — | A3, B1 |
| 5 | RA bill no. / "final bill", work done from – to, date of measurement | all | header | `ra_no` in a notes line | A3 |
| 6 | M-book no. and pages per item | govt / PSU | line sub-line, abstract | `mb_ref` on `ra_measurements` only | A3, A4 |
| 7 | BOQ / schedule item no. | all | line | `boq_ref` stored, never printed | A3 |
| 8 | Unit, BOQ qty, rate | all | line / abstract | qty / rate print; BOQ qty abstract only | A4 |
| 9 | Up to previous / this bill / up to date qty and amount, % of BOQ | all | abstract (and line table when chosen) | standalone HTML abstract | A4 |
| 10 | Extra items, substituted items, deviation (qty beyond the deviation limit) with approval ref | govt / EPC | line class + abstract section | one "Extra item —" text prefix | A4, B1 |
| 11 | Price variation / escalation (formula, indices, period) | govt / EPC | its own line or supplementary bill + working sheet | — | B3 |
| 12 | Gross value, GST (CGST + SGST / IGST), total | all | totals | exists | — |
| 13 | Deductions: retention, SD, IT TDS (194C), GST TDS (Sec 51), labour cess | all | deductions block | stored; only IT TDS prints | A5 |
| 14 | Recoveries: mobilisation advance (+ interest), secured advance, client materials, water / electricity, plant hire, other | govt / EPC | deductions block | mobilisation recovery only, not printed | A5, B2, B4 |
| 15 | Withheld amount, LD | govt / EPC | deductions block | LD stored as a fixed amount, not printed | A5, B4 |
| 16 | Net payable (figures and words) | all | totals | `ra_net_payable` stored, never printed | A5 |
| 17 | Contractor's certificate ("work executed as per specifications…", "no previous claim") | all | certificate block | — | A5 |
| 18 | Measured by / checked by / passed for payment (blank signature boxes) | govt / PSU | certificate block | — | A5 |
| 19 | Composite supply declaration (works contract, Sec 2(119)), "GST TDS u/s 51 to be deducted ₹x" note | all | declarations | — | A2, A5 |
| 20 | Builder demand: unit, tower, carpet area, RERA reg. no., stage, % due, previous received, interest, GST, RERA collection account | builders | demand letter / tax invoice | — | C3 |
| 21 | Sub-contractor bill (ours, payable): back-to-back items, retention, recoveries, TDS | main contractors | purchase-side abstract | plain purchase bill | D1 |

### 2.3 Statutory rules (as understood; every row is a CA item)

Confidence: **H** = statute / official text read or long settled; **M** = consistent secondary sources or recalled
text; **L** = sources conflict or nothing found.

| Rule | What applies | App today | Source | Confidence |
|---|---|---|---|---|
| Works contract | Sec 2(119): a contract for building, construction, fabrication, completion, erection, installation, fitting out, improvement, modification, repair, maintenance, renovation, alteration or commissioning of **immovable property** with transfer of property in goods → a supply of **services** (Sch II para 6(a)). Supply + installation of movable goods (an AC, a lift sometimes) is a composite supply of goods instead | One class per line by typed rate; no works-contract flag | CGST Act (recalled) | H → CN3 |
| Works-contract rates | 18% general (N 11/2017-CT(R) entry 3(xii)). From **22 Sep 2025** (N 15/2025-CT(R)): Government earthwork (> 75%) works, offshore oil-and-gas works and their sub-contractors 12% → 18% (all sources agree). Whether **every other 12% item** under heading 9954 (Government civil works, roads, bridges, railways / metro, irrigation, PMAY / low-cost housing, their sub-contractors) also went to 18% **conflicts** across sources | `WORKS_CONTRACT_RATE_RULES`: government 12% → 18% from 22 Sep 2025 | S taxo.online (narrow), busy.in (all 18%), disytax / casurana (all 18%), one guide (some still 12%) | **L** → CN1 |
| Pure labour | Pure labour contracts for a single residential unit (not in a complex) and for PMAY beneficiary-led houses: exempt (N 12/2017-CT(R) entries 10A / 10B as recalled) | — | busy.in SAC 9954 | M → CN2 |
| Place of supply | Sec 12(3): services directly in relation to immovable property → **location of the property** (site State); a contractor billing a site in another State charges IGST unless registered there, and often must register there | PoS typed per invoice | IGST / CGST Act (recalled) | H (rule) / M (registration) → CN4 |
| GST TDS | Sec 51: Government / local authority / notified PSU deducts 2% on contract value > ₹2.5 lakh, on value excluding GST; credit after GSTR-7 / 7A | Exists (`GST_TDS_51_RULES`, I18) | — | H (I18) |
| Labour cess | BOCW Cess Act 1996 → from **21 Nov 2025** Code on Social Security 2020 Sec 100 (1–2%); 1% notified (S.O. 2322(E), 8 May 2026, as reported). Base: cost of construction **excluding land** (Cess Rules 1998 Rule 3); Kerala HC (19 Aug 2026, as reported): not on the supply component of a composite contract | 1% of value before GST (`LABOUR_CESS_RULES`, I19) | S taxmann, barandbench, Delhi labour dept, supremetoday | M → CN5 |
| IT TDS on contractors | 194C 1% individual / HUF, 2% others; ₹30,000 single / ₹1,00,000 aggregate; on value **excluding GST** when shown separately (CBDT Circular 23/2017). ITA 2025 label Sec 393(1) [Table: Sl. No. 6(i)] from 1 Apr 2026 | Exists (`tds-rules.ts`, `ita2025.ts`) | Code + statute | H → CN14 |
| Plant hire | 194-I(a) 2% for plant / machinery rent; hire **with operator** often treated as 194C. ITA 2025 Sec 393(1) Table 2(ii) | 194I-A exists | `tds-rules.ts`, `ita2025.ts` | M → CN17 |
| Price variation | Escalation paid under the contract is further consideration for the same supply: taxable at the works-contract rate; a negative variation reduces value by a Sec 34 credit note | — | Sec 15, 34 (developers' reading) | M → CN6 |
| Mobilisation advance | An advance for services: GST at receipt (Sec 13(2)) and adjusted on RA bills (I17). CPWD practice: up to 10% of tendered value at 10% simple interest against a BG, recovery from 10% to 80% of work | Advance + recovery % exist; no interest | S CPWD payments deck; CAG Report 35/2015 | M → CN8 |
| Secured advance | Advance against non-perishable materials brought to site (CPWD GCC clause 10B; 75% of assessed value in most sources, 90% per CAG), recovered as the material is used in work | — | S CAG reports; CPWD deck | M (practice) / L (GST) → CN7 |
| Client-issued material | Free supplies by the recipient: not in value (Bhayana Builders, SC 2018, service tax); under GST debated (Sec 15). Material issued **against recovery** is the client's supply to the contractor | — | SC judgment (recalled) | M → CN9 |
| Liquidated damages | Circular 178/10/2022-GST (3 Aug 2022): LD / compensation for breach is not consideration (no GST); cancellation charges follow the principal supply; fact-dependent | LD = a fixed-amount deduction | S EY, Grant Thornton, Bar & Bench on the circular | M–H → CN11 |
| Retention | GST on the full value at invoice (I16); income-tax: retention is part of contract revenue (ICDS III, Sec 43CB) | GST as stated | I16; ICDS III (recalled) | M → CN12 |
| Real-estate rates | From 1 Apr 2019 (N 03/2019-CT(R)): residential apartments in a project — affordable **1%**, other **5%**, both **without ITC**, on total consideration with land **deemed one-third**; commercial apartments in a residential project 5%; old ongoing projects could opt for 8% / 12% with ITC | — | P GST Council real-estate FAQ; S taxguru, taxmann | M–H → CN18 |
| Affordable housing | ≤ ₹45 lakh and carpet ≤ 60 sq m (metropolitan) / 90 sq m (others) | — | Same | M → CN19 |
| 80% procurement | Promoters at 1% / 5%: ≥ 80% of inputs / input services from registered persons (FY-wise, project-wise); shortfall taxed at 18% under RCM (cement from unregistered at its own rate); TDR / FSI, long-term lease, capital goods outside the 80% | — | S taxguru, AIFTP journal | M → CN20 |
| Completion certificate | Sale of a building after the completion certificate / first occupation is neither goods nor services (Sch III para 5(b)): no GST on demands after CC | — | CGST Act (recalled) | H → CN21 |
| Cancellation | Credit note within the Sec 34 time limit; after it, supplier refunds net of tax and the unregistered buyer claims the GST refund (Circular 188/20/2022-GST) | Credit notes exist | P Circular 188/20/2022 | H → CN22 |
| Interest from allottees | Interest / late fee for delayed payment is part of value (Sec 15(2)(d)) → GST at the unit's rate; RERA rules cap it (state rule, typically SBI MCLR + 2%) | Late-payment interest notes exist (R8-A) | CGST Act; state RERA rules (recalled) | H (GST) / M (rate) → CN23 |
| 194-IA and pass-through | Buyer deducts 1% when consideration (or stamp value) ≥ ₹50 lakh; builder takes credit (ITA 2025 Sec 393(1) Table 3(i)). Stamp duty, registration fees, society / corpus deposits collected as **pure agent** (Rule 33) are outside value | 194-IA label exists in `ita2025.ts` | Statute (recalled) | H → CN24 |
| RERA account | Sec 4(2)(l)(D): 70% of amounts realised from allottees into a separate scheduled-bank account, used only for land and construction; withdrawal in proportion to completion, certified by an engineer, an architect and a practising CA; annual audit within 6 months; Sec 13: no more than 10% of cost before a registered agreement for sale | — | S businesstoday, taxguru, MahaRERA Circular 39/2021 | M–H → CN25 |
| Revenue recognition | Contractors: percentage of completion (AS 7 / ICDS III / Ind AS 115); builders: ICAI guidance note / Ind AS 115 | — (cost-centre P&L is ledger-based) | Standards (recalled) | M → CN26 |
| Contract labour | Four Labour Codes in force 21 Nov 2025; OSH Code contract-labour chapter applies at 50 contract workers (was 20 under CLRA); principal employer ultimately liable for wages and PF / ESI of contract workers | Payroll for own staff only | S KPMG, HSF, JSA | M → CN15 |
| Cash wages | Sec 40A(3): cash payment above ₹10,000 per person per day disallowed (ITA 2025 equivalent: verify) | Cash-limit guard exists for expenses | Statute (recalled) | H (rule) → CN16 |
| Materials after 22 Sep 2025 | Cement 28% → 18% (N 9/2025-CT(R)); marble / granite blocks, sand-lime, fly-ash and building bricks 12% → 5%; steel 18% unchanged | User-typed dated HSN master | S CRISIL, housing.com, tallysolutions | M → CN28 |
| Joint ventures / JDA | Unincorporated consortium members invoice their own share; development rights / FSI to a promoter: RCM, time of supply at CC (N 4/2019 as recalled) | — | Recalled | L → CN27 |

### 2.4 Verified against the code (`888d579`)

Verdicts: **Exists** (done, file given), **Partial** (part done, gap named), **Missing**. Each row was checked by grep or
by reading the file; "→" names the Round 11 item that closes it.

#### The printed RA bill and tax invoice (the owner's question)

Read: `src/components/templates/TemplateEngine.tsx`, `parts/{PartyPanel,GstBody,PaperItemsTable,FooterBlocks,
PaymentScheduleBlock,AnnexureBlock}.tsx`, `paper-helpers.ts`; `src/lib/works/{measurements,ra-abstract}.ts`.

| Field on paper | Verdict | Evidence | → |
|---|---|---|---|
| RA bill no. / final | **Missing** on paper | `saveRaBill` writes it into `notes` ("RA bill no. 4 — SO/… · work order …"); no template reads `ra_no` | A3 |
| Name of work, agreement no. / date, work order | **Missing** | `boq_terms.work_order` on the BOQ only; the RA bill prints `po_number` as "Buyer's Ref / PO" when typed | A3 |
| Client division / engineer-in-charge | **Missing** | `AttentionLine` (one "Kind attn." line) is the nearest | A3 |
| Site address / site State | **Partial** | `ship_to` prints as "Ship to"; PoS is whatever was typed; no "Site" label, no Sec 12(3) default | A2, A3 |
| Contract value, stipulated / extended dates | **Missing** | — | A3 |
| Period of work ("from – to"), date of measurement | **Missing** | — | A3 |
| BOQ item no. per line | **Missing** on paper | `InvoiceItem.boq_ref` kept by `normalizeItem`; `trackingText` / both item tables never read it | A3 |
| M-book no. / pages per line | **Missing** | `MeasurementLine.mb_ref` on `ra_measurements` rows only | A3 |
| Line class: BOQ / extra / substituted / deviation | **Partial** | `splitExtras` names lines "Extra item — …"; no substituted / deviation class or approval ref | A4, B1 |
| BOQ qty, previous / this / cumulative qty and amount, % | **Partial** | `ra-abstract.ts` `abstractHtml`: a separate page from Works → RA register; not in the PDF, share link or print copies; computed live, not snapshotted (a later cancellation changes an old bill's "previous" column) | A4 |
| Deductions and recoveries table | **Missing** on paper | `ra_deductions` stored; only IT TDS prints (`FooterBlocks.tsx` "Less: TDS (194C)") | A5 |
| Net payable (figures and words) | **Missing** on paper | `ra_net_payable` stored; `FooterBlocks` prints "Balance due" only after a payment or TDS | A5 |
| GST TDS u/s 51 note, labour cess note | **Missing** | — | A5 |
| Composite supply / works-contract declaration | **Missing** | `SupplyDeclaration` prints BOS / RCM / export declarations only | A2 |
| Contractor's certificate, measured / checked / passed boxes | **Missing** | `AcceptanceBlock` is the quotation acceptance only | A5 |
| Abstract as a following page of the same document | **Missing** | `AnnexureBlock` (R3-B4) is timesheet-shaped; R5-B4 chose a separate HTML page | A4 |
| Builder fields: unit, tower, carpet area, RERA no., stage, land deduction | **Missing** | — | C3 |
| Instalment / stage schedule on a demand | **Partial** | `PaymentScheduleBlock` + 8G `payment_schedule` print date-based instalments; no stage / % / previous-received columns | C3 |
| Thermal / receipt layout | n/a | Construction parts never mount on `receipt` (like the annexure) | — |

**Editor:** no construction field is visible or editable in `src/components/creator/*` (grep for `ra_no`, `boq_ref`,
`ra_deductions`: zero hits). An RA bill opened in the editor keeps them (kept keys) but the user cannot see or fix
them → A3 adds a lazy "Contract & RA" panel.

#### Contractors (civil / EPC / sub-contractors / interiors / MEP)

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| `contractor` business type, works pack, demo | Exists | `shop-presets.ts` (`PRESETS.contractor`, landing `/time?tab=works`), `industry-packs.ts`, `demo/profile-works.ts` | Sub-profiles → A1 |
| Sub-profile pattern, runtime registry | Exists | `applyTradeKind`, `applyRetailKind`; `trade/tr-registry.ts`, `retail/rt-registry.ts` | Reused by A1 |
| BOQ as SO / quotation, CSV / XLSX import | Exists | `works/boq.ts` | Contract particulars → B1 |
| Measured RA bills, cumulative ↔ this-bill, over-BOQ with reason | Exists | `works/measurements.ts`, `progress-billing.ts` (`measured`) | Line classes, deviation limit → A4, B1 |
| RA abstract (screen, CSV, HTML page) | Partial | `works/ra-abstract.ts` | In the document, snapshotted → A4 |
| RA register | Exists | `measurements.ts` `raRegister` | — |
| Deduction set: retention (cap, basis), advance recovery (threshold), 194C, GST TDS, cess, SD, LD, other | Exists | `works/deductions.ts` | New kinds (secured advance, material, water / power, hire, withheld, mob. interest) → B2, B4 |
| Due now / held split, retention alerts | Exists | `works/ra-due.ts`, `works-alerts.ts` | Withheld bucket, release flow → B4, B5 |
| GST TDS / cess receipt journals via a clearing account | Exists | `works/ra-receivable.ts`, `no-cash.ts` (`ra_journal_id`) | Reused for recoveries (no new marker) → B4 |
| Mobilisation advance | Partial | `advances.ts` + `boq_terms.advance_id` | Interest, BG link, 80% rule → B2 |
| Secured advance against materials | **Missing** | — | B2 |
| Price variation / escalation | **Missing** | lease escalation only (`property/escalation.ts`) | B3 |
| Contract register (agreement, dates, EOT, LD cap) | **Missing** | — | B1 |
| Bank guarantees / PBG / EMD | **Missing** | `property/deposits.ts` (R5-C6) holds deposits paid / received (reusable for EMD / SD paid); no guarantee register | B5 |
| Final bill, no-claim certificate, closure | **Partial** | `ra_final`, R2-B2 balance bill | Closure checklist, releases → B5 |
| Works-contract tax classes, PoS = site | **Partial** | `WORKS_CONTRACT_RATE_RULES` default rate on BOQ import only | A2 |
| Supply + installation split (MEP / interiors) | **Partial** | lines carry their own HSN / rate | Preset and caution → A2 |
| e-Invoice / e-Way bill | Exists | `einvoice.ts`, e-way JSON | — |

#### Builders and developers

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Projects as cost centres | Exists | `cost-centres.ts` (kind `project`) | RERA project fields → C1 |
| Unit master (tower, floor, carpet area, type, status) | **Missing** | — | C1 |
| Booking, cost sheet, allotment letter | **Missing** | advances exist (`advances.ts`) | C2 |
| Construction-linked payment plan, stage certificate, demand letters, interest on delay | **Missing** | 8G `payment_schedule` (dates only); R8-A interest notes (`interest_run_id`) | C3 |
| 1% / 5% no-ITC classes, deemed one-third land | **Missing** | — | C3 |
| Completion certificate switch | **Missing** | — | C1, C3 |
| RERA 70% account tracker, withdrawal certificates | **Missing** | bank accounts exist (`banking`) | C4 |
| Cancellation, refund, forfeiture | **Partial** | credit notes, refund vouchers (`advances.ts`) | Flow + Circular 188 path → C5 |
| 80% registered procurement test, RCM shortfall | **Missing** | purchases carry vendor GSTIN | C5 |
| 194-IA credit from buyers | **Partial** | receipt TDS fields; label in `ita2025.ts` | Booking-level threshold hint → C2 |

#### Site operations

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Site godowns, transfers, consumption, theoretical vs actual | Exists | `works/sites.ts`, `SitesPanel.tsx` | Wastage band, client-material recovery, cement / steel statement → D4 |
| Sub-contractor bills with 194C | Partial | purchase bills (`BillModal.tsx`), `tds-payables.ts` | Work orders, measurement, retention, recoveries → D1 |
| Job work (materials sent out) | Exists | `job-work.ts` | Reused for material issued to sub-contractors → D1 |
| Labour contractor bills; PF / ESI proof | **Missing** | — | D2 |
| Daily-wage muster at site | **Missing** | payroll attendance is for employees (owner-only) | D2 |
| Plant & machinery register | Partial | fixed assets (`ledger/assets.ts`, table `fixed_assets`); transport `vehicles` (pack-gated) | Log sheets, hire in / out → D3 |
| Project / site P&L | Partial | cost-centre P&L (ledger-based), `siteCostByCentre` memo | Site P&L with RA, sub-con, labour, plant, WIP → D5 |

**Totals:** 54 rows checked (print audit 19 incl. one n/a, contractors 18, builders 10, site 7): **12 exist**, **14 partial**,
**27 missing** on paper or in the app. Round 11 closes every partial / missing row; §2.2's 21 bill-anatomy rows map onto them.

---

## 3. Ranked list: what to build now

Value 1–5 (5 = every business of that kind meets it on every bill). Effort S = 1, M = 2, L = 3. Score = value ÷ effort.

| Rank | Id | Gap | Who needs it | Value | Effort | Score | Package |
|---|---|---|---|---|---|---|---|
| 1 | CN-A1 | Construction profile (picker, switches, checklist, help, Ctrl+K, sample data) | every contractor | 5 | S | 5.0 | A |
| 2 | CN-A5 | Deductions / recoveries / net payable and certificate block on the bill | every works bill | 5 | S | 5.0 | A |
| 3 | CN-A3 | Contract particulars on the bill, BOQ no. / M-book per line, editor panel | every works bill | 5 | M | 2.5 | A |
| 4 | CN-A4 | Abstract inside the document (snapshotted), cumulative columns, line classes | every RA bill | 5 | M | 2.5 | A |
| 5 | CN-A2 | Works-contract tax classes, PoS = site, composite declaration, MEP split | every contractor | 4 | S | 4.0 | A |
| 6 | CN-B2 | Advances: mobilisation with interest, secured, plant; recovery schedules | govt / EPC | 4 | M | 2.0 | B |
| 7 | CN-B4 | Recoveries, withheld, LD (client materials, water / power, hire) | govt / EPC | 4 | M | 2.0 | B |
| 8 | CN-C3 | Payment plans, stage demands, demand letter, real-estate GST classes | builders | 5 | M | 2.5 | C |
| 9 | CN-C2 | Bookings, cost sheet, allotment letter, receipts | builders | 5 | M | 2.5 | C |
| 10 | CN-C1 | Projects, towers, units, RERA fields, CC switch | builders | 5 | S | 5.0 | C |
| 11 | CN-D1 | Sub-contract work orders and measured sub-contractor bills | main contractors | 5 | M | 2.5 | D |
| 12 | CN-B1 | Contract register: agreement, dates, EOT, LD cap, deviation limit | govt / EPC | 4 | S | 4.0 | B |
| 13 | CN-B3 | Price variation / escalation (formula, indices, supplementary bill) | govt / EPC | 4 | M | 2.0 | B |
| 14 | CN-B5 | Guarantees (PBG / BG / EMD / SD), final bill and closure, releases | govt / EPC | 4 | M | 2.0 | B |
| 15 | CN-D2 | Labour contractors (compliance proof, withholding) and site muster | all sites | 4 | M | 2.0 | D |
| 16 | CN-D4 | Material reconciliation (cement / steel), wastage band, client-material recovery | govt / EPC | 4 | S | 4.0 | D |
| 17 | CN-D5 | Site P&L, unbilled work (WIP), cost to complete | all | 4 | M | 2.0 | D |
| 18 | CN-C4 | RERA designated account (70%), withdrawal certificates, QPR data | builders | 4 | M | 2.0 | C |
| 19 | CN-C5 | Cancellations / refunds / forfeiture; 80% procurement test | builders | 3 | M | 1.5 | C |
| 20 | CN-D3 | Plant & equipment: log sheets, hire in / out, fuel | civil / road | 3 | M | 1.5 | D |
| — | — | Gantt / scheduling, BIM, drone progress | EPC | 3 | L | 1.0 | no (outside billing) |
| — | — | Real-estate CRM (leads, brokers portals) | builders | 3 | L | 1.0 | no (CRM) |
| — | — | e-MB / tender portal / RERA portal integration | govt | 3 | L | 1.0 | no (network) |

All 20 are taken: the four lowest still close a statutory or audit risk (RERA, 80% RCM, hire TDS) cheaply.

---

## 4. Specifications (20 items)

Conventions for every item:
- **Logic and tests.** Pure logic in `src/lib/construction/cn-*.ts` (new folder), tested with `node:test` in
  `tests/cn-*.test.ts`. UI checks are `step(...)` blocks in `tests/e2e/smoke.mjs` (§7). Existing `src/lib/works/*` files
  are edited only where §6 says.
- **Components** in the new folder `src/components/construction/`. Works-tab views are lazy components mounted by
  `WorksTab.tsx` (one lazy import per view group); the builder desk is `RealtyDesk.tsx` (one lazy chunk). Template
  parts live in `src/components/templates/parts/` (`WorksHeaderBlock.tsx`, `WorksDeductionsBlock.tsx`,
  `WorksAbstractPage.tsx`, `DemandBlock.tsx`), each lazy.
- **Strings.** Each package has its own i18n area (`defineArea(en, hi)`): `src/i18n/areas/construction-r11a.ts` …
  `r11d.ts`. Hindi uses the trade's words (रनिंग बिल, माप पुस्तिका / एम-बुक, सार, कटौती, वसूली, जमानत राशि,
  प्रतिधारण / रिटेंशन, मूल्य परिवर्तन, अग्रिम, बैंक गारंटी, ठेकेदार, उप-ठेकेदार, मस्टर रोल, हाज़िरी, मशीनरी, फ्लैट,
  बुकिंग, माँग पत्र, रेरा खाता, पूर्णता प्रमाणपत्र).
- **Storage.** New company tables `mrchartist_inv_<table>` go through `getTable` / `setTable`. Each is registered in:
  - `backup.ts` (`RECORD_TABLES` / `ID_TABLES`);
  - the open-export schema (`trust/open-export-schema.ts`);
  - `sync-engine.ts` `DATED` / `NUMBERED`, when dated or numbered;
  - **`src/lib/construction/cn-registry.ts`** (`CN_TABLE_ACTIONS`, `CN_WATCHED`), registered at runtime, never in
    first-paint `access.ts` / `audit-edits.ts`. Every writer module and the two all-table lazy writers
    (`sync-engine.ts`, `trust/recycle-bin.ts`) import it for its side effect (`tests/cn-registry.test.ts`).

  Each table gets one row in `docs/ARCHITECTURE.md` (lead). Additive record fields come by declaration merging in
  `src/types/construction-r11.ts`: one file, one `declare module` block per package.
- **Invoice snapshots.** Everything Round 11 stores on an invoice lives under **`boq_terms.cn`** (one object; each
  package owns its sub-fields, §6) and in **`ra_deductions`** (new kinds). Templates read them from the record only.
  `boq_terms` on a BOQ (sales order) keeps its R5 meaning; on an RA bill, demand or works invoice it holds the snapshot.
  Code that reads a **BOQ's** terms keeps reading them from `boq_id`'s record, never from the bill.
- **Numbers.** New series go through `series-counters.ts` (`nextSeriesNumberFor` + `recordSeries`) as
  `XXX/FY<yy-yy>/<seq>`, never reused after a delete: `SWO` (sub-contract work orders), `SCB` (sub-contractor
  measurements), `BKG` (bookings), `DMD` (demand letters — the demand invoice keeps the invoice series), `MUS` (muster
  weeks), `PLG` (plant log sheets), `PVB` (price-variation statements). None of these prefixes is in use today (A
  checks with a grep and a test).
- **Guards.** Destructive calls use `requireAccess`. Writes in a locked period use `assertUnlocked`. Money goes through
  `round2`. Every delete goes through `setTable` on a watched table, so the recycle bin gets the row.
- **Packs.** A Works view is listed only when its `construction_settings` switch is on (its URL still opens it). The
  `realty` tab is listed only with the `realty` pack on. Tables are not read while their pack / switch is off
  (`tests/cn-pack-gate.test.ts`, like `tests/transport-works-pack-gate.test.ts`).
- **Help.** Every new tab / view gets a topic (`tests/help-registry.test.ts` fails otherwise) and a Ctrl+K title in
  `src/i18n/areas/discover-r6-tabs.ts`. Statutory topics cite the CN ids. The CA-id regexes in
  `tests/help-registry.test.ts`, `tests/help-glossary.test.ts` and `tests/docs-links.test.ts` (the `cited` regex) gain
  `CN` (owner A).
- **Cash readers.** **No new receipt marker.** Recoveries settled by the client's deduction (materials, water / power,
  hire, interest, withheld release) reuse the R5-B5 path: a receipt into the "RA deductions clearing" account
  (`clearing: true`) with `ra_kind` + `ra_journal_id` (already a `movedNoCash` marker). Booking amounts are ordinary
  advances (`advance_id`). `tests/no-cash-readers.test.ts` is unchanged; `movedNoCash` is not edited.
- **Purchases contract.** Every new module that reads `purchases` (D1, D2, D3, D5, C5) is added to
  `tests/purchase-contract.test.ts` and reads bills through `readPurchase`.

### CN-A — Construction profile and the construction bill

#### CN-A1 Construction profile (construction picker)

**User story.** When I choose "Contractor" in setup, I pick *Civil / EPC contractor* and "I work for government
departments". The app lands me on Works → Contracts, turns on GST TDS for my clients, labour cess, the secured-advance
and escalation views, the PWD-style RA bill paper and the M-book column, and the checklist asks for my first contract.

**Acceptance criteria.**
1. `PackId` gains `realty` (appended to `PACK_IDS`). `PACK_OF_TYPE` and `PACK_ROUTES` are unchanged.
2. Settings field `construction_kind?: 'civil' | 'subcontractor' | 'builder' | 'interiors' | 'mep' | 'labour' |
   'other'` (additive) and object `construction_settings` (`settings.manage`, audited, synced as a singleton).
   `applyConstructionKind(kind, { government, registered })` (`shop-presets.ts`, R9 pattern) returns modules, packs,
   defaults and switches (`registered` adds `gst`; `government` turns on the government switches):

   | kind | modules | industry_packs | landing | due days | template | switches turned on |
   |---|---|---|---|---|---|---|
   | civil | `PRESETS.contractor` | `works` | `/time?tab=works&view=contracts` | 30 | `gst_tax_invoice` | RA paper `pwd`; M-book column; escalation; secured advance; guarantees; sub-contract; plant; muster; reconciliation (`government`: GST TDS deductor default on new clients, cess deducted, measured-by boxes) |
   | subcontractor | `PRESETS.contractor` | `works` | `/time?tab=works&view=ra` | 30 | `gst_tax_invoice` | RA paper `standard`; back-to-back BOQ import; retention; muster |
   | builder | `PRESETS.contractor` + `recurring` | `realty`, `works` | `/receivables?tab=realty` | 15 | `corporate_navy` | units, bookings, demands, RERA account, 80% test; works views sub-contract, muster, reconciliation, site P&L |
   | interiors | `PRESETS.contractor` − `payroll` | `works` | `/time?tab=works&view=boq` | 15 | `corporate_navy` | RA paper `standard`; supply / installation split caution; photo pages on |
   | mep | `PRESETS.contractor` | `works` | `/time?tab=works&view=boq` | 30 | `gst_tax_invoice` | RA paper `standard`; supply / installation split; sub-contract; guarantees |
   | labour | `purchases`, `accounts`, `banking`, `reports`, `gst`, `tds`, `payroll`, `time` | `works` | `/time?tab=works&view=labour` | 15 | `gst_tax_invoice` | manpower-supply bill preset (SAC 998519, 18%); muster; compliance-proof pack |
   | other | `PRESETS.contractor` (unchanged) | absent (`works` implied) | `/time?tab=works` | 30 | `corporate_navy` | — (today's behaviour) |

3. Wizard: the `contractor` card opens a second choice with seven cards (lazy, inside the wizard chunk), plus "Do you
   work for government departments / PSUs?" for civil, sub-contractor and MEP. Settings → Features shows
   "Construction profile" with the same seven plus "Custom" (switches kept as set). Changing the profile never deletes
   data; switches turned off only hide views.
4. Existing `contractor` companies (no `construction_kind`) are unchanged. The setup checklist (R6-A1) shows a step
   `constructionProfile` "Pick your kind of construction business" until it is chosen or skipped.
5. Checklist steps per kind (`checklist-steps.ts`, append-only): civil / mep → `contract` (first contract), `boq`;
   subcontractor → `boq`; builder → `realtyProject`, `units`, `paymentPlan`; interiors → `boq`; labour →
   `labourContract`.
6. Works views (`WorksTab.tsx` `VIEWS`, appended): `contracts`, `advances`, `escalation`, `guarantees`, `subcon`,
   `labour`, `plant`, `reco`, `pnl` — each listed when its switch is on; `PACK_TABS` rows in block `// R11` (pack
   `works`). Builder tab: `RECEIVABLES_TABS` gains `{ id: 'realty', pack: 'realty' }` with views `projects`, `units`,
   `bookings`, `plans`, `demands`, `rera`, `cancellations`, `procurement`. If a view's package has not merged yet, A
   commits a one-line stub (`R11Stub.tsx`) that the package replaces.
7. Features catalogue (`features-catalog.ts`): one row for the `realty` pack and one "Construction profile" row with
   `PACK_HREF`.
8. **Sample data** (R6-B4): `src/lib/demo/profile-works.ts` keeps its rows and gains one block per kind, only in the
   Demo company: civil — a PWD road contract with agreement, mobilisation advance with interest, two RA bills with
   M-book refs, a secured advance, an escalation statement, a PBG; builder — one project with a tower of 12 units, two
   bookings, a CLP plan with two certified stages and demands, a RERA account; sub-contractor / MEP — a back-to-back
   BOQ and one RA bill; labour — a labour-supply bill with a compliance pack. Each package adds its own block (§6).

**Files.** New: `src/lib/construction/cn-profile.ts`, `cn-registry.ts`, `cn-settings.ts`, `src/lib/construction-rules.ts`
(scaffold with one section per package), `src/types/construction-r11.ts` (scaffold),
`src/components/construction/{ConstructionKindPicker,R11Stub}.tsx`. Edit: `industry-packs.ts`, `shop-presets.ts`,
`features-catalog.ts`, `checklist-steps.ts`, `SetupWizard.tsx`, `FeaturesPanel.tsx`, `page-tabs.ts`
(`RECEIVABLES_TABS`), `WorksTab.tsx` (`VIEWS` + lazy mounts), `Receivables.tsx` (one lazy tab mount),
`demo/profile-works.ts`.

**Storage.** Settings fields `construction_kind`, `construction_settings` (object). No table.

**Tests.** `tests/cn-profile.test.ts`: each kind's modules / packs / landing / switches; `registered` adds `gst`;
`government` switches; every kind keeps `time` (so `PACK_ROUTES` needs no change); an existing contractor company is
unchanged; `other` = today's preset; checklist steps by kind; view visibility by switch. `tests/industry-packs.test.ts`
extended: `realty` id, `PACK_OF_TYPE` / `PACK_ROUTES` unchanged.

#### CN-A2 Works-contract tax classes, place of supply = site, declarations

*Seen in:* every contractor's GST advice; Sec 2(119), 12(3); 22 Sep 2025 rate change.

**User story.** As a road contractor billing a State PWD in another State, the BOQ import picks the right works-contract
class, the RA bill's place of supply is the site's State, the paper says "Composite supply of works contract (Sec
2(119))", and the app warns me that I am not registered in the site State.

**Acceptance criteria.**
1. Item class `cn_class` (additive on catalog items and BOQ lines' snapshot `boq_terms.cn.lines[id].cls`):
   `wc_general` (18%), `wc_govt` (Government civil / road / rail / irrigation works — rate by date from
   `WORKS_CONTRACT_RATE_RULES.government`), `wc_govt_earthwork`, `wc_subcon_govt`, `pure_labour_exempt` (single
   residential unit / PMAY), `supply_goods` (supply part of a supply-and-install contract at its HSN rate),
   `install_service` (installation of movable goods, 18%), `realty_*` (CN-C3), `manpower` (998519, 18%). The class
   **suggests** a rate and SAC by document date; a typed rate always wins (`gst-guards` shows "rate differs from the
   class" as a soft notice).
2. `construction-rules.ts` `WORKS_CLASS_RULES` (date-keyed, one row per class change, `source` + `verified: false` on
   every row whose source conflicts). **Default for the conflicting 22 Sep 2025 change (CN1):** `wc_govt`,
   `wc_govt_earthwork` and `wc_subcon_govt` → 18% from 2025-09-22, matching the existing `WORKS_CONTRACT_RATE_RULES`
   row; the help topic and the class picker show "sources conflict — verify with your CA (CN1)".
3. **Place of supply = site.** A BOQ / contract carries `site: { address, state_code }` (B1). An RA bill or works
   invoice built from it sets `place_of_supply` to the site State and prints "Site" instead of "Ship to". If the site
   State differs from every sender profile's GSTIN State, a one-time notice: "Services for immovable property are
   supplied where the property is (Sec 12(3)); you may need registration in <State> — verify (CN4)". IGST / CGST+SGST
   follows the existing PoS logic.
4. **Declarations** (lazy, via `SupplyDeclaration`): works-contract documents print "Composite supply of works
   contract as defined in Sec 2(119) of the CGST Act"; a supply-and-install bill with `supply_goods` lines prints
   "Supply of goods with installation" instead; `pure_labour_exempt` lines print "Exempt — pure labour (verify, CN2)".
5. **MEP / interiors split.** When one invoice mixes `supply_goods` and `install_service` lines, the editor shows a
   caution: "If the installation makes the goods part of the building, the whole contract is a works contract at the
   works rate — check (CN3)", with a one-click "Treat as works contract" that re-classes the lines.
6. Purchase bills of a `builder` with the `realty` pack and 1% / 5% classes get the existing `bill-guard` soft caution
   "ITC not available on this project (N 03/2019) — check" when ITC is claimed.

**Files.** New: `src/lib/construction/cn-tax.ts`. Edit (one lazy line each, §6): `gst-guards.ts`, `bill-guard.ts`,
`paper-helpers.ts` (declaration text helper `worksDeclaration`), `works/boq.ts` (`importBoq` reads the class
suggestion — one branch).

**Tests.** `tests/cn-tax.test.ts`: class → rate by date (before / after 22 Sep 2025); typed rate wins; PoS from site;
the other-State notice; declarations by line mix; re-class to works contract.

#### CN-A3 Contract particulars on the bill, BOQ no. and M-book per line, editor panel

**User story.** As a contractor, the RA bill PDF I share on WhatsApp shows the name of work, agreement no. and date,
site, RA bill no. 4 for work done 1–31 Oct 2026, measured on 2 Nov, and each line shows its BOQ item no. and "MB 112,
pp. 45–47" — exactly what the division's accountant checks.

**Acceptance criteria.**
1. **Snapshot** `boq_terms.cn.header` on every RA bill (written by `saveRaBill` through one call to
   `cnHeaderSnapshot(boq, contract, req)`, §6) and on any invoice the user marks "works-contract bill":
   `name_of_work`, `agreement_no`, `agreement_date`, `work_order_no` / `date`, `tender_ref?`, `client_office?`
   (division / circle), `engineer?`, `site` (`address`, `state_code`), `contract_value`, `stipulated_start`,
   `stipulated_completion`, `extended_completion?`, `ra_label` ("4th RA bill" / "Final bill"), `period_from`,
   `period_to`, `measured_on`, `mb_nos[]`. Values come from the contract (B1) or, without one, from the BOQ's
   `boq_terms` and typed fields.
2. **Line snapshot** `boq_terms.cn.lines[lineId]`: `ref` (BOQ item no., copied from `boq_ref`), `mb` ("112/45–47"),
   `cls` (A2), `kind` (`boq` | `extra` | `substituted` | `deviation`, A4), `approval?` (extra / substituted item
   approval ref), `boq_qty`, `prev_qty`, `cum_qty`, `prev_amount`, `cum_amount`. `saveRaBill` writes them from the
   measurement (it already has every number); `MeasurementForm` gains an MB field per line (exists: `mb_ref`) that now
   reaches the bill.
3. **Paper — header block** (`WorksHeaderBlock.tsx`, lazy; mounted by `TemplateEngine` after `PartyPanel`, and before
   `GstBody` on the `gst` layout; never on `receipt`): a two-column ruled box "Contract particulars": Name of work;
   Agreement / WO no. and date; Client office / engineer; Site (address, State); Contract value; Stipulated / extended
   completion; Bill: "4th RA bill (running)" or "Final bill"; Work done from – to; Measured on; M-book nos. Empty fields
   are skipped. Accent variable only.
4. **Paper — line sub-line**: `trackingText` gains one helper call `worksLineText(item, cn)` → "Item 2.1.3 · MB 112/45–47
   · Extra item (approval EE/123)" printed under the line name in **both** item tables (`PaperItemsTable`, `GstBody`),
   so every layout shows it without a table edit. Without `boq_terms.cn` it returns '' (old documents unchanged).
5. **Document title**: an RA bill prints "Tax Invoice — Running Account Bill No. 4" (final: "Tax Invoice — Final
   Bill"); the document label table is not changed — `PaperHeader` / `GstBody` read a lazy title helper only when
   `ra_no` is present (one line each, §6).
6. **Editor panel** (lazy `ContractPanel.tsx` in the editor's "More details" area, mounted only when the works pack
   is on or the document has `boq_terms.cn` / `ra_no`): shows and edits the header snapshot, per-line BOQ no. / MB /
   class, and a "Refresh from contract" button (re-snapshots, audited). Issued documents edit through the existing
   revision path (period lock, audit).
7. Print copies (`print-copies.ts`), the share link and PDF export carry the same paper (they render
   `TemplateEngine`).

**Files.** New: `src/lib/construction/cn-snapshot.ts`, `src/components/templates/parts/WorksHeaderBlock.tsx`,
`src/components/creator/ContractPanel.tsx` (lazy). Edit: `TemplateEngine.tsx` (lazy mounts, §6), `paper-helpers.ts`
(`worksLineText`), `works/measurements.ts` (one call in `saveRaBill`), `MeasurementForm.tsx` (MB reaches the bill),
the editor's details host (one lazy line).

**Tests.** `tests/cn-snapshot.test.ts`: header from contract / BOQ / typed; line snapshot numbers equal the abstract's;
old documents print unchanged (`worksLineText` ''); snapshot survives `normalizeRecord` (load → edit → save round trip).

#### CN-A4 Abstract inside the document, cumulative columns, line classes

**User story.** As a PWD contractor, my RA bill PDF has the abstract of cost as page 2 — item no., description, unit,
BOQ qty, rate, up to previous / this bill / up to date quantity and amount, % — with extra and substituted items in their
own section, and it never changes even if a later bill is cancelled.

**Acceptance criteria.**
1. **Snapshot, not live.** The abstract is printed from `boq_terms.cn.lines` (A3), so it is the bill as certified.
   `ra-abstract.ts` `abstractRows` stays the calculator (screen, CSV and the snapshot writer); a "Recompute" action on
   the RA register re-snapshots a **draft** RA bill only.
2. **Abstract page** (`WorksAbstractPage.tsx`, lazy, the R3-B4 annexure page pattern: following page, "Abstract of
   cost — RA bill no. 4 to <invoice no.>"): sections **A. BOQ items**, **B. Extra items**, **C. Substituted items**,
   **D. Deviation quantities** (qty beyond the deviation limit, B1), each with sub-totals; then the gross this bill,
   GST and the deductions table (A5). Columns: item no., description, unit, BOQ qty, rate, previous qty / amount, this
   qty / amount, up-to-date qty / amount, % of BOQ, MB ref. Never on `receipt` paper.
3. **Cumulative line table option** (`construction_settings.ra_paper`): `standard` (default — ordinary item table +
   abstract page), `pwd` (the item table itself is replaced by the cumulative table `RaItemsTable.tsx`, lazy, on non-gst
   layouts; on the `gst` layout the abstract page carries the cumulative columns and the grid keeps its columns),
   `summary` (no abstract page; the line sub-line only).
4. **Line classes.** `MeasurementForm` lets a measured line be marked `extra` (new item, approval ref, own rate) or
   `substituted` (replaces BOQ item X, approval ref); quantity beyond BOQ qty × (1 + deviation limit %) becomes a
   `deviation` part with its own line (rate as typed, default the BOQ rate, note "rate per clause of agreement"). The
   existing "Extra item —" path keeps working (its lines get `kind: 'extra'`).
5. The standalone `abstractHtml` page stays (Works → RA register) and gains the MB column.

**Files.** New: `src/components/templates/parts/{WorksAbstractPage,RaItemsTable}.tsx`, `src/lib/construction/cn-abstract.ts`
(sections, deviation split). Edit: `works/ra-abstract.ts` (MB column; one export used by the snapshot), `works/measurements.ts`
(`splitExtras` → classes, one branch), `MeasurementForm.tsx`, `TemplateEngine.tsx` (lazy mount, §6).

**Tests.** `tests/cn-abstract.test.ts`: sections and sub-totals equal the bill's taxable value; deviation split at the
limit; substituted item replaces its BOQ line in "previous" maths; snapshot unchanged after a later bill is cancelled;
`pwd` paper column sums.

#### CN-A5 Deductions, recoveries, net payable and the certificate block

**User story.** As a contractor, under the totals my bill shows: Gross ₹10,00,000 + GST ₹1,80,000 = ₹11,80,000; less
retention 5%, mobilisation advance recovery 10% + interest, secured advance recovery, cement issued by department,
water and electricity, IT TDS 2% (Sec 393(1) …), GST TDS 2% (Sec 51), labour cess 1%, withheld ₹50,000 = **Net payable
₹8,76,400 (Rupees eight lakh …)**; then the contractor's certificate and boxes for "Measured by / Checked by / Passed for
payment".

**Acceptance criteria.**
1. **Deductions block** (`WorksDeductionsBlock.tsx`, lazy, after `TotalsBlock`; on the `gst` layout after `GstBody`):
   rows from `ra_deductions` grouped **Statutory** (IT TDS, GST TDS, labour cess), **Recoveries** (advances, materials,
   water / power, hire, interest), **Held** (retention, security deposit, withheld), **Other** (LD, other); each with
   label, base, rate and amount; then **Net payable** (figures and words, `amountInWords`, Hindi on bilingual). The IT
   TDS row is printed here (and the `FooterBlocks` "Less: TDS" row is skipped for documents with `ra_deductions`, one
   guarded line, §6) so it is never printed twice.
2. **Notes**: "GST is charged on the full bill value; deductions do not reduce it." · "GST TDS u/s 51 (₹x) to be
   deducted by the recipient — credit after GSTR-7." · "Labour cess deducted at source (₹x)." Printed via
   `SupplyDeclaration`, only when the row exists.
3. **Certificate block** (`construction_settings.certificates`, defaults by kind): contractor's certificate (editable
   text; default "Certified that the work has been executed as per specifications and the quantities are as measured
   and recorded in the measurement book; no previous claim has been made for this work."), sender signature (existing
   signature image), and for `government` switch on, three empty boxes "Measured by", "Checked by", "Passed for payment
   of ₹ ______" with name / designation / date lines. Accent variable only; `keepTogether` on page breaks.
4. Every amount comes from the snapshot (`ra_deductions`, `ra_net_payable`), never recomputed at print.
5. The RA register, receivables (`raDueSplit`) and the payment dialog (`RaReceiptPanel`) understand the new kinds of
   B2 / B4 (buckets in §6).

**Files.** New: `src/components/templates/parts/WorksDeductionsBlock.tsx`, `src/lib/construction/cn-print.ts` (grouping,
words, notes). Edit: `TemplateEngine.tsx` (lazy mount), `FooterBlocks.tsx` (one guarded line).

**Tests.** `tests/cn-print.test.ts`: grouping of every kind; net payable = total − Σ deductions = `ra_net_payable`; IT
TDS printed once; notes only when rows exist; certificate defaults by kind; old invoices without `ra_deductions` render
byte-identical (snapshot test of the paper's HTML for a fixture invoice).

### CN-B — Contractor finance

#### CN-B1 Contract register

**User story.** As a civil contractor with eight running contracts, I keep each agreement — client, name of work,
agreement no., value, dates, EOT granted, LD clause, deviation limit, retention, DLP, advances, guarantees — in one
place, and the BOQ, RA bills and the bill header read from it.

**Acceptance criteria.**
1. Table `works_contracts`: `{ id, boq_id, client_id, name_of_work, agreement_no, agreement_date, work_order_no?,
   work_order_date?, tender_ref?, client_office?, engineer?, site {address, state_code}, contract_value,
   stipulated_start, stipulated_completion, eots: [{ upto, ref, date, with_ld: boolean }], ld: { pct_per_week?,
   cap_pct? }, deviation_limit_pct (default 25, "contract term"), dlp_months?, government: boolean, jv?: { name,
   share_pct, lead: boolean }, status: 'running' | 'completed' | 'closed', completed_on?, cost_centre_id?, notes? }`.
   One contract per BOQ (the BOQ's `boq_terms` keeps working; the contract's values win when both exist).
2. Works → Contracts: list (value, billed to date, % billed, received, retention held, guarantees expiring, days to
   completion / delay), form, and "Create BOQ" / "Import BOQ" from the contract.
3. Delay meter: days beyond the latest completion date; LD exposure = contract value × `pct_per_week` × weeks, capped —
   informational only (no automatic deduction; B4 records the LD the client actually deducts).
4. JV: when `jv` is set, the bill header prints "Consortium: <name> (our share x%)" — informational (CN27).

**Files.** New: `src/lib/construction/cn-contracts.ts`, `src/components/construction/ContractsView.tsx`. Edit:
`BoqPanel.tsx` (a "Contract" link only; the contract's values reach bills through A3's snapshot helper).

**Tests.** `tests/cn-contracts.test.ts`: create / edit / close; header snapshot from contract; delay and LD exposure;
EOT ordering; one contract per BOQ.

#### CN-B2 Advances: mobilisation (with interest), secured advance, plant advance

**User story.** As a contractor, I record the 10% mobilisation advance against my BG, see interest at 10% simple on the
unrecovered balance, and each RA bill recovers it from 10% to 80% of work; I also get a secured advance of 75% on 500
bags of cement at site, recovered as the cement is used.

**Acceptance criteria.**
1. **Mobilisation / plant advance** stays an `advances.ts` advance receipt (GST per G3 / I17). Contract terms gain
   `advance_terms: [{ advance_id, kind: 'mobilisation' | 'plant', interest_pct?, interest_basis: 'simple', recover_from_pct
   (default 10), recover_by_pct (default 80), bg_id? }]`. Recovery per bill = the existing rule (`advance_recovery`)
   with the start threshold, **plus** a schedule check: the app proposes the amount that recovers the balance by
   `recover_by_pct` (whichever is higher). **Interest** = simple interest on the outstanding balance per day between
   bills, as a separate deduction kind `advance_interest` (no GST; CN8).
2. **Secured advance** (`secured_advances` table): `{ id, contract_id, date, materials: [{ item_id?, description, qty,
   unit, rate, value }], pct (default 75, "contract term"), amount, recovered: [{ bill_id, amount }], status }`. Receipt
   = a bank receipt booked to a liability "Secured advance from clients" (journal; **not** an advance for supply —
   default per CN7). Recovery = deduction kind `secured_advance_recovery`, proposed from the material consumed in the
   bill's measurement (D4 coefficients) or typed; the recovery journal moves it from the liability against the bill
   (clearing-account path, §4 conventions).
3. Works → Advances: per contract, each advance with amount, recovered, balance, interest to date, % of work done,
   "recovery behind schedule" flag; bell: secured advance older than 90 days (CPWD practice, default) and mobilisation
   advance not fully recovered at 80% of work.

**Files.** New: `src/lib/construction/{cn-advances,cn-secured}.ts`, `src/components/construction/AdvancesView.tsx`.
Edit: `works/deductions.ts` (two new kinds in `computeDeductions`), `works/boq.ts` (`DEDUCTION_KINDS`).

**Tests.** `tests/cn-advances.test.ts`: interest between bill dates; recovery threshold and catch-up by 80%; stops at
balance; secured advance 75% of value, recovery by consumption; journals balance; GST untouched.

#### CN-B3 Price variation / escalation

**User story.** As a contractor on a CPWD-type contract, I enter the base indices (month of tender) and this quarter's
indices for cement, steel, labour, POL and other materials with their component shares; the app computes the price
variation on the work done in the quarter and bills it as a supplementary line (or credits it if negative), and prints
the working sheet.

**Acceptance criteria.**
1. Contract field `escalation: { formula: 'cpwd_10cc' | 'custom', base_month, components: [{ key: 'cement' | 'steel' |
   'labour' | 'pol' | 'materials' | 'bitumen' | string, share_pct, base_index }], m_factor (default 0.85: profit and
   overheads 15%), exclusions: ['secured_advance', 'extra_items', 'escalation_free_items'] }`.
2. Table `price_variations` (`PVB/FY…`): `{ id, number, contract_id, period_from, period_to, work_value (Σ this-bill
   taxable of RA bills in the period, less excluded parts), indices: [{ key, current_index }], amount, invoice_id?,
   status }`. Formula (default, "verify — contract clause governs"): PV = M × W × Σ (share_i/100 × (I_i − I0_i) / I0_i),
   rounded to the rupee; components with shares not summing to 100 are refused.
3. Positive PV → a works invoice (or a line on the next RA bill, user's choice) "Price variation under clause <x> for
   <period>" at the contract's works class rate; negative PV → a credit note linked to the period's last RA bill
   (`doc_links`), Sec 34 time-limit warning (CN6). The working sheet prints as a following page (abstract-page pattern)
   from the snapshot `boq_terms.cn.pv`.
4. Indices are typed (no network); a CSV import of a user-kept index sheet is offered (`scoreHeader` mapping).

**Files.** New: `src/lib/construction/cn-escalation.ts`, `src/components/construction/EscalationView.tsx`,
`src/components/templates/parts/PvWorkingPage.tsx` (lazy).

**Tests.** `tests/cn-escalation.test.ts`: formula against a hand example; exclusions; negative PV → credit note; shares
≠ 100 refused; snapshot print sums.

#### CN-B4 Recoveries, withheld amounts and liquidated damages

**User story.** As a contractor, the department deducts cement it issued (at the issue rate), water and electricity
at 1% + 1%, hire of its road roller, ₹50,000 withheld till the drainage outfall is done, and LD of ₹30,000 for delay; I
record each on the bill, my receivable shows only what is due, and my books show the costs and the held amount.

**Acceptance criteria.**
1. `RaDeductionKind` (types union, one line, §6) gains `advance_interest`, `secured_advance_recovery`,
   `material_recovery`, `water_electricity`, `hire_recovery`, `withheld`. `DeductionRule` defaults per contract:
   water / electricity as % (default 1% + 1%, "contract term"), others typed per bill. `computeDeductions` handles them;
   `cleanRules` accepts them.
2. **Material recovery** carries `{ item_id?, qty, rate }`; on posting it books the material into stock at the site
   godown (a purchase-like inward through the existing stock journal path, value = recovery) when "material issued
   against recovery" (CN9); "free issue" materials are recorded in D4's reconciliation only and never valued in the bill.
3. **Booking at receipt** (the R5-B5 path, no new marker): `RaReceiptPanel` offers each recovery row → receipt into
   "RA deductions clearing" + journal Dr <cost account> | Cr clearing: material → "Material issued by client" (purchase
   / stock), water / electricity → "Water & electricity — site", hire → "Plant hire charges", interest → "Interest on
   mobilisation advance", LD → "Liquidated damages" (expense; no GST, CN11). Accounts are created on first use by name.
4. **Withheld**: a held bucket in `raDueSplit` (§6), with a reason and an expected release date; "Release withheld"
   records the later receipt with `ra_kind: 'withheld'` (ordinary cash receipt). Bell: withheld older than 90 days.
5. LD stays a deduction (existing kind `ld`) with a delay reference to B1's EOT log; an LD later **waived / refunded**
   is a receipt with `ra_kind: 'ld'`.

**Files.** New: `src/lib/construction/cn-recoveries.ts`. Edit: `types/transport-works-r5.ts` (union line),
`works/deductions.ts`, `works/boq.ts` (`DEDUCTION_KINDS`), `works/ra-due.ts` (buckets), `works/ra-receivable.ts`
(journal accounts per kind), `RaReceiptPanel.tsx`.

**Tests.** `tests/cn-recoveries.test.ts`: each kind's computation and bucket; receipt journals balance and clearing nets
to zero; `movedNoCash` true for every recovery receipt; withheld release is cash; existing works tests unchanged.

#### CN-B5 Guarantees and deposits, final bill and closure

**User story.** As a contractor, I see every bank guarantee (performance, mobilisation, retention-release) with its
expiry, margin FD and commission; EMD and security deposits with the client; and when the work is complete I make the
final bill, collect the completion and no-claim certificates, and get retention, SD and BGs released after the DLP.

**Acceptance criteria.**
1. Table `bank_guarantees`: `{ id, contract_id?, kind: 'performance' | 'mobilisation' | 'secured' | 'retention_release'
   | 'emd' | 'other', bank, bg_no, amount, issued_on, expires_on, claim_until?, margin: { fd_ref?, amount? },
   commission_pct?, status: 'live' | 'extended' | 'released' | 'invoked', history[] }`. Commission charged by the bank =
   an ordinary bank-charges expense (18% GST, ITC — CN13); the margin FD is a bank deposit asset (journal).
2. EMD / SD paid to the client reuse R5-C6 `security_deposits` (`direction: 'paid'`, `party_id` = client) with an
   additive `contract_id`; "Adjust EMD into SD" and "Refund" are its existing movements.
3. Works → Guarantees: list with expiry (red ≤ 30 days), linked contract, "Extend", "Release", "Invoked"; bell gate for
   expiry ≤ 30 days.
4. **Final bill & closure** (Works → Contracts → "Close contract"): checklist — final RA bill made (`ra_final`),
   completion certificate date, DLP end (from B1 / `boq_terms`), retention due date, SD due, BGs to release, PV final
   statement, no-claim certificate (typed date / ref), material reconciliation done (D4). Each item links to its screen;
   the contract moves to `closed` when all are ticked or waived (reason, audited).

**Files.** New: `src/lib/construction/{cn-guarantees,cn-closure}.ts`, `src/components/construction/GuaranteesView.tsx`.
Edit: `property/deposits.ts` (additive `contract_id` only, through `types/construction-r11.ts`).

**Tests.** `tests/cn-guarantees.test.ts`: expiry alerts, extend history, invoked BG; EMD → SD; closure checklist states.

### CN-C — Builders and developers (pack `realty`)

#### CN-C1 Projects, towers and units (RERA fields, completion certificate)

**User story.** As a builder, I set up "Green Heights, Phase 1", RERA no. P52100012345, tower A with 48 flats — carpet
area, floor, type, base rate — and mark which are booked, and later record the completion certificate.

**Acceptance criteria.**
1. Table `realty_projects`: `{ id, name, cost_centre_id, rera_no?, rera_valid_till?, rera_account_id? (bank account),
   collection_account_id?, address, state_code, city_class: 'metro' | 'other', gst_scheme: 'n03_2019' | 'old_option',
   started_on?, cc_date?, oc_date?, towers: [{ id, name, floors }] }`.
2. Table `realty_units`: `{ id, project_id, tower_id, unit_no, floor, type ('residential' | 'commercial' | 'parking' |
   'plot'), carpet_sqm, saleable_sqft?, base_rate, plc?: [{ label, amount }], status: 'available' | 'hold' | 'booked' |
   'registered' | 'cancelled', booking_id? }`. Bulk add by tower (floors × units per floor).
3. **Unit class** derived at booking (C3): `affordable` when carpet ≤ 60 sq m (metro) / 90 sq m (other) **and** value
   ≤ ₹45 lakh (`REALTY_AFFORDABLE_RULES`, date-keyed), else `residential_other`; `commercial` per type.
4. **Completion certificate**: `cc_date` on the project; any demand dated on / after it is flagged "after CC — not a
   supply (Sch III para 5(b))" and the demand invoice becomes a non-GST document (C3, CN21).
5. RealtyDesk → Projects / Units: grid by tower and floor with status colours (tokens), filters, CSV export.

**Files.** New: `src/lib/construction/{cn-realty-projects,cn-units}.ts`, `src/components/construction/RealtyDesk.tsx`
(views projects / units).

**Tests.** `tests/cn-units.test.ts`: bulk add; affordable test both limits and both city classes; CC flag; status flow.

#### CN-C2 Bookings, cost sheet, allotment letter, receipts

**User story.** As a builder, I book flat A-1203 for a buyer with a cost sheet (base, PLC, car parking, club,
development charges; stamp duty and registration shown as pass-through), take the booking amount, print the allotment
letter, and the app warns me before I take more than 10% before the agreement is registered.

**Acceptance criteria.**
1. Table `realty_bookings` (`BKG/FY…`): `{ id, number, date, unit_id, client_id, co_applicants?, cost_sheet: [{ head,
   amount, taxable: boolean, pass_through: boolean }], agreement_value, agreement_date?, registered_on?, plan_id,
   broker?: { vendor_id, pct }, loan?: { bank, sanction }, status: 'booked' | 'agreement' | 'registered' | 'possession'
   | 'cancelled' }`. Pass-through heads (stamp duty, registration, society / maintenance deposit, corpus) are collected
   as **pure agent** (Rule 33): never in the taxable value, booked to a liability until paid over (CN24).
2. **Receipts** are ordinary advances (`advances.ts`, GST on receipt for the construction service; G3) tagged
   `booking_id` (additive); demand invoices (C3) adjust them. Payer may be a bank (loan disbursement) — a payer name on
   the receipt.
3. **RERA Sec 13 guard**: total received before `registered_on` > 10% of agreement value → warning "RERA Sec 13:
   at most 10% before a registered agreement for sale — check" (warn, never block; CN25).
4. **194-IA hint**: agreement value (or stamp value) ≥ ₹50 lakh → the receipt form shows "Buyer deducts 1% TDS (Sec
   393(1) Table 3(i) / old 194-IA); record it as TDS on the receipt" (labels via `ita2025.sectionText`).
5. **Allotment letter / booking receipt** print (lazy HTML, `printHtmlDocument`): project, RERA no., unit, carpet area,
   cost sheet, payment plan, RERA collection account details, terms text from settings.
6. Broker commission → vendor bill with 194H (existing TDS engine), linked to the booking.

**Files.** New: `src/lib/construction/{cn-bookings,cn-allotment-print}.ts`, RealtyDesk view `bookings`.

**Tests.** `tests/cn-bookings.test.ts`: cost sheet taxable vs pass-through; 10% guard; 194-IA hint threshold; unit
status moves; receipts as advances.

#### CN-C3 Payment plans, stage demands, demand letters, real-estate GST classes

**User story.** As a builder, when the engineer certifies "4th slab" for tower A, I raise demands for 46 booked flats
in one go — each a tax invoice for 10% of the agreement value at 5% (effective, land deemed one-third) or 1% for
affordable flats, plus interest on any overdue earlier stage — and send the demand letters by WhatsApp.

**Acceptance criteria.**
1. Table `payment_plans`: `{ id, name, kind: 'clp' | 'time' | 'down_payment' | 'subvention', stages: [{ id, label,
   pct, due_days, trigger: 'booking' | 'agreement' | 'stage' | 'date', date? }] }` (sum of `pct` = 100, refused
   otherwise). Table `stage_certificates`: `{ id, project_id, tower_id, stage_id, certified_on, by (engineer /
   architect), ref }`.
2. **Demand run**: certifying a stage lists every live booking in the tower on a plan containing it; "Raise demands"
   creates, per booking, one **tax invoice** (invoice series) and a demand number (`DMD/FY…`) with the snapshot
   `boq_terms.cn.demand`: `{ booking_no, unit, tower, carpet_sqm, rera_no, stage_label, pct, agreement_value,
   previously_demanded, previously_received, interest?: { days, rate, amount }, cc_after?: boolean }`; previously
   received advances are adjusted through `advances.ts`.
3. **Real-estate GST classes** (`REALTY_RATE_RULES`, date-keyed from 2019-04-01): `realty_affordable` 1%,
   `realty_residential` 5%, `realty_commercial_in_rrep` 5%, all **without ITC**, computed as the notification rate on
   two-thirds of the value: the line shows the full amount and the paper prints "Value of land deemed one-third (N
   11/2017-CT(R) para 2, as amended by N 03/2019) ₹x; taxable value ₹y; CGST 0.75% / 3.75% …" (CN18 — the default
   is the two-thirds presentation with the effective 1% / 5%; GSTR-1 reports taxable value y at the notification rate
   and the deemed land value is **not** reported as exempt, pending CN18). `old_option` projects use the user's rate
   with ITC. After `cc_date`: a Bill of Supply-like non-GST demand "Sale of building after completion certificate — not
   a supply" (CN21).
4. **Interest on delay**: from the earlier stage's due date to the demand date at `REALTY_INTEREST_RULES`
   (default SBI MCLR + 2% typed in settings, "state RERA rule — set yours"), as a taxable line at the unit's GST class
   (Sec 15(2)(d), CN23); waivable per booking (audited).
5. **Demand letter paper** (`DemandBlock.tsx`, lazy; mounts when `boq_terms.cn.demand` exists): unit / tower / carpet
   area / RERA no.; stage and %; table "Agreement value · Demanded so far (incl. this) · Received · Balance due"; the
   payment-plan stage table (reusing `PaymentScheduleBlock` styling); RERA collection account and "Pay only to this
   account"; `wa.me` share per buyer from the run summary.
6. Ageing per buyer and per tower in RealtyDesk → Demands; reminders through the existing follow-ups (R2-A4).

**Files.** New: `src/lib/construction/{cn-plans,cn-demands,cn-realty-tax}.ts`, `src/components/templates/parts/DemandBlock.tsx`,
RealtyDesk views `plans`, `demands`.

**Tests.** `tests/cn-demands.test.ts`: plan sums; demand per booking; land one-third maths (1% / 5% effective) to the
paisa; affordable vs other; after-CC non-GST; interest days and GST on it; advance adjustment; idempotent run (a stage
is demanded once per booking).

#### CN-C4 RERA designated account (70%), withdrawal certificates, QPR data

**User story.** As a builder, I see for each project how much the buyers paid, how much of it (70%) had to go into the
RERA account, what is there, and how much I may withdraw at 42% completion, with the three certificates recorded.

**Acceptance criteria.**
1. A project's `rera_account_id` is an ordinary bank account (additive flag `rera_project_id` on the bank account).
   RealtyDesk → RERA: per project and month: collections from allottees (receipts tagged to its bookings, excluding
   pass-through heads), 70% required (`RERA_DEPOSIT_RULES`, date-keyed, default 70%), deposited into the RERA account
   (bank receipts / transfers into it), shortfall.
2. **Withdrawal**: `rera_withdrawals` table `{ id, project_id, date, amount, completion_pct, certificates: { engineer,
   architect, ca }: { name, ref, date }, purpose: 'land' | 'construction' }`; allowed = (total land + construction cost
   incurred × completion %) logic as typed by the user — the app checks only: cumulative withdrawals ≤ deposits and ≤
   completion % × deposits (warning, CN25).
3. **QPR data sheet** (CSV): units booked / sold, amounts received, RERA account balance, withdrawals, % completion per
   tower — for the user's quarterly upload (no portal).
4. Annual audit pack: the year's RERA statement as CSV + print, labelled "for your CA's Form 5 / annual audit".

**Files.** New: `src/lib/construction/cn-rera.ts`, RealtyDesk view `rera`.

**Tests.** `tests/cn-rera.test.ts`: 70% required, shortfall, withdrawal checks, pass-through excluded, QPR rows.

#### CN-C5 Cancellations, refunds, forfeiture; 80% procurement test

**User story.** As a builder, when a buyer cancels, the app works out the refund (received − forfeiture − brokerage
recovered per the agreement), issues a credit note if still within the Sec 34 time limit or a refund "net of tax" with
the Circular 188 note if not, and frees the unit. At year end I check that 80% of my project inputs came from
registered suppliers.

**Acceptance criteria.**
1. **Cancellation** (booking → `cancelled`, reason, date): proposal = received − forfeiture (`%` of agreement value or
   amount, from settings) − taxes the app cannot reverse. Within the Sec 34 window (credit note by 30 Nov after the FY
   end of the invoice, `CREDIT_NOTE_TIME_RULES` — use the existing rule if present, else add to `construction-rules.ts`)
   → credit notes against the demands; after it → refund voucher (`advances.ts` refund) net of tax + a printed note
   "GST collected ₹x may be claimed by the buyer as a refund (Circular 188/20/2022-GST)". Forfeiture is booked as
   "Forfeiture income" without GST by default (CN22). Unit returns to `available`.
2. **80% procurement test** (`realty_procurement` view): per project and FY, from purchase bills tagged to the project
   cost centre: inputs and input services from registered vs unregistered suppliers (excluding TDR / FSI, long-term
   lease premium, electricity, high-speed diesel, motor spirit, natural gas — exclusion list in
   `REALTY_PROCUREMENT_RULES`, verify), shortfall below 80% × 18% (cement from unregistered at its own rate) = RCM
   payable, shown as a working paper with a "Book RCM liability" journal draft (CN20). Reads purchases through
   `readPurchase` (added to `purchase-contract.test.ts`).

**Files.** New: `src/lib/construction/{cn-cancellations,cn-procurement80}.ts`, RealtyDesk views `cancellations`,
`procurement`.

**Tests.** `tests/cn-cancellations.test.ts`, `tests/cn-procurement80.test.ts`: within / after Sec 34 window; forfeiture;
unit freed; 80% maths with exclusions; cement RCM rate; purchase-contract registration.

### CN-D — Site operations

#### CN-D1 Sub-contract work orders and measured sub-contractor bills

**User story.** As a main contractor, I give the plastering work to a sub-contractor at back-to-back rates, measure
his work monthly, and the app makes his bill (our purchase) with his abstract, 5% retention, recovery of the cement I
issued him, 1% 194C TDS and the advance I paid — and shows margin per BOQ item.

**Acceptance criteria.**
1. Table `sub_work_orders` (`SWO/FY…`): `{ id, number, date, vendor_id, contract_id?, boq_id?, lines: [{ id, boq_line_id?,
   ref, description, unit, qty, rate, sac, gst_rate }], deductions: DeductionRule[] (retention, advance recovery,
   material recovery, labour cess pass-down?, other), status }`. "From BOQ" copies chosen lines with a rate % or typed
   rates.
2. Table `sub_measurements` (`SCB/FY…`): same shape as `ra_measurements` (cumulative / this qty, MB ref) against the
   work order. Saving creates a **purchase bill** (`PURCHASE`, existing BillModal path, 194C via `billTdsInputFor`) with
   lines = this-bill quantities and a snapshot `cn` of the abstract and deductions (purchase record additive field
   `cn_sub`), and the sub-contractor's abstract print (abstract-page component reused with "Sub-contractor bill").
3. Deductions on the bill: retention (payable later — liability "Retention payable to sub-contractors"), material
   recovery (debit note / journal Cr stock at site — material issued through `job-work.ts` challans when the
   sub-contractor holds our material), advance recovery (vendor advances), 194C on value excluding GST (CBDT Circular
   23/2017, CN14). Payables ageing uses net due (a guarded call mirroring `raDueSplit`).
4. Margin per BOQ item: our RA rate − sub-contract rate × qty, in the site P&L (D5).

**Files.** New: `src/lib/construction/{cn-subcon,cn-subcon-bill}.ts`, `src/components/construction/SubconView.tsx`.
Edit: `types/construction-r11.ts` (`PurchaseRecord.cn_sub`), payables ageing reader (one guarded call, §6).

**Tests.** `tests/cn-subcon.test.ts`: back-to-back copy; measurement → bill lines; retention liability; material
recovery; 194C on ex-GST value; purchase-contract registration.

#### CN-D2 Labour contractors and the site muster

**User story.** As a contractor, I pay a labour contractor monthly only after he shows that month's PF and ESI challans
and wage register; and for my own daily-wage workers at the site I mark attendance each day and pay weekly in cash,
with the app warning me at ₹10,000 per person per day.

**Acceptance criteria.**
1. **Labour-contractor compliance pack** (`labour_compliance` table): per vendor per month `{ vendor_id, month, headcount,
   wages, pf: { trrn?, amount?, file? }, esi: { challan?, amount?, file? }, wage_register?: file, licence?: { no,
   valid_till }, status: 'pending' | 'proved' | 'waived' }` (files through the existing attachments store). Bills from
   that vendor for that month carry a **withholding** proposal (`construction_settings.labour_withhold_pct`, default 10%
   of the bill, or the PF + ESI amount, whichever is higher) until `proved` (CN15) — a warning and a "hold" amount on
   the payment, never a block.
2. **Manpower supply bill** (when we are the labour contractor, kind `labour`): invoice preset SAC 998519 at 18%, lines
   "Wages", "Statutory contributions (PF / ESI)", "Service charge" — one supply at one rate (the wages are part of the
   value, not pure-agent, CN15), with the compliance pack printable as an annexure.
3. **Site muster** (`site_labour` master: name, trade, daily rate, OT rate, phone, ID ref (optional), site; `muster_days`
   table: one row per site per day `{ site_id, date, entries: [{ labour_id, present: 0 | 0.5 | 1, ot_hours? }] }`;
   weekly settlement `MUS/FY…` → one cash / bank payment voucher per week with a wage sheet (gross = days × rate + OT −
   advances), booked to "Site labour wages" with the site cost centre. Cash above `CASH_PAYMENT_LIMIT_RULES` (₹10,000
   per person per day, Sec 40A(3); existing rule if present) → warning (CN16). Minimum-wage check against a typed rate
   per trade (warn).
4. Muster is separate from payroll (owner-only, confidential); a worker can be linked to a payroll employee later.

**Files.** New: `src/lib/construction/{cn-labour-compliance,cn-muster}.ts`, `src/components/construction/LabourView.tsx`.

**Tests.** `tests/cn-labour.test.ts`: withholding until proved; manpower bill preset; muster → weekly sheet; half days and
OT; cash-limit warning; one row per site per day.

#### CN-D3 Plant and equipment: log sheets, hire in and hire out

**User story.** As a road contractor, my JCB, roller and transit mixers have daily log sheets (hours, idle, fuel); I
charge the roller to a sub-contractor at ₹1,200 an hour and pay a hirer for a crane by the day, with the right TDS.

**Acceptance criteria.**
1. Equipment = a fixed asset (`fixed_assets`, additive `cn_equipment: { kind, reg_no?, hour_meter?, cost_centre_id? }`)
   or a hired item (`hired_equipment` table: `{ id, vendor_id, description, rate, basis: 'hour' | 'day' | 'month',
   with_operator: boolean, from, to? }`).
2. **Log sheets** (`plant_logs`, `PLG/FY…`): `{ id, number, date, equipment_ref, site_id, hours_worked, idle_hours,
   breakdown_hours, fuel_litres, operator?, sub_contractor_id? }`; monthly summary per machine (utilisation %, fuel per
   hour flag outside a typed range).
3. **Hire in**: month-end proposal of a purchase bill from the hirer's logs; TDS section by `with_operator` — with
   operator → 194C, without → 194-I(a) 2% plant (default, CN17); ITA 2025 labels via `ita2025.ts`.
4. **Hire out / internal charge**: logs against a sub-contractor become a recovery on his bill (D1, kind `hire_recovery`)
   or an invoice (SAC 997313 / 9966 per `PLANT_HIRE_SAC_RULES`, 18%, verify); logs against our own sites become a site
   P&L charge at the internal rate (memo, D5).

**Files.** New: `src/lib/construction/{cn-plant,cn-plant-hire}.ts`, `src/components/construction/PlantView.tsx`.

**Tests.** `tests/cn-plant.test.ts`: utilisation; fuel flag; hire-in bill and TDS by operator flag; hire-out recovery;
purchase-contract registration.

#### CN-D4 Material reconciliation (cement / steel), wastage band, client-material recovery

**User story.** As a contractor on a government work, at each RA bill and at the final bill I prepare the cement and
steel reconciliation: received (own + issued by the department), theoretical consumption from the measured quantities,
actual, wastage within the permissible band, and the recovery the department will make for excess.

**Acceptance criteria.**
1. Extends R5-B6 `sites.ts` statements (no engine change): per site and material, columns **Opening, Received — own,
   Received — client issue (free / against recovery), Theoretical (Σ measured qty × coefficient), Actual (consumption
   journals), Variation %, Permissible band (default −3% / +3%, contract term per material), Excess beyond band, Recovery
   rate (default: issue rate × `penal_factor` 2, contract term), Recovery amount, Closing at site**.
2. Client-issued materials (B4) appear as their own receipt rows (free issue: quantity only, value 0).
3. Print "Material reconciliation statement" (lazy page; CPWD-style columns) and CSV; attach to the final bill closure
   checklist (B5).
4. Coefficients library: a starter set of common items (PCC 1:2:4, RCC M20, brickwork, plaster 12 mm) with cement bags
   per unit, marked "typical — set yours" in `construction-rules.ts` `COEFFICIENT_STARTERS` (non-statutory).

**Files.** New: `src/lib/construction/cn-reco.ts`, `src/components/construction/RecoView.tsx`. Edit: `works/sites.ts`
(export one helper), `SitesPanel.tsx` (link).

**Tests.** `tests/cn-reco.test.ts`: band and excess; free vs recovery issue; recovery amount; alternate units via
`lineFactor`; final-bill statement totals.

#### CN-D5 Site P&L, unbilled work (WIP) and cost to complete

**User story.** As an owner with five sites, I see for each: billed (gross and net), certified but unbilled, materials
consumed, sub-contractor bills, labour (muster + labour contractors), plant, overheads tagged to the site, margin, and
the estimated cost to complete against the remaining contract value.

**Acceptance criteria.**
1. Works → Site P&L per contract / cost centre and period: **Revenue** (RA bills taxable, PV, net of credit notes);
   **Costs** (stock consumption at site via `siteCostByCentre`, sub-contractor bills (D1), labour-contractor bills and
   muster (D2), plant hire and internal plant charges (D3), other bills and expenses with the site cost centre);
   **Margin** and margin %.
2. **Unbilled work (WIP memo)**: measured-but-unbilled quantities (draft measurements) × rate, plus a typed "work done
   not yet measured" amount; **cost to complete** typed per BOQ group; **expected margin** = remaining contract value −
   cost to complete. Memo only: no journal (CN26 — year-end entry is the accountant's).
3. Retention receivable and payable, held amounts and advances per site shown under the P&L (from `raDueSplit` and D1).
4. CSV and print; Books → Projects keeps its ledger-based P&L and gains a link "Site P&L (works)".

**Files.** New: `src/lib/construction/cn-site-pnl.ts`, `src/components/construction/SitePnlView.tsx`.

**Tests.** `tests/cn-site-pnl.test.ts`: every source summed once (no double count of material issued to a sub-contractor
and recovered); WIP memo; cost to complete; purchase-contract registration.

---

## 5. Work packages

Four packages, each one agent in its own worktree. **Merge order: CN-A first** (profile, registry, rules / types
scaffolds, template mounts, stubs). CN-B and CN-D follow in any order; **CN-C** can go in parallel with B and D (it shares
only registries, rules, types, demo and help with them). Every package rebases on whatever of Round 9 RT-D / RT-E and
Round 10 has merged; the shared files with those rounds are append-only (§6).

CN-A owns:
- the `realty` pack id and the profile (`construction_kind`, `construction_settings`);
- `construction-rules.ts`, `cn-registry.ts` and `types/construction-r11.ts` scaffolds (every package's sub-field types
  of `boq_terms.cn` declared in one commit);
- the `RaDeductionKind` union line (all six new kinds in one commit, for B and D);
- the series names `SWO`, `SCB`, `BKG`, `DMD`, `MUS`, `PLG`, `PVB` (reserved in one commit; each package uses its own);
- every template mount in `TemplateEngine.tsx` (lazy imports by the paths in this PRD; stubs return null until merged);
- `R11Stub.tsx` and every R11 view / tab / help / Ctrl+K row (§6).

### CN-A — Profile and the construction bill (A1–A5)

Owned (new):
- `src/lib/construction/cn-{profile,registry,settings,tax,snapshot,abstract,print}.ts`, `src/lib/construction-rules.ts`;
- `src/types/construction-r11.ts`;
- `src/components/construction/{ConstructionKindPicker,R11Stub}.tsx`, `src/components/creator/ContractPanel.tsx`;
- `src/components/templates/parts/{WorksHeaderBlock,WorksDeductionsBlock,WorksAbstractPage,RaItemsTable}.tsx` +
  `works-paper.module.css`;
- `src/i18n/areas/construction-r11a.ts`;
- `docs/features/construction-r11.md` (one doc for the round; each package edits only its section);
- tests `cn-profile`, `cn-tax`, `cn-snapshot`, `cn-abstract`, `cn-print`, `cn-registry`, `cn-rules`, `cn-pack-gate`.

Owned (edit):
- `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`;
- `SetupWizard.tsx`, `FeaturesPanel.tsx`; `page-tabs.ts` (`RECEIVABLES_TABS`), `Receivables.tsx` (lazy mount),
  `WorksTab.tsx` (`VIEWS`, lazy mounts);
- `TemplateEngine.tsx`, `FooterBlocks.tsx` (one guarded line), `PaperHeader.tsx` / `GstBody.tsx` (one title line each),
  `paper-helpers.ts` (`worksLineText`, `worksDeclaration`);
- `works/measurements.ts` (snapshot call, classes), `works/ra-abstract.ts` (MB column), `MeasurementForm.tsx`,
  `works/boq.ts` (class suggestion, `DEDUCTION_KINDS`);
- `types/transport-works-r5.ts` (union line); `transport-works-rules.ts` (dated rows only, if CN1 is answered);
- `gst-guards.ts`, `bill-guard.ts` (one lazy check each);
- `demo/profile-works.ts` (dispatcher + A's block);
- `tests/help-registry.test.ts`, `tests/help-glossary.test.ts`, `tests/docs-links.test.ts` (regex + `CN`).

Budget: first paint **0 bytes**; total ≤ 15 kB gz.

### CN-B — Contractor finance (B1–B5)

Owned (new): `src/lib/construction/cn-{contracts,advances,secured,escalation,recoveries,guarantees,closure}.ts`;
`src/components/construction/{ContractsView,AdvancesView,EscalationView,GuaranteesView}.tsx`,
`src/components/templates/parts/PvWorkingPage.tsx`; `src/i18n/areas/construction-r11b.ts`; tests `cn-contracts`,
`cn-advances`, `cn-escalation`, `cn-recoveries`, `cn-guarantees`.

Owned (edit): `works/deductions.ts`, `works/ra-due.ts`, `works/ra-receivable.ts`, `RaReceiptPanel.tsx`,
`works-alerts.ts` (new alert kinds), `property/deposits.ts` (reads `contract_id` only).

Shared (§6): rules (`// CN-B`), types (`// CN-B`), registry block, demo block, `works/boq.ts` (A owns
`DEDUCTION_KINDS`; B only reads).

Budget: total ≤ 10 kB gz.

### CN-C — Builders and developers (C1–C5)

Owned (new): `src/lib/construction/cn-{realty-projects,units,bookings,allotment-print,plans,demands,realty-tax,rera,
cancellations,procurement80}.ts`; `src/components/construction/RealtyDesk.tsx`,
`src/components/templates/parts/DemandBlock.tsx`; `src/i18n/areas/construction-r11c.ts`; tests `cn-units`,
`cn-bookings`, `cn-demands`, `cn-rera`, `cn-cancellations`, `cn-procurement80`.

Owned (edit): `advances.ts` (reads `booking_id` only — declared in `types/construction-r11.ts`); the bank-account form
(one lazy "RERA account of project" select).

Shared (§6): `TemplateEngine.tsx` mount for `DemandBlock` (written by A), rules (`// CN-C`), types, registry, demo, help.

Budget: total ≤ 14 kB gz.

### CN-D — Site operations (D1–D5)

Owned (new): `src/lib/construction/cn-{subcon,subcon-bill,labour-compliance,muster,plant,plant-hire,reco,site-pnl}.ts`;
`src/components/construction/{SubconView,LabourView,PlantView,RecoView,SitePnlView}.tsx`;
`src/i18n/areas/construction-r11d.ts`; tests `cn-subcon`, `cn-labour`, `cn-plant`, `cn-reco`, `cn-site-pnl`.

Owned (edit): `works/sites.ts` (export one helper), `SitesPanel.tsx` (link), the payables ageing reader (one guarded
call), `tests/purchase-contract.test.ts` (D's readers; C adds its own).

Shared (§6): `job-work.ts` (read-only use), fixed assets (additive field through types), rules (`// CN-D`), types,
registry, demo, help.

Budget: total ≤ 11 kB gz.

**Combined:** first paint +0 kB; total JS ≤ +50 kB. Each package runs `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build` and `npm run check:size` on its branch and again after rebase.

---

## 6. Shared-file protocol

| File | Who | Rule |
|---|---|---|
| `src/types/construction-r11.ts` | A creates | One `declare module` block per package, marked `// CN-A` … `// CN-D`. A declares, for every package in one commit, the `BoqTerms` merge `cn?: CnSnapshot` with sub-objects `header`, `lines`, `pv` (B), `demand` (C), `jv` (B), and settings `construction_kind`, `construction_settings`; item `cn_class`. B: `SecurityDeposit.contract_id`. C: `AdvanceRecord.booking_id`, `BankAccount.rera_project_id`. D: `PurchaseRecord.cn_sub`, `FixedAsset.cn_equipment`. Packages fill only their own block. |
| `src/types/transport-works-r5.ts` | A | One edit: the `RaDeductionKind` union gains the six kinds of B2 / B4 (types only). Nothing else. |
| `src/store/invoice-defaults.ts` | — | **Not edited.** `boq_terms` and `ra_deductions` are already kept verbatim (`R5B_RECORD_KEYS`). |
| `src/lib/construction-rules.ts` | A creates | Sections `// CN-A` `WORKS_CLASS_RULES`, `PLANT_HIRE_SAC_RULES`; `// CN-B` `ADVANCE_DEFAULTS` (mobilisation 10% @ 10% simple, recovery 10%→80%, secured 75%, 90-day alert — "contract practice"), `ESCALATION_DEFAULTS` (M 0.85); `// CN-C` `REALTY_RATE_RULES`, `REALTY_AFFORDABLE_RULES`, `REALTY_INTEREST_RULES`, `RERA_DEPOSIT_RULES`, `REALTY_PROCUREMENT_RULES`; `// CN-D` `WASTAGE_BAND_DEFAULTS`, `COEFFICIENT_STARTERS`, `LABOUR_WITHHOLD_DEFAULTS`. Every row carries `source` and `verified`. Imported only by lazy modules (`tests/cn-rules.test.ts`). |
| `src/lib/transport-works-rules.ts` | A (rows only) | Append-only dated rows: `LABOUR_CESS_RULES` gains a 2025-11-21 row (same 1%, source "Code on Social Security 2020 Sec 100; S.O. 2322(E) 8 May 2026 as reported — verify", CN5); `WORKS_CONTRACT_RATE_RULES` unchanged unless CN1 is answered. |
| `src/lib/construction/cn-registry.ts` | A creates | `CN_TABLE_ACTIONS` / `CN_WATCHED`, one block per package — A: `construction_settings`; B: `works_contracts`, `secured_advances`, `price_variations`, `bank_guarantees`; C: `realty_projects`, `realty_units`, `realty_bookings`, `payment_plans`, `stage_certificates`, `rera_withdrawals`; D: `sub_work_orders`, `sub_measurements`, `labour_compliance`, `site_labour`, `muster_days`, `hired_equipment`, `plant_logs`. `tests/cn-registry.test.ts` pins both maps and the importers (`sync-engine.ts`, `trust/recycle-bin.ts`, added by A). |
| `src/lib/backup.ts`, `sync-engine.ts` (`DATED`, `NUMBERED`), `trust/open-export-schema.ts` | each its own rows | Append-only blocks `// R11-A` … `// R11-D`; conflicts with Round 9 / 10 blocks resolved by keeping both. |
| `src/components/templates/TemplateEngine.tsx` | A | Five lazy imports + mounts, each guarded by data presence and `layout !== 'receipt'`: `WorksHeaderBlock` (after `PartyPanel`; before `GstBody`), `RaItemsTable` (replaces `PaperItemsTable` only when `boq_terms.cn.paper === 'pwd'` on non-gst layouts), `WorksDeductionsBlock` (after the footer / `GstBody`), `WorksAbstractPage` and `PvWorkingPage` (following pages, after the annexure), `DemandBlock` (after `PartyPanel`; before `GstBody`). B / C replace their stub targets only. |
| `parts/FooterBlocks.tsx`, `PaperHeader.tsx`, `GstBody.tsx` | A | One guarded line each (skip "Less: TDS" when `ra_deductions` exists; RA title). |
| `paper-helpers.ts` | A | `worksLineText` call inside `trackingText`, `worksDeclaration`; appended after Round 9 / 10 helpers. |
| `src/lib/works/*` | A, B, D | A: `measurements.ts` (snapshot call, classes), `ra-abstract.ts` (MB column), `boq.ts` (`DEDUCTION_KINDS`, class suggestion). B: `deductions.ts`, `ra-due.ts`, `ra-receivable.ts`, `works-alerts.ts`. D: `sites.ts` (one export). Existing `tests/works-*.test.ts` must pass unchanged. |
| `src/components/works/WorksTab.tsx` | A | `VIEWS` list and one lazy mount per view (stubs until a package merges). Packages never edit it. |
| `src/components/works/{MeasurementForm,RaReceiptPanel,SitesPanel}.tsx` | A / B / D | A: MB to bill, classes; B: recovery rows; D: link to reconciliation. |
| `src/pages/page-tabs.ts`, `src/pages/Receivables.tsx` | A | `RECEIVABLES_TABS` row `realty` and the lazy desk mount. Round 9's `deliveries` and Round 10 rows stay; order: existing, R9, R10, R11. |
| `src/lib/industry-packs.ts` | A | `realty` id; `PACK_TABS` block `// R11` (every Works view and every realty view). Appended after Round 10's block. |
| `src/lib/shop-presets.ts`, `checklist-steps.ts`, `features-catalog.ts`, `SetupWizard.tsx`, `FeaturesPanel.tsx` | A | Appended blocks `// R11`, after Round 9 / 10 blocks. |
| `src/lib/gst-guards.ts`, `bill-guard.ts` | A | One lazy check each (class-rate notice; no-ITC realty caution). |
| `src/lib/help/topics-*.ts`, `glossary.ts`, `src/i18n/areas/discover-r6-tabs.ts` | A | A writes every R11 topic and Ctrl+K title in one `// R11` block per file using this PRD's view ids; packages correct their rows after rebase if wording changes. |
| `src/lib/demo/profile-works.ts` | A | Dispatcher by `construction_kind`; one block per package; the existing works rows stay. |
| `tests/purchase-contract.test.ts` | C, D | Each appends its reader modules. |
| `tests/e2e/smoke.mjs` | A, B, C, D | One appended `step(...)` block each, in merge order, after Rounds 9 / 10. |
| `docs/features/construction-r11.md` | A creates | One section per package; each records its bundle numbers there. |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md` | lead | After merge: the Round 11 section; table rows; settings keys; the `construction-rules.ts` note; "Round 11 invoice snapshots live under `boq_terms.cn` (and `ra_deductions`); on a BOQ `boq_terms` keeps its R5 meaning"; "every module that writes a Round 11 table must `import './cn-registry'`"; "recoveries settle through the RA clearing account (`ra_journal_id`), never a new no-cash marker". |
| `docs/CA_REVIEW.md` | lead | CN items are added with this PRD; packages report changes as rows in their feature-doc section. |
| Round 9 / 10 overlap | lead | Expected shared files: `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`, `SetupWizard.tsx`, `FeaturesPanel.tsx`, `page-tabs.ts`, `backup.ts` / `sync-engine.ts` / open-export rows, help files, `smoke.mjs`, `paper-helpers.ts`, `TemplateEngine.tsx` (Round 10 adds none there; Round 9 none planned), `CA_REVIEW.md`. All edits are append-only blocks or single lazy lines; the second to merge keeps both. |

### Storage summary

| Key / field | Package | Kind | Backed up | Synced | Audited | Right (`cn-registry`) |
|---|---|---|---|---|---|---|
| `construction_settings` | A | object | yes | yes (singleton) | yes | `settings.manage` |
| `works_contracts` | B | table | yes | yes | yes | `master.edit` |
| `secured_advances` | B | table, dated `date` | yes | yes | yes | `doc.create` |
| `price_variations` (`PVB`) | B | table, dated, numbered | yes | yes | yes | `doc.create` |
| `bank_guarantees` | B | table, dated `issued_on` | yes | yes | yes | `books.edit` |
| `realty_projects` | C | table | yes | yes | yes | `master.edit` |
| `realty_units` | C | table | yes | yes | yes | `master.edit` |
| `realty_bookings` (`BKG`) | C | table, dated, numbered | yes | yes | yes | `doc.create` |
| `payment_plans` | C | table | yes | yes | yes | `master.edit` |
| `stage_certificates` | C | table, dated `certified_on` | yes | yes | yes | `doc.create` |
| `rera_withdrawals` | C | table, dated | yes | yes | yes | `books.edit` |
| `sub_work_orders` (`SWO`) | D | table, dated, numbered | yes | yes | yes | `doc.create` |
| `sub_measurements` (`SCB`) | D | table, dated, numbered | yes | yes | yes | `doc.create` |
| `labour_compliance` | D | table (vendor × month) | yes | yes | yes | `doc.create` |
| `site_labour` | D | table | yes | yes | yes | `master.edit` |
| `muster_days` (`MUS` on weekly settlements) | D | table, dated (one row per site per day) | yes | yes | yes | `doc.create` |
| `hired_equipment` | D | table | yes | yes | yes | `master.edit` |
| `plant_logs` (`PLG`) | D | table, dated, numbered | yes | yes | yes | `doc.create` |
| settings `construction_kind` | A | additive | yes | yes | yes | — |
| `boq_terms.cn` (header, lines, pv, demand, jv); `ra_deductions` new kinds | A (sub-fields A–C) | additive inside kept keys | yes | yes | yes | — |
| item `cn_class`; `SecurityDeposit.contract_id`; `AdvanceRecord.booking_id`; `BankAccount.rera_project_id`; `PurchaseRecord.cn_sub`; `FixedAsset.cn_equipment` | A / B / C / C / D / D | additive | yes | yes | yes | — |
| Accounts by name: "Secured advance from clients", "Material issued by client", "Water & electricity — site", "Plant hire charges", "Interest on mobilisation advance", "Liquidated damages", "Retention payable to sub-contractors", "Site labour wages", "Forfeiture income", "Pass-through collections (stamp duty, registration, deposits)" | B / C / D | created on first use | — | — | — | — |

No device-local key. No migration (everything is additive). Labour IDs and buyer KYC are personal data (DPDP Act
2023): they stay on the device and in the user's own backups like every other table.

---

## 7. E2E steps (production build, `tests/e2e/smoke.mjs`)

1. **R11-A**:
   - Fresh company → wizard → Contractor → *Civil / EPC* + "government" → lands on `/time?tab=works&view=contracts`.
   - Import a 3-line BOQ; measure RA 1 with MB refs; save → open the invoice preview: the paper shows "Running Account
     Bill No. 1", the contract particulars box, "Item 1.1 · MB 112/45" under a line, the deductions block with **Net
     payable** and the measured / checked / passed boxes; page 2 is the abstract with the MB column.
   - A plain (non-works) invoice preview is unchanged (snapshot compare).
   - Ctrl+K "RA bill" finds Time → Works → RA; F1 opens its help.
2. **R11-B**: on the same contract:
   - Record a mobilisation advance with 10% interest; RA 2 shows advance recovery + interest rows.
   - Secured advance on 100 bags; RA 2 recovers it; Works → Advances shows the balance 0.
   - Escalation: base and current cement index → PV statement → supplementary invoice; working page prints.
   - Receipt of RA 2 with a material recovery and water / electricity → receivables show only "due now"; books show the
     costs; the cash book shows only the cash part.
   - Add a PBG expiring in 20 days → the bell lists it.
3. **R11-C**: Settings → profile *Builder*:
   - Project with RERA no. and a tower of 4 units; book unit 101 (cost sheet with stamp duty pass-through); take a
     12% booking amount before agreement → the 10% warning.
   - Certify "plinth" → raise demands → the demand invoice shows land one-third, CGST 3.75% / SGST 3.75% on two-thirds
     (5% effective), the RERA account and the stage table.
   - Record the CC date; certify the next stage → the demand is non-GST with the Sch III note.
   - RERA view shows 70% required vs deposited.
4. **R11-D**: *Civil*:
   - Sub-contract work order from two BOQ lines; measure → purchase bill with 5% retention, 1% 194C on ex-GST value.
   - Muster: 3 workers × 6 days → weekly sheet → cash payment; a ₹12,000 cash day shows the Sec 40A(3) warning.
   - Plant log for a hired crane without operator → hire bill with 194-I(a) 2%.
   - Cement reconciliation shows an excess beyond 3% and its recovery; Site P&L shows revenue, costs and margin.

---

## 8. Open questions — with the default the builders will use

The owner asked for no questions, so each one has a default that the packages implement. A CA answer later changes a
dated rule row or a setting default, never the design.

| # | Question | Default chosen | Why |
|---|---|---|---|
| 1 | New business type or a sub-profile? | Sub-profile `construction_kind` under `contractor` (R8 / R9 / R10 pattern); existing contractor companies unchanged; checklist step. | Zero shell bytes; R5 invariant. |
| 2 | One pack or many? | Keep `works` for every contractor kind; add only `realty`; contractor sub-features are Works views switched by `construction_settings`. | Fewer pack ids; `PACK_ROUTES` untouched. |
| 3 | Where do the builder screens live? | `/receivables?tab=realty` (always-on route). | No `PACK_ROUTES` row, no module dependency. |
| 4 | Where are invoice snapshots stored? | `boq_terms.cn` and `ra_deductions` (kept verbatim today); no new record / line key. | **Zero first-paint bytes**; `invoice-defaults.ts` untouched. |
| 5 | Works-contract rate after 22 Sep 2025 (sources conflict) | Government / earthwork / their sub-contractors 18% from 2025-09-22 (the existing app row); class picker shows "sources conflict — verify (CN1)"; typed rate always wins. | Matches today's behaviour; no silent change to past bills. |
| 6 | Place of supply | Site State (Sec 12(3)) whenever a site is known; notice when not registered there. | CN4. |
| 7 | Supply + installation (MEP / interiors) | Lines keep their own classes; caution with one-click "treat as works contract". | Fact-dependent (CN3). |
| 8 | RA paper style | `standard` (item table + abstract page) for all kinds; `pwd` (cumulative item table) default for civil + government. | Matches what departments check. |
| 9 | Abstract live or snapshot? | Snapshot on the bill (`boq_terms.cn.lines`); register screen keeps live maths; drafts can recompute. | Critical Rule 3 spirit: an issued bill never changes. |
| 10 | IT TDS row on paper | Printed once, in the deductions block, for documents with `ra_deductions`. | No double "Less: TDS". |
| 11 | Deviation limit | 25% per item, contract field, "contract term". | Common PWD order of magnitude; the agreement governs. |
| 12 | Mobilisation advance | 10% of contract, 10% simple interest, recovery starts at 10% and completes by 80% of work; GST at receipt (I17). | CPWD practice (S); contract term. |
| 13 | Secured advance | 75% of assessed value of non-perishable material at site; **not** an advance for supply (liability, no GST); recovered as used; alert at 90 days. | Practice; GST view is CN7. |
| 14 | Price variation formula | CPWD 10CC-type: PV = M × W × Σ shares × index change, M = 0.85; typed indices; positive → invoice, negative → credit note. | CN6; contract clause governs. |
| 15 | Free-issue client material | Quantity only (reconciliation); not in value; material "against recovery" → booked as purchase from client at recovery value. | Bhayana Builders (SC 2018) reasoning; CN9. |
| 16 | Water / electricity recovery | 1% + 1% of gross (contract term), booked as site expense, no GST. | Common PWD clause; CN10. |
| 17 | LD | Deduction, no GST, expense "Liquidated damages"; taxable value of the bill unchanged. | Circular 178/10/2022; CN11. |
| 18 | Withheld amounts | Held bucket with a reason and expected release; bell at 90 days. | Not income lost; not overdue. |
| 19 | Guarantees | Register with expiry; commission = bank charges with ITC; margin FD as an asset. | CN13. |
| 20 | Real-estate rates | 1% (affordable) / 5% (other residential, commercial in RREP) without ITC, shown as notification rate on two-thirds with the one-third land line; old-option projects use typed rates. | N 03/2019; CN18. |
| 21 | Affordable test | Carpet ≤ 60 sq m metro / 90 sq m other **and** value ≤ ₹45 lakh; metro = Bengaluru, Chennai, Delhi NCR, Hyderabad, Kolkata, Mumbai (MMR) (list in rules, verify). | CN19. |
| 22 | After completion certificate | Demands dated on / after CC are non-GST ("not a supply"); earlier demands keep GST. | Sch III para 5(b); CN21. |
| 23 | Interest on buyer delay | Typed rate (default SBI MCLR + 2%, user sets), taxable at the unit's class. | Sec 15(2)(d); state RERA rules; CN23. |
| 24 | Pass-through charges | Stamp duty, registration, society / corpus deposits = pure agent, outside value, liability until paid. | Rule 33; CN24. |
| 25 | RERA 10% before agreement | Warning only. | Sec 13; owner's call. |
| 26 | RERA 70% | Tracked per project; withdrawals checked against deposits and completion %; nothing posted automatically. | CN25; certificates are human acts. |
| 27 | Cancellation | Credit note within Sec 34 window; afterwards refund net of tax with the Circular 188 note; forfeiture income without GST. | CN22. |
| 28 | 80% procurement | FY / project working paper; RCM 18% (cement at its own rate) on the shortfall as a journal draft, never auto-posted. | CN20. |
| 29 | Sub-contractor TDS | 194C on value excluding GST; retention payable as a liability; material issued via job-work challans. | CBDT Circular 23/2017; CN14. |
| 30 | Labour contractor withholding | Warn and propose holding 10% (or PF + ESI amount, higher) until the month's proof is recorded; never block. | Principal-employer exposure under the Labour Codes; CN15. |
| 31 | Site muster vs payroll | Separate light muster; weekly settlement vouchers; payroll stays owner-only. | Daily-wage reality; confidentiality. |
| 32 | Cash wages | Warn above ₹10,000 per person per day. | Sec 40A(3); CN16. |
| 33 | Plant hire TDS | With operator → 194C; without → 194-I(a) 2%. | CN17. |
| 34 | Wastage band | Cement / steel −3% / +3%, penal recovery at 2× issue rate; both contract terms. | Common practice; contract governs. |
| 35 | WIP / revenue recognition | Memo only (unbilled work, cost to complete, expected margin); no automatic journal. | CN26; accountant's year-end call. |
| 36 | JV / consortium | Informational field on the contract and the bill header; each member invoices its own share; no JV accounting. | CN27 (L). |
| 37 | Labour cess under the Social Security Code | Same 1% from 21 Nov 2025 (new dated row, new source); base stays "value before GST" with a contract option "construction cost only". | CN5; Kerala HC (as reported). |
| 38 | Budget | Stay inside +50 kB; the lead may raise total to 3000 kB with the stated reason only if Rounds 9–11 overrun after trimming. | First paint is the hard limit; total is precache. |
