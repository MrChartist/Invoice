/**
 * CN-A4: the abstract's sections A–D and their sub-totals — pure and import-light, because the paper chunk prints
 * them (the calculator that builds the rows is `cn-abstract.ts`).
 */
import type { CnAbstractRow, CnLineKind } from '../../types/construction-r11';
import { round2 } from '../invoice-calc';

export const SECTION_ORDER: readonly CnLineKind[] = ['boq', 'extra', 'substituted', 'deviation'];
export const SECTION_TITLE: Readonly<Record<CnLineKind, string>> = {
  boq: 'A. BOQ items',
  extra: 'B. Extra items',
  substituted: 'C. Substituted items',
  deviation: 'D. Deviation quantities (beyond the deviation limit)',
};

export interface AbstractSection {
  kind: CnLineKind;
  title: string;
  rows: CnAbstractRow[];
  prev: number;
  this: number;
  cum: number;
}

/** Rows grouped into sections A–D with sub-totals (empty sections dropped). */
export function abstractSections(rows: readonly CnAbstractRow[]): AbstractSection[] {
  return SECTION_ORDER.map((kind) => {
    const r = rows.filter((x) => x.kind === kind);
    return { kind, title: SECTION_TITLE[kind], rows: r, prev: round2(r.reduce((s, x) => s + x.prev_amount, 0)), this: round2(r.reduce((s, x) => s + x.this_amount, 0)), cum: round2(r.reduce((s, x) => s + x.cum_amount, 0)) };
  }).filter((s) => s.rows.length > 0);
}

/** Grand totals of the abstract. */
export function abstractGrand(rows: readonly CnAbstractRow[]): { prev: number; this: number; cum: number } {
  return rows.reduce((s, r) => ({ prev: round2(s.prev + r.prev_amount), this: round2(s.this + r.this_amount), cum: round2(s.cum + r.cum_amount) }), { prev: 0, this: 0, cum: 0 });
}
