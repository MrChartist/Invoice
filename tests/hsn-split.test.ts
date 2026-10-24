import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGstReport, type ReportPeriod } from '../src/lib/gst-reports.ts';
import { HSN_JSON_LAYOUT, buildGstr1Json, sectionCsv } from '../src/lib/gstr-json.ts';
import { hsnMinDigits, hsnTableSplit } from '../src/lib/tax-rules.ts';
import { gstinChecksumChar } from '../src/lib/gstin.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const g = (first14: string) => first14 + gstinChecksumChar(first14);
const FILER = g('27AAAAA0000A1Z'); // Maharashtra
const REG = g('07BBBBB1111B1Z'); // registered buyer, Delhi

const APR25: ReportPeriod = { kind: 'month', fyStart: 2025, month: 4 };
const DEC24: ReportPeriod = { kind: 'month', fyStart: 2024, month: 12 };

let seq = 0;
const item = (hsn: string, qty: number, rate: number, tax: number, unit = 'NOS') =>
  ({ id: `i${++seq}`, name: `Item ${hsn}`, type: 'goods', hsn, unit, quantity: qty, rate, tax_rate: tax, amount: qty * rate });

function inv(over: Record<string, unknown>) {
  return {
    id: `id-${++seq}`, invoice_number: `INV/FY25-26/${String(seq).padStart(4, '0')}`, doc_type: 'TAX_INVOICE',
    issue_date: '2025-04-05', status: 'Sent', currency: 'INR', template_id: 't',
    client: { name: 'Walk-in', email: '', address: '', city: '', zip: '' },
    sender: { companyGstin: FILER, stateCode: '27', companyName: 'Me' },
    items: [], gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false,
    discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0,
    ...over,
  } as unknown as InvoiceRecord;
}

type HsnJson = { hsn: Record<string, Array<Record<string, unknown>>> };

const regClient = { name: 'Delhi Co', gstin: REG, email: '', address: '', city: '', zip: '' };

function docs(date: string) {
  return [
    // B2B: registered buyer, inter-state, 10 x 1,000 @18%
    inv({ issue_date: date, gst_mode: 'IGST', place_of_supply: '07', client: regClient, items: [item('847130', 10, 1000, 18)] }),
    // B2C: unregistered intra-state, same HSN, 2 x 1,000 @18%
    inv({ issue_date: date, items: [item('847130', 2, 1000, 18)] }),
    // CDNR: credit note to the registered buyer, 1 x 1,000 @18% — nets in the B2B table
    inv({ issue_date: date, doc_type: 'CREDIT_NOTE', invoice_number: `CRN/${seq}`, gst_mode: 'IGST', place_of_supply: '07', client: regClient, items: [item('847130', 1, 1000, 18)] }),
    // Debit note to an unregistered buyer adds to the B2C table
    inv({ issue_date: date, doc_type: 'DEBIT_NOTE', invoice_number: `DBN/${seq}`, items: [item('847130', 1, 500, 18)] }),
  ];
}

test('hsnMinDigits: 4 up to ₹5 crore, 6 above (from 1 Apr 2021); older tiers before', () => {
  assert.equal(hsnMinDigits(0, '2025-04-01'), 4);
  assert.equal(hsnMinDigits(5e7, '2025-04-01'), 4); // ₹5 crore exactly is "up to"
  assert.equal(hsnMinDigits(5e7 + 1, '2025-04-01'), 6);
  assert.equal(hsnMinDigits(6e7, '2021-04-01'), 6);
  assert.equal(hsnMinDigits(6e7, '2021-03-31'), 4);
  assert.equal(hsnMinDigits(1e7, '2020-01-01'), 0);
  assert.equal(hsnMinDigits(3e7, '2020-01-01'), 2);
  assert.equal(hsnMinDigits(NaN, '2025-04-01'), 4);
});

test('hsnTableSplit: Table 12 is split from the January 2025 return period', () => {
  assert.equal(hsnTableSplit('2024-12-01'), false);
  assert.equal(hsnTableSplit('2025-01-01'), true);
});

test('HSN split: registered recipients (incl. their notes, with sign) in B2B, the rest in B2C', () => {
  const g1 = buildGstReport(docs('2025-04-05'), [], { period: APR25, gstin: FILER }).gstr1;
  assert.equal(g1.hsnSplit, true);
  assert.equal(g1.hsnB2b.length, 1);
  assert.equal(g1.hsnB2c.length, 1);
  const b2b = g1.hsnB2b[0];
  assert.deepEqual([b2b.hsn, b2b.qty, b2b.taxable, b2b.igst, b2b.cgst], ['847130', 9, 9000, 1620, 0]);
  const b2c = g1.hsnB2c[0];
  assert.deepEqual([b2c.qty, b2c.taxable, b2c.cgst, b2c.sgst, b2c.igst], [3, 2500, 225, 225, 0]);
  // The combined table is the sum of the two.
  const all = g1.hsn[0];
  assert.deepEqual([all.qty, all.taxable], [b2b.qty + b2c.qty, b2b.taxable + b2c.taxable]);
});

test('HSN split: exports and B2CL go to the B2C table', () => {
  const g1 = buildGstReport([
    inv({ gst_mode: 'IGST', place_of_supply: '96', items: [item('998314', 1, 5000, 18, 'HRS')] }),
    inv({ gst_mode: 'IGST', place_of_supply: '29', items: [item('847130', 1, 200000, 18)] }),
  ], [], { period: APR25, gstin: FILER }).gstr1;
  assert.equal(g1.hsnB2b.length, 0);
  assert.deepEqual(g1.hsnB2c.map((h) => h.hsn), ['847130', '998314']);
});

test('GSTR-1 JSON: split periods carry hsn_b2b / hsn_b2c (and the legacy data array per HSN_JSON_LAYOUT)', () => {
  const g1 = buildGstReport(docs('2025-04-05'), [], { period: APR25, gstin: FILER }).gstr1;
  const j = buildGstr1Json(g1) as unknown as HsnJson;
  assert.equal(j.hsn[HSN_JSON_LAYOUT.b2bKey].length, 1);
  assert.equal(j.hsn[HSN_JSON_LAYOUT.b2cKey].length, 1);
  assert.deepEqual(j.hsn.hsn_b2b[0], {
    num: 1, hsn_sc: '847130', desc: 'Item 847130', uqc: 'NOS', qty: 9, val: 10620, txval: 9000,
    iamt: 1620, camt: 0, samt: 0, csamt: 0, rt: 18,
  });
  assert.equal(j.hsn.hsn_b2c[0].num, 1); // numbering restarts per table
  assert.equal(Array.isArray(j.hsn.data), HSN_JSON_LAYOUT.legacy);
});

test('GSTR-1 JSON / CSV: periods before January 2025 keep the single table', () => {
  const g1 = buildGstReport(docs('2024-12-05'), [], { period: DEC24, gstin: FILER }).gstr1;
  assert.equal(g1.hsnSplit, false);
  const j = buildGstr1Json(g1) as unknown as HsnJson;
  assert.deepEqual(Object.keys(j.hsn), ['data']);
  assert.ok(sectionCsv(g1, 'hsn').startsWith('HSN/SAC,'));
});

test('HSN CSV for split periods has a Table column with B2B and B2C rows', () => {
  const g1 = buildGstReport(docs('2025-04-05'), [], { period: APR25, gstin: FILER }).gstr1;
  const lines = sectionCsv(g1, 'hsn').trim().split('\r\n');
  assert.ok(lines[0].startsWith('Table,HSN/SAC,'));
  assert.ok(lines[1].startsWith('B2B,847130,'));
  assert.ok(lines[2].startsWith('B2C,847130,'));
});

test('reconciliation: HSN with too few digits for the turnover', () => {
  const short = [inv({ items: [item('8471', 1, 1000, 18), item('84', 1, 100, 18)] })];
  const codes = (turnover?: number) =>
    buildGstReport(short, [], { period: APR25, gstin: FILER, turnover }).issues.filter((i) => i.code === 'HSN_DIGITS');
  // Up to ₹5 crore: 4 digits — only the 2-digit code is flagged.
  const small = codes(4e7);
  assert.equal(small.length, 1);
  assert.ok(small[0].message.includes('84') && !small[0].message.includes('8471'));
  // No turnover entered: treated as up to ₹5 crore.
  assert.equal(codes(undefined).length, 1);
  // Above ₹5 crore: 6 digits — both codes are flagged in one issue.
  const big = codes(6e7);
  assert.equal(big.length, 1);
  assert.ok(big[0].message.includes('8471, 84') && big[0].message.includes('6 digits'));
  // Six-digit codes pass at any turnover.
  const ok = buildGstReport([inv({ items: [item('847130', 1, 1000, 18)] })], [], { period: APR25, gstin: FILER, turnover: 6e7 });
  assert.equal(ok.issues.filter((i) => i.code === 'HSN_DIGITS').length, 0);
  assert.equal(ok.gstr1.hsnMinDigits, 6);
});
