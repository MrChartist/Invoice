# GSTR-2B / IMS matcher (Roadmap 5.1)

Match the GSTR-2B the user downloads from the GST portal against the purchase bills in the books, keep an IMS
(Invoice Management System) worksheet of Accept / Reject / Pending decisions, and see what GSTR-3B Table 4A(5) would be
if ITC were limited to what 2B supports. Fully offline: the file is read in the browser and never uploaded.
**Working paper — verify with your CA before filing.**

- Where: GST reports page → **2B match** tab (`src/pages/GstReports.tsx`, tab id `gstr2b`, `?tab=gstr2b`).
- Component: `src/components/gst-reports/Gstr2bView.tsx` (+ `gstr2b.module.css`), `React.lazy` — the matcher, the
  .xlsx reader and the ZIP code are in their own chunks, never in the app shell.
- Logic: `src/lib/gstr2b.ts` (pure, plus `gstr2bActionsDb`). Tests: `tests/gstr2b.test.ts`.
- Reads: `purchases` (through `normalizePurchase` / `readPurchase`, so drafts and cancelled bills are ignored exactly as
  in the GST report), `vendors` (to link a created bill). Writes: `gstr2b_actions`, and `purchases` when the user
  clicks **Create bill** (through `purchasesDb.save`, so the period lock applies).
- The loaded 2B itself is kept in memory only (reload the file after navigating away); decisions persist.

## Input formats

**JSON** (Returns → GSTR-2B → Download → JSON). Field names assumed (all read tolerantly):

| section | fields |
|---|---|
| wrapper | `{ data: { gstin, rtnprd (MMYYYY), gendt, docdata } }`, or `{ docdata }`, or the sections directly |
| `b2b[]` | `ctin`, `trdnm`, `supprd`, `inv[]`: `inum`, `dt` (or `idt`), `val`, `typ`, `pos`, `rev`, `itcavl`, `rsn`, `items[]` (or `itms[]` / `itm_det`): `rt`, `txval`, `igst`/`iamt`, `cgst`/`camt`, `sgst`/`samt`, `cess`/`csamt`; invoice-level `txval`/`igst`/… when there are no items |
| `b2ba[]` | as `b2b`, plus `oinum`, `oidt` (matched under the revised `inum`) |
| `cdnr[]` | `ctin`, `trdnm`, `nt[]`: `ntnum`, `dt`, `typ` (`C` credit → negative, `D` debit), `val`, `pos`, `rev`, `itcavl`, `rsn`, `items` |
| `cdnra[]` | as `cdnr`, plus `ontnum`, `ontdt` |
| `isd[]` | `ctin`, `trdnm`, `doclist[]`: `doctyp` (`ISD`, `ISDC` = credit), `docnum`, `docdt`, `igst`, `cgst`, `sgst`, `cess`, `itcelg` |
| `impg[]` | `boenum`, `boedt`, `portcode`, `txval`, `igst`, `cess` (no supplier GSTIN) |
| `impgsez[]` | `ctin`, `trdnm`, `boe[]`: as `impg` |

Dates are `dd-mm-yyyy` (also `yyyy-mm-dd`, `dd/mm/yyyy`, `dd-Mon-yyyy`), parsed as local calendar days. Other
sections (e.g. `ecom`) are listed in a warning and ignored. Documents with the same section + GSTIN + normalised number
are summed (one warning).

**Excel** (the portal's GSTR-2B .xlsx), read with the built-in reader (`src/lib/xlsx.ts`). Sheets `B2B`, `B2BA`,
`B2B-CDNR`, `B2B-CDNRA`. The header row is the one containing "GSTIN of supplier"; when the next row holds the
sub-headings (merged "Invoice details" / "Tax Amount" groups) they are used. Columns are found by label
("Invoice number", "Invoice Date", "Invoice Value", "Place of supply", "Supply Attract Reverse Charge",
"Taxable Value", "Integrated / Central / State/UT Tax", "Cess", "ITC Availability", "Reason", "Note number/type/date",
"Original …"). Rows per tax rate are summed per document; rows without a GSTIN-shaped first cell (totals, notes) are
skipped. GSTIN and return period are taken from the title block ("GSTIN", "Financial Year 2026-27", "Tax Period May")
when present, otherwise the period selected on the page is used. ISD / IMPG come from the JSON only.

## Matching

`normBillNo`: upper-case, strip leading zeros of every digit run, then drop spaces and `/ \ - . _ , # :`
(`INV/2024-25/0042` ≡ `inv 2024 25 42`). FY prefixes are not stripped.

1. Exact: supplier GSTIN + normalised number (IMPG: Bill of Entry number against bills with `import_type: 'GOODS'` and
   `boe_number`). If a key has several bills, the one with the closest tax wins; each bill is used once.
2. Fallback: same GSTIN, tax within the tolerance, date within the tolerance, exactly one unused bill → matched with a
   `number` difference.
3. Compare: taxable value and total tax (IGST+CGST+SGST) within **₹1**; if the total agrees but IGST vs CGST/SGST
   differs → `heads` (place-of-supply problem); bill date more than **3 days** from the 2B date → `date`.

| class | meaning |
|---|---|
| `matched` | found and agrees |
| `mismatch` | found, but with any of `taxable`, `tax`, `heads`, `date`, `number` |
| `missing_in_books` | in 2B, no bill (can **Create bill** — one line at the effective rate, figures copied from 2B) |
| `not_in_2b` | a bill dated in the selected period, claiming ITC, tax > 0, with a valid supplier GSTIN (or an import of goods), that no 2B line matched — ITC at risk under Sec 16(2)(aa) |
| `itc_unavailable` | 2B says `itcavl: N` (still linked to its bill when found) |

Not expected in 2B (so never "in books only"): drafts / cancelled, bills without a valid GSTIN, import of services,
bills not claiming ITC, bills dated outside the selected period. Supplier credit notes are not recorded in purchases,
so CDNR lines show as "in 2B only".

## IMS worksheet — table `gstr2b_actions`

`Gstr2bAction { id, period (MMYYYY), section, ctin, inum (normalised), action: 'ACCEPT'|'REJECT'|'PENDING', note?, updated_at }`,
`id = period|section|ctin|inum`. No row = deemed accepted (as on the portal). Additive record table, included in
backups and validated by `validateBackupData` (`RECORD_TABLES`). Export: **Worksheet CSV / .xlsx** (`worksheetRows`:
every 2B line plus the books-only bills, with match status, differences, books bill, tax difference and decision;
credit notes negative).

## 3B effect (Table 4A(5))

`itcEffect` shows, without changing the GSTR-3B report:

- **Books** — 4A(5) as the GSTR-3B tab computes it (domestic, forward-charge, tax > 0, eligible or Sec 17(5) blocked,
  dated in the period; test asserts equality with `buildGstReport`).
- **Books limited to matched & accepted** — the same bills, counted only when matched (or mismatched) to a 2B line that
  is accepted (explicitly or deemed) and has ITC available; per head the lower of books and 2B.
- **ITC at risk** — the difference.
- **Per 2B** — B2B/B2BA/CDNR/CDNRA, forward charge, ITC available, accepted, credit notes subtracted (what 2B itself
  would auto-populate in 4A(5)). ISD (4A(4)), RCM (4A(3)) and imports (4A(1)) are outside the comparison.

## Exported symbols (`src/lib/gstr2b.ts`)

`parseGstr2bJson`, `parseGstr2bWorkbook`, `parse2bDate`, `normBillNo`, `amount`, `bookBills`, `matchGstr2b`,
`itcEffect`, `worksheetRows`, `billFromLine`, `diffText`, `effectiveAction`, `actionId`, `gstr2bActionsDb`
(`all/forPeriod/set/clear`), `MATCH_LABELS`, `IMS_LABELS`, `GSTR2B_ACTIONS_TABLE`, and the types.
