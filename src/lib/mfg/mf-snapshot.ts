/**
 * MF-A5: the ONE helper every package uses to write the `mf` snapshot on an invoice (record key `mf`, kept verbatim by
 * `normalizeRecord`). B writes `drawing` / `print` / `scrap` (+ per-line drawing / rev / heat), C `cmt` (+ style / lot /
 * sizes), D `food` / `export_aa` (+ batch / packed on / best before / MRP); A the header. Empty parts are dropped, so an
 * old document without `mf` stays byte-identical. Templates read it from the record only.
 */
import type { MfLineSnap, MfSnapshot } from '../../types/mfg-r13';

const clean = <T extends object>(o: T | undefined): T | undefined => {
  if (!o) return undefined;
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))) as T;
  return Object.keys(out).length ? out : undefined;
};

const PARTS = ['header', 'drawing', 'print', 'scrap', 'cmt', 'food', 'export_aa'] as const;

export function mfSnapshot(kind: MfSnapshot['kind'], parts: Omit<MfSnapshot, 'kind'> = {}): MfSnapshot {
  const out: MfSnapshot = kind ? { kind } : {};
  for (const k of PARTS) {
    const v = clean(parts[k] as object | undefined);
    if (v) (out as Record<string, unknown>)[k] = v;
  }
  const lines = parts.lines ? Object.fromEntries(Object.entries(parts.lines).map(([id, l]) => [id, clean<MfLineSnap>(l)]).filter(([, l]) => l)) : {};
  if (Object.keys(lines).length) out.lines = lines as Record<string, MfLineSnap>;
  if (parts.declaration?.trim()) out.declaration = parts.declaration.trim();
  if (parts.recycled_pct !== undefined) out.recycled_pct = parts.recycled_pct;
  return out;
}
