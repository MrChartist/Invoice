/**
 * GSTR-9 annual working paper: a seeded FY 2025-26 with one document per GSTR-9 head,
 * checked head by head (hand-computed) and against the sum of the 12 monthly
 * GSTR-1 / GSTR-3B builds.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import {
  BUYER_SEZ_GJ,
  SELLER_GSTIN,
  clientKA,
  clientMH,
  clientRetail,
  clientUS,
  createViaStore,
  gstin,
  installSettings,
  reload,
} from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { round2 } from '../src/lib/invoice-calc.ts';
import { buildGstReport, type ReportPeriod } from '../src/lib/gst-reports.ts';
import { buildGstr9, buildGstr9Html, gstr9Csv, gstr9WorkingPaper, GSTR9_OPTIONAL_LIMIT, type Gstr9Report, type Gstr9Row } from '../src/lib/gstr9.ts';
import { computePurchaseTotals, purchasesDb } from '../src/lib/purchases.ts';
import { createCreditNote, readLinks } from '../src/lib/documents.ts';
import { fyPeriod, gstSummary, loadBooksData } from '../src/lib/books.ts';
import { getTable } from '../src/lib/storage.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseLine, PurchaseRecord } from '../src/types/purchases.ts';

const FY = 2025;
const VENDOR_MH = gstin('27AAAPL1234C1Z');
const VENDOR_KA = gstin('29AAAPL1234C1Z');

beforeEach(() => {
  resetStorage();
  installSettings();
});

const L = (name: string, hsn: string, qty: number, rate: number, tax = 18): PurchaseLine => ({ id: `l-${name}`, name, hsn, unit: 'NOS', quantity: qty, rate, tax_rate: tax });

function bill(over: Partial<PurchaseRecord> & { lines: PurchaseLine[]; date: string }, pos = '27'): PurchaseRecord {
  const t = computePurchaseTotals(over.lines, { placeOfSupply: pos, businessState: '27', gstApplies: true });
  return purchasesDb.save({
    kind: 'PURCHASE',
    vendor_name: 'Vendor',
    bill_number: `B-${over.date}`,
    category: 'Purchases',
    taxable: t.taxable,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    itc_eligible: true,
    total: t.total,
    amount_paid: 0,
    place_of_supply: pos,
    ...over,
  });
}

const sez = { ...clientKA, id: 'sez', name: 'Gujarat SEZ Unit', gstin: BUYER_SEZ_GJ, state_code: '24' };
const kaUnreg = { ...clientKA, id: 'c-ka-ur', name: 'Bengaluru Walk-in', gstin: undefined };

/** One FY of documents; returns what the GSTR-9 should show. */
function seed() {
  const s1 = createViaStore({ date: '2025-04-10', lines: [{ name: 'Research', hsn: '998311', qty: 10, rate: 1000 }] }); // 4B intra
  createViaStore({ date: '2025-05-12', client: clientKA, lines: [{ name: '<b>Bold</b> & co', hsn: '998312', qty: 5, rate: 1000 }] }); // 4B inter
  createViaStore({ date: '2025-06-05', client: clientRetail, lines: [{ name: '=HYPERLINK("http://x")', hsn: '998313', qty: 2, rate: 1000 }] }); // 4A B2CS
  createViaStore({ date: '2025-07-07', client: kaUnreg, lines: [{ qty: 200, rate: 1000 }] }); // 4A B2CL
  createViaStore({ date: '2025-08-08', client: clientUS, pos: '99', supply: 'EXPORT_LUT', lines: [{ qty: 10, rate: 1000 }] }); // 5A
  createViaStore({ date: '2025-09-09', client: clientUS, pos: '99', supply: 'EXPORT_WITH_PAYMENT', lines: [{ qty: 10, rate: 1000 }] }); // 4C
  createViaStore({ date: '2025-10-10', client: sez, supply: 'SEZ_WITHOUT_PAYMENT', lines: [{ qty: 10, rate: 1000 }] }); // 5B
  createViaStore({ date: '2025-11-11', client: sez, supply: 'SEZ_WITH_PAYMENT', lines: [{ qty: 10, rate: 1000 }] }); // 4D
  const de = createViaStore({ date: '2025-12-12', client: clientMH, supply: 'DEEMED_EXPORT', lines: [{ qty: 10, rate: 1000 }] }); // 4E
  createViaStore({ date: '2026-01-13', lines: [{ name: 'Nil item', hsn: '0401', qty: 3, rate: 1000, tax: 0 }] }); // 5E
  createViaStore({ date: '2026-02-14', reverseCharge: true, lines: [{ qty: 4, rate: 1000 }] }); // 5C
  createViaStore({ date: '2026-02-20', asDraft: true, lines: [{ qty: 99, rate: 1000 }] }); // excluded
  freezeDate('2026-03-10T11:00:00');
  createCreditNote(reload(s1.id), { lines: [{ itemId: reload(s1.id).items[0].id, quantity: 4 }], reason: 'Sales return' }); // 4I
  thawDate();
  // Outside the FY: must not count.
  createViaStore({ date: '2026-04-01', lines: [{ qty: 1, rate: 1000 }] });

  bill({ date: '2025-04-15', vendor_gstin: VENDOR_MH, lines: [L('Paper', '4802', 500, 100)] }); // 6B(i) 4500/4500
  bill({ date: '2025-05-15', vendor_gstin: VENDOR_KA, lines: [L('Consulting', '998314', 1, 10000)] }, '29'); // 6B(iii) IGST 1800
  bill({ date: '2025-06-15', reverse_charge: true, lines: [L('Legal', '998215', 1, 5000)] }); // 6C 450/450
  bill({ date: '2025-07-15', reverse_charge: true, vendor_gstin: VENDOR_MH, lines: [L('GTA', '996511', 1, 2000)] }); // 6D 180/180
  purchasesDb.save({ kind: 'PURCHASE', vendor_name: 'Overseas', bill_number: 'BOE-1', date: '2025-08-15', category: 'Purchases', lines: [L('Machine part', '8483', 10, 1000)], taxable: 10000, cgst: 0, sgst: 0, igst: 1800, itc_eligible: true, import_type: 'GOODS', total: 11800, amount_paid: 0 }); // 6E
  purchasesDb.save({ kind: 'PURCHASE', vendor_name: 'SaaS Inc', bill_number: 'INV-9', date: '2025-09-15', category: 'Software & subscriptions', lines: [L('SaaS', '998315', 1, 5000)], taxable: 5000, cgst: 0, sgst: 0, igst: 900, itc_eligible: true, import_type: 'SERVICES', total: 5000, amount_paid: 0 }); // 6F
  bill({ date: '2025-10-15', vendor_gstin: VENDOR_MH, itc_eligible: false, itc_reversal_reason: 'SEC_17_5', lines: [L('Car', '8703', 1, 1000)] }); // 6B(i) + 7E 90/90
  bill({ date: '2025-11-15', vendor_gstin: VENDOR_MH, itc_eligible: false, lines: [L('Gift', '9503', 1, 1000)] }); // 8F 90/90
  bill({ date: '2025-12-15', vendor_gstin: VENDOR_MH, itc_reversed: 500, itc_reversal_reason: 'RULE_42', lines: [L('Stock', '4820', 100, 100)] }); // 6B(i) 900/900, 7C 250/250
  bill({ date: '2026-01-15', vendor_gstin: VENDOR_MH, itc_reversed: 360, itc_reversal_reason: 'RULE_37', lines: [L('Ink', '3215', 20, 100)] }); // 6B(i) 180/180, 7A 180/180
  purchasesDb.save({ kind: 'EXPENSE', vendor_name: 'Landlord', vendor_gstin: VENDOR_MH, bill_number: 'R-1', date: '2026-02-15', category: 'Rent', lines: [], taxable: 30000, cgst: 2700, sgst: 2700, igst: 0, itc_eligible: true, total: 35400, amount_paid: 0 }); // 6B(iii), no HSN
  return { de: reload(de.id) };
}

function build(over: Partial<Parameters<typeof buildGstr9>[2]> = {}): Gstr9Report {
  return buildGstr9(getTable<InvoiceRecord>('invoices'), getTable('purchases'), {
    fyStart: FY,
    gstin: SELLER_GSTIN,
    links: readLinks(),
    ...over,
  });
}

const r = (rows: Gstr9Row[], id: string) => {
  const x = rows.find((y) => y.id === id);
  assert.ok(x, `row ${id}`);
  return x!;
};
const heads = (x: Gstr9Row) => ({ taxable: x.taxable, igst: x.igst, cgst: x.cgst, sgst: x.sgst, cess: x.cess });

const MONTHS: ReportPeriod[] = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map((month) => ({ kind: 'month', fyStart: FY, month }));
function monthly() {
  return MONTHS.map((period) => buildGstReport(getTable<InvoiceRecord>('invoices'), getTable('purchases'), { period, gstin: SELLER_GSTIN, links: readLinks() }));
}
const sum = (xs: number[]) => round2(xs.reduce((s, v) => s + v, 0));

test('Table 4 heads (hand-computed)', () => {
  const { de } = seed();
  const g = build();
  assert.deepEqual(heads(r(g.table4, '4A')), { taxable: 202000, igst: 36000, cgst: 180, sgst: 180, cess: 0 });
  assert.deepEqual(heads(r(g.table4, '4B')), { taxable: 15000, igst: 900, cgst: 900, sgst: 900, cess: 0 });
  assert.deepEqual(heads(r(g.table4, '4C')), { taxable: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0 });
  assert.deepEqual(heads(r(g.table4, '4D')), { taxable: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0 });
  assert.equal(r(g.table4, '4E').taxable, 10000);
  assert.equal(round2(r(g.table4, '4E').igst + r(g.table4, '4E').cgst + r(g.table4, '4E').sgst), de.tax_amount);
  assert.deepEqual(heads(r(g.table4, '4F')), { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
  // 4G: RCM legal (5000, 450/450) + GTA (2000, 180/180) + import of services (5000, IGST 900).
  assert.deepEqual(heads(r(g.table4, '4G')), { taxable: 12000, igst: 900, cgst: 630, sgst: 630, cess: 0 });
  assert.deepEqual(heads(r(g.table4, '4I')), { taxable: 4000, igst: 0, cgst: 360, sgst: 360, cess: 0 });
  assert.equal(r(g.table4, '4J').taxable, 0);
  const h = r(g.table4, '4H');
  const n = r(g.table4, '4N');
  assert.equal(n.taxable, round2(h.taxable - 4000));
  assert.equal(n.cgst, round2(h.cgst - 360));
});

test('Table 5 heads and total turnover (5N)', () => {
  seed();
  const g = build();
  assert.equal(r(g.table5, '5A').taxable, 10000);
  assert.equal(r(g.table5, '5B').taxable, 10000);
  assert.equal(r(g.table5, '5C').taxable, 4000);
  assert.equal(r(g.table5, '5D').taxable, 0);
  assert.equal(r(g.table5, '5E').taxable, 3000);
  assert.equal(r(g.table5, '5F').taxable, 0);
  assert.equal(r(g.table5, '5M').taxable, 27000);
  const n4 = r(g.table4, '4N');
  assert.equal(r(g.table5, '5N').taxable, round2(n4.taxable + 27000 - r(g.table4, '4G').taxable));
  assert.equal(g.turnover.computed, r(g.table5, '5N').taxable);
  assert.equal(g.turnover.optional, true);
  assert.ok(g.notes.some((x) => /optional/.test(x)));
  assert.ok(g.notes.some((x) => /Verify with your CA/.test(x)));
});

test('Tables 4/5 equal the sum of the 12 monthly GSTR-1 builds; 4G the monthly 3B 3.1(d)', () => {
  seed();
  const g = build();
  const ms = monthly();
  const t = (k: 'taxable' | 'igst' | 'cgst' | 'sgst') => sum(ms.map((m) => m.gstr1.totals[k]));
  const n4 = r(g.table4, '4N');
  const g4 = r(g.table4, '4G');
  // No zero-rated nil lines in the seed, and the outward RCM invoice carries no tax of its own on 5C,
  // so: (4N - 4G) + 5M = GSTR-1 net taxable; the tax heads match after removing the RCM invoice's tax.
  const rcmTax = (k: 'igst' | 'cgst' | 'sgst') => sum(ms.flatMap((m) => m.gstr1.b2b.filter((d) => d.rchrg === 'Y').map((d) => d[k])));
  assert.equal(round2(n4.taxable - g4.taxable + r(g.table5, '5M').taxable), t('taxable'));
  for (const k of ['igst', 'cgst', 'sgst'] as const) assert.equal(round2(n4[k] - g4[k] + rcmTax(k)), t(k), k);
  for (const k of ['taxable', 'igst', 'cgst', 'sgst'] as const) assert.equal(g4[k], sum(ms.map((m) => m.gstr3b.outward.inwardRcm[k])), `4G ${k}`);
  assert.equal(g.documents, sum(ms.map((m) => m.gstr1.counts.included)));
  assert.equal(g.months.length, 12);
});

test('Table 6: 6A from 3B, 6B split, RCM by registration, imports; 6I = 6A', () => {
  seed();
  const g = build();
  const ms = monthly();
  const a = r(g.table6, '6A');
  for (const k of ['igst', 'cgst', 'sgst'] as const) {
    const exp = sum(ms.map((m) => m.gstr3b.itc.importGoods[k] + m.gstr3b.itc.importServices[k] + m.gstr3b.itc.availableRcm[k] + m.gstr3b.itc.availableOther[k]));
    assert.equal(a[k], exp, `6A ${k}`);
    assert.equal(r(g.table6, '6I')[k], exp, `6I ${k}`);
    assert.equal(r(g.table6, '6J')[k], 0, `6J ${k}`);
  }
  assert.deepEqual([r(g.table6, '6B(i)').cgst, r(g.table6, '6B(i)').sgst, r(g.table6, '6B(i)').igst], [5670, 5670, 0]);
  assert.equal(r(g.table6, '6B(ii)').cgst, 0);
  assert.deepEqual([r(g.table6, '6B(iii)').igst, r(g.table6, '6B(iii)').cgst], [1800, 2700]);
  assert.deepEqual([r(g.table6, '6C').cgst, r(g.table6, '6C').sgst], [450, 450]);
  assert.deepEqual([r(g.table6, '6D').cgst, r(g.table6, '6D').sgst], [180, 180]);
  assert.equal(r(g.table6, '6E').igst, 1800);
  assert.equal(r(g.table6, '6F').igst, 900);
  assert.equal(r(g.table6, '6O').cgst, r(g.table6, '6I').cgst);
  assert.equal(r(g.table6, '6B(i)').hasTaxable, false);
});

test('Table 7 reversals by rule = monthly 3B 4B; Table 8 (2B manual, ineligible, imports)', () => {
  seed();
  const g = build({ itc2b: { igst: 1800, cgst: 9000, sgst: 9000 } });
  const ms = monthly();
  assert.deepEqual([r(g.table7, '7A').cgst, r(g.table7, '7A').sgst], [180, 180]);
  assert.deepEqual([r(g.table7, '7C').cgst, r(g.table7, '7C').sgst], [250, 250]);
  assert.deepEqual([r(g.table7, '7E').cgst, r(g.table7, '7E').sgst], [90, 90]);
  for (const k of ['igst', 'cgst', 'sgst'] as const) {
    assert.equal(r(g.table7, '7I')[k], sum(ms.map((m) => m.gstr3b.itc.reversedRules[k] + m.gstr3b.itc.reversedOther[k])), `7I ${k}`);
    assert.equal(r(g.table7, '7J')[k], round2(r(g.table6, '6O')[k] - r(g.table7, '7I')[k]), `7J ${k}`);
    assert.equal(r(g.table8, '8F')[k], sum(ms.map((m) => m.gstr3b.itc.ineligible[k])), `8F ${k}`);
  }
  assert.equal(r(g.table8, '8A').cgst, 9000);
  assert.equal(r(g.table8, '8B').cgst, r(g.table6, '6B(i)').cgst + r(g.table6, '6B(ii)').cgst + r(g.table6, '6B(iii)').cgst);
  assert.equal(r(g.table8, '8D').cgst, round2(9000 - r(g.table8, '8B').cgst));
  assert.equal(r(g.table8, '8G').igst, 1800);
  assert.equal(r(g.table8, '8H').igst, 1800);
  assert.equal(r(g.table8, '8I').igst, 0);
  // 8A left blank = 0 (manual input).
  assert.equal(r(build().table8, '8A').igst, 0);
});

test('Table 9: payable = monthly 3B liability incl. RCM; cash + ITC used = payable per head', () => {
  seed();
  const g = build();
  const ms = monthly();
  const row9 = (id: string) => g.table9.find((x) => x.id === id)!;
  for (const [id, k] of [['9-IGST', 'igst'], ['9-CGST', 'cgst'], ['9-SGST', 'sgst']] as const) {
    const x = row9(id);
    assert.equal(x.payable, sum(ms.map((m) => m.gstr3b.payment.liability[k] + m.gstr3b.payment.rcLiability[k])), `${id} payable`);
    assert.equal(round2(x.cash + x.itc.igst + x.itc.cgst + x.itc.sgst), x.payable, `${id} paid`);
    // Credit carried forward can only reduce cash compared with stand-alone monthly papers.
    assert.ok(x.cash <= sum(ms.map((m) => m.gstr3b.payment.cash[k])) + 0.001, `${id} cash`);
  }
  assert.equal(row9('9-CGST').itc.sgst, 0, 'SGST credit never pays CGST');
  assert.equal(row9('9-LATE').payable, 0);
  assert.ok(g.partV.every((x) => x.igst === 0 && x.taxable === 0 && x.note));
});

test('Table 17 = sum of monthly GSTR-1 HSN; Table 18 from bill lines', () => {
  seed();
  const g = build();
  const ms = monthly();
  assert.equal(sum(g.table17.map((h) => h.taxable)), sum(ms.flatMap((m) => m.gstr1.hsn.map((h) => h.taxable))));
  assert.equal(sum(g.table17.map((h) => h.igst)), sum(ms.flatMap((m) => m.gstr1.hsn.map((h) => h.igst))));
  const paper = g.table18.find((h) => h.hsn === '4802')!;
  assert.deepEqual([paper.qty, paper.taxable, paper.cgst, paper.sgst, paper.rate, paper.uqc], [500, 50000, 4500, 4500, 18, 'NOS']);
  assert.equal(g.table18.find((h) => h.hsn === '998314')!.uqc, 'NA');
  assert.equal(g.billsWithoutHsn, 1, 'the rent expense has no lines');
  assert.equal(g.bills, 11);
});

test('comparison: GSTR-1 vs 3B tax agree; books column from gstSummary', () => {
  seed();
  const books = gstSummary(loadBooksData(), fyPeriod(FY));
  const g = build({ books });
  const out = g.comparison.filter((c) => c.item === 'Outward tax');
  assert.equal(out.length, 4);
  for (const c of out) assert.equal(c.diff13, 0, `${c.head} GSTR-1 vs 3B`);
  const igst = out.find((c) => c.head === 'IGST')!;
  assert.equal(igst.books, round2(books.outputIgst));
  assert.equal(igst.diff3Books, round2(igst.gstr3b! - books.outputIgst));
  const itc = g.comparison.find((c) => c.head === 'Total')!;
  assert.equal(itc.diff13, 0);
  assert.equal(itc.books, books.itc);
  // Without books, the column is empty rather than zero.
  assert.equal(build().comparison[1].books, null);
});

test('turnover: entered figure drives the ₹2 crore optional rule', () => {
  seed();
  assert.equal(build({ turnover: GSTR9_OPTIONAL_LIMIT }).turnover.optional, true);
  const big = build({ turnover: GSTR9_OPTIONAL_LIMIT + 1 });
  assert.equal(big.turnover.optional, false);
  assert.equal(big.turnover.used, GSTR9_OPTIONAL_LIMIT + 1);
  assert.ok(big.notes.some((x) => /mandatory/.test(x)));
});

test('empty year: every table is zero, nothing throws', () => {
  const g = buildGstr9([], [], { fyStart: FY });
  assert.equal(r(g.table4, '4N').taxable, 0);
  assert.equal(r(g.table6, '6A').igst, 0);
  assert.equal(g.table17.length, 0);
  assert.equal(g.turnover.optional, true);
});

test('exports: CSV is formula-guarded, HTML escapes, JSON keeps the disclaimer', () => {
  seed();
  const g = build();
  const csv = gstr9Csv(g);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`), 'formula in a description is neutralised');
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv));
  assert.ok(csv.includes('Table 9 - Tax paid'));
  assert.ok(csv.endsWith('\r\n'));
  const html = buildGstr9Html(g, 'Mr <Chartist>');
  assert.ok(html.includes('&lt;b&gt;Bold&lt;/b&gt; &amp; co'));
  assert.ok(html.includes('Mr &lt;Chartist&gt;'));
  assert.ok(!html.includes('<b>Bold'));
  assert.ok(html.includes('Verify with your CA'));
  const json = gstr9WorkingPaper(g) as { disclaimer: string; pt_ii: { table4: Record<string, { txval: number }> }; fp: string };
  assert.match(json.disclaimer, /Verify with your CA/);
  assert.equal(json.pt_ii.table4['4B'].txval, 15000);
  assert.equal(json.fp, '032026');
  assert.doesNotThrow(() => JSON.stringify(json));
});

test('filer GSTIN filter: another profile’s invoices are left out', () => {
  seed();
  const other = gstin('29AABCU9603R1Z');
  assert.equal(r(buildGstr9(getTable<InvoiceRecord>('invoices'), [], { fyStart: FY, gstin: other }).table4, '4B').taxable, 0);
  assert.ok(localDb.invoices.getAll().length > 10);
});
