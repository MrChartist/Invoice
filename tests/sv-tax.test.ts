/** SV-A4 service tax classes: dated rates, the exempt column in GSTR-1 / 3B, Rule 46A, ITC caution, Rule 42, notices. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { SELLER, clientMH, clientRetail, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';
import type { SvLine } from '../src/types/services-r10.ts';
import { serviceClassAt } from '../src/lib/service-rules.ts';
import { classPatch, compositionNote, itcCautionFor, offerSplit, rule46aApplies, svExceptions, svExemptLike } from '../src/lib/services/sv-tax.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { svDocTitle } from '../src/components/templates/paper-helpers.ts';
import { billWarnings, setSvBillCaution } from '../src/lib/bill-guard.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

function bill(date: string, lines: { name: string; rate: number; tax: number; sv?: SvLine }[], client = clientRetail, over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  const rec = createViaStore({ client, date, lines: lines.map((l) => ({ name: l.name, rate: l.rate, qty: 1, tax: l.tax })) });
  return localDb.invoices.save({ ...rec, items: rec.items.map((it, i): InvoiceItem => ({ ...it, ...(lines[i].sv ? { sv: lines[i].sv } : {}) })), ...over });
}

test('class → rate on dates either side of 2022-07-18 and 2025-09-22; a typed rate is kept', () => {
  assert.equal(serviceClassAt('hospital_room_high', '2022-07-17').rate, 0);
  assert.deepEqual(serviceClassAt('hospital_room_high', '2022-07-18'), { rate: 5, sac: '9993', noItc: true });
  assert.equal(serviceClassAt('beauty_9997', '2025-09-21').rate, 18);
  assert.equal(serviceClassAt('beauty_9997', '2025-09-22').rate, 5);
  assert.equal(serviceClassAt('fitness_9997', '2026-01-01').sac, '999723');
  assert.deepEqual(classPatch({ hsn: '', tax_rate: 18 }, 'beauty_9997', '2026-10-01'), { hsn: '999721', tax_rate: 5, sv: { cls: 'beauty_9997' } });
  assert.deepEqual(classPatch({ hsn: '9993', tax_rate: 12 }, 'beauty_9997', '2026-10-01', true), { sv: { cls: 'beauty_9997' } }, 'typed rate and HSN kept');
  assert.deepEqual(classPatch({ hsn: '', tax_rate: 18 }, 'health_exempt', '2026-10-01'), { hsn: '9993', tax_rate: 0, sv: { cls: 'health_exempt', exempt: 'EXEMPT' } });
  assert.deepEqual(classPatch({ tax_rate: 0, sv: { cls: 'health_exempt', exempt: 'EXEMPT', staff_id: 's' } }, '', '2026-10-01'), { sv: { staff_id: 's' } });
});

test('GSTR-1 Table 8 / 3B: an exempt line goes to exempt (3.1(c)), non-GST to 3.1(e); a 0% line without the key stays nil', () => {
  bill('2026-10-05', [{ name: 'Consultation', rate: 1000, tax: 0, sv: { exempt: 'EXEMPT', cls: 'health_exempt' } }, { name: 'Peel', rate: 2000, tax: 18, sv: { cls: 'health_cosmetic' } }, { name: 'Plain 0%', rate: 300, tax: 0 }, { name: 'Out of GST', rate: 100, tax: 0, sv: { exempt: 'NON_GST' } }]);
  const rep = buildGstReport(getTable<InvoiceRecord>('invoices'), [], { period: { kind: 'month', fyStart: 2026, month: 10 }, gstin: SELLER.companyGstin });
  assert.deepEqual(rep.gstr1.nil, [{ type: 'INTRAB2C', nil: 300, exempt: 1000, nonGst: 100 }]);
  assert.deepEqual(rep.gstr3b.outward.nilExempt, { inter: 0, intra: 1300 });
  assert.equal(rep.gstr3b.outward.nonGst, 100);
  assert.equal(rep.gstr3b.outward.taxable.taxable, 2000);
});

test('Rule 46A: title only for a GSTIN-less recipient with taxable + 0% lines and the switch snapshotted; split offered for B2B', () => {
  const mixed = bill('2026-10-05', [{ name: 'Consultation', rate: 1000, tax: 0, sv: { exempt: 'EXEMPT' } }, { name: 'Peel', rate: 2000, tax: 18 }], clientRetail, { sv: { rule46a: true } });
  assert.equal(rule46aApplies(mixed), true);
  assert.equal(svDocTitle(mixed), 'Invoice-cum-Bill of Supply');
  assert.equal(svDocTitle({ ...mixed, sv: undefined }), '', 'switch off at save: ordinary title');
  assert.equal(svDocTitle({ ...mixed, items: mixed.items.slice(1) }), '', 'not mixed');
  const b2b = { ...mixed, client: clientMH };
  assert.equal(svDocTitle(b2b), '');
  assert.equal(offerSplit(b2b), true);
  // Snapshot: the stored record keeps `sv` through normalizeRecord.
  assert.equal(localDb.invoices.getById(mixed.id)!.sv?.rule46a, true);
});

test('ITC caution on a bill only after a 5%-no-ITC class is sold this FY; Rule 42 exempt-like turnover; switch off', () => {
  const b = { date: '2026-10-10', itc_eligible: true, cgst: 90, sgst: 90 };
  assert.equal(itcCautionFor(b, getTable('invoices'), {}), false);
  bill('2026-10-05', [{ name: 'Colour', rate: 2000, tax: 5, sv: { cls: 'beauty_9997' } }, { name: 'Shampoo', rate: 500, tax: 18 }]);
  const inv = getTable<InvoiceRecord>('invoices');
  assert.equal(itcCautionFor(b, inv, {}), true);
  assert.equal(itcCautionFor({ ...b, itc_use: 'taxable_only' }, inv, {}), false, 'goods for resale');
  assert.equal(itcCautionFor(b, inv, { itc_caution: false }), false);
  assert.equal(svExemptLike(inv, '2026-10-01', '2026-10-31'), 2000);
  assert.equal(svExemptLike(inv, '2026-10-01', '2026-10-31', { no_itc_as_exempt: false }), 0);
  // The bill guard shows the registered caution.
  setSvBillCaution((x) => (itcCautionFor(x, inv, {}) ? 'CAUTION' : ''));
  assert.ok(billWarnings({ ...b, vendor_name: 'V', bill_number: 'B1', total: 1180, taxable: 1000 } as never, []).includes('CAUTION'));
});

test('composition notice and the exceptions checks', () => {
  const beauty = bill('2026-10-05', [{ name: 'Colour', rate: 2000, tax: 18, sv: { cls: 'beauty_9997' } }]);
  assert.deepEqual(svExceptions(beauty).map((x) => x.code), ['SV_RATE_OLD']);
  const nil = bill('2026-10-05', [{ name: 'Consult', rate: 500, tax: 0, sv: { cls: 'health_exempt' } }]);
  assert.deepEqual(svExceptions(nil).map((x) => x.code), ['SV_NIL_NOT_EXEMPT']);
  const inv = getTable<InvoiceRecord>('invoices');
  assert.equal(compositionNote(inv, { gst_scheme: 'regular' }, '2026-10-27'), null);
  assert.deepEqual(compositionNote(inv, { gst_scheme: 'composition' }, '2026-10-27'), { composition: 6, regular: 5 });
  assert.equal(compositionNote(inv, { gst_scheme: 'composition' }, '2025-01-01'), null);
});
