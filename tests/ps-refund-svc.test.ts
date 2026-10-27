/** R14 PS-C3: Rule 89(4) services refund paper (advances), statement rows, short-realisation split, one draft claim. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { buildRegister } from '../src/lib/trade/export-register.ts';
import { brcRows } from '../src/lib/prof/ps-brc.ts';
import { refundSvcPaper, saveDraftClaim, statementSheet, STATEMENT_HEADER } from '../src/lib/prof/ps-refund-svc.ts';
import { loadRefunds } from '../src/lib/gst-cash-refunds.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { ExportIrm } from '../src/types/trade-r4.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const svc = [{ id: 'l', name: 'Consulting', type: 'Service', hsn: '998311', quantity: 1, rate: 1000, tax_rate: 0, amount: 1000 }] as InvoiceRecord['items'];
const exp = (id: string, over: Partial<InvoiceRecord> = {}): Partial<InvoiceRecord> => ({
  id, invoice_number: `EXP/${id}`, doc_type: 'INVOICE', status: 'Sent', supply_type: 'EXPORT_LUT', place_of_supply: '96', currency: 'USD', exchange_rate: 80,
  total: 1000, taxable_value: 1000, issue_date: '2026-10-05', client: { name: 'Acme' } as InvoiceRecord['client'], items: svc, ...over,
});
const dom = { id: 'd', invoice_number: 'INV/1', doc_type: 'TAX_INVOICE', status: 'Sent', supply_type: 'B2B', place_of_supply: '27', currency: 'INR', taxable_value: 200000, total: 236000, issue_date: '2026-11-01', items: svc } as Partial<InvoiceRecord>;
const Q = { from: '2026-10-01', to: '2026-12-31' };

test('Rule 89(4)(C): receipts in the period + earlier advances for services completed now − advances not completed', () => {
  const invoices = [exp('a'), exp('b', { issue_date: '2026-11-10' }), exp('c', { issue_date: '2026-07-01' }), exp('old', { issue_date: '2026-06-01' }), dom];
  const payments: Partial<Payment>[] = [
    { id: 'p1', invoice_id: 'a', amount: 1000, date: '2026-11-15', realised_rate: 82 }, // ₹82,000 in the period
    { id: 'p2', invoice_id: 'c', amount: 500, date: '2026-10-20' }, // invoice of Q1, paid in Q3: counts (₹40,000)
    { id: 'p3', invoice_id: 'old', amount: 1000, date: '2026-09-30' }, // paid before the period: no
    { id: 'p4', invoice_id: 'b', amount: 300, date: '2026-11-10', advance_id: 'adv-early' }, // advance of June, completed now: ₹24,000
    { id: 'p5', invoice_id: 'b', amount: 200, date: '2026-11-10', advance_id: 'adv-now' }, // advance of Oct, completed now: ₹16,000
    { id: 'p6', invoice_id: 'b', amount: 100, date: '2026-11-10', advance_id: 'adv-late' }, // advance after the period: no
    { id: 'p7', invoice_id: 'a', amount: 1, date: '2026-11-15', write_off: true }, // no money
  ];
  const advances = [{ id: 'adv-early', date: '2026-06-15' }, { id: 'adv-now', date: '2026-10-02' }, { id: 'adv-late', date: '2027-01-05' }];
  const p = refundSvcPaper({ ...Q, invoices, payments, advances, netItc: { igst: 30000, cgst: 10000, sgst: 10000, cess: 0 } });
  assert.deepEqual([p.received, p.advancesEarlier, p.advancesNow, p.zeroRated, p.domestic, p.adjustedTotalTurnover], [122000, 24000, 16000, 162000, 200000, 362000]);
  assert.equal(p.result.byHead.igst, Math.round(30000 * 162000 / 362000 * 100) / 100);
  assert.deepEqual(p.invoiceIds.sort(), ['a', 'b', 'c']);
  // A typed adjusted total turnover wins.
  assert.equal(refundSvcPaper({ ...Q, invoices, payments, advances, netItc: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, adjustedTotalTurnover: 500000 }).adjustedTotalTurnover, 500000);
});

test('statement rows carry FIRA / e-BRC; short realisation split into bank charges and unrealised', () => {
  const invoices = [exp('a'), exp('b', { issue_date: '2026-11-10' })];
  const payments: Partial<Payment>[] = [{ id: 'p1', invoice_id: 'a', amount: 1000, date: '2026-11-15' }, { id: 'p2', invoice_id: 'b', amount: 600, date: '2026-11-20' }];
  const irms = [{ id: 'm1', irm_no: 'IRM1', date: '2026-11-15', currency: 'USD', fcy: 985, allocations: [{ invoice_id: 'a', fcy: 985 }], ebrc_no: 'EBRC9', ebrc_date: '2026-11-30', ps: { fira_no: 'FIRA-1' } }] as (ExportIrm & { ps: { fira_no: string } })[];
  const rows = brcRows(buildRegister({ invoices, payments, irms, writeoffs: [], today: '2026-12-31' }), invoices, payments, irms);
  const a = rows.find((r) => r.invoiceId === 'a')!;
  assert.deepEqual([a.fira, a.ebrc.map((e) => `${e.no}@${e.date}`), a.chargesFcy, a.chargesReason, a.unrealisedFcy], [['FIRA-1'], ['EBRC9@2026-11-30'], 15, 'bank', 0]);
  const b = rows.find((r) => r.invoiceId === 'b')!;
  assert.deepEqual([b.chargesFcy, b.unrealisedFcy, b.realisedInr], [0, 400, 48000]);
  const sheet = statementSheet(rows, ['a']);
  assert.deepEqual(sheet[0], STATEMENT_HEADER);
  assert.deepEqual(sheet[1], ['EXP/a', '2026-10-05', 'USD', 1000, 80000, 'FIRA-1', 'EBRC9', '2026-11-30', 1000, 80000]);
});

test('the draft claim of the refund register is written once (a second save updates it)', () => {
  const invoices = [exp('a')];
  const payments: Partial<Payment>[] = [{ id: 'p1', invoice_id: 'a', amount: 1000, date: '2026-11-15' }];
  const paper = refundSvcPaper({ ...Q, invoices, payments, advances: [], netItc: { igst: 9000, cgst: 0, sgst: 0, cess: 0 } });
  const first = saveDraftClaim(Q.from, Q.to, paper);
  const again = saveDraftClaim(Q.from, Q.to, paper);
  assert.equal(first.id, again.id);
  assert.equal(loadRefunds().length, 1);
  assert.deepEqual([first.category, first.status, first.claimed.igst], ['EXPORT_LUT_ITC', 'DRAFT', 9000]);
});
