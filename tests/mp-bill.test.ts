/**
 * R17-B3 bill from the muster: each basis with paise rounding, pro-rata caps, cost-plus as one supply, service charge,
 * grouping by client + bill group, the regime split, derived billed state, the drafts through the shared builder (RCM
 * total without tax, GSTR-1 B2B reverse charge Y, e-Invoice RegRev Y, 18 % on the unregistered RWA), the annexure, and
 * volume (one month of 60 sites reads 60 musters).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { OCT_ROWS, info, post, world } from './helpers/mp-world.ts';
import { billDate, billPlans, billsOf, postLines } from '../src/lib/manpower/mp-bill.ts';
import { billMonth, planMonth } from '../src/lib/manpower/mp-draft-io.ts';
import { saveMuster, setMusterLock } from '../src/lib/manpower/mp-muster-save.ts';
import { saveManpowerSettings } from '../src/lib/manpower/mp-settings.ts';
import { saveSite } from '../src/lib/manpower/mp-sites-io.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { buildEInvoice } from '../src/lib/einvoice.ts';
import { receivableTotal } from '../src/lib/rcm.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { Site } from '../src/lib/manpower/mp-sites.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { SiteMuster } from '../src/types/manpower-r17.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
let n = 0;
const id = () => `l${++n}`;
const site = (o = {}): Site => ({ id: 'st', name: 'Tower', client_id: 'c', mp: info(o) });
const mu = (rows: SiteMuster['rows'], month = '2026-10'): SiteMuster => ({ id: 'm', site_id: 'st', month, date: '', rows, status: 'locked', updated_at: '' });
const amt = (p: ReturnType<typeof postLines>) => p.map((l) => l.amount);

test('bases: duty, hour (+ OT when ticked), month pro-rata with its cap, cost-plus elements, paise', () => {
  const rows = [{ employee_id: 'a', post_id: 'g', duties: 60.5, ot_hours: 10 }, { employee_id: 'b', post_id: 'g', duties: 61.5 }];
  assert.deepEqual(amt(postLines(site(), post(), mu(rows), {}, id)), [97600]);
  assert.deepEqual(amt(postLines(site(), post({ basis: 'hour', rate: 70.33 }), mu(rows), {}, id)), [102963.12]);
  assert.deepEqual(amt(postLines(site(), post({ basis: 'hour', rate: 70, bill_ot: true }), mu(rows), {}, id)), [103180]);
  const month = post({ basis: 'month', rate: 25000 });
  assert.deepEqual(amt(postLines(site(), month, mu(rows), {}, id)), [98387.1], '122 of 124 duties');
  assert.deepEqual(amt(postLines(site(), month, mu(rows), { billing_days: 30 }, id)), [100000], 'capped at heads × rate');
  assert.deepEqual(amt(postLines(site(), { ...month, bill_extra: true }, mu(rows), { billing_days: 30 }, id)), [101666.67]);
  const cp = postLines(site(), post({ basis: 'costplus', rate: 700 }), mu(rows), { costplus: { pf_pct: 13, esi_pct: 3.25, bonus_pct: 8.33, uniform_per_head: 150 } }, id);
  assert.deepEqual(amt(cp), [85400, 11102, 2775.5, 7113.82, 600]);
  assert.ok(cp.every((l) => l.hsn === '998525'), 'one supply: same SAC');
  assert.deepEqual(postLines(site(), post(), mu([]), {}, id), []);
  assert.deepEqual([billDate('2026-10'), billDate('2026-12', { bill_date: 'next_1' })], ['2026-10-31', '2027-01-01']);
});

test('plans: drafts skipped, grouping by client + bill group, the regime split, service charge', () => {
  const housekeeping = post({ id: 'h', name: 'Housekeeper', sac: '998533', heads: 1, shift_hours: 8, rate: 600 });
  const sites: Site[] = [
    { id: 'a', name: 'Tower A', client_id: 'c', mp: info({ code: 'S-A', bill_group: 'G1', posts: [post(), housekeeping] }) },
    { id: 'b', name: 'Tower B', client_id: 'c', mp: info({ code: 'S-B', bill_group: 'G1' }) },
    { id: 'd', name: 'Draft', client_id: 'c', mp: info({ code: 'S-D' }) },
  ];
  const m = (s: string, status: SiteMuster['status'] = 'locked'): SiteMuster => ({ id: `m-${s}`, site_id: s, month: '2026-10', date: '', status, updated_at: '', rows: [{ employee_id: 'x', post_id: 'g', duties: 31 }, { employee_id: 'y', post_id: 'h', duties: 31 }] });
  const plans = billPlans({ month: '2026-10', sites, musters: [m('a'), m('b'), m('d', 'draft')], settings: { service_charge_pct: 10 }, clients: [{ id: 'c', gstin: '27AAACB2230M1ZX'.slice(0, 15) }], entityType: 'proprietorship', staff: [{ id: 'x', code: 'G1', name: 'Ram' }], newId: id });
  assert.deepEqual(plans.map((p) => [p.regime.regime, p.sites.map((s) => s.id), p.items.map((i) => i.amount)]), [
    ['rcm', ['a', 'b'], [24800, 24800, 2480, 2480]], // QA20 V3: one service-charge line per site on a bill of several sites
    ['fwd', ['a'], [18600, 1860]],
  ]);
  assert.match(plans[0].items[0].name, /^S-A Tower A — Guard/);
  assert.deepEqual([plans[0].mp.muster_id, plans[0].mp.muster_ids, plans[0].mp.site, plans[1].mp.site?.code], ['m-a', ['m-a', 'm-b'], undefined, 'S-A']);
  assert.deepEqual(plans[0].mp.annex?.map((r) => [r.name, r.post]), [['Ram', 'S-A Guard (12 h)'], ['Ram', 'S-B Guard (12 h)']]);
});

test('Bill October for Sunrise: one RCM draft 1,28,600 with the annexure and expected TDS; Green Park 18 %; billed state derived', () => {
  const { sunrise, green } = world();
  const m = saveMuster(sunrise, '2026-10', OCT_ROWS);
  assert.throws(() => billMonth('2026-10'), /lock the month/);
  setMusterLock(m.id, true);
  const g = saveMuster(green, '2026-10', [{ employee_id: 'e6', post_id: 'g', duties: 10 }, { employee_id: 'e6', post_id: 'h', duties: 4 }]);
  setMusterLock(g.id, true);
  saveManpowerSettings({ print_tds: true });
  const r = billMonth('2026-10', [sunrise.id]);
  assert.equal(r.invoices.length, 1);
  const inv = localDb.invoices.getById(r.invoices[0].id) as InvoiceRecord;
  assert.deepEqual(inv.items.map((i) => [i.name, i.quantity, i.rate, i.amount, i.hsn, i.tax_rate]), [['Guard (12 h)', 122, 800, 97600, '998525', 18], ['Supervisor', 31, 1000, 31000, '998525', 18]]);
  assert.deepEqual([inv.status, inv.issue_date, inv.reverse_charge, inv.rcm_tax_excluded, inv.total, receivableTotal(inv), inv.cost_centre_id], ['Draft', '2026-10-31', true, true, 128600, 128600, sunrise.id]);
  assert.deepEqual([inv.mp?.month, inv.mp?.regime, inv.mp?.muster_id, inv.mp?.site?.code, inv.mp?.annex?.length, inv.mp?.posts?.map((p) => p.duties)], ['2026-10', 'rcm', m.id, 'S-001', 6, [122, 31]]);
  assert.match(inv.mp?.decl ?? '', /entry 14/);
  assert.deepEqual([inv.mp?.tds?.expected, inv.mp?.tds?.rate, inv.mp?.tds_print], [1286, 1, true]);
  assert.match(inv.mp?.tds?.label ?? '', /393.*supply of manpower is work/);
  assert.deepEqual(billsOf(localDb.invoices.getAll(), m.id).map((i) => i.id), [inv.id]);
  assert.deepEqual(billMonth('2026-10', [sunrise.id]).skipped, ['S-001'], 'a second bill is skipped unless asked again');
  assert.equal(billMonth('2026-10', [sunrise.id], true).invoices.length, 1);
  const gp = billMonth('2026-10', [green.id]).invoices[0];
  assert.deepEqual([gp.reverse_charge, gp.taxable_value, gp.tax_amount, gp.total], [false, 9900, 1782, 11682]);
  // the existing readers, once issued
  localDb.invoices.save({ ...inv, status: 'Sent' });
  const issued = localDb.invoices.getById(inv.id) as InvoiceRecord;
  const rep = buildGstReport([issued], [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  assert.deepEqual(rep.gstr1.b2b.map((d: { rchrg: string }) => d.rchrg), ['Y']);
  assert.equal(buildEInvoice(issued).payload.TranDtls.RegRev, 'Y');
  assert.deepEqual(planMonth('2026-10').map((p) => p.regime.regime), ['rcm', 'fwd'], 'Green Park (no GSTIN) is one forward-charge bill');
});

test('volume: one month of 60 sites reads 60 musters and makes 60 plans', () => {
  const sites: Site[] = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, name: `Site ${i}`, client_id: 'c', mp: info({ code: `S-${i}` }) }));
  const musters: SiteMuster[] = [];
  for (let mo = 1; mo <= 12; mo++) for (const s of sites) musters.push({ id: `${s.id}-${mo}`, site_id: s.id, month: `2026-${String(mo).padStart(2, '0')}`, date: '', status: 'locked', updated_at: '', rows: Array.from({ length: 10 }, (_, k) => ({ employee_id: `${s.id}-${k}`, post_id: 'g', duties: 26 })) });
  const plans = billPlans({ month: '2026-10', sites, musters, settings: {}, clients: [{ id: 'c' }], entityType: 'company', staff: [], newId: id });
  assert.equal(plans.length, 60);
  assert.ok(plans.every((p) => p.musters.length === 1 && p.musters[0].month === '2026-10' && p.taxable === 208000));
  void saveSite;
});
