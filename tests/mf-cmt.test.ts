/**
 * MF-C3 CMT by bundle on the existing job-work documents: 4 bundles (48 cut pieces) out on a Material Out from the WIP
 * godown; back 34 good (variant children), 2 rejected (fabric returned unstitched) and one bundle short (still pending on
 * the challan); job charges = good × rate; the challan balance and ITC-04 keep working on the fabric metres.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { loadPositions, stockDb } from '../src/lib/inventory.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { godownsDb } from '../src/lib/godowns.ts';
import { productionOrdersDb } from '../src/lib/production/orders.ts';
import { challanBalances, ensureJobWorkerGodown, materialInDb, materialOutDb } from '../src/lib/job-work.ts';
import { cmtInDraft, cmtOutLine, cmtPieces, challanBundles } from '../src/lib/mfg/mf-cmt.ts';
import { moveBundles, saveBundles } from '../src/lib/mfg/mf-bundles.ts';
import { cutPlanOf, putPlan } from '../src/lib/mfg/mf-cutplans.ts';
import { lotWithOrder, SIZES } from './helpers/garments.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-10-12T10:00:00');
});
afterEach(() => thawDate());

function cmtRoundTrip() {
  const { plan, orderId } = lotWithOrder();
  saveBundles(plan.id, 12, SIZES);
  const wip = productionOrdersDb.get(orderId)!.wip_godown_id;
  const jw = ensureJobWorkerGodown({ name: 'Rehmat Tailors', vendor_id: 'k1' });
  const line = cmtOutLine(cutPlanOf(plan.id)!, [1, 2, 3, 4], { perPieceM: 1.2, godownId: wip, ratePerM: 120 });
  const out = materialOutDb.save({ date: '2026-10-13', party_name: 'Rehmat Tailors', vendor_id: 'k1', job_worker_godown: jw.id, process: 'Stitching', lines: [line] }, stockDb.items(), godownsDb.list());
  putPlan(moveBundles(cutPlanOf(plan.id)!, [1, 2, 3, 4], { where: 'fabricator', party_id: 'k1', challan_id: out.id }));
  const d = cmtInDraft(out, line.id, cutPlanOf(plan.id)!, stockDb.items().find((i) => i.id === 'kt')!, stockDb.items(), [{ no: 1, good: 12, rejected: 0 }, { no: 2, good: 10, rejected: 2, reason: 'Shade' }, { no: 3, good: 12, rejected: 0 }], { rate: 38 });
  const inn = materialInDb.save({ date: '2026-10-20', party_name: 'Rehmat Tailors', vendor_id: 'k1', job_worker_godown: jw.id, consumed: d.consumed, received: d.received, charges: d.charges }, stockDb.items());
  return { plan, out, inn, d, line, jw };
}

test('CMT out by bundle: fabric metres = pieces × metres a piece, from the WIP godown, tagged with lot and bundles', () => {
  const { plan, out, line } = cmtRoundTrip();
  assert.deepEqual([line.qty, line.mf.pieces, line.mf.bundles.length], [57.6, 48, 4]);
  assert.match(out.number, /^JWC\/FY26-27\//);
  assert.deepEqual(challanBundles(out).map((b) => b.no), [1, 2, 3, 4]);
  assert.throws(() => cmtOutLine(cutPlanOf(plan.id)!, [1], { perPieceM: 1.2, godownId: 'x' }), /at fabricator/);
});

test('CMT in by bundle: good → variant children, rejected → fabric back, short stays pending; charges on good pieces', () => {
  const { plan, out, inn, d, line } = cmtRoundTrip();
  assert.deepEqual([d.good, d.rejected, d.charges], [34, 2, 1292]);
  assert.deepEqual(d.short, [{ bundle: 'CUT/FY26-27/0001/4', pieces: 12 }]);
  assert.equal(cmtPieces(inn.received), 34);
  const b = challanBalances([out], [inn], '2026-10-20').lines.find((l) => l.lineId === line.id)!;
  assert.deepEqual([b.consumed, b.returned, b.pending], [40.8, 2.4, 14.4], 'fabric metres: 34 + 2 + 12 pieces × 1.2');
  const pos = new Map(loadPositions().map((x) => [x.item.id, x.qty]));
  assert.equal(pos.get('kt-S-Blue'), 34, 'stitched pieces in stock once');
  assert.throws(() => cmtInDraft(out, line.id, cutPlanOf(plan.id)!, stockDb.items().find((i) => i.id === 'kt')!, stockDb.items(), [{ no: 9, good: 1, rejected: 0 }]), /not sent/);
});
