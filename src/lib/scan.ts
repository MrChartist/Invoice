/**
 * Scanning (roadmap 6.7): find an item by a scanned / typed code and add it to a list of lines.
 *
 * USB and Bluetooth scanners act as a keyboard ("keyboard wedge"): they type the code and press
 * Enter into whatever field has focus. The camera path (BarcodeDetector) ends in the same
 * `findByCode` + `addScannedLine`. Pure: no DOM, no storage.
 */

import type { InvoiceItem } from '../types/invoice';
import type { StockItem } from './inventory';
import { num, round2 } from './invoice-calc';

/** Trim and drop control characters / inner whitespace a scanner may add (CR, LF, TAB, GS). */
export function normalizeCode(raw: string): string {
  let out = '';
  for (const ch of String(raw ?? '')) {
    const c = ch.charCodeAt(0);
    if (c > 32 && c !== 127) out += ch;
  }
  return out;
}

/** Comparison key: case-insensitive, and leading zeros ignored on all-digit codes (UPC-A ≡ EAN-13 "0…"). */
export function codeKey(raw: string | undefined): string {
  const c = normalizeCode(raw ?? '').toUpperCase();
  if (/^\d+$/.test(c)) return c.replace(/^0+(?=\d)/, '');
  return c;
}

export interface CodeMatch {
  /** The catalogue row (or a catalogue-shaped copy of a stock item that is not in the catalogue). */
  item: InvoiceItem;
  /** Which field matched. */
  via: 'barcode' | 'sku';
  /** The stock item it also matches, when stock is tracked. */
  stock?: StockItem;
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Item for a code: catalogue barcode, then catalogue SKU, then a stock item's barcode / SKU
 * (mapped back to the catalogue row of the same name when there is one). Null when nothing matches.
 */
export function findByCode(raw: string, catalog: readonly InvoiceItem[], stock: readonly StockItem[] = []): CodeMatch | null {
  const key = codeKey(raw);
  if (!key) return null;
  const stockByName = (name: string) => stock.find((s) => norm(s.name) === norm(name));
  for (const via of ['barcode', 'sku'] as const) {
    const hit = catalog.find((i) => codeKey(i[via]) === key);
    if (hit) return { item: hit, via, stock: stockByName(hit.name) };
  }
  for (const via of ['barcode', 'sku'] as const) {
    const s = stock.find((x) => codeKey(x[via]) === key);
    if (!s) continue;
    const cat = catalog.find((i) => norm(i.name) === norm(s.name));
    const item: InvoiceItem = cat ?? {
      id: s.id,
      name: s.name,
      type: 'Product',
      hsn: s.hsn ?? '',
      unit: s.unit || 'NOS',
      quantity: 1,
      rate: num(s.sale_rate),
      ...(typeof s.tax_rate === 'number' ? { tax_rate: s.tax_rate } : {}),
      amount: 0,
    };
    return { item, via, stock: s };
  }
  return null;
}

const blank = (i: InvoiceItem) => !i.name.trim() && !(num(i.rate) > 0);

export interface ScanResult {
  items: InvoiceItem[];
  /** The line that received the scan. */
  lineId: string;
  /** True when an existing line's quantity went up instead of a new line being added. */
  incremented: boolean;
}

/**
 * Add one unit (or `qty`) of `source` to `items`: an existing paid line of the same item (same
 * name; HSN must agree when both have one) gets its quantity raised; otherwise a new line takes
 * the catalogue's name / HSN / unit / rate / GST, filling an empty trailing line if there is one.
 * Free scheme lines and serial-tracked lines with serials already picked are never merged into.
 */
export function addScannedLine(
  items: readonly InvoiceItem[],
  source: InvoiceItem,
  opts: { newId: () => string; qty?: number; fallbackTaxRate?: number },
): ScanResult {
  const qty = num(opts.qty, 1) || 1;
  const sameItem = (l: InvoiceItem) =>
    !l.free_of &&
    norm(l.name) === norm(source.name) &&
    (!l.hsn || !source.hsn || l.hsn === source.hsn) &&
    !(l.serials && l.serials.length);
  const idx = items.findIndex(sameItem);
  if (idx >= 0) {
    const line = items[idx];
    const quantity = round2(num(line.quantity) + qty);
    const next = { ...line, quantity, amount: round2(quantity * num(line.rate)) };
    return { items: items.map((l, n) => (n === idx ? next : l)), lineId: line.id, incremented: true };
  }
  const rate = round2(num(source.rate));
  const line: InvoiceItem = {
    id: opts.newId(),
    name: source.name,
    description: '',
    type: source.type || 'Product',
    hsn: source.hsn ?? '',
    unit: source.unit || 'NOS',
    quantity: qty,
    rate,
    tax_rate: typeof source.tax_rate === 'number' ? source.tax_rate : num(opts.fallbackTaxRate),
    discount_percent: 0,
    amount: round2(qty * rate),
    ...(num(source.cess_rate) > 0 ? { cess_rate: num(source.cess_rate) } : {}),
    ...(num(source.cess_per_unit) > 0 ? { cess_per_unit: num(source.cess_per_unit) } : {}),
  };
  const last = items[items.length - 1];
  if (last && blank(last)) return { items: [...items.slice(0, -1), line], lineId: line.id, incremented: false };
  return { items: [...items, line], lineId: line.id, incremented: false };
}
