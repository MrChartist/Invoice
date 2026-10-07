/**
 * End-to-end invoice lifecycle through the Zustand store and the storage-backed
 * lib APIs: mixed GST slabs, line + invoice discount, shipping, other charges,
 * round-off -> save -> part payments -> full payment, then a partial credit note
 * and the cross-module agreement (stats, receivables, books, GSTR-1/3B).
 *
 * Every expected figure is worked out by hand in the comments, independently of
 * what the code returns.
 */
import '../helpers/shim.ts';
import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, freezeDate, thawDate } from '../helpers/shim.ts';
import {
  BUYER_MH,
  SELLER_GSTIN,
  clientMH,
  createViaStore,
  installSettings,
  reload,
} from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { round2 } from '../../src/lib/invoice-calc.ts';
import { useInvoiceStore } from '../../src/store/useInvoiceStore.ts';
import { effectiveStatus } from '../../src/lib/invoice-status.ts';
import { summarize } from '../../src/lib/stats.ts';
import { buildReceivables } from '../../src/lib/receivables.ts';
import {
  balanceSheet,
  gstSummary,
  loadBooksData,
  profitAndLoss,
  type BooksData,
} from '../../src/lib/books.ts';
import { buildGstReport } from '../../src/lib/gst-reports.ts';
import { createCreditNote, readLinks } from '../../src/lib/documents.ts';
import { getTable } from '../../src/lib/storage.ts';
import type { Payment } from '../../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
afterEach(() => thawDate());

/**
 * The reference invoice (intra-state Maharashtra, B2B):
 *
 *   A  10 x 1,000.00 @18%, line discount 10%   gross 10,000.00  -10%  => net 9,000.00
 *   B   5 x 2,000.00 @5%                       gross 10,000.00        => net 10,000.00
 *   C   3 x   333.33 @12%                      gross    999.99        => net    999.99
 *
 *   subtotal (gross)            = 10,000 + 10,000 + 999.99          = 20,999.99
 *   line discounts              = 1,000.00
 *   net base                    = 9,000 + 10,000 + 999.99           = 19,999.99
 *   invoice discount 5%         = 19,999.99 x 5%  = 999.9995 -> 1,000.00
 *     allocated pro rata: A 1000 x 9000/19999.99 = 450.0002 -> 450.00
 *                         B 1000 x 10000/19999.99 = 500.0003 -> 500.00
 *                         C 1000 x 999.99/19999.99 =  49.9999 ->  50.00  (sum 1,000.00)
 *   taxable A / B / C           = 8,550.00 / 9,500.00 / 949.99      = 18,999.99
 *   tax A 18% x 8,550           = 1,539.00  (769.50 + 769.50)
 *   tax B  5% x 9,500           =   475.00  (237.50 + 237.50)
 *   tax C 12% x 949.99          = 113.9988 -> 114.00 (57.00 + 57.00)
 *   CGST = SGST                 = 769.50 + 237.50 + 57.00           = 1,064.00
 *   GST                         = 2,128.00
 *   shipping 150.50 + other 49.25 (untaxed)                         =   199.75
 *   before round-off            = 18,999.99 + 2,128.00 + 199.75     = 21,327.74
 *   nearest rupee               = 21,328.00   (round-off +0.26)
 */
const REF = {
  date: '2026-04-05',
  due: '2026-04-19',
  lines: [
    { name: 'Research plan', qty: 10, rate: 1000, tax: 18, disc: 10 },
    { name: 'Workshop', qty: 5, rate: 2000, tax: 5 },
    { name: 'Report', qty: 3, rate: 333.33, tax: 12 },
  ],
  invoiceDiscount: { type: 'PERCENT' as const, value: 5 },
  shipping: 150.5,
  other: 49.25,
};

test('store computes the reference invoice to the paisa and persists it', () => {
  const inv = createViaStore(REF);
  assert.equal(inv.subtotal, 20999.99);
  assert.equal(inv.discount_amount, 2000); // 1,000 line + 1,000 invoice discount
  assert.equal(inv.taxable_value, 18999.99);
  assert.equal(inv.cgst_amount, 1064);
  assert.equal(inv.sgst_amount, 1064);
  assert.equal(inv.igst_amount, 0);
  assert.equal(inv.tax_amount, 2128);
  assert.equal(inv.round_off, 0.26);
  assert.equal(inv.total, 21328);
  assert.equal(inv.balance_due, 21328);
  assert.equal(inv.status, 'Sent'); // saved (not as draft) => issued
  assert.equal(inv.invoice_number, 'INV/FY26-27/0001');

  const t = useInvoiceStore.getState().totals;
  assert.deepEqual(
    t.slabs.map((s) => [s.rate, s.taxable, s.tax]),
    [
      [5, 9500, 475],
      [12, 949.99, 114],
      [18, 8550, 1539],
    ],
  );
  // The persisted row is what a fresh load recalculates to: recalculation is idempotent.
  assert.ok(useInvoiceStore.getState().loadInvoice(inv.id));
  const again = useInvoiceStore.getState();
  assert.equal(again.total, inv.total);
  assert.equal(again.taxable_value, inv.taxable_value);
  assert.equal(again.balance_due, inv.balance_due);
});

test('part payments -> full payment drive status and balance correctly', () => {
  const inv = createViaStore(REF);
  const id = inv.id;

  // 5,000 on account: 21,328 - 5,000 = 16,328 outstanding.
  localDb.payments.record({ invoiceId: id, amount: 5000, method: 'UPI', date: '2026-04-10' });
  let r = reload(id);
  assert.equal(r.amount_paid, 5000);
  assert.equal(r.balance_due, 16328);
  assert.equal(r.status, 'Partially Paid');

  // another 10,000: 15,000 paid, 6,328 left.
  const p2 = localDb.payments.record({ invoiceId: id, amount: 10000, method: 'Bank transfer', date: '2026-04-12' });
  r = reload(id);
  assert.equal(r.amount_paid, 15000);
  assert.equal(r.balance_due, 6328);
  assert.equal(r.status, 'Partially Paid');

  // removing a payment rolls the balance back and keeps the status honest.
  localDb.payments.remove(p2.id);
  r = reload(id);
  assert.equal(r.amount_paid, 5000);
  assert.equal(r.balance_due, 16328);
  assert.equal(r.status, 'Partially Paid');

  // settle in full: 16,328 more.
  localDb.payments.record({ invoiceId: id, amount: 16328, method: 'Cash', date: '2026-04-20' });
  r = reload(id);
  assert.equal(r.amount_paid, 21328);
  assert.equal(r.balance_due, 0);
  assert.equal(r.status, 'Paid');
  assert.equal(localDb.payments.totalFor(id), 21328);

  // Paid is Paid even after the due date (Overdue is only for unpaid money).
  assert.equal(effectiveStatus(r, new Date('2026-06-01T10:00:00')), 'Paid');

  // reopen: delete every payment -> back to Sent with the full balance.
  for (const p of localDb.payments.listFor(id)) localDb.payments.remove(p.id);
  r = reload(id);
  assert.equal(r.status, 'Sent');
  assert.equal(r.balance_due, 21328);
  assert.equal(effectiveStatus(r, new Date('2026-04-20T09:00:00')), 'Overdue'); // due 19 Apr
  assert.equal(effectiveStatus(r, new Date('2026-04-19T23:00:00')), 'Sent'); // due today is not overdue
});

test('a payment can never be zero, negative or NaN (it would corrupt amount_paid)', () => {
  const inv = createViaStore(REF);
  for (const bad of [0, -100, Number.NaN]) {
    assert.throws(() => localDb.payments.record({ invoiceId: inv.id, amount: bad, method: 'Cash' }), /above zero/);
  }
  assert.equal(reload(inv.id).amount_paid, 0);
  assert.equal(getTable<Payment>('transactions').length, 0);
});

test('REGRESSION: saving a stale editor copy does not erase payments recorded meanwhile', () => {
  const inv = createViaStore(REF);
  // The creator page still holds the pre-payment copy while the user records money in the modal.
  assert.ok(useInvoiceStore.getState().loadInvoice(inv.id));
  localDb.payments.record({ invoiceId: inv.id, amount: 4000, method: 'UPI', date: '2026-04-10' });
  assert.equal(useInvoiceStore.getState().amount_paid, 0); // stale
  const res = useInvoiceStore.getState().saveInvoice();
  assert.ok(res.ok);
  const r = reload(inv.id);
  assert.equal(r.amount_paid, 4000, 'payment must survive the stale save');
  assert.equal(r.balance_due, 17328);
  assert.equal(r.status, 'Partially Paid');
});

test('REGRESSION: recording a payment on a cancelled document does not resurrect it', () => {
  const inv = createViaStore(REF);
  localDb.invoices.setStatus(inv.id, 'Cancelled');
  localDb.payments.record({ invoiceId: inv.id, amount: 21328, method: 'Cash', date: '2026-04-10' });
  const r = reload(inv.id);
  assert.equal(r.status, 'Cancelled');
  assert.equal(r.amount_paid, 21328); // the money is still tracked
});

test('REGRESSION: the default payment date is the LOCAL calendar day, not a UTC timestamp', () => {
  const inv = createViaStore(REF);
  // 01:30 IST on 1 April is still 31 March in UTC.
  process.env.TZ = 'Asia/Kolkata';
  try {
    freezeDate('2026-04-01T01:30:00');
    const p = localDb.payments.record({ invoiceId: inv.id, amount: 100, method: 'Cash' });
    assert.equal(p.date, '2026-04-01');
  } finally {
    delete process.env.TZ;
  }
});

/* ───────────── (b) partial credit note: every module must agree ───────────── */

/**
 * Credit 4 of the 10 units of line A on 20 Apr:
 *   gross 4 x 1,000 = 4,000.00; line discount 10% = 400.00; net 3,600.00
 *   invoice discount re-expressed as a % of the original net base: 1,000 / 19,999.99 = 5.0000025%
 *     -> 3,600 x 5.0000025% = 180.00009 -> 180.00
 *   taxable = 3,600 - 180 = 3,420.00; GST 18% = 615.60 (307.80 + 307.80)
 *   before round-off 4,035.60 -> 4,036.00 (round-off +0.40)
 */
function scenarioWithCreditNote() {
  const inv = createViaStore(REF);
  localDb.payments.record({ invoiceId: inv.id, amount: 5000, method: 'UPI', date: '2026-04-10' });
  freezeDate('2026-04-20T11:00:00');
  const itemA = reload(inv.id).items[0];
  const cn = createCreditNote(reload(inv.id), {
    lines: [{ itemId: itemA.id, quantity: 4 }],
    reason: 'Sales return',
  });
  thawDate();
  return { inv: reload(inv.id), cn };
}

test('credit note totals are computed with the same rules as the invoice', () => {
  const { cn } = scenarioWithCreditNote();
  assert.equal(cn.doc_type, 'CREDIT_NOTE');
  assert.equal(cn.issue_date, '2026-04-20');
  assert.equal(cn.taxable_value, 3420);
  assert.equal(cn.cgst_amount, 307.8);
  assert.equal(cn.sgst_amount, 307.8);
  assert.equal(cn.tax_amount, 615.6);
  assert.equal(cn.round_off, 0.4);
  assert.equal(cn.total, 4036);
  assert.equal(cn.balance_due, 0); // a credit note is not receivable
  assert.equal(cn.invoice_number, 'CRN/FY26-27/0001');
  assert.equal(readLinks().filter((l) => l.relation === 'credit_note').length, 1);
});

test('stats, receivables, books and GST agree on a part-credited, part-paid invoice', () => {
  const { inv, cn } = scenarioWithCreditNote();
  const all = localDb.invoices.getAll();
  const links = readLinks();
  const now = new Date('2026-04-25T10:00:00');

  // Dashboard: billed = 21,328 - 4,036; outstanding = (21,328 - 5,000) - 4,036.
  const s = summarize(all, now, links);
  assert.equal(s.count, 1);
  assert.equal(s.credited, 4036);
  assert.equal(s.billed, 17292);
  assert.equal(s.received, 5000);
  assert.equal(s.outstanding, 12292);

  // Receivables ledger: same outstanding, from the party-ledger side.
  const rec = buildReceivables({ invoices: all, payments: localDb.payments.getAll(), clients: [clientMH] }, { now });
  assert.equal(rec.totals.gross, 16328); // open bill
  assert.equal(rec.totals.creditNotes, 4036);
  assert.equal(rec.totals.net, 12292);
  assert.equal(rec.totals.net, s.outstanding);
  assert.equal(rec.parties.length, 1);
  assert.equal(rec.parties[0].entries.at(-1)?.balance, 12292); // ledger closing balance

  // Books (accrual P&L): income excludes GST and nets the credit note.
  //   invoice income = 21,328 - 2,128 GST = 19,200.00 ( = 18,999.99 + 199.75 charges + 0.26 round-off)
  //   credit income  =  4,036 - 615.60    =  3,420.40 ( = 3,420.00 + 0.40 round-off)
  const data: BooksData = loadBooksData();
  const pl = profitAndLoss(data, { start: '2026-04-01', end: '2027-03-31' }, 'accrual');
  assert.equal(pl.sales, 19200);
  assert.equal(pl.creditNotes, 3420.4);
  assert.equal(pl.income, 15779.6);
  // ... which must tie back to the dashboard: billed - net GST.
  assert.equal(round2(s.billed - (2128 - 615.6)), pl.income);

  // GST: taxable value net of the credit note, CGST/SGST net of it too.
  const rep = buildGstReport(all, [], {
    period: { kind: 'month', fyStart: 2026, month: 4 },
    gstin: SELLER_GSTIN,
  });
  assert.equal(rep.gstr1.b2b.length, 1);
  assert.equal(rep.gstr1.b2b[0].ctin, BUYER_MH);
  assert.equal(rep.gstr1.cdnr.length, 1);
  assert.equal(rep.gstr1.cdnr[0].number, cn.invoice_number);
  assert.equal(rep.gstr1.totals.taxable, 15579.99); // 18,999.99 - 3,420.00
  assert.equal(rep.gstr1.totals.cgst, 756.2); // 1,064.00 - 307.80
  assert.equal(rep.gstr1.totals.sgst, 756.2);
  assert.equal(rep.gstr3b.outward.taxable.taxable, 15579.99);
  assert.equal(rep.gstr3b.outward.taxable.cgst, 756.2);
  assert.equal(rep.gstr3b.payment.cash.cgst, 756.2); // no ITC => all in cash
  // Books' GST summary is the same liability.
  const g = gstSummary(data, { start: '2026-04-01', end: '2026-04-30' });
  assert.equal(g.outputCgst, 756.2);
  assert.equal(g.outputSgst, 756.2);
  assert.equal(g.outputTotal, 1512.4);
  // The only gap between Books income and GST taxable value is the untaxed charges and round-offs:
  //   199.75 shipping+other + 0.26 - 0.40 round-offs = 199.61
  assert.equal(round2(pl.income - rep.gstr1.totals.taxable), 199.61);

  // Balance sheet: receivables = sales - credit note - receipts, and the equity plug is just openings (0).
  const bs = balanceSheet(data, '2026-04-30');
  assert.equal(bs.assets.receivables, 12292);
  assert.equal(bs.assets.bank, 5000);
  assert.equal(bs.liabilities.gstPayable, 1512.4);
  assert.equal(bs.equity.capitalAndOther, 0);
  assert.equal(inv.status, 'Partially Paid');
});

test('credit notes cannot exceed the invoice, even across several part-credits with round-off', () => {
  const inv = createViaStore({
    date: '2026-04-05',
    lines: [
      { name: 'X', qty: 1, rate: 100.45, tax: 18 },
      { name: 'Y', qty: 1, rate: 100.45, tax: 18 },
    ],
  });
  // each line: 100.45 + 18.081 -> 118.53 ; two lines = 237.06 -> rounded 237.00 (round-off -0.06)
  assert.equal(inv.total, 237);
  freezeDate('2026-04-20T11:00:00');
  const live = reload(inv.id);
  // Credit line X alone: 118.53 -> rounds UP to 119.00
  createCreditNote(live, { lines: [{ itemId: live.items[0].id, quantity: 1 }], reason: 'Sales return' });
  // Credit line Y alone: another 119.00. Their SUM (238) is 1 rupee above the invoice (237) purely from rounding,
  // but together they credit exactly the whole invoice, so this must be allowed.
  assert.doesNotThrow(() =>
    createCreditNote(live, { lines: [{ itemId: live.items[1].id, quantity: 1 }], reason: 'Sales return' }),
  );
  // ... and a third credit on an already fully-credited line is refused.
  assert.throws(
    () => createCreditNote(live, { lines: [{ itemId: live.items[1].id, quantity: 1 }], reason: 'Sales return' }),
    /remain creditable/,
  );
  thawDate();
});

test('REGRESSION: a credit note against an export-under-LUT invoice stays zero-rated', () => {
  const inv = createViaStore({
    date: '2026-04-05',
    client: { ...clientMH, id: 'c-us', name: 'Acme Inc', gstin: '', state_code: '99' },
    pos: '99',
    supply: 'EXPORT_LUT',
    lines: [{ name: 'Consulting', qty: 10, rate: 500, tax: 18 }],
  });
  assert.equal(inv.tax_amount, 0);
  assert.equal(inv.total, 5000);
  freezeDate('2026-04-20T11:00:00');
  const cn = createCreditNote(reload(inv.id), {
    lines: [{ itemId: reload(inv.id).items[0].id, quantity: 2 }],
    reason: 'Rate difference',
  });
  thawDate();
  // 2 x 500 = 1,000; no IGST may appear on a zero-rated credit note.
  assert.equal(cn.taxable_value, 1000);
  assert.equal(cn.igst_amount, 0);
  assert.equal(cn.tax_amount, 0);
  assert.equal(cn.total, 1000);
  assert.equal(cn.supply_type, 'EXPORT_LUT');
});

test('REGRESSION: a credit note keeps the original\'s tax-inclusive pricing', () => {
  const inv = createViaStore({
    date: '2026-04-05',
    inclusive: true,
    lines: [{ name: 'Retainer', qty: 4, rate: 1180, tax: 18 }],
  });
  // 4 x 1,180 inclusive = 4,720: taxable 4,000 + 720 GST.
  assert.equal(inv.taxable_value, 4000);
  assert.equal(inv.total, 4720);
  freezeDate('2026-04-20T11:00:00');
  const live = reload(inv.id);
  const cn = createCreditNote(live, { lines: [{ itemId: live.items[0].id, quantity: 1 }], reason: 'Sales return' });
  thawDate();
  // 1 x 1,180 inclusive => taxable 1,000 + 180
  assert.equal(cn.taxable_value, 1000);
  assert.equal(cn.tax_amount, 180);
  assert.equal(cn.total, 1180);
});

test('REGRESSION: a sender profile\'s own number prefix is used when the document is saved (it was only previewed)', () => {
  const a = createViaStore({ date: '2026-04-05', prefix: 'MC', lines: [{ qty: 1, rate: 1000 }] });
  const b = createViaStore({ date: '2026-04-06', prefix: 'MC', lines: [{ qty: 1, rate: 1000 }] });
  const c = createViaStore({ date: '2026-04-07', lines: [{ qty: 1, rate: 1000 }] }); // no profile prefix -> global INV series
  assert.deepEqual([a.invoice_number, b.invoice_number, c.invoice_number], ['MC/FY26-27/0001', 'MC/FY26-27/0002', 'INV/FY26-27/0001']);
});

test('REGRESSION: a credit note cannot be raised against a draft invoice', () => {
  const draft = createViaStore({ date: '2026-04-05', asDraft: true, lines: [{ qty: 1, rate: 1000 }] });
  assert.equal(draft.status, 'Draft');
  freezeDate('2026-04-20T11:00:00');
  assert.throws(
    () => createCreditNote(reload(draft.id), { lines: [{ itemId: reload(draft.id).items[0].id, quantity: 1 }], reason: 'Sales return' }),
    /Issue the invoice/,
  );
  thawDate();
});
