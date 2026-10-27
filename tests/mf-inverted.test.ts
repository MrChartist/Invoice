/**
 * MF-C5 Rule 89(5) working paper: the formula on a fixture (before and after N 14/2022), input services and capital
 * goods out of net ITC, credit notes and financial notes, exclusions, the default inverted rates, and the register
 * pre-fill (a DRAFT `INVERTED_DUTY` claim).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { inwardLines, outwardLines, rule895, suggestInvertedRates } from '../src/lib/mfg/mf-inverted.ts';
import { loadRefunds } from '../src/lib/gst-cash-refunds.ts';
import { prefillInvertedClaim } from '../src/lib/mfg/mf-inverted.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const inv = (id: string, rate: number, amount: number, extra: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id, invoice_number: id, issue_date: '2026-08-10', doc_type: 'TAX_INVOICE', status: 'Unpaid', supply_type: 'B2B', gst_mode: 'CGST_SGST', place_of_supply: '27',
  sender: { stateCode: '27' } as never, client: { name: 'Buyer', state_code: '27' } as never,
  items: [{ id: `${id}l`, name: 'Fabric', hsn: '5407', quantity: 1, rate: amount, tax_rate: rate }], ...extra,
} as InvoiceRecord);
const bill = (id: string, rate: number, taxable: number, extra: Record<string, unknown> = {}) => ({
  id, kind: 'PURCHASE', vendor_name: 'Mill', bill_number: id, date: '2026-08-05', category: 'Purchases', itc_eligible: true,
  lines: [{ id: `${id}l`, name: 'MMF yarn', hsn: '5402', quantity: 1, rate: taxable, tax_rate: rate }], taxable, cgst: (taxable * rate) / 200, sgst: (taxable * rate) / 200, igst: 0,
  total: taxable * (1 + rate / 100), amount_paid: 0, ...extra,
});

const invoices = [inv('S1', 5, 1000000), inv('S2', 18, 200000), inv('CN1', 5, 100000, { doc_type: 'CREDIT_NOTE' }), inv('FN', 0, 5000, { doc_type: 'CREDIT_NOTE', note_kind: 'financial' } as never), inv('Q', 5, 999, { doc_type: 'QUOTATION' }), inv('OLD', 5, 50, { issue_date: '2026-06-30' })];
const purchases = [bill('B1', 12, 800000), bill('SV', 18, 50000, { lines: [{ id: 'svl', name: 'Freight', hsn: '996511', quantity: 1, rate: 50000, tax_rate: 18 }] }), bill('CG', 18, 100000, { itc_use: 'common_capital' }), bill('NO', 12, 10000, { itc_eligible: false })];

test('outward and inward lines of the period (credit notes negative, financial notes and quotes out; services / capital flagged)', () => {
  const o = outwardLines(invoices, '2026-07-01', '2026-09-30');
  assert.deepEqual(o.map((l) => [l.doc, l.rate, l.taxable]), [['S1', 5, 1000000], ['S2', 18, 200000], ['CN1', 5, -100000]]);
  const i = inwardLines(purchases, '2026-07-01', '2026-09-30');
  assert.deepEqual(i.map((l) => [l.doc, l.tax, !!l.service, !!l.capital]), [['B1', 96000, false, false], ['SV', 9000, true, false], ['CG', 18000, false, true]]);
  assert.deepEqual(suggestInvertedRates(o, i), [5]);
});

test('Rule 89(5) from 5 Jul 2022: (inverted turnover × net ITC ÷ ATT) − tax payable × net ITC ÷ ITC availed', () => {
  const o = outwardLines(invoices, '2026-07-01', '2026-09-30');
  const i = inwardLines(purchases, '2026-07-01', '2026-09-30');
  const r = rule895(o, i, [5], '2026-09-30');
  // inverted 900,000; ATT 1,100,000; net ITC 96,000 (inputs only); availed 105,000 (inputs + services); tax 45,000.
  assert.deepEqual([r.invertedTurnover, r.att, r.netItc, r.itcAvailed, r.taxPayable], [900000, 1100000, 96000, 105000, 45000]);
  assert.equal(r.first, 78545.45);
  assert.equal(r.second, 41142.86);
  assert.equal(r.refund, 37402.59);
  const old = rule895(o, i, [5], '2022-06-30');
  assert.equal(old.second, 45000, 'before N 14/2022 the tax payable is deducted in full');
  const ex = rule895(o, i, [5], '2026-09-30', new Set(['CN1']));
  assert.equal(ex.invertedTurnover, 1000000, 'an excluded document drops out');
  assert.match(r.notes.join(' '), /MF26/);
  assert.equal(rule895([], i, [5], '2026-09-30').refund, 0);
});

test('the result pre-fills a DRAFT inverted-duty claim in the refund register', () => {
  const row = prefillInvertedClaim({ from: '2026-07-01', to: '2026-09-30', refund: 37402.59, notes: 'Rule 89(5) working paper' });
  assert.deepEqual([row.category, row.status, row.claimed.cgst + row.claimed.sgst, row.period_to], ['INVERTED_DUTY', 'DRAFT', 37402.59, '2026-09-30']);
  assert.equal(loadRefunds().length, 1);
});
