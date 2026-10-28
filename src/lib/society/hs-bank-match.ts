/**
 * R18-C4 bank receipts matched by unit (pure; family `f-society`): the unit named in a credit's narration — `A-101`,
 * `A101`, `A/101`, `101A`, `FLAT 101 A` (a code without a wing letter only after FLAT / UNIT / SHOP) — when exactly one
 * unit matches, and whether the amount equals one of its open bills or its whole dues. The suggestion goes through the
 * existing bank-rules apply step (a receipt from the member); the user confirms. Working papers — verify with your CA.
 */
import type { SocietyUnit } from '../../types/society-r18';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The patterns of one unit code (`A-101` → wing A, number 101). */
function patterns(code: string): RegExp[] {
  const m = /^([A-Z]*)[\s\-/]*(\d+)[\s\-/]*([A-Z]*)$/.exec(code.toUpperCase().trim());
  if (!m) return [new RegExp(`(^|[^A-Z0-9])${esc(code.toUpperCase())}($|[^A-Z0-9])`)];
  const [, w, n, s] = m, b = '(^|[^A-Z0-9])', e = '($|[^A-Z0-9])', sep = '[\\s\\-/]*', wing = w || s;
  if (!wing) return [new RegExp(`(FLAT|FLT|UNIT|SHOP)${sep}(NO\\.?)?${sep}${n}${e}`)];
  return [new RegExp(`${b}${wing}${sep}${n}${e}`), new RegExp(`${b}${n}${sep}${wing}${e}`)];
}

/** The one unit a narration names, else undefined (none or more than one). */
export function matchUnitInNarration<U extends Pick<SocietyUnit, 'id' | 'code'>>(narration: string, units: readonly U[]): U | undefined {
  const t = ` ${String(narration ?? '').toUpperCase().slice(0, 500)} `;
  const hits = units.filter((u) => patterns(u.code).some((r) => r.test(t)));
  return hits.length === 1 ? hits[0] : undefined;
}

/** Does the amount equal an open bill or the whole dues (paise)? */
export const amountFits = (amount: number, open: readonly number[], dues: number): 'bill' | 'dues' | '' =>
  open.some((o) => Math.abs(o - amount) < 0.005) ? 'bill' : Math.abs(dues - amount) < 0.005 ? 'dues' : '';
