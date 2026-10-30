/**
 * MF-B1 release guard (tiny, imported by MF-A's `mf-ops.ts` on the production-order release path): a drawing whose live
 * revision is on `hold` blocks the release of an order of its item unless the owner overrode that revision (audited in
 * `mf-drawings.ts`). Reads `drawings` only while the `fabrication` pack is on. Types only otherwise.
 */
import type { Drawing, DrawingRevision } from '../../types/mfg-r13';
import { peekTable } from '../storage';
import { MF_TABLES } from './mf-shared';

const key = (s: string | undefined) => String(s ?? '').trim().toUpperCase();

/** The current revision (else the newest that is not superseded, else the newest). */
export function currentRev(d: Pick<Drawing, 'revisions'>): DrawingRevision | undefined {
  const r = d.revisions ?? [];
  return r.find((x) => x.status === 'current') ?? [...r].reverse().find((x) => x.status !== 'superseded') ?? r[r.length - 1];
}

/** '' or why an order of `itemId` may not be released. */
export function holdBlock(itemId: string, drawings: readonly Drawing[]): string {
  for (const d of drawings) {
    if (d.item_id !== itemId) continue;
    const cur = currentRev(d);
    if (cur?.status === 'hold' && key(d.release_override?.rev) !== key(cur.rev)) return `Drawing ${d.number} rev ${cur.rev} is on hold: release it in the drawing register (or the owner overrides it) first.`;
  }
  return '';
}

/** The guard on live data: `packs` = the company's packs (the caller already has them). */
export const releaseHold = (itemId: string, packs: readonly string[]): string =>
  packs.includes('fabrication') ? holdBlock(itemId, peekTable<Drawing>(MF_TABLES.drawings).filter((d) => d && Array.isArray(d.revisions))) : '';
