/**
 * R4-C1 LUT register: one Letter of Undertaking (RFD-11) per financial year and GSTIN, with its ARN. A zero-rated
 * export / SEZ supply "without payment of IGST" dated in that FY takes the ARN and filed date automatically (unless
 * typed), and the GST preflight flags exports without a live LUT. Under Rule 96A — verify with your CA.
 *
 * Table `lut_register` (`settings.manage`, not dated). Pure helpers + a thin store.
 */
import type { LutRow } from '../../types/trade-r4';
import type { InvoiceRecord } from '../../types/invoice';
import { getIndianFY } from '../invoice-number';
import { isoDay } from '../dates';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { isLutSupply, isSupplyDocType } from './exporter';

export const LUT_TABLE = 'lut_register';

/** `FY26-27` for a local day. */
export const fyOf = (day: string | undefined): string => `FY${getIndianFY(day || undefined).label}`;
/** First / last day of an FY id (`FY26-27` → 2026-04-01 / 2027-03-31). */
export function fyRange(fy: string): { from: string; to: string } | null {
  const m = /^FY(\d{2})-(\d{2})$/.exec(fy);
  if (!m) return null;
  const start = 2000 + Number(m[1]);
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}
const gstinOf = (v: unknown) => String(v ?? '').trim().toUpperCase();

/** Validation problems (English keys of the area file), empty when the row can be saved. */
export function lutProblems(r: Partial<LutRow>): ('lutFyBad' | 'lutArnBad' | 'lutFiledBad' | 'lutRangeBad')[] {
  const out: ('lutFyBad' | 'lutArnBad' | 'lutFiledBad' | 'lutRangeBad')[] = [];
  const range = fyRange(String(r.fy ?? ''));
  if (!range) out.push('lutFyBad');
  if (!/^[A-Z0-9]{10,20}$/i.test(String(r.arn ?? '').trim())) out.push('lutArnBad');
  if (!isoDay(r.filed_on)) out.push('lutFiledBad');
  const from = isoDay(r.valid_from) || range?.from || '';
  const to = isoDay(r.valid_to) || range?.to || '';
  if (!from || !to || from > to) out.push('lutRangeBad');
  return out;
}

/** A clean row: FY range as the default validity, ARN upper-cased. */
export function normalizeLut(r: Partial<LutRow>): LutRow {
  const fy = String(r.fy ?? '').trim().toUpperCase().replace(/^fy/i, 'FY');
  const range = fyRange(fy);
  return {
    id: r.id || generateId(),
    fy,
    gstin: gstinOf(r.gstin),
    arn: String(r.arn ?? '').trim().toUpperCase(),
    filed_on: isoDay(r.filed_on),
    valid_from: isoDay(r.valid_from) || range?.from || '',
    valid_to: isoDay(r.valid_to) || range?.to || '',
    ...(r.created_at ? { created_at: r.created_at } : {}),
    ...(r.updated_at ? { updated_at: r.updated_at } : {}),
  };
}

/**
 * The LUT in force for a document dated `day` issued under `gstin`: same FY, same GSTIN (a row without a GSTIN
 * covers every GSTIN), the day inside its validity. Latest filing wins.
 */
export function pickLut(register: readonly LutRow[], day: string, gstin?: string): LutRow | null {
  const d = isoDay(day);
  if (!d) return null;
  const fy = fyOf(d);
  const g = gstinOf(gstin);
  const hits = register.filter((r) => r && r.fy === fy && (!r.gstin || !g || r.gstin === g) && (!r.valid_from || r.valid_from <= d) && (!r.valid_to || d <= r.valid_to));
  hits.sort((a, b) => Number(!!b.gstin) - Number(!!a.gstin) || b.filed_on.localeCompare(a.filed_on));
  return hits[0] ?? null;
}

type LutDoc = Pick<InvoiceRecord, 'supply_type' | 'issue_date' | 'lut_number' | 'lut_date'> & { sender?: { companyGstin?: string } | null };

/**
 * Auto-fill for a zero-rated supply without payment: `{ lut_number: ARN, lut_date: filed date }` from the register,
 * or null when the document is not such a supply, the user already typed an LUT, or no LUT is on record.
 */
export function lutAutofill(inv: LutDoc, register: readonly LutRow[], gstin?: string): { lut_number: string; lut_date: string } | null {
  if (!isLutSupply(inv)) return null;
  if (String(inv.lut_number ?? '').trim()) return null;
  const row = pickLut(register, inv.issue_date, gstin ?? inv.sender?.companyGstin);
  return row ? { lut_number: row.arn, lut_date: row.filed_on } : null;
}

export type LutIssueCode = 'LUT_MISSING' | 'LUT_OUTSIDE_FY';
export interface LutIssue {
  code: LutIssueCode;
  invoiceId: string;
  number: string;
  /** FY of the document and (LUT_OUTSIDE_FY) of the typed LUT. */
  fy: string;
  lutFy?: string;
}

/**
 * Preflight findings (read-only): LUT_MISSING (error) for an issued zero-rated supply without payment that has no
 * LUT, LUT_OUTSIDE_FY when the typed LUT is registered for another FY than the document's.
 */
export function lutIssues(invoices: readonly Partial<InvoiceRecord>[], register: readonly LutRow[]): LutIssue[] {
  const byArn = new Map(register.filter((r) => r?.arn).map((r) => [r.arn.toUpperCase(), r]));
  const out: LutIssue[] = [];
  for (const inv of invoices) {
    if (!inv || !isLutSupply(inv) || inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    if (!isSupplyDocType(inv.doc_type)) continue; // QA6 F6: a "Tax Invoice" export needs its LUT too
    const fy = fyOf(inv.issue_date);
    const base = { invoiceId: String(inv.id ?? ''), number: String(inv.invoice_number ?? ''), fy };
    const typed = String(inv.lut_number ?? '').trim().toUpperCase();
    if (!typed) {
      out.push({ code: 'LUT_MISSING', ...base });
      continue;
    }
    const row = byArn.get(typed);
    if (row && row.fy !== fy) out.push({ code: 'LUT_OUTSIDE_FY', ...base, lutFy: row.fy });
  }
  return out;
}

/* ── Store ───────────────────────────────────────────────────── */

export const lutDb = {
  all: (): LutRow[] => getTable<LutRow>(LUT_TABLE).filter((r) => r && typeof r.id === 'string'),
  peek: (): readonly LutRow[] => peekTable<LutRow>(LUT_TABLE),
  save(input: Partial<LutRow>): LutRow {
    requireAccess('settings.manage');
    const problems = lutProblems(input);
    if (problems.length) throw new Error(problems[0]);
    const rows = lutDb.all();
    const prev = input.id ? rows.find((r) => r.id === input.id) : undefined;
    const now = new Date().toISOString();
    const row = normalizeLut({ ...prev, ...input, created_at: prev?.created_at ?? now, updated_at: now });
    const clash = rows.find((r) => r.id !== row.id && r.fy === row.fy && r.gstin === row.gstin && r.arn === row.arn);
    if (clash) throw new Error('lutDuplicate');
    setTable(LUT_TABLE, prev ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
    return row;
  },
  remove(id: string): void {
    requireAccess('settings.manage');
    setTable(LUT_TABLE, lutDb.all().filter((r) => r.id !== id));
  },
};
