/** R5-C3: donation receipts (DON series), 80G checks, books entry, receipt page, Form 10BD file, filing, 10BE, bell. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupR5c } from './helpers/r5c.ts';
import { localDb } from '../src/lib/localDb.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { A, chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import { cancelDonation, donationWarnings, donorIdValid, loadDonations, saveDonation } from '../src/lib/nonprofit/donations.ts';
import { donationReceiptHtml, donationSectionText, tenBdText } from '../src/lib/nonprofit/donation-receipt.ts';
import { build10bd, due10bd, form10bdCsv, load10be, markFiled, markSent, parse10beCsv, pending10be, save10be } from '../src/lib/nonprofit/form-10bd.ts';
import { npoNotices } from '../src/lib/nonprofit/nonprofit-alerts.ts';
import { ensureGeneralFund, loadFunds } from '../src/lib/nonprofit/funds.ts';
import { ACT_WORDS_EN } from '../src/lib/ita2025.ts';

beforeEach(() => setupR5c());

const donor = (name: string, pan = 'ABCPD1234F') => localDb.clients.upsert({ name, email: '', address: '12 MG Road', city: 'Pune', zip: '411001', donor: { id_code: 'pan', id_no: pan } });
const give = (o: Partial<Parameters<typeof saveDonation>[0]> & { donor_id: string }) =>
  saveDonation({ date: '2026-05-10', amount: 5000, mode: 'electronic', type: 'others', section: '80G', ...o }, localDb.clients.getById(o.donor_id)?.name ?? '');

test('numbering: DON/FY26-27/0001… per Indian FY, never reused', () => {
  const d = donor('Asha');
  assert.equal(give({ donor_id: d, date: '2026-03-31' }).number, 'DON/FY25-26/0001');
  assert.equal(give({ donor_id: d, date: '2026-04-01' }).number, 'DON/FY26-27/0001');
  const second = give({ donor_id: d, date: '2026-04-02' });
  assert.equal(second.number, 'DON/FY26-27/0002');
  cancelDonation(second.id, 'Duplicate', '2026-04-03');
  assert.equal(give({ donor_id: d, date: '2026-04-04' }).number, 'DON/FY26-27/0003', 'a cancelled number stays used');
});

test('warnings: cash above the date-keyed limit, gifts in kind, missing donor id, anonymous over the 115BBC limit', () => {
  const withId = { donor: { id_code: 'pan' as const, id_no: 'ABCPD1234F' } };
  assert.deepEqual(donationWarnings({ amount: 2500, mode: 'cash', section: '80G', date: '2026-05-01' }, withId), ['cash']);
  assert.deepEqual(donationWarnings({ amount: 2500, mode: 'cash', section: '80G', date: '2016-05-01' }, withId), [], '₹10,000 before FY 2017-18');
  assert.deepEqual(donationWarnings({ amount: 100, mode: 'kind', section: '80G', date: '2026-05-01' }, withId), ['kind']);
  assert.deepEqual(donationWarnings({ amount: 100, mode: 'electronic', section: '80G', date: '2026-05-01' }, { donor: { id_code: 'pan', id_no: 'BAD' } }), ['noId']);
  assert.deepEqual(donationWarnings({ amount: 150000, mode: 'electronic', section: 'none', date: '2026-05-01', anonymous: true }, undefined, [{ amount: 200000 }]), ['anon']);
  assert.equal(donorIdValid('aadhaar', '234567890123'), true);
  assert.equal(donorIdValid('aadhaar', '123456789012'), false);
});

test('books: income vs corpus, balanced, fund-tagged; cash into cash; in kind posts nothing', () => {
  const fund = ensureGeneralFund();
  assert.equal(ensureGeneralFund().id, fund.id, 'created once');
  assert.equal(loadFunds().length, 1);
  const d = donor('Asha');
  const a = give({ donor_id: d, fund_id: fund.id });
  const b = give({ donor_id: d, type: 'corpus', mode: 'cash', amount: 1500 });
  const c = give({ donor_id: d, mode: 'kind', amount: 900 });
  const chart = chartOf(loadUserAccounts());
  const name = (id: string) => chart.find((x) => x.id === id)?.name;
  const va = loadVouchers().find((v) => v.id === a.voucher_id)!;
  assert.equal(va.type, 'RECEIPT');
  assert.equal(va.lines[0].account_id, A.bank);
  assert.equal(name(va.lines[1].account_id), 'Donations received');
  assert.equal(va.lines[1].cost_centre_id, fund.id);
  const vb = loadVouchers().find((v) => v.id === b.voucher_id)!;
  assert.equal(vb.lines[0].account_id, A.cash);
  assert.equal(name(vb.lines[1].account_id), 'Donations — corpus fund');
  assert.equal(chart.find((x) => x.name === 'Donations — corpus fund')?.group, 'RESERVES');
  for (const v of [va, vb]) assert.equal(v.lines.reduce((s, l) => s + l.dr - l.cr, 0), 0);
  assert.equal(c.voucher_id, undefined);
});

test('receipt page: PAN, URN with validity, donor id, amount in words, the 10BE line; labels by date (ITA 2025)', () => {
  const p = localDb.settings.activeProfile()!;
  localDb.settings.save({ ...localDb.settings.get(), profiles: [{ ...p, npo: { pan: 'AAATR1234C', urn_80g: 'AAATR1234CF20214', urn_80g_date: '2021-09-01', urn_80g_valid_to: '2026-03-31' } }] });
  const d = give({ donor_id: donor('Asha'), date: '2026-05-10' });
  const html = donationReceiptHtml(d, localDb.clients.getById(d.donor_id), localDb.settings.activeProfile() ?? null, { labels: { mode: 'Bank', type: 'Others' }, cashLimit: 2000 });
  assert.match(html, /AAATR1234CF20214/);
  assert.match(html, /valid to 2026-03-31/);
  assert.match(html, /PAN ABCPD1234F/);
  assert.match(html, /Five Thousand/i);
  assert.match(html, /Form 114 \[old 10BE\] will be issued after Form 113 \[old 10BD\] is filed/);
  assert.ok(!/<script/i.test(html));
  assert.equal(donationSectionText('80G', '2026-03-31', ACT_WORDS_EN), '80G');
  assert.match(donationSectionText('80G', '2026-04-01', ACT_WORDS_EN), /^Sec 133\(1\)\(b\)\(ii\) \[old 80G\] \(verify with your CA\)$/);
  assert.equal(tenBdText('2026-03-10'), 'Form 10BD');
});

test('10BD: aggregated per donor × section × type × mode, template column order, unreportable rows listed', () => {
  const a = donor('Asha');
  const b = donor('Bina', 'BCDPE2345G');
  const n = localDb.clients.upsert({ name: 'No Id', email: '', address: '', city: '', zip: '' });
  give({ donor_id: a, amount: 1000, date: '2025-06-01' });
  give({ donor_id: a, amount: 2000, date: '2025-07-01' });
  give({ donor_id: a, amount: 700, date: '2025-07-02', mode: 'cash' });
  give({ donor_id: b, amount: 5000, date: '2025-08-01', type: 'corpus' });
  give({ donor_id: n, amount: 400, date: '2025-08-02' });
  give({ donor_id: a, amount: 100, date: '2025-08-03', anonymous: true, section: 'none' });
  give({ donor_id: a, amount: 9, date: '2026-04-02' }); // next FY
  const donors = new Map(localDb.clients.getAll().map((c) => [c.id!, c]));
  const res = build10bd(loadDonations(), donors, 2025);
  assert.equal(res.rows.length, 3);
  assert.deepEqual(res.rows.map((r) => [r.name, r.mode, r.amount]), [['Asha', 'Electronic modes including account payee cheque/draft', 3000], ['Asha', 'Cash', 700], ['Bina', 'Electronic modes including account payee cheque/draft', 5000]]);
  assert.deepEqual(res.left.map((l) => l.why).sort(), ['anonymous', 'id']);
  const csv = form10bdCsv(res.rows, 2025, { pan: 'X', urn_80g: 'URN1', urn_80g_date: '2021-09-01' });
  const [head, first] = csv.split('\r\n');
  assert.equal(head, 'Sr. No.,Pre Acknowledgement Number,ID Code,Unique Identification Number,Section Code,Unique Registration Number (URN),Date of Issuance of Unique Registration Number,Name of donor,Address of donor,Donation Type,Mode of receipt,Amount of donation (Indian rupees)');
  assert.equal(first, '1,,Permanent Account Number,ABCPD1234F,Section 80G,URN1,01/09/2021,Asha,"12 MG Road, Pune, 411001",Others,Electronic modes including account payee cheque/draft,3000');
  assert.deepEqual(due10bd(2025), { bd: '2026-05-31', be: '2026-05-31', lateFeePerDay: 200 });
});

test('filing freezes edits (cancel + new instead); 10BE tracking, CSV import and bell dates', () => {
  const a = donor('Asha');
  const d = give({ donor_id: a, amount: 1000, date: '2025-06-01' });
  const donors = new Map(localDb.clients.getAll().map((c) => [c.id!, c]));
  const rows = build10bd(loadDonations(), donors, 2025).rows;
  assert.equal(npoNotices(loadDonations(), [], [], undefined, '2026-04-30').length, 0, 'not before 1 May');
  assert.equal(npoNotices(loadDonations(), [], [], undefined, '2026-05-01')[0].kind, '10bd');
  const f = markFiled(2025, 'ARN123', '2026-05-20', rows);
  assert.throws(() => saveDonation({ ...d, amount: 2000 }, 'Asha'), /filed/);
  assert.equal(cancelDonation(d.id, 'Wrong amount', '2026-06-01').cancelled?.reason, 'Wrong amount', 'cancel stays possible');
  assert.equal(give({ donor_id: a, amount: 2000, date: '2025-06-01' }).number, 'DON/FY25-26/0002', 'the corrected receipt');
  assert.deepEqual(npoNotices(loadDonations(), [f], [], undefined, '2026-05-25'), []);
  assert.deepEqual(pending10be(f, []), [a]);
  assert.equal(npoNotices(loadDonations(), [f], load10be(), undefined, '2026-06-30')[0].kind, '10be');
  const parsed = parse10beCsv(['Certificate Number', 'Unique Identification Number', 'Date of Certificate'], [['CERT-1', 'abcpd1234f', '25/05/2026'], ['CERT-2', 'ZZZZZ9999Z', '25/05/2026']], localDb.clients.getAll());
  assert.deepEqual(parsed.unknown, ['ZZZZZ9999Z']);
  assert.equal(save10be(2025, parsed.items), 1);
  assert.equal(load10be()[0].cert_date, '2026-05-25');
  markSent(2025, [a], '2026-06-01');
  assert.deepEqual(pending10be(f, load10be()), []);
  const exp = npoNotices([], [], [], { pan: 'X', urn_80g_valid_to: '2026-07-15' }, '2026-06-01');
  assert.equal(exp[0].kind, 'expiry');
});
