/**
 * R15-B2 "Bill": a draft invoice of a trip's unbilled, uncancelled bookings in the trip's regime, through the existing
 * draft builder (`buildBillDraft`, the R3-B "Unbilled → Bill" path), with the `tv` snapshot (trip, regime, sentence). `to5` / `to18` / `exempt_outside`: one gross package line (SAC and rate from the rule by date; exempt =
 * the R10 `sv.exempt` column). `agent`: one service-fee line (sell less what is recovered) plus one pure-agent line per
 * pass-through booking (`charge_head_id: 'rule33'`, `PURE_AGENT_CHARGE`, cost at actual). Each booking's `line_ref`
 * points at its line; billed state is derived from it. All or nothing. Working papers — verify with your CA (TV8–TV14).
 */
import './tv-registry';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { TravelBooking } from '../../types/travel-r15';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { round2 } from '../invoice-calc';
import { withTablesRollback } from '../table-txn';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { PURE_AGENT_CHARGE } from '../trade/pure-agent';
import { costInr, isBilled, liveLines, loadBookings } from './tv-bookings';
import { regimeRule, tvSnapshot } from './tv-regime';
import { loadTrips } from './tv-trips';
import { TV_TABLES } from './tv-shared';

const line = (p: Omit<InvoiceItem, 'id' | 'amount' | 'type' | 'discount_percent'>): InvoiceItem => ({ id: generateId(), type: 'Service', discount_percent: 0, unit: 'NOS', ...p, amount: round2(p.quantity * p.rate) });

/** Pure: the lines of a trip's bill and the line each booking goes on. */
export function tripLines(name: string, regime: NonNullable<InvoiceRecord['tv']>['regime'] & string, date: string, open: readonly TravelBooking[]): { items: InvoiceItem[]; refs: Map<string, string> } {
  const rule = regimeRule(regime, date);
  const refs = new Map<string, string>();
  const items: InvoiceItem[] = [];
  const pass = regime === 'agent' ? open.filter((b) => b.pure_agent) : [];
  for (const b of pass) {
    const l = line({ name: `${b.component.toUpperCase()}: ${b.ref || name} (at actual)`, description: PURE_AGENT_CHARGE, charge_head_id: 'rule33', quantity: 1, rate: costInr(b), tax_rate: 0 });
    items.push(l);
    refs.set(b.id, l.id);
  }
  const rest = open.filter((b) => !pass.includes(b));
  const value = round2(open.reduce((s, b) => s + (Number(b.sell) || 0), 0) - pass.reduce((s, b) => s + costInr(b), 0));
  if (value > 0) {
    const main = line({
      name: regime === 'agent' ? `Service charge: ${name}` : `Tour package: ${name}`,
      hsn: rule.sac, quantity: 1, rate: value, tax_rate: rule.rate,
      ...(regime === 'exempt_outside' ? { sv: { exempt: 'EXEMPT' as const } } : {}),
    });
    items.unshift(main);
    for (const b of rest) refs.set(b.id, main.id);
  }
  return { items, refs };
}

/** Create the draft invoice of a trip (`doc.create`). Throws when nothing is left to bill. */
export function billTrip(tripId: string, date?: string): InvoiceRecord {
  requireAccess('doc.create');
  const trip = loadTrips().find((t) => t.id === tripId);
  if (!trip) throw new Error('This trip is no longer on the list.');
  const live = liveLines(localDb.invoices.getAll());
  const all = loadBookings(tripId);
  const open = all.filter((b) => b.status !== 'cancelled' && !isBilled(b, live));
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile() ?? null;
  const base = makeDraft({ settings, sender, docType: 'INVOICE', templateId: localDb.template.get() });
  const day = date ?? base.issue_date;
  const { items, refs } = tripLines(`${trip.tv.destination || trip.name} (${trip.tv.code})`, trip.tv.regime, day, open);
  if (!items.length) throw new Error('Nothing to bill on this trip yet.');
  const client = (trip.client_id && localDb.clients.getById(trip.client_id)) || { ...blankClient(), name: trip.name };
  const draft = buildBillDraft({ ...base, id: generateId(), issue_date: day, cost_centre_id: trip.id, tv: tvSnapshot(trip, trip.tv.regime, day) }, client, items, sender);
  return withTablesRollback(['invoices', TV_TABLES.bookings], () => {
    const saved = localDb.invoices.save(draft);
    const rows = getTable<TravelBooking>(TV_TABLES.bookings);
    setTable(TV_TABLES.bookings, rows.map((b) => (refs.has(b.id) ? { ...b, line_ref: { invoice_id: saved.id, line_id: refs.get(b.id)! } } : b)));
    return saved;
  });
}
