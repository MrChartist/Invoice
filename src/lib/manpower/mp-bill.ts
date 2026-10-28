/**
 * R17-B3 bill from the muster (pure). Per post of a site, from its locked muster:
 *  - `duty`: Σ duties × rate;  `hour`: Σ duties × shift hours × rate (+ OT hours × rate with "bill OT");
 *  - `month`: rate × heads × billed duties ÷ (heads × billing days) — capped at rate × heads unless "bill extra duties";
 *  - `costplus`: wages (Σ duties × the post's wage rate) + the typed cost-plus percentages of the wages and uniforms per
 *    head, each ONE line of the same SAC and rate (one supply, not pure agent — MP6, MP21);
 *  - a service-charge line (`service_charge_pct` of the bill's lines) on any basis.
 * Grouping: one invoice per site, or per client + `bill_group` (lines per site × post, the site code in the line).
 * Each group is split by the A3 regime of its lines (`splitPosts`), so RCM and forward-charge posts never share an
 * invoice. Billed state is derived from invoices whose `mp.muster_id` / `mp.muster_ids` name the muster (no stored
 * flag). Money in paise (`round2`). Working papers — verify with your CA (MP6, MP10, MP11, MP21, MP32, MP34, MP35).
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { ClientMp, ManpowerSettings, MpPost, MpPostRow, MpSnapshot, SiteMuster } from '../../types/manpower-r17';
import type { Site } from './mp-sites';
import { round2 } from '../invoice-calc';
import { postRegime, splitPosts, type RegimeCtx, type RegimeResult } from './mp-regime';
import { daysIn, monthEnd, type Staff } from './mp-muster';

export type BillLine = Pick<InvoiceItem, 'id' | 'name' | 'hsn' | 'unit' | 'quantity' | 'rate' | 'amount'> & { sac: string; site: Site; post: MpPost; duties: number };

/** The invoice date of a month's bill (MP11): the month's last day, or the 1st of the next month. */
export function billDate(month: string, s: Pick<ManpowerSettings, 'bill_date'> = {}): string {
  if (s.bill_date !== 'next_1') return monthEnd(month);
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

const COSTPLUS: readonly [keyof NonNullable<ManpowerSettings['costplus']>, string][] = [['pf_pct', 'PF (employer)'], ['esi_pct', 'ESI (employer)'], ['bonus_pct', 'Bonus'], ['leave_pct', 'Leave reserve'], ['relieving_pct', 'Relieving charges']];

/** The invoice lines of one post at a site for a month (`grouped` = the site code goes in the line). */
export function postLines(site: Site, post: MpPost, m: Pick<SiteMuster, 'month' | 'rows'>, s: ManpowerSettings, newId: () => string, grouped = false): BillLine[] {
  const rows = m.rows.filter((r) => r.post_id === post.id);
  const duties = rows.reduce((t, r) => t + (Number(r.duties) || 0), 0);
  const ot = rows.reduce((t, r) => t + (Number(r.ot_hours) || 0), 0);
  if (!duties && !ot) return [];
  const days = s.billing_days === 26 || s.billing_days === 30 ? s.billing_days : daysIn(m.month);
  const nm = `${grouped ? `${site.mp.code} ${site.name} — ` : ''}${post.name}`;
  const line = (name: string, unit: string, quantity: number, rate: number, amount = round2(quantity * rate)): BillLine => ({ id: newId(), name, hsn: post.sac, sac: post.sac, unit, quantity, rate, amount, site, post, duties });
  if (post.basis === 'duty') return [line(nm, 'DUTY', duties, post.rate)];
  if (post.basis === 'hour') {
    const h = round2(duties * post.shift_hours + (post.bill_ot ? ot : 0));
    return [line(`${nm} (${duties} duties × ${post.shift_hours} h${post.bill_ot && ot ? ` + ${ot} h OT` : ''})`, 'HRS', h, post.rate)];
  }
  if (post.basis === 'month') {
    const share = post.bill_extra ? duties / days : Math.min(duties / days, post.heads);
    const amt = round2(post.rate * share);
    return [line(`${nm} (${post.heads} × ₹${post.rate} a month; ${duties} of ${post.heads * days} duties)`, 'MONTH', 1, amt, amt)];
  }
  const wages = round2(duties * post.rate);
  const out = [line(`${nm} — wages (${duties} duties × ₹${post.rate})`, 'DUTY', duties, post.rate, wages)];
  for (const [k, label] of COSTPLUS) {
    const pct = Number(s.costplus?.[k]) || 0;
    if (pct > 0) out.push(line(`${nm} — ${label} ${pct} %`, 'NOS', 1, round2((wages * pct) / 100)));
  }
  const uni = Number(s.costplus?.uniform_per_head) || 0;
  if (uni > 0) out.push(line(`${nm} — uniforms (${post.heads} × ₹${uni})`, 'NOS', post.heads, uni));
  return out;
}

export interface BillPlan {
  key: string;
  client_id: string;
  date: string;
  sites: Site[];
  musters: SiteMuster[];
  regime: RegimeResult;
  lines: BillLine[];
  items: InvoiceItem[];
  taxable: number;
  mp: MpSnapshot;
}

/** Invoices (not cancelled) that bill a muster. */
export const billsOf = (invoices: readonly InvoiceRecord[], musterId: string): InvoiceRecord[] =>
  invoices.filter((i) => i.status !== 'Cancelled' && (i.mp?.muster_id === musterId || !!i.mp?.muster_ids?.includes(musterId)));

export interface PlanInput {
  month: string;
  sites: readonly Site[];
  /** The month's musters (drafts are skipped: "Lock first"). */
  musters: readonly SiteMuster[];
  settings: ManpowerSettings;
  clients: readonly { id?: string; gstin?: string; mp?: ClientMp }[];
  entityType: string;
  staff: readonly Staff[];
  newId: () => string;
}

/** Bills of a month: one per site (or client + bill group) and regime, from locked musters with a client. */
export function billPlans(i: PlanInput): BillPlan[] {
  const date = billDate(i.month, i.settings);
  const groups = new Map<string, { site: Site; m: SiteMuster }[]>();
  for (const m of i.musters) {
    const site = i.sites.find((s) => s.id === m.site_id);
    if (m.month !== i.month || m.status !== 'locked' || !site?.client_id) continue;
    const key = site.mp.bill_group ? `${site.client_id}|${site.mp.bill_group}` : site.id;
    groups.set(key, [...(groups.get(key) ?? []), { site, m }]);
  }
  const out: BillPlan[] = [];
  for (const [key, g] of groups) {
    const client = i.clients.find((c) => c.id === g[0].site.client_id);
    const ctx: RegimeCtx = { date, entityType: i.entityType, client };
    const grouped = g.length > 1;
    const lines = g.flatMap(({ site, m }) => site.mp.posts.flatMap((p) => postLines(site, p, m, i.settings, i.newId, grouped)));
    for (const [, part] of Object.entries(splitPosts(lines, ctx))) {
      if (!part?.length) continue;
      const items: InvoiceItem[] = part.map((l) => ({ id: l.id, name: l.name, hsn: l.hsn, unit: l.unit, quantity: l.quantity, rate: l.rate, amount: l.amount, type: 'Service', discount_percent: 0, tax_rate: 0 }));
      const pct = Number(i.settings.service_charge_pct) || 0;
      const base = round2(part.reduce((t, l) => t + l.amount, 0));
      if (pct > 0) {
        const amt = round2((base * pct) / 100);
        items.push({ id: i.newId(), name: `Service charge ${pct} %`, hsn: part[0].hsn, unit: 'NOS', quantity: 1, rate: amt, amount: amt, type: 'Service', discount_percent: 0, tax_rate: 0 });
      }
      const ms = g.filter(({ site }) => part.some((l) => l.site.id === site.id));
      const byPost = new Map<string, MpPostRow>();
      for (const l of part) {
        const k = `${l.site.id}|${l.post.id}`;
        const row = byPost.get(k);
        if (row) row.amount = round2((row.amount ?? 0) + l.amount);
        else byPost.set(k, { post: l.post.name, sac: l.sac, heads: l.post.heads, duties: l.duties, rate: l.post.rate, amount: l.amount, basis: l.post.basis, line_id: l.id, ...(grouped ? { site: l.site.mp.code } : {}) });
      }
      const posts = [...byPost.values()];
      const name = (id: string) => i.staff.find((e) => e.id === id);
      const annex = ms.flatMap(({ site, m }) => m.rows.filter((r) => part.some((l) => l.site === site && l.post.id === r.post_id)).map((r) => ({ name: name(r.employee_id)?.name ?? '—', code: name(r.employee_id)?.code ?? '', duties: r.duties, ...(r.ot_hours ? { ot: r.ot_hours } : {}), post: `${grouped ? `${site.mp.code} ` : ''}${site.mp.posts.find((p) => p.id === r.post_id)?.name ?? ''}${r.relief ? ' (reliever)' : ''}` })));
      const bases = [...new Set(part.map((l) => l.post.basis))];
      const one = ms.length === 1 ? ms[0].site : undefined;
      out.push({
        key, client_id: g[0].site.client_id!, date, sites: ms.map((x) => x.site), musters: ms.map((x) => x.m), regime: postRegime(part[0].sac, ctx), lines: part, items,
        taxable: round2(items.reduce((t, l) => t + l.amount, 0)),
        mp: {
          ...(one ? { site: { id: one.id, code: one.mp.code, name: one.name } } : {}), month: i.month, ...(bases.length === 1 ? { basis: bases[0] } : {}), posts,
          muster_id: ms[0].m.id, ...(ms.length > 1 ? { muster_ids: ms.map((x) => x.m.id) } : {}), ...(annex.length ? { annex } : {}),
        },
      });
    }
  }
  return out;
}
