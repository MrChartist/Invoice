/**
 * 8B · Phone & counter: calculator fields (8.25), bills on hold (8.21), quick-item tiles and stock
 * colours (8.22), share-backup gating (8.20), share-target routing (8.23), contacts (8.24), Web
 * Bluetooth chunking (8.26), phone backup nudges.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { evalExpression, isExpression } from '../src/lib/calc-expr.ts';
import { MAX_HELD, POS_HELD_KEY, holdCart, loadHeld, parseHeld, recallCart, saveHeld, type HeldCart } from '../src/lib/pos-hold.ts';
import { favouriteItems, frequentItems, groupTabs, parseFavs, stockClass, toggleFav, topGroup } from '../src/lib/pos-tiles.ts';
import { shareBackupGate, shareFileNames } from '../src/lib/backup-share.ts';
import { classifyShared, routeShared, stashShared, takeShared } from '../src/lib/share-inbox.ts';
import { contactToFields } from '../src/lib/contact-pick.ts';
import { BLE_CHUNK, chunkBytes, loadPrinterPrefs, POS_PRINTER_KEY } from '../src/lib/escpos.ts';
import { PHONE_NUDGE_DOCS, docsSinceBackup, phoneBackupDue } from '../src/lib/phone-backup.ts';
import { posShortcut } from '../src/lib/pos.ts';
import { DB_PREFIX, DEVICE_DRAFT_KEYS, readRaw, writeRaw } from '../src/lib/storage.ts';
import { buildBackup, parseBackup } from '../src/lib/backup.ts';
import { isSyncedKey } from '../src/lib/sync-engine.ts';
import { isSharedDataKey } from '../src/lib/cross-tab.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => resetStorage());

/* ── 8.25 calculator ─────────────────────────────────────────── */

test('calc: arithmetic with precedence, brackets, unary minus and x / × / ÷', () => {
  assert.equal(evalExpression('120*3+40'), 400);
  assert.equal(evalExpression('2.5 x 4'), 10);
  assert.equal(evalExpression('2.5×4'), 10);
  assert.equal(evalExpression('(80+20)/2'), 50);
  assert.equal(evalExpression('100÷8'), 12.5);
  assert.equal(evalExpression('10-2-3'), 5, 'left associative');
  assert.equal(evalExpression('2*(3+4)*5'), 70);
  assert.equal(evalExpression('-5+10'), 5);
  assert.equal(evalExpression('5--3'), 8);
  assert.equal(evalExpression('0.1+0.2'), 0.3, 'rounded to 6 decimals');
  assert.equal(evalExpression('1,250 + 250'), 1500, 'thousands separators ignored');
  assert.equal(evalExpression('42'), 42);
  assert.equal(evalExpression('.5*4'), 2);
});

test('calc: shop-calculator percent', () => {
  assert.equal(evalExpression('1000+18%'), 1180);
  assert.equal(evalExpression('1000-10%'), 900);
  assert.equal(evalExpression('200*10%'), 20);
  assert.equal(evalExpression('50%'), 0.5);
});

test('calc: incomplete, invalid or hostile input is null (no eval)', () => {
  for (const bad of ['', '120*', '(1+2', '1+2)', '1/0', '2**3', 'alert(1)', 'constructor', '1e5', '1..2', '()', '*3', `${'('.repeat(30)}1${')'.repeat(30)}`, '1+'.repeat(80) + '1']) {
    assert.equal(evalExpression(bad), null, bad);
  }
});

test('calc: what counts as an expression', () => {
  assert.equal(isExpression('120'), false);
  assert.equal(isExpression('-5'), false);
  assert.equal(isExpression('1.5'), false);
  assert.equal(isExpression('120*3'), true);
  assert.equal(isExpression('3+'), true);
  assert.equal(isExpression('(2'), true);
  assert.equal(isExpression('18%'), true);
});

/* ── 8.21 bills on hold ──────────────────────────────────────── */

const line = (id: string, name = 'Soap', extra: Partial<InvoiceItem> = {}): InvoiceItem =>
  ({ id, name, type: 'Product', unit: 'PCS', quantity: 1, rate: 10, amount: 10, ...extra }) as InvoiceItem;
const cart = (id: string, extra: Partial<HeldCart> = {}): HeldCart => ({ id, held_at: '2026-10-25T10:00:00.000Z', items: [line(`${id}-l`)], total: 10, ...extra });

test('hold: up to nine carts, oldest first; an empty cart and a tenth are refused', () => {
  let list: HeldCart[] = [];
  assert.deepEqual(holdCart(list, { ...cart('x'), items: [] }), { ok: false, reason: 'empty' });
  for (let i = 1; i <= MAX_HELD; i++) {
    const r = holdCart(list, cart(`c${i}`));
    assert.ok(r.ok);
    list = r.list;
  }
  assert.equal(list.length, 9);
  assert.deepEqual(holdCart(list, cart('c10')), { ok: false, reason: 'full' });
  assert.equal(list[0].id, 'c1');
});

test('recall: takes the cart out; a cart already recalled elsewhere gives null', () => {
  const list = [cart('a'), cart('b')];
  const r = recallCart(list, 'a');
  assert.equal(r.cart?.id, 'a');
  assert.deepEqual(r.list.map((c) => c.id), ['b']);
  assert.equal(recallCart(r.list, 'a').cart, null);
});

test('hold storage: survives a reload (company store), tolerant parsing, cleared when empty', () => {
  const c = cart('k', { client: { id: 'cl1', name: 'Asha Stores' } as HeldCart['client'], tender: { Cash: 5, UPI: 5, Card: 0 }, upi_ref: 'UTR1', name: '', dispatch: true });
  saveHeld([c]);
  const back = loadHeld();
  assert.equal(back.length, 1);
  assert.equal(back[0].client?.name, 'Asha Stores');
  assert.deepEqual(back[0].tender, { Cash: 5, UPI: 5, Card: 0 });
  assert.equal(back[0].upi_ref, 'UTR1');
  assert.equal(back[0].dispatch, true);
  assert.deepEqual(parseHeld('not json'), []);
  assert.deepEqual(parseHeld(JSON.stringify([{ id: 'x', items: [] }, { id: 'y', items: [{ nope: 1 }] }, 'z', null])), []);
  assert.equal(parseHeld(JSON.stringify(Array.from({ length: 12 }, (_, i) => cart(`m${i}`)))).length, MAX_HELD, 'keeps the newest nine');
  saveHeld([]);
  assert.equal(readRaw(POS_HELD_KEY), null);
});

test('hold storage: never in a backup, never synced, not announced to other tabs', () => {
  assert.ok(DEVICE_DRAFT_KEYS.includes(POS_HELD_KEY));
  writeRaw(`${DB_PREFIX}clients`, JSON.stringify([{ id: 'c1', name: 'Kept' }]));
  saveHeld([cart('h')]);
  const backup = buildBackup();
  assert.ok(!(POS_HELD_KEY in backup.data), 'left out of the backup');
  assert.ok(`${DB_PREFIX}clients` in backup.data);
  // A doctored backup carrying the key does not restore it either.
  const parsed = parseBackup(JSON.stringify({ ...backup, data: { ...backup.data, [POS_HELD_KEY]: JSON.stringify([cart('evil')]) } }));
  assert.ok(!(POS_HELD_KEY in parsed.data));
  assert.equal(isSyncedKey(POS_HELD_KEY), false);
  assert.equal(isSharedDataKey(POS_HELD_KEY), false);
});

test('POS keys: Shift+F8 holds, F1 lists bills on hold; F8 is still a new bill', () => {
  assert.equal(posShortcut({ key: 'F8', shiftKey: true }), 'hold');
  assert.equal(posShortcut({ key: 'F1' }), 'held');
  assert.equal(posShortcut({ key: 'F8' }), 'new');
  assert.equal(posShortcut({ key: 'F1', ctrlKey: true }), null);
});

/* ── 8.22 tiles & stock colours ──────────────────────────────── */

test('tiles: top-level stock groups with items; favourites, else most sold', () => {
  const groups = [
    { id: 'g1', name: 'Vegetables' },
    { id: 'g2', name: 'Leafy', parent_id: 'g1' },
    { id: 'g3', name: 'Sweets' },
    { id: 'g4', name: 'Loop A', parent_id: 'g5' },
    { id: 'g5', name: 'Loop B', parent_id: 'g4' },
  ];
  assert.equal(topGroup('g2', groups)?.id, 'g1');
  assert.ok(topGroup('g4', groups), 'a stored cycle still ends');
  const sources = [line('i1', 'Spinach'), line('i2', 'Ladoo'), line('i3', 'Tomato'), line('i4', 'Pen')];
  const stock = [{ name: 'spinach', group_id: 'g2' }, { name: 'Ladoo', group_id: 'g3' }, { name: 'Tomato', group_id: 'g1' }];
  const tabs = groupTabs(sources, stock, groups);
  assert.deepEqual(tabs.map((t) => [t.name, t.items.map((i) => i.name)]), [['Sweets', ['Ladoo']], ['Vegetables', ['Spinach', 'Tomato']]]);
  assert.deepEqual(groupTabs(sources, stock, []), []);

  const bills = [
    { pos: true, status: 'Paid', items: [line('a', 'Tomato'), line('b', 'Tomato'), line('c', 'Pen')] },
    { pos: true, status: 'Paid', items: [line('d', 'Tomato')] },
    { pos: true, status: 'Cancelled', items: [line('e', 'Pen'), line('f', 'Pen')] },
    { status: 'Paid', items: [line('g', 'Ladoo')] },
  ] as unknown as InvoiceRecord[];
  assert.deepEqual(frequentItems(sources, bills).map((i) => i.name), ['Tomato', 'Pen'], 'counted per bill, POS only, cancelled left out');
  assert.deepEqual(favouriteItems(sources, ['i4', 'gone'], bills).map((i) => i.name), ['Pen']);
  assert.deepEqual(favouriteItems(sources, [], bills).map((i) => i.name), ['Tomato', 'Pen']);
  assert.deepEqual(toggleFav(toggleFav([], 'i1'), 'i1'), []);
  assert.deepEqual(parseFavs('["a",1,"b"]'), ['a', 'b']);
  assert.deepEqual(parseFavs('{oops'), []);
});

test('stock class: zero and below zero are flagged (red); untracked is null', () => {
  assert.equal(stockClass(0), 'zero');
  assert.equal(stockClass(-2), 'neg');
  assert.equal(stockClass(3), 'ok');
  assert.equal(stockClass(null), null);
  assert.equal(stockClass(Number.NaN), null);
});

/* ── 8.20 share backup gating ────────────────────────────────── */

test('share gate: owner only; stored key first; a typed passphrase; plain only on request and never in vault mode', () => {
  assert.deepEqual(shareBackupGate({ owner: false, vault: false, hasKey: true }), { ok: false, reason: 'denied' });
  assert.deepEqual(shareBackupGate({ owner: false, vault: false, hasKey: false, allowPlain: true }), { ok: false, reason: 'denied' });
  assert.deepEqual(shareBackupGate({ owner: true, vault: true, hasKey: true }), { ok: true, mode: 'key' });
  assert.deepEqual(shareBackupGate({ owner: true, vault: false, hasKey: false }), { ok: false, reason: 'needs-passphrase' });
  assert.deepEqual(shareBackupGate({ owner: true, vault: false, hasKey: false, passphrase: 'short' }), { ok: false, reason: 'short-passphrase' });
  assert.deepEqual(shareBackupGate({ owner: true, vault: true, hasKey: false, passphrase: 'long enough pass' }), { ok: true, mode: 'passphrase' });
  assert.deepEqual(shareBackupGate({ owner: true, vault: false, hasKey: false, allowPlain: true }), { ok: true, mode: 'plain' });
  assert.deepEqual(shareBackupGate({ owner: true, vault: true, hasKey: false, allowPlain: true }), { ok: false, reason: 'vault' });
});

test('share file names: .json first, then .txt for Android Chrome', () => {
  const names = shareFileNames(new Date(2026, 9, 25, 10), true);
  assert.deepEqual(names, [
    { name: 'mrchartist-invoice-backup-2026-10-25.encrypted.json', type: 'application/json' },
    { name: 'mrchartist-invoice-backup-2026-10-25.encrypted.txt', type: 'text/plain' },
  ]);
});

/* ── phone nudges ────────────────────────────────────────────── */

test('phone nudge: after 10 new documents or 3 days; snooze and "no data" respected', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  const base = { now, hasData: true, newDocs: 0 };
  assert.equal(phoneBackupDue({ ...base, lastIso: null }), true);
  assert.equal(phoneBackupDue({ ...base, lastIso: ago(2) }), false);
  assert.equal(phoneBackupDue({ ...base, lastIso: ago(73) }), true, 'over 3 days');
  assert.equal(phoneBackupDue({ ...base, lastIso: ago(2), newDocs: PHONE_NUDGE_DOCS }), true, '10 new documents');
  assert.equal(phoneBackupDue({ ...base, lastIso: ago(2), newDocs: PHONE_NUDGE_DOCS, snoozeUntilIso: ago(-5) }), false, 'snoozed');
  assert.equal(phoneBackupDue({ ...base, hasData: false, lastIso: null }), false);
});

test('docs since backup: invoices and purchases created after the last backup', () => {
  writeRaw(`${DB_PREFIX}invoices`, JSON.stringify([{ id: 'a', created_at: '2026-10-20T00:00:00Z' }, { id: 'b', created_at: '2026-10-24T00:00:00Z' }, { id: 'c' }]));
  writeRaw(`${DB_PREFIX}purchases`, JSON.stringify([{ id: 'p', created_at: '2026-10-25T00:00:00Z' }]));
  assert.equal(docsSinceBackup('2026-10-22T00:00:00Z'), 2);
  assert.equal(docsSinceBackup(null), 3);
});

/* ── 8.23 share target routing ───────────────────────────────── */

test('share target: backup / receipt / statement by name or type; the first file decides', () => {
  assert.equal(classifyShared('mrchartist-invoice-backup-2026-10-25.encrypted.json', ''), 'backup');
  assert.equal(classifyShared('backup.encrypted.txt', 'text/plain'), 'backup');
  assert.equal(classifyShared('IMG_2026.jpg', 'image/jpeg'), 'receipt');
  assert.equal(classifyShared('bill', 'application/pdf'), 'receipt');
  assert.equal(classifyShared('hdfc-oct.csv', 'text/comma-separated-values'), 'statement');
  assert.equal(classifyShared('sbi.xlsx', ''), 'statement');
  assert.equal(classifyShared('x', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'statement');
  assert.equal(classifyShared('virus.exe', 'application/octet-stream'), null);
  assert.deepEqual(routeShared([{ name: 'a.jpg', type: 'image/jpeg' }, { name: 'b.pdf', type: 'application/pdf' }, { name: 'c.csv', type: 'text/csv' }]), { kind: 'receipt', count: 2 });
  assert.deepEqual(routeShared([{ name: 'a.csv', type: 'text/csv' }, { name: 'b.csv', type: 'text/csv' }]), { kind: 'statement', count: 1 });
  assert.equal(routeShared([]), null);
  const f = new File(['x'], 'a.csv', { type: 'text/csv' });
  stashShared('statement', [f]);
  assert.equal(takeShared('receipt'), null);
  assert.equal(takeShared('statement')?.[0], f);
  assert.equal(takeShared('statement'), null, 'taken once');
});

/* ── 8.24 contacts ───────────────────────────────────────────── */

test('contact picker: first non-empty value of each field; Indian PIN kept as zip', () => {
  assert.deepEqual(contactToFields({ name: ['', ' Ravi Kumar '], tel: ['+91 98765 43210'], email: [], address: [{ addressLine: ['12 MG Road'], city: 'Pune', region: 'Maharashtra', postalCode: '411 001' }] }), {
    name: 'Ravi Kumar', phone: '+91 98765 43210', email: '', address: '12 MG Road, Maharashtra', city: 'Pune', zip: '411001',
  });
  assert.deepEqual(contactToFields({}), { name: '', phone: '', email: '', address: '' });
});

/* ── 8.26 Web Bluetooth ──────────────────────────────────────── */

test('Bluetooth: ESC/POS bytes split into GATT-sized writes; the mode is remembered per device', () => {
  const bytes = Uint8Array.from({ length: 400 }, (_, i) => i % 256);
  const parts = chunkBytes(bytes);
  assert.deepEqual(parts.map((p) => p.length), [BLE_CHUNK, BLE_CHUNK, 400 - 2 * BLE_CHUNK]);
  assert.deepEqual(Array.from(parts.flatMap((p) => Array.from(p))), Array.from(bytes));
  assert.deepEqual(chunkBytes(new Uint8Array(0)), []);
  localStorage.setItem(POS_PRINTER_KEY, JSON.stringify({ mode: 'bluetooth', width: 58, drawer: true }));
  assert.deepEqual(loadPrinterPrefs(), { mode: 'bluetooth', width: 58, drawer: true, baud: 9600 });
  localStorage.setItem(POS_PRINTER_KEY, JSON.stringify({ mode: 'telnet' }));
  assert.equal(loadPrinterPrefs().mode, 'browser', 'unknown modes fall back to browser print');
});
