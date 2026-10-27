/** AG-D4 input dealer desk: licence windows, unlicensed-class and principal-certificate warnings, expiry block by class, PoS fields, monthly cap, PoS vs book, season due date and interest start. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setTable, KEYS } from '../src/lib/storage.ts';
import { agriLicenceNotices, licenceLines, principalWarnings, unlicensedWarnings } from '../src/lib/agri/ag-licences.ts';
import { agriExpiryGate, classIndex } from '../src/lib/agri/ag-expiry.ts';
import { bookAt, capWarning, posCheck, subsidyErrors, validFarmerId } from '../src/lib/agri/ag-subsidy.ts';
import { seasonCredit, seasonDue, withSeason } from '../src/lib/agri/ag-season-credit.ts';
import { partyInterest } from '../src/lib/trade/tr-interest.ts';
import type { AgriLicence } from '../src/types/agri-r12d.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { StockPosition } from '../src/lib/inventory.ts';
import { readFileSync } from 'node:fs';

beforeEach(() => {
  resetStorage();
  installSettings();
});
const lic = (kind: AgriLicence['kind'], valid_to: string, valid_from?: string): AgriLicence => ({ kind, number: `${kind}-1`, issued_by: 'DAO', valid_to, ...(valid_from ? { valid_from } : {}) });
const isUrea = (n: string) => /urea/i.test(n);
const sale = (o: Partial<InvoiceRecord> = {}): InvoiceRecord => ({ id: 's1', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-07-10', due_date: '2026-07-10', invoice_number: 'INV/1', client: { id: 'c-ram', name: 'Ram' }, items: [{ id: 'l', name: 'Urea 45 kg', quantity: 10, rate: 266.5, tax_rate: 5 }], total: 2798, balance_due: 2798, ...o }) as unknown as InvoiceRecord;

test('licence notices: 60-day window, 45 days "soon", expired; printed lines only valid ones', () => {
  const ls = [lic('insecticide', '2026-08-01'), lic('seed', '2026-09-05'), lic('fertiliser_retail', '2027-03-31'), lic('fssai', '2026-06-30')];
  const n = agriLicenceNotices(ls, '2026-07-10');
  assert.deepEqual(n.map((x) => [x.licence.kind, x.expired, x.soon]), [['insecticide', false, true], ['seed', false, false], ['fssai', true, true]]);
  assert.deepEqual(licenceLines(ls, '2026-07-10').map((l) => l.kind), ['insecticide', 'seed', 'fertiliser_retail']);
});

test('a licensed class with no valid licence warns (never blocks); a purchase without a principal certificate warns', () => {
  setTable(KEYS.items, [{ id: 'i1', name: 'Chlorpyrifos 20 EC', ag_class: 'pesticide_chem' }, { id: 'i2', name: 'Urea 45 kg', ag_class: 'fertiliser' }]);
  const idx = classIndex();
  const of = (n: string) => idx.get(n);
  const lines = [{ name: 'Chlorpyrifos 20 EC' }, { name: 'Urea 45 kg' }, { name: 'Sprayer' }];
  const w = unlicensedWarnings(lines, [lic('fertiliser_retail', '2027-03-31')], '2026-07-10', of);
  assert.equal(w.length, 1);
  assert.match(w[0], /Chlorpyrifos 20 EC: no valid insecticide licence/);
  assert.equal(unlicensedWarnings(lines, [lic('fertiliser_retail', '2027-03-31'), lic('insecticide', '2026-07-09')], '2026-07-10', of).length, 1, 'expired licence does not count');
  const bills = [
    { id: 'p1', kind: 'PURCHASE', vendor_id: 'v-iffco', vendor_name: 'IFFCO', bill_number: 'B1', date: '2026-07-01', lines: [{ name: 'Urea 45 kg', quantity: 100, rate: 240 }], taxable: 24000, total: 25200 },
    { id: 'p2', kind: 'PURCHASE', vendor_id: 'v-bayer', vendor_name: 'Bayer', bill_number: 'B2', date: '2026-07-01', lines: [{ name: 'Chlorpyrifos 20 EC', quantity: 10, rate: 400 }], taxable: 4000, total: 4720, status: 'void' },
  ];
  assert.deepEqual(principalWarnings(bills, [], of).map((x) => [x.bill, x.kind]), [['B1', 'fertiliser']], 'void bill skipped');
  assert.equal(principalWarnings(bills, [{ vendor_id: 'v-iffco', kind: 'fertiliser', ref: 'O-form 12', valid_to: '2027-03-31' }], of).length, 0);
});

test('expiry by class: an expired pesticide / seed batch is an error; an expired fertiliser keeps the confirmation', () => {
  setTable('stock_items', [{ id: 'i1', name: 'Chlorpyrifos 20 EC', ag_class: 'pesticide_chem' }, { id: 'i2', name: 'Urea 45 kg', ag_class: 'fertiliser' }]);
  const issues = { errors: [], warnings: [], expired: ['Chlorpyrifos 20 EC: batch C1 expired on 2026-06-30.', 'Urea 45 kg: batch U9 expired on 2026-06-30.'] };
  const out = agriExpiryGate(issues, '2026-07-10');
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /^Chlorpyrifos 20 EC: batch C1 expired.*cannot be sold/);
  assert.deepEqual(out.expired, ['Urea 45 kg: batch U9 expired on 2026-06-30.']);
  setTable('stock_items', []);
  assert.equal(agriExpiryGate(issues, '2026-07-10'), issues, 'no agri classes: untouched');
  assert.match(readFileSync(new URL('../src/lib/stock-tracking.ts', import.meta.url), 'utf8'), /agriExpiryGate\(pharmaGate\(/);
});

test('subsidised sale needs the PoS txn no. and a farmer ID (4 digits or KCC, never the full Aadhaar); monthly cap warns', () => {
  assert.equal(subsidyErrors(sale(), isUrea).length, 2);
  assert.equal(subsidyErrors(sale({ status: 'Draft' }), isUrea).length, 0);
  assert.equal(subsidyErrors(sale({ ag: { kind: 'inputs', inputs: { pos_txn: 'POS778812', farmer_id: '4321' } } }), isUrea).length, 0);
  assert.ok(!validFarmerId('123456789012'), 'a full Aadhaar is refused');
  assert.ok(validFarmerId('4321') && validFarmerId('KCC/UP/1234'));
  const ag = { kind: 'inputs' as const, inputs: { pos_txn: 'P', farmer_id: '4321' } };
  const earlier = [sale({ id: 'a', ag, items: [{ id: 'x', name: 'Urea 45 kg', quantity: 45, rate: 266.5 }] as never }), sale({ id: 'b', ag: { kind: 'inputs', inputs: { pos_txn: 'P', farmer_id: '9999' } }, items: [{ id: 'x', name: 'Urea 45 kg', quantity: 45, rate: 1 }] as never })];
  assert.match(capWarning(sale({ id: 'n', ag }), earlier, isUrea)!, /55 subsidised bags this month — above 50/);
  assert.equal(capWarning(sale({ id: 'n', ag, items: [{ id: 'x', name: 'Urea 45 kg', quantity: 5, rate: 1 }] as never }), earlier, isUrea), undefined, 'exactly 50 is fine');
});

test('PoS vs book: book stock at month end from the engine ledger; differences; sales missing a PoS no.', () => {
  const pos = { item: { id: 'u', name: 'Urea 45 kg', ag_subsidised: true }, ledger: [{ date: '2026-07-01', balance: 100 }, { date: '2026-07-20', balance: 70 }, { date: '2026-08-02', balance: 10 }] } as unknown as StockPosition;
  assert.equal(bookAt(pos, '2026-07-31'), 70);
  const r = posCheck('2026-07', [pos], { '2026-07': { u: 65 } }, [sale(), sale({ id: 's2', ag: { kind: 'inputs', inputs: { pos_txn: 'X', farmer_id: '1111' } } })], isUrea);
  assert.deepEqual(r.rows.map((x) => [x.item, x.book, x.pos, x.diff]), [['Urea 45 kg', 70, 65, 5]]);
  assert.deepEqual(r.missing.map((i) => i.id), ['s1']);
});

test('season due date (MM-DD rolls to the next one), the snapshot, the khata list and interest from the season due date', () => {
  const seasons = [{ name: 'Kharif', due: '11-15' }, { name: 'Rabi', due: '2027-04-30' }];
  assert.equal(seasonDue(seasons, 'Kharif', '2026-07-10'), '2026-11-15');
  assert.equal(seasonDue(seasons, 'Kharif', '2026-12-01'), '2027-11-15');
  assert.equal(seasonDue(seasons, 'Rabi', '2026-12-01'), '2027-04-30');
  assert.equal(seasonDue(seasons, 'Zaid', '2026-12-01'), '');
  const doc = withSeason(sale({ ag: { kind: 'inputs', inputs: { pos_txn: 'P1', farmer_id: '4321' } } }), seasons, 'Kharif');
  assert.equal(doc.due_date, '2026-11-15');
  assert.deepEqual(doc.ag!.inputs, { pos_txn: 'P1', farmer_id: '4321', season: 'Kharif', season_due: '2026-11-15' });
  assert.deepEqual(seasonCredit([doc], '2026-11-25').map((r) => [r.season, r.due, r.overdueDays]), [['Kharif', '2026-11-15', 10]]);
  // interest notes: company basis "bill date + credit days" — a season bill still starts at its season due date
  const data = { invoices: [{ ...doc, due_date: '2026-07-10' }], payments: [], links: [], clients: [{ id: 'c-ram', name: 'Ram' }], openingBills: [], runs: [] };
  const [p] = partyInterest('2026-12-15', { rate: 18, basis: 'bill', grace_days: 0 }, data as never);
  assert.equal(p.bills[0].due, '2026-11-15');
  assert.equal(p.bills[0].days, 30);
});

test('bell: licence notices with the inputs pack; overdue loans with the cold-store / FPO pack; nothing when off', async () => {
  const { saveAgriSettings } = await import('../src/lib/agri/ag-settings.ts');
  const { agdNotices } = await import('../src/lib/agri/ag-d-alerts.ts');
  saveAgriSettings({ licences: [lic('insecticide', '2026-07-01'), lic('seed', '2026-08-01')] });
  setTable('agri_loans', [{ id: 'l', number: 'LAS/FY26-27/0001', date: '2026-04-01', borrower_id: 'c', borrower_name: 'R', lot_ids: [], principal: 1000, rate_pct: 12, basis: 'simple', due_date: '2026-06-30', disbursed_by: 'cash', payment_voucher_id: 'v', repayments: [], status: 'open' }]);
  const n = agdNotices('2026-07-10', 'x', { inputs: true, loans: true, loansTab: 'members' });
  assert.deepEqual(n.map((x) => x.severity), ['critical', 'warning', 'warning']);
  assert.equal(n[2].href, '/inventory?tab=members&view=loans');
  assert.equal(agdNotices('2026-07-10', 'x', { inputs: false, loans: false }).length, 0);
});
