/** AG-B4 dispatch: stock out, MDS numbering, bill from received / sent, snapshot kept after a later chart, reconciliation. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { loadPositions } from '../src/lib/inventory.ts';
import { stockJournalsDb } from '../src/lib/manufacturing.ts';
import { saveChart } from '../src/lib/agri/ag-rate-chart.ts';
import { addEntry, closeShift, loadShifts } from '../src/lib/agri/ag-shifts.ts';
import { billDispatch, deleteDispatch, loadDispatches, saveDispatch } from '../src/lib/agri/ag-dispatch.ts';
import { milkReco } from '../src/lib/agri/ag-milk-reco.ts';
import { saveAgriSettings } from '../src/lib/agri/ag-settings.ts';
import { cowMatrix } from './helpers/ag-dairy.ts';

let union = '';
beforeEach(() => {
  resetStorage();
  installSettings();
  saveChart(cowMatrix());
  union = localDb.clients.upsert({ name: 'District Milk Union' });
  saveChart(cowMatrix({ name: 'Union cow', buyer_id: union, basis: 'two_axis', unit: 'KG', fat_rate: 500, snf_rate: 300, matrix: undefined }));
  const { shift } = addEntry({ centre_id: 'c1', date: '2026-11-05', shift: 'M' }, { farmer_id: 'f1', milk: 'cow', qty: 50, unit: 'L', fat: 4, snf: 8.5 });
  closeShift(shift.id);
});

const milk = () => loadPositions().find((p) => p.item.name === 'Cow milk')?.qty ?? 0;
const send = (over = {}) => saveDispatch({ date: '2026-11-05', shift: 'M', centre_id: 'c1', buyer_id: union, milk: 'cow', tanker: 'MH12 AB 1234', sent: { qty: 40, unit: 'L', fat: 4, snf: 8.5 }, ...over });

test('save moves stock out of the centre (MDS numbering); editing the quantity remakes the journal; delete gives it back', () => {
  assert.equal(milk(), 50);
  const d = send();
  assert.equal(d.number, 'MDS/FY26-27/0001');
  assert.equal(milk(), 10);
  const e = saveDispatch({ ...d, sent: { ...d.sent, qty: 45 } });
  assert.equal(e.number, d.number);
  assert.equal(milk(), 5);
  assert.equal(stockJournalsDb.all().filter((j) => j.consume.length).length, 1);
  deleteDispatch(e.id);
  assert.equal(milk(), 50);
  assert.equal(send().number, 'MDS/FY26-27/0002', 'a deleted number is never reused');
});

test('bill on received figures (default) or sent; a bill of supply with the ag snapshot; billed once', () => {
  const d = send();
  saveDispatch({ ...d, received: { qty: 39.5, fat: 3.9, snf: 8.5, ack_no: 'ACK-77', date: '2026-11-06' } });
  const inv = billDispatch(d.id);
  assert.equal(inv.doc_type, 'BILL_OF_SUPPLY');
  assert.equal(Number(inv.items[0].tax_rate), 0);
  assert.equal(inv.items[0].hsn, '0401');
  assert.equal(inv.issue_date, '2026-11-06');
  // 39.5 L × 1.028 = 40.606 kg; kg fat 1.584 × 500 + kg SNF 3.452 × 300 = 1,827.6
  assert.equal(inv.items[0].quantity, 40.606);
  assert.equal(inv.ag?.kind, 'milk_sale');
  assert.equal(inv.ag?.milk?.tanker, 'MH12 AB 1234');
  assert.equal(inv.ag?.milk?.kg_fat, 1.584);
  assert.equal(inv.ag?.lines?.[inv.items[0].id]?.fat, 3.9);
  assert.ok(Math.abs(inv.total - 1827.6) < 1);
  assert.throws(() => billDispatch(d.id), /already billed/);
  assert.throws(() => saveDispatch({ ...loadDispatches()[0], sent: { ...d.sent, qty: 41 } }), /billed/);
  // a later union chart never changes the stored bill
  saveChart(cowMatrix({ name: 'Union Dec', buyer_id: union, basis: 'flat', unit: 'KG', flat_rate: 99, matrix: undefined, effective_from: '2026-11-06' }));
  const again = localDb.invoices.getById(inv.id)!;
  assert.equal(again.total, inv.total);
  assert.equal(again.ag?.milk?.chart, 'Union cow');
  saveAgriSettings({ milk: { invoice_from: 'sent' } });
  const d2 = send({ date: '2026-11-05' });
  const inv2 = billDispatch(d2.id);
  assert.equal(inv2.items[0].quantity, 41.12, 'sent figures');
});

test('no buyer chart → refused', () => {
  const other = localDb.clients.upsert({ name: 'Plant' });
  const d = send({ buyer_id: other });
  assert.throws(() => billDispatch(d.id), /No rate chart of Plant/);
});

test('reconciliation: collected vs sent vs received, shortage % of kg fat and the tolerance flag', () => {
  const d = send();
  saveDispatch({ ...d, received: { qty: 39.5, fat: 3.9, snf: 8.5, ack_no: 'A', date: '2026-11-06' } });
  const [r] = milkReco({ shifts: loadShifts(), dispatches: loadDispatches(), from: '2026-11-01', to: '2026-11-30' });
  assert.equal(r.collected.l, 50);
  assert.equal(r.sent.l, 40);
  assert.equal(r.received.l, 39.5);
  assert.equal(r.gapL, 10);
  assert.equal(r.shortFat, 0.061, '40 L: 1.645 kg fat sent − 1.584 received');
  assert.ok(r.shortPct > 3);
  assert.equal(r.flag, true);
  const m = milkReco({ shifts: loadShifts(), dispatches: [{ ...loadDispatches()[0], received: { qty: 40, fat: 4, snf: 8.5, ack_no: 'A', date: '2026-11-06' } }], cards: [{ id: 'k', client_id: 'x', month: '2026-11', milk: 'cow', rate: 60, default_qty: 1, days: { 5: 2 } }], from: '2026-11-05', to: '2026-11-05', group: 'month' });
  assert.equal(m[0].key, '2026-11');
  assert.equal(m[0].flag, false);
  assert.equal(m[0].local, 2);
  assert.equal(m[0].gapL, 8);
});
