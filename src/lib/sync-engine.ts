/**
 * Folder sync (roadmap 5.7): change detection, merge and conflict handling. Loaded on demand only.
 *
 * Model (docs/features/sync.md):
 *  - Change detection happens at sync time, not on every write: each row's content hash is compared
 *    with the hash recorded at the last sync (`sync_state`). Nothing is added to the save path, so the
 *    5,000-row performance caps are untouched and every writer (localDb, purchases, imports, restore…)
 *    is covered without wiring.
 *  - Every row / singleton version carries a version vector (`vv`: device id → that device's Lamport
 *    counter when it made the change). Merge compares vectors, never wall clocks: remote dominates →
 *    take it; local dominates → keep; neither → concurrent → CONFLICT (rows: keep local, store remote;
 *    singletons: last writer by Lamport time wins, the other version is listed). Tombstones are rows
 *    too, so a delete wins only when it causally follows the other side's last edit.
 *  - Rows are matched by table + id. Each device writes only its own snapshot file, so the cloud
 *    client never sees two writers on one file.
 */

import { AUDIT_MAX_ROWS, audit, canonical } from './audit';
import { noteExternalChange } from './cross-tab';
import { attachmentKey, parseStoredAttachment, referencedAttachmentIds, storedAttachmentIds, ATTACHMENT_KEY_PREFIX } from './attachments';
import { numberKey, parseDocNumber } from './invoice-number';
import { LATEST_SCHEMA_VERSION, SCHEMA_VERSION_KEY } from './migrations';
import { isDateLocked, normalizeLockDate } from './period-lock';
import { activeCompanyId } from './company-registry';
import { SNAPSHOT_TABLES, ASSET_TABLE, parseAssets, referencedAssets } from './assets';
import {
  DB_PREFIX,
  DEVICE_LOCAL_KEYS,
  SINGLETON_KEYS,
  SYNC_META_KEYS,
  isLocalOnlyKey,
  listKeys,
  readRaw,
  removeRaw,
  writeRaw,
} from './storage';
import {
  BLOB_EXT,
  SYNC_APP,
  deviceFileName,
  isAttachmentId,
  listDeviceIds,
  openGroup,
  readSealed,
  withRetry,
  writeSealed,
  type GroupDirs,
  type SyncDir,
  type SyncKey,
} from './sync-files';
import type { AuditEntry } from '../types/audit';

export const [SYNC_STATE_KEY, SYNC_CONFLICTS_KEY, SYNC_AUDIT_KEY] = SYNC_META_KEYS;

/* ── Types ─────────────────────────────────────────────────────── */

export type VV = Record<string, number>;

/** One version of a row or singleton. */
export interface RowMeta {
  /** Content hash of the stored JSON ('' for a tombstone). */
  h: string;
  /** Lamport time of the change. */
  t: number;
  /** Device that made it. */
  d: string;
  vv: VV;
  /** Device that first introduced the row (numbering-series warnings). */
  o: string;
  /** Tombstone. */
  del?: 1;
}

type KeyState = { mode: 'rows'; rows: Record<string, RowMeta> } | { mode: 'single'; meta: RowMeta };

export interface PeerInfo {
  name: string;
  clock: number;
  /** The peer's own clock when it wrote its file (display only; never used for ordering). */
  written_at: string;
  seen_at: string;
  status: 'ok' | 'unreadable' | 'version';
  message?: string;
  prefix?: string;
  blobs?: string[];
}

export interface SyncReport {
  ok: boolean;
  at: string;
  added: number;
  updated: number;
  deleted: number;
  conflicts: number;
  newConflicts: number;
  peers: number;
  unreadable: { device: string; name?: string; message: string }[];
  wrote: boolean;
  blobsIn: number;
  blobsOut: number;
  reason?: 'permission' | 'no-folder' | 'unsupported' | 'error' | 'busy';
  message?: string;
}

export interface SyncState {
  v: 1;
  group: string;
  clock: number;
  keys: Record<string, KeyState>;
  peers: Record<string, PeerInfo>;
  blobs_written: string[];
  dup_ack: string[];
  /** Locked-period changes the user chose not to take: `key|row id` → remote content hash. */
  declined: Record<string, string>;
  last_sync?: string;
  last_written?: string;
  last_written_hash?: string;
  last_report?: SyncReport;
}

export interface ConflictSide {
  meta: RowMeta | null;
  /** Rows: the row object (null = deleted / absent). Singletons: the stored string (null = removed). */
  value: unknown;
}

export type SyncConflict =
  | {
      id: string;
      kind: 'row' | 'single';
      key: string;
      row_id?: string;
      /** concurrent edits / a change into a locked period / singleton last-writer-wins. */
      reason: 'concurrent' | 'locked' | 'lww';
      device: string;
      device_name: string;
      at: string;
      local: ConflictSide;
      remote: ConflictSide;
      /** Singletons: which version is in use now. */
      applied?: 'local' | 'remote';
    }
  | {
      id: string;
      kind: 'duplicate';
      number: string;
      ids: string[];
      sig: string;
      at: string;
      docs: { id: string; number: string; client: string; date: string; total: number; device: string }[];
    };

export type RowConflict = Extract<SyncConflict, { kind: 'row' | 'single' }>;

interface RemoteKey {
  mode: 'rows' | 'single';
  rows?: Record<string, [RowMeta, unknown]>;
  meta?: RowMeta;
  value?: string | null;
}

export interface RemoteFile {
  app: typeof SYNC_APP;
  kind: 'state';
  v: 1;
  device: { id: string; name: string };
  group: string;
  schema: number;
  clock: number;
  written_at: string;
  prefix?: string;
  vv_max: VV;
  keys: Record<string, RemoteKey>;
  audit: AuditEntry[];
  blobs: string[];
}

/* ── Pure helpers ──────────────────────────────────────────────── */

/** 64-bit non-cryptographic string hash (cyrb53 variant) + length: cheap per-row change detection. */
export function hashStr(s: string): string {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}.${(h1 >>> 0).toString(36)}.${s.length.toString(36)}`;
}

export type VVOrder = 'eq' | 'gt' | 'lt' | 'cc';

/** Compare version vectors: a dominates b ('gt'), b dominates a ('lt'), equal, or concurrent ('cc'). */
export function compareVV(a: VV, b: VV): VVOrder {
  let gt = false;
  let lt = false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    if (x > y) gt = true;
    else if (x < y) lt = true;
    if (gt && lt) return 'cc';
  }
  return gt ? 'gt' : lt ? 'lt' : 'eq';
}

export const vvCovers = (a: VV, b: VV) => {
  const o = compareVV(a, b);
  return o === 'gt' || o === 'eq';
};

export function mergeVV(a: VV, b: VV): VV {
  const out: VV = { ...a };
  for (const [k, v] of Object.entries(b)) if (v > (out[k] ?? 0)) out[k] = v;
  return out;
}

const minStr = (a: string, b: string) => (a && b ? (a < b ? a : b) : a || b);
const cloneMeta = (m: RowMeta): RowMeta => ({ h: m.h, t: m.t, d: m.d, vv: { ...m.vv }, o: m.o, ...(m.del ? { del: 1 as const } : {}) });

/** Per-device data and bookkeeping that must not travel between devices. */
const EXCLUDED = new Set<string>([
  ...['draft', 'schema_version', 'audit_log', 'timer', 'backup_snooze', 'auto_backup', 'install_dismissed', 'notif_state', 'export_prefs', '__probe'].map((k) => DB_PREFIX + k),
  ...SYNC_META_KEYS,
  ...DEVICE_LOCAL_KEYS,
]);

export function isSyncedKey(key: string): boolean {
  return key.startsWith(DB_PREFIX) && !EXCLUDED.has(key) && !key.startsWith(ATTACHMENT_KEY_PREFIX) && !isLocalOnlyKey(key);
}

/** Tables whose rows carry a document date that the period lock protects. */
const DATED: Record<string, string> = {
  [`${DB_PREFIX}invoices`]: 'issue_date',
  [`${DB_PREFIX}transactions`]: 'date',
  [`${DB_PREFIX}purchases`]: 'date',
  [`${DB_PREFIX}purchase_payments`]: 'date',
  [`${DB_PREFIX}vouchers`]: 'date',
  [`${DB_PREFIX}stock_moves`]: 'date',
  [`${DB_PREFIX}stock_transfers`]: 'date',
};

const INVOICES_KEY = `${DB_PREFIX}invoices`;
const BAD_ID = '__proto__';

export const tableLabel = (key: string) => key.slice(DB_PREFIX.length).replace(/_/g, ' ');

/* ── Working copy of the local data ────────────────────────────── */

type Work =
  | { mode: 'rows'; ids: string[]; rows: Map<string, unknown>; dirty: boolean }
  | { mode: 'single'; value: string | null; dirty: boolean };

/** Stable row ids: the row's own `id`, else (missing / duplicate) a content id. */
function assignIds(list: unknown[]): { ids: string[]; rows: Map<string, unknown> } {
  const ids: string[] = [];
  const rows = new Map<string, unknown>();
  for (const row of list) {
    const raw = row && typeof row === 'object' ? (row as { id?: unknown }).id : undefined;
    let id = (typeof raw === 'string' && raw !== '') || typeof raw === 'number' ? String(raw) : '';
    if (!id || id === BAD_ID || rows.has(id)) {
      const base = `~${hashStr(JSON.stringify(row))}`;
      id = base;
      for (let n = 1; rows.has(id); n++) id = `${base}#${n}`;
    }
    ids.push(id);
    rows.set(id, row);
  }
  return { ids, rows };
}

function loadWork(): Map<string, Work> {
  const work = new Map<string, Work>();
  for (const key of listKeys(DB_PREFIX).filter(isSyncedKey).sort()) {
    const raw = readRaw(key);
    if (raw === null) continue;
    let parsed: unknown;
    try {
      parsed = raw.startsWith('[') ? JSON.parse(raw) : undefined;
    } catch {
      parsed = undefined;
    }
    if (Array.isArray(parsed)) work.set(key, { mode: 'rows', ...assignIds(parsed), dirty: false });
    else work.set(key, { mode: 'single', value: raw, dirty: false });
  }
  return work;
}

function upsertRow(w: Extract<Work, { mode: 'rows' }>, id: string, row: unknown): void {
  if (!w.rows.has(id)) w.ids.push(id);
  w.rows.set(id, row);
  w.dirty = true;
}

function removeRow(w: Extract<Work, { mode: 'rows' }>, id: string): void {
  if (!w.rows.delete(id)) return;
  w.ids = w.ids.filter((x) => x !== id);
  w.dirty = true;
}

const serializeWork = (w: Work): string | null => (w.mode === 'rows' ? JSON.stringify(w.ids.map((id) => w.rows.get(id))) : w.value);

/* ── Persistent state ──────────────────────────────────────────── */

export function emptyState(group: string): SyncState {
  return { v: 1, group, clock: 0, keys: {}, peers: {}, blobs_written: [], dup_ack: [], declined: {} };
}

export function loadState(group?: string): SyncState {
  try {
    const raw = readRaw(SYNC_STATE_KEY);
    const s = raw ? (JSON.parse(raw) as SyncState) : null;
    if (s && s.v === 1 && typeof s.clock === 'number' && s.keys && typeof s.keys === 'object') {
      if (group && s.group !== group) {
        // Joined another group: forget what was exchanged with the old one (conflicts are kept).
        return emptyState(group);
      }
      return { ...emptyState(s.group), ...s, declined: s.declined ?? {}, dup_ack: s.dup_ack ?? [], blobs_written: s.blobs_written ?? [] };
    }
  } catch {
    /* damaged: start over (conservative: differences become conflicts, nothing is overwritten) */
  }
  return emptyState(group ?? '');
}

export function loadConflicts(): SyncConflict[] {
  try {
    const v = JSON.parse(readRaw(SYNC_CONFLICTS_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as SyncConflict[]) : [];
  } catch {
    return [];
  }
}

export interface DeviceLog {
  name: string;
  rows: AuditEntry[];
}

export function loadDeviceLogs(): Record<string, DeviceLog> {
  try {
    const v = JSON.parse(readRaw(SYNC_AUDIT_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, DeviceLog>) : {};
  } catch {
    return {};
  }
}

/* ── Local change detection ────────────────────────────────────── */

/**
 * Fold local edits since the last sync into the state: a row whose hash changed (or that is new)
 * gets a new version stamped with this device's next Lamport time; a row that disappeared gets a
 * tombstone. Returns how many versions were created.
 */
export function scanLocal(state: SyncState, work: Map<string, Work>, self: string): number {
  let changes = 0;
  const stamp = (prev: RowMeta | undefined, h: string, del: boolean): RowMeta => {
    const t = ++state.clock;
    changes++;
    return { h, t, d: self, vv: { ...(prev?.vv ?? {}), [self]: t }, o: prev?.o || self, ...(del ? { del: 1 as const } : {}) };
  };
  for (const [key, w] of work) {
    let ks = state.keys[key];
    if (w.mode === 'rows') {
      if (!ks || ks.mode !== 'rows') ks = state.keys[key] = { mode: 'rows', rows: {} };
      const rows = ks.rows;
      for (const id of w.ids) {
        const h = hashStr(JSON.stringify(w.rows.get(id)));
        const m = rows[id];
        if (!m || m.del || m.h !== h) rows[id] = stamp(m, h, false);
      }
      for (const [id, m] of Object.entries(rows)) if (!m.del && !w.rows.has(id)) rows[id] = stamp(m, '', true);
    } else {
      const h = w.value === null ? '' : hashStr(w.value);
      const m = ks?.mode === 'single' ? ks.meta : undefined;
      if (!m || (w.value === null ? !m.del : m.del || m.h !== h)) state.keys[key] = { mode: 'single', meta: stamp(m, h, w.value === null) };
    }
  }
  // Keys that vanished entirely (table emptied by removing the key, singleton removed).
  for (const [key, ks] of Object.entries(state.keys)) {
    if (work.has(key)) continue;
    if (ks.mode === 'rows') {
      for (const [id, m] of Object.entries(ks.rows)) if (!m.del) ks.rows[id] = stamp(m, '', true);
    } else if (!ks.meta.del) ks.meta = stamp(ks.meta, '', true);
  }
  return changes;
}

/* ── Remote file validation ────────────────────────────────────── */

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

function validMeta(m: unknown): m is RowMeta {
  const x = m as RowMeta | null;
  if (!x || typeof x !== 'object' || typeof x.h !== 'string' || !isInt(x.t) || typeof x.d !== 'string' || typeof x.o !== 'string') return false;
  if (x.del !== undefined && x.del !== 1) return false;
  if (!x.vv || typeof x.vv !== 'object' || Array.isArray(x.vv)) return false;
  return Object.entries(x.vv).every(([k, v]) => k !== BAD_ID && isInt(v));
}

export class SyncDataError extends Error {}

/** Parse + validate a decrypted device file. Throws SyncDataError when anything is off. */
export function parseRemoteFile(text: string, deviceId: string, group: string): RemoteFile {
  let f: RemoteFile;
  try {
    f = JSON.parse(text) as RemoteFile;
  } catch {
    throw new SyncDataError('not JSON');
  }
  const bad = (why: string): never => {
    throw new SyncDataError(why);
  };
  if (!f || f.app !== SYNC_APP || f.kind !== 'state' || f.v !== 1) bad('not a sync state file');
  if (!f.device || f.device.id !== deviceId || typeof f.device.name !== 'string') bad('device mismatch');
  if (f.group !== group) bad('group mismatch');
  if (!isInt(f.clock) || !isInt(f.schema) || typeof f.written_at !== 'string') bad('header');
  if (!f.keys || typeof f.keys !== 'object' || !Array.isArray(f.audit) || !Array.isArray(f.blobs)) bad('body');
  if (!f.vv_max || typeof f.vv_max !== 'object') bad('vv_max');
  if (!f.blobs.every((b) => typeof b === 'string' && isAttachmentId(b))) bad('blobs');
  if (!f.audit.every((r) => r && typeof r === 'object' && typeof r.id === 'string')) bad('audit');
  for (const [key, k] of Object.entries(f.keys)) {
    if (!key.startsWith(DB_PREFIX) || !k || typeof k !== 'object') bad('key');
    if (k.mode === 'rows') {
      if (!k.rows || typeof k.rows !== 'object') bad('rows');
      for (const [id, pair] of Object.entries(k.rows!)) {
        if (id === BAD_ID || !Array.isArray(pair) || pair.length !== 2 || !validMeta(pair[0])) bad(`row ${id}`);
        const [m, v] = pair;
        if (m.del ? v !== null : v === null || v === undefined || hashStr(JSON.stringify(v)) !== m.h) bad(`row ${id} content`);
      }
    } else if (k.mode === 'single') {
      if (!validMeta(k.meta)) bad('single meta');
      const v = k.value;
      if (k.meta!.del ? v !== null : typeof v !== 'string' || hashStr(v) !== k.meta!.h) bad('single content');
    } else bad('mode');
  }
  return f;
}

/* ── Merge ─────────────────────────────────────────────────────── */

interface MergeCtx {
  state: SyncState;
  work: Map<string, Work>;
  conflicts: SyncConflict[];
  self: string;
  lock: string;
  now: string;
  stats: { added: number; updated: number; deleted: number; newConflicts: number };
  changedKeys: Set<string>;
}

const rowDate = (key: string, row: unknown): string | undefined => {
  const f = DATED[key];
  return f && row && typeof row === 'object' ? ((row as Record<string, unknown>)[f] as string | undefined) : undefined;
};

function touchesLock(ctx: MergeCtx, key: string, before: unknown, after: unknown): boolean {
  if (!ctx.lock || !DATED[key]) return false;
  return isDateLocked(rowDate(key, before), ctx.lock) || isDateLocked(rowDate(key, after), ctx.lock);
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return canonical(a) === canonical(b);
  } catch {
    return false;
  }
}

function putConflict(ctx: MergeCtx, c: RowConflict): void {
  const i = ctx.conflicts.findIndex((x) => x.id === c.id);
  if (i >= 0) {
    const old = ctx.conflicts[i] as RowConflict;
    // Same two versions already listed: keep the original entry (and its time).
    if (old.remote.meta?.h === c.remote.meta?.h && !!old.remote.meta?.del === !!c.remote.meta?.del && old.local.meta?.h === c.local.meta?.h) return;
    ctx.conflicts[i] = c;
  } else ctx.conflicts.push(c);
  ctx.stats.newConflicts++;
}

/** Drop listed conflicts on this row that the current version already supersedes (resolved on another device). */
function dropResolved(ctx: MergeCtx, id: string, meta: RowMeta): void {
  ctx.conflicts = ctx.conflicts.filter((c) => {
    if (c.kind === 'duplicate' || c.id !== id) return true;
    return !(vvCovers(meta.vv, c.local.meta?.vv ?? {}) && vvCovers(meta.vv, c.remote.meta?.vv ?? {}));
  });
}

function absorb(lm: RowMeta, rm: RowMeta): void {
  lm.vv = mergeVV(lm.vv, rm.vv);
  if (rm.t > lm.t || (rm.t === lm.t && rm.d > lm.d)) {
    lm.t = rm.t;
    lm.d = rm.d;
  }
  lm.o = minStr(lm.o, rm.o);
}

function mergeRows(ctx: MergeCtx, key: string, rk: RemoteKey, from: RemoteFile): void {
  let ks = ctx.state.keys[key];
  let w = ctx.work.get(key);
  if ((ks && ks.mode !== 'rows') || (w && w.mode !== 'rows')) return; // shape differs between devices: leave it
  if (!ks) ks = ctx.state.keys[key] = { mode: 'rows', rows: {} };
  if (!w) {
    w = { mode: 'rows', ids: [], rows: new Map(), dirty: false };
    ctx.work.set(key, w);
  }
  const rows = (ks as Extract<KeyState, { mode: 'rows' }>).rows;
  const wr = w as Extract<Work, { mode: 'rows' }>;
  for (const [id, [rm, rv]] of Object.entries(rk.rows ?? {})) {
    const lm = rows[id];
    const localVal = wr.rows.get(id);
    const cid = `row:${key}:${id}`;
    const conflict = (reason: 'concurrent' | 'locked') =>
      putConflict(ctx, {
        id: cid, kind: 'row', key, row_id: id, reason, device: from.device.id, device_name: from.device.name, at: ctx.now,
        local: { meta: lm ? cloneMeta(lm) : null, value: localVal ?? null },
        remote: { meta: cloneMeta(rm), value: rm.del ? null : rv },
      });
    const declined = () => ctx.state.declined[`${key}|${id}`] === (rm.del ? '' : rm.h);

    if (!lm) {
      if (rm.del) {
        rows[id] = cloneMeta(rm);
        continue;
      }
      if (touchesLock(ctx, key, undefined, rv)) {
        if (!declined()) conflict('locked');
        continue;
      }
      upsertRow(wr, id, rv);
      rows[id] = cloneMeta(rm);
      ctx.stats.added++;
      ctx.changedKeys.add(key);
      continue;
    }
    if ((lm.del && rm.del) || (!lm.del && !rm.del && lm.h === rm.h)) {
      absorb(lm, rm);
      dropResolved(ctx, cid, lm);
      continue;
    }
    const order = compareVV(rm.vv, lm.vv);
    if (order === 'lt') continue;
    if (order === 'gt') {
      if (touchesLock(ctx, key, localVal, rm.del ? undefined : rv)) {
        if (!declined()) conflict('locked');
        continue;
      }
      if (rm.del) {
        removeRow(wr, id);
        ctx.stats.deleted++;
      } else {
        if (localVal === undefined) ctx.stats.added++;
        else ctx.stats.updated++;
        upsertRow(wr, id, rv);
      }
      ctx.changedKeys.add(key);
      const next = cloneMeta(rm);
      next.o = minStr(lm.o, rm.o);
      rows[id] = next;
      dropResolved(ctx, cid, next);
      continue;
    }
    // Concurrent (or the same counter with different content after a lost state): never discard.
    if (!lm.del && !rm.del && sameJson(localVal, rv)) {
      absorb(lm, rm);
      dropResolved(ctx, cid, lm);
      continue;
    }
    conflict('concurrent');
  }
}

function mergeSingle(ctx: MergeCtx, key: string, rk: RemoteKey, from: RemoteFile): void {
  const ks = ctx.state.keys[key];
  const w = ctx.work.get(key);
  if ((ks && ks.mode !== 'single') || (w && w.mode !== 'single')) return;
  const rm = rk.meta!;
  const rv = rm.del ? null : (rk.value ?? null);
  const cid = `single:${key}`;
  const apply = () => {
    const cur = ctx.work.get(key) as Extract<Work, { mode: 'single' }> | undefined;
    if ((cur?.value ?? null) === rv) return;
    ctx.work.set(key, { mode: 'single', value: rv, dirty: true });
    ctx.stats.updated++;
    ctx.changedKeys.add(key);
  };
  const lm = ks?.mode === 'single' ? ks.meta : undefined;
  if (!lm) {
    if (!rm.del) apply();
    ctx.state.keys[key] = { mode: 'single', meta: cloneMeta(rm) };
    return;
  }
  const lv = w?.mode === 'single' ? w.value : null;
  if ((lm.del && rm.del) || (!lm.del && !rm.del && lm.h === rm.h)) {
    absorb(lm, rm);
    dropResolved(ctx, cid, lm);
    return;
  }
  const order = compareVV(rm.vv, lm.vv);
  if (order === 'lt') return;
  // Moving the period lock earlier (or removing it) is never taken silently from another device.
  const loosens = key === SINGLETON_KEYS.settings && lockOf(lv) !== '' && (lockOf(rv) === '' || lockOf(rv) < lockOf(lv));
  const holdLock = () => {
    if (ctx.state.declined[`${key}|`] === (rm.del ? '' : rm.h)) return;
    putConflict(ctx, {
      id: cid, kind: 'single', key, reason: 'locked', device: from.device.id, device_name: from.device.name, at: ctx.now,
      local: { meta: cloneMeta(lm), value: lv }, remote: { meta: cloneMeta(rm), value: rv }, applied: 'local',
    });
  };
  if (order === 'gt') {
    if (loosens) return holdLock();
    apply();
    const next = cloneMeta(rm);
    ctx.state.keys[key] = { mode: 'single', meta: next };
    dropResolved(ctx, cid, next);
    return;
  }
  if (lv !== null && rv !== null && sameJson(safeParse(lv), safeParse(rv))) {
    absorb(lm, rm);
    dropResolved(ctx, cid, lm);
    return;
  }
  // Concurrent: last writer by Lamport time (device id breaks ties) wins; the other version is listed.
  const remoteWins = rm.t > lm.t || (rm.t === lm.t && rm.d > lm.d);
  if (remoteWins && loosens) return holdLock();
  putConflict(ctx, {
    id: cid, kind: 'single', key, reason: 'lww', device: from.device.id, device_name: from.device.name, at: ctx.now,
    local: { meta: cloneMeta(lm), value: lv }, remote: { meta: cloneMeta(rm), value: rv }, applied: remoteWins ? 'remote' : 'local',
  });
  if (remoteWins) {
    apply();
    ctx.state.keys[key] = { mode: 'single', meta: cloneMeta(rm) };
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Duplicate document numbers (two devices issuing the same serial): listed, never renumbered. */
function flagDuplicates(ctx: MergeCtx): void {
  const w = ctx.work.get(INVOICES_KEY);
  const groups = new Map<string, string[]>();
  if (w?.mode === 'rows') {
    for (const id of w.ids) {
      const row = w.rows.get(id) as { invoice_number?: string } | undefined;
      const k = numberKey(row?.invoice_number);
      if (!k) continue;
      const g = groups.get(k);
      if (g) g.push(id);
      else groups.set(k, [id]);
    }
  }
  const live = new Set<string>();
  const metaRows = ctx.state.keys[INVOICES_KEY]?.mode === 'rows' ? (ctx.state.keys[INVOICES_KEY] as { rows: Record<string, RowMeta> }).rows : {};
  for (const [k, ids] of groups) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    const sig = `${k}|${sorted.join(',')}`;
    if (ctx.state.dup_ack.includes(sig)) continue;
    const id = `dup:${k}`;
    live.add(id);
    const existing = ctx.conflicts.find((c) => c.id === id);
    if (existing?.kind === 'duplicate' && existing.sig === sig) continue;
    const docs = sorted.map((rid) => {
      const r = ((w as Extract<Work, { mode: 'rows' }>).rows.get(rid) ?? {}) as Record<string, unknown>;
      return {
        id: rid,
        number: String(r.invoice_number ?? ''),
        client: String((r.client as { name?: string } | undefined)?.name ?? ''),
        date: String(r.issue_date ?? ''),
        total: Number(r.total) || 0,
        device: ctx.state.peers[metaRows[rid]?.o ?? '']?.name ?? (metaRows[rid]?.o === ctx.self ? 'this device' : ''),
      };
    });
    const c: SyncConflict = { id, kind: 'duplicate', number: docs[0].number, ids: sorted, sig, at: ctx.now, docs };
    if (existing) ctx.conflicts[ctx.conflicts.indexOf(existing)] = c;
    else ctx.conflicts.push(c);
    ctx.stats.newConflicts++;
  }
  ctx.conflicts = ctx.conflicts.filter((c) => c.kind !== 'duplicate' || live.has(c.id));
}

/** Another device's audit log, kept as its own chain: overlap by id, else replaced (it rolled past our copy). */
export function mergeDeviceLog(stored: AuditEntry[], incoming: AuditEntry[]): AuditEntry[] {
  if (!incoming.length) return stored;
  const idx = stored.findIndex((r) => r.id === incoming[0].id);
  const merged = idx >= 0 ? stored.slice(0, idx).concat(incoming) : incoming;
  return merged.length > AUDIT_MAX_ROWS ? incoming : merged;
}

/* ── Own snapshot ──────────────────────────────────────────────── */

function vvMax(state: SyncState): VV {
  const out: VV = {};
  const see = (m: RowMeta) => {
    for (const [k, v] of Object.entries(m.vv)) if (v > (out[k] ?? 0)) out[k] = v;
  };
  for (const ks of Object.values(state.keys)) {
    if (ks.mode === 'rows') for (const m of Object.values(ks.rows)) see(m);
    else see(ks.meta);
  }
  return out;
}

function buildPayload(state: SyncState, work: Map<string, Work>, device: { id: string; name: string }, prefix: string | undefined): Omit<RemoteFile, 'written_at'> {
  const keys: Record<string, RemoteKey> = {};
  for (const [key, ks] of Object.entries(state.keys)) {
    const w = work.get(key);
    if (ks.mode === 'rows') {
      const rows: Record<string, [RowMeta, unknown]> = {};
      const wr = w?.mode === 'rows' ? w : null;
      for (const [id, m] of Object.entries(ks.rows)) {
        if (m.del) rows[id] = [m, null];
        else if (wr?.rows.has(id)) rows[id] = [m, wr.rows.get(id)];
      }
      keys[key] = { mode: 'rows', rows };
    } else {
      const value = w?.mode === 'single' ? w.value : null;
      if (ks.meta.del || value !== null) keys[key] = { mode: 'single', meta: ks.meta, value: ks.meta.del ? null : value };
    }
  }
  let ownAudit: AuditEntry[] = [];
  try {
    const parsed = JSON.parse(readRaw(`${DB_PREFIX}audit_log`) ?? '[]') as unknown;
    if (Array.isArray(parsed)) ownAudit = parsed as AuditEntry[];
  } catch {
    /* unreadable log: send none */
  }
  return {
    app: SYNC_APP, kind: 'state', v: 1, device, group: state.group, schema: localSchema(), clock: state.clock,
    ...(prefix ? { prefix } : {}), vv_max: vvMax(state), keys, audit: ownAudit, blobs: [...state.blobs_written],
  };
}

function localSchema(): number {
  const n = Number(readRaw(SCHEMA_VERSION_KEY));
  return Number.isInteger(n) && n > 0 ? n : LATEST_SCHEMA_VERSION;
}

/* ── Applying the merged working copy ──────────────────────────── */

/**
 * Structural checks before a merge is written (a subset of a restore's: rows from another device may
 * legitimately be legacy-shaped, e.g. catalogue items without ids). Throws a readable Error.
 */
function checkMerged(data: Record<string, string>): void {
  const settings = data[SINGLETON_KEYS.settings];
  if (settings !== undefined) {
    const v = safeParse(settings);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('the merged settings are damaged');
  }
  const refs = new Set<string>();
  for (const t of SNAPSHOT_TABLES) {
    const raw = data[DB_PREFIX + t];
    if (raw === undefined) continue;
    const rows = safeParse(raw);
    if (!Array.isArray(rows)) throw new Error(`the merged ${t} table is not a list`);
    referencedAssets(rows, refs);
  }
  if (refs.size) {
    const assets = parseAssets(data[DB_PREFIX + ASSET_TABLE] ?? readRaw(DB_PREFIX + ASSET_TABLE));
    const missing = [...refs].filter((id) => !assets.byId.has(id)).length;
    if (missing) throw new Error(`${missing} logo/signature image${missing === 1 ? '' : 's'} the invoices refer to did not arrive`);
  }
}

/** Write every changed key (assets first, so an invoice never points at a missing logo). All-or-nothing. */
function commit(work: Map<string, Work>): string[] {
  const dirty = [...work].filter(([, w]) => w.dirty).map(([k]) => k);
  dirty.sort((a, b) => Number(b === DB_PREFIX + ASSET_TABLE) - Number(a === DB_PREFIX + ASSET_TABLE));
  if (!dirty.length) return [];
  // A merge that would leave damaged settings or dangling logo references writes nothing.
  const projected: Record<string, string> = {};
  const needAssets = dirty.some((k) => SNAPSHOT_TABLES.has(k.slice(DB_PREFIX.length)));
  for (const [k, w] of work) {
    if (!w.dirty && !(needAssets && (k === DB_PREFIX + ASSET_TABLE || SNAPSHOT_TABLES.has(k.slice(DB_PREFIX.length))))) continue;
    const v = serializeWork(w);
    if (v !== null) projected[k] = v;
  }
  checkMerged(projected);
  const written: [string, string | null][] = [];
  try {
    for (const k of dirty) {
      const before = readRaw(k);
      const v = k in projected ? projected[k] : serializeWork(work.get(k)!);
      if (v === null) removeRaw(k);
      else writeRaw(k, v);
      written.push([k, before]);
    }
  } catch (err) {
    for (const [k, before] of written.reverse()) {
      try {
        if (before === null) removeRaw(k);
        else writeRaw(k, before);
      } catch {
        /* best effort */
      }
    }
    throw err;
  }
  return dirty;
}

function saveMeta(state: SyncState, conflicts?: SyncConflict[], logs?: Record<string, DeviceLog>): void {
  writeRaw(SYNC_STATE_KEY, JSON.stringify(state));
  if (conflicts) writeRaw(SYNC_CONFLICTS_KEY, JSON.stringify(conflicts));
  if (logs) writeRaw(SYNC_AUDIT_KEY, JSON.stringify(logs));
}

function lockOf(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return normalizeLockDate((JSON.parse(value) as { lock_until?: unknown } | null)?.lock_until);
  } catch {
    return '';
  }
}

/* ── One-at-a-time ─────────────────────────────────────────────── */

let chain: Promise<unknown> = Promise.resolve();

/** Serialise sync runs and conflict resolutions (and across tabs, with the Web Locks API where present). */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as (Navigator & { locks?: LockManager }) | undefined)?.locks;
  const run = () => (locks?.request ? (locks.request(`mrchartist-sync:${activeCompanyId()}`, fn) as Promise<T>) : fn());
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

/* ── Sync run ──────────────────────────────────────────────────── */

export interface SyncRunOptions {
  root: SyncDir;
  group: string;
  key: SyncKey;
  device: { id: string; name: string };
  /** Number series this device issues from (shown to the others for the shared-series warning). */
  prefix?: string;
  now?: Date;
  /** Reading a file the cloud client is still writing: attempts and pause between them. */
  attempts?: number;
  retryDelayMs?: number;
}

const blobDirName = (device: string) => device;

export function runSync(o: SyncRunOptions): Promise<SyncReport> {
  return exclusive(() => runSyncInner(o));
}

async function runSyncInner(o: SyncRunOptions): Promise<SyncReport> {
  const now = o.now ?? new Date();
  const at = now.toISOString();
  const self = o.device.id;
  const report: SyncReport = { ok: true, at, added: 0, updated: 0, deleted: 0, conflicts: 0, newConflicts: 0, peers: 0, unreadable: [], wrote: false, blobsIn: 0, blobsOut: 0 };
  const dirs: GroupDirs = await openGroup(o.root, o.group, false);
  const attempts = o.attempts ?? 3;
  const delay = o.retryDelayMs ?? 1500;

  // 1. Read every other device's file (retrying files the cloud client may be half-way through writing).
  const present = await listDeviceIds(dirs);
  const files: RemoteFile[] = [];
  const failed: { id: string; message: string; version?: boolean }[] = [];
  const schema = localSchema();
  for (const id of present) {
    if (id === self) continue;
    try {
      const f = await withRetry(async () => {
        const text = await readSealed(dirs.devices, deviceFileName(id), o.key, 'device', id, [o.group, 'device', id]);
        return parseRemoteFile(text, id, o.group);
      }, attempts, delay);
      if (f.schema !== schema) {
        failed.push({ id, version: true, message: f.schema > schema ? 'uses a newer version of the app: update this device' : 'uses an older version of the app: update it' });
        continue;
      }
      files.push(f);
    } catch (err) {
      failed.push({ id, message: (err as Error)?.message || 'unreadable' });
    }
  }

  // 2. Merge synchronously: no other code can write between reading local data and writing the result.
  const state = loadState(o.group);
  state.group = o.group;
  const conflicts = loadConflicts();
  const logs = loadDeviceLogs();
  const work = loadWork();
  // A device whose sync state was lost (restore, erase) must never reuse its old counters.
  for (const f of files) state.clock = Math.max(state.clock, f.vv_max[self] ?? 0);
  scanLocal(state, work, self);
  const settingsW = work.get(SINGLETON_KEYS.settings);
  let lock = lockOf(settingsW?.mode === 'single' ? settingsW.value : null);
  for (const f of files) {
    const l = lockOf(f.keys[SINGLETON_KEYS.settings]?.value ?? null);
    if (l > lock) lock = l;
  }
  const ctx: MergeCtx = { state, work, conflicts, self, lock, now: at, stats: { added: 0, updated: 0, deleted: 0, newConflicts: 0 }, changedKeys: new Set() };
  const names: string[] = [];
  for (const f of files.sort((a, b) => (a.device.id < b.device.id ? -1 : 1))) {
    for (const [key, rk] of Object.entries(f.keys)) {
      if (!isSyncedKey(key)) continue;
      if (rk.mode === 'rows') mergeRows(ctx, key, rk, f);
      else mergeSingle(ctx, key, rk, f);
    }
    state.clock = Math.max(state.clock, f.clock); // Lamport: later local edits sort after everything seen
    if (f.audit.length) logs[f.device.id] = { name: f.device.name, rows: mergeDeviceLog(logs[f.device.id]?.rows ?? [], f.audit) };
    state.peers[f.device.id] = { name: f.device.name, clock: f.clock, written_at: f.written_at, seen_at: at, status: 'ok', ...(f.prefix ? { prefix: f.prefix } : {}), blobs: f.blobs };
    names.push(f.device.name);
  }
  for (const x of failed) {
    const prev = state.peers[x.id];
    state.peers[x.id] = { ...(prev ?? { name: '', clock: 0, written_at: '' }), seen_at: prev?.seen_at ?? '', status: x.version ? 'version' : 'unreadable', message: x.message };
    report.unreadable.push({ device: x.id, name: prev?.name, message: x.message });
  }
  flagDuplicates(ctx);

  let changed: string[];
  try {
    changed = commit(work);
  } catch (err) {
    const message = `Sync could not apply the changes, so nothing was changed: ${(err as Error)?.message ?? err}`;
    const failedRun: SyncReport = { ...report, ok: false, reason: 'error', message };
    recordReport(failedRun);
    return failedRun;
  }
  Object.assign(report, ctx.stats, { peers: files.length, conflicts: ctx.conflicts.length });
  if (ctx.stats.added + ctx.stats.updated + ctx.stats.deleted + ctx.stats.newConflicts > 0) {
    const parts = [`${ctx.stats.added} added`, `${ctx.stats.updated} changed`, `${ctx.stats.deleted} deleted`];
    audit.record({
      entity: 'system', entity_id: 'sync', action: 'import',
      summary: `Folder sync from ${names.join(', ') || 'other devices'}: ${parts.join(', ')}` +
        (ctx.stats.newConflicts ? `; ${ctx.stats.newConflicts} conflict${ctx.stats.newConflicts === 1 ? '' : 's'} to review` : ''),
    });
  }
  // Payload is taken now, from the exact state that was just committed.
  const payload = buildPayload(state, work, o.device, o.prefix);
  const payloadText = JSON.stringify(payload);
  const payloadHash = hashStr(payloadText);
  state.last_sync = at;
  saveMeta(state, ctx.conflicts, logs);
  for (const k of changed) noteExternalChange(k);

  // 3. Attachment files: fetch the ones records now point at, upload this device's new ones.
  const have = new Set(storedAttachmentIds());
  for (const id of referencedAttachmentIds()) {
    if (have.has(id) || !isAttachmentId(id)) continue;
    for (const f of files) {
      if (!f.blobs.includes(id)) continue;
      try {
        const dir = await dirs.blobs.getDirectoryHandle(blobDirName(f.device.id));
        const raw = await withRetry(() => readSealed(dir, `${id}${BLOB_EXT}`, o.key, 'blob', f.device.id, [o.group, 'blob', f.device.id, id]), attempts, delay);
        if (parseStoredAttachment(raw)?.id !== id) continue;
        writeRaw(attachmentKey(id), raw);
        have.add(id);
        report.blobsIn++;
        break;
      } catch {
        /* try another device / next sync */
      }
    }
  }
  const written = new Set(state.blobs_written);
  let mine: SyncDir | null = null;
  for (const id of storedAttachmentIds()) {
    if (written.has(id) || !isAttachmentId(id)) continue;
    const raw = readRaw(attachmentKey(id));
    if (!raw) continue;
    try {
      mine ??= await dirs.blobs.getDirectoryHandle(blobDirName(self), { create: true });
      await writeSealed(mine, `${id}${BLOB_EXT}`, o.key, 'blob', self, raw, [o.group, 'blob', self, id]);
      written.add(id);
      report.blobsOut++;
    } catch {
      /* next sync */
    }
  }

  // 4. Own file: only when something changed (or it is missing), then read back to prove it opens.
  const blobsChanged = written.size !== state.blobs_written.length;
  state.blobs_written = [...written].sort();
  let finalText = payloadText;
  let finalHash = payloadHash;
  if (blobsChanged) {
    finalText = JSON.stringify({ ...payload, blobs: state.blobs_written });
    finalHash = hashStr(finalText);
  }
  if (finalHash !== state.last_written_hash || !present.includes(self)) {
    const full = `${finalText.slice(0, -1)},"written_at":${JSON.stringify(at)}}`;
    try {
      await writeSealed(dirs.devices, deviceFileName(self), o.key, 'device', self, full, [o.group, 'device', self]);
      const back = await readSealed(dirs.devices, deviceFileName(self), o.key, 'device', self, [o.group, 'device', self]);
      if (back !== full) throw new Error('read-back mismatch');
      state.last_written_hash = finalHash;
      state.last_written = at;
      report.wrote = true;
    } catch (err) {
      report.ok = false;
      report.reason = 'error';
      report.message = `Could not write this device's sync file: ${(err as Error)?.message ?? err}`;
    }
  }
  state.last_report = { ...report, unreadable: report.unreadable.slice(0, 10) };
  saveMeta(state);
  return report;
}

/** Keep a run that stopped before syncing (permission, missing folder) visible in the panel. */
export function recordReport(r: SyncReport): void {
  try {
    if (!readRaw(SYNC_STATE_KEY)) return;
    const state = loadState();
    state.last_report = r;
    saveMeta(state);
  } catch {
    /* display only */
  }
}

/* ── Conflict resolution ───────────────────────────────────────── */

export type Resolution = 'mine' | 'theirs' | 'ack';

/**
 * Resolve one listed conflict. Rows / singletons: the chosen version becomes a new version that
 * dominates both (so every device converges on it at its next sync). A locked-period change taken with
 * `override` is written to the audit log; declined ("mine") it stays on the other device only.
 * Duplicates: 'ack' marks the pair reviewed (renumber by hand; issued numbers are never changed).
 */
export function resolveConflict(id: string, choice: Resolution, device: { id: string; name: string }, opts: { override?: boolean } = {}): Promise<{ ok: boolean; message?: string }> {
  return exclusive(async () => {
    const conflicts = loadConflicts();
    const c = conflicts.find((x) => x.id === id);
    if (!c) return { ok: false, message: 'That conflict is no longer listed.' };
    const state = loadState();
    const rest = conflicts.filter((x) => x.id !== id);
    if (c.kind === 'duplicate') {
      if (!state.dup_ack.includes(c.sig)) state.dup_ack.push(c.sig);
      saveMeta(state, rest);
      return { ok: true };
    }
    const self = device.id;
    const work = loadWork();
    scanLocal(state, work, self);
    const pick = choice === 'theirs' ? c.remote : c.local;

    if (c.reason === 'locked' && choice === 'mine') {
      // Declined: stays on the other device only; not offered again until it changes there.
      state.declined[`${c.key}|${c.row_id ?? ''}`] = c.remote.meta?.del ? '' : (c.remote.meta?.h ?? '');
      saveMeta(state, rest);
      return { ok: true };
    }
    if (c.reason === 'locked' && !opts.override) return { ok: false, message: 'Enter your PIN to change books in a locked period.' };
    if (c.kind === 'row') {
      const rowId = c.row_id!;
      let w = work.get(c.key);
      if (!w) {
        w = { mode: 'rows', ids: [], rows: new Map(), dirty: false };
        work.set(c.key, w);
      }
      if (w.mode !== 'rows') return { ok: false, message: 'This table changed shape; resolve it by restoring a backup.' };
      let ks = state.keys[c.key];
      if (!ks || ks.mode !== 'rows') ks = state.keys[c.key] = { mode: 'rows', rows: {} };
      const lm = ks.rows[rowId];
      if (pick.value === null) removeRow(w, rowId);
      else upsertRow(w, rowId, pick.value);
      const t = ++state.clock;
      const vv = { ...mergeVV(mergeVV(lm?.vv ?? {}, c.remote.meta?.vv ?? {}), c.local.meta?.vv ?? {}), [self]: t };
      const h = pick.value === null ? '' : hashStr(JSON.stringify(pick.value));
      ks.rows[rowId] = { h, t, d: self, vv, o: minStr(lm?.o ?? '', c.remote.meta?.o ?? '') || self, ...(pick.value === null ? { del: 1 as const } : {}) };
      // A version identical to what is stored needs no write.
      if (pick.value !== null && lm && !lm.del && lm.h === h) w.dirty = false;
    } else {
      const t = ++state.clock;
      const ks = state.keys[c.key];
      const lm = ks?.mode === 'single' ? ks.meta : null;
      const value = (pick.value as string | null) ?? null;
      const cur = work.get(c.key);
      if ((cur?.mode === 'single' ? cur.value : null) !== value) work.set(c.key, { mode: 'single', value, dirty: true });
      const vv = { ...mergeVV(mergeVV(lm?.vv ?? {}, c.remote.meta?.vv ?? {}), c.local.meta?.vv ?? {}), [self]: t };
      state.keys[c.key] = { mode: 'single', meta: { h: value === null ? '' : hashStr(value), t, d: self, vv, o: lm?.o || self, ...(value === null ? { del: 1 as const } : {}) } };
    }
    let changed: string[];
    try {
      changed = commit(work);
    } catch (err) {
      return { ok: false, message: (err as Error)?.message || 'Could not apply that version.' };
    }
    const label = c.kind === 'row' ? `${tableLabel(c.key)} row` : tableLabel(c.key);
    audit.record({
      entity: 'system', entity_id: 'sync', action: c.reason === 'locked' ? 'override' : 'update',
      summary: c.reason === 'locked'
        ? (c.kind === 'row'
          ? `Applied a synced change from ${c.device_name || 'another device'} to a ${label} in a locked period`
          : `Took the period-lock change from ${c.device_name || 'another device'}`)
        : `Sync conflict on ${label}: kept ${choice === 'theirs' ? `the version from ${c.device_name || 'another device'}` : "this device's version"}`,
    });
    saveMeta(state, rest);
    for (const k of changed) noteExternalChange(k);
    return { ok: true };
  });
}

/* ── Status for the UI ─────────────────────────────────────────── */

export interface NumberingWarning {
  series: string;
  devices: string[];
}

/** Number series (prefix/FY) that documents introduced by more than one device share. */
export function sharedSeries(state: SyncState = loadState(), self?: string): NumberingWarning[] {
  const ks = state.keys[INVOICES_KEY];
  if (!ks || ks.mode !== 'rows') return [];
  let rows: Map<string, unknown> | null = null;
  const raw = readRaw(INVOICES_KEY);
  try {
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    if (Array.isArray(list)) rows = assignIds(list).rows;
  } catch {
    rows = null;
  }
  if (!rows) return [];
  const bySeries = new Map<string, Set<string>>();
  for (const [id, m] of Object.entries(ks.rows)) {
    if (m.del) continue;
    const p = parseDocNumber((rows.get(id) as { invoice_number?: string } | undefined)?.invoice_number);
    if (!p) continue;
    const s = `${p.prefix}/FY${p.fy}`;
    const set = bySeries.get(s) ?? new Set<string>();
    set.add(m.o);
    bySeries.set(s, set);
  }
  const name = (d: string) => (d === self ? 'this device' : state.peers[d]?.name || 'another device');
  return [...bySeries].filter(([, s]) => s.size > 1).map(([series, s]) => ({ series, devices: [...s].map(name) }));
}
