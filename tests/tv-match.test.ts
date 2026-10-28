/**
 * R15-C2 statement match: matched / diff (> ₹1) / ADM / refund to pass on / missing / ours_only, ± 45 days; volume —
 * one year of 20,000 tickets and 26 fortnightly BSP statements: matching one reads only the invoices of its window.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchStatement, matchWindow } from '../src/lib/travel/tv-match.ts';
import type { StatementRow, TvTicket } from '../src/types/travel-r15.ts';

const tk = (n: number, over: Partial<TvTicket> = {}): TvTicket => ({ ticket_no: `058${String(n).padStart(10, '0')}`, pnr: `P${n}`, basic: 4000, taxes: 1000, airline_gst: 200, ...over });
const inv = (id: string, date: string, tickets: TvTicket[]) => ({
  id, doc_type: 'INVOICE' as const, status: 'Sent' as const, issue_date: date,
  items: tickets.map((_, i) => ({ id: `${id}-l${i}`, name: 'Air ticket', type: 'Service', quantity: 1, rate: 5200, amount: 5200 })),
  tv: { lines: Object.fromEntries(tickets.map((t, i) => [`${id}-l${i}`, { tkt: t }])) },
});
const row = (doc_no: string, type: string, gross: number, taxes = 1200): StatementRow => ({ doc_no, type, gross, taxes, commission: 0, net: gross + taxes });
const st = (rows: StatementRow[]) => ({ kind: 'bsp' as const, vendor_id: 'bsp', period_start: '2026-10-01', period_end: '2026-10-15', rows });

test('matched, diff, ADM, refund to pass on, missing, ours only', () => {
  const invoices = [inv('a', '2026-10-03', [tk(1), tk(2), tk(3)]), inv('b', '2026-10-05', [tk(4)]), inv('c', '2026-10-10', [tk(5)])];
  const rows = matchStatement(st([
    row('0000000001', 'TKTT', 4000), // last 10 digits, no airline prefix
    row('0580000000002', 'TKTT', 4500), // ₹500 more than our fare
    row('ADM-77', 'ADMA', 3500, 0),
    row('0580000000004', 'RFND', 4000),
    row('0580000000099', 'TKTT', 4000), // never billed
    row('p5', 'TKTT', 4000.5), // by PNR, within ₹1
  ]), { invoices, bookings: [], credited: new Set(['c']) });
  assert.deepEqual(rows.map((r) => [r.doc_no, r.status, r.flag ?? '']), [
    ['0000000001', 'matched', ''], ['0580000000002', 'diff', ''], ['ADM-77', 'diff', 'adm'], ['0580000000004', 'matched', 'refund'],
    ['0580000000099', 'missing', ''], ['p5', 'matched', ''], ['0580000000003', 'ours_only', ''],
  ]);
  assert.equal(rows[1].diff, -500);
  assert.deepEqual(rows[0].match, { kind: 'invoice_line', id: 'a:a-l0' });
});

test('± 45 days; bookings by ref for a consolidator; ours_only only for its own bookings', () => {
  assert.deepEqual(matchWindow({ period_start: '2026-10-01', period_end: '2026-10-15' }), { from: '2026-08-17', to: '2026-11-29' });
  const invoices = [inv('old', '2026-08-16', [tk(1)]), inv('in', '2026-08-17', [tk(2)])];
  const r = matchStatement(st([row('0580000000001', 'TKTT', 4000), row('0580000000002', 'TKTT', 4000)]), { invoices, bookings: [], credited: new Set() });
  assert.deepEqual(r.map((x) => x.status), ['missing', 'matched']);
  const bookings = [
    { id: 'b1', trip_id: 't', component: 'hotel', start: '2026-10-04', cost: 9000, sell: 10000, status: 'confirmed', ref: 'HB-1', vendor_id: 'hb', created_at: '' },
    { id: 'b2', trip_id: 't', component: 'hotel', start: '2026-10-06', cost: 5000, sell: 6000, status: 'confirmed', ref: 'HB-2', vendor_id: 'hb', created_at: '' },
    { id: 'b3', trip_id: 't', component: 'hotel', start: '2026-10-06', cost: 5000, sell: 6000, status: 'confirmed', ref: 'X-3', vendor_id: 'other', created_at: '' },
  ] as never;
  const c = matchStatement({ kind: 'bedbank', vendor_id: 'hb', period_start: '2026-10-01', period_end: '2026-10-15', rows: [row('hb-1', 'HOTEL', 9000, 0)] }, { invoices: [], bookings, credited: new Set() });
  assert.deepEqual(c.map((x) => [x.doc_no, x.status]), [['hb-1', 'matched'], ['HB-2', 'ours_only']]);
});

test('volume: 20,000 tickets, 26 statements — one match opens only the invoices of its window', () => {
  const invoices: ReturnType<typeof inv>[] = [];
  let n = 0;
  for (let d = 0; d < 365; d++) {
    const day = new Date(Date.UTC(2026, 3, 1 + d)).toISOString().slice(0, 10);
    for (let k = 0; k < 11; k++) {
      const i = inv(`i${n}`, day, [tk(n++), tk(n++), tk(n++), tk(n++), tk(n++)]);
      const items = i.items;
      Object.defineProperty(i, 'items', { get: () => { opened.add(day); return items; } });
      invoices.push(i);
    }
  }
  const opened = new Set<string>();
  assert.ok(n >= 20000);
  const rows = Array.from({ length: 1500 }, (_, k) => row(`058${String(9000 + k).padStart(10, '0')}`, 'TKTT', 4000));
  const t0 = performance.now();
  for (let s = 0; s < 26; s++) {
    opened.clear();
    const start = new Date(Date.UTC(2026, 3, 1 + s * 14)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(2026, 3, 14 + s * 14)).toISOString().slice(0, 10);
    const { from, to } = matchWindow({ period_start: start, period_end: end });
    matchStatement({ kind: 'bsp', vendor_id: 'bsp', period_start: start, period_end: end, rows }, { invoices, bookings: [], credited: new Set() });
    assert.ok([...opened].every((d) => d >= from && d <= to), 'no invoice outside the window was opened');
  }
  assert.ok(performance.now() - t0 < 5000);
});
