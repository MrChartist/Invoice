/** PS-D desks (Firm, CA desk): the props Time mounts them with and the context their views share. Types and two constants. */
import controls from '../../styles/controls.module.css';

export type PsNotify = (message: string, tone?: 'success' | 'error' | 'info') => void;
export interface PsDeskProps { view?: string; notify: PsNotify }
export interface PsDeskCtx {
  tick: number;
  /** Run a data-layer call, report its message (or `ok`) or its error, and refresh the view. */
  run: (fn: () => unknown, ok?: string) => boolean;
}
export const sm = `${controls.btnOutline} ${controls.btnSm}`;
export const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
