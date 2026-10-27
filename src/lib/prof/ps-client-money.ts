/**
 * R14 PS-B3 client money (trust / escrow) — the vouchers and the balances (pure). Money a client deposits for expenses
 * is held for the client, not the firm's: it is recorded as `client_money` vouchers (CMV/FY…), never as `transactions`
 * rows, in a bank account marked `client_money` (`isClientMoneyAccount`). Balances are kept per client and per matter;
 * none may go negative. BCI Rules 25–28 (accounts of client money, fees vs expenses, copy on request) and the CA Act
 * (separate account) are cited, not interpreted. Working paper — verify with your CA (PS10, PS27, PS32).
 */
import { num, round2 } from '../invoice-calc';
import { isoDay } from '../dates';
import { PS_SERIES, PS_TABLES } from './ps-shared';
import { getTable } from '../storage';

export const CLIENT_MONEY_TABLE = PS_TABLES.clientMoney;
export const CMV_SERIES = PS_SERIES.clientMoney;

export type CmKind = 'receipt' | 'payment' | 'to_fees' | 'refund' | 'transfer' | 'interest';
export const CM_KINDS: readonly CmKind[] = ['receipt', 'payment', 'to_fees', 'refund', 'transfer', 'interest'];
export type CmPurpose = 'expenses' | 'fees' | 'other';

export interface CmAuthority {
  date: string;
  mode: 'written' | 'email' | 'engagement';
  ref: string;
}

export interface ClientMoneyVoucher {
  id: string;
  number: string;
  date: string;
  kind: CmKind;
  /** Whose money (for a transfer: the client it leaves). Absent only on interest that belongs to the firm. */
  client_id: string;
  matter_id?: string;
  /** Transfer: the client / matter it goes to. */
  to_client_id?: string;
  to_matter_id?: string;
  amount: number;
  bank_account_id: string;
  purpose: CmPurpose;
  ref: string;
  narration: string;
  /** to_fees: the issued invoice it settles, and the office-bank receipt made for it. */
  invoice_id?: string;
  payment_id?: string;
  office_bank_id?: string;
  authority?: CmAuthority;
  /** Interest: credited to the client (default) or to the firm. */
  interest_to?: 'client' | 'firm';
  /** Owner override of a missing authority (audited). */
  override_reason?: string;
  voucher_ids: string[];
  created_at?: string;
}

/** Signed effect of a voucher on a client's balance (+ held more). Interest to the firm moves no client's balance. */
export function cmEffects(v: Pick<ClientMoneyVoucher, 'kind' | 'client_id' | 'matter_id' | 'to_client_id' | 'to_matter_id' | 'amount' | 'interest_to'>): { client: string; matter: string; amount: number }[] {
  const a = round2(num(v.amount));
  const own = { client: v.client_id, matter: v.matter_id ?? '' };
  switch (v.kind) {
    case 'receipt': return [{ ...own, amount: a }];
    case 'interest': return v.interest_to === 'firm' ? [] : [{ ...own, amount: a }];
    case 'transfer': return [{ ...own, amount: -a }, { client: v.to_client_id ?? '', matter: v.to_matter_id ?? '', amount: a }];
    default: return [{ ...own, amount: -a }];
  }
}

const ordered = (rows: readonly ClientMoneyVoucher[]) => [...rows].sort((a, b) => a.date.localeCompare(b.date) || (a.number ?? '').localeCompare(b.number ?? ''));

export interface CmBalance {
  client: string;
  matter: string;
  balance: number;
}

/** Balances by client and matter on `upto` (inclusive; absent = all). */
export function cmBalances(rows: readonly ClientMoneyVoucher[], upto?: string): CmBalance[] {
  const map = new Map<string, CmBalance>();
  for (const v of rows) {
    if (upto && v.date > upto) continue;
    for (const e of cmEffects(v)) {
      const k = `${e.client}|${e.matter}`;
      const b = map.get(k) ?? { client: e.client, matter: e.matter, balance: 0 };
      b.balance = round2(b.balance + e.amount);
      map.set(k, b);
    }
  }
  return [...map.values()].filter((b) => Math.abs(b.balance) > 0.004);
}

/** A client's total held (all matters). */
export const clientHeld = (rows: readonly ClientMoneyVoucher[], clientId: string, upto?: string): number =>
  round2(cmBalances(rows, upto).filter((b) => b.client === clientId).reduce((s, b) => s + b.balance, 0));

/** Σ every client's balance (three-way reconciliation, side 3). */
export const totalHeld = (rows: readonly ClientMoneyVoucher[], upto?: string): number => round2(cmBalances(rows, upto).reduce((s, b) => s + b.balance, 0));

/**
 * The first client / matter that goes negative at any date if `rows` stand (walked in date order), or null. A matter
 * balance is checked only where the voucher names the matter; the client total always.
 */
export function negativeBalance(rows: readonly ClientMoneyVoucher[]): { client: string; matter: string; date: string; balance: number } | null {
  const client = new Map<string, number>();
  const matter = new Map<string, number>();
  for (const v of ordered(rows)) {
    for (const e of cmEffects(v)) {
      const c = round2((client.get(e.client) ?? 0) + e.amount);
      client.set(e.client, c);
      if (c < -0.004) return { client: e.client, matter: '', date: v.date, balance: c };
      if (e.matter) {
        const k = `${e.client}|${e.matter}`;
        const m = round2((matter.get(k) ?? 0) + e.amount);
        matter.set(k, m);
        if (m < -0.004) return { client: e.client, matter: e.matter, date: v.date, balance: m };
      }
    }
  }
  return null;
}

export type CmInput = Omit<ClientMoneyVoucher, 'id' | 'number' | 'voucher_ids' | 'created_at' | 'payment_id'>;

/** Field checks (the store adds balances, invoices and accounts). Returns '' when fine. */
export function validateCm(v: CmInput): string {
  if (!CM_KINDS.includes(v.kind)) return 'Pick the kind of entry.';
  if (!isoDay(v.date)) return 'Type the date.';
  if (!(round2(num(v.amount)) > 0)) return 'Type an amount above zero.';
  if (!v.bank_account_id) return 'Pick the client-money bank account.';
  if (!(v.kind === 'interest' && v.interest_to === 'firm') && !v.client_id) return 'Name the client whose money this is.';
  // BCI Rule 26: a deposit "for fees" is an advance, not client money (GST on advances for services — PS10).
  if (v.kind === 'receipt' && v.purpose === 'fees') return 'A deposit for fees is an advance, not client money: record it in Receivables → Advances (GST applies on advances for services).';
  if (v.kind === 'transfer' && (!v.to_client_id || (v.to_client_id === v.client_id && (v.to_matter_id ?? '') === (v.matter_id ?? '')))) return 'Name the client (or matter) the money moves to.';
  if (v.kind === 'to_fees' && !v.invoice_id) return 'Pick the issued invoice the money pays.';
  return '';
}

/** Statement of one client (optionally one matter) for a period: opening, the entries with a running balance, closing. */
export function cmStatement(rows: readonly ClientMoneyVoucher[], clientId: string, from: string, to: string, matterId?: string): { opening: number; rows: { v: ClientMoneyVoucher; amount: number; balance: number }[]; closing: number } {
  const mine = (e: { client: string; matter: string }) => e.client === clientId && (!matterId || e.matter === matterId);
  let bal = 0;
  const out: { v: ClientMoneyVoucher; amount: number; balance: number }[] = [];
  let opening = 0;
  for (const v of ordered(rows)) {
    if (v.date > to) break;
    const amt = round2(cmEffects(v).filter(mine).reduce((s, e) => s + e.amount, 0));
    if (!amt) continue;
    bal = round2(bal + amt);
    if (v.date < from) opening = bal;
    else out.push({ v, amount: amt, balance: bal });
  }
  return { opening, rows: out, closing: bal };
}

/** Client money held on a matter today (the Matters list column; read by PS-A through `import.meta.glob`). */
export const matterBalance = (matterId: string): number =>
  round2(cmBalances(getTable<ClientMoneyVoucher>(CLIENT_MONEY_TABLE)).filter((b) => b.matter === matterId).reduce((s, b) => s + b.balance, 0));
