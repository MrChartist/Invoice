/** SV-A3 commission: rules, nearest wins, slab, receipt basis, credit notes, redemption, assist split, payouts. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientRetail, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import type { InvoiceItem, InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { CommissionPlan, ServiceStaff, SvLine } from '../src/types/services-r10.ts';
import { commissionFor, ruleFor } from '../src/lib/services/sv-commission.ts';
import { defaultTdsSection, loadPayouts, payoutRoute, postPayout, undoPayout } from '../src/lib/services/sv-payouts.ts';
import { savePlan, saveStaff } from '../src/lib/services/sv-staff.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const plan: CommissionPlan = { id: 'p1', name: 'Std', basis: 'invoice', created_at: '', rules: [{ kind: 'service', pct: 10 }, { kind: 'product', pct: 5 }, { item_id: 'colour', pct: 15 }, { kind: 'package_redemption', per_unit: 50 }] };
const priya = { id: 's1', plan_id: 'p1' };
const items = [{ id: 'colour', name: 'Colour' }];

/** A saved bill with per-line `sv` and `type`. */
function bill(date: string, lines: { name: string; rate: number; sv: SvLine; type?: string; qty?: number }[], over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  const rec = createViaStore({ client: clientRetail, date, lines: lines.map((l) => ({ name: l.name, rate: l.rate, qty: l.qty ?? 1, tax: 18 })), ...(over.doc_type ? { docType: over.doc_type } : {}) });
  const its: InvoiceItem[] = rec.items.map((it, i) => ({ ...it, sv: lines[i].sv, ...(lines[i].type ? { type: lines[i].type! } : {}) }));
  return localDb.invoices.save({ ...rec, items: its, ...over });
}
const data = (plans = [plan]) => ({ invoices: getTable<InvoiceRecord>('invoices'), payments: getTable<Payment>('transactions'), plans, items });

test('% of taxable, nearest rule (item > kind), product rate, GST excluded', () => {
  bill('2026-10-05', [{ name: 'Haircut', rate: 1000, sv: { staff_id: 's1' } }, { name: 'Colour', rate: 2000, sv: { staff_id: 's1' } }, { name: 'Shampoo', rate: 400, type: 'Goods', sv: { staff_id: 's1' } }]);
  const st = commissionFor(priya, '2026-10', data());
  assert.deepEqual(st.lines.map((l) => [l.item, l.base, l.amount]), [['Haircut', 1000, 100], ['Colour', 2000, 300], ['Shampoo', 400, 20]]);
  assert.equal(st.total, 420);
  assert.equal(st.serviceBase, 3000);
  assert.equal(ruleFor(plan, { name: 'Colour' } as InvoiceItem, 'service', items)?.pct, 15);
  assert.equal(commissionFor(priya, '2026-11', data()).total, 0, 'other month');
});

test('assist split, credit note takes back, cancelled earns nothing, per-unit redemption', () => {
  bill('2026-10-05', [{ name: 'Haircut', rate: 1000, sv: { staff_id: 's1', assist_id: 's2', assist_pct: 40 } }]);
  bill('2026-10-06', [{ name: 'Haircut', rate: 1000, sv: { staff_id: 's1' } }], { status: 'Cancelled' });
  bill('2026-10-07', [{ name: 'Haircut', rate: 500, sv: { staff_id: 's1' } }], { doc_type: 'CREDIT_NOTE' });
  bill('2026-10-08', [{ name: 'Facial session 1 of 6', rate: 1, qty: 1, sv: { staff_id: 's1', redeem: { membership_id: 'm', session: 1, of: 6, value: 1500 } } }]);
  const st = commissionFor(priya, '2026-10', data());
  assert.deepEqual(st.lines.map((l) => [l.base, l.amount]), [[600, 60], [-500, -50], [1500, 50]]);
  assert.equal(commissionFor({ id: 's2', plan_id: 'p1' }, '2026-10', data()).total, 40);
});

test('slab: add % on the excess or replace the rate', () => {
  bill('2026-10-05', [{ name: 'Haircut', rate: 200000, sv: { staff_id: 's1' } }]);
  const add = commissionFor(priya, '2026-10', data([{ ...plan, slab: { target: 150000, base: 'service', pct: 2, mode: 'add' } }]));
  assert.deepEqual([add.commission, add.uplift, add.total], [20000, 1000, 21000]);
  const rep = commissionFor(priya, '2026-10', data([{ ...plan, slab: { target: 150000, base: 'service', pct: 15, mode: 'replace' } }]));
  assert.equal(rep.uplift, 2500, 'excess 50,000 at 15% instead of 10%');
});

test('receipt basis: pro rata on money received in the month; write-offs never count', () => {
  const inv = bill('2026-10-05', [{ name: 'Haircut', rate: 1000, sv: { staff_id: 's1' } }]);
  const total = Number(inv.total);
  const pay = (id: string, date: string, amount: number, extra = {}) => ({ id, invoice_id: inv.id, date, amount, method: 'Cash', ...extra }) as unknown as Payment;
  const d = { ...data([{ ...plan, basis: 'receipt' as const }]), payments: [pay('a', '2026-10-10', total / 2), pay('b', '2026-11-02', total / 2, { write_off: true })] };
  assert.equal(commissionFor(priya, '2026-10', d).total, 50);
  assert.equal(commissionFor(priya, '2026-11', d).total, 0);
});

test('payouts: payroll adjustment for an employee, journal with 194J for a freelance doctor, never twice, undo', () => {
  savePlan({ name: 'Std', basis: 'invoice', rules: [{ kind: 'service', pct: 10 }] });
  const emp = saveStaff({ name: 'Priya', role: 'stylist', employment: 'employee', employee_id: 'e1' }) as ServiceStaff;
  const doc = saveStaff({ name: 'Dr Rao', role: 'doctor', employment: 'freelance' }) as ServiceStaff;
  assert.equal(defaultTdsSection(doc), '194J');
  assert.equal(defaultTdsSection(emp), '194H');
  assert.equal(payoutRoute(emp, true), 'payroll');
  assert.equal(payoutRoute(emp, false), 'journal');
  const st = { total: 1200, lines: [] };
  const p1 = postPayout(emp, '2026-10', st, { date: '2026-10-31', payrollOn: true });
  const adj = getTable<{ id: string; amount: number; name: string; reference: string }>('payroll_adjustments');
  assert.deepEqual([adj.length, adj[0].amount, adj[0].name, adj[0].reference], [1, 1200, 'Commission 2026-10', p1.id]);
  assert.throws(() => postPayout(emp, '2026-10', st, { date: '2026-10-31', payrollOn: true }), /already paid out/);
  const p2 = postPayout(doc, '2026-10', st, { date: '2026-10-31', payrollOn: true });
  assert.equal(p2.route, 'journal');
  assert.ok(p2.voucher_id);
  undoPayout(p1.id);
  undoPayout(p2.id);
  assert.equal(loadPayouts().length, 0);
  assert.equal(getTable('payroll_adjustments').length, 0);
});
