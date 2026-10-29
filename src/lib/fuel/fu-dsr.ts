/**
 * R21-B4 daily sales register (pure; the OMC layout): per shift × nozzle the opening, closing, test and sale litres
 * with the rate and value; per product the litres, average rate and value; collections by mode; credit-slip sales;
 * short / excess per attendant. The view prints it (A4 landscape, `escHtml`; CSV cut at the cap). MDG keeps the register
 * for the current and previous FY (FU19). Working papers — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { FuelNozzle, FuelPrice, FuelShift, FuelSlip } from '../../types/fuel-r21';
import { round2 } from '../invoice-calc';
import { nozzleLabel } from './fu-line';
import { shiftSales } from './fu-shift';
import { billedInShift, MODES, settleShift, type FuMode } from './fu-settle';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
export type Cell = string | number;

export interface Dsr { nozzles: Cell[][]; products: Cell[][]; modes: Cell[][]; people: Cell[][]; credit: number; errors: string[] }

/** The register of `date` from its closed / posted shifts (a shift that cannot be priced is named in `errors`). */
export function buildDsr(date: string, shifts: readonly FuelShift[], d: { nozzles: readonly FuelNozzle[]; prices: readonly FuelPrice[]; invoices: readonly InvoiceRecord[]; slips?: readonly FuelSlip[]; names: (itemId: string) => string }): Dsr {
  const out: Dsr = { nozzles: [], products: [], modes: [], people: [], credit: 0, errors: [] };
  const prod = new Map<string, { l: number; v: number }>();
  const modes: Partial<Record<FuMode, number>> = {};
  for (const s of [...shifts].filter((x) => x.date === date && x.status !== 'open').sort((a, b) => a.shift_no - b.shift_no)) {
    try {
      const sales = shiftSales(s, d.nozzles, d.prices);
      const billed = billedInShift(s, d.invoices, d.slips);
      for (const x of sales) {
        const r = s.readings.find((y) => y.nozzle_id === x.nozzle_id)!;
        const n = d.nozzles.find((y) => y.id === x.nozzle_id);
        out.nozzles.push([s.shift_no, n ? nozzleLabel(n) : x.nozzle_id, d.names(x.item_id), r.opening, r.closing ?? '', r.test_l, x.litres, x.segs.map((g) => g.rsp).join(' / '), x.value]);
        const p = prod.get(x.item_id) ?? { l: 0, v: 0 };
        prod.set(x.item_id, { l: r3(p.l + x.litres), v: round2(p.v + x.value) });
      }
      for (const c of s.collections) modes[c.mode] = round2((modes[c.mode] ?? 0) + c.amount);
      out.credit = round2(out.credit + [...billed.slips.values()].reduce((v, x) => v + x.amount, 0));
      for (const a of settleShift(s, sales, billed)) out.people.push([s.shift_no, a.name, a.expected, a.collected, a.diff]);
    } catch (e) {
      out.errors.push(`#${s.shift_no}: ${(e as Error).message}`);
    }
  }
  out.products = [...prod].map(([id, p]) => [d.names(id), p.l, p.l ? round2(p.v / p.l) : 0, p.v]);
  out.modes = MODES.filter((m) => modes[m]).map((m) => [m, modes[m]!]);
  return out;
}
