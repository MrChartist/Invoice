/**
 * CN-C1 / C2 / C3 real-estate tax maths (pure): unit class (affordable test), class rate by date with land deemed
 * one-third, the completion-certificate cut-off (Sch III para 5(b)), the RERA Sec 13 10% warning and the 194-IA hint.
 * Rates live in `construction-rules.ts` (date-keyed). Working paper — verify with your CA (CN18, CN19, CN21, CN24, CN25).
 */
import type { RealtyClass, RealtyProject, RealtyUnit } from '../../types/construction-r11';
import { ruleAt } from '../tax-rules';
import { num, round2 } from '../invoice-calc';
import { sectionText } from '../ita2025';
import { REALTY_194IA_RULES, REALTY_AFFORDABLE_RULES, REALTY_RATE_RULES, RERA_DEPOSIT_RULES } from '../construction-rules';

/** Affordable: carpet ≤ 60 sq m (metro) / 90 sq m (other) AND value ≤ ₹45 lakh (both limits inclusive). */
export function isAffordable(carpetSqm: number, city: RealtyProject['city_class'], value: number, date?: string): boolean {
  const r = ruleAt(REALTY_AFFORDABLE_RULES, date);
  return num(carpetSqm) > 0 && num(carpetSqm) <= (city === 'metro' ? r.metroSqm : r.otherSqm) && num(value) <= r.maxValue;
}

/** Class of a unit when booked: old-option project → its typed rate; commercial / residential (affordable test). */
export function unitClass(unit: Pick<RealtyUnit, 'type' | 'carpet_sqm'>, project: Pick<RealtyProject, 'city_class' | 'gst_scheme'>, value: number, date?: string): RealtyClass {
  if (project.gst_scheme === 'old_option') return 'realty_old_option';
  if (unit.type === 'commercial') return 'realty_commercial';
  return isAffordable(unit.carpet_sqm, project.city_class, value, date) ? 'realty_affordable' : 'realty_residential';
}

export interface LandSplit {
  value: number;
  land: number;
  taxable: number;
  notif: number;
  effective: number;
}

/**
 * Land deemed one-third: taxable = two-thirds of the value at the notification rate (1.5% / 7.5%), i.e. 1% / 5% of the
 * full value. `old_option` uses the project's typed rate on the full value (with ITC, no land line).
 */
export function landSplit(value: number, cls: RealtyClass, date?: string, oldRate = 12): LandSplit {
  const v = round2(num(value));
  if (cls === 'realty_old_option') return { value: v, land: 0, taxable: v, notif: num(oldRate), effective: num(oldRate) };
  const r = ruleAt(REALTY_RATE_RULES, date);
  const c = r.classes[cls];
  const taxable = round2(v * (1 - r.land));
  return { value: v, land: round2(v - taxable), taxable, notif: c.notif, effective: c.effective };
}

/** GST on the split: notification rate on the taxable two-thirds, CGST / SGST halves (IGST when inter-State). */
export function splitTax(s: LandSplit, inter = false): { cgst: number; sgst: number; igst: number; total: number } {
  const total = round2((s.taxable * s.notif) / 100);
  const half = round2(total / 2);
  return inter ? { cgst: 0, sgst: 0, igst: total, total } : { cgst: half, sgst: round2(total - half), igst: 0, total };
}

/** On / after the completion certificate: not a supply (Sch III para 5(b)). */
export const afterCc = (project: Pick<RealtyProject, 'cc_date'> | undefined, date: string): boolean => !!project?.cc_date && date >= project.cc_date;

/** RERA Sec 13: received before the registered agreement above 10% of the agreement value (warn, never block). */
export function preAgreementWarning(received: number, agreementValue: number, registeredOn: string | undefined, date: string): boolean {
  if (registeredOn && registeredOn <= date) return false;
  return num(agreementValue) > 0 && num(received) > (num(agreementValue) * ruleAt(RERA_DEPOSIT_RULES, date).preAgreementPct) / 100 + 0.004;
}

/** 194-IA: consideration (or stamp value) ≥ ₹50 lakh → the buyer deducts 1%; the label follows the receipt date. */
export function tds194ia(agreementValue: number, stampValue: number | undefined, date: string): { applies: boolean; rate: number; section: string } {
  const r = ruleAt(REALTY_194IA_RULES, date);
  const s = sectionText('194IA', date);
  return { applies: Math.max(num(agreementValue), num(stampValue)) >= r.threshold, rate: r.rate, section: s === '194IA' ? '194-IA' : s };
}
