/**
 * MF-B3 scrap GST and TCS prompts (pure; tests/mf-scrap.test.ts). Scrap classes by date from `mfg-rules.ts`
 * (`SCRAP_CLASS_RULES`: metal 18%, paper waste 12% → 5% from 22 Sep 2025, plastic waste no suggestion — MF8); the TCS
 * preset "206C(1) scrap" from `trading-rules.ts` (read-only: 1% → 2% from 1 Apr 2026, Sec 394(1)), dropped when the
 * buyer gave the declaration of use in manufacturing (Form 127 / earlier 27C, MF10); metal scrap: RCM on purchase from
 * an unregistered supplier and GST TDS 2% u/s 51 by a registered buyer above ₹2.5 lakh, both from 10 Oct 2024 (MF7).
 * The app never decides whether goods are "scrap" for TCS (MF9). Working papers — verify with your CA.
 */
import { ruleAt } from '../tax-rules';
import { SCRAP_CLASS_RULES, SCRAP_TAX_RULES, type MfClassRate, type ScrapClass } from '../mfg-rules';
import { tradingTcsPresets, supplierKinds, type TradeTcsPreset } from '../trade/tr-statutory';
import { num } from '../invoice-calc';

export type { ScrapClass };
export const SCRAP_CLASSES = Object.keys(SCRAP_CLASS_RULES) as ScrapClass[];
/** Metal scrap classes (ch 72–81 waste): RCM on purchase from unregistered, GST TDS u/s 51 on B2B sales (MF7). */
const METAL_SCRAP: readonly ScrapClass[] = ['metal_ferrous', 'metal_nonferrous'];
/** HSN headings of metal waste and scrap (ch 72–81): a line with one of these is metal scrap without a class. */
const METAL_SCRAP_HSN: readonly string[] = ['7204', '7404', '7503', '7602', '7802', '7902', '8002', ...Array.from({ length: 13 }, (_, i) => String(8101 + i))];

export const TCS_SCOPE_NOTE = 'TCS u/s 394(1) (206C(1)) applies to scrap from manufacture or mechanical working (High Court rulings); the app does not decide the scope — verify with your CA (MF9).';

/** The class suggestion on a date (`rate: null` = type the rate). */
export const scrapClassRate = (cls: ScrapClass, date?: string): MfClassRate => ruleAt(SCRAP_CLASS_RULES[cls] ?? SCRAP_CLASS_RULES.other, date);

const hsnOf = (h: string | undefined) => String(h ?? '').replace(/\D/g, '');

/** A line's scrap class: the item's `mf_scrap_class`, else metal waste by HSN heading (7204 ferrous, 7404… non-ferrous). */
export function scrapClassOf(line: { hsn?: string }, item?: { mf_scrap_class?: string }): ScrapClass | undefined {
  const c = item?.mf_scrap_class as ScrapClass | undefined;
  if (c && SCRAP_CLASS_RULES[c]) return c;
  const h = hsnOf(line.hsn);
  const head = METAL_SCRAP_HSN.find((p) => h.startsWith(p));
  return head ? (head === '7204' ? 'metal_ferrous' : 'metal_nonferrous') : undefined;
}

export const isMetalScrap = (c: ScrapClass | undefined): boolean => !!c && METAL_SCRAP.includes(c);

/** The 206C(1) scrap preset on `date`, or null when the buyer's declaration is on record. */
export function scrapTcsPreset(date: string, declaration: boolean): TradeTcsPreset | null {
  return declaration ? null : tradingTcsPresets(date).find((p) => p.goods === 'scrap') ?? null;
}

/** '' or the printed note: the registered buyer deducts GST TDS u/s 51 on metal scrap above the limit. */
export function gstTdsNote(date: string, o: { buyerGstin?: string; metal: boolean; taxable: number }): string {
  const r = ruleAt(SCRAP_TAX_RULES, date);
  if (!o.metal || !(r.gst_tds_pct > 0) || !String(o.buyerGstin ?? '').trim() || !(num(o.taxable) > r.gst_tds_above)) return '';
  return `Buyer deducts GST TDS ${r.gst_tds_pct}% u/s 51 (${r.tds_ref}) — credit after GSTR-7; record it on the receipt as a short payment to "GST TDS receivable". Verify with your CA (MF7).`;
}

/** The RCM prompt on a bill: metal scrap from an unregistered supplier on / after 10 Oct 2024 (null otherwise). */
export function scrapRcm(lines: readonly { hsn?: string; item_id?: string }[], vendor: { gstin?: string; principal_kind?: string; rcm_maker?: boolean } | undefined, date: string, itemOf: (id: string) => { mf_scrap_class?: string } | undefined = () => undefined): { ref: string } | null {
  const r = ruleAt(SCRAP_TAX_RULES, date);
  if (!r.rcm_unregistered || !supplierKinds(vendor).includes('unregistered')) return null;
  return lines.some((l) => isMetalScrap(scrapClassOf(l, l.item_id ? itemOf(l.item_id) : undefined))) ? { ref: r.rcm_ref } : null;
}
