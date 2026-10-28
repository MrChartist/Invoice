/**
 * R18-B2 GST of a unit's bill (pure; family `f-society`): the ₹7,500 test per unit (Circular 109 Q4), never per client.
 * Counted = every head but statutory pass-through dues and non-member income (CBIC flyer, HS3); the limit × the cycle's
 * months (HS5). Regimes: `unregistered` (plain bill, no tax), `agency` (18 %), `exempt77c` (Bill of Supply),
 * `taxable_whole` (18 % on the whole amount, Circular 109 Q5 — the default) or `taxable_excess` (a setting, HS2), and
 * `outsider` (non-member income, its own document). Statutory dues are pure-agent lines on every regime (HS6). The
 * printed sentence is snapshotted on the bill (`hs.decl`). Working papers — verify with your CA (HS1–HS8, HS14, HS16).
 */
import { round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { RWA_LIMIT_RULES, RWA_VALUATION_RULES, SOCIETY_GST_RATE_RULES } from '../society-rules';
import type { DocumentType } from '../../types/invoice';
import type { HsHeadRow, HsSnapshot, SocietyKind } from '../../types/society-r18';

export type HsRegime = NonNullable<HsSnapshot['regime']>;

/** Counted towards the limit: all but statutory dues and non-member income (HS3). */
export const isCounted = (r: Pick<HsHeadRow, 'kind'>) => r.kind !== 'statutory' && r.kind !== 'outsider';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const DECL: Partial<Record<HsRegime, (l: string) => string>> = {
  unregistered: () => 'The society is not registered under GST.',
  exempt77c: (l) => `Exempt — contribution by a member for the common use of members up to ${l} a month (N 12/2017-CT(R) Sl. 77(c)). Statutory dues collected for the authority are outside GST. Verify with your CA.`,
  taxable_whole: (l) => `Monthly contribution exceeds ${l}: GST on the whole amount (Circular 109/28/2019-GST). Verify with your CA.`,
  taxable_excess: (l) => `GST on the amount above ${l} a month (Madras High Court, 2021 — under appeal). Verify with your CA.`,
};

export interface RegimeIn {
  date: string;
  months: number;
  rows: readonly HsHeadRow[];
  registered: boolean;
  kind?: SocietyKind;
  /** `society_settings.gst.valuation`; absent = the dated rule (`whole`). */
  valuation?: 'whole' | 'excess';
  /** A document of non-member income only. */
  outsider?: boolean;
}

export interface RegimeOut { regime: HsRegime; doc: DocumentType; counted: number; limit: number; months: number; rate: number; decl: string }

/** The regime of one unit's document on its bill date (pure). */
export function hsRegime(i: RegimeIn): RegimeOut {
  const counted = round2(i.rows.filter(isCounted).reduce((t, r) => t + r.amount, 0));
  const limit = ruleAt(RWA_LIMIT_RULES, i.date), months = Math.max(1, i.months || 1);
  const regime: HsRegime = !i.registered ? 'unregistered' : i.outsider ? 'outsider' : i.kind === 'agency' ? 'agency' : counted <= round2(limit * months) ? 'exempt77c'
    : (i.valuation ?? ruleAt(RWA_VALUATION_RULES, i.date)) === 'excess' ? 'taxable_excess' : 'taxable_whole';
  return { regime, doc: regime === 'unregistered' ? 'INVOICE' : regime === 'exempt77c' ? 'BILL_OF_SUPPLY' : 'TAX_INVOICE', counted, limit, months, rate: ruleAt(SOCIETY_GST_RATE_RULES, i.date), decl: DECL[regime]?.(inr(limit)) ?? '' };
}

/** One document line: from a head row (or the excess regime's exempt portion), its GST rate, pass-through or exempt. */
export interface HsLine { row?: HsHeadRow; name: string; amount: number; tax: number; pass?: true; exempt?: true }

/**
 * The lines of a regime (pure): statutory rows pass through (no tax, outside the value); the others are taxed at the
 * rate (agency, whole, outsider) or not (exempt, unregistered). `taxable_excess`: one exempt line for limit × months and
 * each counted head's share of the rest, taxed (paise residue on the last).
 */
export function regimeLines(rows: readonly HsHeadRow[], r: RegimeOut): HsLine[] {
  const mine = rows.filter((x) => x.kind !== 'statutory');
  const tax = r.regime === 'exempt77c' || r.regime === 'unregistered' ? 0 : r.rate;
  let out: HsLine[] = mine.map((row) => ({ row, name: row.name, amount: row.amount, tax }));
  if (r.regime === 'taxable_excess') {
    const cap = round2(r.limit * r.months), rest = round2(r.counted - cap);
    let left = rest;
    out = [{ name: `Exempt contribution (Sl. 77(c), ${inr(r.limit)} × ${r.months})`, amount: cap, tax: 0, exempt: true }, ...mine.map((row, k) => {
      const a = k === mine.length - 1 ? left : round2((row.amount * rest) / r.counted);
      left = round2(left - a);
      return { row, name: `${row.name} (above the limit)`, amount: a, tax: r.rate };
    }).filter((l) => l.amount > 0)];
  }
  return [...out, ...rows.filter((x) => x.kind === 'statutory').map((row): HsLine => ({ row, name: row.name, amount: row.amount, tax: 0, pass: true }))];
}
