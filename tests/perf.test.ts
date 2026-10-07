/**
 * Performance sanity: 500-line invoices, and the report engines over 5,000
 * invoices + 5,000 purchases. Timings are logged (visible in the TAP output as
 * "# perf ...") and capped generously so only a real complexity regression
 * (a quadratic loop, repeated JSON parsing in a loop) fails the build.
 */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rng, resetStorage } from './helpers/shim.ts';
import { calcInputFromRecord, calculateInvoice } from '../src/lib/invoice-calc.ts';
import { summarize, monthlyBilled, attentionList } from '../src/lib/stats.ts';
import { buildReceivables, monthlyCollections, computeDso } from '../src/lib/receivables.ts';
import { balanceSheet, buildVouchers, cashBook, dayBookRange, monthlyTrend, profitAndLoss, gstSummary, type BooksData } from '../src/lib/books.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { computeStock, blankStockItem } from '../src/lib/inventory.ts';
import { buildTallyModel } from '../src/lib/tally-xml.ts';
import { salesRegister, purchaseRegister, gstSummary as exportGstSummary } from '../src/lib/accounting-export.ts';
import { filterInvoices } from '../src/lib/export-shared.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setTable } from '../src/lib/storage.ts';
import { gstin, SELLER, SELLER_GSTIN } from './helpers/world.ts';
import type { Client, InvoiceItem, InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

const N = 5000;

function timed<T>(label: string, cap: number, fn: () => T): T {
  const t0 = performance.now();
  const out = fn();
  const ms = performance.now() - t0;
  console.log(`# perf ${label}: ${ms.toFixed(0)} ms`);
  assert.ok(ms < cap, `${label} took ${ms.toFixed(0)} ms (cap ${cap} ms)`);
  return out;
}

const r = rng(42);
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function makeData() {
  const clients: Client[] = Array.from({ length: 400 }, (_, i) => ({
    id: `c${i}`, name: `Client ${i}`, email: '', address: '', city: 'Pune', zip: '', state_code: i % 3 === 0 ? '29' : '27',
    gstin: i % 2 ? gstin(`${i % 3 === 0 ? '29' : '27'}AAACB${String(1000 + i).slice(-4)}M1Z`) : '',
  }));
  const invoices: InvoiceRecord[] = [];
  const payments: Payment[] = [];
  for (let i = 0; i < N; i++) {
    const month = 4 + (i % 12);
    const year = month > 12 ? 2027 : 2026;
    const m = ((month - 1) % 12) + 1;
    const date = `${year}-${String(m).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`;
    const client = clients[i % clients.length];
    const items: InvoiceItem[] = Array.from({ length: int(1, 5) }, (_, k) => ({
      id: `i${i}-${k}`, name: `Item ${int(1, 60)}`, type: 'g', hsn: '998311', unit: 'NOS',
      quantity: int(1, 20), rate: int(100, 99999) / 100, tax_rate: [5, 12, 18, 28][int(0, 3)], amount: 0,
    }));
    const base = {
      items, gst_mode: client.state_code === '27' ? 'CGST_SGST' : 'IGST', discount_type: 'PERCENT', discount_rate: int(0, 10),
      tax_rate: 18, shipping: 0, other_charges: 0, round_off_enabled: true, amount_paid: 0,
    } as const;
    const t = calculateInvoice(base);
    const status = i % 40 === 0 ? 'Draft' : i % 53 === 0 ? 'Cancelled' : 'Sent';
    const paid = status === 'Sent' && i % 5 < 3 ? t.total : 0;
    const inv = {
      ...base, id: `inv${i}`, invoice_number: `INV/FY26-27/${String(i + 1).padStart(4, '0')}`, doc_type: i % 97 === 0 ? 'QUOTATION' : 'INVOICE',
      status: paid >= t.total && paid > 0 ? 'Paid' : status, issue_date: date, due_date: date, currency: 'INR', template_id: 't',
      client: { ...client, id: i % 10 === 0 ? undefined : client.id }, // some legacy rows without a client id
      sender: SELLER, place_of_supply: client.state_code ?? '27', reverse_charge: false, notes: '', terms: '',
      subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount,
      sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total,
      amount_paid: paid, balance_due: t.total - paid,
    } as unknown as InvoiceRecord;
    invoices.push(inv);
    if (paid > 0) payments.push({ id: `p${i}`, invoice_id: inv.id, amount: paid, method: i % 2 ? 'UPI' : 'Cash', date });
  }
  const purchases: PurchaseRecord[] = Array.from({ length: N }, (_, i) => {
    const taxable = int(1000, 500000) / 100;
    const gst = Math.round(taxable * 18) / 100;
    const m = 4 + (i % 12);
    return {
      id: `pur${i}`, kind: i % 9 === 0 ? 'EXPENSE' : 'PURCHASE', vendor_name: `Vendor ${i % 150}`, bill_number: `B${i}`,
      date: `${m > 12 ? 2027 : 2026}-${String(((m - 1) % 12) + 1).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`,
      category: 'Purchases', lines: [{ id: `l${i}`, name: `Item ${int(1, 60)}`, quantity: 5, rate: taxable / 5, tax_rate: 18 }],
      taxable, cgst: Math.round(gst * 50) / 100, sgst: Math.round(gst * 50) / 100, igst: 0, itc_eligible: i % 7 !== 0,
      total: Math.round((taxable + gst) * 100) / 100, amount_paid: 0,
    } as PurchaseRecord;
  });
  return { clients, invoices, payments, purchases };
}

test('calculateInvoice: a 500-line invoice with discounts, cess and inclusive pricing', () => {
  const items: InvoiceItem[] = Array.from({ length: 500 }, (_, i) => ({
    id: `l${i}`, name: `L${i}`, type: 'g', hsn: '998311', quantity: 1 + (i % 9), rate: 100 + i * 1.37, tax_rate: [5, 12, 18, 28][i % 4],
    discount_percent: i % 3 ? 0 : 7.5, cess_rate: i % 50 === 0 ? 12 : 0, amount: 0,
  }));
  const input = {
    items, gst_mode: 'CGST_SGST' as const, discount_type: 'PERCENT' as const, discount_rate: 3, tax_rate: 18, shipping: 100, other_charges: 50,
    round_off_enabled: true, amount_paid: 0, price_includes_tax: true, tcs_enabled: true, tcs_rate: 0.1, tds_enabled: true, tds_rate: 2,
  };
  const t = timed('calculateInvoice x 500 lines (single run)', 400, () => calculateInvoice(input));
  assert.equal(t.lines.length, 500);
  timed('calculateInvoice x 500 lines (50 runs, UI keystrokes)', 4000, () => {
    for (let i = 0; i < 50; i++) calculateInvoice(input);
  });
  assert.ok(Number.isFinite(t.total));
});

test(`reports over ${N} invoices + ${N} purchases stay fast and consistent`, () => {
  const { clients, invoices, payments, purchases } = makeData();
  const now = new Date('2027-02-01T10:00:00');
  const period = { start: '2026-04-01', end: '2027-03-31' };

  const s = timed('stats.summarize', 500, () => summarize(invoices, now, []));
  assert.ok(s.billed > 0);
  timed('stats.monthlyBilled + attentionList', 500, () => {
    monthlyBilled(invoices, 12, now);
    attentionList(invoices, 5, now);
  });

  const rec = timed('receivables.buildReceivables', 2500, () => buildReceivables({ invoices, payments, clients }, { now }));
  timed('receivables.monthlyCollections + DSO', 500, () => {
    monthlyCollections(rec, 12, now);
    computeDso(rec, 90, now);
  });
  assert.equal(rec.totals.net, s.outstanding, 'ledger and dashboard still agree at scale');

  const data: BooksData = { invoices, transactions: payments, purchases: purchases as never[], vendors: [], purchasePayments: [], openings: [] };
  timed('books.buildVouchers + dayBook + cashBook', 1500, () => {
    const v = buildVouchers(data);
    dayBookRange(v, period);
    cashBook(v, [], 'bank', period);
  });
  const pl = timed('books.profitAndLoss (accrual + cash)', 1500, () => {
    profitAndLoss(data, period, 'cash');
    return profitAndLoss(data, period, 'accrual');
  });
  assert.ok(pl.income > 0);
  timed('books.monthlyTrend', 1500, () => monthlyTrend(data, period));
  timed('books.balanceSheet + gstSummary', 2500, () => {
    balanceSheet(data, period.end);
    gstSummary(data, period);
  });

  const rep = timed('gst-reports.buildGstReport (FY)', 4000, () =>
    buildGstReport(invoices, purchases, { period: { kind: 'fy', fyStart: 2026 }, gstin: SELLER_GSTIN }),
  );
  assert.ok(rep.gstr1.totals.taxable > 0);

  timed('accounting-export sales/purchase register + gst summary', 3000, () => {
    salesRegister(filterInvoices(invoices, {}));
    const src = { invoices, payments, clients, items: [], purchases: purchases as unknown[], vendors: [] };
    purchaseRegister(src);
    exportGstSummary(src);
  });
  timed('tally-xml build (vouchers, receipts, purchases)', 5000, () =>
    buildTallyModel({ invoices, payments, clients, items: [], purchases: purchases as unknown[], vendors: [] }, { companyName: 'X', includeInventory: true }),
  );

  const items = Array.from({ length: 200 }, (_, i) => blankStockItem({ id: `s${i}`, name: `Item ${i + 1}`, opening_qty: 1000, opening_rate: 50, hsn: '998311' }));
  timed('inventory.computeStock (200 items, weighted + FIFO)', 4000, () => {
    computeStock({ items, moves: [], invoices, purchases: purchases as never[], method: 'WEIGHTED_AVG' });
    computeStock({ items, moves: [], invoices, purchases: purchases as never[], method: 'FIFO' });
  });
});

test('storage-backed paths: reading a 5,000-row table repeatedly is not done in a loop by the libs', () => {
  resetStorage();
  const { invoices, payments } = makeData();
  setTable('invoices', invoices);
  setTable('transactions', payments);
  // One representative bulk operation per module that reads storage: all must be linear in the table size.
  timed('localDb.invoices.getAll x 10', 2500, () => {
    for (let i = 0; i < 10; i++) localDb.invoices.getAll();
  });
  timed('localDb.payments.record x 20 on a 5,000-invoice table', 4000, () => {
    for (let i = 0; i < 20; i++) {
      const inv = invoices[1 + i * 7];
      if (inv.status === 'Paid' || inv.status === 'Draft' || inv.status === 'Cancelled') continue;
      localDb.payments.record({ invoiceId: inv.id, amount: 1, method: 'UPI', date: '2026-05-01' });
    }
  });
  timed('localDb.invoices.nextNumber x 10', 3000, () => {
    for (let i = 0; i < 10; i++) localDb.invoices.nextNumber('2026-06-01');
  });
  timed('calcInputFromRecord + calculateInvoice for every stored invoice (re-derive all)', 4000, () => {
    for (const inv of localDb.invoices.getAll()) calculateInvoice(calcInputFromRecord(inv));
  });
});
