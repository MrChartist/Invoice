import { useCallback, useEffect, useState } from 'react';
import { recurringToastMessage, runDueSchedules } from '../lib/recurring';
import { todayInput } from '../lib/utils';
import type { InvoiceRecord } from '../types/invoice';

const LOCK_NAME = 'mrchartist-recurring-runner';

/** One run, serialised across tabs when the Web Locks API exists. */
async function runOnce(): Promise<InvoiceRecord[]> {
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
        if (alive && created.length > 0) setGenerated((prev) => [...prev, ...created]);
      });
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const dismiss = useCallback(() => setGenerated([]), []);
  return { generated, dismiss, message: recurringToastMessage(generated) };
}
