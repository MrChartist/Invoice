/** R15: Trips desk props, the write runner and a percentage formatter (shared by the views). */
export type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
export interface TvViewProps { notify: Notify }

/** Run a write; report its error, or `ok`. Returns the result (undefined on error). */
export const runWith = (notify: Notify) => <T>(fn: () => T, ok?: string): T | undefined => {
  try {
    const r = fn();
    if (ok) notify(ok);
    return r;
  } catch (e) {
    notify((e as Error).message, 'error');
    return undefined;
  }
};

export const pct = (n: number | null): string => (n === null ? '—' : `${n.toFixed(1)}%`);
