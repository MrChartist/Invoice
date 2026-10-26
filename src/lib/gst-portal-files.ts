/**
 * R3-C4 GST portal file reader — WORKING PAPER, LAYOUT UNVERIFIED (verify with your CA).
 *
 * Reads two files the GST portal hands back, as `.json` or inside a `.zip`:
 *  - the GSTR-1 **error report** ("processed with error"): the upload's section keys (`b2b`, `b2cl`,
 *    `cdnr`, `cdnur`, `exp`, …) with `error_cd` / `error_msg` on a document or on its party group;
 *  - the **downloaded GSTR-1**: the same section keys without error fields.
 * Anything else is "not recognised" and nothing is saved. Parsing is tolerant (like the 2B reader): a
 * wrapper (`data`, `error_report`), string or number amounts and dd-mm-yyyy / yyyy-mm-dd dates are
 * accepted; unreadable parts become warnings. The structures are as understood from public
 * descriptions, not from a published schema — every screen says so.
 *
 * Each error is matched to our document by GSTIN + normalised number + date; "Download corrected JSON"
 * rebuilds the upload with `buildGstr1Json` on the failed documents only. The downloaded GSTR-1 is
 * diffed against the books (missing on portal / missing in books / value or tax differences ≥ ₹1).
 * Imports are saved in `gst_portal_files` (findings capped at 2,000). Nothing is uploaded anywhere.
 */

import type { CdnRow, DocRow, ExportRow, Gstr1Report, ReportPeriod } from './gst-reports';
import { periodRange } from './gst-reports';
import { amount, normBillNo, parse2bDate } from './gstr2b';
import { checkGstin } from './gstin';
import { isZip, openZip } from './zip';
import { round2 } from './invoice-calc';
import { requireAccess } from './access';
import { audit } from './audit';
import { getTable, setTable } from './storage';
import { withTablesRollback } from './table-txn';

export const PORTAL_FILES_TABLE = 'gst_portal_files';
/** Findings kept per saved import. */
export const MAX_FINDINGS = 2000;
/** A value / tax difference smaller than this (₹) is not reported. */
export const DIFF_THRESHOLD = 1;

export type PortalFileKind = 'gstr1_error' | 'gstr1_data';
export type DocSection = 'b2b' | 'b2cl' | 'cdnr' | 'cdnur' | 'exp';
/** Document sections we read per document; summary sections only carry section-level errors. */
export const DOC_SECTIONS: readonly DocSection[] = ['b2b', 'b2cl', 'cdnr', 'cdnur', 'exp'];
export const SUMMARY_SECTIONS = ['b2cs', 'nil', 'hsn', 'doc_issue', 'at', 'txpd', 'b2ba', 'b2cla', 'cdnra', 'cdnura', 'expa', 'b2csa', 'supeco'] as const;

export interface PortalDoc {
  section: DocSection;
  /** Recipient GSTIN ('' for B2CL / CDNUR / exports). */
  ctin: string;
  number: string;
  /** Local day YYYY-MM-DD ('' when unreadable). */
  date: string;
  value: number;
  taxable: number;
  tax: number;
  pos: string;
  errorCode?: string;
  errorMsg?: string;
}

export interface SectionError {
  section: string;
  code: string;
  msg: string;
}

export interface ParsedPortalFile {
  kind: PortalFileKind | 'unknown';
  gstin: string;
  /** Return period MMYYYY as in the file ('' when absent). */
  fp: string;
  docs: PortalDoc[];
  /** Errors on summary sections (B2CS, HSN …) or groups without documents. */
  sectionErrors: SectionError[];
  warnings: string[];
}

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

const CODE_KEYS = ['error_cd', 'errorCd', 'error_code', 'err_cd', 'errCd'];
const MSG_KEYS = ['error_msg', 'errorMsg', 'error_message', 'err_msg', 'errMsg', 'error'];
const firstStr = (r: Rec, keys: readonly string[]) => {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
};
const errorOf = (r: Rec): { code: string; msg: string } | null => {
  const code = firstStr(r, CODE_KEYS);
  const msg = firstStr(r, MSG_KEYS);
  return code || msg ? { code, msg } : null;
};

/** The object that carries the section keys, whatever wrapper the portal / offline tool used. */
function findRoot(input: unknown): Rec {
  const root = asRec(input);
  const has = (r: Rec) => DOC_SECTIONS.some((s) => Array.isArray(r[s])) || SUMMARY_SECTIONS.some((s) => r[s] !== undefined);
  for (const cand of [root, asRec(root.data), asRec(root.error_report), asRec(root.errorReport), asRec(asRec(root.data).error_report)]) {
    if (has(cand)) return cand;
  }
  return root;
}

function docTotals(d: Rec): { taxable: number; tax: number } {
  let taxable = 0;
  let tax = 0;
  for (const it of arr(d.itms)) {
    const det = asRec(asRec(it).itm_det ?? it);
    taxable += amount(det.txval);
    tax += amount(det.iamt) + amount(det.camt) + amount(det.samt) + amount(det.csamt);
  }
  return { taxable: round2(taxable), tax: round2(tax) };
}

function readDoc(section: DocSection, ctin: string, d: Rec, groupErr: { code: string; msg: string } | null): PortalDoc {
  const note = section === 'cdnr' || section === 'cdnur';
  const number = str(note ? (d.nt_num ?? d.inum) : d.inum);
  const date = parse2bDate(note ? (d.nt_dt ?? d.idt) : d.idt);
  const err = errorOf(d) ?? groupErr;
  const t = docTotals(d);
  return {
    section,
    ctin: ctin.toUpperCase(),
    number,
    date,
    value: round2(amount(d.val)),
    taxable: t.taxable,
    tax: t.tax,
    pos: str(d.pos),
    ...(err?.code ? { errorCode: err.code } : {}),
    ...(err?.msg ? { errorMsg: err.msg } : {}),
  };
}

/** Detect the kind and read the documents of one parsed JSON value. Never throws. */
export function parsePortalJson(input: unknown): ParsedPortalFile {
  const root = findRoot(input);
  const out: ParsedPortalFile = { kind: 'unknown', gstin: str(root.gstin).toUpperCase(), fp: str(root.fp ?? root.ret_period), docs: [], sectionErrors: [], warnings: [] };
  let anyError = false;
  let anySection = false;
  for (const section of DOC_SECTIONS) {
    const list = root[section];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      out.warnings.push(`Section ${section} is not a list; skipped.`);
      continue;
    }
    anySection = true;
    for (const g of list) {
      const group = asRec(g);
      const groupErr = errorOf(group);
      const ctin = section === 'b2b' || section === 'cdnr' ? str(group.ctin) : '';
      // B2B / B2CL / exports keep documents under `inv`; CDNR under `nt`; CDNUR rows are the documents.
      const docs = section === 'cdnur' ? [group] : arr(section === 'cdnr' ? group.nt : group.inv).map(asRec);
      if (!docs.length && groupErr) {
        out.sectionErrors.push({ section, code: groupErr.code, msg: groupErr.msg });
        anyError = true;
      }
      for (const d of docs) {
        const doc = readDoc(section, ctin, d, groupErr);
        if (!doc.number) {
          out.warnings.push(`A ${section.toUpperCase()} document without a number was skipped.`);
          continue;
        }
        if (doc.errorCode || doc.errorMsg) anyError = true;
        out.docs.push(doc);
      }
    }
  }
  for (const section of SUMMARY_SECTIONS) {
    const v = root[section];
    if (v === undefined) continue;
    anySection = true;
    const rows = Array.isArray(v) ? v : [v];
    for (const r of rows) {
      const err = errorOf(asRec(r));
      if (err) {
        out.sectionErrors.push({ section, code: err.code, msg: err.msg });
        anyError = true;
      }
    }
  }
  const topErr = errorOf(root);
  if (topErr && anySection) {
    out.sectionErrors.push({ section: '', code: topErr.code, msg: topErr.msg });
    anyError = true;
  }
  out.kind = anyError ? 'gstr1_error' : anySection && (out.docs.length || out.gstin) ? 'gstr1_data' : 'unknown';
  return out;
}

/** Merge the readings of several JSON files of one zip. */
function merge(parts: ParsedPortalFile[]): ParsedPortalFile {
  const known = parts.filter((p) => p.kind !== 'unknown');
  if (!known.length) return { kind: 'unknown', gstin: '', fp: '', docs: [], sectionErrors: [], warnings: parts.flatMap((p) => p.warnings) };
  return {
    kind: known.some((p) => p.kind === 'gstr1_error') ? 'gstr1_error' : 'gstr1_data',
    gstin: known.find((p) => p.gstin)?.gstin ?? '',
    fp: known.find((p) => p.fp)?.fp ?? '',
    docs: known.flatMap((p) => p.docs),
    sectionErrors: known.flatMap((p) => p.sectionErrors),
    warnings: parts.flatMap((p) => p.warnings),
  };
}

/** SHA-256 of the file bytes (hex), used to spot a re-import of the same file. */
export async function fileHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Read a `.json` or `.zip` (every `.json` inside). Never throws: unreadable input is kind 'unknown'. */
export async function readPortalFile(bytes: Uint8Array): Promise<ParsedPortalFile & { hash: string }> {
  const hash = await fileHash(bytes);
  try {
    if (isZip(bytes)) {
      const zip = openZip(bytes);
      const parts: ParsedPortalFile[] = [];
      for (const e of zip.entries.filter((x) => /\.json$/i.test(x.name)).slice(0, 20)) {
        const text = await zip.text(e.name);
        try {
          parts.push(parsePortalJson(JSON.parse(String(text ?? '').replace(/^\uFEFF/, ''))));
        } catch {
          parts.push({ kind: 'unknown', gstin: '', fp: '', docs: [], sectionErrors: [], warnings: [`${e.name} is not valid JSON.`] });
        }
      }
      return { ...merge(parts), hash };
    }
    const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
    return { ...parsePortalJson(JSON.parse(text)), hash };
  } catch {
    return { kind: 'unknown', gstin: '', fp: '', docs: [], sectionErrors: [], warnings: ['The file could not be read as JSON or ZIP.'], hash };
  }
}

/* ── Our documents ───────────────────────────────────────────── */

export interface BookDoc {
  section: DocSection;
  invoiceId: string;
  ctin: string;
  number: string;
  date: string;
  value: number;
  taxable: number;
  tax: number;
  pos: string;
}

const rowTax = (r: DocRow) => round2(r.igst + r.cgst + r.sgst + (r.cess ?? 0));

/** Every document of a GSTR-1 report, flattened with its section (notes compared as filed: positive amounts). */
export function bookDocs(g1: Pick<Gstr1Report, 'b2b' | 'b2cl' | 'cdnr' | 'cdnur' | 'exp'>): BookDoc[] {
  const mk = (section: DocSection, r: DocRow): BookDoc => ({
    section, invoiceId: r.invoiceId, ctin: (r.ctin || '').toUpperCase(), number: r.number, date: String(r.date).slice(0, 10),
    value: round2(Math.abs(r.value)), taxable: round2(Math.abs(r.taxable)), tax: round2(Math.abs(rowTax(r))), pos: r.pos,
  });
  return [
    ...g1.b2b.map((r) => mk('b2b', r)),
    ...g1.b2cl.map((r) => mk('b2cl', r)),
    ...g1.cdnr.map((r: CdnRow) => mk('cdnr', r)),
    ...g1.cdnur.map((r: CdnRow) => mk('cdnur', r)),
    ...g1.exp.map((r: ExportRow) => mk('exp', r)),
  ];
}

/** Match key: recipient GSTIN (or '-' for unregistered sections) + normalised number. */
export const docKey = (ctin: string, number: string) => `${(ctin || '-').toUpperCase()}|${normBillNo(number)}`;

/* ── Error report ────────────────────────────────────────────── */

export type ErrorHint = 'date_period' | 'gstin_invalid' | 'duplicate' | 'pos_mismatch' | 'rate_not_allowed' | 'other';

/** Plain-language hint for a portal error, from its message / code as understood (verify with your CA). */
export function errorHint(code: string | undefined, msg: string | undefined): ErrorHint {
  const t = `${code ?? ''} ${msg ?? ''}`.toLowerCase();
  if (/duplicate|already (exist|been|uploaded|filed|saved)/.test(t)) return 'duplicate';
  if (/place of supply|\bpos\b/.test(t)) return 'pos_mismatch';
  if (/\brate\b|tax rate|rt is/.test(t)) return 'rate_not_allowed';
  if (/gstin|ctin|uin|recipient.*(invalid|not (active|valid|registered))/.test(t)) return 'gstin_invalid';
  if (/date|period|financial year|cannot be (after|before)|future/.test(t)) return 'date_period';
  return 'other';
}

export interface ErrorRow {
  key: string;
  portal: PortalDoc;
  ours?: BookDoc;
  /** Same number but a different date in the books. */
  dateDiffers?: boolean;
  hint: ErrorHint;
}

/** Each erroneous portal document against our document (GSTIN + normalised number, then date). */
export function matchErrors(parsed: Pick<ParsedPortalFile, 'docs'>, books: readonly BookDoc[]): ErrorRow[] {
  const byKey = new Map<string, BookDoc[]>();
  for (const b of books) {
    const k = docKey(b.ctin, b.number);
    byKey.set(k, [...(byKey.get(k) ?? []), b]);
  }
  return parsed.docs
    .filter((d) => d.errorCode || d.errorMsg)
    .map((d) => {
      const key = `${d.section}|${docKey(d.ctin, d.number)}|${d.date}`;
      const candidates = byKey.get(docKey(d.ctin, d.number)) ?? [];
      const exact = candidates.find((c) => !d.date || c.date === d.date);
      const ours = exact ?? candidates[0];
      return { key, portal: d, ...(ours ? { ours } : {}), ...(ours && !exact ? { dateDiffers: true } : {}), hint: errorHint(d.errorCode, d.errorMsg) };
    });
}

/** The report cut down to the given documents (by section + invoice id): only document sections survive. */
export function subsetReport(g1: Gstr1Report, keep: ReadonlySet<string>): Gstr1Report {
  const pick = <T extends DocRow>(section: DocSection, rows: T[]) => rows.filter((r) => keep.has(`${section}|${r.invoiceId}`));
  const b2b = pick('b2b', g1.b2b);
  const b2cl = pick('b2cl', g1.b2cl);
  const cdnr = pick('cdnr', g1.cdnr);
  const cdnur = pick('cdnur', g1.cdnur);
  const exp = pick('exp', g1.exp);
  const all: DocRow[] = [...b2b, ...b2cl, ...cdnr, ...cdnur, ...exp];
  const sum = (f: (r: DocRow) => number) => round2(all.reduce((s, r) => s + f(r), 0));
  return {
    ...g1,
    b2b, b2cl, cdnr, cdnur, exp,
    b2cs: [], nil: [], hsn: [], hsnB2b: [], hsnB2c: [], docIssue: [],
    amendments: undefined, at: undefined, txpd: undefined, eco: undefined,
    totals: { taxable: sum((r) => r.taxable), igst: sum((r) => r.igst), cgst: sum((r) => r.cgst), sgst: sum((r) => r.sgst), value: sum((r) => r.value), cess: sum((r) => r.cess ?? 0) },
    counts: { included: all.length, drafts: 0, cancelled: 0, notTaxDocs: 0 },
  };
}

export type SubsetIssue = { invoiceId: string; number: string; problem: 'gstin' | 'date' | 'number' };

/** Preflight of the corrected subset: recipient GSTIN valid, date inside the period, number present. */
export function subsetChecks(subset: Pick<Gstr1Report, 'b2b' | 'b2cl' | 'cdnr' | 'cdnur' | 'exp'>, period: ReportPeriod): SubsetIssue[] {
  const { from, to } = periodRange(period);
  const out: SubsetIssue[] = [];
  for (const d of bookDocs(subset)) {
    if (!d.number.trim()) out.push({ invoiceId: d.invoiceId, number: d.number, problem: 'number' });
    if ((d.section === 'b2b' || d.section === 'cdnr') && !checkGstin(d.ctin).valid) out.push({ invoiceId: d.invoiceId, number: d.number, problem: 'gstin' });
    if (d.date < from || d.date > to) out.push({ invoiceId: d.invoiceId, number: d.number, problem: 'date' });
  }
  return out;
}

/* ── Downloaded GSTR-1 vs books ──────────────────────────────── */

export type DiffClass = 'missing_on_portal' | 'missing_in_books' | 'value_diff';

export interface DiffRow {
  key: string;
  cls: DiffClass;
  section: DocSection;
  number: string;
  date: string;
  ctin: string;
  books?: BookDoc;
  portal?: PortalDoc;
  /** Books minus portal (value_diff rows). */
  dTaxable?: number;
  dTax?: number;
}

/** Portal documents vs the books of the same period × GSTIN; differences under ₹1 are ignored. */
export function diffPortalBooks(parsed: Pick<ParsedPortalFile, 'docs'>, books: readonly BookDoc[], threshold = DIFF_THRESHOLD): DiffRow[] {
  const portal = new Map<string, PortalDoc>();
  for (const d of parsed.docs) portal.set(docKey(d.ctin, d.number), d);
  const seen = new Set<string>();
  const out: DiffRow[] = [];
  for (const b of books) {
    const k = docKey(b.ctin, b.number);
    seen.add(k);
    const p = portal.get(k);
    if (!p) {
      out.push({ key: `mp|${k}`, cls: 'missing_on_portal', section: b.section, number: b.number, date: b.date, ctin: b.ctin, books: b });
      continue;
    }
    const dTaxable = round2(b.taxable - p.taxable);
    const dTax = round2(b.tax - p.tax);
    if (Math.abs(dTaxable) >= threshold || Math.abs(dTax) >= threshold) {
      out.push({ key: `vd|${k}`, cls: 'value_diff', section: b.section, number: b.number, date: b.date, ctin: b.ctin, books: b, portal: p, dTaxable, dTax });
    }
  }
  for (const [k, p] of portal) {
    if (seen.has(k)) continue;
    out.push({ key: `mb|${k}`, cls: 'missing_in_books', section: p.section, number: p.number, date: p.date, ctin: p.ctin, portal: p });
  }
  return out;
}

/* ── Saved imports ───────────────────────────────────────────── */

export interface PortalFinding {
  key: string;
  section: string;
  number: string;
  date: string;
  ctin: string;
  code?: string;
  msg?: string;
  hint?: ErrorHint;
  cls?: DiffClass;
  invoice_id?: string;
  d_taxable?: number;
  d_tax?: number;
}

export interface PortalFileRecord {
  id: string;
  kind: PortalFileKind;
  /** Return period MMYYYY. */
  period: string;
  gstin: string;
  file_hash: string;
  file_name?: string;
  imported_at: string;
  counts: { docs: number; errors?: number; matched?: number; missing_on_portal?: number; missing_in_books?: number; value_diff?: number; section_errors?: number };
  findings: PortalFinding[];
  resolved: Record<string, true>;
}

export function errorFindings(rows: readonly ErrorRow[], sectionErrors: readonly SectionError[] = []): PortalFinding[] {
  return [
    ...rows.map((r) => ({
      key: r.key, section: r.ours?.section ?? r.portal.section, number: r.portal.number, date: r.portal.date, ctin: r.portal.ctin,
      ...(r.portal.errorCode ? { code: r.portal.errorCode } : {}), ...(r.portal.errorMsg ? { msg: r.portal.errorMsg } : {}),
      hint: r.hint, ...(r.ours ? { invoice_id: r.ours.invoiceId } : {}),
    })),
    ...sectionErrors.map((e, i) => ({ key: `sec|${e.section}|${i}`, section: e.section, number: '', date: '', ctin: '', code: e.code, msg: e.msg, hint: errorHint(e.code, e.msg) })),
  ];
}

export function diffFindings(rows: readonly DiffRow[]): PortalFinding[] {
  return rows.map((r) => ({
    key: r.key, section: r.section, number: r.number, date: r.date, ctin: r.ctin, cls: r.cls,
    ...(r.books ? { invoice_id: r.books.invoiceId } : {}),
    ...(r.dTaxable !== undefined ? { d_taxable: r.dTaxable } : {}), ...(r.dTax !== undefined ? { d_tax: r.dTax } : {}),
  }));
}

/** Build the record saved for an import (findings capped at 2,000). Pure. */
export function buildRecord(input: { parsed: ParsedPortalFile & { hash: string }; findings: PortalFinding[]; counts: PortalFileRecord['counts']; fileName?: string; now?: Date; id?: string }): PortalFileRecord {
  const kind = input.parsed.kind === 'unknown' ? 'gstr1_data' : input.parsed.kind;
  return {
    id: input.id ?? `pf_${input.parsed.hash.slice(0, 16)}`,
    kind,
    period: input.parsed.fp,
    gstin: input.parsed.gstin,
    file_hash: input.parsed.hash,
    ...(input.fileName ? { file_name: input.fileName.slice(0, 120) } : {}),
    imported_at: (input.now ?? new Date()).toISOString(),
    counts: input.counts,
    findings: input.findings.slice(0, MAX_FINDINGS),
    resolved: {},
  };
}

/** A saved import of the same file (same hash), if any. */
export function findByHash(rows: readonly PortalFileRecord[], hash: string): PortalFileRecord | undefined {
  return rows.find((r) => r?.file_hash === hash);
}

/** Unresolved error findings of a period × GSTIN (the filing strip's "Portal errors (n)"). */
export function openPortalErrors(rows: readonly PortalFileRecord[], fp: string, gstin: string): number {
  return rows
    .filter((r) => r?.kind === 'gstr1_error' && r.period === fp && (!gstin || !r.gstin || r.gstin === gstin))
    .reduce((n, r) => n + (r.findings ?? []).filter((f) => !r.resolved?.[f.key]).length, 0);
}

export const portalFilesDb = {
  all: (): PortalFileRecord[] => getTable<PortalFileRecord>(PORTAL_FILES_TABLE),
  /** Save an import; a record with the same file hash is replaced (re-import). */
  save(rec: PortalFileRecord): PortalFileRecord {
    requireAccess('books.edit');
    withTablesRollback([PORTAL_FILES_TABLE], () => {
      setTable(PORTAL_FILES_TABLE, [...portalFilesDb.all().filter((r) => r.file_hash !== rec.file_hash && r.id !== rec.id), rec]);
    });
    audit.record({ entity: 'gst', entity_id: rec.id, action: 'import', summary: `GSTR-1 portal file read (${rec.kind === 'gstr1_error' ? 'error report' : 'downloaded data'}, ${rec.period || 'no period'}, ${rec.findings.length} finding(s)) — working paper` });
    return rec;
  },
  setResolved(id: string, key: string, on: boolean): void {
    requireAccess('books.edit');
    setTable(PORTAL_FILES_TABLE, portalFilesDb.all().map((r) => {
      if (r.id !== id) return r;
      const resolved = { ...(r.resolved ?? {}) };
      if (on) resolved[key] = true;
      else delete resolved[key];
      return { ...r, resolved };
    }));
  },
  remove(id: string): void {
    requireAccess('books.edit');
    setTable(PORTAL_FILES_TABLE, portalFilesDb.all().filter((r) => r.id !== id));
  },
};
