/**
 * RFC-4180 CSV reader / writer — pure, dependency-free, no browser APIs.
 *
 * Handles what real accounting exports throw at it: UTF-8 BOM, CRLF / CR / LF
 * line ends, quoted fields with embedded delimiters, quotes and newlines,
 * `;` and tab and `|` delimiters (auto-detected), ragged rows, blank lines and
 * Excel's "force text" wrapper (`="0123"`) used to protect leading zeros.
 */

export type Delimiter = ',' | ';' | '\t' | '|';
const CANDIDATES: Delimiter[] = [',', ';', '\t', '|'];

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Excel writes `="0123"` (or `"=""0123"""`) to keep leading zeros — unwrap it. */
export function unwrapExcelText(value: string): string {
  const m = /^="([\s\S]*)"$/.exec(value.trim());
  return m ? m[1].replace(/""/g, '"') : value;
}

/** Low-level scan. Returns raw rows; every cell is still untrimmed. */
function scan(text: string, delimiter: string, maxRows = Infinity): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStart = true; // a quote only opens a quoted field at the very start
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
    fieldStart = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      i++;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      endRow();
      if (rows.length >= maxRows) return rows;
      continue;
    }
    field += ch;
    fieldStart = false;
    i++;
  }
  // Last record without a trailing newline.
  if (field !== '' || row.length > 0 || inQuotes) endRow();
  return rows;
}

/**
 * Pick the delimiter whose column count is the most consistent over the first
 * rows. Falls back to a comma.
 */
export function detectDelimiter(text: string): Delimiter {
  const sample = stripBom(text).slice(0, 64 * 1024);
  let best: Delimiter = ',';
  let bestScore = 0;
  for (const d of CANDIDATES) {
    const rows = scan(sample, d, 25).filter((r) => r.some((c) => c.trim() !== ''));
    if (rows.length === 0) continue;
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    let modeLen = 1;
    let modeFreq = 0;
    for (const [len, freq] of counts) {
      if (freq > modeFreq || (freq === modeFreq && len > modeLen)) {
        modeLen = len;
        modeFreq = freq;
      }
    }
    if (modeLen < 2) continue;
    const score = modeFreq * (modeLen - 1) + (modeFreq === rows.length ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export interface ParseOptions {
  delimiter?: Delimiter;
  /** Keep fully blank rows (default false). */
  keepBlankRows?: boolean;
  /** Trim every cell (default true). */
  trim?: boolean;
}

export interface ParsedCsv {
  rows: string[][];
  delimiter: Delimiter;
}

export function parseCsvDetailed(input: string, options: ParseOptions = {}): ParsedCsv {
  const text = stripBom(input ?? '');
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const trim = options.trim !== false;
  let rows = scan(text, delimiter).map((r) =>
    r.map((c) => {
      const unwrapped = unwrapExcelText(c);
      return trim ? unwrapped.trim() : unwrapped;
    }),
  );
  if (!options.keepBlankRows) rows = rows.filter((r) => r.some((c) => c !== ''));
  return { rows, delimiter };
}

export function parseCsv(input: string, options: ParseOptions = {}): string[][] {
  return parseCsvDetailed(input, options).rows;
}

/**
 * Locate the header row. Accounting exports often start with a title block
 * ("Sales Register", company name, period…) — the header is the first row that
 * is at least 60% as wide as the widest row and is mostly non-numeric text.
 */
export function findHeaderRow(rows: string[][]): number {
  const head = rows.slice(0, 30);
  const widest = head.reduce((m, r) => Math.max(m, r.filter((c) => c !== '').length), 0);
  if (widest < 2) return 0;
  for (let i = 0; i < head.length; i++) {
    const filled = head[i].filter((c) => c !== '');
    if (filled.length >= Math.max(2, Math.ceil(widest * 0.6))) {
      const textual = filled.filter((c) => !/^[-+]?[\d.,]+$/.test(c)).length;
      if (textual >= filled.length * 0.8) return i;
    }
  }
  return 0;
}

export interface CsvTable {
  headers: string[];
  rows: string[][];
  delimiter: Delimiter;
  /** 1-based position of the header row among the non-blank rows. */
  headerIndex: number;
}

/** Parse + locate headers + pad ragged rows to the header width. */
export function parseTable(input: string, options: ParseOptions = {}): CsvTable {
  const { rows, delimiter } = parseCsvDetailed(input, options);
  if (rows.length === 0) return { headers: [], rows: [], delimiter, headerIndex: 0 };
  const hi = findHeaderRow(rows);
  const headerRow = rows[hi];
  const body = rows.slice(hi + 1);
  let width = headerRow.length;
  for (const r of body) width = Math.max(width, r.length);
  // Drop trailing columns that are empty in the header AND in every data row.
  while (
    width > 0 &&
    (headerRow[width - 1] ?? '') === '' &&
    body.every((r) => (r[width - 1] ?? '') === '')
  ) {
    width--;
  }
  const headers = Array.from({ length: width }, (_, i) => headerRow[i] || `Column ${i + 1}`);
  const padded = body.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
  return { headers, rows: padded, delimiter, headerIndex: hi + 1 };
}

export interface WriteOptions {
  delimiter?: Delimiter;
  eol?: '\r\n' | '\n';
  /** Prepend a UTF-8 BOM so Excel opens ₹ and Devanagari correctly. */
  bom?: boolean;
}

function quoteCell(value: unknown, delimiter: string): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (s === '') return '';
  if (
    s.includes('"') ||
    s.includes(delimiter) ||
    s.includes('\n') ||
    s.includes('\r') ||
    /^\s|\s$/.test(s)
  ) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function writeCsv(rows: unknown[][], options: WriteOptions = {}): string {
  const delimiter = options.delimiter ?? ',';
  const eol = options.eol ?? '\r\n';
  const body = rows.map((r) => r.map((c) => quoteCell(c, delimiter)).join(delimiter)).join(eol);
  return (options.bom ? '﻿' : '') + body + (rows.length ? eol : '');
}

/* ── Safe CSV *export* cells (single source of truth) ─────────────────────
 * Every export module (books, receivables, inventory, GST, accounting, ledger)
 * serialises through these two functions. They differ from `writeCsv` above in
 * one way: user-entered TEXT is neutralised against spreadsheet formula
 * injection (a client called `=HYPERLINK(...)` must not run when the file is
 * opened in Excel). Numbers are emitted as numbers, so a negative amount like
 * -1250.5 stays numeric and is never turned into text. */

const NUMBERISH = /^[+-]?[\d\s().,-]+$/;

/** Neutralise formula injection in free text without mangling phone numbers / negative figures. */
export function safeText(s: string): string {
  if (/^[=@\t\r]/.test(s)) return `'${s}`;
  if (/^[+-]/.test(s) && !NUMBERISH.test(s)) return `'${s}`;
  return s;
}

/** RFC 4180 cell escaping + formula-injection guard. Numbers pass through untouched. */
export function csvCell(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'number') text = Number.isFinite(value) ? String(value) : '';
  else text = safeText(String(value));
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
