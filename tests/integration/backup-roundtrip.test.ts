/**
 * Backup -> wipe -> restore must preserve EVERY table byte-for-byte, keep the
 * device-local security keys out of the file (and untouched by a wipe), and the
 * encrypted variant must round-trip and refuse a wrong passphrase.
 */
import '../helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, dumpStorage } from '../helpers/shim.ts';
import {
  clientKA,
  createViaStore,
  installSettings,
  reload,
} from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { DB_PREFIX, getTable, setTable, writeRaw } from '../../src/lib/storage.ts';
import { DEVICE_LOCAL_KEYS } from '../../src/lib/auth.ts';
import {
  applyBackup,
  buildBackup,
  buildEncryptedBackup,
  decryptBackup,
  parseBackup,
  restoreBackup,
  wipeAppData,
} from '../../src/lib/backup.ts';
import { purchasesDb, paymentsDb, computePurchaseTotals } from '../../src/lib/purchases.ts';
import { saveOpening } from '../../src/lib/books.ts';
import { blankStockItem, stockDb } from '../../src/lib/inventory.ts';
import { createSchedule, recurringDb, templateFromInvoice } from '../../src/lib/recurring.ts';
import { createCreditNote } from '../../src/lib/documents.ts';
import { saveEInvoiceMeta } from '../../src/lib/einvoice.ts';
import { freezeDate, thawDate } from '../helpers/shim.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

/** A device with data in every table the app owns. */
function populate() {
  const inv = createViaStore({ date: '2026-04-08', client: clientKA, lines: [{ qty: 10, rate: 1000, tax: 18, disc: 5 }], shipping: 50 });
  localDb.payments.record({ invoiceId: inv.id, amount: 2500, method: 'UPI', date: '2026-04-10', reference: 'U1' });
  freezeDate('2026-04-20T10:00:00');
  createCreditNote(reload(inv.id), { lines: [{ itemId: reload(inv.id).items[0].id, quantity: 2 }], reason: 'Discount' });
  thawDate();
  const t = computePurchaseTotals([{ id: 'l', name: 'Paper', quantity: 5, rate: 100, tax_rate: 18 }], { placeOfSupply: '27', businessState: '27' });
  const p = purchasesDb.save({
    kind: 'PURCHASE', vendor_name: 'Paper Co', bill_number: 'P1', date: '2026-04-05', category: 'Purchases',
    lines: [{ id: 'l', name: 'Paper', quantity: 5, rate: 100, tax_rate: 18 }],
    taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, itc_eligible: true, total: t.total, amount_paid: 0,
  });
  paymentsDb.record(p.id, { amount: 100, date: '2026-04-06', method: 'Cash' });
  saveOpening('bank', 1000, '2026-04-01');
  stockDb.saveItem(blankStockItem({ id: 's1', name: 'Paper', opening_qty: 3, opening_rate: 90 }));
  recurringDb.save(createSchedule({ name: 'Retainer', template: templateFromInvoice(reload(inv.id)), frequency: 'monthly', start_date: '2026-05-01' }));
  saveEInvoiceMeta({ invoice_id: inv.id, irn: 'a'.repeat(64), ack_no: '112233' });
  // device-local security state that must never travel
  for (const k of DEVICE_LOCAL_KEYS) writeRaw(k, JSON.stringify({ secret: k }));
  return inv;
}

const appKeys = (snap: Record<string, string>) =>
  Object.fromEntries(Object.entries(snap).filter(([k]) => k.startsWith(DB_PREFIX) && !DEVICE_LOCAL_KEYS.includes(k)));

test('backup -> wipe -> restore preserves every table exactly and leaves device-local keys alone', () => {
  populate();
  const before = dumpStorage();
  const tables = Object.keys(appKeys(before));
  for (const t of ['invoices', 'transactions', 'clients', 'items_catalog', 'doc_links', 'purchases', 'purchase_payments', 'book_opening', 'stock_items', 'recurring', 'einvoice_meta', 'settings']) {
    assert.ok(tables.includes(DB_PREFIX + t), `fixture must populate ${t}`);
  }

  const file = JSON.stringify(buildBackup(new Date('2026-04-30T10:00:00Z')));
  for (const k of DEVICE_LOCAL_KEYS) assert.ok(!file.includes(`"${k}"`), `${k} must not be in the backup`);

  wipeAppData();
  const wiped = dumpStorage();
  assert.deepEqual(Object.keys(appKeys(wiped)), [], 'every app table is gone after a wipe');
  for (const k of DEVICE_LOCAL_KEYS) assert.equal(wiped[k], before[k], `${k} survives a wipe`);

  const { data, summary } = parseBackup(file);
  assert.equal(summary.invoices, 2); // the invoice + its credit note
  applyBackup(data);
  const after = dumpStorage();
  assert.deepEqual(appKeys(after), appKeys(before), 'every table restored byte-for-byte');
  for (const k of DEVICE_LOCAL_KEYS) assert.equal(after[k], before[k]);

  // And the data is still functionally intact.
  assert.equal(localDb.invoices.getAll().length, 2);
  assert.equal(localDb.payments.getAll()[0].amount, 2500);
});

test('encrypted backup round-trips; a wrong passphrase and tampering are refused', async () => {
  populate();
  const before = appKeys(dumpStorage());
  const text = await buildEncryptedBackup('correct horse battery', new Date('2026-04-30T10:00:00Z'));
  assert.ok(!text.includes('Bharat') && !text.includes('invoices'), 'ciphertext must not leak plain data');

  await assert.rejects(() => decryptBackup(text, 'wrong passphrase!!'), /passphrase|decrypt/i);
  const tampered = JSON.parse(text);
  tampered.envelope.ct = tampered.envelope.ct.slice(0, -4) + (tampered.envelope.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  await assert.rejects(() => decryptBackup(JSON.stringify(tampered), 'correct horse battery'));

  const { data } = await decryptBackup(text, 'correct horse battery');
  wipeAppData();
  applyBackup(data);
  assert.deepEqual(appKeys(dumpStorage()), before);
  await assert.rejects(() => buildEncryptedBackup('short'), /at least 8/);
});

test('a hostile backup cannot pollute prototypes, write foreign keys or overwrite the PIN', () => {
  // Raw JSON text: an object literal would swallow "__proto__" instead of keeping it as a key.
  const pin = JSON.stringify(JSON.stringify({ pin: '0000' }));
  const evil =
    '{"app":"mrchartist-invoice","version":1,"data":{"__proto__":{"polluted":true},"constructor":"x",' +
    `"theme":"dark","other_site":"x","${DB_PREFIX}auth":${pin},` +
    `"${DB_PREFIX}invoices":"[]","${DB_PREFIX}clients":12345}}`;
  const { data } = parseBackup(evil);
  assert.deepEqual(Object.keys(data), [`${DB_PREFIX}invoices`]);
  assert.equal(({} as Record<string, unknown>).polluted, undefined, 'Object.prototype must be untouched');
  assert.equal(Object.getPrototypeOf(data), Object.prototype);
});

test('REGRESSION: a restore that hits the storage quota half-way rolls back instead of leaving a mix', () => {
  populate();
  const before = dumpStorage();
  const payload = {
    [`${DB_PREFIX}invoices`]: '[{"id":"new"}]',
    [`${DB_PREFIX}clients`]: '[{"id":"new"}]',
    [`${DB_PREFIX}transactions`]: '[]',
  };
  const ls = (globalThis as unknown as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage;
  const realSet = ls.setItem;
  let writes = 0;
  ls.setItem = (k: string, v: string) => {
    if (++writes === 3) throw new Error('quota');
    realSet(k, v);
  };
  try {
    assert.throws(() => applyBackup(payload));
  } finally {
    ls.setItem = realSet;
  }
  assert.deepEqual(dumpStorage(), before, 'storage is exactly as it was before the failed restore');
});

test('restoring on top of a device with other data replaces tables the backup contains', () => {
  populate();
  const file = JSON.stringify(buildBackup());
  setTable('clients', [{ id: 'zzz', name: 'Stale client' }]);
  wipeAppData();
  setTable('purchases', [{ id: 'old', stale: true }]); // a table the backup also has
  const { data } = parseBackup(file);
  applyBackup(data);
  assert.equal(getTable<{ stale?: boolean }>('purchases').some((r) => r.stale), false);
  assert.equal(getTable<{ id: string }>('clients').some((r) => r.id === 'zzz'), false);
});

test('restoreBackup replaces the device\'s tables exactly (extras removed) and rolls back if a write fails', () => {
  populate();
  const file = JSON.stringify(buildBackup());
  const goodData = parseBackup(file).data;
  const goodDevice = dumpStorage();
  // the device later gains data the backup does not have
  setTable('purchases', [{ id: 'extra' }]);
  setTable('stale_table', [{ id: 'x' }]);
  restoreBackup(goodData);
  const after = dumpStorage();
  assert.equal(after[`${DB_PREFIX}stale_table`], undefined, 'a table the backup lacks is removed');
  assert.deepEqual(appKeys(after), appKeys(goodDevice));
  for (const k of DEVICE_LOCAL_KEYS) assert.equal(after[k], goodDevice[k]);

  // failure half-way: everything is back as it was before the restore attempt
  setTable('purchases', [{ id: 'keep-me' }]);
  const before = dumpStorage();
  const ls = (globalThis as unknown as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage;
  const realSet = ls.setItem;
  let writes = 0;
  ls.setItem = (k: string, v: string) => {
    if (++writes === 4) throw new Error('quota');
    realSet(k, v);
  };
  try {
    assert.throws(() => restoreBackup(goodData));
  } finally {
    ls.setItem = realSet;
  }
  assert.deepEqual(dumpStorage(), before);
});
