/**
 * QA10 follow-up: the bill delete / cancel hook (`voidHook`, rt-doc-hooks.ts) is registered when a Round 9 module loads.
 * Pages that delete or cancel bills call this on mount so a retail company's exchange receipts and finance DOs are
 * always released, even in a session where no Round 9 screen was opened yet. Loads nothing for other companies
 * (QA18 T3: unless a netting / exchange receipt is on record).
 */
import { localDb } from '../localDb';
import { activePacks } from '../industry-packs';
import { peekTable } from '../storage';

const RETAIL_PACKS = ['pharmacy', 'apparel', 'electronics', 'jewellery'] as const;

/** Whether the hooks are needed: a retail company, or (QA18 T3) any company with a receipt that settles a bill — R15
 * netting is open to every company, and its receipts must be freed / re-settled like R9's. */
export function needsRetailHooks(): boolean {
  const s = localDb.settings.get() as (Parameters<typeof activePacks>[0] & { retail_kind?: string; business_type?: string }) | null | undefined;
  const on = activePacks(s);
  return !!(s?.retail_kind || s?.business_type === 'kirana' || RETAIL_PACKS.some((p) => on.includes(p)))
    || peekTable<{ exchange_purchase_id?: string }>('transactions').some((p) => !!p?.exchange_purchase_id);
}

export function ensureRetailHooks(): void {
  if (needsRetailHooks()) void import('./rt-doc-hooks');
}
