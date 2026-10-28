# PRD — Round 17: security, facility-management and manpower-supply agencies (guarding, housekeeping, contract staffing)

Status: draft for build · Drafted 2026-10-28 · Baseline: branch `claude/elegant-cannon-cwapiv` at `0953a61`. Merged on
the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–18, Rounds 7–16 (R16-A … R16-D). No other round is being built in
parallel.

Companion documents:
- `docs/CA_REVIEW.md` §17: the CA items **MP1–MP32** (§9 of this PRD). The lead copies them there when the PRD is
  accepted. `MP` ("manpower") is a new prefix. The prefixes already used are `A B C D G H I M P Q R S T X AC AG CN HT MF
  PF PS QA RT SV TR TV` (`docs/CA_REVIEW.md` rows on `0953a61`: AC, AG, CN, G, HT, I, MF, P, PF, PS, RT, SV, T, TR, TV,
  X; the rest appear in older text). `MP` cannot collide with `M…` or `P…` ids because every CA-id regex needs a digit
  right after the prefix.
- Sources: §2.8. **P** = primary text read this round (file downloaded and read, or page fetched), **S** = secondary
  source (press, blog, review site, search-result extract), **V** = vendor's own claim.

Every item follows `AGENTS.md`:
- **Local-first and serverless.** No EPFO / ESIC / Shram Suvidha / PSARA-portal / biometric-device / GPS-patrol / GST /
  TRACES call. The app reads files the user picks (a biometric export, a challan PDF as an attachment) and uses
  `wa.me` / `mailto:` links only.
- **Styling.** Vanilla CSS Modules with tokens. Templates use the `accent` variable only (Critical Rule 5).
- **Invoice snapshots never change.** Everything a manpower bill prints is snapshotted on the document (`mp`).
- **Numbering.** Indian-FY numbering. Round 17 adds **no series** (arrears go out as debit notes in the existing `DBN`
  series, §4 D1).
- **Dates.** Bare dates are parsed as local days. A muster month is `YYYY-MM`.
- **Statutory values.** Date-keyed and append-only, in a lazy rule file. A row is `verified: true` only when its value
  was read in a primary text this round (the R15 / R16 rule). A recommendation or a draft rule is never a rule row.
- **Outputs are working papers.** GST, RCM, TDS, minimum-wage and labour-code outputs carry "verify with your CA"
  (Critical Rule 10). Labour-law checks are hints, never blocks.

---

## 1. Problem statement

### 1.1 Which segment is left

Sixteen rounds have covered the large SME verticals. The lead listed six remaining candidates; §2.2 scores them. The
short version:

| Candidate | What the app already has | Left over | Verdict |
|---|---|---|---|
| Logistics: courier, freight forwarders, CHA, 3PL | R5-B consignment notes, GTA options, vehicles, trips; `freight-fx`; e-Way desk; R8 agency lots; R15 pure agent | Forwarder house-bill margin, CHA disbursement accounts, Sec 13(9) POS, 3PL storage billing | Partial overlap; several sub-trades with different documents. Later round |
| Automobile dealers / service centres | R9 serial desk (VIN / engine no.), `used` godown + margin scheme, R10 workshop job cards + claims, 206C(1F), GST 2.0 rows | OEM incentives, RTO / insurance pass-through, demo vehicles | Mostly covered (R15 §1.1 agreed) |
| Co-operative housing societies / RWAs | NPO funds (R5-C), leases, recurring | Member bills, ₹7,500 rule, sinking / repair funds, non-occupancy charges, state bye-laws | **Large, not served by the app.** Distinct statute per State (co-op Acts, model bye-laws); members are not customers; not an SME business. **Recommended for Round 18** |
| SaaS / subscription and usage billing | Recurring, deferrals (R2-C2), R14 `svcexport` (EDF, platforms, Rule 89(4)) | Proration, metering, MRR | Small user count in this app's market; partial |
| Education beyond fees (coaching, hostels, transport) | R5-C fee plans / runs, R10 `coaching` kind, exempt column, `sv-coaching-refund.ts` | Hostel rooms, bus routes | Little left |
| **Security / facility-management / manpower-supply agencies** | Payroll (PF / ESI / PT / bonus / gratuity / ECR / attendance), R11 CN-D2 three-line manpower bill (construction only), R15-A4 "manpower is work" hint on the payer side, outward RCM flag | **Everything that links people to clients:** sites and posts, the monthly duty register, billing from it, RCM for security services, the school exemption, the client's compliance pack, site profitability, back-dated wage-revision arrears, TDS receivable from clients | **Chosen** |

**Why this segment.**
1. **Size.** 21,835 private security agency licences were valid on 30 Nov 2023 (up from 16,427 in Jan 2022), per Home
   Ministry answers in Parliament as reported (S; the MHA PDFs were listed but did not download, MP31). The Indian
   Staffing Federation puts the formal flexi workforce at about **7.2 million in FY25**, growing ≈ 10–12 % a year (S, two
   sources). Housekeeping / facility-management contractors and small labour contractors are far more numerous and
   uncounted. Almost every one is an SME billing monthly, with a payroll larger than its margin.
2. **The gap is the link, and the leaders do not close it.** Tally Prime sells a "GST software for security services"
   page (V) and has payroll with attendance (V). Neither ties a guard's duties at a site to the client's bill or to the
   site's PF / ESI proof. Zoho Payroll syncs salary cost to Zoho Books (V) but has no site billing. Vyapar /
   myBillBook / Busy / Marg offer an invoice format and, at most, simple payroll. The vertical tools (for example
   INDPayroll for security agencies, V) are cloud payroll / patrol systems that stop at "man-day billing" and do not
   keep the books. Agencies therefore run attendance in Excel, payroll in one tool and invoices plus books in Tally.
3. **The app already holds most of the hard parts.** Payroll with PF / ESI / PT / bonus / gratuity / ECR, recurring,
   cost centres, receivables, the TDS register, debit notes, the outward RCM flag. Round 17 is the glue. That fits a
   ≤ 40 kB round.
4. **2025–26 changed the rules for these businesses.**
   - **Labour Codes** in force from **21 Nov 2025** (P, PIB): national floor wage, equal treatment of fixed-term
     employees with gratuity after **one year**, overtime at **at least double** the normal rate, the principal employer
     providing health and social-security benefits to contract workers, single registration / licence / return. Clients
     now ask harder for the contractor's monthly proof.
   - **Finance Act 2026:** "supply of manpower to a person to work under his supervision, control or direction" becomes
     "work" (Sec 402(47)(f)) from **1 Apr 2026**, so clients deduct contractor TDS at **1 % / 2 %** (Sec 393(1) Table Sl.
     6(i)) instead of the 2 % / 10 % fees limb (P, Finance Bill 2026 cl. 78 and Memorandum). An agency's TDS
     receivable changes section mid-way through its clients' records.
   - **GST RCM on security services** (N 29/2018-CT(R), from 1 Jan 2019, P): a supplier **other than a body corporate**
     supplying security personnel to a **registered** person does not charge GST; the client pays. Proprietors and
     partnerships, the majority of small agencies, bill under RCM to registered clients and under forward charge to
     unregistered ones (housing societies, shops). Nothing in the app chooses this.

### 1.2 What an agency cannot do in the app today

Checked against the code at `0953a61` (§2.6):

1. **No site / post / contract.** A client signs for "4 guards (12 h) and 1 supervisor at Sunrise Towers at ₹21,000 /
   guard / month, 26 duties, service charge 10 %". There is nowhere to keep the posts, the billing basis or the rate.
   Cost centres exist but carry no client, posts or rates.
2. **No duty register (muster).** Payroll attendance is **one row per employee per month with loss-of-pay days**
   (`AttendanceRow.lop`). A guard who did 22 duties at one site and 8 relief duties at another, plus 30 OT hours, cannot
   be recorded per site. Billing and payroll therefore come from two different spreadsheets and disagree.
3. **No bill from duties.** CN-D2 `manpowerBill` (construction) makes a three-line draft from three typed totals. There
   is no per-post billing (rate × duties, pro-rata of a monthly rate, or cost-plus wages + statutory + service charge),
   no duty annexure and no consolidated bill per client.
4. **No RCM decision for security services.** `reverse_charge` is a manual tick. Nothing knows that a proprietor's guard
   services to a registered client are under entry 14 of N 13/2017-CT(R) (as amended by N 29/2018), that the same
   services to an unregistered RWA are forward charge, or that the entry excludes TDS-only government registrations
   and composition taxpayers (P).
5. **No school exemption.** Security, cleaning and housekeeping performed **in** a pre-school to higher-secondary
   institution are exempt under N 12/2017-CT(R) Sl. 66(b)(iii) (P, 2017 text). The editor offers no such line class.
6. **No compliance pack for the client.** Clients withhold payment until the agency shows that month's PF ECR / TRRN,
   ESI challan and wage register for **the staff deployed at their site**. Payroll can produce the whole company's ECR
   only, not the site's share.
7. **No site profitability.** Revenue per site minus that site's wages, employer PF / ESI / bonus, relievers, uniforms
   and consumables. Agencies lose money on sites without knowing it.
8. **No arrears billing.** Minimum wages (central sphere VDA, and most States) are revised **1 Apr and 1 Oct** and often
   notified late (S). Contracts pass the increase to the client from the effective date, so the agency must bill
   back-dated differences for every site and month. Today that is hand-typed.
9. **No TDS-receivable view by client with the 2026 section change**, and no licence / contract-renewal reminders
   (PSARA licence per State, OSH / contract-labour licence, contract end dates).

### 1.3 How the manpower profile switches on (no clutter for others)

- **No new `BusinessType`.** `shop-mode.ts` (first paint) is untouched.
  - The R10 service picker gets one more kind, **`manpower`**: `SERVICE_KINDS` in `shop-presets.ts` (lazy) and the
    `ServiceKind` union in `types/services-r10.ts` (type only, zero bytes).
  - Under it, the additive settings field **`manpower_kind`** (the R12 `agri_kind` … R15 `travel_kind` approach):

  | `manpower_kind` | Who | Packs turned on | Lands on | Why |
  |---|---|---|---|---|
  | `security` | Private security agency (PSARA licensee): guards, supervisors, gunmen, bouncers | `manpower`, `security` | `/time?tab=deploy&view=sites` | Posts and shifts, duty register, RCM entry 14, PSARA licences |
  | `facility` | Housekeeping / facility management / pantry / gardening contractor | `manpower` | `/time?tab=deploy&view=sites` | Posts, duty register, consumables per site, school exemption |
  | `staffing` | Contract / temporary staffing firm (pay-rolling, deputation) | `manpower` | `/time?tab=deploy&view=muster` | Cost-plus billing, service charge, compliance pack |
  | `labour` | Labour contractor outside construction (loading, factory helpers, drivers on deputation) | `manpower` | `/time?tab=deploy&view=muster` | Duty / man-day billing, OSH / contract-labour licence |
  | `other` | Any other manpower supply | `manpower` | `/time?tab=deploy` | Shared core only |

  A construction labour contractor keeps R11 CN-D2; both can be on at once (packs are a union).
- **Two new packs** in `industry-packs.ts` (lazy; `PackId` is a type, zero bytes): `manpower` and `security`.
  `PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE` and `PACK_ROUTES` are unchanged.
- **Placement: one desk, never a new route or sidebar item.**
  - One new row in `TIME_TABS` (`page-tabs.ts`): `{ id: 'deploy', pack: 'manpower', alsoPacks: ['security'] }`.
  - The desk `components/manpower/DeployDesk.tsx` is mounted lazily from `Time.tsx` by an `import.meta.glob` over
    `components/manpower/*Desk.tsx` (the R14 / R15 pattern).
  - **Six views in total**, in `&view=`: `sites` (A), `muster` and `bills` (B), `compliance` and `profit` (C),
    `statutory` (D: arrears, TDS receivable, licences).
- Settings → Features shows a **"Manpower profile"** row for every `services` company (and "Custom"). Turning a pack
  off deletes nothing.
- The **manpower paper** (R17-A4) is not pack-gated. It prints whenever a document carries the `mp` snapshot.
- **Payroll stays where it is.** The desk writes attendance through the payroll store's existing `saveAttendance`
  (B2) and reads finalised runs (C1); the Payroll page gets no new tab.

### 1.4 Budgets the round must respect

Measured by the PRD author on `0953a61` (`npx vite build` + `node scripts/check-bundle-size.mjs`, gzip -9, KiB, 7.1 s
build, 1,014 JS files):

| Budget | Now | Limit | Headroom | Round 17 share |
|---|---|---|---|---|
| Initial JS (first paint) | **182.1 kB** | 185 kB | 2.9 kB | **0** (the `mp` record-key token lands in the lazy `invoice-defaults` chunk, which is not an initial file on `0953a61`; the measured value must stay **182.1**) |
| Entry chunk | 88.1 kB | 100 kB | 11.9 kB | 0 |
| Core precache (English) | **3,103.0 kB** | 3,300 kB | 196.9 kB | **≤ 40 kB gross for the whole round** (A ≤ 11, B ≤ 12, C ≤ 9, D ≤ 7; 1 kB reserve held by the lead) |
| Hindi pack | 340.6 kB | 400 kB | 59.4 kB | ≤ 8 kB (`lang-hi-manpower` family pack) |
| Hindi left in English chunks | 21.3 kB | 36 kB | 14.7 kB | **0** (every new `defineArea(en, hi)` passes a literal Hindi object, so `vite-hi-split.mjs` moves it) |
| `lazy-leaves` | 16.3 kB | 20 kB | 3.7 kB | ≤ 0.5 kB (new leaves should land in `f-manpower`, not here) |

Calibration from the last rounds (English only, after the R16-A Hindi split):
- R16-C wired five engines that already existed: **+5.3 kB core**. New engines with views cost more.
- R15-B (four items, Hindi then inside) measured +17.0 kB against a 14 kB cap; R15-C +11.0 (cap 11); R15-D +11.1
  (cap 9). English share ≈ 70–75 %.
- So **≈ 2.5–3 kB English per item with a view** and **≈ 1 kB per engine-only item**. Round 17 plans **15 items** inside
  40 kB with a pre-ranked cut list per package (§3). A package that reaches its cap cuts; it does not ask for more.

Rules:
- **First paint.** Nothing. `store/invoice-defaults.ts` (where the `mp` token goes), `industry-packs.ts`, `page-tabs.ts`,
  `Time.tsx`, `TemplateEngine.tsx` and `NotificationBell.tsx` are all lazy chunks on `0953a61` (checked in
  `build-meta/chunks.json`: the four initial files are `index`, `rolldown-runtime`, `vendor-react`, `vendor-ui`). No `PACK_ROUTES`, `PACK_OF_TYPE`, `TABLE_ACTIONS`, `WATCHED_TABLES`, `no-cash.ts`, `tax-rules.ts`, `tds-rules.ts`,
  `shop-mode.ts`, `dates.ts` or shell edit. Any new lucide icon is refused (§1.5).
- **Family chunk group.** A adds **one row** to `vite.config.ts`:
  `safeFamilyGroup(graph, 'f-manpower', familyRe('manpower', 'manpower-rules', 'manpower-r17'), 12)`
  and the name to `tests/bundle-config.test.ts`. The group then captures `src/lib/manpower/**`,
  `src/lib/manpower-rules.ts` and `src/i18n/areas/manpower-r17*.ts` (not `-pick` areas, which the wizard imports).
  - A module joins the group only if every static import is first paint, vendor, or another safe family member
    (`scripts/vite-safe-groups.mjs`). So **pure engines in `src/lib/manpower/` import only first-paint modules
    (`storage`, `invoice-calc`, `tax-rules` `ruleAt`, `dates`, `access`, `localDb` …) and each other**.
  - Modules that must reach shared lazy code (payroll store, `tds-register.ts`, `transport-works-rules.ts`
    `GST_TDS_51_RULES`, `cn-plant-hire.ts` `draftInvoice`, R14 `ps-tds-recv.ts`) are **bridge modules** named
    `mp-*-io.ts`. They stay outside the group by design, are few (≤ 4), and the engines take their data as arguments.
  - After each package, `build-meta/chunks.json` must show the `f-manpower` chunk holding every engine and rule module
    (a test in `tests/mp-rules.test.ts` reads the family regex; the size note in `docs/features/manpower-r17.md` lists
    the chunk).
- **Hindi.** One string area per package, each `defineArea(en, hi)` with a **literal** Hindi object (no spread, no
  variable): `manpower-r17a.ts` … `manpower-r17d.ts`, ≤ 1.1 kB gz English each. Words shared by packages (site, post,
  duty, muster, shift, reliever, service charge, client, month, compliance) live **once** in `manpower-r17a.ts`. The
  Hindi split puts them in `lang-hi-manpower` (family pack by file prefix).
- **Help** ≤ 160 characters per topic per language; statutory detail by CA id (`ca: ['MP1']`).
- **Rule data is a chunk.** Statutory values go in **`src/lib/manpower-rules.ts`** (new). It is imported only by lazy
  manpower modules, never by `tax-rules.ts`, `tds-rules.ts`, `shop-mode.ts` or the shell (`tests/mp-rules.test.ts`
  checks the import graph). Values that already live elsewhere stay there and are imported by bridges:
  - contractor TDS and the "manpower is work" label: `tds-rules.ts` (`MANPOWER_WORK_RULES`, R15-A4), `ita2025.ts`;
  - GST TDS u/s 51: `transport-works-rules.ts` (`GST_TDS_51_RULES`);
  - PF / ESI / PT / bonus / gratuity / OT: `payroll-rules.ts`.
- **No new shared components, no stubs.** Reuse `LinesGrid`, `ItemFilterBar`, `controls.module.css`, the R15 `useRun`
  pattern, `escHtml` (`html-esc.ts`) for every print window, `csv.ts` / `xlsx.ts` (dynamic) for the muster import,
  `draftInvoice` (CN-D2) for drafts, `documents` debit-note helpers for arrears.

### 1.5 Icons

Every lucide icon is in the first-paint `vendor-ui` chunk; reuse only. Usage counts in `src/**/*.tsx` on `0953a61`:
`ShieldCheck` 26, `Users` 10+, `ClipboardList` 9+, `CalendarDays` 11, `Scale` 11+, `Percent` 10+, `Building2` 8+,
`FileText`, `Receipt`, `Search`, `Banknote`, `AlertTriangle`. The desk uses `ShieldCheck` (security / regime chip),
`Users` (posts), `CalendarDays` (muster), `ClipboardList` (compliance), `Scale` (profit), `Percent` (statutory).
**`Shield` (bare), `HardHat`, `BadgeCheck`, `Fingerprint` and `UserCheck` are not imported anywhere and must not be
added.** A re-greps before its first commit and substitutes `ClipboardList` for any name that turns out not to be
imported.

### 1.6 Non-goals

- **Live connections.** EPFO ECR upload, ESIC portal, Shram Suvidha / unified labour return, PSARA portal, GeM,
  biometric devices, GPS / QR patrol apps, guard-tour systems, bank salary APIs. The app reads exported files.
- **HRMS.** Recruitment, police-verification workflow, training records beyond a licence date, rostering optimisation,
  shift swaps on a phone, guard self-service.
- **Wage tables.** The app stores **no** minimum-wage or VDA amounts in rule files: there are hundreds of State /
  zone / skill combinations, revised twice a year. The user types the revision that applies to each post (§4 C3, D1).
- **Labour-code computation changes.** The payroll engine's PF / ESI / gratuity bases are not changed this round. The
  50 % wage rule and the draft central rules are hints until the CA answers (MP16) and the rules are final.
- **Housing societies / RWAs as a vertical** (recommended for Round 18). They appear here only as **clients** (forward
  charge when unregistered, MP29).
- **Deferred:** biometric device formats beyond a CSV / XLSX template; patrol logs; guard-wise uniform stock (uniforms
  are a purchase tagged to the site).

---

## 2. Findings

### 2.1 What the leaders and vertical tools offer (research)

| Product | What it does for manpower agencies | Gap for this app's users | Source |
|---|---|---|---|
| Tally Prime | "GST software for security services": contract and shift-based billing, multiple client locations, GST / RCM / SAC handling; payroll with PF / ESI / PT; attendance with LOP | No duty register per site feeding both bill and payroll; site compliance pack and site P&L need TDL / Excel | V tallysolutions.com/gst-software/security-services, V tallysolutions.com/tallyprime/payroll |
| Zoho Books + Zoho Payroll | Payroll auto-syncs salary expense to Books | No site / post billing; no RCM decision for entry 14 | V (search extract, keka / petpooja comparisons, S) |
| Vyapar, myBillBook, Busy, Marg | Invoice formats; simple payroll in some | No muster, no cost-plus, no compliance pack | V vyaparapp.in invoice formats; S comparisons |
| INDPayroll (vertical) | Security-agency payroll, GPS / QR patrol check-ins, PSARA records; "without verified attendance per site, defending client invoices and man-day billing becomes a monthly argument" | Payroll-first cloud tool; no books, GST returns or TDS receivable | V indpayroll.com/industries/security-services |
| Society apps (MyGate, ADDA, NoBrokerHood) | Serve the *clients* (RWAs); bill members | Not for agencies | V (search extracts) |

### 2.2 Candidate segments scored

Value 1–5 (5 = a large SME segment that meets the gap every month, with nothing in the app). Effort S = 1, M = 2,
L = 3. Score = value ÷ effort.

| Candidate | Size (as reported) | Already in the app | Value | Effort | Score |
|---|---|---|---|---|---|
| **Security / FM / manpower agencies** | 21,835 PSARA licences (Nov 2023, S); 7.2 M formal flexi workers FY25 (S); FM / housekeeping uncounted | Payroll, CN-D2 bill, RCM flag, TDS register | **5** | M | **2.5** |
| Housing societies / RWAs | Very many (Maharashtra alone, as commonly reported, > 1 lakh co-op housing societies; not verified) | NPO funds, recurring | 4 | L | 1.3 |
| Logistics (forwarders, CHA, 3PL) | Many | R5-B, freight-fx, e-Way | 3 | M | 1.5 |
| Auto dealers / service | FADA networks | R9 / R10 / 206C(1F) | 2 | M | 1.0 |
| SaaS / usage billing | Growing, small in this market | Recurring, deferrals, svcexport | 2 | M | 1.0 |
| Education beyond fees | — | R5-C, R10 coaching | 1 | — | — |

### 2.3 Anatomy of an agency's month (every element needs a place)

| # | Element | Doc / screen | Today | → |
|---|---|---|---|---|
| 1 | Site (client location), its posts (Guard 12 h × 4, Supervisor × 1), billing basis and rate, contract dates | Site file, invoice header | — | A2 |
| 2 | Duty register: per employee per site per month — duties (8 h / 12 h), OT hours, relief duties, double duties | Muster | Payroll LOP only | B1 |
| 3 | Payroll attendance derived from all sites (LOP = payable days − duties; extra duties and OT as units) | Payroll | Typed | B2 |
| 4 | Bill per site or per client: post lines (rate × duties, pro-rata monthly rate, or cost-plus), SAC by post, service charge | Tax invoice + duty annexure | Three typed totals (CN-D2) | B3 |
| 5 | GST regime: forward 18 % / RCM entry 14 (proprietor, registered client) / exempt Sl. 66 (school) / manual exempt | Invoice declaration, GSTR-1 RCM flag | Manual tick | A3 |
| 6 | Client's TDS: contractor 1 % / 2 % from 1 Apr 2026 (earlier 194C or 194J as the client chose) | Bill footer (expected), receivable | Payer-side hint only (R15-A4) | B4, D2 |
| 7 | Site compliance pack: ECR / TRRN, ESI challan, wage register extract, bonus / leave reserve for the site's staff | Annexure for the client | Whole-company ECR | C1 |
| 8 | Site P&L: billing − wages − employer PF / ESI / bonus − relievers − uniforms / consumables | Desk | — | C2 |
| 9 | Minimum-wage check: wage paid per duty vs the revision typed for the post's zone / skill; OT at ≥ 2×; FTE gratuity after one year | Hints | — | C3 |
| 10 | Back-dated wage revision → arrears per site per month → debit note to the client | Debit note + annexure | Hand-typed | D1 |
| 11 | Licences: PSARA per State, OSH / contract-labour licence, contract end; reminders | Desk + notification bell | — | D3 |

### 2.4 Statutory rules (as understood; every row is a CA item)

`verified` follows the rule in the header: **true only when the value was read in a primary text this round**.

| # | Rule | Value used by the app | From | Source read | verified | CA |
|---|---|---|---|---|---|---|
| 1 | GST rate on support services other than tour operators (Heading 9985) | 9 % CGST + 9 % SGST (18 % IGST) | 2017-07-01 | **P** N 11/2017-CT(R) Sl. 23(ii) (2017 text, gstcouncil.gov.in PDF) | true (2017 row); "unchanged after 22 Sep 2025" **false** | MP4 |
| 2 | SAC: 998513 contract staffing, 998514 temporary staffing, 998515 pay-rolling, 998519 other labour supply, 998525 guard services, 998529 other security, 998533 general cleaning, 998539 other cleaning | As listed, suggested per post | 2017-07-01 | **P** Annexure to N 11/2017-CT(R) (scheme of classification, rows 404–429) | true | MP5 |
| 3 | RCM on security services: "services provided by way of supply of security personnel" by **any person other than a body corporate** to a **registered person**; not for (a) Central / State / UT departments, local authorities, governmental agencies registered only to deduct TDS u/s 51, (b) a registered person paying tax u/s 10 (composition) | Regime `rcm` | 2019-01-01 | **P** N 29/2018-CT(R) dated 31 Dec 2018, entry 14 and para 2 (gstcouncil.gov.in PDF); **S** studycafe, taxguru (agree) | true | MP1 |
| 4 | "Body corporate" = Companies Act 2013 Sec 2(11); an LLP treated as body corporate (Haryana AAR); co-op societies / trusts / societies not | `company` and `llp` → forward charge; others → RCM | 2019-01-01 | **S** livelaw (AAR), taxtmi forum (Jul 2026), studycafe | **false** | MP2 |
| 5 | Exemption: services to an educational institution by way of "security or cleaning or house-keeping services performed in such educational institution", only for institutions providing pre-school education and education up to higher secondary or equivalent | Regime `exempt66` (Table 8 exempt column via the R10 line key `sv.exempt`) | 2017-07-01 | **P** N 12/2017-CT(R) Sl. 66(b)(iii) and proviso (2017 text); **P** AAR order (gstcouncil.gov.in, IIITDM case) applying it | true (2017 text); amendments after 2017 not read | MP7 |
| 6 | Exemption: pure services to Government / local authority for Panchayat / Municipality functions (Art. 243G / 243W) | Not automatic; manual exempt with reason | 2017-07-01 | **P** N 12/2017-CT(R) Sl. 3 (2017 text); later narrowing (Governmental authority) **not read** | false (current scope) | MP8 |
| 7 | Registration exemption for persons making only supplies on which the whole tax is payable by the recipient under RCM | Note on the profile when every client is RCM | 2017-06-22 | **P** N 5/2017-CT dated 19 Jun 2017; **S** teachoo | true | MP9 |
| 8 | Supply of manpower is "work": Sec 402(47)(f) "supply of manpower to a person to work under his supervision, control or direction"; TDS under Sec 393(1) Table Sl. 6(i) 1 % (individual / HUF) / 2 % (others) or Sl. 6(ii) | Expected TDS on bills from 2026-04-01 | 2026-04-01 | **P** Finance Bill 2026 cl. 78 (text), **P** Memorandum "Application of TDS on supply of manpower"; **S** studycafe, incorpx (agree). Enacted Act text **not read** (LiveLaw reports assent 30 Mar 2026, S) | **false** (existing `MANPOWER_WORK_RULES` row stays false) | MP14 |
| 9 | GST TDS u/s 51 by Government clients | Existing `GST_TDS_51_RULES` | existing | — (existing row) | existing | MP13 |
| 10 | Four Labour Codes in force | 21 Nov 2025 | 2025-11-21 | **P** PIB release 21 Nov 2025 ("made effective from 21st November 2025"); **S** EY alert | true | MP16 |
| 11 | Fixed-term employees: gratuity after one year of continuous service | 1 year (hint) | 2025-11-21 | **P** PIB 21 Nov 2025; **S** teamlease FAQ | true | MP19 |
| 12 | Overtime: consent-based, at least double the normal wage rate | ×2 (hint) | 2025-11-21 | **P** PIB 21 Nov 2025 | true | MP20 |
| 13 | Principal employer provides health and social-security benefits to contract workers | Compliance pack as evidence | 2025-11-21 | **P** PIB 21 Nov 2025 | true (statement); mechanics **false** | MP18 |
| 14 | "Wages" = basic + DA + retaining allowance; excluded allowances above **one-half** of all remuneration are added back | 0.5 (hint) | 2025-11-21 | **S** taxmann, KSandK (agree; the proviso allows another % by notification) | **false** | MP16 |
| 15 | Contract-labour applicability threshold 20 → **50** workers (OSH Code) | Licence reminder only when entered | 2025-11-21 | **S** EY alert, greytHR | **false** | MP17 |
| 16 | Central-sphere minimum-wage VDA revised 1 Apr and 1 Oct | Months 4 and 10 (reminder only) | — | **S** gconnect (CLC orders reproduced), Gulf News (Oct 2024) | **false** | MP22 |
| 17 | 57th GST Council: e-invoicing extended to RCM inward supplies from unregistered persons (AATO ≥ ₹5 crore) | Not a rule; pending note (R16-D4 list) | — | **P** PIB 8 Oct 2026 ¶18 (read in R16; re-read here from the saved copy); no security-specific change found | — (recommendation) | MP30 |

Not found this round: any 2025–26 amendment of entry 14 (searched; TMI forum of 30 Jul 2026 still applies the 2018
text, S); the outcome of the Delhi High Court petition by the Central Association of Private Security Industry against
the body-corporate exclusion (S, busy.in case-law page, MP2); a notified national floor-wage amount.

### 2.5 What changed in 2025–2026 for these businesses (and what the app holds today)

| Change | Effective | App today | → |
|---|---|---|---|
| Labour Codes in force (wages, OT ×2, FTE gratuity 1 yr, principal-employer duties, single licence) | 21 Nov 2025 | Payroll unchanged; CN-D2 cites the codes for withholds | C1, C3 hints; MP16–MP20 |
| Draft central rules under the codes pre-published | 30 Dec 2025 (S, Labour Ministry annual report as reported) | — | Watch (not rule rows) |
| Manpower = "work" for TDS | 1 Apr 2026 | Payer-side hint (`manpowerHint`) | B4, D2 (receivable side) |
| GST 2.0 rate changes | 22 Sep 2025 | Rows in `tax-rules.ts` | 9985 support services not changed as far as found (MP4) |
| 57th Council process reforms (refunds, late fee, RCM e-invoicing) | Recommended 8 Oct 2026 | R16-D4 pending list | D4 note only |

### 2.6 Verified against the code (`0953a61`)

| Area | Finding | File |
|---|---|---|
| Payroll employee | `Employee.cost_centre_id` (one home cost centre), PF / ESI / PT flags, UAN / ESI no. | `src/types/payroll.ts` |
| Attendance | `AttendanceRow { employee_id, month, lop, units? }`; `saveAttendance(month, rows)`; attendance types with units (`ot_hours` built in) | `src/types/payroll.ts`, `src/lib/payroll/store.ts:392` |
| Payroll reports | `pfEcrText`, `pfEcrRows`, `esiRows`, `attendanceRegisterRows`, `paySheetRows` over a whole run | `src/lib/payroll/reports.ts` |
| Manpower bill | `manpowerItems` / `manpowerBill`: three lines, SAC 998519, rate from `WORKS_CLASS_RULES` (construction) | `src/lib/construction/cn-labour-compliance.ts:64–76` |
| Draft builder | `draftInvoice(clientId, items, notes, date)` | `src/lib/construction/cn-plant-hire.ts:89` |
| Payer TDS hint | `MANPOWER_WORK_RULES` (2026-04-01, `verified: false`), `manpowerHint` | `src/lib/tds-rules.ts:297–320` |
| Outward RCM | `reverse_charge`, `rcm_tax_excluded`, `rcmTaxOf` | `src/types/invoice.ts:470`, `src/lib/rcm.ts` |
| Entity type | `EntityType = 'proprietorship' \| 'partnership' \| 'llp' \| 'company'` on `notes_to_accounts` (R14: "the firm form is the annual pack's entity type, never a second field") | `src/types/books-r2.ts:131` |
| Exempt column | R10 line key `sv.exempt` → Table 8 exempt / nil / non-GST | `src/types/services-r10.ts` |
| Debit notes | `doc_type: 'DEBIT_NOTE'`, series `DBN` | `src/types/invoice.ts:20, 89` |
| TDS receivable | `tds-register.ts` (Form 16A / 131 due dates); R14 `ps-tds-recv.ts` per-client expected TDS and chase list | `src/lib/tds-register.ts`, `src/lib/prof/ps-tds-recv.ts` |
| GST TDS | `GST_TDS_51_RULES` | `src/lib/transport-works-rules.ts:52` |
| Desk mounting | `TIME_TABS` rows with `pack` / `alsoPacks`; `import.meta.glob` for `components/prof/*Desk.tsx` and `components/travel/*Desk.tsx` | `src/pages/page-tabs.ts:118–141`, `src/pages/Time.tsx:72, 81` |
| Record keys | `R9_RECORD_KEYS = ['delivery', 'kyc', 'sv', ...R12…R15]` | `src/store/invoice-defaults.ts:183` |
| Family groups | nine `f-*` rows; `f-travel` = 7.0 kB gz, 11 modules | `vite.config.ts:66–77`, `build-meta/chunks.json` |
| Nothing for sites / musters / RCM entry 14 / Sl. 66 | grep for `security service`, `29/2018`, `muster` outside construction, `998525`: none | — |

### 2.7 Size measurements (`0953a61`)

| | Value |
|---|---|
| Initial JS | 182.1 kB (4 files: `index`, `rolldown-runtime`, `vendor-react`, `vendor-ui`) |
| Entry chunk | 88.1 kB |
| Core precache | 3,103.0 kB in 919 files (all JS 3,464.3 kB in 1,014 files, 95 language-pack files) |
| Hindi pack / regional pack | 340.6 / 20.7 kB |
| Hindi left in core | 21.3 kB |
| `lazy-leaves` | 16.3 kB |
| Family chunks | `f-agri` 16.5, `f-cn` 14.0, `f-hotel` 10.2, `f-mfg` 19.7, `f-prof` 18.9, `f-retail` 15.2, `f-services` 16.9, `f-trade` 13.4, `f-travel` 7.0 |

### 2.8 Sources

Accessed 28 Oct 2026.

**GST (primary first)**
- **P** N 29/2018-Central Tax (Rate), 31 Dec 2018 — https://gstcouncil.gov.in/sites/default/files/2024-05/download_2024-05-17t161051.835.pdf
  (downloaded and read: entry 14 text, provisos (i)(a)–(c) and (ii), para 2 "come into force on the 1st day of January,
  2019"); listing page https://gstcouncil.gov.in/node/4500
- **P** N 11/2017-Central Tax (Rate), 28 Jun 2017 — https://gstcouncil.gov.in/sites/default/files/2024-05/download_4.pdf
  (Sl. 23 Heading 9985: (i) tour operators 2.5; (ii) "Support services other than (i) above" 9) and its annexure
  https://gstcouncil.gov.in/sites/default/files/2024-05/notification11-cgst-annexure.pdf (SAC 998511–998539 read)
- **P** N 12/2017-Central Tax (Rate), 28 Jun 2017 — https://gstcouncil.gov.in/sites/default/files/2024-05/download_6_0.pdf
  (Sl. 3; Sl. 66(b)(iii) and proviso; Sl. 77 original ₹5,000) ; listing https://gstcouncil.gov.in/node/4433 ("last amended
  by 04/2024-CT(R)")
- **P** AAR order (IIITDM housekeeping; Sl. 3B / Sl. 66 not available) — https://gstcouncil.gov.in/sites/default/files/AAR/srinacss-aar_order.pdf
- **P** N 5/2017-Central Tax, 19 Jun 2017 — https://gstcouncil.gov.in/sites/default/files/2024-04/notfctn-5-central-tax-english.pdf
- **P** PIB, 57th GST Council, 8 Oct 2026 — https://www.pib.gov.in/PressReleasePage.aspx?PRID=2320934 (saved copy from
  R16 re-read: ¶5 RCM on waste and scrap, ¶18 e-invoicing; nothing on security or manpower)
- S RCM on security services — https://studycafe.in/rcm-on-security-services-applicable-with-effect-from-1-1-2019-49938.html ;
  https://taxguru.in/goods-and-service-tax/rcm-supply-security-services.html ; https://www.taxheal.com/gst-on-security-services-faqs.html
- S LLP as body corporate (AAR Haryana) — https://livelaw.in/news-updates/security-services-llp-registered-person-not-covered-rcm-aar-210272 ;
  https://www.taxtmi.com/forum/issue?id=118125 (30 Jul 2026) ; Delhi HC petition — https://busy.in/caselaw/central-association-of-private-security-industry-vs-department-of-revenue-and-others-delhi-high-court
- S N 5/2017 explained — https://www.teachoo.com/6588/2144/Seller-(Supplier)-of-Reverse-Charge-Exempted-from-Registration--Notifi/category/Latest-GST-Notification/

**Income tax**
- **P** Finance Bill 2026, clause 78 (Sec 402(47)(f)) and notes on clauses — https://www.indiabudget.gov.in/doc/Finance_Bill.pdf
  (saved copy re-read: "(f) supply of manpower to a person to work under his supervision, control or direction")
- **P** Memorandum explaining the Finance Bill 2026, "Application of TDS on supply of manpower" (Sl. 6(i) 1 % / 2 %,
  Sl. 6(iii) 2 % / 10 %, effective 1 Apr 2026, Clause 78) — https://www.indiabudget.gov.in/doc/memo.pdf
- S https://studycafe.in/budget-2026-manpower-supply-now-treated-as-contractual-work-for-tds-purposes-408799.html ;
  https://www.incorpx.io/blog/manpower-supply-tds-work-definition-2026 ; assent — https://www.livelawbiz.com/amp/top-stories/union-budget-central-govt-notifies-finance-act-528353 ;
  Budget FAQ (cites "402(27)"; 403 on download) — https://incometaxindia.gov.in/Documents/Budget2026/FAQs-Budget-2026.pdf

**Labour**
- **P** PIB, "Government Makes the Four Labour Codes effective …", 21 Nov 2025 — https://www.pib.gov.in/PressReleasePage.aspx?PRID=2192463
  (fetched: effective date; FTE gratuity after one year; principal employer and contract workers; double OT; floor
  wage; single registration / licence / return)
- S EY alert — https://www.ey.com/content/dam/ey-unified-site/ey-com/en-in/alerts-hub/2025/11/new-labour-codes-implemented-across-the-country-effective-21-november-2025.pdf ;
  greytHR — https://www.greythr.com/blog/labour-codes-2025/ ; TeamLease FAQ — https://group.teamlease.com/new-labour-laws-india-2025/
- S 50 % wage rule — https://www.taxmann.com/post/blog/definition-of-wages-section-2y-code-on-wages-50-percent-rule/ ;
  https://ksandk.com/labour-employment/50-wage-rule-labour-codes-salary-pf-gratuity/
- S VDA revisions — https://www.gconnect.in/orders-in-brief/pay-allowances/allowance-orders-in-brief/vda-minimum-wages-watch-ward.html ;
  https://gulfnews.com/world/asia/india/india-increases-minimum-wage-rates-for-workers-1.1727367427915

**Market and products**
- S PSARA licences (MHA answers as reported) — search extracts of https://www.mha.gov.in/MHA1/Par2017/pdfs/par2022-pdfs/RS02022022/11.pdf
  (16,427 on 28 Jan 2022) and https://www.mha.gov.in/MHA1/Par2017/pdfs/par2023-pdfs/RS05122023/303.pdf (21,835 on
  30 Nov 2023); both returned HTML on download, so **not read**
- S Flexi staffing — https://www.dtnext.in/news/business/indias-flexi-staffing-industry-grew-by-97-pc-in-fy25-added-139-lakh-new-jobs-report-840132 ;
  https://www.staffingindustry.com/news/global-daily-news/indias-staffing-industry-to-surpass-9-million-by-fy27
- V https://tallysolutions.com/gst-software/security-services/ ; https://tallysolutions.com/tallyprime/payroll/ ;
  https://www.indpayroll.com/industries/security-services ; https://mygate.com/blog/housing-society/top-housing-society-accounting-software-in-india/ ;
  https://ind.adda.io/society-billing-software

---

## 3. Ranked list: what to build now

Value 1–5. Effort S = 1, M = 2, L = 3. Score = value ÷ effort. **Cut** = the order a package drops items when it hits
its size cap (1 = first to go; "never" items stay).

| Rank | Id | Gap | Who | Value | Effort | Score | Pkg | Cut |
|---|---|---|---|---|---|---|---|---|
| 1 | A1 | Manpower profile (picker, packs, desk tab, checklist, demo) + build plumbing (family group, `MP` regexes, registry, rules, `mp` key) | all | 5 | S | 5.0 | A | never |
| 2 | A3 | GST regime engine: forward 18 % / RCM entry 14 / exempt Sl. 66 / manual exempt, declarations | all | 5 | S | 5.0 | A | never |
| 3 | A2 | Sites, posts and contracts (site = cost centre `CostCentre.mp`) | all | 5 | M | 2.5 | A | 2 (drop contract escalation note and the post "skill / zone" fields; keep posts + rates) |
| 4 | B1 | Duty register (muster) per site × month, CSV / XLSX import | all | 5 | M | 2.5 | B | 3 (drop the import; keep the grid with "copy last month") |
| 5 | B3 | Bill from the muster: per site / per client; rate, pro-rata, duty and cost-plus bases; duty annexure | all | 5 | M | 2.5 | B | never |
| 6 | A4 | Manpower paper (`mp` block: site, month, regime declaration, duty annexure) | all | 4 | S | 4.0 | A | 1 (drop the annexure's per-employee page; keep the post summary) |
| 7 | B2 | Muster → payroll attendance (LOP, extra duties, OT units) | all | 4 | S | 4.0 | B | 2 (drop extra-duty units; keep LOP + OT) |
| 8 | B4 | Expected client TDS on the bill (1 % / 2 % from 2026-04-01) + GST TDS u/s 51 hint | all | 3 | S | 3.0 | B | 1 |
| 9 | C1 | Client compliance pack per site × month (PF / ESI share, TRRN / challan, wage-register extract) | all | 5 | M | 2.5 | C | never |
| 10 | C2 | Site P&L (billing − wages − employer statutory − uniforms / consumables) | all | 4 | M | 2.0 | C | 2 (drop the 12-month trend; keep the month) |
| 11 | C3 | Minimum-wage / labour-code checks (typed revisions, OT ×2, FTE gratuity, 50 % hint) | all | 3 | S | 3.0 | C | 1 (keep the minimum-wage check; drop the 50 % / FTE hints) |
| 12 | D1 | Wage-revision arrears → debit notes per site with annexure | all | 5 | M | 2.5 | D | never |
| 13 | D2 | TDS receivable by client (section by bill date, 16A / Form 131 chase via R14) | all | 3 | S | 3.0 | D | 2 (list only; drop the chase letter) |
| 14 | D3 | Licences and renewals (PSARA per State, OSH / contract-labour, contract end) → bell notices | security, labour | 3 | S | 3.0 | D | 1 |
| 15 | D4 | RCM-only registration note; 57th Council pending note (PF8) on the regime chip | proprietors | 2 | S | 2.0 | D | 3 |
| — | — | Patrol / GPS logs, biometric device drivers, ECR upload | — | 3 | L | 1.0 | no (network / device) | — |
| — | — | Labour-code wage base in the payroll engine | all | 4 | L | 1.3 | no (rules not final; MP16) | — |
| — | — | Housing societies vertical | RWAs | 4 | L | 1.3 | no (Round 18) | — |

All 15 are planned. The cut column, not a renegotiation, decides what happens at a cap.

---

## 4. Specifications (15 items)

Conventions for every item:
- **Logic and tests.** Pure logic in `src/lib/manpower/mp-*.ts` (new folder; family group `f-manpower`), bridges in
  `src/lib/manpower/mp-*-io.ts` (§1.4), tests with `node:test` in `tests/mp-*.test.ts`. UI checks are `step(...)`
  blocks in `tests/e2e/smoke.mjs` (§7).
- **Components.** `src/components/manpower/`: `DeployDesk.tsx` (lazy, glob-mounted by `Time.tsx`) and one lazy view
  per `&view=`. Editor / form rows are lazy parts mounted only when the `manpower` pack is on: `ManpowerRows` (invoice
  editor), `SitePick` (purchase-bill form). The template part is `components/templates/parts/ManpowerBlock.tsx` (lazy;
  the `TravelBlock` pattern).
- **Strings.** One area per package (§1.4). Hindi uses the trade's words: सुरक्षा एजेंसी, सुरक्षा गार्ड, सुपरवाइज़र,
  साइट, पोस्ट, तैनाती, ड्यूटी रजिस्टर (मस्टर), ड्यूटी, शिफ्ट, रिलीवर, ओवरटाइम, सेवा शुल्क, लागत-आधारित बिल, मानव-शक्ति
  आपूर्ति, हाउसकीपिंग, रिवर्स चार्ज (ग्राहक GST देगा), अनुपालन पैक, PF चालान (TRRN), ESI चालान, वेतन रजिस्टर, न्यूनतम
  वेतन, परिवर्तनीय महंगाई भत्ता (VDA), बकाया बिल, डेबिट नोट, साइट का लाभ-हानि, लाइसेंस नवीनीकरण.
- **Storage.** New company tables `mrchartist_inv_<table>` through `getTable` / `setTable`. Each is registered in
  `backup.ts`, the open-export schema (`trust/open-export-schema.ts`), `sync-engine.ts` `DATED` when dated, and
  **`src/lib/manpower/mp-registry.ts`** (`MP_TABLE_ACTIONS`, `MP_WATCHED`), registered at runtime, never in first-paint
  `access.ts` / `audit-edits.ts`. **Every module that writes a Round 17 table imports `./mp-registry`**, and so do the
  two all-table lazy writers (`sync-engine.ts`, `trust/recycle-bin.ts`) (`tests/mp-registry.test.ts`). Table and object
  names live in `src/lib/manpower/mp-shared.ts`. Additive fields come by declaration merging in
  `src/types/manpower-r17.ts`, one `declare module` block per package.
- **Volume.** A 60-site agency with 600 guards writes 720 musters a year with ≈ 7,200 employee rows. A muster's
  employee rows live **inside** its `site_musters` row (≤ 300 rows a site; a bigger site is split by post group). A
  test builds one year of 60 sites × 12 months × 10–300 rows and checks that billing one month reads only that
  month's musters and that the payroll push for a month touches only that month's attendance.
- **Invoice snapshots.** Everything Round 17 stores on an invoice lives under the record key **`mp`** (§6): one
  object, each package owning its sub-fields. Lines that need a per-line mark reuse existing line keys (`sv.exempt`
  for Sl. 66; `hsn` for SAC). **No line key is added.** A purchase bill tagged to a site carries `PurchaseRecord.mp`
  (`site_id`); B checks that `readPurchase` passes the key through and adds `mp` to the purchase keep-list if it does
  not.
- **Numbers.** **No new series.** Site codes are the agency's own (`S-<seq>` suggested), unique per company, stored on
  the cost centre.
- **Guards.** Destructive calls use `requireAccess`; writes in a locked period use `assertUnlocked`; money through
  `round2`; deletes through `setTable` on a watched table (recycle bin); multi-table writes through
  `withTablesRollback` (`table-txn.ts`).
- **Packs.** The desk tab is listed only when `manpower` or `security` is on (its URL still opens it). Round 17 tables
  are not read while both packs are off (`tests/mp-pack-gate.test.ts`).
- **Help and Ctrl+K.** Every new tab / view gets a topic in `src/lib/help/topics-packs.ts` (block `// R17`;
  `tests/help-registry.test.ts`) and a Ctrl+K title in `src/i18n/areas/discover-r6-tabs.ts`, plus synonyms in
  `src/lib/palette/synonyms.ts` (`'/time?tab=deploy&view=muster': ['muster', 'duty register', 'guard attendance',
  'हाज़िरी']` …). Statutory topics cite MP ids. **A adds `MP` to the CA-id regexes** in `tests/help-registry.test.ts`,
  `tests/help-glossary.test.ts` and `tests/docs-links.test.ts` (`CITED_RE`, `CA_LIST_RE` and the row regex), with a
  test case for `MP1`.
- **Cash readers.** No new receipt marker. A client's compliance withhold is **not** a no-cash receipt; it is a
  receivable that stays open (C1). `no-cash.ts` is not edited.
- **Purchases contract.** Every new module that reads `purchases` (C2) is added to `tests/purchase-contract.test.ts`
  and reads bills through `readPurchase`.
- **Rule file shape.** `src/lib/manpower-rules.ts` rows are `{ from: 'YYYY-MM-DD', value, source, verified }`,
  append-only, read with the shared `ruleAt`. Sections `// R17-A` … `// R17-D` (§6).

### R17-A — Manpower core (merge first)

#### A1 Manpower profile and build plumbing

**User story.** I run a 120-guard security agency as a proprietor. In setup I pick "Services", then "Security,
housekeeping and manpower supply", then *Security agency*, "Registered under GST", "Proprietorship". The app lands
me on Time → Deploy → Sites, and the checklist asks for my first site, my first muster and my first bill.

**Acceptance criteria.**
1. `PackId` gains `manpower` and `security` (appended to `PACK_IDS`). `PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE`,
   `PACK_ROUTES` unchanged.
2. `SERVICE_KINDS` gains `'manpower'` (`shop-presets.ts`, lazy) with profile modules `PRESETS.services` + `payroll`,
   `accounts`, `banking`, `tds`, `recurring`, `purchases` (`registered` adds `gst`; `time` always kept). `ServiceKind`
   gains `'manpower'` (type only).
3. Settings field `manpower_kind?: 'security' | 'facility' | 'staffing' | 'labour' | 'other'` and the object
   **`manpower_settings`** (`settings.manage`, audited, synced as a singleton). A writes the shape for every package:
   - A: `billing_days: 'calendar' | 26 | 30` (pro-rata base, default `calendar`), `shift_hours: 8 | 12` (default 8),
     `service_charge_pct` (default 0), `bill_date: 'month_end' | 'next_1'` (default month end, MP11);
   - B: `extra_duty_type_id?` (the payroll attendance type for extra duties), `costplus: { pf_pct?, esi_pct?,
     bonus_pct?, leave_pct?, relieving_pct?, uniform_per_head? }` (typed by the user; no defaults in rules);
   - C: `wage_revisions: { id, from, zone?, skill?, post_name?, wage_day?, wage_month?, ref }[]` (typed);
   - D: `licences: { id, kind: 'psara' | 'osh' | 'clra' | 'trade' | 'other', state?, no, valid_till }[]`.
4. **Entity type.** The firm form is read from the annual pack's `notes_to_accounts.entity_type` (the R14 rule, never
   a second field). The picker asks it once when it is missing and writes it there.
5. `applyManpowerKind(kind, { registered, currentPacks })` (`shop-presets.ts`, the R12–R15 pattern) returns business
   type `services`, `service_kind: 'manpower'`, modules, packs in union with `currentPacks` (§1.3), landing, due days
   7 and the template `gst_tax_invoice`.
6. **Wizard.** One card in the R10 service picker, "Security, housekeeping and manpower supply" (lazy sub-step in the
   wizard chunk): kind, "Registered under GST?", firm form. Settings → Features shows "Manpower profile" for every
   `services` company. Changing it never deletes data.
7. **Checklist steps** (`checklist-steps.ts`, append-only, only with `manpower_kind`): `firstSite`, `firstMuster`
   (counts `site_musters` rows), `firstBill` (invoices with `mp.month`), `compliance` (C; counts `site_compliance`
   rows with status `proved`), `licence` (security only; D).
8. **Sample data** (R6-B4) in `src/lib/demo/profile-manpower.ts`, **only in the Demo company** (`demoDatabaseOpen()`
   checked by the existing dispatcher), ≤ 0.8 kB gz for the round, one block per package:
   - A: two sites — "Sunrise Towers" (registered client, 4 guards 12 h + 1 supervisor) and "Green Park RWA"
     (unregistered client, 2 guards + 1 housekeeper);
   - B: October musters for both and one bill each;
   - C: a finalised payroll month and one proved compliance row;
   - D: one wage revision from 1 Oct with arrears, one PSARA licence expiring in 40 days (a bell notice).
9. **Build plumbing (one commit, before any feature code):**
   - `vite.config.ts`: the `f-manpower` row (§1.4); `tests/bundle-config.test.ts` adds the name;
   - `MP` in the three CA-id regexes (above);
   - `src/lib/manpower/{mp-shared,mp-registry}.ts`, `src/lib/manpower-rules.ts` (sections), `src/types/manpower-r17.ts`
     (all packages' declarations, §6);
   - `store/invoice-defaults.ts`: `export const R17_RECORD_KEYS = ['mp'] as const;` and the token in `R9_RECORD_KEYS`
     after R15's (§6). That module is a lazy chunk; measured first paint must stay **182.1 kB**.

**Files.** New: `src/lib/manpower/{mp-shared,mp-registry,mp-settings,mp-profile}.ts`, `src/lib/manpower-rules.ts`,
`src/types/manpower-r17.ts`, `src/components/manpower/{ManpowerKindPicker,DeployDesk}.tsx`,
`src/i18n/areas/manpower-r17a.ts`, `src/lib/demo/profile-manpower.ts`, `docs/features/manpower-r17.md`. Edit:
`industry-packs.ts`, `shop-presets.ts`, `types/services-r10.ts` (one union member), `features-catalog.ts`,
`checklist-steps.ts`, the R10 service picker (one lazy card), `FeaturesPanel.tsx`, `page-tabs.ts` (row `deploy`),
`Time.tsx` (glob mount), the demo dispatcher, `vite.config.ts`, `invoice-defaults.ts`, the three regex tests.

**Tests.** `tests/mp-profile.test.ts` (each kind's type / modules / packs / landing; `registered` adds `gst`; packs
union; a services company without `manpower_kind` unchanged; `PACK_OF_TYPE` / `PACK_ROUTES` unchanged),
`tests/mp-registry.test.ts`, `tests/mp-rules.test.ts` (import graph; every row has `from`, `source`, `verified`;
`verified: true` rows are exactly those of §2.4), `tests/mp-pack-gate.test.ts`, `tests/bundle-config.test.ts`,
`tests/industry-packs.test.ts` (extended).

#### A2 Sites, posts and contracts

**User story.** Sunrise Towers (client Sunrise Developers, GSTIN 27…) takes 4 guards on 12-hour shifts at ₹800 a
duty and 1 supervisor at ₹1,000 a duty, from 1 Aug 2026 to 31 Jul 2027. I add the site once; every month's muster
and bill start from it.

**Acceptance criteria.**
1. **Site = cost centre** (kind `project`, the R14 matter / R15 trip precedent) with `CostCentre.mp`:
   - `code`, `client_id`, `address?`, `state` (two-digit code; place of supply = the client's registration per Sec
     12(2) for a registered client, else the site's location — the existing POS logic decides, MP3);
   - `contract: { from, to?, ref?, escalation?: 'vda_pass_through' | 'fixed' | 'none' }` (escalation is cut 2);
   - `posts: { id, name, sac, heads, shift_hours, basis: 'month' | 'duty' | 'hour' | 'costplus', rate, skill?, zone? }[]`
     (≤ 30 a site; `skill` / `zone` are cut 2);
   - `bill_group?` (sites with the same group and client are billed on one invoice, B3);
   - `status: 'active' | 'paused' | 'closed'`.

   Budgets, cost-centre P&L and reports work unchanged.
2. **SAC suggestion** by post name and kind from `MP_SAC_RULES` (§2.4 row 2): guard / supervisor / gunman →
   998525; housekeeping / cleaning → 998533; staffing kind → 998513; labour kind → 998519. A typed SAC wins.
3. **Client flags** on `Client.mp` (lazy row in the desk's client panel, not the client form): `gst_tds_only` (a
   Government department registered only to deduct TDS u/s 51), `composition` (filled from the client's GSTIN type
   when the app knows it), `school` (pre-school to higher secondary, Sl. 66), `tds?: { section: '194C' | '194J' |
   'none', deductee: 'company' | 'other' }` (D2).
4. **Views.** `sites`: list with client, posts, heads, monthly value at full duties, contract end (red within 30 days),
   regime chip (A3). Opening a site shows its posts grid (`LinesGrid`), contract and client flags.
5. **Employees.** The site's "Deployed" list = employees whose `cost_centre_id` is the site, plus anyone with a duty
   in the last muster. "Deploy" sets `cost_centre_id` through the payroll store's existing save (no new table).
   `Employee.mp?: { post_id?, guard_licence?: { no, valid_till } }` is additive (types file).

**Files.** New: `src/lib/manpower/{mp-sites,mp-sac}.ts`, `components/manpower/{SitesView,SiteForm}.tsx`. Tests:
`tests/mp-sites.test.ts` (validation, code uniqueness, SAC suggestion, closed sites hidden from musters).

#### A3 GST regime engine

**User story.** My Sunrise bill shows no GST and the line "Tax payable on reverse charge by the recipient — security
services by a person other than a body corporate (N 13/2017-CT(R) entry 14)". My Green Park RWA bill (no GSTIN)
charges 18 %. A school's housekeeping bill is exempt with the Sl. 66 sentence. If I incorporate as a company, the same
Sunrise bill charges 18 % from the incorporation date.

**Acceptance criteria.**
1. `mpRegime({ date, entityType, client, posts })` (pure, `mp-regime.ts`) returns `{ regime, rate, decl, ca }` from
   `manpower-rules.ts` by the document date:

   | Regime | When | Lines | Declaration (printed) |
   |---|---|---|---|
   | `rcm` | date ≥ 2019-01-01; a post with SAC 99852x (security) on the line; our entity type **not** body corporate (`BODY_CORPORATE_RULES`: `company`, `llp`); client has a GSTIN; client not `gst_tds_only`; client not `composition` | Tax computed as memo, not charged (`reverse_charge: true`, `rcm_tax_excluded: true`) | "Tax payable on reverse charge by the recipient — security services supplied by a person other than a body corporate (N 13/2017-CT(R) entry 14, inserted by N 29/2018-CT(R)). Verify with your CA." |
   | `exempt66` | client `school`; lines of security / cleaning / housekeeping SAC (99852x, 99853x) | 0 %, line key `sv.exempt: 'EXEMPT'` | "Exempt — security / cleaning / house-keeping services performed in an educational institution up to higher secondary (N 12/2017-CT(R) Sl. 66(b)(iii)). Verify with your CA." |
   | `manual_exempt` | user choice with a typed reason (e.g. Sl. 3, MP8) | 0 %, `sv.exempt` | the typed reason + "Verify with your CA." |
   | `fwd` | everything else | 18 % (`MP_GST_RATE_RULES`) | — |

   Mixed posts on one bill (a guard and a housekeeper for a registered client of a proprietor) split into **two
   invoices** (one RCM, one forward), never mixed lines, because the reverse-charge flag is per document (MP1, MP10).
2. The editor's lazy `ManpowerRows` shows the regime chip for a document with `mp` and lets the user override with a
   reason (audited, stored in `mp.regime_note`). A typed tax rate on a line still wins (existing rule).
3. GSTR-1 / 3B / e-Invoice read the existing `reverse_charge` / `rcm_tax_excluded` / `sv.exempt` fields; **no GST
   reader changes**. A test proves an `rcm` bill lands in B2B with reverse charge `Y` and the e-Invoice JSON carries
   `RegRev: 'Y'`; an `exempt66` line lands in Table 8 exempt.
4. Rule rows (`manpower-rules.ts` `// R17-A`): `MP_GST_RATE_RULES`, `MP_SAC_RULES`, `SECURITY_RCM_RULES`,
   `BODY_CORPORATE_RULES`, `EDU_EXEMPT_RULES`, `RCM_ONLY_REG_RULES` (verified flags as §2.4).

**Files.** New: `src/lib/manpower/mp-regime.ts`, `components/manpower/ManpowerRows.tsx`. Edit: the invoice editor (one
lazy row mount, the R15 `TravelRows` slot pattern). Tests: `tests/mp-regime.test.ts` (dates 2018-12-31 / 2019-01-01;
each entity type; registered / unregistered / TDS-only / composition clients; school; mixed posts → split; typed rate
wins).

#### A4 Manpower paper

**Acceptance criteria.**
1. `ManpowerBlock.tsx` (lazy, mounted in `TemplateEngine.tsx` after `TravelBlock`, before `GstBody`, never on
   `receipt`) prints from `mp` only: site code and name, month, the regime declaration, the post summary (post, SAC,
   heads, duties, rate, amount; ≤ 12 rows), and B's / C's / D's parts through `switch` arms in `parts/manpower/*.tsx`.
2. The per-employee duty annexure (name, employee code, duties, OT) prints as a second page **only** when
   `mp.annex` is present (cut 1). Personal data is limited to name and code (no UAN / bank on the client's copy).
3. Old invoices render unchanged (snapshot compare in `tests/mp-print.test.ts`). Colours from `accent` only.
4. `paper-helpers.ts`: `mpLineText` (post particulars in the line description) appended after `tvLineText`.

**Files.** New: `components/templates/parts/ManpowerBlock.tsx`, `src/lib/manpower/mp-print.ts`,
`manpower-paper.module.css`. Edit: `TemplateEngine.tsx` (one lazy import + mount), `paper-helpers.ts`.

### R17-B — Duty register and billing

#### B1 Duty register (muster)

**User story.** On 1 Nov I open October for Sunrise Towers. The grid lists the five deployed people with last month's
pattern; I change Ramesh to 28 duties, add Suresh as a reliever with 3 duties and 12 OT hours, and lock the month.

**Acceptance criteria.**
1. **Table `site_musters`** (dated by the month's last day, synced, audited, right `doc.create`): `id`, `site_id`,
   `month` (`YYYY-MM`), `rows: { employee_id, post_id, duties, ot_hours?, relief?: boolean, note? }[]` (≤ 300),
   `status: 'draft' | 'locked'`, `locked_at?`, `updated_at`. One row per site × month (a second is refused).
2. **Grid** (`LinesGrid`): employee, post, duties (0.5 steps), OT hours, relief tick; totals per post vs heads ×
   billing days; warnings (never blocks): more duties than days × 2; an employee over 31 duties across all sites; an
   employee whose `dol` is before the month.
3. **"Copy last month"** pre-fills from the previous muster (or from deployed employees at full duties).
4. **Import** (cut 3): CSV / XLSX through `csv.ts` / dynamic `xlsx.ts`, fixed template `employee_code, duties,
   ot_hours, post` or a day-wise sheet (P / A / OT columns summed). Unknown codes are listed, not created. The run is
   logged in `import_runs` (kind `muster`).
5. **Lock.** A locked muster is read-only until "Unlock" (audited, `doc.create`); billing and the payroll push read
   locked musters only (a draft shows "Lock first").

**Files.** New: `src/lib/manpower/{mp-muster,mp-muster-import}.ts`, `components/manpower/MusterView.tsx`,
`src/i18n/areas/manpower-r17b.ts`. Tests: `tests/mp-muster.test.ts` (one per site × month, duty warnings, copy,
lock, import mapping, volume).

#### B2 Muster → payroll attendance

**Acceptance criteria.**
1. "Send to payroll" for a month (only when every active site's muster is locked, or with a confirmation listing the
   missing sites) computes per employee across **all** sites: `duties = Σ duties`; `lop = max(payable days − duties,
   0)` where payable days follow the payroll's existing month rule (`daysInMonth`); `units.ot_hours = Σ ot_hours`;
   `units[extra_duty_type_id] = max(duties − payable days, 0)` when the setting is set (cut 2).
2. It shows a preview (employee, current LOP / units, new values) and writes through `saveAttendance(month, rows)` for
   the employees in the musters only; others are untouched. It is refused when the month's payroll run is finalised
   (the existing payroll lock).
3. The bridge `mp-payroll-io.ts` is the only Round 17 module importing the payroll store.

**Files.** New: `src/lib/manpower/{mp-attendance,mp-payroll-io}.ts`. Tests: `tests/mp-attendance.test.ts` (multi-site
sums, LOP floor, extra duties, untouched employees, finalised-run refusal).

#### B3 Bill from the muster

**User story.** "Bill October" for Sunrise makes one draft: Guard (12 h) 122 duties × ₹800 = ₹97,600; Supervisor 31 ×
₹1,000 = ₹31,000; total ₹1,28,600 under reverse charge, with the duty annexure.

**Acceptance criteria.**
1. **Bases** per post (`mp-bill.ts`, pure):
   - `duty`: `Σ duties × rate`;
   - `hour`: `Σ duties × shift_hours × rate` (+ OT hours × rate when "bill OT" is ticked on the post);
   - `month`: `rate × heads × billed duties ÷ (heads × billing days)` (pro-rata; billing days per `billing_days`; capped
     at `rate × heads` unless "bill extra duties" is ticked);
   - `costplus`: wages (from the post's `rate` per duty, or from the finalised payroll run's earnings of the muster's
     employees apportioned by duties, C1 bridge) + `costplus` percentages + service charge % on the sum. Each element is
     **one line of the same SAC and rate** (wages and statutory charges are part of the value of one supply, not pure
     agent — CN15 / MP6).
   - Service charge (`service_charge_pct`) is a separate line on any basis when set.
2. **Grouping.** One invoice per site, or per client + `bill_group` (lines per site × post, site name in the line
   description). The regime engine (A3) runs per resulting invoice; mixed RCM / forward posts split (A3 criterion 1).
3. Drafts go through `draftInvoice` (CN-D2 bridge `mp-draft-io.ts`), dated per `bill_date` (default the month's last
   day, MP11), with `mp` = `{ site, month, basis, regime, decl, posts, muster_id, annex? }`. Billed state is derived
   from invoices whose `mp.muster_id` is the muster (no stored flag). A second bill for the same muster warns and
   links the first.
4. **Bills view** (`bills`): sites × month matrix — muster status, billed amount, invoice link, unbilled value; "Bill
   all locked" makes one draft per site / group and reports the list.

**Files.** New: `src/lib/manpower/{mp-bill,mp-draft-io}.ts`, `components/manpower/BillsView.tsx`. Tests:
`tests/mp-bill.test.ts` (each basis with paise rounding, pro-rata caps, grouping, split by regime, derived billed
state, volume: one month of 60 sites reads 60 musters).

#### B4 Expected client TDS on the bill

**Acceptance criteria.**
1. The bill's `mp.tds = { section, rate, expected }` from `Client.mp.tds` (else `194C` for `manpower` kinds) and the
   deductee (individual / HUF 1 %, others 2 %) by **bill date**, on the taxable value excluding GST (the CBDT rule for
   GST shown separately, MP14). Labels by date through `ita2025.ts` ("Sec 393(1) Table Sl. 6(i) — supply of manpower is
   work (from 1 Apr 2026)"). Read through the bridge `mp-tds-io.ts` (imports `tds-rules.ts`, `ita2025.ts`).
2. A footer line "TDS expected: ₹1,286 (1 %)" prints only when the setting "Print expected TDS" is on (default off).
3. A Government client (`gst_tds_only` or the client's GST-TDS flag) gets the GST TDS u/s 51 hint from
   `GST_TDS_51_RULES` (2 % above the threshold), never on an `rcm` bill (the Government is outside RCM, MP13).

**Files.** New: `src/lib/manpower/mp-tds-io.ts`. Tests: `tests/mp-tds.test.ts` (dates 2026-03-31 / 2026-04-01;
deductee; GST excluded; GST TDS hint).

### R17-C — Compliance and profitability

#### C1 Client compliance pack

**User story.** Sunrise holds 10 % of my bill until I send October's PF and ESI proof for their five people. I open
Compliance → Sunrise → October: it lists the five with PF wages, EE / ER PF, EPS, ESI EE / ER from the October payroll
run, apportioned by their Sunrise duties; I type the TRRN and ESI challan, attach the challan PDFs, mark it proved and
print the annexure.

**Acceptance criteria.**
1. **Table `site_compliance`** (dated by month end, synced, audited, right `doc.create`): `id`, `site_id`, `month`,
   `pf: { trrn?, paid_on?, amount }`, `esi: { challan?, paid_on?, amount }`, `attachments?: ids`, `status: 'pending' |
   'proved' | 'waived'`, `hold?: { pct?, amount?, invoice_id? }`. One per site × month. `proved` needs TRRN and challan
   (the CN-D2 rule).
2. **Shares** (`mp-compliance.ts`, pure): for each employee in the site's muster, the finalised run's `PayslipLine` PF /
   ESI / EPS / EDLI / admin amounts × (site duties ÷ the employee's total duties that month). Bonus / leave reserve
   rows when `costplus` percentages are set. The bridge `mp-payroll-io.ts` reads the run.
3. **Annexure** (print window, `escHtml`): site, month, employee name, code, UAN (last 4 only), duties, gross, PF wages,
   EE / ER PF, ESI EE / ER, TRRN / challan, a wage-register extract (earnings / deductions / net) per employee, and the
   sentence "Prepared from the contractor's payroll; verify with your CA / labour-law adviser (MP18)". Bank details are
   never printed.
4. **Withhold.** The view shows each site's open invoices of the month with the client's hold (typed % or amount) and
   "Release expected once proved". Nothing posts; the receivable simply stays open. The existing ageing is unchanged.
5. ECR extract for the site (`pfEcrRows` filtered to the site's employees, amounts apportioned) for the client's own
   records — not an upload file.

**Files.** New: `src/lib/manpower/mp-compliance.ts`, `components/manpower/ComplianceView.tsx`,
`src/i18n/areas/manpower-r17c.ts`. Tests: `tests/mp-compliance.test.ts` (apportioning across two sites, totals equal
the run's, proved needs both refs, UAN masked, no bank fields).

#### C2 Site P&L

**Acceptance criteria.**
1. `profit` view for a month (cut 2: and a 12-month trend): per site — billed (invoices with the site's `mp.site`,
   credit notes out, arrears debit notes in), wages and employer statutory (C1 shares), relievers (rows with `relief`),
   purchase bills tagged `PurchaseRecord.mp.site_id` (uniforms, consumables, equipment hire), margin and margin %.
2. The purchase-bill form gets a lazy `SitePick` row (the R15 `TripPick` pattern) writing `PurchaseRecord.mp`.
3. Reads only the month's invoices, musters, runs and bills (volume test). No posting; the cost-centre P&L remains the
   books' view.

**Files.** New: `src/lib/manpower/mp-profit.ts`, `components/manpower/{ProfitView,SitePick}.tsx`. Edit: the purchase-bill
form (one lazy row). Tests: `tests/mp-profit.test.ts`; `tests/purchase-contract.test.ts` (reader added).

#### C3 Minimum-wage and labour-code checks

**Acceptance criteria.**
1. **Minimum wage** (never a block): for each muster row, the wage per duty actually paid (finalised run earnings ÷
   duties) vs the applicable `wage_revisions` row (by `from` ≤ month start and matching zone / skill / post name; the
   user types the amounts). Shortfalls are listed with the difference × duties ("arrears to pay the employee").
2. **Hints** (`LABOUR_CODE_RULES`, cut 1 for b–d):
   (a) OT pay head rate below 2 × the ordinary rate (from 21 Nov 2025);
   (b) a fixed-term employee (payroll `dol` set at joining, or an "FTE" tag) past one year without a gratuity
   provision;
   (c) a salary structure whose excluded allowances exceed half of the total (the 50 % wage rule, `verified: false`,
   MP16);
   (d) a site with ≥ 50 contract workers and no OSH / contract-labour licence in `licences` (`verified: false`, MP17).
3. Each hint cites its MP id and links to the relevant payroll screen. The payroll engine is not changed.

**Files.** New: `src/lib/manpower/mp-wage-check.ts`. Tests: `tests/mp-wage-check.test.ts` (revision selection by date
and zone, shortfall maths, each hint before / after 2025-11-21).

### R17-D — Arrears, receivables and renewals

#### D1 Wage-revision arrears

**User story.** The VDA revision effective 1 Oct is notified on 15 Nov. My contracts pass it through. I type the new
wage (₹26 more a duty from 1 Oct). The app lists Sunrise October 153 duties × ₹26 = ₹3,978 and Green Park ₹1,820, and
makes one debit note per original invoice, with the arrears annexure, in the original invoice's regime.

**Acceptance criteria.**
1. `mpArrears(revision, musters, invoices)` (pure): for each site with `contract.escalation = 'vda_pass_through'`
   (or ticked by hand) and each billed month on or after `revision.from`, `Σ duties of matching posts × (new − old
   rate per duty)`; `month` / `costplus` bases convert through the same bill engine; service charge % applied when the
   contract bills it on wages.
2. "Make debit notes" creates one `DEBIT_NOTE` per original invoice (series `DBN`), linked through `doc_links`, with
   `mp.arrear = { rev_id, from, to, of: invoice id }`, the same regime and SAC as the original, dated today. GSTR-1
   reads debit notes unchanged. The CA may prefer a supplementary tax invoice (MP12); the choice is a setting
   `arrears_doc: 'debit_note' | 'invoice'` (default debit note).
3. The employees' arrears (what the agency owes its staff) are listed beside the client arrears, with a link to the
   payroll arrears screen (7P `ArrearsRecord`); no payroll write.
4. Re-running for the same revision shows what is already raised (derived from `mp.arrear.rev_id`).

**Files.** New: `src/lib/manpower/mp-arrears.ts`, `components/manpower/StatutoryView.tsx` (section "Arrears"),
`src/i18n/areas/manpower-r17d.ts`. Tests: `tests/mp-arrears.test.ts` (dates, bases, already-raised, regime carried).

#### D2 TDS receivable by client

**Acceptance criteria.**
1. Section "TDS" of the `statutory` view: per client × quarter — bills, expected TDS (B4), TDS booked on receipts,
   difference; the section label by bill date (contractor limb from 2026-04-01; before it the client's typed section,
   194C or 194J, without a mismatch alarm, MP15).
2. Form 16A / Form 131 chase list and letter reuse R14 `ps-tds-recv.ts` / `tds-register.ts` through `mp-tds-io.ts`
   (cut 2 drops the letter).

**Files.** New: `src/lib/manpower/mp-tds-recv.ts`. Tests: `tests/mp-tds-recv.test.ts`.

#### D3 Licences and renewals

**Acceptance criteria.**
1. Section "Licences": rows of `manpower_settings.licences` (PSARA per State, OSH / contract-labour, trade, other),
   guard licences (`Employee.mp.guard_licence`), and contract end dates (`CostCentre.mp.contract.to`).
2. Alerts at 60 / 30 / 7 days through the notification bell: one `gate('manpower', 'manpower', () =>
   import('../../lib/manpower/mp-alerts'))` row in `NotificationBell.tsx` (a lazy chunk; the R5-B `transport` /
   `works` pattern; `mp-alerts.ts` registers its provider on load). PSARA rows only with the `security` pack.

**Files.** New: `src/lib/manpower/mp-alerts.ts`. Edit: `NotificationBell.tsx` (one `gate` row). Tests:
`tests/mp-alerts.test.ts`.

#### D4 Registration and pending notes

**Acceptance criteria.**
1. On the profile panel, when every billed client of the last 12 months was `rcm`, a note: "Only reverse-charge
   supplies: registration may not be required (N 5/2017-CT). Verify with your CA (MP9)."
2. The regime chip shows the R16-D4 pending note PF8 (e-invoicing of RCM inward supplies from unregistered persons) for
   an `rcm` bill of a supplier that is unregistered — a note, never a rule (MP30).

**Files.** Edit: `mp-regime.ts` (note ids only), `pending-changes.ts` (one screen id appended). Tests: in
`tests/mp-regime.test.ts`.

---

## 5. Work packages

Four packages, each one agent in its own worktree.

**Merge order:** **A first** (family group, `MP` regexes, registry, rules / types / shared scaffolds, the `mp` record
key, template mount, the `deploy` tab and desk with the `sites` view, the regime engine). Then **B** (C and D read
musters and bills). **C and D** follow in either order and can run in parallel; they share only the registry, rules,
types, demo, help and the desk's view map. No stubs: each package adds its own views, help topics and Ctrl+K titles.

### R17-A — Manpower core (A1–A4)

| | Files |
|---|---|
| Owned (new) | `src/lib/manpower/mp-{shared,registry,settings,profile,sites,sac,regime,print}.ts`, `src/lib/manpower-rules.ts`, `src/types/manpower-r17.ts`; `components/manpower/{ManpowerKindPicker,DeployDesk,SitesView,SiteForm,ManpowerRows}.tsx`; `components/templates/parts/ManpowerBlock.tsx` + `manpower-paper.module.css`; `src/i18n/areas/manpower-r17a.ts`; `src/lib/demo/profile-manpower.ts`; `docs/features/manpower-r17.md`; tests `mp-profile`, `mp-registry`, `mp-rules`, `mp-pack-gate`, `mp-sites`, `mp-regime`, `mp-print` |
| Owned (edit) | `vite.config.ts` (one row), `tests/bundle-config.test.ts`; `industry-packs.ts`, `shop-presets.ts`, `types/services-r10.ts` (one member), `features-catalog.ts`, `checklist-steps.ts`, the R10 service picker, `FeaturesPanel.tsx`; `page-tabs.ts` (row `deploy`), `Time.tsx` (glob); `TemplateEngine.tsx`, `paper-helpers.ts`, `invoice-defaults.ts` (one token); the invoice editor (one lazy row); `tests/help-registry.test.ts`, `tests/help-glossary.test.ts`, `tests/docs-links.test.ts` (`MP`) |
| Budget | first paint 0 (measured 182.1); core **≤ 11 kB** |

### R17-B — Duty register and billing (B1–B4)

| | Files |
|---|---|
| Owned (new) | `src/lib/manpower/mp-{muster,muster-import,attendance,payroll-io,bill,draft-io,tds-io}.ts`; `components/manpower/{MusterView,BillsView}.tsx`; `components/templates/parts/manpower/DutyAnnex.tsx`; `src/i18n/areas/manpower-r17b.ts`; tests `mp-muster`, `mp-attendance`, `mp-bill`, `mp-tds` |
| Owned (edit) | the desk's view map (adds `muster`, `bills`); `import_runs` kind list (one value `muster`) |
| Shared (§6) | rules `// R17-B` (none expected), types `// R17-B`, registry block (`site_musters`), demo block, `mp` sub-fields `muster_id`, `annex`, `tds` |
| Budget | core **≤ 12 kB** |

### R17-C — Compliance and profitability (C1–C3)

| | Files |
|---|---|
| Owned (new) | `src/lib/manpower/mp-{compliance,profit,wage-check}.ts`; `components/manpower/{ComplianceView,ProfitView,SitePick}.tsx`; `src/i18n/areas/manpower-r17c.ts`; tests `mp-compliance`, `mp-profit`, `mp-wage-check` |
| Owned (edit) | the desk's view map (adds `compliance`, `profit`); the purchase-bill form (one lazy row); `mp-payroll-io.ts` (one read function, coordinated with B's owner via the lead) |
| Shared (§6) | rules `// R17-C` (`LABOUR_CODE_RULES`, `CONTRACT_LABOUR_THRESHOLD_RULES`), types, registry (`site_compliance`), demo, `mp` sub-field `comp` |
| Budget | core **≤ 9 kB** |

### R17-D — Arrears, receivables and renewals (D1–D4)

| | Files |
|---|---|
| Owned (new) | `src/lib/manpower/mp-{arrears,tds-recv,alerts}.ts`; `components/manpower/StatutoryView.tsx`; `src/i18n/areas/manpower-r17d.ts`; tests `mp-arrears`, `mp-tds-recv`, `mp-alerts` |
| Owned (edit) | the desk's view map (adds `statutory`); `NotificationBell.tsx` (one `gate` row); `pending-changes.ts` (one screen id); `mp-regime.ts` (note ids) |
| Shared (§6) | rules `// R17-D` (`VDA_REVISION_RULES`), types, demo, `mp` sub-field `arrear` |
| Budget | core **≤ 7 kB** |

**Combined:** first paint **0** (measured 182.1 at every merge); core **≤ 39 kB gross** + 1 kB lead reserve = **≤ 40
kB**; Hindi pack ≤ 8 kB. Each package runs `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and
`npm run check:size` on its branch (one at a time), and again after rebase; the last package also runs `npm run
test:e2e` and `npm run verify:offline`.

---

## 6. Shared-file protocol

| File | Who | Rule |
|---|---|---|
| `vite.config.ts`, `tests/bundle-config.test.ts` | A | One row `f-manpower` in one commit. Later packages never edit them |
| `src/types/manpower-r17.ts` | A creates | One `declare module` block per package, marked `// R17-A` … `// R17-D`. A declares for every package in one commit: record key `mp?: MpSnapshot` with sub-objects `site`, `month`, `basis`, `regime`, `regime_note`, `decl`, `posts` (A), `muster_id`, `annex`, `tds` (B), `comp` (C), `arrear` (D); settings `manpower_kind`, `manpower_settings`; `CostCentre.mp`; `PurchaseRecord.mp`; `Client.mp`; `Employee.mp` |
| `src/store/invoice-defaults.ts` | A | **One edit:** `export const R17_RECORD_KEYS = ['mp'] as const;` and the token in `R9_RECORD_KEYS` after R15's. No line key |
| `src/lib/manpower-rules.ts` | A creates | Sections `// R17-A` (`MP_GST_RATE_RULES`, `MP_SAC_RULES`, `SECURITY_RCM_RULES`, `BODY_CORPORATE_RULES`, `EDU_EXEMPT_RULES`, `RCM_ONLY_REG_RULES`), `// R17-C` (`LABOUR_CODE_RULES`, `CONTRACT_LABOUR_THRESHOLD_RULES`), `// R17-D` (`VDA_REVISION_RULES`). Every row has `from`, `source`, `verified` |
| `tax-rules.ts`, `tds-rules.ts`, `ita2025.ts`, `payroll-rules.ts`, `transport-works-rules.ts`, `construction-rules.ts` | — | **Not edited** (read through bridges) |
| `src/lib/manpower/mp-registry.ts` | A creates | `MP_TABLE_ACTIONS` / `MP_WATCHED`, one block per package: A `manpower_settings`; B `site_musters`; C `site_compliance`. `tests/mp-registry.test.ts` pins both maps |
| `backup.ts`, `sync-engine.ts` (`DATED`), `trust/open-export-schema.ts` | each its own rows | Append-only blocks `// R17-B`, `// R17-C` |
| `TemplateEngine.tsx` | A | One lazy import + mount of `ManpowerBlock` (after `TravelBlock`, before `GstBody`, never on `receipt`). B–D add `switch` arms in `parts/manpower/*.tsx` |
| `paper-helpers.ts` | A | `mpLineText` appended after `tvLineText` |
| `industry-packs.ts` | A | Two ids; `PACK_TABS` block `// R17` (desk + six views, written by A from this PRD's ids) |
| `page-tabs.ts` | A | One `TIME_TABS` row `deploy`. B–D add **views**, not tabs |
| `components/manpower/DeployDesk.tsx` (view map) | A creates, B–D append | One lazy entry per view in a `// R17-x` block |
| `Time.tsx` | A | One `import.meta.glob` over `components/manpower/*Desk.tsx` |
| `shop-presets.ts`, `checklist-steps.ts`, `features-catalog.ts`, the R10 service picker, `FeaturesPanel.tsx` | A | Appended blocks `// R17` after the R15 blocks |
| `mp-payroll-io.ts` | B creates, C appends | One function each (`readRunForMonth` C); no other module imports the payroll store |
| `src/lib/help/topics-packs.ts`, `glossary.ts`, `discover-r6-tabs.ts`, `palette/synonyms.ts` | A, B, C, D | Each package writes its own topics and Ctrl+K titles in its own `// R17-x` block, in the same commit as its views. Glossary ≤ 8 terms for the round (muster, duty, RCM entry 14, body corporate, TRRN, VDA, cost-plus, PSARA) |
| `src/lib/demo/profile-manpower.ts` | A creates | Dispatcher by `manpower_kind`; one block per package; ≤ 0.8 kB gz in all; Demo company only |
| `tests/purchase-contract.test.ts` | C | Appends `mp-profit` |
| `tests/e2e/smoke.mjs` | A, B, C, D | One appended `step(...)` block each, in merge order |
| `docs/features/manpower-r17.md` | A creates | One section per package; each records its bundle numbers and the `f-manpower` chunk size there |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md`, `docs/CA_REVIEW.md` | lead | After merge: the Round 17 company-data paragraph in `AGENTS.md` (tables, object, `manpower_kind`, packs, desk tab `deploy`, "Round 17 invoice snapshots live under ONE record key `mp` — never add keys", "every module that writes a Round 17 table must `import './mp-registry'`", the `f-manpower` group); table rows in ARCHITECTURE; §17 MP items and the total (565 → 597) in CA_REVIEW |

### Storage summary

| Key / field | Package | Kind | Backed up | Synced | Audited | Right (`mp-registry`) |
|---|---|---|---|---|---|---|
| `manpower_settings` (billing days, shift hours, service charge, bill date, cost-plus %, extra-duty type, wage revisions, licences, arrears doc, print TDS) | A (sub-fields B–D) | object | yes | yes (singleton) | yes | `settings.manage` |
| `site_musters` | B | table, dated (month end) | yes | yes | yes | `doc.create` |
| `site_compliance` | C | table, dated (month end) | yes | yes | yes | `doc.create` |
| settings `manpower_kind`; `service_kind: 'manpower'` | A | additive | yes | yes | yes | — |
| record key `mp` | A (sub-fields B–D) | additive record key (one token in the lazy `invoice-defaults` chunk) | yes | yes | yes | — |
| `CostCentre.mp`, `PurchaseRecord.mp`, `Client.mp`, `Employee.mp` | A–C | additive | yes | yes | yes | — |
| `import_runs` rows of kind `muster` | B | existing table | yes | yes | yes | existing |

No migration (everything is additive). Personal data: employee names, codes and the last four digits of UAN on the
client annexure only; Aadhaar, bank details and police-verification documents are **not** stored by Round 17
(attachments the user adds stay under the existing attachments feature).

---

## 7. E2E steps (production build, `tests/e2e/smoke.mjs`)

**Rule for every step:** after any action that writes, wait for the write to reach IndexedDB with
`readJson(page, '<table>', fallback, predicate, 15000)` **before** any `page.goto`, `page.reload` or in-app navigation
that re-reads storage (the R16-B fix `d0a89fb`). Seeds written with `writeJson` are followed by a reload only after
`readJson` confirms them. A `check(...)` on stored data always uses the predicate form.

1. **R17-A:**
   - `check:size`: initial 182.1 kB, ≤ 5 initial files; the build has an `f-manpower` chunk.
   - Fresh company → wizard → Services → Manpower → *Security agency*, registered, proprietorship → lands on
     `/time?tab=deploy&view=sites`; Time shows the Deploy desk only.
   - New site "E2E Sunrise Towers" for a client with a GSTIN: posts Guard 12 h × 4 at ₹800 / duty (SAC suggested
     998525), Supervisor × 1 at ₹1,000 → **wait** for `cost_centres` to hold the site with two posts → reload → the
     site shows the chip "Reverse charge — client pays GST".
   - Second site "E2E Green Park RWA" (client without GSTIN) → chip "Forward charge 18 %" (wait for the row before
     reading it back).
   - F1 opens the Deploy help; Ctrl+K "muster" finds the view.
2. **R17-B:**
   - Seed (`writeJson`) five employees with `cost_centre_id` = the Sunrise site → `readJson` confirms → open
     `view=muster&site=…&month=2026-10` → "Copy last month" → set duties 30 / 30 / 31 / 28 + reliever 3 and Supervisor
     31 → Lock → **wait** until `site_musters` has the row with `status: 'locked'`.
   - "Send to payroll" → preview → confirm → **wait** until `attendance` (`PAYROLL_TABLES.attendance`) shows LOP 0
     / 0 / 0 / 3 and the reliever's units → reload Payroll → Attendance shows them.
   - Bills → "Bill October" for Sunrise → **wait** for an `invoices` row with `mp.month === '2026-10'` →
     `page.goto('/invoice/<id>')` → lines Guard 122 duties × ₹800 = ₹97,600 and Supervisor 31 × ₹1,000 = ₹31,000;
     `reverse_charge` true; total ₹1,28,600 with no tax added; the paper prints the entry-14 declaration and the duty
     summary. The stored record's `mp.tds.expected` = 1,286 (1 %, individual deductee, date ≥ 2026-04-01).
   - Green Park bill → 18 % charged.
3. **R17-C:**
   - Seed a finalised October payroll run for the five → `readJson` confirms → Compliance → Sunrise → October: PF ER +
     EE totals equal the run's for the five (single site, 100 %); type TRRN and challan → Proved → **wait** for
     `site_compliance` status `proved` → reload → still proved; the annexure window has UAN masked and no bank number.
   - Enter a ₹6,000 uniform bill tagged to Sunrise → **wait** for `purchases` with `mp.site_id` → Profit view: billed
     ₹1,28,600 − wages − employer PF / ESI − ₹6,000 = the margin shown.
   - A wage revision row (₹30 / duty minimum from 2026-10-01) above the paid rate → the shortfall is listed.
4. **R17-D:**
   - Revision +₹26 / duty from 2026-10-01 → Arrears: Sunrise 153 duties × ₹26 = ₹3,978 → "Make debit notes" → **wait**
     for an `invoices` row with `doc_type: 'DEBIT_NOTE'` and `mp.arrear.of` = the October bill → open it: reverse charge
     carried; `doc_links` row present.
   - TDS section: Sunrise Q3 expected ₹1,286 + the debit note's share.
   - A PSARA licence valid till today + 20 days → **wait** for `manpower_settings` → reload → the notification bell
     lists the renewal.

(The final numbers follow the seeded duties: 30 + 30 + 31 + 28 + 3 = 122 guard duties; B and D use the same seed.)

---

## 8. Open questions — with the default the builders will use

| # | Question | Default chosen | Why |
|---|---|---|---|
| 1 | New business type or a sub-profile? | `service_kind: 'manpower'` + `manpower_kind`, under `services`. | Zero shell bytes; the R10–R15 pattern. |
| 2 | Where do the screens live? | One desk tab `deploy` on `/time` with six views; payroll unchanged. | `/time` is the services home; no `PACK_ROUTES` row. |
| 3 | Site storage | Site = cost centre + `CostCentre.mp`; posts inside it. | Cost-centre P&L / budgets work already; no table. |
| 4 | Muster storage | One `site_musters` row per site × month with rows inside. | ≈ 720 rows a year for a 60-site agency. |
| 5 | Payroll link | Push to `saveAttendance` with preview; never automatic. | Payroll stays the owner of attendance. |
| 6 | Body corporate | `company` and `llp`. | AAR Haryana (S); MP2. |
| 7 | Mixed security + housekeeping for a registered client of a proprietor | Two invoices (RCM / forward). | Reverse charge is a document flag. |
| 8 | Wages in the bill | One supply at one rate (not pure agent). | CN15 precedent; MP6. |
| 9 | Invoice date | Last day of the service month. | Continuous supply; MP11. |
| 10 | Arrears document | Debit note per original invoice (setting allows a tax invoice). | Upward revision of an earlier supply; MP12. |
| 11 | TDS base | Taxable value excluding GST. | CBDT practice; MP14. |
| 12 | 194J used by clients before 1 Apr 2026 | Accepted, no mismatch alarm. | The ambiguity the Memorandum describes. |
| 13 | Minimum wages | Typed by the user per revision; no rule rows. | State / zone / skill tables change twice a year. |
| 14 | 50 % wage rule, OSH threshold | Hints only, `verified: false`. | Secondary sources; draft rules. |
| 15 | UAN on the client annexure | Last 4 digits. | DPDP minimisation. |
| 16 | Budget overrun | Cut in §3 order; no extension. | R13–R15 overran 1.2–2.5 ×. |

---

## 9. CA review items (MP1–MP32) — for `docs/CA_REVIEW.md` §17

★ = changes what a document prints or a return reports. Defaults as §8.

| Id | Question for the CA | Default in the app |
|---|---|---|
| MP1 ★ | Entry 14 of N 13/2017-CT(R) (N 29/2018-CT(R), from 1 Jan 2019): security services by a person other than a body corporate to a registered person under RCM, except TDS-only Government registrations and composition recipients. Any later amendment? | `rcm` regime as §4 A3 |
| MP2 ★ | Body corporate for entry 14: company yes; LLP (AAR Haryana: yes; the notification's Explanation treats an LLP as a partnership firm for other entries)? Co-operative society, trust, Section 8 company? Outcome of the Delhi HC petition? | `company`, `llp` forward; others RCM |
| MP3 | POS and IGST under RCM for a client registered in another State; SEZ unit clients (RCM vs zero-rated). | Existing POS logic; SEZ: RCM flag kept, user decides |
| MP4 ★ | Rate for manpower / security / cleaning (Heading 9985 Sl. 23(ii)) after the 22 Sep 2025 changes: still 18 %? | 18 % |
| MP5 | SAC per post: 998525 guards, 998533 cleaning, 998513 contract staffing, 998519 other labour supply. Does the choice matter for any return? | Suggested, editable |
| MP6 ★ | Wages and statutory contributions billed by the agency are part of the value of one supply (not pure agent) — cost-plus bills included. Cross-ref CN15. | One supply, one rate |
| MP7 ★ | Sl. 66(b)(iii) of N 12/2017-CT(R) (security / cleaning / housekeeping performed in a pre-school to higher-secondary institution): current text after amendments; private schools included; a school run by a trust that also runs a college? | `exempt66` regime for clients flagged `school` |
| MP8 | Sl. 3 (pure services to Government / local authority for Art. 243G / 243W functions): current scope; does it cover security / housekeeping at municipal offices or hospitals? | Manual exempt with typed reason only |
| MP9 | N 5/2017-CT registration exemption for a supplier making only RCM supplies: does it apply to a proprietor agency all of whose clients are registered? Does RCM turnover count for the ₹20 lakh threshold when it also has unregistered clients? | Note only |
| MP10 ★ | RCM invoice content (Rule 46: "whether tax is payable on reverse charge"); show the tax amount as memo? GSTR-1 B2B with RCM `Y`; e-Invoice `RegRev: 'Y'` for AATO ≥ ₹5 crore. | As stated |
| MP11 | Time of supply / invoice date for monthly contracts (Sec 31(5) continuous supply): last day of the month, or within 30 days of the month end? | Month end (setting) |
| MP12 ★ | Back-dated minimum wage / VDA arrears passed to clients: debit note (Sec 34) or supplementary tax invoice? Rate and RCM status of the original; time limit (30 Nov after the FY); GSTR-1 period. | Debit note per original invoice |
| MP13 | GST TDS u/s 51 by Government clients on forward-charge manpower bills (2 % above ₹2.5 lakh); none on RCM bills. | Hint only |
| MP14 ★ | Supply of manpower as "work" from 1 Apr 2026 (Sec 402(47)(f); Sec 393(1) Table Sl. 6(i) 1 % / 2 %): confirm the enacted Finance Act 2026 text (the Budget FAQ cites "402(27)"); TDS base excludes GST shown separately? | Contractor limb by bill date, base = taxable value |
| MP15 | Bills of FY 2025-26 where the client deducted 194J (2 % / 10 %) or 194C: any action for the agency (credit is by Form 16A either way)? | Accepted without alarm |
| MP16 ★ | Labour Codes from 21 Nov 2025: does the 50 % wage rule (Code on Wages Sec 2(y)) change PF / ESI / gratuity / bonus bases for payroll now, or only once the central / State rules are final? | Hint only; payroll unchanged |
| MP17 | OSH Code contract-labour threshold (50 workers) and the licence regime under the single licence; does the agency or the client hold it? | Reminder when a licence is entered; hint at ≥ 50 on a site |
| MP18 | Principal employer's duties for contract workers' social security (Code on Social Security): is the client entitled to withhold payment until proof? Is the site annexure adequate evidence? | Compliance pack; hold tracked, no posting |
| MP19 | Fixed-term employees' gratuity after one year: provisioning in the agency's books and in cost-plus bills. | Hint |
| MP20 | Overtime at ≥ 2 × the ordinary rate (Code on Wages / OSH): which "ordinary rate of wages" (basic + DA)? Billing OT to the client at the contract rate. | Hint on the OT pay head |
| MP21 | Bonus (8.33 % minimum), leave and relieving charges in cost-plus bills: billed as part of the value; bonus eligibility ceiling under the Code. | Typed percentages |
| MP22 | Minimum wages: does the app need anything beyond typed revisions (central sphere VDA every 1 Apr / 1 Oct; State notifications; national floor wage once notified)? | Typed only |
| MP23 | PSARA licence number on invoices: required by any State rule? | Optional print |
| MP24 | Deductions from guards' wages for uniforms / ID cards: permitted limits under the Code on Wages. | Payroll deduction head; no check |
| MP25 | Revenue presentation: the agency as principal (gross billing incl. wages) — AS 9 / Ind AS 115. | Gross |
| MP26 | Site P&L: apportioning employer PF / ESI by duties across sites; relievers' cost to the site they relieved. | By duties |
| MP27 | A client's compliance hold: show as receivable (aged) or as retention not yet due? | Receivable, aged |
| MP28 | Employees above the EPF / ESI wage ceilings at client sites; contract-worker PF on actual wages when the client demands it. | Existing payroll flags |
| MP29 ★ | Housing societies / RWAs as clients: an unregistered RWA → forward charge 18 % even from a proprietor agency? An RWA registered only because its turnover exceeds ₹20 lakh → RCM? | As stated |
| MP30 | 57th GST Council (8 Oct 2026) recommendation to extend e-invoicing to RCM inward supplies from unregistered persons (AATO ≥ ₹5 crore): impact on clients of unregistered proprietor agencies once notified. | Pending note only |
| MP31 | (Market) PSARA licence counts (16,427 in Jan 2022; 21,835 in Nov 2023, as reported) and any count of FM / housekeeping agencies. | — |
| MP32 | Muster units: a 12-hour shift billed as 1 duty or 1.5 eight-hour duties; half duties; billing days 26 vs calendar. | Post's shift hours; 0.5 steps; calendar default |

---

## 10. Test plan (summary)

| Layer | What | Where |
|---|---|---|
| Unit (node:test) | Every engine in `src/lib/manpower/`; rule rows by date and the `verified` set; import graph (`manpower-rules.ts` only from lazy manpower modules; engines import only first-paint / family modules; bridges are exactly `mp-*-io.ts`); registry maps; pack gate; print snapshot compare | `tests/mp-*.test.ts` |
| Statutory regression | Regime at 2018-12-31 / 2019-01-01; each entity type; client registered / unregistered / TDS-only / composition / school; TDS at 2026-03-31 / 2026-04-01; labour-code hints at 2025-11-20 / 2025-11-21 | `tests/mp-regime.test.ts`, `tests/mp-tds.test.ts`, `tests/mp-wage-check.test.ts` |
| Contracts with existing readers | `rcm` bill → GSTR-1 B2B reverse charge `Y`, e-Invoice `RegRev: 'Y'`; `exempt66` → Table 8 exempt; debit note → GSTR-1 CDNR; purchase contract (`mp-profit`) | `tests/mp-regime.test.ts`, `tests/mp-arrears.test.ts`, `tests/purchase-contract.test.ts` |
| Volume | 60 sites × 12 months × up to 300 rows: billing a month reads only that month's musters; payroll push touches only that month; site P&L reads one month | `tests/mp-bill.test.ts`, `tests/mp-attendance.test.ts`, `tests/mp-profit.test.ts` |
| Build | `f-manpower` in `tests/bundle-config.test.ts`; `check:size` per commit; Hindi in core unchanged (literal `defineArea`) | `scripts/check-bundle-size.mjs` |
| Existing suites | Must pass unchanged: `cn-*` (CN-D2), `payroll*`, `gst-reports*`, `einvoice*`, `tds-*`, `rcm*`, `help-registry`, `docs-links`, `i18n-areas`, `industry-packs`, `tv-*` | — |
| E2E | §7, appended `step(...)` blocks, each write awaited in IndexedDB before navigation | `tests/e2e/smoke.mjs` |
| Offline | `npm run verify:offline` after the last merge | `scripts/verify-offline.mjs` |

---

## 11. Size budget per package (gz, core = English precache)

| Package | First paint | Core (cap) | Planned split | Stop rule (cuts in §3 order) |
|---|---|---|---|---|
| R17-A | **0** (`mp` token in a lazy chunk; measured 182.1) | **≤ 11** | Desk + Sites view + site form 3.5, regime engine + rules 1.6, editor row 0.8, paper part 1.2, picker 0.9, strings 1.1, help / Ctrl+K / checklist / packs 0.8, demo 0.4, registry / shared / settings 0.7 | At 11 → cut 1 (annexure page), then 2 (escalation / skill / zone) |
| R17-B | 0 | **≤ 12** | Muster view + engine 3.8, bills view + bill engine 3.6, attendance push 1.2, import 1.2, TDS bridge 0.4, strings 1.0, help 0.4, demo 0.2 | At 12 → cut 1 (TDS footer), 2 (extra-duty units), 3 (import) |
| R17-C | 0 | **≤ 9** | Compliance view + engine + annexure 3.8, profit view + engine 2.4, site pick 0.6, wage check 1.0, strings 0.8, help 0.3, demo 0.1 | At 9 → cut 1 (hints b–d), 2 (12-month trend) |
| R17-D | 0 | **≤ 7** | Statutory view 2.0, arrears engine 1.6, TDS receivable 0.9, alerts 0.6, notes 0.2, strings 0.9, help 0.3, demo 0.1 | At 7 → cut 1 (licences), 2 (chase letter), 3 (notes) |
| **Round** | **0** | **≤ 39 + 1 reserve = 40** | Hindi pack ≤ 8 kB (`lang-hi-manpower`) | Core stays ≤ 3,143 kB after the round (3,103.0 + 40) |

Each package writes before / after numbers (initial, entry, core, Hindi pack, Hindi in core, `f-manpower`) in its
section of `docs/features/manpower-r17.md`.

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Packages overrun (R13–R15 1.2–2.5 ×) | **H** | M | Caps with pre-ranked cuts; one desk; shared strings in one area; engine-only items; numbers per commit; 1 kB lead reserve, not per package |
| `f-manpower` captures nothing because engines import shared lazy code | M | M | Bridges `mp-*-io.ts` hold every non-fixed import; `chunks.json` check per package; test on the import graph |
| Wrong RCM decision (entity type, LLP, client flags) — GST charged twice or not at all | M | **H** | Dated rows; declaration printed; client flags visible on the site; override with audited reason; MP1 / MP2 / MP29 ★ |
| Payroll attendance overwritten by a muster push | M | H | Preview; only employees in musters; refused on a finalised run; audit event |
| Labour-code rules change (draft central / State rules) | H | M | Hints only, `verified: false`; payroll engine untouched; rows appended when final |
| Minimum-wage tables are State-specific and change twice a year | H | M | No rule rows; typed revisions; VDA months only as reminders |
| Personal data on client annexures | M | M | Name, code, UAN last 4 only; no bank, Aadhaar or verification documents |
| Volume (600 guards, 60 sites) slows the desk | L | M | Rows inside one muster row per site × month; month-scoped reads; volume tests |
| First paint creeps | L | H | One token only; `check:size` must show 182.1 at each merge |
| Confusion with R11 CN-D2 labour contractors | L | L | Both stay; help topics point to each other; packs are a union |
