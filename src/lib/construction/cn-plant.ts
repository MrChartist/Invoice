/**
 * CN-D3 plant and equipment. Equipment = a fixed asset marked `cn_equipment` (kind, registration, hour meter,
 * internal / hire-out rate per hour, fuel range) or a hired item (table `hired_equipment`, `master.edit`). Daily log
 * sheets (table `plant_logs`, `PLG/FY…`, `doc.create`, dated `date`): hours worked / idle / breakdown, fuel, site,
 * operator and, for hire out, the sub-contractor charged. Monthly summary per machine: utilisation % and fuel per
 * working hour flagged outside the typed range. Logs against a sub-contractor become a recovery on his bill (D1);
 * logs of our own equipment at our sites are a site P&L charge at the internal rate (memo, D5).
 */
import './cn-registry';
import type { CnEquipment, HiredEquipment, PlantLog } from '../../types/construction-r11';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { assertUnlocked } from '../period-lock';
import { withTablesRollback } from '../table-txn';
import { DAY, SD, drop, put, rowsOf } from './cn-subcon';

export const PLG = 'PLG';
const ASSETS_TABLE = 'fixed_assets'; // ledger/assets.ts (kept verbatim there: `cn_equipment`)
export const loadHired = () => rowsOf<HiredEquipment>(SD.hired);
export const loadLogs = () => rowsOf<PlantLog>(SD.logs);

/** One machine as the screens see it (`ref` = `fa:<asset id>` / `hire:<id>`). */
export interface Machine {
  ref: string;
  name: string;
  own: boolean;
  /** Per hour: internal charge (own) / hire-out rate. */
  internal: number;
  hireOut: number;
  fuel_min?: number;
  fuel_max?: number;
  hired?: HiredEquipment;
}

type AssetRow = { id: string; name?: string; cn_equipment?: CnEquipment };

export function machines(assets: readonly AssetRow[] = getTable<AssetRow>(ASSETS_TABLE), hired: readonly HiredEquipment[] = loadHired()): Machine[] {
  return [
    ...assets.filter((a) => a?.cn_equipment).map((a) => {
      const e = a.cn_equipment!;
      return { ref: `fa:${a.id}`, name: `${a.name ?? ''}${e.reg_no ? ` (${e.reg_no})` : ''}`, own: true, internal: num(e.internal_rate), hireOut: num(e.hire_rate), fuel_min: e.fuel_min, fuel_max: e.fuel_max };
    }),
    ...hired.map((h) => ({ ref: `hire:${h.id}`, name: `${h.description}: ${h.vendor_name}`, own: false, internal: 0, hireOut: h.basis === 'hour' ? num(h.rate) : 0, fuel_min: h.fuel_min, fuel_max: h.fuel_max, hired: h })),
  ];
}

/** Mark (or update) a fixed asset as site equipment; `null` removes the mark. */
export function setEquipment(assetId: string, e: CnEquipment | null): void {
  requireAccess('master.edit');
  const all = getTable<AssetRow>(ASSETS_TABLE);
  if (!all.some((a) => a?.id === assetId)) throw new Error('Choose a fixed asset.');
  setTable(ASSETS_TABLE, all.map((a) => {
    if (a?.id !== assetId) return a;
    const { cn_equipment: _old, ...rest } = a;
    void _old;
    return e ? { ...rest, cn_equipment: { ...e, kind: e.kind.trim() || 'Equipment' } } : rest;
  }));
}

export function saveHired(h: Omit<HiredEquipment, 'id'> & { id?: string }): HiredEquipment {
  requireAccess('master.edit');
  if (!h.vendor_id || !h.description.trim()) throw new Error('Choose the hirer and describe the equipment.');
  if (!(num(h.rate) > 0)) throw new Error('Enter the hire rate.');
  if (!DAY.test(h.from)) throw new Error('Enter the hire start date.');
  return put(SD.hired, { ...h, id: h.id || generateId(), rate: num(h.rate), description: h.description.trim() });
}
export function deleteHired(id: string): void {
  requireAccess('master.edit');
  if (loadLogs().some((l) => l.equipment_ref === `hire:${id}`)) throw new Error('This equipment has log sheets; keep it (set the "to" date instead).');
  drop(SD.hired, id);
}

export type LogInput = Omit<PlantLog, 'id' | 'number' | 'recovered_in'>;

export function saveLog(i: LogInput): PlantLog {
  requireAccess('doc.create');
  if (!DAY.test(i.date)) throw new Error('Enter the log date.');
  if (!i.equipment_ref || !i.site_id) throw new Error('Choose the equipment and the site.');
  const h = [i.hours_worked, i.idle_hours, i.breakdown_hours].map(num);
  if (h.some((x) => x < 0) || h[0] + h[1] + h[2] > 24) throw new Error('Hours must add up to 24 or less.');
  const all = loadLogs();
  const number = nextSeriesNumberFor(PLG, i.date, all.map((l) => l.number));
  assertUnlocked({ issue_date: i.date, invoice_number: number }, 'create');
  const row: PlantLog = { ...i, id: generateId(), number, hours_worked: h[0], idle_hours: h[1], breakdown_hours: h[2], fuel_litres: Math.max(num(i.fuel_litres), 0) };
  return withTablesRollback([SD.logs, 'series_counters'], () => {
    put(SD.logs, row);
    recordSeries(number);
    return row;
  });
}

/** Delete a log not yet recovered on a sub-contractor bill (its PLG number stays used). */
export function deleteLog(id: string): void {
  requireAccess('doc.create');
  const l = loadLogs().find((x) => x.id === id);
  if (l && isRecovered(l, getTable<{ id: string; status?: string }>('invoices'))) throw new Error(`Recovered on ${l.recovered_in}; cancel that bill first.`);
  drop(SD.logs, id);
}

export interface MachineMonth {
  ref: string;
  month: string;
  days: number;
  worked: number;
  idle: number;
  breakdown: number;
  fuel: number;
  /** Worked ÷ (worked + idle + breakdown), %. */
  utilisation: number;
  /** Litres per working hour (null without hours). */
  fuelPerHour: number | null;
  fuelFlag: 'low' | 'high' | null;
}

/** Pure: monthly summary per machine (`month` = YYYY-MM). */
export function monthSummary(logs: readonly PlantLog[], month: string, list: readonly Pick<Machine, 'ref' | 'fuel_min' | 'fuel_max'>[]): MachineMonth[] {
  const out = new Map<string, MachineMonth>();
  const dates = new Map<string, Set<string>>();
  for (const l of logs) {
    if (l.date.slice(0, 7) !== month) continue;
    let m = out.get(l.equipment_ref);
    if (!m) out.set(l.equipment_ref, (m = { ref: l.equipment_ref, month, days: 0, worked: 0, idle: 0, breakdown: 0, fuel: 0, utilisation: 0, fuelPerHour: null, fuelFlag: null }));
    m.worked += num(l.hours_worked);
    m.idle += num(l.idle_hours);
    m.breakdown += num(l.breakdown_hours);
    m.fuel += num(l.fuel_litres);
    dates.set(l.equipment_ref, (dates.get(l.equipment_ref) ?? new Set()).add(l.date));
  }
  for (const m of out.values()) {
    const all = m.worked + m.idle + m.breakdown;
    m.days = dates.get(m.ref)?.size ?? 0;
    m.utilisation = all ? round2((m.worked * 100) / all) : 0;
    m.fuelPerHour = m.worked ? round2(m.fuel / m.worked) : null;
    const e = list.find((x) => x.ref === m.ref);
    if (m.fuelPerHour !== null && e) m.fuelFlag = e.fuel_min !== undefined && m.fuelPerHour < num(e.fuel_min) ? 'low' : e.fuel_max !== undefined && num(e.fuel_max) > 0 && m.fuelPerHour > num(e.fuel_max) ? 'high' : null;
    for (const k of ['worked', 'idle', 'breakdown', 'fuel'] as const) m[k] = round2(m[k]);
  }
  return [...out.values()];
}

/**
 * QA11 C13: recovered on a sub-contractor bill, or on a hire-out invoice that still exists (not cancelled) — a deleted /
 * cancelled draft invoice gives its logs back. Without `invoices` every marked log counts as recovered.
 */
export const isRecovered = (l: Pick<PlantLog, 'recovered_in' | 'recovered_invoice_id'>, invoices?: readonly { id: string; status?: string }[]): boolean =>
  !!l.recovered_in && !(l.recovered_invoice_id && invoices && !invoices.some((i) => i?.id === l.recovered_invoice_id && i.status !== 'Cancelled'));

/** Pure: logs charged to a sub-contractor not yet recovered (up to `date`) and their value at the hire-out rate. */
export function hireRecoveryFor(vendorId: string, date: string, logs: readonly PlantLog[], list: readonly Machine[], invoices?: readonly { id: string; status?: string }[]): { logs: PlantLog[]; amount: number } {
  const open = logs.filter((l) => l.sub_contractor_id === vendorId && !isRecovered(l, invoices) && l.date <= date);
  const amount = round2(open.reduce((s, l) => s + num(l.hours_worked) * (list.find((m) => m.ref === l.equipment_ref)?.hireOut ?? 0), 0));
  return { logs: open, amount };
}

/** Pure: internal plant charge per site (own equipment, logs not charged to a sub-contractor) in a period. */
export function internalCharges(logs: readonly PlantLog[], list: readonly Machine[], from: string, to: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of logs) {
    if (l.sub_contractor_id || l.date < from || l.date > to) continue;
    const m = list.find((x) => x.ref === l.equipment_ref);
    if (!m?.own || !(m.internal > 0)) continue;
    out.set(l.site_id, round2((out.get(l.site_id) ?? 0) + num(l.hours_worked) * m.internal));
  }
  return out;
}
