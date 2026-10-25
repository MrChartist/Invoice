/**
 * Tally XML fragment for per-bank ledgers (WP-5, gap P0-8 / P1-22). `tally-xml.ts` (owned by WP-7)
 * asks this resolver which ledger a receipt / advance / refund moves money through:
 *  - Cash → the cash ledger (Cash-in-Hand);
 *  - the main bank account (or no account) → the configured bank ledger (default "Bank Account"),
 *    exactly as before, so a one-account export is unchanged;
 *  - any other bank account → a ledger named after that account, under "Bank Accounts", or
 *    "Bank OD A/c" for an overdraft / cash-credit account.
 * Pure (the account list is passed in; `tallyBankResolver` defaults to the stored master, fail-soft).
 */

import { DEFAULT_BANK_ID, bankAccountsDb, type BankAccount } from './bank-accounts';

export interface TallyBankLedger {
  ledger: string;
  parent: 'Cash-in-Hand' | 'Bank Accounts' | 'Bank OD A/c';
}

export type TallyBankResolver = (rec: { method?: string; bank_account_id?: string }) => TallyBankLedger;

function storedAccounts(): BankAccount[] {
  try {
    return bankAccountsDb.all();
  } catch {
    return [];
  }
}

export function tallyBankResolver(bankLedger: string, cashLedger: string, accounts: readonly BankAccount[] = storedAccounts()): TallyBankResolver {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return (rec) => {
    if (/^\s*cash\s*$/i.test(String(rec.method ?? ''))) return { ledger: cashLedger, parent: 'Cash-in-Hand' };
    const acc = rec.bank_account_id && rec.bank_account_id !== DEFAULT_BANK_ID ? byId.get(rec.bank_account_id) : undefined;
    if (!acc || !acc.name.trim()) return { ledger: bankLedger, parent: 'Bank Accounts' };
    return { ledger: acc.name.trim(), parent: acc.od ? 'Bank OD A/c' : 'Bank Accounts' };
  };
}
