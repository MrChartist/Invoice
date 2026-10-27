/**
 * RT-B1 refill reminders (table `rx_refills`, `doc.create`, audited "Refill schedule", dated `next_due`).
 * A refill is made from a bill's lines (*Make refill*): the patient, the items and quantities, every N days and the next
 * due day. The Pharmacy desk lists rows due within `window` days (default 3) and overdue, with a `wa.me` message (the
 * user taps it; nothing is sent) and *Bill now* (a held POS cart). Billing the same items again for the same customer
 * moves the next due day forward (`advanceRefill`, derived from the bills — no save hook). Pure above "Storage".
 */
import './rt-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { RxRefill } from '../../types/retail-r9';
import { num } from '../invoice-calc';
import { isRevenueDoc } from '../stats';
import { plusDays } from '../pharma-gate';
import { requireAccess } from '../access';
import { generateId, getTable, setTable } from '../storage';
import { RT_TABLES } from './rt-shared';

export const REFILLS_TABLE = RT_TABLES.rxRefills;
export const REFILL_WINDOW_DAYS = 3;
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '').slice(-10);
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/* ── Pure ── */

/** A refill from a bill: the chosen lines (all with a quantity when `lineIds` is empty), due `every` days after it. */
export function refillFromBill(inv: InvoiceRecord, every: number, lineIds: readonly string[] = [], now = new Date().toISOString()): RxRefill {
  const days = Math.round(num(every));
  if (!(days >= 1 && days <= 365)) throw new Error('Refill every 1 to 365 days.');
  const lines = (inv.items ?? []).filter((l) => num(l.quantity) > 0 && l.name.trim() && (!lineIds.length || lineIds.includes(l.id)));
  if (!lines.length) throw new Error('Pick at least one medicine.');
  const name = inv.rx?.patient?.trim() || inv.client?.name?.trim() || '';
  if (!name) throw new Error('The bill has no customer or patient name.');
  return {
    id: generateId(),
    ...(inv.client?.id ? { client_id: inv.client.id } : {}),
    name,
    ...(inv.client?.phone?.trim() ? { phone: inv.client.phone.trim() } : {}),
    items: lines.map((l) => ({ name: l.name, quantity: num(l.quantity), ...(l.unit ? { unit: l.unit } : {}) })),
    every_days: days,
    next_due: plusDays(inv.issue_date, days),
    invoice_id: inv.id,
    ...(inv.rx?.doctor_id ? { doctor_id: inv.rx.doctor_id } : {}),
    active: true,
    created_at: now,
  };
}

/** Active rows due on or before `day + window` (overdue first), with days left (negative = overdue). */
export function dueRefills(rows: readonly RxRefill[], day: string, window = REFILL_WINDOW_DAYS): { refill: RxRefill; daysLeft: number }[] {
  const limit = plusDays(day, Math.max(window, 0));
  const diff = (a: string, b: string) => Math.round((new Date(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)).getTime() - new Date(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)).getTime()) / 86400000);
  return rows
    .filter((r) => r.active && isDay(r.next_due) && r.next_due <= limit)
    .map((r) => ({ refill: r, daysLeft: diff(day, r.next_due) }))
    .sort((a, b) => a.refill.next_due.localeCompare(b.refill.next_due) || a.refill.name.localeCompare(b.refill.name));
}

/** True when `inv` (a live sale) is this refill being bought again: same customer (id or phone) and one of its items. */
export function isRefillBill(r: RxRefill, inv: InvoiceRecord): boolean {
  if (!isRevenueDoc(inv) || inv.id === r.invoice_id) return false;
  const same = (r.client_id && inv.client?.id === r.client_id) || (!!digits(r.phone) && digits(inv.client?.phone) === digits(r.phone)) || (!r.client_id && !digits(r.phone) && norm(inv.rx?.patient || inv.client?.name) === norm(r.name));
  if (!same) return false;
  const names = new Set(r.items.map((i) => norm(i.name)));
  return (inv.items ?? []).some((l) => names.has(norm(l.name)) && num(l.quantity) > 0);
}

/**
 * The refill after the bills: the latest refill bill dated after the previous one (and no earlier than `every_days`
 * before the due day, so an old bill never counts) moves `next_due` to that day + every N days. Same row back = no change.
 */
export function advanceRefill(r: RxRefill, invoices: readonly InvoiceRecord[]): RxRefill {
  const after = r.last_billed ?? (isDay(r.next_due) ? plusDays(r.next_due, -r.every_days) : '');
  let last = '';
  for (const inv of invoices) {
    const d = String(inv?.issue_date ?? '');
    if (isDay(d) && d > after && d > last && isRefillBill(r, inv)) last = d;
  }
  if (!last) return r;
  return { ...r, last_billed: last, next_due: plusDays(last, r.every_days) };
}

/** `wa.me` link with the reminder ('' without a 10-digit phone). */
export function refillWaLink(r: RxRefill, message: string): string {
  const p = digits(r.phone);
  return p.length === 10 ? `https://wa.me/91${p}?text=${encodeURIComponent(message)}` : '';
}

/* ── Storage ── */

export const loadRefills = (): RxRefill[] => getTable<RxRefill>(REFILLS_TABLE).filter((r) => r && typeof r.id === 'string');

export function saveRefill(row: RxRefill): RxRefill {
  requireAccess('doc.create');
  if (!isDay(row.next_due)) throw new Error('Choose the next due date.');
  const all = loadRefills();
  const exists = all.some((r) => r.id === row.id);
  const next = exists ? { ...row, updated_at: new Date().toISOString() } : row;
  setTable(REFILLS_TABLE, exists ? all.map((r) => (r.id === row.id ? next : r)) : [...all, next]);
  return next;
}

/** Delete through the data layer (the recycle bin keeps a copy). */
export function removeRefill(id: string): void {
  requireAccess('doc.create');
  setTable(REFILLS_TABLE, loadRefills().filter((r) => r.id !== id));
}

/** Move refills forward for bills made since (writes only rows that changed); returns how many moved. */
export function syncRefills(invoices: readonly InvoiceRecord[]): number {
  const all = loadRefills();
  let moved = 0;
  const next = all.map((r) => {
    const a = r.active ? advanceRefill(r, invoices) : r;
    if (a !== r) moved += 1;
    return a;
  });
  if (moved) {
    requireAccess('doc.create');
    setTable(REFILLS_TABLE, next);
  }
  return moved;
}
