/**
 * R15-B4 travel paper (pure): the header rows (trip code, destination, dates, lead passenger and pax count), the regime
 * sentence (itinerary rows: cut 3, PRD §3) — from the document's `tv` snapshot only, so an issued invoice never changes.
 * C / D add their parts (ticket table, TCS line) as their own files under `templates/parts/travel/`.
 */
import type { TvSnapshot } from '../../types/travel-r15';

const dmy = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');

export interface TvPaper { title: string; rows: [string, string][]; decl: string }

export function tvPaper(tv: TvSnapshot): TvPaper {
  const t = tv.trip;
  const rows: [string, string][] = [];
  if (t) {
    rows.push([t.kind === 'event' ? 'Event file' : 'Trip file', t.code]);
    if (t.destination) rows.push(['Destination', t.destination]);
    if (t.start) rows.push(['Dates', [dmy(t.start), dmy(t.end)].filter(Boolean).join(' – ')]);
    if (t.lead) rows.push(['Lead passenger', t.lead]);
    if (t.pax) rows.push(['Passengers', String(t.pax)]);
  }
  return { title: t?.kind === 'event' ? 'Event' : 'Trip', rows, decl: tv.decl ?? '' };
}

