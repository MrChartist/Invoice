/** SV-B1 patients, OPD visits, consultation bill, registrations and the rate list; the pack-off gate. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { SELLER, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import { ageOn, findPatients, nextUhid, readClinicSettings, saveClinicSettings, savePatient, uhidOf, clinicLine } from '../src/lib/services/sv-patients.ts';
import { OPD, billVisit, deleteVisit, feeFor, loadVisits, nextOpdToken, saveVisit, visitKind } from '../src/lib/services/sv-opd.ts';
import { printedStamp, rateListHtml, rateRows, ratesOutOfDate } from '../src/lib/services/sv-rate-list.ts';
import { regExpiry } from '../src/lib/services/sv-clinic-alerts.ts';
import { doctorsDb } from '../src/lib/retail/rt-pharmacy-rx.ts';
import { saveStaff } from '../src/lib/services/sv-staff.ts';
import { saveServiceSettings } from '../src/lib/services/sv-settings.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { svDocTitle, visitText, svRegText } from '../src/components/templates/paper-helpers.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('UHID: prefix + FY year + sequence, unique, editable; roll no. fallback; search by UHID / phone / name', () => {
  saveClinicSettings({ uhid_prefix: 'MC' });
  assert.equal(readClinicSettings().uhid_prefix, 'MC');
  const a = savePatient({ name: 'Mrs Rao', phone: '98200 11111', patient: { age: 54, sex: 'F' } }, '2026-10-05');
  assert.equal(a.patient?.uhid, 'MC26-0001');
  const b = savePatient({ name: 'Mrs Rao', patient: {} }, '2026-10-05');
  assert.equal(b.patient?.uhid, 'MC26-0002', 'same name, a second patient (no merge)');
  assert.notEqual(a.id, b.id);
  assert.throws(() => savePatient({ name: 'X', patient: { uhid: 'mc26-0001' } }, '2026-10-05'), /already used/);
  const c = savePatient({ id: a.id, name: 'Mrs Rao', patient: { uhid: 'MC26-0412' } }, '2026-10-06');
  assert.equal(c.patient?.uhid, 'MC26-0412');
  assert.equal(nextUhid(localDb.clients.getAll(), 'MC', '2026-10-06'), 'MC26-0413');
  assert.equal(uhidOf({ roll_no: 'R-7' }), 'R-7');
  const all = localDb.clients.getAll();
  assert.deepEqual(findPatients(all, '0412').map((p) => p.id), [a.id]);
  assert.deepEqual(findPatients(all, '9820011111').map((p) => p.id), [a.id]);
  assert.equal(findPatients(all, 'rao').length, 2);
  assert.equal(ageOn(c, '2028-10-07'), 56, 'age moves on with the years');
});

test('tokens per doctor per day; follow-up fee inside the window; numbering OPD never reused', () => {
  const shah = doctorsDb.save({ name: 'Dr Shah', reg_no: 'MMC 2011/04/1234', consult_fee: 600, follow_up_fee: 300, follow_up_days: 7, active: true });
  const kul = doctorsDb.save({ name: 'Dr Kulkarni', consult_fee: 500, active: true });
  const p = savePatient({ name: 'Mrs Rao', patient: { sex: 'F', age: 54 } }, '2026-10-05');
  const v1 = saveVisit({ date: '2026-10-05', patient_id: p.id, patient_name: p.name, doctor_id: shah.id });
  const v2 = saveVisit({ date: '2026-10-05', patient_name: 'Walk-in', doctor_id: shah.id });
  const v3 = saveVisit({ date: '2026-10-05', patient_name: 'Other', doctor_id: kul.id });
  assert.deepEqual([v1.token, v2.token, v3.token], [1, 2, 1]);
  assert.equal(nextOpdToken(loadVisits(), '2026-10-06', shah.id), 1, 'tokens restart daily');
  assert.match(v1.number, new RegExp(`^${OPD}/FY26-27/0001$`));
  assert.deepEqual([v1.kind, v1.fee], ['new', 600]);
  // Bill → issue; a visit 5 days later is a follow-up, 9 days later new again.
  const inv = billVisit(v1.id);
  localDb.invoices.save({ ...inv, status: 'Sent' });
  const invoices = getTable<InvoiceRecord>('invoices');
  assert.equal(visitKind(loadVisits(), invoices, p.id, shah, '2026-10-10'), 'follow-up');
  assert.equal(visitKind(loadVisits(), invoices, p.id, shah, '2026-10-14'), 'new');
  assert.equal(feeFor(shah, 'follow-up'), 300);
  const v4 = saveVisit({ date: '2026-10-10', patient_id: p.id, patient_name: p.name, doctor_id: shah.id });
  assert.deepEqual([v4.kind, v4.fee], ['follow-up', 300]);
  deleteVisit(v4.id);
  assert.equal(saveVisit({ date: '2026-10-10', patient_name: 'Z' }).number, 'OPD/FY26-27/0005');
  assert.throws(() => deleteVisit(v1.id), /has a bill/);
});

test('consult (exempt) + cosmetic (18%) → Table 8 exempt; Rule 46A title; visit snapshot printed after the doctor is edited', () => {
  saveStaff({ name: 'Dr Shah', role: 'doctor', employment: 'freelance' });
  const staffId = getTable<{ id: string }>('service_staff')[0].id;
  const shah = doctorsDb.save({ name: 'Dr Shah', council: 'MMC', reg_no: '2011/04/1234', consult_fee: 600, staff_id: staffId, active: true });
  const p = savePatient({ name: 'Mrs Rao', patient: { uhid: 'MC26-0412' } }, '2026-10-05');
  saveServiceSettings({ rule46a: true }); // the clinic profile's default
  const v = saveVisit({ date: '2026-10-05', patient_id: p.id, patient_name: p.name, doctor_id: shah.id });
  const peel = clinicLine('Chemical peel', 2000, { date: '2026-10-05', cls: 'health_cosmetic' });
  const inv = billVisit(v.id, [peel]);
  assert.equal(inv.status, 'Draft');
  assert.equal(loadVisits().find((x) => x.id === v.id)?.status, 'billed');
  const consult = inv.items[0];
  assert.deepEqual([consult.tax_rate, consult.hsn, consult.sv?.exempt, consult.sv?.staff_id], [0, '999312', 'EXEMPT', staffId]);
  assert.equal(inv.items[1].tax_rate, 18);
  assert.deepEqual(inv.sv?.visit, { id: v.id, number: v.number, uhid: 'MC26-0412', doctor_id: shah.id, doctor_name: 'Dr Shah', doctor_reg: 'MMC 2011/04/1234', token: 1 });
  doctorsDb.save({ ...shah, reg_no: 'CHANGED' });
  assert.equal(visitText(localDb.invoices.getById(inv.id)!), 'UHID MC26-0412 · Dr Shah (Reg. no. MMC 2011/04/1234) · Token 1');
  assert.equal(inv.sv?.rule46a, true);
  assert.equal(svDocTitle(inv), 'Invoice-cum-Bill of Supply');
  localDb.invoices.save({ ...inv, status: 'Sent' });
  const rep = buildGstReport(getTable<InvoiceRecord>('invoices'), [], { period: { kind: 'month', fyStart: 2026, month: 10 }, gstin: SELLER.companyGstin });
  assert.equal(rep.gstr1.nil[0]?.exempt, 600);
  assert.throws(() => billVisit(v.id), /already billed/);
});

test('registrations print when set; expiry within 60 days is a bell row', () => {
  assert.equal(svRegText({}), '');
  assert.equal(svRegText({ sv_regs: { cea: 'CEA/MH/123', nabl: 'MC-1234', pcpndt: 'PN-9' } }), 'Reg. CEA/MH/123 · NABL MC-1234 · PCPNDT PN-9');
  assert.equal(regExpiry({ sv_regs: { cea: 'X', cea_valid: '2026-12-01' } }, '2026-10-05'), 57);
  assert.equal(regExpiry({ sv_regs: { cea: 'X', cea_valid: '2027-03-01' } }, '2026-10-05'), null);
  assert.equal(regExpiry({ sv_regs: { cea: 'X', cea_valid: '2026-10-01' } }, '2026-10-05'), -4, 'expired');
});

test('rate list: health classes only, two languages, out of date after a price change', () => {
  const items = [
    { id: 'a', name: 'Consultation', rate: 600, unit: 'Visit', sv_class: 'health_exempt' as const },
    { id: 'b', name: 'Chemical peel', rate: 2000, sv_class: 'health_cosmetic' as const },
    { id: 'c', name: 'Shampoo', rate: 200 },
  ];
  const rows = rateRows(items, { rate_names: { a: 'सल्ला' } });
  assert.deepEqual(rows.map((r) => r.name), ['Chemical peel', 'Consultation']);
  const html = rateListHtml(rows, { business: 'Clinic', asOn: '05/10/2026', lang: 'मराठी', size: 'A3', money: (n) => `₹${n}` });
  assert.match(html, /सल्ला/);
  assert.match(html, /Rates as on 05\/10\/2026/);
  assert.match(html, /size:A3/);
  assert.ok(!/<script/i.test(html));
  const stamp = printedStamp(rows, '2026-10-05');
  assert.equal(ratesOutOfDate(rows, { rates_printed: stamp }), false);
  assert.equal(ratesOutOfDate(rateRows([{ ...items[0], rate: 700 }, items[1]]), { rates_printed: stamp }), true);
  assert.equal(ratesOutOfDate(rows, {}), false, 'never printed: no nag');
});

test('pack-off gate: the clinic desk is a lazy chunk listed only with the clinic pack', () => {
  const time = readFileSync(new URL('../src/pages/Time.tsx', import.meta.url), 'utf8');
  assert.match(time, /lazy\(\(\) => import\('\.\.\/components\/services-r10\/ClinicDesk'\)\)/);
  assert.match(time, /tab === 'clinic' && <Suspense/);
  const tabs = readFileSync(new URL('../src/pages/page-tabs.ts', import.meta.url), 'utf8');
  assert.match(tabs, /\{ id: 'clinic', pack: 'clinic' \}/);
});
