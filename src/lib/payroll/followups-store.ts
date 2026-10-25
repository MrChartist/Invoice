/**
 * Payroll follow-ups (7T) — writes: relief u/s 89 workings (Form 10E), the actuary's gratuity /
 * leave valuations and their provision journal, and the Professional Tax "arrears with the month"
 * option. Same contract as `store.ts`: every write needs `books.edit` AND `payroll.view`, is
 * audited, and anything that reaches the ledger respects the period lock (the journal goes through
 * `saveVoucher`). Working papers — verify with your CA.
 *
 * The actuarial valuation itself must come from a qualified actuary (AS-15 / Ind AS 19 projected
 * unit credit method); this module only records the actuary's figures and posts the journal.
 */

import { requireAccess } from '../access';
import { audit } from '../audit';
import { num, round2 } from '../invoice-calc';
import { assertUnlocked } from '../period-lock';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { DB_PREFIX, generateId, getJson, setJson, setTable } from '../storage';
import { formatMoney } from '../utils';
import { loadVouchers, saveVoucher } from '../ledger/vouchers';
import { PT_STATES } from '../payroll-rules';
import type { ActuarialValuation, Relief89Record, Relief89Year } from '../../types/payroll';
import { PAYROLL_TABLES, day, obj, str } from './records';
import { PayrollError, loadEmployees } from './store';
import { actuarialCheck, actuarialJournal, relief89 } from './followups';
import { loadActuarial, loadRelief89, normalizeActuarial, normalizeRelief89 } from './followups-records';

export * from './followups-records';

const now = () => new Date().toISOString();
const money = (n: number) => `₹${formatMoney(n)}`;

function guard(): void {
  requireAccess('books.edit');
  requireAccess('payroll.view');
}

const employeeName = (id: string) => {
  const e = loadEmployees().find((x) => x.id === id);
  return e ? `${e.code} ${e.name}` : 'employee';
};

/* ── Relief u/s 89(1) — Form 10E ──────────────────────────────── */

export type Relief89Input = Omit<Relief89Record, 'id' | 'relief' | 'created_at' | 'updated_at'> & { id?: string };

/** Save (or replace) the Form 10E working of an employee for the FY of receipt; the relief is recomputed. */
export function saveRelief89(input: Relief89Input): Relief89Record {
  guard();
  const e = loadEmployees().find((x) => x.id === input.employee_id);
  if (!e) throw new PayrollError('Choose the employee.');
  const fy = Math.trunc(num(input.fy));
  if (!(fy >= 2000 && fy <= 2200)) throw new PayrollError('Choose the financial year of receipt.');
  const years: Relief89Year[] = input.years.filter((y) => num(y.arrears) > 0 || num(y.income) > 0).map((y) => ({ fy: Math.trunc(num(y.fy)), regime: y.regime === 'old' ? 'old' : 'new', income: round2(num(y.income)), arrears: round2(Math.max(0, num(y.arrears))) }));
  if (!years.length) throw new PayrollError('Enter at least one earlier year with the arrears relating to it.');
  if (years.some((y) => !(y.fy < fy) || y.fy < 1990)) throw new PayrollError('Arrears must relate to years before the year of receipt.');
  if (new Set(years.map((y) => y.fy)).size !== years.length) throw new PayrollError('Each earlier year appears once.');
  const incomeWith = round2(num(input.income_with));
  const arrears = round2(years.reduce((s, y) => s + y.arrears, 0));
  if (incomeWith < arrears) throw new PayrollError('Total income of the year of receipt includes the arrears; it cannot be less than them.');
  const result = relief89({ fy, regime: input.regime, income_with: incomeWith, years, dob: e.dob });
  const all = loadRelief89();
  const prev = input.id ? all.find((r) => r.id === input.id) : all.find((r) => r.employee_id === e.id && r.fy === fy);
  const [row] = normalizeRelief89([{ ...input, fy, years, income_with: incomeWith, relief: result.relief, id: prev?.id ?? generateId(), created_at: prev?.created_at ?? now(), ...(prev ? { updated_at: now() } : {}) }]);
  setTable(PAYROLL_TABLES.relief89, prev ? all.map((r) => (r.id === row.id ? row : r)) : [...all, row]);
  audit.record({ entity: 'payroll', entity_id: row.id, action: prev ? 'update' : 'create', summary: `Relief u/s 89 (Form 10E) for ${employeeName(e.id)}, FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}: arrears over ${years.length} year${years.length === 1 ? '' : 's'}${row.apply_tds ? ' — allowed in TDS' : ''}` });
  return row;
}

export function deleteRelief89(id: string): void {
  guard();
  const all = loadRelief89();
  const row = all.find((r) => r.id === id);
  if (!row) return;
  setTable(PAYROLL_TABLES.relief89, all.filter((r) => r.id !== id));
  audit.record({ entity: 'payroll', entity_id: id, action: 'delete', summary: `Relief u/s 89 working for ${employeeName(row.employee_id)} (FY ${row.fy}) deleted` });
}

/* ── Actuarial valuations (AS-15 / Ind AS 19) ─────────────────── */

export type ActuarialInput = Omit<ActuarialValuation, 'id' | 'number' | 'voucher_id' | 'voucher_number' | 'created_at' | 'updated_at'> & { id?: string };

const posted = (v: ActuarialValuation) => !!v.voucher_id && loadVouchers().some((x) => x.id === v.voucher_id);

export function validateActuarial(input: ActuarialInput): string[] {
  const errors: string[] = [];
  if (input.kind !== 'gratuity' && input.kind !== 'leave') errors.push('Choose gratuity or leave encashment.');
  if (!day(input.date)) errors.push('Choose the valuation date.');
  if (!str(input.actuary)) errors.push('Enter the actuary (the valuation must come from a qualified actuary).');
  for (const k of ['opening', 'current_service_cost', 'interest_cost', 'benefits_paid', 'closing'] as const) if (num(input[k]) < 0) errors.push('Obligation figures cannot be negative (an actuarial gain is entered as a negative loss).');
  if (num(input.plan_assets) < 0) errors.push('Plan assets cannot be negative.');
  return [...new Set(errors)];
}

/** Record the actuary's figures (numbered `ACT/FY…`). A valuation whose journal is posted cannot change. */
export function saveActuarial(input: ActuarialInput): ActuarialValuation {
  guard();
  const errors = validateActuarial(input);
  if (errors.length) throw new PayrollError(errors[0]);
  const all = loadActuarial();
  const prev = input.id ? all.find((v) => v.id === input.id) : undefined;
  if (prev && posted(prev)) throw new PayrollError(`The provision journal ${prev.voucher_number ?? ''} is posted; delete it in Books before changing the valuation.`.replace('  ', ' '));
  const id = prev?.id ?? generateId();
  const number = prev?.number || nextSeriesNumberFor('ACT', input.date, all.map((v) => v.number));
  const lock = assertUnlocked({ id, issue_date: input.date, invoice_number: number }, prev ? 'edit' : 'create');
  const [row] = normalizeActuarial([{ ...input, id, number, created_at: prev?.created_at ?? now(), ...(prev ? { updated_at: now() } : {}) }]);
  setTable(PAYROLL_TABLES.actuarial, prev ? all.map((v) => (v.id === id ? row : v)) : [...all, row]);
  if (!prev) recordSeries(number);
  const chk = actuarialCheck(row);
  audit.record({ entity: 'payroll', entity_id: id, action: prev ? 'update' : 'create', doc_number: number, summary: `Actuarial valuation ${number} (${row.kind}, ${row.standard === 'indas19' ? 'Ind AS 19' : 'AS-15'}) as at ${row.date} by ${row.actuary}: closing obligation ${money(row.closing)}${chk.ok ? '' : ` — roll-forward differs by ${money(chk.difference)}`}${lock === 'overridden' ? ' (period lock overridden)' : ''}` });
  return row;
}

export function deleteActuarial(id: string): void {
  guard();
  const all = loadActuarial();
  const row = all.find((v) => v.id === id);
  if (!row) return;
  if (posted(row)) throw new PayrollError(`The provision journal ${row.voucher_number ?? ''} is posted; delete it in Books first.`);
  const lock = assertUnlocked({ id, issue_date: row.date, invoice_number: row.number }, 'delete');
  setTable(PAYROLL_TABLES.actuarial, all.filter((v) => v.id !== id));
  audit.record({ entity: 'payroll', entity_id: id, action: 'delete', doc_number: row.number, summary: `Actuarial valuation ${row.number} (${row.kind}, ${row.date}) deleted${lock === 'overridden' ? ' (period lock overridden)' : ''}` });
}

/**
 * Post the provision journal from a valuation (through `saveVoucher`: period lock, audit, roles):
 * the provision moves from the book balance to closing obligation − plan assets; Ind AS 19
 * gratuity remeasurement goes to Reserves (OCI). Refused while the roll-forward does not add up.
 */
export function postActuarialJournal(id: string) {
  guard();
  const all = loadActuarial();
  const v = all.find((x) => x.id === id);
  if (!v) throw new PayrollError('That valuation no longer exists.');
  if (posted(v)) throw new PayrollError(`Already posted as ${v.voucher_number ?? 'a journal'}.`);
  const chk = actuarialCheck(v);
  if (!chk.ok) throw new PayrollError(`The actuary's figures do not add up: opening + costs − benefits ± actuarial loss = ${money(chk.expected_closing)}, closing ${money(v.closing)}. Check the report.`);
  const j = actuarialJournal(v);
  if (!j.lines.length) throw new PayrollError('The provision in the books already equals the liability — nothing to post.');
  const lines = j.lines.map((l) => {
    const p = Math.round(Math.abs(l.amount) * 100);
    return l.amount > 0 ? { account_id: l.account_id, dr: p, cr: 0 } : { account_id: l.account_id, dr: 0, cr: p };
  });
  const what = v.kind === 'gratuity' ? 'gratuity' : 'leave encashment';
  const voucher = saveVoucher({
    type: 'JOURNAL',
    date: v.date,
    narration: `Provision for ${what} per actuarial valuation ${v.number} as at ${v.date} (${v.standard === 'indas19' ? 'Ind AS 19' : 'AS-15'}; actuary ${v.actuary}${v.report_ref ? `, report ${v.report_ref}` : ''})${j.oci ? ` — remeasurement ${money(j.oci)} to OCI` : ''} — verify with your CA`,
    lines,
    voucher_class: 'Payroll provision',
  });
  setTable(PAYROLL_TABLES.actuarial, all.map((x) => (x.id === id ? { ...x, voucher_id: voucher.id, voucher_number: voucher.number, updated_at: now() } : x)));
  audit.record({ entity: 'payroll', entity_id: id, action: 'update', doc_number: v.number, summary: `Actuarial provision journal ${voucher.number} posted for ${v.number}: provision ${money(j.movement)} (P&L ${money(j.pnl)}${j.oci ? `, OCI ${money(j.oci)}` : ''})` });
  return voucher;
}

/* ── Professional Tax on arrears / one-off items (state rule option) ─ */

const SETTINGS_KEY = `${DB_PREFIX}payroll_settings`;

/** Choose the PT states whose rule charges arrears / one-off salary items with the month they are paid in. */
export function savePtExtraStates(states: readonly string[]): string[] {
  guard();
  const clean = [...new Set(states.map(str).filter((s) => PT_STATES[s]))].sort();
  const prev = obj(getJson<unknown>(SETTINGS_KEY, {})) ?? {};
  setJson(SETTINGS_KEY, { ...prev, pt_extra_states: clean });
  audit.record({ entity: 'payroll', entity_id: 'settings', action: 'update', summary: `Professional tax on arrears / one-off items: ${clean.length ? clean.map((s) => PT_STATES[s]).join(', ') : 'no state'}` });
  return clean;
}
