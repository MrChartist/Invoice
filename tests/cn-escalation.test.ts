/** R11 CN-B3: price variation — formula, shares, exclusions, supplementary bill / credit note, Sec 34, snapshot print. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupWorks, DEPT } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { saveRaBill } from '../src/lib/works/measurements.ts';
import { saveContract } from '../src/lib/construction/cn-contracts.ts';
import { billPv, cancelPv, loadPvs, pvFormula, pvWorkValue, readIndexSheet, savePv, sec34Deadline } from '../src/lib/construction/cn-escalation.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { WorksContract } from '../src/types/construction-r11.ts';

let boq: InvoiceRecord;
let c: WorksContract;
beforeEach(() => {
  boq = setupWorks();
  c = saveContract({ boq_id: boq.id, client_id: DEPT.id, client_name: DEPT.name, name_of_work: 'Road', agreement_no: 'AG/1', contract_value: 1150000, escalation: { formula: 'cpwd_10cc', clause: '10CC', base_month: '2026-03', components: [{ key: 'cement', share_pct: 20, base_index: 400 }, { key: 'steel', share_pct: 30, base_index: 500 }, { key: 'labour', share_pct: 50, base_index: 300 }] } });
});

const up = [{ key: 'cement', current_index: 440 }, { key: 'steel', current_index: 450 }, { key: 'labour', current_index: 330 }];

test('formula against a hand example; shares ≠ 100 refused; zero base refused', () => {
  // Σ = 20%×+10% + 30%×−10% + 50%×+10% = 0.02 − 0.03 + 0.05 = 0.04; PV = 0.85 × 10,00,000 × 0.04 = ₹34,000
  const f = pvFormula(0.85, 1000000, [{ key: 'cement', share_pct: 20, base_index: 400, current_index: 440 }, { key: 'steel', share_pct: 30, base_index: 500, current_index: 450 }, { key: 'labour', share_pct: 50, base_index: 300, current_index: 330 }]);
  assert.equal(f.sum, 0.04);
  assert.equal(f.amount, 34000);
  assert.throws(() => pvFormula(0.85, 1, [{ key: 'a', share_pct: 60, base_index: 1, current_index: 1 }]), /add up to 60%/);
  assert.throws(() => pvFormula(0.85, 1, [{ key: 'a', share_pct: 100, base_index: 0, current_index: 1 }]), /above zero/);
  assert.deepEqual(readIndexSheet({ headers: ['Component', 'Current index'], rows: [['Cement', '440'], ['Steel', '450.5']] }), { cement: 440, steel: 450.5 });
});

test('work value from the period\'s RA bills; extra items excluded when the clause says so', () => {
  saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }, { line_id: 'l2', cumulative_qty: 10, kind: 'extra', approval: 'EE/7' }] });
  saveRaBill(boq.id, { date: '2026-07-15', lines: [{ line_id: 'l1', cumulative_qty: 500 }] });
  const all = localDb.invoices.getAll();
  assert.equal(pvWorkValue(c, all, '2026-04-01', '2026-06-30'), 145000);
  assert.equal(pvWorkValue({ ...c, escalation: { ...c.escalation!, exclusions: ['extra_items'] } }, all, '2026-04-01', '2026-06-30'), 100000);
});

test('positive PV → supplementary works invoice with the working snapshot; overlap refused; cancel needs the document cancelled', () => {
  saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] });
  const pv = savePv({ contract: c, date: '2026-07-05', period_from: '2026-04-01', period_to: '2026-06-30', indices: up });
  assert.match(pv.number, /^PVB\/FY26-27\/0001$/);
  assert.equal(pv.amount, 3400);
  assert.throws(() => savePv({ contract: c, date: '2026-07-05', period_from: '2026-06-01', period_to: '2026-07-31', indices: up }), /already covers/);
  const { doc, late } = billPv(pv.id, '2026-07-06');
  assert.equal(late, undefined);
  assert.equal(doc.doc_type, 'INVOICE');
  assert.equal(doc.taxable_value, 3400);
  assert.equal(doc.total, 4012, 'GST at the works rate of the RA bills (verify per contract)');
  assert.equal(doc.boq_terms?.cn?.pv?.amount, 3400);
  assert.equal(doc.boq_terms?.cn?.pv?.rows?.length, 3);
  assert.equal(doc.boq_terms?.cn?.header?.agreement_no, 'AG/1');
  assert.equal(loadPvs()[0].status, 'billed');
  assert.throws(() => cancelPv(pv.id), /Cancel/);
});

test('negative PV → credit note linked to the period\'s last RA bill; Sec 34 time-limit warning', () => {
  const ra = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] }).invoice;
  assert.equal(sec34Deadline('2026-06-30'), '2027-11-30');
  const pv = savePv({ contract: c, date: '2027-12-10', period_from: '2026-04-01', period_to: '2026-06-30', indices: [{ key: 'cement', current_index: 360 }, { key: 'steel', current_index: 450 }, { key: 'labour', current_index: 270 }] });
  assert.equal(pv.amount, -8500);
  const { doc, late } = billPv(pv.id, '2027-12-10');
  assert.equal(doc.doc_type, 'CREDIT_NOTE');
  assert.equal(doc.taxable_value, 8500);
  assert.equal(late, '2027-11-30');
  assert.ok(getTable<{ from_id: string; to_id: string; relation: string }>('doc_links').some((l) => l.from_id === ra.id && l.to_id === doc.id && l.relation === 'credit_note'));
});

test('the working page prints the snapshot only (never recomputed); its sums agree', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../src/components/templates/parts/PvWorkingPage.tsx', import.meta.url), 'utf8');
  assert.ok(!/from '[^']*cn-escalation'/.test(page), 'no engine import in the paper part');
  assert.match(page, /boq_terms\?\.cn\?\.pv/);
  assert.match(readFileSync(new URL('../src/components/templates/parts/WorksPaper.tsx', import.meta.url), 'utf8'), /export \{ PvWorkingPage \} from '\.\/PvWorkingPage'/);
  saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] });
  const pv = savePv({ contract: c, date: '2026-07-05', period_from: '2026-04-01', period_to: '2026-06-30', indices: up }).working;
  assert.equal(Math.round(pv.rows!.reduce((s, r) => s + r.weighted, 0) * 1e6) / 1e6, pv.sum);
  assert.equal(Math.round(pv.m_factor! * pv.work_value! * pv.sum!), pv.amount);
});
