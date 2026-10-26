/** R5-C6: security deposits — received / paid postings, adjust (receipt only), damages / forfeit (tax document), refund, lock. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupR5c } from './helpers/r5c.ts';
import { BUYER_MH, createViaStore } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { A, chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import { loadLedger } from '../src/lib/ledger/index.ts';
import { adjustAgainstInvoice, applyToCharge, depositBalance, depositScheduleCsv, loadDeposits, recordDeposit, refundDeposit, refundReceiptHtml } from '../src/lib/property/deposits.ts';

beforeEach(() => setupR5c());

const tenant = () => localDb.clients.upsert({ id: 'ten', name: 'Shop Tenant', email: '', address: '', city: 'Mumbai', zip: '', state_code: '27', gstin: BUYER_MH });
const ctx = () => ({ sender: localDb.settings.activeProfile() ?? null, templateId: 'classic_orange' });
const received = () => recordDeposit({ direction: 'received', party_id: tenant(), party_name: 'Shop Tenant', amount: 100000, date: '2026-04-05', mode: 'bank' });

test('received → Dr bank | Cr "Security deposits received" (liability); paid → Dr Security deposits (asset) | Cr cash', () => {
  const r = received();
  const p = recordDeposit({ direction: 'paid', party_id: '', party_name: 'Landlord', amount: 30000, date: '2026-04-06', mode: 'cash' });
  const chart = chartOf(loadUserAccounts());
  const vr = loadVouchers().find((v) => v.id === r.movements[0].voucher_id)!;
  assert.equal(vr.type, 'RECEIPT');
  assert.deepEqual(vr.lines.map((l) => [l.account_id === A.bank ? 'bank' : chart.find((a) => a.id === l.account_id)?.name, l.dr, l.cr]), [['bank', 10000000, 0], ['Security deposits received', 0, 10000000]]);
  assert.equal(chart.find((a) => a.name === 'Security deposits received')?.group, 'OTHER_CL');
  const vp = loadVouchers().find((v) => v.id === p.movements[0].voucher_id)!;
  assert.deepEqual(vp.lines.map((l) => [l.account_id, l.dr, l.cr]), [[A.deposits, 3000000, 0], [A.cash, 0, 3000000]]);
  assert.equal(loadLedger().warnings.length, 0, 'both vouchers balance');
  assert.deepEqual([depositBalance(r), depositBalance(p)], [100000, 30000]);
});

test('adjust against an existing invoice: receipt only (no new document), the invoice is settled', () => {
  const r = received();
  const rent = createViaStore({ client: localDb.clients.getById('ten')!, date: '2026-05-01', docType: 'TAX_INVOICE', lines: [{ name: 'Rent', qty: 1, rate: 20000, tax: 18 }], status: 'Sent' });
  const before = localDb.invoices.getAll().length;
  const after = adjustAgainstInvoice(r.id, rent.id, 23600, '2026-05-20');
  assert.equal(localDb.invoices.getAll().length, before, 'no tax document created');
  assert.equal(localDb.invoices.getById(rent.id)!.status, 'Paid');
  assert.equal(depositBalance(after), 76400);
  assert.throws(() => adjustAgainstInvoice(r.id, rent.id, 1, '2026-05-21'), /balance/);
});

test('damages and forfeit raise a tax invoice for the applied amount (tax inclusive), settled from the deposit; refund closes it', () => {
  const r = received();
  const { invoice: dmg, deposit } = applyToCharge(r.id, 'adjust', 11800, '2026-06-01', 'Repainting', ctx());
  assert.equal(dmg.doc_type, 'TAX_INVOICE');
  assert.equal(dmg.total, 11800);
  assert.equal(dmg.taxable_value, 10000);
  assert.equal(dmg.status, 'Paid');
  assert.equal(depositBalance(deposit), 88200);
  const f = applyToCharge(r.id, 'forfeit', 8200, '2026-06-02', '', ctx());
  assert.equal(f.invoice.items[0].name, 'Security deposit forfeited');
  assert.ok(f.invoice.tax_amount > 0);
  const out = refundDeposit(r.id, 80000, '2026-06-03');
  assert.equal(depositBalance(out), 0);
  assert.equal(out.status, 'closed');
  const v = loadVouchers().find((x) => x.id === out.movements[3].voucher_id)!;
  assert.equal(v.type, 'PAYMENT');
  assert.match(refundReceiptHtml(out, out.movements[3], 'Landlord & Co'), /Security deposit refund[\s\S]*Balance held/);
  assert.throws(() => refundDeposit(r.id, 1, '2026-06-04'), /balance/);
});

test('period lock refuses a movement; the party schedule CSV lists what is held', () => {
  const r = received();
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-06-30' });
  assert.throws(() => refundDeposit(r.id, 1000, '2026-06-15'), /lock/i);
  assert.equal(depositBalance(loadDeposits()[0]), 100000);
  refundDeposit(r.id, 1000, '2026-07-02');
  const csv = depositScheduleCsv(loadDeposits(), '2026-07-31', ['Party', 'Direction', 'Date', 'Amount', 'Adjusted', 'Refunded', 'Balance']);
  assert.equal(csv.split('\r\n')[1], 'Shop Tenant,received,2026-04-05,100000,0,1000,99000');
});
