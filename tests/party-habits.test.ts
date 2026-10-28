/**
 * R3-B6 repeat last bill and usual items.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';

const ph = await import('../src/lib/party-habits.ts');
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';

let n = 0;
const nid = () => `n${++n}`;
const line = (name: string, over: Partial<InvoiceItem> = {}): InvoiceItem => ({ id: nid(), name, type: 'Product', quantity: 1, rate: 100, amount: 100, tax_rate: 18, ...over });
const inv = (over: Partial<InvoiceRecord> & { items: InvoiceItem[] }): InvoiceRecord => ({
  id: nid(), invoice_number: `INV/${n}`, doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-10-01', client: { id: 'shop1', name: 'Gupta Stores', email: '', address: '', city: '', zip: '' },
  ...over,
} as InvoiceRecord);
const party = { id: 'shop1', name: 'Gupta Stores' };

test('ranking by frequency × recency over 180 days', () => {
  const docs = [
    inv({ issue_date: '2026-10-20', items: [line('Soap'), line('Rice', { quantity: 5 })] }),
    inv({ issue_date: '2026-10-13', items: [line('Soap'), line('Rice', { quantity: 4 })] }),
    inv({ issue_date: '2026-10-06', items: [line('Soap'), line('Soap', { quantity: 2 })] }), // counted once per bill
    inv({ issue_date: '2026-05-01', items: [line('Oil')] }), // 171 days ago — nearly worthless
    inv({ issue_date: '2026-01-01', items: [line('Ghee')] }), // outside the window
  ];
  const u = ph.usualItems(docs, party, '2026-10-21');
  assert.deepEqual(u.map((x) => x.name), ['Soap', 'Rice', 'Oil']);
  assert.equal(u[0].count, 3);
  assert.equal(u[1].last_qty, 5, 'last quantity');
  assert.ok(u[0].score > u[1].score && u[1].score > u[2].score);
  assert.equal(ph.usualItems(docs, party, '2026-10-21', { limit: 1 }).length, 1);
});

test('excludes cancelled / draft / other doc types and other parties', () => {
  const docs = [
    inv({ status: 'Cancelled', issue_date: '2026-10-20', items: [line('A')] }),
    inv({ status: 'Draft', issue_date: '2026-10-21', items: [line('B')] }),
    inv({ doc_type: 'CREDIT_NOTE', issue_date: '2026-10-21', items: [line('C')] }),
    inv({ doc_type: 'QUOTATION', issue_date: '2026-10-19', items: [line('Q')] }),
    inv({ client: { id: 'other', name: 'Other', email: '', address: '', city: '', zip: '' }, items: [line('D')] }),
    inv({ issue_date: '2026-10-02', invoice_number: 'INV/OK', items: [line('E')] }),
  ];
  assert.deepEqual(ph.usualItems(docs, party, '2026-10-21').map((x) => x.name), ['E']);
  assert.equal(ph.lastBill(docs, party, 'INVOICE')!.invoice_number, 'INV/OK');
  assert.equal(ph.lastBill(docs, party, 'QUOTATION')!.items[0].name, 'Q', 'same document type');
  // A party typed by name (no id on either side) matches by name.
  assert.equal(ph.lastBill([inv({ client: { name: 'gupta stores ', email: '', address: '', city: '', zip: '' }, items: [line('F')] })], { name: 'Gupta Stores' }, 'INVOICE')!.items[0].name, 'F');
});

test('repeat strips the forbidden fields', () => {
  const src = [line('Soap', { bill_refs: ['t1'], batch_no: 'B1', batch_expiry: '2027-01-01', serials: ['S1'], price_basis: 'Wholesale', order_line_id: 'o1', bin: 'R2', godown_id: 'g1' })];
  const [l] = ph.repeatLines(src, { catalog: [], day: '2026-10-21', newId: nid });
  assert.notEqual(l.id, src[0].id);
  for (const k of ['bill_refs', 'batch_no', 'batch_expiry', 'serials', 'price_basis', 'order_line_id', 'bin'] as const) assert.equal(l[k], undefined, k);
  assert.equal(l.godown_id, 'g1', 'the godown is a choice, kept');
  assert.equal(l.rate, 100, 'no catalogue row: the old rate stays');
});

test('today’s price applied over the old rate', () => {
  const [l] = ph.repeatLines([line('Soap', { rate: 100, quantity: 3 })], { catalog: [line('Soap', { rate: 120, tax_rate: 12 })], day: '2026-10-21', newId: nid });
  assert.equal(l.rate, 120);
  assert.equal(l.quantity, 3, 'quantities kept');
  assert.equal(l.amount, 360);
  assert.equal(l.tax_rate, 12);
});

test('alternate-unit lines keep unit_factor (rate per line unit)', () => {
  const [l] = ph.repeatLines([line('Soap', { unit: 'BOX', unit_factor: 12, rate: 1100, quantity: 2 })], { catalog: [line('Soap', { rate: 100, unit: 'PCS' })], day: '2026-10-21', newId: nid });
  assert.equal(l.unit_factor, 12);
  assert.equal(l.unit, 'BOX');
  assert.equal(l.rate, 1200, '12 × today’s base rate');
  const u = ph.usualItems([inv({ items: [line('Soap', { unit: 'BOX', unit_factor: 12, quantity: 2 })] })], party, '2026-10-21')[0];
  assert.equal(u.unit_factor, 12);
  assert.equal(ph.usualLine(u, { catalog: [], day: '2026-10-21', newId: nid }).unit_factor, 12);
});

test('free-goods recomputed', () => {
  const scheme = { id: 's1', item_name: 'Soap', buy_qty: 10, free_qty: 1, active: true };
  const paid = line('Soap', { quantity: 20 });
  const old = [paid, line('Soap', { quantity: 5, rate: 0, amount: 0, free_of: paid.id, scheme_id: 'old' })];
  const out = ph.repeatLines(old, { catalog: [], schemes: [scheme as never], day: '2026-10-21', newId: nid });
  assert.equal(out.length, 2);
  assert.equal(out[1].free_of, out[0].id);
  assert.equal(out[1].quantity, 2, 'today’s scheme: 1 free per 10');
  assert.equal(out[1].scheme_id, 's1');
  const none = ph.repeatLines(old, { catalog: [], schemes: [], day: '2026-10-21', newId: nid });
  assert.equal(none.length, 1, 'no scheme today → no free line');
});
