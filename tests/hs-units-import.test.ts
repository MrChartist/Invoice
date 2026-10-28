/** R18-A2 unit import (CSV / XLSX): column guess, preview plan, all-or-nothing write, member creation, one import_runs row. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { scoreHeader } from '../src/lib/import-mapping.ts';
import { guessUnitColumns, planUnitsImport, UNIT_IMPORT_TEMPLATE } from '../src/lib/society/hs-units-import.ts';
import { applyUnitsImport, loadUnits, saveUnit } from '../src/lib/society/hs-units-save.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const HEAD = ['Flat No', 'Wing', 'Carpet Area', 'Owner Name', 'Mobile', 'Tenant', 'Parking Slots'];
const sheet = (rows: string[][]) => ({ headers: HEAD, rows });

test('headers in the wild map to the template fields; the template lists every field', () => {
  const c = guessUnitColumns(HEAD, scoreHeader);
  assert.deepEqual(c, { code: 0, wing: 1, carpet_area: 2, owner: 3, phone: 4, tenant: 5, parking: 6 });
  assert.deepEqual(guessUnitColumns(UNIT_IMPORT_TEMPLATE.split(','), scoreHeader), Object.fromEntries(UNIT_IMPORT_TEMPLATE.split(',').map((f, i) => [f, i])));
});

test('plan: new and existing codes, tenant yes / no or a name, slots, unknown members listed, row errors block', () => {
  const cols = guessUnitColumns(HEAD, scoreHeader);
  saveUnit({ code: 'A-101', use: 'residential', occupancy: 'owner', parking: [], status: 'active', carpet_area: 500, construction_cost: 2000000 });
  const asha = localDb.clients.upsert({ name: 'Asha Rao', email: '', address: '', city: '', zip: '', phone: '9820000000' });
  const p = planUnitsImport(sheet([['a-101', 'A', '650', 'asha rao', '9820012345', 'no', '1'], ['A-102', 'A', '1,200', 'Ravi K', '', 'Tina S', '2'], ['', '', '', '', '', '', ''], ['A-103', 'A', '700', '', '', 'yes', 'P7, P8']]), cols, loadUnits(), localDb.clients.getAll());
  assert.deepEqual([p.create, p.update, p.errors], [2, 1, 0]);
  const [a101, a102, a103] = p.rows;
  assert.equal(a101.action, 'update');
  assert.equal(a101.unit.construction_cost, 2000000, 'columns not in the sheet are kept');
  assert.equal(a101.unit.carpet_area, 650);
  assert.match(a101.warning ?? '', /Asha Rao/, 'a different phone is a warning, the client is kept');
  assert.deepEqual([a102.unit.carpet_area, a102.unit.occupancy, a102.tenant, a102.unit.parking.map((s) => s.slot)], [1200, 'tenant', 'Tina S', ['P1', 'P2']]);
  assert.deepEqual([a103.unit.occupancy, a103.tenant, a103.unit.parking.map((s) => s.slot), a103.line], ['tenant', undefined, ['P7', 'P8'], 5]);
  assert.deepEqual(p.newMembers, ['Ravi K', 'Tina S']);
  assert.ok(asha);
  const bad = planUnitsImport(sheet([['A-1', '', '-5', '', '', '', ''], ['A-1', '', '', '', '', '', ''], ['A-2', '', 'abc', '', '', '', '']]), cols, [], []);
  assert.equal(bad.errors, 3);
  assert.match(bad.rows[1].error ?? '', /twice/);
  assert.throws(() => planUnitsImport({ headers: ['Owner'], rows: [] }, guessUnitColumns(['Owner'], scoreHeader), [], []), /code/);
});

test('apply: units, new members and links in one write; one import_runs row of kind society_units; errors write nothing', () => {
  const cols = guessUnitColumns(HEAD, scoreHeader);
  localDb.clients.upsert({ name: 'Asha Rao', email: '', address: '', city: '', zip: '', phone: '9820000000' });
  const r = applyUnitsImport(sheet([['A-101', 'A', '650', 'Asha Rao', '9999999999', '', '1'], ['A-102', 'A', '700', 'Ravi K', '9811111111', 'Tina S', '']]), cols, 'flats.xlsx');
  assert.deepEqual(r, { created: 2, updated: 0, members: 2 });
  const units = loadUnits();
  const clients = localDb.clients.getAll();
  const by = (n: string) => clients.find((c) => c.name === n)!;
  assert.equal(clients.length, 3);
  assert.equal(by('Asha Rao').phone, '9820000000', 'an existing client is never changed by the import');
  assert.equal(by('Ravi K').phone, '9811111111');
  assert.deepEqual(by('Ravi K').hs, { unit_ids: [units.find((u) => u.code === 'A-102')!.id], role: 'owner' });
  assert.equal(by('Tina S').hs?.role, 'tenant');
  const runs = getTable<{ kind: string; created: number; file_name?: string }>('import_runs');
  assert.deepEqual(runs.map((x) => [x.kind, x.created, x.file_name]), [['society_units', 2, 'flats.xlsx']]);
  assert.throws(() => applyUnitsImport(sheet([['A-103', '', '', 'New Person', '', '', ''], ['A-104', '', 'x', '', '', '', '']]), cols), /carpet_area/);
  assert.equal(loadUnits().length, 2, 'all or nothing');
  assert.equal(localDb.clients.getAll().length, 3);
  assert.equal(getTable('import_runs').length, 1);
});

test('the writer imports the registry; the view loads the reader, header scoring and backup lazily', () => {
  const save = readFileSync(new URL('../src/lib/society/hs-units-save.ts', import.meta.url), 'utf8');
  assert.match(save, /import '\.\/hs-registry'/);
  const view = readFileSync(new URL('../src/components/society/UnitsView.tsx', import.meta.url), 'utf8');
  assert.ok(!/^import [^\n]*(import-mapping|backup|file-read|xlsx)'/m.test(view), 'no static import of lazy import code');
  assert.match(view, /import\('\.\.\/\.\.\/lib\/import-mapping'\)/);
});

test('volume: a 2,000-unit sheet plans quickly', () => {
  const cols = guessUnitColumns(HEAD, scoreHeader);
  const rows = Array.from({ length: 2000 }, (_, i) => [`A-${i}`, 'A', '600', `M ${i}`, '', '', '1']);
  const t = performance.now();
  const p = planUnitsImport(sheet(rows), cols, [], []);
  assert.equal(p.create, 2000);
  assert.ok(performance.now() - t < 3000);
});
