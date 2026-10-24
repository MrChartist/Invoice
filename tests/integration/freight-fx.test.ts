/**
 * Roadmap 3.3 (taxable freight / other charges) and 3.4 (foreign-currency exports with an
 * exchange rate): one document each, created through the store, then read by calc, GSTR-1,
 * GSTR-3B, the e-Invoice, Tally, Books, accounting exports and the dashboard. Every module
 * must report the same rupee figures.
 */
import '../helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from '../helpers/shim.ts';
import { SELLER_GSTIN, clientUS, createViaStore, installSettings, type InvSpec } from '../helpers/world.ts';
import { calcInputFromRecord, calculateInvoice } from '../../src/lib/invoice-calc.ts';
import { buildGstReport } from '../../src/lib/gst-reports.ts';
import { buildGstr1Json, sectionCsv } from '../../src/lib/gstr-json.ts';
import { buildEInvoice } from '../../src/lib/einvoice.ts';
import { validateEInvoice } from '../../src/lib/einvoice-validate.ts';
import { buildTallyModel, voucherImbalance } from '../../src/lib/tally-xml.ts';
import { foreignWithoutRate, summarize } from '../../src/lib/stats.ts';
import { gstSummary as booksGst, loadBooksData, profitAndLoss } from '../../src/lib/books.ts';
import { gstSummary as csvGstSummary, salesRegister } from '../../src/lib/accounting-export.ts';
import { buildEway } from '../../src/lib/eway.ts';
import { inrRecord, inrTotals, inrValue } from '../../src/lib/fx.ts';
import type { InvoiceRecord, Payment } from '../../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const PERIOD = { kind: 'month' as const, fyStart: 2026, month: 4 };
const FY = { start: '2026-04-01', end: '2027-03-31' };
const gst = (invs: InvoiceRecord[]) => buildGstReport(invs, [], { period: PERIOD, gstin: SELLER_GSTIN });
const tally = (invs: InvoiceRecord[], payments: Payment[] = []) =>
  buildTallyModel({ invoices: invs, payments, clients: [], items: [], purchases: [], vendors: [] }, { companyName: 'Mr Chartist Research' });
const posted = (v: ReturnType<typeof tally>['vouchers'][number], ledger: string) =>
  v.entries.filter((e) => e.ledger === ledger).reduce((s, e) => s + (e.side === 'Cr' ? e.paise : -e.paise), 0);
const RECONCILE = ['SUM_ASSVAL', 'SUM_CGST', 'SUM_SGST', 'SUM_IGST', 'SUM_TOTAL', 'ITEM_TOTVAL', 'ITEM_TAX', 'ITEM_ASSAMT', 'ITEM_TOTAMT', 'STORED_TOTAL'];

/* ───────────────────────── 3.3 taxable freight ───────────────────────── */

// Goods, intra-state: 10 x 1,000 @18% (HSN 8471) + 5 x 200 @5% (HSN 1006); freight 500 + packing 100.
const GOODS: InvSpec = {
  date: '2026-04-10',
  lines: [
    { name: 'Laptop', hsn: '84713010', qty: 10, rate: 1000, tax: 18 },
    { name: 'Rice', hsn: '10063010', qty: 5, rate: 200, tax: 5, unit: 'KG' },
  ],
  shipping: 500,
  other: 100,
};

test('3.3 legacy: without the toggle charges stay untaxed and every figure is unchanged', () => {
  const inv = createViaStore(GOODS);
  assert.equal(inv.charges_taxable, undefined, 'the field is not written for legacy behaviour');
  assert.deepEqual([inv.taxable_value, inv.tax_amount, inv.total], [11000, 1850, 13450]);
  assert.equal(buildEInvoice(inv).payload.ValDtls.OthChrg, 600);
});

test('3.3 taxable freight: highest rate, one document consistent across calc, GSTR-1/3B, e-Invoice, e-Way, Tally, Books', () => {
  const inv = createViaStore({ ...GOODS, patch: { charges_taxable: true } });
  // calc: 600 of charges at the highest rate (18%) = 108 tax, split 54 / 54.
  const calc = calculateInvoice(calcInputFromRecord(inv));
  assert.equal(calc.charges_line?.tax_rate, 18);
  assert.equal(calc.charges_line?.hsn, '84713010', 'principal (highest-rate) line HSN');
  assert.equal(calc.charges_line?.cess, 0);
  assert.equal(calc.lines.length, 2, 'item rows are untouched');
  assert.deepEqual([inv.taxable_value, inv.cgst_amount, inv.sgst_amount, inv.tax_amount, inv.total], [11600, 979, 979, 1958, 13558]);
  assert.deepEqual(calc.slabs.map((x) => [x.rate, x.taxable]), [[5, 1000], [18, 10600]]);

  // GSTR-1 B2B rate rows, HSN (freight joins the principal HSN with no quantity), 3B.
  const r = gst([inv]);
  assert.deepEqual(r.gstr1.b2b[0].items.map((x) => [x.rate, x.txval, x.cgst]), [[5, 1000, 25], [18, 10600, 954]]);
  const hsn = r.gstr1.hsn.find((h) => h.hsn === '84713010')!;
  assert.deepEqual([hsn.qty, hsn.taxable, hsn.cgst], [10, 10600, 954]);
  assert.deepEqual(r.gstr3b.outward.taxable, { taxable: 11600, igst: 0, cgst: 979, sgst: 979, cess: 0 });
  assert.equal(r.gstr1.totals.value, 13558);

  // e-Invoice: freight is a taxable item, not OthChrg; ValDtls reconciles; validator is clean.
  const { payload } = buildEInvoice(inv);
  assert.equal(payload.ItemList.length, 3);
  assert.deepEqual(
    [payload.ItemList[2].HsnCd, payload.ItemList[2].AssAmt, payload.ItemList[2].GstRt, payload.ItemList[2].CgstAmt],
    ['84713010', 600, 18, 54],
  );
  assert.equal(payload.ValDtls.OthChrg, undefined);
  assert.deepEqual([payload.ValDtls.AssVal, payload.ValDtls.CgstVal, payload.ValDtls.TotInvVal], [11600, 979, 13558]);
  assert.deepEqual(validateEInvoice(payload, inv).filter((i) => RECONCILE.includes(i.code)).map((i) => i.code), []);

  // e-Way: taxable value includes the freight, no "other value" left over.
  const eway = buildEway(inv).bill;
  assert.equal(eway.totalValue, 11600);
  assert.equal(eway.OthValue, 0);
  assert.equal(eway.totInvValue, 13558);

  // Tally: Sales 11,000, freight ledger 600, the freight's GST inside Output CGST/SGST.
  const v = tally([inv]).vouchers[0];
  assert.equal(posted(v, 'Sales'), 1100000);
  assert.equal(posted(v, 'Freight and Other Charges'), 60000);
  assert.equal(posted(v, 'Output CGST'), 97900);
  assert.equal(posted(v, 'Round Off'), 0);
  assert.equal(voucherImbalance(v), 0);

  // Books: income is taxable value (freight counted once), GST matches the return.
  const data = loadBooksData();
  assert.equal(profitAndLoss(data, FY).income, 11600);
  assert.equal(booksGst(data, FY).outputTotal, 1958);

  // Accounting CSV: the GST summary keeps the freight at 18%; the register leaves "Other Charges" empty.
  const src = { invoices: [inv], payments: [], clients: [], items: [], purchases: [], vendors: [] };
  const g = csvGstSummary(src).rows.find((row) => row[0] === 'Sales' && row[1] === 18)!;
  assert.deepEqual(g[3], { money: 10600 });
  const reg = salesRegister([inv]);
  const col = (name: string) => reg.rows[0][reg.headers.indexOf(name)];
  assert.deepEqual([col('Taxable Value'), col('Other Charges'), col('Invoice Total')], [{ money: 11600 }, { money: 0 }, { money: 13558 }]);
});

test('3.3 export under LUT: taxable freight is zero-rated at the principal slab', () => {
  const inv = createViaStore({ ...GOODS, client: clientUS, pos: '99', supply: 'EXPORT_LUT', patch: { charges_taxable: true } });
  assert.deepEqual([inv.taxable_value, inv.tax_amount, inv.total], [11600, 0, 11600]);
  const exp = gst([inv]).gstr1.exp[0];
  assert.deepEqual(exp.items.map((x) => [x.rate, x.txval]), [[5, 1000], [18, 10600]]);
});

/* ───────────────────────── 3.4 foreign currency ───────────────────────── */

// USD 1,000 export with IGST: 10 x 100 @18% = 1,180 USD; at ₹83.25 = 83,250 + 14,985 = ₹98,235.
const USD: InvSpec = {
  date: '2026-04-10',
  client: clientUS,
  pos: '99',
  supply: 'EXPORT_WITH_PAYMENT',
  currency: 'USD',
  lines: [{ name: 'Valves', hsn: '84818090', qty: 10, rate: 100, tax: 18 }],
};
const SB = { exchange_rate: 83.25, shipping_bill_no: '7654321', shipping_bill_date: '2026-04-12', port_code: 'INNSA1' };

test('3.4 USD export: the same rupee figures in GSTR-1 EXP, 3B, e-Invoice, Tally, Books and the dashboard', () => {
  const inv = createViaStore({ ...USD, patch: SB });
  // The document itself stays in dollars (snapshots never change).
  assert.deepEqual([inv.currency, inv.taxable_value, inv.igst_amount, inv.total], ['USD', 1000, 180, 1180]);
  assert.equal(inrValue(inv.total, inv), 98235);

  const r = gst([inv]);
  assert.equal(r.issues.filter((i) => i.code === 'FX_RATE_MISSING').length, 0);
  const exp = r.gstr1.exp[0];
  assert.deepEqual([exp.expType, exp.value, exp.taxable, exp.igst], ['WPAY', 98235, 83250, 14985]);
  assert.deepEqual([exp.sbpcode, exp.sbnum, exp.sbdt], ['INNSA1', '7654321', '2026-04-12']);
  const j = buildGstr1Json(r.gstr1) as { exp: { inv: Record<string, unknown>[] }[] };
  assert.deepEqual(
    [j.exp[0].inv[0].val, j.exp[0].inv[0].sbpcode, j.exp[0].inv[0].sbnum, j.exp[0].inv[0].sbdt],
    [98235, 'INNSA1', '7654321', '12-04-2026'],
  );
  assert.match(sectionCsv(r.gstr1, 'exp'), /INNSA1,7654321,2026-04-12/);
  assert.deepEqual(r.gstr3b.outward.zeroRated, { taxable: 83250, igst: 14985, cgst: 0, sgst: 0, cess: 0 });

  // e-Invoice: INR amounts, ForCur names the currency, shipping bill comes from the invoice.
  const { payload } = buildEInvoice(inv, { export: { countryCode: 'US' } });
  assert.deepEqual([payload.ValDtls.AssVal, payload.ValDtls.IgstVal, payload.ValDtls.TotInvVal], [83250, 14985, 98235]);
  assert.deepEqual([payload.ItemList[0].UnitPrice, payload.ItemList[0].TotAmt], [8325, 83250]);
  assert.deepEqual(payload.ExpDtls, { ShipBNo: '7654321', ShipBDt: '12/04/2026', Port: 'INNSA1', ForCur: 'USD', CntCode: 'US' });
  assert.deepEqual(validateEInvoice(payload, inv).filter((i) => RECONCILE.includes(i.code)).map((i) => i.code), []);

  // Tally: rupees, balanced, with the dollar figure in the narration; a USD receipt is booked at the rate.
  const pay: Payment = { id: 'p1', invoice_id: inv.id, amount: 1180, method: 'Bank transfer', date: '2026-05-02' };
  const t = tally([inv], [pay]);
  const sale = t.vouchers.find((v) => v.type === 'Sales')!;
  assert.equal(posted(sale, 'Sales'), 8325000);
  assert.equal(posted(sale, 'Output IGST'), 1498500);
  assert.equal(posted(sale, 'Acme Inc'), -9823500);
  assert.equal(voucherImbalance(sale), 0);
  assert.match(sale.narration, /USD 1180\.00 @ ₹83\.25/);
  const rcpt = t.vouchers.find((v) => v.type === 'Receipt')!;
  assert.equal(posted(rcpt, 'Bank Account'), -9823500);
  assert.equal(voucherImbalance(rcpt), 0);

  // Books and the dashboard.
  const data = loadBooksData();
  assert.equal(profitAndLoss(data, FY).income, 83250);
  assert.equal(booksGst(data, FY).outputIgst, 14985);
  assert.equal(summarize([inv], new Date('2026-04-20T10:00:00'), [], 'INR').billed, 98235);
  assert.equal(foreignWithoutRate([inv]), 0);

  // Calc in rupees: parts re-sum to the converted total.
  const c = inrTotals(calculateInvoice(calcInputFromRecord(inv)), inv);
  assert.equal(c.taxable_value + c.tax_amount + c.round_off, c.total);
});

test('3.4 without an exchange rate: flagged by GST reports and the e-Invoice, left out of rupee totals', () => {
  const inv = createViaStore(USD);
  const r = gst([inv]);
  const issue = r.issues.find((i) => i.code === 'FX_RATE_MISSING');
  assert.equal(issue?.severity, 'error');
  assert.equal(r.gstr1.exp[0].taxable, 1000, 'reported at face value until a rate is added');
  assert.ok(r.issues.some((i) => i.code === 'EXP_SHIPPING_BILL'));
  assert.ok(buildEInvoice(inv).assumptions.some((i) => i.code === 'FX_RATE_MISSING'));
  assert.equal(summarize([inv], new Date('2026-04-20T10:00:00'), [], 'INR').billed, 0);
  assert.equal(foreignWithoutRate([inv]), 1);
  assert.equal(inrRecord(inv), inv, 'no rate: the record is not converted');
});

test('3.4 a converted copy keeps its parts adding up when the rate creates paise drift', () => {
  const inv = createViaStore({ ...USD, lines: [{ qty: 3, rate: 33.33, tax: 18 }], patch: { exchange_rate: 83.4567 } });
  const conv = inrRecord(inv);
  const parts = conv.taxable_value + conv.tax_amount + conv.round_off;
  assert.ok(Math.abs(parts - conv.total) < 0.005, `${parts} vs ${conv.total}`);
  assert.equal(conv.total, inrValue(inv.total, inv));
  const t = tally([inv]);
  assert.equal(voucherImbalance(t.vouchers[0]), 0);
});
