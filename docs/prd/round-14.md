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

### PS-B — Disbursements, legal and trade specifics (packs `practice`, `legal`, `design`, `media`)

#### PS-B1 Disbursements and pure agent (the GSTR fix)

*Seen in:* Clio / Bill4Time (hard and soft costs), every Indian advocate's and CA's fee note (court fee, stamp, ROC fee
"at actuals").

**User story.** I pay ₹2,450 court fee and ₹500 e-stamp for a client in cash, tag them to the matter as disbursements on
behalf of the client, and bill them with my fee. GSTR-1 shows only my fee; the disbursements are listed on the fee note
as recovered at actual; the WIP view tells me ₹38,000 of disbursements are unrecovered for more than 60 days.

**Acceptance criteria.**
1. **Disbursement entry** (lazy row in the expense modal and a "Disbursement" quick button on the matter): an expense row
   with additive `PurchaseRecord.ps = { disb: 'court_fee' | 'stamp' | 'govt_fee' | 'filing' | 'notary' | 'travel' |
   'courier' | 'other', on_behalf: boolean, wo? }`, the matter as `cost_centre_id`, `billable_to_client_id` and
   `pure_agent` as today. Court fees, stamp duty and government fees default to `on_behalf: true`, `pure_agent: true`, no
   GST, no ITC; travel and courier default to "part of my fee" (taxable, markup 0 %) — PS3.
2. **The GSTR fix**: a pure-agent line built by the timesheet flow (`expenseLine`) or the pre-bill now carries the
   existing R8 line key `charge_head_id: 'rule33'` and the shared `PURE_AGENT_CHARGE` text as its description (the label
   stays in the line name), so `isPureAgentLine` — read by `gst-reports.ts`, `einvoice.ts` and `eway.ts` since QA8 T9 —
   leaves it out of Table 8, the HSN summary, 3.1(c), the e-Invoice item list (kept in `OthChrg`) and the e-Way item list
   (kept in `otherValue`). The document total is unchanged. **Old invoices are not rewritten** (Critical Rule 3): their
   pure-agent lines stay nil-rated in GSTR-1; a GST-guard finding lists them per period with "verify with your CA (PS3)".
3. **Recovery**: the fee note groups disbursements under "Disbursements (recovered at actual)" with date, kind and
   receipt / challan no.; the annexure carries the schedule (A5). Unrecovered disbursements age in the WIP view (A4) and
   can be written off (`ps.wo`).
4. **Ledger**: unchanged (gross: the cost is an expense, the recovery income — T25); a firm that wants a recoverable
   asset instead keeps using a typed journal until the CA answers PS3 (§8 Q9).
5. **TDS base** for the expected 194J (D3) excludes pure-agent lines and GST (PS25).

**Files.** New: `src/lib/prof/{ps-disb,ps-disb-guard}.ts`, `src/components/prof/DisbursementRow.tsx`. Edit:
`timesheets.ts` (`expenseLine`: two fields on the pure-agent branch — §6, reviewed by the lead), the expense modal (one
lazy row), `gst-guard-alerts.ts` or the GST guards source list (one lazy legacy check).

**Tests.** `tests/ps-disb.test.ts`: kinds and defaults; new pure-agent lines satisfy `isPureAgentLine`; GSTR-1 Table 8 /
HSN, e-Invoice and e-Way leave them out with the document total unchanged; an old invoice with the 0 % line reports as
before; TDS base excludes them; ageing and write-off. `tests/timesheets.test.ts` updated only for the two new fields.

#### PS-B2 Advocates: reverse charge or exemption by client type; the fee memo

**User story.** I am an advocate, not registered under GST. My fee memo to a company says "Legal services — GST payable
by the recipient under reverse charge (N 13/2017-CT(R), entry 2)"; my memo to a salaried individual says "Exempt — N
12/2017-CT(R), entry 45". A company paying an advocate gets a prompt to raise its RCM self-invoice.

**Acceptance criteria.**
1. `legalRegime({ client, line, supplier, date })` (pure, `prof-rules.ts` `LEGAL_SERVICES_RULES`, dated from 2017-07-01,
   the entry 45 threshold wording row from 2019-10-01, `verified: false` where §2.3 says so) returns `'rcm' | 'exempt' |
   'taxable'` with the reason:
   - recipient a **business entity** (client has a GSTIN, or `Client.ps.entity === 'business'`) above the threshold
     (`Client.ps.small_business` not ticked) → `rcm`;
   - recipient another advocate / firm of advocates (`Client.ps.advocate`), a non-business person, or a business entity
     with turnover up to the registration threshold in the preceding FY → `exempt` (a senior advocate's supply to an
     advocate is not exempted — PS1);
   - a non-legal line (SAC outside 9982, e.g. a law firm's tax filing service) → `taxable` (forward charge).
2. The editor applies it once per line on a new fee note in a `legal` profile (a chip "Legal services: reverse charge —
   because the client has a GSTIN · change"), using existing mechanisms only: `rcm` → the existing outward reverse-charge
   flag (tax shown, not collected, `rcm.ts`); `exempt` → the line's existing R10 exempt marker (`item.sv.exempt =
   'EXEMPT'`, Table 8 exempt column); a document with only exempt lines from a registered advocate → Bill of Supply.
   The snapshot `ps.legal = { regime, entry }` prints the sentence (A5).
3. **Unregistered advocate** (no GSTIN on the profile): the document is titled "Fee memo", carries no tax columns, prints
   "Not registered under GST — legal services under reverse charge / exempt as stated" and never reaches GSTR-1 (the
   existing unregistered behaviour). The profile shows a help note on Sec 23(2) / N 5/2017-CT (PS2).
4. **Fee-memo particulars**: enrolment no. and State Bar Council under the name (from `prof_settings.legal`, snapshotted
   in `ps`), court / case no. from the matter, appearances as per-item fees: additive `WorkType.ps.unit: 'hour' |
   'appearance' | 'item'` (an appearance work type bills per entry, not per minute; time still logged for realisation).
5. **Inward side** (any company): a purchase bill from a vendor flagged `Vendor.ps.advocate` with a legal SAC (9982…)
   shows the RCM prompt and the self-invoice action (existing `rcm-self-invoice.ts`), unless the company marks itself
   below the threshold (entry 45) — one lazy lookup row beside the R13 scrap lookup in `RcmGoodsNotice.tsx`.
6. Arbitral tribunals and senior advocates' representational services are covered by the same rule rows (entry 2 covers
   "individual advocate including a senior advocate"); the app asks nothing more.

**Files.** New: `src/lib/prof/{ps-legal,ps-legal-paper}.ts`, `src/components/prof/LegalRegimeChip.tsx`. Edit:
`RcmGoodsNotice.tsx` (one lazy lookup row), the client form (one lazy "Legal-services status" row), the vendor form (one
lazy "Advocate / firm of advocates" tick), the work-type form (one lazy unit select).

**Tests.** `tests/ps-legal.test.ts`: each regime by client and line; threshold wording by date; registered vs
unregistered paper; Bill of Supply for all-exempt; RCM tax excluded from receivable (existing `receivableTotal`);
GSTR-1 rows (RCM `rchrg: 'Y'`, exempt in Table 8); per-appearance billing; inward prompt.

#### PS-B3 Client money (trust / escrow) ledger

*Seen in:* Clio, PracticePanther (client- and matter-level trust ledgers, three-way reconciliation), Bill4Time (earned vs
retainer funds). India has no IOLTA-type statute; Bar Council Rules 25–28 require accounts of client money, and the
CA Act forbids mixing a client's money with the CA's own (PS27).

**User story.** A client deposits ₹50,000 "for court fees and expenses" into our client account. I pay ₹12,000 of
stamp duty from it, then — with the client's written approval — transfer ₹20,000 to fees against my invoice. The client
statement shows ₹18,000 held; the month-end three-way reconciliation agrees bank, ledger and client balances.

**Acceptance criteria.**
1. **Client-money bank account**: additive `BankAccount.client_money?: true` (the R5-A `clearing` / R11
   `rera_project_id` / R5-C `fcra` precedent). It stays a real bank (BRS, statements, imports work); `isClientMoneyAccount`
   keeps it out of the firm's own cash views and pickers for fee receipts and supplier payments (§4 conventions).
2. Table `client_money` (`CMV/FY…`, dated, numbered; `books.edit`): `{ id, number, date, kind: 'receipt' | 'payment' |
   'to_fees' | 'refund' | 'transfer' | 'interest', client_id, matter_id?, amount, bank_account_id, purpose: 'expenses' |
   'fees' | 'other', ref, narration, invoice_id? (to_fees), authority?: { date, mode: 'written' | 'email' | 'engagement',
   ref }, voucher_ids[] }`.
3. **Postings** (one all-or-nothing write with `withTablesRollback`):
   - receipt: Dr client-money bank / Cr "Client money held" (liability; one sub-ledger per client);
   - payment on behalf (stamp, court fee, counsel's fee paid for the client): Dr Client money held / Cr client-money bank
     — not a firm expense, never billed again (the statement shows it);
   - to fees: Dr Client money held / Cr client-money bank, and a **normal receipt** (`transactions` row) into the office
     bank against the invoice (the money becomes the firm's; cash readers see it then) — refused without an issued
     invoice, above its balance, or without `authority` (owner may override with a reason, audited);
   - refund to the client; transfer between two clients' balances (both named); interest (credited to the client or to
     the firm by `prof_settings.client_money.interest_to`, asked the first time — PS27).
4. **Guards**: no client's (or matter's) balance may go negative; a payment from a client-money account must name a
   client; a receipt asks "for fees or for expenses?" (BCI Rule 26) — "fees" sends the user to the ordinary advance flow
   (GST on advances for services, 5.3) instead (PS10).
5. **Three-way reconciliation** (`reconcile` view): (1) the bank's statement balance on the date (from the BRS / imported
   statement, or typed), (2) the ledger balance of the client-money bank accounts, (3) Σ client balances; every
   difference listed (uncleared items from the BRS, unallocated entries); printable, with "working paper" wording.
6. **Statements** (`statements` view): per client / matter, the period's entries and balance; PDF / `wa.me`; the
   ledger and statements are available to the client on request (BCI Rule 28 as reported).
7. Balance sheet: the client-money bank sits in cash and bank with a note "of which held for clients ₹…", and "Client
   money held" in other current liabilities (PS32). The year-end pack lists balances by client.

**Files.** New: `src/lib/prof/{ps-client-money,ps-cm-post,ps-cm-reco}.ts`, `src/components/prof/{ClientMoneyDesk,
CmLedgerView,CmReconcileView,CmStatementsView}.tsx`. Edit: `bank-accounts.ts` family (`isClientMoneyAccount` beside
`pickableBankAccounts` — one export, reviewed by the lead), the bank-account form (one lazy tick), the cash views that
use `pickableBankAccounts` already (no edit) and the three that do not (Today, payment modes, collection lag — one
filter call each, reviewed by the lead).

**Tests.** `tests/ps-client-money.test.ts`: postings per kind; negative balance refused; to-fees needs invoice and
authority, settles the invoice, office-bank receipt created once; interest by setting; rollback on failure; locked
period refused. `tests/ps-cm-reco.test.ts`: three-way agreement and each kind of difference. `tests/ps-client-money-readers.test.ts`:
Today / payment modes / collection lag / cash forecast leave client-money accounts out; BRS includes them.

#### PS-B4 Architects and interior designers: stage fees on project cost, fit-out pass-through

**User story.** We design a ₹4.2 crore house for 6 % of the project cost, in five stages. After the tender the cost is
revised to ₹4.6 crore; the stage-3 bill picks up the difference on stages 1–2. The client lives in Dubai but the house
is in Pune, so the app tells me the place of supply is Maharashtra and this is not an export.

**Acceptance criteria.**
1. An engagement with model `milestone` may take a **project-cost basis**: `engagement.stage = { fee_pct, cost_basis:
   'estimate' | 'tender' | 'actual', revisions: [{ date, cost, note }], stages: [{ id, label, cum_pct }], extra_pct?
   (documentation / site-visit charges), property: { state, city?, country } }`.
2. Stage bill = fee_pct × current project cost × stage cum_pct − already billed on the engagement (live stage invoices
   less their credit notes, through `progress-billing.ts`'s helpers). A cost revision recomputes every later bill; a
   downward revision that makes the next bill negative suggests a credit note for the excess (never automatic).
3. **Stage template** (`prof_settings.design.stages`): the app seeds an editable 5-stage example labelled "example —
   agree with your client; the COA scale is recommendatory" (PS30); no percentage is presented as a rule.
4. **Place of supply** (PS6): services directly in relation to immovable property → the property's State (Sec 12(3)
   IGST); for property in India the invoice is not an export whatever the client's country (C1 reads `property`); for
   property outside India, the location of the recipient. The suggestion fills the invoice's place of supply once; the
   user can change it.
5. **Interior designers**: two engagement lines kept apart — design fee (taxable service) and execution / fit-out
   (a works contract when it results in immovable property — PS11); materials bought for the client re-bill with markup
   (part of my supply) unless bought in the client's name and paid as pure agent (B1).
6. The stage computation prints on the annexure (A5): cost basis and revisions, fee %, stage %, cumulative, billed, this
   bill.

**Files.** New: `src/lib/prof/{ps-stages,ps-property-pos}.ts`, `src/components/prof/StagesView.tsx` (a view of the
`matters` desk). Edit: none outside `prof/` (progress helpers are imported, not edited).

**Tests.** `tests/ps-stages.test.ts`: stage maths, revisions up / down, credit-note suggestion, extra %, rounding to the
rupee; `tests/ps-property-pos.test.ts`: property in India for a foreign client → POS State, not export; property abroad
→ recipient's location.

#### PS-B5 Media and digital agencies: pass-through, release orders, commission

**User story.** We book ₹3 lakh of newspaper space and ₹1.2 lakh of Meta ads for a client in October. The newspaper
space is in our name; the Meta account is the client's own and we only manage it. The bill shows the newspaper cost with
our 15 % service fee (all taxable), the Meta spend as recovered at actual (pure agent), and our monthly retainer.

**Acceptance criteria.**
1. Media purchase bills carry `PurchaseRecord.ps.media = { client_id, engagement_id?, ro_no?, medium: 'print' | 'tv' |
   'radio' | 'outdoor' | 'digital' | 'other', insert_from?, insert_to?, mode: 'principal' | 'agent', commission_pct? }`.
2. **Mode** decides the re-bill (PS12): `principal` (space bought in our name and resold — the default) → the cost is part
   of our taxable supply (line at our service rate unless the user picks the media class), with the agency fee / markup;
   `agent` (the client contracts with the media or platform, Rule 33 conditions met) → a pure-agent line (B1 sentinel)
   plus our fee line. The pre-bill (A3) shows media lines grouped by medium.
3. **Release orders**: the existing purchase-order document prints as "Release order" (title, publication / slot
   schedule, size / duration, rate, client reference) when `ps.media` is present; RO numbers use the PO series. B5 confirms
   the PO storage path and puts the fields on that row by declaration merging (no new table).
4. **Media commission** received from a publisher is billed as our service to the publisher (an ordinary invoice); TDS
   by the client on our bill defaults to **194C** (Circular 715), on publisher commission per PS18.
5. The media schedule prints on the annexure (A5): date, medium, publication / platform, size or slots, cost, mode.
6. Foreign ad platforms: bills from a non-resident platform use the existing import-of-services RCM on purchases; the
   help notes the equalisation levy ended (6 % from 1 Apr 2025) — PS38.

**Files.** New: `src/lib/prof/{ps-media,ps-ro}.ts`, `src/components/prof/MediaRows.tsx` (lazy rows in the bill modal and
the pre-bill). Edit: the purchase-order print path (one lazy title / schedule part, reviewed by the lead).

**Tests.** `tests/ps-media.test.ts`: principal vs agent lines and GSTR effect; commission line; RO print fields;
194C default; import-RCM unchanged.

### PS-C — Export of services and multi-currency (pack `svcexport`)

#### PS-C1 Export-of-services check (Sec 2(6), place of supply, intermediary)

**User story.** I bill a US client for software consultancy under LUT. The invoice shows a green "Export of services:
5 / 5 conditions" — supplier in India, recipient outside India, place of supply outside India (Sec 13(2)), paid in USD
(after the receipt), not a branch of ours. A UK client's Indian subsidiary would have shown "recipient in India — not an
export".

**Acceptance criteria.**
1. `exportCheck({ invoice, client, engagement, receipts, date })` (pure) returns the five Sec 2(6) conditions with `ok |
   fail | pending | unknown` and the reason:
   - (i) supplier location (profile in India);
   - (ii) recipient location — additive `Client.ps.country` (else billing address country), `Client.ps.fixed_estab_in_india`
     (a recipient with an Indian establishment receiving the service there fails);
   - (iii) place of supply — Sec 13(2) by default; exceptions flagged by the engagement / line class: immovable property
     (13(4), B4), services needing physical presence or on goods made available (13(3)), events (13(5)); **intermediary**
     by the dated rule `INTERMEDIARY_POS_RULES` (`prof-rules.ts`): to 29 Mar 2026 → supplier's location (not an export);
     from 30 Mar 2026 → Sec 13(2) (PS4);
   - (iv) payment — `pending` until receipts / IRMs exist, then `ok` when in convertible foreign exchange or INR through a
     route the user marks as RBI-permitted (SRVA, Circular 202/14/2023), else `fail`;
   - (v) distinct person — `Client.ps.relation: 'unrelated' | 'own_branch' | 'group'`; `own_branch` fails (Explanation 1
     to Sec 8).
2. The editor shows the result on any document with supply type export / place of supply 96–97 when `svcexport` is on;
   the GST preflight raises a **soft** warning for an LUT export with a failing condition and an info line while (iv) is
   pending. The supply type is never changed automatically.
3. The result is snapshotted as `ps.export.checks` (A5 prints a one-line summary on the export block).
4. `tr-indents.ts`'s TR21 note reads the same dated rule (one line, owner C, reviewed by the lead), so an indent agent's
   foreign-principal commission from 30 Mar 2026 shows "export if Sec 2(6) is met" instead of "not an export".
5. Purpose code (A5): `prof_settings.export.purpose_code` default by `prof_kind` (a short editable list of RBI purpose
   codes for services; the user's choice, PS39).

**Files.** New: `src/lib/prof/{ps-export-check,ps-pos}.ts`, `src/components/prof/{ExportSvcDesk,ExportCheckView,
ExportCheckChip}.tsx`. Edit: `trade/tr-indents.ts` (one dated lookup), the GST preflight source list (one lazy check).

**Tests.** `tests/ps-export-check.test.ts`: each condition; intermediary before / on / after 30 Mar 2026; immovable
property; own branch; INR via SRVA; pending until receipt; snapshot.

#### PS-C2 FEMA 2026: EDF register, realisation from the invoice date

**User story.** On 25 November I see that my October software invoices need an EDF by 30 November (30 days after the
month end), and that a ₹6 lakh invoice to a German client is due for realisation by 14 July 2027 (9 months from the
invoice date), not 15 months as before.

**Acceptance criteria.**
1. **Rule rows appended** (never edited) to `trade/trade-rules.ts` (owner C, reviewed by the lead): in
   `EXPORT_REALISATION_MONTHS_RULES` a row `{ from: '2026-10-01', value: 9, source: 'FEMA 23(R)/2026-RB Reg 5(1)(a), as
   amended by FEMA 23(R)(1)/2026-RB of 22 Sep 2026 — verify transition (PS15)' }`; a new
   `EXPORT_REALISATION_INR_MONTHS_RULES` (INR-invoiced or settled: 12 from 2026-10-01; earlier dates fall back to the FX
   rule). Goods exports read the same rows (the regulations apply to goods too; X1 is cross-referenced).
2. **Services clock**: the export register (R4-C2) starts a services export's clock on the **invoice date** without the
   "no shipping bill" flag (one helper `isServicesExport` in `trade/export-register.ts`: no goods lines, or every line a
   SAC — owner C, reviewed by the lead). Mixed documents keep the shipping-bill clock.
3. Table `edf_register` (dated; `books.edit`): `{ id, kind: 'software' | 'services' | 'softex', period (YYYY-MM) or
   invoice_ids[], edf_no?, filed_on?, authority: 'ad_bank' | 'stpi' | 'sez', value_fc, currency, value_inr, due,
   small_value_declared?: boolean, status: 'due' | 'filed' | 'closed', notes }`. Due dates from `prof-rules.ts`
   `EDF_RULES` (from 2026-10-01: 30 days after the end of the invoice month; services other than software may file by
   the receipt date; ≤ ₹10 lakh per invoice may be closed on the exporter's declaration); before 2026-10-01 rows of kind
   `softex` record history only.
4. **Builder**: "Prepare EDF for October" lists the month's export-of-services invoices by kind (software / other,
   from `Client.ps` / engagement / SAC 9983…), totals by currency, and writes a draft row; the EDF number and date are
   typed after the bank / STPI files it (no portal).
5. Due list and a lazy compliance-calendar group ("EDF due", "realisation due in 30 days", "past due — ask the AD bank
   for an extension (Reg 5(1) second proviso)").
6. INR-invoiced exports (currency INR, place of supply outside India) take the INR rule; the register shows which rule
   applied.

**Files.** New: `src/lib/prof/{ps-edf,ps-fema}.ts`, `src/components/prof/EdfView.tsx`, `RealisationSvcView.tsx`. Edit:
`trade/trade-rules.ts` (appended rows + one rule), `trade/export-register.ts` (one helper), the compliance-calendar source
(one lazy group).

**Tests.** `tests/ps-edf.test.ts`: due dates (month-end + 30, receipt-date option, ≤ ₹10 lakh), software vs services,
SOFTEX history. `tests/ps-fema.test.ts`: services clock from the invoice date; 9 months from 2026-10-01, 15 for an
invoice of 2026-09-15, INR 12; goods rows unchanged for older shipments; `tests/export-register*.test.ts` pass unchanged
except the new dated cases.

#### PS-C3 IRM / FIRA / e-BRC per services invoice; the refund statement

**User story.** I export services under LUT and claim a refund of accumulated ITC every quarter. The app lists each
invoice with its FIRA and e-BRC numbers and the amount realised in the quarter, and fills the refund working paper.

**Acceptance criteria.**
1. The export register's services view shows per invoice: IRMs allocated (existing `export_irms`), the bank's FIRA /
   e-FIRC reference (additive `ExportIrm.ps.fira_no`), e-BRC no. and date (existing fields), realised foreign currency
   and INR, **short realisation** split into foreign bank charges (a reduction the exporter may declare — Reg 6 proviso,
   ≤ ₹10 lakh) and unrealised (Rule 96A clock, X2).
2. **Refund working paper** for export of services without payment of tax (Rule 89(4)): turnover of zero-rated supply of
   services for the period = payments received in the period for services exported (+ earlier advances for services
   completed in the period, − advances for services not yet completed), net ITC, adjusted total turnover, maximum refund;
   the statement rows (invoice no. / date, value, FIRA / e-BRC no. / date, realised value). It pre-fills a draft row of
   the existing refund register (`gst-cash-refunds.ts` `saveRefund`, category for exports under LUT) — PS14.
3. CSV / XLSX of the statement; nothing is filed.

**Files.** New: `src/lib/prof/{ps-brc,ps-refund-svc}.ts`, `src/components/prof/RefundSvcView.tsx`. Edit: none outside
`prof/` (`saveRefund` and the export register are imported).

**Tests.** `tests/ps-refund-svc.test.ts`: Rule 89(4) maths with advances; statement rows; short-realisation split;
draft refund row written once.

#### PS-C4 Multi-currency rate cards and platform receipts

**User story.** My client card says USD 55 an hour. I bill 40 hours on 31 October; the invoice is in USD with the
currency master's rate for 31 October and the Rule 34(2) note. Payoneer pays me USD 2,145 after a USD 55 fee; the app
records the full receipt against the invoice, the fee as an expense (with import RCM because Payoneer bills from abroad),
and the exchange difference.

**Acceptance criteria.**
1. **Rate currency**: rate-card rates (task, staff, project, client, work type, engagement) carry an optional currency
   (additive `ps.currency`; absent = INR). `resolveRate` returns `{ rate, currency }` through the same optional argument as
   A4 (§6). Billing into another currency converts at the currency master's rate on the bill date (`rateOn`), shows "USD
   55/h ≈ ₹4,620/h (RBI ref. 31-10-2026)" and snapshots nothing new (the line carries the converted rate as today).
2. **Rule 34(2)** hint on foreign-currency service documents: "Value in INR at the rate under generally accepted
   accounting principles on the date of time of supply — verify with your CA (PS7)"; the user may type the bank's rate
   instead of the master's (existing behaviour).
3. **Platforms** (`prof_settings.platforms[]`: name, kind (`paypal` / `wise` / `payoneer` / `upwork` / `skydo` /
   `stripe` / `razorpay` / `other`), payout bank, fee ledger, vendor id, non-resident?). "Receive via platform" on a
   foreign invoice: gross amount (FC), platform fee (FC), conversion fee, INR credited → one receipt of the gross at the
   realised rate (existing receipt + `fx-gain.ts`), one expense row for the fees (vendor = the platform; import-of-
   services RCM through the existing bill logic when the platform is non-resident and the company is registered — PS8),
   and the short realisation reason "platform fee" for the export register (C3).
4. Year-end: unbilled foreign-currency WIP shown at the closing rate in the year-end paper (A4) as a memo (PS37).

**Files.** New: `src/lib/prof/{ps-fx-rates,ps-platforms}.ts`, `src/components/prof/PlatformsView.tsx`,
`PlatformReceiptDialog.tsx`. Edit: `rate-cards.ts` (the same optional argument as A4 — A adds it, C fills currency),
the receipt dialog (one lazy "via platform" link).

**Tests.** `tests/ps-fx-rates.test.ts`: currency resolution and conversion; `tests/ps-platforms.test.ts`: gross receipt,
fee expense, RCM flag for a non-resident platform, fx gain, short-realisation reason.

#### PS-C5 Freelancer's registration threshold; unregistered export invoice

**User story.** I am a freelance designer, not registered. The threshold card shows ₹14.2 lakh of the ₹20 lakh limit
this year, exports included, and warns at 80 %. My dollar invoices say "Supplier not registered under GST".

**Acceptance criteria.**
1. **Threshold card** (`firm` desk → `threshold`, also a Dashboard insight when `prof_kind = freelancer`): aggregate
   turnover for the FY (taxable + exempt + exports + inter-State, at INR value; excluding inward RCM), against
   `REGISTRATION_THRESHOLD_RULES` (`prof-rules.ts`: services ₹20 lakh, special-category States ₹10 lakh, dated); warnings
   at 80 % and 100 %; notes on N 10/2017-IT (inter-State services below the threshold) and on compulsory registration
   cases the user must check (PS13).
2. An **unregistered** company's documents print "Supplier not registered under GST" (A5 declaration), carry no tax
   columns, hide LUT text and stay out of GST returns (existing unregistered behaviour); exports still reach the FEMA
   register (C2) and the realisation clock.
3. Crossing the threshold opens a checklist: register, then LUT (existing register), then switch invoices to tax invoices
   from the registration date (the profile's GSTIN with an effective date — existing field).

**Files.** New: `src/lib/prof/ps-threshold.ts`, `src/components/prof/ThresholdView.tsx`. Edit: the dashboard insights
list (one lazy card, guarded by `prof_kind`).

**Tests.** `tests/ps-threshold.test.ts`: turnover parts (exports in, RCM inward out), special-category limit, warnings,
FY boundary (local days).

### PS-D — The firm's statutory desk (packs `partners`, `practice`, `cafirm`)

#### PS-D1 Partners: capital and current accounts, Sec 40(b) / Sec 35, appropriation

**User story.** We are three partners (40 / 30 / 30). At the year end the app computes book profit, allowable
remuneration under Sec 40(b) (₹3 lakh or 90 % of the first ₹6 lakh, 60 % of the rest), interest on capital at 12 %, and
posts remuneration and interest to the current accounts, then shares the rest in the ratio. Each partner gets a
statement of capital and current account.

**Acceptance criteria.**
1. Table `partners` (`settings.manage`): `{ id, name, pan, kind: 'working' | 'non_working', designated?: boolean (LLP),
   joined, left?, capital_account_id, current_account_id, terms: [{ from, share_pct, remuneration: { mode: 'fixed' |
   'pct_book_profit' | 'max_allowable', amount?, pct? }, interest_pct, interest_on_drawings_pct?, deed_ref }], vendor_id?
   (for TDS, D2) }`. Ledger accounts "Capital — <name>" and "Current — <name>" (group `CAPITAL`) are created on save;
   shares must total 100 % on every date (validation).
2. **Drawings**: a payment helper posts Dr Current — <partner> / Cr bank or cash; interest on drawings (by the deed's
   rate, product method by month) is computed at the year end (income of the firm).
3. **Year-end run** — table `partner_runs` (dated, `books.edit`): for an FY, book profit = net profit per the ledger
   before partners' remuneration (+ user adjustments, listed), interest on capital (rate ≤ the cap in
   `PARTNER_INTEREST_CAP_RULES`, 12 %; on opening capital or on daily balances — setting), **allowable remuneration** from
   `PARTNER_REMUNERATION_RULES` (`prof-rules.ts`, dated by the FY start: from 2009-04-01 ₹1.5 lakh / 90 % of the first
   ₹3 lakh / 60 %; from 2024-04-01 ₹3 lakh / 90 % of the first ₹6 lakh / 60 %), remuneration per the deed, the excess
   disallowed (a note for the computation, not a journal), and the residual profit by ratio. 2025 Act label Sec 35 by
   `ita2025.ts` for TY 2026-27 on (PS20).
4. **Postings** (one run, all-or-nothing, reversible by the owner while the period is open): Dr "Partners' remuneration"
   and "Interest on partners' capital" (expenses) / Cr current accounts; residual profit: Dr "Profit & loss appropriation"
   (group `CAPITAL`) / Cr current accounts in the ratio (PS33). Interest on drawings: Dr current accounts / Cr "Interest
   on drawings" (income). TDS u/s 194T on remuneration / interest through D2.
5. A firm on presumptive taxation (D4) sees "remuneration and interest are not deductible under 44ADA / Sec 58 — verify
   (PS22)".
6. Statements per partner (opening, contributions, drawings, interest, remuneration, share, closing) and the annual pack's
   "Partners' capital accounts" note filled from them (`notes-auto.ts` reads `partners` through one optional lazy source,
   reviewed by the lead).

**Files.** New: `src/lib/prof/{ps-partners,ps-partner-run,ps-partner-post}.ts`, `src/components/prof/{FirmDesk,
PartnersView,AppropriationView}.tsx`. Edit: `ledger/notes-auto.ts` (optional partner rows; unchanged output without them).

**Tests.** `tests/ps-partners.test.ts`: shares 100 % by date; drawings posting; interest on drawings. `tests/ps-partner-run.test.ts`:
40(b) slabs on both sides of 2024-04-01, loss case (₹3 lakh), interest cap, excess disallowed, residual by ratio, journals
balance, reversal, locked period refused.

#### PS-D2 TDS u/s 194T on partner payments

**User story.** Our partners' monthly remuneration crosses ₹20,000 in April; the app deducts 10 %, posts it to TDS
payable, and the quarter's 26Q (Form 140) working paper lists it.

**Acceptance criteria.**
1. **Rule rows appended** to `tds-rules.ts` (owner D, reviewed by the lead): section code `194T` (family `194T`, label
   "194T Payments to partners", rate 10 % from 2025-04-01, aggregate threshold ₹20,000 per FY per partner; RPU code
   marked unverified — PS19); `ita2025.ts` gains the 2025-Act label row when a CA confirms it (until then the old code is
   shown with the existing "verify" note).
2. Credits of salary, remuneration, commission, bonus or interest to a partner's current account (monthly entries or the
   year-end run) create a deduction through the existing `saveManualDeduction` (the R10 payout precedent): Dr Current —
   partner / Cr TDS payable 194T, in the TDS register, challans and the 26Q paper. Drawings and the residual profit share
   never.
3. **Threshold**: aggregated per partner per FY across the five kinds; on the credit that crosses ₹20,000 the TDS is
   computed on the FY's total so far (catch-up), afterwards on each credit (PS19 asks whether the whole amount or only the
   excess).
4. Year-end credits dated 31 March fall under the existing March deposit rule (30 April).

**Files.** New: `src/lib/prof/ps-194t.ts`, `src/components/prof/Tds194tView.tsx`. Edit: `tds-rules.ts` (appended rows),
`ita2025.ts` (one appended row, pending PS19).

**Tests.** `tests/ps-194t.test.ts`: threshold and catch-up; kinds included / excluded; register rows; 26Q paper code;
year-end credit deposit due.

#### PS-D3 194J receivable by client: defaults, expected TDS, Form 131 chase

**User story.** My corporate clients deduct 10 % (professional), a SaaS client deducts 2 % (technical), my ad-agency
work is 194C at 2 %. Each fee note fills the expected TDS; the register tells me which Form 131 (16A) certificates are
missing for Q2 and drafts the reminder.

**Acceptance criteria.**
1. Client default `Client.ps.tds = { section: '194J' | '194J-T' | '194C' | '194H' | 'none', rate? }` (lazy row in the
   client form); profile defaults (A1): `ca`, `legal`, `design` → `194J` (10 %); `consulting` asks per client
   ("professional 10 % or technical 2 %?" — PS18); `agency` → `194C` (rate by our own entity form: 1 % individual / HUF,
   2 % others); `freelancer` → `194J`.
2. A new fee note to that client fills the existing invoice fields `tds_section` / `tds_rate` / `tds_amount` on the
   **fee base** = taxable value of non-pure-agent lines, GST excluded (PS25), once the client's FY total passes the
   section's threshold from `tds-rules.ts` (₹50,000 for 194J from 2025-04-01; 194C ₹30,000 single / ₹1 lakh year); below
   it the editor shows "TDS not expected yet (₹32,000 of ₹50,000)" and leaves the fields empty.
3. The existing TDS receivable register (`tds-register.ts`) gains a lazy "Certificates" panel: per client × quarter,
   expected TDS, matched in 26AS / Form 168 (existing match), Form 131 received or not, and a **chase letter** (PDF /
   `wa.me` / `mailto:`) listing the invoices and amounts, from the date the certificate is due (rule from `tds-rules.ts`
   if present, else 15 days after the 26Q due date — verify).
4. Labels follow `ita2025.ts` (Form 16A → 131, 26AS → 168, Sec 393 table item) by date.

**Files.** New: `src/lib/prof/ps-tds-recv.ts`, `src/components/prof/Tds194jView.tsx` (also mounted lazily in
`TdsTab.tsx`). Edit: `TdsTab.tsx` (one lazy panel), the client form (one lazy row).

**Tests.** `tests/ps-tds-recv.test.ts`: defaults by profile; fee base excludes pure agent and GST; threshold by client
and FY; 194C rate by entity form; chase list by quarter.

#### PS-D4 44ADA / Sec 58 presumptive working paper

**User story.** I am a freelance architect. The paper shows FY gross receipts of ₹61 lakh, cash 2 % (so the ₹75 lakh
limit applies), presumptive income ₹30.5 lakh against ₹38 lakh in my books, and reminds me that advance tax is due in
one instalment by 15 March.

**Acceptance criteria.**
1. `presumptive({ fy, invoices, receipts, purchases, settings })` (pure): gross receipts of the profession for the FY
   (issued fee notes' taxable value at INR, pure-agent recoveries out, credit notes in — on the accrual basis; the cash
   basis shown too), cash share (receipts by cash mode ÷ total receipts), the applicable limit from
   `PRESUMPTIVE_PROF_RULES` (`prof-rules.ts`: ₹50 lakh from FY 2016-17; ₹75 lakh when cash ≤ 5 % from FY 2023-24; the
   Sec 58 table row from TY 2026-27), deemed income at 50 %, actual profit per the ledger, the difference.
2. **Eligibility checklist** the user ticks (resident; individual or partnership firm — not an LLP; a profession under
   Sec 44AA(1) or notified — legal, medical, engineering, architectural, accountancy, technical consultancy, interior
   decoration, film artist, company secretary, information technology, authorised representative): the app never decides
   (PS22). An LLP profile sees "not available to an LLP — verify".
3. **Advance tax**: one instalment by 15 March (`PRESUMPTIVE_ADVANCE_TAX_RULES`, dated; 2025 Act mapping verify).
4. Printable paper with "working paper — verify with your CA"; nothing is filed.

**Files.** New: `src/lib/prof/ps-presumptive.ts`, `src/components/prof/PresumptiveView.tsx`. Edit: none outside `prof/`.

**Tests.** `tests/ps-presumptive.test.ts`: limits by FY (₹50 / ₹75 lakh, 5 % cash test at the boundary), deemed 50 %,
pure-agent recoveries out, credit notes in, LLP note, local-day FY boundaries.

#### PS-D5 CA / CS / CMA desk: compliance billing from the practice desk; UDIN register

**User story.** At month end the CA desk shows, for each client company on this device, what we did: GSTR-1 and 3B
filed for October, the DSC renewed, two certificates with UDINs. One click per client makes a draft fee note in our
firm's own company with each item at the client's agreed fee, plus the ₹2,000 late fee we paid on the client's behalf as
a disbursement.

**Acceptance criteria.**
1. **Link companies to clients**: `prof_settings.ca.company_clients: [{ company_id, gstin?, client_id }]` — the device's
   company registry (`realCompanies()`) mapped to the firm's client masters (GSTIN as a fallback key on another device).
2. **Fee schedule**: catalogue items flagged `ps.fee_event` (`gstr1`, `gstr3b`, `gstr9`, `tds_return`, `itr`,
   `tax_audit`, `stat_audit`, `roc_annual`, `certificate`, `dsc_renewal`, `checklist`, `retainer`), with per-client rates
   in `Client.ps.fees`.
3. **Billable events** (derived, never stored): returns filed per company and period from `peekCompliance` (read-only,
   unchanged — Critical rule on `/practice`), DSC renewals from `dsc_register`, checklist items done
   (`client_checklist`), UDIN register rows (below), and typed events (ROC filings for CS firms, cost-audit work for CMA
   firms). Event key `ca:<client>:<kind>:<period>` — billed state is derived from the invoice lines' `bill_refs`, exactly
   like time entries (cancel the invoice → the events are unbilled again).
4. **"Bill from the board"**: select a client and month → a draft fee note in the open (firm) company with one line per
   event at the agreed fee, events covered by a retainer engagement shown at 0, and the client's disbursements (B1:
   government / late fees paid on behalf) — through the same draft builder as A3.
5. **UDIN register** — table `udin_register` (dated; `doc.create`): `{ id, udin, date, client_id, kind: 'certificate' |
   'tax_audit' | 'gst_audit' | 'stat_audit' | 'other', description, member_no, fy?, pan?, revoked?: { date, reason } }`;
   format check (18 characters; the year and membership no. parts checked against the member no. — verify, PS29); "UDINs
   not yet billed" list; the UDIN prints on the billed line (A5). No ICAI / ICSI / ICMAI portal call.
6. Practice desk link: the `/practice` board gains a lazy "Bill" column link to this desk for the linked client
   (`Practice.tsx`, one lazy cell, reviewed by the lead); the board stays read-only.

**Files.** New: `src/lib/prof/{ps-ca-events,ps-ca-bill,ps-udin}.ts`, `src/components/prof/{CaDesk,CaFeesView,
CaEventsView,UdinView}.tsx`. Edit: `pages/Practice.tsx` (one lazy cell), the catalogue item form (one lazy fee-event
select).

**Tests.** `tests/ps-ca-events.test.ts`: events from a peeked company fixture (filed / not filed), DSC and checklist
events, billed state through `bill_refs`, cancel frees; `tests/ps-ca-bill.test.ts`: draft lines, retainer cover,
disbursements included; `tests/ps-udin.test.ts`: format, revoke, unbilled list.
