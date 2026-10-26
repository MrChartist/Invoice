/**
 * Price levels, quantity slabs and buy-X-get-Y schemes (roadmap 6.9). All opt-in: with no level,
 * slab or scheme defined every function returns the catalogue's base rate and no basis, so the
 * editor and POS behave exactly as before.
 *
 * Resolution (`resolvePrice`), for a catalogue item, a quantity and the party's price level:
 *   1. base       = the catalogue rate
 *   2. level      = the level's own rate for this item if it has one, else base less the level's % off
 *   3. slab       = the rate of the highest quantity slab with min_qty ≤ quantity
 *   4. the line gets the LOWER of (level, or base without a level) and slab; on a tie the level wins.
 * A typed rate always wins: the editor drops `price_basis` when the user types one, and a line
 * without a basis is never re-priced.
 *
 * Schemes: buy `buy_qty`, get `free_qty` of the same item free, for every full `buy_qty` sold.
 * The free goods are a separate ₹0 line (`scheme_id`, `free_of`) right below the paid line. GST is
 * charged on the price actually paid for the bundle — CBIC Circular 92/11/2019-GST treats
 * "buy one get one free" as one supply of both goods for that price, not a free supply — so the ₹0
 * line has no taxable value. Verify with your CA.
 *
 * 7U: `kind: 'buy_get'` — buy `buy_qty` of item A, get `free_qty` of item B (`free_item_id` /
 * `free_item_name`) as the ₹0 line; `kind: 'bill_value'` — bill-value discount slabs (`slabs`), applied
 * as an invoice discount by `offers.ts`, never as a line. Absent kind = the original same-item scheme.
 *
 * Pure logic first; storage wrappers at the bottom.
 */

import type { Client, InvoiceItem, QtySlab } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { KEYS, generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { effectiveMrp } from './retail/rt-mrp'; // R9 (RT-A2)

export const PRICE_LEVELS_TABLE = 'price_levels';
export const SCHEMES_TABLE = 'schemes';

export interface PriceLevel {
  id: string;
  name: string;
  /** Percent off the base rate for items without their own rate in this level (0–100). */
  percent_off?: number;
  /** Own rate per catalogue item id (wins over `percent_off`). */
  rates?: Record<string, number>;
  /**
   * Additive (8E, 8.145): what `percent_off` is taken from — 'mrp' = "MRP less %" (items without an MRP fall
   * back to their rate). Absent = the item's rate.
   */
  basis?: 'rate' | 'mrp';
  created_at?: string;
}

export interface Scheme {
  id: string;
  /** Catalogue item id (and its name, for display and matching lines by name). */
  item_id: string;
  item_name: string;
  buy_qty: number;
  free_qty: number;
  /** YYYY-MM-DD, inclusive; absent = open-ended. */
  valid_from?: string;
  valid_to?: string;
  /** false = paused. Absent = active. */
  active?: boolean;
  created_at?: string;
  /* ── 7U offers (additive) ── */
  /** Absent / 'same' = buy X get Y of the same item; 'buy_get' = buy A get B; 'bill_value' = bill-value slabs. */
  kind?: 'same' | 'buy_get' | 'bill_value';
  /** buy_get: the free item (catalogue id + name). */
  free_item_id?: string;
  free_item_name?: string;
  /** bill_value: from a bill value (after line discounts) → % off or ₹ off; the highest slab reached applies. */
  slabs?: BillSlab[];
  /** bill_value: printed name, e.g. "Diwali offer". */
  label?: string;
}

export interface BillSlab {
  min_value: number;
  percent?: number;
  amount?: number;
}

export interface PriceQuote {
  rate: number;
  /** What set the rate, printed as a hint ("Wholesale", "Qty ≥ 10", "Store price (Mall)"); undefined = base rate. */
  basis?: string;
  source: 'base' | 'level' | 'slab' | 'branch' | 'party';
}

/**
 * R4-B3: the store (branch) a line is priced for — its dated override for the item and its price list. Built by
 * `retail/store-prices.ts` (`branchContext`).
 */
export interface BranchPriceContext {
  /** Store name, for the line note "Store price (Mall)". */
  name: string;
  /** The store's own rate for the item on the date. */
  override?: number;
  /** The store's price list (rate or % off). */
  level?: PriceLevel | null;
}

/** "Store price (Mall)" — the line note of a rate set by a store's price list or override. */
export const storeBasis = (name: string): string => `Store price (${name})`;

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** Clean, sorted slabs (positive min qty, non-negative rate, one per min qty — the last one typed wins). */
export function cleanSlabs(raw: unknown): QtySlab[] {
  if (!Array.isArray(raw)) return [];
  const byQty = new Map<number, number>();
  for (const s of raw as Partial<QtySlab>[]) {
    const min = num(s?.min_qty);
    const rate = num(s?.rate, -1);
    if (min > 0 && rate >= 0) byQty.set(min, round2(rate));
  }
  return [...byQty.entries()].sort((a, b) => a[0] - b[0]).map(([min_qty, rate]) => ({ min_qty, rate }));
}

/** The slab that applies to `qty` (highest min_qty ≤ qty), or undefined. */
export function slabFor(slabs: readonly QtySlab[] | undefined, qty: number): QtySlab | undefined {
  let best: QtySlab | undefined;
  for (const s of cleanSlabs(slabs)) if (qty >= s.min_qty) best = s;
  return best;
}

/**
 * 8E (8.145): "MRP less %" — the rate of an item priced as its MRP less `mrp_less_percent`; the item's own
 * rate when it has no MRP or no such percent. The catalogue form stores the result as `rate` too, so
 * importers and conversions see the same price.
 */
export function mrpLessRate(item: Pick<InvoiceItem, 'rate'> & Partial<Pick<InvoiceItem, 'mrp' | 'mrp_less_percent' | 'mrp_tax_basis' | 'tax_rate'>>): number {
  const mrp = item.mrp_tax_basis ? effectiveMrp(num(item.mrp), item.mrp_tax_basis, num(item.tax_rate)) : num(item.mrp); // R9 (RT-A2): GST-cut MRP
  const pct = num(item.mrp_less_percent);
  if (mrp > 0 && pct > 0 && pct < 100) return round2(mrp * (1 - pct / 100));
  return round2(num(item.rate));
}

/** The level's rate for a catalogue item (own rate, else % off base — or off MRP for an MRP level), or undefined when it sets none. */
export function levelRate(level: PriceLevel | null | undefined, item: Pick<InvoiceItem, 'id' | 'rate'> & Partial<Pick<InvoiceItem, 'mrp' | 'mrp_less_percent'>>): number | undefined {
  if (!level) return undefined;
  const own = level.rates?.[item.id];
  if (typeof own === 'number' && Number.isFinite(own) && own >= 0) return round2(own);
  const pct = num(level.percent_off);
  if (pct > 0 && pct <= 100) {
    const from = level.basis === 'mrp' && num(item.mrp) > 0 ? num(item.mrp) : mrpLessRate(item);
    return round2(from * (1 - pct / 100));
  }
  return undefined;
}

/**
 * Price of `qty` units of a catalogue item for a party at `level` (see the module comment for the order).
 * R4-B3 precedence with a store (`branch`): typed rate (caller) → customer's level → store's dated override → store's
 * price list → `item.rate` (the caller passes the selling price-list rate there when one is in force) → catalogue
 * rate. A lower quantity slab still applies to the result.
 */
export function resolvePrice(
  item: Pick<InvoiceItem, 'id' | 'rate' | 'qty_slabs'> & Partial<Pick<InvoiceItem, 'mrp' | 'mrp_less_percent'>>,
  qty: number,
  level?: PriceLevel | null,
  branch?: BranchPriceContext | null,
  /** TR-A1: the party-item special rate (`trade/tr-party-rates.ts`) — wins over every other source. */
  partyRate?: number,
): PriceQuote {
  if (num(partyRate) > 0) return { rate: round2(num(partyRate)), basis: 'Party rate', source: 'party' };
  const base = mrpLessRate(item);
  const lvl = levelRate(level, item);
  const store = lvl === undefined && branch ? (branch.override !== undefined ? round2(branch.override) : levelRate(branch.level, item)) : undefined;
  let quote: PriceQuote = lvl !== undefined
    ? { rate: lvl, basis: level!.name, source: 'level' }
    : store !== undefined ? { rate: store, basis: storeBasis(branch!.name), source: 'branch' } : { rate: base, source: 'base' };
  const slab = slabFor(item.qty_slabs, num(qty));
  if (slab && slab.rate < quote.rate) {
    quote = { rate: slab.rate, basis: `Qty ≥ ${slab.min_qty}`, source: 'slab' };
  }
  return quote;
}

/** True when the scheme runs on `day` (YYYY-MM-DD). */
export function schemeActive(s: Scheme, day: string): boolean {
  if (s.active === false) return false;
  if (s.kind === 'bill_value') {
    if (!(s.slabs ?? []).some((x) => num(x.min_value) >= 0 && (num(x.percent) > 0 || num(x.amount) > 0))) return false;
  } else if ((!(num(s.buy_qty) > 0) || !(num(s.free_qty) > 0)) && !s.free_slabs?.length) return false; // TR-A2: or free slabs
  if (s.valid_from && day < s.valid_from) return false;
  if (s.valid_to && day > s.valid_to) return false;
  return true;
}

/** The running scheme for an item (by catalogue id, else by name) on `day`; the first defined wins. */
export function schemeFor(
  schemes: readonly Scheme[],
  item: { id?: string; name: string },
  day: string,
): Scheme | undefined {
  return schemes.find(
    (s) => s.kind !== 'bill_value' && !s.scope && schemeActive(s, day) && ((item.id && s.item_id === item.id) || norm(s.item_name) === norm(item.name)),
  );
}

/** Free quantity earned by buying `paidQty`: free_qty for every full buy_qty. */
export function freeQty(s: Pick<Scheme, 'buy_qty' | 'free_qty'>, paidQty: number): number {
  const buy = num(s.buy_qty);
  if (!(buy > 0) || !(paidQty > 0)) return 0;
  return Math.floor((paidQty + 1e-9) / buy) * num(s.free_qty);
}

export const schemeLabel = (s: Pick<Scheme, 'buy_qty' | 'free_qty'> & Partial<Pick<Scheme, 'kind' | 'item_name' | 'free_item_name' | 'label' | 'slabs'>>): string => {
  if (s.kind === 'bill_value') {
    const slabs = (s.slabs ?? []).map((x) => `${num(x.percent) > 0 ? `${num(x.percent)}%` : `₹${num(x.amount)}`} off from ₹${num(x.min_value)}`);
    return `${s.label?.trim() || 'Bill offer'}: ${slabs.join(', ')}`;
  }
  if (s.kind === 'buy_get') return `Buy ${s.buy_qty} ${s.item_name ?? ''} get ${s.free_qty} ${s.free_item_name ?? ''} free`.replace(/\s+/g, ' ');
  return `Buy ${s.buy_qty} get ${s.free_qty} free`;
};

/**
 * Add, update or remove the ₹0 free lines of `items` so each paid line carries exactly the free
 * quantity its scheme earns (inserted right after it). Free lines whose paid line is gone, or
 * whose scheme no longer applies, are removed. Pure: returns a new array (or the same one when
 * nothing changed).
 */
export function syncSchemeLines(
  items: readonly InvoiceItem[],
  schemes: readonly Scheme[],
  day: string,
  newId: () => string = generateId,
  /** 7U: the catalogue, to give a buy-A-get-B free line item B's HSN / unit / GST rate. */
  catalog: readonly InvoiceItem[] = [],
  /** TR-A2: scoped schemes (`trade/tr-schemes.ts` `applyScopedSchemes`), given the lines after this pass and before it. */
  scoped?: (after: InvoiceItem[], before: readonly InvoiceItem[]) => InvoiceItem[],
): InvoiceItem[] {
  if (schemes.length === 0 && !items.some((i) => i.free_of)) return items as InvoiceItem[];
  const paidIds = new Set(items.filter((i) => !i.free_of).map((i) => i.id));
  const freeByPaid = new Map<string, InvoiceItem>();
  for (const i of items) if (i.free_of && paidIds.has(i.free_of) && !freeByPaid.has(i.free_of)) freeByPaid.set(i.free_of, i);

  const out: InvoiceItem[] = [];
  let changed = false;
  for (const line of items) {
    if (line.free_of) {
      if (freeByPaid.get(line.free_of) !== line) changed = true; // orphan / duplicate free line: drop
      continue;
    }
    out.push(line);
    const scheme = line.name.trim() ? schemeFor(schemes, { name: line.name }, day) : undefined;
    const want = scheme ? (scheme.free_slabs?.length ? Math.max(0, ...scheme.free_slabs.filter((x) => num(line.quantity) >= num(x.min_qty)).map((x) => num(x.free_qty))) : freeQty(scheme, num(line.quantity))) : 0;
    const existing = freeByPaid.get(line.id);
    if (!scheme || want <= 0) {
      if (existing) changed = true;
      continue;
    }
    const other = scheme.kind === 'buy_get'
      ? (scheme.free_item_id && catalog.find((c) => c.id === scheme.free_item_id)) || catalog.find((c) => norm(c.name) === norm(scheme.free_item_name ?? '')) || { name: scheme.free_item_name ?? line.name, type: line.type, hsn: line.hsn, unit: line.unit, tax_rate: line.tax_rate }
      : null;
    const free: InvoiceItem = {
      ...(existing ?? {}),
      id: existing?.id ?? newId(),
      name: other ? other.name : line.name,
      description: `Free under scheme: ${schemeLabel(scheme)}`,
      type: other?.type ?? line.type,
      hsn: other ? other.hsn : line.hsn,
      unit: other ? other.unit : line.unit,
      quantity: want,
      rate: 0,
      tax_rate: other ? other.tax_rate : line.tax_rate,
      discount_percent: 0,
      amount: 0,
      scheme_id: scheme.id,
      free_of: line.id,
      ...(line.godown_id ? { godown_id: line.godown_id } : {}),
    };
    // Serial-tracked goods need their own serials picked: keep only as many as the free qty.
    if (existing?.serials?.length) free.serials = existing.serials.slice(0, want);
    else delete free.serials;
    delete free.price_basis;
    if (!existing || JSON.stringify(existing) !== JSON.stringify(free)) changed = true;
    out.push(free);
  }
  if (scoped) {
    const next = scoped(out, items);
    if (JSON.stringify(next) !== JSON.stringify(items)) return next;
    return items as InvoiceItem[];
  }
  return changed ? out : (items as InvoiceItem[]);
}

/** The price level a party buys at: its own `price_level`, looked up in `levels`; null when none. */
export function levelForClient(
  client: Pick<Client, 'price_level'> | null | undefined,
  levels: readonly PriceLevel[],
): PriceLevel | null {
  const id = client?.price_level;
  return (id && levels.find((l) => l.id === id)) || null;
}

/** Validation for the level form; '' when fine. */
export function validateLevel(level: Pick<PriceLevel, 'id' | 'name' | 'percent_off'>, existing: readonly PriceLevel[]): string {
  if (!level.name.trim()) return 'Give the price level a name.';
  if (existing.some((l) => l.id !== level.id && norm(l.name) === norm(level.name))) return `A level called “${level.name.trim()}” already exists.`;
  const pct = num(level.percent_off);
  if (pct < 0 || pct > 100) return 'The discount must be between 0 and 100%.';
  return '';
}

/** Validation for the scheme form; '' when fine. */
export function validateScheme(s: Pick<Scheme, 'item_id' | 'item_name' | 'buy_qty' | 'free_qty' | 'valid_from' | 'valid_to'> & Partial<Pick<Scheme, 'kind' | 'free_item_id' | 'free_item_name' | 'slabs' | 'scope' | 'free_slabs'>>): string {
  if (s.kind === 'bill_value') {
    const slabs = s.slabs ?? [];
    if (!slabs.length) return 'Add at least one bill-value slab.';
    for (const x of slabs) {
      if (!(num(x.min_value) >= 0)) return 'A slab needs the bill value it starts from.';
      if (!(num(x.percent) > 0) === !(num(x.amount) > 0)) return 'Give each slab either a % off or a ₹ off.';
      if (num(x.percent) > 100) return 'A % off cannot be above 100.';
      if (num(x.amount) > 0 && num(x.amount) > num(x.min_value)) return 'A ₹ off cannot be more than the bill value it starts from.';
    }
    if (s.valid_from && s.valid_to && s.valid_to < s.valid_from) return 'The scheme ends before it starts.';
    return '';
  }
  if (!s.item_id && !s.item_name.trim() && !s.scope) return 'Pick the item the scheme is on.';
  if (s.kind === 'buy_get' && !s.free_item_id && !(s.free_item_name ?? '').trim()) return 'Pick the item given free.';
  if (s.free_slabs?.length) {
    if (s.free_slabs.some((x) => !(num(x.min_qty) > 0) || !(num(x.free_qty) > 0))) return 'Each free slab needs a quantity and a free quantity above zero.';
  } else {
    if (!(num(s.buy_qty) > 0) || !Number.isInteger(num(s.buy_qty))) return 'Buy quantity must be a whole number above zero.';
    if (!(num(s.free_qty) > 0) || !Number.isInteger(num(s.free_qty))) return 'Free quantity must be a whole number above zero.';
  }
  if (s.valid_from && s.valid_to && s.valid_to < s.valid_from) return 'The scheme ends before it starts.';
  return '';
}

/* ── Storage ─────────────────────────────────────────────────── */

export interface PricingData {
  levels: PriceLevel[];
  schemes: Scheme[];
  catalog: InvoiceItem[];
}

/** Everything pricing needs, read once. */
export function loadPricing(): PricingData {
  return {
    levels: getTable<PriceLevel>(PRICE_LEVELS_TABLE),
    schemes: getTable<Scheme>(SCHEMES_TABLE),
    catalog: getTable<InvoiceItem>(KEYS.items),
  };
}

/** True once the user has defined a level, a slab or a scheme (the UI shows pricing hints only then). */
export function pricingInUse(data: PricingData = loadPricing()): boolean {
  return data.levels.length > 0 || data.schemes.length > 0 || data.catalog.some((i) => cleanSlabs(i.qty_slabs).length > 0);
}

/** The catalogue row a line was picked from (by name, case-insensitive). */
export function catalogItemFor(catalog: readonly InvoiceItem[], name: string): InvoiceItem | undefined {
  const n = norm(name);
  return n ? catalog.find((i) => norm(i.name) === n) : undefined;
}

/** The master client row for a document's party (by id, else by name), to read its price level. */
export function masterClient(clients: readonly Client[], party: Pick<Client, 'id' | 'name'> | null | undefined): Client | undefined {
  if (!party) return undefined;
  return (party.id && clients.find((c) => c.id === party.id)) || clients.find((c) => norm(c.name) === norm(party.name) && !!norm(party.name));
}

export const priceLevelsDb = {
  all: (): PriceLevel[] => getTable<PriceLevel>(PRICE_LEVELS_TABLE),
  save: (level: PriceLevel): PriceLevel => {
    requireAccess('master.edit');
    const all = priceLevelsDb.all();
    const error = validateLevel(level, all);
    if (error) throw new Error(error);
    const row: PriceLevel = {
      id: level.id || generateId(),
      name: level.name.trim(),
      ...(num(level.percent_off) > 0 ? { percent_off: num(level.percent_off) } : {}),
      ...(level.rates && Object.keys(level.rates).length ? { rates: level.rates } : {}),
      ...(level.basis === 'mrp' ? { basis: 'mrp' as const } : {}),
      created_at: level.created_at || new Date().toISOString(),
    };
    const idx = all.findIndex((l) => l.id === row.id);
    if (idx >= 0) all[idx] = row;
    else all.push(row);
    setTable(PRICE_LEVELS_TABLE, all);
    return row;
  },
  /** Removes the level and clears it from every client that used it. */
  remove: (id: string): void => {
    requireAccess('master.edit');
    setTable(PRICE_LEVELS_TABLE, priceLevelsDb.all().filter((l) => l.id !== id));
    const clients = getTable<Client>(KEYS.clients);
    if (clients.some((c) => c.price_level === id)) {
      setTable(
        KEYS.clients,
        clients.map((c) => {
          if (c.price_level !== id) return c;
          const next = { ...c };
          delete next.price_level;
          return next;
        }),
      );
    }
  },
  /** Set (or clear, with undefined / a negative number) one item's own rate in a level. */
  setItemRate: (levelId: string, itemId: string, rate: number | undefined): void => {
    requireAccess('master.edit');
    const all = priceLevelsDb.all();
    const idx = all.findIndex((l) => l.id === levelId);
    if (idx < 0) return;
    const rates = { ...(all[idx].rates ?? {}) };
    if (rate === undefined || !Number.isFinite(rate) || rate < 0) delete rates[itemId];
    else rates[itemId] = round2(rate);
    const next = { ...all[idx] };
    if (Object.keys(rates).length) next.rates = rates;
    else delete next.rates;
    all[idx] = next;
    setTable(PRICE_LEVELS_TABLE, all);
  },
};

export const schemesDb = {
  all: (): Scheme[] => getTable<Scheme>(SCHEMES_TABLE),
  save: (s: Scheme): Scheme => {
    requireAccess('master.edit');
    const error = validateScheme(s);
    if (error) throw new Error(error);
    const all = schemesDb.all();
    const row: Scheme = {
      id: s.id || generateId(),
      item_id: s.item_id,
      item_name: s.item_name.trim(),
      buy_qty: num(s.buy_qty),
      free_qty: num(s.free_qty),
      ...(s.valid_from ? { valid_from: s.valid_from.slice(0, 10) } : {}),
      ...(s.valid_to ? { valid_to: s.valid_to.slice(0, 10) } : {}),
      ...(s.active === false ? { active: false } : {}),
      ...(s.kind && s.kind !== 'same' ? { kind: s.kind } : {}),
      ...(s.kind === 'buy_get' ? { free_item_id: s.free_item_id ?? '', free_item_name: (s.free_item_name ?? '').trim() } : {}),
      // TR-A2: scope v2, free slabs and the principal's claim terms are kept as entered (Distribution → Claims).
      ...(s.scope ? { scope: s.scope } : {}),
      ...(s.free_slabs?.length ? { free_slabs: s.free_slabs } : {}),
      ...(s.principal_vendor_id ? { principal_vendor_id: s.principal_vendor_id, claim_basis: s.claim_basis, ...(num(s.claim_rate) > 0 ? { claim_rate: num(s.claim_rate) } : {}) } : {}),
      ...(s.kind === 'bill_value' ? { slabs: (s.slabs ?? []).map((x) => ({ min_value: round2(num(x.min_value)), ...(num(x.percent) > 0 ? { percent: num(x.percent) } : { amount: round2(num(x.amount)) }) })).sort((a, b) => a.min_value - b.min_value), ...(s.label?.trim() ? { label: s.label.trim() } : {}) } : {}),
      created_at: s.created_at || new Date().toISOString(),
    };
    const idx = all.findIndex((x) => x.id === row.id);
    if (idx >= 0) all[idx] = row;
    else all.push(row);
    setTable(SCHEMES_TABLE, all);
    return row;
  },
  remove: (id: string): void => {
    requireAccess('master.edit');
    setTable(SCHEMES_TABLE, schemesDb.all().filter((s) => s.id !== id));
  },
};
