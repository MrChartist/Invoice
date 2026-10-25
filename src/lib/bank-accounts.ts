/**
 * Several bank accounts (multi-account BRS). Each account is also its own ledger (WP-5,
 * `bank-ledgers.ts`): the main account keeps ledger 3510, others get `bank:<id>` (Bank Accounts, or
 * Bank OD A/c with `od`). This sub-ledger says WHICH account a receipt or supplier payment went
 * through, so each account reconciles against its own statements and has its own ledger.
 *
 *  - Table `bank_accounts`: { id, name, number?, opening?, opening_as_of?, active }. The main
 *    account (`DEFAULT_BANK_ID`) always exists; a row with that id only renames it / sets its
 *    opening.
 *  - Payments, supplier payments, books vouchers and bank statements carry an optional
 *    `bank_account_id`; missing means the main account, so existing data needs no migration.
 */

import { getTable, setTable } from './storage';
import { round2 } from './invoice-calc';

export const BANK_ACCOUNTS_TABLE = 'bank_accounts';
export const DEFAULT_BANK_ID = 'default';

export interface BankAccount {
  id: string;
  name: string;
  /** Free text, e.g. "HDFC ••1234" (keep full numbers out of shared screens). */
  number?: string;
  /** Opening balance of THIS account on `opening_as_of` (the Books bank opening is the total). */
  opening?: number;
  opening_as_of?: string;
  active?: boolean;
  /* ── WP-5 (each bank account as its own ledger, banking documents) — additive, all optional ── */
  /** Overdraft / cash-credit account: its ledger sits under "Bank OD A/c" (short-term borrowings). */
  od?: boolean;
  /** Sanctioned OD / CC limit (₹), informational. */
  od_limit?: number;
  /** Full account number — used only in bank upload files and the deposit slip; screens show it masked. */
  account_no?: string;
  ifsc?: string;
  branch?: string;
}

const MAIN: BankAccount = { id: DEFAULT_BANK_ID, name: 'Main bank account', active: true };

/** `••••1234` — the last four characters of an account number (never print full numbers in lists). */
export function maskAccountNo(no: string | undefined): string {
  const s = String(no ?? '').replace(/\s+/g, '');
  if (!s) return '';
  return s.length <= 4 ? s : `••••${s.slice(-4)}`;
}

export const accountIdOf = (x: { bank_account_id?: string } | null | undefined): string => x?.bank_account_id || DEFAULT_BANK_ID;

function clean(rows: unknown[]): BankAccount[] {
  const out: BankAccount[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = String(o.id ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const opening = Number(o.opening);
    out.push({
      id,
      name: String(o.name ?? '').trim() || (id === DEFAULT_BANK_ID ? MAIN.name : 'Bank account'),
      number: o.number ? String(o.number) : undefined,
      opening: Number.isFinite(opening) && o.opening !== undefined && o.opening !== '' ? round2(opening) : undefined,
      opening_as_of: /^\d{4}-\d{2}-\d{2}$/.test(String(o.opening_as_of ?? '')) ? String(o.opening_as_of) : undefined,
      active: o.active !== false,
      ...(o.od === true ? { od: true } : {}),
      ...(Number.isFinite(Number(o.od_limit)) && Number(o.od_limit) > 0 ? { od_limit: round2(Number(o.od_limit)) } : {}),
      ...(typeof o.account_no === 'string' && o.account_no.trim() ? { account_no: o.account_no.replace(/\s+/g, '') } : {}),
      ...(typeof o.ifsc === 'string' && o.ifsc.trim() ? { ifsc: o.ifsc.trim().toUpperCase() } : {}),
      ...(typeof o.branch === 'string' && o.branch.trim() ? { branch: o.branch.trim() } : {}),
    });
  }
  if (!seen.has(DEFAULT_BANK_ID)) out.unshift({ ...MAIN });
  else out.sort((a, b) => (a.id === DEFAULT_BANK_ID ? -1 : b.id === DEFAULT_BANK_ID ? 1 : 0));
  return out;
}

export const bankAccountsDb = {
  all: (): BankAccount[] => clean(getTable<unknown>(BANK_ACCOUNTS_TABLE)),
  active: (): BankAccount[] => bankAccountsDb.all().filter((a) => a.active !== false),
  /** True once the user keeps more than one account (pickers only appear then). */
  multiple: (): boolean => bankAccountsDb.active().length > 1,
  save(acc: BankAccount): BankAccount {
    const name = acc.name.trim();
    if (!name) throw new Error('Give the account a name.');
    const all = bankAccountsDb.all();
    if (all.some((a) => a.id !== acc.id && a.name.toLowerCase() === name.toLowerCase())) throw new Error('An account with this name already exists.');
    const row: BankAccount = { ...acc, name, active: acc.id === DEFAULT_BANK_ID ? true : acc.active !== false };
    const next = all.some((a) => a.id === acc.id) ? all.map((a) => (a.id === acc.id ? row : a)) : [...all, row];
    setTable(BANK_ACCOUNTS_TABLE, next);
    return row;
  },
  /** Delete an account no payment or statement uses (otherwise mark it inactive). */
  remove(id: string, inUse: boolean): void {
    if (id === DEFAULT_BANK_ID) throw new Error('The main bank account cannot be deleted.');
    if (inUse) throw new Error('Payments or statements use this account; mark it inactive instead.');
    setTable(BANK_ACCOUNTS_TABLE, bankAccountsDb.all().filter((a) => a.id !== id));
  },
};
