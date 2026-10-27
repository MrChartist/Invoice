/**
 * PS-A5: the one writer of the record key `ps` — every package builds its sub-object through `psSnapshot(kind, parts)`
 * (empty parts dropped), so documents carry only what they print. Templates read it from the record only (Critical
 * Rule 3); a document without `ps` prints exactly as before. Pure.
 */
import type { PsSnapshot } from '../../types/prof-r14';

const empty = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length);

export function psSnapshot(kind: PsSnapshot['kind'], parts: Omit<PsSnapshot, 'kind'>): PsSnapshot {
  const out: Record<string, unknown> = kind ? { kind } : {};
  for (const [k, v] of Object.entries(parts)) if (!empty(v)) out[k] = v;
  return out as PsSnapshot;
}

/** Merge a package's parts into a document's existing snapshot (line maps merged per line). */
export function mergePs(prev: PsSnapshot | undefined, parts: Omit<PsSnapshot, 'kind'>, kind?: PsSnapshot['kind']): PsSnapshot {
  const lines = { ...prev?.lines };
  for (const [id, l] of Object.entries(parts.lines ?? {})) lines[id] = { ...lines[id], ...l };
  return psSnapshot(kind ?? prev?.kind, { ...prev, ...parts, lines });
}
