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
