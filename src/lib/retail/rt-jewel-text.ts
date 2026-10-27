/**
 * RT-E1 / RT-E2 purities and the printed jewellery sub-line (pure, no imports): shared by the jewellery engines and the
 * invoice paper (`paper-helpers.ts` `jewelText`), so the templates never load the rule file. BIS Reg. 5(11) contents:
 * net weight, purity in carat and fineness, HUID, hallmarking charge (RT19). Working paper — verify with your CA.
 */
import type { JewelLine, Metal } from '../../types/retail-r9';

/** Purity key → fineness (parts per 1000). Gold by karat; silver / platinum by fineness. */
export const PURITIES: Readonly<Record<Metal, readonly (readonly [string, number])[]>> = {
  gold: [['24K', 999], ['23K', 958], ['22K', 916], ['21K', 875], ['20K', 833], ['18K', 750], ['14K', 585], ['9K', 375]],
  silver: [['999', 999], ['925', 925], ['900', 900], ['800', 800]],
  platinum: [['950', 950], ['900', 900]],
};

/** Fineness of a purity key (0 when unknown). */
export const fineness = (metal: Metal, purity: string): number => PURITIES[metal]?.find(([k]) => k === purity)?.[1] ?? 0;

/** "22K (916)" for gold, "925" for silver — the BIS bill shows carat and fineness. */
export const purityLabel = (metal: Metal, purity: string): string => (metal === 'gold' && fineness(metal, purity) ? `${purity} (${fineness(metal, purity)})` : purity);

/** Grams, 3 decimals. */
export const r3 = (x: number): number => Math.round((x + Number.EPSILON) * 1000) / 1000 || 0;

const g = (x: number) => `${(Number(x) || 0).toFixed(3)} g`;
const rs = (x: number) => `₹${(Number(x) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** The printed sub-line of a jewellery line ('' without a breakdown). */
export function jewelText(jw: JewelLine | undefined): string {
  if (!jw) return '';
  const m = jw.making;
  return [
    jw.tag && `Tag ${jw.tag}`,
    jw.stone_wt > 0 && `Gross ${g(jw.gross_wt)} · Stones ${g(jw.stone_wt)}`,
    jw.job_work ? `Customer's metal ${g(jw.net_wt)} (memo)` : `Net ${g(jw.net_wt)}`,
    purityLabel(jw.metal, jw.purity),
    jw.huid && `HUID ${jw.huid}`,
    !jw.job_work && `${rs(jw.rate)}/g`,
    jw.wastage_g ? `Wastage ${g(jw.wastage_g)}` : jw.wastage_pct > 0 && `Wastage ${jw.wastage_pct}%`,
    m?.value > 0 && `Making ${m.basis === 'percent' ? `${m.value}%` : rs(m.value)}${m.basis === 'per_gram' ? '/g' : ''}`,
    jw.stone_value > 0 && `Stones ${rs(jw.stone_value)}`,
    jw.hallmark_charge > 0 && `Hallmarking ${rs(jw.hallmark_charge)}`,
  ].filter(Boolean).join(' · ');
}
