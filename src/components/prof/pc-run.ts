/** R14 PS-C desk: run a write and report it. */
import { pcT, type PcKey } from '../../i18n/areas/prof-r14c-export';

import type { Notify } from './ps-run';

export type { Notify };

/** Run a write; report the message (a reason key from the engines is translated) or the error. */
export function runner(notify: Notify, done: () => void) {
  return (fn: () => string | void): boolean => {
    try {
      notify(fn() || `${pcT('save')} ✓`);
      done();
      return true;
    } catch (e) {
      const m = (e as Error).message;
      notify(m in pcT.en ? pcT(m as PcKey) : m, 'error');
      return false;
    }
  };
}
