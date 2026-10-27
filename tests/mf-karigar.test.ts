/**
 * MF-C4 karigar piece-rate ledger: rate by date and style; pieces from job cards (rejects deducted), bundle coupons (no
 * double count with a job-card entry) and CMT Material In; the KPB piece bill as a purchases row (no GST / no RCM for an
 * unregistered karigar, 5% suggested for a registered fabricator); TDS 194C prompt by threshold; advance recovery
 * journal balancing; bank rows and the slip.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { readPurchase, supplierPayable } from '../src/lib/purchase-normalize.ts';
import { karigarBalance, karigarOf, pieceLines, rateFor } from '../src/lib/mfg/mf-karigar.ts';
import { advanceLedgerId, advanceOutstanding, draftPieceBill, payAdvance, pieceOf, pieceUploadRows, removePieceBill, savePieceBill, slipText } from '../src/lib/mfg/mf-piece-bill.ts';
import type { MfKarigar } from '../src/lib/mfg/mf-c-pending.ts';
import type { Vendor } from '../src/types/purchases.ts';
import type { MaterialIn } from '../src/types/job-work.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-10-20T10:00:00');
});
afterEach(() => thawDate());

const card: MfKarigar = { kind: 'home', rates: [{ op: 'Stitching', rate: 36, from: '2026-04-01' }, { op: 'Stitching', rate: 38, from: '2026-10-01' }, { op: 'Stitching', style_id: 'kt', rate: 42, from: '2026-04-01' }, { op: 'op-hem', rate: 4, from: '2026-04-01' }] };
const save = (v: Partial<Vendor> & { mf?: unknown }) => vendorsDb.save({ name: 'Rehmat', ...v } as Omit<Vendor, 'id'>);
const period = { from: '2026-10-14', to: '2026-10-20' };

test('rate card: latest dated row, a style row wins, by operation id or name', () => {
  assert.equal(rateFor(card, { name: 'stitching' }, undefined, '2026-09-30'), 36);
  assert.equal(rateFor(card, { name: 'Stitching' }, undefined, '2026-10-02'), 38);
  assert.equal(rateFor(card, { name: 'Stitching' }, 'kt', '2026-10-02'), 42);
  assert.equal(rateFor(card, { id: 'op-hem', name: 'Hemming' }, 'kt', '2026-10-02'), 4);
  assert.equal(rateFor(card, { name: 'Ironing' }, undefined, '2026-10-02'), null);
  assert.equal(karigarOf({ mf: { karigar: card } }), card);
  assert.equal(karigarOf({ mf: { karigar: true } }), undefined);
});

test('pieces from job cards (rejects deducted), bundle coupons (no double count) and CMT Material In', () => {
  const jobCards = [{ order_id: 'o1', op_id: 'op-hem', entries: [
    { id: 'e1', date: '2026-10-15', operator: { kind: 'karigar', id: 'k1' }, good: 100, rejected: 4 },
    { id: 'e2', date: '2026-10-15', operator: { kind: 'employee', id: 'emp' }, good: 50, rejected: 0 },
    { id: 'e3', date: '2026-10-01', operator: { kind: 'karigar', id: 'k1' }, good: 70, rejected: 0 },
  ] }];
  const plans = [{ id: 'p', number: 'CUT/FY26-27/0001', style_id: 'kt', bundles: [{ no: 1, history: [{ date: '2026-10-16', op: 'Stitching', good: 12, rejected: 0, by: 'k1' }, { date: '2026-10-16', op_id: 'op-hem', op: 'Hemming', good: 12, rejected: 0, by: 'k1', jc_entry_id: 'e1' }] }] }] as never[];
  const cmtIns = [{ id: 'i', number: 'JWR/FY26-27/0001', date: '2026-10-20', vendor_id: 'k1', received: [{ id: 'r', kind: 'processed', item_id: 'kt-S-Blue', qty: 34, mf: { lot: 'CUT/FY26-27/0001', pieces: 34 } }] }] as unknown as MaterialIn[];
  const lines = pieceLines('k1', card, period, { jobCards, opName: () => 'Hemming', styleOfOrder: () => 'kt', plans, cmtIns });
  assert.deepEqual(lines.map((l) => [l.op, l.source, l.pieces, l.rate, l.amount]), [['Hemming', 'jobcard', 100, 4, 400], ['Stitching', 'bundle', 12, 42, 504], ['Stitching', 'cmt', 34, 42, 1428]]);
  const keep = pieceLines('k1', { ...card, deduct_rejects: false }, period, { jobCards, opName: () => 'Hemming' });
  assert.equal(keep[0].pieces, 104, 'rejects paid when the setting says so');
});

test('piece bill: KPB number, no GST and no RCM for an unregistered karigar, 5% for a registered one; TDS 194C prompt', () => {
  const k = save({ mf: { karigar: card }, pan: 'ABCPR1234K' });
  const lines = [{ op: 'Stitching', style: 'KT-22', pieces: 232, rate: 38, amount: 0, source: 'typed' as const }];
  const d = draftPieceBill(k, lines, { date: '2026-10-20', period, ourState: '27' });
  assert.deepEqual([d.bill.taxable, d.bill.cgst + d.bill.sgst + d.bill.igst, d.bill.reverse_charge ?? false, d.bill.lines[0].hsn], [8816, 0, false, '9988']);
  assert.equal(d.tds.applies, false, '₹8,816 is below the 194C single-bill threshold');
  assert.match(d.tds.note, /194C.*below the threshold/);
  const big = draftPieceBill(k, [{ ...lines[0], pieces: 1000 }], { date: '2026-10-20', period, ourState: '27' });
  assert.deepEqual([big.tds.applies, big.bill.tds_amount, big.bill.tds_section], [true, 380, '194C-1'], '1% individual above ₹30,000');
  const reg = save({ name: 'Fab Works', gstin: '27AAPFU0939F1ZV', mf: { karigar: { kind: 'fabricator', rates: [] } } });
  const r = draftPieceBill(reg, lines, { date: '2026-10-20', period, ourState: '27', tds: false });
  assert.deepEqual([r.bill.cgst, r.bill.sgst, r.bill.total, r.bill.tds_amount ?? 0], [220.4, 220.4, 9256.8, 0]);
  const saved = savePieceBill(k, d);
  assert.equal(saved.bill_number, 'KPB/FY26-27/0001');
  assert.equal(pieceOf(saved)?.lines[0].amount, 8816);
  assert.equal(readPurchase(saved)?.taxable, 8816, 'read through readPurchase like any bill');
  removePieceBill(saved.id);
  assert.equal(savePieceBill(k, d).bill_number, 'KPB/FY26-27/0002', 'a deleted KPB number is never reused');
});

test('advances: paid by voucher, recovered on the bill by a balanced journal; bank rows and the slip', () => {
  const k = save({ mf: { karigar: card }, bank_account_no: '50100012345678', bank_ifsc: 'HDFC0001234' });
  payAdvance(k, { date: '2026-10-15', amount: 500 });
  assert.equal(advanceOutstanding(k), 500);
  const d = draftPieceBill(k, [{ op: 'Stitching', pieces: 100, rate: 38, amount: 0, source: 'typed' }], { date: '2026-10-20', period, advance: 300 });
  assert.equal(d.net, 3500);
  const bill = savePieceBill(k, d);
  const jv = loadVouchers().find((v) => v.id === pieceOf(bill)?.advance_jv_id)!;
  assert.equal(jv.lines.reduce((s, l) => s + l.dr - l.cr, 0), 0, 'journal balances');
  assert.equal(advanceOutstanding(k), 200);
  assert.equal(supplierPayable(bill) - bill.amount_paid, 3500, 'the bill owes the net');
  assert.throws(() => savePieceBill(k, draftPieceBill(k, [{ op: 'Stitching', pieces: 100, rate: 38, amount: 0, source: 'typed' }], { date: '2026-10-20', period, advance: 900 })), /only ₹200/);
  assert.deepEqual(karigarBalance(k, purchasesDb.all(), loadVouchers(), advanceLedgerId()), { billed: 3800, tds: 0, payable: 3500, advance: 200 });
  const rows = pieceUploadRows([{ vendor: k, net: 3500 }, { vendor: save({ name: 'No bank' }), net: 100 }], bill.bill_number);
  assert.deepEqual(rows.map((r) => [r.beneficiary, r.amount, r.mode]), [['Rehmat', 3500, 'NEFT']]);
  assert.match(slipText(k, bill.bill_number, pieceOf(bill)!, { total: 3800, tds: 0, net: 3500 }), /Stitching: 100 × ₹38\.00[\s\S]*Advance recovered ₹300\.00[\s\S]*Net ₹3500\.00/);
});
