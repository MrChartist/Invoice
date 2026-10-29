/**
 * Construction statutory values and contract-practice defaults (Round 11), keyed by the date they take effect — the
 * same `Versioned` / `ruleAt` shape as `tax-rules.ts`: add a new dated row, never edit an old one. Imported only by
 * lazy screens and engines — never by `tax-rules.ts`, `shop-mode.ts` or the shell (`tests/cn-rules.test.ts` checks the
 * import graph). Values that already live in `transport-works-rules.ts` (GST TDS u/s 51, labour cess, the R5
 * works-contract rate) stay there; this file re-exports nothing from it.
 *
 * One section per package (§6 of docs/prd/round-11.md): CN-A committed the headers and types; each package fills its
 * own section. Every row carries a `source` and `verified` (false where the text was not seen or sources conflict).
 * Working papers — verify with your CA (docs/CA_REVIEW.md §11, CN1–CN28).
 */
import type { Versioned } from './tax-rules';
import type { CnClass } from '../types/construction-r11';

/** A dated construction rule row: `source` (inherited) plus whether the value was confirmed from an official text. */
export type CnRule<T> = Versioned<T> & { verified: boolean };

/* ── CN-A: works-contract classes, plant hire SAC, bill defaults ─────────────────────────────────────────────────── */

/** What a class suggests: GST rate (%) and SAC. `rate: null` = the line's own HSN rate (supply of goods). */
export interface WorksClassRate {
  rate: number | null;
  sac: string;
  /** Exempt supply (pure labour, CN2). */
  exempt?: boolean;
}

type WorksClassTable = Readonly<Partial<Record<CnClass, WorksClassRate>>>;

const BASE_2017: WorksClassTable = {
  wc_general: { rate: 18, sac: '9954' },
  wc_govt: { rate: 12, sac: '9954' },
  wc_govt_earthwork: { rate: 5, sac: '9954' },
  wc_subcon_govt: { rate: 12, sac: '9954' },
  pure_labour_exempt: { rate: 0, sac: '9954', exempt: true },
  supply_goods: { rate: null, sac: '' },
  install_service: { rate: 18, sac: '9987' },
  manpower: { rate: 18, sac: '998519' },
};

/**
 * Class → rate / SAC by document date. CN1 (sources conflict): the 22 Sep 2025 row moves government works, earthwork
 * and their sub-contracts to 18% — the default the app already used (`WORKS_CONTRACT_RATE_RULES`); `verified: false`.
 */
export const WORKS_CLASS_RULES: readonly CnRule<WorksClassTable>[] = [
  { from: '2017-07-01', value: BASE_2017, source: 'N 11/2017-CT(R) entry 3(ii), 3(iv), 3(vii), 3(ix), 3(x); N 12/2017-CT(R) entries 10A / 10B (pure labour); 998519 manpower 18%: as recalled', verified: false },
  { from: '2025-09-22', value: { ...BASE_2017, wc_govt: { rate: 18, sac: '9954' }, wc_govt_earthwork: { rate: 18, sac: '9954' }, wc_subcon_govt: { rate: 18, sac: '9954' } }, source: 'N 15/2025-CT(R) from 22 Sep 2025: sources conflict on which 12% items moved to 18% (CN1), verify with your CA', verified: false },
];

/** Classes whose rate source conflicts (the picker shows "sources conflict — verify (CN1)"). */
export const CONFLICTING_CLASSES: readonly CnClass[] = ['wc_govt', 'wc_govt_earthwork', 'wc_subcon_govt'];

/** Plant / equipment hire SAC and TDS section by operator (CN17; used by CN-D3). */
export const PLANT_HIRE_SAC_RULES: readonly CnRule<{ withOperator: { sac: string; tds: string }; withoutOperator: { sac: string; tds: string }; rate: number }>[] = [
  { from: '2017-07-01', value: { withOperator: { sac: '997319', tds: '194C-2' }, withoutOperator: { sac: '997313', tds: '194I-A' }, rate: 18 }, source: 'SAC 9973 (leasing / rental of machinery); 194C with operator, 194-I(a) without: practice, verify (CN17)', verified: false },
];

/** Deviation limit per BOQ item, % over the BOQ quantity (contract term; §8 Q11). */
export const DEVIATION_DEFAULTS: readonly CnRule<{ pct: number }>[] = [
  { from: '2017-07-01', value: { pct: 25 }, source: 'Common PWD order of magnitude (contract term): the agreement governs', verified: false },
];

/** Default contractor's certificate (editable in Settings → Features and per bill). */
export const DEFAULT_CERTIFICATE = 'Certified that the work has been executed as per specifications and the quantities are as measured and recorded in the measurement book; no previous claim has been made for this work.';

/* ── CN-B: contractor finance ─────────────────────────────────────────────────────────────────────────────────── */

/** Advances (§8 Q12 / Q13): contract practice, every value a contract term the agreement overrides. */
export const ADVANCE_DEFAULTS: readonly CnRule<{ mobilisation_pct: number; interest_pct: number; recover_from_pct: number; recover_by_pct: number; secured_pct: number; secured_alert_days: number }>[] = [
  { from: '2017-07-01', value: { mobilisation_pct: 10, interest_pct: 10, recover_from_pct: 10, recover_by_pct: 80, secured_pct: 75, secured_alert_days: 90 }, source: 'CPWD Works Manual practice (mobilisation advance 10% at 10% simple interest, recovered 10%→80% of work; secured advance 75% of materials at site): contract practice, verify (CN7 / CN8)', verified: false },
];

/** Price variation (§8 Q14): M = 0.85 (profit and overheads 15%). The contract clause governs (CN6). */
export const ESCALATION_DEFAULTS: readonly CnRule<{ m_factor: number }>[] = [
  { from: '2017-07-01', value: { m_factor: 0.85 }, source: 'CPWD clause 10CC-type formula: contract practice, verify (CN6)', verified: false },
];

/**
 * Recoveries and alerts (§8 Q16 / Q18 / Q19 / Q34): water + electricity 1% + 1% of the value before GST; wastage band
 * ±3% with recovery of the excess at 2× the issue rate; withheld and guarantee alert horizons. Contract terms.
 */
export const RECOVERY_DEFAULTS: readonly CnRule<{ water_pct: number; power_pct: number; wastage_band_pct: number; penal_factor: number; withheld_alert_days: number; bg_alert_days: number }>[] = [
  { from: '2017-07-01', value: { water_pct: 1, power_pct: 1, wastage_band_pct: 3, penal_factor: 2, withheld_alert_days: 90, bg_alert_days: 30 }, source: 'Common PWD clauses (water / electricity, cement & steel variation): contract terms, verify (CN9 / CN10 / CN11)', verified: false },
];

/* ── CN-C: builders (REALTY_RATE_RULES, REALTY_AFFORDABLE_RULES, REALTY_INTEREST_RULES, RERA_DEPOSIT_RULES,
 *    REALTY_PROCUREMENT_RULES) ── */

/** One real-estate class: notification rate (on the value less deemed land), effective rate on the full value, ITC. */
export interface RealtyRate {
  notif: number;
  effective: number;
  itc: boolean;
}

/** Real-estate classes by document date: rate on two-thirds (land deemed one-third, `land`) = the effective rate. */
export const REALTY_RATE_RULES: readonly CnRule<{ land: number; sac: string; classes: Record<'realty_affordable' | 'realty_residential' | 'realty_commercial', RealtyRate> }>[] = [
  { from: '2017-07-01', value: { land: 1 / 3, sac: '9954', classes: { realty_affordable: { notif: 12, effective: 8, itc: true }, realty_residential: { notif: 18, effective: 12, itc: true }, realty_commercial: { notif: 18, effective: 12, itc: true } } }, source: 'N 11/2017-CT(R) entry 3(i) and para 2 (land deemed one-third); affordable 12% from 25 Jan 2018 (N 1/2018): as recalled, verify (CN18)', verified: false },
  { from: '2019-04-01', value: { land: 1 / 3, sac: '9954', classes: { realty_affordable: { notif: 1.5, effective: 1, itc: false }, realty_residential: { notif: 7.5, effective: 5, itc: false }, realty_commercial: { notif: 7.5, effective: 5, itc: false } } }, source: 'N 03/2019-CT(R) amending N 11/2017-CT(R) entries 3(i)(ia)(ib)/(ic): 0.75% / 3.75% CGST without ITC; para 2 land one-third; commercial in an RREP, verify (CN18)', verified: false },
];

/** Affordable residential apartment: carpet ≤ 60 sq m (metro) / 90 sq m (other) AND value ≤ ₹45 lakh. */
export const REALTY_AFFORDABLE_RULES: readonly CnRule<{ maxValue: number; metroSqm: number; otherSqm: number; metros: string }>[] = [
  { from: '2019-04-01', value: { maxValue: 4500000, metroSqm: 60, otherSqm: 90, metros: 'Bengaluru, Chennai, Delhi NCR, Hyderabad, Kolkata, Mumbai (MMR)' }, source: 'N 03/2019-CT(R) explanation (affordable residential apartment): verify (CN19)', verified: false },
];

/** Interest on delayed payment by allottees, % a year (state RERA rule: SBI MCLR + 2% — set yours in settings). */
export const REALTY_INTEREST_RULES: readonly CnRule<{ rate: number }>[] = [
  { from: '2017-07-01', value: { rate: 10.85 }, source: 'State RERA rules: SBI highest MCLR + 2% (8.85% + 2% assumed), state RERA rule, set yours (CN23)', verified: false },
];

/** RERA Sec 4(2)(l)(D) share to deposit; Sec 13 cap before a registered agreement. */
export const RERA_DEPOSIT_RULES: readonly CnRule<{ pct: number; preAgreementPct: number }>[] = [
  { from: '2016-05-01', value: { pct: 70, preAgreementPct: 10 }, source: 'RERA 2016 Sec 4(2)(l)(D) (70%) and Sec 13 (10% before agreement): verify (CN25)', verified: false },
];

/** Income-tax TDS by the buyer on immovable property (194-IA / ITA 2025 Sec 393(1) Table 3(i)). */
export const REALTY_194IA_RULES: readonly CnRule<{ threshold: number; rate: number }>[] = [
  { from: '2013-06-01', value: { threshold: 5000000, rate: 1 }, source: 'Sec 194-IA (₹50 lakh, 1%); ITA 2025 Sec 393(1) Table Sl. 3(i) from 1 Apr 2026 (CN24)', verified: false },
];

/** 80% registered procurement test (promoters at 1% / 5%): RCM on the shortfall; excluded inputs; cement's own rate. */
export const REALTY_PROCUREMENT_RULES: readonly CnRule<{ pct: number; rcmRate: number; cementHsn: string; cementRate: number; excludeHsn: string[]; excludeWords: string[] }>[] = [
  { from: '2019-04-01', value: { pct: 80, rcmRate: 18, cementHsn: '2523', cementRate: 28, excludeHsn: ['2710', '2711', '2716'], excludeWords: ['tdr', 'fsi', 'development right', 'lease premium', 'electricity', 'diesel', 'petrol', 'motor spirit', 'natural gas', 'capital goods'] }, source: 'N 03/2019-CT(R) / N 07/2019-CT(R) (RCM on shortfall at 18%, cement at its rate): exclusions as understood, verify (CN20)', verified: false },
  { from: '2025-09-22', value: { pct: 80, rcmRate: 18, cementHsn: '2523', cementRate: 18, excludeHsn: ['2710', '2711', '2716'], excludeWords: ['tdr', 'fsi', 'development right', 'lease premium', 'electricity', 'diesel', 'petrol', 'motor spirit', 'natural gas', 'capital goods'] }, source: 'Cement 28% → 18% from 22 Sep 2025 (N 9/2025-CT(R)): verify (CN20, CN28)', verified: false },
];

/* ── CN-D: site operations (WASTAGE_BAND_DEFAULTS, COEFFICIENT_STARTERS, LABOUR_WITHHOLD_DEFAULTS) ── */

/** Permissible variation of actual vs theoretical consumption (−lo% / +hi%) and the penal factor on the issue rate. */
export const WASTAGE_BAND_DEFAULTS: readonly CnRule<{ lo: number; hi: number; penal: number }>[] = [
  { from: '2017-07-01', value: { lo: 3, hi: 3, penal: 2 }, source: 'CPWD-style contract practice (cement / steel ±3%, recovery at twice the issue rate): the agreement governs (CN29)', verified: false },
];

/** Starter coefficients (stock per unit of work) — typical figures, not statutory: set yours per BOQ line. */
export const COEFFICIENT_STARTERS: readonly CnRule<readonly { work: string; unit: string; material: string; qty: number }[]>[] = [
  {
    from: '2017-07-01',
    value: [
      { work: 'PCC 1:2:4', unit: 'cum', material: 'Cement (bags)', qty: 6.34 },
      { work: 'RCC M20 (1:1.5:3)', unit: 'cum', material: 'Cement (bags)', qty: 8.06 },
      { work: 'RCC M20: reinforcement', unit: 'cum', material: 'Steel (kg)', qty: 80 },
      { work: 'Brickwork CM 1:6', unit: 'cum', material: 'Cement (bags)', qty: 1.25 },
      { work: 'Plaster 12 mm CM 1:6', unit: 'sqm', material: 'Cement (bags)', qty: 0.03 },
    ],
    source: 'Typical: set yours (common CPWD-analysis orders of magnitude; non-statutory)',
    verified: false,
  },
];

/** Hold on a labour contractor's bill until the month's PF / ESI challans are shown (% of the bill, or PF + ESI if more). */
export const LABOUR_WITHHOLD_DEFAULTS: readonly CnRule<{ pct: number }>[] = [
  { from: '2017-07-01', value: { pct: 10 }, source: 'Contract practice under the Labour Codes (principal employer liability): a warning, never a block (CN15)', verified: false },
];
