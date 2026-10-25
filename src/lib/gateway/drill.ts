/**
 * Display reports with Tally-style drill-down (Phase 7): Balance sheet / P&L / Trial balance group →
 * ledgers of the group → (parties of a control account) → monthly summary → vouchers of the month →
 * the voucher or its document. Built on the ledger statements in src/lib/ledger/reports.ts (the same
 * closing-stock-aware P&L / balance sheet as Books when `opts.stock` is passed); pure.
 *
 * A drill path is a list of segments, kept in the URL (`d=g:CASH_BANK/a:bank/m:2026-04`) so the
 * browser's Back and Esc walk up the same path. Amounts are integer paise; a `balance` cell is
 * signed debit-positive (shown as Dr / Cr).
 */
import { fyPeriod, fyStartYearOf, monthLabel, monthsIn, type Period } from '../books';
import {
  GROUPS,
  accountStatement,
  groupOf,
  isGroupId,
  ledgerBalanceSheet,
  ledgerProfitAndLoss,
  partiesOf,
  trialBalance,
  type GroupId,
  type Ledger,
  type LedgerVoucher,
  type StockValuer,
} from '../ledger/index';

export type ReportId = 'bs' | 'pl' | 'tb' | 'groups' | 'daybook' | 'cash' | 'ledgers' | 'acct';

export const REPORT_IDS: readonly ReportId[] = ['bs', 'pl', 'tb', 'groups', 'daybook', 'cash', 'ledgers', 'acct'];

export type Seg = { t: 'g'; v: GroupId } | { t: 'a'; v: string } | { t: 'p'; v: string } | { t: 'm'; v: string } | { t: 'pl' };

export type ColKey = 'particulars' | 'amount' | 'debit' | 'credit' | 'opening' | 'closing' | 'date' | 'type' | 'number';
export type ColKind = 'text' | 'amount' | 'balance';

export interface DisplayColumn {
  key: ColKey;
  kind: ColKind;
}

export type Cell = string | number | null;

/** Label keys the screen translates (the rest of the text is data: account, group and party names). */
export type RowLabel =
  | 'liabilities'
  | 'assets'
  | 'income'
  | 'expenses'
  | 'plRow'
  | 'netProfit'
  | 'netLoss'
  | 'total'
  | 'openingBalance'
  | 'noParty'
  | 'closingStockRow'
  | 'openingStockRow';

export interface DisplayRow {
  id: string;
  /** First cell: data text, or a translatable label. */
  label: string | { key: RowLabel };
  cells: Cell[];
  /** Indent level (0 = heading). */
  level: number;
  /** Heading / total rows are not focusable. */
  heading?: boolean;
  drill?: Seg;
  /** Voucher row: where Enter opens it (null = no page). */
  open?: string | null;
}

export interface DisplayFrame {
  /** Root frame: the report's own title; deeper frames: the data name (group, account, party, month). */
  title: { report: ReportId } | { text: string } | { key: RowLabel };
  /** Date window the figures cover. */
  period: Period;
  /** Balance sheet only: figures are "as at" this day. */
  asOf?: string;
  columns: DisplayColumn[];
  rows: DisplayRow[];
  total?: Cell[];
}

/* ── Path encoding ─────────────────────────────────────────────── */

export function encodePath(segs: readonly Seg[]): string {
  return segs.map((s) => (s.t === 'pl' ? 'pl' : `${s.t}:${encodeURIComponent(s.v)}`)).join('/');
}

export function decodePath(text: string | null | undefined): Seg[] {
  if (!text) return [];
  const out: Seg[] = [];
  for (const part of text.split('/')) {
    if (part === 'pl') {
      out.push({ t: 'pl' });
      continue;
    }
    const i = part.indexOf(':');
    if (i < 1) continue;
    const t = part.slice(0, i);
    let v: string;
    try {
      v = decodeURIComponent(part.slice(i + 1));
    } catch {
      continue;
    }
    if (t === 'g' && isGroupId(v)) out.push({ t, v });
    else if ((t === 'a' || t === 'p') && v) out.push({ t, v });
    else if (t === 'm' && /^\d{4}-\d{2}$/.test(v)) out.push({ t, v });
  }
  return out;
}

export function isReportId(v: unknown): v is ReportId {
  return typeof v === 'string' && (REPORT_IDS as readonly string[]).includes(v);
}

/* ── Helpers ───────────────────────────────────────────────────── */

const CONTROL = new Set<GroupId>(['TRADE_RECEIVABLES', 'TRADE_PAYABLES']);

/** The window every frame of a report uses. The balance sheet works FY-to-date up to "as at" (capped at today). */
export function effectivePeriod(report: ReportId, period: Period, today: string): { period: Period; asOf?: string } {
  if (report !== 'bs') return { period };
  const asOf = period.end > today ? today : period.end;
  return { period: { start: fyPeriod(fyStartYearOf(asOf)).start, end: asOf }, asOf };
}

/** Where Enter on a voucher row goes: the Gateway voucher screen for manual vouchers, the document page otherwise. */
export function voucherTarget(v: LedgerVoucher): string | null {
  if (v.source === 'manual' && v.manualId) return `/gateway/voucher/${v.kind.toLowerCase()}?id=${encodeURIComponent(v.manualId)}`;
  return v.link ?? null;
}

function particularsOf(ledger: Ledger, v: LedgerVoucher): string {
  if (v.party) return v.party;
  const firstDr = v.lines.find((l) => l.dr > 0);
  return (firstDr && ledger.byId.get(firstDr.account)?.name) || v.narration || '';
}

/* ── Frames ────────────────────────────────────────────────────── */

const BAL_COLS: DisplayColumn[] = [
  { key: 'particulars', kind: 'text' },
  { key: 'opening', kind: 'balance' },
  { key: 'debit', kind: 'amount' },
  { key: 'credit', kind: 'amount' },
  { key: 'closing', kind: 'balance' },
];

/**
 * Balance sheet root: the SAME statement as Books → Balance sheet (`ledgerBalanceSheet` with the
 * closing-stock valuer from `loadStockValuer()`), laid out Tally-style: one row per head (drills into
 * its group), the year's result as the "Profit & loss A/c" row, and the report-time stock lines
 * (closing stock under assets, opening stock in capital) as their own rows that open the stock summary.
 * Totals therefore equal Books by construction.
 */
function balanceSheetFrame(ledger: Ledger, period: Period, asOf: string, stock?: StockValuer): DisplayFrame {
  const bs = ledgerBalanceSheet(ledger, asOf, stock);
  const rows: DisplayRow[] = [];
  const split = new Set<string>(['RESERVES', 'CAPITAL', 'INVENTORIES']);
  const side = (sections: typeof bs.assets, liabilities: boolean) => {
    for (const sec of sections) {
      for (const it of sec.items) {
        let amount = it.amount;
        if (liabilities && it.groupId === 'RESERVES') amount -= bs.profitForYear;
        if (liabilities && it.groupId === 'CAPITAL') amount -= bs.openingStock;
        if (!liabilities && it.groupId === 'INVENTORIES') amount -= bs.closingStock;
        if (amount || !split.has(it.groupId ?? '')) {
          const drill: Seg | undefined = it.groupId && isGroupId(it.groupId) ? { t: 'g', v: it.groupId } : undefined;
          rows.push({ id: `g-${it.groupId ?? it.label}`, label: it.label, cells: [amount], level: 1, ...(drill ? { drill } : {}) });
        }
        if (liabilities && it.groupId === 'CAPITAL' && bs.openingStock) {
          rows.push({ id: 'stock-open', label: { key: 'openingStockRow' }, cells: [bs.openingStock], level: 1, open: '/inventory' });
        }
        if (!liabilities && it.groupId === 'INVENTORIES' && bs.closingStock) {
          rows.push({ id: 'stock-close', label: { key: 'closingStockRow' }, cells: [bs.closingStock], level: 1, open: '/inventory' });
        }
      }
    }
  };
  rows.push({ id: 'h-liab', label: { key: 'liabilities' }, cells: [null], level: 0, heading: true });
  side(bs.equityAndLiabilities, true);
  rows.push({ id: 'pl', label: { key: 'plRow' }, cells: [bs.profitForYear], level: 1, drill: { t: 'pl' } });
  rows.push({ id: 't-liab', label: { key: 'total' }, cells: [bs.totalEquityAndLiabilities], level: 0, heading: true });
  rows.push({ id: 'h-assets', label: { key: 'assets' }, cells: [null], level: 0, heading: true });
  side(bs.assets, false);
  rows.push({ id: 't-assets', label: { key: 'total' }, cells: [bs.totalAssets], level: 0, heading: true });
  return { title: { report: 'bs' }, period, asOf, columns: [{ key: 'particulars', kind: 'text' }, { key: 'amount', kind: 'amount' }], rows };
}

/** P&L: the same `ledgerProfitAndLoss` (with the stock valuer) as Books; stock lines open the stock summary. */
function profitLossFrame(ledger: Ledger, period: Period, root: boolean, stock?: StockValuer): DisplayFrame {
  const pl = ledgerProfitAndLoss(ledger, period, stock);
  const rows: DisplayRow[] = [];
  rows.push({ id: 'h-inc', label: { key: 'income' }, cells: [null], level: 0, heading: true });
  for (const s of pl.income) rows.push({ id: `g-${s.group}`, label: s.label, cells: [s.total], level: 1, drill: { t: 'g', v: s.group } });
  if (pl.trading.closingStock) rows.push({ id: 'stock-close', label: { key: 'closingStockRow' }, cells: [pl.trading.closingStock], level: 1, open: '/inventory' });
  rows.push({ id: 'h-exp', label: { key: 'expenses' }, cells: [null], level: 0, heading: true });
  if (pl.trading.openingStock) rows.push({ id: 'stock-open', label: { key: 'openingStockRow' }, cells: [pl.trading.openingStock], level: 1, open: '/inventory' });
  for (const s of pl.expenses) rows.push({ id: `g-${s.group}`, label: s.label, cells: [s.total], level: 1, drill: { t: 'g', v: s.group } });
  rows.push({ id: 'net', label: { key: pl.netProfit >= 0 ? 'netProfit' : 'netLoss' }, cells: [Math.abs(pl.netProfit)], level: 0, heading: true });
  return {
    title: root ? { report: 'pl' } : { key: 'plRow' },
    period,
    columns: [{ key: 'particulars', kind: 'text' }, { key: 'amount', kind: 'amount' }],
    rows,
  };
}

/** Trial balance / group summary: closing Dr / Cr per group. */
function groupsFrame(ledger: Ledger, period: Period, report: 'tb' | 'groups'): DisplayFrame {
  const tb = trialBalance(ledger, period);
  const byGroup = new Map<GroupId, number>();
  for (const r of tb.rows) byGroup.set(r.account.group, (byGroup.get(r.account.group) ?? 0) + r.closing);
  const rows: DisplayRow[] = [];
  let dr = 0;
  let cr = 0;
  for (const g of GROUPS) {
    if (!byGroup.has(g.id)) continue;
    const c = byGroup.get(g.id) ?? 0;
    if (c > 0) dr += c;
    else cr -= c;
    rows.push({ id: `g-${g.id}`, label: g.label, cells: [c > 0 ? c : null, c < 0 ? -c : null], level: 1, drill: { t: 'g', v: g.id } });
  }
  return {
    title: { report },
    period,
    columns: [{ key: 'particulars', kind: 'text' }, { key: 'debit', kind: 'amount' }, { key: 'credit', kind: 'amount' }],
    rows,
    total: [dr, cr],
  };
}

/** Ledgers with opening / debit / credit / closing; `keep` picks the accounts. */
function ledgersFrame(ledger: Ledger, period: Period, title: DisplayFrame['title'], keep: (accountId: string, group: GroupId) => boolean, includeIdle = false): DisplayFrame {
  const tb = trialBalance(ledger, period);
  const rows: DisplayRow[] = [];
  const t = [0, 0, 0, 0];
  const listed = new Set<string>();
  for (const r of tb.rows) {
    if (!keep(r.account.id, r.account.group)) continue;
    listed.add(r.account.id);
    t[0] += r.opening;
    t[1] += r.debit;
    t[2] += r.credit;
    t[3] += r.closing;
    rows.push({ id: `a-${r.account.id}`, label: r.account.name, cells: [r.opening, r.debit, r.credit, r.closing], level: 1, drill: { t: 'a', v: r.account.id } });
  }
  if (includeIdle) {
    for (const a of ledger.accounts) {
      if (listed.has(a.id) || !keep(a.id, a.group)) continue;
      rows.push({ id: `a-${a.id}`, label: a.name, cells: [0, 0, 0, 0], level: 1, drill: { t: 'a', v: a.id } });
    }
  }
  return { title, period, columns: BAL_COLS, rows, total: t };
}

/** Parties of a control account (debtors / creditors) with their balances. */
function partiesFrame(ledger: Ledger, accountId: string, period: Period, title: DisplayFrame['title']): DisplayFrame {
  const names = partiesOf(ledger, accountId);
  const rows: DisplayRow[] = [];
  const t = [0, 0, 0, 0];
  for (const p of [...names, '']) {
    const s = accountStatement(ledger, accountId, period, p);
    if (!s || (!s.opening && !s.totalDebit && !s.totalCredit)) continue;
    t[0] += s.opening;
    t[1] += s.totalDebit;
    t[2] += s.totalCredit;
    t[3] += s.closing;
    rows.push({ id: `p-${p}`, label: p || { key: 'noParty' }, cells: [s.opening, s.totalDebit, s.totalCredit, s.closing], level: 1, drill: { t: 'p', v: p || '-' } });
  }
  return { title, period, columns: BAL_COLS, rows, total: t };
}

/** Ledger monthly summary: opening, then each month's debit / credit / closing balance. */
export function monthlyFrame(ledger: Ledger, accountId: string, period: Period, party?: string): DisplayFrame | null {
  const s = accountStatement(ledger, accountId, period, party);
  if (!s) return null;
  const byMonth = new Map<string, { dr: number; cr: number }>();
  for (const r of s.rows) {
    const k = r.voucher.date.slice(0, 7);
    const m = byMonth.get(k) ?? { dr: 0, cr: 0 };
    m.dr += r.debit;
    m.cr += r.credit;
    byMonth.set(k, m);
  }
  const rows: DisplayRow[] = [{ id: 'open', label: { key: 'openingBalance' }, cells: [null, null, s.opening], level: 0, heading: true }];
  let bal = s.opening;
  for (const k of monthsIn(period)) {
    const m = byMonth.get(k) ?? { dr: 0, cr: 0 };
    bal += m.dr - m.cr;
    rows.push({ id: `m-${k}`, label: monthLabel(k), cells: [m.dr || null, m.cr || null, bal], level: 1, drill: { t: 'm', v: k } });
  }
  return {
    title: { text: party !== undefined ? party || '—' : s.account.name },
    period,
    columns: [{ key: 'particulars', kind: 'text' }, { key: 'debit', kind: 'amount' }, { key: 'credit', kind: 'amount' }, { key: 'closing', kind: 'balance' }],
    rows,
    total: [s.totalDebit, s.totalCredit, s.closing],
  };
}

/** Vouchers of one account (optionally one party) in a month, with the running balance. */
export function vouchersFrame(ledger: Ledger, accountId: string, month: string, period: Period, party?: string): DisplayFrame | null {
  const window: Period = { start: max(`${month}-01`, period.start), end: min(lastDay(month), period.end) };
  const s = accountStatement(ledger, accountId, window, party);
  if (!s) return null;
  const rows: DisplayRow[] = [{ id: 'open', label: { key: 'openingBalance' }, cells: [null, null, null, null, null, s.opening], level: 0, heading: true }];
  for (const r of s.rows) {
    rows.push({
      id: `v-${r.voucher.id}`,
      label: r.voucher.date,
      cells: [r.particulars, r.voucher.kind, r.voucher.number, r.debit || null, r.credit || null, r.balance],
      level: 1,
      open: voucherTarget(r.voucher),
    });
  }
  return {
    title: { text: monthLabel(month) },
    period: window,
    columns: [
      { key: 'date', kind: 'text' },
      { key: 'particulars', kind: 'text' },
      { key: 'type', kind: 'text' },
      { key: 'number', kind: 'text' },
      { key: 'debit', kind: 'amount' },
      { key: 'credit', kind: 'amount' },
      { key: 'closing', kind: 'balance' },
    ],
    rows,
    total: [null, null, null, s.totalDebit, s.totalCredit, s.closing],
  };
}

export function dayBookFrame(ledger: Ledger, period: Period): DisplayFrame {
  const rows: DisplayRow[] = [];
  let total = 0;
  for (const v of ledger.vouchers) {
    if (v.date < period.start || v.date > period.end) continue;
    const amt = v.lines.reduce((s, l) => s + l.dr, 0);
    total += amt;
    rows.push({ id: `v-${v.id}`, label: v.date, cells: [particularsOf(ledger, v), v.kind, v.number, amt], level: 1, open: voucherTarget(v) });
  }
  return {
    title: { report: 'daybook' },
    period,
    columns: [
      { key: 'date', kind: 'text' },
      { key: 'particulars', kind: 'text' },
      { key: 'type', kind: 'text' },
      { key: 'number', kind: 'text' },
      { key: 'amount', kind: 'amount' },
    ],
    rows,
    total: [null, null, null, total],
  };
}

function lastDay(month: string): string {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(d).padStart(2, '0')}`;
}
const max = (a: string, b: string) => (a > b ? a : b);
const min = (a: string, b: string) => (a < b ? a : b);

export interface FrameOptions {
  /** `acct` report: the account it opens on (e.g. `debtors` for receivables outstandings). */
  account?: string;
  /**
   * Closing-stock valuer for the balance sheet / P&L frames: pass `loadStockValuer()` so the Gateway
   * shows exactly the Books statements (absent = stock not valued).
   */
  stock?: StockValuer;
}

/**
 * The frame at the end of `path` in `report`. Unknown segments (a deleted account …) yield null;
 * the screen then falls back to the deepest valid frame.
 */
export function buildFrame(ledger: Ledger, report: ReportId, path: readonly Seg[], period: Period, today: string, opts: FrameOptions = {}): DisplayFrame | null {
  const eff = effectivePeriod(report, period, today);
  const p = eff.period;
  let account: string | undefined = report === 'acct' ? opts.account : undefined;
  let party: string | undefined;
  if (report === 'acct' && (!account || !ledger.byId.has(account))) return null;

  if (!path.length) {
    switch (report) {
      case 'bs':
        return balanceSheetFrame(ledger, p, eff.asOf ?? p.end, opts.stock);
      case 'pl':
        return profitLossFrame(ledger, p, true, opts.stock);
      case 'tb':
      case 'groups':
        return groupsFrame(ledger, p, report);
      case 'daybook':
        return dayBookFrame(ledger, p);
      case 'cash':
        return ledgersFrame(ledger, p, { report: 'cash' }, (_id, g) => g === 'CASH_BANK', true);
      case 'ledgers':
        return ledgersFrame(ledger, p, { report: 'ledgers' }, () => true);
      case 'acct':
        break;
    }
  }

  // Walk the path; the last segment decides the frame.
  let frame: DisplayFrame | null = null;
  const steps: Seg[] = report === 'acct' && account ? [{ t: 'a', v: account }, ...path] : [...path];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const lastStep = i === steps.length - 1;
    if (s.t === 'pl') {
      frame = lastStep ? profitLossFrame(ledger, p, false, opts.stock) : null;
      continue;
    }
    if (s.t === 'g') {
      if (lastStep) frame = ledgersFrame(ledger, p, { text: groupOf(s.v).label }, (_id, g) => g === s.v);
      continue;
    }
    if (s.t === 'a') {
      const acc = ledger.byId.get(s.v);
      if (!acc) return null;
      account = acc.id;
      party = undefined;
      if (lastStep) {
        const parties = CONTROL.has(acc.group) ? partiesOf(ledger, acc.id) : [];
        frame = parties.length ? partiesFrame(ledger, acc.id, p, { text: acc.name }) : monthlyFrame(ledger, acc.id, p);
      }
      continue;
    }
    if (s.t === 'p') {
      if (!account) return null;
      party = s.v === '-' ? '' : s.v;
      if (lastStep) frame = monthlyFrame(ledger, account, p, party);
      continue;
    }
    if (s.t === 'm') {
      if (!account) return null;
      if (lastStep) frame = vouchersFrame(ledger, account, s.v, p, party);
    }
  }
  return frame;
}
