/** SV-B4 referral report, consultant fee-share and payout (194J), referral payments only when switched on, 194R. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import { doctorsDb } from '../src/lib/retail/rt-pharmacy-rx.ts';
import { saveStaff } from '../src/lib/services/sv-staff.ts';
import { loadPayouts } from '../src/lib/services/sv-payouts.ts';
import { savePatient } from '../src/lib/services/sv-patients.ts';
import { billVisit, loadVisits, saveVisit } from '../src/lib/services/sv-opd.ts';
import { loadOrders } from '../src/lib/services/sv-lab.ts';
import { loadAdmissions } from '../src/lib/services/sv-ipd.ts';
import { bookReferral, feeShare, needs194R, payFeeShare, referralBooked, referralReport, referralRule } from '../src/lib/services/sv-referrals.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const issued = (inv: InvoiceRecord) => localDb.invoices.save({ ...inv, status: 'Sent' });

test('referral totals by doctor (patients, documents, bill value)', () => {
  const kul = doctorsDb.save({ name: 'Dr Kulkarni', active: true });
  const shah = doctorsDb.save({ name: 'Dr Shah', consult_fee: 600, active: true });
  const p = savePatient({ name: 'Mrs Rao', patient: {} }, '2026-10-05');
  const ref = { doctor_id: kul.id, name: kul.name };
  issued(billVisit(saveVisit({ date: '2026-10-05', patient_id: p.id, patient_name: p.name, doctor_id: shah.id, referrer: ref }).id));
  issued(billVisit(saveVisit({ date: '2026-10-08', patient_id: p.id, patient_name: p.name, doctor_id: shah.id, referrer: ref }).id));
  saveVisit({ date: '2026-11-02', patient_name: 'Later', doctor_id: shah.id, referrer: ref });
  const rows = referralReport({ invoices: getTable<InvoiceRecord>('invoices'), visits: loadVisits(), orders: loadOrders(), admissions: loadAdmissions() }, '2026-10-01', '2026-10-31');
  assert.deepEqual(rows.map((r) => [r.name, r.patients, r.documents, r.value]), [['Dr Kulkarni', 1, 2, 1200]]);
});

test('fee-share statement (% and per visit); payout through staff_payouts with 194J below / above ₹50,000', () => {
  const vendor = { id: 'v-mehta', name: 'Dr Mehta', pan: 'ABCPM1234D' };
  // A freelance consultant: staff row + vendor (PAN) for TDS.
  setTable('vendors', [vendor]);
  const staff = saveStaff({ name: 'Dr Mehta', role: 'doctor', employment: 'freelance', vendor_id: vendor.id });
  const mehta = doctorsDb.save({ name: 'Dr Mehta', consult_fee: 40000, staff_id: staff.id, share: { pct: 60 }, active: true });
  const v1 = saveVisit({ date: '2026-10-05', patient_name: 'A', doctor_id: mehta.id });
  issued(billVisit(v1.id));
  const st = feeShare(mehta, '2026-10', getTable<InvoiceRecord>('invoices'));
  assert.equal(st.total, 24000, '60% of the consultation');
  const pay = payFeeShare(staff, '2026-10', st, '2026-10-31', true);
  assert.equal(pay.amount, 24000);
  assert.equal(pay.tds ?? 0, 0, 'below the ₹50,000 194J threshold');
  assert.throws(() => payFeeShare(staff, '2026-10', st, '2026-10-31', true), /already paid out/);
  issued(billVisit(saveVisit({ date: '2026-11-05', patient_name: 'B', doctor_id: mehta.id }).id));
  issued(billVisit(saveVisit({ date: '2026-11-06', patient_name: 'C', doctor_id: mehta.id }).id));
  const nov = payFeeShare(staff, '2026-11', feeShare(mehta, '2026-11', getTable<InvoiceRecord>('invoices')), '2026-11-30', true);
  assert.ok((nov.tds ?? 0) > 0, 'above ₹50,000 in the FY: 194J deducted');
  assert.equal(loadPayouts().length, 2);
  const per = feeShare({ staff_id: staff.id, share: { per_visit: 500 } }, '2026-10', getTable<InvoiceRecord>('invoices'));
  assert.equal(per.total, 500);
});

test('referral payments only when switched on, to the disallowable ledger with the caution; 194R reminder above ₹20,000', () => {
  const kul = doctorsDb.save({ name: 'Dr Kulkarni', active: true });
  const rule = referralRule('2026-10-05');
  assert.equal(rule.ledger, 'Referral fees — disallowable (Sec 37)');
  assert.match(rule.caution, /Apex Laboratories/);
  assert.throws(() => bookReferral(kul, 1000, '2026-10-05', 'cash', false), /not recorded/);
  const r = bookReferral(kul, 1000, '2026-10-05', 'cash', true);
  const v = loadVouchers().find((x) => x.number === r.voucher)!;
  assert.match(v.narration ?? '', /Verify with your CA/);
  assert.equal(r.remind194R, false);
  assert.equal(bookReferral(kul, 15000, '2026-10-06', 'benefit', true).remind194R, false);
  assert.equal(needs194R(kul.name, '2026-10-07', 6000), true);
  assert.equal(bookReferral(kul, 6000, '2026-10-07', 'benefit', true).remind194R, true);
  assert.equal(referralBooked(kul.name, '2026-10-07'), 22000);
});
