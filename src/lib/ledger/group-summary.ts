/**
 * Tally report grammar on the ledger (WP-2, P0-4): Group Summary, Group Vouchers, Ledger Monthly
 * Summary, Ledger Vouchers, and the Day Book from the ledger (P0-3).
 *
 * Every figure comes from `trialBalance` / the ledger vouchers, so a group's closing balance is the
 * sum of its ledgers' trial-balance closings and the primary groups add up to the trial balance.
 * Signed amounts are debit-positive integer paise, as everywhere in `src/lib/ledger/`.
 *
 * Pure. Working papers — verify with your CA.
 */

import { monthLabel, monthsIn, type Period } from '../books';
import type { Account } from './accounts';
import type { Ledger, LedgerVoucher, LedgerVoucherKind } from './postings';
import { openingBalances, trialBalance } from './reports';
import { scopeLedger, type ReportScope } from './branch-books';
import { accountGroupId, childGroups, isWithin, ledgersDirectlyIn, reportGroup, reportLedgersInGroup, syncReportGroups, type ReportGroupNode } from './report-groups';

export interface Figures {
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

export interface GroupSummaryRow extends Figures {
  kind: 'group' | 'ledger' | 'party';
  /** Group id, account id, or `<account id>|<party>`. */
  id: string;
  label: string;
  accountId?: string;
  party?: string;
  /** Detailed (Alt+F1) view: sub-groups, ledgers and parties beneath this row. */
  children: GroupSummaryRow[];
}

export interface GroupSummary {
  /** null = all primary groups (the trial balance, condensed). */
  group: ReportGroupNode | null;
  period: Period;
  rows: GroupSummaryRow[];
  totals: Figures;
}

export interface GroupSummaryOptions {
  /** Include ledgers / groups with nothing in them (F12 "show zero balances"). */
  showZero?: boolean;
  /** Split control accounts (debtors / creditors) into party sub-ledgers. Default true. */
  parties?: boolean;
  /** WP-9: narrow to one branch (`branch-books.ts` `ReportScope`). */
  branchId?: string;
}

const ZERO: Figures = { opening: 0, debit: 0, credit: 0, closing: 0 };
const addTo = (t: Figures, f: Figures) => {
  t.opening += f.opening;
  t.debit += f.debit;
  t.credit += f.credit;
  t.closing += f.closing;
};
const isEmpty = (f: Figures) => !f.opening && !f.debit && !f.credit && !f.closing;

/** Opening / movement / closing per party of a control account, in one pass. */
export function partyFigures(ledger: Ledger, accountId: string, period: Period): Map<string, Figures> {
  const out = new Map<string, Figures>();
  for (const v of ledger.vouchers) {
    if (v.date > period.end) continue;
    for (const l of v.lines) {
      if (l.account !== accountId) continue;
      const p = l.party || '(no party)';
      const f = out.get(p) ?? { ...ZERO };
      if (v.date < period.start) f.opening += l.dr - l.cr;
      else {
        f.debit += l.dr;
        f.credit += l.cr;
      }
      out.set(p, f);
    }
  }
  for (const f of out.values()) f.closing = f.opening + f.debit - f.credit;
  return out;
}

/** Per-account figures for the period (every account of the chart; zero when untouched). */
export function accountFigures(ledger: Ledger, period: Period): Map<string, Figures> {
  const tb = trialBalance(ledger, period);
  const out = new Map<string, Figures>();
  for (const a of ledger.accounts) out.set(a.id, { ...ZERO });
  for (const r of tb.rows) out.set(r.account.id, { opening: r.opening, debit: r.debit, credit: r.credit, closing: r.closing });
  return out;
}

function ledgerRow(ledger: Ledger, a: Account, f: Figures, period: Period, opts: GroupSummaryOptions): GroupSummaryRow {
  const children: GroupSummaryRow[] = [];
  const group = accountGroupId(a);
  if (opts.parties !== false && (group === 'TRADE_RECEIVABLES' || group === 'TRADE_PAYABLES' || a.id === 'cust_advances')) {
    const pf = partyFigures(ledger, a.id, period);
    // Only split when the parties explain the whole balance (they always do for these accounts).
    for (const [p, x] of [...pf.entries()].sort((m, n) => m[0].localeCompare(n[0]))) {
      if (!opts.showZero && isEmpty(x)) continue;
      children.push({ kind: 'party', id: `${a.id}|${p}`, label: p, accountId: a.id, party: p, ...x, children: [] });
    }
  }
  return { kind: 'ledger', id: a.id, label: a.name, accountId: a.id, ...f, children };
}

function groupRow(ledger: Ledger, node: ReportGroupNode, figs: Map<string, Figures>, period: Period, opts: GroupSummaryOptions): GroupSummaryRow {
  const children = rowsUnder(ledger, node.id, figs, period, opts);
  const t = { ...ZERO };
  for (const c of children) addTo(t, c);
  // Hidden zero rows still count (they are zero), so totals stay exact.
  return { kind: 'group', id: node.id, label: node.label, ...t, children };
}

function rowsUnder(ledger: Ledger, groupId: string | null, figs: Map<string, Figures>, period: Period, opts: GroupSummaryOptions): GroupSummaryRow[] {
  const out: GroupSummaryRow[] = [];
  for (const g of childGroups(groupId)) {
    const row = groupRow(ledger, g, figs, period, opts);
    if (opts.showZero || !isEmpty(row) || row.children.length) out.push(row);
  }
  if (groupId) {
    for (const a of ledgersDirectlyIn(ledger.accounts, groupId)) {
      const f = figs.get(a.id) ?? ZERO;
      if (!opts.showZero && isEmpty(f)) continue;
      out.push(ledgerRow(ledger, a, f, period, opts));
    }
  }
  return out;
}

/**
 * Tally "Group Summary": the sub-groups and ledgers of `groupId` (null = primary groups) with
 * opening, debit, credit and closing for the period. Each row carries its children for the
 * detailed (Alt+F1) view.
 */
export function groupSummary(ledger: Ledger, period: Period, groupId: string | null, opts: GroupSummaryOptions = {}): GroupSummary {
  ledger = scopeLedger(ledger, opts);
  syncReportGroups();
  const figs = accountFigures(ledger, period);
  const rows = rowsUnder(ledger, groupId, figs, period, opts);
  const totals = { ...ZERO };
  for (const r of rows) addTo(totals, r);
  // Root totals: opening / closing net to zero for consistent books; show Dr and Cr sides via rows.
  return { group: groupId ? reportGroup(groupId) ?? null : null, period, rows, totals };
}

/** Rows flattened for display: depth-first when `detailed`, top level only otherwise. */
export function flattenRows(rows: readonly GroupSummaryRow[], detailed: boolean, depth = 0): Array<GroupSummaryRow & { depth: number }> {
  const out: Array<GroupSummaryRow & { depth: number }> = [];
  for (const r of rows) {
    out.push({ ...r, depth });
    if (detailed && r.children.length) out.push(...flattenRows(r.children, true, depth + 1));
  }
  return out;
}

/* ── Group vouchers ─────────────────────────────────────────────── */

export interface GroupVoucherRow {
  voucher: LedgerVoucher;
  /** Ledgers of the group the voucher touches. */
  accounts: string[];
  debit: number;
  credit: number;
}

/** Tally "Group Vouchers": every voucher touching a ledger of the group (or its sub-groups). */
export function groupVouchers(ledger: Ledger, period: Period, groupId: string): { rows: GroupVoucherRow[]; debit: number; credit: number } {
  const ids = new Set(reportLedgersInGroup(ledger.accounts, groupId).map((a) => a.id));
  const rows: GroupVoucherRow[] = [];
  let debit = 0;
  let credit = 0;
  for (const v of ledger.vouchers) {
    if (v.date < period.start || v.date > period.end) continue;
    let dr = 0;
    let cr = 0;
    const accts = new Set<string>();
    for (const l of v.lines) {
      if (!ids.has(l.account)) continue;
      dr += l.dr;
      cr += l.cr;
      accts.add(ledger.byId.get(l.account)?.name ?? l.account);
    }
    if (!dr && !cr) continue;
    rows.push({ voucher: v, accounts: [...accts], debit: dr, credit: cr });
    debit += dr;
    credit += cr;
  }
  return { rows, debit, credit };
}

/* ── Ledger monthly summary ─────────────────────────────────────── */

export interface MonthRow {
  /** YYYY-MM */
  key: string;
  label: string;
  period: Period;
  debit: number;
  credit: number;
  closing: number;
}

export interface MonthlySummary {
  account: Account;
  party?: string;
  period: Period;
  opening: number;
  rows: MonthRow[];
  debit: number;
  credit: number;
  closing: number;
}

const lastDay = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return `${key}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** Month strip inside a period, clipped to the period at both ends. */
export function monthPeriods(period: Period): Array<{ key: string; label: string; period: Period }> {
  return monthsIn(period).map((key) => ({
    key,
    label: monthLabel(key),
    period: { start: `${key}-01` < period.start ? period.start : `${key}-01`, end: lastDay(key) > period.end ? period.end : lastDay(key) },
  }));
}

/** Tally "Ledger Monthly Summary": opening, then debit / credit / closing per month. */
export function monthlySummary(ledger: Ledger, accountId: string, period: Period, party?: string): MonthlySummary | null {
  const account = ledger.byId.get(accountId);
  if (!account) return null;
  const opening = openingBalances(ledger, period.start, party).get(accountId) ?? 0;
  const months = monthPeriods(period);
  const idx = new Map(months.map((m, i) => [m.key, i]));
  const dr = months.map(() => 0);
  const cr = months.map(() => 0);
  for (const v of ledger.vouchers) {
    if (v.date < period.start || v.date > period.end) continue;
    const i = idx.get(v.date.slice(0, 7));
    if (i === undefined) continue;
    for (const l of v.lines) {
      if (l.account !== accountId || (party !== undefined && (l.party ?? '') !== party)) continue;
      dr[i] += l.dr;
      cr[i] += l.cr;
    }
  }
  let bal = opening;
  const rows = months.map((m, i) => {
    bal += dr[i] - cr[i];
    return { ...m, debit: dr[i], credit: cr[i], closing: bal };
  });
  const debit = dr.reduce((s, x) => s + x, 0);
  const credit = cr.reduce((s, x) => s + x, 0);
  return { account, party, period, opening, rows, debit, credit, closing: opening + debit - credit };
}

/* ── Day Book from the ledger (P0-3) ────────────────────────────── */

export interface DayBookEntry {
  voucher: LedgerVoucher;
  /** Voucher value = total of its debit lines. */
  amount: number;
  /** First debited and first credited ledger, Tally "Particulars". */
  debitAccount: string;
  creditAccount: string;
}

export interface LedgerDayBook {
  period: Period;
  entries: DayBookEntry[];
  totalDebit: number;
  totalCredit: number;
  kinds: LedgerVoucherKind[];
}

/**
 * Every ledger voucher in the period — documents, receipts, payments, manual JV / CV / PV / RV,
 * fixed assets, depreciation, openings, and whatever later postings add — optionally filtered by
 * voucher type. Totals equal the trial balance's debit / credit movement for the same period.
 */
export function ledgerDayBook(ledger: Ledger, period: Period, kinds?: readonly LedgerVoucherKind[], scope?: ReportScope): LedgerDayBook {
  ledger = scopeLedger(ledger, scope);
  const keep = kinds?.length ? new Set(kinds) : null;
  const present = new Set<LedgerVoucherKind>();
  const entries: DayBookEntry[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const v of ledger.vouchers) {
    if (v.date < period.start || v.date > period.end) continue;
    present.add(v.kind);
    if (keep && !keep.has(v.kind)) continue;
    const dr = v.lines.reduce((s, l) => s + l.dr, 0);
    const cr = v.lines.reduce((s, l) => s + l.cr, 0);
    const name = (id?: string) => (id ? ledger.byId.get(id)?.name ?? id : '');
    entries.push({
      voucher: v,
      amount: dr,
      debitAccount: name(v.lines.find((l) => l.dr)?.account),
      creditAccount: name(v.lines.find((l) => l.cr)?.account),
    });
    totalDebit += dr;
    totalCredit += cr;
  }
  return { period, entries, totalDebit, totalCredit, kinds: [...present] };
}

/** Group membership test exported for drill views (a ledger row inside a BS / P&L line). */
export function accountInGroup(a: Account, groupId: string): boolean {
  return isWithin(accountGroupId(a), groupId);
}
