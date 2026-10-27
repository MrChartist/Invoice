/** RT-A3: delivery status flow, COD receipt into "Cash with riders", settlement journal, shortage, credit note, Z report. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { createViaStore, installSettings, reload } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import {
  canMove, cashWithRiders, cleanDelivery, deliveryChargeLine, deliveryRows, liveCashWithRiders, loadSettlements, moveDelivery, returnedCreditNote, riderCashLedger, saveRider, settleRider, settlementLines,
} from '../src/lib/retail/rt-delivery.ts';
import { zReport } from '../src/lib/pos.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import { todaySummary } from '../src/lib/today.ts';
import { loadLedger } from '../src/lib/ledger/index.ts';
import { chartOf, loadUserAccounts, saveUserAccount } from '../src/lib/ledger/accounts.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { RIDER_CASH_LEDGER } from '../src/lib/retail/rt-shared.ts';
import type { Payment } from '../src/types/invoice.ts';

const DAY = '2026-07-20';
beforeEach(() => {
  resetStorage();
  installSettings();
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

const order = (cod = true) => createViaStore({ date: DAY, lines: [{ name: 'Rice', qty: 2, rate: 620, tax: 0 }], status: 'Sent', patch: { pos: true, delivery: { address: '12 Park Lane', status: 'packed', cod, phone: '9800000002' } } as never });

test('status flow and the delivery snapshot', () => {
  assert.ok(canMove('new', 'packed') && canMove('packed', 'out') && canMove('out', 'delivered'));
  assert.ok(!canMove('new', 'delivered') && !canMove('delivered', 'out'));
  assert.ok(canMove('out', 'returned') && canMove('packed', 'cancelled') && !canMove('delivered', 'cancelled'));
  assert.equal(cleanDelivery({ address: ' ' }), undefined);
  assert.deepEqual(cleanDelivery({ address: 'A', cod: true, charge: 30 }), { address: 'A', status: 'new', charge: 30, cod: true });
  const charge = deliveryChargeLine([{ name: 'Rice', hsn: '1006', tax_rate: 5, quantity: 2, rate: 620 }, { name: 'Soap', hsn: '3401', tax_rate: 18, quantity: 1, rate: 40 }], 30, 'x');
  assert.deepEqual([charge?.hsn, charge?.tax_rate, charge?.rate], ['1006', 5, 30], 'charged at the main goods line\'s rate (G5 / RT6)');
  const inv = order();
  assert.equal(reload(inv.id).delivery?.status, 'packed', 'the record keeps the delivery snapshot');
  assert.equal(deliveryRows(localDb.invoices.getAll()).length, 1);
});

test('COD delivered → a cash receipt with the rider, in "Cash with riders" (not counter cash), Z report line', () => {
  const rider = saveRider({ name: 'Raju', phone: '9800000001' });
  const inv = order();
  moveDelivery(inv.id, 'out', DAY, rider.id);
  assert.throws(() => moveDelivery(inv.id, 'packed', DAY), /cannot be marked/);
  const { receipt } = moveDelivery(inv.id, 'delivered', DAY);
  assert.ok(receipt && receipt.method === 'Cash' && receipt.rider_id === rider.id && receipt.amount === 1240 && receipt.date === DAY);
  assert.equal(movedNoCash(receipt), false, 'the cash moved (into the rider\'s hands)');
  assert.equal(reload(inv.id).status, 'Paid');
  assert.equal(liveCashWithRiders(DAY), 1240);
  const z = zReport(DAY, localDb.invoices.getAll(), getTable<Payment>('transactions'));
  assert.deepEqual([z.tenders.cash, z.riderCash], [0, 1240], 'Z report: not in the drawer, its own line');
  // Ledger: the receipt debits "Cash with riders".
  const led = loadLedger();
  const riderAcc = chartOf(loadUserAccounts()).find((a) => a.name === RIDER_CASH_LEDGER)!.id;
  const rcpt = led.vouchers.find((v) => v.id === `rcpt:${receipt.id}`)!;
  assert.ok(rcpt.lines.some((l) => l.account === riderAcc && l.dr === 124000));
  assert.ok(!rcpt.lines.some((l) => l.account === A.cash));
});

test('settlement: Dr Cash / Cr Cash with riders; shortage to a chosen ledger; cash seen once', () => {
  const rider = saveRider({ name: 'Raju' });
  const a = order();
  moveDelivery(a.id, 'out', DAY, rider.id);
  moveDelivery(a.id, 'delivered', DAY);
  assert.throws(() => settleRider({ riderId: rider.id, day: DAY, counted: 1200 }), /Choose the ledger/);
  const short = saveUserAccount({ code: '6990', name: 'Rider shortages', group: 'INDIRECT_EXPENSES' });
  const s = settleRider({ riderId: rider.id, day: DAY, counted: 1200, differenceAccountId: short.id });
  assert.deepEqual([s.expected, s.counted, s.difference], [1240, 1200, -40]);
  const v = loadVouchers().find((x) => x.id === s.voucher_id)!;
  const riderAcc = riderCashLedger();
  assert.deepEqual(v.lines.map((l) => [l.account_id, l.dr, l.cr]), [[A.cash, 120000, 0], [short.id, 4000, 0], [riderAcc, 0, 124000]]);
  assert.equal(liveCashWithRiders(DAY), 0, 'Z report "Cash with riders" ₹0 after settling');
  assert.throws(() => settleRider({ riderId: rider.id, day: DAY, counted: 0 }), /no unsettled cash/);
  // Today counts the COD receipt once as cash; the settlement journal is not a receipt.
  const t = todaySummary({ invoices: localDb.invoices.getAll(), payments: getTable('transactions'), purchases: [] }, DAY);
  assert.equal(t.cash, 1240);
  assert.equal(loadSettlements().length, 1);
  assert.deepEqual(settlementLines(100, 100, 'r'), [{ account_id: A.cash, dr: 10000, cr: 0 }, { account_id: 'r', dr: 0, cr: 10000 }]);
  assert.equal(cashWithRiders([{ id: 'p', invoice_id: 'i', amount: 50, method: 'Cash', date: DAY, rider_id: 'r' }], [], DAY), 50);
});

test('a returned order makes its goods-returned credit note once', async () => {
  const inv = order(false);
  moveDelivery(inv.id, 'out', DAY);
  moveDelivery(inv.id, 'returned', DAY);
  const note = await returnedCreditNote(inv.id);
  assert.equal(note.doc_type, 'CREDIT_NOTE');
  assert.equal(note.total, 1240);
  assert.equal(reload(inv.id).delivery?.credit_note_id, note.id);
  await assert.rejects(() => returnedCreditNote(inv.id), /already made/);
});
