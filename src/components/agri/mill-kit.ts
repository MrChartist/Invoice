/** AG-C mill desk: shared non-component helpers (strings, layout, the writer runner). */
import { useState } from 'react';
import { mlT, type MlKey } from '../../i18n/areas/agri-r12c';

export type Done = (msg: string, error?: boolean) => void;
export const T = (k: MlKey, v?: Record<string, string | number>) => mlT(k, v);
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
