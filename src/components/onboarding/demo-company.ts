/**
 * "Explore with sample data instead" (8H wizard): open a separate company called "Demo", fill it
 * with the existing sample dataset, and leave the user's own company empty and untouched.
 *
 * The switch reloads the app into the Demo company, so the request survives the reload in a
 * device-local flag (`DEMO_PENDING_KEY`, outside the `mrchartist_inv_` prefix: never backed up).
 * The wizard then opens there (a new company is not set up yet), sees the flag and loads the data.
 * Browsers without IndexedDB (no separate companies) load the sample data into the current company.
 */
import { useEffect } from 'react';
import { activeCompanyId, companiesSupported, createCompany, readRegistry, switchCompany } from '../../lib/companies';
import { localDb } from '../../lib/localDb';
import { readRaw, removeRaw, writeRaw } from '../../lib/storage';

export const DEMO_PENDING_KEY = 'mrchartist_demo_pending';
export const DEMO_COMPANY_NAME = 'Demo';

async function fillDemo(): Promise<void> {
  const { loadDemoData } = await import('../../lib/demo-data');
  const r = loadDemoData({ confirm: true });
  if (!r.ok && r.reason !== 'already_loaded') throw new Error(r.reason);
  localDb.settings.save({ ...localDb.settings.get(), onboarded: true });
}

export function startDemoCompany(): void {
  if (!companiesSupported()) {
    void fillDemo().then(() => window.location.reload());
    return;
  }
  const existing = readRegistry().list.find((c) => c.name.toLowerCase() === DEMO_COMPANY_NAME.toLowerCase());
  const entry = existing ?? createCompany(DEMO_COMPANY_NAME);
  writeRaw(DEMO_PENDING_KEY, entry.id);
  switchCompany(entry.id);
}

/** In the wizard: finish a pending "explore with sample data" once the Demo company is open. */
export function useDemoPending(onClose: (finished: boolean | string) => void): void {
  useEffect(() => {
    const pending = readRaw(DEMO_PENDING_KEY);
    if (!pending || pending !== activeCompanyId()) return;
    removeRaw(DEMO_PENDING_KEY);
    void fillDemo()
      .then(() => {
        onClose(false);
        window.location.reload();
      })
      .catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
