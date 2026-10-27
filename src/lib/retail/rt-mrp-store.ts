/**
 * RT-A2 writers and readers on live data: the GST-cut MRP basis of an item (`mrp_tax_basis` on the stock item and its
 * catalogue row), the label-print stamp (`label_printed_at` + the price the label showed) and the relabel queue.
 * Masters: `master.edit`. Lazy (Inventory, the label sheet).
 */
import { KEYS, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { TABLES, type StockItem } from '../inventory';
import { loadHsnMaster, findHsn } from '../hsn-master';
import type { InvoiceItem } from '../../types/invoice';
import type { MrpTaxBasis } from '../../types/retail-r9';
import { basisFromRates, labelPriceNow, relabelDue } from './rt-mrp';

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** One row of the relabel queue: the label-sheet key (`<catalogue id>` or `stock-<id>`) and the item's name. */
export interface RelabelRow {
  key: string;
  name: string;
  rate: number;
  mrp: number;
}

/** Items whose shelf label shows an old price (catalogue rows, and stock items not in the catalogue). */
export function relabelQueue(): RelabelRow[] {
  const cat = getTable<InvoiceItem>(KEYS.items);
  const names = new Set(cat.map((i) => norm(i.name)));
  const stock = getTable<StockItem>(TABLES.items).filter((s) => !names.has(norm(s.name)));
  return [
    ...relabelDue(cat).map((i) => ({ key: i.id, name: i.name, ...labelPriceNow(i) })),
    ...relabelDue(stock).map((s) => ({ key: `stock-${s.id}`, name: s.name, ...labelPriceNow(s) })),
  ];
}

/** Stamp the label print on the printed rows (keys as the label sheet uses them). Never blocks printing. */
export function stampLabelsPrinted(keys: readonly string[], at = new Date().toISOString()): number {
  const want = new Set(keys);
  let n = 0;
  try {
    const cat = getTable<InvoiceItem>(KEYS.items);
    if (cat.some((i) => want.has(i.id))) {
      setTable(KEYS.items, cat.map((i) => (want.has(i.id) ? (n++, { ...i, label_printed_at: at, label_price: labelPriceNow(i) }) : i)));
    }
    const stock = getTable<StockItem>(TABLES.items);
    if (stock.some((s) => want.has(`stock-${s.id}`))) {
      setTable(TABLES.items, stock.map((s) => (want.has(`stock-${s.id}`) ? (n++, { ...s, label_printed_at: at, label_price: labelPriceNow(s) }) : s)));
    }
  } catch {
    /* a viewer may print labels; the stamp is a convenience */
  }
  return n;
}

/** The basis the HSN master suggests for an item (old rate, received up to the day before the cut), if the rate fell. */
export function suggestedBasis(hsn: string | undefined, day: string): MrpTaxBasis | undefined {
  const row = hsn ? findHsn(loadHsnMaster(), hsn) : undefined;
  return row ? basisFromRates(row.rates, day) : undefined;
}

/**
 * Mark (or clear, `basis` undefined) the MRP of an item as printed for an older GST rate: the stock item and its
 * catalogue row with the same name both carry it. Returns how many rows changed.
 */
export function setMrpBasis(name: string, basis: MrpTaxBasis | undefined): number {
  requireAccess('master.edit');
  const key = norm(name);
  if (!key) return 0;
  if (basis && !(basis.rate > 0 && basis.rate <= 100)) throw new Error('Enter the old GST rate.');
  const apply = <T extends { name: string; mrp_tax_basis?: MrpTaxBasis }>(row: T): T => {
    const next = { ...row };
    if (basis) next.mrp_tax_basis = { rate: basis.rate, ...(basis.until ? { until: basis.until } : {}) };
    else delete next.mrp_tax_basis;
    return next;
  };
  let n = 0;
  const stock = getTable<StockItem>(TABLES.items);
  if (stock.some((s) => norm(s.name) === key)) {
    setTable(TABLES.items, stock.map((s) => (norm(s.name) === key ? (n++, apply(s)) : s)));
  }
  const cat = getTable<InvoiceItem>(KEYS.items);
  if (cat.some((i) => norm(i.name) === key)) {
    setTable(KEYS.items, cat.map((i) => (norm(i.name) === key ? (n++, apply(i)) : i)));
  }
  return n;
}
