/**
 * R4-C2: export realisation register (9 / 15 months by shipment date, receipts and IRMs, split IRMs, overdue,
 * write-offs, missing shipping bill), IRM CSV import with column mapping, matching, incentives maths and journals,
 * bell notices.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  addMonths, allocationProblems, autoAllocate, bankStatementSheet, buildRegister, guessIrmMapping, irmsDb, parseIrmCsv, registerSheet,
  suggestMatches, unrealisedAt, writeoffsDb,
} from '../src/lib/trade/export-register.ts';
import { exportRealisationMonths } from '../src/lib/trade/trade-rules.ts';
import {
  claimLines, creditLines, incentiveFigures, incentivesDb, postIncentiveClaim, recordIncentiveCredit, transferLines, transferScrip, utilisationLines,
  utiliseScrip,
} from '../src/lib/trade/export-incentives.ts';
import { realisationNotices } from '../src/lib/trade/export-alerts.ts';
import { parseDate } from '../src/lib/importers.ts';
import { getTable } from '../src/lib/storage.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import type { ExportIrm } from '../src/types/trade-r4.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

beforeEach(() => resetStorage());

const exp = (id: string, over: Partial<InvoiceRecord> = {}): Partial<InvoiceRecord> => ({
  id, invoice_number: `EXP/FY25-26/${id}`, doc_type: 'INVOICE', status: 'Sent', supply_type: 'EXPORT_LUT', place_of_supply: '96',
  currency: 'USD', total: 10000, issue_date: '2025-10-01', shipping_bill_no: `SB${id}`, shipping_bill_date: '2025-10-05',
  client: { name: 'Gulf Traders LLC' } as InvoiceRecord['client'], ...over,
});
const irm = (over: Partial<ExportIrm>): ExportIrm => ({ id: over.irm_no ?? 'r', irm_no: 'IRM1', date: '2026-01-10', currency: 'USD', fcy: 0, allocations: [], ...over });
const reg = (invoices: Partial<InvoiceRecord>[], extra: { payments?: Partial<Payment>[]; irms?: ExportIrm[]; today?: string } = {}) =>
  buildRegister({ invoices, payments: extra.payments ?? [], irms: extra.irms ?? [], writeoffs: writeoffsDb.all(), today: extra.today ?? '2026-02-01' });

test('realisation period: 9 months for shipments before the Nov 2025 amendment, 15 after (dated rule, by shipment date)', () => {
  assert.equal(exportRealisationMonths('2025-10-05'), 9);
  assert.equal(exportRealisationMonths('2025-12-01'), 15);
  assert.equal(addMonths('2025-01-31', 1), '2025-02-28', 'clamped to the month end');
  const [before, after] = reg([exp('1'), exp('2', { shipping_bill_date: '2025-12-01', issue_date: '2025-11-30' })]);
  assert.equal(before.dueDate, '2026-07-05');
  assert.equal(after.dueDate, '2027-03-01');
  assert.equal(before.months, 9);
  assert.equal(after.months, 15);
});

test('part realisation by receipt and by IRM (the larger, never both added), split IRM over two invoices', () => {
  const pay: Partial<Payment>[] = [{ invoice_id: '1', amount: 4000, date: '2026-01-05' }, { invoice_id: '1', amount: 500, date: '2026-01-06', write_off: true }];
  let [r] = reg([exp('1')], { payments: pay });
  assert.deepEqual([r.receivedFcy, r.realisedFcy, r.outstandingFcy, r.status], [4000, 4000, 6000, 'part'], 'a bad-debt write-off is not realisation');
  [r] = reg([exp('1')], { payments: [...pay, { invoice_id: '1', amount: 1000, date: '2026-01-07', gift_voucher_id: 'gv1' } as Partial<Payment>] });
  assert.equal(r.realisedFcy, 4000, 'a gift-voucher redemption (R4-B) moves no foreign exchange');
  [r] = reg([exp('1')], { payments: pay, irms: [irm({ fcy: 4000, allocations: [{ invoice_id: '1', fcy: 4000 }] })] });
  assert.equal(r.realisedFcy, 4000, 'the IRM of the same remittance is not added to the receipt');
  const split = irm({ irm_no: 'IRM-SPLIT', fcy: 15000, allocations: [{ invoice_id: '1', fcy: 10000 }, { invoice_id: '2', fcy: 5000 }], ebrc_no: 'EBRC9', ebrc_status: 'self_certified' });
  const rows = reg([exp('1'), exp('2')], { irms: [split] });
  assert.deepEqual(rows.map((x) => [x.number, x.status, x.outstandingFcy]), [['EXP/FY25-26/1', 'realised', 0], ['EXP/FY25-26/2', 'part', 5000]]);
  assert.equal(rows[1].irms[0].ebrc_no, 'EBRC9');
  assert.deepEqual(allocationProblems(split, split.allocations, rows), []);
  assert.deepEqual(allocationProblems({ id: 'x', fcy: 100, currency: 'USD' }, [{ invoice_id: '2', fcy: 200 }], rows), ['allocOver']);
});

test('overdue after the due date; a reasoned write-off closes it; drafts and domestic invoices are not followed', () => {
  const rows = reg([exp('1'), exp('d', { status: 'Draft' }), exp('b2b', { supply_type: 'B2B', place_of_supply: '27' })], { today: '2026-07-10' });
  assert.deepEqual(rows.map((r) => [r.number, r.status, r.daysLeft]), [['EXP/FY25-26/1', 'overdue', -5]]);
  assert.throws(() => writeoffsDb.save({ invoice_id: '1', date: '2026-07-10', reason: ' ', fcy: 10000 }), /woReason/);
  writeoffsDb.save({ invoice_id: '1', date: '2026-07-10', reason: 'Buyer insolvent: AD bank approval 12/2026', fcy: 10000 });
  const [r] = reg([exp('1')], { today: '2026-07-10' });
  assert.deepEqual([r.status, r.writtenOffFcy, r.outstandingFcy], ['written_off', 10000, 0]);
  assert.match(r.writeOffReason ?? '', /insolvent/);
});

test('an invoice without a shipping bill is flagged and counted from the invoice date', () => {
  const [r] = reg([exp('1', { shipping_bill_no: undefined, shipping_bill_date: undefined, issue_date: '2025-09-01' })]);
  assert.equal(r.sbMissing, true);
  assert.equal(r.shipDate, '2025-09-01');
  assert.equal(r.dueDate, '2026-06-01');
  const notices = realisationNotices([r], 'now');
  assert.ok(notices.some((n) => n.id.startsWith('exp-nosb:')));
});

test('IRM CSV import: columns mapped from bank / DGFT headers, day-first dates, bad rows skipped; duplicates by number', () => {
  const csv = 'IRM Number,Remittance Date,Remittance Currency,Remittance Amount,AD Bank,Purpose Code,Remitter Name\n' +
    'IRM0001,05/01/2026,USD,"4,000.00",HDFC Bank,P0103,Gulf Traders LLC\n' +
    ',06/01/2026,USD,10,HDFC,P0103,X\n' +
    'IRM0002,2026-01-20,usd,6000,HDFC Bank,P0103,Gulf Traders\n';
  const m = guessIrmMapping(['IRM Number', 'Remittance Date', 'Remittance Currency', 'Remittance Amount', 'AD Bank', 'Purpose Code', 'Remitter Name']);
  assert.deepEqual(m, { irm_no: 0, date: 1, currency: 2, fcy: 3, bank: 4, purpose: 5, remitter: 6 });
  const out = parseIrmCsv(csv, parseDate);
  assert.deepEqual(out.rows.map((r) => [r.irm_no, r.date, r.currency, r.fcy]), [['IRM0001', '2026-01-05', 'USD', 4000], ['IRM0002', '2026-01-20', 'USD', 6000]]);
  assert.deepEqual(out.skipped, [{ row: 2, reason: 'irmNoMissing' }]);
  assert.equal(irmsDb.importMany(out.rows), 2);
  assert.equal(irmsDb.importMany(out.rows), 0, 'already imported');
  const remapped = parseIrmCsv(csv, parseDate, { ...m, remitter: -1 });
  assert.equal(remapped.rows[0].remitter, undefined, 'a column can be unmapped');
});

test('matching suggests the exact outstanding of the same party first; auto-allocation never exceeds what is owed', () => {
  const rows = reg([exp('1', { total: 4000 }), exp('2', { total: 6000, client: { name: 'Other Co' } as InvoiceRecord['client'] })]);
  const s = suggestMatches({ currency: 'USD', fcy: 4000, date: '2026-01-05', remitter: 'GULF TRADERS LLC' }, rows);
  assert.equal(s[0].number, 'EXP/FY25-26/1');
  assert.deepEqual(autoAllocate({ currency: 'USD', fcy: 4000, date: '2026-01-05', remitter: 'Gulf Traders' }, rows), [{ invoice_id: '1', fcy: 4000 }]);
  assert.deepEqual(suggestMatches({ currency: 'EUR', fcy: 4000, date: '2026-01-05' }, rows), [], 'other currency');
});

test('register outputs: CSV sheet, bank statement per party, unrealised as at 31 March', () => {
  const invoices = [exp('1'), exp('2', { issue_date: '2026-04-02', shipping_bill_date: '2026-04-03' })];
  const rows = reg(invoices, { today: '2026-05-01' });
  assert.equal(registerSheet(rows).length, 3);
  assert.equal(bankStatementSheet(rows, 'Gulf Traders LLC').length, 4);
  const asAt = unrealisedAt({ invoices, payments: [{ invoice_id: '1', amount: 10000, date: '2026-04-10' }], irms: [], writeoffs: [] }, '2026-03-31');
  assert.deepEqual(asAt.map((r) => r.number), ['EXP/FY25-26/1'], 'paid after 31 March, so unrealised then; shipped after → not listed');
});

test('incentives: receivable = claimed − credited; journals balance; RoDTEP scrip used and sold', () => {
  const L = { receivable: 'r', income: 'i', bank: 'b', customsPayable: 'c' };
  const sum = (ls: { dr: number; cr: number }[]) => ls.reduce((s, l) => s + l.dr - l.cr, 0);
  for (const ls of [claimLines(1234.56, L), creditLines(1000, L), utilisationLines(99.99, L), transferLines(1000, 950, L), transferLines(1000, 1010, L)]) assert.equal(sum(ls), 0);
  assert.deepEqual(transferLines(1000, 950, L).map((l) => [l.account_id, l.dr, l.cr]), [['b', 95000, 0], ['r', 0, 100000], ['i', 5000, 0]]);
  assert.deepEqual(incentiveFigures({ kind: 'drawback', claimed: 5000, credited: 3000 }), { claimed: 5000, credited: 3000, receivable: 2000, utilised: 0, transferred: 0, scripBalance: 0 });

  const row = incentivesDb.save({ invoice_id: '1', kind: 'rodtep', date: '2026-04-10', claimed: 2000, rate: 2 });
  postIncentiveClaim(row.id, '2026-04-10', 'EXP/1');
  assert.throws(() => postIncentiveClaim(row.id, '2026-04-10'), /incPostedClaim/);
  recordIncentiveCredit(row.id, 2000, '2026-05-01', { no: 'SCRIP-1' });
  utiliseScrip(row.id, 'bill-1', 1500, '2026-05-05');
  assert.throws(() => utiliseScrip(row.id, 'bill-2', 600, '2026-05-06'), /incScripShort/);
  const sold = transferScrip(row.id, 500, 480, '2026-05-07');
  const f = incentiveFigures(sold);
  assert.deepEqual([f.receivable, f.utilised, f.transferred, f.scripBalance], [0, 1500, 500, 0]);
  const vs = loadVouchers();
  assert.equal(vs.length, 3, 'claim, utilisation, sale (a scrip credit moves no money)');
  for (const v of vs) assert.equal(v.lines.reduce((s, l) => s + l.dr - l.cr, 0), 0, `${v.number} balances`);
  const names = chartOf(loadUserAccounts()).map((a) => a.name);
  for (const n of ['Export incentives receivable', 'Export incentives income', 'Customs duty payable']) assert.ok(names.includes(n), `${n} created on first use`);
  assert.throws(() => incentivesDb.remove(row.id), /incHasJournals/);

  const db = incentivesDb.save({ invoice_id: '1', kind: 'drawback', date: '2026-04-10', claimed: 800 });
  assert.throws(() => recordIncentiveCredit(db.id, 900, '2026-05-01'), /incCreditOver/);
  recordIncentiveCredit(db.id, 800, '2026-05-01');
  assert.equal(getTable('vouchers').length, 4, 'drawback credit is a bank receipt');
});

test('bell: overdue (with the Rule 96A note), due within 60 days', () => {
  const rows = reg([exp('1'), exp('2', { shipping_bill_date: '2025-06-01', issue_date: '2025-06-01' })], { today: '2026-05-20' });
  const n = realisationNotices(rows, 'now');
  assert.deepEqual(n.map((x) => [x.id.split(':')[0], x.severity]), [['exp-overdue', 'critical'], ['exp-due', 'warning']]);
  assert.match(n[0].detail, /Rule 96A: verify with your CA/);
});

test('QA6 F6: an export saved as "Tax Invoice" is followed for realisation; non-supply documents are not', () => {
  const rows = reg([exp('1', { doc_type: 'TAX_INVOICE' }), exp('2', { doc_type: 'QUOTATION' }), exp('3', { doc_type: 'PROFORMA' }), exp('4', { doc_type: 'CREDIT_NOTE' })]);
  assert.deepEqual(rows.map((r) => r.invoiceId), ['1']);
  assert.equal(unrealisedAt({ invoices: [exp('1', { doc_type: 'TAX_INVOICE' })], payments: [], irms: [], writeoffs: [] }, '2026-03-31').length, 1);
});

test('QA6 F15: live credit notes linked to an export reduce its realisable value', () => {
  const cn = (id: string, status: InvoiceRecord['status']): Partial<InvoiceRecord> => ({ id, doc_type: 'CREDIT_NOTE', status, currency: 'USD', total: 2000, place_of_supply: '96', supply_type: 'EXPORT_LUT', issue_date: '2025-11-01' });
  const links = [{ from_id: '1', to_id: 'c1', relation: 'credit_note' }, { from_id: '1', to_id: 'c2', relation: 'credit_note' }];
  const [row] = buildRegister({
    invoices: [exp('1'), cn('c1', 'Sent'), cn('c2', 'Cancelled')], links, payments: [{ invoice_id: '1', amount: 8000, date: '2026-01-05' }],
    irms: [], writeoffs: [], today: '2027-06-01',
  });
  assert.equal(row.fcy, 8000, 'total less the live credit note (the cancelled one is ignored)');
  assert.equal(row.outstandingFcy, 0);
  assert.equal(row.status, 'realised', 'not overdue');
});
