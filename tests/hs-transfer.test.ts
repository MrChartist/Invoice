/**
 * R18-C2 transfer of membership and the dues certificate: open dues need "dues settled"; the unit's owner, the history
 * and the members' `Client.hs` move in one write; later bills go to the new member. The certificate states the books'
 * figures (principal, interest to date, bills dated after the date) and is logged on the unit with its validity.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { saveSocietySettings } from '../src/lib/society/hs-settings.ts';
import { issueRun } from '../src/lib/society/hs-issue-io.ts';
import { issueCertificate, transferMembership } from '../src/lib/society/hs-dues-io.ts';
import { nextCertificate, transferError, transferUnit } from '../src/lib/society/hs-transfer.ts';
import type { HsHead, SocietyUnit } from '../src/types/society-r18.ts';
import type { Client, InvoiceRecord } from '../src/types/invoice.ts';

const unit: SocietyUnit = { id: 'u1', code: 'A-101', use: 'residential', occupancy: 'owner', parking: [], owner_id: 'c1', status: 'active', updated_at: '' };

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.settings.save({ ...localDb.settings.get(), society_kind: 'chs' });
  setTable('clients', [['c1', 'Asha Rao'], ['c2', 'Kiran Mehta']].map(([id, name]) => ({ id, name, email: '', address: '', city: '', zip: '' })));
  setTable('society_units', [unit]);
  const h: HsHead = { id: 'svc', name: 'Service', kind: 'service', basis: 'per_unit', rate: 3000, sac: '999598', active: true };
  saveSocietySettings({ state: '27', heads: [h], due_days: 19, certificate_validity_days: 15 });
});

test('pure rules: date, new member, same owner, open dues need the tick; the history keeps premium and the outgoing members', () => {
  const t = { date: '2026-11-10', to_id: 'c2', premium: 25000, dues_settled: false };
  assert.deepEqual([transferError(unit, { ...t, date: '' }, 0), transferError(unit, { ...t, to_id: '' }, 0), transferError(unit, { ...t, to_id: 'c1' }, 0), transferError(unit, t, 10), transferError(unit, t, 0), transferError(unit, { ...t, dues_settled: true }, 10)], ['date', 'to', 'same', 'dues', '', '']);
  const u = transferUnit({ ...unit, joint_ids: ['c9'] }, t, 'now');
  assert.deepEqual([u.owner_id, u.joint_ids, u.transfers], ['c2', [], [{ date: '2026-11-10', from_ids: ['c1', 'c9'], to_ids: ['c2'], premium: 25000, dues_settled: false }]]);
  assert.deepEqual(nextCertificate({ ...unit, certificates: [{ no: 'x', date: '', amount: 0, valid_till: '' }] }, '2026-11-05', 10.005), { no: 'A-101/DC/2', date: '2026-11-05', amount: 10.01, valid_till: '2026-12-05' });
});

test('transfer moves the member links and the next bill goes to the new member; refused while dues are open', () => {
  issueRun({ period: '2026-10', date: '2026-10-01', due: '2026-10-20' });
  assert.throws(() => transferMembership('u1', { date: '2026-10-25', to_id: 'c2', dues_settled: false }), /Dues are open/);
  transferMembership('u1', { date: '2026-10-25', to_id: 'c2', premium: 25000, dues_settled: true });
  const cl = getTable<Client>('clients');
  assert.equal(cl.find((c) => c.id === 'c1')!.hs, undefined);
  assert.deepEqual(cl.find((c) => c.id === 'c2')!.hs, { unit_ids: ['u1'], role: 'owner' });
  assert.equal(getTable<SocietyUnit>('society_units')[0].transfers!.length, 1);
  issueRun({ period: '2026-11', date: '2026-11-01', due: '2026-11-20' });
  assert.equal(getTable<InvoiceRecord>('invoices').find((i) => i.hs?.period === '2026-11')!.client.id, 'c2');
});

test('dues certificate: the books\' figures, a reference and its validity, logged on the unit', () => {
  issueRun({ period: '2026-10', date: '2026-10-01', due: '2026-10-20' });
  issueRun({ period: '2026-11', date: '2026-11-01', due: '2026-11-20' });
  const text = issueCertificate('u1', '2026-10-31');
  assert.match(text, /principal ₹3,000\.00, interest to date ₹0\.00, billed after the date ₹3,000\.00\. Total ₹6,000\.00\. Certificate A-101\/DC\/1, valid till 2026-11-15/);
  assert.deepEqual(getTable<SocietyUnit>('society_units')[0].certificates, [{ no: 'A-101/DC/1', date: '2026-10-31', amount: 6000, valid_till: '2026-11-15' }]);
});
