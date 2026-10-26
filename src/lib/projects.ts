/**
 * Projects (R3-B2): a cost centre of kind 'project' with optional project fields (client, hours / fee
 * budget, start / due, status, hourly rate — `src/lib/cost-centres.ts`) and its tasks (`project_tasks`).
 *
 * Board columns are per company (`project_settings.columns`, renamable / addable). "Invoiced" is not a
 * stored column: a task shows there while it has billable time and all of it is billed by a live
 * invoice (`isBilled`), so cancelling the invoice moves the task back to its own column.
 *
 * Pure above the "Storage" divider (tests/projects.test.ts).
 */
import type { TimeEntry, TimePrefs } from '../types/time';
import type {} from '../types/service-r3';
import type { CostCentre } from './cost-centres';
import { billableMinutes, entryAmount, isBilled } from './timesheets';
import { num, round2 } from './invoice-calc';
import { parseDay } from './dates';
import { DB_PREFIX, generateId, getJson, getTable, setJson, setTable } from './storage';
import { requireAccess } from './access';

export const TASKS_TABLE = 'project_tasks';
export const PROJECT_SETTINGS_KEY = `${DB_PREFIX}project_settings`;
/** Derived column id (never stored on a task). */
export const INVOICED = '__invoiced__';
export const DEFAULT_COLUMNS: readonly string[] = ['To do', 'Doing', 'Done'];

export interface ProjectTask {
  id: string;
  cost_centre_id: string;
  title: string;
  /** Column name (one of `project_settings.columns`). */
  column: string;
  estimate_minutes: number;
  /** Local user id (`auth_users`), or empty for the owner / nobody. */
  assignee_id?: string;
  /** Task hourly rate (beats the project rate, R3-B1). */
  rate?: number;
  /** Local day YYYY-MM-DD. */
  due?: string;
  sort: number;
  created_at: string;
  updated_at?: string;
}

export interface ProjectSettings {
  columns: string[];
}

// ── Pure: time per task / project ───────────────────────────────

const minutesOf = (e: Pick<TimeEntry, 'minutes'>) => Math.max(num(e.minutes), 0);

/** Entries of a project: its own cost centre id, or a task of it. */
export function projectEntries(projectId: string, entries: readonly TimeEntry[], tasks: readonly ProjectTask[]): TimeEntry[] {
  const own = new Set(tasks.filter((t) => t.cost_centre_id === projectId).map((t) => t.id));
  return entries.filter((e) => e.cost_centre_id === projectId || (!!e.task_id && own.has(e.task_id)));
}

export const taskEntries = (taskId: string, entries: readonly TimeEntry[]): TimeEntry[] => entries.filter((e) => e.task_id === taskId);

export const trackedMinutes = (entries: readonly TimeEntry[]): number => entries.reduce((s, e) => s + minutesOf(e), 0);

/** The column a task shows in: "Invoiced" while all its billable time is billed, else its own. */
export function displayColumn(task: ProjectTask, entries: readonly TimeEntry[], live: Set<string>): string {
  const billable = taskEntries(task.id, entries).filter((e) => e.billable);
  if (billable.length && billable.every((e) => isBilled(e.invoiced_in, live, e.id))) return INVOICED;
  return task.column;
}

export type BudgetLevel = 0 | 80 | 100;

/** Warning threshold reached by `pct` (≥ 100 → 100, ≥ 80 → 80). */
export const budgetLevel = (pct: number | null): BudgetLevel => (pct === null ? 0 : pct >= 100 ? 100 : pct >= 80 ? 80 : 0);

const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);

export interface ProjectBurn {
  tracked_minutes: number;
  budget_minutes: number;
  /** Tracked / budget in percent (null without a budget). */
  pct: number | null;
  level: BudgetLevel;
  billed_amount: number;
  unbilled_amount: number;
  /** Billed + unbilled billable value vs the fee budget. */
  fee_used: number;
  fee_pct: number | null;
  fee_level: BudgetLevel;
  /** Minutes the project ends at by its due date at the current burn (null without start / due). */
  forecast_minutes: number | null;
  estimate_minutes: number;
}

/** Hours / fee used, and a straight-line forecast to the due date at the burn since `start`. */
export function projectBurn(
  project: Pick<CostCentre, 'id' | 'budget_minutes' | 'fee_budget' | 'start' | 'due'>,
  entries: readonly TimeEntry[],
  tasks: readonly ProjectTask[],
  prefs: TimePrefs,
  live: Set<string>,
  today: string,
): ProjectBurn {
  const rows = projectEntries(project.id, entries, tasks);
  const tracked = trackedMinutes(rows);
  let billed = 0;
  let unbilled = 0;
  for (const e of rows) {
    if (!e.billable) continue;
    if (isBilled(e.invoiced_in, live, e.id)) billed = round2(billed + entryAmount(e, prefs));
    else unbilled = round2(unbilled + entryAmount(e, prefs));
  }
  const budget = Math.max(num(project.budget_minutes), 0);
  const pct = budget > 0 ? round2((tracked / budget) * 100) : null;
  const feeBudget = Math.max(num(project.fee_budget), 0);
  const feeUsed = round2(billed + unbilled);
  const feePct = feeBudget > 0 ? round2((feeUsed / feeBudget) * 100) : null;
  let forecast: number | null = null;
  if (project.start && project.due && project.due >= project.start && today >= project.start) {
    const elapsed = Math.max(daysBetween(project.start, today < project.due ? today : project.due) + 1, 1);
    const total = daysBetween(project.start, project.due) + 1;
    forecast = Math.round((tracked / elapsed) * total);
  }
  return {
    tracked_minutes: tracked,
    budget_minutes: budget,
    pct,
    level: budgetLevel(pct),
    billed_amount: billed,
    unbilled_amount: unbilled,
    fee_used: feeUsed,
    fee_pct: feePct,
    fee_level: budgetLevel(feePct),
    forecast_minutes: forecast,
    estimate_minutes: tasks.filter((t) => t.cost_centre_id === project.id).reduce((s, t) => s + Math.max(num(t.estimate_minutes), 0), 0),
  };
}

/** Tracked vs estimate for one task (for the card bar). */
export function taskProgress(task: ProjectTask, entries: readonly TimeEntry[]): { tracked: number; estimate: number; pct: number | null } {
  const tracked = trackedMinutes(taskEntries(task.id, entries));
  const estimate = Math.max(num(task.estimate_minutes), 0);
  return { tracked, estimate, pct: estimate > 0 ? round2((tracked / estimate) * 100) : null };
}

// ── Pure: board ─────────────────────────────────────────────────

const bySort = (a: ProjectTask, b: ProjectTask) => a.sort - b.sort || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** Tasks of one project in one (stored) column, in board order. */
export const columnTasks = (tasks: readonly ProjectTask[], projectId: string, column: string): ProjectTask[] =>
  tasks.filter((t) => t.cost_centre_id === projectId && t.column === column).sort(bySort);

/**
 * Move a task to `column` at `index` (0 = top). Sorts in the source and target columns are rewritten
 * as 0, 1, 2 … so the order is stable; other projects' tasks are untouched. Returns a new array.
 */
export function moveTask(tasks: readonly ProjectTask[], id: string, column: string, index: number): ProjectTask[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return [...tasks];
  const target = columnTasks(tasks, task.cost_centre_id, column).filter((t) => t.id !== id);
  const at = Math.max(0, Math.min(Math.round(index), target.length));
  target.splice(at, 0, { ...task, column });
  const next = new Map<string, ProjectTask>();
  target.forEach((t, i) => next.set(t.id, { ...t, sort: i }));
  if (task.column !== column) {
    columnTasks(tasks, task.cost_centre_id, task.column).filter((t) => t.id !== id).forEach((t, i) => next.set(t.id, { ...t, sort: i }));
  }
  return tasks.map((t) => next.get(t.id) ?? t);
}

/** Alt+← / Alt+→: the task goes to the end of the neighbouring column (null at the edge). */
export function moveTaskBy(tasks: readonly ProjectTask[], id: string, dir: -1 | 1, columns: readonly string[]): ProjectTask[] | null {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;
  const at = columns.indexOf(task.column);
  const to = columns[(at < 0 ? 0 : at) + dir];
  if (to === undefined) return null;
  return moveTask(tasks, id, to, columnTasks(tasks, task.cost_centre_id, to).length);
}

/** Rename a column everywhere (settings + tasks). Pure. */
export function renameColumn(settings: ProjectSettings, tasks: readonly ProjectTask[], from: string, to: string): { settings: ProjectSettings; tasks: ProjectTask[] } {
  const name = to.trim();
  if (!name || name === from || settings.columns.includes(name)) return { settings, tasks: [...tasks] };
  return {
    settings: { columns: settings.columns.map((c) => (c === from ? name : c)) },
    tasks: tasks.map((t) => (t.column === from ? { ...t, column: name } : t)),
  };
}

export function normalizeSettings(raw: unknown): ProjectSettings {
  const cols = raw && typeof raw === 'object' && Array.isArray((raw as ProjectSettings).columns) ? (raw as ProjectSettings).columns : [];
  const clean = [...new Set(cols.filter((c): c is string => typeof c === 'string' && !!c.trim()).map((c) => c.trim()))];
  return { columns: clean.length ? clean : [...DEFAULT_COLUMNS] };
}

export function normalizeTasks(rows: readonly unknown[]): ProjectTask[] {
  const out: ProjectTask[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
    if (!s('id') || !s('cost_centre_id') || !s('title')) continue;
    const rate = num(o.rate);
    out.push({
      id: s('id'),
      cost_centre_id: s('cost_centre_id'),
      title: s('title'),
      column: s('column') || DEFAULT_COLUMNS[0],
      estimate_minutes: Math.max(Math.round(num(o.estimate_minutes)), 0),
      ...(s('assignee_id') ? { assignee_id: s('assignee_id') } : {}),
      ...(rate > 0 ? { rate: round2(rate) } : {}),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(s('due')) ? { due: s('due') } : {}),
      sort: num(o.sort),
      created_at: s('created_at'),
      ...(s('updated_at') ? { updated_at: s('updated_at') } : {}),
    });
  }
  return out;
}

/** Task export rows (header first): hours tracked vs estimate, billed / unbilled. */
export function tasksToRows(
  tasks: readonly ProjectTask[],
  centres: readonly CostCentre[],
  entries: readonly TimeEntry[],
  prefs: TimePrefs,
  live: Set<string>,
  columnLabel: (c: string) => string = (c) => (c === INVOICED ? 'Invoiced' : c),
): (string | number)[][] {
  const name = new Map(centres.map((c) => [c.id, c.name]));
  return [
    ['Project', 'Task', 'Column', 'Estimate (h)', 'Tracked (h)', 'Billable (h)', 'Billed (h)', 'Due', 'Rate'],
    ...[...tasks].sort((a, b) => (name.get(a.cost_centre_id) ?? '').localeCompare(name.get(b.cost_centre_id) ?? '') || bySort(a, b)).map((t) => {
      const rows = taskEntries(t.id, entries);
      const bill = rows.filter((e) => e.billable);
      const billed = bill.filter((e) => isBilled(e.invoiced_in, live, e.id));
      const h = (m: number) => round2(m / 60);
      return [
        name.get(t.cost_centre_id) ?? '', t.title, columnLabel(displayColumn(t, entries, live)), h(t.estimate_minutes), h(trackedMinutes(rows)),
        h(bill.reduce((s, e) => s + billableMinutes(e, prefs), 0)), h(billed.reduce((s, e) => s + billableMinutes(e, prefs), 0)), t.due ?? '', t.rate ?? '',
      ];
    }),
  ];
}

// ── Storage ──────────────────────────────────────────────────────

export const loadTasks = (): ProjectTask[] => normalizeTasks(getTable<unknown>(TASKS_TABLE));
export const loadProjectSettings = (): ProjectSettings => normalizeSettings(getJson<unknown>(PROJECT_SETTINGS_KEY, null));

export function saveProjectSettings(s: ProjectSettings): void {
  requireAccess('books.edit');
  setJson(PROJECT_SETTINGS_KEY, normalizeSettings(s));
}

export function saveTask(input: Omit<ProjectTask, 'id' | 'created_at' | 'sort'> & { id?: string; sort?: number }): ProjectTask {
  requireAccess('books.edit');
  if (!input.title.trim()) throw new Error('Enter a task title.');
  const all = loadTasks();
  const prev = input.id ? all.find((t) => t.id === input.id) : undefined;
  const now = new Date().toISOString();
  const sort = input.sort ?? prev?.sort ?? columnTasks(all, input.cost_centre_id, input.column).length;
  const row = normalizeTasks([{ ...prev, ...input, id: prev?.id ?? generateId(), sort, created_at: prev?.created_at ?? now, ...(prev ? { updated_at: now } : {}) }])[0];
  setTable(TASKS_TABLE, prev ? all.map((t) => (t.id === row.id ? row : t)) : [...all, row]);
  return row;
}

export function saveTasks(rows: readonly ProjectTask[]): void {
  requireAccess('books.edit');
  setTable(TASKS_TABLE, [...rows]);
}

/** A task with logged time cannot be deleted (the time would lose its task). */
export function deleteTask(id: string): void {
  requireAccess('books.edit');
  if (getTable<{ task_id?: string }>('time_entries').some((e) => e?.task_id === id)) {
    throw new Error('Time is logged against this task. Move the time to another task first, or mark the task Done.');
  }
  setTable(TASKS_TABLE, loadTasks().filter((t) => t.id !== id));
}
