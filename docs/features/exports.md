# Export center (tally-export)

Hand data to accountants: Tally Prime import XML, accounting-package CSVs, and a
send-to-accountant bundle. Read-only on app data; the only thing it writes is
its own preferences row.

- **Route:** `/exports`
- **Nav label / icon:** "Exports" — lucide `FileDown` (alternatives: `Download`, `FileSpreadsheet`)
- **Page:** `src/pages/Exports.tsx` (named export `Exports`, also default)
- **Component:** `src/components/exports/ExportCenter.tsx` — `ExportCenter({ companyName?: string })`
  (self-loading; no other props needed). Helpers: `download.ts` (`downloadFile`, `downloadSequentially`).

## Tables

| Table | Use |
|---|---|
| `invoices`, `transactions` (payments), `clients`, `items_catalog` | read |
| `purchases`, `vendors` | read, **defensively** (any shape; see below) |
| `export_prefs` | read/write — one row of UI preferences (period, ledger names, toggles) |

`src/types/purchases.ts` did not exist in this branch, so purchases are normalised by
`normalizePurchase()` in `export-shared.ts`. It accepts: number (`bill_number`,
`purchase_number`, `vendor_invoice_number`, `invoice_number`, `number`), date (`bill_date`,
`purchase_date`, `date`, `issue_date`), party (`vendor_name`/`supplier_name`, nested `vendor`/`supplier`,
or lookup in `vendors` via `vendor_id`), amounts (`taxable_value`/`subtotal`, `cgst_amount`/`cgst`,
`sgst_amount`, `igst_amount`, `tax_amount`, `total`/`grand_total`). Rows without date, party or total are skipped.
If the purchases module uses other names, add them to the `pick([...])` lists there.

## Lib exports

`src/lib/export-shared.ts` — date/FY helpers (`isoDate`, `fyRange`, `fyLabel`, `fyStartYearOf`, `inRange`),
money (`toPaise`, `fixed2`), `ExportSource`, `voucherKindOf`, `invoiceAmounts`, `filterInvoices/Payments/Purchases`, `normalizePurchase`.

`src/lib/tally-xml.ts` — `generateTallyExport(source, options)` -> `{ build, counts, mastersXml, vouchersXml, combinedXml }`;
`buildTallyModel`, `buildTallyMastersXml`, `buildTallyVouchersXml`, `buildTallyCombinedXml`,
`voucherImbalance`, `escapeXml`, `stripIllegalXmlChars`, `tallyDate`, `tallyAmount`, `TallyOptions`, `DEFAULT_LEDGER_NAMES`.

`src/lib/accounting-export.ts` (re-exports export-shared) — `DATASETS`, `buildDataset(id, source, opts)`,
`buildAllDatasets`, `toCsv(table, {bom})`, `csvCell`, `safeText`, `money`, `buildAccountantBundle(source, opts)`, `UTF8_BOM`.

### Tally conventions

- Debit = `ISDEEMEDPOSITIVE` Yes + negative `AMOUNT`; credit = No + positive. Every voucher sums to 0.
- Sales: Dr party (bill ref "New Ref"), Cr Sales, Cr Output CGST/SGST/IGST (legacy single-tax -> "Output GST"), Cr Freight and Other Charges, +/- Round Off.
- Credit Note: mirror image. Receipt: Dr Bank Account (or Cash if method is "Cash"), Cr party with "Agst Ref" to the invoice number; voucher number `<invoice>/R<n>`.
- Purchase: Cr vendor, Dr Purchases, Dr Input CGST/SGST/IGST, +/- Round Off.
- Any gap between an invoice's stored total and its parts (rounding, legacy rows) is posted to the Round Off ledger so Tally never rejects an unbalanced voucher.
- Two files: **Masters** (`All Masters`: ledgers, units, stock items) then **Vouchers** (`Vouchers`); a Combined single file is also offered.
- Drafts (unless opted in), cancelled, quotations, proforma and delivery challans are excluded. Output is sorted and deterministic.
- Re-importing the same period creates duplicates in Tally; the UI says so.

### CSV datasets (headers are the contract)

`sales_register`, `sales_items` (Zoho Books-style headers: Invoice Date, Invoice Number, Customer Name, Item Name, Item Desc,
Quantity, Item Price, Discount(%), Item Tax %, Place of Supply, GST Treatment, GSTIN ...), `purchase_register`, `receipts`,
`parties`, `items`, `gst_summary` (Sales / Credit Notes / Purchases / Net Sales per GST rate). Credit notes are negative.
CRLF line endings, RFC-4180 quoting, optional UTF-8 BOM, formula-injection guard on text cells.
Column mapping is by header name in each package's import wizard; not guaranteed byte-identical to any vendor template.

## Wiring the lead must add

`src/App.tsx` (lazy route like the other pages):

```tsx
import { Exports } from './pages/Exports';
// inside <Routes> under the shell layout:
<Route path="/exports" element={<Exports />} />
```

Nav (`src/layouts/*` nav items array):

```tsx
import { FileDown } from 'lucide-react';
{ to: '/exports', label: 'Exports', icon: FileDown }
```

Optional cross-links: a "Export for accountant" button in Transactions/Dashboard headers: `<Link to="/exports">`.

Backups: add `export_prefs` to the backup/restore table list if you want preferences restored (not required).

## Tests

`tests/tally-xml.test.ts`, `tests/accounting-export.test.ts`, fixtures in `tests/export-fixtures.ts`
(hand-computed: 1000 + 9% + 9% = 1180; IGST 999.50 -> 179.91, round off -0.41, total 1179; credit note; receipts; purchase 2000 + 180 + 180 = 2360).
