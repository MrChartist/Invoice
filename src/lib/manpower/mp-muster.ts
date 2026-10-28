/**
 * R17-B1 duty register (muster): table `site_musters`, one row per site × month with ≤ 300 person rows inside (duties
 * in 0.5 steps, OT hours, reliever tick). Warnings never block: more duties than days × 2, a person over 31 duties
 * across all sites, a person who left before the month. "Copy last month" pre-fills from the previous muster, else from
 * the people deployed at the site at full duties. A locked muster is read-only until "Unlock"; billing and the payroll
 * push read locked musters only. Pure reads and rules here; writes in `mp-muster-save.ts`. Working papers — verify with your CA (MP32).
 */
import { mbT } from '../../i18n/areas/manpower-r17b';
import type { MusterRow, SiteMuster } from '../../types/manpower-r17';
import type { Site } from './mp-sites';
import { getTable } from '../storage';
import { MP_TABLES } from './mp-shared';

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MAX_MUSTER_ROWS = 300;

/** A payroll employee as the muster reads it (raw rows; payroll owns the table). */
export interface Staff { id: string; code: string; name: string; cost_centre_id?: string; dol?: string; doj?: string; active?: boolean; mp?: { post_id?: string } }

export const daysIn = (month: string): number => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
export const monthEnd = (month: string): string => `${month}-${String(daysIn(month)).padStart(2, '0')}`;
export const prevMonth = (month: string): string => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

export const loadStaff = (): Staff[] => getTable<Staff>('employees').filter((e) => e?.id && e.name).map((e) => ({ ...e, code: e.code || e.id.slice(0, 6) }));
/** Musters of one month (default: every month). */
export const loadMusters = (month?: string): SiteMuster[] => getTable<SiteMuster>(MP_TABLES.musters).filter((m) => m?.id && m.site_id && (!month || m.month === month));
export const musterOf = (musters: readonly SiteMuster[], siteId: string, month: string): SiteMuster | undefined => musters.find((m) => m.site_id === siteId && m.month === month);

/** People deployed at a site in a month (active, joined by the month end, not left before it). */
export const deployedAt = (site: Pick<Site, 'id'>, month: string, staff: readonly Staff[]): Staff[] =>
  staff.filter((e) => e.cost_centre_id === site.id && e.active !== false && !(e.dol && e.dol < `${month}-01`) && !(e.doj && e.doj > monthEnd(month)));

/** "Copy last month": the previous muster's rows, else the deployed people at full duties on their post. */
export function copyRows(site: Site, month: string, musters: readonly SiteMuster[], staff: readonly Staff[]): MusterRow[] {
  const prev = musterOf(musters, site.id, prevMonth(month));
  const posts = site.mp.posts;
  if (prev?.rows.length) return prev.rows.filter((r) => posts.some((p) => p.id === r.post_id)).map((r) => ({ ...r }));
  const days = daysIn(month);
  return deployedAt(site, month, staff).map((e) => ({ employee_id: e.id, post_id: posts.some((p) => p.id === e.mp?.post_id) ? e.mp!.post_id! : (posts[0]?.id ?? ''), duties: days }));
}

/** Per post: duties (relievers included) against heads × days. */
export function postTotals(site: Site, rows: readonly MusterRow[], days: number) {
  return site.mp.posts.map((p) => {
    const mine = rows.filter((r) => r.post_id === p.id);
    return { post: p, duties: mine.reduce((t, r) => t + (Number(r.duties) || 0), 0), ot: mine.reduce((t, r) => t + (Number(r.ot_hours) || 0), 0), full: p.heads * days };
  });
}

export interface MusterWarning { employee_id?: string; text: string }

/** Warnings (never block). `others` = the month's musters of other sites (cross-site duty count). */
export function musterWarnings(m: Pick<SiteMuster, 'site_id' | 'month' | 'rows'>, others: readonly SiteMuster[], staff: readonly Staff[]): MusterWarning[] {
  const days = daysIn(m.month);
  const out: MusterWarning[] = [];
  const name = (id: string) => staff.find((e) => e.id === id)?.name ?? id;
  const seen = new Set<string>();
  for (const r of m.rows) {
    if (r.duties > days * 2) out.push({ employee_id: r.employee_id, text: mbT('w.two', { n: name(r.employee_id), d: r.duties, m: days * 2 }) });
    if (seen.has(r.employee_id)) continue;
    seen.add(r.employee_id);
    const all = [m, ...others.filter((o) => o.site_id !== m.site_id && o.month === m.month)].reduce((t, x) => t + x.rows.filter((y) => y.employee_id === r.employee_id).reduce((s, y) => s + (Number(y.duties) || 0), 0), 0);
    if (all > 31) out.push({ employee_id: r.employee_id, text: mbT('w.all', { n: name(r.employee_id), d: all }) });
    const dol = staff.find((e) => e.id === r.employee_id)?.dol;
    if (dol && dol < `${m.month}-01`) out.push({ employee_id: r.employee_id, text: mbT('w.left', { n: name(r.employee_id), d: dol }) });
  }
  return out;
}

/** Problems that stop a save (empty = may be saved). */
export function validateRows(rows: readonly MusterRow[], site: Site): string {
  if (rows.length > MAX_MUSTER_ROWS) return `At most ${MAX_MUSTER_ROWS} rows a muster; split the site by post group.`;
  for (const r of rows) {
    if (!r.employee_id) return 'Every row needs a person.';
    if (!site.mp.posts.some((p) => p.id === r.post_id)) return 'Every row needs a post of this site.';
    if (!(r.duties >= 0) || Math.round(r.duties * 2) !== r.duties * 2) return 'Duties go in steps of 0.5.';
    if (r.ot_hours !== undefined && !(r.ot_hours >= 0)) return 'OT hours cannot be negative.';
  }
  return '';
}

