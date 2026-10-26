/**
 * Roadmap 6.12: attachments (receipt photos / PDFs) on bills, expenses and invoices.
 * Storage (stored once by content), magic-byte validation, backup round-trip with dangling and
 * doctored files, clean-up on delete / edit / sweep, storage health, erase, and the IndexedDB cache.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, resetStorage } from './helpers/shim.ts';
import { fakeIdb, installFakeIdb, uninstallFakeIdb } from './helpers/fake-idb.ts';
import {
  ATTACHMENT_KEY_PREFIX,
  AttachmentError,
  MAX_PDF_BYTES,
  attachmentBytes,
  attachmentKey,
  attachmentUsage,
  checkBackupAttachments,
  cleanupUnusedAttachments,
  getAttachment,
  parseStoredAttachment,
  putAttachment,
  readRefs,
  referencedAttachmentIds,
  sniffMime,
  storedAttachmentIds,
  validateUpload,
  bytesToBase64,
} from '../src/lib/attachments.ts';
import { DB_PREFIX, SINGLETON_KEYS, enableVault, flushStorage, initStorage, resetStorageBackend, setJson } from '../src/lib/storage.ts';
import { isSealed } from '../src/lib/vault.ts';
import { DATA_STORE, resetIdbConnection } from '../src/lib/idb-kv.ts';
import { buildBackup, parseBackup, restoreBackup, wipeAppData, attachmentRestoreNote } from '../src/lib/backup.ts';
import { RESET_PHRASE, resetAllData } from '../src/lib/auth.ts';
import { measureStorage, assessStorage } from '../src/lib/storage-health.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { localDb } from '../src/lib/localDb.ts';
import { buildConvertedDraft } from '../src/lib/documents.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import { RECORD_KEYS } from '../src/store/useInvoiceStore.ts';
import { createViaStore, installSettings } from './helpers/world.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import type { AttachmentRef } from '../src/types/attachments.ts';

beforeEach(() => {
  resetStorageBackend();
  resetStorage();
});

const bytes = (head: number[] | string, size = 64, fill = 7): Uint8Array => {
  const h = typeof head === 'string' ? [...head].map((c) => c.charCodeAt(0)) : head;
  const out = new Uint8Array(Math.max(size, h.length)).fill(fill);
  out.set(h, 0);
  return out;
};
const PNG = (fill = 1) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 64, fill);
const JPEG = () => bytes([0xff, 0xd8, 0xff, 0xe0], 80);
const GIF = () => bytes('GIF89a', 40);
const WEBP = () => {
  const b = bytes('RIFF', 40);
  b.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
  return b;
};
const PDF = (size = 200) => bytes('%PDF-1.7\n', size, 0x20);
const HTML = () => bytes('<!doctype html><script>alert(1)</script>', 64, 0x20);

const bill = (over: Partial<PurchaseRecord> = {}): Omit<PurchaseRecord, 'id'> & { id?: string } => ({
  kind: 'EXPENSE',
  vendor_name: 'Landlord',
  bill_number: '',
  date: '2026-05-10',
  category: 'Rent',
  lines: [{ id: 'l1', name: 'Rent', quantity: 1, rate: 1000, tax_rate: 0 }],
  taxable: 1000,
  cgst: 0,
  sgst: 0,
  igst: 0,
  itc_eligible: false,
  total: 1000,
  amount_paid: 0,
  ...over,
});

/* ── Validation ──────────────────────────────────────────────────── */

test('sniffMime judges files by their magic bytes', () => {
  assert.equal(sniffMime(PNG()), 'image/png');
  assert.equal(sniffMime(JPEG()), 'image/jpeg');
  assert.equal(sniffMime(GIF()), 'image/gif');
  assert.equal(sniffMime(WEBP()), 'image/webp');
  assert.equal(sniffMime(PDF()), 'application/pdf');
  assert.equal(sniffMime(HTML()), null);
  assert.equal(sniffMime(bytes('<svg xmlns="http://www.w3.org/2000/svg">')), null, 'SVG can carry script: refused');
  assert.equal(sniffMime(bytes('MZ')), null, 'executables refused');
  assert.equal(sniffMime(new Uint8Array(0)), null);
  assert.equal(sniffMime(bytes('RIFF', 40)), null, 'RIFF that is not WEBP (e.g. WAV) refused');
});

test('validateUpload refuses unsupported, empty and oversized files with a readable message', () => {
  assert.throws(() => validateUpload(HTML()), AttachmentError);
  assert.throws(() => validateUpload(new Uint8Array(0)), /empty/);
  assert.throws(() => validateUpload(PDF(MAX_PDF_BYTES + 1)), /PDFs can be up to 3\.0 MB/);
  assert.equal(validateUpload(PDF(MAX_PDF_BYTES)), 'application/pdf');
});

test('a disguised file is refused however it is named', () => {
  assert.throws(() => putAttachment({ bytes: HTML(), name: 'receipt.pdf' }), /Only photos/);
  assert.equal(storedAttachmentIds().length, 0);
});

/* ── Storage ─────────────────────────────────────────────────────── */

test('the same file is stored once; each record keeps its own name', () => {
  const a = putAttachment({ bytes: PDF(), name: 'C:\\scans\\rent-may.pdf' });
  const b = putAttachment({ bytes: PDF(), name: 'copy.pdf' });
  assert.equal(a.id, b.id);
  assert.equal(a.name, 'rent-may.pdf', 'path stripped');
  assert.equal(b.name, 'copy.pdf');
  assert.equal(a.mime, 'application/pdf');
  assert.deepEqual(storedAttachmentIds(), [a.id]);
  assert.ok(localStorage.getItem(ATTACHMENT_KEY_PREFIX + a.id), 'one key per file, under the app prefix');
  const other = putAttachment({ bytes: PNG(), name: 'photo.png' });
  assert.notEqual(other.id, a.id);
  assert.equal(storedAttachmentIds().length, 2);
});

test('bytes round-trip exactly and the type is re-checked on every read', () => {
  const src = JPEG();
  const ref = putAttachment({ bytes: src, name: 'r.jpg' });
  const got = attachmentBytes(ref.id)!;
  assert.equal(got.mime, 'image/jpeg');
  assert.deepEqual([...got.bytes], [...src]);
  assert.ok(getAttachment(ref.id)!.data.startsWith('data:image/jpeg;base64,'));
  // Tamper: claim PNG for JPEG bytes → refused.
  const row = JSON.parse(localStorage.getItem(attachmentKey(ref.id))!);
  row.data = row.data.replace('image/jpeg', 'image/png');
  localStorage.setItem(attachmentKey(ref.id), JSON.stringify(row));
  assert.equal(getAttachment(ref.id), null);
  assert.equal(attachmentBytes(ref.id), null);
});

test('parseStoredAttachment refuses HTML, non-base64 and disallowed types', () => {
  const ok = { id: 'x', mime: 'application/pdf', size: 9, created_at: '', data: `data:application/pdf;base64,${bytesToBase64(PDF(12))}` };
  assert.ok(parseStoredAttachment(JSON.stringify(ok)));
  assert.equal(parseStoredAttachment(JSON.stringify({ ...ok, data: `data:text/html;base64,${bytesToBase64(HTML())}` })), null);
  assert.equal(parseStoredAttachment(JSON.stringify({ ...ok, data: `data:application/pdf;base64,${bytesToBase64(HTML())}` })), null);
  assert.equal(parseStoredAttachment(JSON.stringify({ ...ok, data: 'data:application/pdf,<html>' })), null);
  assert.equal(parseStoredAttachment('not json'), null);
});

test('readRefs drops malformed entries and duplicates', () => {
  const good: AttachmentRef = { id: 'a', name: 'a.pdf', mime: 'application/pdf', size: 1, added_at: '' };
  assert.deepEqual(readRefs([good, good, { id: 'b', mime: 'text/html' }, null, { name: 'no id' }]), [good]);
  assert.deepEqual(readRefs('nope'), []);
});

/* ── Records and clean-up ────────────────────────────────────────── */

test('purchase contract: the attachments field survives save and does not change any figure', () => {
  const ref = putAttachment({ bytes: PNG(), name: 'receipt.png' });
  const saved = purchasesDb.save(bill({ attachments: [ref] }));
  assert.deepEqual(purchasesDb.get(saved.id)!.attachments, [ref]);
  assert.equal(purchasesDb.get(saved.id)!.total, 1000);
});

test('editing a bill without a file releases it; a file another record uses is kept', () => {
  const shared = putAttachment({ bytes: PDF(), name: 'shared.pdf' });
  const own = putAttachment({ bytes: PNG(), name: 'own.png' });
  const a = purchasesDb.save(bill({ attachments: [shared, own] }));
  purchasesDb.save(bill({ attachments: [shared] }));
  purchasesDb.save({ ...purchasesDb.get(a.id)!, attachments: undefined });
  assert.equal(getAttachment(own.id), null, 'own file released');
  assert.ok(getAttachment(shared.id), 'still used by the other bill');
});

test('deleting a bill / an invoice deletes its files unless still referenced (including by the draft and the recycle bin)', async () => {
  installSettings();
  const r1 = putAttachment({ bytes: PDF(), name: 'a.pdf' });
  const r2 = putAttachment({ bytes: JPEG(), name: 'b.jpg' });
  const p = purchasesDb.save(bill({ attachments: [r1] }));
  const inv = createViaStore({ date: '2026-05-10', lines: [{ qty: 1, rate: 100 }] });
  localDb.invoices.save({ ...localDb.invoices.getById(inv.id)!, attachments: [r2] });
  // The editor's autosaved draft also points at r2.
  setJson(SINGLETON_KEYS.draft, { id: '', attachments: [r2] });
  purchasesDb.remove(p.id);
  localDb.invoices.remove(inv.id);
  // R4-C4: the recycle bin keeps the files while the deleted records are in it; deleting them for good releases them.
  assert.ok(getAttachment(r1.id), 'kept while the bill is in the recycle bin');
  const { deleteForGood, BIN_TABLE } = await import('../src/lib/trust/recycle-bin.ts');
  const { getTable } = await import('../src/lib/storage.ts');
  deleteForGood(getTable<{ id: string }>(BIN_TABLE).map((e) => e.id));
  assert.equal(getAttachment(r1.id), null);
  assert.ok(getAttachment(r2.id), 'kept: the draft still uses it');
  setJson(SINGLETON_KEYS.draft, null);
  assert.equal(cleanupUnusedAttachments().removed, 1);
  assert.equal(storedAttachmentIds().length, 0);
});

test('cleanupUnusedAttachments removes only orphans and reports what it freed', () => {
  const used = putAttachment({ bytes: PDF(), name: 'used.pdf' });
  const orphan = putAttachment({ bytes: PNG(), name: 'cancelled-form.png' });
  purchasesDb.save(bill({ attachments: [used] }));
  const usage = attachmentUsage();
  assert.equal(usage.count, 2);
  assert.deepEqual(usage.unusedIds, [orphan.id]);
  const r = cleanupUnusedAttachments();
  assert.equal(r.removed, 1);
  assert.ok(r.chars > 0);
  assert.deepEqual(storedAttachmentIds(), [used.id]);
  assert.deepEqual([...referencedAttachmentIds()], [used.id]);
});

test('invoices keep attachments through normalizeRecord; duplicating / converting does not copy them', () => {
  assert.ok((RECORD_KEYS as readonly string[]).includes('attachments'));
  const ref = putAttachment({ bytes: PDF(), name: 'signed.pdf' });
  const rec = normalizeRecord({ id: 'q1', doc_type: 'QUOTATION', status: 'Sent', items: [{ name: 'X', quantity: 1, rate: 10 }], attachments: [ref] });
  assert.deepEqual(rec.attachments, [ref]);
  assert.equal(normalizeRecord({ id: 'q2' }).attachments, undefined, 'absent on legacy rows');
  const draft = buildConvertedDraft(rec, 'INVOICE', { id: 'n1', invoice_number: 'INV/FY26-27/0001', today: '2026-05-10', dueDays: 7 });
  assert.equal(draft.attachments, undefined);
});

/* ── Backups ─────────────────────────────────────────────────────── */

test('backup round-trip carries the files and restores them byte for byte', () => {
  const src = PDF(500);
  const ref = putAttachment({ bytes: src, name: 'gst-bill.pdf' });
  purchasesDb.save(bill({ attachments: [ref] }));
  const file = buildBackup();
  assert.ok(file.data[attachmentKey(ref.id)], 'backup carries the file key');
  const { data, summary } = parseBackup(JSON.stringify(file));
  assert.equal(summary.attachments, 1);
  assert.equal(summary.missingAttachments, undefined);
  wipeAppData();
  assert.equal(storedAttachmentIds().length, 0, 'Erase removes attachment files');
  restoreBackup(data);
  assert.deepEqual([...attachmentBytes(ref.id)!.bytes], [...src]);
  assert.deepEqual(purchasesDb.all()[0].attachments, [ref]);
});

test('a backup with dangling references still restores and reports the missing files', () => {
  const ref = putAttachment({ bytes: PNG(), name: 'gone.png' });
  purchasesDb.save(bill({ attachments: [ref] }));
  const file = buildBackup();
  delete file.data[attachmentKey(ref.id)];
  const { data, summary } = parseBackup(JSON.stringify(file));
  assert.equal(summary.missingAttachments, 1);
  assert.match(attachmentRestoreNote(summary), /1 attached file referred to by its records is not in this file/);
  restoreBackup(data);
  assert.equal(getAttachment(ref.id), null);
  assert.equal(purchasesDb.all().length, 1, 'the record itself is restored');
});

test('doctored attachment entries are left out of a restore', () => {
  const ref = putAttachment({ bytes: PDF(), name: 'ok.pdf' });
  purchasesDb.save(bill({ attachments: [ref] }));
  const file = buildBackup();
  file.data[`${ATTACHMENT_KEY_PREFIX}evil`] = JSON.stringify({ id: 'evil', data: `data:text/html;base64,${bytesToBase64(HTML())}` });
  file.data[`${ATTACHMENT_KEY_PREFIX}liar`] = JSON.stringify({ id: 'liar', data: `data:image/png;base64,${bytesToBase64(HTML())}` });
  file.data[`${ATTACHMENT_KEY_PREFIX}moved`] = file.data[attachmentKey(ref.id)]; // id does not match its key
  const { data, summary } = parseBackup(JSON.stringify(file));
  assert.equal(summary.droppedAttachments, 3);
  assert.equal(summary.attachments, 1);
  assert.ok(!(`${ATTACHMENT_KEY_PREFIX}evil` in data));
  const check = checkBackupAttachments({ ...data });
  assert.deepEqual(check, { files: 1, dropped: 0, missing: 0 });
});

test('the forgot-PIN reset removes attachment files too', () => {
  putAttachment({ bytes: PDF(), name: 'x.pdf' });
  assert.equal(resetAllData(RESET_PHRASE), true);
  assert.equal(Object.keys(dumpStorage()).filter((k) => k.startsWith(ATTACHMENT_KEY_PREFIX)).length, 0);
});

/* ── Storage health ──────────────────────────────────────────────── */

test('storage health groups attachment files into one entry and counts the unused ones', () => {
  const used = putAttachment({ bytes: PDF(30_000), name: 'big.pdf' });
  putAttachment({ bytes: PNG(), name: 'orphan.png' });
  purchasesDb.save(bill({ attachments: [used] }));
  const m = measureStorage();
  assert.equal(m.attachmentCount, 2);
  assert.equal(m.unusedAttachments, 1);
  assert.ok(m.tables.some((t) => t.key === `${DB_PREFIX}attachments`));
  assert.ok(!m.tables.some((t) => t.key.startsWith(ATTACHMENT_KEY_PREFIX)), 'no per-file rows');
  const h = assessStorage({ ...m, persisted: true, iosSafari: false, standalone: false, lastBackupIso: new Date().toISOString(), now: new Date() });
  assert.equal(h.attachments.count, 2);
  assert.equal(h.attachments.unused, 1);
  assert.ok(h.findings.some((f) => f.id === 'attachments-unused'));
  assert.ok(h.biggest.some((b) => b.name === 'attachments'));
});

/* ── IndexedDB backend ───────────────────────────────────────────── */

test('with the IndexedDB cache, files are listed from the cache and committed as their own keys', async () => {
  resetIdbConnection();
  fakeIdb.reset();
  installFakeIdb();
  try {
    const r = await initStorage({ timeoutMs: 500 });
    assert.equal(r.backend, 'idb');
    const ref = putAttachment({ bytes: PDF(), name: 'idb.pdf' });
    assert.deepEqual(storedAttachmentIds(), [ref.id]);
    await flushStorage();
    const stored = () => fakeIdb.store('mrchartist_inv_kv', DATA_STORE);
    assert.ok(typeof stored().get(attachmentKey(ref.id)) === 'string', 'the file is its own IndexedDB entry');
    assert.equal(localStorage.getItem(attachmentKey(ref.id)), null, 'not in localStorage');
    cleanupUnusedAttachments();
    await flushStorage();
    assert.equal(stored().has(attachmentKey(ref.id)), false);
  } finally {
    resetStorageBackend();
    resetIdbConnection();
    uninstallFakeIdb();
  }
});

test('vault mode (5.8) seals each attachment file like any other data key', async () => {
  resetIdbConnection();
  fakeIdb.reset();
  installFakeIdb();
  try {
    await initStorage({ timeoutMs: 500 });
    await enableVault('correct horse battery staple');
    const src = PDF(300);
    const ref = putAttachment({ bytes: src, name: 'secret.pdf' });
    await flushStorage();
    const raw = fakeIdb.store('mrchartist_inv_kv', DATA_STORE).get(attachmentKey(ref.id));
    assert.ok(typeof raw === 'string' && isSealed(raw), 'stored sealed');
    assert.deepEqual([...attachmentBytes(ref.id)!.bytes], [...src], 'readable through the unlocked cache');
  } finally {
    resetStorageBackend();
    resetIdbConnection();
    uninstallFakeIdb();
  }
});
