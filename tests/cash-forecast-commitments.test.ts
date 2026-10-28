/** PENDING 39: cash forecast nets credit notes and adds GST / TDS deposits, loan EMIs and salaries. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildForecast, gstTdsCommitments, loanCommitments, payrollCommitments } from '../src/lib/cash-forecast.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const TODAY = '2026-10-24';
const inv = (over: Partial<InvoiceRecord>) =>
  ({ id: 'x', invoice_number: 'INV/x', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-09-01', due_date: '2026-11-01', currency: 'INR', client: { id: 'c1', name: 'Acme' }, total: 1000, balance_due: 1000, amount_paid: 0, ...over }) as InvoiceRecord;

test('live credit notes reduce expected receipts: linked off the bill, unlinked off the party', () => {
  const invoices = [
    inv({ id: 'a', invoice_number: 'INV/1', total: 5000, balance_due: 5000 }),
    inv({ id: 'b', invoice_number: 'INV/2', total: 3000, balance_due: 3000, due_date: '2026-11-10' }),
    inv({ id: 'cn1', doc_type: 'CREDIT_NOTE', invoice_number: 'CN/1', total: 1000, balance_due: 1000 }),
    inv({ id: 'cn2', doc_type: 'CREDIT_NOTE', invoice_number: 'CN/2', total: 500, balance_due: 500 }),
    inv({ id: 'cn3', doc_type: 'CREDIT_NOTE', invoice_number: 'CN/3', status: 'Cancelled', total: 900, balance_due: 900 }),
  ];
  const f = buildForecast({ today: TODAY, horizon: 30, opening: 0, invoices, payments: [], purchases: [], links: [{ from_id: 'b', to_id: 'cn1', relation: 'credit_note' }] });
  const amt = (ref: string) => f.items.find((i) => i.ref === ref)?.amount;
  assert.equal(amt('INV/1'), 4500, 'unlinked CN/2 (500) comes off the party');
  assert.equal(amt('INV/2'), 2000, 'linked CN/1 (1000) comes off its bill');
  assert.equal(f.totals.inflow, 6500);
});

test('GST: output tax less ITC (+ RCM) on the 20th; TDS on bills on the 7th', () => {
  const invoices = [
    inv({ id: 's1', issue_date: '2026-10-05', tax_amount: 1800 }),
    inv({ id: 'c1', doc_type: 'CREDIT_NOTE', issue_date: '2026-10-08', tax_amount: 180 }),
    inv({ id: 's0', issue_date: '2026-09-05', tax_amount: 900 }), // Sept GST was due 20 Oct — before today
  ];
  const purchases = [
    { id: 'p1', kind: 'PURCHASE', bill_number: 'B1', date: '2026-10-10', taxable: 5000, cgst: 450, sgst: 450, igst: 0, total: 5900, amount_paid: 0, itc_eligible: true, tds_amount: 100 },
    { id: 'p2', kind: 'EXPENSE', bill_number: 'B2', date: '2026-10-11', taxable: 1000, cgst: 0, sgst: 0, igst: 180, total: 1180, amount_paid: 0, itc_eligible: true, reverse_charge: true },
  ];
  const items = gstTdsCommitments(invoices, purchases, [], TODAY, '2026-12-31');
  // Oct: 1800 − 180 − 900 ITC = 720, + 180 reverse charge = 900, due 20 Nov. TDS 100 due 7 Nov.
  assert.deepEqual(items.map((i) => [i.ref, i.date, i.amount]), [['GST Oct 2026', '2026-11-20', 900], ['TDS Oct 2026', '2026-11-07', 100]]);
});

test('loan EMIs not yet paid, and salaries from the latest final run', () => {
  const loan = { number: 'LOAN/1', lender: 'HDFC', principal: 12000, rate: 0, tenure_months: 12, first_emi: '2026-09-05', payments: [{ n: 1 }] } as never;
  const emis = loanCommitments([loan], '2026-12-31');
  assert.deepEqual(emis.map((e) => [e.ref, e.date, e.amount]), [['LOAN/1 EMI 2', '2026-10-05', 1000], ['LOAN/1 EMI 3', '2026-11-05', 1000], ['LOAN/1 EMI 4', '2026-12-05', 1000]]);
  const runs = [
    { month: '2026-08', status: 'final', lines: [{ net: 1 }] },
    { month: '2026-09', status: 'final', lines: [{ net: 40000, pf_ee: 1800, epf_er: 550, eps: 1250, tds: 400 }, { net: 20000, esi_ee: 150, esi_er: 650 }] },
    { month: '2026-10', status: 'draft', lines: [{ net: 99 }] },
  ];
  const sal = payrollCommitments(runs, [{ kind: 'pf', period: '2026-09' }], TODAY, '2026-11-30');
  assert.deepEqual(sal.map((s) => [s.ref, s.date, s.amount]), [
    ['Salaries Oct 2026', '2026-10-31', 60000],
    ['Salary dues Oct 2026', '2026-11-15', 4800],
    ['Salaries Nov 2026', '2026-11-30', 60000],
  ]);
  const f = buildForecast({ today: TODAY, horizon: 30, opening: 100000, invoices: [], payments: [], purchases: [], commitments: [...emis, ...sal] });
  assert.equal(f.items.find((i) => i.ref === 'LOAN/1 EMI 2')?.date, TODAY, 'an EMI already due is expected today');
  assert.equal(f.items.find((i) => i.ref === 'LOAN/1 EMI 2')?.overdue, true);
  assert.equal(f.totals.outflow, 1000 + 1000 + 60000 + 4800);
});
