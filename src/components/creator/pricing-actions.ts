/**
 * Editor glue for scanning (6.7) and price levels / slabs / schemes (6.9). Every action reads the
 * live store, so the components only call these. With no level, slab or scheme defined, picking an
 * item behaves exactly as before (the catalogue's rate, no basis, no free lines).
 */
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { localDb } from '../../lib/localDb';
import { KEYS, generateId, getTable, peekTable } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';
import { TABLES, type StockItem } from '../../lib/inventory';
import { addScannedLine, findByCode } from '../../lib/scan';
import {
  PRICE_LEVELS_TABLE, SCHEMES_TABLE, catalogItemFor, levelForClient, masterClient, pricingInUse, resolvePrice, syncSchemeLines,
  type PriceLevel, type PricingData, type Scheme,
} from '../../lib/pricing';
import type { Client, InvoiceItem } from '../../types/invoice';
import { PRICE_LIST_BASIS, priceListRate } from '../../lib/price-list';

/** Notes don't take part: a credit / debit note re-states an earlier price. */
const pricedDoc = () => {
  const t = useInvoiceStore.getState().doc_type;
  return t !== 'CREDIT_NOTE' && t !== 'DEBIT_NOTE';
};

export interface EditorPricing {
  data: PricingData;
  level: PriceLevel | null;
}

/** Pricing data and the current party's level, or null when the user has not set pricing up. */
export function editorPricing(): EditorPricing | null {
  const data = editorPricingData();
  if (!pricingInUse(data) || !pricedDoc()) return null;
  const st = useInvoiceStore.getState();
  const level = levelForClient(masterClient(peekTable<Client>(KEYS.clients), st.client), data.levels);
  return { data, level };
}

/**
 * `loadPricing()` as read-only views (perf: this runs on every quantity keystroke, and the tables
 * only change on other screens). Nothing here mutates them: lines copy the fields they need.
 */
function editorPricingData(): PricingData {
  return {
    levels: peekTable<PriceLevel>(PRICE_LEVELS_TABLE) as PriceLevel[],
    schemes: peekTable<Scheme>(SCHEMES_TABLE) as Scheme[],
    catalog: peekTable<InvoiceItem>(KEYS.items) as InvoiceItem[],
  };
}

/** 7S (7.66): the stock item's selling price-list rate on the document date, for a line (read-only view, no re-parse). */
function listRateFor(line: Pick<InvoiceItem, 'name' | 'hsn'>): number | undefined {
  if (!pricedDoc()) return undefined;
  const items = peekTable<StockItem>(TABLES.items);
  if (!items.some((i) => i.selling_prices?.length)) return undefined;
  return priceListRate(items, line.name, line.hsn, useInvoiceStore.getState().issue_date);
}

/**
 * Re-price one line from its catalogue row (level + slab) and keep scheme free lines in step. 7S: a selling
 * price list in force replaces the catalogue's base rate; a customer level's own rate still wins.
 */
function reprice(lineId: string, ctx: EditorPricing | null, force = false): void {
  const st = useInvoiceStore.getState();
  const line = st.items.find((i) => i.id === lineId);
  if (!line || line.free_of) return;
  const cat = ctx ? catalogItemFor(ctx.data.catalog, line.name) : undefined;
  const list = listRateFor(line);
  if (!cat && list === undefined) return;
  const base = list ?? num(cat?.rate);
  // A typed rate (no basis) is the user's choice: leave it, unless asked to re-price.
  if (!force && !line.price_basis && num(line.rate) !== base) return;
  const quote = resolvePrice({ id: cat?.id ?? '', rate: base, qty_slabs: cat?.qty_slabs, mrp: cat?.mrp }, num(line.quantity), ctx?.level); // 8E: an MRP level reads the MRP
  const basis = quote.source === 'base' && list !== undefined ? PRICE_LIST_BASIS : quote.basis;
  if (quote.rate !== num(line.rate) || basis !== line.price_basis) {
    st.patchItem(lineId, { rate: quote.rate, price_basis: basis });
  }
}

function syncSchemes(ctx: EditorPricing | null): void {
  const st = useInvoiceStore.getState();
  if (!ctx && !st.items.some((i) => i.free_of)) return;
  const next = syncSchemeLines(st.items, ctx?.data.schemes ?? [], st.issue_date, generateId, ctx?.data.catalog ?? []);
  if (next !== st.items) st.patch({ items: next });
}

/** Catalogue pick (typeahead or picker): fills the line, then applies level / slab / scheme. */
export function pickCatalogItem(lineId: string, source: Partial<InvoiceItem>): void {
  const st = useInvoiceStore.getState();
  st.applyCatalogItem(lineId, source);
  const ctx = editorPricing();
  reprice(lineId, ctx, true); // 7S: also applies a selling price list without levels / slabs
  syncSchemes(ctx);
}

/** Quantity typed on a line: slabs may change the rate; schemes follow. */
export function setLineQuantity(lineId: string, qty: number): void {
  const st = useInvoiceStore.getState();
  st.updateItem(lineId, 'quantity', qty);
  const ctx = editorPricing();
  if (ctx) reprice(lineId, ctx);
  syncSchemes(ctx);
}

/** Rate typed on a line: the user's price wins (the automatic basis is dropped). */
export function setLineRate(lineId: string, rate: number): void {
  const st = useInvoiceStore.getState();
  st.updateItem(lineId, 'rate', rate);
  if (st.items.find((i) => i.id === lineId)?.price_basis) st.patchItem(lineId, { price_basis: undefined });
}

/** Name typed / removed: schemes follow the item on the line. */
export function afterLineChange(): void {
  syncSchemes(editorPricing());
}

/** Re-price every catalogue line for the current party (after picking a client with a level). */
export function repriceAll(): number {
  const ctx = editorPricing();
  if (!ctx) return 0;
  let n = 0;
  for (const line of useInvoiceStore.getState().items) {
    if (line.free_of || !catalogItemFor(ctx.data.catalog, line.name)) continue;
    reprice(line.id, ctx, true);
    n++;
  }
  syncSchemes(ctx);
  return n;
}

/** True when the catalogue or stock has any barcode / SKU (the editor then shows its scan box). */
export function hasCodes(): boolean {
  return (
    localDb.items.getAll().some((i) => i.barcode || i.sku) ||
    getTable<StockItem>(TABLES.items).some((i) => i.barcode || i.sku)
  );
}

/** A scanned / typed code: add the item, or raise the quantity of its line. */
export function addScannedCode(code: string): { ok: boolean; message: string } {
  const st = useInvoiceStore.getState();
  const match = findByCode(code, localDb.items.getAll(), getTable<StockItem>(TABLES.items));
  if (!match) return { ok: false, message: `No item has the code ${code}. Add it to the item in Settings → Items or Inventory.` };
  const r = addScannedLine(st.items, match.item, { newId: generateId, fallbackTaxRate: st.tax_rate });
  if (r.incremented) {
    const line = r.items.find((i) => i.id === r.lineId)!;
    setLineQuantity(r.lineId, num(line.quantity));
  } else {
    st.patch({ items: r.items });
    st.applyCatalogItem(r.lineId, match.item); // same fields (and item custom fields) as a catalogue pick
    const ctx = editorPricing();
    reprice(r.lineId, ctx, true);
    syncSchemes(ctx);
  }
  const line = useInvoiceStore.getState().items.find((i) => i.id === r.lineId);
  return { ok: true, message: `${match.item.name} × ${line?.quantity ?? 1}${line?.price_basis ? ` · ${line.price_basis} price` : ''}` };
}
