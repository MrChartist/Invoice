/**
 * AG-B1 fat / SNF rate charts (table `milk_rate_charts`, `master.edit`, audited, dated `effective_from`). Bases:
 *  - `matrix`: ₹ per unit at (fat, SNF) — nearest LOWER step (default) or nearest step;
 *  - `fat_kg`: ₹ per kg fat × kg fat; `ts_kg`: ₹ per kg total solids (fat + SNF);
 *  - `two_axis`: kg fat × fat rate + kg SNF × SNF rate (the common union formula); `flat`: ₹ per unit.
 * Below the minimum fat / SNF a chart rejects, pays a flat rate or deducts. Lookup is by shift date (`effective_from`
 * ≤ date, latest wins). Append-only: a chart used by an entry is never edited — a change is a new row from a date and
 * the old one gets `effective_to`; every entry stores its chart id and rate, so old milk is never repriced.
 * kg = litres × (1 + CLR / 1000); kg fat = kg × fat %. Working paper — verify with your union / CA.
 */
import './ag-registry';
import type { AgMilkSettings, MilkKind, MilkRateChart, MilkShift, MilkUnit } from '../../types/agri-r12';
import { generateId, getTable, setTable } from '../storage';
import { num, round2 } from '../invoice-calc';
import { shiftDay } from '../dates';
import { parseCsv, toCsv } from '../csv';
import { ruleAt } from '../tax-rules';
import { MILK_DEFAULTS } from '../agri-rules';
import { AG_TABLES } from './ag-shared';

export const q3 = (n: number): number => Math.round(num(n) * 1000) / 1000;
const p2 = (n: number): number => Math.round(num(n) * 100) / 100;

/** CLR when the analyser sent none: settings, else the dated default (cow 28 / buffalo 30 — practice). */
export function clrOf(milk: MilkKind, s?: AgMilkSettings, date?: string): number {
  const d = ruleAt(MILK_DEFAULTS, date);
  return milk === 'buffalo' ? num(s?.clr_buffalo) || d.clrBuffalo : num(s?.clr_cow) || d.clrCow;
}
export const toKg = (qty: number, unit: MilkUnit, clr: number): number => q3(unit === 'KG' ? qty : num(qty) * (1 + num(clr) / 1000));
export const toL = (qty: number, unit: MilkUnit, clr: number): number => q3(unit === 'L' ? qty : num(qty) / (1 + num(clr) / 1000));
/** kg fat / kg SNF of a quantity. */
export const solids = (qty: number, unit: MilkUnit, fat: number, snf: number, clr: number): { kgFat: number; kgSnf: number } => {
  const kg = toKg(qty, unit, clr);
  return { kgFat: q3((kg * num(fat)) / 100), kgSnf: q3((kg * num(snf)) / 100) };
};

/** Index of the step for `v`: nearest lower (−1 below the first) or nearest. */
export function stepIndex(steps: readonly number[], v: number, mode: 'lower' | 'nearest' = 'lower'): number {
  if (mode === 'nearest') {
    let best = -1;
    steps.forEach((s, i) => { if (best < 0 || Math.abs(s - v) < Math.abs(steps[best] - v) - 1e-9) best = i; });
    return best;
  }
  let hit = -1;
  steps.forEach((s, i) => { if (s <= v + 1e-9) hit = i; });
  return hit;
}

export interface ChartReading { fat: number; snf: number; qty: number; unit: MilkUnit; clr?: number; shift?: string; milk?: MilkKind }
export interface ChartResult { rate: number; amount: number; incentive: number; kgFat: number; kgSnf: number; rejected?: boolean; reason?: string }

/** Rate (₹ per chart unit, incentives included) and amount of one reading on a chart. */
export function chartRate(c: MilkRateChart, r: ChartReading): ChartResult {
  const clr = num(r.clr) || clrOf(r.milk ?? c.milk);
  const { kgFat, kgSnf } = solids(r.qty, r.unit, r.fat, r.snf, clr);
  const units = c.unit === 'KG' ? toKg(r.qty, r.unit, clr) : toL(r.qty, r.unit, clr);
  const per = (amount: number) => (units > 0 ? amount / units : 0);
  let base = 0;
  let below = (num(c.min_fat) > 0 && r.fat < num(c.min_fat)) || (num(c.min_snf) > 0 && r.snf < num(c.min_snf));
  if (c.basis === 'matrix') {
    const m = c.matrix;
    const i = m ? stepIndex(m.fat_steps, r.fat, c.lookup) : -1;
    const j = m ? stepIndex(m.snf_steps, r.snf, c.lookup) : -1;
    if (i < 0 || j < 0) below = true;
    else base = num(m!.rates[i]?.[j]);
  } else if (c.basis === 'fat_kg') base = per(kgFat * num(c.fat_rate));
  else if (c.basis === 'ts_kg') base = per((kgFat + kgSnf) * num(c.ts_rate));
  else if (c.basis === 'two_axis') base = per(kgFat * num(c.fat_rate) + kgSnf * num(c.snf_rate));
  else base = num(c.flat_rate);
  if (below) {
    if (c.below_min === 'reject') return { rate: 0, amount: 0, incentive: 0, kgFat, kgSnf, rejected: true, reason: 'Below the chart minimum' };
    base = c.below_min === 'flat' ? num(c.below_rate) : Math.max(base - num(c.below_rate), 0);
  }
  const incentive = (c.incentives ?? []).reduce((s, x) => s + (
    (x.kind === 'shift' && x.key === r.shift) || (x.kind === 'category' && x.key === (r.milk ?? c.milk)) || (x.kind === 'quantity' && units >= num(x.key)) ? num(x.add) : 0), 0);
  const rate = p2(base + incentive);
  return { rate, amount: round2(rate * units), incentive: p2(incentive), kgFat, kgSnf };
}

/** The chart in force on `date` for a milk kind (exact kind first, then `mixed`), a centre and (B4) a buyer. */
export function chartAt(charts: readonly MilkRateChart[], date: string, milk: MilkKind, o: { centreId?: string; buyerId?: string } = {}): MilkRateChart | undefined {
  const live = charts.filter((c) => c.effective_from <= date && (!c.effective_to || date <= c.effective_to) && (c.buyer_id ?? '') === (o.buyerId ?? '')
    && (!c.centre_ids?.length || (!!o.centreId && c.centre_ids.includes(o.centreId))));
  const pick = (k: MilkKind) => live.filter((c) => c.milk === k).sort((a, b) => a.effective_from.localeCompare(b.effective_from) || (a.created_at ?? '').localeCompare(b.created_at ?? '')).pop();
  return pick(milk) ?? pick('mixed');
}

/* ── Storage ── */

const T = AG_TABLES.rateCharts;
export const loadCharts = (): MilkRateChart[] => getTable<MilkRateChart>(T).filter((c) => c && typeof c.id === 'string');
const usedIds = (): Set<string> => new Set(getTable<MilkShift>(AG_TABLES.shifts).flatMap((s) => (s.entries ?? []).map((e) => e.chart_id ?? '')));
const sameLine = (a: MilkRateChart, b: Partial<MilkRateChart>) => a.milk === b.milk && (a.buyer_id ?? '') === (b.buyer_id ?? '') && (a.centre_ids ?? []).join() === (b.centre_ids ?? []).join();

/** Shape check; returns a message or ''. */
export function chartProblem(c: Partial<MilkRateChart>): string {
  if (!c.name?.trim()) return 'Name the chart.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.effective_from ?? '')) return 'Choose the date the chart takes effect.';
  if (c.basis === 'matrix') {
    const m = c.matrix;
    if (!m?.fat_steps.length || !m.snf_steps.length) return 'Add the fat and SNF steps.';
    if (m.rates.length !== m.fat_steps.length || m.rates.some((r) => r.length !== m.snf_steps.length)) return 'The matrix needs one rate per fat × SNF cell.';
    const up = (a: number[]) => a.every((x, i) => i === 0 || x > a[i - 1]);
    if (!up(m.fat_steps) || !up(m.snf_steps)) return 'Steps must go up.';
  }
  return '';
}

/**
 * Save a chart. A new chart closes the open chart of the same milk / centres / buyer the day before it starts. A chart
 * already used by an entry cannot be edited (save a new one from a date instead).
 */
export function saveChart(input: Omit<MilkRateChart, 'id'> & { id?: string }): MilkRateChart {
  const err = chartProblem(input);
  if (err) throw new Error(err);
  const all = loadCharts();
  const prev = input.id ? all.find((c) => c.id === input.id) : undefined;
  if (prev && usedIds().has(prev.id)) throw new Error(`${prev.name} is already used by collected milk: save the change as a new chart from a date.`);
  const row: MilkRateChart = { ...prev, ...input, name: input.name.trim(), id: prev?.id ?? generateId(), created_at: prev?.created_at ?? new Date().toISOString() };
  const rows = all.map((c) => (c.id === row.id ? row : !prev && !c.effective_to && sameLine(c, row) && c.effective_from < row.effective_from ? { ...c, effective_to: shiftDay(row.effective_from, -1) } : c));
  setTable(T, prev ? rows : [...rows, row]);
  return row;
}

/** Delete an unused chart (recycle bin). */
export function deleteChart(id: string): void {
  if (usedIds().has(id)) throw new Error('This chart priced collected milk: it stays (close it with a new chart instead).');
  setTable(T, loadCharts().filter((c) => c.id !== id));
}

/** Matrix as CSV: first row "fat \ SNF" + SNF steps; then one row per fat step. */
export const matrixCsv = (m: NonNullable<MilkRateChart['matrix']>): string =>
  toCsv([['fat \\ SNF', ...m.snf_steps], ...m.fat_steps.map((f, i) => [f, ...m.snf_steps.map((_, j) => num(m.rates[i]?.[j]))])]);

/** Parse a matrix from CSV / sheet rows (the shape `matrixCsv` writes). */
export function parseMatrix(input: string | readonly (readonly unknown[])[]): NonNullable<MilkRateChart['matrix']> {
  const rows = (typeof input === 'string' ? parseCsv(input) : input).map((r) => r.map((x) => String(x ?? '').trim())).filter((r) => r.some(Boolean));
  if (rows.length < 2) throw new Error('The sheet needs a header row of SNF steps and one row per fat step.');
  const n = (x: string) => Number(x.replace(/,/g, ''));
  const snf_steps = rows[0].slice(1).filter(Boolean).map(n);
  const body = rows.slice(1);
  const m = { fat_steps: body.map((r) => n(r[0])), snf_steps, rates: body.map((r) => snf_steps.map((_, j) => n(r[j + 1] ?? '0') || 0)) };
  if ([...m.fat_steps, ...m.snf_steps].some((x) => !Number.isFinite(x))) throw new Error('Steps must be numbers.');
  return m;
}
