/**
 * PENDING #25 (6.23): custom fields on purchase bills / expenses and recurring templates (snapshots, carried onto each
 * generated invoice), item fields editable per line in the editor, and item fields in the stock-item form (kept on the
 * catalogue entry of the same name).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { customFieldsDb, finalizeValues } from '../src/lib/custom-fields.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { buildInvoiceFromSchedule, templateFromInvoice, type RecurringSchedule } from '../src/lib/recurring.ts';
import { catalogueEntryFor, setStockItemFields } from '../src/lib/catalog.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('a purchase bill keeps its custom-field snapshot', () => {
  const f = customFieldsDb.save({ label: 'Vehicle no.', type: 'text', applies_to: 'document', print: false });
  const values = finalizeValues([{ id: f.id, label: 'old label', type: 'text', value: ' MH12 AB 1234 ', print: true }], customFieldsDb.all(), true);
  assert.deepEqual(values, [{ id: f.id, label: 'Vehicle no.', type: 'text', value: 'MH12 AB 1234', print: false }], 'first save takes today\'s label');
  const bill = purchasesDb.save({ kind: 'PURCHASE', vendor_name: 'V', bill_number: 'B1', date: '2026-06-01', lines: [], taxable: 100, cgst: 0, sgst: 0, igst: 0, total: 100, amount_paid: 0, custom_values: values } as unknown as PurchaseRecord);
  assert.deepEqual(purchasesDb.get(bill.id)?.custom_values, values);
  for (const f2 of ['components/purchases/BillModal.tsx', 'components/purchases/ExpenseModal.tsx']) assert.match(src(f2), /custom_values: finalizeValues\(customValues, customFieldsDb\.all\(\)/, f2);
});

test('a recurring template carries the document fields onto every generated invoice', () => {
  const inv = {
    id: 'i', invoice_number: 'INV/1', doc_type: 'TAX_INVOICE', issue_date: '2026-06-01', due_date: '2026-06-15', status: 'Sent', currency: 'INR', template_id: 'classic',
    client: { name: 'C' }, sender: null, items: [{ id: 'l', name: 'Rent', quantity: 1, rate: 1000, tax_rate: 18, amount: 1000, custom_values: [{ id: 'it', label: 'Flat', type: 'text', value: 'A-101', print: true }] }],
    custom_values: [{ id: 'cf', label: 'Agreement no.', type: 'text', value: 'AG-7', print: true }],
  } as unknown as InvoiceRecord;
  const t = templateFromInvoice(inv);
  assert.deepEqual(t.custom_values, inv.custom_values);
  const s = { id: 's1', name: 'Rent', template: t, frequency: 'monthly', interval: 1, start_date: '2026-06-01', next_run: '2026-07-01', due_in_days: 14, mode: 'issue', status: 'active', run_count: 0, history: [] } as unknown as RecurringSchedule;
  const g = buildInvoiceFromSchedule(s, '2026-07-01', { invoiceNumber: 'INV/2' });
  assert.deepEqual(g.custom_values?.map((v) => v.value), ['AG-7']);
  assert.deepEqual(g.items[0].custom_values?.map((v) => v.value), ['A-101']);
  assert.match(src('components/recurring/RecurringEditor.tsx'), /<SnapshotFields scope="document" idPrefix="rec"/);
});

test('item fields: editable per line (lazy), and in the stock-item form via the catalogue entry', () => {
  const items = src('components/creator/ItemsTable.tsx');
  assert.match(items, /lazy\(\(\) => import\('\.\.\/custom-fields\/LineFields'\)\)/);
  assert.ok(!items.includes('title="Item details from the catalogue"'), 'no longer read-only');
  const f = customFieldsDb.save({ label: 'Shade', type: 'text', applies_to: 'item', print: true });
  setStockItemFields({ name: 'Silk saree', hsn: '5007', unit: 'PCS', sale_rate: 2400, tax_rate: 5 }, { [f.id]: 'Maroon' });
  assert.deepEqual(catalogueEntryFor('Silk saree')?.custom_fields, { [f.id]: 'Maroon' }, 'a catalogue entry is created with the value');
  setStockItemFields({ name: 'Silk saree' }, undefined);
  assert.equal(catalogueEntryFor('Silk saree')?.custom_fields, undefined, 'clearing removes the values');
  assert.match(src('components/inventory/ItemFormModal.tsx'), /<CustomFieldInputs scope="item"/);
});
