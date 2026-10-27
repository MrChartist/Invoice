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
  { from: '2017-07-01', value: BASE_2017, source: 'N 11/2017-CT(R) entry 3(ii), 3(iv), 3(vii), 3(ix), 3(x); N 12/2017-CT(R) entries 10A / 10B (pure labour); 998519 manpower 18% — as recalled', verified: false },
  { from: '2025-09-22', value: { ...BASE_2017, wc_govt: { rate: 18, sac: '9954' }, wc_govt_earthwork: { rate: 18, sac: '9954' }, wc_subcon_govt: { rate: 18, sac: '9954' } }, source: 'N 15/2025-CT(R) from 22 Sep 2025 — sources conflict on which 12% items moved to 18% (CN1), verify with your CA', verified: false },
];

/** Classes whose rate source conflicts (the picker shows "sources conflict — verify (CN1)"). */
export const CONFLICTING_CLASSES: readonly CnClass[] = ['wc_govt', 'wc_govt_earthwork', 'wc_subcon_govt'];

/** Plant / equipment hire SAC and TDS section by operator (CN17; used by CN-D3). */
export const PLANT_HIRE_SAC_RULES: readonly CnRule<{ withOperator: { sac: string; tds: string }; withoutOperator: { sac: string; tds: string }; rate: number }>[] = [
  { from: '2017-07-01', value: { withOperator: { sac: '997319', tds: '194C-2' }, withoutOperator: { sac: '997313', tds: '194I-A' }, rate: 18 }, source: 'SAC 9973 (leasing / rental of machinery); 194C with operator, 194-I(a) without — practice, verify (CN17)', verified: false },
];

/** Deviation limit per BOQ item, % over the BOQ quantity (contract term; §8 Q11). */
export const DEVIATION_DEFAULTS: readonly CnRule<{ pct: number }>[] = [
  { from: '2017-07-01', value: { pct: 25 }, source: 'Common PWD order of magnitude (contract term) — the agreement governs', verified: false },
];

/** Default contractor's certificate (editable in Settings → Features and per bill). */
export const DEFAULT_CERTIFICATE = 'Certified that the work has been executed as per specifications and the quantities are as measured and recorded in the measurement book; no previous claim has been made for this work.';

/* ── CN-B: contractor finance ─────────────────────────────────────────────────────────────────────────────────── */

/** Advances (§8 Q12 / Q13): contract practice, every value a contract term the agreement overrides. */
export const ADVANCE_DEFAULTS: readonly CnRule<{ mobilisation_pct: number; interest_pct: number; recover_from_pct: number; recover_by_pct: number; secured_pct: number; secured_alert_days: number }>[] = [
  { from: '2017-07-01', value: { mobilisation_pct: 10, interest_pct: 10, recover_from_pct: 10, recover_by_pct: 80, secured_pct: 75, secured_alert_days: 90 }, source: 'CPWD Works Manual practice (mobilisation advance 10% at 10% simple interest, recovered 10%→80% of work; secured advance 75% of materials at site) — contract practice, verify (CN7 / CN8)', verified: false },
];

/** Price variation (§8 Q14): M = 0.85 (profit and overheads 15%). The contract clause governs (CN6). */
export const ESCALATION_DEFAULTS: readonly CnRule<{ m_factor: number }>[] = [
  { from: '2017-07-01', value: { m_factor: 0.85 }, source: 'CPWD clause 10CC-type formula — contract practice, verify (CN6)', verified: false },
];

/**
 * Recoveries and alerts (§8 Q16 / Q18 / Q19 / Q34): water + electricity 1% + 1% of the value before GST; wastage band
 * ±3% with recovery of the excess at 2× the issue rate; withheld and guarantee alert horizons. Contract terms.
 */
export const RECOVERY_DEFAULTS: readonly CnRule<{ water_pct: number; power_pct: number; wastage_band_pct: number; penal_factor: number; withheld_alert_days: number; bg_alert_days: number }>[] = [
  { from: '2017-07-01', value: { water_pct: 1, power_pct: 1, wastage_band_pct: 3, penal_factor: 2, withheld_alert_days: 90, bg_alert_days: 30 }, source: 'Common PWD clauses (water / electricity, cement & steel variation) — contract terms, verify (CN9 / CN10 / CN11)', verified: false },
];

/* ── CN-C: builders (REALTY_RATE_RULES, REALTY_AFFORDABLE_RULES, REALTY_INTEREST_RULES, RERA_DEPOSIT_RULES,
 *    REALTY_PROCUREMENT_RULES) — filled by CN-C ── */

/* ── CN-D: site operations (WASTAGE_BAND_DEFAULTS, COEFFICIENT_STARTERS, LABOUR_WITHHOLD_DEFAULTS) — filled by CN-D ── */
