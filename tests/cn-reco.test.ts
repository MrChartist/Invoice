/** CN-D4: material reconciliation — band and excess, free vs recovery issue, recovery amount, alternate units, totals. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { siteWorld } from './helpers/site-ops.ts';
import { godownsDb, transfersDb } from '../src/lib/godowns.ts';
import { stockDb } from '../src/lib/inventory.ts';
import { bookConsumption, loadCoefficients, saveCoefficients } from '../src/lib/works/sites.ts';
import { loadMeasurements, saveRaBill } from '../src/lib/works/measurements.ts';
import { addIssue, materialReco, recoCsvRows, recoHtml, recoTables, removeIssue, saveTerms, starters } from '../src/lib/construction/cn-reco.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

let w: ReturnType<typeof siteWorld>;
beforeEach(() => {
  w = siteWorld();
  transfersDb.save({ date: '2026-05-20', from_godown: 'main', to_godown: w.site.id, lines: [{ id: 't0', item_id: w.cement.id, qty: 30 }] });
  // 10 "TRUCK" of 20 bags (alternate unit) in June.
  transfersDb.save({ date: '2026-06-02', from_godown: 'main', to_godown: w.site.id, lines: [{ id: 't1', item_id: w.cement.id, qty: 10, unit: 'TRUCK', unit_factor: 20 }] });
  saveCoefficients(w.boq.id, [{ line_id: 'l2', item_id: w.cement.id, qty_per_unit: 1.5 }]);
  saveRaBill(w.boq.id, { date: '2026-06-30', lines: [{ line_id: 'l2', cumulative_qty: 100 }] });
});

const reco = (bills: InvoiceRecord[] = []) => materialReco({ site: godownsDb.stored().find((g) => g.id === w.site.id)!, period: { start: '2026-06-01', end: '2026-06-30' }, ...recoTables(), measurements: loadMeasurements(w.boq.id), coefficients: loadCoefficients(w.boq.id), bills });

test('band and excess: actual beyond +3% of theoretical; no recovery on own material; alternate units in base units', () => {
  bookConsumption(w.site, { date: '2026-06-25', lines: [{ item_id: w.cement.id, qty: 160 }] }, stockDb.items());
  const [r] = reco();
  assert.deepEqual([r.opening, r.own, r.theoretical, r.actual, r.variancePct, r.lo, r.hi, r.excess, r.recovery, r.closing], [30, 200, 150, 160, 6.67, 3, 3, 5.5, 0, 70]);
});

test('client issue: free (quantity only) and against recovery; recovery = beyond band × issue rate × penal factor', () => {
  addIssue(w.site.id, { date: '2026-06-03', item_id: w.cement.id, qty: 50, mode: 'free' });
  addIssue(w.site.id, { date: '2026-06-04', item_id: w.cement.id, qty: 100, mode: 'recovery', rate: 400, ref: 'IR/12' });
  assert.throws(() => addIssue(w.site.id, { date: '2026-06-04', item_id: w.cement.id, qty: 10, mode: 'recovery' }), /rate/);
  bookConsumption(w.site, { date: '2026-06-25', lines: [{ item_id: w.cement.id, qty: 160 }] }, stockDb.items());
  let [r] = reco();
  assert.deepEqual([r.clientFree, r.clientRecovery, r.recoveryRate, r.recovery, r.closing], [50, 100, 800, 4400, 220]);
  // Contract term: band −5% / +10%, penal 1.5 → within the band, nothing recovered.
  saveTerms(w.site.id, w.cement.id, { lo: 5, hi: 10, penal: 1.5 });
  [r] = reco();
  assert.deepEqual([r.excess, r.recoveryRate, r.recovery], [0, 600, 0]);
  // Short use below the band is beyond it too.
  saveTerms(w.site.id, w.cement.id, { lo: 3, hi: 3 });
  const id = godownsDb.stored().find((g) => g.id === w.site.id)!.cn_reco!.issues![0].id;
  removeIssue(w.site.id, id);
  [r] = reco();
  assert.equal(r.clientFree, 0);
});

test('CN-B4 recovery rows on the RA bill count as client issue; final statement totals and CSV / print', () => {
  bookConsumption(w.site, { date: '2026-06-25', lines: [{ item_id: w.cement.id, qty: 140 }] }, stockDb.items());
  const bill = { issue_date: '2026-06-30', boq_id: w.boq.id, status: 'Sent', ra_deductions: [{ kind: 'material_recovery', label: 'Cement issued', base: 0, amount: 4000, item_id: w.cement.id, qty: 10, rate: 400 }] } as unknown as InvoiceRecord;
  const [r] = reco([bill]);
  assert.deepEqual([r.clientRecovery, r.actual, r.excess, r.recovery], [10, 140, 5.5, 4400]);
  assert.equal(r.closing, r.opening + r.own + r.clientFree + r.clientRecovery - r.actual);
  const csv = recoCsvRows([r], () => 'Cement');
  assert.equal(csv[0].length, 14);
  assert.match(recoHtml([r], () => 'Cement', { site: 'Ch. 12', from: '2026-06-01', to: '2026-06-30', company: 'X' }), /Material reconciliation statement/);
  assert.ok(starters('2026-06-30').some((s) => s.work === 'PCC 1:2:4'));
});
