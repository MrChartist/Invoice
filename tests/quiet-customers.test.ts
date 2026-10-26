/**
 * R3-B7 customers gone quiet.
 */
import { resetStorage } from './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';

const qc = await import('../src/lib/quiet-customers.ts');
const { buildNudge, NUDGE_TEMPLATES } = await import('../src/lib/message-langs.ts');
const { buildInsights } = await import('../src/lib/insights.ts');
const { getTable } = await import('../src/lib/storage.ts');
import type { Client, InvoiceRecord } from '../src/types/invoice.ts';

let n = 0;
const client = (over: Partial<Client>): Client => ({ name: 'X', email: '', address: '', city: '', zip: '', ...over });
const bill = (name: string, day: string, over: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id: `i${++n}`, invoice_number: `INV/${n}`, doc_type: 'INVOICE', status: 'Sent', issue_date: day, total: 1000, taxable_value: 1000,
  client: client({ name }), items: [{ id: `l${n}`, name: 'Rice', type: 'Product', quantity: 5, rate: 200, amount: 1000 }], ...over,
} as InvoiceRecord);
const settings = { threshold_days: 30, snoozed: {}, excluded: [] };
const TODAY = '2026-10-21';

test('median gap rule', () => {
  assert.equal(qc.median([10, 30, 20]), 20);
  assert.equal(qc.median([10, 20]), 15);
  const weekly = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'].map((d) => bill('Weekly', d)); // gap 7, last 58 days ago
  const monthly = ['2026-04-01', '2026-06-01', '2026-08-01', '2026-09-01'].map((d) => bill('Slow', d)); // median gap 61 → limit 91.5; quiet 50
  const rows = qc.quietCustomers([...weekly, ...monthly], [], settings, TODAY);
  assert.deepEqual(rows.map((r) => r.name), ['Weekly']);
  assert.equal(rows[0].median_gap, 7);
  assert.equal(rows[0].days_quiet, 58);
  assert.equal(rows[0].limit, 30, 'max(threshold, 1.5 × gap)');
  assert.equal(rows[0].sales_12m, 4000);
  assert.deepEqual(rows[0].top_items, ['Rice']);
});

test('minimum history (3 bills in 12 months) and walk-ins / drafts / other types left out', () => {
  const two = ['2026-06-01', '2026-07-01'].map((d) => bill('Two', d));
  const old = ['2025-01-01', '2025-02-01', '2025-03-01', '2026-01-01'].map((d) => bill('Old', d));
  const walk = ['2026-06-01', '2026-06-08', '2026-06-15'].map((d) => bill('Walk-in customer', d));
  const drafts = ['2026-06-01', '2026-06-08', '2026-06-15'].map((d) => bill('Drafty', d, { status: 'Draft' }));
  const quotes = ['2026-06-01', '2026-06-08', '2026-06-15'].map((d) => bill('Quoted', d, { doc_type: 'QUOTATION' }));
  assert.deepEqual(qc.quietCustomers([...two, ...old, ...walk, ...drafts, ...quotes], [], settings, TODAY), []);
});

test('snooze until a local day; exclusion; never remind', () => {
  const docs = ['2026-08-03', '2026-08-10', '2026-08-17'].map((d) => bill('Shop', d, { client: client({ id: 'c1', name: 'Shop' }) }));
  const s1 = qc.snooze(settings, 'c1', 30, TODAY);
  assert.equal(s1.snoozed.c1, '2026-11-20');
  assert.equal(qc.quietCustomers(docs, [], s1, TODAY).length, 0);
  assert.equal(qc.quietCustomers(docs, [], s1, '2026-11-20').length, 1, 'shown again from the resume day');
  assert.equal(qc.quietCustomers(docs, [], qc.exclude(settings, 'c1'), TODAY).length, 0);
  assert.equal(qc.quietCustomers(docs, [], qc.include(qc.exclude(settings, 'c1'), 'c1'), TODAY).length, 1);
  assert.equal(qc.quietCustomers(docs, [client({ id: 'c1', name: 'Shop', reminder_mode: 'never' })], settings, TODAY).length, 0, 'R2-A5 never');
  assert.deepEqual(qc.normalizeQuietSettings({ threshold_days: 0, snoozed: { a: 'bad', b: '2026-12-01' }, excluded: ['x', 'x', 3] }), { threshold_days: 30, snoozed: { b: '2026-12-01' }, excluded: ['x'] });
});

test('message language of the nudge', () => {
  const vars = { client: 'Gupta Stores', business: 'Mr Chartist', items: ['Rice', 'Soap'], phone: '98765' };
  const en = buildNudge(undefined, vars);
  assert.match(en, /^Hello Gupta Stores/);
  assert.match(en, /usual \(Rice, Soap\)/);
  assert.match(en, /Ph: 98765$/);
  assert.match(buildNudge('hi', vars), /नमस्ते Gupta Stores/);
  assert.match(buildNudge('ta', { ...vars, items: [] }), /பொருட்களை அனுப்பலாமா/);
  for (const t of Object.values(NUDGE_TEMPLATES)) assert.match(t, /\{client\}[\s\S]*\{business\}[\s\S]*\{items_line\}/);
});

test('party key for clients without id; nudge log', () => {
  resetStorage();
  const masters = new Map([['gupta stores', client({ id: 'c9', name: 'Gupta Stores' })]]);
  assert.equal(qc.partyKeyOf({ name: 'Gupta Stores ' }, masters), 'c9', 'typed name joins the master');
  assert.equal(qc.partyKeyOf({ name: 'Nobody Ltd' }, masters), 'name:nobody ltd');
  assert.equal(qc.partyKeyOf({ id: 'own', name: 'Gupta Stores' }, masters), 'own');
  const docs = ['2026-08-03', '2026-08-10'].map((d) => bill('Gupta Stores', d)).concat(bill('Gupta Stores', '2026-08-17', { client: client({ id: 'c9', name: 'Gupta Stores' }) }));
  const rows = qc.quietCustomers(docs, [client({ id: 'c9', name: 'Gupta Stores', phone: '9' })], settings, TODAY);
  assert.deepEqual(rows.map((r) => [r.key, r.count_12m, r.client?.phone]), [['c9', 3, '9']]);
  qc.logNudge('c9');
  const log = getTable<{ kind?: string; nudge_party_key?: string; party_key?: string }>('reminders');
  assert.equal(log[0].kind, 'nudge');
  assert.equal(log[0].party_key, undefined, 'payment-reminder history unaffected');
  assert.ok(qc.lastNudges(log).get('c9'));
  const csv = qc.quietRowsToCsv(rows);
  assert.equal(csv[0][0], 'Party');
  assert.equal(csv[1][0], 'Gupta Stores');
});

test('insights card quietCustomers', () => {
  const docs = ['2026-08-03', '2026-08-10', '2026-08-17'].map((d) => bill('Shop', d));
  const cards = buildInsights({ invoices: docs, payments: [], purchases: [], quiet: { clients: [], settings } }, TODAY);
  const q = cards.find((c) => c.id === 'quietCustomers')!;
  assert.equal(q.value, 1);
  assert.equal(q.tone, 'warn');
  assert.equal(q.href, '/clients?quiet=1');
  assert.equal(buildInsights({ invoices: docs, payments: [], purchases: [] }, TODAY).some((c) => c.id === 'quietCustomers'), false, 'left out without the inputs');
});
