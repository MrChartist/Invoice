/** SV-C1 memberships and packages: term, freeze, upgrade, transfer, cancel refund, redeem, expiry, wallet, renewals, gate. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { Membership } from '../src/types/services-r10.ts';
import { addMonths, baseEnd, forfeited, redeemPatch, renewals, saveMemberPlan, sessionsUsed, statusOf, unusedValue, loadMemberships } from '../src/lib/services/sv-members.ts';
import { autoRenewDue, bonusLeft, cancelMembership, deleteMembership, freeze, renew, sec34Limit, sellPlan, topUp, transfer, unfreeze, upgrade, useBonus } from '../src/lib/services/sv-memberships.ts';
import { lineKind } from '../src/lib/services/sv-commission.ts';
import { saveServiceSettings } from '../src/lib/services/sv-settings.ts';
import { isPackOn } from '../src/lib/industry-packs.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const inv = (id: string) => localDb.invoices.getById(id)!;
const gym = (over = {}) => saveMemberPlan({ name: '6 months', kind: 'membership', months: 6, price: 9000, cls: 'fitness_9997', freeze: { max_days: 30, max_times: 2, min_days: 7, fee: 200 }, transferable: true, transfer_fee: 500, refund: 'pro_rata', ...over });
const facials = () => saveMemberPlan({ name: '6 facials', kind: 'package', sessions: 6, validity_days: 180, covers: ['Facial'], price: 9000, cls: 'beauty_9997' });

test('end date from the term across month ends; packages by validity; wallets open', () => {
  assert.deepEqual(addMonths('2026-01-31', 1), { day: '2026-02-28', clamped: true });
  assert.equal(baseEnd({ kind: 'membership', months: 1 }, '2026-01-31'), '2026-02-28');
  assert.equal(baseEnd({ kind: 'membership', months: 6 }, '2026-01-15'), '2026-07-14');
  assert.equal(baseEnd({ kind: 'membership', days: 30 }, '2026-02-01'), '2026-03-02');
  assert.equal(baseEnd({ kind: 'package', validity_days: 90 }, '2026-01-01'), '2026-03-31');
  assert.equal(baseEnd({ kind: 'package' }, '2026-01-01'), '');
  assert.equal(baseEnd({ kind: 'wallet' }, '2026-01-01'), '');
});

test('sale: one issued invoice for the whole price at 5% (fitness after 22 Sep 2025), MEM numbering, record sv.membership', () => {
  const p = gym();
  const m = sellPlan({ plan_id: p.id, client_name: 'Rahul', start: '2026-05-01' });
  assert.equal(m.number, 'MEM/FY26-27/0001');
  assert.equal(m.end, '2026-10-31');
  const i = inv(m.invoice_ids[0]);
  assert.equal(i.status, 'Sent');
  assert.equal(i.items[0].rate, 9000);
  assert.equal(Number(i.items[0].tax_rate), 5);
  assert.equal(i.sv?.membership?.number, m.number);
  assert.equal(lineKind(i.items[0], i), 'membership_sale', 'commission kind: membership sale');
  assert.equal(sellPlan({ plan_id: p.id, client_name: 'Asha', start: '2026-05-02' }).number, 'MEM/FY26-27/0002');
});

test('freeze moves the end by the frozen days within the rules; fee bill; unfreeze early recomputes', () => {
  const m = sellPlan({ plan_id: gym().id, client_name: 'Rahul', start: '2026-05-01' });
  assert.throws(() => freeze(m.id, '2026-07-01', '2026-07-03'), /at least 7 days/);
  assert.throws(() => freeze(m.id, '2026-07-01', '2026-08-15'), /At most 30 frozen days/);
  const f = freeze(m.id, '2026-07-01', '2026-07-20', 'travel');
  assert.equal(f.end, '2026-11-20', '20 days later');
  assert.equal(statusOf(f, '2026-07-10'), 'frozen');
  assert.equal(statusOf(f, '2026-11-15'), 'active');
  assert.equal(inv(f.freezes![0].invoice_id!).items[0].rate, 200, 'freeze fee billed separately');
  assert.throws(() => freeze(m.id, '2026-07-15', '2026-07-25'), /overlaps/);
  const u = unfreeze(m.id, '2026-07-11');
  assert.deepEqual(u.freezes!.map((x) => x.to), ['2026-07-10']);
  assert.equal(u.end, '2026-11-10');
});

test('unused value pro rata by days and by sessions at the old price', () => {
  const m = sellPlan({ plan_id: gym({ months: 0, days: 100, price: 10000 }).id, client_name: 'R', start: '2026-05-01' });
  assert.deepEqual(unusedValue(m, '2026-05-30'), { value: 7000, left: 70, of: 100, by: 'days' });
  const pk = sellPlan({ plan_id: facials().id, client_name: 'Meera', start: '2026-05-01' });
  assert.deepEqual(unusedValue(pk, '2026-06-01', 2), { value: 6000, left: 4, of: 6, by: 'sessions' });
});

test('upgrade: one invoice for the difference with the credit noted; credit-note mode bills the full price', () => {
  const six = gym({ months: 0, days: 100, price: 10000 });
  const year = saveMemberPlan({ name: 'Annual', kind: 'membership', months: 12, price: 18000, cls: 'fitness_9997' });
  const m = sellPlan({ plan_id: six.id, client_name: 'Rahul', start: '2026-05-01' });
  const next = upgrade(m.id, year.id, '2026-05-31');
  assert.equal(inv(next.invoice_ids[0]).items[0].rate, 11000, '18,000 − 7,000 unused');
  assert.match(String(inv(next.invoice_ids[0]).items[0].description), /₹7000 credited for 70 unused days/);
  assert.equal(loadMemberships().find((x) => x.id === m.id)!.closed, 'upgraded');
  saveServiceSettings({ upgrade_mode: 'credit_note' });
  const m2 = sellPlan({ plan_id: six.id, client_name: 'Asha', start: '2026-05-01' });
  const n2 = upgrade(m2.id, year.id, '2026-05-31');
  assert.equal(inv(n2.invoice_ids[0]).items[0].rate, 18000);
  const cn = inv(loadMemberships().find((x) => x.id === m2.id)!.history![0].credit_note_id!);
  assert.equal(cn.doc_type, 'CREDIT_NOTE');
  assert.equal(Number(cn.taxable_value), 7000);
  assert.equal(Number(cn.tax_amount), 350, '5% reversed on the credit');
});

test('transfer with fee keeps the history; cancel refunds pro rata by a GST credit note; Sec 34 refusal past the date', () => {
  const m = sellPlan({ plan_id: gym({ months: 0, days: 100, price: 10000 }).id, client_name: 'Rahul', start: '2026-05-01' });
  const t = transfer(m.id, { client_name: 'Vikram' }, '2026-05-10');
  assert.equal(t.client_name, 'Vikram');
  assert.equal(t.history![0].note, 'Rahul → Vikram');
  assert.equal(inv(t.history![0].invoice_id!).client.name, 'Rahul', 'fee billed to the old member');
  const c = cancelMembership(m.id, '2026-05-30', 'moved city');
  assert.equal(c.closed, 'cancelled');
  const note = inv(c.history!.at(-1)!.credit_note_id!);
  assert.equal(Number(note.taxable_value), 7000);
  assert.equal(getTable<{ to_id: string; relation: string }>('doc_links').filter((l) => l.to_id === note.id && l.relation === 'credit_note').length, 1);
  assert.equal(sec34Limit('2026-05-01'), '2027-11-30');
  const old = sellPlan({ plan_id: gym({ name: 'Old', months: 0, days: 1000, price: 1000 }).id, client_name: 'Z', start: '2024-05-01' });
  localDb.invoices.save({ ...inv(old.invoice_ids[0]), issue_date: '2024-05-01' } as InvoiceRecord);
  assert.throws(() => cancelMembership(old.id, '2026-05-30', 'x', 100), /Sec 34\(2\)/);
});

test('redeem: ₹0 line with the session text and the commission value; over-use refused; expired refused; forfeiture', () => {
  const m = sellPlan({ plan_id: facials().id, client_name: 'Meera', start: '2026-05-01' });
  const line = { name: 'Facial', sv: { staff_id: 's1' } };
  const p = redeemPatch(m, line, '2026-05-05', 2);
  assert.equal(p.rate, 0);
  assert.equal(p.description, `Session 3 of 6: ${m.number}`);
  assert.deepEqual(p.sv?.redeem, { membership_id: m.id, session: 3, of: 6, value: 1500 });
  assert.equal(p.sv?.staff_id, 's1');
  assert.throws(() => redeemPatch(m, line, '2026-05-05', 6), /expired/);
  assert.throws(() => redeemPatch(m, { name: 'Haircut' }, '2026-05-05', 0), /does not cover/);
  assert.throws(() => redeemPatch(m, line, '2026-12-01', 0), /expired: renew/);
  const bill = { ...inv(m.invoice_ids[0]), id: 'r1', invoice_number: 'INV/X/1', items: [{ ...inv(m.invoice_ids[0]).items[0], name: 'Facial', ...p }] } as InvoiceRecord;
  assert.equal(sessionsUsed(m, [bill]), 1);
  assert.equal(lineKind(bill.items[0], { sv: undefined }), 'package_redemption');
  const f = forfeited([m], [bill], [], '2026-12-01');
  assert.deepEqual(f.map((x) => [x.month, x.unused, x.value]), [['2026-10', 5, 7500]]);
});

test('wallet: top-up is an advance receipt with GST; bonus is a discount, never cash', () => {
  const w = saveMemberPlan({ name: 'Wallet 10k', kind: 'wallet', price: 0, tax_rate: 5, bonus_pct: 10 });
  const m = sellPlan({ plan_id: w.id, client_name: 'Meera', start: '2026-05-01', topup: { amount: 10000, method: 'Cash' } });
  assert.equal(m.invoice_ids.length, 0, 'no sale bill: the advance is the tax document');
  const adv = getTable<{ id: string; amount: number; tax: { applies: boolean } }>('advances');
  assert.equal(adv.length, 1);
  assert.equal(adv[0].amount, 10000);
  assert.equal(adv[0].tax.applies, true);
  assert.equal(bonusLeft(m), 1000);
  assert.equal(bonusLeft(useBonus(m.id, 400)), 600);
  assert.throws(() => useBonus(m.id, 700), /Bonus left/);
  assert.equal(bonusLeft(topUp(m.id, 2000, 'Cash', '2026-06-01')), 800);
});

test('renewal window, renew and auto-renew drafts; delete refused while billed', () => {
  const p = gym({ months: 1, freeze: undefined });
  sellPlan({ plan_id: p.id, client_name: 'A', start: '2026-05-01', auto_renew: true });
  const b = sellPlan({ plan_id: p.id, client_name: 'B', start: '2026-05-20' });
  assert.deepEqual(renewals(loadMemberships(), '2026-05-25', 7).map((r) => [r.m.client_name, r.left]), [['A', 6]]);
  const auto = autoRenewDue('2026-06-02');
  assert.equal(auto.length, 1);
  assert.equal(auto[0].start, '2026-06-01');
  assert.equal(inv(auto[0].invoice_ids[0]).status, 'Draft', 'auto-renew makes a draft bill');
  assert.equal(autoRenewDue('2026-06-03').length, 0, 'once');
  const r = renew(b.id, '2026-05-25');
  assert.equal(r.start, '2026-06-20');
  assert.throws(() => renew(b.id, '2026-05-25'), /already renewed/);
  assert.throws(() => deleteMembership(b.id), /Cancel INV/);
});

test('status, and the pack gate: members tab rows need fitness or salon', () => {
  const m: Membership = { id: 'x', number: 'MEM/1', client_name: 'A', plan: { id: 'p', name: 'P', kind: 'combo', months: 1, sessions: 2, price: 100 }, start: '2026-05-01', end: '2026-05-31', invoice_ids: [], created_at: '' };
  assert.equal(statusOf(m, '2026-05-10', 1), 'active');
  assert.equal(statusOf(m, '2026-05-10', 2), 'expired', 'sessions used up');
  assert.equal(statusOf(m, '2026-06-01'), 'expired');
  assert.equal(statusOf({ ...m, closed: 'cancelled' }, '2026-05-10'), 'cancelled');
  assert.equal(isPackOn({ business_type: 'services', industry_packs: ['fitness'] } as never, 'fitness'), true);
  assert.equal(isPackOn({ business_type: 'services' } as never, 'fitness'), false);
});
