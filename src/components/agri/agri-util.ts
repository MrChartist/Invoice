/** Round 12 desk helpers (non-components) shared by the AG-A views: run-and-report, the row style, money. */
import { useState } from 'react';

export type Done = (msg: string, error?: boolean) => void;
export const wrap = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' } as const;

/** Run a data-layer call, then report its message (or the error) and re-render. */
export function useRun(onDone: Done) {
  const [tick, setTick] = useState(0);
  const run = (fn: () => string | void) => {
    try {
      const m = fn();
      setTick((t) => t + 1);
      if (m) onDone(m);
    } catch (err) {
      onDone((err as Error).message, true);
    }
  };
  return { tick, run };
}

export const money = (n: unknown) => `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
