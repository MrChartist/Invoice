# PRD — Round 12: agriculture and food processing (FPOs and co-operatives, dairy and milk collection, rice / flour / dal / oil mills, cold storages, seed / fertiliser / pesticide dealers, poultry and fishery farms)

Status: draft for build · Drafted 2026-10-27 · Baseline: branch `claude/elegant-cannon-cwapiv` at `a4a3f57`. Merged on
the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–11, Round 7 (hotel), Round 8 (trading), Round 9 (retail) and
Round 11 (construction). **Round 10** (`docs/prd/round-10.md`, services) is being built now. This round touches none of
its files except the shared registries named in §6, and §5 / §6 say how the two rounds share files and budgets.

Companion documents:
- `docs/CA_REVIEW.md` §12 — the agriculture CA items **AG1–AG32**, added with this PRD.
- Raw research (URLs and the claim taken from each; P = primary, S = secondary, V = vendor's own claim):
  `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/r12/round12-sources.md`.

Every item follows `AGENTS.md`:
- local-first and serverless: no iFMS / fertiliser PoS, e-NAM, WDRA repository (NeRL / CCRL), dairy-union, bank or
  state mandi-board calls; files, `wa.me` links, Web Serial devices the user picks, and the device camera only;
- vanilla CSS Modules with tokens; templates use the `accent` variable only (Critical Rule 5);
- invoice snapshots never change: everything an agri document prints is snapshotted on the document;
- Indian-FY numbering for every new series;
- bare dates parsed as local days;
- statutory values date-keyed and append-only, in a rule file kept out of first paint;
- GST, TDS, mandi-fee, 80P / 80PA and licence outputs labelled as working papers ("verify with your CA").

---

## 1. Problem statement

The app already has most of the machinery an agri business needs, built for other verticals:
- **trading (R8)**: weight and bag billing with tare and dhalta (`tr-weight.ts`), mandi / market-fee, aadat, hamali and
  bardana charge heads (`tr-charges.ts`), commission-agent arrivals and bikri patti (`tr-arrivals.ts`, `tr-patti.ts`),
  the RCM notified-goods prompt for goods bought from an agriculturist (`trading-rules.ts`), the 194Q buyer test, the
  bank stock statement and interest notes;
- **manufacturing (Phase 7, R4-A)**: BOMs with by-products, co-products and scrap, manufacturing journals, production
  orders with a WIP godown, job work out / in and the principal's material register (`job-work.ts`), QC;
- **counter (8E, R9)**: POS, a Web Serial weighing scale, batches and expiry, MRP guard, khata credit, licences with
  expiry alerts (pharmacy);
- **books**: bill of supply, bulk e-payment upload files (`bank-upload.ts`), payroll, cost centres, the GSTR-3B Table 5
  exempt-inward reader.

But the owner's test is: **"each and everything has a perfect area in our invoice"**, and for a dairy, a mill, a cold
storage or an input dealer the documents they live by have no place in the app (§2.2, §2.4):

1. **Milk collection has nothing.** No fat / SNF rate chart, no shift-wise (morning / evening) collection, no milk
   analyser or can-weighing input, no 10-day farmer bill with cattle-feed and advance deductions, no farmer payment
   cycle, no dispatch to the union or plant with a fat-kg / SNF-kg reconciliation. A village centre with 200 farmers
   would have to raise 7,000 purchase bills a year by hand.
2. **Buying from farmers is a plain purchase bill.** There is no farmer master (village, centre, bank, membership), no
   purchase voucher in our own series for an unregistered farmer, no moisture / foreign-matter cut, no gate entry or
   weighbridge slip, no farmer slip to hand over, and no cash guard that knows Rule 6DD(e) (cash to a cultivator is
   allowed) — today the cash-limit warnings fire on every farmer payment.
3. **Mills cannot see their yield.** Paddy goes in, rice, broken, bran and husk come out; the BOM can model it, but
   nothing shows the outturn % against the standard (67 / 68 kg per quintal for custom-milled rice), the moisture loss,
   the custom-milling (CMR) account with the State agency, or the milling charges under Circular 153/09/2021.
4. **Cold storages have no custody register.** No lot receipt (bags, chamber, rack), no gate pass out, no rent per bag
   per season, no handling charges, no loan against stored produce with a lien on the lot, no warehouse-receipt print.
5. **Input dealers miss their licences and the subsidy trail.** No fertiliser / seed / insecticide licence register, no
   principal certificate (O-form) per company, no subsidised-fertiliser PoS reference or the PoS-vs-book stock check,
   no credit till harvest with interest.
6. **FPOs and co-operatives miss their members.** No member register with shares, no share certificate, no patronage
   (member-wise business) register, no price-difference / bonus run, no 80P (Sec 149 of the 2025 Act) or 80PA working
   paper, no producer-company registers.
7. **Rates moved on 22 Sep 2025** (UHT milk and paneer to nil; ghee, butter, cheese, condensed milk, tractors, farm
   machinery, bio-pesticides and fertiliser inputs to 5%), and the app has no agri class that knows the date.

**Goal of Round 12:** ship **20 items in four work packages** with mostly disjoint files:
- **AG-A**: the agri profile, farmers and members, produce purchase and agri tax classes, farmer payment cycles, and the
  **agri documents on paper** — 5 items;
- **AG-B**: dairy and milk collection — rate charts, shift collection with analyser and scale, the milk bill, dispatch
  and reconciliation, dairy products and household milk cards — 5 items;
- **AG-C**: mills — paddy / grain intake and weighbridge, milling batches with yield and by-products, custom milling
  (CMR) and job milling, packing / labelling and mill sales, yield and stock reports — 5 items;
- **AG-D**: cold storage, input dealers, FPO / co-operative — lot receipts and gate passes, storage rent, loans against
  stored produce, the input-dealer desk (licences, subsidised fertiliser, credit), members' capital, patronage and
  statutory papers — 5 items.

### How the agri profile switches on (no clutter for others)

- **No new `BusinessType`** (`shop-mode.ts` is first paint and stays untouched). The setup wizard gains one more card,
  **"Farm, dairy & food processing"**, that is *not* a business type: picking it opens the agri picker, and each choice
  writes an existing business type plus the additive settings field **`agri_kind`** (the R8 `trade_kind` / R9
  `retail_kind` / R11 `construction_kind` approach):

  | `agri_kind` | Who | business_type written | Why that type |
  |---|---|---|---|
  | `fpo` | Farmer producer organisation / producer company | `manufacturer` | Aggregates, grades, processes, sells; no sub-profile on `manufacturer` today, so no other round's "Pick your kind" step fires |
  | `coop` | Co-operative society (marketing / multipurpose / PACS-type) | `manufacturer` | Same |
  | `dairy` | Milk collection centre, dairy co-op society, bulk-milk cooler, small dairy plant | `manufacturer` | Same |
  | `mill` | Rice / flour (chakki, roller) / dal / oil mill (sub-choice `mill_kind`) | `manufacturer` | Same |
  | `cold` | Cold storage / agri warehouse | `manufacturer` | Same (a service business, but its modules are set explicitly; `services` would trigger Round 10's step) |
  | `inputs` | Seed / fertiliser / pesticide dealer | `kirana` + `retail_kind: 'general'` | A counter shop: gets R9's MRP guard and POS; `retail_kind` is set so R9's "Pick your shop" step does not fire |
  | `farm` | Poultry, fishery, dairy-farm or plantation owner who sells produce | `manufacturer` | Same |

  Every kind sets an explicit `modules` list and an explicit `industry_packs` list, so `PACK_OF_TYPE` (which applies only
  when the list is absent) never adds a pack, and every existing `manufacturer` / `kirana` company sees exactly what it
  saw. The choice also writes `agri_settings` switches (§4 AG-A1).
- **Six new packs** in `industry-packs.ts` (lazy module; `PackId` is a type, zero bytes): `agri` (the shared farm base:
  farmers, produce purchase, cycles, batches), `dairy`, `mill`, `coldstore`, `agri_inputs`, `fpo` (members and shares,
  used by FPOs and co-operatives). Every agri kind turns on `agri` plus its own pack.
- **Placement, never a new route or sidebar item:** one desk tab per pack on **`/inventory`** (the R9 pattern,
  `INVENTORY_PACK_TABS`, views in `&view=`): `farm` (pack `agri`), `dairy`, `mill`, `cold` (pack `coldstore`), `inputs`
  (pack `agri_inputs`), `members` (pack `fpo`). Every agri kind keeps the `inventory` module, so **`PACK_ROUTES` is not
  changed** (`/inventory` is a module route, not a pack route).
- Settings → Features shows an **"Agriculture profile"** row for every company (a trader may turn on `coldstore`, a
  kirana `agri_inputs`), with the same choices plus "Custom". Turning a pack off deletes nothing.
- The **agri paper** (AG-A5) is not pack-gated: it prints whenever a document carries the `ag` snapshot, so a company
  that turns a pack off still reprints its old milk bills, rent bills and fertiliser memos exactly.

### Budgets the packages must respect

Measured by the PRD author on the baseline (`vite build` + `node scripts/check-bundle-size.mjs`, gzip -9, KiB):

| Budget | Now | Limit | Headroom | Shared with |
|---|---|---|---|---|
| Initial JS (first paint, gz) | **184.7 kB** (189,130 B) | 185 kB (189,440 B) | 0.3 kB | Round 10 (≤ +0.03 kB) |
| Entry chunk (gz) | 71.1 kB | 90 kB | 18.9 kB | |
| Total JS (gz) | **2,891.6 kB** (2,960,998 B) | 3,000 kB (3,072,000 B) | 108.4 kB | Round 10 (≤ 45 kB), QA rounds |

**Units.** The brief's "≈2.96 MB of 3.0 MB" is the byte count (2,960,998 B ≈ 2.96 MB decimal). The budget script counts
KiB (`n / 1024`), so the limit is 3,072,000 B and the real headroom is **≈108 kB**, not ≈40 kB. With Round 10 using its
full 45 kB, ≈63 kB remain; Round 12 takes ≤ 35 kB and leaves ≈28 kB for QA rounds 10 and 12. **No budget raise is
proposed.**

Rules:
- **First paint: ≈ 0 (≤ +0.02 kB), by design.**
  - **One new record key, no line key.** Everything Round 12 prints from an invoice lives under one additive record key
    **`ag`** (the agri snapshot, with a per-line map `ag.lines[lineId]`), kept by `normalizeRecord` through a one-element
    `R12_RECORD_KEYS = ['ag']` added to the existing `[...R8_RECORD_KEYS, ...R9_RECORD_KEYS]` spread in
    `invoice-defaults.ts` (≈ 10–20 B gz). Weighing reuses the R8 line key `wt`; nothing else on a line changes.
  - If, after Round 10 merges, first paint is above 184.95 kB, AG-A stops and asks the lead before adding the key.
    The only zero-byte alternative is to print agri particulars from line descriptions, which loses the structured
    snapshot reprints rely on (Critical Rule 3). Default: add `ag`.
  - No `PACK_ROUTES`, `PACK_OF_TYPE`, `TABLE_ACTIONS`, `WATCHED_TABLES`, `no-cash.ts`, `tax-rules.ts` or shell edit.
    Table rights and audit labels register at runtime (`src/lib/agri/ag-registry.ts`, the `tr-registry.ts` /
    `cn-registry.ts` pattern).
  - Template additions are lazy parts (the R4-C1 `ExportBlock` / R11 `WorksHeaderBlock` pattern), mounted only when
    `ag` is present; `TemplateEngine.tsx` is in the editor / preview chunk, not first paint (`check:size` confirms).
- **Total JS for the round ≤ +35 kB gz**: AG-A ≤ 11 kB, AG-B ≤ 8 kB, AG-C ≤ 7 kB, AG-D ≤ 9 kB. This is tighter per item
  than Round 11 (≈1.75 kB per item against 2.5) because AG-B and AG-C mostly **configure** existing engines (production
  orders, BOM co-products, job work, weighing, charges, bank upload) instead of writing new ones.
- **Everything is lazy.** No new route. Each desk tab is one lazy chunk mounted by `Inventory.tsx`; its views are lazy
  sub-chunks; editor, bill-modal and payment-dialog parts are lazy sub-rows mounted only when their pack or snapshot is
  present.
- **Rule data is a chunk.** Statutory values go in `src/lib/agri-rules.ts` (new, imported only by lazy screens and
  engines, never by `tax-rules.ts`, `shop-mode.ts` or the shell). Values that already live in `trading-rules.ts`
  (RCM notified goods, 194Q buyer test, TCS presets) **stay there**; `agri-rules.ts` re-exports nothing from it.
  `tests/ag-rules.test.ts` checks the import graph.
- **Help text is data.** Topics go in the existing lazy topic files (`topics-packs.ts`, `topics-sales.ts`,
  `topics-statutory.ts`); glossary terms in `glossary.ts`.
- **Icons: reuse only** (grep before use; a new icon name fails review). Candidates already imported on the baseline:
  `Users` (farmers, members), `Scale` (weighbridge, reconciliation), `Truck` (dispatch, tankers), `ClipboardList`
  (collection sheet, registers), `Receipt`, `FileText`, `CalendarDays` (cycles, seasons), `ShieldCheck` (licences),
  `Landmark` (loans against stock), `Percent` (rate chart), `Building2` (chambers), `Snowflake` (cold storage desk),
  `Package` (bags) — all imported on the baseline (checked by grep). There is no `Milk`, `Wheat`, `Sprout` or `Droplet`
  in use, so the dairy desk uses `ClipboardList` and the mill desk `Scale`; AG-A re-greps before its first commit.
- **If the round needs more than 35 kB:** each package builds inside its share first and reports the overrun with a
  breakdown in its section of `docs/features/agri-r12.md`. The lead decides after Round 10 has measured. Fallback (not
  proposed now): raise `BUDGET_TOTAL_GZ_KB` from 3000 to **3100** in one commit with the reason recorded in
  `scripts/check-bundle-size.mjs` — total JS is the one-time offline precache, every vertical's code runs only for
  companies with its pack on, and first paint stays at its 185 kB limit.
- Each package records before / after numbers in its section of `docs/features/agri-r12.md`.

### Non-goals

These need a server, a regulator or partner system, or are outside billing and books:
- e-NAM trading, mandi-board e-permits / e-gate passes, iFMS / fertiliser PoS device integration (the dealer keeps
  using the government PoS; the app records its transaction number), WDRA e-NWR issue through NeRL / CCRL, dairy-union
  or plant portals (e.g. union payment files in a union's own format), bank loan origination, KCC portals, PM-KISAN /
  DBT lookups, FSSAI / licence applications, crop insurance portals.
- Farm management (sowing calendars, crop advisory, soil tests, IoT sensors, animal health records beyond a batch
  memo), traceability QR for consumers, FPO grant / equity-grant (SFAC, NABARD) applications.
- Milk analyser and weighbridge **firmware** or proprietary protocols: the app reads plain ASCII frames over Web Serial
  from devices that send them; anything else is typed.
- Income-tax return computation (agricultural income's partial integration, 80P / 80PA claims): the app gives
  working papers and leaves the return to the accountant.
- Co-operative audit formats of each State's Co-operative Societies Act and the producer company's statutory forms
  filed on MCA21: the app keeps the registers and the figures; filing is outside.

---

## 2. Findings

### 2.1 What agri businesses use and praise / complain about (research)

P = official text read; S = secondary (press, blog, review site); V = vendor's own claim. Full list in
`round12-sources.md`. Independent reviews of Indian agri software are thin; vendor claims are marked as such.

| Segment | Tools they use | Praised for | Complaints / gaps | Source |
|---|---|---|---|---|
| Village milk centres, dairy co-op societies | Automatic Milk Collection Systems (AMCS: analyser + scale + printer + PC, e.g. Prompt), phone apps (MilKing, DairyPro), registers + Tally | Fat / SNF and quantity captured at the can; fat-wise, SNF-wise and shift-wise rate charts; farmer slip and SMS; direct bank payment | Proprietary hardware boxes; the books are kept elsewhere (Tally / register); feed and advance deductions and union payments reconciled by hand | V promptdairytech.com, apps.apple.com (MilKing), dairyproerp (offline claim) |
| Dairy processors / unions | ERPNext / SAP builds | Payout cycles with feed and advance deductions, routes | "Stock modules cannot handle the fat / SNF grid on their own" — needs a custom build ($499+ starting) | V ecosire.com (ERPNext dairy) |
| Rice / flour / dal mills | Desktop mill ERPs (MTECH MillPro type), Busy / Tally, Excel for CMR | Milling and production with accounts | CMR outturn, by-product value and milling charges tracked in Excel; the CAG found outturn norms (67 / 68 kg per qtl) and charges unrevised since 2005 | V m-techsoft.com; P CAG Report 31 of 2015 |
| Cold storages | Registers, ERPNext rental build, small apps (Cold Storage Kit) | Depositor-owned lots, gate passes with weighment, rent per bag | Rent is by bag or by quintal by State and season; loans to farmers against stored potatoes kept in a separate book | V ecosire.com (cold storage), mwm.ai; S indianpotato.com |
| Seed / fertiliser / pesticide dealers | myBillBook, Busy (agriculture edition), agrē, the government PoS for subsidised fertiliser | Batch and expiry, bag / quintal units, farmer credit and limits, Tally export | Two systems for one sale (the PoS and the bill); physical stock vs PoS (iFMS) stock mismatches; licences in a file | V busy.in, mybillbook.in, capterra (agrē); S krishijagran.com; S tribuneindia (Lok Sabha reply Aug 2026) |
| FPOs / co-operatives | iFPO (Digital Green), Tally, NABARD's PACS ERP for credit societies | Member register with ID cards and share certificates; simpler than Tally; offline; GST / e-way reports | Poor bookkeeping limits finance access; local language; ~₹6,000 a year per FPO | S digitalgreen wiki (2020), sourcetrace.com; P Rajya Sabha PQ 265 (2024) |
| Tally users | TallyShop add-ons | Partner-built vertical add-ons | No dairy, mill or cold-storage add-on found in Tally's own pages | S help.tallysolutions.com |

**What carries over to an offline app:**
- **The collection sheet and the farmer bill** — rate chart lookup, shift sheet, 10-day bill with deductions, a bank
  upload file and a WhatsApp slip — on top of real books (a purchase voucher per cycle that GSTR-3B Table 5 already
  reads), which the AMCS boxes do not have.
- **Yield as a number**: outturn %, by-products, moisture loss, and the CMR account with the agency, all from the
  existing production-order and BOM engine.
- **Custody, not stock** for cold storages: lots in, gate passes out, rent by bag-season, loans with a lien.
- **One bill for the dealer** that carries the PoS transaction no., the licence line, batch and expiry.
- **Members** for FPOs and co-ops: shares, certificates, patronage and the 80P / 80PA working papers.

Offline work, Hindi, the recycle bin, full audit and real books (GSTR-1 / 3B, Tally export, TDS returns) are our edge.

### 2.2 Anatomy of the agri documents (every element needs a place)

"Doc" = where it must print. "Today" = the baseline. Items close each row.

| # | Element | Who | Doc | Today | → |
|---|---|---|---|---|---|
| 1 | Farmer code, name, village, centre / route, member no. | dairy, FPO, mill | slip, bill, voucher | vendor name only | A2, A5 |
| 2 | Shift (M / E), date, qty (L or kg), fat %, SNF %, CLR, rate, amount per entry | dairy | collection slip, milk bill | — | B2, B3 |
| 3 | Rate chart reference (chart name, effective date), kg fat / kg SNF | dairy | milk bill | — | B1, B3 |
| 4 | Cycle period (1–10, 11–20, 21–end), gross, deductions (feed, advance, share, insurance, other), net | dairy, FPO | milk bill / payment advice | — | A4, B3 |
| 5 | Bank / UPI of the farmer, payment reference | dairy, FPO, mill | payment advice | vendor bank fields (bank upload) | A4 |
| 6 | Gross / tare / net weight, bags, vehicle no., weighbridge slip no. | mill, FPO, cold | gate entry, voucher | `wt` on sale lines (R8); no weighbridge slip | C1, A3 |
| 7 | Moisture %, foreign matter %, damaged / discoloured %, cut per point, accepted weight | mill, FPO | purchase voucher | — | A3, C1 |
| 8 | Market fee / RDF / commission / hamali (State) | mill, FPO | voucher, sale bill | charge heads (R8 TR-B2) | A3 (reuse) |
| 9 | "Purchased from an agriculturist — exempt / no RCM" or RCM notice for notified goods | all buyers | voucher | RCM prompt (TR17) | A3 |
| 10 | Exempt sale declaration: bill of supply, "agricultural produce", "not pre-packaged and labelled" | FPO, mill, dairy | bill | bill of supply exists; no agri text | A3, A5 |
| 11 | Outturn % and by-products (rice / broken / bran / husk; atta / maida / suji / bran; dal / chunni / husk; oil / cake) | mills | batch report, CMR statement | BOM by- / co-products | C2 |
| 12 | CMR: agency, season, paddy lots received, rice due at outturn %, rice delivered (lot / ACK no.), by-product value, milling charges | rice mills | CMR statement, job-milling invoice | job-work principal register | C3 |
| 13 | Lot / receipt no., depositor, commodity, variety, bags, weight, chamber / floor / rack, date in, expected season end | cold | storage receipt | — | D1, A5 |
| 14 | Gate pass out: bags released, balance bags, loan cleared / lien | cold | gate pass | — | D1, D3 |
| 15 | Rent per bag per season / per month, handling (loading, unloading, sorting), insurance; exempt (agri produce) vs taxable | cold | rent bill | — | D2, A5 |
| 16 | Loan against lot: principal, rate, interest to date, lien | cold, FPO | loan statement, gate pass | — | D3 |
| 17 | Dealer licence nos. (fertiliser / seed / insecticide), GSTIN, FSSAI (feed) | inputs | every bill | — | D4, A5 |
| 18 | Batch, manufacturing / expiry date, manufacturer, MRP per bag | inputs | bill | batch / expiry / MRP exist | reuse |
| 19 | Subsidised fertiliser: PoS transaction no., farmer ID (last 4 of Aadhaar / KCC), bags | inputs | bill | — | D4 |
| 20 | Member shares (no., face value, certificate no.), patronage, bonus / price difference | FPO, co-op | member statement, certificate | — | D5 |
| 21 | Fat-kg / SNF-kg dispatched, received at plant, shortage / gain, tanker no. | dairy | dispatch note, reconciliation | — | B4 |

### 2.3 Statutory rules (as understood; every row is a CA item)

Confidence: **H** = statute / official text read or long settled; **M** = consistent secondary sources or recalled
text; **L** = sources conflict or nothing found. **Verified** = the claim was read in a primary source this round or
in two independent secondary sources that agree; otherwise **verify with CA**.

| Rule | What applies | App today | Source | Confidence / status |
|---|---|---|---|---|
| Fresh milk | Fresh and pasteurised milk (0401, excluding UHT before 22 Sep 2025) nil under N 2/2017-CT(R); curd, lassi, buttermilk loose nil, pre-packaged and labelled 5% since 18 Jul 2022 | User-typed rates | S razorpay, referencer; P N 2/2017 (recalled) | H / **verified** (milk); M / verify (curd group) → AG3 |
| Dairy after 22 Sep 2025 | UHT milk 5% → nil; paneer / chena (pre-packaged) 5% → nil; ghee, butter, butter oil, cheese, condensed milk → 5% (old rate 12% in PTI / Taxscan, 18% in Tally's table) | — | S taxscan, theweek (PTI), tallysolutions, Min. of Cooperation (dtnext) | New rates M–H / **verified** (two sources agree); old rates L → AG4 |
| Unbranded cereals, pulses, flour, paddy | Loose / not pre-packaged: nil; "pre-packaged and labelled" up to 25 kg / 25 L: 5% (N 6/2022-CT(R) from 18 Jul 2022; > 25 kg in one package is outside); paddy (1006 10) nil | User-typed rates | S outlookbusiness (FinMin FAQ) | M / verify (no 2025 change found) → AG5 |
| By-products | Rice husk (1213) nil; rice bran (2302) nil as cattle / poultry / aquatic feed, 5% otherwise; de-oiled rice bran (2306) 5% irrespective of use; broken rice (1006 40) 5% in one AAR (pre-2022 "branded" regime); oil cake as cattle feed nil (S.No.102 of N 2/2017 as amended 1 Jan 2023), otherwise 5% | — | P GST Council FAQ (2024 reissue); P AAR (Tamal Kundu); S AAR cattle-feed note | M / **verified** (husk, bran, DORB); L (broken rice, oil cake) → AG6 |
| Agricultural produce, farm services | N 12/2017-CT(R) entry 54: services relating to cultivation, supply of farm labour, processes by a cultivator that do not alter essential characteristics, renting of agri machinery, loading / unloading / packing / **storage or warehousing of agricultural produce**, agricultural extension, APMC services, commission agent for sale / purchase of agricultural produce — nil; "agricultural produce" defined in the Explanation to N 11/2017 | Aadat exempt for agricultural produce (TR9) | P N 12/2017 (recalled); S taxguru, busy.in caselaw | H (entry) / M (scope) → AG7 |
| Cold-storage rent | Storage / warehousing of agricultural produce: nil (54(e)), held service-specific, for farmers and traders alike (AP AAR, SSSVK); **renting a godown / chamber** treated as a separate taxable supply (Gujarat AAR, 9972) vs nil (AP AAR, SAC 998619); potatoes in cold storage stay "agricultural produce" (no processing); taxable for non-agri goods (frozen food, medicines, dry fruit processed) at 18% | — | S taxguru, busy.in caselaw; P AAR texts on gstcouncil.gov.in | M (exemption) / **L (rent vs storage)** → AG8 ★ |
| Milling for PDS | Circular 153/09/2021-GST (17 Jun 2021): milling of paddy into rice / wheat into flour for the State for PDS is a composite supply of service; exempt (entry 3A, N 12/2017) if goods ≤ 25% of the value; else 5% as job work to a registered person (entry 26, N 11/2017), including a person registered only for Sec 51 TDS | — (job-work principal register exists) | P Circular 153 (HP, Goa copies) | H / **verified** → AG9 ★ |
| Job milling for others | Milling a registered principal's grain on job work: 5% (entry 26 "food and food products"); for an unregistered farmer: 18%? or exempt as a process by a cultivator? (atta chakki for a household) | — | Recalled; no ruling read | L → AG10 |
| RCM | No RCM on milk, cereals, paddy, potatoes or vegetables bought from farmers (exempt goods; not in N 4/2017). Notified goods from an agriculturist (raw cotton, cashew in shell, tobacco leaves, silk yarn, mint oils) stay on the R8 prompt (TR17). Inward RCM that does hit these businesses: GTA freight (I10), legal fees, security, renting of commercial property from an unregistered person (I28) | RCM prompt (TR17), GTA (I10), rent (I28) | P N 4/2017 (TR17) | H → AG11 |
| e-Way bill | Not required for goods in the Annexure to Rule 138(14) and for exempt goods under N 2/2017 (fresh milk, cereals not pre-packaged …) — as recalled; required for 5% pre-packaged rice / atta and for taxable by-products above ₹50,000 | e-way JSON exists, threshold check | Rule 138(14) (recalled) | M → AG12 |
| 194Q / 206C(1H) | 206C(1H) does not apply from 1 Apr 2025 (proviso, Finance Act 2025); 194Q governs: buyer with turnover > ₹10 crore in the preceding FY deducts 0.1% on purchases from a resident seller above ₹50 lakh in the FY; 2025 Act Sec 393 (as reported). A mill buying paddy from a farmer above ₹50 lakh in a year deducts too (agri produce is "goods") | Exists (`tds-rules.ts`, `trading-rules.ts` `BUYER_194Q_TURNOVER_RULES`) | P incometaxindia.gov.in; S ICAI Navi Mumbai | H / **verified** → AG13 |
| Cash to farmers | Sec 40A(3): cash above ₹10,000 per person per day disallowed, but **Rule 6DD(e)**: payment to the cultivator, grower or producer of agricultural / forest produce, animal-husbandry, dairy or poultry products, fish, horticulture or apiculture products is outside it; read narrowly (Mad HC 2025, Arasappan Madhivanan: "producer" = the farmer, not a dairy company). 2025 Act equivalent: verify. Sec 269ST (₹2 lakh receipt) is separate | Cash guards (`rt-cash-guard.ts`, `cn-muster.ts`) warn on every cash payment above ₹10,000 | P incometaxindia.gov.in Rule 6DD; S taxmann (Mad HC) | H / **verified** (rule, 1961 Act); verify (2025 Act) → AG14 ★ |
| Agricultural income | Sec 10(1) (1961) → Sec 11 + Schedule II Table S.No. 1 (2025 Act, from 1 Apr 2026, per mapping tables). Income of a mill, dairy, FPO or cold storage is **business** income, not agricultural income; poultry and fishery are not "agriculture" for 10(1) (settled case law, recalled). Own-cultivation income of a farm owner is exempt | — | S taxheal / cleartax mapping; S businesstoday (Bill) | M / verify (2025 Act text not read) → AG15 |
| Co-operative deduction | 80P (1961) → **Sec 149** of the 2025 Act (marketing members' agricultural produce, supplying inputs to members, credit to members, milk supplied to a federal milk co-op, etc.) | — | S taxguru (ITA 2025 co-op note); P incometaxindia 80P page | M / verify (section number) → AG16 ★ |
| Producer company deduction | 80PA: 100% of profits from eligible business (marketing members' produce, processing, inputs, etc.) of a producer company with turnover < ₹100 crore, **only for AY 2019-20 to AY 2024-25**; no extension found; the Bill's clause 150 was renumbered and the final 2025 Act's home (if any) not found | — | S taxguru, studycafe, taxheal; S taxtmi notes | M (window) / **L (after AY 2024-25)** → AG17 ★ |
| Producer companies | Companies Act 2013 **Chapter XXIA (Sec 378A–378ZU)**, inserted by the Companies (Amendment) Act 2020, in force from 11 Feb 2021 with the Producer Companies Rules 2021; private-company provisions apply where not inconsistent (378ZR); members are primary producers; limited return on share capital, patronage bonus and withheld price are decided in general meeting (as recalled) | — | S taxmann, amsshardul (MCA notification), ICAI Navi Mumbai (378ZQ, 378ZR) | H (chapter, date) / **verified**; M (member benefit sections) → AG18 |
| Co-operative societies | State Co-operative Societies Acts (or the MSCS Act 2002 for multi-state): share capital, dividend cap, statutory reserve and audit by the Registrar's auditor — state-specific | — | Recalled | L → AG19 |
| Mandi fee | State APMC Acts: market fee + rural development / market development fee on the buyer, on notified produce bought in the market area. Examples: Punjab 3% + 3% of MSP (reported, Centre pressing for 2%); Haryana 2% + 2% on paddy (older reports). Conflicting figures | Charge heads, no preset rate (TR6) | S tribuneindia, theweek | L → AG20 ★ |
| Dealer licences | Fertiliser (Control) Order 1985 (dealer registration certificate, principal certificate / "O-form" per manufacturer, stock-cum-price board, cash memo); Seeds Act 1966 / Seeds (Control) Order 1983 (dealer licence, stock register); Insecticides Act 1968 / Rules 1971 (sale licence, principal certificate, no sale after expiry). State-issued (e-licensing portals) | Licence pattern exists for drugs (R9 RT-B2) | P Odisha e-licensing manual; services.india.gov.in; the orders recalled | M (existence) / L (forms) → AG21 |
| Subsidised fertiliser | Subsidy reaches the company only after an Aadhaar-authenticated sale on the retailer's PoS (iFMS); claims weekly; purchase caps per farmer (50 bags / month reported); sale at or below MRP | — | S tribuneindia (Lok Sabha reply, Aug 2026); S krishijagran | M → AG22 |
| Warehouse receipts | Warehousing (Development and Regulation) Act 2007; registered warehouses issue only **electronic** NWRs through NeRL / CCRL (Registration Rules 2017 r.27); registration voluntary; a non-registered cold store's receipt is a plain non-negotiable receipt | — | S vikaspedia; P Canara Bank e-NWR loan page | M → AG23 |
| Loans by a cold storage | Interest on a loan is exempt from GST (N 12/2017 entry 27, recalled); a cold-store owner lending regularly may need State money-lenders' Act registration; TDS 194A does not apply to the lender | — | Recalled | M (GST) / L (licensing) → AG24 |
| Pre-packaged commodities | Legal Metrology (Packaged Commodities) Rules 2011: declarations on packs up to 25 kg (and the GST 5% test borrows the same 25 kg line) | — | S FinMin FAQ (2022) | M → AG5 |
| FSSAI | FSSAI licence / registration no. to be printed on food business invoices / cash memos (order of 2021, recalled) | Free text on the profile | Recalled | M → (not a CA item; FSSAI consultant) |
| Payment to members by a co-op / FPO | "Price difference" or bonus on milk / produce supplied, paid after the year: part of purchase price (no GST: exempt goods) vs a distribution of profit (dividend / patronage) — accounting and tax treatment differ | — | Recalled | L → AG25 ★ |

### 2.3a The 22 Sep 2025 rate rationalisation and these goods

Notification numbers were not read this round; every row is "as reported" and is stored in `agri-rules.ts`
`AGRI_CLASS_RULES` with `verified: false` until a CA answers AG4.

| Goods (HSN) | Before | From 22 Sep 2025 | Sources | Status |
|---|---|---|---|---|
| UHT milk (0401) | 5% | nil | taxscan, Tally, Min. of Cooperation | agree → verify N no. |
| Paneer / chena, pre-packaged (0406) | 5% | nil | taxscan, Tally | agree |
| Ghee, butter, butter oil (0405) | 12% (PTI, taxscan) / 18% (Tally) | 5% | three sources | new rate agrees; old rate conflicts (AG4) |
| Cheese (0406) | 12% | 5% | all | agree |
| Condensed milk (0402 99) | 12% (PTI) / 18% (Tally) | 5% | PTI, Tally | old rate conflicts |
| Skimmed milk powder, curd / lassi / buttermilk pre-packaged | 5% | not found in the summaries | — | **L** (AG3) |
| Tractors (8701, except road tractors for semi-trailers > 1800 cc) | 12% | 5% | PTI, taxscan, Tally | agree |
| Tractor tyres, tubes, specified parts | 18% | 5% | taxscan | one source |
| Harvesters, threshers, composting machines, sprinklers / drip, hand pumps, diesel engines ≤ 15 HP | 12% | 5% | taxscan, PTI | agree |
| Sulphuric acid, nitric acid, ammonia (fertiliser inputs) | 18% | 5% | taxscan, Tally | agree |
| Bio-pesticides (listed strains), micronutrients (FCO Sch. 1 Part A), gibberellic acid | 12% | 5% | taxscan, PTI | agree |
| Fertilisers (31) | 5% | 5% (no change reported) | recalled | M |
| Chemical pesticides (3808) | 18% | 18% (no change reported) | recalled | M |
| Seeds for sowing, cattle / poultry / aquatic feed, fresh fruit and vegetables, paddy, loose cereals | nil | nil | recalled; FAQ | M |
| Pre-packaged and labelled cereals, flour, pulses (≤ 25 kg) | 5% | 5% (no change found) | FinMin FAQ (2022) | M |

The app ships these as **class suggestions by date** (a typed rate always wins, a "rate differs from the class" soft
notice shows); old documents keep their rates (snapshots).

### 2.4 Verified against the code (`a4a3f57`)

Verdicts: **Exists** (done, file given), **Partial** (part done, gap named), **Missing**. Each row was checked by grep
(`milk`, `fat`, `snf`, `paddy`, `cold stor`, `warehouse receipt`, `subsid`, `member`, `share capital`: zero hits in
`src/lib` outside unrelated uses) or by reading the file; "→" names the Round 12 item that closes it.

#### Shared pieces (every agri kind)

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Sub-profile pattern, runtime registry | Exists | `applyTradeKind`, `applyRetailKind`, `applyConstructionKind` (`shop-presets.ts`); `tr-registry.ts`, `rt-registry.ts`, `cn-registry.ts` | Reused by A1 |
| Business type for agri | Missing | `BusinessType` has no agri type; `manufacturer` has no sub-profile (checklist steps fire only for `wholesale`, `kirana`, `contractor`) | A1 (`agri_kind` under `manufacturer` / `kirana`) |
| Pack desks on `/inventory` | Exists | `INVENTORY_PACK_TABS` (R9), `visibleTabs` | Six rows → A1 |
| Farmer master | Partial | vendors / clients; `principal_kind: 'agriculturist'` on vendors (R8) | Village, centre, member no., bank, Aadhaar-last-4 → A2 |
| Purchase from an unregistered person in our series | Partial | `URD/FY…` purchase vouchers (R9 `rt-urd.ts`) for old goods | Farmer purchase voucher `FPV` → A3 |
| Weight, bags, tare, dhalta on lines | Exists | `tr-weight.ts`, line key `wt` | Reused on purchase lines and the weighbridge slip → A3, C1 |
| Mandi fee, hamali, commission heads | Exists | `tr-charges.ts` (no preset rate, TR6) | Reused; state examples in help only → A3 |
| RCM prompt for notified goods from an agriculturist | Exists | `trading-rules.ts` `RCM_NOTIFIED_GOODS_RULES`, `RcmGoodsNotice.tsx` | — |
| Bill of supply for exempt sales | Exists | `bill-of-supply.ts` | Agri declarations → A3, A5 |
| Agri tax classes by date | Missing | user-typed HSN master | `AGRI_CLASS_RULES` → A3 |
| Bulk bank upload file | Exists | `bank-upload.ts` (generic NEFT CSV + bank presets) | Farmer cycle as a source → A4 |
| Pooled farmer bills (one voucher per cycle) | Missing | — | A4 |
| Cash guard aware of Rule 6DD(e) | Missing | `rt-cash-guard.ts`, `cn-muster.ts` warn on all cash > ₹10,000 | A4 (one lazy check) |
| 194Q buyer test | Exists | `trading-rules.ts`, `tds-payables.ts` | Hint on farmer vouchers → A3 |
| Exempt inward in GSTR-3B Table 5 | Exists | `gst-reports.ts` (`inwardExempt` from purchases) | Pooled vouchers are purchases rows, so they flow → A4 |
| Agri paper on documents | Missing | `TemplateEngine.tsx` prints no agri field | A5 |
| Poultry / fishery batches | Partial | cost centres (`cost-centres.ts`), production orders | FCR / mortality memo → A1 |

#### Dairy

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Fat / SNF rate chart | Missing | — | B1 |
| Shift collection sheet | Missing | — | B2 |
| Milk analyser / can scale input | Partial | `scale-serial.ts` (Web Serial scale, POS), `scale-barcode.ts` frame parser | Analyser frames (fat, SNF, CLR, water %) → B2 |
| Farmer milk bill per cycle | Missing | — | B3 (on A4) |
| Dispatch to union / plant, fat-kg reconciliation | Missing | — | B4 |
| Products (paneer, ghee, curd) | Exists | BOMs, manufacturing journals, production orders | Dairy BOM starters, class rates → B5 |
| Household milk cards | Partial | recurring schedules (date-based) | Daily-quantity card → B5 |

#### Mills

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Gate entry / weighbridge slip | Missing | weighing on lines only | C1 |
| Moisture / quality cut | Missing | `wt.deduction` is weight-only (dhalta) | A3, C1 |
| BOM with by-products / co-products | Exists | `manufacturing.ts` (`by_product`, `co_product`, `scrap`, `cost_pct`) | Mill BOM starters → C2 |
| Production orders with WIP | Exists | `production/orders.ts` | Outturn vs standard, moisture loss → C2 |
| Job work in (principal's material) | Exists | `job-work.ts` `job_work_principal` (`JWP/FY…`), `jobChargesLine` | CMR account (due at outturn %, deliveries, by-product recovery) → C3 |
| Pre-packaged ≤ 25 kg rule | Missing | — | C4 |
| Bank stock statement | Exists | `tr-stock-statement.ts` | Mill view (paddy, rice, by-products, consignment paddy excluded) → C5 |

#### Cold storage, input dealers, FPO / co-operative

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Custody register (others' goods) | Partial | `consignment` godowns (R8 arrivals), job-work principal register | Lots by depositor, chamber, bags → D1 |
| Rent by bag-season | Missing | recurring / rate cards are time-based | D2 |
| Loans given against goods | Missing | `loans.ts` is borrowing (business loans) only | D3 |
| Licences with expiry alerts | Partial | `DrugLicence` + `licenceNotices` (R9 RT-B2, pharmacy only) | Agri licences → D4 |
| Batch / expiry / MRP guard | Exists | batches, expiry tab, R9 MRP guard | Reused → D4 |
| Subsidised fertiliser PoS reference, PoS stock check | Missing | — | D4 |
| Farmer credit with interest | Partial | khata (8A), interest notes (`tr-interest.ts`) | Season due date ("till harvest") → D4 |
| Members, shares, certificates | Missing | share capital is a ledger only (`notes-auto.ts`) | D5 |
| Patronage / bonus, 80P / 80PA papers | Missing | — | D5 |

**Totals:** 41 rows checked (shared 16, dairy 7, mills 7, cold / inputs / members 9 — plus 2 n/a merged): **10 exist**,
**12 partial**, **19 missing**. Round 12 closes every partial / missing row; §2.2's 21 document rows map onto them.

---

## 3. Ranked list: what to build now

Value 1–5 (5 = every business of that kind meets it every day). Effort S = 1, M = 2, L = 3. Score = value ÷ effort.

| Rank | Id | Gap | Who needs it | Value | Effort | Score | Package |
|---|---|---|---|---|---|---|---|
| 1 | AG-A1 | Agri profile (picker, packs, switches, checklist, help, Ctrl+K, sample data, batches memo) | every agri business | 5 | S | 5.0 | A |
| 2 | AG-B2 | Shift collection sheet with analyser / scale | dairy | 5 | M | 2.5 | B |
| 3 | AG-B1 | Fat / SNF rate charts | dairy | 5 | S | 5.0 | B |
| 4 | AG-A4 | Farmer payment cycles: pooled bill, deductions, bank file, slips, Rule 6DD(e) | dairy, FPO, mill | 5 | M | 2.5 | A |
| 5 | AG-B3 | Milk bill per cycle (on A4) | dairy | 5 | S | 5.0 | B |
| 6 | AG-A3 | Farmer purchase voucher, quality cuts, agri tax classes, declarations | every buyer of produce | 5 | M | 2.5 | A |
| 7 | AG-A2 | Farmers and members master | every agri kind | 4 | S | 4.0 | A |
| 8 | AG-A5 | Agri documents on paper (slip, voucher, rent bill, dealer bill, CMR statement) | every agri kind | 5 | M | 2.5 | A |
| 9 | AG-D1 | Cold-storage lots, receipts and gate passes | cold storage | 5 | M | 2.5 | D |
| 10 | AG-D2 | Storage rent by bag-season, handling, exempt / taxable | cold storage | 5 | S | 5.0 | D |
| 11 | AG-C2 | Milling batches: outturn, by-products, moisture loss | mills | 5 | S | 5.0 | C |
| 12 | AG-C1 | Grain intake: gate entry, weighbridge, moisture cut | mills, FPO | 4 | S | 4.0 | C |
| 13 | AG-D4 | Input dealer desk: licences, principal certificates, subsidised fertiliser, credit till harvest | input dealers | 5 | M | 2.5 | D |
| 14 | AG-C3 | Custom milling (CMR) account and job milling | rice mills | 4 | M | 2.0 | C |
| 15 | AG-B4 | Dispatch to union / plant and fat-SNF reconciliation | dairy | 4 | M | 2.0 | B |
| 16 | AG-D5 | Members' shares, certificates, patronage, 80P / 80PA papers | FPO, co-op | 4 | M | 2.0 | D |
| 17 | AG-D3 | Loans against stored produce with a lien | cold storage, FPO | 4 | M | 2.0 | D |
| 18 | AG-C4 | Packing / labelling rule (≤ 25 kg) and mill sales | mills | 4 | S | 4.0 | C |
| 19 | AG-B5 | Dairy products and household milk cards | dairy | 3 | M | 1.5 | B |
| 20 | AG-C5 | Yield and stock reports, bank stock statement for mills | mills | 3 | S | 3.0 | C |
| — | — | e-NAM, iFMS PoS, WDRA e-NWR issue, union portals | — | 3 | L | 1.0 | no (network / regulator) |
| — | — | Farm management (crop calendar, soil, animal health) | farms | 3 | L | 1.0 | no (outside billing) |
| — | — | Proprietary AMCS / weighbridge protocols | dairy, mills | 2 | L | 0.7 | no (ASCII Web Serial only) |

All 20 are taken: the lowest-scoring ones are cheap configurations of engines that exist (production orders, recurring,
bank stock statement).

---

## 4. Specifications (20 items)

Conventions for every item:
- **Logic and tests.** Pure logic in `src/lib/agri/ag-*.ts` (new folder), tested with `node:test` in `tests/ag-*.test.ts`.
  UI checks are `step(...)` blocks in `tests/e2e/smoke.mjs` (§7). Existing files are edited only where §6 says.
- **Components** in the new folder `src/components/agri/`. Each desk is one lazy component mounted by `Inventory.tsx`
  (`FarmDesk`, `DairyDesk`, `MillDesk`, `ColdDesk`, `InputsDesk`, `MembersDesk`); its views are lazy sub-components.
  Template parts live in `src/components/templates/parts/` (`AgriBlock.tsx`, `AgriStatementPage.tsx`), each lazy.
- **Strings.** Each package has its own i18n area (`defineArea(en, hi)`): `src/i18n/areas/agri-r12a.ts` … `r12d.ts`.
  Hindi uses the trade's words (किसान, सदस्य, दूध संग्रह, पाली / सुबह-शाम, फैट, एसएनएफ, दर तालिका, दूध बिल, पखवाड़ा /
  दस दिनी भुगतान, पशु आहार, कटौती, धान, चावल, टूटा, भूसी, कना / चोकर, आउटटर्न, कस्टम मिलिंग, मंडी शुल्क, नमी, कांटा पर्ची,
  शीतगृह, लॉट, बोरी, किराया, गेट पास, गिरवी ऋण, खाद, बीज, कीटनाशक, लाइसेंस, सब्सिडी, अंश / शेयर, लाभांश, संरक्षण बोनस).
- **Storage.** New company tables `mrchartist_inv_<table>` go through `getTable` / `setTable`. Each is registered in:
  - `backup.ts` (`RECORD_TABLES` / `ID_TABLES`);
  - the open-export schema (`trust/open-export-schema.ts`);
  - `sync-engine.ts` `DATED` / `NUMBERED`, when dated or numbered;
  - **`src/lib/agri/ag-registry.ts`** (`AG_TABLE_ACTIONS`, `AG_WATCHED`), registered at runtime, never in first-paint
    `access.ts` / `audit-edits.ts`. Every writer module and the two all-table lazy writers (`sync-engine.ts`,
    `trust/recycle-bin.ts`) import it for its side effect (`tests/ag-registry.test.ts`).

  Each table gets one row in `docs/ARCHITECTURE.md` (lead). Additive record fields come by declaration merging in
  `src/types/agri-r12.ts`: one file, one `declare module` block per package. Table and series names live in
  `src/lib/agri/ag-shared.ts` (the `tr-shared.ts` / `rt-shared.ts` pattern).
- **Volume.** Collection data is large (a 200-farmer centre makes ≈146,000 entries a year). **No table holds one row per
  farmer per shift**: `milk_shifts` holds one row per centre per shift with an `entries` array, and farmer bills are
  pooled per cycle (A4). A test builds a year of a 300-farmer centre and checks that loading the dairy desk reads at
  most 2 rows per day.
- **Invoice snapshots.** Everything Round 12 stores on an invoice lives under the record key **`ag`** (one object; each
  package owns its sub-fields, §6) and the existing line key `wt`. Templates read them from the record only.
  Purchases rows (farmer vouchers, pooled cycle bills) carry their agri fields as `PurchaseRecord.ag` (declaration
  merging; purchases are normalised outside first paint, `readPurchase` passes unknown keys through — A checks and
  adds `ag` to the purchase keep-list if it does not).
- **Numbers.** New series go through `series-counters.ts` (`nextSeriesNumberFor` + `recordSeries`) as
  `XXX/FY<yy-yy>/<seq>`, never reused after a delete: `FPV` (farmer purchase vouchers), `CYB` (pooled cycle bills),
  `WBS` (weighbridge slips), `MDS` (milk dispatches), `CMR` (custom-milled rice deliveries), `CSR` (cold-storage
  receipts), `GPO` (gate passes out), `LAS` (loans against stock), `SHC` (share certificates). None of these prefixes
  is in use today (checked by grep of `XXX/FY` patterns; A adds a test).
- **Guards.** Destructive calls use `requireAccess`. Writes in a locked period use `assertUnlocked`. Money goes through
  `round2`, quantities (litres, kg, bags) through a 3-decimal round, fat / SNF % through 2 decimals. Every delete goes
  through `setTable` on a watched table, so the recycle bin gets the row.
- **Packs.** A desk tab is listed only when its pack is on (its URL still opens it). Tables are not read while their
  pack is off (`tests/ag-pack-gate.test.ts`, like `tests/transport-works-pack-gate.test.ts`).
- **Help.** Every new tab / view gets a topic (`tests/help-registry.test.ts` fails otherwise) and a Ctrl+K title in
  `src/i18n/areas/discover-r6-tabs.ts`. Statutory topics cite the AG ids. The CA-id regexes in
  `tests/help-registry.test.ts`, `tests/help-glossary.test.ts` and `tests/docs-links.test.ts` (the `cited` regex) gain
  `AG` (owner A).
- **Cash readers.** **No new receipt marker.** A farmer's feed / input invoice settled out of his milk or produce
  money reuses the R9 marker **`exchange_purchase_id`** ("settled against a purchase voucher of the same party": the
  receipt clears debtor against creditor) pointing at the pooled cycle bill (A4); the cycle's posting moves the set-off
  total from the pooled payable to "Sundry creditors — exchange" so both sides clear. Loans, rent and interest move
  real money (ordinary receipts and payments). `tests/no-cash-readers.test.ts` is unchanged; `movedNoCash` is not
  edited.
- **Purchases contract.** Every new module that reads `purchases` (A3, A4, B3, B4, C1, C2, C5, D4) is added to
  `tests/purchase-contract.test.ts` and reads bills through `readPurchase`.
- **Personal data.** Farmer bank details, Aadhaar last four digits and KCC numbers are personal data (DPDP Act 2023): they
  stay on the device and in the user's own backups like every other table; **the full Aadhaar number is never stored**
  (the field accepts four digits only).

### AG-A — Agri profile and shared farm pieces

#### AG-A1 Agri profile (agri picker) and farm batches

**User story.** When I set up the app I pick "Farm, dairy & food processing", then *Dairy / milk collection centre*.
The app turns on the farm and dairy desks, lands me on Inventory → Dairy → Collection, sets 10-day farmer cycles, and
the checklist asks for my rate chart and my first farmers.

**Acceptance criteria.**
1. `PackId` gains `agri`, `dairy`, `mill`, `coldstore`, `agri_inputs`, `fpo` (appended to `PACK_IDS`). `PACK_OF_TYPE`,
   `PACK_OF_TYPE_INLINE` and `PACK_ROUTES` are unchanged.
2. Settings fields `agri_kind?: 'fpo' | 'coop' | 'dairy' | 'mill' | 'cold' | 'inputs' | 'farm' | 'other'`,
   `mill_kind?: 'rice' | 'flour' | 'dal' | 'oil'` (additive) and object `agri_settings` (`settings.manage`, audited,
   synced as a singleton). `applyAgriKind(kind, { registered, mill_kind })` (`shop-presets.ts`, R9 / R11 pattern) returns
   business type, modules, packs, defaults and switches (`registered` adds `gst`):

   | kind | business_type | modules | industry_packs | landing | due days | template | switches turned on |
   |---|---|---|---|---|---|---|---|
   | fpo | `manufacturer` | `PRESETS.manufacturer` + `pos` | `agri`, `fpo`, `commodity` | `/inventory?tab=members` | 15 | `gst_tax_invoice` | farmer vouchers; quality cuts; cycles (weekly); members & shares; patronage; input sales to members; weighing lines |
   | coop | `manufacturer` | `PRESETS.manufacturer` + `pos` | `agri`, `fpo` | `/inventory?tab=members` | 15 | `gst_tax_invoice` | members & shares; dividend cap from settings; cycles; input sales |
   | dairy | `manufacturer` | `purchases`, `inventory`, `accounts`, `banking`, `reports`, `pos`, `recurring` | `agri`, `dairy` | `/inventory?tab=dairy&view=collection` | 0 | `retail_receipt` | 10-day cycles; feed set-off; analyser; dispatch; Rule 6DD(e) cash |
   | mill | `manufacturer` | `PRESETS.manufacturer` | `agri`, `mill`, `commodity` | `/inventory?tab=mill&view=intake` | 15 | `gst_tax_invoice` | weighbridge; moisture cut; outturn standards by `mill_kind`; CMR (rice); packing rule |
   | cold | `manufacturer` | `purchases`, `inventory`, `accounts`, `banking`, `reports`, `gst`, `tds` | `agri`, `coldstore` | `/inventory?tab=cold&view=lots` | 0 | `gst_tax_invoice` | lots and gate passes; season rent; loans against lots; exempt agri storage |
   | inputs | `kirana` (+ `retail_kind: 'general'`) | `PRESETS.kirana` + `accounts`, `banking` | `agri`, `agri_inputs` | `/pos` | 0 | `gst_tax_invoice` | licences; principal certificates; subsidy PoS ref; expiry block; MRP guard `block`; credit till harvest |
   | farm | `manufacturer` | `purchases`, `inventory`, `accounts`, `banking`, `reports` | `agri` | `/inventory?tab=farm&view=batches` | 7 | `classic_orange` | batches (flock / pond / herd); agricultural income ledger |
   | other | — (type unchanged) | unchanged | `agri` | `/inventory?tab=farm` | — | — | farmers and vouchers only |

3. Wizard: one more card "Farm, dairy & food processing" (lazy, inside the wizard chunk) opens a second choice with the
   seven kinds; *Mill* asks rice / flour / dal / oil; every kind asks "Are you registered under GST?". Settings →
   Features shows "Agriculture profile" for every company with the same choices plus "Custom" (switches kept as set).
   Changing the profile never deletes data; switches turned off only hide views.
4. Existing companies are unchanged (no `agri_kind`, no step). Companies that pick a kind get checklist steps
   (`checklist-steps.ts`, append-only): every kind → `farmers` (first farmer / member / depositor); dairy → `rateChart`,
   `firstShift`; mill → `millBom` (outturn BOM), `cmrAgreement` (rice only, skippable); cold → `chambers`, `rentPlan`;
   inputs → `agriLicence`; fpo / coop → `shareCapital`; farm → `batch`.
5. Desk tabs (`INVENTORY_PACK_TABS`, appended): `farm` (pack `agri`; views `farmers`, `vouchers`, `cycles`, `quality`,
   `batches`), `dairy` (views `charts`, `collection`, `bills`, `dispatch`, `products`, `cards`), `mill` (views `intake`,
   `batches`, `cmr`, `yield`), `cold` (pack `coldstore`; views `lots`, `gatepasses`, `rent`, `loans`, `chambers`), `inputs`
   (pack `agri_inputs`; views `licences`, `subsidy`, `credit`), `members` (pack `fpo`; views `register`, `shares`,
   `patronage`, `papers`). `PACK_TABS` rows in block `// R12`. If a view's package has not merged yet, A commits a
   one-line stub (`R12Stub.tsx`) that the package replaces.
6. **Farm batches** (view `batches`, table `farm_batches`): a flock, pond, herd or crop batch `{ id, kind: 'flock' |
   'pond' | 'herd' | 'crop', name, start, end?, placed (birds / seed / animals / acres), unit, cost_centre_id, events:
   [{ date, kind: 'mortality' | 'feed' | 'harvest' | 'medicine' | 'weight', qty, unit, note }], status }`. A batch
   creates its cost centre on first save (existing `cost-centres.ts`, kind `project`) so purchase bills and sales tagged
   to it give the batch P&L the existing reports already show. Memo figures: mortality %, feed kg, live weight / harvest
   kg, **FCR** = feed kg ÷ weight gained kg, cost per kg. No posting from events.
7. **Agricultural income** (farm kind): a ledger "Agricultural income (exempt)" under Other income is created on first
   use; sales of own produce can be tagged to it; the help topic says income from poultry, fishery, a mill, a dairy or
   a cold store is business income, not agricultural income (AG15).
8. Features catalogue (`features-catalog.ts`): one row per new pack and one "Agriculture profile" row with `PACK_HREF`.
9. **Sample data** (R6-B4): a new `src/lib/demo/profile-agri.ts`, only in the Demo company, dispatched by `agri_kind`;
   each package adds its own block (§6): dairy — 12 farmers, a rate chart, 20 days of shifts, one cycle bill, one
   dispatch; mill — a paddy intake with moisture cut, a milling batch, a CMR agreement with one delivery; cold — 6 lots,
   a rent plan, one gate pass, one loan; inputs — 3 licences, a subsidised-urea sale, a credit sale due at harvest;
   fpo — 20 members with shares, an aggregation cycle, a patronage run; farm — a broiler flock with FCR.

**Files.** New: `src/lib/agri/{ag-profile,ag-registry,ag-settings,ag-shared,ag-batches}.ts`, `src/lib/agri-rules.ts`
(scaffold with one section per package), `src/types/agri-r12.ts` (scaffold), `src/components/agri/{AgriKindPicker,
FarmDesk,BatchesView,R12Stub}.tsx`, `src/lib/demo/profile-agri.ts`. Edit: `industry-packs.ts`, `shop-presets.ts`,
`features-catalog.ts`, `checklist-steps.ts`, `SetupWizard.tsx`, `FeaturesPanel.tsx`, `page-tabs.ts`
(`INVENTORY_PACK_TABS`), `Inventory.tsx` (one lazy mount per desk), the demo dispatcher.

**Storage.** Settings fields `agri_kind`, `mill_kind`, `agri_settings` (object). Table `farm_batches`.

**Tests.** `tests/ag-profile.test.ts`: each kind's type / modules / packs / landing / switches; `registered` adds `gst`;
`inputs` sets `retail_kind: 'general'` so R9's step does not fire; `PACK_OF_TYPE` / `PACK_ROUTES` unchanged; existing
`manufacturer` / `kirana` companies unchanged; checklist steps by kind. `tests/ag-batches.test.ts`: FCR, mortality %,
cost centre created once. `tests/industry-packs.test.ts` extended with the six ids.

#### AG-A2 Farmers and members master

**User story.** As a collection-centre secretary I add 200 farmers from an Excel sheet with their village, member no.,
bank account and UPI ID; each gets a short code (F-0042) that I type at the can, and a printable card with a QR.

**Acceptance criteria.**
1. Farmers are **vendors** (they sell to us); a cold-storage depositor or a dealer's farmer customer is a **client**; one
   person may be both, linked by the same `ag.code`. Additive sub-object `ag` on `Vendor` and `Client`
   (declaration merging): `code` (unique per company, default `F-0001` sequence), `village?`, `centre_id?` (dairy
   centre / FPO cluster / collection point), `route?`, `member_no?`, `member_since?`, `member: boolean`,
   `land_acres?`, `crops?: string[]`, `animals?: { cows?, buffaloes? }`, `bank?: { name, account, ifsc }` (reuses the
   vendor bank fields when present), `upi?`, `aadhaar_last4?` (exactly 4 digits), `kcc_no?`, `phone?`, `language?`,
   `status: 'active' | 'inactive'`. `principal_kind: 'agriculturist'` (R8) is set on every farmer vendor so the RCM
   prompt and the patti code see them.
2. View Farm → Farmers: list by centre / village with balances (payable from cycles and vouchers, receivable from input
   sales), search by code / phone / name, import CSV / XLSX through the existing import pipeline (one mapping preset
   "Farmers"), export, and a **farmer card** print (A6, code + QR of the code via `qrcode.react`, name, village, member
   no.) — 8 per A4 sheet.
3. Centres (`agri_settings.centres: [{ id, name, kind: 'milk' | 'cluster' | 'mill_gate' | 'cold', godown_id? }]`): a milk
   centre maps to a godown so collected milk is stock there (B2).
4. Duplicate guard: same phone or same bank account on two farmers → soft warning.

**Files.** New: `src/lib/agri/ag-farmers.ts`, `src/components/agri/FarmersView.tsx`, `FarmerCard.tsx`. Edit: the import
mapping presets (one row), the vendor / client form (one lazy "Farmer" section, mounted only with the `agri` pack).

**Tests.** `tests/ag-farmers.test.ts`: code sequence and uniqueness; Aadhaar field rejects anything but 4 digits;
import mapping; `principal_kind` set; balances from vouchers and cycles; duplicate warnings.

#### AG-A3 Farmer purchase voucher, quality cuts, agri tax classes and declarations

*Seen in:* every mill, FPO and trader buying from farmers; N 2/2017, 6/2022, 4/2017; Rule 6DD(e); 194Q.

**User story.** As a rice miller I buy 52 bags of paddy from a farmer: gross 2,640 kg, tare 0.5 kg a bag, moisture 19%
against a 17% norm, so 2% is cut; mandi fee 2% and RDF 2% are on me; the voucher prints in my own series with "Purchased
from an agriculturist — exempt; no reverse charge", and I pay him by NEFT.

**Acceptance criteria.**
1. **Farmer purchase voucher** = an ordinary `purchases` row with `bill_number` from the `FPV/FY…` series (the R9 URD
   pattern), vendor = a farmer, `ag.voucher: { centre_id?, vehicle?, wbs_id?, quality: [...], cut_kg, accepted_kg }`.
   Lines carry `wt` (R8 weighing: gross, packages, tare, dhalta) on purchase lines; the net accepted weight is the line
   quantity, so the stock engine, purchase register and GSTR-3B Table 5 (exempt inward) read it unchanged.
2. **Quality cuts** (view `quality`, table `quality_cut_tables`): per commodity `{ commodity, params: [{ key: 'moisture'
   | 'foreign' | 'damaged' | 'immature' | 'broken' | 'custom', norm_pct, mode: 'weight' | 'price', per_point_pct,
   max_pct?, reject_above? }] }`. A reading above the norm cuts weight (kg) or price (₹ / qtl) by `per_point_pct` per
   point; above `reject_above` the voucher warns "reject or treat as lower grade". The cut is printed per parameter.
   No preset values (they are contract / agency terms); starter rows in help only.
3. **Charges** reuse R8 charge heads (`tr-charges.ts`) on purchase vouchers: market fee, RDF, commission, hamali,
   bardana, with `in_value` / `own_rate` / `outside` and *paid by us* vs *recovered from the farmer*. No preset rate
   (TR6); the help topic shows reported examples (Punjab 3% + 3%, Haryana 2% + 2% on paddy) marked "verify — AG20".
4. **Agri tax classes** (`agri-rules.ts` `AGRI_CLASS_RULES`, date-keyed, append-only, `source` + `verified` per row):
   an item gets `ag_class` (additive, catalog items) — `milk_fresh`, `milk_uht`, `curd_loose`, `curd_packed`, `paneer`,
   `ghee_butter`, `cheese`, `milk_powder`, `cereal_loose`, `cereal_packed_25`, `paddy`, `rice_husk`, `rice_bran_feed`,
   `rice_bran_other`, `dorb`, `broken_rice`, `oil_cake_feed`, `oil_cake_other`, `edible_oil`, `pulses_loose`,
   `pulses_packed_25`, `flour_loose`, `flour_packed_25`, `veg_fruit_fresh`, `potato`, `seed_sowing`, `fertiliser`,
   `fert_input`, `pesticide_chem`, `biopesticide`, `micronutrient`, `cattle_feed`, `tractor`, `farm_machine`,
   `live_poultry`, `eggs`, `fish_fresh`, `storage_agri`, `storage_other`, `milling_pds`, `job_milling`, `interest`.
   The class **suggests** HSN / SAC and rate by document date (22 Sep 2025 rows per §2.3a); a typed rate always wins
   (`gst-guards` shows "rate differs from the class (AGn)" as a soft notice).
5. **Declarations** (lazy, via `SupplyDeclaration`): a voucher from an agriculturist prints "Purchased from an
   agriculturist — agricultural produce; exempt; reverse charge not applicable" unless a line hits the R8 notified-goods
   prompt (TR17), which then prints its RCM line. An exempt-only sale is a bill of supply (existing) with "Agricultural
   produce — not pre-packaged and labelled" when a `*_loose` / `paddy` class is on it; a mixed bill is an
   invoice-cum-bill of supply (Rule 46A, existing behaviour).
6. **194Q hint**: when our turnover test passes (`BUYER_194Q_TURNOVER_RULES`) and a farmer's FY purchases cross
   ₹50 lakh, the voucher shows the existing 194Q prompt (agricultural produce is "goods" — AG13).
7. Payment of a voucher uses the existing payment dialog; cash above ₹10,000 to a farmer vendor (`principal_kind:
   'agriculturist'`) passes the A4 Rule 6DD(e) check.

**Files.** New: `src/lib/agri/{ag-vouchers,ag-quality,ag-tax}.ts`, `src/components/agri/{VouchersView,QualityView,
VoucherAgriPanel}.tsx`. Edit (one lazy line each, §6): `BillModal.tsx` (mount `VoucherAgriPanel` with the `agri` pack),
`gst-guards.ts` (class-rate notice), `paper-helpers.ts` (`agriDeclaration`).

**Tests.** `tests/ag-vouchers.test.ts`: FPV numbering survives delete; net weight → quantity; moisture cut by weight and
by price; reject warning; charges paid vs recovered; Table 5 value; 194Q prompt threshold. `tests/ag-tax.test.ts`: class
→ rate before / after 22 Sep 2025; typed rate wins; declarations by line mix; RCM line only for notified goods.

#### AG-A4 Farmer payment cycles: pooled bills, deductions, bank file, slips, Rule 6DD(e)

**User story.** As a dairy society I close the 11–20 Oct cycle: one bill for 186 farmers, each line with litres, fat-kg,
SNF-kg and amount, less cattle feed bought on credit, an advance instalment and ₹50 share money; I download the NEFT
file, send each farmer his slip on WhatsApp, and pay the five farmers without bank accounts in cash without a 40A(3)
warning.

**Acceptance criteria.**
1. **Cycle settings** (`agri_settings.cycles`): `{ length: 'weekly' | '10day' | 'fortnight' | 'monthly', start_day?,
   pay_lag_days }`, per centre overridable. Periods are local-day ranges (1–10, 11–20, 21–end for `10day`).
2. **Pooled cycle bill** (table `farmer_cycles`, `CYB/FY…`): `{ id, number, centre_id, period_from, period_to, source:
   'milk' | 'produce', lines: [{ farmer_id, qty, unit, kg_fat?, kg_snf?, amount, bonus?, deductions: [{ kind: 'feed' |
   'input' | 'advance' | 'loan' | 'share' | 'insurance' | 'union' | 'other', ref_id?, amount }], net }], purchase_id,
   journal_id?, payment_file?, status: 'draft' | 'closed' | 'paid' }`. **Close** writes **one `purchases` row** per
   cycle (vendor = the centre's pooled vendor "Milk producers — <centre>" / "Farmers — <cluster>", created on first
   use; lines per item class: cow milk / buffalo milk / produce; `bill_number` = the CYB number), so stock, Table 5 and
   the purchase register see it once. Farmer-wise balances are the cycle lines (the farmer ledger view sums cycles,
   vouchers and payments).
3. **Deductions.** `feed` / `input` lines come from the farmer's unpaid input invoices (A2 links the client and vendor
   by `ag.code`): on close each is settled by a receipt with `exchange_purchase_id = purchase_id` (existing no-cash
   marker), and one journal moves the set-off total Dr pooled vendor | Cr "Sundry creditors — exchange". `advance` /
   `loan` reduce the farmer's advance (a payment voucher made earlier, Dr Farmer advances) through the same journal;
   `share` credits "Share application money — members" (D5); `insurance` / `union` / `other` credit a named ledger
   (created on first use). Net never goes below zero: the excess carries to the next cycle as a farmer receivable line.
4. **Payment.** "Pay cycle" builds a `bank-upload.ts` file (existing presets; one row per farmer with a bank account)
   and records **one payment voucher** per mode (bank, cash) Dr pooled vendor | Cr bank / cash, with the per-farmer
   split stored on the cycle. Nothing is sent; the user records it after the bank confirms (existing rule).
5. **Rule 6DD(e) cash check** (`ag-cash.ts`, lazy, called by the existing cash guards with one guarded line): a cash
   payment to a vendor with `principal_kind: 'agriculturist'` or a pooled farmer cycle is **not** warned under Sec
   40A(3); the guard shows instead "Cash to a cultivator / producer — Rule 6DD(e); keep the farmer's acknowledgement
   (AG14)". Payments to a company, a trader or a processor keep the warning.
6. **Slips.** Per farmer: a payment slip (A5 paper, 80 mm or A6) and a WhatsApp message via `wa.me` (Hindi or English by
   the farmer's `language`). A bulk "send all" queue walks the farmers one tap at a time (no automation).
7. **Bonus / price difference** (year-end, dairy / FPO): a run computing ₹ per kg fat / per litre / per quintal on the
   year's cycles; posted as a draft journal to "Price difference to members" (default, AG25) or, when the user picks
   "patronage" (D5), to the appropriation account. Never automatic.

**Files.** New: `src/lib/agri/{ag-cycles,ag-cycle-post,ag-cash,ag-slips}.ts`, `src/components/agri/CyclesView.tsx`.
Edit: `rt-cash-guard.ts` and `cn-muster.ts` cash checks (one lazy guarded line each), `bank-upload.ts` (accepts a cycle as
a source: one adapter function, no format change).

**Tests.** `tests/ag-cycles.test.ts`: periods by length; one purchases row per cycle; Σ lines = purchase total; feed
set-off receipts carry `exchange_purchase_id` and the cash book ignores them; the set-off journal balances; negative net
carries forward; bank file rows; 6DD(e) suppresses the warning only for agriculturists; reopening a cycle (draft only)
recomputes and deletes its vouchers through their guards.

#### AG-A5 Agri documents on paper

**User story.** As a cold-storage owner my rent bill shows lot no., receipt no., commodity, bags, season and rate per bag;
as a dealer my urea memo shows my fertiliser licence, the PoS transaction no. and batch; as a dairy my farmer's slip
shows each shift's litres, fat and SNF — all in the PDF and on WhatsApp.

**Acceptance criteria.**
1. **Snapshot** `ag` on invoices (one record key, §1): `{ kind: 'milk_sale' | 'rent' | 'inputs' | 'cmr' | 'produce' |
   'job_milling', header?: {...}, lines?: Record<lineId, {...}> }`; each package writes its sub-object through one
   `agSnapshot(kind, …)` helper (B: milk sale fat / SNF per line; C: CMR / job milling header; D: lot, season, licence,
   PoS ref). Old documents without `ag` print unchanged.
2. **Paper block** (`AgriBlock.tsx`, lazy; mounted by `TemplateEngine` after `PartyPanel`, before `GstBody`, never on
   `receipt` unless the kind is `inputs`): a ruled box per kind — *Storage particulars* (lot / receipt no., commodity,
   variety, bags in / out / balance, chamber, date in, season, rate basis); *Dealer particulars* (licence nos. by type,
   principal certificate ref, PoS transaction no., farmer ID last 4, bags under subsidy); *Milk particulars* (tanker,
   shift, kg fat, kg SNF, rate chart); *Custom milling* (agency, season, lot / ACK no., paddy, outturn %, rice due /
   delivered). Accent variable only.
3. **Line sub-line**: `trackingText` gains one helper call `agriLineText(item, ag)` → "Fat 6.8% · SNF 9.0% · 412.5 L" /
   "Lot CSR/26-27/0042 · 120 bags × ₹180 (season 2026)" / "Batch UR2611 · Exp 03/2028 · MRP ₹266.50 / bag" printed under
   the line name in **both** item tables. Without `ag` it returns ''.
4. **Statement pages** (`AgriStatementPage.tsx`, lazy, the R3-B4 annexure pattern, following page): the farmer slip
   (shift-wise table, A4 / B3), the voucher's weighment and quality-cut table (A3), the CMR statement (C3), the rent
   working (D2). Each prints from the snapshot or the cycle row only — never recomputed.
5. **Small papers** (HTML print pages, the `abstractHtml` pattern, also CSV): farmer card (A2), collection slip 58 / 80
   mm (B2), weighbridge slip (C1), storage receipt and gate pass (D1), share certificate (D5). Each carries "working
   paper — verify" only where it states a tax or a statutory figure.
6. **Declarations**: `agriDeclaration` in `paper-helpers.ts` (A3 texts), plus "Exempt — storage of agricultural produce
   (N 12/2017 entry 54(e); verify AG8)" on an exempt rent bill and "Interest on loan — exempt" on an interest bill.
7. Print copies, the share link and PDF export carry the same paper (they render `TemplateEngine`).

**Files.** New: `src/components/templates/parts/{AgriBlock,AgriStatementPage}.tsx` + `agri-paper.module.css`,
`src/lib/agri/{ag-snapshot,ag-print}.ts`. Edit: `TemplateEngine.tsx` (two lazy mounts, §6), `paper-helpers.ts`
(`agriLineText`, `agriDeclaration`), `invoice-defaults.ts` (`R12_RECORD_KEYS`, one spread token).

**Tests.** `tests/ag-print.test.ts`: block rows per kind; sub-line texts; old invoices without `ag` render byte-identical
(snapshot of the paper HTML for a fixture); `ag` survives `normalizeRecord` (load → edit → save); statement pages read
the snapshot only.

### AG-B — Dairy and milk collection (pack `dairy`)

#### AG-B1 Fat / SNF rate charts

**User story.** As a society secretary I load the union's chart for cow milk (fat 3.0–5.5 × SNF 7.5–9.0, ₹ per litre)
and the buffalo chart (₹ per kg fat), effective from 1 Nov; old shifts keep their old rate.

**Acceptance criteria.**
1. Table `milk_rate_charts`: `{ id, name, milk: 'cow' | 'buffalo' | 'mixed', basis: 'matrix' | 'fat_kg' | 'ts_kg' |
   'two_axis' | 'flat', unit: 'L' | 'KG', effective_from, effective_to?, matrix?: { fat_steps: number[], snf_steps:
   number[], rates: number[][] }, fat_rate?, snf_rate?, ts_rate?, flat_rate?, min_fat?, min_snf?, below_min:
   'reject' | 'flat' | 'deduct', incentives?: [{ kind: 'shift' | 'category' | 'quantity', key, add }], centre_ids? }`.
   - `matrix`: rate per unit at (fat, SNF), nearest lower step (default; "nearest" option);
   - `fat_kg`: ₹ per kg fat × kg fat;
   - `ts_kg`: ₹ per kg total solids (fat + SNF);
   - `two_axis`: kg fat × fat rate + kg SNF × SNF rate (the common union formula).
2. Chart lookup is by shift date (`effective_from` ≤ date, latest wins; append-only — a change is a new chart row, the
   old one gets `effective_to`). The applied chart id and rate are **stored on each entry** (B2), so a later chart never
   reprices old milk.
3. Import / export the matrix as CSV / XLSX (rows = fat, columns = SNF); a preview heat-table; a "test a sample" box.
4. kg conversion: litres ↔ kg by CLR / density (`kg = L × (1 + CLR/1000)`, default CLR 28 cow / 30 buffalo when not
   read; setting) — kg fat = kg × fat %.

**Files.** New: `src/lib/agri/{ag-rate-chart}.ts`, `src/components/agri/RateChartsView.tsx`.

**Tests.** `tests/ag-rate-chart.test.ts`: each basis; nearest-lower vs nearest; below-minimum modes; effective dating and
no repricing; litres ↔ kg; CSV round trip.

#### AG-B2 Shift collection sheet with analyser and scale

**User story.** At 6 a.m. the operator types farmer code 42, the can weighs 8.40 kg on the scale, the analyser sends fat
6.9 and SNF 9.1; the line fills its rate and amount, prints a 58 mm slip, and moves to the next farmer. At 8:30 the
morning shift is closed: 186 farmers, 1,642 L, average fat 5.8.

**Acceptance criteria.**
1. Table `milk_shifts`: **one row per centre per date per shift** `{ id, centre_id, date, shift: 'M' | 'E', entries:
   [{ id, farmer_id, milk, qty, unit, fat, snf, clr?, water_pct?, chart_id, rate, amount, sample_only?, rejected?,
   reason?, at }], closed_at?, closed_by?, cycle_id? }`. Totals are derived. A closed shift is read-only unless reopened
   (audited); a shift inside a closed cycle cannot reopen.
2. **Entry screen** (keyboard-first: code → qty → fat → SNF → Enter; big numerals; works on a phone): farmer by code /
   name / QR (camera, existing scanner); duplicate entry for the same farmer in the shift warns; rejected milk (sour,
   adulterated, below minimum) records qty with zero amount and a reason.
3. **Devices** (lazy, feature-detected Web Serial, the `scale-serial.ts` pattern): the existing scale reader for can
   weight; a new **analyser frame parser** `ag-analyser.ts` for plain ASCII lines carrying fat / SNF / CLR / water
   (configurable field order and separators; presets "generic CSV" and "key=value"); device profile in device-local key
   `mrchartist_milk_analyser` (not backed up). Nothing is sent to the devices. Typing always works.
4. **Slip**: 58 / 80 mm print (existing ESC/POS path when a printer is set) and an optional `wa.me` message per entry
   (off by default).
5. **Stock**: on close, the shift's accepted litres post as a stock receipt into the centre's godown at the shift's
   value (a stock journal input to the engine, `production`-style, no ledger posting — the ledger posting is the cycle
   purchase in A4/B3). A test proves stock is not counted twice when the cycle purchase is written: the cycle purchase
   row carries `ag.stock_by_shift: true`, and the stock engine skips purchase lines with it (one guarded line in the
   purchase stock reader, §6).
6. Shift summary: farmers, litres, kg fat, kg SNF, average fat / SNF, amount, rejected; morning vs evening.

**Files.** New: `src/lib/agri/{ag-shifts,ag-analyser}.ts`, `src/components/agri/{CollectionView,CollectionEntry}.tsx`.
Edit: the purchase stock reader (one guarded line, §6), the device settings panel (one lazy row).

**Tests.** `tests/ag-shifts.test.ts`: rate from chart at shift date; duplicates; rejection; close / reopen rules;
stock posted once; 300 farmers × 365 days × 2 shifts loads as 730 rows. `tests/ag-analyser.test.ts`: frame parsing
presets, partial frames, units.

#### AG-B3 Milk bill per cycle

**User story.** On the 11th I click "Make bills 1–10 Oct": every farmer's shifts become one line with litres, kg fat, kg
SNF and amount; feed and advances come off; I review and close.

**Acceptance criteria.**
1. `buildMilkCycle(centre, from, to)` reads closed shifts in the range and fills an A4 cycle (`source: 'milk'`): per
   farmer qty, kg fat, kg SNF, amount, incentives (shift / quantity add-ons from the chart), deductions (A4).
   Unclosed shifts in the range block "close" with a list.
2. **Farmer milk bill** (A5 statement page): shift-wise table (date, M / E, qty, fat, SNF, rate, amount), totals, deductions,
   net, payment mode / bank last 4; printable per farmer or all (one PDF, existing batch PDF).
3. Cycle summary report: litres and amount by farmer, village, route; top / bottom fat; farmers with no supply.
4. GST: milk lines use class `milk_fresh` (nil); the pooled purchase is exempt inward (Table 5).

**Files.** New: `src/lib/agri/ag-milk-cycle.ts`, `src/components/agri/MilkBillsView.tsx`.

**Tests.** `tests/ag-milk-cycle.test.ts`: Σ entries = cycle amount; incentives; unclosed shift blocks; bill pages from
the cycle row only.

#### AG-B4 Dispatch to union / plant and fat-SNF reconciliation

**User story.** Twice a day the tanker takes the milk to the union's chilling centre; the union's acknowledgement comes
back with its own quantity, fat and SNF. I see the shortage in kg fat and kg SNF per dispatch and per month, and the
union's 10-day payment matches my sale invoices.

**Acceptance criteria.**
1. Table `milk_dispatches` (`MDS/FY…`): `{ id, number, date, shift, centre_id, buyer_id, tanker?, sent: { qty, unit,
   fat, snf, temp? }, received?: { qty, fat, snf, ack_no, date }, invoice_id? }`.
2. On save the dispatch moves stock out of the centre godown (stock journal input); "Bill" raises a **sale invoice** to
   the buyer at the buyer's rate (the union's chart, B1 chart with `buyer_id`) — class `milk_fresh` (bill of supply),
   with `ag` lines (fat, SNF, kg fat, kg SNF) printed by A5.
3. **Reconciliation** view: collected (shifts) vs dispatched vs received per day / cycle / month in litres, kg fat and kg
   SNF; shortage / gain and %; local sales and products (B5) as outflows; closing stock in the centre. A tolerance
   setting (default 0.5% kg fat, "practice") flags days beyond it.
4. Union payment receipts are ordinary receipts against the dispatch invoices; the union's deductions (feed supplied
   by the union, cess) as typed deductions on the receipt (existing short-payment handling).

**Files.** New: `src/lib/agri/{ag-dispatch,ag-milk-reco}.ts`, `src/components/agri/DispatchView.tsx`.

**Tests.** `tests/ag-dispatch.test.ts`: stock out; invoice from received or sent figures (setting, default received);
reconciliation sums; tolerance flags; invoice snapshot unchanged after a later chart.

#### AG-B5 Dairy products and household milk cards

**User story.** I convert 200 L of milk into 40 kg paneer and whey, sell paneer at the counter (nil GST since 22 Sep
2025) and ghee at 5%; 60 households take 1 L a day on a monthly card, and I bill them on the 1st.

**Acceptance criteria.**
1. **Product starters**: BOM templates (existing `boms`) for paneer, khoa, curd, ghee (via cream / butter), buttermilk,
   with by-products (whey, ghee residue) and typical yields as editable values ("practice — adjust"), and the item classes
   of A3 (`paneer`, `ghee_butter`, `curd_loose` / `curd_packed`, `cheese`, `milk_uht`). Making uses the existing
   manufacturing journal / production order; fat accounting memo: kg fat in vs kg fat in products.
2. **Milk cards** (table `milk_cards`, one row per customer per month): `{ id, client_id, month, milk, rate, default_qty,
   days: Record<day, qty>, delivered_by?, invoice_id? }`; a grid to mark daily quantity (default fills, tap to change /
   skip); "Bill month" raises one invoice per card (bill of supply for nil milk) with an `ag` line "31 days · 29.5 L";
   receivables, reminders and UPI links are the existing ones.
3. Local counter sales of milk use POS with the scale (existing).

**Files.** New: `src/lib/agri/{ag-dairy-products,ag-milk-cards}.ts`, `src/components/agri/{ProductsView,MilkCardsView}.tsx`.

**Tests.** `tests/ag-milk-cards.test.ts`: month grid, defaults, skips, invoice totals, one invoice per card per month
(re-billing refused); `tests/ag-dairy-products.test.ts`: starter BOMs valid; class rates by date.

### AG-C — Mills: rice, flour, dal, oil (pack `mill`)

#### AG-C1 Grain intake: gate entry, weighbridge and moisture

**User story.** A tractor arrives with paddy: the gate entry takes the vehicle no. and farmer, the weighbridge gives gross
and (after unloading) tare, the lab reads moisture 19.2%; the slip prints, and the purchase voucher (A3) or the CMR
receipt (C3) is made from it in one tap.

**Acceptance criteria.**
1. Table `weighbridge_slips` (`WBS/FY…`): `{ id, number, date, vehicle, party_kind: 'farmer' | 'trader' | 'agency' |
   'other', party_id?, commodity, gross_kg, gross_at, tare_kg?, tare_at?, net_kg, bags?, readings: { moisture?, foreign?,
   damaged?, … }, use: 'purchase' | 'cmr' | 'job' | 'sale' | 'other', ref_id?, status: 'open' | 'done' | 'cancelled' }`.
   Gross and tare come from the existing Web Serial scale reader (weighbridge indicators send ASCII; same frame parser) or
   are typed; first and second weighing may be hours apart (an "open slips" list).
2. "Make voucher" opens A3's voucher pre-filled (net weight, bags, readings → quality cuts); "Receive for CMR" adds the
   lot to the C3 account; "Receive for job milling" opens the job-work principal receipt (existing `JWP`).
3. The printed slip (A5 small paper) shows both weighings with times, net, readings and "subject to quality cut".
4. Daily intake report: by commodity, party kind, use; average moisture; open slips older than 24 h flagged.

**Files.** New: `src/lib/agri/ag-weighbridge.ts`, `src/components/agri/IntakeView.tsx`.

**Tests.** `tests/ag-weighbridge.test.ts`: net = gross − tare; open → done; voucher prefill equals slip; cancelled slip keeps
its number.

#### AG-C2 Milling batches: outturn, by-products, moisture loss

**User story.** I mill 100 qtl of paddy: 64 qtl head rice, 4 qtl broken, 7 qtl bran, 22 qtl husk, 3 qtl loss. The batch
shows outturn 68% (rice + broken) against my 67% standard, bran and husk valued at market, and the rice cost per qtl after
by-product credit.

**Acceptance criteria.**
1. **Mill BOM starters** by `mill_kind` (existing `boms`, editable, "practice — adjust"):
   - rice (raw / parboiled): head rice (main), broken (co-product or by-product), bran, husk, loss %;
   - flour (roller): atta / maida / suji / chokar (bran);
   - dal: dal (main), chunni, husk, broken;
   - oil (expeller / kachi ghani): oil (main), oil cake (by-product);
   with `co_product` cost % or `by_product` fixed rate (existing engine).
2. A milling batch is an ordinary **production order** (R4-A) with `ag.mill` (declaration merging on `ProductionOrder`):
   `{ input_moisture?, output_moisture?, standard_outturn_pct, std_source: 'own' | 'cmr' }`. Output reported through the
   existing manufacturing journal.
3. **Yield panel** on the order (lazy, mounted only with the `mill` pack): input qty, outputs by kind, outturn % (main +
   listed co-products) vs standard, by-product %, loss % split into moisture loss (from input / output moisture) and
   unexplained loss; cost per unit of main after by-product credit (the engine's own figures, not recomputed).
4. Batches over or under standard by more than a tolerance (default 1 point) are flagged in C5.

**Files.** New: `src/lib/agri/{ag-mill-bom,ag-yield}.ts`, `src/components/agri/{MillBatchesView,YieldPanel}.tsx`. Edit: the
production-order screen (one lazy panel mount).

**Tests.** `tests/ag-yield.test.ts`: outturn and loss maths; moisture loss formula `in × (m_in − m_out) / (100 − m_out)`;
by-product credit equals the engine's; starters valid BOMs for each `mill_kind`.

#### AG-C3 Custom milling (CMR) and job milling

**User story.** For Kharif 2026 the State agency gives me 5,000 qtl of paddy to mill; I owe 3,350 qtl of rice at 67%,
delivered in lots against acknowledgements; I keep the by-products and pay their value as fixed by the agency; I bill
milling charges and see each month what rice is still due.

**Acceptance criteria.**
1. Table `cmr_agreements`: `{ id, agency_id (client), season, kind: 'raw' | 'parboiled', outturn_pct (default 67 raw / 68
   parboiled, "agency norm — verify", CAG 2015), paddy_lots: [{ wbs_id?, jwp_id, date, qty }], deliveries: [{ id,
   number (CMR/FY…), date, qty, lot_no, ack_no?, fortified? }], milling_rate?, byproduct_recovery?: { basis, rate },
   due_by?, bg_id?, status }`. Paddy received is the **principal's material** (existing `job_work_principal`, `JWP`), so
   it never enters our stock valuation; rice delivered is a JWP return line.
2. **CMR account**: paddy received, rice due (= paddy × outturn %), delivered, balance due, % complete, days to deadline;
   by-product recovery due (if the agency recovers the value) and milling charges earned.
3. **Milling charges invoice** (`ag.kind = 'cmr'` snapshot, A5 block): class `milling_pds` → **exempt** when goods
   (fortificant, gunny, packing) are ≤ 25% of the value (Circular 153/09/2021, entry 3A); the editor shows the 25% test from
   typed values; above it → 5% job work to a registered person (entry 26), else the user's rate (AG9).
4. **Job milling for others** (atta chakki, oil expeller for a farmer, dal milling for a trader): a job-work principal
   receipt + `jobChargesLine` (existing) with class `job_milling` — rate suggestion 5% for a registered principal
   (entry 26), "verify — AG10" for an unregistered one.
5. Gunny / bardana issued by the agency: tracked as principal's material (existing register).

**Files.** New: `src/lib/agri/ag-cmr.ts`, `src/components/agri/CmrView.tsx`. Edit: none in `job-work.ts` (read-only use,
one exported helper if needed — §6).

**Tests.** `tests/ag-cmr.test.ts`: due / delivered / balance; parboiled default; deliveries numbered; 25% test boundary;
exempt vs 5% suggestion; paddy never in stock valuation.

#### AG-C4 Packing / labelling rule and mill sales

**User story.** I sell 25 kg bags of my branded rice (5%), 50 kg bags to wholesalers (nil — not "pre-packaged and
labelled" above 25 kg), husk to a boiler (nil) and de-oiled bran to a feed mill (5%); the bill picks each rate and e-way
bills are made for the taxable ones.

**Acceptance criteria.**
1. Item field `ag_pack_kg?` (additive, catalog items; pack size) and `ag_labelled?: boolean`. For classes with a
   `*_packed_25` / `*_loose` pair the line suggests the packed class when `ag_labelled` and pack ≤ 25 kg (or 25 L), else
   loose; the editor note says "pre-packaged and labelled ≤ 25 kg → 5% (N 6/2022); verify AG5".
2. A **retail sale from a > 25 kg bag** (loose) at the counter uses the loose class (FinMin FAQ).
3. By-product classes from A3 (`rice_husk`, `rice_bran_feed` / `rice_bran_other`, `dorb`, `broken_rice`,
   `oil_cake_feed` / `oil_cake_other`) with a one-line "end use" choice on the line where the class depends on it
   (bran / cake as feed or not); the buyer's declaration ("for cattle feed") is a typed note on the bill.
4. e-Way bill prompt (existing) for taxable lines above the threshold; exempt-only bills show "e-way bill may not be
   needed for exempt goods — verify AG12" instead of the prompt.
5. Weighing on sale lines reuses `wt` (R8) — bags, tare, net.

**Files.** New: `src/lib/agri/ag-packing.ts`. Edit: the item form (one lazy "Pack size / labelled" row with the `mill` or
`agri` pack), `gst-guards.ts` (same lazy check as A3).

**Tests.** `tests/ag-packing.test.ts`: class pick by pack size and label at 25 kg exactly / 25.01; loose counter sale;
end-use choice; e-way prompt text by line mix.

#### AG-C5 Yield and stock reports; bank stock statement for mills

**User story.** At month end I see paddy bought, milled, rice and by-products made and sold, the outturn trend, CMR rice
still due, and a stock statement for my bank's cash-credit limit that leaves out the agency's paddy.

**Acceptance criteria.**
1. Mill report (view `yield`): per month — intake (own / CMR / job), milled, outputs by kind, outturn % vs standard,
   by-product realisation (sales value ÷ qty), batches flagged (C2), moisture loss total.
2. **Bank stock statement**: the existing `tr-stock-statement.ts` with a mill preset — paddy, rice, broken, bran, husk,
   packing material; **principal's material (CMR / job) excluded** (it is not ours; the existing statement already
   excludes consignment); creditors for paddy deducted; margins as typed.
3. Oil mills: oil yield % on seed and cake %, the same panel.
4. CSV / XLSX export of every table.

**Files.** New: `src/lib/agri/ag-mill-reports.ts`, `src/components/agri/YieldView.tsx`. Edit: `tr-stock-statement.ts` (one
preset entry, no logic change).

**Tests.** `tests/ag-mill-reports.test.ts`: monthly sums equal batch sums; CMR paddy excluded from the bank statement;
by-product realisation.

### AG-D — Cold storage, input dealers, FPO / co-operative

#### AG-D1 Cold-storage lots, storage receipts and gate passes (pack `coldstore`)

**User story.** In March a farmer brings 240 bags of potato (50 kg); I issue receipt CSR/26-27/0042 for chamber 3, floor
2, rack B; through the season he takes them out in four gate passes; each pass shows the balance bags and stops if his
loan is unpaid.

**Acceptance criteria.**
1. **Chambers** (`agri_settings.chambers: [{ id, name, capacity_bags, floors?, temp_range? }]`); utilisation by chamber
   (bags in / capacity).
2. Table `cold_lots` (`CSR/FY…` receipt numbers): `{ id, number, date_in, depositor_id (client), commodity, variety?,
   bags, bag_kg?, weight_kg?, chamber_id, location?, grade?, season, rent_plan_id, marks?, insured?: { by, value },
   outs: [{ id, number (GPO/FY…), date, bags, weight_kg?, to?, vehicle?, by?, loan_check: 'clear' | 'override',
   override_reason? }], transfers?: [{ date, to_depositor_id, bags, note }], status: 'stored' | 'part_out' | 'closed' }`.
   **Custody only**: the depositor's goods never enter our stock engine (no godown stock, no valuation; the R8
   consignment idea without stock lines). Balance bags = in − outs.
3. **Storage receipt** print (A5 small paper): receipt no., depositor, commodity, bags, weight, chamber, date, season, rent
   basis, "Non-negotiable receipt — not a WDRA e-NWR" (AG23), terms text from settings, signature.
4. **Gate pass out**: refuses more bags than the balance; checks D3 loans with a lien on the lot (refuse unless the
   loan is cleared or the owner overrides with a reason, audited); checks rent due (warn); prints the pass with balance.
5. **Transfer** of bags to another depositor (sale inside the store) with both parties' consent note; rent follows the
   plan's rule (default: charged to the depositor who takes them out).
6. Depositor statement: lots, bags in / out / balance, rent billed / paid, loans, interest.

**Files.** New: `src/lib/agri/{ag-cold-lots,ag-gatepass}.ts`, `src/components/agri/{ColdDesk,LotsView,GatePassView,
ChambersView}.tsx`.

**Tests.** `tests/ag-cold-lots.test.ts`: balances; over-release refused; lien blocks; override audited; transfer; numbers
never reused; lots do not touch stock reports.

#### AG-D2 Storage rent by bag-season, handling charges, exempt / taxable

**User story.** Potato rent is ₹180 a bag for the season (Mar–Nov) payable at release; a trader's frozen peas are
₹4 a bag a month (taxable 18%); loading and unloading are ₹5 a bag. When the farmer takes out 60 bags, the gate pass
raises the rent bill for those 60 bags.

**Acceptance criteria.**
1. Table `cold_rent_plans`: `{ id, name, commodity?, basis: 'bag_season' | 'bag_month' | 'qtl_season' | 'qtl_month' |
   'flat', rate, season?: { from, to }, min_months?, part_month: 'full' | 'days', charges: [{ name, basis: 'bag' | 'qtl'
   | 'flat', rate, when: 'in' | 'out' }], class: 'storage_agri' | 'storage_other', bill_at: 'out' | 'in' | 'monthly' |
   'season_end', late?: { after, rate_per_bag_month } }`.
2. **Rent bill** = an ordinary invoice with the `ag.kind = 'rent'` snapshot (lot, bags, period, basis, rate) printed by A5;
   raised at gate-pass time (default), monthly, at season end or in advance, from the plan. Bill of supply when the
   class is `storage_agri` (nil, entry 54(e)); tax invoice at 18% for `storage_other`; handling charges follow the
   principal supply's class (composite) by default, "own rate" as an option (AG8).
3. **Exempt vs taxable test** on the lot: commodity is "agricultural produce" (fresh potatoes, onions, fruits, vegetables,
   grains) → `storage_agri`; processed or non-agri (frozen foods, dry fruits processed, medicines, chemicals) →
   `storage_other`; the lot form asks the commodity and suggests the class with "verify AG8". A plan that bills **space
   rent** (a chamber let out as a whole) defaults to `storage_other` with the note "renting space may be a separate
   taxable supply (Gujarat AAR) — verify AG8".
4. **State rent rules**: some States notify cold-storage rent (e.g. West Bengal, Uttar Pradesh — recalled); the plan has
   a "notified rate" field with its order ref, shown on the bill. No preset values.
5. Rent receivable ageing by depositor and season (existing receivables); rent unpaid on closed lots flagged.

**Files.** New: `src/lib/agri/ag-cold-rent.ts`, `src/components/agri/RentView.tsx`.

**Tests.** `tests/ag-cold-rent.test.ts`: every basis; part months; minimum months; charges in / out; bill on release for the
bags released only; exempt vs taxable class; snapshot unchanged after a plan edit; no double billing of the same bags.

#### AG-D3 Loans against stored produce, with a lien

**User story.** A farmer with 240 bags in store borrows ₹1,20,000 at 12% a year against the lot; at release the gate pass
shows the loan and interest due; he pays from his sale money and the lien is lifted.

**Acceptance criteria.**
1. Table `agri_loans` (`LAS/FY…`): `{ id, number, date, borrower_id (client), lot_ids: string[], principal, rate_pct,
   basis: 'simple' | 'monthly_compound', due_date?, max_ltv_pct?, disbursed_by: 'bank' | 'cash', payment_voucher_id,
   repayments: [{ date, amount, interest_part, principal_part, receipt_id }], status: 'open' | 'closed' }`.
2. Posting: disbursement = payment voucher Dr "Loans to depositors" | Cr bank / cash; repayment = receipt voucher Dr bank /
   cash | Cr "Loans to depositors" (principal) and Cr "Interest on loans to depositors" (interest; GST exempt — a bill of
   supply for interest when the user wants a document, class `interest`). Real money: no no-cash marker.
3. **Loan-to-value** check: principal ≤ `max_ltv_pct` of (balance bags × a typed market rate) — warning only.
4. **Lien**: lots named on an open loan are blocked at the gate pass (D1); partial release allowed if the remaining bags
   still cover the balance at the LTV (setting).
5. Interest statement per loan (simple interest by days, 365-day year, from disbursement / last repayment); overdue loans
   in the bell (existing notifications, lazy check).
6. Help: "Lending regularly may need registration under your State's money-lenders law — verify (AG24)". No TDS (we
   receive interest).
7. Also usable by an FPO for member loans against produce (`fpo` pack lists the view under Members when `coldstore` is
   off; same table).

**Files.** New: `src/lib/agri/ag-loans.ts`, `src/components/agri/LoansView.tsx`.

**Tests.** `tests/ag-loans.test.ts`: interest by days; repayment split interest-first; lien blocks; partial release at LTV;
vouchers balance; closing at zero.

#### AG-D4 Input dealer desk: licences, principal certificates, subsidised fertiliser, credit till harvest (pack `agri_inputs`)

**User story.** As a fertiliser and pesticide dealer, every bill prints my three licence numbers; the app warns 45 days
before my insecticide licence expires and refuses to sell a pesticide batch past its expiry; a urea sale records the PoS
transaction no. and the farmer's last four Aadhaar digits; at month end my book stock of urea matches the PoS stock;
farmers buying on credit get "due at harvest — 15 Nov" with interest after it.

**Acceptance criteria.**
1. **Licences** (`agri_settings.licences: [{ kind: 'fertiliser_retail' | 'fertiliser_wholesale' | 'seed' | 'insecticide'
   | 'fssai' | 'apmc' | 'other', number, issued_by, valid_from?, valid_to?, premises?, products?: string[] }]`), printed in
   the dealer block (A5); expiry notices (reuse R9 `licenceNotices` maths — imported read-only, 45 / 60-day windows);
   a sale of an item whose `ag_class` needs a licence kind with none valid → warning (never a block).
2. **Principal certificates** (O-form for fertilisers, principal certificate for insecticides) per manufacturer:
   `agri_settings.principals: [{ vendor_id, kind, ref, valid_to? }]`; a purchase from a manufacturer without one warns.
3. **Batch / expiry / MRP**: existing batches and expiry; pesticides and seeds default to "block sale after expiry" (the
   pharmacy gate, reused by class), fertilisers to "warn"; R9 MRP guard set to `block` for subsidised fertiliser
   classes (sale above MRP).
4. **Subsidised fertiliser sale**: an item flag `ag_subsidised` (urea, DAP, MOP, NPK — typed by the dealer); the POS /
   invoice asks the **PoS transaction no.** and the farmer ID (Aadhaar last 4 / KCC), stored in `ag.inputs` and printed;
   a per-farmer monthly bag counter warns above a cap (default 50 bags / month, "reported — verify AG22").
5. **PoS stock check** (view `subsidy`): per subsidised product and month, book stock (stock engine) vs PoS stock typed from
   the device's report; differences listed with the sales missing a PoS no.
6. **Credit till harvest** (view `credit`): a sale on credit takes a **season due date** (`agri_settings.seasons:
   [{ name: 'Kharif' | 'Rabi' | 'Zaid' | custom, due }]`) instead of days; interest after the due date uses the existing
   interest notes (`tr-interest.ts`, party rate). Farmer khata (8A) shows "due at harvest". A dealer may set a credit
   limit per farmer (existing client limit).
7. Item classes from A3: `fertiliser` 5%, `fert_input` 5% from 22 Sep 2025, `pesticide_chem` 18%, `biopesticide` /
   `micronutrient` 5% from 22 Sep 2025, `seed_sowing` nil, `cattle_feed` nil, `tractor` / `farm_machine` 5% from 22 Sep
   2025 (all `verified: false` until AG4 / AG21 answered).

**Files.** New: `src/lib/agri/{ag-licences,ag-subsidy,ag-season-credit}.ts`, `src/components/agri/{InputsDesk,LicencesView,
SubsidyView,SeasonCreditView}.tsx`. Edit: the POS line extras (one lazy "PoS txn" field with the pack), the expiry gate
(class → block / warn, one lazy lookup), `tr-interest.ts` (accepts a season due date as the due date: one branch).

**Tests.** `tests/ag-inputs.test.ts`: licence expiry windows; unlicensed-class warning; principal-certificate warning;
expiry block by class; PoS fields required for subsidised items; monthly cap; PoS vs book difference; season due date and
interest start.

#### AG-D5 Members' capital, patronage and statutory papers (pack `fpo`)

**User story.** As an FPO (producer company) with 640 members, I allot 10 shares of ₹100 each to a new member, deduct the
share money from his produce payments in five instalments, print his share certificate, see each member's business
with the FPO this year, and give my CA a working paper for the profit split and the deduction claim.

**Acceptance criteria.**
1. Table `member_shares`: share ledger rows `{ id, date, member_id (vendor or client with `ag.member`), kind: 'allot' |
   'transfer_in' | 'transfer_out' | 'surrender' | 'refund' | 'forfeit', shares, face_value, amount, certificate_no?
   (SHC/FY…), from_member_id?, approved_on?, note }`; application money from cycles (A4 `share` deductions) or receipts
   sits in "Share application money — members" until allotment, then a journal moves it to "Share capital — members".
   Register of members (name, address, shares held, folio, date of membership, cessation) and share-certificate print.
   Rules: one-member-one-vote is a governance fact, not modelled; producer-company members must be primary producers or
   producer institutions — a checkbox with "verify AG18".
2. **Patronage register**: per member and FY, value and quantity supplied (cycles, FPV vouchers) and bought (input
   sales); the basis for a patronage bonus or price difference (A4-7).
3. **Distribution working paper** (year end, drafts only): profit after tax → statutory reserve (co-op: State Act %,
   typed), limited return on share capital (dividend, typed % with a cap field), patronage bonus by business, retained;
   posts a **draft** appropriation journal for the accountant (never automatic).
4. **Tax working papers** (`agri-rules.ts` `COOP_DEDUCTION_RULES`, `PRODUCER_COMPANY_RULES`, date-keyed):
   - co-operative: income by Sec 80P(2) / **Sec 149 (2025 Act, as reported)** head — marketing members' produce,
     supplying inputs to members, milk to a federal co-op, credit to members, other — with members vs non-members split
     where the books carry it (patronage register), "verify AG16";
   - producer company: 80PA eligible-business profits and the turnover test (< ₹100 crore); **the row for AY 2025-26
     onward says "no deduction found after AY 2024-25 — verify AG17"** (no deduction computed after that);
   - both print as working papers; nothing reaches a return.
5. **Statutory calendar** (lazy rows in the existing compliance desk): producer company — AGM, annual return and financial
   statements filing, members' register up to date, internal audit (as recalled for producer companies, "verify AG18");
   co-operative — annual general meeting, Registrar's audit, returns (State Act, typed due dates). Reminders only.
6. **Member statement** (WhatsApp / print): shares, application money, business this year, payments, inputs taken,
   loans (D3), balance.

**Files.** New: `src/lib/agri/{ag-members,ag-patronage,ag-coop-papers}.ts`, `src/components/agri/{MembersDesk,
ShareRegisterView,PatronageView,PapersView}.tsx`. Edit: the compliance desk calendar source (one lazy row group).

**Tests.** `tests/ag-members.test.ts`: allotment from application money; transfer keeps total shares; certificate numbers;
register as at a date; patronage sums equal cycle / voucher sums; distribution paper arithmetic; 80PA row after AY
2024-25 computes nothing; Sec 149 labels by date.

---

## 5. Work packages

Four packages, each one agent in its own worktree. **Merge order: AG-A first** (profile, registry, rules / types /
shared scaffolds, the `ag` record key, template mounts, stubs, every desk tab, help and Ctrl+K row). AG-B, AG-C and
AG-D follow in any order and can run in parallel (they share only registries, rules, types, demo and help). Every
package rebases on whatever of Round 10 has merged; the shared files with Round 10 are append-only (§6).

AG-A owns:
- the six pack ids and the profile (`agri_kind`, `mill_kind`, `agri_settings`);
- `agri-rules.ts`, `ag-registry.ts`, `ag-shared.ts` and `types/agri-r12.ts` scaffolds (every package's sub-field types of
  `ag` declared in one commit);
- the `R12_RECORD_KEYS` line in `invoice-defaults.ts` (the round's only first-paint byte);
- the series names `FPV`, `CYB`, `WBS`, `MDS`, `CMR`, `CSR`, `GPO`, `LAS`, `SHC` (reserved in one commit);
- every template mount in `TemplateEngine.tsx` (lazy imports by the paths in this PRD);
- `R12Stub.tsx` and every R12 desk / view / help / Ctrl+K row (§6).

### AG-A — Profile and shared farm pieces (A1–A5)

Owned (new):
- `src/lib/agri/ag-{profile,registry,settings,shared,batches,farmers,vouchers,quality,tax,cycles,cycle-post,cash,slips,
  snapshot,print}.ts`, `src/lib/agri-rules.ts`;
- `src/types/agri-r12.ts`;
- `src/components/agri/{AgriKindPicker,FarmDesk,BatchesView,FarmersView,FarmerCard,VouchersView,QualityView,
  VoucherAgriPanel,CyclesView,R12Stub}.tsx`;
- `src/components/templates/parts/{AgriBlock,AgriStatementPage}.tsx` + `agri-paper.module.css`;
- `src/i18n/areas/agri-r12a.ts`; `src/lib/demo/profile-agri.ts` (dispatcher + A's farm block);
- `docs/features/agri-r12.md` (one doc for the round; each package edits only its section);
- tests `ag-profile`, `ag-batches`, `ag-farmers`, `ag-vouchers`, `ag-tax`, `ag-cycles`, `ag-print`, `ag-registry`,
  `ag-rules`, `ag-pack-gate`.

Owned (edit):
- `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`;
- `SetupWizard.tsx`, `FeaturesPanel.tsx`; `page-tabs.ts` (`INVENTORY_PACK_TABS`), `Inventory.tsx` (lazy desk mounts);
- `TemplateEngine.tsx`, `paper-helpers.ts` (`agriLineText`, `agriDeclaration`), `invoice-defaults.ts` (one token);
- `BillModal.tsx` (one lazy panel mount), `gst-guards.ts` (one lazy check), `rt-cash-guard.ts` / `cn-muster.ts` (one lazy
  6DD(e) line each), `bank-upload.ts` (cycle adapter);
- the vendor / client form (lazy "Farmer" section), the import presets (one row);
- `tests/help-registry.test.ts`, `tests/help-glossary.test.ts`, `tests/docs-links.test.ts` (regex + `AG`),
  `tests/purchase-contract.test.ts` (A's readers).

Budget: first paint ≤ +0.02 kB (the `ag` key only); total ≤ 11 kB gz.

### AG-B — Dairy and milk collection (B1–B5)

Owned (new): `src/lib/agri/ag-{rate-chart,shifts,analyser,milk-cycle,dispatch,milk-reco,dairy-products,milk-cards}.ts`;
`src/components/agri/{DairyDesk,RateChartsView,CollectionView,CollectionEntry,MilkBillsView,DispatchView,ProductsView,
MilkCardsView}.tsx`; `src/i18n/areas/agri-r12b.ts`; tests `ag-rate-chart`, `ag-shifts`, `ag-analyser`, `ag-milk-cycle`,
`ag-dispatch`, `ag-milk-cards`, `ag-dairy-products`.

Owned (edit): the purchase stock reader (one guarded line: skip lines of a purchase with `ag.stock_by_shift`), the device
settings panel (one lazy analyser row).

Shared (§6): rules (`// AG-B`), types (`// AG-B`), registry block, demo block, `ag` snapshot sub-object `milk`.

Budget: total ≤ 8 kB gz.

### AG-C — Mills (C1–C5)

Owned (new): `src/lib/agri/ag-{weighbridge,mill-bom,yield,cmr,packing,mill-reports}.ts`; `src/components/agri/{MillDesk,
IntakeView,MillBatchesView,YieldPanel,CmrView,YieldView}.tsx`; `src/i18n/areas/agri-r12c.ts`; tests `ag-weighbridge`,
`ag-yield`, `ag-cmr`, `ag-packing`, `ag-mill-reports`.

Owned (edit): the production-order screen (one lazy panel mount), the item form (one lazy pack-size row),
`tr-stock-statement.ts` (one preset).

Shared (§6): `job-work.ts` (read-only use; one exported helper if needed, reviewed by the lead), rules, types, registry,
demo, help, `ag` sub-object `cmr`.

Budget: total ≤ 7 kB gz.

### AG-D — Cold storage, input dealers, FPO / co-operative (D1–D5)

Owned (new): `src/lib/agri/ag-{cold-lots,gatepass,cold-rent,loans,licences,subsidy,season-credit,members,patronage,
coop-papers}.ts`; `src/components/agri/{ColdDesk,LotsView,GatePassView,ChambersView,RentView,LoansView,InputsDesk,
LicencesView,SubsidyView,SeasonCreditView,MembersDesk,ShareRegisterView,PatronageView,PapersView}.tsx`;
`src/i18n/areas/agri-r12d.ts`; tests `ag-cold-lots`, `ag-cold-rent`, `ag-loans`, `ag-inputs`, `ag-members`.

Owned (edit): the POS line extras (one lazy PoS field), the expiry gate (one lazy class lookup), `tr-interest.ts` (season
due date branch), the compliance desk calendar source (one lazy group).

Shared (§6): rules, types, registry, demo, help, `ag` sub-objects `rent`, `inputs`.

Budget: total ≤ 9 kB gz.

**Combined:** first paint ≤ +0.02 kB (≈ 0); total JS ≤ +35 kB (no budget raise). Each package runs `npm run typecheck`,
`npm run lint`, `npm test`, `npm run build` and `npm run check:size` on its branch and again after rebase.

---

## 6. Shared-file protocol

| File | Who | Rule |
|---|---|---|
| `src/types/agri-r12.ts` | A creates | One `declare module` block per package, marked `// AG-A` … `// AG-D`. A declares, for every package in one commit: the record key `ag?: AgSnapshot` with sub-objects `milk` (B), `cmr` (C), `rent` and `inputs` (D), `voucher` / `cycle` (A); settings `agri_kind`, `mill_kind`, `agri_settings`; `Vendor.ag`, `Client.ag`; item `ag_class`, `ag_pack_kg`, `ag_labelled`, `ag_subsidised`; `PurchaseRecord.ag`. C: `ProductionOrder.ag.mill`. Packages fill only their own block. |
| `src/store/invoice-defaults.ts` | A | **One edit**: `export const R12_RECORD_KEYS = ['ag'] as const;` and the token in the existing R8 / R9 spread. Nothing else; no line key. |
| `src/lib/agri-rules.ts` | A creates | Sections `// AG-A` `AGRI_CLASS_RULES` (every class row with `from`, `rate`, `hsn`, `source`, `verified`), `RULE_6DDE_RULES`, `PACKED_25KG_RULES`; `// AG-B` `MILK_DEFAULTS` (CLR 28 / 30, tolerance 0.5% kg fat — "practice"); `// AG-C` `OUTTURN_STANDARDS` (CMR 67 / 68 — "agency norm, CAG 2015"), `MILLING_PDS_RULES` (25% test, Circular 153); `// AG-D` `STORAGE_CLASS_RULES`, `FERT_SUBSIDY_DEFAULTS` (50 bags / month — "reported"), `COOP_DEDUCTION_RULES` (80P → Sec 149 by date), `PRODUCER_COMPANY_RULES` (80PA window AY 2019-20 … 2024-25; a 2025-04-01 row "none found — verify"). Every row carries `source` and `verified`. Imported only by lazy modules (`tests/ag-rules.test.ts`). |
| `src/lib/trading-rules.ts` | — | **Not edited.** RCM notified goods, 194Q and TCS stay there; agri code imports them read-only. |
| `src/lib/agri/ag-registry.ts` | A creates | `AG_TABLE_ACTIONS` / `AG_WATCHED`, one block per package — A: `agri_settings`, `farm_batches`, `quality_cut_tables`, `farmer_cycles`; B: `milk_rate_charts`, `milk_shifts`, `milk_dispatches`, `milk_cards`; C: `weighbridge_slips`, `cmr_agreements`; D: `cold_lots`, `cold_rent_plans`, `agri_loans`, `member_shares`. `tests/ag-registry.test.ts` pins both maps and the importers (`sync-engine.ts`, `trust/recycle-bin.ts`, added by A). |
| `src/lib/backup.ts`, `sync-engine.ts` (`DATED`, `NUMBERED`), `trust/open-export-schema.ts` | each its own rows | Append-only blocks `// R12-A` … `// R12-D`; conflicts with Round 10 blocks resolved by keeping both. |
| `src/components/templates/TemplateEngine.tsx` | A | Two lazy imports + mounts, each guarded by `ag` presence: `AgriBlock` (after `PartyPanel`; before `GstBody`; never on `receipt` unless `ag.kind === 'inputs'`) and `AgriStatementPage` (following page, after the annexure and the R11 pages). B / C / D add only their sub-object renderers inside A's parts (one `switch` arm each, in their own files `parts/agri/*.tsx` imported lazily by `AgriBlock`). |
| `paper-helpers.ts` | A | `agriLineText` call inside `trackingText`, `agriDeclaration`; appended after Round 10 / 11 helpers. |
| `src/lib/industry-packs.ts` | A | Six ids; `PACK_TABS` block `// R12` (every desk and view). Appended after Round 10's block. |
| `src/pages/page-tabs.ts`, `src/pages/Inventory.tsx` | A | `INVENTORY_PACK_TABS` rows `farm`, `dairy`, `mill`, `cold`, `inputs`, `members` after R9's rows; one lazy mount per desk. Packages never edit them. |
| `src/lib/shop-presets.ts`, `checklist-steps.ts`, `features-catalog.ts`, `SetupWizard.tsx`, `FeaturesPanel.tsx` | A | Appended blocks `// R12`, after Round 10 / 11 blocks. |
| `src/lib/gst-guards.ts`, `bill-guard.ts` | A (C uses A's hook) | One lazy class-rate check (`ag_class`); C's packing rule plugs into the same check (no second edit). |
| `src/lib/retail/rt-cash-guard.ts`, `src/lib/construction/cn-muster.ts` | A | One lazy guarded line each calling `ag-cash.ts` (Rule 6DD(e)). |
| `src/lib/bank-upload.ts` | A | One adapter (cycle → rows); presets and formats unchanged. |
| Purchase stock reader (`events-*` / inventory purchase events) | B | One guarded line: skip lines of a purchase with `ag.stock_by_shift === true`. `tests/inventory*.test.ts` must pass unchanged. |
| `src/lib/job-work.ts` | C (read) | No edit planned; if C needs an exported helper, one export, reviewed by the lead. |
| `src/lib/trade/tr-stock-statement.ts`, `tr-interest.ts` | C / D | C: one preset; D: season due date branch. Existing `tests/tr-*.test.ts` must pass unchanged. |
| `src/lib/help/topics-*.ts`, `glossary.ts`, `src/i18n/areas/discover-r6-tabs.ts` | A | A writes every R12 topic and Ctrl+K title in one `// R12` block per file using this PRD's view ids; packages correct their rows after rebase if wording changes. |
| `src/lib/demo/profile-agri.ts` | A creates | Dispatcher by `agri_kind`; one block per package. |
| `tests/purchase-contract.test.ts` | A, B, C, D | Each appends its reader modules. |
| `tests/e2e/smoke.mjs` | A, B, C, D | One appended `step(...)` block each, in merge order, after Round 10. |
| `docs/features/agri-r12.md` | A creates | One section per package; each records its bundle numbers there. |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md` | lead | After merge: the Round 12 section; table rows; settings keys; the `agri-rules.ts` note; "Round 12 invoice snapshots live under the record key `ag`"; "every module that writes a Round 12 table must `import './ag-registry'`"; "farmer set-offs reuse `exchange_purchase_id`, never a new no-cash marker"; "cold-storage lots are custody only, never stock"; "milk shifts are one row per centre per shift"; device-local key `mrchartist_milk_analyser`. |
| `docs/CA_REVIEW.md` | lead | AG items are added with this PRD; packages report changes as rows in their feature-doc section. |
| Round 10 overlap | lead | Expected shared files: `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`, `SetupWizard.tsx`, `FeaturesPanel.tsx`, `page-tabs.ts`, `invoice-defaults.ts` (Round 10 adds its own keys), `backup.ts` / `sync-engine.ts` / open-export rows, help files, `smoke.mjs`, `paper-helpers.ts`, `TemplateEngine.tsx`, `CA_REVIEW.md`. All edits are append-only blocks or single lazy lines; the second to merge keeps both. |

### Storage summary

| Key / field | Package | Kind | Backed up | Synced | Audited | Right (`ag-registry`) |
|---|---|---|---|---|---|---|
| `agri_settings` (centres, cycles, chambers, licences, principals, seasons, switches) | A (sub-fields B–D) | object | yes | yes (singleton) | yes | `settings.manage` |
| `farm_batches` | A | table, dated `start` | yes | yes | yes | `doc.create` |
| `quality_cut_tables` | A | table | yes | yes | yes | `master.edit` |
| `farmer_cycles` (`CYB`) | A | table, dated, numbered | yes | yes | yes | `doc.create` (close / pay: `books.edit`) |
| `milk_rate_charts` | B | table, dated `effective_from` | yes | yes | yes | `master.edit` |
| `milk_shifts` | B | table, dated (one row per centre per shift) | yes | yes | yes | `doc.create` |
| `milk_dispatches` (`MDS`) | B | table, dated, numbered | yes | yes | yes | `doc.create` |
| `milk_cards` | B | table (customer × month) | yes | yes | yes | `doc.create` |
| `weighbridge_slips` (`WBS`) | C | table, dated, numbered | yes | yes | yes | `doc.create` |
| `cmr_agreements` (`CMR` on deliveries) | C | table | yes | yes | yes | `doc.create` |
| `cold_lots` (`CSR`, `GPO` on outs) | D | table, dated `date_in`, numbered | yes | yes | yes | `doc.create` |
| `cold_rent_plans` | D | table | yes | yes | yes | `master.edit` |
| `agri_loans` (`LAS`) | D | table, dated, numbered | yes | yes | yes | `books.edit` |
| `member_shares` (`SHC` on certificates) | D | table, dated | yes | yes | yes | `books.edit` |
| settings `agri_kind`, `mill_kind` | A | additive | yes | yes | yes | — |
| record key `ag` (sub-objects `voucher`, `cycle`, `milk`, `cmr`, `rent`, `inputs`) | A (sub-fields B–D) | additive record key (one first-paint token) | yes | yes | yes | — |
| `Vendor.ag`, `Client.ag`; item `ag_class`, `ag_pack_kg`, `ag_labelled`, `ag_subsidised`; `PurchaseRecord.ag`; `ProductionOrder.ag.mill` | A / A / A / C / D / A / C | additive | yes | yes | yes | — |
| Device-local `mrchartist_milk_analyser` | B | device key (analyser profile) | no | no | no | — |
| Accounts by name: "Milk purchases", "Milk producers — <centre>" (pooled vendor), "Farmers — <cluster>", "Farmer advances", "Price difference to members", "Share application money — members", "Share capital — members", "Loans to depositors", "Interest on loans to depositors", "Storage rent", "Agricultural income (exempt)", "Market fee", "Rural development fee" | A / B / D | created on first use | — | — | — | — |

No migration (everything is additive). Personal data (farmer bank details, Aadhaar last four, KCC) stays on the device
and in the user's own backups.

---

## 7. E2E steps (production build, `tests/e2e/smoke.mjs`)

1. **R12-A**:
   - Fresh company → wizard → "Farm, dairy & food processing" → *Mill* (rice) + registered → lands on
     `/inventory?tab=mill&view=intake`; Inventory shows the Farm and Mill desks only.
   - Add a farmer (code F-0001, Aadhaar field refuses 5 digits); make an FPV voucher with 52 bags, moisture 19% on a 17%
     norm → the cut row and the "Purchased from an agriculturist — exempt" declaration print; GSTR-3B Table 5 shows the
     value.
   - Pay the farmer ₹15,000 in cash → no 40A(3) warning, the 6DD(e) note shows.
   - A plain (non-agri) invoice preview is unchanged (snapshot compare). Ctrl+K "farmers" finds the view; F1 opens help.
2. **R12-B**: Settings → profile *Dairy*:
   - Load a 3 × 3 cow chart; enter a morning shift for 3 farmers (one rejected) → close; slip prints fat / SNF.
   - Make bills 1–10 → one CYB purchase; one farmer's feed invoice set off; the cash book shows only the cash paid; the
     NEFT file has 2 rows; the farmer's bill page shows the shift table.
   - Dispatch 40 L to a union, bill it → bill of supply with kg fat / kg SNF; reconciliation shows the shortage.
3. **R12-C**: *Mill*:
   - Weighbridge slip gross / tare → voucher; production order of 100 qtl → yield panel shows outturn vs 67%.
   - CMR agreement 50 qtl → rice due 33.5 qtl; one delivery; milling-charges invoice with goods 20% → exempt suggestion;
     with goods 30% → 5%.
   - Sale of a 25 kg labelled bag (5%) and a 50 kg bag (nil) on one bill → invoice-cum-bill of supply.
4. **R12-D**: *Cold storage*:
   - Lot of 240 bags, rent ₹180 / bag-season; loan ₹50,000 against it → gate pass for 60 bags refused; repay → pass
     allowed; rent bill for 60 bags is a bill of supply with the lot block.
   - Profile *Inputs*: licence expiring in 30 days → bell; urea sale asks the PoS txn no.; credit sale due at Kharif
     harvest.
   - Profile *FPO*: allot 10 shares from application money → certificate prints; the 80PA paper for FY 2025-26 shows
     "no deduction found after AY 2024-25 — verify".

---

## 8. Open questions — with the default the builders will use

The owner asked for no questions, so each one has a default that the packages implement. A CA answer later changes a
dated rule row or a setting default, never the design.

| # | Question | Default chosen | Why |
|---|---|---|---|
| 1 | New business type or a sub-profile? | Sub-profile `agri_kind`; business type `manufacturer` (or `kirana` + `retail_kind: 'general'` for input dealers); a wizard card that is not a type. | Zero shell bytes; no other round's "Pick your kind" step fires; R8 / R9 / R11 pattern. |
| 2 | One pack or many? | Six: shared `agri` + `dairy`, `mill`, `coldstore`, `agri_inputs`, `fpo`. | A trader can turn on only `coldstore`; a kirana only `agri_inputs`. |
| 3 | Where do the screens live? | Desk tabs on `/inventory` (module route), views in `&view=`. | No `PACK_ROUTES` row; R9 precedent. |
| 4 | Invoice snapshot | One record key `ag` (≈ 10–20 B first paint); weighing reuses `wt`. | The only structured way to reprint agri particulars; budget headroom 0.3 kB. |
| 5 | Farmer = vendor or client? | Vendor when he sells to us, client when he buys or deposits; linked by `ag.code`. | Ledgers and GST readers stay unchanged. |
| 6 | 7,000 farmer bills a year | One pooled purchases row per cycle per centre; farmer split on the cycle row. | Volume; Table 5 and stock read it once. |
| 7 | Milk stock | Posted per closed shift into the centre godown; the cycle purchase's lines are skipped by the stock reader (`ag.stock_by_shift`). | Dispatches are daily; the cycle closes every 10 days. |
| 8 | Feed / input set-off from milk money | Receipt with the existing `exchange_purchase_id` + one set-off journal per cycle. | No new no-cash marker; cash readers unchanged. |
| 9 | Rate chart basis | Matrix (nearest lower step) by default; two-axis, kg-fat, TS-kg and flat available. | Covers union and society practice. |
| 10 | Cash to farmers | No 40A(3) warning to agriculturists and pooled farmer cycles (Rule 6DD(e)); keep the warning for companies / traders. | Rule 6DD(e); Mad HC narrow reading (AG14). |
| 11 | Agri tax rates | Class suggestions by date in `agri-rules.ts`, `verified: false` on every 22 Sep 2025 row until AG4; typed rate wins. | Notifications not read this round. |
| 12 | Ghee / butter / condensed milk old rate | Old row 12% (PTI, Taxscan), new 5% from 2025-09-22; the conflicting 18% (Tally) noted in the row's source. | Two of three sources. |
| 13 | Broken rice, oil cake | Broken rice: loose nil / packed 5% like cereals (class pair), note the AAR; oil cake: feed nil, other 5% with an end-use choice. | AG6. |
| 14 | Pre-packaged ≤ 25 kg | Packed class when labelled and ≤ 25 kg / 25 L; loose otherwise; counter sales from a large bag are loose. | N 6/2022 + FinMin FAQ (AG5). |
| 15 | Mandi fee | Charge heads with no preset rate; reported examples in help only. | State-specific and conflicting (AG20). |
| 16 | Quality cuts | No preset values; per-commodity tables typed by the user. | Contract / agency terms. |
| 17 | CMR outturn | 67% raw, 68% parboiled, editable per agreement. | CAG 2015 (agency norm). |
| 18 | Milling for PDS | Exempt when goods ≤ 25% of value, else 5% (job work to a registered person); the test is shown, the user decides. | Circular 153/09/2021 (AG9). |
| 19 | Job milling for an unregistered farmer | No suggestion beyond "verify" (typed rate). | AG10 (L). |
| 20 | Cold-storage rent | Agri produce storage nil; non-agri 18%; whole-chamber space rent 18% by default with a note. | Entry 54(e); conflicting AARs (AG8). |
| 21 | Handling charges | Follow the storage class (composite) by default; "own rate" option. | AG8. |
| 22 | Cold-storage lots | Custody only, never stock. | The goods are the depositor's. |
| 23 | Warehouse receipts | Printed as non-negotiable receipts; never called an e-NWR. | WDRA r.27: e-NWR only via repositories (AG23). |
| 24 | Loans against lots | Simple interest by days; interest-first allocation; lien blocks the gate pass unless overridden with a reason. | Practice; AG24. |
| 25 | Subsidised fertiliser | PoS txn no. + farmer ID last 4 required for flagged items; 50 bags / month warning; MRP guard `block`. | Reported practice (AG22). |
| 26 | Licences | Warn on expiry and on unlicensed classes; never block a sale for a licence. | Owner's call; the law punishes, the app reminds. |
| 27 | Expiry | Block sale after expiry for pesticides and seeds; warn for fertilisers. | Insecticides Rules (recalled, AG21). |
| 28 | Credit till harvest | Season due dates; interest from the due date through the existing interest notes. | Dealer practice. |
| 29 | Members' capital | Application money → allotment journal; certificates numbered; transfers keep totals. | Producer company / co-op practice (AG18, AG19). |
| 30 | Price difference vs patronage | Default "price difference" (purchase cost); "patronage" posts to appropriation; both drafts. | AG25. |
| 31 | 80PA after AY 2024-25 | No deduction computed; the paper says "none found — verify". | No extension found (AG17). |
| 32 | 80P under the 2025 Act | Labelled Sec 149 from 1 Apr 2026 (as reported); figures by head. | AG16. |
| 33 | Agricultural income | Ledger "Agricultural income (exempt)" for own cultivation only; help says mills / dairies / cold stores / poultry / fishery are business income. | AG15. |
| 34 | Poultry / fishery | Batches with FCR and mortality memo on a cost centre; no new posting. | Light, reuses cost centres. |
| 35 | Devices | Plain ASCII over Web Serial (scale, analyser, weighbridge indicator); typing always works. | Local-first; no proprietary protocols. |
| 36 | Budget | Stay inside +35 kB; no raise proposed (real headroom ≈ 108 kB in the script's KiB, ≈ 63 kB after Round 10). | First paint is the hard limit; total is precache. |
