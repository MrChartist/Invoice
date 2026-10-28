/**
 * R18-D2 Receipts and Payments (pure over posting lines): opening / closing cash and bank, receipts and payments by
 * the other ledger of each cash voucher, contra entries net out, clearing accounts left out by the caller.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptsPayments } from '../src/lib/society/hs-rp.ts';
import type { Ledger } from '../src/lib/ledger/postings.ts';

const acc = (id: string, name: string) => [id, { id, name }] as const;
const v = (date: string, lines: [string, number, number][]) => ({ date, lines: lines.map(([account, dr, cr]) => ({ account, dr, cr })) });
const ledger = {
  byId: new Map([acc('cash', 'Cash'), acc('bank:1', 'HDFC'), acc('bank:clr', 'Settlement clearing'), acc('debtors', 'Sundry debtors'), acc('repairs', 'Repairs'), acc('tds', 'TDS receivable')]),
  vouchers: [
    v('2026-03-20', [['bank:1', 10000_00, 0], ['debtors', 0, 10000_00]]), // before the FY: opening
    v('2026-11-02', [['bank:1', 6000_00, 0], ['debtors', 0, 6000_00]]), // the ₹6,000 receipt
    v('2026-11-05', [['repairs', 1000_00, 0], ['bank:1', 0, 900_00], ['tds', 0, 100_00]]),
    v('2026-11-06', [['cash', 500_00, 0], ['bank:1', 0, 500_00]]), // contra
    v('2026-11-07', [['bank:clr', 300_00, 0], ['debtors', 0, 300_00]]), // clearing: not cash
    v('2027-04-02', [['bank:1', 1_00, 0], ['debtors', 0, 1_00]]), // after the FY
  ],
} as unknown as Ledger;

test('opening, receipts by ledger, payments by ledger, closing; contra nets; clearing out', () => {
  const r = receiptsPayments(ledger, { start: '2026-04-01', end: '2027-03-31' }, (id) => id === 'cash' || id === 'bank:1');
  assert.deepEqual(r, {
    opening: 10000_00,
    receipts: [{ account: 'Sundry debtors', amount: 6000_00 }, { account: 'TDS receivable', amount: 100_00 }],
    payments: [{ account: 'Repairs', amount: 1000_00 }],
    closing: 15100_00,
  });
  assert.equal(r.closing, r.opening + 6100_00 - 1000_00);
});
