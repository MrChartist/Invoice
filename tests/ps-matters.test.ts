/** PS-A2 matters on project cost centres: code suggestion and uniqueness, parties, close / reopen, the legal conflict-check rule. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { loadCostCentres } from '../src/lib/cost-centres.ts';
import { clientCode, isMatter, loadMatters, saveMatter, setMatterClosed, suggestCode, validateMatter } from '../src/lib/prof/ps-matters.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
afterEach(() => setActorProvider(null));

const m = (code: string, extra = {}) => ({ code, kind: 'matter' as const, opened: '2026-05-01', parties: [], ...extra });

test('client code from Client.ps.code or initials; next free sequence', () => {
  assert.equal(clientCode({ name: 'M/s Rajesh Sharma & Kumar Pvt Ltd' }), 'RSK');
  assert.equal(clientCode({ name: 'Acme', ps: { code: 'acm' } }), 'ACM');
  assert.equal(suggestCode('rsk', [{ ps: m('RSK/013') }, { ps: m('RSK/002') }, { ps: m('ABC/099') }]), 'RSK/014');
  assert.equal(suggestCode('NEW', []), 'NEW/001');
});

test('save, unique code, parties cleaned, the board fields kept, close / reopen', () => {
  const row = saveMatter({ name: 'Sec 138 NI Act — Delhi', client_id: 'c1', fee_budget: 60000, ps: m('rsk/014', { court: ' Saket ', parties: [{ name: ' Shree Traders ', role: 'opposite', pan: 'aabcs1234a' }] }) });
  assert.equal(row.kind, 'project');
  assert.deepEqual(row.ps, { code: 'RSK/014', kind: 'matter', opened: '2026-05-01', court: 'Saket', parties: [{ name: 'Shree Traders', role: 'opposite', pan: 'AABCS1234A' }] });
  assert.equal(row.fee_budget, 60000, 'R3-B budget kept');
  assert.equal(loadCostCentres()[0].ps?.code, 'RSK/014', 'ps survives the cost-centre reader');
  assert.throws(() => saveMatter({ name: 'Other', ps: m('RSK/014') }), /already used/);
  assert.equal(validateMatter(m('X', { parties: [{ name: '', role: 'client' }] }), undefined, []), 'Every party needs a name and a role.');
  const closed = setMatterClosed(row.id, '2026-09-30');
  assert.equal(closed.ps?.closed, '2026-09-30');
  assert.equal(closed.status, 'done');
  assert.equal(setMatterClosed(row.id, undefined).ps?.closed, undefined);
  assert.equal(loadMatters().length, 1);
  assert.ok(isMatter(loadCostCentres()[0]));
});

test('legal profile: a conflict check first, or the owner skips with a reason; a clerk cannot skip', () => {
  installSettings({ prof_kind: 'legal' } as never);
  assert.throws(() => saveMatter({ name: 'A', ps: m('A/001') }), /conflict check/);
  assert.ok(saveMatter({ name: 'B', ps: m('B/001', { conflict_id: 'cc1' }) }).id);
  assert.ok(saveMatter({ name: 'C', ps: m('C/001', { skip_reason: 'Urgent bail' }) }).id);
  setActorProvider(() => ({ id: 'u2', name: 'Clerk', role: 'clerk' }));
  assert.throws(() => saveMatter({ name: 'D', ps: m('D/001', { skip_reason: 'x' }) }));
});
