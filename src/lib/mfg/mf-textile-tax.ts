/**
 * MF-C5 textile tax classes (`mfg-rules.ts` `TEXTILE_CLASS_RULES`, date-keyed, all `verified: false` until MF1 / MF2 /
 * MF3 / MF5 are answered): MMF fibre 18 → 5% and MMF yarn 12 → 5% from 22 Sep 2025; cotton yarn and fabric 5%; garments
 * and made-ups by the R9 price band per piece (`rt-bands.ts`, imported read-only — the editor marks a sale line for the
 * band when the item's `mf_class` is `garment` / `made_up`, even without the apparel pack); textile waste and job-work
 * classes. Suggestions only: a typed rate always wins; a differing rate shows a soft notice. Pure.
 */
import type { StockItem } from '../inventory';
import { num } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { bandAt, bandRate } from '../retail/rt-bands';
import { TEXTILE_CLASS_RULES, type TextileClass, type TextileClassId } from './mf-c-pending';
import { styleAxes } from './mf-styles';

export const TEXTILE_CLASSES = Object.keys(TEXTILE_CLASS_RULES) as TextileClassId[];
export const isTextileClass = (c: unknown): c is TextileClassId => typeof c === 'string' && (TEXTILE_CLASSES as string[]).includes(c);

/** The class row in force on `date` (with its source and `verified`). */
export function textileClassAt(cls: TextileClassId, date: string): TextileClass & { source: string; verified: boolean } {
  const rows = TEXTILE_CLASS_RULES[cls];
  let hit = rows[0];
  for (const r of rows) if (r.from <= date.slice(0, 10)) hit = r;
  return { ...hit.value, source: hit.source ?? '', verified: hit.verified };
}

/** Suggested rate: a flat class rate, or the band rate for the value per piece (`inclusive` = MRP pricing). */
export function classRate(cls: TextileClassId, date: string, perPiece = 0, inclusive = false): number {
  const c = ruleAt(TEXTILE_CLASS_RULES[cls], date);
  return c.band ? bandRate(c.band, perPiece, date, inclusive).rate : num(c.rate);
}

/** A "rate differs from the class" notice ('' when it matches or the item has no class). */
export function classNotice(cls: unknown, date: string, typed: number, perPiece = 0): string {
  if (!isTextileClass(cls)) return '';
  const want = classRate(cls, date, perPiece);
  const c = textileClassAt(cls, date);
  return num(typed) === want ? '' : `Rate ${num(typed)}% differs from the class ${cls} (${want}% on this date) — verify with your CA (${c.ca}).`;
}

/** C5-2 pricing memo: sizes of a style whose list price per piece falls in the higher band on `date`. */
export function bandMemo(parent: StockItem, all: readonly StockItem[], date: string): { limit: number; above: string[]; rate: number } {
  const b = bandAt('apparel', date);
  const { size } = styleAxes(parent);
  const kids = all.filter((i) => i.variant_of === parent.id);
  const above = [...new Set(kids.filter((k) => num(k.sale_rate ?? parent.sale_rate) > b.upTo).map((k) => k.variant_attrs?.[size] ?? k.name))];
  return { limit: b.upTo, above, rate: b.above };
}
