import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, SELLER, BUYER_KA, BUYER_MH } from './helpers/world.ts';
import { isSaveShortcut, lineKeyAction } from '../src/components/creator/line-keys.ts';
import { localDb } from '../src/lib/localDb.ts';
import { useInvoiceStore } from '../src/store/useInvoiceStore.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('Enter in the last cell of the last line adds a line; of an earlier line, moves on', () => {
  assert.deepEqual(lineKeyAction({ key: 'Enter' }, { isLastCell: true, isLastLine: true }), { type: 'add-line' });
  assert.deepEqual(lineKeyAction({ key: 'Enter' }, { isLastCell: true, isLastLine: false }), { type: 'next-line' });
  assert.equal(lineKeyAction({ key: 'Enter' }, { isLastCell: false, isLastLine: true }), null, 'only the last cell reacts');
  assert.equal(lineKeyAction({ key: 'Enter', shiftKey: true }, { isLastCell: true, isLastLine: true }), null);
  assert.equal(lineKeyAction({ key: 'Enter', ctrlKey: true }, { isLastCell: true, isLastLine: true }), null, 'Ctrl+Enter is save, not a new line');
});

test('Alt+Up / Alt+Down move the line; plain arrows and Ctrl/Cmd+Alt do not', () => {
  const ctx = { isLastCell: false, isLastLine: false };
  assert.deepEqual(lineKeyAction({ key: 'ArrowUp', altKey: true }, ctx), { type: 'move', direction: -1 });
  assert.deepEqual(lineKeyAction({ key: 'ArrowDown', altKey: true }, ctx), { type: 'move', direction: 1 });
  assert.equal(lineKeyAction({ key: 'ArrowUp' }, ctx), null);
  assert.equal(lineKeyAction({ key: 'ArrowUp', altKey: true, metaKey: true }, ctx), null);
});

test('Ctrl/Cmd+Enter is the save shortcut', () => {
  assert.equal(isSaveShortcut({ key: 'Enter', ctrlKey: true }), true);
  assert.equal(isSaveShortcut({ key: 'Enter', metaKey: true }), true);
  assert.equal(isSaveShortcut({ key: 'Enter' }), false);
  assert.equal(isSaveShortcut({ key: 's', ctrlKey: true }), false);
});

test('moveItem swaps neighbours and stops at the ends (what Alt+Arrow calls)', () => {
  const st = () => useInvoiceStore.getState();
  st().newDraft('INVOICE');
  st().addItem();
  st().addItem();
  const [a, b, c] = st().items.map((i) => i.id);
  st().moveItem(b, -1);
  assert.deepEqual(st().items.map((i) => i.id), [b, a, c]);
  st().moveItem(b, -1); // already first
  assert.deepEqual(st().items.map((i) => i.id), [b, a, c]);
  st().moveItem(c, 1); // already last
  assert.deepEqual(st().items.map((i) => i.id), [b, a, c]);
});

test('a client GSTIN auto-fills the place of supply and flips CGST/SGST vs IGST', () => {
  const st = () => useInvoiceStore.getState();
  st().newDraft('INVOICE');
  st().setSender(SELLER); // Maharashtra
  st().setClient({ name: 'Karnataka Tech', gstin: BUYER_KA });
  assert.equal(st().place_of_supply, '29');
  assert.equal(st().gst_mode, 'IGST');
  st().setClient({ gstin: BUYER_MH });
  assert.equal(st().place_of_supply, '27');
  assert.equal(st().gst_mode, 'CGST_SGST');
  assert.equal(localDb.settings.activeProfile()?.stateCode, '27');
});
