/** AG-B3 milk bills per cycle: Σ entries = cycle amount, incentives, unclosed shifts block, set-off, bills from the row. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { readPurchase } from '../src/lib/purchase-normalize.ts';
import { loadPositions } from '../src/lib/inventory.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import type { Payment } from '../src/types/invoice.ts';
import type { Vendor } from '../src/types/purchases.ts';
import { saveChart } from '../src/lib/agri/ag-rate-chart.ts';
import { addEntry, closeShift, loadShifts, reopenShift } from '../src/lib/agri/ag-shifts.ts';
import { buildMilkCycle, closeMilkCycle, cycleSummary, makeMilkCycle, milkBillHtml } from '../src/lib/agri/ag-milk-cycle.ts';
import { loadCycles } from '../src/lib/agri/ag-cycle-post.ts';
import { milkLine, milkSaleBill } from '../src/lib/agri/ag-dispatch.ts';
import { cowMatrix } from './helpers/ag-dairy.ts';

let f1: Vendor;
let f2: Vendor;
beforeEach(() => {
  resetStorage();
  installSettings();
  saveChart(cowMatrix({ incentives: [{ kind: 'shift', key: 'M', add: 1 }] }));
  f1 = vendorsDb.save({ name: 'Ramesh', bank_account_no: '1234567890', ag: { code: 'F-0001', centre_id: 'c1', village: 'Rampur' } });
  f2 = vendorsDb.save({ name: 'Suresh', ag: { code: 'F-0002', centre_id: 'c1', village: 'Sitapur' } });
  vendorsDb.save({ name: 'Mahesh', ag: { code: 'F-0003', centre_id: 'c1' } });
});

const can = (f: Vendor, qty: number, fat = 3.7) => ({ farmer_id: f.id, name: f.name, milk: 'cow' as const, qty, unit: 'L' as const, fat, snf: 8.6 });
function collect(close = true) {
  for (const date of ['2026-11-02', '2026-11-03']) for (const shift of ['M', 'E'] as const) {
    const k = { centre_id: 'c1', date, shift };
    addEntry(k, can(f1, 10));
    const { shift: s } = addEntry(k, can(f2, 5, 4.2));
    if (close) closeShift(s.id);
  }
}
const milk = () => loadPositions().find((p) => p.item.name === 'Cow milk')?.qty ?? 0;

test('one line per farmer; Σ entries = cycle amount; shift incentive included; bank / cash mode', () => {
  collect();
  const d = buildMilkCycle('c1', '2026-11-01', '2026-11-10', { shifts: loadShifts(), vendors: vendorsDb.all() });
  assert.equal(d.unclosed.length, 0);
  assert.equal(d.lines.length, 2);
  const r = d.lines.find((l) => l.farmer_id === f1.id)!;
  assert.equal(r.qty, 40);
  assert.equal(r.amount, 2 * (10 * 35) + 2 * (10 * 34), 'morning +₹1 per litre');
  assert.equal(r.shifts?.length, 4);
  assert.equal(r.kg_fat, 1.52, '4 × 10 L × 1.028 × 3.7%');
  assert.equal(r.mode, 'bank');
  assert.equal(d.lines.find((l) => l.farmer_id === f2.id)?.mode, 'cash');
  const sum = loadShifts().flatMap((s) => s.entries).reduce((s, e) => s + e.amount, 0);
  assert.equal(d.lines.reduce((s, l) => s + l.amount, 0), sum);
});

test('an unclosed shift in the period blocks the bill', () => {
  collect(false);
  assert.equal(buildMilkCycle('c1', '2026-11-01', '2026-11-10', { shifts: loadShifts(), vendors: vendorsDb.all() }).unclosed.length, 4);
  assert.throws(() => makeMilkCycle('c1', '2026-11-01', '2026-11-10'), /Close these shifts first/);
});

test('close: ONE exempt pooled purchase marked stock_by_shift — stock not counted twice; feed set off without cash', () => {
  collect();
  assert.equal(milk(), 60);
  // Ramesh bought cattle feed on credit (a client with the same farmer code).
  const feed = milkSaleBill({ ...localDb.clients.getById(localDb.clients.upsert({ name: 'Ramesh', ag: { code: 'F-0001' } }))! }, [{ ...milkLine('cow', 1, 'L', 500), name: 'Cattle feed', ag_class: 'cattle_feed' }], '2026-11-01', { kind: 'produce' });
  const draft = makeMilkCycle('c1', '2026-11-01', '2026-11-10');
  const line = draft.lines.find((l) => l.farmer_id === f1.id)!;
  assert.deepEqual(line.deductions.map((x) => [x.kind, x.amount, x.ref_id]), [['feed', 500, feed.id]]);
  assert.ok(loadShifts().every((s) => s.cycle_id === draft.id));
  assert.throws(() => makeMilkCycle('c1', '2026-11-01', '2026-11-10'), /No closed milk shifts/, 'shifts are not billed twice');
  const closed = closeMilkCycle(draft.id, 'C1');
  const bills = purchasesDb.all();
  assert.equal(bills.length, 1);
  const b = bills[0];
  assert.equal(b.ag?.stock_by_shift, true);
  assert.equal(b.bill_number, closed.number);
  assert.equal(readPurchase(b)?.total, draft.lines.reduce((s, l) => s + l.amount, 0));
  assert.equal(milk(), 60, 'the cycle purchase adds no stock');
  const setOff = getTable<Payment>('transactions').filter((p) => p.invoice_id === feed.id);
  assert.equal(setOff.length, 1);
  assert.equal(setOff[0].exchange_purchase_id, b.id);
  assert.ok(movedNoCash(setOff[0]), 'cash readers skip the set-off');
  assert.throws(() => reopenShift(loadShifts()[0].id), /reopen that cycle/);
  assert.equal(loadCycles()[0].status, 'closed');
});

test('bill pages print from the cycle row; summary by village and farmers with no supply', () => {
  collect();
  const c = makeMilkCycle('c1', '2026-11-01', '2026-11-10');
  const html = milkBillHtml(c, 'Rampur Dairy');
  assert.match(html, /Ramesh/);
  assert.equal((html.match(/<section>/g) ?? []).length, 2);
  assert.match(html, /2026-11-02<\/td><td>M<\/td><td>10\.000/);
  const only = milkBillHtml({ ...c, lines: c.lines.map((l) => ({ ...l, shifts: [] })) }, 'X', [f1.id]);
  assert.doesNotMatch(only, /2026-11-02/, 'never recomputed from the shifts');
  const s = cycleSummary(c, vendorsDb.all(), 'village');
  assert.deepEqual(s.rows.map((r) => r.key).sort(), ['Rampur', 'Sitapur']);
  assert.equal(s.rows[0].key, 'Sitapur', 'highest fat first');
  assert.equal(s.rows[0].avgFat, 4.2);
  assert.deepEqual(s.noSupply.map((v) => v.name), ['Mahesh']);
});
