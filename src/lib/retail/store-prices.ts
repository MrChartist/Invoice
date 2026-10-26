/**
 * Store price lists (R4-B3): a branch (store) may carry a price list (`Branch.price_level_id`, one of the price levels)
 * and dated per-item overrides (table `branch_prices`, `master.edit`). `resolvePrice` (pricing.ts) applies them in this
 * order — the first that sets a rate wins, then a lower quantity slab still applies:
 *   1. a rate the user typed (the line has no price basis: never re-priced);
 *   2. the customer's own price level (rate or % off);
 *   3. the store's dated override for the item;
 *   4. the store's price list (rate or % off);
 *   5. the stock item's selling price list on the date (`listRateOn`);
 *   6. the catalogue rate.
 * Credit / debit notes are never re-priced. The line note says "Store price (Mall)".
 *
 * Which store: the editor uses the document's branch (or the branch of its business profile); the POS a device-local
 * "This counter is branch …" choice (`mrchartist_pos_branch`, never backed up), defaulting to the profile's branch.
 */
import type { BranchPrice } from '../../types/stores-r4';
import type { Branch } from '../branch';
import type { PriceLevel, BranchPriceContext } from '../pricing';
import { num, round2 } from '../invoice-calc';
import { parseCsv, toCsv } from '../csv';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';

export const BRANCH_PRICES_TABLE = 'branch_prices';
/** Device-local POS branch (outside the data prefix: never backed up or synced). */
export const POS_BRANCH_KEY = 'mrchartist_pos_branch';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The store's override for an item on `day` (latest `from` ≤ day), or undefined. */
export function overrideOn(prices: readonly BranchPrice[], branchId: string, itemId: string, day: string): number | undefined {
  let best: BranchPrice | undefined;
  for (const p of prices) {
    if (p.branch_id !== branchId || p.item_id !== itemId || !ISO.test(p.from) || p.from > day || !(num(p.rate) >= 0)) continue;
    if (!best || p.from >= best.from) best = p;
  }
  return best ? round2(num(best.rate)) : undefined;
}

/** The pricing context of a store for one item on `day` (null without a store or anything it prices). */
export function branchContext(
  branch: Pick<Branch, 'id' | 'name' | 'price_level_id'> | null | undefined, itemId: string, day: string,
  prices: readonly BranchPrice[], levels: readonly PriceLevel[],
): BranchPriceContext | null {
  if (!branch) return null;
  const override = itemId ? overrideOn(prices, branch.id, itemId, day) : undefined;
  const level = branch.price_level_id ? levels.find((l) => l.id === branch.price_level_id) ?? null : null;
  if (override === undefined && !level) return null;
  return { name: branch.name, ...(override !== undefined ? { override } : {}), ...(level ? { level } : {}) };
}

/** Does any store price apply at all (a store with a price list, or any override)? */
export function storePricingInUse(branches: readonly Pick<Branch, 'price_level_id'>[], prices: readonly BranchPrice[]): boolean {
  return prices.length > 0 || branches.some((b) => !!b.price_level_id);
}

/* ── POS counter branch (device-local) ────────────────────────── */

export function readPosBranch(): string {
  try {
    return globalThis.localStorage?.getItem(POS_BRANCH_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writePosBranch(id: string): void {
  try {
    if (id) globalThis.localStorage?.setItem(POS_BRANCH_KEY, id);
    else globalThis.localStorage?.removeItem(POS_BRANCH_KEY);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

/** The counter's branch: the device choice when it still exists, else the branch of the business profile. */
export function posBranch(branches: readonly Branch[], profileId: string | undefined, chosen: string = readPosBranch()): Branch | undefined {
  const live = branches.filter((b) => !b.inactive);
  return live.find((b) => b.id === chosen) ?? (profileId ? live.find((b) => b.profile_id === profileId) : undefined);
}

/* ── Store ────────────────────────────────────────────────────── */

export const branchPricesDb = {
  all: (): readonly BranchPrice[] => peekTable<BranchPrice>(BRANCH_PRICES_TABLE),

  /** Set (or with `rate` null remove) a store's rate for an item from `from`. */
  set(branchId: string, itemId: string, from: string, rate: number | null): void {
    requireAccess('master.edit');
    if (!branchId || !itemId) throw new Error('Choose the store and the item.');
    if (!ISO.test(from)) throw new Error('Choose the date the price applies from.');
    if (rate !== null && !(num(rate, -1) >= 0)) throw new Error('Enter a rate of zero or more.');
    const rows = getTable<BranchPrice>(BRANCH_PRICES_TABLE).filter((p) => !(p.branch_id === branchId && p.item_id === itemId && p.from === from));
    setTable(BRANCH_PRICES_TABLE, rate === null ? rows : [...rows, { id: generateId(), branch_id: branchId, item_id: itemId, from, rate: round2(num(rate)) }]);
  },

  /** Replace many cells at once (grid save / CSV import); returns how many rows were written. */
  bulk(cells: readonly { branch_id: string; item_id: string; from: string; rate: number | null }[]): number {
    requireAccess('master.edit');
    let rows = getTable<BranchPrice>(BRANCH_PRICES_TABLE);
    let n = 0;
    for (const c of cells) {
      if (!c.branch_id || !c.item_id || !ISO.test(c.from)) continue;
      rows = rows.filter((p) => !(p.branch_id === c.branch_id && p.item_id === c.item_id && p.from === c.from));
      if (c.rate !== null && num(c.rate, -1) >= 0) {
        rows.push({ id: generateId(), branch_id: c.branch_id, item_id: c.item_id, from: c.from, rate: round2(num(c.rate)) });
        n++;
      }
    }
    setTable(BRANCH_PRICES_TABLE, rows);
    try {
      audit.record({ entity: 'item', entity_id: 'branch_prices', action: 'update', summary: `Store prices updated: ${n} rate(s) set, ${cells.length - n} cleared` });
    } catch {
      /* logging never breaks a save */
    }
    return n;
  },
};

/* ── Grid and CSV ─────────────────────────────────────────────── */

/** The rate grid on `day`: item id → branch id → effective override. Pure. */
export function priceGrid(prices: readonly BranchPrice[], itemIds: readonly string[], branchIds: readonly string[], day: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const i of itemIds) {
    const row = new Map<string, number>();
    for (const b of branchIds) {
      const r = overrideOn(prices, b, i, day);
      if (r !== undefined) row.set(b, r);
    }
    out.set(i, row);
  }
  return out;
}

/** CSV: Item, then one column per store (rate in force on `day`; empty = none). */
export function gridCsv(items: readonly { id: string; name: string }[], branches: readonly { id: string; name: string }[], prices: readonly BranchPrice[], day: string): string {
  const grid = priceGrid(prices, items.map((i) => i.id), branches.map((b) => b.id), day);
  return toCsv([
    ['Item', ...branches.map((b) => b.name)],
    ...items.map((i) => [i.name, ...branches.map((b) => grid.get(i.id)?.get(b.id) ?? '')]),
  ]);
}

/**
 * Read a grid CSV back (items and stores matched by name, case-insensitive). Empty cells are skipped; a cell "-"
 * clears the store price from `from`. Returns the cells and the names that were not found.
 */
export function parseGridCsv(
  text: string, items: readonly { id: string; name: string }[], branches: readonly { id: string; name: string }[], from: string,
): { cells: { branch_id: string; item_id: string; from: string; rate: number | null }[]; unknown: string[] } {
  const rows = parseCsv(text);
  const unknown: string[] = [];
  if (!rows.length) return { cells: [], unknown };
  const key = (s: unknown) => String(s ?? '').trim().toLowerCase();
  const itemBy = new Map(items.map((i) => [key(i.name), i.id]));
  const branchBy = new Map(branches.map((b) => [key(b.name), b.id]));
  const cols = rows[0].slice(1).map((h) => {
    const id = branchBy.get(key(h));
    if (!id && String(h ?? '').trim()) unknown.push(String(h).trim());
    return id;
  });
  const cells: { branch_id: string; item_id: string; from: string; rate: number | null }[] = [];
  for (const r of rows.slice(1)) {
    const name = String(r[0] ?? '').trim();
    if (!name) continue;
    const item = itemBy.get(key(name));
    if (!item) {
      unknown.push(name);
      continue;
    }
    cols.forEach((b, i) => {
      const raw = String(r[i + 1] ?? '').trim();
      if (!b || !raw) return;
      if (raw === '-') cells.push({ branch_id: b, item_id: item, from, rate: null });
      else {
        const v = Number(raw.replace(/[₹,\s]/g, ''));
        if (Number.isFinite(v) && v >= 0) cells.push({ branch_id: b, item_id: item, from, rate: round2(v) });
      }
    });
  }
  return { cells, unknown };
}
