/** R5-C2: Rule 42 / 43 common-credit working, E / F from the GSTR-3B summary, posting and the annual true-up. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupR5c } from './helpers/r5c.ts';
import { setTable } from '../src/lib/storage.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { HEADS, figuresOf, headsTotal, inputsFor, loadCcRuns, postReversal, reversalLines, rule42, trueUp, turnoverOf, unpostReversal, workingCsv } from '../src/lib/institutions/common-credit.ts';
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
  postReversal({ month: 'FY2026-27', kind: 'annual', heads: { igst: 0, cgst: -50, sgst: -50, cess: 0 }, figures: {}, date: '2026-05-31' });
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
  const run = postReversal({ month: 'FY2026-27', kind: 'annual', heads: less.diff, figures: {}, date: '2027-03-31' });
  assert.ok(run.journal_id);
  assert.equal(HEADS.length, 4);
});
