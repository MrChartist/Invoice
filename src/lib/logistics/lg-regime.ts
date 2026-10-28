/**
 * R19-B2 place of supply and rate per charge head (pure; family `f-logistics`), by the document date:
 *   - transport heads (freight / courier / GTA), recipient in India: Sec 12(8) — registered: its State; else where the
 *     goods are handed over (our State); goods to a place outside India from 1 Feb 2019: the proviso — POS 96, IGST
 *     (Circular 184/16/2022-GST, LG2 / LG15);
 *   - recipient outside India: 13(9) (transport of goods: the destination) to 30 Sep 2023, 13(2) from 1 Oct 2023 (mail /
 *     courier always 13(2)) — POS 96, an export of services under LUT when Sec 2(6) is not failed, else IGST (LG3);
 *   - intermediary (commission): 13(8)(b) — our location — until the R14 rule says `recipient` (LG4);
 *   - other heads: Sec 12(2) (LG9); pure agent: Rule 33, outside the value (LG10); exempt heads: N 12/2017-CT(R) (LG21).
 * Rates from `LG_RATE_RULES` (multimodal 5 % / 18 % with an air leg from 22 Sep 2025, domestic only — an international
 * multimodal job takes its legs' rate, LG6); the GTA leg's rate comes in the context (R5-B option, LG8). Hints only:
 * nothing here blocks. Working papers — verify with your CA.
 */
import { ruleAt } from '../tax-rules';
import { keyedAt, LG_EXEMPT_RULES, LG_POS_RULES, LG_RATE_RULES, OCEAN_RCM_RULES } from '../logistics-rules';
import { lgbT } from '../../i18n/areas/logistics-r19b';
import type { LgHead, LgJob } from '../../types/logistics-r19';
import { lgRateFor, posRuleOf } from './lg-heads';

export type LgRegimeKey = 'domestic' | 'export_freight' | 'cross_border' | 'intermediary' | 'general' | 'exempt' | 'pure_agent';
export type LgGstMode = 'IGST' | 'CGST_SGST' | 'NONE';

export interface RegimeCtx {
  date: string;
  sender: { state: string; registered: boolean };
  /** The job's client: GST State (registered: from the GSTIN), registered, outside India. */
  recipient: { state: string; registered: boolean; foreign: boolean };
  /** R14 intermediary rule on the date (`lg-tax-io.ts`). */
  inter: 'supplier' | 'recipient';
  /** The GTA leg's rate (R5-B option on the date, `lg-tax-io.ts`). */
  gta: number;
  /** Sec 2(6) not failed for this recipient (R14 export check). */
  exportOk?: boolean;
  /** An LUT in force on the date. */
  lut?: boolean;
}

export interface LgRegime { key: LgRegimeKey; pos: string; mode: LgGstMode; rate: number; supply?: 'EXPORT_LUT' | 'EXPORT_WITH_PAYMENT'; itc_note?: string; reason: string; ca: string }

const R184 = 'Place of supply outside India — Sec 12(8) proviso; IGST (Circular 184/16/2022-GST)';
const R203 = 'Sec 13(2) IGST Act (13(9) omitted from 1 Oct 2023, Circular 203/15/2023-GST)';
const abroad = (j: Pick<LgJob, 'dest_country'>) => !!j.dest_country && j.dest_country !== 'IN';

/** The head's GST rate on the date (null-safe: kinds without a row take the supporting-services rate). */
function rateOf(h: LgHead, j: LgJob, c: RegimeCtx): { rate: number; itc_note?: string } {
  if (h.kind === 'gta') return { rate: c.gta };
  let r = lgRateFor(h.kind, c.date, j.legs);
  // N 15/2025: the multimodal rate is for India-to-India transport; an international job takes its legs' rate (LG6).
  if (r?.domestic_only && j.dir !== 'domestic') r = lgRateFor(j.legs?.includes('air') ? 'freight_air' : 'freight_sea', c.date);
  return r ? { rate: r.rate, ...(r.itc_note ? { itc_note: r.itc_note } : {}) } : { rate: keyedAt(LG_RATE_RULES, 'support', c.date)?.value.rate ?? 18 };
}

/** The regime of one head of a job, billed to the job's client on `c.date`. */
export function lgRegime(h: LgHead, j: LgJob, c: RegimeCtx): LgRegime {
  const { sender: s, recipient: r, date } = c;
  const rule = posRuleOf(h);
  const r0 = rateOf(h, j, c);
  const make = (key: LgRegimeKey, pos: string, reason: string, ca: string, extra: Partial<LgRegime> = {}): LgRegime => ({
    key, pos, mode: !s.registered ? 'NONE' : pos === s.state ? 'CGST_SGST' : 'IGST', rate: s.registered ? r0.rate : 0, ...(r0.itc_note ? { itc_note: r0.itc_note } : {}), reason, ca, ...extra,
  });
  const home = r.foreign ? '96' : r.state || s.state;
  if (h.role === 'pure_agent') return make('pure_agent', home, 'Rule 33 CGST Rules', 'LG10', { mode: 'NONE', rate: 0 });
  if (h.role === 'exempt' || h.exempt_if) {
    const row = keyedAt(LG_EXEMPT_RULES, h.exempt_if ?? 'agri_produce', date);
    return make('exempt', home, `Exempt — ${h.exempt_if && row ? row.value.serial : 'N 12/2017-CT(R)'}`, 'LG21', { mode: 'NONE', rate: 0 });
  }
  if (r.foreign) {
    if (rule === 'intermediary' && c.inter === 'supplier') return make('intermediary', s.state, 'Sec 13(8)(b) IGST Act — location of the supplier (intermediary)', 'LG4');
    const cb = keyedAt(LG_POS_RULES, 'cross_border', date);
    // 13(9) (to 30 Sep 2023): transport of goods other than mail / courier — the destination of the goods.
    const dest = rule === 'transport' && h.kind !== 'courier' && cb?.value.pos === 'destination';
    const pos = !dest || abroad(j) ? '96' : s.state;
    const reason = dest ? cb!.value.section : date >= '2023-10-01' ? R203 : 'Sec 13(2) IGST Act';
    if (pos !== '96') return make('cross_border', pos, reason, 'LG3');
    const lut = !!(c.exportOk && c.lut && s.registered);
    return make('cross_border', '96', `${reason}; ${lut ? 'export of services under LUT' : 'IGST paid'}`, 'LG3', { mode: s.registered ? 'IGST' : 'NONE', supply: lut ? 'EXPORT_LUT' : 'EXPORT_WITH_PAYMENT' });
  }
  if (rule === 'transport') {
    if (abroad(j) && keyedAt(LG_POS_RULES, 'export', date)) return make('export_freight', '96', R184, 'LG2', { mode: s.registered ? 'IGST' : 'NONE' });
    return make('domestic', r.registered && r.state ? r.state : s.state, 'Sec 12(8) IGST Act', 'LG1');
  }
  return make('general', home, 'Sec 12(2) IGST Act', 'LG9');
}

/** Job-level hints (never blocks): ocean freight RCM on CIF imports gone from 1 Oct 2023 (LG16). */
export function regimeHints(j: LgJob, date: string): string[] {
  const out: string[] = [];
  if (j.dir === 'import' && j.mode.startsWith('sea') && /CIF/i.test(j.incoterm ?? '') && ruleAt(OCEAN_RCM_RULES, date) === false) out.push(lgbT('hOcean'));
  return out;
}

/** The chip text: "POS 96 · IGST 18 %". */
export const regimeChip = (g: LgRegime): string => `POS ${g.pos} · ${g.key === 'pure_agent' ? 'Rule 33' : g.supply === 'EXPORT_LUT' ? 'LUT 0 %' : g.mode === 'NONE' ? g.key === 'exempt' ? lgbT('exempt') : '0 %' : `${g.mode === 'IGST' ? 'IGST' : 'CGST + SGST'} ${g.rate} %`}`;
