/**
 * Tally-style keys for a master form: Enter moves to the next field (Enter on a button presses
 * it), Ctrl+A accepts, Esc goes back. Alt+C on a field marked `data-create="ledger|group"` asks the
 * caller to create that master on the fly.
 */
import { useEffect, useRef, type RefObject } from 'react';

export interface MasterKeyHandlers {
  onAccept: () => void;
  onBack: () => void;
  onCreate?: (kind: 'ledger' | 'group', field: HTMLElement) => void;
}

const FIELDS = 'input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button[data-enter]:not([disabled])';

/** True for Alt+C (the key other screens can also listen for to open create-on-the-fly). */
export function isAltC(e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'key' | 'code'>): boolean {
  return e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyC' || e.key.toLowerCase() === 'c');
}

export function useMasterKeys(ref: RefObject<HTMLElement | null>, handlers: MasterKeyHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      const h = latest.current;
      const t = e.target as HTMLElement;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
        // Ctrl+A inside a text box normally selects all: Tally users expect "accept" here.
        e.preventDefault();
        h.onAccept();
        return;
      }
      if (e.key === 'Escape') {
        // Leave Escape to an open native picker / nested dialog.
        if (t.closest('[role="dialog"]') && t.closest('[role="dialog"]') !== root.closest('[role="dialog"]')) return;
        e.preventDefault();
        e.stopPropagation();
        h.onBack();
        return;
      }
      if (isAltC(e) && h.onCreate) {
        const kind = (t.closest('[data-create]') as HTMLElement | null)?.dataset.create;
        if (kind === 'ledger' || kind === 'group') {
          e.preventDefault();
          h.onCreate(kind, t);
        }
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'A') return;
        const list = Array.from(root.querySelectorAll<HTMLElement>(FIELDS)).filter((el) => el.offsetParent !== null || el === t);
        const i = list.indexOf(t);
        if (i < 0) return;
        e.preventDefault();
        const next = list[i + 1];
        if (next) {
          next.focus();
          if (next instanceof HTMLInputElement && (next.type === 'text' || next.type === 'search' || next.inputMode === 'decimal')) next.select();
        } else {
          h.onAccept();
        }
      }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [ref]);
}
