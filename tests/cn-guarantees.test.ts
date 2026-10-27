/** R11 CN-B5 (+ B2 alerts): guarantees — expiry alerts, extend history, release / invoked; EMD / SD link; bell; restore safety. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupWorks, DEPT } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, peekTable, setTable } from '../src/lib/storage.ts';
import { saveRaBill } from '../src/lib/works/measurements.ts';
import { saveAdvance } from '../src/lib/advances.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { saveContract } from '../src/lib/construction/cn-contracts.ts';
import { bgCommission, closeGuarantee, contractDeposits, expiringGuarantees, extendGuarantee, linkDeposit, loadGuarantees, saveGuarantee } from '../src/lib/construction/cn-guarantees.ts';
import { cnFinanceNotices } from '../src/lib/construction/cn-alerts.ts';
import { deleteSecured, loadSecured, recordSecured } from '../src/lib/construction/cn-secured.ts';
import { loadPvs, savePv } from '../src/lib/construction/cn-escalation.ts';
import { planRestore, restoreEntry } from '../src/lib/trust/recycle-bin.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { WorksContract } from '../src/types/construction-r11.ts';
import type { BinEntry } from '../src/types/trade-r4.ts';

let boq: InvoiceRecord;
let c: WorksContract;
beforeEach(() => {
  boq = setupWorks();
  c = saveContract({ boq_id: boq.id, client_id: DEPT.id, client_name: DEPT.name, name_of_work: 'Road', contract_value: 1150000 });
});

const bin = () => getTable<BinEntry>('recycle_bin');
const data = () => ({ contracts: peekTable<WorksContract>('works_contracts'), guarantees: loadGuarantees(), secured: loadSecured(), advances: peekTable<never>('advances'), invoices: localDb.invoices.getAll(), payments: getTable<Payment>('transactions') });

test('register: validation, expiry within 30 days, extend keeps history, release / invoked close it; commission', () => {
  assert.throws(() => saveGuarantee({ bank: 'SBI', bg_no: 'X', amount: 1, issued_on: '2026-06-01', expires_on: '2026-05-01' }), /expiry/);
  const b = saveGuarantee({ contract_id: c.id, kind: 'performance', bank: 'SBI', bg_no: 'PBG/1', amount: 57500, issued_on: '2026-06-01', expires_on: '2026-07-21', commission_pct: 1.5 });
  assert.equal(bgCommission(b), 118.15, '₹57,500 × 1.5% × 50 / 365');
  assert.deepEqual(expiringGuarantees(loadGuarantees(), '2026-06-15').length, 0);
  assert.equal(expiringGuarantees(loadGuarantees(), '2026-07-01')[0].bg_no, 'PBG/1', '20 days to expiry');
  const n = cnFinanceNotices(data(), '2026-07-01', 'now').find((x) => x.id.startsWith('cn:bg:'));
  assert.equal(n?.severity, 'info');
  assert.equal(cnFinanceNotices(data(), '2026-07-25', 'now').find((x) => x.id.startsWith('cn:bg:'))?.severity, 'warning', 'expired');
  assert.throws(() => extendGuarantee(b.id, '2026-07-01', '2026-07-01'), /after the current/);
  const e = extendGuarantee(b.id, '2027-01-31', '2026-07-05', 'Amend 1');
  assert.equal(e.status, 'extended');
  assert.deepEqual(e.history, [{ on: '2026-07-05', action: 'extended', expires_on: '2027-01-31', ref: 'Amend 1' }]);
  const inv = closeGuarantee(b.id, 'invoked', '2026-08-01');
  assert.equal(inv.status, 'invoked');
  assert.throws(() => closeGuarantee(b.id, 'released', '2026-08-02'), /already closed/);
  assert.equal(expiringGuarantees(loadGuarantees(), '2027-01-30').length, 0);
});

test('EMD / SD paid to the client: linked to the contract (additive contract_id)', () => {
  setTable('security_deposits', [{ id: 'd1', direction: 'paid', party_id: DEPT.id, party_name: DEPT.name, amount: 23000, date: '2026-04-20', mode: 'bank', movements: [], status: 'open' }]);
  assert.equal(contractDeposits(c.id, DEPT.id).length, 1, 'offered for linking');
  linkDeposit('d1', c.id);
  assert.equal(contractDeposits(c.id).length, 1);
  assert.equal(contractDeposits(c.id)[0].contract_id, c.id);
});

test('bell: secured advance unrecovered after 90 days, advance not recovered at 80% of work, withheld after 90 days', () => {
  recordSecured({ contract_id: c.id, party: DEPT.name, date: '2026-05-01', materials: [{ description: 'Steel', qty: 10, rate: 60000 }] });
  const adv = saveAdvance({ client: { id: DEPT.id, name: DEPT.name }, date: '2026-05-05', amount: 115000, method: 'Bank transfer', place_of_supply: '27', supply: 'services', tax_rate: 18 } as never, { today: '2026-05-05' });
  saveRaBill(boq.id, { date: '2026-05-10', lines: [{ line_id: 'l1', cumulative_qty: 400 }], recoveries: [{ kind: 'withheld', amount: 5000, reason: 'Outfall' }] });
  // Linked after the bill (nothing recovered yet) with a 5% "fully by" term: 8.7% of work is done.
  saveContract({ ...c, advance_terms: [{ advance_id: adv.id, kind: 'mobilisation', recover_by_pct: 5 }] });
  const ids = cnFinanceNotices(data(), '2026-08-15', 'now').map((x) => x.id.split(':')[1]).sort();
  assert.deepEqual(ids, ['mob', 'sa', 'wh']);
  assert.deepEqual(cnFinanceNotices(data(), '2026-06-01', 'now').map((x) => x.id.split(':')[1]), ['mob'], 'others not yet');
});

test('restore safety: a secured advance comes back with its journal; a PV statement only while no live one covers its period', () => {
  const sa = recordSecured({ contract_id: c.id, party: DEPT.name, date: '2026-06-01', materials: [{ description: 'Cement', qty: 100, rate: 400 }] });
  deleteSecured(sa.id, localDb.invoices.getAll());
  assert.ok(!loadVouchers().some((v) => v.id === sa.voucher_id), 'journal removed with the row');
  const entry = bin().find((b) => b.table === 'secured_advances' && b.row_id === sa.id)!;
  const live = (t: string) => getTable<Record<string, unknown>>(t);
  assert.equal(planRestore(entry, live, bin()).companions?.[0]?.row_id, sa.voucher_id);
  restoreEntry(entry.id);
  assert.ok(loadSecured().some((s) => s.id === sa.id));
  assert.ok(loadVouchers().some((v) => v.id === sa.voucher_id), 'journal back too');
  // PV: a deleted statement cannot come back once the period was billed again.
  const cc = saveContract({ ...c, escalation: { formula: 'cpwd_10cc', components: [{ key: 'cement', share_pct: 100, base_index: 400 }] } });
  saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] });
  const pv = savePv({ contract: cc, date: '2026-07-05', period_from: '2026-04-01', period_to: '2026-06-30', indices: [{ key: 'cement', current_index: 420 }] });
  setTable('price_variations', getTable('price_variations').filter((p) => (p as { id: string }).id !== pv.id));
  savePv({ contract: cc, date: '2026-07-06', period_from: '2026-04-01', period_to: '2026-06-30', indices: [{ key: 'cement', current_index: 420 }] });
  const pvEntry = bin().find((b) => b.table === 'price_variations' && b.row_id === pv.id)!;
  const plan = planRestore(pvEntry, live, bin());
  assert.equal(plan.refusal, 'module');
  assert.match(plan.message ?? '', /bill it twice/);
  assert.equal(loadPvs().length, 1);
});
