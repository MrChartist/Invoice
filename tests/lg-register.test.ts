/**
 * R19-C4 customs broker register (CBLR Reg 10(k)): one row per job in the range with IEC, GSTIN, BOE / SB, port,
 * invoices, disbursements, deposits and status; CSV (header, quoting, formula neutralised); the title from
 * `CBLR_RULES`; the KYC hint (Reg 10(n), dates only).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { docRefsFromTable, kycMissing, registerCsv, registerRows, registerTitle, REGISTER_HEAD } from '../src/lib/logistics/lg-register.ts';
import type { LgJob } from '../src/types/logistics-r19.ts';

const job = (id: string, date: string, over: Partial<LgJob> = {}): LgJob => ({ id, number: `JOB/FY26-27/000${id}`, date, status: 'arrived', dir: 'import', mode: 'sea_fcl', origin: 'NSA', destination: 'BOM', client_id: 'c1', refs: {}, updated_at: '', ...over });
const clients = [{ id: 'c1', name: 'Demo Imports, Pvt Ltd', gstin: '27AAPFU0939F1ZV', lg: { iec: '0304012345', kyc: { verified_on: '2026-04-02', method: 'documents' as const } } }, { id: 'c2', name: '=HYPERLINK("x")' }];

test('register rows: range, BOE / SB, port, live invoices only, sums by job', () => {
  const rows = registerRows({
    jobs: [job('2', '2026-11-05', { refs: { boe_no: '7654321', boe_date: '2026-11-04' } }), job('1', '2026-10-01', { dir: 'export', origin: 'BOM', destination: 'SIN', client_id: 'c2', status: 'delivered', refs: { sb_no: '5550001' } }), job('3', '2026-12-01')],
    clients: clients as never,
    invoices: [{ invoice_number: 'INV/1', status: 'Issued', total: 204510, lg: { job_id: '2' } }, { invoice_number: 'INV/2', status: 'Cancelled', total: 99, lg: { job_id: '2' } }] as never,
    disb: [{ job_id: '2', amount: 185430 }, { job_id: '2', amount: 12000 }] as never,
    deposits: [{ job_id: '2', amount: 200000 }] as never,
    from: '2026-10-01', to: '2026-11-30',
  });
  assert.deepEqual(rows.map((r) => r.job), ['JOB/FY26-27/0001', 'JOB/FY26-27/0002'], 'in range, by date');
  assert.deepEqual(rows[1], { job: 'JOB/FY26-27/0002', date: '05/11/2026', client: 'Demo Imports, Pvt Ltd', iec: '0304012345', gstin: '27AAPFU0939F1ZV', doc: 'BOE 7654321 dt 04/11/2026', port: 'BOM', invoices: 'INV/1', billed: 204510, disb: 197430, deposits: 200000, status: 'Arrived' });
  assert.deepEqual([rows[0].doc, rows[0].port, rows[0].status, rows[0].billed], ['SB 5550001', 'BOM', 'Delivered', 0]);
  const csv = registerCsv(rows).split('\r\n');
  assert.equal(csv[0], REGISTER_HEAD.join(','));
  assert.equal(csv.length, 3);
  assert.match(csv[1], /^JOB\/FY26-27\/0001,01\/10\/2026,"'=HYPERLINK\(""x""\)",/, 'a formula is neutralised and quoted');
  assert.match(csv[2], /,"Demo Imports, Pvt Ltd",0304012345,/);
});

test('title from the rule in force; KYC hint', () => {
  assert.match(registerTitle('2026-11-05'), /CBLR 2018 Reg 10\(k\): Maintain up-to-date records/);
  assert.equal(registerTitle('2018-01-01'), 'Customs broker register');
  assert.equal(kycMissing(clients[0] as never), false);
  assert.equal(kycMissing(clients[1] as never), true);
  assert.equal(kycMissing(undefined), true);
});

test('SB / BOE numbers from a file: by job number, export to sb_*, import to boe_* + IGM; bad rows listed', () => {
  const jobs = [job('1', '2026-10-01', { dir: 'export', refs: { hbl: 'H1' } }), job('2', '2026-11-05')];
  const r = docRefsFromTable({ headers: ['Job No', 'BE / SB No.', 'Date', 'IGM No'], rows: [['job/fy26-27/0001', '5550001', '03/10/2026', ''], ['JOB/FY26-27/0002', '7654321', '2026-11-04', '2345'], ['JOB/FY26-27/0009', '1', '', ''], ['JOB/FY26-27/0002', '', '', ''], ['JOB/FY26-27/0001', '9', '31.13.2026x', '']] }, jobs);
  assert.deepEqual(r.ok, [{ id: '1', refs: { hbl: 'H1', sb_no: '5550001', sb_date: '2026-10-03' } }, { id: '2', refs: { boe_no: '7654321', boe_date: '2026-11-04', igm: '2345' } }]);
  assert.deepEqual(r.errors, ['Row 4: job not found', 'Row 5: no SB / BOE number', 'Row 6: date not read']);
});
