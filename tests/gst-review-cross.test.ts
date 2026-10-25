/**
 * Independent GST / accounting review — cross-module regression (the reviewer's dataset, turned into
 * assertions). One FY of documents including outward reverse charge (a new-style invoice whose total
 * leaves the tax out AND an older record whose stored total still includes it), an inward
 * reverse-charge bill, an ordinary inter-state bill, an import of goods, an export, a Bill of Supply,
 * an advance and a credit note. Every module must agree:
 *
 *   GSTR-1 ↔ GSTR-3B ↔ GSTR-9 ↔ double-entry ledger ↔ Books ↔ dashboard ↔ receivables ↔ Tally.
 */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, freezeDate, thawDate } from './helpers/shim.ts';
import { SELLER_GSTIN, clientMH, clientKA, clientUS, clientRetail, createViaStore, installSettings, reload } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { createCreditNote, readLinks } from '../src/lib/documents.ts';
import { purchasesDb, paymentsDb, balanceOf, deriveStatus } from '../src/lib/purchases.ts';
import { saveAdvance, applyAdvance, loadAdvances } from '../src/lib/advances.ts';
import { advanceTaxEvents } from '../src/lib/advance-tax.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { buildGstr9 } from '../src/lib/gstr9.ts';
import { buildLedger, loadLedgerInput, trialBalance, ledgerBalanceSheet, cashFlowStatement } from '../src/lib/ledger/index.ts';
import { loadBooksData, gstSummary, balanceSheet } from '../src/lib/books.ts';
import { summarize } from '../src/lib/stats.ts';
import { buildReceivables } from '../src/lib/receivables.ts';
import { buildTallyModel } from '../src/lib/tally-xml.ts';
import { receivableBalance, receivableTotal, rcmTaxInTotal } from '../src/lib/rcm.ts';
import { supplierPayable } from '../src/lib/purchase-normalize.ts';
import { getTable } from '../src/lib/storage.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

const FY = { start: '2025-04-01', end: '2026-03-31' };
const r2 = (n: number) => Math.round(n * 100) / 100;

function world() {
  resetStorage();
  installSettings();
  freezeDate('2025-06-30T10:00:00');
  const inv1 = createViaStore({ date: '2025-05-05', client: clientMH, lines: [{ qty: 10, rate: 1000, tax: 18, hsn: '998311' }] });
  const inv2 = createViaStore({ date: '2025-05-10', client: clientKA, lines: [{ qty: 5, rate: 2000, tax: 18, hsn: '84713010' }] });
  createViaStore({ date: '2025-05-12', client: clientUS, pos: '96', supply: 'EXPORT_LUT', lines: [{ qty: 1, rate: 50000, tax: 18, hsn: '998314' }] });
  createViaStore({ date: '2025-05-15', client: clientRetail, docType: 'BILL_OF_SUPPLY', lines: [{ qty: 1, rate: 5000, tax: 0, hsn: '998313' }] });
  // Outward reverse charge, current behaviour: total 1,000 (GST 50 payable by the recipient).
  const rcmNew = createViaStore({ date: '2025-05-28', client: clientMH, reverseCharge: true, lines: [{ qty: 1, rate: 1000, tax: 5, hsn: '996511' }] });
  // Outward reverse charge saved by an older version: the stored total 2,100 includes the GST of 100.
  const rcmOld = createViaStore({ date: '2025-05-29', client: clientMH, reverseCharge: true, patch: { rcm_tax_excluded: undefined }, lines: [{ qty: 1, rate: 2000, tax: 5, hsn: '996511' }] });
  const adv = saveAdvance({ date: '2025-04-20', client: { id: clientMH.id, name: clientMH.name, gstin: clientMH.gstin, state_code: '27' }, place_of_supply: '27', supply: 'services', tax_rate: 18, amount: 11800, method: 'Bank transfer' } as never, { today: '2025-06-30' });
  const inv5 = createViaStore({ date: '2025-05-25', client: clientMH, lines: [{ qty: 1, rate: 10000, tax: 18, hsn: '998311' }] });
  applyAdvance({ advanceId: adv.id, invoiceId: inv5.id, amount: 11800, date: '2025-05-25' }, { today: '2025-06-30' } as never);
  freezeDate('2025-05-20T10:00:00');
  createCreditNote(reload(inv1.id), { lines: [{ itemId: reload(inv1.id).items[0].id, quantity: 2 }], reason: 'Discount' });
  freezeDate('2025-06-30T10:00:00');
  localDb.payments.record({ invoiceId: inv2.id, amount: 11800, method: 'UPI', date: '2025-05-30' });
  // The customer pays the old RCM invoice's taxable value: that settles it in full.
  localDb.payments.record({ invoiceId: rcmOld.id, amount: 2000, method: 'UPI', date: '2025-06-02' });
  const legal = purchasesDb.save({ kind: 'PURCHASE', vendor_name: 'Advocate', bill_number: 'L1', date: '2025-05-08', category: 'Professional fees', lines: [{ id: 'a', name: 'Legal', quantity: 1, rate: 10000, tax_rate: 18 }], taxable: 10000, cgst: 900, sgst: 900, igst: 0, itc_eligible: true, reverse_charge: true, total: 11800, amount_paid: 0 } as PurchaseRecord);
  purchasesDb.save({ kind: 'PURCHASE', vendor_name: 'Supplier', vendor_gstin: '29AABCT1332L1ZZ', bill_number: 'S1', date: '2025-05-09', category: 'Purchases', lines: [{ id: 'b', name: 'Stock', quantity: 1, rate: 10000, tax_rate: 18 }], taxable: 10000, cgst: 0, sgst: 0, igst: 1800, itc_eligible: true, total: 11800, amount_paid: 0 } as PurchaseRecord);
  const imp = purchasesDb.save({ kind: 'PURCHASE', vendor_name: 'Overseas Co', bill_number: 'IMP1', date: '2025-05-11', category: 'Purchases', import_type: 'GOODS', boe_number: '7654321', boe_date: '2025-05-11', port_code: 'INNSA1', lines: [{ id: 'c', name: 'Machine part', quantity: 1, rate: 20000, tax_rate: 18 }], taxable: 20000, cgst: 0, sgst: 0, igst: 3600, itc_eligible: true, total: 23600, amount_paid: 0 } as PurchaseRecord);
  // Paying the advocate the full taxable value settles the bill: the 1,800 GST is ours to pay.
  paymentsDb.record(legal.id, { amount: 10000, date: '2025-06-05', method: 'Bank transfer' });
  return { inv1, inv2, inv5, rcmNew: reload(rcmNew.id), rcmOld: reload(rcmOld.id), legal: purchasesDb.get(legal.id)!, imp };
}

test('outward reverse charge: new documents leave the tax out of the total; older ones are read through rcm.ts', () => {
  const w = world();
  try {
    assert.equal(w.rcmNew.total, 1000);
    assert.equal(w.rcmNew.tax_amount, 50, 'the tax is still computed and stored (GSTR-1 reports it)');
    assert.equal(w.rcmNew.rcm_tax_excluded, true);
    assert.equal(w.rcmNew.balance_due, 1000);
    // The older record keeps its stored figures (never rewritten) ...
    assert.equal(w.rcmOld.total, 2100);
    assert.equal(w.rcmOld.rcm_tax_excluded, undefined);
    assert.equal(rcmTaxInTotal(w.rcmOld), 100);
    // ... but every reader sees only the taxable value as receivable, and the payment of 2,000 settled it.
    assert.equal(receivableTotal(w.rcmOld), 2000);
    assert.equal(receivableBalance(w.rcmOld), 0);
    assert.equal(w.rcmOld.status, 'Paid');
  } finally {
    thawDate();
  }
});

test('inward reverse charge / import bills: the supplier is owed the taxable value only', () => {
  const w = world();
  try {
    assert.equal(supplierPayable(w.legal), 10000);
    assert.equal(balanceOf(w.legal), 0);
    assert.equal(deriveStatus(w.legal, '2025-06-30'), 'Paid');
    assert.equal(w.legal.total, 11800, 'stored bill unchanged');
    assert.equal(supplierPayable(w.imp), 20000, 'customs IGST is paid at the border, not to the supplier');
    assert.throws(() => paymentsDb.record(w.legal.id, { amount: 1, date: '2025-06-06', method: 'Cash' }), /exceeds the balance/);
  } finally {
    thawDate();
  }
});

test('GSTR-1 ↔ 3B ↔ GSTR-9 ↔ ledger ↔ Books ↔ dashboard ↔ receivables ↔ Tally agree', () => {
  const w = world();
  try {
    const invoices = localDb.invoices.getAll();
    const purchases = getTable<PurchaseRecord>('purchases');
    const links = readLinks();
    const events = advanceTaxEvents(loadAdvances(), localDb.payments.getAll(), invoices);

    /* GSTR-1 / 3B by month */
    const sum = { a: { igst: 0, cgst: 0, sgst: 0 }, d: { igst: 0, cgst: 0, sgst: 0 }, itc: { igst: 0, cgst: 0, sgst: 0 }, rcmOut: 0 };
    for (let m = 4; m <= 6; m++) {
      const r = buildGstReport(invoices, purchases, { period: { kind: 'month', fyStart: 2025, month: m }, gstin: SELLER_GSTIN, advances: events, links });
      for (const k of ['igst', 'cgst', 'sgst'] as const) {
        sum.a[k] = r2(sum.a[k] + r.gstr3b.outward.taxable[k]);
        sum.d[k] = r2(sum.d[k] + r.gstr3b.outward.inwardRcm[k]);
        sum.itc[k] = r2(sum.itc[k] + r.gstr3b.itc.net[k]);
      }
      sum.rcmOut = r2(sum.rcmOut + r.gstr3b.outwardRcmTaxable);
      if (m === 5) {
        // GSTR-1 reports both RCM invoices in B2B with rchrg Y and the tax shown on them.
        const rcm = r.gstr1.b2b.filter((d) => d.rchrg === 'Y');
        assert.equal(rcm.length, 2);
        assert.deepEqual(rcm.map((d) => [d.taxable, d.cgst, d.sgst]).sort(), [[1000, 25, 25], [2000, 50, 50]]);
        // Invoice value includes the shown tax for both generations.
        assert.deepEqual(rcm.map((d) => d.value).sort((a, b) => a - b), [1050, 2100]);
        assert.ok(!r.issues.some((i) => i.code === 'TOTAL_MISMATCH'), 'stored totals of both generations reconcile');
      }
    }
    assert.equal(sum.rcmOut, 3000, '3B keeps outward RCM out of the supplier liability');
    assert.deepEqual(sum.a, { igst: 1800, cgst: 1620, sgst: 1620 });
    assert.deepEqual(sum.d, { igst: 0, cgst: 900, sgst: 900 });
    assert.deepEqual(sum.itc, { igst: 5400, cgst: 900, sgst: 900 });

    /* GSTR-9: 4N agrees with Table 9 */
    const g9 = buildGstr9(invoices, purchases, { fyStart: 2025, gstin: SELLER_GSTIN, advances: events, links });
    const t4N = g9.table4.find((x) => x.id === '4N')!;
    const t9 = Object.fromEntries(g9.table9.map((x) => [x.id, x.payable]));
    assert.equal(t4N.igst, t9['9-IGST']);
    assert.equal(t4N.cgst, t9['9-CGST']);
    assert.equal(t4N.sgst, t9['9-SGST']);
    assert.equal(g9.table5.find((x) => x.id === '5C')!.taxable, 3000);

    /* Ledger */
    const books = loadBooksData();
    const led = buildLedger(loadLedgerInput(books, '2025-06-30'));
    const tb = trialBalance(led, FY);
    const bal = (id: string) => (tb.rows.find((r) => r.account.id === id)?.closing ?? 0) / 100;
    assert.equal(-bal('out_cgst'), sum.a.cgst, 'ledger output CGST = 3B 3.1(a)');
    assert.equal(-bal('out_sgst'), sum.a.sgst);
    assert.equal(-bal('out_igst'), sum.a.igst);
    assert.equal(-bal('rcm_payable'), r2(sum.d.cgst + sum.d.sgst + sum.d.igst), 'ledger RCM payable = 3B 3.1(d)');
    assert.equal(-bal('import_igst'), 3600);
    assert.equal(-bal('creditors'), r2(0 + 11800 + 20000), 'advocate settled; supplier 11,800; importer 20,000');
    assert.equal(ledgerBalanceSheet(led, '2026-03-31').difference, 0);
    assert.equal(cashFlowStatement(led, FY).difference, 0);

    /* Books */
    const gst = gstSummary(books, FY);
    assert.equal(gst.outputCgst, sum.a.cgst);
    assert.equal(gst.outputSgst, sum.a.sgst);
    assert.equal(gst.outputIgst, sum.a.igst);
    assert.equal(gst.rcmPayable, 1800);
    const liability = r2(sum.a.igst + sum.a.cgst + sum.a.sgst + sum.d.igst + sum.d.cgst + sum.d.sgst);
    const itc = r2(sum.itc.igst + sum.itc.cgst + sum.itc.sgst);
    assert.equal(gst.netPayable, r2(liability - itc), 'Books net GST = 3B liability − ITC');
    const bs = balanceSheet(books, '2026-03-31');
    assert.equal(bs.liabilities.payables, -bal('creditors'));

    /* Dashboard and receivables agree with the ledger's debtors */
    const dash = summarize(invoices, new Date(2025, 5, 30), links, 'INR');
    assert.equal(dash.outstanding, bal('debtors'));
    assert.equal(dash.billed, r2(11800 + 11800 + 50000 + 5000 + 1000 + 2000 + 11800 - 2360));
    const rec = buildReceivables({ invoices, payments: localDb.payments.getAll(), advances: loadAdvances() });
    assert.equal(rec.totals.net, bal('debtors'));

    /* Tally */
    const t = buildTallyModel({ invoices, payments: localDb.payments.getAll(), clients: [], items: [], purchases, vendors: [], advances: loadAdvances() } as never, { companyName: 'X', includePurchases: true, includeReceipts: true });
    const ledgerSum = (name: string, side: 'Dr' | 'Cr') => r2(t.vouchers.flatMap((v) => v.entries).filter((e) => e.ledger === name && e.side === side).reduce((s, e) => s + e.paise / 100, 0));
    assert.equal(r2(ledgerSum('Output CGST', 'Cr') - ledgerSum('Output CGST', 'Dr')), sum.a.cgst);
    assert.equal(r2(ledgerSum('Output IGST', 'Cr') - ledgerSum('Output IGST', 'Dr')), sum.a.igst);
    for (const inv of [w.rcmNew, w.rcmOld]) {
      const v = t.vouchers.find((x) => x.number === inv.invoice_number)!;
      assert.deepEqual(v.entries.map((e) => `${e.side} ${e.ledger} ${e.paise / 100}`), [`Dr ${clientMH.name} ${inv.taxable_value}`, `Cr Sales ${inv.taxable_value}`]);
      assert.match(v.narration, /Reverse charge: GST .* payable by the recipient/);
    }
    const legalV = t.vouchers.find((x) => x.type === 'Purchase' && x.number === 'L1')!;
    assert.ok(legalV.entries.some((e) => e.ledger === 'Advocate' && e.side === 'Cr' && e.paise === 1000000));
    assert.ok(legalV.entries.some((e) => e.ledger === 'GST Payable on Reverse Charge' && e.side === 'Cr' && e.paise === 180000));
    const impV = t.vouchers.find((x) => x.type === 'Purchase' && x.number === 'IMP1')!;
    assert.ok(impV.entries.some((e) => e.ledger === 'Overseas Co' && e.side === 'Cr' && e.paise === 2000000));
    assert.ok(impV.entries.some((e) => e.ledger === 'IGST Payable on Imports' && e.side === 'Cr' && e.paise === 360000));
  } finally {
    thawDate();
  }
});
