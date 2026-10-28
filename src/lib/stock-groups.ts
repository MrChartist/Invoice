/**
 * Stock groups and stock categories (WP-8, P1-10 — Tally's "Stock Group" and "Stock Category").
 *
 * Two independent trees over stock items: a group is *what* the item is (Electronics → Phones), a
 * category is a second, cross-cutting classification (Brand A, Premium). Both nest without limit
 * (`parent_id`), are masters (`master.edit`), and are pointed at by `StockItem.group_id` /
 * `category_id` (absent = "Primary" / "Not categorised"). Tables `stock_groups`, `stock_categories`.
 * Group-wise stock summary: `groupWiseSummary` in stock-reports.ts.
 *
 * Pure above the "Storage" divider.
 */

import { requireAccess } from './access';
import { audit } from './audit';
import { generateId, getTable, setTable } from './storage';
import type { StockItem } from './inventory';

export const STOCK_GROUPS_TABLE = 'stock_groups';
export const STOCK_CATEGORIES_TABLE = 'stock_categories';

/** A node of either tree. */
export interface StockTreeNode {
  id: string;
  name: string;
  /** Parent node id; absent = top level (under "Primary"). */
  parent_id?: string;
  created_at?: string;
  updated_at?: string;
}
export type StockGroup = StockTreeNode;
export type StockCategory = StockTreeNode;
export type TreeKind = 'group' | 'category';

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/* ── Pure ─────────────────────────────────────────────────────── */

export interface TreeRow {
  node: StockTreeNode;
  depth: number;
  /** "Electronics / Phones". */
  path: string;
}

/** Depth-first rows, siblings by name; orphans (a missing parent) are shown at the top level. */
export function treeRows(list: readonly StockTreeNode[]): TreeRow[] {
  const ids = new Set(list.map((n) => n.id));
  const children = new Map<string, StockTreeNode[]>();
  for (const n of list) {
    const p = n.parent_id && ids.has(n.parent_id) && n.parent_id !== n.id ? n.parent_id : '';
    children.set(p, [...(children.get(p) ?? []), n]);
  }
  const out: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string, depth: number, prefix: string) => {
    for (const n of [...(children.get(parent) ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      if (seen.has(n.id)) continue; // a stored cycle never loops
      seen.add(n.id);
      const path = prefix ? `${prefix} / ${n.name}` : n.name;
      out.push({ node: n, depth, path });
      walk(n.id, depth + 1, path);
    }
  };
  walk('', 0, '');
  // Nodes caught in a stored cycle (no root) still appear.
  for (const n of list) if (!seen.has(n.id)) out.push({ node: n, depth: 0, path: n.name });
  return out;
}

/** The node and every node below it. */
export function descendantIds(id: string, list: readonly StockTreeNode[]): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of list) {
      if (n.parent_id && out.has(n.parent_id) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}

/** "Electronics / Phones", or '' when the id is unknown. */
export function pathOf(id: string | undefined, list: readonly StockTreeNode[]): string {
  if (!id) return '';
  return treeRows(list).find((r) => r.node.id === id)?.path ?? '';
}

/** Why a node cannot be saved, or ''. Names are unique within a tree (case-insensitive). */
export function validateNode(input: Pick<StockTreeNode, 'id' | 'name' | 'parent_id'>, list: readonly StockTreeNode[], kind: TreeKind): string {
  const name = input.name.trim();
  const what = kind === 'group' ? 'group' : 'category';
  if (!name) return `Enter the ${what} name.`;
  if (list.some((n) => n.id !== input.id && norm(n.name) === norm(name))) return `A stock ${what} named "${name}" already exists.`;
  if (input.parent_id) {
    if (!list.some((n) => n.id === input.parent_id)) return `The parent ${what} no longer exists.`;
    if (input.id && descendantIds(input.id, list).has(input.parent_id)) return `A ${what} cannot be placed under itself or one of its sub-${what === 'group' ? 'groups' : 'categories'}.`;
  }
  return '';
}

/** What still points at a node: sub-nodes and stock items. */
export function nodeReferences(id: string, list: readonly StockTreeNode[], items: readonly Pick<StockItem, 'group_id' | 'category_id'>[], kind: TreeKind): string[] {
  const out: string[] = [];
  const subs = list.filter((n) => n.parent_id === id).length;
  const subWord = kind === 'group' ? (subs === 1 ? 'sub-group' : 'sub-groups') : subs === 1 ? 'sub-category' : 'sub-categories';
  if (subs) out.push(`${subs} ${subWord}`);
  const field = kind === 'group' ? 'group_id' : 'category_id';
  const used = items.filter((i) => i[field] === id).length;
  if (used) out.push(`${used} stock item${used === 1 ? '' : 's'}`);
  return out;
}

/** Items in a node or anywhere below it (`id` '' = items with no node). */
export function itemsUnder<T extends Pick<StockItem, 'group_id' | 'category_id'>>(id: string, list: readonly StockTreeNode[], items: readonly T[], kind: TreeKind): T[] {
  const field = kind === 'group' ? 'group_id' : 'category_id';
  const known = new Set(list.map((n) => n.id));
  if (!id) return items.filter((i) => !i[field] || !known.has(i[field] as string));
  const ids = descendantIds(id, list);
  return items.filter((i) => !!i[field] && ids.has(i[field] as string));
}

/* ── Storage ──────────────────────────────────────────────────── */

const now = () => new Date().toISOString();

function makeTreeDb(table: string, kind: TreeKind) {
  const label = kind === 'group' ? 'Stock group' : 'Stock category';
  const db = {
    all: (): StockTreeNode[] => getTable<StockTreeNode>(table).filter((n) => n && typeof n.id === 'string' && n.name?.trim()),
    save(input: { id?: string; name: string; parent_id?: string }): StockTreeNode {
      requireAccess('master.edit');
      const rows = db.all();
      const existing = input.id ? rows.find((n) => n.id === input.id) : undefined;
      const problem = validateNode({ id: existing?.id ?? '', name: input.name, parent_id: input.parent_id || undefined }, rows, kind);
      if (problem) throw new Error(problem);
      const row: StockTreeNode = {
        id: existing?.id ?? generateId(), name: input.name.trim(),
        ...(input.parent_id ? { parent_id: input.parent_id } : {}),
        ...(existing?.min_margin_percent ? { min_margin_percent: existing.min_margin_percent } : {}), // TR-A1 keeps the floor
        created_at: existing?.created_at ?? now(), updated_at: now(),
      };
      setTable(table, existing ? rows.map((n) => (n.id === row.id ? row : n)) : [...rows, row]);
      try {
        audit.record({ entity: 'item', entity_id: row.id, action: existing ? 'update' : 'create', summary: `${label} "${row.name}" ${existing ? 'edited' : 'added'}${row.parent_id ? ` under "${pathOf(row.parent_id, rows)}"` : ''}` });
      } catch {
        /* logging never breaks a save */
      }
      return row;
    },
    /** TR-A1: set (or clear with 0) a group's minimum margin %. */
    setMinMargin(id: string, pct: number): void {
      requireAccess('master.edit');
      setTable(table, db.all().map((n) => (n.id !== id ? n : pct > 0 ? { ...n, min_margin_percent: Math.min(pct, 100), updated_at: now() } : { ...n, min_margin_percent: undefined, updated_at: now() })));
    },
    /** Refused while sub-nodes or stock items point at it. */
    remove(id: string, items: readonly Pick<StockItem, 'group_id' | 'category_id'>[]): void {
      requireAccess('master.edit');
      const rows = db.all();
      const row = rows.find((n) => n.id === id);
      if (!row) return;
      const refs = nodeReferences(id, rows, items, kind);
      if (refs.length) throw new Error(`"${row.name}" still has ${refs.join(' and ')}, so it cannot be deleted.`);
      setTable(table, rows.filter((n) => n.id !== id));
      try {
        audit.record({ entity: 'item', entity_id: id, action: 'delete', summary: `${label} "${row.name}" deleted` });
      } catch {
        /* logging never breaks a delete */
      }
    },
  };
  return db;
}

export const stockGroupsDb = makeTreeDb(STOCK_GROUPS_TABLE, 'group');
export const stockCategoriesDb = makeTreeDb(STOCK_CATEGORIES_TABLE, 'category');
