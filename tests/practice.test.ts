import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { boardCsv, boardTable, buildPracticeBoard, buildPracticeRow, peekedCompany, type PeekedCompany } from '../src/lib/practice.ts';
import { dscDb, dscStatus, nearestExpiry, sanitizeDsc, type DscRow } from '../src/lib/dsc-register.ts';
import { dscNotices } from '../src/lib/dsc-alerts.ts';
import { BUILTIN_TEMPLATE, checklistDb, cleanTemplate, monthChecklist, prevMonth, progress, toggleItem, type ChecklistMonth } from '../src/lib/client-checklist.ts';
import { gstin } from './einvoice-fixtures.ts';

const G = gstin('27AABCU9603R1Z');

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

const company = (over: Partial<PeekedCompany> = {}): PeekedCompany => deepFreeze({
  id: 'c1',
  name: 'Green Traders',
  tables: {
    settings: { profiles: [{ companyGstin: G, stateCode: '27' }], gst_filing_frequency: 'monthly', lock_until: '2026-03-31' },
    compliance: [
      { id: `GSTR1:2026-08:${G}`, form: 'GSTR1', period_key: '2026-08', gstin: G, filed_on: '2026-09-10', marked_at: '' },
      { id: `GSTR3B:2026-08:${G}`, form: 'GSTR3B', period_key: '2026-08', gstin: G, filed_on: '2026-09-19', marked_at: '' },
    ],
    tds_returns: [{ id: '26Q:2026-Q1', form: '26Q', fy: 2026, quarter: 1, filed_on: '2026-07-30' }, { id: '26Q:2025-Q4', form: '26Q', fy: 2025, quarter: 4, filed_on: '2026-05-30' }],
    dsc_register: [{ id: 'd1', holder: 'Anita', role: 'director', valid_to: '2026-10-20' }, { id: 'd2', holder: 'Rohit', role: 'partner', valid_to: '2027-05-01' }],
    client_checklist: [{ id: '2026-09', items: [{ id: 'bank', label: 'Bank statement received', done_at: '2026-09-02T00:00:00Z' }] }],
    invoices: [{ issue_date: '2026-08-05', status: 'Sent' }, { issue_date: '2026-09-12', status: 'Paid' }, { issue_date: '2026-09-20', status: 'Draft' }],
    vouchers: [{ date: '2026-09-25' }],
  },
  ...over,
});

test('row building: GSTINs, next due / overdue per frequency, TDS marks, last entry, lock, drafts, DSC', () => {
  const r = buildPracticeRow(company(), '2026-10-15');
  assert.deepEqual(r.gstins, [G]);
  assert.equal(r.frequency, 'monthly');
  // September GSTR-1 (due 11 Oct) is overdue; GSTR-3B (due 20 Oct) is next.
  assert.equal(r.overdue, 1);
  assert.match(r.overdueForms[0], /GSTR-1 September 2026/);
  assert.deepEqual(r.nextDue, { form: 'GSTR-3B', label: 'September 2026', due: '2026-10-20' });
  assert.equal(r.lastTds, '26Q FY26 Q1');
  assert.equal(r.tdsFiledThisFy, 1);
  assert.equal(r.lastVoucher, '2026-09-25', 'drafts do not count as entries');
  assert.equal(r.lockUntil, '2026-03-31');
  assert.equal(r.drafts, 1);
  assert.deepEqual(r.dsc, { holder: 'Anita', validTo: '2026-10-20', days: 5 });
  assert.deepEqual(r.checklist, { done: 0, total: BUILTIN_TEMPLATE.length }, 'October starts fresh from the template');
  // QRMP: no monthly GSTR-1 for September (quarter month) — it is due in October as a quarter.
  const q = buildPracticeRow(company({ tables: { ...company().tables, settings: { profiles: [{ companyGstin: G, stateCode: '27' }], gst_filing_frequency: 'qrmp' } } }), '2026-10-12');
  assert.equal(q.frequency, 'qrmp');
  assert.equal(q.overdue, 0);
  assert.equal(q.nextDue?.label.startsWith('Q2'), true);
});

test('locked company row; no writes to peeked data (frozen input); board export carries the CA note', () => {
  const rows = buildPracticeBoard([company(), deepFreeze({ id: 'c2', name: 'Vaulted Ltd', locked: true })], '2026-10-15');
  assert.equal(rows[1].locked, true);
  assert.equal(rows[1].overdue, 0);
  assert.equal(rows[1].nextDue, undefined);
  const table = boardTable(rows);
  assert.equal(table.length, 3);
  assert.match(String(table[1].at(-1)), /verify with your CA/);
  assert.match(String(table[2].at(-1)), /Locked/);
  assert.equal(buildPracticeRow({ id: 'x', name: 'Empty' }, '2026-10-15').overdue, 0, 'a fresh company has nothing due');
});

test('DSC expiry windows in local days; bell notices fingerprinted', () => {
  const r = (valid_to: string): DscRow => ({ id: valid_to, holder: 'H', role: 'director', valid_to });
  assert.equal(dscStatus(r('2026-10-14'), '2026-10-15'), 'expired');
  assert.equal(dscStatus(r('2026-10-15'), '2026-10-15'), 'urgent', 'valid through the last day');
  assert.equal(dscStatus(r('2026-10-22'), '2026-10-15'), 'urgent');
  assert.equal(dscStatus(r('2026-10-23'), '2026-10-15'), 'soon');
  assert.equal(dscStatus(r('2026-11-14'), '2026-10-15'), 'soon');
  assert.equal(dscStatus(r('2026-11-15'), '2026-10-15'), 'ok');
  assert.equal(dscStatus(r('2027-03-31'), '2027-03-01'), 'soon', 'across the FY end');
  assert.equal(nearestExpiry([r('2027-01-01'), r('2026-11-01')])?.valid_to, '2026-11-01');
  const n = dscNotices([r('2026-10-10'), r('2026-10-20'), r('2026-11-10'), r('2026-12-31'), r('2026-08-01')], '2026-10-15', 'now');
  assert.deepEqual(n.map((x) => x.id), ['dsc-expired:2026-10-10', 'dsc-urgent:2026-10-20', 'dsc-soon:2026-11-10']);
  assert.equal(sanitizeDsc({ holder: 'x', valid_to: '31/12/2026' }), null);
  resetStorage();
  const saved = dscDb.save({ holder: 'Anita', role: 'director', valid_to: '2027-01-01', dsc_class: 'Class 3' });
  assert.equal(dscDb.all()[0].id, saved.id);
  dscDb.remove(saved.id);
  assert.equal(dscDb.all().length, 0);
});

test('checklist carry-over across months and the FY; template layering', () => {
  const tpl = ['Bank statement received', 'GSTR-2B downloaded'];
  let rows: ChecklistMonth[] = [];
  rows = toggleItem(rows, '2026-02', tpl, 'bank-statement-received', 'Asha', new Date('2026-02-05T00:00:00Z'));
  const march = monthChecklist(rows, '2026-03', [...tpl, 'Sales register shared']);
  assert.equal(march.items.find((i) => i.label === 'GSTR-2B downloaded')?.carried, '2026-02');
  assert.equal(march.items.find((i) => i.label === 'Bank statement received')?.carried, undefined, 'ticked items do not carry');
  // A one-off item from February that left the template still carries, once.
  rows = [...rows, { id: '2026-03', items: [...march.items, { id: 'audit', label: 'Audit query reply' }] }];
  const april = monthChecklist(rows, '2026-04', tpl); // new FY
  assert.equal(april.items.filter((i) => i.label === 'GSTR-2B downloaded').length, 1);
  assert.equal(april.items.find((i) => i.label === 'GSTR-2B downloaded')?.carried, '2026-02', 'keeps the month it was first open');
  assert.equal(april.items.find((i) => i.label === 'Audit query reply')?.carried, '2026-03');
  assert.equal(new Set(april.items.map((i) => i.id)).size, april.items.length, 'unique ids');
  assert.deepEqual(progress(april), { done: 0, total: april.items.length });
  assert.equal(prevMonth('2026-01'), '2025-12');
  assert.deepEqual(cleanTemplate([' A ', 'a', '', 5, 'B']), ['A', 'B']);
  resetStorage();
  assert.deepEqual(checklistDb.template(), [...BUILTIN_TEMPLATE]);
  globalThis.localStorage.setItem('mrchartist_checklist_default', JSON.stringify(['Device item']));
  assert.deepEqual(checklistDb.template(), ['Device item']);
  checklistDb.setTemplate(['Company item']);
  assert.deepEqual(checklistDb.template(), ['Company item']);
  const m = checklistDb.toggle('2026-05', 'company-item', 'Asha', new Date('2026-05-02T00:00:00Z'));
  assert.equal(m.items[0].by, 'Asha');
  assert.equal(checklistDb.months().length, 1);
});

test('QA5-2 F8: the board CSV neutralises formula injection in a company name and a DSC holder', () => {
  const evil = company({ name: '=HYPERLINK("http://x","Click")' });
  const tables = { ...evil.tables, dsc_register: [{ id: 'd9', holder: '@cmd', role: 'director', valid_to: '2026-11-20' }] } as PeekedCompany['tables'];
  const csv = boardCsv(buildPracticeBoard([{ ...evil, tables }], '2026-10-15'));
  const cells = csv.split(/\r?\n/)[1];
  assert.ok(cells.startsWith(`"'=HYPERLINK(`), cells);
  assert.ok(cells.includes(",'@cmd,"), cells);
});

test('QA5-2 F19: a registry entry with no database is "no data on this device", not "Locked"', () => {
  const ghost = peekedCompany({ id: 'g', name: 'Ghost Co' }, null);
  assert.deepEqual([ghost.missing, !!ghost.locked], [true, false]);
  const sealed = peekedCompany({ id: 's', name: 'Sealed' }, { locked: true, tables: {} });
  assert.deepEqual([!!sealed.missing, sealed.locked], [false, true]);
  const open = peekedCompany({ id: 'o', name: 'Open' }, { locked: false, tables: { invoices: [] } });
  assert.deepEqual([!!open.missing, !!open.locked, !!open.tables], [false, false, true]);
  const [row] = buildPracticeBoard([ghost], '2026-10-15');
  assert.equal(row.missing, true);
  assert.equal(row.locked, false);
  assert.match(String(boardTable([row])[1].at(-1)), /No data on this device/);
});
