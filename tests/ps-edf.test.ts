/** R14 PS-C2: EDF register — due dates, software vs services, small-value declaration, SOFTEX history, once-only drafts. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { EDF_TABLE, edfDb, edfDue, edfDueList, edfKindOf, prepareEdf } from '../src/lib/prof/ps-edf.ts';
import { EDF_RULES } from '../src/lib/prof/ps-c-rules.ts';
import { getTable } from '../src/lib/storage.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const line = (hsn: string) => [{ id: 'l', name: 'x', type: 'Service', hsn, quantity: 1, rate: 1, tax_rate: 0, amount: 1 }] as InvoiceRecord['items'];
const exp = (id: string, over: Partial<InvoiceRecord> = {}): Partial<InvoiceRecord> => ({
  id, invoice_number: `EXP/${id}`, doc_type: 'INVOICE', status: 'Sent', supply_type: 'EXPORT_LUT', place_of_supply: '96', currency: 'USD', exchange_rate: 84,
  total: 5000, issue_date: '2026-10-20', items: line('998314'), ...over,
});

test('due: 30 days after the end of the invoice month; services may file by the receipt date; none before 1 Oct 2026', () => {
  assert.equal(edfDue('software', '2026-10'), '2026-11-30');
  assert.equal(edfDue('services', '2026-11'), '2026-12-30');
  assert.equal(edfDue('services', '2026-10', '2026-11-05'), '2026-11-05');
  assert.equal(edfDue('software', '2026-10', '2026-11-05'), '2026-11-30', 'software: month end + 30 only');
  assert.equal(edfDue('software', '2026-09'), null);
  assert.ok(EDF_RULES.every((r) => r.from && r.source && typeof r.verified === 'boolean'));
});

test('builder: the month’s services exports by kind and currency; ≤ ₹10 lakh each → declaration allowed', () => {
  const invoices = [
    exp('a'), exp('b', { total: 15000 }), exp('c', { items: line('998311'), currency: 'EUR', exchange_rate: 90, total: 1000 }),
    exp('d', { issue_date: '2026-11-02' }), exp('e', { status: 'Draft' }), exp('f', { supply_type: 'B2B', place_of_supply: '27' }),
    exp('g', { items: [{ ...line('5205')[0], type: 'Product' }] as InvoiceRecord['items'] }),
  ];
  const d = prepareEdf('2026-10', invoices);
  assert.deepEqual(d.map((x) => [x.kind, x.currency, x.invoice_ids.join(','), x.value_fc, x.value_inr, x.due, x.small]), [
    ['services', 'EUR', 'c', 1000, 90000, '2026-11-30', true],
    ['software', 'USD', 'a,b', 20000, 1680000, '2026-11-30', false], // 15,000 × 84 = ₹12.6 lakh > ₹10 lakh
  ]);
  assert.equal(edfKindOf({ items: line('997331') }), 'software');
  assert.deepEqual(prepareEdf('2026-09', [exp('s', { issue_date: '2026-09-10' })]), []);
});

test('register: drafts written once, filed, closed on declaration only when small; SOFTEX history only before Oct 2026', () => {
  const invoices = [exp('a'), exp('c', { items: line('998311'), total: 1000 })];
  const first = edfDb.saveDrafts('2026-10', prepareEdf('2026-10', invoices));
  assert.equal(first.length, 2);
  assert.equal(edfDb.saveDrafts('2026-10', prepareEdf('2026-10', invoices)).length, 0, 'second run adds nothing');
  const sw = first.find((r) => r.kind === 'software')!;
  assert.deepEqual([sw.authority, sw.status, sw.date, sw.due], ['stpi', 'due', '2026-10-31', '2026-11-30']);
  assert.deepEqual(edfDueList(edfDb.all(), '2026-11-05').map((r) => r.id).length, 2);
  assert.equal(edfDb.save({ id: sw.id, edf_no: 'EDF123', filed_on: '2026-11-20' }).status, 'filed');
  const sv = first.find((r) => r.kind === 'services')!;
  assert.equal(edfDb.save({ id: sv.id, small_value_declared: true }).status, 'closed');
  assert.equal(edfDueList(edfDb.all(), '2026-11-05').length, 0);
  const big = edfDb.saveDrafts('2026-11', prepareEdf('2026-11', [exp('z', { issue_date: '2026-11-03', total: 20000 })]))[0];
  assert.throws(() => edfDb.save({ id: big.id, small_value_declared: true }), /edfNotSmall/);
  assert.equal(edfDb.addSoftex({ period: '2026-08', currency: 'USD', value_fc: 100, value_inr: 8400, edf_no: 'SOFTEX1' }).kind, 'softex');
  assert.throws(() => edfDb.addSoftex({ period: '2026-10', currency: 'USD', value_fc: 1, value_inr: 1 }), /edfSoftexAfter/);
  edfDb.remove(big.id);
  assert.equal(getTable(EDF_TABLE).length, 3);
});
