# GST reports (GSTR-1 / GSTR-3B)

Offline working papers for GST filing, built from `invoices` (and, defensively, `purchases`). Nothing is filed or sent anywhere. **Verify with your CA before filing.**

- Route: `/gst-reports`
- Nav label: `GST reports`, icon `FileSpreadsheet` (alt `Landmark`) from lucide-react
- Tables read (read-only): `invoices`, `purchases` (may be empty or absent), `doc_links`. Tables written: `compliance` (filed marks, Compliance tab, see `compliance.md`), `gstr2b_actions` (IMS decisions, 2B match tab, see `gstr2b.md`).
- Persisted fields added: settings `gst_filing_frequency?: 'monthly' | 'qrmp'` (Compliance tab; additive, absent = monthly); invoice `eco_gstin?`, `eco_section?`, `challan_purpose?` (additive, in `RECORD_KEYS` / `normalizeRecord`).

## Files

| File | Purpose |
| --- | --- |
| `src/lib/gst-reports.ts` | Pure logic: periods, GSTR-1 sections, GSTR-3B, set-off, purchase normaliser, reconciliation issues |
| `src/lib/gstr-json.ts` | GSTN offline-tool style JSON, CSV per section, GSTR-3B CSV, printable HTML summary |
| `src/pages/GstReports.tsx` (+ `.module.css`) | Page (default and named export `GstReports`) |
| `src/components/gst-reports/` | `DataTable`, `ReconBanner`, `PeriodPicker`, `Gstr3bView`, `ComplianceView`, `Gstr2bView` (lazy, "2B match" tab — see `gstr2b.md`), `gst-reports.module.css` |
| `tests/gst-reports.test.ts` | Main suite with hand-computed fixtures |
| `tests/hsn-split.test.ts` | HSN Table 12 B2B/B2C split, JSON/CSV layout, 4/6-digit rule |
| `src/lib/eco.ts`, `src/components/creator/GstExtrasFields.tsx`, `src/components/gst-reports/EcoView.tsx` | E-commerce operator fields (validation, editor warnings), challan purpose field, "E-commerce 14" tab (lazy) |
| `tests/gst-gaps.test.ts` | ECO (Table 14, 3.1.1, 5C1), EXPA, GSTR-4 Tables 7-9 + interest / late fee, bulk e-Way BIL, Table 13 challans |

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
- Section routing: export (place of supply 96, or non-INR currency with no state) -> EXP / CDNUR; valid-GSTIN client -> B2B / CDNR; unregistered inter-state above the B2CL threshold (`b2clThreshold(date)` in `tax-rules.ts`: Rs 1,00,000 from 1 Aug 2024, Rs 2,50,000 before) -> B2CL / CDNUR; the rest -> B2CS (credit notes net negative). Zero-rated supplies (export, SEZ, LUT) are reported in their section at the line's nominal rate with zero tax — a line priced at a nominal 0% stays in EXP / SEZ (B2B) as a rate-0 row, so GSTR-1, 3B 3.1(b) and GSTR-9 5A agree; only nil/exempt/non-GST lines (rate 0, no tax, no cess) of other documents go to the nil table (Table 8). Without a sender GSTIN, nil lines are reported as non-GST.
- Tax split is recomputed per line via `calculateInvoice`; legacy `SINGLE` mode is split by comparing the sender and place-of-supply state codes.
- 3B: 3.1(a) taxable (net of credit notes), 3.1(b) exports, 3.1(c) nil/exempt values, 3.1(d) from purchases with `reverse_charge`, 3.1(e) non-GST, 3.2 inter-state unregistered by POS, 4 ITC (4A(1) import of goods, 4A(2) import of services, 4A(3) reverse charge, 4A(5) other; 4B(1) Rules 42/43 + Sec 17(5), 4B(2) Rule 37 / other; 4D(2) ineligible without a 17(5) reason), 5 exempt inward (zero-tax bills; bills whose category is not a supply at all are left out — `isNonSupplyCategory` in `purchase-normalize.ts`: salaries / wages / payroll / bonus / gratuity / remuneration (Schedule III), PF / ESI / professional tax / income tax / TDS / GST payments, depreciation; bank interest stays in, it is an exempt supply), 6.1 set-off (`computeSetOff`, Sec 49A / Rule 88A as amended by Notification 16/2019-CT: IGST credit first against IGST; what is left goes first to the CGST / SGST shortfall their own credits cannot cover — CGST before SGST — then to the rest of the CGST / SGST liability, so IGST credit is used up before CGST / SGST credit; CGST credit -> CGST, then IGST, never SGST; SGST credit -> SGST, then IGST, never CGST; reverse-charge tax cash only). The order is date-keyed (`GST_SETOFF_RULES` in `tax-rules.ts`, WP-6): periods before 29 Mar 2019 use the Sec 49A / original Sec 49(5) order. Example: liability CGST 100 + SGST 100, credit IGST 100 + CGST 100 -> zero cash (IGST pays SGST, CGST pays CGST). GSTR-9 Table 9 re-runs the same function month by month.
- **Outward reverse charge** (Sec 9(3)/(4) CGST Act): the recipient pays the GST. Invoices flagged `reverse_charge` are listed in B2B with `rchrg: "Y"` and the tax shown on them (GSTR-1 invoice value = taxable + that tax, for both record generations below), but excluded from 3.1 — their taxable value is `outwardRcmTaxable` (see the open question below). From this version the editor saves such a document with `rcm_tax_excluded: true`: the tax is computed and printed as "Tax payable by the recipient under reverse charge" (Rule 46(p), a note under every template) and is NOT in `total` / `balance_due`. Older reverse-charge records keep their stored total (which includes the tax) — never rewritten; every supplier-side reader (ledger, Books, Tally, accounting exports, receivables / aging, dashboard, payments, reminders, interest, cheques, bank matching, credit limit) goes through `src/lib/rcm.ts` (`receivableTotal`, `receivableBalance`, `supplierView`) and books no output tax. The e-Invoice / e-Way JSON still carry the tax in their value totals (NIC adds the tax heads).
- **Table 13 (documents issued)**: invoices / Bills of Supply (doc 1), debit notes (4), credit notes (5) from the documents, plus receipt vouchers (6, `ADV/…`) and refund vouchers (8, `RFV/…`) from the period's advance movements (every voucher issued, taxed or not; gaps count as cancelled). Delivery challans are listed only when the challan carries a Rule 55 purpose (`InvoiceRecord.challan_purpose`, additive, set in the editor): job work → doc 9, supply on approval → 10, liquid gas → 11, other than by way of supply → 12 (`CHALLAN_DOC_TYPES`). Default (no purpose) and "goods sent ahead of the tax invoice" (`ANTICIPATION`) stay out, as before — the invoice is what is reported. One `DCH/…` series shared by several purposes is split by purpose: a number used by a challan of another purpose (or an unlisted one) is neither counted nor treated as a gap (keeping a series per purpose is cleaner). Doc type names follow the offline tool as best known.
- **E-commerce operators** (`src/lib/eco.ts`): additive `InvoiceRecord.eco_gstin` (operator GSTIN, upper-cased) and `eco_section` (`TCS_52` default / `PAY_9_5`), set in the editor ("Sold through an e-commerce operator"); conversions and credit / debit notes carry them over. The operator GSTIN is validated by `checkEcoGstin` (shape, `Z` or `C` in place 14, checksum): invalid → `ECO_GSTIN_INVALID` (error); a Sec 52 operator without a TCS registration (`C`) → `ECO_NOT_TCS` (info).
  - **Sec 52** (operator collects TCS; the supplier pays the tax): the document stays in B2B / B2CL / B2CS with `etin` (B2CS rows split by operator, `typ` "E"; amendments carry it too) and is totalled per operator, net of notes, in **Table 14(a)** (`gstr1.eco.tcs`). Exports are not put in Table 14.
  - **Sec 9(5)** (operator pays the tax: restaurant service, passenger transport, accommodation, housekeeping …): value only — **Table 14(b)** (`gstr1.eco.pay95`, tax columns 0) and **GSTR-3B 3.1.1(ii)** (`gstr3b.ecoSupplies95`); never B2B / B2CL / B2CS, Table 8, HSN or 3.1. Tax charged on such a document raises `ECO_95_TAXED` and is not reported as the supplier's liability. GSTR-9 row **5C1** (shown only when non-zero) and the turnover comparison include it.
  - Date keys (`ECO_REPORTING_RULES` in `tax-rules.ts`, to verify): 3B 3.1.1 from 5 Jul 2022 (Notification 14/2022-CT), GSTR-1 Table 14 from 26 Dec 2022 (Notification 26/2022-CT), GSTR-9 5C1 from FY 2024-25 (Notification 12/2024-CT). Earlier documents raise `ECO_BEFORE_TABLE14`; Table 14 is still shown for reference.
  - JSON (`ECO_JSON_LAYOUT`, **not verified**): `etin` on `b2b` / `b2cl` invoices and `b2cs` rows; `supeco: { clttx: [...14(a)], paytx: [...14(b)] }` with `etin`, `suppval`, `igst`, `cgst`, `sgst`, `cess`; GSTR-3B JSON `eco_dtls: { eco_sup, eco_reg_sup: { txval } }` only when there are 9(5) supplies. CSV: "E-commerce 14" tab; B2B / B2CL / B2CS CSVs end with an "E-commerce GSTIN" column.
  - Not generated: Table 14A (amendments of Table 14; an amended 9(5) supply is flagged `AMEND_ECO_95`, 3B takes the difference), Table 15 (operator's own supplies), 3.1.1(i).
- CDNR / CDNRA `inv_typ` is the note's own type (`R`, `SEWP`, `SEWOP`, `DE`, from its supply type).

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

Cess is reported per rate row and in 3B; cess on purchase bills (`cess_amount`, WP-6) is cess credit in 4A / 4C and pays output cess only — the rest is cash (`gst-setoff.md`). Composition returns (CMP-08 / GSTR-4), Bills of Supply (Table 8 / 13) and amendments (B2BA / B2CLA / CDNRA / CDNURA / B2CSA, original period unchanged) are described in `composition-amendments.md`. E-commerce operators (Table 14, 3.1.1) are described above; export amendments go to EXPA. No ISD. Set-off posting, PMT-06 challans, purchase HSN register, HSN master, month-wise 1-vs-3B-vs-Books and GSTR-9C are WP-6 tabs (`gst-setoff.md`). Advances (Table 11A/11B, JSON `at`/`txpd`, folded into 3B 3.1(a)) come from the `advances` table — see `advances.md`. Interest and late fee are estimates on the Compliance tab (`compliance.md`), never part of the JSON. JSON `gt`/`cur_gt` (aggregate turnover) come from the turnover you enter on the GST page (0 if blank); the layout is not schema-validated against the live portal. Foreign-currency invoices are converted to INR at their `exchange_rate` (reported at face value and flagged when it is missing); EXP rows carry `sbpcode`/`sbnum`/`sbdt` from the invoice. Taxable freight is one more rate row under the principal HSN (see `freight-fx.md`). Credit and debit notes linked to an invoice are classified by that invoice (see `documents.md`); unlinked small unregistered notes are netted in B2CS.

## Open questions for your CA

These are judgment calls the app makes one way; confirm them before filing.

- **Outward reverse-charge value in GSTR-3B.** The supplier's taxable value of outward supplies on which the
  recipient pays tax is kept out of 3.1(a) and shown as `outwardRcmTaxable`; it is not added to any 3B row. Some
  practitioners report it in 3.1(c) (nil / exempt / non-GST column) so that 3B turnover agrees with GSTR-1; the portal
  form has no dedicated row. GSTR-9 puts it in 5C. Decide where your return shows it.
- **Refunds of advances.** A refund voucher (Rule 51) for an advance that had been taxed is reported in Table 11B with
  the adjustments (reducing the tax). The alternative view is to amend the Table 11A entry of the month the advance was
  received (11A amendment). Confirm which your CA prefers.
- **Cancelling / deleting documents in an already-filed month.** Only amendments are frozen against a filed period
  (`amends.original`). Cancelling or deleting an invoice dated in a month whose GSTR-1 / 3B is already filed silently
  changes that month's working papers here (the portal keeps what was filed). The period lock (Settings → Books lock)
  is the guard: we recommend locking each month as soon as its returns are filed, and correcting filed documents only
  through credit / debit notes or amendments.
- **Composition service providers.** CMP-08 applies the 6% (Notification 2/2019-CT(R)) to taxable supplies only, leaving
  exempt services out of the base (see `composition-amendments.md`).
- **Non-supply expense heads in Table 5.** The list in `isNonSupplyCategory` is a working rule (salaries, statutory dues,
  taxes, depreciation). Bank interest is treated as an exempt inward supply and stays in Table 5.
- **Sec 9(5) supplies outside HSN / Table 8.** A supply on which the e-commerce operator pays tax u/s 9(5) is reported
  only in Table 14(b) and 3B 3.1.1(ii) — not in Table 12 (HSN) or Table 8. Some practitioners also list it in Table 12;
  confirm which your CA wants.
- **Challans in a shared series.** Table 13 rows for challans of different purposes drawn from one `DCH/…` series do not
  count each other's numbers as cancelled. The portal may expect separate series per purpose.
- **3B never goes negative.** A downward amendment or credit note larger than a month's other liability leaves that month
  at zero; the excess is not carried forward here (enter it on the portal), so GSTR-9 Table 9 can then differ from 4N.
