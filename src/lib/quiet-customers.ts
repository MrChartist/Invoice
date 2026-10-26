/**
 * Customers gone quiet (R3-B7). A regular customer — at least 3 issued sales invoices in the last 12
 * months — is "quiet" when the days since their last invoice exceed max(threshold, 1.5 × their median
 * gap between invoices). The threshold defaults to 30 days. Walk-in counter bills, parties marked
 * "never remind" (R2-A5 `reminder_mode: 'never'`), snoozed parties (until a local day) and parties marked "Not a
 * regular" are left out.
 *
 * Shown as a dashboard insight card (`insights.ts`), a Clients chip and the "Customers gone quiet"
 * report, with a pre-filled WhatsApp nudge in the party's message language (`message-langs.ts`),
 * logged in `reminders` with the additive `kind: 'nudge'`.
 *
 * Pure above the "Storage" divider (tests/quiet-customers.test.ts).
 */
import type { Client, InvoiceRecord } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { receivableTotal } from './rcm';
import { DB_PREFIX, generateId, getJson, getTable, setJson, setTable } from './storage';
import { requireAccess } from './access';
import { usualItems } from './party-habits';

export const QUIET_SETTINGS_KEY = `${DB_PREFIX}quiet_settings`;
export const DEFAULT_QUIET_DAYS = 30;
const WALK_IN = 'walk-in customer';

export interface QuietSettings {
  threshold_days: number;
  /** Party key → local day (YYYY-MM-DD) the snooze ends (shown again from that day). */
  snoozed: Record<string, string>;
  /** Party keys marked "Not a regular". */
  excluded: string[];
}

export interface QuietRow {
  key: string;
  name: string;
  client?: Client;
  last_date: string;
  last_number: string;
  /** Median days between invoices in the last 12 months. */
  median_gap: number;
  days_quiet: number;
  /** max(threshold, 1.5 × median gap) — quiet beyond this. */
  limit: number;
  sales_12m: number;
  count_12m: number;
  top_items: string[];
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

const dayNo = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd) / 86400000;
};

function shiftYears(day: string, years: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y + years, m - 1, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Party key of an invoice: its client id, else the master with the same name (so old invoices typed by
 * name join the client's newer ones), else `name:<lower-cased name>`.
 */
export function partyKeyOf(c: Pick<Client, 'id' | 'name'> | undefined, masters: ReadonlyMap<string, Client>): string {
  if (!c) return '';
  if (c.id) return c.id;
  const byName = masters.get(norm(c.name));
  return byName?.id ? byName.id : norm(c.name) ? `name:${norm(c.name)}` : '';
}

const SALES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);

/** R2-A5: a party whose reminder mode is "never" is never nudged either. */
const neverRemind = (c: Client | undefined) => c?.reminder_mode === 'never';

export function snoozedUntil(settings: QuietSettings, key: string, today: string): string | null {
  const until = settings.snoozed[key];
  return until && until > today ? until : null;
}

export function quietCustomers(invoices: readonly InvoiceRecord[], clients: readonly Client[], settings: QuietSettings, today: string): QuietRow[] {
  const masters = new Map<string, Client>();
  const byId = new Map<string, Client>();
  for (const c of clients) {
    if (c.id) byId.set(c.id, c);
    if (norm(c.name) && !masters.has(norm(c.name))) masters.set(norm(c.name), c);
  }
  const from = shiftYears(today, -1);
  const groups = new Map<string, InvoiceRecord[]>();
  for (const i of invoices) {
    if (!SALES.has(i.doc_type ?? 'INVOICE') || i.status === 'Draft' || i.status === 'Cancelled') continue;
    if (!i.issue_date || i.issue_date > today || i.issue_date < from) continue;
    if (norm(i.client?.name) === WALK_IN || !norm(i.client?.name)) continue;
    const key = partyKeyOf(i.client, masters);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const threshold = Math.max(Math.round(num(settings.threshold_days)) || DEFAULT_QUIET_DAYS, 1);
  const out: QuietRow[] = [];
  for (const [key, docs] of groups) {
    if (docs.length < 3 || settings.excluded.includes(key) || snoozedUntil(settings, key, today)) continue;
    const client = byId.get(key) ?? (key.startsWith('name:') ? masters.get(key.slice(5)) : undefined);
    if (neverRemind(client)) continue;
    const days = [...new Set(docs.map((d) => d.issue_date))].sort();
    const gaps = days.slice(1).map((d, n) => dayNo(d) - dayNo(days[n]));
    const gap = round2(median(gaps));
    const last = days[days.length - 1];
    const quiet = dayNo(today) - dayNo(last);
    const limit = Math.max(threshold, round2(1.5 * gap));
    if (quiet <= limit) continue;
    const lastDoc = docs.filter((d) => d.issue_date === last).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
    const party = { id: client?.id ?? docs[0].client?.id, name: client?.name ?? docs[0].client?.name ?? '' };
    out.push({
      key,
      name: party.name,
      ...(client ? { client } : {}),
      last_date: last,
      last_number: lastDoc?.invoice_number ?? '',
      median_gap: gap,
      days_quiet: quiet,
      limit,
      sales_12m: round2(docs.reduce((s, d) => s + receivableTotal(d), 0)),
      count_12m: docs.length,
      top_items: usualItems(docs, party, today, { days: 366, limit: 3 }).map((u) => u.name),
    });
  }
  return out.sort((a, b) => b.sales_12m - a.sales_12m || b.days_quiet - a.days_quiet || a.name.localeCompare(b.name));
}

export function normalizeQuietSettings(raw: unknown): QuietSettings {
  const o = raw && typeof raw === 'object' ? (raw as Partial<QuietSettings>) : {};
  const snoozed: Record<string, string> = {};
  if (o.snoozed && typeof o.snoozed === 'object') {
    for (const [k, v] of Object.entries(o.snoozed)) if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) snoozed[k] = v;
  }
  return {
    threshold_days: Math.max(Math.round(num(o.threshold_days)) || DEFAULT_QUIET_DAYS, 1),
    snoozed,
    excluded: Array.isArray(o.excluded) ? [...new Set(o.excluded.filter((k): k is string => typeof k === 'string' && !!k))] : [],
  };
}

/** Snooze until `today + days` (local day). */
export function snooze(settings: QuietSettings, key: string, days: number, today: string): QuietSettings {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(y, m - 1, d + Math.max(Math.round(days), 1));
  const until = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  return { ...settings, snoozed: { ...settings.snoozed, [key]: until } };
}

export const exclude = (settings: QuietSettings, key: string): QuietSettings =>
  settings.excluded.includes(key) ? settings : { ...settings, excluded: [...settings.excluded, key] };

export const include = (settings: QuietSettings, key: string): QuietSettings => ({ ...settings, excluded: settings.excluded.filter((k) => k !== key) });

/** Report rows for CSV (header first). */
export function quietRowsToCsv(rows: readonly QuietRow[]): (string | number)[][] {
  return [
    ['Party', 'Last bill', 'Last bill no.', 'Usual gap (days)', 'Days quiet', 'Sales last 12 months', 'Bills last 12 months', 'Top items'],
    ...rows.map((r) => [r.name, r.last_date, r.last_number, r.median_gap, r.days_quiet, r.sales_12m, r.count_12m, r.top_items.join('; ')]),
  ];
}

/** A `reminders` row for a sent nudge (additive `kind`; no `party_key`, so payment-reminder history is unaffected). */
export interface NudgeLogRow {
  id: string;
  invoice_id: '';
  channel: 'whatsapp';
  tone: 'upcoming';
  sent_at: string;
  kind: 'nudge';
  nudge_party_key: string;
  note?: string;
}

export const makeNudgeLog = (key: string, at: string, id: string = generateId()): NudgeLogRow =>
  ({ id, invoice_id: '', channel: 'whatsapp', tone: 'upcoming', sent_at: at, kind: 'nudge', nudge_party_key: key });

/** Last nudge per party key. */
export function lastNudges(log: readonly unknown[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of log) {
    const o = r as Partial<NudgeLogRow> | null;
    if (o?.kind !== 'nudge' || !o.nudge_party_key || !o.sent_at) continue;
    if ((out.get(o.nudge_party_key) ?? '') < o.sent_at) out.set(o.nudge_party_key, o.sent_at);
  }
  return out;
}

// ── Storage ──────────────────────────────────────────────────────

export const loadQuietSettings = (): QuietSettings => normalizeQuietSettings(getJson<unknown>(QUIET_SETTINGS_KEY, null));

export function saveQuietSettings(s: QuietSettings): void {
  requireAccess('master.edit');
  setJson(QUIET_SETTINGS_KEY, normalizeQuietSettings(s));
}

export function logNudge(key: string): void {
  setTable('reminders', [...getTable<unknown>('reminders'), makeNudgeLog(key, new Date().toISOString())]);
}
