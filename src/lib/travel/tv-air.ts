/**
 * R15-C1 tickets on an `air` booking: "Ticket" enters the tickets and makes a draft invoice of them in the agent
 * regime — one pure-agent fare line per ticket and the service line (Rule 32(3) deemed value or the actual fee, the
 * company's `travel_settings.air_value`, per document override) — through the R3-B draft builder; the booking keeps
 * its tickets and points at the first fare line (billed is derived from it, B2). All or nothing.
 * Working papers — verify with your CA (TV11, TV12, TV14).
 */
import './tv-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { TravelBooking, TvTicket } from '../../types/travel-r15';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { isBilled, liveLines, loadBookings } from './tv-bookings';
import { mergeTickets, validateTicket, type AirMethod } from './tv-air-value';
import { tvSnapshot } from './tv-regime';
import { loadTrips } from './tv-trips';
import { TV_TABLES } from './tv-shared';

/** Draft invoice of a booking's tickets (`doc.create`). Refused for a cancelled or billed booking. */
export function billTickets(bookingId: string, tickets: readonly TvTicket[], o: { method: AirMethod; fee: number; date?: string }): InvoiceRecord {
  requireAccess('doc.create');
  const b = loadBookings().find((x) => x.id === bookingId);
  if (!b) throw new Error('This booking is no longer on the list.');
  if (b.status === 'cancelled') throw new Error('This booking is cancelled.');
  if (isBilled(b, liveLines(localDb.invoices.getAll()))) throw new Error('This booking is billed already.');
  if (!tickets.length) throw new Error('Add a ticket.');
  const err = tickets.map(validateTicket).find(Boolean);
  if (err) throw new Error(err);
  const trip = loadTrips().find((t) => t.id === b.trip_id);
  const sender = localDb.settings.activeProfile() ?? null;
  const base = makeDraft({ settings: localDb.settings.get(), sender, docType: 'INVOICE', templateId: localDb.template.get() });
  const day = o.date ?? base.issue_date;
  const m = mergeTickets([], trip ? tvSnapshot(trip, 'agent', day) : { regime: 'agent' }, tickets, { ...o, date: day });
  const client = (trip?.client_id && localDb.clients.getById(trip.client_id)) || { ...blankClient(), name: trip?.name ?? '' };
  const draft = buildBillDraft({ ...base, id: generateId(), issue_date: day, ...(trip ? { cost_centre_id: trip.id } : {}), tv: m.tv }, client, m.items, sender);
  return withTablesRollback(['invoices', TV_TABLES.bookings], () => {
    const saved = localDb.invoices.save(draft);
    const kept = Object.values(m.tv.lines ?? {}).map((v) => v.tkt!).filter(Boolean);
    setTable(TV_TABLES.bookings, getTable<TravelBooking>(TV_TABLES.bookings).map((x) => (x.id === b.id ? { ...x, tkt: kept, line_ref: { invoice_id: saved.id, line_id: m.fareIds[0] }, updated_at: new Date().toISOString() } : x)));
    return saved;
  });
}
