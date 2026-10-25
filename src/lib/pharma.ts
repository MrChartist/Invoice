/**
 * Pharma pack (7U, roadmap 7.43 — Marg's chemist workflow). Opt-in (`pharma_settings.enabled`):
 *
 *  - Drug licence number(s) on the sender profile (`BusinessProfile.drug_licence`), printed under the
 *    GSTIN on the A4 / GST / receipt layouts and the raw thermal receipt.
 *  - Schedule flags on stock items (`drug_schedule`: H / H1 / X, additive), set in the Pharma tile.
 *    Batch + expiry tracking already exists (6.6); the sale gate is `pharma-gate.ts`.
 *  - Prescription on the bill (`InvoiceRecord.rx`: patient, address, prescriber, registration no.),
 *    entered in the editor summary panel while the pack is on.
 *  - **Schedule H1 register** (Drugs & Cosmetics Rules, Rule 65(3)(c)): every sale of an H1 (and, as
 *    an option, X) drug with date, bill no., patient, prescriber, drug, batch and quantity; rows
 *    without a patient or prescriber are flagged. CSV for the inspector's register book.
 *  - Near-expiry / expired stock list by batch.
 *
 * Statutory record-keeping is the chemist's responsibility — verify the register format with the
 * drug inspector / your CA. Pure above "Storage".
 */

import type { InvoiceRecord } from '../types/invoice';
import { num } from './invoice-calc';
import { isRevenueDoc } from './stats';
import { toCsv } from './csv';
import { PHARMA_SETTINGS_KEY, plusDays, type PharmaSettings } from './pharma-gate';
import { getTable, setJson, setTable } from './storage';
import { requireAccess } from './access';
import type { TrackingMap } from './stock-tracking';

export { PHARMA_SETTINGS_KEY, readPharmaSettings, type PharmaSettings } from './pharma-gate';

export type DrugSchedule = 'H' | 'H1' | 'X';
export const DRUG_SCHEDULES: readonly DrugSchedule[] = ['H', 'H1', 'X'];

interface StockRow {
  id: string;
  name: string;
  aliases?: string[];
  drug_schedule?: string;
}

const norm = (s: string | undefined) => String(s ?? '').trim().toLowerCase();
const isSchedule = (v: unknown): v is DrugSchedule => v === 'H' || v === 'H1' || v === 'X';

/** Item name (and aliases) → schedule. */
export function scheduleIndex(items: readonly StockRow[]): Map<string, DrugSchedule> {
  const m = new Map<string, DrugSchedule>();
  for (const it of items) {
    if (!it || !isSchedule(it.drug_schedule)) continue;
    for (const n of [it.name, ...(it.aliases ?? [])]) if (norm(n) && !m.has(norm(n))) m.set(norm(n), it.drug_schedule);
  }
  return m;
}

export interface H1Row {
  date: string;
  number: string;
  patient: string;
  patient_address: string;
  prescriber: string;
  prescriber_reg: string;
  drug: string;
  schedule: DrugSchedule;
  batch: string;
  expiry: string;
  qty: number;
  unit: string;
  /** Patient or prescriber missing on the bill. */
  missingRx: boolean;
}

/** Schedule H1 (and optionally X / H) sales register for a period, in date order. */
export function h1Register(invoices: readonly InvoiceRecord[], index: ReadonlyMap<string, DrugSchedule>, period: { from: string; to: string }, schedules: readonly DrugSchedule[] = ['H1']): H1Row[] {
  const want = new Set(schedules);
  const rows: H1Row[] = [];
  for (const inv of invoices) {
    if (!inv || !isRevenueDoc(inv)) continue;
    const day = String(inv.issue_date ?? '');
    if (day < period.from || day > period.to) continue;
    for (const l of inv.items ?? []) {
      const sch = index.get(norm(l.name));
      if (!sch || !want.has(sch) || !(num(l.quantity) > 0)) continue;
      const rx = inv.rx;
      rows.push({
        date: day,
        number: inv.invoice_number,
        patient: rx?.patient?.trim() || inv.client?.name?.trim() || '',
        patient_address: rx?.patient_address?.trim() || '',
        prescriber: rx?.prescriber?.trim() || '',
        prescriber_reg: rx?.prescriber_reg?.trim() || '',
        drug: l.name,
        schedule: sch,
        batch: l.batch_no ?? '',
        expiry: l.batch_expiry ?? '',
        qty: num(l.quantity),
        unit: l.unit ?? '',
        missingRx: !rx?.patient?.trim() || !rx?.prescriber?.trim(),
      });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

export function h1RegisterCsv(rows: readonly H1Row[], period: { from: string; to: string }): string {
  return toCsv([
    [`Schedule H1 register ${period.from} to ${period.to} — verify the format with the drug inspector / your CA`],
    ['Date', 'Bill no.', 'Patient', 'Patient address', 'Prescriber', 'Prescriber reg. no.', 'Drug', 'Schedule', 'Batch', 'Expiry', 'Quantity', 'Unit', 'Prescription details missing'],
    ...rows.map((r) => [r.date, r.number, r.patient, r.patient_address, r.prescriber, r.prescriber_reg, r.drug, r.schedule, r.batch, r.expiry, r.qty, r.unit, r.missingRx ? 'Yes' : '']),
  ]);
}

/** Lines of a bill that need a prescription (H1 / X) while the bill has no patient + prescriber. */
export function rxMissing(rec: Pick<InvoiceRecord, 'items' | 'rx'>, index: ReadonlyMap<string, DrugSchedule>): string[] {
  if (rec.rx?.patient?.trim() && rec.rx?.prescriber?.trim()) return [];
  return rec.items.filter((l) => {
    const s = index.get(norm(l.name));
    return s === 'H1' || s === 'X';
  }).map((l) => l.name);
}

export interface ExpiryRow {
  item: string;
  batch: string;
  expiry: string;
  qty: number;
  unit: string;
  expired: boolean;
}

/** Batches in stock that are expired or expire within `days` of `day`, soonest first. */
export function nearExpiryStock(tracking: TrackingMap, day: string, days: number): ExpiryRow[] {
  const limit = plusDays(day, Math.max(days, 0));
  const rows: ExpiryRow[] = [];
  for (const t of tracking.values()) {
    for (const b of t.batches) {
      if (!b.batch || !b.expiry || !(b.qty > 0) || b.expiry > limit) continue;
      rows.push({ item: t.item.name, batch: b.batch, expiry: b.expiry, qty: b.qty, unit: t.item.unit ?? '', expired: b.expiry < day });
    }
  }
  return rows.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.item.localeCompare(b.item));
}

/* ── Storage ──────────────────────────────────────────────────── */

export function savePharmaSettings(s: PharmaSettings): void {
  requireAccess('settings.manage');
  setJson(PHARMA_SETTINGS_KEY, {
    enabled: !!s.enabled,
    block_expired: !!s.block_expired,
    near_expiry_days: Math.min(Math.max(Math.round(num(s.near_expiry_days)), 0), 730),
    block_near_expiry: !!s.block_near_expiry,
    block_above_mrp: !!s.block_above_mrp,
  });
}

export const liveScheduleIndex = (): Map<string, DrugSchedule> => scheduleIndex(getTable<StockRow>('stock_items'));

/** Set (or clear with '') the schedule of a stock item. */
export function setDrugSchedule(stockItemId: string, schedule: DrugSchedule | ''): void {
  requireAccess('master.edit');
  const all = getTable<StockRow>('stock_items');
  if (!all.some((i) => i?.id === stockItemId)) throw new Error('Stock item not found.');
  setTable('stock_items', all.map((i) => {
    if (i?.id !== stockItemId) return i;
    const next = { ...i };
    if (schedule) next.drug_schedule = schedule;
    else delete next.drug_schedule;
    return next;
  }));
}

