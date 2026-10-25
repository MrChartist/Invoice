/**
 * Numbering of user voucher types (P1-13, `docs/features/voucher-types.md`). Tiny on purpose: the
 * document save path (`localDb`) imports it, so it ships with first paint. The master itself
 * (create / alter / delete, validation) lives in the lazy `voucher-types.ts`.
 *
 * A document or voucher WITHOUT `voucher_type_id` keeps the built-in Indian-FY series unchanged
 * (`INV/FY25-26/0001`, Critical Rule 4). A user type numbers `<prefix>/FY<yy-yy>/<seq><suffix>`:
 *   - yearly restart (default): one series per Indian FY;
 *   - monthly restart: the month joins the prefix (`RET-04/FY26-27/0001`), so every month restarts at 1
 *     and the number still reads as an ordinary FY series (gap report, duplicate check);
 *   - the next number is above every number already used, the starting number and the high-water mark
 *     in `series_counters` (a deleted latest number is never issued again).
 */
import { getIndianFY } from './invoice-number';
import { parseDay } from './dates';
import { getTable, setTable } from './storage';
import { SERIES_TABLE, seriesHigh, seriesKey, type SeriesCounter } from './series-counters';

export const VOUCHER_TYPES_TABLE = 'voucher_types';

/** Tally base voucher types we number ourselves (purchase bills keep the supplier's number). */
export type VoucherBase = 'SALES' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'RECEIPT' | 'PAYMENT' | 'CONTRA' | 'JOURNAL';

export interface VoucherSeries {
  id: string;
  base: VoucherBase;
  /** Upper-case letters, digits and hyphens. */
  prefix: string;
  /** Appended after the sequence (letters, digits, hyphens), e.g. `-EXP`. */
  suffix?: string;
  /** First sequence of every new series (default 1). */
  start_number?: number;
  /** Digits of the sequence (default 4). */
  width?: number;
  restart?: 'yearly' | 'monthly';
  inactive?: boolean;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The base a document type belongs to (only these types can take a user voucher type). */
export function baseOfDoc(docType: string | undefined): VoucherBase | undefined {
  if (docType === 'INVOICE' || docType === 'TAX_INVOICE') return 'SALES';
  if (docType === 'CREDIT_NOTE' || docType === 'DEBIT_NOTE') return docType;
  return undefined;
}

/** Series prefix for `date`: the type's prefix, plus `-MM` (calendar month) when it restarts monthly. */
export function seriesPrefix(s: Pick<VoucherSeries, 'prefix' | 'restart'>, date?: string): string {
  if (s.restart !== 'monthly') return s.prefix;
  const d = parseDay(date || new Date());
  const m = Number.isNaN(d.getTime()) ? new Date().getMonth() : d.getMonth();
  return `${s.prefix}-${String(m + 1).padStart(2, '0')}`;
}

/** Counter key prefix (suffix included, so `INV…-E` and `INV…` keep separate marks). */
const counterPrefix = (s: VoucherSeries, date?: string) => seriesPrefix(s, date) + (s.suffix ? `~${s.suffix}` : '');

/** The next number of a user type for `date`, above `existing` numbers, its start and its high-water mark. */
export function typedNumber(s: VoucherSeries, date: string | undefined, existing: readonly string[], high = seriesHigh(counterPrefix(s, date), getIndianFY(date).label)): string {
  const fy = getIndianFY(date).label;
  const pre = seriesPrefix(s, date);
  const suf = s.suffix ?? '';
  const width = Math.min(Math.max(Math.floor(Number(s.width) || 4), 1), 9);
  const re = new RegExp(`^${esc(pre)}/FY${esc(fy)}/(\\d+)${esc(suf)}$`, 'i');
  let max = Math.max(Math.floor(Number(s.start_number) || 1) - 1, high, 0);
  const taken = new Set<string>();
  for (const raw of existing) {
    const n = String(raw ?? '').trim();
    taken.add(n.toUpperCase());
    const m = re.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  let seq = max + 1;
  const build = () => `${pre}/FY${fy}/${String(seq).padStart(width, '0')}${suf}`;
  while (taken.has(build().toUpperCase())) seq++;
  return build();
}

/** The active user type `id` when it may number `docType` (else undefined → built-in series). */
export function seriesTypeFor(id: string | undefined, base: VoucherBase | undefined): VoucherSeries | undefined {
  if (!id || !base) return undefined;
  return getTable<VoucherSeries>(VOUCHER_TYPES_TABLE).find((t) => t && t.id === id && t.base === base && !t.inactive && !!t.prefix);
}

/** Remember that `number` was issued under type `s` (no-op when it is not in the type's shape). */
export function recordTypedNumber(s: VoucherSeries, date: string | undefined, number: string | undefined): void {
  const fy = getIndianFY(date).label;
  const m = new RegExp(`^${esc(seriesPrefix(s, date))}/FY${esc(fy)}/(\\d+)${esc(s.suffix ?? '')}$`, 'i').exec(String(number ?? '').trim());
  if (!m) return;
  const seq = parseInt(m[1], 10);
  const key = seriesKey(counterPrefix(s, date), fy);
  const rows = getTable<SeriesCounter>(SERIES_TABLE).filter((r) => r && typeof r.id === 'string');
  const row = rows.find((r) => r.id === key);
  if (row && Number(row.seq) >= seq) return;
  const next: SeriesCounter = { id: key, seq, updated_at: new Date().toISOString() };
  setTable(SERIES_TABLE, row ? rows.map((r) => (r.id === key ? next : r)) : [...rows, next]);
}
