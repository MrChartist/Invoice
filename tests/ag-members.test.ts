/** AG-D5 members: allotment from application money, transfer keeps totals, certificate numbers, register as at a date, patronage sums, distribution arithmetic, 80PA after AY 2024-25, Sec 149 labels by date. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setTable, KEYS } from '../src/lib/storage.ts';
import '../src/lib/trust/recycle-bin.ts';
import { allotShares, applicationMoney, certificateHtml, deleteShareRow, distinctive, holdings, loadMembers, loadShares, paidUp, reduceShares, registerAt, transferShares, APPLICATION_LEDGER, CAPITAL_LEDGER } from '../src/lib/agri/ag-members.ts';
import { distribution, draftAppropriation, fyOf, patronage } from '../src/lib/agri/ag-patronage.ts';
import { coopPaper, coopSection, membersCalendar, producerPaper } from '../src/lib/agri/ag-coop-papers.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const vendors = [
  { id: 'v1', name: 'Asha Devi', ag: { code: 'F-0001', member: true, member_no: 'M-1', member_since: '2025-05-01' } },
  { id: 'v2', name: 'Bholu Ram', ag: { code: 'F-0002', member: true, member_no: 'M-2' } },
  { id: 'v3', name: 'Chand (non-member)', ag: { code: 'F-0003', member: false } },
];
const clients = [{ id: 'c1', name: 'Asha Devi', ag: { code: 'F-0001', member: true } }];
beforeEach(() => {
  resetStorage();
  installSettings();
  setTable('vendors', vendors);
  setTable(KEYS.clients, clients);
});

test('members from vendors and clients, one per farmer code; allotment from application money posts a journal; certificate numbers', () => {
  const ms = loadMembers();
  assert.deepEqual(ms.map((m) => [m.id, m.other_id, m.member_no]), [['v1', 'c1', 'M-1'], ['v2', undefined, 'M-2']]);
  const cycles = [{ status: 'closed', lines: [{ farmer_id: 'v1', deductions: [{ kind: 'share', amount: 200 }, { kind: 'feed', amount: 50 }] }, { farmer_id: 'v1', deductions: [{ kind: 'share', amount: 800 }] }] }, { status: 'draft', lines: [{ farmer_id: 'v1', deductions: [{ kind: 'share', amount: 999 }] }] }];
  assert.equal(applicationMoney(['v1', 'c1'], cycles, []), 1000);
  const a = allotShares(ms[0], { date: '2026-06-01', shares: 10, face_value: 100, paid_from: 'application', approved_on: '2026-05-30' });
  assert.equal(a.certificate_no, 'SHC/FY26-27/0001');
  assert.equal(applicationMoney(['v1', 'c1'], cycles, loadShares()), 0, 'allotment used the application money');
  const b = allotShares(ms[1], { date: '2026-06-02', shares: 5, face_value: 100, paid_from: 'cash' });
  assert.equal(b.certificate_no, 'SHC/FY26-27/0002');
  const names = new Map(chartOf(loadUserAccounts()).map((x) => [x.id, x.name]));
  const [j, r] = loadVouchers();
  assert.deepEqual([j.type, names.get(j.lines[0].account_id), names.get(j.lines[1].account_id), j.lines[0].dr], ['JOURNAL', APPLICATION_LEDGER, CAPITAL_LEDGER, 100000]);
  assert.equal(r.type, 'RECEIPT');
  assert.throws(() => allotShares(ms[1], { date: '2026-06-02', shares: 2.5, face_value: 100, paid_from: 'cash' }), /whole numbers/);
  assert.match(certificateHtml(a, { company: 'FPO Ltd', folio: 'M-1', ...distinctive(loadShares(), a.id) }), /Distinctive nos\.<\/td><td>1 to 10/);
  assert.deepEqual(distinctive(loadShares(), b.id), { from: 11, to: 15 });
});

test('transfer keeps total shares, new certificate; surrender with refund; register as at a date with cessation; deletes guarded', () => {
  const [asha, bholu] = loadMembers();
  allotShares(asha, { date: '2026-06-01', shares: 10, face_value: 100, paid_from: 'bank' });
  const t = transferShares(asha, bholu, { date: '2026-07-01', shares: 4, face_value: 100 });
  assert.equal(t.certificate_no, 'SHC/FY26-27/0002');
  assert.throws(() => transferShares(asha, bholu, { date: '2026-07-02', shares: 7, face_value: 100 }), /holds 6 shares/);
  const h = holdings(loadShares());
  assert.deepEqual([h.get('v1'), h.get('v2'), (h.get('v1') ?? 0) + (h.get('v2') ?? 0)], [6, 4, 10]);
  assert.equal(paidUp(loadShares()), 1000);
  reduceShares(asha, 'surrender', { date: '2026-08-01', shares: 6, face_value: 100, refund_by: 'cash' });
  const reg = registerAt(loadMembers(), loadShares(), '2026-08-31');
  assert.deepEqual(reg.map((r) => [r.folio, r.shares, r.paid, r.joined, r.ceased ?? '']), [['M-1', 0, 0, '2025-05-01', '2026-08-01'], ['M-2', 4, 400, '2026-07-01', '']]);
  assert.deepEqual(registerAt(loadMembers(), loadShares(), '2026-06-30').map((r) => r.shares), [10, 0], 'as at an earlier date');
  const allot = loadShares().find((r) => r.kind === 'allot')!;
  assert.throws(() => deleteShareRow(allot.id), /negative shares/);
  deleteShareRow(loadShares().find((r) => r.kind === 'surrender')!.id);
  deleteShareRow(t.id);
  assert.deepEqual(loadShares().map((r) => r.kind), ['allot'], 'the transfer went as a pair');
});

test('patronage: supplies from cycles and member vouchers, purchases by the member; members vs non-members', () => {
  const ms = loadMembers();
  const cycles = [{ status: 'closed', period_to: '2026-10-10', lines: [{ farmer_id: 'v1', qty: 400, amount: 16000 }, { farmer_id: 'v3', qty: 100, amount: 4000 }] }, { status: 'closed', period_to: '2027-04-10', lines: [{ farmer_id: 'v1', qty: 999, amount: 999 }] }];
  const purchases = [{ id: 'p1', kind: 'PURCHASE', vendor_id: 'v2', vendor_name: 'Bholu Ram', bill_number: 'FPV/FY26-27/0001', date: '2026-11-01', lines: [{ name: 'Paddy', quantity: 2000, rate: 20 }], taxable: 40000, total: 40000 }];
  const invoices = [{ id: 'i1', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-07-01', client: { id: 'c1', name: 'Asha Devi' }, taxable_value: 4000, items: [] }] as unknown as InvoiceRecord[];
  const p = patronage(2026, { members: ms, cycles, purchases, invoices, farmerIds: new Set(['v1', 'v2', 'v3']) });
  assert.deepEqual(p.rows.map((r) => [r.member.name, r.suppliedQty, r.suppliedValue, r.boughtValue, r.business, r.share]), [['Asha Devi', 400, 16000, 4000, 20000, 33.33], ['Bholu Ram', 2000, 40000, 0, 40000, 66.67]]);
  assert.equal(p.rows.reduce((t, r) => t + r.suppliedValue, 0), 16000 + 40000, 'sums equal the cycle and voucher values');
  assert.deepEqual([p.members, p.nonMembers, p.memberPct], [56000, 4000, 93.33]);
  assert.equal(fyOf('2027-03-31'), 2026);
  const d = distribution({ pat: 100000, reservePct: 25, dividendPct: 12, dividendCapPct: 10, paidUp: 100000, patronagePool: 30000, rows: p.rows });
  assert.deepEqual([d.reserve, d.dividend, d.patronage, d.retained], [25000, 10000, 30000, 35000]);
  assert.deepEqual(d.bonus.map((b) => b.amount), [10000, 20000]);
  const v = draftAppropriation(d, '2027-03-31');
  assert.equal(v.variant, 'OPTIONAL', 'a draft, never in the books');
  assert.equal(v.lines.reduce((s, l) => s + l.dr - l.cr, 0), 0);
});

test('80PA after AY 2024-25 computes nothing; Sec 149 labels from 1 Apr 2026; calendar dates', () => {
  assert.deepEqual(producerPaper(2023, 500000, 5e8), { ay: '2024-25', deduction: 500000, note: '100% of eligible-business profits; total turnover below ₹100 crore; AY 2019-20 to AY 2024-25.', eligible: true });
  assert.equal(producerPaper(2023, 500000, 2e9).deduction, 0, 'turnover ₹200 crore');
  const late = producerPaper(2025, 500000, 5e8);
  assert.deepEqual([late.ay, late.deduction], ['2026-27', 0]);
  assert.match(late.note, /No deduction found after AY 2024-25 — verify/);
  assert.equal(producerPaper(2024, 1, 1).deduction, 0, 'AY 2025-26 too');
  assert.equal(coopSection(2025).section, '80P(2)');
  assert.equal(coopSection(2026).section, '149');
  const paper = coopPaper(2026, { marketing: 80000, inputs: 20000, other: 5000 }, 90);
  assert.deepEqual(paper.rows.map((r) => [r.head, r.profit, r.membersPart]), [['marketing', 80000, 72000], ['inputs', 20000, 18000], ['milk', 0, 0], ['credit', 0, 0], ['other', 5000, 0]]);
  assert.equal(paper.total, 105000);
  const cal = membersCalendar('producer', 2026, { agm: '09-15' });
  assert.deepEqual(cal.map((c) => [c.key, c.due]), [['internalAudit', '2027-03-31'], ['register', '2027-04-30'], ['agm', '2027-09-15'], ['financials', '2027-10-30'], ['annualReturn', '2027-11-29']]);
});
