/**
 * Rate cards (R3-B1): the hourly rate a new time entry captures, resolved in this order —
 *   1. task rate (`project_tasks.rate`, R3-B2)
 *   2. project rate (`cost_centres.hourly_rate`)
 *   3. client rate (`clients.doc_defaults.hourly_rate`, R3-B5)
 *   4. work type rate (`work_types.rate`)
 *   5. `default_rate` from the time preferences.
 * R14 (PS-A4): with the optional `{ staffRate }` argument the timekeeper's standard rate is one more level, after the
 * task and before the project; without the argument the result is identical (PS-C4 fills `currency`).
 * The entry keeps the rate it captured (`TimeEntry.hourly_rate`), so editing a card never reprices
 * logged time; "Re-rate unbilled" (`reRate`) is the explicit way to apply new cards to unbilled work.
 *
 * Pure above the "Storage" divider (tests/rate-cards.test.ts).
 */
import type { Client } from '../types/invoice';
import type { TimeEntry, TimePrefs } from '../types/time';
import type {} from '../types/service-r3';
import type { CostCentre } from './cost-centres';
import { num, round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { isDateLocked } from './period-lock';
import { audit } from './audit';

export const WORK_TYPES_TABLE = 'work_types';

/** One row of `work_types`. */
export interface WorkType {
  id: string;
  name: string;
  rate: number;
  /** SAC printed on lines billed under this work type (overrides the preference SAC). */
  sac?: string;
  inactive?: boolean;
}

export type RateSource = 'task' | 'staff' | 'project' | 'client' | 'work_type' | 'default';

export interface RateContext {
  task?: { rate?: number } | null;
  project?: Pick<CostCentre, 'hourly_rate'> | null;
  client?: Pick<Client, 'doc_defaults'> | null;
  workType?: WorkType | null;
  defaultRate: number;
}

export interface ResolvedRate {
  rate: number;
  source: RateSource;
  /** R14: the card's currency when the caller passed one (PS-C4). */
  currency?: string;
}

/** R14 (PS-A4 / C4): optional resolver argument — the timekeeper's standard rate and the rate-card currency. */
export interface RateOpts {
  staffRate?: number;
  currency?: string;
}

const positive = (v: unknown): number | undefined => {
  const n = num(v);
  return n > 0 ? round2(n) : undefined;
};

/** The first level of the card that sets a rate (> 0) wins; an inactive work type is skipped. */
export function resolveRate(ctx: RateContext, opts?: RateOpts): ResolvedRate {
  const r = resolveLevels(ctx, opts);
  return opts?.currency ? { ...r, currency: opts.currency } : r;
}

function resolveLevels(ctx: RateContext, opts?: RateOpts): ResolvedRate {
  const task = positive(ctx.task?.rate);
  if (task !== undefined) return { rate: task, source: 'task' };
  const staff = positive(opts?.staffRate);
  if (staff !== undefined) return { rate: staff, source: 'staff' };
  const project = positive(ctx.project?.hourly_rate);
  if (project !== undefined) return { rate: project, source: 'project' };
  const client = positive(ctx.client?.doc_defaults?.hourly_rate);
  if (client !== undefined) return { rate: client, source: 'client' };
  const wt = ctx.workType && !ctx.workType.inactive ? positive(ctx.workType.rate) : undefined;
  if (wt !== undefined) return { rate: wt, source: 'work_type' };
  return { rate: Math.max(round2(num(ctx.defaultRate)), 0), source: 'default' };
}

/** What the cards are resolved from (current masters). */
export interface RateData {
  tasks: readonly { id: string; cost_centre_id: string; rate?: number }[];
  centres: readonly CostCentre[];
  clients: readonly Client[];
  workTypes: readonly WorkType[];
  prefs: Pick<TimePrefs, 'default_rate'>;
}

/** The entry's fields that pick the card. */
export type RateSubject = Pick<TimeEntry, 'client_id'> & Partial<Pick<TimeEntry, 'task_id' | 'cost_centre_id' | 'work_type_id'>>;

export function rateContext(e: RateSubject, data: RateData): RateContext {
  const task = e.task_id ? data.tasks.find((t) => t.id === e.task_id) ?? null : null;
  // A task names its project; otherwise the entry's own cost centre.
  const ccId = task?.cost_centre_id || e.cost_centre_id;
  return {
    task,
    project: ccId ? data.centres.find((c) => c.id === ccId) ?? null : null,
    client: e.client_id ? data.clients.find((c) => c.id === e.client_id) ?? null : null,
    workType: e.work_type_id ? data.workTypes.find((w) => w.id === e.work_type_id) ?? null : null,
    defaultRate: data.prefs.default_rate,
  };
}

export const resolveEntryRate = (e: RateSubject, data: RateData, opts?: RateOpts): ResolvedRate => resolveRate(rateContext(e, data), opts);

/** SAC for a billed entry: its (active or not — it was chosen when logged) work type's SAC, else the preference. */
export function sacFor(e: Partial<Pick<TimeEntry, 'work_type_id'>>, workTypes: readonly WorkType[], fallback: string): string {
  const wt = e.work_type_id ? workTypes.find((w) => w.id === e.work_type_id) : undefined;
  return wt?.sac?.trim() || fallback;
}

/** Work types a picker offers: active ones, plus the selected one even when inactive. */
export const pickableWorkTypes = (all: readonly WorkType[], selected?: string): WorkType[] =>
  all.filter((w) => !w.inactive || w.id === selected).sort((a, b) => a.name.localeCompare(b.name));

export interface ReRateChange {
  id: string;
  date: string;
  description: string;
  from: number;
  to: number;
  source: RateSource;
}

/**
 * Re-rate preview: for each `unbilled` entry (the caller passes only unbilled, billable rows) the
 * rate the current cards give, where it differs from the captured one. Billed entries are never
 * passed in, so they are never touched.
 */
export function reRate(unbilled: readonly TimeEntry[], data: RateData): ReRateChange[] {
  const out: ReRateChange[] = [];
  for (const e of unbilled) {
    const r = resolveEntryRate(e, data);
    if (round2(num(e.hourly_rate)) !== r.rate) {
      out.push({ id: e.id, date: e.date, description: [e.project, e.description].filter(Boolean).join(': '), from: round2(num(e.hourly_rate)), to: r.rate, source: r.source });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** Apply a re-rate preview to rows (pure). Only ids in `changes` are touched. */
export function applyReRate<T extends { id: string; hourly_rate: number }>(rows: readonly T[], changes: readonly ReRateChange[]): T[] {
  const to = new Map(changes.map((c) => [c.id, c.to]));
  return rows.map((r) => (to.has(r.id) ? { ...r, hourly_rate: to.get(r.id)! } : r));
}

/** Tolerant read of stored work types. */
export function normalizeWorkTypes(rows: readonly unknown[]): WorkType[] {
  const out: WorkType[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!id || !name) continue;
    const sac = typeof o.sac === 'string' ? o.sac.replace(/\D/g, '').slice(0, 8) : '';
    out.push({ id, name, rate: Math.max(round2(num(o.rate)), 0), ...(sac ? { sac } : {}), ...(o.inactive === true ? { inactive: true } : {}), ...(o.ps && typeof o.ps === 'object' ? { ps: o.ps } : {}) }); // R14 PS-B2: WorkType.ps (unit)
  }
  return out;
}

export function validateWorkType(input: Omit<WorkType, 'id'> & { id?: string }, all: readonly WorkType[]): string {
  const name = input.name.trim();
  if (!name) return 'Enter a name for the work type.';
  if (all.some((w) => w.id !== input.id && w.name.toLowerCase() === name.toLowerCase())) return `A work type named "${name}" already exists.`;
  if (num(input.rate) < 0) return 'The rate cannot be negative.';
  if (input.sac && !/^\d{4,8}$/.test(input.sac)) return 'The SAC should be 4 to 8 digits.';
  return '';
}

// ── Storage ──────────────────────────────────────────────────────

export const loadWorkTypes = (): WorkType[] => normalizeWorkTypes(getTable<unknown>(WORK_TYPES_TABLE));

export function saveWorkType(input: Omit<WorkType, 'id'> & { id?: string }): WorkType {
  requireAccess('master.edit');
  const all = loadWorkTypes();
  const err = validateWorkType(input, all);
  if (err) throw new Error(err);
  const row = normalizeWorkTypes([{ ...input, id: input.id || generateId() }])[0];
  const exists = all.some((w) => w.id === row.id);
  setTable(WORK_TYPES_TABLE, exists ? all.map((w) => (w.id === row.id ? row : w)) : [...all, row]);
  return row;
}

/** A work type used by time entries is made inactive instead of deleted (history keeps its SAC). */
export function deleteWorkType(id: string): 'deleted' | 'inactive' {
  requireAccess('master.edit');
  const all = loadWorkTypes();
  const used = getTable<{ work_type_id?: string }>('time_entries').some((e) => e?.work_type_id === id);
  if (used) {
    setTable(WORK_TYPES_TABLE, all.map((w) => (w.id === id ? { ...w, inactive: true } : w)));
    return 'inactive';
  }
  setTable(WORK_TYPES_TABLE, all.filter((w) => w.id !== id));
  return 'deleted';
}

/**
 * Write a re-rate: only the previewed (unbilled) entries, skipping any dated in a locked period.
 * Returns how many entries changed.
 */
export function commitReRate(changes: readonly ReRateChange[]): number {
  requireAccess('books.edit');
  const open = changes.filter((c) => !isDateLocked(c.date));
  if (!open.length) return 0;
  setTable('time_entries', applyReRate(getTable<TimeEntry>('time_entries'), open));
  audit.record({ entity: 'settings', entity_id: 'time_entries', action: 'update', summary: `Re-rated ${open.length} unbilled time ${open.length === 1 ? 'entry' : 'entries'} from the rate cards` });
  return open.length;
}
