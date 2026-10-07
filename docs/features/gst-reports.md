# GST reports (GSTR-1 / GSTR-3B)

Offline working papers for GST filing, built from `invoices` (and, defensively, `purchases`). Nothing is filed or sent anywhere. **Verify with your CA before filing.**

- Route: `/gst-reports`
- Nav label: `GST reports`, icon `FileSpreadsheet` (alt `Landmark`) from lucide-react
- Tables read (read-only): `invoices`, `purchases` (may be empty or absent). Tables written: none.
- Persisted fields added: none.

## Files

| File | Purpose |
| --- | --- |
| `src/lib/gst-reports.ts` | Pure logic: periods, GSTR-1 sections, GSTR-3B, set-off, purchase normaliser, reconciliation issues |
| `src/lib/gstr-json.ts` | GSTN offline-tool style JSON, CSV per section, GSTR-3B CSV, printable HTML summary |
| `src/pages/GstReports.tsx` (+ `.module.css`) | Page (default and named export `GstReports`) |
| `src/components/gst-reports/` | `DataTable`, `ReconBanner`, `PeriodPicker`, `Gstr3bView`, `gst-reports.module.css` |
| `tests/gst-reports.test.ts` | 43-case suite with hand-computed fixtures |

## Exported symbols

`gst-reports.ts`: `buildGstReport(invoices, rawPurchases, {period, gstin?, filerStateCode?}) -> {gstr1, gstr3b, issues}`, `buildGstr1`, `buildGstr3b`, `computeSetOff`, `normalizePurchase`, `periodRange`, `periodFp`, `periodLabel`, `periodForDate`, `inPeriod`, `toGstnDate`, `toUqc`, `B2CL_THRESHOLD`, and the report types.

`gstr-json.ts`: `buildGstr1Json`, `sectionCsv(report, id)`, `gstr3bCsv`, `gstr3bRows`, `toCsv`, `csvCell`, `buildSummaryHtml`, `nilLabel`, `SECTION_LABELS`, `itemNum`.

The page takes no props.

## Wiring the lead must add

`src/App.tsx`:

```tsx
import { GstReports } from './pages/GstReports';
// inside <Routes>
<Route path="/gst-reports" element={<DashboardLayout onLogout={() => setAuthed(false)}><GstReports /></DashboardLayout>} />
```

Sidebar / nav item (in the layout's nav array):

```tsx
import { FileSpreadsheet } from 'lucide-react';
{ to: '/gst-reports', label: 'GST reports', icon: FileSpreadsheet }
```

Cross-links (optional): from Dashboard / Transactions add `<Link to="/gst-reports">GST reports</Link>`. The page itself links out to `/invoice/:id`, `/clients`, `/settings`, `/transactions` and `/purchases` (the purchases route is assumed; adjust `link` in `gst-reports.ts` -> `ITC_NO_GSTIN` / `NO_PURCHASES` if the purchases module uses another path).

## What counts

- Period: month, quarter (Q1 = Apr-Jun) or Indian FY, matched on `issue_date`. JSON `fp` is MMYYYY of the last month covered.
- Included: `INVOICE`, `TAX_INVOICE`, `CREDIT_NOTE` with status not `Draft` / `Cancelled`. Quotations, proformas and challans are never reported. Cancelled and draft numbers are counted as cancelled in the document-issued summary; gaps in a series are also counted as cancelled.
- Filer GSTIN: if chosen, invoices whose sender snapshot has a different GSTIN are skipped (invoices with no snapshot GSTIN are kept).
- Section routing: export (place of supply 96, or non-INR currency with no state) -> EXP / CDNUR; valid-GSTIN client -> B2B / CDNR; unregistered inter-state above Rs 2,50,000 -> B2CL / CDNUR; the rest -> B2CS (credit notes net negative). Zero-rated lines go to the nil table, not B2B/B2CS. Without a sender GSTIN, nil lines are reported as non-GST.
- Tax split is recomputed per line via `calculateInvoice`; legacy `SINGLE` mode is split by comparing the sender and place-of-supply state codes.
- 3B: 3.1(a) taxable (net of credit notes), 3.1(b) exports, 3.1(c) nil/exempt values, 3.1(d) from purchases with `reverse_charge`, 3.1(e) non-GST, 3.2 inter-state unregistered by POS, 4 ITC, 5 exempt inward, 6.1 set-off (IGST credit -> IGST, CGST, SGST; CGST credit -> CGST, IGST; SGST credit -> SGST, IGST; reverse-charge tax cash only).
- Outward invoices flagged `reverse_charge` are listed in B2B with `rchrg: "Y"` but excluded from 3.1 (the recipient pays).

## Purchase shape expected (defensive)

Read by `normalizePurchase`; unknown fields are ignored. Date: `bill_date | purchase_date | date | issue_date | invoice_date`. Supplier GSTIN: `supplier_gstin | vendor_gstin | supplier.gstin | vendor.gstin`. Tax: `igst_amount / cgst_amount / sgst_amount`, else `tax_amount` (or `taxable_value x tax_rate`) split by supplier-vs-filer state. Taxable: `taxable_value | taxable_amount | subtotal`, else `total - tax`. Flags: `itc_eligible === false` marks ineligible (default eligible), `reverse_charge` / `rcm` true, `itc_reversed` (amount, spread pro rata). `status` draft/cancelled rows are skipped. If the purchases module uses different names, adapt `normalizePurchase` only.

## Reconciliation banner

Errors: invalid client GSTIN, place of supply missing, ITC claimed with invalid supplier GSTIN. Warnings: unregistered inter-state sale above Rs 2.5 lakh (B2CL review), missing HSN/SAC, tax without a sender GSTIN, CGST/SGST vs IGST contradicting the state codes, stored total differing from recomputed, foreign-currency amounts, missing document number, ITC claimed without supplier GSTIN. Info: drafts/cancelled excluded, series gaps, no purchases.

## Limits (also shown on the page)

No cess, composition, ISD, imports, e-commerce/TCS, amendments (B2BA etc.), advances (Table 11), interest or late fee. JSON `gt`/`cur_gt` (aggregate turnover) are written as 0 and must be filled in the offline tool; the layout is not schema-validated against the live portal. Foreign-currency invoices are reported as-is, not converted to INR. Credit notes are assumed to be stored as positive amounts and are not linked to original invoices (small unregistered ones are netted in B2CS).
