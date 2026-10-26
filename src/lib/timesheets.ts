/**
 * Time tracking, billable expenses and mileage (roadmap 6.13 / 6.14).
 *
 * Tables: `time_entries` (TimeEntry), `mileage` (MileageEntry); preferences at
 * `mrchartist_inv_time_prefs`. Re-billable costs are ordinary `purchases` rows carrying
 * `billable_to_client_id` / `markup_percent` / `pure_agent` / `rebilled_in`.
 *
 * Billing state is DERIVED from the invoice LINES: each generated line lists the rows it bills in
 * `bill_refs`, and a row is billed while some existing, non-cancelled invoice has a line naming it.
 * So deleting (or cancelling) that invoice, or deleting the line from the draft, frees the time,
 * trips and costs for the next bill; a duplicate keeps the lines (and their refs), so deleting the
 * original never frees rows the copy still bills. `invoiced_in` / `rebilled_in` are kept as a
 * pointer for display and for invoices made before line refs existed (legacy: billed while that
 * invoice is live).
 *
 * Everything above the "Storage" divider is pure and unit-tested.
 */
import type { InvoiceItem, InvoiceRecord, SenderProfile, Client } from '../types/invoice';
import type { PurchaseRecord } from '../types/purchases';
import { DEFAULT_TIME_PREFS, type MileageEntry, type MinuteRounding, type TimeEntry, type TimePrefs } from '../types/time';
import { calcInputFromRecord, calculateInvoice, deriveGstMode, num, round2 } from './invoice-calc';
import { parseDay, shiftDay, localDayOf } from './dates';
import { DB_PREFIX, generateId, getJson, getTable, setJson, setTable } from './storage';
import { resolveStateCode } from './india-states';
import { localDb } from './localDb';
import { requireAccess } from './access';
import { purchasesDb } from './purchases';
import { blankClient, makeDraft, senderStateCode } from '../store/invoice-defaults';
import { hoistCostCentre, loadCostCentres, matchCostCentre, type CostCentre } from './cost-centres';
// R3-B: work-type SAC (rate cards), retainer coverage, project filter, timesheet annexure.
import type { InvoiceAnnexure } from '../types/service-r3';
import { loadWorkTypes, sacFor, type WorkType } from './rate-cards';
import { loadRetainers, retainerCover, type RetainerCover } from './retainers';
import { buildAnnexure, type AnnexureContext } from './annexure';
import { loadTasks } from './projects';

export const TIME_TABLE = 'time_entries';
export const MILEAGE_TABLE = 'mileage';
export const TIME_PREFS_KEY = `${DB_PREFIX}time_prefs`;

// ── Pure: rounding & amounts ─────────────────────────────────────

/** Round minutes to the billing step: 'nearest' (7 → 6 with a 6-min step) or 'up' (7 → 12). */
export function roundMinutes(minutes: number, increment: number, mode: MinuteRounding): number {
  const m = Math.max(num(minutes), 0);
  const step = Math.max(num(increment), 0);
  if (!step || mode === 'none') return m;
  const units = m / step;
  // The epsilon keeps float noise (2.0000000001 steps) from rounding up a whole step.
  return (mode === 'up' ? Math.ceil(units - 1e-9) : Math.round(units)) * step;
}

export const billableMinutes = (e: Pick<TimeEntry, 'minutes'>, prefs: TimePrefs): number =>
  roundMinutes(e.minutes, prefs.round_increment, prefs.round_mode);

/** Hours to 2 dp, as printed on the invoice. */
export const toHours = (minutes: number): number => round2(num(minutes) / 60);

/** What an entry is worth on a bill (0 when not billable). */
export function entryAmount(e: TimeEntry, prefs: TimePrefs): number {
  if (!e.billable) return 0;
  return round2(toHours(billableMinutes(e, prefs)) * num(e.hourly_rate));
}

/** `1h 05m` */
export function formatMinutes(minutes: number): string {
  const m = Math.round(Math.max(num(minutes), 0));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Parse "1:30", "1.5", "90m", "2h" or "1h 15m" into minutes (NaN when unreadable). */
export function parseDuration(text: string): number {
  const s = (text ?? '').trim().toLowerCase();
  if (!s) return NaN;
  let m = /^(\d+):(\d{1,2})$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(s);
  if (m && (m[1] || m[2])) return Math.round(Number(m[1] ?? 0) * 60) + Number(m[2] ?? 0);
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : NaN;
}

// ── Pure: billed state ───────────────────────────────────────────

/**
 * Ids of invoices that still hold billed work (existing and not cancelled), plus which rows their
 * lines bill (`bill_refs`). A plain `Set` of ids is still accepted everywhere (legacy rule only).
 */
export class LiveBilling extends Set<string> {
  /** Row id (time entry / trip / re-billed purchase) -> live invoices whose lines bill it. */
  readonly byRow = new Map<string, string[]>();
  /** Live invoices that carry line refs: a row they do not name is no longer billed by them. */
  readonly withRefs = new Set<string>();
}

type BillingDoc = Pick<InvoiceRecord, 'id' | 'status'> & { items?: readonly Pick<InvoiceItem, 'bill_refs'>[] };

export function liveInvoiceIds(invoices: readonly BillingDoc[], excludeId?: string): LiveBilling {
  const out = new LiveBilling();
  for (const inv of invoices) {
    if (!inv.id || inv.status === 'Cancelled' || inv.id === excludeId) continue;
    out.add(inv.id);
    for (const it of inv.items ?? []) {
      for (const ref of it.bill_refs ?? []) {
        out.withRefs.add(inv.id);
        const list = out.byRow.get(ref);
        if (!list) out.byRow.set(ref, [inv.id]);
        else if (!list.includes(inv.id)) list.push(inv.id);
      }
    }
  }
  return out;
}

/** The live invoice billing a row (`rowId` + its `invoiced_in` / `rebilled_in` pointer), if any. */
export function billedBy(ref: string | undefined, live: Set<string>, rowId?: string): string | undefined {
  if (live instanceof LiveBilling && rowId) {
    const by = live.byRow.get(rowId);
    if (by?.length) return by.includes(ref ?? '') ? ref : by[0];
    if (ref && live.withRefs.has(ref)) return undefined; // the line was removed from that invoice
  }
  return ref && live.has(ref) ? ref : undefined;
}

export const isBilled = (ref: string | undefined, live: Set<string>, rowId?: string): boolean => !!billedBy(ref, live, rowId);

/** Stable key for "the same client": the CRM id, else the lower-cased name. */
export function clientKey(row: { client_id?: string; client_name?: string }): string {
  return row.client_id ? row.client_id : `name:${(row.client_name ?? '').trim().toLowerCase()}`;
}

/**
 * Billable entries no live invoice bills. With a retainer `cover` (R3-B3), minutes a retainer covers
 * are treated as billed: a fully covered entry is left out, a partly covered one comes back as a copy
 * holding only its overage minutes, and overage entries take the retainer's overage rate.
 */
export function unbilledTime(entries: TimeEntry[], live: Set<string>, cover?: RetainerCover, prefs?: TimePrefs): TimeEntry[] {
  const out: TimeEntry[] = [];
  for (const e of entries) {
    if (!e.billable || isBilled(e.invoiced_in, live, e.id)) continue;
    const covered = cover?.covered.get(e.id) ?? 0;
    const rate = cover?.overageRate.get(e.id);
    if (!covered && rate === undefined) {
      out.push(e);
      continue;
    }
    const total = prefs ? billableMinutes(e, prefs) : Math.max(num(e.minutes), 0);
    if (covered >= total) continue;
    out.push({ ...e, ...(covered ? { minutes: total - covered } : {}), ...(rate !== undefined ? { hourly_rate: rate } : {}) });
  }
  return out;
}

export const unbilledMileage = (trips: MileageEntry[], live: Set<string>): MileageEntry[] =>
  trips.filter((t) => !isBilled(t.invoiced_in, live, t.id));

export const unbilledExpenses = (purchases: PurchaseRecord[], live: Set<string>): PurchaseRecord[] =>
  purchases.filter((p) => !!p.billable_to_client_id && !isBilled(p.rebilled_in, live, p.id));

/**
 * Rows an invoice bills that another live invoice bills too (reinstating it would bill them twice).
 * `doc` is the invoice being restored; `live` must leave it out (`liveInvoiceIds(all, doc.id)`).
 */
export function doubleBilledRows(
  doc: Pick<InvoiceRecord, 'id'> & { items?: readonly Pick<InvoiceItem, 'bill_refs'>[] },
  rows: { time: readonly TimeEntry[]; mileage: readonly MileageEntry[]; expenses: readonly PurchaseRecord[] },
  live: Set<string>,
): { kind: 'time' | 'mileage' | 'expense'; id: string; by: string }[] {
  const refs = new Set((doc.items ?? []).flatMap((i) => i.bill_refs ?? []));
  const hasRefs = refs.size > 0;
  const out: { kind: 'time' | 'mileage' | 'expense'; id: string; by: string }[] = [];
  const check = (kind: 'time' | 'mileage' | 'expense', id: string, ref: string | undefined) => {
    // Billed by this invoice: named on one of its lines, or (older invoices) pointing at it.
    if (!(refs.has(id) || (!hasRefs && ref === doc.id))) return;
    const by = billedBy(ref, live, id);
    if (by && by !== doc.id) out.push({ kind, id, by });
  };
  for (const e of rows.time) check('time', e.id, e.invoiced_in);
  for (const t of rows.mileage) check('mileage', t.id, t.invoiced_in);
  for (const p of rows.expenses) check('expense', p.id, p.rebilled_in);
  return out;
}

// ── Pure: weeks & totals ─────────────────────────────────────────

/** Monday of the week containing `day` (yyyy-mm-dd, local). */
export function weekStart(day: string): string {
  const d = parseDay(day);
  const offset = (d.getDay() + 6) % 7; // Mon = 0 … Sun = 6
  return shiftDay(localDayOf(d), -offset);
}

export const weekDays = (start: string): string[] => Array.from({ length: 7 }, (_, i) => shiftDay(start, i));

export interface WeekRow {
  key: string;
  client_name: string;
  project: string;
  /** Raw minutes Mon … Sun. */
  minutes: number[];
  total: number;
}

export interface WeekGrid {
  days: string[];
  rows: WeekRow[];
  dayTotals: number[];
  total: number;
  billableTotal: number;
}

/** Timesheet grid: one row per client × project, raw minutes per weekday. */
export function weekGrid(entries: TimeEntry[], start: string): WeekGrid {
  const days = weekDays(start);
  const index = new Map(days.map((d, i) => [d, i]));
  const rows = new Map<string, WeekRow>();
  const dayTotals = Array<number>(7).fill(0);
  let total = 0;
  let billableTotal = 0;
  for (const e of entries) {
    const i = index.get(e.date);
    if (i === undefined) continue;
    const project = (e.project ?? '').trim();
    const key = `${clientKey(e)}|${project.toLowerCase()}`;
    const row = rows.get(key) ?? { key, client_name: e.client_name, project, minutes: Array<number>(7).fill(0), total: 0 };
    const m = Math.max(num(e.minutes), 0);
    row.minutes[i] += m;
    row.total += m;
    dayTotals[i] += m;
    total += m;
    if (e.billable) billableTotal += m;
    rows.set(key, row);
  }
  return {
    days,
    rows: [...rows.values()].sort((a, b) => a.client_name.localeCompare(b.client_name) || a.project.localeCompare(b.project)),
    dayTotals,
    total,
    billableTotal,
  };
}

export interface TimeTotal {
  key: string;
  label: string;
  minutes: number;
  billable_minutes: number;
  amount: number;
}

function totalsBy(entries: TimeEntry[], prefs: TimePrefs, keyOf: (e: TimeEntry) => [string, string]): TimeTotal[] {
  const map = new Map<string, TimeTotal>();
  for (const e of entries) {
    const [key, label] = keyOf(e);
    const row = map.get(key) ?? { key, label, minutes: 0, billable_minutes: 0, amount: 0 };
    row.minutes += Math.max(num(e.minutes), 0);
    if (e.billable) row.billable_minutes += billableMinutes(e, prefs);
    row.amount = round2(row.amount + entryAmount(e, prefs));
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label));
}

export const totalsByClient = (entries: TimeEntry[], prefs: TimePrefs): TimeTotal[] =>
  totalsBy(entries, prefs, (e) => [clientKey(e), e.client_name || 'No client']);

export const totalsByProject = (entries: TimeEntry[], prefs: TimePrefs): TimeTotal[] =>
  totalsBy(entries, prefs, (e) => {
    const p = (e.project ?? '').trim();
    return [`${clientKey(e)}|${p.toLowerCase()}`, p ? `${e.client_name} · ${p}` : `${e.client_name} · (no project)`];
  });

export const totalsByWeek = (entries: TimeEntry[], prefs: TimePrefs): TimeTotal[] =>
  totalsBy(entries, prefs, (e) => {
    const w = weekStart(e.date);
    return [w, w];
  }).sort((a, b) => a.key.localeCompare(b.key));

export function mileageTotals(trips: MileageEntry[]): { km: number; amount: number; count: number } {
  let km = 0;
  let amount = 0;
  for (const t of trips) {
    km = round2(km + Math.max(num(t.km), 0));
    amount = round2(amount + mileageAmount(t));
  }
  return { km, amount, count: trips.length };
}

export const mileageAmount = (t: MileageEntry): number => round2(Math.max(num(t.km), 0) * num(t.rate_per_km));

// ── Pure: invoice lines ──────────────────────────────────────────

const shortDay = (day: string): string =>
  parseDay(day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

function span(days: string[]): string {
  const sorted = [...days].filter(Boolean).sort();
  if (!sorted.length) return '';
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return first === last ? shortDay(first) : `${shortDay(first)} – ${shortDay(last)}`;
}

function line(partial: Omit<InvoiceItem, 'id' | 'amount' | 'type'> & { type?: string }): InvoiceItem {
  return {
    id: generateId(),
    type: 'Service',
    discount_percent: 0,
    ...partial,
    amount: round2(num(partial.quantity) * num(partial.rate)),
  };
}

/**
 * Time → invoice lines, one per project + description + rate. Each entry is rounded to the billing
 * step first, then the group is printed as hours to 2 dp (unit HRS) with the SAC from preferences.
 */
export function timeLines(entries: TimeEntry[], prefs: TimePrefs, centres: readonly CostCentre[] = [], workTypes: readonly WorkType[] = []): InvoiceItem[] {
  const groups = new Map<string, TimeEntry[]>();
  const ccOf = (e: TimeEntry) => e.cost_centre_id || matchCostCentre(e.project, centres) || '';
  for (const e of entries) {
    if (!e.billable) continue;
    // R3-B1: lines also split by work type (its SAC prints on the line).
    const key = [(e.project ?? '').trim().toLowerCase(), (e.description ?? '').trim().toLowerCase(), num(e.hourly_rate), ccOf(e), e.work_type_id ?? ''].join('|');
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out: InvoiceItem[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const project = (first.project ?? '').trim();
    const desc = (first.description ?? '').trim() || workTypes.find((w) => w.id === first.work_type_id)?.name || '';
    const minutes = group.reduce((s, e) => s + billableMinutes(e, prefs), 0);
    const hours = toHours(minutes);
    if (hours <= 0) continue;
    out.push(line({
      name: project && desc ? `${project} — ${desc}` : project || desc || 'Professional services',
      description: `${span(group.map((e) => e.date))} · ${group.length} ${group.length === 1 ? 'entry' : 'entries'}`,
      hsn: sacFor(first, workTypes, prefs.sac),
      unit: 'HRS',
      quantity: hours,
      rate: num(first.hourly_rate),
      tax_rate: num(prefs.gst_rate),
      ...(ccOf(first) ? { cost_centre_id: ccOf(first) } : {}),
      bill_refs: group.map((e) => e.id),
    }));
  }
  return out;
}

export const PURE_AGENT_NOTE =
  'Recovered at actual cost as a pure agent (Rule 33, CGST Rules) — excluded from the taxable value. Verify with your CA.';

/** Cost of a bill to us: net of GST when the credit is claimed, else the full amount paid. */
export const rebillCost = (p: PurchaseRecord): number => round2(p.itc_eligible ? num(p.taxable) : num(p.total));

/**
 * A re-billed cost as an invoice line.
 *  - Normal: cost × (1 + markup%), part of the taxable supply at the preference GST rate.
 *  - Pure agent: the actual amount paid, no markup, GST 0%, with the Rule 33 note.
 */
export function expenseLine(p: PurchaseRecord, prefs: TimePrefs): InvoiceItem {
  const cc = p.cost_centre_id ? { cost_centre_id: p.cost_centre_id } : {};
  const label = [p.category || 'Expense', p.vendor_name].filter(Boolean).join(': ') + (p.bill_number ? ` (#${p.bill_number})` : '');
  if (p.pure_agent) {
    return line({
      name: `Reimbursement — ${label}`,
      description: `${shortDay(p.date)} · ${PURE_AGENT_NOTE}`,
      unit: 'NOS',
      quantity: 1,
      rate: round2(num(p.total)),
      tax_rate: 0,
      ...cc,
      bill_refs: [p.id],
    });
  }
  const markup = Math.max(num(p.markup_percent), 0);
  return line({
    name: `Re-billed expense — ${label}`,
    description: `${shortDay(p.date)}${markup ? ` · includes ${markup}% markup` : ''} · part of the taxable supply`,
    hsn: prefs.sac,
    unit: 'NOS',
    quantity: 1,
    rate: round2(rebillCost(p) * (1 + markup / 100)),
    tax_rate: num(prefs.gst_rate),
    ...cc,
    bill_refs: [p.id],
  });
}

/** Trips → one mileage line per rate (unit KM), taxed like the main supply. */
export function mileageLines(trips: MileageEntry[], prefs: TimePrefs): InvoiceItem[] {
  // One line per rate × cost centre.
  const byRate = new Map<string, MileageEntry[]>();
  const keyOf = (t: MileageEntry) => `${num(t.rate_per_km)}|${t.cost_centre_id ?? ''}`;
  for (const t of trips) byRate.set(keyOf(t), [...(byRate.get(keyOf(t)) ?? []), t]);
  const out: InvoiceItem[] = [];
  for (const group of byRate.values()) {
    const rate = num(group[0].rate_per_km);
    const cc = group[0].cost_centre_id;
    const km = round2(group.reduce((s, t) => s + Math.max(num(t.km), 0), 0));
    if (km <= 0) continue;
    out.push(line({
      name: 'Mileage',
      description: `${span(group.map((t) => t.date))} · ${group.length} ${group.length === 1 ? 'trip' : 'trips'}`,
      hsn: prefs.sac,
      unit: 'KM',
      quantity: km,
      rate,
      tax_rate: num(prefs.gst_rate),
      ...(cc ? { cost_centre_id: cc } : {}),
      bill_refs: group.map((t) => t.id),
    }));
  }
  return out;
}

export interface BillSelection {
  time: TimeEntry[];
  expenses: PurchaseRecord[];
  mileage: MileageEntry[];
}

export const buildBillLines = (sel: BillSelection, prefs: TimePrefs, centres: readonly CostCentre[] = [], workTypes: readonly WorkType[] = []): InvoiceItem[] => [
  ...timeLines(sel.time, prefs, centres, workTypes),
  ...sel.expenses.map((p) => expenseLine(p, prefs)),
  ...mileageLines(sel.mileage, prefs),
];

/**
 * Pure: turn a fresh draft into the bill for `client` with `items`. Picks the place of supply from
 * the client and the CGST/SGST vs IGST split from the sender, then recomputes every total.
 */
export function buildBillDraft(draft: InvoiceRecord, client: Client, items: InvoiceItem[], sender: SenderProfile | null, annexure?: InvoiceAnnexure): InvoiceRecord {
  const fullClient: Client = { ...blankClient(), ...client };
  const place = resolveStateCode({ code: fullClient.state_code, gstin: fullClient.gstin, name: fullClient.state }) || draft.place_of_supply;
  const gst_mode = deriveGstMode({
    senderStateCode: senderStateCode(sender),
    placeOfSupply: place,
    senderHasGstin: Boolean(sender?.companyGstin?.trim()),
    taxEnabled: items.some((i) => num(i.tax_rate) > 0),
  });
  const rec: InvoiceRecord = { ...draft, client: fullClient, items, place_of_supply: place, gst_mode, status: 'Draft', amount_paid: 0, ...(annexure ? { annexure } : {}) };
  const t = calculateInvoice(calcInputFromRecord(rec));
  return {
    ...rec,
    subtotal: t.subtotal,
    discount_amount: t.discount_amount,
    taxable_value: t.taxable_value,
    cgst_amount: t.cgst_amount,
    sgst_amount: t.sgst_amount,
    igst_amount: t.igst_amount,
    tax_amount: t.tax_amount,
    round_off: t.round_off,
    total: t.total,
    balance_due: t.balance_due,
    cess_amount: t.cess_amount,
    tcs_amount: t.tcs_amount,
    tds_amount: t.tds_amount,
  };
}

/** CSV/xlsx rows (header first) for time entries. */
export function timeEntriesToRows(
  entries: TimeEntry[],
  prefs: TimePrefs,
  live: Set<string>,
  invoiceNumbers: Map<string, string>,
): (string | number)[][] {
  return [
    ['Date', 'Client', 'Project', 'Description', 'Minutes', 'Billable hours', 'Rate', 'Amount', 'Status', 'Invoice'],
    ...[...entries]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => {
        const by = billedBy(e.invoiced_in, live, e.id);
        return [
          e.date, e.client_name, e.project ?? '', e.description, num(e.minutes),
          e.billable ? toHours(billableMinutes(e, prefs)) : 0, num(e.hourly_rate), entryAmount(e, prefs),
          !e.billable ? 'Non-billable' : by ? 'Billed' : 'Unbilled',
          by ? invoiceNumbers.get(by) ?? '' : '',
        ];
      }),
  ];
}

export function mileageToRows(trips: MileageEntry[], live: Set<string>): (string | number)[][] {
  return [
    ['Date', 'Client', 'From', 'To', 'Purpose', 'Km', 'Rate per km', 'Amount', 'Status'],
    ...[...trips]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => [t.date, t.client_name, t.from, t.to, t.purpose, num(t.km), num(t.rate_per_km), mileageAmount(t), isBilled(t.invoiced_in, live, t.id) ? 'Billed' : 'Unbilled']),
  ];
}

// ── Storage ──────────────────────────────────────────────────────

const now = () => new Date().toISOString();

export function readTimePrefs(): TimePrefs {
  const stored = getJson<Partial<TimePrefs> | null>(TIME_PREFS_KEY, null);
  return { ...DEFAULT_TIME_PREFS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

/** Role-gated like the time tables (`setJson` skips the table guard). */
export function saveTimePrefs(prefs: TimePrefs): void {
  requireAccess('books.edit');
  setJson(TIME_PREFS_KEY, prefs);
}

function crud<T extends { id: string; created_at?: string; updated_at?: string; invoiced_in?: string }>(table: string) {
  const all = (): T[] => getTable<T>(table);
  return {
    all,
    save(input: Omit<T, 'id'> & { id?: string }): T {
      const rows = all();
      const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
      const row = { ...existing, ...input, id: existing?.id ?? input.id ?? generateId(), created_at: existing?.created_at ?? now(), updated_at: now() } as T;
      setTable(table, existing ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
      return row;
    },
    remove(id: string): void {
      setTable(table, all().filter((r) => r.id !== id));
    },
    markInvoiced(ids: readonly string[], invoiceId: string | undefined): void {
      const wanted = new Set(ids);
      if (wanted.size) setTable(table, all().map((r) => (wanted.has(r.id) ? { ...r, invoiced_in: invoiceId } : r)));
    },
  };
}

export const timeDb = crud<TimeEntry>(TIME_TABLE);
export const mileageDb = crud<MileageEntry>(MILEAGE_TABLE);

export const currentLiveInvoiceIds = (): LiveBilling => liveInvoiceIds(localDb.invoices.getAll());

/** R3-B3: retainer coverage of the stored time today (empty when no retainer exists). */
export function currentCover(prefs = readTimePrefs(), entries = timeDb.all(), invoices: readonly InvoiceRecord[] = localDb.invoices.getAll()): RetainerCover | undefined {
  const retainers = loadRetainers();
  if (!retainers.length) return undefined;
  return retainerCover(retainers, entries, (e) => billableMinutes(e, prefs), invoices, localDayOf(new Date()));
}

/** R3-B2: does a row belong to project `id` (its cost centre, or a task of the project)? */
export function inProject(row: { cost_centre_id?: string; task_id?: string }, id: string, taskIds: ReadonlySet<string>): boolean {
  return row.cost_centre_id === id || (!!row.task_id && taskIds.has(row.task_id));
}

/** Everything still unbilled for one client (by `clientKey`), optionally only one project (R3-B2). */
export function unbilledFor(key: string, live = currentLiveInvoiceIds(), opts: { projectId?: string; prefs?: TimePrefs } = {}): BillSelection {
  const prefs = opts.prefs ?? readTimePrefs();
  const entries = timeDb.all();
  const sel: BillSelection = {
    time: unbilledTime(entries, live, currentCover(prefs, entries), prefs).filter((e) => clientKey(e) === key),
    mileage: unbilledMileage(mileageDb.all(), live).filter((t) => clientKey(t) === key),
    expenses: unbilledExpenses(purchasesDb.all(), live).filter((p) => p.billable_to_client_id === key),
  };
  if (!opts.projectId) return sel;
  const id = opts.projectId;
  const tasks = new Set(loadTasks().filter((t) => t.cost_centre_id === id).map((t) => t.id));
  return {
    time: sel.time.filter((e) => inProject(e, id, tasks)),
    mileage: sel.mileage.filter((t) => t.cost_centre_id === id),
    expenses: sel.expenses.filter((p) => p.cost_centre_id === id),
  };
}

/** Masters the annexure reads (task titles, project names, assignee names). */
export function annexureContext(): AnnexureContext {
  return { tasks: loadTasks(), centres: loadCostCentres() };
}

export class NothingToBillError extends Error {
  constructor() {
    super('Nothing unbilled for this client.');
    this.name = 'NothingToBillError';
  }
}

/**
 * Create and save a NEW draft invoice for the selection, then stamp every billed row with its id.
 * The client comes from the CRM (falling back to the name snapshot on the entries).
 */
export function billUnbilled(key: string, sel: BillSelection, prefs = readTimePrefs(), opts: { annexure?: boolean } = {}): InvoiceRecord {
  const lines = buildBillLines(sel, prefs, loadCostCentres(), loadWorkTypes());
  if (!lines.length) throw new NothingToBillError();
  // One shared cost centre becomes the document's; mixed ones stay as line overrides.
  const { costCentreId, items } = hoistCostCentre(lines);
  const master = localDb.clients.getById(key);
  // Expense-only bills have no name snapshot: the key is the expense's billable client (an id, or `name:...`).
  const name = (sel.time[0]?.client_name || sel.mileage[0]?.client_name || (key.startsWith('name:') ? key.slice(5) : '')).trim();
  if (!master && !name) {
    throw new Error('This client is no longer in your client list. Add the client again (or change the billable client on the expense) before billing.');
  }
  const client: Client = master ?? { ...blankClient(), name };
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile() ?? null;
  const base = makeDraft({ settings, sender, docType: 'INVOICE', templateId: localDb.template.get() });
  // R3-B4: the annexure is a snapshot of exactly the billed rows (Critical Rule 3).
  const annexure = opts.annexure ? buildAnnexure(sel, prefs, annexureContext()) : undefined;
  const draft = buildBillDraft({ ...base, id: generateId(), ...(costCentreId ? { cost_centre_id: costCentreId } : {}) }, client, items, sender, annexure);
  draft.invoice_number = localDb.invoices.nextNumber(draft.issue_date, draft.doc_type, sender?.invoicePrefix || undefined);
  const saved = localDb.invoices.save(draft);
  timeDb.markInvoiced(sel.time.map((e) => e.id), saved.id);
  mileageDb.markInvoiced(sel.mileage.map((t) => t.id), saved.id);
  purchasesDb.setRebilled(sel.expenses.map((p) => p.id), saved.id);
  return saved;
}
