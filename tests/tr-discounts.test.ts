/** TR-A1: compound / per-unit discounts, party-item rates, last purchase rate, cash-discount term, minimum-margin hold. */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, SELLER } from './helpers/world.ts';
import { setActorProvider, type Role } from '../src/lib/access.ts';
import { localDb } from '../src/lib/localDb.ts';
import { audit } from '../src/lib/audit.ts';
import { setTable } from '../src/lib/storage.ts';
import { calcInputFromRecord, calculateInvoice } from '../src/lib/invoice-calc.ts';
import { registerCreditGate } from '../src/lib/approval-gate.ts';
import { creditGate, saveCreditPolicy } from '../src/lib/credit-policy.ts';
import { resolvePrice } from '../src/lib/pricing.ts';
import { settlementOptions } from '../src/lib/settlement.ts';
import { cashDiscountText, discountText } from '../src/components/templates/paper-helpers.ts';
import { chainPercent, discountLabel, effectivePercent, parseChain, reconcileDiscount } from '../src/lib/trade/tr-discounts.ts';
import { marginShortfalls, minMarginIndex } from '../src/lib/trade/tr-margin.ts';
import { lastPurchaseRate, loadPartyRates, parseBulkRates, partyRateFor, savePartyRate } from '../src/lib/trade/tr-party-rates.ts';
import type { Client, InvoiceRecord } from '../src/types/invoice.ts';

const as = (role: Role | null, name: string = role ?? '') => setActorProvider(role ? () => ({ id: name, name, role }) : null);
beforeEach(() => {
  as(null);
  resetStorage();
  installSettings();
});
afterEach(() => as(null));

test('chain maths: 18+4 → 21.28 %, 10+5+2 → 16.21 %, 6-decimal rounding, parse rules', () => {
  assert.deepEqual(parseChain('18+4'), [18, 4]);
  assert.deepEqual(parseChain(' 10 + 5 + 2 %'), [10, 5, 2]);
  assert.equal(parseChain('1+2+3+4'), null, 'at most 3 steps');
  assert.equal(parseChain('120'), null);
  assert.equal(parseChain('a+4'), null);
  assert.equal(chainPercent([18, 4]), 21.28);
  assert.equal(chainPercent([10, 5, 2]), 16.21);
  assert.equal(chainPercent([33.3, 33.3]), 55.5111);
  assert.equal(chainPercent([12.5, 7.25, 3.333]), 21.548688);
  assert.equal(discountLabel({ disc_chain: [18, 4], disc_per_unit: 5 }), '18 + 4 % + ₹5/unit');
  assert.equal(discountText({ disc_chain: [18, 4] }), 'Disc 18 + 4 %');
  assert.equal(discountText({}), '');
});

test('per-unit discount on the chained price; a typed % clears the snapshots; a rate change re-derives', () => {
  // ₹1,000 less 18 + 4 % = ₹787.20, less ₹5 = ₹782.20 → 21.78 %.
  assert.equal(effectivePercent([18, 4], 5, 1000), 21.78);
  assert.equal(effectivePercent(undefined, 5, 200), 2.5);
  assert.equal(effectivePercent([100], 5, 10), 100, 'capped');
  const line = { rate: 1000, discount_percent: 21.78, disc_chain: [18, 4], disc_per_unit: 5 };
  assert.equal(reconcileDiscount(line, 21.78), null);
  assert.deepEqual(reconcileDiscount({ ...line, discount_percent: 10 }, 21.78), { disc_chain: undefined, disc_per_unit: undefined }, 'typed');
  assert.deepEqual(reconcileDiscount({ ...line, rate: 500 }, 21.78), { discount_percent: 22.28 }, 'rate changed');
  assert.equal(reconcileDiscount({ rate: 1, discount_percent: 3 }), null, 'no snapshot, nothing to do');
});

test('invoice totals equal those of the same effective % typed by hand (calculateInvoice untouched)', () => {
  const base = {
    id: 'i', invoice_number: 'X', doc_type: 'TAX_INVOICE', issue_date: '2026-10-01', due_date: '2026-10-01', status: 'Sent', currency: 'INR', template_id: 't', client: { name: 'A' }, sender: SELLER,
    gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 18, shipping: 0, other_charges: 0, round_off_enabled: true, amount_paid: 0,
  } as unknown as InvoiceRecord;
  const pct = effectivePercent([18, 4], 0, 1250);
  const chained = calculateInvoice(calcInputFromRecord({ ...base, items: [{ id: 'l', name: 'MCB', type: 'Goods', hsn: '8536', unit: 'NOS', quantity: 120, rate: 1250, tax_rate: 18, discount_percent: pct, disc_chain: [18, 4], amount: 0 }] }));
  const typed = calculateInvoice(calcInputFromRecord({ ...base, items: [{ id: 'l', name: 'MCB', type: 'Goods', hsn: '8536', unit: 'NOS', quantity: 120, rate: 1250, tax_rate: 18, discount_percent: 21.28, amount: 0 }] }));
  assert.equal(chained.total, typed.total);
  assert.equal(chained.taxable_value, 118080);
});

test('party rate beats the level, the level beats the list; dated rows; purchase side; bulk paste', () => {
  const item = { id: 'it1', rate: 100, qty_slabs: [{ min_qty: 10, rate: 80 }] };
  const level = { id: 'L', name: 'Wholesale', percent_off: 10 };
  assert.deepEqual(resolvePrice(item, 1, level, null, 70), { rate: 70, basis: 'Party rate', source: 'party' });
  assert.equal(resolvePrice(item, 20, level, null, 95).rate, 95, 'the party rate wins even over a lower slab');
  assert.equal(resolvePrice(item, 1, level).basis, 'Wholesale', 'level when no party rate');
  assert.equal(resolvePrice({ ...item, rate: 90 }, 1, null).source, 'base', 'the list rate (passed as item rate) below a level');
  as('owner');
  savePartyRate({ side: 'sale', party_id: 'c1', party_name: 'Sharma Traders', item_id: 'it1', item_name: 'Havells MCB', rate: 70, valid_from: '2026-10-01', valid_to: '2026-10-31' });
  savePartyRate({ side: 'sale', party_id: 'c1', party_name: 'Sharma Traders', item_name: 'Havells MCB', disc_chain: [18, 4], valid_from: '2026-10-15' });
  savePartyRate({ side: 'purchase', party_id: 'v1', party_name: 'Havells', item_name: 'Havells MCB', rate: 60, valid_from: '2026-01-01' });
  const rows = loadPartyRates();
  assert.equal(partyRateFor(rows, 'sale', { id: 'c1' }, { name: 'havells mcb' }, '2026-10-10')?.rate, 70);
  assert.deepEqual(partyRateFor(rows, 'sale', { id: 'c1' }, { name: 'Havells MCB' }, '2026-10-20')?.disc_chain, [18, 4], 'the latest start wins');
  assert.equal(partyRateFor(rows, 'sale', { id: 'c2' }, { name: 'Havells MCB' }, '2026-10-20'), undefined);
  assert.equal(partyRateFor(rows, 'sale', { id: 'c1' }, { id: 'x', name: 'Other' }, '2026-10-20'), undefined);
  assert.equal(partyRateFor(rows, 'purchase', { id: 'v1' }, { name: 'Havells MCB' }, '2026-10-20')?.rate, 60);
  assert.throws(() => savePartyRate({ side: 'sale', party_id: 'c1', party_name: 'S', item_name: 'X', valid_from: '2026-10-01' }), /rate or a discount/);
  const bulk = parseBulkRates('MCB 6A, 120, 18+4\nMCB 10A\t130\nbad, x\n\nRCCB,,10+5');
  assert.deepEqual(bulk.rows, [{ item_name: 'MCB 6A', rate: 120, disc_chain: [18, 4] }, { item_name: 'MCB 10A', rate: 130 }, { item_name: 'RCCB', disc_chain: [10, 5] }]);
  assert.deepEqual(bulk.bad, [2 + 1]);
});

test('credit / debit notes are never re-priced (the editor glue skips them)', () => {
  const src = readFileSync(new URL('../src/components/creator/pricing-actions.ts', import.meta.url), 'utf8');
  assert.match(src, /t !== 'CREDIT_NOTE' && t !== 'DEBIT_NOTE'/);
  assert.match(src, /pricedDoc\(\) && tr \? tr\.partyRateFor/);
});

test('last purchase rate from this supplier (live bills only, by vendor id, else name)', () => {
  const bill = (id: string, date: string, rate: number, over: Record<string, unknown> = {}) => ({ id, kind: 'PURCHASE', vendor_id: 'v1', vendor_name: 'Havells', bill_number: id, date, lines: [{ id: 'l', name: 'Havells MCB', quantity: 10, rate, tax_rate: 18 }], taxable: rate * 10, total: rate * 11.8, status: 'Unpaid', ...over });
  const bills = [bill('B1', '2026-09-01', 60), bill('B2', '2026-10-01', 62), bill('B3', '2026-10-05', 99, { status: 'Cancelled' }), bill('B4', '2026-10-09', 70, { vendor_id: 'v2' })];
  assert.deepEqual(lastPurchaseRate(bills, { id: 'v1', name: 'Havells' }, 'havells mcb'), { rate: 62, date: '2026-10-01', number: 'B2' });
  assert.equal(lastPurchaseRate(bills, { id: 'v1' }, 'Other'), null);
});

test('cash-discount term: printed date and amount; the receipt proposes the settlement discount within the days', () => {
  const inv = { issue_date: '2026-10-27', doc_type: 'TAX_INVOICE', cash_discount: { percent: 2, days: 7 } } as const;
  assert.equal(cashDiscountText(inv as never, 61700, (n) => `₹${n.toFixed(2)}`), '2% cash discount if paid by 03-11-2026: ₹1234.00');
  assert.equal(cashDiscountText({ ...inv, doc_type: 'CREDIT_NOTE' } as never, 100, String), '');
  const opts = settlementOptions({ payment_terms: undefined, ...inv } as never, 1000, 980, '2026-11-03');
  assert.deepEqual(opts, { rest: 20, early: { amount: 20, until: '2026-11-03', percent: 2 }, suggested: 'settlement_discount' });
  assert.equal(settlementOptions({ payment_terms: undefined, ...inv } as never, 1000, 980, '2026-11-04').suggested, 'leave', 'too late');
});

test('minimum margin: group floor (inherited) or company default; a clerk is held (reason margin), the owner passes (audited)', async () => {
  const minFor = minMarginIndex([{ name: 'MCB', group_id: 'sub' }, { name: 'Wire' }], [{ id: 'top', name: 'Electrical', min_margin_percent: 8 }, { id: 'sub', name: 'Switchgear', parent_id: 'top' }], 5);
  assert.equal(minFor('mcb'), 8);
  assert.equal(minFor('Wire'), 5);
  const costs = new Map([['mcb', { cost: 95, basis: 'purchase' as const }]]);
  const low = marginShortfalls([{ id: 'l', name: 'MCB', quantity: 1, rate: 100, discount_percent: 0, type: 'Goods', unit: 'NOS', tax_rate: 18, amount: 100 }], costs, minFor);
  assert.deepEqual(low, [{ id: 'l', name: 'MCB', pct: 5, min: 8 }]);

  await import('../src/lib/trade/tr-margin.ts'); // registers the check
  const client: Client = { id: 'c1', name: 'Sharma Traders', email: '', address: '', city: '', zip: '', credit_limit: 10_000_000 };
  setTable('clients', [client]);
  setTable('stock_items', [{ id: 's1', name: 'MCB', unit: 'NOS', track_stock: true, opening_qty: 10, opening_rate: 95, reorder_level: 0 }]);
  localDb.settings.save({ ...localDb.settings.get(), trade_min_margin: 8 });
  as('owner', 'Owner');
  saveCreditPolicy({ mode: 'block', include_orders: false, block_overdue: false });
  registerCreditGate(creditGate);
  const doc = (id: string): InvoiceRecord => ({
    id, invoice_number: `INV/${id}`, doc_type: 'INVOICE', issue_date: '2026-10-10', due_date: '2026-10-20', status: 'Sent', currency: 'INR', template_id: 't', client: { id: 'c1', name: 'Sharma Traders' } as Client, sender: SELLER,
    items: [{ id: 'l', name: 'MCB', type: 'Goods', unit: 'NOS', quantity: 1, rate: 100, tax_rate: 0, amount: 100 }], gst_mode: 'NONE', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0,
    subtotal: 100, discount_amount: 0, taxable_value: 100, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0, total: 100, balance_due: 100,
  } as InvoiceRecord);
  as('clerk', 'Ravi');
  const held = localDb.invoices.save(doc('m1'));
  assert.equal(held.status, 'Draft');
  assert.equal(held.approval?.reason, 'margin');
  assert.match(held.approval?.note ?? '', /MCB 5% \(min 8%\)/);
  as('owner', 'Owner');
  assert.equal(localDb.invoices.save(doc('m2')).status, 'Sent');
  assert.ok(audit.all().some((r) => /Minimum margin overridden by Owner/.test(r.summary)));
});
