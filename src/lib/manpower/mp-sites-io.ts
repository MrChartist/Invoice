/**
 * R17-A2 bridge: sites written as project cost centres (`cost-centres.ts`) and the client flags on `Client.mp`. Outside
 * the `f-manpower` group by design (it reaches a shared lazy module); reads and rules are in `mp-sites.ts`. R17-C2:
 * the purchase bills tagged to a site (through `readPurchase`).
 */
import type { ClientMp, SiteInfo } from '../../types/manpower-r17';
import { loadCostCentres, saveCostCentre } from '../cost-centres';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { cleanSite, loadSites, validateSite, type Site } from './mp-sites';
import type { SiteBill } from './mp-profit';
import { getTable } from '../storage';
import { round2 } from '../invoice-calc';
import { readPurchase } from '../purchase-normalize';

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

/**
 * R17-C2: the month's purchase bills tagged to a site (`PurchaseRecord.mp.site_id`), read through `readPurchase`
 * (the purchases contract): cost = taxable value, plus the tax when no ITC is taken; void bills left out.
 */
export function siteBills(month: string): SiteBill[] {
  const out: SiteBill[] = [];
  for (const raw of getTable<{ mp?: { site_id?: string } }>('purchases')) {
    const c = raw?.mp?.site_id ? readPurchase(raw) : null;
    if (c && c.date.startsWith(month) && c.status !== 'void') out.push({ site_id: raw.mp!.site_id!, cost: round2(c.taxable + (c.itcEligible ? 0 : c.tax + c.cess)) });
  }
  return out;
}
