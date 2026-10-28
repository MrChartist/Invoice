/**
 * R17-A2 bridge: sites stored as project cost centres (`cost-centres.ts`), the client flags on `Client.mp`, and the firm
 * form read from the annual pack's entity type (R14 `ps-profile.ts`, never a second field). Outside the `f-manpower`
 * group by design (it reaches shared lazy modules); the pure rules are in `mp-sites.ts` / `mp-regime.ts`.
 */
import type { ClientMp, SiteInfo } from '../../types/manpower-r17';
import { loadCostCentres, saveCostCentre, type CostCentre } from '../cost-centres';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { readFirmForm } from '../prof/ps-profile';
import { cleanSite, validateSite, type Site } from './mp-sites';

export const isSite = (c: Pick<CostCentre, 'mp'> | undefined): c is CostCentre & { mp: SiteInfo } => !!c?.mp?.code;
export const loadSites = (all: readonly CostCentre[] = loadCostCentres()): Site[] => all.filter(isSite);
export const siteLabel = (s: Pick<Site, 'name' | 'mp'>): string => `${s.mp.code} — ${s.name}`;

export interface SiteInput { id?: string; name: string; client_id?: string; mp: SiteInfo }

/** Add / edit a site (`doc.create`): a project cost centre active unless closed, dated by the contract. */
export function saveSite(i: SiteInput): Site {
  requireAccess('doc.create');
  const all = loadCostCentres();
  const prev = i.id ? all.find((c) => c.id === i.id) : undefined;
  const mp = cleanSite(i.mp);
  const err = validateSite(i.name, mp, prev?.id, loadSites(all));
  if (err) throw new Error(err);
  return saveCostCentre({
    ...(prev ?? { active: true }),
    id: prev?.id,
    name: i.name.trim(),
    kind: 'project',
    client_id: i.client_id || undefined,
    start: mp.contract.from,
    due: mp.contract.to,
    status: mp.status === 'closed' ? 'done' : mp.status === 'paused' ? 'on_hold' : 'active',
    mp,
  }) as Site;
}

/** The client's regime / TDS flags (`Client.mp`; an empty set removes them). */
export function saveClientMp(clientId: string, flags: ClientMp): void {
  requireAccess('doc.create');
  const c = localDb.clients.getById(clientId);
  if (!c) return;
  const mp = Object.fromEntries(Object.entries(flags).filter(([, v]) => v)) as ClientMp;
  localDb.clients.upsert({ ...c, name: c.name, mp: Object.keys(mp).length ? mp : undefined });
}

/** Our firm form for the regime engine (absent = proprietorship). */
export const firmForm = (): string => readFirmForm() ?? 'proprietorship';
