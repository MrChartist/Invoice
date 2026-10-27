/** PS-D4 44ADA / Sec 58: limits by FY, the 5 % cash test at the boundary, deemed 50 %, recoveries out, credit notes in, LLP note, local-day FY bounds. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { PURE_AGENT_CHARGE } from '../src/lib/trade/pure-agent.ts';
import { presumptive } from '../src/lib/prof/ps-presumptive.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const pay = (invoice_id: string, amount: number, method: string, date: string, extra: Partial<Payment> = {}): Payment => ({ id: `${invoice_id}-${method}-${date}`, invoice_id, amount, method, date, ...extra });

test('limit ₹50 lakh before FY 2023-24; ₹75 lakh when cash ≤ 5 % (boundary), Sec 58 label from TY 2026-27', () => {
  const inv = createViaStore({ date: '2025-06-10', lines: [{ name: 'Fees', qty: 1, rate: 6100000, tax: 18 }] });
  const i = [inv] as InvoiceRecord[];
  const at5 = presumptive({ fy: 2025, invoices: i, receipts: [pay(inv.id, 95, 'Bank', '2025-07-01'), pay(inv.id, 5, 'Cash', '2025-07-01')], bookProfit: 3800000 });
  assert.deepEqual([at5.accrual, at5.cashPct, at5.limit, at5.raised, at5.withinLimit, at5.deemed, at5.difference], [6100000, 5, 7500000, true, true, 3050000, -750000]);
  const over = presumptive({ fy: 2025, invoices: i, receipts: [pay(inv.id, 94.9, 'Bank', '2025-07-01'), pay(inv.id, 5.1, 'Cash', '2025-07-01')] });
  assert.deepEqual([over.limit, over.raised, over.withinLimit], [5000000, false, false]);
  const old = presumptive({ fy: 2022, invoices: [], receipts: [] });
  assert.equal(old.limit, 5000000);
  assert.equal(old.section, '44ADA');
  assert.equal(presumptive({ fy: 2026, invoices: [], receipts: [] }).section, 'Sec 58');
  assert.equal(at5.advanceTaxDue, '2026-03-15');
  assert.equal(at5.verified, false, 'advance-tax row is recalled: verify');
});

test('pure-agent recoveries out, credit notes in, drafts / other FY out, no-cash receipts skipped', () => {
  const a = createViaStore({ date: '2025-04-01', lines: [{ name: 'Fees', qty: 1, rate: 100000, tax: 18 }, { name: 'Court fee', qty: 1, rate: 2450, tax: 0 }] });
  localDb.invoices.save({ ...a, items: a.items.map((it, k) => (k === 1 ? { ...it, charge_head_id: 'rule33', description: PURE_AGENT_CHARGE } : it)) });
  createViaStore({ date: '2026-03-31', lines: [{ name: 'Fees', qty: 1, rate: 10000, tax: 18 }], docType: 'CREDIT_NOTE' });
  createViaStore({ date: '2026-04-01', lines: [{ name: 'Fees', qty: 1, rate: 50000, tax: 18 }] });
  createViaStore({ date: '2025-08-01', lines: [{ name: 'Fees', qty: 1, rate: 70000, tax: 18 }], asDraft: true });
  const invs = localDb.invoices.getAll() as InvoiceRecord[];
  const p = presumptive({ fy: 2025, invoices: invs, receipts: [pay(a.id, 50000, 'Cash', '2025-05-01', { advance_id: 'adv' }), pay(a.id, 100000, 'Bank', '2025-05-01')], firmForm: 'llp' });
  assert.equal(p.accrual, 90000);
  assert.equal(p.recoveriesOut, 2450);
  assert.equal(p.cashPct, 0, 'the advance adjustment moved no money');
  assert.equal(p.cashBasis, 100000);
  assert.match(p.notes[0], /Not available to an LLP — verify/);
  assert.match(presumptive({ fy: 2025, invoices: [], receipts: [], firmForm: 'partnership' }).notes[0], /remuneration and interest/);
});
