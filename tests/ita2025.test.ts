/**
 * Income-tax Act 2025 references (R5 §7 Q1): labels follow the document date — 31 Mar 2026 shows the 1961 code,
 * 1 Apr 2026 the 2025-Act reference with the old code in brackets. Stored codes never change; exports are
 * labelled with the form valid for their period.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACT_REF_RULES, ACT_WORDS_PRINT, FORM_REF_RULES, ITA2025_FROM, actKey, actRef, formRef, formText, oldCodeOf,
  periodStart, quarterStart, sectionText, withActRef,
} from '../src/lib/ita2025.ts';
import { TDS_PAYABLE_SECTIONS } from '../src/lib/tds-rules.ts';
import { tdsSections, tcsPresets } from '../src/lib/tax-rules.ts';
import { form16ACsv, form26Q, paperCsv, paperSheets, paperText, form27EQ, type TcsRow } from '../src/lib/tds-returns.ts';
import { form27Q, form27QCsv } from '../src/lib/tds-27q.ts';
import { sectionCode } from '../src/lib/tds-register.ts';
import type { TdsDeductionRow } from '../src/lib/tds-payables.ts';

const OLD = '2026-03-31';
const NEW = '2026-04-01';

/** Every stored code the app offers, with its 1961 label and the 2025-Act reference expected from 1 Apr 2026. */
const EXPECTED: [code: string, old1961: string, ref2025: string, verified: boolean][] = [
  ['192', '192', 'Sec 392(1)', true],
  ['194C-1', '194C', 'Sec 393(1) [Table: Sl. No. 6(i)]', true],
  ['194C-2', '194C', 'Sec 393(1) [Table: Sl. No. 6(i)]', true],
  ['194J', '194J', 'Sec 393(1) [Table: Sl. No. 6(iii)]', false],
  ['194J-T', '194J', 'Sec 393(1) [Table: Sl. No. 6(iii)]', false],
  ['194I-A', '194-I', 'Sec 393(1) [Table: Sl. No. 2(ii)]', false],
  ['194I-B', '194-I', 'Sec 393(1) [Table: Sl. No. 2(ii)]', false],
  ['194H', '194H', 'Sec 393(1) [Table: Sl. No. 1(ii)]', false],
  ['194Q', '194Q', 'Sec 393(1) [Table: Sl. No. 8(ii)]', false],
  ['194A', '194A', 'Sec 393(1) [Table: Sl. No. 5(iii)]', false],
  ['194O', '194-O', 'Sec 393(1) [Table: Sl. No. 8(v)]', false],
  ['194R', '194R', 'Sec 393(1) [Table: Sl. No. 8(iv)]', false],
  ['194S', '194S', 'Sec 393(1) [Table: Sl. No. 8(vi)]', false],
  ['195-R', '195', 'Sec 393(2) [Table: Sl. No. 17]', false],
  ['195-F', '195', 'Sec 393(2) [Table: Sl. No. 17]', false],
  ['195-I', '195', 'Sec 393(2) [Table: Sl. No. 17]', false],
  ['195-O', '195', 'Sec 393(2) [Table: Sl. No. 17]', false],
  ['206C(1G) overseas remittance 20%', '206C(1G)', 'Sec 394(1) [Table: Sl. No. 7]', false],
];

test('every app TDS / TCS code is mapped', () => {
  for (const s of TDS_PAYABLE_SECTIONS) assert.ok(actKey(s.code), `payable ${s.code}`);
  for (const s of tdsSections(NEW)) if (s.section !== 'CUSTOM') assert.ok(actKey(s.section), `receivable ${s.section}`);
  for (const p of tcsPresets('2024-04-01')) assert.ok(actKey(p.label), `tcs ${p.label}`);
  for (const [code] of EXPECTED) assert.ok(actKey(code), code);
});

test('31 Mar 2026 shows the 1961 reference, 1 Apr 2026 the 2025-Act reference', () => {
  for (const [code, old, ref, verified] of EXPECTED) {
    const before = actRef(code, OLD);
    assert.equal(before.act, 1961, code);
    assert.equal(before.ref, old, code);
    const after = actRef(code, NEW);
    assert.deepEqual(after, { act: 2025, ref, old, verified }, code);
    // Labels: the stored code itself before; the reference + [old code] (+ caveat) after.
    assert.equal(sectionText(code, OLD), code);
    const label = sectionText(code, NEW);
    assert.ok(label.startsWith(ref), label);
    assert.ok(label.includes(`[old ${old}]`), label);
    assert.equal(label.includes('verify with your CA'), !verified, label);
  }
});

test('labels examples', () => {
  assert.equal(sectionText('194C-2', NEW), 'Sec 393(1) [Table: Sl. No. 6(i)] [old 194C]');
  assert.equal(sectionText('194J', NEW), 'Sec 393(1) [Table: Sl. No. 6(iii)] [old 194J] (verify with your CA)');
  assert.equal(sectionText('194J', NEW, ACT_WORDS_PRINT), 'Sec 393(1) [Table: Sl. No. 6(iii)] [old 194J]');
  assert.equal(sectionText('194J-T', OLD), '194J-T');
  assert.equal(withActRef('194C Contractor — others', '194C-2', OLD), '194C Contractor — others');
  assert.equal(withActRef('194C Contractor — others', '194C-2', NEW), 'Sec 393(1) [Table: Sl. No. 6(i)] [old 194C] · 194C Contractor — others');
  // Unknown / custom codes pass through on both sides.
  assert.equal(sectionText('CUSTOM', NEW), 'CUSTOM');
  assert.equal(sectionText('', NEW), '');
  // 206C(1H) was omitted from 1 Apr 2025: no 2025-Act reference, keeps its 1961 label.
  assert.equal(actRef('206C(1H) sale of goods', NEW).act, 1961);
});

test('forms follow the period date', () => {
  const forms: [keyof typeof FORM_REF_RULES, string][] = [
    ['24Q', '138'], ['26Q', '140'], ['27Q', '144'], ['27EQ', '143'], ['16', '130'], ['16A', '131'], ['27D', '133'],
    ['26AS', '168'], ['10BD', '113'], ['10BE', '114'], ['15G/15H', '121'], ['26QB-QE', '141'],
  ];
  for (const [f, n] of forms) {
    assert.equal(formText(f, OLD), `Form ${f}`, f);
    assert.equal(formRef(f, NEW).ref, n, f);
    assert.ok(formText(f, NEW).startsWith(`Form ${n} [old ${f}]`), formText(f, NEW));
  }
  assert.equal(formText('26Q', NEW), 'Form 140 [old 26Q]');
  assert.equal(formText('27EQ', NEW), 'Form 143 [old 27EQ] (verify with your CA)');
  assert.equal(quarterStart(2025, 4), '2026-01-01');
  assert.equal(quarterStart(2026, 1), ITA2025_FROM);
  assert.equal(periodStart('2026-Q1'), ITA2025_FROM);
  assert.equal(periodStart('2026-03'), '2026-03-01');
});

test('rule tables are append-only: the 1961 entry stays first and the 2025 entry starts on 1 Apr 2026', () => {
  for (const [k, v] of Object.entries(ACT_REF_RULES)) {
    assert.equal(v[0].value.act, 1961, k);
    for (let i = 1; i < v.length; i++) assert.ok(v[i].from > v[i - 1].from, k);
    if (v.length > 1) assert.equal(v[1].from, ITA2025_FROM, k);
  }
});

test('AIS / Form 168 section text maps back to the 1961 family for matching', () => {
  assert.equal(oldCodeOf('393(1) [Table: Sl. No. 6(iii)]'), '194J');
  assert.equal(oldCodeOf('Sec 393(1) Table Sl. No. 6(i)'), '194C');
  assert.equal(oldCodeOf('Section 392'), '192');
  assert.equal(oldCodeOf('194J - Fees'), '');
  assert.equal(sectionCode('393(1) [Table: Sl. No. 2(ii)]'), '194I');
  assert.equal(sectionCode('194J - Fees for professional services'), '194J');
});

function row(over: Partial<TdsDeductionRow>): TdsDeductionRow {
  return {
    key: 'bill:1', source: 'bill', payee: 'Acme', payeeKey: 'pan:AAAPA1234A', pan: 'AAAPA1234A', deducteeType: 'INDIVIDUAL',
    code: '194C-1', section: '194C', rpu: '94C', billNumber: 'B1', base: 100000, rate: 1, amount: 1000,
    creditedOn: OLD, deductedOn: OLD, reason: '', certNo: '', nonResident: false, fy: 2025, quarter: 4, ...over,
  };
}

test('exports: 26Q / 16A of Q4 FY 2025-26 keep the 1961 names; Q1 FY 2026-27 is Form 140 with references', () => {
  const oldRow = row({});
  const newRow = row({ key: 'bill:2', creditedOn: NEW, deductedOn: NEW, fy: 2026, quarter: 1 });
  const before = form26Q([oldRow], [], 2025, 4);
  assert.equal(before.form, '26Q');
  assert.equal(before.formLabel, 'Form 26Q');
  assert.deepEqual(before.refs, []);
  assert.ok(paperCsv(before).includes('Form 26Q'));
  assert.ok(!paperCsv(before).includes('393'));

  const after = form26Q([newRow], [], 2026, 1);
  assert.equal(after.form, '26Q', 'stored key unchanged');
  assert.equal(after.formLabel, 'Form 140 [old 26Q]');
  assert.deepEqual(after.refs, [['1023', 'Sec 393(1) [Table: Sl. No. 6(i)] [old 194C]']]);
  assert.equal(after.deducteeRows[1][2], '1023', '23b: 2025-Act RPU code (Protean file format v1.2), column order unchanged');
  const csv = paperCsv(after);
  assert.ok(csv.includes('Form 140 [old 26Q]'));
  assert.ok(csv.includes('Section references (Income-tax Act 2025)'));
  assert.ok(paperText(after).includes('# Form 140 [old 26Q]'));
  assert.ok(paperSheets(after).some((s) => s.name === 'Section references'));
  assert.ok(after.warnings.some((w) => w.includes('Income-tax Act 2025')));

  // Form 16A data: certificate name and section column follow the period / credit date.
  const f16 = form16ACsv([{ payeeKey: 'p', payee: 'Acme', pan: '', fy: 2026, quarter: 1, period: { from: NEW, to: '2026-06-30' }, rows: [{ code: '194J', date: NEW, paid: 1, tds: 1, deposited: false }], totalPaid: 1, totalTds: 1, challans: [] }]);
  assert.ok(f16.includes('Form 131 [old 16A]'));
  assert.ok(f16.includes('Sec 393(1) [Table: Sl. No. 6(iii)] [old 194J]'));
  const f16old = form16ACsv([{ payeeKey: 'p', payee: 'Acme', pan: '', fy: 2025, quarter: 4, period: { from: '2026-01-01', to: OLD }, rows: [{ code: '194J', date: OLD, paid: 1, tds: 1, deposited: false }], totalPaid: 1, totalTds: 1, challans: [] }]);
  assert.ok(f16old.includes('Form 16A data'));
  assert.ok(!f16old.includes('393'));
});

test('exports: 27EQ and 27Q follow the period', () => {
  const tcs = (date: string, fy: number, quarter: 1 | 4): TcsRow => ({
    key: `tcs:${date}`, invoiceId: 'i', docNumber: 'INV/1', collectee: 'Buyer', payeeKey: 'b', pan: '', deducteeType: 'OTHER',
    code: '6CQ', label: 'TCS', base: 100, rate: 20, amount: 20, creditedOn: date, deductedOn: date, fy, quarter,
  });
  assert.equal(form27EQ([tcs(OLD, 2025, 4)], [], 2025, 4).formLabel, 'Form 27EQ');
  const p = form27EQ([tcs(NEW, 2026, 1)], [], 2026, 1);
  assert.equal(p.formLabel, 'Form 143 [old 27EQ] (verify with your CA)');
  assert.deepEqual(p.refs, [['6CQ', 'Sec 394(1) [Table: Sl. No. 7] [old 206C(1G)] (verify with your CA)']]);

  const nr = row({ key: 'bill:3', code: '195-R', section: '195', rpu: '195', nonResident: true, creditedOn: NEW, deductedOn: NEW, fy: 2026, quarter: 1 });
  const q = form27Q([nr], [], [], 2026, 1);
  assert.equal(q.form, '27Q');
  assert.equal(q.formLabel, 'Form 144 [old 27Q]');
  assert.ok(form27QCsv(q).includes('Form 144 [old 27Q]'));
  assert.ok(q.warnings.some((w) => w.includes('Sec 393(2)')));
  assert.equal(form27Q([{ ...nr, creditedOn: OLD, fy: 2025, quarter: 4 }], [], [], 2025, 4).formLabel, 'Form 27Q');
});

test('R15-A4 (TV3): tour-package TCS is Sl. No. 8 (verified); LRS keeps Sl. No. 7; old codes parse as before', () => {
  for (const c of ['206C(1G) overseas tour package 5%', '206C1G-tour', 'TCS overseas tour programme package', '206C (1G) Tour package']) {
    assert.equal(actKey(c), '206C1G-tour', c);
  }
  assert.equal(actKey('206C(1G) overseas remittance 20%'), '206C1G');
  assert.equal(actKey('206C(1G)'), '206C1G');
  assert.equal(actKey('194J'), '194J');
  const tour = actRef('206C(1G) overseas tour package', NEW);
  assert.equal(tour.ref, 'Sec 394(1) [Table: Sl. No. 8]');
  assert.equal(tour.verified, true);
  assert.equal(tour.old, '206C(1G)');
  assert.equal(actRef('206C(1G) overseas tour package', OLD).ref, '206C(1G)');
  assert.equal(actRef('206C(1G) LRS', NEW).ref, 'Sec 394(1) [Table: Sl. No. 7]');
  assert.match(ACT_REF_RULES['206C1G-tour'][1].source ?? '', /Finance Bill 2026 cl\. 73\(f\)/);
});

test('stored codes are unchanged by labelling', () => {
  const codes = TDS_PAYABLE_SECTIONS.map((s) => s.code);
  for (const c of codes) {
    sectionText(c, NEW);
    withActRef('x', c, NEW);
  }
  assert.deepEqual(TDS_PAYABLE_SECTIONS.map((s) => s.code), codes);
  assert.ok(codes.includes('194C-1') && codes.includes('194I-A') && codes.includes('195-R'));
  const r = row({ creditedOn: NEW, fy: 2026, quarter: 1 });
  form26Q([r], [], 2026, 1);
  assert.equal(r.code, '194C-1');
  assert.equal(r.section, '194C');
});
