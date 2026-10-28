/**
 * R17-A3 GST regime engine for manpower bills (pure). By the document date and the rule rows of `manpower-rules.ts`:
 *  - `rcm` — a security post (SAC 99852x) supplied by a firm that is NOT a body corporate (`company`, `llp`) to a client
 *    with a GSTIN, unless the client is a Government department registered only for GST TDS or a composition taxpayer
 *    (N 13/2017-CT(R) entry 14 as inserted by N 29/2018-CT(R), from 1 Jan 2019; MP1, MP2);
 *  - `exempt66` — security / cleaning / housekeeping (99852x / 99853x) for a client flagged `school` (Sl. 66(b)(iii), MP7);
 *  - `manual_exempt` — the user's typed reason (e.g. Sl. 3, MP8);
 *  - `fwd` — everything else, at the heading 9985 rate (MP4).
 * Reverse charge is a document flag, so posts of different regimes are billed on separate invoices (`splitPosts`, MP10).
 * The patch reuses the existing outward reverse-charge fields and the R10 line key `sv.exempt` — no GST reader changes.
 * Working papers — verify with your CA.
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { ClientMp, MpRegime, MpSnapshot } from '../../types/manpower-r17';
import { ruleAt } from '../tax-rules';
import { BODY_CORPORATE_RULES, EDU_EXEMPT_RULES, MP_GST_RATE_RULES, SECURITY_RCM_RULES } from '../manpower-rules';

export const MP_REGIMES: readonly MpRegime[] = ['fwd', 'rcm', 'exempt66', 'manual_exempt'];

export interface RegimeCtx {
  date: string;
  /** Our firm form (the annual pack's entity type); absent = proprietorship. */
  entityType?: string;
  client?: { gstin?: string; mp?: ClientMp } | null;
  /** A manual exemption with its typed reason. */
  manual?: string;
}
export interface RegimeResult { regime: MpRegime; rate: number; decl: string; ca: string[]; split?: boolean }

/** The regime of one post (its SAC) for a client on a date. */
export function postRegime(sac: string | undefined, c: RegimeCtx): RegimeResult {
  const date = c.date.slice(0, 10);
  const s = String(sac ?? '').trim();
  const rate = ruleAt(MP_GST_RATE_RULES, date);
  if (c.manual?.trim()) return { regime: 'manual_exempt', rate: 0, decl: `Exempt — ${c.manual.trim()}. Verify with your CA.`, ca: ['MP8'] };
  const edu = ruleAt(EDU_EXEMPT_RULES, date);
  if (c.client?.mp?.school && edu.sacs.some((p) => s.startsWith(p))) return { regime: 'exempt66', rate: 0, decl: edu.decl, ca: ['MP7'] };
  const rcm = ruleAt(SECURITY_RCM_RULES, date);
  const corporate = ruleAt(BODY_CORPORATE_RULES, date).includes(c.entityType || 'proprietorship');
  if (rcm && s.startsWith(rcm.sac) && !corporate && (c.client?.gstin?.trim().length ?? 0) === 15 && !rcm.exclude.some((k) => c.client?.mp?.[k])) return { regime: 'rcm', rate, decl: rcm.decl, ca: ['MP1', 'MP2', 'MP10'] };
  return { regime: 'fwd', rate, decl: '', ca: ['MP4'] };
}

/** The document's regime from its posts' SACs (`split` = the posts need more than one invoice). */
export function mpRegime(c: RegimeCtx, sacs: readonly (string | undefined)[]): RegimeResult {
  const per = (sacs.length ? sacs : ['']).map((s) => postRegime(s, c));
  return { ...per[0], ...(per.some((r) => r.regime !== per[0].regime) ? { split: true } : {}) };
}

/** Posts grouped by regime, one group per invoice (B3). */
export function splitPosts<T extends { sac?: string }>(posts: readonly T[], c: RegimeCtx): Partial<Record<MpRegime, T[]>> {
  const out: Partial<Record<MpRegime, T[]>> = {};
  for (const p of posts) (out[postRegime(p.sac, c).regime] ??= []).push(p);
  return out;
}

/**
 * The editor / bill patch for a regime: line rates (exempt → 0 % with `sv.exempt`; otherwise a typed rate wins, a
 * blank or formerly exempt line takes the rule rate), the reverse-charge flag and the `mp` snapshot (regime, sentence,
 * the user's note). Other `mp` sub-objects (B–D) are kept.
 */
export function mpRegimePatch(rec: Pick<InvoiceRecord, 'items'> & { mp?: MpSnapshot }, r: RegimeResult, note?: string): Partial<InvoiceRecord> {
  const exempt = r.regime === 'exempt66' || r.regime === 'manual_exempt';
  const items = (rec.items ?? []).map((l): InvoiceItem => {
    if (exempt) return { ...l, tax_rate: 0, sv: { ...l.sv, exempt: 'EXEMPT' } };
    if (l.sv?.exempt !== 'EXEMPT') return Number(l.tax_rate) > 0 ? l : { ...l, tax_rate: r.rate };
    const { exempt: _e, ...sv } = l.sv;
    void _e;
    return { ...l, tax_rate: r.rate, sv };
  });
  const { regime_note: _n, decl: _d, ...mp } = rec.mp ?? {};
  void _n;
  void _d;
  return {
    items,
    reverse_charge: r.regime === 'rcm',
    rcm_tax_excluded: r.regime === 'rcm' ? true : undefined,
    mp: { ...mp, regime: r.regime, ...(r.decl ? { decl: r.decl } : {}), ...(note?.trim() ? { regime_note: note.trim() } : {}) },
  };
}
