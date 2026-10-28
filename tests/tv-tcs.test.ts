/**
 * R15-D1 TCS on overseas tour packages: every dated row, slab crossing on the buyer's FY aggregate, 2 % flat from
 * 2026-04-01 at any amount, the no-PAN rate, the stand-alone refusal, the non-resident exclusion, base total vs
 * taxable through the invoice maths, the register row, the Form 27EQ code row and the 2025-Act label.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buyerKey, isTourPackage, priorTourBase, tcsPatch, tcsRegister, tourTcs } from '../src/lib/travel/tv-tcs.ts';
import { TOUR_PACKAGE_TCS_RULES } from '../src/lib/travel-rules.ts';
import { TCS_27EQ_CODES } from '../src/lib/tds-rules.ts';
import { tcsCollections, form27EQ } from '../src/lib/tds-returns.ts';
import { actKey } from '../src/lib/ita2025.ts';
import { calculateInvoice } from '../src/lib/invoice-calc.ts';

const PAN = 'ABCPM1234K';
const pkg = ['air', 'hotel'] as const;

test('every dated row: none before Oct 2020, 5 %, slabs 7 / 10 lakh, 2 % from 2026-04-01', () => {
  assert.equal(tourTcs({ date: '2020-09-30', base: 100000, pan: PAN }).status, 'off');
  assert.equal(tourTcs({ date: '2020-10-01', base: 2000000, pan: PAN }).rate, 5);
  assert.equal(tourTcs({ date: '2023-09-30', base: 900000, pan: PAN }).rate, 5);
  assert.equal(tourTcs({ date: '2023-10-01', base: 900000, pan: PAN }).amount, 35000 + 40000);
  assert.equal(tourTcs({ date: '2025-03-31', base: 900000, pan: PAN }).amount, 75000);
  assert.equal(tourTcs({ date: '2025-04-01', base: 900000, pan: PAN }).amount, 45000);
  assert.equal(tourTcs({ date: '2026-03-31', base: 1200000, pan: PAN }).amount, 90000);
  assert.ok(TOUR_PACKAGE_TCS_RULES.every((r) => r.verified === false));
});

test('2 % from 2026-04-01 at any amount, labelled Sec 394(1) Sl. 8', () => {
  const r = tourTcs({ date: '2026-05-10', base: 340000, pan: PAN, components: pkg });
  assert.deepEqual([r.status, r.rate, r.amount, r.slab], ['ok', 2, 6800, undefined]);
  assert.match(r.label, /^Sec 394\(1\) Sl\. 8 — overseas tour package 2 %$/);
  assert.equal(tourTcs({ date: '2026-04-01', base: 50_00_00_000, pan: PAN, prior: 9e9 }).rate, 2);
});

test('slab crossing: 5 % on ₹10 lakh + 20 % on ₹2 lakh; earlier packages of the FY count', () => {
  const r = tourTcs({ date: '2026-02-10', base: 1200000, pan: PAN, components: pkg });
  assert.equal(r.amount, 90000);
  assert.equal(r.rate, 7.5);
  assert.match(r.slab ?? '', /5 % on ₹10,00,000\.00 \+ 20 % on ₹2,00,000\.00/);
  assert.match(r.label, /^206C\(1G\) overseas tour package 5 % \/ 20 %$/);
  const after = tourTcs({ date: '2026-02-10', base: 300000, pan: PAN, prior: 900000 });
  assert.equal(after.amount, 5000 + 40000);
  assert.equal(tourTcs({ date: '2026-02-10', base: 300000, pan: PAN, prior: 1100000 }).rate, 20);
});

test('no PAN: 10 % floor before 2026; higher of twice the rate or 5 % from 2026', () => {
  assert.equal(tourTcs({ date: '2021-05-01', base: 100000 }).rate, 10);
  const r = tourTcs({ date: '2026-05-01', base: 100000, pan: 'bad' });
  assert.deepEqual([r.rate, r.noPan], [5, true]);
  assert.match(r.label, /\(no PAN\)/);
});

test('stand-alone ticket or hotel is not a package unless the user ticks it; non-resident gets no TCS', () => {
  assert.ok(isTourPackage(['air', 'hotel']) && isTourPackage(['package']) && !isTourPackage(['air']) && !isTourPackage(['hotel', 'visa']));
  assert.equal(tourTcs({ date: '2026-05-01', base: 1000, pan: PAN, components: ['air'] }).status, 'not_package');
  assert.equal(tourTcs({ date: '2026-05-01', base: 1000, pan: PAN, components: ['air'], force: true }).status, 'ok');
  const nr = tourTcs({ date: '2026-05-01', base: 1000, pan: PAN, nonResident: true, components: pkg });
  assert.equal(nr.status, 'non_resident');
  const p = tcsPatch(nr, 1000, 'total', { regime: 'to5' });
  assert.equal(p.tcs_enabled, false);
  assert.equal(p.tv?.tcs?.nr, true);
  assert.equal(p.tv?.regime, 'to5', 'other tv sub-objects kept');
});

const item = { id: 'l1', description: 'Dubai package', quantity: 1, rate: 323809.52, tax_rate: 5, discount: 0, hsn: '998555' };
const calc = (base: 'total' | 'taxable', rate: number) => calculateInvoice({ items: [item], gst_mode: 'IGST', tcs_enabled: true, tcs_rate: rate, tcs_base: base } as never);

test('base total vs taxable: the invoice maths computes the amount from the applied rate', () => {
  const t0 = calc('total', 0);
  const base = t0.total - t0.round_off - t0.tcs_amount;
  const r = tourTcs({ date: '2026-05-10', base, pan: PAN });
  const p = tcsPatch(r, base, 'total', undefined);
  assert.deepEqual([p.tcs_enabled, p.tcs_rate, p.tcs_base, p.tcs_label], [true, 2, 'total', r.label]);
  assert.equal(calc('total', 2).tcs_amount, r.amount);
  assert.equal(calc('taxable', 2).tcs_amount, Math.round(t0.taxable_value * 2) / 100);
  // An effective crossing rate reproduces the split amount through the invoice maths.
  const big = calculateInvoice({ items: [{ ...item, rate: 1200000, tax_rate: 0 }], gst_mode: 'IGST', tcs_enabled: true, tcs_rate: 7.5, tcs_base: 'total' } as never);
  assert.equal(big.tcs_amount, 90000);
});

const doc = (id: string, date: string, base: number, tcs: number, extra: object = {}) => ({
  id, issue_date: date, status: 'Sent', doc_type: 'TAX_INVOICE', currency: 'INR', invoice_number: id, total: base + tcs, tcs_amount: tcs, tcs_rate: 2,
  tcs_label: tcs ? 'Sec 394(1) Sl. 8 — overseas tour package 2 %' : 'TCS', client: { id: 'c1', name: 'Mehta', pan: PAN }, tv: { tcs: { rate: 2, base, label: 'x' } }, ...extra,
});

test('buyer FY aggregate: same buyer, same FY, flagged, live, dated on or before', () => {
  const docs = [doc('a', '2025-05-01', 400000, 0), doc('b', '2025-12-01', 300000, 0), doc('c', '2026-04-02', 100000, 0), doc('d', '2025-06-01', 100000, 0, { status: 'Draft' }), doc('e', '2025-06-01', 100000, 0, { client: { id: 'c2', name: 'X' } })];
  assert.equal(priorTourBase(docs as never, buyerKey({ id: 'c1' }), '2026-02-10', 'self'), 700000);
  assert.equal(priorTourBase(docs as never, 'c1', '2025-06-01'), 400000);
});

test('register: per buyer, quarters, PAN missing; the TCS register row, its 27EQ code (to confirm) and label', () => {
  const docs = [doc('a', '2026-05-10', 340000, 6800), doc('b', '2026-11-01', 100000, 2000, { client: { id: 'c9', name: 'NoPan' } })];
  const reg = tcsRegister(docs as never, 2026);
  assert.deepEqual(reg.quarters, [6800, 0, 2000, 0]);
  assert.equal(reg.total, 8800);
  assert.deepEqual(reg.noPan.map((b) => b.name), ['NoPan']);
  const rows = tcsCollections(docs as never);
  assert.equal(rows[0].code, '', 'collection code blank until TV7 is answered');
  assert.equal(TCS_27EQ_CODES.find((c) => c.match.test('206C(1G) overseas tour package 5 %'))?.code, '', 'old-Act label does not fall to the LRS row');
  assert.equal(TCS_27EQ_CODES.find((c) => c.match.test('206C(1G) overseas remittance 20%'))?.code, '6CQ', 'LRS unchanged');
  assert.equal(actKey(rows[0].label), '206C1G-tour');
  const paper = form27EQ(rows, [], 2026, 1);
  assert.ok(paper.refs.some(([, ref]) => /Sl\. No\. 8/.test(ref)), 'the 2025-Act reference is Sl. No. 8');
});
