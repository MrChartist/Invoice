/** TR-A3: price-drop runs across many bills, financial / GST notes, Sec 34(2), price-protection claims, undo. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientKA, clientMH, installSettings, SELLER } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { isNonGstFinancialNote } from '../src/lib/financial-note.ts';
import { applyTotals } from '../src/lib/demo-data.ts';
import { claimPriceDrop, dropRows, issuePriceDrop, loadPriceDrops, protectionRows, sec34Limit, stockBefore, undoPriceDrop } from '../src/lib/trade/tr-price-drop.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ industry_packs: ['distributor'], business_type: 'wholesale' } as never);
  localDb.clients.upsert({ ...clientMH });
  localDb.clients.upsert({ ...clientKA });
});

const doc = (id: string, date: string, qty: number, client = clientMH, over: Partial<InvoiceRecord> = {}) =>
  applyTotals({
    id, invoice_number: `INV/${id}`, doc_type: 'TAX_INVOICE', issue_date: date, due_date: date, status: 'Sent', currency: 'INR', template_id: 't', client: { ...client }, sender: SELLER,
    items: [{ id: `${id}-l`, name: 'Ceiling fan 1200', type: 'Goods', hsn: '8414', unit: 'NOS', quantity: qty, rate: 2000, tax_rate: 18, discount_percent: 0, amount: qty * 2000 }, { id: `${id}-o`, name: 'Wire', type: 'Goods', hsn: '8544', unit: 'NOS', quantity: 1, rate: 500, tax_rate: 18, amount: 500 }],
    gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 18, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, ...over,
  } as unknown as InvoiceRecord);

const spec = { items: [{ name: 'ceiling fan 1200', drop: 150 }], from: '2026-10-02', to: '2026-10-31' };

test('rows: the window, live sales only, goods returned on credit notes netted; per customer', () => {
  const inv = [doc('a', '2026-10-05', 10), doc('b', '2026-10-20', 4, clientKA), doc('old', '2026-09-20', 7), doc('draft', '2026-10-06', 3, clientMH, { status: 'Draft' }), doc('cn', '2026-10-07', 2, clientMH, { doc_type: 'CREDIT_NOTE', goods_returned: true, items: [{ id: 'a-l', name: 'Ceiling fan 1200', type: 'Goods', unit: 'NOS', quantity: 2, rate: 2000, tax_rate: 18, amount: 4000 }] } as never)];
  const rows = dropRows(inv, [{ from_id: 'a', to_id: 'cn', relation: 'credit_note' }], spec);
  assert.deepEqual(rows.map((r) => [r.invoice_id, r.qty, r.value]), [['a', 8, 1200], ['b', 4, 600]]);
  assert.equal(dropRows(inv, [], { ...spec, client_ids: [clientKA.id!] }).length, 1, 'customer filter');
});

test('financial run: one FCN per customer (no GST, skipped by GST readers), linked to its bills; rerun refused; undo cancels', () => {
  for (const d of [doc('a', '2026-10-05', 10), doc('a2', '2026-10-15', 2), doc('b', '2026-10-20', 4, clientKA)]) localDb.invoices.save(d);
  const run = issuePriceDrop({ ...spec, date: '2026-11-01', mode: 'financial', own_stock: [{ item: 'Ceiling fan 1200', qty: 30 }] });
  assert.match(run.number, /^PDR\/FY26-27\/0*1$/);
  assert.equal(run.total, 2400);
  const notes = run.note_ids.map((id) => localDb.invoices.getById(id)!);
  assert.equal(notes.length, 2);
  assert.ok(notes.every((n) => isNonGstFinancialNote(n) && n.price_drop_id === run.id && /^FCN\//.test(n.invoice_number) && n.financial_reason === 'price_drop'));
  assert.deepEqual(notes.map((n) => n.total).sort((x, y) => x - y), [600, 1800]);
  assert.equal(getTable<{ relation: string }>('doc_links').filter((l) => l.relation === 'price_drop').length, 3);
  assert.throws(() => issuePriceDrop({ ...spec, date: '2026-11-01', mode: 'financial' }), /already on a price-drop run/);
  // Claim = notes + own stock × drop (once).
  const claim = claimPriceDrop(run.id, { id: 'v1', name: 'Fan Co' }, '2026-11-02');
  assert.equal(claim.kind, 'price_drop');
  assert.equal(claim.amount, 2400 + 30 * 150);
  assert.deepEqual(protectionRows(loadPriceDrops()[0]).at(-1), { invoice_number: 'Own stock', date: '2026-11-01', party: '', item: 'Ceiling fan 1200', qty: 30, free_qty: 0, value: 4500 });
  assert.throws(() => claimPriceDrop(run.id, { id: 'v1', name: 'Fan Co' }, '2026-11-02'), /already claimed/);
  const undone = undoPriceDrop(run.id);
  assert.equal(undone.status, 'undone');
  assert.ok(run.note_ids.every((id) => localDb.invoices.getById(id)!.status === 'Cancelled'), 'numbers stay, notes cancelled');
  assert.equal(issuePriceDrop({ ...spec, date: '2026-11-02', mode: 'financial' }).rows.length, 3, 'after undo the bills can be noted again');
});

test('GST mode: only when agreed before supply; one rate-difference note per bill; refused after the Sec 34(2) date', () => {
  localDb.invoices.save(doc('a', '2026-10-05', 10));
  assert.throws(() => issuePriceDrop({ ...spec, date: '2026-11-01', mode: 'gst' }), /agreed before supply/);
  const run = issuePriceDrop({ ...spec, date: '2026-11-01', mode: 'gst', agreed: true });
  const note = localDb.invoices.getById(run.note_ids[0])!;
  assert.deepEqual([note.doc_type, note.goods_returned, note.taxable_value, note.tax_amount], ['CREDIT_NOTE', false, 1500, 270]);
  assert.ok(getTable<{ relation: string; from_id: string }>('doc_links').some((l) => l.relation === 'credit_note' && l.from_id === 'a'));
  assert.equal(sec34Limit('2026-10-05'), '2027-11-30');
  setTable('price_drops', []);
  assert.throws(() => issuePriceDrop({ ...spec, date: '2027-12-01', mode: 'gst', agreed: true }), /Sec 34\(2\)/);
});

test('own stock the day before the effective date, from the stock ledger', () => {
  const pos = [{ item: { name: 'Ceiling fan 1200' }, ledger: [{ date: '2026-10-01', balance: 40 }, { date: '2026-10-31', balance: 30 }, { date: '2026-11-01', balance: 10 }] }] as never;
  assert.deepEqual(stockBefore(pos, ['ceiling fan 1200', 'Other'], '2026-11-01'), [{ item: 'Ceiling fan 1200', qty: 30 }, { item: 'Other', qty: 0 }]);
});
