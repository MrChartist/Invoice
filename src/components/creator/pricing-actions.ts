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
import { binForName } from '../../lib/bins';
import {
  PRICE_LEVELS_TABLE, SCHEMES_TABLE, catalogItemFor, levelForClient, masterClient, pricingInUse, resolvePrice, syncSchemeLines,
  type PriceLevel, type PricingData, type Scheme,
} from '../../lib/pricing';
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import { LAST_RATE_BASIS, lastRateFor, lastRateToApply } from '../../lib/last-rate';
import { PRICE_LIST_BASIS, priceListRate } from '../../lib/price-list';
import { BRANCH_PRICES_TABLE, branchContext, storePricingInUse } from '../../lib/retail/store-prices'; // R4-B3
import { BRANCHES_TABLE, branchOfInvoice, type Branch } from '../../lib/branch';
import type { BranchPrice } from '../../types/stores-r4';
import type { ScopeCtx } from '../../lib/trade/tr-pricing';

// TR-A1 / A2: party rates and scoped schemes, loaded with the editor as their own chunk (until then: none apply).
let tr: typeof import('../../lib/trade/tr-pricing') | null = null;
import('../../lib/trade/tr-pricing').then((m) => { tr = m; }, () => {});

/** Notes don't take part: a credit / debit note re-states an earlier price. */
const pricedDoc = () => {
  const t = useInvoiceStore.getState().doc_type;
  return t !== 'CREDIT_NOTE' && t !== 'DEBIT_NOTE';
};

export interface EditorPricing {
  data: PricingData;
  level: PriceLevel | null;
  /** R4-B3: the document's store (branch) when it has a price list or store overrides. */
  store?: { branch: Branch; prices: readonly BranchPrice[] };
}

/** R4-B3: the document's branch (its own, else the branch of its business profile) when store pricing applies. */
function editorStore(): EditorPricing['store'] {
  const prices = peekTable<BranchPrice>(BRANCH_PRICES_TABLE);
  const branches = peekTable<Branch>(BRANCHES_TABLE);
  if (!branches.length || !storePricingInUse(branches, prices)) return undefined;
  const st = useInvoiceStore.getState();
  const id = branchOfInvoice({ branch_id: st.branch_id, sender: st.sender }, branches);
  const branch = branches.find((b) => b.id === id);
  return branch ? { branch, prices } : undefined;
}

/** Pricing data and the current party's level, or null when the user has not set pricing up. */
export function editorPricing(): EditorPricing | null {
  const data = editorPricingData();
  const store = pricedDoc() ? editorStore() : undefined;
  if ((!pricingInUse(data) && !store) || !pricedDoc()) return null;
  const st = useInvoiceStore.getState();
  const level = levelForClient(masterClient(peekTable<Client>(KEYS.clients), st.client), data.levels);
  return { data, level, ...(store ? { store } : {}) };
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
  // 8.104: a last-rate line keeps its rate when the quantity changes (re-pricing on demand still applies).
  if (!force && line.price_basis === LAST_RATE_BASIS) return;
  const cat = ctx ? catalogItemFor(ctx.data.catalog, line.name) : undefined;
  const list = listRateFor(line);
  // TR-A1: the party's special rate / discount for this item wins over levels, lists and slabs.
  const pr = pricedDoc() && tr ? tr.partyRateFor(tr.loadPartyRates(), 'sale', st.client, { id: cat?.id, name: line.name }, st.issue_date) : undefined;
  if (!cat && list === undefined && !pr) return;
  const base = list ?? (cat ? num(cat.rate) : num(line.rate));
  // A typed rate (no basis) is the user's choice: leave it, unless asked to re-price.
  if (!force && !line.price_basis && num(line.rate) !== base) return;
  const branch = ctx?.store ? branchContext(ctx.store.branch, cat?.id ?? '', st.issue_date, ctx.store.prices, ctx.data.levels) : null; // R4-B3
  const quote = resolvePrice({ id: cat?.id ?? '', rate: base, qty_slabs: cat?.qty_slabs, mrp: cat?.mrp }, num(line.quantity), ctx?.level, branch, pr?.rate); // 8E: an MRP level reads the MRP
  const basis = quote.source === 'base' && list !== undefined ? PRICE_LIST_BASIS : quote.source === 'base' && pr ? 'Party rate' : quote.basis;
  const disc = pr && (pr.disc_chain?.length || pr.disc_per_unit) ? { disc_chain: pr.disc_chain, disc_per_unit: pr.disc_per_unit, discount_percent: tr!.effectivePercent(pr.disc_chain, pr.disc_per_unit, quote.rate) } : {};
  if (quote.rate !== num(line.rate) || basis !== line.price_basis || ('discount_percent' in disc && disc.discount_percent !== line.discount_percent)) {
    st.patchItem(lineId, { rate: quote.rate, price_basis: basis, ...disc });
  }
}

function syncSchemes(ctx: EditorPricing | null): void {
  const st = useInvoiceStore.getState();
  if (!ctx && !st.items.some((i) => i.free_of)) return;
  const scoped = tr && ctx?.data.schemes.some((x) => x.scope) ? scopeCtx(ctx) : null; // TR-A2
  const next = syncSchemeLines(st.items, ctx?.data.schemes ?? [], st.issue_date, generateId, ctx?.data.catalog ?? [], scoped ? (after, before) => tr!.applyScopedSchemes(after, before, ctx!.data.schemes, st.issue_date, scoped, generateId, ctx!.data.catalog) : undefined);
  if (next !== st.items) st.patch({ items: next });
}

/** TR-A2: what a scoped scheme needs to know about the party and the items. */
function scopeCtx(ctx: EditorPricing): ScopeCtx {
  return { clientId: masterClient(peekTable<Client>(KEYS.clients), useInvoiceStore.getState().client)?.id, levelId: ctx.level?.id, ...tr!.liveScopeItems(ctx.data.catalog) };
}

/**
 * R9 (RT-C1): a picked / scanned item with a price band (`gst_band` on the catalogue row or its stock item) marks the
 * line for the band (decided by the lazy band hook); any other pick clears an old band. Credit notes keep their rate.
 */
function markBand(lineId: string, source: Partial<InvoiceItem>): void {
  const st = useInvoiceStore.getState();
  const kind = pricedDoc() ? source.gst_band ?? peekTable<StockItem>(TABLES.items).find((s) => s.name === source.name)?.gst_band : undefined;
  if (kind || st.items.find((i) => i.id === lineId)?.band_rate) st.patchItem(lineId, { band_rate: kind ? { kind, value_per_piece: 0 } : undefined });
}

/** Catalogue pick (typeahead or picker): fills the line, then applies level / slab / scheme. */
export function pickCatalogItem(lineId: string, source: Partial<InvoiceItem>): void {
  const st = useInvoiceStore.getState();
  st.applyCatalogItem(lineId, source);
  markBand(lineId, source); // R9 (RT-C1)
  // 8.86: a delivery challan line remembers the bin / rack it is picked from (printed on the challan).
  if (st.doc_type === 'DELIVERY_CHALLAN' && source.name) {
    const bin = binForName(getTable<StockItem>('stock_items'), source.name);
    if (bin) st.patchItem(lineId, { bin });
  }
  const ctx = editorPricing();
  reprice(lineId, ctx, true); // 7S: also applies a selling price list without levels / slabs
  applyLastRate(lineId);
  syncSchemes(ctx);
}

/** 8.104: below price levels / lists, the rate last billed to this party wins over the catalogue rate. */
function applyLastRate(lineId: string): void {
  if (!pricedDoc()) return;
  const st = useInvoiceStore.getState();
  const line = st.items.find((i) => i.id === lineId);
  if (!line || line.free_of || !line.name?.trim()) return;
  const last = lastRateFor(peekTable<InvoiceRecord>(KEYS.invoices), st.client, line.name, { excludeId: st.id, currency: st.currency });
  const rate = lastRateToApply(line, last);
  if (rate !== null) st.patchItem(lineId, { rate, price_basis: LAST_RATE_BASIS });
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
    markBand(r.lineId, match.item); // R9 (RT-C1)
    const ctx = editorPricing();
    reprice(r.lineId, ctx, true);
    syncSchemes(ctx);
  }
  const line = useInvoiceStore.getState().items.find((i) => i.id === r.lineId);
  return { ok: true, message: `${match.item.name} × ${line?.quantity ?? 1}${line?.price_basis ? ` · ${line.price_basis} price` : ''}` };
}
