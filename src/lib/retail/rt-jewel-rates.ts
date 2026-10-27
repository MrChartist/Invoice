/**
 * RT-E1 metal rate board (table `metal_rates`, `master.edit`, dated `date`, audited "Metal rate"). Append-only per day:
 * a correction adds a newer row and the latest row of the day wins. A bill takes the rate of its OWN date — no rate that
 * day is an error (the owner may type a line rate; audited, RT-E2). Purities: gold by karat with its fineness, silver
 * and platinum by fineness. Weights in grams, 3 decimals. Working paper — verify with your CA.
 */
import './rt-registry';
import type { Metal, MetalRate } from '../../types/retail-r9';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { generateId, getTable, setTable } from '../storage';
import { RT_TABLES } from './rt-shared';
import { fineness, r3 } from './rt-jewel-text';

export const RATES_TABLE = RT_TABLES.metalRates;
export const METALS: readonly Metal[] = ['gold', 'silver', 'platinum'];

export { PURITIES, fineness, purityLabel, r3 } from './rt-jewel-text';

/** Fine weight (24K grams) of `net` grams at a purity. */
export const fineOf = (metal: Metal, purity: string, net: number): number => r3((num(net) * fineness(metal, purity)) / 1000);

export const loadRates = (): MetalRate[] => getTable<MetalRate>(RATES_TABLE).filter((r) => r && typeof r.date === 'string');

/** The day's board: latest row per metal + purity on exactly `date`. */
export function ratesOn(rates: readonly MetalRate[], date: string): Map<string, MetalRate> {
  const out = new Map<string, MetalRate>();
  for (const r of rates) if (r.date === date) {
    const k = `${r.metal}:${r.purity}`;
    const prev = out.get(k);
    if (!prev || prev.created_at <= r.created_at) out.set(k, r);
  }
  return out;
}

/** The rate a bill dated `date` uses (undefined = no rate that day: an error the owner may override). */
export const rateFor = (rates: readonly MetalRate[], metal: Metal, purity: string, date: string): MetalRate | undefined => ratesOn(rates, date).get(`${metal}:${purity}`);

/** Error text for a bill line with no rate on its date ('' when there is one). */
export const noRateError = (metal: Metal, purity: string, date: string): string => `No ${metal} ${purity} rate for ${date} — set today's rate on Jewellery → Rates (the owner may type a line rate).`;

/** Save the day's rates (append-only; only rows with a sale or buy rate). Returns the rows written. */
export function saveRates(date: string, rows: readonly { metal: Metal; purity: string; sale: number; buy: number }[]): MetalRate[] {
  requireAccess('master.edit');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose the date.');
  const on = ratesOn(loadRates(), date);
  const now = new Date().toISOString();
  const add = rows
    .filter((r) => fineness(r.metal, r.purity) && (num(r.sale) > 0 || num(r.buy) > 0))
    .filter((r) => { const p = on.get(`${r.metal}:${r.purity}`); return !p || p.sale !== round2(num(r.sale)) || p.buy !== round2(num(r.buy)); })
    .map((r) => ({ id: generateId(), date, metal: r.metal, purity: r.purity, sale: round2(Math.max(num(r.sale), 0)), buy: round2(Math.max(num(r.buy), 0)), created_at: now }));
  if (add.length) setTable(RATES_TABLE, [...loadRates(), ...add]);
  return add;
}

/** *Copy yesterday*: the latest earlier day's board, as rows to edit (not saved). */
export function lastBoard(rates: readonly MetalRate[], date: string): { metal: Metal; purity: string; sale: number; buy: number }[] {
  const day = rates.filter((r) => r.date < date).reduce((m, r) => (r.date > m ? r.date : m), '');
  return day ? [...ratesOn(rates, day).values()].map(({ metal, purity, sale, buy }) => ({ metal, purity, sale, buy })) : [];
}
