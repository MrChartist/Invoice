/**
 * .xlsx read / write without a dependency.
 *
 * An .xlsx file is a ZIP (see zip.ts) of SpreadsheetML parts. The reader parses
 * `xl/workbook.xml` (+ its rels), `xl/sharedStrings.xml`, `xl/styles.xml` (only to
 * tell date cells from numbers) and `xl/worksheets/sheetN.xml` with a small,
 * tolerant XML tokenizer (`scanXml`) — DOMParser is not available in the Node
 * test runtime and is far heavier than what cell data needs.
 *
 * Cell values come back as strings, the same shape the CSV importer uses:
 *  - shared strings, inline strings (incl. rich-text runs) and formula strings;
 *  - numbers without float noise (`0.30000000000000004` → `0.3`);
 *  - booleans as `TRUE` / `FALSE`; error cells (`#N/A`) as '';
 *  - date-formatted numbers (1900 or 1904 date system) as local `YYYY-MM-DD`
 *    (a time part, if any, is dropped — every date in this app is a calendar day);
 *  - gaps (missing cells / column letters skipped) as ''.
 * Fully empty rows are dropped, so row positions are not preserved.
 *
 * The writer produces a minimal workbook (inline strings, bold header row) and
 * neutralises formula injection in text cells with the same `safeText` guard as
 * the CSV exports.
 */

import { findHeaderRow, safeText, writeCsv } from './csv';
import { openZip, writeZip, ZipError, type ZipLimits } from './zip';
import { downloadBlob } from './download';

export { ZipError as XlsxError };

/* ───────────────────────── XML tokenizer ───────────────────────── */

export type XmlAttrs = Record<string, string>;

export interface XmlHandlers {
  /** Start tag (or empty-element tag, then `selfClosing` is true). Names lose any namespace prefix. */
  open?: (name: string, attrs: XmlAttrs, selfClosing: boolean) => void;
  close?: (name: string) => void;
  /** Character data (entities decoded; CDATA passed through verbatim). */
  text?: (text: string) => void;
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Decode the five XML entities and numeric references. Unknown entities are left as written. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref[0] === '#') {
      const cp = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return NAMED[ref] ?? whole;
  });
}

const localName = (qname: string) => {
  const i = qname.indexOf(':');
  return i >= 0 ? qname.slice(i + 1) : qname;
};

function parseAttrs(src: string): XmlAttrs {
  const attrs: XmlAttrs = {};
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) attrs[localName(m[1])] = decodeEntities(m[2] ?? m[3] ?? '');
  return attrs;
}

/**
 * Streaming, non-validating XML scanner. Skips the prolog, comments, processing
 * instructions and DOCTYPE (entity declarations are never expanded, so there is
 * no "billion laughs"). Malformed input never throws; a truncated tag ends the scan.
 */
export function scanXml(xml: string, h: XmlHandlers): void {
  const n = xml.length;
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      if (h.text && i < n) h.text(decodeEntities(xml.slice(i)));
      return;
    }
    if (lt > i && h.text) h.text(decodeEntities(xml.slice(i, lt)));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) return;
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) return;
      if (h.text) h.text(xml.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (xml[lt + 1] === '?') {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) return;
      i = end + 2;
      continue;
    }
    if (xml[lt + 1] === '!') {
      // DOCTYPE (possibly with an internal subset [...]) or another declaration.
      let depth = 0;
      let j = lt + 2;
      for (; j < n; j++) {
        const c = xml[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }
    // Find the closing '>' outside quoted attribute values.
    let j = lt + 1;
    let quote = '';
    for (; j < n; j++) {
      const c = xml[j];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (j >= n) return;
    const inner = xml.slice(lt + 1, j);
    i = j + 1;
    if (inner[0] === '/') {
      h.close?.(localName(inner.slice(1).trim()));
      continue;
    }
    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const sp = body.search(/[\s]/);
    const name = localName(sp < 0 ? body : body.slice(0, sp));
    if (!name) continue;
    const attrs = sp < 0 ? {} : parseAttrs(body.slice(sp));
    h.open?.(name, attrs, selfClosing);
    if (selfClosing) h.close?.(name);
  }
}

/** OOXML escapes control characters in strings as `_xHHHH_`. */
export function decodeOoxmlEscapes(s: string): string {
  return s.includes('_x') ? s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : s;
}

/* ───────────────────────── Dates & numbers ───────────────────────── */

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Excel serial date → `YYYY-MM-DD` (calendar day, time-zone independent).
 * 1900 system: serial 1 = 1900-01-01, and Excel's phantom 1900-02-29 is serial 60
 * (kept for Lotus compatibility) — it maps to 1900-02-28 here. 1904 system: serial 0 = 1904-01-01.
 */
export function excelSerialToDay(serial: number, date1904 = false): string {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) return '';
  const whole = Math.floor(serial + 1e-9);
  let utc: number;
  if (date1904) utc = Date.UTC(1904, 0, 1) + whole * 86400000;
  else if (whole === 0) return '';
  else if (whole < 60) utc = Date.UTC(1899, 11, 31) + whole * 86400000;
  else if (whole === 60) return '1900-02-28';
  else utc = Date.UTC(1899, 11, 30) + whole * 86400000;
  const d = new Date(utc);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Inverse of `excelSerialToDay` (1900 system) for a `YYYY-MM-DD` day. */
export function dayToExcelSerial(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const diff = Math.round((utc - Date.UTC(1899, 11, 30)) / 86400000);
  // Before 1 March 1900 Excel's serials are one lower (its phantom 29 Feb 1900 is serial 60).
  return diff >= 61 ? diff : diff >= 2 ? diff - 1 : null;
}

/** Number text from a cell `<v>`, without binary float noise. */
export function formatNumber(raw: string): string {
  const s = raw.trim();
  if (s === '') return '';
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (Number.isInteger(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER) return String(n);
  return String(parseFloat(n.toPrecision(15)));
}

/** Built-in number formats that are dates / times (ECMA-376 18.8.30). */
const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** A custom format code that renders a date (has d/m/y outside quotes / brackets, not just elapsed time). */
export function isDateFormatCode(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
    .split(';')[0];
  if (/[dy]/i.test(stripped)) return true;
  // "mmm" / "mmmm" alone is a month; "mm" next to h or s is minutes (a time, not a date).
  return /m/i.test(stripped) && !/[hs]/i.test(stripped) && !/^[#0.,\s%]*$/.test(stripped);
}

/* ───────────────────────── Reader ───────────────────────── */

export interface XlsxSheet {
  name: string;
  /** Non-empty rows, each padded to its own last cell; cells are strings. */
  rows: string[][];
}

export interface XlsxWorkbook {
  sheets: XlsxSheet[];
  date1904: boolean;
}

export interface XlsxReadOptions extends ZipLimits {
  /** Only parse these sheets (by name, case-insensitive). Default all. */
  sheets?: string[];
  /** Stop a sheet after this many non-empty rows (default 200 000). */
  maxRows?: number;
}

/** "BC" → 54 (0-based column index); -1 when not a column reference. */
export function columnIndex(ref: string): number {
  const m = /^\$?([A-Za-z]{1,3})/.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0 → "A", 26 → "AA". */
export function columnName(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  let inSi = false;
  let inT = false;
  let skip = 0; // inside <rPh> (phonetic) or <phoneticPr>: ignore text
  let cur = '';
  scanXml(xml, {
    open(name, _a, self) {
      if (name === 'si') {
        inSi = true;
        cur = '';
      } else if (name === 'rPh') skip++;
      else if (name === 't' && inSi && !self) inT = true;
    },
    close(name) {
      if (name === 'si') {
        out.push(decodeOoxmlEscapes(cur));
        inSi = false;
      } else if (name === 'rPh') skip--;
      else if (name === 't') inT = false;
    },
    text(t) {
      if (inSi && inT && skip <= 0) cur += t;
    },
  });
  return out;
}

/** Style index → true when that cell format displays a date. */
function parseDateStyles(xml: string): boolean[] {
  const custom = new Map<number, string>();
  const xfs: boolean[] = [];
  let inCellXfs = false;
  scanXml(xml, {
    open(name, a) {
      if (name === 'numFmt') custom.set(Number(a.numFmtId), a.formatCode ?? '');
      else if (name === 'cellXfs') inCellXfs = true;
      else if (name === 'xf' && inCellXfs) {
        const id = Number(a.numFmtId ?? 0);
        xfs.push(BUILTIN_DATE_FMTS.has(id) || (custom.has(id) && isDateFormatCode(custom.get(id) ?? '')));
      }
    },
    close(name) {
      if (name === 'cellXfs') inCellXfs = false;
    },
  });
  return xfs;
}

function parseSheet(xml: string, shared: string[], dateStyles: boolean[], date1904: boolean, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let rowHas = false;
  let col = 0;
  // current cell
  let cType = '';
  let cStyle = -1;
  let cCol = 0;
  let value = '';
  let inline = '';
  let inV = false;
  let inIs = false;
  let inT = false;
  let skip = 0;
  let inCell = false;
  let stop = false;

  const endRow = () => {
    if (rowHas) {
      // trim trailing blanks
      let w = row.length;
      while (w > 0 && row[w - 1] === '') w--;
      rows.push(row.slice(0, w));
      if (rows.length >= maxRows) stop = true;
    }
    row = [];
    rowHas = false;
    col = 0;
  };

  const cellText = (): string => {
    switch (cType) {
      case 's': {
        const idx = Number(value.trim());
        return Number.isInteger(idx) ? (shared[idx] ?? '') : '';
      }
      case 'inlineStr':
        return decodeOoxmlEscapes(inline);
      case 'str':
        return decodeOoxmlEscapes(value);
      case 'b':
        return value.trim() === '1' ? 'TRUE' : value.trim() === '0' ? 'FALSE' : '';
      case 'e':
        return '';
      case 'd': {
        // ISO 8601 date cell (Strict / some writers).
        const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
        return m ? m[1] : value.trim();
      }
      default: {
        if (value.trim() === '') return inline ? decodeOoxmlEscapes(inline) : '';
        if (cStyle >= 0 && dateStyles[cStyle]) {
          const day = excelSerialToDay(Number(value), date1904);
          if (day) return day;
        }
        return formatNumber(value);
      }
    }
  };

  scanXml(xml, {
    open(name, a, self) {
      if (stop) return;
      if (name === 'row') {
        endRow();
      } else if (name === 'c') {
        inCell = true;
        cType = a.t ?? '';
        cStyle = a.s !== undefined ? Number(a.s) : -1;
        const ci = a.r ? columnIndex(a.r) : -1;
        cCol = ci >= 0 ? ci : col;
        value = '';
        inline = '';
      } else if (inCell && name === 'v') inV = !self;
      else if (inCell && name === 'is') inIs = true;
      else if (inIs && name === 'rPh') skip++;
      else if (inIs && name === 't') inT = !self;
    },
    close(name) {
      if (stop) return;
      if (name === 'c' && inCell) {
        inCell = false;
        const text = cellText();
        if (cCol >= 0 && cCol < 16384) {
          if (text !== '') {
            while (row.length < cCol) row.push('');
            row[cCol] = text;
            rowHas = true;
          }
          col = cCol + 1;
        }
      } else if (name === 'v') inV = false;
      else if (name === 'is') inIs = false;
      else if (name === 'rPh') skip--;
      else if (name === 't') inT = false;
      else if (name === 'row') endRow();
    },
    text(t) {
      if (stop || !inCell) return;
      if (inV) value += t;
      else if (inIs && inT && skip <= 0) inline += t;
    },
  });
  endRow();
  // Fill holes left by `row[cCol] = text` (sparse assignment is avoided above, but be safe).
  return rows.map((r) => Array.from({ length: r.length }, (_, i) => r[i] ?? ''));
}

interface Rel {
  id: string;
  target: string;
  type: string;
}

function parseRels(xml: string | null): Rel[] {
  const out: Rel[] = [];
  if (!xml) return out;
  scanXml(xml, {
    open(name, a) {
      if (name === 'Relationship') out.push({ id: a.Id ?? '', target: a.Target ?? '', type: a.Type ?? '' });
    },
  });
  return out;
}

/** Resolve a relationship target relative to `xl/`. */
function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ['xl'];
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Read every (or the selected) worksheet of an .xlsx file. Throws `XlsxError` (a ZipError) on bad input. */
export async function readXlsx(input: Uint8Array | ArrayBuffer, options: XlsxReadOptions = {}): Promise<XlsxWorkbook> {
  const zip = openZip(input, options);
  const workbookXml = await zip.text('xl/workbook.xml');
  if (workbookXml === null) {
    if (zip.has('content.xml')) throw new ZipError('This is an OpenDocument (.ods) file. Save it as .xlsx or CSV and try again.');
    throw new ZipError('Not an Excel .xlsx workbook (xl/workbook.xml is missing).');
  }
  const sheetDefs: { name: string; rid: string }[] = [];
  let date1904 = false;
  scanXml(workbookXml, {
    open(name, a) {
      if (name === 'sheet') sheetDefs.push({ name: a.name ?? `Sheet${sheetDefs.length + 1}`, rid: a.id ?? '' });
      else if (name === 'workbookPr') date1904 = a.date1904 === '1' || a.date1904 === 'true';
    },
  });
  const rels = parseRels(await zip.text('xl/_rels/workbook.xml.rels'));
  const relById = new Map(rels.map((r) => [r.id, r]));
  const sstRel = rels.find((r) => /\/sharedStrings$/.test(r.type));
  const stylesRel = rels.find((r) => /\/styles$/.test(r.type));
  const sstXml = await zip.text(sstRel ? resolveTarget(sstRel.target) : 'xl/sharedStrings.xml');
  const stylesXml = await zip.text(stylesRel ? resolveTarget(stylesRel.target) : 'xl/styles.xml');
  const shared = sstXml ? parseSharedStrings(sstXml) : [];
  const dateStyles = stylesXml ? parseDateStyles(stylesXml) : [];

  const want = options.sheets?.map((s) => s.toLowerCase());
  const maxRows = options.maxRows ?? 200_000;
  const sheets: XlsxSheet[] = [];
  for (let i = 0; i < sheetDefs.length; i++) {
    const def = sheetDefs[i];
    if (want && !want.includes(def.name.toLowerCase())) continue;
    const rel = relById.get(def.rid);
    const path = rel ? resolveTarget(rel.target) : `xl/worksheets/sheet${i + 1}.xml`;
    const xml = (await zip.text(path)) ?? (await zip.text(`xl/worksheets/sheet${i + 1}.xml`));
    if (xml === null) continue; // chartsheet / missing part
    sheets.push({ name: def.name, rows: parseSheet(xml, shared, dateStyles, date1904, maxRows) });
  }
  return { sheets, date1904 };
}

export interface XlsxTable {
  headers: string[];
  rows: string[][];
  /** Name of the sheet the table came from. */
  sheet: string;
}

/** Header detection + padding, the same rules as `parseTable` in csv.ts. */
export function sheetToTable(sheet: XlsxSheet): XlsxTable {
  const rows = sheet.rows.filter((r) => r.some((c) => c.trim() !== '')).map((r) => r.map((c) => c.trim()));
  if (rows.length === 0) return { headers: [], rows: [], sheet: sheet.name };
  const hi = findHeaderRow(rows);
  const headerRow = rows[hi];
  const body = rows.slice(hi + 1);
  let width = headerRow.length;
  for (const r of body) width = Math.max(width, r.length);
  while (width > 0 && (headerRow[width - 1] ?? '') === '' && body.every((r) => (r[width - 1] ?? '') === '')) width--;
  const headers = Array.from({ length: width }, (_, i) => headerRow[i] || `Column ${i + 1}`);
  return { headers, rows: body.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')), sheet: sheet.name };
}

/** First non-empty sheet as an importer table (`{headers, rows}`, like the CSV importer). */
export async function readXlsxTable(input: Uint8Array | ArrayBuffer, options: XlsxReadOptions = {}): Promise<XlsxTable> {
  const wb = await readXlsx(input, options);
  const sheet = wb.sheets.find((s) => s.rows.length > 0) ?? wb.sheets[0];
  if (!sheet) return { headers: [], rows: [], sheet: '' };
  return sheetToTable(sheet);
}

/**
 * First non-empty sheet as CSV text, so text-based importers (import wizard,
 * bank statements) can take an .xlsx without changing their parsing.
 */
export async function xlsxToCsv(input: Uint8Array | ArrayBuffer, options: XlsxReadOptions = {}): Promise<string> {
  const wb = await readXlsx(input, options);
  const sheet = wb.sheets.find((s) => s.rows.length > 0);
  return sheet ? writeCsv(sheet.rows) : '';
}

export const XLSX_FILE_RE = /\.(xlsx|xlsm)$/i;

/* ───────────────────────── Writer ───────────────────────── */

export type XlsxCell = string | number | boolean | null | undefined;

export interface XlsxSheetInput {
  name: string;
  rows: XlsxCell[][];
  /** Bold first row (default true). */
  header?: boolean;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Escape text for XML and drop characters XML 1.0 cannot carry. */
export function escapeXml(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Excel sheet names: max 31 chars, none of []:*?/\ , unique (case-insensitive). */
function sheetNames(inputs: readonly XlsxSheetInput[]): string[] {
  const used = new Set<string>();
  return inputs.map((s, i) => {
    const base = (s.name || `Sheet${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base.slice(0, 31 - String(k).length - 1)} ${k}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function sheetXml(rows: readonly XlsxCell[][], header: boolean): string {
  const out: string[] = [];
  rows.forEach((r, ri) => {
    const cells: string[] = [];
    r.forEach((v, ci) => {
      const ref = `${columnName(ci)}${ri + 1}`;
      const style = header && ri === 0 ? ' s="1"' : '';
      if (v === null || v === undefined || v === '') return;
      if (typeof v === 'number') {
        if (Number.isFinite(v)) cells.push(`<c r="${ref}"${style}><v>${v}</v></c>`);
        return;
      }
      if (typeof v === 'boolean') {
        cells.push(`<c r="${ref}"${style} t="b"><v>${v ? 1 : 0}</v></c>`);
        return;
      }
      const text = escapeXml(safeText(String(v)));
      cells.push(`<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`);
    });
    out.push(`<row r="${ri + 1}">${cells.join('')}</row>`);
  });
  const freeze = header && rows.length > 1
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<sheetData>${out.join('')}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Build an .xlsx workbook. Text cells get the CSV formula-injection guard. */
export async function writeXlsx(sheets: readonly XlsxSheetInput[], options: { date?: Date; compress?: boolean } = {}): Promise<Uint8Array> {
  if (sheets.length === 0) throw new Error('A workbook needs at least one sheet.');
  const names = sheetNames(sheets);
  const ws = sheets.map((s, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, xml: sheetXml(s.rows, s.header !== false), name: names[i] }));
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ws
    .map((w) => `<Override PartName="/${w.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('')}</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${ws
    .map((w, i) => `<sheet name="${escapeXml(w.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ws
    .map((_w, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('')}<Relationship Id="rId${ws.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return writeZip(
    [
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rootRels },
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
      { name: 'xl/styles.xml', data: STYLES_XML },
      ...ws.map((w) => ({ name: w.path, data: w.xml })),
    ],
    options,
  );
}

/** Rows parsed back out of a CSV string produced by `toCsv` → numbers where the text is a plain number. */
export function csvRowsToCells(rows: string[][]): XlsxCell[][] {
  return rows.map((r) => r.map((c) => (/^-?\d+(\.\d+)?$/.test(c) && !/^-?0\d/.test(c) && c.length < 16 ? Number(c) : c)));
}

/** Build and save an .xlsx in the browser. */
export async function downloadXlsx(filename: string, sheets: readonly XlsxSheetInput[]): Promise<void> {
  const bytes = await writeXlsx(sheets);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  downloadBlob(filename, new Blob([copy], { type: XLSX_MIME }));
}
