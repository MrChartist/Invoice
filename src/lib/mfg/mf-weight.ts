/**
 * MF-B2 shape calculator (pure): volume and weight of a plate / sheet (L × W × T), round bar (D × L), tube (OD, ID, L),
 * ring / flange (OD, ID, T) and an angle / channel by kg per metre, from a density in g / cc (practice values in
 * `mfg-rules.ts` `DENSITY_DEFAULTS`, editable). Gross = the blank, net = the finished part, scrap = gross − net.
 * Dimensions in mm, weights in kg to 3 decimals (tests/mf-weight.test.ts).
 */
import type { MfShape } from '../../types/mfg-r13';
import { ruleAt } from '../tax-rules';
import { DENSITY_DEFAULTS } from '../mfg-rules';
import { num } from '../invoice-calc';
import { r3 } from './mf-b-db';

/** Density list (g / cc) in force on a date. */
export const densities = (date?: string): Readonly<Record<string, number>> => ruleAt(DENSITY_DEFAULTS, date);

const ring = (od: number, id: number, len: number) => (Math.PI / 4) * (od * od - id * id) * len;

/** Volume of a shape in cc (mm³ ÷ 1000); a section (kg per metre) has none. */
export function shapeVolumeCc(s: MfShape): number {
  const v = (k: keyof MfShape) => Math.max(num(s[k] as number), 0);
  switch (s.kind) {
    case 'plate': return (v('l') * v('w') * v('t')) / 1000;
    case 'round': return ring(v('d'), 0, v('l')) / 1000;
    case 'tube': return ring(v('od'), Math.min(v('id'), v('od')), v('l')) / 1000;
    case 'ring': return ring(v('od'), Math.min(v('id'), v('od')), v('t')) / 1000;
    default: return 0;
  }
}

/** Weight of a shape in kg (density g / cc; a section: kg per metre × length). */
export function shapeKg(s: MfShape, density: number): number {
  if (s.kind === 'section') return r3(Math.max(num(s.kg_per_m), 0) * Math.max(num(s.l), 0) / 1000);
  return r3((shapeVolumeCc(s) * Math.max(num(density), 0)) / 1000);
}

export interface PartWeights { gross: number; net: number; scrap: number }

/** Gross (blank), net (finished shape or the typed net kg) and scrap kg = gross − net (never below 0). */
export function partWeights(blank: MfShape, density: number, finish?: MfShape, netKg?: number): PartWeights {
  const gross = shapeKg(blank, density);
  const raw = finish ? shapeKg(finish, density) : num(netKg) > 0 ? r3(num(netKg)) : gross;
  const net = Math.min(raw, gross);
  return { gross, net, scrap: r3(gross - net) };
}
