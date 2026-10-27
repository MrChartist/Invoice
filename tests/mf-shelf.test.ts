/** MF-D2 shelf life at dispatch: remaining life by date, FEFO with a floor, shortfall text, near-expiry buckets, scheme presets, FCN. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bucketOf, bucketTotals, CIRCULAR_251_NOTE, floorBatches, floorOf, FOOD_SCHEME_PRESETS, meetsFloor, nearExpiry, presetScheme, remainingLife } from '../src/lib/mfg/mf-shelf.ts';
import { validateScheme } from '../src/lib/pricing.ts';
import { isNonGstFinancialNote } from '../src/lib/financial-note.ts';

const old = { batch: 'B1', mfg: '2026-07-01', expiry: '2026-12-28', qty: 30 }; // 180 days
const fresh = { batch: 'B2', mfg: '2026-10-01', expiry: '2027-03-30', qty: 12 };

test('remaining life % and days on the dispatch date', () => {
  assert.deepEqual(remainingLife(old, '2026-10-27'), { pct: 34.4, days: 62 });
  assert.deepEqual(remainingLife({ expiry: '2026-11-01' }, '2026-10-27'), { pct: null, days: 5 });
  assert.deepEqual(remainingLife({}, '2026-10-27'), { pct: null, days: null });
  assert.equal(remainingLife(old, '2027-01-05').pct, 0);
});

test('FEFO with a floor: skips batches below the client\'s minimum; shortfall message; no floor = as before', () => {
  assert.deepEqual(floorOf({ mf: { min_shelf_pct: 70 } }), { pct: 70 });
  assert.equal(floorOf({ mf: {} }), undefined);
  assert.equal(floorOf(undefined), undefined);
  const r = floorBatches([old, fresh], '2026-10-27', { pct: 70 }, 20);
  assert.deepEqual(r.ok.map((b) => b.batch), ['B2']);
  assert.equal(r.qualifying, 12);
  assert.equal(r.message, 'no batch with ≥ 70% life — 12 units qualify');
  assert.equal(floorBatches([old, fresh], '2026-10-27', { pct: 70 }, 10).message, '');
  assert.equal(floorBatches([old, fresh], '2026-10-27', undefined, 40).ok.length, 2);
  assert.equal(meetsFloor({ expiry: '2027-01-01' }, '2026-10-27', { pct: 50 }), false, 'no MFG date: % cannot be checked');
  assert.equal(meetsFloor({ expiry: '2027-01-01' }, '2026-10-27', { days: 30 }), true);
  assert.equal(meetsFloor({}, '2026-10-27', { pct: 90 }), true, 'no expiry: nothing to run out');
});

test('the editor filter is one guarded line on the client\'s floor', () => {
  const src = readFileSync(new URL('../src/components/creator/LineTracking.tsx', import.meta.url), 'utf8');
  assert.match(src, /floorBatches\(options, ctx\.day, floor/);
  assert.match(src, /mfg\/mf-shelf-floor/);
});

test('near-expiry desk: by batch and godown, buckets and totals', () => {
  const t = [{ item: { id: 'nk', name: 'Namkeen 200 g', track_batches: true }, batches: [{ ...old, byGodown: { main: 20, van: 10 } }, { ...fresh, byGodown: { main: 12 } }, { batch: 'X', expiry: '2026-10-01', mfg: '2026-04-01', byGodown: { main: 3 } }] }];
  const rows = nearExpiry(t, '2026-10-27');
  assert.deepEqual(rows.map((r) => [r.batch, r.godown, r.bucket]), [['X', 'main', 'expired'], ['B1', 'main', 'lt50'], ['B1', 'van', 'lt50'], ['B2', 'main', 'ok']]);
  assert.deepEqual(bucketTotals(rows), { expired: 3, lt25: 0, lt50: 30, lt70: 0, ok: 12, unknown: 0 });
  assert.equal(bucketOf(20, 10), 'lt25');
});

test('scheme presets load into the R8 scheme shape; the display claim is settled by FCN (no GST) with the Circular 251 note', () => {
  const item = { id: 'nk', name: 'Namkeen 200 g' };
  for (const p of FOOD_SCHEME_PRESETS.filter((x) => x.id !== 'display_claim')) assert.equal(validateScheme(presetScheme(p, item, '2026-10-01')!), '', p.id);
  assert.equal(presetScheme(FOOD_SCHEME_PRESETS[2], item, '2026-10-01'), null);
  assert.match(CIRCULAR_251_NOTE, /251\/08\/2025/);
  assert.equal(isNonGstFinancialNote({ doc_type: 'CREDIT_NOTE', note_kind: 'financial' } as never), true);
});
