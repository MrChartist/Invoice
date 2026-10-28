/**
 * R17-D1 wage-revision arrears (pure). For a typed revision (an increase per duty, or a new minimum less the previous
 * matching one) and every site that passes it through (`contract.escalation = 'vda_pass_through'`, or ticked by hand
 * in `site_ids`), each bill of a service month on or after the revision (and up to its end) gets the difference:
 *  - a `duty` post: Σ duties × increase;
 *  - `hour` / `month` / `costplus` posts: the bill engine (`postLines`) re-run at the revised rate less the original
 *    (cost-plus percentages follow the wages); a service-charge line when the original bill carried one.
 * One note per original invoice (debit note by default, `arrears_doc`), in the original's regime and SAC; already
 * raised is derived from `mp.arrear.rev_id` / `of` (no stored flag). The employees' side (what the agency owes its
 * staff) is listed apart; nothing is written to payroll. Working papers — verify with your CA (MP12, MP41).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { ManpowerSettings, MpPost, SiteMuster, WageRevision } from '../../types/manpower-r17';
import type { Site } from './mp-sites';
import type { Staff } from './mp-muster';
import { round2 } from '../invoice-calc';
import { daysIn } from './mp-muster';
import { postLines } from './mp-bill';

const lc = (s?: string) => (s ?? '').trim().toLowerCase();
const fits = (r: WageRevision, p: Pick<MpPost, 'name' | 'zone' | 'skill'>) => (!r.post_name || lc(r.post_name) === lc(p.name)) && (!r.zone || lc(r.zone) === lc(p.zone)) && (!r.skill || lc(r.skill) === lc(p.skill));
const inRange = (r: WageRevision, month: string) => month >= r.from.slice(0, 7) && (!r.to || month <= r.to.slice(0, 7));

/** ₹ more a duty for a post: the typed increase, else the new minimum less the previous matching revision's. */
export function deltaFor(rev: WageRevision, revs: readonly WageRevision[], post: Pick<MpPost, 'name' | 'zone' | 'skill'>): number {
  if (!fits(rev, post)) return 0;
  if (Number(rev.delta_day) > 0) return round2(Number(rev.delta_day));
  const prev = revs.filter((r) => r.id !== rev.id && r.from < rev.from && Number(r.wage_day) > 0 && fits(r, post)).sort((a, b) => b.from.localeCompare(a.from))[0];
  return prev ? round2(Math.max(0, Number(rev.wage_day) - Number(prev.wage_day))) : 0;
}

export const passesThrough = (site: Site, rev: WageRevision): boolean => site.mp.contract?.escalation === 'vda_pass_through' || !!rev.site_ids?.includes(site.id);

export interface ArrearLine { name: string; hsn: string; quantity: number; rate: number; amount: number; site: Site; post: MpPost; month: string; duties: number; delta: number }
export interface ArrearNote { of: InvoiceRecord; lines: ArrearLine[]; amount: number; raised: InvoiceRecord[] }

/** The arrears of one post of a muster at the revised rate. */
export function postArrear(site: Site, post: MpPost, m: Pick<SiteMuster, 'month' | 'rows'>, delta: number, s: ManpowerSettings, ref: string): ArrearLine | null {
  const duties = m.rows.filter((r) => r.post_id === post.id).reduce((t, r) => t + (Number(r.duties) || 0), 0);
  if (!(delta > 0) || !duties) return null;
  const head = `Arrears ${m.month} — ${post.name}`;
  if (post.basis === 'duty') return { name: `${head}: ${duties} duties × ₹${delta} (${ref})`, hsn: post.sac, quantity: duties, rate: delta, amount: round2(duties * delta), site, post, month: m.month, duties, delta };
  const days = s.billing_days === 26 || s.billing_days === 30 ? s.billing_days : daysIn(m.month);
  const rate = post.basis === 'hour' ? post.rate + delta / post.shift_hours : post.basis === 'month' ? post.rate + delta * days : post.rate + delta;
  const sum = (p: MpPost) => postLines(site, p, m, s, () => '').reduce((t, l) => t + l.amount, 0);
  const amount = round2(sum({ ...post, rate }) - sum(post));
  return amount > 0 ? { name: `${head}: revised by ₹${delta} a duty (${ref})`, hsn: post.sac, quantity: 1, rate: amount, amount, site, post, month: m.month, duties, delta } : null;
}

export function mpArrears(i: { rev: WageRevision; revs: readonly WageRevision[]; sites: readonly Site[]; musters: readonly SiteMuster[]; invoices: readonly InvoiceRecord[]; settings: ManpowerSettings }): ArrearNote[] {
  const out: ArrearNote[] = [];
  for (const inv of i.invoices) {
    const mp = inv.mp;
    if (!mp?.month || !mp.muster_id || inv.status === 'Cancelled' || inv.doc_type === 'CREDIT_NOTE' || inv.doc_type === 'DEBIT_NOTE' || !inRange(i.rev, mp.month)) continue;
    const lines: ArrearLine[] = [];
    for (const m of i.musters.filter((x) => (mp.muster_ids ?? [mp.muster_id]).includes(x.id))) {
      const site = i.sites.find((s) => s.id === m.site_id);
      if (!site || !passesThrough(site, i.rev)) continue;
      for (const post of site.mp.posts.filter((p) => (mp.posts ?? []).some((r) => r.post === p.name && (!r.site || r.site === site.mp.code)))) {
        const a = postArrear(site, post, m, deltaFor(i.rev, i.revs, post), i.settings, i.rev.ref);
        if (a) lines.push(a);
      }
    }
    const pct = Number(i.settings.service_charge_pct) || 0;
    if (pct > 0 && lines.length && inv.items?.some((l) => /^Service charge/.test(l.name))) {
      // One service-charge line per site on a note of several sites (QA20 V3: each line keeps its site).
      const sites = [...new Set(lines.map((l) => l.site))];
      for (const site of sites) {
        const mine = lines.filter((l) => l.site === site);
        const amt = round2((round2(mine.reduce((t, l) => t + l.amount, 0)) * pct) / 100);
        if (amt > 0) lines.push({ ...mine[0], name: `Service charge ${pct} % on arrears${sites.length > 1 ? ` — ${site.mp.code}` : ''}`, quantity: 1, rate: amt, amount: amt, duties: 0, delta: 0 });
      }
    }
    if (!lines.length) continue;
    const raised = i.invoices.filter((x) => x.status !== 'Cancelled' && x.mp?.arrear?.rev_id === i.rev.id && x.mp.arrear.of === inv.id);
    out.push({ of: inv, lines, amount: round2(lines.reduce((t, l) => t + l.amount, 0)), raised });
  }
  return out;
}

/** What the agency owes its staff for the revision: Σ duties × increase per person, every site, from the revision on. */
export function staffArrears(rev: WageRevision, revs: readonly WageRevision[], sites: readonly Site[], musters: readonly SiteMuster[], staff: readonly Pick<Staff, 'id' | 'name' | 'code'>[]): { employee_id: string; name: string; duties: number; amount: number }[] {
  const by = new Map<string, { employee_id: string; name: string; duties: number; amount: number }>();
  for (const m of musters.filter((x) => inRange(rev, x.month))) {
    const site = sites.find((s) => s.id === m.site_id);
    for (const r of m.rows) {
      const post = site?.mp.posts.find((p) => p.id === r.post_id);
      const d = post ? deltaFor(rev, revs, post) : 0;
      if (!d || !(r.duties > 0)) continue;
      const e = by.get(r.employee_id) ?? { employee_id: r.employee_id, name: staff.find((x) => x.id === r.employee_id)?.name ?? r.employee_id, duties: 0, amount: 0 };
      e.duties += r.duties;
      e.amount = round2(e.amount + r.duties * d);
      by.set(r.employee_id, e);
    }
  }
  return [...by.values()];
}

