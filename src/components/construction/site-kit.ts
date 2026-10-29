/** CN-D site desk: shared non-component helpers (strings, layout, the writer runner). */
import { useState } from 'react';
import { sdT, type SdKey } from '../../i18n/areas/construction-r11d';
import { errText, type Notify } from '../transport/shared';

export const T = (k: SdKey, v?: Record<string, string | number>) => sdT(k, v);
export const row = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' } as const;

/** Run a writer: success message (or none), a refresh tick, errors as an error notice. */
export function useRun(notify: Notify) {
  const [tick, setTick] = useState(0);
  return [tick, (fn: () => string | void) => {
    try {
      const m = fn();
      notify(m || T('saved'));
      setTick((t) => t + 1);
    } catch (e) {
      notify(errText(e), 'error');
    }
  }] as const;
}

export const opt = <X,>(xs: readonly X[], id: (x: X) => string, name: (x: X) => string, blank = true) => [...(blank ? [['', '-'] as const] : []), ...xs.map((x) => [id(x), name(x)] as const)];
export const n = (s: string) => Number(s) || 0;
export const monthOf = (d: string) => d.slice(0, 7);
