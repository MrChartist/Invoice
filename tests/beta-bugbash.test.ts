/**
 * Regressions found by the beta bug-bash (driving the built app with Playwright).
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { createViaStore, installSettings, reload } from './helpers/world.ts';
import { dueAfterIssueChange } from '../src/lib/dates.ts';
import { bulkMarkPaid } from '../src/lib/invoice-list.ts';
import { createCreditNote } from '../src/lib/documents.ts';
import { localDb } from '../src/lib/localDb.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('moving the issue date keeps the credit period instead of the old due date', () => {
  // Back-dating a new invoice (due today + 14) to last March: due 14 days after the new date, not in November.
  assert.equal(dueAfterIssueChange('2026-10-25', '2026-11-08', '2026-03-20'), '2026-04-03');
  // Across a month / leap day.
  assert.equal(dueAfterIssueChange('2028-02-01', '2028-03-02', '2028-02-15'), '2028-03-16');
  // Due on receipt stays on the issue date.
  assert.equal(dueAfterIssueChange('2026-10-25', '2026-10-25', '2026-11-01'), '2026-11-01');
  // Incomplete input (a date field mid-typing) or an odd stored pair leaves the due date alone.
  assert.equal(dueAfterIssueChange('2026-10-25', '2026-11-08', ''), '2026-11-08');
  assert.equal(dueAfterIssueChange('', '2026-11-08', '2026-03-20'), '2026-11-08');
  assert.equal(dueAfterIssueChange('2026-10-25', '2026-10-01', '2026-03-20'), '2026-10-01');
  assert.equal(dueAfterIssueChange('2026-10-25', '2026-11-08', '0002-03-20'), '2026-11-08');
});

test('bulk "mark paid" records only what is owed after credit notes, never the credited part as cash', () => {
  const inv = createViaStore({ date: '2026-04-10', lines: [{ name: 'Steel bracket', qty: 10, rate: 250 }] });
  assert.equal(inv.total, 2950);
  const item = reload(inv.id).items[0];
  createCreditNote(reload(inv.id), { reason: 'Discount', lines: [{ itemId: item.id, quantity: 2 }] });
  const r = bulkMarkPaid([inv.id], { method: 'Bank Transfer', date: '2026-04-20' });
  assert.equal(r.total, 2360);
  assert.deepEqual(localDb.payments.listFor(inv.id).map((p) => p.amount), [2360]);

  // An invoice fully covered by credit notes has nothing to collect.
  const small = createViaStore({ date: '2026-04-11', lines: [{ name: 'Widget', qty: 1, rate: 100 }] });
  createCreditNote(reload(small.id), { reason: 'Discount', lines: [{ itemId: reload(small.id).items[0].id, quantity: 1 }] });
  const r2 = bulkMarkPaid([small.id], { method: 'UPI', date: '2026-04-21' });
  assert.equal(r2.paid.length, 0);
  assert.equal(r2.skipped[0]?.reason, 'nothing to collect');
  assert.equal(localDb.payments.listFor(small.id).length, 0);
});
