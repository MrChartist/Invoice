/** RT-B1: prescription checks (warn / block), doctors and the Rx snapshot, Schedule X, refills, doctor-wise sales, pack-off gate. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { DB_PREFIX, getTable, setJson, setTable } from '../src/lib/storage.ts';
import { rxRequiredErrors } from '../src/lib/pharma-gate.ts';
import { doctorSalesCsv, doctorWiseSales, doctorsDb, licenceLine, pharmacistLine, pickDoctor, readRxSettings, rxIssues, saveRxSettings } from '../src/lib/retail/rt-pharmacy-rx.ts';
import { advanceRefill, dueRefills, loadRefills, refillCart, refillFromBill, refillWaLink, saveRefill, syncRefills } from '../src/lib/retail/rt-refills.ts';
import { applyRetailSwitches } from '../src/lib/retail/rt-profile.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const IDX = new Map([['azithromycin 500', 'H1'], ['alprazolam 0.5', 'X'], ['cetirizine', 'H']] as const);
const PH = `${DB_PREFIX}pharma_settings`;

beforeEach(() => {
  resetStorage();
  installSettings();
});

const line = (name: string, quantity = 1, extra: Record<string, unknown> = {}) => ({ id: `l-${name}`, name, type: 'Goods', hsn: '3004', unit: 'TAB', quantity, rate: 10, tax_rate: 5, discount_percent: 0, amount: 10 * quantity, ...extra });
const inv = (id: string, day: string, items: ReturnType<typeof line>[], extra: Partial<InvoiceRecord> = {}): InvoiceRecord =>
  ({ id, invoice_number: `INV/${id}`, doc_type: 'TAX_INVOICE', status: 'Paid', issue_date: day, due_date: day, items, total: items.reduce((s, l) => s + l.amount, 0), client: { id: 'c1', name: 'Asha', phone: '98000 00012' }, ...extra }) as unknown as InvoiceRecord;

test('H1 / X without patient + prescriber: a warning, an error with "Require prescription"', () => {
  const rec = { doc_type: 'TAX_INVOICE' as const, issue_date: '2026-07-01', items: [line('Azithromycin 500'), line('Cetirizine')] as InvoiceRecord['items'] };
  assert.deepEqual(rxIssues(rec, IDX, {}).map((i) => [i.code, i.items, i.error]), [['needRx', ['Azithromycin 500'], false]]);
  assert.deepEqual(rxIssues(rec, IDX, { require_rx: true }).map((i) => i.error), [true]);
  assert.deepEqual(rxIssues({ ...rec, rx: { patient: 'Asha', prescriber: 'Dr Mehta' } }, IDX, { require_rx: true }), []);
  assert.deepEqual(rxIssues({ ...rec, doc_type: 'QUOTATION' }, IDX, { require_rx: true }), [], 'quotations are not checked');
  // Schedule H alone needs nothing.
  assert.deepEqual(rxIssues({ ...rec, items: [line('Cetirizine')] as InvoiceRecord['items'] }, IDX, { require_rx: true }), []);
  // The save-path gate (editor / POS) reads the stored switch and the stock items' schedules.
  setTable('stock_items', [{ id: 's1', name: 'Azithromycin 500', drug_schedule: 'H1' }]);
  const doc = { doc_type: 'TAX_INVOICE', status: 'Sent', items: [{ name: 'Azithromycin 500', quantity: 3 }] };
  assert.deepEqual(rxRequiredErrors(doc), [], 'pharma features off: nothing');
  setJson(PH, { enabled: true, block_expired: false, near_expiry_days: 90, block_near_expiry: false });
  assert.deepEqual(rxRequiredErrors(doc), [], 'warn mode: the save is not stopped');
  setJson(PH, { enabled: true, block_expired: false, near_expiry_days: 90, block_near_expiry: false, require_rx: true });
  assert.match(rxRequiredErrors(doc)[0], /Azithromycin 500.*patient and the prescriber/);
  assert.deepEqual(rxRequiredErrors({ ...doc, status: 'Draft' }), [], 'drafts are not checked');
  assert.deepEqual(rxRequiredErrors({ ...doc, rx: { patient: 'Asha', prescriber: 'Dr Mehta' } }), []);
});

test('the medical-store profile turns "Require prescription" on; the 7U switches keep the new fields', async () => {
  applyRetailSwitches('pharmacy');
  assert.equal(readRxSettings().require_rx, true);
  const { savePharmaSettings, readPharmaSettings } = await import('../src/lib/pharma.ts');
  savePharmaSettings({ ...readPharmaSettings(), near_expiry_days: 60 });
  assert.equal(readRxSettings().require_rx, true, 'the 7U panel does not drop require_rx');
});

test('doctors master and the prescriber snapshot', () => {
  const d = doctorsDb.save({ name: ' Dr A Mehta ', reg_no: 'MMC 1234', council: 'Maharashtra Medical Council', phone: '98000 00011' });
  assert.equal(d.name, 'Dr A Mehta');
  assert.throws(() => doctorsDb.save({ name: 'dr a mehta' }), /already in the list/);
  assert.equal(Object.hasOwn(d, 'commission'), false);
  const rx = pickDoctor({ patient: 'Asha', prescriber: '' }, d);
  assert.deepEqual(rx, { patient: 'Asha', prescriber: 'Dr A Mehta', prescriber_reg: 'MMC 1234, Maharashtra Medical Council', doctor_id: d.id });
  // A later edit of the doctor never rewrites the bill's snapshot.
  doctorsDb.save({ ...d, name: 'Dr Anil Mehta' });
  assert.equal(rx.prescriber, 'Dr A Mehta');
  assert.equal(pickDoctor(rx, undefined).doctor_id, undefined);
  doctorsDb.remove(d.id);
  assert.equal(doctorsDb.all().length, 0);
  assert.equal(getTable<{ table: string }>('recycle_bin').filter((e) => e.table === 'doctors').length, 1, 'the delete went to the recycle bin');
});

test('Schedule X needs the address, "retained" and a 20F / 21G licence; licences and pharmacist', () => {
  const rec = { doc_type: 'TAX_INVOICE' as const, issue_date: '2026-07-01', items: [line('Alprazolam 0.5')] as InvoiceRecord['items'], rx: { patient: 'Asha', prescriber: 'Dr Mehta' } };
  assert.deepEqual(rxIssues(rec, IDX, { require_rx: true }).map((i) => [i.code, i.error]), [['xAddress', true], ['xRetained', true], ['xLicence', false]]);
  const lic = [{ form: '21G' as const, number: 'MH-X-1', valid_to: '2027-03-31' }, { form: '20' as const, number: 'MH-20-9', valid_to: '2026-06-30' }];
  const ok = { ...rec, rx: { ...rec.rx, patient_address: '4 Lake Road', retained: true } };
  assert.deepEqual(rxIssues(ok, IDX, { require_rx: true, licences: lic }).map((i) => [i.code, i.error]), [['licenceExpired', false]], 'an expired licence warns, never blocks');
  assert.equal(licenceLine(lic, 'old text'), '21G: MH-X-1, 20: MH-20-9');
  assert.equal(licenceLine([], 'old text'), 'old text');
  assert.equal(pharmacistLine({ name: 'R. Joshi', reg_no: 'MSPC 77' }), 'R. Joshi (MSPC 77)');
  saveRxSettings({ licences: [{ form: '20', number: ' MH-20-1 ' }], pharmacist: { name: 'R. Joshi', reg_no: 'MSPC 77' }, require_rx: true });
  const p = localDb.settings.activeProfile()!;
  assert.equal(p.drug_licence, '20: MH-20-1');
  assert.equal(p.pharmacist, 'R. Joshi (MSPC 77)');
  assert.throws(() => saveRxSettings({ licences: [{ form: '20', number: 'A', valid_from: '2026-05-01', valid_to: '2026-04-01' }] }), /before/);
});

test('refill: made from a bill, due list window, next due after billing, cart and WhatsApp link', () => {
  const first = inv('b1', '2026-06-01', [line('Metformin 500', 30), line('Azithromycin 500', 0)]);
  const r = refillFromBill(first, 30, [], '2026-06-01T10:00:00.000Z');
  assert.equal(r.next_due, '2026-07-01');
  assert.deepEqual(r.items, [{ name: 'Metformin 500', quantity: 30, unit: 'TAB' }]);
  assert.throws(() => refillFromBill(first, 0), /1 to 365/);
  // A line in STRIP of 10 is kept in base units.
  assert.deepEqual(refillFromBill(inv('b0', '2026-06-01', [line('Metformin 500', 3, { unit: 'STRIP', unit_factor: 10 })]), 30).items, [{ name: 'Metformin 500', quantity: 30 }]);
  // Due list: within 3 days (default) and overdue, overdue first.
  assert.deepEqual(dueRefills([r], '2026-06-27'), [], 'day 26: not yet');
  assert.deepEqual(dueRefills([r], '2026-06-28').map((d) => d.daysLeft), [3], 'day 27: due in 3 days');
  assert.deepEqual(dueRefills([r], '2026-07-03').map((d) => d.daysLeft), [-2]);
  assert.deepEqual(dueRefills([{ ...r, active: false }], '2026-07-03'), []);
  // Billing the same medicine to the same customer moves the next due date forward.
  saveRefill(r);
  const again = inv('b2', '2026-06-29', [line('Metformin 500', 30)]);
  assert.equal(advanceRefill(r, [first, again]).next_due, '2026-07-29');
  assert.equal(advanceRefill(r, [first, inv('b3', '2026-06-29', [line('Paracetamol', 10)])]).next_due, '2026-07-01', 'another medicine does not count');
  assert.equal(advanceRefill(r, [first, { ...again, client: { id: 'c9', name: 'Someone' } } as InvoiceRecord]).next_due, '2026-07-01', 'another customer does not count');
  assert.equal(syncRefills([first, again]), 1);
  assert.equal(loadRefills()[0].next_due, '2026-07-29');
  assert.equal(syncRefills([first, again]), 0, 'idempotent');
  // Bill now: a held cart at the catalogue rate.
  const cart = refillCart(loadRefills()[0], [{ id: 'c', name: 'Metformin 500', description: '', type: 'Goods', hsn: '3004', unit: 'TAB', quantity: 1, rate: 2.5, tax_rate: 5, discount_percent: 0, amount: 2.5 }], null, () => 'id1');
  assert.deepEqual(cart.items.map((l) => [l.name, l.quantity, l.rate, l.amount]), [['Metformin 500', 30, 2.5, 75]]);
  assert.equal(cart.name, 'Asha');
  assert.equal(refillWaLink(r, 'Due'), 'https://wa.me/919800000012?text=Due');
});

test('doctor-wise sales and CSV', () => {
  const d = doctorsDb.save({ name: 'Dr Mehta', reg_no: 'MMC 1' });
  const rows = doctorWiseSales([
    inv('b1', '2026-07-02', [line('Azithromycin 500', 3)], { rx: { patient: 'A', prescriber: 'Dr Mehta', doctor_id: d.id } }),
    inv('b2', '2026-07-03', [line('Cetirizine', 2), line('Metformin', 1)], { rx: { patient: 'B', prescriber: 'Dr Mehta', doctor_id: d.id } }),
    inv('b3', '2026-07-03', [line('Paracetamol', 1)], { rx: { patient: 'C', prescriber: 'Dr Rao' } }),
    inv('b4', '2026-08-03', [line('Paracetamol', 1)], { rx: { patient: 'C', prescriber: 'Dr Rao' } }),
    inv('b5', '2026-07-03', [line('Paracetamol', 1)], { status: 'Draft', rx: { patient: 'C', prescriber: 'Dr Rao' } }),
  ], doctorsDb.all(), IDX, { from: '2026-07-01', to: '2026-07-31' });
  assert.deepEqual(rows.map((r) => [r.name, r.reg, r.bills, r.value, r.scheduledLines]), [['Dr Mehta', 'MMC 1', 2, 60, 2], ['Dr Rao', '', 1, 10, 0]]);
  assert.match(doctorSalesCsv(rows, { from: '2026-07-01', to: '2026-07-31' }), /verify with your CA[\s\S]*Dr Mehta,MMC 1,2,60,2/);
});

test('pack-off gate: nothing loads or blocks without the pharmacy features', () => {
  assert.deepEqual(rxRequiredErrors({ doc_type: 'TAX_INVOICE', items: [{ name: 'X', quantity: 1 }] }), []);
  const bell = readFileSync(new URL('../src/components/command/NotificationBell.tsx', import.meta.url), 'utf8');
  assert.match(bell, /gate\('pharmacy', '-', \(\) => import\('\.\.\/\.\.\/lib\/retail\/rt-pharmacy-alerts'\)\)/, 'the bell loads the notices only with the pharmacy pack');
  const pos = readFileSync(new URL('../src/pages/Pos.tsx', import.meta.url), 'utf8');
  assert.match(pos, /\{pharmaOn && <Suspense fallback=\{null\}><RxStrip /, 'the POS mounts the Rx strip only with the pharma features on');
  const bill = readFileSync(new URL('../src/components/purchases/BillModal.tsx', import.meta.url), 'utf8');
  assert.match(bill, /industry_packs\?\.includes\('pharmacy'\) && <Suspense fallback=\{null\}><CeilingNotice/);
});
