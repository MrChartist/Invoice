/** CN-B: helpers shared by the contractor-finance views. */
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import { errText, type Notify } from '../transport/shared';

/** Run a data-layer call: toast, refresh; errors as an error toast. Returns the call's result (undefined on error). */
export const runner = (notify: Notify, refresh: () => void) => <T,>(fn: () => T, ok = twT('saved')): T | undefined => {
  try {
    const r = fn();
    notify(ok);
    refresh();
    return r;
  } catch (e) {
    notify(errText(e), 'error');
    return undefined;
  }
};

export const n = (s: string | boolean | undefined) => (s === undefined || s === '' ? undefined : Number(s));
