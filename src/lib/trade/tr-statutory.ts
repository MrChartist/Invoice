/**
 * TR-C2 trader statutory helpers over `src/lib/trading-rules.ts` (pure, tested in tests/tr-statutory.test.ts):
 *  - TCS presets for 206C(1) specified goods and 206C(1F) by the document date; a buyer's Form 27C / Form 127
 *    declaration suppresses the 206C(1) presets; a 206C(1F) preset warns unless a single line exceeds ₹10 lakh;
 *  - the 194Q buyer-turnover test (our turnover of the preceding FY, `tds_settings.turnover_by_fy`);
 *  - the RCM notified-goods prompt (HSN × supplier kind × date);
 *  - the composition-limit tracker (FY aggregate turnover against the limit in force).
 * Working papers — verify with your CA (TR13–TR17, TR20).
 */
import { ruleAt } from '../tax-rules';
import { getIndianFY } from '../invoice-number';
import {
  BUYER_194Q_TURNOVER_RULES, COMPOSITION_ALERT_RULES, COMPOSITION_GOODS_LIMIT_RULES, RCM_NOTIFIED_GOODS_RULES, TCS_1F_RULES, TCS_GOODS, TCS_GOODS_27EQ,
  TCS_GOODS_TEXT, TCS_NO_PAN_RULES, TCS_SPECIFIED_GOODS_RULES,
  type RcmGoodsRow, type SupplierKind, type Tcs1fKind, type TcsGoods,
} from '../trading-rules';

export interface TradeTcsPreset {
  /** Stored as the document's `tcs_label` (Form 27EQ maps it through `TCS_27EQ_CODES`). */
  label: string;
  rate: number;
  section: '206C1' | '206C1F';
  goods: TcsGoods | Tcs1fKind;
  code: string;
  verified: boolean;
  /** 206C(1F): applies only when one item's value exceeds this. */
  above?: number;
}

const pct = (n: number) => `${Math.round(n * 1000) / 1000}%`;

/** Trading TCS presets in force on `date`. `declaration`: the buyer gave Form 27C / 127 (no 206C(1) TCS). */
export function tradingTcsPresets(date: string, opts: { declaration?: boolean } = {}): TradeTcsPreset[] {
  const out: TradeTcsPreset[] = [];
  if (!opts.declaration) {
    const rows = ruleAt(TCS_SPECIFIED_GOODS_RULES, date);
    for (const g of TCS_GOODS) {
      const r = rows[g];
      out.push({ label: `206C(1) ${TCS_GOODS_TEXT[g]} ${pct(r.rate)}`, rate: r.rate, section: '206C1', goods: g, code: TCS_GOODS_27EQ[g], verified: r.verified });
    }
  }
  for (const k of ['motor_vehicle', 'luxury'] as const) {
    const r = ruleAt(TCS_1F_RULES[k], date);
    if (!r) continue;
    const what = k === 'motor_vehicle' ? 'motor vehicle' : 'notified luxury goods';
    out.push({ label: `206C(1F) ${what} above ₹10 lakh ${pct(r.rate)}`, rate: r.rate, section: '206C1F', goods: k, code: r.code, verified: r.verified, above: r.above });
  }
  return out;
}

/** The trading preset a stored `tcs_label` names (exact label of `tradingTcsPresets` on `date`), if any. */
export const presetOfLabel = (label: string | undefined, date: string): TradeTcsPreset | undefined =>
  tradingTcsPresets(date).find((p) => p.label === String(label ?? '').trim());

/** 206C(1F): '' when some line's value exceeds the limit, else the warning text. Other presets: ''. */
export function tcs1fWarning(preset: Pick<TradeTcsPreset, 'section' | 'above'> | undefined, lineValues: readonly number[]): string {
  if (!preset || preset.section !== '206C1F' || !preset.above) return '';
  return lineValues.some((v) => v > preset.above!) ? '' : 'TCS u/s 206C(1F) applies only when one item is valued above ₹10 lakh — no line on this bill is.';
}

/** 206CC (no PAN of the buyer): twice the rate or the floor, whichever is higher. */
export function tcsNoPanRate(rate: number, date: string): number {
  const r = ruleAt(TCS_NO_PAN_RULES, date);
  return Math.max(rate * r.multiple, r.floor);
}

/* ── 194Q: buyer-turnover test ── */

export type Buyer194qStatus = 'not_in_force' | 'applies' | 'below' | 'unknown';

/** The preceding FY's label (`25-26` for a date in FY 26-27): the key of `tds_settings.turnover_by_fy`. */
export const precedingFy = (date: string): string => getIndianFY(`${getIndianFY(date).startYear - 1}-06-01`).label;

/**
 * Does 194Q bind US as the buyer on `date`? Our turnover of the preceding FY above ₹10 crore → applies; entered and
 * at most ₹10 crore → below (a 194Q deduction is refused); not entered → unknown (allowed with a warning, §8 Q12).
 */
export function buyer194q(date: string, turnoverByFy?: Readonly<Record<string, number>>): { status: Buyer194qStatus; limit: number | null; fy: string; turnover?: number; message: string } {
  const limit = ruleAt(BUYER_194Q_TURNOVER_RULES, date);
  const fy = precedingFy(date);
  if (limit == null) return { status: 'not_in_force', limit, fy, message: '194Q was not in force on this date.' };
  const raw = turnoverByFy?.[fy];
  const t = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined;
  if (t === undefined) return { status: 'unknown', limit, fy, message: `Our turnover for FY ${fy} is not entered (TDS → Overview): 194Q is allowed, but it binds only a buyer above ₹10 crore — verify with your CA.` };
  if (t > limit) return { status: 'applies', limit, fy, turnover: t, message: '' };
  return { status: 'below', limit, fy, turnover: t, message: `194Q does not apply: our turnover for FY ${fy} is not above ₹10 crore (the buyer's test) — verify with your CA.` };
}

/** Sales side: a customer that deducts 194Q does so on our FY sales to it above the 194Q threshold. */
export function customer194qDue(fySales: number, threshold: number): boolean {
  return threshold > 0 && fySales > threshold;
}

/* ── RCM on notified goods ── */

/**
 * The supplier kinds a vendor counts as (no GSTIN = unregistered; a farmer = agriculturist; QA8 T14: a maker of silk
 * yarn only when the vendor is flagged `rcm_maker`, never every vendor).
 */
export function supplierKinds(v: { gstin?: string; principal_kind?: string; rcm_maker?: boolean } | undefined): SupplierKind[] {
  if (!v) return [];
  const kinds: SupplierKind[] = v.rcm_maker ? ['maker'] : [];
  if (v.principal_kind === 'agriculturist') kinds.push('agriculturist');
  if (v.principal_kind === 'unregistered' || (v.principal_kind !== 'registered' && !String(v.gstin ?? '').trim())) kinds.push('unregistered');
  return kinds;
}

/** Notified-goods rows matched by the lines' HSN and the supplier kind on `date` (each row once). */
export function rcmGoodsMatches(lines: readonly { hsn?: string; name?: string; description?: string }[], kinds: readonly SupplierKind[], date: string): RcmGoodsRow[] {
  const rows = ruleAt(RCM_NOTIFIED_GOODS_RULES, date);
  const out: RcmGoodsRow[] = [];
  for (const row of rows) {
    if (!row.from.some((k) => kinds.includes(k))) continue;
    // A line's HSN within the entry, or a 4+ digit heading that contains it (1404 for 14049010) — for an entry with
    // `words` (cashew in 0801, which also holds coconuts and Brazil nuts) only when the line names the goods.
    if (lines.some((l) => {
      const h = String(l.hsn ?? '').replace(/\D/g, '');
      const text = `${l.name ?? ''} ${l.description ?? ''}`.toLowerCase();
      return h.length >= 4 && row.hsn.some((p) => h.startsWith(p) || (p.startsWith(h) && (!row.words || row.words.some((w) => text.includes(w)))));
    })) out.push(row);
  }
  return out;
}

/* ── Composition tracker ── */

export type TrackerLevel = 'ok' | 'amber' | 'red';

/** FY aggregate turnover so far against the composition limit in force (goods; special-category States lower). */
export function compositionTracker(turnover: number, date: string, specialState = false): { limit: number; share: number; level: TrackerLevel; optOutDays: number } {
  const lim = ruleAt(COMPOSITION_GOODS_LIMIT_RULES, date);
  const limit = specialState ? lim.goodsSpecial : lim.goods;
  const a = ruleAt(COMPOSITION_ALERT_RULES, date);
  const share = limit > 0 ? turnover / limit : 0;
  return { limit, share, level: share >= 1 ? 'red' : share >= a.amberAt ? 'amber' : 'ok', optOutDays: a.optOutDays };
}

/**
 * States with the lower composition limit for goods (N 14/2019-CT: Arunachal Pradesh, Manipur, Meghalaya, Mizoram,
 * Nagaland, Sikkim, Tripura, Uttarakhand — as understood, TR20), by GST state code.
 */
export const SPECIAL_CATEGORY_STATES: ReadonlySet<string> = new Set(['12', '14', '17', '15', '13', '11', '16', '05']);
