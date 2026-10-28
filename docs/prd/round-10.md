# PRD — Round 10: service businesses (clinics and labs, salons and spas, gyms and yoga, coaching, repair and service centres)

Status: draft for build · Drafted 2026-10-27 · Baseline: branch `claude/elegant-cannon-cwapiv` at `677d061`. Merged on
the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–9, Round 7 (hotel), Round 8 (TR-A, TR-B, TR-C). **Round 9** (retail,
`docs/prd/round-9.md`) is being built now; this round reuses two of its pieces (the RT-B1 `doctors` master and the
RT-D4 `service_jobs` job sheets), and §5 / §6 say how the two rounds share files and budgets.

Companion documents:
- `docs/CA_REVIEW.md` §10 — the service CA items **SV1–SV24**, added with this PRD.
- Raw research (URLs and the claim taken from each; P = primary, S = secondary):
  `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/r10/round10-sources.md`.

Every item follows `AGENTS.md`:
- local-first and serverless: no ABDM / NHCX / insurer / TPA / biometric-cloud / SMS-gateway / GST portal calls; files,
  `wa.me` links and the device camera only;
- vanilla CSS Modules with tokens;
- invoice snapshots never change: new line and record fields are snapshots that the templates read from the record;
- Indian-FY numbering for every new series;
- bare dates parsed as local days;
- statutory values date-keyed and append-only, in a rule file kept out of first paint;
- GST, TDS and clinical-establishment outputs labelled as working papers ("verify with your CA").

---

## 1. Problem statement

The `services` business type (8H, `shop-presets.ts`) was built for **professionals**: consultants, agencies, CAs and
freelancers. Its preset is time, retainers, recurring and design, and Round 3 (R3-B) made that deep: rate cards, work
types, projects, retainers, timesheet annexures. Round 5 (R5-C) added a fees pack for schools, coaching and clinic
packages. But the largest service verticals by count are not professionals: they are **front-desk businesses** that
book a customer into a slot, serve them with a named staff member, sell a membership or package, and bill a mix of
service and goods. §2.3 checks **54 rows; 25 exist, with file paths**. Each vertical still has gaps it meets daily:

1. **Clinics, dentists, physiotherapists, nursing homes and diagnostic labs**
   - Health care by a clinical establishment is **exempt**, but cosmetic procedures, non-ICU rooms above ₹5,000 a day
     and OPD pharmacy sales are not. The app has one tax class per **document** (tax invoice or Bill of Supply): a
     mixed bill cannot be made, and a 0% line on a tax invoice is reported as **nil-rated**, not exempt.
   - There is no patient register (UHID, age / sex), OPD token or visit, no in-patient running bill with deposits, no
     test master or lab report, no TPA / insurer split, no rate list (Clinical Establishments Rules, Rule 9).
   - Payments to visiting consultants (194J) can be booked as bills; **referral fees** to doctors cannot be tracked, and
     the law makes them risky (§2.2).
2. **Salons, spas, beauty parlours**
   - From 22 Sep 2025 these services are **5% without ITC** (Notification 15/2025-CT(R), mandatory). The app does not
     know it: no "5% no ITC" class, no ITC caution on purchase bills, no warning that 6% composition now costs more.
   - There is no appointment book, no stylist per line, no **staff commission** per service, no prepaid packages
     ("6 facials for ₹9,000"), memberships, birthday offers or product consumption per service.
3. **Gyms, fitness studios, yoga and dance centres**
   - Same 5% no-ITC rate. No membership with start / end / **freeze**, transfer or upgrade, no check-in / attendance,
     no class timetable with capacity, no trainer commission on personal-training (PT) sessions, no renewal list.
4. **Coaching, tuition and training institutes**
   - The R5-C fees pack already bills instalments with exempt / 18% heads. Missing: **batches with a timetable**,
     attendance, and the Ministry of Education 2024 guideline refund (pro rata for the unused period, within 10 days).
5. **Repair and service centres** (vehicle workshops and garages, AC / appliance service)
   - Round 9 RT-D4 plans job sheets for phones on the electronics desk. Workshops need the same job card with
     **vehicle** fields (registration no., odometer, fuel), an **estimate** the customer approves, parts issued from
     stock plus **labour** at standard rates, **insurance claims** (an invoice to the insurer for the approved amount
     and one to the owner for depreciation / excess, Circular 217/11/2024), and next-service reminders. AC service
     needs site visits tied to the existing AMC contracts.
6. **Setup**
   - "Services" is one business type: a dentist, a salon, a gym, a coaching class and a garage get the professional's
     screens (timesheets, retainers, design studio) and no front desk.

**Goal of Round 10:** ship **17 items in four work packages** with mostly disjoint files:
- **SV-A**: the service profile and the shared front desk — appointments, staff and commission, service tax classes,
  payer split and claims (5 items);
- **SV-B**: clinics, dentists and diagnostic labs (4 items);
- **SV-C**: memberships, packages, classes and attendance — salons, spas, gyms, yoga and coaching (4 items);
- **SV-D**: repair and service centres — vehicle workshops and AC / appliance service (4 items).

Coaching was too thin for its own package (the fees pack covers most of it), so its three gaps sit in SV-C, which
owns classes and attendance anyway. Salons share their engines (appointments, commission, packages) with SV-A and
SV-C, so they need no package of their own.

### How the service profile switches on (no clutter for others)

- The business type stays **`services`** (`shop-mode.ts`, label "Services"), so there is no new `BusinessType` and no
  shell bytes. The setup wizard and Settings → Features gain a **service picker** when `services` is chosen:
  - *Clinic / doctor / dentist / physiotherapy*;
  - *Diagnostic lab / imaging centre*;
  - *Salon / spa / beauty parlour*;
  - *Gym / fitness / yoga / dance studio*;
  - *Coaching / tuition / training institute*;
  - *Vehicle workshop / garage*;
  - *AC / appliance service centre*;
  - *Professional services (CA, consultant, agency, freelancer)* — today's preset, unchanged;
  - *Other services*.

  The choice is stored as the additive settings field `service_kind` (the Round 8 `trade_kind` / Round 9
  `retail_kind` approach). It sets `modules` and an explicit `industry_packs` list (§4 SV-A1).
- **Four new packs** in `industry-packs.ts`: `clinic`, `salon`, `fitness` and `workshop`. Coaching uses the existing
  `fees` pack. A pack adds **tabs on the existing `/time` route** (with `&view=` sub-views, the hotel pattern) plus
  fields in existing dialogs; coaching adds views inside the existing Fees tab on `/recurring`. It never adds a route
  or a sidebar item. Every service profile keeps the `time` module (and the coaching profile keeps `recurring`), so
  **`PACK_ROUTES` (shell) is not changed**.
- `PACK_OF_TYPE` is **not** changed: `services` implies no pack, so every existing services company sees exactly what
  it saw. It gets a one-time setup-checklist step "Pick your kind of service".
- Tools that help every service business (per-line exempt class, the 5% no-ITC caution, the composition warning,
  payer split, birthday list) are **not** pack-gated. They are opt-in settings or appear only when used.

### Budgets the packages must respect

Lead-reported on `677d061` (`npm run build && npm run check:size`):

| Budget | Now | Limit | Headroom | Shared with |
|---|---|---|---|---|
| Initial JS (first paint, gz) | **184.6 kB** | 185 kB | 0.4 kB | Round 9 (≤ +0.1 kB) |
| Entry chunk (gz) | — | 90 kB | — | |
| Total JS (gz) | **≈2682 kB** | 2800 kB | ≈118 kB | Round 9 (≤ +60 kB planned, part already in) |

Rules:
- **First paint: Round 10 = 0 bytes by design.** The only first-paint touch allowed is appending the strings `'sv'` to
  the record-key and line-key lists in `src/store/invoice-defaults.ts` (one record key, one line key; ≤ +0.03 kB gz,
  appended to Round 9's lists if RT-A created them, else to `R8_RECORD_KEYS` / `R8_LINE_KEYS`). Without them, load →
  edit → save would drop the new snapshots. No `PACK_ROUTES`, `TABLE_ACTIONS`, `WATCHED_TABLES`, `no-cash.ts` or shell
  edit. Table rights and audit labels register at runtime (`src/lib/services/sv-registry.ts`, the `tr-registry.ts` /
  `hotel-registry.ts` pattern).
- **Total JS for the round ≤ +45 kB gz**: SV-A ≤ 14 kB, SV-B ≤ 12 kB, SV-C ≤ 10 kB, SV-D ≤ 9 kB (SV-D reuses RT-D4's job
  engine and the existing AMC, quotation and stock code). With Round 9's +60 kB the total lands near 2,787 kB if Round 9
  uses its full share from today's figure, under the 2,800 kB limit.
- **Everything is lazy.** No new route. Each pack tab is one lazy chunk (all its views, its engine and its en + hi
  strings), mounted by `Time.tsx` from a lazy import. Editor, POS and bill-modal parts are lazy sub-rows, mounted only
  when their pack or setting is on.
- **Rule data is a chunk.** `src/lib/service-rules.ts` is imported only by lazy screens and engines, never by
  `tax-rules.ts`, `shop-mode.ts` or the shell. `tests/sv-rules.test.ts` checks the import graph.
- **Help text is data.** Topics go in the existing lazy topic files (`topics-packs.ts`, `topics-sales.ts`,
  `topics-statutory.ts`); glossary terms go in `glossary.ts`.
- **Icons: reuse only.** Already imported somewhere (grep before use; a new icon name fails review):
  - SV-A `CalendarClock`, `CalendarDays`, `Users`, `Percent`, `ShieldCheck`, `Receipt`;
  - SV-B `FlaskConical`, `ClipboardList`, `Users`, `BookOpen`;
  - SV-C `Repeat`, `QrCode`, `Snowflake` (freeze), `Timer`, `BookOpen`;
  - SV-D `Car`, `Truck`, `ClipboardList`, `Settings` (as the spanner stand-in), `RefreshCw`.
- **If the round needs more than 45 kB:** each package builds inside its share first and reports its overrun with a
  breakdown in its feature-doc section, as R7-A, R8 and R9 do. The lead may raise `BUDGET_TOTAL_GZ_KB` from 2800 to 2900
  in one commit, recording the reason in `scripts/check-bundle-size.mjs`. The justification prepared here:
  - total JS is the one-time offline precache, not first paint (which stays at its 185 kB limit);
  - Rounds 7–10 add four verticals' packs (hotel, trading, retail, services) that each download only into the
    precache and run only for companies with that pack on;
  - Round 9 + Round 10 together (≤ 105 kB) would otherwise leave no room for a QA round.

  The default is **not** to raise it before both rounds have measured.
- Each package records before / after numbers in its section of `docs/features/services-r10.md`.

### Non-goals

These need a server, the network, a regulator system, a licence the app cannot hold, or are clinical (not billing):
- **EMR / clinical records**: diagnosis, prescriptions written by the doctor, case sheets, dental charting, ABDM / ABHA
  linking, e-prescription. The app keeps billing-side patient data only (name, UHID, age, sex, contact, referrer) plus
  an optional free-text visit note that is never printed.
- NHCX / TPA portal claim submission, insurer surveyor portals, PCPNDT Form F registers, biomedical-waste returns.
- Lab analyser interfacing (LIS / HL7 / ASTM). Results are typed or pasted from CSV.
- Biometric / RFID turnstile integration. Check-in is by member code, phone, a printed QR read by the camera, or a click.
- Online booking pages, SMS gateways, payment links to a gateway. Reminders are `wa.me` links.
- Live class streaming, test series / question banks (Classplus-style content apps).
- Vehicle telematics, OEM DMS (dealer management) integrations, parts catalogues (EPC).

---

## 2. Findings

### 2.1 What service businesses use and praise / complain about (research)

P = vendor's own documentation or official text; S = secondary (reseller, review site, blog). Full list in
`round10-sources.md`. Review samples are small for Indian clinic and gym tools; vendor claims are marked as such.

| Vertical | Tools they use | Praised for | Complaints / gaps | Source |
|---|---|---|---|---|
| Clinics / dentists | Practo Ray, Eka Care, Docon, HealthPlix, Vyapar / myBillBook for the bill | Ray: patient history, prescriptions, simple accounting, appointment SMS | Ray: few, dated reviews (Capterra India 4.0 from 8); cloud-only; clinics bill pharmacy and consultation in separate tools; no GST nuance (exempt vs taxable lines) in billing apps | S Capterra India |
| Diagnostic labs | CrelioHealth / LIS vendors, small labs on Excel + billing apps | Test master, report formats with reference ranges, doctor-wise referral reports | LIS is costly for a one-room lab; referral payouts kept off the books | S vendor pages (not cited individually) |
| Salons / spas | Zenoti, Salonist, Fresha, MioSalon, Invoay | Zenoti: loyalty, SMS / e-mail, marketing in one place; staff commission and packages are standard | Zenoti: expensive, slow loading, phone support missing (Capterra 4.4 from ~1,260); Salonist: "does not function properly" (1★), service-list editing cumbersome | S Capterra |
| Gyms / yoga | EasyGym, Dgymbook, VIOFIT, AdviceFit, Gymdesk | Freeze / upgrade / transfer, auto-restricting expired members, WhatsApp renewal reminders, trainer payouts by rule, eSSL / ZKTeco check-in | No independent reviews found; vendor claims only. Biometric devices tie the gym to one vendor | S vendor pages |
| Coaching | Teachmint, Classplus, Excel + Vyapar | Batches, attendance, fee collection in one app | Instalment support unclear; occasional bugs (Capterra 4.8 from 74); content-app focus | S Capterra, GetApp |
| Workshops / garages | AllWheels, RAMP, Autorox, GarageXpert-style tools; Tally / Busy for books | Digital job card, vehicle history, estimates and approvals, cashless / reimbursement insurance with surveyor and split invoicing | Few reviews; tools are cloud and per-seat; books still re-keyed into Tally | S GetApp, SourceForge (vendor claims) |

**What carries over to an offline app:**
- **Front desk** (every vertical): an appointment book over staff and rooms / chairs / bays, `wa.me` reminders, convert
  to bill; staff on each line and commission from our own bills.
- **Clinics / labs**: patients as clients with additive fields (the R5-C student pattern); per-line tax classes; an
  in-patient running bill on existing advances; a test master and typed results printed with reference ranges.
- **Salons / gyms / coaching**: memberships and packages as our own records over ordinary invoices; check-in and
  attendance kept per day; refunds as credit notes.
- **Workshops**: RT-D4's job sheet with vehicle fields; estimates as the existing Quotation document; parts from stock;
  two invoices for an insurance claim; reminders from the job's next-service date / km.

Offline work, the recycle bin, full audit and real books (GSTR, Tally export) are our edge over the cloud tools.

### 2.2 Statutory rules by vertical (as understood; every row is a CA item)

Confidence: **H** = statute / official text read or long settled; **M** = consistent secondary sources; **L** = sources
conflict or nothing found.

| Rule | What applies | App today | Source | Confidence |
|---|---|---|---|---|
| Health care exemption | N 12/2017-CT(R) entry 74: health care services by a **clinical establishment**, an authorised medical practitioner or para-medics are exempt (also ambulance transport). Para 2(s): clinical establishment covers hospitals, nursing homes, clinics, diagnostic / pathology labs. Para 2(zg): "health care services" **exclude hair transplant and cosmetic or plastic surgery**, except to restore anatomy / functions affected by congenital defects, developmental abnormalities, injury or trauma | R5-C fee-head preset "clinic exempt"; per-document Bill of Supply | S AAR Kerala (dermatology) quoting the notification; taxguru | H (text quoted in rulings) → SV1, SV2 |
| Hospital rooms | From 18 Jul 2022: room (other than ICU / CCU / ICCU / NICU) charge **above ₹5,000 per day per patient** → 5% without ITC (N 03/2022-CT(R) entry 31A, SAC 9993; N 04/2022 amending entry 74). Up to ₹5,000: exempt | **Missing** | S Grant Thornton, taxguru, joinditto | M–H → SV3 |
| In-patient medicines, food | Medicines, consumables, implants and food given to **in-patients** are part of the composite health care supply (exempt). OPD / walk-in pharmacy sales are goods at their own rate (Circular 32/06/2018-GST as recalled) | **Missing** (no in-patient bill) | Circular 32/06/2018 (recalled, not re-read) | M → SV4 |
| Mixed bill to an unregistered patient | Rule 46A CGST Rules: a registered person supplying taxable and exempt goods / services to an **unregistered** person may issue one "invoice-cum-bill of supply". GSTR-1 Table 8 has separate nil / exempt / non-GST columns | One class per document; a 0% line on a tax invoice → Table 8 **nil** column (`gst-reports.ts` `isNilLine`) | Rule 46A; GSTR-1 Table 8 | H → SV5 |
| Registration of exempt-only suppliers | Sec 23(1)(a): a person supplying only exempt services need not register. Aggregate turnover includes exempt supplies once taxable supplies exist (a clinic with a taxable pharmacy or cosmetic line) | Not modelled | Sec 22 / 23 CGST Act | H → SV6 |
| Clinical Establishments Rules 2012, Rule 9 | Display **rates charged for each service** at a conspicuous place, in the local language and English (9(i)); charge within a government range (9(ii), not yet notified in most states, under Supreme Court litigation, not stayed). Registration under the CEA / state acts where adopted; registration no. commonly printed on bills | **Missing** | S livelaw, SC order 3 Nov 2022, Lok Sabha answers | M → SV7 |
| Doctor's registration on receipts | NMC RMP (Professional Conduct) Regulations 2023 Reg 3(A) (held in abeyance, as recalled) / 2002 Code 1.4.2: the doctor's registration number on prescriptions, certificates **and money receipts** | `SenderProfile` has no registration field for doctors (RT-B1 `doctors.reg_no` is planned for prescribers) | S mondaq, elplaw, NMC PDF | M → SV7 |
| Referral fees / freebies to doctors | IMC Regulations 2002 (6.4 bars fee-splitting; 6.8 gifts). Expenditure "prohibited by law" is disallowed u/s 37(1) Explanation 1 (Apex Laboratories v DCIT, SC, 22 Feb 2022; CBDT Circular 5/2012). Benefits to a doctor may also need 194R TDS | **Missing**: no referral register; RT9 (Round 9) chose to book nothing | S taxmann, casemine, itatonline | M–H → SV8 |
| TDS on doctors' fees | 194J professional 10% (₹30,000 / FY, ₹50,000 from 1 Apr 2025); 2025 Act label Sec 393(1) Table Sl. No. 6(iii) from 1 Apr 2026. Retainer doctors on the payroll → Sec 192 / 392 | Exists (`tds-rules.ts`, `ita2025.ts`, purchase bills) | Code + statute | H → SV8 |
| Salons, spas, gyms, yoga | From 22 Sep 2025 (N 15/2025-CT(R), heading 9997 item (i)): hairdressing, barbers, cosmetic treatment, manicure, pedicure, health clubs, fitness centres, salons, spas, yoga → **5% (2.5 + 2.5) without ITC**, mandatory (CBIC FAQ: no option of 18% with ITC). Before: 18% with ITC. Residual 9997 stays 18%. Yoga by a 12AB-registered trust: exempt (entry 1, charitable activities) | **Missing** (rates are typed; no "without ITC" class) | S businesstoday (CBIC FAQ), gstgyaan, a2ztaxcorp, cleartax | M–H → SV11, SV12 |
| ITC for 5%-no-ITC suppliers | No ITC on goods / services **used in supplying** that service. ITC on goods **bought for resale** (retail products) stays; common inputs split by Rule 42 | Rule 42 / 43 engine exists (R5-C2, pack-gated to fees / nonprofit / leases / hotel) | Rule 42; developers' reading | M → SV12 |
| Composition for services | Sec 10(2A) / N 2/2019-CT(R): 6% (3 + 3) for prev-FY turnover ≤ ₹50 lakh; no inter-State outward supplies, no supplies through a TCS e-commerce operator. For a salon or gym, 6% composition is now **above** the 5% regular rate | 6% rate and ₹50 lakh limit exist (`tax-rules.ts` `COMPOSITION_RATE_RULES`); no comparison warning | S gstzen, taxguru | H → SV13 |
| Memberships and prepaid packages | Time of supply for services: earlier of invoice / receipt (Sec 13); an annual fee paid up front is taxed when invoiced / received. Advances for services are taxed on receipt (G3). Forfeited unused sessions: no further supply (value already taxed) | Advances exist (`advances.ts`, G3 / G4); no membership / package record | Sec 13 CGST Act | M → SV14, SV15 |
| Staff commission and tips | Commission to salaried staff is salary (Sec 192 / 392 TDS through payroll). Commission to a non-employee stylist / trainer / doctor: 194H (commission), 194J (professional) or 194C (contract) by facts. Voluntary tips passed in full to staff: arguably not consideration for our supply | Payroll adjustments exist; sales-agent commission per **invoice** exists (`sales-commission.ts`); nothing per line / per staff | Developers' reading | L–M → SV16 |
| Coaching | Coaching / private tuition 18% (SAC 999293), unchanged on 22 Sep 2025; entry 66 exempts education by an **educational institution** (school curriculum, recognised qualification, approved vocational courses) | Exists (R5-C fee-head preset "coaching 18%") | S dmifinance, bajaj, AAR via seair | H → SV17 |
| Coaching centre guidelines 2024 (MoE) | No enrolment under 16; fees "fair and reasonable", **receipts** issued, **no increase during the course**; a student who paid in full and leaves midway is refunded the **unused period pro rata within 10 days** (hostel and mess too). State registration; each branch separately | **Missing** | S vajiramandravi, careers360 (guidelines as reported) | M → SV18 |
| Motor vehicle repair | Servicing with parts: a **composite supply** of repair service (18%, SAC 9987) when one price is charged; when parts and labour are priced and invoiced separately, rulings treat them as separate supplies at their own rates (AAR WB Alok Bhanuka 2018; AAR UP Premier Car Sales 2019) | Lines carry their own rates already | S AAR copies (gstcouncil.gov.in), getswipe | M → SV20 |
| Auto parts after 22 Sep 2025 | Parts (8708) 28% → **18%** (tractor parts 5%); tyres 18%; batteries (8507) 18% | HSN master with dated rates (typed by the user) | S lakshmisri, tallysolutions | M → SV21 |
| Motor insurance claims | Circular 217/11/2024-GST (26 Jun 2024): in cashless and reimbursement claims the garage's invoice is generally in the **insurer's name**; the insurer takes ITC on it. When the garage issues two invoices — the approved amount to the insurer and the excess (depreciation, deductible, non-covered) to the insured — the insurer's ITC is on its own invoice | **Missing** | P CBIC circular (gstcouncil.gov.in copy) | H → SV22 |
| AMC / extended warranty | AMC is a supply of service, time of supply by invoice / receipt; a comprehensive AMC with parts is a composite service (as understood). Free warranty parts: see RT13 | AMC contracts exist (`amc.ts`), billed as ordinary invoices | Developers' reading | M → SV23 |
| SAC codes for repair | 998714 = repair of **transport machinery and equipment**; 998715 household appliances; 998713 computers; 998716 telecom equipment (recalled); 998729 other goods | — (Round 9 RT-D4 planned 998714 for phones: probably 998716 / 998713 — flagged to the lead) | S busy.in SAC pages | M → SV20 |
| Sublet / outside work | Work sent out (denting, machining) and re-billed: part of the value of our supply (not pure-agent); 194C on the payment when above the threshold | Pure-agent lines exist (time billing); 194C exists | Rule 33 CGST Rules; Sec 194C | M → SV24 |

### 2.3 Verified against the code (`677d061`)

Verdicts: **Exists** (done, file given), **Partial** (part done, gap named), **Missing**. Each row was checked by grep or
by reading the file; "→" names the Round 10 item that closes it. "R9 planned" = in `docs/prd/round-9.md`, not on the
baseline.

#### Every service business

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| `services` business type, preset, demo data | Exists | `shop-presets.ts` (`PRESETS.services`, `BUSINESS_DEFAULTS`), `demo/profile-services.ts` | Sub-profiles → SV-A1 |
| Sub-profile pattern (`trade_kind`), runtime registry | Exists | `shop-presets.ts` `applyTradeKind`; `trade/tr-registry.ts`, `hotel/hotel-registry.ts` | Reused by SV-A1 |
| Work types with SAC, rate cards, projects, retainers, annexure | Exists | `rate-cards.ts`, `projects.ts`, `retainers.ts`, `annexure.ts` (R3-B) | — |
| Recurring invoices, batch runs | Exists | `recurring.ts`, `batch-invoices.ts` | Membership auto-renew uses it → SV-C1 |
| Advance receipts (Rule 50), refund vouchers | Exists | `advances.ts` | Prepaid wallet / deposits use it → SV-B2, SV-C1 |
| Quotation / proforma → invoice conversion | Exists | `types/invoice.ts` `QUOTATION`, `PROFORMA` | Workshop estimates use it → SV-D2 |
| Loyalty points, tiers; gift vouchers | Exists | `loyalty.ts`, `retail/loyalty-tiers.ts`, `retail/gift-vouchers.ts` | — |
| `wa.me` share and reminders | Exists | `share-reminders` (docs/features), `pos-share.ts` | Appointment / renewal texts → SV-A2, SV-C1 |
| Appointment book / calendar over staff and resources | **Missing** | hotel reservations calendar is room-only (`hotel/*`) | SV-A2 |
| Staff (service providers) master, staff per line | **Missing** | payroll `employees` are confidential (owner-only screen); `TimeEntry` assignee is a local user | SV-A3 |
| Commission per staff per service / product | **Partial** | `sales-commission.ts`: one agent per **invoice**, % of taxable, payable journal, opt-in 194H | Per line, per staff, slab targets, payout to payroll → SV-A3 |
| Payroll adjustments (incentive earning) | Exists | `types/payroll.ts` `PayrollAdjustment` | Commission payout target → SV-A3 |
| Per-line exempt / nil / non-GST class on a tax invoice | **Missing** | `gst-reports.ts` `isNilLine` → nil column; `exempt_kind` per **record** (Bill of Supply only) | SV-A4 |
| Invoice-cum-bill of supply (Rule 46A) | **Missing** | only composition BOS in `bill-of-supply.ts`; CA item I21 | SV-A4 |
| 5% without-ITC service class, ITC caution on bills | **Partial** | pattern exists for GTA (`bill-guard.ts` `warnGta`) and hotels (`hotel/hotel-gst.ts`) | SV-A4 |
| Composition 6% for services, ₹50 lakh limit | Exists | `tax-rules.ts` `COMPOSITION_RATE_RULES`, `COMPOSITION_LIMIT_RULES`; R8 `CompositionTracker.tsx` | "6% > 5%" warning → SV-A4 |
| Rule 42 / 43 common credit | Exists (pack-gated) | `institutions/common-credit.ts`, `gst-tabs.ts` `PACK_GST_TABS` | Open it for clinic / salon / fitness → SV-A4 |
| Bill to a payer (insurer / TPA) with the patient / owner as beneficiary; claim tracker | **Missing** | — | SV-A5 |
| Customer birthday / anniversary | **Missing** | `dob` only in payroll / hotel guests | SV-A2 (birthday list) |

#### Clinics, dentists and labs

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Fee-head presets: clinic exempt, packages with sessions, visit consumption | Exists (fees pack) | `institutions/fee-plans.ts`, `enrolments.ts` (students / **patients** as clients with `roll_no` = UHID) | Clinic use without the fees pack → SV-B1 |
| Patient register (UHID, age, sex, guardian, referrer) | **Partial** | `Client.roll_no` / `guardian` (R5-C, fees pack only) | SV-B1 |
| OPD visit / token, consultation bill with doctor and registration no. | **Missing** | — | SV-B1 |
| Doctors master | R9 planned | RT-B1 `doctors` (pharmacy pack) | Reused, additive fields → SV-B1 |
| In-patient running bill, deposits, interim / final bill, room-rent test | **Missing** | hotel folio is hotel-only (`hotel/folio*.ts`) | SV-B2 |
| TPA / cashless split | **Missing** | — | SV-A5 + SV-B2 |
| Rate list (CEA Rule 9) | **Missing** | price lists exist (`price-list.ts`) but no printable display list | SV-B1 |
| Test master, lab order, sample status, results with reference ranges, report print | **Missing** | — | SV-B3 |
| Referring doctor per bill, referral statement / payout | **Missing** | RT9 chose "book nothing" for chemists | SV-B4 |
| Visiting consultant payout with 194J | **Partial** | vendor bills with `tds_section` `194J` (`tds-payables.ts`) | Fee-share statement → bill → SV-B4 |
| Pharmacy sales, H1 register, expiry | Exists / R9 planned | `pharma.ts` (7U), RT-B | Clinic profile toggle "with pharmacy" → SV-A1 |
| Common credit for clinics with taxable lines | Exists (gated) | `common-credit.ts` | Gate opened → SV-A4 |

#### Salons, spas, gyms, yoga

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| POS counter, split tenders, loyalty, gift vouchers | Exists | `pos.ts`, `loyalty.ts`, `retail/gift-vouchers.ts` | Staff per line at POS → SV-A3 |
| Product consumption per service (back-bar) | **Partial** | kits: a non-stocked item whose BOM leaves stock on the sale (`events-kits.ts`, `StockItem.kit`) | "Service recipe" wording, ml / g units, salon preset → SV-C4 |
| Prepaid packages (n sessions) and wallets | **Partial** | fees-pack session packages (`fee-plans.ts`); advances as wallets (`advances.ts`) | Package sale, redemption at POS / editor, expiry → SV-C1 |
| Memberships (start / end / freeze / transfer / upgrade), renewals | **Missing** | — | SV-C1 |
| Check-in / attendance of members | **Missing** | payroll attendance is for employees (`payroll/records.ts`) | SV-C2 |
| Class timetable with capacity, PT sessions | **Missing** | — | SV-C3 |
| Trainer / stylist commission | **Partial** | see "Commission" above | SV-A3 |
| Staff attendance and salary | Exists | `payroll/*` | — |

#### Coaching

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Fee plans, instalments, concessions, fines, dues, reminders | Exists | `institutions/fee-plans.ts`, `fee-billing.ts`, `fee-dues.ts` | — |
| Exempt vs 18% heads, two documents for a mixed fee | Exists | `fee-billing.ts` (I20, I21) | Rule 46A option → SV-A4 |
| Batches with timetable and teacher | **Partial** | `Client.class_label` text only | SV-C3 |
| Student attendance | **Missing** | — | SV-C2 |
| Pro-rata refund on leaving (MoE 2024) | **Missing** | credit notes exist | SV-C3 |

#### Repair and service centres

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Job sheets with status flow, warranty check, claims to the brand, bill job | R9 planned | RT-D4 `service_jobs`, `rt-service-jobs.ts` (electronics pack) | Reused for vehicles / appliances → SV-D1 |
| Vehicle fields (reg. no., VIN, make / model, odometer, fuel), vehicle history | **Missing** | — | SV-D1 |
| Estimate → customer approval → supplementary estimate | **Partial** | Quotation document and conversion exist | Job link, approval log → SV-D2 |
| Parts issue from stock to a job, labour operations at standard rates | **Missing** | stock out only on sale | SV-D2 |
| Insurance claims (surveyor, approved amount, depreciation, two invoices) | **Missing** | — | SV-A5 + SV-D3 |
| AMC contracts, visit schedule, renewals | Exists | `amc.ts`, `AmcPanel.tsx` (dashboard tile `amcDue`) | Visit → job card link → SV-D4 |
| Serial / warranty lookup | Exists | `stock-tracking.ts` `warrantyUntil`, `SerialLookup.tsx` | — |
| Next-service reminders (date / km) | **Missing** | — | SV-D4 |
| 194C on sub-contractors (sublet work) | Exists | `tds-rules.ts` 194C | — |

**Totals:** 54 rows checked: **25 exist** (9 with a small gap named), **11 partial**, **16 missing**, **2 R9 planned**
(reused, not rebuilt). Round 10 closes all 27 partial / missing rows and the 9 named gaps.

---

## 3. Ranked list: what to build now

Value 1–5 (5 = every business of that kind meets it daily). Effort S = 1, M = 2, L = 3. Score = value ÷ effort.

| Rank | Id | Gap | Who needs it | Value | Effort | Score | Package |
|---|---|---|---|---|---|---|---|
| 1 | SV-A1 | Service profile (picker, packs, checklist, help, Ctrl+K, sample data) | every service business | 5 | S | 5.0 | A |
| 2 | SV-A4 | Service tax classes: per-line exempt, Rule 46A bill, 5% no-ITC class and ITC caution, composition warning, common credit opened | clinics, salons, gyms, coaching | 5 | S | 5.0 | A |
| 3 | SV-A2 | Appointment book (staff × time, rooms / chairs / bays), reminders, walk-in queue, birthday list | clinics, salons, workshops, PT | 5 | M | 2.5 | A |
| 4 | SV-A3 | Staff, staff per line, commission plans, payout | salons, gyms, clinics (doctor share) | 5 | M | 2.5 | A |
| 5 | SV-C1 | Memberships and packages (freeze, transfer, upgrade, renew, redeem, expire) | gyms, salons, physio | 5 | M | 2.5 | C |
| 6 | SV-B1 | Patients, OPD visit and token, consultation bill, rate list | clinics, dentists | 5 | M | 2.5 | B |
| 7 | SV-D1 | Vehicle / appliance job card on RT-D4 | workshops, AC service | 5 | M | 2.5 | D |
| 8 | SV-D2 | Estimates, approvals, parts issue and labour operations | workshops | 5 | M | 2.5 | D |
| 9 | SV-C2 | Check-in and attendance (members, batches) | gyms, yoga, coaching | 4 | S | 4.0 | C |
| 10 | SV-B3 | Lab test master, orders, results and reports | diagnostic labs, clinics with a lab | 4 | M | 2.0 | B |
| 11 | SV-A5 | Payer split and claims tracker (insurer / TPA / corporate) | workshops, hospitals | 4 | M | 2.0 | A |
| 12 | SV-D3 | Motor insurance claim flow | workshops | 4 | M | 2.0 | D |
| 13 | SV-B2 | In-patient running bill (deposits, room-rent test, interim / final) | nursing homes, day-care | 4 | M | 2.0 | B |
| 14 | SV-C3 | Classes and batches (timetable, capacity, PT sessions), coaching refunds | yoga, gyms, coaching | 4 | M | 2.0 | C |
| 15 | SV-D4 | Service reminders and AMC visits as jobs | workshops, AC service | 3 | S | 3.0 | D |
| 16 | SV-C4 | Service recipes (back-bar consumption) | salons, spas | 3 | S | 3.0 | C |
| 17 | SV-B4 | Referring doctors and visiting consultants (statement, payout, 194J, Sec 37 caution) | labs, clinics | 3 | S | 3.0 | B |
| — | — | EMR / prescriptions / dental charting | clinics | 4 | L | 1.3 | no (clinical, not billing) |
| — | — | Online booking page, payment links | salons, clinics | 4 | L | 1.3 | no (network) |
| — | — | Biometric turnstile integration | gyms | 3 | L | 1.0 | no (device vendor) |

All 17 are taken. SV-B4 scores lowest but is cheap and closes a real risk: labs pay referral fees off the books today,
and the app should record them with the disallowance caution rather than ignore them.

---

## 4. Specifications (17 items)

Conventions for every item:
- **Logic and tests.** Pure logic in `src/lib/services/sv-*.ts` (new folder), tested with `node:test` in
  `tests/sv-*.test.ts`. UI checks are `step(...)` blocks in `tests/e2e/smoke.mjs` (§7).
- **Components** in the new folder `src/components/services-r10/`. One desk component per pack tab
  (`FrontDesk.tsx` for appointments and commission, `ClinicDesk.tsx`, `MembersDesk.tsx`, `WorkshopDesk.tsx`) holds its
  views and is that tab's single lazy chunk.
- **Strings.** Each package has its own i18n area (`defineArea(en, hi)`): `src/i18n/areas/services-r10a.ts` …
  `services-r10d.ts`. Hindi uses the trade's own words (अपॉइंटमेंट, मरीज़, ओपीडी, भर्ती, जाँच, रिपोर्ट, सदस्यता,
  पैकेज, फ्रीज़, हाज़िरी, बैच, कमीशन, जॉब कार्ड, अनुमान / एस्टिमेट, बीमा क्लेम, सर्विस रिमाइंडर).
- **Storage.** New company tables `mrchartist_inv_<table>` go through `getTable` / `setTable`. Each is registered in:
  - `backup.ts` (`RECORD_TABLES` / `ID_TABLES`);
  - the open-export schema;
  - `sync-engine.ts` `DATED` / `NUMBERED`, when dated or numbered;
  - **`src/lib/services/sv-registry.ts`** (`SV_TABLE_ACTIONS`, `SV_WATCHED`), registered at runtime, never in first-paint
    `access.ts` / `audit-edits.ts`. Every writer module and the two all-table lazy writers (`sync-engine.ts`,
    `trust/recycle-bin.ts`) import it for its side effect.

  Each table gets one row in `docs/ARCHITECTURE.md` (lead). Additive record fields come by declaration merging in
  `src/types/services-r10.ts`: one file, one `declare module` block per package.
- **Invoice snapshots.** Everything Round 10 stores on an invoice lives under **one record key `sv`** and **one line
  key `sv`** (objects; each package owns its sub-fields, §6). Templates read them from the record only.
- **Numbers.** New series go through `series-counters.ts` (`nextSeriesNumberFor` + `recordSeries`) as
  `XXX/FY<yy-yy>/<seq>`, never reused after a delete: `OPD` (visits), `IPD` (admissions), `LAB` (lab orders), `MEM`
  (memberships and packages), `CLM` (payer claims). Job cards use RT-D4's `SVC`. None of the five is in use today.
  Daily **tokens** (OPD, walk-in queue) are a per-day counter on the row, not a series.
- **Guards.** Destructive calls use `requireAccess`. Writes in a locked period use `assertUnlocked`. Money goes through
  `round2`. Every delete goes through `setTable` on a watched table, so the recycle bin gets the row.
- **Packs.** A pack tab is listed only with its pack on (`visiblePackTabs`, since the appointments and commission tabs
  are shared by several packs); its URL still opens it. Its tables are not read while the pack is off
  (`tests/sv-pack-gate.test.ts`, like `tests/r5c-pack-gate.test.ts`).
- **Help.** Every new tab / view gets a topic (`tests/help-registry.test.ts` fails otherwise) and a Ctrl+K title in
  `src/i18n/areas/discover-r6-tabs.ts`. Statutory topics cite the SV ids. The CA-id regexes in
  `tests/help-registry.test.ts`, `tests/help-glossary.test.ts` and `tests/docs-links.test.ts` (the `cited` regex) gain
  `SV` (owner A).
- **Cash readers.** No new receipt marker: deposits, wallets and package pre-payments are ordinary advances
  (`advance_id` is already a `movedNoCash` marker); session redemptions are ₹0 lines; claims are ordinary invoices.
  `tests/no-cash-readers.test.ts` is unchanged.

### SV-A — Service profile and the shared front desk

#### SV-A1 Service profile (service picker)

**User story.** When I choose "Services" in setup, I pick *Salon / spa*. The app lands me on the appointment book,
switches on the salon pack, staff commission and the 5% no-ITC class, and the checklist asks me for my service menu and
my first stylist.

**Acceptance criteria.**
1. `PackId` gains `clinic`, `salon`, `fitness` and `workshop` (appended to `PACK_IDS`). `PACK_OF_TYPE` and `PACK_ROUTES`
   are unchanged.
2. Settings field `service_kind?: 'clinic' | 'lab' | 'salon' | 'fitness' | 'coaching' | 'workshop' | 'appliance' |
   'professional' | 'other'` (additive). `applyServiceKind(kind, { registered, pharmacy })` (`shop-presets.ts`) returns
   modules, packs, defaults and switches (`registered` adds `gst`; `pharmacy` — clinic only — adds `inventory` and the
   Round 9 `pharmacy` pack when it exists):

   | service_kind | modules | industry_packs | landing | due days | template | switches turned on |
   |---|---|---|---|---|---|---|
   | clinic | `time`, `recurring`, `purchases`, `reports`, `accounts`, `banking`, `tds` | `clinic` | `/time?tab=appointments` | 0 | `freelancer_light` | health-care exempt class on service items; Rule 46A for unregistered patients; rate list |
   | lab | as clinic | `clinic` | `/time?tab=clinic&view=lab` | 0 | `freelancer_light` | as clinic; lab view first; referral register |
   | salon | `pos`, `time`, `purchases`, `inventory`, `reports`, `payroll` | `salon` | `/time?tab=appointments` | 0 | `retail_receipt` | 9997 beauty class (5% no ITC) on service items; staff on lines required at POS; ITC caution |
   | fitness | `pos`, `time`, `recurring`, `purchases`, `reports`, `payroll` | `fitness` | `/time?tab=members` | 0 | `retail_receipt` | 9997 fitness class (5% no ITC); membership expiry check at check-in *warn* |
   | coaching | `time`, `recurring`, `purchases`, `reports`, `accounts`, `payroll` | `fees` | `/recurring?tab=fees&view=batches` | 10 | `freelancer_light` | fee preset "coaching 18%"; refund rule |
   | workshop | `time`, `recurring`, `purchases`, `inventory`, `accounts`, `banking`, `reports`, `tds` | `workshop` | `/time?tab=workshop` | 0 | `gst_tax_invoice` | job cards (vehicle), labour SAC 9987 at 18%, insurance claims |
   | appliance | as workshop | `workshop` | `/time?tab=workshop` | 0 | `gst_tax_invoice` | job cards (appliance, site visits), AMC tile |
   | professional | `PRESETS.services` (unchanged) | `[]` | `/invoice` | 15 | `freelancer_light` | — (today's behaviour) |
   | other | `PRESETS.services` + `pos` | `[]` | `/invoice` | 7 | `freelancer_light` | — |

3. Wizard: the `services` card opens a second choice with nine cards (lazy, inside the wizard chunk), plus "Do you sell
   medicines from the clinic?" for clinic. Settings → Features shows "Service profile" with the same nine plus
   "Custom" (packs kept as set). Changing the profile never deletes data; packs turned off only hide tabs.
4. Existing `services` companies (no `service_kind`) are unchanged. The setup checklist (R6-A1) shows a step
   `serviceProfile` "Pick your kind of service" until it is chosen or skipped.
5. Checklist steps per kind (`checklist-steps.ts`, append-only):
   - clinic → `doctorProfile` (registration no. on the sender profile), `serviceMenu`;
   - lab → `labTest`;
   - salon → `serviceMenu`, `staff`;
   - fitness → `memberPlan`, `staff`;
   - coaching → `feePlan` (existing), `batch`;
   - workshop / appliance → `labourOp`, `jobCard`.
6. Tabs (`page-tabs.ts` `TIME_TABS`, appended block `// R10`; `PACK_TABS` rows in block `// R10`):
   - `appointments` (pack `clinic`, `alsoPacks` `salon`, `fitness`, `workshop`) — views `day`, `week`, `queue`,
     `birthdays`;
   - `commission` (pack `salon`, `alsoPacks` `fitness`, `clinic`, `workshop`) — views `staff`, `plans`, `statement`;
   - `clinic` (pack `clinic`) — views `patients`, `opd`, `ipd`, `lab`, `tests`, `referrals`, `rates`;
   - `members` (pack `fitness`, `alsoPacks` `salon`) — views `plans`, `members`, `checkin`, `classes`, `recipes`;
   - `workshop` (pack `workshop`) — views `jobs`, `estimates`, `claims`, `reminders`, `labour`, `vehicles`;
   - Fees tab (existing, pack `fees`) gains views `batches`, `attendance`, `refunds` (SV-C).

   `Time.tsx` switches from `visibleTabs` to `visiblePackTabs` and mounts each desk lazily. If a desk's package has not
   merged yet, A commits a one-line stub (`R10Stub.tsx`) that the package replaces.
7. Features catalogue (`features-catalog.ts`): four pack rows with `PACK_HREF`.
8. **Sample data** (R6-B4): `src/lib/demo/profile-services.ts` keeps its professional rows and gains one block per
   `service_kind`, only in the Demo company:
   - clinic: two doctors, five patients, OPD visits with tokens, one mixed bill (consultation exempt + cosmetic peel
     18%), an admission with a deposit;
   - lab: a test master of 12 tests, two panels, an order with results, a referral statement;
   - salon: a service menu of 10, three stylists with a commission plan, a day of appointments, a package sale;
   - fitness: three plans, 20 members (one frozen, three expiring), a week of check-ins, a yoga class;
   - coaching: a batch with timetable, attendance, a refund;
   - workshop: three vehicles, a job with an approved estimate, parts and labour, an insurance claim.

   Each package adds its own block (§6).

**Files.** New: `src/lib/services/sv-profile.ts`, `sv-registry.ts`, `src/lib/service-rules.ts` (scaffold with one
section per package), `src/types/services-r10.ts` (scaffold), `src/components/services-r10/ServiceKindPicker.tsx`,
`R10Stub.tsx`. Edit: `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`,
`SetupWizard.tsx`, `FeaturesPanel.tsx`, `page-tabs.ts`, `Time.tsx`, `demo/profile-services.ts`.

**Storage.** Settings fields `service_kind`, `service_settings` (object, `settings.manage`, audited, synced as a
singleton). No table.

**Tests.** `tests/sv-profile.test.ts`:
- each kind's modules / packs / landing / switches;
- `registered` adds `gst`; `pharmacy` adds `inventory` (+ `pharmacy` when the pack id exists);
- every kind keeps `time` (so `PACK_ROUTES` needs no change); coaching keeps `recurring`;
- an existing services company is unchanged; professional = today's preset;
- checklist steps by kind; `TIME_TABS` visibility with `alsoPacks`.

`tests/industry-packs.test.ts` is extended: new ids, no implied pack for `services`, `PACK_ROUTES` unchanged.

#### SV-A2 Appointment book

*Seen in:* Practo Ray, Zenoti, Fresha, Salonist, AllWheels (bay booking).

**User story.** Tuesday 11:00, Priya (stylist) is free for 45 minutes. A regular client calls for a haircut and colour;
I drag across her column, pick the client and two services, and send a WhatsApp confirmation. At 10:50 the day view
shows her as *arrived*; at checkout I press *Bill* and the POS opens with both services and Priya on each line. A
walk-in gets token 7 in the queue.

**Acceptance criteria.**
1. `appointments` (`doc.create`, dated `date`): client (saved or walk-in name + phone), date, start, duration (from the
   services, editable), services (item ids with their duration and price snapshot), staff, resource (room / chair /
   bay, optional), status `booked → confirmed → arrived → in service → done → billed` or `no-show` / `cancelled`
   (with reason), source (`call`, `walk-in`, `whatsapp`, `online-typed`), notes, deposit (`advance_id` of an existing
   advance receipt), linked invoice id, kind tag (`visit` for clinics, `job` for workshops — the job is created on
   arrival by SV-D).
2. **Resources**: `service_settings.resources` (name, kind, active); **hours**: opening hours per weekday, slot step (5 /
   10 / 15 / 30 min), and per-staff weekly off and breaks (`service_staff.hours`, SV-A3).
3. **Day view**: columns per staff (or per resource), rows per slot, drag to create / move / resize, overlap warning
   (never a block; double booking is common), colour by status, today's totals. **Week view** per staff. Keyboard: Alt
   + ← / → day, N new, Enter open. Phone width: a single staff list with a staff switcher.
4. **Queue** (walk-ins): token per day (counter on the appointment, reset daily), waiting / called / served; a large
   "Now serving" line printable or shown on the existing customer display (`pos-display.ts`, one guarded line).
5. **Reminders**: `wa.me` confirmation and reminder texts (en / hi, templates in `service_settings.messages` with
   `{name}`, `{date}`, `{time}`, `{staff}`, `{business}`); a "tomorrow's appointments" list with one-click send each
   (no bulk sending). No-show count per client shown on booking.
6. **Bill**: *Bill* opens the POS (if the `pos` module is on, else the editor) with the services as lines, the staff on
   each line (`line.sv.staff_id`), the client and the deposit offered for adjustment (existing advance adjustment).
   The appointment stores the invoice id and becomes `billed`.
7. **Birthdays**: additive `Client.dob` / `anniversary` (month-day allowed without year); a "this week" list with
   `wa.me` greeting text. Optional, never printed.
8. Bell: "Appointments today: n", "Unbilled done appointments: n" (lazy notifications path).

**Files.** New: `src/lib/services/sv-appointments.ts`, `sv-slots.ts`, `src/components/services-r10/FrontDesk.tsx`
(views `day`, `week`, `queue`, `birthdays`), `AppointmentDialog.tsx`. Edit (shared, one guarded line each): `pos-display.ts`,
`pages/Pos.tsx` (open-from-appointment prefill), the client form (`dob`, `anniversary` fields, lazy sub-row).

**Storage.** `appointments` (`doc.create`, watched "Appointment", dated `date`); `service_settings.resources`,
`.hours`, `.messages`; `Client.dob`, `Client.anniversary`.

**Tests.** `tests/sv-appointments.test.ts`: slot generation over hours, breaks and weekly offs; overlap detection;
status flow; daily token reset; bill prefill (lines, staff, deposit); no-show count; reminder text; birthday window
across a year end; pack-off gate.

#### SV-A3 Staff, staff per line and commission

*Seen in:* Zenoti / Salonist commission reports, gym trainer payouts, clinic doctor fee-share.

**User story.** Priya earns 10% on haircuts, 15% on colour, 5% on products, and 2% extra once her month's services pass
₹1,50,000. At month end I open her statement, check it, and push it into payroll as an incentive. A freelance makeup
artist on 40% gets a payout bill instead.

**Acceptance criteria.**
1. `service_staff` (`master.edit`): name, phone, role (`stylist`, `therapist`, `trainer`, `doctor`, `technician`,
   `teacher`, `other`), skills (service item ids / categories), bookable flag, colour, weekly hours, employment
   (`employee` with optional `employee_id` link to payroll, or `freelance` with a vendor id and TDS section), commission
   plan id, active. Doctors may link a RT-B1 `doctors` row (`doctor_id`).
2. **Staff on the line**: `line.sv.staff_id` (and optional `assist_id` with a split %) in the editor (lazy column shown
   when a service pack is on) and at the POS (staff picker on the line; salon profile: required for service lines).
   The paper prints the staff first name after the line only with `service_settings.print_staff` on (default off).
3. `commission_plans` (`master.edit`): rules by item, category or kind (`service` / `product` / `package sale` /
   `membership sale` / `package redemption`), each a % of the **line taxable value** or a fixed ₹ per unit; optional
   monthly slab on a base (service value / all value) that adds a % or replaces the rate above a target; basis
   `invoice` or `receipt` (pro rata, the `sales-commission.ts` rule); credit notes take back; cancelled bills earn
   nothing. Redemption of a prepaid package earns on the **redeemed value** (package price ÷ sessions), the sale earns
   only the `package sale` rule (default 0) — no double commission.
4. **Statement** per staff and month (`commissionFor(staff, month, data)`, pure): lines, base, rate, amount, slab
   uplift, tips (below), total; CSV / print.
5. **Payout** (`staff_payouts`, `books.edit`, dated `date`, one per staff × month, never overlapping):
   - employee → a `PayrollAdjustment` (earning, tag `incentive`, name "Commission <month>", reference the payout id);
     the payroll run picks it up as today. Requires the payroll module; else falls back to the journal below;
   - freelance → a purchase bill from the vendor (expense ledger "Commission to service staff", TDS section from the
     staff row, default `194J` for doctors, `194H` otherwise, opt-in), through the existing bill save (period lock,
     ITC off, TDS register);
   - journal only (no payroll) → Dr "Staff commission" | Cr "Commission payable" with the staff as party.
   Undo removes the adjustment / bill / journal through their own deletes (recycle bin).
6. **Tips**: a tip tender line at the POS (`service_settings.tips: 'off' | 'pass-through'`, default off): recorded as a
   liability "Tips payable to staff" (not revenue, not taxable — SV16), split to the line staff, and paid out with
   the commission payout. The tip is outside the invoice total (a separate receipt row of class tip).

**Files.** New: `src/lib/services/sv-staff.ts`, `sv-commission.ts`, `sv-payouts.ts`; FrontDesk views `staff`, `plans`,
`statement` (tab `commission`). Edit (shared, one guarded lazy mount each): `creator/ItemsTable.tsx` (staff column),
the POS line in `pages/Pos.tsx` (staff picker), the POS tender panel (tip row).

**Storage.** `service_staff` (`master.edit`, watched "Service staff"), `commission_plans` (`master.edit`, watched
"Commission plan"), `staff_payouts` (`books.edit`, watched "Staff payout", dated `date`); line `sv.staff_id`,
`sv.assist_id`, `sv.assist_pct`; receipt row field `tip_staff` (additive on `Payment`, read only by SV code).

**Tests.** `tests/sv-commission.test.ts`: % and fixed rules; nearest rule wins (item > category > kind); slab uplift and
replace; receipt basis pro rata; credit note takes back; redemption earns on redeemed value, sale not twice; assist
split; payout to payroll adjustment / vendor bill with 194J / journal; no overlap; tips liability and payout; pack-off
gate.

#### SV-A4 Service tax classes

*Seen in:* every clinic and salon complaint about "the billing app cannot do exempt + taxable on one bill" (§2.1).

**User story.** A dermatology clinic bills a consultation (exempt) and a chemical peel (cosmetic, 18%) to a walk-in
patient. The app makes one "Invoice-cum-Bill of Supply"; GSTR-1 puts the consultation in Table 8's **exempt** column
and the peel in B2CS. A salon bill shows 5%, and when I save a purchase bill for hair colour used in services the app
reminds me that ITC is not available on it.

**Acceptance criteria.**
1. **Service classes** (`SERVICE_CLASS_RULES` in `service-rules.ts`, date-keyed): `health_exempt` (entry 74, exempt),
   `health_cosmetic` (taxable at the item's rate, default 18%), `hospital_room_low` (exempt) / `hospital_room_high`
   (5% no ITC, SAC 9993, from 2022-07-18), `beauty_9997` and `fitness_9997` (18% with ITC before 2025-09-22; 5% no ITC
   from), `education_exempt` (entry 66), `coaching` (18%), `repair_9987` (18%), `charitable_yoga` (exempt, 12AB).
   A stock / service item carries `sv_class` (additive); the class suggests the rate and SAC on new lines dated on or
   after its row and never overrides a typed rate (warning in the exceptions report when they differ).
2. **Per-line exempt kind**: `line.sv.exempt: 'EXEMPT' | 'NIL' | 'NON_GST'` on a tax invoice (set from the class, or by
   hand in the line's tax cell when the rate is 0). `gst-reports.ts` reads it in the nil table (one guarded branch:
   `line.sv?.exempt ?? (bos ? record kind : 'NIL')`), so an exempt line goes to the exempt column of Table 8 and to
   3B 3.1(c) (non-GST to 3.1(e)). Existing 0% lines without it stay nil-rated (unchanged).
3. **Rule 46A**: when a tax invoice to a recipient **without a GSTIN** has both taxable and exempt / nil lines and
   `service_settings.rule46a` is on (clinic / lab / coaching profile default: on), the paper title reads "Invoice-cum-Bill
   of Supply" (one guarded branch in the template title helper) and the number stays in the invoice series. For a
   registered recipient the editor offers "Split into a tax invoice and a Bill of Supply" (the fee-billing approach)
   and never prints the combined title.
4. **5% no-ITC caution**: with a `beauty_9997` / `fitness_9997` / `hospital_room_high` class sold in the period, saving a
   purchase bill with ITC claimed shows a caution (the `bill-guard.ts` GTA pattern, one lazy check): "Your services are
   taxed at 5% without ITC. ITC is not available on inputs used for them; ITC on goods you resell is (Rule 42 split).
   Verify with your CA." A bill-level tag `itc_use` (R5-C2) is offered: `exempt_only` (inputs for no-ITC services) /
   `taxable_only` (goods for resale) / `common`.
5. **Common credit** opens for the new packs: `PACK_GST_TABS['common-credit']` and the `PACK_TABS` row gain `clinic`,
   `salon`, `fitness` in `alsoPacks`. The Rule 42 engine treats the 5%-no-ITC turnover as **exempt-like** turnover for
   the reversal (a CA item, SV12; switchable in `service_settings.no_itc_as_exempt`, default on).
6. **Composition warning**: a composition profile of kind `service` whose items are mostly `beauty_9997` /
   `fitness_9997` gets a one-time notice on the Compliance view: "6% composition is above the 5% regular rate for your
   services from 22 Sep 2025" (SV13). Never changes anything by itself.
7. Exceptions report (`gst-guards.ts`, one lazy check): a `health_exempt` line on a bill with a GSTIN-less sender
   flagged nothing; a `beauty_9997` line at 18% after 2025-09-22 → "rate looks old"; an exempt line on a tax invoice
   without `sv.exempt` → "reported as nil".

**Files.** New: `src/lib/services/sv-tax.ts`; rule section `// SV-A` in `service-rules.ts`. Edit (shared): `gst-reports.ts`
(one branch), `bill-guard.ts` (one lazy check), `gst-guards.ts` (one lazy check), `gst-tabs.ts` + `industry-packs.ts`
(`alsoPacks`), the template title helper (`paper-helpers.ts`, one branch), item form (`sv_class` select, lazy sub-row).

**Storage.** Item `sv_class`; line `sv.exempt`; `service_settings.rule46a`, `.no_itc_as_exempt`.

**Tests.** `tests/sv-tax.test.ts`: class → rate on dates either side of 2022-07-18 and 2025-09-22; exempt line in the
exempt column, nil unchanged without the key, non-GST to 3.1(e); Rule 46A title only for a GSTIN-less recipient with a
mix; caution on a bill; common-credit exempt-like turnover; composition notice; snapshot (catalogue edit never changes
an issued line).

#### SV-A5 Payer split and claims

*Seen in:* AllWheels cashless / reimbursement claims; hospital TPA desks.

**User story.** A car comes in after an accident; the insurer approves ₹42,000 of a ₹50,000 job. I bill ₹42,000 to the
insurer and ₹8,000 (depreciation and excess) to the owner; the claim desk shows the insurer's ₹42,000 outstanding until
it pays, and a short payment of ₹600 is written off with a reason.

**Acceptance criteria.**
1. `payer_claims` (`doc.create`, dated `date`, numbered `CLM`): kind (`motor`, `health_tpa`, `corporate`, `other`),
   payer (a client: insurer / TPA / employer), beneficiary (client: owner / patient), policy no., claim no., surveyor /
   TPA reference, source (job id / admission id / appointment), estimate, **approved amount**, lines approved per line
   (optional), status `intimated → survey / pre-auth → approved → billed → paid / short-paid / rejected`, documents
   (attachments: claim form, survey report, approval letter — never printed).
2. **Split bill** (`splitForPayer(lines, approval)`, pure): from the job / admission lines makes **two invoices**:
   - to the **payer** for the approved amount, line by line (approved quantity / value) or as approved per head, with
     the beneficiary, policy and claim no. printed (record `sv.claim`), and
   - to the **beneficiary** for the rest (depreciation on parts, compulsory excess / deductible, non-covered items,
     disallowed TPA items), each reason as its own line or as a reduction note.
   Both are ordinary documents (period lock, numbering, snapshot, GSTR as usual: the insurer with a GSTIN goes to B2B).
   The two reference each other on paper ("Part of claim CLM/FY26-27/0004").
3. **Claims desk** (used by SV-B and SV-D views): outstanding by payer with age, short-paid amounts with *Write off*
   (existing write-off with reason "Claim deduction"), rejected → bill the beneficiary (one click: a new invoice for the
   rejected amount, the payer invoice cancelled with reason — never deleted).
4. Deposits from the beneficiary (advances) adjust against the beneficiary invoice only.

**Files.** New: `src/lib/services/sv-claims.ts`, `src/components/services-r10/ClaimsView.tsx` (mounted by ClinicDesk
`ipd` and WorkshopDesk `claims`).

**Storage.** `payer_claims` (`doc.create`, watched "Payer claim", dated `date`, numbered `CLM`); record `sv.claim`
`{id, number, role: 'payer' | 'beneficiary'}`.

**Tests.** `tests/sv-claims.test.ts`: split per line and per head; depreciation lines; totals add up to the job; insurer
B2B / owner B2CS routing; short payment write-off; rejection re-bill (payer invoice cancelled, not deleted); numbering
never reused after delete.

### SV-B — Clinics, dentists and diagnostic labs

#### SV-B1 Patients, OPD visits, consultation bill and rate list

**User story.** Reception registers Mrs Rao (UHID 2026-0412, 54 F, referred by Dr Kulkarni), gives her OPD token 12 for
Dr Shah, and bills ₹600 consultation. The receipt shows Dr Shah's registration number and the clinic's CEA
registration. The waiting-room rate list prints in Marathi and English.

**Acceptance criteria.**
1. **Patients** are clients with an additive `patient` object: `uhid` (auto `<prefix><yy>-<seq>` from
   `clinic_settings.uhid_prefix`, editable, unique), age or dob, sex, guardian / attendant, blood group (optional),
   referred-by doctor id, allergies note (never printed). Search by UHID / phone / name everywhere a client is picked.
   Reuses the R5-C `roll_no` when present (migration-free: `uhid` falls back to `roll_no` on read).
2. **Doctors**: the RT-B1 `doctors` master gains (SV-B block in `services-r10.ts`) `in_house` (bool), `speciality`,
   `consult_fee`, `follow_up_fee`, `follow_up_days`, `staff_id` (SV-A3 link). If RT-B has not merged, SV-B creates the
   table at RT-B1's path and field names (§5).
3. **OPD visit** (`clinic_visits`, `doc.create`, dated `date`, numbered `OPD`): patient, doctor, token (daily per
   doctor), kind `new` / `follow-up` (auto when the last paid visit to the same doctor is within `follow_up_days`:
   follow-up fee), vitals note (free text, never printed), status `waiting → with doctor → done → billed`, invoice id.
   Created from an appointment on arrival or directly (walk-in).
4. **Consultation bill**: *Bill* makes a tax invoice / Bill of Supply (by profile: unregistered → Bill of Supply;
   registered → per-line classes, SV-A4) with the consult line (class `health_exempt`, SAC 999312 "medical services",
   unverified), procedures / tests added from the item list, the doctor on the line (`line.sv.staff_id` via the doctor's
   staff link) and the record snapshot `sv.visit` `{id, number, uhid, doctor, doctor_reg, token}`. Templates print
   "UHID · Dr name (Reg. no. …)" under the bill-to (one sub-line in `paper-helpers.ts`).
5. **Registrations** on the sender profile (lazy fields): CEA / state registration no. and validity, doctor's council
   registration (single-doctor clinics), NABL no. (labs), PCPNDT no. (imaging; printed only). Printed in the header
   when set. Validity → bell at 60 days.
6. **Rate list** (CEA Rule 9(i)): from service items with `sv_class` health classes (or a chosen price list): service,
   rate, unit, in two languages (English + `print_lang` of the profile), A4 / A3 print with "Rates as on <date>". A
   price change shows "Rate list out of date — reprint" on the desk.
7. Desk views: `patients` (register, history of visits / bills / balance per patient, CSV), `opd` (today's token board
   by doctor, the queue of SV-A2), `rates`.

**Files.** New: `src/lib/services/sv-patients.ts`, `sv-opd.ts`, `sv-rate-list.ts`, `src/components/services-r10/ClinicDesk.tsx`
(views `patients`, `opd`, `rates`). Edit (shared, one line): `paper-helpers.ts` (`visitText`), the sender profile form
(lazy registrations block).

**Storage.** `clinic_visits` (`doc.create`, watched "OPD visit", dated, numbered `OPD`); `clinic_settings` object
(`settings.manage`, audited, synced singleton); `Client.patient`; doctors fields; record `sv.visit`.

**Tests.** `tests/sv-clinic.test.ts`: UHID generation and uniqueness; token per doctor per day; follow-up fee window;
bill with exempt consult + taxable cosmetic line (SV-A4 classes); snapshot printed even after the doctor is edited;
registration expiry alert; rate list with two languages; pack-off gate.

#### SV-B2 In-patient running bill

**User story.** A day-care admission: deposit ₹10,000, a ₹4,500 / day room for two days, procedure charges, medicines from
the clinic stock. An interim bill on day 1; the final bill on discharge adjusts the deposit. A deluxe room at ₹6,000 /
day would be taxed at 5%.

**Acceptance criteria.**
1. `admissions` (`doc.create`, dated `admit_date`, numbered `IPD`): patient, doctor(s), room / bed (from
   `clinic_settings.rooms`: name, kind `general` / `private` / `icu` / `ccu` / `iccu` / `nicu`, rate per day), admit and
   discharge date-time, payer claim (SV-A5, optional), deposits (existing advance receipts, `advance_id` list), status
   `admitted → discharged → billed`.
2. **Charges**: a running list (lines with date, item, qty, rate, doctor) kept on the admission (`charges`), added from
   a quick-add bar (procedures, visits, medicines / consumables from stock with batch, room-days auto per midnight
   census or per 24 h — `clinic_settings.room_day: 'midnight' | '24h'`, default midnight).
3. **Room-rent test** (`roomClass(room, ratePerDay, date)`, pure, `HOSPITAL_ROOM_RULES`): ICU / CCU / ICCU / NICU →
   exempt always; other rooms with a **room charge per day above ₹5,000** on or after 2022-07-18 → class
   `hospital_room_high` (5%, no ITC, SAC 9993); else exempt. The test uses the room charge alone (not other charges),
   per day per patient.
4. **Composite treatment**: medicines, consumables, implants and food on an admission are `health_exempt` lines (part of
   the composite health care supply, SV4) with their HSN kept for the stock reader; a bed-side pharmacy sale billed to
   an **outpatient** is a goods line at its own rate (pharmacy pack / POS).
5. **Interim bill**: a print (not a document) of charges to date less deposits. **Final bill**: one invoice (Rule 46A
   title when it mixes a 5% room with exempt lines for an unregistered patient), or the SV-A5 split when a payer claim
   exists; deposits applied through the existing advance adjustment; excess deposit refunded by the existing refund
   voucher.
6. Bell: admissions open > 7 days; deposit below charges by more than `clinic_settings.deposit_alert` (default ₹0 =
   off).

**Files.** New: `src/lib/services/sv-ipd.ts`; ClinicDesk view `ipd` (with the `ClaimsView` mount). Rule section `// SV-B`
`HOSPITAL_ROOM_RULES`.

**Storage.** `admissions` (`doc.create`, watched "Admission", dated `admit_date`, numbered `IPD`), `clinic_settings.rooms`;
record `sv.admission` `{id, number, admit, discharge, room}`.

**Tests.** `tests/sv-ipd.test.ts`: room-days by midnight / 24 h; ₹5,000 exactly exempt, ₹5,001 5%; ICU ₹9,000 exempt;
before 2022-07-18 exempt; composite medicines exempt with stock out; deposits applied and refund; payer split total
equals charges; final bill numbering; snapshot.

#### SV-B3 Lab tests, orders and reports

*Seen in:* small-lab LIS tools; labs printing reports from Word templates.

**User story.** A patient comes with a doctor's slip for CBC, lipid profile and HbA1c. I pick the tests (the panel
expands), bill ₹1,450, print sample labels with the order number, enter results in the afternoon, and send the PDF
report on WhatsApp. Values outside the range print in bold with H / L.

**Acceptance criteria.**
1. `lab_tests` (`master.edit`): code, name, department, sample type, container, TAT (hours), price (or the linked
   service item), method, **parameters** (name, unit, kind `numeric` / `text` / `option`, options, decimals, reference
   ranges by sex and age band `{sex?, age_from?, age_to?, low?, high?, text?}`, critical low / high), panels (a test that
   is a list of tests), outsourced-to (reference lab vendor, cost), interpretation note (printed).
2. `lab_orders` (`doc.create`, dated `date`, numbered `LAB`): patient, referring doctor (SV-B4), tests (expanded),
   sample status per sample (`to collect → collected (time, by) → received → in process → done`), barcode / label
   print per sample (existing label sheet, one preset), results per parameter with auto flag (H / L / critical) from the
   patient's sex / age on the order date, verified by (staff), report status `pending → partial → final → delivered`
   (delivery log: printed / WhatsApp / e-mail, date-time), invoice id. Bill created from the order (lines per test /
   panel, class `health_exempt`).
3. **Report print**: A4 with letterhead (sender profile + NABL no.), patient block (UHID, age / sex, referred by, sample
   dates), department-wise tables (parameter, result, unit, reference range, flag), interpretation notes, signatures
   (up to two verified-by names and qualifications from `service_staff`), "End of report", page numbers. Script-free
   print path (`printHtmlDocument`), PDF through the existing stack. Partial reports allowed; amended reports print
   "Amended" with the time, earlier versions kept in the order's history.
4. **Results entry**: grid per order, keyboard down-the-column; CSV paste (`parameter code, value`) for analyser
   exports; critical values highlighted with a confirm.
5. Outsourced tests: a purchase bill from the reference lab per period from the orders' outsourced costs (one click,
   existing bill save).
6. Desk views: `lab` (today's orders by status, TAT breaches in red), `tests` (master, CSV import / export).

**Files.** New: `src/lib/services/sv-lab.ts`, `sv-lab-report.ts`; ClinicDesk views `lab`, `tests`; `LabReportPrint.tsx`.
Edit: `label-sheet.ts` (one sample-label preset, appended).

**Storage.** `lab_tests` (`master.edit`, watched "Lab test"), `lab_orders` (`doc.create`, watched "Lab order", dated,
numbered `LAB`); record `sv.lab_order` `{id, number}`.

**Tests.** `tests/sv-lab.test.ts`: panel expansion without duplicates; reference range by sex / age band; flags H / L /
critical; status flow; amended report keeps history; bill lines from the order; outsourced cost bill; CSV paste;
pack-off gate.

#### SV-B4 Referring doctors and visiting consultants

**User story.** Our lab wants to see which doctors send patients and how much each visiting consultant earned this
month. Consultants are paid 60% of their consultation fees; the payout bill deducts 194J. Referral payments are shown
with a warning, and we choose to record them as non-deductible.

**Acceptance criteria.**
1. Every visit / order / admission / bill may carry a **referring doctor** (`sv.referrer`: doctor id + name snapshot).
   Referral report: by doctor and period — patients, orders, bill value; CSV. No payout field on the referral report.
2. **Visiting consultant fee-share**: on the doctor row, `share` (% of the consultation / procedure lines they did, or a
   fixed ₹ per visit). Statement per doctor and month from lines with their staff link (SV-A3 engine with a
   `fee_share` plan); *Make payout bill* → a purchase bill from the doctor as vendor, TDS `194J` (rate and ₹50,000
   threshold from `tds-rules.ts`, labels by date through `ita2025.ts`), through `staff_payouts`.
3. **Referral payments** (only if the user turns on `clinic_settings.record_referral_payments`, default **off**): a
   payment to a referring doctor is booked through a payout row to a ledger **"Referral fees — disallowable (Sec 37)"**
   (created by name, indirect expenses) with a permanent caution: "Payments or gifts to doctors for referrals are
   prohibited for doctors (IMC / NMC regulations) and are disallowed for tax (Sec 37(1) Expl. 1; Apex Laboratories,
   SC 2022). Verify with your CA." The tax-audit / ITR working papers list this ledger as a disallowance (one row in the
   existing disallowance list if present; otherwise noted in the feature doc).
4. 194R prompt: when referral "benefits in kind" are recorded above ₹20,000 a year to one doctor, a 194R reminder
   (warning only; rates from the existing `TDS_EXTRA_SECTION_RULES`).

**Files.** New: `src/lib/services/sv-referrals.ts`; ClinicDesk view `referrals`. Uses `sv-commission.ts`,
`sv-payouts.ts` (SV-A).

**Storage.** record `sv.referrer`; doctor `share`; `clinic_settings.record_referral_payments`.

**Tests.** `tests/sv-referrals.test.ts`: referral totals by doctor; fee-share statement; payout bill with 194J below /
above ₹50,000; referral ledger only when switched on and its caution; 194R reminder threshold.

### SV-C — Memberships, packages, classes and attendance (salons, spas, gyms, yoga, coaching)

#### SV-C1 Memberships and packages

*Seen in:* gym tools (freeze, upgrade, transfer, renewal reminders), salon packages and prepaid wallets.

**User story.** Rahul buys a 6-month gym membership (₹9,000 + 5%). In month 3 he travels and I freeze it for 20 days;
the end date moves. In month 5 he upgrades to the annual plan and pays the difference. Meera buys "6 facials for
₹9,000"; each visit redeems one session at the POS, and the bill shows "Session 3 of 6 — package MEM/FY26-27/0031".

**Acceptance criteria.**
1. `member_plans` (`master.edit`): name, kind `membership` (time-based) / `package` (session-based) / `wallet` (prepaid
   value) / `combo` (time + sessions), duration (days / months), sessions, covered items or categories (for packages),
   price, service item for the sale line (class `fitness_9997` / `beauty_9997` / `coaching` …), freeze rules (max days
   per term, max times, min days per freeze, fee), transferable (fee), validity for packages (days), joining fee item,
   active.
2. `memberships` (`doc.create`, dated `start`, numbered `MEM`): member (client), plan snapshot, start, end (derived,
   stored), sessions total / used (derived from redemptions), status `active` / `frozen` / `expired` / `cancelled` /
   `transferred`, freezes `[{from, to, reason}]`, upgrades / transfers history, sale invoice id(s), trainer (SV-A3
   staff), auto-renew (off / creates a draft invoice through the existing recurring schedule on the end date).
3. **Sale**: *Sell plan* at the POS or the editor → an invoice line for the plan (the whole price, taxed when invoiced:
   SV14) and the membership row; part-payment allowed (normal balance).
4. **Freeze**: within the plan's rules; end moves by the frozen days; a freeze fee is a separate small invoice line;
   unfreeze early recomputes. **Upgrade**: credit for the unused value of the old plan, pro rata by days (or by sessions)
   at the old price, against the new plan's price; one invoice for the difference with a note line (no credit note) —
   or a credit note + new invoice when `service_settings.upgrade_mode = 'credit_note'`. **Transfer**: to another client
   with the fee; history kept. **Cancel with refund**: a credit note for the refundable amount (plan rule: none / pro
   rata / custom) with GST reversed on it within the Sec 34 time limit (warning past it).
5. **Redeem**: at the POS / editor, adding a covered service for a member with an active package offers *Use package*:
   the line becomes ₹0 with `line.sv.redeem = {membership_id, session_no}` and prints "Session 3 of 6 — <number>"; the
   value for commission is price ÷ sessions (SV-A3). Over-use is refused; expired packages offer renewal.
6. **Wallets** use the existing advances: a wallet "top-up" is an advance receipt (GST on receipt for services, G3) with
   a bonus value (`plan.bonus_pct`, a discount on later use, never cash); spending adjusts the advance.
7. **Expiry**: sessions unused at expiry are forfeited (no GST event; the value was taxed at sale — SV15); a report of
   forfeited value per month for the books (optional journal "Package income recognised" when the user keeps package
   income deferred — `service_settings.defer_package_income`, default off).
8. **Renewals**: list of memberships ending in 7 / 15 / 30 days and expired in the last 30, with `wa.me` text; bell
   "Memberships expiring this week: n".

**Files.** New: `src/lib/services/sv-members.ts`, `sv-memberships.ts`, `src/components/services-r10/MembersDesk.tsx` (views
`plans`, `members`). Edit (shared, one lazy mount each): POS line (Use package), `creator/ItemsTable.tsx` (redeem chip),
`paper-helpers.ts` (`sessionText`).

**Storage.** `member_plans` (`master.edit`, watched "Membership plan"), `memberships` (`doc.create`, watched
"Membership", dated `start`, numbered `MEM`); line `sv.redeem`; `service_settings.upgrade_mode`,
`.defer_package_income`.

**Tests.** `tests/sv-memberships.test.ts`: end date from duration across month ends; freeze extends end and enforces
rules; upgrade credit pro rata by days and by sessions; transfer; cancel refund credit note and Sec 34 warning;
redeem ₹0 line, over-use refused, expiry; wallet bonus; renewal window; auto-renew draft; pack-off gate.

#### SV-C2 Check-in and attendance

**User story.** A member types her member code (or I scan the QR on her card with the laptop camera): green "Active till
14 Mar", or amber "Expired 3 days ago — renew?". The yoga batch's attendance is one tap per student; a coaching parent
gets a monthly attendance line on the fee reminder.

**Acceptance criteria.**
1. `checkins` (`doc.create`, dated `date`): **one row per day** with `entries: [{client_id, time, membership_id,
   by, class_id?}]` (keeps the table to ~365 rows a year). Check-in by member code / phone / name search / camera QR
   (the existing scan path's camera, lazy) / click from the list.
2. On check-in: membership status shown (active, frozen, expired, no plan); `service_settings.checkin_gate: 'off' | 'warn'
   | 'block'` (fitness default `warn`); a session-based package optionally redeems one session at check-in
   (`plan.redeem_on_checkin`).
3. **Class / batch attendance** (`class_attendance`, `doc.create`, dated `date`): per class (SV-C3) and date, present /
   absent / late per enrolled member or student; one-tap all present.
4. Reports: daily footfall, peak hours, members not seen in 14 / 30 days (churn list with `wa.me` text), attendance % per
   student per month (coaching), CSV. Printable member card with QR (member code) on the label sheet (one preset).
5. Fees pack hook (coaching): the R5-C dues reminder text gains "Attendance this month: 18 / 22" when attendance exists
   (one guarded line in `fee-dues.ts`).

**Files.** New: `src/lib/services/sv-checkin.ts`, `sv-attendance.ts`; MembersDesk view `checkin`; Fees tab view
`attendance` (`FeesAttendanceView.tsx`, mounted by the R5-C fees tab through one lazy line). Edit: `label-sheet.ts` (member
card preset, appended), `institutions/fee-dues.ts` (one line).

**Storage.** `checkins` (`doc.create`, watched "Check-ins", dated), `class_attendance` (`doc.create`, watched
"Attendance", dated).

**Tests.** `tests/sv-attendance.test.ts`: one row per day; gate warn / block by status; redeem on check-in; churn list;
attendance % with holidays; reminder line; QR code text; pack-off gate (fitness off and fees off → no read).

#### SV-C3 Classes, batches, PT sessions and coaching refunds

**User story.** Our yoga studio runs "Morning Hatha" Mon–Fri 6:30 for 20 people and "Weekend Power" Sat–Sun; a trainer's
personal-training package of 12 sessions is booked into the appointment book. Our coaching class runs "JEE 2027 —
Batch B" Mon / Wed / Fri 5–7 pm with Mr Iyer; a student who leaves after 3 of 10 months gets a pro-rata refund within
10 days.

**Acceptance criteria.**
1. `class_schedules` (`master.edit`): name, kind `class` / `batch`, staff (teacher / trainer), resource (room), weekdays
   and time, start / end dates, capacity, plan(s) that cover it (SV-C1) or fee plan (R5-C), holidays (dates).
   Enrolment: members (fitness) or students (`Client.enrolments` of the fee plan + `class_id`, additive).
2. Timetable view (week) on the Members desk and in the Fees tab `batches` view; bookings for capacity classes (the
   SV-A2 appointment row with `class_id`), wait-list position.
3. **PT sessions**: a package plan with a trainer; each session is an appointment with that trainer; check-in or
   *Done* redeems one session; trainer commission per redeemed session (SV-A3 `package redemption` rule).
4. **Coaching refund** (`coachingRefund(enrolment, leaveDate, rules)`, pure, `COACHING_REFUND_RULES` from 2024-01-16 as
   reported, "verify"): refundable = fees paid for the **unused period** pro rata by days (or by months, setting) +
   unused hostel / mess fees; non-refundable heads (registration, material issued) as set on the fee plan; due date =
   request date + 10 days. *Refund* makes a credit note against the instalment invoice(s) (tax reversed on the taxable
   part) and a refund payment; the Fees `refunds` view lists requests with the due date and a red "overdue" after 10
   days. Plus a "fee increase during the course" warning when a plan price is raised while enrolments are open.

**Files.** New: `src/lib/services/sv-classes.ts`, `sv-coaching-refund.ts`; MembersDesk view `classes`; Fees tab views
`batches`, `refunds` (`FeesBatchesView.tsx`, `FeesRefundsView.tsx`, lazy mounts in the R5-C fees tab host).

**Storage.** `class_schedules` (`master.edit`, watched "Class / batch"); `Enrolment.class_id` (additive); appointment
`class_id`; rule section `// SV-C` `COACHING_REFUND_RULES`.

**Tests.** `tests/sv-classes.test.ts`: occurrences over weekdays with holidays; capacity and wait-list; PT redemption and
commission; refund by days and by months, non-refundable heads, hostel / mess, 10-day due; credit note reverses tax on
the taxable part only; fee-increase warning.

#### SV-C4 Service recipes (back-bar consumption)

**User story.** A hair-colour service uses 60 ml of colour and 60 ml of developer. When I bill it, stock goes down by
those amounts, and the monthly report shows product cost per service and per stylist.

**Acceptance criteria.**
1. A service item may have a **recipe**: it is the existing kit mechanism (`StockItem.kit` + default BOM,
   `events-kits.ts`) offered under a salon-friendly label "Products used per service" on the item form (lazy sub-row);
   components in ml / g through alternate units (`units.ts`).
2. On the sale the kit components leave stock as today; the service line's price and tax are unchanged.
3. Report (Members desk `recipes`): consumption by product, by service, by staff (from `line.sv.staff_id`), cost
   (stock valuation rate) vs service revenue, CSV. Variance: consumption per physical count (link to the existing
   physical stock voucher).
4. Optional per-line override: "used 90 ml" on the bill line (`line.sv.recipe_qty`), never printed.

**Files.** New: `src/lib/services/sv-recipes.ts`; MembersDesk view `recipes`; item form sub-row. No engine change if
`events-kits.ts` already honours `unit_factor` (else one guarded line there, owned by SV-C).

**Storage.** none new (kits / BOMs); line `sv.recipe_qty`.

**Tests.** `tests/sv-recipes.test.ts`: kit on a non-stocked service consumes ml components; override quantity; cost by
staff; units conversion.

### SV-D — Repair and service centres (vehicle workshops, AC / appliance service)

SV-D builds on Round 9 **RT-D4** (`service_jobs`, `src/lib/retail/rt-service-jobs.ts`, `SVC` series, status flow,
warranty check, *Bill job*). It adds fields and views; it never forks the engine. RT-D4's statuses are extended
additively (§6).

#### SV-D1 Vehicle and appliance job cards

*Seen in:* AllWheels / RAMP job cards; AC service tickets.

**User story.** MH12 AB 1234, Swift VXi, 48,210 km, fuel ¼, comes for the 50,000 km service plus a brake noise. The job
card lists the customer's complaints, the inspection checklist and the photos. For an AC breakdown call I log the site
address and assign a technician for a 3 pm visit.

**Acceptance criteria.**
1. `vehicles` (`master.edit`): registration no. (normalised, unique), make, model, variant, fuel type, year, VIN /
   chassis no., engine no., colour, owner (client), insurer and policy no. / expiry, last odometer. For appliances the
   same table holds `kind: 'appliance'` with brand, model, serial no., installed at (site address), warranty / AMC link.
   (Kept as one table `service_assets`, kind `vehicle` / `appliance`; the desk shows the right fields.)
2. Job card = RT-D4 `service_jobs` row with the additive SV-D block: `asset_id`, `odometer_in` / `odometer_out`, fuel
   level, complaints list (customer voice), inspection checklist (from `workshop_settings.checklists`), photos
   (attachments), promised date-time, bay (SV-A2 resource), technicians (SV-A3 staff, several), site visit
   (`visit_at`, address) for appliance calls, `amc_id` (SV-D4).
3. Statuses (additive to RT-D4): `estimate sent`, `awaiting parts`, `awaiting insurer`, `quality check`. Job board by
   status and bay, age colours; the board component is RT-D4's (`ServiceJobsView`) with a workshop column set.
4. Vehicle / appliance history: every job, invoice, parts and odometer readings; "last service" on the job card.
5. Prints: job card (with the customer's signature line and the terms from `workshop_settings.terms`), gate pass on
   delivery. `wa.me` updates ("Your car is ready", estimate approval request).

**Files.** New: `src/lib/services/sv-assets.ts`, `sv-jobs-workshop.ts` (thin layer over `rt-service-jobs.ts`),
`src/components/services-r10/WorkshopDesk.tsx` (views `jobs`, `vehicles`), `WorkshopJobCardPrint.tsx`. Edit (shared):
RT-D4's job view (export `ServiceJobsView` as its own module if it is not; one line in `DevicesDesk.tsx`).

**Storage.** `service_assets` (`master.edit`, watched "Vehicle / appliance"), `service_jobs` additive fields;
`workshop_settings` object (`settings.manage`).

**Tests.** `tests/sv-workshop-jobs.test.ts`: registration no. normalisation and uniqueness; job with asset; odometer
must not go down (warning); history order; new statuses accepted by the RT-D4 flow; site visit on the appointment
book; pack-off gate.

#### SV-D2 Estimates, approvals, parts and labour

**User story.** After inspection I add parts (brake pads from stock, ₹2,150) and labour ("Front brake pad replace",
0.8 h at ₹900 / h). The customer approves the estimate on WhatsApp; I log "Approved by phone, 11:40, Mr Patil". During
the work a disc needs skimming: a supplementary estimate is approved. The bill shows parts and labour separately.

**Acceptance criteria.**
1. `labour_ops` (`master.edit`): code, description, SAC (default 998714 for vehicles, 998715 / 998729 appliances —
   "verify", SV20), standard hours per vehicle class (`hatch` / `sedan` / `suv` / `2W` / `3W` / `commercial`, from
   `workshop_settings.classes`), or a flat price; labour rate per hour (`workshop_settings.labour_rate`, per class).
2. **Estimate** = the existing Quotation document linked to the job (`sv.job` record key), lines: parts (stock items),
   labour ops (service lines with hours × rate), outside work (sublet: vendor, cost, markup — SV24), consumables (oil,
   coolant by litre). Supplementary estimates are further quotations on the same job; each approval is logged on the
   job (`approvals: [{quote_id, by, how: 'signature' | 'phone' | 'whatsapp' | 'in person', at, note}]`).
3. **Parts issue**: issuing parts to a job before billing is a stock journal to a `wip`-kind godown "Jobs in progress"
   (existing `Godown.kind 'wip'`, non-saleable) per job; billing moves them out from there; returning unused parts moves
   them back. The job shows parts issued vs estimated.
4. **Bill job** (RT-D4 action, extended): converts the approved quotation(s) into one invoice with parts at their own
   HSN rates and labour at 18% (separate lines → separate supplies, SV20), sublet re-billed at cost + markup, advance
   adjusted; or the SV-A5 split when the job has a claim.
5. Technician time: optional clock-in / out per labour line (`TimeEntry` with `job_id` and the work type — the R3-B
   timer, lazy), efficiency report (billed hours vs clocked hours per technician).

**Files.** New: `src/lib/services/sv-estimates.ts`, `sv-parts-issue.ts`, `sv-labour.ts`; WorkshopDesk views `estimates`,
`labour`.

**Storage.** `labour_ops` (`master.edit`, watched "Labour operation"); job `approvals`, `parts_issue` voucher ids;
record `sv.job` `{id, number, reg_no, odometer}`; `TimeEntry.job_id` (additive).

**Tests.** `tests/sv-estimates.test.ts`: labour hours by vehicle class × rate; supplementary estimate merge on billing;
parts issue → wip → sale keeps stock totals; return of unused parts; bill with parts at 18% / 5% and labour 18%;
sublet markup; approval log required before *In repair* (warning); efficiency report.

#### SV-D3 Motor insurance claims

**User story.** Cashless claim with ACKO: survey on Monday, approval ₹42,000 with 50% depreciation on plastic parts and
₹1,000 compulsory excess. The app makes the insurer's invoice for the approved amount and the owner's invoice for
depreciation, excess and the non-approved polish, then tracks the insurer's payment.

**Acceptance criteria.**
1. Job → *Insurance claim* creates a `payer_claims` row (SV-A5, kind `motor`) with insurer, policy no., claim no.,
   surveyor name / phone, survey date, mode `cashless` / `reimbursement`.
2. **Depreciation** per part category (`workshop_settings.depreciation`: rubber / plastic / nylon 50%, fibre glass 30%,
   glass 0%, metal by vehicle age bands — editable table; defaults from common motor-policy practice, not a statute,
   "verify with the insurer") applied on the approved part value to compute the owner's share; compulsory / voluntary
   excess; non-covered lines.
3. **Cashless**: two invoices through `splitForPayer` (insurer = approved amount; owner = depreciation + excess +
   non-covered), insurer invoice in the insurer's name with GSTIN (Circular 217/11/2024, SV22). **Reimbursement**: one
   invoice to the owner (insurer named as "claim with" on paper), with the claim tracked for the owner's information
   only, or two invoices if the insurer asks (setting per insurer: `client.sv_insurer_invoice: 'insurer' | 'owner'`).
4. Claims desk (`ClaimsView`) with motor columns: survey pending, approval pending, delivered unpaid, short-paid.
5. Salvage (replaced parts the insurer keeps or sells) recorded as a note; no stock entry by default.

**Files.** New: `src/lib/services/sv-motor-claims.ts`; WorkshopDesk view `claims` (mounts `ClaimsView`).

**Storage.** `workshop_settings.depreciation`; `Client.sv_insurer_invoice` (additive); uses `payer_claims`.

**Tests.** `tests/sv-motor-claims.test.ts`: depreciation by category and vehicle age; excess; insurer / owner totals equal
the job; reimbursement mode single invoice; insurer B2B with GSTIN; short payment write-off.

#### SV-D4 Service reminders and AMC visits

**User story.** Every car billed for a periodic service gets a next-service date (6 months) and km (+10,000). Next
month's due list goes out on WhatsApp. For AC customers on AMC, each scheduled visit creates a job card on the right
day, and the AMC renewal reminder already on the dashboard links to the contract.

**Acceptance criteria.**
1. On billing a job, the next service is computed from the labour ops' `interval_days` / `interval_km` (or
   `workshop_settings.default_interval`) and stored on the asset (`next_service_date`, `next_service_km`); estimated
   km per day from the odometer history projects the date when km would come first.
2. **Reminders** view: due in 30 days / overdue, by asset and owner, with `wa.me` text (en / hi) and "Book" (an
   appointment, SV-A2). Insurance expiry from the vehicle's policy date in the same list.
3. **AMC**: an AMC contract (`amc.ts`) may name assets (`asset_ids`, additive); each due visit offers *Create job* (a
   `service_jobs` row with `amc_id`, no charge for covered work; parts outside the AMC are billed). Logging the job as
   delivered records the AMC visit (`AmcVisit` with the job number). The dashboard AMC tile is unchanged.
4. Warranty on parts fitted: a part line on a job bill with `warranty_months` (existing serial warranty when serial
   tracked; otherwise a job-level "parts warranty until" date printed on the bill).

**Files.** New: `src/lib/services/sv-reminders.ts`; WorkshopDesk view `reminders`. Edit: `amc.ts` (additive `asset_ids`,
`visit.job_id`; one helper `visitFromJob`).

**Storage.** asset `next_service_date`, `next_service_km`; labour op `interval_days`, `interval_km`; AMC
`asset_ids`, visit `job_id`.

**Tests.** `tests/sv-reminders.test.ts`: next service by days and by km projection; insurance expiry; AMC visit → job →
visit logged; covered vs billed parts; reminder text.

---

## 5. Work packages

Four packages, each one agent in its own worktree. **Merge order: SV-A first.** SV-B and SV-C follow in any order;
**SV-D last**, and only after Round 9 **RT-D** has merged (it extends `service_jobs`). SV-B needs RT-B1's `doctors`
table: if RT-B has not merged when SV-B starts, SV-B creates `doctors` exactly as RT-B1 specifies (path
`src/lib/retail/rt-pharmacy-rx.ts` exports, table name, fields) in a commit RT-B then rebases onto, and records that in
the feature doc. If RT-D has not merged when SV-A, SV-B and SV-C are done, SV-D waits (default) rather than forking the
job engine.

SV-A owns:
- the pack ids and the profile (`service_kind`);
- `service-rules.ts`, `sv-registry.ts` and `types/services-r10.ts` scaffolds;
- the `'sv'` record / line keys in `invoice-defaults.ts`;
- the `OPD`, `IPD`, `LAB`, `MEM`, `CLM` series names (reserved in one commit; each package uses its own);
- `R10Stub.tsx` desks and every R10 tab / help / Ctrl+K row (§6).

### SV-A — Service profile and shared front desk (A1–A5)

Owned (new):
- `src/lib/services/sv-{profile,registry,appointments,slots,staff,commission,payouts,tax,claims}.ts`,
  `src/lib/service-rules.ts`;
- `src/types/services-r10.ts`;
- `src/components/services-r10/{ServiceKindPicker,R10Stub,FrontDesk,AppointmentDialog,ClaimsView}.tsx`;
- `src/i18n/areas/services-r10a.ts`;
- `docs/features/services-r10.md` (one doc for the round, one section per package; each package edits only its section);
- tests `sv-profile`, `sv-appointments`, `sv-commission`, `sv-tax`, `sv-claims`, `sv-registry`, `sv-rules`, `sv-pack-gate`.

Owned (edit):
- `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`;
- `SetupWizard.tsx`, `FeaturesPanel.tsx`;
- `page-tabs.ts`, `Time.tsx` (`visiblePackTabs`, lazy desk mounts);
- `demo/profile-services.ts`;
- `store/invoice-defaults.ts` (the two `'sv'` keys, one commit at the start of the branch);
- `gst-tabs.ts` (`alsoPacks`), `gst-reports.ts` (one branch), `bill-guard.ts`, `gst-guards.ts` (one lazy check each);
- `tests/help-registry.test.ts`, `tests/help-glossary.test.ts`, `tests/docs-links.test.ts` (regex + `SV`).

Shared (§6): `pages/Pos.tsx`, `creator/ItemsTable.tsx`, `paper-helpers.ts`, `pos-display.ts`, client form, item form,
help files, registries, rules, types, demo.

Budget: first paint ≤ +0.03 kB (the two keys); total ≤ 14 kB gz.

### SV-B — Clinics, dentists and labs (B1–B4)

Owned (new): `src/lib/services/sv-{patients,opd,rate-list,ipd,lab,lab-report,referrals}.ts`;
`src/components/services-r10/{ClinicDesk,LabReportPrint}.tsx`; `src/i18n/areas/services-r10b.ts`; tests `sv-clinic`,
`sv-ipd`, `sv-lab`, `sv-referrals`.

Owned (edit): the sender profile form's lazy registrations block.

Shared (§6): `paper-helpers.ts` (`visitText`), `label-sheet.ts` (sample-label preset), RT-B1 `doctors` (additive
fields), registries, rules (`// SV-B` `HOSPITAL_ROOM_RULES`, `HEALTH_CLASS_RULES` rows), types, demo.

Budget: total ≤ 12 kB gz.

### SV-C — Memberships, packages, classes and attendance (C1–C4)

Owned (new): `src/lib/services/sv-{members,memberships,checkin,attendance,classes,coaching-refund,recipes}.ts`;
`src/components/services-r10/{MembersDesk,FeesAttendanceView,FeesBatchesView,FeesRefundsView}.tsx`;
`src/i18n/areas/services-r10c.ts`; tests `sv-memberships`, `sv-attendance`, `sv-classes`, `sv-recipes`.

Owned (edit): `institutions/fee-dues.ts` (one line), the R5-C fees tab host (three lazy view mounts), `events-kits.ts`
(one guarded line only if units are not honoured).

Shared (§6): POS line and `ItemsTable.tsx` (redeem chip), `paper-helpers.ts` (`sessionText`), `label-sheet.ts` (member
card preset), registries, rules (`// SV-C`), types, demo.

Budget: total ≤ 10 kB gz.

### SV-D — Repair and service centres (D1–D4)

Owned (new): `src/lib/services/sv-{assets,jobs-workshop,estimates,parts-issue,labour,motor-claims,reminders}.ts`;
`src/components/services-r10/{WorkshopDesk,WorkshopJobCardPrint}.tsx`; `src/i18n/areas/services-r10d.ts`; tests
`sv-workshop-jobs`, `sv-estimates`, `sv-motor-claims`, `sv-reminders`.

Owned (edit): `amc.ts` (additive fields and `visitFromJob`).

Shared (§6): RT-D4 files (`rt-service-jobs.ts` status union, `ServiceJobsView` export), `types/retail-r9.ts` is **not**
edited (SV-D declares its job fields in `types/services-r10.ts`), registries, rules (`// SV-D`), types, demo.

Budget: total ≤ 9 kB gz.

**Combined:** first paint ≤ 184.63 kB (+ Round 9's ≤ 0.1 kB); total JS ≤ +45 kB. Each package runs `npm run typecheck`,
`npm run lint`, `npm test`, `npm run build` and `npm run check:size` on its branch and again after rebase.

---

## 6. Shared-file protocol

| File | Who | Rule |
|---|---|---|
| `src/types/services-r10.ts` | A creates | One `declare module` block per package, marked `// SV-A` … `// SV-D`; each package edits only its block. A: settings `service_kind`, `service_settings`; item `sv_class`; client `dob`, `anniversary`; record `sv` (type with optional sub-objects `visit`, `admission`, `lab_order`, `referrer`, `claim`, `job`); line `sv` (`staff_id`, `assist_id`, `assist_pct`, `exempt`, `redeem`, `recipe_qty`); payment `tip_staff`. B: client `patient`; doctor `in_house`, `speciality`, `consult_fee`, `follow_up_fee`, `follow_up_days`, `staff_id`, `share`. C: `Enrolment.class_id`. D: `service_jobs` fields (`asset_id`, `odometer_in/out`, `fuel`, `complaints`, `checklist`, `bay`, `technicians`, `visit_at`, `amc_id`, `approvals`, `parts_issue`); AMC `asset_ids`, visit `job_id`; client `sv_insurer_invoice`; `TimeEntry.job_id`. Sub-field types of record / line `sv` are declared by A for all packages in one commit, so B–D never edit A's block. |
| `src/store/invoice-defaults.ts` (`RECORD_KEYS`, `normalizeRecord`, `normalizeItem`) | A (owner) | A appends `'sv'` to the record-key and line-key lists (Round 9's lists if RT-A created them, else R8's) in one commit at the start of its branch. B–D do not edit it. |
| `src/lib/service-rules.ts` | A creates | Sections `// SV-A` `SERVICE_CLASS_RULES`, `COMPOSITION_SERVICE_NOTE_RULES`; `// SV-B` `HOSPITAL_ROOM_RULES`, `HEALTH_CLASS_RULES`, `REFERRAL_CAUTION_RULES`; `// SV-C` `COACHING_REFUND_RULES`; `// SV-D` `MOTOR_DEPRECIATION_DEFAULTS` (marked "insurer practice, not statute"), `REPAIR_SAC_RULES`. A commits the section headers and types; each package fills its section. Every row carries `source` and `verified`. |
| `src/lib/services/sv-registry.ts` | A creates | `SV_TABLE_ACTIONS` / `SV_WATCHED` with one block per package (A: `appointments`, `service_staff`, `commission_plans`, `staff_payouts`, `payer_claims`, `service_settings`; B: `clinic_visits`, `admissions`, `lab_tests`, `lab_orders`, `clinic_settings`; C: `member_plans`, `memberships`, `checkins`, `class_attendance`, `class_schedules`; D: `service_assets`, `labour_ops`, `workshop_settings`). `tests/sv-registry.test.ts` pins both maps and checks the importers (`sync-engine.ts`, `trust/recycle-bin.ts` import it once, added by A). |
| `src/lib/backup.ts`, `sync-engine.ts` (`DATED`, `NUMBERED`), open-export schema | each its own rows | Append-only blocks `// R10-A` … `// R10-D`; conflicts with Round 9's blocks are resolved by keeping both. |
| `src/pages/Time.tsx`, `src/pages/page-tabs.ts` | A | A writes every R10 tab row and the lazy desk mounts by the import paths in this PRD; stubs until a package merges. |
| R5-C fees tab host (`components/institutions/*` fees view) | C | Three lazy view mounts (`batches`, `attendance`, `refunds`) and their `&view=` ids; nothing else. |
| `src/lib/industry-packs.ts` | A | Pack ids, the `// R10` `PACK_TABS` block (every desk's views, the fees views) and the common-credit `alsoPacks`. |
| `src/lib/gst-tabs.ts` | A | `PACK_GST_TABS['common-credit']` gains `clinic`, `salon`, `fitness`. |
| `src/components/creator/ItemsTable.tsx` and the POS line in `pages/Pos.tsx` | A, C | One lazy mount line each in the line detail area: A (staff picker), C (redeem chip). Round 9's C / E lines stay as they are; order in the file: R9 lines, then A, C. |
| `pages/Pos.tsx` (other) | A | One lazy line: open-from-appointment prefill + the tip tender row. |
| `src/components/templates/paper-helpers.ts` | A, B, C | A: Rule 46A title branch; B: `visitText` (UHID / doctor / reg. no.); C: `sessionText`. Each appended after Round 9's helpers. |
| `src/lib/gst-reports.ts` | A | One branch in the nil table (`line.sv?.exempt`). |
| `src/lib/bill-guard.ts`, `src/lib/gst-guards.ts` | A | One lazy check each. |
| `src/lib/label-sheet.ts` | B, C | B appends the sample-label preset, C the member-card preset (after Round 9's C / E entries). |
| `src/lib/pos-display.ts` | A | One guarded "Now serving" line. |
| RT-B1 `doctors` (Round 9) | B | Additive fields only, declared in `services-r10.ts` block `// SV-B`; registry row stays RT-B's. |
| RT-D4 `service_jobs`, `rt-service-jobs.ts`, `DevicesDesk.tsx` (Round 9) | D | Status union appended (`'estimate_sent'`, `'awaiting_parts'`, `'awaiting_insurer'`, `'quality_check'`); `ServiceJobsView` exported from its own module (one-line change in `DevicesDesk.tsx`); fields declared in `services-r10.ts`. Registry row stays RT-D's. |
| `src/lib/amc.ts` | D | Additive `asset_ids`, `AmcVisit.job_id`, helper `visitFromJob`. |
| `src/lib/help/topics-*.ts`, `glossary.ts`, `src/i18n/areas/discover-r6-tabs.ts` | A | A writes every R10 topic and Ctrl+K title in one `// R10` block per file, using the tab / view ids of this PRD. Packages correct their own rows after rebase if wording changes. |
| `src/lib/demo/profile-services.ts` | A | One block per package; A's builder dispatches by `service_kind`; the professional rows stay. |
| `tests/e2e/smoke.mjs` | A, B, C, D | One appended `step(...)` block each, in merge order, after Round 9's. |
| `docs/features/services-r10.md` | A creates | One section per package; each package edits only its section and records its bundle numbers there. |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md` | lead | After merge: the Round 10 section; table rows; storage keys; the `service-rules.ts` rule-file note; "Round 10 invoice snapshots live under the record / line key `sv`"; "a 0% line with `sv.exempt` is exempt, without it nil-rated"; "check-ins are one row per day". |
| `docs/CA_REVIEW.md` | lead | SV items are added with this PRD; packages report changes as rows in their feature-doc section, folded in by the lead. |
| Round 9 overlap | lead | Expected shared files: `industry-packs.ts` (`PACK_IDS`, `PACK_TABS`), `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`, `SetupWizard.tsx`, `FeaturesPanel.tsx`, `invoice-defaults.ts` keys, `backup.ts` / `sync-engine.ts` rows, help files, `smoke.mjs`, `CA_REVIEW.md`, `pages/Pos.tsx`, `ItemsTable.tsx`, `paper-helpers.ts`, `label-sheet.ts`. All edits are append-only blocks or single lazy lines; the second to merge keeps both. |

### Storage summary

| Key / field | Package | Kind | Backed up | Synced | Audited | Right (`sv-registry`) |
|---|---|---|---|---|---|---|
| `service_settings` | A | object | yes | yes (singleton) | yes | `settings.manage` |
| `appointments` | A | table, dated `date` | yes | yes | yes | `doc.create` |
| `service_staff` | A | table | yes | yes | yes | `master.edit` |
| `commission_plans` | A | table | yes | yes | yes | `master.edit` |
| `staff_payouts` | A | table, dated | yes | yes | yes | `books.edit` |
| `payer_claims` (`CLM`) | A | table, dated, numbered | yes | yes | yes | `doc.create` |
| `clinic_settings` | B | object | yes | yes (singleton) | yes | `settings.manage` |
| `clinic_visits` (`OPD`) | B | table, dated, numbered | yes | yes | yes | `doc.create` |
| `admissions` (`IPD`) | B | table, dated `admit_date`, numbered | yes | yes | yes | `doc.create` |
| `lab_tests` | B | table | yes | yes | yes | `master.edit` |
| `lab_orders` (`LAB`) | B | table, dated, numbered | yes | yes | yes | `doc.create` |
| `member_plans` | C | table | yes | yes | yes | `master.edit` |
| `memberships` (`MEM`) | C | table, dated `start`, numbered | yes | yes | yes | `doc.create` |
| `checkins` | C | table, dated (one row per day) | yes | yes | yes | `doc.create` |
| `class_schedules` | C | table | yes | yes | yes | `master.edit` |
| `class_attendance` | C | table, dated | yes | yes | yes | `doc.create` |
| `workshop_settings` | D | object | yes | yes (singleton) | yes | `settings.manage` |
| `service_assets` | D | table | yes | yes | yes | `master.edit` |
| `labour_ops` | D | table | yes | yes | yes | `master.edit` |
| settings `service_kind` | A | additive | yes | yes | yes | — |
| record `sv`; line `sv`; payment `tip_staff` | A (sub-fields A–D) | additive | yes | yes | yes | — |
| item `sv_class`; client `dob`, `anniversary`, `patient`, `sv_insurer_invoice` | A / B / D | additive | yes | yes | yes | — |
| `doctors` fields (RT-B1), `service_jobs` fields (RT-D4), `Enrolment.class_id`, AMC `asset_ids` / visit `job_id`, `TimeEntry.job_id` | B / D / C / D / D | additive | yes | yes | yes | — |

No device-local key. No migration (everything is additive). Patient data is personal data under the DPDP Act 2023: it
stays on the device and in the user's own encrypted backups, like every other table (vault mode recommended in the
clinic checklist step).

---

## 7. E2E steps (production build, `tests/e2e/smoke.mjs`)

1. **R10-A**:
   - Fresh company → wizard → Services → *Salon / spa* → lands on `/time?tab=appointments`.
   - Add a stylist and two services; book an appointment by drag; mark arrived; *Bill* → the POS has both lines with the
     stylist; pay; the appointment shows *billed*.
   - Commission → statement shows the stylist's commission for the month.
   - A service item of class `beauty_9997` dated after 22 Sep 2025 suggests 5%; a purchase bill with ITC shows the caution.
   - Ctrl+K "appointment" finds Time → Appointments; F1 opens its help.
2. **R10-B**: Settings → service profile *Clinic*:
   - Register a patient (UHID shown); OPD token 1 for a doctor; bill consult (exempt) + a cosmetic peel (18%) to a
     walk-in → the preview title reads "Invoice-cum-Bill of Supply" and shows UHID and the doctor's reg. no.
   - GST → Nil / exempt shows the consult in the **exempt** column.
   - Lab: order a panel, enter a high value → report preview shows "H".
   - Admission with a ₹6,000 / day private room → the final bill has a 5% room line.
3. **R10-C**: *Gym*:
   - Sell a 6-month plan; freeze 20 days → end date moves by 20 days.
   - Check-in by member code shows "Active till …"; an expired member shows the renew prompt (warn).
   - Salon package of 6 sessions: redeem one at the POS → ₹0 line "Session 1 of 6".
   - Coaching: Fees → Batches shows the timetable; a refund for a student leaving after 3 of 10 months → credit note.
4. **R10-D**: *Vehicle workshop*:
   - New vehicle MH12AB1234; job card with odometer; estimate (pads + labour) approved by phone; bill → parts and labour
     lines at their own rates.
   - Insurance claim approved ₹42,000 of ₹50,000 → two invoices (insurer, owner) totalling the job.
   - Reminders shows the next service date.

---

## 8. Open questions — with the default the builders will use

The owner asked for no questions, so each one has a default that the packages implement. A CA answer later changes a dated
rule row or a setting default, never the design.

| # | Question | Default chosen | Why |
|---|---|---|---|
| 1 | Should existing `services` companies get a pack automatically? | **No.** `PACK_OF_TYPE` unchanged; a checklist step "Pick your kind of service". | The R5 invariant: existing companies see what they saw. |
| 2 | New business types or a sub-profile? | Sub-profile `service_kind` under `services` (the R8 `trade_kind` / R9 `retail_kind` approach). | Zero shell bytes; one wizard card. |
| 3 | Where do the desks live? | Tabs on `/time` (every service profile keeps the `time` module); coaching views in the existing Fees tab on `/recurring`. Sidebar label "Time" unchanged. | No `PACK_ROUTES` change, no first-paint bytes; Ctrl+K and the landing page make them findable. |
| 4 | Staff master: payroll employees or a separate list? | Separate `service_staff` with an optional `employee_id` link. | Payroll is owner-only and confidential; receptionists need names, not salaries. |
| 5 | Commission payout | Employee → payroll adjustment (incentive); freelance → vendor bill with TDS (194J doctors, 194H others, opt-in); no payroll module → journal. | Uses existing engines; TDS section is a CA call (SV16). |
| 6 | Commission base | Line taxable value (GST excluded); package redemption earns on price ÷ sessions; package sale earns 0 by default. | No double commission; common salon practice. |
| 7 | Tips | Off by default; when on, a liability "Tips payable to staff", outside the invoice, paid with the payout. | Voluntary tips passed through are arguably not our consideration (SV16). |
| 8 | Overlapping appointments | Warning, never a block. | Double booking is normal (assistants, processing time). |
| 9 | Mixed exempt + taxable bill | Per-line `sv.exempt`; Rule 46A "Invoice-cum-Bill of Supply" title for GSTIN-less recipients (clinic / lab / coaching default on); split into two documents for registered recipients. | Rule 46A; keeps R5-C's two-document default for B2B (SV5, I21). |
| 10 | 0% lines without the new key | Stay nil-rated (unchanged). | No silent change to past returns. |
| 11 | Salon / gym rate | Class `beauty_9997` / `fitness_9997`: 18% with ITC before 22 Sep 2025, 5% no ITC from; suggested, never forced over a typed rate. | N 15/2025-CT(R) (SV11). |
| 12 | ITC for no-ITC services | Caution on purchase bills + the R5-C2 `itc_use` tag; Rule 42 treats 5%-no-ITC turnover as exempt-like (setting, default on). | Conservative reading (SV12). |
| 13 | Composition 6% vs 5% | One-time notice; nothing automatic. | Owner's choice; registration change is a portal act (SV13). |
| 14 | Hospital room test | Room charge alone, per day per patient, > ₹5,000 → 5% no ITC (SAC 9993) from 18 Jul 2022; ICU / CCU / ICCU / NICU always exempt; room-day by midnight census. | N 03/2022 + 04/2022-CT(R) (SV3). |
| 15 | In-patient medicines and food | Exempt as part of the composite health care supply; OPD pharmacy at goods rates. | Circular 32/06/2018 as recalled (SV4). |
| 16 | Cosmetic procedures | Item class `health_cosmetic` at the item's rate (default 18%); the user decides per procedure. | Para 2(zg) exclusion; reconstruction after injury stays exempt (SV2). |
| 17 | Clinic registration on bills | Optional fields; printed when set; doctor's registration no. printed on consultation receipts. | CEA rules / NMC regulations (SV7). |
| 18 | Referral payments to doctors | Not recorded unless switched on; then booked to "Referral fees — disallowable (Sec 37)" with a permanent caution; never a "commission" ledger. | Apex Laboratories (SC 2022), IMC / NMC rules (SV8); recording beats off-book cash. |
| 19 | Visiting consultants | Fee-share statement → vendor bill with 194J (10%, ₹50,000 threshold from 1 Apr 2025). | Existing TDS engine (SV8). |
| 20 | Lab reference ranges | By sex and age band from the test master; H / L / critical flags; amended reports keep history. | Common LIS practice; no clinical judgment in the app. |
| 21 | EMR / prescriptions | Not built; free-text visit note never printed. | Clinical scope, DPDP and ABDM obligations; non-goal. |
| 22 | Membership GST timing | Whole price invoiced at sale (taxed then); no deferral of GST; optional deferral of **income** in the books only. | Sec 13 time of supply (SV14). |
| 23 | Freeze / upgrade / transfer | Freeze extends the end date (fee optional); upgrade = unused value pro rata by days (or sessions) credited on one invoice for the difference (credit-note mode optional); transfer with fee. | Gym-tool practice; simplest GST trail (SV14). |
| 24 | Unused package sessions | Forfeited at expiry, no GST event; report of forfeited value. | Value already taxed at sale (SV15). |
| 25 | Wallet bonus | A discount on later use, never cash; GST on the top-up as an advance for services. | G3 rule; Sec 15(3)(a) on use (SV15). |
| 26 | Check-in gate | Fitness `warn`, others `off`; `block` available. | Front desks override in practice. |
| 27 | Check-in storage | One row per day with entries. | Keeps sync / backup small (~365 rows a year). |
| 28 | Coaching refund | Pro rata by days for the unused period (+ hostel / mess), non-refundable heads as set on the plan, due in 10 days; credit note reverses tax on the taxable part. | MoE guidelines 2024 as reported (SV18). |
| 29 | Workshop billing | Parts and labour as separate lines at their own rates (labour 18%, SAC 998714 for vehicles); one price → service line 18%. | AAR rulings: separately priced = separate supplies (SV20). |
| 30 | Insurance claims | Cashless → two invoices (insurer for the approved amount, owner for the rest); reimbursement → one invoice to the owner unless the insurer is set to "invoice to insurer". | Circular 217/11/2024 (SV22). |
| 31 | Depreciation table | Editable defaults (rubber / plastic 50%, fibre 30%, glass 0%, metal by age) marked "insurer practice, verify". | Policy terms, not statute. |
| 32 | Parts issued before billing | Stock journal to a `wip` "Jobs in progress" godown; moved out on billing. | Stock stays true while cars wait for days. |
| 33 | Phones vs vehicles job engine | One engine (RT-D4); SV-D adds fields and views; SV-D waits for RT-D. | No fork; the brief's coordination rule. |
| 34 | RT-D4's SAC 998714 for phone repair | Flag to the lead: probably 998716 (telecom) / 998713 (computers); SV-D's `REPAIR_SAC_RULES` lists the codes per asset kind. | SAC list (SV20). |
| 35 | Budget | Stay inside +45 kB; the lead may raise total to 2900 kB with the stated reason only if Rounds 9 + 10 overrun after trimming. | First paint is the hard limit; total JS is precache. |
