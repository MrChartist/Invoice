/**
 * MF-D1 food batch records and FSSAI (pack `foodmfg`):
 *  - a production order of a food item carries `mf.food: { batch_no, packed_on, shelf_life_days, best_before?, use_by? }`;
 *    its output batches get MFG date = packed date and expiry = packed + shelf life (`StockItem.shelf_life_days`, D2)
 *    unless typed (FSS Labelling and Display Regulations 2020 as summarised — MF14);
 *  - actual yield on an order vs the cost card's yield;
 *  - FSSAI: `SenderProfile.fssai_no` (14 digits) expected on food invoices when the pack is on — a soft warning, never a
 *    block (FSSAI order of 8 Jun 2021, from 1 Oct 2021; MF13); licence expiry from the R12 licence register (kind
 *    `fssai`), read only;
 *  - food class rate suggestions by date (`FOOD_CLASS_RULES`, unverified — MF6); a typed rate always wins.
 * Pure. Working paper — verify with your CA.
 */
import { shiftDay } from '../dates';
import { kgPerUnit } from './mf-costcards';
import { foodClassRate, type FoodClassRate } from './mf-d-rules';

export interface FoodBatch {
  batch_no?: string;
  packed_on?: string;
  shelf_life_days?: number;
  best_before?: string;
  use_by?: string;
  fssai_label?: string;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Best-before / expiry = packed date + shelf-life days ('' without both). */
export const bestBefore = (packedOn: string | undefined, days: unknown): string => (packedOn && n(days) > 0 ? shiftDay(packedOn, Math.round(n(days))) : '');

/** The food snapshot of an order (`ProductionOrder.mf.food`), if any. */
export const foodOf = (order: unknown): FoodBatch | undefined => (order as { mf?: { food?: FoodBatch } } | null | undefined)?.mf?.food;

/**
 * Output batch defaults for an order of `item` reported on `date`: the order's food batch number and packed date (else
 * the output date), and expiry from the typed best-before / use-by, else packed + shelf life (order, else item).
 */
export function foodOutputDefaults(order: unknown, item: object | undefined, date: string): { batch_no?: string; mfg_date?: string; expiry_date?: string } {
  const f = foodOf(order);
  const shelf = n(f?.shelf_life_days) || n((item as { shelf_life_days?: number } | undefined)?.shelf_life_days);
  if (!f && !(shelf > 0)) return {};
  const packed = f?.packed_on || date;
  const expiry = f?.use_by || f?.best_before || bestBefore(packed, shelf);
  return { ...(f?.batch_no ? { batch_no: f.batch_no } : {}), mfg_date: packed, ...(expiry ? { expiry_date: expiry } : {}) };
}

/**
 * Actual yield of an order: Σ finished kg reported ÷ Σ weight of the components consumed (weight / volume units only;
 * packing material and counted units are left out). Null when nothing was consumed.
 */
export function actualYield(
  outputs: readonly { qty: number; components: readonly { item_id: string; qty: number; unit_factor?: number }[] }[],
  unitOf: (itemId: string) => string | undefined,
  outputUnit: string | undefined,
): number | null {
  const outKg = kgPerUnit(outputUnit);
  if (outKg === undefined) return null;
  let made = 0;
  let used = 0;
  for (const v of outputs) {
    made += n(v.qty) * outKg;
    for (const c of v.components) {
      const kg = kgPerUnit(unitOf(c.item_id));
      if (kg !== undefined) used += n(c.qty) * (n(c.unit_factor) || 1) * kg;
    }
  }
  return used > 0 ? Math.round((made / used) * 10000) / 100 : null;
}

export const FSSAI_RE = /^\d{14}$/;

/** '' when well-formed or empty, else the message. */
export const validateFssai = (s: string | undefined): string => (!s?.trim() || FSSAI_RE.test(s.trim()) ? '' : 'FSSAI licence / registration number has 14 digits.');

/** Soft warning for a food invoice when the `foodmfg` pack is on and the sender has no FSSAI number (MF13). */
export function fssaiWarning(sender: { fssai_no?: string } | null | undefined, foodPackOn: boolean): string {
  if (!foodPackOn) return '';
  const no = sender?.fssai_no?.trim();
  if (!no) return 'Food invoices must show your FSSAI licence / registration number (FSSAI order, from 1 Oct 2021) — add it to the business profile.';
  return validateFssai(no);
}

/** FSSAI licences on the R12 licence register (`agri_settings.licences`, kind `fssai`) with days left — read only. */
export function fssaiLicences(licences: readonly { kind: string; number: string; valid_to?: string }[] | undefined, today: string): { number: string; valid_to?: string; days: number | null; expired: boolean; soon: boolean }[] {
  return (licences ?? []).filter((l) => l.kind === 'fssai' && l.number?.trim()).map((l) => {
    const days = l.valid_to ? Math.round((Date.UTC(+l.valid_to.slice(0, 4), +l.valid_to.slice(5, 7) - 1, +l.valid_to.slice(8, 10)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86400000) : null;
    return { number: l.number.trim(), valid_to: l.valid_to, days, expired: days !== null && days < 0, soon: days !== null && days >= 0 && days <= 60 };
  });
}

/** Class rate suggestion and the "rate differs" notice ('' when the typed rate matches or there is no class). */
export function foodRateNotice(cls: string | undefined, typedRate: number, date: string): { suggestion?: FoodClassRate; notice: string } {
  const suggestion = foodClassRate(cls, date);
  if (!suggestion || n(typedRate) === suggestion.rate) return { suggestion, notice: '' };
  return { suggestion, notice: `Rate differs from the class (${suggestion.rate}% on ${date}, HSN ${suggestion.hsn}) — verify MF6.` };
}
