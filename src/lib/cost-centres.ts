/**
 * Cost centres / projects (roadmap 6.16) — the `cost_centres` master.
 *
 * A cost centre is a project, a department or a branch (Tally cost centres, Xero tracking
 * categories, Zoho projects). Documents point at one by id through the additive, optional
 * `cost_centre_id` field on invoices (document level, with an optional per-line override),
 * purchase bills / expenses, manual voucher lines, time entries and mileage. The ledger carries
 * the id onto its posting lines, and the Project P&L / Budgets reports group by it.
 *
 * This module is deliberately small and ledger-free: the editor, bill, expense, time and voucher
 * forms import it for their picker. Storage is read inside functions only (never at module level).
 */

import { audit } from './audit';
import { generateId, getTable, setTable } from './storage';

export const COST_CENTRES_TABLE = 'cost_centres';

// Round 5 (one union change, §6): R5-B3 'vehicle' (fleet cost centre) and R5-C4 'fund' (NGO fund accounting).
export type CostCentreKind = 'project' | 'department' | 'branch' | 'vehicle' | 'fund';

export const COST_CENTRE_KINDS: readonly CostCentreKind[] = ['project', 'department', 'branch', 'vehicle', 'fund'];

export const COST_CENTRE_KIND_LABELS: Record<CostCentreKind, string> = {
  project: 'Project',
  department: 'Department',
  branch: 'Branch',
  vehicle: 'Vehicle',
  fund: 'Fund',
};

/** One row of `cost_centres`. Field names are snake_case and additive-only. */
export interface CostCentre {
  id: string;
  name: string;
  kind: CostCentreKind;
  /** Optional `clients` row id (typical for a client project). */
  client_id?: string;
  /** Inactive centres are hidden from pickers but keep their history in reports. */
  active: boolean;
  /** Optional parent centre id — one level of grouping only (a parent cannot itself have a parent). */
  parent_id?: string;
  notes?: string;
  /* ── R3-B project fields (additive, optional; only meaningful on kind 'project') ── */
  /** Project hourly rate (rate cards, R3-B1): beats the client rate, loses to a task rate. */
  hourly_rate?: number;
  /** Hours budget in minutes (R3-B2). */
  budget_minutes?: number;
  /** Fee budget in rupees (R3-B2). */
  fee_budget?: number;
  /** Local days YYYY-MM-DD. */
  start?: string;
  due?: string;
  status?: ProjectStatus;
  created_at: string;
  updated_at?: string;
}

export type ProjectStatus = 'active' | 'on_hold' | 'done';
export const PROJECT_STATUSES: readonly ProjectStatus[] = ['active', 'on_hold', 'done'];

export type CostCentreInput = Omit<CostCentre, 'id' | 'created_at' | 'updated_at'> & { id?: string };

export class CostCentreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostCentreError';
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const posNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** R3-B: the optional project fields of a raw row / input, cleaned (absent when empty). */
function projectFields(o: Record<string, unknown>): Partial<CostCentre> {
  const out: Partial<CostCentre> = {};
  const rate = posNum(o.hourly_rate);
  if (rate !== undefined) out.hourly_rate = Math.round(rate * 100) / 100;
  const budget = posNum(o.budget_minutes);
  if (budget !== undefined) out.budget_minutes = Math.round(budget);
  const fee = posNum(o.fee_budget);
  if (fee !== undefined) out.fee_budget = Math.round(fee * 100) / 100;
  if (DAY.test(str(o.start))) out.start = str(o.start);
  if (DAY.test(str(o.due))) out.due = str(o.due);
  if (PROJECT_STATUSES.includes(o.status as ProjectStatus)) out.status = o.status as ProjectStatus;
  if (o.fund && typeof o.fund === 'object') out.fund = o.fund as CostCentre['fund']; // R5-C4: fund details (kind 'fund')
  if (o.ps && typeof o.ps === 'object') out.ps = o.ps as CostCentre['ps']; // R14 (PS-A2): matter fields
  if (o.tv && typeof o.tv === 'object') out.tv = o.tv as CostCentre['tv']; // R15-B2: trip / event fields
  if (o.mp && typeof o.mp === 'object') out.mp = o.mp as CostCentre['mp']; // R17-A2: site fields
  return out;
}

/** Tolerant read of stored rows (malformed rows are skipped). */
export function normalizeCostCentres(rows: unknown[]): CostCentre[] {
  const out: CostCentre[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = str(o.id);
    const name = str(o.name);
    if (!id || !name) continue;
    const kind = COST_CENTRE_KINDS.includes(o.kind as CostCentreKind) ? (o.kind as CostCentreKind) : 'project';
    out.push({
      id,
      name,
      kind,
      ...(str(o.client_id) ? { client_id: str(o.client_id) } : {}),
      active: o.active !== false,
      ...(str(o.parent_id) && str(o.parent_id) !== id ? { parent_id: str(o.parent_id) } : {}),
      ...(str(o.notes) ? { notes: str(o.notes) } : {}),
      ...projectFields(o),
      created_at: str(o.created_at),
      ...(str(o.updated_at) ? { updated_at: str(o.updated_at) } : {}),
    });
  }
  return out;
}

export function loadCostCentres(): CostCentre[] {
  return normalizeCostCentres(getTable<unknown>(COST_CENTRES_TABLE));
}

/** Sorted for pickers: parents first, each followed by its children; by name. */
export function sortCostCentres(list: readonly CostCentre[]): CostCentre[] {
  const byName = (a: CostCentre, b: CostCentre) => a.name.localeCompare(b.name);
  const ids = new Set(list.map((c) => c.id));
  const roots = list.filter((c) => !c.parent_id || !ids.has(c.parent_id)).sort(byName);
  const out: CostCentre[] = [];
  for (const r of roots) {
    out.push(r);
    out.push(...list.filter((c) => c.parent_id === r.id).sort(byName));
  }
  return out;
}

/** Display label: "Parent › Child" for a grouped centre. */
export function costCentreLabel(c: CostCentre | undefined, all: readonly CostCentre[]): string {
  if (!c) return '';
  const parent = c.parent_id ? all.find((p) => p.id === c.parent_id) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** Centres a picker offers: active ones, plus the currently selected one even if inactive. */
export function pickableCentres(all: readonly CostCentre[], selected?: string): CostCentre[] {
  return sortCostCentres(all.filter((c) => c.active || c.id === selected));
}

/**
 * Map a free-text project label (time entries) to an active cost centre by exact,
 * case-insensitive name. Returns undefined when there is no unambiguous match.
 */
export function matchCostCentre(label: string | undefined, all: readonly CostCentre[]): string | undefined {
  const key = (label ?? '').trim().toLowerCase();
  if (!key) return undefined;
  const hits = all.filter((c) => c.active && c.name.toLowerCase() === key);
  return hits.length === 1 ? hits[0].id : undefined;
}

/**
 * When every line carries the same cost centre, move it to the document (lines keep none);
 * otherwise keep the per-line overrides and leave the document unallocated.
 */
export function hoistCostCentre<T extends { cost_centre_id?: string }>(items: readonly T[]): { costCentreId?: string; items: T[] } {
  const ids = new Set(items.map((i) => i.cost_centre_id || ''));
  const only = ids.size === 1 ? [...ids][0] : '';
  if (!only) return { items: [...items] };
  return {
    costCentreId: only,
    items: items.map((i) => {
      const { cost_centre_id: _drop, ...rest } = i;
      void _drop;
      return rest as T;
    }),
  };
}

/** Problems with a cost centre (empty list = it may be saved). */
export function validateCostCentre(input: CostCentreInput, all: readonly CostCentre[]): string[] {
  const errors: string[] = [];
  const name = str(input.name);
  if (!name) errors.push('Enter a name.');
  if (!COST_CENTRE_KINDS.includes(input.kind)) errors.push('Choose a kind.');
  const others = all.filter((c) => c.id !== input.id);
  if (name && others.some((c) => c.name.toLowerCase() === name.toLowerCase())) errors.push(`A cost centre named "${name}" already exists.`);
  if (input.start && input.due && input.due < input.start) errors.push('The due date is before the start date.');
  if (input.parent_id) {
    const parent = others.find((c) => c.id === input.parent_id);
    if (!parent) errors.push('The parent cost centre does not exist.');
    else if (parent.parent_id) errors.push('Only one level of grouping is allowed: choose a top-level parent.');
    if (input.id && all.some((c) => c.parent_id === input.id)) errors.push('This cost centre already groups others, so it cannot have a parent.');
  }
  return errors;
}

export function saveCostCentre(input: CostCentreInput): CostCentre {
  const all = loadCostCentres();
  const errors = validateCostCentre(input, all);
  if (errors.length) throw new CostCentreError(errors[0]);
  const prev = input.id ? all.find((c) => c.id === input.id) : undefined;
  const now = new Date().toISOString();
  const row: CostCentre = {
    id: prev?.id ?? generateId(),
    name: str(input.name),
    kind: input.kind,
    ...(str(input.client_id) ? { client_id: str(input.client_id) } : {}),
    active: input.active !== false,
    ...(str(input.parent_id) ? { parent_id: str(input.parent_id) } : {}),
    ...(str(input.notes) ? { notes: str(input.notes) } : {}),
    // Forms that do not know the project fields (Books → cost centres) keep them; an explicit undefined clears one.
    ...projectFields({ ...prev, ...input } as unknown as Record<string, unknown>),
    created_at: prev?.created_at ?? now,
    ...(prev ? { updated_at: now } : {}),
  };
  setTable(COST_CENTRES_TABLE, prev ? all.map((c) => (c.id === row.id ? row : c)) : [...all, row]);
  audit.record({
    entity: 'cost_centre',
    entity_id: row.id,
    action: prev ? 'update' : 'create',
    summary: `${prev ? 'Edited' : 'Added'} ${COST_CENTRE_KIND_LABELS[row.kind].toLowerCase()} "${row.name}"${row.active ? '' : ' (inactive)'}`,
  });
  return row;
}

/** Where a cost centre id is referenced (documents, bills, vouchers, time, budgets, child centres). */
export interface CostCentreUsage {
  invoices: number;
  purchases: number;
  vouchers: number;
  time: number;
  mileage: number;
  budgets: number;
  children: number;
  /** Recurring templates (document-level or line overrides) — they would issue documents pointing at it. */
  recurring: number;
  /** R3-B2: project tasks of this project. */
  tasks?: number;
  /** QA20 V4 (R17): a site's musters / compliance rows, the staff deployed there and purchase bills tagged to it. */
  sites?: number;
}

type Row = Record<string, unknown>;

/** Pure usage count over raw table rows. */
export function costCentreUsage(
  id: string,
  t: { invoices?: Row[]; purchases?: Row[]; vouchers?: Row[]; time?: Row[]; mileage?: Row[]; budgets?: Row[]; centres?: readonly CostCentre[]; recurring?: Row[]; tasks?: Row[]; musters?: Row[]; compliance?: Row[]; employees?: Row[] },
): CostCentreUsage {
  const has = (r: Row) => r.cost_centre_id === id;
  const lines = (r: Row, key: string) => (Array.isArray(r[key]) ? (r[key] as Row[]) : []);
  return {
    invoices: (t.invoices ?? []).filter((r) => has(r) || lines(r, 'items').some(has)).length,
    purchases: (t.purchases ?? []).filter((r) => has(r) || lines(r, 'lines').some(has)).length,
    vouchers: (t.vouchers ?? []).filter((r) => lines(r, 'lines').some(has)).length,
    time: (t.time ?? []).filter(has).length,
    mileage: (t.mileage ?? []).filter(has).length,
    budgets: (t.budgets ?? []).filter(has).length,
    children: (t.centres ?? []).filter((c) => c.parent_id === id).length,
    recurring: (t.recurring ?? []).filter((r) => {
      const tpl = (r.template && typeof r.template === 'object' ? r.template : {}) as Row;
      return has(r) || has(tpl) || lines(tpl, 'items').some(has);
    }).length,
    tasks: (t.tasks ?? []).filter(has).length,
    sites: [...(t.musters ?? []), ...(t.compliance ?? [])].filter((r) => r?.site_id === id).length + (t.employees ?? []).filter(has).length
      + (t.purchases ?? []).filter((r) => !has(r) && (r.mp as Row | undefined)?.site_id === id).length,
  };
}

export const usageTotal = (u: CostCentreUsage) => u.invoices + u.purchases + u.vouchers + u.time + u.mileage + u.budgets + u.children + (u.recurring ?? 0) + (u.tasks ?? 0) + (u.sites ?? 0);

export function readCostCentreUsage(id: string): CostCentreUsage {
  return costCentreUsage(id, {
    invoices: getTable<Row>('invoices'),
    purchases: getTable<Row>('purchases'),
    vouchers: getTable<Row>('vouchers'),
    time: getTable<Row>('time_entries'),
    mileage: getTable<Row>('mileage'),
    budgets: getTable<Row>('budgets'),
    centres: loadCostCentres(),
    recurring: getTable<Row>('recurring'),
    tasks: getTable<Row>('project_tasks'), // R3-B2
    musters: getTable<Row>('site_musters'), // QA20 V4 (R17)
    compliance: getTable<Row>('site_compliance'),
    employees: getTable<Row>('employees'),
  });
}

/**
 * Delete a cost centre that nothing references. A used one must be made inactive instead, so
 * historical documents never point at a missing centre.
 */
export function deleteCostCentre(id: string): void {
  const all = loadCostCentres();
  const row = all.find((c) => c.id === id);
  if (!row) return;
  if (usageTotal(readCostCentreUsage(id)) > 0) {
    throw new CostCentreError(`"${row.name}" is used by documents, recurring templates, budgets, project tasks, site musters, deployed staff or other cost centres: mark it inactive instead.`);
  }
  setTable(COST_CENTRES_TABLE, all.filter((c) => c.id !== id));
  audit.record({ entity: 'cost_centre', entity_id: id, action: 'delete', summary: `Deleted ${COST_CENTRE_KIND_LABELS[row.kind].toLowerCase()} "${row.name}"` });
}
