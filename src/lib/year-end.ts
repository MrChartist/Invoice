/**
 * Year-end ("Start new year", WP-7 / P1-20): the checklist a CA runs before the books of a financial
 * year are closed, the Tally "Split Company Data" moment presented as one screen.
 *
 *   1. integrity     — the books integrity check (TB balances, orphaned links, negative cash days);
 *   2. closing_stock — stock value on 31 March. When report-time valuation (WP-2,
 *                      `mrchartist_inv_closing_stock`) is on, the step only shows the valued figure and
 *                      is satisfied; a journal (Dr Stock-in-hand | Cr Purchases, reversed on 1 April) is
 *                      offered only when valuation is off. Reports net any such journal off the valuation
 *                      (`netOfStockJournals`), so the stock is never counted twice;
 *   3. depreciation  — the fixed-asset register's depreciation for the year (posted automatically on
 *                      31 March); warns when fixed-asset ledgers hold amounts the register does not know;
 *   4. provisions    — year-end provisions journal (Dr expense | Cr Provisions), reversed on 1 April;
 *   5. opening_bills — party balances carried into the new year and old opening bills still open;
 *   6. lock          — lock the year (period lock up to 31 March);
 *   7. carry_forward — the balances the new year opens with (BS ledgers; the year's profit moves to
 *                      Reserves & surplus), as a report / CSV.
 *
 * The balances need no copying: the ledger carries them forward by itself (opening = closing of the
 * year before). Marks of reviewed steps are kept per FY in table `year_end` (backed up, audited).
 * Pure functions + thin storage helpers. Working paper — verify with your CA.
 */

import { A, groupOf, type Account } from './ledger/accounts';
import type { Ledger } from './ledger/postings';
import { closingBalances, openingBalances } from './ledger/reports';
import type { FixedAsset } from './ledger/assets';
import { depreciationSchedule } from './ledger/assets';
import type { ManualVoucher } from './ledger/vouchers';
import type { IntegrityReport } from './books-integrity';
import { toCsv } from './csv';

export const YEAR_END_TABLE = 'year_end';
export { CLOSING_STOCK_CLASS } from './ledger/closing-stock';
import { CLOSING_STOCK_CLASS, type ClosingStockMode } from './ledger/closing-stock';
export const PROVISION_CLASS = 'Year-end provision';

export type YearEndStepId = 'integrity' | 'closing_stock' | 'depreciation' | 'provisions' | 'opening_bills' | 'lock' | 'carry_forward';
export const YEAR_END_STEPS: readonly YearEndStepId[] = ['integrity', 'closing_stock', 'depreciation', 'provisions', 'opening_bills', 'lock', 'carry_forward'];

export type StepStatus = 'done' | 'todo' | 'warn';

export interface YearEndStep {
  id: YearEndStepId;
  status: StepStatus;
  /** Amount the step is about (paise), when there is one. */
  amount?: number;
  /** Short facts for the screen (already English; the screen adds the translated title). */
  facts: string[];
}

/** One row per FY: `id` = 'FY25-26'. */
export interface YearEndRecord {
  id: string;
  /** Step → ISO time it was marked reviewed / done. */
  marks: Partial<Record<YearEndStepId, string>>;
  created_at?: string;
  updated_at?: string;
}

export const fyId = (startYear: number) => `FY${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;
export const fyEndOf = (startYear: number) => `${startYear + 1}-03-31`;
export const nextFyStart = (startYear: number) => `${startYear + 1}-04-01`;

export interface YearEndInput {
  fyStart: number;
  ledger: Ledger;
  integrity: IntegrityReport;
  /** Inventory valuation at 31 March (paise) and the number of stock items valued. */
  closingStock: { value: number; items: number };
  /**
   * Report-time closing-stock valuation (WP-2, `mrchartist_inv_closing_stock`) in effect for this
   * company: when it is on, statements already carry the stock and the step posts nothing.
   */
  valuation?: { mode: ClosingStockMode; label: string; value: number };
  assets: readonly FixedAsset[];
  manual: readonly ManualVoucher[];
  lockUntil: string;
  /** Opening bills dated before the FY start that are still open (count, paise). */
  oldOpenBills: { count: number; amount: number };
  record?: YearEndRecord;
  today: string;
}

const rs = (p: number) => `₹${(Math.abs(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Party balances on a control account at the end of `date` (paise, debit-positive). */
export function partyBalancesAt(ledger: Ledger, account: string, date: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of ledger.vouchers) {
    if (v.date > date) continue;
    for (const l of v.lines) {
      if (l.account !== account) continue;
      const p = l.party || '(no party)';
      out.set(p, (out.get(p) ?? 0) + l.dr - l.cr);
    }
  }
  for (const [k, v] of out) if (v === 0) out.delete(k);
  return out;
}

/** The checklist with each step's status (pure). */
export function yearEndChecklist(input: YearEndInput): YearEndStep[] {
  const end = fyEndOf(input.fyStart);
  const marks = input.record?.marks ?? {};
  const steps: YearEndStep[] = [];

  /* 1. Integrity */
  const errors = input.integrity.issues.filter((i) => i.severity === 'error').length;
  const warnings = input.integrity.issues.length - errors;
  steps.push({
    id: 'integrity',
    status: errors ? 'warn' : marks.integrity || !warnings ? 'done' : 'todo',
    facts: [
      input.integrity.totals.diff === 0 ? `Trial balance agrees: ${rs(input.integrity.totals.dr)} Dr = Cr.` : `Trial balance differs by ${rs(input.integrity.totals.diff)}.`,
      `${errors} problem${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}.`,
    ],
  });

  /* 2. Closing stock */
  const autoStock = input.ledger.vouchers.some((v) => /closing\s*stock/i.test(v.kind) || v.id.startsWith('cls:'));
  const stockJv = input.manual.find((v) => v.voucher_class === CLOSING_STOCK_CLASS && v.date === end);
  const valued = input.valuation && input.valuation.mode !== 'none' ? input.valuation : undefined;
  if (valued) {
    // Report-time valuation (WP-2) already carries closing stock in every statement: nothing to post.
    steps.push({
      id: 'closing_stock',
      status: 'done',
      amount: valued.value,
      facts: [
        `Stock on ${end}: ${rs(valued.value)} (${valued.label}), valued at report time in the P&L and balance sheet.`,
        stockJv
          ? `Journal ${stockJv.number} also books closing stock; reports show the valuation net of it, so nothing is counted twice. Delete the journal (or stop valuing stock) to keep one method.`
          : 'Nothing to post: a closing-stock journal would count the stock twice.',
      ],
    });
  } else {
    steps.push({
      id: 'closing_stock',
      status: autoStock || stockJv || marks.closing_stock ? 'done' : input.closingStock.items ? 'todo' : 'done',
      amount: input.closingStock.value,
      facts: [
        input.closingStock.items ? `Stock on ${end}: ${rs(input.closingStock.value)} (${input.closingStock.items} item${input.closingStock.items === 1 ? '' : 's'}, inventory valuation).` : 'No stock items are tracked.',
        autoStock ? 'The P&L already carries closing stock.' : stockJv ? `Posted as ${stockJv.number}.` : 'Stock is not valued at report time and not posted to the books yet.',
      ],
    });
  }

  /* 3. Depreciation */
  let dep = 0;
  for (const a of input.assets) for (const r of depreciationSchedule(a, input.today)) if (r.fyStartYear === input.fyStart) dep += r.depreciation;
  const faBalance = [...closingBalances(input.ledger, end)].filter(([id]) => {
    const acc = input.ledger.byId.get(id);
    return acc?.group === 'FIXED_ASSETS' && id !== A.accDep;
  }).reduce((s, [, v]) => s + v, 0);
  const registerCost = input.assets.filter((a) => a.acquired_on <= end).reduce((s, a) => s + Math.round(a.cost * 100), 0);
  const unregistered = faBalance - registerCost;
  steps.push({
    id: 'depreciation',
    status: unregistered > 100 ? 'warn' : 'done',
    amount: dep,
    facts: [
      dep ? `Depreciation for the year: ${rs(dep)} (posted on ${end} by the fixed-asset register).` : 'No depreciation for the year.',
      ...(unregistered > 100 ? [`Fixed-asset ledgers hold ${rs(unregistered)} more than the asset register: add those assets to the register so depreciation is worked out.`] : []),
    ],
  });

  /* 4. Provisions */
  const provisions = input.manual.filter((v) => v.voucher_class === PROVISION_CLASS && v.date === end);
  steps.push({
    id: 'provisions',
    status: provisions.length || marks.provisions ? 'done' : 'todo',
    amount: provisions.reduce((s, v) => s + v.lines.reduce((t, l) => t + l.dr, 0), 0),
    facts: [provisions.length ? `${provisions.length} provision journal${provisions.length === 1 ? '' : 's'} on ${end}.` : 'No year-end provisions recorded (audit fee, salaries / rent payable, bonus …).'],
  });

  /* 5. Opening bills for the new year */
  const debtors = partyBalancesAt(input.ledger, A.debtors, end);
  const creditors = partyBalancesAt(input.ledger, A.creditors, end);
  const recv = [...debtors.values()].reduce((s, v) => s + v, 0);
  const pay = -[...creditors.values()].reduce((s, v) => s + v, 0);
  steps.push({
    id: 'opening_bills',
    status: input.oldOpenBills.count && !marks.opening_bills ? 'warn' : marks.opening_bills ? 'done' : 'todo',
    facts: [
      `${debtors.size} customer${debtors.size === 1 ? '' : 's'} carry ${rs(recv)} receivable and ${creditors.size} supplier${creditors.size === 1 ? '' : 's'} ${rs(pay)} payable into ${fyId(input.fyStart + 1)}; their bills travel with the invoices and bills, nothing is re-entered.`,
      ...(input.oldOpenBills.count ? [`${input.oldOpenBills.count} opening bill${input.oldOpenBills.count === 1 ? ' is' : 's are'} still open from before this year (${rs(input.oldOpenBills.amount)}): settle or write them off.`] : []),
    ],
  });

  /* 6. Lock */
  const locked = !!input.lockUntil && input.lockUntil >= end;
  steps.push({ id: 'lock', status: locked ? 'done' : 'todo', facts: [locked ? `Books are locked up to ${input.lockUntil}.` : input.lockUntil ? `Locked only up to ${input.lockUntil}.` : 'The year is not locked.'] });

  /* 7. Carry forward */
  steps.push({ id: 'carry_forward', status: marks.carry_forward ? 'done' : 'todo', facts: ['Opening balances of the new year = closing balances of this year (the profit moves to Reserves & surplus).'] });
  return steps;
}

export interface CarryRow {
  account: Account;
  /** Debit-positive paise at the start of the new year. */
  balance: number;
}

/** The new year's opening balances (balance-sheet ledgers; the year's result is inside Reserves). */
export function carryForward(ledger: Ledger, fyStart: number): { rows: CarryRow[]; profit: number; dr: number; cr: number } {
  const open = openingBalances(ledger, nextFyStart(fyStart));
  const close = closingBalances(ledger, fyEndOf(fyStart));
  let profit = 0;
  for (const a of ledger.accounts) {
    const n = groupOf(a.group).nature;
    if (n === 'income' || n === 'expense') profit -= close.get(a.id) ?? 0;
  }
  const rows: CarryRow[] = [];
  let dr = 0;
  let cr = 0;
  for (const a of ledger.accounts) {
    const b = open.get(a.id) ?? 0;
    if (!b) continue;
    rows.push({ account: a, balance: b });
    if (b > 0) dr += b;
    else cr -= b;
  }
  return { rows, profit, dr, cr };
}

export function carryForwardCsv(c: ReturnType<typeof carryForward>, fyStart: number): string {
  const rows: unknown[][] = [[`Opening balances for ${fyId(fyStart + 1)} (working paper — verify with your CA)`], ['Code', 'Ledger', 'Group', 'Dr', 'Cr']];
  for (const r of c.rows) rows.push([r.account.code, r.account.name, groupOf(r.account.group).label, r.balance > 0 ? (r.balance / 100).toFixed(2) : '', r.balance < 0 ? (-r.balance / 100).toFixed(2) : '']);
  rows.push(['', 'Total', '', (c.dr / 100).toFixed(2), (c.cr / 100).toFixed(2)]);
  rows.push(['', `${c.profit >= 0 ? 'Profit' : 'Loss'} for ${fyId(fyStart)} carried to Reserves & surplus`, '', '', (Math.abs(c.profit) / 100).toFixed(2)]);
  return toCsv(rows);
}

/** A provisions / closing-stock journal for `saveVoucher` (lines in paise; reversed on 1 April when asked). */
export function yearEndJournal(kind: 'provision' | 'closing_stock', fyStart: number, lines: Array<{ account_id: string; amount: number }>, reverse = true): {
  type: 'JOURNAL'; date: string; narration: string; voucher_class: string; reverse_on?: string; lines: Array<{ account_id: string; dr: number; cr: number }>;
} {
  const total = lines.reduce((s, l) => s + Math.max(0, Math.round(l.amount)), 0);
  const end = fyEndOf(fyStart);
  if (kind === 'closing_stock') {
    return {
      type: 'JOURNAL', date: end, voucher_class: CLOSING_STOCK_CLASS,
      narration: `Closing stock on ${end} (inventory valuation)${reverse ? '; reversed on 1 April as opening stock' : ''}`,
      ...(reverse ? { reverse_on: nextFyStart(fyStart) } : {}),
      lines: [{ account_id: A.stock, dr: total, cr: 0 }, { account_id: A.purchases, dr: 0, cr: total }],
    };
  }
  return {
    type: 'JOURNAL', date: end, voucher_class: PROVISION_CLASS,
    narration: `Year-end provisions ${fyId(fyStart)}${reverse ? '; reversed on 1 April' : ''}`,
    ...(reverse ? { reverse_on: nextFyStart(fyStart) } : {}),
    lines: [
      ...lines.filter((l) => l.amount > 0).map((l) => ({ account_id: l.account_id, dr: Math.round(l.amount), cr: 0 })),
      { account_id: A.provisions, dr: 0, cr: total },
    ],
  };
}

export function markStep(rec: YearEndRecord | undefined, fyStart: number, step: YearEndStepId, at: string): YearEndRecord {
  const base: YearEndRecord = rec ?? { id: fyId(fyStart), marks: {}, created_at: at };
  return { ...base, marks: { ...base.marks, [step]: at }, updated_at: at };
}
