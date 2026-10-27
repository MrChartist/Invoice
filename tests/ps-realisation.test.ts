/** PS-A4 realisation: the three ratios on a worked example, fixed fee, credit note, TDS as collected, write-offs; two years of a 25-person firm read one month only. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TIME_PREFS, type TimeEntry } from '../src/types/time.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import { collectedShare, realisation, billingRealisation } from '../src/lib/prof/ps-realisation.ts';

const P = DEFAULT_TIME_PREFS;
const te = (id: string, date: string, minutes: number, rate: number, extra: Partial<TimeEntry> = {}): TimeEntry => ({ id, client_id: 'c1', client_name: 'Acme', description: 'w', date, minutes, hourly_rate: rate, billable: true, ...extra });
const inv = (id: string, date: string, items: Partial<InvoiceRecord['items'][number]>[], extra: Partial<InvoiceRecord> = {}): InvoiceRecord => ({ id, issue_date: date, items: items.map((i, n) => ({ id: `${id}-l${n}`, name: 'x', type: 'Service', quantity: 1, rate: i.amount ?? 0, ...i })), total: 0, amount_paid: 0, ...extra } as never);

test('worked example: 14.5 h worth ₹58,000 billed ₹40,000, paid ₹30,000 + TDS ₹4,000 of ₹47,200; a write-off in the period counts at nil', () => {
  const entries = new Map([te('a', '2026-06-02', 300, 4000, { staff_id: 's1' }), te('b', '2026-06-10', 330, 4000, { staff_id: 's1' }), te('c', '2026-06-20', 240, 4000, { staff_id: 's2' }), te('w', '2026-06-05', 60, 2000, { staff_id: 's2', ps: { wo: { date: '2026-06-28', reason: 'x' } } })].map((e) => [e.id, e]));
  const note = inv('i1', '2026-06-30', [{ amount: 40000, bill_refs: ['a', 'b', 'c'], unit: 'HRS' }], { total: 47200, amount_paid: 30000, tds_amount: 4000 });
  const r = realisation({ from: '2026-06-01', to: '2026-06-30', by: 'staff', prefs: P, invoices: [note], entryById: (id) => entries.get(id), dated: [...entries.values()], writtenOff: [...entries.values()], centres: [] });
  assert.deepEqual([r.total.worked, r.total.standard, r.total.billed], [60000, 60000, 40000]);
  assert.equal(r.total.collected, 28813.56);
  assert.deepEqual([r.total.billing, r.total.collection, r.total.overall], [66.67, 72.03, 48.02]);
  const s1 = r.rows.find((x) => x.key === 's1')!;
  assert.deepEqual([s1.standard, s1.billed], [42000, 28965.52]);
  assert.equal(collectedShare({ total: 1000, amount_paid: 1000, tds_amount: 0 }, 200), 0.8, 'a credit note reduces collected only');
});

test('fixed fee spreads over the time it covers; billing realisation of a client', () => {
  const entries = new Map([te('a', '2026-06-02', 600, 4000)].map((e) => [e.id, e]));
  const note = inv('i1', '2026-06-30', [{ amount: 0, bill_refs: ['a'] }, { id: 'fee', amount: 30000 }], { ps: { lines: { 'i1-l0': { covered: true }, fee: { fee: true } } } } as never);
  note.items[1].id = 'fee';
  const r = realisation({ from: '2026-06-01', to: '2026-06-30', by: 'client', prefs: P, invoices: [note], entryById: (id) => entries.get(id), dated: [], writtenOff: [], centres: [] });
  assert.deepEqual([r.total.standard, r.total.billed, r.total.billing], [40000, 30000, 75]);
  assert.equal(billingRealisation([note], (id) => entries.get(id), P), 0.75);
});

test('two years of a 25-person firm: one month reads only its entries', () => {
  const all: TimeEntry[] = [];
  for (let d = 0; d < 730; d++) {
    const day = new Date(2024, 3, 1 + d);
    const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    for (let s = 0; s < 25; s++) for (let k = 0; k < 2; k++) all.push(te(`e${d}-${s}-${k}`, ymd, 120, 2000, { staff_id: `s${s}` }));
  }
  assert.ok(all.length > 36000);
  const byId = new Map(all.map((e) => [e.id, e]));
  const month = all.filter((e) => e.date >= '2026-02-01' && e.date <= '2026-02-28');
  const billed = all.filter((e) => e.date.startsWith('2026-01')).map((e) => e.id);
  const note = inv('i1', '2026-02-05', [{ amount: billed.length * 4000 * 0.9, bill_refs: billed }], { total: billed.length * 4000 * 0.9 });
  let touched = 0;
  const r = realisation({ from: '2026-02-01', to: '2026-02-28', by: 'staff', prefs: P, invoices: [note], entryById: (id) => { touched++; return byId.get(id); }, dated: month, writtenOff: [], centres: [] });
  assert.equal(r.read, billed.length + month.length);
  assert.equal(touched, billed.length);
  assert.equal(r.total.billing, 90);
});
