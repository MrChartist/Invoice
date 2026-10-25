/**
 * Per-series high-water marks (data-integrity review, 2026-10).
 *
 * Voucher series that are numbered "highest existing + 1" (STR stock transfers, PO purchase orders,
 * ADV advance receipts, RFV advance refunds, RCPT payment receipts) would hand a deleted LATEST
 * number out again. Each save records the sequence it used here, and the next number is
 * `max(highest existing, high-water mark) + 1`, so a number is never issued twice.
 *
 * Table `series_counters` (backed up; rows `{ id: 'STR/FY26-27', seq }`). Writing it is a side
 * effect of an already-guarded save, so it is not role-gated itself (see access.ts).
 */
import { getIndianFY, highestSequence, buildInvoiceNumber } from './invoice-number';
import { getTable, setTable } from './storage';

export const SERIES_TABLE = 'series_counters';

export interface SeriesCounter {
  /** `<PREFIX>/FY<yy-yy>`, upper-case. */
  id: string;
  /** Highest sequence ever issued in that series and FY. */
  seq: number;
  updated_at?: string;
}

export const seriesKey = (prefix: string, fyLabel: string): string => `${prefix.trim().toUpperCase()}/FY${fyLabel}`;

/** Highest sequence ever recorded for the series (0 when none). */
export function seriesHigh(prefix: string, fyLabel: string): number {
  const key = seriesKey(prefix, fyLabel);
  const row = getTable<SeriesCounter>(SERIES_TABLE).find((r) => r?.id === key);
  const n = Math.floor(Number(row?.seq));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** `<PREFIX>/FY<yy-yy>/<seq>` parts of a number, or null for anything else. */
export function parseSeries(number: string | undefined | null): { prefix: string; fy: string; seq: number } | null {
  const m = /^(.+)\/FY(\d{2}-\d{2})\/(\d+)$/i.exec(String(number ?? '').trim());
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), fy: m[2], seq: parseInt(m[3], 10) };
}

/** Remember that `number` was issued (no-op when it is not above the mark or not in series form). */
export function recordSeries(number: string | undefined | null): void {
  const p = parseSeries(number);
  if (!p || !(p.seq > 0)) return;
  const key = seriesKey(p.prefix, p.fy);
  const rows = getTable<SeriesCounter>(SERIES_TABLE).filter((r) => r && typeof r.id === 'string');
  const row = rows.find((r) => r.id === key);
  if (row && num(row.seq) >= p.seq) return;
  const next: SeriesCounter = { id: key, seq: p.seq, updated_at: new Date().toISOString() };
  setTable(SERIES_TABLE, row ? rows.map((r) => (r.id === key ? next : r)) : [...rows, next]);
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Next number of a series for `date`: above every existing number AND the high-water mark. */
export function nextSeriesNumberFor(prefix: string, date: string | undefined, existing: readonly string[]): string {
  const fy = getIndianFY(date).label;
  const taken = new Set(existing.map((n) => String(n ?? '').trim().toUpperCase()));
  let seq = Math.max(highestSequence([...existing], prefix, fy), seriesHigh(prefix, fy)) + 1;
  while (taken.has(buildInvoiceNumber(prefix, fy, seq).toUpperCase())) seq++;
  return buildInvoiceNumber(prefix, fy, seq);
}

/** Does `number` belong to the Indian FY of `date`? (Non-series numbers always "fit".) */
export function numberFitsFy(number: string | undefined, date: string | undefined): boolean {
  const p = parseSeries(number);
  return !p || p.fy === getIndianFY(date).label;
}

/* ── Payment receipts (RCPT) ─────────────────────────────────── */

export const RECEIPT_PREFIX = 'RCPT';

type ReceiptRow = { date: string; advance_id?: string; receipt_number?: string };

/**
 * Number to stamp on a payment recorded on `date`: one above the highest stamped receipt of that FY,
 * the count of older unstamped receipts (whose numbers are still derived by position, so they keep
 * 1..n) and the high-water mark. Never reused or re-derived once stamped.
 */
export function nextReceiptNumber(date: string, rows: readonly ReceiptRow[]): string {
  const fy = getIndianFY(date).label;
  let stamped = 0;
  let legacy = 0;
  for (const r of rows) {
    if (r.advance_id || getIndianFY(r.date).label !== fy) continue;
    const p = parseSeries(r.receipt_number);
    if (p && p.prefix === RECEIPT_PREFIX && p.fy === fy) stamped = Math.max(stamped, p.seq);
    else if (!r.receipt_number) legacy++;
  }
  return buildInvoiceNumber(RECEIPT_PREFIX, fy, Math.max(stamped, legacy, seriesHigh(RECEIPT_PREFIX, fy)) + 1);
}
