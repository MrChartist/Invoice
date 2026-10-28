/**
 * R18-B2 regime engine: the ₹5,000 → ₹7,500 limit at 2018-01-24 / 25; ₹7,500.00 exempt vs ₹7,500.01 taxable;
 * quarterly ₹22,500; statutory dues never counted (always pure-agent lines); interest / levies counted; whole vs
 * excess; unregistered; agency; outsider; the rule rows and their `verified` set.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hsRegime, regimeLines, isCounted } from '../src/lib/society/hs-regime.ts';
import { REG_THRESHOLD_RULES, RWA_LIMIT_RULES, RWA_VALUATION_RULES } from '../src/lib/society-rules.ts';
import type { HsHeadRow } from '../src/types/society-r18.ts';

const R = (head_id: string, kind: HsHeadRow['kind'], amount: number): HsHeadRow => ({ head_id, name: head_id, kind, basis: '', amount });
const base = { date: '2026-10-01', months: 1, registered: true };

test('limit by date: ₹5,000 to 24 Jan 2018, ₹7,500 from 25 Jan 2018; rows sourced; whole valuation; ₹20 lakh threshold', () => {
  const rows = [R('svc', 'service', 6000)];
  assert.deepEqual([hsRegime({ ...base, date: '2018-01-24', rows }).regime, hsRegime({ ...base, date: '2018-01-24', rows }).limit], ['taxable_whole', 5000]);
  assert.deepEqual([hsRegime({ ...base, date: '2018-01-25', rows }).regime, hsRegime({ ...base, date: '2018-01-25', rows }).limit], ['exempt77c', 7500]);
  assert.deepEqual(RWA_LIMIT_RULES.map((r) => r.verified), [true, true, false], 'the 22 Sep 2025 row is a secondary report');
  assert.deepEqual(RWA_VALUATION_RULES.map((r) => [r.from, r.value, r.verified]), [['2019-07-22', 'whole', true]]);
  assert.equal(REG_THRESHOLD_RULES.find((r) => !r.state)?.value, 2000000);
  assert.ok(REG_THRESHOLD_RULES.filter((r) => r.state).every((r) => r.value === 1000000 && !r.verified), 'special-category rows not read');
  for (const r of [...RWA_LIMIT_RULES, ...RWA_VALUATION_RULES, ...REG_THRESHOLD_RULES]) assert.ok(r.source && /HS\d/.test(r.source), r.source);
});

test('₹7,500.00 exempt (Bill of Supply, Sl. 77(c) sentence); ₹7,500.01 taxable on the whole amount (tax invoice, 18 %)', () => {
  const ex = hsRegime({ ...base, rows: [R('svc', 'service', 7500)] });
  assert.deepEqual([ex.regime, ex.doc, ex.counted, ex.rate], ['exempt77c', 'BILL_OF_SUPPLY', 7500, 0 + 18]);
  assert.match(ex.decl, /^Exempt — contribution by a member .* up to ₹7,500 a month \(N 12\/2017-CT\(R\) Sl\. 77\(c\)\).*Verify with your CA\.$/);
  const tx = hsRegime({ ...base, rows: [R('svc', 'service', 7500.01)] });
  assert.deepEqual([tx.regime, tx.doc], ['taxable_whole', 'TAX_INVOICE']);
  assert.match(tx.decl, /exceeds ₹7,500: GST on the whole amount \(Circular 109\/28\/2019-GST\)/);
  assert.deepEqual(regimeLines([R('svc', 'service', 7500.01)], tx).map((l) => [l.amount, l.tax]), [[7500.01, 18]]);
});

test('quarterly limit × 3 (₹22,500); statutory dues never counted and always pass through; interest / levy counted', () => {
  assert.equal(hsRegime({ ...base, months: 3, rows: [R('svc', 'service', 22500)] }).regime, 'exempt77c');
  assert.equal(hsRegime({ ...base, months: 3, rows: [R('svc', 'service', 22500.01)] }).regime, 'taxable_whole');
  const rows = [R('svc', 'service', 5000), R('ptx', 'statutory', 9000), R('int', 'other', 100)];
  const r = hsRegime({ ...base, rows });
  assert.deepEqual([r.regime, r.counted], ['exempt77c', 5100], 'property tax outside the test; interest counted (HS7)');
  assert.ok(!isCounted({ kind: 'statutory' }) && !isCounted({ kind: 'outsider' }) && isCounted({ kind: 'major_repair' }));
  for (const reg of [r, hsRegime({ ...base, rows: [R('svc', 'service', 9000), R('ptx', 'statutory', 3000)] })]) {
    const pass = regimeLines(rows, reg).filter((l) => l.pass);
    assert.deepEqual(pass.map((l) => [l.name, l.amount, l.tax]), [['ptx', 9000, 0]]);
  }
});

test('excess (setting): an exempt line for ₹7,500 × months, the rest apportioned across counted heads at 18 %', () => {
  const rows = [R('svc', 'service', 3000), R('snk', 'sinking', 1250), R('rep', 'repair', 3750), R('prk', 'parking', 1000), R('edu', 'education', 10), R('ptx', 'statutory', 3000)];
  const r = hsRegime({ ...base, rows, valuation: 'excess' });
  assert.equal(r.regime, 'taxable_excess');
  assert.match(r.decl, /above ₹7,500 a month \(Madras High Court, 2021 — under appeal\)/);
  const lines = regimeLines(rows, r);
  assert.deepEqual(lines[0], { name: 'Exempt contribution (Sl. 77(c), ₹7,500 × 1)', amount: 7500, tax: 0, exempt: true });
  const taxed = lines.filter((l) => l.tax === 18);
  assert.equal(Math.round(taxed.reduce((t, l) => t + l.amount, 0) * 100) / 100, 1510, 'the excess, paise-exact');
  assert.equal(lines.filter((l) => l.pass).length, 1);
});

test('unregistered: plain bill, no tax; agency: 18 % on every non-statutory head; outsider: its own 18 % document', () => {
  const rows = [R('svc', 'service', 9000), R('ptx', 'statutory', 1000)];
  const u = hsRegime({ ...base, registered: false, rows });
  assert.deepEqual([u.regime, u.doc, u.decl], ['unregistered', 'INVOICE', 'The society is not registered under GST.']);
  assert.ok(regimeLines(rows, u).every((l) => l.tax === 0));
  const a = hsRegime({ ...base, kind: 'agency', rows: [R('svc', 'service', 100)] });
  assert.deepEqual([a.regime, a.doc, a.decl], ['agency', 'TAX_INVOICE', ''], 'no Sl. 77(c) for an agency (HS16)');
  assert.deepEqual(regimeLines(rows, hsRegime({ ...base, kind: 'agency', rows })).map((l) => l.tax), [18, 0]);
  const o = hsRegime({ ...base, outsider: true, rows: [R('twr', 'outsider', 20000)] });
  assert.deepEqual([o.regime, o.doc, regimeLines([R('twr', 'outsider', 20000)], o)[0].tax], ['outsider', 'TAX_INVOICE', 18]);
});
