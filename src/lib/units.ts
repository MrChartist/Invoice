/**
 * Units of measure (WP-8, P1-10 — Tally's "Unit of Measure": Simple / Compound, and "Alternate Units").
 *
 *  - Units master (table `units`): a symbol, formal name, the GST UQC it reports as and its decimal
 *    places. The app's built-in units (`UNITS`) are implicit rows; a stored row with the same symbol
 *    only overrides them (UQC / decimals / name). A **compound** row is "1 BOX = 12 NOS": it never
 *    becomes an item's base unit, it is a ready-made alternate unit for items counted in NOS.
 *  - Alternate units on a stock item (`StockItem.alt_units`): `{unit: 'BOX', factor: 12}` means one BOX
 *    is 12 of the item's base unit. A document line typed in an alternate unit keeps `unit` = 'BOX',
 *    the quantity and rate as typed (2 BOX @ ₹600), and snapshots `unit_factor: 12`; the stock engine
 *    converts with `lineFactor` (24 NOS in, cost ₹50 / NOS). Lines in the base unit carry no factor, so
 *    every older line reads as factor 1. The snapshot means a later change to the item's factor never
 *    rewrites history.
 *
 * Pure above the "Storage" divider (node:test); `unitsDb` writes through the storage layer.
 */

import { UNITS } from '../types/invoice';
import { num } from './invoice-calc';
import { requireAccess } from './access';
import { audit } from './audit';
import { generateId, getTable, setTable } from './storage';
import type { ItemIndex, StockItem } from './inventory';

export const UNITS_TABLE = 'units';
const EPS = 1e-9;

/** One alternate unit of a stock item: 1 `unit` = `factor` base units. */
export interface AltUnit {
  unit: string;
  factor: number;
}

/** A row of the units master. `first` / `factor` / `second` make it a compound unit (1 first = factor second). */
export interface UnitMaster {
  id: string;
  symbol: string;
  name?: string;
  /** GST Unit Quantity Code it reports as (GSTR-1 HSN summary, e-Invoice, e-Way); absent = mapped from the symbol. */
  uqc?: string;
  /** Decimal places a quantity in this unit may carry (0 = whole numbers). */
  decimals?: number;
  first?: string;
  factor?: number;
  second?: string;
  created_at?: string;
  updated_at?: string;
}

/* ── Pure: conversion ─────────────────────────────────────────── */

const key = (s: unknown) => String(s ?? '').trim().toUpperCase();
const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

/** Base units per one unit of a document line (`unit_factor`); 1 when absent or invalid. */
export function lineFactor(line: { unit_factor?: unknown } | null | undefined): number {
  const f = num(line?.unit_factor);
  return f > EPS ? f : 1;
}

/** A line's quantity in the item's base unit. */
export function baseQty(line: { quantity?: unknown; unit_factor?: unknown }): number {
  return num(line.quantity) * lineFactor(line);
}

/** Valid alternate units of an item (positive factor, not the base unit, no duplicates), first spelling kept. */
export function cleanAltUnits(list: unknown, base: string): AltUnit[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const seen = new Set<string>([key(base)]);
  const out: AltUnit[] = [];
  for (const raw of list) {
    const r = (raw ?? {}) as Partial<AltUnit>;
    const unit = String(r.unit ?? '').trim();
    const factor = num(r.factor);
    if (!unit || !(factor > EPS) || seen.has(key(unit)) || Math.abs(factor - 1) < EPS) continue;
    seen.add(key(unit));
    out.push({ unit, factor: roundQty(factor) || factor });
  }
  return out.length ? out : undefined;
}

/** Why an alternate-unit list cannot be saved, or ''. */
export function validateAltUnits(list: readonly AltUnit[], base: string): string {
  const seen = new Set<string>([key(base)]);
  for (const a of list) {
    const u = key(a.unit);
    if (!u && !num(a.factor)) continue; // an empty row is ignored
    if (!u) return 'Every alternate unit needs a unit.';
    if (u === key(base)) return `${a.unit} is the item's main unit.`;
    if (seen.has(u)) return `${a.unit} is listed twice.`;
    if (!(num(a.factor) > EPS)) return `Enter how many ${base} make one ${a.unit}.`;
    if (Math.abs(num(a.factor) - 1) < EPS) return `1 ${a.unit} = 1 ${base}: use the main unit instead.`;
    seen.add(u);
  }
  return '';
}

/** The units a line of this item may be typed in: the base unit (factor 1) first, then its alternates. */
export function unitChoices(item: Pick<StockItem, 'unit' | 'alt_units'>): AltUnit[] {
  return [{ unit: item.unit || 'NOS', factor: 1 }, ...(cleanAltUnits(item.alt_units, item.unit || 'NOS') ?? [])];
}

/** Base units per one `unit` of the item (1 for the base unit), or undefined for a unit it does not use. */
export function factorFor(item: Pick<StockItem, 'unit' | 'alt_units'>, unit: string | undefined): number | undefined {
  const k = key(unit);
  if (!k) return 1;
  return unitChoices(item).find((c) => key(c.unit) === k)?.factor;
}

/** Rate after switching a line from one unit to another (₹50 / NOS → ₹600 / BOX of 12). */
export function rescaleRate(rate: number, fromFactor: number, toFactor: number): number {
  const r = num(rate);
  if (!(r > 0) || !(fromFactor > EPS) || !(toFactor > EPS)) return r;
  return Math.round(((r * toFactor) / fromFactor + Number.EPSILON) * 100) / 100;
}

/**
 * The line fields for typing a line of `item` in `unit`: the unit, its factor snapshot (absent for the
 * base unit) and the rate rescaled from the line's previous unit.
 */
export function lineUnitPatch(
  item: Pick<StockItem, 'unit' | 'alt_units'>,
  line: { unit?: string; unit_factor?: unknown; rate?: unknown },
  unit: string,
): { unit: string; unit_factor: number | undefined; rate: number } {
  const to = factorFor(item, unit) ?? 1;
  const from = lineFactor(line);
  return { unit, unit_factor: to === 1 ? undefined : to, rate: rescaleRate(num(line.rate), from, to) };
}

/**
 * Tally-style compound display of a base quantity: 26 NOS with BOX = 12 → "2 BOX 2 NOS". Uses the
 * largest alternate unit only; '' when the item has none or the quantity is below one of it.
 */
export function compoundText(qty: number, item: Pick<StockItem, 'unit' | 'alt_units'>): string {
  const alts = cleanAltUnits(item.alt_units, item.unit || 'NOS');
  if (!alts || Math.abs(qty) < EPS) return '';
  const big = alts.reduce((a, b) => (b.factor > a.factor ? b : a));
  if (big.factor < 1 || Math.abs(qty) < big.factor - EPS) return '';
  const sign = qty < 0 ? '-' : '';
  const abs = Math.abs(qty);
  const whole = Math.floor((abs + EPS) / big.factor);
  const rest = roundQty(abs - whole * big.factor);
  return `${sign}${whole} ${big.unit}${rest > EPS ? ` ${rest} ${item.unit || 'NOS'}` : ''}`;
}

/* ── Pure: masters ────────────────────────────────────────────── */

/** Decimal places of the built-in units: counts are whole, measures carry three. */
const BUILT_IN_DECIMALS: Record<string, number> = { NOS: 0, PCS: 0, SET: 0, BOX: 0, LOT: 0, KG: 3, LTR: 3, MTR: 2, SQF: 2, HRS: 2, DAY: 1, MONTH: 0 };

/** Every simple unit: the built-ins (overridden by a stored row of the same symbol), then the user's own. */
export function unitList(stored: readonly UnitMaster[]): UnitMaster[] {
  const simple = stored.filter((u) => u?.symbol?.trim() && !isCompound(u));
  const bySymbol = new Map(simple.map((u) => [key(u.symbol), u]));
  const builtIn: UnitMaster[] = UNITS.map((s) => ({ id: `builtin:${s}`, symbol: s, decimals: BUILT_IN_DECIMALS[s] ?? 2, ...bySymbol.get(s) }));
  const own = simple.filter((u) => !(UNITS as readonly string[]).includes(key(u.symbol)));
  return [...builtIn, ...own];
}

export function isCompound(u: Pick<UnitMaster, 'first' | 'second' | 'factor'>): boolean {
  return !!(u.first && u.second && num(u.factor) > 0);
}

/** Compound rows ("1 BOX = 12 NOS"). */
export function compoundUnits(stored: readonly UnitMaster[]): UnitMaster[] {
  return stored.filter((u) => u && isCompound(u));
}

/** Symbols a unit picker offers: every simple unit, plus `current` when it is not among them (old data). */
export function unitSymbols(stored: readonly UnitMaster[], current?: string): string[] {
  const list = unitList(stored).map((u) => u.symbol);
  if (current && !list.some((s) => key(s) === key(current))) list.push(current);
  return list;
}

/** Decimal places allowed for a unit (stored override, built-in default, else 3). */
export function decimalsFor(unit: string | undefined, stored: readonly UnitMaster[]): number {
  const u = unitList(stored).find((x) => key(x.symbol) === key(unit));
  const d = num(u?.decimals ?? 3);
  return Math.min(Math.max(Math.round(d), 0), 6);
}

/** Round a quantity to a unit's decimal places. */
export function roundToUnit(qty: number, decimals: number): number {
  const p = 10 ** Math.min(Math.max(Math.round(decimals), 0), 6);
  return Math.round((num(qty) + Number.EPSILON) * p) / p || 0;
}

/**
 * A typed quantity rounded to the decimal places of the unit it was typed in (7M): 2.5 NOS → 3, 1.23456 KG →
 * 1.235. Units the master does not know keep three places. Non-numbers read as 0.
 */
export function roundTypedQty(qty: unknown, unit: string | undefined, stored: readonly UnitMaster[]): number {
  return roundToUnit(num(qty), decimalsFor(unit, stored));
}

/** UQC of a unit: the master's explicit code, else `fallback(symbol)` (the e-Invoice / GSTR mapping). */
export function uqcFor(unit: string | undefined, stored: readonly UnitMaster[], fallback: (u?: string) => string): string {
  const u = stored.find((x) => !isCompound(x) && key(x.symbol) === key(unit));
  return u?.uqc?.trim() ? key(u.uqc) : fallback(unit);
}

/** Why a unit row cannot be saved, or ''. */
export function validateUnit(u: Pick<UnitMaster, 'id' | 'symbol' | 'first' | 'second' | 'factor' | 'decimals'>, stored: readonly UnitMaster[]): string {
  if (u.first || u.second) {
    if (!u.first?.trim() || !u.second?.trim()) return 'Choose both units of the compound unit.';
    if (key(u.first) === key(u.second)) return 'The two units must be different.';
    if (!(num(u.factor) > 0)) return `Enter how many ${u.second} make one ${u.first}.`;
    const dup = stored.some((x) => x.id !== u.id && isCompound(x) && key(x.first) === key(u.first) && key(x.second) === key(u.second));
    return dup ? `1 ${u.first} = ? ${u.second} already exists.` : '';
  }
  const symbol = u.symbol?.trim() ?? '';
  if (!symbol) return 'Enter the unit symbol.';
  if (!/^[A-Za-z0-9.\-/ ]{1,12}$/.test(symbol)) return 'Use up to 12 letters or digits for the symbol.';
  if (num(u.decimals) < 0 || num(u.decimals) > 6) return 'Decimal places must be 0 to 6.';
  const clash = stored.some((x) => x.id !== u.id && !isCompound(x) && key(x.symbol) === key(symbol));
  return clash ? `The unit ${symbol} already exists.` : '';
}

/** Stock items that use a unit (as their main unit or an alternate). */
export function unitReferences(symbol: string, items: readonly Pick<StockItem, 'name' | 'unit' | 'alt_units'>[]): string[] {
  const k = key(symbol);
  return items.filter((i) => key(i.unit) === k || (i.alt_units ?? []).some((a) => key(a?.unit) === k)).map((i) => i.name);
}

/* ── Pure: editor context ─────────────────────────────────────── */

export interface UnitPickContext {
  /** The stock item of a line and its unit choices, when the item has alternate units. */
  find(name: string, hsn?: string): { item: StockItem; choices: AltUnit[] } | undefined;
}

/**
 * Line-editor helper: null when no stock item has an alternate unit (simple users see nothing new and
 * pay one array scan per catalogue refresh, never per keystroke).
 */
export function unitPickContext(items: readonly StockItem[], index: ItemIndex): UnitPickContext | null {
  if (!items.some((i) => i.track_stock && cleanAltUnits(i.alt_units, i.unit || 'NOS'))) return null;
  return {
    find(name, hsn) {
      const item = name.trim() ? index.find(name, hsn) : undefined;
      if (!item || !cleanAltUnits(item.alt_units, item.unit || 'NOS')) return undefined;
      return { item, choices: unitChoices(item) };
    },
  };
}

/* ── Storage ──────────────────────────────────────────────────── */

const now = () => new Date().toISOString();

function log(id: string, action: 'create' | 'update' | 'delete', summary: string): void {
  try {
    audit.record({ entity: 'item', entity_id: id, action, summary });
  } catch {
    /* logging never breaks a save */
  }
}

export const unitsDb = {
  stored: (): UnitMaster[] => getTable<UnitMaster>(UNITS_TABLE).filter((u) => u && typeof u.id === 'string'),
  list: (): UnitMaster[] => unitList(unitsDb.stored()),

  /** Add or edit a simple or compound unit (a built-in symbol is stored as an override). */
  save(input: Omit<UnitMaster, 'id'> & { id?: string }): UnitMaster {
    requireAccess('master.edit');
    const rows = unitsDb.stored();
    const id = input.id && !input.id.startsWith('builtin:') ? input.id : '';
    const existing = id ? rows.find((u) => u.id === id) : undefined;
    const compound = !!(input.first || input.second);
    const draft: UnitMaster = compound
      ? { id: existing?.id ?? generateId(), symbol: `${key(input.first)} of ${input.factor} ${key(input.second)}`, first: key(input.first), factor: num(input.factor), second: key(input.second) }
      : {
        id: existing?.id ?? generateId(), symbol: key(input.symbol),
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        ...(input.uqc?.trim() ? { uqc: key(input.uqc) } : {}),
        decimals: Math.min(Math.max(Math.round(num(input.decimals)), 0), 6),
      };
    const problem = validateUnit(draft, rows);
    if (problem) throw new Error(problem);
    const row: UnitMaster = { ...draft, created_at: existing?.created_at ?? now(), updated_at: now() };
    setTable(UNITS_TABLE, existing ? rows.map((u) => (u.id === row.id ? row : u)) : [...rows, row]);
    log(row.id, existing ? 'update' : 'create', compound ? `Compound unit 1 ${row.first} = ${row.factor} ${row.second} ${existing ? 'edited' : 'added'}` : `Unit ${row.symbol} ${existing ? 'edited' : 'added'}${row.uqc ? ` (UQC ${row.uqc})` : ''}`);
    return row;
  },

  /** Delete a stored unit; refused while a stock item uses a simple unit (built-ins return to their defaults). */
  remove(id: string, items: readonly Pick<StockItem, 'name' | 'unit' | 'alt_units'>[]): void {
    requireAccess('master.edit');
    const row = unitsDb.stored().find((u) => u.id === id);
    if (!row) return;
    if (!isCompound(row) && !(UNITS as readonly string[]).includes(key(row.symbol))) {
      const refs = unitReferences(row.symbol, items);
      if (refs.length) throw new Error(`${row.symbol} is used by ${refs.slice(0, 3).join(', ')}${refs.length > 3 ? ` and ${refs.length - 3} more` : ''}, so it cannot be deleted.`);
    }
    setTable(UNITS_TABLE, unitsDb.stored().filter((u) => u.id !== id));
    log(id, 'delete', `Unit ${row.symbol} deleted`);
  },
};
