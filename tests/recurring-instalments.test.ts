/**
 * PENDING 49 (8.111): instalments on recurring templates. The source document's payment schedule is kept as day
 * offsets and re-dated from every run's issue date; a schedule's payment term still wins; the template key never
 * leaks onto the invoice; the editor offers a payment term per schedule.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return mem.size; },
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
} as Storage;

const R = await import('../src/lib/recurring.ts');
const { localDb } = await import('../src/lib/localDb.ts');
const { makeDraft } = await import('../src/store/invoice-defaults.ts');

beforeEach(() => mem.clear());

function source() {
  const draft = makeDraft({ settings: localDb.settings.get(), sender: null });
  draft.client = { ...draft.client, name: 'Acme Traders' };
  draft.items = [{ id: 'i1', name: 'Retainer', type: 'Service', quantity: 1, rate: 1000, tax_rate: 0, amount: 1000 }];
  draft.gst_mode = 'NONE';
  draft.round_off_enabled = false;
  draft.issue_date = '2026-01-10';
  draft.payment_schedule = [
    { id: 'a', label: 'Deposit', due_date: '2026-01-10', percent: 40 },
    { id: 'b', label: 'Balance', due_date: '2026-02-09', percent: 60 },
  ];
  return draft;
}

test('template keeps instalments as offsets; each run re-dates them', () => {
  const t = R.templateFromInvoice(source());
  assert.deepEqual(t.instalments, [{ label: 'Deposit', offset_days: 0, percent: 40 }, { label: 'Balance', offset_days: 30, percent: 60 }]);
  const s = R.createSchedule({ name: 'Retainer', template: t, frequency: 'monthly', start_date: '2026-03-05', due_in_days: 10, mode: 'draft' });
  const inv = R.buildInvoiceFromSchedule(s, '2026-03-05', { invoiceNumber: '' });
  assert.deepEqual(inv.payment_schedule?.map((x) => [x.label, x.due_date, x.percent]), [['Deposit', '2026-03-05', 40], ['Balance', '2026-04-04', 60]]);
  assert.ok(!('instalments' in inv), 'template-only key stays off the invoice');
  const next = R.buildInvoiceFromSchedule(s, '2026-04-05', { invoiceNumber: '' });
  assert.equal(next.payment_schedule?.[1].due_date, '2026-05-05');
  assert.notEqual(next.payment_schedule?.[0].id, inv.payment_schedule?.[0].id);
});

test('no schedule on the source → no instalments; a payment term wins over the template', () => {
  const plain = { ...source(), payment_schedule: undefined };
  assert.equal(R.templateFromInvoice(plain).instalments, undefined);
  const t = R.templateFromInvoice(source());
  const s = { ...R.createSchedule({ name: 'R', template: t, frequency: 'monthly', start_date: '2026-03-05', due_in_days: 10 }), payment_terms_id: 'net30' };
  const term = { id: 'net30', name: 'Net 30', kind: 'net' as const, days: 30 };
  const inv = R.buildInvoiceFromSchedule(s, '2026-03-05', { invoiceNumber: '', terms: [term] });
  assert.equal(inv.payment_schedule, undefined);
  assert.equal(inv.due_date, '2026-04-04');
});

test('the recurring editor offers a payment term per schedule', () => {
  const src = readFileSync('src/components/recurring/RecurringEditor.tsx', 'utf8');
  assert.ok(src.includes('payment_terms_id: termId'));
  assert.ok(src.includes('data-rec-term'));
});
