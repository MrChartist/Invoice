# Taxable freight (3.3) and foreign-currency exports (3.4)

Working papers — verify with your CA before filing or importing.

## 3.3 Taxable freight / other charges (CGST Act s.15(2)(c))

- Field: `charges_taxable?: boolean` on `InvoiceRecord`. Absent/false = the old behaviour (charges
  added after tax, untaxed), so every existing invoice computes exactly as before.
- Editor: "Charge GST on shipping & other charges" in `SummaryPanel`, shown once a charge is entered;
  it displays the rate applied.
- Rule (`invoice-calc.ts`, step 6): shipping + other charges form ONE extra taxable line
  (`CalcTotals.charges_line`, id `__charges__`) taxed at the **highest GST rate among the lines** and
  carrying that line's HSN. This is the composite-supply rule of s.8(a) (the principal supply's rate)
  applied conservatively. If two lines share the top rate, the one with the larger taxable value wins.
  With no lines, the document's fallback rate applies. The line carries **no cess**. Charges are always
  tax-exclusive and the invoice discount never reaches them. If the net charge is zero or less, it is
  left untaxed (a negative "charge" is a discount).
- Zero-rated supplies (export/SEZ without payment, gst_mode NONE) report the charges at the principal
  line's nominal rate with zero tax, the same way item lines are reported.
- `charges_line` is kept out of `lines` (which mirror the item rows the templates print) but is
  included in `taxable_value`, CGST/SGST/IGST, `slabs` and `hsn_rows`. Use `taxLinesOf(calc)` to get
  item lines plus the charges line. `chargesAreTaxed(rec)` / `untaxedCharges(rec)` read a stored record.
- Downstream:
  - **GSTR-1**: one more rate row; the HSN row joins the principal HSN with quantity 0. **GSTR-3B**: inside 3.1(a)/(b).
  - **e-Invoice**: an extra `ItemList` entry ("Freight & other charges", Qty 1, Unit OTH, principal
    HSN and rate). It is not sent as `ValDtls.OthChrg`, because OthChrg sits outside `AssVal` and carries
    no tax. As an item, `AssVal`, the tax totals and `TotInvVal` reconcile, and the existing validator
    checks pass. Untaxed charges still go to OthChrg.
  - **e-Way**: freight joins the taxable value and tax totals; `OthValue` drops it.
  - **Tally**: Cr Sales = the items' taxable value; Cr "Freight and Other Charges" = the charges; their
    GST goes into the same Output CGST/SGST/IGST ledgers.
  - **Books / sales reports**: income = taxable value (freight counted once, not twice).
  - **Accounting CSV**: Taxable Value includes the charges; "Other Charges" shows only untaxed charges; the
    GST summary carries them at their rate.
- Templates print "Shipping (taxable)" / "Other charges (taxable)" when the charges are taxed.
- Recurring schedules keep the flag. Conversions (quote → invoice) copy it with the rest of the record.

## 3.4 Foreign-currency documents with an exchange rate

- Fields (all optional and additive): `exchange_rate` (rupees per 1 unit of `currency`),
  `shipping_bill_no`, `shipping_bill_date` (YYYY-MM-DD), `port_code`.
- Editor: `src/components/creator/ForexFields.tsx` under the document details. "Exchange rate (₹ per USD)"
  appears when the currency is not INR, with a hint to use the CBIC-notified / shipping-bill rate (Rule 34).
  Shipping-bill fields appear for exports (EXPORT_* supply or place of supply 96/99). The e-Invoice
  modal pre-fills its port code from the invoice.
- The document itself stays in its currency, so the preview and snapshots never change. Every rupee figure
  goes through **`src/lib/fx.ts`**:
  - `fxRate(rec)`: 1 for INR, the rate, or `null` (foreign without a rate).
  - `inrValue(amount, rec)`: one amount in INR (face value when there is no rate).
  - `inrRecord(rec)`: stored totals in INR (Books, exports, dashboards).
  - `inrTotals(calc, rec)`: calculator output in INR (GSTR, e-Invoice, e-Way, Tally inventory, CSV items).
  - Rule: each figure is converted on its own; the total is `round2(total × rate)`, and the round-off absorbs
    the paise drift, so the parts always re-sum to the converted total and the total agrees everywhere.
- Where it is used: dashboard / Transactions summary (`stats.inCurrency('INR')` now includes converted
  foreign documents; `foreignWithoutRate` counts those left out, shown in the Billed hint), GSTR-1/3B (EXP
  values in INR, plus `sbpcode`/`sbnum`/`sbdt` in the JSON and CSV), e-Invoice (INR `AssVal`/`UnitPrice`
  etc.; `ExpDtls.ForCur` = currency; `ShipBNo`/`ShipBDt`/`Port` default from the invoice), e-Way, Books
  (sales and receipts at the invoice rate), Tally (vouchers in rupees, with a "USD 1180.00 @ ₹83.25"
  narration; receipts at the invoice rate) and accounting CSVs (Currency column = INR once converted).
- Without a rate: GST reports raise `FX_RATE_MISSING` (error) and report at face value. The e-Invoice
  adds an `FX_RATE_MISSING` error. Rupee dashboards leave the document out. Books and Tally book face
  value, which is the old behaviour, because a ledger must post something.
- GST reports raise `EXP_SHIPPING_BILL` (info) for an export of goods without shipping-bill details.

## Not done / limits

- Realised exchange gain/loss (6.19): enter the realised rate on the receipt and the ledger posts the difference to 4930
  (`docs/features/cash-planning.md`). The Tally export still books receipts at the invoice rate.
- Sales reports (`src/lib/sales-reports.ts`) and the TDS register stay INR-only, as before. Foreign documents are counted as excluded.
- ~~There is no per-date rate table, so the rate is typed per invoice.~~ Done in 8.125: the currency master `currency-rates.ts` (stale note struck by R6-C6). The country code for `ExpDtls.CntCode` is still entered in the e-Invoice modal.
- Charges cannot be marked tax-inclusive. A credit note still never credits charges (see `docs/qa/logic.md`).

## Currency master — dated reference rates (8H, roadmap 8.125)

Settings → Defaults → **Currency reference rates** (`src/lib/currency-rates.ts`, table `currency_rates`, `master.edit`):
₹ per unit by date, typed by hand or imported from a CSV of RBI / FBIL reference rates the user downloaded (wide
`Date, USD, GBP, EUR, 100 JPY …` or long `Date, Currency, Rate`; dd-mm-yyyy / dd-Mon-yyyy / ISO dates; "100 JPY" columns
are divided by 100). One rate per currency and day. A foreign-currency document with no exchange rate yet picks the
latest rate dated on or before its own date (`rateOn`) and says which one it used; the user can type another. The rate
for GST valuation / customs is the one notified for that purpose — verify with your CA.
