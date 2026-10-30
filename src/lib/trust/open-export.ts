/**
 * R4-C6 open-format data export ("The Long Now"): the whole company as plain spreadsheets with a description of
 * every column, so it can be read without this app.
 *
 *  - One CSV per table (every backed-up `mrchartist_inv_*` array key) and per object key (path / value rows).
 *  - Rows are flattened one level (`client.name`, `client.gstin`); the line arrays become child CSVs
 *    (`invoice_items` keyed by `invoice_id`, `purchase_lines` by `purchase_id`, `voucher_lines` by `voucher_id`);
 *    anything deeper is a JSON column.
 *  - Images (logo / signature) come out as files under `assets/`, referenced by path, never data URIs in cells.
 *  - Left out: device-local keys, sync bookkeeping, per-device drafts / prefs, vault records, the recycle bin (unless
 *    chosen), attachment files (unless chosen: then under `attachments/` with an index CSV), payroll tables without
 *    `payroll.view`.
 *  - `schema.json` (table → columns with type and meaning, from `open-export-schema.ts`, fallback "unknown") and
 *    `README.md`. CSV cells pass the formula guard (`toCsv`).
 * Pure: the dialog reads storage, then zips (`zip.ts`) and optionally writes one workbook (`xlsx.ts`).
 */
import { toCsv } from '../csv';
import { DB_PREFIX, DEVICE_DRAFT_KEYS, SYNC_META_KEYS, isLocalOnlyKey } from '../storage';
import { PAYROLL_TABLES, columnMeaning, tableMeaning, type ColumnType } from './open-export-schema';

type Row = Record<string, unknown>;
const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

/** Per-device bookkeeping that is not company data. */
const DEVICE_BOOKKEEPING = new Set(['draft', 'timer', 'backup_snooze', 'auto_backup', 'install_dismissed', 'notif_state', 'export_prefs', '__probe', 'schema_version']);
const LEFT_OUT = new Set<string>([...SYNC_META_KEYS, ...DEVICE_DRAFT_KEYS]);
const ATT_PREFIX = `${DB_PREFIX}att_`;

export interface ExportOptions {
  includeBin: boolean;
  includeAttachments: boolean;
  /** `payroll.view` of the person exporting. */
  payroll: boolean;
}

/** Table / object names to export from the stored keys (full key names in), sorted. */
export function exportableKeys(keys: readonly string[], opts: ExportOptions): string[] {
  const out: string[] = [];
  for (const k of keys) {
    if (!k.startsWith(DB_PREFIX) || isLocalOnlyKey(k) || LEFT_OUT.has(k) || k.startsWith(ATT_PREFIX) || k.includes('__vault__')) continue;
    const name = k.slice(DB_PREFIX.length);
    if (DEVICE_BOOKKEEPING.has(name) || name === 'assets') continue;
    if (name === 'recycle_bin' && !opts.includeBin) continue;
    if (PAYROLL_TABLES.has(name) && !opts.payroll) continue;
    out.push(name);
  }
  return out.sort();
}

/* ── Images → files ──────────────────────────────────────────── */

const DATA_URL = /^data:(image\/(png|jpeg|jpg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/]*={0,2})$/;
const EXT: Record<string, string> = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', gif: 'gif', 'svg+xml': 'svg' };

/** Collects images found in cells; the same image is written once. */
export class AssetSink {
  readonly files: { path: string; base64: string; mime: string }[] = [];
  private byUrl = new Map<string, string>();
  /** The `assets/…` path standing for a data URL (or the value unchanged). */
  ref(v: string): string {
    if (!v.startsWith('data:image/')) return v;
    const hit = this.byUrl.get(v);
    if (hit) return hit;
    const m = DATA_URL.exec(v);
    if (!m) return '(image)';
    const path = `assets/image-${this.files.length + 1}.${EXT[m[2]] ?? 'bin'}`;
    this.files.push({ path, base64: m[3], mime: m[1] });
    this.byUrl.set(v, path);
    return path;
  }
  /** A deep copy of `v` with every image data URL replaced by its path. */
  replace(v: unknown): unknown {
    if (typeof v === 'string') return this.ref(v);
    if (Array.isArray(v)) return v.map((x) => this.replace(x));
    if (isObj(v)) {
      const o: Row = {};
      for (const [k, x] of Object.entries(v)) o[k] = this.replace(x);
      return o;
    }
    return v;
  }
}

/* ── Flattening ──────────────────────────────────────────────── */

/** Arrays of a table that become their own CSV: table → field → [child name, key column]. */
export const CHILD_ARRAYS: Readonly<Record<string, Readonly<Record<string, [string, string]>>>> = {
  invoices: { items: ['invoice_items', 'invoice_id'] },
  purchases: { lines: ['purchase_lines', 'purchase_id'] },
  vouchers: { lines: ['voucher_lines', 'voucher_id'] },
};

export interface FlatTable {
  name: string;
  columns: string[];
  rows: unknown[][];
  types: Record<string, ColumnType>;
}

const cellOf = (v: unknown, sink: AssetSink): unknown => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return sink.ref(v);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return JSON.stringify(sink.replace(v));
};

/** One row → flat record: primitives as they are, objects one level deep (`a.b`), deeper values JSON. */
function flatRow(r: Row, sink: AssetSink, skip: ReadonlySet<string>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) {
    if (skip.has(k)) continue;
    if (isObj(v)) {
      for (const [k2, v2] of Object.entries(v)) out[`${k}.${k2}`] = cellOf(v2, sink);
    } else out[k] = cellOf(v, sink);
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?([+-]\d{2}:?\d{2})?)?$/;

function typeOf(values: readonly unknown[], raw: readonly unknown[]): ColumnType {
  const vals = values.filter((v) => v !== '' && v !== undefined && v !== null);
  if (!vals.length) return 'string';
  if (raw.some((v) => v && typeof v === 'object')) return 'json';
  if (vals.every((v) => typeof v === 'number')) return 'number';
  if (vals.every((v) => typeof v === 'boolean')) return 'bool';
  if (vals.every((v) => typeof v === 'string' && DATE_RE.test(v))) return 'date';
  return 'string';
}

/** Stable column order: `id` first, then the order each column is first seen. */
function columnsOf(rows: readonly Row[], lead: readonly string[] = ['id']): string[] {
  const seen = new Set<string>();
  const cols: string[] = [];
  const add = (c: string) => {
    if (seen.has(c)) return;
    seen.add(c);
    cols.push(c);
  };
  for (const c of lead) if (rows.some((r) => c in r)) add(c);
  for (const r of rows) for (const k of Object.keys(r)) add(k);
  return cols;
}

function toFlat(name: string, flat: Row[], rawOf: (col: string) => unknown[], lead?: string[]): FlatTable {
  const columns = columnsOf(flat, lead);
  const types: Record<string, ColumnType> = {};
  for (const c of columns) types[c] = typeOf(flat.map((r) => r[c]), rawOf(c));
  return { name, columns, rows: flat.map((r) => columns.map((c) => r[c] ?? '')), types };
}

/** A table → its CSV table plus child tables (line arrays). */
export function flattenTable(name: string, rows: readonly unknown[], sink: AssetSink): FlatTable[] {
  const objects = rows.filter(isObj);
  const children = CHILD_ARRAYS[name] ?? {};
  const skip = new Set(Object.keys(children));
  const flat = objects.map((r) => flatRow(r, sink, skip));
  const rawOf = (col: string) => objects.map((r) => (col.includes('.') ? (isObj(r[col.split('.')[0]]) ? (r[col.split('.')[0]] as Row)[col.slice(col.indexOf('.') + 1)] : undefined) : r[col]));
  const out = [toFlat(name, flat, rawOf)];
  for (const [field, [child, key]] of Object.entries(children)) {
    const rawChild: Row[] = [];
    const flatChild: Row[] = [];
    for (const r of objects) {
      const list = Array.isArray(r[field]) ? (r[field] as unknown[]) : [];
      list.forEach((l, i) => {
        if (!isObj(l)) return;
        rawChild.push(l);
        flatChild.push({ [key]: r.id ?? '', line_no: i + 1, ...flatRow(l, sink, new Set()) });
      });
    }
    const rawC = (col: string) => rawChild.map((r) => r[col]);
    out.push(toFlat(child, flatChild, rawC, [key, 'line_no', 'id']));
  }
  return out;
}

/** An object key → path / value rows (one level; deeper values JSON). */
export function flattenObject(name: string, value: unknown, sink: AssetSink): FlatTable {
  const rows: unknown[][] = [];
  if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (isObj(v)) for (const [k2, v2] of Object.entries(v)) rows.push([`${k}.${k2}`, cellOf(v2, sink)]);
      else rows.push([k, cellOf(v, sink)]);
    }
  } else rows.push(['value', cellOf(value, sink)]);
  return { name, columns: ['path', 'value'], rows, types: { path: 'string', value: 'string' } };
}

export const csvOf = (t: FlatTable): string => '﻿' + toCsv([t.columns, ...t.rows]);

/* ── Schema and README ───────────────────────────────────────── */

export interface SchemaJson {
  generated: string;
  company: string;
  conventions: Record<string, string>;
  tables: Record<string, { file: string; meaning: string; rows: number; columns: Record<string, { type: ColumnType; meaning: string }> }>;
}

export function buildSchema(tables: readonly FlatTable[], company: string, generated: string): SchemaJson {
  const out: SchemaJson = {
    generated,
    company,
    conventions: {
      money: 'Rupees with 2 decimals as stored (receipts and foreign documents in their own currency; voucher lines in paise).',
      dates: 'Local calendar days YYYY-MM-DD; *_at columns are ISO 8601 times in UTC.',
      json: 'Columns of type json hold the nested value as JSON text.',
      images: 'Logos / signatures are files under assets/; cells hold their path.',
    },
    tables: {},
  };
  for (const t of tables) {
    const columns: SchemaJson['tables'][string]['columns'] = {};
    for (const c of t.columns) columns[c] = { type: t.types[c] ?? 'string', meaning: columnMeaning(c.includes('.') ? c.slice(c.lastIndexOf('.') + 1) : c) };
    out.tables[t.name] = { file: `${t.name}.csv`, meaning: tableMeaning(t.name), rows: t.rows.length, columns };
  }
  return out;
}

export function buildReadme(tables: readonly FlatTable[], company: string, generated: string, opts: ExportOptions & { workbook: boolean; attachments: number; images: number }): string {
  return [
    `# ${company || 'Company'}: full data export`,
    '',
    `Made on ${generated} by Mr. Chartist Invoice. Every file opens in a spreadsheet; nothing here needs this app.`,
    '',
    '## Files',
    '',
    ...tables.map((t) => `- \`${t.name}.csv\`: ${tableMeaning(t.name)} (${t.rows.length} row${t.rows.length === 1 ? '' : 's'})`),
    '- `schema.json`: every table and column with its type (string / number / date / bool / json) and meaning ("unknown" when not described).',
    ...(opts.workbook ? ['- `workbook.xlsx`: the same tables, one sheet each (header row bold).'] : []),
    ...(opts.images ? [`- \`assets/\`: ${opts.images} logo / signature image(s) referenced from the CSVs.`] : []),
    ...(opts.attachments ? [`- \`attachments/\`: ${opts.attachments} attached file(s), listed in \`attachments_index.csv\`.`] : []),
    '',
    '## Conventions',
    '',
    '- Money: rupees with 2 decimals as stored. Receipts on foreign-currency documents are in the document currency; voucher lines (`dr` / `cr`) are in paise.',
    '- Dates: local calendar days `YYYY-MM-DD`; `*_at` columns are ISO 8601 times in UTC.',
    '- Nested data: objects are flattened one level (`client.name`); invoice / bill / voucher lines are in their own CSV keyed by the parent id; deeper values are JSON text.',
    '- Cells starting with = + - @ are prefixed with an apostrophe so a spreadsheet never runs them as formulas.',
    '',
    '## Left out',
    '',
    '- This device\'s own settings (PIN, sign-in, language, sync bookkeeping, drafts) and vault records.',
    `- ${opts.includeBin ? 'The recycle bin is included (`recycle_bin.csv`).' : 'The recycle bin (recently deleted rows).'}`,
    ...(opts.includeAttachments ? [] : ['- Attached files (receipts, photos).']),
    ...(opts.payroll ? [] : ['- Payroll tables (you do not have the payroll right).']),
    '',
    '## Re-importing',
    '',
    'This export is for reading and for other tools. The only lossless way back into this app is its own JSON backup',
    '(Settings → Data → Download backup). Clients, items and opening invoices can be imported from CSV in Settings → Data.',
    '',
  ].join('\n');
}

/** File name: company + date, safe for every OS. */
export function exportFileName(company: string, day: string): string {
  const stem = (company || 'company').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'company';
  return `${stem}-data-export-${day}.zip`;
}
