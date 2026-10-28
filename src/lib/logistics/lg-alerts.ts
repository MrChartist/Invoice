/**
 * R19-D4 logistics notices for the notification bell (loaded lazily by the bell's `logistics` gate, which registers
 * `lgNotices`; it re-checks the packs on every run, so nothing shows while the Round 19 packs are off). Jobs delivered
 * more than 7 days ago (by their last status change) with no live bill; disbursements on a client's behalf older than
 * 30 days not yet recovered on a live bill of the job (`lg.disb`, else its Rule 33 lines); duty paid above the deposits
 * of a job whose bill of entry is in; last month's courier manifests still unbilled after the 5th. Purchases are read
 * as stored (`total`, `date`, `lg`). Working papers — verify with your CA (LG10, LG12).
 */
import { lgdT } from '../../i18n/areas/logistics-r19d';
import type { AppNotification, NotificationContext } from '../notifications';
import type { InvoiceRecord } from '../../types/invoice';
import type {} from '../../types/trade-r8';
import type { PurchaseRecord } from '../../types/purchases';
import type { LgJob, LgManifest } from '../../types/logistics-r19';
import { round2 } from '../invoice-calc';
import { localDayOf, shiftDay } from '../dates';
import { getTable } from '../storage';
import { localDb } from '../localDb';
import { LG_PACKS, LG_TABLES } from './lg-shared';
import { liveBills, periodOf, prevPeriod } from './lg-doc';
import { billedManifests } from './lg-courier';

export interface AlertData { jobs: readonly LgJob[]; invoices: readonly InvoiceRecord[]; purchases: readonly PurchaseRecord[]; advances: readonly { amount: number; lg?: { job_id: string } }[]; manifests: readonly LgManifest[] }
type Notice = Omit<AppNotification, 'at'>;
const sum = <T>(xs: readonly T[], f: (x: T) => number) => round2(xs.reduce((s, x) => s + (Number(f(x)) || 0), 0));
const inr = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Per job: what a live bill recovered (its disbursement schedule, else its Rule 33 lines). */
export function recoveredByJob(invoices: readonly InvoiceRecord[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of liveBills(invoices)) {
    const j = i.lg?.job_id;
    if (!j) continue;
    const v = i.lg!.disb?.length ? sum(i.lg!.disb, (d) => d.amount) : sum(i.items.filter((x) => x.charge_head_id === 'rule33'), (x) => x.quantity * x.rate);
    m.set(j, round2((m.get(j) ?? 0) + v));
  }
  return m;
}

export function lgAlerts(today: string, d: AlertData): Notice[] {
  const out: Notice[] = [], billed = new Set(liveBills(d.invoices).map((i) => i.lg?.job_id).filter(Boolean)), rec = recoveredByJob(d.invoices);
  const behalf = d.purchases.filter((p) => p.lg?.on_behalf && p.lg.job_id);
  const href = (view: string) => `/time?tab=shipments&view=${view}`;
  for (const j of d.jobs) {
    if (j.status === 'delivered' && (j.updated_at || j.date).slice(0, 10) <= shiftDay(today, -7) && !billed.has(j.id)) out.push({ id: `lg:unbilled:${j.id}`, severity: 'warning', title: lgdT('aUnbilled', { j: j.number }), detail: `${j.origin} → ${j.destination}`, href: href('jobs'), cta: lgdT('aOpen') });
    const mine = behalf.filter((p) => p.lg!.job_id === j.id);
    const old = sum(mine.filter((p) => p.date <= shiftDay(today, -30)), (p) => p.total), left = round2(old - (rec.get(j.id) ?? 0));
    if (left > 0.5) out.push({ id: `lg:disb:${j.id}`, severity: 'warning', title: lgdT('aDisb', { j: j.number }), detail: lgdT('aAmt', { a: inr(left) }), href: href('customs'), cta: lgdT('aOpen') });
    const short = round2(sum(mine.filter((p) => p.lg!.disb === 'duty'), (p) => p.total) - sum(d.advances.filter((a) => a.lg?.job_id === j.id), (a) => a.amount));
    if (j.refs?.boe_no && short > 0.5) out.push({ id: `lg:deposit:${j.id}`, severity: 'warning', title: lgdT('aShort', { j: j.number }), detail: inr(short), href: href('customs'), cta: lgdT('aOpen') });
  }
  const last = prevPeriod(periodOf(today)), done = billedManifests(d.invoices);
  const open = d.manifests.filter((m) => m.period === last && m.dockets?.length && !done.has(m.id));
  if (Number(today.slice(8, 10)) > 5 && open.length) out.push({ id: `lg:manifests:${last}`, severity: 'warning', title: lgdT('aMan', { n: open.length, p: last }), detail: '', href: href('courier'), cta: lgdT('aOpen') });
  return out;
}

/** The bell provider (registered by the bell's `logistics` gate): nothing unless a Round 19 pack is on. */
export function lgNotices(ctx: Pick<NotificationContext, 'now'>): AppNotification[] {
  const p = (localDb.settings.get() as { industry_packs?: unknown }).industry_packs;
  if (!Array.isArray(p) || !LG_PACKS.some((x) => p.includes(x))) return [];
  const at = ctx.now.toISOString();
  return lgAlerts(localDayOf(ctx.now), { jobs: getTable<LgJob>(LG_TABLES.jobs), invoices: localDb.invoices.getAll(), purchases: getTable<PurchaseRecord>('purchases'), advances: getTable('advances'), manifests: getTable<LgManifest>(LG_TABLES.manifests) }).map((a) => ({ ...a, at }));
}
