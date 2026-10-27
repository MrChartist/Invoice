/** MF-B5 paper maths: ups in both orientations with margins, sheets and kg, make-ready and running wastage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { netSheets, packets, paperKg, reams, sqIn, upsOn, wasteSheets } from '../src/lib/mfg/mf-paper.ts';

test('ups: both orientations after gripper, edge and bleed', () => {
  const sheet = { w: 762, h: 508 }; // 30 × 20 in
  assert.deepEqual(upsOn(sheet, { w: 350, h: 230 }, { gripper: 10, bleed: 3, edge: 5 }), { ups: 4, across: 2, down: 2, rotated: false });
  // 200 × 340: upright 3 across × 1 down = 3; rotated (340 × 200) 2 across × 2 down = 4
  assert.deepEqual(upsOn(sheet, { w: 200, h: 340 }, { gripper: 10, bleed: 3, edge: 5 }), { ups: 4, across: 2, down: 2, rotated: true });
  assert.equal(upsOn(sheet, { w: 800, h: 600 }).ups, 0, 'does not fit');
  assert.equal(upsOn(sheet, { w: 370, h: 240 }, { gripper: 0, bleed: 0, edge: 0 }).ups, 4, 'no margins');
});

test('sheets, wastage, kg, reams', () => {
  assert.equal(netSheets(10000, 4), 2500);
  assert.equal(netSheets(10001, 4), 2501);
  assert.equal(netSheets(10, 0), 0);
  assert.equal(wasteSheets(2500, 1, 100, 2), 150, '100 make-ready + 2% running');
  assert.equal(wasteSheets(2500, 2, 100, 2), 250, 'per colour pass');
  assert.equal(paperKg(2650, { w: 762, h: 508 }, 300), 307.741); // 2650 × 0.387096 m² × 0.3 kg/m²
  assert.equal(reams(2650), 5.3);
  assert.equal(packets(2650), 27);
  assert.equal(sqIn({ w: 762, h: 508 }), 600);
});
