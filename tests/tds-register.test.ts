import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientKA, clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import {
  buildTdsRegister, certKey, certificateStatus, form16aDueDate, fyLabel, guessTdsMapping,
  normalizeDeductorName, parseTdsCsv, quarterRange, reconcileTds, sectionCode, setCertificate,
  tdsInvoiceLines, tdsPeriodOf, tdsReconCsv, tdsRegisterCsv, type TdsCertificate,
} from '../src/lib/tds-register.ts';
import { isValidTan } from '../src/lib/validators.ts';
import type { Client } from '../src/types/invoice.ts';

const MH: Client = { ...clientMH, pan: 'AAACB2230M', tan: 'PNEB12345C' };
const KA: Client = { ...clientKA, tan: 'BLRK54321D' };

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(MH);
  localDb.clients.upsert(KA);
});

const data = () => ({
  invoices: localDb.invoices.getAll(),
  payments: localDb.payments.getAll(),
  clients: localDb.clients.getAll(),
});

/** ₹10,000 taxable at 18% GST, 10% TDS on taxable → TDS ₹1,000, total ₹11,800. */
function tdsInvoice(date: string, client: Client = MH, rate = 10, section = '194J', qty = 1) {
  return createViaStore({ client, date, lines: [{ qty, rate: 10000 }], tds: { rate, section } });
}

/* ── Periods ─────────────────────────────────────────────────── */

test('tdsPeriodOf: quarters and the 31 Mar / 1 Apr FY boundary', () => {
  assert.deepEqual(tdsPeriodOf('2025-04-01'), { fy: 2025, quarter: 1, key: '2025-Q1' });
  assert.deepEqual(tdsPeriodOf('2025-06-30'), { fy: 2025, quarter: 1, key: '2025-Q1' });
  assert.deepEqual(tdsPeriodOf('2025-07-01'), { fy: 2025, quarter: 2, key: '2025-Q2' });
  assert.deepEqual(tdsPeriodOf('2025-12-31'), { fy: 2025, quarter: 3, key: '2025-Q3' });
  assert.deepEqual(tdsPeriodOf('2026-01-01'), { fy: 2025, quarter: 4, key: '2025-Q4' });
  assert.deepEqual(tdsPeriodOf('2026-03-31'), { fy: 2025, quarter: 4, key: '2025-Q4' });
  assert.deepEqual(tdsPeriodOf('2026-04-01'), { fy: 2026, quarter: 1, key: '2026-Q1' });
  assert.equal(tdsPeriodOf(''), null);
  assert.equal(tdsPeriodOf('not a date'), null);
  assert.equal(fyLabel(2025), 'FY25-26');
  assert.deepEqual(quarterRange(2025, 4), { from: '2026-01-01', to: '2026-03-31' });
  assert.equal(form16aDueDate(2025, 1), '2025-08-15');
  assert.equal(form16aDueDate(2025, 4), '2026-06-15');
});

test('isValidTan / sectionCode / normalizeDeductorName', () => {
  assert.ok(isValidTan('PNEB12345C'));
  assert.ok(isValidTan(' pneb12345c '));
  assert.ok(!isValidTan('PNEB1234C'));
  assert.ok(!isValidTan('AAACB2230M')); // a PAN is not a TAN
  assert.equal(sectionCode('194J - Fees for professional or technical services'), '194J');
  assert.equal(sectionCode('Sec 194-C'), '194C');
  assert.equal(sectionCode('194JB'), '194JB');
  assert.equal(normalizeDeductorName('M/s. Bharat Traders Pvt. Ltd.'), 'bharattraders');
  assert.equal(normalizeDeductorName('BHARAT TRADERS PRIVATE LIMITED (PNEB12345C)'), 'bharattraders');
});

/* ── Register ────────────────────────────────────────────────── */

test('register: 31 Mar and 1 Apr invoices land in different FYs and quarters', () => {
  tdsInvoice('2026-03-31');
  tdsInvoice('2026-04-01');
  const reg = buildTdsRegister(data(), { today: '2026-04-10' });
  assert.deepEqual(reg.fys, [2026, 2025]);
  assert.deepEqual(reg.quarters.map((q) => q.key), ['2026-Q1', '2025-Q4']);
  assert.equal(reg.quarters[1].label, 'Q4 (Jan–Mar) FY25-26');
  assert.equal(buildTdsRegister(data(), { fy: 2025 }).rows.length, 1);
  assert.equal(buildTdsRegister(data(), { fy: 2026 }).rows[0].periodKey, '2026-Q1');
});

test('register: deductor × section rows, expected vs settled, drafts / non-TDS / foreign currency ignored', () => {
  const a = tdsInvoice('2025-05-10'); // 194J, ₹1,000
  tdsInvoice('2025-06-15'); // 194J, ₹1,000, stays unpaid
  createViaStore({ client: MH, date: '2025-05-20', lines: [{ qty: 1, rate: 5000 }], tds: { rate: 2, section: '194C' } }); // ₹100
  tdsInvoice('2025-05-11', KA, 10, '194J', 2); // ₹2,000
  createViaStore({ client: MH, date: '2025-05-12', lines: [{ qty: 1, rate: 9999 }] }); // no TDS
  createViaStore({ client: MH, date: '2025-05-13', lines: [{ qty: 1, rate: 9999 }], tds: { rate: 10 }, asDraft: true });
  createViaStore({ client: MH, date: '2025-05-14', lines: [{ qty: 1, rate: 100 }], tds: { rate: 10 }, currency: 'USD' });

  // Customer pays the cash part (total - TDS) of the first invoice.
  localDb.payments.record({ invoiceId: a.id, amount: a.total - 1000, method: 'NEFT', date: '2025-06-01' });

  const reg = buildTdsRegister(data(), { today: '2025-07-01' });
  assert.equal(reg.quarters.length, 1);
  const q1 = reg.quarters[0];
  assert.equal(q1.deductors, 2);
  const mhJ = reg.rows.find((r) => r.partyKey === MH.id && r.section === '194J');
  assert.ok(mhJ);
  assert.equal(mhJ.invoiceCount, 2);
  assert.equal(mhJ.taxable, 20000);
  assert.equal(mhJ.total, 23600);
  assert.equal(mhJ.tdsExpected, 2000);
  assert.equal(mhJ.tdsSettled, 1000);
  assert.equal(mhJ.tdsPending, 1000);
  assert.equal(mhJ.tan, 'PNEB12345C');
  assert.equal(mhJ.pan, 'AAACB2230M');
  const mhC = reg.rows.find((r) => r.partyKey === MH.id && r.section === '194C');
  assert.equal(mhC?.tdsExpected, 100);
  assert.equal(reg.totals.tdsExpected, 4100);
  assert.equal(reg.totals.tdsSettled, 1000);
  assert.equal(reg.totals.invoiceCount, 4);
  const csv = tdsRegisterCsv(reg);
  assert.match(csv, /Verify with your CA/);
  assert.match(csv, /FY25-26,Q1,Bharat Traders,AAACB2230M,PNEB12345C,194J,2,20000,23600,2000,1000,1000,Awaited/);
});

test('register: invoice marked Paid counts its TDS as settled', () => {
  const inv = tdsInvoice('2025-08-01');
  localDb.invoices.setStatus(inv.id, 'Paid');
  const [line] = tdsInvoiceLines(data());
  assert.equal(line.settled, true);
  assert.equal(line.quarter, 2);
});

test('Form 16A: status per deductor × quarter, toggle and clear', () => {
  tdsInvoice('2025-05-10');
  tdsInvoice('2025-05-11', MH, 2, '194C');
  assert.equal(certificateStatus(undefined, 2025, 1, '2025-08-15'), 'awaited');
  assert.equal(certificateStatus(undefined, 2025, 1, '2025-08-16'), 'overdue');

  let certs: TdsCertificate[] = [];
  certs = setCertificate(certs, { partyKey: MH.id as string, partyName: MH.name, fy: 2025, quarter: 1, received: true, receivedOn: '2025-08-10', certificateNo: ' ABC123 ' }, '2025-08-10T10:00:00Z');
  assert.equal(certs.length, 1);
  assert.equal(certs[0].id, certKey(MH.id as string, 2025, 1));
  assert.equal(certs[0].certificate_no, 'ABC123');

  const reg = buildTdsRegister({ ...data(), certificates: certs }, { today: '2025-09-01' });
  // Both section rows of the deductor show the quarter's certificate.
  assert.deepEqual(reg.rows.map((r) => r.certificate), ['received', 'received']);
  assert.equal(reg.quarters[0].certificatesReceived, 1);

  // Re-marking replaces, unmarking removes.
  certs = setCertificate(certs, { partyKey: MH.id as string, partyName: MH.name, fy: 2025, quarter: 1, received: true });
  assert.equal(certs.length, 1);
  certs = setCertificate(certs, { partyKey: MH.id as string, partyName: MH.name, fy: 2025, quarter: 1, received: false });
  assert.equal(certs.length, 0);
  const after = buildTdsRegister({ ...data(), certificates: certs }, { today: '2025-09-01' });
  assert.equal(after.quarters[0].certificatesOverdue, 1);
});

/* ── CSV parsing ─────────────────────────────────────────────── */

test('parseTdsCsv: 26AS-style headers with a title block, totals row and zero-TDS rows', () => {
  const csv = [
    'Form 26AS - Part I - Details of Tax Deducted at Source',
    'Assessment Year 2026-27',
    'Sr. No.,Name of Deductor,TAN of Deductor,Section,Transaction Date,Amount Paid/Credited,Tax Deducted,TDS Deposited',
    '1,BHARAT TRADERS PVT LTD,PNEB12345C,194J,10-May-2025,"10,000.00","1,000.00","1,000.00"',
    '2,KARNATAKA TECH,BLRK54321D,194J,11/05/2025,20000,2000,2000',
    '3,Some Bank,MUMS11111A,194A,30-06-2025,500,0,0',
    'Total,,,,,30500,3000,3000',
  ].join('\r\n');
  const r = parseTdsCsv(csv);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.errors, []);
  assert.equal(r.zeroRows, 1);
  assert.equal(r.credits.length, 2);
  assert.deepEqual(
    { ...r.credits[0], line: 0 },
    { line: 0, deductorName: 'BHARAT TRADERS PVT LTD', tan: 'PNEB12345C', section: '194J', date: '2025-05-10', fy: 2025, quarter: 1, periodKey: '2025-Q1', amountPaid: 10000, tds: 1000 },
  );
  assert.equal(r.credits[1].date, '2025-05-11');
  // "Tax Deducted" wins over "TDS Deposited"; "Amount Paid/Credited" over plain amount columns.
  assert.equal(r.headers[r.mapping.tds as number], 'Tax Deducted');
  assert.equal(r.headers[r.mapping.amount_paid as number], 'Amount Paid/Credited');
});

test('parseTdsCsv: AIS-style "Information Source (TAN)", semicolons and other header spellings', () => {
  const csv = [
    'Information Source;Section Description;Date of Payment / Credit;Amount Paid or Credited;TDS Amount',
    'KARNATAKA TECH (BLRK54321D);194J - Fees for professional services;2026-01-15;30000;3000',
    'Unknown Corp;194C;15 Feb 2026;10000;200',
  ].join('\n');
  const r = parseTdsCsv(csv);
  assert.deepEqual(r.missing, []);
  assert.equal(r.credits.length, 2);
  assert.equal(r.credits[0].tan, 'BLRK54321D');
  assert.equal(r.credits[0].deductorName, 'KARNATAKA TECH');
  assert.equal(r.credits[0].section, '194J');
  assert.equal(r.credits[0].quarter, 4);
  assert.equal(r.credits[0].fy, 2025);
  assert.equal(r.credits[1].tan, '');
  assert.equal(r.credits[1].date, '2026-02-15');
});

test('parseTdsCsv: missing required columns and bad rows are reported, not guessed', () => {
  const none = parseTdsCsv('Party,Remarks\nA,B\n');
  assert.ok(none.missing.includes('TDS deducted'));
  assert.ok(none.missing.includes('Transaction date'));
  assert.equal(none.credits.length, 0);

  const bad = parseTdsCsv('Deductor Name,Date,TDS\nAcme,someday,100\nAcme,01-04-2025,abc\nAcme,01-04-2025,100\n');
  assert.equal(bad.credits.length, 1);
  assert.equal(bad.errors.length, 2);
  assert.match(bad.errors[0].message, /date/);
  assert.equal(bad.errors[0].line, 2);

  const m = guessTdsMapping(['TAN', 'Deductor', 'Date of Credit', 'TDS']);
  assert.deepEqual(m, { tan: 0, deductor_name: 1, date: 2, tds: 3 });
});

/* ── Reconciliation ──────────────────────────────────────────── */

test('reconcile: TAN match, name fallback, tolerance, only-in-26AS and only-in-books', () => {
  tdsInvoice('2025-05-10'); // MH ₹1,000
  tdsInvoice('2025-06-20'); // MH ₹1,000 — not in 26AS
  tdsInvoice('2025-05-11', KA, 10, '194J', 2); // KA ₹2,000

  const csv = [
    'Deductor Name,TAN,Section,Transaction Date,Amount Paid,TDS Deducted',
    'Bharat Traders Pvt Ltd,PNEB12345C,194J,2025-05-10,10000,1000.40', // within ₹1
    'karnataka tech,,194J,2025-05-30,20000,2000', // no TAN → name match
    'Stranger Ltd,ZZZZ99999Z,194C,2025-05-30,5000,100',
  ].join('\n');
  const { credits } = parseTdsCsv(csv);
  const rec = reconcileTds(credits, data());
  assert.equal(rec.matched.length, 2);
  assert.ok(rec.matched.every((m) => m.kind === 'line' && !m.quarterShift));
  assert.equal(rec.matched.find((m) => m.partyKey === MH.id)?.diff, 0.4);
  assert.equal(rec.only26as.length, 1);
  assert.equal(rec.only26as[0].known, false);
  assert.equal(rec.onlyBooks.length, 1);
  assert.equal(rec.onlyBooks[0].date, '2025-06-20');
  assert.equal(rec.totals.tds26as, 3100.4);
  assert.equal(rec.totals.tdsBooks, 4000);
  assert.equal(rec.totals.onlyBooks, 1000);

  // Tighter tolerance than the 40 paise gap → no longer a match.
  const strict = reconcileTds(credits, data(), { tolerance: 0.1 });
  assert.equal(strict.matched.length, 1);
  assert.match(tdsReconCsv(rec), /Only in 26AS.*Deductor not in your clients/);
});

test('reconcile: same quarter only — the same amount in another FY quarter is not a plain match', () => {
  tdsInvoice('2025-05-10'); // Q1
  const { credits } = parseTdsCsv('TAN,Date,TDS\nPNEB12345C,2025-11-10,1000\n'); // Q3, two quarters away
  const rec = reconcileTds(credits, data());
  assert.equal(rec.matched.length, 0);
  assert.equal(rec.only26as.length, 1);
  assert.equal(rec.onlyBooks.length, 1);
});

test('reconcile: 31 Mar invoice deducted on 1 Apr is a neighbouring-quarter match across FYs', () => {
  tdsInvoice('2026-03-31'); // FY25-26 Q4
  const { credits } = parseTdsCsv('TAN,Date,TDS\nPNEB12345C,01-04-2026,1000\n'); // FY26-27 Q1
  assert.equal(credits[0].fy, 2026);
  const rec = reconcileTds(credits, data());
  assert.equal(rec.matched.length, 1);
  assert.equal(rec.matched[0].quarterShift, true);
  assert.equal(rec.matched[0].fy, 2025);
  assert.equal(rec.only26as.length, 0);
  // The book line belongs to FY25-26, which the file does not cover, so it is not "only in books".
  assert.equal(rec.onlyBooks.length, 0);
});

test('reconcile: one 26AS entry covering two invoices matches on the quarter total', () => {
  tdsInvoice('2025-07-05');
  tdsInvoice('2025-08-05');
  const { credits } = parseTdsCsv('TAN,Section,Date,Amount Paid,TDS\nPNEB12345C,194J,2025-09-30,20000,2000\n');
  const rec = reconcileTds(credits, data());
  assert.equal(rec.matched.length, 1);
  assert.equal(rec.matched[0].kind, 'group');
  assert.equal(rec.matched[0].invoices.length, 2);
  assert.equal(rec.matched[0].diff, 0);
  assert.equal(rec.onlyBooks.length, 0);
});

test('reconcile: prefers the invoice with the same section when amounts tie', () => {
  createViaStore({ client: MH, date: '2025-05-01', lines: [{ qty: 1, rate: 50000 }], tds: { rate: 2, section: '194C' } }); // 1000
  tdsInvoice('2025-05-02'); // 194J 1000
  const { credits } = parseTdsCsv('TAN,Section,Date,TDS\nPNEB12345C,194J,2025-05-20,1000\n');
  const rec = reconcileTds(credits, data());
  assert.equal(rec.matched.length, 1);
  assert.equal(rec.matched[0].invoices[0].section, '194J');
  assert.equal(rec.onlyBooks[0].section, '194C');
});
