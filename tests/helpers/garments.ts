/** MF-C fixtures: a kurta style (S–XL × Blue / Green) with its fabric and a waste item; a lot on a released order. */
import { blankStockItem, stockDb, type StockItem } from '../../src/lib/inventory.ts';
import { saveStyle } from '../../src/lib/mfg/mf-styles.ts';
import { bomsDb } from '../../src/lib/manufacturing.ts';
import { productionOrdersDb } from '../../src/lib/production/orders.ts';
import { liveTrackingInputs } from '../../src/lib/stock-tracking.ts';
import { issueCutFabric, saveCutPlan } from '../../src/lib/mfg/mf-cutplans.ts';
import type { CutPlan } from '../../src/lib/mfg/mf-c-pending.ts';

export const SIZES = ['S', 'M', 'L', 'XL'];
export function kurta(): StockItem {
  stockDb.saveItem(blankStockItem({ id: 'fab', name: 'Blue cambric', unit: 'MTR' }));
  stockDb.saveItem(blankStockItem({ id: 'waste', name: 'Cutting waste', unit: 'KG' }));
  stockDb.addMove({ id: 'm1', item_id: 'fab', date: '2026-10-01', qty: 600, rate: 120, kind: 'purchase' });
  const parent = blankStockItem({ id: 'kt', name: 'Kurta KT-22', unit: 'PCS', sale_rate: 899, variant_axes: [{ name: 'Size', values: SIZES }, { name: 'Colour', values: ['Blue', 'Green'] }] });
  stockDb.saveItem(parent);
  for (const s of SIZES) for (const c of ['Blue', 'Green']) stockDb.saveItem(blankStockItem({ id: `kt-${s}-${c}`, name: `Kurta KT-22 ${s} ${c}`, unit: 'PCS', variant_of: 'kt', variant_attrs: { Size: s, Colour: c }, sale_rate: s === 'XL' ? 2999 : 899 }));
  saveStyle('kt', { fabric_items: [{ item_id: 'fab', per_piece_m: 1.25, colour_map: { Green: 'fab-g' } }] });
  return stockDb.items().find((i) => i.id === 'kt')!;
}

export const LAYS = [{ plies: 60, marker_ratio: { S: 1, M: 2, L: 2, XL: 1 }, marker_length_m: 7.2 }];

/** The kurta, a released order of 360 and lot CUT/FY26-27/0001 with 434.4 m issued to the shop floor. */
export function lotWithOrder(): { plan: CutPlan; orderId: string } {
  kurta();
  bomsDb.save({ item_id: 'kt', name: 'Std', batch_qty: 1, components: [{ id: 'c', item_id: 'fab', qty: 1.2 }] }, stockDb.items());
  const o = productionOrdersDb.release(productionOrdersDb.save({ date: '2026-10-12', item_id: 'kt', planned_qty: 360 }, stockDb.items(), bomsDb.all()).id, bomsDb.all());
  const p = saveCutPlan({ date: '2026-10-12', order_id: o.id, style_id: 'kt', colour: 'Blue', fabric_item_id: 'fab', lays: LAYS, fabric_issued_m: 434.4, end_bits_m: 2.4 });
  return { plan: issueCutFabric(p.id, { date: '2026-10-12' }, stockDb.items(), liveTrackingInputs()), orderId: o.id };
}
