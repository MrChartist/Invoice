/** MF-C garments desk helpers (this desk only): layout styles, number text, a write guard, ratio text. */
import type { CSSProperties } from 'react';
import type { MfgContext } from '../manufacturing/context';
import { gT } from '../../i18n/areas/mfg-r13c';

export const row: CSSProperties = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' };
export const stack: CSSProperties = { display: 'grid', gap: '0.5rem', margin: '0.75rem 0' };
export const n2 = (n: number) => String(Math.round((n + Number.EPSILON) * 100) / 100);

/** Run a write; toast the result or the error. */
export function run(ctx: MfgContext, fn: () => string | void, after?: () => void): void {
  try {
    const msg = fn();
    after?.();
    ctx.changed(msg || gT('saved'));
  } catch (e) {
    ctx.error((e as Error).message);
  }
}

/** "S1 M2 L2 XL1" / "S=1, M=2" ⇄ { S: 1, … }. */
export function parseRatio(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of s.matchAll(/([A-Za-z0-9+]+?)\s*[=:]?\s*(\d+)(?=[\s,;]|$)/g)) out[m[1].toUpperCase()] = Number(m[2]);
  return out;
}
export const ratioText = (r: Record<string, number> | undefined) => Object.entries(r ?? {}).map(([k, v]) => `${k}${v}`).join(' ');
export const opts = (list: readonly { id: string; name: string }[], blank = true): (readonly [string, string])[] => [...(blank ? [['', '-'] as const] : []), ...list.map((x) => [x.id, x.name] as const)];
export { todayInput as today } from '../../lib/utils';
