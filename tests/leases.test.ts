/** R5-C5: escalation, pro rata, GST class by use × registration × date, the recurring amount hook, 194-I, rent roll, bell. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupR5c } from './helpers/r5c.ts';
import { BUYER_MH } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { escalatedAmount, firstStep, leaseLineRates, nextEscalation, prorataFactor, stepsOn } from '../src/lib/property/escalation.ts';
import { leaseDocType, leaseGstClass } from '../src/lib/property/lease-gst.ts';
import { endLease, firstBilling, loadLeases, rentRoll, saveLease, type LeaseContext } from '../src/lib/property/leases.ts';
import { saveProperty } from '../src/lib/property/properties.ts';
import { leaseNotices } from '../src/lib/property/lease-alerts.ts';
import { recurringDb, runDueSchedules } from '../src/lib/recurring.ts';
import type { Lease } from '../src/types/institutions-r5.ts';

beforeEach(() => setupR5c());

test('escalation: pct compounds at each step from the first-step date; amount adds; next step', () => {
  const esc = { every_months: 12, kind: 'pct' as const, value: 5 };
  assert.equal(firstStep(esc, '2026-04-01'), '2027-04-01');
  assert.equal(stepsOn(esc, '2026-04-01', '2027-03-31'), 0);
  assert.equal(escalatedAmount(10000, esc, '2026-04-01', '2027-04-01'), 10500);
  assert.equal(escalatedAmount(10000, esc, '2026-04-01', '2028-05-01'), 11025);
  assert.equal(escalatedAmount(10000, { ...esc, kind: 'amount', value: 750 }, '2026-04-01', '2028-04-01'), 11500);
  assert.equal(escalatedAmount(10000, { ...esc, first_on: '2026-10-01' }, '2026-04-01', '2026-10-01'), 10500);
  assert.deepEqual(nextEscalation(10000, esc, '2026-04-01', '2027-02-15'), { date: '2027-04-01', from: 10000, to: 10500 });
  assert.equal(nextEscalation(10000, undefined, '2026-04-01', '2027-02-15'), null);
});

test('pro rata: the stub before the first billing day joins the first bill; the last month is cut at the lease end', () => {
  const e = { lines: ['rent'], lease_start: '2026-05-15', lease_end: '2026-08-20', prorata: true };
  assert.equal(firstBilling('2026-05-15', 1), '2026-06-01');
  assert.equal(firstBilling('2026-05-01', 1), '2026-05-01');
  assert.equal(prorataFactor(e, '2026-06-01', '2026-06-01', '2026-07-01'), 1 + 17 / 31);
  assert.equal(prorataFactor(e, '2026-06-01', '2026-07-01', '2026-08-01'), 1);
  assert.equal(prorataFactor(e, '2026-06-01', '2026-08-01', '2026-09-01'), 20 / 31);
  assert.equal(prorataFactor({ ...e, prorata: false }, '2026-06-01', '2026-08-01', '2026-09-01'), 1);
  const lines = leaseLineRates([{ id: 'rent', rate: 31000, quantity: 1 }, { id: 'x', rate: 50, quantity: 1 }], { ...e, prorata_lines: ['rent'] }, '2026-06-01', '2026-08-01', '2026-09-01');
  assert.deepEqual(lines.map((l) => l.rate), [20000, 50]);
});

test('GST class by use × landlord / tenant registration × date (entry 5AB from 10 Oct 2024)', () => {
  const base = { landlordRegistered: true, tenantRegistered: true, date: '2026-05-01' };
  assert.equal(leaseGstClass({ ...base, use: 'commercial' }).cls, 'taxable');
  assert.equal(leaseGstClass({ ...base, use: 'commercial' }).rate, 18);
  assert.equal(leaseGstClass({ ...base, use: 'residential_dwelling', tenantBusinessUse: true }).cls, 'rcm');
  assert.equal(leaseGstClass({ ...base, use: 'residential_dwelling', tenantBusinessUse: true, date: '2022-07-01' }).cls, 'exempt_none', 'before 18 Jul 2022');
  assert.equal(leaseGstClass({ ...base, use: 'residential_dwelling', exemptBos: true }).cls, 'exempt_bos');
  assert.equal(leaseGstClass({ ...base, use: 'residential_dwelling', tenantRegistered: false }).cls, 'exempt_none');
  const unreg = { ...base, landlordRegistered: false, use: 'commercial' as const };
  assert.deepEqual([leaseGstClass(unreg).cls, leaseGstClass(unreg).note], ['unregistered', 'rcm5ab']);
  assert.equal(leaseGstClass({ ...unreg, date: '2024-10-09' }).note, '', 'entry 5AB starts 10 Oct 2024');
  assert.equal(leaseGstClass({ ...unreg, tenantComposition: true, date: '2025-02-01' }).note, '');
  assert.equal(leaseDocType('exempt_none'), null);
  assert.deepEqual(leaseDocType('rcm'), { doc: 'TAX_INVOICE', reverse: true, gst: true });
});

function world(): LeaseContext {
  const tenantId = localDb.clients.upsert({ name: 'Shop Tenant', email: '', address: '', city: 'Mumbai', zip: '', state_code: '27', gstin: BUYER_MH });
  const property = saveProperty({ name: 'Market Plaza', address: 'Mumbai', state: '27', units: [{ name: 'Shop 1', area: 400, use: 'commercial' }, { name: 'Flat 2', use: 'residential_dwelling' }] });
  return { tenant: localDb.clients.getById(tenantId)!, property, sender: localDb.settings.activeProfile() ?? null, templateId: 'classic_orange', roundOff: false };
}

const lease = (ctx: LeaseContext, over: Partial<Lease> = {}) => saveLease({
  property_id: ctx.property.id, unit_ids: [ctx.property.units[0].id], tenant_id: ctx.tenant.id!, start: '2026-01-01', end: '2027-12-31', rent: 50000, cam: 10, cam_basis: 'sqft',
  billing_day: 1, due_days: 7, escalation: { every_months: 12, kind: 'pct', value: 5 }, gst_class: 'taxable', tds: { section: '194I-B' }, ...over,
}, ctx);

test('saving a lease creates one recurring schedule; generated rent documents escalate, carry 194-I and never change', () => {
  const ctx = world();
  const l = lease(ctx);
  const s = recurringDb.getById(l.schedule_id)!;
  assert.equal(s.lease_id, l.id);
  assert.equal(s.end_date, '2027-12-31');
  assert.deepEqual(s.escalation?.lines, ['rent']);
  runDueSchedules('2027-01-15');
  const docs = localDb.invoices.getAll().filter((i) => i.recurring_id === s.id).sort((a, b) => a.issue_date.localeCompare(b.issue_date));
  assert.equal(docs.length, 12, 'catch-up is capped at 12 occurrences');
  const dec = docs.find((d) => d.issue_date === '2026-12-01')!;
  const jan = docs.find((d) => d.issue_date === '2027-01-01')!;
  assert.equal(dec.items[0].rate, 50000);
  assert.equal(jan.items[0].rate, 52500, 'rent escalated from the step date');
  assert.equal(jan.items[1].rate, 4000, 'CAM ₹10 / sq ft × 400 — not escalated');
  assert.equal(jan.tds_section, '194I-B');
  assert.equal(jan.tds_rate, 10);
  assert.ok(jan.tds_amount > 0);
  assert.equal(jan.doc_type, 'TAX_INVOICE');
  assert.ok(jan.cgst_amount > 0);
  // Editing the escalation later never changes an issued document.
  saveLease({ ...l, escalation: { every_months: 12, kind: 'pct', value: 50 } }, ctx);
  assert.equal(localDb.invoices.getById(jan.id)!.items[0].rate, 52500);
  // Ending the lease stops the schedule.
  endLease(l.id, '2027-02-15');
  assert.equal(recurringDb.getById(l.schedule_id)!.end_date, '2027-02-15');
  assert.equal(loadLeases()[0].status, 'ended');
});

test('reverse charge rent: tax kept out of the total; exempt with no document: no schedule', () => {
  const ctx = world();
  const rcm = lease(ctx, { unit_ids: [ctx.property.units[1].id], gst_class: 'rcm', escalation: undefined, tds: undefined, start: '2026-05-01' });
  runDueSchedules('2026-05-02');
  const doc = localDb.invoices.getAll().find((i) => i.recurring_id === rcm.schedule_id)!;
  assert.equal(doc.reverse_charge, true);
  assert.equal(doc.rcm_tax_excluded, true);
  assert.equal(doc.total, 50000, 'the flat has no area (no CAM) and the GST stays with the tenant');
  const none = lease(ctx, { gst_class: 'exempt_none', unit_ids: [ctx.property.units[1].id] });
  assert.equal(none.schedule_id, '');
});

test('rent roll and bell: current rent, next escalation, dues; escalation / lock-in / expiry notices', () => {
  const ctx = world();
  const l = lease(ctx, { lock_in_end: '2027-01-10', end: '2027-02-28', tds: undefined });
  runDueSchedules('2026-02-15');
  const row = rentRoll(loadLeases(), [ctx.property], localDb.clients.getAll(), localDb.invoices.getAll(), [], '2026-12-20')[0];
  assert.equal(row.rent, 50000);
  assert.deepEqual(row.next, { date: '2027-01-01', from: 50000, to: 52500 });
  assert.ok(row.dues > 0);
  const n = leaseNotices([l], [], [], '2026-12-20').map((x) => x.kind).sort();
  assert.deepEqual(n, ['escalation', 'lockin']);
  assert.deepEqual(leaseNotices([l], [], [], '2027-01-05').map((x) => x.kind).sort(), ['expiry', 'lockin']);
});
