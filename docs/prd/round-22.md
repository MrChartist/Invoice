# PRD: Round 22, solar rooftop installers, solar EPC contractors and solar-pump vendors (jobs, the 70:30 contract, subsidy tracking, 5-year CMC)

Status: draft for build · Drafted 2026-10-30 · Baseline: `origin/master` at `a711585` (PR #127, the em-dash writing
rule). Merged on the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–25, Rounds 7–19, Round 21 (A–D and QA25), PERF-3 …
PERF-6 (R21-P), R20-A, R20-B and R20-D. **Still open on the baseline: R20-C** (`docs/prd/round-20.md` §7, report keys,
core cap 7 kB) and **PERF-7**, a core-precache reclaim (target ≥ 15 kB) being built in parallel with this PRD.

Companion documents:
- `docs/CA_REVIEW.md` §22: the CA items **SO1–SO36** (§9 of this PRD), copied there with this PRD (the summary total
  moves from **770 to 806**, ★ from 193 to 207). `SO` ("solar") is a new prefix. The prefixes in `docs/CA_REVIEW.md`
  rows on `a711585` are AC, AG, CN, FU, G, HS, HT, I, LG, MF, MP, P, PF, PS, RT, SV, T, TR, TV, X; older text also uses
  `A B C D H M Q R S`. **`SO` ends in `O`, and no prefix is `O`; `S` is not in either regex**, so `SO1` cannot be read
  as a shorter id by `CA_LIST_RE` (no leading `\b`). This PRD's commit adds `SO` to `CITED_RE` and `CA_LIST_RE` in
  `tests/docs-links.test.ts` with the test `R22: CA-id patterns read SO ids whole`, so R22-A's help can cite
  `ca: ['SO1']` from its first commit.
- Sources: §2.8. **P** = primary text read this round (file downloaded and read, or page fetched), **S** = secondary
  source (press, practitioner article, search-result extract), **V** = vendor's own claim.
- Round 21 (`docs/prd/round-21.md` §2.2, §13) left automobile dealers (score 1.0), SaaS (1.0) and coaching / hostels
  (1.3) as the next industry candidates. This PRD scores those again with five segments no earlier ranking listed
  (§1.1, §2.2).

**Writing rule for every package.** Visible text has no em dash (type system §5, PR #127): a sentence takes a colon,
comma, full stop or brackets; an empty cell is a plain "-" (`tests/no-em-dash.test.ts` scans every new string). Numbers keep Indian comma grouping (₹1,89,000). Buttons
follow `docs/theme/BUTTON-SYSTEM.md` (`<Button>` for new code; primary = ink, destructive = `danger`, no tinted
buttons). Type follows `docs/theme/TYPE-SYSTEM.md` (no text below 12px, weight ≤ 600). This PRD itself avoids em dashes
so its strings can be copied into the UI as written.

Every item follows `AGENTS.md`:
- **Local-first and serverless.** No PM Surya Ghar National Portal, DISCOM portal, PM-KUSUM / State-agency portal,
  ALMM / NISE database, Jan Samarth, inverter-monitoring cloud, GST-portal or bank call. Application numbers, e-token
  amounts, inspection dates, DCR certificate numbers and work orders are **typed or imported from a file**.
- **Styling.** Vanilla CSS Modules with tokens. Templates use the `accent` variable only (Critical Rule 5).
- **Invoice snapshots never change.** Everything a solar document prints (deemed split, rates and the rule row used,
  capacity, serials, subsidy estimate, job and work-order references) is snapshotted on the document (`so`).
- **Numbering.** Indian-FY numbering. Round 22 adds **no new series**: contract bills are tax invoices on the existing
  series; quotations use the existing `QTN` series; a job is keyed by the customer, the DISCOM consumer number and the
  portal application number (typed, unique per company); work orders keep the agency's number (typed).
- **Dates.** Bare dates are parsed as local days. A job's stages are `YYYY-MM-DD` dates; the rate of a contract bill is
  the row in force on the document date.
- **Statutory values.** Date-keyed and append-only, in a lazy rule file. A row is `verified: true` only when its value
  was read in a primary text this round (the R15–R21 rule). A recommendation is a `pending-changes.ts` note, never a
  rule row. Scheme guideline values (CFA slabs, DCR, CMC) are scheme terms, dated to the guideline text read; they decide
  hints and estimates, never what GST a bill charges.
- **Outputs are working papers.** GST, income-tax and scheme outputs carry "verify with your CA" (Critical Rule 10).
  Subsidy estimates say "estimate; the Government decides". Eligibility checks are hints with the reason shown, never
  blocks.

---

## 1. Problem statement

### 1.1 Which round, and why this one

The lead's brief: score at least six segments of Indian small businesses not yet served well, by number of SMEs, pain
the app can remove, statutory complexity the app can safely model as working papers, reuse of existing modules, size
cost and risk.

| Candidate | What the app already has | Left over | Verdict |
|---|---|---|---|
| **Solar rooftop installers, solar EPC contractors, solar-pump (PM-KUSUM) vendors** | Kits sold as one line with a BOM (`StockItem.kit`, `events-kits.ts`); serial tracking and warranty months on lines (6.11); quotations (`QTN`) and conversions; advances and refunds (`advances.ts`); AMC contracts with visit schedules and reminders (`amc.ts`); R5-B / CN works pack (RA bills, retention, 194C and GST TDS u/s 51 deductions in `works/deductions.ts`); pure-agent lines (`charge_head_id: 'rule33'`); follow-ups and reminders; attachments; `saveMany` | **Everything specific:** the **70:30 deemed split** of a solar contract (goods 5 %, service 18 %, an 8.9 % blended rate that must still report two HSN rows), the PM Surya Ghar **subsidy (CFA) estimate** by capacity, State and household count, the **job pipeline** from survey to DISCOM inspection, net meter and CFA credit, "collect the balance after the subsidy", module **serials and DCR proof** for inspection, the **5-year free CMC** every scheme vendor owes, KUSUM work orders billed to State agencies | **Chosen** |
| Cab and tour fleet operators (passenger transport) | R5-B vehicles and trips (goods), R15 travel desk, 9(5) ECO rules | Duty slips (km / hours, night charges, toll and parking pass-through), rent-a-cab 5 % / 18 % option and RCM for body corporates, driver bata, aggregator payouts | Next (score 1.5) |
| Coaching institutes / hostels | R5-C fees, R10 classes, coaching refund | Hostel allotment, accommodation exemption | Mostly covered (1.3) |
| Automobile dealers | 206C(1F), R9 margin scheme / serials, R10 workshop and motor claims | OEM schemes, chassis-wise booking advances, finance / insurance payouts | Dealers must run the OEM's DMS; a second ledger app fits badly (1.0) |
| IT / SaaS exporters | R14 `svcexport` (LUT, Rule 89(4), FEMA realisation), recurring, deferrals | Usage metering, proration, SOFTEX forms | Small among this app's users (1.0) |
| Event venues / banquet halls | R7 hotel (banquets as folio lines), R15 events, advances, cancellations | Hall calendar by session, decoration vendors | Mostly covered (1.0) |
| Textile weavers / powerloom job workers | R13 garments, job work, karigar accounts | Loom-wise production, yarn bank | Mostly covered (1.0) |
| Chit funds / NBFC-like lenders | Loans module (8H) | Chit Funds Act registers, RBI returns | ⛔ regulated lending, out of scope |

**Why solar.**
1. **Size, and new businesses every month.** PM Surya Ghar: Muft Bijli Yojana (approved 29 Feb 2024, outlay ₹75,021
   crore, to run till FY 2026-27, **P** guideline 1(a)) is installed only through vendors registered on the National
   Portal (P 7(a)). Reports put the registered vendors at **34,219** (29,469 active) and installations at **26 lakh by
   March 2026** (₹17,967 crore CFA) and about **40 lakh by May 2026** (S, SolarQuarter / ministerial statements; the
   figures disagree, SO34). Most vendors are proprietorships and small firms of 2–20 people that started in 2024–2026,
   often electricians and electrical contractors moving into solar, plus PM-KUSUM solar-pump vendors and small C&I
   (commercial and industrial) EPC contractors.
2. **The money is unusual and easy to get wrong.** A solar system supplied with installation is taxed by a **deemed
   split**: 70 % of the gross consideration as goods (5 % from 22 Sep 2025, 12 % before) and 30 % as an installation
   service (18 %) (S, N 9/2025-CT(R) Sch I S. No. 437 Explanation read with N 11/2017-CT(R) S. No. 38; SO1). That is
   8.9 % blended, but GSTR-1 needs **two HSN / SAC rows**, the e-Way bill only the goods, and an advance only the
   service share taxed (SO7, SO8). A general app makes the user type two lines by hand and work the percentages out;
   myBillBook added a single "8.9 %" rate in Jan 2026 (V), which puts the whole value under one HSN.
3. **The subsidy decides the customer's cash flow, and nobody tracks it.** The CFA (₹30,000 / kW for the first 2 kW,
   ₹18,000 for the third, **P** 5(h)) is paid by the Government into the **consumer's** account (or loan account) about 15
   days after the DISCOM inspects the system (P 6(k), 6(p), 6(s), 6(t)). Most vendors quote "net of subsidy" and collect
   the subsidy amount from the customer after it is credited. Vendors therefore chase dozens of jobs through survey,
   installation, portal upload, DISCOM inspection, net meter, e-token and credit, in Excel or WhatsApp. Specialist CRMs
   track the stages (V, SolarFlow, QuickEstimate) but do no GST or books.
4. **The app already holds most of the hard parts.** Kits with BOMs, serials and warranty months, quotations, advances,
   AMC schedules, RA bills with retention / 194C / GST TDS, pure-agent lines, follow-ups, attachments and batch issue.
   Round 22 is the solar glue: the job file, the 70:30 contract line, the CFA rule rows, the stage and money tracker, the
   handover pack and the CMC, plus KUSUM work orders. That fits ≤ 29 kB of core once the budget allows (§1.4).
5. **Scheme risk is contained.** If PM Surya Ghar ends on 31 Mar 2027 (P 1(a)) or changes, the 70:30 contract, jobs,
   serials, CMC and C&I EPC still serve every installer; CFA rows are date-keyed and simply stop applying (§12).

### 1.2 What a solar installer cannot do in the app today

Checked against the code at `a711585` (§2.6):

1. **No 70:30 contract.** The editor bills a kit at its item slab. Nothing deems 70 % goods / 30 % service, takes the
   goods rate by date (5 % / 12 % / 5 %), puts the service share on SAC with 18 %, or keeps the two shares summing to the
   contract price. Users type two lines and a percentage by hand, and quote GST-inclusive prices they then back-compute.
2. **No job.** A rooftop job has a DISCOM, a consumer number, a sanctioned load, a portal application number, a DC
   capacity (kWp) and inverter size, a scheme (PM Surya Ghar, State scheme, KUSUM, none), a segment (household, RWA /
   society, C&I, pump) and about ten dated stages. Nothing holds them, and no invoice, advance, purchase or CMC points
   at a job.
3. **No subsidy estimate.** Nothing computes the CFA by capacity, special-category State and RWA household count, or
   warns that non-DCR modules, an off-grid system, a relocated system or capacity above 3 kW changes it.
4. **No "collect after subsidy".** The customer's balance that waits for the CFA credit looks like any overdue debt;
   nothing ties it to the inspection, e-token and credit dates, and nothing knows when the CFA goes to a loan account
   instead.
5. **No serial / DCR proof per job.** Serials exist on invoice lines, but nothing checks that every module of the job
   is listed, records the DCR certificate per lot or flags ALMM List-II for installations from 1 Jun 2026 (S).
6. **No 5-year CMC.** Every PM Surya Ghar vendor owes free repairs / maintenance for 5 years from commissioning (P
   7(d)). The AMC module could hold it, but nothing creates the contract at commissioning or links complaints to the job.
7. **No KUSUM work orders.** Solar-pump vendors bill a State agency per pump under a work order, with retention, 194C
   and GST TDS deducted, sometimes with the farmer's share collected separately. Works RA bills are per contract, not per
   pump, and there is no batch bill of the month's installed pumps.
8. **No job profit.** Purchases are not tagged by job, so cost per kWp and margin per job are guesses.

### 1.3 How the solar profile switches on (no clutter for others)

- **No new `BusinessType`.** `shop-mode.ts` (first paint) is untouched. The profile is a **wizard card** (the R12 / R13
  / R18 / R19 / R21 pattern), "Solar installer, EPC contractor or solar-pump vendor", that sets business type
  **`contractor`** (its preset: purchases, inventory, accounts, banking, reports, gst, tds, payroll, time) and writes
  **explicit** `modules` (the preset ∪ `recurring`, so the AMC / CMC tile and reminders show) and an **explicit**
  `industry_packs` list, so the `works` pack implied by `contractor` (`PACK_OF_TYPE`) is on only for EPC.
- Settings field **`solar_kind`** (additive; the R12 `agri_kind` … R21 `fuel_kind` approach):

  | `solar_kind` | Who | Packs | Lands on | Why |
  |---|---|---|---|---|
  | `rooftop` | Residential rooftop vendor (PM Surya Ghar, State schemes, no-subsidy homes, RWAs) | `solar` | `/time?tab=solar&view=jobs` | Jobs, 70:30 bills, subsidy tracker, CMC |
  | `epc` | C&I rooftop / ground-mount EPC contractor | `solar`, `works` | same | + RA bills with retention and deductions |
  | `pumps` | Solar-pump vendor (PM-KUSUM, State agencies) | `solar`, `kusum` | `/time?tab=solar&view=kusum` | + work orders, per-pump batch bills |
  | `multi` | Rooftop + EPC (+ pumps ticked) | `solar`, `works` (+ `kusum`) | jobs | The common combination |

- **Two new packs** `solar`, `kusum` in `industry-packs.ts` (lazy; `PackId` is a type, zero bytes). `PACK_OF_TYPE`,
  `PACK_OF_TYPE_INLINE` and `PACK_ROUTES` are unchanged.
- **Placement: one desk, never a new route or sidebar item.**
  - One new row in `TIME_TABS` (`page-tabs.ts`): `{ id: 'solar', pack: 'solar', alsoPacks: ['kusum'] }` (job-based
    service desks live on Time: R15 `trips`, R17 `deploy`, R19 `shipments`).
  - The desk `components/solar/SolarDesk.tsx` is mounted from `Time.tsx` by file name through `import.meta.glob` over
    `components/solar/*Desk.tsx` (the R14 / R17 / R19 precedent).
  - **Eight views** in `&view=`, mounted by file name through `import.meta.glob` over `components/solar/*View.tsx`:
    `jobs`, `quote` (A); `money`, `subsidy` (B); `install`, `cmc` (C); `kusum` (D, pack `kusum`), `statutory` (D). A
    view whose pack is off is not listed (its URL still opens it). C&I RA bills stay on the existing Works tab (pack
    `works`); D1 adds the split there, not a view.
- Settings → Features shows a **"Solar profile"** row for every `contractor` company (and "Custom"). Turning a pack off
  deletes nothing.

### 1.4 Budgets the round must respect, and why P may come first

Baseline: `docs/PROGRESS.md` row #127 on `a711585`: first paint **177.4 kB**, core **3,285.2 kB**. The PRD author did
not rebuild; **R22-A measures the baseline before its first commit** (after PERF-7 merges) and records it in
`docs/features/solar-r22.md`.

| Budget | Now | Limit | Headroom | Still held | Round 22 share |
|---|---|---|---|---|---|
| Initial JS (first paint) | **177.4 kB** | 185 kB | 7.6 kB | 0 | **0** (the `so` record-key token lands in the lazy `invoice-defaults` chunk, as `fu` did) |
| Entry chunk | ≈ 89.0 kB | 100 kB | ≈ 11 kB | 0 | 0 |
| Core precache (English) | **3,285.2 kB** | 3,300 kB | **14.8 kB** | **R20-C 7 kB** (if still planned) | **≤ 29 kB gross + 1 kB lead reserve = 30 kB**, only after PERF-7 (and R22-P if needed) |
| Hindi pack | ≈ 389 kB | 400 kB | ≈ 11 kB | R20-C ≈ 2 kB | ≤ 7 kB (`lang-hi-solar` family pack) |
| Hindi left in English chunks | ≈ 9.8 kB | 36 kB | ≈ 26 kB | 0 | **0** (literal `defineArea(en, hi)` everywhere) |
| `lazy-leaves` / `lazy-leaves-ui` | ≈ 18.6 / 27.7 kB | 20 / 28 kB | ≈ 1.4 / 0.3 kB | 0 | ≤ 0.3 kB in `lazy-leaves` (`so-registry.ts` only); **0 in `lazy-leaves-ui`** (desk views must be > 2,500 B or import the family, so they never join it) |

**The arithmetic.** 14.8 kB headroom + PERF-7 (≥ 15 kB) = ≈ 29.8 kB. Less R20-C's 7 kB (if it is still planned) and the
lead's 5 kB reserve, ≈ 17.8 kB is left: not enough for 29 kB. So:

**Gate and stop rule (no asking).** At R22-A's first commit the lead computes
`room = 3,300 − core (measured after PERF-7) − (R20-C cap if not merged and still planned) − 5`.
- `room ≥ 29`: no P; A, B, C, D at their caps.
- `room < 29`: **R22-P runs first**, target `29 − room` (at most 15 kB, §4 R22-P), then `room` is recomputed.
- After P, Round 22's cap is `min(29, room)`. If `room < 29`, packages cut in §3 order; if `room < 22`, **package D
  moves to Round 23** (C&I RA bills keep the A4 split typed by hand on the Works tab; KUSUM is not shipped); if
  `room < 15`, **C moves too** (A + B ship: jobs, quote, 70:30 bill, subsidy and money tracker).

Calibration (English only, `docs/features/fuel-r21.md`): R21-A **+7.7 kB** (cap 8; first build +10.9 until its views
and writers moved into the desk chunk); R21-B **+11.5** (cap 7, still over after both cuts); R21-C first build +9.3,
still over 7 after both cuts (A's shared helpers split into their own chunk once a second view used them); R21-D first
build **+14.2**, +6.1 only after cutting two of its four items (LPG and the OMC account). R19-D +11.1 (cap 9). So:
**≈ 2.5 kB per item with a view, ≈ 1.2 kB per engine-only item, + ≈ 0.7 kB hash churn per package, + ≈ 2 kB when a
package splits a helper out of the desk chunk.** Two rules follow for Round 22:
- **A places every helper a second view will need** (job form, split preview, stage chips, settings reader) in the desk
  chunk from its first commit, and B–D import them from there; a package never makes a helper "shared" by importing it
  from a second chunk without measuring the split.
- Round 22 plans **16 items** (4 per package), but the lowest item of each package is a **pre-planned cut** (§3), so
  the expected outcome is 12–14 items at the caps. A package that reaches its cap cuts; it does not ask. The lead
  checks the measured number at each merge, not the plan.

Rules:
- **First paint.** Nothing. `store/invoice-defaults.ts` (the `so` token), `industry-packs.ts`, `page-tabs.ts`,
  `Time.tsx`, `TemplateEngine.tsx`, `NotificationBell.tsx` and the editor route are lazy on `a711585` (A re-checks
  `build-meta/chunks.json`: the initial files are `index`, `rolldown-runtime`, `vendor-react`, `vendor-ui`). No
  `PACK_ROUTES`, `PACK_OF_TYPE`, `TABLE_ACTIONS`, `WATCHED_TABLES`, `no-cash.ts`, `tax-rules.ts`, `tds-rules.ts`,
  `ita2025.ts`, `shop-mode.ts`, `dates.ts` or shell edit. Any new lucide icon is refused (§1.5).
- **Family chunk group.** A adds **one row** to `vite.config.ts`:
  `safeFamilyGroup(graph, 'f-solar', familyRe('solar', 'solar-rules', 'solar-r22', 'so-registry'), 12)`
  and the name to `tests/bundle-config.test.ts` (the R19 / R21 test shape: the regex captures `src/lib/solar/so-split.ts`,
  `src/lib/solar-rules.ts`, `src/i18n/areas/solar-r22a.ts`; not `so-registry.ts` and not `-pick` areas).
  - **Engines in `src/lib/solar/` import only first-paint modules** (`storage`, `invoice-calc`, `dates`, `access`,
    `localDb` …), `solar-rules.ts` and each other.
  - Shared lazy code is reached only through **bridge modules `so-*-io.ts`** (≤ 4), which stay outside the group:
    - `so-issue-io.ts`: `localDb.invoices.saveMany`, quotation conversion, `advances.ts`, receipts, follow-ups;
    - `so-stock-io.ts`: `events-kits.ts` (kit BOMs), `stock-tracking.ts` (serials in stock / sold), `inventory.ts`
      inputs, `purchase-normalize.ts` `readPurchase` (job costs);
    - `so-tax-io.ts`: `tax-rules.ts` slabs, `works/deductions.ts` (retention, 194C, GST TDS u/s 51), `tds-rules.ts` /
      `ita2025.ts` labels, the `eway.ts` hook;
    - `so-recv-io.ts`: `amc.ts` (CMC contracts and reminders), ageing / credit helpers, the bell gate helper.
    Engines take their data as arguments.
  - After each package `build-meta/chunks.json` must show `f-solar` holding every engine and the rules module; a test in
    `tests/so-rules.test.ts` reads the family regex and the import graph.
- **Hindi.** One area per package, each `defineArea(en, hi)` with a **literal** Hindi object: `solar-r22a.ts` …
  `solar-r22d.ts`, ≤ 1.0 kB gz English each. Shared words (solar plant, panel / module, inverter, kW, subsidy, DISCOM,
  net meter, installation, commissioning, job, stage, CMC) live once in `solar-r22a.ts`. Use the words installers use:
  सोलर प्लांट, पैनल, इन्वर्टर, सब्सिडी, नेट मीटर, डिस्कॉम, इंस्टॉलेशन, कमीशनिंग.
- **Help** ≤ 160 characters per topic per language; statutory detail by CA id (`ca: ['SO1']`). The new tab needs a
  topic in `src/lib/help/topics-packs.ts` and its Ctrl+K title in `src/i18n/areas/discover-r6-tabs.ts`
  (`tests/help-registry.test.ts`); each view's Ctrl+K row is a `PACK_TABS` row (labels `r22.*`).
- **Rule data is a chunk.** Statutory and scheme values go in **`src/lib/solar-rules.ts`** (new), imported only by lazy
  solar modules, never by `tax-rules.ts`, `tds-rules.ts`, `shop-mode.ts` or the shell. Values that already live
  elsewhere stay there and are reached through `so-tax-io.ts`: GST slabs (`tax-rules.ts`), 194C / 194Q (`tds-rules.ts`),
  Act labels (`ita2025.ts`), GST TDS u/s 51 and retention (`works/deductions.ts`).
- **No new shared components, no stubs.** Reuse `LinesGrid`, `ItemFilterBar`, `controls.module.css`, the R15 `useRun`
  pattern, `AttachmentsPanel` (photos and DCR certificates), `escHtml` for every print window, `csv.ts` / dynamic
  `xlsx.ts` with `import-mapping.ts` for serial and work-order imports, `localDb.invoices.saveMany` for every batch.

### 1.5 Icons

Every lucide icon is in the first-paint `vendor-ui` chunk; reuse only. Files importing each on `a711585` (single-line
import grep; multi-line imports add more): `FileText` 13 + 4, `ShieldCheck` 12, `Landmark` 12 + 1, `Receipt` 11 + 2,
`Wallet` 11, `ClipboardList` 10, `CalendarClock` 10, `HandCoins` 10 + 1, `Users` 10 + 2, `Building2` 8 + 1, `Boxes` 7 + 1,
`Tags` 6, `Zap` 3, `Calculator` 3, `Banknote` 3 + 3, `Sun` 0 + 1 (`DashboardLayout.tsx`). The desk uses `Sun` (desk tab),
`ClipboardList` (jobs), `Calculator` (quote), `Wallet` (money), `Landmark` (subsidy), `Tags` (install: serials),
`ShieldCheck` (CMC), `Zap` (KUSUM pumps), `FileText` (statutory), `Building2` (RWA / C&I chip), `HandCoins` (collect
after subsidy). **`SolarPanel`, `PanelTop`, `BatteryCharging`, `Gauge`, `Wrench`, `Hammer`, `Home`, `Sprout` and
`Droplets` are imported nowhere and must not be added.** A re-greps before its first commit and substitutes
`ClipboardList` for any name that turns out not to be imported.

### 1.6 Non-goals

- **Live connections.** National Portal (applications, e-tokens, vendor rating), DISCOM portals (feasibility, net-meter
  requests), State-agency KUSUM portals, NISE / ALMM lookups, Jan Samarth loans, inverter monitoring clouds, GST portal,
  payment gateways.
- **System design.** Shadow analysis, string sizing, generation simulation, BOM optimisation (design tools do this;
  the app takes kWp, module count and Wp as typed).
- **Power sale.** RESCO / PPA / OPEX models where the installer sells electricity (electricity is exempt; a different
  business), open-access and captive-plant accounting, REC trading.
- **Consumer side.** The customer's own CFA claim, net-metering bills and savings, accelerated depreciation in the
  customer's books.
- **Utility-scale.** Ground-mount projects above a few MW, CPSU / SECI tenders, transmission works, bank-guarantee
  management beyond an expiry date.
- **Deferred:** solar street lights and lanterns as their own flow (they bill as ordinary items), solar water heaters'
  own split (SO29), battery-only (BESS) contracts, EV chargers.

---

## 2. Findings

### 2.1 What the leaders offer (research)

| Product | What it does for solar installers | Gap for this app's users | Source |
|---|---|---|---|
| myBillBook (Jan 2026 changelog) | A single "solar 8.9 %" GST rate | One HSN for the whole value; no 70:30 lines, no subsidy, no jobs | V knowledge.mybillbook.in changelog (search extract, R21 §2.1) |
| SolarFlow (Fuzen) | Subsidy tracker: portal status, net-meter status, expected vs received subsidy dates, mismatch flags | CRM only; no GST bill, books or stock | V fuzen.io/posts/solarflow_subsidy_tracker |
| QuickEstimate (CRM) | Quote with central subsidy applied by size and DISCOM; branded PDF; 10-step installation milestones | Cloud; free plan limited; no GST split, books or stock | V quickestimate.co |
| Sunbase, other solar CRMs | Lead-to-installation pipeline, proposals, India-specific forms | Cloud; per-user pricing; no GST returns | V sunbasedata.com blog |
| Vyapar / Zoho Books / TallyPrime | General billing, stock, GST returns | No 70:30 helper, no job stages, no subsidy, no CMC per job | V / P (TallyPrime 7.0 release notes read in R21) |

No product page read this round combines the 70:30 bill, the subsidy stages, serial / DCR proof and the CMC.

### 2.2 Candidate rounds scored

Value 1–4 (number of businesses × how badly the app fails them today × statutory content the app can model safely),
effort S = 1, M = 2, L = 3; score = value ÷ effort. Reuse and size cost are folded into effort; risk is in the verdict.

| Candidate | Size (as reported) | Already in the app | Pain removed | Safe to model | Value | Effort | Score | Risk |
|---|---|---|---|---|---|---|---|---|
| **Solar installers / EPC / pump vendors** | 34,219 registered PM Surya Ghar vendors (S); KUSUM vendors per State | Kits, serials, quotations, advances, AMC, works pack, pure agent | 70:30 bill, subsidy chase, CMC duty | Yes: one deemed-split rule + scheme hints | **4** | M | **2.0** | Scheme end FY 2026-27 (contained, §12) |
| Cab and tour fleet operators | Many small owners (no count found) | R5-B vehicles / trips, R15 travel | Duty slips, RCM / option rates | Yes | 3 | M | 1.5 | Aggregator payouts vary |
| Coaching / hostels | Many | R5-C fees, R10 classes | Hostel allotment | Partly | 2 | S–M | 1.3 | Low |
| Automobile dealers | FADA networks (S, R19) | 206C(1F), R9 / R10 | OEM schemes | Partly | 2 | M | 1.0 | OEM DMS mandatory |
| IT / SaaS exporters | Small here | R14 `svcexport`, recurring | Metering, SOFTEX | Partly | 2 | M | 1.0 | Low |
| Event venues / banquet halls | Many | R7, R15 events | Session calendar | Little new | 1 | S | 1.0 | Low |
| Textile weavers / job workers | Many clusters | R13 garments, job work | Loom production | Little new | 2 | M | 1.0 | Low |
| Chit funds / NBFC-like lenders | - | Loans | Regulated registers | No | - | - | ⛔ | Regulated |

### 2.3 Anatomy of a rooftop job (every element needs a place)

| # | Element | Doc / screen | Today | → |
|---|---|---|---|---|
| 1 | Enquiry: customer, DISCOM, consumer number, sanctioned load, roof, monthly bill | Job | Client only | A2 |
| 2 | Survey and sizing: kWp (modules × Wp), inverter kW, structure, battery (hybrid), DCR modules for CFA | Job, quote | - | A2, A3 |
| 3 | Quote: price (GST-inclusive for homes), 70:30 shares and tax, subsidy estimate, net cost, loan option | Quotation `QTN` | Quotation without split | A3, A4 |
| 4 | Booking advance (often 10–30 %) | Advance receipt | Advances (no split) | B1 |
| 5 | Portal application, DISCOM feasibility (deemed ≤ 10 kW, P 6(h)), vendor selection, agreement | Job stages | - | A2 |
| 6 | Material: kit from stock (modules, inverter, structure, cables, ACDB / DCDB, earthing, LA), serials | Stock, challan / e-Way | Kits, serials | A4, C1 |
| 7 | Installation; tax invoice with the 70:30 split and the serial annexure | Contract bill | Two hand-typed lines | A4, B1 |
| 8 | Portal upload with geo-tagged photos, DISCOM inspection, net meter, commissioning | Job stages, attachments | Attachments only | B2, C1 |
| 9 | E-token activated with the CFA amount, redeemed; CFA credited to consumer or loan account | Subsidy tracker | - | B2 |
| 10 | Balance collection (the "subsidy part" from the customer, loan disbursement from the bank) | Receipts, reminders | Receipts | B2, B3 |
| 11 | Handover: warranty card, serials, DCR list, CMC terms | Handover print | - | C2 |
| 12 | 5-year free CMC: visits, complaints, OEM warranty claims | CMC | AMC (unlinked) | C3 |
| 13 | DISCOM fees paid in the customer's name; net meter bought by the vendor | Pure agent / contract line | Pure-agent lines | B4 |
| 14 | C&I EPC: RA bills, retention, 194C / GST TDS | Works RA bills | RA bills (no split) | D1 |
| 15 | KUSUM: agency work order, per-pump bills in batches, agency deductions, farmer share | Work orders | - | D2 |
| 16 | Registrations: National / State vendor registration, bank guarantee, electrical contractor licence | Statutory list | - | D3 |
| 17 | Job profit: purchases by job, cost per kWp | Profit | - | D4 |

### 2.4 Statutory and scheme rules (as understood; every row is a CA item)

Rows marked `verified: true` were read in a primary text this round. All others are `verified: false` and are hints or
defaults the CA must confirm.

| # | Rule | Value | Source | Rule row (`solar-rules.ts`) | verified | CA |
|---|---|---|---|---|---|---|
| R1 | A solar power generating system (entry 437 goods) supplied with other goods and services, one of which is an entry-38 service (construction / engineering / installation / technical services): goods value deemed **70 %** of the gross consideration, the service **30 %** | Contract split | S taxguru (quotes the Explanation), taxgarden, taxheal; N 9/2025-CT(R) Sch I S. No. 437 Expl., N 11/2017-CT(R) S. No. 38 (as amended) | `SOLAR_SPLIT_RULES` `{ from: '2025-09-22', goods_pct: 70, goods_rate: 5, svc_rate: 18 }` | **false** | SO1 ★ |
| R2 | Earlier rows: 70:30 from 1 Jan 2019 (N 24/2018-CT(R)) with goods at 5 %; goods 12 % from 1 Oct 2021 (N 8/2021-CT(R)); before 2019 no deemed split | Rows by date; before 2019 the editor asks for the split | S taxheal, taxgarden, AAR summaries | `SOLAR_SPLIT_RULES` earlier rows; `{ from: '2017-07-01', goods_pct: null }` | **false** | SO2 ★ |
| R3 | Standalone supplies: modules / panels 5 % (Sch I S. No. 437(h)); inverters 8504 18 % (Sch II S. No. 477); steel structures 7308 18 % (Sch II S. No. 286); installation only 18 % (S. No. 38); solar water heater 5 % (Sch I S. No. 428) | Hints when "supplied with installation" is off | S taxgarden | `SOLAR_STANDALONE_HINTS` | **false** | SO6 ★, SO29 |
| R4 | CFA (PM Surya Ghar, residential, from 13 Feb 2024): ₹30,000 / kWp for the first 2 kWp, ₹18,000 / kWp for the next 1 kWp, nothing beyond 3 kWp; special-category States ₹33,000 / ₹19,800; GHS / RWA common facilities ₹18,000 (₹19,800) per kWp up to 500 kWp at 3 kWp per house | Subsidy estimate | **P** MNRE guidelines, CFA to residential consumers, 5(h) (copy hosted by JBVNL, June 2024 text) | `PMSG_CFA_RULES` `{ from: '2024-02-13', first2: 30000, next1: 18000, cap_kw: 3, special: [33000, 19800], rwa_per_kw: 18000, rwa_special: 19800, kw_per_house: 3, rwa_cap_kw: 500 }` | **true** (2024 text) | SO11 |
| R5 | Special-category States / UTs: Uttarakhand, Himachal Pradesh, J&K, Ladakh, the North-East incl. Sikkim, A&N, Lakshadweep | State codes 05, 02, 01, 38, 11–18, 35, 31 | **P** 5(g) | `PMSG_SPECIAL_STATES` | **true** (list); code mapping is the developers' | SO12 |
| R6 | CFA on the DC module capacity, not the inverter (5(k)); extra components (battery, tracker) do not add CFA (5(l)); **DCR modules required** (5(m)); pre-existing CFA capacity counts towards 3 kW (5(n)); once only, relocated systems not eligible (5(o)); off-grid not eligible (6(o)); "Give It Up" without DCR (5(p)) | Eligibility hints on the job and quote | **P** 5(k)–(p), 6(o) | `PMSG_ELIGIBILITY_RULES` | **true** | SO13 |
| R7 | Process: deemed feasibility ≤ 10 kW (6(h)); DISCOM inspection before CFA (6(k)); e-token activated after inspection (6(p)); CFA to the loan account up to the outstanding loan when a loan was taken (6(s)(i)); CFA processed within 15 days of DISCOM approval (6(t)) | Stage list, "CFA expected by" date, "collect after subsidy" logic | **P** 6(h), (k), (p), (s), (t) | `PMSG_PROCESS_RULES` `{ cfa_days: 15, deemed_feasible_kw: 10 }` | **true** | SO10, SO31 |
| R8 | Registered vendors repair / maintain the plant **free for 5 years** (CMC) from commissioning; OEM warranties passed to the consumer (7(d)) | CMC contract created at commissioning | **P** 7(d) | `PMSG_CMC_RULES` `{ years: 5 }` | **true** | SO15 |
| R9 | Scheme to be implemented till FY 2026-27 (1(a)); a revised guideline dated 13 Feb 2025 is listed by MNRE (not read) | CFA rows end 2027-03-31 unless a new row is appended | **P** 1(a); S MNRE listing | `PMSG_CFA_RULES` `to: '2027-03-31'` | **true** (2024 text) | SO11 |
| R10 | ALMM List-II (cells) applies to PM Surya Ghar CFA installations from 1 Jun 2026; earlier commissioning exempt; "Give It Up" installs exempt till 31 Mar 2027 if applied through the portal | Hint on the install check | S SolarQuarter (Jul 2025), TaiyangNews, Angel One (2026) | `ALMM_CELL_RULES` `{ from: '2026-06-01' }` | **false** | SO14 |
| R11 | PM-KUSUM Component B: CFA 30 % of benchmark or tender cost; State ≥ 30 %; farmer the rest; scheme extended to 31 Mar 2027 (reported) | Work-order share hints | S Vikaspedia, Drishti (Apr 2026), press | `KUSUM_SHARE_HINTS` | **false** | SO23, SO26 |
| R12 | GST TDS u/s 51: 2 % by Government departments / agencies on contract value above ₹2.5 lakh | Existing works deductions | existing R5-B5 rows | reused (`works/deductions.ts`) | as existing | SO25 |
| R13 | 194C on business customers' payments: 1 % individual / HUF, 2 % others; single ₹30,000 / year ₹1 lakh; Sec 393 Table S. No. 6 from 1 Apr 2026 | Existing TDS rows, labels by date | existing `tds-rules.ts` / `ita2025.ts`; S taxgarden | reused | as existing | SO20, SO36 |
| R14 | 194Q on purchases (buyer turnover > ₹10 crore, > ₹50 lakh from one seller, 0.1 %) | Existing hint on module purchases | existing rows | reused | as existing | SO21 |
| R15 | Composition 6 % (N 2/2019-CT(R)) for suppliers of services with turnover ≤ ₹50 lakh; no inter-State supply, no ITC | Hint only for a solar contractor | existing composition rows; S taxgarden | reused | as existing | SO22 |
| R16 | Pure agent (Rule 33): DISCOM fees paid in the customer's name, recovered at actual | `charge_head_id: 'rule33'` | existing R8 / R14 rows | reused | as existing | SO18 |
| R17 | National-level vendor registration asks for a bank guarantee (₹25 lakh reported) | Statutory list due date only | S energetica-india | `VENDOR_REG_HINTS` | **false** | SO32 |

### 2.5 What changed in 2023–2026 for these businesses

- **13 Feb / 29 Feb 2024:** PM Surya Ghar CFA in force; vendors register on the National Portal; DCR modules required;
  5-year free CMC (P).
- **2024–2025:** DISCOM incentive guidelines; States waive net-meter fees for PM Surya Ghar homes (e.g. HERC order 10 Jun
  2025, S); Gujarat net-metering 5th amendment (4 Nov 2025, S). The app records fees typed per job (B4).
- **13 Feb 2025:** a revised CFA guideline listed by MNRE (S; not read). R4 stays dated to the 2024 text until read.
- **22 Sep 2025 (GST rationalisation):** entry 437 goods 12 % → 5 %; the 70:30 Explanation moved to N 9/2025-CT(R); the
  blended rate fell from 13.8 % to 8.9 % (S). Contracts straddling the date: the invoice date decides (SO2).
- **1 Apr 2026:** Income-tax Act 2025 labels for 194C (Sec 393 Table S. No. 6) and 194Q; already date-keyed in
  `ita2025.ts`.
- **May 2026:** AP High Court (Tata Power Renewable Energies) on solar EPC as a composite supply at the concessional
  rate even with separate invoices (S, livelaw / taxscan): a note for SO1, no rule row.
- **1 Jun 2026:** ALMM List-II for cells in force for new CFA installations (S).
- **2026:** PM-KUSUM deadline reported extended to Mar 2027 and a "KUSUM 2.0" discussed before Budget 2026 (S): pending
  notes, not rule rows.

### 2.6 Verified against the code (`a711585`)

| Claim | Where |
|---|---|
| A kit is sold as one line; its default BOM's components leave stock on the sale | `src/types/stock.ts` `StockItem.kit`; `src/lib/events-kits.ts` `kitTable`, `kitStockEvents` |
| Serials and warranty months on invoice lines; serials in stock / sold per item | `src/types/invoice.ts` `InvoiceItem.serials`, `warranty_months`; `stock-tracking.ts` `serialsInStock`, `serialsSold`, `warrantyUntil` |
| Quotations exist (`QUOTATION`, prefix `QTN`) and convert | `src/types/invoice.ts` `DocumentType`, series map |
| Advances with refunds, applied by `advance_id` | `advances.ts` `saveAdvance`, `openAdvancesFor`, `invoiceOpen` |
| AMC contracts with visit schedule and reminders (table `amc_contracts`); shown on the Dashboard tile `amcDue` (module `recurring`) | `amc.ts`; `components/amc/AmcPanel.tsx`; `shop-presets.ts` `TILE_MODULE` |
| RA-bill deductions: retention, mobilisation advance, 194C, GST TDS u/s 51, BOCW | `works/deductions.ts` |
| e-Way JSON leaves non-GST lines out (R21); no hook for a service share | `eway.ts` `buildEway` (`nonGst` set) |
| e-Invoice marks service lines by HSN (`IsServc` from `isServiceHsn`) | `einvoice.ts` |
| `contractor` preset = purchases, inventory, accounts, banking, reports, gst, tds, payroll, time (no `recurring`); `PACK_OF_TYPE.contractor = ['works']` | `shop-presets.ts`, `industry-packs.ts` |
| Time desks are rows of `TIME_TABS` mounted by file name | `src/pages/page-tabs.ts`, `Time.tsx` |
| No `src/lib/solar`, no 70:30 code; `so` is not a record key | grep `solar\|70:30\|seventy` over `src/` (no hits in code) |
| `SO` is unused as an id prefix; `SL` too | grep `\bSO[0-9]+`, `\bSL[0-9]+` over `docs/`, `src/`, `tests/` (no hits) |

### 2.7 Size measurements

Not rebuilt by the author (§1.4 uses `docs/PROGRESS.md` #127). R22-A (or R22-P when it runs) rebuilds first, after
PERF-7 merges, and every package records before / after (initial, entry, core, Hindi pack, Hindi in core, `f-solar`,
`SolarDesk`) in its section of `docs/features/solar-r22.md`.

### 2.8 Sources

Primary (read this round):
- **P** MNRE, *Guidelines for PM-Surya Ghar: Muft Bijli Yojana, Central Financial Assistance to Residential Consumers*
  (June 2024 text; copy hosted at jbvnl.co.in/SOLAR/Operational Guidelines to PM Suryaghar 7 June 24.pdf, downloaded,
  57 pages, text extracted with `pdftotext`): 1(a) outlay and term; 5(g) benchmark and special-category States; 5(h) CFA
  slabs and examples; 5(k)–(p) eligibility; 6(h)–(t) process; 7(a)–(e) vendor registration, 5-year CMC, penalties.
- **P** This repository at `a711585` (§2.6), `docs/prd/round-19.md` §1.1 / §2.2, `docs/prd/round-21.md` §2.2 / §13,
  `docs/PROGRESS.md`, `docs/qa/performance.md` PERF-6.

Secondary:
- **S** taxguru.in, *GST on design, supply, installation and commissioning (DSIC) of solar power plant* (17 Dec 2025):
  quotes the Explanation to Sch I S. No. 437 of N 9/2025-CT(R) and S. No. 38 of N 11/2017-CT(R).
- **S** taxgarden.in, *Income tax and GST for solar panel installers (rooftop EPC), AY 2026-27*: 70:30 at 5 % / 18 %
  (8.9 %), standalone rates and entry numbers, 12 % before 22 Sep 2025 (N 8/2021), 44AD, 194C / Sec 393.
- **S** taxheal.com (May 2026) on the 70:30 split (N 24/2018); taxscan / livelaw / taxo.online on the AP High Court
  rulings (Jan and May 2026); AAR summaries (Gujarat 2021, Karnataka 2019) on gstcouncil.gov.in listings.
- **S** SolarQuarter (Mar 2026: 26 lakh installations, ₹17,967 crore CFA; Sep 2026 guideline note; Jul 2025 ALMM
  List-II amendment); Swarajya / press on 40–50 lakh installations; vendor counts (8,000 at launch, 34,219 later).
- **S** TaiyangNews, Angel One, energetica-india (2026) on ALMM List-II from 1 Jun 2026 and its exemptions.
- **S** Vikaspedia, Drishti IAS (Apr 2026), Business Standard (Oct 2025) on PM-KUSUM shares and the extension.
- **S** energetica-india on the national vendor-registration bank guarantee; HERC (10 Jun 2025) and GERC (Nov 2025)
  net-metering changes.

Vendor claims:
- **V** SolarFlow (fuzen.io), QuickEstimate (quickestimate.co), Sunbase (sunbasedata.com) feature pages.
- **V** myBillBook changelog (Jan 2026, "solar 8.9 %"; search extract, R21).

---

## 3. Ranked list: what to build now

Ranked by value to an installer ÷ size. Cuts are pre-ranked per package (last cut first). Sizes are core gz kB.

| Rank | Item | Pkg | Value | Size | Cut order |
|---|---|---|---|---|---|
| 0 | Core reclaim, only when `room < 29` after PERF-7 | P | gate | −(29 − room) | never when it runs |
| 1 | Profile card, packs, `solar_settings`, registry, rules file, `f-solar` group, desk shell | A | 4 | 2.2 | never |
| 2 | Jobs: `solar_jobs`, stages, pipeline view, CFA expected | A | 4 | 2.2 | never |
| 3 | System kits + quote calculator (kWp, price in / ex GST, CFA, net cost) on the quotation | A | 4 | 1.8 | A cut 2 drops the quotation print block (calculator stays) |
| 4 | The 70:30 contract line (`soSplit`), e-Way hook, paper part, demo rows | A | 4 | 1.8 | A cut 1 drops demo rows |
| 5 | Job bill (one `saveMany` write) + advances with the service-share tax + milestone plan | B | 4 | 2.0 | never |
| 6 | Subsidy and loan tracker: e-token, credit, "collect after subsidy", loan account case | B | 4 | 1.8 | never |
| 7 | Money pipeline by stage + bell gate `solar` | B | 3 | 1.4 | B cut 1 drops the bell (list only) |
| 8 | DISCOM fees as pure agent; net meter line inside the gross | B | 2 | 0.8 | B cut 2 |
| 9 | Installation record: serial count check, DCR per lot, ALMM hint, photo checklist | C | 4 | 1.8 | never |
| 10 | Handover pack print (warranty card, serials, DCR, CMC terms) | C | 3 | 1.4 | C cut 2 |
| 11 | 5-year CMC: `amc_contracts` row at commissioning, complaints, OEM claims | C | 4 | 1.6 | never |
| 12 | CMC provision (per kWp) journal, off by default | C | 2 | 1.0 | C cut 1 |
| 13 | C&I EPC: 70:30 on works RA bills | D | 3 | 1.2 | never (D as a whole moves at `room < 22`) |
| 14 | KUSUM work orders + per-pump batch bills (`saveMany`) + agency deductions | D | 3 | 2.4 | never |
| 15 | Statutory list: vendor registrations, BG, electrical licence, ALMM check; bell notices | D | 2 | 1.0 | D cut 2 (list without bell notices) |
| 16 | Job profit: purchases by job, cost per kWp, days per stage | D | 2 | 1.4 | D cut 1 |

---

## 4. Specifications (R22-P + 16 items)

**Conventions for every package.**
- New tables and objects are named in `src/lib/solar/so-shared.ts` (A creates; later packages append their own names
  in marked blocks). Rights and audit labels of **every** Round 22 table are registered at runtime by
  `src/lib/solar/so-registry.ts` (A, one commit): **every module that writes a Round 22 table must
  `import './so-registry'`**, and so do `sync-engine.ts` and `trust/recycle-bin.ts` (`tests/so-registry.test.ts`, the
  R19 / R21 shape).
- Round 22 invoice snapshots live under **ONE record key `so`** (`R22_RECORD_KEYS`, spread into `R9_RECORD_KEYS` in
  `store/invoice-defaults.ts`): never add keys. Per-line data sits in `so.lines[lineId]`
  (`{ part: 'goods' | 'service' | 'outside', contract: string }`); serials reuse `InvoiceItem.serials`; DISCOM fees reuse
  `charge_head_id: 'rule33'`.
- Record / line / settings fields are declared in `src/types/solar-r22.ts` by declaration merging, one `declare module`
  block per package marked `// R22-A` … `// R22-D`; A declares every sub-field type of `so` for all packages in one
  commit, so B–D never edit A's block.
- `tests/docs-links.test.ts` already reads `SO` ids (this PRD's commit). A only cites them.
- Help topic `time:solar` (+ one per view only where the view has its own help strip) in `topics-packs.ts`; Ctrl+K
  titles in `discover-r6-tabs.ts`; `PACK_TABS` rows `r22.solar`, `r22.solar.<view>`; each view's help strip uses
  `openHelp('time:solar')`.
- Capacity in kWp with three decimals at most (3.240); money two decimals; percentages one. Quantities are stored as
  typed and rounded only for display.

### R22-P: core reclaim (only when `room < 29` after PERF-7; no feature change)

**Goal.** Reclaim `29 − room` kB (at most 15) of the core precache with no change to what the app does, so Round 22
fits. It starts only after PERF-7 merges, measures on that base, and **never reworks a lever PERF-7 took**: the lead
lists PERF-7's levers in the P branch's first commit. Measured per step with `npx vite build` + `gen-precache` +
`check-bundle-size` in the same checkout, cumulative, written as a "PERF-8 (R22-P)" section of
`docs/qa/performance.md` (the PERF-6 table shape).

| # | Lever (only those PERF-7 did not take) | Why it should pay | Estimate (unmeasured) |
|---|---|---|---|
| P1 | **Rule-row `source` strings** of the round rule files (`*-rules.ts`, ≈ 1,000 rows): keep a short id in the row and move the long citation text to a lazy `rule-sources` side table loaded when a "Source" detail or the CA view opens | Every row ships a 60–200 character citation that the UI shows only on demand | −4 to −8 |
| P2 | **Desk shells**: the 9 pack desks (R14–R21) repeat the view switcher, help strip and pack filter; one shared `PackDesk` helper module in the pack chunk | Duplicated JSX / logic per desk | −2 to −3 |
| P3 | **CSV header and print-window boilerplate**: shared `printShell(title, body)` already exists for some prints; move the rest of the copies to it | Repeated HTML / CSS strings in ≈ 40 print builders | −2 to −4 |
| P4 | **Dead lazy code** retry (PERF-6 P4 found < 0.5 kB; re-run after Rounds 20–21) | Modules / exports with no importer in `build-meta/chunks.json` | −0.5 to −2 |

Acceptance: core lower by at least the target against the measured base; first paint not higher; Hindi pack ≤ 400 kB;
`npm run verify:offline` passes; a "Source" detail and the CA view still show every citation (`tests/rule-sources.test.ts`
when P1 runs: every row's id resolves); e2e smoke unchanged. **Stop rule:** a lever that saves < 0.5 kB or changes
behaviour is dropped; if P falls short, §1.4's stop rule cuts packages.

Owned: `scripts/check-bundle-size.mjs`, `scripts/vite-safe-groups.mjs`, `vite.config.ts` (groups only), the rule files'
`source` fields (P1, data layout only), `tests/bundle-config.test.ts`, `docs/qa/performance.md`. **No file of R20-C or of
Round 22 A–D.**

### R22-A: solar core (merge first after PERF-7 / R22-P)

**A1 · Profile, packs, settings, registry, rules, desk shell.**
- Wizard card "Solar installer, EPC contractor or solar-pump vendor" (`SetupWizard.tsx` card list, the R21 card
  pattern): `business_type: 'contractor'`, explicit `modules` = contractor preset ∪ `recurring`; explicit
  `industry_packs` per §1.3; `solar_kind`; landing per §1.3. Settings → Features "Solar profile" row.
- `PackId` += `'solar' | 'kusum'`; `PACK_IDS` row; `TIME_TABS` row `{ id: 'solar', pack: 'solar', alsoPacks: ['kusum'] }`;
  `PACK_TABS` rows for the desk and its eight views (A writes every row, the R19 / R21 pattern).
- Object **`solar_settings`** (`settings.manage`, audited on save, synced as a singleton; absent = nothing solar,
  `soDefaultsFor(kind)` fills what is not stored): `{ svc_sac: '9954', goods_hsn: '8541', price_basis: 'inclusive' |
  'exclusive', collect_after_subsidy: boolean, milestones: [{ label, pct }], cmc_years: 5, cmc_visits: 2,
  cmc_provision_per_kwp?: number, registrations: [] (D3), kusum: {} (D2) }`.
- `src/lib/solar-rules.ts` with every row of §2.4 (A's rows R1–R10, R16; B–D append theirs in marked blocks, never edit
  A's). `tests/so-rules.test.ts`: date lookup, `verified` flags as §2.4, family regex / import graph.
- `SolarDesk.tsx` with the view switcher (pack-filtered), icons per §1.5, the help strip; views lazy by file name.
- **Acceptance:** the card on a fresh company lands on the jobs view with the solar tab only (no Works tab for
  `rooftop`, Works on for `epc`); a plain `contractor` company shows no solar tab or Features row change; turning `solar`
  off hides the tab and deletes nothing; first paint unchanged (`check:size`); `chunks.json` shows `f-solar` with the
  rules module.

**A2 · Jobs.** Table **`solar_jobs`** (`doc.create`, dated by `date` = booking date, audited):
`{ id, date, client_id, site: { address, state_code }, discom, consumer_no, sanctioned_kw?, portal_app_no?, segment:
'home' | 'rwa' | 'ci' | 'pump' | 'other', scheme: 'pmsg' | 'state' | 'kusum' | 'none', households? (rwa),
special_category (from `PMSG_SPECIAL_STATES` by `state_code`, editable), dc_kwp, modules?: { count, wp }, inverter_kw?,
battery_kwh?, grid: 'net' | 'gross' | 'net_billing' | 'behind_meter' | 'off_grid', stages: { survey?, feasibility?,
agreement?, material?, installed?, portal_upload?, inspection?, net_meter?, commissioned?, token?, cfa_credited? },
cfa: { expected, token_amount?, credited_amount?, to: 'consumer' | 'loan' }, loan?: { lender, amount, sanctioned_on? },
status: 'lead' | 'won' | 'installed' | 'commissioned' | 'closed' | 'cancelled', install?: (C1), cmc_id?: (C3),
wo_id?: (D2) }`.
- `consumer_no` + `discom` unique among live jobs (warning; a second system on the same connection is allowed with a
  reason, R6 / 5(n)); `portal_app_no` unique when typed.
- Stage dates in order (hint, never a block); "stuck" when a stage waits longer than its typical days (setting).
- Billed / paid state is **derived** from live invoices with `so.job_id` and their receipts, never stored.
- View `jobs`: pipeline by stage (counts and ₹), filters (scheme, segment, DISCOM, month), job form.
- **Acceptance:** `tests/so-jobs.test.ts`: uniqueness, stage order hint, special-category from State code, derived
  billed state; deleting a job with documents is refused (cancel the documents first); a job delete goes through
  `setTable` (recycle bin).

**A3 · System kits and the quote.**
- Stock item flag `StockItem.so = { role: 'module' | 'inverter' | 'structure' | 'bos' | 'battery' | 'pump' | 'meter',
  wp?, dcr?: boolean, almm?: 'list1' | 'list1_2' | 'none', model? }`. A **system kit** is an ordinary `kit` item with a
  BOM (existing); the quote reads kWp from the module components (count × Wp ÷ 1,000), editable.
- `cfaFor(job, date)` from `PMSG_CFA_RULES` (R4): home slabs by capacity and special category; RWA by
  `min(households × 3, dc_kwp, 500)`; zero with the reason when the scheme is not `pmsg`, the grid is `off_grid` (6(o)),
  any module is non-DCR (5(m)), or the date is outside the rule rows. Prior CFA capacity typed on the job reduces the
  3 kW cap (5(n)).
- Quote calculator (view `quote`, also a panel in the job form): price typed **inclusive** (homes) or **exclusive** of
  GST; shares and tax by `soSplit` (A4); subsidy estimate; "Your net cost after subsidy"; optional loan. "Make
  quotation" creates a `QUOTATION` (`QTN`) with the split lines and the `so` snapshot (`so.quote = { kwp, cfa, net }`).
- Print block on the quotation (accent only): "Subsidy estimate ₹78,000: paid by the Government into your bank account
  (or loan account) after the DISCOM inspects the system. It is not part of this bill. Estimate; verify with your CA."
- **Acceptance:** `tests/so-cfa.test.ts`: the guideline's own examples (1.5 kW → ₹45,000; 2.5 kW → ₹69,000; 6 kW →
  ₹78,000; RWA 100 kW with 20 houses → ₹10,80,000, with 50 houses → ₹18,00,000), special category, non-DCR / off-grid
  → 0 with reason, prior capacity. **Cut 2:** the quotation print block (the calculator and snapshot stay).

**A4 · The 70:30 contract line, e-Way hook, paper part, demo.**
- `soSplit(amount, basis, date)` → `{ gross, goods: { value, rate }, service: { value, rate }, rule_from }` from
  `SOLAR_SPLIT_RULES` at the document date. Inclusive basis: `gross = amount ÷ (1 + 0.70 × goods_rate + 0.30 × svc_rate)`
  (÷ 1.089 from 22 Sep 2025). Rounding: `goods = round2(gross × 0.70)`, `service = gross − goods`, so the two always
  sum to the gross (SO5). A row with `goods_pct: null` (before 2019) asks the user for the split.
- Editor action "Solar contract (supply with installation)" (only with the `solar` pack): picks the kit and the job,
  takes the contract amount and builds **two lines**: the kit (qty 1, rate = goods value, HSN from the kit or
  `goods_hsn`, the rule's goods rate; components leave stock as for any kit) and "Installation and commissioning" (SAC
  `svc_sac`, 18 %). Other lines on the same bill join the gross unless marked **"Separate supply"** with a reason
  (`so.lines[id].part = 'outside'`, SO3); pure-agent lines (`rule33`) are always outside. Changing a line's value
  re-splits the contract (one recompute, the user sees both shares). Untick "supplied with installation" → no split; each
  line at its own slab with the R3 hints (SO6).
- `so` snapshot: `{ job_id, split: { gross, goods_pct, goods_rate, svc_rate, rule_from, basis }, lines }`. Printing an
  old bill after a rule change shows the old split (snapshot rule).
- **e-Way** (one hook in `eway.ts`, through `so-tax-io.ts`): a document with `so.split` builds the item list from the
  goods share only (value + its tax); the service line is left out. Hint "e-Way value = goods share (70 %); verify with
  your CA" (SO7 ★). e-Invoice: unchanged (the service line is already `IsServc: 'Y'` by its SAC).
- Paper part `SolarSplit` (`TemplateEngine`, accent variable only): under the contract, "Solar power generating system,
  3.240 kWp: contract value ₹1,74,472.00; deemed goods 70 % ₹1,22,130.40 at 5 %; deemed installation 30 % ₹52,341.60 at
  18 % (N 9/2025-CT(R) Sch I S. No. 437 read with N 11/2017-CT(R) S. No. 38; verify with your CA)". Printed whenever a
  document carries `so.split`, pack on or off.
- Demo company rows (only through `demo-company.ts`): two kits (3 kW home, 10 kW C&I), three jobs at different stages.
- **Acceptance:** `tests/so-split.test.ts`: exclusive / inclusive, shares sum exactly, rate by date (21 Sep 2025 → 12 %
  goods, 22 Sep 2025 → 5 %), 2018 asks, "separate supply" and `rule33` lines stay outside, GSTR-1 HSN summary shows two
  rows (goods HSN, service SAC); `tests/so-eway.test.ts`: e-Way value = goods share. **Cut 1:** demo rows.

**A cap ≤ 8 kB.**

### R22-B: money (job bill, advances, subsidy and loan, pipeline)

**B1 · Job bill and advances.**
- "Bill job" on a job: one tax invoice (A4 split) for the job, with the **serial annexure** (C1 serials if recorded,
  else from the kit lines) on the existing `annexure` field, through `localDb.invoices.saveMany` in one write (with its
  advance applications), `so.job_id` set.
- Advances per job (existing `advances.ts`, `so.job_id` on the advance): the tax on an advance is worked out on the
  **service share only** (30 % of the advance at 18 %; the goods share carries no tax on an advance, N 66/2017), shown
  with the working (`soAdvanceTax`, SO8 ★). Applied to the job bill by the existing `advance_id` rows.
- Milestone plan (`solar_settings.milestones`, default booking 20 %, material 60 %, commissioning 20 %): the job shows
  "due now" by the stages reached; follow-ups through the existing reminders.
- **Acceptance:** `tests/so-bill.test.ts`: one write; the advance's tax equals the service share's; applying the advance
  leaves the right balance; cancelling the bill frees the job (derived state); 11A / 11B of GSTR-1 carry only the service
  share.

**B2 · Subsidy and loan tracker.** View `subsidy`: per job the CFA expected (A3), stage dates (portal upload, inspection,
net meter, e-token with amount, CFA credited with amount), **"CFA expected by"** = inspection approval + 15 days (R7,
P 6(t)). Two money cases:
- **Collect after subsidy** (`collect_after_subsidy` on, the usual "net of subsidy" quote): the job's open balance up to
  the CFA amount is shown as **"Waiting for subsidy"** (not overdue) until the CFA is credited; then a reminder "Collect
  ₹78,000 from <customer>: subsidy credited on 12-10-2026" through the existing follow-ups. No GST event (SO9, SO10).
- **Loan**: a lender's disbursement is a normal receipt on the customer's bill from the lender (narration names the
  lender; money moved, no no-cash marker); when a loan exists the CFA goes to the loan account (P 6(s)(i)), so the
  tracker does **not** expect the customer to pass the CFA on (SO31).
- **Acceptance:** `tests/so-subsidy.test.ts`: waiting vs overdue split in ageing; the reminder fires on the credited
  date; the loan case expects no CFA collection; mismatch between e-token and expected CFA is listed.

**B3 · Money pipeline.** View `money`: ₹ by stage (booked, installed not billed, billed not paid, waiting for subsidy,
inspection pending > N days, net meter pending), job ageing by stage, CSV. Bell notices behind the bell's `solar` gate
(one `gate(...)` line in `NotificationBell.tsx`, the R17 / R19 / R21 precedent) through `so-alerts.ts` (inspection
waiting, CFA credited but not collected, stuck jobs). **Cut 1:** the bell (the list stays on the view).

**B4 · DISCOM fees and the net meter.** "Add DISCOM fee" on a job bill adds a pure-agent line (`charge_head_id:
'rule33'`, 0 %, outside the gross, SO18) from a purchase / expense paid in the customer's name. A net meter bought by
the vendor and fitted with the system is an ordinary kit component inside the gross by default (SO19 ★, the switch
"Bill the net meter separately" puts it outside at its own slab). **Cut 2.**

**B cap ≤ 7 kB.**

### R22-C: installation, handover and the 5-year CMC

**C1 · Installation record.** On the job (`solar_jobs.install`): module serials (typed, scanned or imported; **count =
module count**, duplicates refused through `duplicateSerials`; serials in stock checked through `so-stock-io.ts`),
inverter serial(s), DCR certificate / invoice reference per module lot, ALMM flags of each model with the hint
"List-II cells needed for CFA installations commissioned from 1 Jun 2026" (R10, SO14), earthing / lightning-arrester /
ACDB-DCDB checklist (typed ticks), geo-tagged photos reminder through the existing `AttachmentsPanel`. The serials flow
onto the job bill's kit line (`InvoiceItem.serials`). View `install`. **Acceptance:** `tests/so-install.test.ts`:
count check, duplicate refused, a non-DCR module on a `pmsg` job turns the CFA estimate to 0 with the reason, the bill
carries the serials.

**C2 · Handover pack.** Print window (`escHtml`, A4, English + Hindi labels): customer, site, DISCOM, consumer no.,
capacity, serial list, DCR list, OEM warranties (module performance years, inverter years, typed on the item), the CMC
terms (5 years from commissioning, free repairs; R8), net-meter details, subsidy status, vendor contacts. **Cut 2.**

**C3 · 5-year CMC.** On "Commissioned" (stage date typed), the app creates an **`amc_contracts`** row (existing table;
`value: 0`, `start` = commissioning, `end` = + `cmc_years`, `visits_per_year` = `cmc_visits`, `AmcContract.so = { job_id,
kind: 'cmc' }`); the existing AMC reminders, Dashboard tile and renewal work unchanged ("Renew" after 5 years is a paid
AMC at 18 %, SO16). Complaints: a visit with `kind: 'complaint'` and a resolved date (additive `AmcVisit.kind`); an OEM
warranty replacement is a stock move in and out at zero value with the serial swapped (SO17). View `cmc`: CMCs by due
visit, open complaints, ending soon. **Acceptance:** `tests/so-cmc.test.ts`: one CMC per job (idempotent), dates from
commissioning, reminders reuse `amcReminders`, a complaint visit does not use up a scheduled visit.

**C4 · CMC provision.** Optional (`cmc_provision_per_kwp`, default off): at the job bill a journal (class "CMC provision")
Dr CMC expense | Cr Provision for CMC (kWp × rate), released evenly each year (one journal per FY per job, through
`saveVoucher`), with the reason and SO15 ★ shown. **Cut 1** (shown as a note only).

**C cap ≤ 7 kB.**

### R22-D: C&I EPC, KUSUM pumps, statutory list, job profit

**D1 · 70:30 on works RA bills.** In the existing RA bill flow (pack `works`), an RA bill of a contract marked "solar
EPC" (`so.job_id` on the contract) splits each solar contract line by `soSplit` (A4) on the **gross RA value before
retention / deductions** (SO27); retention, mobilisation recovery, 194C and GST TDS u/s 51 stay as they are
(`works/deductions.ts`). **Acceptance:** `tests/so-ra.test.ts`: split per RA bill, deductions unchanged, cumulative
abstract unchanged.

**D2 · KUSUM work orders and pump bills.** Table **`solar_work_orders`** (`doc.create`, dated by `date`, audited):
`{ id, date, agency_client_id, wo_no (typed, unique), year, rates: [{ model, hp, rate }], shares?: { central_pct,
state_pct, farmer_pct } (hint, R11), farmer_share_by: 'agency' | 'vendor', retention_pct?, cmc_years }`. Pump jobs are
`solar_jobs` rows with `segment: 'pump'`, `scheme: 'kusum'`, `wo_id` and `pump: { hp, type: 'ac' | 'dc', farmer,
beneficiary_id?, survey_no? }`. View `kusum`: work orders, pumps by stage (installed, joint inspection, billed),
**"Bill installed pumps"** → one invoice per pump to the agency (A4 split; with `farmer_share_by: 'vendor'` the farmer's
share is a separate invoice to the farmer, same split, SO23 ★) through `localDb.invoices.saveMany` in one write, with
the agency's deductions (retention, 194C, GST TDS u/s 51) through `so-tax-io.ts`; the CMC (C3) per pump. Import pumps
from CSV / XLSX (`import-mapping.ts`, an `import_runs` row of kind `solar_pumps`). **Acceptance:**
`tests/so-kusum.test.ts`: one write for the batch; one bill per pump; split and deductions; farmer-share variant sums to
the pump value; re-billing an already billed pump refused (derived from `so.job_id`).

**D3 · Statutory list.** `solar_settings.registrations: [{ kind: 'national_vendor' | 'state_vendor' | 'bank_guarantee' |
'electrical_licence' | 'almm_check' | 'other', ref, discom?, valid_to }]`; view `statutory` lists due and expired rows;
notices through `so-alerts.ts` behind B's bell gate (R17, SO32, SO33). **Cut 2:** list without bell notices.

**D4 · Job profit.** `PurchaseRecord.so = { job_id }` (additive; the bill / expense editor shows a job picker only with
the `solar` pack); `so-profit.ts` reads purchases through `readPurchase` (`tests/purchase-contract.test.ts` gets
`solar/so-profit.ts`) and kit stock issues at cost; view block on `money`: revenue, cost, margin, ₹ per kWp, days per
stage (averages by month). **Cut 1.**

**D cap ≤ 7 kB.**

---

## 5. Work packages

**Merge order:** PERF-7 → **R22-P** (only when §1.4 says so) → **R22-A** → **B, C and D in parallel, any order**.

| Package | Scope | Owned (new) | Owned (edit) | Cap (core gz) |
|---|---|---|---|---|
| **R22-P** | P1–P4 (gate) | `tests/rule-sources.test.ts` (P1) | `scripts/{check-bundle-size,vite-safe-groups}.mjs`, `vite.config.ts` (groups), rule files' `source` layout (P1), `tests/bundle-config.test.ts`, `docs/qa/performance.md` | **≤ −(29 − room)** (a reclaim, ≤ 15) |
| **R22-A** | A1–A4 | `src/lib/solar/{so-shared,so-registry,so-settings,so-jobs,so-cfa,so-split}.ts`, `src/lib/solar/so-issue-io.ts`, `src/lib/solar/so-tax-io.ts`, `src/lib/solar-rules.ts`, `src/types/solar-r22.ts`, `src/components/solar/{SolarDesk,JobsView,QuoteView}.tsx`, `solar.module.css`, `src/components/templates/parts/SolarSplit.tsx`, `src/i18n/areas/solar-r22a.ts`, `docs/features/solar-r22.md`, tests `so-rules`, `so-registry`, `so-jobs`, `so-cfa`, `so-split`, `so-eway` | `industry-packs.ts` (packs + `PACK_TABS` rows), `page-tabs.ts` (1 row), `SetupWizard.tsx` (card), Settings → Features (row), `shop-presets.ts` (card preset if needed), `store/invoice-defaults.ts` (`R22_RECORD_KEYS` token), the invoice editor (one "Solar contract" action slot), `eway.ts` (one hook), `TemplateEngine.tsx` (mount part), `sync-engine.ts` + `trust/recycle-bin.ts` (registry import), `backup.ts` (tables), `vite.config.ts` + `tests/bundle-config.test.ts` (`f-solar`), `topics-packs.ts`, `discover-r6-tabs.ts`, `demo-company.ts` | **≤ 8** |
| **R22-B** | B1–B4 | `src/lib/solar/{so-bill,so-subsidy,so-money,so-alerts}.ts`, `src/lib/solar/so-recv-io.ts`, `src/components/solar/{MoneyView,SubsidyView}.tsx`, `src/i18n/areas/solar-r22b.ts`, tests `so-bill`, `so-subsidy`, `so-money` | `so-shared.ts` (B block), `solar-rules.ts` (B block, if any), `solar-r22.ts` (B block), `so-issue-io.ts` (B functions appended), `NotificationBell.tsx` (one gate line), `tests/no-cash-readers.test.ts` (only if a reader is added) | **≤ 7** |
| **R22-C** | C1–C4 | `src/lib/solar/{so-install,so-handover,so-cmc,so-provision}.ts`, `src/lib/solar/so-stock-io.ts`, `src/components/solar/{InstallView,CmcView}.tsx`, `src/i18n/areas/solar-r22c.ts`, tests `so-install`, `so-cmc` | `so-shared.ts` (C block), `solar-rules.ts` (C block), `solar-r22.ts` (C block), `so-recv-io.ts` (C functions appended after B, or created by C if C merges first) | **≤ 7** |
| **R22-D** | D1–D4 | `src/lib/solar/{so-ra,so-kusum,so-statutory,so-profit}.ts`, `src/components/solar/{KusumView,StatutoryView}.tsx`, `src/i18n/areas/solar-r22d.ts`, tests `so-ra`, `so-kusum`, `so-profit` | `so-shared.ts` (D block), `solar-rules.ts` (D block), `solar-r22.ts` (D block), the works RA bill builder (one split hook), the bill / expense editor (job picker slot), `so-alerts.ts` (D notices appended), `tests/purchase-contract.test.ts` (one reader) | **≤ 7** |

**Combined:** first paint **0** at every merge; core **≤ 29 kB gross + 1 kB lead reserve = 30 kB**, after PERF-7 (and
R22-P); Hindi pack ≤ 7 kB; Hindi in core 0. Each package runs `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build` and `npm run check:size` (one at a time, under the shared lock), and again after rebase; the last
package also runs `npm run test:e2e` and `npm run verify:offline`.

---

## 6. Shared-file protocol

| File | Who | Rule |
|---|---|---|
| `src/lib/solar/so-shared.ts`, `src/lib/solar-rules.ts`, `src/types/solar-r22.ts` | A creates; B / C / D append | One marked block per package (`// R22-B` …); never edit another block; a union conflict is resolved by keeping both blocks |
| `src/lib/solar/so-registry.ts` | A | A registers **every** Round 22 table (`solar_jobs`, `solar_work_orders`) and the object in one commit; a table a cut drops stays registered and unused |
| `src/lib/solar/so-issue-io.ts` | A creates, B appends | B adds `saveMany` / advance helpers at the end; A's exports unchanged |
| `src/lib/solar/so-recv-io.ts`, `so-alerts.ts` | B creates (C / D append) | Whoever merges first creates; the others append at the end |
| `src/components/solar/SolarDesk.tsx` | A | Views mounted by file name; B–D add `*View.tsx` files only |
| `src/i18n/areas/solar-r22a.ts` | A | Shared words for the whole round; B–D add their own area files |
| `src/pages/page-tabs.ts`, `industry-packs.ts` | A only | A adds the `solar` tab row and every `PACK_TABS` row |
| `src/components/command/NotificationBell.tsx` | B (one `gate` line) | **R20-C does not touch it**; append-only; rebase on conflict |
| `src/components/onboarding/SetupWizard.tsx` | A (card) | Card-list entry only; rebase on conflict |
| The invoice editor | A (contract action slot) | **R20-C** edits report screens only; no overlap expected |
| `eway.ts` | A | One hook call next to R21's non-GST filter; no other edit |
| `vite.config.ts`, `tests/bundle-config.test.ts` | PERF-7, R22-P (groups / leaves), then A (`f-solar` row) | Sequential merges; A rebases on P |
| Works RA bill builder | D (one hook) | Default behaviour unchanged (`tests/ra-*.test.ts`, `works-*.test.ts` green) |
| `tests/e2e/smoke.mjs` | A–D | One appended `step(...)` block each, in merge order |
| `docs/features/solar-r22.md` | A creates | One section per package with its bundle numbers and deviations |
| `src/lib/whats-new.ts`, `package.json` version, `AGENTS.md`, `docs/ROADMAP.md`, `docs/CA_REVIEW.md` §22, `docs/PROGRESS.md` | lead | After each merge; AGENTS.md gets a "Round 22 (solar)" storage paragraph (storage summary below) |

### Storage summary

| Key / table | Package | Kind | Backed up | Synced | Rights | Dated |
|---|---|---|---|---|---|---|
| `solar_settings` (object) | A | company data, singleton | yes | yes | `settings.manage` | no |
| `solar_jobs` | A | company data | yes | yes | `doc.create` | `date` |
| `solar_work_orders` | D | company data | yes | yes | `doc.create` | `date` |
| `StockItem.so`, `AmcContract.so`, `AmcVisit.kind`, `PurchaseRecord.so` | A / C / D | additive fields | with their tables | yes | as their tables | - |
| `InvoiceRecord.so` | A–D | ONE record key (`R22_RECORD_KEYS`) | with invoices | yes | - | - |

No new device-local key, no `series_counters` series, no new no-cash marker, no new `Godown.kind`, no new business type.

---

## 7. E2E steps (production build, `tests/e2e/smoke.mjs`)

1. A: fresh company → card "Solar installer" (`rooftop`) → lands on `/time?tab=solar&view=jobs`; add a 3 kW kit (6
   modules × 540 Wp DCR, inverter, structure); new job (Maharashtra, consumer no.) → quote ₹1,90,000 inclusive →
   shares 70 / 30, subsidy estimate ₹78,000 (3.24 kWp capped at 3), net cost ₹1,12,000; make quotation; convert to a tax
   invoice → GST reports show two HSN rows (8541 at 5 %, 9954 at 18 %).
2. B: advance ₹40,000 → tax on ₹12,000 only; bill job; stages to inspection + e-token ₹78,000; balance shows "Waiting
   for subsidy"; CFA credited → reminder listed.
3. C: six serials typed (a seventh refused), commissioned → a CMC row with 5-year end and two visits a year; handover
   pack prints.
4. D: work order with two pumps → "Bill installed pumps" → two invoices in one write with retention and GST TDS rows;
   statutory list shows a BG expiring in 20 days.

---

## 8. Open questions, with the default the builders will use

| # | Question | Default chosen | Why |
|---|---|---|---|
| Q1 | A new business type or a card? | Wizard card; `contractor` + `solar_kind`; explicit modules and packs | Zero shell bytes; R12–R21 pattern |
| Q2 | Where do the screens live? | One tab `solar` on `/time`, eight views | Job-based desks live there (R15, R17, R19) |
| Q3 | Job = cost centre or its own table? | Own table `solar_jobs` (the R19 `lg_jobs` choice) | Many small jobs a year with stages and scheme fields; cost centres would flood the chart |
| Q4 | Split as two lines or one line with two tax rows? | Two lines (goods HSN, service SAC) printed as one contract by the paper part | GSTR-1 HSN summary and e-Invoice need two rows; no change to `invoice-calc` |
| Q5 | Inclusive or exclusive quotes by default | Inclusive for `rooftop`, exclusive for `epc` / `pumps` | Homes compare all-in prices; C&I and agencies quote ex GST |
| Q6 | Service SAC printed | `9954` (setting) | Entry 38 reads "construction or engineering or installation or other technical services"; CA to confirm (SO4 ★) |
| Q7 | Tax on advances | Service share only (30 % at 18 %) | N 66/2017 for goods; Sec 13 for services (SO8 ★) |
| Q8 | "Net of subsidy" quotes | Full contract value billed; the subsidy part collected after credit as a debtor | CFA is the consumer's (P 6(p), (s)); SO9 ★ |
| Q9 | Net meter bought by the vendor | Inside the gross; switch to bill separately | Supplied along with the installation (SO19 ★) |
| Q10 | CMC accounting | No provision unless set (per kWp) | Small vendors; CA decides (SO15) |
| Q11 | KUSUM farmer share | One invoice per pump to the agency; farmer invoice only when the vendor collects it | State practice varies (SO23 ★) |
| Q12 | Budget shortfall | PERF-7, then R22-P; cut in §3 order; D moves at `room < 22`, C at `room < 15` | §1.4 stop rule |

Owner questions (no default can be taken without the owner):
- **O1.** Is solar the round the owner wants after fuel, or should cab / fleet operators (score 1.5) go first?
- **O2.** If PERF-7 reclaims less than 15 kB and R20-C is still planned, may R22-P change the rule-row `source` layout
  (P1), the biggest unmeasured lever?
- **O3.** Should the app show the PM Surya Ghar CFA estimate at all after 31 Mar 2027 if no extension is notified (default:
  rows end, the estimate shows "scheme ended")?

---

## 9. CA review items (SO1–SO36), copied to `docs/CA_REVIEW.md` §22

★ = changes what a document prints or a return reports. Defaults as §8.

| Id | Question for the CA | Default in the app |
|---|---|---|
| SO1 ★ | A solar power generating system supplied with its installation: 70 % of the gross consideration is deemed goods (N 9/2025-CT(R) Sch I S. No. 437 Explanation, 5 % from 22 Sep 2025) and 30 % an installation service (N 11/2017-CT(R) S. No. 38, 18 %), whatever the actual cost break-up. Right, for homes, RWAs and C&I alike? | As stated, two lines |
| SO2 ★ | Earlier rows: 70:30 from 1 Jan 2019 (N 24/2018-CT(R)) with goods at 5 %, 12 % from 1 Oct 2021 (N 8/2021-CT(R)), 5 % from 22 Sep 2025; no deemed split before 2019. For a contract straddling 22 Sep 2025, does the invoice date decide (Sec 14)? | Rate of the invoice date; before 2019 the user types the split |
| SO3 ★ | "Gross consideration charged for all such supplies": every line of the contract (BOS, extra cable, structure, net meter) joins the gross; lines the user marks "separate supply" and pure-agent fees stay out. Right? | As stated |
| SO4 ★ | HSN / SAC printed: goods share under the kit's HSN (default 8541) and the service share under SAC 9954. Which HSN and SAC should a rooftop contract carry (8541 43 / 8502 / 85, and 9954 / 995461 / 9987)? | 8541 and 9954, editable |
| SO5 ★ | Inclusive prices: gross = price ÷ 1.089 (from 22 Sep 2025); goods = gross × 70 % rounded to paise, service = gross − goods. Acceptable rounding? | As stated |
| SO6 ★ | Standalone supplies (installation not supplied): modules 5 % (Sch I 437(h)), inverters 8504 18 % (Sch II 477), steel structures 7308 18 % (Sch II 286), installation only 18 % (S. No. 38). Right? | Hints; each line at its slab |
| SO7 ★ | e-Way bill for a 70:30 contract: value = the goods share (70 %) with its tax, the service share left out. Material moved to the site before the invoice: delivery challan (Rule 55) with the kit's value? | Goods share; challan at kit cost |
| SO8 ★ | Advance on a 70:30 contract: no GST on the goods share (N 66/2017-CT), GST at 18 % on the service share (30 %) of the advance. Right? | As stated |
| SO9 ★ | The PM Surya Ghar CFA is paid by the Government to the consumer (or the loan account), not to the vendor: the vendor bills the full contract value and the CFA never reduces it (Sec 15(2)(e) not relevant). Right, also for "net of subsidy" quotes? | Full value billed |
| SO10 | The "subsidy part" the customer pays after the CFA is credited is an ordinary debtor balance, shown as "Waiting for subsidy" until then. Any GST, interest or income-tax point? | Debtor; no tax event |
| SO11 | CFA slabs (2024 guideline 5(h)): ₹30,000 / kWp first 2 kWp, ₹18,000 next 1 kWp, cap 3 kWp; special category ₹33,000 / ₹19,800; RWA ₹18,000 (₹19,800) per kWp, ≤ 500 kWp at 3 kWp per house; scheme till FY 2026-27. Has the 13 Feb 2025 revision changed any value? | As stated (estimate only) |
| SO12 | Special-category list (5(g)) mapped to GST State codes 01, 02, 05, 11–18, 31, 35, 38. Right mapping? | As stated |
| SO13 | Eligibility hints: DCR modules, grid-connected only, once per installation, relocated not eligible, prior CFA capacity counts to 3 kW, CFA on DC module capacity. Anything else that should zero the estimate? | Hints with reasons |
| SO14 | ALMM List-II cells for CFA installations commissioned from 1 Jun 2026, "Give It Up" installs exempt till 31 Mar 2027. Right? | Hint only |
| SO15 ★ | The free 5-year CMC (guideline 7(d)) is included in the contract price: (a) defer part of the revenue (AS 9 / Ind AS 115) or provide for the expected cost (AS 29 / Ind AS 37)? (b) Any separate GST on the CMC element? | No split for GST; provision optional, off |
| SO16 | Paid AMC after the 5-year CMC: 18 %, which SAC (998719 / 998729)? | 18 %, SAC typed |
| SO17 | OEM warranty replacement given free to the customer within warranty: no GST, no invoice (Circular 195/07/2023-GST)? The app records a stock swap at zero value. | As stated |
| SO18 | DISCOM fees (application, meter testing, net-meter fee) paid in the customer's name and recovered at actual: pure agent (Rule 33), outside the value? | As stated |
| SO19 ★ | A net meter bought by the vendor and fitted with the system: part of the 70:30 gross, or a separate supply of a meter (9028) at its own rate? | Inside the gross; switch |
| SO20 | 194C on payments by business customers (1 % / 2 %; Sec 393 Table S. No. 6 from 1 Apr 2026): right section for a supply-dominant contract, or 194Q / none on the goods share? Individuals for personal purposes do not deduct. | 194C on the whole |
| SO21 | 194Q on the vendor's purchases of modules / inverters (buyer turnover > ₹10 crore, > ₹50 lakh from one seller, 0.1 %). Existing hint enough? | Existing hint |
| SO22 | May a solar installer opt for the 6 % scheme (N 2/2019-CT(R)) when 70 % of the contract is deemed goods? Or composition at all? | Hint "check with your CA"; not blocked |
| SO23 ★ | KUSUM: one invoice per pump to the State agency for the full value, the farmer's share collected by the agency. When the vendor collects the farmer's share, a separate invoice to the farmer (same split) for that share. Right? | As stated |
| SO24 ★ | Solar water-pumping system (KUSUM) with installation: entry 437 at 5 % with the 70:30 split? | As stated |
| SO25 | GST TDS u/s 51 (2 %) by State agencies on KUSUM / Government rooftop bills above ₹2.5 lakh: on the value of both shares excluding GST? | Existing works rule |
| SO26 | KUSUM performance security / retention and the agency's CMC holdback: accounted as works retention (existing). Right? | As stated |
| SO27 | C&I EPC RA bills: 70:30 applied to the gross RA value before retention and other deductions. Right? | As stated |
| SO28 ★ | Batteries (8507, 18 %) in a hybrid system: inside the 70:30 gross (part of the "solar power generating system") or a separate line at 18 %? | Separate at 18 %, hint |
| SO29 | Solar water heaters (Sch I S. No. 428, 5 %) with installation: the Explanation is to entry 437 only, so no 70:30 split? | No split |
| SO30 | Income tax: the vendor's turnover (44AD, audit limits) is the full invoice value; the CFA is the consumer's receipt. 44AD available to an installer (not engineering consultancy)? | As stated |
| SO31 | A lender's disbursement paid straight to the vendor for the customer: a receipt on the customer's bill; the CFA then goes to the loan account (6(s)(i)). Any TDS or accounting point? | As stated |
| SO32 | National vendor registration bank guarantee (₹25 lakh reported) and its margin money: accounting only (deposit), alert on expiry. Right? | Alert only |
| SO33 | Electrical contractor licence (State) and CEA safety regulations: any consequence the app should state on bills? | Alert only |
| SO34 | (Market) 34,219 registered vendors (29,469 active) and 26–40 lakh installations (reports disagree). Official count? | - |
| SO35 | Records: serials, DCR certificates and geo-tagged photos kept per job for scheme inspections; retention period beyond 8 years (Sec 36)? | Keep all |
| SO36 | Section labels by date on TDS working papers (194C → Sec 393 Table S. No. 6 from 1 Apr 2026). | Existing `ita2025.ts` rows |

---

## 10. Test plan (summary)

| Area | Tests |
|---|---|
| Rules and family | `so-rules` (dates, `verified` flags, import graph), `so-registry` (rights, audit, sync / recycle-bin import), `bundle-config` (`f-solar`), `docs-links` (`SO`, added with this PRD) |
| A | `so-jobs`, `so-cfa` (the guideline's five examples), `so-split`, `so-eway`; snapshot test: printing an old bill after a rule change shows the old split |
| B | `so-bill`, `so-subsidy`, `so-money`; GSTR-1 11A / 11B carry the service share only |
| C | `so-install`, `so-cmc` (+ existing `amc` tests unchanged) |
| D | `so-ra` (+ works tests unchanged), `so-kusum`, `so-profit` (+ `purchase-contract`) |
| Volume | 600 jobs a year × 10 stages; a KUSUM batch of 200 pumps in one `saveMany` write; pipeline view < 200 ms |
| P | per lever; `rule-sources` when P1 runs; `verify:offline`; size table in `docs/qa/performance.md` |

---

## 11. Size budget per package (gz, core = English precache)

| Package | First paint | Core (cap) | Planned split | Stop rule (cuts in §3 order) |
|---|---|---|---|---|
| R22-P | ≤ 0 | **≤ −(29 − room)**, at most −15 | P1 −4…−8, P2 −2…−3, P3 −2…−4, P4 −0.5…−2 | Lever < 0.5 kB or behavioural → dropped |
| R22-A | **0** (`so` token in a lazy chunk) | **≤ 8** | Desk + settings + card + registry 2.2, jobs + view 2.2, kits / quote / CFA 1.8, split + e-Way hook + paper part 1.2, strings 0.6 (incl. shared words) | At 8 → cut 1 (demo rows), 2 (quote print block) |
| R22-B | 0 | **≤ 7** | Job bill + advances 2.0, subsidy tracker + view 1.8, money view + alerts 1.4, DISCOM fee 0.6, strings 0.6 | At 7 → cut 1 (bell), 2 (DISCOM fee helper) |
| R22-C | 0 | **≤ 7** | Install record + view 1.8, handover print 1.4, CMC + view 1.6, provision 0.8, strings 0.6 | At 7 → cut 1 (provision), 2 (handover pack) |
| R22-D | 0 | **≤ 7** | RA split 1.2, KUSUM + view + import 2.4, statutory 1.0, profit 1.4, strings 0.6 | At 7 → cut 1 (profit), 2 (statutory bell notices); whole D at `room < 22` |
| **Round** | **0** | **≤ 29 + 1 reserve = 30** | Hindi pack ≤ 7 kB (`lang-hi-solar`) | Core after PERF-7 + R22-P + R20-C + Round 22 ≤ 3,295 kB |

Each package writes before / after numbers (initial, entry, core, Hindi pack, Hindi in core, `f-solar`, `SolarDesk`) in
its section of `docs/features/solar-r22.md`.

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Core budget**: PERF-7 may reclaim less than 15 kB; R20-C holds 7 kB; R21 packages overran by up to 0.6 kB | H | **H** | §1.4 gate and `room` formula; R22-P before A; D moves at `room < 22`, C at `room < 15`; caps with pre-ranked cuts |
| 70:30 rule read wrongly (rate, scope, inclusive back-computation) | M | **H** | `verified: false`, working printed with the notification references, SO1–SO8 ★; rows date-keyed; split is two ordinary lines the user can edit |
| PM Surya Ghar ends 31 Mar 2027 or changes slabs | M | M | CFA rows dated with `to`; jobs, split, CMC and EPC work without CFA; pending note on an extension, never a guess |
| Users read the subsidy estimate as a promise | M | M | "Estimate; the Government decides" on every print; reasons for zero shown |
| e-Way value for a contract disputed | M | M | Hint, not block; SO7 ★; e-Way JSON is a working paper |
| Serial lists for big C&I jobs (thousands of modules) slow the editor | M | M | Serials kept on the job (C1) and imported from CSV; annexure prints from the job; volume test |
| `f-solar` captures nothing because engines import shared lazy code | M | M | Bridges `so-*-io.ts`; `chunks.json` check per package; import-graph test |
| `lazy-leaves-ui` at 27.7 / 28 kB: a small solar view joins and fails `check-bundle-size` | M | L | Views import the family (so they are not pure leaves) or exceed 2,500 B; A checks `chunks.json` |
| Overlap with R20-C | L | L | R20-C owns report screens only (§6) |
| KUSUM practice differs by State (who bills the farmer share, shares, holdbacks) | H | L | Work-order settings, both billing variants, SO23 ★ |
| CA-id regex misses `SO1` | L | L | Added with this PRD, with its test |

---

## 13. Out of scope (with reasons)

- **Portal and device integrations** (National Portal, DISCOM, KUSUM portals, ALMM / NISE, Jan Samarth, inverter clouds):
  need servers (AGENTS.md rule 1).
- **System design and generation estimates** (shadow, stringing, yield): design tools' job; typed kWp only.
- **RESCO / PPA power sale**, open access, RECs, utility-scale and tender projects (§1.6).
- **Consumer-side accounting** (the customer's CFA claim, depreciation, net-metering savings).
- **Solar water heaters' and battery-only contracts' own flows** (SO28, SO29): ordinary items until the CA answers.
- **Round 21 leftovers** (LPG rates by customer and cylinder deposits, the OMC fleet-card account; cut at the R21-D cap,
  `docs/features/fuel-r21.md`): they belong to the fuel family and the next `docs/PENDING.md` sweep, not this round.
- **Remaining industry candidates**: cab / tour fleet operators (score 1.5, the next round's first candidate), coaching /
  hostels (1.3), automobile dealers, SaaS, venues, weavers (1.0); chit funds ⛔ (§2.2).
- **Leaders' server features** (cloud CRMs, WhatsApp automation, e-sign of agreements): offline alternatives stay
  (follow-ups, attachments, print).
