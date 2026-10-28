/**
 * CN-C4 RERA designated account (Sec 4(2)(l)(D)): per project and month — collections from allottees (booking
 * receipts and money paid against demands; pass-through collections and no-cash rows excluded), 70% required
 * (`RERA_DEPOSIT_RULES`), deposited (receipts straight into the RERA account + recorded transfers in), withdrawn and
 * the shortfall. Withdrawals (table `rera_withdrawals`, `books.edit`) carry the engineer / architect / CA certificates;
 * the app only warns when cumulative withdrawals pass the deposits or completion % × deposits, or a certificate is
 * missing — nothing is posted. QPR data sheet and the year's statement are CSV / print for the user's own filing.
 * Working paper — verify with your CA (CN25).
 */
import './cn-registry';
import type { RealtyBooking, RealtyProject, RealtyUnit, ReraWithdrawal } from '../../types/construction-r11';
import type { AdvanceRecord } from '../../types/advances';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { generateId } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { toCsv } from '../csv';
import { movedNoCash } from '../advance-tax';
import { RERA_DEPOSIT_RULES } from '../construction-rules';
import { RT, removeRow, rows, upsert } from './cn-realty-projects';
import { demandsOf } from './cn-bookings';

export const loadReraEntries = () => rows<ReraWithdrawal>(RT.rera);
const isDeposit = (e: ReraWithdrawal) => e.kind === 'deposit';

export interface Collection {
  date: string;
  amount: number;
  booking_id: string;
  /** Received straight into the RERA account. */
  intoRera: boolean;
}

/** Money received from allottees of a project (pass-through and no-cash rows excluded; refunds negative). */
export function collections(project: RealtyProject, bookings: readonly RealtyBooking[], advances: readonly AdvanceRecord[], payments: readonly Payment[], invoices: readonly InvoiceRecord[]): Collection[] {
  const ids = new Set(bookings.filter((b) => b.project_id === project.id).map((b) => b.id));
  const into = (acc?: string) => !!project.rera_account_id && acc === project.rera_account_id;
  const out: Collection[] = [];
  for (const a of advances) {
    if (!a.booking_id || !ids.has(a.booking_id) || a.pass_through) continue;
    out.push({ date: a.date, amount: num(a.amount), booking_id: a.booking_id, intoRera: into(a.bank_account_id) });
    for (const r of a.refunds ?? []) out.push({ date: r.date, amount: -num(r.amount), booking_id: a.booking_id, intoRera: into(r.bank_account_id) });
  }
  for (const id of ids) {
    const docs = new Set(demandsOf(id, invoices).map((i) => i.id));
    for (const p of payments) if (docs.has(p.invoice_id) && !movedNoCash(p)) out.push({ date: String(p.date ?? '').slice(0, 10), amount: num(p.amount), booking_id: id, intoRera: into(p.bank_account_id) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface ReraMonth {
  month: string;
  collected: number;
  required: number;
  deposited: number;
  withdrawn: number;
  /** Cumulative 70% required less cumulative deposited (positive = short). */
  shortfall: number;
  balance: number;
}

/** Month-wise statement (cumulative shortfall and RERA balance). */
export function reraStatement(project: RealtyProject, cols: readonly Collection[], entries: readonly ReraWithdrawal[]): ReraMonth[] {
  const own = entries.filter((e) => e.project_id === project.id);
  const months = [...new Set([...cols.map((c) => c.date.slice(0, 7)), ...own.map((e) => e.date.slice(0, 7))])].sort();
  let req = 0, dep = 0, wd = 0;
  return months.map((m) => {
    const inM = <T extends { date: string }>(x: T) => x.date.startsWith(m);
    const collected = round2(cols.filter(inM).reduce((s, c) => s + c.amount, 0));
    const required = round2((collected * ruleAt(RERA_DEPOSIT_RULES, `${m}-01`).pct) / 100);
    const deposited = round2(cols.filter((c) => inM(c) && c.intoRera).reduce((s, c) => s + c.amount, 0) + own.filter((e) => inM(e) && isDeposit(e)).reduce((s, e) => s + num(e.amount), 0));
    const withdrawn = round2(own.filter((e) => inM(e) && !isDeposit(e)).reduce((s, e) => s + num(e.amount), 0));
    req += required; dep += deposited; wd += withdrawn;
    return { month: m, collected, required, deposited, withdrawn, shortfall: round2(Math.max(req - dep, 0)), balance: round2(dep - wd) };
  });
}

export type WithdrawalWarning = 'over_deposits' | 'over_completion' | 'certificates';

/** Checks on a new withdrawal (warnings, never a block). */
export function withdrawalWarnings(project: RealtyProject, cols: readonly Collection[], entries: readonly ReraWithdrawal[], w: Pick<ReraWithdrawal, 'amount' | 'completion_pct' | 'certificates'>): WithdrawalWarning[] {
  const own = entries.filter((e) => e.project_id === project.id);
  const deposits = round2(cols.filter((c) => c.intoRera).reduce((s, c) => s + c.amount, 0) + own.filter(isDeposit).reduce((s, e) => s + num(e.amount), 0));
  const drawn = round2(own.filter((e) => !isDeposit(e)).reduce((s, e) => s + num(e.amount), 0) + num(w.amount));
  const out: WithdrawalWarning[] = [];
  if (drawn > deposits + 0.004) out.push('over_deposits');
  if (drawn > (deposits * Math.min(num(w.completion_pct), 100)) / 100 + 0.004) out.push('over_completion');
  const c = w.certificates;
  if (!c?.engineer?.ref || !c.architect?.ref || !c.ca?.ref) out.push('certificates');
  return out;
}

export function saveReraEntry(e: Omit<ReraWithdrawal, 'id'> & { id?: string }): ReraWithdrawal {
  requireAccess('books.edit');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !(num(e.amount) > 0)) throw new Error('Enter the date and an amount above zero.');
  return upsert(RT.rera, { ...e, id: e.id || generateId(), amount: round2(num(e.amount)) });
}

export function deleteReraEntry(id: string): void {
  requireAccess('books.edit');
  removeRow(RT.rera, id);
}

/** QPR data sheet: per tower units, booked, received, completion; the project's RERA balance and withdrawals. */
export function qprCsv(project: RealtyProject, units: readonly RealtyUnit[], bookings: readonly RealtyBooking[], cols: readonly Collection[], st: readonly ReraMonth[]): string {
  const booked = (u: RealtyUnit) => u.status === 'booked' || u.status === 'registered';
  const last = st.at(-1);
  const withdrawn = round2(st.reduce((s, m) => s + m.withdrawn, 0));
  return toCsv([
    ['Project', 'RERA no.', 'Tower', 'Units', 'Booked / sold', 'Received', '% completion', 'RERA account balance', 'Withdrawals'],
    ...project.towers.map((tw) => {
      const us = units.filter((u) => u.tower_id === tw.id);
      const bk = new Set(bookings.filter((b) => us.some((u) => u.id === b.unit_id)).map((b) => b.id));
      return [project.name, project.rera_no ?? '', tw.name, us.length, us.filter(booked).length, round2(cols.filter((c) => bk.has(c.booking_id)).reduce((s, c) => s + c.amount, 0)), num(tw.completion_pct), last?.balance ?? 0, withdrawn];
    }),
  ]);
}

/** The year's RERA statement (CSV), for the CA's annual audit (Form 5). */
export const statementCsv = (st: readonly ReraMonth[]) =>
  toCsv([['Month', 'Collected', '70% required', 'Deposited', 'Withdrawn', 'Shortfall (cumulative)', 'RERA balance'], ...st.map((m) => [m.month, m.collected, m.required, m.deposited, m.withdrawn, m.shortfall, m.balance])]);
