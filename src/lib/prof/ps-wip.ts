/**
 * PS-A4 WIP: unbilled time (standard value) and re-billable costs by matter / client / partner, aged in buckets (0–30,
 * 31–60, 61–90, 90+ days; editable), with the oldest entry, the engagement's model and the cap left. A WIP write-off
 * stamps the entries (`TimeEntry.ps.wo`) / costs (`PurchaseRecord.ps.wo`): they leave the Unbilled list and count as
 * written down in realisation; the owner may reverse it (audited). Both are refused in a locked period. No journal
 * (PS35) unless the year-end accrual was posted. Pure above "Storage".
 */
import type { PurchaseRecord } from '../../types/purchases';
import type { TimeEntry, TimePrefs } from '../../types/time';
import type { Engagement, PsWriteOff } from '../../types/prof-r14';
import type { CostCentre } from '../cost-centres';
import { getTable, setTable } from '../storage';
import { currentActor, requireAccess } from '../access';
import { audit } from '../audit';
import { assertUnlocked } from '../period-lock';
import { parseDay } from '../dates';
import { round2 } from '../invoice-calc';
import { PURCHASES_TABLE } from '../purchases';
import { TIME_TABLE, clientKey, rebillCost } from '../timesheets';
import { entryStandard } from './ps-staff';
import { engagementOf } from './ps-engagements';

export type WipGroup = 'matter' | 'client' | 'partner';

export interface WipRow {
  key: string;
  label: string;
  hours: number;
  time: number;
  costs: number;
  /** Amount per bucket (last = older than the last bound). */
  aged: number[];
  oldest: string;
  model?: Engagement['model'];
  capLeft?: number;
  ids: string[];
  costIds: string[];
}

const age = (day: string, today: string) => Math.round((parseDay(today).getTime() - parseDay(day).getTime()) / 86_400_000);

/** Pure: WIP rows from unbilled entries / costs (already filtered by the caller with `unbilledTime` / `unbilledExpenses`). */
export function wipRows(time: readonly TimeEntry[], costs: readonly PurchaseRecord[], o: { prefs: TimePrefs; today: string; buckets: readonly number[]; by: WipGroup; centres: readonly CostCentre[]; engagements?: readonly Engagement[]; capUsed?: (engId: string) => number }): WipRow[] {
  const centre = new Map(o.centres.map((c) => [c.id, c]));
  const map = new Map<string, WipRow>();
  const keyOf = (cc: string | undefined, client: string) => {
    const c = cc ? centre.get(cc) : undefined;
    if (o.by === 'matter') return c ? [c.id, c.ps?.code ? `${c.ps.code}: ${c.name}` : c.name] : [`client:${client}`, client];
    if (o.by === 'partner') return [c?.ps?.responsible_id ?? '', c?.ps?.responsible_id ?? ''];
    return [`client:${client}`, client];
  };
  const add = (cc: string | undefined, client: string, day: string, amt: number, mins: number, id: string, isCost: boolean) => {
    const [key, label] = keyOf(cc, client);
    const r = map.get(key) ?? { key, label, hours: 0, time: 0, costs: 0, aged: o.buckets.map(() => 0).concat(0), oldest: day, ids: [], costIds: [] };
    const a = age(day, o.today);
    const i = o.buckets.findIndex((b) => a <= b);
    r.aged[i < 0 ? o.buckets.length : i] = round2(r.aged[i < 0 ? o.buckets.length : i] + amt);
    if (isCost) { r.costs = round2(r.costs + amt); r.costIds.push(id); } else { r.time = round2(r.time + amt); r.hours = round2(r.hours + mins / 60); r.ids.push(id); }
    if (day < r.oldest) r.oldest = day;
    map.set(key, r);
  };
  for (const e of time) add(e.cost_centre_id, e.client_name || clientKey(e), e.date, entryStandard(e, o.prefs), e.minutes, e.id, false);
  for (const p of costs) add(p.cost_centre_id, p.vendor_name ?? '', p.date, rebillCost(p), 0, p.id, true);
  const rows = [...map.values()];
  if (o.by === 'matter') for (const r of rows) {
    const eng = engagementOf(r.key, o.engagements ?? []);
    if (!eng) continue;
    r.model = eng.model;
    if (eng.model === 'capped') r.capLeft = Math.max(round2((eng.cap ?? 0) - (o.capUsed?.(eng.id) ?? 0)), 0);
  }
  return rows.sort((a, b) => a.oldest.localeCompare(b.oldest));
}

// ── Storage ──────────────────────────────────────────────────────

const lock = (id: string, day: string) => assertUnlocked({ id, issue_date: day }, 'edit');

function stamp<T extends { id: string; date: string; ps?: { wo?: PsWriteOff } }>(table: string, ids: ReadonlySet<string>, wo: PsWriteOff | undefined): T[] {
  const rows = getTable<T>(table);
  const hit = rows.filter((r) => ids.has(r.id));
  for (const r of hit) lock(r.id, r.date);
  if (hit.length) setTable(table, rows.map((r) => {
    if (!ids.has(r.id)) return r;
    const { wo: _old, ...rest } = r.ps ?? {};
    const ps = wo ? { ...rest, wo } : rest;
    return { ...r, ps: Object.keys(ps).length ? ps : undefined };
  }));
  return hit;
}

/** Write off unbilled WIP (`books.edit`): entries and costs leave the Unbilled list (audited). */
export function writeOffWip(timeIds: readonly string[], costIds: readonly string[], reason: string, date: string): number {
  requireAccess('books.edit');
  if (!reason.trim()) throw new Error('Give the reason for the write-off.');
  const wo: PsWriteOff = { date, reason: reason.trim(), ...(currentActor()?.name ? { by: currentActor()!.name } : {}) };
  const n = stamp(TIME_TABLE, new Set(timeIds), wo).length + stamp(PURCHASES_TABLE, new Set(costIds), wo).length;
  audit.record({ entity: 'settings', entity_id: 'time_entries', action: 'update', summary: `WIP written off: ${n} row(s), ${wo.reason}` });
  return n;
}

/** The owner reverses a write-off (audited; refused in a locked period). */
export function reverseWriteOff(timeIds: readonly string[], costIds: readonly string[] = []): number {
  requireAccess('settings.manage');
  const n = stamp(TIME_TABLE, new Set(timeIds), undefined).length + stamp(PURCHASES_TABLE, new Set(costIds), undefined).length;
  audit.record({ entity: 'settings', entity_id: 'time_entries', action: 'update', summary: `WIP write-off reversed by the owner: ${n} row(s)` });
  return n;
}
