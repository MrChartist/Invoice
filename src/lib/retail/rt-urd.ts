/**
 * RT-A: the `URD/FY<yy-yy>/<seq>` series — our own number on a purchase voucher for goods bought from an unregistered
 * person (an old phone taken in exchange, RT-D3; old gold, RT-E3). The voucher is an ordinary `purchases` row whose
 * `bill_number` carries this number. Numbers come from `series-counters.ts` (highest existing + 1, above the
 * high-water mark), so a deleted voucher's number is never issued again.
 */
import { KEYS, getTable, setTable } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { num, round2 } from '../invoice-calc';
import { localDb } from '../localDb';
import { purchasesDb } from '../purchases';
import type { Payment } from '../../types/invoice';
import { RT_SERIES } from './rt-shared';

export const URD_PREFIX = RT_SERIES.urd;

/** Every URD number already on a purchases row (live or not). */
export function urdNumbers(): string[] {
  return getTable<{ bill_number?: unknown }>('purchases')
    .map((p) => (typeof p?.bill_number === 'string' ? p.bill_number : ''))
    .filter((n) => n.toUpperCase().startsWith(`${URD_PREFIX}/`));
}

/** The next URD number for a voucher dated `date` (local day). Call `recordUrd` after the voucher is saved. */
export const nextUrdNumber = (date: string): string => nextSeriesNumberFor(URD_PREFIX, date, urdNumbers());

/** Remember a URD number as issued (deletes never hand it out again). */
export const recordUrd = (number: string): void => recordSeries(number);

/* ── RT-E3 (usable by RT-D3): settle a sale by the customer's URD voucher ──────────────────────────────────────── */

/** Exchange receipts (no cash moved) that settled each URD voucher, by purchase id. */
export function exchangeSettled(payments: readonly Payment[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of payments) if (p?.exchange_purchase_id) out.set(p.exchange_purchase_id, round2((out.get(p.exchange_purchase_id) ?? 0) + num(p.amount)));
  return out;
}

/**
 * Settle part of sale `invoiceId` with the URD voucher `purchaseId` (old gold / old device): a receipt row tagged
 * `exchange_purchase_id` (no cash moved — `movedNoCash`; books: Dr Sundry creditors — exchange / Cr the customer), and
 * the voucher is marked paid by that much. The sale invoice keeps its full value (GST on the full value, RT11 / RT17).
 */
export function settleByExchange(purchaseId: string, invoiceId: string, date: string, note: string, amount?: number): Payment {
  const bill = purchasesDb.get(purchaseId);
  if (!bill) throw new Error('Voucher not found.');
  const inv = localDb.invoices.getById(invoiceId);
  if (!inv) throw new Error('Bill not found.');
  const open = round2(num(bill.total) - num(bill.amount_paid));
  const amt = round2(Math.min(amount ?? open, open, num(inv.balance_due ?? inv.total)));
  if (!(amt > 0)) throw new Error('Nothing left to settle on this voucher or bill.');
  const row = localDb.payments.record({ invoiceId, amount: amt, method: 'Exchange', date, reference: bill.bill_number, note });
  setTable(KEYS.transactions, getTable<Payment>(KEYS.transactions).map((p) => (p.id === row.id ? { ...p, exchange_purchase_id: purchaseId } : p)));
  purchasesDb.save({ ...bill, amount_paid: round2(num(bill.amount_paid) + amt) });
  return { ...row, exchange_purchase_id: purchaseId };
}
