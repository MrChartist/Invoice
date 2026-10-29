/**
 * QA round 25 (Round 21 fuel) regression tests, W1–W6 of docs/prd/qa-round-25.md. Each fails on the R21 baseline
 * (bef8125): slips billed twice (counter bill + slip bill), stock leaving the default godown instead of the tank, the
 * day-close bill invisible to the Rule 42 duty working, a negative dip from a water dip above the product dip, a used
 * nozzle deleted from under its shifts, and the monthly loss voucher losing unbilled slip litres twice.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, installSettings } from './helpers/world.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import { openShift, readShifts, removeShift, saveShift } from '../src/lib/fuel/fu-dayclose.ts';
import { dayClose, undoShift } from '../src/lib/fuel/fu-issue-io.ts';
import * as slipsMod from '../src/lib/fuel/fu-slips.ts';
const { readSlips, removeSlip, saveSlip } = slipsMod;
// Namespace reads, so each test fails on its own on the baseline (where these helpers did not exist).
const linkSlip: typeof slipsMod.linkSlip = (...a) => slipsMod.linkSlip(...a);
import { billSlips } from '../src/lib/fuel/fu-recv-io.ts';
import { fuelLine } from '../src/lib/fuel/fu-line.ts';
import { counterLines } from '../src/lib/fuel/fu-settle.ts';
import { dutyOf } from '../src/lib/fuel/fu-rule42.ts';
import { dipLitres } from '../src/lib/fuel/fu-dips.ts';
import { readNozzles, removeNozzle } from '../src/lib/fuel/fu-tank.ts';
import * as stockIo from '../src/lib/fuel/fu-stock-io.ts';
const { postVariation, stockBook } = stockIo;
const booksLag: typeof stockIo.booksLag = (...a) => stockIo.booksLag(...a);
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';
import type { FuelNozzle, FuelPrice, FuelShift, FuTank } from '../src/types/fuel-r21.ts';

const DAY = '2026-10-29';
const NZ: FuelNozzle[] = [
  { id: 'n1', du_no: '1', nozzle_no: 'A', tank_id: 't1', item_id: 'ms', totaliser_start: 1000, active: true },
  { id: 'n2', du_no: '1', nozzle_no: 'B', tank_id: 't1', item_id: 'ms', totaliser_start: 0, active: true },
];
const P: FuelPrice[] = [{ id: 'p1', item_id: 'ms', date: DAY, time: '06:00', rsp: 100, build: { excise: 20, vat: 15 } }];
const tank = { id: 't1', name: 'Tank 1', fu: { product_item_id: 'ms', capacity_l: 15000, chart: [[0, 0], [1000, 5000], [2000, 15000]] as FuTank['chart'] } };

beforeEach(() => {
  resetStorage();
  installSettings();
  setTable('stock_items', [{ id: 'ms', name: 'Petrol (MS)', unit: 'LTR', hsn: '27101241', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, fu: { product: 'ms', unit: 'L' } }]);
  setTable('godowns', [tank]);
  setTable('fuel_nozzles', [NZ[0]]);
  setTable('fuel_prices', P);
  localDb.clients.upsert(clientMH);
});

/** Shift 1 of DAY: nozzle n1, 1000 → 1105 with 5 L test = 100 L at ₹100; Ravi hands over ₹9,000 cash + ₹1,000 of slips. */
function shiftWithSlip() {
  const s = openShift({ date: DAY, shift_no: 1, start: '06:00', test_l: 5, attendants: [{ name: 'Ravi', nozzle_ids: ['n1'] }] }, [NZ[0]]);
  const slip = saveSlip({ slip_no: 'S-1', date: DAY, client_id: 'c-mh', vehicle_no: 'MH12AB1234', item_id: 'ms', litres: 10, amount: 1000 });
  saveShift(s.id, { readings: s.readings.map((r) => ({ ...r, closing: 1105 })), collections: [{ attendant: 0, mode: 'cash', amount: 9000 }, { attendant: 0, mode: 'credit', amount: 1000 }] }, [NZ[0]], `${DAY} 14:00`);
  return { s, slip };
}

test('W1: a slip from the slip book is linked to its shift and nozzle, so the litres are billed once (counter bill + slip bill = the meter)', () => {
  const { s, slip } = shiftWithSlip();
  assert.deepEqual([slip.shift_id, slip.nozzle_id], [s.id, 'n1'], 'the one open shift of the day and its one nozzle of the product');
  dayClose(DAY);
  const counter = localDb.invoices.getAll().find((i) => i.fu?.shift_id === s.id)!;
  assert.equal(counter.items[0].quantity, 90, 'the counter bill leaves the 10 slip litres to the slip bill');
  assert.equal(counter.balance_due, 0, 'cash settles the counter bill exactly (no phantom ₹1,000 due)');
  const [bill] = billSlips(DAY);
  const litres = [counter, bill].reduce((t, d) => t + d.items.reduce((u, i) => u + Number(i.quantity), 0), 0);
  assert.equal(litres, 100, 'meter litres billed exactly once');
  // The posted shift's counter bill holds the litres: the slip cannot be changed, nor a new one put on that shift.
  localDb.invoices.setStatus(bill.id, 'Cancelled');
  assert.throws(() => removeSlip(slip.id), /day-closed/);
  assert.throws(() => saveSlip({ slip_no: 'S-2', date: DAY, client_id: 'c-mh', vehicle_no: 'X', item_id: 'ms', litres: 1, amount: 100 }), /day-closed/);
  undoShift(s.id);
  assert.doesNotThrow(() => removeSlip(slip.id), 'after Undo day close the slip is free again');
});

test('W1: the link is checked — several shifts or nozzles must be picked; an open shift with slips cannot be deleted', () => {
  const two = [NZ[0], NZ[1]];
  const sh = (id: string, no: number, status: FuelShift['status'] = 'open'): FuelShift => ({ id, date: DAY, shift_no: no, opened_at: `${DAY} 06:00`, attendants: [], collections: [], status, readings: two.map((n) => ({ nozzle_id: n.id, opening: 0, test_l: 0, test_returned: true as const })) });
  assert.match(String(linkSlip({ date: DAY, item_id: 'ms' }, two, [sh('a', 1)])), /Pick the nozzle/);
  assert.deepEqual(linkSlip({ date: DAY, item_id: 'ms', nozzle_id: 'n2' }, two, [sh('a', 1)]), { shift_id: 'a', nozzle_id: 'n2' });
  assert.match(String(linkSlip({ date: DAY, item_id: 'ms', nozzle_id: 'n2' }, two, [sh('a', 1), sh('b', 2)])), /Pick the shift/);
  assert.deepEqual(linkSlip({ date: DAY, item_id: 'ms', nozzle_id: 'n2' }, two, [sh('a', 1, 'posted'), sh('b', 2)]), { shift_id: 'b', nozzle_id: 'n2' }, 'the shift still open takes it');
  assert.deepEqual(linkSlip({ date: '2026-10-30', item_id: 'ms' }, two, [sh('a', 1)]), {}, 'no shift that day: no link');
  const s = openShift({ date: DAY, shift_no: 1, start: '06:00', test_l: 0, attendants: [{ name: 'Ravi', nozzle_ids: ['n1'] }] }, [NZ[0]]);
  saveSlip({ slip_no: 'S-9', date: DAY, client_id: 'c-mh', vehicle_no: 'X', item_id: 'ms', litres: 1, amount: 100 });
  assert.throws(() => removeShift(s.id), /S-9/);
  assert.equal(readShifts().length, 1);
});

test('W2: fuel sold at the POS and on credit slips leaves the tank (godown), not the default godown', () => {
  const line = { id: 'l1', name: 'Petrol (MS)', quantity: 1, rate: 0, amount: 0, tax_rate: 0 } as unknown as InvoiceItem;
  assert.equal(fuelLine(line, { product: 'ms', price: P[0], nozzle: NZ[0], amount: 500, day: DAY }).line.godown_id, 't1');
  assert.equal(fuelLine(line, { product: 'ms', price: P[0], amount: 500, day: DAY, tank: 't1' }).line.godown_id, 't1', 'no nozzle picked: the product\'s one tank');
  saveSlip({ slip_no: 'S-3', date: '2026-10-30', client_id: 'c-mh', vehicle_no: 'X', item_id: 'ms', litres: 10, amount: 1000 });
  const [bill] = billSlips('2026-10-31');
  assert.equal(bill.items[0].godown_id, 't1', 'the slip bill line leaves the tank');
});

test('W3: the day-close bill carries each line\'s price row, so Rule 42 leaves its duties out of E and F', () => {
  shiftWithSlip();
  dayClose(DAY);
  billSlips(DAY);
  const docs = getTable<InvoiceRecord>('invoices');
  const counter = docs.find((i) => i.fu?.shift_id)!;
  assert.equal(counter.fu?.lines?.[counter.items[0].id]?.price_id, 'p1');
  const w = dutyOf(docs, P, '2026-10-01', '2026-10-31');
  assert.deepEqual([w.litres, w.duty, w.value], [100, 3500, 10000], 'all 100 L: 90 at the counter + 10 on slips × ₹35');
  // A price change inside a shift: the counter litres split by price row, billed litres off each in proportion.
  const segs = [{ price_id: 'p1', rsp: 100, litres: 60 }, { price_id: 'p2', rsp: 110, litres: 40 }];
  const lines = counterLines([{ nozzle_id: 'n1', item_id: 'ms', tank_id: 't1', litres: 100, value: 10400, segs }], { pos: new Map([['n1', { litres: 10, amount: 1040 }]]), slips: new Map() });
  assert.deepEqual(lines.map((l) => [l.price_id, l.litres, l.amount]), [['p1', 54, 5376], ['p2', 36, 3984]]);
  assert.equal(lines.reduce((t, l) => t + l.amount, 0), 9360, 'meter value − billed, to the paisa');
});

test('W4: a water dip above the product dip is refused (it gave negative litres)', () => {
  assert.throws(() => dipLitres(tank.fu.chart, 100, 200), /water dip/);
  assert.deepEqual(dipLitres(tank.fu.chart, 1000, 100), { litres: 4500, water_l: 500 });
});

test('W5: deleting a nozzle that has shifts deactivates it (its shifts still price and carry)', () => {
  setTable('fuel_shifts', [{ id: 's', date: DAY, shift_no: 1, opened_at: `${DAY} 06:00`, attendants: [], collections: [], status: 'posted', readings: [{ nozzle_id: 'n1', opening: 0, closing: 10, test_l: 0, test_returned: true }] }]);
  setTable('fuel_nozzles', NZ);
  removeNozzle('n1');
  assert.deepEqual(readNozzles().map((n) => [n.id, n.active]), [['n1', false], ['n2', true]]);
  removeNozzle('n2');
  assert.deepEqual(readNozzles().map((n) => n.id), ['n1'], 'an unused nozzle is deleted');
});

test('W6: the month\'s loss voucher counts unbilled slip litres as still in the books, and waits for the day close', () => {
  const { s } = shiftWithSlip();
  assert.throws(() => postVariation(tank, '2026-10', '2026-10-31', 4000), /Day-close these shifts first/);
  dayClose(DAY);
  assert.deepEqual(booksLag(tank, '2026-10', '2026-10-31', { slips: readSlips(), docs: getTable<InvoiceRecord>('invoices'), nozzles: [NZ[0]], shifts: readShifts(), tanks: [tank] }), { slipsL: 10, shifts: [] });
  postVariation(tank, '2026-10', '2026-10-31', 4000);
  assert.equal(stockBook(tank, '2026-10-31'), 4010, 'the dip + the 10 unbilled slip litres');
  billSlips('2026-11-01');
  assert.equal(stockBook(tank, '2026-11-01'), 4000, 'billing the slips brings the books to the dip — the 10 L are lost once, not twice');
  void s;
});
