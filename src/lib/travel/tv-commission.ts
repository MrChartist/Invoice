/**
 * R16-C1 commission income: "Bill commission" on a booking with `commission` makes a draft invoice TO THE PRINCIPAL
 * (airline / hotel / insurer — the booking's supplier, or the client linked to it, `Vendor.client_id`) through the
 * R3-B draft builder: one line at the principal's SAC and 18 % (`COMMISSION_SAC_RULES`, TV16 / TV46). The TDS the
 * principal is expected to deduct is set on the draft through the R14-D receivable path (`expectedTds`: 194H from
 * `tds-rules.ts` on the commission before GST, by the principal's FY total; an insurer deducts 194D,
 * `INSURANCE_COMMISSION_TDS_RULES`), so the receipt reaches the TDS receivable register and the 16A / 131 chase list. An
 * insurer's invoice carries the existing outward reverse-charge flag (TV17). The booking keeps `comm_ref`; billed is
 * derived from it (the line must still be on a live invoice). The trip margin is unchanged (it already counts the typed
 * commission). Working papers — verify with your CA.
 */
import './tv-registry';
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { Vendor } from '../../types/purchases';
import type { ClientTdsDefault } from '../../types/prof-r14';
import type { TravelBooking } from '../../types/travel-r15';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { withTablesRollback } from '../table-txn';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { expectedTds, type ExpectedTds } from '../prof/ps-tds-recv';
import { COMMISSION_SAC_RULES, INSURANCE_AGENT_RCM_RULES, INSURANCE_COMMISSION_TDS_RULES, type TvPrincipal } from '../travel-rules';
import { isBilled, liveLines, loadBookings } from './tv-bookings';
import { loadTrips } from './tv-trips';
import { TV_TABLES } from './tv-shared';

/** Who pays the commission: insurance → insurer; air → airline; hotel (or a hotel / bed-bank supplier) → hotel. */
export function principalOf(b: Pick<TravelBooking, 'component'>, v?: Pick<Vendor, 'tv'>): TvPrincipal {
  const k = v?.tv?.kind;
  return b.component === 'insurance' ? 'insurer' : b.component === 'air' || k === 'airline' ? 'airline' : b.component === 'hotel' || k === 'hotel' || k === 'bedbank' ? 'hotel' : 'other';
}

export const commBilled = (b: Pick<TravelBooking, 'comm_ref'>, live: ReadonlySet<string>): boolean => isBilled({ line_ref: b.comm_ref }, live);

/** The principal as a client: the client linked to the supplier (netting link), else the supplier's own particulars. */
function principalClient(v: Vendor): Client {
  const c = v.client_id ? localDb.clients.getById(v.client_id) : undefined;
  return c ?? { ...blankClient(), name: v.name, company: v.name, gstin: v.gstin ?? '', address: v.address ?? '', state_code: v.state_code ?? '', email: v.email ?? '', phone: v.phone ?? '' };
}

/** TDS the principal is expected to deduct (null = none): 194H, or 194D for an insurer (its own rate and threshold). */
export function commissionTds(p: TvPrincipal, client: Pick<Client, 'id' | 'name'>, date: string, base: number, invoices: readonly InvoiceRecord[], excludeId?: string): ExpectedTds | null {
  const ins = p === 'insurer' ? ruleAt(INSURANCE_COMMISSION_TDS_RULES, date) : null;
  const co = getTable<{ entity_type?: string }>('notes_to_accounts').some((r) => r?.entity_type === 'company');
  const e = expectedTds({ client, def: { section: ins ? '194D' : '194H', ...(ins ? { rate: co ? ins.company : ins.other } : {}) } as ClientTdsDefault, date, base, invoices, ourForm: co ? 'company' : 'proprietorship', excludeId });
  if (!e || !ins) return e;
  const applies = e.fyBefore + e.base > ins.aggregate;
  return { ...e, applies, threshold: ins.aggregate, amount: applies ? round2((e.base * e.rate) / 100) : 0 };
}

/** "Bill commission" (`doc.create`): the draft invoice to the principal and its expected TDS. All or nothing. */
export function billCommission(bookingId: string, date?: string): { invoice: InvoiceRecord; tds: ExpectedTds | null } {
  requireAccess('doc.create');
  const b = loadBookings().find((x) => x.id === bookingId);
  if (!b) throw new Error('This booking is no longer on the list.');
  const amount = round2(Number(b.commission) || 0);
  if (!(amount > 0)) throw new Error('No commission on this booking.');
  const all = localDb.invoices.getAll();
  if (commBilled(b, liveLines(all))) throw new Error('This commission is billed already.');
  const v = getTable<Vendor>('vendors').find((x) => x.id === b.vendor_id);
  if (!v) throw new Error('Pick the supplier (the principal) first.');
  const p = principalOf(b, v);
  const trip = loadTrips().find((t) => t.id === b.trip_id);
  const sender = localDb.settings.activeProfile() ?? null;
  const base = makeDraft({ settings: localDb.settings.get(), sender, docType: 'INVOICE', templateId: localDb.template.get() });
  const day = date ?? base.issue_date;
  const rule = ruleAt(COMMISSION_SAC_RULES, day);
  const client = principalClient(v);
  const item = { id: generateId(), name: `Commission: ${b.component} ${b.ref ?? ''}`.trim(), description: trip ? `${trip.tv.code}: ${trip.name}` : '', type: 'Service' as const, hsn: rule.sac[p], unit: 'NOS', quantity: 1, rate: amount, amount, tax_rate: rule.rate, discount_percent: 0 };
  const tds = commissionTds(p, client, day, amount, all);
  const rcm = p === 'insurer' && ruleAt(INSURANCE_AGENT_RCM_RULES, day);
  const draft = buildBillDraft({
    ...base, id: generateId(), issue_date: day, ...(trip ? { cost_centre_id: trip.id, tv: { trip: { id: trip.id, code: trip.tv.code, kind: trip.tv.kind } } } : {}),
    ...(tds?.applies ? { tds_enabled: true, tds_section: tds.code, tds_rate: tds.rate, tds_on_taxable: true } : {}),
    ...(rcm ? { reverse_charge: true, rcm_tax_excluded: true } : {}),
  }, client, [item], sender);
  return withTablesRollback(['invoices', TV_TABLES.bookings], () => {
    const invoice = localDb.invoices.save(draft);
    setTable(TV_TABLES.bookings, getTable<TravelBooking>(TV_TABLES.bookings).map((x) => (x.id === b.id ? { ...x, comm_ref: { invoice_id: invoice.id, line_id: item.id }, updated_at: new Date().toISOString() } : x)));
    return { invoice, tds };
  });
}
