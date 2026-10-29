/**
 * R20-B voucher and document entry: the entry actions (delete / cancel with Undo through the recycle bin and the
 * reinstate path, duplicate route), remove-line Undo, the narration lookup, PgUp / PgDn order, the row matcher of
 * screens that read their own keys, and voucher variants written through saveVoucher.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadStorage, resetStorage } from './helpers/shim.ts';
import { SINGLETON_KEYS, getTable, setJson } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import { A, loadVouchers, saveVoucher } from '../src/lib/ledger/index.ts';
import { inBooks } from '../src/lib/ledger/voucher-variants.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { cancelEntry, deleteEntry, duplicateRoute, lastText, rowFor, stepId, undoCancel, undoDelete, withoutLine } from '../src/lib/keys/entry-actions.ts';
import { BUILT, rowById } from '../src/lib/keys/registry.ts';
import { setKeysLayout, setKeysMode } from '../src/lib/keys/stub.ts';
import { createViaStore, installSettings } from './helpers/world.ts';

beforeEach(() => {
  resetStorage();
  setActorProvider(null);
});

const key = (k: string, mods: { ctrl?: boolean; alt?: boolean; code?: string } = {}, target?: unknown) =>
  ({ key: k, code: mods.code, ctrlKey: !!mods.ctrl, metaKey: false, altKey: !!mods.alt, shiftKey: false, target: target as EventTarget }) as const;

test('B is built and its rows exist', () => {
  assert.ok(BUILT.has('B'));
  for (const id of ['accept.editor', 'delete.editor', 'cancel.editor', 'dup.editor', 'rmLine', 'postDated', 'optional', 'narrType', 'prevV.voucher', 'rejIn']) assert.ok(rowById(id), id);
  assert.equal(rowById('rejIn')!.route, '/invoice?type=CREDIT_NOTE&rej=1', 'Ctrl+F6 opens a credit note with goods came back');
});

test('rowFor: layout, mode, fields (Ctrl+Alt never), field scopes', () => {
  (globalThis as { location?: unknown }).location = { pathname: '/expenses' };
  loadStorage({ mrchartist_tally_keys: 'on' });
  setKeysMode('on');
  setKeysLayout('prime');
  const input = { tagName: 'INPUT', closest: () => null };
  assert.equal(rowFor(key('a', { ctrl: true, code: 'KeyA' }, input), ['accept.bill'])?.id, 'accept.bill', 'Ctrl+A accepts from a field');
  assert.equal(rowFor(key('F2', {}, input), ['date.bill'])?.id, 'date.bill', 'F-keys fire in a field of a form');
  assert.equal(rowFor(key('PageUp', {}, input), ['prevV.voucher']), undefined, 'a plain key does not, unless anyField');
  assert.equal(rowFor(key('PageUp', {}, input), ['prevV.voucher'], true)?.id, 'prevV.voucher');
  assert.equal(rowFor(key('r', { ctrl: true, code: 'KeyR' }, input), ['narrType']), undefined, 'Ctrl+R only in a narration field');
  const narration = { tagName: 'TEXTAREA', closest: (s: string) => (s.includes('narration') ? {} : null) };
  assert.equal(rowFor(key('r', { ctrl: true, code: 'KeyR' }, narration), ['narrType'])?.id, 'narrType');
  assert.equal(rowFor(key('†', { alt: true, code: 'KeyT' }, input), ['postDated'], true)?.id, 'postDated', 'Mac Option: matched by e.code');
  setKeysMode('off');
  assert.equal(rowFor(key('a', { ctrl: true, code: 'KeyA' }, input), ['accept.bill']), undefined, 'simple mode: Ctrl+A selects all');
});

test('pure helpers: last narration, PgUp / PgDn order, remove line + Undo, duplicate route', () => {
  const rows = [
    { id: 'a', type: 'P', date: '2026-05-01', n: 'old rent' },
    { id: 'b', type: 'P', date: '2026-05-03', n: 'May rent' },
    { id: 'c', type: 'R', date: '2026-05-04', n: 'receipt' },
    { id: 'd', type: 'P', date: '2026-05-02', n: '' },
  ];
  assert.equal(lastText(rows, (r) => r.type === 'P', (r) => r.n, (r) => r.date), 'May rent');
  assert.equal(lastText(rows, (r) => r.type === 'P', (r) => r.n, (r) => r.date, 'b'), 'old rent', 'the open entry is left out');
  assert.equal(lastText(rows, () => false, (r) => r.n, (r) => r.date), '');
  const vs = [{ id: 'x', date: '2026-05-02', number: 'PV/10' }, { id: 'y', date: '2026-05-02', number: 'PV/9' }, { id: 'z', date: '2026-05-01', number: 'PV/11' }];
  assert.equal(stepId(vs, 'y', -1), 'z');
  assert.equal(stepId(vs, 'y', 1), 'x', 'numbers in numeric order within a day');
  assert.equal(stepId(vs, 'x', 1), undefined);
  const lines = [{ id: '1' }, { id: '2' }, { id: '3' }];
  const cut = withoutLine(lines, '2')!;
  assert.deepEqual(cut.lines.map((l) => l.id), ['1', '3']);
  assert.deepEqual(cut.undo([...cut.lines, { id: '4' }]).map((l) => l.id), ['1', '2', '3', '4'], 'back in its place');
  assert.equal(withoutLine(lines, 'nope'), null);
  assert.equal(duplicateRoute('invoice', 'i1'), '/invoice/i1?dup=1');
  assert.equal(duplicateRoute('voucher', 'v1', 'PAYMENT'), '/gateway/voucher/payment?dup=v1');
});

test('Alt+D on a document, then Undo: back from the recycle bin with its number; a second Undo is refused', async () => {
  installSettings();
  const inv = createViaStore({ date: '2026-05-11', lines: [{ qty: 1, rate: 200 }] });
  await deleteEntry('invoice', inv.id);
  assert.equal(localDb.invoices.getById(inv.id), undefined);
  await undoDelete('invoice', inv.id);
  assert.equal(localDb.invoices.getById(inv.id)?.invoice_number, inv.invoice_number);
  await assert.rejects(undoDelete('invoice', inv.id), /no longer in the recycle bin/);
});

test('Alt+D on a voucher and on a bill, then Undo through the bin', async () => {
  const v = saveVoucher({ type: 'JOURNAL', date: '2026-05-11', narration: 'rent', lines: [{ account_id: A.rent, dr: 1000, cr: 0 }, { account_id: A.cash, dr: 0, cr: 1000 }] });
  await deleteEntry('voucher', v.id);
  assert.equal(loadVouchers().length, 0);
  await undoDelete('voucher', v.id);
  assert.equal(loadVouchers()[0].number, v.number);
  const { purchasesDb } = await import('../src/lib/purchases.ts');
  const p = purchasesDb.save({ kind: 'PURCHASE', vendor_name: 'Sharma Supplies', bill_number: 'S-1', date: '2026-05-10', category: 'Goods', lines: [], taxable: 1000, cgst: 90, sgst: 90, igst: 0, itc_eligible: true, total: 1180, amount_paid: 0 });
  await deleteEntry('purchase', p.id);
  assert.equal(purchasesDb.get(p.id), undefined);
  await undoDelete('purchase', p.id);
  assert.equal(purchasesDb.get(p.id)?.bill_number, 'S-1');
});

test('Undo of a delete keeps the period lock: a locked day refuses the restore', async () => {
  installSettings();
  const inv = createViaStore({ date: '2026-05-11', lines: [{ qty: 1, rate: 200 }] });
  await deleteEntry('invoice', inv.id);
  setJson(SINGLETON_KEYS.settings, { ...localDb.settings.get(), lock_until: '2026-05-31' });
  await assert.rejects(undoDelete('invoice', inv.id));
  assert.equal(localDb.invoices.getById(inv.id), undefined);
});

test('Alt+X cancels with a reason; Undo restores the status it had', async () => {
  installSettings();
  const inv = createViaStore({ date: '2026-05-11', lines: [{ qty: 1, rate: 200 }] });
  const before = localDb.invoices.getById(inv.id)!.status;
  await assert.rejects(cancelEntry(inv.id, '  '), /reason/);
  await cancelEntry(inv.id, 'Wrong party');
  assert.equal(localDb.invoices.getById(inv.id)!.status, 'Cancelled');
  await undoCancel(inv.id);
  assert.equal(localDb.invoices.getById(inv.id)!.status, before);
});

test('rights apply: a viewer cannot delete through the entry actions', async () => {
  installSettings();
  const inv = createViaStore({ date: '2026-05-11', lines: [{ qty: 1, rate: 200 }] });
  setActorProvider(() => ({ id: 'u1', name: 'Viewer', role: 'viewer' }));
  await assert.rejects(deleteEntry('invoice', inv.id));
  await assert.rejects(deleteEntry('voucher', 'nope'));
  setActorProvider(null);
  assert.ok(localDb.invoices.getById(inv.id));
});

test('Alt+T / Ctrl+L: post-dated and optional vouchers saved through saveVoucher stay out of the books', () => {
  const base = { type: 'PAYMENT' as const, narration: '', lines: [{ account_id: A.rent, dr: 500, cr: 0 }, { account_id: A.cash, dr: 0, cr: 500 }] };
  const pd = saveVoucher({ ...base, date: '2026-06-30', post_dated: true });
  const op = saveVoucher({ ...base, date: '2026-05-10', variant: 'OPTIONAL' });
  const stored = getTable<{ id: string; post_dated?: boolean; variant?: string }>('vouchers');
  assert.equal(stored.find((v) => v.id === pd.id)?.post_dated, true);
  assert.equal(stored.find((v) => v.id === op.id)?.variant, 'OPTIONAL');
  assert.equal(inBooks(pd, '2026-05-15'), false);
  assert.equal(inBooks(op, '2026-05-15'), false);
});
