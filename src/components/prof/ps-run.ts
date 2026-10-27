/** R14: desk props and the write runner shared by the professional desks. */
export type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
export interface PsDeskProps { view?: string; notify: Notify }

/** Run a write; report the error or the success message. Returns the result (undefined on error). */
export function runWith(notify: Notify) {
  return <T>(fn: () => T, ok?: string): T | undefined => {
    try {
      const r = fn();
      if (ok) notify(ok);
      return r;
    } catch (e) {
      notify((e as Error).message, 'error');
      return undefined;
    }
  };
}

export const pct = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : `${n}%`);
