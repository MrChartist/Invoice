/** R11 CN-B2: mobilisation advance (schedule 10%→80%, simple interest), secured advance (75%, liability), journals. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupWorks, DEPT } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { saveRaBill } from '../src/lib/works/measurements.ts';
import { recoverAdvance } from '../src/lib/works/ra-receivable.ts';
import { saveAdvance } from '../src/lib/advances.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { saveContract } from '../src/lib/construction/cn-contracts.ts';
import { advanceStatus, recoveryThisBill, scheduleTarget, simpleInterest } from '../src/lib/construction/cn-advances.ts';
import { recordSecured, securedAmount, securedRecovered, securedRecovery } from '../src/lib/construction/cn-secured.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

let boq: InvoiceRecord;
beforeEach(() => { boq = setupWorks(); });

const r2 = (n: number) => Math.round(n * 100) / 100;

test('pure: simple interest by days, schedule target, catch-up by 80%, never past the balance', () => {
  assert.equal(simpleInterest(115000, 10, '2026-05-05', '2026-06-30'), r2((115000 * 10 * 56) / 36500));
  assert.equal(simpleInterest(0, 10, '2026-05-05', '2026-06-30'), 0);
  assert.equal(scheduleTarget(100000, 10), 0);
  assert.equal(scheduleTarget(100000, 45), 50000);
  assert.equal(scheduleTarget(100000, 95), 100000);
  const term = { recover_from_pct: 10, recover_by_pct: 80 };
  assert.equal(recoveryThisBill({ amount: 100000, recovered: 0, contractValue: 1000000, cumBefore: 0, thisWork: 80000, term }), 0, 'below the 10% start');
  assert.equal(recoveryThisBill({ amount: 100000, recovered: 0, contractValue: 1000000, cumBefore: 0, thisWork: 450000, term }), 50000);
  // The BOQ rule (x% of the bill beyond the start) wins when it is higher.
  assert.equal(recoveryThisBill({ amount: 100000, recovered: 0, contractValue: 1000000, cumBefore: 100000, thisWork: 100000, term, rulePct: 20 }), 20000);
  assert.equal(recoveryThisBill({ amount: 100000, recovered: 90000, contractValue: 1000000, cumBefore: 500000, thisWork: 400000, term }), 10000, 'stops at the balance');
});

test('RA bills recover the contract advance on schedule with interest rows (no GST); per-advance receipts', () => {
  const adv = saveAdvance({ client: { id: DEPT.id, name: DEPT.name }, date: '2026-05-05', amount: 115000, method: 'Bank transfer', place_of_supply: '27', supply: 'services', tax_rate: 18 } as never, { today: '2026-05-05' });
  const c = saveContract({ boq_id: boq.id, client_id: DEPT.id, client_name: DEPT.name, name_of_work: 'Road', contract_value: 1150000, advance_terms: [{ advance_id: adv.id, kind: 'mobilisation' }] });
  assert.deepEqual([c.advance_terms?.[0].interest_pct, c.advance_terms?.[0].recover_from_pct, c.advance_terms?.[0].recover_by_pct], [10, 10, 80], 'defaults (contract terms)');
  const ra1 = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] }).invoice;
  assert.ok(!ra1.ra_deductions?.some((d) => d.kind === 'advance_recovery'), '8.7% of work: nothing yet');
  const i1 = ra1.ra_deductions?.find((d) => d.kind === 'advance_interest');
  assert.equal(i1?.amount, simpleInterest(115000, 10, '2026-05-05', '2026-06-30'));
  assert.equal(i1?.ref_id, adv.id);
  assert.equal(ra1.total, 118000, 'GST untouched');
  const ra2 = saveRaBill(boq.id, { date: '2026-09-30', lines: [{ line_id: 'l2', cumulative_qty: 100 }] }).invoice;
  const rec = ra2.ra_deductions?.find((d) => d.kind === 'advance_recovery');
  assert.equal(rec?.amount, r2(115000 * ((550000 / 1150000) * 100 - 10) / 70));
  assert.equal(ra2.ra_deductions?.find((d) => d.kind === 'advance_interest')?.amount, simpleInterest(115000, 10, '2026-06-30', '2026-09-30'));
  assert.equal(ra2.ra_net_payable, r2(ra2.total - ra2.ra_deductions!.reduce((s, d) => s + d.amount, 0)));
  const p = recoverAdvance(ra2.id, { date: '2026-10-05' });
  assert.equal(p.advance_id, adv.id);
  assert.equal(p.amount, rec?.amount);
  const st = advanceStatus(c, [ra1, ra2], [adv], '2026-10-30')[0];
  assert.equal(st.recovered, rec?.amount);
  assert.equal(st.balance, r2(115000 - rec!.amount));
  assert.equal(st.behind, false);
  assert.ok(st.interest > 0);
  assert.equal(getTable<Payment>('transactions').find((x) => x.id === p.id)?.ra_kind, 'advance_recovery');
});

test('secured advance: 75% of materials at site, liability journal (balanced, no GST), recovered by use, never past the balance', () => {
  const c = saveContract({ boq_id: boq.id, client_id: DEPT.id, client_name: DEPT.name, name_of_work: 'Road', contract_value: 1150000 });
  assert.deepEqual(securedAmount([{ qty: 500, rate: 400 }], 75), { value: 200000, amount: 150000 });
  const sa = recordSecured({ contract_id: c.id, party: DEPT.name, date: '2026-06-01', materials: [{ description: 'Cement', qty: 500, unit: 'bag', rate: 400 }] });
  assert.equal(sa.amount, 150000);
  assert.equal(sa.pct, 75, 'default');
  const v = loadVouchers().find((x) => x.id === sa.voucher_id)!;
  assert.equal(v.voucher_class, 'Secured advance');
  assert.equal(v.lines.reduce((s, l) => s + l.dr, 0), v.lines.reduce((s, l) => s + l.cr, 0));
  assert.equal(v.lines.reduce((s, l) => s + l.dr, 0), 15000000, 'paise');
  assert.equal(securedRecovery(sa, 0, { qty: 250 }), 75000);
  assert.equal(securedRecovery(sa, 100000, { qty: 250 }), 50000, 'capped at the balance');
  const inv = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }], recoveries: [{ kind: 'secured_advance', ref_id: sa.id, qty: 250 }] }).invoice;
  assert.equal(inv.ra_deductions?.find((d) => d.kind === 'secured_advance')?.amount, 75000);
  assert.equal(inv.total, 118000);
  assert.equal(securedRecovered(sa.id, localDb.invoices.getAll()), 75000);
  const inv2 = saveRaBill(boq.id, { date: '2026-07-31', lines: [{ line_id: 'l1', cumulative_qty: 800 }], recoveries: [{ kind: 'secured_advance', ref_id: sa.id, qty: 400 }] }).invoice;
  assert.equal(inv2.ra_deductions?.find((d) => d.kind === 'secured_advance')?.amount, 75000, 'only the balance');
  assert.equal(securedRecovered(sa.id, localDb.invoices.getAll()), 150000);
});
