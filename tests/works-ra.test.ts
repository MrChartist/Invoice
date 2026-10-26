/** R5-B4: BOQ, measured RA bills, the abstract and the register; BOQ import. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupWorks, DEPT } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { cancelDocument } from '../src/lib/documents.ts';
import { addMonthsDay, billedQty, cancelMeasurement, deriveLines, nextRaNo, raRegister, saveRaBill } from '../src/lib/works/measurements.ts';
import { abstractRows, abstractTotals } from '../src/lib/works/ra-abstract.ts';
import { createBoqFromImport, mapBoqColumns, planBoqImport } from '../src/lib/works/boq.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

let boq: InvoiceRecord;
beforeEach(() => { boq = setupWorks(); });

test('cumulative ↔ this-bill derivation; exceeding the BOQ needs a reason', () => {
  const prev = new Map([['l1', 300]]);
  assert.deepEqual(deriveLines(boq, prev, [{ line_id: 'l1', cumulative_qty: 450 }]).map((l) => [l.cumulative_qty, l.this_qty]), [[450, 150]]);
  assert.deepEqual(deriveLines(boq, prev, [{ line_id: 'l1', this_qty: 100 }]).map((l) => [l.cumulative_qty, l.this_qty]), [[400, 100]]);
  assert.throws(() => deriveLines(boq, prev, [{ line_id: 'l1', cumulative_qty: 200 }]), /below/);
  assert.throws(() => deriveLines(boq, prev, [{ line_id: 'l1', cumulative_qty: 1100 }]), /exceeds the BOQ/);
  const x = deriveLines(boq, prev, [{ line_id: 'l1', cumulative_qty: 1100, extra_reason: 'Variation order 2' }]);
  assert.deepEqual(x[0].extra, { reason: 'Variation order 2' });
});

test('RA bills: numbered per BOQ, lines keep HSN / rate / GST, progress_line_of set; register and abstract add up', () => {
  const r1 = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400, mb_ref: 'MB 12/4' }, { line_id: 'l2', cumulative_qty: 50 }] });
  assert.equal(r1.invoice.ra_no, 1);
  assert.equal(r1.invoice.boq_id, boq.id);
  assert.equal(r1.invoice.status, 'Sent');
  assert.equal(r1.invoice.progress_of?.basis, 'measured');
  const l1 = r1.invoice.items.find((i) => i.progress_line_of === 'l1')!;
  assert.deepEqual([l1.quantity, l1.rate, l1.hsn, l1.tax_rate], [400, 250, '995411', 18]);
  assert.equal(r1.invoice.taxable_value, 100000 + 225000);
  assert.equal(r1.measurement.lines[0].mb_ref, 'MB 12/4');
  const r2 = saveRaBill(boq.id, { date: '2026-07-31', lines: [{ line_id: 'l1', cumulative_qty: 700 }] });
  assert.equal(r2.invoice.ra_no, 2);
  assert.equal(nextRaNo(boq.id, localDb.invoices.getAll()), 3);
  const all = localDb.invoices.getAll();
  const rows = abstractRows(boq, localDb.invoices.getById(r2.invoice.id)!, all);
  const e = rows.find((r) => r.lineId === 'l1')!;
  assert.deepEqual([e.prevQty, e.thisQty, e.cumQty, e.pct], [400, 300, 700, 70]);
  assert.equal(abstractTotals(rows).this, r2.invoice.taxable_value, 'this-bill column sums to the bill');
  assert.equal(abstractTotals(rows).cum, 100000 + 225000 + 75000);
  const reg = raRegister(boq.id, all, getTable('transactions'));
  assert.deepEqual(reg.map((r) => [r.raNo, r.gross]), [[1, r1.invoice.total], [2, r2.invoice.total]]);
  assert.equal(reg[1].cumulative, Math.round((r1.invoice.total + r2.invoice.total) * 100) / 100);
});

test('billed so far is net of a credit note; a cancelled RA bill gives its quantity back', () => {
  const r1 = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] });
  const links = () => getTable<{ from_id: string; to_id: string; relation: string }>('doc_links');
  assert.equal(billedQty(boq, localDb.invoices.getAll(), links()).get('l1'), 400);
  const cn = localDb.invoices.save({ ...r1.invoice, id: '', invoice_number: '', doc_type: 'CREDIT_NOTE', status: 'Sent', items: [{ ...r1.invoice.items[0], id: 'cn-l1', quantity: 100, amount: 25000 }], ra_deductions: undefined, ra_no: undefined, boq_id: undefined, progress_of: undefined });
  localDb.invoices.save(localDb.invoices.getById(cn.id)!);
  const rows = getTable('doc_links');
  (rows as unknown[]).push({ id: 'dl-cn', from_id: r1.invoice.id, to_id: cn.id, relation: 'credit_note', created_at: '' });
  setTable('doc_links', rows);
  assert.equal(billedQty(boq, localDb.invoices.getAll(), links()).get('l1'), 300, 'net of the credit note');
  const r2 = saveRaBill(boq.id, { date: '2026-07-15', lines: [{ line_id: 'l1', cumulative_qty: 500 }] });
  assert.equal(r2.measurement.lines[0].this_qty, 200, 'previous cumulative is net of the credit note');
  cancelDocument(localDb.invoices.getById(r2.invoice.id)!, 'Measurement revised');
  cancelDocument(localDb.invoices.getById(cn.id)!, 'Measurement revised');
  cancelDocument(localDb.invoices.getById(r1.invoice.id)!, 'Measurement revised');
  assert.equal(billedQty(boq, localDb.invoices.getAll(), links()).get('l1') ?? 0, 0);
  cancelMeasurement(r1.measurement.id);
  const again = saveRaBill(boq.id, { date: '2026-07-01', lines: [{ line_id: 'l1', cumulative_qty: 350 }] });
  assert.equal(again.invoice.ra_no, 1, 'the RA number of a cancelled bill is issued again');
});

test('excess with a reason prints as its own "Extra item" line', () => {
  const r = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 1100, extra_reason: 'VO-2 extra depth' }] });
  const lines = r.invoice.items.filter((i) => i.progress_line_of === 'l1');
  assert.deepEqual(lines.map((l) => [l.name.startsWith('Extra item'), l.quantity]), [[false, 1000], [true, 100]]);
  assert.equal(r.invoice.progress_of?.over_reason, 'VO-2 extra depth');
});

test('final RA bill that reaches the BOQ bills the remaining balance to the paisa', () => {
  saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 333.333 }, { line_id: 'l2', cumulative_qty: 66.667 }] });
  const fin = saveRaBill(boq.id, { date: '2026-08-31', lines: [{ line_id: 'l1', cumulative_qty: 1000 }, { line_id: 'l2', cumulative_qty: 200 }], final: true });
  assert.equal(fin.invoice.ra_final, true);
  assert.equal(fin.invoice.progress_of?.final, true);
  const bills = localDb.invoices.getAll().filter((i) => i.boq_id === boq.id);
  assert.equal(Math.round(bills.reduce((s, b) => s + b.taxable_value, 0) * 100) / 100, 1150000);
});

test('BOQ import: header mapping, skipped rows, sales order with item numbers', () => {
  const table = { headers: ['Sl No', 'Description of work', 'Unit', 'Qty', 'Rate', 'SAC'], rows: [['1.1', 'Site clearance', 'SQM', '500', '12.5', '995411'], ['', 'Note: rates incl. lead', '', '', '', ''], ['1.2', 'Excavation', 'CUM', '80', '300', '']] };
  const cols = mapBoqColumns(table.headers);
  assert.deepEqual(cols, { ref: 0, description: 1, unit: 2, qty: 3, rate: 4, hsn: 5 });
  const plan = planBoqImport(table, cols);
  assert.equal(plan.lines.length, 2);
  assert.deepEqual(plan.skipped, [3]);
  const so = createBoqFromImport(plan.lines, { client: { ...DEPT }, date: '2026-05-10', workOrder: 'WO/PWD/77', government: true });
  assert.equal(so.doc_type, 'SALES_ORDER');
  assert.deepEqual(so.items.map((i) => [i.boq_ref, i.quantity, i.tax_rate]), [['1.1', 500, 18], ['1.2', 80, 18]]);
  assert.equal(so.taxable_value, 6250 + 24000);
  assert.equal(so.boq_terms?.work_order, 'WO/PWD/77');
  assert.equal(createBoqFromImport(plan.lines, { client: { ...DEPT }, date: '2025-05-10', government: true }).items[0].tax_rate, 12, 'government works rate before 22 Sep 2025');
  assert.equal(addMonthsDay('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsDay('2026-08-31', 12), '2027-08-31');
});
