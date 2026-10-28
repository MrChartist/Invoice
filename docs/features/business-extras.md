# Business extras (WP-9: Busy / Marg / Vyapar / Zoho strengths)

Gap ids from `docs/GAP_ANALYSIS.md`: **P1-25** POS returns, **P1-18** approvals, **P1-19** branches, **P1-17** dashboard
tiles, and from P2: loyalty points, AMC / service contracts and the static catalogue HTML. Everything is local, opt-in
and additive. A user who turns nothing on sees two new things: a **Return / exchange** button on the POS and a
**Business tiles** section under the Dashboard.

| Piece | Pure logic | UI | Tests |
|---|---|---|---|
| POS returns / exchange | `src/lib/pos-returns.ts`, `zReport` in `src/lib/pos.ts` | `components/pos-returns/{PosReturnModal,ExchangeCredit,ZReturnsRows}.tsx` (POS header button, lazy) | `tests/integration/pos-returns.test.ts`, e2e step |
| Approvals | `src/lib/approval-gate.ts` (data-layer gate), `src/lib/approvals.ts` (owner side) | `components/approvals/ApprovalsPanel.tsx` (Dashboard tile), `ApprovalBanner` | `tests/approvals.test.ts` |
| Branches | `src/lib/branch.ts` | `components/branches/BranchesPanel.tsx` (tile), branch filter on the tiles | `tests/branch.test.ts`, `tests/purchase-contract.test.ts` |
| Dashboard tiles | `src/lib/dashboard-tiles.ts` | `components/dashboard/DashboardTiles.tsx` (lazy, after first paint) | `tests/business-extras.test.ts` |
| Loyalty points | `src/lib/loyalty.ts` | `components/loyalty/{LoyaltyPanel,LoyaltyRedeem}.tsx` (tile; POS customer card) | `tests/business-extras.test.ts` |
| AMC / service contracts | `src/lib/amc.ts` | `components/amc/AmcPanel.tsx` (tile) | `tests/business-extras.test.ts` |
| Catalogue HTML | `src/lib/catalogue-html.ts` | Dashboard → Business tiles → Customise → *Export catalogue (HTML)* | `tests/business-extras.test.ts` |
| Strings (English + Hindi) | `src/i18n/areas/extras.ts` (`defineArea`) | — | `tests/i18n-areas.test.ts` |

## Data (all additive)

| Where | Field / table | Notes |
|---|---|---|
| `InvoiceRecord` | `approval?: ApprovalInfo`, `branch_id?`, `loyalty_redeem?: {points, value}` | in `RECORD_KEYS` + `normalizeRecord`; `approval` and `loyalty_redeem` are cleared by conversions, credit / debit notes and late-fee invoices |
| `PurchaseRecord` | `branch_id?` | contract row added to `tests/purchase-contract.test.ts` |
| `ManualVoucher` | `branch_id?` | kept by `normalizeVouchers` / `saveVoucher` |
| new table `pos_returns` | `PosReturn` | backup `RECORD_TABLES` + `ID_TABLES`; `TABLE_ACTIONS: doc.create` |
| new table `approvals` | decision log | backup; `TABLE_ACTIONS: doc.create` (deciding needs `doc.approve` in the API) |
| new table `branches` | `Branch` | backup; `master.edit` |
| new table `loyalty_adjustments` | manual points | backup; `master.edit` |
| new table `amc_contracts` | `AmcContract` | backup; `master.edit` |
| key `approval_policy` | `{enabled, mode: 'all' \| 'above', threshold}` | object, backed up with every `mrchartist_inv_*` key; saved with `settings.manage` |
| key `loyalty_program` | `{enabled, rules: [{from, points_per_100, point_value}], min_redeem}` | date-keyed rules (append, never overwrite) |
| key `dashboard_tiles` | `{ [userId \| 'default']: TileId[] }` | per local user |
| `pos_day_close` rows | `cash_refunds?` | expected cash = float + cash taken − cash refunded |

## POS returns / exchange (P1-25)

1. POS → **Return / exchange**: scan or type the bill number (exact, or a unique trailing sequence: "17" finds
   `INV/FY26-27/0017`), or pick one of the recent POS bills. Any issued sales bill can be returned, not only POS bills.
2. Choose quantities per line (*All* fills what is still returnable; earlier credit notes are subtracted).
3. Settle:
   - **Refund now** by cash / UPI / card. Defaults to the way the bill was paid; the total must equal the credit note and
     can never exceed what was received on the bill less earlier refunds. Booked as one **payment voucher**
     (`PV/FY…`): Dr Sundry debtors (the bill's party) / Cr Cash or Bank.
   - **Exchange**: the credit note is saved now and the credit pays the next bill on the counter (shown under the total;
     tenders cover the rest). On save, a Cash payment row with the note `POS exchange CRN/…` settles the new bill and one
     voucher Dr debtors / Cr Cash books the credit; credit larger than the new bill is refunded in cash.
   - **Keep on account** (saved customers only): the credit note reduces what they owe.
4. The credit note goes through `documents.createCreditNote` with `goods_returned: true` (so `credit-restock.ts` puts the
   stock back, batches / serials as usual) and the `credit_note` doc link.

**Z report**: returns count and credit-note numbers, returns value, refunds by tender, exchanged amount, kept on account,
**net sales after returns**; exchange credit used on bills is shown separately and kept out of the cash / UPI / card
tenders; the drawer's expected cash subtracts cash refunds. CSV and the 80 mm print include the same block.

## Approvals — maker-checker (P1-18)

- New access action **`doc.approve`** (owner only). Policy (Dashboard → Approvals tile → *Approval settings*, owner):
  off by default; "Invoices above ₹X" or "All documents by clerks".
- **The single guarded branch** in `localDb.invoices.save` (after the id / number are set, before the Rule 46 check) calls
  `holdIfApprovalNeeded`: when the saver cannot approve and a document is being *issued* (new, or leaving Draft), it is
  stored as **Draft** with `approval.state = 'pending'` and the status the clerk asked for. Decision: we did **not** add an
  `InvoiceStatus` value — a pending document is a draft for every report (revenue, GST papers, books, receivables, stock),
  cannot take payments (the list only offers payment on revenue documents) and keeps its **provisional number** (the gap's
  "or a provisional number" option: approval never renumbers). The UI label is "Pending approval".
- POS counter bills are exempt (paid at the counter). Single-user installs (nobody signed in = owner) are never held.
- Owner queue: `pendingApprovals()`; `approveDocument(id, note?)` re-saves with the requested status;
  `rejectDocument(id, note)` keeps the draft with the note (the clerk edits and saves again → a new request). Both write
  the audit log ("Approved INV/… requested by …") and a row in `approvals`.
- A copied record never carries an approval over (`approval.doc_id` must match).

## Branches / locations (P1-19)

- Master in the Branches tile (`master.edit`): name, optional GSTIN (sets the state), optional business profile.
- A row's branch: its own `branch_id`; else, for documents, the branch that names the document's sender profile or GSTIN;
  for purchases, the only branch in the bill's place-of-supply state; vouchers only by tag.
- `filterByBranch`, `matchesBranch` (`''` = all, `UNASSIGNED` = rows without a branch), `branchSummary` (FY sales /
  returns / purchases per branch, "No branch" row), `branchPredicates(branchId)` (one predicate per table).
- The Dashboard tiles have a branch filter (receivables, payables, cash / bank, GST, top items all narrow to the branch).

**Branch-wise books (7N, `src/lib/ledger/branch-books.ts`).** The ledger built by `loadLedgerInput()` carries the
branch master, so `buildLedger` records each voucher's branch (`Ledger.voucherBranch`). Every report builder takes the
option `{ branchId }` (`ReportScope`): `trialBalance`, `ledgerProfitAndLoss`, `ledgerBalanceSheet`, `cashFlowStatement`,
`accountStatement`, `groupSummary` (in its options), `ledgerDayBook`, `voucherRegister`, `voucherStatistics`, and the
Gateway `buildFrame` (`FrameOptions.branchId`). `scopeLedger(ledger, { branchId })` narrows once (cached per ledger).

- Sales / credit notes: `branchOfInvoice`; receipts and advance adjustments follow their invoice; bills / expenses:
  `branchOfPurchase`; supplier payments and debit notes follow their bill; manual vouchers: `branch_id`. Openings,
  depreciation, payroll, challans, advances received and on-account supplier payments are company level ("No branch"),
  as is a row tagged with a deleted branch — so the branches plus "No branch" always add up to the company books, and each
  branch trial balance balances on its own (`tests/branch-books.test.ts`).
- Report-time closing stock in a branch view is the stock lying in the branch's godowns (7S, `branch-stock.ts`); see
  reports-engine.md.
- UI: branch filter (`BranchFilter`, shown once a branch exists) in the Books statements toolbar (Day book, P&L, Reports,
  TB, Ledger, BS, Cash flow), on Gateway Display (kept in the URL as `b=`), Transactions and the purchase list; branch
  select on manual vouchers (Books voucher editor, Gateway voucher entry).

**Inter-branch transfer between distinct GSTINs (Sec 25(4), `src/lib/branch-transfer.ts`).** A branch can name its
godown (`Branch.godown_id`; sub-godowns belong to their parent's branch). A stock transfer whose godowns belong to two
branches with different GSTINs shows **Tax invoice + bill** in the transfer list: the dialog takes a value per unit
(default: average cost, else the opening / sale rate — Rule 28, verify with your CA) and saves

- a TAX_INVOICE from the sending branch (its GSTIN on the sender snapshot, the receiving branch as client, place of
  supply = receiving state, IGST across states), and
- the matching purchase bill at the receiving branch (ITC eligible, bill number = invoice number).

Both carry `branch_transfer_id` and post to the default ledgers **4030 Branch transfer (outward)** / **5020 Branch
transfer (inward)** instead of Sales / Purchases, so the pair nets to nil on consolidation and only the GST remains. Lines
keep their HSN but carry the transfer number in the name, so the stock engine does not move the goods again (the transfer
voucher already did). One pair per transfer (a cancelled invoice frees it). Working paper — verify with your CA.

## Dashboard tiles (P1-17)

`DashboardTiles` is a separate chunk mounted after first paint (`setTimeout 0` + `React.lazy`), so the Dashboard's initial
JS and first render are unchanged. Tiles: Receivables (outstanding / overdue), Payables (unpaid bills), Cash & bank
(Books balances today), GST payable this month (after ITC, working paper), Top items this FY, Low stock, Branches,
Approvals, AMC, Loyalty. *Customise tiles* picks them per local user. The figures come from the same libraries as the
Books / Receivables screens (`summarize`, `buildVouchers` + `accountBalanceAt`, `gstSummary`, `loadPositions`).

## Loyalty points (P2)

- Programme (Loyalty tile, `settings.manage`): points per ₹100 of taxable sales, ₹ per point, minimum to redeem. A changed
  rate is appended from today (old bills keep the rate of their date).
- Accrual is derived: live sales bills of a saved customer earn; credit notes take back; cancelled bills earn nothing and
  return their redeemed points; the walk-in row never earns. Manual corrections in `loyalty_adjustments`.
- Redemption (POS customer card, and the invoice editor's summary panel through the lazy `EditorLoyalty`, mounted only
  while the programme is on, for sales bills with a customer): `applyRedemption` adds the
  value to the bill's invoice-level **amount discount** and stores `loyalty_redeem`. GST is on the reduced value (discount
  at the time of supply, Sec 15(3)(a)) — verify with your CA. A % invoice discount must be removed first.

## AMC / service contracts (P2)

Contracts with start / end, value, visits per year. Visits are spread evenly (12 / n months); logged visits use the
schedule in order. Reminders: a visit due within 7 days or overdue; contract ending within 30 days (per contract
`renew_notice_days`) or expired in the last 60 days and not renewed. *Renew* copies the contract for the same length
from the day after it ends (`renewed_from`). Bill the AMC as a normal invoice (`invoice_id` can link it).
Integration point for the bell: `amcReminders(amcDb.all(), today)` → one notice per reminder (`id` is stable).

## Static catalogue HTML (P2)

One script-free HTML file (light / dark, phone-friendly, print-friendly) from the catalogue: name, description, HSN,
unit, SKU, price incl. GST (or + GST), MRP strike-through, stock status for tracked items and an **Order** link
(`wa.me/<phone>?text=Order: …` from the profile phone, else `mailto:`). The app makes no network call; the file is
downloaded for sharing / hosting.

**Catalogue v2 (8H, roadmap 8.122)** — `buildCatalogue` / `catalogue-export.ts`:

- **Photos**: catalogue items (and stock items) carry an additive `image: 'asset:<id>'`; the picture is stored once in
  the existing `assets` table (content-hash interning, backed up / synced) and inlined as a data URI in the export.
  Only raster data URIs (PNG / JPEG / WebP / GIF) are accepted — never SVG. Set in Settings → Items (Photo).
- **Categories**: the catalogue item's `group_id`, else its stock item's stock group; one section per category with a
  category bar.
- **Badges**: "N% off MRP" when the MRP is above the price; an optional offer text badge.
- **Cart**: the buyer adds items and quantities and sends **one** WhatsApp (or e-mail) order message with every line,
  the total and their name (`cartMessage`, unit-tested; the inline script builds the same text). The file carries one
  small inline script under a **hash-pinned CSP in a `<meta>` tag**: `default-src 'none'; img-src data:;
  style-src 'sha256-…'; script-src 'sha256-…'; form-action 'none'; base-uri 'none'`. Why that is safe: no
  `unsafe-inline`, no network, and the only script allowed is the exact constant whose hash is computed at export
  (`cataloguePolicy`, tested against node's SHA-256); item data travels in a non-executed JSON block with `<`, `>`, `&`
  escaped, and the script writes only `textContent` / `href`. Every value in the HTML is escaped.
- **Script-free fallback**: "Catalogue without cart" exports under `script-src 'none'`; either file keeps an Order link
  per item and an "Order from this category" link (the category's items listed for the buyer to fill in quantities), so
  it works with JavaScript off.

## Wiring

Done in the integration pass: `ApprovalBanner` in the invoice editor (lazy, only for pending / rejected documents);
Transactions "Pending approval" filter (shown while any is pending) and badge; branch select (`BranchSelect`, shown once
a branch exists) on the invoice editor and the purchase bill form; bell notices for pending approvals (approver only)
and `amcReminders` (`src/lib/business-alerts.ts`, loaded lazily); palette destination "POS return / exchange" →
`/pos?return=1`, which opens the return dialog straight away (also when already on the POS).

7N: loyalty redemption in the editor, branch filter on the Transactions / purchase lists, branch select on manual
vouchers, branch-wise books and the Sec 25(4) transfer pair (above). The bell's GST set-off reminder now reaches every
regular (non-composition) GSTIN filer, even before the set-off screen was first used.

## 7U: sales commission, offers, ESC/POS, pharma pack (roadmap 7.43, 7.154–7.157)

All opt-in; strings in `src/i18n/areas/extras-7u.ts` (`x7T`, English + Hindi). New Dashboard tiles (not on by
default, *Customise tiles*): **Sales agents & commission**, **Offers & schemes**, **Pharma pack** (each its own lazy
chunk under `src/components/extras7u/`). The invoice editor's summary panel mounts the lazy `EditorExtras` only once
an agent, a bill-value offer or the pharma pack exists.

| Piece | Pure logic | Data (additive) | Tests |
|---|---|---|---|
| Sales commission | `src/lib/sales-commission.ts` | table `sales_agents` (`master.edit`), table `commission_postings` (`books.edit`, DATED), `InvoiceRecord.agent_id` | `tests/extras-7u.test.ts` |
| Offers | `src/lib/offers.ts`, `pricing.ts` (`Scheme.kind`, `free_item_*`, `slabs`, `label`) | `schemes` rows, `InvoiceRecord.offer {scheme_id, label, value}` | same |
| ESC/POS / raw receipt | `src/lib/escpos.ts`, `components/extras7u/{PosPrinter.tsx,pos-raw-print.ts}` | device-local `mrchartist_pos_printer` (localStorage, never backed up) | same |
| Pharma pack | `src/lib/pharma.ts`, `src/lib/pharma-gate.ts` | key `pharma_settings`, `stock_items.drug_schedule`, `SenderProfile.drug_licence`, `InvoiceRecord.rx` | same |

**Sales commission.** Agent master: name, phone, PAN, flat % of taxable value, % per stock group (covers
sub-groups, nearest group wins), basis **on invoice** (bill date; credit notes naming the agent take it back) or **on
receipt** (pro rata to money received in the period, capped at the bill). Base = line taxable value in rupees
(foreign documents at the invoice rate), so GST / cess / TCS / freight earn nothing. Statement + CSV per agent and
period; **Post payable journal**: Dr "Sales commission" (a user ledger created on first use under Indirect expenses,
code 6195+) | Cr Sundry creditors with the agent as party, via `saveVoucher` (period lock, audit, roles); periods of
one agent cannot overlap; *Undo* deletes the journal. TDS u/s 194H is not computed — verify with your CA.

**Offers.** Schemes gain `kind`: absent / `same` (unchanged buy X get Y of the same item), `buy_get` (buy A get B:
the ₹0 free line is item B with B's HSN / unit / GST rate from the catalogue — `syncSchemeLines` takes the catalogue as
an optional fifth argument, passed by the editor and the POS) and `bill_value` (slabs `{min_value, percent | amount}`,
best slab reached wins). The bill value is the items after line discounts, before the invoice discount, **after the
price level / slab / price list rate was chosen** (schemes run on the priced lines). The offer joins the invoice's
AMOUNT discount (like loyalty) and is stored as `offer`; the editor applies it automatically with a clear line and a
*Not on this bill* switch; the POS applies it after the loyalty redemption and shows its own totals line; the raw
receipt prints it. A % invoice discount blocks the offer. GST is on the value after the discount (Sec 15(3)(a)); free
goods follow Circular 92/11/2019-GST — **verify the treatment with your CA** (especially buy A get B where B has a
higher GST rate than A).

**ESC/POS.** POS header → *Printer* (per device, default **browser** print unchanged): *raw text receipt* (32 columns
for 58 mm, 48 for 80 mm, monospaced, script-free print window) or *ESC/POS over Web Serial* (feature-detected; the
user picks the port in the browser's chooser; `ESC @`, text, feed, partial cut; with "open the cash drawer" a cash bill
adds `ESC p 0 25 250`). No network. In browser mode a drawer opens only through the printer driver's "open drawer on
print" setting. A failed raw / serial print falls back to the browser print.

**Pharma pack.** Pharma tile → switch on. Drug licence number(s) on the business profile (Settings), printed under the
GSTIN (standard / GST / receipt layouts and the raw receipt). Schedule **H / H1 / X** per stock item (tile list).
Editor: patient, address, prescriber, registration no. (`rx`), with a warning when H1 / X items lack them. **Schedule
H1 register** (H1, optionally X) per period: date, bill no., patient, prescriber, drug, batch, quantity, rows without
prescription flagged; CSV. Near-expiry / expired batches in stock. Sale gate (`pharmaGate`, one call in
`liveDocTrackingIssues`, so editor, POS and recurring runs): *block expired batches* (no "Sell anyway"), near-expiry
warning within N days (default 90), optionally blocking. Verify the register format with the drug inspector / your CA.

**Pharma operations (8F, `docs/features/distribution.md`).** Inventory → *Breakage / expiry*: Breakage / Expiry Issue
(near-expiry / expired batches traced to the supplier who sold each batch, debit notes per supplier bill + one claim
per supplier in one all-or-nothing pass), claim tracking (pending / credit received with the supplier's credit note /
rejected), Breakage / Expiry Receive into a non-saleable *Expiry* godown with optional replacement, destruction with an
ITC-reversal reminder (Sec 17(5)(h), verify with your CA). Salt / composition on stock items with substitute search in
the editor item picker and the POS; optional *block sale above batch MRP* (`block_above_mrp`). Agent on POS bills (8F).

## Not built / gaps

- Commission: TDS 194H deduction, agent ledger with its own balance screen, commission on credit notes in receipt
  basis (agent on POS bills: 8F).
- Offers: per-customer / per-category offers, combo prices, offers in recurring runs, conversions and importers.
- ESC/POS: no QR / logo raster, no character code pages beyond ASCII (₹ prints as "Rs."), no network printers.
- Pharma: Schedule X separate register book format, narcotics (NDPS) records, prescription scan attachment link
  (batch-wise MRP check: 8F).
- Receivables statements read invoices / payments only, so a refund voucher does not appear there: a refunded walk-in
  return shows as a credit on the Walk-in customer statement (the ledger / TB / Books are right).
- ~~The refund voucher has no bank-account tag (multi-account BRS sees it under the main bank).~~ Done in R6-C2: each
  non-cash tender carries `bank_account_id` (the original receipt's account) and credits that bank's own ledger.
- ~~Branch-wise closing stock is not apportioned~~ — 7S: per-godown valuation (`docs/features/reports-engine.md`).
- ~~The Sec 25(4) pair is raised by hand from the transfer list~~ — 7S: saving a transfer between godowns of two branches
  with different GSTINs opens the "Tax invoice + bill" dialog at once (the list button stays for later); the e-invoice /
  e-way JSON for it is the normal one.
- Alt+C on the bill line godown select creates a godown (7S).
