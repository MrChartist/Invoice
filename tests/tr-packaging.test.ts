/** TR-A5: returnable packaging balances and ageing, deposit vouchers (no GST), charge for unreturned crates, gates. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import { chargeUnreturned, loadPackMoves, packBalances, recordPackMove, removePackMove, savePackType } from '../src/lib/trade/tr-packaging.ts';
import type { PackagingMove } from '../src/types/trade-r8.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ industry_packs: ['distributor'], business_type: 'wholesale' } as never);
  localDb.clients.upsert({ ...clientMH });
});

const mv = (date: string, out: number, back: number, party = 'A'): PackagingMove => ({ id: `${date}${out}${back}${party}`, date, party_kind: 'client', party_id: party, party_name: party, type_id: 'crate', out, in: back });

test('balances per party × type as on a date; FIFO ageing of units not back', () => {
  const moves = [mv('2026-08-01', 40, 0), mv('2026-08-10', 0, 35), mv('2026-10-20', 20, 0), mv('2026-08-05', 10, 0, 'B'), mv('2026-11-05', 5, 0)];
  const b = packBalances(moves, '2026-10-31', 60);
  const a = b.find((x) => x.party === 'A')!;
  assert.deepEqual([a.out, a.in, a.balance, a.aged, a.oldest], [60, 35, 25, 5, '2026-08-01'], 'the 5 from 1 Aug are 91 days out; the 20 of 20 Oct are not aged');
  assert.deepEqual([b.find((x) => x.party === 'B')!.aged, b.length], [10, 2]);
  assert.equal(packBalances(moves, '2026-08-31', 60).find((x) => x.party === 'A')!.aged, 0);
});

test('a deposit posts a receipt (Dr cash / Cr Packaging deposits, no GST); a refund a payment; delete removes the voucher', () => {
  const t = savePackType({ name: 'Crate', deposit: 50, charge_rate: 150, hsn: '3923', tax_rate: 18 });
  const m = recordPackMove({ date: '2026-10-01', party_kind: 'client', party_id: clientMH.id, party_name: clientMH.name, type_id: t.id, out: 40, in: 0, deposit: 2000 });
  const v = loadVouchers().find((x) => x.id === m.voucher_id)!;
  const dep = chartOf(loadUserAccounts()).find((a) => a.name === 'Packaging deposits')!;
  assert.equal(dep.group, 'OTHER_CL');
  assert.deepEqual([v.type, v.lines[0].account_id, v.lines[0].dr, v.lines[1].account_id, v.lines[1].cr], ['RECEIPT', 'cash', 200000, dep.id, 200000]);
  const r = recordPackMove({ date: '2026-10-05', party_kind: 'client', party_id: clientMH.id, party_name: clientMH.name, type_id: t.id, out: 0, in: 10, deposit: -500 });
  assert.equal(loadVouchers().find((x) => x.id === r.voucher_id)!.type, 'PAYMENT');
  assert.equal(packBalances(loadPackMoves(), '2026-10-31')[0].deposit, 1500);
  removePackMove(r.id);
  assert.equal(loadVouchers().length, 1);
  assert.ok(getTable('recycle_bin').length >= 1, 'deleted through the watched table');
  assert.throws(() => recordPackMove({ date: '2026-10-05', party_kind: 'client', party_name: 'X', type_id: t.id, out: 0, in: 0 }), /quantity/);
});

test('charge for unreturned: a draft taxable invoice at the charge rate with the crate HSN / GST and an in-move closing them', () => {
  const t = savePackType({ name: 'Crate', deposit: 50, charge_rate: 150, hsn: '3923', tax_rate: 18 });
  recordPackMove({ date: '2026-08-01', party_kind: 'client', party_id: clientMH.id, party_name: clientMH.name, type_id: t.id, out: 40, in: 35 });
  const bal = packBalances(loadPackMoves(), '2026-10-31')[0];
  assert.throws(() => chargeUnreturned(bal, 6, '2026-10-31'), /between 1 and 5/);
  const { invoice, move } = chargeUnreturned(bal, 5, '2026-10-31');
  assert.deepEqual([invoice.status, invoice.items[0].name, invoice.items[0].hsn, invoice.items[0].tax_rate, invoice.taxable_value], ['Draft', 'Crate not returned', '3923', 18, 750]);
  assert.equal(invoice.tax_amount, 135);
  assert.deepEqual([move.in, move.charge_invoice_id], [5, invoice.id]);
  assert.equal(packBalances(loadPackMoves(), '2026-10-31')[0].balance, 0);
  assert.throws(() => removePackMove(move.id), /cancel that invoice/);
});

test('pack / setting gate: the editor and bill-modal mounts are lazy and guarded; nothing reads packaging with them off', () => {
  const summary = readFileSync(new URL('../src/components/creator/SummaryPanel.tsx', import.meta.url), 'utf8');
  assert.match(summary, /const PackagingStrip = lazy\(\(\) => import\('\.\.\/trade\/PackagingStrip'\)\)/);
  assert.match(summary, /\{trOn && <Suspense fallback=\{null\}><PackagingStrip \/>/);
  const items = readFileSync(new URL('../src/components/creator/ItemsTable.tsx', import.meta.url), 'utf8');
  assert.match(items, /\{tradeOn && priced && <Suspense fallback=\{null\}><LineDiscountCell /);
  const strip = readFileSync(new URL('../src/components/trade/PackagingStrip.tsx', import.meta.url), 'utf8');
  assert.match(strip, /packOn \? loadPackTypes\(\) : \[\]/);
});
