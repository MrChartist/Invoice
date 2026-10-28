/**
 * R15 sample rows of the travel profile (Demo company only, R6-B4). Dispatched by the Demo company's packs (`travel` /
 * `events`); one block per package (§6 of docs/prd/round-15.md). Pure.
 */
import type { InvoiceRecord } from '../../types/invoice';
import { applyTotals, type Demo, type DemoExtras } from '../demo-data';
import type { TravelBooking, TvComponent } from '../../types/travel-r15';
import { shiftDay } from '../dates';
import { buildInvoiceNumber, getIndianFY } from '../invoice-number';
import type { ProfileContext } from './profiles';

export function travelExtras(ctx: ProfileContext): DemoExtras {
  const { today, base } = ctx;
  const tables: NonNullable<DemoExtras['tables']> = {};
  // R15-B: a Goa package for a family of four under the 5 % regime, with three bookings (hotel, cab, flights held).
  const from = shiftDay(today, 20);
  const at = `${today}T09:00:00.000Z`;
  const code = (d: string, n: number) => `${d.slice(2, 4)}${d.slice(5, 7)}-00${n}`;
  const cc = (id: string, name: string, d: string, tv: object) => ({ id, demo: true, name, kind: 'project', client_id: base.clients[0]?.id, active: true, status: 'active', start: d, created_at: at, tv: { status: 'confirmed', start: d, end: shiftDay(d, 5), pax: [], ...tv } });
  tables.cost_centres = [cc('demo-trip-1', 'Goa — Mehta family (demo)', from, { code: code(from, 1), kind: 'trip', scope: 'domestic', destination: 'Goa', regime: 'to5', pax: ['Ravi Mehta', 'Asha Mehta', 'Kabir Mehta', 'Mira Mehta'].map((name, i) => ({ name, type: i > 1 ? 'child' : 'adult' })) })] as never[];
  const b = (id: string, component: TvComponent, cost: number, sell: number, status: TravelBooking['status'], ref: string, trip = 'demo-trip-1', start = from, vendor_id?: string): TravelBooking & { demo: true } => ({ id, demo: true, trip_id: trip, component, start, end: shiftDay(start, 5), cost, sell, status, ref, created_at: at, ...(vendor_id ? { vendor_id } : {}) });
  tables.travel_bookings = [b('demo-tb-1', 'hotel', 42000, 50000, 'confirmed', 'Resort 5 nights (demo)'), b('demo-tb-2', 'transfer', 6000, 7500, 'confirmed', 'Cab, airport and sightseeing (demo)'), b('demo-tb-3', 'air', 38000, 42500, 'held', 'PNR DEMO12')];
  // R16-C4: an event with a budget and three vendors; an outbound Dubai package (after 1 Apr 2026) with 2 % TCS; a BSP statement.
  const ev = shiftDay(today, 40), dx = today > '2026-04-01' ? shiftDay(today, 30) : '2026-04-15', v = [...base.vendors.map((x) => x.id).slice(0, 2), 'demo-tv-v1'];
  tables.vendors = [{ id: 'demo-tv-v1', demo: true, name: 'Bloom Decor (demo)', tv: { kind: 'other' }, created_at: at }] as never[];
  tables.cost_centres.push(cc('demo-event-1', 'Sharma wedding (demo)', ev, { code: code(ev, 2), kind: 'event', scope: 'domestic', regime: 'to18', event: { venue: 'Lake Palace lawns', city: 'Udaipur', state: 'Rajasthan', date_from: ev, guests: 300, budget: [['venue', 300000], ['catering', 450000], ['decor', 150000]].map(([head, approved]) => ({ head, approved })) } }) as never, cc('demo-trip-2', 'Dubai — Iyer family (demo)', dx, { code: code(dx, 3), kind: 'trip', scope: 'outbound', destination: 'Dubai', regime: 'to5' }) as never);
  tables.travel_bookings.push(b('demo-tb-4', 'venue', 280000, 320000, 'confirmed', 'Lawns (demo)', 'demo-event-1', ev, v[0]), b('demo-tb-5', 'catering', 470000, 520000, 'confirmed', '300 covers (demo)', 'demo-event-1', ev, v[1]), b('demo-tb-6', 'decor', 120000, 140000, 'held', 'Floral (demo)', 'demo-event-1', ev, v[2]), b('demo-tb-7', 'package', 140000, 150000, 'confirmed', 'DXB land package (demo)', 'demo-trip-2', dx));
  const inv: Demo<InvoiceRecord> = applyTotals({
    ...base.invoices[0], id: 'demo-tv-inv-1', demo: true, doc_type: 'TAX_INVOICE', status: 'Sent', invoice_number: buildInvoiceNumber('DEMOTV', getIndianFY(today).label, 1), issue_date: today, due_date: shiftDay(today, 7), cost_centre_id: 'demo-trip-2', amount_paid: 0, notes: 'Sample overseas tour package (demo).',
    items: [{ id: 'demo-tv-inv-1-l1', name: 'Tour package — Dubai (demo)', type: 'Service', hsn: '998555', unit: 'NOS', quantity: 1, rate: 150000, amount: 150000, tax_rate: 5, discount_percent: 0 }],
    tcs_enabled: true, tcs_rate: 2, tcs_base: 'total', tcs_label: 'Sec 394(1) Sl. 8 — overseas tour package 2 %', tv: { trip: { id: 'demo-trip-2', code: code(dx, 3), destination: 'Dubai' }, regime: 'to5', tcs: { rate: 2, base: 157500, label: 'Sec 394(1) Sl. 8 — overseas tour package 2 %' } },
  } as Demo<InvoiceRecord>);
  const r = (doc_no: string, type: string, gross: number, net: number, status: string, flag?: string) => ({ doc_no, type, date: today, gross, taxes: 0, commission: 0, net, status, ...(flag ? { flag } : {}) });
  tables.supplier_statements = [{ id: 'demo-st-1', demo: true, vendor_id: v[0], kind: 'bsp', period_start: shiftDay(today, -15), period_end: today, ref: 'BSP demo', created_at: at, totals: { gross: 20500, taxes: 0, commission: 0, net: 20500 }, rows: [r('0981234567890', 'TKTT', 12000, 12000, 'matched'), r('0981234567891', 'TKTT', 9000, 9000, 'matched'), r('ADM-0001', 'ADMA', 2000, 2000, 'diff', 'adm'), r('0981234567880', 'RFND', 2500, 2500, 'matched', 'refund')] }] as never;
  return { invoices: [inv], tables };
}
