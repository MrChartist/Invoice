/**
 * PENDING 14 (CN-C / CN-D leftovers), from the Realty desk:
 *  - **Broker commission bill**: a booking's broker (vendor + %) → a purchase-bill DRAFT (`purchase_drafts`, not in the
 *    books until posted, 8C) of the commission on the agreement value: SAC 997222 (building sales on a fee /
 *    commission basis), GST 18 % when the broker has a GSTIN (IGST when its State differs from ours), TDS u/s 194H
 *    deducted on the bill (`sectionRate('194H')`, labelled by date through `ita2025`). Linked on the booking
 *    (`broker.draft_id`), once.
 *  - **Demand reminders through follow-ups**: one R2-A follow-up (`collection_notes`, kind WhatsApp) for the buyer with
 *    the open demand amount and a next action a week later — Receivables' follow-up lists and bell pick it up.
 * Working paper — verify with your CA.
 */
import './cn-registry';
import type { RealtyBooking } from '../../types/construction-r11';
import type { PurchaseRecord } from '../../types/purchases';
import { requireAccess } from '../access';
import { round2 } from '../invoice-calc';
import { sectionRate } from '../tds-rules';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { vendorsDb } from '../vendors';
import { draftsDb, PURCHASE_DRAFTS_TABLE, type PurchaseDraft } from '../purchase-drafts';
import { saveFollowUp, shiftDay, type CollectionNote } from '../collections';
import { RT, upsert } from './cn-realty-projects';
import { live, loadBookings } from './cn-bookings';

export const SAC_BROKERAGE = '997222';
export const BROKERAGE_GST = 18;

/** Commission due to the booking's broker (% of the agreement value), or null. */
export function brokerageDue(b: Pick<RealtyBooking, 'broker' | 'agreement_value'>): { pct: number; amount: number } | null {
  const pct = Number(b.broker?.pct) || 0;
  if (!(pct > 0) || !(b.agreement_value > 0)) return null;
  return { pct, amount: round2((b.agreement_value * pct) / 100) };
}

/** The broker's bill (pure; a `PurchaseRecord` without id). */
export function brokerageBill(c: { vendor: { id?: string; name: string; gstin?: string }; amount: number; date: string; home: string; ref: string }): Omit<PurchaseRecord, 'id'> {
  const gstin = (c.vendor.gstin ?? '').trim().toUpperCase();
  const taxable = round2(c.amount);
  const gst = gstin ? round2((taxable * BROKERAGE_GST) / 100) : 0;
  const inter = !!gstin && gstin.slice(0, 2) !== c.home;
  const half = round2(gst / 2);
  const rate = sectionRate('194H', c.date);
  return {
    kind: 'EXPENSE', vendor_name: c.vendor.name, ...(c.vendor.id ? { vendor_id: c.vendor.id } : {}), ...(gstin ? { vendor_gstin: gstin } : {}),
    bill_number: '', date: c.date, place_of_supply: c.home, category: 'Commission',
    lines: [{ id: 'brokerage', name: `Brokerage · ${c.ref}`, hsn: SAC_BROKERAGE, unit: 'NOS', quantity: 1, rate: taxable, tax_rate: gst ? BROKERAGE_GST : 0 }],
    taxable, igst: inter ? gst : 0, cgst: inter ? 0 : half, sgst: inter ? 0 : round2(gst - half),
    itc_eligible: gst > 0, total: round2(taxable + gst), amount_paid: 0,
    ...(rate ? { tds_section: '194H', tds_rate: rate, tds_base: taxable, tds_amount: round2((taxable * rate) / 100), tds_on: 'BILL' as const } : {}),
    notes: 'Broker commission on a booking (194H). Working paper — verify with your CA.',
  };
}

/** "Broker bill" on a booking: the draft bill, linked on the booking (once). */
export function recordBrokerage(bookingId: string, date: string): PurchaseDraft {
  requireAccess('doc.create');
  const b = loadBookings().find((x) => x.id === bookingId);
  if (!b || !live(b)) throw new Error('Booking not found.');
  if (b.broker?.draft_id) throw new Error(`${b.number}: the broker's bill is already drafted.`);
  const due = brokerageDue(b);
  const v = b.broker?.vendor_id ? vendorsDb.all().find((x) => x.id === b.broker!.vendor_id) : undefined;
  const name = v?.name || b.broker?.name?.trim();
  if (!due || !name) throw new Error('Set the broker and the commission % on the booking first.');
  const sender = localDb.settings.activeProfile();
  const home = sender?.stateCode || String(sender?.companyGstin ?? '').slice(0, 2);
  const bill = brokerageBill({ vendor: { id: v?.id, name, gstin: v?.gstin }, amount: due.amount, date, home, ref: `${b.number} · ${b.client_name}` });
  return withTablesRollback([PURCHASE_DRAFTS_TABLE, RT.bookings], () => {
    const d = draftsDb.save({ ...bill, draft: { source: 'manual', created_at: new Date().toISOString() } });
    upsert(RT.bookings, { ...b, broker: { ...b.broker!, draft_id: d.id }, updated_at: new Date().toISOString() });
    return d;
  });
}

/** "Remind" on a booking with open demands: a follow-up for the buyer, next action in `days` days. */
export function remindDemand(bookingId: string, open: number, today: string, days = 7): CollectionNote {
  const b = loadBookings().find((x) => x.id === bookingId);
  if (!b || !live(b)) throw new Error('Booking not found.');
  if (!(open > 0)) throw new Error(`${b.number}: nothing is due.`);
  return saveFollowUp({
    party_key: b.client_id || `name:${b.client_name.trim().toLowerCase()}`, party_name: b.client_name, kind: 'whatsapp',
    outcome: `Demand reminder for ${b.number}: ₹${round2(open).toLocaleString('en-IN', { minimumFractionDigits: 2 })} open.`,
    date: today, next_action: { date: shiftDay(today, days) },
  });
}
