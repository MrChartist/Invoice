/**
 * R18-A4 society paper (pure; family `f-society`): the header rows (unit, wing, area, members, period, due date) and
 * the heads table (≤ 16 rows, each with its basis) — from the document's `hs` snapshot only, so an issued bill never
 * changes. B prints the regime sentence (`hs.decl`, already shown by `SocietyBlock`), C the arrears memo and interest
 * line, D the fund note — each as its own `parts/society/*.tsx` part. Cut 1 (PRD §3): no "How your bill is worked out"
 * footnote; the heads table carries each head's basis.
 */
import { periodRange } from './hs-tariff';
import type { HsHeadRow, HsSnapshot } from '../../types/society-r18';

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const mon = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** `2026-10` → "Oct 2026"; `2026-Q3` → "Oct 2026 – Dec 2026"; '' when malformed. */
export function periodText(p?: string): string {
  const r = p ? periodRange(p) : null;
  return !r ? '' : r.months === 1 ? mon(r.from) : `${mon(r.from)} – ${mon(r.to)}`;
}

export function societyPaper(hs: HsSnapshot): { rows: [string, string][]; heads: HsHeadRow[] } {
  const u = hs.unit;
  const rows: [string, string][] = [];
  if (u) rows.push(['Unit', u.wing && !u.code.startsWith(u.wing) ? `${u.code} (Wing ${u.wing})` : u.code]);
  if (u?.area) rows.push(['Area', `${u.area} ${u.area_unit === 'sqm' ? 'sq m' : 'sq ft'}`]);
  if (u?.members?.length) rows.push(['Member', u.members.join(', ')]);
  if (periodText(hs.period)) rows.push(['Period', periodText(hs.period)]);
  if (hs.due) rows.push(['Due by', hs.due.split('-').reverse().join('/')]);
  // R18-C1: a memo (the old bills stay the receivable); the interest is a line of this bill.
  if (hs.arrears) rows.push(['Arrears brought forward (memo)', `₹${hs.arrears.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} as at ${hs.arrears.as_of.split('-').reverse().join('/')}`]);
  return { rows, heads: (hs.heads ?? []).slice(0, 16) };
}
