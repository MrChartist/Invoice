/** SV-C4 service recipes: a kit service consumes ml components; line override; cost by staff; units conversion. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { Bom } from '../src/types/manufacturing.ts';
import type { StockItem } from '../src/lib/inventory.ts';
import { costRate, recipeReport } from '../src/lib/services/sv-recipes.ts';
import { kitStockEvents } from '../src/lib/events-kits.ts';

const item = (id: string, name: string, over: Partial<StockItem> = {}): StockItem => ({ id, name, unit: 'ml', track_stock: true, opening_qty: 1000, opening_rate: 2, reorder_level: 0, ...over });
const items = [
  item('colour', 'Hair colour', { opening_rate: 3, standard_costs: [{ from: '2026-01-01', rate: 4 }, { from: '2026-04-01', rate: 5 }] }),
  item('dev', 'Developer'),
  item('svc', 'Global colour', { track_stock: false, kit: true, unit: 'NOS' }),
];
const boms = [{ id: 'b', item_id: 'svc', is_default: true, batch_qty: 1, components: [{ item_id: 'colour', qty: 60 }, { item_id: 'dev', qty: 60 }] }] as unknown as Bom[];
const bill = (id: string, lines: Partial<InvoiceRecord['items'][number]>[], date = '2026-06-10'): InvoiceRecord => ({
  id, invoice_number: id, doc_type: 'INVOICE', status: 'Sent', issue_date: date, due_date: date, gst_mode: 'CGST_SGST', currency: 'INR', discount_type: 'PERCENT', discount_rate: 0, shipping: 0, other_charges: 0, amount_paid: 0, tax_rate: 0,
  client: { name: 'Asha', email: '', address: '', city: '', zip: '' }, sender: null,
  items: lines.map((l, i) => ({ id: `${id}-${i}`, name: 'Global colour', type: 'Service', quantity: 1, rate: 2000, tax_rate: 5, amount: 2000, ...l })),
} as unknown as InvoiceRecord);

test('a kit service issues its ml components from stock (the engine), price unchanged', () => {
  const moves: { id: string; qty: number }[] = [];
  kitStockEvents([bill('a', [{}])], items, boms, () => 'out', (id, ev) => moves.push({ id, qty: ev.qty }));
  assert.deepEqual(moves, [{ id: 'colour', qty: -60 }, { id: 'dev', qty: -60 }]);
});

test('report by product, service and staff; override "used 90 ml"; cost at the latest standard cost', () => {
  assert.equal(costRate(items[0]), 5);
  assert.equal(costRate(items[1]), 2);
  const r = recipeReport([
    bill('a', [{ sv: { staff_id: 'p' } }]),
    bill('b', [{ sv: { staff_id: 'p', recipe_qty: { colour: 90 } } }]),
    bill('c', [{ sv: { staff_id: 'q' } }], '2026-07-01'),
    { ...bill('d', [{}]), status: 'Cancelled' } as InvoiceRecord,
  ], items, boms, '2026-06', (id) => (id === 'p' ? 'Priya' : 'Other'));
  assert.deepEqual(r.product.map((x) => [x.key, x.qty, x.cost]), [['Hair colour', 150, 750], ['Developer', 120, 240]]);
  assert.deepEqual(r.service.map((x) => [x.key, x.qty, x.cost, x.revenue]), [['Global colour', 2, 990, 4000]]);
  assert.deepEqual(r.staff.map((x) => [x.key, x.cost]), [['Priya', 990]]);
});

test('alternate units: a line in another unit converts by unit_factor', () => {
  const r = recipeReport([bill('a', [{ quantity: 1, unit_factor: 2 }])], items, boms, '2026-06', () => '');
  assert.deepEqual(r.product.map((x) => x.qty), [120, 120]);
});
