/**
 * One document per tax situation, driven through the store, then read by every
 * downstream module: GSTR-1 section, GSTR-3B head, e-Invoice ValDtls, Tally XML
 * vouchers, receivables / stats (TDS) and books (TCS, cess).
 *
 * Base line everywhere: 10 x 1,000.00 = 10,000.00 taxable.
 */
import '../helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from '../helpers/shim.ts';
import {
  BUYER_KA,
  BUYER_MH,
  BUYER_SEZ_GJ,
  SELLER_GSTIN,
  clientKA,
  clientMH,
  clientRetail,
  clientUS,
  createViaStore,
  installSettings,
  reload,
  type InvSpec,
} from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { round2 } from '../../src/lib/invoice-calc.ts';
import { buildGstReport } from '../../src/lib/gst-reports.ts';
import { buildEInvoice } from '../../src/lib/einvoice.ts';
import { validateEInvoice } from '../../src/lib/einvoice-validate.ts';
import { buildTallyModel, voucherImbalance } from '../../src/lib/tally-xml.ts';
import { summarize } from '../../src/lib/stats.ts';
import { buildReceivables } from '../../src/lib/receivables.ts';
import { balanceSheet, gstSummary, loadBooksData, profitAndLoss } from '../../src/lib/books.ts';
import { buildGstr1Json, gstr3bRows } from '../../src/lib/gstr-json.ts';
import type { InvoiceRecord } from '../../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const PERIOD = { kind: 'month' as const, fyStart: 2026, month: 4 };
const BASE = { date: '2026-04-10', lines: [{ name: 'Research', qty: 10, rate: 1000, tax: 18 }] };
const mk = (over: Partial<InvSpec> = {}) => createViaStore({ ...BASE, ...over });
const gst = (inv: InvoiceRecord) => buildGstReport([inv], [], { period: PERIOD, gstin: SELLER_GSTIN });
const tally = (invs: InvoiceRecord[], payments = localDb.payments.getAll()) =>
  buildTallyModel(
    { invoices: invs, payments, clients: [], items: [], purchases: [], vendors: [] },
    { companyName: 'Mr Chartist Research' },
  );

/** Ledger postings in paise (credit positive) of a ledger name inside a voucher. */
const posted = (v: ReturnType<typeof tally>['vouchers'][number], ledger: string) =>
  v.entries.filter((e) => e.ledger === ledger).reduce((s, e) => s + (e.side === 'Cr' ? e.paise : -e.paise), 0);

const RECONCILE_CODES = ['SUM_ASSVAL', 'SUM_CGST', 'SUM_SGST', 'SUM_IGST', 'SUM_TOTAL', 'ITEM_TOTVAL', 'ITEM_TAX', 'ITEM_ASSAMT', 'ITEM_TOTAMT'];

/** The three cross-module invariants every single document must satisfy. */
function assertCrossModule(inv: InvoiceRecord, label: string) {
  // 1. e-Invoice JSON reconciles with its own ValDtls within 1 rupee, and the validator agrees.
  const { payload } = buildEInvoice(inv);
  const v = payload.ValDtls;
  const rebuilt = v.AssVal + v.CgstVal + v.SgstVal + v.IgstVal + (v.CesVal ?? 0) + (v.OthChrg ?? 0) - (v.Disc ?? 0) + v.RndOffAmt;
  assert.ok(Math.abs(rebuilt - v.TotInvVal) < 1, `${label}: ValDtls ${rebuilt} vs TotInvVal ${v.TotInvVal}`);
  assert.equal(v.TotInvVal, inv.total, `${label}: TotInvVal must equal the invoice total`);
  const bad = validateEInvoice(payload, inv).filter((i) => RECONCILE_CODES.includes(i.code) || i.code === 'STORED_TOTAL');
  assert.deepEqual(bad.map((i) => i.code), [], `${label}: e-Invoice reconciliation issues`);

  // 2. Tally vouchers balance to exactly zero, and Round Off holds only the true round-off (nothing hidden).
  const t = tally([inv]);
  const sale = t.vouchers.find((x) => x.type === 'Sales')!;
  assert.ok(sale, `${label}: sales voucher`);
  assert.equal(voucherImbalance(sale), 0, `${label}: Tally voucher must balance`);
  assert.equal(posted(sale, 'Round Off'), Math.round(inv.round_off * 100), `${label}: only the genuine round-off may land in Round Off`);

  // 3. GSTR-1 totals + 3B taxable heads carry the same tax as the invoice (cess aside).
  const rep = gst(inv);
  assert.equal(round2(rep.gstr1.totals.cgst + rep.gstr1.totals.sgst + rep.gstr1.totals.igst), inv.tax_amount, `${label}: GSTR-1 tax`);
  assert.equal(rep.gstr1.totals.taxable, inv.taxable_value, `${label}: GSTR-1 taxable`);
}

/* ───────────────────────── intra / inter state ───────────────────────── */

test('intra-state B2B: CGST+SGST, b2b section, 3B 3.1(a)', () => {
  const inv = mk();
  assert.deepEqual([inv.cgst_amount, inv.sgst_amount, inv.igst_amount, inv.total], [900, 900, 0, 11800]);
  const r = gst(inv);
  assert.equal(r.gstr1.b2b.length, 1);
  assert.equal(r.gstr1.b2b[0].ctin, BUYER_MH);
  assert.equal(r.gstr1.b2b[0].invTyp, 'R');
  assert.deepEqual(r.gstr3b.outward.taxable, { taxable: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0 });
  assert.deepEqual(r.gstr3b.payment.cash, { igst: 0, cgst: 900, sgst: 900 });
  // e-Invoice
  const { payload } = buildEInvoice(inv);
  assert.deepEqual(payload.ValDtls, { AssVal: 10000, CgstVal: 900, SgstVal: 900, IgstVal: 0, RndOffAmt: 0, TotInvVal: 11800 });
  // Tally: Dr party 11,800 = Cr Sales 10,000 + CGST 900 + SGST 900
  const v = tally([inv]).vouchers[0];
  assert.equal(posted(v, 'Bharat Traders'), -1180000);
  assert.equal(posted(v, 'Sales'), 1000000);
  assert.equal(posted(v, 'Output CGST'), 90000);
  assert.equal(posted(v, 'Output SGST'), 90000);
  assertCrossModule(inv, 'intra');
});

test('inter-state B2B: IGST only, b2b section, 3B IGST head', () => {
  const inv = mk({ client: clientKA });
  assert.deepEqual([inv.cgst_amount, inv.sgst_amount, inv.igst_amount, inv.total], [0, 0, 1800, 11800]);
  const r = gst(inv);
  assert.equal(r.gstr1.b2b[0].ctin, BUYER_KA);
  assert.equal(r.gstr1.b2b[0].pos, '29');
  assert.deepEqual(r.gstr3b.outward.taxable, { taxable: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0 });
  assert.equal(buildEInvoice(inv).payload.ValDtls.IgstVal, 1800);
  assert.equal(posted(tally([inv]).vouchers[0], 'Output IGST'), 180000);
  assertCrossModule(inv, 'inter');
});

test('B2C placement: B2CL above 2.5 lakh inter-state, otherwise B2CS (intra and inter)', () => {
  const retailKA = { ...clientRetail, id: 'r-ka', name: 'Retail KA', state_code: '29' };
  // 250 x 1,000 = 250,000 + 18% = 295,000 > 2,50,000, unregistered, inter-state -> B2CL
  const big = mk({ client: retailKA, lines: [{ qty: 250, rate: 1000, tax: 18 }] });
  assert.equal(big.total, 295000);
  const rb = gst(big);
  assert.equal(rb.gstr1.b2cl.length, 1);
  assert.equal(rb.gstr1.b2cs.length, 0);
  assert.deepEqual(rb.gstr3b.interStateUnreg, [{ pos: '29', taxable: 250000, igst: 45000 }]);

  const small = mk({ client: retailKA });
  const rs = gst(small);
  assert.deepEqual(
    rs.gstr1.b2cs.map((x) => [x.supply, x.pos, x.rate, x.txval, x.igst, x.cgst, x.sgst]),
    [['INTER', '29', 18, 10000, 1800, 0, 0]],
  );

  const intra = mk({ client: clientRetail });
  const ri = gst(intra);
  assert.deepEqual(
    ri.gstr1.b2cs.map((x) => [x.supply, x.pos, x.rate, x.txval, x.igst, x.cgst, x.sgst]),
    [['INTRA', '27', 18, 10000, 0, 900, 900]],
  );
});

/* ───────────────────────── zero-rated: SEZ / export ───────────────────────── */

test('SEZ without payment (LUT): zero tax, B2B inv_typ SEWOP, 3.1(b), e-Invoice SEZWOP', () => {
  const sez = { ...clientKA, id: 'sez', name: 'Gujarat SEZ Unit', gstin: BUYER_SEZ_GJ, state_code: '24' };
  const inv = mk({ client: sez, supply: 'SEZ_WITHOUT_PAYMENT' });
  assert.deepEqual([inv.tax_amount, inv.taxable_value, inv.total], [0, 10000, 10000]);
  const r = gst(inv);
  assert.equal(r.gstr1.b2b.length, 1, 'zero-rated SEZ supply must be reported, not dropped as nil');
  assert.equal(r.gstr1.b2b[0].invTyp, 'SEWOP');
  assert.deepEqual(r.gstr1.b2b[0].items.map((i) => [i.rate, i.txval, i.igst]), [[18, 10000, 0]]);
  assert.equal(r.gstr1.nil.length, 0);
  assert.deepEqual(r.gstr3b.outward.zeroRated, { taxable: 10000, igst: 0, cgst: 0, sgst: 0, cess: 0 });
  assert.equal(r.gstr3b.outward.taxable.taxable, 0);
  assert.equal((buildGstr1Json(r.gstr1).b2b as { inv: { inv_typ: string }[] }[])[0].inv[0].inv_typ, 'SEWOP');
  const e = buildEInvoice(inv).payload;
  assert.equal(e.TranDtls.SupTyp, 'SEZWOP');
  assert.equal(e.ValDtls.TotInvVal, 10000);
  assertCrossModule(inv, 'sez-wop');
});

test('SEZ with payment: IGST charged, SEWP, 3.1(b) carries the IGST, e-Invoice SEZWP', () => {
  const sez = { ...clientKA, id: 'sez', name: 'Gujarat SEZ Unit', gstin: BUYER_SEZ_GJ, state_code: '24' };
  const inv = mk({ client: sez, supply: 'SEZ_WITH_PAYMENT' });
  assert.deepEqual([inv.igst_amount, inv.total], [1800, 11800]);
  const r = gst(inv);
  assert.equal(r.gstr1.b2b[0].invTyp, 'SEWP');
  assert.deepEqual(r.gstr3b.outward.zeroRated, { taxable: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0 });
  assert.deepEqual(r.gstr3b.payment.cash, { igst: 1800, cgst: 0, sgst: 0 });
  assert.equal(buildEInvoice(inv).payload.TranDtls.SupTyp, 'SEZWP');
  assertCrossModule(inv, 'sez-wp');
});

test('export under LUT: exp WOPAY at the nominal rate, 3.1(b), e-Invoice EXPWOP/URP', () => {
  const inv = mk({ client: clientUS, pos: '99', supply: 'EXPORT_LUT' });
  assert.deepEqual([inv.tax_amount, inv.total], [0, 10000]);
  const r = gst(inv);
  assert.equal(r.gstr1.exp.length, 1, 'POS 99 is the app\'s export code and must route to exp');
  assert.equal(r.gstr1.exp[0].expType, 'WOPAY');
  assert.deepEqual(r.gstr1.exp[0].items.map((i) => [i.rate, i.txval, i.igst]), [[18, 10000, 0]]);
  assert.equal(r.gstr1.b2cs.length + r.gstr1.b2cl.length, 0);
  assert.deepEqual(r.gstr3b.outward.zeroRated, { taxable: 10000, igst: 0, cgst: 0, sgst: 0, cess: 0 });
  const e = buildEInvoice(inv).payload;
  assert.equal(e.TranDtls.SupTyp, 'EXPWOP');
  assert.equal(e.BuyerDtls.Gstin, 'URP');
  assert.equal(e.BuyerDtls.Stcd, '96');
  assert.equal(e.BuyerDtls.Pos, '96');
  assertCrossModule(inv, 'export-lut');
});

test('export with IGST payment: exp WPAY, IGST in 3.1(b) and payable in cash', () => {
  const inv = mk({ client: clientUS, pos: '99', supply: 'EXPORT_WITH_PAYMENT' });
  assert.deepEqual([inv.igst_amount, inv.total], [1800, 11800]);
  const r = gst(inv);
  assert.equal(r.gstr1.exp[0].expType, 'WPAY');
  assert.deepEqual(r.gstr3b.outward.zeroRated, { taxable: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0 });
  assert.equal(buildEInvoice(inv).payload.TranDtls.SupTyp, 'EXPWP');
  assertCrossModule(inv, 'export-wp');
});

test('export is recognised by POS 96 as well (GSTN spelling)', () => {
  const inv = mk({ client: clientUS, pos: '99', supply: 'EXPORT_LUT' });
  const stored = reload(inv.id);
  const r = buildGstReport([{ ...stored, place_of_supply: '96' }], [], { period: PERIOD, gstin: SELLER_GSTIN });
  assert.equal(r.gstr1.exp.length, 1);
});

/* ───────────────────────── reverse charge ───────────────────────── */

test('reverse charge (outward): b2b rchrg=Y, kept out of 3B 3.1(a) and reported as RCM taxable', () => {
  const inv = mk({ reverseCharge: true });
  const r = gst(inv);
  assert.equal(r.gstr1.b2b[0].rchrg, 'Y');
  assert.equal(r.gstr3b.outward.taxable.taxable, 0);
  assert.equal(r.gstr3b.outwardRcmTaxable, 10000);
  assert.equal(buildEInvoice(inv).payload.TranDtls.RegRev, 'Y');
});

/* ───────────────────────── TDS ───────────────────────── */

test('TDS 10% on taxable: invoice total unchanged, customer pays 10,800, nothing is "owed" for the TDS', () => {
  const inv = mk({ tds: { rate: 10 } });
  assert.equal(inv.total, 11800);
  assert.equal(inv.tds_amount, 1000); // 10% x 10,000 taxable
  assert.equal(inv.balance_due, 10800); // 11,800 - 1,000
  const live = localDb.payments.record({ invoiceId: inv.id, amount: 10800, method: 'Bank transfer', date: '2026-04-20' });
  assert.equal(live.amount, 10800);
  const r = reload(inv.id);
  assert.equal(r.status, 'Paid');
  assert.equal(r.balance_due, 0);

  const now = new Date('2026-05-01T10:00:00');
  const all = localDb.invoices.getAll();
  const s = summarize(all, now);
  assert.equal(s.billed, 11800);
  assert.equal(s.received, 10800);
  assert.equal(s.outstanding, 0);
  const rec = buildReceivables({ invoices: all, payments: localDb.payments.getAll(), clients: [clientMH] }, { now });
  assert.equal(rec.totals.net, 0, 'receivables must treat the withheld TDS as settled, like the dashboard');
  assert.equal(rec.totals.billCount, 0);
  assert.equal(rec.parties[0].entries.at(-1)?.balance, 0);
  // P&L income is the full 10,000 (TDS is a tax credit, not a price cut); the books still show the
  // 1,000 TDS as a receivable from the tax department, so the balance sheet balances with no plug.
  const data = loadBooksData();
  assert.equal(profitAndLoss(data, { start: '2026-04-01', end: '2027-03-31' }).income, 10000);
  const bs = balanceSheet(data, '2026-04-30');
  assert.equal(bs.assets.receivables, 1000);
  assert.equal(bs.equity.capitalAndOther, 0);
});

test('TDS on invoice total (not taxable): 10% of 11,800 = 1,180', () => {
  const inv = mk({ tds: { rate: 10, onTaxable: false } });
  assert.equal(inv.tds_amount, 1180);
  assert.equal(inv.balance_due, 10620);
});

/* ───────────────────────── TCS ───────────────────────── */

test('TCS 1% on total: collected from the customer, posted to its own ledger, never income', () => {
  const inv = mk({ tcs: { rate: 1, base: 'total' } });
  // before TCS = 10,000 + 1,800 = 11,800; TCS = 118.00; total = 11,918.00
  assert.equal(inv.tcs_amount, 118);
  assert.equal(inv.total, 11918);
  const { payload } = buildEInvoice(inv);
  assert.equal(payload.ValDtls.OthChrg, 118);
  assert.equal(payload.ValDtls.TotInvVal, 11918);
  const v = tally([inv]).vouchers[0];
  assert.equal(posted(v, 'TCS Payable'), 11800);
  assert.equal(posted(v, 'Round Off'), 0);
  assert.equal(voucherImbalance(v), 0);
  const data = loadBooksData();
  const pl = profitAndLoss(data, { start: '2026-04-01', end: '2027-03-31' });
  assert.equal(pl.income, 10000);
  const bs = balanceSheet(data, '2026-04-30');
  assert.equal(bs.liabilities.gstPayable, 1918); // 1,800 GST + 118 TCS
  assert.equal(bs.equity.capitalAndOther, 0);
  assertCrossModule(inv, 'tcs');
});

test('TCS on taxable value only: 1% of 10,000 = 100', () => {
  const inv = mk({ tcs: { rate: 1, base: 'taxable' } });
  assert.equal(inv.tcs_amount, 100);
  assert.equal(inv.total, 11900);
});

/* ───────────────────────── cess ───────────────────────── */

test('cess: 28% GST + 12% ad valorem cess + Rs 1/unit fixed cess', () => {
  // taxable 10,000; GST 28% = 2,800 (1,400 + 1,400); cess = 1,200 + 10 x 1 = 1,210; total 14,010
  const inv = mk({ lines: [{ qty: 10, rate: 1000, tax: 28, cess: 12, cessPerUnit: 1 }] });
  assert.equal(inv.tax_amount, 2800);
  assert.equal(inv.cess_amount, 1210);
  assert.equal(inv.total, 14010);
  const { payload } = buildEInvoice(inv);
  assert.equal(payload.ValDtls.CesVal, 1210);
  assert.deepEqual(
    [payload.ItemList[0].CesRt, payload.ItemList[0].CesAmt, payload.ItemList[0].CesNonAdvlAmt, payload.ItemList[0].TotItemVal],
    [12, 1200, 10, 14010],
  );
  const r = gst(inv);
  assert.equal(r.gstr1.b2b[0].items[0].cess, 1210);
  assert.equal(r.gstr1.totals.cess, 1210);
  assert.equal(r.gstr3b.outward.taxable.cess, 1210);
  assert.equal(r.gstr3b.payment.cess, 1210);
  assert.ok(gstr3bRows(r.gstr3b).some((row) => String(row[1]).startsWith('Cess payable')));
  const v = tally([inv]).vouchers[0];
  assert.equal(posted(v, 'Output Cess'), 121000);
  assert.equal(posted(v, 'Round Off'), 0);
  // Books: cess is a liability, not income
  const data = loadBooksData();
  assert.equal(profitAndLoss(data, { start: '2026-04-01', end: '2027-03-31' }).income, 10000);
  assert.equal(gstSummary(data, { start: '2026-04-01', end: '2026-04-30' }).outputCess, 1210);
  assert.equal(balanceSheet(data, '2026-04-30').equity.capitalAndOther, 0);
  assertCrossModule(inv, 'cess');
});

/* ───────────────────────── tax-inclusive pricing ───────────────────────── */

test('tax-inclusive: 10 x 1,180 at 18% backs out to 10,000 + 1,800', () => {
  const inv = mk({ inclusive: true, lines: [{ qty: 10, rate: 1180, tax: 18 }] });
  assert.deepEqual([inv.taxable_value, inv.tax_amount, inv.total], [10000, 1800, 11800]);
  assertCrossModule(inv, 'inclusive');
});

test('tax-inclusive with paise: 999.00 at 18% -> taxable 846.61, GST 152.39 (absorbs the paisa), total 999.00', () => {
  // 999 / 1.18 = 846.6101... -> 846.61; GST = 999.00 - 846.61 = 152.39 = 76.19 CGST + 76.20 SGST
  const inv = mk({ inclusive: true, roundMode: 'none', lines: [{ qty: 1, rate: 999, tax: 18 }] });
  assert.equal(inv.taxable_value, 846.61);
  assert.equal(inv.tax_amount, 152.39);
  assert.equal(round2(inv.cgst_amount + inv.sgst_amount), 152.39);
  assert.equal(inv.total, 999);
  assertCrossModule(inv, 'inclusive-paise');
});

/* ───────────────────────── rounding modes ───────────────────────── */

test('round-off modes on 333.33 + 18% (= 393.33)', () => {
  const run = (roundMode: 'nearest' | 'up' | 'down' | 'none') =>
    mk({ roundMode, lines: [{ qty: 1, rate: 333.33, tax: 18 }] });
  // GST = 59.9994 -> 60.00 ; before round-off = 393.33
  assert.deepEqual([run('nearest').total, run('nearest').round_off], [393, -0.33]);
  assert.deepEqual([run('up').total, run('up').round_off], [394, 0.67]);
  assert.deepEqual([run('down').total, run('down').round_off], [393, -0.33]);
  assert.deepEqual([run('none').total, run('none').round_off], [393.33, 0]);
});

test('nothing is lost when a line is zero-rated / exempt next to taxed ones (nil table + 3B)', () => {
  const inv = mk({
    lines: [
      { name: 'Taxed', qty: 1, rate: 1000, tax: 18 },
      { name: 'Exempt', qty: 1, rate: 500, tax: 0 },
    ],
  });
  assert.equal(inv.taxable_value, 1500);
  assert.equal(inv.tax_amount, 180);
  assert.equal(inv.total, 1680);
  const r = gst(inv);
  assert.equal(r.gstr1.totals.taxable, 1500);
  assert.deepEqual(r.gstr1.nil.map((n) => [n.type, n.nil]), [['INTRAB2B', 500]]);
  assert.equal(r.gstr3b.outward.taxable.taxable, 1000);
  assert.equal(r.gstr3b.outward.nilExempt.intra, 500);
});

test('REGRESSION: with TDS, a PART payment leaves exactly (total - TDS - paid) outstanding in stats AND receivables', () => {
  const inv = mk({ tds: { rate: 10 } }); // total 11,800, TDS 1,000 -> customer owes 10,800
  localDb.payments.record({ invoiceId: inv.id, amount: 5000, method: 'UPI', date: '2026-04-20' });
  const r = reload(inv.id);
  assert.equal(r.status, 'Partially Paid');
  assert.equal(r.balance_due, 5800); // 10,800 - 5,000
  const now = new Date('2026-05-01T10:00:00');
  const all = localDb.invoices.getAll();
  assert.equal(summarize(all, now).outstanding, 5800);
  const rec = buildReceivables({ invoices: all, payments: localDb.payments.getAll(), clients: [clientMH] }, { now });
  assert.equal(rec.totals.net, 5800, 'the party must not be chased for the 1,000 the customer deducted as TDS');
  assert.equal(rec.parties[0].bills[0].outstanding, 5800);
  assert.equal(rec.parties[0].entries.at(-1)?.balance, 5800);
});
