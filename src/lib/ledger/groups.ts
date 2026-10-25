/**
 * Groups & sub-groups (WP-1, Tally "Accounts Info → Groups"): user-defined groups nested under
 * the 24 fixed Schedule III primaries, plus the read APIs other packages consume:
 *
 *   groupTree()            primaries with their user sub-groups, nested
 *   ledgersInGroup(id)     every ledger (chart account or party) in a group, optionally recursive
 *   groupDescendants(id)   the group and every sub-group below it
 *
 * Nature (asset / liability / income / expense), the Schedule III head and "affects gross
 * profit" are inherited from the primary, as in Tally. Accounts keep their primary in
 * `Account.group` and the sub-group in `Account.under`; clients / vendors name their sub-group
 * in `group_id`. Storage: table `groups` (`GROUPS_TABLE`), role action `master.edit`.
 *
 * Pure except the load / save / delete helpers (getTable/setTable, fail-soft in Node).
 */

import type { Client } from '../../types/invoice';
import type { Vendor } from '../../types/purchases';
import { requireAccess } from '../access';
import { audit } from '../audit';
import { generateId, getTable, setTable } from '../storage';
import {
  A,
  GROUPS,
  GROUPS_TABLE,
  allGroups,
  chartOf,
  groupOf,
  immediateGroupOf,
  isGroupId,
  loadUserAccounts,
  loadUserGroups,
  normalizeUserGroups,
  primaryOf,
  type Account,
  type GroupDef,
  type GroupId,
  type PrimaryGroupId,
  type UserGroup,
} from './accounts';

/* ── Tree ──────────────────────────────────────────────────────── */

export interface GroupNode {
  group: GroupDef;
  children: GroupNode[];
}

/** The 24 primaries in Schedule III order, each with its user sub-groups nested (by name). */
export function groupTree(userGroups: readonly UserGroup[] = loadUserGroups()): GroupNode[] {
  const defs = allGroups(userGroups);
  const nodes = new Map<string, GroupNode>(defs.map((g) => [g.id, { group: g, children: [] }]));
  const roots: GroupNode[] = [];
  for (const g of defs) {
    const node = nodes.get(g.id)!;
    const parent = g.parent ? nodes.get(g.parent) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** `id` and every user group below it. */
export function groupDescendants(id: GroupId, userGroups: readonly UserGroup[] = loadUserGroups()): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const g of userGroups) if (g.parent === out[i] && !out.includes(g.id)) out.push(g.id);
  return out;
}

/** Breadcrumb from the primary down to `id` (labels), e.g. ["Sundry debtors (trade receivables)", "Debtors – Mumbai"]. */
export function groupPath(id: GroupId, userGroups: readonly UserGroup[] = loadUserGroups()): string[] {
  const out: string[] = [];
  let cur: string | undefined = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const def = groupOf(cur, userGroups);
    out.unshift(def.label);
    if (isGroupId(cur)) break;
    cur = userGroups.find((g) => g.id === cur)?.parent;
  }
  return out;
}

/* ── Party ledgers ─────────────────────────────────────────────── */

export type PartySide = 'debtor' | 'creditor';

/** Ledger id of a party: `party:debtor:<clientId>` / `party:creditor:<vendorId>`. */
export function partyLedgerId(side: PartySide, id: string): string {
  return `party:${side}:${id}`;
}

export function parsePartyLedgerId(ledgerId: string): { side: PartySide; id: string } | null {
  const m = /^party:(debtor|creditor):(.+)$/.exec(ledgerId);
  return m ? { side: m[1] as PartySide, id: m[2] } : null;
}

/** The party name the automatic postings use (same as `books.partyOfInvoice` for a client snapshot). */
export function clientPartyName(c: Pick<Client, 'name' | 'company'>): string {
  return (c.company ?? '').trim() || (c.name ?? '').trim();
}

/** A client's group: its `group_id` when that resolves under Sundry Debtors, else the primary. */
export function partyGroupOf(side: PartySide, groupId: string | undefined, userGroups: readonly UserGroup[]): GroupId {
  const primary: PrimaryGroupId = side === 'debtor' ? 'TRADE_RECEIVABLES' : 'TRADE_PAYABLES';
  return groupId && primaryOf(groupId, userGroups) === primary ? groupId : primary;
}

/* ── Ledgers in a group ────────────────────────────────────────── */

export interface MasterLedger {
  /** Account id, or a party ledger id (`partyLedgerId`). */
  id: string;
  kind: 'account' | 'party';
  name: string;
  /** Account the postings use (the party's control account for a party). */
  account: string;
  /** Party sub-key on the control account (postings' `party`). */
  party?: string;
  /** Client / vendor id of a party. */
  partyId?: string;
  side?: PartySide;
  /** The group it is shown under (sub-group or primary). */
  group: GroupId;
  primary: PrimaryGroupId;
  code?: string;
  system?: boolean;
}

export interface MastersSnapshot {
  userGroups: readonly UserGroup[];
  /** The whole chart (defaults + user accounts). */
  accounts: readonly Account[];
  clients: readonly Client[];
  vendors: readonly Vendor[];
}

/** Read everything the masters screens need from storage (fail-soft). */
export function loadMasters(): MastersSnapshot {
  return {
    userGroups: loadUserGroups(),
    accounts: chartOf(loadUserAccounts()),
    clients: getTable<Client>('clients'),
    vendors: getTable<Vendor>('vendors'),
  };
}

/** Every ledger: chart accounts, then clients (Sundry Debtors) and vendors (Sundry Creditors). */
export function allLedgers(m: MastersSnapshot): MasterLedger[] {
  const out: MasterLedger[] = m.accounts.map((a) => ({
    id: a.id,
    kind: 'account',
    name: a.name,
    account: a.id,
    group: a.under && primaryOf(a.under, m.userGroups) === a.group ? a.under : a.group,
    primary: a.group,
    code: a.code,
    ...(a.system ? { system: true } : {}),
  }));
  for (const c of m.clients) {
    if (!c?.id) continue;
    const name = clientPartyName(c);
    if (!name) continue;
    out.push({ id: partyLedgerId('debtor', c.id), kind: 'party', name, account: A.debtors, party: name, partyId: c.id, side: 'debtor', group: partyGroupOf('debtor', c.group_id, m.userGroups), primary: 'TRADE_RECEIVABLES' });
  }
  for (const v of m.vendors) {
    if (!v?.id || !(v.name ?? '').trim()) continue;
    const name = v.name.trim();
    out.push({ id: partyLedgerId('creditor', v.id), kind: 'party', name, account: A.creditors, party: name, partyId: v.id, side: 'creditor', group: partyGroupOf('creditor', v.group_id, m.userGroups), primary: 'TRADE_PAYABLES' });
  }
  return out;
}

/**
 * Ledgers in `groupId` (recursive by default: sub-groups included). Party ledgers appear under
 * Sundry Debtors / Creditors or their sub-group. WP-2 (group summary) reads balances per ledger
 * with `account` + `party`.
 */
export function ledgersInGroup(groupId: GroupId, m: MastersSnapshot = loadMasters(), opts: { recursive?: boolean } = {}): MasterLedger[] {
  const ids = new Set(opts.recursive === false ? [groupId] : groupDescendants(groupId, m.userGroups));
  return allLedgers(m).filter((l) => ids.has(l.group));
}

/** Find one ledger (account or party) by id. */
export function findLedger(id: string, m: MastersSnapshot = loadMasters()): MasterLedger | undefined {
  return allLedgers(m).find((l) => l.id === id);
}

/* ── Create / alter / delete ───────────────────────────────────── */

export class GroupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupError';
  }
}

export interface GroupInput {
  id?: string;
  name: string;
  alias?: string;
  /** Parent: a primary id or a user group id. */
  parent: GroupId;
  subledger?: boolean;
  net_balances?: boolean;
}

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Problems with a new / altered group (empty list = fine). */
export function validateGroup(input: GroupInput, userGroups: readonly UserGroup[]): string[] {
  const errors: string[] = [];
  const name = clean(input.name);
  if (!name) errors.push('Enter a group name.');
  else if (name.length > 60) errors.push('Group names are up to 60 characters.');
  if (!primaryOf(input.parent, userGroups)) errors.push('Choose the group it comes under.');
  if (input.id) {
    if (isGroupId(input.id)) errors.push('Primary groups cannot be altered.');
    else if (groupDescendants(input.id, userGroups).includes(input.parent)) errors.push('A group cannot come under itself or one of its own sub-groups.');
  }
  const lower = name.toLowerCase();
  if (name && (GROUPS.some((g) => g.label.toLowerCase() === lower) || userGroups.some((g) => g.id !== input.id && g.name.toLowerCase() === lower))) {
    errors.push(`A group called “${name}” already exists.`);
  }
  return errors;
}

/** Create or alter a user group (Tally "Group Creation / Alteration"). Audited. */
export function saveUserGroup(input: GroupInput): UserGroup {
  requireAccess('master.edit');
  const rows = loadUserGroups();
  const errors = validateGroup(input, rows);
  if (errors.length) throw new GroupError(errors[0]);
  const prev = input.id ? rows.find((g) => g.id === input.id) : undefined;
  if (input.id && !prev) throw new GroupError('That group no longer exists.');
  const now = new Date().toISOString();
  const alias = clean(input.alias);
  const row: UserGroup = {
    id: prev?.id ?? generateId(),
    name: clean(input.name),
    parent: input.parent,
    ...(alias ? { alias } : {}),
    ...(input.subledger ? { subledger: true } : {}),
    ...(input.net_balances ? { net_balances: true } : {}),
    created_at: prev?.created_at ?? now,
    ...(prev ? { updated_at: now } : {}),
  };
  const next = prev ? rows.map((g) => (g.id === row.id ? row : g)) : [...rows, row];
  if (normalizeUserGroups(next).length !== next.length) throw new GroupError('That change would break the group tree.');
  setTable(GROUPS_TABLE, next);
  const under = groupOf(row.parent, next).label;
  audit.record({
    entity: 'account',
    entity_id: row.id,
    action: prev ? 'update' : 'create',
    doc_number: row.name,
    summary: prev ? `Group “${row.name}” altered (under ${under})` : `Group “${row.name}” created under ${under}`,
  });
  return row;
}

/** Why a group cannot be deleted ('' = it can): sub-groups, ledgers or parties in it. */
export function groupInUse(id: string, m: MastersSnapshot): string {
  if (m.userGroups.some((g) => g.parent === id)) return 'It has sub-groups. Move or delete them first.';
  if (m.accounts.some((a) => immediateGroupOf(a) === id)) return 'Ledgers are placed in it. Move them first.';
  if (m.clients.some((c) => c.group_id === id) || m.vendors.some((v) => v.group_id === id)) return 'Parties are placed in it. Move them first.';
  return '';
}

/** Delete an empty user group. Audited. */
export function deleteUserGroup(id: string, m: MastersSnapshot = loadMasters()): void {
  requireAccess('master.edit');
  const row = m.userGroups.find((g) => g.id === id);
  if (!row) throw new GroupError(isGroupId(id) ? 'Primary groups cannot be deleted.' : 'That group no longer exists.');
  const why = groupInUse(id, m);
  if (why) throw new GroupError(why);
  setTable(GROUPS_TABLE, loadUserGroups().filter((g) => g.id !== id));
  audit.record({ entity: 'account', entity_id: id, action: 'delete', doc_number: row.name, summary: `Group “${row.name}” deleted` });
}
