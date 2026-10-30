/** MF-B desks (Shop, Moulding, Press): shared non-component helpers (no strings). */
import { useState } from 'react';

export type Done = (msg: string, error?: boolean) => void;
export const row = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' } as const;
export const n = (s: string | undefined) => Number(s) || 0;
export const fmt = (x: number) => x.toLocaleString('en-IN', { maximumFractionDigits: 3 });
/** `[[id, name]]` with a leading blank option. */
export const opt = <X,>(xs: readonly X[], id: (x: X) => string, name: (x: X) => string) => [['', '-'] as const, ...xs.map((x) => [id(x), name(x)] as const)];
/** The value of `fn`, or `fallback` when it throws (live previews of half-typed forms). */
export function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Run a writer: its message (or `ok`), a refresh tick, errors as an error notice. */
export function useRun(onDone: Done, ok: string) {
  const [tick, setTick] = useState(0);
  return [tick, (fn: () => string | void) => {
    try {
      onDone(fn() || ok);
      setTick((t) => t + 1);
    } catch (e) {
      onDone(e instanceof Error ? e.message : String(e), true);
    }
  }] as const;
}
