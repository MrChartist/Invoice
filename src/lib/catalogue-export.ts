/**
 * Gathers what the catalogue v2 export needs (8H): photos (catalogue item `image`, else its stock
 * item's), categories (catalogue `group_id`, else the stock item's stock group) and stock on hand,
 * then builds the file with `buildCatalogue`. Loaded only when the user exports.
 */
import type { InvoiceItem } from '../types/invoice';
import { buildCatalogue } from './catalogue-html';
import { itemImageData } from './item-images';
import { localDb } from './localDb';
import { ASSET_TABLE } from './assets';
import { DB_PREFIX, getTable, readRaw } from './storage';

interface StockRef {
  name: string;
  image?: string;
  group_id?: string;
}

/** Item id → photo / category maps for the catalogue (pure apart from the inputs). */
export function catalogueMaps(
  items: readonly InvoiceItem[],
  stockItems: readonly StockRef[],
  groups: readonly { id: string; name: string }[],
  assetsRaw: string | null,
): { images: Map<string, string>; categories: Map<string, string> } {
  const byName = new Map(stockItems.map((s) => [s.name.trim().toLowerCase(), s]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const images = new Map<string, string>();
  const categories = new Map<string, string>();
  for (const i of items) {
    const s = byName.get((i.name || '').trim().toLowerCase());
    const img = itemImageData(i.image || s?.image, assetsRaw);
    if (img) images.set(i.id, img);
    const g = groupName.get(i.group_id || s?.group_id || '');
    if (g) categories.set(i.id, g);
  }
  return { images, categories };
}

export async function exportCatalogueHtml(opts: { cart: boolean; stock?: Map<string, number>; currency?: { code: string; rate: number } }): Promise<string> {
  const p = localDb.settings.activeProfile();
  const items = localDb.items.getAll();
  const { images, categories } = catalogueMaps(
    items,
    getTable<StockRef>('stock_items'),
    getTable<{ id: string; name: string }>('stock_groups'),
    readRaw(DB_PREFIX + ASSET_TABLE),
  );
  return buildCatalogue(items, {
    business: p?.companyName || '',
    phone: p?.companyPhone,
    email: p?.companyEmail,
    address: p?.companyAddress,
    gstin: p?.companyGstin,
    stock: opts.stock,
    images,
    categories,
    cart: opts.cart,
    ...(opts.currency ? { currency: opts.currency } : {}),
  });
}
