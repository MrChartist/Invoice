# GSTR-9 annual working paper (roadmap 5.2)

An offline working paper for the GSTR-9 annual return, built from the app's own monthly GSTR-1 / GSTR-3B papers and the purchase bills. Nothing is filed or sent anywhere. **Verify with your CA before filing.**

- Surface: **GST reports → GSTR-9** button (header). Opens a lazy-loaded modal (`src/components/gst-reports/Gstr9Modal.tsx`), so the GST page itself does not grow.
- Tables read (read-only): `invoices`, `purchases`, `doc_links`, plus the books tables through `books.gstSummary` for the comparison. Nothing is written.
- Persisted fields added: none. The turnover comes from the GST page's stored figures (`mrchartist_inv_gstr1_turnover`: "last FY" `gt` and "this FY so far" `curGt`); Table 8A is typed in the modal and not stored.

## Files

| File | Purpose |
| --- | --- |
| `src/lib/gstr9.ts` | Pure builder `buildGstr9(invoices, purchases, opts)`, exports `gstr9WorkingPaper`, `gstr9Csv`, `buildGstr9Html`, `GSTR9_OPTIONAL_LIMIT`, `GSTR9_DISCLAIMER` |
| `src/components/gst-reports/Gstr9Modal.tsx` (+ `gstr9.module.css`) | Modal: FY picker, turnover, manual 8A, differences, Tables 4-9, downloads |
| `tests/gstr9.test.ts` | Seeded FY 2025-26, one document per head; totals vs the 12 monthly builds; CSV / HTML safety |

## How it is built

`buildGstr9` runs `buildGstReport` (the existing GSTR-1 + GSTR-3B builder) for each of the 12 months of the FY and adds them up; it then reads the purchase bills once more for the splits GSTR-9 needs that GSTR-3B does not carry. `opts`: `fyStart`, `gstin`, `filerStateCode`, `links`, `turnover` (FY aggregate turnover), `lastFyTurnover` (HSN digit rule), `books` (a `GstSummary`), `itc2b` (8A).

| Form row | Source |
| --- | --- |
| 4A B2C | B2CL + B2CS + CDNUR notes of type B2CL (net, as the form asks) |
| 4B B2B | B2B rows, regular (not SEZ / deemed), not reverse charge |
| 4C / 5A | EXP with payment (WPAY) / without (WOPAY) |
| 4D / 5B | B2B rows with `inv_typ` SEWP / SEWOP |
| 4E | B2B rows with `inv_typ` DE |
| 4F | Advances: not modelled, 0 |
| 4G | GSTR-3B 3.1(d): purchases under reverse charge and imports of services |
| 4I / 4J | CDNR + CDNUR (EXPWP) credit / debit notes on 4B-4E |
| 4K / 4L, 5J / 5K, Pt V (10-14) | Amendments: not modelled, 0 with a note |
| 5C | Outward invoices flagged reverse charge (value only) |
| 5D / 5E / 5F | GSTR-1 Table 8: exempt (always 0, the app has no exempt flag) / nil / non-GST |
| 5H / 5I | Notes on SEWOP / EXPWOP / reverse-charge supplies |
| 5N | 4N + 5M − 4G (total turnover) |
| 6A | Sum of the monthly 3B 4A (all four heads) |
| 6B | Bills in 3B 4A(5), split inputs / capital goods / input services: by line SAC (99xxxx = services, by value share), else by expense category (Rent, Professional fees, Software, Travel, Utilities, Marketing, Bank charges), else inputs. Capital goods only for a bill carrying `capital_goods: true` (the bill form has no such flag yet) |
| 6C / 6D | Reverse-charge bills: supplier without / with a valid GSTIN |
| 6E / 6F | Imports of goods (Bill of Entry IGST) / services |
| 6G, 6H, 6K-6M | ISD, reclaims, TRAN credit: 0 |
| 6J | 6I − 6A (0 when every bill is in the monthly 3B) |
| 7A / 7C / 7D / 7E / 7H | Reversals by reason: Rule 37 / Rule 42 / Rule 43 / Sec 17(5) (blocked credit in full, plus partial 17(5) reversals) / other (incl. Rule 38). 7I equals the monthly 3B 4B(1) + 4B(2) |
| 8A | **Manual** (annual GSTR-2B ITC; the 2B matcher, 5.1, works per period and does not store the 2B file) |
| 8B / 8D | 6B + 6H / 8A − (8B + 8C); 8C, 8E: 0 |
| 8F | Bills marked ITC not eligible (other than 17(5)) = 3B 4D(2) |
| 8G / 8H / 8I | IGST on every import of goods / 6E / difference |
| 9 | Payable = monthly 3B liability + reverse-charge liability. Paid through ITC / cash is re-run month by month with the Sec 49 set-off order (`computeSetOff`), carrying unused credit into the next month, so cash can be lower than the sum of stand-alone monthly papers. Cess in cash. Interest / late fee / penalty: 0 |
| 17 | Sum of the monthly GSTR-1 Table 12 rows (HSN + UQC + rate) |
| 18 | Bill lines with an HSN: value = qty × rate (after line discount); the bill's actual GST spread over its lines by value × rate. Bills without HSN-coded lines are counted and left out |

### Differences

`comparison` rows, each with GSTR-1, GSTR-3B, books and the two differences:

- **Total turnover**: 5N vs 3B 3.1(a)+(b)+(c)+(e) + outward reverse-charge value.
- **Outward tax** per head (IGST, CGST, SGST, cess): Table 4N − 4G vs 3B 3.1(a)+(b) vs `books.gstSummary` output tax. The books column is not filtered by GSTIN and treats legacy single-rate tax as IGST.
- **ITC availed**: bills (6I) vs 3B (6A) vs books ITC (total only).

Differences of ₹1 or more are highlighted.

### Turnover and the ₹2 crore rule

GSTR-9 is optional for a registered person whose aggregate turnover in the FY is up to ₹2 crore (Notification 47/2019-CT and the later FY-wise notifications). The modal pre-fills the turnover from the GST page: "This FY so far" for the current FY, "Last FY" for the previous FY, blank otherwise; blank falls back to 5N. The paper says "optional" or "mandatory (and GSTR-9C above ₹5 crore)". The rule is not enforced. The GSTR-9 due date and late fee are on the Compliance tab (`compliance.md`).

## Exports

- **Working paper JSON** (`gstr9WorkingPaper`): readable keys by part / table / row (`pt_ii.table4["4B"].txval`, `iamt`, …) plus the comparison and notes. It is **not** the portal's GSTR-9 offline-tool schema, and says so in its `kind` field.
- **CSV** (`gstr9Csv`): one file, one block per table (blank line between), Table 9 with its own columns, HSN tables, comparison and notes. Cells go through the shared `csvCell` (formula-injection guard: `=`, `@`, `+`, `-` text is prefixed with `'`). CRLF line ends like the other GST CSVs.
- **Print** (`buildGstr9Html`): standalone HTML with its own print stylesheet, every value escaped, the "verify with your CA" box at the top.

## Limits

Built from the app's monthly papers, not from the returns actually filed. Advances (Table 11), amendments, ISD, TRAN credit, 8C/8E, Pt VI Tables 15-16, interest and late fee are not modelled. A month whose credit notes exceed its sales is not carried to later months in Table 9.
