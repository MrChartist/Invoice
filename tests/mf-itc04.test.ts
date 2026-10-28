/**
 * MF-C3 ITC-04 depth: the job-worker reconciliation sums equal the ITC-04 tables; scrap kept / sold by the job worker
 * (a loss line tagged `mf.scrap_at_jw`) is reported once as losses and wastes; challans with no movement are listed;
 * `itc04.ts` output is unchanged without the tag.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildItc04 } from '../src/lib/itc04.ts';
import { challanBalances } from '../src/lib/job-work.ts';
import { itc04Extra } from '../src/lib/mfg/mf-itc04-extra.ts';
import type { MaterialIn, MaterialOut } from '../src/types/job-work.ts';
import type { StockItem } from '../src/lib/inventory.ts';

const items: StockItem[] = [{ id: 'fab', name: 'Fabric', unit: 'MTR', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }, { id: 'kt', name: 'Kurta', unit: 'PCS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }];
const o = (id: string, date: string, qty: number, party = 'Rehmat'): MaterialOut => ({ id, number: `JWC/FY26-27/${id}`, date, party_name: party, party_gstin: '27AAACB2230M1ZT', job_worker_godown: `g-${party}`, lines: [{ id: `${id}l`, item_id: 'fab', qty, rate: 120 }] });
const outs = [o('1', '2026-04-10', 100), o('2', '2026-05-02', 50), o('3', '2026-04-20', 30, 'Salim')];
const ins: MaterialIn[] = [
  { id: 'a', number: 'JWR/1', date: '2026-07-10', party_name: 'Rehmat', job_worker_godown: 'g-Rehmat', consumed: [{ id: 'c', item_id: 'fab', qty: 80, out_line_id: '1l' }], received: [{ id: 'r', item_id: 'kt', qty: 64, kind: 'processed' }], losses: [{ id: 'w', item_id: 'fab', qty: 6, out_line_id: '1l', mf: { scrap_at_jw: true } } as never, { id: 'w2', item_id: 'fab', qty: 2, out_line_id: '1l' }] },
  { id: 'b', number: 'JWR/2', date: '2026-08-01', party_name: 'Rehmat', job_worker_godown: 'g-Rehmat', consumed: [], received: [{ id: 'r2', item_id: 'fab', qty: 10, kind: 'returned', out_line_id: '2l' }] },
];

test('scrap at the job worker settles the challan as a loss / waste, reported once in Table 5A', () => {
  const b = challanBalances(outs, ins, '2026-09-30');
  const s = b.settlements.filter((x) => x.what === 'lost');
  assert.deepEqual(s.map((x) => [x.qty, !!x.scrap_at_jw]), [[6, true], [2, false]]);
  const r = buildItc04(outs, ins, '2026-07-01', '2026-09-30', { items });
  const a = r.table5.filter((x) => x.table === '5A');
  assert.equal(a.reduce((t, x) => t + x.loss_qty, 0), 8, 'losses and wastes once (6 scrap + 2 loss)');
  const plain = buildItc04(outs, ins.map((v) => ({ ...v, losses: v.losses?.map((l) => ({ id: l.id, item_id: l.item_id, qty: l.qty, out_line_id: l.out_line_id })) })), '2026-07-01', '2026-09-30', { items });
  assert.deepEqual(plain, r, 'the tag does not change ITC-04 itself');
});

test('reconciliation sums equal the ITC-04 tables; by job worker; idle challans listed', () => {
  const x = itc04Extra(outs, ins, '2026-07-01', '2026-09-30');
  const r = buildItc04(outs, ins, '2026-07-01', '2026-09-30', { items });
  const t5 = r.table5.reduce((t, y) => t + y.qty + y.loss_qty, 0);
  assert.equal(x.rows.reduce((t, y) => t + y.inPeriod, 0), t5, 'what the period settled = Table 5 quantities + losses');
  assert.equal(x.scrapInPeriod, 6);
  const rehmat = x.byParty.find((p) => p.party === 'Rehmat')!;
  assert.deepEqual([rehmat.sent, rehmat.back, rehmat.balance, rehmat.oldest], [150, 98, 52, '2026-04-10']);
  assert.deepEqual(x.idle.map((y) => y.number), ['JWC/FY26-27/3'], 'Salim\'s challan had no movement in the period');
  assert.equal(x.rows.find((y) => y.outId === '1')!.scrap, 6);
});
