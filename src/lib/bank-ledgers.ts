/**
 * Each bank account as its own ledger (WP-5, gap P0-8) — Tally's "HDFC Bank CA" under Bank Accounts,
 * "SBI CC" under Bank OD A/c.
 *
 * Ledgers are SYNTHESISED from the `bank_accounts` master (`bank-accounts.ts`), never stored:
 *  - the main account (`DEFAULT_BANK_ID`) keeps the default ledger `bank` (code 3510), so every old
 *    posting and report is unchanged; a renamed main account renames that ledger;
 *  - every other account is ledger `bank:<bank account id>`, code `3510-<n>`, group Cash & bank, or
 *    Short-term borrowings ("Bank OD A/c") when the account is flagged `od`.
 *
 * They reach the chart through the single hook `registerLedgerSource` in `ledger/accounts.ts`, which
 * this module calls when it is loaded (postings, vouchers and the voucher entry screen import it).
 * Pure helpers + one fail-soft storage read (`bankLedgerAccounts`).
 */

import { A, registerLedgerSource, type Account } from './ledger/accounts';
import { DEFAULT_BANK_ID, bankAccountsDb, type BankAccount } from './bank-accounts';

export const BANK_LEDGER_PREFIX = 'bank:';
const MAIN_DEFAULT_NAME = 'Main bank account';

/** Ledger id of a bank account id (missing / main → 3510 `bank`). */
export function bankLedgerId(bankAccountId: string | undefined | null): string {
  const id = String(bankAccountId ?? '').trim();
  return !id || id === DEFAULT_BANK_ID ? A.bank : `${BANK_LEDGER_PREFIX}${id}`;
}

/** Bank account id behind a ledger id, or null when the ledger is not a bank ledger. */
export function bankAccountIdOfLedger(ledgerId: string): string | null {
  if (ledgerId === A.bank) return DEFAULT_BANK_ID;
  return ledgerId.startsWith(BANK_LEDGER_PREFIX) ? ledgerId.slice(BANK_LEDGER_PREFIX.length) || null : null;
}

export const isBankLedgerId = (ledgerId: string): boolean => bankAccountIdOfLedger(ledgerId) !== null;

/** Cash / bank ledger for contra, payment and receipt vouchers: the Cash & bank group or any bank ledger (OD included). */
export function isCashOrBankLedger(account: Pick<Account, 'id' | 'group'> | undefined): boolean {
  return !!account && (account.group === 'CASH_BANK' || isBankLedgerId(account.id));
}

/** The synthesised ledgers for a list of bank accounts (pure). Inactive accounts keep their ledger. */
export function bankLedgersFor(accounts: readonly BankAccount[]): Account[] {
  const out: Account[] = [];
  let n = 0;
  for (const a of accounts) {
    if (a.id === DEFAULT_BANK_ID) {
      const name = a.name.trim();
      if (name && name !== MAIN_DEFAULT_NAME) out.push({ id: A.bank, code: '3510', name, group: 'CASH_BANK', system: true });
      continue;
    }
    n += 1;
    out.push({ id: bankLedgerId(a.id), code: `3510-${n}`, name: a.name.trim() || 'Bank account', group: a.od ? 'LOANS_ST' : 'CASH_BANK', system: true });
  }
  return out;
}

/** Bank ledgers from storage (fail-soft: none when the table cannot be read). */
export function bankLedgerAccounts(): Account[] {
  try {
    return bankLedgersFor(bankAccountsDb.all());
  } catch {
    return [];
  }
}

registerLedgerSource(bankLedgerAccounts);
