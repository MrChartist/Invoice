/**
 * Editor glue for scanning (6.7) and price levels / slabs / schemes (6.9). Every action reads the
 * live store, so the components only call these. With no level, slab or scheme defined, picking an
 * item behaves exactly as before (the catalogue's rate, no basis, no free lines).
 */
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { localDb } from '../../lib/localDb';
import { generateId, getTable } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';
import { TABLES, type StockItem } from '../../lib/inventory';
import { addScannedLine, findByCode } from '../../lib/scan';
import {
  catalogItemFor, levelForClient, loadPricing, masterClient, pricingInUse, resolvePrice, syncSchemeLines,
  type PriceLevel, type PricingData,
} from '../../lib/pricing';
import type { InvoiceItem } from '../../types/invoice';

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
  const data = loadPricing();
  if (!pricingInUse(data) || !pricedDoc()) return null;
  const st = useInvoiceStore.getState();
  const level = levelForClient(masterClient(localDb.clients.getAll(), st.client), data.levels);
  return { data, level };
}

/** Re-price one line from its catalogue row (level + slab) and keep scheme free lines in step. */
function reprice(lineId: string, ctx: EditorPricing, force = false): void {
  const st = useInvoiceStore.getState();
  const line = st.items.find((i) => i.id === lineId);
  if (!line || line.free_of) return;
  const cat = catalogItemFor(ctx.data.catalog, line.name);
  if (!cat) return;
  // A typed rate (no basis) is the user's choice: leave it, unless asked to re-price.
  if (!force && !line.price_basis && num(line.rate) !== num(cat.rate)) return;
  const quote = resolvePrice(cat, num(line.quantity), ctx.level);
  if (quote.rate !== num(line.rate) || quote.basis !== line.price_basis) {
    st.patchItem(lineId, { rate: quote.rate, price_basis: quote.basis });
  }
}

function syncSchemes(ctx: EditorPricing | null): void {
  const st = useInvoiceStore.getState();
  if (!ctx && !st.items.some((i) => i.free_of)) return;
  const next = syncSchemeLines(st.items, ctx?.data.schemes ?? [], st.issue_date, generateId);
  if (next !== st.items) st.patch({ items: next });
}

/** Catalogue pick (typeahead or picker): fills the line, then applies level / slab / scheme. */
export function pickCatalogItem(lineId: string, source: Partial<InvoiceItem>): void {
  const st = useInvoiceStore.getState();
  st.applyCatalogItem(lineId, source);
  const ctx = editorPricing();
  if (!ctx) {
    syncSchemes(null);
    return;
  }
  reprice(lineId, ctx, true);
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
    if (ctx) reprice(r.lineId, ctx, true);
    syncSchemes(ctx);
  }
  const line = useInvoiceStore.getState().items.find((i) => i.id === r.lineId);
  return { ok: true, message: `${match.item.name} × ${line?.quantity ?? 1}${line?.price_basis ? ` · ${line.price_basis} price` : ''}` };
}
