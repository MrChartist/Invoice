/**
 * PENDING #20 (SV-C1.7): package income kept deferred — the month's sold / redeemed / expired / cancelled figures, one
 * balanced "Package income recognised" journal a month (Sales ↔ Package income received in advance), packages sold
 * before the switch untouched, the switch off = nothing.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { CheckinDay, Membership } from '../src/types/services-r10.ts';
import { loadVouchers } from '../src/lib/ledger/index.ts';
import { chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import { saveMemberPlan } from '../src/lib/services/sv-members.ts';
import { sellPlan } from '../src/lib/services/sv-memberships.ts';
import { saveServiceSettings } from '../src/lib/services/sv-settings.ts';
import { deferralFor, deferralLines, monthEnd, packageDeferral, PACKAGE_CLASS, postPackageDeferral } from '../src/lib/services/sv-deferral.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const mem = (id: string, over: Partial<Membership> = {}): Membership => ({ id, number: `MEM/${id}`, client_name: id, plan: { id: 'p', name: '6 facials', kind: 'package', sessions: 6, price: 6000 } as Membership['plan'], start: '2026-04-01', end: '2026-09-30', invoice_ids: [`s-${id}`], created_at: '', ...over });
const bill = (id: string, date: string, items: unknown[] = []): InvoiceRecord => ({ id, issue_date: date, status: 'Sent', doc_type: 'TAX_INVOICE', items } as unknown as InvoiceRecord);
const redeem = (mid: string, qty = 1) => ({ id: `r${mid}${qty}`, quantity: qty, sv: { redeem: { membership_id: mid, session_no: 1 } } });

test('the month: sold deferred, sessions / expired / cancelled recognised; before the switch untouched', () => {
  const ms = [
    mem('a'), // sold in April, 2 sessions in May (bill) + 1 by check-in
    mem('b', { end: '2026-05-20' }), // expires in May with 5 unused
    mem('c', { closed: 'cancelled', history: [{ date: '2026-05-10', kind: 'cancel', note: '' }] }), // 6 unused at cancel
    mem('old'), // sold before the switch
  ];
  const inv = [bill('s-a', '2026-04-05'), bill('s-b', '2026-04-06'), bill('s-c', '2026-04-07'), bill('s-old', '2026-03-20'),
    bill('x', '2026-05-12', [redeem('a', 2), redeem('b'), redeem('old')]), bill('d', '2026-05-13', [redeem('a')])];
  (inv[5] as { status: string }).status = 'Draft';
  const ck: CheckinDay[] = [{ id: 'k', date: '2026-05-14', entries: [{ name: 'a', time: '10:00', membership_id: 'a', redeem: true }] } as CheckinDay];
  const apr = packageDeferral(ms, inv, ck, '2026-04', '2026-04-01', '2026-06-15');
  assert.deepEqual([apr.deferred, apr.recognised, apr.net], [18000, 0, 18000], 'three packages sold from the switch day');
  const may = packageDeferral(ms, inv, ck, '2026-05', '2026-04-01', '2026-06-15');
  assert.deepEqual([may.deferred, may.redeemed, may.forfeited, may.closed], [0, 4000, 5000, 6000], 'a: 3 x 1000, b: 1 x 1000 + 5 unused expired, c: 6 unused; the draft bill and the old package left out');
  assert.equal(may.net, -15000);
  assert.deepEqual(deferralLines(-15000, { sales: 'sales', deferred: 'dfr' }), [{ account_id: 'dfr', dr: 1500000, cr: 0 }, { account_id: 'sales', dr: 0, cr: 1500000 }]);
  assert.equal(monthEnd('2026-02'), '2026-02-28');
});

test('one balanced journal per ended month; off = nothing; posted once', () => {
  const p = saveMemberPlan({ name: '6 facials', kind: 'package', sessions: 6, validity_days: 180, covers: ['Facial'], price: 9000, cls: 'beauty_9997' });
  assert.equal(deferralFor('2026-05', '2026-06-10'), null, 'the switch is off by default');
  assert.throws(() => postPackageDeferral('2026-05', '2026-06-10'), /switch it on/);
  saveServiceSettings({ defer_package_income: true, defer_package_from: '2026-05-01' });
  sellPlan({ plan_id: p.id, client_name: 'Asha', start: '2026-05-04' });
  assert.throws(() => postPackageDeferral('2026-06', '2026-06-10'), /ended/);
  const v = postPackageDeferral('2026-05', '2026-06-10');
  assert.equal(v.voucher_class, PACKAGE_CLASS);
  assert.equal(v.date, '2026-05-31');
  const name = (id: string) => chartOf(loadUserAccounts()).find((a) => a.id === id)?.name;
  assert.deepEqual(v.lines.map((l) => [name(l.account_id), l.dr, l.cr]), [['Sales', 900000, 0], ['Package income received in advance', 0, 900000]]);
  assert.throws(() => postPackageDeferral('2026-05', '2026-06-10'), /already posted/);
  assert.equal(loadVouchers().length, 1);
});
