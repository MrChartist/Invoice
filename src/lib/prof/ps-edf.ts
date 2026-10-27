/**
 * R14 PS-C2: Export Declaration Form (EDF) register for services, FEMA 23(R)/2026-RB from 1 Oct 2026 (PS16). Table
 * `edf_register` (dated by `date` = the end of the invoice month, `books.edit`, audited). "Prepare EDF for <month>" lists
 * the month's issued services exports by kind (software = SAC 99831x / 997331, else services) and currency and writes one
 * draft row per kind × currency; the EDF number and date are typed after the AD bank / STPI files it (no portal). Due:
 * `EDF_RULES` — 30 days after the end of the invoice month; services other than software may file by the receipt date;
 * a month whose every invoice is up to ₹10 lakh may be closed on the exporter's declaration. Before 1 Oct 2026 only
 * `softex` rows (history) are kept. Working paper — verify with your CA.
 */
import './ps-registry';
import type { InvoiceRecord } from '../../types/invoice';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, setTable } from '../storage';
import { isoDay, localDayOf, shiftDay } from '../dates';
import { round2 } from '../invoice-calc';
import { inrValue } from '../fx';
import { exportInvoices, isServicesExport } from '../trade/export-register';
import { edfRule } from '../prof-rules';
import { PS_TABLES } from './ps-shared';
export { edfRule };

export const EDF_TABLE = PS_TABLES.edf;
export type EdfKind = 'software' | 'services' | 'softex';
export type EdfStatus = 'due' | 'filed' | 'closed';
export interface EdfRow {
  id: string;
  kind: EdfKind;
  /** `YYYY-MM` of the invoices. */
  period: string;
  invoice_ids: string[];
  /** End of the invoice month (dated field: sync, period lock). */
  date: string;
  edf_no?: string;
  filed_on?: string;
  authority: 'ad_bank' | 'stpi' | 'sez';
  currency: string;
  value_fc: number;
  value_inr: number;
  due: string;
  small_value_declared?: boolean;
  /** Every invoice of the row is within the small-value limit (set by the builder). */
  small_value_ok?: boolean;
  status: EdfStatus;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

const monthEnd = (period: string) => localDayOf(new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0));
const SOFTWARE = /^(99831[3-9]|997331)/;

/** Software when any line is an IT software service, else services. */
export const edfKindOf = (inv: Pick<InvoiceRecord, 'items'>): Exclude<EdfKind, 'softex'> =>
  inv.items?.some((l) => SOFTWARE.test(String(l?.hsn ?? '').trim())) ? 'software' : 'services';

/** Due day: `null` before the 2026 regulations. `receipt`: services filed by the date of receipt instead. */
export function edfDue(kind: EdfKind, period: string, receipt?: string): string | null {
  const end = monthEnd(period);
  const r = edfRule(end);
  if (!r || kind === 'softex') return null;
  return kind === 'services' && r.byReceipt && isoDay(receipt) ? isoDay(receipt) : shiftDay(end, r.days);
}

export interface EdfDraft {
  kind: Exclude<EdfKind, 'softex'>;
  currency: string;
  invoice_ids: string[];
  numbers: string[];
  value_fc: number;
  value_inr: number;
  due: string;
  /** Every invoice ≤ the small-value limit: may be closed on the exporter's declaration (Reg 4(2)). */
  small: boolean;
}

/** "Prepare EDF for <period>": the month's services exports grouped by kind and currency. Empty before 1 Oct 2026. */
export function prepareEdf(period: string, invoices: readonly Partial<InvoiceRecord>[]): EdfDraft[] {
  const r = edfRule(monthEnd(period));
  if (!r) return [];
  const map = new Map<string, EdfDraft>();
  for (const inv of exportInvoices(invoices) as InvoiceRecord[]) {
    if (!String(inv.issue_date ?? '').startsWith(period.slice(0, 7)) || !isServicesExport(inv)) continue;
    const kind = edfKindOf(inv);
    const currency = String(inv.currency || 'INR').toUpperCase();
    const key = `${kind}|${currency}`;
    const d = map.get(key) ?? { kind, currency, invoice_ids: [], numbers: [], value_fc: 0, value_inr: 0, due: edfDue(kind, period)!, small: true };
    const inr = inrValue(Number(inv.total) || 0, inv);
    d.invoice_ids.push(inv.id);
    d.numbers.push(inv.invoice_number);
    d.value_fc = round2(d.value_fc + (Number(inv.total) || 0));
    d.value_inr = round2(d.value_inr + inr);
    if (inr > r.smallValue) d.small = false;
    map.set(key, d);
  }
  return [...map.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.currency.localeCompare(b.currency));
}

const lock = (r: Pick<EdfRow, 'date' | 'edf_no'>, action: 'create' | 'edit' | 'delete') => assertUnlocked({ issue_date: r.date, invoice_number: r.edf_no }, action);

export const edfDb = {
  all: (): EdfRow[] => getTable<EdfRow>(EDF_TABLE).filter((r) => r && typeof r.id === 'string'),
  /** Writes the drafts of a month once: a kind × currency already in the register is skipped. Returns the new rows. */
  saveDrafts(period: string, drafts: readonly EdfDraft[]): EdfRow[] {
    requireAccess('books.edit');
    const rows = edfDb.all();
    const date = monthEnd(period);
    const now = new Date().toISOString();
    const add: EdfRow[] = [];
    for (const d of drafts) {
      if (rows.some((r) => r.period === period.slice(0, 7) && r.kind === d.kind && r.currency === d.currency)) continue;
      const row: EdfRow = { id: generateId(), kind: d.kind, period: period.slice(0, 7), invoice_ids: d.invoice_ids, date, authority: d.kind === 'software' ? 'stpi' : 'ad_bank', currency: d.currency, value_fc: d.value_fc, value_inr: d.value_inr, due: d.due, ...(d.small ? { small_value_ok: true } : {}), status: 'due', created_at: now };
      lock(row, 'create');
      add.push(row);
    }
    if (add.length) setTable(EDF_TABLE, [...rows, ...add]);
    return add;
  },
  /** Edit a row (number, filing day, authority, declaration, notes). A filed day sets `filed`; a declaration closes it. */
  save(input: Partial<EdfRow> & Pick<EdfRow, 'id'>): EdfRow {
    requireAccess('books.edit');
    const rows = edfDb.all();
    const prev = rows.find((r) => r.id === input.id);
    if (!prev) throw new Error('edfMissing');
    lock(prev, 'edit');
    const next: EdfRow = { ...prev, ...input, updated_at: new Date().toISOString() };
    if (next.small_value_declared && !prev.small_value_ok) throw new Error('edfNotSmall');
    next.status = next.small_value_declared ? 'closed' : isoDay(next.filed_on) && String(next.edf_no ?? '').trim() ? 'filed' : next.status === 'closed' ? 'closed' : 'due';
    setTable(EDF_TABLE, rows.map((r) => (r.id === next.id ? next : r)));
    return next;
  },
  /** A SOFTEX row of the old regime (history only). */
  addSoftex(input: Pick<EdfRow, 'period' | 'currency' | 'value_fc' | 'value_inr'> & Partial<EdfRow>): EdfRow {
    requireAccess('books.edit');
    const row: EdfRow = { authority: 'stpi', invoice_ids: [], ...input, id: generateId(), kind: 'softex', period: input.period.slice(0, 7), date: monthEnd(input.period), due: monthEnd(input.period), status: 'filed', created_at: new Date().toISOString() };
    if (edfRule(row.date)) throw new Error('edfSoftexAfter');
    lock(row, 'create');
    setTable(EDF_TABLE, [...edfDb.all(), row]);
    return row;
  },
  /** Deletes go through `setTable` on the watched table (recycle bin). */
  remove(id: string): void {
    requireAccess('books.edit');
    const rows = edfDb.all();
    const row = rows.find((r) => r.id === id);
    if (row) lock(row, 'delete');
    setTable(EDF_TABLE, rows.filter((r) => r.id !== id));
  },
};

/** Open rows due within `days` of `today` or past due, soonest first (the compliance calendar's "EDF due"). */
export const edfDueList = (rows: readonly EdfRow[], today: string, days = 30): EdfRow[] =>
  rows.filter((r) => r.status === 'due' && r.due <= shiftDay(today, days)).sort((a, b) => a.due.localeCompare(b.due));
