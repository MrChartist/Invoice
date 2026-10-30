/**
 * AG-C4 packing / labelling rule and mill sales (pure). An item carries `ag_pack_kg` (one package's size, kg or litres)
 * and `ag_labelled`; for classes with a loose / packed pair the line takes the **packed** class when the pack is
 * pre-packaged and labelled and ≤ 25 kg / 25 L (`PACKED_25KG_RULES`, N 6/2022), else the **loose** one; a retail sale
 * from a larger bag at the counter is loose (FinMin FAQ). By-products whose class depends on the end use (rice bran,
 * oil cake) take the feed / other class from a one-line choice; the buyer's declaration is a typed note on the bill.
 *
 * The suggested rate comes from `AGRI_CLASS_RULES` by document date; a typed rate always wins (the class check in
 * `gst-guards.ts`, AG-A, shows "rate differs from the class" as a soft notice). e-Way bill: the existing prompt for
 * taxable lines above the threshold; an exempt-only bill shows "may not be needed — verify AG12" instead.
 * Working papers — verify with your CA (AG5, AG6, AG12).
 */
import type { AgClass } from '../../types/agri-r12';
import { ruleAt } from '../tax-rules';
import { num } from '../invoice-calc';
import { EWAY_THRESHOLD } from '../eway';
import { PACKED_25KG_RULES, agClassAt, type AgClassRate } from '../agri-rules';

/** Loose class → its pre-packaged and labelled (≤ 25 kg) pair. Broken rice packs like cereals (AG6, §8 Q13). */
export const PACKED_PAIR: Readonly<Partial<Record<AgClass, AgClass>>> = {
  cereal_loose: 'cereal_packed_25',
  pulses_loose: 'pulses_packed_25',
  flour_loose: 'flour_packed_25',
  curd_loose: 'curd_packed',
  broken_rice: 'cereal_packed_25',
};
/** End-use pairs: [as cattle / poultry / aquatic feed, otherwise]. */
export const END_USE_PAIR: Readonly<Partial<Record<AgClass, readonly [AgClass, AgClass]>>> = {
  rice_bran_feed: ['rice_bran_feed', 'rice_bran_other'],
  rice_bran_other: ['rice_bran_feed', 'rice_bran_other'],
  oil_cake_feed: ['oil_cake_feed', 'oil_cake_other'],
  oil_cake_other: ['oil_cake_feed', 'oil_cake_other'],
};

const LOOSE_OF: Readonly<Partial<Record<AgClass, AgClass>>> = { cereal_packed_25: 'cereal_loose', pulses_packed_25: 'pulses_loose', flour_packed_25: 'flour_loose', curd_packed: 'curd_loose' };

/** The loose class of a pair (a packed class maps back to its loose one; others unchanged). */
export const looseOf = (c: AgClass): AgClass => LOOSE_OF[c] ?? c;

export interface PackFacts {
  ag_class?: AgClass;
  ag_pack_kg?: number;
  ag_labelled?: boolean;
  unit?: string;
}

/** True when the pack is pre-packaged and labelled and within the limit (25 kg / 25 L — the same number). Exactly 25 is in. */
export function withinPackLimit(f: Pick<PackFacts, 'ag_pack_kg' | 'ag_labelled'>, date?: string): boolean {
  const max = ruleAt(PACKED_25KG_RULES, date);
  const size = num(f.ag_pack_kg);
  return !!f.ag_labelled && size > 0 && size <= max + 1e-9;
}

/**
 * The class a sale line takes: packed when labelled and ≤ 25 kg (and not a loose counter sale from a bigger bag),
 * loose otherwise; classes without a pair are returned as they are. `undefined` without a class.
 */
export function packClass(f: PackFacts, opts: { counterLoose?: boolean; date?: string } = {}): AgClass | undefined {
  if (!f.ag_class) return undefined;
  const loose = looseOf(f.ag_class);
  const packed = PACKED_PAIR[loose];
  if (!packed) return f.ag_class;
  return !opts.counterLoose && withinPackLimit(f, opts.date) ? packed : loose;
}

/** The class after the "end use" choice (bran / cake as feed or not); classes without the choice are unchanged. */
export function endUseClass(c: AgClass, asFeed: boolean): AgClass {
  const pair = END_USE_PAIR[c];
  return pair ? pair[asFeed ? 0 : 1] : c;
}
export const needsEndUse = (c: AgClass | undefined): boolean => !!c && !!END_USE_PAIR[c];

/** The class's suggested rate and HSN on `date` (undefined for a class the rules do not list). */
export const classRate = (c: AgClass | undefined, date?: string): AgClassRate | undefined => (c ? agClassAt(c, date) ?? undefined : undefined);

export interface LineSuggestion {
  ag_class: AgClass;
  rate: number;
  hsn: string;
  exempt: boolean;
  /** Editor note (the 25 kg rule) when the class has a pair. */
  note?: string;
}

/** The line's suggested class, rate and HSN, with the 25 kg note for paired classes. */
export function suggestLine(f: PackFacts, opts: { counterLoose?: boolean; asFeed?: boolean; date?: string } = {}): LineSuggestion | undefined {
  let c = packClass(f, opts);
  if (!c) return undefined;
  if (opts.asFeed !== undefined) c = endUseClass(c, opts.asFeed);
  const r = classRate(c, opts.date);
  if (!r) return undefined;
  const paired = !!PACKED_PAIR[looseOf(c)] || Object.values(PACKED_PAIR).includes(c);
  return {
    ag_class: c, rate: r.rate, hsn: r.hsn, exempt: r.rate === 0,
    ...(paired ? { note: `Pre-packaged and labelled ≤ ${ruleAt(PACKED_25KG_RULES, opts.date)} kg → 5% (N 6/2022); larger or loose → nil. Verify with your CA (AG5).` } : {}),
  };
}

export type EwayHint = { kind: 'prompt'; taxable: number } | { kind: 'exempt_note'; text: string } | { kind: 'none' };

export const EXEMPT_EWAY_NOTE = 'e-Way bill may not be needed for exempt goods: verify with your CA (AG12).';

/**
 * e-Way bill hint by line mix: exempt-only goods → the "may not be needed" note; taxable goods worth more than the
 * threshold → the existing prompt (value of the taxable lines); else nothing.
 */
export function ewayHint(lines: readonly { taxable: number; tax_rate: number; service?: boolean }[]): EwayHint {
  const goods = lines.filter((l) => !l.service && num(l.taxable) > 0);
  if (!goods.length) return { kind: 'none' };
  const taxable = goods.filter((l) => num(l.tax_rate) > 0).reduce((s, l) => s + num(l.taxable), 0);
  if (taxable === 0) return { kind: 'exempt_note', text: EXEMPT_EWAY_NOTE };
  return taxable > EWAY_THRESHOLD ? { kind: 'prompt', taxable: Math.round(taxable * 100) / 100 } : { kind: 'none' };
}

/**
 * PENDING 10: the editor's lines → `ewayHint` (the invoice editor's agri e-Way hint, `components/agri/AgEwayHint.tsx`).
 * An SAC 99… line or a Service item is a service (no e-Way bill); the line values are the editor's computed taxable.
 */
export function editorEwayHint(lines: readonly { id: string; hsn?: string; taxable: number; tax_rate: number }[], items: readonly { id: string; type?: string }[]): EwayHint {
  const service = new Set(items.filter((i) => i.type === 'Service').map((i) => i.id));
  return ewayHint(lines.map((l) => ({ taxable: l.taxable, tax_rate: l.tax_rate, service: service.has(l.id) || /^99/.test(String(l.hsn ?? '').trim()) })));
}
