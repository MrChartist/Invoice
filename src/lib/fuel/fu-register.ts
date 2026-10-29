/**
 * R21-C3 daily stock register per tank (pure; MDG cl. 1.3 / 5.1.11). Per day: opening dip litres + receipts (invoice
 * litres of the day's receipt rows) − (meter litres − test litres of the tank's nozzles in that day's shifts) = book;
 * the next morning's dip (else a later dip the same day) = physical; variation = physical − book, % of sales;
 * month-to-date and year-to-date (from 1 April) cumulative. The MDG band (2022 text, FU18) is a hint with the numbers:
 * evaporation allowance = rate % × litres sold this month (MS 0.75 / 0.60 %, HSD 0.25 / 0.20 % beyond 600 KL a year),
 * plus 4 % of tank stock. The register is meter-based by design (FU7). C4 (bell cut at the C cap): `dueList` = licences,
 * W&M stamping per nozzle and tank calibration with the days left, flagged within `WM_REVERIFY_RULES.alert_days`
 * (FU24, FU25). Working papers — verify with your CA.
 */
import { shiftDay } from '../dates';
import { fuAt, MDG_VARIATION_RULES, WM_REVERIFY_RULES } from '../fuel-rules';
import type { FuelNozzle, FuelShift, FuelTankLog, FuLicence, FuProduct, FuTank } from '../../types/fuel-r21';
import { soldLitres } from './fu-shift';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Meter litres sold (net of test, B's `soldLitres`: a wrapped totaliser adds its maximum) and test litres of `nozzles` on `day`. */
export function meterSales(shifts: readonly FuelShift[], nozzles: ReadonlySet<string>, day: string): { sales: number; test: number } {
  let sales = 0;
  let test = 0;
  for (const s of shifts) {
    if (s.date !== day) continue;
    for (const r of s.readings) {
      if (!nozzles.has(r.nozzle_id) || r.closing == null) continue;
      sales += soldLitres(r);
      test += r.test_l || 0;
    }
  }
  return { sales: r3(sales), test: r3(test) };
}

export interface RegRow { day: string; opening: number | null; receipts: number; sales: number; test: number; book: number | null; physical: number | null; variation: number | null; pct: number | null; mtd: number; ytd: number; mtdSales: number; ytdSales: number }

const dips = (logs: readonly FuelTankLog[], day: string) => logs.filter((l) => l.kind === 'dip' && l.date === day && l.litres != null).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
/** 1 April of the financial year of `day`. */
export const fyStartOf = (day: string): string => `${Number(day.slice(0, 4)) - (Number(day.slice(5, 7)) < 4 ? 1 : 0)}-04-01`;

/** The register of one tank from 1 April of `to`'s financial year to `to` (logs of that tank; its nozzles' ids). */
export function registerRows(tankId: string, nozzles: ReadonlySet<string>, logs: readonly FuelTankLog[], shifts: readonly FuelShift[], to: string): RegRow[] {
  const mine = logs.filter((l) => l.tank_id === tankId);
  const out: RegRow[] = [];
  let mtd = 0, ytd = 0, mtdSales = 0, ytdSales = 0;
  for (let day = fyStartOf(to); day <= to; day = shiftDay(day, 1)) {
    if (day.endsWith('-01')) mtd = mtdSales = 0;
    const today = dips(mine, day);
    const next = dips(mine, shiftDay(day, 1))[0] ?? (today.length > 1 ? today[today.length - 1] : undefined);
    const receipts = r3(mine.filter((l) => l.kind === 'receipt' && l.date === day).reduce((s, l) => s + (l.compartments ?? []).reduce((t, c) => t + (Number(c.invoice_l) || 0), 0), 0));
    const { sales, test } = meterSales(shifts, nozzles, day);
    const opening = today[0]?.litres ?? null;
    const book = opening == null ? null : r3(opening + receipts - sales);
    const physical = next?.litres ?? null;
    const variation = book == null || physical == null ? null : r3(physical - book);
    mtd = r3(mtd + (variation ?? 0));
    ytd = r3(ytd + (variation ?? 0));
    mtdSales = r3(mtdSales + sales);
    ytdSales = r3(ytdSales + sales);
    if (opening != null || receipts || sales) out.push({ day, opening, receipts, sales, test, book, physical, variation, pct: variation != null && sales ? Math.round((variation / sales) * 10000) / 100 : null, mtd, ytd, mtdSales, ytdSales });
  }
  return out;
}

/** The MDG band for a month's variation (null for products without one): evaporation + 4 % of stock, and whether it is outside. */
export function mdgBand(product: FuProduct | undefined, row: Pick<RegRow, 'day' | 'physical' | 'mtd' | 'mtdSales' | 'ytdSales'>, annualKl?: number): { rate: number; evap: number; band: number; outside: boolean } | null {
  const rule = fuAt(MDG_VARIATION_RULES, row.day)?.value;
  const step = product?.startsWith('ms') ? rule?.ms : product?.startsWith('hsd') ? rule?.hsd : undefined;
  if (!rule || !step) return null;
  const days = (Date.UTC(+row.day.slice(0, 4), +row.day.slice(5, 7) - 1, +row.day.slice(8)) - Date.UTC(+fyStartOf(row.day).slice(0, 4), 3, 1)) / 864e5 + 1;
  const kl = annualKl ?? (row.ytdSales / 1000) * (365 / days);
  const rate = kl > rule.avg_kl ? step[1] : step[0];
  const evap = r3((row.mtdSales * rate) / 100);
  const band = r3(((row.physical ?? 0) * rule.band_pct) / 100);
  return { rate, evap, band, outside: Math.abs(row.mtd) > evap + band };
}

/** The last day of `month` (YYYY-MM) with a physical figure — what the month's loss / gain voucher counts. */
export const monthClose = (rows: readonly RegRow[], month: string): RegRow | undefined => rows.filter((r) => r.day.startsWith(month) && r.physical != null).at(-1);

const dayNo = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
export interface Due { k: 'lic' | 'wm' | 'cal'; name: string; till: string; left: number; soon: boolean; i?: number; kind?: FuLicence['kind'] }

/** Licences, nozzles' W&M stamping and tanks' calibration due dates, soonest first (`soon` = within the alert days or past). */
export function dueList(today: string, o: { licences: readonly FuLicence[]; nozzles: readonly FuelNozzle[]; tanks: readonly { name: string; fu?: FuTank }[] }): Due[] {
  const days = fuAt(WM_REVERIFY_RULES, today)?.value.alert_days ?? 30;
  const rows: Omit<Due, 'left' | 'soon'>[] = [...o.licences.map((l, i) => ({ k: 'lic' as const, name: l.ref, till: l.valid_to, i, kind: l.kind })), ...o.nozzles.filter((n) => n.active).map((n) => ({ k: 'wm' as const, name: `${n.du_no}-${n.nozzle_no}`, till: n.wm_due ?? '' })), ...o.tanks.map((t) => ({ k: 'cal' as const, name: t.name, till: t.fu?.calibration_due ?? '' }))];
  return rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.till)).map((r) => {
    const left = dayNo(r.till) - dayNo(today);
    return { ...r, left, soon: left <= days };
  }).sort((a, b) => a.left - b.left);
}
