/** AG-A5 paper: block rows per kind; sub-line texts; `ag` survives normalizeRecord; papers print from the stored rows. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agriRows } from '../src/components/templates/parts/agri-rows.ts';
import { agriLineText, trackingText } from '../src/components/templates/paper-helpers.ts';
import { normalizeRecord, R9_RECORD_KEYS, R12_RECORD_KEYS } from '../src/store/invoice-defaults.ts';
import { agSnapshot } from '../src/lib/agri/ag-snapshot.ts';
import { slipHtml, voucherHtml } from '../src/lib/agri/ag-print.ts';
import { slipText } from '../src/lib/agri/ag-slips.ts';

test('block rows per kind (empty values dropped)', () => {
  const b = agriRows(agSnapshot('rent', { rent: { lot_no: 'CSR/26-27/0042', bags_in: 240, chamber: '', season: '2026' } }));
  assert.deepEqual(b.map((x) => x.title), ['Storage particulars']);
  assert.deepEqual(b[0].rows, [['Lot no.', 'CSR/26-27/0042'], ['Bags in', 240], ['Season', '2026']]);
  assert.equal(agriRows(agSnapshot('inputs', { inputs: { licences: [{ kind: 'Fertiliser', no: 'FL-1' }], pos_txn: 'T1' } }))[0].title, 'Dealer particulars');
  assert.equal(agriRows(agSnapshot('milk_sale', { milk: { kg_fat: 41.2 } }))[0].title, 'Milk particulars');
  assert.equal(agriRows(agSnapshot('cmr', { cmr: { outturn_pct: 67 } }))[0].rows[0][1], '67%');
  assert.deepEqual(agriRows({ kind: 'produce' }), []);
});

test('sub-line texts, and nothing without `ag`', () => {
  const ag = agSnapshot('milk_sale', { lines: { l1: { fat: 6.8, snf: 9, litres: 412.5 }, l2: { lot: 'CSR/26-27/0042', bags: 120, rate_bag: 180, season: '2026' }, l3: { batch: 'UR2611', exp: '03/2028', mrp_bag: 266.5 } } });
  assert.equal(agriLineText({ id: 'l1' }, ag), 'Fat 6.8% · SNF 9% · 412.5 L');
  assert.equal(agriLineText({ id: 'l2' }, ag), 'Lot CSR/26-27/0042 · 120 bags × ₹180 (season 2026)');
  assert.equal(agriLineText({ id: 'l3' }, ag), 'Batch UR2611 · Exp 03/2028 · MRP ₹266.5 / bag');
  assert.equal(agriLineText({ id: 'l1' }, undefined), '');
  assert.equal(trackingText({ id: 'x', batch_no: 'B1' } as never), 'Batch B1', 'old documents print as before');
  assert.equal(trackingText({ id: 'l1' } as never, ag), 'Fat 6.8% · SNF 9% · 412.5 L');
});

test('`ag` is one record key kept by normalizeRecord (load → save)', () => {
  assert.deepEqual([...R12_RECORD_KEYS], ['ag']);
  assert.ok((R9_RECORD_KEYS as readonly string[]).includes('ag'));
  const ag = agSnapshot('rent', { rent: { lot_no: 'L1', exempt: true } });
  const r = normalizeRecord({ id: 'i', doc_type: 'BILL_OF_SUPPLY', items: [], ag } as never);
  assert.deepEqual(r.ag, ag);
  assert.equal('ag' in normalizeRecord({ id: 'j', doc_type: 'INVOICE', items: [] } as never), false, 'absent stays absent');
  assert.match(readFileSync(new URL('../src/store/useInvoiceStore.ts', import.meta.url), 'utf8'), /\.\.\.R9_RECORD_KEYS/, 'RECORD_KEYS spreads R9 (with R12)');
});

test('papers print from the stored rows only', () => {
  const bill = { id: 'p', kind: 'PURCHASE', vendor_name: 'Ram', bill_number: 'FPV/FY26-27/0001', date: '2026-10-20', category: '', taxable: 100, cgst: 0, sgst: 0, igst: 0, total: 100, amount_paid: 0, itc_eligible: false,
    lines: [{ id: 'l', name: 'Paddy', unit: 'QTL', quantity: 1, rate: 100, tax_rate: 0 }],
    ag: { voucher: { quality: [{ key: 'moisture', reading: 19, norm: 17, mode: 'weight', cut_pct: 2, cut_kg: 52.28 }], cut_kg: 52.28, accepted_kg: 2561.72, declaration: 'Purchased from an agriculturist — agricultural produce; exempt; reverse charge not applicable.' } } } as never;
  const html = voucherHtml(bill, { name: 'Mill <&>' });
  assert.match(html, /Mill &#60;&#38;&#62;/);
  assert.match(html, /Quality cuts/);
  assert.match(html, /52\.28 kg/);
  assert.match(html, /Purchased from an agriculturist/);
  const cyc = { id: 'c', number: 'CYB/FY26-27/0001', period_from: '2026-10-11', period_to: '2026-10-20', source: 'milk', status: 'closed', lines: [] } as never;
  const line = { farmer_id: 'f', name: 'Ram', qty: 100, unit: 'L', amount: 5000, deductions: [{ kind: 'feed', amount: 1000 }], net: 4000, mode: 'bank', shifts: [{ date: '2026-10-11', shift: 'M', qty: 10, fat: 6.5, snf: 9, amount: 500 }] } as never;
  assert.match(slipHtml(cyc, line, 'Dairy'), /Net ₹4,000\.00/);
  assert.match(slipHtml(cyc, line, 'Dairy'), /6\.5/);
  assert.match(slipText(cyc, line, 'Dairy', 'hi'), /शुद्ध भुगतान/);
});
