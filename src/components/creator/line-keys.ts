/**
 * Tally-style keyboard entry for the line-items grid. Pure so it can be unit-tested.
 *
 *  - Enter in the LAST field of a line  -> next line's first field (a new line when it was the last line)
 *  - Alt+↑ / Alt+↓                      -> move the current line up / down
 *  - Ctrl/⌘+Enter                       -> save (handled by the page, not here)
 */

import type { Suggestion } from '../../lib/suggest';
import { findByShortCode } from '../../lib/scan';

export interface KeyLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export type LineKeyAction =
  | { type: 'move'; direction: -1 | 1 }
  | { type: 'add-line' }
  | { type: 'next-line' }
  | null;

export interface LineKeyContext {
  /** The focused control is the last editable field of its line. */
  isLastCell: boolean;
  isLastLine: boolean;
}

export function lineKeyAction(e: KeyLike, ctx: LineKeyContext): LineKeyAction {
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    return { type: 'move', direction: e.key === 'ArrowUp' ? -1 : 1 };
  }
  if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && ctx.isLastCell) {
    return ctx.isLastLine ? { type: 'add-line' } : { type: 'next-line' };
  }
  return null;
}

/** Ctrl/⌘+Enter anywhere on the page means "save". */
export function isSaveShortcut(e: KeyLike): boolean {
  return e.key === 'Enter' && Boolean(e.ctrlKey || e.metaKey) && !e.altKey;
}

/**
 * 8E (8.141): an item whose short code is exactly what was typed in the item name ("SB") goes to the top
 * of the suggestions, marked `exact` so Enter picks it.
 */
export function shortCodeFirst<T extends { name: string; short_code?: string }>(query: string, rows: readonly T[], list: Suggestion<T>[]): Suggestion<T>[] {
  const hit = findByShortCode(query.trim(), rows);
  if (!hit) return list;
  const top = list.find((s) => s.row === hit);
  return [{ ...(top ?? { row: hit, label: hit.name, score: 0 }), exact: true }, ...list.filter((s) => s.row !== hit)];
}
