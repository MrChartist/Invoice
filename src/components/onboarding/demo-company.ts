/**
 * "Explore with sample data" (8H wizard; R6-B4 one path for the wizard, the Dashboard and Settings → Data): open a
 * separate company called "Demo", fill it with the sample dataset for the user's kind of business, and leave the
 * user's own company empty and untouched. Sample rows are never written into a real company.
 *
 * The switch reloads the app into the Demo company, so the request survives the reload in a
 * device-local flag (`DEMO_PENDING_KEY`, outside the `mrchartist_inv_` prefix: never backed up). Its value is the
 * Demo company's id, then (R6-B4, additive) `|<business type>|<pack,pack>` copied from the company being left, so the
 * Demo company shows the same kind of business. The wizard (or the Dashboard) then opens there, sees the flag and
 * loads the data. Browsers without IndexedDB cannot hold a second company, so they get no sample data.
 */
import { useEffect } from 'react';
import { activeCompanyId, companiesSupported, createCompany, labelMainCompany, readRegistry, switchCompany } from '../../lib/companies';
import { localDb, type AppSettings } from '../../lib/localDb';
import { readRaw, reloadAfterFlush, removeRaw, writeRaw } from '../../lib/storage';
import { localDayOf } from '../../lib/dates';
import { applyBusinessType } from '../../lib/shop-presets';
import { demoExtras } from '../../lib/demo/profiles';

export const DEMO_PENDING_KEY = 'mrchartist_demo_pending';
export const DEMO_COMPANY_NAME = 'Demo';

export interface DemoPending {
  id: string;
  business_type?: string;
  packs?: string[];
}

/** `id` or `id|type|pack,pack` (R6-B4). */
export function parsePending(raw: string | null): DemoPending | null {
  if (!raw) return null;
  const [id, type, packs] = raw.split('|');
  if (!id) return null;
  return { id, ...(type ? { business_type: type } : {}), ...(packs !== undefined ? { packs: packs.split(',').filter(Boolean) } : {}) };
}

export const formatPending = (p: DemoPending): string => [p.id, p.business_type ?? '', ...(p.packs ? [p.packs.join(',')] : [])].join('|');

/** The registry entry of the Demo company, if one exists. */
export const demoCompanyEntry = () => readRegistry().list.find((c) => c.name.toLowerCase() === DEMO_COMPANY_NAME.toLowerCase());
/** True while the Demo company is the open one. */
export const isDemoCompanyOpen = (): boolean => demoCompanyEntry()?.id === activeCompanyId();

/**
 * Fill the open (Demo) company: copy the business type and packs, then load the profile's dataset. QA-3 F4: the
 * sample data and `onboarded` sit in the storage cache until IndexedDB commits them, so the reload waits for that
 * (`reloadAfterFlush`, as Settings → Data does). A bare reload lost them and the Demo company opened empty.
 */
export async function fillDemo(meta: Omit<DemoPending, 'id'> = {}): Promise<void> {
  const { loadDemoData, demoProfileFor } = await import('../../lib/demo-data');
  const before = localDb.settings.get();
  const type = meta.business_type ?? before.business_type;
  const typed = type && type !== before.business_type ? applyBusinessType(type as Parameters<typeof applyBusinessType>[0]) : {};
  const shape = { ...before, ...typed, ...(meta.packs ? { industry_packs: meta.packs } : {}) };
  const profile = demoProfileFor(shape);
  const packs = Array.isArray(shape.industry_packs) ? (shape.industry_packs as string[]) : profile === 'transport' ? ['transport'] : profile === 'works' ? ['works'] : [];
  const today = localDayOf(new Date());
  const { buildDemoDataset } = await import('../../lib/demo-data');
  const extras = await demoExtras(profile, { today, base: buildDemoDataset(today), packs });
  const r = loadDemoData({ confirm: true, today, extras });
  // (Narrowed by hand: the non-strict test project reads this file too.)
  const reason = r.ok ? '' : (r as { reason: string }).reason;
  if (reason && reason !== 'already_loaded') throw new Error(reason);
  const packIds = meta.packs ? { industry_packs: meta.packs as NonNullable<AppSettings['industry_packs']> } : {};
  localDb.settings.save({ ...localDb.settings.get(), ...typed, ...packIds, onboarded: true });
}

/** Rebuild the samples with today's dates (the Xero pattern). Only in the Demo company. */
export async function resetDemoSamples(): Promise<void> {
  if (!isDemoCompanyOpen()) throw new Error('Samples are reset only in the Demo company.');
  const { removeDemoData } = await import('../../lib/demo-data');
  removeDemoData();
  await fillDemo();
}

/**
 * Open (or create) the Demo company and fill it there. `ownName`: the business name typed so far (the wizard's), used
 * when no profile is saved yet (F27). Returns false when this browser cannot hold a second company.
 */
export function startDemoCompany(ownName?: string): boolean {
  if (!companiesSupported()) return false;
  const existing = demoCompanyEntry();
  if (existing && existing.id === activeCompanyId()) {
    // Already in the Demo company: (re)fill it here.
    void fillDemo().then(reloadAfterFlush).catch(() => undefined);
    return true;
  }
  // The kind of business travels with the request, so the Demo company shows the same profile.
  const s = localDb.settings.get();
  const packs = Array.isArray(s.industry_packs) ? (s.industry_packs as unknown[]).filter((p): p is string => typeof p === 'string') : undefined;
  // F27: the company being left keeps its own name in the switcher, not "Main business".
  labelMainCompany(localDb.settings.activeProfile()?.companyName || ownName);
  const entry = existing ?? createCompany(DEMO_COMPANY_NAME);
  writeRaw(DEMO_PENDING_KEY, formatPending({ id: entry.id, business_type: s.business_type, packs }));
  switchCompany(entry.id);
  return true;
}

/** Finish a pending "explore with sample data" once the Demo company is open (wizard and Dashboard). */
export function useDemoPending(onClose: (finished: boolean | string) => void): void {
  useEffect(() => {
    const pending = parsePending(readRaw(DEMO_PENDING_KEY));
    if (!pending || pending.id !== activeCompanyId()) return;
    removeRaw(DEMO_PENDING_KEY);
    void fillDemo({ business_type: pending.business_type, packs: pending.packs })
      .then(() => {
        onClose(false);
        reloadAfterFlush();
      })
      .catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
