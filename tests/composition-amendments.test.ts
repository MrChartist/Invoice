/**
 * Roadmap 5.9: composition scheme + Bill of Supply, and GSTR-1 amendments (B2BA / B2CLA / CDNRA / B2CSA).
 * Expected numbers are worked out by hand in the comments.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { nextInvoiceNumber, resolvePrefix } from '../src/lib/invoice-number.ts';
import { compositionDueDays, compositionRate } from '../src/lib/tax-rules.ts';
import { calcInputFromRecord, calculateInvoice } from '../src/lib/invoice-calc.ts';
import {
  COMPOSITION_DECLARATION,
  compositionWarnings,
  defaultSalesDocType,
  supplyDeclaration,
} from '../src/lib/bill-of-supply.ts';
import { buildCmp08, buildGstr4, documentTurnover } from '../src/lib/composition-returns.ts';
import { asFiled, buildGstReport, type ReportPeriod } from '../src/lib/gst-reports.ts';
import { AMEND_JSON_LAYOUT, buildGstr1Json, sectionCsv } from '../src/lib/gstr-json.ts';
import { amendmentCheck, buildAmendment, canAmend, returnPeriodOf } from '../src/lib/amendments.ts';
import { buildConvertedDraft, buildCreditNote, isInvoiceType } from '../src/lib/documents.ts';
import { eInvoiceDocType } from '../src/lib/einvoice.ts';
import { ewayDocType } from '../src/lib/eway.ts';
import { isRevenueDoc, summarize } from '../src/lib/stats.ts';
import { returnsForMonth } from '../src/lib/compliance.ts';
import { EMPTY_BOOKS, type BooksData } from '../src/lib/books.ts';
import { A, buildLedger, voucherDiff } from '../src/lib/ledger/index.ts';
import { TEMPLATES } from '../src/components/templates/registry.ts';
import { makeDraft } from '../src/store/invoice-defaults.ts';
import { gstinChecksumChar } from '../src/lib/gstin.ts';
import { DOCUMENT_CODES, DOCUMENT_LABELS, type InvoiceRecord, type SenderProfile } from '../src/types/invoice.ts';

beforeEach(() => resetStorage());

const g = (first14: string) => first14 + gstinChecksumChar(first14);
const FILER = g('27AAAAA0000A1Z'); // Maharashtra
const COMP = g('27EEEEE4444E1Z');
const BUYER_DL = g('07BBBBB1111B1Z');
const BUYER_MH = g('27FFFFF5555F1Z');
const RCM_SUPPLIER = g('27CCCCC2222C1Z');

const REGULAR = { companyName: 'Regular Co', companyGstin: FILER, stateCode: '27' } as SenderProfile;
const TRADER = { companyName: 'Kirana', companyGstin: COMP, stateCode: '27', gst_scheme: 'composition', composition_category: 'trader' } as SenderProfile;

let seq = 0;
const item = (name: string, qty: number, rate: number, tax: number, hsn = '9983') =>
  ({ id: `i${++seq}`, name, type: 'goods', hsn, unit: 'NOS', quantity: qty, rate, tax_rate: tax, amount: qty * rate });

function inv(over: Partial<InvoiceRecord> & Record<string, unknown>): InvoiceRecord {
  return {
    id: `id-${++seq}`, invoice_number: '', doc_type: 'TAX_INVOICE', issue_date: '2025-04-05', due_date: '2025-04-20',
    status: 'Sent', currency: 'INR', template_id: 't', client: { name: 'Buyer', email: '', address: '', city: '', zip: '' },
    sender: REGULAR, items: [], gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false,
    discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0,
    notes: '', terms: '', subtotal: 0, discount_amount: 0, taxable_value: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0,
    tax_amount: 0, round_off: 0, total: 0, balance_due: 0,
    ...over,
  } as InvoiceRecord;
}

/** Record with its stored totals computed, as the editor saves it. */
function computed(rec: InvoiceRecord): InvoiceRecord {
  const t = calculateInvoice(calcInputFromRecord(rec));
  return { ...rec, subtotal: t.subtotal, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due };
}

/* ───────────── Bill of Supply: type, numbering, tax ───────────── */

test('BOS: own series BOS/FY25-26/0001, FY boundary on a local day, custom prefix never applies', () => {
  assert.equal(DOCUMENT_LABELS.BILL_OF_SUPPLY, 'Bill of Supply');
  assert.equal(DOCUMENT_CODES.BILL_OF_SUPPLY, 'BOS');
  assert.equal(resolvePrefix('BILL_OF_SUPPLY', 'MC'), 'BOS');
  assert.equal(nextInvoiceNumber({ existingNumbers: [], dateStr: '2026-03-31', docType: 'BILL_OF_SUPPLY' }), 'BOS/FY25-26/0001');
  assert.equal(nextInvoiceNumber({ existingNumbers: ['BOS/FY25-26/0007', 'INV/FY25-26/0009'], dateStr: '2026-03-31', docType: 'BILL_OF_SUPPLY' }), 'BOS/FY25-26/0008');
  // 1 April starts a new FY series, whatever the machine's time zone.
  assert.equal(nextInvoiceNumber({ existingNumbers: ['BOS/FY25-26/0008'], dateStr: '2026-04-01', docType: 'BILL_OF_SUPPLY' }), 'BOS/FY26-27/0001');
  // The invoice series is untouched by bills of supply.
  assert.equal(nextInvoiceNumber({ existingNumbers: ['BOS/FY25-26/0008'], dateStr: '2025-06-01', docType: 'INVOICE' }), 'INV/FY25-26/0001');
});

test('BOS: no tax is ever charged, even when the record still says CGST_SGST and lines carry 18%', () => {
  const rec = inv({ doc_type: 'BILL_OF_SUPPLY', gst_mode: 'CGST_SGST', items: [item('Rice', 10, 100, 18, '1006'), item('Freight', 1, 50, 5, '9965')], shipping: 30 });
  const t = calculateInvoice(calcInputFromRecord(rec));
  assert.equal(t.tax_amount, 0);
  assert.equal(t.cgst_amount + t.sgst_amount + t.igst_amount + t.cess_amount, 0);
  assert.equal(t.total, 1080); // 1,000 + 50 + 30 freight, no GST
  // An `over` that asks for a mode (as the GST reports do) cannot put tax back on a Bill of Supply.
  assert.equal(calculateInvoice(calcInputFromRecord(rec, { gst_mode: 'IGST' })).tax_amount, 0);
});

test('BOS: conversion to it clears tax and the amends marker; credit notes against it stay untaxed', () => {
  const q = computed(inv({ doc_type: 'QUOTATION', status: 'Draft', items: [item('Shoes', 2, 500, 12, '6403')] }));
  const bos = buildConvertedDraft(q, 'BILL_OF_SUPPLY', { id: 'b1', invoice_number: 'BOS/FY25-26/0001', today: '2025-05-01', dueDays: 7 });
  assert.equal(bos.gst_mode, 'NONE');
  assert.equal(bos.tax_amount, 0);
  assert.equal(bos.total, 1000);
  assert.ok(isInvoiceType('BILL_OF_SUPPLY'));
  const sent = { ...bos, status: 'Sent' as const };
  const cn = buildCreditNote(sent, { lines: [{ itemId: sent.items[0].id, quantity: 1 }], reason: 'Sales return' }, [], [sent], { id: 'c1', invoice_number: 'CRN/FY25-26/0001', today: '2025-05-02' });
  assert.deepEqual(cn.errors, []);
  assert.equal(cn.record!.tax_amount, 0);
  assert.equal(cn.record!.total, 500);
});

test('BOS is revenue with zero output tax (dashboard, receivables) ', () => {
  assert.ok(isRevenueDoc({ doc_type: 'BILL_OF_SUPPLY', status: 'Sent' }));
  assert.ok(!isRevenueDoc({ doc_type: 'BILL_OF_SUPPLY', status: 'Draft' }));
  const s = summarize([computed(inv({ doc_type: 'BILL_OF_SUPPLY', gst_mode: 'NONE', items: [item('Rice', 1, 1000, 0)] }))]);
  assert.equal(s.billed, 1000);
  assert.equal(s.outstanding, 1000);
});

test('e-Invoice: a Bill of Supply is never e-invoiced (even with an override); e-Way uses document type BIL', () => {
  assert.equal(eInvoiceDocType({ doc_type: 'BILL_OF_SUPPLY' }), null);
  assert.equal(eInvoiceDocType({ doc_type: 'BILL_OF_SUPPLY' }, 'INV'), null);
  assert.equal(eInvoiceDocType({ doc_type: 'TAX_INVOICE' }), 'INV');
  assert.equal(ewayDocType('BILL_OF_SUPPLY'), 'BIL');
  assert.equal(ewayDocType('TAX_INVOICE'), 'INV');
});

test('ledger: a Bill of Supply posts Dr debtors / Cr sales only, and balances', () => {
  const rec = computed(inv({ id: 'B', doc_type: 'BILL_OF_SUPPLY', gst_mode: 'NONE', issue_date: '2025-04-10', items: [item('Rice', 10, 99.5, 5, '1006')], shipping: 20 }));
  const led = buildLedger({ ...EMPTY_BOOKS, invoices: [rec] as unknown as BooksData['invoices'], userAccounts: [], manual: [], assets: [], today: '2026-03-31' });
  const v = led.vouchers.find((x) => x.id === 'sale:B');
  assert.ok(v);
  assert.equal(voucherDiff(v!), 0);
  const accounts = new Set(v!.lines.map((l) => l.account));
  assert.ok(accounts.has(A.debtors) && accounts.has(A.sales));
  for (const tax of [A.outCgst, A.outSgst, A.outIgst, A.outGst, A.outCess]) assert.ok(!accounts.has(tax), `no ${tax} line`);
  const debtors = v!.lines.find((l) => l.account === A.debtors)!;
  assert.equal(debtors.dr, 101500); // 995 + 20 freight, in paise
});

/* ───────────── Composition: rates, defaults, declaration ───────────── */

test('composition rate by category and date (tax-rules, date-keyed)', () => {
  assert.equal(compositionRate('manufacturer', '2017-08-01'), 2);
  assert.equal(compositionRate('manufacturer', '2018-01-01'), 1);
  assert.equal(compositionRate('trader', '2017-08-01'), 1);
  assert.equal(compositionRate('trader', '2025-06-01'), 1);
  assert.equal(compositionRate('restaurant', '2017-07-01'), 5);
  assert.equal(compositionRate('restaurant', '2025-06-01'), 5);
  assert.equal(compositionRate('service', '2019-03-31'), null); // Sec 10(2A) option not yet available
  assert.equal(compositionRate('service', '2019-04-01'), 6);
});

test('composition profile: new documents default to a Bill of Supply with no tax', () => {
  const settings = { profiles: [], activeProfileId: '', defaultCurrency: 'INR', defaultTaxRate: 18, invoicePrefix: 'INV', defaultDueDays: 14, defaultTerms: '', defaultNotes: '', roundOff: true, onboarded: true };
  const d = makeDraft({ settings, sender: TRADER });
  assert.equal(d.doc_type, 'BILL_OF_SUPPLY');
  assert.equal(d.gst_mode, 'NONE');
  assert.equal(makeDraft({ settings, sender: REGULAR }).doc_type, 'INVOICE');
  assert.equal(makeDraft({ settings, sender: TRADER, docType: 'QUOTATION' }).doc_type, 'QUOTATION');
  assert.equal(defaultSalesDocType(TRADER), 'BILL_OF_SUPPLY');
});

test('declaration: exact Rule 49 wording, read from the document snapshot only', () => {
  assert.equal(COMPOSITION_DECLARATION, 'Composition taxable person, not eligible to collect tax on supplies');
  assert.equal(supplyDeclaration({ doc_type: 'BILL_OF_SUPPLY' }, TRADER), COMPOSITION_DECLARATION);
  assert.equal(supplyDeclaration({ doc_type: 'CREDIT_NOTE' }, TRADER), COMPOSITION_DECLARATION);
  assert.equal(supplyDeclaration({ doc_type: 'QUOTATION' }, TRADER), null);
  assert.equal(supplyDeclaration({ doc_type: 'BILL_OF_SUPPLY' }, REGULAR), null);
  assert.equal(supplyDeclaration({ doc_type: 'TAX_INVOICE' }, null), null);
});

test('declaration renders in every layout: TemplateEngine adds it after the body, outside every layout branch', () => {
  assert.equal(TEMPLATES.length, 26);
  const engine = readFileSync(new URL('../src/components/templates/TemplateEngine.tsx', import.meta.url), 'utf8');
  // One render site, after the layout-specific body (gst / receipt / generic), unconditional on layout or paper.
  assert.match(engine, /\{body\}\s*\{irn && <IrnBlock model=\{irn\} \/>\}\s*\{declaration && <SupplyDeclaration text=\{declaration\} \/>\}/);
  // Snapshot first (Critical Rule 3).
  assert.match(engine, /supplyDeclaration\(invoice, invoice\.sender \?\? sender\)/);
  const part = readFileSync(new URL('../src/components/templates/parts/SupplyDeclaration.tsx', import.meta.url), 'utf8');
  assert.match(part, /\{text\}/);
  const css = readFileSync(new URL('../src/components/templates/invoice-paper.module.css', import.meta.url), 'utf8');
  const block = /\.supplyDeclaration \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(block, /var\(--tpl-accent\)/);
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i, 'no hard-coded colour');
  // Every layout gets the same title from DOCUMENT_LABELS.
  for (const f of ['PaperHeader', 'GstBody', 'ReceiptBody']) {
    const src = readFileSync(new URL(`../src/components/templates/parts/${f}.tsx`, import.meta.url), 'utf8');
    assert.match(src, /DOCUMENT_LABELS\[invoice\.doc_type\]/);
  }
});

test('editor warnings: tax invoice by a composition dealer, inter-state goods (not blocking), taxed lines on a regular BOS', () => {
  const codes = (r: Parameters<typeof compositionWarnings>[0]) => compositionWarnings(r).map((w) => w.code);
  const base = { issue_date: '2025-06-01', place_of_supply: '27', items: [item('Rice', 1, 100, 5, '1006')] };
  assert.deepEqual(codes({ ...base, doc_type: 'BILL_OF_SUPPLY', sender: TRADER }), []);
  assert.deepEqual(codes({ ...base, doc_type: 'TAX_INVOICE', sender: TRADER }), ['TAX_INVOICE_BY_COMPOSITION']);
  assert.deepEqual(codes({ ...base, doc_type: 'BILL_OF_SUPPLY', place_of_supply: '29', sender: TRADER }), ['INTER_STATE_GOODS']);
  // Services inter-state are fine for a Sec 10(1) dealer; a Sec 10(2A) dealer is barred from any inter-state supply.
  const svc = { ...base, items: [item('Repair', 1, 100, 18, '9987')], place_of_supply: '29', doc_type: 'BILL_OF_SUPPLY' as const };
  assert.deepEqual(codes({ ...svc, sender: TRADER }), []);
  assert.deepEqual(codes({ ...svc, sender: { ...TRADER, composition_category: 'service' } }), ['INTER_STATE_GOODS']);
  assert.deepEqual(codes({ ...base, doc_type: 'BILL_OF_SUPPLY', sender: REGULAR }), ['BOS_TAXED_LINES']);
});

/* ───────────── CMP-08 / GSTR-4 ───────────── */

const Q1: ReportPeriod = { kind: 'quarter', fyStart: 2025, quarter: 1 };

function compositionBooks() {
  const bos = (over: Record<string, unknown>) => computed(inv({ sender: TRADER, doc_type: 'BILL_OF_SUPPLY', gst_mode: 'NONE', ...over }));
  const invoices = [
    // 10,000 taxable goods (catalogue rate 5%) + 2,000 exempt goods (rate 0) + 500 freight
    bos({ id: 'c1', invoice_number: 'BOS/FY25-26/0001', issue_date: '2025-04-10', items: [item('Biscuits', 100, 100, 5, '1905'), item('Fresh vegetables', 1, 2000, 0, '0702')], shipping: 500 }),
    bos({ id: 'c2', invoice_number: 'BOS/FY25-26/0002', issue_date: '2025-06-30', items: [item('Soap', 10, 300, 18, '3401')] }), // 3,000
    // credit note on c2: -1,000 (taxable goods)
    computed(inv({ id: 'c3', sender: TRADER, doc_type: 'CREDIT_NOTE', gst_mode: 'NONE', issue_date: '2025-06-30', items: [item('Soap', 1, 1000, 18, '3401')] })),
    bos({ id: 'c4', issue_date: '2025-05-01', status: 'Draft', items: [item('X', 1, 99999, 5, '1905')] }),
    bos({ id: 'c5', issue_date: '2025-05-01', status: 'Cancelled', items: [item('X', 1, 99999, 5, '1905')] }),
    bos({ id: 'c6', issue_date: '2025-07-01', items: [item('Next quarter', 1, 5000, 5, '1905')] }),
    // A regular profile's invoice is not composition turnover.
    computed(inv({ id: 'r1', issue_date: '2025-04-11', items: [item('Advice', 1, 7000, 18)] })),
  ];
  const purchases = [
    // RCM from a registered supplier: 10,000 + CGST 900 + SGST 900
    { id: 'p1', kind: 'PURCHASE', vendor_name: 'Transporter', vendor_gstin: RCM_SUPPLIER, bill_number: 'GTA/1', date: '2025-05-05', place_of_supply: '27', taxable: 10000, cgst: 900, sgst: 900, igst: 0, reverse_charge: true, itc_eligible: true, total: 10000 },
    // Import of services: 20,000, IGST 3,600 (reverse charge)
    { id: 'p2', kind: 'PURCHASE', vendor_name: 'Cloud Inc', vendor_gstin: '', bill_number: 'AWS-9', date: '2025-06-01', place_of_supply: '27', taxable: 20000, cgst: 0, sgst: 0, igst: 3600, import_type: 'SERVICES', itc_eligible: true, total: 20000 },
    // Ordinary bill: 5,000 + 900 GST — NOT claimable by a composition dealer
    { id: 'p3', kind: 'PURCHASE', vendor_name: 'Wholesaler', vendor_gstin: RCM_SUPPLIER, bill_number: 'W/7', date: '2025-04-20', place_of_supply: '27', taxable: 5000, cgst: 450, sgst: 450, igst: 0, itc_eligible: true, total: 5900 },
    // Unregistered supplier, no tax
    { id: 'p4', kind: 'PURCHASE', vendor_name: 'Farmer', vendor_gstin: '', bill_number: 'F/1', date: '2025-04-21', place_of_supply: '27', taxable: 3000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 3000 },
  ];
  return { invoices, purchases };
}

test('CMP-08: turnover × rate split CGST/SGST, trader exempt goods left out, RCM added, ITC never claimed', () => {
  const { invoices, purchases } = compositionBooks();
  const r = buildCmp08(invoices, purchases, Q1, { gstin: COMP });
  // value: c1 12,500 + c2 3,000 − c3 1,000 = 14,500; exempt 2,000 (vegetables); base 12,500 (incl. 500 freight)
  assert.equal(r.outward.value, 14500);
  assert.equal(r.outward.exempt, 2000);
  assert.equal(r.outward.taxableBase, 12500);
  // 1% → 125, half each
  assert.deepEqual(r.byRate, [{ rate: 1, base: 12500, cgst: 62.5, sgst: 62.5 }]);
  assert.equal(r.outward.cgst, 62.5);
  assert.equal(r.outward.sgst, 62.5);
  // RCM: GTA 10,000 (900 + 900) + import of services 20,000 (IGST 3,600)
  assert.deepEqual(r.rcm, { value: 30000, igst: 3600, cgst: 900, sgst: 900, cess: 0 });
  assert.deepEqual(r.payable, { igst: 3600, cgst: 962.5, sgst: 962.5, cess: 0, total: 5525 });
  assert.equal(r.itcNotClaimable, 900);
  assert.ok(r.issues.some((i) => i.code === 'ITC_NOT_CLAIMABLE'));
  assert.deepEqual(r.counts, { documents: 3, drafts: 1, cancelled: 1, purchases: 4 });
  assert.equal(r.fp, '062025');
});

test('CMP-08: rate follows the document date and category (manufacturer 2% in 2017, 1% from 2018)', () => {
  const mfg = { ...TRADER, composition_category: 'manufacturer' } as SenderProfile;
  const d17 = computed(inv({ sender: mfg, doc_type: 'BILL_OF_SUPPLY', gst_mode: 'NONE', issue_date: '2017-12-10', items: [item('Bricks', 1, 10000, 0, '6901')] }));
  const d18 = computed(inv({ sender: mfg, doc_type: 'BILL_OF_SUPPLY', gst_mode: 'NONE', issue_date: '2018-01-10', items: [item('Bricks', 1, 10000, 0, '6901')] }));
  assert.equal(documentTurnover(d17).rate, 2);
  assert.equal(documentTurnover(d18).rate, 1);
  // Manufacturers pay on all turnover (a zero catalogue rate does not exempt the line).
  assert.equal(documentTurnover(d18).base, 10000);
  const q3 = buildCmp08([d17], [], { kind: 'quarter', fyStart: 2017, quarter: 3 }, {});
  assert.equal(q3.outward.cgst, 100); // 10,000 × 2% / 2
  const svc = computed(inv({ sender: { ...TRADER, composition_category: 'service' } as SenderProfile, doc_type: 'BILL_OF_SUPPLY', gst_mode: 'NONE', issue_date: '2019-03-10', items: [item('Repair', 1, 1000, 18, '9987')] }));
  const early = buildCmp08([svc], [], { kind: 'quarter', fyStart: 2018, quarter: 4 }, {});
  assert.ok(early.issues.some((i) => i.code === 'NO_RATE'));
  assert.equal(early.payable.total, 0);
});

test('CMP-08 flags GST charged on a composition dealer\'s tax invoice', () => {
  const bad = computed(inv({ sender: TRADER, doc_type: 'TAX_INVOICE', issue_date: '2025-04-10', items: [item('Soap', 1, 1000, 18, '3401')] }));
  const r = buildCmp08([bad], [], Q1, {});
  assert.ok(r.issues.some((i) => i.code === 'TAX_COLLECTED'));
  assert.equal(r.outward.taxableBase, 1000); // base is the value without the tax
});

test('GSTR-4: inward supplies 4A/4B/4C/4D, four CMP-08 quarters, outward by rate', () => {
  const { invoices, purchases } = compositionBooks();
  const r = buildGstr4(invoices, purchases, 2025, { gstin: COMP });
  assert.deepEqual(r.inward.registered, { value: 5000, igst: 0, cgst: 450, sgst: 450, cess: 0 });
  assert.deepEqual(r.inward.registeredRcm, { value: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0 });
  assert.deepEqual(r.inward.unregistered, { value: 3000, igst: 0, cgst: 0, sgst: 0, cess: 0 });
  assert.deepEqual(r.inward.importServices, { value: 20000, igst: 3600, cgst: 0, sgst: 0, cess: 0 });
  assert.equal(r.quarters.length, 4);
  assert.equal(r.quarters[1].outward.value, 5000); // c6 in Q2
  // Year: base 12,500 + 5,000 = 17,500 at 1% → 175
  assert.deepEqual(r.outwardByRate, [{ rate: 1, base: 17500, cgst: 87.5, sgst: 87.5 }]);
  assert.equal(r.totals.turnover, 19500);
  assert.equal(r.totals.compositionTax, 175);
  assert.equal(r.totals.rcmTax, 5400);
  assert.equal(r.totals.payable, 5575);
});

test('composition calendar: CMP-08 by the 18th after each quarter; GSTR-4 by 30 April, 30 June from FY 2024-25', () => {
  assert.deepEqual(returnsForMonth(2025, 5, 'composition'), []);
  const jun = returnsForMonth(2025, 6, 'composition');
  assert.deepEqual(jun.map((r) => [r.form, r.periodKey, r.due]), [['CMP08', '2025-Q1', '2025-07-18']]);
  const mar24 = returnsForMonth(2024, 3, 'composition');
  assert.deepEqual(mar24.map((r) => [r.form, r.due]), [['CMP08', '2024-04-18'], ['GSTR4', '2024-04-30']]);
  const mar25 = returnsForMonth(2025, 3, 'composition');
  assert.deepEqual(mar25.map((r) => [r.form, r.due]), [['CMP08', '2025-04-18'], ['GSTR4', '2025-06-30']]);
  assert.equal(compositionDueDays('2024-04-01').gstr4, '06-30');
});

/* ───────────── GSTR-1 / 3B classification ───────────── */

const APR: ReportPeriod = { kind: 'month', fyStart: 2025, month: 4 };

test('GSTR-1: a regular taxpayer\'s BOS goes to Table 8 (by exempt kind) and Table 13 as invoices for outward supply', () => {
  const rows = [
    computed(inv({ id: 'b1', invoice_number: 'BOS/FY25-26/0001', doc_type: 'BILL_OF_SUPPLY', gst_mode: 'NONE', issue_date: '2025-04-05', items: [item('Tuition', 1, 10000, 0, '9992')] })),
    computed(inv({ id: 'b2', invoice_number: 'BOS/FY25-26/0002', doc_type: 'BILL_OF_SUPPLY', gst_mode: 'NONE', issue_date: '2025-04-06', exempt_kind: 'NIL', place_of_supply: '07', client: { name: 'D', gstin: BUYER_DL, email: '', address: '', city: '', zip: '' }, items: [item('Grain', 1, 4000, 0, '1001')] })),
    computed(inv({ id: 'b3', invoice_number: 'BOS/FY25-26/0003', doc_type: 'BILL_OF_SUPPLY', gst_mode: 'NONE', issue_date: '2025-04-07', exempt_kind: 'NON_GST', items: [item('Petrol', 1, 3000, 0, '2710')] })),
    computed(inv({ id: 't1', invoice_number: 'INV/FY25-26/0001', issue_date: '2025-04-08', items: [item('Advice', 1, 1000, 18)] })),
  ];
  const rep = buildGstReport(rows, [], { period: APR, gstin: FILER });
  assert.equal(rep.gstr1.counts.included, 4);
  assert.deepEqual(rep.gstr1.b2b, []);
  assert.deepEqual(rep.gstr1.nil, [
    { type: 'INTRAB2C', nil: 0, exempt: 10000, nonGst: 3000 },
    { type: 'INTRB2B', nil: 4000, exempt: 0, nonGst: 0 },
  ]);
  const docs = rep.gstr1.docIssue.find((d) => d.series === 'BOS/FY25-26');
  assert.deepEqual(docs, { docType: 'Invoices for outward supply', series: 'BOS/FY25-26', from: 'BOS/FY25-26/0001', to: 'BOS/FY25-26/0003', total: 3, cancelled: 0, netIssued: 3 });
  // 3B: nil + exempt in 3.1(c), non-GST in 3.1(e); no tax.
  assert.deepEqual(rep.gstr3b.outward.nilExempt, { inter: 4000, intra: 10000 });
  assert.equal(rep.gstr3b.outward.nonGst, 3000);
  assert.equal(rep.gstr3b.outward.taxable.taxable, 1000);
  const json = buildGstr1Json(rep.gstr1) as { doc_issue: { doc_det: { doc_num: number; docs: { from: string }[] }[] } };
  assert.ok(json.doc_issue.doc_det.find((d) => d.doc_num === 1)!.docs.some((d) => d.from === 'BOS/FY25-26/0001'));
});

test('GSTR-1 / 3B leave composition documents out (CMP-08 / GSTR-4 instead)', () => {
  const rows = [
    computed(inv({ id: 'k1', invoice_number: 'BOS/FY25-26/0001', sender: TRADER, doc_type: 'BILL_OF_SUPPLY', gst_mode: 'NONE', items: [item('Rice', 1, 5000, 5, '1006')] })),
    computed(inv({ id: 't1', invoice_number: 'INV/FY25-26/0001', items: [item('Advice', 1, 1000, 18)] })),
  ];
  const rep = buildGstReport(rows, [], { period: APR });
  assert.equal(rep.gstr1.counts.included, 1);
  assert.equal(rep.gstr1.counts.composition, 1);
  assert.deepEqual(rep.gstr1.nil, []);
  assert.ok(!rep.gstr1.docIssue.some((d) => d.series.startsWith('BOS')));
  assert.ok(rep.issues.some((i) => i.code === 'COMPOSITION_DOCS'));
  // Without composition documents the counts keep their old shape.
  assert.deepEqual(buildGstReport([rows[1]], [], { period: APR }).gstr1.counts, { included: 1, drafts: 0, cancelled: 0, notTaxDocs: 0 });
});

/* ───────────── Amendments ───────────── */

const JUN: ReportPeriod = { kind: 'month', fyStart: 2025, month: 6 };

function amended(rec: InvoiceRecord, today: string, patch: Partial<InvoiceRecord>, reason = 'correction'): InvoiceRecord {
  const marker = buildAmendment(rec, today, { reason });
  return computed({ ...rec, ...patch, amends: marker });
}

test('amendment model: the original stays in its period untouched; the revision goes to B2BA in the amendment period', () => {
  // April: B2B intra-state 10,000 @18% to a Maharashtra buyer.
  const original = computed(inv({ id: 'a1', invoice_number: 'INV/FY25-26/0001', issue_date: '2025-04-05', client: { name: 'MH Co', gstin: BUYER_MH, email: '', address: '', city: '', zip: '' }, items: [item('Laptops', 10, 1000, 18, '8471')] }));
  const aprBefore = buildGstReport([original], [], { period: APR, gstin: FILER });
  // Amended on 20 June: quantity 10 → 12 (12,000 @18%).
  const rev = amended(original, '2025-06-20', { items: [{ ...original.items[0], quantity: 12, amount: 12000 }] }, 'Short-billed quantity');
  assert.equal(rev.amends!.original_number, 'INV/FY25-26/0001');
  assert.equal(rev.amends!.original_date, '2025-04-05');
  assert.equal(rev.amends!.period, '042025');
  assert.equal(rev.amends!.original!.total, original.total);
  assert.equal((rev.amends!.original as InvoiceRecord).amends, undefined);
  assert.equal(asFiled(rev).total, original.total);

  // April is reported exactly as filed.
  const aprAfter = buildGstReport([rev], [], { period: APR, gstin: FILER });
  assert.deepEqual(aprAfter.gstr1.b2b, aprBefore.gstr1.b2b);
  assert.deepEqual(aprAfter.gstr3b.outward, aprBefore.gstr3b.outward);
  assert.equal(aprAfter.gstr1.amendments, undefined);
  assert.deepEqual(buildGstr1Json(aprAfter.gstr1), buildGstr1Json(aprBefore.gstr1));

  // June: B2BA with the original number / date, revised values; 3B takes the difference (+2,000, +180 / +180).
  const jun = buildGstReport([rev], [], { period: JUN, gstin: FILER });
  assert.deepEqual(jun.gstr1.b2b, []);
  const a = jun.gstr1.amendments!;
  assert.equal(a.b2ba.length, 1);
  assert.equal(a.b2ba[0].origNumber, 'INV/FY25-26/0001');
  assert.equal(a.b2ba[0].origDate, '2025-04-05');
  assert.equal(a.b2ba[0].origPeriod, '042025');
  assert.equal(a.b2ba[0].taxable, 12000);
  assert.equal(a.b2ba[0].cgst, 1080);
  assert.equal(jun.gstr3b.outward.taxable.taxable, 2000);
  assert.equal(jun.gstr3b.outward.taxable.cgst, 180);
  assert.equal(jun.gstr3b.outward.taxable.sgst, 180);
  assert.equal(jun.gstr3b.payment.cash.cgst, 180);

  const json = buildGstr1Json(jun.gstr1) as Record<string, any>;
  assert.equal(AMEND_JSON_LAYOUT.b2ba, 'b2ba');
  const b2ba = json.b2ba[0];
  assert.equal(b2ba.ctin, BUYER_MH);
  assert.deepEqual(
    { oinum: b2ba.inv[0].oinum, oidt: b2ba.inv[0].oidt, inum: b2ba.inv[0].inum, idt: b2ba.inv[0].idt, val: b2ba.inv[0].val },
    { oinum: 'INV/FY25-26/0001', oidt: '05-04-2025', inum: 'INV/FY25-26/0001', idt: '05-04-2025', val: 14160 },
  );
  assert.deepEqual(b2ba.inv[0].itms, [{ num: 1801, itm_det: { rt: 18, txval: 12000, camt: 1080, samt: 1080, csamt: 0 } }]);
  assert.match(sectionCsv(jun.gstr1, 'amend'), /B2BA,27FFFFF5555F1Z.?,MH Co,INV\/FY25-26\/0001,2025-04-05,042025/);
});

test('amendments: credit note → CDNRA; B2C (others) → revised B2CSA rows; moving B2CS → B2B zeroes the old row', () => {
  const buyer = { name: 'MH Co', gstin: BUYER_MH, email: '', address: '', city: '', zip: '' };
  const cn = computed(inv({ id: 'n1', invoice_number: 'CRN/FY25-26/0001', doc_type: 'CREDIT_NOTE', issue_date: '2025-04-15', client: buyer, items: [item('Return', 1, 1000, 18, '8471')] }));
  const cnRev = amended(cn, '2025-06-03', { items: [{ ...cn.items[0], rate: 800, amount: 800 }] });
  const b2c1 = computed(inv({ id: 's1', invoice_number: 'INV/FY25-26/0010', issue_date: '2025-04-20', items: [item('Retail', 1, 5000, 18, '8471')] }));
  const b2c2 = computed(inv({ id: 's2', invoice_number: 'INV/FY25-26/0011', issue_date: '2025-04-21', items: [item('Retail', 1, 3000, 18, '8471')] }));
  // s1 is amended: the buyer gave a GSTIN → now B2B.
  const s1Rev = amended(b2c1, '2025-06-05', { client: buyer });
  const jun = buildGstReport([cnRev, s1Rev, b2c2], [], { period: JUN, gstin: FILER });
  const a = jun.gstr1.amendments!;
  assert.equal(a.cdnra.length, 1);
  assert.equal(a.cdnra[0].noteType, 'C');
  assert.equal(a.cdnra[0].taxable, 800);
  assert.equal(a.b2ba.length, 1);
  assert.equal(a.b2ba[0].invoiceId, 's1');
  // April B2CS intra 27 @18% revised: 5,000 + 3,000 filed → only s2's 3,000 remains.
  assert.deepEqual(a.b2csa, [{ omon: '042025', supply: 'INTRA', pos: '27', rate: 18, txval: 3000, igst: 0, cgst: 270, sgst: 270, cess: 0 }]);
  assert.ok(jun.issues.some((i) => i.code === 'AMEND_SECTION_CHANGED'));
  const json = buildGstr1Json(jun.gstr1) as Record<string, any>;
  assert.equal(json.cdnra[0].nt[0].ont_num, 'CRN/FY25-26/0001');
  assert.equal(json.cdnra[0].nt[0].ont_dt, '15-04-2025');
  assert.equal(json.b2csa[0].omon, '042025');
  assert.deepEqual(json.b2csa[0].itms, [{ rt: 18, txval: 3000, camt: 270, samt: 270, csamt: 0 }]);
  // 3B (June): credit note reduced by 200 (liability +200 / +36), s1 moved B2C → B2B (no net change).
  assert.equal(jun.gstr3b.outward.taxable.taxable, 200);
  assert.equal(jun.gstr3b.outward.taxable.cgst, 18);
  // April keeps every original.
  const apr = buildGstReport([cnRev, s1Rev, b2c2], [], { period: APR, gstin: FILER });
  assert.equal(apr.gstr1.cdnr[0].taxable, 1000);
  assert.deepEqual(apr.gstr1.b2cs.map((r) => r.txval), [8000]);
});

test('amendments: a draft / cancelled revision is not reported; unregistered large inter-state → B2CLA', () => {
  const big = computed(inv({ id: 'L1', invoice_number: 'INV/FY25-26/0020', issue_date: '2025-04-25', gst_mode: 'IGST', place_of_supply: '07', items: [item('Machine', 1, 300000, 18, '8471')] }));
  const rev = amended(big, '2025-06-10', { items: [{ ...big.items[0], rate: 310000, amount: 310000 }] });
  const jun = buildGstReport([rev], [], { period: JUN, gstin: FILER });
  assert.equal(jun.gstr1.amendments!.b2cla.length, 1);
  assert.equal(jun.gstr1.amendments!.b2cla[0].taxable, 310000);
  const json = buildGstr1Json(jun.gstr1) as Record<string, any>;
  assert.equal(json.b2cla[0].pos, '07');
  assert.equal(json.b2cla[0].inv[0].oinum, 'INV/FY25-26/0020');
  const cancelled = buildGstReport([{ ...rev, status: 'Cancelled' }], [], { period: JUN, gstin: FILER });
  assert.equal(cancelled.gstr1.amendments, undefined);
  assert.ok(cancelled.issues.some((i) => i.code === 'AMEND_NOT_LIVE'));
});

test('amendment helpers: when an edit must be an amendment; re-amending keeps the first original; never copied', () => {
  const rec = computed(inv({ id: 'x', invoice_number: 'INV/FY25-26/0003', issue_date: '2025-05-10', items: [item('A', 1, 100, 18)] }));
  assert.ok(canAmend(rec));
  assert.ok(!canAmend({ ...rec, status: 'Draft' }));
  assert.ok(!canAmend({ ...rec, doc_type: 'BILL_OF_SUPPLY' }));
  assert.ok(!canAmend({ ...rec, sender: TRADER }));
  assert.deepEqual(amendmentCheck(rec, {}), { needed: false, reason: null, period: '052025' });
  const filed = [{ id: 'f', form: 'GSTR1' as const, period_key: '2025-05', gstin: FILER, filed_on: '2025-06-11', marked_at: '' }];
  assert.deepEqual(amendmentCheck(rec, { filed }), { needed: true, reason: 'filed', period: '052025' });
  const qrmp = [{ id: 'q', form: 'GSTR1' as const, period_key: '2025-Q1', gstin: '', filed_on: '2025-07-13', marked_at: '' }];
  assert.deepEqual(amendmentCheck(rec, { filed: qrmp }), { needed: true, reason: 'filed', period: '062025' });
  assert.deepEqual(amendmentCheck(rec, { lockUntil: '2025-05-31' }), { needed: true, reason: 'locked', period: '052025' });
  assert.equal(returnPeriodOf('2026-02-10', true), '032026');

  const first = { ...rec, total: 999, amends: buildAmendment(rec, '2025-06-20') };
  const again = buildAmendment(first, '2025-08-02', { reason: 'second fix' });
  assert.equal(again.amended_on, '2025-08-02');
  assert.equal(again.original!.total, rec.total, 'first original kept');
  assert.equal(again.reason, 'second fix');
  assert.equal(again.original!.sender!.companyGstin, FILER);
  assert.equal((again.original!.sender as SenderProfile).logo, undefined, 'snapshot images are not duplicated into the frozen copy');

  // Conversions, credit notes and late fees never carry the marker.
  const sent = { ...first, status: 'Sent' as const };
  const ch = buildConvertedDraft(sent, 'DELIVERY_CHALLAN', { id: 'd', invoice_number: 'DCH/FY25-26/0001', today: '2025-08-03', dueDays: 0 });
  assert.equal(ch.amends, undefined);
  const cn = buildCreditNote(sent, { lines: [{ itemId: sent.items[0].id, quantity: 1 }], reason: 'Discount' }, [], [sent], { id: 'c', invoice_number: 'CRN/FY25-26/0009', today: '2025-08-03' });
  assert.equal(cn.record!.amends, undefined);
});

test('startAmendment: freezes the stored document and keeps its id, number and payments', async () => {
  const { localDb } = await import('../src/lib/localDb.ts');
  const { startAmendment } = await import('../src/lib/documents.ts');
  const saved = localDb.invoices.save(computed(inv({ id: 'z1', invoice_number: 'INV/FY25-26/0042', issue_date: '2025-04-02', items: [item('A', 1, 1000, 18)] })));
  const marked = startAmendment(saved, 'Wrong GSTIN');
  assert.equal(marked.id, 'z1');
  assert.equal(marked.invoice_number, 'INV/FY25-26/0042');
  assert.equal(marked.amends!.reason, 'Wrong GSTIN');
  assert.equal(marked.amends!.original!.total, saved.total);
  assert.equal(localDb.invoices.getAll().length, 1);
  assert.throws(() => startAmendment({ ...saved, id: 'nope', doc_type: 'QUOTATION' }), /can be amended/);
});
