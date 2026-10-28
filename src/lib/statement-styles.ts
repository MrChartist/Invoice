/**
 * Statement styles and the ageing strip (Round 2, R2-A6 — QuickBooks balance-forward / open-item /
 * transaction statements, Odoo customer statement).
 *
 *   balance_forward  today's paper: opening balance, every entry with a running balance, closing balance
 *   open_items       only the bills still open: number, date, due, original, credited, received, open, days overdue
 *   transactions     every document and receipt in the range, no opening / closing balance
 *
 * The optional ageing strip (Current, 1–30, 31–60, 61–90, 90+) is worked out from the open bills against an
 * "as of" day (local days, Critical Rule 8). Row builders read the `ReceivablesReport` / `Ledger` the screen
 * already built, so every style agrees with Receivables. The chosen style is a device-local viewing
 * preference (`mrchartist_statement_prefs` in localStorage, never backed up).
 */
import { round2 } from './invoice-calc';
import type { Ledger, LedgerEntry, PartyReceivable } from './receivables';

export type StatementStyle = 'balance_forward' | 'open_items' | 'transactions';
export const STATEMENT_STYLES: readonly StatementStyle[] = ['balance_forward', 'open_items', 'transactions'];

export interface OpenItemRow {
  invoiceId: string;
  number: string;
  date: string;
  due: string;
  original: number;
  credited: number;
  received: number;
  open: number;
  daysOverdue: number;
}

/** The party's open bills as statement rows (oldest due first, as receivables sorts them). */
export function openItemRows(party: PartyReceivable): OpenItemRow[] {
  return party.bills.map((b) => ({
    invoiceId: b.invoiceId,
    number: b.number,
    date: b.issueDate,
    due: b.dueDate,
    original: b.total,
    credited: round2(b.credited ?? 0),
    received: round2(b.paid),
    open: b.outstanding,
    daysOverdue: Math.max(b.daysOverdue, 0),
  }));
}

export interface OpenItemTotals {
  open: number;
  /** Credit notes not allocated to a bill + advances / on-account money. */
  unallocated: number;
  /** open − unallocated = the party's net balance. */
  net: number;
}

export function openItemTotals(party: PartyReceivable, rows = openItemRows(party)): OpenItemTotals {
  const open = round2(rows.reduce((s, r) => s + r.open, 0));
  const unallocated = round2(party.creditNotes + party.advances);
  return { open, unallocated, net: round2(open - unallocated) };
}

/** Every entry in the ledger's range, oldest first, without a running balance. */
export function transactionRows(ledger: Ledger): Omit<LedgerEntry, 'balance'>[] {
  return ledger.entries.map(({ balance: _b, ...rest }) => rest);
}

export const AGEING_STRIP = ['Current', '1–30', '31–60', '61–90', '90+'] as const;
export type AgeingStripLabel = (typeof AGEING_STRIP)[number];

const dayNum = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, dd || 1) / 86400000);
};

/** Days past due on `asOf` → strip column. 0 or less is Current; 30 → 1–30; 31 → 31–60; 91 → 90+. */
export function stripBucket(daysPastDue: number): AgeingStripLabel {
  if (daysPastDue <= 0) return 'Current';
  if (daysPastDue <= 30) return '1–30';
  if (daysPastDue <= 60) return '31–60';
  if (daysPastDue <= 90) return '61–90';
  return '90+';
}

/** Open bills aged on `asOf` (local day). */
export function ageingStrip(party: PartyReceivable, asOf: string): Record<AgeingStripLabel, number> {
  const out = Object.fromEntries(AGEING_STRIP.map((b) => [b, 0])) as Record<AgeingStripLabel, number>;
  for (const b of party.bills) {
    const days = asOf && b.dueDate ? dayNum(asOf) - dayNum(b.dueDate) : 0;
    const k = stripBucket(days);
    out[k] = round2(out[k] + b.outstanding);
  }
  return out;
}

/**
 * Bulk statements skip a party (QBO behaviour): with no activity in the range for balance-forward /
 * transaction statements, and with a zero balance for open-item statements.
 */
export function skipInBulk(party: PartyReceivable, ledger: Ledger, style: StatementStyle): boolean {
  if (style === 'open_items') return party.bills.length === 0 || Math.abs(party.net) < 0.005;
  return ledger.entries.length === 0;
}

/* ── Device-local preference ──────────────────────────────────── */

export const STATEMENT_PREFS_KEY = 'mrchartist_statement_prefs';

export interface StatementPrefs {
  style: StatementStyle;
  ageing: boolean;
}

export const DEFAULT_STATEMENT_PREFS: StatementPrefs = { style: 'balance_forward', ageing: false };

export function normalizeStatementPrefs(raw: unknown): StatementPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    style: STATEMENT_STYLES.includes(o.style as StatementStyle) ? (o.style as StatementStyle) : DEFAULT_STATEMENT_PREFS.style,
    ageing: o.ageing === true,
  };
}

export function loadStatementPrefs(): StatementPrefs {
  try {
    const s = globalThis.localStorage?.getItem(STATEMENT_PREFS_KEY);
    return normalizeStatementPrefs(s ? JSON.parse(s) : null);
  } catch {
    return DEFAULT_STATEMENT_PREFS;
  }
}

export function saveStatementPrefs(p: StatementPrefs): void {
  try {
    globalThis.localStorage?.setItem(STATEMENT_PREFS_KEY, JSON.stringify(normalizeStatementPrefs(p)));
  } catch {
    /* a viewing preference: losing it is harmless */
  }
}
