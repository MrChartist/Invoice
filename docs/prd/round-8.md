# PRD — Round 8: trading businesses (distributors, wholesalers, commodity traders, agents)

Status: draft for build · Drafted 2026-10-26 · Baseline: branch `claude/elegant-cannon-cwapiv` at `40bb1db` (Phases 0–8,
Rounds 2–6, QA rounds 3, 5 and 6, PERF-1 / PERF-2 and the Income-tax Act 2025 labels all merged). Round 7 (hotel pack,
`docs/prd/round-7.md`) is planned in parallel; §5 and §6 say how the two rounds share files and budgets.

Companion documents:
- `docs/CA_REVIEW.md` §7 — the trader CA items **TR1–TR22** added with this PRD.
- Raw research (URLs and the claim taken from each, P = primary, S = secondary):
  `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/r8/round8-sources.md`.

Every item follows `AGENTS.md`:
- local-first and serverless (no mandi / e-NAM / APMC / GST / TRACES portal calls; files and `wa.me` links only);
- vanilla CSS Modules with tokens;
- invoice snapshots never change (new line / record fields are snapshots, read by the templates from the record);
- Indian-FY numbering for every new series;
- bare dates parsed as local days;
- statutory values date-keyed and append-only, in a rule file kept out of first paint;
- GST / TDS / TCS outputs labelled as working papers ("verify with your CA").

---

## 1. Problem statement

Trading businesses are the largest group of Indian GST registrants that are not retail counters: FMCG / pharma /
electrical / hardware / building-material **distributors and stockists**, general **wholesalers**, **commodity
traders** (grain, kirana wholesale, steel, cloth), **commission agents / arhatiyas** in mandis, **brokers (dalals)** and
**indenting agents**. Their tools (Tally Prime, BUSY, Marg, Logic ERP, Gofrugal, Miracle) are desktop-first; the mobile
apps (Vyapar, myBillBook, Khatabook) are simple but weak on trade terms.

The app already has a deep trading base (§2.3 lists 40 existing features with file paths): last rate to the party,
price levels, quantity slabs, dated price lists, schemes and offers, credit limit with hold, bill-wise outstanding,
cheques / PDC, godowns / batches / expiry, alternate units, stock ageing / ABC / reorder, SO → challan → invoice, PO →
GRN → bill, landed cost, e-Way single / bulk / consolidated, distribution beats / van sales / order pad, 194Q on
purchases, Tally import / export. **What a trader still cannot do here, and does every day in BUSY / Tally:**

1. **Trade discounts as traders write them**: "10 + 5 %", "₹2 per unit", a special rate or discount for one party on
   one item, a cash-discount term printed on the bill. The editor has one line % and one invoice discount.
2. **Distributor money that comes back from the company**: scheme claims and price-drop (price-protection) claims to
   the principal, and price-drop credit notes to retailers across many bills at once (distribution open item "debit
   note across several bills").
3. **Weight and bag billing**: 120 bags × 50.6 kg gross, 0.6 kg tare per bag, 1 kg dhalta per quintal → net 59.5 qtl
   at ₹2,450 / qtl. Today this is worked on a calculator and typed as one quantity; nothing prints the bag maths.
4. **Mandi charges ("bill sundries")**: market fee, aadat / commission, hamali, tulai, palledari, bardana, dharmada —
   per bag, per quintal or %. BUSY's mandi edition sells on exactly this. The app has hamali only on transport LRs.
5. **Brokers and agents**: a broker on a purchase or sale with brokerage per bag / quintal / %; a commission agent
   (kachi aadat) selling a farmer's or principal's goods and settling a "bikri patti"; an indent agent earning
   commission on orders placed with mills. Only salesman commission on our own sales exists (`sales-commission.ts`).
6. **Interest on overdue bills, party-wise**: Tally's Ledger Interest report and interest notes picking bills. The app
   computes interest on one invoice at a time (`OverdueInterest`); `ledger-interest.ts` has no screen.
7. **Returnable packaging**: crates, bardana, cans, cylinders given and taken back per party, with deposits.
8. **Bank paperwork for a cash-credit limit**: the monthly stock and book-debts statement (drawing power), and an
   HSN-wise stock summary.
9. **Trader statutory gaps**: TCS on scrap / minerals / timber / tendu / liquor (206C(1) → Sec 394(1), new 2% rates
   from 1 Apr 2026) and on motor vehicles / notified luxury goods above ₹10 lakh (206C(1F)); the 194Q **buyer
   turnover > ₹10 crore** test; RCM on notified goods bought from agriculturists (raw cotton, tobacco leaves, cashew);
   a running composition-limit tracker.
10. **Setup**: "Wholesale" is one business type. A pharma stockist, a grain arhatiya and a cloth broker get the same
    screens; none gets the trade tools above.

**Goal of Round 8:** ship **13 items in three parallel work packages** with mostly disjoint files:
- **TR-A** distributor and wholesaler pricing, claims and collections (5 items);
- **TR-B** commodity and mandi trade: weight / bag billing, mandi charges, brokers (3 items);
- **TR-C** agents, trader statutory rules, bank statements and the `trading` setup profile (5 items).

### How the trading profile switches on (no clutter for others)

- The business type stays **`wholesale`** (`shop-mode.ts`); no new `BusinessType` (zero shell bytes). The setup wizard
  and Settings → Features gain a **trade picker** shown when `wholesale` is chosen: *Distributor / stockist*,
  *Wholesaler*, *Commodity trader*, *Commission agent / broker*. The choice is stored as the additive settings field
  `trade_kind` and sets `modules` (shop mode) and an explicit `industry_packs` list (§4 TR-C5).
- **Three new packs** (`industry-packs.ts`): `distributor`, `commodity`, `agency`. A pack adds tabs on the existing
  `/distribution` route only (plus fields in existing dialogs), never a route or sidebar item.
- `PACK_OF_TYPE` is **not** changed: `wholesale` implies no pack, so every existing wholesale company sees exactly what
  it saw. It gets a one-time setup-checklist step "Pick your trade" (TR-C5) instead.
- Generic trader tools that help every business (compound discounts, party rates, the interest statement, the bank
  stock statement, HSN-wise stock, the new TCS presets, the RCM prompt) are **not** pack-gated; they are opt-in
  settings or new tabs on existing screens, so a manufacturer or a CA gets them too.

### Budgets the packages must respect

Measured on `40bb1db` (`npm run build && npm run check:size`):

| Budget | Now | Limit | Headroom | Shared with |
|---|---|---|---|---|
| Initial JS (first paint, gz) | **184.2 kB** | 185 kB | 0.8 kB | Round 7 |
| Entry chunk (gz) | — | 90 kB | — | |
| Total JS (gz) | **2533.9 kB** | 2600 kB | 66.1 kB | Round 7 |

Rules:
- **First paint: Round 8 ≤ +0.1 kB gz in total** (TR-C only: three pack ids in the inline `PACK_ROUTES` of
  `shop-mode.ts`, ≈ 40 bytes). TR-A and TR-B add **0** first-paint bytes. Round 7 keeps ≥ 0.7 kB.
- **Total JS for the round ≤ +35 kB gz:** TR-A ≤ 13 kB, TR-B ≤ 11 kB, TR-C ≤ 11 kB. Round 7 keeps ≥ 31 kB.
- **Everything is lazy.** No new route. New screens are tabs on `/distribution`, `/receivables`, `/inventory`,
  `/reports`; new editor / bill parts are lazy sub-rows mounted only when their setting or pack is on.
- **Rule data is a chunk.** `src/lib/trading-rules.ts` is imported only by lazy screens (editor tax panel, bill modal,
  TDS / TCS screens, GST compliance) — never by `tax-rules.ts` or the shell.
- **Help text is data.** Topics go in the existing lazy topic files (`topics-packs.ts`, `topics-sales.ts`,
  `topics-purchase.ts`, `topics-statutory.ts`); glossary terms in `glossary.ts` (lazy).
- **Icons: reuse only.** Already imported and suggested: TR-A `Percent`, `Tags`, `HandCoins`, `TrendingDown`,
  `Package`, `Boxes`, `Calculator`; TR-B `Scale`, `Package`, `Store`, `Users`, `ReceiptText`; TR-C `Landmark`,
  `ClipboardList`, `FileSpreadsheet`, `Truck`, `ShieldAlert`. A new icon name fails review.
- **If the round needs more than 35 kB:** the lead may raise `BUDGET_TOTAL_GZ_KB` from 2600 to 2700 in one lead commit,
  recorded in `scripts/check-bundle-size.mjs` with the reason. Justification prepared here: total JS is the one-time
  offline precache, not first paint; Round 6 alone used ~92 kB; Rounds 7 and 8 together add two verticals. The
  default is **not** to raise it: each package builds inside its share first.
- Each package records before / after numbers in its feature doc.

### Non-goals

Anything needing a server, the network or a state portal:
- e-NAM, APMC / mandi board portals, state "J-form" / "6R" / "Form 9" generators (formats differ by state and are not
  published in a stable form — the Market fee register is a CSV working paper instead);
- auction / boli live entry at the mandi yard (BUSY's "Auction / Vikray entry") — later, after the agency desk is used;
- distributor-to-company DMS sync (Bizom / FieldAssist), retailer ordering apps, salesman GPS;
- GST / e-Way / TRACES portal actions (files are prepared offline as today);
- a separate commodity-futures or hedging register.

---

## 2. Findings

### 2.1 What traders use and praise / complain about (research)

P = vendor's own documentation or official text; S = secondary (reseller, review site, blog). Full list in
`round8-sources.md`.

| Workflow | Tally Prime | BUSY | Marg / Logic / Gofrugal | Vyapar / myBillBook / Khatabook | Source |
|---|---|---|---|---|---|
| Party-wise price levels, dated price lists, qty slabs | Price levels attached to debtor **and creditor** ledgers; price lists per stock group with "Applicable From" and slabs; cost shown beside the list | Party-Item price structure (sales and purchase) | Logic: party-wise preset rates / discounts / schemes; "last rate charged" at billing | Party-wise rate in some apps; reviews do not praise it | P Tally help + dealer-schemes article; P BUSY FAQ 63078; P Logic ERP pages |
| Discount structures | Discount via slabs and a discount ledger | Item-wise discount structures incl. **compound discount**; bill sundries auto-applied per series | Logic: preset party discounts | Single % | P BUSY FAQs 38998, 41891 |
| Free goods / schemes | **Actual vs Billed quantity** columns; zero-value free item lines; schemes with end dates | Scheme masters | Logic: schemes by item group / brand / category; **batch-wise free**; **price-drop management**; FieldAssist / Bizom: **scheme claims** to the company (claims settled 120 → <30 days) | Simple offers | P Tally article; P Logic KB; P (vendor claim) FieldAssist |
| Margin guard | Cost on price list | — | Gofrugal / Logic: alert or red row when billing below minimum margin | — | P Gofrugal, Logic |
| Credit limit / days with hold | Credit limit on ledger with interest | Credit limits | Distributor left Marg partly for lack of category-wise credit limits | Basic | S Ksolves case study |
| Bill-wise outstanding and **interest** | Bill-wise for debtors and creditors; **Ledger Interest** report; interest notes picking bills | **Interest Report** (mandi edition) | — | Reminders only | P Tally help "interest calculation" |
| Mandi / commission agent | — (done with bill sundries) | **BUSY for Mandi**: Self-trading & commission trading, Kachchi / Pakki aadat, auction entry, **Market Fee Register**, **bill sundries Jhadai / Tulai / Safai**, **Bardana / crate management**, loose qty in **bags / weight / crates**, Adhatiya stock statement, Bikri report | — | Vyapar mandi page: agent commission inside each transaction | P busy.in/mandi |
| Brokers (dalali), textile agents | Agent ledgers | Broker field | Miracle textile edition aimed at brokers / agents of mills (details not published) | — | S IndiaMART resellers |
| Weight billing | Alternate units | Bags / weight / crates | — | — | P BUSY mandi; S Tribune (bag 50 kg + 0.6 kg gunny tare; 37.5 kg standard elsewhere) |
| Complaints | Desktop-only, training needed | Same | Marg: weak category credit control (S) | myBillBook: **no offline billing**, partial payment adjustments not recordable, deleted items unrecoverable; Vyapar: no party-wise other income, instability (S Capterra / TechJockey) | S reviews |

**What carries over to an offline app:** compound / per-unit discounts and party-item rates (pure maths on the line);
scheme scope by group / party and claims to the principal; bulk price-drop notes; bag / weight maths printed on the
bill; configurable bill charges with a register; broker and agent registers with settlement; party-wise interest
notes; packaging ledgers; bank statements from our own stock and debtors. Offline, recycle bin and full audit are
already our edge over the mobile apps' main complaints.

### 2.2 Statutory rules for traders (as understood — every row is a CA item)

| Rule | What applies | App today | Source | Confidence |
|---|---|---|---|---|
| 194Q TDS on purchase of goods | Buyer with business turnover **> ₹10 crore in the preceding FY** deducts 0.1% on purchases from a resident seller **above ₹50 lakh** in the FY; 5% without PAN; base excludes GST shown separately; earlier of credit / payment (advances included). From 1 Apr 2026: **Sec 393(1) Table Sl. 8(ii)**, Act 2025. | Thresholds, exceed-only maths, 206AA 5%, 8(ii) label exist. **Buyer-turnover test not modelled** (194Q applies whenever chosen). | S tdsman 2026 (blog notes the 2025 Act text may not repeat the turnover test); code `tds-rules.ts`, `ita2025.ts` | Medium (turnover test under the 2025 Act: low → TR13) |
| 206C(1H) TCS on sale of goods | 0.1% above ₹50 lakh (0.075% to 31 Mar 2021); **withdrawn from 1 Apr 2025**. | Presets end 31 Mar 2025. | Finance Act 2025; code `TCS_PRESET_RULES` | High |
| 206C(1) → Sec 394(1) Sl. 1–5 specified goods | Liquor 1%, tendu 5%, timber / forest produce 2.5%, scrap 1%, coal / lignite / iron ore 1% until 31 Mar 2026; **from 1 Apr 2026 liquor, tendu, scrap, minerals 2%**; timber / forest produce 2% per one source, unchanged per another. Buyer's manufacturing-use declaration (Form 27C → **Form 127**) removes TCS. | **Missing.** | S tdsman 2026 (all 2%, payment codes 1068–1074); S taxguru Finance Bill 2026 (timber silent) | Medium; timber low → TR14 |
| 206C(1F) → Sec 394(1) Sl. 6 | 1% on a motor vehicle above ₹10 lakh (since 1 Jun 2016); notified luxury goods (watch, art, collectibles, yacht, helicopter, sunglasses, handbags, shoes, sportswear, home theatre, racing horses) single item above ₹10 lakh **from 22 Apr 2025** (N 36/2025). Table numbering under Sec 394 disputed (Sl. 6 vs 6.D(a)/(b)). | **Missing.** | S taxmann, taxguru, vjmglobal; S tdsman | Medium → TR15 |
| 194H on brokerage / commission we pay | 2% from 1 Oct 2024; threshold ₹20,000 a year from 1 Apr 2025; Act 2025: Sec 393(1) Sl. 1(ii). | Section exists on bills (`tds-payables.ts`); salesman commission posts without TDS (T15). | Code `tds-rules.ts`, `ita2025.ts` | High (rates), T15 open |
| 194-O | Marketplace pack. | Exists. | — | — |
| RCM on notified goods (Sec 9(3), N 4/2017-CT(R)) | Recipient pays GST on: cashew nuts not shelled / peeled (0801), bidi wrapper leaves (1404 90 10), tobacco leaves (2401) — from an agriculturist; silk yarn (5004–5006) from its maker; **raw cotton (5201) from an agriculturist from 15 Nov 2017** (N 43/2017-CT(R)); specified mint / essential oils from an unregistered person (N 14/2022 era — date unverified). | Bill-level `reverse_charge` and self-invoice exist (`rcm-self-invoice.ts`); **no HSN prompt**. | P gstcouncil.gov.in N 4/2017; P/S taxheal N 43/2017 | High for the 2017 entries; low for mint oils → TR17 |
| Commission agent for agricultural produce | Agent's commission for sale / purchase of agricultural produce exempt (N 12/2017-CT(R) entry 54); agent of an agriculturist (not a taxable person) not compulsorily registered (Circular 57/31/2018 + corrigendum); an agent liable under RCM must register. An agent who invoices in its own name is a Schedule I para 3 agent. | **Missing** (no agency model). | P Circular 57 corrigendum (state copies); S forum / blogs on entry 54(g) | Medium → TR9, TR10 |
| APMC market fee / mandi charges in GST value | Sec 15(2)(a): taxes / fees under other laws charged separately are part of value; 15(2)(c): incidental charges (packing, commission, labour) by the supplier are part of value. Whether a market fee **collected for the APMC** is in value was not found in any ruling. | **Missing.** | Sec 15 (developers' reading); S AAR N.B. Patil (3% APMC commission) | Low → TR6, TR7 |
| Composition — trader | 1% (CGST + SGST) on taxable turnover; ₹1.5 crore (₹75 lakh special-category States) preceding-FY aggregate; no inter-State outward supply; e-commerce bar for goods lifted 1 Oct 2023. | Rates, limits as guidance, inter-State warning (`bill-of-supply.ts`). **No running turnover tracker.** | Code `tax-rules.ts` (G41) | High |
| Rule 86B | 1% of output tax in cash above ₹50 lakh taxable supplies a month. | Warning (`gst-setoff.ts`). | G29 | Medium (exceptions not modelled) |
| e-Invoice | AATO above ₹5 crore from 1 Aug 2023; 30-day IRP window for AATO ≥ ₹10 crore from 1 Apr 2025. | Exists (`gst-guards.ts`). | N 10/2023-CT | High |
| e-Way bill | ₹50,000 consignment value; bulk / consolidated / Part-B desk. | Exists (`eway*.ts`). | — | High |
| Credit notes with GST | By 30 Nov after the FY (Sec 34(2), Finance Act 2022); post-supply discounts only if agreed before and linked (Sec 15(3)(b)); else financial credit note (Circular 92/11/2019). | Exists (`gst-penalties.ts`, `financial-note.ts`, G8). | Code | Medium (G8) |
| ITC blocks (Sec 17(5)), lost / destroyed goods | ITC blocked flag on bills; reversal reminder for expiry / breakage. | Exists (G38). | Code | — |
| MSMED 45 days / 43B(h) | Payables side exists; trader Udyam registrations are retail / wholesale (since 2021) and get **no** Sec 15–16 MSMED protection as suppliers. | `msme.ts`, T20 / T21. | — | Medium → TR20 |

### 2.3 Verified against the code (`40bb1db`)

Verdicts: **Exists** (done, file given), **Partial** (part done, gap named), **Missing**. Each row was checked by grep /
reading the file; "→" names the Round 8 item that closes it.

#### Pricing, discounts, schemes

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Last rate to this party (sale) | Exists | `last-rate.ts` (8.104), `LastRateHints.tsx`, `pricing-actions.ts` | Last **purchase** rate from a supplier in the bill modal → TR-A1 (small) |
| Price levels per party (own rate per item or % off, MRP basis) | Exists | `pricing.ts` `PriceLevel`, `Client.price_level` | — |
| Quantity slabs | Exists | `QtySlab`, `resolvePrice` | — |
| Dated selling price lists | Exists | `price-list.ts` (7S), `StockItem.selling_prices` | — |
| Party-item special rate / discount (one party, one item) | **Partial** | only by creating a level per party | `party_rates` → TR-A1 |
| Compound line discount (10 + 5 %), per-unit discount | **Missing** | `InvoiceItem.discount_percent` only (`types/invoice.ts:135`) | TR-A1 |
| Cash-discount term on the bill ("2% if paid in 7 days") | **Partial** | settlement discount after the fact (`settlement.ts`, FCN) | Printed term + auto-proposed FCN → TR-A1 |
| Schemes: same item, buy A get B, bill value | Exists | `pricing.ts` `Scheme.kind`, `offers.ts` (7U) | — |
| Scheme scope by group / brand / party / level; slab free qty | **Missing** | `Scheme.item_id` only | TR-A2 |
| Scheme / price-drop **claims to the principal** | **Missing** | — | TR-A2, TR-A3 |
| Price-drop notes across many bills | **Missing** | one CN per invoice (`documents.ts` "Rate difference"); `distribution.md` open item | TR-A3 |
| Margin chip in the editor | Exists | `margin.ts` (8G, landed rate after R6-C1) | Min-margin warning per group → TR-A1 (one check) |

#### Credit and collections

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Credit limit / days, warn or block with approval hold | Exists | `credit-policy.ts`, `approval-gate.ts` `holdIfCreditBlocked` (8.80) | — |
| Bill-wise outstanding (receivables and payables, openings) | Exists | `billwise.ts`, `receivables.ts`, `opening-bills.ts` (R6-C2) | — |
| Interest on one overdue invoice → late-fee invoice | Exists | `interest.ts`, `components/interest/OverdueInterest.tsx`, `late-fee.ts` | — |
| Party-wise / all-party interest statement and bulk interest notes | **Missing** | `ledger/ledger-interest.ts` has no UI caller | TR-A4 |
| Cheques / PDC register, bounce flag | Exists | `cheques.ts`, `cheque-reminders.ts` (6.26) | — |
| Payment terms, follow-ups, statements, payment score | Exists | R2-A (`collections.ts`, `payment-terms.ts`) | — |
| Returnable packaging (crates / bardana / cans) per party | **Missing** | only `challan_returnable` on a challan | TR-A5 |

#### Stock and orders

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Godown-wise stock, transfers, van godowns | Exists | `godowns.ts`, `van.ts`, Inventory → Godowns / Transfers | — |
| Batches, expiry, near-expiry claims | Exists | `inventory.ts`, `expiry-ops.ts` (8F) | — |
| Alternate units (BOX / QTL ↔ base) | Exists | `units.ts` (`lineFactor`) | — |
| Stock ageing, batch ageing | Exists | `stock-reports.ts` `stockAgeing`, `batchAgeing` | — |
| Fast / slow / non-moving, ABC | Exists | `stock-analysis.ts` (8.83) | — |
| Reorder status with pending POs | Exists | `reorder.ts` | — |
| Stock query (last purchase / sale rate, pending orders) | Exists | `stock-query.ts` (WP-8) | — |
| HSN-wise stock summary | **Missing** | HSN only on the item form | TR-C4 |
| SO backlog, backorders, SO → PO | Exists | `sales-orders.ts`, `back-to-back.ts` (R2-B5) | — |
| PO → GRN → bill, PO outstanding, GRN not billed | Exists | `purchase-orders.ts`, `receipt-notes.ts` | — |
| Landed cost | Exists | `landed-cost.ts`, `landed-voucher.ts` | — |
| Delivery challans (purposes, returnable), job work, ITC-04 | Exists | `InvoiceRecord.challan_purpose`, `job-work*.ts` | — |
| Transfer requests, branch prices | Exists | `retail/transfer-requests.ts`, branch prices (R4-B) | — |
| Weight-based billing (bags, gross, tare, deduction) | **Partial** | net / gross weight per catalogue unit and packing lists (`packing.ts`, R2-C4) | TR-B1 |
| Bill sundries / mandi charges (market fee, hamali, tulai …) | **Missing** | hamali only on LRs (`transport/consignment-notes.ts`) | TR-B2 |

#### Agents and brokers

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Salesman commission (own sales), statement, payable journal | Exists | `sales-commission.ts` (7U) | 194H not computed (T15) → TR-B3 |
| Broker on purchases / sales, brokerage per bag / qtl / % | **Missing** | — | TR-B3 |
| Commission agent selling on behalf (kachi aadat), patti | **Missing** | — | TR-C1 |
| Indent register and commission billing | **Missing** | — | TR-C1 |
| Distribution masters, beats, van sales, order pad | Exists | `distribution.ts`, `van.ts`, `order-pad.ts` (8F) | — |

#### Documents, GST, TDS / TCS, transport

| Feature | Verdict | Evidence | Gap → item |
|---|---|---|---|
| Transport / LR / vehicle on the bill | Exists | `InvoiceRecord.transport` (`lr_no`, `vehicle_no` …) | — |
| e-Way single, bulk, consolidated, Part-B desk | Exists | `eway.ts`, `einvoice-bulk.ts`, `eway-consolidated.ts`, `eway-desk.ts` | — |
| e-Invoice mandate ₹5 crore | Exists | `gst-guards.ts` `EINVOICE_MANDATE_RULES` | — |
| Purchase returns / debit notes, rate-difference notes | Exists | `purchase-returns.ts`, `documents.ts` reasons | — |
| Settlement discount as financial credit note | Exists | `settlement.ts`, `financial-note.ts` | — |
| 194Q on purchases (exceed-only above ₹50 lakh) | Exists | `tds-rules.ts` `TDS_THRESHOLD_RULES`, `tds-payables.ts` `thresholdCheck` | Buyer-turnover gate → TR-C2 |
| 194Q deducted by our customers (receivable preset) | Exists | `tax-rules.ts` `TDS_BASE` 194Q 0.1% | "Customer will deduct 194Q" hint → TR-C2 |
| 206C(1H) history | Exists | `tax-rules.ts` `TCS_PRESET_RULES` | — |
| 206C(1) / 206C(1F) presets and 27EQ codes | **Missing** | `TCS_27EQ_CODES` has 6CR / 6CQ only | TR-C2 |
| RCM bills and self-invoice | Exists | `PurchaseRecord.reverse_charge`, `rcm-self-invoice.ts` | Notified-goods HSN prompt → TR-C2 |
| Composition trader rate / limit / inter-State warning | Exists | `tax-rules.ts`, `bill-of-supply.ts` | Running turnover tracker → TR-C2 |
| Rule 86B warning | Exists | `gst-setoff.ts` | — |
| ITC blocked / reversal reminders | Exists | `purchase-normalize.ts`, `expiry-ops.ts` | — |
| Bank stock & book-debts statement (drawing power) | **Missing** | only the OD / CC ledger (`accounts.ts` 2100) | TR-C4 |
| Tally import / export (masters, vouchers, batches) | Exists | `tally-import*.ts`, `tally-xml.ts` | — |
| Marketplace (194-O, TCS credit), export desk | Exists | R5-A, R4-C | — |
| `wholesale` business type and trading sample data | Exists | `shop-presets.ts`, R6-B4 `demo-data.ts` | Trade sub-types → TR-C5 |

**Totals:** 56 rows checked. **40 exist** (6 of them with a small gap named in the last column), **3 partial**,
**13 missing**. Round 8 closes all 16 partial / missing rows and the 6 named gaps.

---

## 3. Ranked list: what to build now

Value 1–5 (5 = every trader of that kind meets it weekly). Effort S = 1, M = 2, L = 3. Score = value ÷ effort.

| Rank | Id | Gap | Who needs it | Value | Effort | Score | Package |
|---|---|---|---|---|---|---|---|
| 1 | TR-C5 | Trading setup profile (sub-types, packs, checklist, help, Ctrl+K) | all traders | 5 | S | 5.0 | C |
| 2 | TR-C2 | Trader statutory rules: 206C(1) / (1F) presets, 194Q buyer test, RCM-goods prompt, composition tracker | scrap / steel / timber / car / luxury dealers, cotton / tobacco buyers, composition traders | 4 | S | 4.0 | C |
| 3 | TR-A1 | Discount structures and party-item rates (compound, per unit, party rates, cash-discount term, last purchase rate, min margin) | distributors, wholesalers | 5 | M | 2.5 | A |
| 4 | TR-B1 | Weight and bag billing | commodity traders, agents | 5 | M | 2.5 | B |
| 5 | TR-B2 | Bill charges and mandi registers (market fee, aadat, hamali, tulai …) | commodity traders, agents | 5 | M | 2.5 | B |
| 6 | TR-A4 | Party-wise interest statement and bulk interest notes | wholesalers, commodity traders | 4 | M | 2.0 | A |
| 7 | TR-A2 | Scheme scope v2 and scheme claims to the principal | distributors | 4 | M | 2.0 | A |
| 8 | TR-A3 | Price-drop notes across bills and price-protection claims | distributors | 4 | M | 2.0 | A |
| 9 | TR-B3 | Brokers (dalali) on purchases and sales, brokerage with 194H | commodity / cloth traders | 4 | M | 2.0 | B |
| 10 | TR-C4 | Bank stock & book-debts statement; HSN-wise stock | traders with CC limits | 4 | M | 2.0 | C |
| 11 | TR-A5 | Returnable packaging ledger (crates, bardana, cans) | FMCG beverage / dairy distributors, mandis | 3 | M | 1.5 | A |
| 12 | TR-C1 | Commission agent desk: arrivals, sales on behalf, bikri patti; indent register | arhatiyas, indent agents | 5 | L | 1.7 | C |
| 13 | TR-C3 | Trader help, glossary and sample data (sub-type datasets) | all | 3 | S | 3.0 | C (folded into C5 effort) |
| — | — | Auction / boli entry at the yard | arhatiyas | 3 | L | 1.0 | later |
| — | — | Distributor secondary-sales upload to the company (DMS files) | distributors | 2 | M | 1.0 | later |
| — | — | Commodity contracts (forward sauda) register with delivery tracking | commodity traders | 3 | L | 1.0 | later |

Rows 1–13 are taken. TR-C1 scores below the cut but is taken because without it the "commission agent" profile has no
screen of its own; it is scoped to the minimum (no auction, no farmer advances interest).

---

## 4. Specifications (13 items)

Conventions for every item:
- **Logic and tests.** Pure logic in `src/lib/trade/**/*.ts` (new folder `src/lib/trade/` already holds
  `trade-rules.ts` of R4-C; Round 8 files are prefixed `tr-`), tested with `node:test` in `tests/tr-*.test.ts`. UI
  checks are `step(...)` blocks in `tests/e2e/smoke.mjs` (§6).
- **Strings.** Each package's own i18n area (`defineArea(en, hi)`): `src/i18n/areas/trade-r8a.ts` (A),
  `trade-r8b.ts` (B), `trade-r8c.ts` (C). Hindi trade words are the market's own (हमाली, तुलाई, आढ़त, दलाली, बारदाना,
  धलता, पट्टी, बिक्री).
- **Storage.** New company tables `mrchartist_inv_<table>` through `getTable` / `setTable`, each registered in
  `backup.ts` (`RECORD_TABLES` / `ID_TABLES`), `access.ts` `TABLE_ACTIONS`, `audit-edits.ts` `WATCHED_TABLES` (with a
  label) and, when dated / numbered, `sync-engine.ts` `DATED` / `NUMBERED`; one row each in `docs/ARCHITECTURE.md`.
  New `InvoiceRecord` keys go into `RECORD_KEYS` and `normalizeRecord` (`src/store/invoice-defaults.ts`); new line
  keys into `normalizeItem`. Additive record fields come by declaration merging in `src/types/trade-r8.ts` (one file,
  one `declare module` block per package, §6).
- **Numbers.** New series through `series-counters.ts` (`nextSeriesNumberFor` + `recordSeries`), `XXX/FY<yy-yy>/<seq>`,
  never reused after delete (recycle bin).
- **Guards.** Destructive calls `requireAccess`; writes in a locked period `assertUnlocked`; money through `round2`;
  every new delete goes through `setTable` on a watched table so the recycle bin gets the row.
- **Packs.** A pack tab is listed only with its pack on (URL still opens it), its tables are not read while the pack is
  off (`tests/tr-pack-gate.test.ts`, like `tests/r5c-pack-gate.test.ts`).
- **Help.** Every new tab / view gets a topic (`tests/help-registry.test.ts` fails otherwise) and a Ctrl+K title in
  `src/i18n/areas/discover-r6-tabs.ts`; statutory topics cite the TR ids.

### TR-A — Distributor and wholesaler pricing, claims and collections

#### TR-A1 Discount structures and party-item rates

*Seen in:* BUSY item-wise discount structures with compound discount and Party-Item price structure; Tally price levels
on debtor and creditor ledgers; Logic ERP preset party discounts and "last rate charged"; Gofrugal minimum-margin
alert.

*Today:* one line `discount_percent`, one invoice discount, price levels / slabs / lists, last sale rate.

**User story.** As an electrical distributor I bill Sharma Traders "Havells MCB at list less 18 + 4 %, ₹5 per unit
extra off on orders above 100", print "2% cash discount if paid within 7 days", and see a red mark when a line falls
below my minimum margin.

**Acceptance criteria.**
1. **Compound discount.** A line may carry `disc_chain: number[]` (≤ 3 steps, each 0–100). The editor's discount cell
   accepts "18+4" or "18+4+2". The line's `discount_percent` is set to the **effective** percent
   `100 × (1 − Π(1 − dᵢ/100))`, rounded to 6 decimals; `invoice-calc.ts` is **not changed**, so GST, HSN, Tally, books and
   every reader keep reading `discount_percent`. The chain is a snapshot for printing ("18 + 4 %").
2. **Per-unit discount.** `disc_per_unit` (₹ per line unit, ≥ 0) is applied after the chain: effective percent =
   chain effect + `disc_per_unit / rate × 100` on the chained price, again stored in `discount_percent`; re-derived when
   the rate or quantity changes; a typed `discount_percent` clears both snapshots.
3. **Party-item rates** (`party_rates` table): per client (or vendor) × catalogue / stock item: `rate?`, `disc_chain?`,
   `disc_per_unit?`, `valid_from`, `valid_to?`. Resolution order in `resolvePrice` becomes: **party rate** → price level
   → price list → slab (lower of level and slab, as today) → last rate → catalogue. Basis label "Party rate". Credit /
   debit notes are never re-priced (unchanged). Maintained in Clients → party → *Special rates* and in Distribution →
   Masters (bulk paste of item, rate, discount).
4. **Purchase side.** The bill modal offers the vendor's party rate and the **last purchase rate from this supplier**
   (`lastPurchaseRate`, same shape as `last-rate.ts`), as a hint, never auto-applied when typed.
5. **Cash-discount term.** Record field `cash_discount?: { percent, days }`, defaulted from the party
   (`Client.cash_discount`). Printed under the totals ("2% cash discount if paid by 03-11-2026: ₹1,234"). When a receipt
   arrives within the days, the receipt dialog proposes the existing settlement discount (financial credit note,
   `settlement.ts`) for the percent of the amount paid. No GST change (G8 / TR1).
6. **Minimum margin.** Optional `min_margin_percent` on stock groups (and a company default). The existing margin chip
   turns red per line below it; with credit policy **Block**, a clerk's save is held for approval with reason
   `margin` (one more reason on the existing approval gate, owner override audited).
7. Off by default: the compound / per-unit cells show only when Settings → Items → *Trade discounts* is on or a pack
   `distributor` / `commodity` is on.

**Files.** New: `src/lib/trade/tr-discounts.ts` (chain / per-unit maths, parse "18+4"), `src/lib/trade/tr-party-rates.ts`
(table, resolution hook, last purchase rate), `src/components/trade/LineDiscountCell.tsx`, `PartyRatesEditor.tsx`.
Edit: `src/lib/pricing.ts` (`resolvePrice` gains an optional `partyRate` argument — additive), `src/components/creator/pricing-actions.ts`,
one lazy mount line in `ItemsTable.tsx` (§6), `src/components/purchases/BillModal.tsx` (one hint line),
`src/components/templates/paper-helpers.ts` (one `discountText` helper, §6), `src/lib/approval-gate.ts` (reason
`margin`, one block).

**Storage.** Table `party_rates` (`master.edit`, watched "Party special rate", backed up, synced as a master; not
dated). Line fields `disc_chain`, `disc_per_unit`; record `cash_discount`; client `cash_discount`; stock group
`min_margin_percent`; settings `trade_discounts?: boolean`.

**Tests.** `tests/tr-discounts.test.ts`: 18+4 → 21.28%; 10+5+2 → 16.21%; per-unit on chained rate; a typed % clears
the chain; party rate beats level, level beats list; credit note not re-priced; cash-discount date and amount; margin
reason held for a clerk, passed for the owner (audited); invoice totals equal those of the same effective % typed by
hand (regression on `calculateInvoice`).

#### TR-A2 Scheme scope v2 and scheme claims to the principal

*Seen in:* Logic ERP schemes by group / brand / category and batch-wise free; Tally dealer schemes with end dates;
FieldAssist / Bizom scheme claims settled with the company.

*Today:* schemes per catalogue item (same / buy A get B / bill value), date window, pause (`pricing.ts`, `offers.ts`).

**User story.** As an FMCG stockist I run the company's "Buy 10 cases of any Dettol, get 1 free" for my retailers in
October, then claim the free goods and the trade discount I gave back from the company with one claim statement.

**Acceptance criteria.**
1. **Scope** (additive on `schemes` rows): `scope?: { group_ids?, item_ids?, brand?, client_ids?, level_ids? }`; a
   scheme without `scope` keeps today's single-item behaviour. Group scope counts the paid quantity across the group's
   items on the bill (mixed SKUs); the free line is the scheme's free item (or, for same-item group schemes, the
   cheapest qualifying item).
2. **Free slabs:** `free_slabs?: {min_qty, free_qty}[]` (best slab reached wins) beside the existing `buy_qty` /
   `free_qty`.
3. **Principal and claim basis:** `principal_vendor_id?`, `claim_basis?: 'free_goods_at_cost' | 'free_goods_at_rate' |
   'discount_given' | 'fixed_per_unit'`, `claim_rate?`.
4. **Scheme claims** (`trade_claims`, series `TCL/FY…`, Distribution → Claims → *Scheme claims*): pick principal +
   period → rows from issued sales documents carrying lines under that principal's schemes (free lines, offers),
   valued by the claim basis; one claim per principal per run; statuses *draft → sent → settled (credit note no. /
   date / amount received) → short-settled / rejected*. A settlement records the principal's credit note against
   the claim: the user chooses **supplier credit note with GST** (posted through `purchase-returns.ts` as
   `SUPPLIER_CN`, ITC reversal) or **financial credit** (journal Dr principal / Cr "Scheme claims received", no GST) —
   default financial (TR4).
5. Claim statement printable and CSV (the company's own format is not standard; ours lists invoice no., date,
   retailer, item, qty, free qty, value).

**Files.** New: `src/lib/trade/tr-schemes.ts` (scope match, slabs), `src/lib/trade/tr-claims.ts` (claims, settlement),
`src/components/trade/ClaimsTab.tsx` (views `schemes`, `pricedrop` (A3), `claims`). Edit: `src/lib/pricing.ts`
(`syncSchemeLines` calls the scope matcher when `scope` is set — one guarded branch), the scheme form in Settings →
Items (owned by A this round).

**Storage.** `schemes` additive fields; table `trade_claims` (`books.edit`, watched "Trade claim", dated by `date`,
numbered `TCL`, synced).

**Tests.** `tests/tr-schemes.test.ts`: group scope across SKUs; party scope excludes others; slab picks the best;
legacy scheme unchanged; claim values per basis; financial settlement posts the journal; GST settlement creates a
supplier CN; a deleted claim number stays reserved.

#### TR-A3 Price-drop notes across bills and price-protection claims

*Seen in:* Logic ERP price-drop management; distributors' "price protection" from brands.

**User story.** The company cuts the price of a fan model by ₹150 from 1 Nov and protects stock bought in the last
30 days. I issue one note run to 40 retailers for the units they bought from me in October, and claim my own stock
and those notes from the company.

**Acceptance criteria.**
1. **Price-drop run** (`price_drops`, series `PDR/FY…`): items + old / new rate (or ₹ drop per unit), effective date,
   look-back days or a period, customer filter. Rows = each customer's quantity of those items on issued, live sales
   documents in the window, less goods returned on credit notes; value = qty × drop.
2. **Issue** makes one credit note per customer (all-or-nothing, `withTablesRollback`, period lock, numbering):
   - default **financial credit note** (`note_kind: 'financial'`, reason "Price drop", no GST, `FCN/FY…`);
   - option **GST credit note** per original invoice (reason "Rate difference", `goods_returned: false`) — allowed only
     when the run says "agreed before supply" and each note links its invoice (`doc_links`); notes past the Sec 34(2)
     date are refused (existing `gst-penalties.ts` rule).
   Each note carries `price_drop_id`.
3. **Own stock** on the effective date for those items (stock engine, godown-wise) is listed for the claim.
4. **Price-protection claim**: one click creates a `trade_claims` row (kind `price_drop`) to the principal for notes
   issued + own stock units × drop.
5. Undo cancels the run's notes (never deletes issued numbers).

**Files.** New: `src/lib/trade/tr-price-drop.ts`; view in `ClaimsTab.tsx`. Edit: none outside A's files except one
`doc_links` relation name `price_drop` (append-only list in `documents.ts`, §6).

**Storage.** Table `price_drops` (`books.edit`, watched "Price-drop run", dated `date`, numbered `PDR`). Record field
`price_drop_id`.

**Tests.** `tests/tr-price-drop.test.ts`: window and returns netting; financial vs GST mode; Sec 34(2) refusal; claim
amount = notes + own stock; undo cancels; rerun of the same run refused.

#### TR-A4 Party-wise interest statement and bulk interest notes

*Seen in:* Tally Ledger Interest report and interest notes picking bills; BUSY Interest Report.

*Today:* `interest.ts` per invoice and the "Add late fee" draft invoice (`late-fee.ts`, G6); `ledger-interest.ts`
(interest parameters on ledgers) without a screen.

**User story.** At month end I see, for every customer, the overdue bills, days late after the credit days and the
interest at 18% a year, untick the parties I will not charge, and raise one interest invoice per party.

**Acceptance criteria.**
1. Receivables → **Interest** tab (`/receivables?tab=interest`, not pack-gated): as-of date, rate source (party's
   `late_fee.percent_pa` → company default `interest_settings.rate` → none), grace days, basis (from due date / from
   bill date + credit days), minimum ₹ per party.
2. Rows per party with bill-wise detail (opening bills included — `opening-bills.ts`), payments and credit notes dated
   before each day reduce the balance (the `interest.ts` maths, unchanged).
3. **Raise** creates, per ticked party, one draft late-fee invoice through `late-fee.ts` (rate / HSN from the
   principal supply, G6 / TR18), listing the bills in its annexure line text; `interest_run_id` on each. Runs are
   recorded (`interest_runs`, dated) so the same bill-period is not charged twice (warning lists overlaps).
4. Payables side (read-only): interest suppliers may charge us, and the existing MSMED interest (`msme.ts`).
5. Statement printable / CSV / WhatsApp per party (`wa.me` link, user-tapped).

**Files.** New: `src/lib/trade/tr-interest.ts` (party aggregation over `interest.ts`), `src/components/trade/InterestTab.tsx`.
Edit: `src/pages/page-tabs.ts` (one `RECEIVABLES_TABS` row, §6), `src/pages/Receivables.tsx` (one lazy tab line).

**Storage.** Table `interest_runs` (`books.edit`, watched "Interest run", dated `date`); object `interest_settings`
`{rate?, grace_days?, basis?, min_amount?}` (`settings.manage`); record `interest_run_id`.

**Tests.** `tests/tr-interest.test.ts`: party totals equal the sum of `interest.ts` per invoice; opening bills
included; part payments; overlap warning; minimum suppresses; draft invoices carry the run id.

#### TR-A5 Returnable packaging ledger

*Seen in:* BUSY Bardana / Crate Management; beverage and dairy distributors' crate books.

**User story.** I send 40 crates with today's bill and take back 35; at month end I see who holds how many crates and
deposits, and charge for crates not returned in 60 days.

**Acceptance criteria.**
1. Master `packaging_types` (name, unit, deposit per unit ₹, charge-if-lost rate, "returnable" flag).
2. Movements `packaging_moves`: date, party (client or vendor), type, out / in quantities, optional document link;
   entered from a lazy "Crates / bags" strip in the editor and bill modal (out with a sale, in with a return or a
   receipt), or on the Distribution → **Packaging** tab.
3. Balances per party and type as on a date; ageing of unreturned units; deposits held.
4. **Deposit** received / refunded posts Dr Cash/Bank Cr "Packaging deposits" (current liability) through
   `saveVoucher` — no GST on a refundable deposit (TR8). **Charge for unreturned**: a draft invoice line "Crates not
   returned" at the charge rate, with the item's HSN and GST (sale of the crate, TR8), and an `in` move closing them.
5. Gated by `distributor`, `commodity` or `agency` packs (or Settings → Items → *Returnable packaging*).

**Files.** New: `src/lib/trade/tr-packaging.ts`, `src/components/trade/PackagingTab.tsx`, `PackagingStrip.tsx`.
Edit: one lazy mount line in the editor summary area and in `BillModal.tsx` (§6).

**Storage.** `packaging_types` (`master.edit`, watched), `packaging_moves` (`doc.create`, watched "Packaging
movement", dated `date`, synced).

**Tests.** `tests/tr-packaging.test.ts`: balance and ageing; deposit journal; charge draft and closing move; pack-off
gate (tables not read).

### TR-B — Commodity and mandi trade

#### TR-B1 Weight and bag billing

*Seen in:* BUSY "Loose quantity handling (bags, weight, crates)"; Tally Actual vs Billed quantity; grain-market bag
standards (50 kg + 0.6 kg gunny).

**User story.** I sell 120 bags of wheat: gross 6,072 kg on the dharam-kanta slip, tare 0.6 kg a bag, dhalta 1 kg per
quintal; the bill shows the bag maths and charges ₹2,450 per quintal on the net 59.40 qtl.

**Acceptance criteria.**
1. A line of an item marked `sold_by_weight_bags` (stock item / catalogue, additive) shows a **weight sub-row**:
   packages (count), package kind (BAG / KATTA / BORI / CRATE / BALE / custom), gross weight, tare per package,
   deduction (`per_package` kg / `per_qtl` kg / `percent`), unit of gross weight (KG / QTL / MT).
2. Net = gross − packages × tare − deduction (a `per_qtl` or `percent` deduction is taken on the weight after tare),
   rounded to the gram, converted to the line's billing unit through the item's alternate units
   (`units.ts`); **net becomes the line `quantity`** (3 decimals), so `invoice-calc.ts`, GST, HSN (UQC of the billing
   unit) and stock (net × `unit_factor`) are unchanged. The sub-row values are snapshots on the line:
   `wt: { packages, kind, gross, tare_per_package, deduction: {basis, value}, gross_unit }`.
3. Typing a quantity directly clears `wt` (manual line). Changing gross / packages recomputes quantity.
4. Printing: a sub-line under the item ("120 BAG · gross 6,072 kg − tare 72 kg − dhalta 60 kg = 5,940 kg") on all
   standard layouts (`paper-helpers.ts`, §6); a "Weight slip" print for the dispatch (no prices).
5. Same sub-row on purchase bills / GRN lines (`PurchaseLine.wt`, declared in `trade-r8.ts`), so arrivals from farmers
   are weighed the same way.
6. Packages may also post a packaging movement (TR-A5) when the kind is returnable (one call into A's API, guarded).

**Files.** New: `src/lib/trade/tr-weight.ts` (maths, text), `src/components/trade/LineWeightRow.tsx`. Edit: one lazy
mount line in `ItemsTable.tsx` and in the bill line editor (§6), `paper-helpers.ts` (`weightText`, §6),
`src/store/invoice-defaults.ts` (`normalizeItem` keeps `wt`).

**Storage.** Line field `wt` (invoice and purchase lines); item flag `sold_by_weight_bags`. No table.

**Tests.** `tests/tr-weight.test.ts`: the wheat example; per-qtl and % deductions; KG ↔ QTL billing; typed quantity
clears; stock moves equal net × factor; HSN quantity in the billing UQC.

#### TR-B2 Bill charges and mandi registers

*Seen in:* BUSY bill sundries (Jhadai, Tulai, Safai), Market Fee Register; mandi trade practice (aadat, hamali,
palledari, bardana, dharmada).

**User story.** On every grain sale I add market fee 1%, aadat 2.5%, hamali ₹4 per bag and bardana ₹30 per bag
automatically; on purchases from farmers I record the market fee I pay; at month end I print the market fee register.

**Acceptance criteria.**
1. Master `trade_charge_heads`: name, side (`sale` / `purchase` / both), basis (`percent` of goods value /
   `per_package` / `per_qtl` / `per_unit` / `fixed`), default rate (none preset — rates are State- and mandi-specific,
   TR6), **GST treatment** (`in_value` — part of the goods' value at the goods' rate and HSN, Sec 15(2)(a)/(c), the
   default; `own_rate` — separate taxable line with its own SAC and rate; `outside` — reimbursement outside value, only
   with the pure-agent tick, G7), posting ledger (income for sale side, expense for purchase side, or a payable such
   as "Market fee payable"), auto-apply on/off, order.
2. Applied in the editor and the bill modal as **document lines** flagged `charge_head_id` (never a new total field),
   computed from the goods lines (value / packages from TR-B1 / net qtl), recomputed on change, removable. `in_value`
   lines take the HSN and rate of the goods (highest-value goods line for mixed bills, same as G5) and are kept out
   of HSN **quantity** (value counted).
3. Registers (Distribution → **Mandi**): per head and period — documents, base, rate, amount; the **Market fee register**
   (sale and purchase sides, CSV); "payable to mandi" balance from the posting ledger.
4. Gated by `commodity` / `agency` packs (heads usable by anyone via Settings → Items → *Bill charges*).

**Files.** New: `src/lib/trade/tr-charges.ts`, `src/components/trade/ChargesStrip.tsx`, `MandiTab.tsx`. Edit: one
lazy mount line in the editor summary and `BillModal.tsx` (§6); `src/lib/ledger/postings.ts` **not** edited (charge
lines post as lines; the ledger mapping for `charge_head_id` lines uses the existing per-line account hook — if none
exists, B adds one guarded branch and says so in its feature doc).

**Storage.** `trade_charge_heads` (`master.edit`, watched "Bill charge head"); line field `charge_head_id`. No new
series.

**Tests.** `tests/tr-charges.test.ts`: each basis; in-value line takes the goods rate / HSN; own-rate line; pure-agent
line outside value; register totals; recompute after a quantity change; GSTR-1 HSN quantity unchanged by charge lines.

#### TR-B3 Brokers (dalali) on purchases and sales

*Seen in:* Miracle textile edition for brokers and mill agents; BUSY broker field; Vyapar mandi commission per
transaction.

**User story.** A cloth broker brought this sale; I owe him 1% brokerage, my buyer's broker charges 25 paise a metre;
at month end I settle brokers' statements with TDS 194H once a broker crosses ₹20,000.

**Acceptance criteria.**
1. `sales_agents` rows gain `kind?: 'agent' | 'broker'` (absent = agent), `brokerage_basis?: 'percent' | 'per_package' |
   'per_qtl' | 'per_unit'`, `brokerage_rate?`, `paid_by?: 'us' | 'other_party'`, `vendor_id?` (the broker as a payee).
2. Documents carry `broker_id` (sales: record field; purchases: `PurchaseRecord.broker_id`), separate from `agent_id`
   (salesman). Picked in the editor / bill modal from a lazy picker; default from the party (`Client.broker_id`,
   `Vendor.broker_id`).
3. **Brokerage statement** per broker and period (Distribution → **Brokers**): documents, base (taxable value /
   packages / qtl / qty), rate, brokerage; `paid_by: 'other_party'` rows are memo only.
4. **Post** creates the payable journal (Dr Brokerage expense, Cr broker as creditor) through `saveVoucher`, with
   **194H TDS** computed by `tds-payables.ts` (`thresholdCheck('194H', …)` over the broker's FY postings) — the journal
   splits Cr TDS payable; table `brokerage_postings` (non-overlapping periods, like `commission_postings`).
5. Closes T15 for brokers; salesman commission keeps its current behaviour (T15 stays open for salesmen, but the same
   194H option is offered on its posting dialog as an opt-in checkbox).

**Files.** New: `src/lib/trade/tr-brokers.ts`, `src/components/trade/BrokersTab.tsx`, `BrokerPicker.tsx`. Edit:
`src/lib/sales-commission.ts` (additive fields + the 194H opt-in, one block), one lazy mount line in the editor and
`BillModal.tsx` (§6).

**Storage.** `sales_agents` additive fields; table `brokerage_postings` (`books.edit`, watched "Brokerage posting",
dated `to`); record / bill field `broker_id`; client / vendor `broker_id`.

**Tests.** `tests/tr-brokers.test.ts`: each basis; memo rows excluded from postings; 194H below / above ₹20,000 with
catch-up; overlapping periods refused; undo deletes the journal; 1 Oct 2024 rate change (5% → 2%) by posting date.

### TR-C — Agents, trader statutory rules, bank statements and setup

#### TR-C1 Commission agent desk (arrivals, sales on behalf, bikri patti) and indent register

*Seen in:* BUSY for Mandi (Kachchi / Pakki aadat, Bikri report, Adhatiya stock statement); Circular 57/31/2018-GST.

**User story.** Farmer Ram Singh brings 80 bags of mustard. I weigh them in as an arrival, sell them to two buyers
over two days in my name, and give Ram Singh a patti: gross sales ₹4.6 lakh less my aadat 2.5%, market fee, hamali,
freight and his advance — net ₹4.41 lakh, paid by NEFT.

**Acceptance criteria.**
1. **Arrivals** (`arrivals`, series `ARR/FY…`): date, principal (farmer / trader — a vendor row, `principal_kind:
   'agriculturist' | 'registered' | 'unregistered'`), lot no., item, packages, weight (TR-B1 maths), godown, vehicle /
   LR, advance paid. An arrival brings goods into stock as **consignment stock** in a godown of kind `consignment`
   (new value in the append-only `Godown.kind` union — **non-saleable for own sales, saleable only on agency lines**;
   `nonSaleableGodowns` decides per AGENTS.md).
2. **Sales on behalf**: an invoice line picks the lot (`arrival_id`); the record is marked `agency: true`. The invoice is
   issued in our name (Schedule I para 3 agent, TR10). GST as the goods require (exempt agricultural produce → nil /
   exempt lines). Stock leaves the consignment godown.
3. **Bikri patti** (`sale_pattis`, series `PAT/FY…`): per principal and one or more lots — gross sales (from the agency
   lines), deductions from TR-B2 charge heads with side `agency` (aadat %, market fee, hamali, tulai, freight), advance
   recovered, net payable; printable / WhatsApp. **Posting** (one `saveVoucher` journal): Dr Sales (agency transfer)
   gross, Cr principal net, Cr Commission income (aadat), Cr each charge's ledger. Result: P&L shows only the
   commission and recoveries for settled lots; the agency tab lists **unsettled lots** (sales still in Sales) with a
   year-end checklist row (TR22).
4. **Commission GST:** the aadat line on the patti is exempt when the produce is agricultural produce (entry 54, TR9),
   else 18% SAC 996111 as a separate tax invoice to the principal (`own_rate` charge head).
5. **Pakki aadat** (trader buys and resells) needs nothing new: a purchase bill from the farmer (RCM prompt TR-C2 when
   notified) and normal sales.
6. **Indent register** (`indents`, series `IND/FY…`): buyer, principal (mill / manufacturer), item, qty, rate,
   commission % or per unit, delivery date, status *placed → dispatched (principal's invoice no.) → paid → commission
   billed*. "Bill commission" makes one services invoice to the principal (SAC 996111, 18%, customer TDS 194H preset)
   for the selected dispatched indents. Reports: pending indents, commission due.
7. Gated by the `agency` pack.

**Files.** New: `src/lib/trade/tr-arrivals.ts`, `tr-patti.ts`, `tr-indents.ts`, `src/components/trade/AgencyTab.tsx`
(views `arrivals`, `pattis`, `indents`). Edit: `src/types/stock.ts` (`Godown.kind` + `'consignment'`, append-only),
`src/lib/godowns.ts` (`nonSaleableGodowns` + agency exception, one block), one lazy lot-picker mount in the editor
line (§6).

**Storage.** `arrivals` (`doc.create`, watched, dated `date`, numbered `ARR`), `sale_pattis` (`books.edit`, watched,
dated, numbered `PAT`), `indents` (`doc.create`, watched, dated, numbered `IND`); record `agency`, line `arrival_id`;
vendor `principal_kind`.

**Tests.** `tests/tr-agency.test.ts`: arrival stock in the consignment godown; own sale from it refused; agency sale
allowed; patti maths and journal (net payable, commission income); unsettled lot list; advance recovery; indent
commission invoice; pack-off gate.

#### TR-C2 Trader statutory rules

**User story.** As a scrap dealer my bill offers "TCS 394(1) scrap 2%" from 1 Apr 2026 (1% before); as a buyer under
₹10 crore turnover I am told 194Q does not apply to me; when I buy raw cotton from a farmer the bill asks whether
reverse charge applies; as a composition trader I see how close I am to ₹1.5 crore.

**Acceptance criteria.**
1. **Rule file** `src/lib/trading-rules.ts` (date-keyed `Versioned`, append-only, same shape as `tax-rules.ts`; never
   imported by `tax-rules.ts` or the shell):
   - `TCS_SPECIFIED_GOODS_RULES` (206C(1) / Sec 394(1) Sl. 1–5): liquor, tendu, timber (lease / other), other forest
     produce, scrap, minerals — rows from 2017-07-01, the COVID 25% cut 14 May 2020 – 31 Mar 2021, and 2026-04-01 (2%
     each per the Finance Act 2026 reading; timber / forest produce 2% flagged unverified, TR14). Each with the 27EQ
     code (6CA, 6CB, 6CC, 6CD, 6CE, 6CI, 6CJ) and the 2025-Act payment code where known (1068–1074, unverified).
   - `TCS_1F_RULES` (206C(1F) / Sec 394(1) Sl. 6): motor vehicle above ₹10 lakh 1% (from 2016-06-01, code 6CL);
     notified luxury goods list, single item above ₹10 lakh, 1% from 2025-04-22 (N 36/2025, code unverified, TR15).
   - `TCS_NO_PAN_RULES` (206CC: twice the rate or 5%, whichever higher; unverified row).
   - `BUYER_194Q_TURNOVER_RULES`: ₹10 crore from 2021-07-01; a 2026-04-01 row repeating it with source "Act 2025 text
     to confirm" (TR13).
   - `RCM_NOTIFIED_GOODS_RULES`: HSN prefix, goods, supplier kind, from-date — 0801 (cashew not shelled / peeled),
     14049010 (bidi wrapper leaves), 2401 (tobacco leaves), 5004–5006 (silk yarn), 5201 (raw cotton, from 2017-11-15),
     3301 (specified mint oils, date unverified) (TR17).
   - `ita2025.ts` gains `ACT_REF_RULES` rows `206C1` → "Sec 394(1) [Table: Sl. No. 1–5]" and `206C1F` → "Sec 394(1)
     [Table: Sl. No. 6]" (unverified) — append-only, labels by date.
2. **TCS presets**: the editor's TCS picker (`AdvancedTaxPanel.tsx`) lists `tcsPresets(date)` plus the trading presets
   in force on the document date (one merge line, §6); a 206C(1F) preset applies only when a line's value exceeds ₹10
   lakh (warning otherwise); a "Buyer gave Form 127 / 27C declaration" tick on the party (`Client.tcs_declaration`
   with date) suppresses 206C(1) presets. Form 27EQ (`tds-returns.ts`) maps the new labels through
   `TCS_27EQ_CODES` (appended rows).
3. **194Q buyer test**: Settings → TDS gains "Our business turnover last FY (₹)" per FY (`tds_settings.turnover_by_fy`).
   Under ₹10 crore → 194Q on a bill is refused with the reason (deduction section list hides it); unknown → allowed
   with a warning. Sales side: a customer marked `deducts_194q` (Client, additive) shows "will deduct 194Q above ₹50
   lakh" in the editor once our FY sales to them pass ₹50 lakh, and the TDS receivable register expects it.
4. **RCM goods prompt**: on a purchase bill line whose HSN matches a notified-goods row in force and whose vendor is
   unregistered / an agriculturist (`principal_kind`), the bill shows "Reverse charge may apply (N 4/2017-CT(R))" with
   *Apply* (sets `reverse_charge`, links the self-invoice flow).
5. **Composition tracker**: GST reports → Compliance (existing tab) gains a strip for composition profiles: FY
   aggregate turnover so far (all supplies incl. exempt, `documentTurnover`) vs the limit in force; at 80% amber, at
   100% red with "opt out within 7 days (Rule 6(2))" text and the CA ids.

**Files.** New: `src/lib/trading-rules.ts`, `src/lib/trade/tr-statutory.ts`. Edit: `src/lib/ita2025.ts` (append rows),
`src/lib/tds-rules.ts` (`TCS_27EQ_CODES` appended rows — the list lives in `tds-rules.ts`, which is already lazy),
`src/components/creator/AdvancedTaxPanel.tsx` (one merge line), `src/components/purchases/BillModal.tsx` (one lazy
notice mount, §6), `src/lib/tds-payables.ts` (194Q gate, one block), `src/components/gst-reports/ComplianceView.tsx`
(one lazy strip line).

**Storage.** `tds_settings.turnover_by_fy` (existing object, additive); client `tcs_declaration`, `deducts_194q`.

**Tests.** `tests/tr-statutory.test.ts`: TCS rate by date (31 Mar 2026 vs 1 Apr 2026); COVID window; 1F only above ₹10
lakh; declaration suppresses; 194Q refused under ₹10 crore and allowed above; RCM prompt by HSN and date (raw cotton
before 15 Nov 2017: no prompt); composition 80% / 100%; every row has a `source`; `trading-rules.ts` is not reachable
from `main.tsx` (import-graph test like the existing first-paint guards).

#### TR-C3 Trader help, glossary and sample data

**Acceptance criteria.**
1. Help topics for every new tab / view (A: Claims ×3, Packaging, Receivables → Interest; B: Mandi, Brokers; C:
   Agency ×3, Reports → Stock statement, Inventory → HSN stock) in the matching lazy topic file, with TR ids on
   statutory ones.
2. Glossary terms (`glossary.ts`, en + hi): aadat (kachi / pakki), arhatiya, bikri patti, dalali, hamali, tulai,
   palledari, bardana, dhalta, katta, market fee / mandi shulk, indent, price protection, scheme claim, drawing power,
   194Q, 206C(1), 206C(1F), Form 127, compound discount.
3. Ctrl+K titles in `discover-r6-tabs.ts`; `PACK_TABS` rows (§4 TR-C5) with labels in `trade-r8c.ts`.
4. **Sample data** (R6-B4 profiles): `profile-trading.ts` builds rows per `trade_kind` — distributor (party rates,
   a group scheme, crates), commodity (weight lines, charge heads, a broker), agent (an arrival, two agency sales, a
   patti, two indents). Only into the Demo company.

**Files.** `src/lib/help/topics-*.ts` (append-only blocks, §6), `src/lib/help/glossary.ts` (append), `src/lib/demo/profile-trading.ts`,
`src/lib/demo/profiles.ts` (one `case`).

**Tests.** Existing `help-registry`, `help-glossary`, `demo-data` tests extended; `tests/tr-demo.test.ts` checks each
dataset loads with its packs and that no row reaches a non-demo company.

#### TR-C4 Bank stock & book-debts statement; HSN-wise stock

*Seen in:* every trader with a cash-credit limit files a monthly stock and book-debts statement with the bank
(drawing power = (stock − creditors) × (1 − stock margin) + eligible debtors × (1 − debtor margin)).

**Acceptance criteria.**
1. Reports → **Stock statement** (`/reports?tab=stockstatement`, not pack-gated): month end; stock at cost by group
   (stock engine, valuation method of the books, `loadStockValuer()` so it agrees with Books), less consignment stock
   (TR-C1); sundry creditors for goods; debtors aged ≤ 90 / > 90 days (`receivables.ts`); margins (defaults 25% stock,
   40% debtors, editable, "your sanction letter decides"); drawing power; sanctioned limit and outstanding (the CC
   ledger balance, `bankOd`). Print / XLSX (`xlsx.ts`) in a common bank layout; settings saved per bank account
   (`bank_statement_settings`).
2. Inventory → **HSN stock** (`/inventory?tab=hsn`): closing quantity (base UQC) and value by HSN × godown as on a
   date; CSV.

**Files.** New: `src/lib/trade/tr-stock-statement.ts`, `src/lib/trade/tr-hsn-stock.ts`, `src/components/trade/StockStatementTab.tsx`,
`HsnStockTab.tsx`. Edit: `page-tabs.ts` (one `REPORTS_TABS` row, one `INVENTORY_TABS` id, §6), `Reports.tsx`,
`Inventory.tsx` (one lazy tab line each).

**Storage.** Object `bank_statement_settings` (`settings.manage`): per bank account margins, limit, ageing cut-off.

**Tests.** `tests/tr-stock-statement.test.ts`: drawing power maths; > 90 days excluded; consignment stock excluded;
stock value equals the Books closing stock for the same date; HSN totals equal the stock summary.

#### TR-C5 Trading setup profile

**User story.** When I choose "Wholesale / trading" in setup I pick *Commission agent / broker*; the app lands me on
the Agency tab, shows Mandi and Brokers, hides POS, and the checklist asks me to add a principal, an arrival and a
charge head.

**Acceptance criteria.**
1. `PackId` gains `distributor`, `commodity`, `agency` (`PACK_IDS` order appended). `PACK_OF_TYPE` unchanged.
2. Settings field `trade_kind?: 'distributor' | 'wholesaler' | 'commodity' | 'agent'` (additive). `applyTradeKind(kind)`
   (`shop-presets.ts`) returns modules, packs and defaults:

   | trade_kind | modules (shop mode) | industry_packs | landing | due days | template |
   |---|---|---|---|---|---|
   | distributor | wholesale preset + `pos` off, `recurring` off | `distributor` | `/distribution?tab=claims` | 21 | `gst_tax_invoice` |
   | wholesaler | wholesale preset | `[]` | `/invoice` | 30 | `gst_tax_invoice` |
   | commodity | wholesale preset | `commodity` | `/invoice` | 15 | `gst_tax_invoice` |
   | agent | `purchases`, `inventory`, `accounts`, `banking`, `reports`, `gst`, `tds` | `agency`, `commodity` | `/distribution?tab=agency` | 7 | `gst_tax_invoice` |

   Settings toggles turned on by the profile: `trade_discounts` (distributor, wholesaler), returnable packaging
   (distributor, commodity, agent).
3. Wizard: the `wholesale` card opens a second choice with four cards (lazy, inside the wizard chunk). Settings →
   Features shows "Trade profile" with the same four and "Custom" (packs kept as set).
4. Existing `wholesale` companies (no `trade_kind`): unchanged; the setup checklist (R6-A1) shows a step
   `tradeProfile` "Pick your trade" until chosen or skipped.
5. Checklist steps per kind (catalogue `checklist-steps.ts`, append-only): distributor → `partyRates`, `schemeScope`;
   commodity → `chargeHeads`, `weightItem`; agent → `principal`, `arrival`, `chargeHeads`.
6. `PACK_TABS` rows (appended block `// R8`): `/distribution?tab=claims` (distributor; views `schemes`, `pricedrop`,
   `claims`), `/distribution?tab=packaging` (distributor, alsoPacks commodity / agency), `/distribution?tab=mandi`
   (commodity, alsoPacks agency), `/distribution?tab=brokers` (commodity, alsoPacks agency), `/distribution?tab=agency`
   (agency; views `arrivals`, `pattis`, `indents`). `DISTRIBUTION_TABS` becomes objects `{ id, pack?, alsoPacks? }` and
   `Distribution.tsx` filters with a new `visiblePackTabs` (industry-packs.ts, supports `alsoPacks`).
7. Shell: `PACK_ROUTES['/distribution']` = `['transport', 'distributor', 'commodity', 'agency']` (inline copy, pinned by
   `tests/industry-packs.test.ts`). No other shell change.
8. Features catalogue (`features-catalog.ts`): three pack rows with `PACK_HREF`.

**Files.** Edit: `src/lib/industry-packs.ts`, `src/lib/shop-mode.ts` (one line), `src/lib/shop-presets.ts`,
`src/lib/features-catalog.ts`, `src/lib/checklist-steps.ts`, `src/components/onboarding/SetupWizard.tsx`,
`src/components/settings/FeaturesPanel.tsx`, `src/pages/page-tabs.ts` (Distribution list), `src/pages/Distribution.tsx`.

**Tests.** `tests/industry-packs.test.ts` (extend: new ids, no implied pack for wholesale, inline copy pinned);
`tests/tr-profile.test.ts`: each kind's modules / packs / landing; existing wholesale company unchanged; checklist
steps by kind; `visiblePackTabs` with `alsoPacks`.

---

## 5. Work packages

Three packages, each one agent in its own worktree. **Merge order: TR-C → TR-A → TR-B.** C owns the pack ids, the
Distribution tab list, `trade-r8.ts` scaffolding and the rule file that A and B read.
Round 7 (hotel) merges independently; whichever round merges second rebases and resolves the append-only rows in §6.

### TR-A — Distributor and wholesaler pricing, claims and collections (5 items: A1–A5)

Owned (new): `src/lib/trade/tr-{discounts,party-rates,schemes,claims,price-drop,interest,packaging}.ts`;
`src/components/trade/{LineDiscountCell,PartyRatesEditor,ClaimsTab,InterestTab,PackagingTab,PackagingStrip}.tsx`;
`src/i18n/areas/trade-r8a.ts`; `docs/features/trade-pricing-r8.md`; tests `tr-discounts`, `tr-schemes`,
`tr-price-drop`, `tr-interest`, `tr-packaging`.
Owned (edit): `src/lib/pricing.ts`, `src/lib/offers.ts`, `src/components/creator/pricing-actions.ts`,
`src/lib/approval-gate.ts` (reason `margin`), the scheme form / Settings → Items scheme panel, `src/pages/Receivables.tsx`.
Shared (§6): `ItemsTable.tsx`, `InvoiceCreator.tsx` / `SummaryPanel.tsx` mount area, `BillModal.tsx`,
`paper-helpers.ts`, `page-tabs.ts`, `documents.ts` relation list, `trade-r8.ts`, registries.
Budget: first paint 0; total ≤ 13 kB gz.

### TR-B — Commodity and mandi trade (3 items: B1–B3)

Owned (new): `src/lib/trade/tr-{weight,charges,brokers}.ts`; `src/components/trade/{LineWeightRow,ChargesStrip,MandiTab,BrokersTab,BrokerPicker}.tsx`;
`src/i18n/areas/trade-r8b.ts`; `docs/features/commodity-trade-r8.md`; tests `tr-weight`, `tr-charges`, `tr-brokers`.
Owned (edit): `src/lib/sales-commission.ts`, `src/store/invoice-defaults.ts` (`normalizeItem` `wt`, `charge_head_id`
— B is the only package editing `normalizeItem` this round; A's and C's line keys are added by B on request in one
commit, or appended after rebase).
Shared (§6): as A, plus `src/lib/ledger/postings.ts` only if the per-line account hook is missing (one guarded branch).
Budget: first paint 0; total ≤ 11 kB gz.

### TR-C — Agents, statutory rules, bank statements and setup (5 items: C1–C5)

Owned (new): `src/lib/trading-rules.ts`; `src/lib/trade/tr-{arrivals,patti,indents,statutory,stock-statement,hsn-stock}.ts`;
`src/components/trade/{AgencyTab,StockStatementTab,HsnStockTab}.tsx`; `src/types/trade-r8.ts` (scaffold with three
package blocks); `src/lib/demo/profile-trading.ts`; `src/i18n/areas/trade-r8c.ts`; `docs/features/trade-agents-r8.md`;
tests `tr-agency`, `tr-statutory`, `tr-stock-statement`, `tr-profile`, `tr-demo`, `tr-pack-gate`.
Owned (edit): `src/lib/industry-packs.ts`, `src/lib/shop-mode.ts` (one line), `src/lib/shop-presets.ts`,
`src/lib/features-catalog.ts`, `src/lib/checklist-steps.ts`, `src/lib/ita2025.ts`, `src/lib/tds-rules.ts`
(`TCS_27EQ_CODES` rows), `src/lib/tds-payables.ts` (194Q gate), `src/lib/godowns.ts`, `src/types/stock.ts`,
`src/components/onboarding/SetupWizard.tsx`, `src/components/settings/FeaturesPanel.tsx`,
`src/components/creator/AdvancedTaxPanel.tsx`, `src/components/gst-reports/ComplianceView.tsx`,
`src/pages/{Distribution,Reports,Inventory}.tsx`, `src/lib/demo/profiles.ts`, help topic files and `glossary.ts`
(C writes every R8 topic, using A's and B's tab ids from this PRD).
Budget: first paint ≤ +0.1 kB gz (the `PACK_ROUTES` line); total ≤ 11 kB gz.

**Combined:** first paint ≤ 184.3 kB; total JS ≤ ~2569 kB (+35 kB), leaving ≥ 31 kB for Round 7. Each package runs
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run check:size` on its branch and after rebase.

---

## 6. Shared-file protocol

| File | Who | Rule |
|---|---|---|
| `src/types/trade-r8.ts` | C creates | One `declare module` block per package, marked `// TR-A`, `// TR-B`, `// TR-C`; each package edits only its block. A: line `disc_chain`, `disc_per_unit`; record `cash_discount`, `price_drop_id`, `interest_run_id`; client `cash_discount`. B: line `wt`, `charge_head_id`; record `broker_id`; `PurchaseLine.wt`, `PurchaseRecord.broker_id`; client / vendor `broker_id`. C: record `agency`, line `arrival_id`; vendor `principal_kind`; client `tcs_declaration`, `deducts_194q`. |
| `src/store/invoice-defaults.ts` (`RECORD_KEYS`, `normalizeRecord`, `normalizeItem`) | B (owner) | B adds every R8 key listed above in one commit at the start of its branch (all three packages' keys, from this table). A and C do not edit it. |
| `src/components/creator/ItemsTable.tsx` | A, B, C | Each adds **one** lazy sub-row mount line in the line's detail area, in order A (`LineDiscountCell`), B (`LineWeightRow`), C (lot picker), each guarded by its setting / pack. No other edit. |
| Editor summary area (`SummaryPanel.tsx`) | A, B | One lazy mount line each: A `PackagingStrip` + cash-discount line; B `ChargesStrip` + `BrokerPicker`. |
| `src/components/purchases/BillModal.tsx` | A, B, C | One lazy mount line each: A last purchase rate / packaging; B weight row, charges, broker; C RCM-goods notice. |
| `src/components/templates/paper-helpers.ts` | A, B | A appends `discountText`, B appends `weightText`; each adds one entry to the sub-line join. |
| `src/pages/page-tabs.ts` | A, C | A appends the `interest` row to `RECEIVABLES_TABS`; C converts `DISTRIBUTION_TABS` to objects and appends `claims`, `packaging`, `mandi`, `brokers`, `agency`, appends `stockstatement` to `REPORTS_TABS` and `hsn` to `INVENTORY_TABS`. |
| `src/pages/Distribution.tsx` | C (owner) | C mounts A's `ClaimsTab` / `PackagingTab` and B's `MandiTab` / `BrokersTab` lazily by import path named in this PRD; if a package has not merged, C commits a one-line stub component that the package replaces. |
| `src/lib/industry-packs.ts` | C | Pack ids, `visiblePackTabs`, the `// R8` `PACK_TABS` block. |
| `src/lib/shop-mode.ts` | C | Only the `PACK_ROUTES['/distribution']` array. |
| `src/lib/documents.ts` | A | One relation name `price_drop` appended. |
| `src/lib/backup.ts`, `access.ts`, `audit-edits.ts`, `sync-engine.ts` | each its own rows | Append-only blocks `// R8-A`, `// R8-B`, `// R8-C` with the tables of §6 storage summary; merge conflicts are resolved by keeping both blocks. |
| `src/lib/help/topics-*.ts`, `glossary.ts`, `src/i18n/areas/discover-r6-tabs.ts` | C | C writes all R8 topics and titles in one `// R8` block per file. |
| `tests/e2e/smoke.mjs` | C, A, B | One appended `step(...)` block each, in merge order: C "R8-C trade profile + agency", A "R8-A discounts + claims", B "R8-B weight + charges". |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md` | lead | After merge: a Round 8 section; table rows; the storage keys, the `trading-rules.ts` rule-file note, `Godown.kind` `consignment` decision, and "agency sales post through the patti journal". |
| `docs/CA_REVIEW.md` | lead | TR items are added with this PRD; packages report changes as "Round 8 changes that touch existing items" rows in their feature docs, folded in by the lead. |
| Round 7 overlap | lead | Expected shared files with Round 7: `industry-packs.ts` (`PackId`, `PACK_TABS`), `shop-mode.ts` (`PACK_ROUTES`), `shop-presets.ts`, `features-catalog.ts`, `checklist-steps.ts`, registries, help files, `smoke.mjs`, `CA_REVIEW.md`. All edits are append-only blocks; the second round to merge keeps both. |

### Storage summary

| Key / field | Package | Kind | Backed up | Synced | Audited | `TABLE_ACTIONS` |
|---|---|---|---|---|---|---|
| `party_rates` | A | table | yes | yes | yes | `master.edit` |
| `trade_claims` (`TCL`) | A | table, dated, numbered | yes | yes | yes | `books.edit` |
| `price_drops` (`PDR`) | A | table, dated, numbered | yes | yes | yes | `books.edit` |
| `interest_runs` | A | table, dated | yes | yes | yes | `books.edit` |
| `interest_settings` | A | object | yes | yes (singleton) | yes | `settings.manage` |
| `packaging_types` | A | table | yes | yes | yes | `master.edit` |
| `packaging_moves` | A | table, dated | yes | yes | yes | `doc.create` |
| `trade_charge_heads` | B | table | yes | yes | yes | `master.edit` |
| `brokerage_postings` | B | table, dated | yes | yes | yes | `books.edit` |
| `arrivals` (`ARR`) | C | table, dated, numbered | yes | yes | yes | `doc.create` |
| `sale_pattis` (`PAT`) | C | table, dated, numbered | yes | yes | yes | `books.edit` |
| `indents` (`IND`) | C | table, dated, numbered | yes | yes | yes | `doc.create` |
| `bank_statement_settings` | C | object | yes | yes (singleton) | no (viewing) | `settings.manage` |
| settings `trade_kind`, `trade_discounts`, `returnable_packaging` | C / A | additive fields | yes | yes | yes | — |
| `schemes` `scope` / `free_slabs` / `principal_vendor_id` / `claim_basis` / `claim_rate` | A | additive | yes | yes | yes | — |
| `sales_agents` `kind` / `brokerage_*` / `paid_by` / `vendor_id` | B | additive | yes | yes | yes | — |
| `tds_settings.turnover_by_fy` | C | additive | yes | yes | yes | — |
| `Godown.kind` `'consignment'` | C | union value (append-only) | — | — | — | — |

New series: `TCL`, `PDR`, `ARR`, `PAT`, `IND` (none in use today). No device-local key. No migration (all additive).

---

## 7. E2E steps (production build, `tests/e2e/smoke.mjs`)

1. **R8-C**: fresh company → wizard → Wholesale → *Commission agent* → lands on `/distribution?tab=agency`; sidebar has
   no POS; create an arrival of 80 bags with weights; sell 50 bags on an invoice with the lot; make a patti; the patti
   print shows net payable; Ctrl+K "patti" finds Agency → Pattis; F1 shows its help topic.
2. **R8-A**: Distributor profile → party rate for one item → new invoice shows basis "Party rate"; type "18+4" in the
   discount cell → line shows 21.28%; preview prints "18 + 4 %"; run a price drop for that item → one financial
   credit note created; Receivables → Interest lists the party.
3. **R8-B**: Commodity profile → item with bag weights → invoice line 120 bags / 6,072 kg / tare 0.6 / dhalta 1 kg per
   qtl → quantity 59.400 QTL (6,072 − 72 tare − 60 dhalta = 5,940 kg); market-fee head auto-adds a line; Distribution → Mandi
   shows the register row; Brokers tab lists the broker's brokerage.

---

## 8. Open questions — with the default the builders will use

The owner asked for no questions; each has a default that the packages implement. A CA answer later changes a dated
rule row or a setting default, never the design.

| # | Question | Default chosen | Why |
|---|---|---|---|
| 1 | Should existing `wholesale` companies get trader packs automatically? | **No.** `PACK_OF_TYPE` unchanged; a checklist step "Pick your trade". | The R5 invariant: existing companies see what they saw. |
| 2 | How to store compound / per-unit discounts? | Effective `discount_percent` (6 decimals) + `disc_chain` / `disc_per_unit` snapshots; `invoice-calc.ts` untouched. | Every GST / books / Tally reader keeps working; print shows the chain. |
| 3 | Free goods: Tally "actual vs billed qty" or our ₹0 line? | Keep the ₹0 free line (existing, G10). | One model; stock and HSN already right. |
| 4 | Weight billing: what is the line quantity? | Net weight in the billing unit; bags and weights are a snapshot sub-row. | No change to calc, stock or HSN readers. |
| 5 | Mandi charges: GST treatment default? | `in_value` (part of the goods' value at the goods' rate, Sec 15(2)(a)/(c)); `own_rate` and pure-agent `outside` are options. | Conservative; never under-reports value (TR6, TR7). |
| 6 | Charge rates: presets? | **None.** Heads named (market fee, aadat, hamali, tulai, palledari, bardana, dharmada) with blank rates. | APMC rates differ by State, mandi and commodity. |
| 7 | Agency sales in the books | Invoice posts as Sales; the patti journal transfers gross sales to the principal and books commission; unsettled lots listed and on the year-end checklist. | No change to `ledger/postings.ts`; P&L shows commission once settled (TR22). |
| 8 | Agency stock | Separate `consignment` godown kind, non-saleable for own sales. | Keeps own stock and the bank stock statement clean. |
| 9 | Price-drop notes: GST or financial? | Financial credit note by default; GST note only when "agreed before supply" is ticked and within Sec 34(2). | Same rule as G8 (TR3). |
| 10 | Scheme claim settlement: GST or financial? | Financial (journal) by default; supplier CN with GST as an option. | Most brands issue financial / commercial credit notes (TR4). |
| 11 | Interest notes | Draft late-fee invoices through `late-fee.ts` (taxable at the principal supply's rate, G6); rate: party's `late_fee`, else company default, else none. | Reuses the existing reviewed path (TR18). |
| 12 | 194Q when our turnover is unknown | Allowed with a warning; refused only when the turnover is entered and ≤ ₹10 crore. | No silent change for existing users (TR13). |
| 13 | TCS on timber / forest produce from 1 Apr 2026 | 2% (tdsman reading) marked unverified. | Sources conflict; the CA answer becomes a dated row (TR14). |
| 14 | 206C(1F) table reference under the 2025 Act | Label "Sec 394(1) [Table: Sl. No. 6]" marked "(verify with your CA)". | Sources disagree (Sl. 6 vs 6.D) (TR15). |
| 15 | Bank stock-statement margins | 25% stock, 40% debtors, debtors > 90 days excluded; all editable per bank account. | Common sanction terms; the user's letter decides (TR19). |
| 16 | Crates deposit | Refundable deposit: no GST, liability ledger; charge for unreturned crates: taxable sale of the crate. | TR8. |
| 17 | Broker paid by | `us` (expense) by default; `other_party` is memo only. | Most traders book only their own brokerage. |
| 18 | Salesman commission TDS (T15) | Unchanged default (no TDS) with an opt-in 194H tick; brokers default to 194H on. | No silent change to existing postings. |
| 19 | Round 7 / 8 budget | Stay inside +35 kB; lead may raise total to 2700 kB with the stated reason only if both rounds need it. | First paint is the hard limit; total JS is precache. |
| 20 | Auction / boli entry | Not this round. | Needs live-yard UI; the agency desk comes first. |
