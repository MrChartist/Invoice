/**
 * PERF-1 guard rails for the parsed-rows cache in `storage.ts`:
 *  - `getTable` stays safe to mutate (new array, new top-level rows), shared rows are frozen in tests;
 *  - no stale read after `setTable`, `writeRaw`, `removeRaw` or a change made behind the module's back;
 *  - snapshot tables follow the asset table;
 *  - parse counts per operation (a save parses `invoices` at most once; repeated readers never re-parse);
 *  - memoised results follow every key they read.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, loadStorage, resetStorage } from './helpers/shim.ts';
import {
  DB_PREFIX,
  getTable,
  peekTable,
  readRaw,
  removeRaw,
  resetParseCounts,
  resetStorageBackend,
  setTable,
  sharedRowsFrozen,
  storageVersion,
  tableParseCount,
  writeRaw,
} from '../src/lib/storage.ts';
import { memoOnReads, tableStamp } from '../src/lib/table-memo.ts';
import { decodeRows, parseAssets } from '../src/lib/assets.ts';
import { localDb } from '../src/lib/localDb.ts';
import { createViaStore, installSettings, SELLER } from './helpers/world.ts';
import { registerNotificationProvider, reusableVisibleNotifications, resetNotificationReuse, loadVisibleNotifications } from '../src/lib/notifications.ts';
import { editorStockContext } from '../src/lib/stock-tracking.ts';
import { loadPositions } from '../src/lib/inventory.ts';
import { backupTextParts, parseBackup, type BackupFile } from '../src/lib/backup.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const LOGO2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeEach(() => {
  resetStorageBackend();
  resetStorage();
  resetParseCounts();
});

/** What a fresh parse of the stored text gives (asset references resolved), for comparisons. */
function freshRows(name: string): unknown[] {
  const raw = readRaw(DB_PREFIX + name);
  if (!raw) return [];
  const rows = JSON.parse(raw) as unknown[];
  return name === 'invoices' || name === 'recurring' ? decodeRows(rows, parseAssets(readRaw(DB_PREFIX + 'assets'))) : rows;
}

function invoiceRows(n: number, logo = LOGO): InvoiceRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `inv${i}`, invoice_number: `INV/FY26-27/${String(i + 1).padStart(4, '0')}`, doc_type: 'INVOICE', status: 'Sent',
    issue_date: '2026-05-10', due_date: '2026-05-24', currency: 'INR', template_id: 't', total: 100 + i, amount_paid: 0, balance_due: 100 + i,
    client: { id: `c${i % 7}`, name: `Client ${i % 7}` }, sender: { ...SELLER, logo },
    items: [{ id: `l${i}`, name: 'Widget', quantity: 1, rate: 100 + i, tax_rate: 0, amount: 100 + i }],
  }) as unknown as InvoiceRecord);
}

test('the shared rows are deep-frozen under node --test (an in-place nested write throws)', () => {
  assert.equal(sharedRowsFrozen(), true);
  setTable('vendors', [{ id: 'v1', name: 'A', bank: { ifsc: 'X' } }]);
  const shared = peekTable<{ id: string; bank: { ifsc: string } }>('vendors');
  assert.throws(() => {
    (shared[0] as { id: string }).id = 'z';
  }, TypeError);
  const copy = getTable<{ id: string; bank: { ifsc: string } }>('vendors')[0];
  assert.throws(() => {
    copy.bank.ifsc = 'Y';
  }, TypeError, 'nested values of a getTable row are shared and frozen');
});

test('getTable hands out a new array of new rows: mutating them never reaches the cache', () => {
  setTable('clients', [{ id: 'a', name: 'Acme', tags: ['x'] }, { id: 'b', name: 'Bose' }]);
  const rows = getTable<{ id: string; name: string; tags?: string[] }>('clients');
  rows[0].name = 'Changed';
  rows[0].tags = [...(rows[0].tags ?? []), 'y'];
  rows.push({ id: 'c', name: 'New' });
  rows.reverse();
  const again = getTable<{ id: string; name: string; tags?: string[] }>('clients');
  assert.deepEqual(again, [{ id: 'a', name: 'Acme', tags: ['x'] }, { id: 'b', name: 'Bose' }]);
  assert.notEqual(again, rows);
  assert.notEqual(again[0], peekTable('clients')[0], 'getTable rows are copies, not the shared rows');
  assert.deepEqual(peekTable('clients'), freshRows('clients'));
});

test('no stale read after setTable, writeRaw, removeRaw or a change behind the module (another tab)', () => {
  setTable('vendors', [{ id: 'v1' }]);
  assert.deepEqual(peekTable('vendors'), [{ id: 'v1' }]);
  setTable('vendors', [{ id: 'v1' }, { id: 'v2' }]);
  assert.deepEqual(getTable('vendors'), [{ id: 'v1' }, { id: 'v2' }]);
  writeRaw(DB_PREFIX + 'vendors', '[{"id":"raw"}]');
  assert.deepEqual(peekTable('vendors'), [{ id: 'raw' }]);
  // Another tab on the localStorage backend: the stored text changes without passing through storage.ts.
  loadStorage({ [DB_PREFIX + 'vendors']: '[{"id":"theirs"}]' });
  assert.deepEqual(getTable('vendors'), [{ id: 'theirs' }]);
  removeRaw(DB_PREFIX + 'vendors');
  assert.deepEqual(peekTable('vendors'), []);
  assert.deepEqual(getTable('vendors'), []);
  // Corrupt text is an empty table (fail-soft), and recovers as soon as the text is fixed.
  writeRaw(DB_PREFIX + 'vendors', '{not json');
  assert.deepEqual(getTable('vendors'), []);
  writeRaw(DB_PREFIX + 'vendors', '[{"id":"ok"}]');
  assert.deepEqual(getTable('vendors'), [{ id: 'ok' }]);
});

test('a write seeds the next version: rows read back equal a fresh parse, with no parse at all', () => {
  setTable('invoices', invoiceRows(200));
  peekTable('invoices');
  resetParseCounts();
  const rows = getTable<InvoiceRecord>('invoices');
  rows[3] = { ...rows[3], status: 'Paid', amount_paid: rows[3].total, notes: undefined } as InvoiceRecord;
  rows.splice(10, 1);
  rows.push(invoiceRows(1)[0] && { ...invoiceRows(201)[200], id: 'new' });
  setTable('invoices', rows);
  assert.deepEqual(getTable('invoices'), freshRows('invoices'));
  assert.equal(tableParseCount('invoices'), 0, 'seeded from the rows written, not parsed back');
  assert.ok(!('notes' in peekTable<Record<string, unknown>>('invoices')[3]), 'an undefined field is dropped, as JSON would');
});

test('snapshot tables follow the asset table (cache invalidated when assets change)', () => {
  setTable('invoices', invoiceRows(3));
  const before = peekTable<InvoiceRecord>('invoices');
  assert.equal(before[0].sender?.logo, LOGO, 'references resolve to the data URL');
  const assets = JSON.parse(readRaw(DB_PREFIX + 'assets') as string) as { id: string; data: string }[];
  assert.equal(assets.length, 1);
  // The asset row behind the reference is replaced (restore / sync merge of the assets table).
  writeRaw(DB_PREFIX + 'assets', JSON.stringify([{ id: assets[0].id, data: LOGO2 }]));
  assert.equal(peekTable<InvoiceRecord>('invoices')[0].sender?.logo, LOGO2);
  assert.equal(getTable<InvoiceRecord>('invoices')[2].sender?.logo, LOGO2);
  assert.notEqual(tableStamp('invoices'), '', 'stamp exists');
  const stamp = tableStamp('invoices');
  writeRaw(DB_PREFIX + 'assets', JSON.stringify([{ id: assets[0].id, data: LOGO }]));
  assert.notEqual(tableStamp('invoices'), stamp, 'a snapshot table stamp moves with the asset table');
  // A save that adds a new logo writes the asset first; the next read resolves it.
  const rows = getTable<InvoiceRecord>('invoices');
  rows[1] = { ...rows[1], sender: { ...rows[1].sender, logo: LOGO2 } } as InvoiceRecord;
  setTable('invoices', rows);
  assert.equal(peekTable<InvoiceRecord>('invoices')[1].sender?.logo, LOGO2);
  assert.deepEqual(getTable('invoices'), freshRows('invoices'));
});

test('tableStamp / memoOnReads: unchanged keys reuse the result, any change to a key read recomputes', () => {
  setTable('stock_items', [{ id: 's1' }]);
  setTable('stock_moves', []);
  let runs = 0;
  const f = () => memoOnReads('t:count', () => {
    runs++;
    return peekTable('stock_items').length + getTable('stock_moves').length;
  });
  assert.equal(f(), 1);
  assert.equal(f(), 1);
  assert.equal(runs, 1);
  const s = tableStamp('stock_items', 'stock_moves');
  setTable('vendors', [{ id: 'unrelated' }]);
  assert.equal(f(), 1);
  assert.equal(runs, 1, 'a table it never read does not invalidate it');
  assert.equal(tableStamp('stock_items', 'stock_moves'), s);
  setTable('stock_moves', [{ id: 'm1' }]);
  assert.equal(f(), 2);
  assert.equal(runs, 2);
  assert.notEqual(tableStamp('stock_items', 'stock_moves'), s);
  loadStorage({ [DB_PREFIX + 'stock_items']: '[]' }); // behind the module's back
  assert.equal(f(), 1);
  // A nested memo reports its keys to the outer one, hit or miss.
  let outer = 0;
  const g = () => memoOnReads('t:outer', () => {
    outer++;
    return f() * 10;
  });
  assert.equal(g(), 10);
  assert.equal(g(), 10);
  assert.equal(outer, 1);
  setTable('stock_items', [{ id: 'a' }, { id: 'b' }]);
  assert.equal(g(), 30);
  assert.equal(outer, 2);
  const v = storageVersion();
  setTable('vendors', []);
  assert.ok(storageVersion() > v, 'storageVersion moves on every write');
});

test('parse counts: a save through the editor store parses invoices at most once, and the readers after it not at all', () => {
  installSettings();
  setTable('invoices', invoiceRows(300));
  setTable('stock_items', [{ id: 's1', name: 'Widget', unit: 'NOS', track_stock: true, track_batches: true, opening_qty: 50, opening_rate: 10, reorder_level: 5 }]);
  resetParseCounts();
  const saved = createViaStore({ date: '2026-05-12', lines: [{ name: 'Widget', qty: 2, rate: 100 }] });
  assert.ok(tableParseCount('invoices') <= 1, `save parsed invoices ${tableParseCount('invoices')}x`);
  resetParseCounts();
  // What the editor and the bell do right after a save.
  localDb.invoices.getById(saved.id);
  localDb.invoices.getAll();
  localDb.invoices.nextNumber('2026-05-12');
  localDb.invoices.checkNumber(saved.invoice_number, saved.id);
  localDb.payments.listFor(saved.id);
  loadVisibleNotifications(new Date('2026-05-12T10:00:00'));
  loadVisibleNotifications(new Date('2026-05-12T10:00:00'));
  editorStockContext({ id: saved.id, doc_type: 'INVOICE', issue_date: '2026-05-12' });
  editorStockContext({ id: saved.id, doc_type: 'INVOICE', issue_date: '2026-05-12' });
  loadPositions();
  loadPositions();
  assert.equal(tableParseCount('invoices'), 0, 'the save left a parsed version behind');
  assert.deepEqual(getTable('invoices'), freshRows('invoices'));
});

test('parse counts: the stock engine is memoised (editor focus x11 computes once) and follows a sale', () => {
  installSettings();
  setTable('stock_items', [{ id: 's1', name: 'Widget', unit: 'NOS', track_stock: true, track_batches: true, opening_qty: 50, opening_rate: 10 }]);
  setTable('invoices', invoiceRows(50));
  const doc = { doc_type: 'INVOICE', issue_date: '2026-05-12' };
  const first = editorStockContext(doc);
  assert.ok(first);
  resetParseCounts();
  for (let i = 0; i < 10; i++) assert.equal(editorStockContext(doc), first, 'same shared context while nothing changed');
  assert.equal(tableParseCount(), 0);
  const p1 = loadPositions();
  assert.equal(loadPositions(), p1);
  createViaStore({ date: '2026-05-12', lines: [{ name: 'Widget', qty: 3, rate: 100 }] });
  const p2 = loadPositions();
  assert.notEqual(p2, p1, 'a sale invalidates the memoised positions');
  const qty = (ps: typeof p1) => ps.find((p) => p.item.id === 's1')?.qty ?? NaN;
  assert.equal(qty(p2), qty(p1) - 3, 'the sale is counted');
  assert.notEqual(editorStockContext(doc), first);
});

test('notification reuse: unchanged data reuses the providers result, a write or force recomputes, state applies fresh', () => {
  installSettings();
  setTable('invoices', invoiceRows(20));
  resetNotificationReuse();
  let calls = 0;
  const off = registerNotificationProvider((ctx) => {
    calls++;
    return [{ id: 'probe', severity: 'info', title: 'Probe', detail: '', at: ctx.now.toISOString() }];
  });
  try {
    const now = new Date('2026-05-12T10:00:00');
    reusableVisibleNotifications(now);
    reusableVisibleNotifications(new Date(now.getTime() + 60_000));
    assert.equal(calls, 1, 'the 60 s poll / focus on unchanged data does not recompute');
    reusableVisibleNotifications(now, true);
    assert.equal(calls, 2, 'force recomputes');
    setTable('cheques', []);
    reusableVisibleNotifications(now);
    assert.equal(calls, 3, 'any write recomputes');
    reusableVisibleNotifications(new Date('2026-05-13T00:01:00'));
    assert.equal(calls, 4, 'a new day recomputes');
    setTable('notif_state', [{ id: 'probe', dismissed_until: '9999-12-31T00:00:00.000Z' }]);
    const after = reusableVisibleNotifications(new Date('2026-05-13T00:02:00'));
    assert.ok(!after.some((n) => n.id === 'probe'), 'snooze / dismiss state is applied on every call');
  } finally {
    off();
    resetNotificationReuse();
  }
});

test('backup: the parts text equals JSON.stringify(file, null, 2), and validation parses each table once', () => {
  const file: BackupFile = { app: 'mrchartist-invoice', version: 1, exportedAt: '2026-05-12T10:00:00.000Z', data: { [`${DB_PREFIX}clients`]: '[{"id":"a","n":"\\"q\\""}]', [`${DB_PREFIX}x`]: 'line\nbreak' } } as BackupFile;
  assert.equal(backupTextParts(file).join(''), JSON.stringify(file, null, 2));
  const empty = { ...file, data: {} };
  assert.equal(backupTextParts(empty).join(''), JSON.stringify(empty, null, 2));

  setTable('invoices', invoiceRows(30));
  setTable('clients', [{ id: 'c0', name: 'Client 0' }]);
  const data = Object.fromEntries(Object.entries(dumpStorage()).filter(([k]) => k.startsWith(DB_PREFIX)));
  const text = JSON.stringify({ ...file, data });
  const invoicesRaw = data[`${DB_PREFIX}invoices`];
  const parse = JSON.parse;
  let invoiceParses = 0;
  JSON.parse = ((s: string, r?: (k: string, v: unknown) => unknown) => {
    if (s === invoicesRaw) invoiceParses++;
    return parse(s, r);
  }) as typeof JSON.parse;
  try {
    const { summary } = parseBackup(text);
    assert.equal(summary.invoices, 30);
    assert.equal(summary.clients, 1);
  } finally {
    JSON.parse = parse;
  }
  assert.equal(invoiceParses, 1, 'invoices parsed once for validate + assets + attachments + counts');
});
