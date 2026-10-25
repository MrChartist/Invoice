# Calc extensions (cess, TCS, TDS, inclusive pricing, export/SEZ, rounding)

All fields are optional and additive; absent = legacy behaviour (golden tests in `tests/invoice-calc.test.ts` and `tests/invoice-store.test.ts`).

## Order of operations
gross -> line discount -> invoice discount (on tax-inclusive net when `price_includes_tax`) -> taxable -> GST + cess -> + shipping/other (taxed at the highest line rate when `charges_taxable`, see `freight-fx.md`) -> + TCS -> round (`round_mode`) = **total** (invoice value). TDS never changes `total`: `payable = total - tds_amount`, `balance_due = payable - amount_paid`. Outward reverse charge (`rcm_exclude_tax`, from `reverse_charge && rcm_tax_excluded`): GST + cess are computed per line but left out of the total (and of the TCS base) and returned as `rcm_tax` — see `src/lib/rcm.ts` and `gst-reports.md`.

TDS / TCS presets are dated in `tax-rules.ts` (verify with your CA): 194J technical 10% until 31 Mar 2020, 2% after; the 25% relief 14 May 2020 – 31 Mar 2021 (194C 0.75 / 1.5, 194H 3.75, 194I 1.5 / 7.5, 194J 1.5 / 7.5); 194Q from 1 Jul 2021; 194H 2% from 1 Oct 2024. 206C(1H) and 206C(1G) start 1 Oct 2020 (no preset before): 1H 0.075% to 31 Mar 2021, 0.1% after, withdrawn from 1 Apr 2025; 1G 5%, 20% from 1 Oct 2023.

## Fields
- Item: `cess_rate` (% of taxable), `cess_per_unit` (fixed per qty). Cess is a single bucket (not split CGST/SGST), zero when GST mode is NONE.
- Invoice: `price_includes_tax`, `supply_type`, `lut_number`, `lut_date`, `round_mode` ('nearest'|'up'|'down'|'none'; if absent, `round_off_enabled` decides), `tcs_enabled/rate/base('taxable'|'total')/label`, `tds_enabled/section/rate/tds_on_taxable` (default true = taxable value before GST).
- Computed: `cess_amount`, `tcs_amount`, `tds_amount` persisted on the record; `CalcTotals` also has `payable`.
- Supply: `EXPORT_LUT`, `SEZ_WITHOUT_PAYMENT` -> zero tax and cess; `*_WITH_PAYMENT` -> forced IGST; `DEEMED_EXPORT`/B2B/B2C normal.
- Inclusive pricing: taxable = (net - fixed cess) / (1 + (gst% + cess%)/100); GST absorbs the paisa drift so taxable+gst+cess == net exactly.

## Not done: `discount_applies_to: 'total'`
A discount applied after tax would reduce invoice value without reducing taxable value, which contradicts GST valuation (s.15: discount before/at supply reduces taxable value) and would change the meaning of existing `discount_*` fields. Skipped deliberately.

## Wiring the lead must do
`src/pages/InvoiceCreator.tsx` (not owned by this module; there is no `creator/` UI in this base) should mount `<AdvancedTaxPanel />` from `src/components/creator/SummaryPanel.tsx` under the totals, and `<CessFields item={...} />` from `ItemsTable.tsx` on each line (use `hasAnyCess(items)` from `invoice-calc.ts` to decide on a column). Store setters: `setRoundMode, setPriceIncludesTax, setSupplyType, setLut, setTcs, setTds`.
Downstream: dashboard/receivables should read `tds_amount` as a tax asset; `balance_due` already nets it. `localDb.payments` untouched (note: `syncPaymentState` should compare payments against `total - tds_amount`; not changed here).

## Template edits (re-apply if merge conflicts)
Both in `src/components/templates/TemplateEngine.tsx`, marked `calc-extensions`: (1) Cess and TCS rows before the Shipping row; (2) before the Balance block: LUT declaration line, "Less: TDS" row, and the balance block condition became `amount_paid > 0 || tds_amount > 0`. `PaperItemsTable.tsx` untouched.
