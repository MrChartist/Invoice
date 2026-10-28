/**
 * R17-D3 licence and renewal notices: 60 / 30 / 7-day windows and expired, PSARA only with the security pack, guards'
 * licences, contract ends (closed sites out), the VDA month reminder, the provider's pack check, the bell's gate row.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { info } from './helpers/mp-world.ts';
import { mpAlerts, mpNotices } from '../src/lib/manpower/mp-alerts.ts';
import { saveManpowerSettings } from '../src/lib/manpower/mp-settings.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { Site } from '../src/lib/manpower/mp-sites.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const lic = (id: string, kind: 'psara' | 'osh', till: string) => ({ id, kind, no: `L-${id}`, valid_till: till, ...(kind === 'psara' ? { state: 'MH' } : {}) });
const site = (to: string, status: 'active' | 'closed' = 'active'): Site => ({ id: `s${to}`, name: 'Tower', mp: info({ contract: { to }, status }) });

test('windows: 60 / 30 / 7 days and expired; PSARA only with the security pack; guards; contract ends', () => {
  const settings = { licences: [lic('a', 'psara', '2026-11-17'), lic('b', 'osh', '2026-12-20'), lic('c', 'osh', '2027-03-01'), lic('d', 'osh', '2026-10-30'), lic('e', 'osh', '2026-10-01')], wage_revisions: [{ id: 'r', from: '2026-10-01', ref: 'x' }] };
  const guards = [{ id: 'g', name: 'Ramesh', mp: { guard_licence: { no: 'G1', valid_till: '2026-11-10' } } }, { id: 'h', name: 'Mahesh' }];
  const a = mpAlerts({ today: '2026-10-28', settings, packs: ['manpower', 'security'], sites: [site('2026-12-01'), site('2026-11-01', 'closed')], guards });
  assert.deepEqual(a.map((x) => [x.id.split(':').slice(0, 3).join(':'), x.severity]), [
    ['mp:lic:a', 'warning'], ['mp:lic:b', 'info'], ['mp:lic:d', 'critical'], ['mp:lic:e', 'critical'], ['mp:guard:g', 'warning'], ['mp:site:s2026-12-01', 'info'],
  ]);
  assert.match(a.find((x) => x.id.startsWith('mp:lic:a'))!.title, /PSARA licence L-a \(MH\) expires 2026-11-17/);
  assert.match(a.find((x) => x.id.startsWith('mp:lic:e'))!.title, /expired/);
  assert.ok(a.every((x) => x.href === '/time?tab=deploy&view=statutory'));
  const noSec = mpAlerts({ today: '2026-10-28', settings, packs: ['manpower'], sites: [], guards: [] });
  assert.ok(!noSec.some((x) => x.id.startsWith('mp:lic:a')), 'PSARA rows only with the security pack');
  assert.notEqual(mpAlerts({ today: '2026-10-01', settings, packs: ['manpower', 'security'], sites: [], guards: [] }).find((x) => x.id.startsWith('mp:lic:a'))?.id, a[0].id, 'a new id when the next window starts');
});

test('VDA month reminder (April / October) until a revision of the month is typed', () => {
  const r = (today: string, revs: { id: string; from: string; ref: string }[] = []) => mpAlerts({ today, settings: { wage_revisions: revs }, packs: ['manpower'], sites: [], guards: [] }).map((x) => x.id);
  assert.deepEqual(r('2026-10-05'), ['mp:vda:2026-10']);
  assert.deepEqual(r('2026-04-05'), ['mp:vda:2026-04']);
  assert.deepEqual(r('2026-11-05'), []);
  assert.deepEqual(r('2026-10-05', [{ id: 'x', from: '2026-10-01', ref: 'VDA' }]), []);
});

test('the provider reads storage and re-checks the packs; the bell loads it behind the manpower gate', () => {
  saveManpowerSettings({ licences: [lic('a', 'osh', '2026-11-01')] });
  const now = new Date(2026, 9, 28, 10);
  assert.deepEqual(mpNotices({ now }), [], 'packs off: silent');
  localDb.settings.save({ ...localDb.settings.get(), industry_packs: ['manpower'] } as never);
  const n = mpNotices({ now });
  assert.deepEqual(n.map((x) => x.id.split(':')[1]), ['lic', 'vda'], 'the licence and the October VDA reminder');
  assert.equal(n[0].at, now.toISOString());
  const bell = readFileSync(new URL('../src/components/command/NotificationBell.tsx', import.meta.url), 'utf8');
  assert.match(bell, /gate\('manpower', '-', \(\) => import\('\.\.\/\.\.\/lib\/manpower\/mp-alerts'\)/);
});
