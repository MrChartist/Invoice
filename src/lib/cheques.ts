/**
 * Cheque register & PDC tracking (roadmap 6.26, Tally / Busy style).
 *
 * Received cheques:  received → deposited → cleared | bounced  (bounced → deposited again)
 * Issued cheques:    issued → presented → cleared | cancelled
 *
 * Money moves only through the existing APIs, so the period lock, audit log, invoice status and
 * the ledger all behave exactly as for a payment typed by hand:
 *  - clearing a received cheque linked to an invoice records the payment with
 *    `localDb.payments.record` (method "Cheque", reference = cheque number, date = clearing date);
 *  - a bounce removes that payment again with `localDb.payments.remove` and the party is flagged
 *    (bounces are counted per client and shown at billing — `credit-limit.ts`);
 *  - clearing an issued cheque linked to a bill records a supplier payment (`paymentsDb.record`);
 *    cancelling it removes that payment.
 * If the lock refuses the payment change, the cheque status does not change either.
 *
 * A cheque cannot be deposited / presented / cleared before its date (that is what makes it
 * post-dated), and is valid for three months from its date (RBI).
 */

import type { Cheque, ChequeDirection, ChequeStatus } from '../types/cheques';
import type { Payment } from '../types/invoice';
import { requireAccess } from './access';
import { audit } from './audit';
import { toCsv } from './csv';
import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { localDb } from './localDb';
import { paymentsDb, purchasesDb } from './purchases';
import { generateId, getTable, setTable } from './storage';
import { todayIso } from './tax-rules';
import { isPostDated, validUntil } from './cheque-reminders';
import { receivableBalance } from './rcm';

export { isPostDated, validUntil } from './cheque-reminders';

export const CHEQUES_TABLE = 'cheques';

export const STATUS_LABELS: Record<ChequeStatus, string> = {
  received: 'In hand',
  deposited: 'Deposited',
  presented: 'Presented',
  cleared: 'Cleared',
  bounced: 'Bounced',
  issued: 'Issued',
  cancelled: 'Cancelled',
};

/** Statuses a cheque can move to from where it is now. */
const FLOW: Record<ChequeDirection, Partial<Record<ChequeStatus, ChequeStatus[]>>> = {
  received: {
    received: ['deposited', 'cleared'],
    deposited: ['cleared', 'bounced'],
    bounced: ['deposited'],
    // Returned unpaid after the bank first credited it.
    cleared: ['bounced'],
  },
  issued: {
    issued: ['presented', 'cleared', 'cancelled'],
    presented: ['cleared', 'cancelled'],
  },
};

export function nextStatuses(c: Pick<Cheque, 'direction' | 'status'>): ChequeStatus[] {
  return FLOW[c.direction]?.[c.status] ?? [];
}

export function canTransition(c: Pick<Cheque, 'direction' | 'status'>, to: ChequeStatus): boolean {
  return nextStatuses(c).includes(to);
}

export const initialStatus = (direction: ChequeDirection): ChequeStatus => (direction === 'received' ? 'received' : 'issued');

/* ── Validation ─────────────────────────────────────────────── */

export type ChequeInput = Omit<Cheque, 'id' | 'status' | 'created_at' | 'updated_at'> & { id?: string };

/** Problems with a cheque being added / edited (empty = fine). */
export function validateCheque(input: ChequeInput, existing: readonly Cheque[] = []): string[] {
  const errors: string[] = [];
  const number = String(input.number ?? '').trim();
  if (!/^\d{6}$/.test(number)) errors.push('Cheque numbers are 6 digits (CTS-2010).');
  if (!String(input.bank ?? '').trim()) errors.push('Enter the bank.');
  if (!isoDay(input.cheque_date)) errors.push('Enter the date written on the cheque.');
  if (!(round2(num(input.amount)) > 0)) errors.push('Enter an amount above zero.');
  if (!String(input.party_name ?? '').trim()) errors.push(input.direction === 'issued' ? 'Enter the payee.' : 'Enter who gave the cheque.');
  const bank = String(input.bank ?? '').trim().toLowerCase();
  const dup = existing.find(
    (c) => c.id !== input.id && c.direction === input.direction && c.number === number && c.bank.trim().toLowerCase() === bank && c.status !== 'cancelled',
  );
  if (number && dup) errors.push(`Cheque ${number} of ${dup.bank} is already in the register.`);
  return errors;
}

/** Problems with moving `c` to `to` on `date` (empty = fine). */
export function validateTransition(c: Cheque, to: ChequeStatus, date: string, today: string = todayIso()): string[] {
  const errors: string[] = [];
  if (!canTransition(c, to)) return [`A ${STATUS_LABELS[c.status].toLowerCase()} cheque cannot be marked ${STATUS_LABELS[to].toLowerCase()}.`];
  const day = isoDay(date);
  if (!day) return ['Choose the date.'];
  if (day > today) errors.push('The date cannot be in the future.');
  if ((to === 'deposited' || to === 'presented' || to === 'cleared') && day < c.cheque_date) {
    errors.push(`This cheque is dated ${c.cheque_date}; it cannot be ${to === 'deposited' ? 'deposited' : to} before then.`);
  }
  if (c.direction === 'received' && (to === 'deposited' || to === 'cleared') && c.status !== 'deposited' && day > validUntil(c.cheque_date)) {
    errors.push(`This cheque expired on ${validUntil(c.cheque_date)} (valid for 3 months). Ask the party for a fresh cheque.`);
  }
  if (to === 'bounced' && c.deposited_on && day < c.deposited_on) errors.push('A cheque cannot bounce before it was deposited.');
  return errors;
}

/* ── Storage ────────────────────────────────────────────────── */

export function loadCheques(): Cheque[] {
  return getTable<Cheque>(CHEQUES_TABLE).filter((c) => c && typeof c === 'object' && typeof c.id === 'string');
}

function writeAll(rows: Cheque[]): void {
  setTable(CHEQUES_TABLE, rows);
}

function log(c: Cheque, action: 'create' | 'update' | 'delete', summary: string): void {
  try {
    audit.record({ entity: 'cheque', entity_id: c.id, action, doc_number: c.number, summary });
  } catch {
    /* logging never breaks a save */
  }
}

const money = (n: number) => `₹${round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const describe = (c: Pick<Cheque, 'direction' | 'number' | 'party_name' | 'amount'>) =>
  `Cheque ${c.number} ${c.direction === 'received' ? 'from' : 'to'} ${c.party_name} for ${money(c.amount)}`;

export class ChequeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChequeError';
  }
}

/** Add or edit a cheque's details. Money-relevant fields are frozen once a payment was recorded from it. */
export function saveCheque(input: ChequeInput, now: Date = new Date()): Cheque {
  requireAccess('books.edit'); // local roles (6.21)
  const rows = loadCheques();
  const errors = validateCheque(input, rows);
  if (errors.length) throw new ChequeError(errors[0]);
  const prev = input.id ? rows.find((c) => c.id === input.id) : undefined;
  if (prev && (prev.payment_id || prev.purchase_payment_id)) {
    const changed = prev.amount !== round2(num(input.amount)) || prev.invoice_id !== input.invoice_id || prev.purchase_id !== input.purchase_id;
    if (changed) throw new ChequeError('A payment was recorded from this cheque. Bounce or cancel it before changing the amount or the linked document.');
  }
  if (prev && prev.direction !== input.direction) throw new ChequeError('A cheque cannot switch between received and issued.');
  const stamp = now.toISOString();
  const row: Cheque = {
    ...prev,
    ...input,
    id: prev?.id ?? generateId(),
    number: String(input.number).trim(),
    bank: input.bank.trim(),
    party_name: input.party_name.trim(),
    amount: round2(num(input.amount)),
    status: prev?.status ?? initialStatus(input.direction),
    account_payee: input.direction === 'issued' ? input.account_payee !== false : undefined,
    received_on: prev?.received_on ?? (input.direction === 'received' ? input.received_on || todayIso(now) : undefined),
    created_at: prev?.created_at ?? stamp,
    updated_at: stamp,
  };
  writeAll(prev ? rows.map((c) => (c.id === row.id ? row : c)) : [...rows, row]);
  log(row, prev ? 'update' : 'create', `${prev ? 'Edited' : 'Added'} ${describe(row)}${isPostDated(row, todayIso(now)) ? ` (post-dated ${row.cheque_date})` : ''}`);
  return row;
}

/** Delete a cheque that has no payment recorded from it. */
export function deleteCheque(id: string): void {
  requireAccess('books.edit');
  const rows = loadCheques();
  const c = rows.find((r) => r.id === id);
  if (!c) return;
  if (c.payment_id || c.purchase_payment_id) throw new ChequeError('A payment was recorded from this cheque. Bounce or cancel it first.');
  writeAll(rows.filter((r) => r.id !== id));
  log(c, 'delete', `Deleted ${describe(c)}`);
}

export interface TransitionOptions {
  date: string;
  /** Clearing: record the payment against the linked invoice / bill (default true). */
  recordPayment?: boolean;
  reason?: string;
  today?: string;
}

export interface TransitionResult {
  cheque: Cheque;
  payment?: Payment;
  /** A readable note about what happened to the money (e.g. why no payment was recorded). */
  note?: string;
}

/** Move a cheque along its lifecycle, recording / reversing the linked payment. */
export function transitionCheque(id: string, to: ChequeStatus, opts: TransitionOptions): TransitionResult {
  requireAccess('books.edit');
  const rows = loadCheques();
  const idx = rows.findIndex((c) => c.id === id);
  if (idx < 0) throw new ChequeError('Cheque not found.');
  const c = rows[idx];
  const today = opts.today ?? todayIso();
  const errors = validateTransition(c, to, opts.date, today);
  if (errors.length) throw new ChequeError(errors[0]);
  const date = isoDay(opts.date);
  const next: Cheque = { ...c, status: to, updated_at: new Date().toISOString() };
  let payment: Payment | undefined;
  let note: string | undefined;
  let undo: (() => void) | undefined;

  if (to === 'deposited') next.deposited_on = date;
  if (to === 'presented') next.presented_on = date;

  if (to === 'cleared') {
    next.cleared_on = date;
    if (c.direction === 'received' && !c.deposited_on) next.deposited_on = date;
    if (opts.recordPayment !== false) {
      if (c.direction === 'received' && c.invoice_id && !c.payment_id) {
        const inv = localDb.invoices.getById(c.invoice_id);
        if (!inv) note = 'The linked invoice no longer exists, so no payment was recorded.';
        else if ((inv.currency || 'INR').toUpperCase() !== 'INR') note = `${inv.invoice_number} is in ${inv.currency}: record the receipt from the invoice in that currency.`;
        else {
          const balance = round2(num(receivableBalance(inv)));
          if (c.amount > balance + 0.005) {
            throw new ChequeError(`The cheque (${money(c.amount)}) is more than the balance of ${inv.invoice_number} (${money(balance)}). Unlink the invoice, or clear it without recording the payment.`);
          }
          payment = localDb.payments.record({
            invoiceId: inv.id,
            amount: c.amount,
            method: 'Cheque',
            reference: c.number,
            note: `Cheque ${c.number} · ${c.bank}`,
            date,
          });
          next.payment_id = payment.id;
          const pid = payment.id;
          undo = () => localDb.payments.remove(pid);
          note = `Payment of ${money(c.amount)} recorded against ${inv.invoice_number}.`;
        }
      } else if (c.direction === 'issued' && c.purchase_id && !c.purchase_payment_id) {
        const bill = purchasesDb.get(c.purchase_id);
        if (!bill) note = 'The linked bill no longer exists, so no payment was recorded.';
        else {
          const pp = paymentsDb.record(bill.id, { amount: c.amount, date, method: 'Cheque', reference: c.number });
          next.purchase_payment_id = pp.id;
          undo = () => paymentsDb.remove(pp.id);
          note = `Supplier payment of ${money(c.amount)} recorded against bill ${bill.bill_number || ''}.`.replace(' .', '.');
        }
      }
    }
  }

  if (to === 'bounced') {
    next.bounced_on = date;
    next.bounce_count = (c.bounce_count ?? 0) + 1;
    next.bounce_reason = opts.reason?.trim() || undefined;
    next.cleared_on = undefined;
    if (c.payment_id) {
      // Reverse the receipt (the lock is checked inside; if it refuses, nothing changes).
      localDb.payments.remove(c.payment_id);
      next.payment_id = undefined;
      note = 'The payment recorded from this cheque was reversed; the invoice is open again.';
    }
  }

  if (to === 'cancelled') {
    next.cancelled_on = date;
    next.bounce_reason = opts.reason?.trim() || c.bounce_reason;
    if (c.purchase_payment_id) {
      paymentsDb.remove(c.purchase_payment_id);
      next.purchase_payment_id = undefined;
      note = 'The supplier payment recorded from this cheque was reversed.';
    }
  }

  rows[idx] = next;
  try {
    writeAll(rows);
  } catch (err) {
    // Keep the register and the payments consistent.
    try {
      undo?.();
    } catch {
      /* best effort */
    }
    throw err;
  }
  log(next, 'update', `${describe(next)} marked ${STATUS_LABELS[to].toLowerCase()} on ${date}${next.bounce_reason && to === 'bounced' ? ` (${next.bounce_reason})` : ''}`);
  return { cheque: next, payment, note };
}

/* ── Read models ────────────────────────────────────────────── */

export interface ChequeFilter {
  direction?: ChequeDirection | 'all';
  status?: ChequeStatus | 'open' | 'pdc' | 'all';
  query?: string;
}

const OPEN: ReadonlySet<ChequeStatus> = new Set(['received', 'deposited', 'issued', 'presented']);
export const isOpenCheque = (c: Pick<Cheque, 'status'>) => OPEN.has(c.status);

export function filterCheques(rows: readonly Cheque[], f: ChequeFilter, today: string): Cheque[] {
  const q = (f.query ?? '').trim().toLowerCase();
  return rows
    .filter((c) => !f.direction || f.direction === 'all' || c.direction === f.direction)
    .filter((c) => {
      if (!f.status || f.status === 'all') return true;
      if (f.status === 'open') return isOpenCheque(c);
      if (f.status === 'pdc') return isOpenCheque(c) && isPostDated(c, today);
      return c.status === f.status;
    })
    .filter((c) => !q || [c.number, c.bank, c.party_name, c.notes].some((v) => String(v ?? '').toLowerCase().includes(q)))
    .sort((a, b) => b.cheque_date.localeCompare(a.cheque_date) || b.number.localeCompare(a.number));
}

export interface ChequeSummary {
  inHand: { count: number; amount: number };
  postDatedIn: { count: number; amount: number };
  inClearing: { count: number; amount: number };
  issuedOpen: { count: number; amount: number };
  bounced: { count: number; amount: number };
}

export function chequeSummary(rows: readonly Cheque[], today: string): ChequeSummary {
  const z = () => ({ count: 0, amount: 0 });
  const s: ChequeSummary = { inHand: z(), postDatedIn: z(), inClearing: z(), issuedOpen: z(), bounced: z() };
  const add = (b: { count: number; amount: number }, c: Cheque) => {
    b.count++;
    b.amount = round2(b.amount + c.amount);
  };
  for (const c of rows) {
    if (c.direction === 'received') {
      if (c.status === 'received') add(isPostDated(c, today) ? s.postDatedIn : s.inHand, c);
      else if (c.status === 'deposited') add(s.inClearing, c);
      else if (c.status === 'bounced') add(s.bounced, c);
    } else if (c.status === 'issued' || c.status === 'presented') add(s.issuedOpen, c);
  }
  return s;
}

export function chequesCsv(rows: readonly Cheque[]): string {
  return toCsv([
    ['Cheque register'],
    ['Direction', 'Cheque no.', 'Bank', 'Cheque date', 'Valid till', 'Party', 'Amount', 'Status', 'Deposited / presented', 'Cleared', 'Bounced', 'Bounce reason', 'Notes'],
    ...rows.map((c) => [
      c.direction === 'received' ? 'Received' : 'Issued',
      c.number,
      c.bank,
      c.cheque_date,
      validUntil(c.cheque_date),
      c.party_name,
      c.amount,
      STATUS_LABELS[c.status],
      c.deposited_on ?? c.presented_on ?? '',
      c.cleared_on ?? '',
      c.bounced_on ?? '',
      c.bounce_reason ?? '',
      c.notes ?? '',
    ]),
  ]);
}
