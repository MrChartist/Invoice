/**
 * R4-C2 export realisation register: shipping bill → bank IRM / FIRC → e-BRC, watching the FEMA realisation period.
 *
 * Rows are derived (never stored) from issued export invoices (EXPORT_* supply or place of supply 96 / 97). The
 * realisation clock starts on the shipping-bill date, else the invoice date (flagged). The period comes from the
 * dated `exportRealisationMonths` rule (9 months, 15 for shipments from the Nov 2025 amendment). Realised foreign
 * currency is the larger of the receipts recorded on the invoice (in its currency) and the IRMs allocated to it:
 * an IRM is the bank's record of the same remittance a receipt records, so the two are not added. Write-offs
 * (with a reason) close the rest.
 *
 * Tables `export_irms` and `export_writeoffs` (`books.edit`, dated). No network: IRMs are typed or imported from a
 * CSV the user downloads from the DGFT IRM repository / their bank. Working paper — verify with your CA.
 */
import type { ExportIrm, ExportWriteOff, IrmAllocation } from '../../types/trade-r4';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { isoDay, parseDay, localDayOf } from '../dates';
import { round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, setTable } from '../storage';
import { parseTable } from '../csv';
import { isExportDoc } from './exporter';
import { exportRealisationMonths } from './trade-rules';

export const IRMS_TABLE = 'export_irms';
export const WRITEOFFS_TABLE = 'export_writeoffs';
/** Due within this many days → "due soon" notice. */
export const DUE_SOON_DAYS = 60;

/* ── Dates ───────────────────────────────────────────────────── */

/** `day` + `months` calendar months, clamped to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(day: string, months: number): string {
  const d = parseDay(day);
  const y = d.getFullYear();
  const m = d.getMonth() + months;
  const last = new Date(y, m + 1, 0).getDate();
  return localDayOf(new Date(y, m, Math.min(d.getDate(), last)));
}
/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);
}

/* ── Rows ────────────────────────────────────────────────────── */

export type RealisationStatus = 'open' | 'part' | 'realised' | 'overdue' | 'written_off';

export interface RealisationRow {
  invoiceId: string;
  number: string;
  invoiceDate: string;
  party: string;
  currency: string;
  sbNo: string;
  sbDate: string;
  /** No shipping bill typed: the clock runs from the invoice date. */
  sbMissing: boolean;
  shipDate: string;
  /** Invoice value in its own currency. */
  fcy: number;
  receivedFcy: number;
  irmFcy: number;
  realisedFcy: number;
  writtenOffFcy: number;
  outstandingFcy: number;
  months: number;
  dueDate: string;
  daysLeft: number;
  status: RealisationStatus;
  writeOffReason?: string;
  irms: { id: string; irm_no: string; date: string; fcy: number; ebrc_no?: string; ebrc_status?: string }[];
}

export interface RegisterInput {
  invoices: readonly Partial<InvoiceRecord>[];
  payments: readonly Partial<Payment>[];
  irms: readonly ExportIrm[];
  writeoffs: readonly ExportWriteOff[];
  /** Local day the register is drawn "as at" (receipts / IRMs / write-offs after it are ignored). */
  today: string;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const live = (i: Partial<InvoiceRecord>) => i.status !== 'Draft' && i.status !== 'Cancelled' && (i.doc_type ?? 'INVOICE') === 'INVOICE';

/** Issued export invoices the register follows. */
export const exportInvoices = (invoices: readonly Partial<InvoiceRecord>[]) => invoices.filter((i) => i && i.id && live(i) && isExportDoc(i as InvoiceRecord));

export function buildRegister(input: RegisterInput): RealisationRow[] {
  const asAt = input.today;
  const received = new Map<string, number>();
  for (const p of input.payments) {
    // A bad-debt write-off or a gift-voucher redemption (R4-B) brings no foreign exchange in.
    if (!p?.invoice_id || p.write_off || (p as { gift_voucher_id?: string }).gift_voucher_id || p.deposit_adjustment_id || (p.date && p.date > asAt)) continue; // R5-C6: deposit adjustments too
    received.set(p.invoice_id, (received.get(p.invoice_id) ?? 0) + n(p.amount));
  }
  const irmBy = new Map<string, RealisationRow['irms']>();
  for (const irm of input.irms) {
    if (!irm || (irm.date && irm.date > asAt)) continue;
    for (const a of irm.allocations ?? []) {
      if (!a?.invoice_id || !(n(a.fcy) > 0)) continue;
      const list = irmBy.get(a.invoice_id) ?? [];
      list.push({ id: irm.id, irm_no: irm.irm_no, date: irm.date, fcy: n(a.fcy), ebrc_no: irm.ebrc_no, ebrc_status: irm.ebrc_status });
      irmBy.set(a.invoice_id, list);
    }
  }
  const wo = new Map(input.writeoffs.filter((w) => w && (!w.date || w.date <= asAt)).map((w) => [w.invoice_id, w]));
  const rows: RealisationRow[] = [];
  for (const inv of exportInvoices(input.invoices)) {
    const id = String(inv.id);
    const sbDate = isoDay(inv.shipping_bill_date);
    const invoiceDate = isoDay(inv.issue_date);
    const shipDate = sbDate || invoiceDate;
    if (!shipDate) continue;
    const months = exportRealisationMonths(shipDate);
    const dueDate = addMonths(shipDate, months);
    const fcy = round2(n(inv.total));
    const receivedFcy = round2(received.get(id) ?? 0);
    const irms = irmBy.get(id) ?? [];
    const irmFcy = round2(irms.reduce((s, r) => s + r.fcy, 0));
    const realisedFcy = round2(Math.min(Math.max(receivedFcy, irmFcy), fcy));
    const w = wo.get(id);
    const writtenOffFcy = w ? round2(Math.min(n(w.fcy), Math.max(fcy - realisedFcy, 0))) : 0;
    const outstandingFcy = round2(Math.max(fcy - realisedFcy - writtenOffFcy, 0));
    const daysLeft = daysBetween(asAt, dueDate);
    const status: RealisationStatus =
      outstandingFcy <= 0.005 ? (writtenOffFcy > 0 ? 'written_off' : 'realised') : daysLeft < 0 ? 'overdue' : realisedFcy > 0 ? 'part' : 'open';
    rows.push({
      invoiceId: id,
      number: String(inv.invoice_number ?? ''),
      invoiceDate,
      party: String(inv.client?.name ?? inv.client?.company ?? ''),
      currency: String(inv.currency || 'INR').toUpperCase(),
      sbNo: String(inv.shipping_bill_no ?? ''),
      sbDate,
      sbMissing: !sbDate || !String(inv.shipping_bill_no ?? '').trim(),
      shipDate,
      fcy,
      receivedFcy,
      irmFcy,
      realisedFcy,
      writtenOffFcy,
      outstandingFcy,
      months,
      dueDate,
      daysLeft,
      status,
      ...(w ? { writeOffReason: w.reason } : {}),
      irms,
    });
  }
  return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
}

/** Year-end note: the rows still unrealised as at `asAt` (e.g. 31 March). Feeds nothing automatically. */
export function unrealisedAt(input: Omit<RegisterInput, 'today'>, asAt: string): RealisationRow[] {
  return buildRegister({ ...input, today: asAt }).filter((r) => r.outstandingFcy > 0.005 && r.shipDate <= asAt);
}

/* ── Matching IRMs to invoices ───────────────────────────────── */

export interface MatchSuggestion {
  invoiceId: string;
  number: string;
  party: string;
  outstandingFcy: number;
  score: number;
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2));

/**
 * Invoices an IRM probably pays, best first: same currency, shipped on or before the remittance (advances
 * aside), scored by amount (exact outstanding best), remitter name and closeness in time.
 */
export function suggestMatches(irm: Pick<ExportIrm, 'currency' | 'fcy' | 'date' | 'remitter'>, rows: readonly RealisationRow[]): MatchSuggestion[] {
  const cur = String(irm.currency || '').toUpperCase();
  const rem = words(String(irm.remitter ?? ''));
  const out: MatchSuggestion[] = [];
  for (const r of rows) {
    if (r.currency !== cur || r.outstandingFcy <= 0.005) continue;
    let score = 0;
    const diff = Math.abs(r.outstandingFcy - n(irm.fcy));
    if (diff < 0.01) score += 60;
    else if (diff <= r.outstandingFcy * 0.02) score += 40; // bank charges deducted abroad
    else if (n(irm.fcy) < r.outstandingFcy) score += 15; // a part payment
    if (rem.size) {
      const party = words(r.party);
      if ([...rem].some((w) => party.has(w))) score += 30;
    }
    if (irm.date) {
      const gap = daysBetween(r.shipDate, irm.date);
      if (gap >= -30) score += Math.max(0, 10 - Math.floor(Math.abs(gap) / 30));
    }
    if (score > 0) out.push({ invoiceId: r.invoiceId, number: r.number, party: r.party, outstandingFcy: r.outstandingFcy, score });
  }
  return out.sort((a, b) => b.score - a.score || a.number.localeCompare(b.number));
}

/** Allocation problems: over the IRM amount, over an invoice's outstanding (other IRMs aside), or unknown invoice. */
export function allocationProblems(irm: Pick<ExportIrm, 'id' | 'fcy' | 'currency'>, allocations: readonly IrmAllocation[], rows: readonly RealisationRow[]): string[] {
  const out: string[] = [];
  const total = round2(allocations.reduce((s, a) => s + n(a.fcy), 0));
  if (total > n(irm.fcy) + 0.005) out.push('allocOver');
  for (const a of allocations) {
    const r = rows.find((x) => x.invoiceId === a.invoice_id);
    if (!r) {
      out.push('allocUnknown');
      continue;
    }
    if (r.currency !== String(irm.currency).toUpperCase()) out.push('allocCurrency');
    const mine = r.irms.filter((x) => x.id === irm.id).reduce((s, x) => s + x.fcy, 0);
    if (n(a.fcy) > round2(r.fcy - (r.irmFcy - mine)) + 0.005) out.push('allocInvoiceOver');
  }
  return [...new Set(out)];
}

/** Greedy split of an IRM over the suggested invoices (oldest due first), never above outstanding. */
export function autoAllocate(irm: Pick<ExportIrm, 'currency' | 'fcy' | 'date' | 'remitter'>, rows: readonly RealisationRow[]): IrmAllocation[] {
  const picks = suggestMatches(irm, rows).filter((s) => s.score >= 40);
  const byDue = picks.map((p) => rows.find((r) => r.invoiceId === p.invoiceId)!).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  let left = n(irm.fcy);
  const out: IrmAllocation[] = [];
  for (const r of byDue) {
    if (left <= 0.005) break;
    const take = round2(Math.min(left, r.outstandingFcy));
    if (take > 0) out.push({ invoice_id: r.invoiceId, fcy: take });
    left = round2(left - take);
  }
  return out;
}

/* ── CSV import (column mapping through the import-mapping scorer) ── */

export const IRM_FIELDS = [
  { key: 'irm_no', synonyms: ['irm number', 'irm no', 'irm', 'firc number', 'firc no', 'reference number', 'remittance reference'] },
  { key: 'date', synonyms: ['irm date', 'remittance date', 'date', 'value date', 'credit date'] },
  { key: 'currency', synonyms: ['currency', 'remittance currency', 'ccy', 'fcy currency'] },
  { key: 'fcy', synonyms: ['remittance amount', 'irm amount', 'fcy amount', 'amount', 'foreign currency amount'] },
  { key: 'bank', synonyms: ['bank name', 'ad bank', 'bank', 'ifsc'] },
  { key: 'purpose', synonyms: ['purpose code', 'purpose'] },
  { key: 'remitter', synonyms: ['remitter name', 'remitter', 'ordering customer', 'buyer name'] },
] as const;
export type IrmField = (typeof IRM_FIELDS)[number]['key'];
export type IrmMapping = Partial<Record<IrmField, number>>;

const norm = (h: string) => h.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
/**
 * Header ↔ synonym score (0..1), the same idea as the CSV importer's `scoreHeader` (import-mapping.ts): exact match,
 * then containment, then shared words. Kept here so the export desk does not split the importer's chunk.
 */
export function headerScore(header: string, synonyms: readonly string[]): number {
  const h = norm(header);
  if (!h) return 0;
  const hw = new Set(h.split(' '));
  let best = 0;
  for (const syn of synonyms) {
    const s = norm(syn);
    const sw = s.split(' ');
    const score = h === s ? 1 : h.length >= 3 && (h.includes(s) || s.includes(h)) ? 0.7 : (0.6 * sw.filter((w) => hw.has(w)).length) / new Set([...sw, ...hw]).size;
    if (score > best) best = score;
  }
  return best;
}

/** Best column per IRM field (each column used once). */
export function guessIrmMapping(header: readonly string[]): IrmMapping {
  const pairs: { key: IrmField; col: number; score: number }[] = [];
  for (const f of IRM_FIELDS) header.forEach((h, col) => {
    const s = headerScore(h, f.synonyms);
    if (s >= 0.45) pairs.push({ key: f.key, col, score: s });
  });
  pairs.sort((a, b) => b.score - a.score);
  const out: IrmMapping = {};
  const used = new Set<number>();
  for (const p of pairs) {
    if (out[p.key] !== undefined || used.has(p.col)) continue;
    out[p.key] = p.col;
    used.add(p.col);
  }
  return out;
}

export interface IrmImport {
  header: string[];
  mapping: IrmMapping;
  rows: Omit<ExportIrm, 'id'>[];
  /** 1-based data row numbers that were skipped, with the reason. */
  skipped: { row: number; reason: string }[];
}

/**
 * Parse an IRM CSV: header row, then one IRM per line. `parseDate` (the importers' day-first reader) is passed in
 * so this module stays free of the importer chunk. Rows without a number, date or positive amount are skipped.
 */
export function parseIrmCsv(text: string, parseDate: (raw: unknown) => string | null, mapping?: IrmMapping): IrmImport {
  const t = parseTable(text);
  const header = t.headers;
  const map = mapping ?? guessIrmMapping(header);
  const cell = (row: string[], k: IrmField) => (map[k] === undefined || map[k]! < 0 ? '' : String(row[map[k]!] ?? '').trim());
  const rows: Omit<ExportIrm, 'id'>[] = [];
  const skipped: IrmImport['skipped'] = [];
  t.rows.forEach((row, i) => {
    const irm_no = cell(row, 'irm_no');
    const date = parseDate(cell(row, 'date')) ?? '';
    const fcy = round2(Number(cell(row, 'fcy').replace(/[^0-9.-]/g, '')));
    if (!irm_no) return skipped.push({ row: i + 1, reason: 'irmNoMissing' });
    if (!date) return skipped.push({ row: i + 1, reason: 'irmDateMissing' });
    if (!(fcy > 0)) return skipped.push({ row: i + 1, reason: 'irmAmountMissing' });
    rows.push({
      irm_no,
      date,
      currency: (cell(row, 'currency') || 'USD').toUpperCase().slice(0, 3),
      fcy,
      ...(cell(row, 'bank') ? { bank: cell(row, 'bank') } : {}),
      ...(cell(row, 'purpose') ? { purpose: cell(row, 'purpose').toUpperCase() } : {}),
      ...(cell(row, 'remitter') ? { remitter: cell(row, 'remitter') } : {}),
      allocations: [],
    });
  });
  return { header, mapping: map, rows, skipped };
}

/* ── Outputs ─────────────────────────────────────────────────── */

export const REGISTER_HEADER = ['Invoice', 'Invoice date', 'Party', 'Currency', 'Shipping bill', 'SB date', 'Invoice FCY', 'Realised FCY', 'Written off FCY', 'Outstanding FCY', 'Due by', 'Days left', 'Status', 'IRMs', 'e-BRC'];

export function registerSheet(rows: readonly RealisationRow[]): (string | number)[][] {
  return [
    REGISTER_HEADER,
    ...rows.map((r) => [
      r.number, r.invoiceDate, r.party, r.currency, r.sbNo || (r.sbMissing ? '(not typed)' : ''), r.sbDate, r.fcy, r.realisedFcy, r.writtenOffFcy,
      r.outstandingFcy, r.dueDate, r.daysLeft, r.status, r.irms.map((x) => x.irm_no).join('; '),
      r.irms.map((x) => (x.ebrc_no ? `${x.ebrc_no} (${x.ebrc_status ?? 'pending'})` : '')).filter(Boolean).join('; '),
    ]),
  ];
}

/** "For the bank": one party's open shipping bills. */
export function bankStatementSheet(rows: readonly RealisationRow[], party: string): (string | number)[][] {
  const mine = rows.filter((r) => r.party === party && r.outstandingFcy > 0.005);
  return [
    ['Open shipping bills', party],
    ['Invoice', 'Invoice date', 'Shipping bill', 'SB date', 'Currency', 'Invoice FCY', 'Realised FCY', 'Outstanding FCY', 'Due by'],
    ...mine.map((r) => [r.number, r.invoiceDate, r.sbNo, r.sbDate, r.currency, r.fcy, r.realisedFcy, r.outstandingFcy, r.dueDate]),
  ];
}

/* ── Store ───────────────────────────────────────────────────── */

const lockCheck = (date: string, action: 'create' | 'edit' | 'delete', number?: string) => assertUnlocked({ issue_date: date, invoice_number: number }, action);

export const irmsDb = {
  all: (): ExportIrm[] => getTable<ExportIrm>(IRMS_TABLE).filter((r) => r && typeof r.id === 'string'),
  save(input: Omit<ExportIrm, 'id'> & { id?: string }): ExportIrm {
    requireAccess('books.edit');
    if (!String(input.irm_no ?? '').trim()) throw new Error('irmNoMissing');
    if (!isoDay(input.date)) throw new Error('irmDateMissing');
    if (!(n(input.fcy) > 0)) throw new Error('irmAmountMissing');
    const rows = irmsDb.all();
    const prev = input.id ? rows.find((r) => r.id === input.id) : undefined;
    if (prev) lockCheck(prev.date, 'edit', prev.irm_no);
    lockCheck(input.date, prev ? 'edit' : 'create', input.irm_no);
    const dup = rows.find((r) => r.id !== prev?.id && r.irm_no.trim().toUpperCase() === input.irm_no.trim().toUpperCase());
    if (dup) throw new Error('irmDuplicate');
    const now = new Date().toISOString();
    const row: ExportIrm = {
      ...prev,
      ...input,
      id: prev?.id ?? input.id ?? generateId(),
      irm_no: input.irm_no.trim(),
      currency: String(input.currency || 'USD').toUpperCase(),
      fcy: round2(n(input.fcy)),
      allocations: (input.allocations ?? []).filter((a) => a?.invoice_id && n(a.fcy) > 0).map((a) => ({ invoice_id: a.invoice_id, fcy: round2(n(a.fcy)) })),
      created_at: prev?.created_at ?? now,
      updated_at: now,
    };
    setTable(IRMS_TABLE, prev ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
    return row;
  },
  /** Several imported IRMs in one write (duplicates by number are skipped). Returns how many were added. */
  importMany(list: readonly Omit<ExportIrm, 'id'>[]): number {
    requireAccess('books.edit');
    const rows = irmsDb.all();
    const seen = new Set(rows.map((r) => r.irm_no.trim().toUpperCase()));
    const now = new Date().toISOString();
    const add: ExportIrm[] = [];
    for (const r of list) {
      const key = r.irm_no.trim().toUpperCase();
      if (seen.has(key)) continue;
      lockCheck(r.date, 'create', r.irm_no);
      seen.add(key);
      add.push({ ...r, id: generateId(), created_at: now, updated_at: now });
    }
    if (add.length) setTable(IRMS_TABLE, [...rows, ...add]);
    return add.length;
  },
  remove(id: string): void {
    requireAccess('books.edit');
    const rows = irmsDb.all();
    const row = rows.find((r) => r.id === id);
    if (row) lockCheck(row.date, 'delete', row.irm_no);
    setTable(IRMS_TABLE, rows.filter((r) => r.id !== id));
  },
};

export const writeoffsDb = {
  all: (): ExportWriteOff[] => getTable<ExportWriteOff>(WRITEOFFS_TABLE).filter((r) => r && typeof r.id === 'string'),
  /** One write-off per invoice (a second one replaces the first). A reason is required. */
  save(input: Omit<ExportWriteOff, 'id' | 'created_at'>): ExportWriteOff {
    requireAccess('books.edit');
    if (!String(input.reason ?? '').trim()) throw new Error('woReason');
    if (!isoDay(input.date)) throw new Error('woDate');
    lockCheck(input.date, 'create');
    const rows = writeoffsDb.all();
    const prev = rows.find((r) => r.invoice_id === input.invoice_id);
    if (prev) lockCheck(prev.date, 'edit');
    const row: ExportWriteOff = { id: prev?.id ?? generateId(), invoice_id: input.invoice_id, date: input.date, reason: input.reason.trim(), fcy: round2(n(input.fcy)), created_at: new Date().toISOString() };
    setTable(WRITEOFFS_TABLE, [...rows.filter((r) => r.invoice_id !== input.invoice_id), row]);
    return row;
  },
  remove(invoiceId: string): void {
    requireAccess('books.edit');
    const rows = writeoffsDb.all();
    const row = rows.find((r) => r.invoice_id === invoiceId);
    if (row) lockCheck(row.date, 'delete');
    setTable(WRITEOFFS_TABLE, rows.filter((r) => r.invoice_id !== invoiceId));
  },
};

/** The register from live storage. */
export function liveRegister(today: string): RealisationRow[] {
  return buildRegister({
    invoices: getTable<InvoiceRecord>('invoices'),
    payments: getTable<Payment>('transactions'),
    irms: irmsDb.all(),
    writeoffs: writeoffsDb.all(),
    today,
  });
}
