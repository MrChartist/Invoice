/**
 * R19-A3 rate sheets and quotations (pure; family `f-logistics`). `ratesFor` picks, per active head, the client + lane
 * sheet valid on the job date, else the lane sheet (no client), else the head's own default; a row's `min` is the
 * minimum charge (`withMin`). A quotation made from a sheet carries `lg = { quote: true, lane }`; "Make job" copies its
 * parties, lane and heads into a new job (`jobFromQuote`). The quotation status flow is unchanged.
 */
import { lgT } from '../../i18n/areas/logistics-r19a';
import type { InvoiceRecord } from '../../types/invoice';
import type { LgHead, LgJob, LgRateSheet, LgUnit } from '../../types/logistics-r19';

export interface LgRateHit { rate: number; currency: string; unit: LgUnit; min?: number; from: 'client' | 'lane' | 'head' }

const lane = (a: { origin: string; destination: string; mode: string }) => `${a.origin}|${a.destination}|${a.mode}`.toUpperCase();
const valid = (s: LgRateSheet, d: string) => s.valid_from <= d && (!s.valid_to || s.valid_to >= d);

/** Rates of the job's heads by head id (sheet rows of the latest valid sheet win; client sheet before lane sheet). */
export function ratesFor(job: Pick<LgJob, 'client_id' | 'origin' | 'destination' | 'mode' | 'date'>, sheets: readonly LgRateSheet[], heads: readonly LgHead[]): Record<string, LgRateHit> {
  const key = lane(job);
  const pick = (client?: string) => sheets.filter((s) => (s.client_id ?? '') === (client ?? '') && lane(s.lane) === key && valid(s, job.date)).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
  const own = pick(job.client_id);
  const open = pick();
  const out: Record<string, LgRateHit> = {};
  for (const h of heads.filter((x) => x.active)) {
    const r = own?.rows.find((x) => x.head_id === h.id) ?? open?.rows.find((x) => x.head_id === h.id);
    if (r) out[h.id] = { rate: r.rate, currency: r.currency, unit: r.unit, ...(r.min !== undefined ? { min: r.min } : {}), from: own?.rows.includes(r) ? 'client' : 'lane' };
    else if (h.rate !== undefined) out[h.id] = { rate: h.rate, currency: h.currency ?? 'INR', unit: h.unit, from: 'head' };
  }
  return out;
}

/** An amount with the row's minimum charge applied. */
export const withMin = (amount: number, min?: number): number => Math.round(Math.max(amount, min ?? 0) * 100) / 100;

/** Sheet problems (blank lane, end before start, a row for an unknown head, a negative rate). */
export function sheetErrors(s: LgRateSheet, heads: readonly LgHead[]): string[] {
  const e: string[] = [];
  if (!s.lane.origin.trim() || !s.lane.destination.trim()) e.push(lgT('ePorts'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.valid_from) || (s.valid_to && s.valid_to < s.valid_from)) e.push(lgT('eValid'));
  if (s.rows.some((r) => !heads.some((h) => h.id === r.head_id) || !(r.rate >= 0) || (r.min ?? 0) < 0)) e.push(lgT('eNum'));
  return e;
}

/** A new job's fields from a quotation made from a sheet (parties, lane, mode; the heads come back from the sheet). */
export function jobFromQuote(q: Pick<InvoiceRecord, 'client' | 'issue_date' | 'lg'>, clientId: string): Omit<LgJob, 'id' | 'number' | 'updated_at'> | null {
  const l = q.lg?.quote ? q.lg.lane : undefined;
  if (!l) return null;
  return { date: q.issue_date, status: 'booked', dir: 'export', mode: l.mode, origin: l.origin, destination: l.destination, client_id: clientId, refs: {} };
}
