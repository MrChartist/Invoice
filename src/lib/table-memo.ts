/**
 * Version tokens and memoised derived results over the storage cache (PERF-1). Kept out of
 * `storage.ts` so the shell does not load it; the stock engine and the notification centre do.
 *
 * Stamps compare the stored strings themselves (an identity check on the in-memory store), so every
 * kind of change — `setTable`, `writeRaw`, restore, another tab, a company reset — is seen without
 * any invalidation call.
 */
import { ASSET_TABLE, SNAPSHOT_TABLES } from './assets';
import { DB_PREFIX, freezeShared, readRaw, setReadTrace } from './storage';

/* Version tokens: a per-key counter that moves whenever the stored text of the key changes. */
const stampSeen = new Map<string, { raw: string | null; v: number }>();
let stampSeq = 0;

function keyStamp(fullKey: string): number {
  const raw = readRaw(fullKey);
  const seen = stampSeen.get(fullKey);
  if (seen && seen.raw === raw) return seen.v;
  const v = ++stampSeq;
  stampSeen.set(fullKey, { raw, v });
  return v;
}

/**
 * Cheap version token of one or more tables (or singleton keys such as `settings`): equal tokens
 * mean the stored text of every named key (and of the asset table, for snapshot tables) is unchanged.
 * Sees every kind of change — `setTable`, `writeRaw`, restore, another tab — because it compares the
 * stored strings themselves (an identity check on the in-memory store).
 */
export function tableStamp(...names: string[]): string {
  let out = '';
  for (const n of names) {
    out += `${keyStamp(DB_PREFIX + n)}`;
    if (SNAPSHOT_TABLES.has(n)) out += `.${keyStamp(DB_PREFIX + ASSET_TABLE)}`;
    out += ',';
  }
  return out;
}

const memo = new Map<string, { stamp: string; value: unknown }>();

/**
 * Memoise a derived result on the tables it reads: `fn` runs again only when `tableStamp(...tables)`
 * or `extra` (anything else the result depends on: a day, a setting, an argument) changed. The
 * result is shared between callers, so treat it as read-only (deep-frozen in dev builds and tests).
 * `fn` must read nothing but those tables and what `extra` encodes.
 */
export function memoOnTables<T>(id: string, tables: readonly string[], fn: () => T, extra = ''): T {
  const stamp = `${tableStamp(...tables)}|${extra}`;
  const hit = memo.get(id);
  if (hit && hit.stamp === stamp) return hit.value as T;
  const value = freezeShared(fn());
  memo.set(id, { stamp, value });
  return value;
}

const readMemo = new Map<string, { extra: string; deps: [string, number][]; value: unknown }>();

/**
 * Memoise a derived result on whatever stored keys it reads: `fn` runs again only when the stored
 * text of a key it read last time changed (any write path, another tab, a restore) or `extra`
 * changed. Nothing to list by hand, so a table a reader starts using later is tracked too. `fn` must
 * get everything else it depends on (a date, an argument, the signed-in user) from `extra`, and read
 * stored data only through `storage.ts`. The result is shared: read-only (deep-frozen in dev / tests).
 * Nested memos report their keys to the outer one, hit or miss.
 */
export function memoOnReads<T>(id: string, fn: () => T, extra = ''): T {
  const hit = readMemo.get(id);
  if (hit && hit.extra === extra && hit.deps.every(([k, v]) => keyStamp(k) === v)) {
    const outer = setReadTrace(null);
    setReadTrace(outer);
    if (outer) for (const [k] of hit.deps) outer.add(k);
    return hit.value as T;
  }
  const trace = new Set<string>();
  const outer = setReadTrace(trace);
  let value: T;
  try {
    value = fn();
  } finally {
    setReadTrace(outer);
  }
  if (outer) for (const k of trace) outer.add(k);
  readMemo.set(id, { extra, deps: [...trace].map((k) => [k, keyStamp(k)]), value: freezeShared(value) });
  return value;
}

/** Forget every memoised result (company switch, tests). */
export function clearTableMemos(): void {
  memo.clear();
  readMemo.clear();
}
