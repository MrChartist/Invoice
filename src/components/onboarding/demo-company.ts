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
import { activeCompanyId, companiesSupported, createCompany, labelMainCompany, readRegistry, realCompanies, switchCompany, type CompanyEntry } from '../../lib/companies';
import { DEFAULT_COMPANY_ID, writeRegistry } from '../../lib/company-registry';
import { localDb, type AppSettings } from '../../lib/localDb';
import { SINGLETON_KEYS, readRaw, reloadAfterFlush, removeRaw, writeRaw } from '../../lib/storage';
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

/** The registry entry of the Demo company (QA7 G2: by the creator's flag, never by its name). */
export const demoCompanyEntry = (): CompanyEntry | undefined => readRegistry().list.find((c) => c.demo);

const openEntry = (): CompanyEntry | undefined => readRegistry().list.find((c) => c.id === activeCompanyId());
/** The open database's own marker (`settings.demo_company`). */
const dbMarked = (): boolean => localDb.settings.get().demo_company === true;
/** No invoice of the user's own in the open database. */
const noRealInvoices = (): boolean => localDb.invoices.getAll().every((i) => (i as { demo?: unknown }).demo === true);
/** A database nothing was ever saved in (no settings record): what the creator's `createCompany` leaves. */
const freshDb = (): boolean => readRaw(SINGLETON_KEYS.settings) === null && !localDb.invoices.getAll().length;

/** Mark the open database and its registry entry as the Demo company (`from`: where "Switch to" goes back). */
function markDemo(id: string, from?: string): void {
  const reg = readRegistry();
  writeRegistry({ ...reg, list: reg.list.map((c) => (c.id === id ? { ...c, demo: true, from: from ?? c.from ?? '' } : c)) });
  if (id === activeCompanyId() && !dbMarked()) localDb.settings.save({ ...localDb.settings.get(), demo_company: true });
}

/**
 * QA7 G2 migration: a Demo company made by an earlier version carries no flag. It is recognised by how that version
 * made it: a second company created as exactly "Demo" and filled at once, so it is the open company, holds sample
 * rows, no invoice of the user's own and no business profile of its own. A company the user named "demo" and works
 * in never matches (its own invoices or profile rule it out), and nothing is adopted while a flagged one exists.
 */
function adoptLegacyDemo(e: CompanyEntry): boolean {
  if (e.name !== DEMO_COMPANY_NAME || e.id === DEFAULT_COMPANY_ID || demoCompanyEntry()) return false;
  const ownProfile = localDb.settings.get().profiles.some((p) => (p as { demo?: unknown }).demo !== true && (p.companyName ?? '').trim());
  if (ownProfile || !noRealInvoices() || !localDb.invoices.getAll().length) return false;
  try {
    markDemo(e.id);
    return true;
  } catch {
    return false;
  }
}

/**
 * True while the Demo company is open in THIS tab: the company this tab's database belongs to (QA7 G1, not the live
 * registry another tab may have switched) carries the creator's flag in the registry AND the marker in its database.
 */
export function isDemoCompanyOpen(): boolean {
  const e = openEntry();
  if (!e) return false;
  return e.demo ? dbMarked() : adoptLegacyDemo(e);
}

/** "Switch to …" from the Demo company: the company the user came from, else their first own company. */
export function companyToReturnTo(): CompanyEntry | undefined {
  const own = realCompanies();
  return own.find((c) => c.id === demoCompanyEntry()?.from) ?? own[0];
}

/**
 * Fill the open (Demo) company: copy the business type and packs, then load the profile's dataset. QA-3 F4: the
 * sample data and `onboarded` sit in the storage cache until IndexedDB commits them, so the reload waits for that
 * (`reloadAfterFlush`, as Settings → Data does). A bare reload lost them and the Demo company opened empty.
 */
export async function fillDemo(meta: Omit<DemoPending, 'id'> = {}): Promise<void> {
  // QA7 G1/G2: only into the Demo company this tab has open (the data layer refuses any other database too).
  if (!isDemoCompanyOpen()) throw new Error('not_demo_company');
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
  const here = activeCompanyId();
  if (existing && existing.id === here) {
    // Already in the Demo company: (re)fill it here (its data was erased: mark it again while it holds nothing real).
    if (!dbMarked() && noRealInvoices()) markDemo(here);
    void fillDemo().then(reloadAfterFlush).catch(() => undefined);
    return true;
  }
  // The kind of business travels with the request, so the Demo company shows the same profile.
  const s = localDb.settings.get();
  const packs = Array.isArray(s.industry_packs) ? (s.industry_packs as unknown[]).filter((p): p is string => typeof p === 'string') : undefined;
  // F27: the company being left keeps its own name in the switcher, not "Main business".
  labelMainCompany(localDb.settings.activeProfile()?.companyName || ownName);
  const entry = existing ?? createCompany(freeDemoName());
  markDemo(entry.id, here);
  writeRaw(DEMO_PENDING_KEY, formatPending({ id: entry.id, business_type: s.business_type, packs }));
  switchCompany(entry.id);
  return true;
}

/** "Demo", or "Demo 2" … when the user already has a company of that name (never reused for samples, QA7 G2). */
function freeDemoName(): string {
  const taken = new Set(readRegistry().list.map((c) => c.name.toLowerCase()));
  let name = DEMO_COMPANY_NAME;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${DEMO_COMPANY_NAME} ${i}`;
  return name;
}

/**
 * Take a pending "explore with sample data" request if this tab may finish it. QA7 G1: only the tab whose database
 * IS the requested Demo company (a tab still on the real company leaves the request alone). That database gets the
 * Demo marker here, on its first open, and only while it holds no invoice of the user's own. A request written by an
 * earlier version names an unflagged "Demo" company: it is taken only while that database is still fresh.
 */
export function takePending(): DemoPending | null {
  const pending = parsePending(readRaw(DEMO_PENDING_KEY));
  const e = openEntry();
  if (!pending || !e || pending.id !== e.id) return null;
  const legacy = !e.demo && e.name === DEMO_COMPANY_NAME && e.id !== DEFAULT_COMPANY_ID && !demoCompanyEntry() && freshDb();
  if (!e.demo && !legacy) return null;
  if (!dbMarked()) {
    if (!noRealInvoices()) return null;
    markDemo(e.id);
  }
  removeRaw(DEMO_PENDING_KEY);
  return pending;
}

/** Finish a pending "explore with sample data" once the Demo company is open (wizard and Dashboard). */
export function useDemoPending(onClose: (finished: boolean | string) => void): void {
  useEffect(() => {
    const pending = takePending();
    if (!pending) return;
    void fillDemo({ business_type: pending.business_type, packs: pending.packs })
      .then(() => {
        onClose(false);
        reloadAfterFlush();
      })
      .catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
