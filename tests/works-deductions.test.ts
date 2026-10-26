/** R5-B5: RA deductions, net payable, due-now vs held, receipts by kind, retention release, ageing. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupWorks } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { computeDeductions, netPayable } from '../src/lib/works/deductions.ts';
import { saveBoqTerms } from '../src/lib/works/boq.ts';
import { saveRaBill } from '../src/lib/works/measurements.ts';
import { raDueSplit } from '../src/lib/works/ra-due.ts';
import { receiptPlan, recordDeductionRow, recoverAdvance, releaseHeld, GST_TDS_RECEIVABLE_ACCOUNT } from '../src/lib/works/ra-receivable.ts';
import { heldRegister, worksNotices } from '../src/lib/works/works-alerts.ts';
import { buildReceivables } from '../src/lib/receivables.ts';
import { buildGstr1 } from '../src/lib/gst-reports.ts';
import { saveAdvance } from '../src/lib/advances.ts';
import { loadLedger } from '../src/lib/ledger/index.ts';
import { chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import { amountDue } from '../src/lib/amount-due.ts';
import { sectionText } from '../src/lib/ita2025.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

let boq: InvoiceRecord;
beforeEach(() => { boq = setupWorks(); });

const bill = { taxable_value: 100000, total: 118000, issue_date: '2026-06-30' };
const ctx = { contractValue: 1150000, previousGross: 0, previousRetention: 0, gstTdsDeductor: true, intraState: true };

test('retention % of value before GST (or incl. GST), capped at a % of the contract', () => {
  assert.equal(computeDeductions(bill, [{ kind: 'retention', rate: 5 }], ctx)[0].amount, 5000);
  assert.equal(computeDeductions(bill, [{ kind: 'retention', rate: 5, basis: 'gross' }], ctx)[0].amount, 5900);
  // Cap 1% of ₹11.5 lakh = ₹11,500; ₹9,000 already retained → ₹2,500 left.
  assert.equal(computeDeductions(bill, [{ kind: 'retention', rate: 5, cap_pct: 1 }], { ...ctx, previousRetention: 9000 })[0].amount, 2500);
  assert.equal(computeDeductions(bill, [{ kind: 'retention', rate: 5, cap_pct: 1 }], { ...ctx, previousRetention: 11500 }).length, 0);
});

test('advance recovery: linear %, from a threshold, never past the advance balance', () => {
  const adv = { amount: 50000, recovered: 0 };
  assert.equal(computeDeductions(bill, [{ kind: 'advance_recovery', rate: 10 }], { ...ctx, advance: adv })[0].amount, 10000);
  assert.equal(computeDeductions(bill, [{ kind: 'advance_recovery', rate: 10 }], { ...ctx, advance: { amount: 50000, recovered: 45000 } })[0].amount, 5000);
  // Start after 10% of ₹11.5 lakh (₹1,15,000) of work: ₹60,000 billed before → only ₹45,000 of this bill counts.
  assert.equal(computeDeductions(bill, [{ kind: 'advance_recovery', rate: 10, start_after_pct: 10 }], { ...ctx, previousGross: 60000, advance: adv })[0].amount, 4500);
  assert.equal(computeDeductions(bill, [{ kind: 'advance_recovery', rate: 10, start_after_pct: 20 }], { ...ctx, advance: adv }).length, 0);
});

test('GST TDS: 2% on value excl. GST, only for a Sec 51 deductor above ₹2.5 lakh; CGST + SGST vs IGST; cess; 194C label', () => {
  const [g] = computeDeductions(bill, [{ kind: 'gst_tds' }], ctx);
  assert.equal(g.amount, 2000);
  assert.match(g.label, /CGST 1% \+ SGST 1%/);
  assert.match(computeDeductions(bill, [{ kind: 'gst_tds' }], { ...ctx, intraState: false })[0].label, /IGST 2%/);
  assert.equal(computeDeductions(bill, [{ kind: 'gst_tds' }], { ...ctx, contractValue: 250000 }).length, 0, 'not above ₹2.5 lakh');
  assert.equal(computeDeductions(bill, [{ kind: 'gst_tds' }], { ...ctx, gstTdsDeductor: false }).length, 0);
  assert.equal(computeDeductions({ ...bill, issue_date: '2018-09-01' }, [{ kind: 'gst_tds' }], ctx).length, 0, 'before 1 Oct 2018');
  assert.equal(computeDeductions(bill, [{ kind: 'labour_cess' }], ctx)[0].amount, 1000);
  const it = computeDeductions(bill, [{ kind: 'it_tds', section: '194C-2' }], ctx)[0];
  assert.equal(it.amount, 2000);
  assert.ok(it.label.includes(sectionText('194C-2', '2026-06-30')));
  assert.match(it.label, /\[old 194C\]/, 'Income-tax Act 2025 label from 1 Apr 2026');
  assert.equal(netPayable({ total: 118000 }, computeDeductions(bill, [{ kind: 'retention', rate: 5 }, { kind: 'it_tds' }, { kind: 'gst_tds' }, { kind: 'labour_cess' }], ctx)), 118000 - 5000 - 2000 - 2000 - 1000);
});

function raOne(): InvoiceRecord {
  saveBoqTerms(boq.id, { deductions: [{ kind: 'retention', rate: 5 }, { kind: 'it_tds', section: '194C-2' }, { kind: 'gst_tds' }, { kind: 'labour_cess' }], dlp_months: 12 });
  return saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] }).invoice;
}

test('RA bill snapshot: total and GST unchanged, IT TDS on the invoice fields, net payable, GSTR-1 unchanged', () => {
  const inv = raOne();
  assert.equal(inv.taxable_value, 100000);
  assert.equal(inv.total, 118000);
  assert.equal(inv.cgst_amount + inv.sgst_amount, 18000);
  assert.deepEqual(inv.ra_deductions?.map((d) => [d.kind, d.amount]), [['retention', 5000], ['it_tds', 2000], ['gst_tds', 2000], ['labour_cess', 1000]]);
  assert.equal(inv.tds_enabled, true);
  assert.equal(inv.tds_amount, 2000);
  assert.equal(inv.ra_net_payable, 108000);
  assert.equal(inv.retention_release_on, undefined, 'DLP counts from completion (final bill)');
  assert.equal(amountDue(inv, 0), 116000, 'receivable balance nets IT TDS only');
  const g1 = buildGstr1(localDb.invoices.getAll(), { period: { kind: 'month', fyStart: 2026, month: 6 } });
  const row = g1.gstr1.b2b.find((r) => r.invoiceId === inv.id)!;
  assert.equal(row.value, 118000);
  assert.equal(row.taxable, 100000);
});

test('raDueSplit: due now vs held buckets; receipts by kind settle them; ageing uses due now', () => {
  const inv = raOne();
  const pays = () => getTable<Payment>('transactions');
  const split0 = raDueSplit(inv, pays(), 116000);
  assert.equal(split0.dueNow, 108000);
  assert.deepEqual(split0.held.map((h) => [h.kind, h.amount]), [['retention', 5000], ['gst_tds', 2000], ['labour_cess', 1000]]);
  // Ageing: the bill is due on 2026-06-30 + 14 days; on 2026-12-31 only ₹1,08,000 is overdue, ₹8,000 sits in "Not due".
  const rep = buildReceivables({ invoices: localDb.invoices.getAll(), payments: pays(), clients: localDb.clients.getAll() }, { now: new Date('2026-12-31T10:00:00') });
  const b = rep.parties[0].bills[0];
  assert.equal(b.outstanding, 116000);
  assert.equal(b.held, 8000);
  assert.equal(rep.totals.buckets['Not due'], 8000);
  assert.equal(rep.totals.overdue, 108000);
  // Receipt pre-fill and rows by kind.
  const plan = receiptPlan(inv, pays(), 116000);
  assert.equal(plan.cash, 108000);
  assert.deepEqual(plan.rows.map((r) => r.kind), ['gst_tds', 'labour_cess']);
  localDb.payments.record({ invoiceId: inv.id, amount: 108000, method: 'Bank transfer', date: '2026-07-20' });
  recordDeductionRow(inv.id, 'gst_tds', { date: '2026-07-20' });
  recordDeductionRow(inv.id, 'labour_cess', { date: '2026-07-20' });
  assert.throws(() => recordDeductionRow(inv.id, 'gst_tds', { date: '2026-07-21' }), /Nothing is left/);
  const live = localDb.invoices.getById(inv.id)!;
  const split1 = raDueSplit(live, pays(), amountDue(live, 0));
  assert.equal(split1.dueNow, 0);
  assert.deepEqual(split1.held.map((h) => [h.kind, h.amount]), [['retention', 5000]]);
  assert.ok(chartOf(loadUserAccounts()).some((a) => a.name === GST_TDS_RECEIVABLE_ACCOUNT));
  // The deduction journals post Dr GST TDS receivable / cess, Cr debtors (no cash) and the rows are not posted twice.
  const ledger = loadLedger();
  const lines = ledger.vouchers.flatMap((v) => v.lines);
  const bal = (acc: string) => lines.filter((l) => l.account === acc).reduce((s, l) => s + l.dr - l.cr, 0);
  assert.equal(bal('debtors'), 700000, 'retention ₹5,000 + the IT TDS ₹2,000 (booked when the bill is fully settled)');
  const clearing = chartOf(loadUserAccounts()).length && lines.filter((l) => l.account.startsWith('bank:')).reduce((s, l) => s + l.dr - l.cr, 0);
  assert.equal(clearing, 0, 'the deductions clearing account nets to zero');
  // Release of retention.
  releaseHeld(inv.id, 'retention', { date: '2027-07-01', amount: 5000, method: 'Bank transfer' });
  const done = localDb.invoices.getById(inv.id)!;
  assert.equal(raDueSplit(done, pays(), amountDue(done, 0)).held.length, 0);
  assert.equal(done.status, 'Paid');
  const after = loadLedger().vouchers.flatMap((v) => v.lines).filter((l) => l.account === 'debtors').reduce((s, l) => s + l.dr - l.cr, 0);
  assert.equal(after, 0, 'fully settled: IT TDS moved to TDS receivable with the last receipt');
});

test('advance recovery is the existing advance adjustment, tagged; retention bell from the release day', () => {
  const adv = saveAdvance({ client: { id: 'c-pwd', name: 'PWD Division 3' }, date: '2026-05-05', amount: 118000, method: 'Bank transfer', place_of_supply: '27', supply: 'services', tax_rate: 18 } as never, { today: '2026-05-05' });
  saveBoqTerms(boq.id, { deductions: [{ kind: 'retention', rate: 5 }, { kind: 'advance_recovery', rate: 10 }], advance_id: adv.id, release_on: '2027-06-30' });
  const inv = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] }).invoice;
  assert.equal(inv.ra_deductions?.find((d) => d.kind === 'advance_recovery')?.amount, 10000);
  assert.equal(inv.retention_release_on, '2027-06-30');
  const p = recoverAdvance(inv.id, { date: '2026-07-01' });
  assert.equal(p.advance_id, adv.id);
  assert.equal(getTable<Payment>('transactions').find((x) => x.id === p.id)?.ra_kind, 'advance_recovery');
  const held = heldRegister(localDb.invoices.getAll(), getTable<Payment>('transactions'));
  assert.deepEqual(held.map((h) => h.kind), ['retention']);
  assert.equal(worksNotices(localDb.invoices.getAll(), getTable<Payment>('transactions'), '2027-05-01', 'now').length, 0);
  assert.equal(worksNotices(localDb.invoices.getAll(), getTable<Payment>('transactions'), '2027-06-10', 'now')[0].severity, 'info');
  assert.equal(worksNotices(localDb.invoices.getAll(), getTable<Payment>('transactions'), '2027-07-10', 'now')[0].severity, 'warning');
});
