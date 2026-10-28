/** MF-D desks: shared constants and the run-and-report helper (see `mfd-ui.tsx`). */
import type { MfgContext } from '../manufacturing/context';
import controls from '../../styles/controls.module.css';

export const row = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' } as const;
export const sm = `${controls.btnOutline} ${controls.btnSm}`;
export const rs = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
/** Run a data-layer call and report its message or error through the desk context. */
export const run = (ctx: MfgContext, fn: () => string | void) => {
  try {
    const m = fn();
    if (m) ctx.changed(m);
  } catch (e) {
    ctx.error((e as Error).message);
  }
};
