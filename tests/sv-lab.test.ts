/** SV-B3 lab tests and orders: panels, ranges, flags, status flow, amended reports, bill, outsourced bill, CSV, report. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { SELLER, installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import type { LabParam } from '../src/types/services-r10.ts';
import { LAB, advanceSample, billOrder, bookOutsourcedBill, deleteTest, enterResults, expandTests, flagOf, loadOrders, logDelivery, outsourcedDue, parseRanges, parseResultsCsv, rangeFor, rangesText, saveOrder, saveTest, tatBreached, testsCsvRows, testsFromCsv } from '../src/lib/services/sv-lab.ts';
import { labReportHtml, reportRows } from '../src/lib/services/sv-lab-report.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const hb: LabParam = { code: 'HB', name: 'Haemoglobin', unit: 'g/dL', kind: 'numeric', ranges: parseRanges('M 13-17; F 12-15; 0-12y 11-14'), crit_low: 7, crit_high: 20 };
const master = () => {
  const cbc = saveTest({ code: 'cbc', name: 'CBC', dept: 'Haematology', sample: 'EDTA', tat: 4, price: 400, params: [hb, { code: 'WBC', name: 'WBC', unit: '10^3/µL', kind: 'numeric', ranges: parseRanges('4-11') }] });
  const lip = saveTest({ code: 'LIP', name: 'Lipid profile', dept: 'Biochemistry', sample: 'Serum', price: 700, params: [{ code: 'CHOL', name: 'Cholesterol', unit: 'mg/dL', kind: 'numeric', ranges: parseRanges('<200') }], outsourced: { vendor_name: 'Ref Lab', cost: 350 }, note: 'Fasting 10–12 h.' });
  const hba = saveTest({ code: 'HBA1C', name: 'HbA1c', sample: 'EDTA', price: 600, params: [{ code: 'A1C', name: 'HbA1c', unit: '%', kind: 'numeric', ranges: parseRanges('4-5.6') }] });
  const panel = saveTest({ code: 'DIAB', name: 'Diabetes panel', price: 1200, params: [], panel: [cbc.id, hba.id, cbc.id] });
  return { cbc, lip, hba, panel };
};

test('panel expansion without duplicates; ranges by sex / age band; flags H / L / critical', () => {
  const { cbc, hba, panel } = master();
  const all = getTable<never>('lab_tests');
  assert.deepEqual(expandTests([panel.id, cbc.id], all).map((t: { code: string }) => t.code), ['CBC', 'HBA1C']);
  assert.equal(cbc.code, 'CBC', 'code upper-cased');
  assert.throws(() => saveTest({ code: 'CBC', name: 'Dup', price: 1, params: [] }), /already used/);
  assert.throws(() => deleteTest(hba.id), /panel lists/);
  assert.deepEqual(rangeFor(hb, 'F', 40), { sex: 'F', low: 12, high: 15 });
  assert.deepEqual(rangeFor(hb, 'M', 8), { sex: 'M', low: 13, high: 17 }, 'sex-specific row wins over the age band');
  assert.deepEqual(rangeFor({ ranges: parseRanges('0-12y 11-14; 12-16') }, undefined, 8), { age_from: 0, age_to: 12, low: 11, high: 14 });
  assert.deepEqual([flagOf(hb, '16', 'F', 40), flagOf(hb, '11', 'F', 40), flagOf(hb, '13', 'F', 40), flagOf(hb, '6.5', 'F', 40), flagOf(hb, '21', 'M', 40), flagOf(hb, '', 'M', 40)], ['H', 'L', '', 'CL', 'CH', '']);
  assert.equal(rangesText(hb.ranges), 'M 13-17; F 12-15; 0-12y 11-14');
  assert.deepEqual(parseRanges('Negative; >5'), [{ text: 'Negative' }, { low: 5 }]);
});

test('order: numbering, samples, status flow, results, amended report keeps history, delivery, bill lines', () => {
  const { cbc, lip, hba, panel } = master();
  const o = saveOrder({ date: '2026-10-05', patient_name: 'Mrs Rao', sex: 'F', age: 54, referrer: { name: 'Dr Kulkarni' }, test_ids: [panel.id, lip.id, cbc.id] });
  assert.match(o.number, new RegExp(`^${LAB}/FY26-27/0001$`));
  assert.deepEqual(o.tests.map((t) => [t.code, t.price]), [['DIAB', 1200], ['CBC', 0], ['HBA1C', 0], ['LIP', 700]], 'CBC inside the panel is not charged twice');
  assert.deepEqual(o.samples.map((s) => s.type), ['EDTA', 'Serum']);
  advanceSample(o.id, 0, 'Asha', '2026-10-05T09:00:00.000Z');
  assert.equal(loadOrders()[0].samples[0].status, 'collected');
  assert.ok(tatBreached(o, new Date(Date.parse(o.created_at) + 5 * 3600000)));
  enterResults(o.id, { [`${cbc.id}:HB`]: '16.2' });
  assert.equal(loadOrders()[0].report, 'partial');
  const csv = parseResultsCsv('code,value\nWBC,7.1\nA1C, 6.1\nCHOL,180\nXYZ,1', o.tests);
  assert.deepEqual(csv.unknown, ['XYZ']);
  enterResults(o.id, csv.results, ['Dr Shah']);
  assert.equal(loadOrders()[0].report, 'final');
  const rows = reportRows(loadOrders()[0]);
  assert.deepEqual(rows.filter((r) => r.flag).map((r) => [r.name, r.flag]), [['Haemoglobin', 'H'], ['HbA1c', 'H']]);
  const html = labReportHtml(loadOrders()[0], { ...SELLER, sv_regs: { nabl: 'MC-1234' } }, [{ name: 'Dr Shah', qual: 'MD Path' }]);
  assert.match(html, /NABL MC-1234/);
  assert.match(html, /End of report/);
  assert.match(html, /Fasting 10–12 h\./);
  assert.ok(!/<script/i.test(html));
  logDelivery(o.id, 'whatsapp', '2026-10-05T12:00:00.000Z');
  assert.equal(loadOrders()[0].report, 'delivered');
  enterResults(o.id, { [`${cbc.id}:HB`]: '15.0' }, undefined, '2026-10-05T13:00:00.000Z');
  const amended = loadOrders()[0];
  assert.equal(amended.amended_at, '2026-10-05T13:00:00.000Z');
  assert.equal(amended.history?.[0].results[`${cbc.id}:HB`], '16.2');
  assert.match(labReportHtml(amended, SELLER), /Amended 2026-10-05 13:00/);
  const inv = billOrder(o.id, '2026-10-05');
  assert.deepEqual(inv.items.map((l) => [l.name, l.rate, l.tax_rate, l.sv?.exempt]), [['Diabetes panel', 1200, 0, 'EXEMPT'], ['Lipid profile', 700, 0, 'EXEMPT']]);
  assert.equal(inv.sv?.lab_order?.number, o.number);
  assert.equal(inv.sv?.referrer?.name, 'Dr Kulkarni');
  assert.throws(() => billOrder(o.id), /already billed/);
  void hba;
});

test('outsourced costs → one purchase bill per lab and period, never twice; master CSV round trip; pack-off gate', () => {
  const { lip, cbc } = master();
  saveOrder({ date: '2026-10-05', patient_name: 'A', test_ids: [lip.id] });
  saveOrder({ date: '2026-10-06', patient_name: 'B', test_ids: [lip.id, cbc.id] });
  const due = outsourcedDue(loadOrders(), '2026-10-01', '2026-10-31');
  assert.deepEqual(due.map((d) => [d.vendor, d.cost, d.orders.length]), [['Ref Lab', 700, 2]]);
  const bill = bookOutsourcedBill('Ref Lab', '2026-10-01', '2026-10-31', 'RL/77');
  assert.equal(bill.total, 700);
  assert.equal(bill.itc_eligible, false);
  assert.deepEqual(outsourcedDue(loadOrders(), '2026-10-01', '2026-10-31'), []);
  assert.throws(() => bookOutsourcedBill('Ref Lab', '2026-10-01', '2026-10-31', 'RL/78'), /Nothing outsourced/);
  const rows = testsCsvRows(getTable('lab_tests'));
  assert.deepEqual(rows[0].slice(0, 2), ['Code', 'Name']);
  const back = testsFromCsv(rows.map((r) => r.map(String)));
  assert.deepEqual(back.find((t) => t.code === 'CBC')?.params.map((p) => [p.code, rangesText(p.ranges)]), [['HB', 'M 13-17; F 12-15; 0-12y 11-14'], ['WBC', '4-11']]);
});
