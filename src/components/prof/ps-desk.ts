/** PS-D desks (Firm, CA desk): the context their views share (props: PS-A's `ps-run.ts` `PsDeskProps`) and small constants. */
import controls from '../../styles/controls.module.css';

export interface PsDeskCtx {
  tick: number;
  /** Run a data-layer call, report its message (or `ok`) or its error, and refresh the view. */
  run: (fn: () => unknown, ok?: string) => boolean;
}
export const sm = `${controls.btnOutline} ${controls.btnSm}`;
export const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const row = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' } as const;
