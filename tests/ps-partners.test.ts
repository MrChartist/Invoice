/** PS-D1 partners: shares 100 % by date, ledgers on save, drawings posting, interest on drawings (product method). */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { chartOf, loadUserAccounts, A } from '../src/lib/ledger/accounts.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { deletePartner, drawingsOf, interestOnDrawings, loadPartners, postDrawings, savePartner, saveRatio, shareProblems, sharesOn, termOn, validatePartner } from '../src/lib/prof/ps-partners.ts';
import type { Partner } from '../src/types/prof-r14.ts';
import { getTable, setTable } from '../src/lib/storage.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const term = (share: number, from = '2025-04-01', extra: Partial<Partner['terms'][number]> = {}) => ({ from, share_pct: share, remuneration: { mode: 'max_allowable' as const }, interest_pct: 12, ...extra });
const partner = (name: string, share: number, over: Partial<Partner> = {}) => savePartner({ name, kind: 'working', joined: '2025-04-01', terms: [term(share)], ...over });

test('shares must total 100 % on every date; more than 100 is refused on save', () => {
  partner('Asha', 40);
  partner('Bala', 30);
  assert.deepEqual(shareProblems(loadPartners()), [{ date: '2025-04-01', total: 70 }]);
  partner('Chitra', 30);
  assert.deepEqual(shareProblems(loadPartners()), []);
  assert.equal(sharesOn(loadPartners(), '2025-09-01'), 100);
  assert.throws(() => partner('Dev', 10), /more than 100/);
  // A new ratio from a date: every partner's term together, totalling 100.
  const all = loadPartners();
  const a = all.find((p) => p.name === 'Asha')!;
  assert.throws(() => savePartner({ ...a, terms: [...a.terms, term(50, '2026-04-01')] }), /110 % on 2026-04-01/);
  const ids = Object.fromEntries(all.map((p) => [p.name, p.id]));
  assert.throws(() => saveRatio('2026-04-01', { [ids.Asha]: 50, [ids.Bala]: 30, [ids.Chitra]: 30 }), /110 %/);
  saveRatio('2026-04-01', { [ids.Asha]: 50, [ids.Bala]: 25, [ids.Chitra]: 25 });
  assert.deepEqual(shareProblems(loadPartners()), []);
  const a2 = loadPartners().find((p) => p.name === 'Asha')!;
  assert.equal(termOn(a2, '2026-05-01')?.share_pct, 50);
  assert.equal(termOn(a2, '2026-03-31')?.share_pct, 40);
  assert.equal(termOn(a2, '2026-05-01')?.interest_pct, 12, 'other terms copied');
  assert.match(validatePartner({ name: 'X', kind: 'working', joined: '2025-04-01', terms: [term(0, '2025-04-01', { interest_pct: 15 })] }, []).join(' '), /above 12 %/);
});

test('capital and current ledgers are created under Capital; drawings post Dr current / Cr cash', () => {
  const p = partner('Asha', 100);
  const chart = chartOf(loadUserAccounts());
  assert.equal(chart.find((a) => a.id === p.capital_account_id)?.name, 'Capital: Asha');
  assert.equal(chart.find((a) => a.id === p.current_account_id)?.group, 'CAPITAL');
  const v = postDrawings(p.id, 25000, '2025-06-10', A.cash);
  assert.equal(v.voucher_class, 'Partner drawings');
  assert.deepEqual(v.lines.map((l) => [l.account_id, l.dr, l.cr]), [[p.current_account_id, 2500000, 0], [A.cash, 0, 2500000]]);
  assert.deepEqual(drawingsOf(p, '2025-04-01', '2026-03-31', loadVouchers()), [{ date: '2025-06-10', amount: 25000 }]);
  assert.throws(() => deletePartner(p.id), /postings/);
});

test('interest on drawings by the product method (months left counting the month of drawing)', () => {
  // April 12 months, October 6 months, March 1 month; 10 % a year.
  assert.equal(interestOnDrawings([{ date: '2025-04-15', amount: 12000 }, { date: '2025-10-01', amount: 12000 }, { date: '2026-03-31', amount: 12000 }], 10, '2026-03-31'), 1900);
  assert.equal(interestOnDrawings([{ date: '2025-04-15', amount: 12000 }], 0, '2026-03-31'), 0);
  assert.equal(interestOnDrawings([{ date: '2024-04-15', amount: 12000 }], 10, '2026-03-31'), 0, 'outside the FY');
});

test('R16-B5: delete a partner with no posting (recycle bin); refused while a partner run names the partner', () => {
  const a = partner('Asha', 60);
  const b = partner('Bala', 40);
  setTable('partner_runs', [{ id: 'r1', date: '2026-03-31', lines: [{ partner_id: b.id }] }]);
  assert.throws(() => deletePartner(b.id), /postings/);
  deletePartner(a.id);
  assert.deepEqual(loadPartners().map((p) => p.name), ['Bala']);
  assert.ok(getTable<{ table: string; row_id: string }>('recycle_bin').some((r) => r.table === 'partners' && r.row_id === a.id), 'in the recycle bin');
});
