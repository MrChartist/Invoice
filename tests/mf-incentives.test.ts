/** MF-D4 incentive claims: recognition only after assurance, journals balance, capital vs income, receipt, bell. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { loadVouchers } from '../src/lib/ledger/index.ts';
import { chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import { claimFigures, incentiveClaimsDb, pendingClaims, receiveClaim, recogniseClaim, recognitionLines, suggestedClaim } from '../src/lib/mfg/mf-incentives.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ industry_packs: ['shopfloor'] } as never);
});

const pli = () => incentiveClaimsDb.save({ scheme: 'pli', name: 'PLI FY 2025-26', period_from: '2025-04-01', period_to: '2026-03-31', eligible_base: 5000000, rate_pct: 4, claimed: 200000, kind: 'income' });
const nameOf = (id: string) => chartOf(loadUserAccounts()).find((a) => a.id === id)?.name;

test('a claim posts nothing until reasonable assurance; recognition journal balances (income)', () => {
  const c = pli();
  assert.equal(suggestedClaim(5000000, 4), 200000);
  assert.equal(loadVouchers().length, 0, 'claimed only: nothing in the books');
  assert.throws(() => receiveClaim(c.id, 1000, '2026-08-01'), /reasonable assurance/);
  const r = recogniseClaim(c.id, '2026-07-01');
  assert.deepEqual([r.recognised_on, r.recognised], ['2026-07-01', 200000]);
  const [v] = loadVouchers();
  assert.equal(v.lines.reduce((s, l) => s + l.dr - l.cr, 0), 0);
  assert.deepEqual(v.lines.map((l) => [nameOf(l.account_id), l.dr, l.cr]), [['Incentive receivable', 20000000, 0], ['Government grant income', 0, 20000000]]);
  assert.throws(() => recogniseClaim(c.id, '2026-07-02'), /Already/);
  assert.throws(() => incentiveClaimsDb.save({ ...r, claimed: 1 }), /recognised/);
  assert.throws(() => incentiveClaimsDb.remove(c.id), /Journals/);
});

test('capital grant credits Capital subsidy (or the asset ledger); receipt clears the receivable', () => {
  const c = incentiveClaimsDb.save({ scheme: 'state_capital', name: 'State capital subsidy', period_from: '2025-04-01', period_to: '2025-12-31', claimed: 1800000, approved: 1500000, kind: 'capital' });
  recogniseClaim(c.id, '2026-02-01');
  assert.equal(nameOf(loadVouchers()[0].lines[1].account_id), 'Capital subsidy');
  const r = receiveClaim(c.id, 1500000, '2026-09-01');
  assert.deepEqual([claimFigures(r, '2026-09-01').receivable, claimFigures(r, '2026-09-01').pending], [0, 0]);
  assert.throws(() => receiveClaim(c.id, 1, '2026-09-02'), /More than/);
  assert.deepEqual(recognitionLines(10, { receivable: 'r', credit: 'asset' }), [{ account_id: 'r', dr: 1000, cr: 0 }, { account_id: 'asset', dr: 0, cr: 1000 }]);
});

test('bell: pending more than 180 days after the claim', () => {
  const c = pli();
  assert.equal(pendingClaims([c], '2026-09-27').length, 0);
  assert.equal(pendingClaims([c], '2026-09-28').length, 1);
  assert.equal(pendingClaims([{ ...c, claimed_on: '2026-06-01' }], '2026-09-28').length, 0);
});
