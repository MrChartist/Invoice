/**
 * R20-A2: a screen claims a key scope and handles registry rows by id — no second keydown listener per screen.
 *
 *   useKeyActions('report', { filter: () => setFilterOpen(true), 'delete.row': (e, row) => remove(focused) });
 *
 * Handlers are read through a ref (inline functions are fine); the registration lives while the component is mounted
 * and `enabled`. Return `false` from a handler to pass the key on (to a less specific scope, or the browser).
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { registerKeyActions, subscribeKeyActions, type KeyHandler } from './engine';
import { keysLayout, keysOn, subscribeKeys } from './stub';
import type { KeyScope } from './registry';

export function useKeyActions(scope: KeyScope, handlers: Record<string, KeyHandler>, enabled = true): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  const ids = Object.keys(handlers).sort().join(' ');
  useEffect(() => {
    if (!enabled) return;
    const map: Record<string, KeyHandler> = {};
    for (const id of ids.split(' ')) if (id) map[id] = (e, row) => ref.current[id]?.(e, row);
    return registerKeyActions(scope, map);
  }, [scope, ids, enabled]);
}

/** Re-render on a mode / layout switch or a registration change; returns [on, layout]. */
export function useKeysState(): readonly [boolean, ReturnType<typeof keysLayout>, number] {
  const tick = useSyncExternalStore(subscribeAll, version);
  return [keysOn(), keysLayout(), tick] as const;
}
let v = 0;
const version = () => v;
function subscribeAll(f: () => void): () => void {
  const bump = () => {
    v++;
    f();
  };
  const a = subscribeKeys(bump);
  const b = subscribeKeyActions(bump);
  return () => {
    a();
    b();
  };
}
