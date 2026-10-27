/**
 * QA round 12 (services vertical, Round 10 SV-A / SV-C / SV-D): one regression per finding S1…Sn
 * (docs/prd/qa-round-12.md).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientRetail, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import type { Client, InvoiceItem, InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { CommissionPlan, SvLine } from '../src/types/services-r10.ts';
import { redeemPatch, saveMemberPlan, sessionsUsed, statusOf, deleteMemberPlan } from '../src/lib/services/sv-members.ts';
import { autoRenewDue, cancelMembership, freeze, renew, sellPlan, topUp } from '../src/lib/services/sv-memberships.ts';
import { checkIn } from '../src/lib/services/sv-checkin.ts';
import { commissionFor } from '../src/lib/services/sv-commission.ts';
import { billLines, saveAppointment } from '../src/lib/services/sv-appointments.ts';
import { billClaim, rejectAndRebill, saveClaim } from '../src/lib/services/sv-claims.ts';
import { saveAdvance, applyAdvance } from '../src/lib/advances.ts';
import { cancelDocument } from '../src/lib/documents.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const inv = (id: string) => localDb.invoices.getById(id)!;
const credits = () => localDb.invoices.getAll().filter((i) => i.doc_type === 'CREDIT_NOTE');

/* ── S1: a re-saved old document never resets the client master's own lists / settings ── */

test('S1: re-saving an old fee bill keeps the student\'s enrolments, contacts and birthday; identity still learns', () => {
  const id = localDb.clients.upsert({
    ...clientRetail, name: 'Aarav', phone: '9800000001', dob: '05-14',
    enrolments: [{ plan_id: 'jee', class_id: 'morning' }], contacts: [{ id: 'k1', name: 'Father', phone: '9800000002' }],
  } as Client);
  const old = createViaStore({ client: localDb.clients.getById(id)!, date: '2026-06-05', lines: [{ name: 'Tuition June', rate: 5000, qty: 1, tax: 18 }] });
  assert.deepEqual(old.client.enrolments, [{ plan_id: 'jee', class_id: 'morning' }], 'the snapshot carries the enrolments of the day');
  // Since then: moved to the evening batch with a refund request, a second contact, a corrected birthday.
  const now = localDb.clients.getById(id)!;
  localDb.clients.upsert({ ...now, dob: '05-15', enrolments: [{ plan_id: 'jee', class_id: 'evening', refund: { requested: '2026-07-01', leave: '2026-06-30', due: '2026-07-11', amount: 4000, note_ids: [] } }], contacts: [...(now.contacts ?? []), { id: 'k2', name: 'Mother', phone: '9800000003' }] } as Client);
  // The June bill is opened and saved again with a corrected phone on its party.
  localDb.invoices.save({ ...old, client: { ...old.client, phone: '9800000009' } });
  const after = localDb.clients.getById(id)!;
  assert.equal(after.enrolments?.[0].class_id, 'evening', 'enrolments kept');
  assert.ok(after.enrolments?.[0].refund, 'refund request kept');
  assert.equal(after.contacts?.length, 2, 'contacts kept');
  assert.equal(after.dob, '05-15', 'birthday kept');
  assert.equal(after.phone, '9800000009', 'the party identity typed on the document still reaches the master');
  // A party typed for the first time is created from its identity.
  createViaStore({ client: { name: 'Walk-in Kavya', email: '', address: 'MG Road', city: 'Pune', zip: '411001', phone: '9811111111' }, date: '2026-06-06', lines: [{ name: 'Haircut', rate: 500, qty: 1, tax: 5 }] });
  const k = localDb.clients.getAll().find((c) => c.name === 'Walk-in Kavya');
  assert.equal(k?.phone, '9811111111');
});

/* ── Memberships ── */

const gym = () => saveMemberPlan({ name: 'Gym 6m', kind: 'membership', months: 6, price: 9000, cls: 'fitness_9997', refund: 'pro_rata', freeze: { fee: 200 } });

test('S2: a cancelled membership cannot be cancelled again (no second refund), frozen, renewed or topped up', () => {
  const m = sellPlan({ plan_id: gym().id, client_name: 'Rahul', start: '2026-05-01' });
  cancelMembership(m.id, '2026-06-01', 'moving city');
  assert.equal(credits().length, 1);
  assert.throws(() => cancelMembership(m.id, '2026-06-02', 'again'), /cancelled/);
  assert.throws(() => cancelMembership(m.id, '2026-06-02', 'again', 5000), /cancelled/);
  assert.equal(credits().length, 1, 'one credit note only');
  assert.throws(() => freeze(m.id, '2026-06-10', '2026-06-20'), /cancelled/);
  assert.throws(() => renew(m.id, '2026-06-10'), /cancelled/);
  const w = sellPlan({ plan_id: saveMemberPlan({ name: 'Wallet', kind: 'wallet', price: 0, tax_rate: 5 }).id, client_name: 'Meera', start: '2026-05-01', topup: { amount: 1000, method: 'Cash' } });
  cancelMembership(w.id, '2026-06-01', 'closed');
  assert.throws(() => topUp(w.id, 500, 'Cash', '2026-06-02'), /cancelled/);
});

test('S3: a wallet top-up takes the plan class rate (5% salon) or the default rate — never 0% for a plan without a typed rate', () => {
  const salon = saveMemberPlan({ name: 'Salon wallet', kind: 'wallet', price: 0, cls: 'beauty_9997', bonus_pct: 10 });
  sellPlan({ plan_id: salon.id, client_name: 'Meera', start: '2026-10-01', topup: { amount: 10500, method: 'Cash' } });
  const plain = saveMemberPlan({ name: 'Plain wallet', kind: 'wallet', price: 0 });
  sellPlan({ plan_id: plain.id, client_name: 'Neha', start: '2026-10-01', topup: { amount: 1180, method: 'UPI' } });
  const adv = getTable<{ client: { name: string }; tax_rate: number }>('advances');
  assert.equal(adv.find((a) => a.client.name === 'Meera')?.tax_rate, 5, 'beauty 5% from 22 Sep 2025');
  assert.equal(adv.find((a) => a.client.name === 'Neha')?.tax_rate, Number(localDb.settings.get().defaultTaxRate), 'default rate');
  assert.ok(Number(localDb.settings.get().defaultTaxRate) > 0);
});

test('S5: a plan of an exempt class is reported in the exempt column (sv.exempt), not as nil-rated', () => {
  const yoga = saveMemberPlan({ name: 'Charitable yoga 3m', kind: 'membership', months: 3, price: 3000, cls: 'charitable_yoga' });
  const m = sellPlan({ plan_id: yoga.id, client_name: 'Asha', start: '2026-05-01' });
  const line = inv(m.invoice_ids[0]).items[0];
  assert.equal(Number(line.tax_rate), 0);
  assert.equal(line.sv?.exempt, 'EXEMPT');
  const fit = sellPlan({ plan_id: gym().id, client_name: 'Rahul', start: '2026-05-01' });
  assert.equal(inv(fit.invoice_ids[0]).items[0].sv?.exempt, undefined, 'a taxed class carries no exempt column');
});

test('S6: a membership whose sale bill was cancelled outside the desk is not active (gate, redemption)', () => {
  const pkg = saveMemberPlan({ name: '6 facials', kind: 'package', sessions: 6, validity_days: 180, price: 9000, covers: ['Facial'] });
  const m = sellPlan({ plan_id: pkg.id, client_name: 'Kavya', start: '2026-05-01' });
  const all = () => localDb.invoices.getAll();
  assert.equal(statusOf(m, '2026-05-10', 0, all()), 'active');
  cancelDocument(inv(m.invoice_ids[0]), 'customer did not pay');
  assert.equal(statusOf(m, '2026-05-10', 0, all()), 'cancelled');
  assert.throws(() => redeemPatch(m, { name: 'Facial' } as InvoiceItem, '2026-05-10', sessionsUsed(m, all()), all()), /cancelled/);
  assert.throws(() => checkIn(m, '2026-05-10', '10:00', { gate: 'block', invoices: all() }), /cancelled/);
  assert.equal(statusOf(m, '2026-05-10', 0), 'active', 'without the bills (pure maths) nothing changes');
});

test('S9: auto-renewal makes its bill as a draft at once; a membership whose plan was deleted does not stop the others', () => {
  const a = saveMemberPlan({ name: 'Monthly A', kind: 'membership', months: 1, price: 1000 });
  const b = saveMemberPlan({ name: 'Monthly B', kind: 'membership', months: 1, price: 1500 });
  sellPlan({ plan_id: a.id, client_name: 'Gone plan', start: '2026-05-01', auto_renew: true });
  sellPlan({ plan_id: b.id, client_name: 'Kept plan', start: '2026-05-01', auto_renew: true });
  deleteMemberPlan(a.id);
  const made = autoRenewDue('2026-06-05');
  assert.deepEqual(made.map((m) => m.client_name), ['Kept plan']);
  const bill = inv(made[0].invoice_ids[0]);
  assert.equal(bill.status, 'Draft');
  const log = getTable<{ action?: string; entity_id?: string; summary?: string }>('audit_log').filter((e) => e.entity_id === bill.id);
  assert.ok(!log.some((e) => /issued|Sent/i.test(String(e.summary ?? ''))), 'never saved as issued first');
});

/* ── S4: commission on receipt basis ── */

const rplan: CommissionPlan = { id: 'rp', name: 'On receipt', basis: 'receipt', created_at: '', rules: [{ kind: 'service', pct: 10 }, { kind: 'package_redemption', per_unit: 50 }] };
const priya = { id: 's1', plan_id: 'rp' };
function bill(date: string, lines: { name: string; rate: number; sv: SvLine }[]): InvoiceRecord {
  const rec = createViaStore({ client: clientRetail, date, lines: lines.map((l) => ({ name: l.name, rate: l.rate || 1, qty: 1, tax: 18 })) });
  const zero = lines.every((l) => !l.rate);
  return localDb.invoices.save({ ...rec, items: rec.items.map((it, i) => ({ ...it, sv: lines[i].sv, ...(lines[i].rate === 0 ? { rate: 0, amount: 0 } : {}) })), ...(zero ? { subtotal: 0, taxable_value: 0, tax_amount: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, total: 0, balance_due: 0, status: 'Paid' as const } : {}) });
}
const cdata = () => ({ invoices: getTable<InvoiceRecord>('invoices'), payments: getTable<Payment>('transactions'), plans: [rplan], items: [] });

test('S4: receipt basis — a ₹0 package redemption earns on its date; a bill paid from the wallet (advance) earns; a write-off does not', () => {
  bill('2026-10-05', [{ name: 'Facial', rate: 0, sv: { staff_id: 's1', redeem: { membership_id: 'm1', session: 2, of: 6, value: 1500 } } }]);
  assert.equal(commissionFor(priya, '2026-10', cdata()).total, 50, 'redemption: ₹50 per session though the bill is ₹0');
  const b = bill('2026-10-06', [{ name: 'Haircut', rate: 1000, sv: { staff_id: 's1' } }]);
  const adv = saveAdvance({ date: '2026-10-01', client: { name: clientRetail.name }, place_of_supply: '27', supply: 'services', tax_rate: 18, amount: 5000, method: 'Cash', description: 'Wallet MEM/1' });
  applyAdvance({ advanceId: adv.id, invoiceId: b.id, amount: Number(inv(b.id).total), date: '2026-10-06' });
  assert.equal(commissionFor(priya, '2026-10', cdata()).total, 150, 'wallet-paid haircut earns 10% of ₹1,000');
  const c = bill('2026-10-07', [{ name: 'Spa', rate: 2000, sv: { staff_id: 's1' } }]);
  localDb.payments.record({ invoiceId: c.id, amount: 1180, date: '2026-10-07', method: 'Cash' });
  localDb.payments.record({ invoiceId: c.id, amount: 1180, date: '2026-10-08', method: 'Write-off', writeOff: true });
  assert.equal(commissionFor(priya, '2026-10', cdata()).total, 250, 'half paid: ₹100; the written-off half earns nothing');
});

/* ── S7: appointment → bill ── */

test('S7: a typed service with no rate and no class is billed at the default GST rate, not 0%', () => {
  const a = { id: 'a1', date: '2026-10-05', start: '10:00', client_name: 'Kavya', status: 'done', services: [{ name: 'Hair spa (typed)', price: 800 }, { name: 'Head massage', price: 300, sv_class: 'beauty_9997' as const }] };
  const lines = billLines(a as never, []);
  assert.equal(Number(lines[0].tax_rate), Number(localDb.settings.get().defaultTaxRate));
  assert.equal(Number(lines[1].tax_rate), 5, 'class rate');
  void saveAppointment;
});

/* ── S8: claims ── */

test('S8: a rejected claim is re-billed once', () => {
  const c = saveClaim({ date: '2026-10-01', kind: 'motor', payer_name: 'ABC General', beneficiary_name: 'Ravi', approved: 10000 } as never);
  const lines = [{ id: 'l1', name: 'Bumper', quantity: 1, rate: 10000, amount: 10000, tax_rate: 18, hsn: '8708', unit: 'NOS', discount_percent: 0 } as InvoiceItem];
  billClaim(c.id, lines, { approved: 11800, total: 11800 }, '2026-10-02');
  rejectAndRebill(c.id, 'policy lapsed', '2026-10-05');
  const n = localDb.invoices.getAll().length;
  assert.throws(() => rejectAndRebill(c.id, 'again', '2026-10-06'), /already rejected/);
  assert.equal(localDb.invoices.getAll().length, n, 'no second re-bill');
});
