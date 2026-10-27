/**
 * Agriculture and food-processing statutory values and practice defaults (Round 12), keyed by the date they take effect
 * — the same `Versioned` / `ruleAt` shape as `tax-rules.ts`: add a new dated row, never edit an old one. Imported only
 * by lazy agri screens and engines — never by `tax-rules.ts`, `shop-mode.ts` or the shell (`tests/ag-rules.test.ts`
 * checks the import graph). Values that already live in `trading-rules.ts` (RCM notified goods, 194Q buyer test, TCS)
 * stay there; this file re-exports nothing from it.
 *
 * One section per package (§6 of docs/prd/round-12.md). Every row carries a `source` and `verified` (false where the
 * notification text was not read or sources conflict). Working papers — verify with your CA (docs/CA_REVIEW.md §12).
 */
import { ruleAt, type Versioned } from './tax-rules';
import type { AgClass } from '../types/agri-r12';

/** A dated agri rule row: `source` plus whether the value was confirmed from an official text. */
export type AgRule<T> = Versioned<T> & { verified: boolean };

/* ── AG-A: agri tax classes, Rule 6DD(e), the 25 kg pre-packaged line ─────────────────────────────────────────── */

/** What a class suggests on a date: GST rate (%) and HSN / SAC. */
export interface AgClassRate {
  rate: number;
  hsn: string;
}

const N2 = 'N 2/2017-CT(R) (nil goods) — recalled';
const N1 = 'N 1/2017-CT(R) schedules — recalled';
const PACK = 'N 6/2022-CT(R): pre-packaged and labelled ≤ 25 kg / 25 L at 5% from 18 Jul 2022 (FinMin FAQ, secondary — AG5)';
const SEP25 = 'GST rate rationalisation from 22 Sep 2025 (taxscan, PTI, Tally summaries; notification not read — AG4)';
const row = (from: string, rate: number, hsn: string, source: string, verified = false): AgRule<AgClassRate> => ({ from, value: { rate, hsn }, source, verified });
const nil = (hsn: string, source = N2) => [row('2017-07-01', 0, hsn, source)];
const flat = (hsn: string, rate: number, source = N1) => [row('2017-07-01', rate, hsn, source)];
const packed = (hsn: string) => [row('2017-07-01', 0, hsn, 'Unbranded: nil (N 2/2017-CT(R)) — recalled'), row('2022-07-18', 5, hsn, PACK)];
const cut = (hsn: string, before: number, src = N1) => [row('2017-07-01', before, hsn, src), row('2025-09-22', 5, hsn, SEP25)];

/** Class → rate / HSN by document date (append-only per class; §2.3 / §2.3a of the PRD). */
export const AGRI_CLASS_RULES: Readonly<Record<AgClass, readonly AgRule<AgClassRate>[]>> = {
  milk_fresh: [row('2017-07-01', 0, '0401', 'N 2/2017-CT(R) S.No. 25 fresh / pasteurised milk (excl. UHT) — two secondary sources agree (AG3)', true)],
  milk_uht: [row('2017-07-01', 5, '0401', N1), row('2025-09-22', 0, '0401', `${SEP25}; UHT milk nil`)],
  curd_loose: nil('0403'),
  curd_packed: packed('0403'),
  paneer: [row('2017-07-01', 5, '0406', `${N1} (pre-packaged)`), row('2025-09-22', 0, '0406', `${SEP25}; paneer / chena nil`)],
  ghee_butter: cut('0405', 12, 'N 1/2017-CT(R) 12% (PTI, Taxscan; Tally shows 18% — AG4 conflict)'),
  cheese: cut('0406', 12),
  milk_powder: flat('0402', 5, 'N 1/2017-CT(R) — no 2025 change found in the summaries (AG3, L)'),
  cereal_loose: nil('1001'),
  cereal_packed_25: packed('1006'),
  paddy: nil('100610'),
  rice_husk: nil('1213', 'N 2/2017-CT(R); GST Council FAQ (2024 reissue) — husk nil'),
  rice_bran_feed: nil('2302', 'N 2/2017-CT(R) S.No. 102 (as cattle / poultry / aquatic feed); GST Council FAQ (AG6)'),
  rice_bran_other: flat('2302', 5, 'N 1/2017-CT(R): rice bran other than feed (GST Council FAQ, AG6)'),
  dorb: flat('2306', 5, 'De-oiled rice bran 5% irrespective of use (GST Council FAQ, AG6)'),
  broken_rice: nil('100640', 'Loose broken rice treated like loose cereals; one AAR held 5% under the pre-2022 "branded" regime (AG6, L)'),
  oil_cake_feed: nil('2306', 'N 2/2017-CT(R) S.No. 102 as amended 1 Jan 2023 — oil cake as cattle feed (AG6, L)'),
  oil_cake_other: flat('2306', 5, 'Oil cake other than feed (AG6, L)'),
  edible_oil: flat('1507', 5),
  pulses_loose: nil('0713'),
  pulses_packed_25: packed('0713'),
  flour_loose: nil('1101'),
  flour_packed_25: packed('1101'),
  veg_fruit_fresh: nil('0709'),
  potato: nil('0701'),
  seed_sowing: nil('1209', 'N 2/2017-CT(R) seeds for sowing — recalled'),
  fertiliser: flat('3105', 5, 'N 1/2017-CT(R) chapter 31 — no 2025 change reported (M)'),
  fert_input: [row('2017-07-01', 18, '2807', N1), row('2025-09-22', 5, '2807', `${SEP25}; sulphuric / nitric acid, ammonia`)],
  pesticide_chem: flat('3808', 18, 'N 1/2017-CT(R) 3808 — no 2025 change reported (M)'),
  biopesticide: cut('3808', 12),
  micronutrient: cut('3105', 12, 'N 1/2017-CT(R) micronutrients (FCO Sch. 1 Part A) 12%'),
  cattle_feed: nil('2309', 'N 2/2017-CT(R) S.No. 102 cattle / poultry / aquatic feed — recalled'),
  tractor: cut('8701', 12),
  farm_machine: cut('8433', 12),
  live_poultry: nil('0105', 'N 2/2017-CT(R) live animals — recalled (AG31)'),
  eggs: nil('0407', 'N 2/2017-CT(R) birds\' eggs in shell — recalled (AG31)'),
  fish_fresh: nil('0302', 'N 2/2017-CT(R) fresh fish — recalled (AG31)'),
  storage_agri: [row('2017-07-01', 0, '998619', 'N 12/2017-CT(R) entry 54(e): storage / warehousing of agricultural produce nil (AG8 ★ — chamber rent conflict)')],
  storage_other: flat('996721', 18, 'N 11/2017-CT(R) heading 9967: storage of other goods 18% (AG8)'),
  milling_pds: [row('2021-06-17', 0, '998817', 'Circular 153/09/2021-GST: milling for PDS exempt (entry 3A) when goods ≤ 25% of value, else 5% — the app shows the test (AG9)', true)],
  job_milling: flat('998817', 5, 'N 11/2017-CT(R) entry 26: job work on food products for a registered person 5% (AG10 for an unregistered farmer: verify)'),
  interest: nil('997113', 'N 12/2017-CT(R) entry 27: interest on loans nil — recalled (AG24)'),
};

/** The suggested rate / HSN of a class on a date (null for an unknown class). */
export const agClassAt = (cls: AgClass, date?: string): AgClassRate | null => (AGRI_CLASS_RULES[cls] ? ruleAt(AGRI_CLASS_RULES[cls], date) : null);

/** Rule 6DD(e): cash paid to the cultivator / grower / producer of agri produce is outside Sec 40A(3) (AG14 ★). */
export const RULE_6DDE_RULES: readonly AgRule<{ applies: boolean; label: string }>[] = [
  { from: '2017-04-01', value: { applies: true, label: 'Rule 6DD(e)' }, source: 'IT Rules 1962 Rule 6DD(e) (incometaxindia.gov.in); Mad HC 2025 reads "producer" narrowly (taxmann)', verified: true },
  { from: '2026-04-01', value: { applies: true, label: 'Rule 6DD(e) (2025-Act rule not confirmed)' }, source: 'Income-tax Act 2025 equivalent of Sec 40A(3) / Rule 6DD not read — verify (AG14)', verified: false },
];

/** The pre-packaged and labelled line for cereals / pulses / flour (kg or L in one package). */
export const PACKED_25KG_RULES: readonly AgRule<number>[] = [
  { from: '2022-07-18', value: 25, source: 'N 6/2022-CT(R) + FinMin FAQ (2022): ≤ 25 kg / 25 L pre-packaged and labelled; Legal Metrology (Packaged Commodities) Rules 2011 (AG5)', verified: false },
];

/* ── AG-B: dairy (filled by AG-B) ────────────────────────────────────────────────────────────────────────────── */
/** CLR defaults (cow 28, buffalo 30) and the fat-kg tolerance on dispatch (practice, not statute). */
export const MILK_DEFAULTS: readonly AgRule<{ clrCow: number; clrBuffalo: number; fatTolerancePct: number }>[] = [
  { from: '2017-07-01', value: { clrCow: 28, clrBuffalo: 30, fatTolerancePct: 0.5 }, source: 'Practice (union rate charts); not a statutory value', verified: false },
];

/* ── AG-C: mills — outturn standards, the Circular 153 test, job milling ─────────────────────────────────────────── */
/** CMR outturn kg per 100 kg paddy: raw 67, parboiled 68 (agency norm; CAG Report 31 of 2015). */
export const OUTTURN_STANDARDS: readonly AgRule<{ raw: number; parboiled: number }>[] = [
  { from: '2005-01-01', value: { raw: 67, parboiled: 68 }, source: 'Agency norm; CAG Report 31 of 2015 (norms unrevised since 2005) — AG agency terms win', verified: false },
];
/**
 * Own-mill outturn starters by mill kind (main + listed co-products per 100 of input; editable on each batch) and the
 * flag tolerance in points (C2-4). Practice, not statute — adjust.
 */
export const OWN_OUTTURN_STARTERS: readonly AgRule<{ rice: number; flour: number; dal: number; oil: number; tolerance_pts: number }>[] = [
  { from: '2005-01-01', value: { rice: 67, flour: 82, dal: 76, oil: 33, tolerance_pts: 1 }, source: 'Practice starters: rice = the CMR raw norm; roller-mill atta + maida + suji ~82%; dal + broken ~76%; mustard expeller oil ~33% — adjust (AG29, AG52)', verified: false },
];
/** Circular 153/09/2021: composite milling supply for PDS exempt when goods ≤ 25% of value. */
export const MILLING_PDS_RULES: readonly AgRule<{ goodsPct: number; exemptEntry: string; elseRate: number }>[] = [
  { from: '2021-06-17', value: { goodsPct: 25, exemptEntry: 'N 12/2017-CT(R) entry 3A', elseRate: 5 }, source: 'Circular 153/09/2021-GST (17 Jun 2021) — read (AG9)', verified: true },
];
/** Job milling for others: 5% for a registered principal (entry 26); unregistered — no rule found, typed rate (AG10). */
export const JOB_MILLING_RULES: readonly AgRule<{ registered: number; unregistered: number | null }>[] = [
  { from: '2017-07-01', value: { registered: 5, unregistered: null }, source: 'N 11/2017-CT(R) entry 26 ("food and food products", registered principal) — recalled; unregistered principal: none found (AG10)', verified: false },
];

/* ── AG-D: cold storage, input dealers, members (filled by AG-D) ─────────────────────────────────────────────── */
/** Storage class → SAC and GST rate (AG8). `storage_agri`: storage / warehousing of agricultural produce, nil (entry 54(e)). */
export interface StorageClassRule { sac: string; rate: number; spaceSac: string }
export const STORAGE_CLASS_RULES: Readonly<Record<'storage_agri' | 'storage_other', readonly AgRule<StorageClassRule>[]>> = {
  storage_agri: [{ from: '2017-07-01', value: { sac: '996721', rate: 0, spaceSac: '997212' }, source: 'N 12/2017-CT(R) entry 54(e): storage or warehousing of agricultural produce — nil (AP AAR SSSVK; AG8)', verified: false }],
  storage_other: [{ from: '2017-07-01', value: { sac: '996721', rate: 18, spaceSac: '997212' }, source: 'Storage of non-agricultural goods / renting a whole chamber (Gujarat AAR, 9972) — 18% (AG8)', verified: false }],
};
/** Words that mark a commodity as fresh agricultural produce (exempt storage) vs processed / non-agri goods (AG1, AG8 (d)). */
export const STORAGE_WORD_RULES: readonly AgRule<{ agri: readonly string[]; other: readonly string[] }>[] = [
  { from: '2017-07-01', value: { agri: ['potato', 'onion', 'garlic', 'apple', 'fruit', 'vegetable', 'grain', 'paddy', 'wheat', 'maize', 'pulse', 'chana', 'gram', 'seed', 'chilli', 'turmeric', 'carrot', 'peas', 'orange', 'kinnow', 'grape', 'banana', 'mango', 'आलू', 'प्याज़', 'प्याज', 'सेब', 'धान', 'गेहूं'], other: ['frozen', 'processed', 'dry fruit', 'dried', 'medicine', 'chemical', 'ice cream', 'meat', 'fish', 'dairy', 'paneer', 'ghee', 'butter', 'pickle', 'pulp', 'juice'] }, source: 'Explanation to N 11/2017-CT(R) "agricultural produce" as read by the developers (AG1, AG8 (d)) — a suggestion only', verified: false },
];

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
