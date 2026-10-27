/**
 * AG-D5 tax working papers and the members' statutory calendar (working papers — nothing reaches a return):
 *  - co-operative: profit by Sec 80P(2) head — **Sec 149 of the Income-tax Act 2025 from 1 Apr 2026, as reported** —
 *    (marketing members' produce, inputs to members, milk to a federal co-op, credit to members, other), with the
 *    members' share of the business from the patronage register beside each head (AG16);
 *  - producer company: 80PA on eligible-business profits under the ₹100 crore turnover test, keyed by assessment year;
 *    from AY 2025-26 the paper says "no deduction found after AY 2024-25 — verify" and computes nothing (AG17);
 *  - calendar: producer company AGM / AOC-4 / MGT-7 / internal audit / members' register, co-operative AGM / Registrar's
 *    audit / returns — default month-days by rule (AG18), overridden by typed dates (AG19). Reminders only. Pure.
 */
import { num, round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { COOP_DEDUCTION_RULES, MEMBERS_CALENDAR_RULES, PRODUCER_COMPANY_RULES } from '../agri-rules';

export const COOP_HEAD_LABEL: Readonly<Record<string, string>> = {
  marketing: 'Marketing of members\' agricultural produce',
  inputs: 'Supply of agricultural inputs to members',
  milk: 'Milk supplied to a federal milk co-operative',
  credit: 'Credit facilities to members',
  other: 'Other income',
};

/** The co-operative deduction label for the FY starting `fyStartYear` (80P(2) before 1 Apr 2026, Sec 149 after). */
export const coopSection = (fyStartYear: number) => ruleAt(COOP_DEDUCTION_RULES, `${fyStartYear}-04-01`);

export interface CoopPaperRow { head: string; label: string; profit: number; membersPct: number; membersPart: number }

/** Profit by head as typed, with the members' share (patronage) beside it — the CA decides the claim (AG16). */
export function coopPaper(fyStartYear: number, profitByHead: Readonly<Record<string, number>>, membersPct: number): { section: string; act: string; rows: CoopPaperRow[]; total: number } {
  const r = coopSection(fyStartYear);
  const rows = r.heads.map((h) => {
    const profit = round2(num(profitByHead[h]));
    const pct = h === 'other' ? 0 : Math.min(Math.max(num(membersPct), 0), 100);
    return { head: h, label: COOP_HEAD_LABEL[h] ?? h, profit, membersPct: pct, membersPart: round2((profit * pct) / 100) };
  });
  return { section: r.section, act: r.act, rows, total: round2(rows.reduce((t, x) => t + x.profit, 0)) };
}

/** 80PA for the FY starting `fyStartYear` (assessment year = the next year): deduction or the "none found" note. */
export function producerPaper(fyStartYear: number, eligibleProfit: number, turnover: number): { ay: string; deduction: number; note: string; eligible: boolean } {
  const ay = `${fyStartYear + 1}-${String((fyStartYear + 2) % 100).padStart(2, '0')}`;
  const r = ruleAt(PRODUCER_COMPANY_RULES, `${fyStartYear + 1}-04-01`);
  const eligible = r.deductionPct > 0 && num(turnover) < r.turnoverLimit;
  const note = r.deductionPct > 0 && !eligible ? 'Turnover is ₹100 crore or more: no 80PA deduction.' : r.note;
  return { ay, deduction: eligible ? round2((Math.max(num(eligibleProfit), 0) * r.deductionPct) / 100) : 0, note, eligible };
}

export const CALENDAR_LABEL: Readonly<Record<string, string>> = {
  agm: 'Annual general meeting', financials: 'Financial statements (AOC-4)', annualReturn: 'Annual return (MGT-7)', internalAudit: 'Internal audit',
  register: 'Register of members up to date', audit: 'Registrar\'s audit', returns: 'Annual returns to the Registrar',
};

/** Due dates for the FY's reminders (`MM-DD` in the calendar year the FY ends; a typed date wins). Sorted by date. */
export function membersCalendar(kind: 'producer' | 'coop', fyStartYear: number, typed?: Readonly<Record<string, string>>): { key: string; label: string; due: string }[] {
  const defaults = ruleAt(MEMBERS_CALENDAR_RULES, `${fyStartYear + 1}-03-31`)[kind];
  return Object.entries({ ...defaults, ...(typed ?? {}) })
    .filter(([k, v]) => k in defaults && /^\d{2}-\d{2}$/.test(v))
    .map(([key, mmdd]) => ({ key, label: CALENDAR_LABEL[key] ?? key, due: `${fyStartYear + 1}-${mmdd}` }))
    .sort((a, b) => a.due.localeCompare(b.due));
}
