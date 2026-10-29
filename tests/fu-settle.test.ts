/** R21-B2 attendant settlement: expected = meter value − POS-billed value; collections by mode; short / excess; the excess comes off cash first. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billedInShift, counterLines, postPlan, settleShift } from '../src/lib/fuel/fu-settle.ts';
import { momentOf, shiftSales } from '../src/lib/fuel/fu-shift.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { FuelNozzle, FuelPrice, FuelShift, FuelSlip } from '../src/types/fuel-r21.ts';

const NZ: FuelNozzle[] = [
  { id: 'n1', du_no: '1', nozzle_no: 'A', tank_id: 't1', item_id: 'ms', totaliser_start: 0, active: true },
  { id: 'n2', du_no: '1', nozzle_no: 'B', tank_id: 't1', item_id: 'ms', totaliser_start: 0, active: true },
];
const P: FuelPrice[] = [{ id: 'p1', item_id: 'ms', date: '2026-10-29', time: '06:00', rsp: 100 }];
const S: FuelShift = {
  id: 'S1', date: '2026-10-29', shift_no: 1, opened_at: '2026-10-29 06:00', closed_at: '2026-10-29 14:00', status: 'closed',
  attendants: [{ name: 'Ravi', nozzle_ids: ['n1'] }, { name: 'Sita', nozzle_ids: ['n2'] }],
  readings: [{ nozzle_id: 'n1', opening: 1000, closing: 1105, test_l: 5, test_returned: true }, { nozzle_id: 'n2', opening: 0, closing: 50, test_l: 0, test_returned: true }],
  collections: [
    { attendant: 0, mode: 'cash', amount: 6000 }, { attendant: 0, mode: 'upi', amount: 2000 }, { attendant: 0, mode: 'credit', amount: 1000 },
    { attendant: 1, mode: 'cash', amount: 5100 },
  ],
};
const at = (h: number) => new Date(2026, 9, 29, h, 0).toISOString();
const pos = (h: number, litres: number, amount: number, extra: Partial<InvoiceRecord> = {}): InvoiceRecord => ({ id: `b${h}`, issue_date: '2026-10-29', status: 'Paid', created_at: at(h), items: [{ id: 'l1', amount }], fu: { lines: { l1: { nozzle_id: 'n1', litres } } }, ...extra } as unknown as InvoiceRecord);

test('POS bills of the shift and its slips are billed; others are not', () => {
  assert.equal(momentOf(new Date(2026, 9, 29, 9, 5)), '2026-10-29 09:05');
  const inv = [pos(9, 5, 500), pos(15, 7, 700), pos(10, 3, 300, { status: 'Cancelled' }), pos(11, 9, 900, { fu: { shift_id: 'S0', lines: { l1: { nozzle_id: 'n1', litres: 9 } } } })];
  const slips = [{ id: 'x', shift_id: 'S1', nozzle_id: 'n1', litres: 10, amount: 1000 }, { id: 'y', shift_id: 'S2', nozzle_id: 'n1', litres: 1, amount: 100 }] as FuelSlip[];
  const b = billedInShift(S, inv, slips);
  assert.deepEqual(b.pos.get('n1'), { litres: 5, amount: 500 });
  assert.deepEqual(b.slips.get('n1'), { litres: 10, amount: 1000 });
  const sales = shiftSales(S, NZ, P);
  const people = settleShift(S, sales, b);
  assert.deepEqual(people.map((p) => [p.value, p.expected, p.collected, p.diff]), [[10000, 9500, 9000, -500], [5000, 5000, 5100, 100]]);
  assert.deepEqual(counterLines(sales, b), [{ item_id: 'ms', tank_id: 't1', litres: 135, amount: 13500, nozzles: ['n1', 'n2'] }], 'meter − POS − slips, one line per tank × product');
  const plan = postPlan(people);
  assert.deepEqual(plan.pay, { cash: 11000, upi: 2000 }, 'credit slips are not receipts; the excess comes off cash');
  assert.deepEqual(plan.excess, { cash: 100 });
  assert.throws(() => counterLines(sales, billedInShift(S, [pos(9, 200, 20000)], [])), /exceed/);
});

test('a shortage write-off row moves no cash', () => {
  assert.equal(movedNoCash({ write_off: true }), true);
});
