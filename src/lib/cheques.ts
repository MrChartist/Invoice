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
 *
 * WP-5: a cheque may name our bank account (`bank_account_id`; its payments land in that account's
 * ledger), cover several invoices / bills (`allocations` -> one payment per allocation, ids in
 * `payment_ids` / `purchase_payment_ids`; the single `invoice_id` / `purchase_id` link still works),
 * and a bounce can post the bank's charges as a payment voucher (Dr Bank charges or the party | Cr the bank).
 */

import type { Cheque, ChequeAllocation, ChequeDirection, ChequeStatus } from '../types/cheques';
import type { InvoiceRecord, Payment } from '../types/invoice';
import { requireAccess } from './access';
import { audit } from './audit';
import { toCsv } from './csv';
import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { localDb } from './localDb';
import { PAYMENTS_TABLE, PURCHASES_TABLE, paymentsDb, purchasesDb } from './purchases';
import { assertUnlocked } from './period-lock';
import { withTablesRollback } from './table-txn';
import { generateId, getTable, setTable } from './storage';
import { todayIso } from './tax-rules';
import { isPostDated, validUntil } from './cheque-reminders';
import { receivableBalance } from './rcm';
import { DEFAULT_BANK_ID } from './bank-accounts';
import { bankLedgerId } from './bank-ledgers';
import { A } from './ledger/accounts';
import { deleteVoucher, rupeesToPaise, saveVoucher } from './ledger/vouchers';

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
  const allocs = input.allocations ?? [];
  if (allocs.length) {
    const key = input.direction === 'issued' ? 'purchase_id' : 'invoice_id';
    const seen = new Set<string>();
    for (const a of allocs) {
      const doc = String(a[key] ?? '').trim();
      if (!doc) errors.push(input.direction === 'issued' ? 'Choose the bill for every allocation.' : 'Choose the invoice for every allocation.');
      else if (seen.has(doc)) errors.push('The same document appears twice in the allocation.');
      seen.add(doc);
      if (!(round2(num(a.amount)) > 0)) errors.push('Every allocation needs an amount above zero.');
    }
    if (allocatedTotal(allocs) > round2(num(input.amount)) + 0.004) errors.push('The allocations add up to more than the cheque.');
  }
  return [...new Set(errors)];
}

/** Sum of a cheque's allocations (rupees). */
export function allocatedTotal(allocs: readonly ChequeAllocation[] | undefined): number {
  return round2((allocs ?? []).reduce((s, a) => s + round2(num(a.amount)), 0));
}

/** The documents a cheque settles: its allocations, else the single legacy link for the full amount. */
export function chequeAllocations(c: Pick<Cheque, 'direction' | 'amount' | 'invoice_id' | 'purchase_id' | 'allocations'>): ChequeAllocation[] {
  if (c.allocations?.length) return c.allocations;
  if (c.direction === 'received' && c.invoice_id) return [{ invoice_id: c.invoice_id, amount: c.amount }];
  if (c.direction === 'issued' && c.purchase_id) return [{ purchase_id: c.purchase_id, amount: c.amount }];
  return [];
}

const hasPayments = (c: Pick<Cheque, 'payment_id' | 'purchase_payment_id' | 'payment_ids' | 'purchase_payment_ids'>) =>
  !!(c.payment_id || c.purchase_payment_id || c.payment_ids?.length || c.purchase_payment_ids?.length);

function cleanAllocations(allocs: readonly ChequeAllocation[] | undefined, direction: ChequeDirection): ChequeAllocation[] | undefined {
  const out = (allocs ?? [])
    .map((a) => (direction === 'issued' ? { purchase_id: String(a.purchase_id ?? '').trim(), amount: round2(num(a.amount)) } : { invoice_id: String(a.invoice_id ?? '').trim(), amount: round2(num(a.amount)) }))
    .filter((a) => a.amount > 0 && ('invoice_id' in a ? a.invoice_id : a.purchase_id));
  return out.length ? out : undefined;
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

/**
 * The payment a cheque points at is gone (the linked invoice / bill — and with it the payment — was
 * deleted). Such a cheque is treated as having no payment: it can be edited or deleted again.
 */
export function linkedPaymentMissing(
  c: Pick<Cheque, 'payment_id' | 'purchase_payment_id'>,
  payments: readonly { id: string }[] = localDb.payments.getAll(),
  purchasePayments: readonly { id: string }[] = paymentsDb.all(),
): boolean {
  if (c.payment_id) return !payments.some((p) => p.id === c.payment_id);
  if (c.purchase_payment_id) return !purchasePayments.some((p) => p.id === c.purchase_payment_id);
  return false;
}

/** Add or edit a cheque's details. Money-relevant fields are frozen once a payment was recorded from it. */
export function saveCheque(input: ChequeInput, now: Date = new Date()): Cheque {
  requireAccess('books.edit'); // local roles (6.21)
  const rows = loadCheques();
  const errors = validateCheque(input, rows);
  if (errors.length) throw new ChequeError(errors[0]);
  let prev = input.id ? rows.find((c) => c.id === input.id) : undefined;
  // A dangling payment link (its invoice / bill was deleted) no longer freezes anything.
  if (prev && linkedPaymentMissing(prev)) prev = { ...prev, payment_id: undefined, purchase_payment_id: undefined };
  if (prev && hasPayments(prev)) {
    const changed =
      prev.amount !== round2(num(input.amount)) || prev.invoice_id !== input.invoice_id || prev.purchase_id !== input.purchase_id ||
      JSON.stringify(cleanAllocations(prev.allocations, prev.direction) ?? []) !== JSON.stringify(cleanAllocations(input.allocations, input.direction) ?? []) ||
      (prev.bank_account_id || '') !== (input.bank_account_id && input.bank_account_id !== DEFAULT_BANK_ID ? input.bank_account_id : '');
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
    allocations: cleanAllocations(input.allocations, input.direction),
    bank_account_id: input.bank_account_id && input.bank_account_id !== DEFAULT_BANK_ID ? input.bank_account_id : undefined,
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
  // A dangling payment link (its invoice / bill was deleted) no longer blocks the delete.
  const live = linkedPaymentMissing(c) ? { ...c, payment_id: undefined, purchase_payment_id: undefined } : c;
  if (hasPayments(live)) throw new ChequeError('A payment was recorded from this cheque. Bounce or cancel it first.');
  writeAll(rows.filter((r) => r.id !== id));
  log(c, 'delete', `Deleted ${describe(c)}`);
}

export interface TransitionOptions {
  date: string;
  /** Clearing: record the payment against the linked invoice / bill (default true). */
  recordPayment?: boolean;
  reason?: string;
  today?: string;
  /** Bounce: bank charges levied (rupees), posted as a payment voucher from the cheque's bank account. */
  charges?: number;
  /** Bounce charges go to Bank charges (default) or are debited to the party (recoverable). */
  chargesTo?: 'expense' | 'party';
  /** PENDING 39: clearing against a foreign-currency invoice — ₹ per unit the bank paid (default: the invoice rate). */
  realisedRate?: number;
}

/**
 * PENDING 39: the receipt a rupee cheque makes against an invoice. INR: the rupees. Foreign currency: rupees ÷ the
 * realised rate (typed, else the invoice's `exchange_rate`) in the invoice currency, with `realisedRate` = rupees ÷
 * that amount, so the bank gets exactly the cheque's rupees and the difference posts to exchange gain / loss
 * (`fx-gain.ts`). Returns an error message when there is no rate.
 */
export function chequeReceiptFor(inv: Pick<InvoiceRecord, 'invoice_number' | 'currency' | 'exchange_rate'>, rupees: number, rate?: number): { amount: number; realisedRate?: number } | string {
  const cur = (inv.currency || 'INR').toUpperCase();
  if (cur === 'INR') return { amount: round2(num(rupees)) };
  const r = num(rate) > 0 ? num(rate) : num(inv.exchange_rate);
  if (!(r > 0)) return `${inv.invoice_number} is in ${cur} with no exchange rate: enter the rate the bank paid (₹ per ${cur}) to clear it, or record the receipt from the invoice.`;
  const amount = round2(num(rupees) / r);
  if (!(amount > 0)) return `The cheque is too small to settle anything of ${inv.invoice_number}.`;
  return { amount, realisedRate: Math.round((num(rupees) / amount) * 1e6) / 1e6 };
}

export interface TransitionResult {
  cheque: Cheque;
  payment?: Payment;
  /** A readable note about what happened to the money (e.g. why no payment was recorded). */
  note?: string;
}

/**
 * Clearing a cheque with allocations: one payment per invoice / bill, all or nothing (a later failure
 * removes the ones already recorded). Foreign-currency invoices are refused (record those by hand).
 */
function clearAllocations(c: Cheque, date: string, bankAccountId: string | undefined, rate?: number): { ids: string[]; first?: Payment; undo: () => void; note: string } {
  const ids: string[] = [];
  let first: Payment | undefined;
  const undo = () => {
    for (const id of ids) {
      try {
        if (c.direction === 'received') localDb.payments.remove(id);
        else paymentsDb.remove(id);
      } catch {
        /* best effort */
      }
    }
  };
  // Check every document before recording anything.
  for (const a of c.allocations ?? []) {
    if (c.direction === 'received') {
      const inv = a.invoice_id ? localDb.invoices.getById(a.invoice_id) : undefined;
      if (!inv) throw new ChequeError('An invoice in this cheque\'s allocation no longer exists. Edit the cheque first.');
      const fc = chequeReceiptFor(inv, num(a.amount), rate);
      if (typeof fc === 'string') throw new ChequeError(fc);
      const balance = round2(num(receivableBalance(inv)));
      if (fc.amount > balance + 0.005) throw new ChequeError(`${money(a.amount)} is more than the balance of ${inv.invoice_number} (${fc.realisedRate ? `${inv.currency} ${balance.toFixed(2)}` : money(balance)}).`);
    } else {
      const bill = a.purchase_id ? purchasesDb.get(a.purchase_id) : undefined;
      if (!bill) throw new ChequeError('A bill in this cheque\'s allocation no longer exists. Edit the cheque first.');
    }
  }
  try {
    for (const a of c.allocations ?? []) {
      if (c.direction === 'received') {
        const fc = chequeReceiptFor(localDb.invoices.getById(a.invoice_id!)!, num(a.amount), rate) as { amount: number; realisedRate?: number };
        const p = localDb.payments.record({
          invoiceId: a.invoice_id!, amount: fc.amount, ...(fc.realisedRate ? { realisedRate: fc.realisedRate } : {}), method: 'Cheque', reference: c.number,
          note: `Cheque ${c.number} · ${c.bank}`, date, ...(bankAccountId ? { bankAccountId } : {}),
        });
        ids.push(p.id);
        first ??= p;
      } else {
        const pp = paymentsDb.record(a.purchase_id!, { amount: round2(num(a.amount)), date, method: 'Cheque', reference: c.number, ...(bankAccountId ? { bankAccountId } : {}) });
        ids.push(pp.id);
      }
    }
  } catch (err) {
    undo();
    throw err;
  }
  const rest = round2(c.amount - allocatedTotal(c.allocations));
  const what = c.direction === 'received' ? 'invoice' : 'bill';
  const note = `${ids.length} ${what}${ids.length === 1 ? '' : 's'} settled for ${money(allocatedTotal(c.allocations))}${rest > 0.004 ? `; ${money(rest)} is not allocated and recorded no payment` : ''}.`;
  return { ids, first, undo, note };
}

/** Bounce charges: Payment voucher Dr Bank charges (or the party, recoverable) | Cr the cheque's bank ledger. Returns the voucher id. */
function postBounceCharges(c: Cheque, date: string, charges: number, to: 'expense' | 'party'): string {
  const paise = rupeesToPaise(charges);
  const bank = bankLedgerId(c.bank_account_id);
  const debit = to === 'party'
    ? { account_id: c.direction === 'received' ? A.debtors : A.creditors, dr: paise, cr: 0, party: c.party_name }
    : { account_id: A.bankCharges, dr: paise, cr: 0 };
  const v = saveVoucher({
    type: 'PAYMENT',
    date,
    narration: `Bank charges on bounced cheque ${c.number} (${c.party_name})${to === 'party' ? ' — recoverable from the party' : ''}`,
    lines: [debit, { account_id: bank, dr: 0, cr: paise }],
  });
  return v.id;
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
    const bankAccountId = c.bank_account_id && c.bank_account_id !== DEFAULT_BANK_ID ? c.bank_account_id : undefined;
    if (opts.recordPayment !== false && c.allocations?.length && !hasPayments(c)) {
      const r = clearAllocations(c, date, bankAccountId, opts.realisedRate);
      if (c.direction === 'received') next.payment_ids = r.ids;
      else next.purchase_payment_ids = r.ids;
      payment = r.first;
      undo = r.undo;
      note = r.note;
    } else if (opts.recordPayment !== false) {
      if (c.direction === 'received' && c.invoice_id && !c.payment_id) {
        const inv = localDb.invoices.getById(c.invoice_id);
        const fc = inv ? chequeReceiptFor(inv, c.amount, opts.realisedRate) : '';
        if (!inv) note = 'The linked invoice no longer exists, so no payment was recorded.';
        else if (typeof fc === 'string') note = fc;
        else {
          const balance = round2(num(receivableBalance(inv)));
          if (fc.amount > balance + 0.005) {
            const bal = fc.realisedRate ? `${inv.currency} ${balance.toFixed(2)}` : money(balance);
            throw new ChequeError(`The cheque (${money(c.amount)}) is more than the balance of ${inv.invoice_number} (${bal}). Unlink the invoice, or clear it without recording the payment.`);
          }
          payment = localDb.payments.record({
            invoiceId: inv.id,
            amount: fc.amount,
            ...(fc.realisedRate ? { realisedRate: fc.realisedRate } : {}),
            method: 'Cheque',
            reference: c.number,
            note: `Cheque ${c.number} · ${c.bank}`,
            date,
            ...(bankAccountId ? { bankAccountId } : {}),
          });
          next.payment_id = payment.id;
          const pid = payment.id;
          undo = () => localDb.payments.remove(pid);
          note = fc.realisedRate
            ? `Payment of ${inv.currency} ${fc.amount.toFixed(2)} (${money(c.amount)} at ₹${fc.realisedRate}) recorded against ${inv.invoice_number}.`
            : `Payment of ${money(c.amount)} recorded against ${inv.invoice_number}.`;
        }
      } else if (c.direction === 'issued' && c.purchase_id && !c.purchase_payment_id) {
        const bill = purchasesDb.get(c.purchase_id);
        if (!bill) note = 'The linked bill no longer exists, so no payment was recorded.';
        else {
          const pp = paymentsDb.record(bill.id, { amount: c.amount, date, method: 'Cheque', reference: c.number, ...(bankAccountId ? { bankAccountId } : {}) });
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
    // Bank charges first (a new voucher on the bounce date); undone if reversing the receipt is refused.
    const charges = round2(num(opts.charges));
    const chargeVoucher = charges > 0 ? postBounceCharges(c, date, charges, opts.chargesTo ?? 'expense') : undefined;
    if (chargeVoucher) {
      next.bounce_charges = charges;
      next.bounce_voucher_ids = [...(c.bounce_voucher_ids ?? []), chargeVoucher];
      undo = () => deleteVoucher(chargeVoucher);
    }
    try {
      if (c.payment_id) {
        const gone = linkedPaymentMissing(c);
        // Reverse the receipt (the lock is checked inside; if it refuses, nothing changes).
        if (!gone) localDb.payments.remove(c.payment_id);
        next.payment_id = undefined;
        note = gone
          ? 'The payment recorded from this cheque no longer exists (its invoice was deleted), so there was nothing to reverse.'
          : 'The payment recorded from this cheque was reversed; the invoice is open again.';
      }
      if (c.payment_ids?.length) {
        const ids = c.payment_ids;
        // Every receipt or none (M4): check each invoice's lock first, and put back whatever was
        // reversed if a later one is still refused.
        for (const pid of ids) {
          const row = localDb.payments.getAll().find((p) => p.id === pid);
          const inv = row ? localDb.invoices.getById(row.invoice_id) : undefined;
          if (inv) assertUnlocked(inv, 'unpay');
        }
        withTablesRollback(['transactions', 'invoices'], () => {
          for (const pid of ids) localDb.payments.remove(pid);
        });
        next.payment_ids = undefined;
        note = c.payment_ids.length > 1 ? `The ${c.payment_ids.length} payments recorded from this cheque were reversed; the invoices are open again.` : 'The payment recorded from this cheque was reversed; the invoice is open again.';
      }
    } catch (err) {
      undo?.();
      throw err;
    }
    if (chargeVoucher) note = `${note ? `${note} ` : ''}Bank charges of ${money(charges)} posted.`;
  }

  if (to === 'cancelled') {
    next.cancelled_on = date;
    next.bounce_reason = opts.reason?.trim() || c.bounce_reason;
    if (c.purchase_payment_id) {
      const gone = linkedPaymentMissing(c);
      if (!gone) paymentsDb.remove(c.purchase_payment_id);
      next.purchase_payment_id = undefined;
      note = gone ? 'The supplier payment recorded from this cheque no longer exists (its bill was deleted).' : 'The supplier payment recorded from this cheque was reversed.';
    }
    if (c.purchase_payment_ids?.length) {
      const ids = c.purchase_payment_ids;
      // Every supplier payment or none (M4).
      withTablesRollback([PAYMENTS_TABLE, PURCHASES_TABLE], () => {
        for (const pid of ids) paymentsDb.remove(pid);
      });
      next.purchase_payment_ids = undefined;
      note = 'The supplier payments recorded from this cheque were reversed.';
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
