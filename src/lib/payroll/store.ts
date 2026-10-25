/**
 * Payroll storage (Phase 7): masters, attendance, runs and payments through getTable/setTable.
 *
 * Every write needs `books.edit` AND `payroll.view` (salaries are confidential: by default only
 * the owner sees payroll — docs/features/payroll.md § Roles), is audited, and — for anything that
 * posts to the ledger (finalized runs, payments) — respects the period lock.
 * Readers are tolerant: malformed rows are skipped. Working papers — verify with your CA.
 */

import { requireAccess } from '../access';
import { audit } from '../audit';
import { num, round2 } from '../invoice-calc';
import { assertUnlocked } from '../period-lock';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { DB_PREFIX, generateId, getJson, getTable, setJson, setTable } from '../storage';
import { localDb } from '../localDb';
import { formatMoney } from '../utils';
import type {
  AttendanceRow,
  AttendanceType,
  Employee,
  EmployeeGroup,
  PayHead,
  PayHeadCalc,
  PayHeadKind,
  PayrollCompany,
  PayrollPayment,
  PayrollPaymentKind,
  PayrollRun,
  PayslipLine,
  SalaryStructure,
  StatutoryKind,
} from '../../types/payroll';
import {
  PAY_KINDS,
  PAYROLL_TABLES,
  day,
  isMonth,
  loadPayrollPayments,
  loadRuns,
  normalizePayments,
  obj,
  opt,
  str,
} from './records';
import { DEFAULT_PAY_HEADS, PayrollComputeError, applyPfAdminMinimum, computePayslip, historyFor, structureFor, structureRates } from './compute';
import { lastDayOfMonth } from './statutory';
import { EMPTY_DEPTH, extrasFor, unpaidLeaveDays, type DepthData } from './depth';
import { loadDepth } from './depth-records';
import { esiPeriodStart, esiRule } from '../payroll-rules';

export { PAYROLL_TABLES, PAY_KINDS, ALL_PAY_KINDS, isMonth, loadPayrollPayments, loadRuns, normalizePayments, normalizeRuns } from './records';
export { historyFor } from './compute';

const now = () => new Date().toISOString();

export class PayrollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayrollError';
  }
}

function guard(): void {
  requireAccess('books.edit');
  requireAccess('payroll.view');
}

/* ── Readers ──────────────────────────────────────────────────── */

export function normalizeEmployees(rows: unknown[]): Employee[] {
  const out: Employee[] = [];
  for (const r of rows) {
    const o = obj(r);
    if (!o || !str(o.id) || !str(o.name)) continue;
    const e: Employee = {
      id: str(o.id),
      code: str(o.code) || str(o.id).slice(0, 6),
      name: str(o.name),
      tax_regime: o.tax_regime === 'old' ? 'old' : 'new',
      pf: o.pf !== false,
      esi: o.esi !== false,
      pt: o.pt !== false,
      active: o.active !== false,
      created_at: str(o.created_at),
    };
    for (const k of ['designation', 'cost_centre_id', 'group_id', 'pan', 'uan', 'esi_no', 'bank_name', 'bank_account', 'bank_ifsc', 'state', 'updated_at'] as const) {
      const v = opt(o[k]);
      if (v) e[k] = v;
    }
    const doj = day(o.doj);
    const dol = day(o.dol);
    if (doj) e.doj = doj;
    if (dol) e.dol = dol;
    if (o.gender === 'M' || o.gender === 'F' || o.gender === 'O') e.gender = o.gender;
    if (o.pf_on_actual === true) e.pf_on_actual = true;
    if (o.eps_excluded === true) e.eps_excluded = true;
    for (const k of ['tax_deductions', 'hra_exemption', 'other_income', 'prev_salary', 'prev_tds'] as const) {
      const n = num(o[k]);
      if (n > 0) e[k] = round2(n);
    }
    const dob = day(o.dob);
    if (dob) e.dob = dob;
    if (num(o.notice_days) > 0) e.notice_days = Math.round(num(o.notice_days));
    out.push(e);
  }
  return out;
}

const KINDS: PayHeadKind[] = ['earning', 'deduction', 'employer'];
const CALCS: PayHeadCalc[] = ['flat', 'attendance', 'percent', 'production', 'computed', 'user'];
const STATS: StatutoryKind[] = ['pf', 'esi', 'pt', 'tds', 'pf_er', 'esi_er', 'pf_admin'];

export function normalizePayHeads(rows: unknown[]): PayHead[] {
  const out: PayHead[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const o = obj(r);
    if (!o || !str(o.id) || !str(o.name) || seen.has(str(o.id))) continue;
    if (!KINDS.includes(o.kind as PayHeadKind) || !CALCS.includes(o.calc as PayHeadCalc)) continue;
    seen.add(str(o.id));
    const h: PayHead = { id: str(o.id), name: str(o.name), kind: o.kind as PayHeadKind, calc: o.calc as PayHeadCalc, active: o.active !== false, created_at: str(o.created_at) };
    if (STATS.includes(o.statutory as StatutoryKind)) h.statutory = o.statutory as StatutoryKind;
    if (Array.isArray(o.base_heads)) h.base_heads = o.base_heads.filter((x): x is string => typeof x === 'string');
    if (o.percent !== undefined) h.percent = num(o.percent);
    if (Array.isArray(o.slabs)) {
      h.slabs = (o.slabs as unknown[]).map(obj).filter((s): s is Record<string, unknown> => !!s).map((s) => ({
        up_to: s.up_to === null || s.up_to === undefined || s.up_to === '' ? null : num(s.up_to),
        value: num(s.value),
        ...(s.percent === true ? { percent: true } : {}),
      }));
    }
    if (str(o.unit_type)) h.unit_type = str(o.unit_type);
    if (o.pf_wage === true) h.pf_wage = true;
    if (o.esi_wage === false) h.esi_wage = false;
    if (o.taxable === false) h.taxable = false;
    if (str(o.account_id)) h.account_id = str(o.account_id);
    if (o.order !== undefined) h.order = num(o.order);
    if (o.nps === true && h.kind === 'employer') h.nps = true;
    if (o.superannuation === true && h.kind === 'employer') h.superannuation = true;
    out.push(h);
  }
  return out;
}

export function normalizeStructures(rows: unknown[]): SalaryStructure[] {
  const out: SalaryStructure[] = [];
  for (const r of rows) {
    const o = obj(r);
    const from = day(o?.effective_from);
    if (!o || !str(o.id) || !from || !Array.isArray(o.lines) || (!str(o.employee_id) && !str(o.group_id))) continue;
    out.push({
      id: str(o.id),
      ...(str(o.employee_id) ? { employee_id: str(o.employee_id) } : { group_id: str(o.group_id) }),
      effective_from: from,
      lines: (o.lines as unknown[]).map(obj).filter((l): l is Record<string, unknown> => !!l && !!str(l.pay_head_id)).map((l) => ({ pay_head_id: str(l.pay_head_id), amount: round2(num(l.amount)) })),
      created_at: str(o.created_at),
      ...(str(o.updated_at) ? { updated_at: str(o.updated_at) } : {}),
    });
  }
  return out;
}

export function normalizeAttendance(rows: unknown[]): AttendanceRow[] {
  const out: AttendanceRow[] = [];
  for (const r of rows) {
    const o = obj(r);
    if (!o || !str(o.id) || !str(o.employee_id) || !isMonth(o.month)) continue;
    const units: Record<string, number> = {};
    const u = obj(o.units);
    if (u) for (const [k, v] of Object.entries(u)) if (num(v) !== 0) units[k] = round2(num(v));
    out.push({ id: str(o.id), employee_id: str(o.employee_id), month: o.month, lop: Math.max(0, round2(num(o.lop))), ...(Object.keys(units).length ? { units } : {}), ...(str(o.updated_at) ? { updated_at: str(o.updated_at) } : {}) });
  }
  return out;
}

const named = (rows: unknown[]) =>
  rows.map(obj).filter((o): o is Record<string, unknown> => !!o && !!str(o.id) && !!str(o.name));

export const loadEmployees = () => normalizeEmployees(getTable<unknown>(PAYROLL_TABLES.employees));
export const loadGroups = (): EmployeeGroup[] => named(getTable<unknown>(PAYROLL_TABLES.groups)).map((o) => ({ id: str(o.id), name: str(o.name), created_at: str(o.created_at) }));
export const loadAttendanceTypes = (): AttendanceType[] =>
  named(getTable<unknown>(PAYROLL_TABLES.attendanceTypes)).map((o) => ({ id: str(o.id), name: str(o.name), unit: str(o.unit), created_at: str(o.created_at) }));
/** Stored pay heads, or the starter set while none has been saved. */
export function loadPayHeads(): PayHead[] {
  const rows = getTable<unknown>(PAYROLL_TABLES.payHeads);
  return rows.length ? normalizePayHeads(rows) : DEFAULT_PAY_HEADS.map((h) => ({ ...h }));
}
export const loadStructures = () => normalizeStructures(getTable<unknown>(PAYROLL_TABLES.structures));
export const loadAttendance = () => normalizeAttendance(getTable<unknown>(PAYROLL_TABLES.attendance));

/* ── Employees ────────────────────────────────────────────────── */

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export type EmployeeInput = Omit<Employee, 'id' | 'created_at' | 'updated_at'> & { id?: string };

export function validateEmployee(input: EmployeeInput, others: readonly Employee[]): string[] {
  const errors: string[] = [];
  if (!str(input.name)) errors.push('Enter the employee’s name.');
  if (!str(input.code)) errors.push('Enter an employee code.');
  else if (others.some((e) => e.id !== input.id && e.code.toLowerCase() === str(input.code).toLowerCase())) errors.push(`Employee code ${str(input.code)} is already used.`);
  const pan = str(input.pan).toUpperCase();
  if (pan && !PAN_RE.test(pan)) errors.push('PAN must look like ABCDE1234F.');
  const uan = str(input.uan);
  if (uan && !/^\d{12}$/.test(uan)) errors.push('UAN is 12 digits.');
  const esi = str(input.esi_no);
  if (esi && !/^\d{10}$/.test(esi)) errors.push('ESI IP number is 10 digits.');
  const ifsc = str(input.bank_ifsc).toUpperCase();
  if (ifsc && !IFSC_RE.test(ifsc)) errors.push('IFSC must look like HDFC0001234.');
  if (input.doj && !day(input.doj)) errors.push('Choose a valid date of joining.');
  if (input.dol && !day(input.dol)) errors.push('Choose a valid date of leaving.');
  if (input.doj && input.dol && input.dol < input.doj) errors.push('The date of leaving is before the date of joining.');
  if (input.dob && !day(input.dob)) errors.push('Choose a valid date of birth.');
  if (input.dob && input.doj && input.dob >= input.doj) errors.push('The date of birth is after the date of joining.');
  return errors;
}

export function saveEmployee(input: EmployeeInput): Employee {
  guard();
  const all = loadEmployees();
  const errors = validateEmployee(input, all);
  if (errors.length) throw new PayrollError(errors[0]);
  const prev = input.id ? all.find((e) => e.id === input.id) : undefined;
  const [row] = normalizeEmployees([
    {
      ...input,
      id: prev?.id ?? generateId(),
      pan: str(input.pan).toUpperCase(),
      bank_ifsc: str(input.bank_ifsc).toUpperCase(),
      created_at: prev?.created_at ?? now(),
      ...(prev ? { updated_at: now() } : {}),
    },
  ]);
  setTable(PAYROLL_TABLES.employees, prev ? all.map((e) => (e.id === row.id ? row : e)) : [...all, row]);
  audit.record({ entity: 'employee', entity_id: row.id, action: prev ? 'update' : 'create', doc_number: row.code, summary: `${prev ? 'Edited' : 'Added'} employee ${row.code} ${row.name}` });
  return row;
}

/** Delete an employee who is on no payroll run (otherwise mark them inactive / set a leaving date). */
export function deleteEmployee(id: string): void {
  guard();
  const all = loadEmployees();
  const row = all.find((e) => e.id === id);
  if (!row) return;
  if (loadRuns().some((r) => r.lines.some((l) => l.employee_id === id))) throw new PayrollError(`${row.name} is on a payroll run; set a date of leaving or mark them inactive instead.`);
  setTable(PAYROLL_TABLES.employees, all.filter((e) => e.id !== id));
  setTable(PAYROLL_TABLES.structures, loadStructures().filter((s) => s.employee_id !== id));
  setTable(PAYROLL_TABLES.attendance, loadAttendance().filter((a) => a.employee_id !== id));
  audit.record({ entity: 'employee', entity_id: id, action: 'delete', doc_number: row.code, summary: `Deleted employee ${row.code} ${row.name}` });
}

/* ── Groups & attendance types ────────────────────────────────── */

export function saveGroup(input: { id?: string; name: string }): EmployeeGroup {
  guard();
  const all = loadGroups();
  const name = str(input.name);
  if (!name) throw new PayrollError('Enter a group name.');
  if (all.some((g) => g.id !== input.id && g.name.toLowerCase() === name.toLowerCase())) throw new PayrollError(`A group called “${name}” already exists.`);
  const prev = input.id ? all.find((g) => g.id === input.id) : undefined;
  const row: EmployeeGroup = { id: prev?.id ?? generateId(), name, created_at: prev?.created_at ?? now() };
  setTable(PAYROLL_TABLES.groups, prev ? all.map((g) => (g.id === row.id ? row : g)) : [...all, row]);
  audit.record({ entity: 'employee', entity_id: row.id, action: prev ? 'update' : 'create', summary: `${prev ? 'Renamed' : 'Added'} employee group “${name}”` });
  return row;
}

export function deleteGroup(id: string): void {
  guard();
  const row = loadGroups().find((g) => g.id === id);
  if (!row) return;
  if (loadEmployees().some((e) => e.group_id === id)) throw new PayrollError(`Employees belong to “${row.name}”; move them first.`);
  setTable(PAYROLL_TABLES.groups, loadGroups().filter((g) => g.id !== id));
  setTable(PAYROLL_TABLES.structures, loadStructures().filter((s) => s.group_id !== id));
  audit.record({ entity: 'employee', entity_id: id, action: 'delete', summary: `Deleted employee group “${row.name}”` });
}

export function saveAttendanceType(input: { id?: string; name: string; unit: string }): AttendanceType {
  guard();
  const all = loadAttendanceTypes();
  const name = str(input.name);
  if (!name) throw new PayrollError('Enter a name for the production type.');
  if (name.toLowerCase() === 'overtime' || all.some((t) => t.id !== input.id && t.name.toLowerCase() === name.toLowerCase())) throw new PayrollError(`“${name}” already exists.`);
  const prev = input.id ? all.find((t) => t.id === input.id) : undefined;
  const row: AttendanceType = { id: prev?.id ?? generateId(), name, unit: str(input.unit) || 'units', created_at: prev?.created_at ?? now() };
  setTable(PAYROLL_TABLES.attendanceTypes, prev ? all.map((t) => (t.id === row.id ? row : t)) : [...all, row]);
  audit.record({ entity: 'employee', entity_id: row.id, action: prev ? 'update' : 'create', summary: `${prev ? 'Edited' : 'Added'} production type “${name}”` });
  return row;
}

export function deleteAttendanceType(id: string): void {
  guard();
  const row = loadAttendanceTypes().find((t) => t.id === id);
  if (!row) return;
  if (loadPayHeads().some((h) => h.unit_type === id)) throw new PayrollError(`A pay head is calculated on “${row.name}”.`);
  setTable(PAYROLL_TABLES.attendanceTypes, loadAttendanceTypes().filter((t) => t.id !== id));
  audit.record({ entity: 'employee', entity_id: id, action: 'delete', summary: `Deleted production type “${row.name}”` });
}

/* ── Pay heads ────────────────────────────────────────────────── */

export type PayHeadInput = Omit<PayHead, 'id' | 'created_at'> & { id?: string };

export function validatePayHead(input: PayHeadInput, all: readonly PayHead[]): string[] {
  const errors: string[] = [];
  const name = str(input.name);
  if (!name) errors.push('Enter a pay head name.');
  else if (all.some((h) => h.id !== input.id && h.name.toLowerCase() === name.toLowerCase())) errors.push(`A pay head called “${name}” already exists.`);
  if ((input.calc === 'percent' || input.calc === 'computed') && !(input.base_heads ?? []).length) errors.push('Choose the pay heads this one is calculated on.');
  if (input.calc === 'percent' && !(num(input.percent) > 0)) errors.push('Enter the percentage.');
  if (input.calc === 'production' && !str(input.unit_type)) errors.push('Choose the production type.');
  if (input.calc === 'computed' && !input.statutory && !(input.slabs ?? []).length) errors.push('Add at least one slab.');
  if ((input.base_heads ?? []).includes(input.id ?? '\u0000')) errors.push('A pay head cannot be calculated on itself.');
  return errors;
}

export function savePayHead(input: PayHeadInput): PayHead {
  guard();
  const all = loadPayHeads();
  const errors = validatePayHead(input, all);
  if (errors.length) throw new PayrollError(errors[0]);
  const prev = input.id ? all.find((h) => h.id === input.id) : undefined;
  if (prev?.statutory && (input.kind !== prev.kind || input.statutory !== prev.statutory)) throw new PayrollError('Statutory pay heads keep their type; rename or deactivate them instead.');
  const [row] = normalizePayHeads([{ ...input, id: prev?.id ?? generateId(), created_at: prev?.created_at || now() }]);
  const next = prev ? all.map((h) => (h.id === row.id ? row : h)) : [...all, row];
  // Refuse loops before saving.
  try {
    for (const h of next) {
      const seen = new Set<string>();
      const walk = (id: string): void => {
        if (seen.has(id)) throw new PayrollComputeError('loop');
        seen.add(id);
        for (const b of next.find((x) => x.id === id)?.base_heads ?? []) walk(b);
        seen.delete(id);
      };
      walk(h.id);
    }
  } catch {
    throw new PayrollError('These pay heads would be calculated on each other in a loop.');
  }
  setTable(PAYROLL_TABLES.payHeads, next);
  audit.record({ entity: 'employee', entity_id: row.id, action: prev ? 'update' : 'create', summary: `${prev ? 'Edited' : 'Added'} pay head “${row.name}” (${row.kind}, ${row.calc})` });
  return row;
}

export function deletePayHead(id: string): void {
  guard();
  const all = loadPayHeads();
  const row = all.find((h) => h.id === id);
  if (!row) return;
  if (row.statutory) throw new PayrollError('Statutory pay heads cannot be deleted; mark them inactive.');
  if (loadStructures().some((s) => s.lines.some((l) => l.pay_head_id === id)) || all.some((h) => h.base_heads?.includes(id))) throw new PayrollError(`“${row.name}” is used in a salary structure or another pay head.`);
  setTable(PAYROLL_TABLES.payHeads, all.filter((h) => h.id !== id));
  audit.record({ entity: 'employee', entity_id: id, action: 'delete', summary: `Deleted pay head “${row.name}”` });
}

/* ── Salary structures ────────────────────────────────────────── */

export type StructureInput = Omit<SalaryStructure, 'id' | 'created_at' | 'updated_at'> & { id?: string };

export function saveStructure(input: StructureInput): SalaryStructure {
  guard();
  const all = loadStructures();
  const heads = new Map(loadPayHeads().map((h) => [h.id, h]));
  if (!!input.employee_id === !!input.group_id) throw new PayrollError('A salary structure belongs to one employee or one group.');
  if (!day(input.effective_from)) throw new PayrollError('Choose the date the structure takes effect.');
  const lines = input.lines.filter((l) => heads.has(l.pay_head_id));
  if (!lines.length) throw new PayrollError('Add at least one pay head.');
  if (lines.some((l) => !Number.isFinite(l.amount) || l.amount < 0)) throw new PayrollError('Amounts must be zero or more.');
  const owner = (s: Pick<SalaryStructure, 'employee_id' | 'group_id'>) => s.employee_id ?? `g:${s.group_id}`;
  const prev = input.id ? all.find((s) => s.id === input.id) : undefined;
  if (all.some((s) => s.id !== prev?.id && owner(s) === owner(input) && s.effective_from === input.effective_from)) throw new PayrollError('There is already a structure from that date; edit it instead.');
  const [row] = normalizeStructures([{ ...input, lines, id: prev?.id ?? generateId(), created_at: prev?.created_at ?? now(), ...(prev ? { updated_at: now() } : {}) }]);
  setTable(PAYROLL_TABLES.structures, prev ? all.map((s) => (s.id === row.id ? row : s)) : [...all, row]);
  const who = row.employee_id ? loadEmployees().find((e) => e.id === row.employee_id)?.name : `group ${loadGroups().find((g) => g.id === row.group_id)?.name ?? ''}`;
  audit.record({ entity: 'employee', entity_id: row.id, action: prev ? 'update' : 'create', summary: `${prev ? 'Edited' : 'Set'} salary structure for ${who ?? 'employee'} from ${row.effective_from}` });
  return row;
}

export function deleteStructure(id: string): void {
  guard();
  const all = loadStructures();
  const row = all.find((s) => s.id === id);
  if (!row) return;
  setTable(PAYROLL_TABLES.structures, all.filter((s) => s.id !== id));
  audit.record({ entity: 'employee', entity_id: id, action: 'delete', summary: `Deleted salary structure from ${row.effective_from}` });
}

/* ── Attendance ───────────────────────────────────────────────── */

export function saveAttendance(month: string, rows: readonly { employee_id: string; lop: number; units?: Record<string, number> }[]): void {
  guard();
  if (!isMonth(month)) throw new PayrollError('Choose a month.');
  const final = loadRuns().find((r) => r.month === month && r.status === 'final');
  if (final) throw new PayrollError(`Payroll for ${month} is finalized; reopen it to change attendance.`);
  const all = loadAttendance();
  const others = all.filter((a) => a.month !== month || !rows.some((r) => r.employee_id === a.employee_id));
  const stamp = now();
  const next = rows.map((r) => {
    const prev = all.find((a) => a.month === month && a.employee_id === r.employee_id);
    return normalizeAttendance([{ id: prev?.id ?? generateId(), employee_id: r.employee_id, month, lop: r.lop, units: r.units, updated_at: stamp }])[0];
  }).filter(Boolean);
  setTable(PAYROLL_TABLES.attendance, [...others, ...next]);
  audit.record({ entity: 'payroll', entity_id: month, action: 'update', summary: `Attendance for ${month} saved (${next.length} employee${next.length === 1 ? '' : 's'})` });
}

/* ── Runs ─────────────────────────────────────────────────────── */

export interface PayrollData {
  employees: Employee[];
  heads: PayHead[];
  structures: SalaryStructure[];
  attendance: AttendanceRow[];
  runs: PayrollRun[];
  /** Additive (7P): arrears, loans, leave, adjustments, perquisites, F&F. Absent = none. */
  depth?: DepthData;
  /** Additive (7T): PT states whose rule adds arrears / one-off salary items to the month's gross. */
  ptExtraStates?: readonly string[];
}

export function loadPayrollData(): PayrollData {
  return { employees: loadEmployees(), heads: loadPayHeads(), structures: loadStructures(), attendance: loadAttendance(), runs: loadRuns(), depth: loadDepth(), ptExtraStates: loadPayrollSettings().pt_extra_states ?? [] };
}

/**
 * ESI coverage for the contribution period holding `month`: decided in its first month (or the month
 * of joining). Undefined when `month` itself is that month (the engine decides on its wages).
 */
export function esiPeriodDecision(e: Employee, month: string, data: Pick<PayrollData, 'heads' | 'structures' | 'runs'>): boolean | undefined {
  const start = esiPeriodStart(month);
  const doj = e.doj?.slice(0, 7);
  const decide = doj && doj > start ? doj : start;
  if (decide >= month) return undefined;
  const hist = data.runs.find((r) => r.status === 'final' && r.month === decide)?.lines.find((l) => l.employee_id === e.id);
  if (hist) return hist.esi_covered;
  const s = structureFor(e, decide, data.structures);
  if (!s) return undefined;
  return structureRates(s, data.heads, decide).esiRateWages <= esiRule(lastDayOfMonth(decide)).wage_ceiling;
}


export interface ComputedRun {
  lines: PayslipLine[];
  /** Employees skipped and why. */
  skipped: string[];
}

/** Pure: compute every active employee's payslip for `month`. `overrides` keyed by employee id. */
export function computeRun(month: string, data: PayrollData, overrides: Record<string, Record<string, number>> = {}): ComputedRun {
  const lines: PayslipLine[] = [];
  const skipped: string[] = [];
  const end = lastDayOfMonth(month);
  const start = `${month}-01`;
  const depth = data.depth ?? EMPTY_DEPTH;
  for (const e of [...data.employees].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))) {
    // 7P: a leaver whose full & final settlement or arrears are paid this month is on the run too.
    const settling = depth.fnf.some((f) => f.employee_id === e.id && f.pay_month === month) || depth.arrears.some((r) => r.employee_id === e.id && r.pay_month === month);
    if (!settling) {
      if (!e.active && !(e.dol && e.dol >= start)) continue;
      if (e.doj && e.doj > end) continue;
      if (e.dol && e.dol < start) continue;
    }
    try {
      const att = data.attendance.find((a) => a.employee_id === e.id && a.month === month) ?? null;
      const unpaid = unpaidLeaveDays(e.id, month, depth.leaveTypes, depth.leaveEntries);
      const line = computePayslip({
        month,
        employee: e,
        structure: structureFor(e, month, data.structures),
        heads: data.heads,
        attendance: unpaid > 0 ? { id: att?.id ?? '', employee_id: e.id, month, lop: round2((att?.lop ?? 0) + unpaid), ...(att?.units ? { units: att.units } : {}) } : att,
        history: historyFor(e.id, month, data.runs),
        overrides: overrides[e.id],
        extras: extrasFor(e, month, depth, data),
        esiPeriodCovered: esiPeriodDecision(e, month, data),
        ...(e.state && data.ptExtraStates?.includes(e.state) ? { ptOnExtras: true } : {}),
      });
      if (line) lines.push(line);
    } catch (err) {
      skipped.push((err as Error).message);
    }
  }
  return { lines: applyPfAdminMinimum(lines, month), skipped };
}

/* ── Employer registration (PF code, ESI code, TAN) ───────────── */

export const PAYROLL_SETTINGS_KEY = `${DB_PREFIX}payroll_settings`;

export interface PayrollSettings {
  pf_code?: string;
  esi_code?: string;
  tan?: string;
  /** Additive (7T): GST state codes whose PT rule charges arrears / one-off salary items with the month. */
  pt_extra_states?: string[];
}

export function loadPayrollSettings(): PayrollSettings {
  const o = obj(getJson<unknown>(PAYROLL_SETTINGS_KEY, {})) ?? {};
  const pt = Array.isArray(o.pt_extra_states) ? (o.pt_extra_states as unknown[]).map(str).filter((x) => /^\d{2}$/.test(x)) : [];
  return { pf_code: opt(o.pf_code), esi_code: opt(o.esi_code), tan: opt(o.tan), ...(pt.length ? { pt_extra_states: pt } : {}) };
}

export function savePayrollSettings(input: PayrollSettings): void {
  guard();
  const tan = str(input.tan).toUpperCase();
  if (tan && !/^[A-Z]{4}\d{5}[A-Z]$/.test(tan)) throw new PayrollError('TAN must look like MUMA12345B.');
  const prev = obj(getJson<unknown>(PAYROLL_SETTINGS_KEY, {})) ?? {};
  setJson(PAYROLL_SETTINGS_KEY, { ...prev, pf_code: str(input.pf_code).toUpperCase(), esi_code: str(input.esi_code), tan });
  audit.record({ entity: 'payroll', entity_id: 'settings', action: 'update', summary: 'Payroll registration numbers (PF / ESI / TAN) updated' });
}

/** Employer snapshot for a run: the active business profile + the payroll registration numbers. */
export function payrollCompany(): PayrollCompany | null {
  const p = localDb.settings.activeProfile();
  const s = loadPayrollSettings();
  if (!p && !s.pf_code && !s.esi_code && !s.tan) return null;
  return {
    companyName: p?.companyName || '',
    ...(p?.companyAddress ? { companyAddress: p.companyAddress } : {}),
    ...(p?.companyGstin ? { companyGstin: p.companyGstin } : {}),
    ...(s.pf_code ? { pf_code: s.pf_code } : {}),
    ...(s.esi_code ? { esi_code: s.esi_code } : {}),
    ...(s.tan ? { tan: s.tan } : {}),
  };
}

function companySnapshot(company?: PayrollCompany | null): PayrollCompany | null {
  return company ?? payrollCompany();
}

const writeRuns = (rows: PayrollRun[]) => setTable(PAYROLL_TABLES.runs, rows);

/**
 * Auto fill: create (or recompute) the draft run for `month` from structures + attendance,
 * keeping amounts typed in the review grid. A finalized month must be reopened first.
 */
export function autoFillRun(month: string, company?: PayrollCompany | null): { run: PayrollRun; skipped: string[] } {
  guard();
  if (!isMonth(month)) throw new PayrollError('Choose a month.');
  const data = loadPayrollData();
  const prev = data.runs.find((r) => r.month === month);
  if (prev?.status === 'final') throw new PayrollError(`Payroll for ${month} is finalized (${prev.number}); reopen it to recompute.`);
  const overrides = Object.fromEntries((prev?.lines ?? []).filter((l) => l.overrides).map((l) => [l.employee_id, l.overrides!]));
  const { lines, skipped } = computeRun(month, data, overrides);
  if (!lines.length) throw new PayrollError(skipped[0] ?? 'No employee is on the rolls for this month.');
  const run: PayrollRun = {
    id: prev?.id ?? generateId(),
    month,
    number: prev?.number ?? '',
    date: prev?.date ?? lastDayOfMonth(month),
    status: 'draft',
    lines,
    company: companySnapshot(company),
    created_at: prev?.created_at ?? now(),
    ...(prev ? { updated_at: now() } : {}),
  };
  writeRuns(prev ? data.runs.map((r) => (r.id === run.id ? run : r)) : [...data.runs, run]);
  audit.record({ entity: 'payroll', entity_id: run.id, action: prev ? 'update' : 'create', summary: `Payroll ${month} ${prev ? 'recomputed' : 'auto-filled'}: ${lines.length} employee${lines.length === 1 ? '' : 's'}, net ₹${formatMoney(lines.reduce((s, l) => s + l.net, 0))}` });
  return { run, skipped };
}

/** Review grid edit: set (or clear with null) one employee's amount for one pay head, then recompute that payslip. */
export function setRunOverride(runId: string, employeeId: string, payHeadId: string, amount: number | null): PayrollRun {
  guard();
  const data = loadPayrollData();
  const run = data.runs.find((r) => r.id === runId);
  if (!run) throw new PayrollError('That payroll run no longer exists.');
  if (run.status === 'final') throw new PayrollError('This payroll is finalized; reopen it to edit.');
  const line = run.lines.find((l) => l.employee_id === employeeId);
  if (!line) throw new PayrollError('That employee is not on this run.');
  const overrides = { ...(line.overrides ?? {}) };
  if (amount === null || !Number.isFinite(amount)) delete overrides[payHeadId];
  else overrides[payHeadId] = round2(amount);
  const all = Object.fromEntries(run.lines.filter((l) => l.overrides).map((l) => [l.employee_id, l.overrides!]));
  all[employeeId] = overrides;
  const { lines } = computeRun(run.month, data, all);
  const keep = new Set(run.lines.map((l) => l.employee_id));
  const next: PayrollRun = { ...run, lines: lines.filter((l) => keep.has(l.employee_id)), updated_at: now() };
  writeRuns(data.runs.map((r) => (r.id === runId ? next : r)));
  return next;
}

export function updateRunDate(runId: string, date: string): PayrollRun {
  guard();
  const runs = loadRuns();
  const run = runs.find((r) => r.id === runId);
  if (!run) throw new PayrollError('That payroll run no longer exists.');
  if (run.status === 'final') throw new PayrollError('This payroll is finalized; reopen it to change the date.');
  if (!day(date)) throw new PayrollError('Choose the voucher date.');
  const next = { ...run, date, updated_at: now() };
  writeRuns(runs.map((r) => (r.id === runId ? next : r)));
  return next;
}

export function runTotals(run: Pick<PayrollRun, 'lines'>) {
  const t = { gross: 0, deductions: 0, net: 0, pf_ee: 0, pf_er: 0, pf_admin: 0, esi_ee: 0, esi_er: 0, pt: 0, tds: 0, employees: run.lines.length };
  // Statutory amounts by kind from the payslip lists, so arrears contributions (7P) are included.
  const byKind = (list: PayslipLine['deductions'], k: StatutoryKind) => list.reduce((s, x) => s + (x.statutory === k ? x.amount : 0), 0);
  for (const l of run.lines) {
    t.gross += l.gross;
    t.deductions += l.total_deductions;
    t.net += l.net;
    t.pf_ee += byKind(l.deductions, 'pf');
    t.pf_er += byKind(l.employer, 'pf_er');
    t.pf_admin += byKind(l.employer, 'pf_admin');
    t.esi_ee += byKind(l.deductions, 'esi');
    t.esi_er += byKind(l.employer, 'esi_er');
    t.pt += l.pt;
    t.tds += l.tds;
  }
  for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] = round2(t[k]);
  return t;
}

/** Finalize: number the Payroll voucher and post it to the ledger (period lock applies). */
export function finalizeRun(runId: string): PayrollRun {
  guard();
  const runs = loadRuns();
  const run = runs.find((r) => r.id === runId);
  if (!run) throw new PayrollError('That payroll run no longer exists.');
  if (run.status === 'final') return run;
  if (!run.lines.length) throw new PayrollError('The run has no employees.');
  const number = run.number || nextSeriesNumberFor('PRL', run.date, runs.map((r) => r.number));
  const lock = assertUnlocked({ id: run.id, issue_date: run.date, invoice_number: number }, 'create');
  const next: PayrollRun = { ...run, number, status: 'final', finalized_at: now(), updated_at: now() };
  writeRuns(runs.map((r) => (r.id === runId ? next : r)));
  recordSeries(number);
  const t = runTotals(next);
  audit.record({ entity: 'payroll', entity_id: run.id, action: 'create', doc_number: number, summary: `Payroll ${run.month} finalized as ${number} dated ${run.date}: gross ₹${formatMoney(t.gross)}, net ₹${formatMoney(t.net)}${lock === 'overridden' ? ' (period lock overridden)' : ''}` });
  return next;
}

/** Reopen a finalized run (back to draft). Refused while payments point at it, or inside the period lock. */
export function reopenRun(runId: string): PayrollRun {
  guard();
  const runs = loadRuns();
  const run = runs.find((r) => r.id === runId);
  if (!run) throw new PayrollError('That payroll run no longer exists.');
  if (run.status !== 'final') return run;
  if (loadPayrollPayments().some((p) => p.run_id === runId)) throw new PayrollError('Salary has been paid against this run; delete those payments first.');
  const lock = assertUnlocked({ id: run.id, issue_date: run.date, invoice_number: run.number }, 'edit');
  const next: PayrollRun = { ...run, status: 'draft', updated_at: now() };
  delete next.finalized_at;
  writeRuns(runs.map((r) => (r.id === runId ? next : r)));
  audit.record({ entity: 'payroll', entity_id: run.id, action: 'update', doc_number: run.number, summary: `Payroll ${run.number} (${run.month}) reopened — removed from the books until finalized again${lock === 'overridden' ? ' (period lock overridden)' : ''}` });
  return next;
}

export function deleteRun(runId: string): void {
  guard();
  const runs = loadRuns();
  const run = runs.find((r) => r.id === runId);
  if (!run) return;
  if (run.status === 'final') throw new PayrollError('Reopen the payroll before deleting it.');
  writeRuns(runs.filter((r) => r.id !== runId));
  audit.record({ entity: 'payroll', entity_id: runId, action: 'delete', doc_number: run.number || undefined, summary: `Draft payroll for ${run.month} deleted` });
}

/* ── Payments ─────────────────────────────────────────────────── */

export const PAYMENT_LABELS: Record<PayrollPaymentKind, string> = {
  salary: 'Salary',
  pf: 'PF (EPFO challan)',
  esi: 'ESI (ESIC challan)',
  pt: 'Professional tax',
  tds: 'TDS on salary (192)',
  loan: 'Loan / advance to employee',
};

export interface PayableBalance {
  kind: PayrollPaymentKind;
  due: number;
  paid: number;
  balance: number;
}

/** What the final runs owe vs what has been paid, per kind (optionally up to a date). */
export function payableBalances(runs: readonly PayrollRun[], payments: readonly PayrollPayment[], asOf?: string): PayableBalance[] {
  const due: Record<PayrollPaymentKind, number> = { salary: 0, pf: 0, esi: 0, pt: 0, tds: 0, loan: 0 };
  for (const r of runs) {
    if (r.status !== 'final' || (asOf && r.date > asOf)) continue;
    const t = runTotals(r);
    due.salary += t.net;
    due.pf += t.pf_ee + t.pf_er + t.pf_admin;
    due.esi += t.esi_ee + t.esi_er;
    due.pt += t.pt;
    due.tds += t.tds;
  }
  return PAY_KINDS.map((kind) => {
    const paid = round2(payments.filter((p) => p.kind === kind && (!asOf || p.date <= asOf)).reduce((s, p) => s + p.amount, 0));
    const d = round2(due[kind]);
    return { kind, due: d, paid, balance: round2(d - paid) };
  });
}

export type PaymentInput = Omit<PayrollPayment, 'id' | 'number' | 'created_at'> & { number?: string };

export function recordPayrollPayment(input: PaymentInput): PayrollPayment {
  guard();
  const all = loadPayrollPayments();
  if (!PAY_KINDS.includes(input.kind) && !(input.kind === 'loan' && input.loan_id)) throw new PayrollError('Choose what is being paid.');
  if (input.kind === 'tds' && (str(input.bsr_code) || str(input.challan_no))) {
    if (!/^\d{7}$/.test(str(input.bsr_code))) throw new PayrollError('BSR code is 7 digits.');
    if (!/^\d{5}$/.test(str(input.challan_no))) throw new PayrollError('Challan serial number is 5 digits.');
  }
  if (!day(input.date)) throw new PayrollError('Choose the payment date.');
  const amount = round2(num(input.amount));
  if (!(amount > 0)) throw new PayrollError('Enter the amount paid.');
  if (input.run_id) {
    const run = loadRuns().find((r) => r.id === input.run_id);
    if (!run || run.status !== 'final') throw new PayrollError('Pay salary against a finalized payroll.');
  }
  const number = str(input.number) || nextSeriesNumberFor('PYP', input.date, all.map((p) => p.number));
  if (all.some((p) => p.number.toLowerCase() === number.toLowerCase())) throw new PayrollError(`Payment number ${number} is already used.`);
  const id = generateId();
  const lock = assertUnlocked({ id, issue_date: input.date, invoice_number: number }, 'create');
  const [row] = normalizePayments([{ ...input, amount, id, number, paid_from: str(input.paid_from) || 'bank', created_at: now() }]);
  setTable(PAYROLL_TABLES.payments, [...all, row]);
  recordSeries(number);
  audit.record({ entity: 'payroll', entity_id: id, action: 'payment_add', doc_number: number, summary: `${PAYMENT_LABELS[row.kind]} paid${row.kind === 'loan' ? '' : ` ₹${formatMoney(amount)}`} on ${row.date} (${number})${row.period ? ` for ${row.period}` : ''}${lock === 'overridden' ? ' (period lock overridden)' : ''}` });
  return row;
}

/** Review H1: a loan disbursement is one employee's amount, so its audit summary leaves the amount out. */
export function deletePayrollPayment(id: string): void {
  guard();
  const all = loadPayrollPayments();
  const row = all.find((p) => p.id === id);
  if (!row) return;
  if (row.kind === 'loan' && row.loan_id && getTable<{ id?: string }>(PAYROLL_TABLES.loans).some((l) => l?.id === row.loan_id)) throw new PayrollError('This payment books a loan; delete the loan instead.');
  const lock = assertUnlocked({ id, issue_date: row.date, invoice_number: row.number }, 'delete');
  setTable(PAYROLL_TABLES.payments, all.filter((p) => p.id !== id));
  audit.record({ entity: 'payroll', entity_id: id, action: 'payment_remove', doc_number: row.number, summary: `${PAYMENT_LABELS[row.kind]} payment ${row.number}${row.kind === 'loan' ? '' : ` (₹${formatMoney(row.amount)})`} deleted${lock === 'overridden' ? ' (period lock overridden)' : ''}` });
}
