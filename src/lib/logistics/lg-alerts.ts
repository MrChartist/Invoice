/**
 * R19-D4 logistics notices for the notification bell (loaded lazily by the bell's `logistics` gate together with C's
 * bridge `lg-recv-io.ts`, which reads the disbursements and deposits; `lgNotices` re-checks the packs on every run, so
 * nothing shows while the Round 19 packs are off). Jobs delivered more than 7 days ago (by their last status change)
 * with no live bill; C's unrecovered disbursements (`lg-disb.ts` `unrecovered`: not on a live invoice line, not written
 * off) older than 30 days; a job whose bill of entry is in and whose deposits fall short of its unrecovered
 * disbursements (`lg-deposits.ts` `depositPosition`); last month's courier manifests still unbilled after the 5th.
 * Working papers — verify with your CA (LG10, LG12).
 */
import { lgdT } from '../../i18n/areas/logistics-r19d';
import type { AppNotification, NotificationContext } from '../notifications';
import type { InvoiceRecord } from '../../types/invoice';
import type { LgJob, LgManifest } from '../../types/logistics-r19';
import { localDayOf, shiftDay } from '../dates';
import { getTable } from '../storage';
import { localDb } from '../localDb';
import { LG_PACKS, LG_TABLES } from './lg-shared';
import { liveBills, periodOf, prevPeriod } from './lg-doc';
import { billedManifests } from './lg-courier';
import { sumOf, unrecovered, type LgDisbRow } from './lg-disb';
import { depositPosition, type DepositBal } from './lg-deposits';

export interface AlertData { jobs: readonly LgJob[]; invoices: readonly InvoiceRecord[]; disb: readonly LgDisbRow[]; deposits: readonly DepositBal[]; manifests: readonly LgManifest[] }
type Notice = Omit<AppNotification, 'at'>;
const inr = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function lgAlerts(today: string, d: AlertData): Notice[] {
  const out: Notice[] = [], billed = new Set(liveBills(d.invoices).map((i) => i.lg?.job_id).filter(Boolean)), open = unrecovered(d.disb);
  const href = (view: string) => `/time?tab=shipments&view=${view}`;
  for (const j of d.jobs) {
    if (j.status === 'delivered' && (j.updated_at || j.date).slice(0, 10) <= shiftDay(today, -7) && !billed.has(j.id)) out.push({ id: `lg:unbilled:${j.id}`, severity: 'warning', title: lgdT('aUnbilled', { j: j.number }), detail: `${j.origin} → ${j.destination}`, href: href('jobs'), cta: lgdT('aOpen') });
    const mine = open.filter((r) => r.job_id === j.id), old = sumOf(mine.filter((r) => r.age > 30));
    if (old > 0.5) out.push({ id: `lg:disb:${j.id}`, severity: 'warning', title: lgdT('aDisb', { j: j.number }), detail: lgdT('aAmt', { a: inr(old) }), href: href('customs'), cta: lgdT('aOpen') });
    const p = depositPosition(d.deposits.filter((x) => x.job_id === j.id), sumOf(mine));
    if (j.refs?.boe_no && p.state === 'short' && -p.gap > 0.5) out.push({ id: `lg:deposit:${j.id}`, severity: 'warning', title: lgdT('aShort', { j: j.number }), detail: inr(-p.gap), href: href('customs'), cta: lgdT('aOpen') });
  }
  const last = prevPeriod(periodOf(today)), done = billedManifests(d.invoices);
  const ms = d.manifests.filter((m) => m.period === last && m.dockets?.length && !done.has(m.id));
  if (Number(today.slice(8, 10)) > 5 && ms.length) out.push({ id: `lg:manifests:${last}`, severity: 'warning', title: lgdT('aMan', { n: ms.length, p: last }), detail: '', href: href('courier'), cta: lgdT('aOpen') });
  return out;
}

/** C's readers (`lg-recv-io.ts`), passed in by the bell gate. */
export interface LgReaders { loadDisb: (today: string) => LgDisbRow[]; loadDeposits: () => DepositBal[] }

/** The bell provider (registered by the bell's `logistics` gate): nothing unless a Round 19 pack is on. */
export function lgNotices(ctx: Pick<NotificationContext, 'now'>, io: LgReaders): AppNotification[] {
  const p = (localDb.settings.get() as { industry_packs?: unknown }).industry_packs;
  if (!Array.isArray(p) || !LG_PACKS.some((x) => p.includes(x))) return [];
  const at = ctx.now.toISOString(), today = localDayOf(ctx.now);
  return lgAlerts(today, { jobs: getTable<LgJob>(LG_TABLES.jobs), invoices: localDb.invoices.getAll(), disb: io.loadDisb(today), deposits: io.loadDeposits(), manifests: getTable<LgManifest>(LG_TABLES.manifests) }).map((a) => ({ ...a, at }));
}
