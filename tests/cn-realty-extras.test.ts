/**
 * PENDING 14: Realty desk broker commission bill (194H draft), demand reminders through follow-ups, and closure
 * documents on a works contract (attachments panel; `works_contracts` keeps its files referenced).
 */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { thawDate } from './helpers/shim.ts';
import { BUYER, realtyWorld } from './helpers/realty.ts';
import { setupWorks, DEPT } from './helpers/transport-works.ts';
import { createBooking, defaultCostSheet, loadBookings } from '../src/lib/construction/cn-bookings.ts';
import { brokerageBill, brokerageDue, recordBrokerage, remindDemand, SAC_BROKERAGE } from '../src/lib/construction/cn-realty-extras.ts';
import { loadCollectionNotes } from '../src/lib/collections.ts';
import { draftsDb } from '../src/lib/purchase-drafts.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { loadContracts, saveContract } from '../src/lib/construction/cn-contracts.ts';
import { setClosureFiles } from '../src/lib/construction/cn-closure.ts';
import { attachmentIdsIn, parseStoredAttachment, referencedAttachmentIds } from '../src/lib/attachments.ts';
import { sectionRate } from '../src/lib/tds-rules.ts';

afterEach(() => thawDate());

function brokered(gstin = '27AAAPL1234C1ZE') {
  const w = realtyWorld();
  const v = vendorsDb.save({ name: 'Prime Realty Brokers', gstin, state_code: gstin.slice(0, 2) } as never);
  const u = w.units[0];
  const sheet = defaultCostSheet(u).map((h) => (h.head === 'Basic' ? { ...h, amount: 7500000 } : h));
  const b = createBooking({ date: '2026-05-01', unit_id: u.id, client_id: BUYER.id, client_name: BUYER.name, cost_sheet: sheet, plan_id: w.plan.id, broker: { vendor_id: v.id, name: v.name, pct: 1 } });
  return { b, v };
}

test('PENDING 14: broker commission = % of the agreement value; the draft bill carries 18% GST and 194H', () => {
  const { b } = brokered();
  assert.deepEqual(brokerageDue(b), { pct: 1, amount: 75000 });
  assert.equal(brokerageDue({ ...b, broker: undefined }), null);
  const d = recordBrokerage(b.id, '2026-05-10');
  assert.equal(d.lines[0].hsn, SAC_BROKERAGE);
  assert.deepEqual([d.taxable, d.cgst, d.sgst, d.igst, d.total], [75000, 6750, 6750, 0, 88500]);
  const rate = sectionRate('194H', '2026-05-10')!;
  assert.deepEqual([d.tds_section, d.tds_rate, d.tds_amount], ['194H', rate, Math.round(75000 * rate) / 100]);
  assert.equal(draftsDb.all().length, 1);
  assert.equal(loadBookings()[0].broker?.draft_id, d.id, 'linked on the booking');
  assert.throws(() => recordBrokerage(b.id, '2026-05-11'), /already drafted/);
});

test('PENDING 14: an out-of-State broker is billed IGST; an unregistered one has no GST', () => {
  const inter = brokerageBill({ vendor: { name: 'B', gstin: '29AAAPL1234C1ZV' }, amount: 10000, date: '2026-05-10', home: '27', ref: 'x' });
  assert.deepEqual([inter.igst, inter.cgst, inter.total], [1800, 0, 11800]);
  const urd = brokerageBill({ vendor: { name: 'B' }, amount: 10000, date: '2026-05-10', home: '27', ref: 'x' });
  assert.deepEqual([urd.igst, urd.cgst, urd.total, urd.itc_eligible], [0, 0, 10000, false]);
});

test('PENDING 14: Remind logs a WhatsApp follow-up for the buyer with a next action a week later', () => {
  const { b } = brokered();
  const n = remindDemand(b.id, 250000, '2026-10-27');
  assert.deepEqual([n.party_key, n.kind, n.next_action?.date], [BUYER.id, 'whatsapp', '2026-11-03']);
  assert.match(n.outcome, /BKG\/FY26-27\/0001/);
  assert.equal(loadCollectionNotes().length, 1);
  assert.throws(() => remindDemand(b.id, 0, '2026-10-27'), /nothing is due/);
});

test('PENDING 14: closure documents are kept on the contract and counted as referenced files', () => {
  const boq = setupWorks();
  const c = saveContract({ boq_id: boq.id, client_id: DEPT.id, client_name: DEPT.name, name_of_work: 'Road', contract_value: 100000, stipulated_start: '2026-05-01', stipulated_completion: '2026-12-31' });
  const ref = { id: 'att-noclaim', name: 'no-claim.pdf', mime: 'application/pdf', size: 1200, added_at: '2026-10-27T10:00:00.000Z' } as never;
  setClosureFiles(c.id, [ref]);
  assert.deepEqual(loadContracts()[0].attachments?.map((a) => a.id), ['att-noclaim']);
  assert.ok(referencedAttachmentIds().has('att-noclaim'), 'not garbage-collected');
  setClosureFiles(c.id, []);
  assert.equal(loadContracts()[0].attachments, undefined);
  // The first-paint trims that paid for the owner row: rows that are not objects carry no files.
  assert.deepEqual([...attachmentIdsIn([null, undefined, 'x', 5, { attachments: [ref] }])], ['att-noclaim']);
  assert.equal(parseStoredAttachment('"text"'), null);
  assert.equal(parseStoredAttachment('5'), null);
  assert.equal(parseStoredAttachment('null'), null);
});

test('PENDING 14: wired on the desk (booking broker, Broker bill, Remind) and the closure panel; en + hi', () => {
  const desk = readFileSync(new URL('../src/components/construction/RealtyDesk.tsx', import.meta.url), 'utf8');
  assert.match(desk, /recordBrokerage\(b\.id, todayInput\(\)\)/);
  assert.match(desk, /remindDemand\(a\.id, a\.open, todayInput\(\)\)/);
  assert.match(desk, /broker: \{ vendor_id: bv\.id, name: bv\.name, pct: f\.bpct \}/);
  const cv = readFileSync(new URL('../src/components/construction/ContractsView.tsx', import.meta.url), 'utf8');
  assert.match(cv, /<AttachmentsPanel value=\{c\.attachments\} onChange=\{\(next\) => run\(\(\) => setClosureFiles\(c\.id, next\)\)\}/);
  const rc = readFileSync(new URL('../src/i18n/areas/construction-r11c.ts', import.meta.url), 'utf8');
  for (const k of ['broker', 'brokerPct', 'brokerBill', 'brokerDrafted', 'remind', 'reminded']) assert.equal((rc.match(new RegExp(`\\b${k}: `, 'g')) ?? []).length, 2, k);
  const cb = readFileSync(new URL('../src/i18n/areas/construction-r11b.ts', import.meta.url), 'utf8');
  assert.equal((cb.match(/closureFiles: /g) ?? []).length, 2);
});
