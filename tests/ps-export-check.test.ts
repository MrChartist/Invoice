/** R14 PS-C1: the Sec 2(6) export-of-services check, the dated intermediary rule (PS4) and the indent note (TR21). */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, SELLER } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { exportCheck, preflightIssues, verdict, withChecks } from '../src/lib/prof/ps-export-check.ts';
import { servicePos } from '../src/lib/prof/ps-pos.ts';
import { INTERMEDIARY_POS_RULES, intermediaryPos } from '../src/lib/prof-rules.ts';
import { buildCommissionInvoice } from '../src/lib/trade/tr-indents.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { Indent } from '../src/types/trade-r8.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const inv = (over: Record<string, unknown> = {}) => ({
  id: 'i1', invoice_number: 'INV/FY26-27/0001', doc_type: 'INVOICE', status: 'Sent', supply_type: 'EXPORT_LUT', place_of_supply: '96', currency: 'USD',
  total: 2200, issue_date: '2026-10-31', sender: SELLER, client: { id: 'c1', name: 'Acme Inc' }, items: [{ id: 'l', name: 'Consulting', type: 'Service', hsn: '998313', quantity: 40, rate: 55, tax_rate: 0, amount: 2200 }],
  ...over,
}) as Partial<InvoiceRecord>;
const us = { ps: { country: 'US' } };
const states = (c: ReturnType<typeof exportCheck>) => c.items.map((i) => `${i.id}:${i.state}`).join(' ');

test('a US client, LUT, USD: 4 / 5 with payment pending, then 5 / 5 after the receipt', () => {
  const c = exportCheck({ invoice: inv(), client: us });
  assert.equal(states(c), 'supplier:ok recipient:ok pos:ok payment:pending distinct:ok');
  assert.equal(c.ok, 4);
  assert.equal(verdict(c), 'pending');
  const paid = exportCheck({ invoice: inv(), client: us, receipts: [{ invoice_id: 'i1', amount: 2200, date: '2026-11-20' }] });
  assert.equal(paid.ok, 5);
  assert.equal(verdict(paid), 'export');
  // An IRM allocated to it counts the same; a write-off brings no money in.
  assert.equal(exportCheck({ invoice: inv(), client: us, irms: [{ allocations: [{ invoice_id: 'i1', fcy: 100 }] }] }).items[3].state, 'ok');
  assert.equal(exportCheck({ invoice: inv(), client: us, receipts: [{ invoice_id: 'i1', amount: 2200, write_off: true }] }).items[3].state, 'pending');
});

test('recipient in India, an Indian establishment, own branch → not an export', () => {
  assert.equal(exportCheck({ invoice: inv(), client: { ps: { country: 'India' } } }).items[1].reason, 'recipientIndia');
  const est = exportCheck({ invoice: inv(), client: { ps: { country: 'GB', fixed_estab_in_india: true } } });
  assert.deepEqual([est.items[1].state, est.items[1].reason, verdict(est)], ['fail', 'estabIndia', 'not']);
  const br = exportCheck({ invoice: inv(), client: { ps: { country: 'US', relation: 'distinct_person' } } });
  assert.deepEqual([br.items[4].state, verdict(br)], ['fail', 'not']);
  assert.equal(exportCheck({ invoice: inv(), client: { ps: { country: 'US', relation: 'group' } } }).items[4].state, 'ok');
  // No country: place of supply 96 → abroad; an Indian document with no country → unknown.
  assert.equal(exportCheck({ invoice: inv(), client: {} }).items[1].state, 'ok');
  assert.equal(exportCheck({ invoice: inv({ place_of_supply: '27' }), client: { state_code: '27' } }).items[1].state, 'unknown');
});

test('place of supply: immovable property in India (13(4)), physical presence, events', () => {
  const prop = exportCheck({ invoice: inv({ ps: { export: { pos_class: 'property', property_state: '27' } } }), client: us });
  assert.deepEqual([prop.items[2].state, prop.items[2].reason, verdict(prop)], ['fail', 'posProperty', 'not']);
  assert.equal(exportCheck({ invoice: inv({ ps: { export: { pos_class: 'property', property_state: '96' } } }), client: us }).items[2].state, 'ok');
  assert.equal(exportCheck({ invoice: inv(), client: us, engagement: { pos_class: 'physical' } }).items[2].state, 'unknown');
  assert.equal(exportCheck({ invoice: inv({ ps: { export: { pos_class: 'event', abroad: true } } }), client: us }).items[2].state, 'ok');
  assert.equal(servicePos({ cls: 'physical', abroad: false, recipientAbroad: true }).abroad, false);
});

test('intermediary: supplier’s location to 29 Mar 2026, Sec 13(2) from 30 Mar 2026 (dated, append-only)', () => {
  assert.equal(intermediaryPos('2026-03-29'), 'supplier');
  assert.equal(intermediaryPos('2026-03-30'), 'recipient');
  assert.equal(intermediaryPos('2026-04-01'), 'recipient');
  assert.ok(INTERMEDIARY_POS_RULES.every((r) => r.from && r.source && typeof r.verified === 'boolean'));
  const x = (date: string) => exportCheck({ invoice: inv({ issue_date: date, ps: { export: { pos_class: 'intermediary' } } }), client: us });
  assert.deepEqual([x('2026-03-29').items[2].state, x('2026-03-29').items[2].reason], ['fail', 'posIntermediaryOld']);
  assert.deepEqual([x('2026-03-30').items[2].state, x('2026-03-30').items[2].reason], ['ok', 'posIntermediaryNew']);
});

test('payment in INR: only through a route marked RBI-permitted (SRVA, Circular 202/14/2023)', () => {
  const r = [{ invoice_id: 'i1', amount: 100000 }];
  assert.deepEqual([exportCheck({ invoice: inv({ currency: 'INR' }), client: us, receipts: r }).items[3].reason], ['payInr']);
  const ok = exportCheck({ invoice: inv({ currency: 'INR', ps: { export: { inr_permitted: true } } }), client: us, receipts: r });
  assert.deepEqual([ok.items[3].state, ok.items[3].reason], ['ok', 'payInrRbi']);
});

test('snapshot keeps the other ps sub-objects; preflight: warning on a failing LUT export, info while pending', () => {
  const doc = inv({ ps: { matter: { id: 'm', code: 'M1', name: 'M' }, purpose_code: 'P0802', export: { pos_class: 'general' } } });
  const c = exportCheck({ invoice: doc, client: us });
  const snap = withChecks(doc, c) as InvoiceRecord;
  assert.equal(snap.ps?.matter?.code, 'M1');
  assert.equal(snap.ps?.purpose_code, 'P0802');
  assert.equal(snap.ps?.export?.pos_class, 'general');
  assert.deepEqual(snap.ps?.export?.checks, [{ key: 'supplier', ok: true }, { key: 'recipient', ok: true }, { key: 'pos', ok: true }, { key: 'payment', ok: false }, { key: 'distinct', ok: true }]);
  assert.equal(snap.ps?.export?.checked_on, '2026-10-31');
  const issues = preflightIssues([inv(), inv({ id: 'i2', invoice_number: 'B', client: { id: 'c2', name: 'Branch' } }), inv({ id: 'i3', supply_type: 'EXPORT_WITH_PAYMENT' })], { clients: [{ id: 'c1', ps: { country: 'US' } }, { id: 'c2', ps: { country: 'US', relation: 'distinct_person' } }] });
  assert.deepEqual(issues.map((i) => `${i.invoiceId}:${i.severity}:${i.code}`), ['i1:info:PS_EXPORT_PENDING', 'i2:warning:PS_EXPORT_FAIL']);
});

test('TR21 indent note reads the dated rule: "not an export" before 30 Mar 2026 only', () => {
  const row = { id: 'n', number: 'IND/1', date: '2026-01-01', buyer_name: 'B', principal_id: 'p', principal_name: 'Mill GmbH', item: 'Yarn', qty: 10, rate: 100, commission_basis: 'percent', commission_rate: 2, status: 'dispatched' } as Indent;
  const principal = { id: 'p', name: 'Mill GmbH', email: '', address: 'Berlin', city: 'Berlin', zip: '', state_code: '96' };
  const note = (date: string) => buildCommissionInvoice([row], { principal, date, settings: localDb.settings.get(), sender: SELLER }).notes ?? '';
  assert.match(note('2026-03-29'), /not an export/);
  assert.doesNotMatch(note('2026-04-01'), /not an export/);
  assert.match(note('2026-04-01'), /Sec 13\(2\).*2\(6\)/);
});
