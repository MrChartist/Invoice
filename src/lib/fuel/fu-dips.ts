/**
 * R21-C1 dips and density (`fuel_tank_logs`, `doc.create`, dated by `date`, period-locked by it, audited; deletes go to
 * the recycle bin through `setTable`). A dip's litres come from the tank's chart and are stored with the row; a water
 * dip is shown and deducted from the product litres unless the chart is product-only (`fuel_settings.dip_water`, FU16).
 * CNG cascades have no chart: their stock is typed. The morning checklist (MDG cl. 1.3, 1.4: every tank dipped, every
 * nozzle tested, a morning density per product) lists what is missing — never a block. Working papers — verify with
 * your CA (FU15–FU17).
 */
import './fu-registry';
import { generateId, getTable, setTable } from '../storage';
import { assertUnlocked } from '../period-lock';
import type { FuelNozzle, FuelShift, FuelTankLog, FuTank } from '../../types/fuel-r21';
import { FU_TABLES } from './fu-shared';
import { dipToLitres } from './fu-tank';

export type FuTankRow = { id: string; name: string; fu?: FuTank };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const readLogs = (): FuelTankLog[] => getTable<FuelTankLog>(FU_TABLES.logs);

/** Product litres at a dip (and the water litres under it): chart(mm) − chart(water mm) unless the chart is product-only. */
export function dipLitres(chart: FuTank['chart'], mm: number, waterMm = 0, subtract = true): { litres: number; water_l: number } {
  const water = waterMm > 0 ? dipToLitres(chart, waterMm) : 0;
  return { litres: r3(dipToLitres(chart, mm) - (subtract ? water : 0)), water_l: water };
}

const at = (mm: number | undefined, chart: FuTank['chart']) => (mm != null && chart.length ? dipToLitres(chart, mm) : undefined);

/** Add a dip, density or receipt row (refused with the reason); litres are worked out from the tank's chart. */
export function saveLog(input: Omit<FuelTankLog, 'id'>, tank?: FuTankRow, subtract = true): FuelTankLog {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Type the date.');
  assertUnlocked({ issue_date: input.date }, 'create');
  const row: FuelTankLog = { ...input, id: generateId(), created_at: new Date().toISOString() };
  const chart = tank?.fu?.chart ?? [];
  if (input.kind !== 'density' && !tank?.fu) throw new Error('Pick the tank.');
  if (input.kind === 'dip') {
    if (chart.length) {
      if (!(Number.isInteger(input.mm) && input.mm! >= 0)) throw new Error('Type the dip in whole mm.');
      Object.assign(row, dipLitres(chart, input.mm!, input.water_mm, subtract));
    } else if (!(Number(input.litres) >= 0)) throw new Error('This tank has no chart: type the stock.');
  } else if (input.kind === 'density') {
    if (!input.tank_id && !input.nozzle_id) throw new Error('Pick the tank or the nozzle.');
    if (!(Number(input.density_15) >= 500 && Number(input.density_15) <= 1100)) throw new Error('Type the density at 15 °C in kg/m³.');
  } else {
    const c = (input.compartments ?? []).filter((x) => x.invoice_l > 0);
    if (!c.length) throw new Error('Type the invoice litres.');
    Object.assign(row, { compartments: c, before_l: at(input.before_mm, chart) ?? input.before_l, after_l: at(input.after_mm, chart) ?? input.after_l });
  }
  setTable(FU_TABLES.logs, [...readLogs(), row]);
  return row;
}

/** Delete a log row (to the recycle bin). */
export function removeLog(id: string): void {
  const all = readLogs();
  const r = all.find((x) => x.id === id);
  if (r) assertUnlocked({ issue_date: r.date }, 'delete');
  setTable(FU_TABLES.logs, all.filter((x) => x.id !== id));
}

export interface Missing { k: 'dip' | 'test' | 'density'; name: string }

/** The morning checklist of `day`: tanks without a dip, active nozzles without a test, products without a density. */
export function morningChecklist(day: string, o: { tanks: readonly FuTankRow[]; nozzles: readonly FuelNozzle[]; logs: readonly FuelTankLog[]; shifts: readonly FuelShift[]; itemName: (id: string) => string; label: (n: FuelNozzle) => string }): Missing[] {
  const logs = o.logs.filter((l) => l.date === day);
  const tested = new Set(o.shifts.filter((s) => s.date === day).flatMap((s) => s.readings.filter((r) => r.test_l > 0).map((r) => r.nozzle_id)));
  const out: Missing[] = o.tanks.filter((t) => !logs.some((l) => l.kind === 'dip' && l.tank_id === t.id)).map((t) => ({ k: 'dip', name: t.name }));
  for (const n of o.nozzles) if (n.active && !tested.has(n.id)) out.push({ k: 'test', name: o.label(n) });
  const tankOf = new Map(o.tanks.map((t) => [t.id, t.fu?.product_item_id]));
  const done = new Set(logs.filter((l) => l.kind === 'density').map((l) => (l.tank_id ? tankOf.get(l.tank_id) : o.nozzles.find((n) => n.id === l.nozzle_id)?.item_id)));
  for (const p of new Set(tankOf.values())) if (p && !done.has(p)) out.push({ k: 'density', name: o.itemName(p) });
  return out;
}
