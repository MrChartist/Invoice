/**
 * R21-B1 pump shift maths (pure; the store is `fu-dayclose.ts`). Table `fuel_shifts` (`doc.create`, dated by `date`,
 * audited; one row per day × shift number). A shift
 * holds its attendants (with the nozzles each holds), one meter reading per nozzle and the collections (B2). The
 * opening totaliser is the previous closed shift's closing (an edit needs a reason, audited); litres sold = closing −
 * opening − test (the test litres go back to the tank and are never sales); a totaliser that passed its maximum wraps.
 * The value is litres × the price in force; a price change inside the shift splits the litres by the typed reading at
 * the change, else all go at the opening price (FU9). Moments are local "YYYY-MM-DD HH:MM". Working papers — verify
 * with your CA (FU9, FU17).
 */
import { localDayOf } from '../dates';
import { round2 } from '../invoice-calc';
import type { FuelNozzle, FuelPrice, FuelShift, FuReading } from '../../types/fuel-r21';
import { nozzleLabel, priceAt } from './fu-line';
import { fbT } from '../../i18n/areas/fuel-r21b';

export const METER_MAX = 1e7;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pad = (n: number) => String(n).padStart(2, '0');

/** A JS date as a local moment "YYYY-MM-DD HH:MM". */
export const momentOf = (d: Date): string => `${localDayOf(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Meter litres from `a` to `b` (a totaliser past its maximum wraps to 0; a wrap is accepted only within a tenth of the dial), or NaN. */
export function meterDiff(a: number, b: number, max = METER_MAX): number {
  if (b >= a) return r3(b - a);
  const w = b + max - a;
  return a <= max && w <= max / 10 ? r3(w) : NaN;
}

/** Why a closed reading cannot be used ('' = fine). */
export function readingIssue(r: FuReading, label = ''): string {
  if (r.closing === undefined || !Number.isFinite(r.closing)) return fbT('eClosing', { n: label });
  const m = meterDiff(r.opening, r.closing, r.max);
  if (Number.isNaN(m)) return fbT('eBelow', { n: label });
  if (!(r.test_l >= 0) || m - r.test_l < -0.0005) return fbT('eNegative', { n: label });
  return '';
}

/** Litres sold on a reading (meter − test), 0 while it is not closed or not valid. */
export const soldLitres = (r: FuReading): number => (readingIssue(r) ? 0 : r3(meterDiff(r.opening, r.closing!, r.max) - r.test_l));

export interface FuSeg { price_id: string; rsp: number; litres: number }
export interface FuNozzleSale { nozzle_id: string; item_id: string; tank_id: string; litres: number; value: number; segs: FuSeg[] }

/** A reading's litres priced over the shift `from`–`to` (moments): one segment per price in force, split by the typed readings. */
export function priceReading(r: FuReading, itemId: string, prices: readonly FuelPrice[], from: string, to: string, label = ''): FuSeg[] {
  const [d, t] = from.split(' ');
  const base = priceAt(prices, itemId, d, t);
  if (!base) throw new Error(fbT('eNoPrice', { n: label, at: from }));
  const litres = soldLitres(r);
  const changes = prices.filter((p) => p.item_id === itemId && `${p.date} ${p.time}` > from && `${p.date} ${p.time}` <= to).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const splits = (r.splits ?? []).slice(0, changes.length);
  if (!splits.length) return [{ price_id: base.id, rsp: base.rsp, litres }];
  const marks = [r.opening, ...splits, r.closing!];
  const segs = [base, ...changes.slice(0, splits.length)].map((p, i) => ({ price_id: p.id, rsp: p.rsp, litres: meterDiff(marks[i], marks[i + 1], r.max) - (i ? 0 : r.test_l) }));
  if (segs.some((s) => !(s.litres >= -0.0005))) throw new Error(fbT('eSplit', { n: label }));
  return segs.map((s) => ({ ...s, litres: r3(Math.max(0, s.litres)) }));
}

/** Every closed reading of the shift priced (refused with the reason when a reading or a price is missing). */
export function shiftSales(s: FuelShift, nozzles: readonly FuelNozzle[], prices: readonly FuelPrice[], tanks: readonly { id: string; fu?: { product_item_id: string } }[] = []): FuNozzleSale[] {
  const to = s.closed_at ?? momentOf(new Date());
  return s.readings.map((r) => {
    const n = nozzles.find((x) => x.id === r.nozzle_id);
    const label = n ? nozzleLabel(n) : r.nozzle_id;
    const bad = readingIssue(r, label);
    if (bad) throw new Error(bad);
    const item = n?.item_id ?? tanks.find((t) => t.id === n?.tank_id)?.fu?.product_item_id ?? '';
    const segs = priceReading(r, item, prices, s.opened_at, to, label);
    return { nozzle_id: r.nozzle_id, item_id: item, tank_id: n?.tank_id ?? '', litres: soldLitres(r), value: round2(segs.reduce((v, g) => v + g.litres * g.rsp, 0)), segs };
  });
}

/** The opening a nozzle carries into shift (`date`, `no`): the latest earlier closed shift's closing, else the nozzle's start. */
export function carriedOpening(n: Pick<FuelNozzle, 'id' | 'totaliser_start'>, shifts: readonly FuelShift[], date: string, no: number): number {
  const key = (s: Pick<FuelShift, 'date' | 'shift_no'>) => `${s.date}#${String(s.shift_no).padStart(2, '0')}`;
  const here = key({ date, shift_no: no });
  let best: { k: string; v: number } | null = null;
  for (const s of shifts) {
    const r = s.status !== 'open' && key(s) < here ? s.readings.find((x) => x.nozzle_id === n.id && x.closing !== undefined) : undefined;
    if (r && (!best || key(s) > best.k)) best = { k: key(s), v: r.closing! };
  }
  return best ? best.v : n.totaliser_start;
}
