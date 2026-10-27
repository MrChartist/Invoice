/**
 * MF-A2 work centres (table `work_centres`, `master.edit`, audited): a machine, a line, a manual bench or an outside
 * processor (plating, heat treatment → job work). The machine-hour rate is the SUM of its parts (machine + labour +
 * power + overhead), shown as a breakdown, never one typed number. Available hours on a day = Σ shift hours × parallel
 * units × efficiency, nothing on a weekday off or a holiday. Pure helpers above the storage divider.
 */
import './mf-registry';
import type { WorkCentre } from '../../types/mfg-r13';
import { num, round2 } from '../invoice-calc';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { MF_TABLES } from './mf-shared';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export { machineHourRate } from './mf-ops';

/** Weekday of a local day (0 = Sunday), without `new Date(str)` (AGENTS rule 8). */
export function weekday(day: string): number {
  return new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))).getUTCDay();
}

/** Local day `n` days after `day` (negative = before). */
export function addDays(day: string, n: number): string {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

/** Hours one unit of the centre works on a day (Σ shifts), before parallel units and efficiency. */
export const shiftHours = (c: Pick<WorkCentre, 'shifts'>): number => round2((c.shifts ?? []).reduce((s, x) => s + Math.max(num(x.hours), 0), 0));

/** Effective available hours on `day`: shifts × parallel units × efficiency; 0 on a weekday off or a holiday. */
export function availableHours(c: Pick<WorkCentre, 'shifts' | 'days' | 'efficiency_pct' | 'capacity_units' | 'holidays'>, day: string): number {
  if (!(c.days ?? []).includes(weekday(day)) || (c.holidays ?? []).includes(day)) return 0;
  return round2(shiftHours(c) * Math.max(num(c.capacity_units, 1), 1) * (num(c.efficiency_pct, 100) / 100));
}

/** Refusal text, or '' when the centre may be saved. */
export function validateCentre(c: Partial<WorkCentre>): string {
  if (!c.name?.trim()) return 'Name the work centre (e.g. Laser 1).';
  for (const k of ['hourly_rate', 'labour_rate', 'power_rate', 'overhead_rate'] as const) if (num(c[k]) < 0) return 'Rates cannot be negative.';
  if (!c.shifts?.length || c.shifts.some((s) => !(num(s.hours) > 0) || num(s.hours) > 24)) return 'Give each shift between 0 and 24 hours.';
  if (shiftHours(c as WorkCentre) > 24) return 'The shifts add up to more than 24 hours a day.';
  if (!c.days?.length || c.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Pick the working days.';
  if (c.efficiency_pct !== undefined && !(num(c.efficiency_pct) > 0 && num(c.efficiency_pct) <= 200)) return 'Efficiency is a % between 1 and 200.';
  if (c.capacity_units !== undefined && !(num(c.capacity_units) >= 1)) return 'Parallel machines / operators: at least 1.';
  if ((c.holidays ?? []).some((h) => !DAY.test(h))) return 'Holidays are dates.';
  return '';
}

/* ── Storage ───────────────────────────────────────────────────── */

const T = MF_TABLES.centres;
export const loadCentres = (): WorkCentre[] => getTable<WorkCentre>(T).filter((c) => c && typeof c.id === 'string');
export const peekCentres = (): readonly WorkCentre[] => peekTable<WorkCentre>(T);

/** Save a work centre (master.edit; names are unique). */
export function saveCentre(input: Omit<WorkCentre, 'id' | 'active'> & { id?: string; active?: boolean }): WorkCentre {
  requireAccess('master.edit');
  const bad = validateCentre(input);
  if (bad) throw new Error(bad);
  const all = loadCentres();
  const prev = input.id ? all.find((c) => c.id === input.id) : undefined;
  const name = input.name.trim().slice(0, 60);
  if (all.some((c) => c.id !== prev?.id && c.name.toLowerCase() === name.toLowerCase())) throw new Error(`A work centre named ${name} exists.`);
  const now = new Date().toISOString();
  const row: WorkCentre = {
    ...prev, ...input, id: prev?.id ?? generateId(), name, active: input.active ?? prev?.active ?? true,
    hourly_rate: round2(num(input.hourly_rate)), shifts: input.shifts.map((s) => ({ name: s.name.trim() || 'Shift', hours: round2(num(s.hours)) })),
    days: [...new Set(input.days)].sort(), created_at: prev?.created_at ?? now, updated_at: now,
  };
  setTable(T, prev ? all.map((c) => (c.id === row.id ? row : c)) : [...all, row]);
  return row;
}

/** Delete a centre (recycle bin) — refused while a routing names it. */
export function removeCentre(id: string): void {
  requireAccess('master.edit');
  if (peekTable<{ ops?: { work_centre_id?: string }[] }>(MF_TABLES.routings).some((r) => r?.ops?.some((o) => o.work_centre_id === id))) {
    throw new Error('A routing uses this work centre: change the routing first, or mark the centre inactive.');
  }
  setTable(T, loadCentres().filter((c) => c.id !== id));
}
