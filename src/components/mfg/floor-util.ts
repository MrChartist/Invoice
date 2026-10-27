/** MF-A floor desk helpers that are not components (this desk only): layout, number format, people, entry submit. */
import { useMemo } from 'react';
import type { JobCardEntry, MfOrderOp } from '../../types/mfg-r13';
import type { ProductionOrder } from '../../types/production-r4';
import type { MfgContext } from '../manufacturing/context';
import { reportEntry } from '../../lib/mfg/mf-jobcards';
import { getTable } from '../../lib/storage';
import { fT } from '../../i18n/areas/mfg-r13a';

export const row = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' } as const;
export const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

export type EntryDraft = Partial<JobCardEntry> & { opKind?: string; opId?: string };

export function usePeople(): { employees: [string, string][]; karigars: [string, string][] } {
  return useMemo(() => ({
    employees: getTable<{ id: string; name: string; active?: boolean }>('employees').filter((e) => e?.id && e.active !== false).map((e) => [e.id, e.name]),
    karigars: getTable<{ id: string; name: string; mf?: { karigar?: boolean } }>('vendors').filter((x) => x?.mf?.karigar).map((x) => [x.id, x.name]),
  }), []);
}

/** Save an entry draft on an order's operation (shared with the operator screen). */
export function submitEntry(ctx: MfgContext, order: ProductionOrder, op: MfOrderOp, d: EntryDraft, oos: boolean): boolean {
  try {
    const { opKind, opId, ...e } = d;
    const { card, warnings } = reportEntry(order.id, op.id, { ...e, ...(opId ? { operator: { kind: opKind === 'karigar' ? 'karigar' : 'employee', id: opId } } : {}) }, { allowOutOfSequence: oos });
    ctx.changed([fT('entrySaved', { number: card.number }), ...warnings].join(' '));
    return true;
  } catch (err) {
    ctx.error((err as Error).message);
    return false;
  }
}

