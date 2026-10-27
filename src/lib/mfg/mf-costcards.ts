/**
 * MF-D1 food batch cost cards (pack `foodmfg`; table `cost_cards`, `master.edit`, dated by `effective_from`):
 *
 *   input weight  = Σ recipe quantities in weight / volume units (kg, g, L, ml … — 1 L counted as 1 kg)
 *   yield %       = output kg ÷ input weight × 100        (frying / moisture loss)
 *   batch cost    = (Σ qty × rate + conversion ₹/kg × output kg) × (1 + overhead %)
 *   cost per kg   = batch cost ÷ output kg
 *   cost per pack = cost per kg × pack kg + packing material per pack (film, carton share, label)
 *   margin        = price − cost per pack, and % of the price, at the distributor / retailer / MRP prices
 *
 * The recipe starts from the item's BOM (rates = the item's standard cost on the card date, else its opening rate);
 * "what-if" re-prices it at the latest purchase rate of each ingredient (bills read through `readPurchaseLines`, in
 * base units with `unitFactor`). Saved versions: the card in force on a day is the latest `effective_from` ≤ day.
 * Money through `round2`. Working paper — verify with your CA.
 */
import { round2 } from '../invoice-calc';
import { isoDay } from '../dates';
import { requireAccess } from '../access';
import { generateId, getTable, setTable } from '../storage';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';

export const COST_CARDS_TABLE = 'cost_cards';

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export interface CostCardLine {
  item_id: string;
  name: string;
  qty: number;
  unit?: string;
  /** Standard rate ₹ per unit. */
  rate: number;
}

export interface CostCardPack {
  id: string;
  label: string;
  /** Pack stock item (variant or separate item), when there is one. */
  item_id?: string;
  /** Net weight of the pack in kg (200 g → 0.2). */
  pack_kg: number;
  /** Packing material per pack. */
  packing: { label: string; cost: number }[];
  prices?: { distributor?: number; retailer?: number; mrp?: number };
}

export interface CostCard {
  id: string;
  /** The food item the recipe makes (bulk, in kg). */
  item_id: string;
  name: string;
  /** yyyy-mm-dd: the card applies from this day until the next version. */
  effective_from: string;
  bom_id?: string;
  lines: CostCardLine[];
  /** Output of one batch in kg. */
  output_kg: number;
  /** Gas, power, labour per kg of output (or the routing's rate). */
  conversion_per_kg: number;
  overhead_pct: number;
  packs: CostCardPack[];
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

/* ── Maths (pure) ─────────────────────────────────────────────── */

/** kg per unit for weight / volume units (L and ml counted as kg); undefined for counted units (packing, pieces). */
const KG: Readonly<Record<string, number>> = { kg: 1, kgs: 1, g: 0.001, gm: 0.001, gms: 0.001, gram: 0.001, l: 1, ltr: 1, litre: 1, liter: 1, ml: 0.001, qtl: 100, quintal: 100, t: 1000, ton: 1000, tonne: 1000, mt: 1000 };
export const kgPerUnit = (unit: string | undefined): number | undefined => KG[String(unit ?? 'kg').trim().toLowerCase()];

export interface PackCost {
  id: string;
  label: string;
  /** Product cost in the pack (cost per kg × pack kg). */
  product: number;
  packing: number;
  perPack: number;
  margins: { level: 'distributor' | 'retailer' | 'mrp'; price: number; margin: number; pct: number }[];
}

export interface CardCost {
  inputWeight: number;
  inputCost: number;
  yieldPct: number;
  conversion: number;
  overhead: number;
  batchCost: number;
  perKg: number;
  packs: PackCost[];
}

/** Cost card figures; `rates` (item id → ₹ per unit) overrides the card's own rates (what-if). */
export function cardCost(card: Pick<CostCard, 'lines' | 'output_kg' | 'conversion_per_kg' | 'overhead_pct' | 'packs'>, rates?: ReadonlyMap<string, number>): CardCost {
  let inputWeight = 0;
  let inputCost = 0;
  for (const l of card.lines) {
    const qty = n(l.qty);
    const kg = kgPerUnit(l.unit);
    if (kg !== undefined) inputWeight += qty * kg;
    inputCost += qty * (rates?.get(l.item_id) ?? n(l.rate));
  }
  const out = n(card.output_kg);
  const conversion = round2(n(card.conversion_per_kg) * out);
  const overhead = round2(((inputCost + conversion) * n(card.overhead_pct)) / 100);
  const batchCost = round2(inputCost + conversion + overhead);
  const perKg = out > 0 ? batchCost / out : 0;
  const packs = card.packs.map((p): PackCost => {
    const product = round2(perKg * n(p.pack_kg));
    const packing = round2(p.packing.reduce((s, x) => s + n(x.cost), 0));
    const perPack = round2(product + packing);
    const margins = (['distributor', 'retailer', 'mrp'] as const)
      .filter((k) => n(p.prices?.[k]) > 0)
      .map((k) => {
        const price = n(p.prices?.[k]);
        const margin = round2(price - perPack);
        return { level: k, price, margin, pct: round2((margin / price) * 100) };
      });
    return { id: p.id, label: p.label, product, packing, perPack, margins };
  });
  return {
    inputWeight: Math.round(inputWeight * 1000) / 1000,
    inputCost: round2(inputCost),
    yieldPct: inputWeight > 0 ? round2((out / inputWeight) * 100) : 0,
    conversion, overhead, batchCost, perKg: round2(perKg), packs,
  };
}

/** Latest purchase rate (₹ per base unit, after discount) of each item on or before `day`, from bills. */
export function latestPurchaseRates(purchases: readonly unknown[], items: readonly { id: string; name: string }[], day: string): Map<string, number> {
  const byName = new Map(items.map((i) => [i.name.trim().toLowerCase(), i.id]));
  const last = new Map<string, { date: string; rate: number }>();
  for (const raw of purchases) {
    const p = readPurchase(raw);
    if (!p || p.isExpense || isVoidStatus(p.status) || p.date > day) continue;
    for (const l of readPurchaseLines(raw)) {
      const id = l.itemId || byName.get(l.name.trim().toLowerCase());
      if (!id || !(l.quantity > 0) || !(l.unitCost > 0)) continue;
      const rate = l.unitCost / (l.unitFactor || 1);
      const prev = last.get(id);
      if (!prev || p.date >= prev.date) last.set(id, { date: p.date, rate });
    }
  }
  return new Map([...last].map(([k, v]) => [k, round2(v.rate)]));
}

export interface WhatIfRow {
  item_id: string;
  name: string;
  standard: number;
  latest: number;
  /** Change in batch cost from this ingredient. */
  delta: number;
}

/** Ingredient by ingredient: standard vs latest purchase rate, and the batch-cost change; plus both card costs. */
export function whatIf(card: CostCard, latest: ReadonlyMap<string, number>): { rows: WhatIfRow[]; standard: CardCost; current: CardCost } {
  const rows = card.lines.filter((l) => latest.has(l.item_id)).map((l) => {
    const now = latest.get(l.item_id)!;
    return { item_id: l.item_id, name: l.name, standard: n(l.rate), latest: now, delta: round2((now - n(l.rate)) * n(l.qty)) };
  });
  return { rows, standard: cardCost(card), current: cardCost(card, latest) };
}

/** Rate of an item on `day`: its dated standard cost, else its opening rate. */
export function standardRate(item: { standard_costs?: { from: string; rate: number }[]; opening_rate?: number } | undefined, day: string): number {
  let rate: number | undefined;
  for (const s of [...(item?.standard_costs ?? [])].sort((a, b) => a.from.localeCompare(b.from))) if (s.from <= day && n(s.rate) > 0) rate = n(s.rate);
  return round2(rate ?? n(item?.opening_rate));
}

/** Recipe lines from a BOM (quantities per `batch_qty`, grossed up by scrap %). */
export function linesFromBom(
  bom: { batch_qty: number; components: { item_id: string; qty: number; scrap_pct?: number }[] },
  items: readonly { id: string; name: string; unit: string; standard_costs?: { from: string; rate: number }[]; opening_rate?: number }[],
  day: string,
): CostCardLine[] {
  return bom.components.filter((c) => c.item_id && n(c.qty) > 0).map((c) => {
    const it = items.find((i) => i.id === c.item_id);
    return { item_id: c.item_id, name: it?.name ?? c.item_id, qty: Math.round(n(c.qty) * (1 + n(c.scrap_pct) / 100) * 1000) / 1000, unit: it?.unit, rate: standardRate(it, day) };
  });
}

/** The card version in force for `itemId` on `day` (latest `effective_from` ≤ day). */
export function cardAt(cards: readonly CostCard[], itemId: string, day: string): CostCard | undefined {
  let hit: CostCard | undefined;
  for (const c of cards) if (c.item_id === itemId && c.effective_from <= day && (!hit || c.effective_from > hit.effective_from)) hit = c;
  return hit;
}

/** '' or why the card cannot be saved. */
export function validateCard(c: Pick<CostCard, 'item_id' | 'effective_from' | 'lines' | 'output_kg' | 'packs'>): string {
  if (!c.item_id) return 'Pick the item the recipe makes.';
  if (!isoDay(c.effective_from)) return 'Choose the date the card applies from.';
  if (!c.lines.length) return 'Add the recipe (or load it from the BOM).';
  if (c.lines.some((l) => !(n(l.qty) > 0) || n(l.rate) < 0)) return 'Every ingredient needs a quantity above zero and a rate.';
  if (!(n(c.output_kg) > 0)) return 'Type the output of one batch in kg.';
  if (c.packs.some((p) => !(n(p.pack_kg) > 0))) return 'Every pack needs its net weight.';
  return '';
}

/* ── Store ────────────────────────────────────────────────────── */

export const costCardsDb = {
  all: (): CostCard[] => getTable<CostCard>(COST_CARDS_TABLE).filter((r) => r && typeof r.id === 'string'),

  /** Save a version. Same item + same `effective_from` replaces that version (one card per item per day). */
  save(input: Omit<CostCard, 'id'> & { id?: string }): CostCard {
    requireAccess('master.edit');
    const err = validateCard(input);
    if (err) throw new Error(err);
    const rows = costCardsDb.all();
    const prev = rows.find((r) => r.id === input.id) ?? rows.find((r) => r.item_id === input.item_id && r.effective_from === input.effective_from);
    const now = new Date().toISOString();
    const row: CostCard = {
      ...prev, ...input, id: prev?.id ?? generateId(),
      output_kg: n(input.output_kg), conversion_per_kg: round2(n(input.conversion_per_kg)), overhead_pct: n(input.overhead_pct),
      created_at: prev?.created_at ?? now, updated_at: now,
    };
    setTable(COST_CARDS_TABLE, prev ? rows.map((r) => (r.id === prev.id ? row : r)) : [...rows, row]);
    return row;
  },

  /** Delete one version (to the recycle bin through the watched table). */
  remove(id: string): void {
    requireAccess('master.edit');
    const rows = costCardsDb.all();
    if (!rows.some((r) => r.id === id)) return;
    setTable(COST_CARDS_TABLE, rows.filter((r) => r.id !== id));
  },
};
