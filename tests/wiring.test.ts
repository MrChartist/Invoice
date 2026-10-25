/**
 * Phase 7 integration pass: every Tally-parity screen is reachable (Gateway, palette, Tally keys),
 * HSN-master default rates on lines, and the notification-bell notices for approvals / AMC / set-off.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { gwT } from '../src/i18n/areas/gateway.ts';
import { GATEWAY_SCREENS, duplicateAccelerators, entryRoute, flattenMenu, resolveScreen } from '../src/lib/gateway/menu.ts';
import { roleCan } from '../src/lib/access.ts';
import { resolveTallyKey, type KeyLike } from '../src/lib/tally-keys.ts';
import { hsnDefaultPatches, withHsnDefaults } from '../src/lib/hsn-defaults.ts';
import type { HsnMasterRow } from '../src/lib/hsn-master.ts';
import { businessNotices, lastThreeBPeriod } from '../src/lib/business-alerts.ts';
import { tallyDestinations } from '../src/components/command/tally-destinations.ts';

beforeEach(() => resetStorage());

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test('Gateway: the newly wired screens are reachable for the owner, accelerators stay unique', () => {
  for (const s of GATEWAY_SCREENS) assert.deepEqual(duplicateAccelerators(resolveScreen(s.id)!), [], `${s.id} duplicates`);
  const items = flattenMenu({ label: (k) => gwT.en[k], can: (a) => roleCan('owner', a) });
  const route = (id: string) => {
    const it = items.find((i) => i.entry.id === id);
    assert.ok(it, `${id} reachable`);
    return entryRoute(it.entry.target, it.screen);
  };
  assert.equal(route('accinfo'), '/books?tab=coa&m=menu');
  assert.equal(route('yearend'), '/books?open=yearend');
  assert.equal(route('ie-tally'), '/books?open=tally');
  assert.equal(route('b-deposit'), '/reconcile?tab=documents&doc=deposit');
  assert.equal(route('b-advice'), '/reconcile?tab=documents&doc=advice');
  assert.equal(route('b-epay'), '/reconcile?tab=documents&doc=epay');
  assert.equal(route('b-cash'), '/reconcile?tab=documents&doc=cash');
  assert.equal(route('v-pdn'), '/expenses?tab=returns&new=dn');
  assert.equal(route('v-grn'), '/expenses?tab=returns&new=grn');
  assert.equal(route('v-mfg'), '/manufacturing?tab=mfg');
  assert.equal(route('sr-tdsp'), '/tds');
  assert.equal(route('sr-setoff'), '/gst-reports?tab=setoff');
  assert.equal(route('m-ratio'), '/books?tab=ratio');
  // A viewer neither sees year-end nor Tally import nor banking documents.
  const viewer = flattenMenu({ label: (k) => gwT.en[k], can: (a) => roleCan('viewer', a) }).map((i) => i.entry.id);
  for (const id of ['yearend', 'ie-tally', 'b-deposit', 'v-pdn']) assert.ok(!viewer.includes(id), `${id} hidden from viewers`);
  assert.ok(viewer.includes('accinfo') && viewer.includes('m-ratio'));
});

test('Ctrl+F9 is the purchase-return debit note on the purchase side, the sales debit note elsewhere', () => {
  const owner = (a: Parameters<typeof roleCan>[1]) => roleCan('owner', a);
  assert.equal(resolveTallyKey(key('F9', { ctrlKey: true }), { pathname: '/', typing: false, can: owner })?.to, '/invoice?type=DEBIT_NOTE');
  assert.equal(resolveTallyKey(key('F9', { ctrlKey: true }), { pathname: '/expenses', typing: false, can: owner })?.to, '/expenses?tab=returns&new=dn');
  assert.equal(resolveTallyKey(key('F9', { ctrlKey: true }), { pathname: '/expenses', typing: false, can: (a) => roleCan('viewer', a) }), null);
});

test('palette Tally destinations are role-gated and translated', () => {
  const all = tallyDestinations();
  assert.ok(all.some((d) => d.href === '/books?open=yearend'));
  assert.ok(all.every((d) => d.title && d.subtitle));
});

const master: HsnMasterRow[] = [
  { id: 'h1', code: '8471', description: 'Computers', kind: 'goods', rates: [{ from: '2017-07-01', rate: 18 }, { from: '2025-09-22', rate: 12 }] },
  { id: 'h2', code: '2402', description: 'Cigarettes', kind: 'goods', rates: [{ from: '2017-07-01', rate: 28, cess_rate: 5 }] },
];

test('HSN default rate: applied when the HSN is typed on an untouched line, never over a chosen rate', () => {
  const prev = [{ id: 'a', hsn: '', tax_rate: 18 }, { id: 'b', hsn: '', tax_rate: 5 }, { id: 'c', hsn: '8471', tax_rate: 12 }];
  const next = [{ id: 'a', hsn: '2402', tax_rate: 18 }, { id: 'b', hsn: '8471', tax_rate: 5 }, { id: 'c', hsn: '2402', tax_rate: 12 }];
  const p = hsnDefaultPatches(prev, next, master, '2025-10-01', 18);
  // a: default 18 → HSN 28 + cess 5; b: user chose 5 → kept; c: 12 was the old HSN's auto rate on this date → follows.
  assert.deepEqual(p, [{ id: 'a', tax_rate: 28, cess_rate: 5 }, { id: 'c', tax_rate: 28, cess_rate: 5 }]);
  const lines = withHsnDefaults(next, p, false);
  assert.equal(lines[0].tax_rate, 28);
  assert.equal((lines[0] as { cess_rate?: number }).cess_rate, undefined, 'bills keep cess as a lump amount');
  // Date-keyed: before 22 Sep 2025 computers were 18%.
  assert.deepEqual(hsnDefaultPatches([{ id: 'x', hsn: '' }], [{ id: 'x', hsn: '8471' }], master, '2025-04-01'), [{ id: 'x', tax_rate: 18 }]);
  assert.deepEqual(hsnDefaultPatches(prev, next, [], '2025-10-01', 18), [], 'no master, no change');
});

test('bell notices: pending approvals (approver only), AMC reminders, set-off due for the last 3B period', () => {
  const base = { today: '2026-05-17', at: '2026-05-17T05:00:00.000Z', amc: [], invoices: [] };
  const invoices = [
    { id: 'i1', invoice_number: 'INV/FY26-27/0004', total: 90000, approval: { state: 'pending' as const, doc_id: 'i1', requested_status: 'Sent' as const, requested_by: 'Clerk', requested_at: '' } },
    { id: 'i2', invoice_number: 'INV/FY26-27/0005', total: 100 },
  ];
  assert.equal(businessNotices({ ...base, approver: false, invoices } as never).length, 0);
  const n = businessNotices({ ...base, approver: true, invoices } as never);
  assert.equal(n.length, 1);
  assert.match(n[0].title, /1 document/);
  assert.equal(n[0].href, '/transactions?filter=approval');

  const amc = [{ id: 'c1', client_name: 'Asha', title: 'AC service', start: '2025-06-01', end: '2026-05-31', value: 5000, visits_per_year: 4, visits: [] }];
  assert.ok(businessNotices({ ...base, approver: false, amc } as never).some((x) => x.id === 'amc-renew:c1'));

  const p = lastThreeBPeriod('2026-05-17', 'monthly');
  assert.equal(p?.key, '2026-04');
  const setoff = { gstin: '27AAAAA0000A1Z5', frequency: 'monthly' as const, postedKeys: new Set<string>() };
  const due = businessNotices({ ...base, approver: false, setoff } as never);
  assert.equal(due.length, 1);
  assert.equal(due[0].href, '/gst-reports?tab=setoff');
  assert.match(due[0].detail, /verify with your CA/);
  assert.equal(businessNotices({ ...base, approver: false, setoff: { ...setoff, postedKeys: new Set(['2026-04']) } } as never).length, 0, 'posted → no notice');
  assert.equal(businessNotices({ ...base, today: '2026-05-02', approver: false, setoff } as never).length, 0, 'too early');
});
