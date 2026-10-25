/**
 * Item catalogue management — the saved list of services/products with their
 * default rate, HSN/SAC, unit and GST slab that the invoice editor pre-fills.
 *
 * Pure rules (validation, uniqueness, bulk rate changes) live here so they are
 * testable; storage goes through `getTable`/`setTable` like every other table.
 */

import type { InvoiceItem, QtySlab } from '../types/invoice';
import { round2 } from './invoice-calc';
import { ean13CheckDigit, isCode128BText } from './barcode';
import { codeKey } from './scan';
import { cleanSlabs, mrpLessRate } from './pricing';
import { KEYS, generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';

export interface CatalogDraft {
  /** Present when editing an existing item. */
  id?: string;
  name: string;
  type: string;
  hsn: string;
  unit: string;
  rate: number;
  tax_rate: number;
  /** Item custom-field values (6.23), already cleaned; undefined clears them. */
  custom_fields?: Record<string, string>;
  /** Barcode / SKU / MRP (6.7) and quantity slabs (6.9); blank clears them. */
  barcode?: string;
  sku?: string;
  mrp?: number;
  qty_slabs?: QtySlab[];
  /** 8E retail speed: short code, sold by weight + scale PLU, "MRP less %" pricing; blank / false clears them. */
  short_code?: string;
  sold_by_weight?: boolean;
  plu?: string;
  mrp_less_percent?: number;
}

export type CatalogError = { field: 'name' | 'rate' | 'hsn' | 'tax_rate' | 'barcode' | 'sku' | 'short_code' | 'plu' | 'mrp_less_percent'; message: string };

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** First problem with a draft, or null when it can be saved. */
export function validateCatalogItem(
  draft: CatalogDraft,
  existing: (Pick<InvoiceItem, 'id' | 'name'> & Partial<Pick<InvoiceItem, 'barcode' | 'sku' | 'short_code' | 'plu'>>)[],
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
  const barcode = (draft.barcode ?? '').trim();
  if (barcode) {
    if (!isCode128BText(barcode)) return { field: 'barcode', message: 'A barcode takes letters, digits and plain punctuation only.' };
    if (/^\d{13}$/.test(barcode) && ean13CheckDigit(barcode.slice(0, 12)) !== Number(barcode[12])) {
      return { field: 'barcode', message: `This EAN-13 has a wrong check digit — it should end in ${ean13CheckDigit(barcode.slice(0, 12))}.` };
    }
    const twin = existing.find((i) => i.id !== draft.id && codeKey((i as InvoiceItem).barcode) === codeKey(barcode));
    if (twin) return { field: 'barcode', message: `“${twin.name}” already has this barcode.` };
  }
  const sku = (draft.sku ?? '').trim();
  if (sku) {
    const twin = existing.find((i) => i.id !== draft.id && codeKey((i as InvoiceItem).sku) === codeKey(sku));
    if (twin) return { field: 'sku', message: `“${twin.name}” already uses this SKU.` };
  }
  const short = (draft.short_code ?? '').trim();
  if (short) {
    if (!/^[A-Za-z0-9._-]{1,12}$/.test(short)) return { field: 'short_code', message: 'A short code is up to 12 letters / digits, no spaces.' };
    const twin = existing.find((i) => i.id !== draft.id && codeKey(i.short_code) === codeKey(short));
    if (twin) return { field: 'short_code', message: `“${twin.name}” already uses this short code.` };
  }
  const plu = (draft.plu ?? '').trim();
  if (plu) {
    if (!/^\d{1,6}$/.test(plu)) return { field: 'plu', message: 'A scale PLU is 1 to 6 digits.' };
    const twin = existing.find((i) => i.id !== draft.id && i.plu && codeKey(i.plu) === codeKey(plu));
    if (twin) return { field: 'plu', message: `“${twin.name}” already has PLU ${plu}.` };
  }
  const pct = Number(draft.mrp_less_percent ?? 0);
  if (pct) {
    if (!(pct > 0 && pct < 100)) return { field: 'mrp_less_percent', message: 'MRP less % is between 0 and 100.' };
    if (!(Number(draft.mrp) > 0)) return { field: 'mrp_less_percent', message: 'Enter the MRP to price the item as MRP less %.' };
  }
  return null;
}

/** Applies a draft to the list, returning the new list and the saved row. Pure. */
export function applyCatalogDraft(
  items: InvoiceItem[],
  draft: CatalogDraft,
  newId: () => string = generateId,
): { items: InvoiceItem[]; saved: InvoiceItem } {
  // 8E: "MRP less %" — the rate follows the MRP so every reader (editor, importers, labels) sees the price.
  const mrpLess = Number(draft.mrp_less_percent) > 0 && Number(draft.mrp) > 0;
  const base = {
    name: draft.name.trim(),
    type: draft.type || 'Service',
    hsn: draft.hsn.trim(),
    unit: draft.unit,
    rate: mrpLess ? mrpLessRate({ rate: draft.rate, mrp: Number(draft.mrp), mrp_less_percent: Number(draft.mrp_less_percent) }) : round2(draft.rate),
    tax_rate: draft.tax_rate,
    ...('custom_fields' in draft ? { custom_fields: draft.custom_fields } : {}),
  };
  // Barcode / SKU / MRP / slabs: only touched when the draft carries them; blank removes them.
  const extras: Partial<InvoiceItem> = {};
  const drop: (keyof InvoiceItem)[] = [];
  const text = (k: 'barcode' | 'sku') => {
    if (!(k in draft)) return;
    const v = draft[k]?.trim();
    if (v) extras[k] = v;
    else drop.push(k);
  };
  text('barcode');
  text('sku');
  const text8 = (k: 'short_code' | 'plu') => {
    if (!(k in draft)) return;
    const v = draft[k]?.trim();
    if (v) extras[k] = v;
    else drop.push(k);
  };
  text8('short_code');
  text8('plu');
  if ('sold_by_weight' in draft) {
    if (draft.sold_by_weight) extras.sold_by_weight = true;
    else drop.push('sold_by_weight');
  }
  if ('mrp_less_percent' in draft) {
    if (mrpLess) extras.mrp_less_percent = Number(draft.mrp_less_percent);
    else drop.push('mrp_less_percent');
  }
  if ('mrp' in draft) {
    if (Number(draft.mrp) > 0) extras.mrp = round2(Number(draft.mrp));
    else drop.push('mrp');
  }
  if ('qty_slabs' in draft) {
    const slabs = cleanSlabs(draft.qty_slabs);
    if (slabs.length) extras.qty_slabs = slabs;
    else drop.push('qty_slabs');
  }
  const finish = (row: InvoiceItem): InvoiceItem => {
    const out = { ...row, ...extras };
    for (const k of drop) delete out[k];
    return out;
  };
  const idx = draft.id ? items.findIndex((i) => i.id === draft.id) : -1;
  if (idx >= 0) {
    const saved = finish({ ...items[idx], ...base });
    return { items: items.map((i, n) => (n === idx ? saved : i)), saved };
  }
  const saved = finish({ quantity: 1, amount: 0, ...base, id: newId() } as InvoiceItem);
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

/* ── Create an item from an unknown code (8E, roadmap 8.149) ─────── */

export interface QuickItemFields {
  name: string;
  rate: number;
  tax_rate: number;
  hsn?: string;
  unit?: string;
}

/**
 * The catalogue draft for a code nobody has yet: the code becomes the item's barcode (a valid EAN-13 /
 * printable code) — or its short code when it is a short word typed at the counter ("SB"). Pure.
 */
export function quickItemDraft(code: string, f: QuickItemFields): CatalogDraft {
  const c = String(code ?? '').trim();
  const asShort = !!c && /^[A-Za-z0-9._-]{1,6}$/.test(c) && !/^\d{6,}$/.test(c);
  return {
    name: f.name,
    type: 'Product',
    hsn: (f.hsn ?? '').replace(/\D/g, ''),
    unit: f.unit || 'NOS',
    rate: Number(f.rate) || 0,
    tax_rate: Number(f.tax_rate) || 0,
    ...(asShort ? { short_code: c } : { barcode: c }),
  };
}

/** Save a quick item (needs `master.edit`, like every catalogue change). */
export function createItemFromCode(code: string, f: QuickItemFields): { ok: true; item: InvoiceItem } | { ok: false; error: CatalogError } {
  requireAccess('master.edit');
  return saveCatalogItem(quickItemDraft(code, f));
}
