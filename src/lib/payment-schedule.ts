/**
 * Deposits & payment schedules (8G, 8.100 — Zoho / FreshBooks "deposit", Xero "payment terms").
 *
 * A quote, proforma, sales order or invoice may carry `payment_schedule`: instalments, each a percent
 * of the total or a fixed amount, with its own due date. Money received settles instalments in due-date
 * order. Readers use ONE helper each so reminders, ageing and the cash forecast agree:
 *
 *   effectiveDueDate(inv)     earliest unpaid instalment's due date (else `due_date`) — reminders, ageing
 *   instalmentStatus(...)     each instalment's amount / paid / open                     — editor, print
 *   openInstalments(inv)      unpaid instalments with their open amounts                 — cash forecast
 *
 * Pure (no storage). Bare dates are local days (Critical Rule 8). Absent schedule = old behaviour.
 */

import type { InvoiceRecord, PaymentInstalment } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { receivableBalance, receivableTotal } from './rcm';

/** Amount of each instalment for `total`. All-percent schedules adding up to 100 give the last one the remainder. */
export function instalmentAmounts(schedule: readonly PaymentInstalment[], total: number): number[] {
  const amounts = schedule.map((i) => (i.percent ? round2((total * i.percent) / 100) : round2(num(i.amount))));
  const allPct = schedule.length > 0 && schedule.every((i) => i.percent);
  const pctSum = round2(schedule.reduce((s, i) => s + num(i.percent), 0));
  if (allPct && Math.abs(pctSum - 100) < 0.001) {
    const head = amounts.slice(0, -1).reduce((s, a) => s + a, 0);
    amounts[amounts.length - 1] = round2(total - head);
  }
  return amounts;
}

export interface InstalmentState {
  instalment: PaymentInstalment;
  amount: number;
  paid: number;
  open: number;
}

/** Received money settles instalments in due-date order (the schedule is kept sorted). */
export function instalmentStatus(schedule: readonly PaymentInstalment[], total: number, received: number): InstalmentState[] {
  const amounts = instalmentAmounts(schedule, total);
  let left = Math.max(round2(received), 0);
  return schedule.map((instalment, i) => {
    const amount = amounts[i];
    const paid = round2(Math.min(left, amount));
    left = round2(left - paid);
    return { instalment, amount, paid, open: round2(amount - paid) };
  });
}

type Scheduled = Pick<InvoiceRecord, 'payment_schedule' | 'due_date' | 'total' | 'balance_due' | 'amount_paid' | 'tds_amount'> & Partial<InvoiceRecord>;

function received(inv: Scheduled): number {
  const total = receivableTotal(inv as InvoiceRecord);
  return round2(total - Math.max(receivableBalance(inv as InvoiceRecord), 0));
}

/** Unpaid instalments (open > 0) of a document; empty when it has no schedule. */
export function openInstalments(inv: Scheduled): InstalmentState[] {
  const sched = inv.payment_schedule;
  if (!sched?.length) return [];
  return instalmentStatus(sched, receivableTotal(inv as InvoiceRecord), received(inv)).filter((s) => s.open > 0.004);
}

/**
 * The due date reminders and ageing should use: the earliest unpaid instalment, else `due_date`.
 * A fully paid schedule falls back to `due_date` (nothing is open anyway).
 */
export function effectiveDueDate(inv: Scheduled): string {
  const open = openInstalments(inv);
  return open.length ? open[0].instalment.due_date : (inv.due_date ?? '');
}
