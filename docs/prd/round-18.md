# PRD — Round 18: co-operative housing societies, apartment owners' associations and RWAs (maintenance billing, funds, dues)

Status: draft for build · Drafted 2026-10-28 · Baseline: branch `claude/elegant-cannon-cwapiv` at `a22544a`. Merged on
the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–20, Rounds 7–17 (R17-A … R17-D and the QA20 fixes). No other round
is being built in parallel.

Companion documents:
- `docs/CA_REVIEW.md` §18: the CA items **HS1–HS44** (§9 of this PRD). The lead copies them there when the PRD is
  accepted, and the total moves from **615 to 659**. `HS` ("housing society") is a new prefix. The prefixes in
  `docs/CA_REVIEW.md` rows on `a22544a` are AC, AG, CN, G, HT, I, MF, MP, P, PF, PS, RT, SV, T, TR, TV, X; older text
  also uses `A B C D H M Q R S`. `HS` cannot collide with `H…`, `HT…` or `S…` ids because every CA-id regex needs a
  digit right after the prefix (and `\b` before it).
- Sources: §2.8. **P** = primary text read this round (file downloaded and read, or page fetched), **S** = secondary
  source (press, practitioner article, search-result extract), **V** = vendor's own claim.
- Round 17 (`docs/prd/round-17.md` §2.2) ranked housing societies second (value 4, effort L) and recommended them for
  this round. Round 17 MP29 already covers a society **as a client** of a security agency.

Every item follows `AGENTS.md`:
- **Local-first and serverless.** No payment-gateway, UPI-collect, bank-API, municipal-tax, GST-portal, TRACES or
  society-app call. Members pay as they do today (UPI to the society's account, cheque, NEFT); the app reads bank
  statements the user imports and uses `wa.me` / `mailto:` links and the existing UPI QR only.
- **Styling.** Vanilla CSS Modules with tokens. Templates use the `accent` variable only (Critical Rule 5).
- **Invoice snapshots never change.** Everything a society bill prints is snapshotted on the document (`hs`).
- **Numbering.** Indian-FY numbering. Round 18 adds **no series**: taxable bills use the tax-invoice series, exempt
  bills the existing `BOS` series, unregistered societies the plain invoice series.
- **Dates.** Bare dates are parsed as local days. A billing period is `YYYY-MM` (monthly) or `YYYY-Qn` / `YYYY-Hn`.
- **Statutory and State values.** Date-keyed and append-only, in a lazy rule file. **State co-operative / apartment
  rules are data rows keyed by State code and date, never code branches.** A row is `verified: true` only when its
  value was read in a primary text this round (the R15–R17 rule). A draft, a bill not yet in force or a
  recommendation is never a rule row with legal effect.
- **Outputs are working papers.** GST, income-tax, co-op-law and audit outputs carry "verify with your CA" (Critical
  Rule 10). Bye-law checks are hints, never blocks.

---

## 1. Problem statement

### 1.1 Which segment is left, and why this one

| Candidate | What the app already has | Left over | Verdict |
|---|---|---|---|
| **Co-operative housing societies / apartment owners' associations / RWAs** | R5-C funds (cost centres of kind `fund`), leases and properties, fee runs (Bill of Supply / tax invoice split over the R2-B1 batch builder), recurring, receivables with interest (R8-A `interest.ts`), reminders and follow-ups (R2-A), bank reco, annual pack, common credit (Rule 42) | Unit / member master, charge heads with State apportionment, the ₹7,500 per-member test with the "whole amount" rule, pass-through statutory dues, arrears with capped simple interest on the next bill, sinking / repair funds, dues certificate on transfer, I / J registers, I&E and R&P, mutuality and Sec 149 (old 80P) | **Chosen** (R17 §2.2 rank 2) |
| Logistics (forwarders, CHA, 3PL) | R5-B, `freight-fx`, e-Way desk | House-bill margin, CHA disbursements | Later round |
| SaaS / usage billing | Recurring, deferrals | Proration, metering | Small in this market |
| Auto dealers / service | R9 / R10 / 206C(1F) | OEM incentives | Mostly covered |

**Why this segment.**
1. **Size.** Maharashtra alone has **over 1.25 lakh** co-operative housing societies (S, reported with the draft
   Model Bye-laws 2026). Bengaluru, Chennai, Hyderabad, NCR and Pune add apartment owners' associations under the
   apartment-ownership Acts, and every gated colony has an RWA. Each one bills every member every month or quarter,
   keeps statutory funds, collects arrears with interest, and is audited every year.
2. **The leaders bill, but stop short of the books, the GST test and the State rules.** The society apps (MyGate,
   ADDA, NoBrokerHood, ApnaComplex) are cloud, per-flat-priced platforms built around gate security and payments;
   they advertise flat-wise billing, late-payment interest, bank reco and "audit-ready reports" (V), but none of the
   pages read this round shows the ₹7,500 whole-amount test, pass-through exclusion, State interest caps or the
   co-op registers (§2.1). Tally needs a paid third-party "housing society module" (V, ₹12,000 listings). Treasurers
   and the society's accountant therefore keep the bills in an app and the books in Tally or Excel.
3. **The app already holds most of the hard parts.** Batch issue with all-or-nothing numbering (`issueBatch`), Bill
   of Supply vs tax invoice, pure-agent lines (`charge_head_id: 'rule33'`), interest maths (`computeInterest`), fund
   cost centres and fund statements (R5-C4), common credit (R5-C), reminders, statements, the annual pack and bank
   reco. Round 18 is the society glue: units, heads, the run, the test and the registers. That fits ≤ 40 kB.
4. **2026 changed the State rules.**
   - **Maharashtra:** the Maharashtra Co-operative Societies (Amendment) Rules, 2026 (notified 18 Jun 2026, gazetted
     22 Jun 2026, S) insert a housing chapter (Rules 106C-1 … 106C-14). Reported money rules: interest on defaults
     **capped at 12 % simple** (was up to 21 % under model bye-law 72), non-occupancy charges **10 % of service
     charges**, sinking fund **≥ 0.25 %** and repair fund **≥ 0.75 %** a year of the architect-certified construction
     cost, service charges shared **equally per flat**, education contribution ₹10 per member per month (S, all).
     Draft Model Bye-laws 2026 were put out for comments in Aug 2026 (S) and are **not** final.
   - **Karnataka:** the Karnataka Apartment (Ownership and Management) Bill, 2026 (LA Bill 14 of 2026, **P**) would
     replace both 1972 Acts for projects of more than eight apartments: maintenance apportioned by area, dues
     recoverable "together with prescribed interest", a binding dues certificate on transfer, no withholding of
     essential services from defaulters, CA audit filed within six months. Its commencement is by notification; the
     Council passed it (S); whether it is in force was **not** confirmed.
   - **Tamil Nadu:** the Tamil Nadu Apartment Ownership Act, 2022 (**P**) apportions common expenses by the
     percentage of undivided interest, makes the owner liable to interest "at such rate as may be prescribed" and
     requires audit within three months of the year end; Rules 2024 (G.O. (Ms) No. 171, S) were not read.
   - **GST:** no change found to Sl. 77(c) of N 12/2017-CT(R) in the 22 Sep 2025 exemption amendments
     (N 16/2025-CT(R), S); Circular 109/28/2019-GST (**P**) still states the whole-amount rule, which the Madras High
     Court (single judge, 2021) set aside to that extent; the writ appeal's outcome was not found (S).

### 1.2 What a society cannot do in the app today

Checked against the code at `a22544a` (§2.6):

1. **No unit / member master.** `properties` (R5-C5) has units with `name`, `area`, `use` for a landlord's leases. A
   society needs wing / flat, carpet / super-built-up area, undivided-interest %, architect-certified construction
   cost, owner(s), tenant, parking slots, share certificate and nominees, and the history of transfers.
2. **No charge heads with a basis.** Fee plans (R5-C1) have heads with fixed amounts per instalment. A society bill
   is service charges per flat, sinking fund at 0.25 % of each flat's cost, property tax at the municipal rate,
   water by inlets, lift per flat in lifted wings, parking per slot, non-occupancy at 10 % of service charges for let
   flats, education ₹10 — each head with its own basis and its own GST role.
3. **No ₹7,500 test.** The editor cannot decide, per unit and per month, between an exempt Bill of Supply
   (Sl. 77(c)), a tax invoice on the **whole** amount (Circular 109), pass-through statutory dues outside GST
   (CBIC flyer), a plain maintenance bill of an unregistered society, and an 18 % bill for non-member income.
4. **No arrears with capped simple interest on the next bill.** `late-fee.ts` raises a **separate** draft per
   invoice; R8-A interest runs raise one note per party. Societies add "interest on arrears" as a line on the next
   period's bill, at the State-capped simple rate, and apply receipts to interest first (common bye-law practice).
5. **No funds discipline.** R5-C4 funds exist (fund cost centres, fund statement), but nothing moves sinking /
   repair contributions out of income into the fund each period, nor checks the State minimum.
6. **No dues certificate / transfer.** A flat sale needs a dues statement the society stands by (KA Bill s.20(5),
   **P**), the member change in the J register, and the transfer premium typed by the user.
7. **No society accounts.** The annual pack prints a Schedule III P&L and balance sheet. Societies and associations
   present an Income and Expenditure Account and a Receipts and Payments Account; `EntityType` has no society form.
8. **No registers or audit tracker.** Maharashtra societies keep Form J (list of members, Rule 33, S), the I
   register, share and nomination registers, and track the audit report and its rectification.
9. **No income-tax working paper.** Mutuality (member contributions are not income), taxable non-member income
   (tower rent, hall hire), bank interest, and Sec 149 of the Income-tax Act 2025 (successor of Sec 80P) are not
   modelled.

### 1.3 How the society profile switches on (no clutter for others)

- **No new `BusinessType`.** `shop-mode.ts` (first paint) is untouched. The society is a **wizard card**, not a type
  (the R12 / R13 pattern), "Housing society / apartment association / RWA", that sets business type **`nonprofit`**
  (its preset already has recurring, purchases, accounts, banking, reports, TDS, payroll; `registered` adds `gst`) and
  writes an **explicit** `industry_packs` list, so the R5-C donations pack is not switched on by the type.
- Settings field **`society_kind`** (additive; the R12 `agri_kind` … R17 `manpower_kind` approach):

  | `society_kind` | Who | Business type | Packs | Lands on | Why |
  |---|---|---|---|---|---|
  | `chs` | Co-operative housing society (State co-op Act) | `nonprofit` | `society` | `/recurring?tab=society&view=units` | Members, shares, J register, State co-op rules |
  | `aoa` | Apartment owners' association (apartment-ownership Act) | `nonprofit` | `society` | same | Undivided-interest / area apportionment, dues certificate |
  | `rwa` | Resident welfare association (Societies Registration Act / trust) | `nonprofit` | `society` | same | Plain member billing, funds |
  | `commercial` | Premises society / association of a commercial complex | `nonprofit` | `society` | same | Same engine; commercial units (HS8) |
  | `agency` | Maintenance agency / builder's maintenance company billing owners | `services` | `society` | `/recurring?tab=society&view=bills` | Same units and heads, always 18 % (not the members' own body, HS16) |

- **One new pack** `society` in `industry-packs.ts` (lazy; `PackId` is a type, zero bytes). `PACK_OF_TYPE`,
  `PACK_OF_TYPE_INLINE` and `PACK_ROUTES` are unchanged.
- **Placement: one desk, never a new route or sidebar item.**
  - One new row in `RECURRING_TABS` (`page-tabs.ts`): `{ id: 'society', pack: 'society' }` (the R5-C `fees` / `leases`
    precedent: periodic billing lives on Recurring).
  - The desk `components/society/SocietyDesk.tsx` is mounted lazily from `Recurring.tsx` (one `lazy()` row, the
    `BatchTab` pattern).
  - **Seven views** in `&view=`: `units`, `heads` (A), `bills`, `gst` (B), `dues` (C), `funds`, `registers` (D).
  - Existing tabs gain `society` in `alsoPacks` where they serve it: Books → `funds` (R5-C4) and GST reports →
    `common-credit` (R5-C). No other page changes.
- Settings → Features shows a **"Society profile"** row for every `nonprofit` and `services` company (and "Custom").
  Turning the pack off deletes nothing.
- The **society paper** (A4) is not pack-gated: it prints whenever a document carries the `hs` snapshot.

### 1.4 Budgets the round must respect

Baseline: the lead's measurement on `a22544a` (first paint **182.1 kB**, core **≈ 3,136 kB**); the R17-D notes in
`docs/features/manpower-r17.md` record 182.2 / 3,135.3 kB normalized before the QA20 fixes. The PRD author did not
rebuild (no `node_modules` in the worktree); **R18-A measures the baseline before its first commit** and records it in
`docs/features/society-r18.md`.

| Budget | Now | Limit | Headroom | Round 18 share |
|---|---|---|---|---|
| Initial JS (first paint) | **182.1 kB** | 185 kB | 2.9 kB | **0** (the `hs` record-key token lands in the lazy `invoice-defaults` chunk, as `mp` did) |
| Entry chunk | ≈ 88 kB | 100 kB | ≈ 12 kB | 0 |
| Core precache (English) | **≈ 3,136 kB** | 3,300 kB | ≈ 164 kB | **≤ 40 kB gross for the whole round** (A ≤ 11, B ≤ 10, C ≤ 9, D ≤ 9; 1 kB reserve held by the lead) |
| Hindi pack | ≈ 344.4 kB | 400 kB | ≈ 55 kB | ≤ 8 kB (`lang-hi-society` family pack) |
| Hindi left in English chunks | 21.4 kB | 36 kB | 14.6 kB | **0** (literal `defineArea(en, hi)` everywhere) |
| `lazy-leaves` | 16.8 kB | 20 kB | 3.2 kB | ≤ 0.3 kB (new leaves belong in `f-society`) |

Calibration (English only, after the R16-A Hindi split): R17-A–B ≈ +17 kB for 8 items; R17-C + D **+11.3 kB** for 7
items against caps of 16. So **≈ 2–2.5 kB per item with a view, ≈ 0.8–1 kB per engine-only item**. Round 18 plans
**16 items** with a pre-ranked cut list per package (§3). A package that reaches its cap cuts; it does not ask.

Rules:
- **First paint.** Nothing. `store/invoice-defaults.ts` (the `hs` token), `industry-packs.ts`, `page-tabs.ts`,
  `Recurring.tsx`, `TemplateEngine.tsx`, `annual-pack.ts` and `NotificationBell.tsx` are lazy on `a22544a` (A re-checks
  `build-meta/chunks.json`: the initial files are `index`, `rolldown-runtime`, `vendor-react`, `vendor-ui`). No
  `PACK_ROUTES`, `PACK_OF_TYPE`, `TABLE_ACTIONS`, `WATCHED_TABLES`, `no-cash.ts`, `tax-rules.ts`, `tds-rules.ts`,
  `ita2025.ts`, `shop-mode.ts`, `dates.ts` or shell edit. Any new lucide icon is refused (§1.5).
- **Family chunk group.** A adds **one row** to `vite.config.ts`:
  `safeFamilyGroup(graph, 'f-society', familyRe('society', 'society-rules', 'society-r18', 'hs-registry'), 12)` and the
  name to `tests/bundle-config.test.ts` (with the R17 test shape: the regex captures `src/lib/society/hs-bill.ts`,
  `src/lib/society-rules.ts`, `src/i18n/areas/society-r18a.ts`; not `hs-registry.ts` and not `-pick` areas).
  - A module joins only if every static import is first paint, vendor or another safe member
    (`scripts/vite-safe-groups.mjs`). **Engines in `src/lib/society/` import only first-paint modules (`storage`,
    `invoice-calc`, `tax-rules` `ruleAt`, `dates`, `access`, `localDb` …), `society-rules.ts` and each other.**
  - Shared lazy code (`batch-invoices.ts` `issueBatch` / `undoBatch`, `interest.ts` `computeInterest`, `cost-centres.ts`,
    `nonprofit/funds.ts`, `ledger/*`, `bank-rules.ts`, `reminders.ts`) is reached only through **bridge modules
    `hs-*-io.ts`** (≤ 4: `hs-issue-io`, `hs-dues-io`, `hs-books-io`, `hs-bank-io`), which stay outside the group. Engines
    take their data as arguments.
  - After each package `build-meta/chunks.json` must show `f-society` holding every engine and the rules module; a test
    in `tests/hs-rules.test.ts` reads the family regex and the import graph.
- **Hindi.** One area per package, each `defineArea(en, hi)` with a **literal** Hindi object: `society-r18a.ts` …
  `society-r18d.ts`, ≤ 1.1 kB gz English each. Shared words (unit, flat, wing, member, owner, tenant, head, period,
  arrears, fund, maintenance) live once in `society-r18a.ts`. The split puts them in `lang-hi-society`.
- **Help** ≤ 160 characters per topic per language; statutory detail by CA id (`ca: ['HS1']`).
- **Rule data is a chunk.** Statutory and State values go in **`src/lib/society-rules.ts`** (new), imported only by
  lazy society modules, never by `tax-rules.ts`, `tds-rules.ts`, `shop-mode.ts` or the shell. Values that already live
  elsewhere stay there and are reached through bridges: TDS sections and rates (`tds-rules.ts`), Act labels
  (`ita2025.ts`), GST slabs (`tax-rules.ts`), the R17 security RCM row (`manpower-rules.ts` `SECURITY_RCM_RULES`, read
  by `hs-books-io.ts` for the inward-RCM hint only).
- **No new shared components, no stubs.** Reuse `LinesGrid`, `ItemFilterBar`, `controls.module.css`, the R15 `useRun`
  pattern, `escHtml` for every print window, `csv.ts` / dynamic `xlsx.ts` with `import-mapping.ts` for the unit import,
  `issueBatch` / `undoBatch` for runs, `computeInterest` for interest, statement styles (R2-A) for member statements.

### 1.5 Icons

Every lucide icon is in the first-paint `vendor-ui` chunk; reuse only. Files importing each on `a22544a`
(single-line import grep; multi-line imports add more): `Building2` 8, `Receipt` 10, `Percent` 10, `Wallet` 10,
`PiggyBank` 2, `BookOpen` 8, `Users` 10, `KeyRound` 6, `Landmark` 12. The desk uses `Building2` (units), `Receipt`
(bills), `Percent` (GST test), `Wallet` (dues), `PiggyBank` (funds), `BookOpen` (registers), `KeyRound` (transfer).
**`Home`, `House`, `Droplets` and `Car` (2 files only — avoid) are not to be added or spread.** A re-greps before its
first commit and substitutes `Building2` for any name that turns out not to be imported.

### 1.6 Non-goals

- **Live connections.** Payment gateways, UPI collect requests, auto-debit, municipal property-tax portals, electricity
  board APIs, GST / TRACES portals, society apps' APIs, visitor / gate management, intercom, CCTV.
- **Community features.** Notices, polls, complaints / help desk, amenity booking, visitor logs, domestic-staff
  attendance. (The app is the treasurer's books, not the residents' app.)
- **Elections, meetings and redevelopment.** AGM minutes, election process, redevelopment / self-redevelopment
  tendering and the MH borrowing limits (Rule 106C-10, S).
- **Statutory forms filing.** No Form Y-6 recovery application, no co-op department return upload; prints and
  checklists only.
- **Bye-law engine.** The app stores the **money rules** of a State (caps, minimum fund %, apportionment bases) as
  data; it does not model governance bye-laws.
- **Deferred:** utility sub-metering with meter readings beyond a typed quantity per unit; water-tanker logistics;
  piped-gas reselling.

---

## 2. Findings

### 2.1 What the leaders offer (research)

| Product | What it does for societies | Gap for this app's users | Source |
|---|---|---|---|
| ADDA (ADDA Books) | Flat-wise sub-ledgers, automated invoices "with pre-configured formulas", utility billing (water, electricity, DG, gas), late-payment interest and defaulter tracking, bank reconciliation, budgeting, purchase approvals, "audit-ready reports"; positions itself as replacing Tally | Cloud, per-flat subscription; the pages read do not show the ₹7,500 whole-amount test, pass-through exclusion, State caps, J / I registers or Sec 149 | V ind.adda.io/society-accounting-software, V ind.adda.io/adda-books |
| MyGate | Gate security first; accounting module; pricing not published (aggregators: ₹3–10 / flat / month) | Reviewers say "accounting section can be enhanced" | S Capterra / softwareadvice reviews; V mygate.com blog |
| NoBrokerHood | Billing, accounting with balance sheet, utility payments | Same as above; argues stock Tally "is not designed for residential communities" | V nobrokerhood.com; S comparisons |
| ApnaComplex | Automated society billing, collections; "fully GST compliant" | Pricing on request (₹4–12 / flat / month reported) | V techjockey listing; S comparisons |
| Tally Prime | General ledger; third-party "housing society module" TDLs sold separately (₹12,000 listings) | Bills, ₹7,500 test and registers need a TDL or Excel | V indiamart listings; S gitnux round-up |
| Saraswat Bank "SocietyConnekt" | Bank-provided billing and accounting | Tied to one bank | V |

### 2.2 Candidate segments scored

| Candidate | Size (as reported) | Already in the app | Value | Effort | Score |
|---|---|---|---|---|---|
| **Housing societies / AOAs / RWAs** | > 1.25 lakh CHS in Maharashtra (S); AOAs / RWAs in every metro | Funds, fees runs, batch issue, interest, reminders, annual pack | **4** | M (reuse makes L → M) | **2.0** |
| Logistics (forwarders, CHA, 3PL) | Many | R5-B, freight-fx, e-Way | 3 | M | 1.5 |
| SaaS / usage billing | Small here | Recurring, deferrals | 2 | M | 1.0 |
| Auto dealers / service | FADA networks | R9 / R10 | 2 | M | 1.0 |

### 2.3 Anatomy of a society's month (every element needs a place)

| # | Element | Doc / screen | Today | → |
|---|---|---|---|---|
| 1 | Units (wing / flat / shop / garage), areas, construction cost, owners, tenants, parking slots | Unit register | — (`properties` is a landlord's) | A2 |
| 2 | Charge heads: service charges, sinking / repair / major-repair funds, property tax, water, lift, parking, non-occupancy, education, election, insurance, lease rent, DG electricity, other | Tariff | — | A3 |
| 3 | Apportionment basis per head: per unit, carpet / super area, undivided %, construction-cost %, per slot, per inlet, typed per unit | Tariff | — | A3 |
| 4 | Billing run for a period (monthly / quarterly), one bill per unit, numbering in one batch, undo | Bills | Fee runs only | B1 |
| 5 | GST per unit: ₹7,500 × months test on member heads, whole amount if above, pass-through heads outside, non-member income 18 %, unregistered society | Bill type and declaration | Manual | B2 |
| 6 | Turnover vs ₹20 lakh, ITC split (Rule 42 / 43), inward RCM on security / GTA | GST view | Common credit (R5-C) only | B3 |
| 7 | Special levy (painting, lift replacement) by area, once | Supplementary bill | — | B4 |
| 8 | Arrears brought forward and interest on arrears on the next bill (State cap, simple); receipts → interest first | Bill + dues | Separate late-fee drafts | C1 |
| 9 | Member statement, dues certificate / NOC on sale, transfer of membership with premium | Dues | Statements only | C2 |
| 10 | Defaulter list, reminders (never "disconnect water"), follow-ups | Dues | R2-A (generic) | C3 |
| 11 | Receipts from the bank statement matched to units by narration ("A-101") | Bank reco | Generic rules | C4 |
| 12 | Sinking / repair contributions moved to the funds; fund minimum check; fund statement | Funds | R5-C4 statement only | D1 |
| 13 | Income and Expenditure + Receipts and Payments for the AGM and audit | Annual pack | Schedule III only | D2 |
| 14 | J register, I register, share and nomination registers; audit due date and rectification | Registers | — | D3 |
| 15 | Income tax: mutual vs non-mutual income, Sec 149 / 80P sheet, TDS duties as payer | Registers (tax section) | — | D4 |

### 2.4 Statutory and State rules (as understood; every row is a CA item)

`verified` follows the header rule: **true only when the value was read in a primary text this round.**

**GST**

| # | Rule | Value used by the app | From | Source read | verified | CA |
|---|---|---|---|---|---|---|
| 1 | Exemption: service by an unincorporated body / registered non-profit entity to its own members by way of reimbursement or share of contribution "up to an amount of … per month per member for sourcing of goods or services from a third person for the common use of its members in a housing society or a residential complex" (N 12/2017-CT(R) Sl. 77(c)) | ₹5,000 | 2017-07-01 | **P** N 12/2017-CT(R) 2017 text, Sl. 77 (gstcouncil.gov.in PDF) | true | HS1 |
| 2 | Same limit raised to ₹7,500 by N 2/2018-CT(R) | ₹7,500 | 2018-01-25 | **P** Circular 109/28/2019-GST Q1 (cbic-gst.gov.in PDF, states the amendment); N 2/2018 text itself **not read** | true (via the circular) | HS1 |
| 3 | Sl. 77(c) unchanged by the 22 Sep 2025 services amendments | ₹7,500 continues | 2025-09-22 | **S** cleartax / gstgyaan summaries of N 16/2025-CT(R) (no Sl. 77 change reported) | **false** | HS1 |
| 4 | Above ₹7,500 the **entire** amount is taxable (₹9,000 → GST on ₹9,000, not ₹1,500) | `valuation: 'whole'` default | 2019-07-22 | **P** Circular 109 Q5; **P** CBIC flyer "GST on Housing Societies" | true (circular text) | HS2 |
| 5 | Madras HC (TVH Lumbini Square / Greenwood Owners Assn., single judge, 2021) quashed the circular to that extent; writ appeals W.A. 2318 / 2321 of 2021 | Setting `valuation: 'excess'` offered, never default | 2021 | **S** caclubindia (two articles), cleartax news; judgment **not read**; appeal outcome **not found** | **false** | HS2 |
| 6 | Limit applies per residential apartment for a person owning two or more | Test per unit, not per member | 2019-07-22 | **P** Circular 109 Q4 | true | HS1 |
| 7 | RWA with aggregate turnover ≤ ₹20 lakh need not register or pay GST even above ₹7,500; GST only if **both** > ₹7,500 and turnover ≥ ₹20 lakh | Monitor + hint | 2019-07-22 | **P** Circular 109 Q2 and table | true | HS4 |
| 8 | Special-category States threshold (₹10 lakh) | Row by State | — | not read | **false** | HS4 |
| 9 | RWAs entitled to ITC on capital goods (generators, pumps, lawn furniture), goods (taps, pipes, sanitary) and input services (repair and maintenance) | ITC allowed; Rule 42 / 43 through R5-C common credit | 2019-07-22 | **P** Circular 109 Q3; **P** CBIC flyer | true | HS11 |
| 10 | Property tax, water tax, NA tax, electricity charges collected for the authority under other statutes: not leviable; **excluded** from the ₹7,500 computation | Head kind `statutory` → pure-agent line (`charge_head_id: 'rule33'`), outside the test | — | **P** CBIC flyer (DGTS, CBIC) Q&A; S cleartax | true (flyer) | HS3, HS6 |
| 11 | Electricity from the society's generator, drinking water or any other service by the society: taxable | Head kind `service_supply` → counted | — | **P** CBIC flyer | true (flyer) | HS12 |
| 12 | Sinking fund, repairs and maintenance fund, car parking, non-occupancy charges, simple interest for late payment "attract GST, as these charges are collected … for supply of services meant for its members" | Counted in the test and taxed with the bill | — | **P** CBIC flyer | true (flyer); counting interest in the month's test **false** | HS3, HS7, HS13 |
| 13 | Rate: Heading 9995 "Services of membership organisations" 9 % CGST (18 % in all) | 18 % | 2017-07-01 | **P** N 11/2017-CT(R) Sl. 33 (2017 text) | true (2017 row); "unchanged after 22 Sep 2025" **false** | HS10 |
| 14 | SAC 999598 "Home owners associations" | Default SAC for member heads | 2017-07-01 | **P** annexure to N 11/2017-CT(R) row 666 | true | HS10 |
| 15 | A society is a "person" (Sec 2(84)); provision of facilities to members is "business" (Sec 2(17)(e)); a society exclusively making exempt supplies need not register (Sec 23(1)(a)) | Unregistered mode allowed | — | **P** CBIC flyer (quotes the Act) | true (as quoted) | HS4, HS14 |
| 16 | Interest / late fee for delayed payment is part of the value (Sec 15(2)(d)) | Interest line takes the bill's GST treatment | — | existing app rule (`late-fee.ts`, G6 / TR18) | existing | HS7 |
| 17 | Security services from a person other than a body corporate to a **registered** society: RCM (entry 14) | Inward-RCM hint on purchase bills | 2019-01-01 | existing R17 row (**P** in R17) | existing | HS15 |
| 18 | GTA services to "any society registered under any law" / co-op society: RCM (entry 1) | Existing `GTA` recipient kinds | 2017-07-01 | existing `transport-works-rules.ts` | existing | HS15 |

**Income tax (Income-tax Act 2025 from 1 Apr 2026)**

| # | Rule | Value used by the app | From | Source read | verified | CA |
|---|---|---|---|---|---|---|
| 19 | Principle of mutuality: members' contributions for common purposes and the surplus are not income; non-member income and interest from banks are | Income split mutual / non-mutual in D4 | — | **S** practitioner articles; case law not read | **false** | HS20 |
| 20 | Sec 149 ITA 2025 "Deduction in respect of income of co-operative societies" succeeds Sec 80P: (2)(c) other income up to ₹50,000 (₹1 lakh consumers' society); (2)(d) interest / dividends from investments with another co-operative society; (2)(e) letting of godowns; (5) excludes co-operative banks | Working-paper lines with labels by date | 2026-04-01 | **S** taxheal reproduction of the Act; thetaxcorp, taxguru commentary; incometaxindia section page **403** | **false** | HS21, HS22 |
| 21 | Sec 80P (1961 Act) for years up to 2025-26 | Label by date | to 2026-03-31 | existing knowledge; **not read** | **false** | HS22 |
| 22 | TDS by the society as payer (contractor, professional / audit fee, rent) | Existing `tds-rules.ts` rows through the payables desk | existing | existing | existing | HS23 |

**State co-operative / apartment law (data rows `STATE_SOCIETY_RULES`, keyed by State code)**

| # | State | Rule | Value | From | Source read | verified | CA |
|---|---|---|---|---|---|---|---|
| 23 | MH (27) | Interest on delayed payment: rate fixed by the general body, max 21 % p.a. simple (model bye-law 72) | cap 21 | 2014-01-01 (model bye-laws) | **S** indiancooperative, moneylife | **false** | HS26 |
| 24 | MH | Interest on defaults capped at 12 % simple p.a. (Rule 106C-12, MCS (Amendment) Rules 2026; notified 18 Jun, gazetted 22 Jun, "effective 30 Jun" reported) | cap 12 | 2026-06-22 (date itself a CA item) | **S** taxguru (two articles), trilegal, KSandK, FPJ | **false** | HS26 |
| 25 | MH | Non-occupancy charges = 10 % of service charges | 10 % | 2026-06-22 (GR of 2001 earlier, not read) | **S** taxguru, propnewstime | **false** | HS19 |
| 26 | MH | Sinking fund ≥ 0.25 % p.a. and repair fund ≥ 0.75 % p.a. of the architect-certified construction cost of each flat | 0.25 / 0.75 (minimum hint) | 2026-06-22 (bye-law 13(c) earlier) | **S** taxguru, moneylife | **false** | HS27 |
| 27 | MH | Apportionment: service charges equally per flat; property tax at the local rate, common share by carpet area; water by inlets; lift per flat in lifted buildings; insurance and lease rent by carpet area; parking at the general-body rate | Bases per head kind | 2026-06-22 | **S** taxguru | **false** | HS28 |
| 28 | MH | Education contribution ₹10 per member per month; entrance fee ₹500 | 10 / 500 | 2026-06-22 | **S** taxguru | **false** | HS29 |
| 29 | MH | Form J list of members (Rule 33); nomination register (Rule 32 / 106C-9); recovery application Form Y-6 (Rule 106C-14) | Register prints | — | **S** taxguru | **false** | HS30 |
| 30 | MH | Audit: Sec 81 annual audit by a panel auditor; rectification report | Due-date tracker | — | **S** taxguru, WIRC-ICAI decks | **false** | HS31 |
| 31 | MH | Draft Model Bye-laws 2026 (12 % interest, equal common charges, area-based insurance) | **Not a rule row** (pending note) | Aug 2026 (draft) | **S** propnewstime, moneylife (403) | — | HS32 |
| 32 | KA (29) | Maintenance charges apportioned by **super built-up area** (Bill s.2(t)); common expenses by **private area** (s.9) — the bill is internally inconsistent | Basis `area_super` default, `area_carpet` allowed | on commencement | **P** LA Bill 14 of 2026 (PRS PDF read) | true (bill text); in force **false** | HS33 |
| 33 | KA | Dues recoverable "together with prescribed interest and costs"; binding certificate of unpaid common expenses on transfer (s.20(5)); purchaser jointly liable (s.20(4)); essential services (water, electricity, sanitation, lift, fire safety, access) never withheld (s.20(6) proviso) | Interest cap `null` (prescribed, not read); dues certificate; reminder wording | on commencement | **P** Bill text | true (bill text) | HS33 |
| 34 | KA | Books (R&P, I&E, balance sheet), CA audit annually, audited statement filed within six months (s.28) | Audit due = FY end + 6 months | on commencement | **P** Bill text | true (bill text) | HS33 |
| 35 | KA | Applies to projects of more than eight apartments (s.1(3)); repeals the 1972 Acts | Hint | on commencement | **P** Bill text | true | HS33 |
| 36 | TN (33) | Common expenses charged by the percentage of undivided interest (s.18(1)); recoverable from the occupier when the owner is not in occupation (s.18(3)); interest "at such rate as may be prescribed" (s.18(4)) | Basis `undivided_pct`; cap `null` | 2024-03-06 (commencement as reported) | **P** TN Act 44 of 2022 (PRS PDF read); commencement **S** JSA | true (Act text); date **false** | HS34 |
| 37 | TN | Accounts audited within three months of the FY end; filed with the competent authority (s.21) | Audit due = FY end + 3 months | same | **P** Act text | true | HS34 |
| 38 | TN | Each apartment assessed separately for property tax (s.20) | Property-tax head typed per unit | same | **P** Act text | true | HS44 |
| 39 | DL (07) | DCS Act 2003 / Rules 2007: interest on dues (9 % reported on a forum; 15 % on a blog), Rule 80 special audit, Rule 106 maintenance duty | cap `null` | — | **S** only | **false** | HS35 |
| 40 | other | No caps; user types interest rate and fund % | — | — | — | — | HS36 |

Not found this round: the Madras HC writ-appeal outcome; the TN Rules 2024 interest rate; the KA Act's
commencement notification; a final Maharashtra Model Bye-laws 2026; a primary copy of the MCS (Amendment) Rules 2026
(Gazette not reached); the enacted text of Sec 149 on an official site (403).

### 2.5 What changed in 2025–2026 for these bodies

| Change | Effective | App today | → |
|---|---|---|---|
| GST 2.0 services exemptions (N 16/2025-CT(R)) — no Sl. 77 change reported | 22 Sep 2025 | — | Row 3 `verified: false`; HS1 |
| Income-tax Act 2025: Sec 80P → Sec 149; TDS sections → Sec 393 | 1 Apr 2026 | `ita2025.ts` labels for TDS | D4 labels by date |
| MH MCS (Amendment) Rules 2026: housing chapter, interest cap 12 %, NOC 10 %, fund minimums | Jun 2026 | — | Rule rows 24–29 |
| MH draft Model Bye-laws 2026 | Draft, Aug 2026 | — | Pending note (R16-D4 list), not a row |
| KA Apartment (Ownership and Management) Bill 2026 | On notification | — | Rows 32–35 tagged `in_force: false` until the user confirms |
| 57th GST Council (8 Oct 2026) | Recommendation | R16-D4 list | Nothing society-specific found |

### 2.6 Verified against the code (`a22544a`)

| Area | Finding | File |
|---|---|---|
| Batch issue | `issueBatch(drafts, {sourceId, sourceKind, date, mode, force})` all-or-nothing, own FY series per doc type; `undoBatch` cancels with a reason | `src/lib/batch-invoices.ts:265, 320` |
| Fee runs | Bill of Supply / tax invoice split per student over `issueBatch`, `fee_runs` row, idempotent per (student, plan, instalment, kind) | `src/lib/institutions/fee-billing.ts` |
| Interest | `computeInterest` (simple, 365 days, part-payments reduce the balance from their date); `late-fee.ts` raises a separate draft; R8-A `tr-interest.ts` interest runs with `interest_run_id` | `src/lib/interest.ts:234`, `src/lib/late-fee.ts`, `src/lib/trade/tr-interest.ts` |
| Funds | Fund = cost centre kind `fund` with `fund: { nature … }`; fund statement from posting lines tagged with the fund; inter-fund transfer journal | `src/lib/nonprofit/funds.ts`, `fund-statement.ts` |
| Sales postings | Every sales line credits `A.sales`, split by cost centre (`itemsByCostCentre`) — no per-head income ledger | `src/lib/ledger/postings.ts:225–262` |
| Properties | `PropertyUnit { id, name, area?, use }` inside `Property` (R5-C5, landlord leases, `lease-gst.ts` drives GST by use) | `src/types/institutions-r5.ts:168` |
| Entity type | `EntityType = 'proprietorship' \| 'partnership' \| 'llp' \| 'company'`; annual pack prints Schedule III | `src/types/books-r2.ts:131`, `src/lib/ledger/annual-pack.ts` |
| Doc types | `BILL_OF_SUPPLY` (own `BOS` series) for exempt supplies; `isRevenueDoc` counts it | `src/types/invoice.ts`, `src/lib/stats.ts:18` |
| Pure agent | `charge_head_id: 'rule33'` (R14 / R15) | `src/lib/prof/ps-disb.ts`, `src/lib/travel/tv-air-value.ts` |
| Tabs | `RECURRING_TABS` has `fees` / `leases` pack rows; Books `funds` pack `nonprofit`; GST `common-credit` with `alsoPacks` | `src/pages/page-tabs.ts:146–151, 29`; `src/lib/industry-packs.ts:115` |
| Record keys | `R9_RECORD_KEYS = ['delivery', 'kyc', 'sv', …R12…R17]` | `src/store/invoice-defaults.ts:186` |
| Family groups | ten `f-*` rows, last `f-manpower` | `vite.config.ts:67–77` |
| Command palette | "batch" already lists keyword `society` | `src/components/command/sales-r2-destinations.ts:8` |
| Nothing for units / ₹7,500 / Sl. 77 / sinking fund / J register | grep for `7500`, `77(c)`, `sinking`, `999598`, `J register`: none | — |

### 2.7 Size measurements

Not re-measured by the PRD author (§1.4). Family chunks on the R17 notes: `f-manpower` 11.6 kB, DeployDesk 11.9 kB.
R18-A records `f-society` and `SocietyDesk` sizes after each package.

### 2.8 Sources

Accessed 28 Oct 2026.

**GST (primary first)**
- **P** Circular No. 109/28/2019-GST, 22 Jul 2019 — https://cbic-gst.gov.in/pdf/circular-cgst-109n.pdf (downloaded, text
  extracted: Q1 ₹5,000 → ₹7,500 from 25 Jan 2018 citing N 2/2018-CT(R); Q2 ₹20 lakh and the both-conditions table;
  Q3 ITC; Q4 per apartment; Q5 entire amount, ₹9,000 example)
- **P** CBIC (Directorate General of Taxpayer Services) flyer "GST on Housing Societies" —
  https://www.gstcouncil.gov.in/sites/default/files/e-version-gst-flyers/GST_ON_Co-operative_housing_Societies0509.pdf
  (downloaded and read: Sec 2(17)(e), 2(84); Sl. 77; statutory dues excluded from the limit; generator electricity /
  drinking water taxable; sinking fund, repair fund, parking, non-occupancy, interest "attract GST"; Sec 23(1)(a))
- **P** N 12/2017-CT(R), 28 Jun 2017 — https://gstcouncil.gov.in/sites/default/files/2024-05/download_6_0.pdf (Sl. 77
  text with ₹5,000)
- **P** N 11/2017-CT(R) — https://gstcouncil.gov.in/sites/default/files/2024-05/download_4.pdf (Sl. 33 Heading 9995, 9 %)
  and annexure https://gstcouncil.gov.in/sites/default/files/2024-05/notification11-cgst-annexure.pdf (999598 Home
  owners associations)
- S N 2/2018-CT(R) listing — https://gstcouncil.gov.in/node/4472 (text not read)
- S N 16/2025-CT(R) summaries — https://cleartax.in/s/gst-notifications-summary ; https://gstgyaan.com/notification-no-16-2025-central-tax-rate
- S Madras HC — https://www.caclubindia.com/articles/dispute-valuation-supply-services-by-rwas-to-their-members-45216.asp ;
  https://www.caclubindia.com/judiciary/single-bench-order-w-r-t-exemption-provided-to-contribution-upto-rs-7-500-pm-to-rwa-under-challenge-before-db-4441.asp ;
  https://news.cleartax.in/?p=6641
- S AAR West Bengal (Prinsep Association of Apartment Owners) —
  https://gstcouncil.gov.in/sites/default/files/AAR/prinsep_association_of_apartment_owners_advance_ruling.pdf (listed,
  not read); explainers https://www.taxscan.in/top-stories/gst-on-rwa-maintenance-charges-threshold-exemption-itc-rules-1448115 ,
  https://cleartax.in/s/gst-housing-maintenance-charges

**Income tax**
- S Sec 149 ITA 2025 — https://www.taxheal.com/section-149-income-tax-act-2025-2.html ;
  https://thetaxcorp.in/article/new-tax-rules-for-co-operative-societies-under-income-tax-act-2025-complete ;
  https://taxguru.in/income-tax/taxation-co-operative-societies-income-tax-act-2025.html ; official page
  https://www.incometaxindia.gov.in/w/section-150-90 (HTTP 403, not read)

**State law**
- **P** Karnataka Apartment (Ownership and Management) Bill, 2026 (LA Bill 14 of 2026) —
  https://prsindia.org/files/bills_acts/bills_states/karnataka/2026/Bill14of2026KA.pdf (downloaded and read: s.1(3),
  2(t), 9, 20(4)–(6), 28)
- **P** Tamil Nadu Apartment Ownership Act, 2022 (Act 44 of 2022) —
  https://PRSINDIA.org/files/bills_acts/acts_states/tamil-nadu/2022/ActNo44of2022TamilNadu.pdf (downloaded and read:
  s.18, 19, 20, 21)
- S Maharashtra Co-operative Societies (Amendment) Rules, 2026 — https://taxguru.in/corporate-law/maharashtra-overhauls-co-operative-housing-society-rules.html ;
  https://taxguru.in/corporate-law/maharashtra-co-operative-societies-amendment-rules-2026.html ;
  https://trilegal.com/knowledge-repository/update/redevelopment-reform-and-the-next-phase-of-co-operative-housing-governance-in-maharashtra/ ;
  https://ksandk.com/real-estate/maharashtra-co-operative-societies-amendment-rules-2026/ ;
  https://www.freepressjournal.in/mumbai/maharashtra-notifies-new-co-operative-housing-society-rules-bringing-dedicated-legal-framework
- S Model bye-laws (bye-law 13(c), 72) — https://www.indiancooperative.com/?p=13355 ;
  https://moneylife.in/article/housing-society-problems-and-solutions-calculating-repair-and-sinking-fund-and-adding-property-tax-to-maintenance/71120.html
- S Draft Model Bye-laws 2026 — https://propnewstime.com/latestnewsstories/MzQ3ODU=/maharashtra-releases-draft-model-bye-laws-2026-for-housing-societies ;
  https://housing.com/news/maharashtra-proposes-new-rules-for-cooperative-housing-societies-draft-shared-for-feedback/
- S Karnataka bill status — https://www.deccanchronicle.com/amp/southern-states/karnataka/karnataka-legislative-council-passes-2-bills-amid-bjp-din-1981804 ;
  https://ksandk.com/newsletter/karnataka-apartment-bill-2026-2/
- S Tamil Nadu commencement / Rules — https://jsalaw.com/wp-content/uploads/2024/10/JSA-Prism-Real-Estate-October-2024-TN-Apartment-Ownership.Final_.pdf ;
  https://housing.com/news/provisions-of-tamil-nadu-apartment-ownership-act-2022
- S Delhi — https://www.lawyersclubindia.com/forum/why-housing-co-opearative-society-is-not-allowed-to-charge-interest-from-defaulters-of-service-charg-228756.asp ;
  https://www.nobrokerhood.com/blog/delhi-cooperative-group-housing-society/ ; https://rcs.delhi.gov.in (rules listed, not read)
- S Maharashtra audit — https://old.wirc-icai.org/images/material/Audit-CHS-Ameet-Israni.pdf ;
  https://taxguru.in/finance/audit-of-co-operative-housing-credit-societies-in-maharashtra.html

**Market and products**
- V https://ind.adda.io/society-accounting-software (fetched) ; https://ind.adda.io/adda-books ;
  https://www.nobrokerhood.com/solutions/society-billing-software ; https://www.techjockey.com/detail/apnacomplex ;
  https://mygate.com/blog/housing-society/maintenance-billing-software/ ; https://www.indiamart.com/jineshenterprisesmumbai/tally-add-on-solution.html
- S https://www.capterra.com/p/212555/MyGate/reviews/ ; https://www.softwaresuggest.com/compare/mygate-vs-apnacomplex ;
  https://gitnux.org/best/housing-society-accounting-software/

---

## 3. Ranked list: what to build now

Value 1–5. Effort S = 1, M = 2, L = 3. Score = value ÷ effort. **Cut** = the order a package drops items at its cap
(1 = first to go; "never" items stay).

| Rank | Id | Gap | Who | Value | Effort | Score | Pkg | Cut |
|---|---|---|---|---|---|---|---|---|
| 1 | A1 | Society profile (wizard card, kinds, pack, desk tab, checklist, demo) + build plumbing (family group, `HS` regexes, registry, rules, `hs` key) | all | 5 | S | 5.0 | A | never |
| 2 | B2 | GST per unit: ₹7,500 test, whole / excess, pass-through, non-member, unregistered, agency | all | 5 | S | 5.0 | B | never |
| 3 | A3 | Charge heads, bases and State rule sets (apportionment engine) | all | 5 | M | 2.5 | A | 2 (drop `inlets` / `lift` bases; keep per-unit, area, undivided %, cost %, per slot, typed) |
| 4 | A2 | Units and members (owner / joint / tenant, parking, cost, areas) + CSV / XLSX import | all | 5 | M | 2.5 | A | 3 (drop the import; keep the grid) |
| 5 | B1 | Billing run for a period (one bill per unit, one batch, undo) | all | 5 | M | 2.5 | B | never |
| 6 | C1 | Arrears and interest on the next bill (State cap, simple, receipts → interest first) | all | 5 | M | 2.5 | C | never |
| 7 | A4 | Society bill paper (`hs` block: unit, period, heads with basis, arrears, interest, regime declaration) | all | 4 | S | 4.0 | A | 1 (drop the "how your bill is worked out" footnote; keep the heads table) |
| 8 | C2 | Member statement, dues certificate, transfer of membership | all | 4 | M | 2.0 | C | 2 (drop transfer history; keep certificate + statement) |
| 9 | D1 | Funds: period transfer journal, minimum check, fund statement link | all | 4 | M | 2.0 | D | never |
| 10 | B3 | Turnover monitor (₹20 lakh), ITC split link, inward-RCM hint | registered | 3 | S | 3.0 | B | 2 (drop the RCM hint) |
| 11 | C3 | Defaulters and reminders with society wording (no essential-service threats) | all | 3 | S | 3.0 | C | 3 |
| 12 | D2 | Income and Expenditure / Receipts and Payments (entity forms `cooperative`, `association`) | all | 4 | M | 2.0 | D | 3 (drop R&P; keep the I&E label swap) |
| 13 | D3 | Registers (J, I, share, nomination) + audit due / rectification tracker | chs | 3 | M | 1.5 | D | 2 (drop share / nomination; keep J + audit) |
| 14 | D4 | Income-tax working paper (mutual / non-mutual, Sec 149 / 80P lines by date) | all | 3 | S | 3.0 | D | 1 |
| 15 | C4 | Bank receipts matched to units by narration | all | 3 | S | 3.0 | C | 1 |
| 16 | B4 | Special levy (supplementary bill by area, once) | all | 2 | S | 2.0 | B | 1 |
| — | — | Payment gateway / UPI collect, auto-debit | all | 4 | L | 1.3 | no (network) | — |
| — | — | Notices, polls, help desk, amenity booking, gate | all | 3 | L | 1.0 | no (not books) | — |
| — | — | Utility sub-metering with readings | some | 2 | M | 1.0 | no (typed quantity only) | — |

All 16 are planned. The cut column, not a renegotiation, decides what happens at a cap.

---

## 4. Specifications (16 items)

Conventions for every item:
- **Logic and tests.** Pure logic in `src/lib/society/hs-*.ts` (new folder; family group `f-society`), bridges in
  `src/lib/society/hs-*-io.ts` (§1.4), tests with `node:test` in `tests/hs-*.test.ts`. UI checks are `step(...)` blocks
  in `tests/e2e/smoke.mjs` (§7).
- **Components.** `src/components/society/`: `SocietyDesk.tsx` (lazy from `Recurring.tsx`) and one lazy view per
  `&view=`. The template part is `components/templates/parts/SocietyBlock.tsx` (lazy; the `ManpowerBlock` pattern).
- **Strings.** One area per package (§1.4). Hindi uses the treasurer's words: आवास सहकारी संस्था (सोसाइटी), अपार्टमेंट
  मालिक संघ, रेज़िडेंट वेलफ़ेयर एसोसिएशन (RWA), फ़्लैट / यूनिट, विंग, सदस्य, मालिक, किरायेदार, रखरखाव बिल (मेंटेनेंस),
  सेवा शुल्क, सिंकिंग फ़ंड, मरम्मत निधि, संपत्ति कर, जल शुल्क, पार्किंग शुल्क, गैर-अधिवास शुल्क (नॉन-ऑक्युपेंसी),
  बकाया, बकाया पर ब्याज, बकाया प्रमाणपत्र (NOC), सदस्यता हस्तांतरण, सदस्य सूची (J रजिस्टर), आय-व्यय खाता, प्राप्ति-भुगतान खाता.
- **Storage.** New company tables `mrchartist_inv_<table>` via `getTable` / `setTable`, each registered in `backup.ts`,
  `trust/open-export-schema.ts`, `sync-engine.ts` `DATED` when dated, and **`src/lib/society/hs-registry.ts`**
  (`HS_TABLE_ACTIONS`, `HS_WATCHED`, audit labels), registered at runtime, never in first-paint `access.ts` /
  `audit-edits.ts`. **Every module that writes a Round 18 table imports `./hs-registry`**, and so do `sync-engine.ts`
  and `trust/recycle-bin.ts` (`tests/hs-registry.test.ts`). Names live in `src/lib/society/hs-shared.ts`; additive fields
  by declaration merging in `src/types/society-r18.ts`, one `declare module` block per package.
- **Volume.** A 1,000-unit society billing monthly writes 12,000 bills a year. Tests build 2,000 units × 12 periods and
  check: a run reads only the units table, the period's previous bills and the receipts after the last run; the dues
  view reads one period's bills plus open balances; a 2,000-bill run issues in one `issueBatch` under 3 s in
  `node:test` (the R2-B1 batch limit is raised by an option for society runs only, not globally). Quarterly billing is
  the documented answer for very large societies (one third of the documents).
- **Invoice snapshots.** Everything Round 18 stores on an invoice lives under the record key **`hs`** (§6). Lines reuse
  existing keys: `charge_head_id: 'rule33'` for pass-through statutory dues, `hsn` for the SAC. **No line key is
  added.** Purchase bills need no new key (the inward-RCM hint reads the vendor and the society's GST status).
- **Numbers.** **No new series.** Unit codes are the society's own (`A-101`), unique per company.
- **Guards.** Destructive calls use `requireAccess`; writes in a locked period use `assertUnlocked`; money through
  `round2`; deletes through `setTable` on a watched table (recycle bin); multi-table writes through
  `withTablesRollback`.
- **Packs.** The desk tab is listed only when `society` is on (its URL still opens it). Round 18 tables are not read
  while the pack is off (`tests/hs-pack-gate.test.ts`).
- **Help and Ctrl+K.** Every view gets a topic in `src/lib/help/topics-packs.ts` (block `// R18`;
  `tests/help-registry.test.ts`), a Ctrl+K title in `src/i18n/areas/discover-r6-tabs.ts` and synonyms in
  `src/lib/palette/synonyms.ts` (`'/recurring?tab=society&view=bills': ['maintenance bill', 'society bill', 'मेंटेनेंस',
  'रखरखाव बिल']`, `…&view=registers': ['J register', 'member list', 'सदस्य सूची']`, `…&view=dues': ['NOC', 'dues
  certificate', 'defaulters', 'बकाया']`). **A adds `HS` to the CA-id regexes** in `tests/help-registry.test.ts`,
  `tests/help-glossary.test.ts` and `tests/docs-links.test.ts` (`CITED_RE`, `CA_LIST_RE`, the row regex), with a test
  that `HS1` is read whole and never as `S1`.
- **Cash readers.** No new receipt marker. An interest waiver is a financial credit note (R2-A, `FCN`); a
  dues-certificate amount is a print, not a posting. `no-cash.ts` is not edited.
- **Purchases contract.** Modules reading `purchases` (B3 hint, D4 sheet) are added to
  `tests/purchase-contract.test.ts` and read bills through `readPurchase`.
- **Rule file shape.** `src/lib/society-rules.ts` rows are `{ from, value, source, verified }`, append-only, read with
  the shared `ruleAt`; State rows are `{ state, from, value, source, verified, in_force? }` read with a `stateRuleAt`
  helper in the same file. Sections `// R18-A` … `// R18-D` (§6).

### R18-A — Society core (merge first)

#### A1 Society profile and build plumbing

**User story.** I am the treasurer of a 120-flat co-operative housing society in Pune, registered under GST. In setup I
pick "Housing society / apartment association / RWA", then *Co-operative housing society*, "Registered under GST",
State Maharashtra. The app lands me on Recurring → Society → Units, and the checklist asks for my units, my tariff and
my first bills.

**Acceptance criteria.**
1. `PackId` gains `society` (appended to `PACK_IDS`). `PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE`, `PACK_ROUTES` unchanged.
2. `applySocietyKind(kind, { registered, state, currentPacks })` (`shop-presets.ts`, lazy; the R12–R17 pattern) returns
   business type (`nonprofit`; `services` for `agency`), modules (the type's preset; `registered` adds `gst`), packs =
   `currentPacks ∪ ['society']` written as an explicit list, landing, due days 15 and the template `gst_tax_invoice`.
3. Settings field `society_kind?: 'chs' | 'aoa' | 'rwa' | 'commercial' | 'agency'` and the object **`society_settings`**
   (`settings.manage`, audited, synced as a singleton). A writes the shape for every package:
   - A: `state` (two-digit code; default the sender's State), `cycle: 'monthly' | 'quarterly' | 'half_yearly'`,
     `bill_day` (1–28, default 1), `due_days` (default 15), `heads: Head[]` (A3), `area_unit: 'sqft' | 'sqm'`;
   - B: `gst: { valuation: 'whole' | 'excess', outsider_sac? }` (default `whole`, HS2), `run_limit?`;
   - C: `interest: { pct?, grace_days?, from: 'due' | 'bill', min_amount?, on_interest: false }`, `allocation:
     'interest_first' | 'oldest_first'` (default `interest_first`, HS37), `certificate_validity_days` (default 30);
   - D: `funds: { sinking?: costCentreId, repair?: costCentreId, major_repair?: costCentreId }`, `fund_transfer:
     'period' | 'year_end' | 'none'` (default `period`, HS39), `audit: { auditor?, appointed_on?, report_on?,
     rectified_on? }[]` per FY.
4. **Entity form.** The firm form stays the annual pack's `notes_to_accounts.entity_type` (the R14 rule). D2 appends
   `'cooperative' | 'association'` to `EntityType` (type only). The wizard writes `cooperative` for `chs`,
   `association` for `aoa` / `rwa` / `commercial`, and leaves `agency` as asked.
5. **Wizard.** One lazy card "Housing society / apartment association / RWA" (sub-step in the wizard chunk): kind,
   registered, State. Settings → Features shows "Society profile". Changing it never deletes data.
6. **Checklist steps** (`checklist-steps.ts`, append-only, only with `society_kind`; names distinct from the R11
   `units` step): `societyUnits` (≥ 1 `society_units` row), `societyTariff` (≥ 1 head), `societyRun` (≥ 1
   `society_runs` row), `societyFunds` (D: fund cost centres mapped), `societyAudit` (D: auditor for the current FY).
7. **Sample data** (R6-B4) in `src/lib/demo/profile-society.ts`, **only in the Demo company** (`demoDatabaseOpen()`
   checked by the existing dispatcher), ≤ 0.8 kB gz for the round, one block per package:
   - A: "Demo Sunshine CHS" (Maharashtra), wing A with A-101 (owner, 600 sq ft), A-102 (let out), A-901 (1,500 sq ft,
     two parking slots), shop S-1 (commercial), and the MH tariff (service, sinking, repair, property tax, parking,
     non-occupancy, education);
   - B: October 2026 run; C: A-101's October bill unpaid with November interest; D: fund cost centres and one
     transfer journal, an auditor for FY 2026-27.
8. **Build plumbing (one commit, before any feature code):**
   - `vite.config.ts`: the `f-society` row (§1.4); `tests/bundle-config.test.ts` adds the name and the regex test;
   - `HS` in the three CA-id regexes;
   - `src/lib/society/{hs-shared,hs-registry}.ts`, `src/lib/society-rules.ts` (sections), `src/types/society-r18.ts`
     (all packages' declarations, §6);
   - `store/invoice-defaults.ts`: `export const R18_RECORD_KEYS = ['hs'] as const;` and the token in `R9_RECORD_KEYS`
     after R17's. That module is lazy; measured first paint must stay at the baseline.

**Files.** New: `src/lib/society/{hs-shared,hs-registry,hs-settings,hs-profile}.ts`, `src/lib/society-rules.ts`,
`src/types/society-r18.ts`, `src/components/society/{SocietyKindPicker,SocietyDesk}.tsx`,
`src/i18n/areas/society-r18a.ts`, `src/lib/demo/profile-society.ts`, `docs/features/society-r18.md`. Edit:
`industry-packs.ts` (id; `alsoPacks` on `common-credit`), `page-tabs.ts` (`RECURRING_TABS` row; Books `funds` gains
`alsoPacks: ['society']`), `Recurring.tsx` (one lazy row), `shop-presets.ts`, `features-catalog.ts`,
`checklist-steps.ts`, the wizard (one lazy card), `FeaturesPanel.tsx`, the demo dispatcher, `vite.config.ts`,
`invoice-defaults.ts`, the three regex tests.

**Tests.** `tests/hs-profile.test.ts` (each kind's type / modules / packs / landing; `registered` adds `gst`; packs are
explicit and never add `nonprofit`; `PACK_OF_TYPE` / `PACK_ROUTES` unchanged), `tests/hs-registry.test.ts`,
`tests/hs-rules.test.ts` (import graph; every row has `from`, `source`, `verified`; `verified: true` rows are exactly
§2.4's; State rows only for 27 / 29 / 33 / 07), `tests/hs-pack-gate.test.ts`, `tests/bundle-config.test.ts`,
`tests/industry-packs.test.ts` (extended).

#### A2 Units and members

**User story.** I paste our 120 flats from the society's Excel (flat, wing, carpet area, owner name, phone, tenant yes
/ no, parking slots). The app creates the units and the members (clients) and lists the three it could not match.

**Acceptance criteria.**
1. **Table `society_units`** (not dated, synced, audited, right `master.edit`): `id`, `code` (unique), `wing?`,
   `floor?`, `use: 'residential' | 'commercial' | 'garage' | 'other'`, `carpet_area?`, `super_area?`, `undivided_pct?`,
   `construction_cost?` (architect-certified, HS27), `inlets?`, `lifted?`, `owner_id` (client), `joint_ids?`,
   `occupancy: 'owner' | 'tenant' | 'vacant'`, `tenant_id?`, `parking: { slot, kind: 'covered' | 'open' | 'stilt' |
   'two_wheeler' }[]`, `typed?: Record<headId, number>` (per-unit amounts for `typed` heads), `status: 'active' |
   'merged' | 'closed'`, `updated_at`. D3 adds `share_cert?`, `nominees?`, `admitted_on?`; C2 adds `transfers?`.
2. **Member = client.** `Client.hs?: { unit_ids: string[], role: 'owner' | 'joint' | 'tenant', member_no? }`
   (additive). Bills go to the owner; a tenant is recorded, never billed (TN s.18(3) recovery from the occupier is a
   hint, HS34). One client may own several units (each tested separately, B2).
3. **Grid** (`LinesGrid`) with filters by wing / use / occupancy; totals of area, cost and slots. Validation: code
   unique; areas ≥ 0; `undivided_pct` sums to 100 ± 0.01 when any is set (warning, never a block).
4. **Import** (cut 3): CSV / XLSX through `csv.ts` / dynamic `xlsx.ts` and `import-mapping.ts`, fixed template
   (`code, wing, use, carpet_area, super_area, undivided_pct, construction_cost, owner, phone, email, occupancy,
   tenant, parking`); owners matched by name + phone, new clients created only on confirmation; one `import_runs` row
   (kind `society_units`).

**Files.** New: `src/lib/society/{hs-units,hs-units-import}.ts`, `components/society/{UnitsView,UnitForm}.tsx`. Tests:
`tests/hs-units.test.ts` (validation, uniqueness, import mapping, client matching, volume 2,000 units).

#### A3 Charge heads, bases and State rule sets

**User story.** Our tariff: service charges ₹3,000 a flat a month, sinking fund 0.25 % and repair fund 0.75 % a year of
each flat's construction cost, property tax as the municipal bill per flat, parking ₹500 a slot, non-occupancy 10 % of
service charges for let flats, education ₹10. The app warns that the sinking fund cannot be lower than the State
minimum, and shows each flat's monthly bill before I run it.

**Acceptance criteria.**
1. `Head = { id, name, kind, basis, rate, sac?, fund?, active, from?, to? }` with
   - `kind`: `service` | `sinking` | `repair` | `major_repair` | `statutory` (property / water / NA tax collected for the
     authority) | `service_supply` (DG electricity, drinking water, other society-provided supply) | `parking` |
     `non_occupancy` | `education` | `election` | `insurance` | `lease_rent` | `outsider` (non-member income, B2) |
     `other`;
   - `basis`: `per_unit` | `area_carpet` | `area_super` | `undivided_pct` (rate = monthly total to share) |
     `cost_pct_pa` (rate % a year of `construction_cost`, ÷ 12 per month) | `per_slot` (by slot kind) | `per_inlet`
     (cut 2) | `per_lifted_unit` (cut 2) | `pct_of_head` (`non_occupancy`: % of the `service` head, only when
     `occupancy = 'tenant'`) | `typed` (per unit, from `society_units.typed`) | `fixed_member` (₹ per member per month,
     education / election).
2. `unitCharges(unit, heads, period, rules)` (pure, `hs-tariff.ts`) returns per head `{ amount, basis text }` for the
   period (× months of the cycle), paise-rounded per head.
3. **State rule set** (`STATE_SOCIETY_RULES`, §2.4 rows 23–40): `interest_cap_pct`, `noc_pct`, `fund_min: { sinking,
   repair }`, `education_per_month`, `default_bases` (per head kind), `audit_due_months`, `in_force`. "Apply State
   defaults" fills bases / rates the user has not typed; checks are **hints** (sinking below 0.25 %, NOC above 10 %,
   interest above the cap) citing the CA id, never blocks. A row with `in_force: false` (KA bill) shows "proposed —
   confirm it is in force" and applies only after the user ticks it.
4. **Preview** (`heads` view): heads grid + a per-unit preview table (first 50 units, totals for all) with the B2 test
   column once B merges.
5. Head SAC defaults: member heads `999598`; `outsider` heads `997212` (renting of non-residential property, HS9 — the
   user may change); `statutory` heads none (outside GST).

**Files.** New: `src/lib/society/hs-tariff.ts`, `components/society/HeadsView.tsx`. Rule rows `// R18-A`:
`SOCIETY_GST_RATE_RULES`, `SOCIETY_SAC_RULES`, `STATE_SOCIETY_RULES`. Tests: `tests/hs-tariff.test.ts` (each basis,
cycle multiplication, NOC only for tenants, State defaults by date — MH cap 21 → 12 at the row date, KA rows
inactive until ticked, TN `undivided_pct`, other States null).

#### A4 Society bill paper

**Acceptance criteria.**
1. `SocietyBlock.tsx` (lazy, mounted in `TemplateEngine.tsx` after `ManpowerBlock`, before `GstBody`, never on
   `receipt`) prints from `hs` only: unit code, wing, area, member name(s), period and due date, the heads table (head,
   basis text, amount; ≤ 16 rows), arrears brought forward, interest on arrears (C1), the regime declaration (B2), and
   D's fund note through `switch` arms in `parts/society/*.tsx`.
2. A footnote "How your bill is worked out" (basis per head) prints when `hs.explain` is set (cut 1).
3. Old invoices render unchanged (snapshot compare in `tests/hs-print.test.ts`). Colours from `accent` only.
4. `paper-helpers.ts`: `hsLineText` appended after `mpLineText`.

**Files.** New: `components/templates/parts/SocietyBlock.tsx`, `src/lib/society/hs-print.ts`,
`society-paper.module.css`. Edit: `TemplateEngine.tsx` (one lazy import + mount), `paper-helpers.ts`.

### R18-B — Billing and GST

#### B1 Billing run

**User story.** On 1 Nov I run November for all 120 flats. The app shows 117 exempt bills of supply, 3 tax invoices
(the large flats), totals by head, and issues all 120 numbered documents at once. A wrong rate? "Undo run" cancels
them with a reason and I run again.

**Acceptance criteria.**
1. **Table `society_runs`** (dated by bill date, synced, audited, right `doc.create`): `id`, `period`, `date`, `due`,
   `batch_run_id`, `unit_ids`, `counts: { bos, tax, plain, outsider }`, `totals: Record<headId, number>`, `undone?`.
2. `planSocietyRun(period, units, heads, rules, ctx)` (pure, `hs-run.ts`) returns per unit one draft (or two when an
   `outsider` head applies to a member — never mixed on one document) with lines per head, the B2 regime, the C1
   arrears / interest lines (after C merges), and `hs` = `{ unit, period, run_id, heads, test, decl, arrears?,
   interest? }`.
3. **Idempotent** per (unit, period, document kind): a unit already billed for the period is skipped and listed.
   Billed state is derived from invoices whose `hs.period` and `hs.unit` match (no stored flag).
4. **Issue** through the bridge `hs-issue-io.ts` → `issueBatch(drafts, { sourceId: 'hs:<period>', sourceKind:
   'recurring', mode: 'issue', force: true })` inside `withTablesRollback([society_runs])`, the `fee-billing.ts`
   pattern; **Undo** → `undoBatch` with a reason (issued documents cancelled, never deleted; numbers stay reserved).
5. **Bills view** (`bills`): periods × status (planned / issued / undone), counts by regime, totals by head, "Run
   period", "Undo", per-unit drill to the document; "Share all" (WhatsApp / e-mail links through the existing
   share-message builder, one at a time — no bulk sender).

**Files.** New: `src/lib/society/{hs-run,hs-issue-io}.ts`, `components/society/BillsView.tsx`,
`src/i18n/areas/society-r18b.ts`. Tests: `tests/hs-run.test.ts` (one per unit, idempotent re-run, split outsider,
undo, quarterly cycle, volume 2,000 units).

#### B2 GST per unit (₹7,500 test)

**User story.** A-101's November bill is ₹5,510 of member charges plus ₹1,200 property tax: an exempt bill of supply
with the Sl. 77(c) sentence and the property tax as "collected for the municipal corporation". A-901 is ₹9,010 of member
charges: a tax invoice with 18 % on the whole ₹9,010 and the property tax outside GST.

**Acceptance criteria.**
1. `hsRegime({ date, months, heads, sender, kind, settings })` (pure, `hs-regime.ts`) by the bill date:

   | Regime | When | Document | Lines | Declaration (printed) |
   |---|---|---|---|---|
   | `unregistered` | sender has no GSTIN | plain invoice ("Maintenance bill") | all heads, no tax | "The society is not registered under GST." |
   | `agency` | `society_kind = 'agency'` | tax invoice | all non-statutory heads 18 %; statutory heads `rule33` | — |
   | `exempt77c` | counted ≤ `limit × months` | `BILL_OF_SUPPLY` (exempt) | counted heads exempt; statutory heads `rule33` | "Exempt — contribution by a member for the common use of members up to ₹7,500 a month (N 12/2017-CT(R) Sl. 77(c)). Statutory dues collected for the authority are outside GST. Verify with your CA." |
   | `taxable_whole` | counted > limit × months, `valuation: 'whole'` | tax invoice | every counted head 18 %; statutory heads `rule33` | "Monthly contribution exceeds ₹7,500: GST on the whole amount (Circular 109/28/2019-GST). Verify with your CA." |
   | `taxable_excess` | same, `valuation: 'excess'` | tax invoice | an exempt line for `limit × months` and taxable lines for the rest, apportioned across counted heads | "GST on the amount above ₹7,500 a month (Madras High Court, 2021 — under appeal). Verify with your CA." |
   | `outsider` | `outsider` heads | separate tax invoice | 18 % | — |

   - **Counted** = all heads except `statutory` and `outsider` (CBIC flyer: sinking, repair, parking, non-occupancy
     and interest are counted; HS3, HS7). `limit` from `RWA_LIMIT_RULES` (₹5,000 from 2017-07-01, ₹7,500 from
     2018-01-25). `months` = cycle length (HS5).
   - The test is **per unit** (Circular 109 Q4), never per client.
   - A `commercial` unit is tested like a residential one with a hint (HS8).
2. **Pass-through.** `statutory` heads print as lines with `charge_head_id: 'rule33'` (pure-agent), outside the
   taxable value on every regime; the R14 GSTR-1 / 3B behaviour for `rule33` is unchanged (proved by a test).
3. GSTR-1 / 3B / e-Invoice read the existing fields; **no GST reader changes.** Tests prove: an `exempt77c` bill lands
   in Table 8 exempt; a `taxable_whole` bill in B2C (members are unregistered) at 18 %; `rule33` lines outside both.
4. Rule rows `// R18-B`: `RWA_LIMIT_RULES`, `RWA_VALUATION_RULES` (`whole` from 2019-07-22, `verified: true`; the
   Madras HC note as `pending-changes.ts` entry, not a row), `REG_THRESHOLD_RULES` (₹20 lakh, `verified: true` via
   the circular; special-category rows `verified: false`).

**Files.** New: `src/lib/society/hs-regime.ts`, `components/society/parts/RegimeChip.tsx`. Edit: `pending-changes.ts`
(one entry: Madras HC writ appeal, HS2). Tests: `tests/hs-regime.test.ts` (dates 2018-01-24 / 25; ₹7,500.00 exempt /
₹7,500.01 taxable; quarterly ₹22,500; per unit for a two-flat owner; statutory heads never counted; interest
counted; `excess` split; unregistered; agency; outsider split; GSTR-1 placement).

#### B3 Turnover monitor, ITC split and inward RCM

**Acceptance criteria.**
1. **`gst` view**: FY-to-date aggregate turnover (all bills incl. exempt and outsider income, excluding `rule33`
   lines, HS4) vs `REG_THRESHOLD_RULES`; the count of units above the limit in the last period; the circular's
   both-conditions table with the society's position highlighted. An unregistered society with turnover above the
   threshold **and** any unit above the limit sees "Registration may be required (Sec 22 / Circular 109 Q2). Verify
   with your CA." — a hint.
2. **ITC split**: the view links to GST reports → `common-credit` (R5-C, now `alsoPacks: ['society']`) with the
   period's exempt and taxable turnover pre-filled from the run (read through the existing common-credit inputs; no
   change to the Rule 42 engine).
3. **Inward RCM hint** (cut 2): on a purchase bill of a **registered** society from a vendor whose SAC is 99852x and
   whose entity is not a body corporate, the lazy row shows "Security services from a non-body-corporate supplier:
   reverse charge (N 13/2017-CT(R) entry 14). Verify with your CA (HS15)." through `hs-books-io.ts` (reads
   `SECURITY_RCM_RULES`).

**Files.** New: `src/lib/society/hs-turnover.ts`, `components/society/GstView.tsx`. Edit: the purchase-bill form (one
lazy row, the R15 `TripPick` slot). Tests: `tests/hs-turnover.test.ts`; `tests/purchase-contract.test.ts` (reader
added).

#### B4 Special levy (cut 1)

**Acceptance criteria.**
1. "Special levy" makes a one-off run (`society_runs` row with `levy: { name, kind, basis, total }`), e.g. painting
   ₹12,00,000 by carpet area or a `major_repair` levy in two instalments. Same regime engine; the levy is tested with
   the period's regular bill for that unit (the month's contribution) when both fall in one month (HS3).
2. Undo as B1.

**Files.** In `hs-run.ts` / `BillsView.tsx`. Tests: in `tests/hs-run.test.ts`.

### R18-C — Dues, interest and collections

#### C1 Arrears and interest on the next bill

**User story.** A-101 did not pay October's ₹6,710 (due 20 Oct). The November bill shows "Arrears ₹6,710.00" and
"Interest on arrears 21 Oct – 31 Oct @ 12 % on ₹5,510 = ₹19.93" (never on the ₹1,200 property tax), and when A-101 pays ₹6,000 the receipt settles the interest
first.

**Acceptance criteria.**
1. `arrearsFor(unit, asOf, bills, receipts, settings, rules)` (pure, `hs-dues.ts`): open principal per bill (receipts
   and credit notes reduce it from their date; the existing allocation of receipts to bills is respected), interest by
   `computeInterest` (simple, 365 days) from the day after `due + grace_days` to the period start, at
   `min(settings.interest.pct, State cap at each day)` — a cap change mid-period splits the segment (MH 21 → 12).
   **Never on interest** (`on_interest: false` is fixed for MH; HS38) and never on `rule33` lines (HS6).
2. The run (B1) adds per unit: an **"Arrears brought forward"** memo row in `hs.arrears` (printed, **not** a line —
   the old bills stay the receivable) and an **"Interest on arrears"** line when ≥ `min_amount`, which takes the bill's
   regime (HS7). Interest already charged for a bill-period is never charged again (the R8-A `charged_to` rule,
   derived from `hs.interest.through`).
3. **Allocation.** With `interest_first`, a receipt for a unit is suggested against the oldest open interest lines first,
   then the oldest principal (the receipt form's existing allocation UI, pre-filled through `hs-dues-io.ts`; the user
   may change it).
4. **Waiver** of interest = a financial credit note (`note_kind: 'financial'`, R2-A) with a typed reason and the
   general-body resolution reference; audited.

**Files.** New: `src/lib/society/{hs-dues,hs-dues-io}.ts`, `components/society/DuesView.tsx`,
`src/i18n/areas/society-r18c.ts`. Tests: `tests/hs-dues.test.ts` (dates and caps: MH 2026-06-21 vs 2026-06-22;
part-payment; no interest on interest; no interest on `rule33`; already-charged periods; allocation order; waiver).

#### C2 Member statement, dues certificate and transfer

**Acceptance criteria.**
1. **Statement** per unit (period range) through the existing statement styles (R2-A), with columns for arrears,
   interest and funds; one per member for multi-unit owners.
2. **Dues certificate** (print window, `escHtml`): unit, owner(s), dues up to a date (principal, interest to date,
   charges billed in advance), "valid for N days", a reference number from the certificate log in
   `society_units.certificates?: { no, date, amount, valid_till }[]` (KA Bill s.20(5): binding on the association for
   the amount stated — HS33). The certificate never states anything not in the books.
3. **Transfer of membership** (cut 2 drops the history): date, from / to owners, transfer premium (typed; MH cap a
   hint only, HS18), dues settled check; writes `society_units.transfers[]` and `owner_id`, moves `Client.hs.unit_ids`;
   later bills go to the new owner. One `withTablesRollback`.

**Files.** New: `src/lib/society/hs-transfer.ts`. Tests: `tests/hs-transfer.test.ts`.

#### C3 Defaulters and reminders

**Acceptance criteria.**
1. Defaulter list (dues view): unit, member, months overdue, principal, interest, last promise (R2-A4 collection
   notes); filters by wing / ageing.
2. Reminders through the existing reminder schedule and templates (R2-A5) with a **society template set** (English /
   Hindi) selected when the pack is on. The templates never threaten disconnection of water, electricity, lift or
   access (KA s.20(6) proviso, HS33); `tests/hs-reminders.test.ts` greps the templates for those words.
3. A "Defaulters list for the notice board" print (unit and amount only, no phone numbers — DPDP minimisation).

**Files.** New: `src/lib/society/hs-reminders.ts` (template set + list). Tests: `tests/hs-reminders.test.ts`.

#### C4 Bank receipts matched by unit (cut 1)

**Acceptance criteria.**
1. In bank reco, a society rule `matchUnitInNarration(narration, units)` (pure) suggests the unit (and owner) from
   tokens like `A-101`, `A101`, `FLAT 101 A`, plus the amount equal to an open bill or the unit's total dues. The
   suggestion goes through the existing bank-rules apply step (`hs-bank-io.ts`); the user confirms.

**Files.** New: `src/lib/society/{hs-bank-match,hs-bank-io}.ts`. Tests: `tests/hs-bank-match.test.ts`.

### R18-D — Funds, accounts and statutory

#### D1 Funds

**User story.** Every month the sinking and repair contributions billed (in the demo, ₹2,250 and ₹6,750 for October) move out
of income into the Sinking Fund and Repair Fund, so the I&E shows the true surplus and the balance sheet shows the
funds.

**Acceptance criteria.**
1. "Map funds" creates (if missing) fund cost centres (R5-C4 `saveFund`, nature `restricted`) "Sinking fund", "Repair
   and maintenance fund", "Major repair fund" and stores their ids in `society_settings.funds`. Billing lines of fund
   heads carry the fund's `cost_centre_id` (so the R5-C4 fund statement sees them as receipts).
2. **Transfer journal** per period (`fund_transfer: 'period'`) or per FY (`year_end`): one manual voucher,
   `voucher_class: 'Society fund transfer'`, Dr the sales ledger tagged with the fund / Cr a reserve ledger per fund
   ("Sinking fund", group Reserves; created once like `ensureCorpusAccount`), for the fund heads billed in the period
   (bills, not receipts — HS39). Idempotent per (fund, period) — derived from vouchers of that class and reference;
   re-running after an undo reverses through a new voucher. Through `hs-books-io.ts`.
3. **Minimum check**: per FY, sinking / repair billed vs `fund_min` × Σ construction cost (hint, HS27).
4. **Funds view**: per fund — opening, billed, transferred, spent (purchase bills tagged to the fund), closing, with a
   link to Books → Funds (R5-C4 statement, now `alsoPacks: ['society']`).

**Files.** New: `src/lib/society/{hs-funds,hs-books-io}.ts`, `components/society/FundsView.tsx`,
`src/i18n/areas/society-r18d.ts`. Tests: `tests/hs-funds.test.ts` (journal amounts, idempotence, year-end mode,
minimum hint, fund statement agrees).

#### D2 Income and Expenditure / Receipts and Payments

**Acceptance criteria.**
1. `EntityType` gains `'cooperative' | 'association'` (type only; `ENTITY_TYPES` appended). For these, the annual pack
   prints **"Income and Expenditure Account"** for the P&L page, "Excess of income over expenditure / expenditure over
   income" for profit / loss, "Funds and liabilities" / "Property and assets" headings, and the members' funds block
   (share capital, reserve fund, sinking / repair funds) from the reserve ledgers. The figures come from the same
   builders (`ledgerProfitAndLoss`, `ledgerBalanceSheet`), so Books, the Gateway and ratios agree. A label swap, not a
   new statement engine.
2. **Receipts and Payments** (cut 3): one statement from cash and bank ledgers (`pickableBankAccounts` + cash) for the
   FY — opening balances, receipts by contra ledger, payments by contra ledger, closing balances — appended to the pack
   as a page and an XLSX sheet. `hs-rp.ts` is pure over posting lines.
3. The pack's draft line stays "Draft — prepared from books, verify with your CA".

**Files.** New: `src/lib/society/hs-rp.ts`. Edit: `ledger/annual-pack.ts` (label map keyed by entity type, one block
`// R18-D`), `types/books-r2.ts` (two union members). Tests: `tests/hs-rp.test.ts`, `tests/annual-pack.test.ts`
(extended: labels per entity type; Schedule III unchanged for the four existing types).

#### D3 Registers and audit tracker

**Acceptance criteria.**
1. **Registers view** (print windows, `escHtml`, State-labelled from `STATE_SOCIETY_RULES.registers`):
   - **List of members** (MH "Form J", Rule 33; elsewhere "Register of members"): member no., name, unit, admitted on,
     address (unit), share certificate no. (HS30);
   - **Register of members (I register)** (MH): the J fields plus share capital and transfers (cut 2);
   - **Share register** and **nomination register** (cut 2): from `society_units.share_cert` / `nominees`
     (`{ name, share_pct, relation? }` only — no ID numbers stored).
2. **Audit tracker** per FY: auditor, appointment date, report date, due date (`audit_due_months` after FY end: TN 3,
   KA 6, MH typed), rectification report date (MH, typed), status chips; bell notices at 30 / 7 days before the due date
   through one `gate('society', 'society', () => import('../../lib/society/hs-alerts'))` row in `NotificationBell.tsx`.

**Files.** New: `src/lib/society/{hs-registers,hs-alerts}.ts`, `components/society/RegistersView.tsx`. Edit:
`NotificationBell.tsx` (one `gate` row). Tests: `tests/hs-registers.test.ts`, `tests/hs-alerts.test.ts`.

#### D4 Income-tax working paper (cut 1)

**Acceptance criteria.**
1. Section "Income tax" of the registers view, per FY: **mutual** receipts (member heads, interest from members) vs
   **non-mutual** income (`outsider` heads, interest on bank deposits, dividends) read from ledgers by name / group;
   the deduction lines labelled by date through `INCOME_TAX_SOCIETY_RULES` (`Sec 80P` up to FY 2025-26; `Sec 149`
   from 2026-04-01: (2)(c) up to ₹50,000, (2)(d) interest / dividend from investments with other co-operative
   societies; the co-operative-bank question flagged, HS21), all `verified: false`.
2. A note lists the society's TDS duties from the existing payables desk (contractors, professionals, rent), without
   new rows (HS23).
3. "Working paper — verify with your CA" on every line; nothing posts.

**Files.** New: `src/lib/society/hs-itax.ts`. Rule rows `// R18-D`: `INCOME_TAX_SOCIETY_RULES`. Tests:
`tests/hs-itax.test.ts` (labels at 2026-03-31 / 2026-04-01; mutual / non-mutual split; purchase-contract reader).

---

## 5. Work packages

Four packages, each one agent in its own worktree.

**Merge order:** **A first** (family group, `HS` regexes, registry, rules / types / shared scaffolds, the `hs` record
key, template mount, the `society` tab and desk with the `units` / `heads` views). Then **B** (C's interest line and
D's fund tags ride on B's run). **C and D** follow in either order and can run in parallel; they share only the
registry, rules, types, demo, help and the desk's view map, and C edits `hs-run.ts` only through one hook
(`runExtras(unit, ctx)`) that B creates empty.

### R18-A — Society core (A1–A4)

| | Files |
|---|---|
| Owned (new) | `src/lib/society/hs-{shared,registry,settings,profile,units,units-import,tariff,print}.ts`, `src/lib/society-rules.ts`, `src/types/society-r18.ts`; `components/society/{SocietyKindPicker,SocietyDesk,UnitsView,UnitForm,HeadsView}.tsx`; `components/templates/parts/SocietyBlock.tsx` + `society-paper.module.css`; `src/i18n/areas/society-r18a.ts`; `src/lib/demo/profile-society.ts`; `docs/features/society-r18.md`; tests `hs-profile`, `hs-registry`, `hs-rules`, `hs-pack-gate`, `hs-units`, `hs-tariff`, `hs-print` |
| Owned (edit) | `vite.config.ts` (one row), `tests/bundle-config.test.ts`; `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`, the wizard card, `FeaturesPanel.tsx`; `page-tabs.ts` (`RECURRING_TABS` row; Books `funds` `alsoPacks`), `Recurring.tsx` (one lazy row); `TemplateEngine.tsx`, `paper-helpers.ts`, `invoice-defaults.ts` (one token); `tests/help-registry.test.ts`, `tests/help-glossary.test.ts`, `tests/docs-links.test.ts` (`HS`) |
| Budget | first paint 0; core **≤ 11 kB** |

### R18-B — Billing and GST (B1–B4)

| | Files |
|---|---|
| Owned (new) | `src/lib/society/hs-{run,issue-io,regime,turnover}.ts`; `components/society/{BillsView,GstView}.tsx`, `components/society/parts/RegimeChip.tsx`; `src/i18n/areas/society-r18b.ts`; tests `hs-run`, `hs-regime`, `hs-turnover` |
| Owned (edit) | the desk's view map (adds `bills`, `gst`); `pending-changes.ts` (one entry); the purchase-bill form (one lazy row); `import_runs` kind list unchanged (A owns `society_units`) |
| Shared (§6) | rules `// R18-B`, types `// R18-B`, registry block (`society_runs`), demo block, `hs` sub-fields `run_id`, `test`, `decl`, `regime`, `levy` |
| Budget | core **≤ 10 kB** |

### R18-C — Dues, interest and collections (C1–C4)

| | Files |
|---|---|
| Owned (new) | `src/lib/society/hs-{dues,dues-io,transfer,reminders,bank-match,bank-io}.ts`; `components/society/DuesView.tsx`; `src/i18n/areas/society-r18c.ts`; tests `hs-dues`, `hs-transfer`, `hs-reminders`, `hs-bank-match` |
| Owned (edit) | the desk's view map (adds `dues`); `hs-run.ts` `runExtras` hook (interest line, arrears memo) |
| Shared (§6) | rules `// R18-C` (none expected beyond A's State rows), types, demo, `hs` sub-fields `arrears`, `interest`; `society_units.certificates` / `transfers` |
| Budget | core **≤ 9 kB** |

### R18-D — Funds, accounts and statutory (D1–D4)

| | Files |
|---|---|
| Owned (new) | `src/lib/society/hs-{funds,books-io,rp,registers,alerts,itax}.ts`; `components/society/{FundsView,RegistersView}.tsx`; `src/i18n/areas/society-r18d.ts`; tests `hs-funds`, `hs-rp`, `hs-registers`, `hs-alerts`, `hs-itax` |
| Owned (edit) | the desk's view map (adds `funds`, `registers`); `ledger/annual-pack.ts` (label map); `types/books-r2.ts` (two members); `NotificationBell.tsx` (one `gate` row); `hs-run.ts` `runExtras` (fund cost-centre tag) |
| Shared (§6) | rules `// R18-D` (`INCOME_TAX_SOCIETY_RULES`), types, demo, `hs` sub-field `funds`; `society_units.share_cert` / `nominees` / `admitted_on` |
| Budget | core **≤ 9 kB** |

**Combined:** first paint **0** at every merge; core **≤ 39 kB gross** + 1 kB lead reserve = **≤ 40 kB**; Hindi pack
≤ 8 kB. Each package runs `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run check:size`
on its branch (one at a time), and again after rebase; the last package also runs `npm run test:e2e` and
`npm run verify:offline`.

---

## 6. Shared-file protocol

| File | Who | Rule |
|---|---|---|
| `vite.config.ts`, `tests/bundle-config.test.ts` | A | One row `f-society` in one commit. Later packages never edit them |
| `src/types/society-r18.ts` | A creates | One `declare module` block per package (`// R18-A` … `// R18-D`). A declares for every package in one commit: record key `hs?: HsSnapshot` with sub-objects `unit`, `period`, `heads`, `explain` (A), `run_id`, `test`, `regime`, `decl`, `levy` (B), `arrears`, `interest` (C), `funds` (D); settings `society_kind`, `society_settings`; `Client.hs`; the `society_units` row type with C / D optional fields |
| `src/store/invoice-defaults.ts` | A | **One edit:** `export const R18_RECORD_KEYS = ['hs'] as const;` and the token in `R9_RECORD_KEYS` after R17's. No line key |
| `src/lib/society-rules.ts` | A creates | Sections `// R18-A` (`SOCIETY_GST_RATE_RULES`, `SOCIETY_SAC_RULES`, `STATE_SOCIETY_RULES`), `// R18-B` (`RWA_LIMIT_RULES`, `RWA_VALUATION_RULES`, `REG_THRESHOLD_RULES`), `// R18-D` (`INCOME_TAX_SOCIETY_RULES`). Every row has `from`, `source`, `verified`; State rows add `state`, `in_force?` |
| `tax-rules.ts`, `tds-rules.ts`, `ita2025.ts`, `manpower-rules.ts`, `r5c-rules.ts`, `transport-works-rules.ts` | — | **Not edited** (read through bridges) |
| `src/lib/society/hs-registry.ts` | A creates | `HS_TABLE_ACTIONS` / `HS_WATCHED`, one block per package: A `society_units`, `society_settings`; B `society_runs`. `tests/hs-registry.test.ts` pins both maps |
| `backup.ts`, `sync-engine.ts` (`DATED`: `society_runs`), `trust/open-export-schema.ts` | A, B | Append-only blocks `// R18-A`, `// R18-B` |
| `TemplateEngine.tsx` | A | One lazy import + mount of `SocietyBlock` (after `ManpowerBlock`, before `GstBody`, never on `receipt`). B–D add `switch` arms in `parts/society/*.tsx` |
| `paper-helpers.ts` | A | `hsLineText` appended after `mpLineText` |
| `industry-packs.ts` | A | One id; `PACK_TABS` block `// R18` (desk + seven views); `society` added to the `common-credit` row's `alsoPacks` |
| `page-tabs.ts` | A | One `RECURRING_TABS` row `society`; Books `funds` row gains `alsoPacks: ['society']`. B–D add **views**, not tabs |
| `components/society/SocietyDesk.tsx` (view map) | A creates, B–D append | One lazy entry per view in a `// R18-x` block |
| `Recurring.tsx` | A | One `lazy()` row and one tab branch |
| `hs-run.ts` | B creates, C / D append | `runExtras(unit, ctx)` hook: C adds arrears / interest, D adds fund tags; each in its own `// R18-x` block |
| `shop-presets.ts`, `checklist-steps.ts`, `features-catalog.ts`, the wizard, `FeaturesPanel.tsx` | A | Appended blocks `// R18` after the R17 blocks |
| `ledger/annual-pack.ts`, `types/books-r2.ts` | D | Label map and two union members only; Schedule III output unchanged for existing entity types |
| `NotificationBell.tsx` | D | One `gate` row |
| `pending-changes.ts` | B | One entry (Madras HC writ appeal on the whole-amount rule) |
| `src/lib/help/topics-packs.ts`, `glossary.ts`, `discover-r6-tabs.ts`, `palette/synonyms.ts` | A–D | Each package writes its own topics and Ctrl+K titles in its own `// R18-x` block with its views. Glossary ≤ 8 terms for the round (sinking fund, non-occupancy charges, Sl. 77(c), whole-amount rule, pass-through dues, J register, dues certificate, mutuality) |
| `src/lib/demo/profile-society.ts` | A creates | One block per package; ≤ 0.8 kB gz in all; Demo company only |
| `tests/purchase-contract.test.ts` | B, D | Append `hs-turnover`, `hs-itax` |
| `tests/e2e/smoke.mjs` | A–D | One appended `step(...)` block each, in merge order |
| `docs/features/society-r18.md` | A creates | One section per package with its bundle numbers and the `f-society` chunk size |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md`, `docs/CA_REVIEW.md` | lead | After merge: the Round 18 company-data paragraph in `AGENTS.md` (tables, object, `society_kind`, pack, desk tab `society` on `/recurring`, "Round 18 invoice snapshots live under ONE record key `hs` — never add keys", "every module that writes a Round 18 table must `import './hs-registry'`", the `f-society` group, "State society rules are data rows, never code"); table rows in ARCHITECTURE; §18 HS items and the total (615 → 659) in CA_REVIEW |

### Storage summary

| Key / field | Package | Kind | Backed up | Synced | Audited | Right (`hs-registry`) |
|---|---|---|---|---|---|---|
| `society_settings` (state, cycle, heads, GST valuation, interest, allocation, funds map, fund transfer, audit per FY) | A (sub-fields B–D) | object | yes | yes (singleton) | yes | `settings.manage` |
| `society_units` (+ C certificates / transfers, D share certificate / nominees) | A | table | yes | yes | yes | `master.edit` |
| `society_runs` | B | table, dated (bill date) | yes | yes | yes | `doc.create` |
| settings `society_kind`; `entity_type` `cooperative` / `association` | A, D | additive | yes | yes | yes | — |
| record key `hs` | A (sub-fields B–D) | additive record key (one token in the lazy `invoice-defaults` chunk) | yes | yes | yes | — |
| `Client.hs` | A | additive | yes | yes | yes | — |
| `import_runs` rows of kind `society_units` | A | existing table | yes | yes | yes | existing |
| Fund cost centres; "Society fund transfer" vouchers | D | existing tables | yes | yes | yes | existing |

No migration (everything is additive). Personal data: member names, phone and e-mail on the client record (as today);
nominees as name / share / relation only; no Aadhaar, PAN of members or bank details stored by Round 18. The notice-board
defaulters print carries unit and amount only.

---

## 7. E2E steps (production build, `tests/e2e/smoke.mjs`)

**Rule for every step:** after any action that writes, wait for the write to reach IndexedDB with
`readJson(page, '<table>', fallback, predicate, 15000)` **before** any `page.goto`, `page.reload` or in-app navigation
that re-reads storage (the R16-B fix `d0a89fb`). Seeds written with `writeJson` are followed by a reload only after
`readJson` confirms them. A `check(...)` on stored data always uses the predicate form.

Seed numbers (Maharashtra, registered, monthly, MH State rows): service ₹3,000 per unit; sinking 0.25 % p.a. and repair
0.75 % p.a. of construction cost; property tax typed per unit (statutory); parking ₹500 per slot; non-occupancy 10 % of
service charges; education ₹10.
- A-101: 600 sq ft, cost ₹24,00,000, owner-occupied, one slot, property tax ₹1,200 → sinking 500, repair 1,500,
  counted 3,000 + 500 + 1,500 + 500 + 10 = **₹5,510** (exempt) + ₹1,200 pass-through = **₹6,710**.
- A-901: 1,500 sq ft, cost ₹60,00,000, two slots, property tax ₹3,000 → sinking 1,250, repair 3,750, counted 3,000 +
  1,250 + 3,750 + 1,000 + 10 = **₹9,010** (> ₹7,500) → GST 18 % on ₹9,010 = ₹1,621.80; total ₹9,010 + ₹1,621.80 +
  ₹3,000 = **₹13,631.80**.
- A-102: as A-101 but let out → + non-occupancy ₹300 → counted ₹5,810 (exempt).

1. **R18-A:**
   - `check:size`: initial at the baseline, ≤ 5 initial files; the build has an `f-society` chunk.
   - Fresh company → wizard → "Housing society / apartment association / RWA" → *Co-operative housing society*,
     registered, Maharashtra → lands on `/recurring?tab=society&view=units`; Recurring shows the Society tab; the
     sidebar is unchanged.
   - Add units A-101, A-102 (tenant), A-901 with owners → **wait** for `society_units` to hold three rows and
     `clients` to hold the owners → reload → the grid shows them with total area 2,700 sq ft.
   - Heads view → "Apply State defaults" → set the seed rates → **wait** for `society_settings.heads.length === 7` →
     the preview shows A-101 ₹6,710.00, A-102 ₹7,010.00, A-901 ₹9,010.00 + GST + ₹3,000.
   - Set sinking to 0.20 % → the hint "below the Maharashtra minimum 0.25 % (HS27)" appears; restore 0.25 %.
   - F1 opens the Society help; Ctrl+K "maintenance bill" finds the bills view.
2. **R18-B:**
   - Bills → "Run period" 2026-10, bill date 2026-10-01, due 2026-10-20 → **wait** until `society_runs` has one row
     and `invoices` has three rows with `hs.period === '2026-10'` → reload.
   - `page.goto('/invoice/<A-101 id>')`: doc type Bill of Supply, lines exempt, property tax line outside GST, total
     ₹6,710.00, the Sl. 77(c) declaration printed. A-901: tax invoice, GST ₹1,621.80 on ₹9,010, total ₹13,631.80, the
     Circular 109 declaration printed.
   - Run 2026-10 again → "already billed: 3" and no new invoice (check with `readJson` predicate length 3).
   - GST view: FY turnover includes the two exempt bills and excludes the ₹5,400 pass-through.
3. **R18-C:**
   - Run 2026-11 (bill date 2026-11-01) with A-101 unpaid → **wait** for six invoices → A-101's November bill shows
     arrears ₹6,710.00 (memo) and "Interest on arrears" **₹19.93** (5,510 × 12 % × 11 / 365, 21–31 Oct; the ₹1,200
     pass-through is not charged interest) and stays exempt (₹5,529.93 counted).
   - Record a receipt of ₹6,000 for A-101 → the allocation suggests the ₹19.93 interest first → save → **wait** for
     the receipt in `transactions` → Dues: A-101 balance ₹6,710 + ₹6,729.93 − ₹6,000 = ₹7,439.93.
   - Dues certificate for A-101 as at 2026-11-05 → the print window shows ₹7,439.93 plus interest to date and a
     certificate number; **wait** for `society_units` A-101 `certificates.length === 1`.
4. **R18-D:**
   - Funds → "Map funds" → **wait** for three fund cost centres → "Transfer for 2026-10" → **wait** for one voucher
     with `voucher_class: 'Society fund transfer'` → sinking ₹2,250 (500 + 500 + 1,250 — A-102 included) and repair
     ₹6,750 (1,500 + 1,500 + 3,750) → Books → Funds shows the same.
   - Annual pack (entity `cooperative`) → the P&L page is titled "Income and Expenditure Account"; the R&P page lists
     the ₹6,000 receipt under bank.
   - Registers → List of members prints three members with units; Audit: auditor appointed, due date set 20 days
     ahead → **wait** for `society_settings.audit` → reload → the bell lists the audit due.

---

## 8. Open questions — with the default the builders will use

| # | Question | Default chosen | Why |
|---|---|---|---|
| 1 | New business type or a card? | Wizard card; `nonprofit` (`services` for agencies) + `society_kind`; explicit packs. | Zero shell bytes; R12 / R13 pattern; donations pack stays off. |
| 2 | Where do the screens live? | One tab `society` on `/recurring`, seven views. | Periodic billing lives there (fees, leases). |
| 3 | Unit storage | New table `society_units`; not `properties`. | `properties` drives lease GST by use (R5-C5); societies need owners, cost, slots, shares. |
| 4 | ₹7,500 valuation | Whole amount (Circular 109); "excess" only as a setting. | Primary text; Madras HC under appeal (HS2). |
| 5 | Heads counted in the test | All but statutory pass-through and non-member heads. | CBIC flyer (HS3). |
| 6 | Quarterly bills | Limit × 3. | Per-month limit (HS5). |
| 7 | Arrears on the bill | Memo row; old bills stay the receivable. | No double counting in GST or receivables. |
| 8 | Interest | Simple, capped by State row, never on interest or pass-through. | MH Rule 106C-12 (S); HS26, HS38. |
| 9 | Receipt allocation | Interest first. | Common bye-law practice (HS37). |
| 10 | Fund accounting | Bill-based monthly transfer journal from income to the fund reserve. | Matches the I&E presentation (HS39). |
| 11 | Commercial units | Same test, hint. | Sl. 77(c) says "per member" (HS8). |
| 12 | KA bill rows | Present but inactive until the user confirms it is in force. | Commencement not confirmed. |
| 13 | State rules for other States | None; typed. | Not researched; data rows can be appended. |
| 14 | Budget overrun | Cut in §3 order; no extension. | R13–R17 history. |

---

## 9. CA review items (HS1–HS44) — for `docs/CA_REVIEW.md` §18

★ = changes what a document prints or a return reports. Defaults as §8.

| Id | Question for the CA | Default in the app |
|---|---|---|
| HS1 ★ | Sl. 77(c) of N 12/2017-CT(R): ₹5,000 to 24 Jan 2018, ₹7,500 from 25 Jan 2018 (N 2/2018-CT(R)); per residential apartment (Circular 109 Q4). Any change on or after 22 Sep 2025 (N 16/2025-CT(R))? | `RWA_LIMIT_RULES` as stated |
| HS2 ★ | Above ₹7,500: whole amount taxable (Circular 109 Q5) vs only the excess (Madras HC 2021, single judge; W.A. 2318 / 2321 of 2021). Outcome of the appeal? Should the app change the default for societies in Tamil Nadu? | Whole; "excess" setting |
| HS3 ★ | Heads counted towards ₹7,500: sinking fund, repair fund, parking, non-occupancy, interest, special levies (counted); property / water / NA tax and electricity collected for the authority (excluded, CBIC flyer). Is a one-off levy in the same month added to that month's contribution? | As stated |
| HS4 ★ | ₹20 lakh: aggregate turnover including exempt maintenance and non-member income; GST only when both conditions hold (Circular 109 Q2). A society registered voluntarily (or for other income) with turnover ≤ ₹20 lakh: must it charge GST on units above ₹7,500? From which point in the FY once ₹20 lakh is crossed? ₹10 lakh special-category States? | Registration decides; monitor hints |
| HS5 | Quarterly / half-yearly bills: limit = ₹7,500 × months? | Yes |
| HS6 ★ | Statutory dues on a taxable bill: shown as pure-agent (Rule 33) lines outside value and outside GSTR-1? Or as exempt / non-GST supply in Table 8? | Pure agent, outside |
| HS7 | Interest on arrears: part of the value (Sec 15(2)(d)) and taxed with the bill; counted in the month's ₹7,500? | Counted; bill's treatment |
| HS8 ★ | Commercial units (shops, offices) in a housing society / mixed complex: does Sl. 77(c) apply ("per member … housing society or a residential complex")? | Same test with a hint |
| HS9 | Non-member income (mobile tower rent, hoardings, hall hire to outsiders): 18 %, SAC 997212 / others; turnover for ₹20 lakh. | 18 %, separate invoice |
| HS10 | Rate and SAC: Heading 9995 Sl. 33 (9 % + 9 %), SAC 999598 "Home owners associations" — unchanged after 22 Sep 2025? | 18 %, 999598 |
| HS11 ★ | ITC: entitled (Circular 109 Q3) but with exempt bills → Rule 42 / 43 reversal; Sec 17(5)(c) / (d) for works capitalised to the building (lifts, waterproofing, painting). | Common-credit tab; no automatic block |
| HS12 | Electricity / water recovered by a society from its generator or sub-meters: part of the maintenance service (taxable, CBIC flyer) or exempt supply of electricity (HSN 2716)? | Counted, taxable with the bill |
| HS13 ★ | Sinking / repair fund contributions: consideration for a current supply (taxed with the bill) or a deposit / advance (not supply until used)? | Part of the bill |
| HS14 | Document: Bill of Supply for an exempt bill by a registered society; a plain "maintenance bill" by an unregistered one. Wording. | As stated |
| HS15 | Inward RCM: security services from a non-body-corporate agency to a registered society (entry 14; cross-ref MP29); GTA (entry 1, "any society"). | Hint only |
| HS16 | Maintenance agency / builder's maintenance company billing owners: 18 % without Sl. 77(c); SAC 999598 or 9985? | 18 % |
| HS17 | Builder-maintained period before handover: builder's maintenance charges taxable; corpus / advance maintenance on handover. | Agency kind |
| HS18 | Transfer premium / transfer fee on sale of a flat: GST? MH cap (₹25,000, GR of 2001, unverified)? | Typed; counted only if billed as a head |
| HS19 | Non-occupancy charges: MH 10 % of service charges (Rule 106C-12, as reported); GST counted (CBIC flyer). | 10 % hint for MH |
| HS20 ★ | Mutuality: member contributions and the surplus not income; non-member income and bank interest taxable. Presentation in the computation. | Split in D4 |
| HS21 ★ | Sec 149 ITA 2025 (successor of Sec 80P): (2)(c) ₹50,000; (2)(d) interest from investments with another co-operative society — interest from co-operative banks given sub-section (5)? Enacted text confirmation. | Lines by date, `verified: false` |
| HS22 | Section labels by date (80P up to FY 2025-26; 149 from 1 Apr 2026); the optional Sec 203 regime. | As stated |
| HS23 | TDS duties of a society (TAN; contractors under Sec 393, audit fee, professionals, rent) and thresholds. | Existing rows; note only |
| HS24 | Return form (ITR-5), tax audit vs co-op audit, due dates. | Not modelled |
| HS25 | TDS deducted by banks on the society's FD interest; Form 15G / 15H not available to a society. | Note |
| HS26 ★ | MH interest cap: 21 % (model bye-law 72) → 12 % simple (Rule 106C-12, MCS (Amendment) Rules 2026). Which date (18 Jun notification, 22 Jun Gazette, 30 Jun reported)? Does the cap apply to arrears of earlier periods from that date? | Row from 2026-06-22; split by day |
| HS27 | MH sinking ≥ 0.25 % and repair ≥ 0.75 % a year of the architect-certified construction cost; old buildings without a certificate; investment of the sinking fund. | Minimum hints |
| HS28 | MH apportionment bases (Rule 106C-12): service equal per flat; property tax local rate with common share by carpet; water by inlets; lift per lifted flat; insurance / lease by carpet; parking by GB rate. | State defaults |
| HS29 | MH education ₹10 per member per month (Rule 106C-7); entrance fee ₹500; election fund equal. GST on these? | Education counted |
| HS30 | MH registers: Form J (Rule 33), I register, share register, nomination register (Rule 32 / 106C-9): which formats must the society keep, and may they be electronic prints? | Prints as stated |
| HS31 | MH audit: panel auditor (Sec 81), due date, classification, rectification report and its time limit. | Typed dates |
| HS32 | MH draft Model Bye-laws 2026: when final, which money rules change? | Pending note only |
| HS33 ★ | KA Apartment (Ownership and Management) Bill / Act 2026: in force? Area base (s.2(t) super built-up vs s.9 private area); prescribed interest rate; dues certificate (s.20(5)); no withholding of essential services (s.20(6)); audit within six months (s.28). | Rows inactive until confirmed |
| HS34 | TN Apartment Ownership Act 2022: commencement date; Rules 2024 interest rate; recovery from the occupier (s.18(3)); audit within three months (s.21). | `undivided_pct`; cap null |
| HS35 | Delhi: DCS Act 2003 / Rules 2007 interest on dues (9 % / 15 % reported), sinking fund, audit. | No rows |
| HS36 | Other States: anything the app must hold as data? | None |
| HS37 | Receipt allocation: interest first or oldest principal first (MH bye-laws)? | Interest first |
| HS38 | Interest on unpaid interest: never (simple only)? | Never |
| HS39 ★ | Fund contributions: credited to the fund through a transfer from I&E on billing (app) or directly to the fund; on billing or on receipt? | Billing-based transfer |
| HS40 | I&E and R&P format for co-operative societies / associations; Schedule III not applicable; State-prescribed formats. | Label swap + R&P |
| HS41 | Corpus / advance maintenance handed over by the builder (KA Bill: with interest, within 60 days of OC): accounting on receipt. | Typed opening |
| HS42 | Members' deposits and interest on refunds of surplus. | Not modelled |
| HS43 | (Market) Number of CHS in Maharashtra (> 1.25 lakh reported) and AOAs / RWAs elsewhere. | — |
| HS44 | Property tax: paid by the society for the building (MH) vs separate assessment per apartment (TN s.20): pass-through or society expense in the I&E? | Pass-through head |

---

## 10. Test plan (summary)

| Layer | What | Where |
|---|---|---|
| Unit (node:test) | Every engine in `src/lib/society/`; rule rows by date and the `verified` set; State rows by State and date; import graph (`society-rules.ts` only from lazy society modules; engines import only first-paint / family modules; bridges are exactly `hs-*-io.ts`); registry maps; pack gate; print snapshot compare | `tests/hs-*.test.ts` |
| Statutory regression | ₹5,000 / ₹7,500 at 2018-01-24 / 25; ₹7,500.00 vs ₹7,500.01; quarterly × 3; per unit; whole vs excess; MH interest at 2026-06-21 / 22; KA rows inactive; TN undivided %; Sec 80P / 149 labels at 2026-03-31 / 04-01 | `tests/hs-regime.test.ts`, `tests/hs-dues.test.ts`, `tests/hs-tariff.test.ts`, `tests/hs-itax.test.ts` |
| Contracts with existing readers | Exempt bill → Table 8 exempt; taxable → B2C 18 %; `rule33` lines outside; interest waiver as financial credit note skipped by GST readers; fund vouchers in the fund statement; annual pack Schedule III unchanged for existing entity types; purchase contract (`hs-turnover`, `hs-itax`) | `tests/hs-regime.test.ts`, `tests/hs-funds.test.ts`, `tests/annual-pack.test.ts`, `tests/purchase-contract.test.ts` |
| Volume | 2,000 units × 12 periods: one run issues 2,000 documents in one batch; reads stay period-scoped; dues view reads open balances only | `tests/hs-run.test.ts`, `tests/hs-dues.test.ts` |
| Build | `f-society` in `tests/bundle-config.test.ts`; `check:size` per commit; Hindi in core unchanged | `scripts/check-bundle-size.mjs` |
| Existing suites | Must pass unchanged: `batch-*`, `fee-*`, `r5c-*`, `interest*`, `late-fee*`, `tr-interest*`, `funds*`, `annual-pack*`, `gst-reports*`, `einvoice*`, `help-registry`, `docs-links`, `i18n-areas`, `industry-packs`, `mp-*` | — |
| E2E | §7, appended `step(...)` blocks, each write awaited in IndexedDB before navigation | `tests/e2e/smoke.mjs` |
| Offline | `npm run verify:offline` after the last merge | `scripts/verify-offline.mjs` |

---

## 11. Size budget per package (gz, core = English precache)

| Package | First paint | Core (cap) | Planned split | Stop rule (cuts in §3 order) |
|---|---|---|---|---|
| R18-A | **0** (`hs` token in a lazy chunk) | **≤ 11** | Desk + units view + form 3.2, heads view + tariff engine 2.2, State rules 0.8, paper part 1.1, picker 0.7, import 0.9, strings 1.1, help / Ctrl+K / checklist / packs 0.6, demo 0.3, registry / shared / settings 0.6 | At 11 → cut 1 (explain footnote), 2 (inlet / lift bases), 3 (import) |
| R18-B | 0 | **≤ 10** | Run engine + bills view 3.6, regime engine + chip 2.0, GST view + turnover 1.6, issue bridge 0.4, RCM hint 0.4, levy 0.8, strings 0.9, help 0.3 | At 10 → cut 1 (levy), 2 (RCM hint) |
| R18-C | 0 | **≤ 9** | Dues engine + view 3.4, interest / allocation bridge 0.8, certificate + transfer 1.6, reminders 0.8, bank match 0.8, strings 0.9, help 0.3, demo 0.1 | At 9 → cut 1 (bank match), 2 (transfer history), 3 (reminder templates) |
| R18-D | 0 | **≤ 9** | Funds engine + view + journal 2.4, I&E labels 0.5, R&P 1.2, registers + audit + alerts 2.2, income-tax sheet 0.9, strings 1.0, help 0.3, demo 0.1 | At 9 → cut 1 (income-tax sheet), 2 (share / nomination registers), 3 (R&P) |
| **Round** | **0** | **≤ 39 + 1 reserve = 40** | Hindi pack ≤ 8 kB (`lang-hi-society`) | Core stays ≤ baseline + 40 kB (≈ 3,176 kB) |

Each package writes before / after numbers (initial, entry, core, Hindi pack, Hindi in core, `f-society`,
`SocietyDesk`) in its section of `docs/features/society-r18.md`.

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Packages overrun (R13–R15 1.2–2.5 ×; R17 within caps) | M | M | Caps with pre-ranked cuts; one desk; shared strings in one area; reuse of `issueBatch`, `computeInterest`, R5-C funds, statements and reminders; numbers per commit |
| Wrong ₹7,500 outcome (heads counted, whole vs excess, per unit) — tax charged where exempt or missed | M | **H** | Dated rows from primary texts; declaration printed; per-unit test column in the preview; HS1–HS8 ★; valuation setting |
| State rules unverified (MH rules read only in secondary sources; KA not in force; TN Rules not read) | H | M | Rows `verified: false` / `in_force: false`; hints never blocks; values editable; CA items HS26–HS35 |
| Large societies (1,000+ units) make big runs and a big `invoices` table | M | M | One batch per run, volume tests, quarterly cycle documented; reads period-scoped |
| Interest disputes (cap change mid-period, receipts allocation) | M | M | Day-split by State row; allocation shown and editable; waiver as audited financial credit note |
| Reminder wording that threatens essential services (illegal in KA bill; harmful anywhere) | L | H | Template grep test; society template set |
| Personal data (members, nominees, defaulters lists) | M | M | No ID numbers; notice-board print without phones; existing vault mode |
| `f-society` captures nothing because engines import shared lazy code | M | M | Bridges `hs-*-io.ts`; `chunks.json` check per package; import-graph test |
| First paint creeps | L | H | One token only; `check:size` at each merge |
| Confusion with R5-C fees / leases or R11 realty `units` step | L | L | Distinct step names; help topics cross-link; packs are a union |
