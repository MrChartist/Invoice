/**
 * RT-A4 short book: items customers asked for that were not in stock (table `short_book`, `doc.create`, dated `date`).
 * The counter adds a row (stock item or free text, quantity, customer phone); Inventory → Short book lists the open
 * rows by item; *Make draft PO* raises one purchase order per supplier — the item's last supplier, read from the bills
 * through the purchases contract (`readPurchase` / `readPurchaseLines`, AGENTS rule 9); rows close when the item's
 * stock comes in (or by hand), and "Tell the customer" builds a `wa.me` link (the user taps it; nothing is sent).
 */
import './rt-registry';
import type { ShortBookEntry } from '../../types/retail-r9';
import type { PurchaseOrderLine } from '../../types/purchases';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { generateId, getTable, setTable } from '../storage';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';
import { RT_TABLES } from './rt-shared';

export const SHORT_BOOK_TABLE = RT_TABLES.shortBook;
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/* ── Pure ── */

export interface LastSupplier {
  vendorId?: string;
  vendorName: string;
  rate: number;
  hsn: string;
  taxRate: number;
  unit: string;
  date: string;
}

/** The last supplier of each item (by stock item id and by name) from live, non-expense bills. */
export function lastSuppliers(purchases: readonly unknown[]): Map<string, LastSupplier> {
  const out = new Map<string, LastSupplier>();
  for (const raw of purchases) {
    const b = readPurchase(raw);
    if (!b || b.isExpense || isVoidStatus(b.status)) continue;
    const vendorId = (raw as { vendor_id?: string }).vendor_id;
    for (const l of readPurchaseLines(raw)) {
      const row: LastSupplier = { ...(vendorId ? { vendorId } : {}), vendorName: b.partyName, rate: round2(l.netRate), hsn: l.hsn, taxRate: l.taxRate, unit: l.unit, date: b.date };
      for (const k of [l.itemId && `id:${l.itemId}`, l.name && `name:${norm(l.name)}`].filter(Boolean) as string[]) {
        const prev = out.get(k);
        if (!prev || prev.date <= b.date) out.set(k, row);
      }
    }
  }
  return out;
}

export const supplierOf = (map: ReadonlyMap<string, LastSupplier>, row: Pick<ShortBookEntry, 'item_id' | 'name'>): LastSupplier | undefined =>
  (row.item_id ? map.get(`id:${row.item_id}`) : undefined) ?? map.get(`name:${norm(row.name)}`);

/** Open rows grouped by supplier ('' = no supplier known), quantities summed per item. */
export function groupBySupplier(rows: readonly ShortBookEntry[], map: ReadonlyMap<string, LastSupplier>): Map<string, { supplier?: LastSupplier; rows: ShortBookEntry[] }> {
  const out = new Map<string, { supplier?: LastSupplier; rows: ShortBookEntry[] }>();
  for (const r of rows) {
    if (r.status !== 'open') continue;
    const s = supplierOf(map, r);
    const key = s ? s.vendorId || `name:${norm(s.vendorName)}` : '';
    const g = out.get(key) ?? { supplier: s, rows: [] };
    g.rows.push(r);
    out.set(key, g);
  }
  return out;
}

/** Rows to close because the item is in stock now (`stockOf` = base quantity on hand by stock item id / name). */
export function arrivedRows(rows: readonly ShortBookEntry[], stockOf: (row: ShortBookEntry) => number): ShortBookEntry[] {
  return rows.filter((r) => r.status !== 'closed' && stockOf(r) > 0);
}

/* ── Storage ── */

export const loadShortBook = (): ShortBookEntry[] => getTable<ShortBookEntry>(SHORT_BOOK_TABLE).filter((r) => r && typeof r.id === 'string');

export function addShortBook(input: { date: string; name: string; qty?: number; item_id?: string; unit?: string; customer?: string; phone?: string; note?: string }): ShortBookEntry {
  requireAccess('doc.create');
  const name = input.name.trim();
  if (!name) throw new Error('Type the item the customer asked for.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Choose the date.');
  const row: ShortBookEntry = {
    id: generateId(), date: input.date, name, qty: num(input.qty) > 0 ? num(input.qty) : 1, status: 'open',
    ...(input.item_id ? { item_id: input.item_id } : {}), ...(input.unit ? { unit: input.unit } : {}),
    ...(input.customer?.trim() ? { customer: input.customer.trim() } : {}), ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}), created_at: new Date().toISOString(),
  };
  setTable(SHORT_BOOK_TABLE, [...loadShortBook(), row]);
  return row;
}

/** Close rows (`arrived` when stock came in, `manual` by hand). Returns how many closed. */
export function closeShortBook(ids: readonly string[], how: 'arrived' | 'manual', day: string): number {
  requireAccess('doc.create');
  const want = new Set(ids);
  let n = 0;
  const now = new Date().toISOString();
  const rows = loadShortBook().map((r) => (want.has(r.id) && r.status !== 'closed' ? (n++, { ...r, status: 'closed' as const, closed_on: day, closed_how: how, updated_at: now }) : r));
  if (n) setTable(SHORT_BOOK_TABLE, rows);
  return n;
}

/**
 * Make one purchase order per supplier from the open rows (`ids`, or all open rows). Rows without a known supplier
 * go on one order to "Supplier to be chosen". The rows are marked `ordered` with the PO id.
 */
export async function makePurchaseOrders(day: string, ids?: readonly string[]): Promise<number> {
  requireAccess('books.edit');
  const all = loadShortBook();
  const pick = all.filter((r) => r.status === 'open' && (!ids || ids.includes(r.id)));
  if (!pick.length) throw new Error('No open rows to order.');
  const { purchaseOrdersDb } = await import('../purchase-orders');
  const { computePurchaseTotals } = await import('../purchases');
  const suppliers = lastSuppliers(getTable('purchases'));
  const groups = groupBySupplier(pick, suppliers);
  const poOf = new Map<string, string>();
  for (const g of groups.values()) {
    const byItem = new Map<string, PurchaseOrderLine>();
    for (const r of g.rows) {
      const s = supplierOf(suppliers, r);
      const key = r.item_id || norm(r.name);
      const prev = byItem.get(key);
      if (prev) prev.quantity = round2(prev.quantity + r.qty);
      else byItem.set(key, { id: generateId(), name: r.name, quantity: r.qty, rate: s?.rate ?? 0, tax_rate: s?.taxRate ?? 0, ...(s?.hsn ? { hsn: s.hsn } : {}), ...(r.unit || s?.unit ? { unit: r.unit || s?.unit } : {}), ...(r.item_id ? { item_id: r.item_id } : {}) });
    }
    const lines = [...byItem.values()];
    const t = computePurchaseTotals(lines.map((l) => ({ ...l, tax_rate: num(l.tax_rate) })));
    const po = purchaseOrdersDb.save({
      date: day, vendor_name: g.supplier?.vendorName || 'Supplier to be chosen', ...(g.supplier?.vendorId ? { vendor_id: g.supplier.vendorId } : {}),
      lines, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total, notes: 'From the short book (draft — check quantities and rates).',
    });
    for (const r of g.rows) poOf.set(r.id, po.id);
  }
  const now = new Date().toISOString();
  setTable(SHORT_BOOK_TABLE, all.map((r) => (poOf.has(r.id) ? { ...r, status: 'ordered' as const, po_id: poOf.get(r.id), updated_at: now } : r)));
  return groups.size;
}

/** The `wa.me` link telling a customer the item is back (undefined without a phone). */
export function backInStockLink(row: Pick<ShortBookEntry, 'phone' | 'name'>, message: string): string | undefined {
  const digits = String(row.phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return undefined;
  const to = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
}
