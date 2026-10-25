/**
 * WP-1 masters: user groups / sub-groups under the Schedule III primaries — nesting, nature and
 * gross-profit inheritance, ledgers in groups (accounts + parties), validation, roles, normalisers.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { setActorProvider, type Role } from '../src/lib/access.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import {
  A,
  GROUPS,
  allGroups,
  chartOf,
  deleteUserGroup,
  groupDescendants,
  groupOf,
  groupPath,
  groupTree,
  isGroupId,
  ledgersInGroup,
  loadMasters,
  loadUserAccounts,
  loadUserGroups,
  normalizeUserAccounts,
  normalizeUserGroups,
  partyLedgerId,
  primaryOf,
  providedAccounts,
  registerAccountProvider,
  saveUserAccount,
  saveUserGroup,
  validateGroup,
  type MastersSnapshot,
  type UserGroup,
} from '../src/lib/ledger/index.ts';

const as = (role: Role | null) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role }) : null);

beforeEach(() => resetStorage());
afterEach(() => as(null));

const G = (id: string, name: string, parent: string): UserGroup => ({ id, name, parent });

test('24 primaries keep their ids; GroupId is open to user group ids', () => {
  assert.equal(GROUPS.length, 24);
  assert.ok(GROUPS.every((g) => g.system && g.primary === g.id));
  assert.equal(isGroupId('TRADE_RECEIVABLES'), true);
  assert.equal(isGroupId('grp1'), false);
});

test('nesting: nature, head and "affects gross profit" are inherited from the primary at any depth', () => {
  const groups = [G('mum', 'Debtors – Mumbai', 'TRADE_RECEIVABLES'), G('andheri', 'Andheri', 'mum'), G('frt', 'Freight & cartage', 'DIRECT_EXPENSES')];
  const andheri = groupOf('andheri', groups);
  assert.equal(andheri.nature, 'asset');
  assert.equal(andheri.head, 'Current assets');
  assert.equal(andheri.primary, 'TRADE_RECEIVABLES');
  assert.equal(andheri.depth, 2);
  assert.equal(andheri.direct, undefined);
  assert.equal(groupOf('frt', groups).direct, true, 'a sub-group of Direct expenses affects gross profit');
  assert.equal(groupOf('frt', groups).nature, 'expense');
  assert.equal(primaryOf('andheri', groups), 'TRADE_RECEIVABLES');
  assert.deepEqual(groupDescendants('mum', groups), ['mum', 'andheri']);
  assert.deepEqual(groupPath('andheri', groups), ['Sundry debtors (trade receivables)', 'Debtors – Mumbai', 'Andheri']);
  // Unknown id without groups still falls back to the first primary (old behaviour).
  assert.equal(groupOf('nope').id, 'CAPITAL');
});

test('allGroups / groupTree: each user group right after its parent', () => {
  const groups = [G('b', 'B branch', 'TRADE_RECEIVABLES'), G('a', 'A branch', 'TRADE_RECEIVABLES'), G('a1', 'A1', 'a')];
  const ids = allGroups(groups).map((g) => g.id);
  const i = ids.indexOf('TRADE_RECEIVABLES');
  assert.deepEqual(ids.slice(i, i + 4), ['TRADE_RECEIVABLES', 'a', 'a1', 'b']);
  const tree = groupTree(groups);
  assert.equal(tree.length, 24);
  const tr = tree.find((n) => n.group.id === 'TRADE_RECEIVABLES')!;
  assert.deepEqual(tr.children.map((c) => c.group.id), ['a', 'b']);
  assert.deepEqual(tr.children[0].children.map((c) => c.group.id), ['a1']);
});

test('normalizeUserGroups drops cycles, orphans, duplicate names and is idempotent', () => {
  const rows = [
    G('x', 'X', 'y'),
    G('y', 'Y', 'x'), // cycle
    G('o', 'Orphan', 'missing'),
    G('ok', 'Mumbai', 'TRADE_RECEIVABLES'),
    G('dup', 'mumbai', 'TRADE_RECEIVABLES'), // same name
    G('kid', 'Kid', 'dup'), // child of a dropped row
    G('cap', 'Capital account', 'CAPITAL'), // clashes with a primary name
    { id: '', name: 'No id', parent: 'CAPITAL' },
  ];
  const once = normalizeUserGroups(rows as unknown[]);
  assert.deepEqual(once.map((g) => g.id), ['ok']);
  assert.deepEqual(normalizeUserGroups(once), once);
});

test('saveUserGroup validates, audits and refuses a parent loop; delete only when empty', () => {
  const mum = saveUserGroup({ name: 'Debtors – Mumbai', parent: 'TRADE_RECEIVABLES' });
  const sub = saveUserGroup({ name: 'Andheri', parent: mum.id });
  assert.throws(() => saveUserGroup({ id: mum.id, name: 'Debtors – Mumbai', parent: sub.id }), /under itself/);
  assert.throws(() => saveUserGroup({ name: 'debtors – mumbai', parent: 'TRADE_RECEIVABLES' }), /already exists/);
  assert.throws(() => saveUserGroup({ name: 'Bad', parent: 'NOPE' }), /comes under/);
  assert.deepEqual(validateGroup({ id: 'CAPITAL', name: 'X', parent: 'RESERVES' }, []), ['Primary groups cannot be altered.']);
  assert.throws(() => deleteUserGroup(mum.id), /sub-groups/);
  deleteUserGroup(sub.id);
  assert.deepEqual(loadUserGroups().map((g) => g.id), [mum.id]);
  assert.ok(getTable<{ summary: string }>('audit_log').some((e) => /Group “Andheri” created under Debtors – Mumbai/.test(e.summary)));
});

test('ledgers in a sub-group: Account.group stays the primary, `under` names the sub-group', () => {
  const g = saveUserGroup({ name: 'Loans to staff', parent: 'LOANS_ADV_ST' });
  const a = saveUserAccount({ code: '3610', name: 'Loan – Ravi', group: g.id });
  assert.equal(a.group, 'LOANS_ADV_ST');
  assert.equal(a.under, g.id);
  const stored = getTable<Record<string, unknown>>('accounts')[0];
  assert.equal(stored.group, 'LOANS_ADV_ST', 'stored rows keep a primary in `group` (older readers unaffected)');
  assert.throws(() => deleteUserGroup(g.id), /Ledgers are placed/);
  // Moving back to the primary clears `under`.
  const moved = saveUserAccount({ id: a.id, code: '3610', name: 'Loan – Ravi', group: 'LOANS_ADV_ST' });
  assert.equal(moved.under, undefined);
});

test('normalizeUserAccounts maps a row whose group is a user group id, drops dangling `under`, idempotent', () => {
  const groups = [G('g1', 'Staff loans', 'LOANS_ADV_ST')];
  const rows = [
    { id: 'a1', code: '1', name: 'Written by newer code', group: 'g1' },
    { id: 'a2', code: '2', name: 'Dangling', group: 'RENT', under: 'gone' },
    { id: 'a3', code: '3', name: 'Dangling sub', group: 'INDIRECT_EXPENSES', under: 'gone' },
    { id: 'a4', code: '4', name: 'Wrong primary', group: 'CAPITAL', under: 'g1' },
  ];
  const once = normalizeUserAccounts(rows, groups);
  assert.deepEqual(
    once.map((a) => [a.id, a.group, a.under ?? '']),
    [
      ['a1', 'LOANS_ADV_ST', 'g1'],
      ['a3', 'INDIRECT_EXPENSES', ''],
      ['a4', 'CAPITAL', ''],
    ],
  );
  assert.deepEqual(normalizeUserAccounts(once, groups), once);
});

test('ledgersInGroup lists accounts and parties (clients / vendors in their sub-groups), recursively', () => {
  const mum: UserGroup = G('mum', 'Mumbai', 'TRADE_RECEIVABLES');
  const m: MastersSnapshot = {
    userGroups: [mum],
    accounts: chartOf([]),
    clients: [
      { id: 'c1', name: 'Asha', company: 'Asha Traders', email: '', address: '', city: '', zip: '', group_id: 'mum' },
      { id: 'c2', name: 'Bala', email: '', address: '', city: '', zip: '' },
      { id: 'c3', name: 'Wrong', email: '', address: '', city: '', zip: '', group_id: 'NOT_A_GROUP' },
    ],
    vendors: [{ id: 'v1', name: 'Steel Co' }],
  };
  const inMum = ledgersInGroup('mum', m);
  assert.deepEqual(inMum.map((l) => [l.id, l.name, l.account, l.party]), [[partyLedgerId('debtor', 'c1'), 'Asha Traders', A.debtors, 'Asha Traders']]);
  const all = ledgersInGroup('TRADE_RECEIVABLES', m).map((l) => l.id);
  assert.deepEqual(all.sort(), [A.debtors, 'party:debtor:c1', 'party:debtor:c2', 'party:debtor:c3'].sort());
  const direct = ledgersInGroup('TRADE_RECEIVABLES', m, { recursive: false }).map((l) => l.id);
  assert.ok(!direct.includes('party:debtor:c1'));
  assert.deepEqual(ledgersInGroup('TRADE_PAYABLES', m).map((l) => l.id).sort(), [A.creditors, 'party:creditor:v1'].sort());
});

test('loadMasters reads groups, chart, clients and vendors; a party sub-group blocks delete', () => {
  const g = saveUserGroup({ name: 'Pune', parent: 'TRADE_RECEIVABLES' });
  setTable('clients', [{ id: 'c1', name: 'Asha', email: '', address: '', city: '', zip: '', group_id: g.id }]);
  const m = loadMasters();
  assert.equal(m.userGroups.length, 1);
  assert.equal(m.clients.length, 1);
  assert.throws(() => deleteUserGroup(g.id, m), /Parties are placed/);
});

test('roles: groups and ledgers are masters (viewer refused, clerk allowed)', () => {
  as('viewer');
  assert.throws(() => saveUserGroup({ name: 'X', parent: 'CAPITAL' }), /Viewer\) cannot/);
  assert.throws(() => setTable('groups', [{ id: 'g', name: 'G', parent: 'CAPITAL' }]), /cannot/);
  assert.throws(() => setTable('accounts', []), /cannot/);
  as('clerk');
  saveUserGroup({ name: 'X', parent: 'CAPITAL' });
  assert.equal(loadUserGroups().length, 1);
});

test('registerAccountProvider: synthesised ledgers join the chart, clashes and throwers are ignored', () => {
  const off = registerAccountProvider('test-banks', () => [
    { id: 'bank_hdfc', code: '3511', name: 'HDFC current', group: 'CASH_BANK' },
    { id: A.cash, code: 'X', name: 'Clash', group: 'CASH_BANK' },
  ]);
  const off2 = registerAccountProvider('broken', () => {
    throw new Error('boom');
  });
  try {
    assert.ok(providedAccounts().some((a) => a.id === 'bank_hdfc' && a.system));
    const ids = loadUserAccounts().map((a) => a.id);
    assert.ok(ids.includes('bank_hdfc'));
    assert.ok(!ids.includes(A.cash), 'a provided id that clashes with the chart is dropped');
    assert.equal(chartOf(loadUserAccounts()).filter((a) => a.id === A.cash).length, 1);
  } finally {
    off();
    off2();
  }
  assert.equal(providedAccounts().length, 0);
});
