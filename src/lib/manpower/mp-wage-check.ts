/**
 * R17-C3 minimum-wage and Labour Code checks (pure; warnings only, never a block; the payroll engine is unchanged).
 *  - Minimum wage: the wage paid per duty (the finalised run's gross less overtime ÷ the person's duties that month)
 *    against the typed revision that applies to the post (latest `from` ≤ the month start, matching post name / zone /
 *    skill; a monthly wage counts per 26 days). Shortfalls × the site's duties = arrears owed to the employee (MP22).
 *  - Hints by `LABOUR_CODE_RULES` (from 21 Nov 2025): OT paid below `ot_multiple` × the ordinary hourly rate (8-hour
 *    day, MP20); a fixed-term employee (leaving date set) past `fte_years` (gratuity, MP19); PF wages below `wage_share`
 *    of gross (the 50 % wage rule, MP16); a site with `CONTRACT_LABOUR_THRESHOLD_RULES` workers or more and no OSH /
 *    contract-labour licence on file (MP17). Working papers — verify with your CA / labour-law adviser.
 */
import type { MpLicence, MpPost, SiteMuster, WageRevision } from '../../types/manpower-r17';
import type { Site } from './mp-sites';
import type { Staff } from './mp-muster';
import { ruleAt } from '../tax-rules';
import { round2 } from '../invoice-calc';
import { CONTRACT_LABOUR_THRESHOLD_RULES, LABOUR_CODE_RULES } from '../manpower-rules';
import { monthEnd } from './mp-muster';
import { dutiesOf, type RunLine } from './mp-compliance';

const lc = (s?: string) => (s ?? '').trim().toLowerCase();

/** The revision that applies to a post in a month (most specific among the latest). */
export function revisionFor(revs: readonly WageRevision[], post: Pick<MpPost, 'name' | 'zone' | 'skill'>, month: string): WageRevision | undefined {
  const ok = revs.filter((r) => r.from <= `${month}-01` && (!r.to || r.to >= `${month}-01`) && (!r.post_name || lc(r.post_name) === lc(post.name)) && (!r.zone || lc(r.zone) === lc(post.zone)) && (!r.skill || lc(r.skill) === lc(post.skill)));
  const n = (r: WageRevision) => Number(!!r.post_name) + Number(!!r.zone) + Number(!!r.skill);
  return ok.sort((a, b) => b.from.localeCompare(a.from) || n(b) - n(a))[0];
}

/** Minimum per duty of a revision ('' amounts → 0 = not set). */
export const minPerDuty = (r?: WageRevision): number => round2(Number(r?.wage_day) || (Number(r?.wage_month) || 0) / 26);

/** Overtime pay of a run line (production heads on `ot_hours`, or a head named overtime). */
export const otPay = (l: Pick<RunLine, 'earnings'>): number => round2((l.earnings ?? []).filter((e) => e.pay_head_id === 'ph_ot' || /overtime|\bot\b/i.test(e.name)).reduce((t, e) => t + (Number(e.amount) || 0), 0));

export interface Shortfall { employee_id: string; name: string; post: string; duties: number; paid: number; min: number; arrears: number; rev: string }

export function shortfalls(site: Site, m: Pick<SiteMuster, 'month' | 'rows'>, all: readonly SiteMuster[], lines: readonly RunLine[], revs: readonly WageRevision[]): Shortfall[] {
  const out: Shortfall[] = [];
  for (const r of m.rows) {
    const post = site.mp.posts.find((p) => p.id === r.post_id);
    const l = lines.find((x) => x.employee_id === r.employee_id);
    const rev = post && revisionFor(revs, post, m.month);
    const min = minPerDuty(rev);
    const tot = dutiesOf(all, m.month, r.employee_id);
    if (!post || !l || !rev || !min || !tot) continue;
    const paid = round2((l.gross - otPay(l)) / tot);
    if (paid < min - 0.005) out.push({ employee_id: r.employee_id, name: l.name, post: post.name, duties: r.duties, paid, min, arrears: round2((min - paid) * r.duties), rev: rev.ref });
  }
  return out;
}

export interface Hint { k: 'ot' | 'fte' | 'wage' | 'clra' | 'clraAll'; who: string; ca: string }

export function labourHints(i: { month: string; lines: readonly RunLine[]; staff: readonly Staff[]; sites: readonly Site[]; musters: readonly SiteMuster[]; licences: readonly MpLicence[] }): Hint[] {
  const end = monthEnd(i.month);
  const code = ruleAt(LABOUR_CODE_RULES, end);
  const out: Hint[] = [];
  if (code) {
    for (const l of i.lines) {
      const ot = otPay(l);
      const h = Number(l.units?.ot_hours) || 0;
      const ord = l.payable_days ? (l.gross - ot) / l.payable_days / 8 : 0;
      if (h > 0 && ord > 0 && ot / h < code.ot_multiple * ord - 0.005) out.push({ k: 'ot', who: l.name, ca: 'MP20' });
      if (l.gross > 0 && l.pf_wages < code.wage_share * (l.gross - ot) - 0.005) out.push({ k: 'wage', who: l.name, ca: 'MP16' });
    }
    const [y, mo] = [Number(i.month.slice(0, 4)), i.month.slice(5, 7)];
    for (const e of i.staff) if (e.doj && e.dol && e.dol >= `${i.month}-01` && e.doj <= `${y - code.fte_years}-${mo}-01`) out.push({ k: 'fte', who: e.name, ca: 'MP19' });
  }
  const min = ruleAt(CONTRACT_LABOUR_THRESHOLD_RULES, end);
  const lic = i.licences.some((l) => (l.kind === 'osh' || l.kind === 'clra') && l.valid_till >= `${i.month}-01`);
  for (const s of i.sites) {
    const n = new Set(i.musters.filter((m) => m.site_id === s.id && m.month === i.month).flatMap((m) => m.rows.map((r) => r.employee_id))).size;
    if (n >= min && !lic) out.push({ k: 'clra', who: `${s.mp.code} (${n})`, ca: 'MP17' });
  }
  // QA20 V9: the licence test also reaches the contractor itself — OSH Code Sec 45(1)(ii) "every manpower supply
  // contractor who has employed, on any day of the preceding twelve months, fifty or more contract labour" (CLRA Act
  // Sec 1(4)(b): 20 workmen) — so the agency's people across ALL its sites count, not one site's (ten sites of ten
  // guards never set off the per-site test). Proxy: distinct people on the month's musters (MP45).
  const all = new Set(i.musters.filter((m) => m.month === i.month).flatMap((m) => m.rows.map((r) => r.employee_id))).size;
  if (all >= min && !lic && !out.some((h) => h.k === 'clra')) out.push({ k: 'clraAll', who: String(all), ca: 'MP17' });
  return out;
}
