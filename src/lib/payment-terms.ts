/**
 * Payment terms master (Round 2, R2-A1 — Odoo payment terms, Refrens EarlyPay, Zoho / QBO terms).
 *
 * Named terms of four kinds: `net` (issue date + N days), `eom` (end of the issue month + N days),
 * `day_next_month` (day D of the next month) and `instalments` (rows of % + an offset, % adding up to 100,
 * the last row takes the rounding remainder), each with an optional early-payment discount (% within N days).
 *
 * Built on the 8G payment schedule (`src/lib/payment-schedule.ts`): picking a term on a document fills its
 * `payment_schedule` (instalment terms) and its `due_date` (the final date); `payment_terms` keeps the term's
 * name and the early-pay offer as issued. Reminders and ageing already follow the earliest unpaid instalment
 * (`effectiveDueDate`), so nothing else changes. Editing the master never changes a saved document.
 *
 * Table `payment_terms` (rows, backed up and synced). Until the first save the starter set is used (never
 * stored), like the payroll pay heads. Bare dates are local days (Critical Rule 8).
 */
import type { Client, InvoiceRecord, PaymentInstalment, PaymentTermsSnapshot, SenderProfile } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { localDayOf } from './dates';
import { instalmentAmounts } from './payment-schedule';

export const PAYMENT_TERMS_TABLE = 'payment_terms';

export type TermKind = 'net' | 'eom' | 'day_next_month' | 'instalments';
export const TERM_KINDS: readonly TermKind[] = ['net', 'eom', 'day_next_month', 'instalments'];
export type OffsetKind = 'days' | 'eom' | 'day_next_month';

export interface TermInstalment {
  label?: string;
  percent: number;
  offset_kind: OffsetKind;
  /** Days (days / eom) or the day of the month (day_next_month). */
  offset: number;
}

export interface PaymentTerm {
  id: string;
  name: string;
  kind: TermKind;
  /** `net` / `eom`: days. */
  days?: number;
  /** `day_next_month`: day of the month (1–31; clamped to the month's length). */
  day?: number;
  instalments?: TermInstalment[];
  early_discount?: { percent: number; days: number };
  /** Deactivated terms stay on saved documents but are not offered. */
  inactive?: boolean;
  created_at?: string;
  updated_at?: string;
}

export const STARTER_TERMS: readonly PaymentTerm[] = [
  { id: 'pt_receipt', name: 'Due on receipt', kind: 'net', days: 0 },
  { id: 'pt_net7', name: 'Net 7', kind: 'net', days: 7 },
  { id: 'pt_net15', name: 'Net 15', kind: 'net', days: 15 },
  { id: 'pt_net30', name: 'Net 30', kind: 'net', days: 30 },
  { id: 'pt_net45', name: 'Net 45', kind: 'net', days: 45 },
  { id: 'pt_eom30', name: 'EOM + 30', kind: 'eom', days: 30 },
];

/* ── Dates ─────────────────────────────────────────────────────── */

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return [y, (m || 1) - 1, d || 1];
}
const lastDayOf = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** Due day for one offset from `issue` (local days). */
export function offsetDate(issue: string, kind: OffsetKind, n: number): string {
  const [y, m, d] = parts(issue);
  const k = Math.max(0, Math.round(num(n)));
  if (kind === 'eom') return localDayOf(new Date(y, m, lastDayOf(y, m) + k));
  if (kind === 'day_next_month') {
    const ny = m === 11 ? y + 1 : y;
    const nm = (m + 1) % 12;
    return localDayOf(new Date(ny, nm, Math.min(Math.max(k, 1), lastDayOf(ny, nm))));
  }
  return localDayOf(new Date(y, m, d + k));
}

/** The instalment rows of a term (a single row for the simple kinds). */
export function termRows(term: PaymentTerm): TermInstalment[] {
  if (term.kind === 'instalments') return term.instalments ?? [];
  if (term.kind === 'eom') return [{ percent: 100, offset_kind: 'eom', offset: num(term.days) }];
  if (term.kind === 'day_next_month') return [{ percent: 100, offset_kind: 'day_next_month', offset: num(term.day) || 1 }];
  return [{ percent: 100, offset_kind: 'days', offset: num(term.days) }];
}

/** Problems with a term before saving (empty = fine). */
export function termIssues(term: PaymentTerm): string[] {
  const out: string[] = [];
  if (!term.name?.trim()) out.push('Give the term a name.');
  if (!TERM_KINDS.includes(term.kind)) out.push('Pick a kind of term.');
  if ((term.kind === 'net' || term.kind === 'eom') && !(num(term.days) >= 0)) out.push('Days cannot be negative.');
  if (term.kind === 'day_next_month' && !(num(term.day) >= 1 && num(term.day) <= 31)) out.push('Pick a day of the month from 1 to 31.');
  if (term.kind === 'instalments') {
    const rows = term.instalments ?? [];
    if (rows.length < 2) out.push('An instalment term needs at least two rows.');
    if (rows.some((r) => !(num(r.percent) > 0))) out.push('Every instalment needs a percent above zero.');
    if (Math.abs(rows.reduce((s, r) => s + num(r.percent), 0) - 100) > 0.001) out.push('The instalment percents must add up to 100.');
  }
  if (term.early_discount) {
    const e = term.early_discount;
    if (!(num(e.percent) > 0 && num(e.percent) < 100)) out.push('The early-payment discount must be between 0 and 100%.');
    if (!(num(e.days) >= 0)) out.push('Early-payment days cannot be negative.');
  }
  return out;
}

export interface ResolvedTerms {
  /** Final due date (the last instalment). */
  due_date: string;
  /** 8G schedule rows (only for instalment terms; a single due date needs none). */
  schedule: PaymentInstalment[];
  snapshot: PaymentTermsSnapshot;
  /** Amounts of every row (the last takes the rounding remainder), for display. */
  amounts: number[];
}

/**
 * Work a term out for a document issued on `issueDate` with receivable `total`. Instalments are sorted by
 * date; the early discount is `percent` of the total, payable by issue + `days`.
 */
export function resolveTerms(term: PaymentTerm, issueDate: string, total: number): ResolvedTerms {
  const rows = termRows(term)
    .map((r, i) => ({ r, i, due: offsetDate(issueDate, r.offset_kind, r.offset) }))
    .sort((a, b) => a.due.localeCompare(b.due) || a.i - b.i);
  const schedule: PaymentInstalment[] = rows.length > 1
    ? rows.map(({ r, due }, i) => ({ id: generateId(), label: r.label?.trim() || `Instalment ${i + 1} of ${rows.length}`, due_date: due, percent: round2(num(r.percent)) }))
    : [];
  const amounts = rows.length > 1 ? instalmentAmounts(schedule, total) : [round2(total)];
  const due_date = rows.length ? rows[rows.length - 1].due : issueDate;
  const snapshot: PaymentTermsSnapshot = { id: term.id, name: term.name.trim() };
  const e = term.early_discount;
  if (e && num(e.percent) > 0) {
    snapshot.early_discount = { percent: num(e.percent), until: offsetDate(issueDate, 'days', num(e.days)), amount: round2((total * num(e.percent)) / 100) };
  }
  return { due_date, schedule, snapshot, amounts };
}

/** The term a new document for `client` pre-selects: the client's term, if it exists and is active. */
export function defaultTermFor(client: Pick<Client, 'payment_terms_id'> | null | undefined, terms: readonly PaymentTerm[]): PaymentTerm | null {
  const id = client?.payment_terms_id;
  const t = id ? terms.find((x) => x.id === id && !x.inactive) : undefined;
  return t ?? null;
}

/** Apply a term to a document: the patch the editor sets (due date, schedule, snapshot). */
export function termPatch(term: PaymentTerm, doc: Pick<InvoiceRecord, 'issue_date' | 'total' | 'tds_amount'>): Pick<InvoiceRecord, 'due_date' | 'payment_schedule' | 'payment_terms'> {
  const total = round2(num(doc.total) - num(doc.tds_amount));
  const r = resolveTerms(term, doc.issue_date, total);
  return { due_date: r.due_date, payment_schedule: r.schedule.length ? r.schedule : undefined, payment_terms: r.snapshot };
}

/**
 * MSME 45-day note (Sec 43B(h)): the seller records an Udyam number and the final due date is more than 45
 * days after the issue date — a business buyer's deduction may be disallowed. Non-blocking; verify with your CA.
 */
export function msmeNote(sender: Pick<SenderProfile, 'msme_udyam'> | null | undefined, issueDate: string, dueDate: string, buyerGstin?: string): boolean {
  if (!sender?.msme_udyam?.trim() || !issueDate || !dueDate) return false;
  if (buyerGstin !== undefined && !buyerGstin.trim()) return false;
  const [y1, m1, d1] = parts(issueDate);
  const [y2, m2, d2] = parts(dueDate);
  const days = Math.round((Date.UTC(y2, m2, d2) - Date.UTC(y1, m1, d1)) / 86400000);
  return days > 45;
}

/** "Instalment 2 of 3 · ₹ 35,000 · due 12 Dec 2026" lines and the early-pay offer are printed from the snapshot. */
export function describeTerm(term: PaymentTerm): string {
  const rows = termRows(term);
  const one = (r: TermInstalment) =>
    r.offset_kind === 'eom' ? `end of month + ${r.offset} days` : r.offset_kind === 'day_next_month' ? `day ${r.offset} of next month` : r.offset ? `${r.offset} days` : 'on receipt';
  const base = rows.length > 1 ? rows.map((r) => `${r.percent}% ${one(r)}`).join(', ') : one(rows[0] ?? { percent: 100, offset_kind: 'days', offset: 0 });
  const e = term.early_discount;
  return e ? `${base}; ${e.percent}% off if paid within ${e.days} days` : base;
}

/* ── Storage ───────────────────────────────────────────────────── */

/** The master: stored rows, or the starter set until the first save. */
export function loadPaymentTerms(): PaymentTerm[] {
  const rows = getTable<PaymentTerm>(PAYMENT_TERMS_TABLE).filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string');
  return rows.length ? rows : STARTER_TERMS.map((t) => ({ ...t }));
}

/** Create or update a term (masters: `master.edit`). The first save also stores the starter set. */
export function savePaymentTerm(term: PaymentTerm): PaymentTerm {
  requireAccess('master.edit');
  const issues = termIssues(term);
  if (issues.length) throw new Error(issues.join(' '));
  const all = loadPaymentTerms();
  const now = new Date().toISOString();
  const row: PaymentTerm = { ...term, name: term.name.trim(), id: term.id || generateId(), updated_at: now, created_at: term.created_at ?? now };
  if (row.kind !== 'instalments') delete row.instalments;
  const clash = all.find((t) => t.id !== row.id && t.name.trim().toLowerCase() === row.name.toLowerCase());
  if (clash) throw new Error(`A term named "${row.name}" already exists.`);
  const i = all.findIndex((t) => t.id === row.id);
  setTable(PAYMENT_TERMS_TABLE, i >= 0 ? all.map((t) => (t.id === row.id ? row : t)) : [...all, row]);
  return row;
}

/** Deactivate / reactivate (terms are never deleted: saved documents and clients point at them). */
export function setTermActive(id: string, active: boolean): void {
  requireAccess('master.edit');
  const all = loadPaymentTerms();
  setTable(PAYMENT_TERMS_TABLE, all.map((t) => (t.id === id ? { ...t, inactive: active ? undefined : true, updated_at: new Date().toISOString() } : t)));
}
