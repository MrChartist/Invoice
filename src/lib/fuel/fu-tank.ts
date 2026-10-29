/**
 * R21-A2 tanks and nozzles. A tank is a godown with `Godown.fu` (written by the tanks view); this module holds the
 * calibration chart (dip mm → litres by linear interpolation; a chart must rise in both columns; a dip outside it is
 * refused) and the `fuel_nozzles` master (`master.edit`, audited; a nozzle's product must be its tank's product; deletes
 * go through `setTable`, so the recycle bin keeps them). Working papers — verify with your CA (FU16, FU24).
 */
import './fu-registry';
import { generateId, getTable, setTable } from '../storage';
import type { FuelNozzle, FuelShift, FuTank } from '../../types/fuel-r21';
import { FU_TABLES } from './fu-shared';
import { nozzleLabel } from './fu-line';

export type Chart = FuTank['chart'];
type TankLike = { id: string; name?: string; fu?: FuTank };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Why a chart cannot be used ('' = usable; an empty chart is a CNG cascade, stock typed). */
export function chartIssue(chart: Chart): string {
  for (let i = 0; i < chart.length; i++) {
    const [mm, l] = chart[i];
    if (!(mm >= 0 && l >= 0)) return `Chart row ${i + 1}: type a dip and litres.`;
    if (i && (mm <= chart[i - 1][0] || l <= chart[i - 1][1])) return `Chart row ${i + 1}: dips and litres must rise row by row.`;
  }
  return '';
}

/** Rows "mm, litres" (comma, tab, semicolon or space; a heading line is skipped) → a chart. */
export const parseChart = (text: string): Chart =>
  text.split(/\r?\n/).map((s) => s.trim().split(/[\s,;]+/).map(Number)).filter((r) => r.length >= 2 && r.every(Number.isFinite)).map(([mm, l]) => [mm, l]);

/** Litres in the tank at a dip of `mm` (three decimals), or an Error with the reason. */
export function dipToLitres(chart: Chart, mm: number): number {
  const bad = chartIssue(chart) || (!chart.length ? 'This tank has no chart.' : '');
  if (bad) throw new Error(bad);
  const [lo, hi] = [chart[0][0], chart[chart.length - 1][0]];
  if (!(mm >= lo && mm <= hi)) throw new Error(`Dip ${mm} mm is outside the chart (${lo}–${hi} mm).`);
  const i = chart.findIndex(([x]) => x >= mm);
  if (chart[i][0] === mm) return chart[i][1];
  const [[x0, y0], [x1, y1]] = [chart[i - 1], chart[i]];
  return r3(y0 + ((mm - x0) * (y1 - y0)) / (x1 - x0));
}

export const readNozzles = (): FuelNozzle[] => getTable<FuelNozzle>(FU_TABLES.nozzles);

/** Why a nozzle cannot be saved ('' = fine). */
export function nozzleIssue(n: Omit<FuelNozzle, 'id'> & { id?: string }, tanks: readonly TankLike[], all: readonly FuelNozzle[]): string {
  const tank = tanks.find((t) => t.id === n.tank_id);
  if (!n.du_no.trim() || !n.nozzle_no.trim()) return 'Type the dispensing unit and nozzle numbers.';
  if (!tank?.fu) return 'Pick the tank this nozzle draws from.';
  if (tank.fu.product_item_id !== n.item_id) return 'A nozzle sells its tank\'s product: pick the tank of this product.';
  if (!(n.totaliser_start >= 0)) return 'Type the totaliser reading.';
  if (all.some((x) => x.id !== n.id && x.active && nozzleLabel(x) === nozzleLabel(n))) return `Nozzle ${nozzleLabel(n)} exists.`;
  return '';
}

/** Add or edit a nozzle (refused with the reason); the product is the tank's. */
export function saveNozzle(input: Omit<FuelNozzle, 'id' | 'item_id' | 'active'> & { id?: string; active?: boolean }, tanks: readonly TankLike[]): FuelNozzle {
  const all = readNozzles();
  const old = all.find((x) => x.id === input.id);
  const row: FuelNozzle = { ...old, ...input, du_no: input.du_no.trim(), nozzle_no: input.nozzle_no.trim().toUpperCase(), item_id: tanks.find((t) => t.id === input.tank_id)?.fu?.product_item_id ?? '', active: input.active ?? old?.active ?? true, id: old?.id ?? generateId(), updated_at: new Date().toISOString() };
  const bad = nozzleIssue(row, tanks, all);
  if (bad) throw new Error(bad);
  setTable(FU_TABLES.nozzles, old ? all.map((x) => (x.id === row.id ? row : x)) : [...all, row]);
  return row;
}

/**
 * Delete a nozzle (to the recycle bin). A nozzle on a shift is deactivated instead (QA25 W5): its shifts, the DSR and the
 * day close still price its readings by its product, and its last closing stays the carried opening.
 */
export function removeNozzle(id: string): void {
  const used = getTable<FuelShift>(FU_TABLES.shifts).some((s) => s.readings.some((r) => r.nozzle_id === id));
  setTable(FU_TABLES.nozzles, used ? readNozzles().map((x) => (x.id === id ? { ...x, active: false, updated_at: new Date().toISOString() } : x)) : readNozzles().filter((x) => x.id !== id));
}
