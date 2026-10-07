import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGstReport,
  computeSetOff,
  inPeriod,
  normalizePurchase,
  periodFp,
  periodForDate,
  periodLabel,
  periodRange,
  toGstnDate,
  toUqc,
  type ReportPeriod,
} from '../src/lib/gst-reports.ts';
import { buildGstr1Json, csvCell, gstr3bCsv, sectionCsv, buildSummaryHtml, toCsv } from '../src/lib/gstr-json.ts';
import { gstinChecksumChar, isValidGstin } from '../src/lib/gstin.ts';

const g = (first14: string) => first14 + gstinChecksumChar(first14);
const FILER = g('27AAAAA0000A1Z'); // Maharashtra
const DELHI_CLIENT = g('07BBBBB1111B1Z'); // Delhi
const MH_SUPPLIER = g('27CCCCC2222C1Z');
const DL_SUPPLIER = g('07DDDDD3333D1Z');

const PERIOD: ReportPeriod = { kind: 'month', fyStart: 2025, month: 4 }; // April 2025

let seq = 0;
function item(name: string, qty: number, rate: number, tax: number, hsn = '9983', unit = 'NOS') {
  return { id: `i${++seq}`, name, type: 'service', hsn, unit, quantity: qty, rate, tax_rate: tax, amount: qty * rate };
}

function inv(over: Record<string, unknown>) {
  const base = {
    id: `id-${++seq}`,
    invoice_number: '',
    doc_type: 'TAX_INVOICE',
    issue_date: '2025-04-05',
    due_date: '2025-04-20',
    status: 'Sent',
    currency: 'INR',
    template_id: 't',
    client: { name: 'Buyer', email: '', address: '', city: '', zip: '' },
    sender: { companyGstin: FILER, stateCode: '27', companyName: 'Me' },
    items: [],
    gst_mode: 'CGST_SGST',
    place_of_supply: '27',
    reverse_charge: false,
    discount_type: 'PERCENT',
    discount_rate: 0,
    tax_rate: 0,
    shipping: 0,
    other_charges: 0,
    round_off_enabled: false,
    amount_paid: 0,
  };
  return { ...base, ...over } as any;
}

const invoices = [
  // 1: B2B inter-state, IGST 18% on 10,000
  inv({
    id: 'a1', invoice_number: 'INV/FY25-26/0001', issue_date: '2025-04-05', gst_mode: 'IGST', place_of_supply: '07',
    client: { name: 'Delhi Co', gstin: DELHI_CLIENT, email: '', address: '', city: '', zip: '' },
    items: [item('Laptops', 10, 1000, 18, '8471')], total: 11800,
  }),
  // 2: B2CS intra 27 — 5,000 @12% + 2,000 nil
  inv({
    id: 'a2', invoice_number: 'INV/FY25-26/0002', issue_date: '2025-04-10',
    items: [item('Advice', 1, 5000, 12), item('Free tier', 1, 2000, 0)], total: 7600,
  }),
  // 3: B2CL — inter-state unregistered 3,00,000 @18%
  inv({
    id: 'a3', invoice_number: 'INV/FY25-26/0003', issue_date: '2025-04-12', gst_mode: 'IGST', place_of_supply: '29',
    items: [item('Project', 1, 300000, 18)], total: 354000,
  }),
  // 4: B2CS inter 29 18%
  inv({
    id: 'a4', invoice_number: 'INV/FY25-26/0004', issue_date: '2025-04-14', gst_mode: 'IGST', place_of_supply: '29',
    items: [item('Small job', 1, 10000, 18)], total: 11800,
  }),
  // 5: draft (excluded, consumes a number), 6: cancelled
  inv({ id: 'a5', invoice_number: 'INV/FY25-26/0005', status: 'Draft', items: [item('x', 1, 100, 18)] }),
  inv({ id: 'a6', invoice_number: 'INV/FY25-26/0006', status: 'Cancelled', items: [item('x', 1, 100, 18)] }),
  // 7: export with IGST (LUT-less)
  inv({
    id: 'a7', invoice_number: 'INV/FY25-26/0007', issue_date: '2025-04-20', gst_mode: 'IGST', place_of_supply: '96',
    items: [item('Export service', 1, 20000, 18)], total: 23600,
  }),
  // credit note against B2CS intra: 1,000 @12%
  inv({
    id: 'c1', invoice_number: 'CRN/FY25-26/0001', doc_type: 'CREDIT_NOTE', issue_date: '2025-04-25',
    items: [item('Refund', 1, 1000, 12)], total: 1120,
  }),
  // non-tax documents and out-of-period doc
  inv({ id: 'q1', invoice_number: 'QTN/FY25-26/0001', doc_type: 'QUOTATION', items: [item('q', 1, 99999, 18)] }),
  inv({ id: 'p1', invoice_number: 'PRO/FY25-26/0001', doc_type: 'PROFORMA', items: [item('p', 1, 99999, 18)] }),
  inv({ id: 'm1', invoice_number: 'INV/FY25-26/0008', issue_date: '2025-05-02', items: [item('may', 1, 1000, 18)] }),
];

const purchases = [
  { id: 'p-a', bill_number: 'B1', bill_date: '2025-04-03', supplier_gstin: MH_SUPPLIER, taxable_value: 10000, cgst_amount: 900, sgst_amount: 900, igst_amount: 0 },
  { id: 'p-b', bill_number: 'B2', bill_date: '2025-04-04', supplier: { gstin: DL_SUPPLIER }, taxable_value: 20000, igst_amount: 2000 },
  { id: 'p-c', bill_number: 'B3', bill_date: '2025-04-06', supplier_gstin: MH_SUPPLIER, taxable_value: 5000, igst_amount: 500, itc_eligible: false },
  { id: 'p-d', bill_number: 'B4', bill_date: '2025-04-07', taxable_value: 2000, tax_amount: 360, reverse_charge: true, place_of_supply: '27' },
  { id: 'p-e', bill_number: 'B5', bill_date: '2025-04-08', status: 'Draft', taxable_value: 99999, igst_amount: 9999 },
  { id: 'p-f', bill_number: 'B6', bill_date: '2025-05-08', taxable_value: 1000, igst_amount: 180 },
];

test('fixture GSTINs are valid', () => {
  for (const x of [FILER, DELHI_CLIENT, MH_SUPPLIER, DL_SUPPLIER]) assert.ok(isValidGstin(x), x);
});

/* ── periods ── */
test('periodRange: month, quarter, FY (Indian FY aware)', () => {
  assert.deepEqual(periodRange({ kind: 'month', fyStart: 2025, month: 2 }), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(periodRange({ kind: 'month', fyStart: 2023, month: 2 }), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(periodRange({ kind: 'quarter', fyStart: 2025, quarter: 4 }), { from: '2026-01-01', to: '2026-03-31' });
  assert.deepEqual(periodRange({ kind: 'quarter', fyStart: 2025, quarter: 1 }), { from: '2025-04-01', to: '2025-06-30' });
  assert.deepEqual(periodRange({ kind: 'fy', fyStart: 2025 }), { from: '2025-04-01', to: '2026-03-31' });
});

test('periodFp / label / periodForDate', () => {
  assert.equal(periodFp(PERIOD), '042025');
  assert.equal(periodFp({ kind: 'quarter', fyStart: 2025, quarter: 4 }), '032026');
  assert.equal(periodFp({ kind: 'fy', fyStart: 2025 }), '032026');
  assert.equal(periodLabel({ kind: 'fy', fyStart: 2025 }), 'FY 25-26');
  assert.equal(periodLabel(PERIOD), 'April 2025');
  assert.deepEqual(periodForDate('quarter', '2026-02-10'), { kind: 'quarter', fyStart: 2025, quarter: 4 });
  assert.deepEqual(periodForDate('month', '2026-03-31'), { kind: 'month', fyStart: 2025, month: 3 });
  assert.deepEqual(periodForDate('fy', '2025-03-31'), { kind: 'fy', fyStart: 2024 });
});

test('inPeriod is inclusive of boundary dates and tolerates ISO timestamps', () => {
  assert.ok(inPeriod('2025-04-30', PERIOD));
  assert.ok(inPeriod('2025-04-01T10:00:00.000Z', PERIOD));
  assert.ok(!inPeriod('2025-05-01', PERIOD));
  assert.ok(!inPeriod(undefined, PERIOD));
  assert.equal(toGstnDate('2025-04-09'), '09-04-2025');
});

test('toUqc maps units; SAC is NA', () => {
  assert.equal(toUqc('KG', '1001'), 'KGS');
  assert.equal(toUqc('HRS', '1001'), 'OTH');
  assert.equal(toUqc('NOS', '998314'), 'NA');
});

/* ── GSTR-1 ── */
const rep = buildGstReport(invoices, purchases, { period: PERIOD, gstin: FILER });
const g1 = rep.gstr1;

test('GSTR-1: excluded documents and counts', () => {
  assert.deepEqual(g1.counts, { included: 6, drafts: 1, cancelled: 1, notTaxDocs: 2 });
});

test('GSTR-1: B2B invoice-wise', () => {
  assert.equal(g1.b2b.length, 1);
  const r = g1.b2b[0];
  assert.equal(r.ctin, DELHI_CLIENT);
  assert.equal(r.number, 'INV/FY25-26/0001');
  assert.equal(r.taxable, 10000);
  assert.equal(r.igst, 1800);
  assert.equal(r.value, 11800);
  assert.deepEqual(r.items.map((i) => [i.rate, i.txval, i.igst]), [[18, 10000, 1800]]);
});

test('GSTR-1: B2CL only for unregistered inter-state above 2.5 lakh', () => {
  assert.equal(g1.b2cl.length, 1);
  assert.equal(g1.b2cl[0].number, 'INV/FY25-26/0003');
  assert.equal(g1.b2cl[0].taxable, 300000);
  assert.equal(g1.b2cl[0].igst, 54000);
  assert.ok(rep.issues.some((i) => i.code === 'B2CL_REVIEW' && i.invoiceId === 'a3'));
});

test('GSTR-1: B2CS aggregated by POS and rate, net of credit note', () => {
  const intra = g1.b2cs.find((r) => r.supply === 'INTRA' && r.pos === '27' && r.rate === 12)!;
  assert.deepEqual([intra.txval, intra.cgst, intra.sgst, intra.igst], [4000, 240, 240, 0]); // 5000-1000, 300-60
  const inter = g1.b2cs.find((r) => r.supply === 'INTER' && r.pos === '29' && r.rate === 18)!;
  assert.deepEqual([inter.txval, inter.igst], [10000, 1800]);
  assert.equal(g1.b2cs.length, 2); // nil line and export are not in B2CS
});

test('GSTR-1: exports, nil table', () => {
  assert.equal(g1.exp.length, 1);
  assert.equal(g1.exp[0].expType, 'WPAY');
  assert.equal(g1.exp[0].igst, 3600);
  assert.deepEqual(g1.nil, [{ type: 'INTRAB2C', nil: 2000, exempt: 0, nonGst: 0 }]);
  assert.equal(g1.cdnr.length + g1.cdnur.length, 0);
});

test('GSTR-1: HSN summary nets credit notes', () => {
  const h = g1.hsn.find((x) => x.hsn === '9983' && x.rate === 12)!;
  assert.equal(h.uqc, 'NA');
  assert.deepEqual([h.taxable, h.cgst, h.sgst, h.value], [4000, 240, 240, 4480]);
  const laptops = g1.hsn.find((x) => x.hsn === '8471')!;
  assert.deepEqual([laptops.qty, laptops.taxable, laptops.igst, laptops.uqc], [10, 10000, 1800, 'NOS']);
});

test('GSTR-1: document issued summary counts cancelled + draft numbers', () => {
  const inv_ = g1.docIssue.find((d) => d.docType === 'Invoices for outward supply')!;
  assert.deepEqual([inv_.from, inv_.to, inv_.total, inv_.cancelled, inv_.netIssued], ['INV/FY25-26/0001', 'INV/FY25-26/0007', 7, 2, 5]);
  const cn = g1.docIssue.find((d) => d.docType === 'Credit Note')!;
  assert.deepEqual([cn.total, cn.cancelled, cn.netIssued], [1, 0, 1]);
  assert.equal(g1.docIssue.length, 2); // quotation/proforma never listed
});

test('GSTR-1: totals', () => {
  assert.deepEqual(g1.totals, { taxable: 346000, igst: 61200, cgst: 240, sgst: 240, value: 11800 + 7600 + 354000 + 11800 + 23600 - 1120 });
});

/* ── GSTR-3B ── */
const b = rep.gstr3b;

test('GSTR-3B 3.1 outward tables', () => {
  assert.deepEqual(b.outward.taxable, { taxable: 324000, igst: 57600, cgst: 240, sgst: 240, cess: 0 });
  assert.deepEqual(b.outward.zeroRated, { taxable: 20000, igst: 3600, cgst: 0, sgst: 0, cess: 0 });
  assert.deepEqual(b.outward.nilExempt, { inter: 0, intra: 2000 });
  assert.deepEqual(b.outward.inwardRcm, { taxable: 2000, igst: 0, cgst: 180, sgst: 180, cess: 0 });
  assert.deepEqual(b.interStateUnreg, [{ pos: '29', taxable: 310000, igst: 55800 }]);
});

test('GSTR-3B 4: ITC from eligible purchases only, in-period non-draft', () => {
  assert.equal(b.purchasesConsidered, 4);
  assert.deepEqual(b.itc.availableOther, { igst: 2000, cgst: 900, sgst: 900, cess: 0 });
  assert.deepEqual(b.itc.availableRcm, { igst: 0, cgst: 180, sgst: 180, cess: 0 });
  assert.deepEqual(b.itc.ineligible, { igst: 500, cgst: 0, sgst: 0, cess: 0 });
  assert.deepEqual(b.itc.net, { igst: 2000, cgst: 1080, sgst: 1080, cess: 0 });
});

test('GSTR-3B 6.1: set-off ordering and cash', () => {
  const p = b.payment;
  assert.deepEqual(p.liability, { igst: 61200, cgst: 240, sgst: 240 });
  // IGST ITC 2000 -> IGST; CGST ITC: 240 CGST then 840 IGST; SGST ITC likewise.
  assert.equal(p.itcUsed.igst.igst, 2000);
  assert.deepEqual(p.itcUsed.cgst, { cgst: 240, igst: 840 });
  assert.deepEqual(p.itcUsed.sgst, { sgst: 240, igst: 840 });
  assert.deepEqual(p.cash, { igst: 57520, cgst: 180, sgst: 180 }); // RCM paid in cash
  assert.deepEqual(p.itcCarry, { igst: 0, cgst: 0, sgst: 0 });
});

test('computeSetOff: IGST credit spills into CGST then SGST', () => {
  const r = computeSetOff({ igst: 100, cgst: 50, sgst: 50 }, { igst: 120, cgst: 30, sgst: 40 });
  assert.deepEqual(r.itcUsed.igst, { igst: 100, cgst: 20, sgst: 0 });
  assert.deepEqual(r.itcUsed.cgst, { cgst: 30, igst: 0 });
  assert.deepEqual(r.itcUsed.sgst, { sgst: 40, igst: 0 });
  assert.deepEqual(r.cash, { igst: 0, cgst: 0, sgst: 10 });
});

test('computeSetOff: CGST credit cannot pay SGST; surplus carries forward', () => {
  const r = computeSetOff({ igst: 100, cgst: 0, sgst: 100 }, { igst: 0, cgst: 150, sgst: 20 });
  assert.deepEqual(r.itcUsed.cgst, { cgst: 0, igst: 100 });
  assert.deepEqual(r.itcUsed.sgst, { sgst: 20, igst: 0 });
  assert.deepEqual(r.cash, { igst: 0, cgst: 0, sgst: 80 });
  assert.deepEqual(r.itcCarry, { igst: 0, cgst: 50, sgst: 0 });
});

test('computeSetOff: reverse-charge liability is cash only', () => {
  const r = computeSetOff({ igst: 0, cgst: 0, sgst: 0 }, { igst: 500, cgst: 500, sgst: 500 }, { igst: 90, cgst: 0, sgst: 0 });
  assert.deepEqual(r.cash, { igst: 90, cgst: 0, sgst: 0 });
  assert.deepEqual(r.itcCarry, { igst: 500, cgst: 500, sgst: 500 });
});

/* ── purchases ── */
test('normalizePurchase: splits tax_amount by supplier vs filer state; drops drafts', () => {
  const intra = normalizePurchase({ bill_date: '2025-04-01', supplier_gstin: MH_SUPPLIER, taxable_value: 1000, tax_amount: 181 }, '27')!;
  assert.deepEqual([intra.cgst, intra.sgst, intra.igst], [90.5, 90.5, 0]);
  const inter = normalizePurchase({ bill_date: '2025-04-01', supplier_gstin: DL_SUPPLIER, taxable_value: 1000, tax_amount: 180 }, '27')!;
  assert.deepEqual([inter.igst, inter.cgst], [180, 0]);
  assert.equal(normalizePurchase({ bill_date: '2025-04-01', status: 'Cancelled' }, '27'), null);
  assert.equal(normalizePurchase(null, '27'), null);
  assert.equal(normalizePurchase({ taxable_value: 5 }, '27'), null);
});

test('ITC reversal reduces net ITC pro rata', () => {
  const r = buildGstReport([], [
    { bill_date: '2025-04-03', supplier_gstin: MH_SUPPLIER, taxable_value: 1000, cgst_amount: 90, sgst_amount: 90, itc_reversed: 90 },
  ], { period: PERIOD, gstin: FILER });
  assert.deepEqual(r.gstr3b.itc.reversedOther, { igst: 0, cgst: 45, sgst: 45, cess: 0 });
  assert.deepEqual(r.gstr3b.itc.net, { igst: 0, cgst: 45, sgst: 45, cess: 0 });
});

test('absent / empty purchases are fine', () => {
  const r = buildGstReport(invoices, [], { period: PERIOD, gstin: FILER });
  assert.equal(r.gstr3b.purchasesConsidered, 0);
  assert.ok(r.issues.some((i) => i.code === 'NO_PURCHASES'));
  assert.equal(r.gstr3b.payment.cash.igst, 61200);
});

/* ── reconciliation ── */
test('reconciliation: invalid GSTIN, missing POS, missing HSN, missing client GSTIN for B2CL', () => {
  const bad = [
    inv({
      id: 'x1', invoice_number: 'INV/FY25-26/0010', gst_mode: 'IGST', place_of_supply: '',
      client: { name: 'Bad', gstin: '07AAAAA1234A1Z0', state_code: '07', email: '', address: '', city: '', zip: '' },
      items: [item('No code', 1, 100, 18, '')],
    }),
  ];
  const r = buildGstReport(bad, [], { period: PERIOD, gstin: FILER });
  const codes = r.issues.map((i) => i.code);
  assert.ok(codes.includes('GSTIN_INVALID'));
  assert.ok(codes.includes('POS_MISSING'));
  assert.ok(codes.includes('HSN_MISSING'));
  assert.equal(r.issues[0].severity, 'error'); // errors sort first
  assert.ok(r.issues.find((i) => i.code === 'GSTIN_INVALID')!.link === '/clients');
  // invalid GSTIN => treated as unregistered; POS inferred 07 (client state) => inter-state B2CS
  assert.equal(r.gstr1.b2b.length, 0);
  assert.equal(r.gstr1.b2cs[0].pos, '07');
});

test('mode mismatch warning and legacy SINGLE mode split by state', () => {
  const r = buildGstReport([
    inv({ id: 'y1', invoice_number: 'INV/FY25-26/0020', gst_mode: 'SINGLE', place_of_supply: '27', items: [item('a', 1, 1000, 18)] }),
    inv({ id: 'y2', invoice_number: 'INV/FY25-26/0021', gst_mode: 'CGST_SGST', place_of_supply: '07', items: [item('b', 1, 1000, 18)] }),
  ], [], { period: PERIOD, gstin: FILER });
  const intra = r.gstr1.b2cs.find((x) => x.supply === 'INTRA' && x.pos === '27')!;
  assert.deepEqual([intra.cgst, intra.sgst, intra.igst], [90, 90, 0]);
  assert.ok(r.issues.some((i) => i.code === 'MODE_MISMATCH' && i.invoiceId === 'y2'));
});

test('invoices of another GSTIN are skipped when a filer GSTIN is chosen', () => {
  const other = g('29EEEEE4444E1Z');
  const r = buildGstReport([
    inv({ id: 'z1', invoice_number: 'A/1', sender: { companyGstin: other, stateCode: '29' }, items: [item('a', 1, 1000, 18)] }),
    inv({ id: 'z2', invoice_number: 'B/1', items: [item('a', 1, 1000, 18)] }),
  ], [], { period: PERIOD, gstin: FILER });
  assert.equal(r.gstr1.counts.included, 1);
});

test('reverse-charge outward invoices are tagged in B2B but kept out of 3.1(a)', () => {
  const r = buildGstReport([
    inv({
      id: 'r1', invoice_number: 'INV/FY25-26/0030', reverse_charge: true, gst_mode: 'IGST', place_of_supply: '07',
      client: { name: 'D', gstin: DELHI_CLIENT, email: '', address: '', city: '', zip: '' }, items: [item('GTA', 1, 1000, 5)],
    }),
  ], [], { period: PERIOD, gstin: FILER });
  assert.equal(r.gstr1.b2b[0].rchrg, 'Y');
  assert.equal(r.gstr3b.outward.taxable.taxable, 0);
  assert.equal(r.gstr3b.outwardRcmTaxable, 1000);
});

test('no sender GSTIN: nil lines are non-GST supplies', () => {
  const r = buildGstReport([
    inv({ id: 'n1', invoice_number: 'INV/FY25-26/0040', sender: { companyGstin: '' }, gst_mode: 'NONE', items: [item('a', 1, 1000, 0)] }),
  ], [], { period: PERIOD });
  assert.deepEqual(r.gstr1.nil, [{ type: 'INTRAB2C', nil: 0, exempt: 0, nonGst: 1000 }]);
  assert.equal(r.gstr3b.outward.nonGst, 1000);
  assert.equal(r.gstr1.hsn.length, 0);
});

/* ── exports ── */
test('GSTR-1 JSON structure', () => {
  const j = buildGstr1Json(g1) as any;
  assert.equal(j.gstin, FILER);
  assert.equal(j.fp, '042025');
  assert.equal(j.b2b[0].ctin, DELHI_CLIENT);
  assert.deepEqual(j.b2b[0].inv[0], {
    inum: 'INV/FY25-26/0001', idt: '05-04-2025', val: 11800, pos: '07', rchrg: 'N', inv_typ: 'R',
    itms: [{ num: 1801, itm_det: { rt: 18, txval: 10000, iamt: 1800, csamt: 0 } }],
  });
  assert.equal(j.b2cl[0].pos, '29');
  assert.equal(j.b2cl[0].inv[0].val, 354000);
  const intra = j.b2cs.find((x: any) => x.sply_ty === 'INTRA');
  assert.deepEqual(intra, { sply_ty: 'INTRA', rt: 12, typ: 'OE', pos: '27', txval: 4000, camt: 240, samt: 240, csamt: 0 });
  assert.equal(j.exp[0].exp_typ, 'WPAY');
  assert.deepEqual(j.nil.inv, [{ sply_ty: 'INTRAB2C', expt_amt: 0, nil_amt: 2000, ngsup_amt: 0 }]);
  assert.equal(j.hsn.data[0].num, 1);
  assert.deepEqual(j.doc_issue.doc_det[0].docs[0], { num: 1, from: 'INV/FY25-26/0001', to: 'INV/FY25-26/0007', totnum: 7, cancel: 2, net_issue: 5 });
  assert.equal(j.cdnr, undefined); // empty sections omitted
  JSON.stringify(j);
});

test('CSV escaping and formula-injection guard', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell(-5), '-5');
  assert.equal(toCsv([['a', 1], ['b', 2]]), 'a,1\r\nb,2\r\n');
});

test('section CSVs and 3B CSV render', () => {
  const b2b = sectionCsv(g1, 'b2b').trim().split('\r\n');
  assert.equal(b2b.length, 2);
  assert.ok(b2b[1].startsWith(`${DELHI_CLIENT},Delhi Co,INV/FY25-26/0001,2025-04-05,11800,07,N,18,10000,1800,0,0,0`));
  assert.ok(sectionCsv(g1, 'hsn').includes('8471'));
  assert.ok(sectionCsv(g1, 'docs').includes('INV/FY25-26/0007'));
  assert.ok(gstr3bCsv(rep.gstr3b).includes('6.1'));
});

test('printable summary escapes content and carries the CA disclaimer', () => {
  const html = buildSummaryHtml(rep, 'April 2025 <b>', 'A & B');
  assert.ok(html.includes('Verify with your CA'));
  assert.ok(html.includes('&lt;b&gt;'));
  assert.ok(html.includes('A &amp; B'));
});
