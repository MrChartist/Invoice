/**
 * QA round 22 on Round 19 (logistics): each test fails on the baseline `1200d69` (`docs/prd/qa-round-22.md`).
 * W1 export freight to an unregistered Indian client · W2 international courier bills · W3 GTA under RCM · W4 agents in
 * India · W5 courier "Undo month" with a credit note · W6 agent netting by a clerk · W7 netting rows in the FX tab ·
 * W8 Hindi errors of the customs desk · W9 the courier Ctrl+K row by pack.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { BUYER_MH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { makeDraft } from '../src/store/invoice-defaults.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { foreignReceipts } from '../src/lib/fx-gain.ts';
import { addDefaultHeads } from '../src/lib/logistics/lg-settings.ts';
import { saveJob } from '../src/lib/logistics/lg-save.ts';
import { billJob } from '../src/lib/logistics/lg-issue-io.ts';
import { lgAgents } from '../src/lib/logistics/lg-agents.ts';
import { billCourierMonth, importDockets, issueAgentNote, saveAgent, saveAgentBill, settleAgent, undoCourierMonth } from '../src/lib/logistics/lg-d-save.ts';
import { importDocRefs } from '../src/lib/logistics/lg-recv-io.ts';
import { syncNettedPaid } from '../src/lib/retail/rt-registry.ts';
import { PACK_TABS, packTabOn } from '../src/lib/industry-packs.ts';
import { resetI18nForTests, setCatalogueForTests, setLanguage } from '../src/i18n/index.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { Vendor } from '../src/types/purchases.ts';
import type { LgDocket, LgJob } from '../src/types/logistics-r19.ts';

const DAY = '2026-11-05';
const period = { period: { kind: 'month' as const, fyStart: 2026, month: 11 } };
const gstr1 = () => buildGstReport(localDb.invoices.getAll(), [], period).gstr1;
const base = () => makeDraft({ settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), docType: 'TAX_INVOICE' });
let reg = '', urd = '';
const job = (client: string, o: Partial<LgJob> = {}) => saveJob({ date: DAY, status: 'delivered', dir: 'export', mode: 'air', origin: 'BOM', destination: 'SIN', dest_country: 'SG', client_id: client, refs: { hawb: `H${Math.random()}` }, chargeable_kg: 100, ...o }).job;

beforeEach(() => {
  resetStorage();
  installSettings({ defaultDueDays: 30 });
  reg = localDb.clients.upsert({ name: 'Demo Exports Pvt Ltd', email: '', address: '', city: '', zip: '', gstin: BUYER_MH, state_code: '27' });
  urd = localDb.clients.upsert({ name: 'Asha Relocating', email: '', address: 'Pune', city: '', zip: '', state_code: '27' });
  addDefaultHeads(DAY);
});

test('W1: export freight billed to an unregistered client in India is B2CS with POS 96 and IGST, never an export (6A)', () => {
  const r = billJob(job(urd, { charges: [{ head_id: 'lg-freight_air', qty: 100, rate: 100, currency: 'INR', amount: 10000 }] }).id, { date: DAY });
  const f = r.invoices[0];
  assert.deepEqual([f.place_of_supply, f.gst_mode, f.igst_amount, f.lg?.regime], ['96', 'IGST', 1800, 'export_freight']);
  const g = gstr1();
  assert.deepEqual(g.exp, [], 'not Table 6A');
  assert.deepEqual(g.b2cs.map((x) => [x.pos, x.txval, x.igst]), [['96', 10000, 1800]]);
});

test('W2: an international courier docket of an Indian customer is export freight — B2B with POS 96, not an export', () => {
  const dk = (no: string, o: Partial<LgDocket> = {}): LgDocket => ({ no, date: '2026-11-03', zone: 'Local', pcs: 1, kg: 1, chargeable_kg: 1, service: 'standard', charge: 500, ...o });
  importDockets(reg, [dk('T1'), dk('T2', { intl: true })]);
  const bills = billCourierMonth('2026-11', '2026-11-30', base());
  const intl = bills.find((b) => b.place_of_supply === '96')!;
  assert.equal(intl.lg?.regime, 'export_freight');
  const g = gstr1();
  assert.deepEqual(g.exp, []);
  assert.deepEqual(g.b2b.map((x) => x.pos).sort(), ['27', '96']);
});

test('W3: a GTA head under the reverse-charge option, billed to a registered client, is a reverse-charge document (as R5-B)', () => {
  const j = job(reg, { dir: 'domestic', mode: 'road', destination: 'PNQ', dest_country: 'IN', charges: [{ head_id: 'lg-gta', qty: 1, rate: 10000, currency: 'INR', amount: 10000 }, { head_id: 'lg-documentation', qty: 1, rate: 1000, currency: 'INR', amount: 1000 }] });
  const r = billJob(j.id, { date: DAY });
  assert.equal(r.invoices.length, 2, 'the RCM leg on its own document');
  const g = r.invoices.find((d) => d.reverse_charge)!;
  assert.ok(g, 'reverse charge');
  assert.deepEqual([g.items.length, g.rcm_tax_excluded, g.total], [1, true, 10000], 'the recipient pays the 5 %; we do not collect it');
  const other = r.invoices.find((d) => !d.reverse_charge)!;
  assert.equal(other.total, 1180);
  // Forward-charge option (fcm_18) for the FY: back on the ordinary document at 18 %.
  setTable('gta_options', [{ id: 'g', fy: '26-27', option: 'fcm_18' }]);
  localDb.invoices.getAll().forEach((d) => localDb.invoices.setStatus(d.id, 'Cancelled'));
  const f = billJob(j.id, { date: DAY });
  assert.deepEqual([f.invoices.length, f.invoices[0].reverse_charge ?? false], [1, false]);
});

test('W4: an agent in India gets a domestic note (Sec 12(2)), never an export; its bill is not booked as an import under RCM', () => {
  saveAgent({ name: 'Demo Co-loader', kind: 'co_loader', foreign: false });
  const a = lgAgents(getTable<Vendor>('vendors'), localDb.clients.getAll())[0];
  const j = job(reg);
  const n = issueAgentNote({ agent: a, job: j, kind: 'freight', amount: 1000, currency: 'INR', rate: 1, lut: null }, DAY, base());
  assert.notEqual(n.place_of_supply, '96');
  assert.notEqual(n.supply_type, 'EXPORT_WITH_PAYMENT');
  assert.deepEqual(gstr1().exp, []);
  assert.throws(() => saveAgentBill({ agent: a, job: j, bill_no: 'CL-1', date: DAY, amount: 500, currency: 'INR', rate: 1 }), /Purchases/);
  assert.equal(getTable('purchases').length, 0);
});

test('W5: "Undo month" is refused while a courier bill of the month carries a live credit note', () => {
  importDockets(reg, [{ no: 'C1', date: '2026-11-03', zone: 'Local', pcs: 1, kg: 1, chargeable_kg: 1, service: 'standard', charge: 500 }]);
  const [b] = billCourierMonth('2026-11', '2026-11-30', base());
  const cn: InvoiceRecord = { ...b, id: 'cn1', doc_type: 'CREDIT_NOTE', invoice_number: 'CN/1', lg: undefined };
  setTable('invoices', [...getTable<InvoiceRecord>('invoices'), cn]);
  setTable('doc_links', [{ id: 'l1', from_id: b.id, to_id: 'cn1', relation: 'credit_note', created_at: DAY }]);
  assert.throws(() => undoCourierMonth('2026-11'), new RegExp(b.invoice_number.replace(/\//g, '\\/')));
  assert.equal(localDb.invoices.getById(b.id)?.status, 'Sent');
});

test('W6: a clerk cannot net an agent account (R15-A netting needs the owner)', () => {
  saveAgent({ name: 'Demo Agent Pte Ltd', kind: 'agent', foreign: true, country: 'SG' });
  const a = () => lgAgents(getTable<Vendor>('vendors'), localDb.clients.getAll())[0];
  const j = job(reg);
  issueAgentNote({ agent: a(), job: j, kind: 'profit_share', amount: 100, currency: 'USD', rate: 84, lut: null }, DAY, base());
  saveAgentBill({ agent: a(), job: j, bill_no: 'DA-1', date: DAY, amount: 50, currency: 'USD', rate: 84 });
  setActorProvider(() => ({ id: 'k', name: 'Clerk', role: 'clerk' }));
  try {
    assert.throws(() => settleAgent(a(), { amount: 50, date: DAY, rcmPaid: true }, syncNettedPaid), /owner/);
  } finally { setActorProvider(null); }
  assert.equal(getTable('transactions').length, 0);
});

test('W7: an agent netting row is marked in the FX tab rows (its realised rate is the bill\'s, not edited there)', () => {
  saveAgent({ name: 'Demo Agent Pte Ltd', kind: 'agent', foreign: true, country: 'SG' });
  const a = () => lgAgents(getTable<Vendor>('vendors'), localDb.clients.getAll())[0];
  const j = job(reg);
  issueAgentNote({ agent: a(), job: j, kind: 'profit_share', amount: 100, currency: 'USD', rate: 83, lut: null }, DAY, base());
  saveAgentBill({ agent: a(), job: j, bill_no: 'DA-1', date: DAY, amount: 50, currency: 'USD', rate: 84 });
  settleAgent(a(), { amount: 50, date: DAY, rcmPaid: true }, syncNettedPaid);
  const rows = foreignReceipts(localDb.invoices.getAll(), getTable('transactions'), { start: '2026-04-01', end: '2027-03-31' });
  assert.deepEqual(rows.map((r) => r.netted), [true]);
});

test('W8: the customs desk errors and the SB / BOE import rows follow the interface language', async () => {
  resetI18nForTests();
  setCatalogueForTests('hi', {});
  await setLanguage('hi', { persist: false });
  try {
    const r = importDocRefs('Job,SB no,Date\nJOB/NONE/1,123,2026-11-05\n');
    assert.match(r.errors[0], /पंक्ति 2: जॉब नहीं मिली/);
  } finally {
    await setLanguage('en', { persist: false });
  }
});

test('W9: the courier Ctrl+K row shows only with the courier pack, as the desk lists the view', () => {
  const row = PACK_TABS.find((t) => t.labelKey === 'r19.shipments.courier')!;
  assert.equal(packTabOn(row, ['logistics']), false, 'a forwarder without the courier pack');
  assert.equal(packTabOn(row, ['logistics', 'courier']), true);
});
