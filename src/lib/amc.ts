/**
 * AMC / service contracts (WP-9, P2): annual maintenance contracts with a visit schedule and
 * renewal reminders, table `amc_contracts` (`master.edit`).
 *
 *  - Schedule: `visits_per_year` visits spread evenly from the start date (12 / n months apart)
 *    up to the end date. Logged visits use up the schedule in order; the next scheduled date
 *    without a visit is "due".
 *  - Reminders (`amcReminders`): visits due within `VISIT_NOTICE_DAYS` or overdue, contracts ending
 *    within their `renew_notice_days` (default 30) and contracts expired in the last 60 days that
 *    were not renewed. Integration point for the notification bell: map each reminder to a notice.
 *  - Renewal: `renewContract` copies the contract for the same length starting the day after it
 *    ends (`renewed_from` links them). Billing stays a normal invoice (link it with `invoice_id`).
 */
import { requireAccess } from './access';
import { generateId, getTable, setTable } from './storage';
import { num, round2 } from './invoice-calc';

export const AMC_TABLE = 'amc_contracts';
export const VISIT_NOTICE_DAYS = 7;

export interface AmcVisit {
  date: string;
  note?: string;
  by?: string;
}

export interface AmcContract {
  id: string;
  client_name: string;
  client_id?: string;
  title: string;
  /** YYYY-MM-DD (inclusive). */
  start: string;
  end: string;
  value: number;
  visits_per_year: number;
  visits: AmcVisit[];
  renew_notice_days?: number;
  cancelled?: boolean;
  invoice_id?: string;
  renewed_from?: string;
  notes?: string;
  created_at?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const parse = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, (m || 1) - 1, day || 1, 12);
};
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function addDaysIso(day: string, n: number): string {
  const d = parse(day);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

/** Add months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsIso(day: string, months: number): string {
  const d = parse(day);
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return fmt(target);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

/** Scheduled visit dates inside the contract period. */
export function visitSchedule(c: Pick<AmcContract, 'start' | 'end' | 'visits_per_year'>): string[] {
  const n = Math.max(Math.trunc(num(c.visits_per_year)), 0);
  if (!n || !c.start || !c.end || c.end < c.start) return [];
  const gap = 12 / n;
  const out: string[] = [];
  for (let i = 0; i < 400; i++) {
    const months = gap * i;
    const whole = Math.floor(months);
    let day = addMonthsIso(c.start, whole);
    const frac = months - whole;
    if (frac > 0) day = addDaysIso(day, Math.round(frac * 30));
    if (day > c.end) break;
    out.push(day);
  }
  return out;
}

export interface AmcStatus {
  schedule: string[];
  done: number;
  nextVisit: string | null;
  overdue: boolean;
  state: 'active' | 'expiring' | 'expired' | 'cancelled' | 'upcoming';
  daysToEnd: number;
}

export function contractStatus(c: AmcContract, today: string): AmcStatus {
  const schedule = visitSchedule(c);
  const done = Math.min(c.visits?.length ?? 0, schedule.length);
  const nextVisit = schedule[done] ?? null;
  const daysToEnd = daysBetween(today, c.end);
  const notice = c.renew_notice_days ?? 30;
  const state: AmcStatus['state'] = c.cancelled
    ? 'cancelled'
    : today < c.start
      ? 'upcoming'
      : daysToEnd < 0
        ? 'expired'
        : daysToEnd <= notice
          ? 'expiring'
          : 'active';
  return { schedule, done, nextVisit, overdue: !!nextVisit && nextVisit < today && state !== 'expired' && state !== 'cancelled', state, daysToEnd };
}

export interface AmcReminder {
  id: string;
  contract_id: string;
  kind: 'visit' | 'renewal';
  date: string;
  text: string;
  overdue: boolean;
}

/** Visit and renewal reminders for `today`, soonest first. */
export function amcReminders(contracts: readonly AmcContract[], today: string): AmcReminder[] {
  const renewed = new Set(contracts.map((c) => c.renewed_from).filter(Boolean));
  const out: AmcReminder[] = [];
  for (const c of contracts) {
    const s = contractStatus(c, today);
    if (s.state === 'cancelled') continue;
    if (s.nextVisit && s.state !== 'expired' && s.state !== 'upcoming' && daysBetween(today, s.nextVisit) <= VISIT_NOTICE_DAYS) {
      out.push({
        id: `amc-visit:${c.id}:${s.nextVisit}`,
        contract_id: c.id,
        kind: 'visit',
        date: s.nextVisit,
        overdue: s.nextVisit < today,
        text: `${s.nextVisit < today ? 'Overdue' : 'Due'} service visit ${s.done + 1} of ${s.schedule.length} for ${c.client_name} (${c.title})`,
      });
    }
    if (renewed.has(c.id)) continue;
    if (s.state === 'expiring' || (s.state === 'expired' && s.daysToEnd >= -60)) {
      out.push({
        id: `amc-renew:${c.id}`,
        contract_id: c.id,
        kind: 'renewal',
        date: c.end,
        overdue: s.state === 'expired',
        text: s.state === 'expired' ? `${c.title} for ${c.client_name} expired on ${c.end} — renew it` : `${c.title} for ${c.client_name} ends on ${c.end} — renewal due`,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function validateContract(c: Partial<AmcContract>): string[] {
  const errors: string[] = [];
  if (!c.client_name?.trim()) errors.push('Choose the customer.');
  if (!c.title?.trim()) errors.push('Name the contract (e.g. "AC maintenance").');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.start ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(c.end ?? '')) errors.push('Enter the start and end dates.');
  else if ((c.end as string) < (c.start as string)) errors.push('The end date is before the start date.');
  if (num(c.value) < 0) errors.push('The contract value cannot be negative.');
  if (num(c.visits_per_year) < 0 || num(c.visits_per_year) > 52) errors.push('Visits per year: 0 to 52.');
  return errors;
}

export const amcDb = {
  all: (): AmcContract[] => getTable<AmcContract>(AMC_TABLE),
  save(input: Partial<AmcContract> & { client_name: string; title: string; start: string; end: string }): AmcContract {
    requireAccess('master.edit');
    const errors = validateContract(input);
    if (errors.length) throw new Error(errors[0]);
    const all = amcDb.all();
    const prev = input.id ? all.find((c) => c.id === input.id) : undefined;
    const row: AmcContract = {
      ...prev,
      ...input,
      id: prev?.id ?? generateId(),
      client_name: input.client_name.trim(),
      title: input.title.trim(),
      value: round2(num(input.value)),
      visits_per_year: Math.trunc(num(input.visits_per_year)),
      visits: input.visits ?? prev?.visits ?? [],
      created_at: prev?.created_at ?? new Date().toISOString(),
    };
    setTable(AMC_TABLE, prev ? all.map((c) => (c.id === row.id ? row : c)) : [...all, row]);
    return row;
  },
  recordVisit(id: string, visit: AmcVisit): AmcContract {
    const c = amcDb.all().find((x) => x.id === id);
    if (!c) throw new Error('Contract not found.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(visit.date)) throw new Error('Enter the visit date.');
    return amcDb.save({ ...c, visits: [...(c.visits ?? []), { date: visit.date, ...(visit.note?.trim() ? { note: visit.note.trim() } : {}), ...(visit.by ? { by: visit.by } : {}), ...(visit.job_id ? { job_id: visit.job_id } : {}) }].sort((a, b) => a.date.localeCompare(b.date)) });
  },
  cancel(id: string): void {
    const c = amcDb.all().find((x) => x.id === id);
    if (c) amcDb.save({ ...c, cancelled: true });
  },
  remove(id: string): void {
    requireAccess('master.edit');
    setTable(AMC_TABLE, amcDb.all().filter((c) => c.id !== id));
  },
};

/** SV-D4: the AMC visit a delivered job card records (job number as the note). */
export const visitFromJob = (job: { id: string; number: string }, date: string): AmcVisit => ({ date, note: `Job ${job.number}`, job_id: job.id });

/** The next term of a contract: same length, starting the day after it ends. */
export function renewalDraft(c: AmcContract): Omit<AmcContract, 'id'> {
  const length = daysBetween(c.start, c.end);
  const start = addDaysIso(c.end, 1);
  const { id: _id, invoice_id: _inv, cancelled: _x, created_at: _c, ...rest } = c;
  void _id; void _inv; void _x; void _c;
  return { ...rest, start, end: addDaysIso(start, length), visits: [], renewed_from: c.id };
}

export function renewContract(id: string, value?: number): AmcContract {
  const c = amcDb.all().find((x) => x.id === id);
  if (!c) throw new Error('Contract not found.');
  if (amcDb.all().some((x) => x.renewed_from === id)) throw new Error('This contract was already renewed.');
  const draft = renewalDraft(c);
  return amcDb.save({ ...draft, ...(value !== undefined ? { value } : {}) });
}
