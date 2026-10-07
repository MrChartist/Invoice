/**
 * Sales & purchase reports must reconcile EXACTLY with the dashboard (stats.summarize), Books
 * (P&L income, expenses, GST summary, cash book) for the same period — same 16-document April
 * 2026 scenario as tests/integration/reconcile.test.ts, plus a previous-year invoice for YoY,
 * purchases, a second customer, a USD invoice and stock cost.
 */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, freezeDate, thawDate, inTimeZones } from './helpers/shim.ts';
import {
  clientKA,
  clientRetail,
  clientUS,
  createViaStore,
  installSettings,
  reload,
} from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { round2 } from '../src/lib/invoice-calc.ts';
import { summarize } from '../src/lib/stats.ts';
import { cashBook, buildVouchers, gstSummary, loadBooksData, profitAndLoss } from '../src/lib/books.ts';
import { createCreditNote, readLinks } from '../src/lib/documents.ts';
import { computeStock, blankStockItem } from '../src/lib/inventory.ts';
import { setTable } from '../src/lib/storage.ts';
import {
  canonicalMethod,
  concentration,
  customersCsv,
  expenseReport,
  expensesCsv,
  itemsCsv,
  monthlyCsv,
  paymentModes,
  previousYear,
  profitByItem,
  salesByCustomer,
  salesByItem,
  salesByMonth,
  salesDocs,
  shiftYear,
  sortRows,
  taxByRate,
  type CustomerReport,
} from '../src/lib/sales-reports.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const D = '2026-04-';
const APRIL = { start: '2026-04-01', end: '2026-04-30' };

function build() {
  resetStorage();
  installSettings();
  const mk = createViaStore;
  const live: InvoiceRecord[] = [];
  live.push(mk({ date: D + '03', lines: [{ name: 'Research subscription', hsn: '998311', qty: 10, rate: 1000, tax: 18 }] }));
  live.push(mk({ date: D + '04', client: clientKA, lines: [{ name: 'Algo licence', hsn: '997331', qty: 5, rate: 2000, tax: 12 }] }));
  live.push(mk({ date: D + '05', client: clientRetail, lines: [{ name: 'Report', hsn: '998311', qty: 3, rate: 333.33, tax: 18 }] }));
  live.push(mk({ date: D + '06', shipping: 100, lines: [{ name: 'Research subscription', hsn: '998311', qty: 2, rate: 5000, tax: 18, disc: 10 }] }));
  live.push(mk({ date: D + '07', tcs: { rate: 1 }, lines: [{ name: 'Hardware', hsn: '8471', qty: 1, rate: 20000, tax: 18 }] }));
  live.push(mk({ date: D + '08', client: clientUS, pos: '99', supply: 'EXPORT_LUT', lines: [{ name: 'Export services', hsn: '998313', qty: 1, rate: 50000, tax: 18 }] }));
  live.push(mk({ date: D + '09', lines: [{ name: 'Cola', hsn: '2202', qty: 1, rate: 10000, tax: 28, cess: 12 }] }));
  live.push(mk({ date: D + '10', tds: { rate: 10 }, lines: [{ name: 'Research subscription', hsn: '998311', qty: 1, rate: 10000, tax: 18 }] }));
  live.push(mk({ date: D + '11', inclusive: true, lines: [{ name: 'Report', hsn: '998311', qty: 1, rate: 5900, tax: 18 }] }));
  live.push(mk({ date: D + '12', lines: [{ name: 'Books', hsn: '4901', qty: 1, rate: 8000, tax: 5 }] }));

  // Invisible documents.
  const cancelled = mk({ date: D + '13', lines: [{ qty: 1, rate: 99999, tax: 18 }] });
  localDb.invoices.setStatus(cancelled.id, 'Cancelled');
  mk({ date: D + '13', asDraft: true, lines: [{ qty: 1, rate: 77777, tax: 18 }] });
  mk({ date: D + '13', docType: 'QUOTATION', lines: [{ qty: 1, rate: 66666, tax: 18 }] });
  mk({ date: D + '13', docType: 'PROFORMA', lines: [{ qty: 1, rate: 44444, tax: 18 }] });
  mk({ date: D + '13', docType: 'DELIVERY_CHALLAN', lines: [{ qty: 1, rate: 55555, tax: 18 }] });
  // Previous financial year: 31 March 2026 (FY25-26) and April 2025 (same month last year).
  mk({ date: '2026-03-31', lines: [{ name: 'Research subscription', hsn: '998311', qty: 1, rate: 1000, tax: 18 }] });
  mk({ date: '2025-04-15', lines: [{ name: 'Research subscription', hsn: '998311', qty: 4, rate: 1000, tax: 18 }] });
  // A USD invoice must never be added to rupees.
  mk({ date: D + '14', client: clientUS, currency: 'USD', pos: '99', supply: 'EXPORT_LUT', lines: [{ name: 'Export services', hsn: '998313', qty: 1, rate: 100, tax: 0 }] });

  // Money in.
  localDb.payments.record({ invoiceId: live[3].id, amount: 10720, method: 'UPI', date: D + '14' });
  localDb.payments.record({ invoiceId: live[9].id, amount: 3000, method: 'Cash', date: D + '15' });
  localDb.payments.record({ invoiceId: live[7].id, amount: 10800, method: 'Bank transfer', date: D + '16' });
  localDb.payments.record({ invoiceId: live[0].id, amount: 2000, method: 'upi', date: D + '20' });

  freezeDate('2026-04-25T11:00:00');
  const first = reload(live[0].id);
  const cn = createCreditNote(first, { lines: [{ itemId: first.items[0].id, quantity: 3 }], reason: 'Sales return' });
  thawDate();

  // Purchases / expenses (raw rows, as the purchases module writes them).
  setTable('purchases', [
    { id: 'b1', kind: 'PURCHASE', vendor_name: 'Acme Stationers', bill_number: 'AS-1', date: D + '05', category: 'Purchases', taxable: 10000, cgst: 900, sgst: 900, igst: 0, itc_eligible: true, total: 11800, amount_paid: 0, lines: [] },
    { id: 'b2', kind: 'EXPENSE', vendor_name: 'Landlord', bill_number: '', date: D + '01', category: 'Rent', taxable: 2000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 2000, amount_paid: 0, lines: [] },
    { id: 'b3', kind: 'EXPENSE', vendor_name: 'Cafe', bill_number: '', date: D + '09', category: 'Travel', taxable: 500, cgst: 45, sgst: 0, igst: 0, itc_eligible: false, total: 545, amount_paid: 0, lines: [] },
    { id: 'b4', kind: 'PURCHASE', vendor_name: 'Acme Stationers', bill_number: 'AS-2', date: D + '20', category: 'Purchases', taxable: 1000, cgst: 0, sgst: 0, igst: 180, itc_eligible: true, total: 1180, amount_paid: 0, lines: [] },
    { id: 'b5', kind: 'PURCHASE', vendor_name: 'Void Co', bill_number: 'V', date: D + '05', category: 'Purchases', taxable: 5000, cgst: 0, sgst: 0, igst: 900, itc_eligible: true, total: 5900, amount_paid: 0, status: 'Cancelled', lines: [] },
    { id: 'b6', kind: 'EXPENSE', vendor_name: 'Landlord', bill_number: '', date: '2026-03-01', category: 'Rent', taxable: 2000, total: 2000, amount_paid: 0, lines: [] },
  ]);
  return { live, cn };
}

function check(label: string) {
  const { live, cn } = build();
  const all = localDb.invoices.getAll();
  const links = readLinks();
  const now = new Date('2026-04-30T12:00:00');

  // Pre-conditions (so a wrong fixture cannot hide a wrong module).
  assert.equal(cn.total, 3540, label);
  assert.equal(live.length, 10);

  const { docs, excludedForeign } = salesDocs(all);
  assert.equal(excludedForeign, 1, `${label}: the USD invoice is excluded`);
  const cust = salesByCustomer(docs, APRIL);

  // ── Dashboard: gross billed, net of credit notes ─────────────
  const april = all.filter((i) => i.issue_date.startsWith('2026-04') && (i.currency || 'INR') === 'INR');
  const s = summarize(april, now, links, 'INR');
  assert.equal(s.billed, 145296, `${label}: stats billed`);
  assert.equal(cust.totals.total, s.billed, `${label}: customer total == dashboard billed`);
  assert.equal(cust.totals.count, s.count, `${label}: invoice count == dashboard count`);
  assert.equal(cust.totals.credited, s.credited, `${label}: credit notes`);
  assert.equal(cust.totals.creditNotes, 1);

  // ── Books P&L income ─────────────────────────────────────────
  const data = loadBooksData();
  const pl = profitAndLoss({ ...data, invoices: data.invoices.filter((i) => (i.currency || 'INR') === 'INR') }, APRIL, 'accrual');
  assert.equal(pl.income, 130100, `${label}: books income`);
  assert.equal(cust.totals.income, pl.income, `${label}: customer income == books income`);
  assert.equal(cust.totals.taxable, 129999.99, `${label}: taxable value`);
  // The bridge: total = taxable + GST&cess + (shipping, round-off, TCS)
  assert.equal(round2(cust.totals.taxable + cust.totals.tax), 129999.99 + 13760 + 1200);

  // ── customers: Bharat 8 docs incl. the credit note, etc. ─────
  const bharat = cust.rows.find((r) => r.name === 'Bharat Traders')!;
  assert.equal(bharat.creditNotes, 1);
  assert.equal(bharat.credited, 3540);
  assert.equal(bharat.count, 7, `${label}: Bharat invoices (#1,#4,#5,#7,#8,#9,#10)`);
  assert.equal(bharat.lastDate, '2026-04-12');
  assert.equal(bharat.avg, round2(bharat.total / bharat.count));
  assert.equal(round2(cust.rows.reduce((t, r) => t + r.share, 0)) > 99.9, true, 'shares add to ~100');
  assert.ok(cust.rows.every((r) => r.share >= 0));
  const retail = cust.rows.find((r) => r.name === 'Walk-in Customer')!;
  assert.equal(retail.total, 1180);

  // ── GST ─────────────────────────────────────────────────────
  const rates = taxByRate(docs, APRIL);
  const gst = gstSummary(data, APRIL);
  assert.equal(round2(rates.totals.cgst + rates.totals.sgst + rates.totals.igst), gst.outputTotal, `${label}: tax by rate == books GST`);
  assert.equal(rates.totals.tax, 13760);
  assert.equal(rates.totals.cess, gst.outputCess, `${label}: cess`);
  assert.equal(rates.totals.taxable, cust.totals.taxable, `${label}: taxable by rate == taxable by customer`);
  assert.deepEqual(rates.rows.map((r) => r.rate), [0, 5, 12, 18, 28]);
  assert.equal(rates.rows.find((r) => r.rate === 0)!.taxable, 50000, 'export under LUT is nil-rated');
  assert.equal(rates.rows.find((r) => r.rate === 0)!.tax, 0);
  assert.equal(rates.rows.find((r) => r.rate === 5)!.tax, 400);

  // ── items: lines true up to the documents ────────────────────
  const items = salesByItem(docs, APRIL, 'item');
  assert.equal(items.totals.taxable, cust.totals.taxable, `${label}: item taxable == customer taxable`);
  assert.equal(round2(items.totals.tax), round2(cust.totals.tax), `${label}: item tax == customer tax`);
  const sub = items.rows.find((r) => r.name === 'Research subscription')!;
  // 10x1000 + 2x5000(-10%) + 1x10000 - 3x1000 credited
  assert.equal(sub.quantity, 10 + 2 + 1 - 3);
  assert.equal(sub.taxable, 10000 + 9000 + 10000 - 3000);
  assert.equal(sub.avgRate, round2(sub.taxable / sub.quantity));
  const byHsn = salesByItem(docs, APRIL, 'hsn');
  assert.equal(byHsn.totals.taxable, cust.totals.taxable);
  assert.ok(byHsn.rows.some((r) => r.hsn === '998311'));

  // ── monthly + YoY ────────────────────────────────────────────
  const fy = { start: '2026-04-01', end: '2027-03-31' };
  const m = salesByMonth(docs, fy, '2026-04-30');
  assert.equal(m.rows.length, 12);
  assert.deepEqual(m.prevPeriod, { start: '2025-04-01', end: '2026-03-31' });
  assert.equal(m.rows[0].month, '2026-04');
  assert.equal(m.rows[0].taxable, cust.totals.taxable, `${label}: April taxable`);
  assert.equal(m.rows[0].total, cust.totals.total);
  assert.equal(m.rows[0].prevTaxable, 4000, 'April 2025 invoice');
  assert.equal(m.rows[0].change, round2(((129999.99 - 4000) / 4000) * 100));
  assert.equal(m.rows[11].prevTaxable, 1000, 'March 2026 is in the previous FY');
  assert.equal(m.rows[11].taxable, 0);
  assert.equal(m.rows[11].change, null, 'future months have no change');
  assert.equal(m.rows[11].future, true);
  assert.equal(m.rows[0].future, false);
  assert.equal(m.totals.prevTaxable, 5000);
  assert.equal(m.totals.change, m.rows[0].change, 'total change is like-for-like (only April has started)');
  // The FY total reconciles with the books for the whole FY.
  const plFy = profitAndLoss({ ...data, invoices: data.invoices.filter((i) => (i.currency || 'INR') === 'INR') }, fy, 'accrual');
  assert.equal(salesByCustomer(docs, fy).totals.income, plFy.income, `${label}: FY income`);
  const prev = profitAndLoss({ ...data, invoices: data.invoices.filter((i) => (i.currency || 'INR') === 'INR') }, m.prevPeriod, 'accrual');
  assert.equal(salesByCustomer(docs, m.prevPeriod).totals.income, prev.income, `${label}: previous FY income`);

  // ── payment modes == cash + bank receipts in Books ───────────
  const modes = paymentModes(localDb.payments.getAll(), all, APRIL);
  const vouchers = buildVouchers(data);
  const books = cashBook(vouchers, [], 'cash', APRIL).totalReceipts + cashBook(vouchers, [], 'bank', APRIL).totalReceipts;
  assert.equal(modes.total, round2(books), `${label}: payment modes == books receipts`);
  assert.equal(modes.total, 26520);
  assert.deepEqual(modes.rows.map((r) => [r.method, r.amount]), [['UPI', 12720], ['Bank transfer', 10800], ['Cash', 3000]]);
  assert.equal(modes.rows[0].count, 2, 'upi + UPI are one mode');
  assert.ok(Math.abs(modes.rows.reduce((t, r) => t + r.share, 0) - 100) <= 0.02);

  // ── expenses == books P&L expenses ───────────────────────────
  const exp = expenseReport(data.purchases, data.vendors, APRIL);
  assert.equal(exp.totals.cost, pl.totalExpenses, `${label}: expenses == books expenses`);
  assert.equal(exp.totals.cost, 10000 + 1000 + 2000 + 545);
  assert.equal(exp.totals.itc, 900 + 900 + 180);
  assert.equal(exp.categories.find((c) => c.category === 'Purchases')!.direct, true);
  assert.equal(exp.categories.find((c) => c.category === 'Travel')!.cost, 545, 'non-ITC GST is a cost');
  assert.deepEqual(exp.vendors.map((v) => v.vendor), ['Acme Stationers', 'Landlord', 'Cafe']);
  assert.equal(exp.vendors[0].count, 2);
  assert.ok(Math.abs(exp.vendors.reduce((t, v) => t + v.share, 0) - 100) <= 0.02);
  assert.equal(exp.totals.count, 4, 'cancelled and out-of-period bills are excluded');

  // ── CSV exports are well formed ──────────────────────────────
  assert.match(customersCsv(cust, APRIL), /^"?Sales by customer 2026-04-01 to 2026-04-30/);
  assert.match(itemsCsv(items, 'item', APRIL), /Research subscription/);
  assert.match(monthlyCsv(m), /Apr 26,/);
  assert.match(expensesCsv(exp, 'vendor', APRIL), /Acme Stationers/);
}

test('reports reconcile with dashboard, books, GST and cash book on a 16-document period (UTC)', () => check('UTC'));

test('... and in every time zone (month / FY filters never shift a day)', () => {
  inTimeZones(['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland', 'Pacific/Honolulu'], (tz) => check(tz));
});

/* ── focused unit tests ───────────────────────────────────────── */

test('period helpers: previous year and 29 Feb', () => {
  assert.equal(shiftYear('2028-02-29', -1), '2027-02-28');
  assert.deepEqual(previousYear({ start: '2026-04-01', end: '2027-03-31' }), { start: '2025-04-01', end: '2026-03-31' });
});

test('credit notes net against the right customer even when the original invoice is outside the period', () => {
  resetStorage();
  installSettings();
  const inv = createViaStore({ date: '2026-03-10', lines: [{ qty: 10, rate: 1000, tax: 18 }] });
  freezeDate('2026-04-05T10:00:00');
  createCreditNote(reload(inv.id), { lines: [{ itemId: reload(inv.id).items[0].id, quantity: 2 }], reason: 'x' });
  thawDate();
  const { docs } = salesDocs(localDb.invoices.getAll());
  const rep = salesByCustomer(docs, APRIL);
  assert.equal(rep.rows.length, 1);
  assert.equal(rep.rows[0].count, 0);
  assert.equal(rep.rows[0].total, -2360);
  assert.equal(rep.rows[0].avg, 0, 'no invoices => no average');
  assert.equal(rep.rows[0].lastDate, '');
  const march = salesByCustomer(docs, { start: '2026-03-01', end: '2026-03-31' });
  assert.equal(march.rows[0].total, 11800);
});

test('empty data gives zero-filled, non-throwing reports', () => {
  resetStorage();
  const { docs } = salesDocs([]);
  assert.equal(salesByCustomer(docs, APRIL).rows.length, 0);
  assert.equal(salesByCustomer(docs, APRIL).totals.total, 0);
  assert.equal(salesByItem(docs, APRIL).rows.length, 0);
  assert.equal(taxByRate(docs, APRIL).rows.length, 0);
  assert.equal(salesByMonth(docs, APRIL).rows[0].change, null);
  assert.equal(paymentModes([], [], APRIL).total, 0);
  assert.equal(expenseReport([], [], APRIL).totals.cost, 0);
  assert.equal(profitByItem(docs, [], APRIL).rows.length, 0);
  const c = concentration(salesByCustomer(docs, APRIL));
  assert.equal(c.level, 'none');
  assert.equal(c.warning, '');
});

function fakeReport(taxables: number[]): CustomerReport {
  const rows = taxables.map((t, i) => ({
    key: `k${i}`, name: `Customer ${i + 1}`, partyKey: `k${i}`, lastId: '', count: 1, creditNotes: 0, taxable: t, tax: 0, total: t, income: t, credited: 0, avg: t, share: 0, lastDate: '2026-04-01',
  }));
  return { rows, totals: { count: rows.length, creditNotes: 0, taxable: taxables.reduce((a, b) => a + b, 0), tax: 0, total: 0, income: 0, credited: 0 } };
}

test('customer concentration: top-3 share thresholds and single-customer case', () => {
  const healthy = concentration(fakeReport([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]));
  assert.equal(healthy.level, 'healthy');
  assert.equal(healthy.top3Share, 30);
  assert.equal(healthy.warning, '');
  assert.equal(healthy.top.length, 10);
  assert.equal(healthy.top[9].cumulativeShare, 100);

  const moderate = concentration(fakeReport([300, 200, 100, 100, 100, 100, 100]));
  assert.equal(moderate.top3Share, round2((600 / 1000) * 100));
  assert.equal(moderate.level, 'moderate');
  assert.match(moderate.warning, /top 3 customers account for 60\.0%/);

  const high = concentration(fakeReport([700, 100, 100, 50, 50]));
  assert.equal(high.level, 'high');
  assert.equal(high.top1Share, 70);

  const one = concentration(fakeReport([500]));
  assert.equal(one.level, 'high');
  assert.match(one.warning, /one account/);

  const two = concentration(fakeReport([500, 500]));
  assert.match(two.warning, /Only 2 customers/);

  assert.equal(concentration(fakeReport([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100])).top.length, 10);
});

test('sortRows: numeric, text, blanks last, stable', () => {
  const rows = [{ n: 'b', v: 2 }, { n: 'a', v: 10 }, { n: 'c', v: 2 }, { n: 'd', v: null }];
  assert.deepEqual(sortRows(rows, (r) => r.v, 'asc').map((r) => r.n), ['b', 'c', 'a', 'd']);
  assert.deepEqual(sortRows(rows, (r) => r.v, 'desc').map((r) => r.n), ['a', 'b', 'c', 'd']);
  assert.deepEqual(sortRows(rows, (r) => r.n, 'asc').map((r) => r.n), ['a', 'b', 'c', 'd']);
  assert.deepEqual(sortRows([{ n: 'INV 10' }, { n: 'INV 9' }], (r) => r.n, 'asc').map((r) => r.n), ['INV 9', 'INV 10']);
  assert.deepEqual(rows.map((r) => r.n), ['b', 'a', 'c', 'd'], 'input not mutated');
});

test('canonicalMethod folds case and aliases', () => {
  assert.equal(canonicalMethod('upi'), 'UPI');
  assert.equal(canonicalMethod(' Bank  Transfer '), 'Bank transfer');
  assert.equal(canonicalMethod('NEFT'), 'NEFT');
  assert.equal(canonicalMethod(''), 'Unspecified');
  assert.equal(canonicalMethod('wallet'), 'Wallet');
});

test('profitability by item uses ledger COGS in the period and nets returns; skips untracked items', () => {
  resetStorage();
  installSettings();
  createViaStore({ date: '2026-04-05', lines: [{ name: 'Widget', hsn: '8471', qty: 4, rate: 100, tax: 18 }] });
  createViaStore({ date: '2026-04-10', lines: [{ name: 'Widget', hsn: '8471', qty: 2, rate: 120, tax: 18 }, { name: 'Service', qty: 1, rate: 500, tax: 18 }] });
  const widget = blankStockItem({ id: 'w', name: 'Widget', track_stock: true, unit: 'NOS', opening_qty: 10, opening_rate: 60 });
  const service = blankStockItem({ id: 's', name: 'Service', track_stock: false });
  const positions = computeStock({ items: [widget, service], moves: [], invoices: localDb.invoices.getAll(), purchases: [] });
  const { docs } = salesDocs(localDb.invoices.getAll());
  const rep = profitByItem(docs, positions, APRIL);
  assert.equal(rep.rows.length, 1);
  const w = rep.rows[0];
  assert.equal(w.name, 'Widget');
  assert.equal(w.quantity, 6);
  assert.equal(w.revenue, 640);
  assert.equal(w.cogs, 360);
  assert.equal(w.profit, 280);
  assert.equal(w.margin, round2((280 / 640) * 100));
  // outside the period nothing is reported
  assert.equal(profitByItem(docs, positions, { start: '2026-05-01', end: '2026-05-31' }).rows.length, 0);
});

test('legacy invoice without line items or taxable_value still reports (no NaN, lines sum to the document)', () => {
  const legacy = {
    id: 'old', invoice_number: 'OLD-1', doc_type: 'INVOICE', issue_date: '2026-04-02', status: 'Sent', currency: 'INR',
    client: { name: 'Old Client', email: '', address: '', city: '', zip: '' }, items: [], total: 1180, tax_amount: 180,
  } as unknown as InvoiceRecord;
  const { docs } = salesDocs([legacy]);
  assert.equal(docs[0].taxable, 1000);
  assert.equal(docs[0].total, 1180);
  const items = salesByItem(docs, APRIL);
  assert.equal(items.totals.taxable, 1000);
  assert.ok(Number.isFinite(items.totals.tax));
  assert.equal(taxByRate(docs, APRIL).totals.tax, 180);
});
