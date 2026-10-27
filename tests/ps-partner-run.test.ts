/**
 * PS-D1 year-end run: 40(b) slabs on both sides of 2024-04-01, the loss case, interest cap, excess disallowed, residual
 * by ratio, journals balance (posted through the ledger), reversal, locked period refused; 194T on the run.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import { loadVouchers, voucherTotals } from '../src/lib/ledger/vouchers.ts';
import { allowableRemuneration, averageCapital, computeRun, splitByRatio } from '../src/lib/prof/ps-partner-run.ts';
import { postRun, reverseRun, yearEndRun } from '../src/lib/prof/ps-partner-post.ts';
import { loadPartners, savePartner } from '../src/lib/prof/ps-partners.ts';
import type { Partner } from '../src/types/prof-r14.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('Sec 40(b) allowable remuneration: slabs before and from 1 Apr 2024, loss case', () => {
  assert.equal(allowableRemuneration(200000, '2023-04-01').allowable, 180000);
  assert.equal(allowableRemuneration(100000, '2023-04-01').allowable, 150000, 'floor ₹1.5 lakh');
  assert.equal(allowableRemuneration(500000, '2023-04-01').allowable, 390000);
  assert.equal(allowableRemuneration(-100000, '2023-04-01').allowable, 150000);
  assert.equal(allowableRemuneration(500000, '2024-04-01').allowable, 450000);
  assert.equal(allowableRemuneration(1000000, '2024-04-01').allowable, 780000);
  assert.equal(allowableRemuneration(-100000, '2025-04-01').allowable, 300000, 'loss: ₹3 lakh');
  assert.equal(allowableRemuneration(0, '2026-04-01').verified, false, '2025 Act row is verify');
});

test('daily-balance capital and the ratio split (remainder to the largest share)', () => {
  assert.equal(averageCapital(100000, [{ date: '2025-10-01', amount: 100000 }], 2025), 149863.01);
  assert.deepEqual(splitByRatio(100, [1, 1, 1]), [33.34, 33.33, 33.33]);
});

const three = (): Partner[] => {
  const t = (share: number, mode: 'max_allowable' | 'fixed', amount?: number) => [{ from: '2025-04-01', share_pct: share, remuneration: { mode, ...(amount ? { amount } : {}) }, interest_pct: 12, interest_on_drawings_pct: 10 }];
  savePartner({ name: 'Asha', pan: 'AAAPA1234A', kind: 'working', joined: '2025-04-01', terms: t(40, 'max_allowable') });
  savePartner({ name: 'Bala', pan: 'AAAPB1234B', kind: 'working', joined: '2025-04-01', terms: t(30, 'max_allowable') });
  savePartner({ name: 'Chitra', pan: 'AAAPC1234C', kind: 'non_working', joined: '2025-04-01', terms: t(30, 'max_allowable') });
  return loadPartners();
};

test('run: interest 12 %, maximum allowable shared by the working partners, residual 40 / 30 / 30', () => {
  const ps = three();
  const cap = Object.fromEntries(ps.map((p) => [p.id, 1000000]));
  const r = computeRun({ fy: 2025, partners: ps, netProfit: 2000000, capital: cap });
  assert.deepEqual(r.problems, []);
  assert.equal(r.interestTotal, 360000);
  assert.equal(r.bookProfit, 1640000);
  assert.equal(r.allowable, 1164000);
  assert.equal(r.remunerationTotal, 1164000);
  assert.equal(r.disallowed, 0);
  assert.equal(r.residual, 476000);
  assert.deepEqual(r.lines.map((l) => [l.name, l.remuneration, l.interest, l.share]), [['Asha', 665142.86, 120000, 190400], ['Bala', 498857.14, 120000, 142800], ['Chitra', 0, 120000, 142800]]);
});

test('run: fixed remuneration above the limit is disallowed (note only); interest above 12 % disallowed; shares ≠ 100 refused', () => {
  savePartner({ name: 'Asha', kind: 'working', joined: '2025-04-01', terms: [{ from: '2025-04-01', share_pct: 50, remuneration: { mode: 'fixed', amount: 600000 }, interest_pct: 15 }] });
  savePartner({ name: 'Bala', kind: 'working', joined: '2025-04-01', terms: [{ from: '2025-04-01', share_pct: 50, remuneration: { mode: 'fixed', amount: 600000 }, interest_pct: 12 }] });
  const ps = loadPartners();
  const r = computeRun({ fy: 2025, partners: ps, netProfit: 500000, capital: Object.fromEntries(ps.map((p) => [p.id, 100000])) });
  assert.equal(r.interestTotal, 27000);
  assert.equal(r.interestDisallowed, 3000);
  assert.equal(r.bookProfit, 473000);
  assert.equal(r.allowable, 425700);
  assert.equal(r.disallowed, 1200000 - 425700);
  assert.equal(r.residual, 500000 - 1200000 - 27000, 'a loss shared in the ratio');
  const bad = computeRun({ fy: 2025, partners: ps.slice(0, 1), netProfit: 1, capital: {} });
  assert.match(bad.problems[0], /total 50 %/);
});

test('posting: balanced journals, 194T on remuneration + interest, one run per FY, reversal, locked period refused', () => {
  const ps = three();
  const r = computeRun({ fy: 2025, partners: ps, netProfit: 2000000, capital: Object.fromEntries(ps.map((p) => [p.id, 1000000])), drawings: { [ps[0].id]: [{ date: '2025-04-10', amount: 120000 }] } });
  assert.equal(r.drawingsInterestTotal, 12000);
  const run = postRun(r);
  assert.equal(run.voucher_ids.length, 3);
  for (const v of loadVouchers()) {
    const t = voucherTotals(v.lines);
    assert.equal(t.dr, t.cr, v.narration);
    assert.equal(v.date, '2026-03-31');
  }
  const tds = getTable<{ section: string; amount: number; vendor_name: string; base: number }>('tds_deductions');
  assert.deepEqual(tds.map((x) => [x.vendor_name, x.section, x.base, x.amount]), [['Asha', '194T', 789257.14, 78926], ['Bala', '194T', 621942.86, 62194], ['Chitra', '194T', 120000, 12000]]);
  assert.ok(yearEndRun(2025));
  assert.throws(() => postRun(r), /already posted/);
  reverseRun(2025);
  assert.equal(loadVouchers().length, 0);
  assert.equal(getTable('tds_deductions').length, 0);
  assert.equal(yearEndRun(2025), undefined);
  installSettings({ lock_until: '2026-03-31' } as never);
  assert.throws(() => postRun(r), /lock/i);
  assert.equal(getTable('partner_runs').length, 0, 'nothing half-posted');
});
