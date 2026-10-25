/**
 * Gateway working period and voucher date (Tally's Alt+F2 "Change period" and F2 "Change date").
 *
 * The app has no shared period context (the Books page keeps its own preset), so this is a small
 * module store: the Gateway's Display reports read the period, the voucher screen starts new
 * vouchers on the voucher date. Both are per-tab conveniences kept in sessionStorage (fail-soft),
 * never in the data store or a backup. The "Tally terms" label toggle is a per-device preference
 * in localStorage, like the theme.
 */
import { fyPeriod, fyStartYearOf, toIsoDate, type Period } from '../books';
import { isoDay } from '../dates';

export interface GatewaySession {
  period: Period;
  /** Local day (YYYY-MM-DD) new vouchers start on. */
  voucherDate: string;
}

const SESSION_KEY = 'mrchartist_gateway_session';
const TERMS_KEY = 'mrchartist_tally_terms';

let state: GatewaySession | null = null;
let terms: boolean | null = null;
const listeners = new Set<() => void>();

function defaults(today: string): GatewaySession {
  return { period: fyPeriod(fyStartYearOf(today)), voucherDate: today };
}

function store(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** A real calendar day written as YYYY-MM-DD (2026-02-31 is not). */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || isoDay(value) !== value) return false;
  const d = new Date(Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)));
  return d.getUTCMonth() === +value.slice(5, 7) - 1 && d.getUTCDate() === +value.slice(8, 10);
}

/** Problem with a period, or '' when it is usable. */
export function validatePeriod(p: Partial<Period> | null | undefined): '' | 'date' | 'order' {
  if (!isCalendarDay(p?.start) || !isCalendarDay(p?.end)) return 'date';
  return p.start > p.end ? 'order' : '';
}

function read(): GatewaySession {
  if (state) return state;
  const today = toIsoDate(new Date());
  let next = defaults(today);
  try {
    const raw = store()?.getItem(SESSION_KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<GatewaySession>;
      if (o.period && !validatePeriod(o.period)) next = { ...next, period: { start: o.period.start, end: o.period.end } };
      if (isCalendarDay(o.voucherDate)) next = { ...next, voucherDate: o.voucherDate };
    }
  } catch {
    /* fail-soft: defaults */
  }
  state = next;
  return state;
}

function write(next: GatewaySession): void {
  state = next;
  try {
    store()?.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    /* private mode: keep it in memory */
  }
  listeners.forEach((l) => l());
}

export function getGatewaySession(): GatewaySession {
  return read();
}

export function getGatewayPeriod(): Period {
  return read().period;
}

export function getVoucherDate(): string {
  return read().voucherDate;
}

/** Sets the working period; returns false (and changes nothing) when it is invalid. */
export function setGatewayPeriod(p: Period): boolean {
  if (validatePeriod(p)) return false;
  write({ ...read(), period: { start: p.start, end: p.end } });
  return true;
}

export function setVoucherDate(date: string): boolean {
  if (!isCalendarDay(date)) return false;
  write({ ...read(), voucherDate: date });
  return true;
}

export function subscribeGateway(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getTallyTerms(): boolean {
  if (terms !== null) return terms;
  try {
    terms = typeof localStorage !== 'undefined' && localStorage.getItem(TERMS_KEY) === '1';
  } catch {
    terms = false;
  }
  return terms;
}

export function setTallyTerms(on: boolean): void {
  terms = on;
  try {
    if (on) localStorage.setItem(TERMS_KEY, '1');
    else localStorage.removeItem(TERMS_KEY);
  } catch {
    /* in memory only */
  }
  listeners.forEach((l) => l());
}

export function resetGatewayForTests(): void {
  state = null;
  terms = null;
  try {
    store()?.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
