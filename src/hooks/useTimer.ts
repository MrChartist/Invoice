import { useEffect, useState } from 'react';
import { readTimer, TIMER_EVENT, TIMER_KEY, type TimerState } from '../lib/timer';

/**
 * Live view of the running timer: re-reads it when this tab or another tab changes it, and ticks
 * `now` once a second while it runs (so the elapsed time can be shown without storing a counter).
 */
export function useTimer(): { timer: TimerState | null; now: number } {
  const [timer, setTimer] = useState<TimerState | null>(() => readTimer());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const sync = () => {
      setTimer(readTimer());
      setNow(Date.now());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === TIMER_KEY) sync();
    };
    window.addEventListener(TIMER_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(TIMER_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  const running = !!timer && timer.started_at !== null;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return { timer, now };
}
