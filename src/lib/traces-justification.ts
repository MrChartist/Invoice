/**
 * TRACES justification report import (7R, 7.120). After a TDS statement is processed, TRACES issues a
 * "justification report" listing the defaults it found: short deduction, short payment, interest on late
 * deduction / late payment, late filing fee (Sec 234E) and PAN errors. The file is downloaded from TRACES (a
 * text / CSV export — the layout varies by version and is NOT verified here), loaded into the app and matched to
 * our own deductions (`tdsDeductions`) so the TDS register can show which rows TRACES questions.
 *
 * The file is UNTRUSTED input: at most `MAX_JUSTIFICATION_CHARS` characters and `MAX_JUSTIFICATION_LINES` lines
 * are read, at most `MAX_FINDINGS` rows kept, every cell is trimmed to `MAX_CELL` characters with control
 * characters removed, nothing in it is executed or used as a key / path, and exports go through `toCsv` (formula
 * guard). Section titles and columns are recognised by keywords (case-insensitive); rows that cannot be read are
 * counted, never guessed. Table `tds_justifications` (one row per import; backups, `books.edit`, audit `tds`).
 *
 * Working paper — the TRACES demand is what counts; resolve it through a correction statement / TRACES and verify
 * with your CA. Pure above the "Storage" divider.
 */

import { requireAccess } from './access';
import { audit } from './audit';
import { parseCsv, stripBom, toCsv } from './csv';
import { isoDay } from './dates';
import { round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import type { TdsDeductionRow } from './tds-payables';

export const TDS_JUSTIFICATIONS_TABLE = 'tds_justifications';
export const MAX_JUSTIFICATION_CHARS = 2_000_000;
export const MAX_JUSTIFICATION_LINES = 20_000;
export const MAX_FINDINGS = 5_000;
export const MAX_CELL = 200;

export const JUSTIFICATION_NOTE = 'Working paper — findings read from a TRACES justification report (layout not verified). The TRACES demand is what counts: correct the statement or pay through TRACES and verify with your CA.';

export type JustificationKind = 'SHORT_DEDUCTION' | 'SHORT_PAYMENT' | 'LATE_DEDUCTION' | 'LATE_PAYMENT' | 'LATE_FILING' | 'PAN_ERROR' | 'OTHER';

export const JUSTIFICATION_KINDS: readonly JustificationKind[] = ['SHORT_DEDUCTION', 'SHORT_PAYMENT', 'LATE_DEDUCTION', 'LATE_PAYMENT', 'LATE_FILING', 'PAN_ERROR', 'OTHER'];

export interface JustificationFinding {
  kind: JustificationKind;
  pan: string;
  name: string;
  section: string;
  /** Date of payment / credit (local day) when the row has one. */
  date: string;
  /** Amount paid / credited (₹). */
  base: number;
  /** TDS deducted as reported (₹). */
  tds: number;
  /** Default amount TRACES computed (short deduction / interest / fee …, ₹). */
  demand: number;
  /** Register key (`bill:…`, `pay:…`, `man:…`) once matched. */
  key?: string;
  /** Marked resolved by the user (correction filed / paid). */
  resolved?: boolean;
}

export interface JustificationMeta {
  tan: string;
  fy: number | null;
  quarter: number | null;
  form: string;
}

export interface ParsedJustification {
  meta: JustificationMeta;
  findings: JustificationFinding[];
  /** Data rows that could not be read (no PAN / name and no amount). */
  skipped: number;
  /** True when a cap cut the file short. */
  truncated: boolean;
}

const clean = (v: unknown): string =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, MAX_CELL);

/** "1,23,456.00" / "(12.50)" / "₹ 10" → number; '' / garbage → 0. */
export function parseAmount(v: string): number {
  const t = v.replace(/[₹,\s]/g, '').replace(/^Rs\.?/i, '');
  const neg = /^\(.*\)$/.test(t);
  const n = Number(t.replace(/[()]/g, ''));
  return Number.isFinite(n) ? round2(neg ? -n : n) : 0;
}

/** dd-mm-yyyy / dd/mm/yyyy / dd-Mon-yyyy / yyyy-mm-dd → local day ('' when not a date). */
export function parseTracesDate(v: string): string {
  const t = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return isoDay(`${m[1]}-${m[2]}-${m[3]}`);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return isoDay(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  m = /^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})$/.exec(t);
  if (m) {
    const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase());
    if (mon >= 0) return isoDay(`${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  }
  return '';
}

const SECTION_TITLES: readonly [RegExp, JustificationKind][] = [
  [/short\s*deduct/i, 'SHORT_DEDUCTION'],
  [/short\s*pay/i, 'SHORT_PAYMENT'],
  [/late\s*deduct|interest\s+on\s+late\s+deduct/i, 'LATE_DEDUCTION'],
  [/late\s*pay|interest\s+on\s+late\s+pay/i, 'LATE_PAYMENT'],
  [/late\s*filing|234\s*e/i, 'LATE_FILING'],
  [/pan\s*error|invalid\s*pan|pan\s*not\s*(available|valid)|structurally/i, 'PAN_ERROR'],
];

type Col = 'pan' | 'name' | 'section' | 'date' | 'base' | 'tds' | 'demand';

/** Column positions from a header row (keywords), or null when the row is not a header. */
export function headerColumns(cells: readonly string[]): Partial<Record<Col, number>> | null {
  const low = cells.map((c) => c.toLowerCase());
  const find = (re: RegExp, not?: RegExp) => low.findIndex((c) => re.test(c) && !(not && not.test(c)));
  const pan = find(/\bpan\b/, /error|valid|status/);
  const amountish = low.some((c) => /amount|deducted|interest|short|date/.test(c));
  if (pan < 0 || !amountish || cells.length < 3) return null;
  const cols: Partial<Record<Col, number>> = { pan };
  const set = (k: Col, i: number) => {
    if (i >= 0 && !Object.values(cols).includes(i)) cols[k] = i;
  };
  set('name', find(/name/));
  set('section', find(/section/));
  set('date', find(/date of (payment|credit)|payment\s*\/?\s*credit date|credit date|payment date/));
  if (cols.date === undefined) set('date', find(/date/, /deposit|deduction|filing|due/));
  set('base', find(/amount (paid|credited)|amount of payment|paid\s*\/\s*credited/));
  set('tds', find(/(tax|tds)\s*deducted|deducted amount/, /short|interest/));
  // The default amount: the last "short / interest / fee / demand / default" column.
  for (let i = low.length - 1; i >= 0; i--) {
    if (/short|interest|late fee|fee|demand|default|payable/.test(low[i]) && !Object.values(cols).includes(i)) {
      cols.demand = i;
      break;
    }
  }
  return cols;
}

/** Read a justification report (text). Never throws on bad input — unreadable rows are counted as skipped. */
export function parseJustification(input: string): ParsedJustification {
  let text = stripBom(String(input ?? ''));
  let truncated = false;
  if (text.length > MAX_JUSTIFICATION_CHARS) {
    text = text.slice(0, MAX_JUSTIFICATION_CHARS);
    truncated = true;
  }
  let lines = text.split(/\r\n|\r|\n/);
  if (lines.length > MAX_JUSTIFICATION_LINES) {
    lines = lines.slice(0, MAX_JUSTIFICATION_LINES);
    truncated = true;
  }
  // TRACES text exports are often '^'-separated: read them as tab-separated.
  const caret = lines.filter((l) => l.includes('^')).length > lines.length / 4;
  const rows = parseCsv(lines.map((l) => (caret ? l.replace(/\t/g, ' ').replace(/\^/g, '\t') : l)).join('\n'), { keepBlankRows: true, ...(caret ? { delimiter: '\t' as const } : {}) }).map((r) => r.map(clean));

  const all = rows.map((r) => r.join(' ')).join('\n');
  const fyM = /financial\s*year\D{0,6}(\d{4})\s*-\s*(\d{2,4})/i.exec(all);
  const qM = /quarter\D{0,4}Q?\s*([1-4])\b/i.exec(all);
  const tanM = /\b([A-Z]{4}\d{5}[A-Z])\b/.exec(all);
  const formM = /\b(24Q|26Q|27Q|27EQ)\b/i.exec(all);
  const meta: JustificationMeta = { tan: tanM?.[1] ?? '', fy: fyM ? Number(fyM[1]) : null, quarter: qM ? Number(qM[1]) : null, form: formM ? formM[1].toUpperCase() : '' };

  const findings: JustificationFinding[] = [];
  let kind: JustificationKind = 'OTHER';
  let cols: Partial<Record<Col, number>> | null = null;
  let skipped = 0;
  for (const r of rows) {
    const filled = r.filter((c) => c !== '');
    if (!filled.length) {
      cols = null;
      continue;
    }
    const joined = filled.join(' ');
    const title = filled.length <= 2 ? SECTION_TITLES.find(([re]) => re.test(joined)) : undefined;
    if (title) {
      kind = title[1];
      cols = null;
      continue;
    }
    const head = headerColumns(r);
    if (head) {
      cols = head;
      // A header naming its own default ("Short Deduction Amount") sets the kind when no title did.
      if (kind === 'OTHER') kind = SECTION_TITLES.find(([re]) => re.test(joined))?.[1] ?? 'OTHER';
      continue;
    }
    if (!cols) continue;
    const at = (k: Col) => (cols![k] !== undefined ? r[cols![k]!] ?? '' : '');
    const pan = at('pan').toUpperCase();
    const name = at('name');
    const f: JustificationFinding = {
      kind: kind === 'OTHER' && /PANNOTAVBL|INVALID/i.test(pan) ? 'PAN_ERROR' : kind,
      pan: /^[A-Z0-9]{10}$/.test(pan) ? pan : pan.slice(0, 20),
      name,
      section: at('section').toUpperCase().slice(0, 12),
      date: parseTracesDate(at('date')),
      base: parseAmount(at('base')),
      tds: parseAmount(at('tds')),
      demand: parseAmount(at('demand')),
    };
    if ((!f.pan && !f.name) || (!f.base && !f.tds && !f.demand)) {
      skipped++;
      continue;
    }
    if (findings.length >= MAX_FINDINGS) {
      truncated = true;
      break;
    }
    findings.push(f);
  }
  return { meta, findings, skipped, truncated };
}

/** True when the report's section code names the register row's section (94C ~ 194C-1, 4JB ~ 194J …). */
function sameSection(reported: string, row: Pick<TdsDeductionRow, 'section' | 'rpu' | 'code'>): boolean {
  if (!reported) return true;
  const r = reported.replace(/^SEC(TION)?\s*/i, '').replace(/[^0-9A-Z]/g, '');
  const cands = [row.rpu, row.section, row.code].map((x) => String(x ?? '').toUpperCase().replace(/[^0-9A-Z]/g, ''));
  return cands.some((c) => !!c && (c === r || c.endsWith(r) || r.endsWith(c)));
}

/**
 * Match findings to register rows: same PAN (or, without PAN, same name), compatible section, then the closest
 * by date (exact credit / deduction day first) and amount (₹1 tolerance on the base or the TDS). A register row is
 * matched at most once per kind. Returns new findings with `key` set where found.
 */
export function matchFindings(findings: readonly JustificationFinding[], rows: readonly TdsDeductionRow[]): JustificationFinding[] {
  const taken = new Set<string>();
  return findings.map((f) => {
    if (f.kind === 'LATE_FILING') return { ...f, key: undefined };
    const pool = rows.filter((r) => {
      const samePayee = /^[A-Z]{5}\d{4}[A-Z]$/.test(f.pan) ? r.pan === f.pan : !!f.name && r.payee.trim().toLowerCase() === f.name.trim().toLowerCase();
      return samePayee && sameSection(f.section, r) && !taken.has(`${f.kind}|${r.key}`);
    });
    const score = (r: TdsDeductionRow) => {
      let s = 0;
      if (f.date && (r.creditedOn === f.date || r.deductedOn === f.date)) s += 4;
      if (f.base && Math.abs(r.base - f.base) <= 1) s += 2;
      if (f.tds && Math.abs(r.amount - f.tds) <= 1) s += 2;
      return s;
    };
    const best = pool.map((r) => ({ r, s: score(r) })).filter((x) => x.s > 0 || (!f.date && !f.base && !f.tds)).sort((a, b) => b.s - a.s)[0];
    if (!best) return { ...f, key: undefined };
    taken.add(`${f.kind}|${best.r.key}`);
    return { ...f, key: best.r.key };
  });
}

export interface JustificationImport {
  id: string;
  imported_on: string;
  file_name: string;
  meta: JustificationMeta;
  findings: JustificationFinding[];
  skipped: number;
  truncated?: boolean;
  created_at?: string;
}

/** Open (unresolved) finding kinds per register key, across every import. */
export function flagsByKey(imports: readonly JustificationImport[]): Map<string, JustificationKind[]> {
  const out = new Map<string, JustificationKind[]>();
  for (const imp of imports) {
    for (const f of imp.findings) {
      if (!f.key || f.resolved) continue;
      const list = out.get(f.key) ?? [];
      if (!list.includes(f.kind)) list.push(f.kind);
      out.set(f.key, list);
    }
  }
  return out;
}

export function justificationSummary(findings: readonly JustificationFinding[]): Record<JustificationKind, { count: number; demand: number; matched: number }> {
  const out = Object.fromEntries(JUSTIFICATION_KINDS.map((k) => [k, { count: 0, demand: 0, matched: 0 }])) as Record<JustificationKind, { count: number; demand: number; matched: number }>;
  for (const f of findings) {
    const s = out[f.kind];
    s.count++;
    s.demand = round2(s.demand + f.demand);
    if (f.key) s.matched++;
  }
  return out;
}

export function justificationCsv(imp: JustificationImport): string {
  return toCsv([
    [JUSTIFICATION_NOTE],
    ['File', imp.file_name, 'TAN', imp.meta.tan, 'FY', imp.meta.fy ?? '', 'Quarter', imp.meta.quarter ?? '', 'Form', imp.meta.form],
    [],
    ['Default', 'PAN', 'Name', 'Section', 'Date of payment / credit', 'Amount paid (₹)', 'TDS (₹)', 'Default amount (₹)', 'Matched to', 'Resolved'],
    ...imp.findings.map((f) => [f.kind, f.pan, f.name, f.section, f.date, f.base, f.tds, f.demand, f.key ?? '', f.resolved ? 'Yes' : 'No']),
  ]);
}

/* ════════════════════════ Storage ════════════════════════ */

export class JustificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JustificationError';
  }
}

const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? clean(v) : '');
const money = (v: unknown): number => (Number.isFinite(Number(v)) ? round2(Number(v)) : 0);

function normalizeFinding(f: JustificationFinding): JustificationFinding {
  return {
    kind: f.kind,
    pan: text(f.pan),
    name: text(f.name),
    section: text(f.section),
    date: text(f.date),
    base: money(f.base),
    tds: money(f.tds),
    demand: money(f.demand),
    ...(text(f.key) ? { key: text(f.key) } : {}),
    ...(f.resolved === true ? { resolved: true } : {}),
  };
}

export function normalizeImports(rows: readonly unknown[]): JustificationImport[] {
  const out: JustificationImport[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Partial<JustificationImport>;
    if (typeof o.id !== 'string' || !Array.isArray(o.findings)) continue;
    // Review L7: rows come from backups / sync, so every field is checked, not only the id.
    const meta = (o.meta && typeof o.meta === 'object' ? o.meta : {}) as Partial<JustificationMeta>;
    out.push({
      id: o.id,
      imported_on: (typeof o.imported_on === 'string' ? clean(o.imported_on) : '') || (typeof o.created_at === 'string' ? clean(o.created_at).slice(0, 10) : ''),
      file_name: text(o.file_name),
      meta: { tan: text(meta.tan), fy: typeof meta.fy === 'number' && Number.isFinite(meta.fy) ? meta.fy : null, quarter: typeof meta.quarter === 'number' && Number.isFinite(meta.quarter) ? meta.quarter : null, form: text(meta.form) },
      findings: o.findings.filter((f): f is JustificationFinding => !!f && typeof f === 'object' && JUSTIFICATION_KINDS.includes((f as JustificationFinding).kind)).map(normalizeFinding),
      skipped: Number(o.skipped) || 0,
      ...(o.truncated === true ? { truncated: true } : {}),
      ...(text(o.created_at) ? { created_at: text(o.created_at) } : {}),
    });
  }
  return out.sort((a, b) => b.imported_on.localeCompare(a.imported_on));
}

export function loadJustifications(): JustificationImport[] {
  return normalizeImports(getTable<unknown>(TDS_JUSTIFICATIONS_TABLE));
}

/** Parse, match and store an import (books.edit, audited). Throws when nothing could be read. */
export function importJustification(fileName: string, text: string, rows: readonly TdsDeductionRow[], today: string): JustificationImport {
  requireAccess('books.edit');
  const parsed = parseJustification(text);
  if (!parsed.findings.length) throw new JustificationError('No default rows were found in this file. Load the justification report exported from TRACES (text / CSV).');
  const imp: JustificationImport = {
    id: generateId(),
    imported_on: isoDay(today) || today,
    file_name: clean(fileName) || 'justification report',
    meta: parsed.meta,
    findings: matchFindings(parsed.findings, rows),
    skipped: parsed.skipped,
    ...(parsed.truncated ? { truncated: true } : {}),
    created_at: new Date().toISOString(),
  };
  setTable(TDS_JUSTIFICATIONS_TABLE, [...getTable<unknown>(TDS_JUSTIFICATIONS_TABLE), imp]);
  const matched = imp.findings.filter((f) => f.key).length;
  audit.record({ entity: 'tds', entity_id: imp.id, action: 'create', doc_number: imp.meta.form || 'TRACES', summary: `TRACES justification report "${imp.file_name}" imported: ${imp.findings.length} default row(s), ${matched} matched to deductions${parsed.truncated ? ' (file cut at the import limit)' : ''}` });
  return imp;
}

/** Re-run matching on every stored import (after the register changed). */
export function rematchJustifications(rows: readonly TdsDeductionRow[]): JustificationImport[] {
  requireAccess('books.edit');
  const all = loadJustifications().map((imp) => ({ ...imp, findings: matchFindings(imp.findings, rows).map((f, i) => ({ ...f, resolved: imp.findings[i]?.resolved })) }));
  setTable(TDS_JUSTIFICATIONS_TABLE, all);
  return all;
}

export function setFindingResolved(importId: string, index: number, resolved: boolean): void {
  requireAccess('books.edit');
  const all = loadJustifications();
  const imp = all.find((x) => x.id === importId);
  const f = imp?.findings[index];
  if (!imp || !f) return;
  f.resolved = resolved || undefined;
  setTable(TDS_JUSTIFICATIONS_TABLE, all);
  audit.record({ entity: 'tds', entity_id: imp.id, action: 'update', doc_number: imp.meta.form || 'TRACES', summary: `TRACES default ${f.kind} for ${f.pan || f.name} (₹${f.demand.toFixed(2)}) marked ${resolved ? 'resolved' : 'open'}` });
}

export function deleteJustification(id: string): void {
  requireAccess('books.edit');
  const all = loadJustifications();
  const imp = all.find((x) => x.id === id);
  if (!imp) return;
  setTable(TDS_JUSTIFICATIONS_TABLE, all.filter((x) => x.id !== id));
  audit.record({ entity: 'tds', entity_id: id, action: 'delete', doc_number: imp.meta.form || 'TRACES', summary: `Deleted TRACES justification import "${imp.file_name}"` });
}
