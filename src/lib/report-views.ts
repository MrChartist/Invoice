/**
 * Saved report views and the month-end pack schedule (8G, 8.109).
 *
 * DECISION: both are DEVICE-LOCAL viewing preferences (localStorage, outside the `mrchartist_inv_`
 * prefix — like `mrchartist_report_prefs` / `mrchartist_report_period`), so they are never backed up,
 * synced or restored over another device's choices, and need no backup / TABLE_ACTIONS / sync-engine
 * registration. A view stores only a name, the screen + tab, the period preset (or custom dates), the
 * F12 options and column mode; the figures are always recomputed from the company's data.
 *
 *   mrchartist_report_views  — SavedView[]
 *   mrchartist_report_pack   — PackSchedule ({ day, lastMonth, autoFolder })
 */

import type { Period, PeriodPreset } from './books';
import type { ReportPrefs } from './report-prefs';

export const REPORT_VIEWS_KEY = 'mrchartist_report_views';
export const REPORT_PACK_KEY = 'mrchartist_report_pack';
export const MAX_VIEWS = 30;

export interface SavedView {
  id: string;
  name: string;
  /** Route, e.g. "/reports" or "/books". */
  route: string;
  /** Tab within the route (`?tab=`), '' for none. */
  tab: string;
  preset: PeriodPreset;
  /** Only for preset 'custom'. */
  period?: Period;
  /** F12 options (incl. columns) of every report, by report id, as they were when saved. */
  prefs?: Record<string, ReportPrefs>;
  created_at: string;
  /** R20-C (Ctrl+H "Open by default"): opened when the screen + tab is visited without a view. One per screen + tab. */
  default?: boolean;
}

const PRESETS: readonly PeriodPreset[] = ['this_month', 'last_month', 'this_quarter', 'this_fy', 'last_fy', 'mtd', 'qtd', 'ytd', 'custom'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function ls(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const s = ls()?.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, v: unknown): void {
  try {
    ls()?.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode: remembered for this session only */
  }
}

export function normalizeView(raw: unknown): SavedView | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 60) : '';
  const route = typeof o.route === 'string' && /^\/[a-z0-9/-]*$/.test(o.route) ? o.route : '';
  if (!name || !route) return null;
  const preset = PRESETS.includes(o.preset as PeriodPreset) ? (o.preset as PeriodPreset) : 'this_fy';
  const v: SavedView = { id: typeof o.id === 'string' && o.id ? o.id : `v${Date.now()}`, name, route, tab: typeof o.tab === 'string' ? o.tab.slice(0, 40) : '', preset, created_at: typeof o.created_at === 'string' ? o.created_at : '' };
  if (o.default === true) v.default = true;
  const p = o.period as Record<string, unknown> | undefined;
  if (preset === 'custom') {
    if (!p || typeof p.start !== 'string' || typeof p.end !== 'string' || !DAY.test(p.start) || !DAY.test(p.end) || p.start > p.end) v.preset = 'this_fy';
    else v.period = { start: p.start, end: p.end };
  }
  if (o.prefs && typeof o.prefs === 'object') {
    // Kept as stored; `setAllReportPrefs` validates each report's options when the view is applied.
    v.prefs = Object.fromEntries(Object.entries(o.prefs as Record<string, unknown>).slice(0, 60).filter(([, p]) => p && typeof p === 'object').map(([k, p]) => [k.slice(0, 40), p as ReportPrefs]));
  }
  return v;
}

export function loadViews(): SavedView[] {
  const raw = readJson(REPORT_VIEWS_KEY);
  return (Array.isArray(raw) ? raw : []).map(normalizeView).filter((v): v is SavedView => !!v).slice(0, MAX_VIEWS);
}

/** Add or replace (same name, case-insensitive, on the same route) a view. */
export function saveView(view: Omit<SavedView, 'id' | 'created_at'> & { id?: string }, now: Date = new Date()): SavedView[] {
  const clean = normalizeView({ ...view, id: view.id || `v${now.getTime().toString(36)}`, created_at: now.toISOString() });
  if (!clean) throw new Error('Give the view a name.');
  const rest = loadViews().filter((v) => v.id !== clean.id && !(v.route === clean.route && v.name.toLowerCase() === clean.name.toLowerCase()));
  const next = [clean, ...rest].slice(0, MAX_VIEWS);
  writeJson(REPORT_VIEWS_KEY, next);
  return next;
}

export function deleteView(id: string): SavedView[] {
  const next = loadViews().filter((v) => v.id !== id);
  writeJson(REPORT_VIEWS_KEY, next);
  return next;
}

/** R20-C: make a view the default of its screen + tab (the others of that screen + tab lose the flag); again = off. */
export function setDefaultView(id: string): SavedView[] {
  const all = loadViews();
  const v = all.find((x) => x.id === id);
  const on = !!v && !v.default;
  const next = all.map((x) => (x.id === id ? { ...x, default: on || undefined } : v && on && x.route === v.route && x.tab === v.tab ? { ...x, default: undefined } : x));
  writeJson(REPORT_VIEWS_KEY, next);
  return next;
}

/** The view opened by default on this screen + tab, if any. */
export const defaultView = (route: string, tab: string): SavedView | undefined => loadViews().find((v) => v.default && v.route === route && v.tab === tab);

/** Link that opens a view (`?view=<id>` is read by the screen's views bar). */
export function viewHref(v: SavedView): string {
  const q = new URLSearchParams();
  if (v.tab) q.set('tab', v.tab);
  q.set('view', v.id);
  return `${v.route}?${q.toString()}`;
}

/* ── Month-end pack schedule ─────────────────────────────────── */

export interface PackSchedule {
  /** Day of the month (1–28) from which last month's pack is offered; 0 = off. */
  day: number;
  /** "YYYY-MM" of the last pack produced (offered / written). */
  lastMonth: string;
  /** Write it to the connected backup folder automatically. */
  autoFolder: boolean;
}

export const DEFAULT_PACK: PackSchedule = { day: 0, lastMonth: '', autoFolder: false };

export function loadPackSchedule(): PackSchedule {
  const o = (readJson(REPORT_PACK_KEY) ?? {}) as Record<string, unknown>;
  const day = Math.min(Math.max(Math.floor(Number(o.day) || 0), 0), 28);
  return { day, lastMonth: typeof o.lastMonth === 'string' && /^\d{4}-\d{2}$/.test(o.lastMonth) ? o.lastMonth : '', autoFolder: o.autoFolder === true };
}

export function savePackSchedule(s: PackSchedule): void {
  writeJson(REPORT_PACK_KEY, { day: Math.min(Math.max(Math.floor(s.day) || 0, 0), 28), lastMonth: s.lastMonth, autoFolder: !!s.autoFolder });
}

/** "YYYY-MM" of the month before `today` (local day). */
export function previousMonth(today: string): string {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * The month whose pack is due on the first open on / after the schedule day, or null. Offline: nothing
 * runs in the background — the bell offers it (and writes it to the folder) when the app is opened.
 */
export function packDue(s: PackSchedule, today: string): string | null {
  if (!s.day) return null;
  const day = Number(today.slice(8, 10));
  if (day < s.day) return null;
  const month = previousMonth(today);
  return s.lastMonth >= month ? null : month;
}

/** First and last local day of "YYYY-MM". */
export function monthPeriod(month: string): Period {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}
