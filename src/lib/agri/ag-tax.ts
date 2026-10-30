/**
 * AG-A3 agri tax classes, declarations and the 194Q hint (lazy; working papers — verify with your CA).
 *  - A class (`ag_class` on a catalogue / stock item) suggests HSN / SAC and rate by document date (`AGRI_CLASS_RULES`,
 *    22 Sep 2025 rows per §2.3a); a typed rate always wins — a differing rate is a soft notice "(AGn)", never a block.
 *  - Declarations: a voucher from an agriculturist prints "Purchased from an agriculturist — agricultural produce; exempt;
 *    reverse charge not applicable" unless a line hits the R8 notified-goods list (TR17), which prints its RCM line
 *    instead. A sale of loose produce on a bill of supply prints "Agricultural produce — not pre-packaged and labelled".
 *  - 194Q: when our turnover test passes and a farmer's FY purchases cross the threshold, the voucher shows the prompt
 *    (agricultural produce is "goods", AG13). RCM, 194Q and TCS values stay in `trading-rules.ts`.
 */
import type { AgClass } from '../../types/agri-r12';
import { agClassAt, type AgClassRate } from '../agri-rules';
import { rcmGoodsMatches, supplierKinds, buyer194q } from '../trade/tr-statutory';
import { tdsThreshold } from '../tds-rules';
import { getIndianFY } from '../invoice-number';
import { num, round2 } from '../invoice-calc';

/** The CA item behind each class group (cited on the notice). */
const AG_OF: Readonly<Record<string, string>> = { milk: 'AG3', curd: 'AG3', paneer: 'AG4', ghee: 'AG4', cheese: 'AG4', cereal: 'AG5', pulses: 'AG5', flour: 'AG5', paddy: 'AG5', rice: 'AG6', dorb: 'AG6', broken: 'AG6', oil: 'AG6', storage: 'AG8', milling: 'AG9', job: 'AG10', interest: 'AG24', live: 'AG31', eggs: 'AG31', fish: 'AG31' };
export const caOfClass = (cls: AgClass): string => AG_OF[cls.split('_')[0]] ?? 'AG4';

export const classRate = (cls: AgClass | undefined, date?: string): AgClassRate | null => (cls ? agClassAt(cls, date) : null);

/** Soft notice when a line's typed rate differs from its class on the date ('' when it agrees or has no class). */
export function classRateNotice(line: { name?: string; tax_rate?: number; ag_class?: AgClass }, date?: string): string {
  const c = classRate(line.ag_class, date);
  if (!c || num(line.tax_rate) === c.rate) return '';
  return `${line.name || 'A line'}: rate ${num(line.tax_rate)}% differs from the class (${c.rate}% on this date, HSN ${c.hsn}), your typed rate is kept; verify with your CA (${caOfClass(line.ag_class!)}).`;
}

/** Classes that are agricultural produce sold loose (the bill-of-supply declaration). */
const LOOSE = new Set<AgClass>(['cereal_loose', 'pulses_loose', 'flour_loose', 'paddy', 'veg_fruit_fresh', 'potato', 'milk_fresh', 'curd_loose', 'broken_rice']);
export const isLooseProduce = (cls: AgClass | undefined): boolean => !!cls && LOOSE.has(cls);

export const AGRI_PURCHASE_DECLARATION = 'Purchased from an agriculturist: agricultural produce; exempt; reverse charge not applicable.';
export const LOOSE_PRODUCE_DECLARATION = 'Agricultural produce: not pre-packaged and labelled.';

/** The declaration of a farmer voucher: the RCM line(s) of notified goods, else the agriculturist line. */
export function voucherDeclaration(vendor: { gstin?: string; principal_kind?: string; rcm_maker?: boolean } | undefined, lines: readonly { hsn?: string; name?: string }[], date: string): string {
  const kinds = supplierKinds(vendor);
  if (!kinds.includes('agriculturist')) return '';
  const rcm = rcmGoodsMatches(lines, kinds, date);
  return rcm.length ? `${rcm.map((r) => r.goods).join(', ')} from an agriculturist: GST payable by us on reverse charge (${rcm[0].notification}), verify with your CA.` : AGRI_PURCHASE_DECLARATION;
}

/**
 * 194Q prompt on a farmer voucher: our turnover test passes (`tds_settings`) and the farmer's purchases in the FY
 * (this one included) cross the threshold. '' otherwise.
 */
export function prompt194q(date: string, fyPurchases: number, turnoverByFy?: Readonly<Record<string, number>>): string {
  const b = buyer194q(date, turnoverByFy);
  const limit = tdsThreshold('194Q', date)?.aggregate ?? 0;
  if (b.status !== 'applies' || !(limit > 0) || !(num(fyPurchases) > limit)) return '';
  return `194Q: purchases from this farmer are ₹${round2(fyPurchases).toLocaleString('en-IN')} in FY ${getIndianFY(date).label}, above ₹${limit.toLocaleString('en-IN')}, deduct TDS on the excess (agricultural produce is "goods"; AG13). Verify with your CA.`;
}
