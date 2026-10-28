/**
 * PS-D1 year-end appropriation (pure). For an FY:
 *  - interest on capital per the deed, capped at `PARTNER_INTEREST_CAP_RULES` (12 %), on opening capital or on the
 *    daily balances of the capital account (setting);
 *  - interest on drawings (product method, the firm's income);
 *  - book profit = net profit per the ledger before partners' remuneration (remuneration already credited added back),
 *    less this run's interest on capital, plus the interest above the cap (disallowed), plus interest on drawings,
 *    plus the user's listed adjustments (PS20, Q35);
 *  - allowable remuneration (Sec 40(b)(v) / 2025 Act Sec 35) from `PARTNER_REMUNERATION_RULES` by the FY start —
 *    working partners only; the deed's remuneration (fixed, % of book profit, or the maximum allowable shared in the
 *    working partners' ratio); the excess is disallowed (a note for the computation, never a journal);
 *  - the residual profit (or loss) shared in the profit-sharing ratio on 31 March.
 * Amounts in ₹ (2 decimals). Working paper — verify with your CA.
 */
import type { Partner, PartnerRunLine } from '../../types/prof-r14';
import { round2 } from '../invoice-calc';
import { PARTNER_INTEREST_CAP_RULES, PARTNER_REMUNERATION_RULES, psRuleAt } from '../prof-rules';
import { activeOn, interestOnDrawings, termOn } from './ps-partners';

export const fyBounds = (fy: number) => ({ start: `${fy}-04-01`, end: `${fy + 1}-03-31` });

/** Allowable remuneration for a firm's book profit (₹) in the FY starting `fyStart`. A loss gets the floor. */
export function allowableRemuneration(bookProfit: number, fyStart: string): { allowable: number; floor: number; slab: number; verified: boolean; source?: string } {
  const r = psRuleAt(PARTNER_REMUNERATION_RULES, fyStart);
  const { floor, slab, firstPct, restPct } = r.value;
  const bp = round2(bookProfit);
  const first = bp <= 0 ? floor : Math.max(floor, (Math.min(bp, slab) * firstPct) / 100);
  const rest = bp > slab ? ((bp - slab) * restPct) / 100 : 0;
  return { allowable: round2(first + rest), floor, slab, verified: r.verified, source: r.source };
}

/** Daily-balance average of a capital account over the FY from its opening and dated movements (₹, credit-positive). */
export function averageCapital(opening: number, moves: readonly { date: string; amount: number }[], fy: number): number {
  const { start, end } = fyBounds(fy);
  const days = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
  const total = days(start, end) + 1;
  let bal = opening;
  let product = 0;
  let at = start;
  for (const m of [...moves].filter((x) => x.date >= start && x.date <= end).sort((a, b) => a.date.localeCompare(b.date))) {
    product += bal * days(at, m.date);
    bal += m.amount;
    at = m.date;
  }
  product += bal * (days(at, end) + 1);
  return round2(product / total);
}

export interface RunInput {
  fy: number;
  partners: readonly Partner[];
  /** Net profit per the ledger for the FY (₹), before this run's postings. */
  netProfit: number;
  /** Partners' remuneration already in the ledger for the FY (monthly credits), added back for book profit. */
  remunerationPosted?: Readonly<Record<string, number>>;
  /** Interest on capital already credited in the FY (monthly credits) per partner. */
  interestPosted?: Readonly<Record<string, number>>;
  /** Capital base per partner (₹, credit-positive): opening balance, or the daily-balance average. */
  capital: Readonly<Record<string, number>>;
  drawings?: Readonly<Record<string, readonly { date: string; amount: number }[]>>;
  adjustments?: readonly { label: string; amount: number }[];
}

export interface RunResult {
  fy: number;
  date: string;
  netProfit: number;
  bookProfit: number;
  allowable: number;
  allowableVerified: boolean;
  remunerationTotal: number;
  disallowed: number;
  interestTotal: number;
  /** Interest above the cap (computed at the deed rate, disallowed). */
  interestDisallowed: number;
  drawingsInterestTotal: number;
  residual: number;
  lines: PartnerRunLine[];
  problems: string[];
}

/** Split `amount` by weights, rounding to paise; the remainder goes to the largest weight. */
export function splitByRatio(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (!total) return weights.map(() => 0);
  const out = weights.map((w) => round2((amount * w) / total));
  const diff = round2(amount - out.reduce((s, x) => s + x, 0));
  if (diff) {
    const i = weights.indexOf(Math.max(...weights));
    out[i] = round2(out[i] + diff);
  }
  return out;
}

export function computeRun(input: RunInput): RunResult {
  const { start, end } = fyBounds(input.fy);
  const problems: string[] = [];
  const partners = activeOn(input.partners, end).filter((p) => termOn(p, end));
  const ever = input.partners.filter((p) => p.joined <= end && (!p.left || p.left >= start));
  if (!partners.length) problems.push('No partner is in the firm on 31 March of this year.');
  const shares = partners.map((p) => termOn(p, end)!.share_pct);
  const shareTotal = round2(shares.reduce((s, x) => s + x, 0));
  if (partners.length && Math.abs(shareTotal - 100) > 0.005) problems.push(`Profit-sharing ratios total ${shareTotal} % on ${end}; they must total 100 %.`);
  const cap = psRuleAt(PARTNER_INTEREST_CAP_RULES, start).value;

  const base = ever.map((p) => {
    const t = termOn(p, end) ?? termOn(p, start) ?? p.terms[0];
    const deedRate = Math.max(t?.interest_pct ?? 0, 0);
    const months = monthsIn(p, start, end);
    const atDeed = round2((Math.max(input.capital[p.id] ?? 0, 0) * deedRate * months) / 1200);
    const capped = round2((Math.max(input.capital[p.id] ?? 0, 0) * Math.min(deedRate, cap) * months) / 1200);
    const interest = Math.max(round2(atDeed - (input.interestPosted?.[p.id] ?? 0)), 0);
    const drawingsInterest = interestOnDrawings(input.drawings?.[p.id] ?? [], t?.interest_on_drawings_pct ?? 0, end);
    return { p, t, interest, interestOver: round2(atDeed - capped), drawingsInterest };
  });
  const interestTotal = round2(base.reduce((s, b) => s + b.interest, 0));
  const interestDisallowed = round2(base.reduce((s, b) => s + b.interestOver, 0));
  const drawingsInterestTotal = round2(base.reduce((s, b) => s + b.drawingsInterest, 0));
  const posted = round2(Object.values(input.remunerationPosted ?? {}).reduce((s, x) => s + x, 0));
  const adj = round2((input.adjustments ?? []).reduce((s, a) => s + (Number(a.amount) || 0), 0));
  // QA17 R2: interest above the 12 % cap is disallowed, so book profit (computed as Sec 28–44D direct) adds it back.
  const bookProfit = round2(input.netProfit + posted - interestTotal + interestDisallowed + drawingsInterestTotal + adj);
  const lim = allowableRemuneration(bookProfit, start);

  // Remuneration per the deed (working partners only), less what monthly credits already gave.
  const working = base.filter((b) => b.p.kind === 'working' && b.t);
  const fixedPart = working.map((b) => (b.t!.remuneration.mode === 'fixed' ? Math.max(b.t!.remuneration.amount ?? 0, 0) : b.t!.remuneration.mode === 'pct_book_profit' ? Math.max((bookProfit * (b.t!.remuneration.pct ?? 0)) / 100, 0) : 0));
  const maxIdx = working.map((b, i) => (b.t!.remuneration.mode === 'max_allowable' ? i : -1)).filter((i) => i >= 0);
  const room = Math.max(lim.allowable - fixedPart.reduce((s, x) => s + x, 0), 0);
  const maxSplit = splitByRatio(round2(room), maxIdx.map((i) => working[i].t!.share_pct || 1));
  const remDeed = working.map((_, i) => round2(maxIdx.includes(i) ? maxSplit[maxIdx.indexOf(i)] : fixedPart[i]));
  const remuneration = new Map(working.map((b, i) => [b.p.id, Math.max(round2(remDeed[i] - (input.remunerationPosted?.[b.p.id] ?? 0)), 0)]));
  const remunerationTotal = round2(working.reduce((s, _, i) => s + remDeed[i], 0));
  const disallowed = round2(Math.max(remunerationTotal - lim.allowable, 0));

  const remThisRun = round2([...remuneration.values()].reduce((s, x) => s + x, 0));
  const residual = round2(input.netProfit - remThisRun - interestTotal + drawingsInterestTotal);
  const split = splitByRatio(residual, shares);
  const lines: PartnerRunLine[] = base.map((b) => {
    const i = partners.findIndex((p) => p.id === b.p.id);
    return { partner_id: b.p.id, name: b.p.name, share_pct: i >= 0 ? shares[i] : 0, interest: b.interest, remuneration: remuneration.get(b.p.id) ?? 0, drawings_interest: b.drawingsInterest, share: i >= 0 ? split[i] : 0 };
  });
  return { fy: input.fy, date: end, netProfit: round2(input.netProfit), bookProfit, allowable: lim.allowable, allowableVerified: lim.verified, remunerationTotal, disallowed, interestTotal, interestDisallowed, drawingsInterestTotal, residual, lines, problems };
}

/** Months (0–12) the partner was in the firm during the FY (part of a month counts as a month). */
function monthsIn(p: Pick<Partner, 'joined' | 'left'>, start: string, end: string): number {
  const from = p.joined > start ? p.joined : start;
  const to = p.left && p.left < end ? p.left : end;
  if (to < from) return 0;
  return Math.min((+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7)) + 1, 12);
}
