import { useEffect, useRef } from 'react';

/**
 * Declarative keyboard shortcuts.
 *
 *   useHotkeys({ 'mod+k': openPalette, '/': openPalette, '?': openHelp, 'g d': goDashboard });
 *
 * - `mod` is ⌘ on Apple platforms and Ctrl elsewhere.
 * - A space separates a two-key sequence ("g d"), which must finish within 900 ms.
 * - Combos without a modifier are ignored while typing in an input, textarea,
 *   select or contenteditable element.
 * - `mod+s` and `mod+p` belong to the invoice editor (save / print) and are
 *   refused here so the two can never fight.
 */

export type HotkeyHandler = (event: KeyboardEvent) => void;

export interface HotkeyOptions {
  handler: HotkeyHandler;
  /** Fire even while typing in a field. Modifier combos always do. */
  allowInInput?: boolean;
  /** Skip `preventDefault()`. */
  passive?: boolean;
}

export type HotkeyMap = Record<string, HotkeyHandler | HotkeyOptions>;

export const RESERVED_COMBOS = ['mod+s', 'mod+p'] as const;
const SEQUENCE_TIMEOUT_MS = 900;

export interface ParsedCombo {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
};

export function parseCombo(combo: string): ParsedCombo {
  const s = combo.trim().toLowerCase();
  let raw = s;
  let modPart = '';
  if (s.endsWith('++')) {
    raw = '+';
    modPart = s.slice(0, -2);
  } else if (s.includes('+') && s !== '+') {
    const idx = s.lastIndexOf('+');
    raw = s.slice(idx + 1);
    modPart = s.slice(0, idx);
  }
  const key = KEY_ALIASES[raw] ?? raw;
  const mods = new Set(modPart ? modPart.split('+') : []);
  return {
    key,
    mod: mods.has('mod') || mods.has('ctrl') || mods.has('cmd') || mods.has('meta'),
    shift: mods.has('shift'),
    alt: mods.has('alt') || mods.has('option'),
  };
}

export function isReservedCombo(combo: string): boolean {
  const p = parseCombo(combo);
  return p.mod && !p.shift && !p.alt && (p.key === 's' || p.key === 'p');
}

export function isApplePlatform(nav?: { platform?: string; userAgent?: string }): boolean {
  const n = nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  if (!n) return false;
  return /mac|iphone|ipad|ipod/i.test(n.platform || n.userAgent || '');
}

/** Matches an event against a parsed single-key combo. */
export function matchesEvent(parsed: ParsedCombo, e: KeyboardEvent): boolean {
  const modDown = e.ctrlKey || e.metaKey;
  if (parsed.mod !== modDown) return false;
  if (parsed.alt !== e.altKey) return false;
  const key = e.key.toLowerCase();
  // Printable symbols such as "?" already encode Shift; only enforce Shift for letters/named keys.
  const symbol = key.length === 1 && !/[a-z0-9]/.test(key);
  if (!symbol && parsed.shift !== e.shiftKey) return false;
  return key === parsed.key;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

const DISPLAY: Record<string, string> = {
  escape: 'Esc',
  enter: 'Enter',
  ' ': 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

/** Human labels for a combo: ["⌘", "K"] on Apple, ["Ctrl", "K"] elsewhere. A sequence yields ["G", "then", "D"]. */
export function formatCombo(combo: string, apple: boolean = isApplePlatform()): string[] {
  const steps = combo.trim().split(/\s+/);
  const out: string[] = [];
  steps.forEach((step, i) => {
    if (i > 0) out.push('then');
    const p = parseCombo(step);
    if (p.mod) out.push(apple ? '⌘' : 'Ctrl');
    if (p.alt) out.push(apple ? '⌥' : 'Alt');
    if (p.shift) out.push(apple ? '⇧' : 'Shift');
    out.push(DISPLAY[p.key] ?? p.key.toUpperCase());
  });
  return out;
}

export interface ShortcutInfo {
  combo: string;
  label: string;
  group: 'General' | 'Go to' | 'Invoice editor';
  /** Owned and handled elsewhere (listed for reference only). */
  external?: boolean;
}

/** Single source of truth for the shortcuts overlay. */
export const GLOBAL_SHORTCUTS: ShortcutInfo[] = [
  { combo: 'mod+k', label: 'Open command palette', group: 'General' },
  { combo: '/', label: 'Search (when not typing)', group: 'General' },
  { combo: '?', label: 'Show keyboard shortcuts', group: 'General' },
  { combo: 'escape', label: 'Close dialog or palette', group: 'General' },
  { combo: 'g d', label: 'Go to Dashboard', group: 'Go to' },
  { combo: 'g i', label: 'Go to New invoice', group: 'Go to' },
  { combo: 'g t', label: 'Go to Invoices', group: 'Go to' },
  { combo: 'g c', label: 'Go to Clients', group: 'Go to' },
  { combo: 'g s', label: 'Go to Settings', group: 'Go to' },
  { combo: 'mod+s', label: 'Save invoice', group: 'Invoice editor', external: true },
  { combo: 'mod+p', label: 'Open preview (print or PDF)', group: 'Invoice editor', external: true },
];

interface Entry {
  steps: ParsedCombo[];
  opts: HotkeyOptions;
}

function normalise(map: HotkeyMap): Entry[] {
  const entries: Entry[] = [];
  for (const [combo, value] of Object.entries(map)) {
    if (isReservedCombo(combo)) {
      if (import.meta.env?.DEV) {
        console.warn(`[useHotkeys] "${combo}" is reserved for the invoice editor and was ignored.`);
      }
      continue;
    }
    const opts = typeof value === 'function' ? { handler: value } : value;
    entries.push({ steps: combo.trim().split(/\s+/).map(parseCombo), opts });
  }
  return entries;
}

export function useHotkeys(map: HotkeyMap, enabled = true): void {
  const mapRef = useRef(map);
  useEffect(() => {
    mapRef.current = map;
  });

  useEffect(() => {
    if (!enabled) return;
    let pending: ParsedCombo[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      pending = [];
      if (timer) clearTimeout(timer);
      timer = undefined;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      const typing = isTypingTarget(e.target);
      const entries = normalise(mapRef.current);

      const tryFire = (candidate: Entry, depth: number): boolean => {
        const step = candidate.steps[depth];
        if (!step || !matchesEvent(step, e)) return false;
        const hasMod = candidate.steps.some((s) => s.mod);
        if (typing && !hasMod && !candidate.opts.allowInInput) return false;
        return true;
      };

      // Continue a pending sequence first.
      if (pending.length) {
        const depth = pending.length;
        const hit = entries.find(
          (en) =>
            en.steps.length > depth &&
            pending.every((p, i) => en.steps[i].key === p.key && en.steps[i].mod === p.mod) &&
            tryFire(en, depth),
        );
        if (hit && hit.steps.length === depth + 1) {
          reset();
          if (!hit.opts.passive) e.preventDefault();
          hit.opts.handler(e);
          return;
        }
        reset();
        if (hit) return;
      }

      // Single-step combos.
      const single = entries.find((en) => en.steps.length === 1 && tryFire(en, 0));
      if (single) {
        if (!single.opts.passive) e.preventDefault();
        single.opts.handler(e);
        return;
      }

      // Start of a sequence.
      const starter = entries.find((en) => en.steps.length > 1 && tryFire(en, 0));
      if (starter) {
        pending = [starter.steps[0]];
        timer = setTimeout(reset, SEQUENCE_TIMEOUT_MS);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      reset();
    };
  }, [enabled]);
}
