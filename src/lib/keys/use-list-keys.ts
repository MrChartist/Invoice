/**
 * R20-D5: Tally list keys on a list screen (Transactions, Clients, Expenses bills and Vendors), Tally keys on only:
 * ↑ ↓ Home End PgUp PgDn move a highlight bar, Enter opens the row, Space ticks it where the list has a bulk bar, and
 * Alt+D / Alt+2 press the row's own Delete / Duplicate button. The keys come through the engine
 * (`useKeyActions('list')`), so no second keydown listener and nothing fires while typing or in a dialog.
 *
 * The movement is the same as the reports' `useDrillRows` (books/ledger/drill-hooks.ts) — a local equivalent, because
 * importing drill-hooks splits it (and the ledger stylesheet) out of the Books chunk into three new chunks whose names
 * land in the first-paint preload map (+112 B gz). Without a stylesheet this hook joins the `f-keys` chunk instead.
 */
import { useEffect, useId, useState } from 'react';
import { useKeyActions, useKeysState } from './use-key-actions';
import type { KeyHandler } from './engine';

export interface ListActs {
  tick?: (i: number) => void;
  del?: (i: number) => void;
  dup?: (i: number) => void;
}

/** The new highlight for a move key (pure; tested). */
export const moveTo = (key: string, at: number, count: number): number =>
  Math.max(0, Math.min(count - 1, key === 'move.home' ? 0 : key === 'move.end' ? count - 1 : at + ({ 'move.up': -1, 'move.down': 1, 'move.pgup': -10, 'move.pgdn': 10 } as Record<string, number>)[key]));

const MOVES = ['move.up', 'move.down', 'move.home', 'move.end', 'move.pgup', 'move.pgdn'];
const HL = { background: 'var(--primary-glow)', outline: '2px solid var(--ring)', outlineOffset: '-2px' };

/** Returns the `<tbody>` id and the props of row `i` (`data-selected` + the highlight), both only while Tally keys are on. */
export function useListKeys(count: number, open: (i: number) => void, acts: ListActs = {}) {
  const [on] = useKeysState();
  const bodyId = useId();
  const [sel, setSel] = useState(0);
  const at = Math.min(sel, Math.max(count - 1, 0));
  useEffect(() => {
    if (on) document.getElementById(bodyId)?.querySelector('[data-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [on, at, bodyId]);
  const map: Record<string, KeyHandler> = {};
  for (const id of MOVES) map[id] = () => (count ? setSel(moveTo(id, at, count)) : false);
  // Enter on a focused button / link keeps its own meaning.
  map['drill.list'] = (e) => (!count || (e.target as Element | null)?.closest?.('a, button, select, summary') ? false : open(at));
  for (const [id, f] of [['select.list', acts.tick], ['delete.list', acts.del], ['dup.list', acts.dup]] as const) if (f) map[id] = () => (count ? f(at) : false);
  useKeyActions('list', map, on);
  return {
    bodyId: on ? bodyId : undefined,
    row: (i: number) => (on && i === at ? { 'data-selected': 'true', style: HL } : {}),
  };
}
