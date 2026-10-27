/** RT-B2: Schedule X register, narcotic balance, book pagination, licence notices, printed licence line, retention. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { DB_PREFIX, setJson, setTable } from '../src/lib/storage.ts';
import { h1Register } from '../src/lib/pharma.ts';
import {
  H1_HEAD, h1Cells, licenceNotices, narcoticRegister, paginate, registerBook, registerCsv, xCells, xRegister,
} from '../src/lib/retail/rt-pharmacy-registers.ts';
import { keepUntil, retainedAmong, retainedBills, retentionAt, rxRetainedInYear } from '../src/lib/retail/rt-pharmacy-retention.ts';
import { pharmacyNotices } from '../src/lib/retail/rt-pharmacy-alerts.ts';
import { licenceLine } from '../src/lib/retail/rt-pharmacy-rx.ts';
import { yearEndChecklist } from '../src/lib/year-end.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const IDX = new Map([['azithromycin 500', 'H1'], ['alprazolam 0.5', 'X'], ['cetirizine', 'H']] as const);
const P = { from: '2026-07-01', to: '2026-07-31' };

beforeEach(() => {
  resetStorage();
  installSettings();
});

const line = (name: string, quantity = 1, extra: Record<string, unknown> = {}) => ({ id: `l-${name}`, name, type: 'Goods', hsn: '3004', unit: 'TAB', quantity, rate: 10, tax_rate: 5, discount_percent: 0, amount: 10 * quantity, ...extra });
const inv = (id: string, day: string, items: ReturnType<typeof line>[], extra: Partial<InvoiceRecord> = {}): InvoiceRecord =>
  ({ id, invoice_number: `INV/${id}`, doc_type: 'TAX_INVOICE', status: 'Paid', issue_date: day, due_date: day, items, total: 10, client: { id: 'c1', name: 'Asha' }, ...extra }) as unknown as InvoiceRecord;

test('Schedule X register rows (flags missing Rx details); H1 cells', () => {
  const rows = xRegister([
    inv('b1', '2026-07-05', [line('Alprazolam 0.5', 10, { batch_no: 'AX1' }), line('Cetirizine', 1)], { rx: { patient: 'Asha', patient_address: '4 Lake Rd', prescriber: 'Dr Mehta', prescriber_reg: 'MMC 1', retained: true, rx_no: 'R-9' } }),
    inv('b2', '2026-07-02', [line('Alprazolam 0.5', 5)], { rx: { patient: 'Ravi', prescriber: 'Dr Rao' } }),
    inv('b3', '2026-06-30', [line('Alprazolam 0.5', 5)]),
    inv('b4', '2026-07-03', [line('Alprazolam 0.5', 5)], { status: 'Draft' }),
  ], IDX, P);
  assert.deepEqual(rows.map((r) => [r.number, r.qty, r.missingRx]), [['INV/b2', 5, true], ['INV/b1', 10, false]]);
  assert.deepEqual(xCells(rows[1]), ['2026-07-05', 'INV/b1', 'Asha', '4 Lake Rd', 'Dr Mehta', 'MMC 1', 'Alprazolam 0.5', 'AX1', 10, 'TAB', 'Yes', 'R-9', '']);
  const h = h1Register([inv('b5', '2026-07-05', [line('Azithromycin 500', 3), line('Cetirizine', 2)])], IDX, P, ['H']);
  assert.equal(h.length, 1);
  assert.equal(h1Cells(h[0]).length, H1_HEAD.length);
  assert.match(registerCsv('Schedule X register', P, ['A'], [[1]]), /verify the format with your drug inspector/);
});

test('narcotic register: opening, received (paid + free, in base units), sold, closing per batch', () => {
  const items = [{ id: 'n1', name: 'Codeine syrup', unit: 'BTL', narcotic: true, opening_qty: 4 }, { id: 'n2', name: 'Plain syrup', unit: 'BTL' }];
  const purchases = [
    { id: 'p1', kind: 'PURCHASE', vendor_name: 'Pharma Dist', bill_number: 'D1', date: '2026-06-20', status: 'unpaid', lines: [{ id: 'a', name: 'Codeine syrup', quantity: 10, free_qty: 2, rate: 50, batch_no: 'C1', tax_rate: 12 }], total: 560 },
    { id: 'p2', kind: 'PURCHASE', vendor_name: 'Pharma Dist', bill_number: 'D2', date: '2026-07-10', status: 'unpaid', lines: [{ id: 'b', name: 'Codeine syrup', quantity: 1, unit: 'BOX', unit_factor: 6, rate: 300, batch_no: 'C2', tax_rate: 12 }, { id: 'c', name: 'Plain syrup', quantity: 5, rate: 20 }], total: 336 },
  ];
  const sales = [
    inv('s1', '2026-06-25', [line('Codeine syrup', 3, { batch_no: 'C1' })]),
    inv('s2', '2026-07-12', [line('Codeine syrup', 2, { batch_no: 'C2' }), line('Plain syrup', 1)]),
    inv('s3', '2026-07-15', [line('Codeine syrup', 1, { batch_no: 'C1' })], { doc_type: 'CREDIT_NOTE', status: 'Sent' }),
  ];
  const rows = narcoticRegister(items, purchases, sales, P);
  assert.deepEqual(rows.map((r) => [r.batch, r.opening, r.received, r.sold, r.closing]), [['', 4, 0, 0, 4], ['C1', 9, 1, 0, 10], ['C2', 0, 6, 2, 4]]);
});

test('book pagination: n of N pages, the period on each page, flagged rows', () => {
  assert.deepEqual(paginate([1, 2, 3, 4, 5], 2).map((p) => p.length), [2, 2, 1]);
  assert.deepEqual(paginate([], 25), [[]]);
  const rows = Array.from({ length: 30 }, (_, i) => [`2026-07-${String((i % 28) + 1).padStart(2, '0')}`, `INV/${i}`]);
  const html = registerBook({ title: 'Schedule H1 register', shop: 'Joshi <Medical>', licence: '20: MH-1', period: P, head: ['Date', 'Bill'], rows, flagged: rows.map((_, i) => i === 0), perPage: 25 });
  assert.equal((html.match(/class="pg"/g) ?? []).length, 2);
  assert.match(html, /Page 1 of 2/);
  assert.match(html, /Page 2 of 2/);
  assert.equal((html.match(/2026-07-01 to 2026-07-31/g) ?? []).length, 2);
  assert.match(html, /Joshi &#60;Medical&#62;/);
  assert.equal((html.match(/class="bad"/g) ?? []).length, 1);
  assert.match(html, /verify the register format with your drug inspector/);
  assert.doesNotMatch(html, /<script/);
});

test('licence notices at 60 days; the bell notices; printed licence line falls back to the old text', () => {
  const lic = [{ form: '20' as const, number: 'A', valid_to: '2026-09-29' }, { form: '21' as const, number: 'B', valid_to: '2026-09-30' }, { form: '20F' as const, number: 'C', valid_to: '2026-07-01' }, { form: '21G' as const, number: 'D' }];
  assert.deepEqual(licenceNotices(lic, '2026-07-31').map((n) => [n.licence.number, n.expired]), [['A', false], ['C', true]], 'B is 61 days away; D has no end date');
  const notes = pharmacyNotices(lic, [{ id: 'r', name: 'Asha', items: [], every_days: 30, next_due: '2026-07-30', active: true, created_at: '' }], '2026-07-31', '2026-07-31T09:00:00.000Z');
  assert.deepEqual(notes.map((n) => n.severity), ['warning', 'critical', 'info']);
  assert.match(notes[2].title, /Refills due today: 1/);
  assert.equal(notes[0].href, '/inventory?tab=pharmacy&view=registers');
  assert.equal(licenceLine(undefined, '20-21/MH/123'), '20-21/MH/123');
});

test('retention: H1 3 years, X 2 years; warnings only while pharma is on; the year-end fact', () => {
  assert.deepEqual(retentionAt('2026-07-01'), { h1Years: 3, xPrescriptionYears: 2, cashMemoYears: 3 });
  assert.equal(keepUntil('2026-07-01', ['H1']), '2029-07-01');
  assert.equal(keepUntil('2026-07-01', ['X']), '2028-07-01');
  assert.equal(keepUntil('2024-02-29', ['X']), '2026-03-01');
  assert.equal(keepUntil('2026-07-01', []), '');
  const bills = [inv('h1', '2026-07-01', [line('Azithromycin 500')]), inv('x', '2026-07-01', [line('Alprazolam 0.5')]), inv('h', '2026-07-01', [line('Cetirizine')]), inv('old', '2022-01-01', [line('Azithromycin 500')])];
  assert.deepEqual(retainedBills(bills, IDX, '2028-08-01').map((b) => [b.id, b.until]), [['h1', '2029-07-01']]);
  assert.deepEqual(retainedBills(bills, IDX, '2026-08-01').map((b) => b.id), ['h1', 'x']);
  setTable('stock_items', [{ id: 's1', name: 'Azithromycin 500', drug_schedule: 'H1' }]);
  assert.deepEqual(retainedAmong(bills, '2026-08-01'), [], 'pharma features off: no warning');
  setJson(`${DB_PREFIX}pharma_settings`, { enabled: true, block_expired: false, near_expiry_days: 90, block_near_expiry: false });
  assert.deepEqual(retainedAmong([...bills, { not: 'an invoice' }], '2026-08-01').map((b) => b.id), ['h1']);
  const year = rxRetainedInYear(bills, '2026-04-01', '2027-03-31', '2026-08-01');
  assert.deepEqual(year, { count: 1, until: '2029-07-01' });
  const steps = yearEndChecklist({ fyStart: 2026, ledger: { vouchers: [], accounts: [], byId: new Map() } as never, integrity: { issues: [], totals: { dr: 0, cr: 0, diff: 0 } } as never, closingStock: { value: 0, items: 0 }, assets: [], manual: [], lockUntil: '', oldOpenBills: { count: 0, amount: 0 }, today: '2027-04-10', rxRetained: year });
  assert.match(steps.find((s) => s.id === 'lock')!.facts.join(' '), /1 bill\(s\) with Schedule H1 \/ X drugs must be kept until 2029-07-01/);
});
