/** R17-A4 manpower paper: rows, posts and sentence from the snapshot only; the line sub-text; old invoices print unchanged. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthText, mpPaper } from '../src/lib/manpower/mp-print.ts';
import { mpLineText, trackingText } from '../src/components/templates/paper-helpers.ts';
import type { MpSnapshot } from '../src/types/manpower-r17.ts';

const mp: MpSnapshot = { site: { id: 's', code: 'S-001', name: 'Sunrise Towers' }, month: '2026-10', regime: 'rcm', decl: 'Tax payable on reverse charge … Verify with your CA.', posts: [{ post: 'Guard (12 h)', sac: '998525', heads: 4, duties: 122, rate: 800, amount: 97600, line_id: 'l1', site: 'Sunrise Towers' }] };

test('rows, posts and sentence come from the snapshot only', () => {
  const p = mpPaper(mp);
  assert.deepEqual(p.rows, [['Site', 'S-001: Sunrise Towers'], ['Service month', 'Oct 2026']]);
  assert.equal(p.posts.length, 1);
  assert.equal(p.decl, mp.decl);
  assert.equal(monthText('2026-13x'), '');
  assert.equal(mpPaper({ posts: Array.from({ length: 20 }, () => mp.posts![0]) }).posts.length, 12, 'at most 12 summary rows');
  assert.equal(mpLineText({ id: 'l1' }, mp), 'Sunrise Towers · Guard (12 h) × 4 · 122 duties');
  assert.equal(trackingText({ id: 'l1' } as never, undefined, undefined, undefined, undefined, mp), 'Sunrise Towers · Guard (12 h) × 4 · 122 duties');
});

test('old invoices print exactly as before', () => {
  assert.equal(mpLineText({ id: 'l1' }, undefined), '');
  assert.equal(mpLineText({ id: 'l2' }, mp), '');
  assert.equal(trackingText({ id: 'l1', batch_no: 'B1' } as never), 'Batch B1');
  const empty = mpPaper({});
  assert.deepEqual([empty.rows, empty.posts, empty.decl], [[], [], ''], 'an empty snapshot prints no block (ManpowerBlock returns null)');
});
