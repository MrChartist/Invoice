/** MF-B4 EPR register: kg supplied by category and customer (net of credit notes), recycled share from runs, CSV. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { eprCsv, eprSupplied, recycledShare } from '../src/lib/mfg/mf-epr.ts';

const items = [
  { id: 'cap', name: 'PP cap 28 mm', unit: 'NOS', mf_epr: 'I', mf_unit_kg: 0.015 },
  { id: 'film', name: 'LD film', unit: 'KG', mf_epr: 'II' },
  { id: 'nut', name: 'Hex nut', unit: 'NOS' },
  { id: 'pcr', name: 'PCR granules', unit: 'KG', mf_pcr: true },
] as never[];
const clients = [{ id: 'bo', name: 'Brand Owner Ltd', mf: { epr_no: 'PWP/BO/123' } }] as never[];

test('kg by month × category × customer; credit notes subtract; drafts and other items ignored', () => {
  const inv = (doc: string, status: string, date: string, lines: { name: string; quantity: number; unit_factor?: number }[]) => ({ doc_type: doc, status, issue_date: date, client: { id: 'bo', name: 'Brand Owner Ltd' }, items: lines });
  const rows = eprSupplied([
    inv('INVOICE', 'Sent', '2026-10-03', [{ name: 'PP cap 28 mm', quantity: 10, unit_factor: 1000 }, { name: 'Hex nut', quantity: 50 }]),
    inv('INVOICE', 'Paid', '2026-10-20', [{ name: 'LD film', quantity: 120 }]),
    inv('CREDIT_NOTE', 'Sent', '2026-10-25', [{ name: 'LD film', quantity: 20 }]),
    inv('INVOICE', 'Draft', '2026-10-26', [{ name: 'LD film', quantity: 999 }]),
    inv('INVOICE', 'Sent', '2026-09-30', [{ name: 'LD film', quantity: 5 }]),
  ] as never, items, clients, '2026-10', '2026-10');
  assert.deepEqual(rows.map((r) => [r.month, r.category, r.client, r.epr_no, r.kg]), [['2026-10', 'I', 'Brand Owner Ltd', 'PWP/BO/123', 150], ['2026-10', 'II', 'Brand Owner Ltd', 'PWP/BO/123', 100]]);
  const csv = eprCsv(rows);
  assert.match(csv, /^Month,EPR category,Customer,Customer EPR registration,Kg supplied\n"2026-10","I","Brand Owner Ltd","PWP\/BO\/123","150"/);
  assert.match(csv, /CPCB portal/);
});

test('recycled share of the month\'s runs (post-consumer input items)', () => {
  const runs = [
    { date: '2026-10-02', inputs: [{ item_id: 'pp', kind: 'virgin', kg: 80 }, { item_id: 'pcr', kind: 'regrind', kg: 20 }] },
    { date: '2026-11-02', inputs: [{ item_id: 'pcr', kind: 'regrind', kg: 50 }] },
  ] as never;
  assert.deepEqual(recycledShare(runs, items, '2026-10'), { input_kg: 100, pcr_kg: 20, pct: 20 });
});
