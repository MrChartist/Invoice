/**
 * R14 PS-C4: rate cards in a foreign currency. A card's rate (task, staff, project, client, work type, engagement) may
 * carry `ps.currency` (absent = INR). Billing into another currency converts through the currency master's rate on the
 * bill date (`rateOn`, ₹ per unit), and the line carries the converted rate as today — nothing new is snapshotted. The
 * Rule 34(2) note (services: the GAAP rate on the date of time of supply — PS7) is shown on foreign-currency service
 * documents; the user may type the bank's rate instead. Year-end memo: unbilled foreign-currency WIP at the closing rate
 * (PS37). Pure. Working paper — verify with your CA.
 */
import { rateOn, type CurrencyRate } from '../currency-rates';
import { round2 } from '../invoice-calc';

/** Card currency (upper-case ISO code), INR when absent. */
export const cardCurrency = (card: { ps?: { currency?: string } } | null | undefined): string =>
  (/^[A-Za-z]{3}$/.test(String(card?.ps?.currency ?? '')) ? String(card!.ps!.currency) : 'INR').toUpperCase();

/** ₹ per unit of `currency` on `date` from the master (1 for INR), with the reference day; null when missing. */
export function inrPerUnit(currency: string, date: string, rows: readonly CurrencyRate[]): { rate: number; date: string } | null {
  if (currency.toUpperCase() === 'INR') return { rate: 1, date };
  const r = rateOn(rows, currency, date);
  return r ? { rate: r.rate, date: r.date } : null;
}

export interface Converted {
  /** Rate in the invoice currency (4 decimals for a foreign target, 2 for INR). */
  rate: number;
  from: string;
  to: string;
  /** ₹ value of one unit of the card rate (for the "≈ ₹4,620/h" hint). */
  inr?: number;
  /** Master day used for the card currency. */
  refDate?: string;
  /** No master rate for one of the currencies: the rate is left as typed. */
  missing?: boolean;
}

/** Convert a card rate into the invoice currency on the bill date. */
export function convertRate(rate: number, from: string, to: string, date: string, rows: readonly CurrencyRate[]): Converted {
  const f = from.toUpperCase(), t = to.toUpperCase();
  if (f === t) return { rate, from: f, to: t };
  const a = inrPerUnit(f, date, rows), b = inrPerUnit(t, date, rows);
  if (!a || !b) return { rate, from: f, to: t, missing: true };
  const inr = round2(rate * a.rate);
  return { rate: t === 'INR' ? inr : Math.round((rate * a.rate * 10000) / b.rate) / 10000, from: f, to: t, inr, refDate: f === 'INR' ? b.date : a.date };
}

/** Year-end memo (PS37): a foreign-currency WIP amount at the closing rate, null when the master has none. */
export function atClosing(amount: number, currency: string, yearEnd: string, rows: readonly CurrencyRate[]): number | null {
  const r = inrPerUnit(currency, yearEnd, rows);
  return r ? round2(amount * r.rate) : null;
}
