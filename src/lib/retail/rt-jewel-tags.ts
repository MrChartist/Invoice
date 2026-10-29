/**
 * RT-E1 tagged pieces (table `jewel_tags`, `master.edit`, audited "Jewellery tag"). Each piece is a SERIAL of its
 * design / category stock item (`track_serials`, `jewel`), so stock, godowns, transfers and the serial lookup work
 * unchanged: a tag added on the desk comes into stock by a stock move carrying its serial; a tag received from a karigar
 * comes in the same way (RT-E4); a tag sold leaves stock through the sale line's `serials`. Weights in grams (3 dp).
 * Deviation: the item counts pieces (one serial each), not grams — weights live on the tag rows.
 */
import './rt-registry';
import type { JewelLine, JewelTag, Metal } from '../../types/retail-r9';
import type { LabelItem } from '../label-sheet';
import { blankStockItem, stockDb, type StockItem } from '../inventory';
import { serialKey, type TrackingMap } from '../stock-tracking';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { generateId, getTable, setTable } from '../storage';
import { RT_TABLES } from './rt-shared';
import { fineOf, fineness, purityLabel, r3 } from './rt-jewel-rates';
import { netWeight, validHuid } from './rt-jewel-line';

export const TAGS_TABLE = RT_TABLES.jewelTags;

export const loadTags = (): JewelTag[] => getTable<JewelTag>(TAGS_TABLE).filter((t) => t && typeof t.tag === 'string');

/** Next tag number "JW-0001" (above every tag that starts with the prefix). */
export function nextTagNo(existing: readonly string[], prefix = 'JW'): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  const max = existing.reduce((m, t) => Math.max(m, Number(re.exec(t)?.[1] ?? 0)), 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

export interface TagInput {
  tag?: string;
  item_id: string;
  metal: Metal;
  purity: string;
  gross_wt: number;
  stone_wt?: number;
  stone_value?: number;
  wastage_pct?: number;
  making?: JewelTag['making'];
  hallmark_charge?: number;
  huid?: string;
  design_no?: string;
}

/** Validate and shape a tag (pure). HUID: empty is allowed (warning on the bill); a typed one must be 6 characters. */
export function makeTag(input: TagInput, items: readonly StockItem[], existing: readonly JewelTag[], id: string, now: string): JewelTag {
  const item = items.find((i) => i.id === input.item_id);
  if (!item) throw new Error('Pick the design / category item.');
  if (!fineness(input.metal, input.purity)) throw new Error('Pick the purity.');
  const gross = r3(num(input.gross_wt));
  const stone = r3(Math.max(num(input.stone_wt), 0));
  if (!(gross > 0) || stone >= gross) throw new Error('Gross weight must be above the stone weight.');
  const huid = String(input.huid ?? '').trim().toUpperCase();
  if (huid && !validHuid(huid)) throw new Error(`HUID "${huid}" must be 6 letters / digits.`);
  const tag = (input.tag?.trim() || nextTagNo(existing.map((t) => t.tag))).toUpperCase();
  if (existing.some((t) => serialKey(t.tag) === serialKey(tag))) throw new Error(`Tag ${tag} already exists.`);
  return {
    id, tag, item_id: item.id, item_name: item.name, metal: input.metal, purity: input.purity, gross_wt: gross, stone_wt: stone, net_wt: netWeight(gross, stone),
    stone_value: round2(Math.max(num(input.stone_value), 0)), wastage_pct: Math.max(num(input.wastage_pct), 0), making: input.making ?? { basis: 'per_gram', value: 0 },
    hallmark_charge: round2(Math.max(num(input.hallmark_charge), 0)), created_at: now,
    ...(huid ? { huid } : {}), ...(input.design_no?.trim() ? { design_no: input.design_no.trim() } : {}),
  };
}

/** Make sure the item is a serial-tracked jewellery item (saved once). */
function markItem(itemId: string): void {
  const item = stockDb.items().find((i) => i.id === itemId);
  if (item && (!item.track_serials || !item.jewel || !item.track_stock)) stockDb.saveItem({ ...item, track_stock: true, track_serials: true, jewel: true });
}

/** A jewellery design item (created when missing): unit PCS, serial-tracked, HSN 7113. */
export function ensureJewelItem(name: string, taxRate = 3): StockItem {
  requireAccess('master.edit');
  const found = stockDb.items().find((i) => i.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (found) return markItem(found.id), stockDb.items().find((i) => i.id === found.id)!;
  const item = blankStockItem({ name: name.trim(), unit: 'PCS', hsn: '7113', tax_rate: taxRate, track_serials: true, jewel: true });
  stockDb.saveItem(item);
  return item;
}

/**
 * Save tags; `toStock` brings each into stock (a +1 move with its serial, into `godownId`) — leave it off when the
 * pieces came on a supplier bill or a karigar receipt (they brought the stock).
 */
export function addTags(inputs: readonly TagInput[], opts: { date: string; toStock: boolean; godownId?: string; cost?: (t: JewelTag) => number }): JewelTag[] {
  requireAccess('master.edit');
  const items = stockDb.items();
  const all = loadTags();
  const now = new Date().toISOString();
  const made: JewelTag[] = [];
  for (const i of inputs) made.push(makeTag(i, items, [...all, ...made], generateId(), now));
  for (const id of new Set(made.map((t) => t.item_id))) markItem(id);
  if (opts.toStock) for (const t of made) {
    const move = { id: generateId(), item_id: t.item_id, date: opts.date, qty: 1, rate: round2(opts.cost?.(t) ?? 0), kind: 'adjustment' as const, note: `Tag ${t.tag} (${r3(t.net_wt)} g ${t.purity})`, serials: [t.tag], ...(opts.godownId ? { godown_id: opts.godownId } : {}) };
    stockDb.addMove(move);
    t.move_id = move.id;
  }
  setTable(TAGS_TABLE, [...all, ...made]);
  return made;
}

/** Parse bulk rows "gross, stone, purity, HUID, design" (one per line; blank stone = 0). */
export function parseBulk(text: string): { gross_wt: number; stone_wt: number; purity?: string; huid?: string; design_no?: string }[] {
  return text.split(/\r?\n/).map((l) => l.split(/[,\t;]/).map((c) => c.trim())).filter((c) => num(c[0]) > 0)
    .map(([gross, stone, purity, huid, design]) => ({ gross_wt: num(gross), stone_wt: num(stone), purity: purity?.toUpperCase() || undefined, huid: huid || undefined, design_no: design || undefined }));
}

/** Delete a tag still in stock (its desk stock move goes too). A sold tag stays with its bill. */
export function deleteTag(id: string, tracking: TrackingMap): void {
  requireAccess('master.edit');
  const all = loadTags();
  const t = all.find((x) => x.id === id);
  if (!t) return;
  const s = tracking.get(t.item_id)?.serials.find((x) => serialKey(x.serial) === serialKey(t.tag));
  if (s && !s.inStock) throw new Error(`Tag ${t.tag} is sold: it stays with its bill.`);
  if (t.move_id) stockDb.deleteMove(t.move_id);
  setTable(TAGS_TABLE, all.filter((x) => x.id !== id));
}

/** Tags in stock (their serial is in stock), optionally in one godown. */
export function tagsInStock(tags: readonly JewelTag[], tracking: TrackingMap, godown?: string): JewelTag[] {
  return tags.filter((t) => tracking.get(t.item_id)?.serials.some((s) => s.inStock && serialKey(s.serial) === serialKey(t.tag) && (!godown || s.godown === godown)));
}

/** Stock of tags per metal + purity: pieces, net weight and fine weight (24K g). */
export function tagSummary(tags: readonly JewelTag[]): { metal: Metal; purity: string; label: string; pieces: number; net: number; fine: number }[] {
  const by = new Map<string, { metal: Metal; purity: string; label: string; pieces: number; net: number; fine: number }>();
  for (const t of tags) {
    const k = `${t.metal}:${t.purity}`;
    const row = by.get(k) ?? { metal: t.metal, purity: t.purity, label: purityLabel(t.metal, t.purity), pieces: 0, net: 0, fine: 0 };
    row.pieces += 1;
    row.net = r3(row.net + t.net_wt);
    row.fine = r3(row.fine + fineOf(t.metal, t.purity, t.net_wt));
    by.set(k, row);
  }
  return [...by.values()].sort((a, b) => a.metal.localeCompare(b.metal) || fineness(b.metal, b.purity) - fineness(a.metal, a.purity));
}

/** The bill breakdown of a tag at a rate. */
export const tagJewel = (t: JewelTag, rate: number): JewelLine => ({
  tag: t.tag, metal: t.metal, purity: t.purity, gross_wt: t.gross_wt, stone_wt: t.stone_wt, net_wt: t.net_wt, rate, wastage_pct: t.wastage_pct,
  making: t.making, stone_value: t.stone_value, hallmark_charge: t.hallmark_charge, ...(t.huid ? { huid: t.huid } : {}),
});

/** Tag labels for the label sheet (jewellery tag layout): tag no. barcode, net weight, purity, HUID. */
export const tagLabels = (tags: readonly JewelTag[]): LabelItem[] =>
  tags.map((t) => ({ name: `${t.tag} ${t.item_name}`, code: t.tag, copies: 1, note: [`Net ${t.net_wt.toFixed(3)} g`, purityLabel(t.metal, t.purity), t.huid && `HUID ${t.huid}`].filter(Boolean).join(' · ') }));
