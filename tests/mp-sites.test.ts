/** R17-A2 sites: a site is a project cost centre with `mp`; validation, code uniqueness, SAC suggestion, values, flags, deploy. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, installSettings } from './helpers/world.ts';
import { loadCostCentres } from '../src/lib/cost-centres.ts';
import { cleanSite, endsSoon, monthValue, suggestSac, suggestSiteCode, validateSite } from '../src/lib/manpower/mp-sites.ts';
import { loadSites, saveClientMp, saveSite } from '../src/lib/manpower/mp-sites-io.ts';
import { deploy, deployedAt } from '../src/lib/manpower/mp-payroll-io.ts';
import { loadEmployees, saveEmployee } from '../src/lib/payroll/store.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { MpPost, SiteInfo } from '../src/types/manpower-r17.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
const post = (o: Partial<MpPost> = {}): MpPost => ({ id: 'p1', name: 'Guard (12 h)', sac: '998525', heads: 4, shift_hours: 12, basis: 'duty', rate: 800, ...o });
const info = (o: Partial<SiteInfo> = {}): SiteInfo => ({ code: 'S-001', contract: { from: '2026-08-01', to: '2027-07-31' }, posts: [post(), post({ id: 'p2', name: 'Supervisor', heads: 1, rate: 1000 })], status: 'active', ...o });

test('SAC suggestion by post name and kind (a typed SAC is the user\'s)', () => {
  assert.equal(suggestSac('Guard (12 h)'), '998525');
  assert.equal(suggestSac('Supervisor'), '998525');
  assert.equal(suggestSac('Housekeeper'), '998533');
  assert.equal(suggestSac('Helper', 'staffing'), '998513');
  assert.equal(suggestSac('Helper', 'labour'), '998519');
  assert.equal(suggestSac('Pantry boy', 'facility'), '998533');
});

test('a site is a project cost centre with mp; code suggested and unique; contract dates; closed → done', () => {
  assert.equal(suggestSiteCode([]), 'S-001');
  const s = saveSite({ name: 'Sunrise Towers', client_id: 'c-mh', mp: info({ code: ' s-001 ', address: ' ' }) });
  const c = loadCostCentres().find((x) => x.id === s.id)!;
  assert.deepEqual([c.kind, c.start, c.due, c.mp!.code, c.mp!.address, c.mp!.posts.length], ['project', '2026-08-01', '2027-07-31', 'S-001', undefined, 2]);
  assert.equal(suggestSiteCode(loadSites()), 'S-002');
  assert.throws(() => saveSite({ name: 'Other', mp: info() }), /already used/);
  assert.equal(validateSite('X', info({ code: 'S-9', posts: [post({ sac: '9985' })] }), undefined, []), 'SAC of Guard (12 h) is six digits.');
  assert.equal(validateSite('X', info({ code: 'S-9', contract: { from: '2026-08-01', to: '2026-01-01' } }), undefined, []), 'Check the contract dates.');
  assert.equal(validateSite('X', info({ code: 'S-9', posts: [post({ heads: 0 })] }), undefined, []), 'Check heads, shift, basis and rate of Guard (12 h).');
  assert.equal(cleanSite(info({ status: 'bad' as never })).status, 'active');
  saveSite({ id: s.id, name: s.name, mp: { ...s.mp, status: 'closed' } });
  assert.equal(loadCostCentres()[0].status, 'done');
});

test('value a month at full duties; contract end warning', () => {
  assert.equal(monthValue(info(), 30), 4 * 800 * 30 + 1000 * 30);
  assert.equal(monthValue({ posts: [post({ basis: 'month', rate: 21000 }), post({ basis: 'hour', rate: 70, heads: 1, shift_hours: 8 })] }, 26), 4 * 21000 + 70 * 8 * 26);
  assert.equal(endsSoon(info(), '2027-07-10'), true);
  assert.equal(endsSoon(info(), '2027-05-01'), false);
  assert.equal(endsSoon(info({ contract: {} }), '2027-07-10'), false);
});

test('client flags on Client.mp; deploy through the payroll store keeps Employee.mp', () => {
  localDb.clients.upsert(clientMH);
  saveClientMp('c-mh', { school: true, composition: false });
  assert.deepEqual(localDb.clients.getById('c-mh')!.mp, { school: true });
  saveClientMp('c-mh', {});
  assert.equal(localDb.clients.getById('c-mh')!.mp, undefined);
  const s = saveSite({ name: 'Tower', mp: info() });
  const e = saveEmployee({ code: 'G1', name: 'Ramesh', tax_regime: 'new', pf: true, esi: true, pt: true, active: true });
  deploy(e.id, s.id, 'p1');
  assert.deepEqual([deployedAt(s.id).map((x) => x.name), loadEmployees()[0].mp], [['Ramesh'], { post_id: 'p1' }]);
});
