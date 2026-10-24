/**
 * Verification side of the tamper-evident audit log (roadmap 4.5). Pure; used by Settings → Activity
 * and tests only, so it stays out of the entry chunk (`audit.ts` holds just the writing half).
 *
 * Rules (see docs/features/audit-lock.md §2a):
 *  1. Every chained row's `hash` must equal SHA-256(canonical(row without `hash`)) — otherwise "edited".
 *  2. Every chained row's `prev` must equal the previous chained row's `hash` — otherwise "reordered"
 *     (it points at another row that is present) or "deleted" (it points at a row that is gone).
 *  3. The first chained row's `prev` is the genesis value, or the `cut` recorded by the newest `truncate`
 *     anchor (older rows removed by the app: storage full / row cap). Anything else is "truncated".
 *  4. A run of unchained rows is legacy (pre-4.5) only if the `chain_start` anchor right after it seals
 *     exactly those rows (count + digest); a leading run may instead match the newest `truncate`
 *     anchor's seal. Otherwise the rows were edited, added or had their seal stripped.
 *  5. Optionally, a head hash noted earlier must still be in the log ("truncated" if newer rows were cut
 *     off), unless a `restore` marker records that a backup replaced the log it belonged to.
 */

import type { AuditEntry } from '../types/audit';
import { AUDIT_GENESIS, legacyDigest, rowHash } from './audit';

export type ChainBreakReason = 'edited' | 'deleted' | 'reordered' | 'truncated';

export interface ChainBreak {
  /** Index into the stored rows (oldest = 0); `rows.length` when the problem is at the end. */
  index: number;
  reason: ChainBreakReason;
  message: string;
}

export type NotedHeadResult =
  | { status: 'present'; index: number; newer: number }
  | { status: 'replaced'; at: string }
  | { status: 'missing' };

export interface ChainReport {
  ok: boolean;
  total: number;
  chained: number;
  /** Pre-4.5 rows sealed as they were (not individually hashed). */
  legacy: number;
  head: string | null;
  /** Older rows removed by the app itself, from the newest `truncate` anchor. Not tampering. */
  trimmed?: { dropped: number; reason: 'storage' | 'cap'; at: string };
  restores: number;
  noted?: NotedHeadResult;
  broken?: ChainBreak;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function verifyAuditChain(rows: AuditEntry[], opts: { notedHead?: string } = {}): ChainReport {
  const where = new Map<string, number>();
  rows.forEach((r, i) => r.hash && where.set(r.hash, i));
  let lastTrunc: AuditEntry | undefined;
  for (let i = rows.length - 1; i >= 0 && !lastTrunc; i--) if (rows[i].action === 'truncate' && rows[i].hash) lastTrunc = rows[i];

  const report: ChainReport = {
    ok: true,
    total: rows.length,
    chained: 0,
    legacy: 0,
    head: rows.length ? (rows[rows.length - 1].hash ?? null) : null,
    restores: rows.filter((r) => r.action === 'restore' && r.hash).length,
    ...(lastTrunc ? { trimmed: { dropped: lastTrunc.seal?.dropped ?? 0, reason: lastTrunc.seal?.reason ?? 'cap', at: lastTrunc.at } } : {}),
  };
  const fail = (index: number, reason: ChainBreakReason, message: string): ChainReport => ({ ...report, ok: false, broken: { index, reason, message } });
  const sealMatches = (s: { count: number; digest: string } | undefined, run: AuditEntry[]) =>
    !!s && s.count === run.length && s.digest === legacyDigest(run);

  let prev: string | undefined; // hash of the last chained row seen
  let runStart = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.hash) {
      if (runStart < 0) runStart = i;
      continue;
    }
    if (rowHash(r) !== r.hash) return fail(i, 'edited', `Entry ${i + 1} was changed after it was written.`);

    if (runStart >= 0) {
      const run = rows.slice(runStart, i);
      const sealed =
        (r.action === 'chain_start' && sealMatches(r.seal?.legacy, run)) ||
        (runStart === 0 && sealMatches(lastTrunc?.seal?.legacy, run));
      if (!sealed) {
        const s = (runStart === 0 ? lastTrunc?.seal?.legacy : undefined) ?? (r.action === 'chain_start' ? r.seal?.legacy : undefined);
        if (s && run.length < s.count) return fail(runStart, 'deleted', `${plural(s.count - run.length, 'earlier entry', 'earlier entries')} sealed at chain start ${s.count - run.length === 1 ? 'is' : 'are'} missing.`);
        return fail(runStart, 'edited', s ? `Entries written before the chain started were changed.` : `Entry ${runStart + 1} has no seal: it was added or altered outside the app.`);
      }
      report.legacy += run.length;
      runStart = -1;
    }

    if (prev === undefined) {
      if (r.prev !== AUDIT_GENESIS && !(lastTrunc && r.prev === lastTrunc.seal?.cut)) {
        if (r.prev && where.has(r.prev)) return fail(i, 'reordered', `Entry ${i + 1} is out of order.`);
        return fail(i, 'truncated', 'Older entries were removed without the app recording it.');
      }
    } else if (r.prev !== prev) {
      if (r.prev && where.has(r.prev)) return fail(i, 'reordered', `Entry ${i + 1} is out of order.`);
      return fail(i, 'deleted', `An entry just before entry ${i + 1} is missing.`);
    }
    prev = r.hash;
    report.chained++;
  }

  if (runStart >= 0) {
    if (report.chained === 0) report.legacy = rows.length; // chain not started yet: nothing to verify
    else {
      const n = rows.length - runStart;
      return fail(runStart, 'edited', `The newest ${plural(n, 'entry', 'entries')} ${n === 1 ? 'has' : 'have'} no seal: added outside the app or by an older version.`);
    }
  }

  if (opts.notedHead) {
    const h = opts.notedHead.trim().toLowerCase();
    const idx = where.get(h);
    if (idx !== undefined) report.noted = { status: 'present', index: idx, newer: rows.length - 1 - idx };
    else {
      const marker = rows.find((r) => r.action === 'restore' && r.hash && r.seal?.replaced_head === h);
      report.noted = marker ? { status: 'replaced', at: marker.at } : { status: 'missing' };
      if (!marker) {
        return fail(rows.length, 'truncated', report.trimmed
          ? 'The noted head is not in the log. It may have rolled off with older entries, or newer entries were removed.'
          : 'The noted head is not in the log: entries after it were removed or the log was rewritten.');
      }
    }
  }
  return report;
}

/** One-line description for the UI. */
export function describeChain(r: ChainReport): string {
  if (r.broken) return r.broken.message;
  if (r.total === 0) return 'Nothing recorded yet.';
  if (r.chained === 0) return `${plural(r.total, 'entry', 'entries')} from before the integrity chain; it starts with the next change.`;
  const parts = [r.chained === 1 ? 'The 1 sealed entry checks out' : `All ${r.chained} sealed entries check out`];
  if (r.legacy) parts.push(`${r.legacy} earlier ${r.legacy === 1 ? 'entry is' : 'entries are'} sealed as a block`);
  if (r.trimmed) parts.push(`older entries were removed (${r.trimmed.reason === 'storage' ? 'storage full' : 'size limit'})`);
  return `${parts.join('; ')}.`;
}
