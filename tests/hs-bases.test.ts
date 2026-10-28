/** PENDING #5 (R18-A cut 2): the `per_inlet` and `per_lifted_unit` bases — tariff amounts, kept by the settings save, imported. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { scoreHeader } from '../src/lib/import-mapping.ts';
import { BASES, unitCharges } from '../src/lib/society/hs-tariff.ts';
import { readSocietySettings, saveSocietySettings } from '../src/lib/society/hs-settings.ts';
import { guessUnitColumns, planUnitsImport } from '../src/lib/society/hs-units-import.ts';
import { validateUnit } from '../src/lib/society/hs-units.ts';
import { hsList } from '../src/i18n/areas/society-r18a.ts';
import type { HsHead, SocietyUnit } from '../src/types/society-r18.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
const H = (id: string, basis: HsHead['basis'], rate: number): HsHead => ({ id, name: id, kind: 'service_supply', basis, rate, active: true });
const U = (o: Partial<SocietyUnit> = {}): SocietyUnit => ({ id: 'u', code: 'A-101', use: 'residential', occupancy: 'owner', parking: [], status: 'active', updated_at: '', ...o });

test('water by inlets and lift per lifted unit: month × cycle, nothing without inlets / lift', () => {
  const heads = [H('water', 'per_inlet', 150), H('lift', 'per_lifted_unit', 400)];
  assert.deepEqual(unitCharges(U({ inlets: 2, lifted: true }), heads, '2026-10').map((r) => [r.head_id, r.amount, r.basis]), [['water', 300, '2 inlet(s) × 150'], ['lift', 400, 'per lifted unit']]);
  assert.deepEqual(unitCharges(U({ inlets: 3, lifted: true }), heads, '2026-Q3').map((r) => r.amount), [1350, 1200]);
  assert.deepEqual(unitCharges(U(), heads, '2026-10'), []);
  assert.match(validateUnit(U({ inlets: -1 }), []), /inlets/);
  assert.equal(hsList('bases', BASES, 'per_inlet'), 'Per inlet');
  assert.equal(hsList('bases', BASES, 'per_lifted_unit'), 'Per lifted unit');
});

test('the tariff save keeps heads on the new bases', () => {
  saveSocietySettings({ heads: [H('water', 'per_inlet', 150), H('lift', 'per_lifted_unit', 400)] });
  assert.deepEqual(readSocietySettings().heads?.map((h) => h.basis), ['per_inlet', 'per_lifted_unit']);
});

test('the unit import reads inlets and lift yes / no', () => {
  const t = { headers: ['Flat No', 'Water inlets', 'Lift'], rows: [['A-1', '2', 'yes'], ['A-2', '', 'no'], ['A-3', '1', 'maybe']] };
  const p = planUnitsImport(t, guessUnitColumns(t.headers, scoreHeader), [], []);
  assert.deepEqual(p.rows.map((r) => [r.unit.inlets, r.unit.lifted, !!r.error]), [[2, true, false], [undefined, false, false], [1, undefined, true]]);
});
