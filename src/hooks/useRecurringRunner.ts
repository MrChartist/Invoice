import { useCallback, useEffect, useState } from 'react';
import { can } from '../lib/access';
import { afterFirstSync } from '../lib/sync-device';
import { recurringToastMessage } from '../lib/recurring-message';
import { todayInput } from '../lib/utils';
import type { InvoiceRecord } from '../types/invoice';

const LOCK_NAME = 'mrchartist-recurring-runner';
/** QA-3 F6: dispatched on window after a run that generated documents (the Recurring page re-reads). */
export const RECURRING_RAN_EVENT = 'mrchartist:recurring-ran';
/** Dispatch on window to ask the runner for a run now (e.g. a schedule due today was just saved). */
export const RECURRING_RUN_EVENT = 'mrchartist:recurring-run';

/** One run, serialised across tabs when the Web Locks API exists. */
async function runOnce(): Promise<InvoiceRecord[]> {
  // A viewer's session never creates documents (6.21); the next owner / clerk session catches up.
  if (!can('doc.create')) return [];
  // Folder sync (5.7): let the first sync of the session bring in what another device already generated
  // (and the schedule it advanced) before generating here. Ids are per occurrence, so a race still
  // collapses into one document.
  await afterFirstSync(2 * 60_000);
  // Loaded on demand: the schedule engine is not needed for first paint.
  const { runDueSchedules } = await import('../lib/recurring');
  const run = () => {
    try {
      return runDueSchedules(todayInput()).generated;
    } catch {
      return [];
    }
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks?.request) {
    try {
      return await locks.request(LOCK_NAME, run);
    } catch {
      /* fall through to the unlocked path — generation is idempotent anyway */
    }
  }
  return run();
}

/**
 * Generates any recurring invoices that have come due. Runs once on mount and
 * again whenever the tab regains focus / becomes visible (a tab left open
 * overnight picks up the new day).
 *
 * Mount it once in the app shell:
 *   const { generated, dismiss } = useRecurringRunner();
 *   // toast: recurringToastMessage(generated)
 */
export function useRecurringRunner(): {
  generated: InvoiceRecord[];
  dismiss: () => void;
  message: string;
} {
  const [generated, setGenerated] = useState<InvoiceRecord[]>([]);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      void runOnce().then((created) => {
        if (created.length > 0) window.dispatchEvent(new Event(RECURRING_RAN_EVENT));
        if (alive && created.length > 0) setGenerated((prev) => [...prev, ...created]);
      });
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    window.addEventListener('focus', tick);
    window.addEventListener(RECURRING_RUN_EVENT, tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.removeEventListener('focus', tick);
      window.removeEventListener(RECURRING_RUN_EVENT, tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const dismiss = useCallback(() => setGenerated([]), []);
  return { generated, dismiss, message: recurringToastMessage(generated) };
}
