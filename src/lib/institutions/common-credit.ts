/**
 * R5-C2 Rule 42 / 43 common-credit working for a mixed (exempt + taxable) supplier — a WORKING PAPER, verify with
 * your CA (§7 Q9).
 *
 * Rule 42 (inputs / input services), per tax head:
 *   T  = input tax on the month's bills;  T1 non-business, T2 exempt-only, T3 blocked (Sec 17(5) / not claimed);
 *   C1 = T − (T1 + T2 + T3);  T4 taxable-only;  C2 = C1 − T4;
 *   D1 = (E ÷ F) × C2  (E exempt turnover, F total turnover — exports / zero-rated count as taxable);
 *   D2 = 5% of C2, only when some input is tagged non-business;  C3 = C2 − D1 − D2.
 *   Reversal = T1 + T2 (claimed in full on the bills) + D1 + D2.
 * Rule 43 (capital goods used in common): Tm = Tc ÷ 60 for every month within 60 months of the bill; Te = Tm × E ÷ F.
 * Annual true-up: D1 / D2 on the FY's turnover vs the monthly reversals posted; the difference is reversed or
 * reclaimed (interest note), due with the return for September after the FY (`COMMON_CREDIT_TRUE_UP_RULES`).
 *
 * Reads `purchases` through `readPurchase` (purchases contract, Critical Rule 9). Posting: one journal
 * (Dr GST input credit reversed 6370 | Cr Input IGST / CGST / SGST / cess), class "ITC reversal — Rule 42 / 43".
 */
import type { CommonCreditRun, ItcUse } from '../../types/institutions-r5';
import { readPurchase, isVoidStatus } from '../purchase-normalize';
import { A } from '../ledger/accounts';
import { deleteVoucher, saveVoucher, type ManualVoucherLine } from '../ledger/vouchers';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { round2 } from '../invoice-calc';
import { toCsv } from '../csv';
import { COMMON_CREDIT_TRUE_UP_RULES, ruleAt } from '../r5c-rules';
import { COMMON_CREDIT_TABLE, R5cError, paise } from './r5c';

export type Head = 'igst' | 'cgst' | 'sgst' | 'cess';
export const HEADS: readonly Head[] = ['igst', 'cgst', 'sgst', 'cess'];
export type Heads = Record<Head, number>;
const zero = (): Heads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
const add = (a: Heads, b: Heads, k = 1) => HEADS.forEach((h) => (a[h] = round2(a[h] + b[h] * k)));
const sum = (h: Heads) => round2(h.igst + h.cgst + h.sgst + h.cess);

export const ITC_USES: readonly ItcUse[] = ['common', 'taxable_only', 'exempt_only', 'non_business', 'common_capital'];
export const itcUseOf = (raw: unknown): ItcUse => {
  const v = (raw as { itc_use?: unknown } | null)?.itc_use;
  return ITC_USES.includes(v as ItcUse) ? (v as ItcUse) : 'common';
};

export interface MonthInputs {
  T: Heads;
  T1: Heads;
  T2: Heads;
  T3: Heads;
  T4: Heads;
  /** Common capital goods: ITC (Tc) and bill day, every bill up to the month's end. */
  capital: { date: string; tc: Heads }[];
  nonBusiness: boolean;
}

/** Bill heads after any reversal already recorded on the bill. */
function billHeads(raw: unknown): { date: string; heads: Heads; eligible: boolean } | null {
  const c = readPurchase(raw);
  if (!c || isVoidStatus(c.status) || !c.date) return null;
  const tax = c.cgst + c.sgst + c.igst;
  const keep = tax > 0 ? Math.max(0, 1 - Math.min(c.itcReversed, tax) / tax) : 1;
  return { date: c.date, eligible: c.itcEligible, heads: { igst: round2(c.igst * keep), cgst: round2(c.cgst * keep), sgst: round2(c.sgst * keep), cess: round2(c.cess * keep) } };
}

/** T, T1–T4 and the capital goods for the days `from`…`to` from raw `purchases` rows. */
export function inputsFor(purchases: readonly unknown[], from: string, to: string): MonthInputs {
  const m: MonthInputs = { T: zero(), T1: zero(), T2: zero(), T3: zero(), T4: zero(), capital: [], nonBusiness: false };
  for (const raw of purchases) {
    const b = billHeads(raw);
    if (!b || b.date > to) continue;
    const use = itcUseOf(raw);
    if (use === 'common_capital') {
      if (b.eligible) m.capital.push({ date: b.date, tc: b.heads });
      continue;
    }
    if (b.date < from) continue;
    add(m.T, b.heads);
    if (!b.eligible) add(m.T3, b.heads);
    else if (use === 'non_business') {
      add(m.T1, b.heads);
      m.nonBusiness = true;
    } else if (use === 'exempt_only') add(m.T2, b.heads);
    else if (use === 'taxable_only') add(m.T4, b.heads);
  }
  return m;
}

export interface Rule42Result {
  T: Heads; T1: Heads; T2: Heads; T3: Heads; T4: Heads;
  C1: Heads; C2: Heads; D1: Heads; D2: Heads; C3: Heads;
  /** Rule 43: common credit of the month (Σ Tm) and the part to reverse (Te). */
  Tm: Heads; Te: Heads;
  /** Total to reverse by head: T1 + T2 + D1 + D2 + Te. */
  reverse: Heads;
  E: number; F: number; ratio: number;
}

/** Pure Rule 42 / 43 for one month (`month` = YYYY-MM). */
export function rule42(i: MonthInputs, E: number, F: number, month: string): Rule42Result {
  const rule = ruleAt(COMMON_CREDIT_TRUE_UP_RULES, `${month}-01`);
  const ratio = F > 0 ? Math.min(Math.max(E, 0) / F, 1) : 0;
  const r = { T: i.T, T1: i.T1, T2: i.T2, T3: i.T3, T4: i.T4, C1: zero(), C2: zero(), D1: zero(), D2: zero(), C3: zero(), Tm: zero(), Te: zero(), reverse: zero(), E: round2(E), F: round2(F), ratio: Math.round(ratio * 1e6) / 1e6 };
  for (const h of HEADS) {
    r.C1[h] = round2(i.T[h] - i.T1[h] - i.T2[h] - i.T3[h]);
    r.C2[h] = round2(r.C1[h] - i.T4[h]);
    r.D1[h] = round2(ratio * r.C2[h]);
    r.D2[h] = i.nonBusiness ? round2((r.C2[h] * rule.nonBusinessPct) / 100) : 0;
    r.C3[h] = round2(r.C2[h] - r.D1[h] - r.D2[h]);
  }
  const end = `${month}-31`;
  for (const c of i.capital) {
    const age = monthsBetween(c.date.slice(0, 7), month);
    if (age < 0 || age >= rule.capitalMonths || c.date > end) continue;
    for (const h of HEADS) r.Tm[h] = round2(r.Tm[h] + c.tc[h] / rule.capitalMonths);
  }
  for (const h of HEADS) {
    r.Te[h] = round2(r.Tm[h] * ratio);
    r.reverse[h] = round2(i.T1[h] + i.T2[h] + r.D1[h] + r.D2[h] + r.Te[h]);
  }
  return r;
}

const monthsBetween = (a: string, b: string) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));

/** E and F from a GSTR-3B summary of the period (exempt = nil / exempt + non-GST; zero-rated and RCM outward are taxable). */
export function turnoverOf(g3: { outward: { taxable: { taxable: number }; zeroRated: { taxable: number }; nilExempt: { inter: number; intra: number }; nonGst: number }; outwardRcmTaxable?: number; ecoSupplies95?: number }): { E: number; F: number } {
  const o = g3.outward;
  const E = round2(o.nilExempt.inter + o.nilExempt.intra + o.nonGst);
  return { E, F: round2(E + o.taxable.taxable + o.zeroRated.taxable + (g3.outwardRcmTaxable ?? 0) + (g3.ecoSupplies95 ?? 0)) };
}

/**
 * Annual true-up: D1 + D2 recomputed on the FY's C2 and turnover vs what the monthly runs reversed for D1 + D2.
 * Positive = reverse more (interest from the first day after the FY — note only), negative = reclaim.
 */
export function trueUp(months: readonly { C2: Heads; nonBusiness: boolean }[], E: number, F: number, postedD: Heads, fy: number): { annual: Heads; posted: Heads; diff: Heads; dueBy: string } {
  const rule = ruleAt(COMMON_CREDIT_TRUE_UP_RULES, `${fy + 1}-03-31`);
  const ratio = F > 0 ? Math.min(Math.max(E, 0) / F, 1) : 0;
  const c2 = zero();
  for (const m of months) add(c2, m.C2);
  const nb = months.some((m) => m.nonBusiness);
  const annual = zero();
  const diff = zero();
  for (const h of HEADS) {
    annual[h] = round2(ratio * c2[h] + (nb ? (c2[h] * rule.nonBusinessPct) / 100 : 0));
    diff[h] = round2(annual[h] - postedD[h]);
  }
  const m = rule.trueUpByMonth;
  return { annual, posted: postedD, diff, dueBy: `${m >= 4 ? fy + 1 : fy + 2}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-20` };
}

/* ── Runs (posting) ──────────────────────────────────────────── */

export const loadCcRuns = (): CommonCreditRun[] => peekTable<CommonCreditRun>(COMMON_CREDIT_TABLE).filter((r) => r && r.id) as CommonCreditRun[];

const INPUT: Record<Head, string> = { igst: A.inIgst, cgst: A.inCgst, sgst: A.inSgst, cess: A.inCess };

/** Balanced journal lines for a reversal by head (negative heads = reclaim). */
export function reversalLines(heads: Heads): ManualVoucherLine[] {
  const lines: ManualVoucherLine[] = [];
  let net = 0;
  for (const h of HEADS) {
    const p = paise(heads[h]);
    if (!p) continue;
    net += p;
    lines.push(p > 0 ? { account_id: INPUT[h], dr: 0, cr: p } : { account_id: INPUT[h], dr: -p, cr: 0 });
  }
  if (net) lines.unshift(net > 0 ? { account_id: A.itcReversed, dr: net, cr: 0 } : { account_id: A.itcReversed, dr: 0, cr: -net });
  return lines;
}

/** Post a monthly (`YYYY-MM`) or annual (`FY2025-26`) reversal once: journal + run row, all or nothing. */
export function postReversal(input: { month: string; kind: 'monthly' | 'annual'; heads: Heads; figures: Record<string, number>; date: string }): CommonCreditRun {
  requireAccess('books.edit');
  if (loadCcRuns().some((r) => r.month === input.month && r.kind === input.kind)) throw new R5cError('posted');
  const lines = reversalLines(input.heads);
  if (lines.length < 2) throw new R5cError('nothing');
  return withTablesRollback([COMMON_CREDIT_TABLE, 'vouchers'], () => {
    const v = saveVoucher({ type: 'JOURNAL', date: input.date, narration: `ITC reversal ${input.kind === 'annual' ? 'annual true-up' : ''} ${input.month} — Rule 42 / 43 common credit (GSTR-3B 4(B)(1)); working paper, verify with your CA`.replace(/\s+/g, ' '), lines, voucher_class: 'ITC reversal — Rule 42 / 43' });
    const row: CommonCreditRun = { id: generateId(), month: input.month, kind: input.kind, figures: input.figures, heads: { ...input.heads }, journal_id: v.id, date: input.date, created_at: new Date().toISOString() };
    setTable(COMMON_CREDIT_TABLE, [...getTable<CommonCreditRun>(COMMON_CREDIT_TABLE), row]);
    return row;
  });
}

/** Undo a posted run (its journal is deleted: period lock, recycle bin). */
export function unpostReversal(id: string): void {
  requireAccess('books.edit');
  const row = loadCcRuns().find((r) => r.id === id);
  if (!row) return;
  withTablesRollback([COMMON_CREDIT_TABLE, 'vouchers'], () => {
    if (row.journal_id) deleteVoucher(row.journal_id);
    setTable(COMMON_CREDIT_TABLE, getTable<CommonCreditRun>(COMMON_CREDIT_TABLE).filter((r) => r.id !== id));
  });
}

/** Flat figures of a result (for the run row and the CSV). */
export function figuresOf(r: Rule42Result): Record<string, number> {
  const out: Record<string, number> = { E: r.E, F: r.F, ratio: r.ratio };
  for (const k of ['T', 'T1', 'T2', 'T3', 'T4', 'C1', 'C2', 'D1', 'D2', 'C3', 'Tm', 'Te', 'reverse'] as const) out[k] = sum(r[k]);
  return out;
}

/** Working-paper CSV: every figure by head, with its label (formula) line. */
export function workingCsv(r: Rule42Result, month: string, label: (k: string) => string, note: string): string {
  const rows: unknown[][] = [['Month', month], ['E', r.E], ['F', r.F], ['E / F', r.ratio], [], ['', '', 'IGST', 'CGST', 'SGST', 'Cess', 'Total']];
  for (const k of ['T', 'T1', 'T2', 'T3', 'C1', 'T4', 'C2', 'D1', 'D2', 'C3', 'Tm', 'Te', 'reverse'] as const) rows.push([k, label(k), ...HEADS.map((h) => r[k][h]), sum(r[k])]);
  rows.push([], [note]);
  return toCsv(rows);
}

export { sum as headsTotal };
