/** R11 CN-B4: recoveries, withheld, LD — computation, buckets, receipts through the RA clearing account, no-cash rule. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupWorks, DEPT } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { saveRaBill } from '../src/lib/works/measurements.ts';
import { raDueSplit } from '../src/lib/works/ra-due.ts';
import { ensureDeductionClearing, receiptPlan, recordDeductionRow, releaseHeld, removeDeductionRow } from '../src/lib/works/ra-receivable.ts';
import { amountDue } from '../src/lib/amount-due.ts';
import { loadLedger } from '../src/lib/ledger/index.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { bankLedgerId } from '../src/lib/bank-ledgers.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import { deductionNotes } from '../src/lib/construction/cn-print.ts';
import { saveContract } from '../src/lib/construction/cn-contracts.ts';
import { recoveryRow, wastageRecovery } from '../src/lib/construction/cn-recoveries.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

let boq: InvoiceRecord;
beforeEach(() => {
  boq = setupWorks();
  saveContract({ boq_id: boq.id, client_id: DEPT.id, client_name: DEPT.name, name_of_work: 'Road', contract_value: 1150000, stipulated_completion: '2026-06-15', retention_pct: 5, water_pct: 1, power_pct: 1 });
});

const bill = () => saveRaBill(boq.id, {
  date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }],
  recoveries: [
    { kind: 'material_recovery', qty: 20, rate: 450 }, { kind: 'hire_charges', amount: 4000 }, { kind: 'withheld', amount: 5000, reason: 'Drainage outfall', release_on: '2026-12-31' }, { kind: 'ld', amount: 3000 },
  ],
}).invoice;

test('pure: wastage band ±3% (excess at 2× issue rate, shortfall at the issue rate); typed rows', () => {
  assert.deepEqual(wastageRecovery(110, 100, 400), { min: 97, max: 103, excess: 7, shortfall: 0, amount: 5600 });
  assert.equal(wastageRecovery(95, 100, 400).amount, 800);
  assert.equal(wastageRecovery(101, 100, 400).amount, 0);
  assert.equal(recoveryRow({ kind: 'material_recovery', qty: 10, rate: 450 }, 100000)?.amount, 4500);
  assert.equal(recoveryRow({ kind: 'withheld', amount: 0 }, 100000), null);
});

test('each kind on the bill and its bucket; GST and the total unchanged; LD note printed', () => {
  const inv = bill();
  const by = (k: string) => inv.ra_deductions?.find((d) => d.kind === k);
  assert.equal(by('water_power')?.amount, 2000);
  assert.equal(by('material_recovery')?.amount, 9000);
  assert.equal(by('hire_charges')?.amount, 4000);
  assert.equal(by('withheld')?.reason, 'Drainage outfall');
  assert.match(by('ld')?.label ?? '', /delay 15 days beyond 2026-06-15/);
  assert.equal(inv.total, 118000);
  assert.equal(inv.taxable_value, 100000);
  const split = raDueSplit(inv, [], amountDue(inv, 0));
  const held = Object.fromEntries(split.held.map((h) => [h.kind, h]));
  assert.equal(held.withheld.release_on, '2026-12-31');
  assert.equal(split.dueNow, inv.ra_net_payable);
  const plan = receiptPlan(inv, [], amountDue(inv, 0));
  assert.deepEqual(plan.rows.map((r) => r.kind).sort(), ['hire_charges', 'ld', 'material_recovery', 'water_power']);
  assert.deepEqual(plan.held.map((h) => h.kind).sort(), ['retention', 'withheld']);
  assert.ok(deductionNotes(inv.ra_deductions, String).some((n) => n.includes('Circular 178/10/2022')));
});

test('recovery receipts: no-cash rows into the clearing account + balanced journals to the cost accounts; clearing nets to zero; withheld release is cash', () => {
  const inv = bill();
  const rows = (['material_recovery', 'water_power', 'hire_charges', 'ld'] as const).map((k) => recordDeductionRow(inv.id, k, { date: '2026-07-10' }));
  for (const p of rows) {
    assert.ok(p.ra_journal_id && movedNoCash(p), `${p.ra_kind} moves no cash`);
    const v = loadVouchers().find((x) => x.id === p.ra_journal_id)!;
    assert.equal(v.voucher_class, 'RA deduction');
    assert.equal(v.lines.reduce((s, l) => s + l.dr - l.cr, 0), 0);
  }
  const clearing = bankLedgerId(ensureDeductionClearing());
  const net = loadLedger().vouchers.flatMap((v) => v.lines).filter((l) => l.account === clearing).reduce((s, l) => s + l.dr - l.cr, 0);
  assert.equal(net, 0, 'clearing account nets to zero');
  const names = loadLedger().accounts.map((a) => a.name);
  for (const n of ['Material issued by client', 'Water & electricity — site', 'Plant hire charges', 'Liquidated damages']) assert.ok(names.includes(n), n);
  const cash = releaseHeld(inv.id, 'withheld', { date: '2026-12-31', amount: 5000, method: 'Bank transfer' });
  assert.equal(cash.ra_kind, 'withheld');
  assert.equal(movedNoCash(cash), false);
  const live = localDb.invoices.getById(inv.id)!;
  assert.ok(!raDueSplit(live, getTable<Payment>('transactions'), amountDue(live, 0)).held.some((h) => h.kind === 'withheld'));
  removeDeductionRow(rows[0].id);
  assert.ok(!loadVouchers().some((v) => v.id === rows[0].ra_journal_id), 'removed together');
});
