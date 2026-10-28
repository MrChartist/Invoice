/**
 * R17-D3 licence and renewal notices for the notification bell (loaded lazily by the bell only with the `manpower`
 * pack; it registers `mpNotices`, which re-checks the packs on every run — turning them off silences it). Rows:
 * PSARA licences (only with the `security` pack), OSH / contract-labour / trade / other licences
 * (`manpower_settings.licences`), guards' own licences (`Employee.mp.guard_licence`) and site contract ends
 * (`CostCentre.mp.contract.to`), at `VDA_REVISION_RULES.alert_days` (60 / 30 / 7) before the date (expired = critical);
 * and the VDA month reminder (April / October) when no revision from that month is typed. Working papers (MP43).
 */
import type { AppNotification, NotificationContext } from '../notifications';
import type { ManpowerSettings, MpLicence } from '../../types/manpower-r17';
import type { Site } from './mp-sites';
import { DB_PREFIX, getJson, getTable } from '../storage';
import { ruleAt } from '../tax-rules';
import { localDayOf } from '../dates';
import { localDb } from '../localDb';
import { VDA_REVISION_RULES } from '../manpower-rules';
import { MP_OBJECTS } from './mp-shared';
import { loadSites } from './mp-sites';

const HREF = '/time?tab=deploy&view=statutory';
const dayNo = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 864e5;

export interface MpAlertInput { today: string; settings: ManpowerSettings; packs: readonly string[]; sites: readonly Site[]; guards: readonly { id: string; name: string; mp?: { guard_licence?: { no: string; valid_till: string } } }[] }
export type MpAlert = Omit<AppNotification, 'at'>;

export function mpAlerts(i: MpAlertInput): MpAlert[] {
  const r = ruleAt(VDA_REVISION_RULES, i.today);
  const max = Math.max(...r.alert_days);
  const out: MpAlert[] = [];
  const due = (id: string, what: string, till: string) => {
    const left = dayNo(till) - dayNo(i.today);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(till) || left > max) return;
    const step = r.alert_days.filter((d) => left <= d).sort((a, b) => a - b)[0] ?? 0;
    out.push({ id: `mp:${id}:${till}:${left < 0 ? 'x' : step}`, severity: left < 0 || left <= Math.min(...r.alert_days) ? 'critical' : left <= 30 ? 'warning' : 'info', title: `${what} ${left < 0 ? 'expired' : 'expires'} ${till}`, detail: left < 0 ? 'Renew it now.' : `${left} days left: start the renewal.`, href: HREF, cta: 'Open' });
  };
  const lic = (l: MpLicence) => `${l.kind === 'psara' ? 'PSARA' : l.kind.toUpperCase()} licence ${l.no}${l.state ? ` (${l.state})` : ''}`;
  for (const l of i.settings.licences ?? []) if (l.kind !== 'psara' || i.packs.includes('security')) due(`lic:${l.id}`, lic(l), l.valid_till);
  for (const g of i.guards) if (g.mp?.guard_licence?.valid_till) due(`guard:${g.id}`, `Guard licence of ${g.name}`, g.mp.guard_licence.valid_till);
  for (const s of i.sites) if (s.mp.status !== 'closed' && s.mp.contract?.to) due(`site:${s.id}`, `Contract of ${s.mp.code} ${s.name}`, s.mp.contract.to);
  const month = i.today.slice(0, 7);
  if (r.months.includes(Number(month.slice(5))) && !(i.settings.wage_revisions ?? []).some((w) => w.from.startsWith(month))) {
    out.push({ id: `mp:vda:${month}`, severity: 'info', title: 'Minimum wage / VDA revision month', detail: 'Type the revision that applies to your posts when it is notified; arrears follow from it.', href: '/time?tab=deploy&view=compliance', cta: 'Open' });
  }
  return out;
}

/** The bell provider (registered by the bell's `manpower` gate). */
export function mpNotices(ctx: Pick<NotificationContext, 'now'>): AppNotification[] {
  const s = localDb.settings.get() as { industry_packs?: unknown };
  const packs = Array.isArray(s.industry_packs) ? (s.industry_packs as string[]) : [];
  if (!packs.includes('manpower') && !packs.includes('security')) return [];
  const today = localDayOf(ctx.now);
  const settings = getJson<ManpowerSettings | null>(`${DB_PREFIX}${MP_OBJECTS.settings}`, null) ?? {};
  const at = ctx.now.toISOString();
  return mpAlerts({ today, settings, packs, sites: loadSites(), guards: getTable('employees') }).map((a) => ({ ...a, at }));
}
