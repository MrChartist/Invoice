/**
 * Item variants (8.85 — Zoho Inventory "item groups", BUSY "parameterised items"). A parent stock item
 * keeps an attribute grid (`variant_axes`, e.g. Size: S / M / L × Colour: Red / Blue); generating it
 * creates one child stock item per combination with `variant_of` = parent id and `variant_attrs`, a name
 * "Parent - S / Red", a SKU "<parent SKU>-S-RED" and (optionally) an in-store EAN-13 barcode. Children are
 * ordinary stock items (stock, batches, prices are theirs); the parent itself is usually not stocked.
 * Existing children are kept (matched by their attribute values), so re-generating after adding a value
 * only adds the new combinations. Pure above "Storage".
 */

import { blankStockItem, stockDb, type StockItem } from './inventory';
import { nextInStoreEan } from './barcode';
import { requireAccess } from './access';
import { audit } from './audit';
import { getTable, setTable } from './storage';

export interface VariantAxis { name: string; values: string[] }

/** Clean axes: trimmed names / values, duplicates and empties dropped, at most 3 axes. */
export function cleanAxes(axes: readonly VariantAxis[]): VariantAxis[] {
  const seen = new Set<string>();
  const out: VariantAxis[] = [];
  for (const a of axes) {
    const name = String(a?.name ?? '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const vals: string[] = [];
    for (const v of a.values ?? []) {
      const t = String(v ?? '').trim();
      if (t && !vals.some((x) => x.toLowerCase() === t.toLowerCase())) vals.push(t);
    }
    if (vals.length) out.push({ name, values: vals });
  }
  return out.slice(0, 3);
}

/** Every combination of the axes, in grid order. */
export function combinations(axes: readonly VariantAxis[]): Record<string, string>[] {
  let out: Record<string, string>[] = [{}];
  for (const a of axes) out = out.flatMap((c) => a.values.map((v) => ({ ...c, [a.name]: v })));
  return axes.length ? out : [];
}

const skuPart = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'X';
const attrKey = (attrs: Record<string, string> | undefined, axes: readonly VariantAxis[]) => axes.map((a) => String(attrs?.[a.name] ?? '').toLowerCase()).join('|');

export interface VariantPlan {
  /** Children to create (new combinations). */
  create: StockItem[];
  /** Combinations that already have a child. */
  existing: StockItem[];
}

/**
 * Plan the children of `parent` for its axes. `taken` = barcodes / SKUs already used (codes are unique);
 * `withBarcodes` assigns in-store EAN-13 codes. Pure (ids from `newId`).
 */
export function planVariants(parent: StockItem, axes: readonly VariantAxis[], all: readonly StockItem[], opts: { withBarcodes?: boolean; newId: () => string }): VariantPlan {
  const clean = cleanAxes(axes);
  const kids = all.filter((i) => i.variant_of === parent.id);
  const have = new Map(kids.map((k) => [attrKey(k.variant_attrs, clean), k]));
  const names = new Set(all.map((i) => i.name.trim().toLowerCase()));
  const codes = new Set(all.flatMap((i) => [i.barcode, i.sku]).filter(Boolean).map((c) => String(c)));
  const create: StockItem[] = [];
  const existing: StockItem[] = [];
  const base = parent.sku?.trim() || skuPart(parent.name);
  for (const attrs of combinations(clean)) {
    const found = have.get(attrKey(attrs, clean));
    if (found) {
      existing.push(found);
      continue;
    }
    const label = clean.map((a) => attrs[a.name]).join(' / ');
    let name = `${parent.name} - ${label}`;
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${parent.name} - ${label} (${n})`;
    names.add(name.toLowerCase());
    let sku = `${base}-${clean.map((a) => skuPart(attrs[a.name])).join('-')}`;
    for (let n = 2; codes.has(sku); n++) sku = `${base}-${clean.map((a) => skuPart(attrs[a.name])).join('-')}-${n}`;
    codes.add(sku);
    let barcode: string | undefined;
    if (opts.withBarcodes) {
      barcode = nextInStoreEan(codes);
      codes.add(barcode);
    }
    create.push({
      ...blankStockItem({
        id: opts.newId(), name, sku, ...(barcode ? { barcode } : {}),
        unit: parent.unit, hsn: parent.hsn, tax_rate: parent.tax_rate, sale_rate: parent.sale_rate,
        track_stock: true, track_batches: parent.track_batches, reorder_level: 0,
        ...(parent.group_id ? { group_id: parent.group_id } : {}), ...(parent.category_id ? { category_id: parent.category_id } : {}),
        ...(parent.location ? { location: parent.location } : {}),
      }),
      variant_of: parent.id,
      variant_attrs: attrs,
    });
  }
  return { create, existing };
}

/* ── Storage ──────────────────────────────────────────────────── */

/** Save the grid on the parent and create the planned children in one write. `master.edit`; audited. */
export function generateVariants(parentId: string, axes: readonly VariantAxis[], opts: { withBarcodes?: boolean; newId: () => string }): VariantPlan {
  requireAccess('master.edit');
  const all = stockDb.items();
  const parent = all.find((i) => i.id === parentId);
  if (!parent) throw new Error('Stock item not found.');
  if (parent.variant_of) throw new Error('A variant cannot have variants of its own.');
  const clean = cleanAxes(axes);
  if (!clean.length) throw new Error('Add at least one attribute with values (e.g. Size: S, M, L).');
  const plan = planVariants(parent, clean, all, opts);
  if (plan.create.length + plan.existing.length > 200) throw new Error('That grid makes more than 200 variants; split it.');
  const next = getTable<StockItem>('stock_items').map((i) => (i.id === parentId ? { ...i, variant_axes: clean } : i));
  setTable('stock_items', [...next, ...plan.create]);
  try {
    audit.record({ entity: 'item', entity_id: parentId, action: 'update', summary: `Variants of ${parent.name}: ${plan.create.length} created, ${plan.existing.length} kept (${clean.map((a) => `${a.name}: ${a.values.join('/')}`).join(' × ')})` });
  } catch {
    /* logging never breaks a save */
  }
  return plan;
}

/** Children of a parent, in name order. */
export const variantsOf = (parentId: string, all: readonly StockItem[]): StockItem[] => all.filter((i) => i.variant_of === parentId).sort((a, b) => a.name.localeCompare(b.name));
