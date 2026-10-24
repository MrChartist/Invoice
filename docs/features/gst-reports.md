# GST reports (GSTR-1 / GSTR-3B)

Offline working papers for GST filing, built from `invoices` (and, defensively, `purchases`). Nothing is filed or sent anywhere. **Verify with your CA before filing.**

- Route: `/gst-reports`
- Nav label: `GST reports`, icon `FileSpreadsheet` (alt `Landmark`) from lucide-react
- Tables read (read-only): `invoices`, `purchases` (may be empty or absent), `doc_links`. Tables written: `compliance` (filed marks, Compliance tab, see `compliance.md`), `gstr2b_actions` (IMS decisions, 2B match tab, see `gstr2b.md`).
- Persisted fields added: settings `gst_filing_frequency?: 'monthly' | 'qrmp'` (Compliance tab; additive, absent = monthly).

## Files

| File | Purpose |
| --- | --- |
| `src/lib/gst-reports.ts` | Pure logic: periods, GSTR-1 sections, GSTR-3B, set-off, purchase normaliser, reconciliation issues |
| `src/lib/gstr-json.ts` | GSTN offline-tool style JSON, CSV per section, GSTR-3B CSV, printable HTML summary |
| `src/pages/GstReports.tsx` (+ `.module.css`) | Page (default and named export `GstReports`) |
| `src/components/gst-reports/` | `DataTable`, `ReconBanner`, `PeriodPicker`, `Gstr3bView`, `ComplianceView`, `Gstr2bView` (lazy, "2B match" tab — see `gstr2b.md`), `gst-reports.module.css` |
| `tests/gst-reports.test.ts` | Main suite with hand-computed fixtures |
| `tests/hsn-split.test.ts` | HSN Table 12 B2B/B2C split, JSON/CSV layout, 4/6-digit rule |

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
- Section routing: export (place of supply 96, or non-INR currency with no state) -> EXP / CDNUR; valid-GSTIN client -> B2B / CDNR; unregistered inter-state above the B2CL threshold (`b2clThreshold(date)` in `tax-rules.ts`: Rs 1,00,000 from 1 Aug 2024, Rs 2,50,000 before) -> B2CL / CDNUR; the rest -> B2CS (credit notes net negative). Zero-rated supplies (export, SEZ, LUT) are reported in their section at the line's nominal rate with zero tax; only nil/exempt/non-GST lines (rate 0, no tax, no cess) go to the nil table (Table 8). Without a sender GSTIN, nil lines are reported as non-GST.
- Tax split is recomputed per line via `calculateInvoice`; legacy `SINGLE` mode is split by comparing the sender and place-of-supply state codes.
- 3B: 3.1(a) taxable (net of credit notes), 3.1(b) exports, 3.1(c) nil/exempt values, 3.1(d) from purchases with `reverse_charge`, 3.1(e) non-GST, 3.2 inter-state unregistered by POS, 4 ITC (4A(1) import of goods, 4A(2) import of services, 4A(3) reverse charge, 4A(5) other; 4B(1) Rules 42/43 + Sec 17(5), 4B(2) Rule 37 / other; 4D(2) ineligible without a 17(5) reason), 5 exempt inward, 6.1 set-off (IGST credit -> IGST, CGST, SGST; CGST credit -> CGST, IGST; SGST credit -> SGST, IGST; reverse-charge tax cash only).
- Outward invoices flagged `reverse_charge` are listed in B2B with `rchrg: "Y"` but excluded from 3.1 (the recipient pays).

## Purchase shape expected (defensive)

Read by `normalizePurchase`; unknown fields are ignored. Date: `bill_date | purchase_date | date | issue_date | invoice_date`. Supplier GSTIN: `supplier_gstin | vendor_gstin | supplier.gstin | vendor.gstin`. Tax: `igst_amount / cgst_amount / sgst_amount`, else `tax_amount` (or `taxable_value x tax_rate`) split by supplier-vs-filer state. Taxable: `taxable_value | taxable_amount | subtotal`, else `total - tax`. Flags: `itc_eligible === false` marks ineligible (default eligible), `reverse_charge` / `rcm` true, `itc_reversed` (amount, spread pro rata) with `itc_reversal_reason`, `import_type` `GOODS` (customs IGST: 4A(1), not in 3.1) / `SERVICES` (always reverse charge: 3.1(d) + 4A(2)). `itc_eligible: false` + reason `SEC_17_5` is blocked credit: shown in 4A and reversed in full in 4B(1). `status` draft/cancelled rows are skipped. If the purchases module uses different names, adapt `normalizePurchase` only.

## HSN summary (Table 12): B2B / B2C split and digit rule

- `Gstr1Report.hsn` is the combined table; `hsnB2b` holds lines of documents to registered recipients (B2B, SEZ, and their CDNR notes), `hsnB2c` everything else (B2CL, B2CS, exports, CDNUR). Notes are netted with their sign (credit −, debit +) in the table of their own recipient.
- `hsnSplit` is true from the January 2025 return period (`hsnTableSplit(periodStart)` in `tax-rules.ts`, GSTN HSN Phase-III advisory). The page then shows two tables, the HSN CSV gets a leading `Table` column (`B2B` / `B2C`), and the JSON writes `hsn.hsn_b2b` / `hsn.hsn_b2c` (each numbered from 1).
- **JSON assumption.** The keys `hsn_b2b` / `hsn_b2c` are believed to match the current offline tool but are not verified against the live schema. They are set in one place, `HSN_JSON_LAYOUT` in `gstr-json.ts`; with `legacy: true` (default) the combined `hsn.data` array is also kept so older readers still work. Flip `legacy` to false once the tool is confirmed to reject or double-count it. Periods before Jan 2025 always get `hsn.data` only. The JSON `version` (`GST3.0.4`) is unchanged, because the exact current version string is not known.
- Digit rule: `hsnMinDigits(turnover, date)` in `tax-rules.ts`. From 1 Apr 2021 (Notification 78/2020-CT), up to ₹5 crore preceding-FY aggregate turnover needs at least 4 digits, above that 6. The same minimum applies to B2B and B2C rows (Phase-III). Before that: none up to ₹1.5 crore, 2 up to ₹5 crore, 4 above (Notification 12/2017-CT). The turnover is the "Last FY turnover" (`gt`) entered on the page (`BuildOptions.turnover`); left blank, it is treated as up to ₹5 crore. Lines with fewer digits raise one `HSN_DIGITS` warning per document (only when the sender has a GSTIN).

## Reconciliation banner

Errors: invalid client GSTIN, place of supply missing, foreign-currency document without an exchange rate (`FX_RATE_MISSING`), ITC claimed with invalid supplier GSTIN. Warnings: unregistered inter-state sale above the B2CL threshold (B2CL review), missing HSN/SAC, HSN/SAC shorter than the 4/6-digit rule, tax without a sender GSTIN, CGST/SGST vs IGST contradicting the state codes, stored total differing from recomputed, missing document number, ITC claimed without supplier GSTIN. Info: drafts/cancelled excluded, series gaps, no purchases.

## Limits (also shown on the page)

Cess is reported per rate row and in 3B (paid in cash). No composition, ISD, cess on purchases, e-commerce/TCS, amendments (B2BA etc.) or advances (Table 11). Interest and late fee are estimates on the Compliance tab (`compliance.md`), never part of the JSON. JSON `gt`/`cur_gt` (aggregate turnover) come from the turnover you enter on the GST page (0 if blank); the layout is not schema-validated against the live portal. Foreign-currency invoices are converted to INR at their `exchange_rate` (reported at face value and flagged when it is missing); EXP rows carry `sbpcode`/`sbnum`/`sbdt` from the invoice. Taxable freight is one more rate row under the principal HSN (see `freight-fx.md`). Credit and debit notes linked to an invoice are classified by that invoice (see `documents.md`); unlinked small unregistered notes are netted in B2CS.
