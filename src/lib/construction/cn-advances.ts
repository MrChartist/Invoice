/**
 * CN-B2: mobilisation / plant advances under the contract terms. The advance itself stays an `advances.ts` receipt
 * (GST at receipt, I17); the contract says how it comes back:
 *  - recovery per RA bill = the higher of the BOQ rule (x% of the bill beyond the start threshold) and the schedule
 *    that recovers the advance pro rata from `recover_from_pct` (10) to `recover_by_pct` (80) of work done — never more
 *    than the balance;
 *  - interest = simple interest a year on the unrecovered balance for the days since the last bill (or the advance),
 *    a separate deduction `advance_interest` (no GST, CN8).
 * Each row carries `ref_id` = the advance, so several advances on one contract recover separately. Pure, except the
 * readers at the end. Working paper — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { RaDeduction } from '../../types/transport-works-r5';
import type { CnAdvanceTerm, WorksContract } from '../../types/construction-r11';
import { num, round2 } from '../invoice-calc';
import { daysBetween } from './cn-contracts';

export interface AdvanceLike {
  id: string;
  number?: string;
  date: string;
  amount: number;
}

/** Simple interest on `balance` at `pct` % a year for the days from `from` to `to` (365-day year). */
export const simpleInterest = (balance: number, pct: number, from: string, to: string): number =>
  balance > 0 && pct > 0 ? round2((balance * pct * Math.max(daysBetween(from, to), 0)) / 36500) : 0;

/** What should have been recovered once `workPct` % of the work is done (straight line from → by). */
export function scheduleTarget(amount: number, workPct: number, fromPct = 10, byPct = 80): number {
  const span = byPct - fromPct;
  const f = span > 0 ? (workPct - fromPct) / span : workPct >= byPct ? 1 : 0;
  return round2(amount * Math.min(Math.max(f, 0), 1));
}

export interface RecoveryCalc {
  amount: number;
  recovered: number;
  contractValue: number;
  /** Work billed before this bill and on this bill (value before GST). */
  cumBefore: number;
  thisWork: number;
  term: Pick<CnAdvanceTerm, 'recover_from_pct' | 'recover_by_pct'>;
  /** BOQ rule: x % of the bill beyond the start threshold. */
  rulePct?: number;
}

/** This bill's recovery: max(schedule catch-up, BOQ rule), capped at the balance. */
export function recoveryThisBill(r: RecoveryCalc): number {
  const left = round2(r.amount - r.recovered);
  if (!(left > 0) || !(r.contractValue > 0)) return 0;
  const from = num(r.term.recover_from_pct ?? 10);
  const workAfter = ((r.cumBefore + r.thisWork) / r.contractValue) * 100;
  const sched = scheduleTarget(r.amount, workAfter, from, num(r.term.recover_by_pct ?? 80)) - r.recovered;
  const start = (r.contractValue * from) / 100;
  const rule = num(r.rulePct) > 0 ? (Math.max(Math.min(r.thisWork, r.cumBefore + r.thisWork - start), 0) * num(r.rulePct)) / 100 : 0;
  return round2(Math.min(Math.max(sched, rule, 0), left));
}

/** Recovered so far on `bills` for advance `id` (rows without `ref_id` count for the BOQ's own advance). */
export const recoveredOn = (bills: readonly Pick<InvoiceRecord, 'ra_deductions'>[], id: string, boqAdvanceId?: string): number =>
  round2(bills.reduce((s, b) => s + (b.ra_deductions ?? []).filter((d) => d.kind === 'advance_recovery' && (d.ref_id === id || (!d.ref_id && id === boqAdvanceId))).reduce((t, d) => t + num(d.amount), 0), 0));

/** Interest runs from the last earlier bill on / after the advance, else from the advance. */
const lastDay = (bills: readonly Pick<InvoiceRecord, 'issue_date'>[], adv: AdvanceLike) => bills.map((b) => b.issue_date).filter((d) => d >= adv.date).sort().pop() ?? adv.date;

export interface AdvanceBillCtx {
  contract: Pick<WorksContract, 'advance_terms' | 'contract_value'>;
  advances: readonly AdvanceLike[];
  /** Earlier live RA bills of the contract. */
  earlier: readonly Pick<InvoiceRecord, 'issue_date' | 'taxable_value' | 'ra_deductions'>[];
  taxable: number;
  date: string;
  boqAdvanceId?: string;
  rulePct?: number;
}

/** Pure: the advance recovery and interest rows of one RA bill. */
export function advanceDeductions(x: AdvanceBillCtx): RaDeduction[] {
  const out: RaDeduction[] = [];
  const cumBefore = round2(x.earlier.reduce((s, b) => s + num(b.taxable_value), 0));
  for (const t of x.contract.advance_terms ?? []) {
    const adv = x.advances.find((a) => a.id === t.advance_id);
    if (!adv) continue;
    const name = t.kind === 'plant' ? 'Plant advance' : 'Mobilisation advance';
    const recovered = recoveredOn(x.earlier, adv.id, x.boqAdvanceId);
    const balance = round2(num(adv.amount) - recovered);
    if (!(balance > 0)) continue;
    const from = lastDay(x.earlier, adv);
    const interest = simpleInterest(balance, num(t.interest_pct), from, x.date);
    const amount = recoveryThisBill({ amount: num(adv.amount), recovered, contractValue: num(x.contract.contract_value), cumBefore, thisWork: num(x.taxable), term: t, rulePct: x.rulePct });
    if (amount > 0) out.push({ kind: 'advance_recovery', label: `${name} recovery${adv.number ? ` (${adv.number})` : ''}`, base: balance, amount, ref_id: adv.id });
    if (interest > 0) out.push({ kind: 'advance_interest', label: `Interest on ${name.toLowerCase()} ${num(t.interest_pct)}% simple, ${daysBetween(from, x.date)} days`, base: balance, rate: num(t.interest_pct), amount: interest, ref_id: adv.id });
  }
  return out;
}

export interface AdvanceStatus {
  term: CnAdvanceTerm;
  advance?: AdvanceLike;
  amount: number;
  recovered: number;
  balance: number;
  /** Interest accrued on the balance from the last bill to `today` (not yet billed). */
  interest: number;
  workPct: number;
  target: number;
  behind: boolean;
}

/** Works → Advances: each advance of the contract with recovered, balance, interest to date and the schedule check. */
export function advanceStatus(c: Pick<WorksContract, 'advance_terms' | 'contract_value'>, bills: readonly InvoiceRecord[], advances: readonly AdvanceLike[], today: string, boqAdvanceId?: string): AdvanceStatus[] {
  const work = bills.reduce((s, b) => s + num(b.taxable_value), 0);
  const raw = num(c.contract_value) > 0 ? (work / num(c.contract_value)) * 100 : 0;
  const workPct = round2(raw);
  return (c.advance_terms ?? []).map((term) => {
    const advance = advances.find((a) => a.id === term.advance_id);
    const amount = num(advance?.amount);
    const recovered = advance ? recoveredOn(bills, advance.id, boqAdvanceId) : 0;
    const balance = round2(Math.max(amount - recovered, 0));
    const target = scheduleTarget(amount, raw, num(term.recover_from_pct ?? 10), num(term.recover_by_pct ?? 80));
    return {
      term, advance, amount, recovered, balance, workPct, target,
      interest: advance ? simpleInterest(balance, num(term.interest_pct), lastDay(bills, advance), today) : 0,
      behind: recovered + 1 < target,
    };
  });
}
