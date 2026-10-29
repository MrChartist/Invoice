/**
 * R21-D2 Rule 42 for pumps (pure): the R5-C common-credit run computes E (exempt + non-GST) and F (total) with
 * `turnoverOf`; with the `fuel` pack on, both are then reduced by Σ (excise + VAT per litre of the price row each fuel
 * line was sold at) × litres of the period (`RULE42_DUTY_EXCLUSION_RULES`, FU12 ★, `verified: false`), the working is
 * shown and "Leave duties in" switches it off. The 3B check sets the period's fuel sales value against Table 3.1(e).
 * Working papers — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { FuelPrice } from '../../types/fuel-r21';
import { num, round2 } from '../invoice-calc';
import { RULE42_DUTY_EXCLUSION_RULES, fuAt } from '../fuel-rules';
import { dT } from '../../i18n/areas/fuel-r21d';

const DOCS = ['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'DEBIT_NOTE', 'CREDIT_NOTE'];

export interface DutyWorking {
  /** Litres of the period with a typed build-up, the duty they carried, the fuel sales value; litres without a build-up. */
  litres: number;
  duty: number;
  value: number;
  missing: number;
}

/** The period's non-GST fuel lines (`fu.lines` of live sales documents; credit notes subtract) and their excise + VAT. */
export function dutyOf(docs: readonly InvoiceRecord[], prices: readonly FuelPrice[], from: string, to: string): DutyWorking {
  const w: DutyWorking = { litres: 0, duty: 0, value: 0, missing: 0 };
  const byId = new Map(prices.map((p) => [p.id, p]));
  for (const d of docs) {
    if (!d.fu?.lines || d.status === 'Draft' || d.status === 'Cancelled' || !DOCS.includes(d.doc_type ?? 'INVOICE') || d.issue_date < from || d.issue_date > to) continue;
    const sign = d.doc_type === 'CREDIT_NOTE' ? -1 : 1;
    for (const it of d.items) {
      const fl = d.fu.lines[it.id];
      if (!fl || it.sv?.exempt !== 'NON_GST') continue;
      const b = byId.get(fl.price_id ?? '')?.build;
      const per = num(b?.excise) + num(b?.vat);
      w.value += sign * num(it.amount);
      if (per > 0) {
        w.litres += sign * fl.litres;
        w.duty += sign * per * fl.litres;
      } else w.missing += sign * fl.litres;
    }
  }
  return { litres: Math.round(w.litres * 1000) / 1000, duty: round2(w.duty), value: round2(w.value), missing: Math.round(w.missing * 1000) / 1000 };
}

/** The `adjust` argument of `turnoverOf`: E and F less the duties (never below 0), with the working as its note. */
export function dutyAdjust(w: DutyWorking, from: string, leaveIn: boolean): (E: number, F: number) => { E: number; F: number; note: string } {
  const on = !leaveIn && w.duty > 0 && !!fuAt(RULE42_DUTY_EXCLUSION_RULES, from);
  return (E, F) => (on
    ? { E: round2(Math.max(E - w.duty, 0)), F: round2(Math.max(F - w.duty, 0)), note: dT('r42', { d: w.duty.toFixed(2), l: w.litres.toFixed(3), m: w.missing.toFixed(3) }) }
    : { E, F, note: w.duty > 0 ? dT('r42off') : '' });
}

/** 3B check: the period's fuel sales vs Table 3.1(e) non-GST outward ('' = they agree). */
export const check31e = (w: DutyWorking, nonGst: number): string => (Math.abs(w.value - num(nonGst)) > 0.5 ? dT('r42x', { f: w.value.toFixed(2), g: num(nonGst).toFixed(2) }) : '');

/** Labels the common-credit screen reads from this chunk. */
export const r42Label = (): string => dT('leaveIn');
