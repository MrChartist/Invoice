/**
 * TDS receivable register — what customers have withheld from us, quarter by
 * quarter, and whether it shows up in Form 26AS / AIS and on a Form 16A.
 *
 * Pure functions only (no React, no storage, no browser APIs) so everything
 * here runs under node:test. Inputs are the persisted `invoices`,
 * `transactions` (payments), `clients` and `tds_certificates` tables.
 *
 * Model
 *  - A TDS line is a live INR invoice (INVOICE / TAX_INVOICE, not Draft or
 *    Cancelled) with `tds_amount > 0`. It is bucketed by its issue date into the
 *    Indian FY quarter (Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar).
 *  - "Expected" is the TDS on every such invoice. "Settled" is the TDS on
 *    invoices whose cash part is fully received (status Paid, or payments +
 *    TDS >= total) — the same rule `receivables.ts` uses to clear the bill.
 *  - Form 16A is tracked per deductor (client) × quarter.
 *
 * These are working papers, not a substitute for TRACES. Verify with your CA.
 */

import type { Client, InvoiceRecord, Payment } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { isoDay } from './dates';
import { isLedgerDoc, isCreditNote, partyKeyOf } from './receivables';
import { parseTable, toCsv } from './csv';
import { scoreHeader } from './import-mapping';
import { parseDate, parseNumber } from './importers';
import { isValidTan } from './validators';
import { receivableTotal } from './rcm';
import { oldCodeOf } from './ita2025';

/* ── Periods ──────────────────────────────────────────────────── */

export type Quarter = 1 | 2 | 3 | 4;

export interface TdsPeriod {
  /** FY start year: FY 2025-26 → 2025. */
  fy: number;
  quarter: Quarter;
  /** Stable sort / lookup key, e.g. "2025-Q1". */
  key: string;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** FY quarter of a `YYYY-MM-DD` day, read as a calendar day (never via `new Date(str)`). */
export function tdsPeriodOf(day: string | undefined | null): TdsPeriod | null {
  const m = DAY_RE.exec(day ?? '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const fy = mo >= 4 ? y : y - 1;
  const quarter: Quarter = mo <= 3 ? 4 : mo <= 6 ? 1 : mo <= 9 ? 2 : 3;
  return { fy, quarter, key: periodKey(fy, quarter) };
}

export function periodKey(fy: number, quarter: Quarter): string {
  return `${fy}-Q${quarter}`;
}

/** "FY25-26" */
export function fyLabel(fy: number): string {
  return `FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}`;
}

const Q_MONTHS: Record<Quarter, string> = { 1: 'Apr–Jun', 2: 'Jul–Sep', 3: 'Oct–Dec', 4: 'Jan–Mar' };

/** "Q1 (Apr–Jun)" */
export function quarterLabel(quarter: Quarter): string {
  return `Q${quarter} (${Q_MONTHS[quarter]})`;
}

/** Inclusive first / last day of a quarter. */
export function quarterRange(fy: number, quarter: Quarter): { from: string; to: string } {
  switch (quarter) {
    case 1: return { from: `${fy}-04-01`, to: `${fy}-06-30` };
    case 2: return { from: `${fy}-07-01`, to: `${fy}-09-30` };
    case 3: return { from: `${fy}-10-01`, to: `${fy}-12-31` };
    default: return { from: `${fy + 1}-01-01`, to: `${fy + 1}-03-31` };
  }
}

/**
 * Last day the deductor should issue Form 16A: 15 days after the TDS return due
 * date (31 Jul, 31 Oct, 31 Jan, 31 May) → 15 Aug, 15 Nov, 15 Feb, 15 Jun.
 */
export function form16aDueDate(fy: number, quarter: Quarter): string {
  switch (quarter) {
    case 1: return `${fy}-08-15`;
    case 2: return `${fy}-11-15`;
    case 3: return `${fy + 1}-02-15`;
    default: return `${fy + 1}-06-15`;
  }
}

/** Ordinal for adjacency checks: consecutive quarters differ by 1. */
function periodIndex(p: Pick<TdsPeriod, 'fy' | 'quarter'>): number {
  return p.fy * 4 + (p.quarter - 1);
}

/* ── Identity helpers ─────────────────────────────────────────── */

export function normalizeTan(value: string | undefined | null): string {
  return (value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

const NAME_NOISE = new Set([
  'm', 's', 'ms', 'messrs', 'the', 'pvt', 'private', 'ltd', 'limited', 'llp', 'co', 'company',
  'inc', 'corp', 'corporation', 'opc',
]);

/** "M/s. Bharat Traders Pvt. Ltd." and "BHARAT TRADERS" both → "bharattraders". */
export function normalizeDeductorName(value: string | undefined | null): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !NAME_NOISE.has(t))
    .join('');
}

/** Section codes compare loosely: "194J", "194-J", "194JB" ~ "194J". */
function normSection(s: string | undefined): string {
  return (s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function sameSection(a: string, b: string): boolean {
  const x = normSection(a);
  const y = normSection(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/* ── Book side: one line per invoice that carries TDS ─────────── */

export interface TdsInvoiceLine {
  invoiceId: string;
  number: string;
  /** Issue date, YYYY-MM-DD. */
  date: string;
  fy: number;
  quarter: Quarter;
  periodKey: string;
  partyKey: string;
  partyName: string;
  pan: string;
  tan: string;
  section: string;
  taxable: number;
  total: number;
  tds: number;
  /** Cash part fully received, so the deduction has certainly happened. */
  settled: boolean;
}

export interface TdsCertificate {
  /** `certKey(party_key, fy, quarter)` — one row per deductor × quarter. */
  id: string;
  party_key: string;
  party_name: string;
  fy: number;
  quarter: Quarter;
  received: boolean;
  /** YYYY-MM-DD */
  received_on?: string;
  certificate_no?: string;
  updated_at?: string;
}

export const TDS_CERT_TABLE = 'tds_certificates';

export interface TdsInput {
  invoices: InvoiceRecord[];
  payments?: Payment[];
  clients?: Client[];
  certificates?: TdsCertificate[];
  /**
   * Additive (R5-A5): expected TDS that is not on an invoice — e.g. 194-O deducted by an e-commerce operator, from
   * imported settlements (`marketplace/tcs-credit.ts`). Register and 26AS reconciliation treat them like invoice lines.
   */
  extraExpected?: TdsExpectedLine[];
}

/** R5-A5: a non-invoice expected TDS line (`invoiceId` = the source record id, `number` = its reference). */
export type TdsExpectedLine = TdsInvoiceLine;

export function tdsInvoiceLines(input: TdsInput): TdsInvoiceLine[] {
  const clients = input.clients ?? [];
  const byId = new Map(clients.filter((c) => c.id).map((c) => [c.id as string, c]));
  const paidRows = new Map<string, number>();
  for (const p of input.payments ?? []) {
    if (!p?.invoice_id) continue;
    paidRows.set(p.invoice_id, round2((paidRows.get(p.invoice_id) ?? 0) + num(p.amount)));
  }

  const out: TdsInvoiceLine[] = [];
  for (const inv of input.invoices ?? []) {
    if (!inv || !isLedgerDoc(inv) || isCreditNote(inv)) continue;
    if ((inv.currency || 'INR').toUpperCase() !== 'INR') continue;
    const total = round2(receivableTotal(inv));
    const tds = round2(Math.min(Math.max(num(inv.tds_amount), 0), total));
    if (tds <= 0) continue;
    const date = isoDay(inv.issue_date) || isoDay(inv.created_at);
    const period = tdsPeriodOf(date);
    if (!period) continue;

    const partyKey = partyKeyOf(inv.client, clients);
    const master = byId.get(partyKey);
    const cash = Math.max(paidRows.get(inv.id) ?? 0, num(inv.amount_paid));
    const settled = inv.status === 'Paid' || round2(cash + tds) >= round2(total - 0.004);

    out.push({
      invoiceId: inv.id,
      number: inv.invoice_number,
      date,
      fy: period.fy,
      quarter: period.quarter,
      periodKey: period.key,
      partyKey,
      partyName: master?.name || inv.client?.name || 'Unknown party',
      pan: (master?.pan || inv.client?.pan || '').toUpperCase(),
      tan: normalizeTan(master?.tan || inv.client?.tan),
      section: (inv.tds_section ?? '').trim(),
      taxable: round2(num(inv.taxable_value)),
      total,
      tds,
      settled,
    });
  }
  for (const l of input.extraExpected ?? []) if (l && l.tds > 0 && tdsPeriodOf(l.date)) out.push(l); // R5-A5
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number.localeCompare(b.number)));
}

/* ── Register ─────────────────────────────────────────────────── */

export type CertStatus = 'received' | 'awaited' | 'overdue';

export interface TdsRegisterRow {
  /** `${periodKey}|${partyKey}|${section}` */
  key: string;
  fy: number;
  quarter: Quarter;
  periodKey: string;
  partyKey: string;
  partyName: string;
  pan: string;
  tan: string;
  section: string;
  invoiceCount: number;
  taxable: number;
  total: number;
  tdsExpected: number;
  tdsSettled: number;
  tdsPending: number;
  certificate: CertStatus;
  invoices: TdsInvoiceLine[];
}

export interface TdsTotals {
  invoiceCount: number;
  taxable: number;
  total: number;
  tdsExpected: number;
  tdsSettled: number;
  tdsPending: number;
}

export interface TdsQuarterBlock extends TdsPeriod {
  label: string;
  certDue: string;
  rows: TdsRegisterRow[];
  totals: TdsTotals;
  /** Distinct deductors in the quarter and how many Form 16A are in hand. */
  deductors: number;
  certificatesReceived: number;
  certificatesOverdue: number;
}

export interface TdsRegister {
  rows: TdsRegisterRow[];
  /** Newest quarter first. */
  quarters: TdsQuarterBlock[];
  totals: TdsTotals;
  /** FY start years with data, newest first. */
  fys: number[];
}

export function certKey(partyKey: string, fy: number, quarter: Quarter): string {
  return `${partyKey}|${periodKey(fy, quarter)}`;
}

function emptyTotals(): TdsTotals {
  return { invoiceCount: 0, taxable: 0, total: 0, tdsExpected: 0, tdsSettled: 0, tdsPending: 0 };
}

function addTotals(t: TdsTotals, r: Pick<TdsRegisterRow, 'invoiceCount' | 'taxable' | 'total' | 'tdsExpected' | 'tdsSettled' | 'tdsPending'>): void {
  t.invoiceCount += r.invoiceCount;
  t.taxable = round2(t.taxable + r.taxable);
  t.total = round2(t.total + r.total);
  t.tdsExpected = round2(t.tdsExpected + r.tdsExpected);
  t.tdsSettled = round2(t.tdsSettled + r.tdsSettled);
  t.tdsPending = round2(t.tdsPending + r.tdsPending);
}

export function certificateStatus(
  cert: Pick<TdsCertificate, 'received'> | undefined,
  fy: number,
  quarter: Quarter,
  today: string,
): CertStatus {
  if (cert?.received) return 'received';
  return today > form16aDueDate(fy, quarter) ? 'overdue' : 'awaited';
}

export interface RegisterOptions {
  /** Today as YYYY-MM-DD (defaults to the local day). */
  today?: string;
  /** Restrict to one FY (start year). */
  fy?: number;
}

export function buildTdsRegister(input: TdsInput, opts: RegisterOptions = {}): TdsRegister {
  const today = opts.today || isoDay(new Date());
  const all = tdsInvoiceLines(input);
  const fys = [...new Set(all.map((l) => l.fy))].sort((a, b) => b - a);
  const lines = opts.fy === undefined ? all : all.filter((l) => l.fy === opts.fy);
  const certs = new Map((input.certificates ?? []).map((c) => [c.id || certKey(c.party_key, c.fy, c.quarter), c]));

  const rowMap = new Map<string, TdsRegisterRow>();
  for (const l of lines) {
    const key = `${l.periodKey}|${l.partyKey}|${normSection(l.section)}`;
    let row = rowMap.get(key);
    if (!row) {
      row = {
        key, fy: l.fy, quarter: l.quarter, periodKey: l.periodKey,
        partyKey: l.partyKey, partyName: l.partyName, pan: l.pan, tan: l.tan, section: l.section,
        invoiceCount: 0, taxable: 0, total: 0, tdsExpected: 0, tdsSettled: 0, tdsPending: 0,
        certificate: certificateStatus(certs.get(certKey(l.partyKey, l.fy, l.quarter)), l.fy, l.quarter, today),
        invoices: [],
      };
      rowMap.set(key, row);
    }
    row.invoices.push(l);
    row.invoiceCount += 1;
    row.taxable = round2(row.taxable + l.taxable);
    row.total = round2(row.total + l.total);
    row.tdsExpected = round2(row.tdsExpected + l.tds);
    if (l.settled) row.tdsSettled = round2(row.tdsSettled + l.tds);
    else row.tdsPending = round2(row.tdsPending + l.tds);
    if (!row.pan && l.pan) row.pan = l.pan;
    if (!row.tan && l.tan) row.tan = l.tan;
  }

  const rows = [...rowMap.values()].sort((a, b) =>
    a.periodKey !== b.periodKey
      ? (a.periodKey < b.periodKey ? 1 : -1)
      : a.partyName.localeCompare(b.partyName) || a.section.localeCompare(b.section));

  const blocks = new Map<string, TdsQuarterBlock>();
  const totals = emptyTotals();
  for (const r of rows) {
    let b = blocks.get(r.periodKey);
    if (!b) {
      b = {
        fy: r.fy, quarter: r.quarter, key: r.periodKey,
        label: `${quarterLabel(r.quarter)} ${fyLabel(r.fy)}`,
        certDue: form16aDueDate(r.fy, r.quarter),
        rows: [], totals: emptyTotals(), deductors: 0, certificatesReceived: 0, certificatesOverdue: 0,
      };
      blocks.set(r.periodKey, b);
    }
    b.rows.push(r);
    addTotals(b.totals, r);
    addTotals(totals, r);
  }
  for (const b of blocks.values()) {
    const seen = new Map<string, CertStatus>();
    for (const r of b.rows) seen.set(r.partyKey, r.certificate);
    b.deductors = seen.size;
    b.certificatesReceived = [...seen.values()].filter((s) => s === 'received').length;
    b.certificatesOverdue = [...seen.values()].filter((s) => s === 'overdue').length;
  }

  return { rows, quarters: [...blocks.values()], totals, fys };
}

/** Upsert / clear the Form 16A flag for one deductor × quarter (returns a new array). */
export function setCertificate(
  rows: TdsCertificate[],
  change: {
    partyKey: string; partyName: string; fy: number; quarter: Quarter;
    received: boolean; receivedOn?: string; certificateNo?: string;
  },
  nowIso: string = new Date().toISOString(),
): TdsCertificate[] {
  const id = certKey(change.partyKey, change.fy, change.quarter);
  const rest = (rows ?? []).filter((r) => (r.id || certKey(r.party_key, r.fy, r.quarter)) !== id);
  if (!change.received && !change.certificateNo) return rest;
  const row: TdsCertificate = {
    id, party_key: change.partyKey, party_name: change.partyName, fy: change.fy, quarter: change.quarter,
    received: change.received, updated_at: nowIso,
  };
  if (change.receivedOn) row.received_on = change.receivedOn;
  if (change.certificateNo) row.certificate_no = change.certificateNo.trim();
  return [...rest, row];
}

/* ── 26AS / AIS CSV ───────────────────────────────────────────── */

export interface TdsCredit {
  /** 1-based line in the file (header = its own line). */
  line: number;
  deductorName: string;
  tan: string;
  section: string;
  /** Transaction (payment / credit) date, YYYY-MM-DD. */
  date: string;
  fy: number;
  quarter: Quarter;
  periodKey: string;
  amountPaid: number;
  tds: number;
}

export type TdsCsvField = 'deductor_name' | 'tan' | 'section' | 'date' | 'amount_paid' | 'tds';

export const TDS_CSV_FIELDS: { key: TdsCsvField; label: string; required: boolean; synonyms: string[] }[] = [
  {
    key: 'deductor_name', label: 'Deductor name', required: false,
    synonyms: ['Name of Deductor', 'Deductor Name', 'Name of the Deductor', 'Deductor', 'Name of Deductor/Collector',
      'Deductor/Collector Name', 'Information Source', 'Information Source Name', 'Source Name', 'Party Name', 'Customer Name', 'Name'],
  },
  {
    key: 'tan', label: 'TAN', required: false,
    synonyms: ['TAN of Deductor', 'TAN', 'Deductor TAN', 'TAN of the Deductor', 'TAN of Deductor/Collector',
      'Information Source TAN', 'TAN Number', 'TAN No'],
  },
  {
    key: 'section', label: 'Section', required: false,
    synonyms: ['Section', 'Section Code', 'TDS Section', 'Section 1', 'Section of TDS', 'Nature of Payment', 'Section Description'],
  },
  {
    key: 'date', label: 'Transaction date', required: true,
    synonyms: ['Transaction Date', 'Date of Payment/Credit', 'Date of Payment / Credit', 'Date of Credit', 'Date of Payment',
      'Payment Date', 'Credit Date', 'Date of Transaction', 'Transaction Dt', 'Date'],
  },
  {
    key: 'amount_paid', label: 'Amount paid / credited', required: false,
    synonyms: ['Amount Paid/Credited', 'Amount Paid / Credited', 'Amount Paid or Credited', 'Amount Credited', 'Amount Paid',
      'Gross Amount', 'Transaction Amount', 'Amount of Transaction', 'Payment Amount', 'Amount'],
  },
  {
    key: 'tds', label: 'TDS deducted', required: true,
    synonyms: ['Tax Deducted', 'TDS Deducted', 'TDS Amount', 'Tax Deducted at Source', 'TDS', 'Amount of Tax Deducted',
      'Tax Deducted/Collected', 'TDS Deposited', 'Tax Deposited', 'TDS Credited', 'Tax Amount'],
  },
];

export type TdsCsvMapping = Partial<Record<TdsCsvField, number>>;

export interface TdsCsvResult {
  headers: string[];
  mapping: TdsCsvMapping;
  credits: TdsCredit[];
  /** Required columns that could not be found. */
  missing: string[];
  /** Data rows skipped, with the reason. Zero-TDS rows are skipped silently and only counted. */
  errors: { line: number; message: string }[];
  zeroRows: number;
}

const MIN_SCORE = 0.5;

/** Best header → field assignment (each column used once, highest score first). */
export function guessTdsMapping(headers: string[]): TdsCsvMapping {
  const cands: { field: TdsCsvField; col: number; score: number }[] = [];
  for (const f of TDS_CSV_FIELDS) {
    headers.forEach((h, col) => {
      const score = scoreHeader(h, f.synonyms);
      if (score >= MIN_SCORE) cands.push({ field: f.key, col, score });
    });
  }
  cands.sort((a, b) => b.score - a.score || a.col - b.col);
  const mapping: TdsCsvMapping = {};
  const used = new Set<number>();
  for (const c of cands) {
    if (mapping[c.field] !== undefined || used.has(c.col)) continue;
    mapping[c.field] = c.col;
    used.add(c.col);
  }
  return mapping;
}

const TAN_IN_TEXT = /\b([A-Z]{4}[0-9]{5}[A-Z])\b/;

/** "194J - Fees for professional services", "Sec 194-C", "194JB" → "194J" / "194C" / "194JB". */
export function sectionCode(raw: string): string {
  // Income-tax Act 2025 reference in a Form 168 / AIS export ("393(1) Table Sl. No. 6(iii)") → its 1961 family.
  const old = oldCodeOf(raw);
  if (old) return old;
  const m = /\b(19\d|206)\s*-?\s*([A-Z]{0,3})\b/i.exec(raw ?? '');
  if (m) return `${m[1]}${m[2]}`.toUpperCase();
  return (raw ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * Parse a Form 26AS (Part I) / AIS TDS export saved as CSV. Delimiter, BOM,
 * title rows above the header and header spellings are all tolerated. AIS's
 * "Information Source" column, which reads "ACME LTD (MUMA12345B)", yields
 * both the name and the TAN.
 */
export function parseTdsCsv(text: string, mappingOverride?: TdsCsvMapping): TdsCsvResult {
  const table = parseTable(text ?? '');
  const headers = table.headers;
  const mapping = mappingOverride ?? guessTdsMapping(headers);
  const missing: string[] = [];
  for (const f of TDS_CSV_FIELDS) if (f.required && mapping[f.key] === undefined) missing.push(f.label);
  if (mapping.deductor_name === undefined && mapping.tan === undefined) missing.push('Deductor name or TAN');

  const result: TdsCsvResult = { headers, mapping, credits: [], missing, errors: [], zeroRows: 0 };
  if (missing.length) return result;

  const cell = (row: string[], f: TdsCsvField) => (mapping[f] === undefined ? '' : (row[mapping[f] as number] ?? '').trim());
  table.rows.forEach((row, i) => {
    const line = table.headerIndex + i + 1;
    if (row.every((c) => c === '')) return;
    const rawName = cell(row, 'deductor_name');
    // Totals rows ("Total", "Grand Total") carry no date.
    if (/^(grand\s+)?total\b/i.test(rawName) || /^(grand\s+)?total\b/i.test(row[0] ?? '')) return;

    const tdsN = parseNumber(cell(row, 'tds'));
    if (!tdsN.ok) {
      result.errors.push({ line, message: `TDS amount "${cell(row, 'tds')}" is not a number` });
      return;
    }
    if (tdsN.value === null || Math.abs(tdsN.value) < 0.005) {
      result.zeroRows += 1;
      return;
    }
    const date = parseDate(cell(row, 'date'));
    const period = tdsPeriodOf(date);
    if (!date || !period) {
      result.errors.push({ line, message: `Unreadable transaction date "${cell(row, 'date')}"` });
      return;
    }

    let tan = normalizeTan(cell(row, 'tan'));
    if (!isValidTan(tan)) tan = TAN_IN_TEXT.exec(rawName.toUpperCase())?.[1] ?? '';
    const deductorName = rawName.replace(/\(\s*[A-Z]{4}[0-9]{5}[A-Z]\s*\)/i, '').trim();
    if (!tan && !normalizeDeductorName(deductorName)) {
      result.errors.push({ line, message: 'No deductor name or TAN' });
      return;
    }
    const paid = parseNumber(cell(row, 'amount_paid'));
    result.credits.push({
      line,
      deductorName: deductorName || tan,
      tan,
      section: sectionCode(cell(row, 'section')),
      date,
      fy: period.fy,
      quarter: period.quarter,
      periodKey: period.key,
      amountPaid: round2(paid.value ?? 0),
      tds: round2(tdsN.value),
    });
  });
  return result;
}

/* ── Reconciliation ───────────────────────────────────────────── */

export interface TdsMatch {
  /** `line`: one credit ↔ one invoice. `group`: deductor × quarter totals agree. */
  kind: 'line' | 'group';
  /** Matched to an invoice in the neighbouring quarter (deducted on payment, not on credit). */
  quarterShift: boolean;
  partyKey: string;
  partyName: string;
  fy: number;
  quarter: Quarter;
  credits: TdsCredit[];
  invoices: TdsInvoiceLine[];
  tds26as: number;
  tdsBooks: number;
  /** 26AS − books. */
  diff: number;
}

export interface TdsUnmatchedCredit extends TdsCredit {
  /** The client this credit was attributed to, if any. */
  partyKey: string;
  partyName: string;
  known: boolean;
}

export interface TdsRecon {
  matched: TdsMatch[];
  only26as: TdsUnmatchedCredit[];
  onlyBooks: TdsInvoiceLine[];
  totals: {
    tds26as: number;
    tdsBooks: number;
    matched26as: number;
    matchedBooks: number;
    only26as: number;
    onlyBooks: number;
  };
}

export interface ReconOptions {
  /** Rupee tolerance per line (default ₹1 — 26AS rounds to the rupee). */
  tolerance?: number;
  /** Only compare these FYs (start years); default: every FY the 26AS file covers. */
  fys?: number[];
}

interface PartyIndex {
  byTan: Map<string, { key: string; name: string }>;
  byName: Map<string, { key: string; name: string }>;
}

function indexParties(clients: Client[], lines: TdsInvoiceLine[]): PartyIndex {
  const byTan = new Map<string, { key: string; name: string }>();
  const byName = new Map<string, { key: string; name: string }>();
  const add = (key: string, name: string, tan: string | undefined, alt?: string) => {
    const t = normalizeTan(tan);
    if (t && !byTan.has(t)) byTan.set(t, { key, name });
    for (const n of [name, alt]) {
      const nk = normalizeDeductorName(n);
      if (nk && !byName.has(nk)) byName.set(nk, { key, name });
    }
  };
  for (const l of lines) add(l.partyKey, l.partyName, l.tan);
  for (const c of clients) add(partyKeyOf(c, clients), c.name, c.tan, c.company);
  return { byTan, byName };
}

function resolveParty(c: TdsCredit, idx: PartyIndex): { key: string; name: string; known: boolean } {
  const hit = (c.tan && idx.byTan.get(c.tan)) || idx.byName.get(normalizeDeductorName(c.deductorName));
  if (hit) return { ...hit, known: true };
  return { key: `26as:${c.tan || normalizeDeductorName(c.deductorName)}`, name: c.deductorName, known: false };
}

const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

/**
 * Match 26AS / AIS credits to invoices that carry TDS.
 *  1. Same deductor + same quarter, one credit ↔ one invoice whose TDS is within
 *     the tolerance (same section preferred, then the closest amount).
 *  2. Same deductor + quarter, what is left on both sides agrees in total →
 *     one group match (a deductor that books several invoices in one entry).
 *  3. Same deductor, neighbouring quarter, line-level → `quarterShift` match.
 * Anything else is reported as only-in-26AS or only-in-books.
 */
export function reconcileTds(
  credits: TdsCredit[],
  input: TdsInput,
  opts: ReconOptions = {},
): TdsRecon {
  const tol = Math.max(opts.tolerance ?? 1, 0);
  const clients = input.clients ?? [];
  const allLines = tdsInvoiceLines(input);
  const fys = new Set(opts.fys ?? credits.map((c) => c.fy));
  const lines = allLines.filter((l) => fys.has(l.fy));
  const idx = indexParties(clients, allLines);

  const resolved = credits.map((c) => ({ c, party: resolveParty(c, idx) }));
  const usedCredit = new Set<TdsCredit>();
  const usedLine = new Set<TdsInvoiceLine>();
  const matched: TdsMatch[] = [];

  const pick = (c: TdsCredit, pool: TdsInvoiceLine[]): TdsInvoiceLine | undefined => {
    let best: TdsInvoiceLine | undefined;
    let bestScore = Infinity;
    for (const l of pool) {
      if (usedLine.has(l)) continue;
      const d = Math.abs(l.tds - c.tds);
      if (d > tol + 1e-9) continue;
      // Lower is better: section mismatch costs most, then TDS gap, then base gap.
      const base = c.amountPaid > 0 ? Math.min(Math.abs(l.taxable - c.amountPaid), Math.abs(l.total - c.amountPaid)) : 0;
      const score = (c.section && l.section && !sameSection(c.section, l.section) ? 1e9 : 0) + d * 1e4 + base;
      if (score < bestScore) {
        bestScore = score;
        best = l;
      }
    }
    return best;
  };

  const lineMatch = (c: TdsCredit, l: TdsInvoiceLine, party: { key: string; name: string }, shift: boolean) => {
    usedCredit.add(c);
    usedLine.add(l);
    matched.push({
      kind: 'line', quarterShift: shift, partyKey: party.key, partyName: party.name,
      fy: l.fy, quarter: l.quarter, credits: [c], invoices: [l],
      tds26as: c.tds, tdsBooks: l.tds, diff: round2(c.tds - l.tds),
    });
  };

  // Group both sides by deductor × quarter.
  const groupKey = (party: string, period: string) => `${party}|${period}`;
  const linesByGroup = new Map<string, TdsInvoiceLine[]>();
  for (const l of lines) {
    const k = groupKey(l.partyKey, l.periodKey);
    linesByGroup.set(k, [...(linesByGroup.get(k) ?? []), l]);
  }
  const creditsByGroup = new Map<string, typeof resolved>();
  for (const r of resolved) {
    const k = groupKey(r.party.key, r.c.periodKey);
    creditsByGroup.set(k, [...(creditsByGroup.get(k) ?? []), r]);
  }

  // Pass 1 + 2.
  for (const [k, group] of creditsByGroup) {
    const pool = linesByGroup.get(k) ?? [];
    const sorted = [...group].sort((a, b) => b.c.tds - a.c.tds || a.c.line - b.c.line);
    for (const { c, party } of sorted) {
      const l = pick(c, pool);
      if (l) lineMatch(c, l, party, false);
    }
    const leftC = group.filter((r) => !usedCredit.has(r.c));
    const leftL = pool.filter((l) => !usedLine.has(l));
    if (leftC.length && leftL.length) {
      const a = sum(leftC.map((r) => r.c.tds));
      const b = sum(leftL.map((l) => l.tds));
      if (Math.abs(a - b) <= tol * Math.max(leftC.length, leftL.length) + 1e-9) {
        leftC.forEach((r) => usedCredit.add(r.c));
        leftL.forEach((l) => usedLine.add(l));
        matched.push({
          kind: 'group', quarterShift: false, partyKey: leftC[0].party.key, partyName: leftC[0].party.name,
          fy: leftL[0].fy, quarter: leftL[0].quarter, credits: leftC.map((r) => r.c), invoices: leftL,
          tds26as: a, tdsBooks: b, diff: round2(a - b),
        });
      }
    }
  }

  // Pass 3: neighbouring quarter, same deductor, line-level. Looks at every
  // book line (not only the FYs in the file) so a 1 April deduction can meet a
  // 31 March invoice.
  for (const { c, party } of resolved) {
    if (usedCredit.has(c)) continue;
    const ci = periodIndex(c);
    const pool = allLines.filter((l) => l.partyKey === party.key && Math.abs(periodIndex(l) - ci) === 1);
    const l = pick(c, pool);
    if (l) lineMatch(c, l, party, true);
  }

  const only26as: TdsUnmatchedCredit[] = resolved
    .filter((r) => !usedCredit.has(r.c))
    .map((r) => ({ ...r.c, partyKey: r.party.key, partyName: r.party.name, known: r.party.known }));
  const onlyBooks = lines.filter((l) => !usedLine.has(l));

  matched.sort((a, b) =>
    a.fy !== b.fy ? b.fy - a.fy : a.quarter !== b.quarter ? b.quarter - a.quarter : a.partyName.localeCompare(b.partyName));

  return {
    matched,
    only26as,
    onlyBooks,
    totals: {
      tds26as: sum(credits.map((c) => c.tds)),
      tdsBooks: sum(lines.map((l) => l.tds)),
      matched26as: sum(matched.map((m) => m.tds26as)),
      matchedBooks: sum(matched.map((m) => m.tdsBooks)),
      only26as: sum(only26as.map((c) => c.tds)),
      onlyBooks: sum(onlyBooks.map((l) => l.tds)),
    },
  };
}

/* ── CSV exports ──────────────────────────────────────────────── */

const CERT_LABEL: Record<CertStatus, string> = { received: 'Received', awaited: 'Awaited', overdue: 'Overdue' };

export function certStatusLabel(s: CertStatus): string {
  return CERT_LABEL[s];
}

export function tdsRegisterCsv(reg: TdsRegister): string {
  const rows: unknown[][] = [[
    'FY', 'Quarter', 'Deductor', 'PAN', 'TAN', 'Section', 'Invoices', 'Taxable value', 'Invoice total',
    'TDS expected', 'TDS settled', 'TDS pending', 'Form 16A',
  ]];
  for (const r of reg.rows) {
    rows.push([
      fyLabel(r.fy), `Q${r.quarter}`, r.partyName, r.pan, r.tan, r.section, r.invoiceCount, r.taxable, r.total,
      r.tdsExpected, r.tdsSettled, r.tdsPending, CERT_LABEL[r.certificate],
    ]);
  }
  rows.push(['Total', '', '', '', '', '', reg.totals.invoiceCount, reg.totals.taxable, reg.totals.total,
    reg.totals.tdsExpected, reg.totals.tdsSettled, reg.totals.tdsPending, '']);
  rows.push([]);
  rows.push(['Working paper prepared from your invoices. Verify with your CA and TRACES before filing.']);
  return toCsv(rows);
}

export function tdsReconCsv(rec: TdsRecon): string {
  const rows: unknown[][] = [[
    'Result', 'FY', 'Quarter', 'Deductor', 'TAN', 'Section', '26AS date', 'Invoice(s)', '26AS amount paid',
    '26AS TDS', 'Books TDS', 'Difference', 'Note',
  ]];
  for (const m of rec.matched) {
    rows.push([
      'Matched', fyLabel(m.fy), `Q${m.quarter}`, m.partyName, m.credits[0]?.tan ?? '',
      m.credits.map((c) => c.section).filter(Boolean).join(' / '), m.credits.map((c) => c.date).join(' / '),
      m.invoices.map((l) => l.number).join(' / '), sum(m.credits.map((c) => c.amountPaid)),
      m.tds26as, m.tdsBooks, m.diff,
      [m.kind === 'group' ? 'Quarter total' : '', m.quarterShift ? 'Different quarter' : ''].filter(Boolean).join('; '),
    ]);
  }
  for (const c of rec.only26as) {
    rows.push(['Only in 26AS', fyLabel(c.fy), `Q${c.quarter}`, c.partyName, c.tan, c.section, c.date, '',
      c.amountPaid, c.tds, '', c.tds, c.known ? 'No matching invoice' : 'Deductor not in your clients']);
  }
  for (const l of rec.onlyBooks) {
    rows.push(['Only in books', fyLabel(l.fy), `Q${l.quarter}`, l.partyName, l.tan, l.section, '', l.number,
      '', '', l.tds, -l.tds, l.settled ? 'Paid: ask the customer to file / correct their TDS return' : 'Invoice not fully paid yet']);
  }
  rows.push([]);
  rows.push(['Working paper, not validated against TRACES. Verify with your CA.']);
  return toCsv(rows);
}
