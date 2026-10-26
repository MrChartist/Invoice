/**
 * R5-C5 lease escalation and pro-rata — pure date / money maths, read by the recurring generator's amount hook
 * (`recurring.ts` → `leaseLineAmounts`) for schedules that carry `lease_id` + `escalation`. Each generated document
 * is a snapshot, so editing a lease's escalation later never changes a document already issued.
 * No storage, no imports from `recurring.ts` (it imports this file).
 */
import type { LeaseEscalation, ScheduleEscalation } from '../../types/institutions-r5';

const ymd = (d: string) => ({ y: +d.slice(0, 4), m: +d.slice(5, 7), d: +d.slice(8, 10) });
const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const r2 = (n: number) => Math.round(n * 100) / 100;

/** `date` + `months` calendar months, clamped to the month's last day. */
export function plusMonths(date: string, months: number): string {
  const p = ymd(date);
  const t = p.y * 12 + p.m - 1 + months;
  const y = Math.floor(t / 12);
  const m = (t % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(p.d, dim(y, m))).padStart(2, '0')}`;
}

const dayNo = (d: string) => {
  const p = ymd(d);
  return Date.UTC(p.y, p.m - 1, p.d) / 864e5;
};

/** First step date: `first_on`, else lease start + `every_months`. */
export function firstStep(esc: Pick<LeaseEscalation, 'every_months' | 'first_on'>, start: string): string {
  return esc.first_on || plusMonths(start, Math.max(1, Math.floor(esc.every_months) || 12));
}

/** Escalation steps in force on `on` (0 before the first step date). */
export function stepsOn(esc: Pick<LeaseEscalation, 'every_months' | 'first_on'>, start: string, on: string): number {
  const first = firstStep(esc, start);
  if (on < first) return 0;
  const every = Math.max(1, Math.floor(esc.every_months) || 12);
  let n = 1;
  while (plusMonths(first, n * every) <= on && n < 600) n++;
  return n;
}

/** The base amount after the escalation in force on `on` (pct compounds, rounded to the paisa at each step). */
export function escalatedAmount(base: number, esc: LeaseEscalation | undefined, start: string, on: string): number {
  if (!esc || !(esc.value > 0)) return r2(base);
  const steps = stepsOn(esc, start, on);
  let v = base;
  for (let i = 0; i < steps; i++) v = esc.kind === 'amount' ? v + esc.value : r2(v * (1 + esc.value / 100));
  return r2(v);
}

/** The next step date after `on` and the amount from then (null when no escalation). */
export function nextEscalation(base: number, esc: LeaseEscalation | undefined, start: string, on: string): { date: string; from: number; to: number } | null {
  if (!esc || !(esc.value > 0)) return null;
  const steps = stepsOn(esc, start, on);
  const every = Math.max(1, Math.floor(esc.every_months) || 12);
  const date = steps === 0 ? firstStep(esc, start) : plusMonths(firstStep(esc, start), steps * every);
  return { date, from: escalatedAmount(base, esc, start, on), to: escalatedAmount(base, esc, start, date) };
}

/**
 * Share of one billing period [`occurrence`, `next` − 1] the lease covers, with the stub before the first billing
 * day added to the first period: 1 = a full month. Without `prorata` always 1.
 */
export function prorataFactor(e: Pick<ScheduleEscalation, 'lease_start' | 'lease_end' | 'prorata'>, firstRun: string, occurrence: string, next: string): number {
  if (!e.prorata) return 1;
  const len = dayNo(next) - dayNo(occurrence);
  if (!(len > 0)) return 1;
  let f = 1;
  if (e.lease_end && e.lease_end < next) f = Math.max(0, dayNo(e.lease_end) - dayNo(occurrence) + 1) / len;
  if (occurrence === firstRun && e.lease_start < firstRun) {
    const prev = plusMonths(firstRun, -1);
    f += (dayNo(firstRun) - dayNo(e.lease_start)) / Math.max(1, dayNo(firstRun) - dayNo(prev));
  }
  return f;
}

/**
 * Line rates for one occurrence of a lease schedule: escalated lines from the step date, every lease line times
 * the pro-rata factor. Lines the lease does not name keep their template rate. Pure.
 */
export function leaseLineRates<L extends { id: string; rate: number; quantity?: number; amount?: number }>(lines: readonly L[], e: ScheduleEscalation, firstRun: string, occurrence: string, next: string): L[] {
  const esc = e.every_months && e.value ? (e as LeaseEscalation) : undefined;
  const f = prorataFactor(e, firstRun, occurrence, next);
  const up = new Set(e.lines);
  const pr = new Set(e.prorata_lines ?? e.lines);
  return lines.map((l) => {
    let rate = up.has(l.id) ? escalatedAmount(l.rate, esc, e.lease_start, occurrence) : l.rate;
    if (pr.has(l.id) && f !== 1) rate = r2(rate * f);
    return rate === l.rate ? l : { ...l, rate, amount: r2(rate * (l.quantity ?? 1)) };
  });
}
