/**
 * Round 10 deferred items (QA13 follow-up): SV-A staff on POS lines, staff name on paper, tips, appointment deposit;
 * SV-B UHID / phone search in the client picker (clinic pack); SV-C fee increase warning in the fee plan form.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { clientRetail, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import type { InvoiceItem, InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { CommissionPlan, ServiceStaff } from '../src/types/services-r10.ts';
import { commissionFor, statementRows } from '../src/lib/services/sv-commission.ts';
import { postPayout } from '../src/lib/services/sv-payouts.ts';
import { saveStaff } from '../src/lib/services/sv-staff.ts';
import { saveServiceSettings } from '../src/lib/services/sv-settings.ts';
import { billLines, loadAppointments, saveAppointment } from '../src/lib/services/sv-appointments.ts';
import { isTipLine, setTip, tipLine, withStaff } from '../src/lib/services/sv-pos.ts';
import { patientMatch } from '../src/lib/services/sv-find.ts';
import { findPatients } from '../src/lib/services/sv-patients.ts';
import { staffText, trackingText } from '../src/components/templates/paper-helpers.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const asha = { id: 's1', name: 'Asha' };

test('SV-A: staff on a line; the printed name is a snapshot only while "staff names on the bill" is on', () => {
  const line = { id: 'l1', name: 'Haircut', sv: { cls: 'beauty_9997' as const } };
  assert.deepEqual(withStaff(line, asha, false).sv, { cls: 'beauty_9997', staff_id: 's1', staff_name: 'Asha' });
  assert.deepEqual(withStaff(line, asha, true).sv, { cls: 'beauty_9997', staff_id: 's1', staff_name: 'Asha', staff_print: 'Asha' });
  assert.deepEqual(withStaff(withStaff(line, asha, true), undefined, true).sv, { cls: 'beauty_9997' }, 'staff removed, other keys kept');
  assert.equal('sv' in withStaff({ id: 'x', sv: { staff_id: 's1' } }, undefined, false), false, 'an empty sv goes');
  // Paper: printed only with the snapshot; a plain line prints exactly as before.
  assert.equal(staffText(withStaff(line, asha, true)), 'Staff: Asha');
  assert.equal(staffText(withStaff(line, asha, false)), '');
  assert.equal(trackingText({ batch_no: 'B1' } as never), 'Batch B1');
  assert.equal(trackingText({ batch_no: 'B1', sv: { staff_print: 'Asha' } } as never), 'Batch B1 · Staff: Asha');
  assert.match(src('components/templates/parts/ReceiptBody.tsx'), /staffText\(src\)/, 'the 80 mm receipt prints it too');
});

test('SV-A: appointment bill lines snapshot the printed name only when the setting is on', () => {
  const a = saveAppointment({ date: '2026-10-27', start: '11:00', client_name: 'Ravi', services: [{ name: 'Haircut', minutes: 30, price: 500 }], staff_id: 's1' });
  assert.equal(billLines(a, [asha])[0].sv?.staff_print, undefined);
  saveServiceSettings({ print_staff: true });
  assert.equal(billLines(a, [asha])[0].sv?.staff_print, 'Asha');
});

test('SV-A: the POS strip is lazy and mounted only for service packs', () => {
  const pos = src('pages/Pos.tsx');
  assert.match(pos, /const PosStaff = lazy\(\(\) => import\('\.\.\/components\/services-r10\/PosStaff'\)\)/);
  assert.match(pos, /\['salon', 'fitness', 'clinic', 'workshop'\] as const\)\.some\(\(k\) => isPackOn\(settings, k\)\) && <Suspense fallback=\{null\}><PosStaff/);
});

test('SV-A tips: one 0% non-GST tip line; paid to the staff member in full, outside commission, slab and TDS base', () => {
  const t = tipLine(asha, 150);
  assert.deepEqual([t.name, t.rate, t.tax_rate, t.sv], ['Tip: Asha', 150, 0, { tip: true, staff_id: 's1', staff_name: 'Asha', exempt: 'NON_GST' }]);
  const base = [{ id: 'a', name: 'Haircut' } as InvoiceItem];
  const one = setTip(base, asha, 100);
  assert.equal(one.filter(isTipLine).length, 1);
  assert.equal(setTip(one, asha, 200).filter(isTipLine)[0].rate, 200, 'replaced, never two');
  assert.deepEqual(setTip(one, asha, 0), base, '0 removes it');

  const s = saveStaff({ name: 'Asha', role: 'stylist', employment: 'freelance' }) as ServiceStaff;
  const plan: CommissionPlan = { id: 'p1', name: 'Std', basis: 'invoice', created_at: '', rules: [{ kind: 'service', pct: 10 }], slab: { target: 500, pct: 20, mode: 'add', base: 'all' } };
  localDb.settings.get(); // settings installed
  const rec = createViaStore({ client: clientRetail, date: '2026-10-05', lines: [{ name: 'Haircut', rate: 1000, qty: 1, tax: 18 }] });
  const items: InvoiceItem[] = setTip(rec.items.map((it) => ({ ...it, sv: { staff_id: s.id, staff_name: s.name } })), s, 250);
  localDb.invoices.save({ ...rec, items });
  const st = commissionFor({ id: s.id, plan_id: 'p1' }, '2026-10', { invoices: getTable<InvoiceRecord>('invoices'), payments: getTable<Payment>('transactions'), plans: [plan] });
  // Commission 10% of 1,000 = 100; slab add 20% of (1,000 − 500) = 100; the tip 250 is added in full.
  assert.deepEqual([st.base, st.commission, st.uplift, st.tips, st.total], [1000, 100, 100, 250, 450]);
  assert.ok(statementRows(st).some((r) => r[3] === 'tip' && r[7] === 250));
  assert.ok(statementRows(st).some((r) => r[6] === 'Tips passed through' && r[7] === 250));
  // Receipt basis: the tip counts on the bill date even before the bill is paid.
  const rb = commissionFor({ id: s.id, plan_id: 'p1' }, '2026-10', { invoices: getTable<InvoiceRecord>('invoices'), payments: [], plans: [{ ...plan, basis: 'receipt', slab: undefined }] });
  assert.deepEqual([rb.commission, rb.tips], [0, 250]);
  // Payout: the journal pays commission + tips; the row keeps the tips; TDS is suggested on the commission only.
  const p = postPayout(s, '2026-10', st, { date: '2026-10-31', payrollOn: false, tds: true });
  assert.deepEqual([p.amount, p.tips], [450, 250]);
  const v = loadVouchers().find((x) => x.id === p.voucher_id)!;
  assert.match(v.narration ?? '', /incl\. tips ₹250 passed through/);
});

test('SV-A: the appointment keeps the chosen deposit (an open advance of the client)', () => {
  const a = saveAppointment({ date: '2026-10-27', start: '11:00', client_name: 'Ravi', client_id: 'c1', services: [], advance_id: 'adv1' });
  assert.equal(loadAppointments().find((x) => x.id === a.id)?.advance_id, 'adv1');
  const dlg = src('components/services-r10/AppointmentDialog.tsx');
  assert.match(dlg, /openAdvancesFor\(client, loadAdvances\(\)/);
  assert.match(dlg, /data-appt-deposit/);
});

test('SV-B: UHID / phone search in the general client picker, only with the clinic pack', () => {
  const p = { name: 'Meena Rao', phone: '+91 98450 12345', patient: { uhid: 'CL-26-0007' } } as never;
  assert.equal(patientMatch(p, 'cl-26-0007'), true);
  assert.equal(patientMatch(p, '9845012'), true);
  assert.equal(patientMatch(p, '123'), false, 'fewer than 4 digits never match a phone');
  assert.equal(patientMatch(p, 'meena'), true);
  assert.deepEqual(findPatients([p, { name: 'Other' } as never], '0007').length, 1, 'the clinic desk uses the same match');
  const modal = src('components/modals/ClientSearchModal.tsx');
  assert.match(modal, /isOpen && isPackOn\(localDb\.settings\.get\(\), 'clinic'\)/);
  assert.match(modal, /\|\| \(clinic && patientMatch\(c, q\)\)/);
});

test('SV-C: the fee plan form warns when an edit raises the fee during the course (lazy import)', () => {
  const form = src('components/institutions/FeePlanForm.tsx');
  assert.match(form, /if \(plan\) void import\('\.\.\/\.\.\/lib\/services\/sv-classes'\)\.then\(\(\{ feeIncreaseWarning \}\)/);
  assert.match(form, /feeIncreaseWarning\(plan, saved, localDb\.clients\.getAll\(\)\)/);
  assert.match(form, /iT\('feeIncrease', \{ n \}\)/);
});
