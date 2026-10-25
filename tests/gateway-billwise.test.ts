/**
 * ROADMAP 7.19: bill-wise references, voucher classes and single-entry mode on Gateway voucher entry.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, createViaStore, clientMH } from './helpers/world.ts';
import { A, chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { saveReceiptVoucher, voucherReceipts } from '../src/lib/bill-allocation.ts';
import { localDb } from '../src/lib/localDb.ts';
import { purchasesDb, paymentsDb, balanceOf } from '../src/lib/purchases.ts';
import { vendorPaymentsDb } from '../src/lib/billwise.ts';
const setLockUntil = (d: string) => localDb.settings.save({ ...localDb.settings.get(), lock_until: d });
import type { EntryLine } from '../src/lib/gateway/voucher-entry.ts';
import { toVoucherInput } from '../src/lib/gateway/voucher-entry.ts';
import {
  billwiseLine,
  fifoRefs,
  knownClasses,
  linesToSingle,
  particularsSide,
  receiptRefsInput,
  remainderKind,
  singleToLines,
  supplierPaymentFrom,
  validateRefs,
  type BillRefRow,
} from '../src/lib/gateway/voucher-refs.ts';
import { openBillsFor, saveSupplierPayment } from '../src/lib/gateway/voucher-refs-save.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

let k = 100;
const key = () => ++k;
const L = (side: 'dr' | 'cr', account_id: string, amount: string, party?: string): EntryLine => ({ key: key(), side, account_id, amount, ...(party ? { party } : {}) });

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('single-entry mode: particulars side, account line for the total, round trip', () => {
  assert.equal(particularsSide('PAYMENT'), 'dr');
  assert.equal(particularsSide('CONTRA'), 'dr');
  assert.equal(particularsSide('RECEIPT'), 'cr');
  const rows = [L('dr', 'rent', '1000'), L('dr', 'power', '250.50')];
  const lines = singleToLines('PAYMENT', { accountId: A.bank, rows }, 1);
  assert.deepEqual(lines.map((l) => [l.side, l.account_id, l.amount]), [['cr', A.bank, '1250.50'], ['dr', 'rent', '1000'], ['dr', 'power', '250.50']]);
  const chart = chartOf(loadUserAccounts());
  const byId = new Map(chart.map((a) => [a.id, a]));
  const back = linesToSingle('PAYMENT', lines, byId);
  assert.equal(back?.accountId, A.bank);
  assert.equal(back?.rows.length, 2);
  // Two bank lines on the account side cannot be shown as single entry.
  assert.equal(linesToSingle('PAYMENT', [L('cr', A.bank, '1'), L('cr', A.cash, '1'), L('dr', 'rent', '2')], byId), null);
  // Journal has no single-entry mode.
  assert.equal(linesToSingle('JOURNAL', lines, byId), null);
  // The converted lines are a valid manual voucher input.
  const input = toVoucherInput({ type: 'PAYMENT', date: '2026-04-02', narration: '' }, lines, chart);
  assert.equal(input.lines.reduce((s, l) => s + l.dr, 0), input.lines.reduce((s, l) => s + l.cr, 0));
});

test('voucher classes list: used classes, most used first', () => {
  assert.deepEqual(knownClasses([{ voucher_class: 'Petty' }, { voucher_class: 'Bank' }, { voucher_class: 'Petty' }, {}, { voucher_class: ' ' }]), ['Petty', 'Bank']);
});

test('bill-wise line, FIFO allocation, validation and remainder labels', () => {
  const receipt = [L('dr', A.bank, '1500'), L('cr', A.debtors, '1500', 'Acme')];
  assert.deepEqual(billwiseLine('RECEIPT', receipt)?.side, 'receivable');
  assert.equal(billwiseLine('PAYMENT', receipt), null);
  assert.equal(billwiseLine('PAYMENT', [L('dr', A.creditors, '10', 'Rao'), L('cr', A.cash, '10')])?.side, 'payable');
  const bills = [
    { id: 'b2', ref: 'INV/2', date: '2026-05-01', due: '2026-05-31', outstanding: 1000 },
    { id: 'b1', ref: 'INV/1', date: '2026-04-01', due: '2026-04-30', outstanding: 300 },
  ];
  const refs = fifoRefs(bills, 1500, key);
  assert.deepEqual(refs.map((r) => [r.kind, r.bill_id, r.amount]), [['agst', 'b1', '300.00'], ['agst', 'b2', '1000.00'], ['onacc', undefined, '200.00']]);
  assert.deepEqual(validateRefs(refs, 1500, bills), []);
  assert.match(validateRefs([{ key: 1, kind: 'agst', bill_id: 'b1', amount: '301' }], 1500, bills)[0], /only 300.00/);
  assert.match(validateRefs([{ key: 1, kind: 'agst', amount: '1' }], 1500, bills)[0], /choose the bill/);
  assert.match(validateRefs([{ key: 1, kind: 'onacc', amount: '1600' }], 1500, bills)[0], /more than/);
  const nr: BillRefRow[] = [{ key: 1, kind: 'agst', bill_id: 'b1', amount: '300' }, { key: 2, kind: 'new', name: 'PO-9', amount: '50' }];
  assert.deepEqual(receiptRefsInput(nr, 'Acme', 1500, bills, 'Bank Transfer'), { party: 'Acme', total: 1500, allocations: [{ bill_id: 'b1', ref: 'INV/1', amount: 300 }], method: 'Bank Transfer', remainder_note: 'New ref PO-9' });
  assert.deepEqual(remainderKind(nr), { kind: 'NEW_REF', refName: 'PO-9' });
  assert.deepEqual(remainderKind([{ key: 1, kind: 'advance', amount: '5' }]), { kind: 'ADVANCE' });
});

test('receipt with Agst Ref + Advance: one step through saveReceiptVoucher (invoice settled, labelled remainder)', () => {
  const inv = createViaStore({ date: '2026-04-10', client: clientMH, lines: [{ qty: 1, rate: 1000, tax: 0 }] });
  const party = clientMH.company || clientMH.name;
  const bills = openBillsFor('receivable', party);
  assert.equal(bills.length, 1);
  assert.equal(bills[0].id, inv.id);
  const chart = chartOf(loadUserAccounts());
  const lines = [L('dr', A.bank, '1200'), L('cr', A.debtors, '1200', party)];
  const input = { ...toVoucherInput({ type: 'RECEIPT', date: '2026-04-20', narration: 'by NEFT' }, lines, chart), voucher_class: 'Bank receipts' };
  const refs: BillRefRow[] = [{ key: 1, kind: 'agst', bill_id: inv.id, amount: '1000' }, { key: 2, kind: 'advance', amount: '200' }];
  const saved = saveReceiptVoucher(input, chart, receiptRefsInput(refs, party, 1200, bills, 'Bank Transfer'));
  assert.equal(saved.voucher_class, 'Bank receipts');
  const rows = voucherReceipts(saved.id);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => !r.invoice_id)?.note, 'Advance');
  assert.equal(localDb.invoices.getById(inv.id)?.status, 'Paid');
});

const bill = (over: Partial<PurchaseRecord>): PurchaseRecord => ({
  id: 'p1', kind: 'PURCHASE', vendor_id: 'v1', vendor_name: 'Rao & Co', bill_number: 'RC/1', date: '2026-04-05', due_date: '2026-05-05',
  category: 'Purchases', lines: [], taxable: 10000, cgst: 0, sgst: 0, igst: 0, itc_eligible: true, total: 10000, amount_paid: 0, ...over,
} as PurchaseRecord);

test('payment with Agst Ref + New Ref becomes a supplier payment (no PV voucher), all or nothing', () => {
  purchasesDb.save(bill({ id: 'p1', bill_number: 'RC/1' }));
  purchasesDb.save(bill({ id: 'p2', bill_number: 'RC/2', date: '2026-04-20', due_date: '2026-05-20', total: 5000, taxable: 5000 }));
  const vendors = [{ id: 'v1', name: 'Rao & Co' }];
  const bills = openBillsFor('payable', 'Rao & Co');
  assert.deepEqual(bills.map((b) => b.id), ['p1', 'p2']);
  const lines = [L('dr', A.creditors, '12000', 'Rao & Co'), L('cr', A.bank, '12000')];
  const refs: BillRefRow[] = [{ key: 1, kind: 'agst', bill_id: 'p1', amount: '10000' }, { key: 2, kind: 'new', name: 'PI-77', amount: '2000' }];
  const sp = supplierPaymentFrom(lines, refs, { date: '2026-04-25', reference: 'UTR1', vendors });
  assert.ok(typeof sp !== 'string');
  if (typeof sp === 'string') return;
  assert.equal(sp.method, 'Bank Transfer');
  saveSupplierPayment(sp);
  assert.equal(balanceOf(purchasesDb.get('p1')!), 0);
  assert.equal(vendorPaymentsDb.all()[0].kind, 'NEW_REF');
  assert.equal(vendorPaymentsDb.all()[0].ref_name, 'PI-77');
  assert.equal(loadVouchers().length, 0, 'not also a manual PV voucher');
  // Wrong shape: two money lines.
  assert.equal(supplierPaymentFrom([L('dr', A.creditors, '2', 'Rao & Co'), L('cr', A.bank, '1'), L('cr', A.cash, '1')], refs, { date: '2026-04-25', vendors }), 'shape');
  // A refused allocation (locked period) leaves nothing behind.
  const before = { pays: paymentsDb.all().length, vps: vendorPaymentsDb.all().length };
  setLockUntil('2026-04-30');
  const sp2 = supplierPaymentFrom([L('dr', A.creditors, '5000', 'Rao & Co'), L('cr', A.cash, '5000')], [{ key: 1, kind: 'agst', bill_id: 'p2', amount: '4000' }, { key: 2, kind: 'onacc', amount: '1000' }], { date: '2026-04-28', vendors });
  assert.ok(typeof sp2 !== 'string');
  if (typeof sp2 !== 'string') assert.throws(() => saveSupplierPayment(sp2));
  assert.equal(paymentsDb.all().length, before.pays);
  assert.equal(vendorPaymentsDb.all().length, before.vps);
  assert.equal(balanceOf(purchasesDb.get('p2')!), 5000);
});
