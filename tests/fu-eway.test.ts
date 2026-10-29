/**
 * R21-A3 e-Way hook: non-GST lines (MS / HSD / natural gas — Rule 138(14), the R10 line key `sv.exempt: 'NON_GST'`) are
 * left out of the e-Way item list and value; a mixed consignment's value is the lubricant only; a fuel-only document
 * gets the "not needed" note. Documents without non-GST lines are unchanged.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { buildEway } from '../src/lib/eway.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

function doc(nonGst: boolean[]): InvoiceRecord {
  const rec = createViaStore({ client: clientMH, date: '2026-10-29', lines: nonGst.map((n, i) => (n ? { name: `Diesel ${i}`, rate: 90, qty: 100, tax: 0, hsn: '27101944' } : { name: `Engine oil ${i}`, rate: 400, qty: 10, tax: 18, hsn: '27101980' })) });
  return { ...rec, items: rec.items.map((l, i) => (nonGst[i] ? { ...l, sv: { exempt: 'NON_GST' as const } } : l)) };
}

test('mixed consignment: diesel left out of the list and the value; the lubricant stays', () => {
  const plain = buildEway(doc([false]));
  const mixed = buildEway(doc([true, false]));
  assert.deepEqual(mixed.bill.itemList.map((i) => i.productName), ['Engine oil 1']);
  assert.equal(mixed.bill.totalValue, 4000);
  assert.equal(mixed.bill.totInvValue, 4720);
  assert.equal(mixed.bill.totInvValue, plain.bill.totInvValue, 'same as a lubricant-only bill');
  assert.ok(!mixed.assumptions.some((a) => a.code === 'EWAY_NOT_NEEDED'));
});

test('fuel only: an empty list, zero value and the "not needed — Rule 138(14)" note; a non-GST Bill of Supply without line keys too', () => {
  const only = buildEway(doc([true, true]));
  assert.equal(only.bill.itemList.length, 0);
  assert.equal(only.bill.totInvValue, 0);
  assert.match(only.assumptions.find((a) => a.code === 'EWAY_NOT_NEEDED')?.message ?? '', /Rule 138\(14\).*verify with your CA/);
  const bos = doc([false]);
  const r = buildEway({ ...bos, doc_type: 'BILL_OF_SUPPLY', exempt_kind: 'NON_GST', items: bos.items.map((l) => ({ ...l, tax_rate: 0 })) });
  assert.equal(r.bill.itemList.length, 0);
  assert.ok(r.assumptions.some((a) => a.code === 'EWAY_NOT_NEEDED'));
  assert.equal(buildEway(doc([false])).bill.itemList.length, 1, 'unchanged without non-GST lines');
});
