/**
 * GSTR-2B / IMS matcher (Roadmap 5.1).
 *
 * The user downloads their GSTR-2B from the GST portal (JSON, or the Excel
 * workbook) and loads it here; nothing is uploaded anywhere. Each 2B document is
 * matched against the purchase bills in the books (`purchases`, read through
 * `normalizePurchase` / `readPurchase`) on supplier GSTIN + normalised bill number,
 * then compared on taxable value, tax, tax heads and date.
 *
 * Classes:
 *  - matched           — found, figures agree within the tolerance;
 *  - mismatch          — found (or found by value only), but value / tax / heads / date / number differ;
 *  - missing_in_books  — in 2B, no bill in the books;
 *  - not_in_2b         — a bill in the books claiming ITC that is not in this 2B
 *                        (ITC at risk under Sec 16(2)(aa));
 *  - itc_unavailable   — 2B says ITC is not available (`itcavl: "N"`), matched or not.
 *
 * IMS: each 2B line can be marked Accept / Reject / Pending (table `gstr2b_actions`,
 * keyed by return period + section + supplier GSTIN + normalised document number).
 * No action means "deemed accepted", as on the portal.
 *
 * 3B effect: Table 4A(5) ("all other ITC") from the books is compared with what it
 * would be if ITC were limited to 2B lines that are accepted and available —
 * presented side by side; the GSTR-3B report itself is never changed.
 *
 * Field names assumed for the portal JSON (GSTR-2B "docdata"), all tolerant:
 *   b2b[]   : ctin, trdnm, supprd, supfildt, inv[]: inum, dt|idt, val, typ, pos, rev, itcavl, rsn,
 *             items[]|itms[]: rt, txval, igst|iamt, cgst|camt, sgst|samt, cess|csamt (or itm_det{...});
 *             invoice-level txval/igst/cgst/sgst/cess are used when there are no items.
 *   b2ba[]  : as b2b, inv[] also oinum, oidt.
 *   cdnr[]  : ctin, trdnm, nt[]: ntnum, dt, typ ("C" credit → negative / "D" debit), suptyp, val, pos, rev, itcavl, rsn, items.
 *   cdnra[] : as cdnr, nt[] also ontnum, ontdt.
 *   isd[]   : ctin, trdnm, doclist[]: doctyp ("ISD" / "ISDC" credit), docnum, docdt, igst, cgst, sgst, cess, itcelg.
 *   impg[]  : boenum, boedt, portcode, txval, igst, cess (no supplier GSTIN: customs).
 *   impgsez[]: ctin, trdnm, boe[]: as impg.
 * The wrapper may be { data: { gstin, rtnprd, gendt, docdata } }, { docdata }, or the sections directly.
 * Dates are dd-mm-yyyy (or yyyy-mm-dd). This is a working paper — verify with your CA.
 *
 * Pure apart from the `gstr2bActionsDb` storage helpers at the bottom.
 */

import type { PurchaseRecord } from '../types/purchases';
import { round2 } from './invoice-calc';
import { isVoidStatus, readPurchase } from './purchase-normalize';
import { normalizePurchase } from './gst-reports';
import { checkGstin } from './gstin';
import { generateId, getTable, setTable } from './storage';
import type { XlsxWorkbook } from './xlsx';

/* ───────────────────────── Types ───────────────────────── */

export type Gstr2bSection = 'B2B' | 'B2BA' | 'CDNR' | 'CDNRA' | 'ISD' | 'IMPG' | 'IMPGSEZ';

export interface TaxHeads {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Gstr2bLine extends TaxHeads {
  /** `${section}|${ctin}|${normalised number}` — unique within one 2B. */
  key: string;
  section: Gstr2bSection;
  /** Supplier (or ISD) GSTIN, upper-cased; '' for IMPG. */
  ctin: string;
  tradeName: string;
  /** Document number as printed (invoice / note / ISD document / Bill of Entry). */
  number: string;
  /** Local YYYY-MM-DD, '' if unreadable. */
  date: string;
  docType: 'INV' | 'CN' | 'DN' | 'ISD' | 'BOE';
  /** -1 for credit notes (they reduce ITC), else 1. Amounts are stored positive. */
  sign: 1 | -1;
  value: number;
  taxable: number;
  pos: string;
  reverseCharge: boolean;
  itcAvailable: boolean;
  /** Portal reason code / text when ITC is not available. */
  reason: string;
  /** Amendments: the original document. */
  originalNumber?: string;
  originalDate?: string;
  /** Supplier's GSTR-1 period (MMYYYY) when given. */
  supplierPeriod?: string;
}

export interface Gstr2bData {
  source: 'json' | 'xlsx';
  /** Recipient GSTIN in the file ('' when not stated). */
  gstin: string;
  /** Return period MMYYYY ('' when not stated). */
  period: string;
  generatedOn: string;
  lines: Gstr2bLine[];
  warnings: string[];
}

/* ───────────────────────── Small helpers ───────────────────────── */

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** Amount from JSON or a spreadsheet cell ("1,180.00", "₹ 90", "(12)"). Always finite. */
export function amount(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = str(v).replace(/[₹,\s]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

const pick = (r: Rec, keys: readonly string[]): unknown => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
  return undefined;
};

const yes = (v: unknown, dflt: boolean): boolean => {
  const s = str(v).toUpperCase();
  if (!s) return dflt;
  return s === 'Y' || s === 'YES' || s === 'TRUE' || s === '1';
};

/** 2B dates: dd-mm-yyyy / dd/mm/yyyy / yyyy-mm-dd / dd-Mon-yyyy → local YYYY-MM-DD ('' if unreadable). */
export function parse2bDate(v: unknown): string {
  const s = str(v);
  if (!s) return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})$/.exec(s);
  if (m) {
    const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase());
    return mon >= 0 ? ymd(+m[3], mon + 1, +m[1]) : '';
  }
  return '';
}

/** Whole days from `a` to `b` (both YYYY-MM-DD), calendar arithmetic. */
function dayDiff(a: string, b: string): number {
  const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

function ymd(y: number, mo: number, d: number): string {
  if (mo < 1 || mo > 12 || d < 1) return '';
  const days = new Date(y, mo, 0).getDate();
  if (d > days) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Normalise a bill / invoice number for matching: upper-case, drop spaces and
 * separators (/ \ - . _ , # :), and leading zeros of every digit run.
 * "INV/2024-25/0042" and "inv 2024 25 42" both become "INV20242542".
 */
export function normBillNo(s: string): string {
  return String(s ?? '')
    .toUpperCase()
    .replace(/(^|\D)0+(?=\d)/g, '$1') // before separators go, so "25/0042" keeps two runs
    .replace(/[\s/\\\-._,#:]+/g, '');
}

const lineKey = (section: Gstr2bSection, ctin: string, number: string) => `${section}|${ctin}|${normBillNo(number)}`;

/* ───────────────────────── JSON parser ───────────────────────── */

function itemHeads(items: unknown[]): TaxHeads & { taxable: number } {
  const t = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  for (const raw of items) {
    const it0 = asRec(raw);
    const it = Object.keys(asRec(it0.itm_det)).length ? asRec(it0.itm_det) : it0;
    t.taxable += amount(it.txval);
    t.igst += amount(pick(it, ['igst', 'iamt']));
    t.cgst += amount(pick(it, ['cgst', 'camt']));
    t.sgst += amount(pick(it, ['sgst', 'samt']));
    t.cess += amount(pick(it, ['cess', 'csamt']));
  }
  return t;
}

function docHeads(doc: Rec): TaxHeads & { taxable: number } {
  const items = arr(doc.items).length ? arr(doc.items) : arr(doc.itms);
  if (items.length) return itemHeads(items);
  return itemHeads([doc]);
}

function makeLine(
  section: Gstr2bSection,
  supplier: Rec,
  doc: Rec,
  number: string,
  date: string,
  docType: Gstr2bLine['docType'],
  extra: Partial<Gstr2bLine> = {},
): Gstr2bLine {
  const h = docHeads(doc);
  const ctin = str(pick(supplier, ['ctin', 'gstin'])).toUpperCase();
  const taxable = Math.abs(h.taxable);
  const heads = { igst: Math.abs(h.igst), cgst: Math.abs(h.cgst), sgst: Math.abs(h.sgst), cess: Math.abs(h.cess) };
  return {
    key: lineKey(section, ctin, number),
    section,
    ctin,
    tradeName: str(pick(supplier, ['trdnm', 'lglnm', 'name'])),
    number,
    date,
    docType,
    sign: docType === 'CN' ? -1 : 1,
    value: Math.abs(amount(doc.val)) || round2(taxable + heads.igst + heads.cgst + heads.sgst + heads.cess),
    taxable: round2(taxable),
    igst: round2(heads.igst),
    cgst: round2(heads.cgst),
    sgst: round2(heads.sgst),
    cess: round2(heads.cess),
    pos: str(doc.pos),
    reverseCharge: yes(doc.rev, false),
    itcAvailable: yes(pick(doc, ['itcavl', 'itcelg']), true),
    reason: str(doc.rsn),
    supplierPeriod: str(pick(supplier, ['supprd'])) || undefined,
    ...extra,
  };
}

/** Find the `docdata` object in whatever wrapper the portal / offline tool produced. */
function findDocdata(input: unknown): { doc: Rec; head: Rec } {
  const root = asRec(input);
  const data = asRec(root.data);
  if (Object.keys(asRec(data.docdata)).length) return { doc: asRec(data.docdata), head: data };
  if (Object.keys(asRec(root.docdata)).length) return { doc: asRec(root.docdata), head: root };
  if (Object.keys(data).length) return { doc: data, head: data };
  return { doc: root, head: root };
}

/** Parse a GSTR-2B JSON download. Never throws; unreadable parts become warnings. */
export function parseGstr2bJson(input: unknown): Gstr2bData {
  const { doc, head } = findDocdata(input);
  const lines: Gstr2bLine[] = [];
  const warnings: string[] = [];

  for (const s of arr(doc.b2b)) {
    const sup = asRec(s);
    for (const i of arr(sup.inv)) {
      const inv = asRec(i);
      lines.push(makeLine('B2B', sup, inv, str(inv.inum), parse2bDate(pick(inv, ['dt', 'idt'])), 'INV'));
    }
  }
  for (const s of arr(doc.b2ba)) {
    const sup = asRec(s);
    for (const i of arr(sup.inv)) {
      const inv = asRec(i);
      lines.push(
        makeLine('B2BA', sup, inv, str(inv.inum), parse2bDate(pick(inv, ['dt', 'idt'])), 'INV', {
          originalNumber: str(inv.oinum) || undefined,
          originalDate: parse2bDate(pick(inv, ['oidt', 'odt'])) || undefined,
        }),
      );
    }
  }
  for (const [section, amend] of [['CDNR', false], ['CDNRA', true]] as const) {
    for (const s of arr(doc[section.toLowerCase()])) {
      const sup = asRec(s);
      for (const n of arr(sup.nt)) {
        const nt = asRec(n);
        const typ = str(pick(nt, ['typ', 'ntty'])).toUpperCase();
        lines.push(
          makeLine(section, sup, nt, str(pick(nt, ['ntnum', 'nt_num'])), parse2bDate(pick(nt, ['dt', 'nt_dt'])), typ === 'D' ? 'DN' : 'CN', amend
            ? { originalNumber: str(pick(nt, ['ontnum', 'ont_num'])) || undefined, originalDate: parse2bDate(pick(nt, ['ontdt', 'ont_dt'])) || undefined }
            : {}),
        );
      }
    }
  }
  for (const s of arr(doc.isd)) {
    const sup = asRec(s);
    for (const d of arr(sup.doclist)) {
      const dl = asRec(d);
      const credit = /C$/i.test(str(dl.doctyp));
      const line = makeLine('ISD', sup, dl, str(pick(dl, ['docnum', 'docno'])), parse2bDate(pick(dl, ['docdt', 'dt'])), credit ? 'CN' : 'ISD');
      lines.push(line);
    }
  }
  for (const b of arr(doc.impg)) {
    const boe = asRec(b);
    lines.push(makeLine('IMPG', { trdnm: str(boe.portcode) ? `Customs ${str(boe.portcode)}` : 'Customs' }, boe, str(boe.boenum), parse2bDate(boe.boedt), 'BOE'));
  }
  for (const s of arr(doc.impgsez)) {
    const sup = asRec(s);
    for (const b of arr(sup.boe)) {
      const boe = asRec(b);
      lines.push(makeLine('IMPGSEZ', sup, boe, str(boe.boenum), parse2bDate(boe.boedt), 'BOE'));
    }
  }

  const known = new Set(['b2b', 'b2ba', 'cdnr', 'cdnra', 'isd', 'impg', 'impgsez']);
  const skipped = Object.keys(doc).filter((k) => !known.has(k) && Array.isArray(doc[k]) && arr(doc[k]).length > 0);
  if (skipped.length) warnings.push(`Sections not matched (shown for information only): ${skipped.join(', ')}.`);
  if (lines.length === 0) warnings.push('No documents found. Is this a GSTR-2B JSON download from the GST portal?');
  const undated = lines.filter((l) => !l.date).length;
  if (undated) warnings.push(`${undated} document(s) have no readable date.`);

  return {
    source: 'json',
    gstin: str(head.gstin).toUpperCase(),
    period: str(pick(head, ['rtnprd', 'ret_period', 'fp'])),
    generatedOn: str(pick(head, ['gendt', 'gen_dt'])),
    lines: dedupe(lines, warnings),
    warnings,
  };
}

/** Same key twice (supplier uploaded a document twice, or rows per rate in Excel) → summed. */
function dedupe(lines: Gstr2bLine[], warnings: string[]): Gstr2bLine[] {
  const map = new Map<string, Gstr2bLine>();
  let merged = 0;
  for (const l of lines) {
    const prev = map.get(l.key);
    if (!prev) {
      map.set(l.key, { ...l });
      continue;
    }
    merged++;
    prev.taxable = round2(prev.taxable + l.taxable);
    prev.igst = round2(prev.igst + l.igst);
    prev.cgst = round2(prev.cgst + l.cgst);
    prev.sgst = round2(prev.sgst + l.sgst);
    prev.cess = round2(prev.cess + l.cess);
    prev.itcAvailable = prev.itcAvailable && l.itcAvailable;
  }
  if (merged) warnings.push(`${merged} repeated row(s) were combined (same supplier and document number).`);
  return [...map.values()];
}

/* ───────────────────────── Excel parser ───────────────────────── */

type ColKey =
  | 'ctin' | 'name' | 'number' | 'orig' | 'origDate' | 'type' | 'date' | 'value' | 'pos' | 'rev'
  | 'txval' | 'igst' | 'cgst' | 'sgst' | 'cess' | 'itc' | 'rsn' | 'period';

/** Map a (sub-)header label to a column. Order matters: first hit wins. */
function classifyLabel(label: string): ColKey | null {
  const l = label.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!l) return null;
  if (/gstin/.test(l)) return 'ctin';
  if (/trade|legal name/.test(l)) return 'name';
  if (/original/.test(l) && /date/.test(l)) return 'origDate';
  if (/original/.test(l) && /(number|no\b)/.test(l)) return 'orig';
  if (/(invoice|note|document) type/.test(l)) return 'type';
  if (/(invoice|note|document) (number|no)/.test(l)) return 'number';
  if (/(invoice|note|document) date/.test(l)) return 'date';
  if (/(invoice|note|document) value/.test(l)) return 'value';
  if (/place of supply/.test(l)) return 'pos';
  if (/reverse charge/.test(l)) return 'rev';
  if (/taxable value/.test(l)) return 'txval';
  if (/integrated tax/.test(l)) return 'igst';
  if (/central tax/.test(l)) return 'cgst';
  if (/state\s*\/?\s*ut tax|state tax/.test(l)) return 'sgst';
  if (/cess/.test(l)) return 'cess';
  if (/itc availab/.test(l)) return 'itc';
  if (/reason/.test(l)) return 'rsn';
  if (/period/.test(l)) return 'period';
  return null;
}

const SHEET_SECTIONS: { re: RegExp; section: Gstr2bSection }[] = [
  { re: /^b2b[-\s]*cdnra$/i, section: 'CDNRA' },
  { re: /^b2b[-\s]*cdnr$/i, section: 'CDNR' },
  { re: /^b2ba$/i, section: 'B2BA' },
  { re: /^b2b$/i, section: 'B2B' },
];

const isGstinish = (s: string) => /^[0-9]{2}[A-Z0-9]{13}$/i.test(s.trim());

function parseSheetRows(rows: string[][], section: Gstr2bSection, warnings: string[], sheetName: string): Gstr2bLine[] {
  const hi = rows.slice(0, 40).findIndex((r) => r.some((c) => /gstin of (the )?supplier/i.test(c)));
  if (hi < 0) {
    warnings.push(`Sheet "${sheetName}": header row ("GSTIN of supplier") not found; skipped.`);
    return [];
  }
  const top = rows[hi];
  const sub = rows[hi + 1] ?? [];
  const subIsHeader = sub.some((c) => /(number|tax\s*\(|date|type)/i.test(c)) && !sub.some(isGstinish);
  const width = Math.max(top.length, subIsHeader ? sub.length : 0);
  const cols: Partial<Record<ColKey, number>> = {};
  for (let c = 0; c < width; c++) {
    const label = (subIsHeader && sub[c]) || top[c] || '';
    const k = classifyLabel(label);
    if (k && cols[k] === undefined) cols[k] = c;
  }
  if (cols.ctin === undefined || cols.number === undefined) {
    warnings.push(`Sheet "${sheetName}": could not find the GSTIN / document number columns; skipped.`);
    return [];
  }
  const get = (r: string[], k: ColKey) => (cols[k] === undefined ? '' : (r[cols[k]!] ?? '').trim());
  const out: Gstr2bLine[] = [];
  for (const r of rows.slice(hi + (subIsHeader ? 2 : 1))) {
    const ctin = get(r, 'ctin').toUpperCase();
    const number = get(r, 'number');
    if (!isGstinish(ctin) || !number) continue;
    const type = get(r, 'type').toLowerCase();
    const isNote = section === 'CDNR' || section === 'CDNRA';
    const docType: Gstr2bLine['docType'] = isNote ? (/debit/.test(type) || type === 'd' ? 'DN' : 'CN') : 'INV';
    const doc: Rec = {
      val: get(r, 'value'),
      pos: /^\d{2}/.test(get(r, 'pos')) ? get(r, 'pos').slice(0, 2) : '',
      rev: get(r, 'rev'),
      itcavl: get(r, 'itc'),
      rsn: get(r, 'rsn'),
      txval: get(r, 'txval'),
      igst: get(r, 'igst'),
      cgst: get(r, 'cgst'),
      sgst: get(r, 'sgst'),
      cess: get(r, 'cess'),
    };
    out.push(
      makeLine(section, { ctin, trdnm: get(r, 'name'), supprd: get(r, 'period') }, doc, number, parse2bDate(get(r, 'date')), docType, {
        originalNumber: get(r, 'orig') || undefined,
        originalDate: parse2bDate(get(r, 'origDate')) || undefined,
      }),
    );
  }
  return out;
}

/** Find "GSTIN : 27…" and "Tax period" / "Financial year" in the title block of a 2B workbook. */
function excelHeaderInfo(wb: XlsxWorkbook): { gstin: string; period: string } {
  let gstin = '';
  let month = '';
  let fy = '';
  for (const sheet of wb.sheets.slice(0, 3)) {
    for (const row of sheet.rows.slice(0, 12)) {
      const line = row.join(' ');
      if (!gstin) gstin = /\bGSTIN\b[^0-9A-Z]*([0-9]{2}[A-Z0-9]{13})/i.exec(line)?.[1]?.toUpperCase() ?? '';
      if (!month) month = /tax period[^A-Za-z]*([A-Za-z]{3,9})/i.exec(line)?.[1] ?? '';
      if (!fy) fy = /financial year[^0-9]*(\d{4})\s*-\s*(\d{2,4})/i.exec(line)?.[1] ?? '';
    }
  }
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mi = months.indexOf(month.slice(0, 3).toLowerCase());
  let period = '';
  if (mi >= 0 && fy) {
    const year = Number(fy) + (mi < 3 ? 1 : 0); // Jan–Mar fall in the second calendar year of the FY
    period = `${String(mi + 1).padStart(2, '0')}${year}`;
  }
  return { gstin, period };
}

/**
 * Parse the GSTR-2B Excel workbook (sheets "B2B", "B2BA", "B2B-CDNR", "B2B-CDNRA").
 * Headers span two rows (merged group titles + sub-headings); rows per tax rate are summed per document.
 */
export function parseGstr2bWorkbook(wb: XlsxWorkbook): Gstr2bData {
  const warnings: string[] = [];
  const lines: Gstr2bLine[] = [];
  let used = 0;
  for (const sheet of wb.sheets) {
    const hit = SHEET_SECTIONS.find((s) => s.re.test(sheet.name.trim()));
    if (!hit) continue;
    used++;
    lines.push(...parseSheetRows(sheet.rows, hit.section, warnings, sheet.name));
  }
  if (used === 0) warnings.push('No "B2B" sheet found. Load the GSTR-2B Excel downloaded from the GST portal, or the JSON.');
  const info = excelHeaderInfo(wb);
  if (lines.length > 0 && wb.sheets.some((s) => /^(isd|impg)/i.test(s.name) && s.rows.length > 6)) {
    warnings.push('ISD and import (IMPG) sheets are read from the JSON download only.');
  }
  return { source: 'xlsx', gstin: info.gstin, period: info.period, generatedOn: '', lines: dedupe(lines, warnings), warnings };
}

/* ───────────────────────── Books side ───────────────────────── */

export interface BookBill {
  id: string;
  number: string;
  date: string;
  partyName: string;
  gstin: string;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  tax: number;
  itcEligible: boolean;
  reverseCharge: boolean;
  importType: '' | 'GOODS' | 'SERVICES';
  boeNumber: string;
  /** Counted in GSTR-3B Table 4A(5) by the books-based report (same rule as buildGstr3b). */
  in4a5: boolean;
}

/** Bills from the `purchases` table, read exactly as the GST report reads them (void / draft excluded). */
export function bookBills(rawPurchases: readonly unknown[], filerStateCode: string): BookBill[] {
  const out: BookBill[] = [];
  for (const raw of rawPurchases ?? []) {
    const p = normalizePurchase(raw, filerStateCode);
    const core = readPurchase(raw);
    if (!p || !core || isVoidStatus(core.status)) continue;
    const tax = round2(p.igst + p.cgst + p.sgst);
    const blocked = !p.itcEligible && p.itcReversalReason === 'SEC_17_5';
    out.push({
      id: p.id,
      number: p.number,
      date: p.date,
      partyName: p.supplierName,
      gstin: p.supplierGstin,
      taxable: p.taxable,
      igst: p.igst,
      cgst: p.cgst,
      sgst: p.sgst,
      tax,
      itcEligible: p.itcEligible,
      reverseCharge: p.reverseCharge,
      importType: p.importType,
      boeNumber: str(asRec(raw).boe_number),
      in4a5: !p.importType && !p.reverseCharge && tax > 0 && (p.itcEligible || blocked),
    });
  }
  return out;
}

/* ───────────────────────── Matching ───────────────────────── */

export type MatchClass = 'matched' | 'mismatch' | 'missing_in_books' | 'not_in_2b' | 'itc_unavailable';
export type MatchDiff = 'taxable' | 'tax' | 'heads' | 'date' | 'number';

export const MATCH_LABELS: Record<MatchClass, string> = {
  matched: 'Matched',
  mismatch: 'Value mismatch',
  missing_in_books: 'In 2B only (missing in books)',
  not_in_2b: 'In books only (not in 2B)',
  itc_unavailable: 'ITC not available per 2B',
};

export interface MatchRow {
  /** 2B line key, or `BOOKS|${bill id}` for a books-only row. */
  key: string;
  cls: MatchClass;
  line?: Gstr2bLine;
  bill?: BookBill;
  diffs: MatchDiff[];
  /** 2B tax − books tax (signed, IGST+CGST+SGST); 0 when one side is missing. */
  taxDiff: number;
}

export interface MatchOptions {
  /** Absolute rupee tolerance for taxable value and tax (default ₹1). */
  valueTolerance?: number;
  /** Days a bill date may differ from the 2B date before it is flagged (default 3). */
  dateToleranceDays?: number;
  /** Bills dated in this range are expected in the 2B ("in books only" is limited to it). */
  period?: { from: string; to: string };
}

export interface MatchResult {
  rows: MatchRow[];
  counts: Record<MatchClass, number>;
}

const taxOf = (h: { igst: number; cgst: number; sgst: number }) => round2(h.igst + h.cgst + h.sgst);

function compare(line: Gstr2bLine, bill: BookBill, tol: number, dateTol: number): MatchDiff[] {
  const d: MatchDiff[] = [];
  if (Math.abs(line.taxable - bill.taxable) > tol) d.push('taxable');
  if (Math.abs(taxOf(line) - bill.tax) > tol) d.push('tax');
  else if (Math.abs(line.igst - bill.igst) > tol || Math.abs(line.cgst + line.sgst - bill.cgst - bill.sgst) > tol) d.push('heads');
  if (line.date && bill.date && Math.abs(dayDiff(line.date, bill.date)) > dateTol) d.push('date');
  return d;
}

/** Bills a 2B section can be matched to. */
function sectionAccepts(line: Gstr2bLine, b: BookBill): boolean {
  if (line.section === 'IMPG') return b.importType === 'GOODS';
  if (line.section === 'IMPGSEZ') return b.importType === 'GOODS' || b.gstin === line.ctin;
  return b.importType !== 'GOODS';
}

export function matchGstr2b(data: Pick<Gstr2bData, 'lines'>, bills: readonly BookBill[], opts: MatchOptions = {}): MatchResult {
  const tol = opts.valueTolerance ?? 1;
  const dateTol = opts.dateToleranceDays ?? 3;
  const byKey = new Map<string, BookBill[]>();
  const byGstin = new Map<string, BookBill[]>();
  for (const b of bills) {
    const keys = [`${b.gstin}|${normBillNo(b.number)}`];
    if (b.boeNumber) keys.push(`BOE|${normBillNo(b.boeNumber)}`);
    for (const k of keys) byKey.set(k, [...(byKey.get(k) ?? []), b]);
    if (b.gstin) byGstin.set(b.gstin, [...(byGstin.get(b.gstin) ?? []), b]);
  }
  const used = new Set<string>();
  const rows: MatchRow[] = [];

  // Exact keys first (so a value-only fallback never steals a bill another line matches by number).
  const pending: Gstr2bLine[] = [];
  const found = new Map<string, BookBill>();
  for (const line of data.lines) {
    const k = line.section === 'IMPG' ? `BOE|${normBillNo(line.number)}` : `${line.ctin}|${normBillNo(line.number)}`;
    const cands = (byKey.get(k) ?? []).filter((b) => !used.has(b.id) && sectionAccepts(line, b));
    if (cands.length === 0) {
      pending.push(line);
      continue;
    }
    const best = cands.reduce((a, b) => (Math.abs(taxOf(line) - b.tax) < Math.abs(taxOf(line) - a.tax) ? b : a));
    used.add(best.id);
    found.set(line.key, best);
  }
  // Fallback: same GSTIN, same tax within tolerance, date within tolerance, exactly one candidate.
  const fuzzy = new Map<string, BookBill>();
  for (const line of pending) {
    if (!line.ctin || line.sign < 0) continue;
    const cands = (byGstin.get(line.ctin) ?? []).filter(
      (b) =>
        !used.has(b.id) &&
        sectionAccepts(line, b) &&
        Math.abs(taxOf(line) - b.tax) <= tol &&
        (!line.date || !b.date || Math.abs(dayDiff(line.date, b.date)) <= dateTol),
    );
    if (cands.length === 1) {
      used.add(cands[0].id);
      fuzzy.set(line.key, cands[0]);
    }
  }

  for (const line of data.lines) {
    const bill = found.get(line.key) ?? fuzzy.get(line.key);
    const diffs = bill ? compare(line, bill, tol, dateTol) : [];
    if (bill && fuzzy.has(line.key)) diffs.unshift('number');
    let cls: MatchClass;
    if (!line.itcAvailable) cls = 'itc_unavailable';
    else if (!bill) cls = 'missing_in_books';
    else cls = diffs.length ? 'mismatch' : 'matched';
    rows.push({ key: line.key, cls, line, bill, diffs, taxDiff: bill ? round2(line.sign * taxOf(line) - bill.tax) : 0 });
  }

  for (const b of bills) {
    if (used.has(b.id)) continue;
    if (opts.period && (b.date < opts.period.from || b.date > opts.period.to)) continue;
    if (!b.itcEligible || b.tax <= 0 || b.importType === 'SERVICES') continue;
    // Only bills the supplier must report: a valid GSTIN (B2B / RCM from registered) or an import of goods.
    if (b.importType !== 'GOODS' && !checkGstin(b.gstin).valid) continue;
    rows.push({ key: `BOOKS|${b.id}`, cls: 'not_in_2b', bill: b, diffs: [], taxDiff: 0 });
  }

  const counts: Record<MatchClass, number> = { matched: 0, mismatch: 0, missing_in_books: 0, not_in_2b: 0, itc_unavailable: 0 };
  for (const r of rows) counts[r.cls]++;
  return { rows, counts };
}

/* ───────────────────────── IMS actions ───────────────────────── */

export type ImsAction = 'ACCEPT' | 'REJECT' | 'PENDING';

export const IMS_LABELS: Record<ImsAction, string> = { ACCEPT: 'Accept', REJECT: 'Reject', PENDING: 'Pending' };

/** One IMS decision. Persisted in table `gstr2b_actions` (additive; part of backups). */
export interface Gstr2bAction {
  /** `${period}|${section}|${ctin}|${normalised number}` */
  id: string;
  /** Return period MMYYYY. */
  period: string;
  section: Gstr2bSection;
  ctin: string;
  /** Normalised document number. */
  inum: string;
  action: ImsAction;
  note?: string;
  updated_at: string;
}

export const GSTR2B_ACTIONS_TABLE = 'gstr2b_actions';

export const actionId = (period: string, line: Pick<Gstr2bLine, 'section' | 'ctin' | 'number'>) =>
  `${period}|${line.section}|${line.ctin}|${normBillNo(line.number)}`;

/** Effective IMS action: no record means deemed accepted (as on the portal). */
export function effectiveAction(actions: ReadonlyMap<string, Gstr2bAction>, period: string, line: Gstr2bLine): ImsAction {
  return actions.get(actionId(period, line))?.action ?? 'ACCEPT';
}

export const gstr2bActionsDb = {
  all: (): Gstr2bAction[] => getTable<Gstr2bAction>(GSTR2B_ACTIONS_TABLE),
  forPeriod: (period: string): Map<string, Gstr2bAction> =>
    new Map(gstr2bActionsDb.all().filter((a) => a.period === period).map((a) => [a.id, a])),
  /** Record a decision (replaces an earlier one for the same document). */
  set(period: string, line: Gstr2bLine, action: ImsAction, note?: string): Gstr2bAction {
    const id = actionId(period, line);
    const row: Gstr2bAction = {
      id, period, section: line.section, ctin: line.ctin, inum: normBillNo(line.number), action,
      note: note?.trim() || undefined, updated_at: new Date().toISOString(),
    };
    setTable(GSTR2B_ACTIONS_TABLE, [...gstr2bActionsDb.all().filter((a) => a.id !== id), row]);
    return row;
  },
  clear(period: string, line: Gstr2bLine): void {
    const id = actionId(period, line);
    setTable(GSTR2B_ACTIONS_TABLE, gstr2bActionsDb.all().filter((a) => a.id !== id));
  },
};

/* ───────────────────────── 3B effect (4A(5)) ───────────────────────── */

export interface Heads3 {
  igst: number;
  cgst: number;
  sgst: number;
}

export interface ItcEffect {
  /** Books-based 4A(5) — the figure the GSTR-3B tab shows today. */
  books: Heads3;
  /** Books 4A(5) restricted to bills matched to a 2B line that is available and accepted (lower of books / 2B per head). */
  restricted: Heads3;
  /** books − restricted. */
  atRisk: Heads3;
  /** 2B's own 4A(5) figure: B2B/B2BA/CDNR/CDNRA, forward charge, ITC available, accepted (credit notes negative). */
  per2b: Heads3;
  rejected: number;
  pending: number;
}

const zero3 = (): Heads3 => ({ igst: 0, cgst: 0, sgst: 0 });
const add3 = (a: Heads3, b: Heads3, f = 1) => {
  a.igst = round2(a.igst + f * b.igst);
  a.cgst = round2(a.cgst + f * b.cgst);
  a.sgst = round2(a.sgst + f * b.sgst);
};
const IN_4A5: ReadonlySet<Gstr2bSection> = new Set(['B2B', 'B2BA', 'CDNR', 'CDNRA']);

export function itcEffect(
  match: MatchResult,
  bills: readonly BookBill[],
  actions: ReadonlyMap<string, Gstr2bAction>,
  period: string,
  range: { from: string; to: string },
): ItcEffect {
  const books = zero3();
  for (const b of bills) if (b.in4a5 && b.date >= range.from && b.date <= range.to) add3(books, b);

  const restricted = zero3();
  const per2b = zero3();
  let rejected = 0;
  let pending = 0;
  for (const r of match.rows) {
    const l = r.line;
    if (!l) continue;
    const act = effectiveAction(actions, period, l);
    if (act === 'REJECT') rejected++;
    if (act === 'PENDING') pending++;
    const claimable = act === 'ACCEPT' && l.itcAvailable;
    if (claimable && IN_4A5.has(l.section) && !l.reverseCharge) add3(per2b, l, l.sign);
    const b = r.bill;
    if (claimable && b && b.in4a5 && b.date >= range.from && b.date <= range.to && l.sign > 0) {
      add3(restricted, { igst: Math.min(b.igst, l.igst), cgst: Math.min(b.cgst, l.cgst), sgst: Math.min(b.sgst, l.sgst) });
    }
  }
  const atRisk = zero3();
  add3(atRisk, books);
  add3(atRisk, restricted, -1);
  return { books, restricted, atRisk, per2b, rejected, pending };
}

/* ───────────────────────── Worksheet & bill creation ───────────────────────── */

const DIFF_LABELS: Record<MatchDiff, string> = {
  taxable: 'taxable value', tax: 'tax amount', heads: 'IGST vs CGST/SGST', date: 'date', number: 'bill number (matched on value)',
};

export const diffText = (d: MatchDiff[]) => d.map((x) => DIFF_LABELS[x]).join(', ');

/** IMS worksheet rows (header first) for CSV / XLSX export. */
export function worksheetRows(match: MatchResult, actions: ReadonlyMap<string, Gstr2bAction>, period: string): (string | number)[][] {
  const header = [
    'Section', 'Supplier GSTIN', 'Supplier name', 'Document no', 'Document date', 'Type', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess',
    'ITC available (2B)', 'Reason', 'Match status', 'Differences', 'Books bill no', 'Books date', 'Books taxable', 'Books tax', 'Tax difference', 'IMS action', 'Note',
  ];
  const out: (string | number)[][] = [header];
  for (const r of match.rows) {
    const l = r.line;
    const b = r.bill;
    const act = l ? actions.get(actionId(period, l)) : undefined;
    out.push([
      l ? l.section : 'BOOKS',
      l ? l.ctin : (b?.gstin ?? ''),
      l ? l.tradeName : (b?.partyName ?? ''),
      l ? l.number : '',
      l ? l.date : '',
      l ? l.docType : '',
      l ? l.sign * l.taxable : '',
      l ? l.sign * l.igst : '',
      l ? l.sign * l.cgst : '',
      l ? l.sign * l.sgst : '',
      l ? l.sign * l.cess : '',
      l ? (l.itcAvailable ? 'Y' : 'N') : '',
      l?.reason ?? '',
      MATCH_LABELS[r.cls],
      diffText(r.diffs),
      b?.number ?? '',
      b?.date ?? '',
      b ? b.taxable : '',
      b ? b.tax : '',
      l && b ? r.taxDiff : '',
      l ? (act ? IMS_LABELS[act.action] : 'No action (deemed accepted)') : '',
      act?.note ?? '',
    ]);
  }
  return out;
}

/**
 * A purchase bill built from a 2B line that is missing in the books, for the
 * user to review and save. One line per bill (taxable value at the effective
 * GST rate); figures are copied from 2B.
 */
export function billFromLine(line: Gstr2bLine, vendorId?: string): Omit<PurchaseRecord, 'id'> {
  const tax = taxOf(line);
  const rate = line.taxable > 0 ? Math.round((tax / line.taxable) * 10000) / 100 : 0;
  return {
    kind: 'PURCHASE',
    vendor_id: vendorId,
    vendor_name: line.tradeName || line.ctin,
    vendor_gstin: line.ctin || undefined,
    bill_number: line.number,
    date: line.date,
    place_of_supply: line.pos || undefined,
    category: 'Purchases',
    lines: [{ id: generateId(), name: `As per GSTR-2B (${line.section})`, quantity: 1, rate: line.taxable, tax_rate: rate }],
    taxable: line.taxable,
    cgst: line.cgst,
    sgst: line.sgst,
    igst: line.igst,
    itc_eligible: line.itcAvailable,
    reverse_charge: line.reverseCharge || undefined,
    import_type: line.docType === 'BOE' ? 'GOODS' : undefined,
    boe_number: line.docType === 'BOE' ? line.number : undefined,
    boe_date: line.docType === 'BOE' ? line.date : undefined,
    total: round2(line.taxable + tax + line.cess),
    amount_paid: 0,
    notes: `Created from GSTR-2B${line.supplierPeriod ? ` (supplier period ${line.supplierPeriod})` : ''}. Check against the supplier's invoice.`,
  };
}
