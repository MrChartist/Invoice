/**
 * R20-A1: the Tally keys claim stub — the only key code on first paint (everything else is the lazy engine).
 * It holds the "Tally keys" mode (`mrchartist_tally_keys`: off / on / on:collapsed) and the layout
 * (`mrchartist_tally_layout`: prime / erp9), both device-local, and one bubble-phase keydown listener. A key in
 * `KEY_CLAIMS` (generated from the registry's global rows; `tests/keys-stub.test.ts` compares them) is
 * preventDefault-ed synchronously, then the engine is imported and runs it. Once the engine is loaded it sees every key.
 */
import { readRaw, writeRaw } from '../storage';
import { APP_VERSION } from '../app-version';
import { isTypingTarget, matchesEvent, parseCombo } from '../../hooks/useHotkeys';

export type KeysLayout = 'prime' | 'erp9';
export interface KeyLike { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; target?: EventTarget | null; preventDefault?: () => void }

const MODE = 'mrchartist_tally_keys';
const LAYOUT = 'mrchartist_tally_layout';
const get = (k: string) => { try { return readRaw(k); } catch { return null; } };
const subs = new Set<() => void>();
let mode: string | null = null;

/** Write a preference (fail-soft) and tell subscribers. */
const put = (k: string, v: string) => {
  if (k === MODE) mode = v;
  try { writeRaw(k, v); } catch { /* in memory only */ }
  subs.forEach((f) => f());
};

/**
 * Stored mode; absent → decided once and stored: a device used before (What's new seen at an older version, Tally
 * terms or report prefs) keeps today's keys (on, ERP 9); a fresh one starts off (TallyPrime when switched on).
 */
export function keysMode(): string {
  if (!mode && !(mode = get(MODE))) {
    const seen = get('mrchartist_whats_new_seen');
    const used = (seen && seen !== APP_VERSION) || get('mrchartist_tally_terms') || get('mrchartist_report_prefs');
    if (used) put(LAYOUT, 'erp9');
    put(MODE, used ? 'on' : 'off');
  }
  return mode!;
}
export const keysOn = (): boolean => keysMode() !== 'off';
export const keysLayout = (): KeysLayout => (get(LAYOUT) === 'erp9' ? 'erp9' : 'prime');
export const setKeysMode = (v: 'on' | 'off' | 'on:collapsed'): void => put(MODE, v);
export const setKeysLayout = (v: KeysLayout): void => put(LAYOUT, v);
export const subscribeKeys = (f: () => void): (() => void) => (subs.add(f), () => void subs.delete(f));

/**
 * Global combos the stub claims before the engine loads (`claimList()` in registry.ts generates it, tested): `~` = only
 * with the mode on (not a Gateway key), `^` = TallyPrime layout only, `%` = Tally.ERP 9 only.
 */
export const KEY_CLAIMS = 'alt+g mod+g mod+f1~ f2 alt+f2 f10 f4 f5 f6 f7 f8 f9 alt+f6^ alt+f5^ mod+f8 mod+f9 alt+f8 alt+f9 alt+f7 mod+f7 mod+shift+f4 f3~ alt+f3~ mod+f3~ alt+k~ alt+y~ alt+o~ mod+alt+n~ mod+alt+r~ mod+alt+b~ f11 f12';

export const onPath = (re: RegExp): boolean => re.test(location.pathname);
let engine: ((e: KeyLike) => boolean) | null = null;
/** The engine registers its dispatcher when its module loads. */
export const attachEngine = (d: (e: KeyLike) => boolean): void => { engine = d; };
/** Navigation for the engine (set by the shell). */
export let keysNavigate: (to: string, state?: unknown) => void = () => undefined;
export const loadKeyEngine = () => import('./engine');

/** The shell's listener (DashboardLayout). Returns the cleanup. */
export function installKeysStub(nav: (to: string, state?: unknown) => void): () => void {
  keysNavigate = nav;
  const on = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.repeat) return;
    if (engine) return void engine(e);
    const live = keysOn();
    if ((!live && !onPath(/^\/gateway(\/|$)/)) || isTypingTarget(e.target) || onPath(/^\/pos(\/|$)/) || document.querySelector('[aria-modal="true"]')) return;
    const hit = KEY_CLAIMS.split(' ').find((t) => matchesEvent(parseCombo(t.replace(/[~^%]+$/, '')), e));
    if (!hit || (!live && hit.includes('~')) || hit.includes(keysLayout() === 'prime' ? '%' : '^')) return;
    e.preventDefault();
    void loadKeyEngine().then(() => engine?.(e));
  };
  window.addEventListener('keydown', on);
  return () => window.removeEventListener('keydown', on);
}
