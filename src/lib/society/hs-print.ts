/**
 * R18-A4 society paper (pure; family `f-society`): the header rows (unit, wing, area, members, period, due date) and
 * the heads table (≤ 16 rows, each with its basis) — from the document's `hs` snapshot only, so an issued bill never
 * changes. B prints the regime sentence (`hs.decl`, already shown by `SocietyBlock`), C the arrears memo and interest
 * line, D the fund note — each as its own `parts/society/*.tsx` part. With `hs.explain` (set by the run, PENDING #6) the
 * "How your bill is worked out" footnote: each head's basis and amount, the GST test, pass-through dues, the interest.
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

const rs = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (d: string) => d.split('-').reverse().join('/');

/** The footnote lines (from the snapshot only). */
export function explainLines(hs: HsSnapshot): string[] {
  const out = (hs.heads ?? []).slice(0, 16).map((h) => `${h.name}: ${h.basis || '—'} = ${rs(h.amount)}`);
  if (hs.test && hs.test.limit > 0 && /^(exempt77c|taxable_)/.test(hs.regime ?? '')) out.push(`GST test: member contributions ${rs(hs.test.counted / Math.max(1, hs.test.months))} a month against the ${rs(hs.test.limit)} a month limit.`);
  if (hs.heads?.some((h) => h.kind === 'statutory')) out.push('Statutory dues are collected for the authority and passed on, outside GST.');
  if (hs.interest) out.push(`Interest: ${hs.interest.pct} % a year, simple, on ${rs(hs.interest.on)} from ${dmy(hs.interest.from)} to ${dmy(hs.interest.to)}.`);
  return out;
}

export function societyPaper(hs: HsSnapshot): { rows: [string, string][]; heads: HsHeadRow[]; explain?: string[] } {
  const u = hs.unit;
  const rows: [string, string][] = [];
  if (u) rows.push(['Unit', u.wing && !u.code.startsWith(u.wing) ? `${u.code} (Wing ${u.wing})` : u.code]);
  if (u?.area) rows.push(['Area', `${u.area} ${u.area_unit === 'sqm' ? 'sq m' : 'sq ft'}`]);
  if (u?.members?.length) rows.push(['Member', u.members.join(', ')]);
  if (periodText(hs.period)) rows.push(['Period', periodText(hs.period)]);
  if (hs.due) rows.push(['Due by', hs.due.split('-').reverse().join('/')]);
  // R18-C1: a memo (the old bills stay the receivable); the interest is a line of this bill.
  if (hs.arrears) rows.push(['Arrears brought forward (memo)', `₹${hs.arrears.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} as at ${hs.arrears.as_of.split('-').reverse().join('/')}`]);
  return { rows, heads: (hs.heads ?? []).slice(0, 16), ...(hs.explain ? { explain: explainLines(hs) } : {}) };
}
