/**
 * Interest on a ledger's running balance (WP-1, P1-7 lib part — Tally "Interest Calculation"
 * for loans given / taken). Simple interest, day by day, on the balance at the END of each day,
 * for the balance side chosen in the ledger's `interest` parameters. Amounts are integer PAISE.
 * Pure. Working paper — verify with your CA (no compounding, no TDS on interest).
 */

import type { Period } from '../books';
import type { Account, LedgerInterestParams } from './accounts';
import type { Ledger } from './postings';
import { accountStatement } from './reports';

export interface InterestSlice {
  from: string;
  to: string;
  days: number;
  /** Debit-positive balance during the slice (paise). */
  balance: number;
  /** Interest for the slice (paise, positive = receivable on a Dr balance, payable on a Cr balance). */
  interest: number;
}

export interface InterestResult {
  slices: InterestSlice[];
  /** Interest on debit balances (we receive) and on credit balances (we pay), paise. */
  onDebit: number;
  onCredit: number;
}

const DAY = 86_400_000;
const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Interest on a balance series. `points` are balance changes: the balance from each `date`
 * (inclusive) until the next point. `opening` is the balance at the start of `period`.
 */
export function interestOnBalances(opening: number, points: ReadonlyArray<{ date: string; balance: number }>, period: Period, params: LedgerInterestParams): InterestResult {
  const start = params.from && params.from > period.start ? params.from : period.start;
  const end = period.end;
  const out: InterestResult = { slices: [], onDebit: 0, onCredit: 0 };
  if (start > end || !(params.rate > 0)) return out;
  const daysInYear = params.days_in_year ?? 365;
  // Balance at `start`.
  let bal = opening;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  for (const p of sorted) if (p.date < start) bal = p.balance;
  const changes = sorted.filter((p) => p.date >= start && p.date <= end);
  let cursor = start;
  const flush = (until: string) => {
    // [cursor, until) at `bal`
    const days = Math.round((utc(until) - utc(cursor)) / DAY);
    if (days <= 0) return;
    const applies = (bal > 0 && params.on !== 'cr') || (bal < 0 && params.on !== 'dr');
    const interest = applies ? Math.round((Math.abs(bal) * params.rate * days) / (100 * daysInYear)) : 0;
    out.slices.push({ from: cursor, to: iso(utc(until) - DAY), days, balance: bal, interest });
    if (bal > 0) out.onDebit += interest;
    else if (bal < 0) out.onCredit += interest;
  };
  for (const c of changes) {
    // A change dated d takes effect at the end of d: the day itself earns on the new balance.
    flush(c.date);
    cursor = c.date;
    bal = c.balance;
  }
  flush(iso(utc(end) + DAY));
  return out;
}

/** Interest on one account (or one party of a control account) of the ledger for `period`. */
export function ledgerInterest(ledger: Ledger, accountId: string, period: Period, params: LedgerInterestParams, party?: string): InterestResult {
  const st = accountStatement(ledger, accountId, period, party);
  if (!st) return { slices: [], onDebit: 0, onCredit: 0 };
  const byDay = new Map<string, number>();
  for (const r of st.rows) byDay.set(r.voucher.date, r.balance);
  return interestOnBalances(st.opening, [...byDay].map(([date, balance]) => ({ date, balance })), period, params);
}

/* ── Ledger-wise interest report (PENDING 35, GAP P1-7) ─────────── */

export interface InterestReportRow {
  account: Account;
  params: LedgerInterestParams;
  /** 'loan' = rate taken from the business-loan master (the ledger itself has no interest parameters). */
  source: 'ledger' | 'loan';
  opening: number;
  closing: number;
  onDebit: number;
  onCredit: number;
  slices: InterestSlice[];
}

/**
 * Every ledger with interest parameters (Tally "Interest Calculation" for loans given / taken), plus `extra` ledgers
 * (business loans: the loan's rate on credit balances) that carry none of their own, for `period`. Paise. Ledgers with
 * no balance and no interest are left out.
 */
export function ledgerInterestReport(ledger: Ledger, period: Period, extra: ReadonlyMap<string, LedgerInterestParams> = new Map()): InterestReportRow[] {
  const out: InterestReportRow[] = [];
  for (const account of ledger.accounts) {
    const own = account.interest && account.interest.rate > 0 ? account.interest : undefined;
    const params = own ?? extra.get(account.id);
    if (!params || !(params.rate > 0)) continue;
    const st = accountStatement(ledger, account.id, period);
    if (!st) continue;
    const res = ledgerInterest(ledger, account.id, period, params);
    if (!st.opening && !st.closing && !res.onDebit && !res.onCredit) continue;
    out.push({ account, params, source: own ? 'ledger' : 'loan', opening: st.opening, closing: st.closing, ...res });
  }
  return out.sort((a, b) => a.account.name.localeCompare(b.account.name));
}
