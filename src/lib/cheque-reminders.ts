/**
 * Post-dated cheque (PDC) reminders for the notification bell (roadmap 6.26).
 *
 * Kept tiny and dependency-light on purpose: the notification centre loads early, so this file
 * only knows the cheque shape and date arithmetic. Pure — the bell passes the `cheques` table in.
 *
 *  - received, not yet deposited, dated today or earlier   → "ready to deposit" (warning)
 *  - received, not yet deposited, dated within 3 days       → "due soon" (info)
 *  - received, validity (3 months from the cheque date, RBI) ends within 7 days or has ended
 *                                                           → "about to expire / expired" (critical)
 *  - issued, not yet cleared, dated within 3 days or earlier → "keep funds in the bank" (warning)
 */

import type { Cheque } from '../types/cheques';

export const PDC_SOON_DAYS = 3;
export const STALE_WARN_DAYS = 7;
/** RBI: cheques are payable for three months from their date. */
export const CHEQUE_VALIDITY_MONTHS = 3;

const DAY = 86400000;
const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days from a to b (YYYY-MM-DD, positive when b is later). */
export function chequeDayDiff(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY);
}

function iso(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Last day a cheque dated `date` can be presented: three months on, less a day (month-end clamped). */
export function validUntil(date: string): string {
  if (!ISO.test(date)) return '';
  const y = +date.slice(0, 4);
  const m = +date.slice(5, 7) - 1 + CHEQUE_VALIDITY_MONTHS;
  const d = +date.slice(8, 10);
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(Date.UTC(y, m, Math.min(d, lastDay)) - DAY);
}

export const isPostDated = (c: Pick<Cheque, 'cheque_date'>, today: string): boolean => ISO.test(c.cheque_date) && c.cheque_date > today;

export type PdcKind = 'deposit-now' | 'deposit-soon' | 'stale' | 'issued-due';

export interface PdcReminder {
  kind: PdcKind;
  cheques: Cheque[];
  total: number;
}

/** Group the cheques that need attention on `today` (YYYY-MM-DD). */
export function pdcReminders(cheques: readonly Cheque[], today: string): PdcReminder[] {
  const buckets: Record<PdcKind, Cheque[]> = { 'deposit-now': [], 'deposit-soon': [], stale: [], 'issued-due': [] };
  for (const c of cheques) {
    if (!c || !ISO.test(c.cheque_date ?? '')) continue;
    const days = chequeDayDiff(today, c.cheque_date);
    if (c.direction === 'received' && c.status === 'received') {
      const left = chequeDayDiff(today, validUntil(c.cheque_date));
      if (left <= STALE_WARN_DAYS) buckets.stale.push(c);
      else if (days <= 0) buckets['deposit-now'].push(c);
      else if (days <= PDC_SOON_DAYS) buckets['deposit-soon'].push(c);
    } else if (c.direction === 'issued' && (c.status === 'issued' || c.status === 'presented')) {
      if (days <= PDC_SOON_DAYS && c.status === 'issued') buckets['issued-due'].push(c);
    }
  }
  const out: PdcReminder[] = [];
  for (const kind of ['stale', 'deposit-now', 'deposit-soon', 'issued-due'] as PdcKind[]) {
    const list = buckets[kind].sort((a, b) => a.cheque_date.localeCompare(b.cheque_date) || a.number.localeCompare(b.number));
    if (!list.length) continue;
    const total = Math.round(list.reduce((s, c) => s + (Number(c.amount) || 0), 0) * 100) / 100;
    out.push({ kind, cheques: list, total });
  }
  return out;
}
