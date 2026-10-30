/**
 * Purchase-side HSN / rate register (WP-6, P1-16): inward supplies of a period summarised by HSN × rate × UQC, and
 * a rate-wise summary — the purchase twin of GSTR-1 Table 12. A purchases reader (Critical Rule 9): every bill goes
 * through `readPurchase` / `readPurchaseLines` / `splitLumpTax`.
 *
 * Each bill's taxable value and GST heads are spread over its lines in proportion to the line value, so the
 * register totals equal the bills' totals (and GSTR-3B Table 4 / 5 inputs). A bill without lines is one row with
 * no HSN. Purchase returns / supplier notes are not netted here. Working paper — verify with your CA.
 */

import { isVoidStatus, readPurchase, readPurchaseLines, splitLumpTax } from './purchase-normalize';
import { checkGstin } from './gstin';
import { round2 } from './invoice-calc';
import { findHsn, type HsnMasterRow } from './hsn-master';

export interface PurchaseHsnRow {
  hsn: string;
  description: string;
  uqc: string;
  rate: number;
  qty: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  /** Distinct bills contributing. */
  bills: number;
  /** Part of it is not claimed as ITC (ineligible / blocked). */
  ineligible: number;
}

export interface PurchaseRateRow {
  rate: number;
  taxable: number;
  tax: number;
  cess: number;
}

export interface PurchaseHsnRegister {
  rows: PurchaseHsnRow[];
  byRate: PurchaseRateRow[];
  totals: { taxable: number; igst: number; cgst: number; sgst: number; cess: number };
  /** Lines without an HSN (reported under '—'). */
  linesWithoutHsn: number;
  billsConsidered: number;
}

/** Spread `total` over `weights` so the parts add up exactly (largest remainder on the paise). */
function spread(total: number, weights: number[]): number[] {
  const w = weights.map((x) => Math.max(x, 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const paise = Math.round(total * 100);
  if (!w.length) return [];
  if (sum <= 0) return w.map((_, i) => (i === 0 ? paise / 100 : 0));
  const raw = w.map((x) => (paise * x) / sum);
  const out = raw.map(Math.floor);
  let left = paise - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k][1]] += 1;
  return out.map((p) => p / 100);
}

export function purchaseHsnRegister(
  rawPurchases: readonly unknown[],
  o: { from: string; to: string; filerStateCode?: string; master?: readonly HsnMasterRow[] },
): PurchaseHsnRegister {
  const acc = new Map<string, PurchaseHsnRow & { billIds: Set<string> }>();
  let noHsn = 0;
  let bills = 0;
  for (const raw of rawPurchases) {
    const c = readPurchase(raw);
    if (!c || isVoidStatus(c.status) || c.date < o.from || c.date > o.to) continue;
    bills++;
    const supState = checkGstin(c.partyGstin).stateCode ?? c.vendorStateCode;
    const heads = splitLumpTax(c, raw, o.filerStateCode ?? '', supState);
    const lines = readPurchaseLines(raw).filter((l) => l.quantity || l.unitCost);
    const billRate = heads.taxable > 0 ? round2((heads.tax / heads.taxable) * 100) : 0;
    const parts = lines.length
      ? lines.map((l) => ({ hsn: l.hsn, name: l.name, uqc: l.unit, qty: l.quantity, rate: l.taxRate || billRate, weight: l.quantity * l.unitCost }))
      : [{ hsn: '', name: c.category || c.partyName, uqc: '', qty: 0, rate: billRate, weight: 1 }];
    const w = parts.map((p) => p.weight);
    const tx = spread(heads.taxable, w);
    const ig = spread(heads.igst, w);
    const cg = spread(heads.cgst, w);
    const sg = spread(heads.sgst, w);
    const ce = spread(c.cess, w);
    parts.forEach((p, i) => {
      const code = p.hsn.replace(/\s+/g, '') || '-';
      if (code === '-') noHsn++;
      const uqc = (p.uqc || '').toUpperCase();
      const key = `${code}|${p.rate}|${uqc}`;
      // The master's description is used for an exact code only; a prefix match keeps the line's own name.
      const found = code !== '-' && o.master ? findHsn(o.master, code) : undefined;
      const master = found?.code === code ? found : undefined;
      const row = acc.get(key) ?? { hsn: code, description: master?.description || p.name, uqc: uqc || master?.uqc || '', rate: p.rate, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, bills: 0, ineligible: 0, billIds: new Set<string>() };
      row.qty = round2(row.qty + p.qty);
      row.taxable = round2(row.taxable + tx[i]);
      row.igst = round2(row.igst + ig[i]);
      row.cgst = round2(row.cgst + cg[i]);
      row.sgst = round2(row.sgst + sg[i]);
      row.cess = round2(row.cess + ce[i]);
      if (!c.itcEligible) row.ineligible = round2(row.ineligible + ig[i] + cg[i] + sg[i] + ce[i]);
      row.billIds.add(c.id || `${c.date}:${c.number}`);
      acc.set(key, row);
    });
  }
  const rows = [...acc.values()]
    .map(({ billIds, ...r }) => ({ ...r, bills: billIds.size }))
    .sort((a, b) => Number(a.hsn === '-') - Number(b.hsn === '-') || a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
  const rate = new Map<number, PurchaseRateRow>();
  const totals = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  for (const r of rows) {
    const x = rate.get(r.rate) ?? { rate: r.rate, taxable: 0, tax: 0, cess: 0 };
    x.taxable = round2(x.taxable + r.taxable);
    x.tax = round2(x.tax + r.igst + r.cgst + r.sgst);
    x.cess = round2(x.cess + r.cess);
    rate.set(r.rate, x);
    for (const k of ['taxable', 'igst', 'cgst', 'sgst', 'cess'] as const) totals[k] = round2(totals[k] + r[k]);
  }
  return { rows, byRate: [...rate.values()].sort((a, b) => a.rate - b.rate), totals, linesWithoutHsn: noHsn, billsConsidered: bills };
}
