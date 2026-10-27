/**
 * Agriculture statutory values (Round 12), keyed by the date they take effect — the `Versioned` / `ruleAt` shape of
 * `tax-rules.ts`: add a new dated row, never edit an old one. Imported only by lazy screens and engines — never by
 * `tax-rules.ts`, `shop-mode.ts` or the shell. Every row carries a `source` and `verified`. Working papers — verify with
 * your CA (docs/CA_REVIEW.md AG1–AG32, AG60–AG69). One section per package; this minimum compatible version (written by
 * AG-D before AG-A landed) holds the AG-D section only. AG-A owns the file and the other sections.
 */
import type { Versioned } from './tax-rules';

export type AgRule<T> = Versioned<T> & { verified: boolean };

/* ── AG-D: cold storage, input dealers, FPO / co-operative ── */
/** Storage class → SAC and GST rate (AG8). `storage_agri`: storage / warehousing of agricultural produce, nil (entry 54(e)). */
export interface StorageClassRule { sac: string; rate: number; spaceSac: string }
export const STORAGE_CLASS_RULES: Readonly<Record<'storage_agri' | 'storage_other', readonly AgRule<StorageClassRule>[]>> = {
  storage_agri: [{ from: '2017-07-01', value: { sac: '996721', rate: 0, spaceSac: '997212' }, source: 'N 12/2017-CT(R) entry 54(e): storage or warehousing of agricultural produce — nil (AP AAR SSSVK; AG8)', verified: false }],
  storage_other: [{ from: '2017-07-01', value: { sac: '996721', rate: 18, spaceSac: '997212' }, source: 'Storage of non-agricultural goods / renting a whole chamber (Gujarat AAR, 9972) — 18% (AG8)', verified: false }],
};
/** Words that mark a commodity as fresh agricultural produce (exempt storage) vs processed / non-agri goods (AG1, AG8 (d)). */
export const AGRI_PRODUCE_WORDS = ['potato', 'onion', 'garlic', 'apple', 'fruit', 'vegetable', 'grain', 'paddy', 'wheat', 'maize', 'pulse', 'chana', 'gram', 'seed', 'chilli', 'turmeric', 'carrot', 'peas', 'orange', 'kinnow', 'grape', 'banana', 'mango', 'आलू', 'प्याज़', 'प्याज', 'सेब', 'धान', 'गेहूं'];
export const NON_AGRI_WORDS = ['frozen', 'processed', 'dry fruit', 'dried', 'medicine', 'chemical', 'ice cream', 'meat', 'fish', 'dairy', 'paneer', 'ghee', 'butter', 'pickle', 'pulp', 'juice'];

/** Subsidised fertiliser: bags per farmer per month before a warning (reported, AG22); sale at or below MRP. */
export const FERT_SUBSIDY_DEFAULTS: readonly AgRule<{ capBagsPerMonth: number }>[] = [
  { from: '2017-07-01', value: { capBagsPerMonth: 50 }, source: 'Reported practice: 50 bags per farmer per month (Lok Sabha reply Aug 2026, Krishi Jagran; AG22)', verified: false },
];

/** Licence kinds an item class needs, and whether an expired batch of the class is blocked (AG21). */
export const DEALER_CLASS_RULES: readonly AgRule<Readonly<Record<string, { licence: readonly string[]; expiry: 'block' | 'warn' }>>>[] = [
  {
    from: '1985-09-25',
    value: {
      fertiliser: { licence: ['fertiliser_retail', 'fertiliser_wholesale'], expiry: 'warn' },
      fert_input: { licence: ['fertiliser_retail', 'fertiliser_wholesale'], expiry: 'warn' },
      micronutrient: { licence: ['fertiliser_retail', 'fertiliser_wholesale'], expiry: 'warn' },
      seed_sowing: { licence: ['seed'], expiry: 'block' },
      pesticide_chem: { licence: ['insecticide'], expiry: 'block' },
      biopesticide: { licence: ['insecticide'], expiry: 'block' },
      cattle_feed: { licence: ['fssai'], expiry: 'warn' },
    },
    source: 'Fertiliser (Control) Order 1985; Seeds (Control) Order 1983; Insecticides Act 1968 / Rules 1971 (as recalled; AG21)',
    verified: false,
  },
];

/** Co-operative deduction (AG16): 80P (1961 Act) → Sec 149 (Income-tax Act 2025, tax year from 1 Apr 2026, as reported). */
export interface CoopDeductionRule { section: string; act: string; heads: readonly string[] }
const COOP_HEADS = ['marketing', 'inputs', 'milk', 'credit', 'other'] as const;
export const COOP_DEDUCTION_RULES: readonly AgRule<CoopDeductionRule>[] = [
  { from: '1967-04-01', value: { section: '80P(2)', act: 'Income-tax Act 1961', heads: COOP_HEADS }, source: 'Income-tax Act 1961 Sec 80P(2)(a)(i), (iii), (iv), (b) (incometaxindia 80P page; AG16)', verified: true },
  { from: '2026-04-01', value: { section: '149', act: 'Income-tax Act 2025', heads: COOP_HEADS }, source: 'Income-tax Act 2025 Sec 149 as reported (taxguru ITA 2025 co-op note) — section number to verify (AG16)', verified: false },
];

/** Producer company deduction 80PA (AG17), keyed by ASSESSMENT-YEAR start (AY 2019-20 → 2019-04-01). */
export interface ProducerCompanyRule { deductionPct: number; turnoverLimit: number; note: string }
export const PRODUCER_COMPANY_RULES: readonly AgRule<ProducerCompanyRule>[] = [
  { from: '1900-01-01', value: { deductionPct: 0, turnoverLimit: 0, note: 'No 80PA deduction before AY 2019-20.' }, source: 'Sec 80PA inserted by Finance Act 2018 (from AY 2019-20)', verified: true },
  { from: '2019-04-01', value: { deductionPct: 100, turnoverLimit: 1_000_000_000, note: '100% of eligible-business profits; total turnover below ₹100 crore; AY 2019-20 to AY 2024-25.' }, source: 'Income-tax Act 1961 Sec 80PA (taxguru, studycafe, taxheal; AG17)', verified: true },
  { from: '2025-04-01', value: { deductionPct: 0, turnoverLimit: 0, note: 'No deduction found after AY 2024-25 — verify (AG17).' }, source: 'No extension found; no section of the Income-tax Act 2025 carrying it (AG17)', verified: false },
];

/** Members' statutory calendar defaults (MM-DD after the FY end; reminders only — verify AG18 / AG19). */
export const MEMBERS_CALENDAR_RULES: readonly AgRule<{ producer: Readonly<Record<string, string>>; coop: Readonly<Record<string, string>> }>[] = [
  {
    from: '2021-02-11',
    value: {
      producer: { agm: '09-30', financials: '10-30', annualReturn: '11-29', internalAudit: '03-31', register: '04-30' },
      coop: { agm: '09-30', audit: '09-30', returns: '10-31' },
    },
    source: 'Companies Act 2013 Ch. XXIA (Sec 378ZE AGM within six months of the year end; AOC-4 30 days, MGT-7 60 days after the AGM; internal audit 378ZB) — as recalled (AG18); co-operatives typed per State Act (AG19)',
    verified: false,
  },
];
