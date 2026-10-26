/**
 * R7-B6 cancellation and no-show charges. The rate plan's policy (`free_until_hours` before check-in time; charge
 * `none | first_night | pct | full`; no-show `first_night | full | none`) gives the charge from the booking's nightly
 * snapshot. Each part keeps the unit-night value it replaces, so the invoice (built through B3) taxes it at that
 * night's band (F8, D13 — "pct" takes the band of the booked night value, not of the charge). The booking's advances
 * are applied to the invoice and what is left is refunded with the existing refund voucher (`RFV`, Rule 51). A waiver
 * or an edited amount needs a reason; a waived charge makes no invoice. A company-guaranteed booking with no advance
 * is invoiced to the company on credit. Working paper — verify with your CA.
 */
import type { CancelPolicy, Folio, FolioLine, RatePlan, Reservation } from '../../types/hotel-r7';
import type { InvoiceRecord } from '../../types/invoice';
import { generateId } from '../storage';
import { round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { withTablesRollback } from '../table-txn';
import { todayIso } from '../tax-rules';
import { loadAdvances, refundAdvance, advanceBalance } from '../advances';
import { localDb } from '../localDb';
import { hotelDb } from './hotel-store';
import { HotelError } from './reservations';
import { SAVE_TABLES, advancesFor, draftFor, saveAndSettle } from './checkout-save';

export interface ChargePart {
  line_id: string;
  night: string;
  /** The unit-night value the part replaces (its band). */
  value: number;
  amount: number;
}

const NO_POLICY: CancelPolicy = { free_until_hours: 0, charge: 'none', no_show: 'none' };

/** Hours from `at` to check-in time on the arrival day (local). */
export function hoursBefore(arrival: string, checkinTime: string, at: Date): number {
  const [h, m] = (checkinTime || '12:00').split(':').map(Number);
  const due = new Date(Number(arrival.slice(0, 4)), Number(arrival.slice(5, 7)) - 1, Number(arrival.slice(8, 10)), h || 0, m || 0);
  return (due.getTime() - at.getTime()) / 3_600_000;
}

/** The policy charge of a cancelled / no-show booking (pure). */
export function cancelCharge(res: Pick<Reservation, 'arrival' | 'lines'>, plans: readonly Pick<RatePlan, 'id' | 'policy'>[], kind: 'cancelled' | 'no_show', at: Date, checkinTime: string): { amount: number; parts: ChargePart[]; free: boolean } {
  const parts: ChargePart[] = [];
  let free = false;
  for (const l of res.lines) {
    if (l.comp || l.status === 'checked_in' || l.status === 'checked_out' || !l.nightly.length) continue;
    const p = plans.find((x) => x.id === l.rate_plan_id)?.policy ?? NO_POLICY;
    const rule = kind === 'no_show' ? p.no_show : p.charge;
    if (kind === 'cancelled' && hoursBefore(l.arrival || res.arrival, checkinTime, at) >= (p.free_until_hours || 0)) {
      free = true;
      continue;
    }
    const nights = rule === 'first_night' ? l.nightly.slice(0, 1) : rule === 'full' || rule === 'pct' ? l.nightly : [];
    const share = rule === 'pct' ? Math.min(Math.max(Number(p.pct) || 0, 0), 100) / 100 : 1;
    for (const n of nights) parts.push({ line_id: l.id, night: n.night, value: n.total, amount: round2(n.total * share) });
  }
  return { amount: round2(parts.reduce((s, x) => s + x.amount, 0)), parts: parts.filter((x) => x.amount > 0), free };
}

export interface CancelInput {
  /** Edited charge (needs a reason when it differs from the policy). */
  amount?: number;
  waive?: boolean;
  reason?: string;
  /** Refund the advance left over (method / bank). */
  refund?: { method: string; bankAccountId?: string };
  at?: Date;
}

/** Charge (or waive) the cancellation / no-show of a closed booking: invoice, advance applied, rest refunded. */
export function chargeCancellation(resId: string, input: CancelInput = {}): { res: Reservation; invoice?: InvoiceRecord } {
  requireAccess('doc.create');
  const at = input.at ?? new Date();
  const res = hotelDb.reservation(resId);
  if (!res || (res.status !== 'cancelled' && res.status !== 'no_show')) throw new HotelError('Cancel the booking (or mark the no-show) first.');
  if (res.cancellation) throw new HotelError(`${res.number}: the charge is already settled.`);
  const kind = res.status;
  const hs = hotelDb.settings();
  const day = hs.business_date;
  const calc = cancelCharge(res, hotelDb.ratePlans(), kind, at, hs.checkin_time);
  const reason = (input.reason ?? '').trim();
  const amount = input.waive ? 0 : round2(input.amount ?? calc.amount);
  if ((input.waive || amount !== calc.amount) && !reason) throw new HotelError('Give a reason for the waiver or the new amount.');
  let parts = calc.parts;
  if (amount > 0 && amount !== calc.amount) {
    const first = res.lines.find((l) => l.nightly.length && !l.comp);
    if (!parts.length && first) parts = [{ line_id: first.id, night: first.nightly[0].night, value: first.nightly[0].total, amount }];
    const k = amount / (parts.reduce((s, x) => s + x.amount, 0) || 1);
    parts = parts.map((x) => ({ ...x, amount: round2(x.amount * k) }));
    parts[parts.length - 1].amount = round2(parts[parts.length - 1].amount + amount - parts.reduce((s, x) => s + x.amount, 0));
  }
  return withTablesRollback(SAVE_TABLES, () => {
    let invoice: InvoiceRecord | undefined;
    const advIds = new Set(res.advance_ids ?? []);
    const company = res.guarantee === 'company' && res.bill_to && !advIds.size;
    const folio: Folio = {
      id: generateId(), name: `${res.number} · ${kind === 'no_show' ? 'No-show' : 'Cancellation'}`, reservation_id: res.id, window: 1, opened_on: day, status: 'open',
      payer: company ? { kind: 'client', client_id: res.bill_to!.client_id, name: res.bill_to!.name } : { kind: 'guest', name: res.guest.name },
      lines: parts.map((x): FolioLine => ({
        id: generateId(), date: day, kind: kind === 'no_show' ? 'no_show' : 'cancellation', qty: 1, rate: x.amount, amount: x.amount, band_value: x.value, sac: hs.sac_room,
        desc: `${kind === 'no_show' ? 'No-show' : 'Cancellation'} charge · ${res.number}`, src: { night: x.night, line_id: x.line_id },
      })),
    };
    if (amount > 0) {
      const draft = draftFor(folio, day);
      const adv = advancesFor(folio, res).filter((a) => advIds.has(a.id)).map((a) => ({ id: a.id, amount: a.open }));
      invoice = saveAndSettle(draft.record, { advances: adv }, todayIso(at));
      hotelDb.putFolios({ ...folio, status: 'invoiced', invoice_ids: [invoice.id], lines: folio.lines.map((l) => ({ ...l, src: { ...l.src, invoice_id: invoice!.id } })) });
    }
    let refund_id: string | undefined;
    if (input.refund) {
      const pays = localDb.payments.getAll();
      const invs = localDb.invoices.getAll();
      for (const a of loadAdvances().filter((x) => advIds.has(x.id))) {
        const open = advanceBalance(a, pays, invs).open;
        if (open > 0.004) refund_id ??= refundAdvance(a.id, { amount: open, date: day, method: input.refund.method, bankAccountId: input.refund.bankAccountId, note: `${res.number} ${kind}` }, { today: todayIso(at) > day ? todayIso(at) : day }).id;
      }
    }
    const next: Reservation = { ...res, cancellation: { on: day, charge: amount, ...(input.waive ? { waived: true } : {}), ...(reason ? { reason } : {}), ...(invoice ? { invoice_id: invoice.id } : {}), ...(refund_id ? { refund_id } : {}) }, updated_at: at.toISOString() };
    hotelDb.putReservations(next);
    return { res: next, invoice };
  });
}
