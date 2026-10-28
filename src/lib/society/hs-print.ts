/**
 * R18-A4 society paper (pure; family `f-society`): the header rows (unit, wing, area, members, period, due date), the
 * heads table (≤ 16 rows), the arrears memo and interest line (C1), the regime sentence (B2) and the "How your bill is
 * worked out" footnote — from the document's `hs` snapshot only, so an issued bill never changes. Working papers —
 * verify with your CA.
 */
import { periodRange } from './hs-tariff';
import type { HsHeadRow, HsSnapshot } from '../../types/society-r18';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);

/** `2026-10` → "Oct 2026"; `2026-Q3` → "Oct 2026 – Dec 2026"; '' when malformed. */
export function periodText(p?: string): string {
  const r = p ? periodRange(p) : null;
  if (!r) return '';
  const a = `${MONTHS[Number(r.from.slice(5, 7)) - 1]} ${r.from.slice(0, 4)}`;
  const b = `${MONTHS[Number(r.to.slice(5, 7)) - 1]} ${r.to.slice(0, 4)}`;
  return r.months === 1 ? a : `${a} – ${b}`;
}

export interface HsPaper {
  rows: [string, string][];
  heads: HsHeadRow[];
  /** Arrears brought forward (memo) and the interest line text. */
  arrears: string;
  interest: string;
  decl: string;
  /** "How your bill is worked out": [head, basis] per head. */
  explain: [string, string][];
}

export function societyPaper(hs: HsSnapshot, money: (n: number) => string = (n) => n.toFixed(2)): HsPaper {
  const rows: [string, string][] = [];
  const u = hs.unit;
  if (u) {
    rows.push(['Unit', u.wing && !u.code.startsWith(u.wing) ? `${u.code} (Wing ${u.wing})` : u.code]);
    if (u.area) rows.push(['Area', `${u.area} ${u.area_unit === 'sqm' ? 'sq m' : 'sq ft'}`]);
    if (u.members?.length) rows.push(['Member', u.members.join(', ')]);
  }
  if (periodText(hs.period)) rows.push(['Period', periodText(hs.period)]);
  if (hs.due) rows.push(['Due by', dmy(hs.due)]);
  const heads = (hs.heads ?? []).slice(0, 16);
  const arrears = hs.arrears && hs.arrears.amount > 0 ? `Arrears brought forward (as on ${dmy(hs.arrears.as_of)}): ${money(hs.arrears.amount)} — shown for information; payable with this bill.` : '';
  const i = hs.interest;
  const interest = i && i.amount > 0 ? `Interest on arrears ${dmy(i.from)} – ${dmy(i.to)} @ ${i.pct} % on ${money(i.on)} = ${money(i.amount)}` : '';
  return { rows, heads, arrears, interest, decl: hs.decl ?? '', explain: hs.explain ? heads.filter((h) => h.basis).map((h) => [h.name, h.basis]) : [] };
}
