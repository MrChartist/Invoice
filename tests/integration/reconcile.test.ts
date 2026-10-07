/**
 * The same business period reported through five independent modules must
 * reconcile EXACTLY:
 *
 *   Books (accrual P&L income)  - GST taxable value  - Receivables billed
 *   Exports (sales register)    - Dashboard (stats) billed
 *
 * 10 live invoices + 1 credit note in April 2026, plus documents that must be
 * invisible to every one of them (cancelled, draft, quotation, proforma,
 * challan) and one invoice from the previous financial year.
 *
 *  #  what                              taxable    GST     other           total
 *  1  intra B2B 10 x 1,000 @18          10,000.00  1,800                   11,800.00
 *  2  inter-state 5 x 2,000 @12         10,000.00  1,200                   11,200.00
 *  3  B2C 3 x 333.33 @18                   999.99    180   round-off +0.01   1,180.00
 *  4  2 x 5,000 @18, 10% line disc,      9,000.00  1,620  shipping 100     10,720.00
 *     shipping 100
 *  5  1 x 20,000 @18 + TCS 1%           20,000.00  3,600  TCS 236          23,836.00
 *  6  export under LUT 50,000           50,000.00      0                   50,000.00
 *  7  28% + 12% cess                    10,000.00  2,800  cess 1,200       14,000.00
 *  8  10,000 @18, TDS 10% (1,000)       10,000.00  1,800                   11,800.00
 *  9  tax-inclusive 5,900 @18            5,000.00    900                    5,900.00
 * 10  8,000 @5                           8,000.00    400                    8,400.00
 *     sum                              132,999.99 14,300                  148,836.00
 * CN  credit 3 of 10 units of #1         3,000.00    540                    3,540.00
 *     net                              129,999.99 13,760                  145,296.00
 */
import '../helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, freezeDate, thawDate, inTimeZones } from '../helpers/shim.ts';
import {
  SELLER_GSTIN,
  clientKA,
  clientMH,
  clientRetail,
  clientUS,
  createViaStore,
  installSettings,
  reload,
} from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { round2 } from '../../src/lib/invoice-calc.ts';
import { summarize, monthlyBilled } from '../../src/lib/stats.ts';
import { buildReceivables, monthlyCollections } from '../../src/lib/receivables.ts';
import { balanceSheet, loadBooksData, profitAndLoss } from '../../src/lib/books.ts';
import { buildGstReport } from '../../src/lib/gst-reports.ts';
import { filterInvoices, fyRange } from '../../src/lib/export-shared.ts';
import { salesRegister } from '../../src/lib/accounting-export.ts';
import { buildTallyModel } from '../../src/lib/tally-xml.ts';
import { createCreditNote, readLinks } from '../../src/lib/documents.ts';
import type { InvoiceRecord } from '../../src/types/invoice.ts';

const D = '2026-04-';

function build() {
  resetStorage();
  installSettings();
  const mk = createViaStore;
  const live: InvoiceRecord[] = [];
  live.push(mk({ date: D + '03', lines: [{ qty: 10, rate: 1000, tax: 18 }] }));
  live.push(mk({ date: D + '04', client: clientKA, lines: [{ qty: 5, rate: 2000, tax: 12 }] }));
  live.push(mk({ date: D + '05', client: clientRetail, lines: [{ qty: 3, rate: 333.33, tax: 18 }] }));
  live.push(
    mk({ date: D + '06', shipping: 100, lines: [{ qty: 2, rate: 5000, tax: 18, disc: 10 }] }),
  );
  live.push(mk({ date: D + '07', tcs: { rate: 1 }, lines: [{ qty: 1, rate: 20000, tax: 18 }] }));
  live.push(
    mk({ date: D + '08', client: clientUS, pos: '99', supply: 'EXPORT_LUT', lines: [{ qty: 1, rate: 50000, tax: 18 }] }),
  );
  live.push(mk({ date: D + '09', lines: [{ qty: 1, rate: 10000, tax: 28, cess: 12 }] }));
  live.push(mk({ date: D + '10', tds: { rate: 10 }, lines: [{ qty: 1, rate: 10000, tax: 18 }] }));
  live.push(mk({ date: D + '11', inclusive: true, lines: [{ qty: 1, rate: 5900, tax: 18 }] }));
  live.push(mk({ date: D + '12', lines: [{ qty: 1, rate: 8000, tax: 5 }] }));

  // Documents that must be invisible to every report.
  const cancelled = mk({ date: D + '13', lines: [{ qty: 1, rate: 99999, tax: 18 }] });
  localDb.invoices.setStatus(cancelled.id, 'Cancelled');
  mk({ date: D + '13', asDraft: true, lines: [{ qty: 1, rate: 77777, tax: 18 }] });
  mk({ date: D + '13', docType: 'QUOTATION', lines: [{ qty: 1, rate: 66666, tax: 18 }] });
  mk({ date: D + '13', docType: 'PROFORMA', lines: [{ qty: 1, rate: 44444, tax: 18 }] });
  mk({ date: D + '13', docType: 'DELIVERY_CHALLAN', lines: [{ qty: 1, rate: 55555, tax: 18 }] });
  // And one real invoice from the PREVIOUS financial year (31 March).
  mk({ date: '2026-03-31', lines: [{ qty: 1, rate: 1000, tax: 18 }] });

  // Money in.
  localDb.payments.record({ invoiceId: live[3].id, amount: 10720, method: 'UPI', date: D + '14' });
  localDb.payments.record({ invoiceId: live[9].id, amount: 3000, method: 'Cash', date: D + '15' });
  localDb.payments.record({ invoiceId: live[7].id, amount: 10800, method: 'Bank transfer', date: D + '16' });

  // Credit 3 of the 10 units of invoice #1 on 25 April.
  freezeDate('2026-04-25T11:00:00');
  const first = reload(live[0].id);
  const cn = createCreditNote(first, { lines: [{ itemId: first.items[0].id, quantity: 3 }], reason: 'Sales return' });
  thawDate();
  return { live, cn };
}

function check(label: string) {
  const { live, cn } = build();
  assert.equal(cn.total, 3540, `${label}: credit note 3 x 1,000 + 18%`);
  const all = localDb.invoices.getAll();
  const links = readLinks();
  const now = new Date('2026-04-30T12:00:00');
  const period = { start: '2026-04-01', end: '2026-04-30' };

  // Per-document sanity (so a wrong fixture can't hide a wrong module).
  assert.deepEqual(live.map((i) => i.total), [11800, 11200, 1180, 10720, 23836, 50000, 14000, 11800, 5900, 8400], label);
  assert.equal(live[2].round_off, 0.01);
  assert.equal(live[4].tcs_amount, 236);
  assert.equal(live[6].cess_amount, 1200);
  assert.equal(live[7].tds_amount, 1000);
  assert.equal(live[8].taxable_value, 5000);

  // ── 1. Dashboard ─────────────────────────────────────────────
  // summarize() is not period-scoped: hand it the April documents (the dashboard filters the same way).
  const april = all.filter((i) => i.issue_date.startsWith('2026-04'));
  const s = summarize(april, now, links);
  assert.equal(s.count, 10, label);
  assert.equal(s.billed, 145296, `${label}: stats.billed`);
  assert.equal(s.credited, 3540);

  // ── 2. Receivables ledger: billed = debits - credit notes in the month ──
  const rec = buildReceivables({ invoices: all, payments: localDb.payments.getAll(), clients: [clientMH, clientKA] }, { now });
  const apr = monthlyCollections(rec, 3, now).find((r) => r.month === '2026-04')!;
  assert.equal(apr.billed, 148836, `${label}: receivables billed`);
  assert.equal(apr.credited, 3540);
  assert.equal(round2(apr.billed - apr.credited), s.billed, `${label}: receivables == stats billed`);
  // ... and what is still owed agrees too (stats per-invoice vs ledger party-level).
  // (receivables is as-of-today, not period-scoped: compare with the dashboard over ALL documents.)
  const sAll = summarize(all, now, links);
  assert.equal(rec.totals.net, sAll.outstanding, `${label}: outstanding`);
  assert.equal(sAll.outstanding, 120956); // 119,776 April + 1,180 left on the 31 March invoice
  assert.equal(s.outstanding, 119776);
  assert.equal(s.received, 24520); // 10,720 + 3,000 + 10,800

  // ── 3. Exports: sales register for April ─────────────────────
  const reg = salesRegister(filterInvoices(all, { from: period.start, to: period.end }));
  const col = (name: string) => reg.headers.indexOf(name);
  const sum = (name: string) =>
    round2(reg.rows.reduce((t, r) => t + (r[col(name)] as { money: number }).money, 0));
  assert.equal(reg.rows.length, 11, `${label}: 10 invoices + 1 credit note`);
  assert.equal(sum('Invoice Total'), s.billed, `${label}: sales register total == stats billed`);
  assert.equal(sum('Taxable Value'), 129999.99);
  // The Tally sales vouchers tell the same story.
  const t = buildTallyModel({ invoices: all, payments: [], clients: [], items: [], purchases: [], vendors: [] }, { companyName: 'X', includeReceipts: false });
  const partyDr = (v: (typeof t.vouchers)[number]) => v.entries.filter((e) => e.ledger === v.party).reduce((a, e) => a + (e.side === 'Dr' ? e.paise : -e.paise), 0);
  assert.equal(t.vouchers.filter((v) => v.date.startsWith('2026-04')).reduce((a, v) => a + partyDr(v), 0), 14529600);

  // ── 4. GST reports ───────────────────────────────────────────
  const rep = buildGstReport(all, [], { period: { kind: 'month', fyStart: 2026, month: 4 }, gstin: SELLER_GSTIN });
  assert.deepEqual(rep.gstr1.counts, { included: 11, drafts: 1, cancelled: 1, notTaxDocs: 3 }, label);
  assert.equal(rep.gstr1.totals.taxable, 129999.99, `${label}: GST taxable`);
  assert.equal(rep.gstr1.totals.value, s.billed, `${label}: GSTR-1 value == stats billed`);
  assert.equal(round2(rep.gstr1.totals.cgst + rep.gstr1.totals.sgst + rep.gstr1.totals.igst), 13760);
  assert.equal(rep.gstr1.totals.cess, 1200);

  // ── 5. Books ─────────────────────────────────────────────────
  const data = loadBooksData();
  const pl = profitAndLoss(data, period, 'accrual');
  assert.equal(pl.sales, 133100);
  assert.equal(pl.creditNotes, 3000);
  assert.equal(pl.income, 130100, `${label}: books income`);
  // The bridge between the five numbers, exactly:
  //   billed (stats)  = income + GST + cess + TCS
  assert.equal(round2(pl.income + 13760 + 1200 + 236), s.billed);
  //   income          = GST taxable value + shipping (100) + round-off (0.01)
  assert.equal(round2(rep.gstr1.totals.taxable + 100 + 0.01), pl.income);
  // Balance sheet balances with no plug (no openings, no purchases).
  const bs = balanceSheet(data, '2026-04-30');
  assert.equal(bs.assets.bank, 21520); // UPI 10,720 + bank transfer 10,800
  assert.equal(bs.assets.cash, 3000);
  // (the balance sheet is cumulative, so it also carries the 31 March invoice: +1,180 owed, +180 GST, +1,000 income)
  assert.equal(bs.assets.receivables, 121956); // 119,776 owed + 1,180 (March) + 1,000 TDS awaiting credit
  assert.equal(bs.liabilities.gstPayable, 15376); // 13,760 GST + 1,200 cess + 236 TCS + 180 (March)
  assert.equal(bs.equity.retainedEarnings, 131100);
  assert.equal(bs.equity.capitalAndOther, 0, `${label}: balance sheet must balance without a plug`);

  // ── 6. Dashboard monthly chart agrees with the KPI ───────────
  const months = monthlyBilled(all, 2, now);
  assert.equal(months.find((m) => m.key === '2026-04')!.billed, s.billed, `${label}: monthly chart == KPI`);
  assert.equal(months.find((m) => m.key === '2026-03')!.billed, 1180);

  // ── FY filters: 31 March belongs to the previous FY ──────────
  const fy2526 = filterInvoices(all, fyRange(2025));
  assert.deepEqual(fy2526.map((i) => i.issue_date), ['2026-03-31'], label);
  assert.equal(filterInvoices(all, fyRange(2026)).length, 11); // 10 invoices + 1 credit note
  const fyRep = buildGstReport(all, [], { period: { kind: 'fy', fyStart: 2025 }, gstin: SELLER_GSTIN });
  assert.equal(fyRep.gstr1.totals.taxable, 1000);
  const fyBooks = profitAndLoss(data, { start: '2025-04-01', end: '2026-03-31' }, 'accrual');
  assert.equal(fyBooks.income, 1000);
}

test('five modules reconcile exactly on a 16-document period (UTC)', () => check('UTC'));

test('... and in every time zone (FY / month filters never shift a day)', () => {
  inTimeZones(['Asia/Kolkata', 'America/Los_Angeles', 'America/New_York', 'Pacific/Auckland', 'Pacific/Honolulu'], (tz) =>
    check(tz),
  );
});
