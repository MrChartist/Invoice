/**
 * GST gaps (5.9 follow-up): e-commerce operators (Sec 52 / 9(5), GSTR-1 Table 14, 3B 3.1.1), export amendments
 * (EXPA), GSTR-4 Tables 7-9 with CMP-08 / GSTR-4 interest and late fee, bulk e-Way for Bills of Supply and
 * Table 13 delivery challans by purpose. Expected numbers are worked out by hand in the comments.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { calcInputFromRecord, calculateInvoice } from '../src/lib/invoice-calc.ts';
import { buildGstReport, challanDocType, type ReportPeriod } from '../src/lib/gst-reports.ts';
import { ECO_JSON_LAYOUT, AMEND_JSON_LAYOUT, buildGstr1Json, buildGstr3bJson, gstr3bRows, sectionCsv } from '../src/lib/gstr-json.ts';
import { buildAmendment } from '../src/lib/amendments.ts';
import { buildGstr9 } from '../src/lib/gstr9.ts';
import { checkEcoGstin, ecoWarnings } from '../src/lib/eco.ts';
import { ecoTcsRate } from '../src/lib/tax-rules.ts';
import { estimateFor, gstr4LateFee } from '../src/lib/gst-penalties.ts';
import {
  GSTR4_MANUAL_TABLE,
  buildGstr4Annual,
  cmp08Interest,
  estimateEcoTcs,
  loadGstr4Manual,
  saveGstr4Manual,
} from '../src/lib/gstr4-annual.ts';
import { buildGstr4 } from '../src/lib/composition-returns.ts';
import { buildBulkEInvoice, buildBulkEway, bulkCandidates } from '../src/lib/einvoice-bulk.ts';
import { validateBackupData } from '../src/lib/backup.ts';
import { DB_PREFIX, getTable } from '../src/lib/storage.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import { buildConvertedDraft } from '../src/lib/documents.ts';
import { gstinChecksumChar } from '../src/lib/gstin.ts';
import type { InvoiceRecord, SenderProfile } from '../src/types/invoice.ts';

beforeEach(() => resetStorage());

const g = (first14: string) => first14 + gstinChecksumChar(first14);
const FILER = g('27AAAAA0000A1Z'); // Maharashtra
const COMP = g('27EEEEE4444E1Z');
const BUYER_MH = g('27FFFFF5555F1Z');
const ECO_TCS = g('27AACCF1111A1C'); // TCS registration ('C' in place 14)
const ECO_95 = g('29AACCS2222B1Z'); // a regular registration of an operator paying tax u/s 9(5)

const REGULAR = { companyName: 'Regular Co', companyGstin: FILER, stateCode: '27' } as SenderProfile;
const TRADER = { companyName: 'Kirana', companyGstin: COMP, stateCode: '27', gst_scheme: 'composition', composition_category: 'trader' } as SenderProfile;
const APR: ReportPeriod = { kind: 'month', fyStart: 2025, month: 4 };
const JUN: ReportPeriod = { kind: 'month', fyStart: 2025, month: 6 };

let seq = 0;
const item = (name: string, qty: number, rate: number, tax: number, hsn = '8471') =>
  ({ id: `i${++seq}`, name, type: 'goods', hsn, unit: 'NOS', quantity: qty, rate, tax_rate: tax, amount: qty * rate });

function inv(over: Partial<InvoiceRecord> & Record<string, unknown>): InvoiceRecord {
  const rec = {
    id: `id-${++seq}`, invoice_number: `INV/FY25-26/${String(seq).padStart(4, '0')}`, doc_type: 'TAX_INVOICE', issue_date: '2025-04-05', due_date: '2025-04-20',
    status: 'Sent', currency: 'INR', template_id: 't', client: { name: 'Buyer', email: '', address: '', city: '', zip: '' },
    sender: REGULAR, items: [], gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false,
    discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0,
    notes: '', terms: '', subtotal: 0, discount_amount: 0, taxable_value: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0,
    tax_amount: 0, round_off: 0, total: 0, balance_due: 0,
    ...over,
  } as InvoiceRecord;
  const t = calculateInvoice(calcInputFromRecord(rec));
  return { ...rec, subtotal: t.subtotal, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, total: t.total, balance_due: t.balance_due };
}

/* ───────────── E-commerce ───────────── */

test('ECO GSTIN validation: Z or C in place 14 with the checksum; regular GSTIN rule unchanged', () => {
  assert.deepEqual(checkEcoGstin(ECO_TCS), { valid: true, tcsRegistration: true });
  assert.deepEqual(checkEcoGstin(ECO_95), { valid: true, tcsRegistration: false });
  assert.equal(checkEcoGstin('').valid, false);
  assert.equal(checkEcoGstin(ECO_TCS.slice(0, 14) + (ECO_TCS[14] === 'A' ? 'B' : 'A')).valid, false, 'checksum');
  assert.equal(checkEcoGstin('27AACCF1111A1X5').valid, false, 'shape');
  const w = ecoWarnings({ eco_gstin: ECO_95, eco_section: 'PAY_9_5', issue_date: '2025-04-05', sender: REGULAR, items: [item('Meal', 1, 100, 5, '996331')] as never, gst_mode: 'CGST_SGST', doc_type: 'TAX_INVOICE' });
  assert.deepEqual(w.map((x) => x.code), ['ECO_95_TAXED']);
  assert.deepEqual(ecoWarnings({ eco_gstin: ECO_95, issue_date: '2025-04-05', sender: REGULAR, items: [], gst_mode: 'CGST_SGST', doc_type: 'TAX_INVOICE' }).map((x) => x.code), ['ECO_NOT_TCS']);
  // Composition dealer: goods through a TCS operator barred before 1 Oct 2023, services always.
  const comp = (date: string, hsn: string) => ecoWarnings({ eco_gstin: ECO_TCS, issue_date: date, sender: TRADER, items: [item('x', 1, 1, 0, hsn)] as never, gst_mode: 'NONE', doc_type: 'BILL_OF_SUPPLY' }).map((x) => x.code);
  assert.deepEqual(comp('2023-09-30', '8471'), ['ECO_COMPOSITION']);
  assert.deepEqual(comp('2023-10-01', '8471'), []);
  assert.deepEqual(comp('2024-01-01', '998311'), ['ECO_COMPOSITION']);
});

test('ECO fields: normalised (upper-cased, section only with a GSTIN), challan purpose validated', () => {
  const r = normalizeRecord({ eco_gstin: ` ${ECO_TCS.toLowerCase()} `, eco_section: 'PAY_9_5', challan_purpose: 'APPROVAL' });
  assert.equal(r.eco_gstin, ECO_TCS);
  assert.equal(r.eco_section, 'PAY_9_5');
  assert.equal(r.challan_purpose, 'APPROVAL');
  const bare = normalizeRecord({ eco_section: 'PAY_9_5', challan_purpose: 'NOPE' });
  assert.ok(!('eco_gstin' in bare) && !('eco_section' in bare) && !('challan_purpose' in bare));
  assert.ok(!('eco_section' in normalizeRecord({ eco_gstin: ECO_TCS, eco_section: 'X' })));
});

test('Sec 52: ECO supplies keep their section with etin (B2B, B2CS type E) and are totalled in Table 14(a)', () => {
  // B2B through the operator: 10,000 @18% intra (900 + 900).
  const b2b = inv({ client: { name: 'MH Co', gstin: BUYER_MH, email: '', address: '', city: '', zip: '' }, items: [item('Laptop', 1, 10000, 18)], eco_gstin: ECO_TCS });
  // B2C through the operator: 2,000 @18% (180 + 180) — its own B2CS row, apart from the direct 1,000 sale.
  const b2c = inv({ items: [item('Mouse', 2, 1000, 18)], eco_gstin: ECO_TCS, eco_section: 'TCS_52' });
  const direct = inv({ items: [item('Cable', 1, 1000, 18)] });
  // Credit note through the operator: 500 @18% (45 + 45), netted in 14(a).
  const cn = inv({ doc_type: 'CREDIT_NOTE', invoice_number: 'CN/FY25-26/0001', items: [item('Mouse', 1, 500, 18)], eco_gstin: ECO_TCS });
  const rep = buildGstReport([b2b, b2c, direct, cn], [], { period: APR, gstin: FILER });
  const g1 = rep.gstr1;
  assert.equal(g1.b2b[0].etin, ECO_TCS);
  assert.deepEqual(g1.b2cs.map((r) => [r.etin ?? '', r.txval]), [['', 1000], [ECO_TCS, 1500]]);
  assert.deepEqual(g1.eco, { tcs: [{ etin: ECO_TCS, value: 11500, igst: 0, cgst: 1035, sgst: 1035, cess: 0, count: 3 }], pay95: [] });
  // 3B: ordinary 3.1(a), no 3.1.1 row.
  assert.equal(rep.gstr3b.outward.taxable.taxable, 12500);
  assert.equal(rep.gstr3b.ecoSupplies95, undefined);

  const json = buildGstr1Json(g1) as Record<string, any>;
  assert.equal(json.b2b[0].inv[0].etin, ECO_TCS);
  const eRow = json.b2cs.find((r: any) => r.etin);
  assert.deepEqual({ typ: eRow.typ, etin: eRow.etin, txval: eRow.txval }, { typ: 'E', etin: ECO_TCS, txval: 1500 });
  assert.equal(json.b2cs.find((r: any) => !r.etin).typ, 'OE');
  assert.deepEqual(json[ECO_JSON_LAYOUT.section], { clttx: [{ etin: ECO_TCS, suppval: 11500, igst: 0, cgst: 1035, sgst: 1035, cess: 0 }] });
  assert.match(sectionCsv(g1, 'eco'), /14\(a\),Operator collects TCS u\/s 52,27AACCF1111A1C.,3,11500,0,1035,1035,0/);
  assert.ok(sectionCsv(g1, 'b2b').split('\r\n')[0].endsWith(',E-commerce GSTIN'));
  assert.ok(sectionCsv(g1, 'b2b').split('\r\n')[1].endsWith(`,${ECO_TCS}`));
  // A report without ECO documents keeps its old JSON shape.
  assert.equal(buildGstr1Json(buildGstReport([direct], [], { period: APR }).gstr1).supeco, undefined);
});

test('Sec 9(5): value only — Table 14(b) and 3B 3.1.1(ii), never B2B / B2CS / nil / HSN / 3.1', () => {
  // Restaurant service via an app: 4,000 billed without tax (the operator pays 5%).
  const meal = inv({ items: [item('Meals', 4, 1000, 0, '996331')], gst_mode: 'NONE', eco_gstin: ECO_95, eco_section: 'PAY_9_5' });
  // A wrongly taxed one (1,000 @5%): still value only, flagged.
  const taxed = inv({ items: [item('Meals', 1, 1000, 5, '996331')], eco_gstin: ECO_95, eco_section: 'PAY_9_5' });
  const direct = inv({ items: [item('Cable', 1, 1000, 18)] });
  const rep = buildGstReport([meal, taxed, direct], [], { period: APR, gstin: FILER });
  const g1 = rep.gstr1;
  assert.deepEqual(g1.eco, { tcs: [], pay95: [{ etin: ECO_95, value: 5000, igst: 0, cgst: 0, sgst: 0, cess: 0, count: 2 }] });
  assert.deepEqual(g1.b2cs.map((r) => r.txval), [1000]);
  assert.deepEqual(g1.nil, []);
  assert.ok(!g1.hsn.some((h) => h.hsn === '996331'));
  assert.equal(rep.gstr3b.outward.taxable.taxable, 1000);
  assert.equal(rep.gstr3b.outward.nilExempt.intra + rep.gstr3b.outward.nonGst, 0);
  assert.equal(rep.gstr3b.ecoSupplies95, 5000);
  assert.equal(rep.gstr3b.payment.liability.cgst, 90, 'tax on the 9(5) document is not the supplier liability');
  assert.ok(rep.issues.some((i) => i.code === 'ECO_95_TAXED' && i.invoiceId === taxed.id));
  assert.ok(gstr3bRows(rep.gstr3b).some((r) => r[0] === '3.1.1(ii)' && r[2] === 5000));
  const j3 = buildGstr3bJson(rep.gstr3b, FILER, '042025') as Record<string, any>;
  assert.deepEqual(j3.eco_dtls.eco_reg_sup, { txval: 5000 });
  assert.deepEqual((buildGstr1Json(g1) as Record<string, any>).supeco, { paytx: [{ etin: ECO_95, suppval: 5000, igst: 0, cgst: 0, sgst: 0, cess: 0 }] });
  // Without ECO the 3B JSON keeps its old keys.
  assert.equal((buildGstr3bJson(buildGstReport([direct], [], { period: APR }).gstr3b, FILER, '042025') as Record<string, any>).eco_dtls, undefined);

  // GSTR-9: 5C1 and the 3B turnover agree.
  const r9 = buildGstr9([meal, direct], [], { fyStart: 2025, gstin: FILER });
  const c1 = r9.table5.find((r) => r.id === '5C1');
  assert.equal(c1?.taxable, 4000);
  const turnover = r9.comparison.find((c) => c.item.startsWith('Total turnover'))!;
  assert.equal(turnover.diff13, 0);
});

/* ───────────── EXPA ───────────── */

test('EXPA: an amended export invoice goes to expa in the amendment period; the original period is untouched', () => {
  const exp = inv({
    invoice_number: 'INV/FY25-26/0100', supply_type: 'EXPORT_LUT', place_of_supply: '96', gst_mode: 'IGST',
    client: { name: 'US Inc', email: '', address: '', city: '', zip: '' }, items: [item('Software', 1, 50000, 18, '998314')],
    port_code: 'INBOM4', shipping_bill_no: '1234567', shipping_bill_date: '2025-04-06',
  });
  const aprBefore = buildGstReport([exp], [], { period: APR, gstin: FILER });
  const rev = inv({ ...exp, items: [item('Software', 1, 60000, 18, '998314')], amends: buildAmendment(exp, '2025-06-10', { reason: 'Price revised' }) });
  const aprAfter = buildGstReport([rev], [], { period: APR, gstin: FILER });
  assert.deepEqual(buildGstr1Json(aprAfter.gstr1), buildGstr1Json(aprBefore.gstr1));
  assert.equal(aprAfter.gstr1.exp[0].taxable, 50000);

  const jun = buildGstReport([rev], [], { period: JUN, gstin: FILER });
  assert.ok(!jun.issues.some((i) => i.code === 'AMEND_EXPORT'));
  const a = jun.gstr1.amendments!;
  assert.equal(a.expa?.length, 1);
  assert.equal(a.expa![0].expType, 'WOPAY');
  assert.equal(a.expa![0].taxable, 60000);
  const json = buildGstr1Json(jun.gstr1) as Record<string, any>;
  assert.equal(AMEND_JSON_LAYOUT.expa, 'expa');
  assert.deepEqual(json.expa, [{
    exp_typ: 'WOPAY',
    inv: [{ oinum: 'INV/FY25-26/0100', oidt: '05-04-2025', inum: 'INV/FY25-26/0100', idt: '05-04-2025', val: 60000, sbpcode: 'INBOM4', sbnum: '1234567', sbdt: '06-04-2025', itms: [{ txval: 60000, rt: 18, csamt: 0 }] }],
  }]);
  assert.match(sectionCsv(jun.gstr1, 'amend'), /EXPA,,US Inc,INV\/FY25-26\/0100,2025-04-05,042025/);
  // 3B 3.1(b) of June takes the difference; GSTR-9 5J carries it.
  assert.equal(jun.gstr3b.outward.zeroRated.taxable, 10000);
  const r9 = buildGstr9([rev], [], { fyStart: 2025, gstin: FILER });
  assert.equal(r9.table5.find((r) => r.id === '5A')!.taxable, 50000);
  assert.equal(r9.table5.find((r) => r.id === '5J')!.taxable, 10000);

  // A credit note on an export amended later goes to CDNURA with EXPWOP.
  const cn = inv({ ...exp, id: 'cn-x', doc_type: 'CREDIT_NOTE', invoice_number: 'CN/FY25-26/0009', items: [item('Software', 1, 5000, 18, '998314')] });
  const cnRev = inv({ ...cn, items: [item('Software', 1, 4000, 18, '998314')], amends: buildAmendment(cn, '2025-06-11') });
  const cnJun = buildGstReport([cnRev], [], { period: JUN, gstin: FILER }).gstr1.amendments!;
  assert.deepEqual(cnJun.cdnura.map((r) => [r.unregType, r.noteType, r.taxable]), [['EXPWOP', 'C', 4000]]);

  // SEZ amendments stay in B2BA with their invoice type.
  const sez = inv({ supply_type: 'SEZ_WITHOUT_PAYMENT', gst_mode: 'IGST', client: { name: 'SEZ Unit', gstin: BUYER_MH, email: '', address: '', city: '', zip: '' }, items: [item('Laptop', 1, 1000, 18)] });
  const sezRev = inv({ ...sez, items: [item('Laptop', 1, 1200, 18)], amends: buildAmendment(sez, '2025-06-12') });
  const sezJun = buildGstReport([sezRev], [], { period: JUN, gstin: FILER }).gstr1.amendments!;
  assert.deepEqual(sezJun.b2ba.map((r) => [r.invTyp, r.taxable]), [['SEWOP', 1200]]);
});

/* ───────────── GSTR-4 Tables 7-9, interest, late fee ───────────── */

test('GSTR-4 annual: Table 7 TCS estimate, Table 8 payable / interest / late fee, manual entries per FY', () => {
  assert.equal(ecoTcsRate('2024-07-09'), 1);
  assert.equal(ecoTcsRate('2024-07-10'), 0.5);
  // Q1 FY 25-26: 1,00,000 turnover (trader 1% = 500 + 500), 20,000 of it through a TCS operator (0.5% = 50 + 50).
  const bos = inv({ doc_type: 'BILL_OF_SUPPLY', invoice_number: 'BOS/FY25-26/0001', sender: TRADER, gst_mode: 'NONE', items: [item('Rice', 80, 1000, 5, '1006')] });
  const viaEco = inv({ doc_type: 'BILL_OF_SUPPLY', invoice_number: 'BOS/FY25-26/0002', sender: TRADER, gst_mode: 'NONE', items: [item('Rice', 20, 1000, 5, '1006')], eco_gstin: ECO_TCS });
  const rows = [bos, viaEco];
  assert.deepEqual(estimateEcoTcs(rows, { kind: 'fy', fyStart: 2025 }), [{ etin: ECO_TCS, gross: 20000, igst: 0, cgst: 50, sgst: 50, documents: 1 }]);

  const g4 = buildGstr4(rows, [], 2025, { gstin: COMP });
  assert.equal(g4.totals.payable, 1000);
  // CMP-08 Q1 due 18 Jul 2025, paid 28 Jul: 10 days × 18% on 500 per head = 2.47 each.
  const filed = [{ id: 'x', form: 'CMP08' as const, period_key: '2025-Q1', gstin: COMP, filed_on: '2025-07-28', marked_at: '' }];
  const q = cmp08Interest(g4, filed);
  assert.equal(q[0].due, '2025-07-18');
  assert.equal(q[0].days, 10);
  assert.equal(q[0].interest.cgst, 2.47);
  assert.equal(q[1].days, 0);

  saveGstr4Manual({ id: '', fy_start: 2025, gstin: COMP, ...loadGstr4Manual(2025, COMP), tax_paid: { cgst: 500, sgst: 500 }, filed_on: '2026-07-10', tds_tcs: [{ id: 't1', kind: 'TDS', gstin: FILER, gross: 10000, igst: 0, cgst: 100, sgst: 100 }], refund: { cgst: { tax: 25 } } });
  const manual = loadGstr4Manual(2025, COMP);
  assert.equal(manual.id, `2025|${COMP}`);
  assert.equal(getTable(GSTR4_MANUAL_TABLE).length, 1);
  const a = buildGstr4Annual(rows, [], 2025, manual, { gstin: COMP, filed });
  const cg = a.table8.find((r) => r.head === 'cgst')!;
  assert.deepEqual(
    [cg.taxPayable, cg.taxPaid, cg.interestPayable],
    [500, 500, 2.47],
  );
  // GSTR-4 FY 25-26 due 30 Jun 2026, filed 10 Jul: 10 days × ₹50 = 500 (cap ₹2,000), half CGST / half SGST.
  assert.equal(a.lateFee.due, '2026-06-30');
  assert.equal(a.lateFee.total, 500);
  assert.equal(cg.lateFeePayable, 250);
  assert.equal(a.table7.entered.length, 1);
  assert.equal(a.table9.find((r) => r.head === 'cgst')!.refund.tax, 25);
  // Backup accepts the new table.
  assert.doesNotThrow(() => validateBackupData({ [DB_PREFIX + GSTR4_MANUAL_TABLE]: JSON.stringify(getTable(GSTR4_MANUAL_TABLE)) }));
  assert.throws(() => validateBackupData({ [DB_PREFIX + GSTR4_MANUAL_TABLE]: JSON.stringify([{ fy_start: 2025 }]) }), /gstr4_manual/);
});

test('GSTR-4 late fee caps by FY; CMP-08 has interest only (compliance estimate)', () => {
  assert.equal(gstr4LateFee('2022-04-30', '2022-08-30', 2021), 2000, 'FY 21-22 cap ₹2,000');
  assert.equal(gstr4LateFee('2022-04-30', '2022-08-30', 2021, true), 500, 'nil cap ₹500');
  assert.equal(gstr4LateFee('2020-10-31', '2021-04-30', 2019), 9050, '181 days × ₹50 under the ₹10,000 cap');
  assert.equal(gstr4LateFee('2026-06-30', '2026-06-30', 2025), 0);
  const cmp = { id: 'CMP08:2025-Q1', form: 'CMP08' as const, periodKey: '2025-Q1', label: '', from: '2025-04-01', to: '2025-06-30', due: '2025-07-18', optional: false };
  assert.deepEqual(estimateFor(cmp, { filedOn: '2025-07-28', cashTax: 1000 }), { days: 10, lateFee: 0, interest: 4.93 });
  const g4 = { ...cmp, id: 'GSTR4:FY2025', form: 'GSTR4' as const, periodKey: 'FY2025', from: '2025-04-01', to: '2026-03-31', due: '2026-06-30' };
  assert.deepEqual(estimateFor(g4, { filedOn: '2026-07-10' }), { days: 10, lateFee: 500, interest: 0 });
});

/* ───────────── Bulk e-Way: Bills of Supply ───────────── */

test('bulk e-Way: Bills of Supply are offered on request (BIL), never preselected, and stay out of the e-Invoice file', () => {
  const bos = inv({
    doc_type: 'BILL_OF_SUPPLY', invoice_number: 'BOS/FY25-26/0001', gst_mode: 'NONE', exempt_kind: 'EXEMPT',
    client: { name: 'MH Co', gstin: BUYER_MH, email: '', address: 'Pune', city: 'Pune', zip: '411001', state_code: '27' } as never,
    sender: { ...REGULAR, companyAddress: '12 Dalal Street, Fort, Mumbai, Maharashtra 400001' } as SenderProfile,
    items: [item('Rice', 100, 60, 0, '1006')],
  });
  const range = { from: '2025-04-01', to: '2025-04-30' };
  assert.equal(bulkCandidates([bos], range).length, 0, 'not offered by default');
  const c = bulkCandidates([bos], range, [], { billsOfSupply: true });
  assert.deepEqual(c.map((x) => [x.preselect, x.ewayOnly]), [[false, true]]);
  const ew = buildBulkEway([bos], { now: new Date(2025, 3, 6), transport: { mode: 'ROAD', vehicle: 'MH12AB1234', distance: 150 } });
  const bill = (JSON.parse(ew.json) as { billLists: { docType: string; docNo: string }[] }).billLists;
  assert.deepEqual(ew.blocked.map((b) => b.reasons), []);
  assert.deepEqual(bill.map((b) => [b.docType, b.docNo]), [['BIL', 'BOS/FY25-26/0001']]);
  const ei = buildBulkEInvoice([bos]);
  assert.match(ei.blocked[0].reasons.join(' '), /Bill of Supply: no e-Invoice/);
});

/* ───────────── Table 13: delivery challans by purpose ───────────── */

test('Table 13: challans listed by Rule 55 purpose (doc 9-12); no purpose / ahead of invoice stay out (default)', () => {
  const ch = (n: number, purpose?: InvoiceRecord['challan_purpose'], status = 'Sent') =>
    inv({ doc_type: 'DELIVERY_CHALLAN', invoice_number: `DCH/FY25-26/000${n}`, status: status as InvoiceRecord['status'], gst_mode: 'NONE', items: [item('Die', 1, 100, 0)], ...(purpose ? { challan_purpose: purpose } : {}) });
  const rows = [ch(1, 'JOB_WORK'), ch(2, 'APPROVAL'), ch(3, 'JOB_WORK'), ch(4), ch(5, 'ANTICIPATION'), ch(6, 'JOB_WORK', 'Cancelled'), ch(7, 'OTHER_THAN_SUPPLY')];
  assert.equal(challanDocType(rows[0]), 'Delivery Challan for job work');
  assert.equal(challanDocType(rows[3]), null);
  assert.equal(challanDocType(rows[4]), null);
  const doc = buildGstReport(rows, [], { period: APR }).gstr1.docIssue;
  const job = doc.find((d) => d.docType === 'Delivery Challan for job work')!;
  // 1, 3, 6 (cancelled): 2, 4, 5 are other purposes' numbers, not gaps.
  assert.deepEqual([job.from, job.to, job.total, job.cancelled, job.netIssued], ['DCH/FY25-26/0001', 'DCH/FY25-26/0006', 3, 1, 2]);
  assert.equal(doc.find((d) => d.docType.includes('approval'))!.total, 1);
  const json = buildGstr1Json(buildGstReport(rows, [], { period: APR }).gstr1) as Record<string, any>;
  assert.deepEqual(json.doc_issue.doc_det.map((d: any) => d.doc_num), [9, 10, 12]);
  // Default (no purpose): nothing listed, as before.
  assert.deepEqual(buildGstReport([ch(8)], [], { period: APR }).gstr1.docIssue, []);
  // Converting a challan to an invoice drops the purpose.
  const conv = buildConvertedDraft(rows[0], 'TAX_INVOICE', { id: 'n1', invoice_number: 'INV/FY25-26/0099', today: '2025-04-10', dueDays: 15 } as never);
  assert.equal(conv.challan_purpose, undefined);
});
