/**
 * 7U business extras (roadmap 7.43): sales commission per agent, bill-value and buy-A-get-B offers,
 * ESC/POS raw receipts + drawer kick, pharma pack (Schedule H1 register, expiry gate).
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { createViaStore, installSettings, SELLER } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import {
  agentsDb, commissionCsv, commissionStatement, deleteCommissionPosting, documentCommission, liveCommissionData,
  loadCommissionPostings, overlapsPosting, postCommission, rateForGroup, validateAgent, type SalesAgent,
} from '../src/lib/sales-commission.ts';
import { A, chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { schemeLabel, schemesDb, syncSchemeLines, validateScheme, type Scheme } from '../src/lib/pricing.ts';
import { applyBillOffer, bestBillOffer, billValueOf, removeBillOffer } from '../src/lib/offers.ts';
import { DRAWER_KICK, asciiOnly, columnsFor, escposBytes, lr, rawReceiptHtml, receiptLines, wrap } from '../src/lib/escpos.ts';
import { pharmaGate, readPharmaSettings } from '../src/lib/pharma-gate.ts';
import { h1Register, h1RegisterCsv, liveScheduleIndex, nearExpiryStock, rxMissing, savePharmaSettings, scheduleIndex, setDrugSchedule } from '../src/lib/pharma.ts';
import { liveDocTrackingIssues } from '../src/lib/stock-tracking.ts';
import { setTable } from '../src/lib/storage.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

/* ── Sales commission ───────────────────────────────────────── */

const groups = [{ id: 'g-pharma' }, { id: 'g-otc', parent_id: 'g-pharma' }, { id: 'g-other' }];

test('commission: nearest stock-group rate wins, else the flat rate; validation', () => {
  const a = { rate: 2, group_rates: [{ group_id: 'g-pharma', rate: 5 }] };
  assert.equal(rateForGroup(a, 'g-otc', groups), 5, 'a sub-group inherits its parent rate');
  assert.equal(rateForGroup(a, 'g-other', groups), 2);
  assert.equal(rateForGroup(a, undefined, groups), 2);
  assert.equal(validateAgent({ id: '', name: ' ', rate: 1 }, []), 'Give the agent a name.');
  assert.match(validateAgent({ id: '', name: 'Ravi', rate: 120 }, []), /between 0 and 100/);
  assert.match(validateAgent({ id: 'x', name: 'ravi', rate: 1 }, [{ id: 'y', name: 'Ravi', rate: 1, basis: 'invoice' }]), /already exists/);
  assert.equal(overlapsPosting([{ agent_id: 'a', from: '2026-04-01', to: '2026-04-30' }], 'a', { from: '2026-04-30', to: '2026-05-31' }), true);
  assert.equal(overlapsPosting([{ agent_id: 'a', from: '2026-04-01', to: '2026-04-30' }], 'a', { from: '2026-05-01', to: '2026-05-31' }), false);
});

test('commission on invoice: taxable value only, credit notes take it back; payable journal Dr commission | Cr creditors (agent)', () => {
  setTable('stock_items', [{ id: 's1', name: 'Paracetamol 500', group_id: 'g-otc' }, { id: 's2', name: 'Bandage', group_id: 'g-other' }]);
  setTable('stock_groups', groups);
  const agent = agentsDb.save({ id: '', name: 'Ravi Agent', rate: 2, group_rates: [{ group_id: 'g-pharma', rate: 5 }], basis: 'invoice' });
  const inv = createViaStore({ date: '2026-05-10', lines: [{ name: 'Paracetamol 500', qty: 10, rate: 100, tax: 12 }, { name: 'Bandage', qty: 1, rate: 500, tax: 12 }], patch: { agent_id: agent.id } });
  assert.equal(inv.agent_id, agent.id, 'agent_id survives the store round trip');
  const doc = documentCommission(inv, agent, liveCommissionData());
  assert.deepEqual(doc, { base: 1500, commission: 60 }, '5% of 1000 + 2% of 500; GST earns nothing');
  createViaStore({ date: '2026-05-20', docType: 'CREDIT_NOTE', lines: [{ name: 'Bandage', qty: 1, rate: 500, tax: 12 }], patch: { agent_id: agent.id } });
  createViaStore({ date: '2026-05-21', lines: [{ name: 'Bandage', qty: 1, rate: 900, tax: 12 }] }); // no agent
  const st = commissionStatement(agent, { from: '2026-05-01', to: '2026-05-31' }, liveCommissionData());
  assert.deepEqual(st.lines.map((l) => [l.kind, l.earned]), [['invoice', 60], ['credit', -10]]);
  assert.equal(st.total, 50);
  assert.match(commissionCsv(agent, { from: '2026-05-01', to: '2026-05-31' }, st), /194H/);

  const post = postCommission(agent.id, { from: '2026-05-01', to: '2026-05-31' }, '2026-05-31');
  assert.equal(post.amount, 50);
  const v = loadVouchers().find((x) => x.id === post.voucher_id)!;
  const exp = chartOf(loadUserAccounts()).find((a) => a.name === 'Sales commission')!;
  assert.equal(exp.group, 'INDIRECT_EXPENSES');
  assert.deepEqual(v.lines.map((l) => [l.account_id, l.dr, l.cr, l.party ?? '']), [[exp.id, 5000, 0, ''], [A.creditors, 0, 5000, 'Ravi Agent']]);
  assert.throws(() => postCommission(agent.id, { from: '2026-05-15', to: '2026-06-15' }, '2026-06-15'), /already posted/);
  assert.throws(() => agentsDb.remove(agent.id), /mark the agent inactive/);
  deleteCommissionPosting(post.id);
  assert.equal(loadCommissionPostings().length, 0);
  assert.equal(loadVouchers().length, 0);
});

test('commission on receipt: earned pro rata to money received in the period, capped at the bill', () => {
  const agent = agentsDb.save({ id: '', name: 'Asha', rate: 10, basis: 'receipt' } as SalesAgent);
  const inv = createViaStore({ date: '2026-04-10', lines: [{ qty: 1, rate: 1000, tax: 0 }], patch: { agent_id: agent.id } });
  localDb.payments.record({ invoiceId: inv.id, amount: 400, method: 'Cash', date: '2026-04-20' });
  localDb.payments.record({ invoiceId: inv.id, amount: 600, method: 'Cash', date: '2026-05-05' });
  const apr = commissionStatement(agent, { from: '2026-04-01', to: '2026-04-30' }, liveCommissionData());
  const may = commissionStatement(agent, { from: '2026-05-01', to: '2026-05-31' }, liveCommissionData());
  assert.equal(apr.total, 40);
  assert.equal(may.total, 60);
  assert.equal(apr.lines[0].kind, 'receipt');
});

/* ── Offers ─────────────────────────────────────────────────── */

const line = (over: Partial<InvoiceItem>): InvoiceItem => ({ id: 'l1', name: 'Soap', type: 'goods', quantity: 1, rate: 100, tax_rate: 18, amount: 100, hsn: '3401', unit: 'NOS', ...over });

test('buy A get B: the free line is item B at ₹0 with B\'s HSN / unit / rate, in step with A\'s quantity', () => {
  const catalog = [line({ id: 'cat-a', name: 'Shampoo', hsn: '3305' }), line({ id: 'cat-b', name: 'Comb', hsn: '9615', tax_rate: 12, unit: 'PCS' })];
  const scheme: Scheme = { id: 'sc1', kind: 'buy_get', item_id: 'cat-a', item_name: 'Shampoo', buy_qty: 2, free_qty: 1, free_item_id: 'cat-b', free_item_name: 'Comb' };
  assert.equal(validateScheme({ ...scheme, free_item_id: '', free_item_name: '' }), 'Pick the item given free.');
  assert.equal(schemeLabel(scheme), 'Buy 2 Shampoo get 1 Comb free');
  let n = 0;
  const out = syncSchemeLines([line({ id: 'p1', name: 'Shampoo', hsn: '3305', quantity: 5 })], [scheme], '2026-05-01', () => `f${++n}`, catalog);
  assert.equal(out.length, 2);
  assert.deepEqual([out[1].name, out[1].hsn, out[1].unit, out[1].tax_rate, out[1].quantity, out[1].rate, out[1].free_of], ['Comb', '9615', 'PCS', 12, 2, 0, 'p1']);
  assert.match(out[1].description ?? '', /Free under scheme: Buy 2 Shampoo get 1 Comb free/);
  // Same-item schemes still work, and a bill-value scheme never makes a free line.
  const bv: Scheme = { id: 'bv', kind: 'bill_value', item_id: '', item_name: '', buy_qty: 0, free_qty: 0, slabs: [{ min_value: 1000, percent: 5 }] };
  assert.equal(syncSchemeLines([line({ quantity: 50 })], [bv], '2026-05-01').length, 1);
});

test('bill-value offer: best slab, amount discount line, GST on the net value, stale offer dropped', () => {
  const bv = schemesDb.save({ id: '', kind: 'bill_value', item_id: '', item_name: '', buy_qty: 0, free_qty: 0, label: 'Diwali', slabs: [{ min_value: 5000, percent: 5 }, { min_value: 1000, amount: 50 }] });
  assert.equal(bv.slabs!.length, 2);
  assert.match(validateScheme({ ...bv, slabs: [{ min_value: 100, percent: 5, amount: 5 }] }), /either a % off or a ₹ off/);
  assert.equal(bestBillOffer([bv], 999, '2026-05-01'), null);
  assert.equal(bestBillOffer([bv], 1200, '2026-05-01')!.value, 50);
  assert.equal(bestBillOffer([bv], 6000, '2026-05-01')!.value, 300);
  assert.equal(bestBillOffer([{ ...bv, active: false }], 6000, '2026-05-01'), null);

  const inv = createViaStore({ date: '2026-05-01', lines: [{ qty: 60, rate: 100, tax: 18 }] });
  assert.equal(billValueOf(inv), 6000);
  const withOffer = applyBillOffer(inv, [bv], { retotalRecord: true });
  assert.deepEqual(withOffer.offer, { scheme_id: bv.id, label: 'Diwali: 5% off on ₹5000+', value: 300 });
  assert.equal(withOffer.discount_type, 'AMOUNT');
  assert.equal(withOffer.discount_rate, 300);
  assert.equal(withOffer.taxable_value, 5700, 'GST on the value after the offer');
  assert.equal(withOffer.tax_amount, 1026);
  assert.equal(applyBillOffer(withOffer, [bv], { retotalRecord: true }), withOffer, 'unchanged offer → same record');
  // A smaller bill moves to the ₹50 slab; an even smaller one drops the offer.
  const smaller = applyBillOffer({ ...withOffer, items: [{ ...withOffer.items[0], quantity: 20 }] }, [bv], { retotalRecord: true });
  assert.equal(smaller.offer!.value, 50);
  assert.equal(smaller.discount_rate, 50);
  const none = applyBillOffer({ ...smaller, items: [{ ...smaller.items[0], quantity: 5 }] }, [bv], { retotalRecord: true });
  assert.equal(none.offer, undefined);
  assert.equal(none.discount_rate, 0);
  // A typed amount discount stays when the offer comes off; a % discount blocks the offer.
  const typed = applyBillOffer({ ...inv, discount_type: 'AMOUNT', discount_rate: 100 }, [bv]);
  assert.equal(typed.discount_rate, 400);
  assert.equal(removeBillOffer(typed).discount_rate, 100);
  assert.equal(applyBillOffer({ ...inv, discount_type: 'PERCENT', discount_rate: 10 }, [bv]).offer, undefined);
  // Saved through the store, the offer label survives.
  const saved = createViaStore({ date: '2026-05-02', lines: [{ qty: 60, rate: 100, tax: 18 }], invoiceDiscount: { type: 'AMOUNT', value: 300 }, patch: { offer: withOffer.offer } });
  assert.equal(saved.offer?.label, 'Diwali: 5% off on ₹5000+');
});

/* ── ESC/POS ────────────────────────────────────────────────── */

test('ESC/POS: 32 / 48 columns, ASCII only, init + cut + optional drawer kick', () => {
  assert.equal(columnsFor(58), 32);
  assert.equal(columnsFor(80), 48);
  assert.equal(asciiOnly('₹100 – “ok”'), 'Rs.100 - "ok"');
  assert.equal(lr('Subtotal', '100.00', 20), 'Subtotal      100.00');
  assert.deepEqual(wrap('Paracetamol tablets IP 500 mg strip of ten', 16), ['Paracetamol', 'tablets IP 500', 'mg strip of ten']);
  const inv = createViaStore({ date: '2026-05-01', lines: [{ name: 'Paracetamol 500', qty: 2, rate: 30, tax: 12 }], patch: { rx: { patient: 'Mohan', prescriber: 'Dr. Rao', prescriber_reg: 'KMC 1234' } } });
  const lines = receiptLines(inv, { ...SELLER, drug_licence: '20B: KA-B12-1, 21B: KA-B12-2' }, 58);
  assert.ok(lines.every((l) => l.length <= 32), 'fits the 58 mm roll');
  assert.ok(lines.some((l) => l.includes('DL No.: 20B: KA-B12-1')));
  assert.ok(lines.some((l) => l.includes('Patient: Mohan')));
  assert.ok(lines.some((l) => /^TOTAL\s+Rs\.\d+\.\d{2}$/.test(l) && l.endsWith(inv.total.toFixed(2))));
  const bytes = escposBytes(lines, { drawer: true });
  assert.deepEqual([...bytes.slice(0, 2)], [0x1b, 0x40]);
  assert.deepEqual([...bytes.slice(-5)], [...DRAWER_KICK]);
  assert.ok(bytes.slice(0, -5).every((b) => b < 0x80), 'ASCII text and commands before the kick');
  assert.ok(![...escposBytes(lines).slice(-5)].every((b, i) => b === DRAWER_KICK[i]), 'no kick unless asked');
  const html = rawReceiptHtml(lines, 80);
  assert.match(html, /size:80mm auto/);
  assert.doesNotMatch(html, /<script/i);
});

/* ── Pharma pack ────────────────────────────────────────────── */

test('pharma gate: off by default; blocks expired and flags / blocks near-expiry when on', () => {
  const issues = { errors: [], expired: ['Amoxy: batch B1 expired on 2026-04-30.'], warnings: [] };
  const doc = { doc_type: 'INVOICE', issue_date: '2026-05-01', items: [{ name: 'Cough syrup', batch_no: 'C9', batch_expiry: '2026-06-15' }] };
  assert.equal(pharmaGate(issues, doc), issues, 'switched off: untouched');
  assert.equal(readPharmaSettings().enabled, false);
  savePharmaSettings({ enabled: true, block_expired: true, near_expiry_days: 60, block_near_expiry: false });
  const on = pharmaGate(issues, doc);
  assert.equal(on.expired.length, 0);
  assert.match(on.errors[0], /Expired stock cannot be sold/);
  assert.match(on.warnings[0], /Cough syrup: batch C9 expires on 2026-06-15 \(within 60 days\)/);
  const strict = pharmaGate(issues, doc, { enabled: true, block_expired: false, near_expiry_days: 60, block_near_expiry: true });
  assert.equal(strict.expired.length, 1, 'expired still only asks when blocking is off');
  assert.equal(strict.errors.length, 1);
  assert.equal(pharmaGate(issues, { ...doc, doc_type: 'CREDIT_NOTE' }).errors.length, 0, 'returns are not sales');
  // Wired into the live stock checks every save path uses.
  assert.equal(liveDocTrackingIssues({ doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-05-01', items: [{ id: 'x', name: 'Cough syrup', type: 'goods', quantity: 1, rate: 10, amount: 10, batch_no: 'C9', batch_expiry: '2026-05-20' }] } as never).warnings.length, 1);
});

test('pharma: schedules on stock items, H1 register with prescription, missing Rx flagged, near-expiry list', () => {
  setTable('stock_items', [{ id: 's1', name: 'Alprazolam 0.5', aliases: ['Alprax'] }, { id: 's2', name: 'Cetirizine' }]);
  setDrugSchedule('s1', 'H1');
  setDrugSchedule('s2', 'H');
  const idx = liveScheduleIndex();
  assert.equal(idx.get('alprax'), 'H1');
  assert.equal(scheduleIndex([{ id: 'z', name: 'Bad', drug_schedule: 'Q' }]).size, 0);
  createViaStore({ date: '2026-05-03', lines: [{ name: 'Alprazolam 0.5', qty: 10, rate: 5, tax: 12 }, { name: 'Cetirizine', qty: 1, rate: 20, tax: 12 }], patch: { rx: { patient: 'S. Kumar', patient_address: 'Pune', prescriber: 'Dr. Mehta', prescriber_reg: 'MMC 99' } } });
  const noRx = createViaStore({ date: '2026-05-04', lines: [{ name: 'alprazolam 0.5', qty: 5, rate: 5, tax: 12 }] });
  createViaStore({ date: '2026-05-05', lines: [{ name: 'Alprazolam 0.5', qty: 5, rate: 5, tax: 12 }], asDraft: true });
  const rows = h1Register(localDb.invoices.getAll() as InvoiceRecord[], idx, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(rows.length, 2, 'drafts are not sales; H drugs stay out of the H1 register');
  assert.deepEqual([rows[0].patient, rows[0].prescriber, rows[0].prescriber_reg, rows[0].qty, rows[0].missingRx], ['S. Kumar', 'Dr. Mehta', 'MMC 99', 10, false]);
  assert.equal(rows[1].missingRx, true);
  assert.equal(h1Register(localDb.invoices.getAll() as InvoiceRecord[], idx, { from: '2026-05-01', to: '2026-05-31' }, ['H', 'H1']).length, 3);
  assert.deepEqual(rxMissing(noRx, idx), ['alprazolam 0.5']);
  assert.match(h1RegisterCsv(rows, { from: '2026-05-01', to: '2026-05-31' }), /Prescriber reg\. no\./);
  const tracking = new Map([['s1', { item: { id: 's1', name: 'Alprazolam 0.5', unit: 'STRIP' }, qty: 9, byGodown: {}, serials: [], batches: [
    { batch: 'A1', expiry: '2026-04-30', qty: 2, firstIn: '2026-01-01', byGodown: {} },
    { batch: 'A2', expiry: '2026-06-10', qty: 3, firstIn: '2026-01-01', byGodown: {} },
    { batch: 'A3', expiry: '2027-06-10', qty: 4, firstIn: '2026-01-01', byGodown: {} },
  ] }]]) as never;
  const exp = nearExpiryStock(tracking, '2026-05-01', 60);
  assert.deepEqual(exp.map((r) => [r.batch, r.expired]), [['A1', true], ['A2', false]]);
});
