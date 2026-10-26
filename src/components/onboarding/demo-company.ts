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
import { activeCompanyId, companiesSupported, createCompany, labelMainCompany, readRegistry, switchCompany } from '../../lib/companies';
import { localDb } from '../../lib/localDb';
import { readRaw, reloadAfterFlush, removeRaw, writeRaw } from '../../lib/storage';

export const DEMO_PENDING_KEY = 'mrchartist_demo_pending';
export const DEMO_COMPANY_NAME = 'Demo';

/**
 * QA-3 F4: the sample data and `onboarded` sit in the storage cache until IndexedDB commits them, so
 * the reload waits for that (`reloadAfterFlush`, as Settings → Data does). A bare reload lost them and
 * the Demo company opened empty with the wizard again.
 */
async function fillDemo(): Promise<void> {
  const { loadDemoData } = await import('../../lib/demo-data');
  const r = loadDemoData({ confirm: true });
  if (!r.ok && r.reason !== 'already_loaded') throw new Error(r.reason);
  localDb.settings.save({ ...localDb.settings.get(), onboarded: true });
}

/** `ownName`: the business name typed so far (the wizard's), used when no profile is saved yet (F27). */
export function startDemoCompany(ownName?: string): void {
  if (!companiesSupported()) {
    void fillDemo().then(reloadAfterFlush);
    return;
  }
  const existing = readRegistry().list.find((c) => c.name.toLowerCase() === DEMO_COMPANY_NAME.toLowerCase());
  // F27: the company being left keeps its own name in the switcher, not "Main business".
  labelMainCompany(localDb.settings.activeProfile()?.companyName || ownName);
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
        reloadAfterFlush();
      })
      .catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
