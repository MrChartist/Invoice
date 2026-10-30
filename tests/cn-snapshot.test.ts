/** CN-A3: the contract-particulars header (contract / BOQ / typed), line snapshot, normalizeRecord round trip. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupWorks } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setTable } from '../src/lib/storage.ts';
import { saveBoqTerms } from '../src/lib/works/boq.ts';
import { saveRaBill } from '../src/lib/works/measurements.ts';
import { cnHeaderSnapshot, hasCnPaper, mbNumbers, ordinal, raLabel } from '../src/lib/construction/cn-snapshot.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import { worksLineText, raDocTitle } from '../src/components/templates/paper-helpers.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

let boq: InvoiceRecord;
beforeEach(() => { boq = setupWorks(); });

test('ordinal labels and M-book numbers', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  assert.equal(raLabel(4), '4th RA bill (running)');
  assert.equal(raLabel(4, true), 'Final bill');
  assert.deepEqual(mbNumbers(['112/45-47', 'MB 112 pp 50', '118/2', undefined]), ['112', '118']);
});

test('header from the BOQ (typed fields, work order) and from a contract row (CN-B1) which wins', () => {
  const typed = { ...boq, boq_terms: { work_order: 'WO/77', header: { name_of_work: 'Widening of SH-12', engineer: 'EE, Div 3', site: { address: 'Km 4–9', state_code: '27' } } } };
  const h = cnHeaderSnapshot(typed, undefined, { raNo: 4, date: '2026-11-02', period_from: '2026-10-01', period_to: '2026-10-31' }, 1150000);
  assert.deepEqual(h, { name_of_work: 'Widening of SH-12', work_order_no: 'WO/77', engineer: 'EE, Div 3', site: { address: 'Km 4–9', state_code: '27' }, contract_value: 1150000, ra_label: '4th RA bill (running)', period_from: '2026-10-01', period_to: '2026-10-31', measured_on: '2026-11-02' });
  const c = cnHeaderSnapshot(typed, { agreement_no: '12/EE/2026-27', agreement_date: '2026-04-15', name_of_work: 'SH-12 widening (contract)', contract_value: 1200000, stipulated_completion: '2027-03-31' }, { raNo: 1, final: true, date: '2026-11-02', mb_refs: ['112/4'] }, 1150000);
  assert.equal(c.name_of_work, 'SH-12 widening (contract)');
  assert.equal(c.contract_value, 1200000);
  assert.equal(c.ra_label, 'Final bill');
  assert.deepEqual(c.mb_nos, ['112']);
});

test('saveRaBill writes the snapshot: header from the contract table, line refs / MB, quantities equal the abstract', () => {
  setTable('works_contracts', [{ id: 'k1', boq_id: boq.id, agreement_no: 'AG-9', name_of_work: 'Road work', deviation_pct: 10 }]);
  saveBoqTerms(boq.id, { ...boq.boq_terms, header: { client_office: 'PWD Division 3' } });
  const r1 = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400, mb_ref: '112/45-47' }] });
  const r2 = saveRaBill(boq.id, { date: '2026-07-31', lines: [{ line_id: 'l1', cumulative_qty: 700, mb_ref: '113/2' }] });
  const cn = r2.invoice.boq_terms!.cn!;
  assert.equal(cn.header!.agreement_no, 'AG-9');
  assert.equal(cn.header!.client_office, 'PWD Division 3');
  assert.equal(cn.header!.ra_label, '2nd RA bill (running)');
  assert.equal(cn.header!.period_from, '2026-07-01', 'the day after the previous bill');
  assert.equal(cn.deviation_pct, 10, 'contract deviation limit');
  const line = cn.lines![r2.invoice.items[0].id];
  assert.deepEqual([line.ref, line.mb, line.kind, line.cls, line.boq_qty, line.prev_qty, line.cum_qty], ['2.1', '113/2', 'boq', 'wc_general', 1000, 400, 700]);
  const row = cn.abstract!.find((x) => x.id === 'l1')!;
  assert.equal(line.cum_amount, row.cum_amount);
  assert.equal(worksLineText(r2.invoice.items[0], cn), 'Item 2.1 · MB 113/2');
  assert.equal(raDocTitle(r2.invoice, 'Tax Invoice'), 'Tax Invoice: Running Account Bill No. 2');
  assert.equal(r1.invoice.boq_terms!.cn!.header!.ra_label, '1st RA bill (running)');
});

test('old documents print unchanged; the snapshot survives normalizeRecord (load → edit → save)', () => {
  assert.equal(worksLineText({ id: 'x' }, undefined), '');
  assert.equal(raDocTitle({}, 'Tax Invoice'), '');
  assert.equal(hasCnPaper(boq), false, 'a BOQ has terms but no snapshot');
  const r = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400, mb_ref: '9/1' }] });
  assert.ok(hasCnPaper(r.invoice));
  const round = normalizeRecord(JSON.parse(JSON.stringify(r.invoice)));
  assert.deepEqual(round.boq_terms!.cn, r.invoice.boq_terms!.cn);
  const saved = localDb.invoices.save({ ...round, notes: 'edited' });
  assert.deepEqual(localDb.invoices.getById(saved.id)!.boq_terms!.cn, r.invoice.boq_terms!.cn);
});
