/**
 * PENDING 52 (ROADMAP 8.130 rest): loan prepayment re-schedule and the FY interest certificate, per-type rights for
 * purchase bills and vouchers, catalogue cart in a foreign currency.
 */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { emiSchedule, interestCertificate, loadLoans, loanStatement, payEmi, saveLoan } from '../src/lib/loans.ts';
import { setActorProvider } from '../src/lib/access.ts';
import '../src/lib/user-rights.ts'; // registers the rights rules
import { purchasesDb } from '../src/lib/purchases.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { deleteVoucher, loadVouchers, saveVoucher } from '../src/lib/ledger/vouchers.ts';
import { buildCatalogueHtml, cartMessage, catalogueCurrency } from '../src/lib/catalogue-html.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
afterEach(() => setActorProvider(null));

/* ── Loans ─────────────────────────────────────────────────── */

test('loans: a prepayment re-schedules — shorter tenure or lower EMI; without a choice nothing changes', () => {
  const base = { lender: 'HDFC Bank', principal: 120000, rate: 0, tenure_months: 12, date: '2026-04-05', first_emi: '2026-05-05' };
  const pay = (reschedule?: 'emi' | 'tenure') => [
    { id: 'p1', n: 1, date: '2026-05-05', principal: 10000, interest: 0, voucher_id: '', voucher_number: '' },
    { id: 'p2', n: 2, date: '2026-06-05', principal: 10000, interest: 0, voucher_id: '', voucher_number: '' },
    { id: 'pp', n: 0, date: '2026-06-20', principal: 30000, interest: 0, voucher_id: '', voucher_number: '', ...(reschedule ? { reschedule } : {}) },
  ];
  const tenure = emiSchedule({ ...base, payments: pay('tenure') });
  assert.equal(tenure.length, 9, '70,000 left at 10,000 a month: 7 more EMIs');
  assert.equal(tenure[2].opening, 70000);
  assert.equal(tenure.at(-1)!.closing, 0);
  const emi = emiSchedule({ ...base, payments: pay('emi') });
  assert.equal(emi.length, 12);
  assert.equal(emi[2].emi, 7000, '70,000 over the 10 months left');
  assert.equal(emi.at(-1)!.closing, 0);
  const none = emiSchedule({ ...base, payments: pay() });
  assert.deepEqual(none, emiSchedule(base), 'a prepayment without a re-schedule leaves the schedule as before');
});

test('loans: recorded prepayment with interest re-schedules, and the FY interest certificate adds up', () => {
  const loan = saveLoan({ lender: 'SBI', principal: 120000, rate: 12, tenure_months: 12, date: '2026-04-05', first_emi: '2026-05-05' });
  const e1 = payEmi(loan.id, 1);
  const e2 = payEmi(loan.id, 2);
  const before = loanStatement(loadLoans()[0], '2026-06-30').schedule;
  const pp = payEmi(loan.id, 0, { date: '2026-06-20', principal: 30000, interest: 0, reschedule: 'emi' });
  assert.equal(pp.reschedule, 'emi');
  assert.match(loadVouchers().find((v) => v.id === pp.voucher_id)!.narration, /Prepayment \(EMI re-scheduled\)/);
  const st = loanStatement(loadLoans()[0], '2026-06-30');
  assert.equal(st.schedule[2].opening, Math.round((before[1].closing - 30000) * 100) / 100);
  assert.ok(st.emi < before[2].emi, 'a lower EMI from the next instalment');
  assert.equal(st.schedule.at(-1)!.closing, 0);
  payEmi(loan.id, 3);
  const c = interestCertificate(loadLoans()[0], 2026);
  assert.equal(c.from, '2026-04-01');
  assert.equal(c.opening, 0);
  assert.equal(c.disbursed, 120000);
  assert.equal(c.payments.length, 4);
  assert.equal(c.interest, Math.round((e1.interest + e2.interest + st.schedule[2].interest) * 100) / 100);
  assert.equal(c.closing, Math.round((120000 - c.principal) * 100) / 100);
  const next = interestCertificate(loadLoans()[0], 2027);
  assert.deepEqual([next.opening, next.disbursed, next.principal, next.interest, next.closing], [c.closing, 0, 0, 0, c.closing]);
});

/* ── Per-type rights ───────────────────────────────────────── */

const bill = (): Omit<PurchaseRecord, 'id'> => ({
  kind: 'EXPENSE', vendor_name: 'Landlord', bill_number: 'R-1', date: '2026-05-10', category: 'Rent',
  lines: [{ id: 'l1', name: 'Rent', quantity: 1, rate: 1000, tax_rate: 0 }],
  taxable: 1000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 1000, amount_paid: 0,
} as Omit<PurchaseRecord, 'id'>);
const jv = (date: string) => ({ type: 'JOURNAL' as const, date, narration: 'Accrual', lines: [{ account_id: A.rent, dr: 10000, cr: 0 }, { account_id: A.provisions, dr: 0, cr: 10000 }] });

test('rights: purchase bills and vouchers follow their own create / alter / delete rights', () => {
  const b = purchasesDb.save(bill());
  const v = saveVoucher(jv('2026-05-10'));
  setActorProvider(() => ({ id: 'c1', name: 'Clerk', role: 'clerk', rights: { docs: { purchase: { create: false, delete: false } } } }));
  assert.throws(() => purchasesDb.save(bill()), /may not create purchase bills/);
  assert.throws(() => purchasesDb.remove(b.id), /may not delete purchase bills/);
  purchasesDb.save({ ...b, category: 'Office rent' }); // alter stays allowed
  saveVoucher(jv('2026-05-11')); // vouchers untouched
  setActorProvider(() => ({ id: 'c1', name: 'Clerk', role: 'clerk', rights: { docs: { voucher: { alter: false, delete: false } } } }));
  assert.throws(() => saveVoucher({ ...jv('2026-05-10'), id: v.id }), /may not change vouchers/);
  assert.throws(() => deleteVoucher(v.id), /may not delete vouchers/);
  purchasesDb.remove(b.id); // purchase rights untouched
  // The back-dated window holds the voucher date (not the supplier's bill date).
  setActorProvider(() => ({ id: 'c1', name: 'Clerk', role: 'clerk', rights: { back_days: 3 } }));
  assert.throws(() => saveVoucher(jv('2020-01-01')), /day\(s\) back/);
  purchasesDb.save({ ...bill(), date: '2020-01-01' });
  // A POS-only cashier keeps the counter's refund vouchers; the owner is never limited.
  setActorProvider(() => ({ id: 'k1', name: 'Cashier', role: 'clerk', rights: { pos_only: true, docs: { voucher: { create: false } } } }));
  saveVoucher(jv('2026-05-12'));
  setActorProvider(() => ({ id: 'owner', name: 'O', role: 'owner', rights: { docs: { voucher: { delete: false } } } }));
  deleteVoucher(v.id);
});

/* ── Catalogue in a foreign currency ───────────────────────── */

test('catalogue: prices, MRP, cart data and the order message in a foreign currency', () => {
  const items = [{ id: 'a', name: 'Tea 1 kg', type: 'goods', quantity: 1, rate: 800, tax_rate: 0, amount: 800, mrp: 1000, unit: 'KG' }] as InvoiceItem[];
  assert.deepEqual(catalogueCurrency({ code: 'usd', rate: 80 }), { code: 'USD', rate: 80 });
  assert.deepEqual(catalogueCurrency({ code: 'INR', rate: 1 }), { code: '', rate: 1 });
  assert.deepEqual(catalogueCurrency({ code: 'USD', rate: 0 }), { code: '', rate: 1 }, 'no rate: rupees');
  const html = buildCatalogueHtml(items, { business: 'Shop', currency: { code: 'USD', rate: 80 } });
  assert.match(html, /USD 10\.00 <s>MRP USD 12\.50<\/s>/);
  assert.match(html, /prices in USD at ₹80 per USD/);
  assert.ok(!html.includes('₹800'));
  assert.match(cartMessage('Shop', [{ name: 'Tea', qty: 3, price: 10 }], { currency: 'USD' }), /Tea × 3 @ USD 10\.00 = USD 30\.00\n\nTotal: USD 30\.00/);
  assert.match(cartMessage('Shop', [{ name: 'Tea', qty: 3, price: 10 }]), /Total: ₹30\.00/, 'rupees unchanged');
  assert.match(buildCatalogueHtml(items, { business: 'Shop' }), /₹800\.00/);
});
