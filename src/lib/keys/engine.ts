/**
 * R20-A1 / A2: the lazy key engine. The shell stub (`stub.ts`) hands it every keydown once loaded. It finds the rows
 * of the registry that match the combo in the current layout, keeps those that may fire here (built, mode, rights,
 * browser, not in a field unless the row allows it, no dialog open, not on /pos) and runs the most specific one:
 * field → row → screen → global. A non-global row fires only through a handler a screen registered with
 * `registerKeyActions(scope, { [rowId]: fn })` (React: `useKeyActions`, use-key-actions.ts); a global row runs its
 * handler if one is registered, else its route / Gateway dialog. A handler returning `false` passes the key on.
 */
import { can } from '../access';
import { isApplePlatform, isTypingTarget } from '../../hooks/useHotkeys';
import { KEY_ROWS, NEVER_CLAIM, comboFor, comboOf, isBuilt, rowById, scopesOfPath, type KeyRow, type KeyScope } from './registry';
import { attachEngine, keysLayout, keysNavigate, keysOn, onPath, type KeyLike } from './stub';

export type KeyHandler = (e: KeyLike, row: KeyRow) => boolean | void;
interface Reg { scope: KeyScope; map: Record<string, KeyHandler> }

const regs: Reg[] = [];
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
const RANK = (s: KeyScope) => (s.startsWith('field:') ? 0 : s === 'reportRow' || s === 'list' || s === 'line' ? 1 : s === 'global' ? 3 : 2);

/** Register handlers by row id for a scope (the screen's); returns the unregister. The newest registration wins. */
export function registerKeyActions(scope: KeyScope, map: Record<string, KeyHandler>): () => void {
  const r: Reg = { scope, map };
  regs.push(r);
  notify();
  return () => {
    const i = regs.indexOf(r);
    if (i >= 0) regs.splice(i, 1);
    notify();
  };
}
/** Scopes some mounted screen registered (for "This screen"). */
export const activeScopes = (): KeyScope[] => regs.map((r) => r.scope);
export const subscribeKeyActions =(f: () => void): (() => void) => (subs.add(f), () => void subs.delete(f));

const handlerOf = (row: KeyRow): KeyHandler | undefined => {
  for (let i = regs.length - 1; i >= 0; i--) if (regs[i].scope === row.scope && regs[i].map[row.id]) return regs[i].map[row.id];
  return undefined;
};

/** Browser family for `browser: 'unsafe:<name>'` rows. */
export function browserName(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  return /firefox\//i.test(ua) ? 'firefox' : /chrome|chromium|crios|edg\//i.test(ua) ? 'chromium' : /safari\//i.test(ua) ? 'safari' : 'other';
}

/** May this row fire now (mode, built, rights, browser, Apple-only never-claim keys)? */
export function rowLive(row: KeyRow, combo: string, gateway = onPath(/^\/gateway(\/|$)/)): boolean {
  if (!isBuilt(row) || !combo) return false;
  if (row.mode === 'tally' && !keysOn() && !(row.gw && gateway)) return false;
  if (row.need && !can(row.need)) return false;
  if (row.browser === `unsafe:${browserName()}`) return false;
  return !(isApplePlatform() && NEVER_CLAIM.some((n) => n.apple && n.combo === combo));
}

/** The route a global row opens here (the Debit note opens the purchase-return note on /expenses). */
export function rowRoute(row: KeyRow, path = location.pathname): string | undefined {
  if (row.on && path.startsWith(row.on.path)) return !row.on.need || can(row.on.need) ? row.on.route : undefined;
  return row.route;
}

/** Runs a global row's default (route or Gateway dialog). */
function runDefault(row: KeyRow): boolean {
  if (row.go) {
    keysNavigate('/gateway', { tally: row.go });
    return true;
  }
  const to = rowRoute(row);
  if (!to) return false;
  keysNavigate(to);
  return true;
}

/** Candidates for a combo in this context, most specific first. Pure enough to test with a fake target. */
export function candidates(combo: string, target: EventTarget | null | undefined): { row: KeyRow; fn?: KeyHandler }[] {
  const layout = keysLayout();
  const typing = isTypingTarget(target ?? null);
  const el = target as Element | null;
  const out: { row: KeyRow; fn?: KeyHandler; r: number }[] = [];
  for (const row of KEY_ROWS) {
    if (row.ext || comboFor(row, layout) !== combo || !rowLive(row, combo)) continue;
    const field = row.scope.startsWith('field:');
    if (field && !el?.closest?.(`[data-key-field="${row.scope.slice(6)}"]`)) continue;
    if (typing && !field && (!row.inField || combo.startsWith('mod+alt+'))) continue;
    const fn = handlerOf(row);
    if (!fn && (row.scope !== 'global' || (!row.go && !rowRoute(row)))) continue;
    out.push({ row, fn, r: RANK(row.scope) });
  }
  return out.sort((a, b) => a.r - b.r);
}

/** The engine's keydown entry (also the stub's replay of the first claimed key). True when a row ran. */
export function dispatchKey(e: KeyLike): boolean {
  if (onPath(/^\/pos(\/|$)/) || document.querySelector('[aria-modal="true"]')) return false;
  const combo = comboOf(e);
  for (const { row, fn } of candidates(combo, e.target)) {
    const done = fn ? fn(e, row) !== false : runDefault(row);
    if (done) {
      e.preventDefault?.();
      return true;
    }
  }
  return false;
}

const NAMED: Record<string, string> = { escape: 'Escape', enter: 'Enter', space: ' ', pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End', arrowup: 'ArrowUp', arrowdown: 'ArrowDown' };

/** Run a row as if its key was pressed (Key bar, Vouchers sheet). `ext` rows replay their key to their own listener. */
export function runKeyRow(id: string): boolean {
  const row = rowById(id);
  if (!row) return false;
  const fn = handlerOf(row);
  if (fn) return fn({ key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, row) !== false;
  if (row.scope === 'global' && !row.ext) return runDefault(row);
  const p = comboFor(row, keysLayout()).split('+');
  const k = p.pop() ?? '';
  const key = NAMED[k] ?? (/^f\d+$/.test(k) ? k.toUpperCase() : k);
  const code = /^[a-z]$/.test(k) ? `Key${k.toUpperCase()}` : /^\d$/.test(k) ? `Digit${k}` : '';
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ctrlKey: p.includes('mod'), altKey: p.includes('alt'), shiftKey: p.includes('shift') }),
  );
  return true;
}

/** Rows for the Key bar / "This screen": the screen's scopes (route + registered) first, then the handy globals. */
export function screenRows(path = location.pathname): KeyRow[] {
  const scopes = new Set<KeyScope>([...scopesOfPath(path), ...regs.map((r) => r.scope)]);
  scopes.delete('global');
  const layout = keysLayout();
  const seen = new Set<string>();
  const ok = (r: KeyRow) => {
    const c = comboFor(r, layout);
    if (!c || seen.has(c) || !rowLive(r, c)) return false;
    seen.add(c);
    return true;
  };
  const scoped = KEY_ROWS.filter((r) => scopes.has(r.scope) && r.bar !== false && (r.ext || handlerOf(r)) && ok(r));
  const globals = BAR_GLOBALS.map((id) => rowById(id)!).filter((r) => (r.ext || handlerOf(r) || r.go || rowRoute(r, path)) && ok(r));
  return [...scoped, ...globals];
}
/** Global rows every Key bar ends with. */
export const BAR_GLOBALS = ['vouchers', 'goto', 'date', 'period', 'help', 'keys', 'back'];

/** The shell reaches the lazy key UI through the engine chunk (one dynamic import on first paint). */
export const loadKeysHost = () => import('../../components/keys/KeysHost');
export { paletteActions } from './palette';

attachEngine(dispatchKey);
