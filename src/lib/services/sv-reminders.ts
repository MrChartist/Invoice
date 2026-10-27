/**
 * SV-D4 service reminders and AMC visits. On billing a job the asset's next service is set from the billed labour ops'
 * intervals (or `workshop_settings.default_interval`): date = bill day + days; km = last reading + km, and when the
 * odometer history gives km per day, the day the km would be reached wins if it comes first. The reminders list holds
 * services due in 30 days / overdue and insurance policies expiring, with a `wa.me` text (en / hi). AMC contracts that
 * name assets offer *Create job* for each due visit; delivering that job logs the visit (`visitFromJob`).
 */
import type { ServiceJob } from '../../types/retail-r9';
import type { LabourOp, ServiceAsset, WorkshopSettings } from '../../types/services-r10';
import { addDaysIso, contractStatus, daysBetween, type AmcContract } from '../amc';
import { num } from '../invoice-calc';
import { lastKm } from './sv-assets';

/** Average km per day over the readings (needs at least a week between the first and the last). */
export function kmPerDay(a: Pick<ServiceAsset, 'odometer'>): number {
  const r = a.odometer ?? [];
  if (r.length < 2) return 0;
  const days = daysBetween(r[0].date, r[r.length - 1].date);
  return days >= 7 ? Math.max(0, (r[r.length - 1].km - r[0].km) / days) : 0;
}

/** Next service of an asset billed on `date` (pure). */
export function nextService(a: ServiceAsset, ops: readonly Pick<LabourOp, 'interval_days' | 'interval_km'>[], s: Pick<WorkshopSettings, 'default_interval'>, date: string): { date?: string; km?: number } {
  const pick = (k: 'interval_days' | 'interval_km') => {
    const v = ops.map((o) => num(o[k])).filter((x) => x > 0);
    return v.length ? Math.min(...v) : 0;
  };
  const days = pick('interval_days') || num(s.default_interval?.days);
  const km = pick('interval_km') || num(s.default_interval?.km);
  const last = lastKm(a);
  const rate = kmPerDay(a);
  let due = days > 0 ? addDaysIso(date, days) : undefined;
  if (km > 0 && rate > 0) {
    const byKm = addDaysIso(date, Math.ceil(km / rate));
    if (!due || byKm < due) due = byKm;
  }
  return { ...(due ? { date: due } : {}), ...(km > 0 && last !== undefined ? { km: last + km } : {}) };
}

export interface ReminderRow { asset: ServiceAsset; kind: 'service' | 'insurance'; date: string; overdue: boolean }

/** Services and insurance expiries due within `horizon` days, or overdue; soonest first. */
export function dueList(assets: readonly ServiceAsset[], today: string, horizon = 30): ReminderRow[] {
  const out: ReminderRow[] = [];
  for (const a of assets) {
    for (const [kind, d] of [['service', a.next_service_date], ['insurance', a.policy_expiry]] as const) {
      if (d && daysBetween(today, d) <= horizon) out.push({ asset: a, kind, date: d, overdue: d < today });
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

const TEXT = {
  en: {
    service: 'Hello {name}, your {what} is due for service on {date}{km}. Reply to book a slot. — {business}',
    insurance: 'Hello {name}, the insurance of your {what} expires on {date}. Renew it in time. — {business}',
    km: ' or at {km} km',
  },
  hi: {
    service: 'नमस्ते {name}, आपकी {what} की सर्विस {date}{km} को देय है। समय बुक करने के लिए जवाब दें। — {business}',
    insurance: 'नमस्ते {name}, आपकी {what} का बीमा {date} को ख़त्म होता है। समय पर रिन्यू करें। — {business}',
    km: ' या {km} km पर',
  },
} as const;

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

/** Reminder text (en / hi) for a row. */
export function reminderText(r: ReminderRow, business: string, lang: 'en' | 'hi' = 'en'): string {
  const t = TEXT[lang];
  const what = [r.asset.reg_no || r.asset.serial, r.asset.make, r.asset.model].filter(Boolean).join(' ');
  return fill(t[r.kind], { name: r.asset.owner_name, what, date: r.date, business, km: r.kind === 'service' && r.asset.next_service_km ? fill(t.km, { km: String(r.asset.next_service_km) }) : '' });
}

export interface AmcDue { contract: AmcContract; asset_id: string; date: string; visit: number; of: number }

/** AMC visits due within 7 days (or overdue) per covered asset, skipping assets that already have an open AMC job. */
export function amcDue(contracts: readonly AmcContract[], jobs: readonly Pick<ServiceJob, 'amc_id' | 'asset_id' | 'status'>[], today: string): AmcDue[] {
  const out: AmcDue[] = [];
  for (const c of contracts) {
    const s = contractStatus(c, today);
    if (!c.asset_ids?.length || !s.nextVisit || s.state === 'cancelled' || s.state === 'expired' || s.state === 'upcoming' || daysBetween(today, s.nextVisit) > 7) continue;
    for (const id of c.asset_ids) {
      if (jobs.some((j) => j.amc_id === c.id && j.asset_id === id && j.status !== 'delivered' && j.status !== 'returned')) continue;
      out.push({ contract: c, asset_id: id, date: s.nextVisit, visit: s.done + 1, of: s.schedule.length });
    }
  }
  return out;
}
