/**
 * RT-E2 jewellery bill line (pure). The breakdown is snapshotted as `jw` on the line; the line amount is
 *
 *   metal    = net g × rate per g
 *   wastage  = metal × wastage %  (or wastage g × rate)
 *   making   = per gram × net g  |  % of the metal value  |  fixed
 *   amount   = metal + wastage + making + stone value + hallmarking charge   (rounded to the paisa, or the rupee)
 *
 * Quantity = 1 piece for a tag (its serial leaves stock), or the net weight in GMS for a loose sale; `rate` = amount ÷
 * quantity, so invoice-calc, GST, the HSN summary and stock are unchanged (the Round 8 weight-line approach). GST: one
 * line at 3% on the WHOLE value incl. making / wastage / stones / hallmarking (RT16); job work on the customer's own
 * metal is a separate mode at 5% (SAC 9988, unverified) with the metal weight as a memo. Working paper — verify with
 * your CA (RT16, RT19, RT22).
 */
import type { InvoiceItem } from '../../types/invoice';
import type { JewelLine } from '../../types/retail-r9';
import { HALLMARK_RULES, JEWELLERY_GST_RULES } from '../retail-rules';
import { ruleAt } from '../tax-rules';
import { mulRound2, num, round2 } from '../invoice-calc';
import { r3 } from './rt-jewel-rates';

export interface JewelAmount { metal: number; wastage: number; making: number; total: number }

/** The money breakdown of a jewellery line. `rupee` rounds the total to the rupee (setting; default paisa). */
export function jewelAmount(jw: JewelLine, rupee = false): JewelAmount {
  const net = Math.max(num(jw.net_wt), 0);
  const rate = Math.max(num(jw.rate), 0);
  const metal = jw.job_work ? 0 : round2(net * rate);
  const wastage = jw.job_work ? 0 : num(jw.wastage_g) > 0 ? round2(num(jw.wastage_g) * rate) : round2((metal * Math.max(num(jw.wastage_pct), 0)) / 100);
  const v = Math.max(num(jw.making?.value), 0);
  const making = round2(jw.making?.basis === 'per_gram' ? v * net : jw.making?.basis === 'percent' ? (metal * v) / 100 : v);
  const sum = round2(metal + wastage + making + Math.max(num(jw.stone_value), 0) + Math.max(num(jw.hallmark_charge), 0));
  return { metal, wastage, making, total: rupee ? Math.round(sum) : sum };
}

/** Net weight = gross − stones (3 decimals, never below 0). */
export const netWeight = (gross: number, stones: number): number => r3(Math.max(num(gross) - Math.max(num(stones), 0), 0));

/** HUID: 6 letters / digits (BIS). */
export const validHuid = (s: string | undefined): boolean => /^[A-Z0-9]{6}$/.test(String(s ?? '').trim().toUpperCase());

/** GST rate of a jewellery line on `date`: goods 3%, job work on the customer's metal 5% (RT16). */
export function jewelGst(date: string | undefined, jobWork = false): { rate: number; sac?: string } {
  const r = ruleAt(JEWELLERY_GST_RULES, date);
  return jobWork ? { rate: r.jobWorkRate, sac: r.jobWorkSac } : { rate: r.goodsRate };
}

/** Apply a breakdown to a line: amount, quantity (1 piece / net g), rate = amount ÷ quantity, GST, serial, BIS line. */
export function applyJewel(line: InvoiceItem, jw: JewelLine, date: string, rupee = false): InvoiceItem {
  const total = jewelAmount(jw, rupee).total;
  const net = r3(jw.net_wt);
  const qty = jw.tag ? 1 : net || 1;
  const gst = jewelGst(date, !!jw.job_work);
  const bis = ruleAt(HALLMARK_RULES, date).verifyLine;
  const next: InvoiceItem = {
    ...line,
    quantity: qty,
    unit: jw.tag ? line.unit || 'PCS' : 'GMS',
    rate: qty === 1 ? total : Number((total / qty).toFixed(6)),
    amount: total,
    tax_rate: gst.rate,
    discount_percent: 0,
    jw: { ...jw, net_wt: net, huid: jw.huid?.trim().toUpperCase() || undefined, bis },
  };
  if (gst.sac) Object.assign(next, { hsn: gst.sac, type: 'Service' });
  else if (!next.hsn) next.hsn = '7113';
  if (jw.tag) next.serials = [jw.tag];
  return next;
}

/** False when a quantity / rate typed over the breakdown no longer gives its amount (the line is then manual). */
export function jwHolds(line: Pick<InvoiceItem, 'jw' | 'quantity' | 'rate'>, rupee = false): boolean {
  return !!line.jw && Math.abs(mulRound2(num(line.quantity), num(line.rate)) - jewelAmount(line.jw, rupee).total) < 0.011;
}

/** A gold line without a HUID while the mandate row is in force: a warning, never a block (RT19). */
export function huidWarning(line: Pick<InvoiceItem, 'name' | 'jw'>, date: string): string {
  const jw = line.jw;
  if (!jw || jw.metal !== 'gold' || jw.job_work || validHuid(jw.huid) || !ruleAt(HALLMARK_RULES, date).huidMandatory) return '';
  return `${line.name}: no valid 6-character HUID — gold jewellery in a notified district must be hallmarked (verify with your CA).`;
}
