/** R5-A6: returns / RTO / claims desk. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, importMtr, setupWorld } from './helpers/marketplace.ts';
import { addReturns, claimDeadline, claimWindow, deskAlerts, deskStatus, loadReturns, markReceived, planReturnsImport, raiseClaim, restockReturn, setClaimStatus } from '../src/lib/marketplace/returns-desk.ts';
import { importSettlement, matchClaimsFrom, parseSettlement } from '../src/lib/marketplace/settlement-import.ts';
import { channelById, saveChannel } from '../src/lib/marketplace/channels.ts';
import { godownsDb, nonSaleableGodowns } from '../src/lib/godowns.ts';
import { localDb } from '../src/lib/localDb.ts';
import { peekTable } from '../src/lib/storage.ts';
import { marketplaceNotices } from '../src/lib/marketplace/marketplace-alerts.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { MarketplaceReturn, SalesChannel } from '../src/types/marketplace-r5.ts';

let ch: SalesChannel;
beforeEach(() => { ch = setupWorld(); });

test('returns-report import: types, conditions, idempotent per order × type, linked to the A3 documents', () => {
  importMtr(ch);
  const plan = planReturnsImport(fixture('amazon-returns.csv'), ch, loadReturns(ch.id), peekTable<InvoiceRecord>('invoices'));
  // 402-111 already sits on the desk from the A3 refund row; 402-555 is a new RTO.
  assert.equal(plan.already, 1);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].type, 'rto');
  assert.equal(plan.rows[0].condition, 'good');
  assert.equal(plan.rows[0].received_on, '2026-10-20');
  addReturns(plan.rows);
  assert.equal(planReturnsImport(fixture('amazon-returns.csv'), ch, loadReturns(ch.id), peekTable<InvoiceRecord>('invoices')).rows.length, 0);
});

test('status machine: pending → received → restocked / claimed → closed', () => {
  const [r] = addReturns([{ channel_id: ch.id, order_id: 'O1', type: 'customer_return', expected_on: '2026-10-01' }]);
  assert.equal(deskStatus(r), 'pending');
  const rec = markReceived(r.id, '2026-10-05', 'damaged');
  assert.equal(deskStatus(rec), 'received');
  const cl = raiseClaim(r.id, { raised_on: '2026-10-06', amount: 250 });
  assert.equal(deskStatus(cl), 'claimed');
  assert.equal(setClaimStatus(r.id, 'rejected').claim!.status, 'rejected');
  assert.equal(deskStatus(loadReturns()[0]), 'received');
  assert.equal(deskStatus({ ...rec, closed_on: '2026-10-09' }), 'closed');
});

test('claim deadline by platform (Amazon 60, Flipkart 14, typed on the channel)', () => {
  const r = { id: 'x', channel_id: ch.id, order_id: 'O', type: 'courier_lost', expected_on: '2026-10-01' } as MarketplaceReturn;
  assert.equal(claimWindow(ch, '2026-10-01'), 60);
  assert.equal(claimDeadline(r, ch), '2026-11-30');
  assert.equal(claimDeadline(r, { platform: 'flipkart' }), '2026-10-15');
  assert.equal(claimDeadline(r, { platform: 'meesho' }), '');
  assert.equal(claimDeadline(r, { platform: 'meesho', claim_window: [{ from: '2017-07-01', days: 30 }] }), '2026-10-31');
});

test('settlement claim / reimbursement lines mark open claims reimbursed by order id', () => {
  const [r] = addReturns([{ channel_id: ch.id, order_id: '402-777', type: 'courier_lost', expected_on: '2026-10-01' }]);
  raiseClaim(r.id, { raised_on: '2026-10-02', amount: 500 });
  const n = matchClaimsFrom({ id: 'S1', channel_id: ch.id, lines: [{ order_id: '402-777', bucket: 'reimbursement', amount: 500, description: 'WAREHOUSE_LOST' }] });
  assert.equal(n, 1);
  assert.deepEqual(loadReturns()[0].claim, { raised_on: '2026-10-02', amount: 500, status: 'reimbursed', settlement_id: 'S1' });
  // Through a real import as well.
  const [r2] = addReturns([{ channel_id: ch.id, order_id: '402-888', type: 'courier_lost' }]);
  raiseClaim(r2.id, { raised_on: '2026-10-02' });
  const t = { headers: ['settlement-id', 'deposit-date', 'total-amount', 'order-id', 'amount-type', 'amount-description', 'amount'], rows: [['77', '2026-10-20', '100', '', '', '', ''], ['77', '', '', '402-888', 'Other', 'Claim reimbursement', '100']] };
  importSettlement(ch, parseSettlement([{ name: 't', table: t }], 'amazon_v2'), 't.csv');
  assert.equal(loadReturns().find((x) => x.id === r2.id)!.claim!.status, 'reimbursed');
});

test('restock creates the linked goods-returned credit note once; damaged goes to a non-saleable godown', () => {
  const damaged = godownsDb.save({ name: 'Damaged', kind: 'expiry' });
  ch = saveChannel({ ...channelById(ch.id)!, damaged_godown_id: damaged.id });
  importMtr(ch);
  const inv = localDb.invoices.getAll().find((d) => d.invoice_number === 'IN-1002')!;
  const [r] = addReturns([{ channel_id: ch.id, order_id: '402-222', doc_id: inv.id, type: 'rto', expected_on: '2026-10-10' }]);
  markReceived(r.id, '2026-10-12', 'damaged');
  const out = restockReturn(r.id, { day: '2026-10-12', channel: ch });
  const cn = out.creditNote!;
  assert.equal(cn.doc_type, 'CREDIT_NOTE');
  assert.equal(cn.goods_returned, true);
  assert.ok(cn.invoice_number, 'numbered in the app series');
  assert.ok(nonSaleableGodowns(godownsDb.list()).has(cn.items[0].godown_id!));
  assert.equal(cn.total, inv.total);
  assert.equal(localDb.invoices.getAll().filter((d) => d.doc_type === 'CREDIT_NOTE' && d.channel_order_id === '402-222').length, 1);
  restockReturn(r.id, { day: '2026-10-13', channel: ch });
  assert.equal(localDb.invoices.getAll().filter((d) => d.doc_type === 'CREDIT_NOTE' && d.channel_order_id === '402-222').length, 1, 'once');
  assert.equal(localDb.invoices.getById(inv.id)!.status, 'Paid', 'the credit note settles the invoice');
});

test('bell rows: pending receipt beyond 15 days, claim window closing within 3 days (pack on only)', () => {
  addReturns([
    { channel_id: ch.id, order_id: 'LATE', type: 'customer_return', expected_on: '2026-10-01' },
    { channel_id: ch.id, order_id: 'LOST', type: 'courier_lost', expected_on: '2026-09-01' },
  ]);
  const a = deskAlerts(loadReturns(), [ch], '2026-10-29');
  assert.deepEqual(a.overdue.map((r) => r.order_id).sort(), ['LATE', 'LOST']);
  assert.deepEqual(a.closing.map((c) => c.deadline), ['2026-10-31']);
  const notices = marketplaceNotices('2026-10-29', '2026-10-29T00:00:00Z');
  assert.ok(notices.some((n) => n.id.startsWith('mkt:returns')));
  assert.ok(notices.some((n) => n.id.startsWith('mkt:claim')));
});
