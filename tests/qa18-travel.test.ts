/**
 * QA round 18 — Round 15 (travel, tour & events; R15-A netting / audit coalescing) cross-package seams. One test per
 * finding of docs/prd/qa-round-18.md; each fails on the baseline `0dad0d9`.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { balanceOf, purchasesDb } from '../src/lib/purchases.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { postNetting } from '../src/lib/netting.ts';
import { restoreEntry } from '../src/lib/trust/recycle-bin.ts';
import * as ensure from '../src/lib/retail/ensure-hooks.ts';
import { saveTrip } from '../src/lib/travel/tv-trips.ts';
import { saveBooking } from '../src/lib/travel/tv-bookings.ts';
import { billTrip } from '../src/lib/travel/tv-bill.ts';
import { cancelBookings } from '../src/lib/travel/tv-cancel.ts';
import { tcsPatch, tourTcs } from '../src/lib/travel/tv-tcs.ts';
import { calculateInvoice } from '../src/lib/invoice-calc.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  setActorProvider(null);
});

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('T1: the items footer (Add line, pack rows, travel chips) sits outside the lines\' size container', () => {
  const css = src('src/components/creator/ItemsTable.module.css');
  const rule = (name: string) => css.match(new RegExp(`\\n\\.${name} \\{([^}]*)\\}`))?.[1] ?? '';
  assert.doesNotMatch(rule('wrap'), /container-type/, '.wrap (which holds the footer) is no size container');
  assert.match(rule('lines'), /container-type:\s*inline-size/, 'the lines block is the container the @container rules query');
  const tsx = src('src/components/creator/ItemsTable.tsx');
  const open = tsx.indexOf('data-items-lines');
  const footer = tsx.indexOf('data-items-footer');
  assert.ok(open > 0 && footer > open, 'lines block, then the footer');
  // The lines block (opened at the wrap's indentation + 2) closes right after the line map, before the footer opens.
  assert.match(tsx, /\n {6}<div className=\{styles\.lines\} data-items-lines>[\s\S]*\n {8}\}\)\}\n {6}<\/div>\n\n {6}<div className=\{styles\.footer\} data-items-footer>/);
});

/** A client who is also a supplier: one ₹40,000 invoice, one ₹1,80,000 bill. */
function netParty() {
  localDb.clients.upsert(clientMH);
  const client = localDb.clients.getAll().find((c) => c.name === clientMH.name)!;
  const vendor = vendorsDb.save({ name: clientMH.name, gstin: clientMH.gstin });
  const inv = createViaStore({ date: '2026-05-01', lines: [{ qty: 1, rate: 40000, tax: 0 }], client: { ...clientMH, id: client.id } });
  const bill = purchasesDb.save({ kind: 'PURCHASE', vendor_id: vendor.id, vendor_name: clientMH.name, bill_number: 'B-1', date: '2026-05-10', category: 'Purchases', lines: [{ id: 'l1', name: 'Packages', quantity: 1, rate: 180000, tax_rate: 0 }], taxable: 180000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 180000, amount_paid: 0 } as Omit<PurchaseRecord, 'id'>);
  const { receipts } = postNetting({ clientId: client.id, vendorId: vendor.id, invoiceIds: [inv.id], billIds: [bill.id], amount: 40000, date: '2026-06-01' });
  return { inv, bill, receipts };
}

test('T2: a netting receipt removed on its own (payment dialog) re-opens the bill; restoring it settles the bill again', () => {
  const { inv, bill, receipts } = netParty();
  assert.equal(balanceOf(purchasesDb.get(bill.id)!), 140000);
  localDb.payments.remove(receipts[0].id);
  assert.equal(localDb.invoices.getById(inv.id)?.amount_paid, 0, 'the invoice is open again');
  assert.equal(balanceOf(purchasesDb.get(bill.id)!), 180000, 'and so is the bill (was ₹1,40,000: still "paid" by a receipt that is gone)');
  assert.equal(purchasesDb.get(bill.id)?.exchange_paid, 0);
  const binned = getTable<{ id: string; table: string }>('recycle_bin').find((e) => e.table === 'transactions');
  restoreEntry(binned!.id);
  assert.equal(balanceOf(purchasesDb.get(bill.id)!), 140000, 'restored: set off again');
});

test('T3: the bill hooks load for any company with a netting receipt, not only retail ones', () => {
  installSettings({ business_type: 'services', service_kind: 'travel', travel_kind: 'agent', industry_packs: ['travel'] } as never);
  const needs = (ensure as { needsRetailHooks?: () => boolean }).needsRetailHooks;
  assert.equal(typeof needs, 'function');
  assert.equal(needs!(), false, 'a travel agency without netting loads nothing');
  netParty();
  assert.equal(needs!(), true, 'with a netting receipt on record the delete / cancel hooks load (they free the bill)');
});

/** An outbound Dubai package (air + hotel, 5 %) billed 1 Nov 2026 with TCS 2 % applied and issued. */
function tcsPackage() {
  localDb.clients.upsert({ ...clientMH, pan: 'ABCPS1234K' } as never);
  const t = saveTrip({ name: 'Dubai', client_id: clientMH.id, tv: { code: '26DXB', kind: 'trip', scope: 'outbound', start: '2026-12-10', regime: 'to5', status: 'confirmed', pax: [] } });
  const ids = [saveBooking({ trip_id: t.id, component: 'air', start: '2026-12-10', cost: 100000, sell: 120000, status: 'confirmed' }).id,
    saveBooking({ trip_id: t.id, component: 'hotel', start: '2026-12-10', cost: 150000, sell: 200000, status: 'confirmed' }).id];
  const draft = billTrip(t.id, '2026-11-01');
  const t0 = calculateInvoice(draft as never);
  const base = t0.total - t0.round_off - t0.tcs_amount;
  const pre = { ...draft, ...tcsPatch(tourTcs({ date: draft.issue_date, base, pan: 'ABCPS1234K', components: ['air', 'hotel'] }), base, 'total', draft.tv), status: 'Sent' };
  const inv = localDb.invoices.save({ ...pre, ...calculateInvoice(pre as never) } as never);
  return { inv, ids };
}

test('T4: cancelling a TCS package — the refund shown is what the credit note credits (TCS included), not the lines without it', () => {
  const { inv, ids } = tcsPackage();
  assert.equal(inv.tcs_amount, 6720);
  const r = cancelBookings(ids, { date: '2026-11-20', supplier_charge: 50000, fee: 20000, refund_in: 200000 });
  const cn = r.notes[0];
  assert.equal(cn.total, 342720, 'the credit note credits the invoice in full, its TCS too');
  assert.equal(r.plan.billed, cn.total);
  assert.equal(r.plan.refundOut, 342720 - 21000, 'refund to the client = credit note − our fee with GST (was ₹3,15,000: ₹6,720 short of the credit)');
});

test('T5: the cancellation credit note is dated the cancellation date, like the fee draft and the supplier debit note', () => {
  const { ids } = tcsPackage();
  const r = cancelBookings(ids, { date: '2026-11-20', supplier_charge: 50000, fee: 20000, refund_in: 200000 });
  assert.equal(r.notes[0].issue_date, '2026-11-20');
  assert.equal(r.fee?.issue_date, '2026-11-20');
  assert.match(r.notes[0].invoice_number, /FY26-27/);
});
