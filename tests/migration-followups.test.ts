/**
 * ROADMAP 7.49 follow-ups: per-FY auditor export of the audit trail (rows + chain head, CSV + JSON) and
 * TDS / TCS challans in the Tally export.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { audit } from '../src/lib/audit.ts';
import { auditFys, auditorCsv, auditorExport, auditorJson, fyOfRow } from '../src/lib/audit-export.ts';
import { saveChallan } from '../src/lib/tds-payables.ts';
import { tdsChallanTallyVouchers, withTdsChallans } from '../src/lib/tally-tds.ts';
import { buildTallyModel, generateTallyExport } from '../src/lib/tally-xml.ts';
import { chartOf, A } from '../src/lib/ledger/accounts.ts';
import { fullSource } from './export-fixtures.ts';
import { DEFAULT_LEDGER_NAMES } from '../src/lib/tally-xml.ts';

beforeEach(() => resetStorage());

test('auditor export: rows of one FY (local day), chain head and links, CSV formula-guarded, JSON', () => {
  audit.record({ entity: 'system', entity_id: 'a', action: 'create', summary: 'last year', at: '2026-03-31T10:00:00+05:30' });
  audit.record({ entity: 'system', entity_id: 'b', action: 'create', summary: '=HYPERLINK("http://x")', at: '2026-04-01T09:00:00+05:30' });
  audit.record({ entity: 'system', entity_id: 'c', action: 'update', summary: 'this year', at: '2026-06-01T09:00:00+05:30', changes: [{ field: 'Total', from: '1', to: '2' }] });
  const all = audit.fullRows();
  assert.deepEqual(auditFys(all).slice(0, 2), ['26-27', '25-26']);
  const prevTz = process.env.TZ;
  process.env.TZ = 'Asia/Kolkata';
  try {
    assert.equal(fyOfRow({ at: '2026-03-31T20:00:00Z' }), '26-27', '1:30 am on 1 April in India');
  } finally {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  }
  const x = auditorExport(all, '26-27', new Date('2026-10-01T00:00:00Z'));
  assert.equal(x.rows.length >= 2, true);
  assert.ok(x.rows.every((r) => fyOfRow(r) === '26-27'));
  assert.equal(x.chain.verified, true);
  assert.equal(x.chain.chain_head, audit.head());
  assert.equal(x.chain.fy_last_hash, x.rows[x.rows.length - 1].hash);
  assert.equal(x.chain.fy_first_prev, all[all.indexOf(x.rows[0]) - 1]?.hash ?? x.rows[0].prev);
  assert.equal(x.from, '2026-04-01');
  assert.equal(x.to, '2027-03-31');
  const csv = auditorCsv(x);
  assert.ok(csv.includes('Chain head (whole log)'));
  assert.ok(!csv.includes(',=HYPERLINK'), 'formula cells are neutralised');
  const json = JSON.parse(auditorJson(x, 'Demo Co'));
  assert.equal(json.format, 'mrchartist-audit-trail');
  assert.equal(json.company, 'Demo Co');
  assert.equal(json.rows.length, x.rows.length);
});

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
