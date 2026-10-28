/** R19-D2 courier manifests: docket charge (volumetric, slabs, minimum, RTO, FSC), the CSV reader, manifests by month, the monthly run (one saveMany, POS 96 split, undo), volume. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { BUYER_KA, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { makeDraft } from '../src/store/invoice-defaults.ts';
import { billedManifests, docketCharge, docketRows, docketsFromRows, manifestTotals, mergeDockets, planCourierRun } from '../src/lib/logistics/lg-courier.ts';
import { billCourierMonth, deleteManifest, importDockets, loadManifests, undoCourierMonth } from '../src/lib/logistics/lg-d-save.ts';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import type { LgDocket, LgManifest, LgZone } from '../src/types/logistics-r19.ts';

const zones: LgZone[] = [{ zone: 'Local', first_500g: 40, addl_500g: 20 }, { zone: 'Metro', first_500g: 60, addl_500g: 30, min: 80, rto_pct: 50 }];
const base = () => makeDraft({ settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), docType: 'TAX_INVOICE' });
const dk = (no: string, o: Partial<LgDocket> = {}): LgDocket => ({ no, date: '2026-11-03', zone: 'Local', pcs: 1, kg: 1, chargeable_kg: 1, service: 'standard', charge: 60, ...o });

let traders = '', blr = '';
beforeEach(() => {
  resetStorage();
  installSettings();
  traders = localDb.clients.upsert({ name: 'Demo Traders', email: '', address: '', city: '', zip: '', gstin: '27AAPFU0939F1ZV', state_code: '27' });
  blr = localDb.clients.upsert({ name: 'Blr Retail', email: '', address: '', city: '', zip: '', gstin: BUYER_KA, state_code: '29' });
});

test('docket charge: 40 × 30 × 20 cm at 3 kg is 5 kg (÷ 5000); first 500 g + each further 500 g; minimum; RTO %; fuel surcharge', () => {
  assert.deepEqual(docketCharge({ kg: 3, zone: 'Local', dims: [{ l: 40, w: 30, h: 20, n: 1 }] }, zones), { chargeable_kg: 5, charge: 40 + 9 * 20 });
  assert.deepEqual(docketCharge({ kg: 0.3, zone: 'local' }, zones), { chargeable_kg: 0.5, charge: 40 }, 'zone case-insensitive, one slab');
  assert.equal(docketCharge({ kg: 0.4, zone: 'Metro' }, zones)?.charge, 80, 'minimum');
  assert.equal(docketCharge({ kg: 1, zone: 'Metro', status: 'rto' }, zones)?.charge, 135, '90 + 50 % RTO');
  assert.equal(docketCharge({ kg: 1, zone: 'Local', fsc_pct: 10 }, zones)?.charge, 66);
  assert.equal(docketCharge({ kg: 1, zone: 'Nowhere' }, zones), null);
  assert.equal(docketCharge({ kg: 3, zone: 'Local', dims: [{ l: 40, w: 30, h: 20, n: 1 }] }, zones, { volumetric: { air: 6000, courier: 4000, sea_kg_per_cbm: 1000 } })?.chargeable_kg, 6, 'divisor is a setting');
});

test('CSV reader: header columns, dd/mm dates, typed charge, row errors, duplicates, e-Way hint above ₹50,000, 5,000 rows', () => {
  const rows = [['Docket', 'Date', 'Zone', 'kg', 'l', 'w', 'h', 'value', 'intl', 'status'], ['a1', '03/11/2026', 'Local', '3', '40', '30', '20', '60000', '', 'delivered'], ['A2', '2026-11-04', 'Mars', '1'], ['A1', '2026-11-04', 'Local', '1'], ['A3', '', 'Local', '1'], ['A4', '2026-11-05', 'Local', '1', '', '', '', '', 'yes', 'rto']];
  const r = docketsFromRows(rows, { zones });
  assert.deepEqual(r.dockets.map((d) => [d.no, d.date, d.chargeable_kg, d.charge, d.status, d.intl]), [['A1', '2026-11-03', 5, 220, 'delivered', undefined], ['A4', '2026-11-05', 1, 60, 'rto', true]]);
  assert.deepEqual(r.errors, ['3: Mars', '4', '5']);
  assert.deepEqual(r.hints, ['A1']);
  assert.equal(docketsFromRows([['docket', 'date', 'zone', 'charge'], ['X', '2026-11-03', 'Mars', '99']], { zones }).dockets[0].charge, 99, 'a typed charge wins');
  assert.deepEqual(docketsFromRows([['awb', 'date']], { zones }).errors, ['cols']);
  assert.deepEqual(docketsFromRows([['docket', 'date', 'zone'], ...Array.from({ length: 5001 }, (_, i) => [`D${i}`, '2026-11-03', 'Local'])], { zones }).errors, ['many']);
});

test('dockets go into one manifest per customer × month; numbers unique per company; a billed month is shut', () => {
  const ids = ['m1', 'm2', 'm3'];
  const r = mergeDockets([], 'c', [dk('A'), dk('B', { date: '2026-12-01' }), dk('C')], new Set(), () => ids.shift()!, (p) => `${p}-30`, 'now');
  assert.deepEqual(r.rows.map((m) => [m.id, m.period, m.date, m.dockets.length]), [['m1', '2026-11', '2026-11-30', 2], ['m2', '2026-12', '2026-12-30', 1]]);
  assert.deepEqual(mergeDockets(r.rows, 'd', [dk('A')], new Set(), () => 'x', (p) => p, 'now').dup, ['A']);
  assert.deepEqual(mergeDockets(r.rows, 'c', [dk('Z')], new Set(['m1']), () => 'x', (p) => p, 'now').billed, ['2026-11']);
  importDockets(traders, [dk('A1'), dk('A2')]);
  assert.throws(() => importDockets(blr, [dk('A2')]), /already on a manifest/);
  assert.equal(loadManifests().length, 1);
  assert.equal(TABLE_ACTIONS.lg_manifests, 'doc.create');
  assert.equal(getTable('recycle_bin').length, 0);
  deleteManifest(loadManifests()[0].id);
  assert.ok(getTable<{ table: string }>('recycle_bin').some((x) => x.table === 'lg_manifests'), 'deleted to the recycle bin');
});

test('"Bill month": one bill per customer, international dockets on their own (POS 96, IGST), a line per docket, lg snapshot; again = nothing; undo frees it', () => {
  importDockets(traders, [dk('T1', { kg: 3, dims: [{ l: 40, w: 30, h: 20, n: 1 }], chargeable_kg: 5, charge: 220 }), dk('T2'), dk('T3', { intl: true, charge: 500 })]);
  importDockets(blr, [dk('B1', { charge: 100 }), dk('B2', { date: '2026-12-02' })]);
  const bills = billCourierMonth('2026-11', '2026-12-01', base());
  assert.equal(bills.length, 3);
  const [dom, intl, ka] = bills;
  assert.deepEqual([dom.client.name, dom.items.length, dom.place_of_supply, dom.gst_mode, dom.items[0].hsn, dom.items[0].tax_rate, dom.lg?.count, dom.lg?.kg, dom.lg?.period], ['Demo Traders', 2, '27', 'CGST_SGST', '996812', 18, 2, 6, '2026-11']);
  assert.equal(dom.taxable_value, 280);
  assert.equal(dom.cgst_amount, 25.2);
  assert.deepEqual([intl.place_of_supply, intl.gst_mode, intl.items.length, intl.igst_amount], ['96', 'IGST', 1, 90]);
  assert.match(intl.lg?.pos_reason ?? '', /12\(8\) proviso/);
  assert.deepEqual([ka.place_of_supply, ka.gst_mode], ['29', 'IGST']);
  assert.equal(new Set(bills.map((b) => b.invoice_number)).size, 3, 'numbered in the invoice series');
  assert.equal(billedManifests(localDb.invoices.getAll()).size, 2);
  assert.equal(localDb.items.getAll().filter((i) => i.name === 'Courier charges').length, 1, 'the catalogue learns one item');
  assert.deepEqual(billCourierMonth('2026-11', '2026-12-01', base()), [], 'billed months are skipped');
  assert.throws(() => importDockets(traders, [dk('T9')]), /billed/);
  assert.equal(undoCourierMonth('2026-11'), 3);
  assert.ok(localDb.invoices.getAll().every((i) => i.lg?.period !== '2026-11' || i.status === 'Cancelled'), 'cancelled, never deleted');
  assert.equal(billCourierMonth('2026-11', '2026-12-01', base()).length, 3, 'billable again');
  localDb.payments.record({ invoiceId: localDb.invoices.getAll().find((i) => i.status !== 'Cancelled' && i.lg?.manifest_id)!.id, amount: 10, method: 'Cash', date: '2026-12-02' });
  assert.throws(() => undoCourierMonth('2026-11'), /receipts/);
  assert.equal(docketRows(loadManifests()[0]).length, 4, 'annexure: header + 3 dockets');
});

test('the run makes ONE saveMany call; a customer that is gone is skipped', () => {
  importDockets(traders, [dk('T1')]);
  importDockets(blr, [dk('B1')]);
  setTable('clients', localDb.clients.getAll().filter((c) => c.id !== blr));
  const calls: number[] = [];
  const orig = localDb.invoices.saveMany;
  localDb.invoices.saveMany = (list) => { calls.push(list.length); return orig(list); };
  try { billCourierMonth('2026-11', '2026-12-01', base()); } finally { localDb.invoices.saveMany = orig; }
  assert.deepEqual(calls, [1]);
});

test('volume: 60,000 dockets in 600 manifests; 50 customers billed through one saveMany under 2 s', () => {
  const ids = Array.from({ length: 50 }, (_, i) => localDb.clients.upsert({ name: `Cust ${i}`, email: '', address: '', city: '', zip: '', state_code: '27' }));
  const ms: LgManifest[] = [];
  for (let m = 1; m <= 12; m++) for (const c of ids) ms.push({ id: `${c}-${m}`, client_id: c, period: `2026-${String(m).padStart(2, '0')}`, date: '', dockets: Array.from({ length: 100 }, (_, k) => dk(`${c}-${m}-${k}`)), updated_at: '' });
  assert.equal(ms.reduce((s, m) => s + m.dockets.length, 0), 60_000);
  setTable('lg_manifests', ms);
  assert.equal(planCourierRun('2026-11', ms, [], localDb.clients.getAll()).length, 50);
  assert.equal(manifestTotals(ms[0]).count, 100);
  const t = performance.now();
  const bills = billCourierMonth('2026-11', '2026-12-01', base());
  assert.equal(bills.length, 50);
  assert.ok(performance.now() - t < 2000, `${(performance.now() - t).toFixed(0)} ms`);
});
