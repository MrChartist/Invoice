/**
 * Bank reconciliation (Tally BRS / Zoho Banking) — pure engine + thin storage.
 *
 *  1. `parseBankStatement`  CSV text -> normalised lines (HDFC / ICICI / SBI / Axis / Kotak
 *                           and generic layouts, junk header/footer rows skipped).
 *  2. `suggestMatches`      ranks book entries (payments received / purchase payments) against
 *                           statement lines with a 0-100 confidence. NOTHING here ever writes:
 *                           the UI applies a suggestion only when the user presses Confirm.
 *  3. `buildBrs`            the Bank Reconciliation Statement (books -> bank).
 *
 * Everything above the "Storage" divider is pure (no React, no DOM, no storage) so it is unit-tested
 * with messy real-world narrations. Dates are local `YYYY-MM-DD` strings (see dates.ts).
 *
 * Persisted table `bank_statements` is additive-only: `BankStatement` / `BankLine` may only gain
 * optional fields.
 */

import { parseCsvDetailed, toCsv } from './csv';
import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { readPurchase, isVoidStatus } from './purchase-normalize';
import { generateId, getTable, setTable } from './storage';
import type { InvoiceRecord, Payment } from '../types/invoice';

/* ════════════════════════════════════════════════════════════════
   Types
   ════════════════════════════════════════════════════════════════ */

export type MatchType = 'payment' | 'purchase_payment' | 'manual';

export interface LineMatch {
  type: MatchType;
  /** Primary book entry id (absent for `manual`). */
  id?: string;
  /** All book entry ids when one bank line settles several entries (e.g. one credit paying 2 invoices). */
  ids?: string[];
}

export interface BankLine {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  narration: string;
  /** Cheque / reference column as printed by the bank. */
  ref: string;
  debit: number;
  credit: number;
  balance?: number;
  matched_to?: LineMatch;
  ignored?: boolean;
  note?: string;
}

export interface BankStatement {
  id: string;
  /** ISO timestamp of the import. */
  imported_at: string;
  bank_label: string;
  file_name: string;
  lines: BankLine[];
  /** Additive: balance printed before the first line, when the file carries one. */
  opening_balance?: number;
  /** Additive: closing balance typed by the user when the file has no balance column. */
  closing_balance?: number;
}

export const STATEMENTS_TABLE = 'bank_statements';

/** Match confidence at/above which "Confirm all" applies a suggestion. */
export const BULK_CONFIRM_THRESHOLD = 90;
/** Default date tolerance between a statement line and a book entry. */
export const DATE_WINDOW_DAYS = 5;
const REF_DATE_WINDOW_DAYS = 15;
const AMOUNT_TOLERANCE = 0.01;

/* ════════════════════════════════════════════════════════════════
   Small helpers
   ════════════════════════════════════════════════════════════════ */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function validYmd(y: number, m: number, d: number): string {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200)) return '';
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return '';
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function fullYear(yy: number, digits: number): number {
  if (digits >= 4) return yy;
  return yy < 70 ? 2000 + yy : 1900 + yy;
}

/**
 * Parse a bank-statement date. Indian statements are day-first: `01/04/26`, `01-04-2026`,
 * `01-Apr-2026`, `1 April 26`, `2026-04-01`, with an optional time. Returns '' when it is not a date.
 */
export function parseBankDate(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  // drop a trailing time ("01/04/2026 10:22:33", "01-Apr-2026 10:22 PM")
  s = s.replace(/[T\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?$/, '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/. ]+([A-Za-z]{3,9})[-/. ,]+(\d{2,4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mon ? validYmd(fullYear(+m[3], m[3].length), mon, +m[1]) : '';
  }
  m = /^([A-Za-z]{3,9})[-/. ]+(\d{1,2}),?[-/. ]+(\d{2,4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mon ? validYmd(fullYear(+m[3], m[3].length), mon, +m[2]) : '';
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const d = +m[1];
    const mo = +m[2];
    const y = fullYear(+m[3], m[3].length);
    return validYmd(y, mo, d);
  }
  return '';
}

export interface ParsedAmount {
  /** Signed: negative for parentheses / leading or trailing minus. */
  value: number;
  /** Explicit Dr / Cr marker printed with the figure. */
  side?: 'Dr' | 'Cr';
}

/** `1,23,456.78`, `₹ 5,000.00 Dr`, `(250.00)`, `Rs. 99 CR`, `-1,000` -> number (+ side). null when not a number. */
export function parseBankAmount(raw: string): ParsedAmount | null {
  let s = String(raw ?? '').trim();
  if (!s || /^(-+|nil|n\/?a|null)$/i.test(s)) return null;
  let side: 'Dr' | 'Cr' | undefined;
  const sm = /(?:^|\s)(dr|cr)\.?$|^(dr|cr)\.?\s/i.exec(s) ?? /\d(dr|cr)\.?$/i.exec(s);
  if (sm) {
    const tag = (sm[1] ?? sm[2] ?? '').toLowerCase();
    side = tag === 'dr' ? 'Dr' : 'Cr';
    s = s.replace(/\s*\b(dr|cr)\b\.?\s*/gi, ' ').replace(/(\d)(dr|cr)\.?$/i, '$1').trim();
  }
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    neg = true;
    s = s.slice(1);
  } else if (s.endsWith('-')) {
    neg = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/₹|inr|rs\.?/gi, '').replace(/[,\s]/g, '');
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const value = parseFloat(s);
  if (!Number.isFinite(value)) return null;
  return { value: neg ? -value : value, side };
}

/** Upper-case words of a text (`UPI/BHARAT-TRADERS` -> ['UPI','BHARAT','TRADERS']). */
function words(text: string): string[] {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Upper-case, letters and digits only. */
function compact(text: string): string {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Whole calendar days between two ISO dates (b - a). */
export function dayDiff(a: string, b: string): number {
  const pa = /^(\d{4})-(\d{2})-(\d{2})/.exec(a);
  const pb = /^(\d{4})-(\d{2})-(\d{2})/.exec(b);
  if (!pa || !pb) return Number.POSITIVE_INFINITY;
  const ta = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const tb = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.round((tb - ta) / 86400000);
}

const lineAmount = (l: Pick<BankLine, 'debit' | 'credit'>) => (l.credit > 0 ? l.credit : l.debit);
export const isCredit = (l: Pick<BankLine, 'debit' | 'credit'>) => l.credit > 0 && !(l.debit > 0);

/* ════════════════════════════════════════════════════════════════
   1. CSV parsing — column auto-detection
   ════════════════════════════════════════════════════════════════ */

export type ColumnField = 'date' | 'valueDate' | 'narration' | 'ref' | 'debit' | 'credit' | 'amount' | 'drcr' | 'balance';

/** field -> column index (-1 / absent = not present). */
export type ColumnMap = Partial<Record<ColumnField, number>>;

export const COLUMN_FIELD_LABELS: Record<ColumnField, string> = {
  date: 'Date',
  valueDate: 'Value date',
  narration: 'Narration',
  ref: 'Cheque / reference',
  debit: 'Debit / withdrawal',
  credit: 'Credit / deposit',
  amount: 'Amount (signed or with Dr/Cr)',
  drcr: 'Dr / Cr indicator',
  balance: 'Balance',
};

function normHeader(h: string): string {
  return String(h ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ') // "(INR )"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Which statement field a header cell names (null when none). */
export function classifyHeader(header: string): ColumnField | null {
  const h = normHeader(header);
  if (!h) return null;
  if (/^(dr cr|cr dr|debit credit|credit debit|dr cr flag|cr dr indicator|txn type|transaction type|type)$/.test(h)) return 'drcr';
  if (/value (date|dt)|^val(ue)? dt$/.test(h)) return 'valueDate';
  if (/balance|^bal( |$)|running bal/.test(h)) return 'balance';
  if (/^(txn |tran |trans |transaction |posting |book(ing)? )?(date|dt)$/.test(h) || /^date( of)? (txn|transaction)/.test(h)) return 'date';
  if (/narration|description|particulars|remarks|transaction details?|details?$|^memo$/.test(h)) return 'narration';
  if (/withdraw|debit|^dr( |$)|paid out|money out|^dr amt/.test(h)) return 'debit';
  if (/deposit|credit|^cr( |$)|paid in|money in|^cr amt/.test(h)) return 'credit';
  if (/^(transaction |txn |tran )?(amount|amt)$/.test(h)) return 'amount';
  if (/chq|cheque|ref|utr|instrument|reference/.test(h)) return 'ref';
  return null;
}

/** Map header cells to fields; the first column wins for each field. */
export function detectColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  headers.forEach((h, i) => {
    const f = classifyHeader(h);
    if (f && map[f] === undefined) map[f] = i;
  });
  return map;
}

/** A header row has a date column and at least one money column. */
function isHeaderRow(cells: string[]): boolean {
  const m = detectColumns(cells);
  return m.date !== undefined && (m.debit !== undefined || m.credit !== undefined || m.amount !== undefined);
}

function bankLabelFor(headers: string[]): string {
  const h = headers.map(normHeader);
  const has = (re: RegExp) => h.some((x) => re.test(x));
  if (has(/^chq ref no$/) && has(/withdrawal amt/) && has(/closing balance/)) return 'HDFC Bank';
  if (has(/transaction remarks/) && has(/withdrawal amount/)) return 'ICICI Bank';
  if (has(/^txn date$/) && has(/ref no cheque no|ref no/) && has(/^debit$/)) return 'SBI';
  if (has(/^chqno$|^srl no$/) && has(/^particulars$/)) return 'Axis Bank';
  if (has(/^dr cr$/) && has(/chq ref no/)) return 'Kotak Mahindra Bank';
  return 'Bank statement';
}

export interface ParseOptions {
  /** Force a column mapping (from the "map columns" step) instead of auto-detecting. */
  columns?: ColumnMap;
  /** Header row index (0-based among non-blank rows) when `columns` is forced. */
  headerRow?: number;
}

export interface ParsedStatement {
  lines: Omit<BankLine, 'id'>[];
  bankLabel: string;
  columns: ColumnMap;
  headers: string[];
  headerRow: number;
  /** Non-blank rows that were not transactions (titles, totals, disclaimers). */
  skipped: number;
  openingBalance?: number;
  warnings: string[];
  /** All non-blank rows, so the UI can offer a column-mapping step when detection fails. */
  rawRows: string[][];
}

function clean(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Parse a bank statement CSV. Never throws: an unreadable file yields no lines plus a warning. */
export function parseBankStatement(text: string, options: ParseOptions = {}): ParsedStatement {
  const { rows } = parseCsvDetailed(text ?? '');
  const warnings: string[] = [];
  const empty = (w: string, columns: ColumnMap = {}, headers: string[] = [], headerRow = -1): ParsedStatement => ({
    lines: [],
    bankLabel: 'Bank statement',
    columns,
    headers,
    headerRow,
    skipped: rows.length,
    warnings: [...warnings, w],
    rawRows: rows,
  });
  if (rows.length === 0) return empty('The file is empty.');

  let headerRow = options.headerRow ?? -1;
  let columns: ColumnMap = options.columns ?? {};
  if (!options.columns) {
    headerRow = rows.slice(0, 60).findIndex(isHeaderRow);
    if (headerRow < 0) return empty('Could not find a header row with a Date column and Debit / Credit / Amount columns.');
    columns = detectColumns(rows[headerRow]);
  }
  const headers = rows[headerRow >= 0 ? headerRow : 0] ?? [];
  const hasMoney = columns.debit !== undefined || columns.credit !== undefined || columns.amount !== undefined;
  if (columns.date === undefined || !hasMoney) {
    return empty('Map at least a Date column and a Debit / Credit / Amount column.', columns, headers, headerRow);
  }

  const cell = (r: string[], f: ColumnField): string => (columns[f] === undefined || columns[f]! < 0 ? '' : (r[columns[f]!] ?? ''));
  const lines: Omit<BankLine, 'id'>[] = [];
  let skipped = 0;
  let openingBalance: number | undefined;
  let sawSciNotation = false;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseBankDate(cell(r, 'date')) || parseBankDate(cell(r, 'valueDate'));
    const narration = clean(cell(r, 'narration'));
    if (!date) {
      // Continuation of a wrapped narration: text in the narration column only, nothing else.
      const others = r.filter((c, ci) => ci !== columns.narration && c !== '');
      if (lines.length > 0 && narration && others.length === 0) {
        const prev = lines[lines.length - 1];
        prev.narration = clean(`${prev.narration} ${narration}`);
        continue;
      }
      skipped++;
      continue;
    }

    let debit = 0;
    let credit = 0;
    const d = parseBankAmount(cell(r, 'debit'));
    const c = parseBankAmount(cell(r, 'credit'));
    if (columns.debit !== undefined || columns.credit !== undefined) {
      debit = d ? Math.abs(d.value) : 0;
      credit = c ? Math.abs(c.value) : 0;
    }
    if (debit === 0 && credit === 0 && columns.amount !== undefined) {
      const a = parseBankAmount(cell(r, 'amount'));
      if (a && a.value !== 0) {
        const ind = clean(cell(r, 'drcr')).toLowerCase();
        const side = a.side ?? (/^d/.test(ind) ? 'Dr' : /^c/.test(ind) ? 'Cr' : undefined);
        if (side === 'Dr' || (!side && a.value < 0)) debit = Math.abs(a.value);
        else credit = Math.abs(a.value);
      }
    }
    // A signed single amount in a Debit column with a Dr/Cr indicator (some Kotak exports).
    if (debit === 0 && credit === 0 && columns.drcr !== undefined) {
      const ind = clean(cell(r, 'drcr')).toLowerCase();
      const only = d ?? c;
      if (only && only.value !== 0) {
        if (/^d/.test(ind)) debit = Math.abs(only.value);
        else if (/^c/.test(ind)) credit = Math.abs(only.value);
      }
    }
    debit = round2(debit);
    credit = round2(credit);

    const balRaw = parseBankAmount(cell(r, 'balance'));
    let balance: number | undefined;
    if (balRaw) balance = round2(balRaw.side === 'Dr' ? -Math.abs(balRaw.value) : balRaw.value);

    if (debit === 0 && credit === 0) {
      // "Opening balance" rows carry only a balance; anything else without money is not a transaction.
      if (balance !== undefined && /opening|b\/?f|brought forward/i.test(narration) && openingBalance === undefined) {
        openingBalance = balance;
      } else {
        skipped++;
      }
      continue;
    }

    const refRaw = clean(cell(r, 'ref'));
    if (/^\d(\.\d+)?e\+?\d+$/i.test(refRaw)) sawSciNotation = true;
    lines.push({
      date,
      narration,
      ref: refRaw,
      debit,
      credit,
      ...(balance !== undefined ? { balance } : {}),
    });
  }

  if (sawSciNotation) {
    warnings.push('Some reference numbers look like 4.12E+11 — Excel shortened them. Re-export the statement as CSV from the bank, not via Excel, so UTR matching works.');
  }
  if (lines.length === 0) warnings.push('No transaction rows were found under the header.');
  return {
    lines,
    bankLabel: bankLabelFor(headers),
    columns,
    headers,
    headerRow,
    skipped,
    openingBalance,
    warnings,
    rawRows: rows,
  };
}

/* ── Duplicates on re-import ─────────────────────────────────── */

export function dedupeKey(l: Pick<BankLine, 'date' | 'narration' | 'debit' | 'credit' | 'balance'>): string {
  return [l.date, round2(l.credit - l.debit).toFixed(2), compact(l.narration), l.balance === undefined ? '' : l.balance.toFixed(2)].join('|');
}

/**
 * Split freshly parsed lines into new vs already-imported. Identical lines inside one file are real
 * (two identical UPI payments on a day) so they are matched by occurrence: the 2nd copy is a
 * duplicate only if the 2nd copy was already stored.
 */
export function splitDuplicates<T extends Omit<BankLine, 'id'>>(
  existing: readonly BankStatement[],
  incoming: readonly T[],
): { fresh: T[]; duplicates: T[] } {
  const stored = new Map<string, number>();
  for (const s of existing) for (const l of s.lines) stored.set(dedupeKey(l), (stored.get(dedupeKey(l)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const fresh: T[] = [];
  const duplicates: T[] = [];
  for (const l of incoming) {
    const k = dedupeKey(l);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n <= (stored.get(k) ?? 0)) duplicates.push(l);
    else fresh.push(l);
  }
  return { fresh, duplicates };
}

/** Build a statement record from parsed lines (assigns ids). */
export function makeStatement(
  parsed: Pick<ParsedStatement, 'bankLabel' | 'openingBalance'>,
  lines: Omit<BankLine, 'id'>[],
  fileName: string,
  now: Date = new Date(),
): BankStatement {
  return {
    id: generateId(),
    imported_at: now.toISOString(),
    bank_label: parsed.bankLabel,
    file_name: fileName,
    lines: lines.map((l) => ({ ...l, id: generateId() })),
    ...(parsed.openingBalance !== undefined ? { opening_balance: parsed.openingBalance } : {}),
  };
}

/* ════════════════════════════════════════════════════════════════
   2. Narration analysis
   ════════════════════════════════════════════════════════════════ */

export type PayMode = 'UPI' | 'NEFT' | 'IMPS' | 'RTGS' | 'Cheque' | 'Cash' | 'Card' | 'ACH' | 'Other';

/** UPI / NEFT / IMPS / RTGS / Cheque / Cash / Card / ACH from how banks word the narration. */
export function inferMode(narration: string): PayMode {
  const t = String(narration ?? '').toUpperCase();
  if (/\bUPI\b|\bBHIM\b|[A-Z0-9._-]+@(OK[A-Z]+|YBL|IBL|AXL|PAYTM|APL|HDFCBANK|ICICI|SBI|AXISBANK|UPI)\b/.test(t)) return 'UPI';
  if (/\bIMPS\b|\bMMT\b/.test(t)) return 'IMPS';
  if (/\bRTGS\b/.test(t)) return 'RTGS';
  if (/\bNEFT\b|\bN[A-Z]{3}\d{6,}\b/.test(t)) return 'NEFT';
  if (/\bACH\b|\bNACH\b|\bECS\b/.test(t)) return 'ACH';
  if (/\bCHQ\b|\bCHEQUE\b|\bCHECK\b|\bCLG\b|\bCLEARING\b|\bINST\b|\bMICR\b/.test(t)) return 'Cheque';
  if (/CASH\s*(DEP|WDL|WITHDRAWAL|DEPOSIT)|\bATM\b|\bCDM\b/.test(t)) return 'Cash';
  if (/\bPOS\b|\bDEBIT CARD\b|\bECOM\b|\bVISA\b|\bMASTERCARD\b|\bRUPAY\b/.test(t)) return 'Card';
  return 'Other';
}

/** The `method` string recorded on a payment created from a statement line. */
export function methodForMode(mode: PayMode): string {
  switch (mode) {
    case 'UPI':
    case 'NEFT':
    case 'IMPS':
    case 'RTGS':
    case 'Cheque':
    case 'Cash':
    case 'Card':
      return mode;
    default:
      return 'Bank transfer';
  }
}

/** Does a recorded method string agree with the mode seen in the narration? */
function modeCompatible(mode: PayMode, method: string): boolean {
  const m = String(method ?? '').toLowerCase();
  if (!m || mode === 'Other') return false;
  if (mode === 'UPI') return m.includes('upi');
  if (mode === 'Cheque') return m.includes('cheque') || m.includes('check') || m.includes('chq');
  if (mode === 'Card') return m.includes('card');
  if (mode === 'Cash') return m.includes('cash');
  // NEFT / IMPS / RTGS / ACH all settle as bank transfers.
  return m.includes('bank') || m.includes('transfer') || m.includes(mode.toLowerCase()) || m.includes('neft') || m.includes('imps') || m.includes('rtgs');
}

/**
 * Candidate reference numbers inside a narration + the bank's reference column:
 * 12-digit UPI/IMPS RRNs, NEFT/RTGS UTRs (`HDFCN52026040112345678`), cheque numbers. Leading zeros
 * are dropped from all-digit tokens (`0000412345678901` == `412345678901`).
 */
export function extractReferences(narration: string, refColumn = ''): string[] {
  const out = new Set<string>();
  const add = (tok: string) => {
    let t = tok.toUpperCase();
    const rawLen = t.length;
    if (/^\d+$/.test(t)) t = t.replace(/^0+/, '');
    if (rawLen >= 4 && t) out.add(t);
  };
  const scan = `${narration ?? ''} ${refColumn ?? ''}`.toUpperCase();
  for (const m of scan.matchAll(/[A-Z0-9]{8,}/g)) {
    if (/\d/.test(m[0])) add(m[0]);
  }
  // Short digit runs only count when they are a cheque / reference number column.
  for (const m of String(refColumn ?? '').toUpperCase().matchAll(/[A-Z0-9]{4,}/g)) add(m[0]);
  for (const m of String(narration ?? '').toUpperCase().matchAll(/\b(?:CHQ|CHEQUE|CHECK|INST)\s*(?:NO\.?|#)?\s*0*(\d{4,9})\b/g)) add(m[1]);
  return [...out];
}

const NARRATION_NOISE = new Set([
  'UPI', 'NEFT', 'IMPS', 'RTGS', 'ACH', 'NACH', 'ECS', 'MMT', 'CR', 'DR', 'CREDIT', 'DEBIT', 'TRANSFER', 'TRF', 'PAYMENT', 'PAYMENTS', 'PAID',
  'FROM', 'TO', 'BY', 'FOR', 'REF', 'REFNO', 'NO', 'CHQ', 'CHEQUE', 'DEP', 'DEPOSIT', 'CLG', 'CLEARING', 'INWARD', 'OUTWARD', 'BANK', 'XXXX',
  'INV', 'INVOICE', 'BILL', 'SELF', 'SALARY', 'COLLECT', 'ONLINE', 'PAY', 'RECEIVED', 'REMITTANCE', 'IB', 'NET', 'BANKING', 'MOB', 'TPFT', 'POS', 'ATM', 'ECOM',
  'HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'PNB', 'IDFC', 'CANARA', 'INDUSIND', 'BOB', 'UNION', 'FEDERAL', 'YESB',
]);

/**
 * Best guess at who the other party is from a messy narration (`UPI-BHARAT TRADERS-bharat@okhdfc-HDFC0000123-412345678901`
 * -> "Bharat Traders"). '' when nothing name-like is there. Used only to pre-fill the vendor field.
 */
export function guessCounterparty(narration: string): string {
  const parts = String(narration ?? '').split(/[/*|_:]+|\s-\s|-(?=[A-Za-z])/);
  for (const raw of parts) {
    const seg = raw.trim();
    if (!seg || seg.includes('@')) continue;
    if (/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(seg)) continue; // IFSC
    const all = seg.split(/\s+/);
    const ws = all.filter((w) => /^[A-Za-z.&']+$/.test(w));
    if (ws.length === 0 || ws.length < all.length / 2) continue;
    const keep = ws.filter((w) => !NARRATION_NOISE.has(w.replace(/\./g, '').toUpperCase()) && w.replace(/[^A-Za-z]/g, '').length >= 3);
    if (keep.length === 0) continue;
    return keep.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }
  return '';
}

const NAME_STOP = new Set([
  'PVT', 'PRIVATE', 'LTD', 'LIMITED', 'LLP', 'INC', 'CO', 'COMPANY', 'THE', 'AND', 'OF', 'FOR', 'CORP', 'CORPORATION',
  'MS', 'MR', 'MRS', 'SHRI', 'SMT', 'M', 'S', 'INDIA', 'BANK', 'PAYMENT', 'TO', 'BY', 'FROM',
]);

/** Significant upper-case words of a party name (company suffixes and noise dropped). */
export function nameTokens(name: string): string[] {
  return words(name).filter((w) => w.length >= 3 && !NAME_STOP.has(w)).slice(0, 5);
}

/** Share (0..1) of the name's words that appear in the narration, tolerating truncation ("BHARAT TRADE"). */
export function nameOverlap(name: string, narration: string): number {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return 0;
  const nw = words(narration);
  const nc = compact(narration);
  let hit = 0;
  for (const t of tokens) {
    const found =
      nw.some((w) => w === t || (w.length >= 4 && t.startsWith(w)) || (t.length >= 5 && w.startsWith(t))) ||
      (t.length >= 4 && nc.includes(t));
    if (found) hit++;
  }
  return hit / tokens.length;
}

/**
 * Does the narration mention this document number? 'full' = the whole number (`INV/FY25-26/0001`
 * as INVFY25260001), 'short' = prefix + sequence (`INV0001`, `INV NO 1`), null = no.
 */
export function documentNumberHit(docNumber: string, narration: string): 'full' | 'short' | null {
  const num0 = String(docNumber ?? '').trim();
  if (!num0) return null;
  const full = compact(num0);
  const nc = compact(narration);
  if (full.length >= 5 && nc.includes(full)) return 'full';
  const segs = num0.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  if (/^\d+$/.test(last) && segs.length >= 2) {
    const seq = last.replace(/^0+/, '') || '0';
    const prefix = segs[0].replace(/\d+/g, '');
    const text = String(narration ?? '').toUpperCase();
    if (prefix && new RegExp(`${prefix}[^A-Z0-9]*(?:NO[^A-Z0-9]*)?0*${seq}(?![0-9])`).test(text)) return 'short';
    if (new RegExp(`(?:INV|INVOICE|BILL|REF)[^A-Z0-9]*(?:NO[^A-Z0-9]*)?0*${seq}(?![0-9])`).test(text)) return 'short';
  } else if (/^[A-Z0-9]{4,}$/.test(full) && nc.includes(full)) {
    return 'full';
  }
  return null;
}

/* ════════════════════════════════════════════════════════════════
   3. Book candidates + matching
   ════════════════════════════════════════════════════════════════ */

export interface Candidate {
  kind: 'payment' | 'purchase_payment';
  id: string;
  date: string;
  amount: number;
  method: string;
  reference: string;
  /** Invoice number / supplier bill number the entry settles. */
  docNumber: string;
  /** Customer or vendor name. */
  party: string;
  /** Source document id (invoice id / purchase id), for drill-through. */
  docId: string;
}

const isCashMethod = (m: unknown) => String(m ?? '').trim().toLowerCase() === 'cash';

function partyOfInvoice(inv: InvoiceRecord | undefined): string {
  if (!inv) return '';
  return String(inv.client?.company || inv.client?.name || '').trim();
}

/** Payments received that can show up on a bank statement (everything except cash). */
export function receiptCandidates(invoices: readonly InvoiceRecord[], payments: readonly Payment[]): Candidate[] {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const out: Candidate[] = [];
  for (const p of payments) {
    const amount = round2(Math.abs(num(p.amount)));
    const date = isoDay(p.date);
    if (!date || amount === 0 || isCashMethod(p.method)) continue;
    const inv = byId.get(p.invoice_id);
    out.push({
      kind: 'payment',
      id: p.id,
      date,
      amount,
      method: String(p.method ?? ''),
      reference: String(p.reference ?? '').trim(),
      docNumber: inv?.invoice_number ?? '',
      party: partyOfInvoice(inv),
      docId: p.invoice_id,
    });
  }
  return out;
}

export interface PurchasePaymentRow {
  id?: string;
  purchase_id?: string;
  amount?: number;
  date?: string;
  method?: string;
  reference?: string;
}

/** Payments made to vendors that can show up on a bank statement. */
export function payoutCandidates(
  purchases: readonly unknown[],
  vendors: readonly unknown[],
  payments: readonly PurchasePaymentRow[],
): Candidate[] {
  const byId = new Map<string, ReturnType<typeof readPurchase>>();
  for (const p of purchases) {
    const core = readPurchase(p, vendors);
    if (core && core.id && !isVoidStatus(core.status)) byId.set(core.id, core);
  }
  const out: Candidate[] = [];
  for (const pp of payments) {
    const amount = round2(Math.abs(num(pp.amount)));
    const date = isoDay(pp.date);
    if (!date || amount === 0 || isCashMethod(pp.method) || !pp.id) continue;
    const bill = byId.get(String(pp.purchase_id ?? ''));
    out.push({
      kind: 'purchase_payment',
      id: pp.id,
      date,
      amount,
      method: String(pp.method ?? ''),
      reference: String(pp.reference ?? '').trim(),
      docNumber: bill?.number ?? '',
      party: bill?.partyName ?? '',
      docId: String(pp.purchase_id ?? ''),
    });
  }
  return out;
}

export interface Suggestion {
  lineId: string;
  type: 'payment' | 'purchase_payment';
  /** Book entry ids (more than one for a combined settlement). */
  candidateIds: string[];
  /** 0..100. */
  confidence: number;
  reasons: string[];
  /** Another entry (or another statement line) scored almost the same. */
  ambiguous: boolean;
  /** Several book entries settled by one bank line. */
  combo: boolean;
  /** 1 = the engine's pick for this line; >1 = alternatives. */
  rank: number;
}

export type ConfidenceTier = 'high' | 'medium' | 'low';
export function tierOf(confidence: number): ConfidenceTier {
  return confidence >= BULK_CONFIRM_THRESHOLD ? 'high' : confidence >= 70 ? 'medium' : 'low';
}

const DATE_POINTS = [20, 17, 13, 9, 6, 3];

interface Scored {
  cand: Candidate;
  raw: number;
  delta: number;
  reasons: string[];
  strongRef: boolean;
}

function refHit(cand: Candidate, refs: string[], narrationCompact: string, mode: PayMode): boolean {
  let r = cand.reference.toUpperCase();
  if (!r) return false;
  const digitsOnly = /^[\d\s-]+$/.test(r);
  r = r.replace(/[^A-Z0-9]/g, '');
  const minLen = mode === 'Cheque' || cand.method.toLowerCase().includes('cheque') ? 4 : 6;
  if (r.length < minLen) return false;
  if (/^\d+$/.test(r)) r = r.replace(/^0+/, '');
  if (!r) return false;
  if (refs.includes(r)) return true;
  // the narration may glue the UTR to other text, or the reference may be a longer wrapper
  return !digitsOnly || r.length >= 8 ? narrationCompact.includes(r) : false;
}

function scoreCandidate(line: BankLine, cand: Candidate, window: number): Scored | null {
  const amt = lineAmount(line);
  if (Math.abs(cand.amount - amt) > AMOUNT_TOLERANCE + 1e-9) return null;
  const delta = Math.abs(dayDiff(line.date, cand.date));
  const mode = inferMode(line.narration);
  const refs = extractReferences(line.narration, line.ref);
  const nc = compact(`${line.narration} ${line.ref}`);
  const hasRef = refHit(cand, refs, nc, mode);
  if (delta > window && !(hasRef && delta <= REF_DATE_WINDOW_DAYS)) return null;

  const reasons: string[] = ['Amount matches'];
  let raw = 45;
  if (delta <= 5) {
    raw += DATE_POINTS[delta];
    reasons.push(delta === 0 ? 'Same day' : `${delta} day${delta === 1 ? '' : 's'} apart`);
  } else {
    reasons.push(`${delta} days apart`);
  }
  let strong = false;
  if (hasRef) {
    raw += 50;
    strong = true;
    reasons.push('UTR / reference found in narration');
  }
  const doc = cand.docNumber ? documentNumberHit(cand.docNumber, `${line.narration} ${line.ref}`) : null;
  if (doc) {
    raw += doc === 'full' ? 45 : 40;
    strong = true;
    reasons.push(`Document no. ${cand.docNumber} in narration`);
  }
  const overlap = cand.party ? nameOverlap(cand.party, line.narration) : 0;
  if (overlap > 0) {
    raw += Math.round(25 * overlap);
    reasons.push(overlap >= 0.99 ? 'Name matches' : 'Name partly matches');
  }
  if (modeCompatible(mode, cand.method)) {
    raw += 3;
    reasons.push(`${mode} payment`);
  }
  return { cand, raw: Math.min(100, raw), delta, reasons, strongRef: strong };
}

export interface SuggestOptions {
  windowDays?: number;
  /** Book entry ids already matched to a line (never offered again). */
  taken?: ReadonlySet<string>;
  /** Alternatives kept per line (rank 2..n). Default 3. */
  alternatives?: number;
}

const AMBIGUITY_GAP = 8;
const AMBIGUITY_PENALTY = 10;
const COMBO_CAP = 89;

/**
 * Rank book entries for every open statement line (credits -> payments received, debits -> purchase
 * payments). Pure: the result is advice. One-to-one: a book entry is the rank-1 pick of at most one line.
 *
 * Confidence = amount 45 + date proximity (20..3) + UTR 50 + document number 45/40 + name <=25 + mode 3,
 * capped at 100, minus 10 when a competing entry or line scores within 8 points (duplicate amounts).
 * A line that no single entry explains but two entries sum to is offered as a "combo" capped at 89.
 */
export function suggestMatches(
  lines: readonly BankLine[],
  candidates: readonly Candidate[],
  options: SuggestOptions = {},
): Suggestion[] {
  const window = options.windowDays ?? DATE_WINDOW_DAYS;
  const taken = options.taken ?? new Set<string>();
  const altCount = options.alternatives ?? 3;
  const open = lines.filter((l) => !l.matched_to && !l.ignored && lineAmount(l) > 0);
  const pool = candidates.filter((c) => !taken.has(c.id));

  // 1. score every (line, candidate) pair
  const perLine = new Map<string, Scored[]>();
  const perCand = new Map<string, { lineId: string; raw: number }[]>();
  for (const l of open) {
    const kind = isCredit(l) ? 'payment' : 'purchase_payment';
    const scored: Scored[] = [];
    for (const c of pool) {
      if (c.kind !== kind) continue;
      const s = scoreCandidate(l, c, window);
      if (s) scored.push(s);
    }
    scored.sort((a, b) => b.raw - a.raw || a.delta - b.delta || a.cand.id.localeCompare(b.cand.id));
    if (scored.length) perLine.set(l.id, scored);
    for (const s of scored) {
      const arr = perCand.get(s.cand.id) ?? [];
      arr.push({ lineId: l.id, raw: s.raw });
      perCand.set(s.cand.id, arr);
    }
  }

  // 2. greedy one-to-one assignment on raw score
  const pairs: { lineId: string; s: Scored }[] = [];
  for (const [lineId, arr] of perLine) for (const s of arr) pairs.push({ lineId, s });
  pairs.sort((a, b) => b.s.raw - a.s.raw || a.s.delta - b.s.delta || a.lineId.localeCompare(b.lineId) || a.s.cand.id.localeCompare(b.s.cand.id));
  const usedLine = new Set<string>();
  const usedCand = new Set<string>();
  const picked = new Map<string, Scored>();
  for (const p of pairs) {
    if (usedLine.has(p.lineId) || usedCand.has(p.s.cand.id)) continue;
    usedLine.add(p.lineId);
    usedCand.add(p.s.cand.id);
    picked.set(p.lineId, p.s);
  }

  const out: Suggestion[] = [];
  const confidenceFor = (lineId: string, s: Scored) => {
    let penalty = 0;
    let ambiguous = false;
    const rivals = (perLine.get(lineId) ?? []).filter((o) => o.cand.id !== s.cand.id && o.raw >= s.raw - AMBIGUITY_GAP);
    if (rivals.length) {
      penalty = AMBIGUITY_PENALTY;
      ambiguous = true;
    }
    const lineRivals = (perCand.get(s.cand.id) ?? []).filter((o) => o.lineId !== lineId && o.raw >= s.raw - AMBIGUITY_GAP);
    if (lineRivals.length) {
      penalty = AMBIGUITY_PENALTY;
      ambiguous = true;
    }
    return { confidence: Math.max(0, s.raw - penalty), ambiguous };
  };

  for (const l of open) {
    const arr = perLine.get(l.id);
    if (!arr) continue;
    const best = picked.get(l.id);
    const type = isCredit(l) ? 'payment' : 'purchase_payment';
    const ordered = best ? [best, ...arr.filter((s) => s !== best)] : arr;
    ordered.slice(0, 1 + altCount).forEach((s, i) => {
      const { confidence, ambiguous } = confidenceFor(l.id, s);
      out.push({
        lineId: l.id,
        type,
        candidateIds: [s.cand.id],
        confidence,
        reasons: ambiguous ? [...s.reasons, 'Another entry looks similar — check before confirming'] : s.reasons,
        ambiguous,
        combo: false,
        // A line whose best entry went to a better-fitting line only gets alternatives (rank >= 2).
        rank: best ? i + 1 : i + 2,
      });
    });
  }

  // 3. combos: a line nothing explains but two same-party entries sum to
  const comboUsed = new Set<string>([...usedCand]);
  for (const l of open) {
    if (perLine.has(l.id)) continue;
    const kind = isCredit(l) ? 'payment' : 'purchase_payment';
    const amt = lineAmount(l);
    const near = pool
      .filter((c) => c.kind === kind && !comboUsed.has(c.id) && c.amount < amt - AMOUNT_TOLERANCE && Math.abs(dayDiff(l.date, c.date)) <= window)
      .sort((a, b) => Math.abs(dayDiff(l.date, a.date)) - Math.abs(dayDiff(l.date, b.date)))
      .slice(0, 60);
    let found: [Candidate, Candidate] | null = null;
    outer: for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        if (Math.abs(near[i].amount + near[j].amount - amt) <= AMOUNT_TOLERANCE + 1e-9) {
          found = [near[i], near[j]];
          break outer;
        }
      }
    }
    if (!found) continue;
    const [a, b] = found;
    const sameParty = !!a.party && nameOverlap(a.party, b.party) >= 0.99 && nameOverlap(b.party, a.party) >= 0.99;
    const overlap = Math.max(nameOverlap(a.party, l.narration), nameOverlap(b.party, l.narration));
    const delta = Math.max(Math.abs(dayDiff(l.date, a.date)), Math.abs(dayDiff(l.date, b.date)));
    const reasons = [`Two entries add up to the amount (${a.docNumber || 'entry'} + ${b.docNumber || 'entry'})`];
    let raw = 35 + (delta <= 5 ? DATE_POINTS[delta] : 0);
    if (sameParty) {
      raw += 10;
      reasons.push('Same party');
    }
    if (overlap > 0) {
      raw += Math.round(20 * overlap);
      reasons.push('Name matches');
    }
    const docs = [a, b].filter((c) => c.docNumber && documentNumberHit(c.docNumber, `${l.narration} ${l.ref}`));
    if (docs.length) {
      raw += 15;
      reasons.push('Document number in narration');
    }
    comboUsed.add(a.id);
    comboUsed.add(b.id);
    out.push({
      lineId: l.id,
      type: kind,
      candidateIds: [a.id, b.id],
      confidence: Math.min(COMBO_CAP, raw),
      reasons,
      ambiguous: false,
      combo: true,
      rank: 1,
    });
  }

  return out.sort((a, b) => a.rank - b.rank || b.confidence - a.confidence || a.lineId.localeCompare(b.lineId));
}

/** The rank-1 suggestion per line. */
export function bestSuggestions(all: readonly Suggestion[]): Map<string, Suggestion> {
  const m = new Map<string, Suggestion>();
  for (const s of all) if (s.rank === 1 && !m.has(s.lineId)) m.set(s.lineId, s);
  return m;
}

/** Suggestions "Confirm all" may apply: rank 1, not ambiguous, >= threshold. */
export function confirmableAll(all: readonly Suggestion[], threshold = BULK_CONFIRM_THRESHOLD): Suggestion[] {
  return all.filter((s) => s.rank === 1 && !s.combo && !s.ambiguous && s.confidence >= threshold);
}

/* ── Invoices a credit might be paying (for "create receipt") ─── */

export interface InvoiceSuggestion {
  invoice: InvoiceRecord;
  balance: number;
  score: number;
  reasons: string[];
}

/** Invoice still owing money (balance after payments). */
export function openBalance(inv: InvoiceRecord): number {
  const live = inv.status !== 'Draft' && inv.status !== 'Cancelled' && (inv.doc_type === 'INVOICE' || inv.doc_type === 'TAX_INVOICE' || !inv.doc_type);
  if (!live) return 0;
  const owing = typeof inv.balance_due === 'number' ? inv.balance_due : num(inv.total) - num(inv.amount_paid);
  return Math.max(round2(owing), 0);
}

/** Rank open invoices for a credit that has no recorded receipt yet. */
export function suggestInvoices(line: BankLine, invoices: readonly InvoiceRecord[], limit = 5): InvoiceSuggestion[] {
  const amt = lineAmount(line);
  const out: InvoiceSuggestion[] = [];
  for (const inv of invoices) {
    const balance = openBalance(inv);
    if (balance <= 0) continue;
    let score = 0;
    const reasons: string[] = [];
    if (Math.abs(balance - amt) <= AMOUNT_TOLERANCE + 1e-9) {
      score += 45;
      reasons.push('Balance equals the credit');
    } else if (amt < balance) {
      score += 10;
      reasons.push('Part payment');
    } else {
      score -= 15;
      reasons.push('Credit exceeds the balance');
    }
    const doc = documentNumberHit(inv.invoice_number, `${line.narration} ${line.ref}`);
    if (doc) {
      score += 50;
      reasons.push('Invoice no. in narration');
    }
    const overlap = nameOverlap(partyOfInvoice(inv), line.narration);
    if (overlap > 0) {
      score += Math.round(30 * overlap);
      reasons.push('Name matches');
    }
    if (score > 0) out.push({ invoice: inv, balance, score, reasons });
  }
  return out
    .sort((a, b) => b.score - a.score || a.invoice.issue_date.localeCompare(b.invoice.issue_date))
    .slice(0, limit);
}

/** Reference to store on a receipt created from a line: the UTR when one is visible, else the bank's ref column. */
export function referenceFor(line: Pick<BankLine, 'narration' | 'ref'>): string {
  const refs = extractReferences(line.narration, line.ref).sort((a, b) => b.length - a.length);
  const utr = refs.find((r) => r.length >= 9);
  return utr ?? (line.ref || refs[0] || '');
}

/* ════════════════════════════════════════════════════════════════
   4. Statement mutations (pure — return a new array)
   ════════════════════════════════════════════════════════════════ */

function mapLine(statements: readonly BankStatement[], lineId: string, fn: (l: BankLine) => BankLine): BankStatement[] {
  return statements.map((s) => (s.lines.some((l) => l.id === lineId) ? { ...s, lines: s.lines.map((l) => (l.id === lineId ? fn(l) : l)) } : s));
}

export function matchLine(statements: readonly BankStatement[], lineId: string, match: LineMatch): BankStatement[] {
  return mapLine(statements, lineId, (l) => ({ ...l, matched_to: match, ignored: false }));
}

export function unmatchLine(statements: readonly BankStatement[], lineId: string): BankStatement[] {
  return mapLine(statements, lineId, (l) => {
    const { matched_to: _m, ...rest } = l;
    void _m;
    return { ...rest, ignored: false };
  });
}

export function ignoreLine(statements: readonly BankStatement[], lineId: string, ignored: boolean, note?: string): BankStatement[] {
  return mapLine(statements, lineId, (l) => {
    const next: BankLine = { ...l, ignored };
    if (ignored) delete next.matched_to;
    if (note !== undefined) next.note = note || undefined;
    return next;
  });
}

export function noteLine(statements: readonly BankStatement[], lineId: string, note: string): BankStatement[] {
  return mapLine(statements, lineId, (l) => ({ ...l, note: note.trim() || undefined }));
}

/** Apply suggestions (only ever called after the user pressed Confirm). */
export function applySuggestions(statements: readonly BankStatement[], suggestions: readonly Suggestion[]): BankStatement[] {
  const byLine = new Map(suggestions.map((s) => [s.lineId, s]));
  return statements.map((st) => ({
    ...st,
    lines: st.lines.map((l) => {
      const s = byLine.get(l.id);
      if (!s || l.matched_to) return l;
      return {
        ...l,
        ignored: false,
        matched_to: { type: s.type, id: s.candidateIds[0], ...(s.candidateIds.length > 1 ? { ids: s.candidateIds } : {}) },
      };
    }),
  }));
}

export function matchedIdsOf(m: LineMatch | undefined): string[] {
  if (!m || m.type === 'manual') return [];
  return m.ids && m.ids.length ? m.ids : m.id ? [m.id] : [];
}

/** Every book entry id already consumed by a statement line. */
export function takenIds(statements: readonly BankStatement[]): Set<string> {
  const out = new Set<string>();
  for (const s of statements) for (const l of s.lines) for (const id of matchedIdsOf(l.matched_to)) out.add(id);
  return out;
}

export function removeStatement(statements: readonly BankStatement[], id: string): BankStatement[] {
  return statements.filter((s) => s.id !== id);
}

/* ════════════════════════════════════════════════════════════════
   5. Status, summary, BRS
   ════════════════════════════════════════════════════════════════ */

export type LineState = 'matched' | 'manual' | 'ignored' | 'orphan' | 'unmatched';

export interface BookIndex {
  /** ids of existing payments received (transactions). */
  payments: ReadonlySet<string>;
  /** ids of existing purchase payments. */
  purchasePayments: ReadonlySet<string>;
}

/**
 * `orphan` = matched to a book entry that has since been deleted: it counts as unreconciled again.
 */
export function lineState(line: BankLine, idx: BookIndex): LineState {
  if (line.ignored) return 'ignored';
  const m = line.matched_to;
  if (!m) return 'unmatched';
  if (m.type === 'manual') return 'manual';
  const ids = matchedIdsOf(m);
  const set = m.type === 'payment' ? idx.payments : idx.purchasePayments;
  return ids.length > 0 && ids.every((id) => set.has(id)) ? 'matched' : 'orphan';
}

export interface ReconSummary {
  total: number;
  matched: number;
  manual: number;
  ignored: number;
  /** unmatched + orphan: the to-do list. */
  unreconciled: number;
  unreconciledCredits: number;
  unreconciledDebits: number;
  /** Net of unreconciled credits less debits. */
  unreconciledNet: number;
  matchedAmount: number;
  pctReconciled: number;
}

export function summarizeRecon(lines: readonly BankLine[], idx: BookIndex): ReconSummary {
  const s: ReconSummary = {
    total: lines.length, matched: 0, manual: 0, ignored: 0, unreconciled: 0,
    unreconciledCredits: 0, unreconciledDebits: 0, unreconciledNet: 0, matchedAmount: 0, pctReconciled: 0,
  };
  for (const l of lines) {
    const st = lineState(l, idx);
    if (st === 'matched') {
      s.matched++;
      s.matchedAmount += lineAmount(l);
    } else if (st === 'manual') s.manual++;
    else if (st === 'ignored') s.ignored++;
    else {
      s.unreconciled++;
      s.unreconciledCredits += l.credit;
      s.unreconciledDebits += l.debit;
    }
  }
  s.unreconciledCredits = round2(s.unreconciledCredits);
  s.unreconciledDebits = round2(s.unreconciledDebits);
  s.unreconciledNet = round2(s.unreconciledCredits - s.unreconciledDebits);
  s.matchedAmount = round2(s.matchedAmount);
  s.pctReconciled = s.total ? Math.round(((s.matched + s.manual + s.ignored) / s.total) * 100) : 0;
  return s;
}

/** Statement closing balance: typed override, else the balance on the last dated line, else null. */
export function statementClosing(st: Pick<BankStatement, 'lines' | 'closing_balance'>): number | null {
  if (typeof st.closing_balance === 'number') return round2(st.closing_balance);
  let best: BankLine | undefined;
  for (const l of st.lines) {
    if (l.balance === undefined) continue;
    if (!best || l.date >= best.date) best = l;
  }
  return best?.balance !== undefined ? round2(best.balance) : null;
}

/** Closing balance of the statement that ends latest (ties: the later import), plus the latest date seen. */
export function closingAcross(statements: readonly BankStatement[]): { balance: number | null; asOf: string } {
  let asOf = '';
  let balance: number | null = null;
  let balEnd = '';
  for (const s of statements) {
    const end = s.lines.reduce((m, l) => (l.date > m ? l.date : m), '');
    if (end > asOf) asOf = end;
    const closing = statementClosing(s);
    if (closing !== null && end >= balEnd) {
      balance = closing;
      balEnd = end;
    }
  }
  return { balance, asOf };
}

export interface BrsItem {
  date: string;
  description: string;
  amount: number;
  /** Where it came from, for drill-through. */
  ref?: string;
}

export interface Brs {
  asOf: string;
  /** Books balance of the bank account at `asOf`. */
  booksBalance: number;
  /** + issued in books, not yet debited by the bank. */
  paymentsNotCleared: BrsItem[];
  /** - recorded in books, not yet credited by the bank. */
  receiptsNotCleared: BrsItem[];
  /** + credited by the bank, not in books. */
  bankCreditsNotInBooks: BrsItem[];
  /** - debited by the bank, not in books. */
  bankDebitsNotInBooks: BrsItem[];
  /** booksBalance + payments - receipts + credits - debits. */
  computedBankBalance: number;
  /** Closing balance on the statement (null when unknown). */
  statementBalance: number | null;
  /** statementBalance - computedBankBalance; 0 = fully reconciled. */
  difference: number | null;
}

const sumItems = (xs: readonly BrsItem[]) => round2(xs.reduce((t, x) => t + x.amount, 0));

export interface BrsInput {
  asOf: string;
  /** Books entries before this date are assumed cleared (statement does not cover them). */
  fromDate?: string;
  booksBalance: number;
  lines: readonly BankLine[];
  receipts: readonly Candidate[];
  payouts: readonly Candidate[];
  statementBalance: number | null;
  /** Which book entries still exist; a match to a deleted entry is bank-only again. Omit to trust matches. */
  index?: BookIndex;
}

/**
 * Bank Reconciliation Statement (Tally layout): start from the BOOKS balance, adjust for timing
 * differences, arrive at the BANK balance and compare it with the statement.
 */
export function buildBrs(input: BrsInput): Brs {
  const { asOf, fromDate = '' } = input;
  const taken = new Set<string>();
  const bankOnlyCredits: BrsItem[] = [];
  const bankOnlyDebits: BrsItem[] = [];
  for (const l of input.lines) {
    if (l.date > asOf) continue;
    const consumed = input.index
      ? lineState(l, input.index) === 'matched'
      : (l.matched_to?.type === 'payment' || l.matched_to?.type === 'purchase_payment') && !l.ignored && matchedIdsOf(l.matched_to).length > 0;
    if (consumed) {
      matchedIdsOf(l.matched_to).forEach((id) => taken.add(id));
      continue;
    }
    const tag = l.ignored ? ' (ignored)' : l.matched_to?.type === 'manual' ? ' (manually reconciled)' : '';
    const item: BrsItem = { date: l.date, description: `${l.narration || 'Bank entry'}${tag}`, amount: lineAmount(l), ref: l.ref || undefined };
    if (l.credit > 0 && !(l.debit > 0)) bankOnlyCredits.push(item);
    else bankOnlyDebits.push(item);
  }
  const inRange = (d: string) => d <= asOf && (!fromDate || d >= fromDate);
  const receiptsNotCleared: BrsItem[] = input.receipts
    .filter((c) => !taken.has(c.id) && inRange(c.date))
    .map((c) => ({ date: c.date, description: `Receipt ${c.docNumber || ''} ${c.party}`.replace(/\s+/g, ' ').trim(), amount: c.amount, ref: c.docId }));
  const paymentsNotCleared: BrsItem[] = input.payouts
    .filter((c) => !taken.has(c.id) && inRange(c.date))
    .map((c) => ({ date: c.date, description: `Payment ${c.docNumber || ''} ${c.party}`.replace(/\s+/g, ' ').trim(), amount: c.amount, ref: c.docId }));

  const byDate = (a: BrsItem, b: BrsItem) => a.date.localeCompare(b.date);
  receiptsNotCleared.sort(byDate);
  paymentsNotCleared.sort(byDate);
  bankOnlyCredits.sort(byDate);
  bankOnlyDebits.sort(byDate);

  const computed = round2(
    input.booksBalance + sumItems(paymentsNotCleared) - sumItems(receiptsNotCleared) + sumItems(bankOnlyCredits) - sumItems(bankOnlyDebits),
  );
  return {
    asOf,
    booksBalance: round2(input.booksBalance),
    paymentsNotCleared,
    receiptsNotCleared,
    bankCreditsNotInBooks: bankOnlyCredits,
    bankDebitsNotInBooks: bankOnlyDebits,
    computedBankBalance: computed,
    statementBalance: input.statementBalance,
    difference: input.statementBalance === null ? null : round2(input.statementBalance - computed),
  };
}

/** The BRS as CSV (formula-injection safe via csv.ts). */
export function brsCsv(b: Brs): string {
  const rows: unknown[][] = [
    ['Bank Reconciliation Statement', `as on ${b.asOf}`],
    [],
    ['Particulars', 'Date', 'Amount'],
    ['Balance as per books', '', b.booksBalance],
    ['Add: payments issued, not yet debited by the bank', '', sumItems(b.paymentsNotCleared)],
    ...b.paymentsNotCleared.map((i) => [`   ${i.description}`, i.date, i.amount]),
    ['Less: receipts recorded, not yet credited by the bank', '', -sumItems(b.receiptsNotCleared)],
    ...b.receiptsNotCleared.map((i) => [`   ${i.description}`, i.date, i.amount]),
    ['Add: credited by the bank, not in books', '', sumItems(b.bankCreditsNotInBooks)],
    ...b.bankCreditsNotInBooks.map((i) => [`   ${i.description}`, i.date, i.amount]),
    ['Less: debited by the bank, not in books', '', -sumItems(b.bankDebitsNotInBooks)],
    ...b.bankDebitsNotInBooks.map((i) => [`   ${i.description}`, i.date, i.amount]),
    ['Balance as per bank (computed)', '', b.computedBankBalance],
    ['Balance as per bank statement', '', b.statementBalance ?? ''],
    ['Difference (unexplained)', '', b.difference ?? ''],
  ];
  return toCsv(rows);
}

export function statementLinesCsv(lines: readonly BankLine[], idx: BookIndex): string {
  return toCsv([
    ['Date', 'Narration', 'Reference', 'Debit', 'Credit', 'Balance', 'Status', 'Note'],
    ...lines.map((l) => [l.date, l.narration, l.ref, l.debit || '', l.credit || '', l.balance ?? '', lineState(l, idx), l.note ?? '']),
  ]);
}

/* ════════════════════════════════════════════════════════════════
   6. Storage + shortcuts that write to the books
   ════════════════════════════════════════════════════════════════ */

function normalizeLine(raw: unknown): BankLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const date = isoDay(r.date);
  if (!date || typeof r.id !== 'string') return null;
  const mt = r.matched_to as Record<string, unknown> | undefined;
  const type = mt?.type;
  const matched: LineMatch | undefined =
    type === 'payment' || type === 'purchase_payment' || type === 'manual'
      ? {
          type,
          ...(typeof mt?.id === 'string' ? { id: mt.id } : {}),
          ...(Array.isArray(mt?.ids) ? { ids: (mt!.ids as unknown[]).filter((x): x is string => typeof x === 'string') } : {}),
        }
      : undefined;
  return {
    id: r.id,
    date,
    narration: String(r.narration ?? ''),
    ref: String(r.ref ?? ''),
    debit: round2(Math.abs(num(r.debit))),
    credit: round2(Math.abs(num(r.credit))),
    ...(Number.isFinite(num(r.balance, NaN)) && r.balance !== undefined && r.balance !== null && r.balance !== '' ? { balance: num(r.balance) } : {}),
    ...(matched ? { matched_to: matched } : {}),
    ...(r.ignored === true ? { ignored: true } : {}),
    ...(typeof r.note === 'string' && r.note ? { note: r.note } : {}),
  };
}

/** Read the table defensively (hand-edited / restored backups may be partial). */
export function normalizeStatements(rows: unknown[]): BankStatement[] {
  const out: BankStatement[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !Array.isArray(r.lines)) continue;
    const lines = r.lines.map(normalizeLine).filter((l): l is BankLine => l !== null);
    out.push({
      id: r.id,
      imported_at: String(r.imported_at ?? ''),
      bank_label: String(r.bank_label ?? 'Bank statement'),
      file_name: String(r.file_name ?? ''),
      lines,
      ...(Number.isFinite(num(r.opening_balance, NaN)) && r.opening_balance !== undefined ? { opening_balance: num(r.opening_balance) } : {}),
      ...(Number.isFinite(num(r.closing_balance, NaN)) && r.closing_balance !== undefined ? { closing_balance: num(r.closing_balance) } : {}),
    });
  }
  return out;
}

export const bankDb = {
  all: (): BankStatement[] => normalizeStatements(getTable<unknown>(STATEMENTS_TABLE)),
  saveAll: (statements: readonly BankStatement[]): void => setTable(STATEMENTS_TABLE, [...statements]),
};
