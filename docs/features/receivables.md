# Receivables (party ledger and outstanding reports)

Tally-style sales ledger per party, bill-wise outstanding, aging, collections, DSO, and a printable client statement.
Read-only on `invoices`, `transactions` (payments) and `clients`. It writes nothing.

- **Route:** `/receivables` (optional query: `?tab=aging|statements|collections&party=<client id or "name:<lowercased name>">`)
- **Nav label / icon:** `Receivables` / `Scale` (alternatives: `HandCoins`, `BookOpenCheck`)
- **Tables used:** `invoices`, `transactions`, `clients` (read only). No new tables.

## Wiring the lead must add

`src/App.tsx`:

```tsx
import { Receivables } from './pages/Receivables';
// …
<Route path="/receivables" element={<DashboardLayout onLogout={() => setAuthed(false)}><Receivables /></DashboardLayout>} />
```

`src/layouts/DashboardLayout.tsx` (nav array, e.g. after Transactions):

```tsx
import { Scale } from 'lucide-react';
{ label: 'Receivables', path: '/receivables', icon: Scale },
```

Optional cross-links:

```tsx
// Clients page row action: open that client's statement
<Link to={`/receivables?tab=statements&party=${client.id}`}>Statement</Link>
// Dashboard "Pending" card
<Link to="/receivables">View aging</Link>
```

## Library: `src/lib/receivables.ts` (pure, tested in `tests/receivables.test.ts`)

| Export | Purpose |
| --- | --- |
| `buildReceivables({invoices, payments, clients}, {currency?, now?})` | Returns `ReceivablesReport`: `parties[]` (bills, buckets, gross, creditNotes, advances, net, entries) and `totals`. |
| `buildLedger(party, from?, to?)` | `Ledger` with opening balance (everything before `from`), in-range entries with running balance, totals, closing. |
| `topDebtors(report, n)`, `debtorShare(report, party)` | Ranking of parties with a positive net. |
| `monthlyCollections(report, months, now)`, `overallEfficiency(rows)` | Billed vs credited vs received per month, with efficiency %. |
| `computeDso(report, windowDays = 90, now)` | Net receivables ÷ net sales in the window × days. `null` if there were no sales. |
| `buildStatementText({sender, party, ledger, currency})` | WhatsApp/email plain text (`*bold*` markers, open bills, UPI/bank details). |
| `statementCsv(ledger)`, `agingCsv(report)`, `toCsv`, `csvCell` | CSV with formula-injection guard. |
| `closingInWords`, `compactMoney`, `niceMax`, `dateKey`, `partyKeyOf`, `currenciesIn`, `isLedgerDoc`, `AGING_BUCKETS` | Helpers. |

### Accounting rules
- **Debit** is a live invoice (`INVOICE` / `TAX_INVOICE`). **Credit** is a payment or a `CREDIT_NOTE`.
- Draft, Cancelled, Quotation, Proforma and Delivery Challan are excluded. Payments pointing at an excluded or unknown invoice are ignored.
- Party key is the client `id`, else the case-folded name (so "Beta Co" and "beta co" merge).
- **Legacy rows:** an invoice with `status: 'Paid'` or `amount_paid` greater than its payment rows gets a derived receipt for the difference. It is dated `updated_at` and flagged `derived: true`. This matches how the Transactions page marks invoices paid.
- **Advances:** an overpayment on an invoice, and any payment row with no `invoice_id` but a `client_id` or `client_name`, becomes an advance. These are optional additive fields on the payment row. Other modules may write them, and `ReceiptRow` documents the shape.
- **Net** = open bills − credit notes − advances. It always equals the ledger closing balance over the full history (tested). A negative net means the party is in credit.
- Aging buckets come from `agingBucket()` (`Not due`, `1–30`, `31–60`, `61–90`, `90+ days`) and cover bills only. Credits are shown in their own column, as Tally does.
- Reports are per currency. The page shows a currency picker only when more than one is in use.

## UI

- `src/pages/Receivables.tsx` (+ `.module.css`). Exports `Receivables`. Tabs:
  - **Aging:** stacked bar, top debtors, and a party × bucket table whose rows expand to show bills.
  - **Statements:** party and date range with presets (This FY, Last FY, Last 90 days, All time), ledger table, Copy text, Email (`mailto:`), Print/PDF.
  - **Collections:** SVG billed-vs-received chart and a month table.
- `src/components/receivables/StatementDocument.tsx` is the A4 white paper. It takes `{sender, party, client?, ledger, currency?}` and forwards a ref.
- `src/components/receivables/StatementViewer.tsx` is the full-screen preview with Print, CSV and PDF. It takes `{open, onClose, onError?, ...StatementDocumentProps}`. Printing hides `#root` through a `statement-printing` body class.
- `exportUtils.ts` has `exportNodeToPdf` (dynamic import of `html-to-image` and `jspdf`, sliced into A4 pages), `downloadTextFile` and `safeFilename`.
- `Charts.tsx` has `AgingStack`, `AgeChip`, `ShareBar` and `CollectionsChart`.
- The sender profile comes from `localDb.settings.activeProfile()`, not from a per-invoice snapshot, because a statement spans many invoices.

## Notes
- No network calls, no new dependencies. All colours use theme tokens. The statement paper keeps its own neutral palette, like the invoice paper.
- `docs/ARCHITECTURE.md`, `src/lib/stats.ts` (`isRevenueDoc`) and the `PageHeader`, `StatCard`, `NumberInput` and `types/purchases.ts` files were not present in this worktree. The page uses `surface.module.css` directly, and `isLedgerDoc` mirrors the revenue-doc rule. If `isRevenueDoc` lands, swap it in.
