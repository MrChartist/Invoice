/**
 * Trader statutory values (Round 8, TR-C2), keyed by the date they take effect — the same `Versioned` / `ruleAt` shape
 * as `tax-rules.ts`: add a new dated row, never edit an old one. Imported only by lazy screens (editor tax panel, bill
 * modal notice, TDS / GST screens) — never by `tax-rules.ts` or the shell (`tests/tr-statutory.test.ts` checks the
 * import graph). Values already in `tax-rules.ts` / `tds-rules.ts` / `ita2025.ts` (194Q rate and ₹50 lakh threshold,
 * composition limits, Act 2025 labels) are reused from there, not repeated.
 *
 * Every row carries a `source`; rows not confirmed from an official text say "unverified". Working papers — verify
 * with your CA (docs/CA_REVIEW.md TR13–TR17, TR20).
 */
import type { Versioned } from './tax-rules';

/* ── 206C(1) → Sec 394(1) Table Sl. 1–5: TCS on specified goods ── */

export type TcsGoods = 'liquor' | 'tendu' | 'timber_lease' | 'timber_other' | 'forest' | 'scrap' | 'minerals';
export const TCS_GOODS: readonly TcsGoods[] = ['liquor', 'tendu', 'timber_lease', 'timber_other', 'forest', 'scrap', 'minerals'];

/** Words used in the preset label (the stored `tcs_label`, which Form 27EQ maps through `TCS_27EQ_CODES`). */
export const TCS_GOODS_TEXT: Readonly<Record<TcsGoods, string>> = {
  liquor: 'alcoholic liquor',
  tendu: 'tendu leaves',
  timber_lease: 'timber (forest lease)',
  timber_other: 'timber (other mode)',
  forest: 'other forest produce',
  scrap: 'scrap',
  minerals: 'coal / lignite / iron ore',
};

export interface TcsGoodsRow {
  rate: number;
  /** False where sources conflict or the text was not seen (TR14). */
  verified: boolean;
}

const goods = (r: Record<TcsGoods, number>, unverified: readonly TcsGoods[] = []): Record<TcsGoods, TcsGoodsRow> =>
  Object.fromEntries(TCS_GOODS.map((g) => [g, { rate: r[g], verified: !unverified.includes(g) }])) as Record<TcsGoods, TcsGoodsRow>;

const BASE_1961 = { liquor: 1, tendu: 5, timber_lease: 2.5, timber_other: 2.5, forest: 2.5, scrap: 1, minerals: 1 };

export const TCS_SPECIFIED_GOODS_RULES: readonly Versioned<Record<TcsGoods, TcsGoodsRow>>[] = [
  { from: '2017-07-01', value: goods(BASE_1961), source: 'Sec 206C(1) Table (Income-tax Act 1961)' },
  {
    from: '2020-05-14',
    value: goods({ liquor: 0.75, tendu: 3.75, timber_lease: 1.875, timber_other: 1.875, forest: 1.875, scrap: 0.75, minerals: 0.75 }),
    source: 'Press release 13 May 2020: 25% lower TCS rates 14 May 2020 – 31 Mar 2021',
  },
  { from: '2021-04-01', value: goods(BASE_1961), source: 'Sec 206C(1) Table (relief ended 31 Mar 2021)' },
  {
    from: '2026-04-01',
    value: goods({ liquor: 2, tendu: 2, timber_lease: 2, timber_other: 2, forest: 2, scrap: 2, minerals: 2 }, ['timber_lease', 'timber_other', 'forest']),
    source: 'Income-tax Act 2025 Sec 394(1) Table Sl. 1–5 as amended by the Finance Act 2026 (tdsman; taxguru) — timber / forest produce unverified (TR14)',
  },
];

/** Form 27EQ collection codes per goods (TR14; the 2025-Act payment codes 1068–1074 are not modelled — unverified). */
export const TCS_GOODS_27EQ: Readonly<Record<TcsGoods, string>> = {
  liquor: '6CA', timber_lease: '6CB', timber_other: '6CC', forest: '6CD', scrap: '6CE', tendu: '6CI', minerals: '6CJ',
};

/* ── 206C(1F) → Sec 394(1) Table Sl. 6: motor vehicles and notified luxury goods above ₹10 lakh ── */

export type Tcs1fKind = 'motor_vehicle' | 'luxury';
export interface Tcs1fRow {
  rate: number;
  /** Value of the single item (motor vehicle / luxury good) above which TCS applies. */
  above: number;
  code: string;
  verified: boolean;
}
export const TCS_1F_RULES: Readonly<Record<Tcs1fKind, readonly Versioned<Tcs1fRow | null>[]>> = {
  motor_vehicle: [
    { from: '2016-06-01', value: { rate: 1, above: 1_000_000, code: '6CL', verified: true }, source: 'Sec 206C(1F), Finance Act 2016' },
  ],
  luxury: [
    { from: '2016-06-01', value: null, source: 'Not notified before 22 Apr 2025' },
    { from: '2025-04-22', value: { rate: 1, above: 1_000_000, code: '', verified: false }, source: 'Notification 36/2025 (taxmann, taxguru — secondary); 27EQ code not confirmed (TR15)' },
  ],
};
/** The notified luxury goods (N 36/2025) — printed as a hint. */
export const LUXURY_GOODS_TEXT = 'wrist watch, art piece, collectible, yacht / boat, helicopter, sunglasses, handbag / purse, shoes, sportswear, home theatre, racing horse';

/** 206CC (no PAN): twice the rate or 5%, whichever is higher (unverified row, TR16). */
export const TCS_NO_PAN_RULES: readonly Versioned<{ multiple: number; floor: number }>[] = [
  { from: '2017-07-01', value: { multiple: 2, floor: 5 }, source: 'Sec 206CC (developers\' reading) — unverified (TR16)' },
];

/* ── 194Q: the buyer's own turnover test ── */

export const BUYER_194Q_TURNOVER_RULES: readonly Versioned<number | null>[] = [
  { from: '2017-07-01', value: null, source: '194Q not in force before 1 Jul 2021' },
  { from: '2021-07-01', value: 100_000_000, source: 'Sec 194Q (Finance Act 2021): buyer\'s total sales / turnover above ₹10 crore in the preceding FY' },
  { from: '2026-04-01', value: 100_000_000, source: 'Act 2025 Sec 393(1) Table Sl. 8(ii) — turnover test repeated; Act 2025 text to confirm (TR13)' },
];

/* ── RCM on notified goods (Sec 9(3), N 4/2017-CT(R)) ── */

export type SupplierKind = 'agriculturist' | 'unregistered' | 'maker';
export interface RcmGoodsRow {
  /** HSN prefixes (digits). */
  hsn: readonly string[];
  goods: string;
  /** Supplier kinds the entry covers ('maker': silk yarn from any person who makes it — an explicit vendor flag). */
  from: readonly SupplierKind[];
  /**
   * QA8 T14: a line whose HSN is only a shorter heading of `hsn` (e.g. 0801 for 080131) matches only when its
   * description names the goods (one of these words, case-insensitive). Absent = the heading alone matches.
   */
  words?: readonly string[];
  notification: string;
  verified: boolean;
}
export const RCM_NOTIFIED_GOODS_RULES: readonly Versioned<readonly RcmGoodsRow[]>[] = [
  {
    from: '2017-07-01',
    value: [
      { hsn: ['080131'], goods: 'Cashew nuts, not shelled or peeled', from: ['agriculturist'], words: ['cashew', 'kaju', 'काजू'], notification: 'N 4/2017-CT(R) (0801 31: in shell — QA8 T14)', verified: true },
      { hsn: ['14049010'], goods: 'Bidi wrapper leaves (tendu)', from: ['agriculturist'], notification: 'N 4/2017-CT(R)', verified: true },
      { hsn: ['2401'], goods: 'Tobacco leaves', from: ['agriculturist'], notification: 'N 4/2017-CT(R)', verified: true },
      { hsn: ['5004', '5005', '5006'], goods: 'Silk yarn', from: ['maker', 'agriculturist', 'unregistered'], notification: 'N 4/2017-CT(R)', verified: true },
    ],
    source: 'N 4/2017-CT(R) (gstcouncil.gov.in)',
  },
  {
    from: '2017-11-15',
    value: [
      { hsn: ['080131'], goods: 'Cashew nuts, not shelled or peeled', from: ['agriculturist'], words: ['cashew', 'kaju', 'काजू'], notification: 'N 4/2017-CT(R) (0801 31: in shell — QA8 T14)', verified: true },
      { hsn: ['14049010'], goods: 'Bidi wrapper leaves (tendu)', from: ['agriculturist'], notification: 'N 4/2017-CT(R)', verified: true },
      { hsn: ['2401'], goods: 'Tobacco leaves', from: ['agriculturist'], notification: 'N 4/2017-CT(R)', verified: true },
      { hsn: ['5004', '5005', '5006'], goods: 'Silk yarn', from: ['maker', 'agriculturist', 'unregistered'], notification: 'N 4/2017-CT(R)', verified: true },
      { hsn: ['5201'], goods: 'Raw cotton', from: ['agriculturist'], notification: 'N 43/2017-CT(R)', verified: true },
      { hsn: ['3301'], goods: 'Specified essential / mint oils', from: ['unregistered', 'agriculturist'], notification: 'N 4/2017-CT(R) as amended (date unverified, TR17)', verified: false },
    ],
    source: 'N 43/2017-CT(R) (raw cotton from 15 Nov 2017; taxheal); mint-oil entry date unverified (TR17)',
  },
];

/* ── Composition tracker ── */

/**
 * Composition limits for goods (preceding-FY aggregate turnover, ₹; special-category States lower). The SAME rows as
 * `COMPOSITION_LIMIT_RULES` in `tax-rules.ts` (`tests/tr-statutory.test.ts` pins them equal): read here because that
 * export is not used by first paint, and importing it into a lazy screen would pull it into the first-paint chunk.
 */
export const COMPOSITION_GOODS_LIMIT_RULES: readonly Versioned<{ goods: number; goodsSpecial: number }>[] = [
  { from: '2017-07-01', value: { goods: 7.5e6, goodsSpecial: 5e6 }, source: 'Sec 10(1) as enacted' },
  { from: '2017-10-13', value: { goods: 1e7, goodsSpecial: 7.5e6 }, source: 'Notification 46/2017-CT' },
  { from: '2019-04-01', value: { goods: 1.5e7, goodsSpecial: 7.5e6 }, source: 'Notification 14/2019-CT' },
];

/* Thresholds of the tracker */

export const COMPOSITION_ALERT_RULES: readonly Versioned<{ amberAt: number; optOutDays: number }>[] = [
  { from: '2017-07-01', value: { amberAt: 0.8, optOutDays: 7 }, source: 'Rule 6(2): intimate within 7 days of crossing (developers\' reading, TR20); 80% amber is the app\'s own warning' },
];

