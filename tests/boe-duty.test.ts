/**
 * R4-C3: Bill of Entry duty — the ₹1,00,000 CIF example at 10 / 10 / 18, the old 1% landing charge by date,
 * multi-line AV allocation, rupee rounding, landed-cost rows raising stock cost, the duty journal and the register.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { applyBoe, computeBoe, dutyJournalLines, dutyLandedCosts, importRegister, importRegisterSheet, lineDuties } from '../src/lib/trade/boe-duty.ts';
import { postBoeDuty } from '../src/lib/trade/boe-post.ts';
import { readPurchaseLines } from '../src/lib/purchase-normalize.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => resetStorage());

const line = (line_id: string, value: number, over: Record<string, number> = {}) => ({ line_id, value, bcd_pct: 10, igst_pct: 18, ...over });

test('₹1,00,000 CIF at BCD 10%, SWS 10% of BCD, IGST 18% → BCD 10,000 · SWS 1,000 · IGST 19,980 (current rule, no landing charge)', () => {
  const d = computeBoe({ date: '2026-06-01', rate: 1, cif: 100000, lines: [line('l1', 1)] });
  assert.deepEqual(d.totals, { av: 100000, bcd: 10000, sws: 1000, other: 0, igst: 19980, cess: 0, duty: 11000, total: 30980 });
  assert.equal(d.lines[0].sws_pct, 10, 'SWS default from the dated rule');
});

test('the historical 1% landing charge applies to old BOE dates; FOB + freight + insurance in FCY × the customs rate', () => {
  const old = computeBoe({ date: '2016-06-01', rate: 1, cif: 100000, lines: [line('l1', 1)] });
  assert.equal(old.totals.av, 101000);
  const fx = computeBoe({ date: '2026-06-01', rate: 83.5, fob: 1000, freight: 150, insurance: 10, lines: [line('l1', 1)] });
  assert.equal(fx.cif, 1160);
  assert.equal(fx.totals.av, 96860);
  assert.throws(() => computeBoe({ date: '2026-06-01', rate: 0, cif: 1, lines: [] }), /boeRate/);
  assert.throws(() => computeBoe({ date: '2026-06-01', rate: 80, lines: [] }), /boeCif/);
});

test('multi-line AV split by value (exact to the paisa), a typed AV kept, rupee rounding per duty, other duties in the IGST base', () => {
  const d = computeBoe({ date: '2026-06-01', rate: 1, cif: 100000.03, lines: [line('a', 1), line('b', 2, { bcd_pct: 7.5, igst_pct: 12, cess_pct: 1 }), line('c', 0, { other: 333.33 })] });
  assert.equal(d.lines.reduce((s, l) => s + l.av, 0), 100000.03);
  assert.deepEqual(d.lines.map((l) => l.av), [33333.34, 66666.69, 0]);
  const per = lineDuties(d);
  assert.deepEqual(per.map((p) => [p.bcd, p.sws, p.igst, p.cess, p.other]), [[3333, 333, 6660, 0, 0], [5000, 500, 8660, 722, 0], [0, 0, 60, 0, 333]]);
  assert.equal(d.totals.igst, 6660 + 8660 + 60);
  const typed = computeBoe({ date: '2026-06-01', rate: 1, cif: 1000, lines: [{ ...line('a', 1), av: 300 }, line('b', 1)] });
  assert.deepEqual(typed.lines.map((l) => [l.av, !!l.av_typed]), [[300, true], [700, false]]);
});

test('apply: duty rows in landed costs (other charges kept, re-apply replaces), IGST / cess into the bill, stock cost raised', () => {
  const d = computeBoe({ date: '2026-06-01', rate: 1, cif: 100000, lines: [line('l1', 100000)] });
  const costs = dutyLandedCosts([{ label: 'Freight to godown', amount: 500 }, { label: 'BCD', amount: 1 }], d);
  assert.deepEqual(costs, [{ label: 'Freight to godown', amount: 500 }, { label: 'BCD', amount: 10000 }, { label: 'SWS', amount: 1000 }]);
  const base: PurchaseRecord = {
    id: 'p1', kind: 'PURCHASE', vendor_name: 'Shenzhen Parts', bill_number: 'SZ-9', date: '2026-06-01', category: 'Purchases', import_type: 'GOODS', boe_number: '1234567', boe_date: '2026-06-02',
    lines: [{ id: 'l1', name: 'Bearing', quantity: 100, rate: 1000, tax_rate: 18 }], taxable: 100000, cgst: 0, sgst: 0, igst: 18000, itc_eligible: true, total: 118000, amount_paid: 0,
  };
  const bill = { ...base, ...applyBoe(base, d) };
  assert.deepEqual([bill.igst, bill.total, bill.boe_duty?.totals.duty], [19980, 119980, 11000]);
  assert.equal(readPurchaseLines(base)[0].landedUnit, 0);
  assert.equal(readPurchaseLines(bill)[0].landedUnit, 110, '₹11,000 duty over 100 bearings');
});

test('post duty: Dr Customs duty on imports | Cr Customs duty payable, once, stamped on the bill; the register reads it', () => {
  assert.deepEqual(dutyJournalLines(11000, { customsDuty: 'd', customsPayable: 'p' }).map((l) => [l.account_id, l.dr, l.cr]), [['d', 1100000, 0], ['p', 0, 1100000]]);
  const d = computeBoe({ date: '2026-06-02', rate: 1, cif: 100000, lines: [line('l1', 100000)] });
  const base = { kind: 'PURCHASE' as const, vendor_name: 'Shenzhen Parts', bill_number: 'SZ-9', date: '2026-06-01', category: 'Purchases', import_type: 'GOODS' as const, boe_number: '1234567', boe_date: '2026-06-02', port_code: 'INNSA1', lines: [{ id: 'l1', name: 'Bearing', quantity: 100, rate: 1000, tax_rate: 18 }], taxable: 100000, cgst: 0, sgst: 0, igst: 0, itc_eligible: true, total: 0, amount_paid: 0 };
  const bill = purchasesDb.save({ ...base, ...applyBoe(base, d) });
  const v = postBoeDuty(bill.id);
  assert.equal(v.date, '2026-06-02');
  assert.equal(v.lines.reduce((s, l) => s + l.dr - l.cr, 0), 0);
  assert.equal(purchasesDb.get(bill.id)?.boe_duty?.voucher_id, v.id);
  assert.throws(() => postBoeDuty(bill.id), /boePostedAlready/);
  assert.equal(loadVouchers().length, 1);
  const reg = importRegister(purchasesDb.all());
  assert.deepEqual(reg.map((r) => [r.boeNo, r.av, r.bcd, r.sws, r.igst, r.duty, r.itcTaken, r.posted]), [['1234567', 100000, 10000, 1000, 19980, 11000, 19980, true]]);
  assert.equal(importRegisterSheet(reg)[1][0], '1234567');
});
