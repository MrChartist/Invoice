/**
 * R4-C1: exporter profile (IEC / AD code), LUT register (pick by FY + GSTIN, auto-fill never overwrites a typed
 * LUT), the two preflight codes, the e-Invoice CntCode pre-fill, the printed export block and the LUT notices.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  adCodeProblem, cntCodeOf, cleanExportFields, countryLabel, exportPrintRows, hasExportFields, iecProblem, isExportDoc, isLutSupply,
} from '../src/lib/trade/exporter.ts';
import { packingExportMeta } from '../src/lib/packing-print.ts';
import { fyOf, fyRange, lutAutofill, lutDb, lutIssues, lutProblems, normalizeLut, pickLut } from '../src/lib/trade/lut-register.ts';
import { lutNotices } from '../src/lib/trade/lut-alerts.ts';
import { buildPreflight } from '../src/lib/gst-preflight.ts';
import { getTable } from '../src/lib/storage.ts';
import type { LutRow } from '../src/types/trade-r4.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => resetStorage());

const lut = (over: Partial<LutRow>): LutRow => normalizeLut({ id: over.arn ?? 'l', fy: 'FY26-27', gstin: '', arn: 'AD270426000123A', filed_on: '2026-03-20', ...over });

test('IEC is 10 letters / digits; AD code is 14 digits; blank is fine', () => {
  assert.equal(iecProblem('AAPFU0939F'), '');
  assert.equal(iecProblem(''), '');
  assert.equal(iecProblem('AAPFU0939'), 'iecBad');
  assert.equal(iecProblem('AAPFU-0939F'), 'iecBad');
  assert.equal(adCodeProblem('0510005 2900009'), '', 'spaces ignored');
  assert.equal(adCodeProblem('05100052900009'), '');
  assert.equal(adCodeProblem('0510005290000'), 'adBad');
  assert.equal(adCodeProblem('05100052900A09'), 'adBad');
});

test('export documents: EXPORT_* supply or place of supply 96 / 97; LUT supplies are the zero-rated ones without payment', () => {
  assert.equal(isExportDoc({ supply_type: 'EXPORT_LUT', place_of_supply: '27' }), true);
  assert.equal(isExportDoc({ supply_type: 'EXPORT_WITH_PAYMENT', place_of_supply: '' }), true);
  assert.equal(isExportDoc({ supply_type: 'B2B', place_of_supply: '96' }), true);
  assert.equal(isExportDoc({ supply_type: 'B2B', place_of_supply: '97' }), true);
  assert.equal(isExportDoc({ supply_type: 'B2B', place_of_supply: '27' }), false);
  assert.equal(isLutSupply({ supply_type: 'SEZ_WITHOUT_PAYMENT' }), true);
  assert.equal(isLutSupply({ supply_type: 'EXPORT_WITH_PAYMENT' }), false);
});

test('LUT register: FY ranges, validation, pick by FY and GSTIN (a GSTIN-specific row wins over an all-GSTIN one)', () => {
  assert.deepEqual(fyRange('FY26-27'), { from: '2026-04-01', to: '2027-03-31' });
  assert.equal(fyOf('2027-03-31'), 'FY26-27');
  assert.equal(fyOf('2027-04-01'), 'FY27-28');
  assert.deepEqual(lutProblems({ fy: 'FY26-27', arn: 'AD27', filed_on: '2026-03-20' }), ['lutArnBad']);
  assert.deepEqual(lutProblems({ fy: 'x', arn: 'AD270426000123A', filed_on: '' }), ['lutFyBad', 'lutFiledBad', 'lutRangeBad']);
  const all = lut({ id: 'a', arn: 'ALLGSTIN000000001' });
  const mh = lut({ id: 'b', gstin: '27AAPFU0939F1ZV', arn: 'MHGSTIN0000000001' });
  const old = lut({ id: 'c', fy: 'FY25-26', arn: 'OLDYEAR0000000001', filed_on: '2025-03-10' });
  assert.equal(all.valid_from, '2026-04-01', 'validity defaults to the FY');
  assert.equal(pickLut([all, mh, old], '2026-07-01', '27AAPFU0939F1ZV')?.arn, 'MHGSTIN0000000001');
  assert.equal(pickLut([all, mh, old], '2026-07-01', '29AAACB2230M1ZQ')?.arn, 'ALLGSTIN000000001');
  assert.equal(pickLut([all, mh, old], '2026-01-15', '27AAPFU0939F1ZV')?.arn, 'OLDYEAR0000000001');
  assert.equal(pickLut([all, mh], '2027-04-02'), null, 'no LUT for FY27-28');
});

test('auto-fill: ARN + filed date for a zero-rated supply without payment; never over a typed LUT; nothing for other supplies', () => {
  const reg = [lut({ arn: 'AD270426000123A' })];
  const inv = { supply_type: 'EXPORT_LUT' as const, issue_date: '2026-06-01', lut_number: '', lut_date: '' };
  assert.deepEqual(lutAutofill(inv, reg), { lut_number: 'AD270426000123A', lut_date: '2026-03-20' });
  assert.equal(lutAutofill({ ...inv, lut_number: 'MY-OWN-LUT' }, reg), null, 'typed LUT kept');
  assert.equal(lutAutofill({ ...inv, supply_type: 'EXPORT_WITH_PAYMENT' }, reg), null);
  assert.equal(lutAutofill({ ...inv, issue_date: '2027-05-01' }, reg), null, 'no LUT for that FY');
});

test('preflight: LUT_MISSING (error) and LUT_OUTSIDE_FY (warning); drafts and paid exports ignored', () => {
  const reg = [lut({ fy: 'FY25-26', arn: 'OLDYEAR0000000001', filed_on: '2025-03-10' })];
  const invs: Partial<InvoiceRecord>[] = [
    { id: 'i1', invoice_number: 'EXP/1', doc_type: 'INVOICE', status: 'Sent', supply_type: 'EXPORT_LUT', issue_date: '2026-05-01', lut_number: '' },
    { id: 'i2', invoice_number: 'EXP/2', doc_type: 'INVOICE', status: 'Sent', supply_type: 'EXPORT_LUT', issue_date: '2026-05-02', lut_number: 'OLDYEAR0000000001' },
    { id: 'i3', invoice_number: 'EXP/3', doc_type: 'INVOICE', status: 'Draft', supply_type: 'EXPORT_LUT', issue_date: '2026-05-02' },
    { id: 'i4', invoice_number: 'EXP/4', doc_type: 'INVOICE', status: 'Sent', supply_type: 'EXPORT_WITH_PAYMENT', issue_date: '2026-05-02' },
  ];
  const issues = lutIssues(invs, reg);
  assert.deepEqual(issues.map((i) => [i.code, i.number, i.lutFy ?? '']), [['LUT_MISSING', 'EXP/1', ''], ['LUT_OUTSIDE_FY', 'EXP/2', 'FY25-26']]);
  const groups = buildPreflight({ exceptions: [], issues: [], gaps: [], lut: issues });
  assert.deepEqual(groups.map((g) => [g.code, g.severity, g.count]), [['LUT_MISSING', 'error', 1], ['LUT_OUTSIDE_FY', 'warning', 1]]);
  assert.match(String(groups[0].vars.message), /verify with your CA/);
  assert.equal(groups[0].items[0].link, '/invoice/i1');
  assert.deepEqual(buildPreflight({ exceptions: [], issues: [], gaps: [] }), [], 'no LUT input → nothing new');
});

test('QA6 F6: LUT_MISSING for an export saved as "Tax Invoice" (or a bill of supply); never for a quotation / proforma', () => {
  const base = { status: 'Sent' as const, supply_type: 'EXPORT_LUT' as const, issue_date: '2026-05-01', lut_number: '', currency: 'USD', shipping_bill_no: '123' };
  const invs: Partial<InvoiceRecord>[] = [
    { ...base, id: 't1', invoice_number: 'EXP/T1', doc_type: 'TAX_INVOICE' },
    { ...base, id: 'b1', invoice_number: 'EXP/B1', doc_type: 'BILL_OF_SUPPLY' },
    { ...base, id: 'q1', invoice_number: 'QT/1', doc_type: 'QUOTATION' },
    { ...base, id: 'p1', invoice_number: 'PF/1', doc_type: 'PROFORMA' },
    { ...base, id: 'd1', invoice_number: 'DC/1', doc_type: 'DELIVERY_CHALLAN' },
  ];
  assert.deepEqual(lutIssues(invs, []).map((i) => [i.code, i.number]), [['LUT_MISSING', 'EXP/T1'], ['LUT_MISSING', 'EXP/B1']]);
});

test('the LUT store needs settings.manage, refuses duplicates and is audited as a watched table', () => {
  const row = lutDb.save({ fy: 'FY26-27', gstin: '', arn: 'ad270426000123a', filed_on: '2026-03-20' });
  assert.equal(row.arn, 'AD270426000123A');
  assert.throws(() => lutDb.save({ fy: 'FY26-27', gstin: '', arn: 'AD270426000123A', filed_on: '2026-03-21' }), /lutDuplicate/);
  assert.equal(getTable<LutRow>('lut_register').length, 1);
  lutDb.remove(row.id);
  assert.equal(lutDb.all().length, 0);
});

test('e-Invoice CntCode is pre-filled from the destination; the printed block is hidden without export data', () => {
  assert.equal(cntCodeOf({ country_of_destination: 'AE' }), 'AE');
  assert.equal(cntCodeOf({ country_of_destination: 'us — United States' }), 'US', 'old stored text still reads');
  assert.equal(cntCodeOf({ country_of_destination: 'us: United States' }), 'US');
  assert.equal(cntCodeOf({ country_of_destination: 'USA' }), '', 'not an ISO-2 code');
  assert.equal(cntCodeOf({}), '');
  assert.deepEqual(exportPrintRows({ supply_type: 'B2B', place_of_supply: '27' }, { iec: 'AAPFU0939F' }), [], 'domestic: nothing printed');
  assert.equal(hasExportFields({ incoterm: ' ' }), false);
  const rows = exportPrintRows(
    { supply_type: 'EXPORT_LUT', place_of_supply: '96', incoterm: 'FOB', port_of_loading: 'Nhava Sheva', country_of_destination: 'AE', marks_numbers: 'ACME/1-10' },
    { iec: 'AAPFU0939F', ad_code: '05100052900009', ad_bank: 'HDFC Fort' },
  );
  assert.deepEqual(rows.map((r) => r.key), ['iec', 'ad_code', 'incoterm', 'port_of_loading', 'country_of_origin', 'country_of_destination', 'marks_numbers']);
  assert.equal(rows.find((r) => r.key === 'country_of_origin')?.value, 'IN: India', 'origin defaults to India');
  assert.equal(rows.find((r) => r.key === 'ad_code')?.value, '05100052900009 (HDFC Fort)');
  assert.deepEqual(exportPrintRows({ supply_type: 'EXPORT_LUT' }, { iec: 'AAPFU0939F' }).map((r) => r.key), ['iec'], 'IEC alone on an export');
  assert.equal(countryLabel('ZZ'), 'ZZ');
});

test('export fields are cleaned (codes upper-cased, unknown Incoterm dropped) and reused by the packing list', () => {
  assert.deepEqual(cleanExportFields({ incoterm: 'fob', country_of_destination: 'ae', marks_numbers: '  M/1  ', vessel_flight: '' }), { incoterm: 'FOB', country_of_destination: 'AE', marks_numbers: 'M/1', vessel_flight: undefined });
  assert.deepEqual(cleanExportFields({ incoterm: 'XYZ' }), { incoterm: undefined });
  assert.deepEqual(packingExportMeta({ port_of_loading: 'Nhava Sheva', country_of_destination: 'AE', marks_numbers: 'M/1' }), [['Port of loading', 'Nhava Sheva'], ['Final destination', 'AE'], ['Marks & nos.', 'M/1']]);
});

test('bell: "No LUT for FY27-28 yet" from 15 March; exports this FY without an LUT on record', () => {
  const at = '2027-03-16T00:00:00.000Z';
  const reg = [lut({ fy: 'FY26-27' })];
  assert.deepEqual(lutNotices(reg, [], '2027-03-16', at).map((n) => n.id), ['lut-next:FY27-28']);
  assert.deepEqual(lutNotices(reg, [], '2027-03-10', at), [], 'not before 15 March');
  assert.deepEqual(lutNotices([...reg, lut({ fy: 'FY27-28', arn: 'NEXTYEAR000000001' })], [], '2027-03-16', at), []);
  const exp = { supply_type: 'EXPORT_LUT' as const, status: 'Sent' as const, issue_date: '2027-04-05' };
  const now = lutNotices(reg, [exp], '2027-04-10', at);
  assert.deepEqual(now.map((n) => [n.id, n.severity]), [['lut-now:FY27-28', 'warning']]);
  assert.match(now[0].detail, /Rule 96A/);
});
