/** R18-A2 units and members: validation, uniqueness, clean rows, member links on clients, totals, volume (2,000 units). */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { cleanUnit, filterUnits, memberLinks, memberNames, sortUnits, suggestCode, unitTotals, unitWarnings, validateUnit, wingsOf } from '../src/lib/society/hs-units.ts';
import { addMember, loadUnits, saveUnit } from '../src/lib/society/hs-units-save.ts';
import type { SocietyUnit } from '../src/types/society-r18.ts';
import type { Client } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
const U = (code: string, o: Partial<SocietyUnit> = {}): SocietyUnit => ({ id: code, code, use: 'residential', occupancy: 'owner', parking: [], status: 'active', updated_at: '', ...o });

test('validation: code needed and unique (case / spaces ignored), numbers ≥ 0, undivided ≤ 100; the 100 % total is a warning', () => {
  assert.match(validateUnit(U(' '), []), /code/);
  assert.match(validateUnit(U('a-101 ', { id: 'n' }), [U('A-101')]), /already exists/);
  assert.equal(validateUnit(U('A-101'), [U('A-101')]), '', 'the same row edited');
  assert.match(validateUnit(U('A-1', { carpet_area: -1 }), []), /carpet_area/);
  assert.match(validateUnit(U('A-1', { construction_cost: Number.NaN }), []), /construction_cost/);
  assert.match(validateUnit(U('A-1', { undivided_pct: 101 }), []), /100/);
  assert.deepEqual(unitWarnings([U('A', { undivided_pct: 60 }), U('B', { undivided_pct: 40 })]), []);
  assert.match(unitWarnings([U('A', { undivided_pct: 60 }), U('B', { undivided_pct: 39.9 })])[0], /99\.9/);
  assert.deepEqual(unitWarnings([U('A', { undivided_pct: 60 }), U('B', { undivided_pct: 40 }), U('C', { undivided_pct: 10, status: 'closed' })]), [], 'closed units leave the total');
});

test('clean rows: trimmed code, no tenant unless let out, empty optionals dropped, C / D fields kept', () => {
  const c = cleanUnit({ ...U(' A-101 '), wing: '', tenant_id: 't', joint_ids: [], carpet_area: undefined, certificates: [{ no: 'C1', date: '2026-11-05', amount: 1, valid_till: '2026-12-05' }] }, 'now');
  assert.deepEqual([c.code, 'wing' in c, 'tenant_id' in c, 'joint_ids' in c, 'carpet_area' in c, c.certificates?.length, c.updated_at], ['A-101', false, false, false, false, 1, 'now']);
  assert.equal(cleanUnit(U('A', { occupancy: 'tenant', tenant_id: 't' })).tenant_id, 't');
});

test('filters, totals, order, wings and the next code', () => {
  const us = [U('A-10', { wing: 'A', carpet_area: 600, construction_cost: 2400000, parking: [{ slot: 'P1', kind: 'covered' }] }), U('A-2', { wing: 'A', carpet_area: 1500, occupancy: 'tenant', parking: [{ slot: 'P2', kind: 'open' }, { slot: 'P3', kind: 'covered' }] }), U('S-1', { use: 'commercial', carpet_area: 600 })];
  assert.deepEqual(unitTotals(us), { carpet: 2700, cost: 2400000, slots: 3 });
  assert.deepEqual(sortUnits(us).map((u) => u.code), ['A-2', 'A-10', 'S-1']);
  assert.deepEqual(filterUnits(us, { wing: 'A', occupancy: 'tenant' }).map((u) => u.code), ['A-2']);
  assert.deepEqual(filterUnits(us, { use: 'commercial' }).map((u) => u.code), ['S-1']);
  assert.deepEqual(wingsOf(us), ['A']);
  assert.equal(suggestCode(us, 'A'), 'A-11');
  assert.equal(suggestCode([], 'B'), 'B-101');
  assert.equal(suggestCode([]), 'U-1');
});

test('members: owner / joint / tenant roles on Client.hs (owner wins), unlinked when no unit is left; only changes returned', () => {
  const clients: Client[] = [{ id: 'o', name: 'Asha' }, { id: 'j', name: 'Ravi' }, { id: 't', name: 'Tina' }, { id: 'x', name: 'Old', hs: { unit_ids: ['gone'], role: 'owner' } }] as Client[];
  const units = [U('A-101', { owner_id: 'o', joint_ids: ['j'] }), U('A-102', { owner_id: 'j', occupancy: 'tenant', tenant_id: 't' }), U('A-103', { owner_id: 'o', status: 'closed' })];
  const out = new Map(memberLinks(units, clients).map((c) => [c.id, c.hs]));
  assert.deepEqual(out.get('o'), { unit_ids: ['A-101'], role: 'owner' });
  assert.deepEqual(out.get('j'), { unit_ids: ['A-101', 'A-102'], role: 'owner' });
  assert.deepEqual(out.get('t'), { unit_ids: ['A-102'], role: 'tenant' });
  assert.ok(out.has('x') && out.get('x') === undefined, 'no unit left: hs removed');
  const linked = clients.map((c) => ({ ...c, hs: out.has(c.id) ? out.get(c.id) : c.hs }));
  assert.deepEqual(memberLinks(units, linked), [], 'idempotent');
  assert.deepEqual(memberNames(units[0], new Map(clients.map((c) => [c.id!, c]))), ['Asha', 'Ravi']);
});

test('saveUnit writes the unit and its members; a duplicate code is refused and nothing changes', () => {
  const owner = addMember('Asha Rao');
  assert.equal(addMember(' asha rao '), owner, 'the same name is the same member');
  saveUnit({ code: 'A-101', use: 'residential', occupancy: 'owner', parking: [], status: 'active', owner_id: owner, carpet_area: 600 });
  const [u] = loadUnits();
  assert.equal(u.code, 'A-101');
  assert.deepEqual(localDb.clients.getById(owner)?.hs, { unit_ids: [u.id], role: 'owner' });
  assert.throws(() => saveUnit({ code: 'a-101', use: 'residential', occupancy: 'owner', parking: [], status: 'active' }), /already exists/);
  assert.equal(getTable('society_units').length, 1);
  saveUnit({ ...u, owner_id: undefined });
  assert.equal(localDb.clients.getById(owner)?.hs, undefined, 'unlinked when the owner is removed');
});

test('volume: 2,000 units link 2,000 members in one pass', () => {
  const clients = Array.from({ length: 2000 }, (_, i) => ({ id: `c${i}`, name: `M ${i}` })) as Client[];
  const units = Array.from({ length: 2000 }, (_, i) => U(`A-${i}`, { owner_id: `c${i}` }));
  const t = performance.now();
  assert.equal(memberLinks(units, clients).length, 2000);
  assert.ok(performance.now() - t < 1500, 'fast');
  assert.equal(unitTotals(units).slots, 0);
});
