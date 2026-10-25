import { clsx, type ClassValue } from 'clsx';
import { parseDay } from './dates';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/* ── Currency ─────────────────────────────────────────────────── */

export interface CurrencyOption {
  code: string;
  symbol: string;
  label: string;
  locale: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: 'INR', symbol: '₹', label: 'Indian Rupee', locale: 'en-IN' },
  { code: 'USD', symbol: '$', label: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', symbol: '€', label: 'Euro', locale: 'de-DE' },
  { code: 'GBP', symbol: '£', label: 'Pound Sterling', locale: 'en-GB' },
  { code: 'AED', symbol: 'AED', label: 'UAE Dirham', locale: 'en-AE' },
  { code: 'SGD', symbol: 'S$', label: 'Singapore Dollar', locale: 'en-SG' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar', locale: 'en-AU' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar', locale: 'en-CA' },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen', locale: 'ja-JP' },
];

const CURRENCY_MAP = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currencySymbol(currency: string = 'INR'): string {
  return CURRENCY_MAP.get((currency || 'INR').toUpperCase())?.symbol ?? '';
}

// Building an Intl formatter costs ~0.1-0.5 ms; long tables call these thousands of times per render,
// so each distinct (locale, options) formatter is created once and reused.
const numberFormats: Record<string, Intl.NumberFormat> = {};
// Throws for an unknown ISO code before anything is cached.
const numberFormat = (locale: string, options: Intl.NumberFormatOptions) =>
  (numberFormats[locale + JSON.stringify(options)] ??= new Intl.NumberFormat(locale, options));
let dayFormat: Intl.DateTimeFormat | undefined;

/**
 * Money with symbol. INR keeps the Indian 2-2-3 grouping (12,34,567.50);
 * every other currency uses its own locale grouping.
 */
export function formatCurrency(amount: number, currency: string = 'INR') {
  const code = (currency || 'INR').toUpperCase();
  const option = CURRENCY_MAP.get(code);
  const value = Number.isFinite(amount) ? amount : 0;
  try {
    return numberFormat(option?.locale ?? 'en-IN', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Unknown ISO code — fall back to a plain grouped number.
    return `${option?.symbol ?? code} ${formatMoney(value)}`;
  }
}

/** Grouped number without a currency symbol — for tables, CSV and PDFs. */
export function formatMoney(amount: number, currency: string = 'INR') {
  const locale = CURRENCY_MAP.get((currency || 'INR').toUpperCase())?.locale ?? 'en-IN';
  return numberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

/** Quantities: no forced decimals, but keeps up to 3 when present. */
export function formatQuantity(value: number) {
  return numberFormat('en-IN', { maximumFractionDigits: 3 }).format(
    Number.isFinite(value) ? value : 0,
  );
}

/* ── Dates ────────────────────────────────────────────────────── */

/** "1 Apr 2026" — the day-first order used on Indian invoices. */
export function formatDate(date: string | Date) {
  if (!date) return '';
  const d = parseDay(date);
  if (Number.isNaN(d.getTime())) return '';
  // The cached formatter works in UTC on the local calendar day, so it is unaffected by a later
  // time-zone change (a formatter captures the zone at creation).
  dayFormat ??= new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return dayFormat.format(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** "2026-04-01" — the value format every <input type="date"> expects. */
export function toDateInput(date: string | Date = new Date()): string {
  const d = parseDay(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayInput(): string {
  return toDateInput(new Date());
}

export function addDaysInput(days: number, from: string | Date = new Date()): string {
  // Copy: parseDay hands back a caller-supplied Date as-is and we must not mutate it.
  const d = new Date(parseDay(from).getTime());
  if (Number.isNaN(d.getTime())) return todayInput();
  d.setDate(d.getDate() + days);
  return toDateInput(d);
}

/** Whole days a due date is past — 0 when it is today or in the future. */
export function daysOverdue(dueDate?: string, now: Date = new Date()): number {
  if (!dueDate) return 0;
  const due = parseDay(dueDate);
  if (Number.isNaN(due.getTime())) return 0;
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Round, not floor: a local day is 23h or 25h across a DST change.
  const diff = Math.round((startOfNow - startOfDue) / 86400000);
  return diff > 0 ? diff : 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
