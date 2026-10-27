/** RT-E1 metal rate board and tagged pieces: rate of the bill date, no-rate error, net = gross − stones, HUID format,
 * a tag sold leaves stock via its serial, fine weight per purity, tag labels, pack-off gate. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { DB_PREFIX, getTable, setReadTrace } from '../src/lib/storage.ts';
import { restoreEntry } from '../src/lib/trust/recycle-bin.ts';
import { fineOf, lastBoard, loadRates, noRateError, purityLabel, rateFor, ratesOn, saveRates } from '../src/lib/retail/rt-jewel-rates.ts';
import { addTags, deleteTag, ensureJewelItem, loadTags, nextTagNo, parseBulk, tagJewel, tagLabels, tagSummary, tagsInStock } from '../src/lib/retail/rt-jewel-tags.ts';
import { applyJewel } from '../src/lib/retail/rt-jewel-line.ts';
import { localDb } from '../src/lib/localDb.ts';
import { loadTracking, liveDocTrackingIssues } from '../src/lib/stock-tracking.ts';
import { RT_TABLES } from '../src/lib/retail/rt-shared.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'kirana', retail_kind: 'jewellery', industry_packs: ['jewellery'] } as never);
});
const DAY = '2026-10-27';

test('rates: the bill takes the rate of its own date; latest row of a day wins; no rate = an error to fix', () => {
  saveRates('2026-10-26', [{ metal: 'gold', purity: '22K', sale: 9300, buy: 9100 }]);
  saveRates(DAY, [{ metal: 'gold', purity: '22K', sale: 9350, buy: 9150 }, { metal: 'gold', purity: '18K', sale: 7650, buy: 7400 }, { metal: 'silver', purity: '925', sale: 112, buy: 100 }, { metal: 'gold', purity: '17K', sale: 1, buy: 1 }]);
  assert.equal(loadRates().length, 4, 'an unknown purity is skipped');
  assert.equal(saveRates(DAY, [{ metal: 'gold', purity: '22K', sale: 9350, buy: 9150 }]).length, 0, 'an unchanged rate is not written again');
  assert.equal(rateFor(loadRates(), 'gold', '22K', DAY)?.sale, 9350);
  assert.equal(rateFor(loadRates(), 'gold', '22K', '2026-10-26')?.sale, 9300);
  saveRates(DAY, [{ metal: 'gold', purity: '22K', sale: 9360, buy: 9150 }]);
  assert.equal(rateFor(loadRates(), 'gold', '22K', DAY)?.sale, 9360, 'a correction is a newer row (append-only)');
  assert.equal(rateFor(loadRates(), 'gold', '22K', '2026-10-28'), undefined, 'no rate on the next day — never carried forward');
  assert.match(noRateError('gold', '22K', '2026-10-28'), /No gold 22K rate for 2026-10-28/);
  assert.equal(ratesOn(loadRates(), DAY).size, 3);
  assert.deepEqual(lastBoard(loadRates(), '2026-10-28').map((r) => [r.purity, r.sale]).sort(), [['18K', 7650], ['22K', 9360], ['925', 112]], 'Copy yesterday');
});

test('tags: net = gross − stones, HUID 6 characters, numbering, the item becomes a serial-tracked jewellery item', () => {
  const ring = ensureJewelItem('Rings 22K');
  const [t] = addTags([{ item_id: ring.id, metal: 'gold', purity: '22K', gross_wt: 6.42, stone_wt: 0.38, huid: 'ab12cd', stone_value: 4800, wastage_pct: 2, making: { basis: 'per_gram', value: 650 }, hallmark_charge: 45 }], { date: DAY, toStock: true });
  assert.deepEqual([t.tag, t.net_wt, t.huid], ['JW-0001', 6.04, 'AB12CD']);
  assert.throws(() => addTags([{ item_id: ring.id, metal: 'gold', purity: '22K', gross_wt: 5, huid: 'AB12' }], { date: DAY, toStock: false }), /HUID "AB12" must be 6/);
  assert.throws(() => addTags([{ item_id: ring.id, metal: 'gold', purity: '22K', gross_wt: 1, stone_wt: 1 }], { date: DAY, toStock: false }), /above the stone/);
  assert.throws(() => addTags([{ tag: 'jw-0001', item_id: ring.id, metal: 'gold', purity: '22K', gross_wt: 2 }], { date: DAY, toStock: false }), /already exists/);
  assert.equal(nextTagNo(['JW-0009', 'X-1']), 'JW-0010');
  const item = getTable<{ id: string; track_serials?: boolean; jewel?: boolean; unit: string }>('stock_items').find((i) => i.id === ring.id)!;
  assert.deepEqual([item.track_serials, item.jewel, item.unit], [true, true, 'PCS']);
  assert.deepEqual(parseBulk('5.120, 0.2, 22k, AB12CE\n\n3.4\t\t18K'), [{ gross_wt: 5.12, stone_wt: 0.2, purity: '22K', huid: 'AB12CE', design_no: undefined }, { gross_wt: 3.4, stone_wt: 0, purity: '18K', huid: undefined, design_no: undefined }]);
});

test('a tag sold leaves stock through its serial; fine weight per purity counts only tags in stock', () => {
  const ring = ensureJewelItem('Rings 22K');
  const tags = addTags([
    { item_id: ring.id, metal: 'gold', purity: '22K', gross_wt: 6.42, stone_wt: 0.38 },
    { item_id: ring.id, metal: 'gold', purity: '22K', gross_wt: 4 },
    { item_id: ring.id, metal: 'gold', purity: '18K', gross_wt: 3 },
  ], { date: DAY, toStock: true });
  let tr = loadTracking();
  assert.equal(tr.get(ring.id)?.qty, 3);
  assert.deepEqual(tagSummary(tagsInStock(loadTags(), tr)).map((r) => [r.label, r.pieces, r.net, r.fine]), [['22K (916)', 2, 10.04, 9.197], ['18K (750)', 1, 3, 2.25]]);
  assert.equal(fineOf('gold', '22K', 6.04), 5.533);
  const line = applyJewel({ id: 'l1', name: ring.name, type: 'Goods', unit: 'PCS', quantity: 1, rate: 0, tax_rate: 3, discount_percent: 0, amount: 0 }, tagJewel(tags[0], 9350), DAY);
  const issues = liveDocTrackingIssues({ doc_type: 'INVOICE', status: 'Sent', issue_date: DAY, items: [line] } as never);
  assert.deepEqual(issues.errors, [], 'the tag is in stock');
  localDb.invoices.save({ id: 'inv1', invoice_number: 'INV/FY26-27/0001', doc_type: 'INVOICE', status: 'Sent', issue_date: DAY, due_date: DAY, items: [line], client: { name: 'Mrs. Rao' } } as unknown as InvoiceRecord);
  tr = loadTracking();
  assert.equal(tr.get(ring.id)?.qty, 2, 'stock −1 piece');
  assert.deepEqual(tagsInStock(loadTags(), tr).map((t) => t.tag), ['JW-0002', 'JW-0003']);
  assert.throws(() => deleteTag(tags[0].id, tr), /sold/);
  deleteTag(tags[2].id, tr);
  assert.equal(loadTracking().get(ring.id)?.qty, 1, 'the desk stock move goes with the tag');
  assert.ok(getTable<{ table?: string }>('recycle_bin').length >= 1, 'deleted tag in the recycle bin');
  const binned = getTable<{ id: string; table: string; row_id: string }>('recycle_bin').find((b) => b.table === 'jewel_tags' && b.row_id === tags[2].id)!;
  restoreEntry(binned.id);
  assert.equal(loadTracking().get(ring.id)?.qty, 2, 'a restored tag comes back with its stock move');
  deleteTag(tags[2].id, loadTracking());
  const [lab] = tagLabels([tags[0]]);
  assert.deepEqual([lab.code, lab.note], ['JW-0001', 'Net 6.040 g · 22K (916)']);
  assert.equal(purityLabel('gold', '18K'), '18K (750)');
});

test('pack-off gate: other companies never read the jewellery tables; the desk is one lazy chunk', () => {
  installSettings({ business_type: 'kirana' } as never);
  const seen = new Set<string>();
  const prev = setReadTrace(seen);
  try {
    liveDocTrackingIssues({ doc_type: 'INVOICE', status: 'Sent', issue_date: DAY, items: [{ id: 'l', name: 'Soap', quantity: 1, rate: 50, tax_rate: 18, amount: 50 }] } as never);
  } finally {
    setReadTrace(prev);
  }
  for (const t of [RT_TABLES.metalRates, RT_TABLES.jewelTags, RT_TABLES.karigarMoves]) assert.ok(!seen.has(DB_PREFIX + t) && !seen.has(t), `${t} not read`);
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  assert.match(src('components/creator/ItemsTable.tsx'), /lazy\(\(\) => import\('\.\.\/retail-r9\/JewelleryDesk'\)\.then\(\(m\) => \(\{ default: m\.JewelLineRow \}\)\)\)/);
  assert.match(src('pages/Pos.tsx'), /lazy\(\(\) => import\('\.\.\/components\/retail-r9\/JewelleryDesk'\)\.then\(\(m\) => \(\{ default: m\.PosJewel \}\)\)\)/);
});
