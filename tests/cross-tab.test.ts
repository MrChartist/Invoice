import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { createViaStore, installSettings } from './helpers/world.ts';
import { changedElsewhereSince, externalVersion, isSharedDataKey, noteExternalChange, resetCrossTab, subscribeExternal } from '../src/lib/cross-tab.ts';
import { STALE_COPY_MESSAGE, useInvoiceStore } from '../src/store/useInvoiceStore.ts';
import { localDb } from '../src/lib/localDb.ts';

beforeEach(() => {
  resetStorage();
  resetCrossTab();
  installSettings();
});

test('only shared data keys count as external changes', () => {
  assert.equal(isSharedDataKey('mrchartist_inv_invoices'), true);
  assert.equal(isSharedDataKey(null), true, 'storage cleared in another tab');
  assert.equal(isSharedDataKey('mrchartist_inv_draft'), false, 'autosave while typing');
  assert.equal(isSharedDataKey('mrchartist_inv_auth'), false);
  assert.equal(isSharedDataKey('theme'), false);
  let calls = 0;
  const off = subscribeExternal(() => calls++);
  noteExternalChange('mrchartist_inv_draft');
  noteExternalChange('mrchartist_inv_clients', 1000);
  off();
  assert.equal(calls, 1);
  assert.equal(externalVersion(), 1);
  assert.equal(changedElsewhereSince('mrchartist_inv_clients', 999), true);
  assert.equal(changedElsewhereSince('mrchartist_inv_clients', 1000), false);
  assert.equal(changedElsewhereSince('mrchartist_inv_invoices', 0), false);
});

test('the editor refuses to save a stale copy over another tab\'s newer save', () => {
  const inv = createViaStore({ date: '2026-04-10', lines: [{ qty: 1, rate: 1000 }] });
  const st = () => useInvoiceStore.getState();
  assert.ok(st().loadInvoice(inv.id));
  st().setNotes('edited in tab A');

  // Tab B saves the same document; this tab hears about it through the storage event.
  localDb.invoices.save({ ...inv, notes: 'edited in tab B', updated_at: undefined });
  noteExternalChange('mrchartist_inv_invoices', Date.now() + 1);

  const r = st().saveInvoice();
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [STALE_COPY_MESSAGE]);
  assert.equal(localDb.invoices.getById(inv.id)?.notes, 'edited in tab B');

  // Reopening picks up the latest copy and saving works again.
  assert.ok(st().loadInvoice(inv.id));
  st().setNotes('merged');
  assert.equal(st().saveInvoice().ok, true);
  assert.equal(localDb.invoices.getById(inv.id)?.notes, 'merged');
});
