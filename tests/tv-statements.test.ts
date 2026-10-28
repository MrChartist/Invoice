/**
 * R15-C2 supplier statements: BSP / consolidator presets, the remembered column map, split by month above 2,000 rows,
 * one `import_runs` row per import, the match stored on rows, ADM dispute and "Make bill" (the only posting).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { guessColumns } from '../src/lib/marketplace/file-map.ts';
import { STATEMENT_PRESETS, importStatement, loadStatements, readStatementRows, removeStatement, splitByMonth, totalsOf, updateStatement } from '../src/lib/travel/tv-statements.ts';
import { makeStatementBill } from '../src/lib/travel/tv-statement-bill.ts';
import { readTravelSettings } from '../src/lib/travel/tv-settings.ts';
import { mergeTickets } from '../src/lib/travel/tv-air-value.ts';
import { purchasesDb } from '../src/lib/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
});

const BSP = { headers: ['Document Number', 'Transaction Type', 'Issue Date', 'Passenger Name', 'Gross Fare', 'Taxes', 'Commission', 'Net Remit'], rows: [
  ['0581234567890', 'TKTT', '03/10/2026', 'MEHTA/RAVI', '4200', '1150', '0', '5350'],
  ['0581234567891', 'TKTT', '03/10/2026', 'MEHTA/ASHA', '4200', '1150', '0', '5350'],
  ['ADM0001', 'ADMA', '10/10/2026', '', '3500', '0', '0', '3500'],
  ['0581234567892', 'RFND', '12/10/2026', 'SHAH/K', '4000', '900', '0', '4900'],
] };

test('BSP preset guesses every column; rows read with types; totals sign refunds', () => {
  const cols = guessColumns(BSP.headers, STATEMENT_PRESETS.bsp!);
  assert.equal(cols.size, 8);
  const rows = readStatementRows(BSP, cols);
  assert.deepEqual(rows.map((r) => [r.type, r.date, r.net]), [['TKTT', '2026-10-03', 5350], ['TKTT', '2026-10-03', 5350], ['ADMA', '2026-10-10', 3500], ['RFND', '2026-10-12', 4900]]);
  assert.equal(totalsOf(rows).net, 5350 + 5350 + 3500 - 4900);
  const con = guessColumns(['Ticket / Ref', 'Date', 'Pax', 'Gross', 'Comm', 'Net Payable'], STATEMENT_PRESETS.consolidator!);
  assert.deepEqual(['doc_no', 'gross', 'commission', 'net'].map((k) => con.has(k)), [true, true, true, true]);
});

test('R16-C3 bed-bank preset: hotel, confirmation no., check-in, nights, net — matched against the hotel booking', async () => {
  const BB = { headers: ['Hotel Name', 'Confirmation No', 'Check-in', 'Nights', 'Guest Name', 'Net Amount'], rows: [['Sea View Resort', 'HB-77881', '05/10/2026', '3', 'MEHTA/RAVI', '18,600']] };
  const cols = guessColumns(BB.headers, STATEMENT_PRESETS.bedbank!);
  assert.equal(cols.size, 6);
  const rows = readStatementRows(BB, cols);
  assert.deepEqual(rows.map((r) => [r.doc_no, r.type, r.date, r.hotel, r.nights, r.gross, r.net]), [['HB-77881', 'HOTEL', '2026-10-05', 'Sea View Resort', 3, 18600, 18600]]);
  const { saveTrip } = await import('../src/lib/travel/tv-trips.ts');
  const { saveBooking } = await import('../src/lib/travel/tv-bookings.ts');
  const v = vendorsDb.save({ name: 'Hotelbeds (bed bank)' });
  const t = saveTrip({ name: 'Goa', client_id: 'c-mh', tv: { code: '2610-009', kind: 'trip', scope: 'domestic', start: '2026-10-05', regime: 'agent', status: 'confirmed', pax: [] } });
  saveBooking({ trip_id: t.id, component: 'hotel', vendor_id: v.id, start: '2026-10-05', cost: 18600, sell: 21000, status: 'confirmed', ref: 'HB-77881' });
  const [st] = importStatement({ vendor_id: v.id, kind: 'bedbank', ref: 'Oct', period_start: '2026-10-01', period_end: '2026-10-31', rows });
  assert.equal(st.rows[0].status, 'matched');
});

test('split by month above 2,000 rows', () => {
  const r = (m: string) => ({ doc_no: 'x', type: 'TKTT', date: `2026-${m}-05`, gross: 1, taxes: 0, commission: 0, net: 1 });
  assert.equal(splitByMonth([r('10'), r('11')]).length, 1);
  const parts = splitByMonth([...Array.from({ length: 1500 }, () => r('10')), ...Array.from({ length: 1200 }, () => r('11'))]);
  assert.deepEqual(parts.map((p) => p.length), [1500, 1200]);
});

test('import → matched rows, import_runs row, remembered map; dispute an ADM; make the bill once', () => {
  const v = vendorsDb.save({ name: 'IATA BSP India' });
  // Two of our tickets, billed on an issued invoice.
  const m = mergeTickets([], undefined, [{ ticket_no: '0581234567890', basic: 4200, taxes: 940, airline_gst: 210 }, { ticket_no: '0581234567891', basic: 4200, taxes: 940, airline_gst: 210 }], { method: 'deemed', fee: 0, date: '2026-10-03' });
  localDb.invoices.save({ ...localDb.invoices.getAll()[0], id: 'inv1', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-10-03', client: clientMH, items: m.items, tv: m.tv } as never);
  const cols = guessColumns(BSP.headers, STATEMENT_PRESETS.bsp!);
  const [st] = importStatement({ vendor_id: v.id, kind: 'bsp', ref: 'BSP 2610A', period_start: '2026-10-01', period_end: '2026-10-15', rows: readStatementRows(BSP, cols), file_name: 'bsp.csv', map: { doc_no: 'Document Number' } });
  assert.deepEqual(st.rows.map((r) => [r.status, r.flag ?? '']), [['matched', ''], ['matched', ''], ['diff', 'adm'], ['missing', '']]);
  assert.deepEqual(getTable<{ kind: string; created: number }>('import_runs').map((r) => [r.kind, r.created]), [['supplier_statement', 4]]);
  assert.deepEqual(readTravelSettings().statement_maps?.bsp, { doc_no: 'Document Number' });
  updateStatement(st.id, (s) => ({ ...s, rows: s.rows.map((r) => (r.flag === 'adm' ? { ...r, disputed: true } : r)) }));
  assert.equal(loadStatements()[0].totals.net, 5350 + 5350 - 4900, 'a disputed ADM is left out of what we owe');
  const bill = makeStatementBill(st.id);
  assert.deepEqual([bill.total, bill.itc_eligible, bill.date, bill.vendor_id], [5800, false, '2026-10-15', v.id]);
  assert.throws(() => makeStatementBill(st.id), /made already/);
  assert.throws(() => removeStatement(st.id), /delete the bill first/);
  purchasesDb.remove(bill.id);
  removeStatement(st.id);
  assert.equal(loadStatements().length, 0);
  assert.ok(getTable<{ table: string }>('recycle_bin').some((r) => JSON.stringify(r).includes('supplier_statements')), 'deleted to the recycle bin');
});
