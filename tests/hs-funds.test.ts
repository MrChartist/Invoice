/**
 * R18-D1 funds (PRD §7 R18-D): "Map funds" creates three restricted fund cost centres and reserve ledgers; the
 * October bills tag the sinking / repair lines with their fund; "Transfer for 2026-10" posts ONE journal (class
 * "Society fund transfer") of sinking ₹2,250 and repair ₹6,750 (A-102 included); running it again posts nothing; an
 * undone run is reversed by a new journal; the FY mode moves what is left; the R5-C4 fund statement agrees (receipts
 * 2,250 / closing 2,250); the MH minimum hint (HS27).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { readSocietySettings, saveSocietySettings } from '../src/lib/society/hs-settings.ts';
import { issueRun, undoRun } from '../src/lib/society/hs-issue-io.ts';
import { fundsView, mapFunds, postFundTransfer, rangeOf } from '../src/lib/society/hs-books-io.ts';
import { FUND_CLASS, fundBilled, fundMinimum, transferDelta } from '../src/lib/society/hs-funds.ts';
import { loadFunds } from '../src/lib/nonprofit/funds.ts';
import { fundStatement } from '../src/lib/nonprofit/fund-statement.ts';
import { loadLedger, loadVouchers } from '../src/lib/ledger/index.ts';
import type { HsHead, SocietyUnit } from '../src/types/society-r18.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const H = (id: string, kind: HsHead['kind'], basis: HsHead['basis'], rate: number): HsHead => ({ id, name: id, kind, basis, rate, active: true, ...(kind === 'statutory' ? {} : { sac: '999598' }) });
const U = (id: string, code: string, owner: string, o: Partial<SocietyUnit> = {}): SocietyUnit => ({ id, code, wing: 'A', use: 'residential', occupancy: 'owner', parking: [], carpet_area: 600, construction_cost: 2400000, owner_id: owner, typed: { ptx: 1200 }, status: 'active', updated_at: '', ...o });
const OCT = { period: '2026-10', date: '2026-10-01', due: '2026-10-20' };

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.settings.save({ ...localDb.settings.get(), society_kind: 'chs' });
  setTable('clients', [['c1', 'Asha'], ['c2', 'Ravi'], ['c3', 'Meena']].map(([id, name]) => ({ id, name, email: '', address: '', city: '', zip: '' })));
  setTable('society_units', [U('u1', 'A-101', 'c1'), U('u2', 'A-102', 'c2', { occupancy: 'tenant' }), U('u3', 'A-901', 'c3', { carpet_area: 1500, construction_cost: 6000000 })]);
  saveSocietySettings({ state: '27', heads: [H('svc', 'service', 'per_unit', 3000), H('snk', 'sinking', 'cost_pct_pa', 0.25), H('rep', 'repair', 'cost_pct_pa', 0.75), H('ptx', 'statutory', 'typed', 0)] });
});

const journals = () => loadVouchers().filter((v) => v.voucher_class === FUND_CLASS);

test('PRD §7: map funds → the bills tag fund lines → one journal sinking ₹2,250 / repair ₹6,750; again → nothing; undo → reversed', () => {
  const funds = mapFunds();
  assert.deepEqual(loadFunds().map((f) => [f.name, f.fund.nature]).sort(), [['Major repair fund', 'restricted'], ['Repair and maintenance fund', 'restricted'], ['Sinking fund', 'restricted']]);
  assert.deepEqual(readSocietySettings().funds, funds);
  assert.deepEqual(mapFunds(), funds, 'idempotent');
  const run = issueRun(OCT);
  const a = getTable<InvoiceRecord>('invoices').find((i) => i.hs?.unit?.code === 'A-101')!;
  assert.equal(a.items.find((l) => l.name === 'snk')!.cost_centre_id, funds.sinking);
  assert.equal(a.items.find((l) => l.name === 'svc')!.cost_centre_id, undefined);
  assert.deepEqual(a.hs!.funds, { sinking: 500, repair: 1500 });
  const v = postFundTransfer('2026-10')!;
  assert.deepEqual([v.date, v.voucher_class, v.lines.map((l) => [l.account_id === 'sales' ? 'sales' : 'reserve', l.dr, l.cr, l.cost_centre_id])], ['2026-10-31', FUND_CLASS, [['sales', 2250_00, 0, funds.sinking], ['reserve', 0, 2250_00, funds.sinking], ['sales', 6750_00, 0, funds.repair], ['reserve', 0, 6750_00, funds.repair]]]);
  assert.equal(postFundTransfer('2026-10'), null, 'nothing left');
  // The fund statement still shows the contribution as the fund's receipt (sales −, reserve +).
  const st = fundStatement(loadLedger(), loadFunds().find((f) => f.id === funds.sinking)!, { start: '2026-04-01', end: '2027-03-31' });
  assert.deepEqual([st.receiptsTotal, st.closing], [2250, 2250]);
  const fv = fundsView(2026).rows.find((r) => r.key === 'sinking')!;
  assert.deepEqual([fv.billed, fv.transferred, fv.closing], [2250, 2250, 2250]);
  undoRun(run.run!.id, 'wrong rates');
  const back = postFundTransfer('2026-10')!;
  assert.deepEqual(back.lines.filter((l) => l.account_id === 'sales').map((l) => l.cr), [2250_00, 6750_00], 'a new journal reverses the cancelled bills');
  assert.equal(journals().length, 2);
});

test('year-end mode moves the FY at 31 March; minimum hint against the State % of construction cost', () => {
  mapFunds();
  issueRun(OCT);
  issueRun({ period: '2026-11', date: '2026-11-01', due: '2026-11-20' });
  postFundTransfer('2026-10');
  const fy = postFundTransfer('FY2026')!;
  assert.equal(fy.date, '2027-03-31');
  assert.deepEqual(fy.lines.filter((l) => l.account_id === 'sales').map((l) => l.dr), [2250_00, 6750_00], 'the FY billed (Oct + Nov) less October\'s journal: November only');
  assert.equal(postFundTransfer('FY2026'), null);
  assert.deepEqual(rangeOf('FY2026'), { from: '2026-04-01', to: '2027-03-31' });
  const billed = fundBilled(getTable<InvoiceRecord>('invoices'), '2026-04-01', '2027-03-31');
  assert.deepEqual(billed, { sinking: 4500, repair: 13500, major_repair: 0 });
  assert.deepEqual(transferDelta(billed, { sinking: 4500, repair: 10000 }), { sinking: 0, repair: 3500, major_repair: 0 });
  // MH: sinking 0.25 % and repair 0.75 % a year of ₹1.08 crore = 27,000 / 81,000; two months billed are below.
  assert.deepEqual(fundMinimum(billed, getTable<SocietyUnit>('society_units'), { sinking: 0.25, repair: 0.75 }).map((r) => [r.fund, r.min]), [['sinking', 27000], ['repair', 81000]]);
  assert.deepEqual(fundsView(2026).low.map((r) => r.fund), ['sinking', 'repair']);
  assert.deepEqual(fundMinimum({ sinking: 27000, repair: 81000, major_repair: 0 }, getTable<SocietyUnit>('society_units'), { sinking: 0.25, repair: 0.75 }), []);
});
