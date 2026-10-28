/**
 * ROADMAP 7.49 follow-up: TDS / TCS challans in the Tally export (the per-FY auditor export is master's R4-C5
 * auditor pack).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { saveChallan } from '../src/lib/tds-payables.ts';
import { tdsChallanTallyVouchers, withTdsChallans } from '../src/lib/tally-tds.ts';
import { buildTallyModel, generateTallyExport } from '../src/lib/tally-xml.ts';
import { chartOf, A } from '../src/lib/ledger/accounts.ts';
import { fullSource } from './export-fixtures.ts';
import { DEFAULT_LEDGER_NAMES } from '../src/lib/tally-xml.ts';

beforeEach(() => resetStorage());

test('Tally export: a TDS challan becomes a Payment voucher from its ledger posting', async () => {
  saveChallan({ kind: 'TDS', date: '2026-05-07', bsr_code: '0510002', challan_no: '00123', amount: 1000, interest: 15, deduction_keys: [], method: 'NEFT' }, []);
  const books = await withTdsChallans({ chart: chartOf(), today: '2026-10-01' });
  const vs = tdsChallanTallyVouchers(books, { ...DEFAULT_LEDGER_NAMES, range: { from: '', to: '' } } as never, () => {});
  assert.equal(vs.length, 1);
  const v = vs[0];
  assert.equal(v.type, 'Payment');
  assert.equal(v.number, '0510002/00123');
  const dr = v.entries.filter((e) => e.side === 'Dr').reduce((s, e) => s + e.paise, 0);
  const cr = v.entries.filter((e) => e.side === 'Cr').reduce((s, e) => s + e.paise, 0);
  assert.equal(dr, 101_500);
  assert.equal(cr, 101_500);
  // Through the whole export: the voucher is in the XML, and a source without challans is unchanged.
  const plain = generateTallyExport({ ...fullSource(), books: { chart: chartOf(), today: '2026-10-01' } }, { companyName: 'Demo Co' });
  const withCh = generateTallyExport({ ...fullSource(), books }, { companyName: 'Demo Co' });
  assert.ok(withCh.vouchersXml.includes('0510002/00123'));
  assert.ok(!plain.vouchersXml.includes('0510002/00123'));
  const b = buildTallyModel({ ...fullSource(), books }, { companyName: 'Demo Co', range: { from: '2026-06-01', to: '2026-06-30' } });
  assert.ok(!b.vouchers.some((x) => x.number === '0510002/00123'), 'outside the export range');
  assert.ok(A.bank);
});
