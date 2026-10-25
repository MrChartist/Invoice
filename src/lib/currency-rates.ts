/**
 * Currency master with dated reference rates (8H, roadmap 8.125).
 *
 * Table `currency_rates` (backed up, synced, `master.edit`): rows `{ id, currency, date, rate, source }`
 * — ₹ per one unit of the currency on that day, typed by hand or imported from a CSV of RBI / FBIL
 * reference rates (downloaded by the user; the app makes no network call). A foreign-currency document
 * picks the latest rate dated on or before its own date (`rateOn`); the user can still type another.
 * Reference rates are a convenience — the rate for GST / customs is the one notified for that purpose;
 * verify with your CA.
 */
import { isoDay } from './dates';
import { requireAccess } from './access';
import { generateId, getTable, setTable } from './storage';

export const CURRENCY_RATES_TABLE = 'currency_rates';

export type RateSource = 'manual' | 'RBI' | 'FBIL' | 'import';

export interface CurrencyRate {
  id: string;
  currency: string;
  /** YYYY-MM-DD (local day). */
  date: string;
  /** ₹ per 1 unit. */
  rate: number;
  source: RateSource;
}

const CODE = /^[A-Z]{3}$/;

export function loadRates(): CurrencyRate[] {
  return getTable<CurrencyRate>(CURRENCY_RATES_TABLE).filter((r) => r && CODE.test(r.currency) && !!isoDay(r.date) && Number(r.rate) > 0);
}

/** The latest rate for `currency` dated on or before `date`, or null. Pure over `rows`. */
export function rateOn(rows: readonly CurrencyRate[], currency: string, date: string): CurrencyRate | null {
  const cur = (currency || '').toUpperCase();
  let best: CurrencyRate | null = null;
  for (const r of rows) {
    if (r.currency !== cur || r.date > date) continue;
    if (!best || r.date > best.date) best = r;
  }
  return best;
}

/** Add or replace rates (one per currency and day; a newer entry for the same day wins). */
export function mergeRates(existing: readonly CurrencyRate[], incoming: readonly Omit<CurrencyRate, 'id'>[]): CurrencyRate[] {
  const map = new Map(existing.map((r) => [`${r.currency}|${r.date}`, r]));
  for (const r of incoming) {
    const key = `${r.currency}|${r.date}`;
    map.set(key, { ...r, id: map.get(key)?.id ?? generateId() });
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.date.localeCompare(b.date));
}

function parseDay(raw: string): string {
  const s = raw.trim();
  const iso = isoDay(s);
  if (iso) return iso;
  // RBI / FBIL CSVs print dd-mm-yyyy, dd/mm/yyyy or dd-Mon-yyyy.
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const m = /^(\d{1,2})[-/ ]([A-Za-z]{3}|\d{1,2})[-/ ](\d{4})$/.exec(s);
  if (!m) return '';
  const mon = /\d/.test(m[2]) ? Number(m[2]) : MON.indexOf(m[2].toLowerCase()) + 1;
  if (!(mon >= 1 && mon <= 12)) return '';
  return isoDay(`${m[3]}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}`) || '';
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Currency code from a header like "USD", "INR / 1 USD", "1 EUR" or "US Dollar (USD)". */
function codeOf(header: string): string {
  const m = /\b([A-Z]{3})\b/.exec(header.toUpperCase().replace(/\bINR\b/g, ''));
  return m ? m[1] : '';
}

/**
 * Parse a reference-rate CSV. Two shapes: wide (`Date, USD, GBP, EUR, JPY …`, one row per day, as
 * RBI / FBIL publish) or long (`Date, Currency, Rate`). Rates quoted per 100 units (JPY "100 JPY")
 * are divided by 100. Returns the rows and the lines it skipped.
 */
export function parseRatesCsv(text: string, source: RateSource = 'import'): { rows: Omit<CurrencyRate, 'id'>[]; skipped: number } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], skipped: 0 };
  const head = splitCsv(lines[0]);
  const lower = head.map((h) => h.toLowerCase());
  const di = lower.findIndex((h) => h.includes('date'));
  const ci = lower.findIndex((h) => h === 'currency' || h === 'code');
  const ri = lower.findIndex((h) => h === 'rate' || h.includes('reference rate'));
  const rows: Omit<CurrencyRate, 'id'>[] = [];
  let skipped = 0;
  const push = (currency: string, date: string, rateRaw: string, per100: boolean) => {
    const rate = Number(rateRaw.replace(/,/g, ''));
    if (!CODE.test(currency) || currency === 'INR' || !date || !(rate > 0)) return false;
    rows.push({ currency, date, rate: per100 ? Math.round((rate / 100) * 1e6) / 1e6 : rate, source });
    return true;
  };
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line);
    const date = parseDay(cells[di >= 0 ? di : 0] ?? '');
    if (ci >= 0 && ri >= 0) {
      if (!push((cells[ci] ?? '').toUpperCase(), date, cells[ri] ?? '', false)) skipped++;
      continue;
    }
    let any = false;
    head.forEach((h, i) => {
      if (i === (di >= 0 ? di : 0)) return;
      const code = codeOf(h);
      if (code && push(code, date, cells[i] ?? '', /\b100\b/.test(h))) any = true;
    });
    if (!any) skipped++;
  }
  return { rows, skipped };
}

/** Save rates (master.edit). */
export function saveRates(incoming: readonly Omit<CurrencyRate, 'id'>[]): number {
  requireAccess('master.edit');
  const next = mergeRates(loadRates(), incoming);
  setTable(CURRENCY_RATES_TABLE, next);
  return incoming.length;
}

export function deleteRate(id: string): void {
  requireAccess('master.edit');
  setTable(CURRENCY_RATES_TABLE, loadRates().filter((r) => r.id !== id));
}
