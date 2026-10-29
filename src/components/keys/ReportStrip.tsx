import { lazy, Suspense, useCallback, useState, useSyncExternalStore } from 'react';
import { liveReport, subscribeLive } from '../../lib/keys/report-keys';

// R20-C: the "what you see" strip and the report sheets (lazy; only after a report key was used).
const ReportPanel = lazy(() => import('./ReportSheets'));

/**
 * R20-C: where a report's filter / ticks / hidden-rows strip shows — under the report it belongs to (the live report's
 * table sits inside this strip's parent). DrillStack mounts one; the Day Book and the Gateway viewer mount their own.
 */
export function ReportStrip() {
  const live = useSyncExternalStore(subscribeLive, liveReport);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const mark = useCallback((el: HTMLSpanElement | null) => setHost(el?.parentElement ?? null), []);
  const t = live?.table();
  return (
    <>
      <span hidden ref={mark} />
      {live && t && host?.contains(t) && (
        <Suspense fallback={null}>
          <ReportPanel live={live} />
        </Suspense>
      )}
    </>
  );
}
