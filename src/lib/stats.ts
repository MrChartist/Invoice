/**
 * Dashboard / ledger aggregates. Pure functions over invoice rows so they can
 * be unit-tested without a browser.
 */

import type { InvoiceRecord } from '../types/invoice';
import { round2 } from './invoice-calc';
import { effectiveStatus } from './invoice-status';
import { daysOverdue } from './utils';

/** Only real, issued tax documents count as revenue — not quotes, challans or drafts. */
export function isRevenueDoc(inv: Pick<InvoiceRecord, 'doc_type' | 'status'>): boolean {
  const type = inv.doc_type ?? 'INVOICE';
  if (type !== 'INVOICE' && type !== 'TAX_INVOICE') return false;
  return inv.status !== 'Draft' && inv.status !== 'Cancelled';
}

function outstandingOf(inv: InvoiceRecord): number {
  const balance =
    typeof inv.balance_due === 'number' ? inv.balance_due : (inv.total ?? 0) - (inv.amount_paid ?? 0);
  return Math.max(balance, 0);
}

export interface Summary {
  count: number;
  billed: number;
  received: number;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
}

export function summarize(invoices: InvoiceRecord[], now: Date = new Date()): Summary {
  const out: Summary = { count: 0, billed: 0, received: 0, outstanding: 0, overdueAmount: 0, overdueCount: 0 };
  for (const inv of invoices) {
    if (!isRevenueDoc(inv)) continue;
    out.count += 1;
    out.billed += inv.total ?? 0;
    out.received += Math.min(inv.amount_paid ?? 0, inv.total ?? 0);
    const due = outstandingOf(inv);
    out.outstanding += due;
    if (due > 0 && effectiveStatus(inv, now) === 'Overdue') {
      out.overdueAmount += due;
      out.overdueCount += 1;
    }
  }
  return {
    count: out.count,
    billed: round2(out.billed),
    received: round2(out.received),
    outstanding: round2(out.outstanding),
    overdueAmount: round2(out.overdueAmount),
    overdueCount: out.overdueCount,
  };
}

export interface MonthBucket {
  key: string;
  label: string;
  billed: number;
}

/** Billed amount per calendar month for the last `months` months, oldest first. */
export function monthlyBilled(invoices: InvoiceRecord[], months = 6, now: Date = new Date()): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-IN', { month: 'short' }),
      billed: 0,
    });
  }
  for (const inv of invoices) {
    if (!isRevenueDoc(inv) || !inv.issue_date) continue;
    const bucket = buckets.find((b) => inv.issue_date.startsWith(b.key));
    if (bucket) bucket.billed = round2(bucket.billed + (inv.total ?? 0));
  }
  return buckets;
}

/** Unpaid documents, most overdue first — the "needs attention" list. */
export function attentionList(invoices: InvoiceRecord[], limit = 5, now: Date = new Date()): InvoiceRecord[] {
  return invoices
    .filter((inv) => isRevenueDoc(inv) && outstandingOf(inv) > 0)
    .sort((a, b) => daysOverdue(b.due_date, now) - daysOverdue(a.due_date, now) || (a.due_date || '').localeCompare(b.due_date || ''))
    .slice(0, limit);
}

/** Compact INR for chart labels: 1.2L, 3.4Cr, 12k. */
export function compactInr(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1e7) return `${(amount / 1e7).toFixed(1).replace(/\.0$/, '')}Cr`;
  if (abs >= 1e5) return `${(amount / 1e5).toFixed(1).replace(/\.0$/, '')}L`;
  if (abs >= 1e3) return `${(amount / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(amount));
}
