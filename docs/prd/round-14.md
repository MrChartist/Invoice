# PRD — Round 14: professional and knowledge-services firms (CA / CS / CMA firms, advocates and law firms, architects and interior designers, consulting and IT / software agencies including service exporters, digital marketing and media agencies, freelancers)

Status: draft for build · Drafted 2026-10-27 · Baseline: branch `claude/elegant-cannon-cwapiv` at `fbb9d60`. Merged on
the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–15, Round 7 (hotel), Round 8 (trading), Round 9 (retail), Round 10
(services), Round 11 (construction), Round 12 (agriculture) and Round 13 (manufacturing). No other round is being built
in parallel; §5 / §6 still list the files Round 14 shares with earlier rounds' registries.

Companion documents:
- `docs/CA_REVIEW.md` §14 — the professional-services CA items **PS1–PS40**, added with this PRD.
- Sources: §2.6 of this PRD (URL and the claim taken from each; P = primary text read, S = secondary, V = vendor's own
  claim). Unlike Round 13, the source list lives in the PRD, so it survives the session.

Every item follows `AGENTS.md`:
- local-first and serverless: no ICAI UDIN portal, MCA21, e-Courts, DGFT, RBI EDPMS / AD-bank, STPI, TRACES, income-tax,
  GST or bank calls; files, `wa.me` / `mailto:` links, the device camera and files the user picks only;
- vanilla CSS Modules with tokens; templates use the `accent` variable only (Critical Rule 5);
- invoice snapshots never change: everything a professional's fee note prints is snapshotted on the document;
- Indian-FY numbering for every new series;
- bare dates parsed as local days;
- statutory values date-keyed and append-only, in a rule file kept out of first paint;
- GST, TDS, FEMA, presumptive-tax and partnership outputs labelled as working papers ("verify with your CA");
- professional-conduct prompts (Bar Council, ICAI, Council of Architecture) are reminders, never legal advice, and the
  app never decides whether a fee, a conflict or a deposit is allowed.

---

## 1. Problem statement

Professionals were the app's first users. The `services` business type (8H) was built for them, and several rounds
added pieces they use every day:
- **6.13 / 6.14** (`docs/features/time-expenses.md`): timer, timesheet, mileage, re-billable expenses with markup or
  **pure agent** (Rule 33), "Unbilled → Bill" into a draft invoice, derived billing state through `bill_refs`;
- **R3-B** (`service-billing-r3.md`): rate cards (task → project → client → work type → default), re-rate unbilled,
  projects on cost centres (hours / fee budget, task board, 80 / 100 % bell), **hour-block retainers** (drawdown,
  rollover, forfeit, overage), the timesheet **annexure** page, party document defaults, repeat last bill, customers gone
  quiet;
- **R3-C6** (`docs-compliance-r3.md`): the **practice desk** `/practice` — one read-only compliance row per company on the
  device (GST / TDS returns filed or due, DSC expiry, monthly client checklist), for a CA who keeps clients' books here;
- **R2-B2 / R2-B3 / 8G**: progress (milestone) billing from a quotation or order, proposal sections and snippets on a
  quotation, offline quote acceptance with a signature;
- **advances** (5.3, GST on receipt for services), **TDS receivable register** with Form 16A tracking and a 26AS / AIS CSV
  match (`tds-register.ts`, labels Form 131 / 168 from TY 2026-27 via `ita2025.ts`), outward reverse charge (`rcm.ts`),
  import-of-services RCM on bills, the **currency master** and `fx.ts` / `fx-gain.ts`, the **LUT register** and the export
  realisation register with IRMs / e-BRC (R4-C1 / C2), the annual accounts pack with entity types (proprietorship /
  partnership / LLP / company), `Drawings` ledger 1010;
- **R10 SV-A1** gave the service picker a `professional` choice that keeps today's preset (no pack, lands on `/invoice`);
  R10 also added `service_staff` and `TimeEntry.staff_id` (workshop technicians).

But the owner's test is **"each and everything has a perfect area in our invoice"**, and a CA firm, a law chamber, an
architect, a 12-person software agency or a freelancer billing in dollars still keeps a large part of its practice
outside the app (§2.2, §2.4):

1. **No matter / engagement.** A project is a cost centre with a budget. There is no matter code, no engagement record
   that states the billing model (time and materials, fixed fee, milestones, retainer, capped fee, success fee), no
   engagement letter tied to it, no responsible partner, no renewal.
2. **One billing model.** "Unbilled → Bill" prices time at its captured rate. A fixed-fee or capped engagement still
   tracks time, but nothing compares the time's value with the fee; a success fee has no event; a deposit-style retainer
   (law firm) is not an hour block.
3. **No write-up / write-down, no realisation.** At billing, the partner cuts 6 hours to 4 or bills ₹40,000 for ₹52,000
   of time. The app keeps no standard value, so realisation (billed ÷ worked, collected ÷ billed), WIP ageing and WIP
   write-offs do not exist; the year-end unbilled work has no working paper (AS 9 / ICDS IV).
4. **No utilisation.** Time entries carry no timekeeper (except R10 workshop jobs); there is no capacity, cost rate or
   target, so utilisation and matter profitability are guesses.
5. **Disbursements are half done.** Pure-agent lines from the timesheet flow are billed at 0 %, but GSTR-1 still reports
   them as **nil-rated** supplies in Table 8 and the HSN summary (the QA8 T9 exclusion only covers the R8 charge-head
   line, checked in `gst-reports.ts`). Court fees, stamp duty, ROC / government fees paid in cash have no matter tag and
   no "unrecovered disbursements" view.
6. **Advocates.** Legal services to a business entity are under **reverse charge** (N 13/2017-CT(R) entry 2), and many
   are exempt (N 12/2017-CT(R) entry 45). The app has outward RCM, but nothing chooses it by client type, prints the
   advocate's fee-memo wording, or explains why an advocate making only RCM supplies need not register. There is no
   conflict check and no **client-money** (trust) ledger — Bar Council Rules 25–28 require accounts of client money.
7. **Exports of services.** The realisation register was built for goods: the clock starts on the shipping-bill date
   ("flagged" when it falls back to the invoice date, which is the correct start for services). **RBI's FEMA (Export and
   Import of Goods and Services) Regulations 2026 apply from 1 Oct 2026**: SOFTEX is gone, an **Export Declaration Form
   (EDF)** is filed for services, and — after the 22 Sep 2026 amendment — realisation is **9 months from the invoice date**
   (12 for INR-invoiced), not the 15 months the app holds since Nov 2025 (§2.3a, PS15). The **Sec 2(6) IGST** test and
   the place-of-supply exceptions (immovable property for architects, PS6) are not checked; the indent-agent note still
   says "intermediary — not an export", which **Finance Act 2026 reversed from 30 Mar 2026** (PS4).
8. **Multi-currency time billing.** Rates are typed "in the invoice currency"; nothing converts a dollar rate card, shows
   the Rule 34(2) rate used, or books the fees PayPal / Wise / Payoneer / Upwork deduct before the money reaches India.
9. **Firm statutory desk.** Nothing models partners: capital and current accounts, profit-sharing ratio, interest on
   capital (≤ 12 %), remuneration within **Sec 40(b)** (now Sec 35 of the 2025 Act), drawings, the year-end appropriation,
   or **TDS u/s 194T** on partner payments (from 1 Apr 2025). Nothing prepares the **44ADA / Sec 58** presumptive working
   paper that most freelancers and small practices file on.
10. **CA / CS / CMA firms** keep clients' compliance on the practice desk, but **billing** those clients (per return, per
    certificate, monthly retainer, government fees recovered) is typed by hand, and there is no **UDIN register** although
    ICAI has required UDINs on certificates and audit reports since 2019.

**Goal of Round 14:** ship **20 items in four work packages** with mostly disjoint files:
- **PS-A**: the professional profile and the **practice core** — matters and engagements (with letters and conflict
  checks), billing models and the pre-bill with write-ups / write-downs, WIP / realisation / utilisation, and the
  professional paper — 5 items;
- **PS-B**: **disbursements, legal and trade specifics** — disbursements and pure agent (including the GSTR fix), advocates'
  RCM / exemption and fee memos, the client-money ledger, architects' and interior designers' stage billing, and media
  agencies' pass-through — 5 items;
- **PS-C**: **export of services and multi-currency** — the Sec 2(6) / place-of-supply check (with the intermediary
  change), FEMA 2026 (EDF, realisation from the invoice date), IRM / FIRA / e-BRC and the refund statement for services,
  multi-currency rate cards and platform receipts, and the freelancer's registration threshold — 5 items;
- **PS-D**: **the firm's statutory desk** — partners and profit sharing (Sec 40(b) / Sec 35), TDS u/s 194T, the 194J
  receivable side by client, the 44ADA / Sec 58 presumptive paper, and the CA / CS / CMA desk (compliance billing from
  the practice desk, UDIN register) — 5 items.

### How the professional profile switches on (no clutter for others)

- **No new `BusinessType`** (`shop-mode.ts` is first paint and stays untouched). R10 already writes business type
  `services` with `service_kind: 'professional'`; Round 14 adds the additive settings field **`prof_kind`** under it (the
  R8 `trade_kind` … R13 `mfg_kind` approach), and an entity question that drives the partners desk:

  | `prof_kind` | Who | Sub-choice | Packs turned on | Why |
  |---|---|---|---|---|
  | `ca` | CA, CS or CMA firm / practitioner | `ca_body: 'icai' \| 'icsi' \| 'icmai'` | `practice`, `cafirm` (+ `partners` for a firm) | Compliance billing, UDIN, practice desk link |
  | `legal` | Advocate, chamber, law firm | `legal_side: 'litigation' \| 'advisory' \| 'both'` | `practice`, `legal` (+ `partners`) | Matters, conflicts, RCM, client money |
  | `design` | Architect, interior designer, landscape / structural consultant | `design_kind: 'architect' \| 'interior' \| 'engineer'` | `practice`, `design` (+ `partners`) | Stage fees on project cost, fit-out pass-through |
  | `consulting` | Management / IT / software / engineering consultancy, dev shop, SaaS services | `exports: boolean` | `practice` (+ `svcexport` when exports; + `partners`) | Time and fixed fee, exports |
  | `agency` | Digital marketing, media, advertising, PR, content studio | `media_buying: boolean` | `practice`, `media` (+ `svcexport` when exports) | Retainers, media pass-through |
  | `freelancer` | One person: developer, designer, writer, consultant | `exports: boolean` | `practice` (+ `svcexport` when exports) | Presumptive paper, threshold, dollar invoices |
  | `other` | Any other professional | — | `practice` | Shared core only |

  `firm_form: 'proprietor' | 'partnership' | 'llp' | 'company'` is asked once (it already exists as the annual pack's
  entity type; A1 reads and writes the same value, never a second field) and adds `partners` for a partnership or LLP.
  Business type stays `services`, `service_kind` stays `professional`, so every existing professional company sees exactly
  what it saw (`prof_kind` absent = today).
- **Seven new packs** in `industry-packs.ts` (lazy module; `PackId` is a type, zero bytes): `practice` (shared core),
  `cafirm`, `legal`, `design`, `media`, `svcexport`, `partners`. `agency` is already the R8 arhatiya pack, hence `media`.
  `partners` and `svcexport` are useful outside this round's profiles (any partnership firm; a manufacturer exporting
  engineering services): Settings → Features lists them for every company.
- **Placement, never a new route or sidebar item:** desk tabs on **`/time`**, the existing lazy route that already holds
  timesheets, projects and retainers (R3-B) and the R10 desks. Six new rows in `TIME_TABS` (`page-tabs.ts`, listed through
  `visiblePackTabs`; views in `&view=`):
  - `matters` (pack `practice`; views `matters`, `engagements`, `conflicts`, `letters`, `stages` with `design`);
  - `wip` (pack `practice`; views `wip`, `prebill`, `realisation`, `utilisation`, `profit`);
  - `clientmoney` (pack `legal`, `alsoPacks: ['cafirm']`; views `ledger`, `reconcile`, `statements`);
  - `exportsvc` (pack `svcexport`; views `checker`, `edf`, `realisation`, `refund`, `platforms`);
  - `firm` (pack `partners`, `alsoPacks: ['practice']` — the presumptive and 194J views need no partners; views
    `partners`, `appropriation`, `tds194t`, `presumptive`, `tds194j`, `threshold`);
  - `cadesk` (pack `cafirm`; views `fees`, `events`, `udin`).
  `PACK_ROUTES` is not changed (`/time` is a module route every profile keeps).
- Settings → Features shows a **"Professional profile"** row for every `services` company (and "Custom"). Turning a pack
  off deletes nothing.
- The **professional paper** (PS-A5) is not pack-gated: it prints whenever a document carries the `ps` snapshot.

### Budgets the packages must respect

Measured by the PRD author on the baseline (`vite build` + `node scripts/check-bundle-size.mjs`, gzip -9, KiB):

| Budget | Now | Limit | Headroom | Round 14 share |
|---|---|---|---|---|
| Initial JS (first paint, gz) | **184.8 kB** | 185 kB | ≈ 0.2 kB | **≤ +0.06 kB total** (target ≈ +0.02) |
| Entry chunk (gz) | 71.2 kB | 90 kB | 18.8 kB | ≤ +0.1 kB (lazy-import map churn only) |
| Total JS (gz) | **3,295.3 kB** | 3,400 kB | 104.7 kB | **≤ +60 kB** (stop and ask at +90 kB) |

**Lesson from Round 13.** Its packages were planned at 18 / 14 / 14 / 14 kB (60 kB) and measured MF-A **+41.8 kB**, MF-B
**+35.9 kB**, and the round as a whole moved the total from 3,147.3 to 3,295.3 kB (**+148 kB, 2.5 × the plan**; R12 was
3 ×). The causes are known (`docs/features/mfg-r13.md` §bundle): English + Hindi strings per desk (≈ 4 kB a desk), help
topics for every view (≈ 3 kB), wizard / Features / palette wiring (≈ 4 kB), stubs, demo blocks and desk-local helper
chunks.

**Budget raise — proposed now, with the reason.** At the R13 ratio, Round 14 would land near +120–150 kB, i.e.
3,415–3,445 kB, **over the 3,400 kB total**. First paint (the hard limit) is not affected — every R14 byte is lazy — and
the total is the one-time offline precache (≈ 3.3 MB gz). Two choices for the lead, before PS-A starts:
1. **Raise the total budget to 3,500 kB** (`BUDGET_TOTAL_GZ_KB`, with a note in `check-bundle-size.mjs` like the earlier
   raises) and keep the 20 items. **Recommended:** one more round of verticals is planned after this one, and the 3,400
   line was set before R12–R13 added ≈ 250 kB of lazy desks.
2. Keep 3,400 kB and build the round in priority order, stopping when the total reaches 3,390 kB; §3's rank decides
   what drops (D5's UDIN register, B5, C5 and A4's profitability view first).

Whichever is chosen, the plan below is written to **+60 kB** with stricter rules than R13:
- **First paint: ≈ 0 (≤ +0.06 kB), by design.**
  - **One new record key, no line key.** Everything Round 14 prints from an invoice lives under one additive record key
    **`ps`** (the professional snapshot, with a per-line map `ps.lines[lineId]`), kept by `normalizeRecord` through a
    one-element `R14_RECORD_KEYS = ['ps']` spread into the existing `R9_RECORD_KEYS` list in `invoice-defaults.ts` (the
    R12 `ag` / R13 `mf` precedent: +4 to +15 B measured).
  - The pure-agent fix (B1) needs **no key at all**: new disbursement lines reuse the existing R8 line key
    `charge_head_id` (sentinel `'rule33'`) and the shared `PURE_AGENT_CHARGE` text, so `isPureAgentLine` — already read
    by GSTR-1, e-Invoice and e-Way — recognises them unchanged.
  - If first paint is above 184.95 kB when PS-A starts, PS-A stops and asks the lead before adding the key. Default: add
    `ps` (the only structured way to reprint a matter code, engagement reference, UDIN, purpose code and stage particulars).
  - No `PACK_ROUTES`, `PACK_OF_TYPE`, `TABLE_ACTIONS`, `WATCHED_TABLES`, `no-cash.ts`, `tax-rules.ts` or shell edit. Table
    rights and audit labels register at runtime (`src/lib/prof/ps-registry.ts`, the `tr-registry.ts` / `mf-registry.ts`
    pattern).
  - Template additions are lazy parts (the R12 `AgriBlock` / R13 `MfgBlock` pattern), mounted only when `ps` is present.
- **Total JS for the round ≤ +60 kB gz**: PS-A ≤ 18 kB, PS-B ≤ 14 kB, PS-C ≤ 13 kB, PS-D ≤ 15 kB (strings, help,
  palette and demo included).
- **Six desks, not more.** Trade specifics (architects' stages, media pass-through, advocates' fee memo) are views or
  lazy editor rows inside the six desks, never desks of their own.
- **Strings stay with their desk** (one area per desk: `prof-r14a-matters.ts`, `prof-r14a-wip.ts` …), and a desk's area
  holds only that desk's words; the ≈ 30 words every desk uses (matter, engagement, client, partner, fee, disbursement,
  write-down, realisation …) live **once** in `prof-r14-common.ts` (≤ 1 kB gz) — the R13 "per-desk rule" cost ≈ 0.6 kB
  per package in duplicates.
- **Help is short.** One topic per view, ≤ 240 characters each in English and Hindi, statutory detail by CA id
  (`ca: ['PS4']`) instead of prose; the glossary takes ≤ 15 terms.
- **No stubs.** PS-A writes no `R14Stub.tsx`: a tab whose package has not merged is simply not in `TIME_TABS` yet; each
  package adds its own `TIME_TABS` row, help topics and Ctrl+K titles in its own commit (§6) — the R13 stubs cost
  1.7 kB and were all thrown away.
- **No desk kit.** Shared UI comes from existing components (`LinesGrid`, `ItemFilterBar`, `controls.module.css`, the R3-B
  board / report parts); a new shared component is allowed only when two desks use it and it is ≤ 1 kB gz.
- **Rule data is a chunk.** Statutory values go in `src/lib/prof-rules.ts` (new, imported only by lazy screens and
  engines, never by `tax-rules.ts`, `shop-mode.ts` or the shell). Values that already live elsewhere **stay there**: TDS
  sections, rates and thresholds (`tds-rules.ts` — PS-D appends the `194T` rows there, dated), Form numbers and 2025-Act
  labels (`ita2025.ts`), export realisation (`trade/trade-rules.ts` — PS-C appends the FEMA 2026 rows there, dated),
  advance-tax / GST advance rules. `tests/ps-rules.test.ts` checks the import graph.
- **Icons: reuse only** (grep before use; a new icon name fails review). Candidates already imported on the baseline:
  `Scale` (legal, conflicts), `Building2` (practice, matters), `ClipboardList` (engagements, UDIN), `Clock` / `Timer`
  (WIP), `BarChart3` (realisation, utilisation), `Wallet` (client money), `Globe` (exports), `Banknote` (platforms,
  receipts), `Landmark` (partners, appropriation), `Percent` (194T / 194J), `ShieldCheck` (conflicts cleared), `Ruler`
  (design stages), `Search`, `FileText`, `Receipt`, `Users`. `Briefcase`, `Gavel`, `Handshake`, `Stamp`, `Megaphone`,
  `Gauge`, `PieChart`, `FileSignature` and `Plane` are **not** imported. PS-A re-greps before its first commit.
- Each package records before / after numbers in its section of `docs/features/professional-r14.md`.

### Non-goals

These need a server, a regulator or partner system, or are outside billing and books:
- ICAI UDIN portal generation / revocation, MCA21 filings (LLP Form 8 / 11, AOC-4, MGT-7), e-Courts / NJDG case status,
  court-fee e-stamping, DGFT e-BRC generation, RBI EDPMS / AD-bank EDF filing, STPI portal, TRACES (Form 131 download,
  justification reports), income-tax e-filing, GST portal (LUT filing, refunds). The app produces files and working papers.
- Legal-practice features beyond billing and books: document assembly, court diary with cause-list scraping, e-filing,
  limitation calculators, legal research, LEDES / UTBMS e-billing for foreign corporate clients (a CSV export of the
  annexure covers the common case).
- A client portal with logins (the app has no server); clients receive PDFs, share links and `wa.me` messages.
- Payroll beyond the existing module (articled assistants' stipend is ordinary payroll), professional-tax registration of
  the firm, ICAI peer review / quality review files, KYC under PMLA for CAs / CSs (a reminder only, §8 Q31).
- Advice on professional conduct: the app records conflict checks, deposits and fee bases; whether something is allowed
  is the professional's own call (Bar Council / ICAI / COA rules are cited, not interpreted).

---

## 2. Findings

### 2.1 What professional firms use and praise / complain about (research)

P = official text read; S = secondary (press, blog, review site); V = vendor's own claim. Full list in §2.6.
Independent reviews of Indian practice software are thin; vendor claims are marked.

| Segment | Tools they use | Praised for | Complaints / gaps | Source |
|---|---|---|---|---|
| Law firms (global) | Clio Manage, PracticePanther (PantherAccounting Plus, Apr 2026), Bill4Time | Matters; hourly / flat / contingency billing; trust ledgers tied to client **and** matter; three-way trust reconciliation; conflict checks across parties and related contacts; utilisation / realisation / collection dashboards; pre-bills reviewed by partners | US-centric (IOLTA, LEDES); conflict checks miss complex multi-party cases; Clio's two help pages define realisation differently (with / without write-offs) | V clio.com (trust, insights, pricing); S lawyerist, fitsmallbusiness; V practicepanther.com (trust, 3-way reco); S lawnext (Apr 2026); V bill4time.com; S Technolawyer review |
| Time billing (generic) | Harvest, FreshBooks, Zoho Invoice / Books | Uninvoiced report; billable + cost rates per person; project budget; utilisation = billable ÷ available hours (70–80 % target); retainers; Zoho's four project billing methods (fixed cost, project hours, task hours, staff hours) | No write-down history or realisation; retainers / profitability in higher tiers; no Indian export papers | V getharvest.com; V freshbooks.com; V zoho.com/books help |
| Accounting firms (global) | Ignition (proposals → engagement letters → automatic billing), Karbon (engagements, WIP, realisation report by work / member / role, billing dashboard) | Engagement letter signed before work; billing from engagement terms reduces aged WIP; realisation by client informs renewal price | Two subscriptions; Karbon Engagements still "early access"; no Indian GST / UDIN | V ignitionapp.com; V karbonhq.com (engagements, release notes Feb 2025 / Feb 2026); S cpapracticeadvisor |
| Indian CA firms | Suvit / TaxOne (Vyapar), Zoho Practice, Jamku, CADashboard, Excel + Tally | Client-wise compliance tracking, document folders, WhatsApp follow-ups, Tally link | Billing of compliance work, UDIN register and realisation kept outside; most claims are the vendors' own blogs | V suvit.io blog; V taxone.vyapar.com; TaxCloud: nothing found |
| Indian advocates | Tally / Excel / fee registers; a few cloud diaries | Case diary | Client-money accounts kept in registers; GST RCM wording typed by hand | S jurigram (Indian trust accounting guide) |
| Freelancers / IT exporters | Skydo, Wise, Payoneer, PayPal, Razorpay (receipts, FIRA), Refrens / Zoho Invoice | Dollar invoices, FIRA / e-FIRC per receipt | GST zero-rating, LUT, EDF / SOFTEX and 2(6) conditions explained in blogs, not tools; platform fee deducted abroad confuses books | S winvesta, skydo, razorpay, xflowpay blogs |

**What carries over to an offline app:**
- **The matter / engagement as the unit of truth** — client, matter code, billing model, letter, responsible partner,
  parties for conflicts — on top of the existing project cost centre (which Clio / Karbon-class tools have and Tally does
  not).
- **The pre-bill**: unbilled time and disbursements reviewed per matter, cut or raised with a reason, so realisation is
  measured where it happens.
- **Dashboards that answer a partner's question**: who is under-utilised, which client's work is written down, which
  matter loses money, what WIP is older than 90 days.
- **Statutory papers** a professional's CA asks for each year: RCM and exemption for legal services, pure-agent
  disbursements, the 2(6) test, FEMA / EDF / e-BRC, 194J receivable, 194T, Sec 40(b), 44ADA / Sec 58.

Offline work, Hindi, the recycle bin, full audit and real books (GSTR-1 / 3B, Tally export, TDS returns) are our edge.

### 2.2 Anatomy of the professional's documents (every element needs a place)

"Doc" = where it must print. "Today" = the baseline. Items close each row.

| # | Element | Who | Doc | Today | → |
|---|---|---|---|---|---|
| 1 | Matter code and matter name (client / case / project), engagement reference | every firm | fee note, annexure, statement | project name on a line (cost centre) | A2, A5 |
| 2 | Billing basis: "Fixed fee — stage 2 of 4", "Time: 12.5 h @ ₹4,000", "Capped at ₹2,00,000 (₹1,62,000 used)", "Success fee on …" | every firm | fee note | rate / qty only | A3, A5 |
| 3 | Timesheet annexure (who, date, task, hours, rate) | T&M firms | following page | R3-B4 annexure | — (reused; A3 adds write-down column) |
| 4 | Disbursements shown separately as pure agent (court fee, stamp, ROC / govt fees) | advocates, CAs, CSs | fee note | 0 % line; **reported nil-rated in GSTR-1** | B1 |
| 5 | "GST on this supply is payable by the recipient under reverse charge — N 13/2017-CT(R)" / "exempt — N 12/2017-CT(R) entry 45" | advocates | fee memo | outward RCM wording exists; no legal-services choice | B2 |
| 6 | Advocate's enrolment no. / bar council, chamber address | advocates | fee memo header | free text | B2, A5 |
| 7 | UDIN of the certificate / report billed | CAs (and CS / CMA where their institute requires) | fee note line | — | D5, A5 |
| 8 | Stage fee on project cost: "Stage 3 — working drawings: 25 % of 6 % × ₹4.2 cr" | architects | fee note | progress billing by % of a quotation | B4 |
| 9 | Media cost vs agency fee / commission, release order no. | media agencies | invoice, RO | re-billed expense with markup | B5 |
| 10 | Client-money statement (received, paid out, transferred to fees, balance) | advocates, CAs holding deposits | statement | — | B3 |
| 11 | "Supply meant for export under LUT ARN … without payment of IGST", exchange rate, purpose code, SWIFT / IBAN | exporters | export invoice | LUT text, rate (R4-C1, 3.4); no purpose code | C1, C4, A5 |
| 12 | EDF no. and date (from 1 Oct 2026; SOFTEX before) | software / service exporters | register, invoice reference | — | C2 |
| 13 | IRM / FIRA / e-BRC per invoice; realisation due date | exporters | register, refund statement | goods-first register (R4-C2) | C2, C3 |
| 14 | TDS expected (194J 10 % / 2 %, 194C for advertising) and Form 131 (16A) received | every firm | fee note footer, register | `tds_amount` / section on the invoice; register | D3 |
| 15 | Partner capital / current account statement, appropriation | partnership / LLP | annual pack | — | D1 |
| 16 | 194T TDS on partner remuneration / interest | partnership / LLP | 26Q (Form 140) working paper | — | D2 |
| 17 | Presumptive income (50 %) and limit test | freelancers, small practices | working paper | — | D4 |
| 18 | Per-return fee lines for a CA's client (GSTR-1 ₹…, 3B ₹…, ITR ₹…) and government fees recovered | CA / CS firms | monthly bill | typed by hand | D5 |

### 2.3 Statutory rules (as understood; every row is a CA item)

Confidence: **H** = statute / official text read or long settled; **M** = consistent secondary sources or recalled
text; **L** = sources conflict or nothing found. **Verified** = the claim was read in a primary source this round, or
in two or more independent secondary sources that agree; otherwise **verify with CA**. Every row is also a CA item
(§8, `CA_REVIEW.md` §14) — "verified" means the developers are confident of the text, not that a CA has signed off.

| Rule | What applies | App today | Source | Confidence / status |
|---|---|---|---|---|
| Legal services — RCM | N 13/2017-CT(R) (28 Jun 2017, from 1 Jul 2017) entry 2: legal services (incl. representational) by an individual advocate incl. a senior advocate, or a firm of advocates, to a **business entity** in the taxable territory → recipient pays; a business entity that is litigant / applicant / petitioner is the recipient; corrigendum 25 Sep 2017; CBIC press release 15 Jul 2017; J.K. Mittal (Delhi HC W.P.(C) 5709/2017) challenge — outcome not found | Outward RCM per invoice (`rcm.ts`), typed | P gstcouncil.gov.in (N 13/2017 corrigendum PDF), P CBIC press release; S taxscan, barandbench, ssrana | H / **verified** (entry); L (challenge) → PS1 |
| Legal services — exemption | N 12/2017-CT(R) entry 45: advocate / firm → another advocate or firm of advocates; → any person other than a business entity; → a business entity with aggregate turnover up to the registration threshold in the preceding FY (wording since N 21/2019-CT(R), 1 Oct 2019; ₹20 lakh / ₹10 lakh before); senior advocate → advocate not exempt (as reported) | — | S gstgyaan, cleartax, caclubindia, lawtrend | M / verify (current wording) → PS1 |
| Advocates' registration | A person making only supplies on which the recipient pays under RCM need not register (Sec 23(2), N 5/2017-CT) — recalled | — | Recalled | M / verify → PS2 |
| Pure agent (Rule 33) | Expenditure as a pure agent excluded from value when **all** conditions hold: contract makes the supplier a pure agent; recipient liable to pay the third party; recipient authorises; shown separately; actual amount only; procured goods / services not used by the supplier for its own interest; incidental costs of the supplier's own service are taxable | 0 % line (timesheets) **reported as nil-rated**; R8 charge-head line excluded (QA8 T9) | P CBIC tax-information Rule 33 page (heading); S gstzen, taxguru, busy.in | H / **verified** → PS3 |
| Export of services, Sec 2(6) IGST | (i) supplier in India, (ii) recipient outside India, (iii) place of supply outside India, (iv) payment in convertible foreign exchange **or in INR wherever permitted by RBI**, (v) not merely establishments of a distinct person (Explanation 1 to Sec 8); Circular 202/14/2023-GST (27 Oct 2023): receipts in INR via Special Rupee Vostro Accounts meet (iv) | LUT / export documents by supply type; no 2(6) check | P CBIC Circular 202/14/2023 (gstcouncil.gov.in PDF); S taxguru, fintaxblog | H / **verified** → PS5 |
| Intermediary — Sec 13(8)(b) IGST | **Omitted by Sec 157 of the Finance Act 2026 (No. 4 of 2026, assent 30 Mar 2026)**, on the 56th GST Council's recommendation (3 Sep 2025); place of supply now Sec 13(2) (location of recipient), so an intermediary for a foreign principal can export if 2(6) is met; Sec 2(13) definition unchanged; effective date read as 30 Mar 2026 (no separate commencement); a saving for pending matters is disputed | `tr-indents.ts` prints "intermediary — not an export" for every date | S Grant Thornton (fetched), taxguru, AMSS, ICAI CA Journal, winvesta; P not read | H (omission) / **verified**; M (date, saving) → PS4 ★ |
| Place of supply exceptions | Sec 13(3)–(12) IGST: services on goods made physically available, services needing the recipient's physical presence, **services directly in relation to immovable property** (architects, interior designers, surveyors — location of the property, Sec 13(4)), events, banking / intermediary (now omitted) etc. → place of supply in India for property here, so not an export | — | Recalled (statute) | H / verify application to design services → PS6 ★ |
| Exchange rate (Rule 34) | Goods: the CBIC-notified customs rate (Sec 14 Customs Act) on the time of supply; **services: the rate under generally accepted accounting principles on the date of time of supply (Sec 13)** — Rule 34 substituted by N 17/2017-CT (27 Jul 2017); one ICAI-hosted copy shows older RBI-reference wording | Currency master rate on the invoice date (8H); "CBIC / shipping-bill rate" hint for goods | S gstzen, taxguru, caclub, fintaxblog (agree); ICAI copy (conflicting, older) | M / verify → PS7 |
| FEMA — exports of services (from 1 Oct 2026) | **FEMA 23(R)/2026-RB (13 Jan 2026)**, the FEM (Export and Import of Goods and Services) Regulations 2026, in force 1 Oct 2026: EDF for services (incl. software) within 30 days of the end of the invoice month (Reg 3(2)); services other than software may file on or before receipt (Reg 3(2)(b)); specified authority = AD bank (services), AD bank or **STPI** (software), DC (SEZ); **SOFTEX removed**; invoices ≤ ₹10 lakh: EDPMS closure on the exporter's declaration (Reg 4(2)); realisation **9 months from the invoice date** for services (Reg 5(1)(a)), **12 months** if invoiced or settled in INR (first proviso), AD may extend (second proviso) — the 9 / 12 replaced 15 / 18 by FEMA 23(R)(1)/2026-RB (22 Sep 2026, gazette 24 Sep 2026) | `EXPORT_REALISATION_MONTHS_RULES`: 9 from 2013-04-01, **15 from 2025-11-13**; clock from the shipping bill; no EDF | P rbi.org.in notification 13277 (fetched twice); S taxmann, taxheal, majmudarindia, winvesta | H / **verified** (text); M (which periods apply to invoices of Oct 2025 – Sep 2026) → PS15 ★, PS16 |
| e-BRC / FIRA for services | DGFT e-BRC built on banks' IRMs, self-certified against invoices / SOFTEX (now EDF); covers IT / ITeS and other services (one source says goods and software only); FIRA / e-FIRC = bank's proof of receipt, e-BRC = DGFT's — refunds of services exports usually ask for both; revised Appendix 2U with GSTIN / invoice fields (one source, Jan 2026) | IRM / e-BRC register (R4-C2) | S vjmglobal, india-briefing, razorpay, winvesta, skydo; P dgft.gov.in (landing only) | M / verify → PS17 |
| Equalisation levy | 2 % levy on e-commerce operators abolished from 1 Aug 2024 (Finance (No. 2) Act 2024); 6 % levy on online advertising abolished from 1 Apr 2025 (Finance Act 2025, by amendment of 24–25 Mar 2025) | — | S Business Today, YourStory, KNAV, Fox Mandal (agree) | H / **verified** → PS38 (no module) |
| SEIS | Services Exports from India Scheme ended for exports from 1 Apr 2020; FTP 2023 did not revive it; RoDTEP is for goods; a parliamentary committee suggested a replacement (Apr 2026), nothing notified | — | S mondaq (FTP 2023), razorpay, indiaseatradenews | M / **verified** (none current) → PS38 |
| 194J (receivable side) | Professional fees **10 %**; technical services, call-centre operators (payee only in call-centre business) and certain royalty **2 %**; threshold **₹50,000** per FY for each limb from 1 Apr 2025 (₹30,000 before); 2025 Act: Sec 393(1) Table Sl. 6(iii) from 1 Apr 2026, rates unchanged; TDS on fee excluding GST shown separately (Circular 23/2017, recalled); client → advertising agency: **194C** (Circular 715 of 1995, Circular 5/2016), agency → media: no 194C | Register by invoice; section typed per invoice | S tdsman (2026), calcguru, taxbuddy, quicko (agree); P incometaxindia Circular 715 page (link only); S vjmglobal, sortingtax | H / **verified** (rates, threshold); M (call-centre, advertising) → PS18 ★, PS25 |
| 194T (partners) | From **1 Apr 2025**: a firm (incl. LLP) deducts **10 %** on salary, remuneration, commission, bonus or interest to a partner when the FY aggregate exceeds **₹20,000**; drawings, exempt profit share and reimbursements outside; credit or payment, whichever earlier (as reported); 2025 Act section / table entry and RPU code not found | — | S taxmann, Lakshmikumaran & Sridharan, vjmglobal, tdsman, treelife (agree) | H / **verified** (rate, threshold, date); L (2025 Act label, code) → PS19 |
| Sec 40(b) / 2025 Act Sec 35 | Remuneration to **working** partners, authorised by the deed: book loss or first ₹6 lakh of book profit — higher of ₹3 lakh or 90 %; balance 60 % (from AY 2025-26; ₹1.5 lakh / ₹3 lakh before); interest on capital ≤ **12 %** simple; neither allowed when the firm is taxed under 44AD / 44ADA; 2025 Act Sec 35(e) (as reported) | — | S taxadda (fetched), taxmann, taxroutine, calcguru | H (40(b) slabs) / **verified**; M (Sec 35 mapping) → PS20 ★ |
| Partner's share / GST on partner pay | Share of profit exempt in the partner's hands (Sec 10(2A), recalled); remuneration taxable as business income (Sec 28(v), recalled); GST on partner remuneration — no circular; practitioners treat it as outside GST | — | S taxtmi, taxheal (ICAI raised the issue) | M / verify → PS21 |
| 44ADA / Sec 58 | 1961 Act: resident individual / partnership firm (not LLP) in a 44AA(1) profession; gross receipts ≤ ₹50 lakh, **₹75 lakh** when cash receipts ≤ 5 % (from FY 2023-24); 50 % deemed; advance tax in one instalment by 15 Mar (Sec 211, recalled). **2025 Act Sec 58** consolidates 44AD / 44ADA / 44AE in a table (from TY 2026-27): professionals ₹50 lakh / ₹75 lakh with the 5 % cash test (Sec 58(2) Table Sl. 3, as reported) | — | S taxguru, studycafe, wisebooks, taxscan, cleartax (agree); one older source shows the 95 % digital-receipts wording | H (limits) / **verified**; M (Sec 58 eligibility wording) → PS22 ★ |
| Revenue on unbilled work | ICDS IV: service revenue by percentage of completion; option of completed-service method for contracts ≤ 90 days; early stage (≤ 25 % complete): revenue to the extent of cost recoverable; AS 9 / Ind AS 115 for the books | — | S taxguru, cleartax, taxheal (agree); P incometaxindia ICDS list (link) | H / **verified** (ICDS IV) → PS23 ★ |
| Contingent fees — advocates | BCI Rules Part VI Ch. II Sec. II **Rule 20**: an advocate shall not stipulate a fee contingent on the results of litigation or agree to share the proceeds; Rule 21: no share in actionable claims | — | S ipleaders, Kluwer arbitration blog, multiple (agree); P not read | H / **verified** → PS26 ★ |
| Contingent fees — CAs | CA Act 1949, First Schedule Part I **clause (10)**: no fees on a percentage of profits or contingent on findings / results, except as permitted by regulation; **Regulation 192** lists exceptions (receiver / liquidator on realisation, IBC fees permitted by Council, fees fixed by a court, government-fixed fee structures — as reported); CS / CMA Acts have similar clauses (CMA First Schedule items 7–11 as reported) | — | P MCA First Schedule PDF (via vaquill, link); S taxclue, bcajonline | H (clause) / **verified**; M (Reg 192 list) → PS26 ★ |
| Client money — advocates | BCI Rules **Rule 25**: keep accounts of client's money entrusted, showing amounts received; Rule 26: say whether received for fees or expenses (text cut off); Rules 27–28 (not to divert; copy of account on request) as reported; no IOLTA-type statute in India | — | P Lok Sabha reply reproducing Rules 25–26 (eparlib); S jurigram | H (25) / **verified**; M (26–28) → PS27 ★ |
| Client money — CAs | CA Act Second Schedule Part I: failing to keep a client's money (other than fees or money to be spent) in a separate bank account, or to use it for its purpose within a reasonable time, is misconduct — recalled, not read | — | Recalled | M / verify → PS27 ★ |
| Deposits and GST | A deposit is not "payment" for time of supply unless applied as consideration (Sec 2(31) proviso, recalled); advances for services are taxable on receipt (existing `advances.ts`) | Advances (5.3) | Recalled | M / verify → PS10 |
| Conflicts — advocates | BCI Rule 33: an advocate who has advised or acted for a party in a matter shall not act for the opposite party in it without the express consent of all concerned; switching sides in the same proceedings is misconduct (AP HC; SC in Bar Council of Rajasthan); unrelated matters generally no conflict | — | S ipleaders, livelaw, scconline, lawweb (Chander Prakash Tyagi) | H (Rule 33) / **verified** → PS28 |
| UDIN | ICAI: UDIN mandatory on all certificates from 1 Feb 2019, GST and tax audit reports from 1 Apr 2019, other attest from 1 Jul 2019; tax portal verifies UDINs; from the 442nd Council meeting (May 2025) the assessee's PAN is mandatory for the "GST & Tax Audit" category (as reported) | — | V icai.org post 15505; ICAI UDIN FAQs (Jul 2024, PDF); S taxmann, moneylife, taxscan | H (phases) / **verified**; M (2025 changes) → PS29 |
| Architects' fees | Council of Architecture scale of charges / conditions of engagement: % of project cost by building class, claimed by stage; **recommendatory**, negotiated in practice; stage splits differ between sources (e.g. 10 / 20 / 20 / 25 / 25 % vs 30 / 35 / 55 % cumulative); documentation charges 10 % of fee (one source) | Progress billing by % (R2-B2) | S studiomatrx (2026), solatatech; P COA regulations not read | L (percentages) → PS30 (editable template only) |
| Advertising agencies | Media bought in the agency's own name and re-sold: the agency is a principal (value = full billing, GST on the agency's service rate) unless Rule 33 holds; print-media space sale 5 % (recalled); 194C on client → agency payments | Re-billed expense with markup / pure agent | Recalled; S vjmglobal (194C) | M / verify → PS12 ★ |
| Registration threshold — services | ₹20 lakh (₹10 lakh special-category States) aggregate turnover, all-India, which **includes exports** (Sec 2(6) CGST "aggregate turnover", recalled); N 10/2017-IT (13 Oct 2017): inter-State service suppliers below the threshold need not register | — | S gstzen, globallinker, taxtmi (forum; inclusion of exports not confirmed in text) | H (threshold, N 10/2017-IT) / **verified**; M (exports counted) → PS13 |

### 2.3a What changed in 2025–2026 for these firms (and what the app holds today)

| Change | Date | App today | Round 14 |
|---|---|---|---|
| Sec 13(8)(b) IGST omitted (intermediary → location of recipient) | 30 Mar 2026 (assent; no separate commencement as read) | `tr-indents.ts` note on every date | Dated rule `INTERMEDIARY_POS_RULES` in `prof-rules.ts`; C1 and the indent note read it (PS4) |
| FEMA Export and Import Regulations 2026: EDF replaces SOFTEX; services clock from the invoice date | 1 Oct 2026 | No EDF; clock from shipping bill | C2 (PS15, PS16) |
| Realisation 15 → **9 months** (INR 18 → 12) by the 22 Sep 2026 amendment | gazette 24 Sep 2026; regulations in force 1 Oct 2026 | 15 months from 2025-11-13 | New dated rows `2026-10-01` → 9 (and an INR rule → 12) appended to `trade/trade-rules.ts`; old rows untouched (PS15 ★) |
| 194T TDS on partner payments | 1 Apr 2025 | — | D2 (PS19) |
| 194J threshold ₹30,000 → ₹50,000 | 1 Apr 2025 | Exists (`tds-rules.ts`, T2) | Reused |
| Sec 40(b) limits doubled (₹3 lakh / ₹6 lakh slab) | AY 2025-26 | — | D1 (PS20) |
| Income-tax Act 2025: Sec 58 (presumptive), Sec 35 (40(b)), Sec 393 (TDS), Forms 131 / 168 | TY 2026-27 (1 Apr 2026) | `ita2025.ts` labels TDS sections and Forms 131 / 168 | D1, D3, D4 read `ita2025.ts`; new labels appended there (PS20, PS22) |
| 6 % equalisation levy abolished | 1 Apr 2025 | — | No module; a help line for agencies (PS38) |

### 2.4 Verified against the code (`fbb9d60`)

Verdicts: **Exists** (done, file given), **Partial** (part done, gap named), **Missing**. Each row was checked by reading
the file named or by grep (`matter`, `engagement`, `conflict`, `escrow`, `client money`, `write.down`, `realisation` in
time code, `utilisation` in time code, `44ADA`, `194T`, `SOFTEX`, `EDF`, `UDIN`, `profit_share`, `success fee`,
`purpose_code`: zero hits in professional code; `realisation` / `utilisation` hits are export, nonprofit, plant and
cold-store code); "→" names the Round 14 item.

#### R3-B (projects / retainers / timesheets) — exactly what exists and what Round 14 adds

| Feature | Verdict | Evidence | What Round 14 adds → item |
|---|---|---|---|
| Timer, timesheet, mileage, Unbilled → draft invoice, derived billing (`bill_refs`) | Exists | `timesheets.ts`, `timer.ts`, `types/time.ts` | Pre-bill review before the draft, write-up / write-down with reason → A3 |
| Rate cards (task → project → client → work type → default), captured rate, re-rate unbilled | Exists | `rate-cards.ts` (R3-B1) | Timekeeper rate as one more level (staff standard rate) and multi-currency cards → A3, C4 |
| Projects on cost centres (budget minutes, fee budget, start / due / status, hourly rate), tasks board, 80 / 100 % bell | Exists | `projects.ts`, `cost-centres.ts` (R3-B2) | Matter fields on the same cost centre (`CostCentre.ps`: code, type, court / case no., parties, responsible partner, conflict check, open / close) → A2 |
| Hour-block retainers (drawdown, rollover, forfeit, overage, report) | Exists | `retainers.ts` (R3-B3) | Unchanged; deposit-style retainers go to advances (fees) or client money (expenses) → A3, B3 |
| Timesheet / expense annexure page | Exists | `annexure.ts`, `AnnexureBlock.tsx` (R3-B4) | Write-down column and matter header in the same snapshot (additive fields) → A3, A5 |
| Party document defaults, repeat last bill, gone quiet | Exists | `party-defaults.ts`, `party-habits.ts`, `quiet-customers.ts` | Client TDS default and engagement defaults → D3, A2 |
| Re-billed expenses with markup / pure agent | Partial | `timesheets.ts` `expenseLine` (0 % + note) | Pure-agent line uses the `rule33` charge head so GSTR-1 / e-Invoice / e-Way exclude it; disbursement kinds; unrecovered ageing → B1 |
| Timekeeper on a time entry | Partial | `TimeEntry.staff_id` (R10 SV-D2, workshop only); tasks have a device-local `assignee_id` | "Who" on every entry when `practice` is on, from `service_staff` → A4 |
| Staff master with capacity / cost | Partial | `service_staff` (R10 SV-A3: role, hours, employment) | Additive `ServiceStaff.ps` (weekly capacity, cost rate, standard rate, target %) → A4 |
| Fixed fee / milestones | Partial | Progress billing from a quotation (R2-B2 `progress-billing.ts`) | Engagement-driven: milestones and fixed fees from the engagement, time tracked against them → A3 |
| Capped fee, blended rate, success fee | Missing | — | A3 |
| WIP ageing, write-offs, realisation, utilisation, profitability | Missing | — | A4 |
| Year-end unbilled revenue | Missing | — | A4 |

#### R3-C (practice desk) — exactly what exists and what Round 14 adds

| Feature | Verdict | Evidence | What Round 14 adds → item |
|---|---|---|---|
| Board of every company on the device: GST / TDS returns due / filed, lock date, last entry | Exists | `practice.ts`, `company-peek.ts` `peekCompliance`, `pages/Practice.tsx` | Unchanged; read-only peek stays read-only |
| DSC register with expiry bell | Exists | `dsc-register.ts`, `dsc-alerts.ts` | DSC renewal as a billable event → D5 |
| Monthly client checklist | Exists | `client-checklist.ts` | Checklist items as billable events (optional fee per item) → D5 |
| Link a device company to the firm's client master | Missing | — | `prof_settings.ca.company_clients` (company id → client id) → D5 |
| Billing for compliance work (per return / certificate / month, government fees recovered) | Missing | — | Fee schedule + "Bill from the board" into a draft in the firm's own company → D5 |
| UDIN register | Missing | — | D5 |
| Engagement letters for CA work (SA 210 style) | Missing | quotation + proposal sections + acceptance exist (R2-B3, 8G) | Letter templates by profession on the same quotation → A2 |

#### Legal, design and media specifics

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Outward RCM invoice (tax shown, not collected) | Exists | `rcm.ts` | Legal-services choice by client type + exemption + fee-memo wording → B2 |
| Inward RCM self-invoice (a business paying an advocate) | Exists | `rcm-self-invoice.ts`, `RcmGoodsNotice.tsx` | Legal-services SAC prompt (9982) → B2 |
| Conflict check | Missing | — | A2 |
| Client-money ledger, three-way reconciliation | Missing | `BankAccount` has additive flags (`clearing`, `rera_project_id`, `fcra`) | `BankAccount.client_money` + `client_money` table → B3 |
| Stage fees on project cost (architects) | Partial | progress billing by % of a quotation | Project-cost basis, revisions, stage template → B4 |
| Interior fit-out: design fee vs execution, materials on behalf | Partial | re-billed expenses, works-contract rate classes (R11 for contractors) | Split guidance and pass-through → B4 |
| Media buy as principal vs pure agent, release orders | Partial | re-billed expense with markup | Media lines, RO numbers, commission → B5 |

#### Exports, currency and the firm's statutory desk

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| LUT register (RFD-11 ARN per FY), LUT text on export invoices | Exists | `trade/lut-register.ts`, `FooterBlocks.tsx` | Reused |
| Export realisation register with IRMs / e-BRC / write-offs | Partial | `trade/export-register.ts` (clock from shipping bill, invoice date "flagged") | Services clock from the invoice date, FEMA 2026 rows, INR 12-month rule → C2 |
| SOFTEX / EDF | Missing | — | C2 |
| Sec 2(6) / place-of-supply check | Missing | `isExportDoc` by supply type / POS 96–97 only | C1 |
| Intermediary note | Partial | `tr-indents.ts` (TR21: "not an export" on every date) | Dated rule → C1 |
| Refund statement for services exports under LUT | Partial | `gst-cash-refunds.ts` register | Statement rows with e-BRC / FIRA → C3 |
| Currency master, FX on documents, realised gain | Exists | `currency-rates.ts`, `fx.ts`, `fx-gain.ts` | Rate cards in foreign currency, Rule 34(2) note, platform fees → C4 |
| Import-of-services RCM on bills | Exists | `gst-reports.ts`, `ledger/postings.ts` | Reused for platform fees → C4 |
| Registration threshold tracker | Missing | — | C5 |
| TDS receivable register, Form 16A (131) tracking, 26AS (168) match | Exists | `tds-register.ts`, `TdsTab.tsx`, `ita2025.ts` | Client default section / rate and expected TDS per fee note; 194C for agencies; chase letter → D3 |
| TDS payable sections | Partial | `tds-rules.ts` (no 194T) | 194T rows + partner adapter → D2 |
| Partners, capital / current accounts, 40(b), appropriation | Missing | `notes-auto.ts` "Partners' capital accounts" heading only; `Drawings` 1010 (proprietor) | D1 |
| 44ADA / Sec 58 paper | Missing | — | D4 |

**Totals:** 45 rows checked (R3-B 12, R3-C 7, legal / design / media 7, exports / statutory 19): **14 exist** (reused as
they are), **14 partial**, **17 missing**. Round 14 closes every partial / missing row; §2.2's 18 document rows map onto
them.

### 2.5 Verification notes

How each statutory point was checked, and what is still open. Items marked "verify" ship with `verified: false` in
`prof-rules.ts` (or the existing rule file) and a "verify with your CA" line wherever they are shown.

- **Read in a primary source this round:** RBI FEMA 23(R)/2026-RB as amended to 22 Sep 2026 (the RBI page, read twice:
  Reg 2(1)(f), 3(2), 4(2), 5(1) and footnotes 2–4); CBIC Circular 202/14/2023-GST (INR receipts); N 13/2017-CT(R)
  corrigendum and CBIC press release of 15 Jul 2017 (legal services); BCI Rules 25–26 (as reproduced in a Lok Sabha
  reply); ICAI's UDIN announcement and FAQs. The Finance Act 2026 text itself was **not** read (Grant Thornton's article
  was, and four other sources agree).
- **Two or more independent secondary sources agree (marked verified):** 194J rates and the ₹50,000 threshold; 194T
  (rate, threshold, date); Sec 40(b) slabs; 44ADA / Sec 58 limits; ICDS IV; BCI Rule 20 and Rule 33; CA clause (10);
  equalisation levy abolition; SEIS ended; Rule 33 conditions; Rule 34(2) for services (one older copy conflicts — kept as
  verify, PS7).
- **Conflicting or thin (verify with CA):** N 12/2017 entry 45 current wording (threshold since N 21/2019); whether
  exports count in the services registration threshold (forum view only); the commencement date and saving clause of the
  intermediary omission; which realisation period applies to services invoiced between 13 Nov 2025 and 30 Sep 2026 and
  whether the 9-month rule reaches invoices raised before 1 Oct 2026 but unrealised then; Reg 192 exceptions; BCI Rules
  26–28 text; the CA Second Schedule client-money clause (recalled); architects' stage percentages (sources differ — the
  app ships an editable template, never a rule); media-buy principal vs agent; the 194T entry in the 2025 Act table and
  its RPU code; Sec 35(e) mapping of 40(b); the 194J treatment of software development (professional 10 % or technical 2 %
  — the app asks the user per client, PS18).
- **Recalled, not re-read:** Sec 13(4) for immovable-property services, Sec 2(31) proviso on deposits, Sec 23(2) /
  N 5/2017-CT for RCM-only suppliers, Sec 10(2A) / Sec 28(v), Sec 211 advance tax for 44ADA, Circular 23/2017 (TDS on fee
  excluding GST).
- **A finding that changes existing behaviour:** `EXPORT_REALISATION_MONTHS_RULES` holds 15 months from 2025-11-13; the
  regulations in force from 1 Oct 2026 say 9 (services from the invoice date; INR 12). Old rows are never edited: PS-C
  appends dated rows and the existing CA item X1 is cross-referenced from PS15. The same goes for `tr-indents.ts`'s
  intermediary note (TR21), which becomes date-aware.

### 2.6 Sources

P = primary; S = secondary; V = vendor. Accessed 27 Oct 2026.

Statute, notifications and regulators:
- P RBI, FEMA 23(R)/2026-RB as amended — https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=13277 (Reg 2(1)(f), 3(2),
  4(2), 5(1), footnotes 2–4: 9 / 12 months, EDF, ₹10 lakh, STPI); S taxmann blog "RBI notifies FEM Export and Import
  Regulations 2026"; S taxheal "Export Declaration Form (EDF) by RBI from 1st Oct 2026"; S majmudarindia (17 Feb 2026 PDF);
  S winvesta "SOFTEX is dead"; S pn.ispirt.in (EDF replaces SOFTEX, banks certify from 1 Oct 2026).
- P CBIC Circular 202/14/2023-GST — https://gstcouncil.gov.in/sites/default/files/2024-06/circular-no-202-14-2023.pdf;
  S taxguru (cbic-clarifies-conditions-export-services), S fintaxblog.
- P N 13/2017-CT(R) corrigendum — https://gstcouncil.gov.in/sites/default/files/2024-05/13reverse_charge_cgst_corrigendum_2.pdf;
  P CBIC press release on legal services (15 Jul 2017) — https://cbic-gst.gov.in/pdf/press-release/legal-services-15072017.pdf;
  S taxscan, barandbench, ssrana (GST on lawyers / law firms); P Delhi HC order W.P.(C) 5709/2017 (12 Jul 2017).
- S N 12/2017 entry 45 — gstgyaan "GST on legal services", cleartax "GST on individual, senior advocates and firms",
  caclubindia, lawtrend, corpbiz.
- P CBIC Rule 33 page — https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter4/rule33_v1.00.html
  (heading); S gstzen (Rule 33), taxguru "concept pure agent gst", busy.in.
- S Rule 34 — gstzen (Rule 34), taxguru "GST export of services: why using customs exchange rate is wrong", caclub,
  fintaxblog; ICAI Navi Mumbai copy (older wording).
- S Intermediary omission — Grant Thornton "GST on intermediary services: legislative reset through Finance Act 2026"
  (https://www.grantthornton.in/insights/articles/gst-on-intermediary-services/, fetched), taxguru, AMSS, ICAI CA Journal
  ("when the legislature erases a law"), bcajonline, trilegal, winvesta.
- S N 10/2017-IT — gstzen, taxheal, globallinker; taxtmi forum (exports in aggregate turnover).
- S Equalisation levy — Business Today (24 Mar 2025), YourStory, KNAV "Flash alert: Finance Act 2025", Fox Mandal, xflowpay.
- S SEIS — mondaq "Foreign Trade Policy 2023", razorpay SEIS guide, indiaseatradenews (Apr 2026).
- S e-BRC — vjmglobal "eBRC system revamped by DGFT", india-briefing (soft launch), razorpay (BRC vs FIRC), winvesta
  "FIRC vs FIRA vs e-BRC 2026", skydo; P https://www.dgft.gov.in/CP?opt=eBRC (landing page).
- S 194J — tdsman "TDS on fees for professional and technical services – Section 393(1) (194J)" (May / Jul 2026),
  calcguru (FY 2026-27), taxbuddy, quicko, poonawallafincorp.
- P CBDT Circular 715 (8 Aug 1995) — https://www.incometaxindia.gov.in/w/715-circular-no.-715-dated-8-8-1995 (link);
  S vjmglobal "TDS on advertisement charges u/s 194C", sortingtax, ITAT Dentsu / Perfect Probuild orders (itat.gov.in).
- S 194T — taxmann "Section 194T", Lakshmikumaran & Sridharan "Section 194T: a new compliance frontier", vjmglobal,
  tdsman (Jul 2025), treelife, itatonline "Budget 2024 changes for LLP and partnership firms".
- S Sec 40(b) — taxadda "Remuneration and interest to partner – Section 40b" (fetched), taxmann "Partner's remuneration and
  194T", taxroutine, calcguru.
- S Partner remuneration and GST — taxtmi forum / blog, taxheal "GST on salary to partner: ICAI raised issue".
- S Sec 58 / 44ADA — taxguru "Analysis: presumptive taxation Section 58 Income Tax Act 2025", studycafe, wisebooks,
  taxscan, cleartax "freelance professional business income", ICAI NIRC (May 2026 PDF).
- S Forms 131 / 168 — incometaxindia Form 131 FAQs (P, link), taxroutine, calcguru form mapping, taxheal.
- S ICDS IV — taxguru (ICDS), cleartax "ICDS IV revenue recognition", taxheal (AY 2026-27), incometaxindia ICDS list (P, link).
- S BCI Rules — ipleaders (contingency fees; conflict of interest), Kluwer arbitration blog "Feevolution" (Aug 2024),
  P eparlib Lok Sabha reply reproducing Rules 25–26, S jurigram "Legal trust accounting India", livelaw "BCI rules conflict
  of interest", scconline (AP HC), lawweb (Chander Prakash Tyagi).
- P/S CA Act — MCA First Schedule (vaquill mirror), taxclue "Clause 10 first schedule contingent fees Regulation 192",
  cabkgoyal, bcajonline "Ethics and U".
- V/S UDIN — icai.org post 15505 (phase 2), ICAI UDIN FAQs 4th ed. (Jul 2024), taxmann "ICAI updates UDIN rules",
  moneylife, taxscan.
- S Architects — studiomatrx (fees and fee proposals, Jul / Aug 2026), solatatech "Council of Architecture (2026)".

Vendors and reviews:
- V clio.com (trust accounting, law-firm insights, pricing); help.clio.com (realisation / utilisation definitions);
  S lawyerist and fitsmallbusiness Clio reviews.
- V practicepanther.com (trust accounting, three-way reconciliation help articles); S lawnext (PantherAccounting Plus,
  Apr 2026).
- V bill4time.com (accounting, retainer replenishment); S Technolawyer review; S fitgap (pre-bills).
- V getharvest.com (uninvoiced report, utilisation calculator, glossary); S coupler.io Harvest data overview.
- V freshbooks.com (retainers, team cost rates, project profitability); S smallbiztrends.
- V zoho.com/books help (project billing methods, budgets).
- V ignitionapp.com (engagement letters, Karbon integration); V karbonhq.com (engagements, release notes Feb 2025, Feb
  2026); S cpapracticeadvisor, itbrief.
- V suvit.io blog (practice tools comparison), taxone.vyapar.com; TaxCloud: no source found.
- S qount.io (WIP write-up / write-down at invoicing, realisation tracking comparison), leanlaw (WIP report guide),
  minutedock (write-downs in accounting firms).

---

## 3. Ranked list: what to build now

Value 1–5 (5 = every firm of that kind meets it every day). Effort S = 1, M = 2, L = 3. Score = value ÷ effort.

| Rank | Id | Gap | Who needs it | Value | Effort | Score | Package |
|---|---|---|---|---|---|---|---|
| 1 | PS-A1 | Professional profile (picker, packs, desk tabs, checklist, help, sample data) | every professional | 5 | S | 5.0 | A |
| 2 | PS-B1 | Disbursements and pure agent (GSTR-1 / e-Invoice exclusion, disbursement kinds, unrecovered ageing) | advocates, CAs, CSs, architects | 5 | S | 5.0 | B |
| 3 | PS-A5 | Professional paper (matter / engagement header, billing basis, UDIN, purpose code, write-down column) | every firm | 5 | S | 5.0 | A |
| 4 | PS-A3 | Billing models and the pre-bill (fixed, milestone, capped, blended, success; write-up / write-down) | every firm | 5 | M | 2.5 | A |
| 5 | PS-A2 | Matters, engagements, letters and conflict checks | every firm | 5 | M | 2.5 | A |
| 6 | PS-B2 | Advocates: RCM / exemption by client type, fee memo, registration notice | advocates, law firms, their business clients | 5 | S | 5.0 | B |
| 7 | PS-C2 | FEMA 2026: EDF register, services clock from the invoice date, 9 / 12-month rows | every service exporter | 5 | S | 5.0 | C |
| 8 | PS-D3 | 194J receivable by client (10 % / 2 % / 194C), expected TDS, chase letters | every firm with business clients | 5 | S | 5.0 | D |
| 9 | PS-A4 | WIP, realisation, utilisation, profitability; year-end unbilled paper | every firm with staff | 5 | M | 2.5 | A |
| 10 | PS-C1 | Export-of-services check (Sec 2(6), place of supply, intermediary from 30 Mar 2026) | exporters, consultants with foreign clients | 5 | M | 2.5 | C |
| 11 | PS-D4 | 44ADA / Sec 58 presumptive working paper | freelancers, small practices | 4 | S | 4.0 | D |
| 12 | PS-D1 | Partners: capital / current accounts, 40(b) / Sec 35, appropriation | partnership / LLP firms | 5 | M | 2.5 | D |
| 13 | PS-D2 | 194T TDS on partner payments | partnership / LLP firms | 4 | S | 4.0 | D |
| 14 | PS-C4 | Multi-currency rate cards, Rule 34(2) note, platform receipts | freelancers, agencies, IT firms | 4 | M | 2.0 | C |
| 15 | PS-B3 | Client-money ledger, three-way reconciliation, statements | advocates, CAs holding deposits | 4 | M | 2.0 | B |
| 16 | PS-D5 | CA / CS / CMA desk: compliance billing from the practice desk, UDIN register | CA / CS / CMA firms | 4 | M | 2.0 | D |
| 17 | PS-C3 | IRM / FIRA / e-BRC per services invoice; refund statement | exporters claiming refunds | 3 | S | 3.0 | C |
| 18 | PS-B4 | Architects' stage fees on project cost; interior fit-out pass-through | architects, interior designers | 4 | M | 2.0 | B |
| 19 | PS-B5 | Media agencies: principal vs pure agent, release orders, commission | media / digital agencies | 3 | M | 1.5 | B |
| 20 | PS-C5 | Freelancer's registration threshold and unregistered export invoice | freelancers | 3 | S | 3.0 | C |
| — | — | Client portal with logins, online payment collection | — | 4 | L | 1.3 | no (server) |
| — | — | Court diary / e-Courts status, document assembly | — | 3 | L | 1.0 | no (outside billing, network) |
| — | — | ICAI UDIN generation, EDF / e-BRC filing, TRACES downloads | — | 3 | L | 1.0 | no (regulator portals) |
| — | — | LEDES / UTBMS e-billing | — | 2 | M | 1.0 | no (CSV annexure covers it) |

All 20 are taken. If the lead keeps the 3,400 kB budget (§1), the drop order is C5, B5, B4, C3, D5 (ranks 20 → 16).

---

## 4. Specifications (20 items)

Conventions for every item:
- **Logic and tests.** Pure logic in `src/lib/prof/ps-*.ts` (new folder), tested with `node:test` in `tests/ps-*.test.ts`.
  UI checks are `step(...)` blocks in `tests/e2e/smoke.mjs` (§7). Existing files are edited only where §6 says.
- **Components** in the new folder `src/components/prof/`. Each desk is one lazy component mounted by the `/time` page
  (`MattersDesk`, `WipDesk`, `ClientMoneyDesk`, `ExportSvcDesk`, `FirmDesk`, `CaDesk`); its views are lazy
  sub-components. Template parts live in `src/components/templates/parts/` (`ProfBlock.tsx`, `ProfAnnexurePage.tsx`),
  each lazy.
- **Strings.** One area per desk plus `prof-r14-common.ts` (§1). Hindi uses the trade's words (मामला / मैटर, मुवक्किल,
  वकील, वकालतनामा, फ़ीस, फ़ीस मेमो, अग्रिम फ़ीस, क्लाइंट का पैसा, कोर्ट फ़ीस, स्टांप शुल्क, सरकारी फ़ीस, शुद्ध एजेंट के रूप में
  प्रतिपूर्ति, हितों का टकराव, नियुक्ति पत्र, समय-पत्रक, अबिल्ड कार्य, कटौती / बढ़ोतरी, वसूली दर, उपयोग दर, साझेदार,
  पूंजी खाता, चालू खाता, आहरण, लाभ विभाजन, पारिश्रमिक, पूंजी पर ब्याज, अनुमानित आय, सेवाओं का निर्यात, विदेशी मुद्रा,
  विनिमय दर, निर्यात घोषणा पत्र, बैंक प्राप्ति प्रमाणपत्र, यूडीआईएन, प्रमाणपत्र, चरण शुल्क, मीडिया लागत, रिलीज़ ऑर्डर).
- **Storage.** New company tables `mrchartist_inv_<table>` go through `getTable` / `setTable`. Each is registered in:
  - `backup.ts` (`RECORD_TABLES` / `ID_TABLES`);
  - the open-export schema (`trust/open-export-schema.ts`);
  - `sync-engine.ts` `DATED` / `NUMBERED`, when dated or numbered;
  - **`src/lib/prof/ps-registry.ts`** (`PS_TABLE_ACTIONS`, `PS_WATCHED`), registered at runtime, never in first-paint
    `access.ts` / `audit-edits.ts`. Every writer module and the two all-table lazy writers (`sync-engine.ts`,
    `trust/recycle-bin.ts`) import it for its side effect (`tests/ps-registry.test.ts`).

  Each table gets one row in `docs/ARCHITECTURE.md` (lead). Additive record fields come by declaration merging in
  `src/types/prof-r14.ts`: one file, one `declare module` block per package. Table and series names live in
  `src/lib/prof/ps-shared.ts` (the `tr-shared.ts` / `mf-shared.ts` pattern).
- **Volume.** Time entries are the high-volume table (a 25-person firm logs ≈ 40,000 entries a year). Round 14 adds **no
  per-entry table**: write-downs are derived at billing time from the invoice line and the entries it bills
  (`bill_refs`), and only a WIP write-off stamps the entry (`TimeEntry.ps.wo`). A test builds two years of a 25-person
  firm and checks that the realisation view for one month reads only entries billed or dated in that month.
- **Invoice snapshots.** Everything Round 14 stores on an invoice lives under the record key **`ps`** (one object; each
  package owns its sub-fields, §6). Templates read them from the record only. Purchases rows that carry professional
  fields (disbursement kind, matter, media buy, write-off) carry them as `PurchaseRecord.ps` (declaration merging; PS-A
  checks that `readPurchase` passes the key through and adds `ps` to the purchase keep-list if it does not).
- **Numbers.** New series go through `series-counters.ts` (`nextSeriesNumberFor` + `recordSeries`) as
  `XXX/FY<yy-yy>/<seq>`, never reused after a delete: `ENG` (engagements), `CMV` (client-money vouchers). Neither prefix
  is in use today (checked by grep; PS-A adds a test). Matter codes are not a series: they are the firm's own codes
  (`<client code>/<seq>` suggested, editable, unique).
- **Guards.** Destructive calls use `requireAccess`. Writes in a locked period use `assertUnlocked`. Money goes through
  `round2`, hours through 2 decimals, percentages through 2 decimals. Every delete goes through `setTable` on a watched
  table, so the recycle bin gets the row.
- **Packs.** A desk tab is listed only when its pack is on (its URL still opens it). Tables are not read while their
  pack is off (`tests/ps-pack-gate.test.ts`, like `tests/mf-pack-gate.test.ts`).
- **Help.** Every new tab / view gets a topic (`tests/help-registry.test.ts` fails otherwise) and a Ctrl+K title in
  `src/i18n/areas/discover-r6-tabs.ts`. Statutory topics cite the PS ids. The CA-id regexes in
  `tests/help-registry.test.ts`, `tests/help-glossary.test.ts` and `tests/docs-links.test.ts` (both the `cited` and the
  `ca: [...]` regex) gain `PS` (owner A). `PS` cannot collide with the payroll ids `P1…`: the regexes need a digit right
  after the prefix.
- **Cash readers.** **No new receipt marker.** Money in and out of a client-money account (B3) is held for clients, not
  the firm's: it is recorded as **`client_money` vouchers, not `transactions` rows**, so `movedNoCash` and the no-cash
  readers are not edited. The client-money **bank account** is a real bank (BRS and the cash book read it like any
  account); the firm's own cash views (Today, payment modes, collection lag, cash-flow forecast) leave it out through one
  predicate `isClientMoneyAccount` beside `pickableBankAccounts` (§6, reviewed by the lead).
  `tests/no-cash-readers.test.ts` is unchanged; B3 adds `tests/ps-client-money-readers.test.ts`.
- **Purchases contract.** Every new module that reads `purchases` (A3, A4, B1, B5, C4, D4) is added to
  `tests/purchase-contract.test.ts` and reads bills through `readPurchase`.
- **Ethics guards** are prompts with an owner override and an audit line, never a block in the data layer: the app
  cannot know the facts (an advocate's non-litigation advisory work, a CA's Reg 192 case).

### PS-A — Professional profile and the practice core (pack `practice`)

#### PS-A1 Professional profile (professional picker)

**User story.** When I set up the app I pick "Services", then "Professional", then *Law firm* and *Partnership*. The app
turns on the matters, WIP, client-money and firm desks, lands me on Time → Matters, and the checklist asks for my
enrolment number, my partners, my first matter and a conflict check.

**Acceptance criteria.**
1. `PackId` gains `practice`, `cafirm`, `legal`, `design`, `media`, `svcexport`, `partners` (appended to `PACK_IDS`).
   `PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE` and `PACK_ROUTES` are unchanged.
2. Settings fields `prof_kind?: 'ca' | 'legal' | 'design' | 'consulting' | 'agency' | 'freelancer' | 'other'`,
   `prof_sub?: string` (the sub-choice of §1) and object `prof_settings` (`settings.manage`, audited, synced as a
   singleton). The entity question reads and writes the annual pack's existing entity value (`firm_form` is only its name
   in the picker). `applyProfKind(kind, { registered, sub, firmForm, currentPacks })` (`shop-presets.ts`, R12 / R13
   pattern) returns business type `services`, `service_kind: 'professional'`, modules, packs (union with
   `currentPacks`), defaults and switches:

   | kind | modules | industry_packs | landing | due days | template | switches turned on |
   |---|---|---|---|---|---|---|
   | ca | `PRESETS.services` + `accounts` | `practice`, `cafirm` (+ `partners`) | `/time?tab=cadesk&view=events` | 15 | `gst_tax_invoice` | matters; fee schedule; UDIN on lines; disbursements as pure agent; 194J 10 % default |
   | legal | `PRESETS.services` + `accounts` | `practice`, `legal` (+ `partners`) | `/time?tab=matters&view=matters` | 15 | `freelancer_light` | matters with parties; conflict check before opening; RCM by client type; fee memo; client money; success-fee prompt |
   | design | `PRESETS.services` + `accounts` | `practice`, `design` (+ `partners`) | `/time?tab=matters&view=stages` | 15 | `gst_tax_invoice` | stage fees; project-cost revisions; immovable-property POS check |
   | consulting | `PRESETS.services` + `accounts` | `practice` (+ `svcexport`, + `partners`) | `/time?tab=wip&view=wip` | 30 | `gst_tax_invoice` | engagements; capped / fixed fees; utilisation; export check when exports |
   | agency | `PRESETS.services` + `accounts` | `practice`, `media` (+ `svcexport`) | `/time?tab=matters&view=engagements` | 30 | `gst_tax_invoice` | monthly retainers; media pass-through; 194C default for clients |
   | freelancer | `PRESETS.services` | `practice` (+ `svcexport`) | `/invoice` | 15 | `freelancer_light` | simple time; foreign-currency cards when exports; presumptive paper; threshold card |
   | other | `PRESETS.services` | `practice` | `/time?tab=matters` | 15 | — | matters and WIP only |

   `registered` adds `gst`; every kind keeps `time` (so `/time` stays visible); a `partnership` / `llp` firm form adds
   `partners`. An unregistered `legal` profile prints fee memos without GST (B2).
3. Wizard: the R10 service picker's `professional` card opens the kinds and their sub-choice (lazy, inside the wizard
   chunk); every kind asks "Are you registered under GST?" and "Firm form"; `legal` asks enrolment no. and State Bar
   Council (`prof_settings.legal`), `ca` asks membership / firm registration no. (`prof_settings.ca`). Settings → Features
   shows "Professional profile" for every `services` company with the same choices plus "Custom". Changing the profile
   never deletes data.
4. Existing companies are unchanged (no `prof_kind`, no step). Companies that pick a kind get checklist steps
   (`checklist-steps.ts`, append-only): every kind → `firstMatter`, `staffCapacity` (skippable for one person); legal →
   `enrolment`, `conflictCheck`, `clientMoneyBank` (skippable); ca → `feeSchedule`, `linkCompanies`; design →
   `stageTemplate`; partners → `partners`; svcexport → `lut` (the existing LUT register), `edf`.
5. **Desk tabs**: each package adds its own `TIME_TABS` rows (§1, §6) in its own commit; PS-A adds `matters` and `wip`.
   `Time.tsx` mounts a desk lazily when its tab is listed (one lazy map entry per desk).
6. Features catalogue (`features-catalog.ts`): one row per new pack and one "Professional profile" row with `PACK_HREF`.
7. **Sample data** (R6-B4): `src/lib/demo/profile-prof.ts`, only in the Demo company, dispatched by `prof_kind`; each
   package adds its own block (§6): legal — 2 partners, 3 matters (one litigation with parties, one advisory, one with a
   conflict waived), a deposit in the client account, an RCM fee memo with a court-fee disbursement; ca — 3 linked
   companies with filed returns, a fee schedule, one UDIN; design — a house at ₹4.2 crore with 5 stages, two billed;
   consulting — a capped engagement and a fixed-fee one with time over budget, one USD invoice with an EDF; agency — a
   monthly retainer with a media pass-through; freelancer — a USD client paid through a platform, the threshold card at
   70 %.

**Files.** New: `src/lib/prof/{ps-profile,ps-registry,ps-settings,ps-shared}.ts`, `src/lib/prof-rules.ts` (scaffold with
one section per package), `src/types/prof-r14.ts` (scaffold), `src/components/prof/ProfKindPicker.tsx`,
`src/lib/demo/profile-prof.ts`. Edit: `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`,
`checklist-steps.ts`, the R10 service picker (one lazy sub-step), `FeaturesPanel.tsx`, `page-tabs.ts` (A's two rows),
`Time.tsx` (lazy desk mounts), the demo dispatcher.

**Storage.** Settings fields `prof_kind`, `prof_sub`, `prof_settings` (object).

**Tests.** `tests/ps-profile.test.ts`: each kind's type / modules / packs / landing / switches; `registered` adds `gst`;
partnership / LLP adds `partners`; packs union with existing packs; `PACK_OF_TYPE` / `PACK_ROUTES` unchanged; a services
company without `prof_kind` unchanged; checklist steps by kind. `tests/industry-packs.test.ts` extended with the seven ids.

#### PS-A2 Matters, engagements, letters and conflict checks

*Seen in:* Clio / PracticePanther (matters, conflict checks), Ignition / Karbon (engagements, letters), Zoho Books
(project billing methods).

**User story.** A new client wants us to defend a cheque-bounce case against "Shree Traders". I run a conflict check on
both names: one hit (we advised Shree Traders in 2024, an unrelated matter) — I record "no conflict: unrelated matter".
I open matter `RSK/014` "Sec 138 NI Act — Delhi" with an engagement on a fixed fee of ₹60,000 in three stages plus
court fees at actuals, send the engagement letter for signature, and start logging time against it.

**Acceptance criteria.**
1. **Matter = project cost centre** (no new table): additive `CostCentre.ps = { code, kind: 'matter' | 'assignment' |
   'project', practice_area?, court?, case_no?, forum?, parties: [{ name, role: 'client' | 'opposite' | 'related' |
   'witness' | 'other', pan?, gstin? }], responsible_id? (service_staff), originating_id?, opened, closed?, conflict_id?,
   engagement_id? }`. The matter code is unique per company (`<client code>/<seq>` suggested; client code = additive
   `Client.ps.code`, else initials). The R3-B project board, budgets and bell work unchanged on a matter.
2. **Engagements** — table `engagements` (`ENG/FY…`, dated by `start`, numbered): `{ id, number, client_id, matter_ids[],
   title, model: 'hourly' | 'fixed' | 'milestone' | 'retainer' | 'capped' | 'success' | 'blended', fee?, cap?,
   blended_rate?, currency, milestones?: [{ id, label, pct? | amount?, due?, event? }], success?: { basis, pct? | amount?,
   event }, retainer_id? (R3-B3 hours), disb_policy: 'agent' | 'markup' | 'included', tds_section?, letter_quote_id?,
   accepted_at?, start, end?, renew_on?, status: 'draft' | 'sent' | 'accepted' | 'active' | 'closed', notes }`. One
   engagement may cover several matters (a retainer for a group of companies).
3. **Engagement letter** = the existing quotation document with proposal sections (R2-B3) and offline acceptance (8G):
   "Make letter" creates a draft quotation for the client with the engagement's fee lines and the profession's letter
   template (snippets shipped per `prof_kind`: CA — objective and scope, responsibilities of management, limitations,
   fees, UDIN note (SA 210 headings); legal — scope, fees, court fees and expenses, client-money terms, no guarantee of
   outcome; design — services by stage, fee on project cost, revisions, site visits; consulting / agency — deliverables,
   change requests, IP, payment terms). Acceptance on the quote sets `accepted_at` and `status: 'active'`. Templates are
   editable snippet text; nothing is legal advice (PS31).
4. **Conflict check** — table `conflict_checks` (dated): `{ id, date, by, terms: string[], hits: [{ source: 'client' |
   'vendor' | 'party' | 'engagement', ref_id, name, matter_code?, role?, score }], result: 'clear' | 'conflict' |
   'waived', reason?, consent_note?, matter_id? }`. Matching: normalised names (case, punctuation, "pvt ltd / private
   limited / llp / & co / m/s" folded), PAN and GSTIN exact, token overlap ≥ 0.8; it searches clients, vendors, every
   matter's parties and closed matters. Opening a matter in a `legal` profile asks for a check first (the owner may skip
   with a reason, audited). A "conflict" result without a waiver warns on every new engagement for those names. BCI Rule
   33 and ICAI independence are cited (PS28); the app never decides.
5. **Ethics prompt on the model**: `success` (and percentage-of-recovery milestones) shows a warning for `legal` (BCI Rule
   20) and `ca` (First Schedule clause (10) / Reg 192) profiles, with an owner override reason (PS26); other profiles see
   no prompt.
6. Matters list: open / closed, responsible, unbilled WIP, billed, received, client-money balance (when B3 has merged —
   read through an optional lazy import, never a hard dependency), last activity; CSV / XLSX.

**Files.** New: `src/lib/prof/{ps-matters,ps-engagements,ps-conflicts,ps-letters}.ts`,
`src/components/prof/{MattersDesk,MattersView,EngagementsView,ConflictsView,LettersView}.tsx`. Edit: the cost-centre form
(one lazy "Matter details" row when `practice` is on), the timer / time form (the matter picker shows
`CostCentre.ps.code` — one lazy label helper), the proposal snippet seed list (append-only rows).

**Tests.** `tests/ps-matters.test.ts` (code uniqueness, close / reopen, parties), `tests/ps-engagements.test.ts` (model
validation, milestones ≤ 100 %, letter → acceptance → active, renewal), `tests/ps-conflicts.test.ts` (name folding, PAN /
GSTIN exact, closed matters searched, waiver carried, 5,000 parties under 50 ms).

#### PS-A3 Billing models and the pre-bill (write-ups and write-downs)

*Seen in:* Bill4Time / Clio pre-bills, Karbon engagement billing, Zoho Books billing methods, Harvest uninvoiced report.

**User story.** At month end I open the pre-bill for each matter: 14.5 hours worth ₹58,000 against a capped engagement
with ₹40,000 of the cap left. I bill ₹40,000; the pre-bill records a write-down of ₹18,000 ("cap"); the annexure still
lists every hour; the realisation view shows 69 %.

**Acceptance criteria.**
1. **Pre-bill** (`wip` desk → `prebill`): per matter / client, the unbilled time at standard value (minutes × captured
   rate), disbursements (B1) and mileage, the engagement's model and what it allows this period; the reviewer edits per
   row (hours to bill, rate, exclude, defer) and per bill (target amount); a **write-up / write-down** = billed − standard,
   with a reason from `prof_settings.wip.reasons` (cap, fixed fee, courtesy, inefficiency, junior time, rate override —
   editable). "Create draft" goes through the existing `billUnbilled` path with the edited selection, so `bill_refs`, the
   annexure and derived billing are unchanged.
2. **Models**:
   - `hourly` — today's flow;
   - `fixed` / `milestone` — the fee line(s) come from the engagement (a milestone that is due or whose event is ticked);
     time entries are marked billed by the same draft (on the annexure as "covered by fixed fee", value 0 on the client
     paper, standard value kept for realisation); milestone % uses `progress-billing.ts`'s exported helpers (no edit);
   - `capped` — billed time stops at the remaining cap; the excess is a write-down with reason "cap";
   - `blended` — every hour at the engagement's one rate, whatever the timekeeper's card;
   - `retainer` — the R3-B3 retainer when the engagement links one; else a monthly fee line (recurring) with time covered;
   - `success` — a success-fee line only when its event is marked done (date, reference); basis × % or a fixed sum; time
     covered at 0 (PS9 for time of supply).
3. The write-down is **derived** per billed line: Σ standard value of the entries in `bill_refs` − the line's taxable
   value (fixed-fee / milestone lines: Σ standard of the entries billed with them − the fee line). It is stored only as a
   snapshot on the invoice (`ps.wd = { standard, billed, reasons: [{ reason, amount }] }`), so the paper stays as issued
   and reports re-derive after an edit.
4. The annexure snapshot (R3-B4) gains additive row fields `standard` and `billed` (old annexures print as before); write-
   down columns print only on the internal pre-bill PDF, never on the client copy by default.
5. Credit notes against a fee note reduce **collected** realisation only (PS35); a cancelled invoice frees its entries as
   today.
6. Multi-currency: the pre-bill works in the engagement currency; standard values in another currency convert at the
   currency master's rate on the bill date (C4).

**Files.** New: `src/lib/prof/{ps-prebill,ps-models,ps-writedown}.ts`, `src/components/prof/{WipDesk,PreBillView}.tsx`.
Edit: `annexure.ts` (two optional fields in the row builder — additive; `tests/annexure.test.ts` unchanged), `BillClientModal`
(one lazy "Open pre-bill" link; `billUnbilled` unchanged).

**Tests.** `tests/ps-prebill.test.ts`: standard value; write-up and write-down; each model (fixed covers time at 0, cap
stops, blended, success only after its event, milestone shares); `bill_refs` identical to `billUnbilled`'s; annexure
fields; cancel frees; currency conversion.

#### PS-A4 WIP, realisation, utilisation and profitability; year-end unbilled work

*Seen in:* Clio (utilisation / realisation / collection), Karbon realisation report, Harvest utilisation, FreshBooks team
cost rates.

**User story.** On the 5th I look at the dashboard: firm utilisation 61 % (target 70 %), two juniors under 40 %, the tax
team's realisation 78 % because of fixed-fee GST work, ₹3.4 lakh of WIP older than 90 days on two matters. At the year end
I print the unbilled-work statement for the auditors.

**Acceptance criteria.**
1. **Timekeepers**: `service_staff` (R10) is the staff master; additive `ServiceStaff.ps = { capacity_hours_week,
   rates: [{ from, standard_rate, cost_rate }], target_pct?, user_hint? }`. With `practice` on, the timer and time form
   show "Who" (`TimeEntry.staff_id`, the existing R10 field), defaulting to the staff row whose `user_hint` matches the
   local user (a hint only — local users are device-local). The rate card gains one level: **timekeeper standard rate**,
   after task and before project (the R3-B1 order is otherwise unchanged; `rate-cards.ts` gets one optional resolver
   argument, §6).
2. **WIP** (`wip` view): unbilled time + unbilled disbursements by matter / client / partner with ageing buckets (0–30,
   31–60, 61–90, 90+ days; editable), oldest entry, engagement model, cap left. **WIP write-off**: selected entries are
   stamped `TimeEntry.ps.wo = { date, reason, by }` (disbursements `PurchaseRecord.ps.wo`), leave the Unbilled list, count
   as write-down in realisation, and can be reversed by the owner (audited; refused in a locked period).
3. **Realisation** (`realisation` view): per period and by partner / staff / client / matter / work type — worked
   (standard value), billed, **billing realisation** = billed ÷ standard (write-offs included), collected (receipts
   allocated to those invoices; TDS deducted counts as collected), **collection realisation** = collected ÷ billed,
   **overall** = collected ÷ standard. The definitions print under the table (Clio's own pages define realisation two
   ways; ours is stated).
4. **Utilisation** (`utilisation` view): per staff and week / month — available hours (capacity − leave from payroll
   attendance when the staff row links an employee, else capacity), billable hours, non-billable by work type,
   utilisation = billable ÷ available, vs target; CSS bars; CSV.
5. **Profitability** (`profit` view): per matter / client / engagement — fees billed − staff cost (hours × cost rate) −
   unrecovered disbursements = contribution and margin %. Cost rates are management data and never print.
6. **Year-end unbilled work** (working paper, `wip` → "Year end"): unbilled time and disbursements on the closing date at
   standard value, less expected write-down (the client's or engagement's billing realisation of the last 12 months,
   editable), by matter; method note per AS 9 / ICDS IV (percentage of completion; the ≤ 90-day completed-service option
   by engagement) — PS23. **Optional accrual** (dated setting `prof_settings.wip.accrue_from`, off by default): a journal
   Dr "Unbilled revenue (WIP)" Cr "Professional fees — unbilled" on the closing date, reversed the next day; GST is never
   touched (no invoice, no time of supply).

**Files.** New: `src/lib/prof/{ps-staff,ps-wip,ps-realisation,ps-utilisation,ps-profit,ps-yearend}.ts`,
`src/components/prof/{WipView,RealisationView,UtilisationView,ProfitView,YearEndWipView}.tsx`. Edit: `rate-cards.ts`
(one optional resolver argument; existing tests unchanged), the time form and timer card (one lazy "Who" row), the
`service_staff` form (one lazy "Capacity and rates" row).

**Tests.** `tests/ps-wip.test.ts` (ageing, write-off stamp / reverse, locked period refused), `tests/ps-realisation.test.ts`
(three ratios on a worked example; fixed fee; credit note; TDS as collected; the two-year volume test reads one month
only), `tests/ps-utilisation.test.ts` (capacity, leave, targets), `tests/ps-profit.test.ts`, `tests/ps-yearend.test.ts`
(expected write-down, accrual on / off, reversal next day, no GST rows).

#### PS-A5 Professional paper (matter header, billing basis, UDIN, purpose code)

**User story.** My fee note shows "Matter RSK/014 — Sec 138 NI Act, Delhi · Engagement ENG/26-27/0031" under the client;
the line reads "Professional fees — stage 2 of 3 (fixed fee)"; disbursements are listed separately as recovered at actual
as pure agent; a CA's certificate line shows "UDIN 26123456ABCDEF1234"; a USD invoice shows purpose code P0802 and our
SWIFT / IBAN.

**Acceptance criteria.**
1. **Snapshot** `ps` on invoices (one record key, §1): `{ kind?: 'fee' | 'memo' | 'stage' | 'media' | 'export',
   matter?: { id, code, name, court?, case_no? }, engagement?: { id, number, model }, basis?: string, wd?: {...} (A3),
   udin?: string[] (D5), purpose_code?: string, export?: { checks, edf_no?, edf_date? } (C1 / C2), legal?: { regime:
   'rcm' | 'exempt' | 'taxable', entry? } (B2), stage?: {...} (B4), media?: {...} (B5), lines?: Record<lineId, { matter?,
   udin?, stage?, ro?, covered? }> }`; each package writes its sub-object through one `psSnapshot(kind, …)` helper. Old
   documents without `ps` print unchanged.
2. **Header block** (`ProfBlock.tsx`, lazy, after `PartyPanel` and the R12 / R13 blocks, before `GstBody`, never on
   `receipt`): matter code / name / court / case no., engagement number and model, the billing-basis sentence, and — for
   exports — purpose code and the export-check summary (C1). Accent variable only.
3. **Line sub-line**: `trackingText` gains one helper call `psLineText(item, ps)` → "Matter RSK/014" / "UDIN …" / "Stage 3
   of 5 — working drawings" / "RO 0042 · Times of India, Delhi, 12 Oct" printed under the line name in both item tables.
   Without `ps` it returns ''.
4. **Annexure page** (`ProfAnnexurePage.tsx`, lazy, R3-B4 pattern): the matter's time summary by timekeeper (hours, rate,
   amount), the disbursement schedule (B1), the stage computation (B4), the media schedule (B5) — from the snapshot only.
   The existing timesheet annexure is unchanged and prints first.
5. **Bank details for exports**: additive `SenderProfile.swift`, `iban`, `intermediary_bank` (printed only on export
   documents; snapshotted with the sender).
6. Declarations (`psDeclaration` in `paper-helpers.ts`): the B2 legal-services sentence; "Disbursements recovered at
   actual as pure agent (Rule 33) — outside the taxable value"; the C1 export sentence; the C5 "not registered under GST"
   sentence. Each statutory sentence carries "verify" where its CA item is open.
7. Print copies, the share link and PDF export carry the same paper (they render `TemplateEngine`).

**Files.** New: `src/components/templates/parts/{ProfBlock,ProfAnnexurePage}.tsx` + `prof-paper.module.css`,
`src/lib/prof/{ps-snapshot,ps-print}.ts`. Edit: `TemplateEngine.tsx` (two lazy mounts, §6), `paper-helpers.ts`
(`psLineText`, `psDeclaration`), `invoice-defaults.ts` (`R14_RECORD_KEYS`, one spread token), the profile form (SWIFT /
IBAN — lazy row).

**Tests.** `tests/ps-print.test.ts`: header by snapshot; sub-line texts per kind; declarations; old invoices without `ps`
render byte-identical (paper HTML fixture); `ps` survives `normalizeRecord` (load → edit → save); SWIFT / IBAN only on
export documents.
