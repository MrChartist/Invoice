/**
 * AG-C2 mill BOM starters by `mill_kind` (existing `boms`, editable, "practice — adjust"). Quantities are per 100 of
 * input; the main product is the BOM's finished item (`batch_qty` = its share), the rest are BOM outputs:
 *
 *   rice  paddy 100 → head rice 64 (main), broken 4 (co-product, 5% of cost), bran 7, husk 22 (by-products), loss 3
 *   flour wheat 100 → atta 44 (main), maida 30 / suji 8 (co-products 35% / 9%), chokar 16 (by-product), loss 2
 *   dal   pulses 100 → dal 72 (main), broken 4 (co-product 4%), chunni 10, husk 12 (by-products), loss 2
 *   oil   seed 100 → oil 33 (main), oil cake 64 (by-product), loss 3
 *
 * By-products are credited at the typed rate per unit (net realisable value; 0 until typed), co-products take a share of
 * the joint cost (AG29). Pure above "Storage" (tests/ag-yield.test.ts checks every starter with `validateBom`).
 */
import './ag-registry';
import type { AgClass, MillKind } from '../../types/agri-r12';
import type { Bom, BomOutputKind } from '../../types/manufacturing';
import { blankStockItem, stockDb, type StockItem } from '../inventory';
import { bomsDb } from '../manufacturing';
import { requireAccess } from '../access';
import { generateId } from '../storage';
import { num } from '../invoice-calc';

export type MillRole = 'input' | 'main' | 'co' | 'by';

export interface StarterLine {
  key: string;
  /** Default stock item name (an existing item of that name is reused). */
  name: string;
  role: MillRole;
  qty: number;
  /** Co-product share of the joint cost, %. */
  cost_pct?: number;
  ag_class?: AgClass;
}

export interface MillStarter {
  kind: MillKind;
  /** BOM name ("practice — adjust"). */
  name: string;
  lines: readonly StarterLine[];
}

export const MILL_STARTERS: Readonly<Record<MillKind, MillStarter>> = {
  rice: {
    kind: 'rice', name: 'Rice mill starter (practice — adjust)',
    lines: [
      { key: 'paddy', name: 'Paddy', role: 'input', qty: 100, ag_class: 'paddy' },
      { key: 'rice', name: 'Rice', role: 'main', qty: 64, ag_class: 'cereal_loose' },
      { key: 'broken', name: 'Broken rice', role: 'co', qty: 4, cost_pct: 5, ag_class: 'broken_rice' },
      { key: 'bran', name: 'Rice bran', role: 'by', qty: 7, ag_class: 'rice_bran_feed' },
      { key: 'husk', name: 'Rice husk', role: 'by', qty: 22, ag_class: 'rice_husk' },
    ],
  },
  flour: {
    kind: 'flour', name: 'Flour mill starter (practice — adjust)',
    lines: [
      { key: 'wheat', name: 'Wheat', role: 'input', qty: 100, ag_class: 'cereal_loose' },
      { key: 'atta', name: 'Atta', role: 'main', qty: 44, ag_class: 'flour_loose' },
      { key: 'maida', name: 'Maida', role: 'co', qty: 30, cost_pct: 35, ag_class: 'flour_loose' },
      { key: 'suji', name: 'Suji', role: 'co', qty: 8, cost_pct: 9, ag_class: 'flour_loose' },
      { key: 'chokar', name: 'Chokar (wheat bran)', role: 'by', qty: 16 },
    ],
  },
  dal: {
    kind: 'dal', name: 'Dal mill starter (practice — adjust)',
    lines: [
      { key: 'pulses', name: 'Pulses (whole)', role: 'input', qty: 100, ag_class: 'pulses_loose' },
      { key: 'dal', name: 'Dal', role: 'main', qty: 72, ag_class: 'pulses_loose' },
      { key: 'brokenDal', name: 'Broken dal', role: 'co', qty: 4, cost_pct: 4, ag_class: 'pulses_loose' },
      { key: 'chunni', name: 'Chunni', role: 'by', qty: 10 },
      { key: 'dalHusk', name: 'Dal husk', role: 'by', qty: 12 },
    ],
  },
  oil: {
    kind: 'oil', name: 'Oil mill starter (practice — adjust)',
    lines: [
      { key: 'seed', name: 'Oilseed', role: 'input', qty: 100 },
      { key: 'oil', name: 'Edible oil', role: 'main', qty: 33, ag_class: 'edible_oil' },
      { key: 'cake', name: 'Oil cake', role: 'by', qty: 64, ag_class: 'oil_cake_feed' },
    ],
  },
};

/** Normal loss of a starter per 100 of input (input − Σ outputs). */
export const starterLoss = (s: MillStarter): number => {
  const input = s.lines.filter((l) => l.role === 'input').reduce((t, l) => t + l.qty, 0);
  return Math.round((input - s.lines.filter((l) => l.role !== 'input').reduce((t, l) => t + l.qty, 0)) * 1000) / 1000;
};

/** Pure: the BOM of a starter for the given item ids (by line key) and by-product rates (₹ per unit, by key). */
export function starterBom(s: MillStarter, itemIds: Readonly<Record<string, string>>, rates: Readonly<Record<string, number>> = {}, newId: () => string = generateId): Omit<Bom, 'id'> {
  const main = s.lines.find((l) => l.role === 'main')!;
  const kindOf = (r: MillRole): BomOutputKind => (r === 'co' ? 'co_product' : 'by_product');
  return {
    item_id: itemIds[main.key], name: s.name, batch_qty: main.qty, is_default: true,
    components: s.lines.filter((l) => l.role === 'input').map((l) => ({ id: newId(), item_id: itemIds[l.key], qty: l.qty })),
    outputs: s.lines.filter((l) => l.role === 'co' || l.role === 'by').map((l) => ({
      id: newId(), item_id: itemIds[l.key], qty: l.qty, kind: kindOf(l.role),
      ...(l.role === 'co' ? { cost_pct: num(l.cost_pct) } : { rate: Math.max(num(rates[l.key]), 0) }),
    })),
    notes: 'Mill starter (Round 12): practice figures — adjust quantities, co-product shares and by-product rates to your mill.',
  };
}

/* ================================================================
   Storage
   ================================================================ */

/**
 * Install a starter: the stock items (reused by name, else created in `unit`, default QTL, with their class) and the
 * BOM (default for the main item). Returns the BOM and the item ids by line key.
 */
export function installMillStarter(kind: MillKind, opts: { unit?: string; rates?: Readonly<Record<string, number>>; names?: Readonly<Record<string, string>> } = {}): { bom: Bom; itemIds: Record<string, string> } {
  requireAccess('master.edit');
  const s = MILL_STARTERS[kind];
  if (!s) throw new Error('Choose rice, flour, dal or oil.');
  const itemIds: Record<string, string> = {};
  for (const l of s.lines) {
    const name = (opts.names?.[l.key] ?? l.name).trim() || l.name;
    const found = stockDb.items().find((i) => i.name.trim().toLowerCase() === name.toLowerCase());
    if (found) {
      itemIds[l.key] = found.id;
      continue;
    }
    const item: StockItem = blankStockItem({ name, unit: opts.unit || 'QTL', ...(l.ag_class ? { ag_class: l.ag_class } : {}) });
    stockDb.saveItem(item);
    itemIds[l.key] = item.id;
  }
  const items = stockDb.items();
  const draft = starterBom(s, itemIds, opts.rates);
  const taken = bomsDb.all().some((b) => b.item_id === draft.item_id && b.name.trim().toLowerCase() === draft.name.toLowerCase());
  const bom = bomsDb.save(taken ? { ...draft, name: `${draft.name} ${new Date().toISOString().slice(0, 10)}` } : draft, items);
  return { bom, itemIds };
}
