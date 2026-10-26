import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import {
  MAX_PRINTED_PHOTOS, canTakeProof, photoPages, printablePhotos, proofIssues, proofSignatureData, sanitizeDeliveryProof, sanitizePrint,
  setDeliveryProof, setPrintFlag,
} from '../src/lib/doc-evidence.ts';
import { snapshotLineImages } from '../src/lib/line-images.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { readRefs } from '../src/lib/attachments.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import { localDb } from '../src/lib/localDb.ts';
import { buildEInvoice } from '../src/lib/einvoice.ts';
import { buildEway } from '../src/lib/eway.ts';
import { invoice, item, BUYER_MH } from './einvoice-fixtures.ts';
import type { AttachmentRef } from '../src/types/attachments.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SIG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const ref = (id: string, over: Partial<AttachmentRef> = {}): AttachmentRef => ({ id, name: `${id}.jpg`, mime: 'image/jpeg', size: 10, added_at: '2026-01-01', ...over });

test('line photo: snapshot of the catalogue reference, independent of later catalogue edits', () => {
  const cat = [{ name: 'Compressor', hsn: '8414', image: 'asset:aaa' }, { name: 'Gas refill', image: 'asset:bbb' }];
  const lines = [item({ id: 'l1', name: 'compressor ', hsn: '8414' }), item({ id: 'l2', name: 'Labour' })];
  const snap = snapshotLineImages(lines, cat);
  assert.equal(snap[0].image, 'asset:aaa');
  assert.equal(snap[1].image, undefined);
  // Catalogue photo changes later: the saved line keeps its own reference.
  const later = snapshotLineImages(snap, [{ name: 'Compressor', hsn: '8414', image: 'asset:new' }]);
  assert.equal(later[0].image, 'asset:aaa');
  assert.equal(snapshotLineImages(lines, []), lines, 'unchanged array when nothing to copy');
  // HSN mismatch does not match.
  assert.equal(snapshotLineImages([item({ name: 'Compressor', hsn: '9999' })], cat)[0].image, undefined);
  // The record normaliser keeps only asset references on lines.
  const rec = normalizeRecord({ items: [{ ...lines[0], image: 'asset:aaa' }, { ...lines[1], image: 'data:image/png;base64,AAA=' }] });
  assert.equal(rec.items[0].image, 'asset:aaa');
  assert.equal(rec.items[1].image, undefined);
});

test('photo pages: marked images only, Before → After → Other, capped at 12, four per page', () => {
  const refs = [
    ref('o1', { print: { group: 'other' } }),
    ref('a1', { print: { group: 'after', caption: 'Fixed' } }),
    ref('pdf', { mime: 'application/pdf', print: { group: 'before' } }),
    ref('b1', { print: { group: 'before' } }),
    ref('n1'),
    ref('a2', { print: { group: 'after' } }),
  ];
  assert.deepEqual(printablePhotos(refs).map((r) => r.id), ['b1', 'a1', 'a2', 'o1']);
  const many = Array.from({ length: 20 }, (_, i) => ref(`p${i}`, { print: { group: 'other' } }));
  assert.equal(printablePhotos(many).length, MAX_PRINTED_PHOTOS);
  assert.deepEqual(photoPages([1, 2, 3, 4, 5, 6]), [[1, 2, 3, 4], [5, 6]]);
  assert.deepEqual(sanitizePrint({ group: 'weird', caption: '  a\u0001b ' }), { group: 'other', caption: 'a b' });
  assert.equal(printablePhotos(undefined).length, 0, 'documents without photos print nothing');
  // Marking a 13th photo is refused.
  const twelve = Array.from({ length: 12 }, (_, i) => ref(`m${i}`, { print: { group: 'other' } }));
  assert.equal(setPrintFlag([...twelve, ref('x')], 'x', { group: 'after' }), false);
  const unmark = setPrintFlag(twelve, 'm0', null);
  assert.ok(unmark && !('print' in unmark[0]));
  // The stored flag survives the record reader (and only on images).
  assert.deepEqual(readRefs([ref('i', { print: { group: 'after' } }), ref('j')]).map((r) => r.print), [{ group: 'after' }, undefined]);
});

function issued(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return invoice({ id: 'inv1', invoice_number: 'INV/FY26-27/0001', status: 'Sent', issue_date: '2026-05-10', ...over });
}

test('delivery proof: rules — issued invoice / challan only, receiver + signature, owner + reason to replace', () => {
  assert.equal(canTakeProof(issued()), true);
  assert.equal(canTakeProof(issued({ status: 'Draft' })), false);
  assert.equal(canTakeProof(issued({ doc_type: 'QUOTATION' })), false);
  assert.equal(canTakeProof(issued({ doc_type: 'DELIVERY_CHALLAN' })), true);
  assert.deepEqual(proofIssues(issued(), { receiver: '', signature: 'data:text/plain;base64,AA' }), ['receiver', 'signature']);
  const signed = issued({ delivery_proof: { receiver: 'Ravi', signed_at: '2026-05-10T10:00:00Z', signature: 'asset:x' } });
  assert.deepEqual(proofIssues(signed, { receiver: 'Ravi', signature: SIG }), ['reason']);
  assert.deepEqual(proofIssues(signed, { receiver: 'Ravi', signature: SIG, reason: 'smudged' }, 'clerk'), ['owner']);
  assert.equal(sanitizeDeliveryProof({ receiver: 'x', signed_at: 'nope', signature: 'asset:a' }), null);
});

test('delivery proof: data URL interned to an asset, write-once, owner replace with a reason (audited)', () => {
  resetStorage();
  setActorProvider(() => ({ id: 'o', name: 'Owner', role: 'owner' }));
  try {
    setTable('invoices', [issued()]);
    const after = setDeliveryProof('inv1', { receiver: 'Ravi Kumar', remark: 'Received in good condition', signature: SIG, now: new Date('2026-05-11T09:00:00Z') });
    const proof = after.delivery_proof!;
    assert.match(proof.signature, /^asset:/, 'stored as a reference, not the data URL');
    assert.equal(proofSignatureData(proof), SIG);
    assert.ok(getTable<{ id: string; data: string }>('assets').some((a) => a.data === SIG));
    assert.equal(getTable<InvoiceRecord>('invoices')[0].delivery_proof?.receiver, 'Ravi Kumar');
    // A later edit of the invoice through the data layer never drops or rewrites it.
    const stored = getTable<InvoiceRecord>('invoices')[0];
    localDb.invoices.save({ ...stored, notes: 'edited', delivery_proof: undefined });
    assert.equal(getTable<InvoiceRecord>('invoices')[0].delivery_proof?.signature, proof.signature);
    // A second signature needs a reason; the owner replaces it and the history is kept.
    assert.throws(() => setDeliveryProof('inv1', { receiver: 'X', signature: SIG2 }), /reason/);
    const replaced = setDeliveryProof('inv1', { receiver: 'Sita', signature: SIG2, reason: 'Wrong person signed' });
    assert.equal(replaced.delivery_proof?.replaced?.length, 1);
    assert.equal(replaced.delivery_proof?.replaced?.[0].reason, 'Wrong person signed');
    const log = getTable<{ summary: string }>('audit_log').map((r) => r.summary).join('\n');
    assert.match(log, /Receiver signature taken/);
    assert.match(log, /Receiver signature replaced .*Wrong person signed/);
    // A clerk cannot replace it.
    setActorProvider(() => ({ id: 'c', name: 'Asha', role: 'clerk' }));
    assert.throws(() => setDeliveryProof('inv1', { receiver: 'Y', signature: SIG, reason: 'r' }), /owner/);
    // A new document never inherits a proof (duplicate / conversion).
    setActorProvider(() => ({ id: 'o', name: 'Owner', role: 'owner' }));
    const copy = localDb.invoices.save({ ...stored, id: 'copy', invoice_number: '', delivery_proof: proof });
    assert.equal(copy.delivery_proof, undefined);
  } finally {
    setActorProvider(null);
  }
});

test('e-Invoice / e-Way builders ignore photos and the receiver signature', () => {
  const rec = issued({
    client: { name: 'Buyer', gstin: BUYER_MH, email: '', address: 'Pune 411001', city: 'Pune', zip: '411001', state: 'Maharashtra' },
    items: [item({ id: 'g1', name: 'Pump', hsn: '8413', type: 'Goods', image: 'asset:aaa' })],
    attachments: [ref('ph', { print: { group: 'after' } })],
    delivery_proof: { receiver: 'Ravi', signed_at: '2026-05-10T10:00:00Z', signature: 'asset:x' },
  });
  const einv = JSON.stringify(buildEInvoice(rec).payload);
  const eway = JSON.stringify(buildEway(rec).payload);
  for (const out of [einv, eway]) {
    assert.doesNotMatch(out, /asset:|Ravi|delivery|attachments|"print"/);
  }
});

test('template parts: lazy, data-gated, accent variable only', () => {
  const engine = readFileSync(new URL('../src/components/templates/TemplateEngine.tsx', import.meta.url), 'utf8');
  assert.match(engine, /lazy\(\(\) => import\('\.\/parts\/PhotoPages'\)\)/);
  assert.match(engine, /lazy\(\(\) => import\('\.\/parts\/DeliveryProofBlock'\)\)/);
  assert.match(engine, /\{invoice\.delivery_proof && <Suspense fallback=\{null\}><LazyDeliveryProof/);
  assert.match(engine, /\{invoice\.attachments\?\.some\(\(a\) => a\.print\) && <Suspense fallback=\{null\}><LazyPhotoPages/);
  // R2-B / 8H / R2-A blocks are still there.
  assert.match(engine, /<OptionalItemsBlock/);
  assert.match(engine, /challan_hide_amounts/);
  assert.match(engine, /<AcceptanceBlock/);
  for (const f of ['docs-r3-paper.module.css', 'docs-r3-pages.module.css']) {
    const css = readFileSync(new URL(`../src/components/templates/parts/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b/i, `no raw hex in ${f}`);
  }
  // A legacy invoice carries none of the fields, so none of the new blocks render (byte-identical paper).
  const legacy = normalizeRecord({ id: 'old', items: [{ id: 'a', name: 'x', rate: 1, quantity: 1 }] });
  assert.equal(legacy.delivery_proof, undefined);
  assert.equal(printablePhotos(legacy.attachments).length, 0);
  assert.equal(legacy.items[0].image, undefined);
});

test('signature pad: extracted and shared by both dialogs', () => {
  const quote = readFileSync(new URL('../src/components/invoicing-ux/AcceptQuoteDialog.tsx', import.meta.url), 'utf8');
  const proof = readFileSync(new URL('../src/components/creator/DeliveryProofDialog.tsx', import.meta.url), 'utf8');
  for (const s of [quote, proof]) assert.match(s, /from '\.\.\/ui\/SignaturePad'/);
  assert.doesNotMatch(quote, /<canvas/);
});
