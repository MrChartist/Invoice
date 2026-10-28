/**
 * R17-D1 wage-revision arrears: increase per duty or new minimum less the previous, revision dates, pass-through sites,
 * each basis through the bill engine (duty, hour, month, cost-plus with its percentages), service charge, the debit
 * note through the existing path (DBN, doc_links, reverse charge carried, GSTR-1 CDNR with RCM Y, expected TDS),
 * already-raised derived, the supplementary-invoice setting, the employees' side.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { OCT_ROWS, info, post, world } from './helpers/mp-world.ts';
import { deltaFor, mpArrears, passesThrough, postArrear, staffArrears } from '../src/lib/manpower/mp-arrears.ts';
import { billMonth, makeArrears, planArrears } from '../src/lib/manpower/mp-draft-io.ts';
import { saveMuster, setMusterLock } from '../src/lib/manpower/mp-muster-save.ts';
import { readManpowerSettings, saveManpowerSettings } from '../src/lib/manpower/mp-settings.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { readLinks } from '../src/lib/documents.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { Site } from '../src/lib/manpower/mp-sites.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { WageRevision } from '../src/types/manpower-r17.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const rev = (o: Partial<WageRevision> = {}): WageRevision => ({ id: 'v', from: '2026-10-01', delta_day: 26, ref: 'VDA Oct', ...o });
const site = (o = {}): Site => ({ id: 'st', name: 'Tower', client_id: 'c', mp: info(o) });
const mu = { month: '2026-10', rows: [{ employee_id: 'a', post_id: 'g', duties: 60 }, { employee_id: 'b', post_id: 'g', duties: 62 }] };

test('increase per duty: typed, or the new minimum less the previous matching one; post filters', () => {
  const p = post();
  assert.equal(deltaFor(rev(), [], p), 26);
  const old = rev({ id: 'o', from: '2026-04-01', delta_day: undefined, wage_day: 774 });
  const nu = rev({ id: 'n', delta_day: undefined, wage_day: 800 });
  assert.equal(deltaFor(nu, [old, nu], p), 26);
  assert.equal(deltaFor(rev({ post_name: 'Supervisor' }), [], p), 0, 'another post');
  assert.equal(deltaFor(rev({ id: 'x', delta_day: undefined, wage_day: 800 }), [], p), 0, 'no previous minimum: nothing to pass on');
  assert.ok(passesThrough(site({ contract: { escalation: 'vda_pass_through' } }), rev()));
  assert.ok(!passesThrough(site(), rev()) && passesThrough(site(), rev({ site_ids: ['st'] })));
});

test('each basis: duty = duties × increase; hour / month / cost-plus through the bill engine', () => {
  const s = site();
  assert.equal(postArrear(s, post(), mu, 26, {}, 'r')?.amount, 3172);
  assert.equal(postArrear(s, post({ basis: 'hour', rate: 70 }), mu, 24, {}, 'r')?.amount, 2928, '122 duties × 12 h × ₹2 more an hour');
  assert.equal(postArrear(s, post({ basis: 'month', rate: 24800, heads: 4 }), mu, 26, {}, 'r')?.amount, 3172, 'pro-rata: 122 of 124 duties × ₹26 × 31');
  assert.equal(postArrear(s, post({ basis: 'costplus', rate: 800 }), mu, 26, { costplus: { pf_pct: 13 } }, 'r')?.amount, 3584.36, 'wages + 13 % PF on them');
  assert.equal(postArrear(s, post(), mu, 0, {}, 'r'), null);
});

test('Sunrise (September, billed and issued before today): 153 duties × ₹26 = ₹3,978 → one debit note (DBN, linked, reverse charge carried, CDNR RCM Y, TDS); re-run shows it raised', () => {
  const { sunrise } = world();
  const m = saveMuster(sunrise, '2026-09', OCT_ROWS);
  setMusterLock(m.id, true);
  const bill = billMonth('2026-09', [sunrise.id]).invoices[0];
  localDb.invoices.save({ ...bill, status: 'Sent' }); // issued: the client's FY total passes the 194C threshold
  saveManpowerSettings({ wage_revisions: [rev({ from: '2026-09-01', to: '2026-12-31' }), rev({ id: 'late', from: '2026-10-01' })] });
  assert.deepEqual(planArrears('v').notes, [], 'no pass-through site: nothing');
  saveManpowerSettings({ wage_revisions: [rev({ from: '2026-09-01', site_ids: [sunrise.id] }), rev({ id: 'late', from: '2026-10-01', site_ids: [sunrise.id] })] });
  assert.deepEqual(planArrears('late').notes, [], 'a revision after the billed month');
  const plan = planArrears('v').notes;
  assert.deepEqual(plan.map((n) => [n.of.id, n.amount, n.lines.map((l) => [l.duties, l.amount])]), [[bill.id, 3978, [[122, 3172], [31, 806]]]]);
  const [dn] = makeArrears('v');
  const saved = localDb.invoices.getById(dn.id) as InvoiceRecord;
  assert.equal(saved.doc_type, 'DEBIT_NOTE');
  assert.match(saved.invoice_number, /^DBN\//);
  assert.deepEqual([saved.reverse_charge, saved.rcm_tax_excluded, saved.taxable_value, saved.total, saved.items.map((l) => [l.hsn, l.tax_rate])], [true, true, 3978, 3978, [['998525', 18], ['998525', 18]]]);
  assert.deepEqual(saved.mp?.arrear, { rev_id: 'v', from: '2026-09-01', to: '2026-09-30', of: bill.id });
  assert.deepEqual([saved.mp?.month, saved.mp?.site?.id, saved.mp?.regime, saved.mp?.muster_id, saved.mp?.arrear_rows?.length], ['2026-09', sunrise.id, 'rcm', undefined, 2]);
  assert.equal(saved.mp?.tds?.expected, 39.78);
  assert.ok(readLinks().some((l) => l.from_id === bill.id && l.to_id === dn.id && l.relation === 'debit_note'));
  assert.equal(planArrears('v').notes[0].raised[0].id, dn.id, 'already raised, derived');
  assert.throws(() => makeArrears('v'), /No arrears left/);
  localDb.invoices.save({ ...saved, status: 'Sent' });
  const day = saved.issue_date;
  const rep = buildGstReport([localDb.invoices.getById(dn.id)!], [], { period: { kind: 'month', fyStart: Number(day.slice(5, 7)) >= 4 ? Number(day.slice(0, 4)) : Number(day.slice(0, 4)) - 1, month: Number(day.slice(5, 7)) } });
  assert.deepEqual(rep.gstr1.cdnr.map((r: { noteType: string; rchrg: string; taxable: number }) => [r.noteType, r.rchrg, r.taxable]), [['D', 'Y', 3978]]);
});

test('arrears as a supplementary invoice (setting); the employees\' side across sites', () => {
  const { sunrise } = world();
  const m = saveMuster(sunrise, '2026-10', OCT_ROWS);
  setMusterLock(m.id, true);
  billMonth('2026-10', [sunrise.id]);
  saveManpowerSettings({ arrears_doc: 'invoice', wage_revisions: [rev({ site_ids: [sunrise.id] })] });
  const [inv] = makeArrears('v');
  assert.deepEqual([inv.doc_type, inv.status, inv.reverse_charge, inv.taxable_value, inv.mp?.arrear?.rev_id], ['INVOICE', 'Draft', true, 3978, 'v']);
  const owed = staffArrears(readManpowerSettings().wage_revisions![0], [], [sunrise], [m], [{ id: 'e1', code: 'G01', name: 'Ramesh' }]);
  assert.deepEqual(owed.find((o) => o.employee_id === 'e1'), { employee_id: 'e1', name: 'Ramesh', duties: 30, amount: 780 });
  assert.equal(owed.reduce((t, o) => t + o.amount, 0), 3978);
  assert.deepEqual(mpArrears({ rev: rev(), revs: [], sites: [sunrise], musters: [m], invoices: [inv], settings: {} }), [], 'notes never arrear again');
});
