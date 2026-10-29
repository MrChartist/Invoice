/**
 * MF-D4 export authorisations (table `export_authorisations`, `books.edit`, dated by `date`): Advance Authorisation (AA)
 * and EPCG registers with export-obligation (EO) tracking. Nothing is filed (DGFT) and nothing is posted.
 *
 *  - Imports against an authorisation: bills tagged `PurchaseRecord.mf.authorisation_id` (read through `readPurchase` /
 *    `readPurchaseLines`, base units with `unitFactor`); their BOE sheet shows the duty FOREGONE (BCD + SWS + other +
 *    IGST + cess exempted) as a memo instead of duty paid (`dutyForegone`).
 *  - Exports against it: invoices with `mf.kind = 'export_aa'` and `mf.export_aa.authorisation_id` (the A5 paper prints
 *    "Supplied under AA no. …"); quantity in base units (`lineFactor`) and FOB value in rupees (`exchange_rate`).
 *  - AA: EO in quantity AND value; fulfilled share = the lower of the two; import validity 12 months and EO 18 months
 *    from the date (`AA_RULES`, unless typed); bell 90 / 30 days before `eo_due` (`eo_extended_to` wins).
 *  - EPCG: EO = `eo_multiple` (default 6) × duty saved in value, over 6 years, block-wise (50% by year 4 — `EPCG_RULES`,
 *    unverified, MF17).
 *  - "Duty saved at risk" (memo) = duty saved × unfulfilled share, with the HBP shortfall note (MF16).
 *  - RoDTEP claims on exports under an AA carry Appendix 4RE (R4-C register, `appendix` — MF18).
 *  - ANF 4F papers as CSV.
 * Pure maths plus a thin store. Working paper — verify MF16 / MF17 / MF18 with your CA and a DGFT consultant.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { BoeDuty } from '../../types/trade-r4';
import type { MfExportAaSnap } from '../../types/mfg-r13';
import './mf-registry';
import { MF_TABLES } from './mf-shared';
import { num, round2 } from '../invoice-calc';
import { isoDay, shiftDay } from '../dates';
import { ruleAt } from '../tax-rules';
import { lineFactor } from '../units';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, setTable } from '../storage';
import { isRevenueDoc } from '../stats';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';
import { AA_RULES, EPCG_RULES } from '../mfg-rules';

export const AUTHORISATIONS_TABLE = MF_TABLES.authorisations;

export type AuthorisationKind = 'aa' | 'epcg';
export type AuthorisationStatus = 'open' | 'eodc_applied' | 'redeemed' | 'lapsed';

export interface ExportAuthorisation {
  id: string;
  kind: AuthorisationKind;
  number: string;
  /** Issue date (yyyy-mm-dd). */
  date: string;
  port?: string;
  items_import: { item_id: string; qty: number; unit?: string; cif_value: number }[];
  items_export: { item_id: string; qty: number; fob_value: number }[];
  norm: 'sion' | 'self' | 'committee';
  sion_ref?: string;
  import_valid_to: string;
  eo_due: string;
  eo_extended_to?: string;
  /** Duty saved (₹) on the imports / capital goods. */
  duty_saved: number;
  /** EPCG: EO as a multiple of duty saved (default 6). */
  eo_multiple?: number;
  status: AuthorisationStatus;
  eodc_ref?: string;
  created_at?: string;
  updated_at?: string;
}

/** The `mf.export_aa` snapshot an export invoice carries under an authorisation (A5 prints "AA no." / "SION"). */
export type ExportAaSnapshot = MfExportAaSnap;

const addMonths = (day: string, months: number) => {
  const y = +day.slice(0, 4);
  const m = +day.slice(5, 7) - 1 + months;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(+day.slice(8, 10), last)).padStart(2, '0')}`;
};

/** Default import validity and EO due date for a new authorisation dated `date`. */
export function defaultDates(kind: AuthorisationKind, date: string): { import_valid_to: string; eo_due: string } {
  if (kind === 'epcg') {
    const r = ruleAt(EPCG_RULES, date);
    return { import_valid_to: shiftDay(addMonths(date, 24), -1), eo_due: shiftDay(addMonths(date, r.years * 12), -1) };
  }
  const r = ruleAt(AA_RULES, date);
  return { import_valid_to: shiftDay(addMonths(date, r.importValidMonths), -1), eo_due: shiftDay(addMonths(date, r.eoMonths), -1) };
}

const days = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);

/** Authorisation linked by an invoice's `mf` snapshot. */
export const exportAaOf = (inv: unknown): ExportAaSnapshot | undefined => (inv as { mf?: { export_aa?: ExportAaSnapshot } } | undefined)?.mf?.export_aa;
/** Authorisation linked by a bill's `mf`. */
export const billAuthorisationOf = (bill: unknown): string => String((bill as { mf?: { authorisation_id?: string } } | undefined)?.mf?.authorisation_id ?? '');

export interface EoMovement {
  doc_id: string;
  number: string;
  date: string;
  item_id: string;
  item: string;
  qty: number;
  /** FOB (exports) / CIF or taxable (imports), ₹. */
  value: number;
}

/** Export lines against `authId` (base quantity; FOB in ₹ = taxable × exchange rate). */
export function exportsAgainst(invoices: readonly InvoiceRecord[], authId: string, itemIdOf: (name: string) => string | undefined): EoMovement[] {
  const out: EoMovement[] = [];
  for (const inv of invoices) {
    if (!isRevenueDoc(inv) || inv.doc_type === 'DEBIT_NOTE' || exportAaOf(inv)?.authorisation_id !== authId) continue;
    const fx = num(inv.exchange_rate) > 0 && inv.currency && inv.currency !== 'INR' ? num(inv.exchange_rate) : 1;
    for (const l of inv.items ?? []) {
      const id = itemIdOf(l.name);
      if (!id) continue;
      const value = num(l.quantity) * num(l.rate) * (1 - Math.min(Math.max(num(l.discount_percent), 0), 100) / 100) * fx;
      out.push({ doc_id: inv.id, number: inv.invoice_number, date: String(inv.issue_date).slice(0, 10), item_id: id, item: l.name, qty: num(l.quantity) * lineFactor(l), value: round2(value) });
    }
  }
  return out;
}

/** Import lines against `authId` from tagged bills (void / expense bills left out). */
export function importsAgainst(purchases: readonly unknown[], authId: string, itemIdOf: (name: string) => string | undefined): EoMovement[] {
  const out: EoMovement[] = [];
  for (const raw of purchases) {
    if (billAuthorisationOf(raw) !== authId) continue;
    const p = readPurchase(raw);
    if (!p || p.isExpense || isVoidStatus(p.status)) continue;
    for (const l of readPurchaseLines(raw)) {
      const id = l.itemId || itemIdOf(l.name);
      if (!id) continue;
      out.push({ doc_id: p.id, number: p.number, date: p.date, item_id: id, item: l.name, qty: l.quantity * (l.unitFactor || 1), value: round2(l.quantity * l.unitCost) });
    }
  }
  return out;
}

/** BOE duty exempted under an authorisation (memo; nothing posted). */
export function dutyForegone(boe: Pick<BoeDuty, 'totals'> | undefined): { bcd: number; sws: number; other: number; igst: number; cess: number; total: number } {
  const t = boe?.totals;
  const r = { bcd: round2(num(t?.bcd)), sws: round2(num(t?.sws)), other: round2(num(t?.other)), igst: round2(num(t?.igst)), cess: round2(num(t?.cess)) };
  return { ...r, total: round2(r.bcd + r.sws + r.other + r.igst + r.cess) };
}

export interface EoStatus {
  /** Obligation and done, by quantity (AA) and value. */
  qtyRequired: number;
  qtyDone: number;
  valueRequired: number;
  valueDone: number;
  /** 0..1: the lower of the quantity and value shares (AA); value share (EPCG). */
  fulfilled: number;
  /** Duty saved × unfulfilled share (memo). */
  atRisk: number;
  /** Days to the EO due date (extended wins); negative = overdue. */
  daysLeft: number;
  importDaysLeft: number;
  imported: { qty: number; value: number };
  /** AA norm: imports allowed for the exports made (Σ import qty × done share). */
  importAllowed: number;
  /** EPCG block-wise progress. */
  blocks: { year: number; due: string; required: number; met: boolean }[];
  /** Bell lead time reached (90 / 30) or '' . */
  bell: '' | '90' | '30' | 'overdue';
}

export function eoStatus(a: ExportAuthorisation, allExports: readonly EoMovement[], imports: readonly EoMovement[], today: string): EoStatus {
  // QA16 P8: an AA's obligation is in its export items — other lines on a tagged invoice (another product, packing,
  // freight) count towards neither quantity nor value. EPCG obligations are in value of any goods made: all lines count.
  const eoItems = new Set(a.kind === 'aa' ? a.items_export.map((x) => x.item_id).filter(Boolean) : []);
  const exports = eoItems.size ? allExports.filter((e) => eoItems.has(e.item_id)) : allExports;
  const qtyDone = exports.reduce((s, e) => s + e.qty, 0);
  const valueDone = round2(exports.reduce((s, e) => s + e.value, 0));
  const imported = { qty: imports.reduce((s, e) => s + e.qty, 0), value: round2(imports.reduce((s, e) => s + e.value, 0)) };
  const due = a.eo_extended_to || a.eo_due;
  const daysLeft = days(today, due);
  let qtyRequired = 0;
  let valueRequired = 0;
  let fulfilled: number;
  let blocks: EoStatus['blocks'] = [];
  if (a.kind === 'epcg') {
    const r = ruleAt(EPCG_RULES, a.date);
    valueRequired = round2(num(a.duty_saved) * (num(a.eo_multiple) || r.multiple));
    fulfilled = valueRequired > 0 ? Math.min(valueDone / valueRequired, 1) : 1;
    blocks = r.blocks.map((b) => {
      const end = shiftDay(addMonths(a.date, b.year * 12), -1);
      const required = round2((valueRequired * b.pct) / 100);
      const doneBy = round2(exports.filter((e) => e.date <= end).reduce((s, e) => s + e.value, 0));
      return { year: b.year, due: end, required, met: doneBy + 0.005 >= required };
    });
  } else {
    qtyRequired = a.items_export.reduce((s, x) => s + num(x.qty), 0);
    valueRequired = round2(a.items_export.reduce((s, x) => s + num(x.fob_value), 0));
    const q = qtyRequired > 0 ? qtyDone / qtyRequired : 1;
    const v = valueRequired > 0 ? valueDone / valueRequired : 1;
    fulfilled = Math.min(q, v, 1);
  }
  fulfilled = Math.max(Math.round(fulfilled * 10000) / 10000, 0);
  const importReq = a.items_import.reduce((s, x) => s + num(x.qty), 0);
  const open = a.status === 'open';
  const bellDays = ruleAt(AA_RULES, a.date).bellDays;
  const bell: EoStatus['bell'] = !open || fulfilled >= 1 ? '' : daysLeft < 0 ? 'overdue' : daysLeft <= bellDays[1] ? '30' : daysLeft <= bellDays[0] ? '90' : '';
  return {
    qtyRequired, qtyDone: Math.round(qtyDone * 1000) / 1000, valueRequired, valueDone, fulfilled,
    atRisk: open ? round2(num(a.duty_saved) * (1 - fulfilled)) : 0,
    daysLeft, importDaysLeft: days(today, a.import_valid_to), imported,
    importAllowed: Math.round(importReq * Math.min(qtyRequired > 0 ? qtyDone / qtyRequired : 0, 1) * 1000) / 1000,
    blocks, bell,
  };
}

/** HBP shortfall note shown with the at-risk memo. */
export const shortfallNote = (a: Pick<ExportAuthorisation, 'date'>) => ruleAt(AA_RULES, a.date).shortfallNote;

/** ANF 4F working rows (CSV): exports then imports. Nothing is filed. */
export function anf4fSheet(a: ExportAuthorisation, exports: readonly EoMovement[], imports: readonly EoMovement[]): (string | number)[][] {
  return [
    [`ANF 4F working paper: ${a.kind === 'aa' ? 'Advance Authorisation' : 'EPCG'} ${a.number} dated ${a.date}, verify with a DGFT consultant (MF16 / MF17)`],
    ['Side', 'Document', 'Date', 'Item', 'Quantity', 'Value ₹ (FOB / CIF)'],
    ...exports.map((e) => ['Export', e.number, e.date, e.item, e.qty, e.value]),
    ...imports.map((e) => ['Import', e.number, e.date, e.item, e.qty, e.value]),
  ];
}

/** '' or why the row cannot be saved. */
export function validateAuthorisation(a: Pick<ExportAuthorisation, 'kind' | 'number' | 'date' | 'eo_due' | 'import_valid_to' | 'duty_saved' | 'items_export'>): string {
  if (a.kind !== 'aa' && a.kind !== 'epcg') return 'Pick Advance Authorisation or EPCG.';
  if (!a.number.trim()) return 'Type the authorisation number.';
  if (!isoDay(a.date) || !isoDay(a.eo_due) || !isoDay(a.import_valid_to)) return 'Type the issue, import-validity and EO dates.';
  if (a.eo_due < a.date) return 'The EO due date is before the issue date.';
  if (num(a.duty_saved) < 0) return 'Duty saved cannot be negative.';
  if (a.kind === 'aa' && !a.items_export.some((x) => num(x.qty) > 0 || num(x.fob_value) > 0)) return 'Add the export obligation (item, quantity, FOB value).';
  return '';
}

/* ── Store ────────────────────────────────────────────────────── */

export const authorisationsDb = {
  all: (): ExportAuthorisation[] => getTable<ExportAuthorisation>(AUTHORISATIONS_TABLE).filter((r) => r && typeof r.id === 'string'),

  save(input: Omit<ExportAuthorisation, 'id'> & { id?: string }): ExportAuthorisation {
    requireAccess('books.edit');
    const err = validateAuthorisation(input);
    if (err) throw new Error(err);
    const rows = authorisationsDb.all();
    const prev = input.id ? rows.find((r) => r.id === input.id) : undefined;
    if (rows.some((r) => r.id !== prev?.id && r.kind === input.kind && r.number.trim().toLowerCase() === input.number.trim().toLowerCase())) throw new Error('This authorisation number is already in the register.');
    if (prev) assertUnlocked({ issue_date: prev.date }, 'edit');
    assertUnlocked({ issue_date: input.date }, prev ? 'edit' : 'create');
    const now = new Date().toISOString();
    const row: ExportAuthorisation = { ...prev, ...input, id: prev?.id ?? generateId(), number: input.number.trim(), duty_saved: round2(num(input.duty_saved)), created_at: prev?.created_at ?? now, updated_at: now };
    setTable(AUTHORISATIONS_TABLE, prev ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
    return row;
  },

  /** Delete (recycle bin through the watched table); refused while invoices or bills are tagged to it. */
  remove(id: string, tagged: number): void {
    requireAccess('books.edit');
    const rows = authorisationsDb.all();
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    if (tagged > 0) throw new Error('Invoices or bills are tagged to this authorisation: untag them first.');
    assertUnlocked({ issue_date: row.date }, 'delete');
    setTable(AUTHORISATIONS_TABLE, rows.filter((r) => r.id !== id));
  },
};

/** The `mf` object of an invoice with the export snapshot set (or cleared with `null`); other `mf` fields kept. */
export function withExportAa(mf: Record<string, unknown> | undefined, a: ExportAuthorisation | null): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = { ...(mf ?? {}) };
  if (!a) {
    delete next.export_aa;
    if (next.kind === 'export_aa') delete next.kind;
    return Object.keys(next).length ? next : undefined;
  }
  next.kind = 'export_aa';
  next.export_aa = { authorisation_id: a.id, aa_no: a.kind === 'epcg' ? `EPCG ${a.number}` : a.number, ...(a.sion_ref ? { sion: a.sion_ref } : {}) } satisfies ExportAaSnapshot;
  return next;
}
