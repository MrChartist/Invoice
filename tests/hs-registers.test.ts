/**
 * R18-D3 / D4 registers, audit tracker, bell notices and the income-tax working paper: member rows (Form J fields,
 * nominees as name / share / relation only), the audit due date from the State row (TN 3 months, KA 6) or typed (MH),
 * status chips, notices from 30 days (critical from 7 / overdue), only with the explicit `society` pack; Sec 80P labels
 * up to FY 2025-26 and Sec 149 from 1 Apr 2026 (co-operatives only, unverified); the mutual / non-mutual split.
 */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { auditDue, auditStatus, memberRows, nomineesText, parseNominees } from '../src/lib/society/hs-registers.ts';
import { hsAlerts, hsNotices } from '../src/lib/society/hs-alerts.ts';
import { itaxLines, mutualSplit } from '../src/lib/society/hs-itax.ts';
import { saveSocietySettings } from '../src/lib/society/hs-settings.ts';
import type { SocietyUnit } from '../src/types/society-r18.ts';
import type { Client, InvoiceRecord } from '../src/types/invoice.ts';

test('member rows: one per live unit with an owner, by code; member no., admission, certificate, nominees', () => {
  const units = [
    { id: 'u2', code: 'A-102', owner_id: 'c2', status: 'active', nominees: parseNominees('Kiran:60:Son; Mira:40'), share_cert: 'SC-2', admitted_on: '2020-01-01' },
    { id: 'u1', code: 'A-101', owner_id: 'c1', status: 'active' },
    { id: 'u9', code: 'A-901', owner_id: 'c3', status: 'closed' },
    { id: 'u3', code: '101', wing: 'B', status: 'active' },
  ] as SocietyUnit[];
  const clients = [{ id: 'c1', name: 'Asha', hs: { unit_ids: ['u1'], role: 'owner', member_no: 'M-7' } }, { id: 'c2', name: 'Ravi' }, { id: 'c3', name: 'Meena' }] as Client[];
  assert.deepEqual(memberRows(units, clients), [
    { id: 'u1', no: 'M-7', name: 'Asha', unit: 'A-101', nominees: [], transfers: 0 },
    { id: 'u2', no: '2', name: 'Ravi', unit: 'A-102', admitted: '2020-01-01', cert: 'SC-2', nominees: [{ name: 'Kiran', share_pct: 60, relation: 'Son' }, { name: 'Mira', share_pct: 40 }], transfers: 0 },
  ]);
  assert.equal(nomineesText(units[0].nominees), 'Kiran:60:Son; Mira:40');
  assert.deepEqual(parseNominees(' ; X:150'), [{ name: 'X', share_pct: 100 }]);
});

test('audit due dates and status; bell notices from 30 days, critical at 7 / overdue, explicit pack only', () => {
  assert.equal(auditDue({ fy: '2025-26' }, 3), '2026-06-30', 'TN: three months after 31 March');
  assert.equal(auditDue({ fy: '2025-26' }, 6), '2026-09-30', 'KA: six');
  assert.equal(auditDue({ fy: '2025-26', due_on: '2026-08-14' }, null), '2026-08-14', 'MH: typed');
  assert.equal(auditDue({ fy: '2025-26' }, null), '');
  assert.deepEqual([auditStatus({ fy: 'x' }, '2026-06-30', '2026-06-10'), auditStatus({ fy: 'x' }, '2026-06-30', '2026-07-01'), auditStatus({ fy: 'x', report_on: '2026-06-01' }, '2026-06-30', '2026-07-01'), auditStatus({ fy: 'x', report_on: 'a', rectified_on: 'b' }, '', '')], [{ code: 'sDue', n: 20 }, { code: 'sOver' }, { code: 'sDone' }, { code: 'sFixed' }]);
  const s = { state: '33', audit: [{ fy: '2025-26', auditor: 'A & Co' }] };
  assert.deepEqual(hsAlerts('2026-05-30', s), [], 'more than 30 days ahead');
  assert.deepEqual(hsAlerts('2026-06-10', s).map((a) => [a.severity, a.title, a.href]), [['warning', 'Society audit 2025-26 due on 2026-06-30', '/recurring?tab=society&view=registers']]);
  assert.equal(hsAlerts('2026-06-25', s)[0].severity, 'critical');
  assert.equal(hsAlerts('2026-07-02', s)[0].id, 'hs:audit:2025-26:x');
  assert.deepEqual(hsAlerts('2026-06-25', { ...s, audit: [{ ...s.audit[0], report_on: '2026-06-20' }] }), []);
  resetStorage();
  installSettings();
  saveSocietySettings({ state: '27', audit: [{ fy: '2025-26', due_on: '2026-11-10' }] });
  const now = new Date(2026, 9, 28, 10);
  assert.deepEqual(hsNotices({ now }), [], 'pack off');
  localDb.settings.save({ ...localDb.settings.get(), society_kind: 'chs', industry_packs: ['society'] } as never);
  assert.equal(hsNotices({ now }).length, 1);
});

test('income tax: Sec 80P to FY 2025-26, Sec 149 from FY 2026-27, co-operatives only, unverified; mutual / non-mutual split', () => {
  assert.deepEqual(itaxLines(2025, true)?.lines.map((l) => l.code), ['80P(2)(c)(ii)', '80P(2)(d)']);
  assert.deepEqual(itaxLines(2026, true)?.lines.map((l) => l.code), ['149(2)(c)', '149(2)(d)']);
  assert.equal(itaxLines(2026, true)?.lines[0].cap, 50000);
  assert.equal(itaxLines(2026, false), null, 'an association gets no deduction line');
  const bill = (heads: [string, number][], o: Partial<InvoiceRecord> = {}) => ({ issue_date: '2026-10-01', status: 'Sent', doc_type: 'BILL_OF_SUPPLY', hs: { unit: { id: 'u', code: 'A', members: [] }, heads: heads.map(([kind, amount]) => ({ kind, amount })) }, ...o }) as unknown as InvoiceRecord;
  assert.deepEqual(mutualSplit([bill([['service', 3000], ['statutory', 1200], ['other', 19.93]]), bill([['outsider', 5000]]), bill([['service', 9]], { status: 'Cancelled' }), bill([['service', 9]], { issue_date: '2027-04-01' })], '2026-04-01', '2027-03-31'), { mutual: 3019.93, outsider: 5000 });
});
