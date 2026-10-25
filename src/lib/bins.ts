/**
 * Bin / rack locations (8.86, BUSY / Marg "rack no."). An item's bin is its `location`; a batch may sit in
 * its own bin (`StockItem.batch_bins`, keyed by the batch number in upper case). Delivery challan lines
 * snapshot the bin when the item is picked (`InvoiceItem.bin`); pick lists read the live master
 * (`pick-list.ts`). Pure; tiny (loaded with the editor).
 */

interface BinItem { name: string; aliases?: string[]; location?: string; batch_bins?: Record<string, string> }

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** The stock item with this name (or alias). */
export function itemByName<T extends BinItem>(items: readonly T[], name: string): T | undefined {
  const n = norm(name);
  if (!n) return undefined;
  return items.find((i) => norm(i.name) === n) ?? items.find((i) => (i.aliases ?? []).some((a) => norm(a) === n));
}

/** Bin of a batch, else of the item ('' when none). */
export function binOf(item: Pick<BinItem, 'location' | 'batch_bins'> | undefined, batch?: string): string {
  if (!item) return '';
  const b = batch?.trim().toUpperCase();
  return (b && item.batch_bins?.[b]?.trim()) || item.location?.trim() || '';
}

export const binForName = (items: readonly BinItem[], name: string, batch?: string): string => binOf(itemByName(items, name), batch);

/** Item with one batch's bin set ('' clears it). Pure. */
export function withBatchBin<T extends BinItem>(item: T, batch: string, bin: string): T {
  const key = batch.trim().toUpperCase();
  if (!key) return item;
  const next = { ...(item.batch_bins ?? {}) };
  if (bin.trim()) next[key] = bin.trim();
  else delete next[key];
  const out = { ...item };
  if (Object.keys(next).length) out.batch_bins = next;
  else delete out.batch_bins;
  return out;
}
