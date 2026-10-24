/**
 * The running timer (roadmap 6.13). Deliberately tiny: the layout header imports it for the
 * "timer running" pill, so it must not pull in the timesheet or invoice modules.
 *
 * One timer at a time lives in a single key. It survives reloads because only the moment it
 * (re)started is stored, never a ticking counter: elapsed = accumulated + (now − started_at).
 * All transitions are pure functions of the state and `now` (ms since epoch).
 */
import { DB_PREFIX, getJson, removeRaw, setJson } from './storage';
import { localDayOf } from './dates';

export const TIMER_KEY = `${DB_PREFIX}timer`;
/** Fired on `window` after this tab changes the timer (other tabs get the `storage` event). */
export const TIMER_EVENT = 'mrc-timer-change';

export interface TimerState {
  /** ms since epoch when the current run started; null while paused. */
  started_at: number | null;
  /** Time banked by earlier runs (before pauses), in ms. */
  accumulated_ms: number;
  /** Local day the timer was first started — the entry's date when stopped. */
  date: string;
  client_id?: string;
  client_name?: string;
  project?: string;
  description?: string;
  hourly_rate?: number;
  billable?: boolean;
}

export type TimerMeta = Omit<TimerState, 'started_at' | 'accumulated_ms' | 'date'>;

export function startTimer(meta: TimerMeta, now: number): TimerState {
  return { ...meta, started_at: now, accumulated_ms: 0, date: localDayOf(new Date(now)) };
}

/** Elapsed ms; a clock that went backwards never yields negative time. */
export function elapsedMs(t: TimerState | null, now: number): number {
  if (!t) return 0;
  const run = t.started_at === null ? 0 : Math.max(now - t.started_at, 0);
  return Math.max((Number(t.accumulated_ms) || 0) + run, 0);
}

export const isRunning = (t: TimerState | null): boolean => !!t && t.started_at !== null;

export function pauseTimer(t: TimerState, now: number): TimerState {
  if (t.started_at === null) return t;
  return { ...t, started_at: null, accumulated_ms: elapsedMs(t, now) };
}

export function resumeTimer(t: TimerState, now: number): TimerState {
  return t.started_at === null ? { ...t, started_at: now } : t;
}

/** Whole minutes on the clock (nearest minute) — what a stopped timer records. */
export function timerMinutes(t: TimerState | null, now: number): number {
  return Math.round(elapsedMs(t, now) / 60000);
}

/** `h:mm:ss` for the pill and the timer card. */
export function formatElapsed(ms: number): string {
  const s = Math.floor(Math.max(ms, 0) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// ── Storage ──────────────────────────────────────────────────────

export function readTimer(): TimerState | null {
  const t = getJson<TimerState | null>(TIMER_KEY, null);
  return t && typeof t === 'object' && typeof t.accumulated_ms === 'number' ? t : null;
}

export function writeTimer(t: TimerState | null): void {
  if (t) setJson(TIMER_KEY, t);
  else removeRaw(TIMER_KEY);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(TIMER_EVENT));
  }
}
