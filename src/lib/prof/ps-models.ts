/**
 * PS-A3 billing models, pure. The pre-bill hands the unbilled time of a matter / client here with the reviewer's row
 * edits (hours / rate to bill, exclude = billed at 0, defer = left for later) and the engagement; the plan says which
 * entries go on the draft at what minutes / rate, which are covered at 0 (fixed / milestone / success / monthly
 * retainer fees, the excess over a cap, excluded rows) and which fee lines to add:
 *  - `hourly` — today's flow (an optional target amount scales the rates);
 *  - `blended` — every hour at the engagement's one rate;
 *  - `capped` — time billed in date order until the cap left; the rest covered at 0 (reason "Cap");
 *  - `fixed` — the fee once (less what earlier fee notes billed); time covered;
 *  - `milestone` — the picked milestones (due, or their event ticked); time covered;
 *  - `retainer` — the R3-B3 retainer when linked (its cover already applies), else the monthly fee with time covered;
 *  - `success` — the success fee only once its event is marked done; time covered (PS9 for time of supply).
 * The entries keep their ids, so `bill_refs`, the annexure and derived billing are exactly `billUnbilled`'s.
 */
import type { Engagement } from '../../types/prof-r14';
import type { TimeEntry, TimePrefs } from '../../types/time';
import { entryAmount, toHours, billableMinutes } from '../timesheets';
import { num, round2 } from '../invoice-calc';
import { milestoneAmount } from './ps-engagements';

export interface RowEdit {
  /** Minutes to bill (else the entry's). */
  minutes?: number;
  /** Rate to bill (else the captured one). */
  rate?: number;
  exclude?: boolean;
  defer?: boolean;
}

export interface FeeLine { name: string; amount: number; milestone?: string }

export interface BillPlan {
  /** Entry copies to bill (ids kept): covered ones at rate 0. */
  time: TimeEntry[];
  covered: string[];
  fees: FeeLine[];
  basis: string;
  /** The model's own write-down reason ("Cap", "Fixed fee" …), when it causes one. */
  reason?: string;
}

export interface PlanOpts {
  prefs: TimePrefs;
  /** Billed so far on this engagement (time + fee lines of live fee notes). */
  used?: number;
  /** Fee lines billed so far on this engagement. */
  feesBefore?: number;
  /** Milestone ids billed so far. */
  milestonesBilled?: readonly string[];
  /** Milestones the reviewer picked for this bill. */
  milestoneIds?: readonly string[];
  /** Hourly: bill this total for the time instead of its value. */
  target?: number;
  money: (n: number) => string;
}

const byDate = (a: TimeEntry, b: TimeEntry) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
const covered = (e: TimeEntry): TimeEntry => ({ ...e, hourly_rate: 0 });
const hrs = (list: readonly TimeEntry[], prefs: TimePrefs) => toHours(list.reduce((s, e) => s + billableMinutes(e, prefs), 0));

export function planBill(entries: readonly TimeEntry[], edits: Readonly<Record<string, RowEdit>>, eng: Engagement | undefined, o: PlanOpts): BillPlan {
  const kept = entries.filter((e) => e.billable && !edits[e.id]?.defer).sort(byDate);
  const out: TimeEntry[] = [];
  const cov: string[] = [];
  const live: TimeEntry[] = [];
  for (const e of kept) {
    const ed = edits[e.id] ?? {};
    const copy = { ...e, ...(ed.minutes !== undefined ? { minutes: Math.max(Math.round(num(ed.minutes)), 0) } : {}), ...(ed.rate !== undefined ? { hourly_rate: Math.max(round2(num(ed.rate)), 0) } : {}) };
    if (ed.exclude) { out.push(covered(copy)); cov.push(e.id); } else live.push(copy);
  }
  const coverAll = () => { for (const e of live) { out.push(covered(e)); cov.push(e.id); } };
  const fees: FeeLine[] = [];
  const model = eng?.model ?? 'hourly';
  const h = hrs(kept, o.prefs);
  let basis: string;
  let reason: string | undefined;
  if (model === 'fixed') {
    coverAll();
    const left = round2(num(eng!.fee) - num(o.feesBefore));
    if (left > 0) fees.push({ name: `Professional fees: ${eng!.title} (fixed fee)`, amount: left });
    basis = `Fixed fee ${o.money(num(eng!.fee))}${h ? ` · time recorded ${h} h` : ''}`;
    reason = 'Fixed fee';
  } else if (model === 'milestone') {
    coverAll();
    const ms = eng!.milestones ?? [];
    const pick = ms.filter((m) => (o.milestoneIds ?? []).includes(m.id) && !(o.milestonesBilled ?? []).includes(m.id));
    for (const m of pick) fees.push({ name: `Professional fees: ${m.label} (stage ${ms.indexOf(m) + 1} of ${ms.length})`, amount: milestoneAmount(eng!, m), milestone: m.id });
    basis = pick.length ? `Fixed fee: ${pick.map((m) => `stage ${ms.indexOf(m) + 1} of ${ms.length}`).join(', ')}` : 'Milestone billing';
    reason = 'Fixed fee';
  } else if (model === 'success') {
    if (!eng!.success?.done_on) throw new Error('Mark the success event as done (date and reference) before billing the success fee.');
    coverAll();
    const s = eng!.success;
    const amount = round2(num(s.amount) > 0 ? num(s.amount) : (num(s.base_amount) * num(s.pct)) / 100);
    if (num(o.feesBefore) <= 0 && amount > 0) fees.push({ name: `Success fee: ${s.event}`, amount });
    basis = `Success fee on ${s.basis || s.event}${s.ref ? ` (${s.ref})` : ''}`;
    reason = 'Fixed fee';
  } else if (model === 'retainer' && !eng!.retainer_id) {
    coverAll();
    if (num(eng!.fee) > 0) fees.push({ name: `Professional fees: ${eng!.title} (monthly retainer)`, amount: round2(num(eng!.fee)) });
    basis = `Retainer ${o.money(num(eng!.fee))} a month${h ? ` · time recorded ${h} h` : ''}`;
    reason = 'Fixed fee';
  } else if (model === 'capped') {
    let left = Math.max(round2(num(eng!.cap) - num(o.used)), 0);
    for (const e of live) {
      const amt = entryAmount(e, o.prefs);
      if (amt <= left + 1e-9) { out.push(e); left = round2(left - amt); continue; }
      if (left > 0 && num(e.hourly_rate) > 0) {
        let m = Math.floor((left / num(e.hourly_rate)) * 60);
        while (m > 0 && entryAmount({ ...e, minutes: m }, o.prefs) > left + 1e-9) m--;
        if (m > 0) { const part = { ...e, minutes: m }; out.push(part); left = round2(left - entryAmount(part, o.prefs)); continue; }
      }
      out.push(covered(e)); cov.push(e.id);
    }
    const used = round2(num(eng!.cap) - left);
    basis = `Capped at ${o.money(num(eng!.cap))} (${o.money(used)} used)`;
    reason = 'Cap';
  } else {
    const rate = model === 'blended' ? round2(num(eng!.blended_rate)) : undefined;
    let list = rate !== undefined ? live.map((e) => ({ ...e, hourly_rate: rate })) : live;
    const value = round2(list.reduce((s, e) => s + entryAmount(e, o.prefs), 0));
    if (o.target !== undefined && value > 0 && round2(num(o.target)) !== value) {
      const f = Math.max(num(o.target), 0) / value;
      list = list.map((e) => ({ ...e, hourly_rate: round2(num(e.hourly_rate) * f) }));
    }
    out.push(...list);
    const rates = [...new Set(list.map((e) => num(e.hourly_rate)))];
    basis = `Time: ${hrs(list, o.prefs)} h${rates.length === 1 ? ` @ ${o.money(rates[0])}${model === 'blended' ? ' (blended rate)' : ''}` : ''}`;
  }
  return { time: out.sort(byDate), covered: cov, fees, basis, ...(reason ? { reason } : {}) };
}
