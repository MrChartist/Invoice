/** PS-D2 194T: threshold and catch-up, kinds, register rows, 26Q (Form 140) paper code, year-end credit deposit due. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import { loadVouchers, voucherTotals } from '../src/lib/ledger/vouchers.ts';
import { payableSection, sectionRate, tdsThreshold } from '../src/lib/tds-rules.ts';
import { sectionText } from '../src/lib/ita2025.ts';
import { depositDueDate } from '../src/lib/tds-payables.ts';
import { KINDS_194T, creditPartner, register194t, tds194tFor, undoPartnerRun } from '../src/lib/prof/ps-194t.ts';
import { savePartner } from '../src/lib/prof/ps-partners.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const asha = () => savePartner({ name: 'Asha', pan: 'AAAPA1234A', kind: 'working', joined: '2025-04-01', terms: [{ from: '2025-04-01', share_pct: 100, remuneration: { mode: 'fixed', amount: 180000 }, interest_pct: 12 }] });

test('rule rows: 10 % from 1 Apr 2025 (none before), ₹20,000 FY aggregate, RPU code unverified, 2025-Act label says verify', () => {
  assert.equal(sectionRate('194T', '2025-03-31'), null);
  assert.equal(sectionRate('194T', '2025-04-01'), 10);
  assert.deepEqual(tdsThreshold('194T', '2025-04-01'), { aggregate: 20000 });
  assert.equal(payableSection('194T')?.rpu, '94T');
  assert.equal(sectionText('194T', '2025-12-01'), '194T');
  assert.match(sectionText('194T', '2026-06-01'), /Sec 393.*old 194T.*verify with your CA/);
  assert.equal(tds194tFor({ id: 'x' }, '2025-03-15', 50000), null, 'no section before 1 Apr 2025');
});

test('catch-up on the crossing credit, then every credit; drawings / profit share are not kinds', () => {
  const p = asha();
  assert.deepEqual([...KINDS_194T], ['salary', 'remuneration', 'commission', 'bonus', 'interest']);
  const a = creditPartner({ partnerId: p.id, kind: 'remuneration', amount: 15000, date: '2025-04-30' });
  assert.equal(a.tds, undefined, 'below ₹20,000');
  const b = creditPartner({ partnerId: p.id, kind: 'remuneration', amount: 15000, date: '2025-05-31' });
  assert.equal(b.tds, 3000, '10 % on the FY total ₹30,000 (catch-up)');
  const c = creditPartner({ partnerId: p.id, kind: 'interest', amount: 5000, date: '2025-06-30' });
  assert.equal(c.tds, 500);
  for (const v of loadVouchers()) assert.equal(voucherTotals(v.lines).dr, voucherTotals(v.lines).cr);
  const rows = getTable<{ section: string; amount: number; base: number }>('tds_deductions');
  assert.deepEqual(rows.map((r) => [r.section, r.base, r.amount]), [['194T', 30000, 3000], ['194T', 5000, 500]]);
  const reg = register194t(2025);
  assert.equal(reg[0].total, 35000);
  assert.equal(reg[0].tds, 3500);
  assert.deepEqual(reg[0].credits.map((x) => x.due), ['', '2025-06-07', '2025-07-07']);
  undoPartnerRun(c.id);
  assert.equal(getTable('tds_deductions').length, 1);
  assert.equal(loadVouchers().length, 2);
});

test('a 31 March credit is due by 30 April (the March rule); the next FY starts again', () => {
  const p = asha();
  const m = creditPartner({ partnerId: p.id, kind: 'bonus', amount: 25000, date: '2026-03-31' });
  assert.equal(m.tds, 2500);
  assert.equal(depositDueDate('2026-03-31'), '2026-04-30');
  assert.equal(register194t(2025)[0].credits[0].due, '2026-04-30');
  const n = creditPartner({ partnerId: p.id, kind: 'salary', amount: 15000, date: '2026-04-30' });
  assert.equal(n.tds, undefined, 'new FY: below the threshold again');
});
