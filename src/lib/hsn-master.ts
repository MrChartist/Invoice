/**
 * HSN / SAC master with rate history and default-rate inheritance (WP-6, P1-16) — TallyPrime's "GST Rate Setup".
 *
 * Table `hsn_master` (`mrchartist_inv_hsn_master`): one row per code with description, UQC, goods / services and a
 * date-keyed rate history (`rates`, oldest first; a change is appended with its effective date, earlier rows are
 * never rewritten — the same convention as tax-rules.ts). Documents keep the rate they were saved with; the master
 * only supplies the DEFAULT for a new line.
 *
 * Inheritance (`resolveGstRate`): the item's own rate → the HSN master rate in force on the document date → the
 * item group's default → the company default. These rates are what YOU enter — the app ships no rate schedule;
 * check notified rates (e.g. the 22 Sep 2025 rate rationalisation) with your CA.
 */

import { requireAccess } from './access';
import { audit } from './audit';
import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { GST_SLABS } from './tax-rules';

export const HSN_MASTER_TABLE = 'hsn_master';

export interface HsnRate {
  /** First day the rate applies, YYYY-MM-DD. */
  from: string;
  /** GST rate % (IGST; CGST / SGST are half each). */
  rate: number;
  /** Compensation cess % (ad valorem), when any. */
  cess_rate?: number;
  /** Notification / note. */
  source?: string;
}

export interface HsnMasterRow {
  id: string;
  /** 4–8 digit HSN, or a SAC starting with 99. */
  code: string;
  description: string;
  /** Unit quantity code (e.g. NOS, KGS). */
  uqc?: string;
  kind: 'goods' | 'services';
  rates: HsnRate[];
  created_at?: string;
  updated_at?: string;
}

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** Digits only; '' for anything that is not a 2–8 digit code. */
export function cleanHsn(code: unknown): string {
  const c = s(code).replace(/\s+/g, '');
  return /^\d{2,8}$/.test(c) ? c : '';
}

export const isSac = (code: string) => /^99/.test(code);

function cleanRates(v: unknown): HsnRate[] {
  if (!Array.isArray(v)) return [];
  const out: HsnRate[] = [];
  for (const r of v) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const from = isoDay(o.from);
    const rate = num(o.rate, NaN);
    if (!from || !Number.isFinite(rate) || rate < 0 || rate > 100) continue;
    const cess = num(o.cess_rate, 0);
    out.push({ from, rate: round2(rate), ...(cess > 0 ? { cess_rate: round2(cess) } : {}), ...(s(o.source) ? { source: s(o.source) } : {}) });
  }
  // Oldest first; a duplicate date keeps the later entry.
  const byDate = new Map<string, HsnRate>();
  for (const r of out) byDate.set(r.from, r);
  return [...byDate.values()].sort((a, b) => a.from.localeCompare(b.from));
}

export function normalizeHsnMaster(rows: unknown[]): HsnMasterRow[] {
  const out: HsnMasterRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const code = cleanHsn(o.code);
    if (!code || seen.has(code) || typeof o.id !== 'string') continue;
    seen.add(code);
    out.push({
      id: o.id,
      code,
      description: s(o.description),
      ...(s(o.uqc) ? { uqc: s(o.uqc).toUpperCase() } : {}),
      kind: o.kind === 'services' || (o.kind !== 'goods' && isSac(code)) ? 'services' : 'goods',
      rates: cleanRates(o.rates),
      ...(s(o.created_at) ? { created_at: s(o.created_at) } : {}),
      ...(s(o.updated_at) ? { updated_at: s(o.updated_at) } : {}),
    });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

export function loadHsnMaster(): HsnMasterRow[] {
  return normalizeHsnMaster(getTable<unknown>(HSN_MASTER_TABLE));
}

/** The rate row in force on `date` (latest `from` ≤ date), or undefined before the first one. */
export function rateOn(row: Pick<HsnMasterRow, 'rates'>, date: string): HsnRate | undefined {
  const d = isoDay(date);
  let hit: HsnRate | undefined;
  for (const r of row.rates) if (r.from <= d) hit = r;
  return hit;
}

/**
 * The master row for a line's HSN: exact code first, then the longest master code the line's code starts with
 * (an 8-digit line inherits a 4- or 6-digit master entry).
 */
export function findHsn(master: readonly HsnMasterRow[], code: string): HsnMasterRow | undefined {
  const c = cleanHsn(code);
  if (!c) return undefined;
  let best: HsnMasterRow | undefined;
  for (const r of master) {
    if (r.code === c) return r;
    if (c.startsWith(r.code) && (!best || r.code.length > best.code.length)) best = r;
  }
  return best;
}

export type RateSource = 'item' | 'hsn' | 'group' | 'company' | 'none';

export interface ResolvedRate {
  rate: number;
  cess_rate: number;
  source: RateSource;
  /** Master row used (source 'hsn'). */
  hsn?: string;
}

export interface RateContext {
  /** The item's own rate (catalogue / stock item); undefined / null / '' = not set. */
  itemRate?: number | string | null;
  hsn?: string;
  /** Document date (YYYY-MM-DD). */
  date: string;
  /** Default of the item's group (stock group / category), if any. */
  groupRate?: number | string | null;
  /** Company default rate, if any. */
  companyRate?: number | string | null;
}

const setNum = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = num(v, NaN);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** Default GST rate for a new line: item → HSN master (on the date) → group → company. */
export function resolveGstRate(master: readonly HsnMasterRow[], ctx: RateContext): ResolvedRate {
  const item = setNum(ctx.itemRate);
  if (item !== undefined) return { rate: item, cess_rate: 0, source: 'item' };
  const row = ctx.hsn ? findHsn(master, ctx.hsn) : undefined;
  const r = row ? rateOn(row, ctx.date) : undefined;
  if (row && r) return { rate: r.rate, cess_rate: r.cess_rate ?? 0, source: 'hsn', hsn: row.code };
  const group = setNum(ctx.groupRate);
  if (group !== undefined) return { rate: group, cess_rate: 0, source: 'group' };
  const company = setNum(ctx.companyRate);
  if (company !== undefined) return { rate: company, cess_rate: 0, source: 'company' };
  return { rate: 0, cess_rate: 0, source: 'none' };
}

export class HsnMasterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HsnMasterError';
  }
}

export type HsnInput = Omit<HsnMasterRow, 'id' | 'created_at' | 'updated_at'> & { id?: string };

export function validateHsn(input: HsnInput, others: readonly HsnMasterRow[] = []): string[] {
  const errors: string[] = [];
  const code = cleanHsn(input.code);
  if (!code || code.length < 4) errors.push('HSN / SAC is 4 to 8 digits.');
  else if (others.some((o) => o.code === code && o.id !== input.id)) errors.push(`HSN ${code} is already in the master.`);
  const rates = Array.isArray(input.rates) ? input.rates : [];
  rates.forEach((r, i) => {
    if (!isoDay(r.from)) errors.push(`Rate ${i + 1}: choose the date it applies from.`);
    const n = num(r.rate, NaN);
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.push(`Rate ${i + 1}: enter a rate between 0 and 100.`);
  });
  return errors;
}

/** Rates not in the GST slab list (a typo check, not a rule). */
export function offSlabRates(row: Pick<HsnMasterRow, 'rates'>): number[] {
  return row.rates.map((r) => r.rate).filter((r) => !(GST_SLABS as readonly number[]).includes(r));
}

/** Add / edit a code. Earlier rate rows are kept as they were (append a dated row to change the rate). Audited. */
export function saveHsn(input: HsnInput): HsnMasterRow {
  requireAccess('master.edit');
  const all = loadHsnMaster();
  const errors = validateHsn(input, all);
  if (errors.length) throw new HsnMasterError(errors[0]);
  const prev = input.id ? all.find((r) => r.id === input.id) : undefined;
  const code = cleanHsn(input.code);
  const now = new Date().toISOString();
  const row: HsnMasterRow = {
    id: prev?.id ?? generateId(),
    code,
    description: s(input.description),
    ...(s(input.uqc) ? { uqc: s(input.uqc).toUpperCase() } : {}),
    kind: input.kind === 'services' ? 'services' : 'goods',
    rates: cleanRates(input.rates),
    created_at: prev?.created_at ?? now,
    ...(prev ? { updated_at: now } : {}),
  };
  setTable(HSN_MASTER_TABLE, prev ? all.map((r) => (r.id === row.id ? row : r)) : [...all, row]);
  const cur = rateOn(row, now.slice(0, 10));
  audit.record({
    entity: 'gst',
    entity_id: row.id,
    action: prev ? 'update' : 'create',
    doc_number: code,
    summary: `${prev ? 'Edited' : 'Added'} HSN ${code}${row.description ? ` “${row.description}”` : ''}${cur ? ` (${cur.rate}% today)` : ''}, ${row.rates.length} rate row(s)`,
  });
  return row;
}

export function deleteHsn(id: string): void {
  const all = loadHsnMaster();
  const row = all.find((r) => r.id === id);
  if (!row) return;
  requireAccess('master.edit');
  setTable(HSN_MASTER_TABLE, all.filter((r) => r.id !== id));
  audit.record({ entity: 'gst', entity_id: id, action: 'delete', doc_number: row.code, summary: `Removed HSN ${row.code} from the master` });
}

export interface UsedHsn {
  code: string;
  description: string;
  uqc: string;
  rate: number;
  /** Earliest document date seen with this code + rate. */
  from: string;
  kind: 'goods' | 'services';
}

/**
 * Codes used on documents (invoice lines / catalogue / purchase lines) that are not in the master yet, with the most
 * frequent rate and the earliest date it was seen — a starting point the user reviews before saving.
 */
export function suggestFromLines(lines: readonly { hsn?: string; name?: string; unit?: string; rate?: number; date?: string }[], master: readonly HsnMasterRow[]): UsedHsn[] {
  const have = new Set(master.map((r) => r.code));
  const acc = new Map<string, { desc: string; uqc: string; rates: Map<number, { n: number; from: string }> }>();
  for (const l of lines) {
    const code = cleanHsn(l.hsn);
    if (!code || code.length < 4 || have.has(code)) continue;
    const a = acc.get(code) ?? { desc: s(l.name), uqc: s(l.unit).toUpperCase(), rates: new Map() };
    const rate = round2(num(l.rate));
    const day = isoDay(l.date) || '2017-07-01';
    const cur = a.rates.get(rate) ?? { n: 0, from: day };
    cur.n += 1;
    if (day < cur.from) cur.from = day;
    a.rates.set(rate, cur);
    if (!a.desc && s(l.name)) a.desc = s(l.name);
    acc.set(code, a);
  }
  return [...acc.entries()].map(([code, a]) => {
    const [rate, info] = [...a.rates.entries()].sort((x, y) => y[1].n - x[1].n || x[0] - y[0])[0];
    return { code, description: a.desc, uqc: a.uqc, rate, from: info.from, kind: isSac(code) ? 'services' as const : 'goods' as const };
  }).sort((a, b) => a.code.localeCompare(b.code));
}

/** Add suggested codes in one write (each with a single rate row). Returns how many were added. */
export function addSuggested(rows: readonly UsedHsn[]): number {
  if (!rows.length) return 0;
  requireAccess('master.edit');
  const all = loadHsnMaster();
  const have = new Set(all.map((r) => r.code));
  const now = new Date().toISOString();
  const add: HsnMasterRow[] = [];
  for (const u of rows) {
    if (have.has(u.code)) continue;
    have.add(u.code);
    add.push({ id: generateId(), code: u.code, description: u.description, ...(u.uqc ? { uqc: u.uqc } : {}), kind: u.kind, rates: [{ from: u.from, rate: u.rate }], created_at: now });
  }
  if (!add.length) return 0;
  setTable(HSN_MASTER_TABLE, [...all, ...add]);
  audit.record({ entity: 'gst', entity_id: 'hsn_master', action: 'create', doc_number: 'HSN', summary: `Added ${add.length} HSN / SAC code(s) to the master from existing documents` });
  return add.length;
}
