/**
 * R2-A3 bad-debt write-off on top of the 8G `write_off` flag: single write-off, owner guard, period lock,
 * register totals, recovery in the same FY vs an earlier FY, exclusions (reminders, khata queue, forecast).
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, createViaStore, reload } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { setActorProvider } from '../src/lib/access.ts';
import {
  bulkWriteOff, loadRecoveries, recordRecovery, recoverable, registerTotals, reverseWriteOff, writeOffBill, writeOffRegister, writeOffRegisterCsv,
} from '../src/lib/write-off.ts';
import { pendingReminders } from '../src/lib/reminders.ts';
import { buildReceivables, computeDso } from '../src/lib/receivables.ts';
import { partyReminderQueue } from '../src/lib/khata.ts';
import { buildForecast } from '../src/lib/cash-forecast.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { buildLedger } from '../src/lib/ledger/postings.ts';
import { loadLedgerInput } from '../src/lib/ledger/index.ts';

beforeEach(() => { resetStorage(); installSettings(); });
afterEach(() => setActorProvider(null));

const overdue = (date = '2026-06-01', rate = 10000) => createViaStore({ date, due: date, lines: [{ qty: 1, rate, tax: 0 }], gstMode: 'NONE', status: 'Sent' });

test('single write-off: reason required, owner only, posts Dr Bad debts written off, period lock respected', () => {
  const inv = overdue();
  assert.throws(() => writeOffBill(inv.id, { date: '2026-10-01', reason: '' }), /reason/);
  setActorProvider(() => ({ id: 'c', name: 'Clerk', role: 'clerk' }));
  assert.throws(() => writeOffBill(inv.id, { date: '2026-10-01', reason: 'Closed' }), /cannot/);
  assert.throws(() => bulkWriteOff([inv.id], { date: '2026-10-01', reason: 'Closed' }), /cannot/, 'bulk is owner-only too');
  setActorProvider(null);
  const r = writeOffBill(inv.id, { date: '2026-10-01', reason: 'Closed' });
  assert.equal(r.total, 10000);
  assert.equal(reload(inv.id).status, 'Paid');
  const led = buildLedger(loadLedgerInput(undefined, '2026-10-31'));
  const v = led.vouchers.find((x) => x.lines.some((l) => l.account === 'bad_debts'))!;
  assert.equal(v.lines.find((l) => l.account === 'bad_debts')!.dr, 1000000);
  // Locked period: refused.
  const b = overdue('2026-06-02', 500);
  const s = localDb.settings.get();
  localDb.settings.save({ ...s, lock_until: '2026-09-30' });
  assert.throws(() => writeOffBill(b.id, { date: '2026-09-15', reason: 'x' }), /lock/i);
});

test('written-off bills leave reminders, the khata queue and the cash forecast; DSO no longer counts them', () => {
  const inv = overdue();
  const today = new Date(2026, 9, 25);
  const input = () => ({ invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll(), clients: localDb.clients.getAll() });
  assert.equal(pendingReminders(localDb.invoices.getAll(), today).length, 1);
  const before = computeDso(buildReceivables(input(), { now: today }), 365, today);
  writeOffBill(inv.id, { date: '2026-10-01', reason: 'Closed' });
  assert.equal(pendingReminders(localDb.invoices.getAll(), today).length, 0);
  const report = buildReceivables(input(), { now: today });
  assert.equal(partyReminderQueue(report, localDb.clients.getAll(), [], { today }).items.length, 0);
  assert.equal(report.totals.net, 0);
  assert.ok(report.parties[0].entries.some((e) => e.writeOff), 'the ledger shows the write-off row');
  const after = computeDso(report, 365, today);
  assert.ok(before !== null && before > 0 && after === 0, `DSO ${before} → ${after}`);
  const f = buildForecast({ today: '2026-10-25', horizon: 90, opening: 0, invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll(), purchases: [] });
  assert.equal(f.items.filter((i) => i.kind === 'receivable').length, 0);
});

test('recovery in the same FY reduces the write-off and records a receipt; register shows it', () => {
  const inv = overdue('2026-05-01');
  writeOffBill(inv.id, { date: '2026-08-01', reason: 'Disputed' });
  const rec = recordRecovery({ invoiceId: inv.id, amount: 4000, date: '2026-10-10', method: 'UPI' });
  assert.equal(rec.mode, 'same_fy');
  const rows = localDb.payments.getAll().filter((p) => p.invoice_id === inv.id);
  assert.equal(rows.filter((p) => p.write_off).reduce((s, p) => s + p.amount, 0), 6000);
  assert.equal(rows.filter((p) => !p.write_off).reduce((s, p) => s + p.amount, 0), 4000);
  assert.equal(reload(inv.id).status, 'Paid', 'still settled');
  const reg = writeOffRegister(localDb.invoices.getAll(), localDb.payments.getAll(), loadRecoveries());
  assert.equal(reg.length, 1);
  assert.deepEqual([reg[0].writtenOff, reg[0].recovered, reg[0].net], [10000, 4000, 6000]);
  assert.equal(reg[0].reason, 'Disputed');
  assert.equal(recoverable(inv.id), 6000);
  assert.throws(() => recordRecovery({ invoiceId: inv.id, amount: 7000, date: '2026-10-11', method: 'UPI' }), /not yet recovered/);
  assert.match(writeOffRegisterCsv(reg), /Disputed/);
});

test('recovery in a later FY posts Bad debts recovered (other income) and leaves the closed year alone', () => {
  const inv = overdue('2025-06-01');
  writeOffBill(inv.id, { date: '2026-03-15', reason: 'Old' });
  const rec = recordRecovery({ invoiceId: inv.id, amount: 2500, date: '2026-05-10', method: 'Cash' });
  assert.equal(rec.mode, 'prior_fy');
  const v = loadVouchers().find((x) => x.id === rec.voucher_id)!;
  assert.equal(v.type, 'RECEIPT');
  assert.ok(v.lines.some((l) => l.account_id === 'bad_debts_recovered' && l.cr === 250000));
  assert.ok(v.lines.some((l) => l.account_id === 'cash' && l.dr === 250000));
  assert.equal(localDb.payments.getAll().filter((p) => p.write_off)[0].amount, 10000, 'the earlier year\'s write-off is unchanged');
  const t = registerTotals(writeOffRegister(localDb.invoices.getAll(), localDb.payments.getAll(), loadRecoveries()));
  assert.deepEqual(t, { writtenOff: 10000, recovered: 2500, net: 7500 });
  assert.equal(getTable('write_off_recoveries').length, 1);
});

test('undo a write-off (owner): the bill is open again', () => {
  const inv = overdue();
  writeOffBill(inv.id, { date: '2026-10-01', reason: 'x' });
  const p = localDb.payments.getAll().find((x) => x.write_off)!;
  setActorProvider(() => ({ id: 'c', name: 'Clerk', role: 'clerk' }));
  assert.throws(() => reverseWriteOff(p.id), /cannot/);
  setActorProvider(null);
  reverseWriteOff(p.id);
  assert.notEqual(reload(inv.id).status, 'Paid');
});
