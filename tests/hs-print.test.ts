/** R18-A4 society paper: rows and heads from the snapshot only; the line sub-text; old invoices print unchanged. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodText, societyPaper } from '../src/lib/society/hs-print.ts';
import { hsLineText, trackingText } from '../src/components/templates/paper-helpers.ts';
import type { HsSnapshot } from '../src/types/society-r18.ts';

const hs: HsSnapshot = { unit: { id: 'u', code: 'A-101', wing: 'A', area: 600, members: ['Asha Rao', 'Ravi Rao'] }, period: '2026-10', due: '2026-10-20', heads: [{ head_id: 'svc', name: 'Service charges', kind: 'service', basis: 'per unit', amount: 3000, line_id: 'l1' }] };

test('rows and heads come from the snapshot only', () => {
  const p = societyPaper(hs);
  assert.deepEqual(p.rows, [['Unit', 'A-101'], ['Area', '600 sq ft'], ['Member', 'Asha Rao, Ravi Rao'], ['Period', 'Oct 2026'], ['Due by', '20/10/2026']]);
  assert.equal(p.heads.length, 1);
  assert.deepEqual(societyPaper({ unit: { id: 'u', code: '101', wing: 'B', members: [] } }).rows, [['Unit', '101 (Wing B)']]);
  assert.equal(periodText('2026-Q3'), 'Oct 2026 – Dec 2026');
  assert.equal(periodText('2026-13'), '');
  assert.equal(societyPaper({ heads: Array.from({ length: 20 }, () => hs.heads![0]) }).heads.length, 16, 'at most 16 heads');
  assert.equal(hsLineText({ id: 'l1' }, hs), 'per unit');
  assert.equal(trackingText({ id: 'l1' } as never, undefined, undefined, undefined, undefined, undefined, hs), 'per unit');
});

test('old invoices print exactly as before', () => {
  assert.equal(hsLineText({ id: 'l1' }, undefined), '');
  assert.equal(hsLineText({ id: 'l2' }, hs), '');
  assert.equal(trackingText({ id: 'l1', batch_no: 'B1' } as never), 'Batch B1');
  assert.deepEqual(societyPaper({}), { rows: [], heads: [] }, 'an empty snapshot prints no block (SocietyBlock returns null)');
});

test('PENDING #6: "How your bill is worked out" prints from the snapshot when hs.explain is set; the run sets it unless switched off', async () => {
  const snap: HsSnapshot = { ...hs, explain: true, regime: 'exempt77c', test: { counted: 15000, limit: 7500, months: 3 }, heads: [...hs.heads!, { head_id: 'ptx', name: 'Property tax', kind: 'statutory', basis: 'as assessed', amount: 1200 }], interest: { amount: 50, from: '2026-07-21', to: '2026-09-30', pct: 12, on: 5000, through: '2026-09-30' } };
  assert.deepEqual(societyPaper(snap).explain, [
    'Service charges: per unit = ₹3,000.00',
    'Property tax: as assessed = ₹1,200.00',
    'GST test: member contributions ₹5,000.00 a month against the ₹7,500.00 a month limit.',
    'Statutory dues are collected for the authority and passed on, outside GST.',
    'Interest: 12 % a year, simple, on ₹5,000.00 from 21/07/2026 to 30/09/2026.',
  ]);
  assert.equal('explain' in societyPaper(hs), false, 'a bill without the flag prints as before');
  const { planSocietyRun } = await import('../src/lib/society/hs-run.ts');
  const unit = { id: 'u1', code: 'A-101', use: 'residential', occupancy: 'owner', parking: [], status: 'active', updated_at: '', owner_id: 'c1' } as const;
  const heads = [{ id: 'svc', name: 'Service', kind: 'service', basis: 'per_unit', rate: 3000, active: true }] as const;
  const ctx = (settings = {}) => ({ date: '2026-10-01', due: '2026-10-15', registered: true, settings, clients: [{ id: 'c1', name: 'Asha', email: '', address: '', city: '', zip: '' }], invoices: [], runId: 'r', passText: '' });
  assert.equal(planSocietyRun('2026-10', [{ ...unit, parking: [] }], [...heads], ctx()).bills[0].hs.explain, true);
  assert.equal(planSocietyRun('2026-10', [{ ...unit, parking: [] }], [...heads], ctx({ explain: false })).bills[0].hs.explain, undefined);
});
