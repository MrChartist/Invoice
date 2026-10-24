import { resetStorage } from './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionId,
  billFromLine,
  bookBills,
  effectiveAction,
  gstr2bActionsDb,
  itcEffect,
  matchGstr2b,
  normBillNo,
  parse2bDate,
  parseGstr2bJson,
  parseGstr2bWorkbook,
  worksheetRows,
  type Gstr2bLine,
} from '../src/lib/gstr2b.ts';
import { gstinChecksumChar } from '../src/lib/gstin.ts';
import { buildGstReport, periodRange, type ReportPeriod } from '../src/lib/gst-reports.ts';
import { readXlsx, writeXlsx } from '../src/lib/xlsx.ts';
import { validateBackupData } from '../src/lib/backup.ts';

const gstin = (first14: string) => first14 + gstinChecksumChar(first14);
const ME = gstin('27MEMEM1234M1Z'); // filer, Maharashtra
const SUP_A = gstin('27AAAAA1111A1Z'); // intra-state supplier
const SUP_B = gstin('29BBBBB2222B1Z'); // inter-state supplier
const SUP_C = gstin('27CCCCC3333C1Z');
const SUP_D = gstin('24DDDDD4444D1Z');
const ISD = gstin('27IIIII5555I1Z');

const PERIOD: ReportPeriod = { kind: 'month', fyStart: 2026, month: 5 } as ReportPeriod;

/** Realistic GSTR-2B JSON (portal "docdata" layout). */
const fixture = {
  chksum: 'x',
  data: {
    gstin: ME,
    rtnprd: '052026',
    version: '1.0',
    gendt: '14-06-2026',
    docdata: {
      b2b: [
        {
          ctin: SUP_A, trdnm: 'Alpha Traders', supprd: '052026', supfildt: '11-06-2026',
          inv: [
            // matched (bill typed as "A/0042" in books)
            { inum: 'INV-042', typ: 'R', dt: '10-05-2026', val: 11800, pos: '27', rev: 'N', itcavl: 'Y', rsn: '', items: [{ num: 1, rt: 18, txval: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0 }] },
            // value mismatch: books has 1000 taxable / 180 tax, 2B 1200 / 216
            { inum: 'INV-043', typ: 'R', dt: '12-05-2026', val: 1416, pos: '27', rev: 'N', itcavl: 'Y', items: [{ rt: 18, txval: 1200, cgst: 108, sgst: 108 }] },
            // ITC not available
            { inum: 'INV-044', dt: '13-05-2026', val: 590, pos: '27', rev: 'N', itcavl: 'N', rsn: 'P', items: [{ rt: 18, txval: 500, cgst: 45, sgst: 45 }] },
          ],
        },
        {
          ctin: SUP_B, trdnm: 'Bravo Pvt Ltd',
          // multi-rate invoice, 2A-style itms/itm_det; missing in books
          inv: [{ inum: '0007', dt: '20-05-2026', val: 1680, pos: '27', rev: 'N', itcavl: 'Y', itms: [
            { num: 1, itm_det: { rt: 12, txval: 500, iamt: 60 } },
            { num: 2, itm_det: { rt: 18, txval: 1000, iamt: 180 } },
          ] }],
        },
        {
          ctin: SUP_C, trdnm: 'Charlie & Co',
          // books has it with a differently typed number → value-only fallback match ("number")
          inv: [{ inum: 'CC/2026/88', dt: '05-05-2026', val: 2360, pos: '27', rev: 'N', itcavl: 'Y', txval: 2000, cgst: 180, sgst: 180, cess: 0 }],
        },
      ],
      b2ba: [
        { ctin: SUP_D, trdnm: 'Delta', inv: [{ oinum: 'D-1', oidt: '01-04-2026', inum: 'D-1A', dt: '02-05-2026', val: 1180, pos: '27', rev: 'N', itcavl: 'Y', items: [{ rt: 18, txval: 1000, igst: 180 }] }] },
      ],
      cdnr: [
        { ctin: SUP_A, trdnm: 'Alpha Traders', nt: [{ ntnum: 'CN-5', typ: 'C', suptyp: 'R', dt: '25-05-2026', val: 118, pos: '27', rev: 'N', itcavl: 'Y', items: [{ rt: 18, txval: 100, cgst: 9, sgst: 9 }] }] },
      ],
      cdnra: [],
      isd: [{ ctin: ISD, trdnm: 'HO', doclist: [{ doctyp: 'ISD', docnum: 'ISD-1', docdt: '31-05-2026', igst: 50, cgst: 0, sgst: 0, cess: 0, itcelg: 'Y' }] }],
      impg: [{ refdt: '15-05-2026', portcode: 'INNSA1', boenum: '1234567', boedt: '14-05-2026', isamd: 'N', txval: 50000, igst: 9000, cess: 0 }],
      ecom: [{ ctin: 'x' }],
    },
  },
};

const bill = (over: Record<string, unknown>) => ({
  kind: 'PURCHASE', vendor_name: 'V', category: 'Purchases', lines: [], itc_eligible: true, amount_paid: 0, ...over,
});

const purchases = [
  bill({ id: 'p1', vendor_gstin: SUP_A, bill_number: 'inv 0042', date: '2026-05-10', taxable: 10000, cgst: 900, sgst: 900, igst: 0, total: 11800 }),
  bill({ id: 'p2', vendor_gstin: SUP_A, bill_number: 'INV/043', date: '2026-05-12', taxable: 1000, cgst: 90, sgst: 90, igst: 0, total: 1180 }),
  bill({ id: 'p3', vendor_gstin: SUP_A, bill_number: 'INV-044', date: '2026-05-13', taxable: 500, cgst: 45, sgst: 45, igst: 0, total: 590 }),
  bill({ id: 'p4', vendor_gstin: SUP_C, bill_number: '88', date: '2026-05-06', taxable: 2000, cgst: 180, sgst: 180, igst: 0, total: 2360 }),
  // in books only: supplier never uploaded it
  bill({ id: 'p5', vendor_gstin: SUP_C, bill_number: 'CC-90', date: '2026-05-20', taxable: 3000, cgst: 270, sgst: 270, igst: 0, total: 3540 }),
  // amended invoice in books under its new number, IGST
  bill({ id: 'p6', vendor_gstin: SUP_D, bill_number: 'D1A', date: '2026-05-02', taxable: 1000, cgst: 0, sgst: 0, igst: 180, total: 1180 }),
  // import of goods on a Bill of Entry
  bill({ id: 'p7', vendor_name: 'Overseas', bill_number: 'EXP-1', date: '2026-05-14', taxable: 50000, igst: 9000, cgst: 0, sgst: 0, total: 59000, import_type: 'GOODS', boe_number: '1234567' }),
  // never reported: draft, no-GSTIN, other month, not claiming ITC
  bill({ id: 'p8', vendor_gstin: SUP_C, bill_number: 'DR-1', date: '2026-05-21', taxable: 100, cgst: 9, sgst: 9, igst: 0, total: 118, status: 'draft' }),
  bill({ id: 'p9', vendor_name: 'Local shop', bill_number: 'L-1', date: '2026-05-21', taxable: 100, cgst: 9, sgst: 9, igst: 0, total: 118 }),
  bill({ id: 'p10', vendor_gstin: SUP_C, bill_number: 'OLD-1', date: '2026-04-21', taxable: 100, cgst: 9, sgst: 9, igst: 0, total: 118 }),
  bill({ id: 'p11', vendor_gstin: SUP_C, bill_number: 'NOITC', date: '2026-05-22', taxable: 100, cgst: 9, sgst: 9, igst: 0, total: 118, itc_eligible: false }),
];

test('bill-number normalisation: case, spaces, separators, leading zeros of every digit run', () => {
  assert.equal(normBillNo('INV/2024-25/0042'), 'INV20242542');
  assert.equal(normBillNo(' inv 2024 25 42 '), 'INV20242542');
  assert.equal(normBillNo('0007'), '7');
  assert.equal(normBillNo('A.B_C#001'), 'ABC1');
  assert.equal(normBillNo('INV-042'), normBillNo('inv 0042'));
  assert.equal(normBillNo('100'), '100', 'zeros inside a number are kept');
  assert.equal(normBillNo('INV\\10'), 'INV10');
  assert.notEqual(normBillNo('INV-1'), normBillNo('INV-10'));
});

test('2B dates parse as local calendar days', () => {
  assert.equal(parse2bDate('01-04-2026'), '2026-04-01');
  assert.equal(parse2bDate('1/4/2026'), '2026-04-01');
  assert.equal(parse2bDate('2026-04-01'), '2026-04-01');
  assert.equal(parse2bDate('01-Apr-2026'), '2026-04-01');
  assert.equal(parse2bDate('31-02-2026'), '');
  assert.equal(parse2bDate(''), '');
});

test('JSON: every section parsed with the assumed field names', () => {
  const d = parseGstr2bJson(fixture);
  assert.equal(d.gstin, ME);
  assert.equal(d.period, '052026');
  assert.equal(d.generatedOn, '14-06-2026');
  const by = (n: string) => d.lines.find((l) => l.number === n) as Gstr2bLine;
  assert.equal(d.lines.length, 9);
  assert.deepEqual(
    { s: by('INV-042').section, ctin: by('INV-042').ctin, date: by('INV-042').date, tx: by('INV-042').taxable, c: by('INV-042').cgst, name: by('INV-042').tradeName, sp: by('INV-042').supplierPeriod },
    { s: 'B2B', ctin: SUP_A, date: '2026-05-10', tx: 10000, c: 900, name: 'Alpha Traders', sp: '052026' },
  );
  assert.equal(by('INV-044').itcAvailable, false);
  assert.equal(by('INV-044').reason, 'P');
  assert.deepEqual([by('0007').taxable, by('0007').igst], [1500, 240], 'items summed across rates (itm_det / iamt)');
  assert.deepEqual([by('CC/2026/88').taxable, by('CC/2026/88').cgst], [2000, 180], 'invoice-level figures when there are no items');
  assert.deepEqual([by('D-1A').section, by('D-1A').originalNumber, by('D-1A').originalDate], ['B2BA', 'D-1', '2026-04-01']);
  assert.deepEqual([by('CN-5').section, by('CN-5').docType, by('CN-5').sign], ['CDNR', 'CN', -1]);
  assert.deepEqual([by('ISD-1').section, by('ISD-1').igst, by('ISD-1').ctin], ['ISD', 50, ISD]);
  assert.deepEqual([by('1234567').section, by('1234567').ctin, by('1234567').igst, by('1234567').date], ['IMPG', '', 9000, '2026-05-14']);
  assert.ok(d.warnings.some((w) => /ecom/.test(w)), 'unknown sections are reported');
  // Tolerant of other wrappers and junk.
  assert.equal(parseGstr2bJson(fixture.data.docdata).lines.length, 9);
  assert.equal(parseGstr2bJson({ docdata: fixture.data.docdata }).lines.length, 9);
  assert.equal(parseGstr2bJson(null).lines.length, 0);
  assert.ok(parseGstr2bJson({ foo: 1 }).warnings.some((w) => /No documents/.test(w)));
});

test('matcher: every class, books-only limited to the period and to bills the supplier must report', () => {
  const d = parseGstr2bJson(fixture);
  const bills = bookBills(purchases, '27');
  const range = periodRange(PERIOD);
  const m = matchGstr2b(d, bills, { period: range });
  const row = (k: string) => m.rows.find((r) => r.line?.number === k || r.key === `BOOKS|${k}`);
  assert.equal(row('INV-042')?.cls, 'matched');
  assert.equal(row('INV-042')?.bill?.id, 'p1');
  assert.equal(row('INV-043')?.cls, 'mismatch');
  assert.deepEqual(row('INV-043')?.diffs, ['taxable', 'tax']);
  assert.equal(row('INV-043')?.taxDiff, 36);
  assert.equal(row('INV-044')?.cls, 'itc_unavailable');
  assert.equal(row('INV-044')?.bill?.id, 'p3', 'still linked to its bill');
  assert.equal(row('0007')?.cls, 'missing_in_books');
  assert.equal(row('CC/2026/88')?.cls, 'mismatch');
  assert.deepEqual(row('CC/2026/88')?.diffs, ['number'], 'matched on GSTIN + value + date, number differs');
  assert.equal(row('D-1A')?.cls, 'matched', 'amendment matched under its revised number');
  assert.equal(row('CN-5')?.cls, 'missing_in_books');
  assert.equal(row('ISD-1')?.cls, 'missing_in_books');
  assert.equal(row('1234567')?.cls, 'matched', 'IMPG matched on the Bill of Entry number');
  assert.equal(row('1234567')?.bill?.id, 'p7');
  assert.equal(row('p5')?.cls, 'not_in_2b');
  for (const id of ['p8', 'p9', 'p10', 'p11']) assert.equal(row(id), undefined, `${id} is not expected in 2B`);
  assert.deepEqual(m.counts, { matched: 3, mismatch: 2, missing_in_books: 3, not_in_2b: 1, itc_unavailable: 1 });

  // Tolerances: ₹1 rounding passes, a date 10 days off is flagged.
  const near = matchGstr2b(
    { lines: [{ ...d.lines[0], cgst: 900.4, date: '2026-05-20' }] },
    bills,
  );
  assert.deepEqual(near.rows[0].diffs, ['date']);
  // IGST charged where the books have CGST+SGST → heads mismatch.
  const heads = matchGstr2b({ lines: [{ ...d.lines[0], cgst: 0, sgst: 0, igst: 1800 }] }, bills);
  assert.deepEqual(heads.rows[0].diffs, ['heads']);
});

test('IMS actions are stored per period + section + GSTIN + normalised number; 3B 4A(5) comparison', () => {
  resetStorage();
  const d = parseGstr2bJson(fixture);
  const bills = bookBills(purchases, '27');
  const range = periodRange(PERIOD);
  const m = matchGstr2b(d, bills, { period: range });
  const line = (n: string) => d.lines.find((l) => l.number === n) as Gstr2bLine;

  // Books 4A(5) here equals what the GSTR-3B report shows.
  const g3 = buildGstReport([], purchases, { period: PERIOD, gstin: ME }).gstr3b;
  let eff = itcEffect(m, bills, gstr2bActionsDb.forPeriod('052026'), '052026', range);
  assert.deepEqual(eff.books, { igst: g3.itc.availableOther.igst, cgst: g3.itc.availableOther.cgst, sgst: g3.itc.availableOther.sgst });
  assert.deepEqual(eff.books, { igst: 180, cgst: 1494, sgst: 1494 }); // incl. p9 (no GSTIN, still claimed in books)
  // Deemed accepted: matched p1 (900/900), mismatch p2 (min 90/90), p4 by value (180/180), p6 (IGST 180). p3 ITC not available, p5 not in 2B.
  assert.deepEqual(eff.restricted, { igst: 180, cgst: 1170, sgst: 1170 });
  assert.deepEqual(eff.atRisk, { igst: 0, cgst: 324, sgst: 324 });
  // 2B's own 4A(5): B2B 900+108+180(C) / 0007 IGST 240 + D-1A 180, less CN 9/9; ISD and IMPG excluded; INV-044 unavailable.
  assert.deepEqual(eff.per2b, { igst: 420, cgst: 1179, sgst: 1179 });

  gstr2bActionsDb.set('052026', line('INV-042'), 'REJECT', 'goods returned');
  gstr2bActionsDb.set('052026', line('INV-043'), 'PENDING');
  gstr2bActionsDb.set('052026', line('INV-043'), 'ACCEPT'); // replaces
  gstr2bActionsDb.set('052026', line('CC/2026/88'), 'PENDING');
  gstr2bActionsDb.set('042026', line('INV-042'), 'ACCEPT'); // another period: separate row
  assert.equal(gstr2bActionsDb.all().length, 4);
  const acts = gstr2bActionsDb.forPeriod('052026');
  assert.equal(acts.size, 3);
  assert.equal(actionId('052026', line('INV-042')), `052026|B2B|${SUP_A}|INV42`);
  assert.equal(effectiveAction(acts, '052026', line('INV-042')), 'REJECT');
  assert.equal(effectiveAction(acts, '052026', line('0007')), 'ACCEPT', 'no action = deemed accepted');

  eff = itcEffect(m, bills, acts, '052026', range);
  assert.deepEqual(eff.restricted, { igst: 180, cgst: 90, sgst: 90 });
  assert.equal(eff.rejected, 1);
  assert.equal(eff.pending, 1);

  // Worksheet export carries the decisions and the books-only rows.
  const ws = worksheetRows(m, acts, '052026');
  assert.equal(ws.length, m.rows.length + 1);
  const r42 = ws.find((r) => r[3] === 'INV-042') ?? [];
  assert.equal(r42[20], 'Reject');
  assert.equal(r42[21], 'goods returned');
  assert.equal(ws.find((r) => r[3] === '0007')?.[20], 'No action (deemed accepted)');
  assert.equal(ws.find((r) => r[3] === 'CN-5')?.[6], -100, 'credit notes exported negative');
  assert.equal(ws.find((r) => r[0] === 'BOOKS')?.[15], 'CC-90');

  gstr2bActionsDb.clear('052026', line('INV-042'));
  assert.equal(gstr2bActionsDb.forPeriod('052026').size, 2);
});

test('Excel 2B: two-row headers, rows per rate summed, title block gives GSTIN and period', async () => {
  const head1 = ['GSTIN of supplier', 'Trade/Legal name', 'Invoice details', '', '', '', 'Place of supply', 'Supply Attract Reverse Charge', 'Taxable Value (₹)', 'Tax Amount', '', '', '', 'GSTR-1/IFF/GSTR-5 Period', 'GSTR-1/IFF/GSTR-5 Filing Date', 'ITC Availability', 'Reason', 'Applicable % of Tax Rate', 'Source', 'IRN', 'IRN Date'];
  const head2 = ['', '', 'Invoice number', 'Invoice type', 'Invoice Date', 'Invoice Value(₹)', '', '', '', 'Integrated Tax(₹)', 'Central Tax(₹)', 'State/UT Tax(₹)', 'Cess(₹)'];
  const bytes = await writeXlsx([
    { name: 'Read me', rows: [['Goods and Services Tax - GSTR-2B'], ['Financial Year', '2026-27'], ['Tax Period', 'May'], [`GSTIN : ${ME}`]], header: false },
    {
      name: 'B2B',
      header: false,
      rows: [
        ['Taxpayer\'s GSTIN', ME],
        ['Goods and Services Tax - GSTR-2B'],
        head1,
        head2,
        [SUP_A, 'Alpha Traders', 'INV-042', 'Regular', '10-05-2026', '11,800.00', '27-Maharashtra', 'No', 5000, 0, 450, 450, 0, 'May 2026', '11-06-2026', 'Yes', '', '', '', '', ''],
        [SUP_A, 'Alpha Traders', 'INV-042', 'Regular', '10-05-2026', '11,800.00', '27-Maharashtra', 'No', 5000, 0, 450, 450, 0, 'May 2026', '11-06-2026', 'Yes'],
        [SUP_B, 'Bravo', '0007', 'Regular', '20-05-2026', 1680, '27-Maharashtra', 'No', 1500, 240, 0, 0, 0, '', '', 'No', 'POS and supplier state are same but recipient state is different'],
        ['Total', '', '', '', '', '', '', '', 11500],
      ],
    },
    {
      name: 'B2B-CDNR',
      header: false,
      rows: [
        ['GSTIN of supplier', 'Trade/Legal name', 'Credit note/Debit note details', '', '', '', '', 'Place of supply', 'Supply Attract Reverse Charge', 'Taxable Value (₹)', 'Tax Amount'],
        ['', '', 'Note number', 'Note type', 'Note Supply type', 'Note date', 'Note Value (₹)', '', '', '', 'Integrated Tax(₹)', 'Central Tax(₹)', 'State/UT Tax(₹)', 'Cess(₹)'],
        [SUP_A, 'Alpha', 'CN-5', 'Credit Note', 'Regular', '25-05-2026', 118, '27-Maharashtra', 'No', 100, 0, 9, 9, 0],
      ],
    },
  ]);
  const d = parseGstr2bWorkbook(await readXlsx(bytes));
  assert.equal(d.source, 'xlsx');
  assert.equal(d.gstin, ME);
  assert.equal(d.period, '052026');
  assert.equal(d.lines.length, 3);
  const a = d.lines.find((l) => l.number === 'INV-042') as Gstr2bLine;
  assert.deepEqual([a.taxable, a.cgst, a.sgst, a.value, a.pos, a.date, a.itcAvailable], [10000, 900, 900, 11800, '27', '2026-05-10', true]);
  const b = d.lines.find((l) => l.number === '0007') as Gstr2bLine;
  assert.deepEqual([b.igst, b.itcAvailable], [240, false]);
  assert.match(b.reason, /POS/);
  const cn = d.lines.find((l) => l.number === 'CN-5') as Gstr2bLine;
  assert.deepEqual([cn.section, cn.sign, cn.cgst], ['CDNR', -1, 9]);
  assert.ok(d.warnings.some((w) => /combined/.test(w)));

  const none = parseGstr2bWorkbook(await readXlsx(await writeXlsx([{ name: 'Sheet1', rows: [['a']] }])));
  assert.equal(none.lines.length, 0);
  assert.ok(none.warnings.some((w) => /No "B2B" sheet/.test(w)));
});

test('create a purchase bill from a 2B line', () => {
  const d = parseGstr2bJson(fixture);
  const b = billFromLine(d.lines.find((l) => l.number === '0007') as Gstr2bLine, 'v1');
  assert.equal(b.vendor_gstin, SUP_B);
  assert.equal(b.vendor_id, 'v1');
  assert.equal(b.bill_number, '0007');
  assert.equal(b.date, '2026-05-20');
  assert.deepEqual([b.taxable, b.igst, b.cgst, b.sgst, b.total], [1500, 240, 0, 0, 1740]);
  assert.equal(b.lines.length, 1);
  assert.equal(b.lines[0].tax_rate, 16);
  assert.equal(b.itc_eligible, true);
  const imp = billFromLine(d.lines.find((l) => l.section === 'IMPG') as Gstr2bLine);
  assert.deepEqual([imp.import_type, imp.boe_number, imp.boe_date], ['GOODS', '1234567', '2026-05-14']);
});

test('backup validation covers the gstr2b_actions table', () => {
  assert.throws(() => validateBackupData({ mrchartist_inv_gstr2b_actions: '{"not":"a list"}' }), /gstr2b_actions/);
  assert.doesNotThrow(() => validateBackupData({ mrchartist_inv_gstr2b_actions: '[{"id":"052026|B2B|X|1","action":"ACCEPT"}]' }));
});
