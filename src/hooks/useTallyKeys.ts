import { useEffect, useRef } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { can } from '../lib/access';
import { resolveTallyKey } from '../lib/tally-keys';
import { isTypingTarget } from './useHotkeys';

/**
 * Global Tally function keys (F2, F4–F9, Ctrl+F8/F9, F11, F12, Alt+G / Ctrl+G, Ctrl+/).
 * Listens in the bubble phase, so screens that own a key (the voucher form, POS) win by calling
 * preventDefault first. See src/lib/tally-keys.ts for the rules.
 */
export function useTallyKeys(navigate: NavigateFunction, onHelp: () => void): void {
  const ref = useRef({ navigate, onHelp });
  useEffect(() => {
    ref.current = { navigate, onHelp };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      const hit = resolveTallyKey(e, {
        pathname: window.location.pathname,
        typing: isTypingTarget(e.target),
        modalOpen: !!document.querySelector('[aria-modal="true"]'),
        can,
      });
      if (!hit) return;
      e.preventDefault();
      if (hit.id === 'help') ref.current.onHelp();
      else if (hit.to) ref.current.navigate(hit.to, hit.state ? { state: hit.state } : undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
