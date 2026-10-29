# PRD — Round 21: petrol pumps, CNG stations and LPG distributors (nozzles, shifts, tank dips, density, non-GST fuel)

Status: draft for build · Drafted 2026-10-29 · Baseline: branch `claude/elegant-cannon-cwapiv` at `29a75aa`. Merged on
the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–23, Rounds 7–19, PERF-3 … PERF-5, R20-A (key engine) and the PENDING
items listed in `docs/PROGRESS.md` up to #114. **Still open on the baseline: R20-B, R20-C and R20-D** (`docs/prd/round-20.md`
§7, core cap 20 kB together). They hold room in the core budget, and two of their files overlap this round (§6).

Companion documents:
- `docs/CA_REVIEW.md` §20: the CA items **FU1–FU30** (§9 of this PRD). The lead copies them there when the PRD is
  accepted, and the total moves from **734 to 764**. `FU` ("fuel") is a new prefix. The prefixes in `docs/CA_REVIEW.md`
  rows on `29a75aa` are AC, AG, CN, G, HS, HT, I, LG, MF, MP, P, PF, PS, RT, SV, T, TR, TV, X; older text also uses
  `A B C D H M Q R S`. **`FU` ends in `U`, and no prefix is `U` or `F`**, so `FU1` cannot be read as a shorter id by
  `CA_LIST_RE` (no leading `\b` in `tests/docs-links.test.ts`). It is still not matched at all until A adds `FU` to all
  three regexes (`CITED_RE`, `CA_LIST_RE` and the CA_REVIEW row pattern if it is narrowed later) and a test that
  `ca: ['FU1', 'P1', 'FU30']` reads `['FU1', 'P1', 'FU30']` (§4 conventions).
- Sources: §2.8. **P** = primary text read this round (file downloaded and read, or page fetched), **S** = secondary
  source (press, practitioner article, search-result extract), **V** = vendor's own claim.
- Round 19 (`docs/prd/round-19.md` §1.1, §2.2) ranked the segments left after logistics: automobile dealers (score
  1.0), SaaS / subscription billing (1.0) and coaching / hostels (1.3). Round 20 was a cross-cutting round (Tally keys).
  This PRD scores those three, a segment no earlier ranking listed (fuel retail), and the biggest cross-cutting gaps
  found in the leaders' 2025–2026 release notes (§1.1, §2.2).

Every item follows `AGENTS.md`:
- **Local-first and serverless.** No OMC portal (IOCL / BPCL / HPCL dealer portals, SDMS / Indane / HP Gas / Bharatgas
  booking systems), automation-system (ATG / DU controller), fleet-card host, PESO, Legal Metrology, GST-portal or bank
  call. Meter readings, dips, densities, OMC invoices and fleet-card statements are **typed or imported from a file**.
- **Styling.** Vanilla CSS Modules with tokens. Templates use the `accent` variable only (Critical Rule 5).
- **Invoice snapshots never change.** Everything a fuel document prints (nozzle, vehicle, slip numbers, price row,
  density) is snapshotted on the document (`fu`).
- **Numbering.** Indian-FY numbering. Round 21 adds **no new series**: fuel sales are Bills of Supply (non-GST) or tax
  invoices on the existing series; shifts and tank logs are not numbered documents; credit slips keep the number printed
  on the slip book (typed, unique per company).
- **Dates.** Bare dates are parsed as local days. A shift is `YYYY-MM-DD` + shift number; a price row carries a
  date and an optional `HH:MM` (OMC prices change at 06:00).
- **Statutory values.** Date-keyed and append-only, in a lazy rule file. A row is `verified: true` only when its value
  was read in a primary text this round (the R15–R20 rule). A recommendation is a `pending-changes.ts` note, never a
  rule row. Oil-company dealer rules (Marketing Discipline Guidelines, "MDG") are contract terms, not law: they are
  hint rows and never block a save.
- **Outputs are working papers.** GST, VAT, Legal Metrology and MDG outputs carry "verify with your CA"
  (Critical Rule 10). Stock variation and density checks are hints with the reason shown, never blocks.

---

## 1. Problem statement

### 1.1 Which round, and why this one

Two kinds of round were possible (the lead's brief): **(a)** the next unbuilt industry segment, or **(b)** the biggest
cross-cutting gaps against TallyPrime, Zoho Books, Vyapar, Busy, Marg, myBillBook and ClearTax.

| Candidate | Kind | What the app already has | Left over | Verdict |
|---|---|---|---|---|
| **Petrol / diesel / CNG retail outlets and LPG distributors** | (a), new | POS with shifts and Z report (`pos-shifts.ts`), denominations, cash tally; Bill of Supply with `exempt_kind: 'NON_GST'` and per-line `sv.exempt` (Rule 46A mixed bills, R10); GSTR-1 Table 8 non-GST column and GSTR-3B 3.1(e); Rule 42 / 43 common credit (R5-C); khata, credit limits, statements, reminders; physical stock and stock journals; godowns; R5-B vehicles; clearing bank accounts; party netting (R15-A); security deposits (R5-C6); 194Q in `tds-rules.ts` | **Everything specific:** nozzles and their meter (totaliser) readings, shift-wise attendant (DSM) settlement, the daily 5-litre test returned to the tank, tank dips through a calibration chart, density at receipt and every morning, the daily stock register and the MDG variation band, prices that change at 06:00, credit slips (indents) billed monthly by vehicle, fleet-card money owed by the oil company, the Rule 42 turnover of a pump (duties left out), LPG domestic / commercial rates by customer and refundable cylinder deposits | **Chosen** |
| Automobile dealers / multi-brand service | (a) | 206C(1F), R9 used-goods margin scheme / serials, R10 workshop jobs and motor claims | OEM incentive and scheme credit notes, booking advances by chassis, insurance / finance payout commission, demo-vehicle capitalisation, cess credit stuck after 22 Sep 2025 | Mostly covered (R19 score 1.0) |
| Coaching / hostels | (a) | R5-C fee plans and runs, R10 classes, coaching refund | Hostel room allotment; accommodation exemption | Mostly covered (R19 score 1.3) |
| SaaS / usage billing | (a) | Recurring, deferrals, R14 `svcexport` | Proration, metering, MRR | Small among this app's users (R19 score 1.0) |
| 2026 compliance parity: e-Invoice reconciliation against the GSTR-1 auto-drafted file, TDS challan (CSI) import, self-billed credit / debit notes, approval for manual journals | (b) | IMS file, GSTR-1A, 2B match, e-Invoice bulk / cancel, TDS registers and returns, approvals for documents and bills | The four items named | Real but small; each is S–M and can ride a PENDING sweep (§2.2) |
| Leaders' headline 2025–2026 features: connected banking payments, cloud backup, terminal / dynamic-QR payments, AI bill scanning | (b) | Folder sync, auto-backup, UPI QR + UTR match, bill capture from e-Invoice QR | Need a server, a bank / PSP link or cloud OCR | ⛔ not feasible offline (AGENTS.md rule 1) |

**Why fuel retail.**
1. **Size.** India's petrol-pump network passed **1,00,000 outlets** in 2025 (S, press reports of PPAC data, Dec 2025:
   IOCL 41,664, Nayara 6,921, Jio-bp 2,114, private share ≈ 9.3 %), and there are **≈ 25,600 LPG distributorships**
   (S, PPAC May 2025 bulletin 25,563; government reply Mar 2026 25,605). Almost every outlet is a dealer-operated
   proprietorship or firm that keeps a daily sales and stock register for the oil company **and** books for the CA.
2. **The general apps do not fit, and the specialist apps stop at the register.** Vyapar markets a petrol-pump page with
   nozzle-wise sales, shift cash and tank-wise stock (V) but shows nothing on density, dips through a calibration chart
   or the MDG variation band. Specialist desktop packages (Petro Genius, PumpCount, Petro ERP, Partum Bunk, Miracle
   Petro, Tally add-ons) sell from ≈ ₹13,500 (V) and advertise meter readings and party billing; none of the pages read
   documents the Rule 42 turnover of a pump or the non-GST / GST split in the returns (§2.1). Dealers therefore keep the
   register in the OMC's book or Excel and the books in Tally.
3. **The app already holds the hard GST parts.** Non-GST lines on a Bill of Supply or a mixed bill, Table 8 / 3.1(e),
   the Rule 42 run, POS shifts and Z reports, credit limits and statements, batch issue (`saveMany`), netting with a
   party that is both supplier and payer (the oil company pays the dealer for fleet-card sales). Round 21 is the pump
   glue: nozzles, shifts, tanks, dips, density, slips and the day close. That fits the budget once the size reclaim
   (R21-P) lands.
4. **The money is unusual and easy to get wrong.** Petrol, diesel and natural gas (CNG / PNG) are **outside GST** (Sec
   9(2) CGST Act; no date notified, S). A pump's turnover is ≈ 95 % non-GST, so **Rule 42 / 43 reverses most of the
   ITC on common inputs** (electricity, card-machine fees, repairs). The app's `turnoverOf` counts the whole non-GST
   value, VAT and excise included; the Explanation to Rule 43 is understood to leave out duties under entry 84 of List I
   and entry 54 of List II from both E and F (not read this round, FU12 ★). Lubricants, AdBlue and shop sales are taxable
   (18 %), so most bills are mixed.
5. **The cross-cutting alternative is thinner.** TallyPrime 7.0 (19 Dec 2025, P) added cloud auto-backup, PrimeBanking
   payments, SmartFind, IMS handling, JSON exchange and "cancel e-Way + e-Invoice + voucher together". The app already
   has auto-backup, smart find, IMS, IRN cancel and JSON-in / out; the rest needs a server. Zoho Books' 2026 updates (V)
   add terminal payments (server), e-Invoice reconciliation, TDS challan import, self-billed notes and journal
   approvals: four S–M items, listed for the next PENDING sweep (§13), not a round.

### 1.2 What a pump cannot do in the app today

Checked against the code at `29a75aa` (§2.6):

1. **No nozzle or dispensing unit.** Sales are typed as POS lines in litres; nothing ties a litre to a nozzle, a
   tank or a meter. There is no totaliser reading (opening / closing) and no "testing" quantity returned to the tank.
2. **No shift of attendants.** `pos-shifts.ts` is one counter user's cash drawer. A pump shift is several attendants
   (DSMs) each holding nozzles, and each hands over cash, UPI, card slips, fleet-card slips and credit slips.
   Short and excess per attendant is the daily question.
3. **No tank.** A godown has no capacity, product, calibration chart (dip in mm → litres) or water dip.
4. **No density.** MDG asks for density at 15 °C within **± 3.0 kg/m³** of the OMC invoice density at receipt and a
   morning density every day (P). Nothing records it.
5. **No daily stock register.** Opening dip + receipts − (meter sales − testing) = book stock; closing dip = physical
   stock; the difference is the variation, judged against **4 % of tank stock** after evaporation / handling losses of
   **0.75 % / 0.60 %** (MS) and **0.25 % / 0.20 %** (HSD) (P, MDG cl. 5.1.11). Nothing computes it.
6. **No dated price with a time.** Retail prices change at 06:00, sometimes mid-month; a sale's price must be the one in
   force at its time. The catalogue holds one rate.
7. **No credit slips.** Fleet and transporter customers sign an indent / credit slip per fill (vehicle no., litres,
   driver); the pump bills them monthly with a vehicle-wise annexure. Khata and statements exist; slips do not.
8. **Wrong Rule 42 base for a pump** (point 4 of §1.1): `institutions/common-credit.ts` `turnoverOf` puts all of 3.1(e)
   in E.
9. **No fleet-card money from the oil company.** Fleet-card and OMC loyalty-card sales are paid by the oil company,
   usually by adjusting the dealer's next product invoice. Netting (R15-A) exists; nothing feeds it.
10. **e-Way JSON does not drop non-GST lines.** `eway.ts` builds BIL / INV documents from every line; MS / HSD / natural
    gas need no e-Way bill (Rule 138(14), S). A mixed bill of diesel + lubricant would over-state the value.
11. **LPG distributors** need the household 5 % / other 18 % rate decided by the customer (not the cylinder), refundable
    cylinder / regulator deposits kept out of turnover, and delivery charges taxed with the refill (S). Rates exist in
    the slabs; nothing decides them per customer.

### 1.3 How the fuel profile switches on (no clutter for others)

- **No new `BusinessType`.** `shop-mode.ts` (first paint) is untouched. The profile is a **wizard card** (the R12 / R13
  / R18 / R19 pattern), "Petrol pump, CNG station or LPG distributor", that sets business type **`kirana`** (POS,
  purchases, inventory, reports) and writes **explicit** `modules` (the kirana preset ∪ `accounts`, `banking`, `gst`,
  `tds`, `payroll`) and an **explicit** `industry_packs` list. It never sets `retail_kind` (no retail desk).
- Settings field **`fuel_kind`** (additive; the R12 `agri_kind` … R19 `logistics_kind` approach):

  | `fuel_kind` | Who | Packs | Lands on | Why |
  |---|---|---|---|---|
  | `pump` | Petrol / diesel retail outlet (MS, HSD, branded fuels, lubricants) | `fuel` | `/inventory?tab=fuel&view=shift` | Nozzles, shifts, tanks, slips |
  | `cng` | CNG station (natural gas by kg; outside GST) | `fuel` | same | Same desk; tanks become cascades (no dip, typed stock) |
  | `pump_cng` | Pump with a CNG dispenser | `fuel` | same | The common combination |
  | `lpg` | LPG distributor (domestic / commercial refills, NDEC, stoves) | `lpg` | `/inventory?tab=fuel&view=lpg` | Rates by customer, deposits |
  | `pump_lpg` | Pump that also runs an LPG distributorship or auto-LPG | `fuel`, `lpg` | shift | Union |

- **Two new packs** `fuel`, `lpg` in `industry-packs.ts` (lazy; `PackId` is a type, zero bytes). `PACK_OF_TYPE`,
  `PACK_OF_TYPE_INLINE` and `PACK_ROUTES` are unchanged.
- **Placement: one desk, never a new route or sidebar item.**
  - One new row in `INVENTORY_PACK_TABS` (`page-tabs.ts`): `{ id: 'fuel', pack: 'fuel', alsoPacks: ['lpg'] }` (the R9
    / R12 precedent: stock-based desks live on Inventory).
  - The desk `components/fuel/FuelDesk.tsx` is mounted from the Inventory page like the R12 desks (lazy by tab id).
  - **Nine views** in `&view=`: `tanks`, `prices` (A); `shift`, `dsr` (B); `dips`, `stock` (C); `credit`, `omc` (D,
    pack `fuel`); `lpg` (D, pack `lpg`). A view whose pack is off is not listed (its URL still opens it).
  - The R5-C `common-credit` GST tab gains `fuel` in `PACK_GST_TABS` (`gst-tabs.ts`; the pump's Rule 42 run lives
    there; D2).
- POS: a fuel line is an ordinary POS line with a nozzle chip (A3). No POS layout change for anyone else.
- Settings → Features shows a **"Fuel profile"** row for every `kirana` company (and "Custom"). Turning a pack off
  deletes nothing.

### 1.4 Budgets the round must respect — and why a size reclaim comes first

Baseline: `docs/PROGRESS.md` row #114 on `29a75aa` (first paint **177.9 kB**, core **3,254.5 kB**). The PRD author did
not rebuild; **R21-P measures the baseline before its first commit** and records it in `docs/qa/performance.md`.

| Budget | Now | Limit | Headroom | Still held | Round 21 share |
|---|---|---|---|---|---|
| Initial JS (first paint) | **177.9 kB** | 185 kB | 7.1 kB | R20 B–D: 0 | **0** (the `fu` record-key token lands in the lazy `invoice-defaults` chunk, as `lg` did) |
| Entry chunk | ≈ 89.5 kB | 100 kB | ≈ 10.5 kB | 0 | 0 |
| Core precache (English) | **3,254.5 kB** | 3,300 kB | **45.5 kB** | **R20-B 7 + C 7 + D 6 = 20 kB** (R20-A ran 2.2 kB over its cap) | **≤ 29 kB gross + 1 kB lead reserve = 30 kB**, only after R21-P |
| Hindi pack | ≈ 370 kB | 400 kB | ≈ 30 kB | R20 B–D ≈ 6 kB | ≤ 7 kB (`lang-hi-fuel` family pack) |
| Hindi left in English chunks | 21.7 kB | 36 kB | 14.3 kB | 0 | **0** (literal `defineArea(en, hi)` everywhere) |
| `lazy-leaves` | ≈ 17.6 kB | 20 kB | ≈ 2.4 kB | 0 | ≤ 0.3 kB (`fu-registry.ts` only) |

**The arithmetic.** 45.5 kB headroom − 20 kB for R20 B–D = **25.5 kB**, less than the 30 kB this round needs, and
nothing would be left for QA fixes or Round 22. So **R21-P (PERF-6), a size-reclaim package, merges before R21-A**,
target **≥ 15 kB** of core (§4 R21-P). After R21-P, R20 B–D and Round 21, the core should sit near 3,290 kB with
≈ 10 kB left.

**Stop rule (no asking).** At R21-A's first commit the lead computes `room = 3,300 − core − (R20 caps not yet merged)
− 5`. Round 21's cap is `min(29, room)`. If `room < 29`, the packages cut in §3 order; if `room < 20`, **package D
moves to Round 22** (credit slips stay in B's day close as typed "credit" amounts) and the LPG pack is not shipped.

Calibration (English only): R19-D **+11.1 kB** for 4 items (cap 9); R20-A **+11.2 kB** (cap 9). Both overran by
2 kB, mostly strings and hash churn. So **≈ 2 kB per item with a view, ≈ 1 kB per engine-only item, + ≈ 0.7 kB hash
churn per package**. Round 21 plans **16 items** (4 per package) with a pre-ranked cut list (§3). A package that reaches
its cap cuts; it does not ask.

Rules:
- **First paint.** Nothing. `store/invoice-defaults.ts` (the `fu` token), `industry-packs.ts`, `page-tabs.ts`, the
  Inventory page, `TemplateEngine.tsx`, `NotificationBell.tsx`, the POS route are lazy on `29a75aa` (A re-checks
  `build-meta/chunks.json`: the initial files are `index`, `rolldown-runtime`, `vendor-react`, `vendor-ui`). No
  `PACK_ROUTES`, `PACK_OF_TYPE`, `TABLE_ACTIONS`, `WATCHED_TABLES`, `no-cash.ts`, `tax-rules.ts`, `tds-rules.ts`,
  `ita2025.ts`, `shop-mode.ts`, `dates.ts` or shell edit. Any new lucide icon is refused (§1.5).
- **Family chunk group.** A adds **one row** to `vite.config.ts`:
  `safeFamilyGroup(graph, 'f-fuel', familyRe('fuel', 'fuel-rules', 'fuel-r21', 'fu-registry'), 12)`
  and the name to `tests/bundle-config.test.ts` (the R18 / R19 test shape: the regex captures `src/lib/fuel/fu-tank.ts`,
  `src/lib/fuel-rules.ts`, `src/i18n/areas/fuel-r21a.ts`; not `fu-registry.ts` and not `-pick` areas).
  - **Engines in `src/lib/fuel/` import only first-paint modules** (`storage`, `invoice-calc`, `dates`, `access`,
    `localDb` …), `fuel-rules.ts` and each other.
  - Shared lazy code is reached only through **bridge modules `fu-*-io.ts`** (≤ 4), which stay outside the group:
    - `fu-issue-io.ts` — `localDb.invoices.saveMany`, `bill-of-supply.ts`, `services/sv-tax.ts` (Rule 46A title),
      receipts, `pos-shifts.ts` readers;
    - `fu-stock-io.ts` — `inventory.ts` stock inputs, `godowns.ts`, `manufacturing.ts` `physicalLines` / physical
      stock voucher, `purchase-normalize.ts` `readPurchase` (OMC invoices);
    - `fu-tax-io.ts` — `institutions/common-credit.ts`, `gst-reports.ts` 3B summary, `tds-rules.ts` 194Q, `ita2025.ts`
      labels, `eway.ts` hook;
    - `fu-recv-io.ts` — credit limits, statements, `netting.ts`, `security_deposits` (R5-C6), bank clearing accounts,
      the bell gate helper.
    Engines take their data as arguments.
  - After each package `build-meta/chunks.json` must show `f-fuel` holding every engine and the rules module; a test in
    `tests/fu-rules.test.ts` reads the family regex and the import graph.
- **Hindi.** One area per package, each `defineArea(en, hi)` with a **literal** Hindi object: `fuel-r21a.ts` …
  `fuel-r21d.ts`, ≤ 1.0 kB gz English each. Shared words (nozzle, tank, dip, density, meter reading, testing, shift,
  attendant, slip, variation, litres, kg) live once in `fuel-r21a.ts`. Common Hindi pump words (नोज़ल, टैंक, डिप,
  घनत्व, मीटर रीडिंग, शिफ्ट, पर्ची) are the ones attendants use.
- **Help** ≤ 160 characters per topic per language; statutory detail by CA id (`ca: ['FU12']`). The new tab needs a
  topic in `src/lib/help/topics-packs.ts` and its Ctrl+K title in `discover-r6-tabs.ts` (`tests/help-registry.test.ts`).
- **Rule data is a chunk.** Statutory and MDG values go in **`src/lib/fuel-rules.ts`** (new), imported only by lazy
  fuel modules, never by `tax-rules.ts`, `tds-rules.ts`, `shop-mode.ts` or the shell. Values that already live
  elsewhere stay there and are reached through `fu-tax-io.ts`: GST slabs (`tax-rules.ts`), 194Q (`tds-rules.ts`), Act
  labels (`ita2025.ts`), Rule 42 true-up dates (`r5c-rules.ts`).
- **No new shared components, no stubs.** Reuse `LinesGrid`, `ItemFilterBar`, `controls.module.css`, the R15 `useRun`
  pattern, `escHtml` for every print window, `csv.ts` / dynamic `xlsx.ts` with `import-mapping.ts` for calibration
  charts and slip imports, `localDb.invoices.saveMany` for every batch.

### 1.5 Icons

Every lucide icon is in the first-paint `vendor-ui` chunk; reuse only. Files importing each on `29a75aa` (single-line
import grep; multi-line imports add more): `Truck` 17, `Scale` 11, `Receipt` 10, `Wallet` 10, `Users` 10,
`ClipboardList` 9, `Clock` 6, `Boxes` 6, `Car` 2, `Ruler` 2, `FlaskConical` 2, `Bell` 2. The desk uses `Boxes` (tanks),
`Receipt` (prices), `Clock` (shift), `ClipboardList` (DSR), `Ruler` (dips), `FlaskConical` (density), `Scale` (stock
variation), `Car` (credit slips), `Wallet` (OMC), `Truck` (tank-lorry receipt), `Users` (attendants). **`Fuel`, `Gauge`,
`Droplet`, `Droplets`, `Flame`, `Thermometer` and `CreditCard` are imported nowhere and must not be added.** A re-greps
before its first commit and substitutes `Boxes` for any name that turns out not to be imported.

### 1.6 Non-goals

- **Live connections.** OMC dealer portals and indent systems, automation (ATG probes, DU controllers, "fully automated
  RO"), fleet-card / loyalty-card hosts, LPG booking portals (SDMS, PAHAL / DBTL), GST / VAT portals, payment gateways.
- **State VAT returns.** Petrol and diesel carry State VAT / sales tax under 36 different State laws; most States tax at
  the first point (the oil company), some at retail. The app stores the per-litre excise and VAT **typed from the OMC's
  price build-up** for the Rule 42 base and the margin report only. It prepares **no VAT return** and computes no VAT
  liability (FU5).
- **Temperature / ASTM 53B conversion.** The user types density at 15 °C as the hydrometer table gives it; the app does
  not convert observed density and temperature (no ASTM tables in the bundle).
- **Automation-grade wet-stock management** (leak detection, per-minute tank curves), tank-lorry dispatch, OMC indent
  planning beyond a typed suggestion, company-owned (COCO) outlets' OMC accounting.
- **LPG operations:** consumer booking, cash-memo delivery runs, KYC / connection registration, subsidy (DBTL) handling,
  cylinder testing records; the distributor's rates, deposits and delivery charges only.
- **Deferred:** auto-LPG dispensers (rate rows only, FU22), EV charging bays, convenience-store franchise accounting,
  aviation (ATF) and marine bunkering, bulk HSD consumer pumps (in-house diesel tanks of factories).

---

## 2. Findings

### 2.1 What the leaders offer (research)

| Product | What it does for pumps / gas agencies | Gap for this app's users | Source |
|---|---|---|---|
| Vyapar (petrol-pump page) | Nozzle-wise sales and nozzle reports, shift assignment of attendants, shift cash matched at close, tank-wise stock and low-level alerts, fuel sales recorded "based on applicable state taxes", GST invoices for lubricants and accessories, credit ledgers for fleet owners with SMS / WhatsApp reminders; desktop ₹3,799–8,999 / year | No density, dip chart, testing litres, MDG variation band or Rule 42 base on the page | V vyaparapp.in/free/small-business-accounting-software/petrol-pump |
| Petro Genius (Cogxim) | Meter reading, party-wise billing; "certified by the Rajasthan Petroleum Dealers Association"; from ₹13,500 | Desktop, per-site; nothing published on GST returns | V softwaresuggest / techjockey listings |
| Petro ERP, PumpCount, Partum Bunk, Miracle Petro | Nozzle counts, shift-wise pump reading entry, automated billing, inventory | Few details published | V techjockey / technologycounter listings |
| Tally add-ons for pumps | "Dip reading meter, customer-wise billing, vehicle-wise billing, auto sales invoice" on Tally.ERP 9 | Paid TDL; ERP 9 | V search-result listing |
| TallyPrime 7.0 (19 Dec 2025) | Cloud / local auto-backup, PrimeBanking payments, SmartFind, IMS ITC handling, JSON exchange, cancel e-Way + e-Invoice + voucher together, GSTR-3B export as one file | General ledger; no pump features | P help.tallysolutions.com release notes 7.0 |
| Zoho Books (2026 updates) | Terminal / dynamic-QR payments (Paytm, PhonePe), e-Invoice reconciliation in GSTR-1, TDS challan import, TDS / TCS by the Income-tax Act 2025, CMP-08, self-billed credit / debit notes, approval for manual journals | General; per-org subscription | V help.zoho.com product-update posts (search extracts) |
| myBillBook (2026 changelog) | Solar 8.9 % rate (Jan 2026), AI purchase-bill scanner "Mira AI" (Mar 2026) | General | V knowledge.mybillbook.in changelog (search extract) |

### 2.2 Candidate rounds scored

Value 1–4 (users who need it × how badly the app fails them today), effort S = 1, M = 2, L = 3; score = value ÷ effort.

| Candidate | Size (as reported) | Already in the app | Value | Effort | Score |
|---|---|---|---|---|---|
| **Fuel retail (pumps, CNG) + LPG distributors** | > 1,00,000 outlets (S); ≈ 25,600 LPG distributors (S) | Non-GST lines, Table 8 / 3.1(e), Rule 42, POS shifts, khata, netting, deposits | **4** | M | **2.0** |
| 2026 compliance parity (e-Invoice recon, CSI import, self-billed notes, journal approvals) | Every GST filer, but each item is occasional | IMS, 2B, IRN tools, TDS registers, document approvals | 3 | M | 1.5 |
| Coaching / hostels | Many | R5-C fees, R10 classes, coaching refund | 2 | S–M | 1.3 |
| Automobile dealers / service | FADA networks (S, R19) | 206C(1F), R9 / R10 | 2 | M | 1.0 |
| SaaS / usage billing | Small here | Recurring, deferrals, R14 `svcexport` | 2 | M | 1.0 |
| Leaders' server features (bank payments, cloud OCR, terminal QR) | — | Offline alternatives exist | — | — | ⛔ |

### 2.3 Anatomy of a pump's day (every element needs a place)

| # | Element | Doc / screen | Today | → |
|---|---|---|---|---|
| 1 | Products: MS, HSD, branded MS / HSD, CNG (kg), auto-LPG, lubricants, AdBlue; HSN; GST kind (non-GST / 18 %) | Stock items with `fu.product` | Items only | A3 |
| 2 | Tanks: product, capacity, calibration chart (mm → litres), dip rod; dispensing units and nozzles (tank, product, totaliser, W&M stamping date) | Tanks & nozzles | — | A2 |
| 3 | Retail price per product from date + 06:00, with the OMC build-up (dealer price, excise, VAT, dealer margin) typed | Prices | Catalogue rate | A3 |
| 4 | Morning: dips and water dips per tank, density at 15 °C from the nozzle, nozzle 5-litre test per nozzle | Dips, density register | — | C1, C2 |
| 5 | Shift open: attendants, nozzles held, opening totaliser | Shift | POS user shift | B1 |
| 6 | Sales: cash / UPI / card / fleet-card / OMC loyalty; credit slips per vehicle; lubricant bills (GST) | POS, slips | POS only | A3, D1 |
| 7 | Shift close: closing totaliser → litres − testing = sold; value at the price in force; collections by mode; short / excess per attendant | Shift settlement | — | B1, B2 |
| 8 | Day close: counter-sale documents (non-GST Bill of Supply per product, saveMany), payments by mode, card / fleet to clearing accounts | Day close | — | B3 |
| 9 | Tank-lorry receipt: OMC invoice, compartment dips, invoice vs observed density (± 3.0 kg/m³), short receipt, decantation | Receipt | Purchase bill only | C2 |
| 10 | Daily stock register: opening + receipts − sales (net of testing) = book; closing dip = physical; variation; cumulative vs MDG band | Stock register | — | C3 |
| 11 | DSR / daily sales register in the OMC format; printed and kept for the current + previous FY (P) | DSR print | — | B4 |
| 12 | Month: credit customers' bills with vehicle-wise annexure; fleet-card money set off against OMC invoices; Rule 42 run with the pump's E / F; 194Q on OMC purchases | Credit, OMC, GST | Khata, netting, R5-C | D1–D3 |
| 13 | Licences: PESO (Petroleum Rules) licence, W&M stamping per DU, fire NOC, OMC dealership agreement, calibration certificate of tanks | Alerts | — | C4 |
| 14 | LPG distributor: household 5 % / NDEC / other 18 % by customer, deposits, delivery charge with the refill | LPG view | Slabs only | D4 |

### 2.4 Statutory and dealer rules (as understood; every row is a CA item)

Rows marked `verified: true` were read in a primary text this round. All others are `verified: false` and are hints.

| # | Rule | Value | Source | Rule row (`fuel-rules.ts`) | verified | CA |
|---|---|---|---|---|---|---|
| R1 | Petroleum crude, HSD, MS, natural gas, ATF outside GST until the Council recommends and a date is notified (Sec 9(2) CGST Act); none notified | Non-GST supply, Table 8 non-GST column, 3B 3.1(e) | S explainer May 2026; S Lok Sabha / Rajya Sabha replies 2025 | `FUEL_GST_STATUS_RULES` `{ from: '2017-07-01', product: 'ms'|'hsd'|'cng'|'png', gst: 'non_gst' }` | **false** | FU1 ★ |
| R2 | Lubricants (2710 19 xx), AdBlue, accessories, shop items | GST by the item's HSN slab (lubricants 18 %) | S practitioner tables | none (catalogue slab; hint row `LUBE_HINT_RULES`) | **false** | FU2 ★ |
| R3 | No e-Way bill for alcoholic liquor, petroleum crude, HSD, MS, natural gas, ATF (Rule 138(14)) | Fuel lines left out of the e-Way JSON; a fuel-only document gets a "not needed" note | S (clause letter disputed: (c) / (f) / (h) in different copies) | `EWAY_FUEL_EXEMPT_RULES` | **false** | FU3 ★ |
| R4 | Mixed bill to an unregistered buyer (fuel + lubricant): one "Invoice-cum-Bill of Supply" (Rule 46A) | R10 `sv.exempt` path, title by R10 rule | existing R10 rows | reused (`sv-tax.ts`) | as R10 | FU4 |
| R5 | State VAT / sales tax on MS / HSD (first point in most States) | Typed per-litre VAT in the price row; no return | S | none (typed data) | — | FU5 |
| R6 | Rule 42 / 43: E = exempt (incl. non-GST) turnover; F = total turnover | E / F from the 3B summary (existing R5-C) | existing R5-C rows | reused | as R5-C | FU11 |
| R7 | Explanation to Rule 43 (also for Rule 42): E and F exclude duty under entry 84 List I (central excise) and tax under entries 51 / 54 List II (State tax on petroleum / liquor) | Pump E and F reduced by the typed excise + VAT of the period's fuel sales | not read this round (developers' reading; S practitioner notes on Rule 43) | `RULE42_DUTY_EXCLUSION_RULES` `{ from: '2017-07-01', exclude: ['excise_central', 'vat_state'] }` | **false** | FU12 ★ |
| R8 | 194Q: buyer with turnover > ₹10 crore deducts 0.1 % on purchases from one seller above ₹50 lakh a year (Sec 393 table in ITA 2025 from 1 Apr 2026) | Hint on OMC purchases | existing `tds-rules.ts` / `ita2025.ts` rows | reused | as existing | FU14 |
| R9 | Household domestic LPG 5 % (N 9/2025-CT(R) Sch I S. No. 209), NDEC LPG supplied by IOCL / BPCL / HPCL 5 % (Sch I S. No. 208), other LPG 18 % (Sch II S. No. 30), from 22 Sep 2025; the customer decides, not the cylinder | Rate by `Client.fu.lpg_use` | S taxgarden.in (entry numbers disagree between S sources) | `LPG_RATE_RULES` | **false** | FU20 ★ |
| R10 | Household 5 % / other 18 % before 22 Sep 2025 (from 1 Jul 2017) | Same split | S | `LPG_RATE_RULES` (earlier row) | **false** | FU20 ★ |
| R11 | Refundable cylinder / regulator deposit is not consideration unless applied (Sec 2(31) proviso) | Deposit via R5-C6 `security_deposits`; GST only when forfeited | S taxgarden.in | `LPG_DEPOSIT_RULES` | **false** | FU21 ★ |
| R12 | Delivery charge billed with a refill = composite supply, principal's rate (Sec 8(a)) | Delivery line takes the refill's rate | S taxgarden.in | `LPG_DELIVERY_RULES` | **false** | FU23 ★ |
| R13 | MDG: density at 15 °C of the received product within **± 3.0 kg/m³** of the OMC invoice density | Receipt check (hint) | **P** HPCL MDG 2012 Ver. 7 (30.11.2022), receipt procedure (iv) | `MDG_DENSITY_RULES` `{ from: '2022-11-30', tol: 3.0 }` | **true** (for the 2022 text) | FU15 |
| R14 | MDG: morning opening density from the nozzle recorded every day; daily meter readings and product / water dips each morning in the daily stock register | Morning checklist | **P** MDG cl. 1.3 stock controls (ii), 1.4.1 (b), (c) | `MDG_DAILY_RECORDS_RULES` | **true** | FU16 |
| R15 | MDG: every nozzle checked daily with a W&M-verified 5-litre measure before sales; the test quantity recorded in the stock register | Test litres per nozzle, returned to the tank | **P** MDG cl. 1.4.2 (b), (d) | `MDG_NOZZLE_TEST_RULES` | **true** | FU17 |
| R16 | MDG stock variation: normal operational variation **4 % of tank stock**, after evaporation / handling losses **MS 0.75 %** of quantity sold up to an annual average of 600 KL and **0.60 %** beyond; **HSD 0.25 % / 0.20 %**; shrinkage / temperature allowance only where notified | Variation band (hint) | **P** MDG cl. 5.1.11 | `MDG_VARIATION_RULES` `{ from: '2022-11-30', band_pct: 4, ms: [0.75, 0.60], hsd: [0.25, 0.20], avg_kl: 600 }` | **true** (2022 text) | FU18 ★ |
| R17 | MDG records kept: daily sales register and density register, pump maintenance, purchase invoices and sales bills — current and previous FY; inspections five years | Retention note; DSR print | **P** MDG cl. 5.1.12 | `MDG_RECORDS_RULES` | **true** | FU19 |
| R18 | MDG 2024 (BPCL, effective 24 Oct 2024) may supersede R13–R17 | Rows R13–R17 dated to the 2022 text; a 2024 row is appended once read | S (listing only; PDF refused, 403) | — | **false** | FU18 ★ |
| R19 | Legal Metrology: dispensing pumps verified and stamped; re-verification periodically (Rule 27, General Rules 2011: 12 / 24 / 60 months by instrument) and after repair or relocation | Stamping due per DU (12 months default) | S taxclue / Delhi W&M pages | `WM_REVERIFY_RULES` `{ months: 12 }` | **false** | FU24 |
| R20 | PESO licence under the Petroleum Rules 2002 for storage (renewal dates typed); explosives / fire NOC | Licence register due dates | S | none (typed dates) | — | FU25 |
| R21 | Fuel outside GST ⇒ no GST on the dealer's purchases of MS / HSD; ITC on purchases of lubricants (taxable) stays; ITC on common inputs reversed by Rule 42 | Purchase-line GST kind from the item | developers' reading | none | — | FU13 |

### 2.5 What changed in 2023–2026 for these businesses

- **22 Sep 2025 (GST rate rationalisation):** LPG entries moved to N 9/2025-CT(R) (household 5 %, other 18 %, S); lubricant
  rates unchanged at 18 % (S). Fuel stays outside GST.
- **2025:** the network passed 1 lakh outlets (S); private retailers (Nayara, Jio-bp, Shell) price at market (S).
- **1 Apr 2026:** Income-tax Act 2025 labels for 194Q (Sec 393 table) — already date-keyed in `ita2025.ts`.
- **2026:** ATF / natural gas inclusion in GST discussed by ministers (S); **no Council recommendation found**. If one
  is notified, R1 gets a dated row and CNG lines move to a slab by date (the document date decides, as for every rule).
- **MDG 2024** (BPCL copy effective 24 Oct 2024) exists (S); it was not readable this round. R13–R17 are dated to the
  2022 text and stay hints.

### 2.6 Verified against the code (`29a75aa`)

| Claim | Where |
|---|---|
| Non-GST is an `ExemptKind` (`'NIL' | 'EXEMPT' | 'NON_GST'`), and a line's own column wins on mixed bills | `src/types/invoice.ts` (`ExemptKind`), `src/types/services-r10.ts` `SvExempt`, `gst-reports.ts` (`l.exempt ?? d.exemptKind`, Table 8 and 3.1(e)) |
| Rule 46A "Invoice-cum-Bill of Supply" title exists | `services/sv-tax.ts`, `bill-of-supply.ts` |
| Rule 42 E counts all of 3.1(e) (non-GST) with nil / exempt; no duty exclusion | `institutions/common-credit.ts` `turnoverOf` |
| e-Way JSON builds BIL / INV from every line; nothing drops non-GST lines | `eway.ts` (BIL document type comment, no exempt filter) |
| POS shift = one counter user's drawer (`user_id`, `opening_float`, `bill_ids`) | `pos-shifts.ts` `PosShift` |
| Physical stock lines (book vs counted) exist and post a stock journal | `manufacturing.ts` `physicalLines` |
| Godown has no capacity / product / chart; `kind` is an append-only union | `src/types/stock.ts` `Godown` |
| Clearing bank accounts exist and are kept out of pickers | `src/types/marketplace-r5.ts` `clearing`, `pickableBankAccounts` |
| Security deposits (R5-C6) and their no-cash `deposit_adjustment_id` | `institutions/r5c.ts`, `no-cash.ts` |
| Batch issue writes once (`saveMany`) | `localDb.ts` `invoices.saveMany`, `batch-invoices.ts` `issueBatch` |
| `kirana` preset = `pos`, `purchases`, `inventory`, `reports` (no `gst`, `accounts`, `banking`) — the card must write modules explicitly | `shop-presets.ts` |
| Inventory pack desks are rows of `INVENTORY_PACK_TABS` | `src/pages/page-tabs.ts` |
| No `src/lib/fuel`, no nozzle / dip / density / tank-chart code; `fu` is not a record key | grep over `src/` |
| `FU` is unused as an id prefix | grep `\bFU[0-9]+` over `docs/`, `src/`, `tests/` (no hits) |

### 2.7 Size measurements

Not rebuilt by the author (§1.4 uses `docs/PROGRESS.md` #114 and `docs/qa/performance.md` PERF-5). R21-P rebuilds
first and every package records before / after (initial, entry, core, Hindi pack, Hindi in core, `f-fuel`, `FuelDesk`)
in its section of `docs/features/fuel-r21.md`.

### 2.8 Sources

Primary (read this round):
- **P** HPCL, *Marketing Discipline Guidelines 2012 for Retail Outlet Dealers*, Ver. 7 / 30.11.2022 —
  hindustanpetroleum.com/images/MDG_Retail_2012.pdf (downloaded; text extracted with `pdftotext`): receipt procedure
  (iv) density ± 3.0 kg/m³; 1.3 stock / price controls; 1.4.1 (b), (c); 1.4.2 (a)–(d); 5.1.9; 5.1.11; 5.1.12.
- **P** Tally Solutions, *Release Notes TallyPrime 7.0* (19 Dec 2025) — help.tallysolutions.com/release-notes-tallyprime-7-0.
- **P** This repository at `29a75aa` (§2.6), `docs/prd/round-18.md` §1.1 / §2.2, `docs/prd/round-19.md` §1.1 / §2.2,
  `docs/prd/round-20.md` §7, `docs/PROGRESS.md`, `docs/qa/performance.md`, `docs/GAP_ANALYSIS.md` §3.P.

Secondary:
- **S** Organiser (28 Dec 2025), Swarajya, Outlook Business, Storyboard18: petrol-pump network crosses 1,00,000; IOCL
  41,664, Nayara 6,921, Jio-bp 2,114; private ≈ 9.3 % (reports of PPAC data).
- **S** IANS (16 Mar 2026): 25,605 LPG distributorships, 17,677 rural; J M Baxi *Liquid Gases* May 2025 citing PPAC:
  25,563.
- **S** taxgarden.in, *Income tax and GST for LPG gas agency distributors (AY 2026-27)*: N 9/2025-CT(R) Sch I S. Nos.
  208 / 209, Sch II S. No. 30; Sec 2(31) proviso; Sec 8(a); 194Q. Other S pages (busy.in, cleartax, taxclue) cite
  different entry numbers.
- **S** clevercoins.org (May 2026) explainer on Sec 9(2); Rajya Sabha unstarred question replies (Feb 2025) on fuels and
  GST; S press on ATF / natural gas (governancenow, Jan 2025).
- **S** taxguru, cleartax, taxheal pages on Rule 138(14) e-Way exemptions (clause letter differs between copies).
- **S** cashflo, taxaj notes on Rule 42 / 43 (formula, Explanation 1 (d) duty credit scrips).
- **S** taxclue on Legal Metrology Rule 27 periodicity; Delhi Weights & Measures instructions for checking dispensers.
- **S** BPCL MDG 2024 "effective 24.10.2024" (search listing; the PDF returned 403).

Vendor claims:
- **V** Vyapar petrol-pump page (features, plan prices).
- **V** Petro Genius (softwaresuggest, techjockey), Petro ERP, PumpCount, Partum Bunk, Miracle Petro listings.
- **V** Zoho Books product-update posts April, July, September 2026 (search extracts).
- **V** myBillBook changelog (Jan, Mar 2026; search extracts).

---

## 3. Ranked list: what to build now

Ranked by value to a dealer ÷ size. Cuts are pre-ranked per package (last cut first). Sizes are core gz kB.

| Rank | Item | Pkg | Value | Size | Cut order |
|---|---|---|---|---|---|
| 0 | Size reclaim ≥ 15 kB (PERF-6) | P | gate | −15 | never (the round depends on it) |
| 1 | Profile card, packs, `fuel_settings`, registry, rules file, `f-fuel` group, `FU` regexes, desk shell | A | 4 | 2.2 | never |
| 2 | Tanks and nozzles (tank = godown with `fu`, chart import, DU / nozzle master, W&M date) | A | 4 | 2.0 | A cut 2 drops chart import (typed chart only) |
| 3 | Fuel products, dated prices with time, POS fuel line (₹ ↔ litres, nozzle chip), `fu` snapshot, e-Way non-GST guard | A | 4 | 2.6 | never |
| 4 | Paper block (nozzle / vehicle / slip / price-in-force on the bill), demo rows, help | A | 2 | 1.0 | A cut 1 drops demo rows |
| 5 | Shift entry: attendants × nozzles, opening / closing totaliser, testing litres, litres sold × price | B | 4 | 2.2 | never |
| 6 | Attendant settlement: collections by mode, short / excess, write-off or receipt | B | 4 | 1.6 | B cut 2 drops excess-to-income journal (typed note) |
| 7 | Day close: counter-sale documents via `saveMany`, payments, card / fleet to clearing accounts | B | 4 | 1.8 | never |
| 8 | DSR print (OMC daily sales register) + CSV | B | 2 | 1.0 | B cut 1 drops CSV |
| 9 | Dips + water dips via the chart; morning density; nozzle test list | C | 4 | 1.8 | never |
| 10 | Tank-lorry receipt: link the OMC bill, compartment dips, invoice vs observed density, short receipt | C | 3 | 1.6 | C cut 2 drops compartments (one dip per receipt) |
| 11 | Daily stock register, variation, MDG band, loss posting through physical stock | C | 4 | 2.0 | never |
| 12 | Licence / stamping / calibration alerts (bell gate `fuel`) | C | 2 | 0.9 | C cut 1 drops it to the Licences list without the bell |
| 13 | Credit slips: slip book, vehicle limits, monthly bill with vehicle annexure | D | 4 | 2.2 | never |
| 14 | Rule 42 for pumps: duty exclusion in E / F, 3.1(e) check, 194Q hint on OMC bills | D | 3 | 1.2 | never |
| 15 | OMC account: fleet-card / loyalty money set off against OMC invoices (R15-A netting) | D | 3 | 1.0 | D cut 2 |
| 16 | LPG: rate by customer use, deposits through R5-C6, delivery charge with the refill | D | 3 | 1.4 | D cut 1 (and the whole of D at `room < 20`) |

---

## 4. Specifications (R21-P + 16 items)

**Conventions for every package.**
- New tables and objects are named in `src/lib/fuel/fu-shared.ts` (A creates; later packages append their own names
  in marked blocks). Rights and audit labels are registered at runtime by `src/lib/fuel/fu-registry.ts`: **every module
  that writes a Round 21 table must `import './fu-registry'`**, and so do `sync-engine.ts` and `trust/recycle-bin.ts`
  (`tests/fu-registry.test.ts`, the R18 / R19 shape).
- Round 21 invoice snapshots live under **ONE record key `fu`** (`R21_RECORD_KEYS`, spread into `R9_RECORD_KEYS` in
  `store/invoice-defaults.ts`) — never add keys. A fuel line's non-GST column reuses the R10 line key **`sv.exempt:
  'NON_GST'`**; per-line pump data sits in `fu.lines[lineId]` (`{ nozzle_id?, litres, price_id, slip_id? }`).
- Record / line / settings fields are declared in `src/types/fuel-r21.ts` by declaration merging, one `declare module`
  block per package marked `// R21-A` … `// R21-D`; A declares every sub-field type of `fu` for all packages in one
  commit, so B–D never edit A's block.
- `tests/docs-links.test.ts`: A adds `FU` to `CITED_RE` and `CA_LIST_RE` and the test
  `R21: CA-id patterns read FU ids whole` (`"ca: ['FU1', 'P1', 'FU30']"` → `['FU1', 'P1', 'FU30']`; `'FUX1'` → `null`).
- Help topic `inventory:fuel` (+ one per view only where the view has its own help strip) in `topics-packs.ts`; Ctrl+K
  titles in `discover-r6-tabs.ts`; each view's help strip uses `openHelp('inventory:fuel')`.
- Every number in litres has three decimals at most; money two; density one (kg/m³); dips in mm (integer). Quantities
  are stored as typed and rounded only for display.

### R21-P — Size reclaim, PERF-6 (merge first; no feature change)

**Goal.** ≥ **15 kB** off the core precache with no change to what the app does, so R20 B–D and Round 21 both fit.
Measured per step with `npx vite build` + `gen-precache` + `check-bundle-size` in the same checkout, cumulative, and
written as a "PERF-6" section of `docs/qa/performance.md` (the PERF-5 table shape).

| # | Lever | Why it should pay | Estimate |
|---|---|---|---|
| P1 | **Hindi left in English chunks** (21.7 kB, allow-listed in `check-bundle-size.mjs` `HI_LEAK_ALLOW`): move the Hindi titles of help topics (`t(id, en, hi, …)` in `src/lib/help/topics-*.ts`), the glossary's Hindi and the tips' Hindi into side tables loaded with the language pack (the `vite-hi-split.mjs` mechanism, or a `defineArea` per help family). Keep in English chunks only what a bilingual print needs in one pass (WhatsApp texts, bilingual prints, keymap labels the cheat sheet prints) | Core excludes language packs; help Hindi is read only on Hindi devices or on a Help search that asks for Hindi (search then awaits the pack) | −6 to −9 |
| P2 | **CSS-module class-map chunks without `:global` rules** grouped by family (PERF-5 rejected grouping all 58 only because some carry global print rules) | Per-file overhead of ≈ 40 tiny chunks; `check-bundle-size` asserts no `:global` in the group | −2 to −4 |
| P3 | **`lazy-leaves-ui` threshold** 1,500 → 2,500 B with its cap raised 20 → 28 kB (PERF-5 measured −3.5 kB more at 2,500 B) | Fewer tiny shared chunks; a budget-policy change the lead approves in the PR | −3 to −3.5 |
| P4 | **Dead lazy code**: modules and exports with no importer in `build-meta/chunks.json` (e.g. `day-math.ts` shipped with no call sites, R16-A3), removed or test-only | Bytes nobody runs | −1 to −2 |

Acceptance: core ≥ 15 kB lower than the measured baseline; first paint not higher; Hindi pack ≤ 400 kB and "Hindi in
core" lower; `npm run verify:offline` passes (English install, Hindi switch online / offline); the Help search still
finds topics by their Hindi title on a Hindi device and by English everywhere (`tests/help-registry.test.ts`, a new
`tests/help-hi-split.test.ts`); e2e smoke unchanged. **Stop rule:** a lever that saves < 0.5 kB or changes behaviour is
dropped. If the total is < 10 kB, the lead applies §1.4's stop rule (package D moves to Round 22).

Owned: `scripts/vite-hi-split.mjs`, `scripts/check-bundle-size.mjs`, `scripts/vite-safe-groups.mjs`, `vite.config.ts`
(groups only), `src/lib/help/*` (data layout only, no text change), `tests/bundle-config.test.ts`,
`docs/qa/performance.md`. **No file of R20 B–D or of Round 21 A–D.**

### R21-A — Fuel core (merge first after R21-P)

**A1 · Profile, packs, settings, registry, rules, desk shell.**
- Wizard card "Petrol pump, CNG station or LPG distributor" (`SetupWizard.tsx` card list, the R19 card pattern):
  `business_type: 'kirana'`, explicit `modules` = kirana preset ∪ `accounts`, `banking`, `gst`, `tds`, `payroll`;
  explicit `industry_packs` per §1.3; `fuel_kind`; landing per §1.3. Settings → Features "Fuel profile" row.
- `PackId` += `'fuel' | 'lpg'`; `PACK_IDS` row; `INVENTORY_PACK_TABS` row `{ id: 'fuel', pack: 'fuel', alsoPacks: ['lpg'] }`;
  `PACK_GST_TABS['common-credit']` += `fuel` in `gst-tabs.ts` (D2 uses it; A adds the token so D needs no tab edit).
- Object `fuel_settings` (`settings.manage`, audited on save, synced as a singleton; absent = nothing fuel —
  `fuDefaultsFor(kind)` fills what is not stored): `{ shift_count: 1–4, shift_starts: ['06:00', …], price_time: '06:00',
  test_litres: 5, counter_client_id?, short_ledger_id?, excess_ledger_id?, credit_billing: 'monthly' | 'daily',
  omc_vendor_ids: [] }`.
- `src/lib/fuel-rules.ts` with every row of §2.4 (A's rows R1–R3, R13–R17, R19; B–D append their own rows in marked
  blocks, never edit A's). `tests/fu-rules.test.ts`: date lookup, `verified` flags as §2.4, family regex / import graph.
- `FuelDesk.tsx` with the view switcher (pack-filtered), icons per §1.5, the help strip; views lazy by file name
  (`import.meta.glob` over `components/fuel/*View.tsx`, the R14 / R19 desk precedent) so B–D add views without editing
  the desk.
- **Acceptance:** the card on a fresh company lands on the shift view with the fuel tab only; a grocery `kirana` company
  shows no fuel tab or Features row change; turning `fuel` off hides the tab and deletes nothing; first paint unchanged
  (`check:size`); `chunks.json` shows `f-fuel` with the rules module; the `FU` regex test passes.

**A2 · Tanks and nozzles.**
- A tank is a **godown** with an additive `Godown.fu` block `{ product_item_id, capacity_l, chart: [mm, litres][],
  dead_stock_l?, calibrated_on?, calibration_due? }` (ordinary saleable godown; **no new `Godown.kind`**). CNG cascades
  are tanks with `chart: []` (stock typed in kg, no dip).
- Table **`fuel_nozzles`** (`master.edit`, not dated, audited): `{ id, du_no, nozzle_no, tank_id, item_id,
  totaliser_start, wm_stamped_on?, wm_due?, active }`. A nozzle's product is its tank's product (checked on save).
- Chart: typed rows or imported from CSV / XLSX (mm, litres) through `import-mapping.ts`; `dipToLitres(chart, mm)` by
  linear interpolation, refuses a dip above the chart's last row; monotonic chart enforced.
- View `tanks`: tanks (capacity, product, chart rows, last dip) and DUs / nozzles grid; "Add tank" creates the godown.
- **Acceptance:** `tests/fu-tank.test.ts` — interpolation exact at chart points, between points, refusal above / below,
  non-monotonic chart refused; a nozzle whose item differs from its tank's product is refused; deleting a nozzle with
  shifts goes through `setTable` (recycle bin).
- **Cut 2:** chart import (typed rows only).

**A3 · Products, dated prices, POS fuel line, snapshot, e-Way guard.**
- Stock item flag `StockItem.fu = { product: 'ms' | 'hsd' | 'ms_branded' | 'hsd_branded' | 'cng' | 'auto_lpg' |
  'lube' | 'other', unit: 'L' | 'KG' }`; `ms` / `hsd` / branded / `cng` are non-GST by R1 at the line date
  (`fuGstKind(item, date)`), the rest follow the item's slab.
- Table **`fuel_prices`** (`master.edit`, dated by `date`, audited): `{ id, item_id, date, time: 'HH:MM', rsp,
  build?: { dealer_price?, excise?, vat?, dealer_margin? } }` (per litre / kg). `priceAt(itemId, isoDateTime)` = the
  latest row at or before that moment. View `prices`: today's board, history per product, "copy yesterday".
- POS: picking a fuel item opens the nozzle chip (nozzles of that product) and accepts either **₹** or **litres**
  (`₹500` → litres to 3 decimals at the price in force; the amount is kept exact, the litres rounded — FU8). The line
  carries `sv.exempt: 'NON_GST'` for non-GST products and `fu.lines[lineId] = { nozzle_id, litres, price_id }`.
  Mixed bills (fuel + lubricant) to an unregistered buyer take the R10 Rule 46A title; to a registered buyer the app
  **splits** into a Bill of Supply (fuel) and a tax invoice (lubricant) on save (FU4 default).
- e-Way: `eway.ts` gets one hook (through `fu-tax-io.ts` rules, reading `sv.exempt === 'NON_GST'` and `fu`): fuel
  lines are left out of the item list and the value; a document with only fuel lines shows "e-Way bill not needed —
  Rule 138(14) (verify with your CA)". e-Invoice: a Bill of Supply is not e-invoiced today; the split above keeps fuel
  off tax invoices.
- **Acceptance:** `tests/fu-price.test.ts` (price in force at 05:59 vs 06:00, mid-day revision, no row → refused with
  the reason); `tests/fu-pos-line.test.ts` (₹ ↔ litres, non-GST column in Table 8 and 3.1(e), mixed bill title, split
  for a GSTIN buyer); `tests/fu-eway.test.ts` (mixed bill value excludes fuel; fuel-only → note).

**A4 · Paper block, demo, help.**
- `TemplateEngine` part `FuelLines` (accent variable only): under a fuel line, "Nozzle 2-B · 41.230 L @ ₹94.72 (price
  of 29-10-2026 06:00)" and, when present, vehicle no. and slip no. Printed whenever a document carries `fu`, pack on
  or off (snapshot rule).
- Demo company rows (only through `demo-company.ts`): two tanks, four nozzles, three days of prices.
- Help topic, Ctrl+K title, Features row text.
- **Cut 1:** demo rows.

**A cap ≤ 8 kB.**

### R21-B — Shifts, attendants and the day close

**B1 · Shift entry.** Table **`fuel_shifts`** (`doc.create`, dated by `date`, audited; one row per day × shift number):
`{ id, date, shift_no, opened_at, closed_at?, attendants: [{ employee_id? | name, nozzle_ids }], readings: [{ nozzle_id,
opening, closing?, test_l, test_returned: true }], collections: [...] (B2), status: 'open' | 'closed' | 'posted' }`.
Opening totaliser = the previous closed shift's closing (editable with an audited reason). Litres sold per nozzle =
closing − opening − test; value = Σ litres × price in force during the shift (a mid-shift price change splits the
nozzle's litres by a typed reading at the change, default all at the opening price — FU9). View `shift`.
**Acceptance:** `tests/fu-shift.test.ts` — opening carried; meter rollover (totaliser wraps at 10⁷ or the typed
maximum) handled; negative sale refused; test litres never counted as sales; price split.

**B2 · Attendant settlement.** Per attendant: expected = value of their nozzles' litres − litres billed on POS bills
or credit slips from those nozzles in the shift; collections typed by mode (cash with denominations reuse, UPI, card,
fleet card, OMC loyalty, credit slips total from D1 or typed); short / excess = collected − expected. A shortage is
settled by (a) a receipt from the attendant (cash), or (b) the existing `write_off` row to "Shortage at pump" (a
no-cash marker already read by `movedNoCash`). An excess posts a journal to "Excess at pump" (other income) through
`saveVoucher`. Recovery from salary is **not** built (FU10). **Acceptance:** `tests/fu-settle.test.ts` — expected
amounts, a shortage written off never reaches the cash book (`movedNoCash`), an excess journal balances.
**Cut 2:** excess journal (shown as a note only).

**B3 · Day close.** For each closed shift, the counter litres (meter litres not on a POS bill or slip) post as **one
Bill of Supply per shift** (`exempt_kind: 'NON_GST'`; lines per product; client `fuel_settings.counter_client_id`
"Counter sales — fuel"; `fu.shift_id`) through `localDb.invoices.saveMany` in one write, with payment rows by mode:
cash → cash, UPI → the chosen bank, card / fleet / loyalty → **clearing bank accounts** (`BankAccount.clearing`, created
on first use: "Card settlements clearing", "Fleet-card receivable (OMC)"). Taxable products sold at the counter without
a POS bill (lubricants are not on meters) are out of the day close. Undo = cancel the shift's documents (status back
to `closed`). **Acceptance:** `tests/fu-dayclose.test.ts` — one write for the day; stock leaves the right tank per
nozzle; payment modes reach the right accounts; clearing accounts are never offered in cheque / BRS pickers; undo
restores `closed` and the numbers stay reserved (recycle-bin rule).

**B4 · DSR print.** Daily sales register in the OMC layout: per nozzle opening / closing / test / sale; per product
litres, rate, value; collections by mode; credit sales; short / excess — print window (`escHtml`), A4 landscape, and
CSV. **Cut 1:** CSV.

**B cap ≤ 7 kB.**

### R21-C — Tanks, dips, density and the stock register

**C1 · Dips and density.** Table **`fuel_tank_logs`** (`doc.create`, dated by `date`, audited): kinds `dip`
`{ tank_id, time, mm, water_mm?, litres (derived, stored) }`, `density` `{ tank_id | nozzle_id, time, density_15 }`,
`receipt` (C2). Morning checklist per §2.4 R14 / R15: each tank dipped, each nozzle tested, a morning density per
product; missing items listed (never a block). View `dips` with the density register (MDG Annexure 1 columns).
**Acceptance:** `tests/fu-dips.test.ts` — litres from the chart; water dip shown, not deducted from product litres
unless the chart is product-only (setting, FU16); the checklist lists what is missing.

**C2 · Tank-lorry receipt.** Linked to the OMC purchase bill (read through `readPurchase`; purchases contract:
`tests/purchase-contract.test.ts` gets `fuel/fu-receipt.ts`). Per compartment: invoice litres, dip before / after,
invoice density vs observed density at 15 °C → flag outside ± 3.0 kg/m³ (R13). Short receipt = invoice litres − (tank
after − tank before − sales during decantation); the shortage is a **note and a debit-note draft suggestion** to the
OMC, never posted automatically. **Acceptance:** `tests/fu-receipt.test.ts`. **Cut 2:** compartments (one dip pair per
receipt).

**C3 · Daily stock register.** Per tank per day: opening dip litres + receipts − (meter litres − test) = book;
closing dip = physical; variation litres and %; month-to-date and year-to-date cumulative; the MDG band (R16: 4 % of
tank stock; evaporation allowance by product on quantity sold, the 600 KL annual-average step) as a hint with the
numbers shown. "Post loss / gain" creates a **physical stock voucher** for the tank (through `fu-stock-io.ts`
`physicalLines`), class "Normal loss — evaporation / handling", once per tank per month (FU18). View `stock`.
**Acceptance:** `tests/fu-stock-register.test.ts` — book stock formula; band at 600 KL step; posting is idempotent per
month; the app's stock summary and the register agree after posting.

**C4 · Licences and due dates.** Licence rows reuse the existing licence pattern (`fuel_settings.licences: [{ kind:
'peso' | 'wm_du' | 'fire' | 'calibration' | 'dealership' | 'other', ref, valid_to }]`; W&M due also from nozzles'
`wm_due`; calibration from tanks). `fu-alerts.ts` behind the bell's `fuel` gate (one `gate(...)` line in
`NotificationBell.tsx`, the R17 / R19 precedent). **Cut 1:** bell (list on the `tanks` view only).

**C cap ≤ 7 kB.**

### R21-D — Credit customers, GST / ITC, OMC account and LPG

**D1 · Credit slips.** Table **`fuel_slips`** (`doc.create`, dated by `date`, audited): `{ id, slip_no (typed, unique
per company), date, shift_id?, client_id, vehicle_no, driver?, item_id, litres, amount, nozzle_id?, billed_doc_id? }`.
Vehicle-wise limits on `Client.fu = { vehicles: [{ no, limit_l?, limit_amount? }], lpg_use? }` (credit limit
`credit-limit.ts` reused at the party level). Month end (or daily by `credit_billing`) issues **one Bill of Supply per
customer** for the fuel slips (+ a tax invoice for lubricants on slips) through `saveMany`, with the **vehicle-wise
annexure** (existing `annexure` field). Billed state is derived from `fu.slip_ids` on live documents (undo = cancel the
bills), never stored. The stock register (C3) is meter-based, so unbilled slips are already counted as sold litres;
the inventory engine catches up on billing (FU7). View `credit`. **Acceptance:** `tests/fu-slips.test.ts` — duplicate
slip number refused; vehicle over limit warned; monthly bill groups by customer; cancelling the bill frees the slips.

**D2 · Rule 42 for pumps.** In the R5-C common-credit run, when `fuel` is on: E and F are computed by
`turnoverOf` and then reduced by Σ (excise + VAT per litre of the price row in force) × litres of the period's fuel
sales (`RULE42_DUTY_EXCLUSION_RULES`, R7, `verified: false`), with the working shown and a switch "Leave duties in"
(FU12). 3B check: Table 3.1(e) = non-GST sales of the period; a mismatch is listed. 194Q hint on OMC bills (existing
rows). One change in `common-credit.ts`: an optional `adjust?: (E, F) => {E, F, note}` argument (default identity).
**Acceptance:** `tests/fu-rule42.test.ts` — E / F with and without the exclusion; reversal smaller with exclusion; no
change for a company without `fuel`.

**D3 · OMC account.** Fleet-card and OMC loyalty-card collections sit in the clearing account from B3; the OMC's
statement (CSV import through `import-mapping.ts`) is matched to them, and the amount the OMC adjusts against its
invoice posts as a **netting** receipt (R15-A `netting.ts`, `Vendor.client_id`: the OMC is both supplier and payer).
**Acceptance:** `tests/fu-omc.test.ts` — netting marker used, cash readers skip it (`movedNoCash`), clearing account
returns to zero. **Cut 2.**

**D4 · LPG.** `Client.fu.lpg_use: 'household' | 'ndec' | 'other'`; the LPG refill line takes 5 % / 18 % by the
customer and date (`LPG_RATE_RULES`, R9 / R10, `verified: false`), shown as a chip with the reason; delivery charge
lines follow the refill (R12); refundable cylinder / regulator deposits through R5-C6 `security_deposits` (no GST;
forfeit → a tax invoice at the refill's rate, FU21). View `lpg`: connections with deposits, today's refills by use.
**Acceptance:** `tests/fu-lpg.test.ts`. **Cut 1** (and D as a whole moves to Round 22 when `room < 20`).

**D cap ≤ 7 kB.**

---

## 5. Work packages

**Merge order:** **R21-P**, then **R21-A**, then **B, C and D in parallel, any order**.

| Package | Scope | Owned (new) | Owned (edit) | Cap (core gz) |
|---|---|---|---|---|
| **R21-P** | P1–P4 | `tests/help-hi-split.test.ts` | `scripts/{vite-hi-split,check-bundle-size,vite-safe-groups}.mjs`, `vite.config.ts` (groups), `src/lib/help/*` (layout only), `tests/bundle-config.test.ts`, `docs/qa/performance.md` | **≤ −15** (a reclaim) |
| **R21-A** | A1–A4 | `src/lib/fuel/{fu-shared,fu-registry,fu-settings,fu-tank,fu-price,fu-line}.ts`, `src/lib/fuel/fu-issue-io.ts`, `src/lib/fuel/fu-tax-io.ts`, `src/lib/fuel-rules.ts`, `src/types/fuel-r21.ts`, `src/components/fuel/{FuelDesk,TanksView,PricesView,NozzleChip}.tsx`, `fuel.module.css`, `src/components/templates/parts/FuelLines.tsx`, `src/i18n/areas/fuel-r21a.ts`, `docs/features/fuel-r21.md`, tests `fu-rules`, `fu-registry`, `fu-tank`, `fu-price`, `fu-pos-line`, `fu-eway` | `industry-packs.ts`, `page-tabs.ts` (1 row), `gst-tabs.ts` (`PACK_GST_TABS` token), `SetupWizard.tsx` (card), Settings → Features (row), `shop-presets.ts` (card preset), `store/invoice-defaults.ts` (`R21_RECORD_KEYS` token), POS line component (nozzle chip slot), `eway.ts` (one hook), `TemplateEngine.tsx` (mount part), `sync-engine.ts` + `trust/recycle-bin.ts` (registry import), `backup.ts` (tables), `vite.config.ts` + `tests/bundle-config.test.ts` (`f-fuel`), `tests/docs-links.test.ts` (`FU`), `topics-packs.ts`, `discover-r6-tabs.ts`, `demo-company.ts` | **≤ 8** |
| **R21-B** | B1–B4 | `src/lib/fuel/{fu-shift,fu-settle,fu-dayclose,fu-dsr}.ts`, `src/components/fuel/{ShiftView,DsrView}.tsx`, `src/i18n/areas/fuel-r21b.ts`, tests `fu-shift`, `fu-settle`, `fu-dayclose` | `fu-shared.ts` (B block), `fuel-rules.ts` (B block, if any), `fuel-r21.ts` (B block), `fu-issue-io.ts` (B functions appended) | **≤ 7** |
| **R21-C** | C1–C4 | `src/lib/fuel/{fu-dips,fu-receipt,fu-register,fu-alerts}.ts`, `src/lib/fuel/fu-stock-io.ts`, `src/components/fuel/{DipsView,StockView}.tsx`, `src/i18n/areas/fuel-r21c.ts`, tests `fu-dips`, `fu-receipt`, `fu-stock-register` | `fu-shared.ts` (C block), `fuel-rules.ts` (C block), `fuel-r21.ts` (C block), `NotificationBell.tsx` (one gate line), `tests/purchase-contract.test.ts` (one reader) | **≤ 7** |
| **R21-D** | D1–D4 | `src/lib/fuel/{fu-slips,fu-rule42,fu-omc,fu-lpg}.ts`, `src/lib/fuel/fu-recv-io.ts`, `src/components/fuel/{CreditView,OmcView,LpgView}.tsx`, `src/i18n/areas/fuel-r21d.ts`, tests `fu-slips`, `fu-rule42`, `fu-omc`, `fu-lpg` | `fu-shared.ts` (D block), `fuel-rules.ts` (D block), `fuel-r21.ts` (D block), `institutions/common-credit.ts` (optional `adjust` argument), `tests/no-cash-readers.test.ts` (one reader) | **≤ 7** |

**Combined:** first paint **0** at every merge; core **≤ 29 kB gross + 1 kB lead reserve = 30 kB** after R21-P's
reclaim; Hindi pack ≤ 7 kB; Hindi in core 0. Each package runs `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build` and `npm run check:size` (one at a time, under the shared lock), and again after rebase; the last
package also runs `npm run test:e2e` and `npm run verify:offline`.

---

## 6. Shared-file protocol

| File | Who | Rule |
|---|---|---|
| `src/lib/fuel/fu-shared.ts`, `src/lib/fuel-rules.ts`, `src/types/fuel-r21.ts` | A creates; B / C / D append | One marked block per package (`// R21-B` …); never edit another block; a union conflict is resolved by keeping both blocks |
| `src/lib/fuel/fu-registry.ts` | A | A registers **every** Round 21 table (including B–D's) in one commit, so B–D never edit it; a table B–D drop by a cut stays registered and unused |
| `src/lib/fuel/fu-issue-io.ts` | A creates, B appends | B adds `saveMany` / payment helpers at the end; A's exports unchanged |
| `src/components/fuel/FuelDesk.tsx` | A | Views mounted by file name; B–D add `*View.tsx` files only |
| `src/i18n/areas/fuel-r21a.ts` | A | Shared words for the whole round; B–D add their own area files |
| `src/pages/page-tabs.ts`, `industry-packs.ts`, `gst-tabs.ts` | A only | A adds the `fuel` tab row and the `common-credit` `PACK_GST_TABS` token for D |
| `src/components/command/NotificationBell.tsx` | C (one `gate` line) | **R20-D also edits this file** (Alt+N menu sheet): a one-line, append-only change; whoever merges second rebases |
| `src/components/onboarding/SetupWizard.tsx` | A (card) | **R20-D also edits it** (wizard question): A's change is a card-list entry only; rebase on conflict |
| POS line component | A (nozzle chip slot) | R20-B does not touch POS (its scope is the editor, bills, Gateway voucher); no overlap expected |
| `vite.config.ts`, `tests/bundle-config.test.ts` | R21-P (groups / leaves), then A (`f-fuel` row) | Sequential merges; A rebases on P |
| `src/lib/help/topics-packs.ts`, `discover-r6-tabs.ts` | A, R21-P (layout) | P changes the data layout of Hindi titles; A adds its topic in the new layout after rebasing |
| `institutions/common-credit.ts` | D | One optional argument; default behaviour unchanged (`tests/common-credit*.test.ts` green) |
| `eway.ts` | A | One hook call; no other edit |
| `tests/e2e/smoke.mjs` | A–D | One appended `step(...)` block each, in merge order |
| `docs/features/fuel-r21.md` | A creates | One section per package with its bundle numbers and deviations |
| `src/lib/whats-new.ts`, `package.json` version, `AGENTS.md`, `docs/ROADMAP.md`, `docs/CA_REVIEW.md` §20, `docs/PROGRESS.md` | lead | After each merge; AGENTS.md gets a "Round 21 (fuel)" storage paragraph (§6 storage summary) |

### Storage summary

| Key / table | Package | Kind | Backed up | Synced | Rights | Dated |
|---|---|---|---|---|---|---|
| `fuel_settings` (object) | A | company data, singleton | yes | yes | `settings.manage` | no |
| `fuel_nozzles` | A | company data | yes | yes | `master.edit` | no |
| `fuel_prices` | A | company data | yes | yes | `master.edit` | `date` |
| `Godown.fu`, `StockItem.fu`, `Client.fu` | A / D | additive fields | with their tables | yes | as their tables | — |
| `fuel_shifts` | B | company data | yes | yes | `doc.create` | `date` |
| `fuel_tank_logs` | C | company data | yes | yes | `doc.create` | `date` |
| `fuel_slips` | D | company data | yes | yes | `doc.create` | `date` |
| `InvoiceRecord.fu` | A–D | ONE record key (`R21_RECORD_KEYS`) | with invoices | yes | — | — |

No new device-local key, no `series_counters` series, no new no-cash marker, no new `Godown.kind`.

---

## 7. E2E steps (production build, `tests/e2e/smoke.mjs`)

1. A: fresh company → card "Petrol pump" → lands on `/inventory?tab=fuel&view=shift`; add tank (chart 3 rows), nozzle,
   price 94.72 from today 06:00; POS: pick petrol, type ₹500 → 5.279 L; save; preview shows the nozzle line; GST
   reports show the bill in Table 8 non-GST.
2. B: open shift, opening 1000.000, closing 1250.000, test 5 → 245 L; collections cash = value; close; day close → one
   Bill of Supply; DSR prints.
3. C: dip 1,200 mm → litres from the chart; receipt with density 742.0 vs 746.5 → flag; stock register shows the
   variation and the band.
4. D: two slips for one customer → month-end bill with a two-row vehicle annexure; Rule 42 run shows the duty-excluded
   E / F; LPG customer `household` → 5 % chip.

---

## 8. Open questions — with the default the builders will use

| # | Question | Default chosen | Why |
|---|---|---|---|
| Q1 | A new business type or a card? | Wizard card; `kirana` + `fuel_kind`; explicit modules and packs | Zero shell bytes; R12–R19 pattern |
| Q2 | Where do the screens live? | One tab `fuel` on `/inventory`, nine views | Stock-based desks live there (R9, R12) |
| Q3 | Tank = godown or its own table? | Godown with `Godown.fu` | Stock engine, transfers, physical stock and the stock summary work unchanged |
| Q4 | Counter sales: one document per shift or per day? | Per shift | Attendant settlement is per shift; DSR still sums the day |
| Q5 | Credit slips billed monthly or daily? | Monthly (setting `credit_billing`) | Trade practice; fuel is outside GST invoicing rules (FU7) |
| Q6 | Mixed bill to a GSTIN buyer | Split into Bill of Supply + tax invoice | Keeps fuel off tax invoices, e-Invoice and e-Way (FU4) |
| Q7 | Mid-shift price change | Split by a typed reading; default all at the opening price | Most pumps change at 06:00 between shifts (FU9) |
| Q8 | Shortage recovered from salary | Not built (receipt or write-off only) | Payroll deduction needs a payroll bridge and a CA view on wages (FU10) |
| Q9 | Stock variation posting | Monthly physical stock voucher, class "Normal loss" | One voucher a month per tank; daily posting floods the books (FU18) |
| Q10 | Rule 42 duty exclusion on by default? | **On**, with "Leave duties in" switch and the working shown | Reading of the Explanation (FU12 ★); reversible |
| Q11 | VAT | Typed per litre in the price row; no return | 36 State laws; non-goal |
| Q12 | Budget overrun | Cut in §3 order; D moves to Round 22 when `room < 20` | §1.4 stop rule |

---

## 9. CA review items (FU1–FU30) — for `docs/CA_REVIEW.md` §20

★ = changes what a document prints or a return reports. Defaults as §8.

| Id | Question for the CA | Default in the app |
|---|---|---|
| FU1 ★ | MS, HSD (incl. branded), CNG and PNG are outside GST under Sec 9(2) until a date is notified; the pump reports their sales as non-GST (GSTR-1 Table 8 non-GST column, GSTR-3B 3.1(e)). Right, including CNG sold by a dealer (not the gas company)? | As stated |
| FU2 ★ | Lubricants, greases, AdBlue, coolant at 18 % by HSN; any of them at another rate after 22 Sep 2025? | Item slab |
| FU3 ★ | No e-Way bill for MS / HSD / natural gas (Rule 138(14)); for a mixed consignment (diesel + lubricant), the e-Way value is the lubricant only. Which clause letter is current? | Fuel lines left out |
| FU4 ★ | A mixed bill (fuel + lubricant) to an unregistered buyer is one "Invoice-cum-Bill of Supply" (Rule 46A); to a registered buyer the app splits it into a Bill of Supply and a tax invoice. Is the split needed, or may one tax invoice show the non-GST fuel lines? | Split for GSTIN buyers |
| FU5 | VAT on MS / HSD is outside the app: per-litre VAT is typed for the Rule 42 base and margins only. Any State where the retail dealer must also show VAT on the bill? | Not printed unless typed in the item name |
| FU6 | A Bill of Supply per shift for counter sales (not per customer) — acceptable as the dealer's sales record for income tax and the MDG "sales bills" requirement? | Per shift |
| FU7 | Credit slips billed monthly: the sale is recognised on the bill date in the books while the litres leave the tank on the slip dates (the MDG register is meter-based). Acceptable, or must unbilled slips be accrued at month end in the books (they are billed by then)? | Monthly bill dated month end |
| FU8 | "₹500 of petrol": the bill shows ₹500.00 and litres to three decimals at the price in force; the litre rounding is not adjusted. Right? | As stated |
| FU9 | Mid-shift price change: litres split by a typed reading; without it, all at the opening price. Right? | As stated |
| FU10 | Attendant shortages: settled by cash receipt or written off to "Shortage at pump" (expense). Recovery from salary is not built. Any TDS / PF / wage-law point on deducting shortages? | Receipt or write-off |
| FU11 | Rule 42 / 43 for a pump: E = non-GST + exempt turnover, F = total turnover (existing R5-C working). Is non-GST fuel "exempt supply" for Rule 42 through Sec 2(47)? | As stated |
| FU12 ★ | The Explanation to Rule 43 (applied to Rule 42) is read as excluding central excise (entry 84 List I) and State tax on petroleum (entries 51 / 54 List II) from both E and F. The app takes the typed excise + VAT per litre of the price in force × litres sold. (a) Is that reading right? (b) Is the price build-up typed from the OMC acceptable evidence? (c) Default on? | On, with a switch and the working |
| FU13 | ITC on purchases: none on MS / HSD (no GST charged); full on lubricants for resale; common inputs (electricity, card-machine fees, repairs, canopy) through Rule 42; capital goods (DUs, tanks) through Rule 43. Any blocked credit (Sec 17(5)) specific to pumps? | As stated |
| FU14 | 194Q on OMC purchases when the dealer's turnover exceeded ₹10 crore: 0.1 % above ₹50 lakh from one OMC in the year (Sec 393 table from 1 Apr 2026). Does the OMC instead collect / the dealer deduct under another section? | Hint only |
| FU15 | MDG receipt density tolerance ± 3.0 kg/m³ (2022 text, P). Has MDG 2024 changed it? | Hint at ± 3.0 |
| FU16 | Water dip: product litres = chart(product dip) − chart(water dip)? Or the chart is already product-only? | Setting; default subtract water |
| FU17 | Daily 5-litre test per nozzle returned to the tank, recorded and excluded from sales (P). Any State W&M rule differing? | As stated |
| FU18 ★ | Stock variation: monthly physical stock voucher for the tank's variation within the MDG band (4 % of tank stock after evaporation MS 0.75 % / 0.60 %, HSD 0.25 % / 0.20 %; 2022 text). (a) Normal loss charged to purchases / cost of goods, abnormal loss separate? (b) Any ITC point (none on fuel)? (c) MDG 2024 values? | Monthly, normal-loss class |
| FU19 | Records retention per MDG: current + previous FY for sales / density registers (P) vs 8 years under the CGST Act / Companies Act. The app keeps everything; the DSR print is the OMC copy. | Keep all |
| FU20 ★ | LPG: household 5 % (Sch I 209), NDEC by the OMC 5 % (Sch I 208), other 18 % (Sch II 30) from 22 Sep 2025; before that household 5 %, other 18 %. (a) Entry numbers (sources differ)? (b) NDEC sold by a distributor (not the OMC) — 5 % or 18 %? | As stated; NDEC 18 % when sold by the distributor |
| FU21 ★ | Refundable cylinder / regulator deposits: no GST on receipt (Sec 2(31) proviso); on forfeiture (lost cylinder) a tax invoice at 18 %? or the refill's rate? | 18 % on forfeiture |
| FU22 | Auto-LPG sold at a pump (2711): rate? (rows only; no dispenser support beyond a nozzle) | 18 % hint, `verified: false` |
| FU23 ★ | LPG delivery charges billed with a refill are a composite supply at the refill's rate (Sec 8(a)); billed separately later — 18 %? | With the refill |
| FU24 | Legal Metrology re-verification of dispensing pumps every 12 months (Rule 27, General Rules 2011) and after repair / relocation — confirm periodicity; State rules differ? | 12 months, alert 30 days before |
| FU25 | PESO licence (Petroleum Rules 2002) renewal, fire NOC, tank calibration — dates typed; any statutory consequence the app should state? | Alerts only |
| FU26 | Fleet-card / OMC loyalty-card money adjusted by the OMC against its invoice: recorded as a netting receipt (no cash); OMC service charges on fleet cards — taxable supply to the dealer (ITC through Rule 42)? | As stated |
| FU27 | Card-machine MDR / UPI charges: bank's tax invoice, ITC common (Rule 42). Right? | As stated |
| FU28 | Dealer commission / "additional dealer margin" / incentives credited by the OMC by credit note: GST on a commercial credit note without GST? Income in the dealer's books only? | Income; no GST computed |
| FU29 | Excess cash at the pump (collected > expected): other income; any GST / VAT on it? | Other income, no tax |
| FU30 | Presumptive taxation (44AD) for a pump: turnover = gross receipts including excise / VAT built into the price? The app's turnover reports show gross; a "net of duties" figure is shown beside it. | Gross, with net shown |

---

## 10. Test plan (summary)

| Area | Tests |
|---|---|
| Rules and family | `fu-rules` (dates, `verified` flags, import graph), `fu-registry` (rights, audit, sync / recycle-bin import), `bundle-config` (`f-fuel`), `docs-links` (`FU`) |
| A | `fu-tank`, `fu-price`, `fu-pos-line`, `fu-eway`; snapshot test: printing an old bill after a price change shows the old price |
| B | `fu-shift`, `fu-settle`, `fu-dayclose`; `no-cash-readers` covers the write-off path |
| C | `fu-dips`, `fu-receipt` (+ `purchase-contract`), `fu-stock-register` |
| D | `fu-slips`, `fu-rule42`, `fu-omc`, `fu-lpg`; `common-credit` tests unchanged |
| Volume | 4 shifts × 365 days × 8 nozzles; 50 credit customers × 300 slips a month: day close and monthly bills each one `saveMany` write; DSR < 200 ms |
| P | `help-hi-split`, `help-registry`, `verify:offline`, size table in `docs/qa/performance.md` |

---

## 11. Size budget per package (gz, core = English precache)

| Package | First paint | Core (cap) | Planned split | Stop rule (cuts in §3 order) |
|---|---|---|---|---|
| R21-P | ≤ 0 | **≤ −15** | P1 −6…−9, P2 −2…−4, P3 −3…−3.5, P4 −1…−2 | Lever < 0.5 kB or behavioural → dropped; total < 10 → D moves to Round 22 |
| R21-A | **0** (`fu` token in a lazy chunk) | **≤ 8** | Desk + settings + card + registry 2.2, tanks / nozzles + chart 2.0, prices + POS line + e-Way hook 2.6, paper part 0.5, strings 0.7 (incl. shared words) | At 8 → cut 1 (demo rows), 2 (chart import) |
| R21-B | 0 | **≤ 7** | Shift engine + view 2.2, settlement 1.6, day close 1.8, DSR 0.8, strings 0.6 | At 7 → cut 1 (CSV), 2 (excess journal) |
| R21-C | 0 | **≤ 7** | Dips / density + view 1.8, receipt 1.6, register + view 2.0, alerts 0.6, strings 0.6 | At 7 → cut 1 (bell), 2 (compartments) |
| R21-D | 0 | **≤ 7** | Slips + view + monthly bill 2.2, Rule 42 adjust 1.0, OMC 1.0, LPG 1.4, strings 0.6 | At 7 → cut 1 (LPG), 2 (OMC) |
| **Round** | **0** | **≤ 29 + 1 reserve = 30** (net ≤ +15 with P) | Hindi pack ≤ 7 kB (`lang-hi-fuel`) | Core after P + R20 B–D + R21 ≤ 3,290 kB |

Each package writes before / after numbers (initial, entry, core, Hindi pack, Hindi in core, `f-fuel`, `FuelDesk`) in
its section of `docs/features/fuel-r21.md`.

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Core budget**: R20-A overran by 2.2 kB; R20 B–D may too; R21-P may reclaim less than 15 kB | H | **H** | R21-P first with a measured table; §1.4 `room` formula at A's first commit; D moves to Round 22 below 20 kB; caps with pre-ranked cuts |
| R21-P's Hindi split breaks Help search or offline Hindi | M | M | `help-hi-split` test; `verify:offline` covers online / offline switch; English search unchanged |
| Rule 42 duty exclusion read wrongly (reverses too little ITC) | M | **H** | `verified: false`, switch "Leave duties in", working shown, FU12 ★; default reversible per run |
| Fuel slips into a tax invoice / e-Invoice / e-Way for a GSTIN buyer | M | H | Split on save (Q6); e-Way hook; tests `fu-pos-line`, `fu-eway`; FU3 / FU4 ★ |
| Stock engine and the meter-based register disagree (slips unbilled, tests, receipts mid-shift) | M | M | Register is meter-based by design; monthly loss voucher reconciles; a "register vs stock summary" line on the stock view; FU7 / FU18 |
| Price at the wrong moment (06:00 change, back-dated entries) | M | M | `priceAt` by date + time, snapshot of `price_id` on the line, tests at the boundary |
| `f-fuel` captures nothing because engines import shared lazy code | M | M | Bridges `fu-*-io.ts`; `chunks.json` check per package; import-graph test |
| Overlap with R20-D (`NotificationBell.tsx`, `SetupWizard.tsx`) | M | L | One-line, append-only edits; rebase rule (§6) |
| MDG values are contractual and may have changed (MDG 2024 unread) | H | L | Hint rows dated to the 2022 text; FU15 / FU18; never a block |
| Volume (8 nozzles × 4 shifts × 365 days; 15,000 slips a year) | M | M | One `saveMany` per close / billing run; slips indexed by client and month; volume tests |
| Users expect VAT returns | M | L | Non-goal stated in the card's help and Features row |
| CA-id regex misses `FU1` | L | L | A adds `FU` to both regexes and the explicit test |

---

## 13. Out of scope (with reasons)

- **State VAT returns and VAT liability** (36 laws, first-point taxation in most States; §1.6).
- **ASTM 53B / temperature conversion** (tables too large for the budget; the user types density at 15 °C).
- **Automation integration** (ATG, DU controllers, fleet-card hosts, OMC portals, LPG booking systems) — needs devices
  or servers (AGENTS.md rule 1).
- **Shortage recovery from salary** (FU10) — a payroll bridge; next PENDING sweep if the CA answers.
- **Cross-cutting 2026 parity items** found in §2.1 and scored in §2.2 (e-Invoice reconciliation against the GSTR-1
  auto-drafted file, TDS challan CSI import, self-billed credit / debit notes, approval for manual journals): each is
  S–M and is listed for the next `docs/PENDING.md` sweep, not this round.
- **Server features of the leaders** (PrimeBanking payments, cloud backup to a vendor drive, terminal / dynamic-QR
  payments, AI bill scanning): ⛔ offline; the app's offline alternatives stay (folder sync, auto-backup, UPI QR + UTR
  match, e-Invoice QR capture).
- **Remaining industry candidates** (automobile dealers, coaching / hostels, SaaS) — scores 1.0–1.3 (§2.2); revisit
  after Round 21.
- **Deferred inside fuel:** auto-LPG dispensers beyond a nozzle and a rate hint (FU22), EV charging, convenience-store
  franchise accounting, ATF / bunkering, COCO outlets, consumer-side LPG operations (§1.6).
