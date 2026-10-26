/**
 * R5-C4 FCRA warnings (never blocks) — verify with your CA (§7 Q11):
 *  1. foreign contribution (a donation to an `fcra` fund) received in cash or into a bank account that is not the
 *     FCRA designated / utilisation account, or a local donation received into the designated account;
 *  2. money paid out of an FCRA account that is not an expense / asset of an FCRA fund and not a transfer to another
 *     FCRA account (the 2020 ban on transfers to other persons);
 *  3. FCRA administrative expenses (ledgers the user marks) above the date-keyed cap of the FY's FC receipts.
 */
import type { Donation } from '../../types/institutions-r5';
import { DEFAULT_BANK_ID, type BankAccount } from '../bank-accounts';
import { bankLedgerId } from '../bank-ledgers';
import type { Ledger } from '../ledger/postings';
import { round2 } from '../invoice-calc';
import { FCRA_ADMIN_CAP_RULES, ruleAt } from '../r5c-rules';
import { fundStatement, roleOf } from './fund-statement';
import type { Fund } from './funds';

export type FcraIssue =
  | { kind: 'fcIntoLocal'; donation: Donation }
  | { kind: 'localIntoFcra'; donation: Donation }
  | { kind: 'transfer'; date: string; number: string; amount: number }
  | { kind: 'adminCap'; admin: number; cap: number; receipts: number; pct: number };

export function fcraLedgers(banks: readonly BankAccount[]): { all: Set<string>; designated: Set<string> } {
  const f = banks.filter((b) => b.fcra);
  return { all: new Set(f.map((b) => bankLedgerId(b.id))), designated: new Set(f.filter((b) => b.fcra === 'designated').map((b) => bankLedgerId(b.id))) };
}

/** Donation-side checks (1). */
export function donationFcraIssues(donations: readonly Donation[], funds: readonly Fund[], banks: readonly BankAccount[]): FcraIssue[] {
  const fc = new Set(funds.filter((f) => f.fund.nature === 'fcra').map((f) => f.id));
  const byId = new Map(banks.map((b) => [b.id, b]));
  const out: FcraIssue[] = [];
  for (const d of donations) {
    if (d.cancelled || d.mode === 'kind') continue;
    const bank = d.mode === 'cash' ? undefined : byId.get(d.bank_account_id ?? '') ?? byId.get(DEFAULT_BANK_ID);
    if (d.fund_id && fc.has(d.fund_id)) {
      if (!bank?.fcra) out.push({ kind: 'fcIntoLocal', donation: d });
    } else if (bank?.fcra === 'designated') out.push({ kind: 'localIntoFcra', donation: d });
  }
  return out;
}

/** Ledger-side checks (2) and (3) for a period (`fy` decides the admin cap). */
export function ledgerFcraIssues(ledger: Ledger, funds: readonly Fund[], banks: readonly BankAccount[], period: { start: string; end: string }, adminAccounts: readonly string[] = []): FcraIssue[] {
  const fcFunds = funds.filter((f) => f.fund.nature === 'fcra');
  const fc = new Set(fcFunds.map((f) => f.id));
  const { all } = fcraLedgers(banks);
  const out: FcraIssue[] = [];
  if (!all.size && !fc.size) return out;
  for (const v of ledger.vouchers) {
    if (v.date < period.start || v.date > period.end) continue;
    const outflow = v.lines.filter((l) => all.has(l.account) && l.cr > 0).reduce((s, l) => s + l.cr, 0);
    if (!outflow) continue;
    const ok = v.lines.filter((l) => l.dr > 0 && (all.has(l.account) || (l.cost_centre && fc.has(l.cost_centre) && roleOf(ledger.byId.get(l.account)) === 'use'))).reduce((s, l) => s + l.dr, 0);
    // Payments to suppliers settle a creditor: allowed when the voucher (bill payment) is for an FCRA-fund expense —
    // not traceable here, so only vouchers that touch no FCRA fund at all are flagged.
    const tagged = v.lines.some((l) => l.cost_centre && fc.has(l.cost_centre));
    if (ok < outflow && !tagged) out.push({ kind: 'transfer', date: v.date, number: v.number, amount: round2((outflow - ok) / 100) });
  }
  const admin = new Set(adminAccounts);
  let receipts = 0;
  let spent = 0;
  for (const f of fcFunds) {
    const s = fundStatement(ledger, f, period);
    receipts += s.receiptsTotal;
    spent += s.utilisation.filter((u) => admin.has(u.account.id)).reduce((a, u) => a + u.amount, 0);
  }
  const pct = ruleAt(FCRA_ADMIN_CAP_RULES, period.end);
  const cap = round2((receipts * pct) / 100);
  if (spent > cap + 0.004 && receipts >= 0) out.push({ kind: 'adminCap', admin: round2(spent), cap, receipts: round2(receipts), pct });
  return out;
}
