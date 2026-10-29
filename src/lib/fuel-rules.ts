/**
 * Fuel retail statutory and dealer-guideline values (Round 21), keyed by the date they take effect — the `Versioned`
 * shape of `tax-rules.ts`: add a new dated row, never edit an old one. Imported only by lazy Round 21 modules
 * (`src/lib/fuel/*`) — never by `tax-rules.ts`, `tds-rules.ts`, `shop-mode.ts` or the shell (`tests/fu-rules.test.ts`
 * checks the import graph). GST slabs, 194Q, Act labels and the Rule 42 true-up dates stay in their own files.
 *
 * A row is `verified: true` only when its value was read in a primary text in Round 21 (PRD §2.4; the source then says
 * "Read (R21)"). Oil-company dealer rules (MDG) are contract terms, not law: hint rows that never block a save. A
 * recommendation is a `pending-changes.ts` note, never a row here. One block per package (B–D append theirs below).
 * Working papers — verify with your CA (docs/CA_REVIEW.md §21).
 */
import type { Versioned } from './tax-rules';
import type { FuProduct } from '../types/fuel-r21';

/** A dated fuel rule row: `source` plus whether the value was read in a primary text this round. */
export type FuRule<T> = Versioned<T> & { verified: boolean };
/** A row of a keyed table (GST status by product). */
export type FuKeyedRule<T> = FuRule<T> & { key: string };

/** The latest row of `key` from on or before `date` (null before the first row of that key). */
export function fuKeyedAt<T>(rows: readonly FuKeyedRule<T>[], key: string, date: string): FuKeyedRule<T> | null {
  let hit: FuKeyedRule<T> | null = null;
  for (const r of rows) if (r.key === key && r.from <= date) hit = r;
  return hit;
}

/** The latest row from on or before `date` (null before the first row). */
export function fuAt<T>(rows: readonly FuRule<T>[], date: string): FuRule<T> | null {
  let hit: FuRule<T> | null = null;
  for (const r of rows) if (r.from <= date) hit = r;
  return hit;
}

/* ── R21-A: GST status (FU1, FU2), e-Way (FU3), MDG (FU15–FU19), Legal Metrology (FU24) ─────────────────────── */

const SEC92 = 'Sec 9(2) CGST Act: outside GST until a date is notified (S) (FU1)';
/** Non-GST products by key (`FuProduct`); a product without a row follows its item's GST slab. */
export const FUEL_GST_STATUS_RULES: readonly FuKeyedRule<'non_gst'>[] = (['ms', 'hsd', 'ms_branded', 'hsd_branded', 'cng'] as const satisfies readonly FuProduct[])
  .map((key) => ({ key, from: '2017-07-01', value: 'non_gst' as const, source: SEC92, verified: false }));

/** Lubricants, AdBlue, auto-LPG and shop items take the item's HSN slab (a hint shown on the tank / price views). */
export const LUBE_HINT_RULES: readonly FuRule<{ slab: 'item' }>[] = [
  { from: '2017-07-01', value: { slab: 'item' }, source: 'Item HSN slab; lubricants 18 % (S) (FU2, FU22)', verified: false },
];

/** Rule 138(14): no e-Way bill for MS / HSD / natural gas (and liquor, crude, ATF) — non-GST lines leave the e-Way JSON. */
export const EWAY_FUEL_EXEMPT_RULES: readonly FuRule<{ leave_out: 'non_gst' }>[] = [
  { from: '2018-04-01', value: { leave_out: 'non_gst' }, source: 'Rule 138(14) CGST Rules (clause letter differs between copies, S) (FU3)', verified: false },
];

const MDG = 'HPCL MDG 2012 Ver. 7 (30.11.2022)';
/** Receipt density at 15 °C within ± `tol` kg/m³ of the OMC invoice density (a hint). */
export const MDG_DENSITY_RULES: readonly FuRule<{ tol: number }>[] = [
  { from: '2022-11-30', value: { tol: 3.0 }, source: `${MDG}, receipt procedure (iv). Read (R21) (FU15)`, verified: true },
];

/** Every morning: opening density from the nozzle, meter readings, product and water dips. */
export const MDG_DAILY_RECORDS_RULES: readonly FuRule<{ density: true; meters: true; dips: true }>[] = [
  { from: '2022-11-30', value: { density: true, meters: true, dips: true }, source: `${MDG} cl. 1.3 (ii), 1.4.1 (b), (c). Read (R21) (FU16)`, verified: true },
];

/** Every nozzle tested daily with a 5-litre measure; the test quantity goes back to the tank and into the register. */
export const MDG_NOZZLE_TEST_RULES: readonly FuRule<{ litres: number }>[] = [
  { from: '2022-11-30', value: { litres: 5 }, source: `${MDG} cl. 1.4.2 (b), (d). Read (R21) (FU17)`, verified: true },
];

/** Normal variation 4 % of tank stock after evaporation / handling losses (% of quantity sold; lower beyond `avg_kl`). */
export const MDG_VARIATION_RULES: readonly FuRule<{ band_pct: number; ms: [number, number]; hsd: [number, number]; avg_kl: number }>[] = [
  { from: '2022-11-30', value: { band_pct: 4, ms: [0.75, 0.6], hsd: [0.25, 0.2], avg_kl: 600 }, source: `${MDG} cl. 5.1.11. Read (R21) (FU18)`, verified: true },
];

/** Sales / density registers, maintenance, purchase invoices and sales bills kept for the current and previous FY. */
export const MDG_RECORDS_RULES: readonly FuRule<{ years: 'current_and_previous_fy' }>[] = [
  { from: '2022-11-30', value: { years: 'current_and_previous_fy' }, source: `${MDG} cl. 5.1.12. Read (R21) (FU19)`, verified: true },
];

/** Legal Metrology re-verification of dispensing pumps (months; alert 30 days before). */
export const WM_REVERIFY_RULES: readonly FuRule<{ months: number; alert_days: number }>[] = [
  { from: '2011-04-01', value: { months: 12, alert_days: 30 }, source: 'Legal Metrology (General) Rules 2011, Rule 27 (S) (FU24)', verified: false },
];

/* ── R21-B ── */

/* ── R21-C ── */

/* ── R21-D ── */
