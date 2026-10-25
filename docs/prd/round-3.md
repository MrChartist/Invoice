# PRD — Round 3: freelancer apps, Indian niche tools and app-store favourites

Status: draft for build · Drafted 2026-10-25 · Baseline: branch `claude/elegant-cannon-cwapiv` at `06bf5b4`
(Phases 0–8 built; R2-C merged; R2-A and R2-B in progress — **Round 3 starts after both are merged**).
Raw sources (URLs and the claim taken from each):
`/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/research/round3-sources.md`.

Every item respects `AGENTS.md`: local-first and serverless (no network, no gateways, no bank feeds), vanilla CSS
Modules with tokens, invoice snapshots never change, Indian-FY numbering, bare dates parsed as local days, statutory
values date-keyed, GST / statutory outputs labelled as working papers ("verify with your CA").

---

## 1. Problem statement

Round 1 matched the Indian daily apps, Phases 6–8 matched Tally, and Round 2 matched the established suites. Round 3
looks at three groups that earlier rounds skipped:

- the **phone-first freelancer / SMB invoice makers**: Invoice Ninja, Bonsai, Invoice Simple, Moon Invoice, Hiveage,
  Billdu, Invoicely;
- the **Indian niche tools**: Lio, the "Hisaab Kitaab" family, BizAnalyst, Petpooja, CA-practice apps, and the GSTN
  offline tool and e-Way bill bulk utilities;
- what **app-store reviewers** praise and complain about.

Their users miss four sets of things here:

1. **Service businesses bill time like a studio.** Invoice Ninja sets work rates per account, client or task and
   budgets projects in hours, showing estimated hours beside tracked time on a Kanban board. Hiveage sends "time &
   expense reports" with the invoice. A Moon Invoice reviewer wants prepaid credit to apply automatically to time
   invoices.
   - Our time module has one default rate plus a per-entry override. Its doc says so under "Not done":
     `docs/features/time-expenses.md`, "No per-client or per-project default rates".
   - Projects are cost centres with a P&L only (`src/components/books/planning/ProjectsTab.tsx`). There are no hours
     budget, no tasks and no retainer.
   - A billed invoice shows grouped lines but no timesheet annexure (`timeLines`, `src/lib/timesheets.ts:293`).
2. **The phone invoice should look and feel finished.**
   - Invoice Simple, Billdu and the contractor apps put product photos, before / after photos and a finger-drawn
     client signature on the document. Moon added PDF margin settings (v7.19.3). Invoice Ninja shows a real-time
     PDF preview while you type. Indian shop owners share the bill as an image on WhatsApp.
   - Item photos exist only in the catalogue export (`src/lib/item-images.ts`). Templates print no line image and no
     photo pages.
   - Signatures exist only for quote acceptance (`src/components/invoicing-ux/AcceptQuoteDialog.tsx`).
   - Design prefs have no page margins and no letterhead image (`src/lib/design-prefs.ts:44–93`).
   - The editor previews only in a modal (`src/pages/InvoiceCreator.tsx:75`). The template picker shows emoji tiles
     ("the live look is shown in Preview", `src/components/creator/TemplatePicker.tsx:9`).
   - Sharing offers a PDF or client-copy HTML, never an image (`src/components/preview/InvoicePreview.tsx:177–245`).
3. **Restaurants and counters.** Petpooja's offline core covers dine-in areas with their own menu and tax, tables
   that can be moved, merged and split, station-wise KOT printing, modifiers, KOT-change audit and equal / item /
   seat-wise split bills with the GST adding up. Our POS is a single-cart counter with up to 9 held carts
   (`src/lib/pos-hold.ts:17`). It has no table, KOT, modifier, service-charge or split-bill concept (grep for
   `KOT`, `split_bill` and `service_charge` in `src/` finds nothing).
4. **Indian desks around the books.**
   - The GSTN offline tool works with portal *error reports* and downloaded GSTR-1 data. The e-Way utilities do bulk
     vehicle updates, and Rule 138(10) validity decides when an EWB expires.
   - CA-practice apps track every client's compliance and DSC expiry. BizAnalyst flags inactive customers.
   - We build GSTR-1 JSON but never read the portal's files back (`src/lib/gstr-json.ts` has builders only).
   - We store a typed `eway_valid_upto` but never compute or watch it
     (`src/components/einvoice/EInvoiceModal.tsx:429`).
   - The compliance calendar covers the open company only (`src/lib/compliance.ts:136`).
   - Insights have no "gone quiet" customers (`src/lib/insights.ts`).

**Goal of Round 3:** ship 18 features in three parallel work packages with mostly disjoint files, so three agents
can build at once:

- **R3-A** restaurant and counter;
- **R3-B** service billing and party speed;
- **R3-C** document polish and compliance desks.

**First-paint budget.** Initial JS is about 180 of 185 kB gz (`scripts/check-bundle-size.mjs:20`). Every item is
lazy. Section 4 says for each item how it stays off first paint, and section 6 sets a hard per-package delta.

**Non-goals:** anything that needs a server or the network. This drops:

- open / view tracking;
- payment gateways, tap-to-pay and card-fee pass-through;
- cloud sync and bank feeds;
- hosted client portals and hosted e-signature;
- Zapier / API;
- the Petpooja captain app, multi-terminal LAN sync, QR scan-and-order and aggregator APIs;
- GST portal auto-fetch;
- BizAnalyst's live Tally sync;
- WhatsApp / SMS automation;
- AI OCR and assistants;
- voice billing (Chrome's speech recognition sends audio to a server).

Local substitutes are named where they exist.

---

## 2. Per-competitor findings

Status: **B** = built (cited), **P** = partial, **M** = missing, **R2** = specified in Round 2 (not re-proposed),
**X** = dropped (network / server). Proposed items carry their Round 3 id.

| Competitor | Feature / UX pattern users love | Our status (evidence) | Round 3 |
|---|---|---|---|
| **Invoice Ninja** | Work rates per account / client / task | P — one default rate + per-entry rate (`TimePrefs.default_rate`, `TimeEntry.hourly_rate`, `src/types/time.ts:21`) | R3-B1 |
| | Project budgets in hours, estimated vs tracked, task statuses, Kanban | P — cost centres + ₹ budgets only (`src/lib/cost-centres.ts`, `src/lib/ledger/budgets.ts`, `ProjectsTab.tsx`) | R3-B2 |
| | Tasks + re-billed expenses + products on one invoice | B — `buildBillLines` (`src/lib/timesheets.ts:397`) | — |
| | Real-time PDF preview while editing | M — preview modal only (`InvoiceCreator.tsx:75, 497`) | R3-C1 |
| | Currency / language per client | P — `message_lang` only on `Client`; currency per document (`ForexFields.tsx`) | R3-B5 |
| | Inclusive taxes | B — `price_includes_tax` (`src/lib/invoice-calc.ts:22, 421`) | — |
| | Deposits / partial payments, quote e-signature | B — 8.100 / 8.101 (`payment-schedule.ts`, `quote-acceptance.ts`) | — |
| | Custom numbering with variables | X — conflicts with fixed Indian-FY numbering (Critical Rule 4); profile prefix exists | — |
| | Client portal, gateways, auto-bill, Zapier | X | — |
| | (complaint) mobile list scrolls sideways, client hidden | B — phone card layout (`Transactions.module.css` @media 640px) | — |
| **Invoice Simple** | Product photos on the invoice | P — photos only in the catalogue export (`src/lib/item-images.ts`, `catalogue-html.ts`) | R3-C2 |
| | Signature on the document | P — owner signature (Design Studio); client signature only on quotes (`AcceptQuoteDialog.tsx`) | R3-C2 |
| | Import clients from phone contacts | B — 8.24 `contact-pick.ts` | — |
| | Estimate → invoice in one tap | B — `ConvertMenu.tsx` | — |
| | "Autofill" (Plus plan) | P — typeahead + last rate (`suggest.ts`, `last-rate.ts`); no "repeat last bill" / usual items | R3-B6 |
| | (complaint) shipping field, separate ship-to | B — charges (3.3), `ship_to` (2.6) | — |
| | Open / paid alerts | X | — |
| **Moon Invoice** | 66+ templates, themes, fonts | P — 26 templates + Design Studio; no live thumbnails (`TemplatePicker.tsx`) | R3-C1 |
| | PDF margin settings (v7.19.3) | M — only pre-printed offsets (`design-prefs.ts:177–179`) | R3-C3 |
| | Timer runs while the app is closed | B — `src/lib/timer.ts` | — |
| | (review) prepaid client credit applied to time invoices | M | R3-B3 |
| | (review) bundles deduct component stock | B — kits (`events-kits.ts`) | — |
| | Offline, data on device, backup | B — whole app (`storage.ts`, `auto-backup.ts`, `backup-share.ts`) | — |
| | Status visibility / reorder | M (low value) | long tail |
| **Hiveage** | Time & expense report sent with the invoice | M — no annexure (`timesheets.ts`) | R3-B4 |
| | Recurring auto-send vs manual approval | P — recurring generates documents (`src/lib/recurring.ts`); sending is manual by design (no e-mail) | — |
| | Multiple taxes / shipping, display control | B — charges, cess, TCS / TDS | — |
| **Billdu** | Image attachments on invoices | P — attachments stored (`src/lib/attachments.ts`), never printed | R3-C2 |
| | Client signs on the phone with a finger | P — quotes only | R3-C2 |
| | Delivery note from invoice | B — challan conversion (`documents.ts`) | — |
| | Per-client defaults (discount, payment form, delivery) | M — `Client` has none (`src/types/invoice.ts`, fields listed in §4 B5) | R3-B5 |
| | Appointments app | M | long tail |
| **Bonsai** | Proposals + contracts + time in one flow | P — proposals R2-B3; time B; contracts out of scope | R2 |
| **Invoicely** | Unlimited business units, each branded | B — companies (6.20) + profiles | — |
| **App-store reviews** | (praise) "quick and easy", professional look | P — editor flow 8.110; phone speed items | R3-B6, R3-C1 |
| | (complaint) lost data on reinstall / phone change, subscription lock-outs | B — local data, encrypted share-backup and restore (8.20) | — |
| | (complaint) time zone shifts printed dates | B — local-day parsing (Critical Rule 8) | — |
| | (complaint) "no button" to mark paid; search by client | B — `PaymentModal`, Transactions filters | — |
| | Share bill as an image (Indian WhatsApp habit) | M — PDF / HTML only (`InvoicePreview.tsx`, `pos-share.ts`) | R3-A5 |
| **Lio** | 100+ data templates, 25 column types | P — custom fields (`custom-fields.ts`) | — |
| | WhatsApp automations | X | — |
| **Hisaab Kitaab / HisaabNow** | Voice billing (Hindi / English) | X — no offline speech engine in the browser | — |
| | Staff commission, low stock, udhaar reminders | B — `sales-commission.ts`, `stock-alerts.ts`, khata 8.4 | — |
| **BizAnalyst** | Track inactive customers | M — no "gone quiet" list (`insights.ts` ids: revenue, topCustomers, expenseSpike, dso, slowPayers, margin, stockRisk, gstTrend) | R3-B7 |
| | Outstanding reminders, follow-ups | B / R2 — 8.4; R2-A4 | — |
| | Live Tally sync, location check-in | X | — |
| **Petpooja** | Dine-in areas, tables, move / merge / split, running bill | M — single cart + 9 held carts (`pos-hold.ts`) | R3-A1 |
| | Station-wise KOT, KOT change log | M | R3-A2 |
| | Split bill: equal / item / seat / custom, GST sums to the original | M — split *tender* only (`tenderSummary`, `src/lib/pos.ts:70`) | R3-A3 |
| | Modifiers / add-ons, item off when out of stock ("power failure group") | P — variants are separate items (`variants.ts`); no modifiers or 86 toggle | R3-A4 |
| | Recipe costing | B — BOM / kits (`manufacturing.ts`, `events-kits.ts`) | — |
| | Same GST serial offline | B — always local (`localDb.ts` numbering) | — |
| | Aggregator orders (Sec 9(5)) | P — ECO 9(5) reporting exists (`docs/features/gst-reports.md` §9(5)); no POS channel | R3-A1 |
| | Captain app, LAN terminals, QR ordering, aggregator APIs | X — local substitute: customer display (8.143, BroadcastChannel) | — |
| **CA-practice apps** | Compliance calendar across clients, DSC expiry tracker, client checklists | P — calendar per open company (`compliance.ts`); cross-company read exists for search only (`company-peek.ts`) | R3-C6 |
| | Portal auto-fetch, client portal | X | — |
| **GSTN offline tool** | Open the portal error report, fix each invoice, regenerate | M — builders only (`gstr-json.ts`); preflight is ours (`gst-preflight.ts`) | R3-C4 |
| | Download filed GSTR-1, compare | P — our own frozen snapshot (8.61, `gstr1_snapshots`), not the portal file | R3-C4 |
| **e-Way utilities** | Bulk generation / consolidated JSON | B — `eway.ts` `buildEwayBulk`, `eway-consolidated.ts` | — |
| | Vehicle Number Updation JSON (bulk Part-B) | M | R3-C5 |
| | Validity by distance (Rule 138(10)), expiry watch, extension | M — `eway_valid_upto` typed by hand (`EInvoiceModal.tsx:429`) | R3-C5 |

---

## 3. Gap list ranked by user value / effort

Value runs 1–5 (5 = asked for daily by many users). Effort is S = 1, M = 2, L = 3. Score = value ÷ effort; ties are
broken by value. Every item below is local-only.

| Rank | Id | Gap | Seen in | Value | Effort | Score | Package |
|---|---|---|---|---|---|---|---|
| 1 | R3-A5 | Share the bill as an image (JPG / PNG) | Indian app habit, Petpooja e-bill, Invoice Simple | 4 | S | 4.0 | A |
| 2 | R3-B5 | Party document defaults (template, currency, discount, notes / terms, rate) | Billdu, Invoice Ninja | 4 | S | 4.0 | B |
| 3 | R3-B6 | Repeat last bill + "usual items" chips for the party | Invoice Simple autofill, tutorials | 4 | S | 4.0 | B |
| 4 | R3-A4 | Modifiers / add-ons + "86" item availability | Petpooja | 3 | S | 3.0 | A |
| 5 | R3-B1 | Rate cards: client / project / task rates | Invoice Ninja, Hiveage | 3 | S | 3.0 | B |
| 6 | R3-B4 | Timesheet & expense annexure with the invoice | Hiveage, Invoice Ninja | 3 | S | 3.0 | B |
| 7 | R3-B7 | Customers gone quiet + re-order nudge | BizAnalyst | 3 | S | 3.0 | B |
| 8 | R3-C3 | Page margins + letterhead / footer image | Moon (7.19.3), Billdu, Invoice Ninja designs | 3 | S | 3.0 | C |
| 9 | R3-C1 | Live paper preview pane + live template thumbnails | Invoice Ninja, Moon | 4 | M | 2.0 | C |
| 10 | R3-C2 | Job evidence: item photos, photo pages, receiver signature | Invoice Simple, Billdu, JobFLEX, Estimate GO | 4 | M | 2.0 | C |
| 11 | R3-C4 | GST portal file reader (GSTR-1 error report, downloaded GSTR-1) | GSTN offline tool | 4 | M | 2.0 | C |
| 12 | R3-C5 | e-Way desk: validity, expiry watch, bulk vehicle update | EWB utilities, Rule 138(10) | 4 | M | 2.0 | C |
| 13 | R3-A2 | KOT: station routing, change log, reprint | Petpooja | 4 | M | 2.0 | A |
| 14 | R3-A1 | Tables & running orders (areas, move / merge, service charge, channels) | Petpooja | 5 | L | 1.7 | A |
| 15 | R3-A3 | Split bill (equal / custom / item / seat) with GST reconciling | Petpooja | 3 | M | 1.5 | A |
| 16 | R3-B2 | Projects: hours budget, tasks, board, estimate vs actual | Invoice Ninja, Bonsai | 3 | M | 1.5 | B |
| 17 | R3-B3 | Prepaid retainer hours with drawdown and overage | Moon review, FreshBooks | 3 | M | 1.5 | B |
| 18 | R3-C6 | Practice desk: all companies' compliance, DSC register, monthly checklist | ATOM, MyTask, QwikCA, ICAI | 3 | M | 1.5 | C |
| 19 | — | Appointment book → invoice (salons, clinics) | Billdu | 3 | M | 1.5 | later |
| 20 | — | Client document pack (statement + all PDFs + offline HTML index in one ZIP) | Invoice Ninja portal (offline stand-in) | 2 | M | 1.0 | later |
| 21 | — | Kitchen display screen (second window, BroadcastChannel) | Petpooja | 2 | M | 1.0 | later |
| 22 | — | Status visibility / reorder in lists | Moon 7.19.3 | 1 | S | 1.0 | later |
| 23 | — | Table reservations / token display | Petpooja | 2 | M | 1.0 | later |

**Overlap with Round 2 (not re-specified):**
- Proposals, revisions and optional lines: R2-B3.
- Follow-ups and promise-to-pay: R2-A4. BizAnalyst follow-ups are covered there; R3-B7 only finds quiet customers.
- Contact persons and ship-to book: R2-B4.
- Statement styles: R2-A6.
- Logo-derived accent and labels: R2-C5. R3-C3 only adds margins and images.
- Packing lists: R2-C4.

**Dropped (network or server):**
- view tracking;
- gateways, tap-to-pay and card-fee pass-through;
- cloud sync and bank sync;
- hosted portals and hosted e-signature;
- Zapier / Make / API;
- Petpooja captain app, LAN multi-terminal sync, QR scan-and-order and Swiggy / Zomato APIs;
- QwikCA portal auto-fetch;
- BizAnalyst live Tally sync and location check-in;
- Lio / BizAnalyst WhatsApp automation;
- AI OCR and assistants ("Munim");
- voice billing.

Local substitutes:
- `wa.me` / Web Share for messages (`src/lib/share.ts`);
- the customer display for a second screen (8.143);
- order-pad files for remote orders (8.81);
- Tally XML import for Tally users (`tally-import.ts`);
- the portal file reader (R3-C4) instead of auto-fetch.

---

## 4. Specifications (18 items)

Conventions for every item. These are the same as Round 2, plus the bundle rule.
- **Logic and tests.** Pure logic goes in `src/lib/**/*.ts`, tested with `node:test` in `tests/*.test.ts`.
- **Strings.** Strings go in the package's own i18n area file (`defineArea(en, hi)`; typecheck requires Hindi).
- **New data.** New persisted data is a new `mrchartist_inv_<table>` read and written through `getTable/setTable`.
  Fields are snake_case and additive.
- **New invoice / client fields.** These are added by **declaration merging** in the package's own types file:
  `src/types/restaurant.ts` (A), `src/types/service-r3.ts` (B), `src/types/docs-r3.ts` (C). `src/types/invoice.ts`
  is not edited. New `InvoiceRecord` keys go into `RECORD_KEYS`, using the line-per-package rule in §6.
- **Guards and series.**
  - Destructive calls use `requireAccess` (`src/lib/access.ts`).
  - Writes in a locked period use `assertUnlocked` (`src/lib/period-lock.ts`).
  - Numbered series use `src/lib/series-counters.ts` with Indian-FY labels.
  - Money goes through `round2` / paise (`src/lib/invoice-calc.ts`).
  - Dates are local days.
- **Registries.** New tables are registered in:
  - `RECORD_TABLES` / `ID_TABLES` (`src/lib/backup.ts`);
  - `WATCHED_TABLES` (`src/lib/audit-edits.ts`);
  - `TABLE_ACTIONS` (`src/lib/access.ts`);
  - `DATED` / `NUMBERED` in `src/lib/sync-engine.ts`, for dated or numbered tables.
- **Bundle rule.**
  - No R3 module may be imported statically by `main.tsx`, `App.tsx`, `DashboardLayout.tsx`, `Dashboard.tsx` or
    `src/store/useInvoiceStore.ts`.
  - The shell gets only `React.lazy` routes (wired by the lead), `RECORD_KEYS` strings and lazy bell gates of the
    existing `ensure…Alerts` shape (`src/components/command/NotificationBell.tsx:121–143`).
  - Each item states its chunk.

### R3-A — Restaurant & counter

#### R3-A1 Tables & running orders

*Seen in:*
- Petpooja: dine-in areas each with its own menu, tax and seating layout; tables moved, merged or split mid-meal; a
  party moving from the bar to a booth keeps its running bill; works offline.

*Today:*
- The POS is one cart (`src/pages/Pos.tsx`) with up to 9 device-local held carts (`src/lib/pos-hold.ts`).
- Nothing models a table, cover count, captain or running order.

**User story.** As a café / dhaba owner with 14 tables across "Indoor" and "Terrace", I want to:
- tap a table and add items as they are ordered;
- move or merge tables when guests shift;
- settle the running order into one GST bill at the end;

so the counter works like a restaurant POS without the internet.

**Acceptance criteria.**
1. **Masters.** Settings → POS → **Tables**: areas (name, optional price level from `price_levels`, optional
   service-charge %) and tables (name / number, seats, area, sort). The starter set is one area "Dine-in" with
   tables 1–10.
2. **Floor view.** New route `/tables` (module `pos`):
   - a grid per area with each table's status: Free, Occupied (covers, running amount, minutes open),
     Bill printed, Settling;
   - channel tabs for **Takeaway** and **Delivery** (counter-numbered tokens, no table);
   - an **Aggregator** channel (e.g. Swiggy / Zomato typed as an e-commerce operator with GSTIN).
3. **Running order.**
   - Tapping a free table opens an order (covers, captain = local user from `src/lib/users.ts`, optional customer).
   - Items are added with the POS search / tiles / scan grammar (reuse `src/lib/pos-keys.ts`, `pos-tiles.ts`).
   - The order is saved on every change to table `table_orders`. It is not an invoice, has no GST number and is
     never in reports.
4. **Move / merge / transfer.** Move an order to a free table. Merge two orders: lines are appended and both KOT
   histories are kept. Transfer selected lines to another table. Every action is logged on the order (who, when,
   from, to).
5. **Settle.**
   - **Print bill** freezes the order (further changes need "Reopen", logged).
   - **Settle** turns it into a normal POS invoice through `savePosBill` (`src/lib/pos.ts:258`). That gives the same
     numbering, stock, tenders, Z report and shift. The new invoice gets additive `table_order_id`; the order stores
     `invoice_ids`.
   - Area price level and pricing rules are applied through the existing `applyPricing` path.
6. **Service charge.**
   - It is optional per area, **off by default**. It is printed as a separate charge line labelled "Service charge
     (optional)", and the cashier can remove it per bill.
   - Help text: it cannot be added by default or made compulsory under the consumer-protection guidelines as
     understood — **verify with your CA / legal adviser**.
   - Its GST follows the charges logic (`charges_taxable`).
7. **Aggregator channel.** For a restaurant service supplied through an e-commerce operator under Sec 9(5), the
   settled invoice carries `eco_gstin` and `eco_section: '9(5)'`. The existing reporting then sends it value-only to
   Table 14(b) / 3B 3.1.1(ii) (`docs/features/gst-reports.md`). The UI says "operator pays the GST — verify with your
   CA". No API: orders are typed or keyed in.
8. **Business type.** Shop mode gets a `restaurant` preset: modules POS + inventory + reports, landing `/tables`,
   template `compact_receipt`. This needs the one-line union change in `src/lib/shop-mode.ts`, made by the lead (§6).
9. **Device scope.** Orders are company data, so they are backed up and folder-synced. Folder sync is not real time,
   which is documented. Two phones at once is a non-goal (no LAN).
10. **Day close.** The POS day close refuses while orders are open or printed but unsettled, with a list and a jump
    to each order. Shift close does the same (`src/lib/pos-shifts.ts`).

**Files.**
- New: `src/lib/restaurant/tables.ts` (masters, floor status, move / merge / transfer, settle builder),
  `src/lib/restaurant/orders-store.ts`, `src/pages/Tables.tsx`, `src/components/restaurant/FloorView.tsx`,
  `OrderPanel.tsx`, `TablesSettings.tsx`, `restaurant.module.css`, `src/types/restaurant.ts`,
  `src/i18n/areas/restaurant.ts`, `docs/features/restaurant.md`.
- Edit: `src/lib/shop-presets.ts` (preset), `src/lib/pos-shifts.ts` and the day-close check in `src/lib/pos.ts`
  (`dayCloseDb` guard only), `src/pages/Pos.tsx` (a "Tables" link button only, no import of restaurant code).

**Storage.**
- Tables `dining_areas`, `dining_tables` (masters) and `table_orders`:
  `{ id, area_id, table_id?, channel: 'dine_in' | 'takeaway' | 'delivery' | 'aggregator', token?, covers, captain_id?, client?, eco_gstin?, lines: OrderLine[], kots: Kot[], log: OrderEvent[], status: 'open' | 'printed' | 'settled' | 'void', opened_at, invoice_ids?, service_charge_pct? }`.
- Object key `restaurant_settings`: `{ service_charge_default, token_reset: 'daily' }`.
- Additive `InvoiceRecord.table_order_id?`.
- `table_orders` is DATED in sync (by `opened_at` day).

**Bundle.**
- `/tables` is a `React.lazy` page.
- POS links to it by URL only.
- Settings → Tables is a lazy panel.
- First paint: +0 apart from the route entry and the `RECORD_KEYS` string (≈0.1 kB).

**Tests.** `tests/restaurant-tables.test.ts`:
- move / merge / transfer keep line totals and KOT history;
- settle produces one POS invoice with `table_order_id` and correct CGST / SGST;
- area price level applied;
- service charge optional and removable, taxed per the charges rule;
- aggregator order carries `eco_section '9(5)'` and lands in Table 14(b) in a GSTR-1 build;
- day close refused with open orders;
- local-day token reset across midnight;
- period lock respected on settle.

E2E: open table → add items → print bill → settle with UPI → Z report shows it.

#### R3-A2 KOT: station routing, change log, reprint

*Seen in:*
- Petpooja: station-wise KOT printing with a printer per kitchen station.
- Every KOT change is logged with the captain's name and timestamp.
- A leakage panel shows cancelled and moved tickets.

*Today:* ESC/POS printing exists for receipts (`src/lib/escpos.ts`, `components/extras7u/PosPrinter.tsx`); there is no
kitchen ticket.

**User story.** As a restaurant owner, I want new items on a table to print as a kitchen ticket at the right station
(tandoor, chinese, bar), with every cancellation recorded, so food goes out right and staff cannot quietly cancel
items.

**Acceptance criteria.**
1. **Send KOT** (and auto-send on "Print bill" if lines are unsent):
   - prints only the lines added since the last KOT, grouped by station;
   - stations come from stock group → station map (Settings → Tables → Stations);
   - unmapped items go to "Kitchen".
2. **KOT content.** KOT number (`K<n>`, reset per day — not a tax document, not in `series_counters`), table / token,
   covers, captain, time, items with qty, modifiers (R3-A4) and the note. No prices.
3. **Printers.**
   - Per station, a device-local printer choice reusing `PrinterPrefs` (`browser` / `raw` / `serial` / `bluetooth`).
   - Browser print falls back to one small HTML ticket per station.
   - Key `mrchartist_kot_printers` sits outside the prefix, like `mrchartist_pos_printer`.
4. **Changes after a KOT.**
   - Reducing or removing a sent line needs a reason (wrong order / customer cancelled / out of stock / other).
   - It prints a **cancellation KOT** to the station and records `{ line, qty, reason, by, at }` in the order log.
   - A clerk's cancellation above a company cap (default 2 lines or ₹ 500 per order) asks the owner's PIN
     (`PinConfirmModal`).
5. **KOT register** report: KOTs by day / captain / station, plus cancellations and moves (the "leakage" view).
   Exports CSV / XLSX. Its source is `table_orders` only.
6. **Reprint** of any KOT is marked "DUPLICATE".

**Files.**
- New: `src/lib/restaurant/kot.ts` (diff since last KOT, station grouping, ticket text), `src/lib/restaurant/kot-print.ts`
  (ESC/POS bytes via `escpos.ts` helpers `lr` / `center` / `wrap`; HTML ticket), `src/components/restaurant/KotRegister.tsx`,
  `StationsPanel.tsx`.
- Edit: `src/lib/escpos.ts` (export one `ticketBytes(lines, width)` helper if not already reusable — append-only).

**Storage.** KOTs live inside `table_orders.kots`. The station map lives in `restaurant_settings.stations`
(`{ group_id → station }`). Device-local `mrchartist_kot_printers`.

**Bundle.** Inside the `/tables` chunk. `escpos.ts` is imported dynamically on first print (as `PosPrinter` does).

**Tests.** `tests/restaurant-kot.test.ts`:
- only new lines print;
- cancellations need a reason and print a cancellation ticket;
- station grouping by stock group with fallback;
- daily KOT number reset in local time;
- register totals and leakage rows;
- PIN cap for clerks;
- ESC/POS line width 32 / 48 columns.

#### R3-A3 Split bill (equal, custom, item-wise, seat-wise)

*Seen in:*
- Petpooja: equal, item-wise, custom-amount and seat-wise splits.
- Tax is divided proportionally and the GST on sub-bills must add up to the original.
- Each sub-bill can be paid in a different mode.

*Today:* split *tender* on one bill exists (`tenderSummary`, `src/lib/pos.ts:70`); there is no split into bills.

**User story.** As a cashier with a table of six who each want to pay their own part, I want to split the bill by
item or seat, or equally, and give each person a bill and settle in their own mode, without GST rounding drift.

**Acceptance criteria.**
1. **Settle → Split** offers four ways:
   - **Equal (n)** and **Custom amounts**: one invoice with n payer rows. Each row is a tender with an optional payer
     name, settled one by one; a partial settlement keeps the order open. No extra tax documents are made.
   - **By item** and **By seat** (lines tagged with a seat number while ordering): one invoice per group, numbered
     consecutively in the POS series. Each invoice gets its own GST computation through `calculateInvoice`.
2. The split dialog shows a **reconciliation strip**: sum of sub-bill taxable value / CGST / SGST / cess against the
   unsplit order. Any paisa difference from per-line rounding is shown and absorbed in the last sub-bill's round-off
   (`round_off`), never in tax.
3. A line can be split across groups by quantity (e.g. 1 of 3 naan). Fractional quantities are allowed only for
   items sold by weight. Otherwise a line is divided as a fraction of its amount, as a "share" line with the same
   rate and HSN.
4. Every sub-invoice carries the same `table_order_id` and a `split_of: { order_id, part, parts }` reference. The
   order is Settled only when every part is paid or put on account.
5. Reprint shows "Part 2 of 3". The Z report counts each invoice normally.

**Files.**
- New: `src/lib/restaurant/split-bill.ts` (grouping, proportional share lines, reconciliation),
  `src/components/restaurant/SplitBillDialog.tsx`.

**Storage.** Additive `InvoiceRecord.split_of?`. Order lines carry `seat?`.

**Bundle.** A lazy dialog inside the `/tables` chunk.

**Tests.** `tests/restaurant-split.test.ts`:
- equal split of ₹ 1,001 into 3 settles exactly;
- item / seat splits: the sum of sub-invoice taxes equals the unsplit tax within ₹ 0.00 after the round-off rule;
- share lines keep HSN / rate;
- numbering is consecutive across an FY boundary (31 Mar → 1 Apr bill dates);
- the order closes only when all parts are paid;
- cess and inclusive pricing (`price_includes_tax`) are covered.

#### R3-A4 Modifiers / add-ons and "86" item availability

*Seen in:*
- Petpooja: variations and add-ons are preconfigured, and modifiers ("no garlic", "less spicy") take one tap.
- Items are toggled off when out of stock ("Power Failure Group").

*Today:* variants are separate child items (`src/lib/variants.ts`); there are no modifiers and no availability toggle.

**User story.** As a captain, I want to tap "Extra cheese +₹ 40" or "Jain" on a pizza and see sold-out dishes greyed
out, so orders reach the kitchen right and we stop promising what we cannot serve.

**Acceptance criteria.**
1. **Modifier groups** (Settings → Tables → Modifiers): name, min / max picks, options (name, price ≥ 0, optional
   catalogue item for stock), linked to catalogue items or stock groups.
2. **Picking.** Selecting a linked item in a table order or the POS opens a compact picker; required groups block
   adding.
   - Priced options become **child lines** with the parent's HSN / GST unless the option maps to its own catalogue
     item. This keeps GST per line correct.
   - Free options are printed as notes on the KOT and bill.
3. **86 toggle.** "Not available today" on any item from the floor view or POS. It is stored as
   `unavailable_on: 'YYYY-MM-DD'` (local day) and clears itself the next day. A **group toggle** marks many at once
   ("Tandoor off").
   - Unavailable items are greyed in tiles and search; adding one asks to confirm.
4. Optional: "auto-86 at zero stock" for tracked items. This reads `src/lib/stock-query.ts` lazily and is off by
   default.

**Files.**
- New: `src/lib/restaurant/modifiers.ts`, `src/components/restaurant/ModifierPicker.tsx`, `ModifiersPanel.tsx`.
- Edit: `src/pages/Pos.tsx` (open the picker through a lazy import when a linked item is added; grey tiles —
  ~10 lines), `src/components/pos/PosTiles.tsx` (greyed state).

**Storage.** Table `modifier_groups`. Additive catalogue field `unavailable_on?` on `items_catalog` (declared in
`src/types/restaurant.ts`). Order / invoice lines use additive `modifier_of?: string` (parent line id) and `note?`
(declared there too).

**Bundle.** The picker loads by dynamic `import()` from POS only when a linked item is picked. The `/tables` chunk
holds the rest.

**Tests.** `tests/restaurant-modifiers.test.ts`:
- min / max validation;
- child line tax follows the parent;
- mapped option uses its own item;
- 86 clears on the next local day;
- group toggle;
- auto-86 at zero stock (alternate units through `lineFactor`).

#### R3-A5 Share the bill as an image

*Seen in:* Indian retail habit of sending a JPG of the bill on WhatsApp; Petpooja e-bills; Invoice Simple "send by
text". *Today:* Share PDF / client copy only (`src/components/preview/InvoicePreview.tsx:238`,
`src/lib/pos-share.ts`).

**User story.** As a shop owner, I want to send the bill as a picture that opens instantly in WhatsApp on any phone,
so customers do not need a PDF viewer.

**Acceptance criteria.**
1. Preview → Share menu gets **Share as image** next to Share PDF. The POS save toast and post-save sheet get the same
   action.
2. **Rendering.**
   - The rendered paper (first copy only) goes through `html-to-image` (`toJpeg` at quality 0.92, `toPng` for
     thermal).
   - A4 pages are long, so an A4 document longer than one page becomes one image per page (max 5), shared as several
     files where `navigator.canShare({ files })` allows it, else downloaded as a ZIP (`src/lib/zip.ts`).
3. File name `INV-FY26-27-0012.jpg`. The UPI QR stays inside the image (the canvas is frozen as in client copy).
4. With no Web Share support the image is downloaded. On desktop "Copy image" uses `ClipboardItem` where available.
5. The image is never stored and nothing is logged beyond the existing share log.

**Files.**
- New: `src/lib/share-image.ts` (page slicing using `pageSlices` from `design-prefs.ts`, file naming).
- Edit: `src/components/preview/InvoicePreview.tsx` (one handler), `src/components/share/ShareMenu.tsx` (menu item),
  `src/lib/pos-share.ts` (image option).

**Storage.** None.

**Bundle.** It lives in the already-lazy preview chunk. `html-to-image` is dynamically imported (as in
`pdf-batch.ts:52`). The POS action dynamically imports `share-image.ts`.

**Tests.** `tests/share-image.test.ts` checks the pure parts only: slice counts for given heights and paper, file
names with `/` replaced, and the 5-page cap. E2E: Share as image downloads a `.jpg` in Playwright (no share sheet).

### R3-B — Service billing & party speed

#### R3-B1 Rate cards: client, project and task rates

*Seen in:*
- Invoice Ninja: work rates at account, client or task level.
- Hiveage: different billing rates.

*Today:*
- One `default_rate` in `TimePrefs`, plus `TimeEntry.hourly_rate` captured per entry (`src/types/time.ts:21`).
- The time doc's "Not done" says "No per-client or per-project default rates".

**User story.** As a consultant who charges client A ₹ 2,500/h, client B ₹ 3,000/h and ₹ 4,000/h for "Audit" work, I
want the right rate to fill itself when I start a timer or log time, so I never bill at the wrong rate.

**Acceptance criteria.**
1. **Resolution order** when a timer starts or an entry is created:
   1. task rate (R3-B2);
   2. project (cost centre) rate;
   3. client rate (`doc_defaults.hourly_rate`, R3-B5);
   4. **work type** rate;
   5. `default_rate`.

   The entry still **captures** the resolved rate (today's behaviour), so later rate changes do not reprice logged
   time.
2. **Work types** (Settings tab in `/time`): name, rate, optional SAC. The SAC overrides `prefs.sac` on the line.
3. The rate source is shown next to the rate field ("from client"), and the rate can be overwritten.
4. **Re-rate unbilled** action (Unbilled tab, per client): recompute unbilled entries from the current cards, with a
   preview of the change. Billed entries are never touched.
5. Time lines group by rate as today, plus work type (`timeLines`).

**Files.**
- New: `src/lib/rate-cards.ts` (`resolveRate(ctx)`, `reRate(entries, cards)`).
- Edit: `src/lib/timesheets.ts` (work-type SAC in `timeLines`), `src/components/time/TimerCard.tsx`,
  `TimeForms.tsx`, `BillClientModal.tsx` (re-rate), `src/pages/Time.tsx` (settings section),
  `src/lib/cost-centres.ts` (additive `hourly_rate?` on `CostCentre`).

**Storage.** Table `work_types` (`{ id, name, rate, sac?, inactive? }`). Additive `TimeEntry.work_type_id?`,
`CostCentre.hourly_rate?`.

**Bundle.** Inside the lazy `/time` chunk. The shell timer pill (`src/lib/timer.ts`) is untouched: rates resolve when
the entry is logged, not in the pill.

**Tests.** `tests/rate-cards.test.ts`:
- each level of the resolution order wins in turn;
- captured rate unchanged after a card edit;
- re-rate touches unbilled entries only;
- work-type SAC reaches the invoice line;
- inactive work type is ignored.

#### R3-B2 Projects: hours budget, tasks, board, estimate vs actual

*Seen in:*
- Invoice Ninja: project budgets in hours; Kanban with custom columns; estimated hours next to tracked time; statuses
  Pending / In progress / Done / Invoiced.
- Bonsai: projects.

*Today:* projects = cost centres with a P&L (`ProjectsTab.tsx`) and ₹ budgets by account (`src/lib/ledger/budgets.ts`).

**User story.** As a small agency, I want to give each project an hours budget, break it into tasks with estimates,
move tasks across a board, and see hours used against budget before I overrun, so I quote better next time.

**Acceptance criteria.**
1. A cost centre gets optional **project fields**: client, hours budget, fee budget (₹), start / due date, status
   (active / on hold / done), hourly rate (R3-B1).
2. **Tasks** per project: title, status column (To do / Doing / Done / Invoiced by default; columns renamable and
   addable per company), estimate (hours), assignee (local user), rate (optional), due date, sort.
3. **Views** (`/time?tab=projects`):
   - **Board** (drag between columns; keyboard: Alt+← / Alt+→ moves the focused card) and **List**.
   - Each card shows tracked vs estimate with a bar.
   - "Invoiced" is derived from billed entries (`isBilled`), not set by hand.
4. **Project header:** hours tracked / budget, billed / unbilled ₹, fee budget used, and a forecast at the current
   burn. Warnings at 80% and 100% are also in the bell, through a lazy provider gated on `project_tasks` rows.
5. The timer and time forms take an optional task. Picking a task sets the project and rate.
6. **Bill project:** opens the existing Unbilled flow filtered to the project (`billUnbilled` with a project filter).
7. Export of tasks with hours (CSV / XLSX via dynamic `xlsx.ts`).

**Files.**
- New: `src/lib/projects.ts` (task model, burn / forecast, board moves), `src/components/time/ProjectsBoard.tsx`,
  `ProjectHeader.tsx`, `src/lib/project-alerts.ts` (bell provider).
- Edit: `src/pages/Time.tsx` (tab), `src/lib/timesheets.ts` (project filter in the unbilled selection),
  `src/lib/cost-centres.ts` (additive project fields), `src/components/time/TimerCard.tsx` (task pick).

**Storage.** Table `project_tasks` (`{ id, cost_centre_id, title, column, estimate_minutes, assignee_id?, rate?, due?, sort, created_at }`).
Object key `project_settings` (`{ columns: string[] }`). Additive `TimeEntry.task_id?`.
Additive `CostCentre.client_key?`, `budget_minutes?`, `fee_budget?`, `start?`, `due?`, `status?`.

**Bundle.**
- `/time` lazy chunk; the board is its own lazy tab component.
- The bell provider is gated in `NotificationBell.tsx` with an `ensureProjectAlerts` that returns early unless
  `project_tasks` has rows (≈0.15 kB in the shell).

**Tests.** `tests/projects.test.ts`:
- burn and forecast;
- 80 / 100% thresholds;
- derived Invoiced column after billing and after cancelling the invoice;
- board move ordering;
- task → project / rate on the timer;
- cost-centre delete refused while tasks exist (`usageTotal` extension).

#### R3-B3 Prepaid retainer hours with drawdown and overage

*Seen in:*
- Moon Invoice review: prepaid client credit applied to time invoices.
- FreshBooks retainers with hours (Round 2 long tail, not specified there).

*Today:* recurring invoices can bill a fixed retainer (`docs/features/recurring.md`), but usage is not tracked against it.

**User story.** As a CA / designer selling "20 hours a month for ₹ 40,000", I want to see hours used against the
block, roll over or forfeit leftovers, and bill only the overage at my rate, so the retainer is fair to both sides.

**Acceptance criteria.**
1. **Retainer** per client:
   - hours per period (month / quarter), fee, start date, rollover (none / up to N hours);
   - overage rate (defaults to the rate card);
   - linked recurring template (optional) that issues the fee invoice.
2. Time entries for that client (optionally limited to projects) **draw down** the current period in date order. The
   usage view shows used, remaining, rolled-over and overage per period.
3. **Billing.**
   - Entries inside the block are marked *covered*: they are never billed again because their line `bill_refs`
     points at the retainer invoice. The existing derived-billing model (`LiveBilling`, `src/lib/timesheets.ts:83`)
     holds.
   - Overage entries stay unbilled and bill through the normal Unbilled flow at the overage rate.
4. Period close (on demand, or offered on the first open after period end) records the rollover. Leftover hours
   beyond the rollover cap are forfeited, and the close is logged.
5. A statement-style **retainer report** per client (period, fee invoice no., hours used, remaining, overage
   invoiced) can be printed / shared through the existing voucher-print path.
6. GST: the fee invoice is a normal tax invoice on its issue date. Help text on time of supply for advance / periodic
   services — "verify with your CA".

**Files.**
- New: `src/lib/retainers.ts` (drawdown, covered refs, close), `src/components/time/RetainersTab.tsx`,
  `RetainerReport.tsx`.
- Edit: `src/lib/timesheets.ts` (treat retainer-covered refs as billed in `unbilledTime`), `src/pages/Time.tsx` (tab).

**Storage.**
- Table `retainers`: `{ id, client_key, hours_per_period, period, fee, start, rollover_cap, overage_rate?, recurring_id?, cost_centre_ids?, closes: { period, used, rolled, forfeited, at }[] }`.
- Covered entries use additive `TimeEntry.retainer_id?` + `retainer_period?`. Line `bill_refs` on the fee invoice is
  written only for invoices issued *after* the period closes; until then, coverage is derived from the retainer row.
- DATED in sync by `start`.

**Bundle.** `/time` lazy chunk.

**Tests.** `tests/retainers.test.ts`:
- drawdown in date order;
- rollover cap;
- forfeiture;
- overage only billed once;
- cancelling the fee invoice uncovers entries;
- quarter periods across the FY boundary (local days 31 Mar / 1 Apr);
- `doubleBilledRows` unaffected.

#### R3-B4 Timesheet & expense annexure with the invoice

*Seen in:*
- Hiveage: "time & expense reports" sent to clients.
- Invoice Ninja: task details on the invoice.

*Today:* billed time prints as grouped hour lines only (`timeLines`).

**User story.** As a consultant, I want an annexure page with every date, person, task, description and hours behind
each line, attached to the invoice PDF, so clients approve bills without asking for timesheets.

**Acceptance criteria.**
1. `BillClientModal` gets the option **Attach timesheet annexure** (default on per client via R3-B5).
2. On save, the invoice stores a **snapshot** `annexure: { kind: 'timesheet', rows: [{ date, who?, project?, task?, description, minutes, billed_minutes, rate, amount }], expenses?: [{ date, vendor, description, amount, markup_pct, pure_agent }] }`.
   - It is taken from the billed rows, so later edits to time entries never change the paper (Critical Rule 3).
3. Templates print the annexure as a following page ("Annexure to INV/FY26-27/0012"). It has totals that tie to the
   time / expense lines, and a mismatch shows a warning in the editor, never on paper. Thermal paper never prints it.
4. **Separately:** "Download annexure" (CSV / XLSX) from Document actions.
5. Editing the invoice lines does not rebuild the annexure automatically. A "Refresh annexure from billed rows"
   action is offered.

**Files.**
- New: `src/lib/annexure.ts` (snapshot builder, tie-out check),
  `src/components/templates/parts/AnnexureBlock.tsx`.
- Edit: `src/lib/timesheets.ts` (`buildBillDraft` takes the annexure option),
  `src/components/time/BillClientModal.tsx`, `src/components/templates/TemplateEngine.tsx` (one append after the
  last body block, §6), `src/components/creator/DocumentActions.tsx` (download).

**Storage.** Additive `InvoiceRecord.annexure?` (declared in `src/types/service-r3.ts`; `RECORD_KEYS` line R3-B).

**Bundle.**
- `AnnexureBlock` is rendered by the template engine only when `invoice.annexure` exists. It is imported with
  `React.lazy` inside `TemplateEngine` so the preview chunk does not grow.
- The PDF path waits for fonts / lazy parts as it does today (`fonts-ready.ts`).

**Tests.** `tests/annexure.test.ts`:
- snapshot equals billed rows;
- tie-out vs lines (rounding to the billing step);
- later time-entry edit leaves the snapshot unchanged;
- pure-agent rows flagged;
- CSV columns;
- legacy invoice without `annexure` renders unchanged (template snapshot test).

#### R3-B5 Party document defaults

*Seen in:*
- Billdu: per-client default discount, payment form and delivery settings.
- Invoice Ninja: currency and language per client.

*Today:*
- `Client` has `price_level`, `credit_days`, `message_lang` and credit policy. It has no template, currency, default
  discount, notes / terms or rate.
- Round 2 adds payment terms (R2-A1) and contacts (R2-B4), not these.

**User story.** As a firm with one export client in USD who wants the Corporate template and fixed terms, I want the
client to carry those defaults, so every new document is right without remembering.

**Acceptance criteria.**
1. Client form → **Document defaults**:
   - template id;
   - currency (with the 8H currency master rate);
   - default line discount %;
   - notes;
   - terms;
   - hourly rate (R3-B1);
   - "attach timesheet annexure" (R3-B4);
   - print language for the Bilingual template (en / hi).
2. Picking the party in a **new** document applies them once:
   - template;
   - currency;
   - notes / terms (only when the fields are empty or still equal to the profile default);
   - discount on new lines.

   A chip "Defaults from <party> applied · Undo" reverts them. Editing an existing document never re-applies them.
3. Precedence: party default beats profile default, and a typed value beats both. Payment terms stay with R2-A1.
4. Recurring, batch (R2-B1) and converted documents keep the source document's values (no re-apply), which is
   documented.
5. Defaults are exported / imported as optional columns in client CSV / XLSX (`import-mapping.ts`).

**Files.**
- New: `src/lib/party-defaults.ts` (`applyPartyDefaults(draft, client, profile)` → patch + undo patch),
  `src/components/clients/DocDefaultsFields.tsx`, `src/types/service-r3.ts`.
- Edit: `src/components/modals/ClientFormModal.tsx` (one fieldset line, §6), `src/components/creator/PartiesSection.tsx`
  (call on party pick in the editor chunk — **not** in the store), `src/lib/import-mapping.ts`.

**Storage.** Additive `Client.doc_defaults?: { template_id?, currency?, discount_percent?, notes?, terms?, hourly_rate?, annexure?, print_lang? }`.

**Bundle.** Editor chunk (lazy, prefetched on idle). The store is not edited.

**Tests.** `tests/party-defaults.test.ts`:
- applies only on new documents;
- notes overwrite rules (empty / equal to profile default / typed);
- undo patch;
- currency + rate by date;
- import round-trip;
- invoice snapshot unchanged when the client's defaults change later.

#### R3-B6 Repeat last bill and "usual items"

*Seen in:*
- Invoice Simple "autofill".
- Tutorials sell "invoice in under 45 seconds / 1 minute": pick client, add items, send.

*Today:* typeahead (`src/lib/suggest.ts`), last rate (`src/lib/last-rate.ts`) and Duplicate on the list, but nothing
in the editor after the party is picked.

**User story.** As a distributor billing the same 12 items to the same shop every week on my phone, I want "Repeat
last bill" and one-tap chips for that shop's usual items right after I pick the shop, so a bill takes seconds.

**Acceptance criteria.**
1. After a party is picked in a new sales document, a strip shows:
   - **Repeat last bill** (lines of the party's latest issued invoice of the same type, at today's prices through
     the existing pricing path, quantities kept and editable);
   - up to 8 **usual items** chips, ranked by frequency × recency over the last 180 days. Tapping a chip adds the
     item with its last quantity.
2. "Repeat last bill" never copies number, dates, payments, IRN / EWB, attachments, `bill_refs`, batch / serial
   selections or schemes. Free-goods schemes recompute.
3. The strip hides on desktop after the first line is added and stays collapsible on phones. Keyboard: Alt+R repeats
   (editor shortcut list updated).
4. It works for POS customers too: a "Usual" tile row appears when a saved customer is picked.
5. Computation is cached per party for the session from the invoices already loaded. No new storage.

**Files.**
- New: `src/lib/party-habits.ts` (`lastBillLines`, `usualItems`), `src/components/creator/PartyHabitsStrip.tsx`.
- Edit: `src/components/creator/PartiesSection.tsx` (render the strip under the party), `src/pages/Pos.tsx` (lazy
  "Usual" tiles row), `src/components/creator/line-keys.ts` (Alt+R).

**Storage.** None.

**Bundle.** The strip is `React.lazy` inside the editor chunk. POS loads it by dynamic import only when a saved
customer is picked.

**Tests.** `tests/party-habits.test.ts`:
- ranking by frequency × recency;
- excludes cancelled / draft / other doc types;
- repeat strips the forbidden fields;
- today's price applied over the old rate;
- alternate-unit lines keep `unit_factor`;
- free-goods recomputed.

#### R3-B7 Customers gone quiet + re-order nudge

*Seen in:* BizAnalyst "track inactive customers". *Today:* insights have no inactivity card (`src/lib/insights.ts`).

**User story.** As a wholesaler, I want a list of regular customers who have not bought for longer than usual, with
one tap to send a friendly WhatsApp, so I win them back before a competitor does.

**Acceptance criteria.**
1. **Quiet rule.** A party with ≥ 3 sales invoices in the last 12 months whose days since the last invoice exceed
   max(threshold, 1.5 × its median gap). The threshold defaults to 30 days and is configurable.
   - Composition / POS walk-ins and parties marked "never remind" (R2-A5, if merged) are excluded.
2. **Places it shows.**
   - Dashboard insights tile: new card `quietCustomers`, computed in `insights.ts`, which is already lazy.
   - Clients list: chip **Gone quiet**.
   - Report "Customers gone quiet": last bill, usual gap, days quiet, last-12-month sales, top items. Exports CSV.
3. **Nudge.** A pre-filled `wa.me` message in the party's message language (`message-langs.ts`) listing their usual
   items (R3-B6). It is logged in `reminders` with additive `kind: 'nudge'`.
4. **Snooze** per party (30 / 60 / 90 days) and "Not a regular" (exclude).

**Files.**
- New: `src/lib/quiet-customers.ts`, `src/components/clients/QuietCustomers.tsx`.
- Edit: `src/lib/insights.ts` (one card), `src/pages/Clients.tsx` (chip + filter), `src/lib/message-langs.ts`
  (nudge text keys).

**Storage.** Object key `quiet_settings` (`{ threshold_days, snoozed: { [party_key]: until }, excluded: party_key[] }`).
Additive `reminders.kind?`.

**Bundle.** The insights tile and Clients page are already lazy. The quiet module is imported by them only.

**Tests.** `tests/quiet-customers.test.ts`:
- median gap rule;
- minimum history;
- snooze until a local day;
- exclusion;
- message language;
- party key for clients without id.

### R3-C — Document polish & compliance desks

#### R3-C1 Live paper preview pane and live template thumbnails

*Seen in:*
- Invoice Ninja: real-time PDF preview.
- Moon: themes.

*Today:*
- Preview is a modal (`InvoiceCreator.tsx:497`).
- The template picker shows emoji tiles (`TemplatePicker.tsx`).

**User story.** As a user on a laptop, I want the invoice paper beside the form updating as I type, and template
tiles showing *my* invoice in each design, so I choose and check without opening preview.

**Acceptance criteria.**
1. **Pane.**
   - At ≥ 1280 px width, the editor offers a **Live preview** pane (toggle; remembered per device in
     `mrchartist_editor_layout`, outside the prefix).
   - It renders `TemplateEngine` with the resolved design at fit-to-width scale.
   - Updates are deferred (`useDeferredValue` plus a 250 ms idle debounce) and read the store through `useShallow`
     selectors.
   - Typing latency must not regress. Budget: the input → paint p95 stays within 16 ms more than without the pane
     on a 40-line invoice, measured in `docs/qa/performance.md`'s method.
2. **Interaction.** The pane is read-only. Clicking a block (party, items, totals, notes) scrolls and focuses the
   matching form section.
3. **Thumbnails.** The template picker renders each tile as a small live `TemplateEngine` of the current draft (or
   the sample invoice when empty) at 0.18 scale.
   - Tiles render lazily with `IntersectionObserver` and are memoised by template id + draft hash.
   - Low-end devices (`navigator.hardwareConcurrency ≤ 4` or `prefers-reduced-motion`) get the static tiles.
4. Phones keep today's modal. Pinch-zoom preview is unchanged.

**Files.**
- New: `src/components/creator/LivePreviewPane.tsx`, `src/components/creator/TemplateThumb.tsx`, `src/lib/editor-layout.ts`.
- Edit: `src/pages/InvoiceCreator.tsx` (lazy mount of the pane), `src/components/creator/TemplatePicker.tsx`.

**Storage.** Device-local `mrchartist_editor_layout`.

**Bundle.**
- Both components are `React.lazy`. They import `TemplateEngine`, which already lives in the preview chunk.
- The pane mounts only when `matchMedia('(min-width: 1280px)')` matches and the toggle is on, so phones never
  download it.

**Tests.**
- `tests/editor-layout.test.ts`: parse / defaults / try-catch on storage.
- Playwright at 1366 px: typing a line updates the pane; at 390 px no pane chunk is requested (network log check).

#### R3-C2 Job evidence: item photos, photo pages and receiver signature

*Seen in:*
- Invoice Simple (product photos, signature).
- Billdu (image attachments; client signs with a finger).
- JobFLEX / Estimate GO (before / after photos, client signature, offline).

*Today:*
- Item photos exist only in the catalogue (`item-images.ts`).
- Attachments are stored, never printed (`src/lib/attachments.ts`).
- Signature canvas exists only for quotes (`AcceptQuoteDialog.tsx`).

**User story.** As an AC-repair contractor, I want photos of the parts on the quote, before / after photos at the end
of the invoice, and the customer's signature for "work done / goods received", so disputes end before they start.

**Acceptance criteria.**
1. **Item photos.**
   - Design Studio toggle `show_item_images` (per profile, off by default).
   - When on, lines whose catalogue item has an `image` print a thumbnail (16 mm) in the description cell. The
     line snapshots the `asset:<id>` reference at save, so later catalogue photo changes never change saved
     documents.
   - The GST grid layout and thermal paper never print them.
2. **Photo pages.**
   - In the editor's attachments card, mark image attachments **Print on document** with a caption and a
     group (Before / After / Other).
   - They print after the totals / annexure as a 2 × 2 grid per page with captions.
   - The PDF keeps the page breaks from `pageSlices`. At most 12 printed photos; larger images are downscaled once
     at attach time (`src/lib/image.ts`).
3. **Receiver signature (proof of delivery).**
   - On an issued invoice / delivery challan: Document actions → **Get signature**. The customer signs on the
     canvas and types their name, with an optional remark ("Received in good condition").
   - The PNG is stored as an asset reference with `signed_at`.
   - It is printed in a "Received by" block. This is an **event snapshot** like `acceptance`: written once, later
     replaced only by the owner with a reason, and audited.
   - The signature canvas is extracted from `AcceptQuoteDialog` into a shared `SignaturePad` (no behaviour change for
     quotes).
4. The client copy HTML and Share as image (R3-A5) include photos and the signature. The e-Invoice / e-Way JSON never
   do.

**Files.**
- New:
  - `src/components/ui/SignaturePad.tsx` (extracted);
  - `src/lib/doc-evidence.ts` (`printablePhotos`, `buildDeliveryProof`, validation);
  - `src/components/templates/parts/PhotoPages.tsx`;
  - `src/components/templates/parts/DeliveryProofBlock.tsx`;
  - `src/components/creator/DeliveryProofDialog.tsx`;
  - `src/types/docs-r3.ts`.
- Edit: `src/components/invoicing-ux/AcceptQuoteDialog.tsx` (use `SignaturePad`),
  `src/components/templates/parts/PaperItemsTable.tsx` (thumbnail cell), `src/components/templates/TemplateEngine.tsx`
  (one append, §6), `src/lib/design-prefs.ts` (additive `show_item_images`), `src/components/design/DesignPanel.tsx`,
  `src/components/creator/DocumentActions.tsx` (Get signature), `src/components/attachments/AttachmentsPanel.tsx` (print flag).

**Storage.**
- Additive `InvoiceItem.image?` on invoice lines (the field already exists on the catalogue shape).
- Additive `AttachmentRef.print?: { caption?, group? }`.
- Additive `InvoiceRecord.delivery_proof?: { receiver, remark?, signed_at, signature: 'asset:<id>', replaced?: { at, by, reason }[] }`.
- `setTable('invoices')` interning already handles `asset:` refs. A `delivery_proof.signature` given as a data URL
  is interned through `src/lib/assets.ts`, like sender images.

**Bundle.**
- `PhotoPages` and `DeliveryProofBlock` are `React.lazy` inside `TemplateEngine` and render only when data exists.
- The dialog is lazy from Document actions.
- `SignaturePad` moves into a lazy chunk shared by both dialogs.

**Tests.** `tests/doc-evidence.test.ts`:
- line image snapshot independent of later catalogue edits;
- photo cap and ordering by group;
- delivery proof write-once + owner replace with reason (audited);
- data URL interned to an asset;
- e-Invoice / e-Way builders ignore the fields.

Template snapshot test: an invoice without these fields renders byte-identical.

#### R3-C3 Page margins and letterhead / footer image

*Seen in:*
- Moon v7.19.3 PDF margin settings.
- Billdu / Invoice Ninja design editors.
- Indian businesses with a designed letterhead.

*Today:* only pre-printed stationery offsets (`design-prefs.ts:74, 177–179`).

**User story.** As a firm with a designed letterhead, I want to upload my header and footer artwork and set page
margins, so PDFs look like my printed stationery without buying pre-printed paper.

**Acceptance criteria.**
1. Design Studio → **Page**: margins top / right / bottom / left (mm, 0–30, default = today's template padding)
   applied through `paper-context.ts` and `printPageCss`.
2. **Letterhead image** (PNG / JPEG ≤ 400 kB, stored as an asset ref), with three modes:
   - *Header band*: full width, keeps its aspect, replaces the template header's logo / name block;
   - *Full page background*: under content, opacity 100%, content offset by margins;
   - *Footer band*: separate image.
3. Pre-printed mode (`preprinted`) disables letterhead images (they are mutually exclusive in the panel).
4. Repeated per page in the PDF: the header band on page 1 only or on every page (option). The `pageSlices`
   computation subtracts the band heights.
5. These are design prefs, not snapshots. This matches how design applies today (documented in
   `docs/features/design-studio.md`). Saved invoices re-render with the current letterhead, which is the existing
   behaviour for design.

**Files.**
- Edit: `src/lib/design-prefs.ts` (additive `margins_mm?`, `letterhead?: { image, mode, every_page }`,
  `footer_image?`; `pageSlices` takes band heights), `src/components/templates/paper-context.ts`,
  `src/components/templates/parts/PaperHeader.tsx`, `src/components/design/DesignPanel.tsx`.
- New: `src/components/design/PagePanel.tsx`.

**Storage.** Additive fields on `design_prefs` rows. Images go in `assets`.

**Bundle.** Design Studio is a lazy route. The template-engine change is a few lines in the preview chunk.

**Tests.** `tests/design-page.test.ts`:
- margins clamp;
- `pageSlices` with header / footer bands on page 1 vs every page;
- preprinted excludes letterhead;
- sanitise rejects non-image data URLs (reuse `SAFE_IMAGE` from `item-images.ts`).

#### R3-C4 GST portal file reader (GSTR-1 error report, downloaded GSTR-1)

*Seen in:*
- The GSTN offline tool opens the portal's error report, shows each error against its invoice and regenerates the
  JSON.
- For tables over 500 invoices it downloads the portal data, edits it and re-uploads (Tally help).

*Today:*
- We build GSTR-1 JSON (`src/lib/gstr-json.ts`) and run our own preflight (`src/lib/gst-preflight.ts`).
- We freeze our own filed snapshot (8.61).
- We never read the portal's files.

**User story.** As a GST filer whose upload came back "processed with error", I want to drop the portal's error file
into the app and see each error against my invoice with a Fix link, then download a corrected JSON of only the failed
documents. Also, after filing, I want to load the portal's GSTR-1 download and compare it with my books.

**Acceptance criteria.**
1. GST → Tools → **Portal files**. A file picker accepts `.json` or `.zip` (unzipped with `src/lib/zip.ts`) and
   detects the kind:
   - **error report** — sections with per-document `error_cd` / `error_msg`, as understood;
   - **GSTR-1 data** — the same section keys as our upload: `b2b`, `b2cl`, `cdnr`, …;
   - unknown — shown as "not recognised", nothing saved.

   Parsing is tolerant, like the 2B reader (`src/lib/gstr2b.ts:235`), and is labelled **"layout unverified —
   working paper"**.
2. **Error report view.**
   - Each error is matched to our document by GSTIN + normalised number + date.
   - Each row shows the portal code / message, our document, a plain-language hint for common codes (date outside
     period, invalid GSTIN, duplicate invoice, POS mismatch, rate not allowed) and a Fix link (opens the editor /
     party).
   - **Download corrected JSON (failed documents only)** reuses `buildGstr1Json` on the subset and runs preflight
     first.
3. **Downloaded GSTR-1 view.**
   - A diff against the books for the same period × GSTIN: missing on portal, missing in books, value / tax
     differences (≥ ₹ 1), with a link to the GSTR-1A paper (8.61) for later-period corrections.
   - Large periods are handled with virtualised tables (`virtual-window.ts`).
4. Each import is saved (file hash, kind, period, GSTIN, counts, findings capped at 2,000) with resolved ticks. A
   re-import of the same hash is detected.
5. Nothing is uploaded anywhere. The filing steps strip (8.162) gains an optional "Portal errors (n)" step when an
   error report exists for the period.

**Files.**
- New: `src/lib/gst-portal-files.ts` (detect, parse, match, diff), `src/components/gst-reports/PortalFilesView.tsx`,
  `src/i18n/areas/desks-r3.ts`.
- Edit: `src/lib/gst-tabs.ts` (one tab id in Tools), `src/pages/GstReports.tsx` (lazy tab mount).

**Storage.** Table `gst_portal_files`: `{ id, kind: 'gstr1_error' | 'gstr1_data', period, gstin, file_hash, imported_at, counts, findings, resolved: { [key]: true } }`.

**Bundle.** A lazy tab in the lazy GST page.

**Tests.** `tests/gst-portal-files.test.ts`:
- detection of each kind from fixtures (synthetic, written from public descriptions);
- match by normalised number / GSTIN;
- subset JSON equals the full build filtered;
- diff thresholds;
- same-hash re-import;
- zip input;
- unknown file rejected.

#### R3-C5 e-Way desk: validity, expiry watch, bulk vehicle update

*Seen in:*
- e-Way portal bulk tools: Vehicle Number Updation JSON Preparation and Transporter Updation.
- Rule 138(10) validity: one day per 200 km, one day per 20 km for over-dimensional cargo.
- Extension near expiry.

*Today:*
- We build EWB-01 JSON with distance (`src/lib/eway.ts:267`) and consolidated EWB (`eway-consolidated.ts`).
- `eway_valid_upto` is typed by hand or imported from the bulk IRN response (`einvoice-bulk.ts:548`).
- Nothing warns before expiry.

**User story.** As a dispatcher with 30 trucks on the road, I want the app to compute each EWB's validity, warn me
before it expires, and prepare a bulk vehicle-change file when goods are trans-shipped, so no consignment is caught
with an expired bill.

**Acceptance criteria.**
1. **Validity calculator.** From the generated date-time, distance and cargo type (normal / over-dimensional /
   multimodal with ship), compute `valid_upto` with a date-keyed rule table (from 1 Jan 2021: 200 km / 20 km per
   day; earlier: 100 km / 20 km).
   - Day-boundary convention: expiry at midnight of the last day, as understood — shown as an assumption with
     "verify with your CA".
   - Typed or imported `eway_valid_upto` always wins over the computed value. The UI shows both when they differ.
2. **e-Way desk** (GST → Tools → e-Way): active EWBs with vehicle, distance, valid upto and hours left. Filters:
   expiring in 24 h, expired, no Part-B (vehicle missing).
3. **Bell.** Lazy provider: "3 e-Way bills expire in the next 12 hours", "1 expired today". It is gated on
   `einvoice_meta` rows with an `eway_no`. Fingerprinted ids follow the existing snooze / dismiss rules.
4. **Bulk vehicle update.** Select EWBs → new vehicle number (validated by `VEHICLE_REGEX` / `normaliseVehicle`),
   place / state of change, reason (break-down / trans-shipment / others) and transporter doc no. / date.
   - Downloads the JSON for the portal's bulk update tool and a CSV. Labelled **"layout unverified — working
     paper"**.
   - The new vehicle is recorded on `einvoice_meta` with history.
5. **Extension reminder.** When an EWB is within the extension window (date-keyed constant; currently believed to
   be 8 hours before / after expiry — **verify with your CA**), the desk shows "Extend on the portal now" with the
   remaining distance prompt. There is no JSON for extension unless a bulk layout is confirmed (open question).
6. Transporter ID bulk update is a second option on the same dialog (same JSON caveat).

**Files.**
- New: `src/lib/eway-validity.ts` (rule table date-keyed, compute), `src/lib/eway-desk.ts` (rows, vehicle-update
  payload), `src/lib/eway-alerts.ts` (bell provider), `src/components/gst-reports/EwayDesk.tsx`.
- Edit: `src/components/einvoice/EInvoiceModal.tsx` (show computed validity beside the typed field; capture generated
  time / cargo type), `src/lib/gst-tabs.ts`, `src/pages/GstReports.tsx`.

**Storage.** Additive on `einvoice_meta`: `eway_generated_at?` (ISO), `eway_cargo?: 'normal' | 'odc' | 'multimodal_ship'`,
`eway_distance_km?`, `vehicle_history?: { at, vehicle, reason, place, state_code }[]`, `transporter_history?`.
The rule table lives in `src/lib/eway-validity.ts`. It is date-keyed and kept out of the first-paint `tax-rules.ts`,
as `gst-penalties.ts` is.

**Bundle.**
- The desk is a lazy GST tab.
- The bell gate `ensureEwayAlerts` in `NotificationBell.tsx` imports `eway-alerts.ts` only when `einvoice_meta`
  holds an EWB number (≈0.15 kB in the shell).

**Tests.** `tests/eway-validity.test.ts`:
- 1–200 km = 1 day, 201 km = 2 days, ODC 21 km = 2 days, multimodal;
- rule change on 1 Jan 2021;
- local-day expiry across midnight and 31 Mar;
- typed value wins;
- alert windows;
- vehicle normalisation;
- bulk payload shape snapshot;
- extension window from the constant.

#### R3-C6 Practice desk: all companies' compliance, DSC register, monthly checklist

*Seen in:*
- ATOM: compliance calendar across IT / GST / MCA / TDS, DSC expiry tracker.
- MyTask / QwikCA: recurring tasks, Kanban.
- ICAI prototype: client-specific compliance calendar.

*Today:*
- Each company has its compliance calendar (`src/lib/compliance.ts`) and TDS calendar (`TdsDueCalendar.tsx`).
- The only cross-company read is SmartFind's peek (`src/lib/company-peek.ts`).

**User story.** As an accountant keeping the books of 25 small clients as separate companies on one laptop, I want
one board with every client's pending returns, overdue filings, books lock status and DSC expiries, plus a monthly
checklist per client, so nothing is missed in the rush before the 11th and the 20th.

**Acceptance criteria.**
1. Route `/practice` (owner only), also reached from the company switcher. It is a read-only **board** of every
   company on the device. Each row shows:
   - GSTIN(s) and filing frequency from the profiles;
   - next due return and overdue count, from that company's `compliance` marks + calendar logic;
   - TDS return marks (`tds_returns`);
   - last voucher date;
   - period-lock date;
   - draft count;
   - checklist progress;
   - nearest DSC expiry.
2. **Read path.** Other companies are read with a read-only, version-less IndexedDB open, extending
   `company-peek.ts` (`peekCompliance(dbName)`).
   - Vault-sealed or unreadable companies show "Locked — open to see".
   - Nothing is written to another company. Actions ("Mark filed", "Open") switch company through the existing
     switcher (flush + reload).
3. **DSC register** (per company, company data): holder, role (director / partner / proprietor / authorised
   signatory), class, token / issuer, valid from / to. The bell warns 30 / 7 days before expiry in the open company,
   and the practice board shows all of them.
4. **Monthly checklist** (per company): template items (e.g. "Bank statement received", "Sales register shared",
   "GSTR-2B downloaded", "TDS challan paid"), ticked per month. It carries over unticked items with a flag. The
   template is editable per company with a device default.
5. Board export: CSV / XLSX of the board (dynamic `xlsx.ts`).
6. Due dates come from the existing calendar logic. Government extensions are entered as one-off overrides (8D
   follow-up, not built) — the board shows "due dates as per the standard calendar; check notified extensions —
   verify with your CA".

**Files.**
- New: `src/lib/practice.ts` (row builder from peeked tables), `src/lib/dsc-register.ts`, `src/lib/client-checklist.ts`,
  `src/pages/Practice.tsx`, `src/components/practice/DscRegister.tsx`, `ChecklistPanel.tsx`, `src/lib/dsc-alerts.ts`.
- Edit: `src/lib/company-peek.ts` (append `peekCompliance` reading `settings`, `compliance`, `tds_returns`,
  `period_lock`, `dsc_register`, `client_checklist`, `invoices` / `vouchers` max dates), `src/components/companies/CompaniesPanel.tsx`
  (link).

**Storage.** Tables `dsc_register` (rows) and `client_checklist` (`{ id: 'YYYY-MM', items: { id, label, done_at?, by? }[] }`).
Object key `checklist_template`. All per company, backed up and synced.

**Bundle.**
- `/practice` is a lazy route; the peek is async and on demand.
- The DSC bell gate `ensureDscAlerts` returns early unless `dsc_register` has rows.

**Tests.** `tests/practice.test.ts` uses a fake peek input (the IndexedDB open is not tested in Node):
- row building;
- overdue / next due per frequency;
- locked company row;
- DSC expiry windows in local days;
- checklist carry-over across months and FY;
- no writes to peeked data (frozen input).

---

## 5. Work packages

There are three packages, each buildable by one agent in its own worktree. Each file is owned by one package; the few
shared touchpoints are append-only and listed in §6. **Precondition:** R2-A and R2-B are merged, so their files
(`ClientFormModal.tsx`, `PartiesSection.tsx`, `TemplateEngine.tsx`, `Clients.tsx`, `invoice.ts`, …) are stable.

### R3-A — Restaurant & counter (5 items)

Items:
- **A1** tables & running orders;
- **A2** KOT;
- **A3** split bill;
- **A4** modifiers & 86;
- **A5** share as image.

Owned files (new):
- `src/lib/restaurant/{tables,orders-store,kot,kot-print,split-bill,modifiers}.ts`
- `src/lib/share-image.ts`
- `src/pages/Tables.tsx`
- `src/components/restaurant/*`
- `src/types/restaurant.ts`
- `src/i18n/areas/restaurant.ts`
- `docs/features/restaurant.md`
- tests `restaurant-*.test.ts`, `share-image.test.ts`

Owned files (edit):
- `src/lib/shop-presets.ts`
- `src/lib/pos-shifts.ts`
- `src/lib/escpos.ts` (append-only helper)
- `src/lib/pos-share.ts`
- `src/pages/Pos.tsx`
- `src/components/pos/PosTiles.tsx`
- `src/components/preview/InvoicePreview.tsx`
- `src/components/share/ShareMenu.tsx`

Shared (append-only, §6):
- `src/lib/pos.ts` (`dayCloseDb` guard hunk only)

Lead wiring:
- `/tables` route + `PATH_MODULE['/tables'] = 'pos'`
- `'restaurant'` in `BusinessType` (`src/lib/shop-mode.ts`)
- nav entry under POS

First-paint delta target: ≤ +0.2 kB gz.

### R3-B — Service billing & party speed (7 items)

Items:
- **B1** rate cards;
- **B2** projects board;
- **B3** retainers;
- **B4** timesheet annexure;
- **B5** party document defaults;
- **B6** repeat last bill & usual items;
- **B7** customers gone quiet.

Owned files (new):
- `src/lib/{rate-cards,projects,project-alerts,retainers,annexure,party-defaults,party-habits,quiet-customers}.ts`
- `src/components/time/{ProjectsBoard,ProjectHeader,RetainersTab,RetainerReport}.tsx`
- `src/components/templates/parts/AnnexureBlock.tsx`
- `src/components/clients/{DocDefaultsFields,QuietCustomers}.tsx`
- `src/components/creator/PartyHabitsStrip.tsx`
- `src/types/service-r3.ts`
- `src/i18n/areas/service-r3.ts`
- `docs/features/service-billing.md`
- tests listed above

Owned files (edit):
- `src/lib/timesheets.ts`
- `src/lib/cost-centres.ts`
- `src/lib/insights.ts`
- `src/lib/message-langs.ts`
- `src/lib/import-mapping.ts`
- `src/pages/Time.tsx`
- `src/pages/Clients.tsx`
- `src/components/time/{TimerCard,TimeForms,BillClientModal}.tsx`
- `src/components/modals/ClientFormModal.tsx`
- `src/components/creator/PartiesSection.tsx`
- `src/components/creator/line-keys.ts`

Shared (§6):
- `src/components/templates/TemplateEngine.tsx` (one lazy block)
- `src/components/creator/DocumentActions.tsx` (one action)
- `src/pages/Pos.tsx` (one lazy tiles row — A owns, B adds one line)

First-paint delta target: ≤ +0.3 kB gz (`RECORD_KEYS` string + project bell gate).

### R3-C — Document polish & compliance desks (6 items)

Items:
- **C1** live preview pane & thumbnails;
- **C2** item photos, photo pages, receiver signature;
- **C3** page margins & letterhead image;
- **C4** GST portal file reader;
- **C5** e-Way desk;
- **C6** practice desk.

Owned files (new):
- `src/components/creator/{LivePreviewPane,TemplateThumb,DeliveryProofDialog}.tsx`
- `src/lib/editor-layout.ts`
- `src/components/ui/SignaturePad.tsx`
- `src/lib/doc-evidence.ts`
- `src/components/templates/parts/{PhotoPages,DeliveryProofBlock}.tsx`
- `src/components/design/PagePanel.tsx`
- `src/lib/{gst-portal-files,eway-validity,eway-desk,eway-alerts,practice,dsc-register,client-checklist,dsc-alerts}.ts`
- `src/components/gst-reports/{PortalFilesView,EwayDesk}.tsx`
- `src/pages/Practice.tsx`
- `src/components/practice/*`
- `src/types/docs-r3.ts`
- `src/i18n/areas/desks-r3.ts`
- `docs/features/desks-r3.md`

Owned files (edit):
- `src/pages/InvoiceCreator.tsx`
- `src/components/creator/TemplatePicker.tsx`
- `src/components/invoicing-ux/AcceptQuoteDialog.tsx`
- `src/components/templates/parts/{PaperItemsTable,PaperHeader}.tsx`
- `src/components/templates/paper-context.ts`
- `src/lib/design-prefs.ts`
- `src/components/design/DesignPanel.tsx`
- `src/components/einvoice/EInvoiceModal.tsx`
- `src/lib/gst-tabs.ts`
- `src/pages/GstReports.tsx`
- `src/lib/company-peek.ts`
- `src/components/companies/CompaniesPanel.tsx`
- `src/components/attachments/AttachmentsPanel.tsx`

Shared (§6):
- `TemplateEngine.tsx` (two lazy blocks)
- `DocumentActions.tsx` (one action)

Lead wiring: `/practice` route (owner only).

First-paint delta target: ≤ +0.4 kB gz (two bell gates + `RECORD_KEYS` strings).

**Combined budget:** ≤ +0.9 kB gz, so initial JS stays ≤ ~181 of 185 kB. Each package runs `npm run build && npm run
check:size` and records the before / after numbers in its feature doc. Total precache (`BUDGET_TOTAL_GZ_KB` = 2000)
must not be raised without the lead.

---

## 6. Merge protocol for shared touchpoints

Merge order: **R3-A → R3-B → R3-C**. Each later package rebases and resolves the append-only conflicts mechanically
(keep both sides).

| File | Who | Rule |
|---|---|---|
| `src/types/invoice.ts` | none | Not edited. Fields come by declaration merging in `src/types/restaurant.ts` (A: `InvoiceRecord.table_order_id`, `split_of`; `InvoiceItem.modifier_of`, `note`, `seat`, `unavailable_on`), `src/types/service-r3.ts` (B: `InvoiceRecord.annexure`; `Client.doc_defaults`; `TimeEntry.work_type_id`, `task_id`, `retainer_id`, `retainer_period` via `declare module './time'`), `src/types/docs-r3.ts` (C: `InvoiceRecord.delivery_proof`; `InvoiceItem.image` on lines is already declared; `AttachmentRef.print`). |
| `src/store/useInvoiceStore.ts` `RECORD_KEYS` | A, B, C | Each package adds **one new line at the end of the array**, prefixed by a comment `// R3-A`, `// R3-B` or `// R3-C`. On rebase, keep all lines in merge order. No other edit to the store. |
| `src/components/templates/TemplateEngine.tsx` | B, C | No owner in R3. B adds `<LazyAnnexure invoice={invoice} />` after the last body block (after R2-B's blocks). C adds `<LazyPhotoPages …/>` after B's line and `<LazyDeliveryProof …/>` directly after the signature block. Each is wrapped in its own `Suspense fallback={null}` and renders nothing without data. |
| `src/components/creator/DocumentActions.tsx` | B, C | B appends "Download annexure" and C appends "Get signature" as the last two actions, in that order. |
| `src/pages/Pos.tsx` | A (owner), B | B adds one lazy `<UsualTiles>` line next to the customer picker, after A merges. |
| `src/lib/pos.ts` | A | A edits only the day-close guard. No other package edits it. |
| `src/components/command/NotificationBell.tsx` | B, C | Each adds its `ensure…Alerts` function(s) after `ensurePackAlerts`, and one call each in the poll effect, in merge order. |
| `src/lib/backup.ts` `RECORD_TABLES` / `ID_TABLES` | A, B, C | One appended line per package with a `// Round 3 (R3-X)` comment. A: `dining_areas`, `dining_tables`, `table_orders`, `modifier_groups`. B: `work_types`, `project_tasks`, `retainers`. C: `gst_portal_files`, `dsc_register`, `client_checklist`. |
| `src/lib/audit-edits.ts` `WATCHED_TABLES` | A, B, C | Same, one appended block per package. |
| `src/lib/access.ts` `TABLE_ACTIONS` | A, B, C | Same. Masters → `master.edit`; `table_orders` → `doc.create`; `gst_portal_files`, `dsc_register`, `client_checklist` → `books.edit`. |
| `src/lib/sync-engine.ts` `DATED` / `NUMBERED` | A, B | `table_orders` (DATED by `opened_at`), `retainers` (DATED by `start`). C adds none. |
| `src/components/command/CommandPalette.tsx` | A, B, C | Each adds one appended command group ("Tables", "Projects / Retainers", "Portal files / e-Way desk / Practice"). |
| `src/lib/gst-tabs.ts` | C only | Two tab ids in the Tools group (`portal-files`, `eway-desk`). Old ids unchanged. |
| `src/App.tsx`, `src/layouts/DashboardLayout.tsx`, `src/lib/shop-mode.ts` | lead | The lead adds `/tables` and `/practice` lazy routes, nav entries, `PATH_MODULE`, the `restaurant` business type. Packages describe the exact snippet in their feature doc. |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md` | lead | Packages write only their own `docs/features/*.md`. The lead adds the Round 3 rows, table rows and storage keys after merging. |
| `tests/purchase-contract.test.ts` | B | B adds `retainers.ts` only if it reads purchases (it should not; re-billed expenses keep going through `timesheets.ts`). |

Every package must pass `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run check:size` on
its own branch, and again after rebasing on the previous package. No new runtime dependencies.

---

## 7. New storage summary

| Key / table | Package | Kind | Backed up | Synced |
|---|---|---|---|---|
| `mrchartist_inv_dining_areas` | A | rows | yes | yes |
| `mrchartist_inv_dining_tables` | A | rows | yes | yes |
| `mrchartist_inv_table_orders` | A | rows (dated) | yes | yes (not real time) |
| `mrchartist_inv_modifier_groups` | A | rows | yes | yes |
| `mrchartist_inv_restaurant_settings` | A | object | yes | yes |
| `mrchartist_kot_printers` | A | device-local (outside prefix) | no | no |
| `mrchartist_inv_work_types` | B | rows | yes | yes |
| `mrchartist_inv_project_tasks` | B | rows | yes | yes |
| `mrchartist_inv_project_settings` | B | object | yes | yes |
| `mrchartist_inv_retainers` | B | rows (dated) | yes | yes |
| `mrchartist_inv_quiet_settings` | B | object | yes | yes |
| `mrchartist_inv_gst_portal_files` | C | rows | yes | yes |
| `mrchartist_inv_dsc_register` | C | rows | yes | yes |
| `mrchartist_inv_client_checklist` | C | rows (per month) | yes | yes |
| `mrchartist_inv_checklist_template` | C | object | yes | yes |
| `mrchartist_editor_layout` | C | device-local (outside prefix) | no | no |

Additive fields:
- **A:** `InvoiceRecord.table_order_id`, `split_of`; line `modifier_of`, `note`, `seat`; catalogue `unavailable_on`.
- **B:** `InvoiceRecord.annexure`; `Client.doc_defaults`; `TimeEntry.work_type_id`, `task_id`, `retainer_id`,
  `retainer_period`; `CostCentre.hourly_rate`, `client_key`, `budget_minutes`, `fee_budget`, `start`, `due`,
  `status`; `reminders.kind`.
- **C:** line `image` (asset ref); `AttachmentRef.print`; `InvoiceRecord.delivery_proof`; `design_prefs.show_item_images`,
  `margins_mm`, `letterhead`, `footer_image`; `einvoice_meta.eway_generated_at`, `eway_cargo`, `eway_distance_km`,
  `vehicle_history`, `transporter_history`.

No new numbered series. KOT numbers are daily counters inside `table_orders`, not tax documents. Split sub-bills use
the existing POS invoice series.

---

## 8. Open questions

Statutory questions are flagged **(verify with your CA)**. Outputs stay labelled as working papers.

1. **Restaurant GST rate (R3-A1) (verify with your CA).**
   - The starter preset assumes restaurant service at 5% without ITC.
   - Restaurants in "specified premises" (hotel tariff above the notified limit) are assumed at 18% with ITC.
   - Composition restaurants keep the existing composition logic (`docs/features/composition-amendments.md`).
   - Questions:
     - Are these still the values after the GST 2.0 rate changes (22 Sep 2025)?
     - Should the area / profile carry a "specified premises" flag in a date-keyed rule in `tax-rules.ts`?
     - How should outdoor catering be treated?
2. **Service charge (R3-A1) (verify with your CA / legal adviser).**
   - Default off, optional, removable, labelled "optional": is that sufficient under the consumer-protection
     guidelines on service charge as understood?
   - Is GST on a voluntarily paid service charge right at the food rate?
   - Should service charge be excluded from the tip-like "staff" payout reports?
3. **Split bills (R3-A3) (verify with your CA).**
   - Item / seat splits create separate tax invoices, and equal / custom splits keep one invoice with several
     payers. Is that acceptable?
   - Must sub-invoices reference each other or the order on the paper?
   - Is absorbing paisa drift in round-off (not tax) the right practice?
4. **Aggregator orders (R3-A1) (verify with your CA).**
   - Sec 9(5) makes the operator liable for restaurant service through it, so the restaurant reports value only.
     Confirm the Table 14(b) / 3B 3.1.1(ii) treatment already built and the ECO GSTIN requirement.
   - Should aggregator commission invoices be prompted as purchases with ITC?
5. **Retainers (R3-B3) (verify with your CA).**
   - Is time of supply for a monthly retainer the invoice date, or the earlier of invoice / payment, for continuous
     supply of services (Sec 13, Sec 31(5))?
   - Is a forfeited unused block plain income with no GST change?
   - Is overage billed in the next period a separate supply?
6. **e-Way validity and extension (R3-C5) (verify with your CA).**
   - Confirm the Rule 138(10) distances.
   - Does a "day" end at midnight of the day the period runs out (counted from generation), or 24 h blocks?
   - Confirm the extension window (believed 8 hours before / after expiry), who may extend, and whether a bulk
     extension JSON exists.
   - Confirm the layout of the portal's Vehicle Number Updation and Transporter Updation JSON.
   - Is the 15 Jun 2026 ship-to GSTIN advisory cited by a vendor real, and does it change `buildEway`?
7. **Portal files (R3-C4) (verify with your CA).**
   - What is the exact structure of the GSTR-1 error report (zip contents, `error_cd` keys per section) and of the
     downloaded GSTR-1 JSON?
   - Should we also read the offline tool's own saved files?
   - Should a corrected subset JSON be marked "replace" vs "add" for documents already saved on the portal?
8. **DSC register (R3-C6).** Should a DSC belong to the person (one register across companies, device-local) or to
   each company (proposed)? Should the board read the PAN of the holder? Privacy: the board shows every company's
   status to whoever holds the owner PIN on this device — acceptable?
9. **Receiver signature (R3-C2).** Is a finger signature on the seller's device adequate proof of delivery for
   e-commerce disputes or Sec 16(2)(b) "goods received" by a buyer claiming ITC? Should we add a typed OTP-free
   attestation line?
10. **Photos and file size (R3-C2, R3-C3).** Should printed photos and letterhead images be capped further for the
    client-copy HTML (data URIs) and share-as-image, given WhatsApp's compression? Proposed caps: 12 photos, 400 kB
    letterhead.
11. **Live preview performance (R3-C1).** Is the 1280 px breakpoint right for 13" laptops at 125% scaling? Should
    the pane be allowed on tablets in landscape?
12. **Long-tail scope.** Are an appointment book (Billdu), a kitchen display window and table reservations worth a
    Round 4 restaurant / services package once R3-A ships?
