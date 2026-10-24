# Composition scheme, Bill of Supply and GSTR-1 amendments (roadmap 5.9)

Working papers only — every number here must be checked against the portal / offline tool. **Verify with your CA.**

## Data (all additive, no new table, no migration)
- `SenderProfile.gst_scheme?: 'regular' | 'composition'` (absent = regular) and
  `SenderProfile.composition_category?: 'manufacturer' | 'trader' | 'restaurant' | 'service'`. Both are part of the
  sender snapshot saved on every document (Critical Rule 3): switching a profile later never changes how an issued
  document prints or is reported.
- `DocumentType` gains `BILL_OF_SUPPLY` (label "Bill of Supply", series code `BOS` → `BOS/FY25-26/0001`, Indian FY,
  own series — a profile's custom invoice prefix never applies to it).
- `InvoiceRecord.exempt_kind?: 'NIL' | 'EXEMPT' | 'NON_GST'` — the GSTR-1 Table 8 column of a regular taxpayer's
  Bill of Supply (absent = EXEMPT).
- `InvoiceRecord.amends?: { original_number, original_date, period, amended_on, reason?, original? }` — see Amendments.
  Listed in `RECORD_KEYS`, kept by `normalizeRecord`; conversions, credit / debit notes and late-fee invoices set it to
  `undefined` (never copied). Recurring templates copy named fields only, so they never carry it either.
- Settings `gst_filing_frequency` accepts `'composition'` (CMP-08 / GSTR-4 calendar).

## Rules (date-keyed in `src/lib/tax-rules.ts`)
| rule | values | source |
|---|---|---|
| `COMPOSITION_RATE_RULES` | 1 Jul 2017: manufacturer 2%, trader 1%, restaurant 5%; 1 Jan 2018: manufacturer 1% (trader 1% on taxable supplies only); 1 Apr 2019: service provider 6% | Rule 7; Notification 3/2018-CT; Notification 2/2019-CT(R) |
| `COMPOSITION_LIMIT_RULES` | goods ₹75 lakh → ₹1 crore (13 Oct 2017) → ₹1.5 crore (1 Apr 2019); services ₹50 lakh | Sec 10; Notifications 46/2017-CT, 14/2019-CT (guidance only, not enforced) |
| `COMPOSITION_DUE_RULES` | CMP-08 18th after the quarter; GSTR-4 30 Apr, 30 Jun from FY 2024-25 | Rule 62; Notification 12/2024-CT |

Rates are half CGST, half SGST. The values were written from knowledge of the notifications and are flagged for CA
verification; add new versions, never edit old ones.

## Bill of Supply
- `calcInputFromRecord` forces `gst_mode: 'NONE'` for a `BILL_OF_SUPPLY` (after any `over`), and the editor's live
  calculation uses `effectiveGstMode`, so no path can put tax on one — even an imported row that says `CGST_SGST`.
- Editor: a composition profile opens new documents as a Bill of Supply (`makeDraft`, and `setSender` switches an
  unsaved invoice); choosing Bill of Supply sets `gst_mode` NONE and hides the GST rate / cess columns and the GST
  treatment selector. `SupplyNotice` (editor) shows non-blocking warnings from `compositionWarnings`:
  tax invoice by a composition dealer (Sec 31(3)(c)), inter-state outward supply of goods by a Sec 10(1) dealer
  (Sec 10(2)(c)) or any inter-state supply by a Sec 10(2A) dealer, and taxed lines on a regular taxpayer's Bill of
  Supply. Saving is never blocked. For a regular profile it offers the Table 8 column (exempt / nil / non-GST).
- Templates: `TemplateEngine` renders `SupplyDeclaration` once, after every layout body (all 26 templates, every paper),
  with the exact wording **"Composition taxable person, not eligible to collect tax on supplies"** when the document's
  own sender snapshot is a composition profile (not on quotations / proformas / challans / sales orders). The title
  comes from `DOCUMENT_LABELS` in every layout ("Bill of Supply"; Hindi "आपूर्ति का बिल"). Colours use `--tpl-accent`.
- Conversions: Quotation / Proforma / Sales order / Challan → Bill of Supply; Bill of Supply → Challan. Credit and
  debit notes can be raised against a Bill of Supply (they stay untaxed).
- Revenue everywhere: `isRevenueDoc`, receivables, reminders, interest, books (`isSale`), sales reports, bank
  reconciliation, sales-order fulfilment, inventory (stock out), ledger (Dr debtors / Cr sales, no GST lines), Tally
  (Sales voucher without tax ledgers), accounting CSV ("Bill of Supply").
- e-Invoice: never (`eInvoiceDocType` returns null even with an override; bulk e-Invoice already excludes it). The
  e-Invoice / e-Way modal opens on the e-Way tab for a Bill of Supply; the e-Way JSON uses NIC document type `BIL`.
  Bulk e-Way does not pick Bills of Supply up yet.

## GST reports
- **Regular taxpayer's Bill of Supply** → GSTR-1 Table 8 in the `exempt_kind` column (nil / exempt / non-GST), GSTR-3B
  3.1(c) (3.1(e) for non-GST), and Table 13 "Invoices for outward supply" as its own `BOS/FY…` series (there is no
  separate Table 13 type for bills of supply — verify with your CA). A Bill of Supply with rated lines raises
  `BOS_TAXED_LINES`.
- **Composition documents** (sender snapshot `gst_scheme: 'composition'`) are left out of GSTR-1 / 3B entirely
  (`counts.composition`, issue `COMPOSITION_DOCS`). When the selected GSTIN's profile (or the active profile) is a
  composition profile, the GST page shows a banner explaining GSTR-1 / 3B do not apply and opens the
  **Composition (CMP-08 / GSTR-4)** tab (`CompositionView`, lazy).
- **CMP-08** (`buildCmp08`, `src/lib/composition-returns.ts`): Table 3(1) outward value incl. exempt = every live Bill
  of Supply / invoice / debit note less credit notes of composition profiles in the quarter (taxable value + untaxed
  freight, INR); tax = base × rate on the document date, per category of the snapshot. A trader (from 1 Jan 2018) pays
  only on taxable supplies: lines whose catalogue GST rate is 0 are treated as exempt. 3(2) reverse charge = purchases
  flagged reverse charge + imports of services (tax as on the bill). 3(3) = 1 + 2. GST on ordinary purchase bills is
  reported as **not claimable** (`ITC_NOT_CLAIMABLE`), never credited. A tax invoice with GST from a composition profile
  raises `TAX_COLLECTED`. Interest / late fee not computed.
- **GSTR-4** (`buildGstr4`): Table 4A registered forward charge, 4B registered reverse charge, 4C unregistered,
  4D import of services; Table 5 the four CMP-08s; Table 6 outward by rate; totals. Goods imports are noted, not
  tabled. TDS/TCS credit (Table 7+) not computed. CSV download for both.
- **Compliance calendar**: frequency "Composition" → CMP-08 per quarter, GSTR-4 per FY (defaults to it when the active
  profile is composition). Late-fee / interest estimates are not modelled for these forms.
- **Purchases**: data model untouched. With a composition active profile the Expenses stat card reads
  "GST on bills (no ITC)" and the bill form explains that ITC is not available.

## Amendments (B2BA / B2CLA / CDNRA / CDNURA / B2CSA)
Model — **an amendment is an edit of the same record, marked as such**:
1. "Amend (reported in a filed return)" on a saved, issued tax invoice / credit / debit note of a regular profile
   (`DocumentActions` → `AmendDialog` → `startAmendment` in `documents.ts`) stores `amends` with a frozen copy of the
   document as it was (`original`, sender trimmed to its GST identity), the return period it was reported in, and
   today as `amended_on`. The user then edits and saves as usual.
2. `buildGstr1` reports every document **as filed** (`asFiled`): an amended record appears in its own period with the
   frozen original, so a filed GSTR-1 never changes.
3. In the period containing `amended_on`, the edited record is reported in the amendment tables with the original
   number / date (`gstr1.amendments`): registered → B2BA (invoice) / CDNRA (note); unregistered inter-state above the
   B2CL threshold → B2CLA / CDNURA; other B2C → **B2CSA** rows = the original month's B2CS rows recomputed with every
   amendment made up to the end of this period (a supply that left B2CS revises its old row down to zero). Exports are
   flagged (`AMEND_EXPORT`), not generated. A draft / cancelled revision is not reported (`AMEND_NOT_LIVE`); a section
   change is flagged (`AMEND_SECTION_CHANGED`).
4. GSTR-3B of the amendment period takes the difference (revised version + original with the sign flipped).
5. Payments, credit-note links, receivables, books and the ledger keep pointing at the one record, so nothing is
   double counted; books show the corrected document on its date.

When is an edit an amendment? `amendmentCheck`: the document's GSTR-1 / IFF period (month or QRMP quarter) is marked
filed in the Compliance tab, or — as a proxy — its date is inside the locked period. The period lock still applies: a
locked document must be unlocked with the PIN first (every change is in the audit log). The dialog says when no
amendment is needed.

JSON keys (`AMEND_JSON_LAYOUT` in `gstr-json.ts`, **not verified against the current offline tool**): `b2ba` (`ctin`,
`inv[]` with `oinum`, `oidt`, `inum`, `idt`, `val`, `pos`, `rchrg`, `inv_typ`, `itms`), `b2cla` (`pos`, `inv[]` with
`oinum`/`oidt`), `cdnra` (`ctin`, `nt[]` with `ont_num`, `ont_dt`, `ntty`, `nt_num`, `nt_dt`, …), `cdnura`
(`ont_num`/`ont_dt`, `typ`), `b2csa` (`omon`, `sply_ty`, `pos`, `typ`, `itms[]`). The revised `idt` is the document
date (amending the number/date itself is possible by editing them). CSV: GST page → Amendments tab.

## Not covered (gaps)
- **E-commerce Sec 52 (TCS by operators) / Sec 9(5) (operator pays tax)** — not built; GSTR-1 Table 14/15 and the
  composition bar on supplies through an e-commerce operator (Sec 10(2)(d)) are not modelled.
- Export amendments (EXPA), amendments of Table 8 / HSN / documents issued, GSTR-9 Part V (amendments) and GSTR-4
  Tables 7+ are not generated.
- Re-amending keeps the very first original and moves `amended_on`; the earlier amendment period then shows the
  latest revision (one level of history). There is no "undo amendment" button (edit the values back).
- Composition eligibility (turnover limits, notified goods, inter-state bar) is warned about, not enforced; mixed
  supplies of a composition dealer, CMP-02/03/04 transitions, interest and late fees on CMP-08 / GSTR-4 are not computed.
- A trader's exempt goods are recognised only by a 0% catalogue rate on the line.

## Files
`src/lib/bill-of-supply.ts`, `src/lib/composition-returns.ts`, `src/lib/amendments.ts`, `src/lib/tax-rules.ts`,
`src/lib/gst-reports.ts` (`asFiled`, `isCompositionDoc`, amendments), `src/lib/gstr-json.ts`, `src/lib/compliance.ts`,
`src/components/templates/parts/SupplyDeclaration.tsx`, `src/components/creator/SupplyNotice.tsx`,
`src/components/documents/AmendDialog.tsx`, `src/components/gst-reports/CompositionView.tsx`.
Tests: `tests/composition-amendments.test.ts`, `tests/purchase-contract.test.ts`; e2e step "composition profile issues
a Bill of Supply with the Rule 49 declaration".
