/**
 * Group tree adapter for the reports engine (WP-2). Reports never read `GROUPS` directly: they ask
 * this module for the tree (WP-1's user sub-groups included); another tree can be registered with
 * `setGroupSource` — no report changes.
 *
 * Default tree: Tally-style headings (one per Schedule III head, ids `head:<slug>`) → the 24 fixed
 * primaries of `accounts.ts` → WP-1's user sub-groups (`allGroups(loadUserGroups())`, nested by
 * `parent`) → ledgers (an account sits in `immediateGroupOf(a)` = its `under` sub-group, else its
 * primary). Call `syncReportGroups()` before a report so a group added since the last one shows.
 *
 * Pure. Working papers — verify with your CA.
 */

import { GROUPS, allGroups, groupOf, immediateGroupOf, isGroupId, loadUserGroups, type Account, type AccountNature } from './accounts';

export interface ReportGroupNode {
  id: string;
  label: string;
  /** Parent group id; null for a primary group. */
  parent: string | null;
  nature: AccountNature;
  /** Feeds gross profit (Sales / Purchase accounts, Direct expenses / incomes). */
  direct?: boolean;
}

export interface GroupSource {
  /** Every group, parents before children, in display order. */
  nodes(): ReportGroupNode[];
  /** The group a ledger sits in (a leaf or any node of `nodes()`). */
  groupOfAccount(a: Account): string;
}

/** Tally names for the Schedule III headings used as primary groups. */
const HEAD_LABELS: Record<string, string> = {
  "Owner's funds": 'Capital account',
  'Non-current liabilities': 'Loans (liability)',
  'Current liabilities': 'Current liabilities',
  'Non-current assets': 'Fixed assets & investments',
  'Current assets': 'Current assets',
  Income: 'Income',
  Expenses: 'Expenses',
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const headId = (head: string) => `head:${slug(head)}`;

export const builtInGroupSource: GroupSource = {
  nodes() {
    const out: ReportGroupNode[] = [];
    const seen = new Set<string>();
    for (const g of GROUPS) {
      const hid = headId(g.head);
      if (!seen.has(hid)) {
        seen.add(hid);
        out.push({ id: hid, label: HEAD_LABELS[g.head] ?? g.head, parent: null, nature: g.nature });
      }
    }
    // Primaries and user sub-groups, parents first (allGroups is depth-first).
    for (const g of allGroups(loadUserGroups())) {
      out.push({ id: g.id, label: g.label, parent: g.parent ?? headId(g.head), nature: g.nature, direct: !!g.direct || g.id === 'SALES' });
    }
    return out;
  },
  groupOfAccount: (a) => immediateGroupOf(a),
};

let source: GroupSource = builtInGroupSource;

/** WP-1 (or the lead) registers the user-group tree here; `null` restores the built-in tree. */
export function setGroupSource(next: GroupSource | null): void {
  source = next ?? builtInGroupSource;
  cache = null;
}

/** Re-read the group tree (user groups may have changed since the last report). */
export function syncReportGroups(): void {
  cache = null;
}

let cache: { nodes: ReportGroupNode[]; byId: Map<string, ReportGroupNode>; kids: Map<string | null, ReportGroupNode[]> } | null = null;
function tree() {
  if (cache) return cache;
  const nodes = source.nodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string | null, ReportGroupNode[]>();
  for (const n of nodes) {
    const p = n.parent && byId.has(n.parent) ? n.parent : null;
    kids.set(p, [...(kids.get(p) ?? []), n]);
  }
  cache = { nodes, byId, kids };
  return cache;
}

export function reportGroups(): ReportGroupNode[] {
  return tree().nodes;
}

export function reportGroup(id: string): ReportGroupNode | undefined {
  return tree().byId.get(id);
}

export function childGroups(id: string | null): ReportGroupNode[] {
  return tree().kids.get(id) ?? [];
}

export function accountGroupId(a: Account): string {
  return source.groupOfAccount(a);
}

/** Primary groups first … the group itself: the breadcrumb path. */
export function reportGroupPath(id: string): ReportGroupNode[] {
  const out: ReportGroupNode[] = [];
  let n = reportGroup(id);
  let guard = 0;
  while (n && guard++ < 50) {
    out.unshift(n);
    n = n.parent ? reportGroup(n.parent) : undefined;
  }
  return out;
}

/** Is `id` the group or one of its descendants? */
export function isWithin(id: string, ancestor: string): boolean {
  return reportGroupPath(id).some((n) => n.id === ancestor);
}

/** Ledgers sitting directly in `groupId` (not in its sub-groups). */
export function ledgersDirectlyIn(accounts: readonly Account[], groupId: string): Account[] {
  return accounts.filter((a) => accountGroupId(a) === groupId);
}

/** Ledgers in `groupId` or any sub-group. */
export function reportLedgersInGroup(accounts: readonly Account[], groupId: string): Account[] {
  return accounts.filter((a) => isWithin(accountGroupId(a), groupId));
}

/** Direct (gross-profit) group? Falls back to the fixed group flags. */
export function isDirectGroup(id: string): boolean {
  const n = reportGroup(id);
  if (n) return !!n.direct || (n.parent ? isDirectGroup(n.parent) : false);
  return isGroupId(id) ? !!groupOf(id).direct || id === 'SALES' : false;
}

export function natureOfGroup(id: string): AccountNature | undefined {
  return reportGroup(id)?.nature ?? (isGroupId(id) ? groupOf(id).nature : undefined);
}

/** Balance-sheet side groups (asset / liability / equity) vs P&L (income / expense). */
export const isPnlNature = (n: AccountNature | undefined) => n === 'income' || n === 'expense';
