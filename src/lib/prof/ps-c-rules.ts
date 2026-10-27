/**
 * Round 14 PS-C statutory values (export of services, FEMA 2026, registration threshold), keyed by effective date and
 * append-only like `tax-rules.ts`. Lazy only: imported by the export-of-services desk and engines, never by the shell.
 * Every row is a working-paper value until a CA answers its PS item — verify with your CA.
 */
import { ruleAt, type Versioned } from '../tax-rules';

/** Row with the "verified" flag every Round 14 rule carries (PRD §6). */
export type PsRule<T> = Versioned<T> & { verified: boolean };

/**
 * Place of supply of intermediary services (PS4). `supplier`: Sec 13(8)(b) IGST — location of the supplier, so never an
 * export. `recipient`: Sec 13(8)(b) omitted by Sec 157 of the Finance Act 2026 (assent 30 Mar 2026) — Sec 13(2), an
 * export when Sec 2(6) is met. Read by the export check and the R8 indent note (TR21), by invoice date.
 */
export const INTERMEDIARY_POS_RULES: readonly PsRule<'supplier' | 'recipient'>[] = [
  { from: '2017-07-01', value: 'supplier', source: 'Sec 13(8)(b) IGST Act', verified: true },
  { from: '2026-03-30', value: 'recipient', source: 'Sec 157 Finance Act 2026 (Sec 13(8)(b) omitted) — verify the date (PS4)', verified: false },
];
export const intermediaryPos = (date?: string) => ruleAt(INTERMEDIARY_POS_RULES, date);

/** EDF for services (PS16): `null` before the 2026 regulations (SOFTEX; rows are history only). */
export interface EdfRule {
  /** Days after the end of the invoice month. */
  days: number;
  /** Services other than software may file on or before the date of receipt (Reg 3(2)(b)). */
  byReceipt: boolean;
  /** Invoices up to this value (₹) may be closed on the exporter's declaration (Reg 4(2)). */
  smallValue: number;
}
export const EDF_RULES: readonly PsRule<EdfRule | null>[] = [
  { from: '2000-01-01', value: null, source: 'SOFTEX (FEMA 23(R)/2015-RB) — history only', verified: true },
  { from: '2026-10-01', value: { days: 30, byReceipt: true, smallValue: 1000000 }, source: 'FEMA 23(R)/2026-RB Reg 3(2), 4(2) — verify (PS16)', verified: false },
];
export const edfRule = (date?: string) => ruleAt(EDF_RULES, date);

/** Aggregate-turnover threshold for a services supplier (PS13); exports count. */
export interface ThresholdRule {
  limit: number;
  /** Lower limit and the States it applies to (two-digit GST codes). */
  special: number;
  specialStates: readonly string[];
  /** Warn at this % of the limit. */
  warnPct: number;
}
export const REGISTRATION_THRESHOLD_RULES: readonly PsRule<ThresholdRule>[] = [
  {
    from: '2017-07-01',
    value: { limit: 2000000, special: 1000000, specialStates: ['13', '14', '15', '16'], warnPct: 80 },
    source: 'Sec 22 CGST Act (₹20 lakh; ₹10 lakh in Nagaland, Manipur, Mizoram, Tripura); N 10/2017-IT — verify (PS13)',
    verified: false,
  },
];
export const thresholdRule = (date?: string) => ruleAt(REGISTRATION_THRESHOLD_RULES, date);

/** RBI purpose codes for services — an editable example list, not a rule (PS39). Default by `prof_kind`. */
export const PURPOSE_CODE_EXAMPLES: readonly (readonly [code: string, label: string])[] = [
  ['P0802', 'Software consultancy / implementation'],
  ['P0803', 'Data processing'],
  ['P0807', 'Off-site software exports'],
  ['P1004', 'Legal services'],
  ['P1005', 'Accounting, auditing, book-keeping'],
  ['P1006', 'Business and management consultancy'],
  ['P1007', 'Advertising, trade fair'],
  ['P1009', 'Architectural services'],
  ['P1019', 'Engineering services'],
];
export const PURPOSE_BY_KIND: Readonly<Record<string, string>> = {
  ca: 'P1005', legal: 'P1004', design: 'P1009', consulting: 'P1006', agency: 'P1007', freelancer: 'P0802', other: 'P1006',
};
