/**
 * PENDING #18 (AG-A2): the vendor / client form "Farmer" section. A ticked party gets a cleaned `ag` (Aadhaar last four
 * only), a vendor also `principal_kind: 'agriculturist'`; other `ag` fields are kept; unticking removes them; both forms
 * mount the lazy row.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { farmerPatch } from '../src/lib/agri/ag-party-form.ts';

test('a ticked vendor becomes an agriculturist farmer; a client keeps its kind', () => {
  const v = farmerPatch(true, { code: 'f-0007', village: ' Rampur ', aadhaar_last4: '1234' }, { ag: { code: 'F-0007', centre_id: 'c1', bank: { account: '123' } } }, 'vendor');
  assert.equal(v.problem, '');
  assert.equal(v.patch.principal_kind, 'agriculturist');
  assert.deepEqual([v.patch.ag?.code, v.patch.ag?.village, v.patch.ag?.centre_id, v.patch.ag?.bank?.account], ['F-0007', 'Rampur', 'c1', '123']);
  const c = farmerPatch(true, { code: 'F-0002' }, {}, 'client');
  assert.deepEqual(c.patch, { ag: { code: 'F-0002', status: 'active', member: false } });
});

test('a full Aadhaar number or a missing code is refused; unticking clears the farmer', () => {
  assert.match(farmerPatch(true, { code: 'F-1', aadhaar_last4: '123456789012' }, {}, 'vendor').problem, /last 4/);
  assert.match(farmerPatch(true, { code: '' }, {}, 'vendor').problem, /code/);
  assert.deepEqual(farmerPatch(false, { code: 'F-1' }, { ag: { code: 'F-1' }, principal_kind: 'agriculturist' }, 'vendor').patch, { ag: undefined, principal_kind: undefined });
  assert.deepEqual(farmerPatch(false, { code: 'F-1' }, { ag: { code: 'F-1' }, principal_kind: 'registered' }, 'vendor').patch, { ag: undefined, principal_kind: 'registered' });
});

test('the vendor and client forms mount the lazy Farmer section', () => {
  for (const f of ['components/purchases/VendorsTab.tsx', 'components/modals/ClientFormModal.tsx']) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.match(src, /lazy\(\(\) => import\('\.\.\/agri\/FarmerPartyRow'\)\)/, f);
    assert.match(src, /if \(farmerProblem\) return setError\(farmerProblem\)/, f);
  }
});
