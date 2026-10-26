/**
 * Timesheet & expense annexure (R3-B4). On billing, the invoice stores a snapshot of every billed time
 * row (date, who, project, task, description, minutes, billed minutes, rate, amount) and re-billed cost,
 * so a later edit to a time entry never changes the paper (Critical Rule 3). Templates print it as a
 * following page ("Annexure to INV/FY26-27/0012"); thermal paper never prints it.
 *
 * The annexure is never rebuilt automatically when lines are edited: `tieOut` shows a mismatch in the
 * editor (never on paper) and "Refresh annexure from billed rows" rebuilds it on request.
 *
 * Pure (tests/annexure.test.ts).
 */
import type { InvoiceItem } from '../types/invoice';
import type { TimeEntry, TimePrefs } from '../types/time';
import type { PurchaseRecord } from '../types/purchases';
import type { AnnexureExpense, AnnexureRow, InvoiceAnnexure } from '../types/service-r3';
import type { CostCentre } from './cost-centres';
import type { ProjectTask } from './projects';
import { billableMinutes, expenseLine, toHours, type BillSelection } from './timesheets';
import { num, round2 } from './invoice-calc';

export interface AnnexureContext {
  tasks: readonly Pick<ProjectTask, 'id' | 'title' | 'assignee_id'>[];
  centres: readonly Pick<CostCentre, 'id' | 'name'>[];
  /** Local user id → display name (task assignees). */
  people?: ReadonlyMap<string, string>;
}

const order = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);

export function annexureRow(e: TimeEntry, prefs: TimePrefs, ctx: AnnexureContext): AnnexureRow {
  const task = e.task_id ? ctx.tasks.find((t) => t.id === e.task_id) : undefined;
  const cc = e.cost_centre_id ? ctx.centres.find((c) => c.id === e.cost_centre_id) : undefined;
  const billed = billableMinutes(e, prefs);
  const who = task?.assignee_id ? ctx.people?.get(task.assignee_id) : undefined;
  const project = (e.project ?? '').trim() || cc?.name || '';
  return {
    date: e.date,
    ...(who ? { who } : {}),
    ...(project ? { project } : {}),
    ...(task ? { task: task.title } : {}),
    description: (e.description ?? '').trim(),
    minutes: Math.max(num(e.minutes), 0),
    billed_minutes: billed,
    rate: round2(num(e.hourly_rate)),
    amount: round2(toHours(billed) * num(e.hourly_rate)),
    ref: e.id,
  };
}

export function annexureExpense(p: PurchaseRecord, prefs: TimePrefs): AnnexureExpense {
  return {
    date: p.date,
    vendor: p.vendor_name ?? '',
    description: [p.category, p.bill_number ? `#${p.bill_number}` : ''].filter(Boolean).join(' ') || 'Expense',
    amount: expenseLine(p, prefs).amount,
    markup_pct: p.pure_agent ? 0 : Math.max(num(p.markup_percent), 0),
    pure_agent: !!p.pure_agent,
    ref: p.id,
  };
}

/** Snapshot of the billed rows (time entries that are billable, and the re-billed costs). */
export function buildAnnexure(sel: Pick<BillSelection, 'time' | 'expenses'>, prefs: TimePrefs, ctx: AnnexureContext, at: string = new Date().toISOString()): InvoiceAnnexure {
  const rows = sel.time.filter((e) => e.billable && billableMinutes(e, prefs) > 0).map((e) => annexureRow(e, prefs, ctx)).sort(order);
  const expenses = sel.expenses.map((p) => annexureExpense(p, prefs)).sort(order);
  return { kind: 'timesheet', rows, ...(expenses.length ? { expenses } : {}), taken_at: at };
}

export interface AnnexureTotals {
  minutes: number;
  billed_minutes: number;
  time_amount: number;
  expense_amount: number;
  total: number;
}

export function annexureTotals(a: InvoiceAnnexure): AnnexureTotals {
  const minutes = a.rows.reduce((s, r) => s + num(r.minutes), 0);
  const billed = a.rows.reduce((s, r) => s + num(r.billed_minutes), 0);
  const time = round2(a.rows.reduce((s, r) => s + num(r.amount), 0));
  const exp = round2((a.expenses ?? []).reduce((s, r) => s + num(r.amount), 0));
  return { minutes, billed_minutes: billed, time_amount: time, expense_amount: exp, total: round2(time + exp) };
}

export interface TieOut {
  ok: boolean;
  /** Billed minutes on the annexure vs hours on the time lines naming its rows. */
  annexure_minutes: number;
  line_minutes: number;
  annexure_amount: number;
  line_amount: number;
  /** Rows no line bills any more / line refs the annexure does not list. */
  missing_rows: number;
  extra_refs: number;
}

/**
 * Do the annexure totals tie to the invoice's time / expense lines? Lines print hours to 2 dp, so up
 * to 0.3 minute per line (and ₹ 0.01 × hours rounding of the amount, under ₹ 1 a line) is rounding,
 * not a mismatch.
 */
export function tieOut(a: InvoiceAnnexure, items: readonly Pick<InvoiceItem, 'bill_refs' | 'quantity' | 'unit' | 'amount'>[]): TieOut {
  const timeRefs = new Set(a.rows.map((r) => r.ref).filter(Boolean) as string[]);
  const expRefs = new Set((a.expenses ?? []).map((r) => r.ref).filter(Boolean) as string[]);
  const timeLines = items.filter((i) => (i.bill_refs ?? []).some((r) => timeRefs.has(r)));
  const expLines = items.filter((i) => (i.bill_refs ?? []).some((r) => expRefs.has(r)));
  const lineRefs = new Set([...timeLines, ...expLines].flatMap((i) => i.bill_refs ?? []));
  const t = annexureTotals(a);
  const lineMinutes = round2(timeLines.reduce((s, i) => s + num(i.quantity) * 60, 0));
  const lineAmount = round2([...timeLines, ...expLines].reduce((s, i) => s + num(i.amount), 0));
  const missing = [...timeRefs, ...expRefs].filter((r) => !lineRefs.has(r)).length;
  const extra = [...lineRefs].filter((r) => !timeRefs.has(r) && !expRefs.has(r)).length;
  const lines = timeLines.length + expLines.length;
  const ok = missing === 0 && extra === 0
    && Math.abs(lineMinutes - t.billed_minutes) <= 0.3 * Math.max(timeLines.length, 1) + 1e-9
    && Math.abs(lineAmount - t.total) <= 1 * Math.max(lines, 1);
  return { ok, annexure_minutes: t.billed_minutes, line_minutes: lineMinutes, annexure_amount: t.total, line_amount: lineAmount, missing_rows: missing, extra_refs: extra };
}

export const ANNEXURE_HEADERS = ['Kind', 'Date', 'Who', 'Project', 'Task', 'Description', 'Minutes', 'Billed hours', 'Rate', 'Markup %', 'Pure agent', 'Amount'] as const;

/** CSV / XLSX rows (header first). */
export function annexureRows(a: InvoiceAnnexure): (string | number)[][] {
  return [
    [...ANNEXURE_HEADERS],
    ...a.rows.map((r) => ['Time', r.date, r.who ?? '', r.project ?? '', r.task ?? '', r.description, num(r.minutes), toHours(r.billed_minutes), num(r.rate), '', '', num(r.amount)]),
    ...(a.expenses ?? []).map((x) => ['Expense', x.date, '', x.vendor, '', x.description, '', '', '', x.markup_pct, x.pure_agent ? 'Yes' : 'No', num(x.amount)]),
  ];
}

/** Ids of the time entries / purchases an invoice's lines bill (for "Refresh annexure from billed rows"). */
export function billedRefs(items: readonly Pick<InvoiceItem, 'bill_refs'>[]): Set<string> {
  return new Set(items.flatMap((i) => i.bill_refs ?? []));
}
