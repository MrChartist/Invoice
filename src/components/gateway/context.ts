import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { getGatewaySession, getTallyTerms, subscribeGateway, type GatewaySession } from '../../lib/gateway/period';

/** Returns true when the screen handled the key (the shell then calls preventDefault). */
export type ScreenKeyHandler = (e: KeyboardEvent) => boolean;

export interface GatewayContextValue {
  setScreenKeys: (fn: ScreenKeyHandler | null) => void;
  openDate: () => void;
  openPeriod: () => void;
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

export const GatewayContext = createContext<GatewayContextValue | null>(null);

export function useGateway(): GatewayContextValue {
  const ctx = useContext(GatewayContext);
  if (!ctx) throw new Error('useGateway outside GatewayShell');
  return ctx;
}

/** Registers the screen's key handler with the shell's single capture-phase listener. */
export function useScreenKeys(handler: ScreenKeyHandler): void {
  const { setScreenKeys } = useGateway();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    setScreenKeys((e) => ref.current(e));
    return () => setScreenKeys(null);
  }, [setScreenKeys]);
}

export function useGatewaySession(): GatewaySession {
  return useSyncExternalStore(subscribeGateway, getGatewaySession, getGatewaySession);
}

export function useTallyTerms(): boolean {
  return useSyncExternalStore(subscribeGateway, getTallyTerms, getTallyTerms);
}

export const hasModal = () => typeof document !== 'undefined' && !!document.querySelector('[aria-modal="true"]');
