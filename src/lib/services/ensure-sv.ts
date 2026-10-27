/**
 * SV-A4: the service hooks (purchase-bill ITC caution, exceptions-report checks) are registered by `sv-hooks.ts`.
 * Hosts call this when they load (bill guard, GST guards) so a service company always has them; other companies load
 * nothing. Resolves true once the hooks are in (callers may re-render), false when nothing was needed.
 */
import { localDb } from '../localDb';
import { activePacks } from '../industry-packs';

let loading: Promise<boolean> | null = null;

/** A service profile or a service pack is on. */
export function serviceCompany(): boolean {
  const s = localDb.settings.get() as (Parameters<typeof activePacks>[0] & { service_kind?: string }) | null | undefined;
  return !!s?.service_kind || activePacks(s).some((p) => p === 'clinic' || p === 'salon' || p === 'fitness' || p === 'workshop');
}

export function ensureServiceHooks(): Promise<boolean> {
  try {
    if (loading || !serviceCompany()) return loading ?? Promise.resolve(false);
  } catch {
    return Promise.resolve(false);
  }
  return (loading = import('./sv-hooks').then(() => true, () => false));
}
