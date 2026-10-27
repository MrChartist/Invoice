/**
 * RT-B2 registers, retention and licence alerts (docs/prd/round-9.md §4 RT-B2).
 *
 *  - Schedule H1 / H: the existing `pharma.ts` `h1Register` (unchanged) with the schedules asked for.
 *  - Schedule X: its own register (date, bill no., patient + address, prescriber + reg., drug, batch, qty, prescription
 *    retained, Rx no.); rows missing Rx details are flagged.
 *  - Narcotic / psychotropic items (stock item `narcotic`): opening, received (purchase lines, read through the purchases
 *    contract; customer returns), sold and closing per item and batch for a period, in base units (`lineFactor`).
 *  - `registerBook`: an A4 print document (page numbers, the period on every page, "verify the format with your drug
 *    inspector"); every register is also CSV.
 *  - Retention (`PHARMA_RETENTION_RULES`: H1 3 years, X prescription 2 years, cash memos 3 years — RT7): `retainedBills`
 *    lists bills with H1 / X lines still inside it, for the recycle bin's "delete for good" and the year-end checklist.
 *    It warns, never blocks: the owner decides.
 *  - `licenceNotices`: licences expiring within 60 days or expired.
 *
 * Working papers — verify with your drug inspector / CA. Pure above the read-only "Storage" section.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { DrugLicence } from '../../types/retail-r9';
import { num } from '../invoice-calc';
import { isRevenueDoc } from '../stats';
import { toCsv } from '../csv';
import { plusDays, readPharmaSettings } from '../pharma-gate';
import { liveScheduleIndex, type H1Row } from '../pharma';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';
import { lineFactor } from '../units';
import { ruleAt } from '../tax-rules';
import { PHARMA_RETENTION_RULES, type PharmaRetention } from '../retail-rules';

type Schedule = 'H' | 'H1' | 'X';
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const r3 = (n: number) => Math.round(n * 1000) / 1000 || 0;

/* ── Schedule X register ── */

export interface XRow {
  date: string;
  number: string;
  patient: string;
  patient_address: string;
  prescriber: string;
  prescriber_reg: string;
  drug: string;
  batch: string;
  qty: number;
  unit: string;
  retained: boolean;
  rx_no: string;
  /** Patient, address, prescriber or "retained" missing. */
  missingRx: boolean;
}

export function xRegister(invoices: readonly InvoiceRecord[], index: ReadonlyMap<string, Schedule>, period: { from: string; to: string }): XRow[] {
  const rows: XRow[] = [];
  for (const inv of invoices) {
    if (!inv || !isRevenueDoc(inv)) continue;
    const day = String(inv.issue_date ?? '');
    if (day < period.from || day > period.to) continue;
    const rx = inv.rx;
    for (const l of inv.items ?? []) {
      if (index.get(norm(l.name)) !== 'X' || !(num(l.quantity) > 0)) continue;
      rows.push({
        date: day, number: inv.invoice_number,
        patient: rx?.patient?.trim() || inv.client?.name?.trim() || '', patient_address: rx?.patient_address?.trim() ?? '',
        prescriber: rx?.prescriber?.trim() ?? '', prescriber_reg: rx?.prescriber_reg?.trim() ?? '',
        drug: l.name, batch: l.batch_no ?? '', qty: num(l.quantity), unit: l.unit ?? '',
        retained: rx?.retained === true, rx_no: rx?.rx_no ?? '',
        missingRx: !rx?.patient?.trim() || !rx?.patient_address?.trim() || !rx?.prescriber?.trim() || rx?.retained !== true,
      });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

export const X_HEAD = ['Date', 'Bill no.', 'Patient', 'Patient address', 'Prescriber', 'Reg. no.', 'Drug', 'Batch', 'Qty', 'Unit', 'Prescription retained', 'Rx no.', 'Details missing'] as const;
export const xCells = (r: XRow): (string | number)[] => [r.date, r.number, r.patient, r.patient_address, r.prescriber, r.prescriber_reg, r.drug, r.batch, r.qty, r.unit, r.retained ? 'Yes' : 'No', r.rx_no, r.missingRx ? 'Yes' : ''];

/* ── Narcotic / psychotropic register ── */

export interface NarcoticRow {
  item: string;
  batch: string;
  unit: string;
  opening: number;
  received: number;
  sold: number;
  closing: number;
}

interface NarcoticItem { id: string; name: string; unit?: string; narcotic?: boolean; opening_qty?: number; aliases?: string[] }

/**
 * Opening / received / sold / closing per narcotic item and batch for `period`, in base units. Received = purchase lines
 * (paid + free) and customer returns (credit notes); sold = revenue bills. The opening quantity of the item master counts
 * as batch "—" received before every period.
 */
export function narcoticRegister(items: readonly NarcoticItem[], purchases: readonly unknown[], invoices: readonly InvoiceRecord[], period: { from: string; to: string }): NarcoticRow[] {
  const byName = new Map<string, NarcoticItem>();
  const byId = new Map<string, NarcoticItem>();
  for (const it of items) {
    if (!it?.narcotic) continue;
    byId.set(it.id, it);
    for (const n of [it.name, ...(it.aliases ?? [])]) if (norm(n)) byName.set(norm(n), it);
  }
  const rows = new Map<string, NarcoticRow>();
  const row = (it: NarcoticItem, batch: string) => {
    const key = `${it.id}|${batch.toUpperCase()}`;
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { item: it.name, batch, unit: it.unit ?? '', opening: 0, received: 0, sold: 0, closing: 0 }));
    return r;
  };
  const add = (it: NarcoticItem, batch: string, day: string, qty: number, kind: 'in' | 'out') => {
    if (!qty || day > period.to) return;
    const r = row(it, batch);
    if (day < period.from) r.opening += kind === 'in' ? qty : -qty;
    else if (kind === 'in') r.received += qty;
    else r.sold += qty;
  };
  for (const it of byId.values()) if (num(it.opening_qty) > 0) row(it, '').opening += num(it.opening_qty);
  for (const raw of purchases) {
    const b = readPurchase(raw);
    if (!b || b.isExpense || isVoidStatus(b.status)) continue;
    for (const l of readPurchaseLines(raw)) {
      const it = (l.itemId && byId.get(l.itemId)) || byName.get(norm(l.name));
      if (it) add(it, l.batchNo, b.date, l.quantity * l.unitFactor, 'in');
    }
  }
  for (const inv of invoices) {
    const ret = inv?.doc_type === 'CREDIT_NOTE' && inv.status !== 'Draft' && inv.status !== 'Cancelled';
    if (!inv || (!ret && !isRevenueDoc(inv))) continue;
    for (const l of inv.items ?? []) {
      const it = byName.get(norm(l.name));
      if (it) add(it, l.batch_no ?? '', String(inv.issue_date ?? ''), num(l.quantity) * lineFactor(l), ret ? 'in' : 'out');
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, opening: r3(r.opening), received: r3(r.received), sold: r3(r.sold), closing: r3(r.opening + r.received - r.sold) }))
    .filter((r) => r.opening || r.received || r.sold || r.closing)
    .sort((a, b) => a.item.localeCompare(b.item) || a.batch.localeCompare(b.batch));
}

export const NARCOTIC_HEAD = ['Item', 'Batch', 'Unit', 'Opening', 'Received', 'Sold', 'Closing'] as const;
export const narcoticCells = (r: NarcoticRow): (string | number)[] => [r.item, r.batch || '—', r.unit, r.opening, r.received, r.sold, r.closing];

/* ── CSV and the printed book ── */

export function registerCsv(title: string, period: { from: string; to: string }, head: readonly string[], rows: readonly (string | number)[][]): string {
  return toCsv([[`${title} ${period.from} to ${period.to} — verify the format with your drug inspector / CA`], [...head], ...rows]);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Rows split into pages of `perPage` (at least one, empty, page). */
export function paginate<T>(rows: readonly T[], perPage = 25): T[][] {
  const n = Math.max(1, Math.floor(perPage));
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += n) pages.push(rows.slice(i, i + n));
  return pages.length ? pages : [[]];
}

/** Script-free A4 print document: one table per page, page "n of N" and the period on each page. */
export function registerBook(opts: { title: string; shop: string; licence?: string; period: { from: string; to: string }; head: readonly string[]; rows: readonly (string | number)[][]; flagged?: readonly boolean[]; perPage?: number }): string {
  const pages = paginate(opts.rows.map((r, i) => ({ r, bad: !!opts.flagged?.[i] })), opts.perPage ?? 25);
  const body = pages.map((p, i) => `<section class="pg"><header><b>${esc(opts.shop)}</b>${opts.licence ? ` · DL: ${esc(opts.licence)}` : ''}<br>${esc(opts.title)} · ${esc(opts.period.from)} to ${esc(opts.period.to)} · Page ${i + 1} of ${pages.length}</header>
<table><thead><tr>${opts.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${p.map((x) => `<tr${x.bad ? ' class="bad"' : ''}>${x.r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
<footer>Working paper — verify the register format with your drug inspector / CA. Rows shaded: prescription details missing.</footer></section>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>@page{size:A4;margin:12mm}body{font:10px system-ui,sans-serif;color:#000}.pg{page-break-after:always}.pg:last-child{page-break-after:auto}header{margin-bottom:6px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #444;padding:2px 4px;text-align:left}tr.bad td{background:#eee}footer{margin-top:6px;font-size:9px}</style></head><body>${body}</body></html>`;
}

/* ── Retention ── */

export const retentionAt = (day: string): PharmaRetention => ruleAt(PHARMA_RETENTION_RULES, day);

/** Local day until which a bill of `day` with lines of `schedules` is kept (H1: register years; X: prescription years). */
export function keepUntil(day: string, schedules: readonly Schedule[]): string {
  const r = retentionAt(day);
  const years = Math.max(schedules.includes('H1') ? r.h1Years : 0, schedules.includes('X') ? r.xPrescriptionYears : 0);
  if (!years) return '';
  return plusDays(`${+day.slice(0, 4) + years}${day.slice(4)}`, 0);
}

/** Bills with H1 / X lines still inside their retention window on `today`. */
export function retainedBills(invoices: readonly InvoiceRecord[], index: ReadonlyMap<string, Schedule>, today: string): { id: string; number: string; until: string }[] {
  const out: { id: string; number: string; until: string }[] = [];
  for (const inv of invoices) {
    if (!inv?.issue_date) continue;
    const sch = [...new Set((inv.items ?? []).map((l) => index.get(norm(l.name))).filter((s): s is Schedule => s === 'H1' || s === 'X'))];
    if (!sch.length) continue;
    const until = keepUntil(inv.issue_date, sch);
    if (until && until > today) out.push({ id: inv.id, number: inv.invoice_number, until });
  }
  return out;
}

/* ── Licences ── */

export const LICENCE_ALERT_DAYS = 60;

/** Licences expiring within `days` of `today` ("due") or already expired. */
export function licenceNotices(licences: readonly DrugLicence[] | undefined, today: string, days = LICENCE_ALERT_DAYS): { licence: DrugLicence; expired: boolean }[] {
  const limit = plusDays(today, days);
  return (licences ?? []).filter((l) => l?.valid_to && l.valid_to <= limit).map((l) => ({ licence: l, expired: l.valid_to! < today }));
}

/* ── Schedule H1 / H register cells (rows from `pharma.ts` `h1Register`) ── */

export const H1_HEAD = ['Date', 'Bill no.', 'Patient', 'Patient address', 'Prescriber', 'Reg. no.', 'Drug', 'Schedule', 'Batch', 'Expiry', 'Qty', 'Unit', 'Details missing'] as const;
export const h1Cells = (r: H1Row): (string | number)[] => [r.date, r.number, r.patient, r.patient_address, r.prescriber, r.prescriber_reg, r.drug, r.schedule, r.batch, r.expiry, r.qty, r.unit, r.missingRx ? 'Yes' : ''];

/* ── Storage (read only): retention warnings for the recycle bin and the year-end checklist ── */

/** Invoice rows (live or deleted) with H1 / X lines still inside retention on `today` ([] with the pharma features off). */
export function retainedAmong(rows: readonly unknown[], today: string): { id: string; number: string; until: string }[] {
  if (!readPharmaSettings().enabled) return [];
  const invoices = rows.filter((r): r is InvoiceRecord => !!r && typeof r === 'object' && Array.isArray((r as InvoiceRecord).items));
  return invoices.length ? retainedBills(invoices, liveScheduleIndex(), today) : [];
}

/** Year-end: bills of the year (`from` … `to`) with H1 / X lines to keep, and the latest keep-until day. */
export function rxRetainedInYear(invoices: readonly InvoiceRecord[], from: string, to: string, today: string): { count: number; until: string } | undefined {
  const rows = retainedAmong(invoices.filter((i) => i?.issue_date >= from && i.issue_date <= to), today);
  return rows.length ? { count: rows.length, until: rows.reduce((m, r) => (r.until > m ? r.until : m), '') } : undefined;
}
