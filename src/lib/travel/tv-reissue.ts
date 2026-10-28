/**
 * R16-C2 ticket re-issue on an `air` booking's ticket: a new ticket number, the fare difference (pure agent), the
 * airline's change penalty (pure agent, `charge_head_id: 'rule33'`) and our re-issue fee (18 % at the C1 airline SAC,
 * `COMMISSION_SAC_RULES`) as a draft invoice through the R3-B draft builder, with the new ticket's particulars in
 * `tv.lines`. The original ticket is marked `reissued_by` on the booking; its line stays on the old invoice. No credit
 * note, unless the fare difference is negative: then `documents.createCreditNote` credits that part of the old fare
 * line (the old invoice must be issued). All or nothing. Working papers — verify with your CA (TV35, TV47).
 */
import './tv-registry';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { TravelBooking, TvTicket } from '../../types/travel-r15';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { withTablesRollback } from '../table-txn';
import { createCreditNote } from '../documents';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { PURE_AGENT_CHARGE } from '../trade/pure-agent';
import { COMMISSION_SAC_RULES } from '../travel-rules';
import { loadBookings } from './tv-bookings';
import { tvSnapshot } from './tv-regime';
import { loadTrips } from './tv-trips';
import { TV_TABLES } from './tv-shared';

export interface ReissueInput { old_no: string; new_no: string; diff: number; penalty: number; fee: number; date: string }

const ln = (name: string, rate: number, o: Partial<InvoiceItem> = {}): InvoiceItem => ({ id: generateId(), name, type: 'Service', unit: 'NOS', quantity: 1, rate, amount: rate, tax_rate: 0, discount_percent: 0, ...o });

/** Pure: the re-issue lines (difference and penalty at actual, then our fee) and the new ticket on the first line. */
export function reissueLines(old: TvTicket, i: ReissueInput): { items: InvoiceItem[]; tkt: TvTicket } {
  const pa = { description: PURE_AGENT_CHARGE, charge_head_id: 'rule33' };
  const tag = `${old.sector ? `${old.sector} ` : ''}(re-issue ${i.new_no})`;
  const items = [
    ...(i.diff > 0 ? [ln(`Fare difference — ${tag}`, round2(i.diff), pa)] : []),
    ...(i.penalty > 0 ? [ln(`Airline change penalty — ${tag}`, round2(i.penalty), pa)] : []),
    ...(i.fee > 0 ? [ln('Re-issue fee', round2(i.fee), { hsn: ruleAt(COMMISSION_SAC_RULES, i.date).sac.airline, tax_rate: ruleAt(COMMISSION_SAC_RULES, i.date).rate })] : []),
  ];
  const { basic: _b, taxes: _t, airline_gst: _g, reissued_by: _r, ...rest } = old;
  void _b; void _t; void _g; void _r;
  return { items, tkt: { ...rest, ticket_no: i.new_no, reissue_of: old.ticket_no } };
}

/** Re-issue a booking's ticket (`doc.create`): the draft (null when only a refund) and the credit note when the difference is negative. */
export function reissueTicket(bookingId: string, i: ReissueInput): { draft: InvoiceRecord | null; credit: InvoiceRecord | null } {
  requireAccess('doc.create');
  const b = loadBookings().find((x) => x.id === bookingId);
  const old = b?.tkt?.find((t) => t.ticket_no && t.ticket_no === i.old_no);
  if (!b || !old) throw new Error('This ticket is no longer on the booking.');
  if (old.reissued_by) throw new Error('This ticket is re-issued already.');
  const no = i.new_no.replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(no) || no === old.ticket_no) throw new Error('Enter the new ticket no. (13 digits).');
  if (i.penalty < 0 || i.fee < 0) throw new Error('Penalty and fee cannot be negative.');
  const inp = { ...i, new_no: no };
  const { items, tkt } = reissueLines(old, inp);
  const prev = b.line_ref && localDb.invoices.getById(b.line_ref.invoice_id);
  const fareLine = prev ? Object.entries(prev.tv?.lines ?? {}).find(([, v]) => v.tkt?.ticket_no === old.ticket_no)?.[0] : undefined;
  const line = prev?.items.find((l) => l.id === fareLine);
  if (i.diff < 0 && (!prev || !line)) throw new Error('The old ticket is not on an invoice: nothing to credit.');
  if (!items.length && !(i.diff < 0)) throw new Error('Enter the fare difference, penalty or fee.');
  const trip = loadTrips().find((t) => t.id === b.trip_id);
  const sender = localDb.settings.activeProfile() ?? null;
  const base = makeDraft({ settings: localDb.settings.get(), sender, docType: 'INVOICE', templateId: localDb.template.get() });
  const client = (trip?.client_id && localDb.clients.getById(trip.client_id)) || prev?.client || { ...blankClient(), name: trip?.name ?? '' };
  const tv = { ...(trip ? tvSnapshot(trip, 'agent', i.date) : { regime: 'agent' as const }), ...(items[0] ? { lines: { [items[0].id]: { tkt } } } : {}) };
  return withTablesRollback(['invoices', 'doc_links', 'series_counters', TV_TABLES.bookings], () => {
    const credit = i.diff < 0 ? createCreditNote(prev!, { lines: [{ itemId: line!.id, quantity: round2(-i.diff / line!.rate) }], reason: 'Ticket re-issued — fare difference refunded', goodsReturned: false, date: i.date }) : null;
    const draft = items.length ? localDb.invoices.save(buildBillDraft({ ...base, id: generateId(), issue_date: i.date, ...(trip ? { cost_centre_id: trip.id } : {}), tv }, client, items, sender)) : null;
    const now = new Date().toISOString();
    setTable(TV_TABLES.bookings, getTable<TravelBooking>(TV_TABLES.bookings).map((x) => (x.id === b.id ? { ...x, tkt: [...(x.tkt ?? []).map((t) => (t.ticket_no === old.ticket_no ? { ...t, reissued_by: no } : t)), tkt], updated_at: now } : x)));
    return { draft, credit };
  });
}
