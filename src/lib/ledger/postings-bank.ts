/**
 * Bank ledger resolution for the automatic vouchers (WP-5, gap P0-8). `buildLedger` (postings.ts)
 * posts every bank movement to 3510 `bank`; this pass re-targets each line to the ledger of the bank
 * account its source document names (`bank_account_id` on receipts, supplier payments, supplier
 * advances, advance receipts / refunds, TDS challans — cheques record their payments with the account
 * too) and sizes the openings per account. One call line in postings.ts.
 *
 * Openings (only once a second bank account exists — a one-account company is untouched):
 *  - an account with its own opening (`opening` + `opening_as_of`): Dr its ledger | Cr Opening balance
 *    difference, sized so the ledger balance at the start of that day equals the opening;
 *  - the main account without its own opening keeps the Books bank opening, re-sized against the
 *    main ledger alone (other accounts' movements no longer sit in 3510). With its own opening, that
 *    opening replaces the Books one. This is the same rule as `bankAccountBalanceAt` (the BRS) and the
 *    Books bank book per account, so the three agree.
 *
 * Pure. Working papers — verify with your CA.
 */

import { toPaise } from '../export-shared';
import { num } from '../invoice-calc';
import { DEFAULT_BANK_ID, type BankAccount } from '../bank-accounts';
import { bankAccountsDb } from '../bank-accounts';
import { bankLedgerId } from '../bank-ledgers';
import { A, type Account } from './accounts';
import type { LedgerInput, LedgerVoucher } from './postings';

/**
 * The ledger a posting line goes to: a 3510 line carrying a `bank_account_id` resolves to that
 * account's ledger; anything else is returned unchanged. An unknown / deleted account stays on 3510.
 */
export function bankAccountFor(line: { account: string; bank_account_id?: string }, known?: ReadonlySet<string> | ReadonlyMap<string, unknown>): string {
  if (line.account !== A.bank || !line.bank_account_id) return line.account;
  const id = bankLedgerId(line.bank_account_id);
  return !known || known.has(id) ? id : A.bank;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Voucher id (`rcpt:…`, `pay:…`, `vpay:…`, `adv:…`, `advrf:…`, `tdsch:…`) → the bank account its source names. */
export function bankAccountsBySource(input: LedgerInput): Map<string, string> {
  const m = new Map<string, string>();
  const put = (key: string, id: unknown) => {
    const s = str(id);
    if (s && s !== DEFAULT_BANK_ID) m.set(key, s);
  };
  for (const t of input.transactions) put(`rcpt:${t.id}`, t.bank_account_id);
  for (const pp of input.purchasePayments) {
    const date = str(pp.date);
    put(`pay:${pp.id ?? `${pp.purchase_id}-${date}-${Math.abs(toPaise(num(pp.amount)))}`}`, pp.bank_account_id);
  }
  for (const vp of input.vendorPayments ?? []) put(`vpay:${vp.id}`, vp.bank_account_id);
  for (const a of input.advances ?? []) {
    put(`adv:${a.id}`, a.bank_account_id);
    for (const r of a.refunds ?? []) put(`advrf:${r.id}`, r.bank_account_id);
  }
  for (const ch of input.challans ?? []) put(`tdsch:${ch.id}`, ch.bank_account_id);
  return m;
}

/**
 * Re-target bank lines in `vouchers` (mutated in place) and return the per-account opening vouchers
 * to add (the caller pushes them through its usual balance / unknown-account checks). Books bank
 * opening vouchers (`open:` on 3510) are removed from `vouchers` and returned re-sized.
 */
export function applyBankLedgers(vouchers: LedgerVoucher[], input: LedgerInput, byId: ReadonlyMap<string, Account>, accounts: readonly BankAccount[] = bankAccountsDb.all()): LedgerVoucher[] {
  const others = accounts.filter((a) => a.id !== DEFAULT_BANK_ID);
  if (!others.length) return [];
  const source = bankAccountsBySource(input);
  for (const v of vouchers) {
    const bankId = source.get(v.id);
    if (!bankId) continue;
    for (const l of v.lines) l.account = bankAccountFor({ account: l.account, bank_account_id: bankId }, byId);
  }

  // Openings.
  const bankOpenings = new Map(input.openings.filter((o) => o.account === 'bank' && o.as_of).map((o) => [`open:${o.id}`, o]));
  const booksOpen = vouchers.filter((v) => v.kind === 'Opening' && bankOpenings.has(v.id));
  for (const v of booksOpen) vouchers.splice(vouchers.indexOf(v), 1);

  const out: LedgerVoucher[] = [];
  const balanceBefore = (ledger: string, date: string) => {
    let b = 0;
    for (const v of [...vouchers, ...out]) {
      if (v.date >= date) continue;
      for (const l of v.lines) if (l.account === ledger) b += l.dr - l.cr;
    }
    return b;
  };
  const opening = (id: string, ledger: string, date: string, amount: number, narration: string) => {
    const adj = toPaise(amount) - balanceBefore(ledger, date);
    const lines = adj === 0 ? [] : adj > 0
      ? [{ account: ledger, dr: adj, cr: 0 }, { account: A.openingDiff, dr: 0, cr: adj }]
      : [{ account: ledger, dr: 0, cr: -adj }, { account: A.openingDiff, dr: -adj, cr: 0 }];
    out.push({ id, source: 'auto', kind: 'Opening', date, number: '', party: '', narration, lines });
  };

  const main = accounts.find((a) => a.id === DEFAULT_BANK_ID);
  const mainOwn = main && main.opening !== undefined && main.opening_as_of ? main : null;
  if (mainOwn) {
    opening(`bankopen:${DEFAULT_BANK_ID}`, A.bank, mainOwn.opening_as_of!, mainOwn.opening!, `Opening balance of ${mainOwn.name} ${num(mainOwn.opening).toFixed(2)} (bank accounts master)`);
  } else {
    for (const v of [...booksOpen].sort((a, b) => a.date.localeCompare(b.date))) {
      const o = bankOpenings.get(v.id)!;
      opening(v.id, A.bank, o.as_of, num(o.amount), `Opening bank balance ${num(o.amount).toFixed(2)} as entered in Books (main bank account)`);
    }
  }
  for (const a of others) {
    if (a.opening === undefined || !a.opening_as_of) continue;
    const ledger = bankLedgerId(a.id);
    if (!byId.has(ledger)) continue;
    opening(`bankopen:${a.id}`, ledger, a.opening_as_of, a.opening, `Opening balance of ${a.name} ${num(a.opening).toFixed(2)} (bank accounts master)`);
  }
  return out;
}
