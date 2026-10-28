/**
 * PENDING #23 (RT-C2): the apparel Size grid on the PO and GRN editors as well as the supplier bill — one shared lazy
 * slot (the desk's preload list carried once), and the PO save keeps the grid lines' item id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../src/components/purchases/${f}`, import.meta.url), 'utf8');

test('bill, PO and GRN editors mount the one size-grid slot', () => {
  for (const f of ['BillModal.tsx', 'PurchaseOrdersTab.tsx', 'GrnModal.tsx']) {
    assert.match(src(f), /<SizeGridSlot lines=\{lines\} onChange=\{\w+\} date=\{date\} \/>/, f);
    assert.ok(!src(f).includes("import('../retail-r9/ApparelDesk')"), `${f} leaves the lazy import to the slot`);
  }
  const slot = src('SizeGridSlot.tsx');
  assert.match(slot, /lazy\(\(\) => import\('\.\.\/retail-r9\/ApparelDesk'\)/);
  assert.match(slot, /includes\('apparel'\)\) return null/);
  assert.match(src('PurchaseOrdersTab.tsx'), /\.\.\.\(item_id \? \{ item_id \} : \{\}\)/, 'a PO line from the grid keeps its variant id');
});
