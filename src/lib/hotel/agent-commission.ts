/**
 * R7-B4 travel-agent (and OTA) commission bills. "Record commission" drafts a purchase bill for the agent
 * (`purchase_drafts`, not in the books until posted — 8C): SAC 998552 (reservation services), GST at 18% when the agent
 * has a GSTIN (IGST when its state differs from ours), 194H on the commission from the existing TDS-payable path
 * (`sectionRate('194H')`, deducted on the bill). ITC follows C1 (D12): blocked with a warning when every room-night of
 * the year so far is in the low (5%, no-ITC) band — the user decides. An OTA's commission netted from a payout carries
 * no 194H (the OTA side is 194-O, F14). Working paper — verify with your CA.
 */
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import type { Reservation } from '../../types/hotel-r7';
import { round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { sectionRate } from '../tds-rules';
import { draftsDb, PURCHASE_DRAFTS_TABLE, type PurchaseDraft } from '../purchase-drafts';
import { hotelDb, HT } from './hotel-store';
import { HotelError, reservationValue } from './reservations';
import { billKind } from './bill-to';

export const SAC_COMMISSION = '998552';
export const COMMISSION_GST = 18;
export const LOW_BAND_NOTE = 'ITC not available: every room-night this year is in the 5% (no ITC) band — verify with your CA.';

/** True when the FY's hotel invoices so far are all low-band (D12). */
export function fullyLowBand(invoices: readonly Pick<InvoiceRecord, 'hotel_band' | 'issue_date' | 'status'>[], day: string): boolean {
  const y = Number(day.slice(0, 4)) - (Number(day.slice(5, 7)) < 4 ? 1 : 0);
  const fy = invoices.filter((i) => i.hotel_band && i.status !== 'Cancelled' && i.issue_date >= `${y}-04-01` && i.issue_date <= `${y + 1}-03-31`);
  return fy.length > 0 && fy.every((i) => i.hotel_band === 'low');
}

/** Commission due on an agent booking (`Client.hotel.commission_pct` × booked room value before GST), or null. */
export function commissionDue(res: Reservation, agent?: Pick<Client, 'hotel'>): { pct: number; base: number; amount: number } | null {
  const pct = Number(agent?.hotel?.commission_pct) || 0;
  if (billKind(res) !== 'agent' || !(pct > 0)) return null;
  const base = reservationValue(res);
  return { pct, base, amount: round2((base * pct) / 100) };
}

export interface CommissionBillInput {
  vendor: { id?: string; name: string; gstin?: string };
  amount: number;
  /** GST on the commission (default 18% when the vendor has a GSTIN, else 0). */
  gst?: number;
  date: string;
  home: string;
  ref: string;
  lowBand: boolean;
  /** 194H on the bill (agents); false for an OTA netted from a payout. */
  tds194h: boolean;
}

/** The commission bill (pure; a `PurchaseRecord` without id). */
export function commissionBill(c: CommissionBillInput): Omit<PurchaseRecord, 'id'> {
  const gstin = (c.vendor.gstin ?? '').trim().toUpperCase();
  const taxable = round2(c.amount);
  const gst = round2(c.gst ?? (gstin ? (taxable * COMMISSION_GST) / 100 : 0));
  const inter = !!gstin && gstin.slice(0, 2) !== c.home;
  const half = round2(gst / 2);
  const rate = c.tds194h ? sectionRate('194H', c.date) : null;
  return {
    kind: 'EXPENSE', vendor_name: c.vendor.name, ...(c.vendor.id ? { vendor_id: c.vendor.id } : {}), ...(gstin ? { vendor_gstin: gstin } : {}),
    bill_number: '', date: c.date, place_of_supply: c.home, category: 'Commission',
    lines: [{ id: 'comm', name: `Commission · ${c.ref}`, hsn: SAC_COMMISSION, unit: 'NOS', quantity: 1, rate: taxable, tax_rate: taxable ? round2((gst / taxable) * 100) : 0 }],
    taxable, igst: inter ? gst : 0, cgst: inter ? 0 : half, sgst: inter ? 0 : round2(gst - half),
    itc_eligible: !c.lowBand && gst > 0, total: round2(taxable + gst), amount_paid: 0,
    ...(rate ? { tds_section: '194H', tds_rate: rate, tds_base: taxable, tds_amount: round2((taxable * rate) / 100), tds_on: 'BILL' as const } : {}),
    notes: [c.lowBand && gst > 0 ? LOW_BAND_NOTE : '', 'Working paper — verify with your CA.'].filter(Boolean).join(' '),
  };
}

/** "Record commission" on an agent booking: a purchase-bill draft for the agent, linked on the booking. */
export function recordCommission(resId: string, opts: { amount?: number; date?: string } = {}): PurchaseDraft {
  requireAccess('doc.create');
  const res = hotelDb.reservation(resId);
  if (!res) throw new HotelError('This booking no longer exists.');
  if (res.commission) throw new HotelError(`${res.number}: commission already recorded.`);
  const agent = res.bill_to ? localDb.clients.getById(res.bill_to.client_id) : undefined;
  const due = commissionDue(res, agent);
  const amount = round2(opts.amount ?? due?.amount ?? 0);
  if (!agent || !(amount > 0)) throw new HotelError('Set the agent (bill to) and its commission % first.');
  const date = opts.date || hotelDb.settings().business_date;
  const sender = localDb.settings.activeProfile();
  const home = sender?.stateCode || String(sender?.companyGstin ?? '').slice(0, 2);
  const bill = commissionBill({ vendor: { name: agent.company || agent.name, gstin: agent.gstin }, amount, date, home, ref: res.number, lowBand: fullyLowBand(localDb.invoices.getAll(), date), tds194h: true });
  return withTablesRollback([PURCHASE_DRAFTS_TABLE, HT.reservations], () => {
    const d = draftsDb.save({ ...bill, draft: { source: 'manual', created_at: new Date().toISOString() } });
    hotelDb.putReservations({ ...res, commission: { draft_id: d.id, amount, date } });
    return d;
  });
}
