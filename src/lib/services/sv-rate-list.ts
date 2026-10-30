/**
 * SV-B1 rate list (CEA Rule 9(i), display at the clinic): service items of the health classes (consultation,
 * procedures, rooms, tests) with rate and unit, in English and a second language (names typed on the desk, the
 * language label from the clinic settings), A4 / A3, "Rates as on <date>". The printed rates are remembered
 * (`clinic_settings.rates_printed`), so a price change shows "Rate list out of date — reprint". Script-free HTML.
 */
import type { ClinicSettings, SvClass } from '../../types/services-r10';
import { esc as escapeHtml } from '../voucher-print';
import { PRINT_FONT, PRINT_FONT_FACE } from '../print-fonts';

const HEALTH: readonly SvClass[] = ['health_exempt', 'health_cosmetic', 'hospital_room_low', 'hospital_room_high'];
export interface RateRow { id: string; name: string; local?: string; rate: number; unit?: string }
type Priced = { id?: string; name: string; rate?: number; sale_price?: number; unit?: string; sv_class?: SvClass };

/** Pure: health-class items (catalogue and stock rows), sorted by name; a row without an id is keyed by its name. */
export function rateRows(items: readonly Priced[], s: Pick<ClinicSettings, 'rate_names'> = {}): RateRow[] {
  const seen = new Set<string>();
  const out: RateRow[] = [];
  for (const i of items) {
    if (!i?.sv_class || !HEALTH.includes(i.sv_class) || !i.name?.trim()) continue;
    const id = i.id || i.name.trim();
    if (seen.has(i.name.trim().toLowerCase())) continue;
    seen.add(i.name.trim().toLowerCase());
    out.push({ id, name: i.name.trim(), ...(s.rate_names?.[id] ? { local: s.rate_names[id] } : {}), rate: Number(i.rate ?? i.sale_price) || 0, ...(i.unit ? { unit: i.unit } : {}) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The signature of the rates (what a printed list showed). */
export const rateSig = (rows: readonly RateRow[]): string => rows.map((r) => `${r.name}=${r.rate}`).join('|');

/** True when the rates changed since the list was last printed (never printed = false). */
export const ratesOutOfDate = (rows: readonly RateRow[], s: Pick<ClinicSettings, 'rates_printed'>): boolean => !!s.rates_printed && s.rates_printed.slice(11) !== rateSig(rows);

/** The value stored on print: `<date>|<signature>`. */
export const printedStamp = (rows: readonly RateRow[], day: string): string => `${day}|${rateSig(rows)}`;

/** Script-free printable rate list. */
export function rateListHtml(rows: readonly RateRow[], o: { business: string; asOn: string; lang?: string; size?: 'A4' | 'A3'; money: (n: number) => string }): string {
  const two = rows.some((r) => r.local);
  const body = rows.map((r) => `<tr><td>${escapeHtml(r.name)}</td>${two ? `<td>${escapeHtml(r.local ?? '')}</td>` : ''}<td class="n">${escapeHtml(o.money(r.rate))}</td><td>${escapeHtml(r.unit ?? '')}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Rate list</title><style>${PRINT_FONT_FACE}@page{size:${o.size ?? 'A4'};margin:14mm}body{font:${o.size === 'A3' ? 16 : 12}pt ${PRINT_FONT};color:#000}h1{font-size:1.6em;margin:0}table{width:100%;border-collapse:collapse;margin-top:1em}th,td{border:1px solid #000;padding:6px;text-align:left}.n{text-align:right}</style></head><body><h1>${escapeHtml(o.business)}</h1><p>Rate list${o.lang ? ` / ${escapeHtml(o.lang)}` : ''} · Rates as on ${escapeHtml(o.asOn)}</p><table><thead><tr><th>Service</th>${two ? `<th>${escapeHtml(o.lang || '-')}</th>` : ''}<th class="n">Rate</th><th>Unit</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
}
