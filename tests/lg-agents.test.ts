/** R19-D1 overseas agents: the client + vendor pair, notes in USD (export of services, LUT), their bill (import of services, RCM, ₹ at the rate), the statement and its match, netting with the R15-A markers, the bill re-derived, FX on the ledger, reversal. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { makeDraft } from '../src/store/invoice-defaults.ts';
import { agentBills, agentStatement, lgAgents, matchStatement, pairAgent, type Agent } from '../src/lib/logistics/lg-agents.ts';
import { issueAgentNote, saveAgent, saveAgentBill, settleAgent } from '../src/lib/logistics/lg-d-save.ts';
import { saveJob } from '../src/lib/logistics/lg-save.ts';
import { syncNettedPaid } from '../src/lib/retail/rt-registry.ts';
import { exchangeSettled } from '../src/lib/retail/rt-doc-hooks.ts';
import { isNettingRow, nettings, reverseNetting } from '../src/lib/netting.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import { realisedFx } from '../src/lib/fx-gain.ts';
import { supplierPayable } from '../src/lib/purchase-normalize.ts';
import type { PurchaseRecord, Vendor } from '../src/types/purchases.ts';
import type { LgJob } from '../src/types/logistics-r19.ts';

const base = () => makeDraft({ settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), docType: 'TAX_INVOICE' });
const LUT = { lut_number: 'AD270326000123X', lut_date: '2026-03-28' };
let job: LgJob, agent: Agent;
const agentNow = () => lgAgents(getTable<Vendor>('vendors'), localDb.clients.getAll())[0];

beforeEach(() => {
  resetStorage();
  installSettings();
  const client = localDb.clients.upsert({ name: 'Demo Exports', email: '', address: '', city: '', zip: '', gstin: '27AAPFU0939F1ZV', state_code: '27' });
  job = saveJob({ date: '2026-11-05', status: 'delivered', dir: 'export', mode: 'air', origin: 'BOM', destination: 'SIN', dest_country: 'SG', client_id: client, refs: { hawb: 'HX1' } }).job;
  saveAgent({ name: 'Demo Agent Pte Ltd', kind: 'agent', foreign: true, country: 'sg' });
  agent = agentNow();
});

test('an agent is a client + vendor pair with Vendor.lg; names are unique', () => {
  assert.deepEqual([agent.vendor.lg, agent.vendor.non_resident, agent.vendor.nr_country, agent.client?.name, agent.client?.state_code], [{ kind: 'agent', foreign: true }, true, 'SG', 'Demo Agent Pte Ltd', '96']);
  assert.equal(agent.vendor.client_id, agent.client?.id);
  assert.throws(() => saveAgent({ name: 'demo agent pte ltd', kind: 'agent', foreign: true }), /exists/);
});

test('"Debit agent": USD, POS 96, export of services under the LUT (zero tax) or with IGST; lg agent / job / fx', () => {
  const n = issueAgentNote({ agent, job, kind: 'profit_share', amount: 150, currency: 'usd', rate: 84, lut: LUT }, '2026-11-20', base());
  assert.deepEqual([n.currency, n.exchange_rate, n.place_of_supply, n.supply_type, n.lut_number, n.igst_amount, n.total, n.items[0].hsn], ['USD', 84, '96', 'EXPORT_LUT', LUT.lut_number, 0, 150, '996713']);
  assert.deepEqual([n.lg?.job_id, n.lg?.job_no, n.lg?.agent?.kind, n.lg?.regime, n.lg?.fx], [job.id, job.number, 'profit_share', 'export_lut', { currency: 'USD', rate: 84 }]);
  assert.match(n.lg?.pos_reason ?? '', /13\(2\)/);
  const p = issueAgentNote({ agent, job, kind: 'freight', amount: 100, currency: 'USD', rate: 84, lut: null }, '2026-11-20', base());
  assert.deepEqual([p.supply_type, p.gst_mode, p.igst_amount, p.items[0].hsn], ['EXPORT_WITH_PAYMENT', 'IGST', 18, '996531']);
  assert.throws(() => issueAgentNote({ agent, job, kind: 'other', amount: 0, currency: 'USD', rate: 84 }, '2026-11-20', base()), /amount/);
});

test("\"Agent's bill\": an import of services under reverse charge, ₹ at the rate, the USD kept; payable = taxable (purchase contract)", () => {
  const b = saveAgentBill({ agent, job, bill_no: 'DA-77', date: '2026-11-21', amount: 60, currency: 'USD', rate: 84 });
  assert.deepEqual([b.taxable, b.igst, b.total, b.reverse_charge, b.import_type, b.itc_eligible, b.lg?.job_id, b.lg?.fx], [5040, 907.2, 5947.2, true, 'SERVICES', true, job.id, { currency: 'USD', amount: 60, rate: 84 }]);
  assert.equal(supplierPayable(b), 5040, 'the shared reader takes the RCM tax out');
  assert.deepEqual(agentBills(agent, [b]).map((x) => x.open), [60]);
  assert.deepEqual(agentBills(agent, [{ ...b, amount_paid: 2520 }]).map((x) => x.open), [30]);
  assert.throws(() => saveAgentBill({ agent, job, bill_no: 'da-77', date: '2026-11-21', amount: 1, currency: 'USD', rate: 84 }), /already booked/);
});

test('statement (by month), the agent\'s statement matched by job / house bill, oldest-first pairs', () => {
  issueAgentNote({ agent, job, kind: 'profit_share', amount: 150, currency: 'USD', rate: 84, lut: LUT }, '2026-11-20', base());
  saveAgentBill({ agent, job, bill_no: 'DA-77', date: '2026-11-21', amount: 60, currency: 'USD', rate: 84 });
  const st = agentStatement(agentNow(), localDb.invoices.getAll(), getTable<PurchaseRecord>('purchases'));
  assert.deepEqual([st.ours, st.theirs, st.net], [150, 60, 90]);
  assert.equal(agentStatement(agentNow(), localDb.invoices.getAll(), getTable<PurchaseRecord>('purchases'), '2026-10').net, 0);
  assert.deepEqual(matchStatement([{ ref: 'hx1', amount: -90 }], st, [job]), { matched: 60, diff: [] });
  assert.deepEqual(matchStatement([{ ref: job.number, amount: -80 }, { ref: 'ZZ', amount: 5 }], st, [job]).diff, [{ ref: job.number, ours: -90, theirs: -80 }, { ref: 'ZZ', ours: 0, theirs: 5 }]);
  assert.deepEqual(pairAgent(st.notes, st.bills, 60).map((p) => p.amount), [60]);
});

test('settle by netting: R15-A markers, the bill\'s rate realised (FX on the ledger), the ₹ bill re-derived; no cash; reversal frees both', () => {
  const note = issueAgentNote({ agent, job, kind: 'profit_share', amount: 150, currency: 'USD', rate: 83, lut: LUT }, '2026-11-20', base());
  const bill = saveAgentBill({ agent, job, bill_no: 'DA-77', date: '2026-11-21', amount: 60, currency: 'USD', rate: 84 });
  assert.throws(() => settleAgent(agentNow(), { amount: 60, date: '2026-11-30' }, syncNettedPaid), /reverse-charge/);
  assert.throws(() => settleAgent(agentNow(), { amount: 61, date: '2026-11-30', rcmPaid: true }, syncNettedPaid), /between 0 and 60/);
  const { rows, nettingId } = settleAgent(agentNow(), { amount: 60, date: '2026-11-30', rcmPaid: true }, syncNettedPaid);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.deepEqual([r.amount, r.method, r.exchange_purchase_id, r.netting_id, r.realised_rate, r.invoice_id], [60, 'netting', bill.id, nettingId, 84, note.id]);
  assert.ok(isNettingRow(r) && movedNoCash(r), 'a netting row moves no cash');
  assert.equal(exchangeSettled(bill.id, getTable('transactions')), 5040, 'USD 60 at the bill\'s ₹84');
  const b = getTable<PurchaseRecord>('purchases').find((x) => x.id === bill.id)!;
  assert.deepEqual([b.amount_paid, b.exchange_paid], [5040, 5040]);
  assert.equal(localDb.invoices.getById(note.id)?.amount_paid, 60);
  assert.equal(realisedFx(r, localDb.invoices.getById(note.id))?.gain, 60, '(84 − 83) × USD 60');
  const st = agentStatement(agentNow(), localDb.invoices.getAll(), getTable<PurchaseRecord>('purchases'));
  assert.deepEqual([st.ours, st.theirs, st.net], [90, 0, 90]);
  assert.equal(nettings()[0].id, nettingId, 'listed with the R15-A nettings');
  reverseNetting(nettingId);
  assert.equal(getTable<PurchaseRecord>('purchases').find((x) => x.id === bill.id)?.amount_paid, 0, 'the bill is open again');
  assert.equal(localDb.invoices.getById(note.id)?.amount_paid, 0);
});

test('exchangeSettled: INR rows (R9 / R12 / R15) count as before', () => {
  assert.equal(exchangeSettled('b', [{ amount: 100, exchange_purchase_id: 'b' }, { amount: 5, exchange_purchase_id: 'x' }]), 100);
});
