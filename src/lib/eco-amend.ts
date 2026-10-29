/**
 * GSTR-1 Table 14A (7R, 7.129) — amendments of Table 14(a): the revised value / tax of supplies made through an
 * e-commerce operator that collects TCS (Sec 52), for the return period in which they were first reported. Built
 * from the period's amendment rows (B2BA / B2CLA / CDNRA / CDNURA / EXPA) that carry the operator GSTIN (`etin`),
 * grouped by operator × original period; credit notes count negative.
 *
 * Table 14A(b) (PENDING 44, `table14Ab`): the revised value of amended supplies on which the operator pays tax u/s
 * 9(5), from `amendments.eco95a` (value only, as Table 14(b); a supply that left 9(5) revises its row to 0).
 * Not generated (and why): Table 15 / 15A and GSTR-3B 3.1.1(i) are the OPERATOR's own rows (supplies on which the operator pays
 * tax u/s 9(5)) — this app prepares the supplier's return, so they stay nil (the 3B JSON writes `eco_sup` as zero).
 * JSON layout of 14A / 14A(b) is not verified, so they are working-paper tables only. Verify with your CA. Pure.
 */

import type { Gstr1Report } from './gst-reports';
import { num, round2 } from './invoice-calc';

export interface Eco14aRow {
  etin: string;
  /** Original return period, MMYYYY. */
  origPeriod: string;
  value: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  count: number;
}

export function table14A(g1: Gstr1Report): Eco14aRow[] {
  const am = g1.amendments;
  if (!am) return [];
  const out = new Map<string, Eco14aRow>();
  const rows = [
    ...(am.expa ?? []).map((r) => ({ r, f: 1 })),
    ...am.b2ba.map((r) => ({ r, f: 1 })),
    ...am.b2cla.map((r) => ({ r, f: 1 })),
    ...[...am.cdnra, ...am.cdnura].map((r) => ({ r, f: r.noteType === 'C' ? -1 : 1 })),
  ];
  for (const { r, f } of rows) {
    if (!r.etin) continue;
    const key = `${r.etin}|${r.origPeriod}`;
    const t = out.get(key) ?? { etin: r.etin, origPeriod: r.origPeriod, value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, count: 0 };
    t.value = round2(t.value + f * r.taxable);
    t.igst = round2(t.igst + f * r.igst);
    t.cgst = round2(t.cgst + f * r.cgst);
    t.sgst = round2(t.sgst + f * r.sgst);
    t.cess = round2(t.cess + f * num(r.cess));
    t.count++;
    out.set(key, t);
  }
  return [...out.values()].sort((a, b) => a.etin.localeCompare(b.etin) || a.origPeriod.localeCompare(b.origPeriod));
}

/** Table 14A(b): revised net value per operator × original period of this period's 9(5) amendments (PENDING 44). */
export function table14Ab(g1: Gstr1Report): Eco14aRow[] {
  const out = new Map<string, Eco14aRow>();
  for (const r of g1.amendments?.eco95a ?? []) {
    const f = r.noteType === 'C' ? -1 : 1;
    const key = `${r.etin}|${r.origPeriod}`;
    const t = out.get(key) ?? { etin: r.etin, origPeriod: r.origPeriod, value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, count: 0 };
    t.value = round2(t.value + f * r.taxable);
    t.count++;
    out.set(key, t);
  }
  return [...out.values()].sort((a, b) => a.etin.localeCompare(b.etin) || a.origPeriod.localeCompare(b.origPeriod));
}
