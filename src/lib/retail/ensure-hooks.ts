/**
 * QA10 follow-up: the bill delete / cancel hook (`voidHook`, rt-doc-hooks.ts) is registered when a Round 9 module loads.
 * Pages that delete or cancel bills call this on mount so a retail company's exchange receipts and finance DOs are
 * always released, even in a session where no Round 9 screen was opened yet. Loads nothing for other companies.
 */
import { localDb } from '../localDb';
import { activePacks } from '../industry-packs';

const RETAIL_PACKS = ['pharmacy', 'apparel', 'electronics', 'jewellery'] as const;

export function ensureRetailHooks(): void {
  const s = localDb.settings.get() as (Parameters<typeof activePacks>[0] & { retail_kind?: string; business_type?: string }) | null | undefined;
  const on = activePacks(s);
  if (s?.retail_kind || s?.business_type === 'kirana' || RETAIL_PACKS.some((p) => on.includes(p))) void import('./rt-doc-hooks');
}
