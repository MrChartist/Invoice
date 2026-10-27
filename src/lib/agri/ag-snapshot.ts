/**
 * AG-A5: the ONE helper every package uses to write the `ag` snapshot on an invoice (record key `ag`, kept verbatim by
 * `normalizeRecord`). B writes `milk` (+ per-line fat / SNF), C `cmr`, D `rent` / `inputs`; A the declaration. Empty
 * parts are dropped so an old document without `ag` stays byte-identical. Templates read it from the record only.
 */
import type { AgLineSnap, AgSnapshot } from '../../types/agri-r12';

const clean = <T extends object>(o: T | undefined): T | undefined => {
  if (!o) return undefined;
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))) as T;
  return Object.keys(out).length ? out : undefined;
};

export function agSnapshot(kind: AgSnapshot['kind'], parts: Omit<Partial<AgSnapshot>, 'kind'> = {}): AgSnapshot {
  const lines = parts.lines ? Object.fromEntries(Object.entries(parts.lines).map(([k, v]) => [k, clean<AgLineSnap>(v)]).filter(([, v]) => v)) : undefined;
  const out: AgSnapshot = { kind };
  for (const k of ['header', 'milk', 'cmr', 'rent', 'inputs'] as const) {
    const v = clean(parts[k] as object | undefined);
    if (v) (out as unknown as Record<string, unknown>)[k] = v;
  }
  if (lines && Object.keys(lines).length) out.lines = lines as Record<string, AgLineSnap>;
  if (parts.declaration?.trim()) out.declaration = parts.declaration.trim();
  return out;
}
