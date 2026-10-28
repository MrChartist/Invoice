/**
 * PENDING 11 (MF-C3, ITC-04 5C): the invoice e-Way dialog's "Dispatched from" job worker. The dialog's JSON is the
 * invoice's bill passed through `dispatchFrom`: our GSTIN stays the supplier, the dispatch-from side is the job worker's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEway } from '../src/lib/eway.ts';
import { dispatchFrom } from '../src/lib/mfg/mf-eway-jw.ts';
import { SELLER_GSTIN, invoice, item } from './einvoice-fixtures.ts';

test('PENDING 11: an invoice e-Way dispatched from a job worker (5C) keeps the supplier, moves dispatch-from', () => {
  const { bill } = buildEway(invoice({ items: [item({ quantity: 10, rate: 10000 })] }), { transport: { vehicle: 'MH12AB1234', distance: 150 } });
  const jw = { name: 'Bhiwandi Stitchers', gstin: '27AAAPL1234C1ZV', state_code: '27', address: 'Gala 12, Bhiwandi, Maharashtra 421302' };
  const out = dispatchFrom(bill, jw);
  assert.equal(out.fromGstin, bill.fromGstin);
  assert.equal(out.userGstin, SELLER_GSTIN);
  assert.equal(out.transType, 3, 'bill-from / dispatch-from');
  assert.equal(out.fromPincode, 421302);
  assert.match(out.fromAddr1, /Gala 12/);
  assert.deepEqual([out.totInvValue, out.toPincode, out.itemList.length], [bill.totInvValue, bill.toPincode, bill.itemList.length]);
});

test('PENDING 11: the e-Way tab mounts the lazy picker with a manufacturing pack and downloads the transformed bill', () => {
  const m = readFileSync(new URL('../src/components/einvoice/EInvoiceModal.tsx', import.meta.url), 'utf8');
  assert.match(m, /const EwayDispatchFrom = lazy\(\(\) => import\('\.\.\/mfg\/EwayDispatchFrom'\)\)/);
  assert.match(m, /'garments'/);
  assert.match(m, /mfgOn && <Suspense fallback=\{null\}><EwayDispatchFrom /);
  assert.match(m, /jw\.fix \? jw\.fix\(eway\.bill\) : eway\.bill/);
  assert.match(m, /billLists: \[ewayBill\]/);
  assert.doesNotMatch(m, /from '\.\.\/\.\.\/lib\/mfg\//, 'no static mfg import into the e-Invoice modal');
  const p = readFileSync(new URL('../src/components/mfg/EwayDispatchFrom.tsx', import.meta.url), 'utf8');
  assert.match(p, /dispatchFrom\(b, v\)/);
  const area = readFileSync(new URL('../src/i18n/areas/mfg-r13c.ts', import.meta.url), 'utf8');
  assert.equal((area.match(/dispatchFromJw:/g) ?? []).length, 2, 'English and Hindi');
});
