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

**Integration point for WP-2 (reports engine, `src/lib/ledger/reports.ts` — not edited here):** add an option
`{ branchId?: string }` to the report builders and filter source rows before postings:

```ts
import { branchPredicates } from '../branch';
const p = branchPredicates(opts.branchId);
const data = { ...src, invoices: src.invoices.filter(p.invoice), purchases: src.purchases.filter(p.purchase), vouchers: src.vouchers.filter(p.voucher) };
```

Receipts / payments follow their document. Inter-branch stock transfer as a tax invoice (Sec 25(4)) is **not** built.

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
- Redemption (POS customer card; `LoyaltyRedeem` can be mounted in the editor the same way): `applyRedemption` adds the
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

## Wiring for the lead (shared files not edited)

- Editor / preview: mount `ApprovalBanner` (from `components/approvals/ApprovalsPanel`) with `invoice.approval`, and
  optionally `LoyaltyRedeem` next to the discount field (apply with `redeemOnBill` from `src/lib/loyalty.ts`).
- Transactions list: show "Pending approval" for `approval.state === 'pending'` and add a branch filter using
  `matchesBranch(branchOfInvoice(inv, branches), filter)`; purchase list likewise with `branchOfPurchase`.
- Editor / bill / voucher forms: a branch select writing `branch_id` (optional — inference covers multi-profile users).
- Notification bell: pending approvals (owner) and `amcReminders`.
- Command palette: "Return / exchange" → `/pos` with the dialog open.

## Not built / gaps

- Sales commission per agent, bill-value and "buy A get B" offers, ESC/POS cash drawer (Web Serial), pharma pack.
- Receivables statements read invoices / payments only, so a refund voucher does not appear there: a refunded walk-in
  return shows as a credit on the Walk-in customer statement (the ledger / TB / Books are right).
- The refund voucher has no bank-account tag (multi-account BRS sees it under the main bank).
- Inter-branch transfers as tax invoices and branch-wise TB / P&L (needs the WP-2 option above).
