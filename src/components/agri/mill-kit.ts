/** AG-C mill desk: shared non-component helpers (strings, layout, the writer runner). */
import { useState } from 'react';
import { mlT, type MlKey } from '../../i18n/areas/agri-r12c';
import { trT } from '../../i18n/areas/trade-r8c';

export type Done = (msg: string, error?: boolean) => void;
export const T = (k: MlKey, v?: Record<string, string | number>) => mlT(k, v);
/** Common words and the stock-statement rows, shared with the R8 trade area (already in the bundle). */
export const W = (k: Parameters<typeof trT>[0], v?: Record<string, string | number>) => trT(k, v);
export const row = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' } as const;
export const n = (s: string) => Number(s) || 0;
export const q = (kg: number) => (Math.round((kg / 100) * 1000) / 1000).toLocaleString('en-IN');
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Run a writer: success message (or "Saved."), a refresh tick, errors as an error notice. */
export function useRun(onDone: Done) {
  const [tick, setTick] = useState(0);
  return [tick, (fn: () => string | void) => {
    try {
      onDone(fn() || T('saved'));
      setTick((t) => t + 1);
    } catch (e) {
      onDone(errText(e), true);
    }
  }] as const;
}

export const opt = <X,>(xs: readonly X[], id: (x: X) => string, name: (x: X) => string) => [['', '—'] as const, ...xs.map((x) => [id(x), name(x)] as const)];
