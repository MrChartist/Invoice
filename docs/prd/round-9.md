# PRD — Round 9: retail shops (kirana / supermarket, pharmacy, apparel, electronics and mobiles, jewellery)

Status: draft for build · Drafted 2026-10-26 · Baseline: branch `claude/elegant-cannon-cwapiv` at `1d06bd2`. Merged on
the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–7, Round 8 (TR-A, TR-B, TR-C) and R7-A (hotel front office). R7-B /
R7-C (hotel folio and compliance) may still be in flight; §5 and §6 say how this round shares files and budgets with
them.

Companion documents:
- `docs/CA_REVIEW.md` §9 — the retail CA items **RT1–RT22**, added with this PRD.
- Raw research (URLs and the claim taken from each; P = primary, S = secondary):
  `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/r9/round9-sources.md`.

Every item follows `AGENTS.md`:
- local-first and serverless: no CEIR / BIS / NPPA / financier / GST portal calls; files and `wa.me` links only;
- vanilla CSS Modules with tokens;
- invoice snapshots never change: new line and record fields are snapshots that the templates read from the record;
- Indian-FY numbering for every new series;
- bare dates parsed as local days;
- statutory values date-keyed and append-only, in a rule file kept out of first paint;
- GST, Drugs-Rules, Legal Metrology and hallmarking outputs labelled as working papers ("verify with your CA").

---

## 1. Problem statement

Retail counters are the app's largest audience by count. The 8H `kirana` business type covers this group, and the counter is already
deep: POS with scan / quantity prefix / short codes, weighing-scale labels and live weight, held bills, split tenders,
shifts, X / Z reports, customer display, returns and exchange, loyalty with tiers, gift vouchers, offers, store price
lists, khata reminders, batches / FEFO / expiry, serial / IMEI with warranty, variants generation, a pharma pack with
Schedule H / H1 / X flags and an H1 register, expiry claims, salt search. §2.3 checks **57 rows; 30 are existing
features, with file paths**. Each vertical still has its own gaps, and they block it every day:

1. **Every shop**
   - The "do not sell above MRP" check (Legal Metrology Rule 18(2)) exists only inside the pharma pack.
   - When GST falls (22 Sep 2025), old-MRP stock must be sold at a lower price, and nothing helps.
   - There is no home-delivery / phone-order desk with rider cash (COD) settlement.
   - A supplier bill's **free quantity** ("10 + 1") and line discount cannot be entered.
   - There is no short book of items customers asked for that were out of stock.
2. **Pharmacy (chemist)**
   - The prescription can be entered only in the editor, not at the POS counter where chemists bill.
   - There are no doctor master, doctor-wise sales, repeat-prescription (refill) reminders or Schedule X / narcotic
     register book.
   - There are no drug-licence / pharmacist details with renewal alerts.
   - There is no NPPA ceiling-price check, and no per-tablet price from a strip MRP.
3. **Apparel, footwear, textiles**
   - GST depends on the **sale value per piece**: from 22 Sep 2025, ≤ ₹2,500 → 5%, above → 18%. A discount can move a
     piece between slabs. The app has one rate per item.
   - Variants can be generated, but there is no size × colour **matrix entry** on bills / POs and no matrix stock view.
   - There are no alteration slips.
4. **Electronics and mobiles**
   - The POS cannot find a phone by scanning its **IMEI**, and has no dual-IMEI pairs.
   - There is no EMI / consumer-finance sale: down payment, loan amount due from the financier, DO number, subvention.
   - There is no exchange / buy-back of the customer's old phone, and no second-hand resale (margin scheme).
   - There are no repair job sheets or warranty claims.
5. **Jewellery**
   - Nothing yet: no daily metal rate by purity and no tagged pieces with gross / stone / net weight and HUID.
   - There is no jewellery bill line (net weight × rate + wastage + making + stones + hallmarking, at 3%).
   - There is no old-gold purchase / exchange with purity and melting loss.
   - There are no cash (Sec 269ST) / PAN (Rule 114B) guards and no karigar metal account.
6. **Setup**
   - "Kirana / retail" is one business type: a chemist, a boutique, a mobile shop and a jeweller get the same screens.

**Goal of Round 9:** ship **18 items in five work packages**, one per vertical, each with mostly disjoint files:
- **RT-A**: the retail profile and shared retail pieces (kirana / supermarket), 4 items;
- **RT-B**: pharmacy, 3 items;
- **RT-C**: apparel, footwear and textiles, 3 items;
- **RT-D**: electronics and mobiles, 4 items;
- **RT-E**: jewellery, 4 items (including the karigar account).

### How the retail profile switches on (no clutter for others)

- The business type stays **`kirana`** (`shop-mode.ts`, label "Kirana / retail shop"), so no new `BusinessType` and no
  shell bytes. The setup wizard and Settings → Features gain a **shop picker** when `kirana` is chosen:
  - *Grocery / supermarket*;
  - *Medical store / pharmacy*;
  - *Garments / footwear / textiles*;
  - *Electronics / mobiles*;
  - *Jewellery*;
  - *Other retail*.

  The choice is stored as the additive settings field `retail_kind` (the Round 8 `trade_kind` approach). It sets
  `modules` and an explicit `industry_packs` list (§4 RT-A1).
- **Four new packs** in `industry-packs.ts`: `pharmacy`, `apparel`, `electronics` and `jewellery`. Grocery needs no pack:
  its tools are generic. A pack adds **one tab on the existing `/inventory` route** (with `&view=` sub-views, the hotel
  pattern) plus fields in existing dialogs. It never adds a route or a sidebar item. Every retail profile keeps the
  `inventory` module, so **`PACK_ROUTES` (shell) is not changed**.
- `PACK_OF_TYPE` is **not** changed: `kirana` implies no pack, so every existing kirana company sees exactly what it saw.
  Instead it gets a one-time setup-checklist step "Pick your shop" (RT-A1). The existing pharma pack switch
  (`pharma_settings.enabled`, 7U) keeps working without the new pack; the profile turns on both.
- Tools that help every retailer (MRP guard, GST-cut MRP pricing, deliveries, purchase free quantity, short book, cash /
  PAN guard) are **not** pack-gated. They are opt-in settings or new tabs on existing screens.

### Budgets the packages must respect

Measured on `1d06bd2` (`npm run build && npm run check:size`), as reported by the lead:

| Budget | Now | Limit | Headroom | Shared with |
|---|---|---|---|---|
| Initial JS (first paint, gz) | **184.6 kB** | 185 kB | 0.4 kB | R7-B / R7-C |
| Entry chunk (gz) | — | 90 kB | — | |
| Total JS (gz) | **≈2649 kB** | 2800 kB | ≈151 kB | R7-B / R7-C |

Rules:
- **First paint: Round 9 = 0 bytes by design**, with ≤ +0.1 kB allowed only for the one new receipt marker in
  `no-cash.ts` (RT-A). That file is imported through `advance-tax.ts`; if it is in the first-paint graph, the marker costs
  about 40 B. No `PACK_ROUTES`, `TABLE_ACTIONS`, `WATCHED_TABLES` or shell edit. Table rights and audit labels register
  at runtime (`src/lib/retail/rt-registry.ts`, the `tr-registry.ts` / `hotel-registry.ts` pattern).
- **Total JS for the round ≤ +60 kB gz**: RT-A ≤ 12 kB, RT-B ≤ 10 kB, RT-C ≤ 10 kB, RT-D ≤ 13 kB, RT-E ≤ 15 kB. That
  leaves ≥ 90 kB for R7-B / R7-C.
- **Everything is lazy.** No new route. Each pack desk is one lazy chunk (all its views, its engine and its en + hi
  strings), mounted by `Inventory.tsx` from a lazy import. Editor, POS and bill-modal parts are lazy sub-rows, mounted only
  when their pack or setting is on.
- **Rule data is a chunk.** `src/lib/retail-rules.ts` is imported only by lazy screens and engines, never by
  `tax-rules.ts`, `shop-mode.ts` or the shell. `tests/rt-rules.test.ts` checks the import graph.
- **Help text is data.** Topics go in the existing lazy topic files (`topics-packs.ts`, `topics-sales.ts`,
  `topics-purchase.ts`, `topics-statutory.ts`); glossary terms go in `glossary.ts`.
- **Icons: reuse only.** Already imported and suggested:
  - RT-A `Store`, `Truck`, `Tags`, `ClipboardList`, `Percent`;
  - RT-B `ShieldAlert`, `Users`, `CalendarClock` (if absent use `Calendar`), `FileSpreadsheet`;
  - RT-C `Boxes`, `Scissors` (if absent use `Package`), `Percent`;
  - RT-D `Smartphone` (if absent use `ScanLine` / `Package`), `HandCoins`, `Wrench` (if absent use `Settings`),
    `RefreshCw`;
  - RT-E `Scale`, `Gem` (if absent use `Tags`), `Landmark`, `Calculator`.

  Each package greps `lucide-react` imports before using a name; a new icon name fails review.
- **If the round needs more than 60 kB:** each package builds inside its share first, and reports its overrun with a
  breakdown in its feature doc, as R7-A and R8 did. The lead may raise `BUDGET_TOTAL_GZ_KB` from 2800 to 2900 in one
  commit, recording the reason in `scripts/check-bundle-size.mjs`. The justification prepared here:
  - total JS is the one-time offline precache, not first paint;
  - five verticals land in one round (Round 8 used ≈ 88 kB for three packages);
  - every pack chunk downloads only into the precache, and runs only for companies with that pack.

  The default is **not** to raise it.
- Each package records before / after numbers in its feature doc.

### Non-goals

These need a server, the network, a regulator portal or a licence the app cannot hold:
- CEIR / blocked-IMEI database lookups. The app keeps a **check log** only; the user checks on the government portal.
- BIS HUID verification (BIS CARE app) and NPPA price database download. Ceiling prices are typed or imported from CSV.
- financier (Bajaj Finserv, HDFC, TVS Credit …) DO integration and card-terminal EMI integration;
- e-pharmacy / online orders, Swiggy-Instamart-style aggregators, home-delivery rider GPS;
- **gold saving / installment schemes** (deposit rules under the Companies Act and the BUDS Act need a legal review
  first). Customers' installments can be taken as ordinary advances today. Planned later.
- **girvi / gold loans** (needs a money-lending licence; a different business);
- jewellery manufacturing (casting / melting process costing) beyond karigar issue and receipt; RFID tag readers;
- apparel style / season planning, open-to-buy, and franchise / consignment billing (SOR) for brand outlets.

---

## 2. Findings

### 2.1 What shopkeepers use and praise / complain about (research)

P = vendor's own documentation or official text; S = secondary (reseller, review site, blog). Full list in
`round9-sources.md`.

| Vertical | Tools they use | Praised for | Complaints / gaps | Source |
|---|---|---|---|---|
| Pharmacy | Marg ERP, RetailGraph, GoFrugal, Vyapar / myBillBook (small chemists) | Marg: expiry alerts, prescription capture, payment-due alerts, salt / substitute search, breakage-expiry with suppliers | Marg: support passed between Marg and partners, costly renewals, dated UI (Capterra / Software Advice 3.2 / 5, ~39% negative). Mobile apps: no H1 register, no batch-wise MRP | S Trustpilot, Capterra, Software Advice |
| Kirana / supermarket | GoFrugal, Marg, Vyapar, myBillBook, Khatabook, Petpooja-style retail POS | Fast counter, barcode + scale, khata, WhatsApp bill | No offline (myBillBook), partial payments hard, deleted items unrecoverable (Round 8 research); home delivery tracked on paper | S reviews (round8-sources) |
| Apparel / footwear | Ginesys, Logic ERP, GoFrugal, Marg (garments edition) | Ginesys: style-size-colour in the core, barcodes carrying size / colour / brand; GoFrugal: POS, barcodes, variants, loyalty | Marg: flat SKUs, so variants need workarounds (vendor S); alteration slips only in requirement lists | S ginesys.in blogs (vendor), freelancer listing |
| Electronics / mobiles | myBillBook, GoFrugal electronics, Sleekbill, Vyapar | IMEI on the bill, warranty, accessory bundles, EMI as a tender, exchanges | No offline tool found with financier DO / subvention tracking; second-hand margin scheme flagged as a GST risk | S mybillbook, gofrugal, sleekbill, accountune comparison |
| Jewellery | Tally (jewellery solutions), myBillBook jewellery format, JewelBook / Gold-book-style desktop tools, Synergics ERP | Gross / net / stone weight, purity, making as fixed / % / per gram, wastage, HUID, tag no., old gold adjusted on the sale bill, karigar metal issue / receipt | Generic billing apps cannot hold weights and purity per piece; schemes / girvi live in separate registers | S tallysolutions.com, mybillbook guides |

**What carries over to an offline app:**
- **Pharmacy**: prescription capture and registers from our own sales; doctor and refill masters; ceiling-price checks
  on typed data.
- **Apparel**: price-band GST as pure maths on the line; matrix entry over the existing variant children; alteration
  slips.
- **Electronics**: IMEI lookup from our own stock engine; finance and buy-back as receivable / purchase records; repair
  job sheets.
- **Jewellery**: a dated rate board; tags as serial-tracked pieces with weights; the jewellery line maths; old gold as a
  purchase settled against the sale; a fine-weight karigar account.
- **Every shop**: MRP and cash guards from our own documents.

Offline billing, the recycle bin and full audit are already our edge over the mobile apps.

### 2.2 Statutory rules by vertical (as understood; every row is a CA item)

Confidence: **H** = statute / official text read or long settled; **M** = consistent secondary sources; **L** = sources
conflict or nothing found.

| Rule | What applies | App today | Source | Confidence |
|---|---|---|---|---|
| Legal Metrology: sale above MRP | No retail dealer may sell a packaged commodity above its retail sale price (MRP, inclusive of all taxes): Rule 18(2), Legal Metrology (Packaged Commodities) Rules 2011; penalty Sec 36, LM Act 2009; compounding Rule 32 | Only as the pharma option `block_above_mrp` (`saleLimitGate`) | S casemine / scconline; P Lok Sabha reply (fcainfoweb) | H → RT4 |
| Pricing old-MRP stock after a GST cut | After 22 Sep 2025 manufacturers revised MRPs; stock already printed at the old MRP should pass the cut on (sell at MRP × (100 + new) / (100 + old)); DoCA / NPPA advisories allowed stickers / price lists | **Missing** | S EY alert, Novo Nordisk notice | M → RT4 |
| Apparel / footwear GST by price | From 22 Sep 2025 (N 9/2025-CT(R)): garments and made-ups ≤ ₹2,500 per piece 5%, above 18%; footwear ≤ ₹2,500 per pair 5%, above 18%. Before: apparel ≤ ₹1,000 5% / 12%; footwear ≤ ₹500 (≤ ₹1,000 from 27 Jul 2018) 5% / 18%. **Per piece**, on the transaction value | **Missing** (one rate per item; HSN master has dated rates but no value bands) | S accountune, bata.com, leatherindia; earlier rows from memory (unverified) | M (2025 rows), L (2018 footwear row) → RT1, RT2 |
| Medicines GST | From 22 Sep 2025 most medicines 12% → 5%; 33 life-saving drugs 12% → nil; 3 drugs 5% → nil | Rates are user-entered in the HSN master (`hsn-master.ts`, dated); the app ships no schedule | S EY, Lakshmikumaran | M (the app keeps "you enter rates") → RT9 |
| Drugs & Cosmetics Rules 1945, Rule 65 (retail sale) | Schedule H / H1 / X sold only on a registered medical practitioner's prescription. **H1 register**: prescriber name and address, patient, drug, quantity, kept **3 years**. **Schedule X**: licence 20F / 21G, prescription retained (2 years per secondary), separate record. Cash memos kept 3 years. Draft amendment Sep 2026 (CCTV) not law | H1 register exists (`pharma.ts`), X optional in the same CSV; no X book, no retention dates, no prescription at the POS | S okcredit guide, Kohima district order, gktoday (draft) | M → RT7 |
| NPPA ceiling price (DPCO 2013) | Scheduled formulations may not exceed the notified ceiling price + applicable GST; non-scheduled MRP increases capped at 10% a year | **Missing** | Developers' reading of DPCO 2013 (not re-read) | L–M → RT8 |
| Jewellery GST | HSN 7113 (and 7108 bullion, 7114 / 7116): 3% (1.5% + 1.5%) on the **whole** value, including making charges shown separately (CBIC FAQ on gems & jewellery, state copy). 5% applies to **job work** on the customer's / principal's metal (SAC 9988), not to making charges on a retail sale | **Missing** (no jewellery line) | P/S WB comtax FAQ copy (fetch failed, quoted by londejewellers, bluestone); conflicting blogs (cleartax, mastersindia) | M–H → RT16 |
| Old gold from customers | A private individual selling old jewellery is not supplying in the course of business, so no GST. Sec 9(4) RCM since 1 Feb 2019 covers only notified classes, so no RCM. **Exchange**: sources conflict on GST on the full value of the new piece (barter, value includes the old gold's value) vs. on the net | **Missing** | S londejewellers (CBIC press release 13 Jul 2017 as quoted), avivaindia (net) | L → RT17 |
| Hallmarking (BIS) | Gold jewellery hallmarking with a 6-character **HUID** mandatory since 1 Apr 2023 in notified districts (343 by Dec 2023; 9K added Jul 2025); silver voluntary from 1 Sep 2025 (IS 2112:2025, HUID when hallmarked). The **bill must show** each article's description, **net weight of precious metal, purity in carat and fineness, and hallmarking charges**, and that purity can be verified at any BIS A&H centre (Reg. 5(11), Hallmarking Regulations 2018 as cited) | **Missing** | P BIS FAQ (bis.gov.in); S lakshmisri, gjepc, indianjeweller | M → RT19 |
| Cash receipts (Sec 269ST) | No cash receipt of **₹2 lakh or more** from a person in a day, for one transaction, or for one event; penalty equal to the amount (Sec 271DA). 2025-Act section number not confirmed | **Missing** | Statute (recalled); S iifl | H (1961 Act), L (2025-Act numbering) → RT18 |
| Cash payments for purchases (Sec 40A(3)) | Expenditure paid in cash above ₹10,000 to a person in a day is disallowed (from 1 Apr 2017); relevant when the shop pays cash for old gold or a used phone | **Missing** | Statute (recalled); 2025-Act numbering not confirmed | H (1961 Act) → RT14 |
| PAN on high-value sales (Rule 114B) | PAN (or the declaration form: Form 60, Form 97 under the 2025-Act rules as reported) for a sale of goods **above ₹2 lakh** per transaction, from 1 Jan 2016, any mode of payment | Client `pan` field exists; **no prompt** | S iifl, taxmann | M → RT18 |
| 206C(1D) TCS on cash jewellery | Omitted from 1 Apr 2017 (replaced by 269ST) | Not modelled (correct) | Recalled | M → RT18 |
| PMLA: dealers in precious metals and stones | Reporting entities for cash transactions of ₹10 lakh or more (notification of 28 Dec 2020, recalled): KYC, records | **Missing** (no KYC note) | S taxmann opinion | L → RT18 |
| e-Way bill for jewellery | Rule 138(14) annexure: no e-Way bill for Chapter 71 precious metals / jewellery (recalled) | e-Way prompts by value for every bill (`eway.ts`) | Recalled | L–M → RT22 |
| Telecom: used phones | Telecommunications (Telecom Cyber Security) Amendment Rules 2025 (GSR 771(E), 22 Oct 2025): anyone dealing in used / refurbished devices checks the IMEI against the central blocked-IMEI database before resale | **Missing** | S conventuslaw, scconline | M → RT15 |
| Second-hand goods: margin scheme | Rule 32(5) CGST Rules: a dealer in used goods who takes no ITC pays GST on the margin (sale − purchase price); negative margin ignored. AAR Karnataka (Aadhya Gold, 2018) denied it where gold was melted (nature changed) | **Missing** | Rule 32(5); AAR as recalled | M → RT12 |
| Warranty replacement | Replacement parts / units under warranty: no GST and no ITC reversal (Circular 195/07/2023-GST, as understood) | Warranty months on serial lines; **no service desk** | Circular 195/07/2023 (recalled, not re-read) | M → RT13 |
| EMI / consumer finance | Sale value is the full price to the customer. The financier's subvention / processing fee charged to the dealer is the financier's own supply (18%, ITC to the dealer), not a discount on the sale (AAR Daimler FS on subvention). A no-cost-EMI discount the retailer shows on the invoice reduces the value (Sec 15(3)(a)) | **Missing** | S vinodkothari 2019 (AAR), razorpay docs | L–M → RT10 |
| Alterations / tailoring | Free alterations with a sale: part of the sale. Charged alterations: a separate service; tailoring services 5% (SAC 9988, as understood) vs. 18% | **Missing** | Developers' reading | L → RT3 |
| Free goods on purchases | Supplier's "10 + 1" free units under a scheme: GST only on the price charged; no ITC reversal for free goods received (Circular 92/11/2019, read from the supplier's side) | Purchase lines have no free quantity (reader knows `discount_percent` only) | Circular 92/11/2019 | M → RT5 |
| Composition retailer | 1% (goods), Bill of Supply, ₹1.5 crore limit; running tracker | Exists (R8-C `CompositionTracker`) | — | — |
| Weights and measures at the counter | Scales must be verified / stamped (LM Act; state rules) | Out of scope (device, not data) | — | — |

### 2.3 Verified against the code (`1d06bd2`)

Verdicts: **Exists** (done, file given), **Partial** (part done, gap named), **Missing**. Each row was checked by grep or
by reading the file; "→" names the Round 9 item that closes it.

#### Counter and pricing (every shop)

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| POS bill with scan, qty prefix, short codes, gross → rate, F-keys | Exists | `pos.ts`, `pos-keys.ts`, `scan.ts`, `pages/Pos.tsx` | — |
| Weighing-scale labels, live weight (Web Serial) | Exists | `scale-barcode.ts`, `scale-serial.ts` | — |
| Held bills, split tenders (cash / UPI / card / cheque / wallet / gift voucher / on account) | Exists | `pos-hold.ts`, `pos.ts` `tenderSummary` | No **finance** tender → RT-D2 |
| Cashier shifts, X / Z report, day close, cash tally | Exists | `pos-shifts.ts`, `ZReportModal.tsx`, `cash-tally.ts` | Rider cash in the Z report → RT-A3 |
| Customer display, WhatsApp bill, ESC/POS + drawer | Exists | `pos-display.ts`, `pos-share.ts`, `escpos.ts` | — |
| Returns / exchange at the counter | Exists | `pos-returns.ts`, `PosReturnModal.tsx` | — |
| Loyalty points, tiers, expiry | Exists | `loyalty.ts`, `retail/loyalty-tiers.ts` | — |
| Gift vouchers | Exists | `retail/gift-vouchers.ts` | — |
| Offers (bill value, buy A get B), schemes | Exists | `offers.ts`, `pricing.ts` | — |
| Price levels, MRP-less-%, dated price lists, store prices | Exists | `pricing.ts`, `price-list.ts`, `retail/store-prices.ts` | — |
| Catalogue MRP, batch MRP on bills | Exists | `InvoiceItem.mrp` (catalogue), `PurchaseLine.mrp` | — |
| Block sale above MRP | **Partial** | `pharma-gate.ts` `saleLimitGate` (pharma pack only, batch MRP only) | All retail, catalogue MRP too, warn / block → RT-A2 |
| Old-MRP pricing after a GST rate cut | **Missing** | — | RT-A2 |
| Shelf / barcode labels (MRP, price) | Exists | `label-sheet.ts`, `label-raw.ts` | Relabel queue after MRP / price change → RT-A2 |
| Khata, party balance on the bill, reminders | Exists | `khata.ts`, `khata-actions.ts` | — |
| HSN master with dated rates (22 Sep 2025 changes typed by the user) | Exists | `hsn-master.ts`, `hsn-defaults.ts` | Value-band rates → RT-C1 |
| Credit limit at the counter | Exists | `credit-policy.ts`, POS on-account check | — |
| Home delivery / phone orders, rider COD | **Missing** | restaurant tokens only (`restaurant/tables.ts`) | RT-A3 |
| Supplier bill free quantity / line discount entry | **Missing** | `PurchaseLine` has neither; `readPurchaseLines` reads `discount_percent` from imports only | RT-A4 |
| Short book (asked, not in stock) | **Missing** | `reorder.ts` works from levels only | RT-A4 |
| Composition Bill of Supply, tracker | Exists | `bill-of-supply.ts`, R8 `CompositionTracker.tsx` | — |
| `kirana` business type, counter sample data | Exists | `shop-presets.ts`, `demo/profile-counter.ts` | Shop sub-profiles → RT-A1 |

#### Pharmacy

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Drug licence numbers on the profile, printed | Exists | `SenderProfile.drug_licence`, `PaperHeader.tsx` | Validity / renewal alert, pharmacist → RT-B2 |
| Schedule H / H1 / X flag per stock item | Exists | `pharma.ts` `setDrugSchedule` | — |
| Prescription on the bill (patient, prescriber, reg. no.) | **Partial** | `InvoiceRecord.rx`, editor only (`EditorExtras.tsx`) | POS entry, doctor master, age / gender, Rx scan link → RT-B1 |
| H1 register CSV | Exists | `pharma.ts` `h1Register` | Schedule X book, retention, printable book → RT-B2 |
| Block expired / near-expiry, FEFO | Exists | `pharma-gate.ts`, `pos.ts` FEFO | — |
| Breakage / expiry issue + receive, claims | Exists | `expiry-ops.ts` | — |
| Salt / substitute search | Exists | `salt-search.ts` | — |
| Loose sale (strip → tablet) | **Partial** | alternate units (`units.ts`) | Per-tablet price from the strip MRP → RT-B3 |
| NPPA ceiling price check | **Missing** | — | RT-B3 |
| Doctor-wise sales, refill reminders | **Missing** | — | RT-B1 |
| Purchase free quantity ("scheme") | **Missing** | — | RT-A4 |

#### Apparel, footwear, textiles

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Variant generation (size × colour children, SKU, EAN) | Exists | `variants.ts` | — |
| Variant matrix entry on bills / POs / GRN / invoice | **Missing** | — | RT-C2 |
| Style × size × colour stock matrix | **Missing** | `DepthTab.tsx` lists children flat | RT-C2 |
| GST by sale value per piece | **Missing** | — | RT-C1 |
| Alteration slips | **Missing** | — | RT-C3 |
| Brand on stock items | Exists | `types/trade-r8.ts` `brand` | — |
| Sold by metre (fabric) | Exists | units / alternate units | — |

#### Electronics and mobiles

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Serial / IMEI per unit, in-stock checks, returns | Exists | `stock-tracking.ts` (6.11), `SerialPicker.tsx`, POS serial picker | — |
| Warranty months on the sale, lookup | Exists | `warrantyUntil`, `SerialLookup.tsx` | — |
| IMEI printed on the bill | Exists | `paper-helpers.ts` `trackingText` | Dual IMEI → RT-D1 |
| Scan an IMEI at the POS → item + serial | **Missing** | `scan.ts` matches barcode / SKU / short code | RT-D1 |
| IMEI check digit (Luhn) | **Missing** | Luhn only for gift vouchers | RT-D1 |
| EMI / finance sale | **Missing** | — | RT-D2 |
| Exchange / buy-back of the old device | **Missing** | — | RT-D3 |
| Second-hand resale (margin scheme) | **Missing** | — | RT-D3 |
| Repair job sheets, warranty claims to the brand | **Missing** | AMC contracts only (`amc.ts`) | RT-D4 |
| TCS 206C(1F) luxury goods (watches above ₹10 lakh) | Exists | `trading-rules.ts` `TCS_1F_RULES` | — |

#### Jewellery

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Daily metal rate by purity | **Missing** | — | RT-E1 |
| Tagged pieces with gross / stone / net weight, HUID | **Missing** (serials could carry the tag) | `track_serials` | RT-E1 |
| Jewellery bill line (net wt × rate + wastage + making + stones + hallmark) | **Missing** | — | RT-E2 |
| Old gold purchase / exchange | **Missing** | — | RT-E3 |
| Cash 269ST / PAN 114B guards | **Missing** | — | RT-E3 (generic setting) |
| Karigar issue / receipt by fine weight | **Partial** | job work to a job worker exists (`job-work.ts`, ITC-04), by quantity, not fine weight | RT-E4 |
| e-Way bill suppression for Chapter 71 | **Missing** | — | RT-E2 (one guarded rule) |

**Totals:** 57 rows checked: **30 exist** (8 with a small gap named in the last column), **4 partial**, **23 missing**.
Round 9 closes all 27 partial / missing rows and the 8 named gaps.

---

## 3. Ranked list: what to build now

Value 1–5 (5 = every shop of that kind meets it daily). Effort S = 1, M = 2, L = 3. Score = value ÷ effort.

| Rank | Id | Gap | Who needs it | Value | Effort | Score | Package |
|---|---|---|---|---|---|---|---|
| 1 | RT-A1 | Retail profile (shop picker, packs, checklist, help, Ctrl+K, sample data) | every retailer | 5 | S | 5.0 | A |
| 2 | RT-A2 | MRP guard for all retail, GST-cut MRP pricing, relabel queue | kirana, pharmacy, FMCG | 5 | S | 5.0 | A |
| 3 | RT-C1 | Price-band GST (₹2,500 per piece / pair) | every garment / footwear shop | 5 | S | 5.0 | C |
| 4 | RT-D1 | IMEI-first counter (scan IMEI, dual IMEI, Luhn, check log) | mobile shops | 5 | S | 5.0 | D |
| 5 | RT-B1 | Prescription at the POS, doctors, patients, refill reminders, doctor-wise sales | chemists | 5 | M | 2.5 | B |
| 6 | RT-E2 | Jewellery bill line and BIS bill contents | jewellers | 5 | M | 2.5 | E |
| 7 | RT-E1 | Metal rate board and tagged pieces | jewellers | 5 | M | 2.5 | E |
| 8 | RT-E3 | Old gold purchase / exchange; cash and PAN guards | jewellers (guards: all) | 5 | M | 2.5 | E |
| 9 | RT-A4 | Supplier free quantity / discount on bills; short book | chemists, kirana, FMCG | 4 | M | 2.0 | A |
| 10 | RT-C2 | Size × colour matrix entry and stock matrix | apparel, footwear | 4 | M | 2.0 | C |
| 11 | RT-D2 | EMI / finance sales | electronics, mobiles | 4 | M | 2.0 | D |
| 12 | RT-D3 | Exchange / buy-back, second-hand resale (margin scheme) | mobiles | 4 | M | 2.0 | D |
| 13 | RT-B2 | Registers (H1 / H / X / narcotic book), licences, pharmacist, retention | chemists | 4 | M | 2.0 | B |
| 14 | RT-A3 | Home delivery orders and rider cash settlement | kirana, supermarket, pharmacy | 4 | M | 2.0 | A |
| 15 | RT-B3 | Ceiling price, loose-unit pricing, PTR / PTS margin view | chemists | 3 | S | 3.0 | B |
| 16 | RT-C3 | Alteration slips | apparel | 3 | S | 3.0 | C |
| 17 | RT-D4 | Repair job sheets and warranty claims | electronics, mobiles | 3 | M | 1.5 | D |
| 18 | RT-E4 | Karigar metal account by fine weight | jewellers who make | 3 | M | 1.5 | E |
| — | — | Gold saving schemes | jewellers | 4 | L | 1.3 | later (legal review) |
| — | — | Girvi / gold loans | pawn-jewellers | 3 | L | 1.0 | no (licence) |
| — | — | Online orders / aggregator sync | kirana | 3 | L | 1.0 | no (network) |

Rows 1–18 are taken. RT-D4 and RT-E4 score
lower but are taken because without them the electronics and jewellery profiles miss the workflow their owners name first
(repairs; karigar balance). Both are scoped to the minimum.

---

## 4. Specifications (18 items)

Conventions for every item:
- **Logic and tests.** Pure logic in `src/lib/retail/rt-*.ts` (the existing R4-B folder; Round 9 files use the `rt-`
  prefix), tested with `node:test` in `tests/rt-*.test.ts`. UI checks are `step(...)` blocks in
  `tests/e2e/smoke.mjs` (§7).
- **Components** in the new folder `src/components/retail-r9/`. One desk component per pack (`PharmacyDesk.tsx`,
  `ApparelDesk.tsx`, `DevicesDesk.tsx`, `JewelleryDesk.tsx`) holds its views and is the pack's single lazy chunk.
- **Strings.** Each package has its own i18n area (`defineArea(en, hi)`): `src/i18n/areas/retail-r9a.ts` … `retail-r9e.ts`.
  Hindi uses the market's own words (दवा पर्ची, डॉक्टर, आल्टरेशन, बाय-बैक, किस्त / EMI,
  घटत / वेस्टेज, मजदूरी / मेकिंग, कारीगर, पुराना सोना, हॉलमार्क, शुद्धता); weights are in grams only (no tola).
- **Storage.** New company tables `mrchartist_inv_<table>` go through `getTable` / `setTable`. Each is registered in:
  - `backup.ts` (`RECORD_TABLES` / `ID_TABLES`);
  - the open-export schema;
  - `sync-engine.ts` `DATED` / `NUMBERED`, when dated or numbered;
  - **`src/lib/retail/rt-registry.ts`** (`RT_TABLE_ACTIONS`, `RT_WATCHED`), registered at runtime, never in first-paint
    `access.ts` / `audit-edits.ts`. Every writer module and the two all-table lazy writers (`sync-engine.ts`,
    `trust/recycle-bin.ts`) import it for its side effect.

  Each table gets one row in `docs/ARCHITECTURE.md` (lead). New `InvoiceRecord` keys go into `RECORD_KEYS` /
  `normalizeRecord`, and new line keys into `normalizeItem` (`src/store/invoice-defaults.ts`; owner RT-A, §6). Additive
  record fields come by declaration merging in `src/types/retail-r9.ts`: one file, with one `declare module` block per
  package.
- **Numbers.** New series go through `series-counters.ts` (`nextSeriesNumberFor` + `recordSeries`) as
  `XXX/FY<yy-yy>/<seq>`, never reused after a delete: `URD` (self-made purchase voucher for goods bought from an
  unregistered person: old gold, used devices; owner A, used by D and E), `ALT` (alterations), `SVC` (service jobs) and
  `KAR` (karigar issue / receipt). None is in use today.
- **Guards.** Destructive calls use `requireAccess`. Writes in a locked period use `assertUnlocked`. Money goes through
  `round2`, and weights are rounded to 3 decimals (grams). Every delete goes through `setTable` on a watched table, so the
  recycle bin gets the row.
- **Packs.** A pack tab is listed only with its pack on; its URL still opens it. Its tables are not read while the pack is
  off (`tests/rt-pack-gate.test.ts`, like `tests/r5c-pack-gate.test.ts`).
- **Help.** Every new tab / view gets a topic (`tests/help-registry.test.ts` fails otherwise) and a Ctrl+K title in
  `src/i18n/areas/discover-r6-tabs.ts`. Statutory topics cite the RT ids. The CA-id regexes in
  `tests/help-registry.test.ts` and `tests/help-glossary.test.ts` gain `RT` (owner A).
- **Cash readers.** Exchange settlements (old gold, old device) are receipt rows that moved no cash: one new marker
  `exchange_purchase_id` in `no-cash.ts` (kind `exchange`, ledger "Sundry creditors — exchange"). Every reader already
  goes through `movedNoCash`; `tests/no-cash-readers.test.ts` gains the marker.

### RT-A — Retail profile, kirana / supermarket and shared retail pieces

#### RT-A1 Retail profile (shop picker)

**User story.** When I choose "Kirana / retail shop" in setup, I pick *Medical store*. The app lands me on the POS. It
switches on the pharmacy desk, expiry blocks and the MRP guard. The checklist asks me to add my drug licence and first
doctor.

**Acceptance criteria.**
1. `PackId` gains `pharmacy`, `apparel`, `electronics` and `jewellery` (appended to `PACK_IDS`). `PACK_OF_TYPE` and
   `PACK_ROUTES` are unchanged.
2. Settings field `retail_kind?: 'grocery' | 'pharmacy' | 'apparel' | 'electronics' | 'jewellery' | 'general'` (additive).
   `applyRetailKind(kind, { registered })` (`shop-presets.ts`) returns modules, packs, defaults and switches:

   | retail_kind | modules (`registered` adds `gst`) | industry_packs | landing | due days | template | switches turned on |
   |---|---|---|---|---|---|---|
   | grocery | `pos`, `purchases`, `inventory`, `reports` | `[]` | `/pos` | 0 | `retail_receipt` | MRP guard *warn*, deliveries, short book |
   | pharmacy | + `accounts`, `banking` | `pharmacy` | `/pos` | 0 | `gst_tax_invoice` | `pharma_settings.enabled`, `block_expired`, `block_above_mrp`; MRP guard *block*; short book; deliveries |
   | apparel | + `accounts` | `apparel` | `/pos` | 0 | `retail_receipt` | price-band GST; label sheet with size / colour |
   | electronics | + `accounts`, `banking`, `tds` | `electronics` | `/pos` | 0 | `gst_tax_invoice` | new stock items default `track_serials`; cash guard |
   | jewellery | + `accounts`, `banking`, `tds` | `jewellery` | `/inventory?tab=jewellery&view=rates` | 0 | `gst_tax_invoice` | cash guard *block*; PAN prompt; MRP guard off |
   | general | `pos`, `purchases`, `inventory`, `reports` | `[]` | `/pos` | 0 | `retail_receipt` | MRP guard *warn* |

3. Wizard: the `kirana` card opens a second choice with six cards (lazy, inside the wizard chunk). Settings → Features
   shows "Shop profile" with the same six plus "Custom" (packs kept as set). Changing the profile never deletes data;
   packs turned off only hide tabs.
4. Existing `kirana` companies (no `retail_kind`) are unchanged. The setup checklist (R6-A1) shows a step `retailProfile`
   "Pick your shop" until it is chosen or skipped.
5. Checklist steps per kind (`checklist-steps.ts`, append-only):
   - pharmacy → `drugLicence`, `doctor`;
   - apparel → `variantGrid`;
   - electronics → `serialItem`;
   - jewellery → `metalRate`, `jewelTag`;
   - grocery → `scaleOrBarcode` (done when an item has a barcode or `sold_by_weight`).
6. `PACK_TABS` rows (appended block `// R9`):
   - `/inventory?tab=pharmacy` (views `rx`, `doctors`, `registers`, `refills`, `prices`);
   - `/inventory?tab=apparel` (views `matrix`, `alterations`, `bands`);
   - `/inventory?tab=devices` (views `imei`, `finance`, `buyback`, `service`);
   - `/inventory?tab=jewellery` (views `rates`, `tags`, `oldgold`, `karigar`).

   `page-tabs.ts` gains `INVENTORY_PACK_TABS = [{ id, pack }]` beside the unchanged `INVENTORY_TABS`. `Inventory.tsx`
   lists them through `visibleTabs` and mounts each desk lazily. If a desk's package has not merged yet, A commits a
   one-line stub (`R9Stub.tsx`) that the package replaces.
7. Non-pack tabs: `/receivables?tab=deliveries` (RT-A3) and `/inventory?tab=shortbook` (RT-A4), appended to
   `RECEIVABLES_TABS` / `INVENTORY_TABS`.
8. Features catalogue (`features-catalog.ts`): four pack rows with `PACK_HREF`.
9. **Sample data** (R6-B4): `src/lib/demo/profile-retail.ts` builds rows per `retail_kind`, and goes only into the Demo
   company:
   - grocery: loose and scale items, a delivery order;
   - pharmacy: scheduled drugs, two doctors, an Rx bill, a refill;
   - apparel: a style with a 4 × 3 grid, a band-crossing discount, an alteration;
   - electronics: phones with IMEIs, a finance sale, a buy-back;
   - jewellery: today's rates, five tags, one sale with old gold.

   Each package adds its own rows to this file in its own block (§6).

**Files.** New: `src/lib/retail/rt-profile.ts`, `src/lib/retail/rt-registry.ts`, `src/lib/retail-rules.ts` (scaffold with
one section per package), `src/types/retail-r9.ts` (scaffold), `src/components/retail-r9/RetailKindPicker.tsx`,
`R9Stub.tsx`, `src/lib/demo/profile-retail.ts`. Edit: `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`,
`checklist-steps.ts`, `SetupWizard.tsx`, `FeaturesPanel.tsx`, `page-tabs.ts`, `Inventory.tsx`, `Receivables.tsx`,
`demo/profiles.ts` (one `case`).

**Storage.** Settings fields `retail_kind`, `retail_settings` (object, below). No table.

**Tests.** `tests/rt-profile.test.ts`:
- each kind's modules / packs / landing / switches;
- `registered` adds `gst`;
- an existing kirana company is unchanged;
- checklist steps by kind;
- `INVENTORY_PACK_TABS` visibility.

`tests/industry-packs.test.ts` is extended: new ids, no implied pack for `kirana`, `PACK_ROUTES` unchanged.

#### RT-A2 MRP guard for all retail, GST-cut pricing and the relabel queue

*Seen in:* the Marg / Gofrugal "MRP check"; the 22 Sep 2025 GST cut, when shops sold stock with old printed MRPs.

**User story.** My cashier cannot bill a ₹45-MRP biscuit at ₹48. After the GST cut I mark "MRP printed before 22 Sep
2025, GST 12% → 5%", and the counter sells those packs at ₹42.19 without me retyping every rate. I print new shelf labels
for every item whose price changed this week.

**Acceptance criteria.**
1. `retail_settings` (object, `settings.manage`, audited, synced as a singleton) holds:
   - `mrp_guard: 'off' | 'warn' | 'block'` (default `off`; profiles set it);
   - `delivery?` (RT-A3);
   - `short_book?` (RT-A4);
   - `cash_guard?` (RT-E3).
2. **MRP guard** (`rt-mrp.ts`, one call added in `liveDocTrackingIssues` beside `saleLimitGate`, so it covers the editor,
   POS and recurring runs).
   - **Per-unit MRP**: the batch MRP (`PurchaseLine.mrp`, per base unit), else the catalogue `mrp`, converted to the line
     unit.
   - **Price per unit**: incl. GST, after line discounts and the line's share of an invoice discount.
   - `warn` adds a warning; `block` adds an error that a clerk cannot override and an owner can (audited).
   - The pharma `block_above_mrp` keeps working. With both set, the stricter applies.
   - Credit notes and free (₹0) lines are not checked.
3. **GST-cut MRP pricing** (`rt-mrp.ts` `mrpAfterRateChange`): on a stock item or batch, `mrp_tax_basis?: { rate:
   number, until?: string }` ("this MRP was printed for GST at `rate`%"). When the line's GST rate on the bill date is
   lower, the **effective MRP** = MRP × (100 + new) / (100 + old), rounded to the paisa. It is used by the guard, by
   "MRP less %" pricing (`pricing.ts`, one guarded line) and on labels. A bulk action on Inventory → Batches sets the
   basis for all batches received before a date (default: received before the rate's `from` date in the HSN master, old
   rate from the master). It never raises an MRP. A rate increase shows a warning only (RT4).
4. **Relabel queue**: items whose selling rate, catalogue MRP or effective MRP changed since their last label print
   (`label_printed_at`, a catalogue field set by the label sheet) are listed on Inventory → Summary as "Labels to
   reprint". One click opens the existing label sheet with them.
5. Settings → Items → *Retail checks* holds the switches (not pack-gated).

**Files.** New: `src/lib/retail/rt-mrp.ts`, `src/components/retail-r9/RelabelQueue.tsx`. Edit:
- `src/lib/stock-tracking.ts` (one call in `liveDocTrackingIssues`);
- `src/lib/pricing.ts` (one guarded line);
- `src/components/settings/LabelSheetModal.tsx` (stamps `label_printed_at`);
- Settings → Items panel (one lazy section).

**Storage.** Object `retail_settings`. Additive: batch / stock item `mrp_tax_basis`, catalogue `label_printed_at`.

**Tests.** `tests/rt-mrp.test.ts`:
- warn vs block;
- batch MRP beats catalogue;
- alternate unit conversion;
- invoice discount share;
- 12 → 5% effective MRP ₹45 → ₹42.19;
- never raised on a rate increase;
- pharma option and the guard combined;
- credit note not checked;
- owner override audited.

#### RT-A3 Home delivery orders and rider cash settlement

*Seen in:* every neighbourhood kirana / chemist takes WhatsApp and phone orders; riders bring cash back at night.

**User story.** A customer WhatsApps a list. I punch it at the POS as a **delivery** bill with the address and slot, pack
it, and give it to Raju. Raju collects ₹1,240 cash and ₹600 by UPI. At night he hands me ₹1,240, and the app shows he
owes nothing and which orders came back.

**Acceptance criteria.**
1. POS and editor: a "Delivery" switch adds `delivery: { address, phone?, slot?, rider_id?, status, charge?, cod?:
   boolean, note? }` to the record.
   - `status` runs `new → packed → out → delivered`, or `returned` / `cancelled`.
   - The bill is a normal invoice, numbered when issued (at packing). A delivery **charge** is a normal service line at
     the goods' rate (G5; RT6).
2. Receivables → **Deliveries** (`/receivables?tab=deliveries`): a board by status, rider and slot; a print run sheet per
   rider (addresses, amounts to collect); and a WhatsApp "out for delivery" `wa.me` link.
3. **Cash on delivery**: marking *delivered* with COD records the receipt on the bill as a normal payment (method Cash),
   dated the delivery day. It is tagged `rider_id` and held in a "Cash with riders" ledger (a user ledger under Cash-in-hand,
   created on first use), not the counter cash. UPI collected by the rider is a normal UPI receipt.
4. **Rider settlement** (`rider_settlements`, `payment.record`, dated): pick a rider and a day. The app shows expected
   cash, amount counted, difference, and the orders returned. Saving posts Dr Cash / Cr Cash with riders (`saveVoucher`).
   A shortage goes to a user-chosen ledger, never silently. The Z report and shift X report show "Cash with riders" as a
   separate line.
5. Riders master `delivery_riders` (name, phone, active), `master.edit`.
6. A returned order: one click makes the credit note (goods returned) through the existing `documents.createCreditNote`.

**Files.** New: `src/lib/retail/rt-delivery.ts`, `src/components/retail-r9/DeliveriesTab.tsx`, `DeliveryStrip.tsx`
(lazy strip in the POS / editor summary). Edit: `ZReportModal.tsx` / `pos-shifts.ts` (one line each: rider cash).

**Storage.** `delivery_riders` (`master.edit`, watched "Delivery rider"), `rider_settlements` (`payment.record`, watched
"Rider settlement", dated `date`, synced), record field `delivery`, receipt field `rider_id`.

**Tests.** `tests/rt-delivery.test.ts`:
- status flow;
- COD receipt to "Cash with riders";
- settlement journal and shortage;
- a returned order's credit note;
- the Z report line;
- cash-book readers see the settlement once (not twice).

#### RT-A4 Supplier free quantity and discount on bills; short book

*Seen in:* every pharma / FMCG distributor bill ("10 + 1", "Sch 10%"); Marg's short book.

**User story.** My distributor's bill says 10 strips + 1 free at ₹80 less 5%. I enter it as such: stock goes up by 11,
cost per strip is ₹69.09, and GST is on ₹760. When a customer asks for an item I do not have, the cashier adds it to the
short book, and tomorrow's order lists it.

**Acceptance criteria.**
1. `PurchaseLine` gains `free_qty?: number` (≥ 0, in line units) and the UI for the existing `discount_percent`.
   - The bill line editor shows *Free* and *Disc %* cells when Settings → Purchases → *Free quantity on bills* is on (the
     pharmacy and grocery profiles turn it on).
   - Taxable value = qty × rate × (1 − disc%). Free units carry no value and no GST.
2. **Stock and cost**: `readPurchaseLines` (`purchase-normalize.ts`) returns `freeQty`. The stock engine receives
   (qty + free) × `unit_factor`. Unit cost = taxable / (qty + free). Batches / serials count the free units too.
   `tests/purchase-contract.test.ts` gains the field, and every purchases reader is checked (AGENTS rule 9). GSTR-2 / ITC
   readers are unchanged: value only.
3. A purchase return of free units returns at zero value (a warning explains).
4. **Short book** (`short_book`, `doc.create`, dated): POS / editor item search "not found / out of stock" offers *Add to
   short book* (item or free text, qty, customer phone optional). Inventory → **Short book** lists open rows by item.
   *Make PO* creates a draft purchase order through `purchaseOrdersDb`, grouped by the item's last supplier. Rows close
   when the item's stock comes in, or by hand. "Call the customer" builds a `wa.me` link when the item arrives.

**Files.** New: `src/lib/retail/rt-short-book.ts`, `src/components/retail-r9/ShortBookTab.tsx`. Edit:
`src/lib/purchase-normalize.ts` (`freeQty`, cost), `src/components/purchases/BillModal.tsx` line editor (two cells, one
lazy mount), the POS / editor item search (one lazy action), `tests/purchase-contract.test.ts`.

**Storage.** Line field `free_qty`; table `short_book` (`doc.create`, watched "Short book entry", dated `date`).

**Tests.** `tests/rt-purchase-free.test.ts`:
- 10 + 1 at ₹80 less 5%: stock 11, cost 69.09, taxable 760;
- alternate units;
- batch quantity;
- return of free units;
- ITC unchanged.

`tests/rt-short-book.test.ts`:
- add / close on arrival;
- PO grouping by last supplier.

### RT-B — Pharmacy

#### RT-B1 Prescription at the counter, doctors, patients and refill reminders

*Seen in:* Marg: prescription capture, doctor-wise sales, patient history; chemists' "monthly medicines" customers.

**User story.** At the POS I scan a Schedule H1 antibiotic. The counter asks for the doctor; I pick Dr Mehta from the
list, type the patient's name and age, and snap the prescription with the camera. For a diabetic customer who buys the
same strips every 30 days, the app reminds me on day 27 to WhatsApp her.

**Acceptance criteria.**
1. **Doctors** master (`doctors`, `master.edit`): name, qualification, registration no. and council, clinic / hospital,
   phone. No referral-commission field: the app does not book payments to doctors (RT9). Picking a doctor fills `rx.prescriber` / `rx.prescriber_reg`
   (snapshot) and `rx.doctor_id`.
2. **Rx on the POS**: when a cart holds an H / H1 / X item and the pharmacy pack is on, a lazy Rx strip opens beside the
   cart. It holds the doctor, patient name, age, gender and address (address required for X, optional otherwise), the
   prescription number / date, and an **Rx image** (camera / file through the existing `attachments.ts`; the bill keeps
   the `attachments` ref; templates never print it).
   - H1 / X with no patient + prescriber: a warning (the 7U rule), or a blocking error with *Require prescription for H1 / X*
     on (pharmacy profile default: on).
   - Schedule X also asks "Prescription retained" (`rx.retained`).
3. `rx` gains, additively: `doctor_id`, `age`, `gender`, `rx_no`, `rx_date`, `retained`. The patient may be a saved
   client (`client_id`) or walk-in text.
4. **Refills** (`rx_refills`, `doc.create`, dated by `next_due`): from any bill line, *Make refill*. It holds client /
   phone, items + quantities, an every-N-days schedule, the next due date, and an active flag.
   - A due list on the Pharmacy desk shows rows due within 3 days (default) and overdue, with a `wa.me` message ("Your
     medicines are due…", en / hi) and *Bill now* (opens the POS with the cart filled).
   - The bell (notifications) gets one "Refills due today: n" notice, through the lazy notifications path.
   - Billing a refill moves its next due date forward.
5. **Doctor-wise sales**: a report on the Pharmacy desk by doctor and period (bills, value, scheduled-drug lines). CSV.

**Files.** New: `src/lib/retail/rt-pharmacy-rx.ts`, `rt-refills.ts`, the `PharmacyDesk.tsx` views `rx`, `doctors`,
`refills`, and `src/components/retail-r9/RxStrip.tsx`. Edit: one lazy mount line in `pages/Pos.tsx` (§6),
`src/components/extras7u/EditorExtras.tsx` (doctor picker reuse, one line).

**Storage.** `doctors` (`master.edit`, watched "Doctor"), `rx_refills` (`doc.create`, watched "Refill schedule", dated
`next_due`); additive `rx` fields.

**Tests.** `tests/rt-pharmacy.test.ts`:
- POS cart with H1 needs an Rx (warn / block);
- doctor snapshot;
- X needs an address and "retained";
- refill next due after billing;
- due list window;
- doctor-wise totals;
- pack-off gate.

#### RT-B2 Registers, licences and pharmacist

**User story.** The drug inspector asks for my H1 register and Schedule X record for the last 3 years. I print them as
books, page-numbered, with every row's doctor and patient. The app warned me 60 days before my Form 20 / 21 licence
expired.

**Acceptance criteria.**
1. Pharmacy desk → **Registers**:
   - Schedule H1 (existing `h1Register`);
   - **Schedule X** (its own register: date, bill no., patient + address, prescriber + reg., drug, batch, qty,
     prescription retained yes / no, Rx no.);
   - **Schedule H** (optional);
   - **narcotic / psychotropic** items: a stock-item flag `narcotic` (additive), a register with opening, received
     (purchase lines), sold, and closing per item and batch.

   Each register prints as a book (A4, page numbers, period on each page, "verify the format with your drug inspector")
   and as CSV. Rows missing Rx details are flagged.
2. **Retention**: the register screen shows the retention rule from `retail-rules.ts` (`PHARMA_RETENTION_RULES`: H1 3
   years, X prescription 2 years, cash memos 3 years; RT7). The recycle bin and year-end checklist warn before an
   invoice holding an H1 / X line inside its retention window is deleted. It is never blocked: the owner decides.
3. **Licences**: `pharma_settings` gains `licences: { form: '20' | '21' | '20B' | '21B' | '20F' | '21G' | '21C' | other,
   number, valid_from?, valid_to?, premises? }[]` and `pharmacist: { name, reg_no, council? }`.
   - The profile's printed drug licence line comes from them, falling back to the existing `drug_licence` text.
   - The bill prints "Registered pharmacist: name (reg. no.)" when set.
   - Licences expiring within 60 days raise a bell notice; an expired one shows a red strip on the POS (never blocks).
   - Selling a Schedule X item with no 20F / 21G licence on file: a warning.

**Files.** New: `src/lib/retail/rt-pharmacy-registers.ts`, views `registers` (+ licence form in `PharmacyDesk.tsx`
setup). Edit: `src/lib/pharma.ts` (`h1Register` unchanged; `savePharmaSettings` keeps the new fields, one block),
`paper-helpers.ts` (one `pharmacistText`, §6).

**Storage.** `pharma_settings` additive (`licences`, `pharmacist`, `require_rx`); stock item `narcotic`.

**Tests.** `tests/rt-pharmacy-registers.test.ts`:
- X register rows;
- narcotic balance;
- book pagination;
- licence expiry notice at 60 days;
- the printed licence line falls back to the old text;
- deletion warning inside retention.

#### RT-B3 Ceiling price, loose units and margins

**User story.** A scheduled formulation's MRP on a new batch is above the NPPA ceiling + GST, and the bill modal warns
me. A customer buys 4 tablets from a strip of 10 with MRP ₹62, and the counter charges ₹24.80. I see my margin on PTR
for each item.

**Acceptance criteria.**
1. Stock item `ceiling_prices?: { from, price_per_unit, unit }[]` (dated, append-only; ex-GST, from the NPPA order the
   user types or pastes by CSV: item, ceiling, unit, date). The bill modal (purchase) and the POS warn when the batch MRP
   per unit > ceiling × (1 + GST%) on the date (RT8). It warns, never blocks.
2. **Loose units**: a stock item with an alternate unit (`alt_units`, e.g. STRIP = 10 TAB) prices the base unit from the
   larger unit's MRP when no base rate is set: rate per TAB = strip MRP ÷ 10, less the item's `mrp_less_percent`. The
   POS quantity "4 TAB" works through the existing unit picker. Uses `lineFactor` (AGENTS alternate-units rule).
3. **Margin view**: on the Pharmacy desk (`prices` view), per item / batch: PTR (purchase rate from the last bill), PTS
   (optional typed), MRP, selling rate, margin % on PTR, schemes received (free qty from RT-A4). CSV. Read-only.

**Files.** New: `src/lib/retail/rt-pharmacy-prices.ts`, view `prices`. Edit: `BillModal.tsx` (one lazy notice mount, §6),
`src/lib/pricing.ts` (one guarded loose-unit branch — shared with A, §6).

**Storage.** Stock item `ceiling_prices`. No table.

**Tests.** `tests/rt-pharmacy-prices.test.ts`:
- ceiling + GST warning by date;
- loose rate from the strip MRP;
- margin on PTR with free goods.

### RT-C — Apparel, footwear and textiles

#### RT-C1 Price-band GST (per piece / per pair)

*Seen in:* every garment shop after 22 Sep 2025 (₹2,500 per piece); GST rules since 2017 (₹1,000 per piece).

**User story.** A kurta tagged ₹2,799 is billed at 5% when the 15% festive discount brings it to ₹2,379. A ₹2,600
jacket stays at 18%. The bill shows each line's rate and the exceptions report lists lines whose band was decided by a
discount.

**Acceptance criteria.**
1. **Rule file** `retail-rules.ts` → `PRICE_BAND_RULES` (date-keyed `Versioned`, append-only, with sources). Kinds:
   - `apparel`: from 2017-07-01, ≤ 1,000 → 5, else 12. From 2025-09-22, ≤ 2,500 → 5, else 18.
   - `footwear`: from 2017-07-01, ≤ 500 → 5, else 18. From 2018-07-27, ≤ 1,000 → 5, else 18 (unverified). From
     2025-09-22, ≤ 2,500 → 5, else 18.
   - `made_ups`: as apparel (unverified, RT1).

   The comparison is **≤**: exactly ₹2,500 → 5%.
2. Stock / catalogue item `gst_band?: 'apparel' | 'footwear' | 'made_ups'` (additive; set per item or per stock group,
   bulk by HSN chapter 61 / 62 / 63 / 64 on the Apparel desk → *Bands*).
3. **Rate on the line** (`rt-bands.ts` `bandRate`): the per-unit taxable value is the line taxable ÷ quantity in pieces,
   after the line discount and the line's pro-rata share of an amount discount (offer, loyalty) on the invoice. It is
   taken in the line unit converted to pieces (`lineFactor`). The rate in force on the bill date then sets `tax_rate`, and
   the line keeps the snapshot `band_rate: { kind, value_per_piece }`.
   - Recomputed when the rate, discount, quantity or invoice discount changes, in the editor and the POS (one lazy hook
     after pricing, §6).
   - A rate the user types on the line clears `band_rate` (manual).
   - Credit notes keep the original line's rate.
4. **Tax-inclusive (MRP) pricing**: when the line rate is tax-inclusive (POS MRP pricing), the per-piece value excludes
   GST. The band is solved without a loop: test the 5% band (MRP ÷ 1.05 ≤ ₹2,500) first, else 18%. The printed MRP stays
   the price.
5. A combo / bundle priced as one line ("3 for ₹1,999"): the value per piece = line value ÷ pieces (RT2).
6. The exceptions report (`gst-guards.ts` `gstExceptions`, one appended check through a lazy hook) flags band lines
   whose stored rate differs from `bandRate` (edited bills) and lines within ₹50 of the threshold (information).

**Files.** New: `src/lib/retail/rt-bands.ts`, `ApparelDesk.tsx` view `bands`. Edit: the editor pricing hook
(`pricing-actions.ts`, one call) and the POS cart pricing (one call) — shared, §6; `gst-guards.ts` (one lazy check).

**Storage.** Item field `gst_band`; line field `band_rate`. No table.

**Tests.** `tests/rt-bands.test.ts`:
- ₹2,500 exactly → 5%;
- ₹2,500.01 → 18%;
- discount crosses the band;
- invoice amount discount share;
- inclusive pricing;
- 21 Sep 2025 (₹1,000 / 12%) vs 22 Sep 2025;
- footwear rows;
- typed rate is kept;
- credit note keeps the original rate;
- every row has a `source`.

#### RT-C2 Size × colour matrix entry and stock matrix

*Seen in:* Ginesys / GoFrugal size-colour grids; every garment purchase from a manufacturer ("S 4, M 6, L 6, XL 2").

**User story.** I buy style KRT-104 in four sizes and three colours: one grid on the purchase bill instead of 12 lines. At
the counter I scan the variant barcode as today. On the Apparel desk I see the style's stock as a grid by godown, with
red cells for sold-out sizes.

**Acceptance criteria.**
1. On the purchase bill, PO, GRN, invoice and sales order editors, a parent stock item with `variant_axes` opens a
   **matrix entry** (lazy dialog: rows = axis 1, columns = axis 2; a third axis as a tab). Typing quantities adds one
   line per non-zero cell with the child item, its rate (one rate for all cells, or per cell) and its HSN / GST (band
   from RT-C1). Existing lines of the same children are updated, not duplicated.
2. **Stock matrix** (Apparel desk → *Matrix*): pick a style (parent) → the grid of child quantities (stock engine,
   godown filter), sold in the last 30 days per cell, and cells at zero in red. CSV.
3. **Labels**: the label sheet prints the variant attributes ("M / Blue") and the MRP / price per child (one field
   added to the existing label layout).
4. Variant children that do not exist yet: the matrix offers *Create missing* through `generateVariants` (`master.edit`).

**Files.** New: `src/lib/retail/rt-matrix.ts`, `src/components/retail-r9/MatrixEntryDialog.tsx`, view `matrix`. Edit:
one lazy "Grid" button mount in the line editors of the editor and `BillModal.tsx` (§6), `label-sheet.ts` (one optional
attribute line).

**Storage.** None new.

**Tests.** `tests/rt-matrix.test.ts`:
- grid → lines and back (update, not duplicate);
- three axes;
- stock grid equals the per-child stock summary;
- labels carry attributes.

#### RT-C3 Alteration slips

**User story.** A customer buys trousers and wants them shortened. I issue a free alteration slip with token A-23,
ready Thursday, for tailor Imran. A blazer alteration is charged ₹300. At the end of the week I see Imran's jobs and pay
him per piece.

**Acceptance criteria.**
1. `alteration_jobs` (`doc.create`, series `ALT/FY…`, dated `date`): customer, phone, linked invoice / line, garment
   description, alteration notes and measurements (free text), tailor (a vendor), due date, charge (₹, 0 = free),
   tailor's rate, and status `received → with tailor → ready → delivered` (or `cancelled`). The slip prints (A6 /
   80 mm) with a token and the customer copy. "Ready" sends a `wa.me` message.
2. **Charge**: a charged alteration is a separate service line on the sale bill, or its own bill, with the SAC and rate
   from `ALTERATION_RULES` in `retail-rules.ts` (default SAC 998821 "tailoring", 5%, unverified, RT3). A free alteration
   adds nothing to the bill.
3. **Tailor pay**: *Make tailor bill* creates a purchase bill draft (expense "Tailoring charges") for the tailor's
   delivered jobs in a period, at the tailor's rates. GST / RCM: none by default (unregistered tailor; RT3).
4. Apparel desk → *Alterations* board by status and due date; today's due count on the POS header (pack on).

**Files.** New: `src/lib/retail/rt-alterations.ts`, view `alterations`, `AlterationSlip.tsx`.

**Storage.** `alteration_jobs` (`doc.create`, watched "Alteration job", dated `date`, numbered `ALT`).

**Tests.** `tests/rt-alterations.test.ts`:
- numbering;
- status flow;
- charged line on the bill with the rule's rate;
- tailor bill for a period;
- deleted number reserved;
- pack-off gate.

### RT-D — Electronics and mobiles

#### RT-D1 IMEI-first counter

**User story.** I scan the IMEI sticker on the box. The POS adds "Redmi 13 5G 8/128 Black" with that IMEI picked and a
12-month warranty. The bill prints IMEI 1 and IMEI 2. Before buying a used phone I log my check on the blocked-IMEI
portal.

**Acceptance criteria.**
1. **Scan lookup**: `scan.ts` gains a final fallback before "unknown code": a 15-digit (or any serial-shaped) code that
   matches an **in-stock serial** of a `track_serials` item adds that item with the serial already picked (godown of the
   serial). The lookup is an index from the stock-tracking map, built lazily once per POS session, so there is no extra
   cost when no serial items exist. It also works in the editor scan bar.
2. **IMEI check digit**: 15-digit numeric serials of an item marked `serial_kind: 'imei'` (additive; default for the
   electronics profile on items in HSN 8517) are checked with Luhn. A failure is a warning on purchase entry, never a
   block (some devices carry MEIDs).
3. **Dual IMEI**: purchase lines may pair serials: `serial_pairs?: Record<string, string>` (IMEI 1 → IMEI 2) on the bill
   line, pasted as "IMEI1 / IMEI2" per row. The stock engine tracks IMEI 1 only, unchanged. The pair is a lookup:
   scanning IMEI 2 finds IMEI 1, and sale lines print both (`trackingText`, one branch, §6).
4. **Blocked-IMEI check log** (`imei_checks`, `doc.create`, dated): IMEI, date, portal reference / screenshot
   (attachment), result (clear / blocked), user. Offered when a used device is bought (RT-D3) and before its resale.
   Resale of a used device with no "clear" check in the last 30 days is a warning (RT15). The app never calls the
   portal.
5. Devices desk → *IMEI*: the serial lookup (existing `SerialLookup`) plus pairs and the check log.

**Files.** New: `src/lib/retail/rt-imei.ts`, view `imei`. Edit: `src/lib/scan.ts` (one fallback hook, lazy index),
`paper-helpers.ts` (one pair branch in `trackingText`, §6), the bill line serial cell (one lazy pair parser).

**Storage.** Stock item `serial_kind`; purchase line `serial_pairs`; invoice line `serial_pairs` (snapshot); table
`imei_checks` (`doc.create`, watched "IMEI check", dated `date`).

**Tests.** `tests/rt-imei.test.ts`:
- scan an in-stock IMEI → item + serial;
- a sold IMEI is not found;
- IMEI 2 → IMEI 1;
- Luhn pass / fail;
- printing both;
- the check-log warning on resale.

#### RT-D2 EMI / consumer-finance sales

**User story.** A customer buys a ₹42,000 TV on Bajaj Finserv EMI: ₹8,400 down payment in cash, loan ₹33,600, DO no.
D-77812. The financier pays me ₹33,600 less ₹756 subvention and processing (with GST) five days later. I see every DO
still unpaid.

**Acceptance criteria.**
1. Client flag `financier?: true` on a client row (Bajaj Finserv, HDFC, TVS Credit, Home Credit …).
2. POS / editor tender **Finance** (`finance_deals`, `doc.create`, dated): financier, loan amount, DO / reference no.,
   scheme ("6/0" no-cost, etc.), down payment (the other tenders on the bill), expected subvention (₹ or %) and
   processing fee, customer's loan account (masked). The invoice is to the **customer** for the full value.
3. Booking: the finance part is left **due on the invoice** but owed by the financier. At save, a journal (Dr Financier
   (debtor) / Cr Customer (debtor), `saveVoucher`) transfers it, so the customer's balance is nil and the financier
   holds the DO.
4. **Disbursement**: Devices desk → *Finance* lists open DOs by financier and age. *Received* records the bank receipt
   from the financier for the net amount and books the difference as a purchase-side expense: a draft purchase bill
   from the financier for subvention / processing fee (SAC 997119, 18%, ITC per its invoice; RT10). The DO closes when
   receipt + bill = loan amount.
5. **Card EMI** stays a card tender. A retailer-funded no-cost discount is an invoice discount line ("No-cost EMI
   discount") at the time of sale (Sec 15(3)(a), RT10).
6. Reports: DOs pending > 7 days, financier-wise collections. CSV.

**Files.** New: `src/lib/retail/rt-finance.ts`, view `finance`, `FinanceTender.tsx` (lazy tender row). Edit: `pos.ts`
`TenderMethod` (+`'finance'`, additive; `tenderSummary` treats it as non-cash, so there is no change), POS tender panel
(one lazy mount, §6).

**Storage.** `finance_deals` (`doc.create`, watched "Finance deal (DO)", dated `date`); client `financier`.

**Tests.** `tests/rt-finance.test.ts`:
- tender split;
- transfer journal (customer nil, financier owes);
- disbursement + subvention bill closes the DO;
- partial disbursement keeps it open;
- Z report shows finance as "other";
- `movedNoCash` untouched (finance moves bank money when paid).

#### RT-D3 Exchange / buy-back and second-hand resale

**User story.** A customer trades in an old iPhone for ₹18,000 against a new ₹79,900 phone. I check the IMEI, record
the buy-back with his ID, and he pays ₹61,900. Next week I sell the refurbished old phone for ₹22,000 and pay GST only on
the ₹4,000 margin.

**Acceptance criteria.**
1. **Buy-back voucher**: a purchase record (`purchases`, kind `PURCHASE`, our own number `URD/FY…`) from the customer
   (a vendor row created or matched by phone; `vendor_kind: 'individual'`), with:
   - `used_goods: { serial / IMEI, model, condition, accessories, id_type, id_last4, photo_ref?, imei_check_id? }`;
   - **no GST**, `itc_eligible: false`, no RCM (RT11).

   The device goes into a godown of kind `'used'` (new value in the append-only `Godown.kind` union, **saleable**;
   `nonSaleableGodowns` unchanged; AGENTS decision recorded) as a serial-tracked stock item flagged `second_hand`.
2. **Exchange on the sale**: the POS / editor *Exchange* tender picks or creates the buy-back. A receipt row on the sale
   with `exchange_purchase_id` (no cash moved; `movedNoCash`) settles that part. Books: Dr Customer-as-creditor / Cr
   Customer-as-debtor through the receipt's existing ledger path with the new `NO_CASH_LEDGER.exchange`. The sale invoice
   is for the **full** price (GST on ₹79,900, RT11). The exchange value prints as "Less: exchange (old device IMEI …)".
3. **Margin scheme resale** (Rule 32(5), RT12): a sale line of a `second_hand` item with no ITC taken on its buy-back
   may use *Margin scheme*. Taxable value = sale price − purchase price of that serial (from the buy-back), 0 when
   negative. GST is charged on the margin, inclusive (the line shows "GST on margin under Rule 32(5)"; no tax shown
   separately to an unregistered buyer). Stored as `margin: { purchase_id, purchase_value }` on the line;
   `invoice-calc.ts` is **not changed**: the line is split into a non-taxable part (purchase value, exempt-like "margin
   scheme — no GST", reported in GSTR-1 as nil / exempt per RT12's default) and a taxable margin part, each a normal line.
   It is refused on a B2B bill to a registered buyer who asks for ITC (warning: "buyer gets no ITC").
4. Devices desk → *Buy-back* lists buy-backs, their resale and margin. The IMEI check (RT-D1) is linked.

**Files.** New: `src/lib/retail/rt-buyback.ts`, view `buyback`, `ExchangeTender.tsx`. Edit: `src/types/stock.ts`
(`Godown.kind` + `'used'`, append-only), `src/lib/no-cash.ts` (A adds the marker, §6), POS tender panel (one lazy mount).

**Storage.** Purchase record `used_goods`; stock item `second_hand`; line `margin`; receipt `exchange_purchase_id`; series
`URD`; godown kind `'used'`.

**Tests.** `tests/rt-buyback.test.ts`:
- buy-back posts no GST / ITC;
- the exchange receipt moves no cash (cash book, Z report, bank reco all skip it);
- full-value sale GST;
- margin split and negative margin → 0;
- a margin line refused with ITC;
- `URD` number reserved after delete.

#### RT-D4 Repair job sheets and warranty claims

**User story.** A customer drops a phone with a broken screen: job SVC/FY26-27/0042, estimate ₹3,200, ready Friday. I
send it to the brand service centre because it is under warranty; the claim is approved, so the customer pays nothing.
A non-warranty repair is billed with the screen as a part.

**Acceptance criteria.**
1. `service_jobs` (`doc.create`, series `SVC/FY…`, dated `date`): customer, device (item / model, IMEI / serial, linked
   sale if ours), complaint, accessories received, condition notes, estimate, advance (normal advance receipt), status
   `received → diagnosed → approved → in repair / sent to service centre → ready → delivered` (or `returned unrepaired`),
   technician, due date. Job card and delivery receipt print; `wa.me` updates.
2. **Warranty check** from the serial (`lookupSerial` warranty status) on the job. *Under warranty* jobs: a claim to the
   brand / service centre (vendor) with claim no. and status `sent → approved / rejected → settled`. A free replacement
   part or unit under warranty creates no sale. A replacement unit swapped in stock is a stock journal (out old serial,
   in new serial, no value; RT13).
3. **Billing**: *Bill job* creates an invoice with the service line (SAC 998714 "maintenance and repair of telecom /
   electronics", 18%, unverified) and parts lines (stock items, out of stock), adjusting the advance.
4. Devices desk → *Service* board by status and age; overdue jobs on the bell.

**Files.** New: `src/lib/retail/rt-service-jobs.ts`, view `service`, `JobCardPrint.tsx`.

**Storage.** `service_jobs` (`doc.create`, watched "Service job", dated `date`, numbered `SVC`).

**Tests.** `tests/rt-service.test.ts`:
- numbering and status flow;
- warranty status from the serial;
- claim approved → no sale;
- billed job with parts out of stock and advance adjusted;
- replacement swap keeps stock counts;
- pack-off gate.

### RT-E — Jewellery

#### RT-E1 Metal rate board and tagged pieces

**User story.** Every morning I set today's rate: 22K ₹9,350 / g, 18K ₹7,650 / g, silver 925 ₹112 / g. Each ring in the
showcase has a tag: gross 6.420 g, stones 0.380 g, net 6.040 g, 22K, HUID AB12CD, making ₹650 / g. Scanning the tag fills
the bill.

**Acceptance criteria.**
1. **Rates** (`metal_rates`, `master.edit`, dated `date`, append-only per day): metal (gold / silver / platinum), purity
   (karat 24 / 22 / 20 / 18 / 14 / 9 or fineness 999 / 958 / 916 / 875 / 750 / 585 / 375 for gold; 999 / 925 / 900 / 800
   for silver), sale rate per gram, buy rate per gram (old metal). One screen of today's grid, with *Copy yesterday*. A
   bill uses the rate of its own date, and the rate used is snapshotted on the line. A bill on a day with no rate: an
   error asking for today's rate (owner may type a line rate; audited).
2. **Tags** (`jewel_tags`, `master.edit`): each piece is a **serial** of a stock item (the design / category item,
   `track_serials`, unit `GMS` with base quantity in grams), so stock, godowns, transfers and the serial lookup work
   unchanged. The tag row carries tag no. (= serial), HUID (6 alphanumeric; validated), metal + purity, gross weight,
   stone weight, net weight (gross − stones, 3 decimals), stone details (type, carat, count, value), wastage %, making
   (`per_gram` / `percent` / `fixed`), hallmark charge, design no. and image.
   - Tag labels print (existing label sheet, a jewellery layout: tag no., net wt, purity, HUID, barcode).
   - A tag sold leaves stock through its serial.
3. **Bulk tag entry** from a karigar receipt or a purchase bill: rows of gross / stone weight, purity, HUID.
4. Jewellery desk → *Rates*, *Tags* (stock of tags by category / purity / godown, total net weight per purity, fine
   weight).

**Files.** New: `src/lib/retail/rt-jewel-rates.ts`, `rt-jewel-tags.ts`, `JewelleryDesk.tsx` views `rates`, `tags`. Edit:
`label-sheet.ts` (one layout preset).

**Storage.** `metal_rates` (`master.edit`, watched "Metal rate", dated `date`), `jewel_tags` (`master.edit`, watched
"Jewellery tag").

**Tests.** `tests/rt-jewel.test.ts`:
- rate of the bill date;
- no-rate error;
- net = gross − stones;
- HUID format;
- tag sold leaves stock via its serial;
- fine weight per purity;
- pack-off gate.

#### RT-E2 Jewellery bill line and BIS bill contents

**User story.** I scan the ring's tag. The line shows 6.040 g × ₹9,350 = ₹56,474, wastage 2% ₹1,129.48, making ₹650 /
g ₹3,926, stones ₹4,800, hallmarking ₹45, total ₹66,374.48, GST 3%. The printed bill shows net weight, 22K / 916, HUID,
the hallmarking charge and the BIS verification line.

**Acceptance criteria.**
1. A line of a jewellery stock item (`jewel: true` on the stock item) carries the snapshot `jw: { tag?, metal, purity,
   gross_wt, stone_wt, net_wt, rate, wastage_pct, making: {basis, value}, stone_value, hallmark_charge, huid? }`.
   - The **line amount** = net_wt × rate × (1 + wastage%) + making (per gram × net wt / % of metal value / fixed) + stone
     value + hallmark charge, rounded to the rupee or paisa (setting, default paisa).
   - Quantity = 1 piece (tag), or net weight in GMS for untagged / loose sales (chains by weight).
   - `rate` = amount / quantity, so `invoice-calc.ts`, GST, HSN and stock are unchanged (the Round 8 weight-line
     approach).
   - A typed amount clears the breakdown (manual).
2. **GST**: one line at the item's rate (3% for HSN 7113 / 7114 / 7116, from `JEWELLERY_GST_RULES` as a default the user
   confirms in the HSN master). Making, wastage, stones and hallmarking are **inside** the 3% line value (composite;
   RT16). A **job-work** bill (making on the customer's own metal) is a separate document mode "Job work (customer's
   metal)" with SAC 9988 at 5% from the rule file (unverified sub-code), and the metal weight received is shown as memo.
3. **Printing** (`paper-helpers.ts` `jewelText`, §6): per line, gross / stone / net weight, purity as "22K (916)", HUID,
   rate per gram, wastage, making, stones and hallmarking charge shown separately (BIS Reg. 5(11), RT19). Under the
   totals: "Purity of hallmarked jewellery can be verified at any BIS-recognised A&H centre." (rule-file text, dated).
   Gold lines without a HUID: a warning when the hallmarking mandate row is in force (never a block: non-notified
   districts, exempt articles; RT19).
4. **e-Way bill**: for a bill whose goods lines are all Chapter 71, the e-Way prompt is suppressed with the note "not
   required for Chapter 71 goods (Rule 138(14) annexure) — verify with your CA" (`EWAY_EXEMPT_CHAPTER_RULES` row,
   RT22). One guarded rule in the e-way prompt, through a lazy check.
5. **Estimate**: the existing quotation document works with jewellery lines; a rate change before conversion re-prices
   on conversion unless "rate locked" is ticked (`jw.rate_locked`).

**Files.** New: `src/lib/retail/rt-jewel-line.ts`, `src/components/retail-r9/JewelLineRow.tsx` (lazy sub-row). Edit:
- one lazy mount line in `ItemsTable.tsx` and the POS line (§6);
- `paper-helpers.ts` (`jewelText`, §6);
- `src/lib/eway.ts` or its prompt module (one guarded lazy check).

**Storage.** Line field `jw`; stock item `jewel`. No table.

**Tests.** `tests/rt-jewel-line.test.ts`:
- the ring example to the paisa;
- each making basis;
- loose weight sale;
- typed amount clears;
- GST 3% on the full value;
- job-work mode 5% with metal memo;
- HUID warning only;
- e-Way suppressed for Chapter 71, not for a mixed bill;
- printing text.

#### RT-E3 Old gold purchase / exchange; cash and PAN guards

**User story.** A customer brings an old chain: 12.300 g gross; the touch test says 84% purity; melting loss 2%. At
today's 24K buy rate of ₹10,000 / g the app values its 10.125 g fine at ₹1,01,253.60. It goes against her ₹1,40,000
bill; she pays ₹38,746.40 by UPI. A
customer who wants to pay ₹2.5 lakh in cash is stopped, and a bill above ₹2 lakh asks for PAN.

**Acceptance criteria.**
1. **Old gold voucher** (purchase record, own number `URD/FY…`, vendor = the customer as an individual):
   `old_metal: { metal, gross_wt, stone_wt, net_wt, purity_pct (touch), melt_loss_pct, fine_wt, rate_24k, value,
   test_method? }`.
   - fine_wt = net × purity% × (1 − melt%); value = fine_wt × buy rate of 24K (or of the stated purity, setting).
   - No GST, `itc_eligible: false`, no RCM (RT17).
   - Stock: into an `Old gold` stock item (unit GMS, quantity = fine weight in 24K grams) in a godown of kind `'used'`
     (RT-D3).
   - The customer's ID / PAN snapshot is taken when the value ≥ ₹2 lakh (Rule 114B, RT18).
   - Payable by cash / bank (purchase payment) or settled by exchange.
2. **Exchange**: the same `exchange_purchase_id` receipt as RT-D3 settles the sale. The sale invoice carries the full
   value (GST on ₹1,40,000, RT17); the old gold value prints as "Less: old gold (12.300 g @ 84%)".
3. **Cash guard** (`retail_settings.cash_guard: 'off' | 'warn' | 'block'`; default `block` for jewellery, `warn` for
   electronics, `off` otherwise; generic, not pack-gated) (`rt-cash-guard.ts`):
   - cash tenders on one bill ≥ ₹2 lakh, or cash from the same customer (client id or phone) across bills on the same day
     ≥ ₹2 lakh → error / warning "Cash of ₹2 lakh or more cannot be accepted (Sec 269ST)";
   - refunds and cash **paid** for old gold are not receipts and are not counted (RT18);
   - cash **paid** to one person in a day above ₹10,000 for old gold or a buy-back (RT-D3) → warning "Sec 40A(3):
     the purchase may be disallowed — pay by bank" (`CASH_PAYMENT_LIMIT_RULES`, 2017-04-01: 10,000; RT14);
   - the threshold comes from `CASH_RECEIPT_LIMIT_RULES` in `retail-rules.ts` (2017-04-01: 200,000), with the 2025-Act
     label from `ita2025.ts` (unverified row).
4. **PAN prompt**: a sale bill above ₹2 lakh (any mode) asks for the customer's PAN or "Form 60 / 97 declaration taken"
   (`kyc: { pan?, form?: '60' | '97', ref? }` on the record; masked in lists). Missing → warning (block with the jewellery
   profile's *Require PAN* switch, default on). The threshold comes from `PAN_SALE_LIMIT_RULES` (2016-01-01: 200,000).
5. **PMLA note**: cash in a day from one customer ≥ ₹10 lakh (only reachable with the cash guard off) shows "KYC and
   record-keeping under PMLA may apply — verify" (`PMLA_CASH_RULES`, unverified, RT18).

**Files.** New: `src/lib/retail/rt-old-gold.ts`, `rt-cash-guard.ts`, view `oldgold`, `OldGoldDialog.tsx`. Edit: POS
tender panel and editor payment area (one lazy guard call each, §6), `ExchangeTender.tsx` (shared with D: owner D, E
passes the purchase kind).

**Storage.** Purchase record `old_metal`; record `kyc`; settings `retail_settings.cash_guard`, `require_pan`.

**Tests.** `tests/rt-old-gold.test.ts`:
- fine weight and value;
- no GST / ITC;
- stock into Old gold;
- exchange moves no cash;
- full-value sale GST.

`tests/rt-cash-guard.test.ts`:
- ₹1,99,999 passes;
- ₹2,00,000 blocked;
- same-day aggregation by customer;
- old-gold cash payment not counted;
- PAN prompt above ₹2 lakh;
- rule rows by date.

#### RT-E4 Karigar metal account by fine weight

**User story.** I give karigar Salim 50 g of 24K fine gold to make 22K chains. He returns chains of 52.100 g net at
91.6% (47.724 g fine) with 1.5% wastage allowed (0.716 g) and charges ₹450 / g. His metal balance is 1.560 g fine
outstanding, and his labour bill is ₹23,445.

**Acceptance criteria.**
1. `karigar_moves` (`books.edit`, series `KAR/FY…`, dated `date`): karigar (vendor with `karigar: true`), kind `issue` /
   `receipt` / `return_metal`, lines of metal, purity, gross, net and fine weight, wastage allowed %, labour basis (per
   gram / per piece) and rate.
   - **Issue** moves stock out of the metal item to a godown of kind `'wip'` (existing, non-saleable) for that karigar.
   - **Receipt** brings finished pieces in (optionally creating tags, RT-E1 bulk entry) and consumes the issued metal by
     fine weight + wastage allowed.
2. **Karigar ledger by fine weight**: issued fine − received fine − wastage allowed − metal returned = balance
   (grams). It is shown per karigar with ageing. Metal with karigars counts as stock with job workers in the books'
   valuation (RT21). The labour charge makes a draft purchase bill (expense / cost of
   goods, SAC 9988 job work at 5% when the karigar is registered, nil and no RCM when unregistered; RT20).
3. **Job-work papers**: an issue to a registered karigar can print the existing job-work challan (`job-work-challan.ts`)
   and is listed in ITC-04 (`itc04.ts`) through the existing job-work model where the user opts in (RT20). Default: the
   karigar ledger only, with an "ITC-04 may apply" note.
4. Jewellery desk → *Karigar*.

**Files.** New: `src/lib/retail/rt-karigar.ts`, view `karigar`.

**Storage.** `karigar_moves` (`books.edit`, watched "Karigar issue / receipt", dated `date`, numbered `KAR`); vendor
`karigar`.

**Tests.** `tests/rt-karigar.test.ts`:
- the Salim example (balance 1.560 g, labour ₹23,445);
- wip godown balance;
- tags created on receipt;
- unregistered → no GST;
- deleted number reserved.

---

## 5. Work packages

Five packages, each one agent in its own worktree. **Merge order: RT-A first.** RT-B, RT-C, RT-D and RT-E follow in any
order, each rebasing on the previous merge. RT-A owns:
- the pack ids and profile;
- `retail-rules.ts`, `rt-registry.ts` and `types/retail-r9.ts` scaffolds;
- `invoice-defaults.ts` keys;
- the `no-cash.ts` marker;
- the `URD` series;
- the `Godown.kind` `'used'` value;
- `R9Stub.tsx` desks.

R7-B / R7-C merge independently; whichever lands second keeps both append-only blocks (§6).

### RT-A — Retail profile, kirana / supermarket, shared pieces (A1–A4)

Owned (new):
- `src/lib/retail/rt-{profile,registry,mrp,delivery,short-book}.ts`, `src/lib/retail-rules.ts`;
- `src/types/retail-r9.ts`;
- `src/components/retail-r9/{RetailKindPicker,R9Stub,RelabelQueue,DeliveriesTab,DeliveryStrip,ShortBookTab}.tsx`;
- `src/lib/demo/profile-retail.ts`;
- `src/i18n/areas/retail-r9a.ts`;
- `docs/features/retail-r9.md` (one doc for the round, with one section per package; each package edits only its
  section);
- tests `rt-profile`, `rt-mrp`, `rt-delivery`, `rt-purchase-free`, `rt-short-book`, `rt-registry`, `rt-rules`,
  `rt-pack-gate`.

Owned (edit):
- `industry-packs.ts`, `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`;
- `SetupWizard.tsx`, `FeaturesPanel.tsx`;
- `page-tabs.ts`;
- `Inventory.tsx`, `Receivables.tsx`;
- `demo/profiles.ts`;
- `purchase-normalize.ts`, `tests/purchase-contract.test.ts`;
- `no-cash.ts`, `tests/no-cash-readers.test.ts`;
- `types/stock.ts` (`'used'`), `godowns.ts` (decision comment);
- `store/invoice-defaults.ts` (every R9 key of every package, from §6, in one commit);
- `tests/help-registry.test.ts` and `tests/help-glossary.test.ts` (regex + `RT`);
- `ZReportModal.tsx` / `pos-shifts.ts` (rider line), `LabelSheetModal.tsx`.

Shared (§6): `stock-tracking.ts` (one call), `pricing.ts`, `BillModal.tsx`, `pages/Pos.tsx`, help files, registries.

Budget: first paint 0 (≤ +0.1 kB for the `no-cash.ts` marker); total ≤ 12 kB gz.

### RT-B — Pharmacy (B1–B3)

Owned (new):
- `src/lib/retail/rt-{pharmacy-rx,refills,pharmacy-registers,pharmacy-prices}.ts`;
- `src/components/retail-r9/{PharmacyDesk,RxStrip}.tsx`;
- `src/i18n/areas/retail-r9b.ts`;
- tests `rt-pharmacy`, `rt-pharmacy-registers`, `rt-pharmacy-prices`.

Owned (edit): `src/lib/pharma.ts` (`savePharmaSettings` fields), `src/components/extras7u/EditorExtras.tsx` (doctor
picker).

Shared (§6): `pages/Pos.tsx` (Rx strip mount), `BillModal.tsx` (ceiling notice), `paper-helpers.ts`
(`pharmacistText`), `pricing.ts` (loose-unit branch), `retail-rules.ts` (its block), `types/retail-r9.ts` (its block),
`rt-registry.ts` (its rows), `profile-retail.ts` (its block).

Budget: total ≤ 10 kB gz.

### RT-C — Apparel, footwear, textiles (C1–C3)

Owned (new):
- `src/lib/retail/rt-{bands,matrix,alterations}.ts`;
- `src/components/retail-r9/{ApparelDesk,MatrixEntryDialog,AlterationSlip}.tsx`;
- `src/i18n/areas/retail-r9c.ts`;
- tests `rt-bands`, `rt-matrix`, `rt-alterations`.

Owned (edit): `label-sheet.ts` (attribute line; E's jewellery preset is appended after it).

Shared (§6): `pricing-actions.ts` + the POS cart pricing (band hook), `gst-guards.ts` (one lazy check), `ItemsTable.tsx` /
`BillModal.tsx` (Grid button), registries, rules, types, demo.

Budget: total ≤ 10 kB gz.

### RT-D — Electronics and mobiles (D1–D4)

Owned (new):
- `src/lib/retail/rt-{imei,finance,buyback,service-jobs}.ts`;
- `src/components/retail-r9/{DevicesDesk,FinanceTender,ExchangeTender,JobCardPrint}.tsx`;
- `src/i18n/areas/retail-r9d.ts`;
- tests `rt-imei`, `rt-finance`, `rt-buyback`, `rt-service`.

Owned (edit): `src/lib/scan.ts` (serial fallback), `src/lib/pos.ts` (`TenderMethod` + `'finance'`, `'exchange'`).

Shared (§6): POS tender panel (two lazy mounts), `paper-helpers.ts` (`trackingText` pair branch), registries, rules,
types, demo.

Budget: total ≤ 13 kB gz.

### RT-E — Jewellery (E1–E4)

Owned (new):
- `src/lib/retail/rt-{jewel-rates,jewel-tags,jewel-line,old-gold,cash-guard,karigar}.ts`;
- `src/components/retail-r9/{JewelleryDesk,JewelLineRow,OldGoldDialog}.tsx`;
- `src/i18n/areas/retail-r9e.ts`;
- tests `rt-jewel`, `rt-jewel-line`, `rt-old-gold`, `rt-cash-guard`, `rt-karigar`.

Shared (§6):
- `ItemsTable.tsx` / POS line (jewel row), `paper-helpers.ts` (`jewelText`);
- the e-Way prompt (Chapter 71 check);
- `label-sheet.ts` (jewellery preset appended after C's line);
- the POS tender panel / editor payment (cash guard, one call each);
- `ExchangeTender.tsx` (D owns it; E adds the old-gold source through D's exported hook, or a one-line stub when D has
  not merged);
- registries, rules, types, demo.

Budget: total ≤ 15 kB gz.

**Combined:** first paint ≤ 184.7 kB; total JS ≤ ~2709 kB (+60 kB), leaving ≥ 90 kB for R7-B / R7-C. Each package runs
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run check:size` on its branch and again after
rebase.

---

## 6. Shared-file protocol

| File | Who | Rule |
|---|---|---|
| `src/types/retail-r9.ts` | A creates | One `declare module` block per package, marked `// RT-A` … `// RT-E`; each package edits only its block. A: record `delivery`, `kyc`; receipt `rider_id`, `exchange_purchase_id`; purchase line `free_qty`; settings `retail_kind`, `retail_settings`; batch / item `mrp_tax_basis`, catalogue `label_printed_at`. B: `rx` additions, stock item `ceiling_prices`, `narcotic`; pharma settings `licences`, `pharmacist`, `require_rx`. C: item `gst_band`, line `band_rate`. D: item `serial_kind`, `second_hand`; purchase / invoice line `serial_pairs`; line `margin`; purchase `used_goods`; client `financier`. E: item `jewel`; line `jw`; purchase `old_metal`; vendor `karigar`. |
| `src/store/invoice-defaults.ts` (`RECORD_KEYS`, `normalizeRecord`, `normalizeItem`) | A (owner) | A adds every R9 record / line key above (`delivery`, `kyc`, `band_rate`, `serial_pairs`, `margin`, `jw`) in one commit at the start of its branch. B–E do not edit it. |
| `src/lib/retail-rules.ts` | A creates | Sections `// RT-A` (no statutory rows: the MRP formula only), `// RT-B` `PHARMA_RETENTION_RULES`, `// RT-C` `PRICE_BAND_RULES`, `ALTERATION_RULES`, `// RT-D` `IMEI_CHECK_RULES`, `MARGIN_SCHEME_RULES`, `WARRANTY_REPLACEMENT_RULES`, `// RT-E` `JEWELLERY_GST_RULES`, `HALLMARK_RULES`, `CASH_RECEIPT_LIMIT_RULES`, `PAN_SALE_LIMIT_RULES`, `PMLA_CASH_RULES`, `CASH_PAYMENT_LIMIT_RULES`, `EWAY_EXEMPT_CHAPTER_RULES`. A commits the section headers and types; each package fills its section. Every row carries `source` and `verified`. |
| `src/lib/retail/rt-registry.ts` | A creates | `RT_TABLE_ACTIONS` / `RT_WATCHED` with one block per package (A: `delivery_riders`, `rider_settlements`, `short_book`, `retail_settings`; B: `doctors`, `rx_refills`; C: `alteration_jobs`; D: `imei_checks`, `finance_deals`, `service_jobs`; E: `metal_rates`, `jewel_tags`, `karigar_moves`). `tests/rt-registry.test.ts` pins both maps and checks the importers (`sync-engine.ts`, `trust/recycle-bin.ts` import it once, added by A). |
| `src/lib/backup.ts`, `sync-engine.ts` (`DATED`, `NUMBERED`), open-export schema | each its own rows | Append-only blocks `// R9-A` … `// R9-E`; conflicts are resolved by keeping both. |
| `src/lib/no-cash.ts` | A | Adds `exchange_purchase_id` (kind `exchange`, ledger "Sundry creditors — exchange") in its first commit; D and E only write the field. |
| `src/types/stock.ts` (`Godown.kind`) | A | Appends `'used'` (saleable; `nonSaleableGodowns` unchanged; AGENTS decision row by the lead). |
| `src/components/creator/ItemsTable.tsx` and the POS line in `pages/Pos.tsx` | C, E | One lazy mount line each in the line detail area: C (Grid button, band chip), E (`JewelLineRow`), each guarded by its pack. |
| `pages/Pos.tsx` (other) | A, B, D, E | One lazy mount line each: A `DeliveryStrip` and the short-book action; B `RxStrip`; D the tender rows (`FinanceTender`, `ExchangeTender`); E the cash-guard call. Order in the file: A, B, D, E. |
| `src/components/purchases/BillModal.tsx` | A, B, C | A: free / discount cells (owner of the line editor change); B: ceiling notice mount; C: Grid button mount. One line each besides A's cells. |
| `src/components/templates/paper-helpers.ts` | B, D, E | B appends `pharmacistText`; D adds one pair branch in `trackingText`; E appends `jewelText` and one entry in the sub-line join. |
| `src/lib/pricing.ts` | A, B | A: effective MRP in "MRP less %" (one guarded line); B: loose-unit rate (one guarded branch). |
| `src/components/creator/pricing-actions.ts` + POS cart pricing | C | The band hook only (one call each). |
| `src/lib/stock-tracking.ts` | A | One call (`mrpGuard`) beside `saleLimitGate`. |
| `src/lib/scan.ts` | D | One fallback hook. |
| `src/lib/gst-guards.ts`, the e-Way prompt | C, E | One lazy check each. |
| `src/lib/label-sheet.ts` | C, E | C appends the attribute line, E the jewellery preset. |
| `src/pages/page-tabs.ts`, `Inventory.tsx`, `Receivables.tsx` | A | A writes every R9 tab row and the lazy desk mounts by the import paths in this PRD; stubs until a package merges. |
| `src/lib/industry-packs.ts` | A | Pack ids and the `// R9` `PACK_TABS` block (all four desks' views). |
| `src/lib/help/topics-*.ts`, `glossary.ts`, `src/i18n/areas/discover-r6-tabs.ts` | A | A writes every R9 topic and Ctrl+K title in one `// R9` block per file, using the tab / view ids of this PRD. Packages correct their own rows after rebase if wording changes. |
| `src/lib/demo/profile-retail.ts` | A creates | One block per package; A's builder calls each block. |
| `tests/e2e/smoke.mjs` | A, B, C, D, E | One appended `step(...)` block each, in merge order. |
| `docs/features/retail-r9.md` | A creates | One section per package; each package edits only its section and records its bundle numbers there. |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md` | lead | After merge: the Round 9 section; table rows; storage keys; the `retail-rules.ts` rule-file note; the `Godown.kind` `'used'` decision; "exchange receipts move no cash"; "jewellery and band lines store the effective rate, so calc readers are unchanged". |
| `docs/CA_REVIEW.md` | lead | RT items are added with this PRD; packages report changes as rows in their feature-doc section, folded in by the lead. |
| R7-B / R7-C overlap | lead | Expected shared files: `industry-packs.ts` (`PACK_TABS`), `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`, `backup.ts` / `sync-engine.ts` rows, help files, `smoke.mjs`, `CA_REVIEW.md`, `pages/Pos.tsx` (R7-B charge to room). All edits are append-only blocks or single lazy lines; the second to merge keeps both. |

### Storage summary

| Key / field | Package | Kind | Backed up | Synced | Audited | Right (`rt-registry`) |
|---|---|---|---|---|---|---|
| `retail_settings` | A | object | yes | yes (singleton) | yes | `settings.manage` |
| `delivery_riders` | A | table | yes | yes | yes | `master.edit` |
| `rider_settlements` | A | table, dated | yes | yes | yes | `payment.record` |
| `short_book` | A | table, dated | yes | yes | yes | `doc.create` |
| `doctors` | B | table | yes | yes | yes | `master.edit` |
| `rx_refills` | B | table, dated (`next_due`) | yes | yes | yes | `doc.create` |
| `alteration_jobs` (`ALT`) | C | table, dated, numbered | yes | yes | yes | `doc.create` |
| `imei_checks` | D | table, dated | yes | yes | yes | `doc.create` |
| `finance_deals` | D | table, dated | yes | yes | yes | `doc.create` |
| `service_jobs` (`SVC`) | D | table, dated, numbered | yes | yes | yes | `doc.create` |
| `metal_rates` | E | table, dated | yes | yes | yes | `master.edit` |
| `jewel_tags` | E | table | yes | yes | yes | `master.edit` |
| `karigar_moves` (`KAR`) | E | table, dated, numbered | yes | yes | yes | `books.edit` |
| `URD` series (purchase vouchers from unregistered persons) | A (D, E use) | series on `purchases` | — | — | — | — |
| settings `retail_kind` | A | additive | yes | yes | yes | — |
| `pharma_settings` `licences` / `pharmacist` / `require_rx` | B | additive | yes | yes | yes | — |
| record `delivery`, `kyc`; receipt `rider_id`, `exchange_purchase_id` | A / E | additive | yes | yes | yes | — |
| line `band_rate`, `serial_pairs`, `margin`, `jw`; purchase line `free_qty`, `serial_pairs` | C / D / E / A | additive | yes | yes | yes | — |
| purchase `used_goods`, `old_metal` | D / E | additive | yes | yes | yes | — |
| item `mrp_tax_basis`, `gst_band`, `serial_kind`, `second_hand`, `jewel`, `ceiling_prices`, `narcotic`, `label_printed_at` | A–E | additive | yes | yes | yes | — |
| client `financier`; vendor `karigar` | D / E | additive | yes | yes | yes | — |
| `Godown.kind` `'used'` | A | union value (append-only) | — | — | — | — |

No device-local key. No migration (everything is additive).

---

## 7. E2E steps (production build, `tests/e2e/smoke.mjs`)

1. **R9-A**:
   - Fresh company → wizard → Kirana / retail → *Grocery / supermarket* → lands on `/pos`.
   - Set an item's MRP ₹45 and type rate ₹48 → the counter warns ("above MRP").
   - Make a delivery bill with COD; mark it delivered; settle the rider; the Z report shows "Cash with riders" ₹0.
   - Add a short-book row → *Make PO* creates a draft PO.
   - A purchase bill line 10 + 1 free at ₹80 less 5% → stock +11.
2. **R9-B**: Settings → shop profile *Medical store*:
   - POS with an H1 item → the Rx strip requires doctor + patient; pick a doctor; save.
   - Pharmacy → Registers shows the row.
   - Make a refill for 30 days → the due list shows it at day 27 (clock set).
   - Ctrl+K "doctor" finds Pharmacy → Doctors; F1 opens its help.
3. **R9-C**: *Garments*:
   - Item KRT-104 with band `apparel` at ₹2,799, 15% line discount → GST 5%; remove the discount → 18%.
   - Grid entry of 4 × 3 on a purchase bill creates 12 lines.
   - An alteration slip ALT/FY…/0001 prints.
4. **R9-D**: *Electronics*:
   - Buy two phones with IMEI pairs; scan IMEI 2 at the POS → the item is added with IMEI 1.
   - Pay by finance tender → Devices → Finance lists the DO.
   - A buy-back exchange → cash book unchanged by the exchange part.
5. **R9-E**: *Jewellery*:
   - Lands on Rates; set 22K ₹9,350; create a tag 6.420 / 0.380 g with HUID; bill it → amount equals the ring example.
   - The preview shows net weight, "22K (916)", HUID and the BIS line.
   - An old gold exchange settles part; a cash tender of ₹2,00,000 is refused.

---

## 8. Open questions — with the default the builders will use

The owner asked for no questions, so each one has a default that the packages implement. A CA answer later changes a dated
rule row or a setting default, never the design.

| # | Question | Default chosen | Why |
|---|---|---|---|
| 1 | Should existing `kirana` companies get a retail pack automatically? | **No.** `PACK_OF_TYPE` unchanged; a checklist step "Pick your shop". A company with `pharma_settings.enabled` keeps its 7U pharma features without the new pack. | The R5 invariant: existing companies see what they saw. |
| 2 | New business types or a sub-profile? | Sub-profile `retail_kind` under `kirana` (the Round 8 `trade_kind` approach). | Zero shell bytes; one wizard card. |
| 3 | Where do the vertical screens live? | One pack tab per vertical on `/inventory` with `&view=` sub-views; deliveries on Receivables, short book on Inventory. | `/inventory` is in every retail preset, so no `PACK_ROUTES` change and no first-paint bytes. |
| 4 | MRP guard default | Off for existing companies; profiles: grocery / general *warn*, pharmacy *block*, jewellery off; owner can override a block (audited). | No silent change; Legal Metrology applies to packaged goods (RT4). |
| 5 | Old-MRP stock after a GST cut | Effective MRP = MRP × (100 + new) / (100 + old), only when the user marks the batch basis; never raised on an increase. | Pass-on guidance after 22 Sep 2025; increases need re-labelling by the maker (RT4). |
| 6 | Free quantity on purchase bills | Stock = paid + free; cost spread over all units; GST / ITC on the paid value only. | Trade practice; Circular 92/11/2019 (RT5). |
| 7 | Rider COD | Receipt on delivery into "Cash with riders" (a cash-in-hand ledger); settlement journal moves it to counter cash; shortages to a chosen ledger. | Cash book stays true per person; Z report shows it. |
| 8 | Prescription requirement | Pharmacy profile: H1 / X blocked without patient + prescriber (owner can turn it to warn); existing pharma companies keep *warn*. | Rule 65; no silent change for existing users (RT7). |
| 9 | Rx image | Stored as an attachment (never printed), optional. | Existing attachment store; privacy (DPDP) — no auto capture. |
| 10 | Register retention | Warn before deleting a bill with H1 / X lines within 3 years; never block. | Owner decides; recycle bin keeps rows anyway (RT7). |
| 11 | NPPA ceiling | Typed / CSV per item, ex-GST, dated; warn only. | No offline source of the NPPA list (RT8). |
| 12 | Price-band GST test value | Per-piece taxable value after line discount and pro-rata invoice amount discount; ≤ ₹2,500 → 5%; inclusive prices solved by testing the 5% band first. | Transaction value per piece (RT1, RT2). |
| 13 | Earlier band rows (2017 / 2018) | Included, footwear 2018 row marked unverified. | Edits of old bills keep their date's rule. |
| 14 | Alteration GST | Free → nothing; charged → SAC 998821 at 5% (unverified); tailor unregistered → no GST, no RCM. | Developers' reading (RT3). |
| 15 | Matrix entry storage | No new storage: one line per child item. | Every reader keeps working. |
| 16 | IMEI check digit | Luhn warning on 15-digit IMEIs of items marked `imei`, never a block. | MEIDs and odd stickers exist. |
| 17 | Blocked-IMEI check | A log the user fills from the government portal; warn on resale without a clear check in 30 days. | No network; Telecom Cyber Security rules 2025 (RT15). |
| 18 | EMI booking | Invoice to the customer for the full value; finance part transferred to the financier by journal; subvention / processing fee as the financier's 18% bill to us. | RT10. |
| 19 | Exchange (device or old gold) | Separate purchase voucher (`URD`, no GST / ITC / RCM) + an exchange receipt that moves no cash; the sale invoice carries the **full** value. | Barter: consideration includes the old goods (RT11, RT17); conservative. |
| 20 | Second-hand resale | Margin scheme offered per line, only with no ITC on the buy-back; not on a B2B bill wanting ITC. | Rule 32(5) (RT12). |
| 21 | Used goods godown | New `Godown.kind` `'used'`, saleable. | Keeps used stock visible and separate in stock statements. |
| 22 | Warranty replacement | No sale, no GST, no ITC reversal; stock swap by journal. | Circular 195/07/2023 as understood (RT13). |
| 23 | Repair service SAC / rate | SAC 998714 at 18% (unverified); parts as goods lines at their own rates. | RT13. |
| 24 | Jewellery GST | 3% on the whole line (metal + wastage + making + stones + hallmarking); job work on customer's metal 5% SAC 9988 as a separate mode. | CBIC FAQ (RT16). |
| 25 | Jewellery line storage | Breakdown snapshot `jw`; `rate` = amount ÷ quantity so calc, GST, HSN and stock are unchanged. | The Round 8 weight-line approach. |
| 26 | Metal rate missing for the day | Error with an audited owner override (typed line rate). | Rates move daily; avoids stale prices. |
| 27 | HUID missing | Warning only. | Non-notified districts and exempt articles exist (RT19). |
| 28 | Old gold valuation | Fine weight = net × touch% × (1 − melt%); valued at the day's 24K buy rate (setting: rate of the stated purity). | Common counter practice. |
| 29 | Cash guard | ₹2 lakh per bill and per customer per day; refunds / old-gold cash paid not counted; jewellery *block*, electronics *warn*, others off. Cash paid for old gold / buy-backs above ₹10,000 a day to one person: warning. | Sec 269ST (RT18); Sec 40A(3) (RT14). |
| 30 | PAN | Prompt above ₹2 lakh per sale; jewellery profile requires PAN or Form 60 / 97 declaration (owner override). | Rule 114B (RT18). |
| 31 | e-Way for jewellery | Suppressed for all-Chapter-71 bills with a note. | Rule 138(14) annexure as understood (RT22). |
| 32 | Karigar | Fine-weight ledger + labour bill; ITC-04 / job-work challan only on opt-in. | Most karigars are unregistered; ITC-04 for registered principals (RT20). |
| 33 | Gold saving schemes | Not this round; installments are ordinary customer advances (existing). | Deposit-law review first. |
| 34 | Budget | Stay inside +60 kB; the lead may raise total to 2900 kB with the stated reason only if packages overrun after trimming. | First paint is the hard limit; total JS is precache. |
