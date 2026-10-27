/** AG-C1: weighbridge slips — net = gross − tare, open → done, voucher prefill equals the slip, cancelled keeps its number. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { principalDb } from '../src/lib/job-work.ts';
import { getTable } from '../src/lib/storage.ts';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { readFileSync } from 'node:fs';
import '../src/lib/agri/ag-cmr.ts';
import {
  cancelSlip, cleanReadings, dailyIntake, deleteSlip, hoursBetween, loadSlips, openSlip, openSlips, receiveForJob, recordTare, setReadings, slipHtml, slipNet, voucherPrefill,
} from '../src/lib/agri/ag-weighbridge.ts';
import { weighNet } from '../src/lib/trade/tr-weight.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-10-27T09:00:00');
});
afterEach(() => thawDate());

const first = (o: Record<string, unknown> = {}) => openSlip({ date: '2026-10-27', vehicle: 'pb10 ab 1234', party_kind: 'farmer', party_name: 'Gurdev Singh', commodity: 'Paddy PR-126', gross_kg: 8640, bags: 52, readings: { moisture: 19.2 }, gross_at: '2026-10-27T09:00', ...o } as never);

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('AG-C block: rights and audit labels at runtime; backed up, synced (dated / numbered), described; writers import the registry', () => {
  const backup = src('lib/backup.ts');
  const sync = src('lib/sync-engine.ts');
  for (const [t, label] of [['weighbridge_slips', 'Weighbridge slip'], ['cmr_agreements', 'Custom-milling agreement']]) {
    assert.equal(TABLE_ACTIONS[t], 'doc.create', t);
    assert.equal(WATCHED_TABLES[t]?.label, label);
    assert.ok(TABLE_MEANING[t], `${t} in the open export`);
    assert.equal((backup.match(new RegExp(`'${t}'`, 'g')) ?? []).length, 2, `${t} in both backup lists`);
  }
  assert.match(sync, /\$\{DB_PREFIX\}weighbridge_slips`\]: 'date'/);
  assert.match(sync, /\$\{DB_PREFIX\}weighbridge_slips`\]: \{ num: 'number', date: 'date' \}/);
  for (const f of ['ag-weighbridge', 'ag-cmr', 'ag-yield', 'ag-mill-bom']) assert.match(src(`lib/agri/${f}.ts`), /import '\.\/ag-registry';/, f);
  assert.ok(!/weighbridge_slips|cmr_agreements/.test(src('lib/access.ts') + src('lib/audit-edits.ts')), 'Round 12 tables only at runtime');
  // The rules file imports only the dated-rule helper; no first-paint module imports it.
  assert.deepEqual([...src('lib/agri-rules.ts').matchAll(/^import (?!type)[^;]*from '([^']+)'/gm)].map((m) => m[1]), ['./tax-rules']);
  for (const f of ['lib/tax-rules.ts', 'lib/shop-mode.ts', 'lib/storage.ts', 'lib/localDb.ts', 'store/invoice-defaults.ts']) assert.ok(!src(f).includes('agri-rules'), f);
});

test('net = gross − tare (never below 0; 0 while open); readings are clean %', () => {
  assert.equal(slipNet(8640, 6000), 2640);
  assert.equal(slipNet(8640, undefined), 0);
  assert.equal(slipNet(100, 120), 0);
  assert.deepEqual(cleanReadings({ moisture: 19.234, foreign: undefined }), { moisture: 19.23 });
  assert.throws(() => cleanReadings({ moisture: 120 }), /between 0 and 100/);
});

test('open → done: WBS series, vehicle upper-cased, tare closes the slip with its time; tare must be below gross', () => {
  const s = first();
  assert.equal(s.number, 'WBS/FY26-27/0001');
  assert.deepEqual([s.status, s.vehicle, s.net_kg, s.tare_kg], ['open', 'PB10 AB 1234', 0, undefined]);
  assert.throws(() => recordTare(s.id, 9000), /less than the gross/);
  const d = recordTare(s.id, 6000, { at: '2026-10-27T13:30', readings: { foreign: 1.1 } });
  assert.deepEqual([d.status, d.tare_kg, d.net_kg, d.tare_at, d.readings], ['done', 6000, 2640, '2026-10-27T13:30', { moisture: 19.2, foreign: 1.1 }]);
  assert.throws(() => recordTare(s.id, 5000), /done/);
  assert.match(slipHtml(d, { name: 'Shiv Rice Mill' }), /Subject to quality cut[\s\S]*/);
  assert.match(slipHtml(d, { name: 'Shiv Rice Mill' }), /2,640 kg/);
});

test('voucher prefill equals the slip: net as quintals, bags, the weighing (gross = vehicle net), readings', () => {
  const s = first();
  assert.throws(() => voucherPrefill(s), /second weighing/);
  const d = recordTare(s.id, 6000);
  const p = voucherPrefill(d);
  assert.deepEqual([p.wbs_id, p.wbs_number, p.date, p.vendor_name, p.bags, p.net_kg, p.readings], [d.id, d.number, '2026-10-27', 'Gurdev Singh', 52, 2640, { moisture: 19.2 }]);
  assert.deepEqual([p.line.name, p.line.unit, p.line.quantity], ['Paddy PR-126', 'QTL', 26.4]);
  assert.equal(weighNet(p.line.wt).net, 2640, 'the R8 weighing nets to the slip');
  // A bag tare typed on the voucher (0.5 kg × 52) takes the voucher below the slip, as the user story expects.
  assert.equal(weighNet({ ...p.line.wt, tare_per_package: 0.5 }).net, 2614);
});

test('cancelled slip keeps its number (next slip takes the next one); used slips cannot be cancelled or deleted', () => {
  const a = first();
  const c = cancelSlip(a.id, 'wrong vehicle');
  assert.deepEqual([c.status, c.number, c.cancel_reason], ['cancelled', 'WBS/FY26-27/0001', 'wrong vehicle']);
  assert.throws(() => cancelSlip(a.id, ''), /reason/);
  const b = first({ vehicle: 'PB11 CD 9' });
  assert.equal(b.number, 'WBS/FY26-27/0002');
  deleteSlip(b.id);
  assert.equal(first({ vehicle: 'PB12' }).number, 'WBS/FY26-27/0003', 'a deleted number stays reserved');
  assert.match(slipHtml(c, {}), /CANCELLED/);
  const done = recordTare(loadSlips().find((s) => s.number.endsWith('0003'))!.id, 6000);
  const r = receiveForJob(done.id, { name: 'Harpal (job milling)' });
  assert.equal(r.slip.use, 'job');
  assert.equal(r.slip.ref_id, r.jwpId);
  assert.deepEqual(principalDb.all().map((x) => [x.kind, x.lines[0].name, x.lines[0].qty, x.lines[0].unit, x.challan_no]), [['receipt', 'Paddy PR-126', 26.4, 'QTL', done.number]]);
  assert.throws(() => cancelSlip(done.id, 'x'), /already used/);
  assert.throws(() => deleteSlip(done.id), /used/);
  assert.throws(() => setReadings(done.id, { moisture: 12 }), /already used/);
  assert.throws(() => receiveForJob(done.id, { name: 'x' }), /already used/);
});

test('daily intake: by commodity / party / use, net-weighted moisture; open slips older than 24 h flagged', () => {
  const a = recordTare(first().id, 6000); // 2,640 kg at 19.2%
  recordTare(first({ vehicle: 'B', gross_kg: 12000, readings: { moisture: 17 }, party_kind: 'trader' }).id, 7000); // 5,000 kg at 17%
  first({ vehicle: 'C', date: '2026-10-25', gross_at: '2026-10-25T08:00' }); // stale open slip
  first({ vehicle: 'D', gross_at: '2026-10-27T08:30' }); // fresh open slip
  const r = dailyIntake(loadSlips(), '2026-10-27', '2026-10-27T10:00');
  assert.equal(r.net_kg, 7640);
  assert.equal(r.avg_moisture, 17.76);
  assert.deepEqual(r.byParty.map((g) => [g.key, g.slips, g.net_kg]), [['farmer', 1, 2640], ['trader', 1, 5000]]);
  assert.deepEqual(r.byUse.map((g) => [g.key, g.net_kg]), [['purchase', 7640]]);
  assert.deepEqual([r.open.length, r.stale], [2, 1]);
  assert.equal(openSlips(loadSlips(), '2026-10-27T10:00')[0].hours, 50);
  assert.equal(hoursBetween('2026-10-27T09:00', '2026-10-27T13:30'), 4);
  assert.ok(a.status === 'done');
  assert.equal(getTable('weighbridge_slips').length, 4);
});
