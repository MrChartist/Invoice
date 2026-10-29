/** SV-B2 in-patient running bill: room-days, the room-rent test, composite medicines, deposits, payer split, numbering. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { BUYER_MH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { senderStateCode } from '../src/store/invoice-defaults.ts';
import { saveAdvance } from '../src/lib/advances.ts';
import { savePatient } from '../src/lib/services/sv-patients.ts';
import { IPD, addCharge, admissionLines, applyDeposits, attachDeposit, deleteAdmission, depositsOpen, discharge, finalBill, interimHtml, ipdNotices, linesGross, loadAdmissions, roomClass, roomDays, saveAdmission } from '../src/lib/services/sv-ipd.ts';
import { saveClaim } from '../src/lib/services/sv-claims.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const room = (kind: 'general' | 'private' | 'icu', rate: number) => ({ id: 'r1', name: `${kind} room`, kind, rate });

test('room-days by midnight census and per 24 h; a same-day stay is one day', () => {
  assert.equal(roomDays('2026-10-05', '10:00', '2026-10-07', '09:00', 'midnight'), 2);
  assert.equal(roomDays('2026-10-05', '10:00', '2026-10-07', '11:00', '24h'), 3);
  assert.equal(roomDays('2026-10-05', '10:00', '2026-10-07', '10:00', '24h'), 2);
  assert.equal(roomDays('2026-10-05', '08:00', '2026-10-05', '18:00'), 1);
});

test('room-rent test: ₹5,000 exempt, ₹5,001 5%, ICU ₹9,000 exempt, before 18 Jul 2022 exempt', () => {
  assert.deepEqual(roomClass({ kind: 'private' }, 5000, '2026-10-05'), { cls: 'hospital_room_low', rate: 0, sac: '9993' });
  assert.deepEqual(roomClass({ kind: 'private' }, 5001, '2026-10-05'), { cls: 'hospital_room_high', rate: 5, sac: '9993' });
  assert.equal(roomClass({ kind: 'icu' }, 9000, '2026-10-05').rate, 0);
  assert.equal(roomClass({ kind: 'private' }, 9000, '2022-07-17').rate, 0);
});

test('running charges, composite medicines exempt (stock line kept), interim print, final bill with deposits and refund', () => {
  const p = savePatient({ name: 'Mr Iyer', patient: {} }, '2026-10-05');
  const a = saveAdmission({ admit_date: '2026-10-05', admit_time: '10:00', patient_id: p.id, patient_name: p.name, room: room('private', 6000) });
  assert.match(a.number, new RegExp(`^${IPD}/FY26-27/0001$`));
  addCharge(a.id, { date: '2026-10-05', name: 'Procedure', qty: 1, rate: 3000 });
  addCharge(a.id, { date: '2026-10-06', name: 'Paracetamol 500', qty: 10, rate: 2, item_id: 'stk1', hsn: '3004' });
  const adv = saveAdvance({ date: '2026-10-05', client: { id: p.id, name: p.name }, place_of_supply: senderStateCode(localDb.settings.activeProfile()), supply: 'services', tax_rate: 0, amount: 20000, method: 'Cash' });
  attachDeposit(a.id, adv.id);
  assert.equal(depositsOpen(loadAdmissions()[0]), 20000);
  const lines = admissionLines(loadAdmissions()[0], '2026-10-06');
  assert.deepEqual(lines.map((l) => [l.name.split(' (')[0], l.quantity, l.tax_rate, l.sv?.exempt ?? '']), [['Room: private room', 1, 5, ''], ['Procedure', 1, 0, 'EXEMPT'], ['Paracetamol 500', 10, 0, 'EXEMPT']]);
  assert.equal(lines[2].hsn, '3004');
  assert.equal(lines[2].type, 'Goods', 'the stock reader moves the medicine out with the bill line');
  assert.equal(linesGross(lines), 6300 + 3000 + 20);
  assert.match(interimHtml(loadAdmissions()[0], { asOn: '2026-10-06', business: 'Clinic', deposits: 20000, money: (n) => String(n) }), /Interim bill: not a tax invoice/);
  assert.throws(() => finalBill(a.id, '2026-10-07'), /Discharge the patient first/);
  discharge(a.id, '2026-10-07', '11:00');
  const { bill } = finalBill(a.id, '2026-10-07');
  assert.equal(bill.items[0].quantity, 2, 'two midnights');
  assert.equal(bill.items[0].tax_rate, 5);
  assert.equal(bill.sv?.admission?.number, a.number);
  assert.equal(loadAdmissions()[0].status, 'billed');
  assert.throws(() => addCharge(a.id, { date: '2026-10-07', name: 'X', qty: 1, rate: 1 }), /is billed/);
  assert.throws(() => deleteAdmission(a.id), /has a bill/);
  // Issue, then apply deposits through the advance adjustment.
  localDb.invoices.save({ ...bill, status: 'Sent' });
  const applied = applyDeposits(a.id, '2026-10-07');
  assert.equal(applied, Number(bill.total));
  assert.equal(depositsOpen(loadAdmissions()[0]), Math.round((20000 - applied) * 100) / 100, 'excess deposit left to refund');
});

test('payer claim: the two bills total the charges; numbering; bell rows', () => {
  const insurer = localDb.clients.upsert({ name: 'Star TPA', gstin: BUYER_MH, state_code: '27' });
  const p = savePatient({ name: 'Mrs Das', patient: {} }, '2026-10-05');
  const c = saveClaim({ date: '2026-10-05', kind: 'health_tpa', payer_id: insurer, payer_name: 'Star TPA', beneficiary_id: p.id, beneficiary_name: p.name, estimate: 20000, approved: 8000 });
  const a = saveAdmission({ admit_date: '2026-10-05', patient_id: p.id, patient_name: p.name, room: room('general', 2000), claim_id: c.id });
  addCharge(a.id, { date: '2026-10-05', name: 'Surgery', qty: 1, rate: 8000 });
  discharge(a.id, '2026-10-06');
  const total = linesGross(admissionLines(loadAdmissions()[0], '2026-10-06'));
  const r = finalBill(a.id, '2026-10-06');
  assert.ok(r.payer, 'payer bill made');
  assert.equal(Math.round(Number(r.payer!.total) + Number(r.bill.total)), Math.round(total));
  assert.equal(r.payer!.sv?.claim?.role, 'payer');
  const b = saveAdmission({ admit_date: '2026-09-20', patient_name: 'Long stay' });
  assert.equal(b.number, 'IPD/FY26-27/0002');
  const rows = ipdNotices(loadAdmissions(), '2026-10-06', 100, () => 0);
  assert.deepEqual(rows.map((x) => x.kind), ['long']);
});
