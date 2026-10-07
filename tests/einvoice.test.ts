import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEInvoice,
  mapUnitToUqc,
  toNicDate,
  upsertMeta,
  validateMeta,
  stringifyEInvoice,
  type EInvoiceMeta,
} from '../src/lib/einvoice.ts';
import { preflightEInvoice, validateEInvoice } from '../src/lib/einvoice-validate.ts';
import { BUYER_KA, invoice, item, sender } from './einvoice-fixtures.ts';

const NOW = new Date(2025, 5, 20);
const codes = (r: { errors: { code: string }[]; warnings: { code: string }[] }) => ({
  e: r.errors.map((i) => i.code),
  w: r.warnings.map((i) => i.code),
});

test('intra-state: CGST+SGST, schema shape and totals', () => {
  const { payload } = buildEInvoice(invoice());
  assert.equal(payload.Version, '1.1');
  assert.deepEqual(payload.TranDtls, { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' });
  assert.deepEqual(payload.DocDtls, { Typ: 'INV', No: 'INV/FY25-26/0001', Dt: '18/06/2025' });
  assert.equal(payload.SellerDtls.Stcd, '27');
  assert.equal(payload.SellerDtls.Pin, 400001);
  assert.equal(payload.SellerDtls.Ph, '9876543210');
  assert.equal(payload.BuyerDtls.Pos, '27');
  assert.equal(payload.BuyerDtls.Pin, 400002);
  const [it] = payload.ItemList;
  assert.equal(it.SlNo, '1');
  assert.equal(it.IsServc, 'N');
  assert.equal(it.GstRt, 18);
  assert.equal(it.CgstAmt, 90);
  assert.equal(it.SgstAmt, 90);
  assert.equal(it.IgstAmt, 0);
  assert.equal(it.TotItemVal, 1180);
  assert.deepEqual(payload.ValDtls, { AssVal: 1000, CgstVal: 90, SgstVal: 90, IgstVal: 0, RndOffAmt: 0, TotInvVal: 1180 });
  const r = preflightEInvoice(invoice(), { now: NOW });
  assert.equal(r.ready, true, JSON.stringify(r.errors));
});

test('inter-state: IGST, POS differs from seller state', () => {
  const rec = invoice({
    gst_mode: 'IGST',
    place_of_supply: '29',
    client: { ...invoice().client, gstin: BUYER_KA, state_code: '29', city: 'Bengaluru', zip: '560001' },
  });
  const { payload } = buildEInvoice(rec);
  assert.equal(payload.BuyerDtls.Stcd, '29');
  assert.equal(payload.BuyerDtls.Pos, '29');
  assert.equal(payload.ItemList[0].IgstAmt, 180);
  assert.equal(payload.ItemList[0].CgstAmt, 0);
  assert.equal(payload.TranDtls.IgstOnIntra, 'N');
  assert.equal(payload.ValDtls.IgstVal, 180);
  assert.equal(preflightEInvoice(rec, { now: NOW }).ready, true);
});

test('discounts: line + invoice discount flow into Discount/AssAmt and reconcile', () => {
  const rec = invoice({
    items: [
      item({ quantity: 3, rate: 999.99, discount_percent: 10 }),
      item({ quantity: 2, rate: 500, tax_rate: 12, hsn: '998314', unit: 'HRS' }),
    ],
    discount_type: 'AMOUNT',
    discount_rate: 100,
    round_off_enabled: true,
    shipping: 50,
  });
  const { payload } = buildEInvoice(rec);
  const [a, b] = payload.ItemList;
  assert.equal(a.TotAmt, 2999.97);
  assert.ok(a.Discount > 299.99); // 10% line + share of 100
  assert.equal(Math.round((a.TotAmt - a.Discount) * 100) / 100, a.AssAmt);
  assert.equal(b.IsServc, 'Y');
  assert.equal(b.Unit, 'OTH');
  assert.equal(payload.ValDtls.OthChrg, 50);
  assert.equal(Number.isInteger(payload.ValDtls.TotInvVal), true);
  const r = preflightEInvoice(rec, { now: NOW });
  assert.deepEqual(r.errors, []);
});

test('reverse charge flag', () => {
  const { payload } = buildEInvoice(invoice({ reverse_charge: true }));
  assert.equal(payload.TranDtls.RegRev, 'Y');
});

test('export with payment of IGST: URP buyer, state 96, ExpDtls', () => {
  const rec = invoice({
    gst_mode: 'IGST',
    place_of_supply: '99',
    currency: 'USD',
    client: { name: 'Globex', email: '', address: '1 Main St', city: 'Austin', zip: '', gstin: '', state: 'Other Country (Export)' },
  });
  const { payload } = buildEInvoice(rec, {
    export: { countryCode: 'us', portCode: 'inbom4', shipBillNo: '123', shipBillDate: '2025-06-17' },
  });
  assert.equal(payload.TranDtls.SupTyp, 'EXPWP');
  assert.equal(payload.BuyerDtls.Gstin, 'URP');
  assert.equal(payload.BuyerDtls.Stcd, '96');
  assert.equal(payload.BuyerDtls.Pos, '96');
  assert.equal(payload.BuyerDtls.Pin, 999999);
  assert.deepEqual(payload.ExpDtls, {
    ShipBNo: '123',
    ShipBDt: '17/06/2025',
    Port: 'INBOM4',
    ForCur: 'USD',
    CntCode: 'US',
  });
  const r = preflightEInvoice(rec, { now: NOW, export: { countryCode: 'US' } });
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
});

test('export without payment: no IGST', () => {
  const rec = invoice({
    gst_mode: 'IGST',
    place_of_supply: '99',
    items: [item({ tax_rate: 0 })],
    client: { ...invoice().client, gstin: '' },
  });
  const { payload } = buildEInvoice(rec);
  assert.equal(payload.TranDtls.SupTyp, 'EXPWOP');
  assert.equal(payload.ValDtls.IgstVal, 0);
});

test('doc number: app format INV/FY25-26/0001 is exactly 16 chars and passes', () => {
  assert.equal('INV/FY25-26/0001'.length, 16);
  const r = preflightEInvoice(invoice(), { now: NOW });
  assert.ok(!codes(r).e.some((c) => c.startsWith('DOC_NO')));
});

test('doc number: longer prefix or bad chars are blocked', () => {
  const long = preflightEInvoice(invoice({ invoice_number: 'MCHART/FY25-26/0001' }), { now: NOW });
  assert.ok(codes(long).e.includes('DOC_NO_LEN'));
  const bad = preflightEInvoice(invoice({ invoice_number: 'INV 2025_1' }), { now: NOW });
  assert.ok(codes(bad).e.includes('DOC_NO_CHARS'));
  const zero = preflightEInvoice(invoice({ invoice_number: '0001' }), { now: NOW });
  assert.ok(codes(zero).e.includes('DOC_NO_CHARS'));
});

test('validator catches bad GSTIN, PIN, HSN, future date', () => {
  const rec = invoice({
    issue_date: '2025-07-01',
    client: { ...invoice().client, gstin: '27AAACB2230M1Z9', zip: '4000', state_code: '27' },
    items: [item({ hsn: '12' })],
    sender: { ...sender, companyGstin: 'BADGSTIN', companyAddress: 'No pin here' },
  });
  const r = preflightEInvoice(rec, { now: NOW });
  const c = codes(r).e;
  for (const code of ['SELLER_GSTIN', 'BUYER_GSTIN', 'BUYER_PIN', 'SELLER_PIN', 'ITEM_HSN', 'DOC_DATE_FUTURE']) {
    assert.ok(c.includes(code), `missing ${code} in ${c.join(',')}`);
  }
  assert.equal(r.ready, false);
});

test('short HSN warns, 7-digit HSN errors', () => {
  const w = preflightEInvoice(invoice({ items: [item({ hsn: '8471' })] }), { now: NOW });
  assert.ok(codes(w).w.includes('ITEM_HSN_SHORT'));
  assert.equal(w.ready, true);
  const e = preflightEInvoice(invoice({ items: [item({ hsn: '8471300' })] }), { now: NOW });
  assert.ok(codes(e).e.includes('ITEM_HSN_LEN'));
});

test('quotations are not e-invoiceable; B2C warns', () => {
  const q = preflightEInvoice(invoice({ doc_type: 'QUOTATION' }), { now: NOW });
  assert.ok(codes(q).e.includes('DOC_TYPE'));
  const b2c = preflightEInvoice(invoice({ client: { ...invoice().client, gstin: '' } }), { now: NOW });
  assert.ok(codes(b2c).w.includes('B2C'));
});

test('credit note => CRN and wants a preceding doc', () => {
  const rec = invoice({ doc_type: 'CREDIT_NOTE', invoice_number: 'CRN/FY25-26/0001' });
  const r = preflightEInvoice(rec, { now: NOW });
  assert.equal(r.payload.DocDtls.Typ, 'CRN');
  assert.ok(codes(r).w.includes('PRECEDING_DOC'));
  const ok = preflightEInvoice(rec, { now: NOW, preceding: [{ no: 'inv/fy25-26/0001', date: '2025-06-01' }] });
  assert.deepEqual(ok.payload.PrecDocDtls, [{ InvNo: 'INV/FY25-26/0001', InvDt: '01/06/2025' }]);
  assert.ok(!codes(ok).w.includes('PRECEDING_DOC'));
});

test('tampered totals are flagged beyond the Rs 1 tolerance', () => {
  const { payload } = buildEInvoice(invoice());
  const slightly = structuredClone(payload);
  slightly.ValDtls.TotInvVal = 1180.9;
  assert.ok(!validateEInvoice(slightly, undefined, { now: NOW }).some((i) => i.code === 'SUM_TOTAL'));
  const way = structuredClone(payload);
  way.ValDtls.TotInvVal = 1183;
  assert.ok(validateEInvoice(way, undefined, { now: NOW }).some((i) => i.code === 'SUM_TOTAL'));
});

test('tax-type consistency: CGST on inter-state and IGST on intra-state', () => {
  const inter = invoice({ place_of_supply: '29', client: { ...invoice().client, gstin: BUYER_KA, state_code: '29' } });
  assert.ok(codes(preflightEInvoice(inter, { now: NOW })).e.includes('CGST_INTER'));
  const intra = invoice({ gst_mode: 'IGST' });
  const r = preflightEInvoice(intra, { now: NOW });
  assert.equal(r.payload.TranDtls.IgstOnIntra, 'Y');
  assert.ok(codes(r).w.includes('IGST_ON_INTRA'));
});

test('helpers: dates, units, stringify wraps in array', () => {
  assert.equal(toNicDate('2025-02-30'), '');
  assert.equal(toNicDate('2025-03-05'), '05/03/2025');
  assert.equal(mapUnitToUqc('kg'), 'KGS');
  assert.equal(mapUnitToUqc('MONTH'), 'OTH');
  assert.equal(mapUnitToUqc('SQF'), 'SQF');
  const json = JSON.parse(stringifyEInvoice(buildEInvoice(invoice()).payload));
  assert.ok(Array.isArray(json) && json.length === 1);
});

test('einvoice_meta upsert/validate', () => {
  const a: EInvoiceMeta = { invoice_id: 'a', irn: 'a'.repeat(64) };
  let rows = upsertMeta([], a);
  rows = upsertMeta(rows, { invoice_id: 'b', eway_no: '123456789012' });
  rows = upsertMeta(rows, { invoice_id: 'a', irn: 'f'.repeat(64), ack_no: '1' });
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.invoice_id === 'a')?.ack_no, '1');
  rows = upsertMeta(rows, { invoice_id: 'a' });
  assert.equal(rows.length, 1);
  assert.deepEqual(validateMeta({ irn: 'f'.repeat(64), ack_no: '112010012345678', eway_no: '123456789012' }), []);
  const bad = validateMeta({ irn: 'zz', ack_no: 'abc', eway_no: '12' }).map((i) => i.code);
  assert.deepEqual(bad.sort(), ['ACK_FORMAT', 'EWB_FORMAT', 'IRN_FORMAT']);
});
