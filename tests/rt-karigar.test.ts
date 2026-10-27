/** RT-E4 karigar account by fine weight: the Salim example (balance 1.560 g, labour ₹23,445), wip godown balance, tags
 * created on receipt, unregistered → no GST, registered → 5%, ageing, deleted KAR number reserved. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import '../src/lib/trust/recycle-bin.ts';
import { deleteKarigarMove, karigarLedger, karigarLine, labourAmount, loadKarigarMoves, recordKarigar, wastageFine } from '../src/lib/retail/rt-karigar.ts';
import { ensureJewelItem, loadTags } from '../src/lib/retail/rt-jewel-tags.ts';
import { blankStockItem, stockDb } from '../src/lib/inventory.ts';
import { loadTracking } from '../src/lib/stock-tracking.ts';
import { godownsDb } from '../src/lib/godowns.ts';
import { draftsDb } from '../src/lib/purchase-drafts.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'kirana', retail_kind: 'jewellery', industry_packs: ['jewellery'] } as never);
});
const salim = { id: 'v-salim', name: 'Salim' };
const fine = () => {
  const item = blankStockItem({ name: 'Fine gold 24K', unit: 'GMS', opening_qty: 100, opening_rate: 10000 });
  stockDb.saveItem(item);
  return item;
};

test('the Salim example: 50 g fine issued, 52.100 g net at 91.6% back with 1.5% wastage at ₹450/g', () => {
  const metal = fine();
  const chains = ensureJewelItem('Chains 22K');
  recordKarigar({ date: '2026-10-01', karigar: salim, kind: 'issue', lines: [karigarLine({ item_id: metal.id, item_name: metal.name, metal: 'gold', purity: '24K', gross_wt: 50, touch_pct: 100 })] });
  const wip = godownsDb.list().find((g) => g.kind === 'wip' && g.vendor_id === salim.id)!;
  assert.equal(loadTracking().get(metal.id)!.byGodown[wip.id], 50, 'metal with the karigar sits in his wip godown');
  assert.equal(loadTracking().get(metal.id)!.qty, 100, 'still our stock (valued, RT21)');
  const line = karigarLine({ item_id: chains.id, item_name: chains.name, metal: 'gold', purity: '22K', gross_wt: 52.1, touch_pct: 91.6, pieces: 4 });
  assert.equal(line.fine_wt, 47.724);
  assert.equal(wastageFine(47.724, 1.5), 0.716);
  assert.equal(labourAmount('per_gram', 450, [line]), 23445);
  assert.equal(labourAmount('per_piece', 1000, [line]), 4000);
  const r = recordKarigar({
    date: '2026-10-20', karigar: salim, kind: 'receipt', lines: [line], wastage_pct: 1.5, labour: { basis: 'per_gram', rate: 450 }, consume_item_id: metal.id,
    tags: [13.0, 13.1, 13.0, 13.0].map((g) => ({ item_id: chains.id, metal: 'gold' as const, purity: '22K', gross_wt: g })),
  });
  assert.deepEqual([r.number, r.wastage_fine, r.labour?.amount], ['KAR/FY26-27/0002', 0.716, 23445]);
  const [l] = karigarLedger(loadKarigarMoves(), '2026-10-27');
  assert.deepEqual([l.issued, l.received, l.wastage, l.balance, l.oldest, l.days], [50, 47.724, 0.716, 1.56, '2026-10-01', 26]);
  const tr = loadTracking();
  assert.equal(tr.get(metal.id)!.byGodown[wip.id], 1.56, 'wip balance = fine still with him');
  assert.equal(tr.get(chains.id)!.qty, 4, 'four tagged chains in stock');
  assert.deepEqual(loadTags().map((t) => t.tag), ['JW-0001', 'JW-0002', 'JW-0003', 'JW-0004']);
  const d = draftsDb.all().find((x) => x.id === r.bill_draft_id)!;
  assert.deepEqual([d.total, d.cgst, d.itc_eligible, d.lines[0].hsn, d.lines[0].tax_rate], [23445, 0, false, '9988', 0], 'unregistered karigar: no GST, no RCM');
  recordKarigar({ date: '2026-10-21', karigar: salim, kind: 'return_metal', lines: [karigarLine({ item_id: metal.id, item_name: metal.name, metal: 'gold', purity: '24K', gross_wt: 1.56 })] });
  const [z] = karigarLedger(loadKarigarMoves(), '2026-10-27');
  assert.deepEqual([z.balance, z.days], [0, 0]);
  assert.equal(loadTracking().get(metal.id)!.byGodown[wip.id] ?? 0, 0);
});

test('a registered karigar\'s labour carries 5% (SAC 9988); a deleted KAR number stays used; stock moves go with it', () => {
  const metal = fine();
  const a = recordKarigar({ date: '2026-10-01', karigar: { ...salim, gstin: '27AAPFU0939F1ZV' }, kind: 'issue', lines: [karigarLine({ item_id: metal.id, item_name: metal.name, metal: 'gold', purity: '24K', gross_wt: 10 })] });
  deleteKarigarMove(a.id);
  assert.equal(loadTracking().get(metal.id)!.byGodown[godownsDb.list().find((g) => g.kind === 'wip')!.id] ?? 0, 0);
  assert.ok(getTable('recycle_bin').length >= 1);
  const r = recordKarigar({ date: '2026-10-02', karigar: { ...salim, gstin: '27AAPFU0939F1ZV' }, kind: 'receipt', lines: [karigarLine({ item_name: 'Rings', metal: 'gold', purity: '22K', gross_wt: 10, touch_pct: 91.6 })], labour: { basis: 'per_gram', rate: 100 } });
  assert.equal(r.number, 'KAR/FY26-27/0002', '0001 stays used');
  const d = draftsDb.all().find((x) => x.id === r.bill_draft_id)!;
  assert.deepEqual([d.taxable, d.cgst, d.sgst, d.total, d.itc_eligible], [1000, 25, 25, 1050, true]);
});

test('recycle bin: a deleted karigar entry comes back with its stock moves; its unposted labour draft went with it', async () => {
  const { restoreEntry } = await import('../src/lib/trust/recycle-bin.ts');
  const metal = fine();
  const a = recordKarigar({ date: '2026-10-01', karigar: salim, kind: 'issue', lines: [karigarLine({ item_id: metal.id, item_name: metal.name, metal: 'gold', purity: '24K', gross_wt: 10 })] });
  const wip = () => loadTracking().get(metal.id)!.byGodown[godownsDb.list().find((g) => g.kind === 'wip')!.id] ?? 0;
  const r = recordKarigar({ date: '2026-10-02', karigar: salim, kind: 'receipt', lines: [karigarLine({ item_name: 'Rings', metal: 'gold', purity: '22K', gross_wt: 5, touch_pct: 91.6 })], labour: { basis: 'per_gram', rate: 100 } });
  assert.ok(draftsDb.all().some((d) => d.id === r.bill_draft_id));
  deleteKarigarMove(r.id);
  assert.ok(!draftsDb.all().some((d) => d.id === r.bill_draft_id), 'the labour draft goes with the entry');
  deleteKarigarMove(a.id);
  assert.equal(wip(), 0);
  const e = getTable<{ id: string; table: string; row_id: string }>('recycle_bin').find((b) => b.table === 'karigar_moves' && b.row_id === a.id)!;
  restoreEntry(e.id);
  assert.equal(wip(), 10, 'both stock moves came back with the entry');
  assert.equal(loadKarigarMoves().length, 1);
});
