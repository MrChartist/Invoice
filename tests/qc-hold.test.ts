/**
 * R4-A4 QC hold: a GRN of an item held for QC goes into the QC godown, a sale from it is refused, a release makes it
 * saleable (batch kept), a reject pre-fills Rejections Out with the right quantity, the ageing alert.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { blankStockItem, collectEvents, stockDb } from '../src/lib/inventory.ts';
import { computeTracking, liveDocTrackingIssues, liveTrackingInputs } from '../src/lib/stock-tracking.ts';
import { godownsDb, nonSaleableGodowns, transfersDb } from '../src/lib/godowns.ts';
import { receiptNotesDb, rejectionLinesFromGrn } from '../src/lib/receipt-notes.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { agedQc, holdsForQc, loadQcSettings, qcGodowns, qcNotices, qcResultsDb, qcStock, rejectionFromQc, releaseLines, saveQcSettings, withQcGodown } from '../src/lib/production/qc.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-05-10T10:00:00');
});
afterEach(() => thawDate());

const qcRows = (today = '2026-05-10') => {
  const ids = new Set(qcGodowns(godownsDb.list()).map((g) => g.id));
  return qcStock(collectEvents({ ...liveTrackingInputs(), includeTransfers: true }), ids, today);
};

function receive() {
  stockDb.saveItem(blankStockItem({ id: 'tv', name: 'TV', track_batches: true, qc_on_receipt: true }));
  stockDb.saveItem(blankStockItem({ id: 'cable', name: 'Cable' }));
  return receiptNotesDb.save({
    kind: 'GRN', vendor_name: 'Sony Dist', date: '2026-05-05',
    lines: [
      { id: 'g1', name: 'TV', item_id: 'tv', quantity: 10, rate: 20000, tax_rate: 18, batch_no: 'T1' },
      { id: 'g2', name: 'Cable', quantity: 5, rate: 100, tax_rate: 18 },
    ],
  }, []);
}

test('pure: holds for QC per item or company-wide; the user\'s godown wins', () => {
  assert.equal(holdsForQc({ track_stock: true, qc_on_receipt: true }, { hold_all: false }), true);
  assert.equal(holdsForQc({ track_stock: true }, { hold_all: false }), false);
  assert.equal(holdsForQc({ track_stock: true }, { hold_all: true }), true);
  const lines = withQcGodown([{ name: 'a' }, { name: 'b', godown_id: 'g9' }], 'qc', () => ({ track_stock: true, qc_on_receipt: true } as never), { hold_all: false });
  assert.deepEqual(lines.map((l) => l.godown_id), ['qc', 'g9']);
  assert.deepEqual([...nonSaleableGodowns([{ id: 'a', name: 'A', kind: 'qc' }, { id: 'b', name: 'B', kind: 'wip' }, { id: 'c', name: 'C', kind: 'transit' }, { id: 'd', name: 'D', kind: 'van' }])].sort(), ['a', 'b', 'c']);
});

test('GRN into QC, sale refused, release → saleable with the batch kept', () => {
  const grn = receive();
  const qc = qcGodowns(godownsDb.list())[0];
  assert.ok(qc, 'the QC hold godown is created on first use');
  assert.equal(grn.lines[0].godown_id, qc.id, 'the held item defaults to the QC godown');
  assert.equal(grn.lines[1].godown_id, undefined, 'other items are put away as usual');
  const sale = { doc_type: 'TAX_INVOICE', status: 'Sent', issue_date: '2026-05-10', items: [{ id: 'x', name: 'TV', quantity: 1, rate: 25000, godown_id: qc.id, batch_no: 'T1' }] };
  assert.ok(liveDocTrackingIssues(sale as never).errors.some((e) => /non-saleable/.test(e)), 'the sale guard refuses the QC godown');

  const [row] = qcRows();
  assert.deepEqual([row.itemId, row.batch, row.qty, row.source.kind, row.source.number], ['tv', 'T1', 10, 'grn', grn.number]);
  const t = transfersDb.save({ date: '2026-05-10', from_godown: qc.id, to_godown: 'main', lines: releaseLines(row, 6) });
  qcResultsDb.save({ date: '2026-05-10', item_id: 'tv', batch_no: 'T1', godown_id: qc.id, source: { kind: 'grn', id: grn.id, number: grn.number }, qty: 6, result: 'pass', inspector: 'Asha', transfer_id: t.id });
  const tracking = computeTracking(liveTrackingInputs());
  const b = tracking.get('tv')!.batches.find((x) => x.batch === 'T1')!;
  assert.deepEqual([b.byGodown.main, b.byGodown[qc.id]], [6, 4]);
  assert.equal(qcRows()[0].qty, 4);
  assert.equal(qcResultsDb.all()[0].result, 'pass');
});

test('reject from a GRN pre-fills Rejections Out with the rejected quantity and batch', () => {
  const grn = receive();
  const qc = qcGodowns(godownsDb.list())[0];
  const [row] = qcRows();
  const lines = rejectionFromQc(rejectionLinesFromGrn(grn, [], receiptNotesDb.all()), row, 4, 'TV');
  assert.deepEqual(lines.map((l) => [l.item_id, l.quantity, l.batch_no, l.godown_id, l.grn_line_id]), [['tv', 4, 'T1', qc.id, 'g1']]);
  const rjo = receiptNotesDb.save({ kind: 'REJECTION_OUT', grn_id: grn.id, vendor_name: grn.vendor_name, date: '2026-05-10', lines }, []);
  assert.match(rjo.number, /^RJO\//);
  assert.equal(qcRows()[0].qty, 6);
});

test('ageing alert after N days (default 3); settings are owner-only and audited', () => {
  receive();
  assert.equal(loadQcSettings().alert_days, 3);
  const rows = qcRows('2026-05-10');
  assert.equal(rows[0].ageDays, 5);
  assert.equal(agedQc(rows, 3).length, 1);
  assert.equal(agedQc(rows, 7).length, 0);
  const notices = qcNotices(rows, 3, () => 'TV', '2026-05-10T10:00:00Z');
  assert.match(notices[0].title, /1 lot waiting in QC for more than 3 days/);
  assert.equal(notices[0].href, '/manufacturing?tab=qc');
  saveQcSettings({ hold_all: true, alert_days: 7 });
  assert.deepEqual(loadQcSettings(), { hold_all: true, alert_days: 7 });
});
