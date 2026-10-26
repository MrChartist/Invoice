/**
 * R4-C statutory values for the trade desk (export realisation, customs duty), keyed by effective date like
 * `tax-rules.ts`. They live in this sibling file (the `gst-penalties.ts` / `payroll-rules.ts` pattern) because
 * `tax-rules.ts` is part of the first-paint bundle and the trade desk is not. Append new versions at the end of a
 * list — never edit an old one. Every value is an UNVERIFIED working-paper value: verify with your CA.
 */
import { ruleAt, type Versioned } from '../tax-rules';

/**
 * FEMA period for realising export proceeds, in months from the date of export (shipment), keyed by the
 * SHIPMENT date. 9 months (FEMA 23(R) as amended; RBI Master Direction — Export of Goods and Services), 15 months
 * for exports made from the RBI amendment of November 2025. The exact notification date / number is an open point.
 */
export const EXPORT_REALISATION_MONTHS_RULES: readonly Versioned<number>[] = [
  { from: '2013-04-01', value: 9, source: 'RBI Master Direction — Export of Goods and Services (9 months) — verify' },
  { from: '2025-11-13', value: 15, source: 'RBI FEMA (Export of Goods & Services) amendment, Nov 2025 (15 months) — verify the date' },
];
export const exportRealisationMonths = (shipDate?: string): number => ruleAt(EXPORT_REALISATION_MONTHS_RULES, shipDate);

/** Social Welfare Surcharge, % of basic customs duty (Finance Act 2018, from 2 Feb 2018). Per-tariff exemptions are typed per line. */
export const CUSTOMS_SWS_PCT_RULES: readonly Versioned<number>[] = [
  { from: '2000-01-01', value: 0 },
  { from: '2018-02-02', value: 10, source: 'Sec 110, Finance Act 2018 — verify exemptions per tariff line' },
];
export const customsSwsPct = (date?: string): number => ruleAt(CUSTOMS_SWS_PCT_RULES, date);

/** Landing charge added to CIF for the assessable value (old Rule 10(2) proviso: 1%; omitted from late 2017). */
export const CUSTOMS_LANDING_CHARGE_PCT_RULES: readonly Versioned<number>[] = [
  { from: '2000-01-01', value: 1, source: 'Customs Valuation Rules 2007, Rule 10(2) — verify' },
  { from: '2017-09-26', value: 0, source: 'Notification 91/2017-Customs (N.T.) as understood — verify the date' },
];
export const customsLandingChargePct = (date?: string): number => ruleAt(CUSTOMS_LANDING_CHARGE_PCT_RULES, date);

/**
 * Base of the import IGST: assessable value + BCD + SWS + other customs duties (anti-dumping / safeguard),
 * compensation cess NOT included (Sec 3(8)/(9) Customs Tariff Act as understood). Duties are rounded to the rupee
 * (Sec 154A). Both are flags so a later change of law is one appended row.
 */
export interface CustomsIgstBase {
  /** Other customs duties (anti-dumping, safeguard) are in the IGST / cess base. */
  includeOther: boolean;
  /** Each duty is rounded to the nearest rupee. */
  roundRupee: boolean;
}
export const CUSTOMS_IGST_BASE_RULES: readonly Versioned<CustomsIgstBase>[] = [
  { from: '2017-07-01', value: { includeOther: true, roundRupee: true }, source: 'Sec 3(8), (9) Customs Tariff Act; Sec 154A Customs Act — verify' },
];
export const customsIgstBase = (date?: string): CustomsIgstBase => ruleAt(CUSTOMS_IGST_BASE_RULES, date);

/** Bin retention (R4-C4): default and allowed range in days. Not statutory; kept here with the other R4-C values. */
export const BIN_RETENTION = { days: 30, min: 7, max: 90, maxBytes: 5 * 1024 * 1024 } as const;

/** Sec 128(5) Companies Act: books (and the edit log) kept for 8 financial years. */
export const AUDIT_RETENTION_FYS = 8;
