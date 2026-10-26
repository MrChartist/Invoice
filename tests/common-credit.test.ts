/** R5-C2: Rule 42 / 43 common-credit working, E / F from the GSTR-3B summary, posting and the annual true-up. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupR5c } from './helpers/r5c.ts';
import { setTable } from '../src/lib/storage.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { HEADS, defaultTrueUpDate, trueUpWindow, figuresOf, headsTotal, inputsFor, loadCcRuns, postReversal, reversalLines, rule42, trueUp, turnoverOf, unpostReversal, workingCsv } from '../src/lib/institutions/common-credit.ts';
import { A } from '../src/lib/ledger/accounts.ts';

beforeEach(() => setupR5c());

const bill = (id: string, date: string, h: { cgst?: number; sgst?: number; igst?: number }, extra: Record<string, unknown> = {}) => ({
  id, kind: 'EXPENSE', vendor_name: `V ${id}`, vendor_gstin: '27AAPFU0939F1ZV', bill_number: id, date, category: 'Rent',
  taxable: 1000, cgst: h.cgst ?? 0, sgst: h.sgst ?? 0, igst: h.igst ?? 0, itc_eligible: true, total: 1000 + (h.cgst ?? 0) + (h.sgst ?? 0) + (h.igst ?? 0), amount_paid: 0, ...extra,
});

const FIXTURE = [
  bill('A', '2026-05-03', { cgst: 450, sgst: 450 }),
  bill('B', '2026-05-04', { igst: 180 }, { itc_use: 'taxable_only' }),
  bill('C', '2026-05-05', { cgst: 50, sgst: 50 }, { itc_use: 'exempt_only' }),
  bill('D', '2026-05-06', { cgst: 25, sgst: 25 }, { itc_use: 'non_business' }),
  bill('E', '2026-05-07', { igst: 36 }, { itc_eligible: false }),
  bill('F', '2026-01-15', { igst: 6000 }, { itc_use: 'common_capital' }),
  bill('G', '2026-04-20', { cgst: 999, sgst: 999 }), // other month
  bill('H', '2026-05-08', { cgst: 9, sgst: 9 }, { status: 'draft' }),
];

test('Rule 42 / 43 worked example (T, T1–T4, E, F) — the formula figures by head', () => {
  const i = inputsFor(FIXTURE, '2026-05-01', '2026-05-31');
  assert.deepEqual(i.T, { igst: 216, cgst: 525, sgst: 525, cess: 0 });
  assert.equal(i.nonBusiness, true);
  const r = rule42(i, 20000, 100000, '2026-05');
  assert.deepEqual(r.C1, { igst: 180, cgst: 450, sgst: 450, cess: 0 });
  assert.deepEqual(r.C2, { igst: 0, cgst: 450, sgst: 450, cess: 0 });
  assert.deepEqual(r.D1, { igst: 0, cgst: 90, sgst: 90, cess: 0 });
  assert.deepEqual(r.D2, { igst: 0, cgst: 22.5, sgst: 22.5, cess: 0 });
  assert.deepEqual(r.C3, { igst: 0, cgst: 337.5, sgst: 337.5, cess: 0 });
  assert.equal(r.Tm.igst, 100, 'Rule 43: 6,000 ÷ 60 per month');
  assert.equal(r.Te.igst, 20);
  assert.deepEqual(r.reverse, { igst: 20, cgst: 187.5, sgst: 187.5, cess: 0 });
  assert.equal(figuresOf(r).reverse, 395);
  const csv = workingCsv(r, '2026-05', (k) => k, 'verify');
  assert.match(csv, /D1,D1,0,90,90,0,180/);
});

test('zero exempt turnover → no D1; Rule 43 stops after 60 months', () => {
  const r = rule42(inputsFor([FIXTURE[0], FIXTURE[5]], '2026-05-01', '2026-05-31'), 0, 50000, '2026-05');
  assert.equal(headsTotal(r.reverse), 0);
  const late = rule42(inputsFor([FIXTURE[5]], '2031-01-01', '2031-01-31'), 1, 2, '2031-01');
  assert.equal(late.Tm.igst, 0, '60 months after Jan 2026');
});

test('E / F: exports and zero-rated count as taxable turnover, nil / exempt / non-GST as exempt', () => {
  const t = turnoverOf({ outward: { taxable: { taxable: 50000 }, zeroRated: { taxable: 30000 }, nilExempt: { inter: 0, intra: 15000 }, nonGst: 5000 }, outwardRcmTaxable: 0 });
  assert.deepEqual(t, { E: 20000, F: 100000 });
});

test('posting: one balanced journal tagged "ITC reversal — Rule 42 / 43", once per month; undo deletes it', () => {
  const r = rule42(inputsFor(FIXTURE, '2026-05-01', '2026-05-31'), 20000, 100000, '2026-05');
  const lines = reversalLines(r.reverse);
  assert.equal(lines.reduce((s, l) => s + l.dr, 0), lines.reduce((s, l) => s + l.cr, 0));
  const run = postReversal({ month: '2026-05', kind: 'monthly', heads: r.reverse, figures: figuresOf(r), date: '2026-05-31' });
  const v = loadVouchers().find((x) => x.id === run.journal_id)!;
  assert.equal(v.voucher_class, 'ITC reversal — Rule 42 / 43');
  assert.equal(v.lines.find((l) => l.account_id === A.itcReversed)!.dr, 39500);
  assert.equal(v.lines.find((l) => l.account_id === A.inIgst)!.cr, 2000);
  assert.throws(() => postReversal({ month: '2026-05', kind: 'monthly', heads: r.reverse, figures: {}, date: '2026-05-31' }), /posted/);
  unpostReversal(run.id);
  assert.equal(loadCcRuns().length, 0);
  assert.equal(loadVouchers().length, 0);
});

test('GSTR-3B 4(B)(1): the posted reversal journal feeds the month through itcReversals (a reclaim reduces it)', async () => {
  const { buildGstReport, journalItcReversals } = await import('../src/lib/gst-reports.ts');
  const { getTable } = await import('../src/lib/storage.ts');
  const r = rule42(inputsFor(FIXTURE, '2026-05-01', '2026-05-31'), 20000, 100000, '2026-05');
  const g3 = (month: number) => buildGstReport([], [], { period: { kind: 'month', fyStart: 2026, month }, itcReversals: journalItcReversals(getTable('vouchers')) }).gstr3b.itc.reversedRules;
  assert.deepEqual(g3(5), { igst: 0, cgst: 0, sgst: 0, cess: 0 }, 'nothing before posting');
  const run = postReversal({ month: '2026-05', kind: 'monthly', heads: r.reverse, figures: figuresOf(r), date: '2026-05-31' });
  assert.deepEqual(g3(5), { igst: 20, cgst: 187.5, sgst: 187.5, cess: 0 });
  assert.deepEqual(g3(6), { igst: 0, cgst: 0, sgst: 0, cess: 0 }, 'only in its own month');
  postReversal({ month: 'FY2025-26', kind: 'annual', heads: { igst: 0, cgst: -50, sgst: -50, cess: 0 }, figures: {}, date: '2026-05-31' }); // last FY's true-up, in an open month (QA6 F8)
  assert.deepEqual(g3(5), { igst: 20, cgst: 137.5, sgst: 137.5, cess: 0 }, 'a true-up reclaim reduces 4B(1)');
  unpostReversal(run.id);
  assert.deepEqual(g3(5), { igst: 0, cgst: -50, sgst: -50, cess: 0 }, 'undoing the posting removes it');
  assert.deepEqual(journalItcReversals([{ date: '2026-05-31', voucher_class: 'Other', lines: [{ account_id: A.inCgst, dr: 0, cr: 100 }] }]), [], 'other journals are ignored');
});

test('annual true-up both ways: reverse more, or reclaim (journal flips)', () => {
  const months = [{ C2: { igst: 0, cgst: 1000, sgst: 1000, cess: 0 }, nonBusiness: false }, { C2: { igst: 0, cgst: 1000, sgst: 1000, cess: 0 }, nonBusiness: false }];
  const posted = { igst: 0, cgst: 200, sgst: 200, cess: 0 };
  const more = trueUp(months, 30000, 100000, posted, 2026);
  assert.deepEqual(more.diff, { igst: 0, cgst: 400, sgst: 400, cess: 0 });
  assert.equal(more.dueBy, '2027-10-20');
  const less = trueUp(months, 5000, 100000, posted, 2026);
  assert.deepEqual(less.diff, { igst: 0, cgst: -100, sgst: -100, cess: 0 });
  const back = reversalLines(less.diff);
  assert.ok(back.find((l) => l.account_id === A.itcReversed)!.cr === 20000 && back.every((l) => l.account_id === A.itcReversed || l.dr > 0));
  setTable('purchases', []);
  const run = postReversal({ month: 'FY2026-27', kind: 'annual', heads: less.diff, figures: {}, date: '2027-09-30' });
  assert.ok(run.journal_id);
  assert.equal(HEADS.length, 4);
});

test('QA6 F8: the annual true-up is dated in an open return month after the FY (by September), never in the closed year or a filed / locked period', async () => {
  const { journalItcReversals } = await import('../src/lib/gst-reports.ts');
  const { getTable } = await import('../src/lib/storage.ts');
  const { localDb } = await import('../src/lib/localDb.ts');
  const { COMPLIANCE_TABLE } = await import('../src/lib/compliance.ts');
  setTable('purchases', []);
  assert.deepEqual(trueUpWindow(2025), { from: '2026-04-01', to: '2026-09-30' });
  assert.equal(defaultTrueUpDate(2025, '2026-09-15'), '2026-09-15', 'today, inside the window');
  assert.equal(defaultTrueUpDate(2025, '2026-11-02'), '2026-09-30', 'capped at the September return');
  assert.equal(defaultTrueUpDate(2025, '2026-02-01'), '2026-04-01', 'never inside the closed FY');
  const heads = { igst: 0, cgst: 500, sgst: 500, cess: 0 };
  const post = (date: string) => postReversal({ month: 'FY2025-26', kind: 'annual', heads, figures: {}, date });
  assert.throws(() => post('2026-03-31'), /trueUpDate/, 'the closed FY (its March 3B is already filed)');
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-06-30' });
  assert.throws(() => post('2026-05-31'), /lock/i, 'a locked month');
  setTable(COMPLIANCE_TABLE, [{ id: 'GSTR3B:2026-08:', form: 'GSTR3B', period_key: '2026-08', gstin: '', filed_on: '2026-09-20', marked_at: '' }]);
  assert.throws(() => post('2026-08-31'), /trueUpFiled/, 'a GSTR-3B already marked filed');
  setTable(COMPLIANCE_TABLE, [{ id: 'GSTR3B:2026-Q2:', form: 'GSTR3B', period_key: '2026-Q2', gstin: '', filed_on: '2026-10-22', marked_at: '' }]);
  assert.throws(() => post('2026-09-10'), /trueUpFiled/, 'a filed QRMP quarter');
  setTable(COMPLIANCE_TABLE, []);
  assert.equal(loadCcRuns().length, 0, 'nothing posted by the refusals');
  const run = post('2026-09-15');
  assert.equal(run.month, 'FY2025-26');
  assert.equal(run.date, '2026-09-15');
  assert.deepEqual(journalItcReversals(getTable('vouchers')).map((r) => r.date), ['2026-09-15'], 'September 3B 4(B)(1)');
});

test('R6-C4: GSTR-9 Table 7 includes the journal reversal and agrees with the month\'s 3B 4(B)(1); the month-end pack carries it', async () => {
  const { buildGstReport, journalItcReversals } = await import('../src/lib/gst-reports.ts');
  const { buildGstr9 } = await import('../src/lib/gstr9.ts');
  const { getTable } = await import('../src/lib/storage.ts');
  setTable('purchases', FIXTURE);
  const r = rule42(inputsFor(FIXTURE, '2026-05-01', '2026-05-31'), 20000, 100000, '2026-05');
  postReversal({ month: '2026-05', kind: 'monthly', heads: r.reverse, figures: figuresOf(r), date: '2026-05-31' });
  const itcReversals = journalItcReversals(getTable('vouchers'));
  const g3 = buildGstReport([], FIXTURE, { period: { kind: 'month', fyStart: 2026, month: 5 }, itcReversals }).gstr3b.itc.reversedRules;
  const g9 = buildGstr9([], FIXTURE, { fyStart: 2026, itcReversals });
  const row = (id: string) => g9.table7.find((x) => x.id === id)!;
  assert.deepEqual([row('7C').igst, row('7C').cgst, row('7C').sgst], [g3.igst, g3.cgst, g3.sgst], 'Table 7C = the month\'s 3B 4(B)(1)');
  assert.deepEqual([row('7C').cgst, row('7I').cgst], [187.5, 187.5]);
  const without = buildGstr9([], FIXTURE, { fyStart: 2026 });
  assert.equal(without.table7.find((x) => x.id === '7C')!.cgst, 0, 'without the option nothing is added');
  assert.equal(g9.months.find((m) => m.period.month === 5)!.gstr3b.itc.reversedRules.cgst, 187.5, 'each month\'s 3B in GSTR-9 carries it');
  // The month-end pack, GSTR-9C and the Compliance interest base pass the same option (report-pack.ts imports a
  // directory module Node's test loader cannot resolve, so this is a source check).
  const { readFileSync } = await import('node:fs');
  for (const f of ['src/lib/report-pack.ts', 'src/components/gst-reports/Gstr9Modal.tsx', 'src/components/gst-reports/Gstr9cView.tsx', 'src/components/gst-reports/ComplianceView.tsx']) {
    assert.match(readFileSync(f, 'utf8'), /itcReversals(: journalItcReversals\(getTable\('vouchers'\)\)|\b)/, f);
    assert.match(readFileSync(f, 'utf8'), /journalItcReversals\(getTable\('vouchers'\)\)/, f);
  }
});
