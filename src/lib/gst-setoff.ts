/**
 * GST set-off and payment posting (WP-6, P0-6) — Tally's "GST adjustment" journal and "Stat Payment".
 *
 *  - `planSetOff(gstr3b, …)`: from a GSTR-3B period, the liability by head (output IGST / CGST / SGST / cess and
 *    reverse charge), the input tax credit used in the statutory order (computed by `computeSetOff` with the
 *    date-keyed `gstSetOffOrder` in tax-rules.ts — Rule 88A today), the tax left to pay in cash, and Sec 50(1)
 *    interest / Sec 47 late fee estimates from `gst-penalties.ts`.
 *  - `postSetOff`: one journal voucher through the public `saveVoucher` API — Dr Output heads, Dr GST payable
 *    (reverse charge), Dr Interest / Late fee ledgers | Cr Input heads (ITC used), Cr GST electronic cash ledger
 *    (2360). A credit balance left on 2360 is tax still to be deposited ("GST payable").
 *  - PMT-06 challans (`gst_challans`): CPIN, CIN / BRN, dates and amounts by major head (IGST / CGST / SGST / cess)
 *    × minor head (tax / interest / penalty / fee / others). Recording the deposit posts a payment voucher
 *    Dr GST electronic cash ledger | Cr Bank.
 *
 * Every figure is a working paper — the GST portal's own set-off screen and the PMT-06 are what count. Verify with
 * your CA. Dates are bare local `YYYY-MM-DD` days (never `new Date(str)`).
 */

import { requireAccess } from './access';
import { audit } from './audit';
import { returnsForMonth, type FilerFrequency } from './compliance';
import { isoDay } from './dates';
import { gstInterest, lateDays, returnLateFee } from './gst-penalties';
import { computeSetOff, periodRange, type Gstr3bReport, type ReportPeriod } from './gst-reports';
import { num, round2 } from './invoice-calc';
import { A, ACCOUNTS_TABLE, DEFAULT_ACCOUNTS, chartOf, loadUserAccounts, type Account } from './ledger/accounts';
import { deleteVoucher, loadVouchers, rupeesToPaise, saveVoucher, type ManualVoucherLine } from './ledger/vouchers';
import { isCashOrBankLedger } from './bank-ledgers';
import { generateId, getTable, setTable } from './storage';
import { gstSetOffOrder, rule86b } from './tax-rules';

export const GST_SETOFFS_TABLE = 'gst_setoffs';
export const GST_CHALLANS_TABLE = 'gst_challans';

/** Shown under every set-off / challan output (Critical Rule 10). */
export const SETOFF_DISCLAIMER = 'Working paper — not filed anywhere. The GST portal set-off and PMT-06 are what count; verify with your CA.';

export type GstHead = 'igst' | 'cgst' | 'sgst' | 'cess';
export const GST_HEADS: readonly GstHead[] = ['igst', 'cgst', 'sgst', 'cess'];
export const GST_HEAD_LABELS: Record<GstHead, string> = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST / UTGST', cess: 'Cess' };

/** PMT-06 minor heads. */
export type MinorHead = 'tax' | 'interest' | 'penalty' | 'fee' | 'others';
export const MINOR_HEADS: readonly MinorHead[] = ['tax', 'interest', 'penalty', 'fee', 'others'];
export const MINOR_HEAD_LABELS: Record<MinorHead, string> = { tax: 'Tax', interest: 'Interest', penalty: 'Penalty', fee: 'Fee', others: 'Others' };

export type Heads = Record<GstHead, number>;
export type ChallanAmounts = Record<GstHead, Record<MinorHead, number>>;

export const zeroHeads = (): Heads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
export const sumHeads = (h: Partial<Heads>): number => round2(GST_HEADS.reduce((s, k) => s + num(h[k]), 0));
const addHeads = (...hs: Heads[]): Heads => {
  const o = zeroHeads();
  for (const h of hs) for (const k of GST_HEADS) o[k] = round2(o[k] + num(h[k]));
  return o;
};

/* ── Periods ───────────────────────────────────────────────────── */

/** Same keys as the compliance calendar: `2025-04` (month), `2025-Q1` (FY quarter), `FY2025`. */
export function periodKeyOf(p: ReportPeriod): string {
  if (p.kind === 'month') {
    const { from } = periodRange(p);
    return from.slice(0, 7);
  }
  if (p.kind === 'quarter') return `${p.fyStart}-Q${p.quarter ?? 1}`;
  return `FY${p.fyStart}`;
}

export interface ThreeBDue {
  /** `GSTR3B` for a return period; `PMT06` for months 1–2 of a QRMP quarter (deposit only, no return). */
  form: 'GSTR3B' | 'PMT06' | 'NONE';
  due: string;
}

/**
 * Due date of the GSTR-3B (or the QRMP PMT-06 deposit) for `period`, from the compliance calendar (date-keyed
 * days in tax-rules.ts). A whole FY is not a 3B period (`NONE`).
 */
export function threeBDue(period: ReportPeriod, frequency: FilerFrequency = 'monthly', stateCode?: string): ThreeBDue {
  if (period.kind === 'fy') return { form: 'NONE', due: '' };
  const { to } = periodRange(period);
  const y = +to.slice(0, 4);
  const m = +to.slice(5, 7);
  const freq: FilerFrequency = period.kind === 'quarter' ? 'qrmp' : frequency === 'composition' ? 'monthly' : frequency;
  const rows = returnsForMonth(y, m, freq, stateCode);
  const r = rows.find((x) => x.form === 'GSTR3B') ?? rows.find((x) => x.form === 'PMT06');
  return r ? { form: r.form === 'GSTR3B' ? 'GSTR3B' : 'PMT06', due: r.due } : { form: 'NONE', due: '' };
}

/* ── Plan ──────────────────────────────────────────────────────── */

export interface SetOffPlan {
  periodKey: string;
  from: string;
  to: string;
  /** Output tax (3.1(a) + (b)), by head. */
  liability: Heads;
  /** Reverse-charge tax (3.1(d)): cash only. */
  rcLiability: Heads;
  /** Net ITC (4C) of the period plus the credit carried in (`itcOpening`); a head may be negative (7O). */
  itcAvailable: Heads;
  /** Additive (7O, 7.91): unutilised ITC carried in from the last posted set-off (`carryForwardFor`). */
  itcOpening?: Heads;
  /**
   * Additive (7O, 7.91): credit still negative after the carry-in (4C below zero — reversals exceed the
   * credit): paid in cash and restored to the input ledger by the journal. Flag for your CA.
   */
  itcNegative?: Heads;
  /** ITC consumed per CREDIT head (what leaves each input ledger). */
  itcUsed: Heads;
  /** The utilisation matrix [credit head][liability head], as in Table 6.1. */
  itcMatrix: {
    igst: { igst: number; cgst: number; sgst: number };
    cgst: { cgst: number; igst: number };
    sgst: { sgst: number; igst: number };
    cess: { cess: number };
  };
  itcCarry: Heads;
  /** Tax to pay in cash (liability not covered by ITC + all reverse-charge tax). */
  cashTax: Heads;
  /** Sec 50(1) interest on `cashTax` paid after the due date. */
  interest: Heads;
  /** Sec 47 late fee, split half CGST / half SGST. */
  lateFee: Heads;
  /** cashTax + interest + lateFee by head. */
  totalCash: Heads;
  due: string;
  paidOn: string;
  daysLate: number;
  /** Codes: RULE_86B, UNADJUSTED_CREDIT, NOT_A_3B_PERIOD, NOTHING_TO_SET_OFF, NEGATIVE_NET_ITC (7O). */
  warnings: string[];
}

export interface PlanOptions {
  period: ReportPeriod;
  /** 3B due date (`threeBDue`). Empty = no interest / late fee. */
  due: string;
  /** Filing / payment day; defaults to the due date. */
  paidOn?: string;
  /** Preceding-FY aggregate turnover (₹) — picks the late-fee cap. */
  turnover?: number;
  /** Nil return (no supplies, no liability): lower late fee. Default: derived from the liability. */
  nil?: boolean;
  includeInterest?: boolean;
  includeLateFee?: boolean;
  /**
   * Additive (7O, 7.91): ITC carried in by head from the previous posted set-off (`carryForwardFor`). It joins
   * the period's 4C before the utilisation order is applied. Omit (or zeros) = the period's own 4C only.
   */
  openingItc?: Partial<Heads>;
}

/** Cess figures out of a 3B payment (older reports carry only `cess` = the cash figure). */
function cessParts(p: Gstr3bReport['payment']): { liability: number; rc: number; used: number; carry: number } {
  const cash = Math.max(num(p.cess), 0);
  if (p.cessLiability === undefined) return { liability: cash, rc: 0, used: 0, carry: 0 };
  const liability = Math.max(num(p.cessLiability), 0);
  const used = Math.max(num(p.cessItcUsed), 0);
  return { liability, used, rc: Math.max(round2(cash - (liability - used)), 0), carry: Math.max(num(p.cessItcCarry), 0) };
}

export function planSetOff(g3: Gstr3bReport, o: PlanOptions): SetOffPlan {
  const { from, to } = periodRange(o.period);
  const p = g3.payment;
  const cess = cessParts(p);
  const liability: Heads = { ...p.liability, cess: cess.liability };
  const rcLiability: Heads = { ...p.rcLiability, cess: cess.rc };
  // 7O (7.91): carry-in + a negative 4C. Credit = 4C (signed) + opening; the order is re-run on it.
  const signed = g3.itc.netSigned ?? g3.itc.net;
  const opening: Heads = cleanHeads(o.openingItc ?? {});
  const available: Heads = addHeads({ igst: signed.igst, cgst: signed.cgst, sgst: signed.sgst, cess: signed.cess }, opening);
  const recompute = sumHeads(opening) !== 0 || !!g3.itc.netSigned;
  let u = p.itcUsed;
  let cash3: { igst: number; cgst: number; sgst: number } = p.cash;
  let carry3: { igst: number; cgst: number; sgst: number } = p.itcCarry;
  const negative = zeroHeads();
  if (recompute) {
    const credit = { igst: Math.max(available.igst, 0), cgst: Math.max(available.cgst, 0), sgst: Math.max(available.sgst, 0) };
    const r = computeSetOff(p.liability, credit, p.rcLiability, gstSetOffOrder(from));
    u = r.itcUsed;
    cash3 = r.cash;
    carry3 = r.itcCarry;
    const usableCess = Math.max(available.cess, 0);
    cess.used = round2(Math.min(cess.liability, usableCess));
    cess.carry = round2(usableCess - cess.used);
    for (const k of GST_HEADS) negative[k] = round2(Math.max(-available[k], 0));
  }
  const itcUsed: Heads = {
    igst: round2(u.igst.igst + u.igst.cgst + u.igst.sgst),
    cgst: round2(u.cgst.cgst + u.cgst.igst),
    sgst: round2(u.sgst.sgst + u.sgst.igst),
    cess: round2(cess.used),
  };
  const cashTax: Heads = addHeads({ ...cash3, cess: round2(cess.liability - cess.used + cess.rc) }, negative);
  const due = isoDay(o.due);
  const paidOn = isoDay(o.paidOn) || due;
  const daysLate = due && paidOn ? lateDays(due, paidOn) : 0;
  const interest = zeroHeads();
  if (o.includeInterest !== false && due && daysLate > 0) {
    for (const k of GST_HEADS) interest[k] = gstInterest(cashTax[k], due, paidOn, from);
  }
  const lateFee = zeroHeads();
  const warnings: string[] = [];
  if (o.period.kind === 'fy') warnings.push('NOT_A_3B_PERIOD');
  const anyLiability = sumHeads(liability) + sumHeads(rcLiability) > 0;
  if (o.includeLateFee !== false && due && daysLate > 0) {
    const fee = returnLateFee({ due, filedOn: paidOn, periodStart: from, nil: o.nil ?? !anyLiability, turnover: o.turnover });
    lateFee.cgst = round2(fee / 2);
    lateFee.sgst = round2(fee - lateFee.cgst);
  }
  const rule = rule86b(from);
  if (rule) {
    const months = o.period.kind === 'quarter' ? 3 : 1;
    const outTax = sumHeads({ ...p.liability });
    const cashOut = round2(sumHeads({ ...p.cash }) - (p.rcLiability.igst + p.rcLiability.cgst + p.rcLiability.sgst));
    if (g3.outward.taxable.taxable / months > rule.monthlyTaxable && outTax > 0 && cashOut < round2((outTax * rule.cashPct) / 100)) warnings.push('RULE_86B');
  }
  const ua = g3.unadjustedCredit;
  if (ua.igst > 0 || ua.cgst > 0 || ua.sgst > 0) warnings.push('UNADJUSTED_CREDIT');
  if (sumHeads(negative) > 0) warnings.push('NEGATIVE_NET_ITC');
  const totalCash = addHeads(cashTax, interest, lateFee);
  if (!anyLiability && sumHeads(totalCash) === 0) warnings.push('NOTHING_TO_SET_OFF');
  return {
    periodKey: periodKeyOf(o.period),
    from,
    to,
    liability,
    rcLiability,
    itcAvailable: recompute ? available : { igst: g3.itc.net.igst, cgst: g3.itc.net.cgst, sgst: g3.itc.net.sgst, cess: g3.itc.net.cess },
    ...(sumHeads(opening) !== 0 ? { itcOpening: opening } : {}),
    ...(sumHeads(negative) > 0 ? { itcNegative: negative } : {}),
    itcUsed,
    itcMatrix: { igst: { ...u.igst }, cgst: { ...u.cgst }, sgst: { ...u.sgst }, cess: { cess: round2(cess.used) } },
    itcCarry: { ...carry3, cess: cess.carry },
    cashTax,
    interest,
    lateFee,
    totalCash,
    due,
    paidOn,
    daysLate,
    warnings,
  };
}

/* ── Ledgers ───────────────────────────────────────────────────── */

/** Expense ledgers for interest and late fee. Created as user accounts (stable ids) the first time they are needed. */
export const GST_LEDGERS = {
  interest: { id: 'gst_interest', code: '6385', name: 'Interest on GST (Sec 50)' },
  lateFee: { id: 'gst_late_fee', code: '6386', name: 'Late fee on GST returns (Sec 47)' },
} as const;

export const OUTPUT_ACCOUNT: Record<GstHead, string> = { igst: A.outIgst, cgst: A.outCgst, sgst: A.outSgst, cess: A.outCess };
export const INPUT_ACCOUNT: Record<GstHead, string> = { igst: A.inIgst, cgst: A.inCgst, sgst: A.inSgst, cess: A.inCess };

/**
 * Ids of the interest / late-fee ledgers, adding them to `accounts` when missing. An existing account with the same
 * name is reused; a taken code gets a `-n` suffix. Audited like a ledger creation.
 */
export function ensureGstLedgers(): { interest: string; lateFee: string } {
  const stored = getTable<Record<string, unknown>>(ACCOUNTS_TABLE).filter((r) => r && typeof r === 'object');
  const chart = chartOf(loadUserAccounts());
  const out = { interest: '', lateFee: '' };
  const add: Record<string, unknown>[] = [];
  for (const key of ['interest', 'lateFee'] as const) {
    const def = GST_LEDGERS[key];
    const byId = chart.find((a) => a.id === def.id);
    const byName = chart.find((a) => a.name.toLowerCase() === def.name.toLowerCase());
    if (byId || byName) {
      out[key] = (byId ?? byName)!.id;
      continue;
    }
    const codes = new Set([...chart, ...add.map((a) => a as unknown as Account)].map((a) => String(a.code).toLowerCase()));
    let code: string = def.code;
    for (let n = 1; codes.has(code.toLowerCase()); n++) code = `${def.code}-${n}`;
    add.push({ id: def.id, code, name: def.name, group: 'INDIRECT_EXPENSES', created_at: new Date().toISOString() });
    out[key] = def.id;
  }
  if (add.length) {
    setTable(ACCOUNTS_TABLE, [...stored, ...add]);
    for (const a of add) {
      audit.record({ entity: 'account', entity_id: String(a.id), action: 'create', doc_number: String(a.code), summary: `Account ${String(a.code)} “${String(a.name)}” added under Other (indirect) expenses (GST set-off)` });
    }
  }
  return out;
}

/* ── Set-off journal ───────────────────────────────────────────── */

/**
 * Journal lines (integer paise) for a plan. The cash-ledger credit is the balancing figure, so the voucher always
 * balances exactly. Lines with a zero amount are left out.
 */
export function setOffVoucherLines(plan: SetOffPlan, ledgers: { interest: string; lateFee: string } = { interest: GST_LEDGERS.interest.id, lateFee: GST_LEDGERS.lateFee.id }): ManualVoucherLine[] {
  const dr: ManualVoucherLine[] = [];
  const cr: ManualVoucherLine[] = [];
  const D = (account_id: string, rupees: number) => {
    const p = rupeesToPaise(Math.max(rupees, 0));
    if (p > 0) dr.push({ account_id, dr: p, cr: 0 });
  };
  const C = (account_id: string, paise: number) => {
    if (paise > 0) cr.push({ account_id, dr: 0, cr: paise });
  };
  for (const h of GST_HEADS) D(OUTPUT_ACCOUNT[h], plan.liability[h]);
  D(A.rcmPayable, sumHeads(plan.rcLiability));
  // 7O: credit below zero (reversals exceed ITC) is paid in cash and clears the input ledger's credit balance.
  for (const h of GST_HEADS) D(INPUT_ACCOUNT[h], plan.itcNegative?.[h] ?? 0);
  D(ledgers.interest, sumHeads(plan.interest));
  D(ledgers.lateFee, sumHeads(plan.lateFee));
  let itc = 0;
  for (const h of GST_HEADS) {
    const p = rupeesToPaise(Math.max(plan.itcUsed[h], 0));
    itc += p;
    C(INPUT_ACCOUNT[h], p);
  }
  const totalDr = dr.reduce((s, l) => s + l.dr, 0);
  C(A.gstCash, totalDr - itc);
  return [...dr, ...cr];
}

export interface GstSetOffRecord {
  id: string;
  /** `periodKeyOf` of the 3B period. */
  period_key: string;
  /** Filer GSTIN ('' = all / not chosen). */
  gstin: string;
  from: string;
  to: string;
  /** Posting date of the journal (normally the filing day). */
  date: string;
  due: string;
  voucher_id: string;
  voucher_number: string;
  liability: Heads;
  rc_liability: Heads;
  itc_used: Heads;
  cash_tax: Heads;
  interest: Heads;
  late_fee: Heads;
  /**
   * Additive (7O, 7.91): unutilised ITC by head after this set-off — the next period's opening credit
   * (electronic credit ledger as this app sees it). Absent on set-offs posted before 7O.
   */
  itc_carry?: Heads;
  /** Additive (7O): credit carried in when this set-off was posted, and any negative credit paid in cash. */
  itc_opening?: Heads;
  itc_negative?: Heads;
  created_at: string;
  updated_at?: string;
}

export class GstSetOffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GstSetOffError';
  }
}

const cleanHeads = (v: unknown): Heads => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { igst: round2(num(o.igst)), cgst: round2(num(o.cgst)), sgst: round2(num(o.sgst)), cess: round2(num(o.cess)) };
};
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function normalizeSetOffs(rows: unknown[]): GstSetOffRecord[] {
  const out: GstSetOffRecord[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const date = isoDay(o.date);
    if (typeof o.id !== 'string' || !s(o.period_key) || !date) continue;
    out.push({
      id: o.id,
      period_key: s(o.period_key),
      gstin: s(o.gstin).toUpperCase(),
      from: isoDay(o.from),
      to: isoDay(o.to),
      date,
      due: isoDay(o.due),
      voucher_id: s(o.voucher_id),
      voucher_number: s(o.voucher_number),
      liability: cleanHeads(o.liability),
      rc_liability: cleanHeads(o.rc_liability),
      itc_used: cleanHeads(o.itc_used),
      cash_tax: cleanHeads(o.cash_tax),
      interest: cleanHeads(o.interest),
      late_fee: cleanHeads(o.late_fee),
      ...(o.itc_carry && typeof o.itc_carry === 'object' ? { itc_carry: cleanHeads(o.itc_carry) } : {}),
      ...(o.itc_opening && typeof o.itc_opening === 'object' ? { itc_opening: cleanHeads(o.itc_opening) } : {}),
      ...(o.itc_negative && typeof o.itc_negative === 'object' ? { itc_negative: cleanHeads(o.itc_negative) } : {}),
      created_at: s(o.created_at),
      ...(s(o.updated_at) ? { updated_at: s(o.updated_at) } : {}),
    });
  }
  return out;
}

export function loadSetOffs(): GstSetOffRecord[] {
  return normalizeSetOffs(getTable<unknown>(GST_SETOFFS_TABLE));
}

export function setOffFor(rows: readonly GstSetOffRecord[], periodKey: string, gstin = ''): GstSetOffRecord | undefined {
  const g = gstin.trim().toUpperCase();
  return rows.find((r) => r.period_key === periodKey && r.gstin === g);
}

const money = (n: number) => `₹${round2(n).toFixed(2)}`;

/** Voucher class stamped on the journals / payments this module writes (register filter in Books). */
export const SETOFF_VOUCHER_CLASS = 'GST set-off';
export const CHALLAN_VOUCHER_CLASS = 'GST payment (PMT-06)';

/**
 * Post (or re-post) the set-off journal of a period. One journal per period × GSTIN: posting again updates the same
 * voucher. Period lock, access and audit go through `saveVoucher`.
 */
export function postSetOff(plan: SetOffPlan, o: { date: string; gstin?: string; narration?: string }): GstSetOffRecord {
  requireAccess('books.edit');
  const date = isoDay(o.date);
  if (!date) throw new GstSetOffError('Choose the posting date.');
  if (plan.warnings.includes('NOT_A_3B_PERIOD')) throw new GstSetOffError('Choose a month or a quarter: a set-off is posted per GSTR-3B period.');
  const needsLedgers = sumHeads(plan.interest) > 0 || sumHeads(plan.lateFee) > 0;
  const ledgers = needsLedgers ? ensureGstLedgers() : { interest: GST_LEDGERS.interest.id, lateFee: GST_LEDGERS.lateFee.id };
  const lines = setOffVoucherLines(plan, ledgers);
  if (!lines.some((l) => l.dr > 0)) throw new GstSetOffError('Nothing to set off for this period.');
  const gstin = (o.gstin ?? '').trim().toUpperCase();
  const all = loadSetOffs();
  const prev = setOffFor(all, plan.periodKey, gstin);
  const voucherExists = !!prev?.voucher_id && loadVouchers().some((v) => v.id === prev.voucher_id);
  const narration = (o.narration ?? '').trim()
    || `GST set-off for ${plan.periodKey}${gstin ? ` (${gstin})` : ''}: ITC ${money(sumHeads(plan.itcUsed))}, cash ${money(sumHeads(plan.totalCash))}. Working paper — verify with your CA.`;
  const v = saveVoucher({
    ...(voucherExists ? { id: prev!.voucher_id } : {}),
    type: 'JOURNAL',
    date,
    narration,
    lines,
    voucher_class: SETOFF_VOUCHER_CLASS,
  });
  const now = new Date().toISOString();
  const row: GstSetOffRecord = {
    id: prev?.id ?? generateId(),
    period_key: plan.periodKey,
    gstin,
    from: plan.from,
    to: plan.to,
    date,
    due: plan.due,
    voucher_id: v.id,
    voucher_number: v.number,
    liability: plan.liability,
    rc_liability: plan.rcLiability,
    itc_used: plan.itcUsed,
    cash_tax: plan.cashTax,
    interest: plan.interest,
    late_fee: plan.lateFee,
    itc_carry: plan.itcCarry,
    ...(plan.itcOpening ? { itc_opening: plan.itcOpening } : {}),
    ...(plan.itcNegative ? { itc_negative: plan.itcNegative } : {}),
    created_at: prev?.created_at ?? now,
    ...(prev ? { updated_at: now } : {}),
  };
  setTable(GST_SETOFFS_TABLE, prev ? all.map((r) => (r.id === row.id ? row : r)) : [...all, row]);
  audit.record({
    entity: 'gst',
    entity_id: row.id,
    action: prev ? 'update' : 'create',
    doc_number: v.number,
    summary: `${prev ? 'Re-posted' : 'Posted'} GST set-off ${plan.periodKey}${gstin ? ` ${gstin}` : ''} as ${v.number} dated ${date}: ITC ${money(sumHeads(plan.itcUsed))}, cash ${money(sumHeads(plan.totalCash))}`,
  });
  return row;
}

/** Remove a set-off and its journal (period lock applies to the journal). */
export function deleteSetOff(id: string): void {
  const all = loadSetOffs();
  const row = all.find((r) => r.id === id);
  if (!row) return;
  requireAccess('books.edit');
  if (row.voucher_id) deleteVoucher(row.voucher_id);
  setTable(GST_SETOFFS_TABLE, all.filter((r) => r.id !== id));
  audit.record({ entity: 'gst', entity_id: id, action: 'delete', doc_number: row.voucher_number, summary: `Deleted GST set-off ${row.period_key}${row.gstin ? ` ${row.gstin}` : ''} (${row.voucher_number})` });
}

/* ── PMT-06 challans ───────────────────────────────────────────── */

export type ChallanMode = 'E_PAYMENT' | 'OTC' | 'NEFT_RTGS' | 'UPI' | 'CARD';
export const CHALLAN_MODES: readonly ChallanMode[] = ['E_PAYMENT', 'NEFT_RTGS', 'OTC', 'UPI', 'CARD'];
export const CHALLAN_MODE_LABELS: Record<ChallanMode, string> = {
  E_PAYMENT: 'Net banking',
  NEFT_RTGS: 'NEFT / RTGS',
  OTC: 'Over the counter',
  UPI: 'UPI',
  CARD: 'Credit / debit card',
};

export interface GstChallan {
  id: string;
  /** 14-digit Common Portal Identification Number of the generated challan. */
  cpin: string;
  /** Day the challan was generated, YYYY-MM-DD. */
  generated_on: string;
  /** Challan Identification Number given by the bank on payment (CPIN + bank code). */
  cin?: string;
  /** Bank reference number. */
  brn?: string;
  /** Day the money was deposited; set = paid (posted to the books). */
  deposited_on?: string;
  mode?: ChallanMode;
  /** Ledger credited on deposit (a cash / bank ledger); default the main bank. */
  bank_ledger_id?: string;
  /** Tax period the deposit is for (`periodKeyOf`), optional. */
  period_key?: string;
  gstin?: string;
  /** Amounts by major head × minor head (₹). */
  amounts: ChallanAmounts;
  /** Payment voucher posted on deposit. */
  voucher_id?: string;
  voucher_number?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export type GstChallanInput = Omit<GstChallan, 'id' | 'created_at' | 'updated_at' | 'voucher_id' | 'voucher_number'> & { id?: string };

export const emptyAmounts = (): ChallanAmounts => ({
  igst: { tax: 0, interest: 0, penalty: 0, fee: 0, others: 0 },
  cgst: { tax: 0, interest: 0, penalty: 0, fee: 0, others: 0 },
  sgst: { tax: 0, interest: 0, penalty: 0, fee: 0, others: 0 },
  cess: { tax: 0, interest: 0, penalty: 0, fee: 0, others: 0 },
});

export function cleanAmounts(v: unknown): ChallanAmounts {
  const out = emptyAmounts();
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  for (const h of GST_HEADS) {
    const row = (o[h] && typeof o[h] === 'object' ? o[h] : {}) as Record<string, unknown>;
    for (const m of MINOR_HEADS) out[h][m] = round2(Math.max(num(row[m]), 0));
  }
  return out;
}

/** Total of one major head (all minor heads). */
export function headTotal(a: ChallanAmounts, h: GstHead): number {
  return round2(MINOR_HEADS.reduce((s2, m) => s2 + num(a[h]?.[m]), 0));
}

/** Total of one minor head across the major heads. */
export function minorTotal(a: ChallanAmounts, m: MinorHead): number {
  return round2(GST_HEADS.reduce((s2, h) => s2 + num(a[h]?.[m]), 0));
}

export function challanTotal(c: Pick<GstChallan, 'amounts'>): number {
  return round2(GST_HEADS.reduce((s2, h) => s2 + headTotal(c.amounts, h), 0));
}

export const isPaid = (c: Pick<GstChallan, 'deposited_on'>): boolean => !!isoDay(c.deposited_on);

/** CPIN stays valid this many days after generation (Rule 87(2) proviso as understood — verify). */
export const CPIN_VALID_DAYS = 15;

/** Problems with a challan (empty = it may be saved). Warnings come from `challanWarnings`. */
export function validateGstChallan(c: GstChallanInput, others: readonly GstChallan[] = [], chart: readonly Account[] = DEFAULT_ACCOUNTS): string[] {
  const errors: string[] = [];
  const cpin = s(c.cpin);
  if (!/^\d{14}$/.test(cpin)) errors.push('CPIN is 14 digits.');
  else if (others.some((o) => o.id !== c.id && o.cpin === cpin)) errors.push(`CPIN ${cpin} is already recorded.`);
  if (!isoDay(c.generated_on)) errors.push('Choose the date the challan was generated.');
  const total = challanTotal({ amounts: cleanAmounts(c.amounts) });
  if (!(total > 0)) errors.push('Enter at least one amount.');
  const dep = isoDay(c.deposited_on);
  if (s(c.deposited_on) && !dep) errors.push('Choose a valid deposit date.');
  if (dep) {
    if (isoDay(c.generated_on) && dep < isoDay(c.generated_on)) errors.push('The deposit date is before the challan date.');
    const cin = s(c.cin).toUpperCase();
    if (!cin) errors.push('Enter the CIN from the bank to mark the challan paid.');
    else if (!/^[A-Z0-9]{17,18}$/.test(cin)) errors.push('CIN is 17–18 letters / digits (CPIN + bank code).');
    const ledger = s(c.bank_ledger_id) || A.bank;
    if (!isCashOrBankLedger(chart.find((a) => a.id === ledger))) errors.push('Choose the bank account the tax was paid from.');
  }
  return errors;
}

/** Non-blocking notes: CPIN expired before payment, CIN not starting with the CPIN. */
export function challanWarnings(c: Pick<GstChallan, 'cpin' | 'cin' | 'generated_on' | 'deposited_on'>): string[] {
  const out: string[] = [];
  const gen = isoDay(c.generated_on);
  const dep = isoDay(c.deposited_on);
  if (gen && dep && lateDays(gen, dep) > CPIN_VALID_DAYS) out.push('CPIN_EXPIRED');
  const cin = s(c.cin).toUpperCase();
  if (cin && s(c.cpin) && !cin.startsWith(s(c.cpin))) out.push('CIN_CPIN_MISMATCH');
  return out;
}

export function normalizeChallans(rows: unknown[]): GstChallan[] {
  const out: GstChallan[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || !isoDay(o.generated_on)) continue;
    const mode = CHALLAN_MODES.includes(o.mode as ChallanMode) ? (o.mode as ChallanMode) : undefined;
    out.push({
      id: o.id,
      cpin: s(o.cpin),
      generated_on: isoDay(o.generated_on),
      ...(s(o.cin) ? { cin: s(o.cin).toUpperCase() } : {}),
      ...(s(o.brn) ? { brn: s(o.brn) } : {}),
      ...(isoDay(o.deposited_on) ? { deposited_on: isoDay(o.deposited_on) } : {}),
      ...(mode ? { mode } : {}),
      ...(s(o.bank_ledger_id) ? { bank_ledger_id: s(o.bank_ledger_id) } : {}),
      ...(s(o.period_key) ? { period_key: s(o.period_key) } : {}),
      ...(s(o.gstin) ? { gstin: s(o.gstin).toUpperCase() } : {}),
      amounts: cleanAmounts(o.amounts),
      ...(s(o.voucher_id) ? { voucher_id: s(o.voucher_id) } : {}),
      ...(s(o.voucher_number) ? { voucher_number: s(o.voucher_number) } : {}),
      ...(s(o.notes) ? { notes: s(o.notes) } : {}),
      ...(s(o.created_at) ? { created_at: s(o.created_at) } : {}),
      ...(s(o.updated_at) ? { updated_at: s(o.updated_at) } : {}),
    });
  }
  return out.sort((a, b) => (b.deposited_on || b.generated_on).localeCompare(a.deposited_on || a.generated_on));
}

export function loadGstChallans(): GstChallan[] {
  return normalizeChallans(getTable<unknown>(GST_CHALLANS_TABLE));
}

/** Payment voucher lines for a paid challan: Dr GST electronic cash ledger | Cr bank (integer paise). */
export function challanVoucherLines(c: Pick<GstChallan, 'amounts' | 'bank_ledger_id'>): ManualVoucherLine[] {
  const p = rupeesToPaise(challanTotal(c));
  return [
    { account_id: A.gstCash, dr: p, cr: 0 },
    { account_id: s(c.bank_ledger_id) || A.bank, dr: 0, cr: p },
  ];
}

/**
 * Create / update a challan. A paid challan (deposit date + CIN) posts — or updates — its payment voucher;
 * clearing the deposit removes the voucher. Access, period lock and audit go through `saveVoucher`.
 */
export function saveGstChallan(input: GstChallanInput): GstChallan {
  requireAccess('books.edit');
  const all = loadGstChallans();
  const prev = input.id ? all.find((c) => c.id === input.id) : undefined;
  const chart = chartOf(loadUserAccounts());
  const errors = validateGstChallan(input, all, chart);
  if (errors.length) throw new GstSetOffError(errors[0]);
  const id = prev?.id ?? generateId();
  const amounts = cleanAmounts(input.amounts);
  const base: GstChallan = {
    id,
    cpin: s(input.cpin),
    generated_on: isoDay(input.generated_on),
    ...(s(input.cin) ? { cin: s(input.cin).toUpperCase() } : {}),
    ...(s(input.brn) ? { brn: s(input.brn) } : {}),
    ...(isoDay(input.deposited_on) ? { deposited_on: isoDay(input.deposited_on) } : {}),
    ...(input.mode && CHALLAN_MODES.includes(input.mode) ? { mode: input.mode } : {}),
    ...(s(input.bank_ledger_id) ? { bank_ledger_id: s(input.bank_ledger_id) } : {}),
    ...(s(input.period_key) ? { period_key: s(input.period_key) } : {}),
    ...(s(input.gstin) ? { gstin: s(input.gstin).toUpperCase() } : {}),
    amounts,
    ...(s(input.notes) ? { notes: s(input.notes) } : {}),
  };
  const voucherExists = !!prev?.voucher_id && loadVouchers().some((v) => v.id === prev.voucher_id);
  let voucher: { id: string; number: string } | undefined;
  if (base.deposited_on) {
    const v = saveVoucher({
      ...(voucherExists ? { id: prev!.voucher_id } : {}),
      type: 'PAYMENT',
      date: base.deposited_on,
      narration: `GST deposited, PMT-06 CPIN ${base.cpin}${base.cin ? ` CIN ${base.cin}` : ''}${base.period_key ? ` for ${base.period_key}` : ''}: ${GST_HEADS.filter((h) => headTotal(amounts, h) > 0).map((h) => `${GST_HEAD_LABELS[h]} ${money(headTotal(amounts, h))}`).join(', ')}`,
      lines: challanVoucherLines(base),
      voucher_class: CHALLAN_VOUCHER_CLASS,
    }, chart);
    voucher = { id: v.id, number: v.number };
  } else if (voucherExists) {
    deleteVoucher(prev!.voucher_id!);
  }
  const now = new Date().toISOString();
  const row: GstChallan = {
    ...base,
    ...(voucher ? { voucher_id: voucher.id, voucher_number: voucher.number } : {}),
    created_at: prev?.created_at ?? now,
    ...(prev ? { updated_at: now } : {}),
  };
  setTable(GST_CHALLANS_TABLE, prev ? all.map((c) => (c.id === id ? row : c)) : [...all, row]);
  audit.record({
    entity: 'gst',
    entity_id: id,
    action: prev ? 'update' : 'create',
    doc_number: row.cpin,
    summary: `${prev ? 'Edited' : 'Recorded'} GST challan CPIN ${row.cpin} for ${money(challanTotal(row))}${row.deposited_on ? `, paid ${row.deposited_on}${voucher ? ` (${voucher.number})` : ''}` : ', not paid yet'}`,
  });
  return row;
}

export function deleteGstChallan(id: string): void {
  const all = loadGstChallans();
  const row = all.find((c) => c.id === id);
  if (!row) return;
  requireAccess('books.edit');
  if (row.voucher_id && loadVouchers().some((v) => v.id === row.voucher_id)) deleteVoucher(row.voucher_id);
  setTable(GST_CHALLANS_TABLE, all.filter((c) => c.id !== id));
  audit.record({ entity: 'gst', entity_id: id, action: 'delete', doc_number: row.cpin, summary: `Deleted GST challan CPIN ${row.cpin} (${money(challanTotal(row))})` });
}

/* ── ITC carry-forward / electronic credit ledger (7O, 7.91) ───── */

export interface CarryForward {
  /** Credit carried in by head (zeros when nothing is known). */
  heads: Heads;
  /** The set-off it comes from, if any. */
  fromKey: string;
  fromTo: string;
  /**
   * Notes: CARRY_GAP (the last posted set-off does not end the day before this period — a period in between
   * was not posted, so its own ITC is not in the figure), CARRY_UNKNOWN (that set-off was posted before 7O and
   * stored no carry: re-post it to carry its credit forward), REFUND_NETTED (PENDING 40: ITC refund claims filed
   * since then are netted in — `refundNet`).
   */
  notes: string[];
  /** PENDING 40: credit-ledger moves netted in, by head (debits negative). */
  refundNet?: Heads;
}

/**
 * PENDING 40 (7.131): a dated move on the electronic CREDIT ledger made outside a set-off — an ITC refund claim
 * debits it on filing (Rule 89(3)), a rejected part comes back (PMT-03) and so does a withdrawn claim
 * (`creditLedgerRefundMoves`, gst-cash-refunds.ts). Signed by head (debit negative).
 */
export interface CreditMove {
  date: string;
  gstin?: string;
  heads: Partial<Heads>;
}

/** Sum of the moves of `gstin` dated after `after` and on or before `upTo` (no upper bound when empty). */
export function creditMovesBetween(moves: readonly CreditMove[], gstin: string, after: string, upTo = ''): Heads {
  const g = gstin.trim().toUpperCase();
  const out = zeroHeads();
  for (const m of moves) {
    if ((m.gstin && g && m.gstin.toUpperCase() !== g) || m.date <= after || (upTo && m.date > upTo)) continue;
    for (const h of GST_HEADS) out[h] = round2(out[h] + (Number(m.heads[h]) || 0));
  }
  return out;
}

const dayBefore = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(y, m - 1, d - 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

/**
 * Unutilised ITC by head from the latest set-off posted for an earlier period of the same GSTIN — the opening
 * credit of the period starting `from`. PENDING 40: credit-ledger `moves` (ITC refund claims filed, re-credits)
 * dated after that set-off's posting day and up to `upTo` (this period's own posting day, once posted) are netted
 * in, floored at zero. Working paper: the portal's electronic credit ledger is what counts.
 */
export function carryForwardFor(setoffs: readonly GstSetOffRecord[], from: string, gstin = '', moves: readonly CreditMove[] = [], upTo = ''): CarryForward {
  const g = gstin.trim().toUpperCase();
  const prev = setoffs
    .filter((r) => r.gstin === g && r.to && r.to < from)
    .sort((a, b) => b.to.localeCompare(a.to))[0];
  if (!prev) return { heads: zeroHeads(), fromKey: '', fromTo: '', notes: [] };
  const notes: string[] = [];
  if (prev.to !== dayBefore(from)) notes.push('CARRY_GAP');
  if (!prev.itc_carry) notes.push('CARRY_UNKNOWN');
  const net = creditMovesBetween(moves, g, prev.date, upTo);
  const netted = GST_HEADS.some((h) => net[h]);
  if (netted) notes.push('REFUND_NETTED');
  const heads = zeroHeads();
  for (const h of GST_HEADS) heads[h] = round2(Math.max(Math.max(prev.itc_carry?.[h] ?? 0, 0) + net[h], 0));
  return { heads, fromKey: prev.period_key, fromTo: prev.to, notes, ...(netted ? { refundNet: net } : {}) };
}

/**
 * Electronic credit ledger balance by head as of `asOf` (default: everything): the carry of the latest
 * set-off posted on or before that day for the GSTIN, plus the credit-ledger `moves` after its posting day
 * (PENDING 40). A working view, not the portal ledger.
 */
export function creditLedgerBalance(setoffs: readonly GstSetOffRecord[], gstin = '', asOf?: string, moves: readonly CreditMove[] = []): Heads {
  const g = gstin.trim().toUpperCase();
  const last = setoffs
    .filter((r) => r.gstin === g && (!asOf || r.date <= asOf))
    .sort((a, b) => b.to.localeCompare(a.to) || b.date.localeCompare(a.date))[0];
  const out = last?.itc_carry ? { ...last.itc_carry } : zeroHeads();
  if (!moves.length) return out;
  const net = creditMovesBetween(moves, g, last?.date ?? '', asOf ?? '');
  for (const h of GST_HEADS) out[h] = round2(Math.max(out[h] + net[h], 0));
  return out;
}

/* ── Electronic cash ledger & status ───────────────────────────── */

/**
 * Electronic cash ledger balance by major head as of `asOf` (inclusive; default everything): paid challans (all
 * minor heads) less what set-offs took from each head (tax + interest + late fee). The portal keeps minor heads
 * apart and allows transfers only through PMT-09; this is a working view.
 */
export function cashLedgerBalance(challans: readonly GstChallan[], setoffs: readonly GstSetOffRecord[], asOf?: string): Heads {
  const bal = zeroHeads();
  for (const c of challans) {
    if (!isPaid(c) || (asOf && c.deposited_on! > asOf)) continue;
    for (const h of GST_HEADS) bal[h] = round2(bal[h] + headTotal(c.amounts, h));
  }
  for (const r of setoffs) {
    if (asOf && r.date > asOf) continue;
    for (const h of GST_HEADS) bal[h] = round2(bal[h] - r.cash_tax[h] - r.interest[h] - r.late_fee[h]);
  }
  return bal;
}

/** Amounts for a new challan: what the plan still needs in cash after the head's ledger balance (never negative). */
export function challanFromPlan(plan: SetOffPlan, balance: Heads = zeroHeads()): ChallanAmounts {
  const a = emptyAmounts();
  for (const h of GST_HEADS) {
    let free = Math.max(num(balance[h]), 0);
    const needFromChallan = (want: number) => {
      const take = Math.min(free, Math.max(want, 0));
      free = round2(free - take);
      return round2(Math.max(want, 0) - take);
    };
    a[h].tax = needFromChallan(plan.cashTax[h]);
    a[h].interest = needFromChallan(plan.interest[h]);
    a[h].fee = needFromChallan(plan.lateFee[h]);
  }
  return a;
}

export interface PeriodPaymentStatus {
  /** Cash needed for the period (plan). */
  toPay: number;
  /** Paid challans tagged with the period. */
  deposited: number;
  /** Challans tagged with the period not yet paid. */
  pendingChallans: number;
  /** Set-off journal posted for the period. */
  posted: boolean;
  /** Cash still short after the ledger balance (by head, ≥ 0). */
  shortfall: Heads;
}

export function periodPaymentStatus(plan: SetOffPlan, challans: readonly GstChallan[], setoffs: readonly GstSetOffRecord[], gstin = ''): PeriodPaymentStatus {
  const mine = challans.filter((c) => c.period_key === plan.periodKey && (!gstin || !c.gstin || c.gstin === gstin.toUpperCase()));
  const deposited = round2(mine.filter(isPaid).reduce((t, c) => t + challanTotal(c), 0));
  const record = setOffFor(setoffs, plan.periodKey, gstin);
  // Balance available to this period: everything paid, less OTHER periods' set-offs.
  const bal = cashLedgerBalance(challans, setoffs.filter((r) => r !== record));
  const shortfall = zeroHeads();
  for (const h of GST_HEADS) shortfall[h] = Math.max(round2(plan.totalCash[h] - bal[h]), 0);
  return {
    toPay: sumHeads(plan.totalCash),
    deposited,
    pendingChallans: mine.filter((c) => !isPaid(c)).length,
    posted: !!record,
    shortfall,
  };
}
