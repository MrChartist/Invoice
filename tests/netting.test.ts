/**
 * R15-A3 party netting: a customer who is also a supplier. One "set off" writes receipt rows with the existing no-cash
 * marker `exchange_purchase_id` (+ `method: 'netting'`), so receivables and payables both fall, the cash book and the
 * bank do not move, and the trial balance stays balanced. Reverse frees both sides. Guards: rights, clerk approval,
 * period lock, currency, URD, RCM.
 */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { setActorProvider, isAccessDeniedError, type Role } from '../src/lib/access.ts';
import { localDb } from '../src/lib/localDb.ts';
import { purchasesDb, balanceOf } from '../src/lib/purchases.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { billwisePayables } from '../src/lib/billwise.ts';
import { getTable, getJson, setJson, SINGLETON_KEYS } from '../src/lib/storage.ts';
import { buildLedger, loadLedgerInput, trialBalance } from '../src/lib/ledger/index.ts';
import { cashBook, buildVouchers, loadBooksData } from '../src/lib/books.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import { audit } from '../src/lib/audit.ts';
import {
  NETTING_METHOD, clientOfVendor, exchangeSettled, nettingParties, nettings, openBills, openInvoices, pairNetting, postNetting, reverseNetting,
} from '../src/lib/netting.ts';
import type { Payment } from '../src/types/invoice.ts';
import type { PurchaseRecord, Vendor } from '../src/types/purchases.ts';

const as = (role: Role) => setActorProvider(() => ({ id: role, name: role, role }));
beforeEach(() => {
  setActorProvider(null);
  resetStorage();
  installSettings();
});
afterEach(() => setActorProvider(null));

const bill = (over: Partial<PurchaseRecord> = {}): Omit<PurchaseRecord, 'id'> => ({
  kind: 'PURCHASE', vendor_name: clientMH.name, bill_number: 'B-1', date: '2026-05-10', category: 'Purchases',
  lines: [{ id: 'l1', name: 'Holiday packages', quantity: 1, rate: 180000, tax_rate: 0 }],
  taxable: 180000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 180000, amount_paid: 0, ...over,
} as Omit<PurchaseRecord, 'id'>);

/** The PRD story: the consolidator owes us ₹65,000 (two invoices) and we owe them ₹1,80,000 (one bill). */
function party() {
  localDb.clients.upsert(clientMH);
  const client = localDb.clients.getAll().find((c) => c.name === clientMH.name)!;
  const vendor = vendorsDb.save({ name: clientMH.name, gstin: clientMH.gstin });
  const a = createViaStore({ date: '2026-05-01', lines: [{ qty: 1, rate: 40000, tax: 0 }], client: { ...clientMH, id: client.id } });
  const b = createViaStore({ date: '2026-05-05', lines: [{ qty: 1, rate: 25000, tax: 0 }], client: { ...clientMH, id: client.id } });
  const p = purchasesDb.save({ ...bill(), vendor_id: vendor.id });
  return { client, vendor, a, b, p };
}
const ledgerNow = () => buildLedger(loadLedgerInput(undefined, '2026-10-25'));
const FY = { start: '2026-04-01', end: '2027-03-31' };
const payables = (receipts = getTable<Payment>('transactions')) =>
  billwisePayables({ purchases: purchasesDb.all(), payments: [], vendorPayments: [], asOf: '2026-12-31', receipts, includeSettled: true });

test('who: same name or GSTIN, or a hand link on the vendor', () => {
  const { client, vendor } = party();
  assert.equal(clientOfVendor(vendor, [client])?.id, client.id);
  assert.equal(clientOfVendor({ id: 'x', name: 'Other name', gstin: clientMH.gstin }, [client])?.id, client.id, 'GSTIN');
  assert.equal(clientOfVendor({ id: 'y', name: 'Spelt differently', client_id: client.id } as Vendor, [client])?.id, client.id, 'hand link');
  assert.equal(clientOfVendor({ id: 'z', name: 'Nobody' }, [client]), undefined);
  assert.equal(nettingParties([client], vendorsDb.all()).length, 1);
});

test('pick oldest first: ₹65,000 nets both invoices against the bill; receivables and payables fall; cash book unchanged; TB balanced', () => {
  const { client, vendor, a, b, p } = party();
  const cashBefore = cashBook(buildVouchers(loadBooksData()), [], 'cash', FY).closing;
  const invs = openInvoices(client, localDb.invoices.getAll());
  const bills = openBills(vendor, purchasesDb.all());
  assert.deepEqual(invs.map((i) => i.open), [40000, 25000]);
  assert.deepEqual(bills.map((x) => x.open), [180000]);
  const r = postNetting({ clientId: client.id, vendorId: vendor.id, invoiceIds: [a.id, b.id], billIds: [p.id], amount: 65000, date: '2026-06-01' });
  assert.equal(r.receipts.length, 2);
  for (const x of r.receipts) {
    assert.equal(x.method, NETTING_METHOD);
    assert.equal(x.exchange_purchase_id, p.id, 'the existing no-cash marker, no new one');
    assert.ok(movedNoCash(x));
  }
  assert.equal(localDb.invoices.getById(a.id)?.status, 'Paid');
  assert.equal(localDb.invoices.getById(b.id)?.status, 'Paid');
  const stored = purchasesDb.get(p.id)!;
  assert.equal(stored.amount_paid, 65000);
  assert.equal(stored.exchange_paid, 65000);
  assert.equal(balanceOf(stored), 115000);
  assert.equal(exchangeSettled(p.id, getTable<Payment>('transactions')), 65000);
  const ref = payables()[0].bills[0];
  assert.equal(ref.balance, 115000);
  assert.deepEqual(ref.allocations.map((x) => [x.kind, x.amount]), [['adjustment', 40000], ['adjustment', 25000]], 'dated Netting adjustments, nothing "recorded on the bill"');
  assert.equal(cashBook(buildVouchers(loadBooksData()), [], 'cash', FY).closing, cashBefore, 'cash book unchanged');
  const led = ledgerNow();
  const tb = trialBalance(led, FY);
  assert.equal(tb.totals.closingDr, tb.totals.closingCr, 'TB balances');
  const bankOrCash = led.vouchers.filter((v) => v.id.startsWith('rcpt:')).flatMap((v) => v.lines).filter((l) => l.account === 'bank' || l.account === 'cash');
  assert.equal(bankOrCash.length, 0, 'no bank / cash line on the netting receipts');
  assert.equal(nettings().length, 1);
});

test('partial: a smaller amount settles the oldest invoice first; the cap is min(receivable, payable)', () => {
  const { client, vendor, a, b, p } = party();
  assert.deepEqual(pairNetting(openInvoices(client, localDb.invoices.getAll()), openBills(vendor, purchasesDb.all()), 50000).map((x) => [x.invoiceId, x.amount]), [[a.id, 40000], [b.id, 10000]]);
  assert.throws(() => postNetting({ clientId: client.id, vendorId: vendor.id, invoiceIds: [a.id, b.id], billIds: [p.id], amount: 70000, date: '2026-06-01' }), /At most 65000\.00/);
  postNetting({ clientId: client.id, vendorId: vendor.id, invoiceIds: [a.id], billIds: [p.id], amount: 30000, date: '2026-06-01' });
  assert.equal(localDb.invoices.getById(a.id)?.status, 'Partially Paid');
  assert.equal(balanceOf(purchasesDb.get(p.id)!), 150000);
});

test('reverse: both sides open again, rows go to the recycle bin, one audit line each way', () => {
  const { client, vendor, a, b, p } = party();
  const { nettingId } = postNetting({ clientId: client.id, vendorId: vendor.id, invoiceIds: [a.id, b.id], billIds: [p.id], amount: 65000, date: '2026-06-01' });
  reverseNetting(nettingId);
  assert.equal(getTable<Payment>('transactions').filter((x) => x.method === NETTING_METHOD).length, 0);
  assert.equal(localDb.invoices.getById(a.id)?.amount_paid, 0);
  assert.equal(balanceOf(purchasesDb.get(p.id)!), 180000);
  assert.equal(payables()[0].bills[0].balance, 180000);
  assert.ok(getTable<{ table: string }>('recycle_bin').filter((r) => r.table === 'transactions').length >= 1, 'receipts binned');
  const lines = audit.rows().filter((x) => x.entity_id === nettingId).map((x) => x.action);
  assert.deepEqual(lines, ['create', 'delete']);
  const tb = trialBalance(ledgerNow(), FY);
  assert.equal(tb.totals.closingDr, tb.totals.closingCr);
});

test('a netting receipt deleted elsewhere frees the bill in bill-wise payables', () => {
  const { client, vendor, a, b, p } = party();
  const { receipts } = postNetting({ clientId: client.id, vendorId: vendor.id, invoiceIds: [a.id, b.id], billIds: [p.id], amount: 65000, date: '2026-06-01' });
  localDb.payments.remove(receipts[0].id);
  assert.equal(payables()[0].bills[0].balance, 155000, 'the ₹40,000 row is gone, the ₹25,000 one stays');
});

test('guards: rights, clerk approval, period lock, currency, URD, RCM', () => {
  const { client, vendor, a, p } = party();
  const base = { clientId: client.id, vendorId: vendor.id, invoiceIds: [a.id], billIds: [p.id], amount: 1000, date: '2026-06-01' };
  as('viewer');
  assert.throws(() => postNetting(base), isAccessDeniedError);
  as('clerk');
  assert.throws(() => postNetting(base), /owner's approval/);
  setActorProvider(null);
  setJson(SINGLETON_KEYS.settings, { ...getJson<Record<string, unknown>>(SINGLETON_KEYS.settings, {}), lock_until: '2026-06-30' });
  assert.throws(() => postNetting(base), /lock|closed|locked/i);
  setJson(SINGLETON_KEYS.settings, { ...getJson<Record<string, unknown>>(SINGLETON_KEYS.settings, {}), lock_until: '' });
  const usd = createViaStore({ date: '2026-05-06', lines: [{ qty: 1, rate: 100, tax: 0 }], client: { ...clientMH, id: client.id }, currency: 'USD', gstMode: 'NONE' });
  assert.throws(() => postNetting({ ...base, invoiceIds: [usd.id] }), /different currencies/);
  const urd = purchasesDb.save({ ...bill(), bill_number: 'URD-1', vendor_id: vendor.id, used_goods: { kind: 'device' } as never });
  assert.throws(() => postNetting({ ...base, billIds: [urd.id] }), /buy-back/);
  assert.ok(!openBills(vendor, purchasesDb.all()).some((x) => x.id === urd.id), 'URD vouchers are not offered');
  const rcm = purchasesDb.save({ ...bill(), bill_number: 'RCM-1', vendor_id: vendor.id, reverse_charge: true });
  assert.throws(() => postNetting({ ...base, billIds: [rcm.id] }), /reverse charge/);
  postNetting({ ...base, billIds: [rcm.id], rcmPaid: true });
  assert.equal(getTable<Payment>('transactions').filter((x) => x.method === NETTING_METHOD).length, 1, 'refusals wrote nothing');
});

/* ── R16-D1: a vendor linked by hand under another name nets to its OWN creditor sub-ledger (PF17) ── */
const partyNet = (led: ReturnType<typeof ledgerNow>, account: string, name: string) =>
  led.vouchers.flatMap((v) => v.lines).filter((l) => l.account === account && l.party === name).reduce((s, l) => s + l.dr - l.cr, 0) / 100;

test('R16-D1: hand-linked vendor with another name — vendor ledger = bill-wise payable, client ledger = receivable, TB balanced, cash unchanged', () => {
  const who = { ...clientMH, name: 'Mehta Tours', gstin: '' };
  const clientId = localDb.clients.upsert(who);
  const vendor = vendorsDb.save({ name: 'Mehta Travels Pvt Ltd', client_id: clientId } as Omit<Vendor, 'id'>);
  const a = createViaStore({ date: '2026-05-01', lines: [{ qty: 1, rate: 40000, tax: 0 }], client: { ...who, id: clientId } });
  const b = createViaStore({ date: '2026-05-05', lines: [{ qty: 1, rate: 30000, tax: 0 }], client: { ...who, id: clientId } });
  const p = purchasesDb.save({ ...bill(), vendor_name: 'Mehta Travels Pvt Ltd', vendor_id: vendor.id });
  const cashBefore = cashBook(buildVouchers(loadBooksData()), [], 'cash', FY).closing;
  postNetting({ clientId, vendorId: vendor.id, invoiceIds: [a.id, b.id], billIds: [p.id], amount: 65000, date: '2026-06-01' });
  const led = ledgerNow();
  assert.equal(payables()[0].bills[0].balance, 115000);
  assert.equal(partyNet(led, 'creditors', 'Mehta Travels Pvt Ltd'), -115000, 'vendor ledger shows the debit: Cr 1,15,000 left');
  assert.equal(partyNet(led, 'creditors', 'Mehta Tours'), 0, 'no creditor balance in the client\'s name');
  assert.equal(partyNet(led, 'debtors', 'Mehta Tours'), 5000, 'client ledger = the ₹5,000 still receivable');
  const tb = trialBalance(led, FY);
  assert.equal(tb.totals.closingDr, tb.totals.closingCr, 'TB balances');
  assert.equal(cashBook(buildVouchers(loadBooksData()), [], 'cash', FY).closing, cashBefore, 'cash book unchanged');
});
