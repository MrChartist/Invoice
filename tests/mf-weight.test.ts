/** MF-B2 shape calculator: each shape's weight, the practice densities, scrap kg = gross − net. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { densities, partWeights, shapeKg, shapeVolumeCc } from '../src/lib/mfg/mf-weight.ts';

test('volumes and weights of each shape (mm, g / cc → kg)', () => {
  assert.equal(shapeVolumeCc({ kind: 'plate', l: 100, w: 50, t: 10 }), 50);
  assert.equal(shapeKg({ kind: 'plate', l: 100, w: 50, t: 10 }, 7.85), 0.393);
  assert.equal(shapeKg({ kind: 'round', d: 50, l: 100 }, 7.85), 1.541); // π/4 × 2500 × 100 = 196.35 cc
  assert.equal(shapeKg({ kind: 'tube', od: 60, id: 50, l: 1000 }, 7.85), 6.782); // π/4 × 1100 × 1000 = 863.94 cc
  assert.equal(shapeKg({ kind: 'ring', od: 300, id: 160, t: 20 }, 7.85), 7.941); // the flange blank
  assert.equal(shapeKg({ kind: 'section', kg_per_m: 3.77, l: 6000 }, 0), 22.62, 'angle by kg per metre, density ignored');
  assert.equal(shapeKg({ kind: 'tube', od: 50, id: 60, l: 10 }, 7.85), 0, 'an ID above the OD is clamped');
});

test('practice densities and gross / net / scrap', () => {
  const d = densities('2026-10-27');
  assert.deepEqual([d.MS, d.SS, d.Al, d.Brass, d.Copper], [7.85, 7.93, 2.7, 8.5, 8.96]);
  const w = partWeights({ kind: 'ring', od: 300, id: 160, t: 20 }, d.MS, undefined, 2.9);
  assert.deepEqual(w, { gross: 7.941, net: 2.9, scrap: 5.041 });
  assert.deepEqual(partWeights({ kind: 'plate', l: 100, w: 100, t: 10 }, 7.85, { kind: 'plate', l: 90, w: 90, t: 10 }), { gross: 0.785, net: 0.636, scrap: 0.149 });
  assert.equal(partWeights({ kind: 'plate', l: 10, w: 10, t: 10 }, 7.85, undefined, 99).scrap, 0, 'net never above gross');
});
