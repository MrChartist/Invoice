/**
 * Item catalogue management — the saved list of services/products with their
 * default rate, HSN/SAC, unit and GST slab that the invoice editor pre-fills.
 *
 * Pure rules (validation, uniqueness, bulk rate changes) live here so they are
 * testable; storage goes through `getTable`/`setTable` like every other table.
 */

import type { InvoiceItem } from '../types/invoice';
import { round2 } from './invoice-calc';
import { KEYS, generateId, getTable, setTable } from './storage';

export interface CatalogDraft {
  /** Present when editing an existing item. */
  id?: string;
  name: string;
  type: string;
  hsn: string;
  unit: string;
  rate: number;
  tax_rate: number;
}

export type CatalogError = { field: 'name' | 'rate' | 'hsn' | 'tax_rate'; message: string };

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** First problem with a draft, or null when it can be saved. */
export function validateCatalogItem(
  draft: CatalogDraft,
  existing: Pick<InvoiceItem, 'id' | 'name'>[],
): CatalogError | null {
  if (!draft.name.trim()) return { field: 'name', message: 'Give the item a name.' };
  const clash = existing.find((i) => norm(i.name) === norm(draft.name) && i.id !== draft.id);
  if (clash) return { field: 'name', message: `“${clash.name}” is already in your catalogue.` };
  if (!Number.isFinite(draft.rate) || draft.rate < 0) return { field: 'rate', message: 'The rate cannot be negative.' };
  if (draft.hsn && !/^\d{4,8}$/.test(draft.hsn.trim())) {
    return { field: 'hsn', message: 'HSN / SAC is 4 to 8 digits.' };
  }
  if (!Number.isFinite(draft.tax_rate) || draft.tax_rate < 0 || draft.tax_rate > 100) {
    return { field: 'tax_rate', message: 'GST rate must be between 0 and 100.' };
  }
  return null;
}

/** Applies a draft to the list, returning the new list and the saved row. Pure. */
export function applyCatalogDraft(
  items: InvoiceItem[],
  draft: CatalogDraft,
  newId: () => string = generateId,
): { items: InvoiceItem[]; saved: InvoiceItem } {
  const base = {
    name: draft.name.trim(),
    type: draft.type || 'Service',
    hsn: draft.hsn.trim(),
    unit: draft.unit,
    rate: round2(draft.rate),
    tax_rate: draft.tax_rate,
  };
  const idx = draft.id ? items.findIndex((i) => i.id === draft.id) : -1;
  if (idx >= 0) {
    const saved = { ...items[idx], ...base };
    return { items: items.map((i, n) => (n === idx ? saved : i)), saved };
  }
  const saved = { quantity: 1, amount: 0, ...base, id: newId() } as InvoiceItem;
  return { items: [...items, saved], saved };
}

export type RoundTo = 'paise' | 'rupee' | 'five' | 'ten';

function roundTo(value: number, mode: RoundTo): number {
  switch (mode) {
    case 'rupee':
      return Math.round(value);
    case 'five':
      return Math.round(value / 5) * 5;
    case 'ten':
      return Math.round(value / 10) * 10;
    default:
      return round2(value);
  }
}

/**
 * Raises (or lowers) default rates by a percentage — e.g. an annual price revision.
 * Only the listed ids change; free items (rate 0) stay free; rates never go below 0.
 */
export function bulkAdjustRates(
  items: InvoiceItem[],
  ids: ReadonlySet<string> | 'all',
  percent: number,
  mode: RoundTo = 'paise',
): InvoiceItem[] {
  if (!Number.isFinite(percent)) return items;
  return items.map((i) => {
    if (ids !== 'all' && !ids.has(i.id)) return i;
    if (!(i.rate > 0)) return i;
    return { ...i, rate: Math.max(roundTo(i.rate * (1 + percent / 100), mode), 0) };
  });
}

/* ── storage wrappers ─────────────────────────────────────────── */

export function listCatalog(): InvoiceItem[] {
  return getTable<InvoiceItem>(KEYS.items);
}

export function saveCatalogItem(draft: CatalogDraft): { ok: true; item: InvoiceItem } | { ok: false; error: CatalogError } {
  const items = listCatalog();
  const error = validateCatalogItem(draft, items);
  if (error) return { ok: false, error };
  const { items: next, saved } = applyCatalogDraft(items, draft);
  setTable(KEYS.items, next);
  return { ok: true, item: saved };
}

export function removeCatalogItem(id: string): void {
  setTable(KEYS.items, listCatalog().filter((i) => i.id !== id));
}

export function adjustCatalogRates(ids: ReadonlySet<string> | 'all', percent: number, mode: RoundTo): number {
  const before = listCatalog();
  const after = bulkAdjustRates(before, ids, percent, mode);
  setTable(KEYS.items, after);
  return after.filter((item, n) => item.rate !== before[n].rate).length;
}
