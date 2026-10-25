/**
 * 8F distribution: credit-limit policy (pure + the data-layer gate through approvals), beat / salesman / area
 * reports and the beat plan, party assignment, van settlement, signed order files (sign, verify, tamper,
 * dedupe import), pick lists, salt substitutes.
 */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings, SELLER } from './helpers/world.ts';
import { setActorProvider, isAccessDeniedError, type Role } from '../src/lib/access.ts';
import { localDb } from '../src/lib/localDb.ts';
import { audit } from '../src/lib/audit.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { approveDocument, pendingApprovals } from '../src/lib/approvals.ts';
import { registerCreditGate } from '../src/lib/approval-gate.ts';
import { blockReason, creditGate, creditStatus, openOrderValue, readCreditPolicy, saveCreditPolicy } from '../src/lib/credit-policy.ts';
import {
  areasDb, assignParties, beatPlan, beatsDb, collectionsBy, liveDistContext, outstandingBy, returnsBy, salesBy, weekdayOf,
} from '../src/lib/distribution.ts';
import { vanDay, vanSettlementsDb } from '../src/lib/van.ts';
import { godownsDb } from '../src/lib/godowns.ts';
import { blankStockItem, stockDb } from '../src/lib/inventory.ts';
import { loadTracking } from '../src/lib/stock-tracking.ts';
import { importOrders, importsDb, newOrders, OrderFileError, signOrderFile, verifyOrderFile, type PadPayload } from '../src/lib/order-pad.ts';
import { buildSalesOrder } from '../src/lib/order-pad-build.ts';
import { pickRows, pickListHtml } from '../src/lib/pick-list.ts';
import { binForName, withBatchBin } from '../src/lib/bins.ts';
import { saltIndex, saltOf, substitutes } from '../src/lib/salt-search.ts';
import type { Client, InvoiceRecord } from '../src/types/invoice.ts';

const as = (role: Role | null, name: string = role ?? '') => setActorProvider(role ? () => ({ id: name, name, role }) : null);

beforeEach(() => {
  as(null);
  resetStorage();
  installSettings();
  freezeDate('2026-05-10T10:00:00');
});
afterEach(() => {
  as(null);
  thawDate();
});

const party = (over: Partial<Client> = {}): Client => ({ id: 'c1', name: 'Asha Medicals', email: '', address: '', city: '', zip: '', credit_limit: 10000, credit_days: 30, ...over });

function doc(id: string, total: number, over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id, invoice_number: `INV/FY26-27/${id}`, doc_type: 'INVOICE', issue_date: '2026-05-10', due_date: '2026-05-24', status: 'Sent', currency: 'INR',
    template_id: 'classic_orange', client: { id: 'c1', name: 'Asha Medicals' } as InvoiceRecord['client'], sender: SELLER,
    items: [{ id: 'l', name: 'Work', type: 'Service', hsn: '998314', unit: 'NOS', quantity: 1, rate: total, tax_rate: 0, amount: total }],
    gst_mode: 'NONE', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0,
    other_charges: 0, round_off_enabled: false, amount_paid: 0, notes: '', terms: '', subtotal: total, discount_amount: 0, taxable_value: total,
    cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0, total, balance_due: total, ...over,
  } as InvoiceRecord;
}

/* ── Credit policy ─────────────────────────────────────────────── */

test('credit policy: default Warn, owner-only save (audited), per-party override', () => {
  assert.deepEqual(readCreditPolicy(), { mode: 'warn', include_orders: false, block_overdue: false });
  as('clerk');
  assert.throws(() => saveCreditPolicy({ mode: 'block', include_orders: true, block_overdue: false }), isAccessDeniedError);
  as('owner');
  saveCreditPolicy({ mode: 'block', include_orders: true, block_overdue: true });
  assert.equal(readCreditPolicy().mode, 'block');
  assert.ok(audit.all().some((r) => r.entity_id === 'credit_policy' && /warn → block/.test(r.summary)));
  // Party override wins over the company policy.
  const st = creditStatus(doc('x', 20000), { master: party({ credit_policy: 'off' }), invoices: [], links: [] });
  assert.equal(st, null, 'Off for this party: no status at all');
});

test('credit figures: only a document that adds credit is blocked; overdue optional; open orders counted', () => {
  const policy = { mode: 'block' as const, include_orders: false, block_overdue: false };
  const old = doc('o1', 9000, { issue_date: '2026-03-01' });
  const st = creditStatus(doc('n', 2000), { master: party(), policy, invoices: [old], links: [], day: '2026-05-10' })!;
  assert.equal(st.check.overBy, 1000);
  assert.match(st.blocked, /Over the credit limit by ₹1,000\.00/);
  // A fully paid bill (POS: nothing unpaid) adds no credit: never blocked.
  assert.equal(creditStatus(doc('n', 2000), { master: party(), policy, invoices: [old], links: [], unpaid: 0 })!.blocked, '');
  // Under the limit but a 70-day-old bill: blocked only with block_overdue.
  const small = doc('s', 100);
  assert.equal(creditStatus(small, { master: party({ credit_limit: 50000 }), policy, invoices: [old], links: [] })!.blocked, '');
  assert.match(creditStatus(small, { master: party({ credit_limit: 50000 }), policy: { ...policy, block_overdue: true }, invoices: [old], links: [] })!.blocked, /credit period/);
  assert.equal(blockReason({ ...st.check, thisInvoice: 0 }, policy), '');
  // Open sales order still to bill joins the exposure.
  const so = doc('so', 0, {
    doc_type: 'SALES_ORDER', invoice_number: 'SO/FY26-27/0001',
    items: [{ id: 'sl', name: 'Tabs', type: 'Product', hsn: '3004', unit: 'NOS', quantity: 10, rate: 100, tax_rate: 12, amount: 1000 }],
  });
  assert.equal(openOrderValue(party(), [so], []), 1120);
  const withOrders = creditStatus(doc('n', 100), { master: party(), policy: { ...policy, include_orders: true }, invoices: [old, so], links: [] })!;
  assert.equal(withOrders.check.openOrders, 1120);
  assert.equal(withOrders.check.projected, 10220);
});

test('credit gate: Block holds a clerk\'s invoice for the owner; owner approval issues it; owner save is an audited override', () => {
  setTable('clients', [party()]);
  localDb.invoices.save(doc('o1', 9500));
  as('owner');
  saveCreditPolicy({ mode: 'block', include_orders: false, block_overdue: false });
  registerCreditGate(creditGate);

  as('clerk', 'Ravi');
  const held = localDb.invoices.save(doc('n1', 1000));
  assert.equal(held.status, 'Draft');
  assert.equal(held.approval?.state, 'pending');
  assert.equal(held.approval?.reason, 'credit');
  assert.match(held.approval?.note ?? '', /Over the credit limit/);
  // Under the limit: issued normally.
  setTable('clients', [party({ credit_limit: 1_000_000 })]);
  assert.equal(localDb.invoices.save(doc('n2', 1000)).status, 'Sent');
  setTable('clients', [party()]);

  as('owner', 'Owner');
  assert.equal(pendingApprovals().length, 1);
  const approved = approveDocument('n1');
  assert.equal(approved.status, 'Sent', 'the owner\'s approval issues it (no second hold)');
  const own = localDb.invoices.save(doc('n3', 5000));
  assert.equal(own.status, 'Sent');
  assert.ok(audit.all().some((r) => /Credit limit overridden by Owner/.test(r.summary)));

  // Warn never holds; POS bills are exempt from the data-layer gate.
  saveCreditPolicy({ mode: 'warn', include_orders: false, block_overdue: false });
  as('clerk');
  assert.equal(localDb.invoices.save(doc('n4', 5000)).status, 'Sent');
  as('owner');
  saveCreditPolicy({ mode: 'block', include_orders: false, block_overdue: false });
  as('clerk');
  assert.equal(localDb.invoices.save(doc('n5', 5000, { pos: true })).status, 'Sent');
  // Fail-safe: no evaluator loaded → a clerk's Block-party document is held.
  registerCreditGate(null);
  assert.equal(localDb.invoices.save(doc('n6', 10)).status, 'Draft');
  registerCreditGate(creditGate);
});

/* ── Distribution reports ──────────────────────────────────────── */

function distWorld() {
  as('owner');
  const north = areasDb.save({ name: 'North' });
  const b1 = beatsDb.save({ name: 'Market Rd', area_id: north.id, agent_id: 'ag1', days: [1, 4] });
  const b2 = beatsDb.save({ name: 'Station Rd', days: [2] });
  setTable('sales_agents', [{ id: 'ag1', name: 'Ravi', rate: 0, basis: 'invoice' }, { id: 'ag2', name: 'Sita', rate: 0, basis: 'invoice' }]);
  setTable('clients', [
    party({ id: 'c1', name: 'Asha Medicals' }),
    party({ id: 'c2', name: 'Bala Stores' }),
    party({ id: 'c3', name: 'Chand Kirana' }),
  ]);
  assignParties(['c1', 'c2'], { beat_id: b1.id });
  assignParties(['c3'], { beat_id: b2.id, agent_id: 'ag2', area_id: north.id });
  const inv = [
    doc('i1', 1000, { client: { id: 'c1', name: 'Asha Medicals' } as Client, issue_date: '2026-05-02' }),
    doc('i2', 500, { client: { id: 'c2', name: 'Bala Stores' } as Client, issue_date: '2026-05-03', agent_id: 'ag2', amount_paid: 500, balance_due: 0, status: 'Paid' }),
    doc('i3', 300, { client: { id: 'c3', name: 'Chand Kirana' } as Client, issue_date: '2026-05-04' }),
    doc('cn', 200, { doc_type: 'CREDIT_NOTE', client: { id: 'c1', name: 'Asha Medicals' } as Client, issue_date: '2026-05-05' }),
    doc('q', 999, { doc_type: 'QUOTATION', client: { id: 'c1', name: 'Asha Medicals' } as Client }),
  ];
  return { north, b1, b2, inv };
}

test('reports by salesman / beat / area; returns by beat; collections; outstanding', () => {
  const { b1, b2, north, inv } = distWorld();
  const ctx = liveDistContext();
  const may = { from: '2026-05-01', to: '2026-05-31' };
  const bySalesman = salesBy(inv, ctx, 'salesman', may);
  // i1: party has no agent → beat's salesman Ravi; i2: document agent Sita wins; i3: party default Sita.
  assert.deepEqual(bySalesman.map((r) => [r.label, r.amount, r.docs]), [['Ravi', 1000, 1], ['Sita', 800, 2]]);
  const byBeat = salesBy(inv, ctx, 'beat', may);
  assert.deepEqual(byBeat.map((r) => [r.key, r.amount, r.parties]), [[b1.id, 1500, 2], [b2.id, 300, 1]]);
  const byArea = salesBy(inv, ctx, 'area', may);
  assert.deepEqual(byArea.map((r) => [r.key, r.amount]), [[north.id, 1800]], 'the beat\'s area fills in for parties without one');
  assert.deepEqual(returnsBy(inv, ctx, 'beat', may).map((r) => [r.key, r.amount]), [[b1.id, 200]]);
  assert.deepEqual(outstandingBy(inv, ctx, 'beat').map((r) => [r.key, r.amount]), [[b1.id, 1000], [b2.id, 300]]);
  const pays = [{ invoice_id: 'i2', amount: 500, date: '2026-05-06' }, { invoice_id: 'i3', amount: 100, date: '2026-04-30' }];
  assert.deepEqual(collectionsBy(pays, inv, ctx, 'salesman', may).map((r) => [r.label, r.amount]), [['Sita', 500]]);
  // Unassigned party → '' row last.
  const loose = [...inv, doc('i9', 50, { client: { name: 'Walk-in' } as Client })];
  const rows = salesBy(loose, ctx, 'beat', may);
  assert.equal(rows[rows.length - 1].key, '');
});

test('beat plan: weekday beats with parties and outstanding; masters guarded and audited', () => {
  const { b1, inv } = distWorld();
  setTable('invoices', inv);
  const mon = beatPlan(weekdayOf('2026-05-11'), liveDistContext(), inv);
  assert.equal(weekdayOf('2026-05-11'), 1);
  assert.deepEqual(mon.map((p) => p.beat.id), [b1.id]);
  assert.equal(mon[0].agent, 'Ravi');
  assert.deepEqual(mon[0].parties.map((p) => [p.name, p.outstanding]), [['Asha Medicals', 1000], ['Bala Stores', 0]]);
  assert.equal(beatPlan(0, liveDistContext(), inv).length, 0);
  assert.throws(() => beatsDb.remove(b1.id), /used by 2 parties/);
  assert.throws(() => beatsDb.save({ name: 'market rd' }), /already exists/);
  as('viewer');
  assert.throws(() => areasDb.save({ name: 'South' }), isAccessDeniedError);
  assert.throws(() => assignParties(['c1'], { beat_id: '' }), isAccessDeniedError);
  as('owner');
  assignParties(['c1', 'c2'], { beat_id: '' });
  beatsDb.remove(b1.id);
  assert.ok(audit.all().some((r) => /Beat: deleted "Market Rd"/.test(r.summary)));
  // A stale invoice snapshot never resets the master's distribution fields.
  assignParties(['c3'], { agent_id: 'ag1' });
  localDb.invoices.save(doc('z1', 10, { client: { id: 'c3', name: 'Chand Kirana', agent_id: 'ag2', beat_id: 'x' } as Client }));
  const c3 = localDb.clients.getById('c3')!;
  assert.equal(c3.agent_id, 'ag1');
  assert.notEqual(c3.beat_id, 'x');
});

/* ── Van ───────────────────────────────────────────────────────── */

test('van: load by transfer, settle returns + cash vs bills (VST series, all-or-nothing)', () => {
  as('owner');
  const van = godownsDb.save({ name: 'Van 1', kind: 'van' });
  assert.equal(godownsDb.list().find((g) => g.id === van.id)?.kind, 'van');
  stockDb.saveItem(blankStockItem({ id: 'soap', name: 'Soap', opening_qty: 100, opening_rate: 10 }));
  const t = vanSettlementsDb.load({ date: '2026-05-10', van_id: van.id, from: 'main', lines: [{ id: 'l', item_id: 'soap', qty: 40 }] });
  assert.match(t.transfer_number, /^STR\/FY26-27\//);
  const bill = doc('vb', 300, { items: [{ id: 'l', name: 'Soap', type: 'Product', hsn: '3401', unit: 'NOS', quantity: 30, rate: 10, tax_rate: 0, amount: 300, godown_id: van.id }] });
  localDb.invoices.save(bill);
  localDb.payments.record({ invoiceId: 'vb', amount: 250, method: 'Cash', date: '2026-05-10' });
  const day = vanDay(van.id, '2026-05-10', getTable('invoices'), getTable('transactions'), getTable('stock_transfers'));
  assert.equal(day.bills.length, 1);
  assert.equal(day.cashOnBills, 250);
  assert.equal(day.loaded.soap, 40);
  assert.equal(loadTracking().get('soap')!.byGodown[van.id], 10);
  const s = vanSettlementsDb.settle({ date: '2026-05-10', van_id: van.id, return_to: 'main', returns: [{ id: 'r', item_id: 'soap', qty: 10 }], collections: 100, cash_counted: 340 });
  assert.equal(s.number, 'VST/FY26-27/0001');
  assert.equal(s.difference, -10);
  assert.equal(loadTracking().get('soap')!.byGodown[van.id] ?? 0, 0);
  assert.throws(() => vanSettlementsDb.settle({ date: '2026-05-10', van_id: van.id, return_to: 'main', returns: [], cash_counted: 0 }), /already settled/);
  vanSettlementsDb.remove(s.id);
  assert.equal(loadTracking().get('soap')!.byGodown[van.id], 10, 'deleting the settlement removes its return transfer');
  assert.equal(vanSettlementsDb.nextNumber('2026-05-11'), 'VST/FY26-27/0002', 'never re-issued');
});

/* ── Order pad ─────────────────────────────────────────────────── */

const payload = (): PadPayload => ({
  salesman: { name: 'Ravi', agent_id: 'ag1' }, created_at: '2026-05-10T09:00:00Z',
  orders: [
    { id: 'ord-1', date: '2026-05-10', client_id: 'c1', client_name: 'Asha Medicals', lines: [{ name: 'Soap', qty: 12 }, { name: '', qty: 3 }] },
    { id: 'ord-2', date: '2026-05-10', client_name: 'New Party', lines: [{ name: 'Mystery', qty: 2, rate: 40 }] },
    { id: 'ord-3', date: '2026-05-10', client_name: 'Empty', lines: [] },
  ],
});

test('order files: signed with the passphrase; a wrong passphrase or any edit is refused', async () => {
  const file = await signOrderFile(payload(), 'beat-2026');
  assert.equal(file.app, 'mrchartist-order-pad');
  const text = JSON.stringify(file);
  const back = await verifyOrderFile(text, 'beat-2026');
  assert.equal(back.orders.length, 2, 'empty orders / lines dropped');
  assert.deepEqual(back.orders[0].lines, [{ name: 'Soap', qty: 12 }]);
  await assert.rejects(() => verifyOrderFile(text, 'wrong'), OrderFileError);
  const edited = JSON.stringify({ ...file, payload: file.payload.replace('"qty":12', '"qty":120') });
  await assert.rejects(() => verifyOrderFile(edited, 'beat-2026'), /does not match/);
  await assert.rejects(() => verifyOrderFile(JSON.stringify({ ...file, iter: 10 }), 'beat-2026'), /unusual key settings/);
  await assert.rejects(() => verifyOrderFile('not json', 'x'), /not an order file/);
});

test('order import: sales orders with the salesman as agent; repeats skipped (dedupe by order id)', async () => {
  setTable('clients', [party({ id: 'c1', name: 'Asha Medicals', state_code: '27' })]);
  setTable('sales_agents', [{ id: 'ag1', name: 'Ravi', rate: 0, basis: 'invoice' }]);
  stockDb.saveItem(blankStockItem({ id: 'soap', name: 'Soap', hsn: '3401', sale_rate: 25, tax_rate: 18 }));
  const verified = await verifyOrderFile(JSON.stringify(await signOrderFile(payload(), 'pw-123456')), 'pw-123456');
  const deps = { buildOrder: buildSalesOrder, save: (r: InvoiceRecord) => localDb.invoices.save(r), defaultTax: 18 };
  const r1 = importOrders(verified, deps);
  assert.equal(r1.created.length, 2);
  const so = r1.created[0];
  assert.equal(so.doc_type, 'SALES_ORDER');
  assert.match(so.invoice_number, /^SO/);
  assert.equal(so.agent_id, 'ag1');
  assert.equal(so.items[0].rate, 25);
  assert.equal(so.items[0].tax_rate, 18);
  assert.equal(so.total, 354);
  assert.equal(r1.created[1].client.name, 'New Party');
  assert.equal(r1.created[1].items[0].rate, 40);
  const r2 = importOrders(verified, deps);
  assert.equal(r2.created.length, 0);
  assert.equal(r2.duplicates.length, 2);
  assert.equal(importsDb.all().length, 2);
  assert.deepEqual(newOrders([{ id: 'a', date: '', client_name: 'x', lines: [] }, { id: 'a', date: '', client_name: 'x', lines: [] }], []).duplicates.length, 1);
  // All-or-nothing: a refused save leaves nothing behind.
  const before = getTable('invoices').length;
  const fresh = { ...verified, orders: verified.orders.map((o) => ({ ...o, id: `${o.id}-b` })) };
  let n = 0;
  assert.throws(() => importOrders(fresh, { ...deps, save: (r) => { if (++n === 2) throw new Error('boom'); return localDb.invoices.save(r); } }), /boom/);
  assert.equal(getTable('invoices').length, before);
  assert.equal(importsDb.all().length, 2);
  as('viewer');
  assert.throws(() => importOrders(fresh, deps), isAccessDeniedError);
});

/* ── Pick list, bins, salts ────────────────────────────────────── */

test('pick list merges lines by item + batch, sorted by bin (batch bin wins)', () => {
  const items = [
    withBatchBin({ name: 'Paracetamol 500', location: 'A10' }, 'b2', 'C1'),
    { name: 'Soap', location: 'A2' },
    { name: 'Rope' },
  ];
  assert.equal(binForName(items, 'paracetamol 500', 'B2'), 'C1');
  assert.equal(binForName(items, 'Paracetamol 500', 'X'), 'A10');
  const rows = pickRows([
    { invoice_number: 'SO/1', items: [{ id: '1', name: 'Paracetamol 500', quantity: 2, unit_factor: 10, batch_no: 'B1' } as never, { id: '2', name: 'Soap', quantity: 3 } as never] },
    { invoice_number: 'DC/2', items: [{ id: '3', name: 'Soap', quantity: 1 } as never, { id: '4', name: 'Rope', quantity: 1, bin: 'Z9' } as never, { id: '5', name: 'Paracetamol 500', quantity: 1, batch_no: 'B2' } as never] },
  ], items);
  assert.deepEqual(rows.map((r) => [r.bin, r.item, r.batch, r.qty]), [['A2', 'Soap', '', 4], ['A10', 'Paracetamol 500', 'B1', 20], ['C1', 'Paracetamol 500', 'B2', 1], ['Z9', 'Rope', '', 1]]);
  assert.deepEqual(rows[0].docs, ['SO/1', 'DC/2']);
  assert.match(pickListHtml(rows), /<td>A2<\/td><td>Soap<\/td>/);
  assert.doesNotMatch(pickListHtml(rows), /<script/);
});

test('salt substitutes: same composition, case / space insensitive', () => {
  const items = [
    { name: 'Crocin 500', salt: 'Paracetamol 500mg' },
    { name: 'Dolo 650', salt: 'Paracetamol 650mg' },
    { name: 'Calpol 500', salt: 'paracetamol  500MG' },
    { name: 'Soap' },
  ];
  assert.deepEqual(substitutes('Crocin 500', items).map((i) => i.name), ['Calpol 500']);
  assert.deepEqual(substitutes('Soap', items), []);
  const idx = saltIndex(items);
  assert.equal(saltOf(idx, 'dolo 650'), 'Paracetamol 650mg');
  assert.equal(saltOf(idx, 'Soap'), '');
});
