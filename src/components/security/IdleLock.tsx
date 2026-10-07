import { useEffect, useRef } from 'react';
import { IDLE_CHANGED_EVENT, getIdleTimeout, isIdleExpired, logout } from '../../lib/auth';

interface Props {
  /** Called after the session has been cleared — typically `() => setAuthed(false)`. */
  onLock: () => void;
}

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
const CHECK_EVERY_MS = 5_000;
const THROTTLE_MS = 1_000;

/**
 * Renders nothing. Locks the app (logout + onLock) after the configured minutes
 * without user activity. Data is autosaved, so locking never loses work.
 * Mount it once, inside the authenticated shell.
 */
export function IdleLock({ onLock }: Props) {
  const last = useRef(0);
  const minutes = useRef(0);
  const onLockRef = useRef(onLock);

  useEffect(() => {
    onLockRef.current = onLock;
  }, [onLock]);

  useEffect(() => {
    const touch = () => {
      const now = Date.now();
      if (now - last.current > THROTTLE_MS) last.current = now;
    };
    const refresh = () => {
      minutes.current = getIdleTimeout();
      last.current = Date.now();
    };
    const check = () => {
      if (isIdleExpired(last.current, Date.now(), minutes.current)) {
        logout();
        onLockRef.current();
      }
    };
    const onVisible = () => {
      // Timers are throttled in background tabs, so re-check the moment the tab returns.
      if (document.visibilityState === 'visible') check();
    };

    refresh();
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, touch, { passive: true, capture: true }));
    window.addEventListener(IDLE_CHANGED_EVENT, refresh);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, touch, { capture: true }));
      window.removeEventListener(IDLE_CHANGED_EVENT, refresh);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
