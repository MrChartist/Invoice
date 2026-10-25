/**
 * Bill-wise opening outstandings (WP-1, P0-2): Tally's "Bill-wise Details for: <party>" with
 * Type of Ref = New Ref, entered once when the books begin.
 *
 * Table `opening_bills` (role action `books.edit`):
 *   {id, party_id?, party_name, side: 'receivable' | 'payable', ref_no, date, due_date?,
 *    amount (RUPEES, > 0), dr_cr: 'Dr' | 'Cr', created_at, updated_at?}
 *
 * These bills feed receivables ageing / statements (and, through `openingBillsFor`, the
 * bill-wise payables of WIP-C) exactly like invoices — but they are NEVER documents: they are not
 * in GSTR, revenue, stock or the invoice list. Their ledger effect is the party's opening balance
 * (`ledger_openings`); when a party has bills but no typed opening, the bill total is its opening.
 * A receipt settles an opening bill when its `transactions` row has `invoice_id` = the bill id
 * (and `client_id` / `client_name` for the ledger party) — the hook for P0-11 bill allocation.
 *
 * Pure except load / save (getTable / setTable, fail-soft in Node).
 */

import type { Client } from '../types/invoice';
import { requireAccess } from './access';
import { audit } from './audit';
import { isoDay } from './dates';
import { round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import type { OpeningBillInput } from './receivables';
import { formatMoney } from './utils';
import { assertOpeningsUnlocked, ensureBooksBegin, loadBooksBegin, loadOpenings, signedOpening } from './ledger/openings';

export const OPENING_BILLS_TABLE = 'opening_bills';

export type OpeningBillSide = 'receivable' | 'payable';

export interface OpeningBill {
  id: string;
  /** Client id (receivable) or vendor id (payable). */
  party_id?: string;
  party_name: string;
  side: OpeningBillSide;
  ref_no: string;
  /** Bill date, local YYYY-MM-DD. */
  date: string;
  due_date?: string;
  /** Rupees, > 0. */
  amount: number;
  dr_cr: 'Dr' | 'Cr';
  created_at?: string;
  updated_at?: string;
}

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const day = (v: unknown) => {
  const s = clean(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? s : '';
};

/** Tolerant read of stored rows; malformed ones are skipped. Idempotent. */
export function normalizeOpeningBills(rows: unknown[]): OpeningBill[] {
  const out: OpeningBill[] = [];
  const ids = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = clean(o.id);
    const party_name = clean(o.party_name);
    const side = o.side === 'payable' ? 'payable' : o.side === 'receivable' ? 'receivable' : '';
    const date = day(o.date);
    const amount = round2(Number(o.amount));
    if (!id || ids.has(id) || !party_name || !side || !date || !(amount > 0)) continue;
    ids.add(id);
    const due = day(o.due_date);
    out.push({
      id,
      ...(clean(o.party_id) ? { party_id: clean(o.party_id) } : {}),
      party_name,
      side,
      ref_no: clean(o.ref_no) || id.slice(0, 8),
      date,
      ...(due ? { due_date: due } : {}),
      amount,
      dr_cr: o.dr_cr === 'Cr' ? 'Cr' : o.dr_cr === 'Dr' ? 'Dr' : side === 'payable' ? 'Cr' : 'Dr',
      ...(clean(o.created_at) ? { created_at: clean(o.created_at) } : {}),
      ...(clean(o.updated_at) ? { updated_at: clean(o.updated_at) } : {}),
    });
  }
  return out;
}

export function loadOpeningBills(): OpeningBill[] {
  return normalizeOpeningBills(getTable<unknown>(OPENING_BILLS_TABLE));
}

/** A party's opening bills, oldest first. API shared with WIP-C (bill-wise payables). */
export function openingBillsFor(partyId: string, side?: OpeningBillSide, rows: readonly OpeningBill[] = loadOpeningBills()): OpeningBill[] {
  return rows
    .filter((b) => b.party_id === partyId && (!side || b.side === side))
    .sort((a, b) => a.date.localeCompare(b.date) || a.ref_no.localeCompare(b.ref_no));
}

/** Debit-positive rupees of a set of bills. */
export function billsTotal(bills: readonly Pick<OpeningBill, 'amount' | 'dr_cr'>[]): number {
  return round2(bills.reduce((s, b) => s + (b.dr_cr === 'Dr' ? b.amount : -b.amount), 0));
}

export interface OpeningBillDraft {
  id?: string;
  ref_no: string;
  date: string;
  due_date?: string;
  /** Credit days, used for the due date when `due_date` is empty. */
  credit_days?: number;
  amount: number;
  dr_cr: 'Dr' | 'Cr';
}

function addDays(iso: string, n: number): string {
  const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Problems with a party's bill list (empty = fine). Line numbers are 1-based. */
export function validateOpeningBills(bills: readonly OpeningBillDraft[]): string[] {
  const errors: string[] = [];
  const refs = new Set<string>();
  bills.forEach((b, i) => {
    const n = i + 1;
    const ref = clean(b.ref_no).toLowerCase();
    if (!ref) errors.push(`Bill ${n}: enter the bill reference.`);
    else if (refs.has(ref)) errors.push(`Bill ${n}: reference ${b.ref_no} is used twice.`);
    refs.add(ref);
    if (!day(b.date)) errors.push(`Bill ${n}: choose the bill date.`);
    if (b.due_date && !day(b.due_date)) errors.push(`Bill ${n}: the due date is not a valid date.`);
    else if (b.due_date && day(b.date) && b.due_date < b.date) errors.push(`Bill ${n}: the due date is before the bill date.`);
    if (!(round2(Number(b.amount)) > 0)) errors.push(`Bill ${n}: enter an amount above zero.`);
  });
  return errors;
}

/**
 * Replace every opening bill of one party (Tally saves the bill-wise screen as a whole). Audited.
 * Returns the party's stored bills.
 */
export function saveOpeningBillsFor(party: { id: string; name: string; side: OpeningBillSide }, drafts: readonly OpeningBillDraft[]): OpeningBill[] {
  requireAccess('books.edit');
  const errors = validateOpeningBills(drafts);
  if (errors.length) throw new Error(errors[0]);
  // Opening outstandings post with the openings, on the day before the books begin (M2).
  const lock = assertOpeningsUnlocked();
  const all = loadOpeningBills();
  const mine = all.filter((b) => b.party_id === party.id && b.side === party.side);
  const prevById = new Map(mine.map((b) => [b.id, b]));
  const now = new Date().toISOString();
  const next: OpeningBill[] = drafts.map((d) => {
    const prev = d.id ? prevById.get(d.id) : undefined;
    const due = day(d.due_date) || (d.credit_days && d.credit_days > 0 ? addDays(d.date, Math.round(d.credit_days)) : '');
    return {
      id: prev?.id ?? generateId(),
      party_id: party.id,
      party_name: party.name.trim(),
      side: party.side,
      ref_no: clean(d.ref_no),
      date: d.date,
      ...(due ? { due_date: due } : {}),
      amount: round2(Number(d.amount)),
      dr_cr: d.dr_cr === 'Cr' ? 'Cr' : 'Dr',
      created_at: prev?.created_at ?? now,
      ...(prev ? { updated_at: now } : {}),
    };
  });
  ensureBooksBegin();
  setTable(OPENING_BILLS_TABLE, [...all.filter((b) => !(b.party_id === party.id && b.side === party.side)), ...next]);
  const total = billsTotal(next);
  audit.record({
    entity: party.side === 'receivable' ? 'client' : 'purchase',
    entity_id: party.id,
    action: 'update',
    doc_number: party.name,
    summary: `Opening bills for ${party.name}: ${next.length} bill${next.length === 1 ? '' : 's'}, ₹${formatMoney(Math.abs(total))} ${total >= 0 ? 'Dr' : 'Cr'}${lock === 'overridden' ? ' (period lock overridden)' : ''}`,
  });
  return next;
}

/**
 * Bills for `buildReceivables` (INR): every receivable opening bill, plus an "On Account" line for
 * each client whose typed opening balance (`openings`, debit-positive PAISE by party ledger id)
 * differs from its bill total — so receivables agree with the ledger's party balance.
 */
export function receivableOpeningBills(
  bills: readonly OpeningBill[],
  openings: ReadonlyMap<string, number>,
  clients: readonly Pick<Client, 'id' | 'name'>[],
  booksBegin: string,
): OpeningBillInput[] {
  const out: OpeningBillInput[] = [];
  const recv = bills.filter((b) => b.side === 'receivable');
  for (const b of recv) {
    out.push({ id: b.id, party_id: b.party_id, party_name: b.party_name, ref_no: b.ref_no, date: b.date, due_date: b.due_date ?? b.date, amount: b.amount, dr_cr: b.dr_cr });
  }
  const onAccountDate = booksBegin ? addDays(booksBegin, -1) : '';
  for (const c of clients) {
    if (!c.id) continue;
    const typed = openings.get(`party:debtor:${c.id}`);
    if (typed === undefined) continue;
    const residual = round2(typed / 100 - billsTotal(recv.filter((b) => b.party_id === c.id)));
    if (Math.abs(residual) < 0.005) continue;
    out.push({
      id: `onacc:${c.id}`,
      party_id: c.id,
      party_name: c.name,
      ref_no: 'On Account',
      date: onAccountDate,
      due_date: onAccountDate,
      amount: Math.abs(residual),
      dr_cr: residual > 0 ? 'Dr' : 'Cr',
      on_account: true,
    });
  }
  return out;
}

/** `receivableOpeningBills` from storage (for the Receivables page). */
export function loadReceivableOpeningBills(clients: readonly Pick<Client, 'id' | 'name'>[], today: string = isoDay(new Date())): OpeningBillInput[] {
  const openings = new Map(loadOpenings().map((o) => [o.ledger_id, signedOpening(o)]));
  const bills = loadOpeningBills();
  if (!bills.length && !openings.size) return [];
  return receivableOpeningBills(bills, openings, clients, loadBooksBegin(today));
}
