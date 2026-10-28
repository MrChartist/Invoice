/**
 * R17-A2 sites, posts and contracts (pure): a site IS a project cost centre with `CostCentre.mp` (code, address, State,
 * contract, posts with SAC / heads / shift / basis / rate, bill group, status) — the R14 matter / R15 trip precedent, so
 * budgets and the cost-centre P&L work unchanged. Codes are the agency's own (`S-<seq>` suggested, unique per company);
 * no series. The SAC of a post is suggested from its name and the agency's kind (`MP_SAC_RULES`, MP5); a typed SAC
 * wins. Storage is in `mp-sites-io.ts`.
 */
import type { MpBasis, MpPost, SiteInfo, SiteStatus } from '../../types/manpower-r17';
import { ruleAt } from '../tax-rules';
import { MP_SAC_RULES } from '../manpower-rules';
import { shiftDay } from '../dates';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const SITE_STATUSES: readonly SiteStatus[] = ['active', 'paused', 'closed'];
export const MP_BASES: readonly MpBasis[] = ['month', 'duty', 'hour', 'costplus'];
/** A site as the desk reads it (the cost centre's id, name and client with its `mp`). */
export interface Site { id: string; name: string; client_id?: string; mp: SiteInfo }

/** SAC for a post: guards / supervisors / gunmen 998525, housekeeping / cleaning 998533, else by the agency's kind. */
export function suggestSac(postName: string, kind?: string, date?: string): string {
  const t = ruleAt(MP_SAC_RULES, date);
  const n = postName.toLowerCase();
  if (/guard|supervis|gun|bouncer|security|watch/.test(n)) return t.guard;
  if (/house|clean|sweep|janitor|jhadu|safai/.test(n)) return t.cleaning;
  return kind === 'security' ? t.guard : kind === 'facility' ? t.cleaning : kind === 'staffing' ? t.contract : t.labour;
}

/** `S-<seq>`: the next free three-digit code. */
export function suggestSiteCode(sites: readonly Pick<Site, 'mp'>[]): string {
  const max = Math.max(0, ...sites.map((s) => Number(/^S-(\d+)$/i.exec(s.mp?.code ?? '')?.[1]) || 0));
  return `S-${String(max + 1).padStart(3, '0')}`;
}

/** Problems with a site (empty = may be saved). */
export function validateSite(name: string, s: SiteInfo, id: string | undefined, sites: readonly Pick<Site, 'id' | 'mp'>[]): string {
  const code = s.code?.trim();
  if (!name.trim()) return 'Give the site a name.';
  if (!code) return 'Give the site a code.';
  if (sites.some((x) => x.id !== id && x.mp?.code?.trim().toLowerCase() === code.toLowerCase())) return `Site code ${code} is already used.`;
  if (s.state && !/^\d{2}$/.test(s.state)) return 'The State code is two digits.';
  const { from, to } = s.contract ?? {};
  if ((from && !DAY.test(from)) || (to && !DAY.test(to)) || (from && to && to < from)) return 'Check the contract dates.';
  if (s.posts.length > 30) return 'At most 30 posts a site.';
  for (const p of s.posts) {
    if (!p.name?.trim()) return 'Every post needs a name.';
    if (!/^\d{6}$/.test(p.sac)) return `SAC of ${p.name} is six digits.`;
    if (!(p.heads > 0) || !(p.rate >= 0) || !(p.shift_hours > 0 && p.shift_hours <= 24) || !MP_BASES.includes(p.basis)) return `Check heads, shift, basis and rate of ${p.name}.`;
  }
  return '';
}

/** Pure: the site fields cleaned (blank optionals dropped). */
export function cleanSite(s: SiteInfo): SiteInfo {
  const v = (x?: string) => x?.trim() || undefined;
  const contract = Object.fromEntries(Object.entries(s.contract ?? {}).filter(([, x]) => v(x as string))) as SiteInfo['contract'];
  const posts = s.posts.map((p): MpPost => {
    const out: MpPost = { id: p.id, name: p.name.trim(), sac: p.sac.trim(), heads: Number(p.heads), shift_hours: Number(p.shift_hours), basis: p.basis, rate: Math.round(Number(p.rate) * 100) / 100 };
    for (const k of ['skill', 'zone'] as const) if (v(p[k])) out[k] = v(p[k]);
    if (p.bill_ot) out.bill_ot = true;
    if (p.bill_extra) out.bill_extra = true;
    return out;
  });
  const out: SiteInfo = { code: s.code.trim().toUpperCase(), contract, posts, status: SITE_STATUSES.includes(s.status) ? s.status : 'active' };
  for (const k of ['address', 'state', 'bill_group'] as const) if (v(s[k])) out[k] = v(s[k]);
  return out;
}

/** Value of a site's posts for a month at full duties (`days` duties a head; hour posts at their shift; cost-plus = wages). */
export const monthValue = (s: Pick<SiteInfo, 'posts'>, days: number): number =>
  Math.round(s.posts.reduce((t, p) => t + p.rate * p.heads * (p.basis === 'month' ? 1 : p.basis === 'hour' ? days * p.shift_hours : days), 0) * 100) / 100;

/** The contract ends within `within` days of `today` (or has ended). */
export const endsSoon = (s: Pick<SiteInfo, 'contract'>, today: string, within = 30): boolean => !!s.contract?.to && s.contract.to <= shiftDay(today, within);
