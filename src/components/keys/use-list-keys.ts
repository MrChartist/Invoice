/**
 * R20-D5: Tally list keys on a list screen (Transactions, Clients, Expenses bills and Vendors), Tally keys on only:
 * ↑ ↓ Home End PgUp PgDn move a highlight bar, Enter opens the row, Space ticks it where the list has a bulk bar, and
 * Alt+D / Alt+2 press the row's own Delete / Duplicate button. The highlight and movement are the reports' own
 * `useDrillRows` (drill-hooks.ts, C's file, used as is); the keys come through the engine (`useKeyActions('list')`),
 * so no second keydown listener and nothing fires while typing or in a dialog.
 */
import { useDrillRows } from '../books/ledger/drill-hooks';
import { useKeyActions, useKeysState } from '../../lib/keys/use-key-actions';
import type { KeyHandler } from '../../lib/keys/engine';

export interface ListActs {
  tick?: (i: number) => void;
  del?: (i: number) => void;
  dup?: (i: number) => void;
}

const KEY: Record<string, string> = {
  'move.up': 'ArrowUp', 'move.down': 'ArrowDown', 'move.home': 'Home', 'move.end': 'End', 'move.pgup': 'PageUp', 'move.pgdn': 'PageDown', 'drill.list': 'Enter',
};

/** Returns the `<tbody>` id and the props of row `i` (`data-selected` + the highlight class), both only while Tally keys are on. */
export function useListKeys(count: number, open: (i: number) => void, acts: ListActs = {}) {
  const [on] = useKeysState();
  const nav = useDrillRows(count, open);
  const at = (f?: (i: number) => void): KeyHandler | undefined => f && (() => (count ? f(nav.selected) : false));
  const map: Record<string, KeyHandler> = {};
  for (const [id, key] of Object.entries(KEY)) {
    // Enter on a focused button / link keeps its own meaning.
    map[id] = (e) => (!count || (key === 'Enter' && (e.target as Element | null)?.closest?.('a, button, select, summary')) ? false : nav.table.onKeyDown({ key, target: document.body, preventDefault() {} } as unknown as React.KeyboardEvent));
  }
  for (const [id, f] of [['select.list', at(acts.tick)], ['delete.list', at(acts.del)], ['dup.list', at(acts.dup)]] as const) if (f) map[id] = f;
  useKeyActions('list', map, on);
  const row = (i: number) => (on ? nav.row(i) : null);
  return {
    bodyId: on ? nav.bodyId : undefined,
    row: (i: number, cls?: string) => {
      const r = row(i);
      return { 'data-selected': r?.['data-selected'], className: [cls, r?.className].filter(Boolean).join(' ') || undefined };
    },
  };
}
