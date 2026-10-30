/**
 * Distribution pack (8.81 — BUSY / Marg / Gofrugal "area · beat · route · salesman").
 *
 *  - Masters: areas (`dist_areas`), routes (`dist_routes`, optionally inside an area) and beats
 *    (`dist_beats`: the round a salesman visits — area, route, salesman, visiting weekdays).
 *  - A party (client master) carries `area_id`, `beat_id` and its default `agent_id` (additive). The beat's
 *    area fills in when the party has none. Documents keep their own `agent_id` (editor / POS); a document
 *    without one is credited to the party's default salesman.
 *  - Reports (pure, rupees — foreign documents at their invoice rate, those without a rate left out):
 *    sales, outstanding and collections by salesman / beat / area; sales returns (credit notes) by beat;
 *    the day-wise beat plan (which beats are visited on a weekday, with each party's outstanding).
 *
 * Masters need `master.edit` (TABLE_ACTIONS) and are audited. Pure above "Storage".
 */

import type { Client, InvoiceRecord, Payment } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { fxRate } from './fx';
import { isRevenueDoc } from './stats';
import { receivableBalance, type RcmFields } from './rcm';
import { isoDay } from './dates';
import { toCsv } from './csv';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { audit } from './audit';

export const AREAS_TABLE = 'dist_areas';
export const ROUTES_TABLE = 'dist_routes';
export const BEATS_TABLE = 'dist_beats';

export interface Area { id: string; name: string; created_at?: string }
export interface DistRoute { id: string; name: string; area_id?: string; created_at?: string }
export interface Beat {
  id: string;
  name: string;
  area_id?: string;
  route_id?: string;
  /** Salesman (`sales_agents` row) who works this beat. */
  agent_id?: string;
  /** Visiting weekdays, 0 = Sunday … 6 = Saturday. */
  days?: number[];
  /** Order of the beat within its route (lower first). */
  seq?: number;
  created_at?: string;
}

export type DistGroupBy = 'salesman' | 'beat' | 'area';

interface AgentLike { id: string; name: string }

export interface DistContext {
  clients: readonly Client[];
  agents: readonly AgentLike[];
  areas: readonly Area[];
  beats: readonly Beat[];
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
export const NONE_KEY = '';

/** The client master a document belongs to (by id, else by name). */
function masterOf(snap: Pick<Client, 'id' | 'name'> | undefined, byId: Map<string, Client>, byName: Map<string, Client>): Client | undefined {
  if (!snap) return undefined;
  return (snap.id ? byId.get(snap.id) : undefined) ?? byName.get(norm(snap.name));
}

/** Classifier: document → salesman / beat / area key ('' = not assigned). */
export function classifier(ctx: DistContext) {
  const byId = new Map(ctx.clients.filter((c) => c.id).map((c) => [c.id as string, c]));
  const byName = new Map(ctx.clients.map((c) => [norm(c.name), c]));
  const beats = new Map(ctx.beats.map((b) => [b.id, b]));
  const party = (snap: Pick<Client, 'id' | 'name'> | undefined) => masterOf(snap, byId, byName);
  const keyFor = (by: DistGroupBy, doc: { client?: Pick<Client, 'id' | 'name'>; agent_id?: string }): string => {
    const m = party(doc.client);
    if (by === 'salesman') return doc.agent_id || m?.agent_id || beats.get(m?.beat_id ?? '')?.agent_id || NONE_KEY;
    if (by === 'beat') return m?.beat_id && beats.has(m.beat_id) ? m.beat_id : NONE_KEY;
    return m?.area_id || beats.get(m?.beat_id ?? '')?.area_id || NONE_KEY;
  };
  const labelFor = (by: DistGroupBy, key: string): string => {
    if (!key) return '';
    if (by === 'salesman') return ctx.agents.find((a) => a.id === key)?.name ?? key;
    if (by === 'beat') return beats.get(key)?.name ?? key;
    return ctx.areas.find((a) => a.id === key)?.name ?? key;
  };
  return { party, keyFor, labelFor };
}

export interface DistRow {
  key: string;
  /** '' = not assigned (the screen shows "Not assigned"). */
  label: string;
  docs: number;
  /** Sales / returns: value incl. GST; outstanding: balance; collections: money received. */
  amount: number;
  /** Sales / returns: taxable value. */
  taxable: number;
  parties: number;
}

function finish(map: Map<string, DistRow & { partySet: Set<string> }>): DistRow[] {
  return [...map.values()]
    .map(({ partySet, ...r }) => ({ ...r, amount: round2(r.amount), taxable: round2(r.taxable), parties: partySet.size }))
    .sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || b.amount - a.amount || a.label.localeCompare(b.label));
}

function bump(map: Map<string, DistRow & { partySet: Set<string> }>, key: string, label: string, party: string, amount: number, taxable: number) {
  const r = map.get(key) ?? { key, label, docs: 0, amount: 0, taxable: 0, parties: 0, partySet: new Set<string>() };
  r.docs++;
  r.amount += amount;
  r.taxable += taxable;
  if (party) r.partySet.add(norm(party));
  map.set(key, r);
}

const inPeriod = (day: string, p: { from: string; to: string }) => !!day && day >= p.from && day <= p.to;
const taxableOf = (inv: InvoiceRecord) => (typeof inv.taxable_value === 'number' ? inv.taxable_value : num(inv.total) - num(inv.tax_amount) - num(inv.cess_amount));

/** Sales (revenue documents) in the period by salesman / beat / area. */
export function salesBy(invoices: readonly InvoiceRecord[], ctx: DistContext, by: DistGroupBy, period: { from: string; to: string }): DistRow[] {
  const c = classifier(ctx);
  const map = new Map<string, DistRow & { partySet: Set<string> }>();
  for (const inv of invoices) {
    if (!inv || !isRevenueDoc(inv) || !inPeriod(isoDay(inv.issue_date), period)) continue;
    const rate = fxRate(inv);
    if (rate === null) continue;
    const key = c.keyFor(by, inv);
    bump(map, key, c.labelFor(by, key), inv.client?.name ?? '', num(inv.total) * rate, taxableOf(inv) * rate);
  }
  return finish(map);
}

/** Sales returns (issued credit notes) in the period by beat (or salesman / area). */
export function returnsBy(invoices: readonly InvoiceRecord[], ctx: DistContext, by: DistGroupBy, period: { from: string; to: string }): DistRow[] {
  const c = classifier(ctx);
  const map = new Map<string, DistRow & { partySet: Set<string> }>();
  for (const inv of invoices) {
    if (!inv || inv.doc_type !== 'CREDIT_NOTE' || inv.status === 'Draft' || inv.status === 'Cancelled' || !inPeriod(isoDay(inv.issue_date), period)) continue;
    const rate = fxRate(inv);
    if (rate === null) continue;
    const key = c.keyFor(by, inv);
    bump(map, key, c.labelFor(by, key), inv.client?.name ?? '', num(inv.total) * rate, taxableOf(inv) * rate);
  }
  return finish(map);
}

/** Open balances (as stored today) of issued sales documents by salesman / beat / area. */
export function outstandingBy(invoices: readonly InvoiceRecord[], ctx: DistContext, by: DistGroupBy): DistRow[] {
  const c = classifier(ctx);
  const map = new Map<string, DistRow & { partySet: Set<string> }>();
  for (const inv of invoices) {
    if (!inv || !isRevenueDoc(inv)) continue;
    const rate = fxRate(inv);
    const bal = Math.max(receivableBalance(inv as RcmFields), 0);
    if (rate === null || bal < 0.005) continue;
    const key = c.keyFor(by, inv);
    bump(map, key, c.labelFor(by, key), inv.client?.name ?? '', bal * rate, 0);
  }
  return finish(map);
}

/** Money received in the period (payment rows) by the salesman / beat / area of the document paid. */
export function collectionsBy(payments: readonly Pick<Payment, 'invoice_id' | 'amount' | 'date'>[], invoices: readonly InvoiceRecord[], ctx: DistContext, by: DistGroupBy, period: { from: string; to: string }): DistRow[] {
  const c = classifier(ctx);
  const docs = new Map(invoices.map((i) => [i.id, i]));
  const map = new Map<string, DistRow & { partySet: Set<string> }>();
  for (const p of payments) {
    const inv = docs.get(p.invoice_id);
    if (!inv || !inPeriod(isoDay(p.date), period)) continue;
    const rate = fxRate(inv);
    if (rate === null) continue;
    const key = c.keyFor(by, inv);
    bump(map, key, c.labelFor(by, key), inv.client?.name ?? '', num(p.amount) * rate, 0);
  }
  return finish(map);
}

export const distCsv = (title: string, rows: readonly DistRow[], groupLabel: string, notAssigned: string): string =>
  toCsv([[title], [groupLabel, 'Documents', 'Parties', 'Amount (₹)', 'Taxable (₹)'], ...rows.map((r) => [r.label || notAssigned, r.docs, r.parties, r.amount, r.taxable])]);

/* ── Beat plan ─────────────────────────────────────────────────── */

export interface PlanParty { id?: string; name: string; outstanding: number; phone?: string }
export interface PlanBeat { beat: Beat; agent: string; route: string; area: string; parties: PlanParty[]; outstanding: number }

/** Weekday (0 = Sunday) of a yyyy-mm-dd day, read as a local calendar day. */
export function weekdayOf(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : -1;
}

/** Beats visited on `weekday`, in route order, each with its parties and their outstanding. */
export function beatPlan(weekday: number, ctx: DistContext, invoices: readonly InvoiceRecord[], routes: readonly DistRoute[] = []): PlanBeat[] {
  const owed = new Map<string, number>();
  const c = classifier(ctx);
  for (const inv of invoices) {
    if (!inv || !isRevenueDoc(inv)) continue;
    const rate = fxRate(inv);
    const m = c.party(inv.client);
    if (rate === null || !m) continue;
    const key = m.id || norm(m.name);
    owed.set(key, (owed.get(key) ?? 0) + Math.max(receivableBalance(inv as RcmFields), 0) * rate);
  }
  return ctx.beats
    .filter((b) => (b.days ?? []).includes(weekday))
    .map((beat) => {
      const parties = ctx.clients
        .filter((cl) => cl.beat_id === beat.id)
        .map((cl) => ({ id: cl.id, name: cl.name, phone: cl.phone, outstanding: round2(owed.get(cl.id || norm(cl.name)) ?? 0) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        beat,
        agent: ctx.agents.find((a) => a.id === beat.agent_id)?.name ?? '',
        route: routes.find((r) => r.id === beat.route_id)?.name ?? '',
        area: ctx.areas.find((a) => a.id === beat.area_id)?.name ?? '',
        parties,
        outstanding: round2(parties.reduce((s, p) => s + p.outstanding, 0)),
      };
    })
    .sort((a, b) => a.route.localeCompare(b.route) || num(a.beat.seq) - num(b.beat.seq) || a.beat.name.localeCompare(b.beat.name));
}

/* ── Storage ──────────────────────────────────────────────────── */

const now = () => new Date().toISOString();

function logMaster(kind: string, id: string, action: 'create' | 'update' | 'delete', summary: string): void {
  try {
    audit.record({ entity: 'client', entity_id: id, action, summary: `${kind}: ${summary}` });
  } catch {
    /* logging never breaks a save */
  }
}

function masterDb<T extends { id: string; name: string; created_at?: string }>(table: string, kind: string, inUse: (id: string) => string) {
  const db = {
    all: (): T[] => getTable<T>(table).filter((r) => r && typeof r.id === 'string'),
    save(input: Omit<T, 'id'> & { id?: string }): T {
      requireAccess('master.edit');
      const name = String(input.name ?? '').trim();
      if (!name) throw new Error(`Enter the ${kind.toLowerCase()} name.`);
      const rows = db.all();
      if (rows.some((r) => r.id !== input.id && norm(r.name) === norm(name))) throw new Error(`${kind} "${name}" already exists.`);
      const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
      const row = { ...existing, ...input, id: existing?.id ?? input.id ?? generateId(), name, created_at: existing?.created_at ?? now() } as T;
      setTable(table, existing ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
      logMaster(kind, row.id, existing ? 'update' : 'create', `${existing ? 'edited' : 'added'} "${name}"`);
      return row;
    },
    remove(id: string): void {
      requireAccess('master.edit');
      const row = db.all().find((r) => r.id === id);
      if (!row) return;
      const used = inUse(id);
      if (used) throw new Error(`${kind} "${row.name}" is used by ${used}, so it cannot be deleted.`);
      setTable(table, db.all().filter((r) => r.id !== id));
      logMaster(kind, id, 'delete', `deleted "${row.name}"`);
    },
  };
  return db;
}

const clientsUsing = (field: 'area_id' | 'beat_id', id: string) => getTable<Client>('clients').filter((c) => c?.[field] === id).length;

export const areasDb = masterDb<Area>(AREAS_TABLE, 'Area', (id) => {
  const n = clientsUsing('area_id', id);
  if (n) return `${n} part${n === 1 ? 'y' : 'ies'}`;
  if (getTable<Beat>(BEATS_TABLE).some((b) => b?.area_id === id) || getTable<DistRoute>(ROUTES_TABLE).some((r) => r?.area_id === id)) return 'beats or routes';
  return '';
});
export const routesDb = masterDb<DistRoute>(ROUTES_TABLE, 'Route', (id) => (getTable<Beat>(BEATS_TABLE).some((b) => b?.route_id === id) ? 'beats' : ''));
export const beatsDb = masterDb<Beat>(BEATS_TABLE, 'Beat', (id) => {
  const n = clientsUsing('beat_id', id);
  return n ? `${n} part${n === 1 ? 'y' : 'ies'}` : '';
});

export type PartyDistPatch = Partial<Pick<Client, 'area_id' | 'beat_id' | 'agent_id' | 'credit_policy'>>;

/**
 * Set area / beat / salesman / credit policy on several parties in one write ('' clears a field).
 * `master.edit`; one audit row.
 */
export function assignParties(ids: readonly string[], patch: { [K in keyof PartyDistPatch]?: string }): number {
  requireAccess('master.edit');
  const want = new Set(ids);
  let n = 0;
  const rows = getTable<Client>('clients').map((c) => {
    if (!c?.id || !want.has(c.id)) return c;
    const next: Client = { ...c, updated_at: now() };
    for (const [k, v] of Object.entries(patch) as [keyof PartyDistPatch, string | undefined][]) {
      if (v === undefined) continue;
      if (v) (next as unknown as Record<string, string>)[k] = v;
      else delete next[k];
    }
    n++;
    return next;
  });
  if (!n) return 0;
  setTable('clients', rows);
  logMaster('Parties', ids.join(','), 'update', `${n} part${n === 1 ? 'y' : 'ies'} assigned (${Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v || '-'}`).join(', ')})`);
  return n;
}

/** Live context for the reports. */
export function liveDistContext(): DistContext {
  return {
    clients: getTable<Client>('clients'),
    agents: getTable<AgentLike>('sales_agents').filter((a) => a && a.id),
    areas: areasDb.all(),
    beats: beatsDb.all(),
  };
}
