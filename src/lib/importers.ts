/**
 * Import engine: raw CSV rows -> validated clients / catalogue items / opening
 * invoices, with duplicate detection, a dry-run report and a chunked apply.
 *
 * Pure logic (no React, no browser APIs). Persistence is behind an `ImportSink`
 * so the engine is testable in Node; `createLocalSink()` is the real one.
 */

import type { Client, InvoiceItem, InvoiceRecord, SenderProfile } from '../types/invoice';
import { checkGstin } from './gstin';
import { INDIAN_STATES, stateByCode } from './india-states';
import { calculateInvoice, deriveGstMode, round2 } from './invoice-calc';
import { writeCsv } from './csv';
import { fieldsFor, type ColumnMapping, type ImportKind } from './import-mapping';
import { KEYS, generateId, getTable, setTable } from './storage';
import { blankClient, normalizeRecord } from '../store/invoice-defaults';

/* ══════════════════════════════════════════════════════════════
   Scalar parsers
   ══════════════════════════════════════════════════════════════ */

export interface ParsedNumber {
  /** null when the cell was empty. */
  value: number | null;
  ok: boolean;
}

/**
 * Parses money / quantity / percent cells: "₹ 1,23,456.50", "Rs. 1,000/-",
 * "(500)", "1.234,56" (European), "1.5E+3", "18%", "2,500.00 Dr".
 */
export function parseNumber(raw: unknown): ParsedNumber {
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, ok: true } : { value: null, ok: false };
  let s = String(raw ?? '').trim().replace(/^'/, '');
  if (s === '' || s === '-' || /^(n\/?a|nil|none|null)$/i.test(s)) return { value: null, ok: true };

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s
    .replace(/\s/g, '')
    .replace(/(₹|rs\.?|inr)/gi, '')
    .replace(/\/-$/, '')
    .replace(/(dr|cr)\.?$/i, '')
    .replace(/%$/, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }

  if (/^\d+(\.\d+)?e[-+]?\d+$/i.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? { value: negative ? -n : n, ok: true } : { value: null, ok: false };
  }
  if (!/^\d[\d.,]*$|^[.,]\d+$/.test(s)) return { value: null, ok: false };

  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  let normalized: string;
  if (commas > 0 && dots > 0) {
    const decimalIsDot = s.lastIndexOf('.') > s.lastIndexOf(',');
    const groupChar = decimalIsDot ? ',' : '.';
    const parts = s.split(groupChar);
    if (decimalIsDot && dots > 1) return { value: null, ok: false };
    if (!decimalIsDot && commas > 1) return { value: null, ok: false };
    normalized = parts.join('');
    if (!decimalIsDot) normalized = normalized.replace(',', '.');
  } else if (commas > 0) {
    const parts = s.split(',');
    const last = parts[parts.length - 1];
    if (commas === 1 && last.length <= 2 && last.length > 0 && parts[0] !== '') {
      normalized = `${parts[0]}.${last}`; // "12,5" / "12,50" — decimal comma
    } else {
      if (!parts.slice(1).every((p) => p.length === 2 || p.length === 3)) return { value: null, ok: false };
      normalized = parts.join('');
    }
  } else if (dots > 1) {
    const parts = s.split('.');
    if (!parts.slice(1).every((p) => p.length === 3)) return { value: null, ok: false };
    normalized = parts.join('');
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return { value: null, ok: false };
  return { value: negative ? -n : n, ok: true };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}`;
}

function fullYear(y: number): number {
  if (y >= 100) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

/**
 * Normalises a date cell to `yyyy-mm-dd`. Day-first for numeric forms (the
 * Indian convention) unless the day/month can only be read the other way.
 * Accepts dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy, yyyy-mm-dd(Thh:mm), dd-MMM-yyyy,
 * "1 April 2025", "Apr 5, 2025", yyyymmdd and Excel serial numbers.
 */
export function parseDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m: RegExpExecArray | null;

  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s))) return isoDate(+m[1], +m[2], +m[3]);
  if ((m = /^((?:19|20)\d{2})(\d{2})(\d{2})$/.exec(s))) return isoDate(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{5})(?:\.\d+)?$/.exec(s))) {
    const serial = Number(m[1]);
    if (serial < 20000 || serial > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s,].*)?$/.exec(s))) {
    const a = +m[1];
    const b = +m[2];
    const y = fullYear(+m[3]);
    if (a > 12) return isoDate(y, b, a);
    if (b > 12) return isoDate(y, a, b);
    return isoDate(y, b, a);
  }
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[-/.\s]+([A-Za-z]{3,9})\.?[-/.,\s]+(\d{2}|\d{4})(?:[\s,].*)?$/.exec(s))) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mon ? isoDate(fullYear(+m[3]), mon, +m[1]) : null;
  }
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mon ? isoDate(+m[3], mon, +m[2]) : null;
  }
  return null;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) ?? iso;
}

/* ── States ──────────────────────────────────────────────────── */

const squash = (s: string) =>
  s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

const STATE_BY_KEY = new Map<string, string>();
for (const st of INDIAN_STATES) STATE_BY_KEY.set(squash(st.name), st.code);
const STATE_ALIASES: Record<string, string> = {
  orissa: '21', pondicherry: '34', uttaranchal: '05', newdelhi: '07', nctofdelhi: '07', delhinct: '07',
  delhincr: '07', delhi: '07', jammuandkashmir: '01', jandk: '01', dadraandnagarhaveli: '26',
  damananddiu: '26', dadranagarhaveli: '26', damandiu: '26', andamanandnicobar: '35',
  andamannicobarislands: '35', andamannicobar: '35', telengana: '36', chattisgarh: '22', tamilnadu: '33',
  bengal: '19', otherterritory: '97', othercountry: '99', export: '99', ladakh: '38',
};
const STATE_ABBR: Record<string, string> = {
  an: '35', ap: '37', ar: '12', as: '18', br: '10', ch: '04', cg: '22', dn: '26', dd: '26', dl: '07',
  ga: '30', gj: '24', hr: '06', hp: '02', jk: '01', jh: '20', ka: '29', kl: '32', la: '38', ld: '31',
  mp: '23', mh: '27', mn: '14', ml: '17', mz: '15', nl: '13', od: '21', or: '21', pb: '03', py: '34',
  rj: '08', sk: '11', tn: '33', ts: '36', tr: '16', up: '09', uk: '05', ut: '05', wb: '19',
};

export interface ResolvedState {
  code: string;
  name: string;
}

/** "Maharashtra", "27", "27-Maharashtra", "Maharashtra (27)", "MH", "Orissa" … */
export function resolveStateText(raw: string): ResolvedState | undefined {
  const s = (raw ?? '').trim();
  if (!s) return undefined;
  const found = (code: string | undefined) => {
    const st = stateByCode(code);
    return st ? { code: st.code, name: st.name } : undefined;
  };
  if (/^\d{1,2}$/.test(s)) return found(s);
  const lead = /^(\d{2})\s*[-–—:]\s*(.+)$/.exec(s);
  if (lead) return found(lead[1]) ?? resolveStateText(lead[2]);
  const trail = /^(.+?)\s*\(\s*(\d{2})\s*\)$/.exec(s);
  if (trail) return found(trail[2]) ?? resolveStateText(trail[1]);
  const key = squash(s);
  if (/^[a-z]{2}$/.test(s.toLowerCase()) && STATE_ABBR[key]) return found(STATE_ABBR[key]);
  return found(STATE_BY_KEY.get(key) ?? STATE_ALIASES[key]);
}

/* ══════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════ */

export type ClientDraft = Partial<Client> & { name: string };
export type CatalogDraft = Partial<InvoiceItem> & { name: string };
export type ImportRecord = ClientDraft | CatalogDraft | InvoiceRecord;

export interface RowIssue {
  level: 'error' | 'warning';
  field?: string;
  message: string;
}

export type RowAction = 'create' | 'update' | 'skip' | 'error';

export interface PreviewRow {
  /** Position of the first source row in the table (0-based). */
  index: number;
  /** All source rows folded into this record (invoice line items). */
  sourceIndexes: number[];
  /** Spreadsheet row number users will recognise (header = row 1). */
  line: number;
  label: string;
  action: RowAction;
  /** Why the row will not be written (duplicate / skipped by user). */
  skipReason?: string;
  matchId?: string;
  issues: RowIssue[];
  record: ImportRecord | null;
}

export interface ImportOptions {
  /** Existing clients/items: overwrite blank-safe ('update') or leave alone ('skip'). */
  duplicateMode: 'update' | 'skip';
  /** Treat a GSTIN with a bad checksum as an error (default) instead of a warning. */
  strictGstin: boolean;
  /** Days added to the invoice date when the file has no due date. */
  defaultDueDays: number;
  sender: SenderProfile | null;
  senderStateCode: string;
  templateId?: string;
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  duplicateMode: 'update',
  strictGstin: true,
  defaultDueDays: 14,
  sender: null,
  senderStateCode: '',
};

export interface ExistingData {
  clients: Client[];
  items: InvoiceItem[];
  invoices: Pick<InvoiceRecord, 'invoice_number'>[];
}

export interface ImportTable {
  headers: string[];
  rows: string[][];
}

export interface PreviewSummary {
  total: number;
  create: number;
  update: number;
  skip: number;
  error: number;
  warnings: number;
}

export interface ImportPreview {
  kind: ImportKind;
  rows: PreviewRow[];
  summary: PreviewSummary;
}

export interface ReportError {
  line: number;
  label: string;
  message: string;
}

export interface ImportReport {
  created: number;
  updated: number;
  skipped: number;
  errors: ReportError[];
}

/* ══════════════════════════════════════════════════════════════
   Shared row helpers
   ══════════════════════════════════════════════════════════════ */

interface RowCtx {
  mapping: ColumnMapping;
  options: ImportOptions;
  issues: RowIssue[];
}

function cellOf(mapping: ColumnMapping, row: string[], key: string): string {
  const c = mapping[key];
  if (c === undefined || c < 0) return '';
  return (row[c] ?? '').trim();
}

const err = (ctx: RowCtx, field: string | undefined, message: string) =>
  ctx.issues.push({ level: 'error', field, message });
const warn = (ctx: RowCtx, field: string | undefined, message: string) =>
  ctx.issues.push({ level: 'warning', field, message });

const label = (key: string, kind: ImportKind) => fieldsFor(kind).find((f) => f.key === key)?.label ?? key;

/** Excel often turns phone/PIN cells into "9820012345.0" or "9.82E+09". */
function cleanDigitsCell(s: string): string {
  let v = s.trim().replace(/^'/, '');
  if (/^\d+\.0+$/.test(v)) v = v.replace(/\.0+$/, '');
  if (/^\d(\.\d+)?e\+\d+$/i.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) v = n.toLocaleString('fullwide', { useGrouping: false });
  }
  return v;
}

function readNumber(
  ctx: RowCtx,
  kind: ImportKind,
  raw: string,
  key: string,
  opts: { min?: number; max?: number } = {},
): number | undefined {
  const p = parseNumber(raw);
  if (!p.ok) {
    err(ctx, key, `${label(key, kind)}: "${raw}" is not a valid number`);
    return undefined;
  }
  if (p.value === null) return undefined;
  if (opts.min !== undefined && p.value < opts.min) {
    err(ctx, key, `${label(key, kind)} cannot be below ${opts.min}`);
    return undefined;
  }
  if (opts.max !== undefined && p.value > opts.max) {
    err(ctx, key, `${label(key, kind)} cannot exceed ${opts.max}`);
    return undefined;
  }
  return p.value;
}

const NO_GSTIN = /^(unregistered|urd|na|n\/a|nil|none|-+|consumer|b2c)$/i;

/** Returns a normalised GSTIN ('' when blank/unregistered); pushes issues. */
function readGstin(ctx: RowCtx, raw: string, field: string): string {
  const g = raw.replace(/[\s-]/g, '').toUpperCase();
  if (!g || NO_GSTIN.test(raw.trim())) return '';
  const check = checkGstin(g);
  if (check.valid) return g;
  const msg = `GSTIN "${g}": ${check.message}`;
  if (ctx.options.strictGstin) {
    err(ctx, field, msg);
    return '';
  }
  warn(ctx, field, `${msg} (imported as typed)`);
  return g;
}

function readState(ctx: RowCtx, raw: string, gstin: string, field: string): ResolvedState | undefined {
  const fromGstin = gstin && checkGstin(gstin).valid ? stateByCode(gstin.slice(0, 2)) : undefined;
  if (raw) {
    const st = resolveStateText(raw);
    if (!st) {
      warn(ctx, field, `State "${raw}" was not recognised`);
      return fromGstin ? { code: fromGstin.code, name: fromGstin.name } : undefined;
    }
    if (fromGstin && fromGstin.code !== st.code) {
      warn(ctx, field, `State "${st.name}" does not match the GSTIN's state (${fromGstin.name})`);
    }
    return st;
  }
  return fromGstin ? { code: fromGstin.code, name: fromGstin.name } : undefined;
}

/* ══════════════════════════════════════════════════════════════
   Clients
   ══════════════════════════════════════════════════════════════ */

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const normName = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

interface ClientIndex {
  byGstin: Map<string, Client>;
  byName: Map<string, Client>;
}

export function indexClients(clients: Client[]): ClientIndex {
  const byGstin = new Map<string, Client>();
  const byName = new Map<string, Client>();
  for (const c of clients) {
    const g = (c.gstin ?? '').replace(/\s/g, '').toUpperCase();
    if (g && !byGstin.has(g)) byGstin.set(g, c);
    const n = normName(c.name);
    if (n && !byName.has(n)) byName.set(n, c);
  }
  return { byGstin, byName };
}

export function findClient(index: ClientIndex, name: string, gstin: string): Client | undefined {
  return (gstin ? index.byGstin.get(gstin) : undefined) ?? index.byName.get(normName(name));
}

function buildClientRecord(row: string[], ctx: RowCtx): ClientDraft | null {
  const c = (k: string) => cellOf(ctx.mapping, row, k);
  const name = c('name').replace(/\s+/g, ' ');
  if (!name) {
    err(ctx, 'name', 'Name is required');
    return null;
  }
  const rec: ClientDraft = { name };
  const company = c('company');
  if (company) rec.company = company;

  const gstin = readGstin(ctx, c('gstin'), 'gstin');
  if (gstin) rec.gstin = gstin;

  const email = c('email');
  if (email) {
    if (!EMAIL_RE.test(email)) warn(ctx, 'email', `Email "${email}" looks invalid`);
    rec.email = email;
  }
  const phone = cleanDigitsCell(c('phone'));
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) warn(ctx, 'phone', `Phone "${phone}" looks wrong`);
    rec.phone = phone;
  }
  const address = [c('address'), c('address2')].filter(Boolean).join(', ');
  if (address) rec.address = address;
  const city = c('city');
  if (city) rec.city = city;
  const zip = cleanDigitsCell(c('zip'));
  if (zip) {
    if (!/^\d{6}$/.test(zip)) warn(ctx, 'zip', `PIN code "${zip}" should be 6 digits`);
    rec.zip = zip;
  }
  const state = readState(ctx, c('state'), gstin, 'state');
  if (state) {
    rec.state = state.name;
    rec.state_code = state.code;
  }
  const notes = c('notes');
  if (notes) rec.notes = notes;
  return rec;
}

/* ══════════════════════════════════════════════════════════════
   Items
   ══════════════════════════════════════════════════════════════ */

const UNIT_ALIASES: Record<string, string> = {
  nos: 'NOS', no: 'NOS', number: 'NOS', numbers: 'NOS', unit: 'NOS', units: 'NOS', pcs: 'PCS', pc: 'PCS',
  piece: 'PCS', pieces: 'PCS', hrs: 'HRS', hr: 'HRS', hour: 'HRS', hours: 'HRS', day: 'DAY', days: 'DAY',
  month: 'MONTH', months: 'MONTH', mth: 'MONTH', set: 'SET', sets: 'SET', kg: 'KG', kgs: 'KG', kilogram: 'KG',
  kilograms: 'KG', ltr: 'LTR', ltrs: 'LTR', l: 'LTR', litre: 'LTR', liter: 'LTR', litres: 'LTR', mtr: 'MTR',
  mtrs: 'MTR', m: 'MTR', meter: 'MTR', metre: 'MTR', meters: 'MTR', sqf: 'SQF', sqft: 'SQF', box: 'BOX',
  boxes: 'BOX', lot: 'LOT', lots: 'LOT',
};

export function normalizeUnit(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const key = s.toLowerCase().replace(/[^a-z]/g, '');
  return UNIT_ALIASES[key] ?? s.toUpperCase();
}

/** Strips punctuation/spaces from an HSN/SAC and checks it has 2-8 digits. */
function readHsn(ctx: RowCtx, raw: string, field: string): string {
  const v = cleanDigitsCell(raw).replace(/[\s.\-/]/g, '');
  if (!v) return '';
  if (!/^\d{2,8}$/.test(v)) warn(ctx, field, `HSN/SAC "${raw}" should be 2-8 digits`);
  else if (![2, 4, 6, 8].includes(v.length)) warn(ctx, field, `HSN/SAC "${v}" has an unusual length`);
  return v;
}

function readItemType(raw: string, hsn: string): string {
  const t = raw.toLowerCase();
  if (/serv/.test(t)) return 'Service';
  if (/good|prod|stock|inventory|material/.test(t)) return 'Product';
  if (hsn.startsWith('99')) return 'Service';
  return hsn ? 'Product' : 'Service';
}

function buildItemRecord(row: string[], ctx: RowCtx): CatalogDraft | null {
  const c = (k: string) => cellOf(ctx.mapping, row, k);
  const name = c('name').replace(/\s+/g, ' ');
  if (!name) {
    err(ctx, 'name', 'Item name is required');
    return null;
  }
  const rec: CatalogDraft = { name };
  const desc = c('description');
  if (desc) rec.description = desc;
  const hsn = readHsn(ctx, c('hsn'), 'hsn');
  if (hsn) rec.hsn = hsn;
  const unit = normalizeUnit(c('unit'));
  if (unit) rec.unit = unit;
  const rate = readNumber(ctx, 'items', c('rate'), 'rate', { min: 0 });
  rec.rate = rate ?? 0;
  const tax = readNumber(ctx, 'items', c('tax_rate'), 'tax_rate', { min: 0, max: 100 });
  if (tax !== undefined) {
    rec.tax_rate = tax;
    if (![0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28].includes(tax)) {
      warn(ctx, 'tax_rate', `GST ${tax}% is not a standard slab`);
    }
  }
  rec.type = readItemType(c('type'), hsn);
  return rec;
}

function itemKey(name: string, hsn?: string) {
  return `${normName(name)}|${(hsn ?? '').trim()}`;
}

function findItem(items: InvoiceItem[], name: string, hsn: string): InvoiceItem | undefined {
  const n = normName(name);
  let loose: InvoiceItem | undefined;
  for (const it of items) {
    if (normName(it.name) !== n) continue;
    const h = (it.hsn ?? '').trim();
    if (h === hsn) return it;
    if (!loose && (h === '' || hsn === '')) loose = it;
  }
  return loose;
}

/* ══════════════════════════════════════════════════════════════
   Invoices
   ══════════════════════════════════════════════════════════════ */

const GST_SLAB_LIST = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28];

function snapSlab(rate: number): number {
  for (const s of GST_SLAB_LIST) if (Math.abs(s - rate) <= 0.15) return s;
  return round2(rate);
}

type InvStatus = InvoiceRecord['status'];

function statusFromText(raw: string): InvStatus | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (/cancel|void/.test(t)) return 'Cancelled';
  if (/draft/.test(t)) return 'Draft';
  if (/over\s*due/.test(t)) return 'Overdue';
  if (/part/.test(t)) return 'Partially Paid';
  if (/un\s*paid|not\s*paid|pending|open|due|sent|credit/.test(t)) return 'Sent';
  if (/paid|settled|closed|received|cash/.test(t)) return 'Paid';
  return null;
}

interface InvoiceGroup {
  number: string;
  rows: number[];
}

function firstNonEmpty(rows: string[][], mapping: ColumnMapping, key: string): string {
  for (const r of rows) {
    const v = cellOf(mapping, r, key);
    if (v) return v;
  }
  return '';
}

function buildInvoiceRecord(
  rowsOfGroup: string[][],
  ctx: RowCtx,
  clientIndex: ClientIndex,
): InvoiceRecord | null {
  const { mapping, options } = ctx;
  const h = (k: string) => firstNonEmpty(rowsOfGroup, mapping, k);
  const K: ImportKind = 'invoices';

  const number = h('invoice_number');
  if (!number) {
    err(ctx, 'invoice_number', 'Invoice number is required — opening invoices keep the number you give them');
    return null;
  }
  const issueRaw = h('issue_date');
  const issue = parseDate(issueRaw);
  if (!issue) {
    err(ctx, 'issue_date', issueRaw ? `Invoice date "${issueRaw}" is not a recognised date` : 'Invoice date is required');
  }
  let due: string | null = null;
  const dueRaw = h('due_date');
  if (dueRaw) {
    due = parseDate(dueRaw);
    if (!due) warn(ctx, 'due_date', `Due date "${dueRaw}" is not a recognised date — using the default`);
  }
  if (issue && due && due < issue) warn(ctx, 'due_date', 'Due date is before the invoice date');

  const clientName = h('client_name').replace(/\s+/g, ' ');
  if (!clientName) err(ctx, 'client_name', 'Client name is required');
  const gstin = readGstin(ctx, h('client_gstin'), 'client_gstin');

  // ── Money columns ──────────────────────────────────────────
  const total = readNumber(ctx, K, h('total'), 'total', { min: 0 });
  let taxable = readNumber(ctx, K, h('taxable_value'), 'taxable_value', { min: 0 });
  const cgst = readNumber(ctx, K, h('cgst'), 'cgst', { min: 0 });
  const sgst = readNumber(ctx, K, h('sgst'), 'sgst', { min: 0 });
  const igst = readNumber(ctx, K, h('igst'), 'igst', { min: 0 });
  const taxCol = readNumber(ctx, K, h('tax_amount'), 'tax_amount', { min: 0 });
  const rateCol = readNumber(ctx, K, h('tax_rate'), 'tax_rate', { min: 0, max: 100 });
  let paid = readNumber(ctx, K, h('amount_paid'), 'amount_paid', { min: 0 });
  const balance = readNumber(ctx, K, h('balance_due'), 'balance_due', { min: 0 });
  const splitTax = cgst !== undefined || sgst !== undefined || igst !== undefined
    ? round2((cgst ?? 0) + (sgst ?? 0) + (igst ?? 0))
    : undefined;
  let tax = taxCol ?? splitTax;

  // ── Line items ─────────────────────────────────────────────
  const items: InvoiceItem[] = [];
  const hasLineCols = (mapping.item_name ?? -1) >= 0 || (mapping.item_rate ?? -1) >= 0;
  if (hasLineCols) {
    for (const r of rowsOfGroup) {
      const iname = cellOf(mapping, r, 'item_name');
      const irateRaw = cellOf(mapping, r, 'item_rate');
      if (!iname && !irateRaw) continue;
      const qty = readNumber(ctx, K, cellOf(mapping, r, 'item_qty'), 'item_qty', { min: 0 }) ?? 1;
      const irate = readNumber(ctx, K, irateRaw, 'item_rate', { min: 0 }) ?? 0;
      const itax = readNumber(ctx, K, cellOf(mapping, r, 'item_tax_rate'), 'item_tax_rate', { min: 0, max: 100 });
      const hsn = readHsn(ctx, cellOf(mapping, r, 'item_hsn'), 'item_hsn');
      const unit = normalizeUnit(cellOf(mapping, r, 'item_unit'));
      items.push({
        id: generateId(),
        name: iname || 'Item',
        description: '',
        type: readItemType('', hsn),
        hsn,
        unit,
        quantity: qty,
        rate: irate,
        tax_rate: itax ?? rateCol ?? undefined,
        discount_percent: 0,
        amount: round2(qty * irate),
      });
    }
  }

  // ── Reconcile header amounts when there are no lines ───────
  let headerRate = rateCol;
  if (items.length === 0) {
    if (total === undefined && taxable === undefined) {
      err(ctx, 'total', 'Needs an invoice total or taxable value');
    } else {
      if (total !== undefined) {
        if (taxable === undefined) {
          if (tax !== undefined) taxable = round2(total - tax);
          else if (headerRate !== undefined) taxable = round2(total / (1 + headerRate / 100));
          else {
            taxable = total;
            tax = 0;
            if ((mapping.tax_amount ?? -1) < 0 && splitTax === undefined) {
              warn(ctx, 'tax_amount', 'No tax columns mapped — treated as a tax-free invoice');
            }
          }
        } else if (tax === undefined) {
          tax = Math.max(round2(total - taxable), 0);
        }
      } else if (taxable !== undefined && tax === undefined) {
        tax = headerRate !== undefined ? round2((taxable * headerRate) / 100) : 0;
      }
      const t = taxable ?? 0;
      if (t < 0) err(ctx, 'taxable_value', 'Taxable value works out negative — check the tax/total columns');
      if (headerRate === undefined) headerRate = t > 0 ? snapSlab(((tax ?? 0) / t) * 100) : 0;
      items.push({
        id: generateId(),
        name: `Opening balance — ${number}`,
        description: '',
        type: 'Service',
        hsn: '',
        unit: '',
        quantity: 1,
        rate: Math.max(t, 0),
        tax_rate: headerRate,
        discount_percent: 0,
        amount: Math.max(t, 0),
      });
    }
  }
  if (ctx.issues.some((i) => i.level === 'error')) return null;

  // ── Place of supply & tax mode ─────────────────────────────
  const existingClient = findClient(clientIndex, clientName, gstin);
  const clientState = readState(ctx, '', gstin || existingClient?.gstin || '', 'client_gstin');
  const posRaw = h('place_of_supply');
  const posState = posRaw ? readState(ctx, posRaw, gstin, 'place_of_supply') : undefined;
  const pos =
    posState?.code ??
    clientState?.code ??
    existingClient?.state_code ??
    '';
  const place = pos || options.senderStateCode;

  const hasTax =
    (tax ?? 0) > 0 || items.some((i) => (i.tax_rate ?? 0) > 0) || (headerRate ?? 0) > 0;
  let gst_mode: InvoiceRecord['gst_mode'] = 'NONE';
  if (hasTax) {
    if ((igst ?? 0) > 0) gst_mode = 'IGST';
    else if ((cgst ?? 0) > 0 || (sgst ?? 0) > 0) gst_mode = 'CGST_SGST';
    else {
      gst_mode = deriveGstMode({
        senderStateCode: options.senderStateCode,
        placeOfSupply: place,
        senderHasGstin: true,
        taxEnabled: true,
      });
    }
  }

  // ── Totals through the real calculator ─────────────────────
  const calcWith = (round_off_enabled: boolean, other_charges: number) =>
    calculateInvoice({
      items,
      gst_mode,
      discount_type: 'AMOUNT',
      discount_rate: 0,
      tax_rate: 0,
      shipping: 0,
      other_charges,
      round_off_enabled,
      amount_paid: 0,
    });
  let useRound = true;
  let other = 0;
  let totals = calcWith(true, 0);
  const given = total;
  if (given !== undefined) {
    if (totals.total !== given) {
      const plain = calcWith(false, 0);
      if (plain.total === given) {
        useRound = false;
        totals = plain;
      } else {
        const diff = round2(given - plain.total);
        useRound = false;
        other = diff;
        totals = calcWith(false, diff);
        if (Math.abs(diff) >= 1) {
          warn(
            ctx,
            'total',
            `Line items add up to ${plain.total.toFixed(2)} but the file says ${given.toFixed(2)} — the ${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)} difference is kept as an adjustment so the total matches`,
          );
        }
      }
    }
  }

  // ── Payment & status ───────────────────────────────────────
  const finalTotal = totals.total;
  const statusText = h('status');
  let status = statusFromText(statusText);
  if (statusText && !status) warn(ctx, 'status', `Status "${statusText}" was not recognised — derived from the amounts`);
  if (paid === undefined) {
    if (balance !== undefined) paid = Math.max(round2(finalTotal - balance), 0);
    else if (status === 'Paid') paid = finalTotal;
    else paid = 0;
  }
  if (paid > finalTotal) {
    warn(ctx, 'amount_paid', 'Amount received is more than the invoice total — capped at the total');
    paid = finalTotal;
  }
  if (status !== 'Cancelled' && status !== 'Draft') {
    if (finalTotal > 0 && paid >= finalTotal) status = 'Paid';
    else if (paid > 0) status = 'Partially Paid';
    else if (status === 'Paid' || status === 'Partially Paid' || !status) status = 'Sent';
  }
  if (!status) status = 'Sent';

  // ── Client snapshot ────────────────────────────────────────
  const client: Client = {
    ...blankClient(),
    ...(existingClient ?? {}),
    name: existingClient?.name || clientName,
    ...(gstin && !existingClient?.gstin ? { gstin } : {}),
  };
  if (!client.state_code && (posState || clientState)) {
    const st = clientState ?? posState;
    client.state_code = st?.code ?? '';
    client.state = st?.name ?? '';
  }

  const issueDate = issue ?? '';
  const raw: Partial<InvoiceRecord> = {
    id: generateId(),
    invoice_number: number,
    doc_type: 'INVOICE',
    issue_date: issueDate,
    due_date: due ?? (issueDate ? addDaysIso(issueDate, options.defaultDueDays) : ''),
    status,
    currency: 'INR',
    client,
    sender: options.sender,
    items,
    gst_mode,
    place_of_supply: place,
    reverse_charge: false,
    discount_type: 'AMOUNT',
    discount_rate: 0,
    tax_rate: 0,
    shipping: 0,
    other_charges: other,
    round_off_enabled: useRound,
    amount_paid: paid,
    notes: h('notes') || 'Imported opening invoice',
    terms: options.sender?.defaultTerms ?? '',
    po_number: h('po_number'),
  };
  const rec = normalizeRecord(raw, options.templateId ?? 'classic_orange');
  // normalizeRecord keeps what we gave it; the computed block comes from the calculator.
  rec.round_off_enabled = useRound;
  rec.other_charges = other;
  rec.amount_paid = paid;
  rec.subtotal = totals.subtotal;
  rec.discount_amount = totals.discount_amount;
  rec.taxable_value = totals.taxable_value;
  rec.cgst_amount = totals.cgst_amount;
  rec.sgst_amount = totals.sgst_amount;
  rec.igst_amount = totals.igst_amount;
  rec.tax_amount = totals.tax_amount;
  rec.round_off = totals.round_off;
  rec.total = totals.total;
  rec.balance_due = round2(totals.total - paid);
  rec.items = items.map((it, i) => ({ ...it, amount: totals.lines[i]?.gross ?? it.amount }));
  return rec;
}

/* ══════════════════════════════════════════════════════════════
   Preview / dry run
   ══════════════════════════════════════════════════════════════ */

function summarize(rows: PreviewRow[]): PreviewSummary {
  const s: PreviewSummary = { total: rows.length, create: 0, update: 0, skip: 0, error: 0, warnings: 0 };
  for (const r of rows) {
    s[r.action]++;
    s.warnings += r.issues.filter((i) => i.level === 'warning').length;
  }
  return s;
}

export interface PreviewParams {
  kind: ImportKind;
  table: ImportTable;
  mapping: ColumnMapping;
  existing: ExistingData;
  options?: Partial<ImportOptions>;
  /** Table row indexes the user chose to skip. */
  skipped?: ReadonlySet<number>;
  /** Spreadsheet line of the first data row (default 2). */
  firstDataLine?: number;
}

/** Validate every row and decide create / update / skip / error — writes nothing. */
export function buildPreview(params: PreviewParams): ImportPreview {
  const { kind, table, mapping, existing } = params;
  const options: ImportOptions = { ...DEFAULT_IMPORT_OPTIONS, ...(params.options ?? {}) };
  const skipped = params.skipped ?? new Set<number>();
  const line0 = params.firstDataLine ?? 2;
  const rows: PreviewRow[] = [];

  const finish = (row: PreviewRow) => {
    if (row.issues.some((i) => i.level === 'error')) row.action = 'error';
    rows.push(row);
  };
  const base = (i: number, issues: RowIssue[], lbl: string): PreviewRow => ({
    index: i,
    sourceIndexes: [i],
    line: i + line0,
    label: lbl,
    action: 'create',
    issues,
    record: null,
  });
  const isBlank = (r: string[]) => r.every((c) => c === '');

  if (kind === 'clients') {
    const idx = indexClients(existing.clients);
    const seenG = new Map<string, number>();
    const seenN = new Map<string, number>();
    table.rows.forEach((r, i) => {
      if (isBlank(r)) return;
      const issues: RowIssue[] = [];
      const ctx: RowCtx = { mapping, options, issues };
      const rec = buildClientRecord(r, ctx);
      const row = base(i, issues, rec?.name ?? cellOf(mapping, r, 'name') ?? '');
      row.record = rec;
      if (rec) {
        const g = rec.gstin ?? '';
        const prior = (g ? seenG.get(g) : undefined) ?? seenN.get(normName(rec.name));
        const match = findClient(idx, rec.name, g);
        if (prior !== undefined) {
          row.action = 'skip';
          row.skipReason = `Duplicate of row ${prior + line0} in this file`;
        } else if (match) {
          row.matchId = match.id;
          if (options.duplicateMode === 'update') {
            row.action = 'update';
            if (normName(match.name) !== normName(rec.name)) {
              warn(ctx, 'name', `Matched existing client "${match.name}" by GSTIN — its name is kept`);
            }
          } else {
            row.action = 'skip';
            row.skipReason = `Already exists as "${match.name}"`;
          }
        }
        if (g) seenG.set(g, i);
        seenN.set(normName(rec.name), i);
      }
      if (skipped.has(i)) {
        row.action = 'skip';
        row.skipReason = 'Skipped by you';
      }
      finish(row);
    });
  } else if (kind === 'items') {
    const seen = new Map<string, number>();
    table.rows.forEach((r, i) => {
      if (isBlank(r)) return;
      const issues: RowIssue[] = [];
      const ctx: RowCtx = { mapping, options, issues };
      const rec = buildItemRecord(r, ctx);
      const row = base(i, issues, rec?.name ?? cellOf(mapping, r, 'name') ?? '');
      row.record = rec;
      if (rec) {
        const key = itemKey(rec.name, rec.hsn);
        const match = findItem(existing.items, rec.name, rec.hsn ?? '');
        if (seen.has(key)) {
          row.action = 'skip';
          row.skipReason = `Duplicate of row ${seen.get(key)! + line0} in this file`;
        } else if (match) {
          row.matchId = match.id;
          if (options.duplicateMode === 'update') row.action = 'update';
          else {
            row.action = 'skip';
            row.skipReason = 'Item already in your catalogue';
          }
        }
        seen.set(key, i);
      }
      if (skipped.has(i)) {
        row.action = 'skip';
        row.skipReason = 'Skipped by you';
      }
      finish(row);
    });
  } else {
    const clientIndex = indexClients(existing.clients);
    const taken = new Set(existing.invoices.map((i) => (i.invoice_number ?? '').trim().toLowerCase()));
    const merging = (mapping.item_name ?? -1) >= 0 || (mapping.item_rate ?? -1) >= 0;
    const noNumber: number[] = [];
    const groups = new Map<string, InvoiceGroup>();
    const order: InvoiceGroup[] = [];
    const numCol = mapping.invoice_number ?? -1;
    table.rows.forEach((r, i) => {
      if (isBlank(r)) return;
      const n = numCol >= 0 ? (r[numCol] ?? '').trim() : '';
      if (!n) {
        noNumber.push(i);
        return;
      }
      const key = n.toLowerCase();
      const g = groups.get(key);
      if (g && merging) g.rows.push(i);
      else if (g) {
        // No line-item columns: a repeated number is a duplicate, not a second line.
        const issues: RowIssue[] = [{ level: 'warning', message: `Duplicate invoice number "${n}" in this file` }];
        const row = base(i, issues, n);
        row.action = 'skip';
        row.skipReason = `Duplicate of row ${g.rows[0] + line0} in this file`;
        rows.push(row);
      } else {
        const ng = { number: n, rows: [i] };
        groups.set(key, ng);
        order.push(ng);
      }
    });
    for (const i of noNumber) {
      const issues: RowIssue[] = [
        { level: 'error', field: 'invoice_number', message: 'Invoice number is required — opening invoices keep the number you give them' },
      ];
      const row = base(i, issues, '(no number)');
      row.action = 'error';
      rows.push(row);
    }
    for (const g of order) {
      const issues: RowIssue[] = [];
      const ctx: RowCtx = { mapping, options, issues };
      const rec = buildInvoiceRecord(g.rows.map((i) => table.rows[i]), ctx, clientIndex);
      const row = base(g.rows[0], issues, g.number);
      row.sourceIndexes = g.rows;
      row.record = rec;
      if (rec) {
        row.label = `${rec.invoice_number} · ${rec.client.name}`;
        if (taken.has(rec.invoice_number.trim().toLowerCase())) {
          row.action = 'skip';
          row.skipReason = 'Invoice number already exists — never overwritten';
          row.issues.push({ level: 'error', field: 'invoice_number', message: row.skipReason });
        }
      }
      if (skipped.has(g.rows[0])) {
        row.action = 'skip';
        row.skipReason = 'Skipped by you';
      }
      finish(row);
    }
    rows.sort((a, b) => a.index - b.index);
  }

  // A user "skip" always wins over a validation error: nothing is written either way.
  for (const r of rows) {
    if (skipped.has(r.index) && r.action === 'error') {
      r.action = 'skip';
      r.skipReason = 'Skipped by you';
    }
  }
  return { kind, rows, summary: summarize(rows) };
}

/** Dry-run report: exactly what `applyImport` would do, without touching storage. */
export function dryRunReport(preview: ImportPreview): ImportReport {
  const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: [] };
  for (const r of preview.rows) {
    if (r.action === 'create') report.created++;
    else if (r.action === 'update') report.updated++;
    else {
      report.skipped++;
      collectErrors(r, report);
    }
  }
  return report;
}

function collectErrors(r: PreviewRow, report: ImportReport) {
  if (r.action !== 'error') return;
  for (const i of r.issues) {
    if (i.level === 'error') report.errors.push({ line: r.line, label: r.label, message: i.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   Apply
   ══════════════════════════════════════════════════════════════ */

export interface ImportSink {
  /** Insert or merge clients. `matchId` points at the existing row to merge into. */
  clients(rows: { record: ClientDraft; matchId?: string }[]): void;
  items(rows: { record: CatalogDraft; matchId?: string }[]): void;
  /** Persist invoices as given; returns the ids actually written. */
  invoices(rows: InvoiceRecord[]): string[];
}

/**
 * Real sink on top of the same tables `localDb` uses. Each chunk is one
 * read-modify-write of the table (mirroring `localDb.clients.upsert`,
 * `localDb.items.upsert` and `localDb.invoices.save`) so 5,000 rows do not cost
 * 5,000 full JSON parses.
 */
export function createLocalSink(): ImportSink {
  return {
    clients(rows) {
      const all = getTable<Client>(KEYS.clients);
      const now = new Date().toISOString();
      for (const { record, matchId } of rows) {
        const at = matchId ? all.findIndex((c) => c.id === matchId) : -1;
        if (at >= 0) {
          all[at] = { ...all[at], ...record, name: all[at].name, id: all[at].id, updated_at: now };
        } else {
          all.push({ ...blankClient(), ...record, id: generateId(), created_at: now } as Client);
        }
      }
      setTable(KEYS.clients, all);
    },
    items(rows) {
      const all = getTable<InvoiceItem>(KEYS.items);
      for (const { record, matchId } of rows) {
        const at = matchId ? all.findIndex((i) => i.id === matchId) : -1;
        if (at >= 0) all[at] = { ...all[at], ...record, id: all[at].id, name: all[at].name };
        else all.push({ ...(record as InvoiceItem), id: generateId() });
      }
      setTable(KEYS.items, all);
    },
    invoices(rows) {
      const all = getTable<InvoiceRecord>(KEYS.invoices);
      const taken = new Set(all.map((i) => (i.invoice_number ?? '').trim().toLowerCase()));
      const clients = getTable<Client>(KEYS.clients);
      const idx = indexClients(clients);
      const now = new Date().toISOString();
      const written: string[] = [];
      let clientsChanged = false;
      for (const inv of rows) {
        const key = inv.invoice_number.trim().toLowerCase();
        if (taken.has(key)) continue; // never overwrite an existing number
        taken.add(key);
        const g = (inv.client.gstin ?? '').toUpperCase();
        let c = findClient(idx, inv.client.name, g);
        if (!c) {
          c = { ...blankClient(), ...inv.client, id: generateId(), created_at: now } as Client;
          clients.push(c);
          idx.byName.set(normName(c.name), c);
          if (g) idx.byGstin.set(g, c);
          clientsChanged = true;
        }
        const saved: InvoiceRecord = { ...inv, client: { ...inv.client, id: c.id }, created_at: now, updated_at: now };
        all.push(saved);
        written.push(saved.id);
      }
      setTable(KEYS.invoices, all);
      if (clientsChanged) setTable(KEYS.clients, clients);
      return written;
    },
  };
}

export interface ApplyOptions {
  chunkSize?: number;
  onProgress?: (done: number, total: number) => void;
  /** Awaited between chunks so the UI can repaint. Defaults to a macrotask. */
  yieldToUi?: () => Promise<void>;
  shouldCancel?: () => boolean;
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Write every create/update row through the sink, chunk by chunk. */
export async function applyImport(
  preview: ImportPreview,
  sink: ImportSink,
  options: ApplyOptions = {},
): Promise<ImportReport> {
  const chunk = Math.max(1, options.chunkSize ?? 250);
  const yieldToUi = options.yieldToUi ?? nextTask;
  const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: [] };
  const writable: PreviewRow[] = [];
  for (const r of preview.rows) {
    if (r.action === 'create' || r.action === 'update') writable.push(r);
    else {
      report.skipped++;
      collectErrors(r, report);
    }
  }

  let done = 0;
  for (let at = 0; at < writable.length; at += chunk) {
    if (options.shouldCancel?.()) {
      report.skipped += writable.length - at;
      break;
    }
    const slice = writable.slice(at, at + chunk);
    try {
      if (preview.kind === 'clients') {
        sink.clients(slice.map((r) => ({ record: r.record as ClientDraft, matchId: r.matchId })));
        for (const r of slice) {
          if (r.action === 'update') report.updated++;
          else report.created++;
        }
      } else if (preview.kind === 'items') {
        sink.items(slice.map((r) => ({ record: r.record as CatalogDraft, matchId: r.matchId })));
        for (const r of slice) {
          if (r.action === 'update') report.updated++;
          else report.created++;
        }
      } else {
        const written = new Set(sink.invoices(slice.map((r) => r.record as InvoiceRecord)));
        for (const r of slice) {
          if (written.has((r.record as InvoiceRecord).id)) report.created++;
          else {
            report.skipped++;
            report.errors.push({ line: r.line, label: r.label, message: 'Invoice number already exists — not overwritten' });
          }
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save to browser storage';
      for (const r of slice) {
        report.skipped++;
        report.errors.push({ line: r.line, label: r.label, message });
      }
    }
    done += slice.length;
    options.onProgress?.(done, writable.length);
    await yieldToUi();
  }
  return report;
}

/** CSV of every row that was not imported because of an error, with the reason appended. */
export function errorRowsCsv(table: ImportTable, preview: ImportPreview, firstDataLine = 2): string {
  const out: unknown[][] = [['Source row', ...table.headers, 'Import error']];
  for (const r of preview.rows) {
    const errs = r.issues.filter((i) => i.level === 'error').map((i) => i.message);
    if (r.action !== 'error') continue;
    for (const i of r.sourceIndexes) {
      out.push([i + firstDataLine, ...(table.rows[i] ?? []), errs.join(' | ')]);
    }
  }
  return writeCsv(out, { bom: true });
}

/** CSV rows for the report of an actual apply (errors from the engine + the sink). */
export function reportErrorsCsv(report: ImportReport): string {
  return writeCsv(
    [['Source row', 'Record', 'Problem'], ...report.errors.map((e) => [e.line, e.label, e.message])],
    { bom: true },
  );
}
