/**
 * Day-end cash tally by denomination (WP-5, gap P2): count the notes and coins in the drawer, compare
 * with the Books cash balance at the end of the day (`books.accountBalanceAt(…, 'cash', date)`), and
 * keep one count per day in table `cash_tally`. For every business, not only POS (the POS day close,
 * `pos_day_close`, stays as it is). A count changes nothing in the books: post a shortage / excess as
 * a journal yourself after checking it. Pure above the "Storage" divider.
 */

import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { cashTotal, normalizeCounts, type DenominationCounts } from './denominations';
import { requireAccess } from './access';
import { generateId, getTable, setTable } from './storage';

export interface CashTally {
  id: string;
  /** YYYY-MM-DD, one count per day. */
  date: string;
  counts: DenominationCounts;
  counted: number;
  /** Books cash balance at the end of the day when counted. */
  expected: number;
  /** counted − expected: positive = excess, negative = shortage. */
  difference: number;
  note?: string;
  created_at: string;
  updated_at?: string;
}

export function tallyCash(counts: DenominationCounts, expected: number): { counted: number; difference: number; status: 'tallied' | 'excess' | 'short' } {
  const counted = cashTotal(counts);
  const difference = round2(counted - round2(num(expected)));
  return { counted, difference, status: Math.abs(difference) < 0.005 ? 'tallied' : difference > 0 ? 'excess' : 'short' };
}

/* ── Storage ──────────────────────────────────────────────────── */

export const CASH_TALLY_TABLE = 'cash_tally';

export function loadCashTallies(): CashTally[] {
  return getTable<CashTally>(CASH_TALLY_TABLE)
    .filter((t) => t && typeof t.id === 'string' && isoDay(t.date))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Save the count for `date` (replaces that day's earlier count). */
export function saveCashTally(input: { date: string; counts: DenominationCounts; expected: number; note?: string }): CashTally {
  requireAccess('books.edit');
  const date = isoDay(input.date);
  if (!date) throw new Error('Choose the date of the count.');
  const counts = normalizeCounts(input.counts);
  const t = tallyCash(counts, input.expected);
  const all = getTable<CashTally>(CASH_TALLY_TABLE);
  const prev = all.find((r) => r.date === date);
  const now = new Date().toISOString();
  const row: CashTally = {
    id: prev?.id ?? generateId(),
    date,
    counts,
    counted: t.counted,
    expected: round2(num(input.expected)),
    difference: t.difference,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    created_at: prev?.created_at ?? now,
    ...(prev ? { updated_at: now } : {}),
  };
  setTable(CASH_TALLY_TABLE, prev ? all.map((r) => (r.id === prev.id ? row : r)) : [...all, row]);
  return row;
}

export function deleteCashTally(id: string): void {
  requireAccess('books.edit');
  setTable(CASH_TALLY_TABLE, getTable<CashTally>(CASH_TALLY_TABLE).filter((r) => r.id !== id));
}
