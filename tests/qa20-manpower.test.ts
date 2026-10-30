/**
 * QA round 20 over Round 17 (manpower agencies): money paths across packages and the data layer. Each test fails on
 * the R17 head (`fb0a031`) — see docs/prd/qa-round-20.md (V1 … V8).
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { OCT_ROWS, info, line, world } from './helpers/mp-world.ts';
import { billMonth, makeArrears, planUnbilled } from '../src/lib/manpower/mp-draft-io.ts';
import { saveMuster, setMusterLock } from '../src/lib/manpower/mp-muster-save.ts';
import { loadMusters, musterWarnings, loadStaff } from '../src/lib/manpower/mp-muster.ts';
import { saveManpowerSettings } from '../src/lib/manpower/mp-settings.ts';
import { saveSite } from '../src/lib/manpower/mp-sites-io.ts';
import { billedFor, siteProfit } from '../src/lib/manpower/mp-profit.ts';
import { siteShares, sumShares } from '../src/lib/manpower/mp-compliance.ts';
import { mpAlerts } from '../src/lib/manpower/mp-alerts.ts';
import { gstTdsHint } from '../src/lib/manpower/mp-tds-io.ts';
import { saveCompliance } from '../src/lib/manpower/mp-comp-save.ts';
import { cancelDocument, createCreditNote } from '../src/lib/documents.ts';
import { deleteCostCentre, readCostCentreUsage } from '../src/lib/cost-centres.ts';
import { costCentrePnl, loadLedger } from '../src/lib/ledger/index.ts';
import { loadCostCentres } from '../src/lib/cost-centres.ts';
import { restoreEntries } from '../src/lib/trust/recycle-bin.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { audit } from '../src/lib/audit.ts';
import { localDb } from '../src/lib/localDb.ts';
import { resetI18nForTests, setCatalogueForTests, setLanguage } from '../src/i18n/index.ts';
import type { Site } from '../src/lib/manpower/mp-sites.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { SiteMuster } from '../src/types/manpower-r17.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
afterEach(() => thawDate());

/** Sunrise (S-001) and a second tower (S-009) of the same client, billed together (bill group G). */
function grouped(): { a: Site; b: Site } {
  const { sunrise } = world();
  const a = saveSite({ ...sunrise, mp: { ...sunrise.mp, bill_group: 'G' } });
  const b = saveSite({ name: 'Tower B', client_id: sunrise.client_id, mp: info({ code: 'S-009', bill_group: 'G' }) });
  return { a, b };
}
const lockNew = (s: Site, month: string, rows: SiteMuster['rows']) => setMusterLock(saveMuster(s, month, rows).id, true);
const issue = (i: InvoiceRecord) => localDb.invoices.save({ ...localDb.invoices.getById(i.id)!, status: 'Sent' });

test('V1: a group bill made after one site of the group was billed leaves that site out (it billed it twice)', () => {
  const { a, b } = grouped();
  lockNew(a, '2026-09', OCT_ROWS);
  const first = billMonth('2026-09').invoices;
  assert.deepEqual(first.map((i) => [i.mp?.site?.id, i.taxable_value]), [[a.id, 128600]]);
  lockNew(b, '2026-09', [{ employee_id: 'e6', post_id: 'g', duties: 10 }]);
  assert.deepEqual(planUnbilled('2026-09').map((p) => p.sites.map((s) => s.id)), [[b.id]], 'the view plans Tower B only');
  const r = billMonth('2026-09');
  assert.deepEqual(r.invoices.map((i) => [i.mp?.site?.id, i.taxable_value]), [[b.id, 8000]]);
  assert.deepEqual(r.skipped, ['S-001']);
  const live = localDb.invoices.getAll().filter((i) => i.status !== 'Cancelled');
  assert.equal(live.reduce((t, i) => t + (i.taxable_value ?? 0), 0), 136600, 'each duty billed once');
  assert.equal(billMonth('2026-09', [a.id], true).invoices[0].taxable_value, 128600, '"Bill again" still bills the asked site only');
});

test('V2: a deleted muster bill / arrears note comes back from the bin only while nothing billed it again', () => {
  const { sunrise } = world();
  lockNew(sunrise, '2026-09', OCT_ROWS);
  const [bill] = billMonth('2026-09').invoices;
  localDb.invoices.remove(bill.id);
  billMonth('2026-09');
  audit.flush();
  const bin = () => getTable<{ id: string; table: string; row_id: string }>('recycle_bin');
  const e = bin().find((x) => x.table === 'invoices' && x.row_id === bill.id)!;
  assert.ok(e);
  assert.throws(() => restoreEntries([e.id]), /billed again/);
  // a muster row restores only without a twin for the same site × month
  const m = saveMuster(sunrise, '2026-10', OCT_ROWS);
  setTable('site_musters', getTable<SiteMuster>('site_musters').filter((x) => x.id !== m.id));
  saveMuster(sunrise, '2026-10', OCT_ROWS);
  audit.flush();
  const me = bin().find((x) => x.table === 'site_musters' && x.row_id === m.id)!;
  assert.ok(me);
  assert.throws(() => restoreEntries([me.id]), /already has a row for 2026-10/);
});

test('V3: a bill of several sites carries each line\'s site; site P&L and the books\' cost-centre P&L agree to the paisa', () => {
  const { a, b } = grouped();
  saveManpowerSettings({ service_charge_pct: 10 });
  lockNew(a, '2026-09', OCT_ROWS);
  lockNew(b, '2026-09', [{ employee_id: 'e6', post_id: 'g', duties: 10 }]);
  const [inv] = billMonth('2026-09').invoices;
  assert.equal(inv.taxable_value, 150260);
  assert.ok(inv.items.every((l) => l.cost_centre_id === a.id || l.cost_centre_id === b.id), 'every line names its site');
  assert.deepEqual(inv.items.filter((l) => /^Service charge/.test(l.name)).map((l) => [l.name, l.amount, l.cost_centre_id]), [['Service charge 10 %: S-001', 12860, a.id], ['Service charge 10 %: S-009', 800, b.id]]);
  assert.deepEqual([billedFor(inv, a), billedFor(inv, b)], [141460, 8800], 'service charge included (it was left out: 128,600 / 8,000)');
  issue(inv);
  const pnl = costCentrePnl(loadLedger(), { start: '2026-09-01', end: '2026-09-30' }, loadCostCentres());
  const profit = siteProfit({ month: '2026-09', sites: [a, b], invoices: localDb.invoices.getAll(), musters: loadMusters('2026-09'), lines: null, bills: [] });
  assert.deepEqual(profit.map((p) => Math.round(p.billed * 100)), [pnl.totals[a.id].income, pnl.totals[b.id].income], 'books = site P&L');
  assert.equal(pnl.totals[''].income, 0, 'nothing unallocated');
  // a partial credit note on the group bill takes out its own value, at the sites of its lines
  const cn = createCreditNote(localDb.invoices.getById(inv.id)!, { reason: 'Short duty', lines: [{ itemId: inv.items[2].id, quantity: 1 }] } as never);
  assert.deepEqual([cn.taxable_value, billedFor(cn, a), billedFor(cn, b)], [800, -0, -800]);
});

test('V4: a site with musters, compliance rows, deployed staff or tagged bills cannot be deleted', () => {
  const { a, b } = grouped();
  assert.ok((readCostCentreUsage(a.id).sites ?? 0) > 0, 'Sunrise has deployed staff');
  lockNew(b, '2026-09', [{ employee_id: 'e6', post_id: 'g', duties: 10 }]);
  assert.equal(readCostCentreUsage(b.id).sites, 1);
  assert.throws(() => deleteCostCentre(b.id), /site musters/);
  const c = saveSite({ name: 'Tower C', client_id: a.client_id, mp: info({ code: 'S-010' }) });
  saveCompliance(c.id, '2026-09', { status: 'pending' }, sumShares([]));
  assert.throws(() => deleteCostCentre(c.id));
  const d = saveSite({ name: 'Tower D', client_id: a.client_id, mp: info({ code: 'S-011' }) });
  setTable('purchases', [{ id: 'p', kind: 'PURCHASE', date: '2026-09-05', taxable: 10, total: 10, lines: [], mp: { site_id: d.id } }]);
  assert.throws(() => deleteCostCentre(d.id));
});

test('V5: compliance shares add up to the run line to the paisa; a draft muster elsewhere is not a source', () => {
  const mk = (id: string, status: SiteMuster['status'] = 'locked'): SiteMuster => ({ id, site_id: id, month: '2026-10', date: '', status, updated_at: '', rows: [{ employee_id: 'p', post_id: 'g', duties: 10 }] });
  const ms = [mk('x'), mk('y'), mk('z')];
  const l = [line('p', 10000, { net: 8200, pf_ee: 1000.01 })];
  const parts = ms.map((m) => siteShares(m, ms, l)[0]);
  assert.equal(Math.round(parts.reduce((t, s) => t + s.gross, 0) * 100), 1000000, 'was 9,999.99');
  assert.equal(Math.round(parts.reduce((t, s) => t + s.pf_ee, 0) * 100), 100001);
  assert.equal(Math.round(parts.reduce((t, s) => t + s.net, 0) * 100), 820000);
  const withDraft = [mk('x'), mk('d', 'draft')];
  assert.equal(siteShares(withDraft[0], withDraft, l)[0].gross, 10000, 'the draft at another site does not take half');
});

test('V6: an arrears note never predates its bill, and carries the client TDS the bill crossed', () => {
  freezeDate('2026-09-20T10:00:00');
  const { sunrise } = world();
  lockNew(sunrise, '2026-09', OCT_ROWS);
  const [bill] = billMonth('2026-09', [sunrise.id]).invoices;
  issue(bill);
  assert.equal(bill.issue_date, '2026-09-30');
  saveManpowerSettings({ wage_revisions: [{ id: 'v', from: '2026-09-01', delta_day: 26, ref: 'VDA', site_ids: [sunrise.id] }] });
  const [dn] = makeArrears('v');
  assert.deepEqual([dn.issue_date, dn.taxable_value, dn.mp?.tds?.expected], ['2026-09-30', 3978, 39.78], 'was dated 2026-09-20 with no TDS');
});

test('V6: a still-draft bill\'s expected TDS rate carries to its arrears note', () => {
  const { sunrise } = world();
  lockNew(sunrise, '2026-09', OCT_ROWS);
  billMonth('2026-09', [sunrise.id]);
  saveManpowerSettings({ wage_revisions: [{ id: 'v', from: '2026-09-01', delta_day: 2, ref: 'VDA', site_ids: [sunrise.id] }] });
  const [dn] = makeArrears('v');
  assert.deepEqual([dn.taxable_value, dn.mp?.tds?.rate, dn.mp?.tds?.expected], [306, 1, 3.06]);
});

test('V7: a billed muster, or one under a final payroll run, cannot be unlocked', () => {
  const { sunrise } = world();
  const m = lockNew(sunrise, '2026-09', OCT_ROWS);
  const [bill] = billMonth('2026-09').invoices;
  assert.throws(() => setMusterLock(m.id, false), /billed/);
  cancelDocument(localDb.invoices.getById(bill.id)!, 'wrong duties');
  setTable('payroll_runs', [{ id: 'r', month: '2026-09', status: 'final', number: 'PRL/1', lines: [] }]);
  assert.throws(() => setMusterLock(m.id, false), /finalized/);
  setTable('payroll_runs', []);
  assert.equal(setMusterLock(m.id, false).status, 'draft');
});

test('V8: muster warnings, licence notices and the GST TDS hint follow the interface language', async () => {
  world();
  resetI18nForTests();
  setCatalogueForTests('hi', {});
  await setLanguage('hi', { persist: false });
  try {
    const w = musterWarnings({ site_id: 'x', month: '2026-10', rows: [{ employee_id: 'e1', post_id: 'g', duties: 63 }] }, [], loadStaff());
    assert.match(w[0].text, /दिन में दो/);
    const a = mpAlerts({ today: '2026-10-28', settings: { licences: [{ id: 'l', kind: 'osh', no: 'L1', valid_till: '2026-11-10' }] }, packs: ['manpower'], sites: [], guards: [] });
    assert.match(a[0].title, /लाइसेंस L1/);
    assert.match(a[0].detail ?? '', /दिन बाकी/);
    assert.match(gstTdsHint({ mp: { gst_tds_only: true } }, 'fwd', 300000, '2026-10-31'), /GST TDS 2 %/);
  } finally {
    await setLanguage('en', { persist: false });
  }
});

test('V9: the contract-labour licence hint counts the agency\'s people across all its sites (OSH Code Sec 45(1)(ii))', async () => {
  const { labourHints } = await import('../src/lib/manpower/mp-wage-check.ts');
  const sites = Array.from({ length: 6 }, (_, k): Site => ({ id: `s${k}`, name: `S${k}`, client_id: 'c', mp: info({ code: `S-${k}` }) }));
  const musters = sites.map((s): SiteMuster => ({ id: `m${s.id}`, site_id: s.id, month: '2026-10', date: '', status: 'locked', updated_at: '', rows: Array.from({ length: 10 }, (_, j) => ({ employee_id: `${s.id}e${j}`, post_id: 'g', duties: 26 })) }));
  const h = (lic: { id: string; kind: 'osh' | 'psara'; no: string; valid_till: string }[] = [], ms = musters) => labourHints({ month: '2026-10', lines: [], staff: [], sites, musters: ms, licences: lic }).map((x) => [x.k, x.who]);
  assert.deepEqual(h(), [['clraAll', '60']], 'no site has 50, the agency has 60');
  assert.deepEqual(h([{ id: 'l', kind: 'osh', no: '1', valid_till: '2027-03-31' }]), []);
  assert.deepEqual(h([], musters.slice(0, 4)), [], '40 people: below 50');
});
