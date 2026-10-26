/** R5-C test world: a Maharashtra seller with the fees, non-profit and leases packs on. */
import { resetStorage } from './shim.ts';
import { SELLER, installSettings } from './world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import type { FeeContext } from '../../src/lib/institutions/fee-billing.ts';

export function setupR5c(packs: string[] = ['fees', 'nonprofit', 'leases']): void {
  resetStorage();
  installSettings({ industry_packs: packs } as never);
}

export const feeCtx = (date: string): FeeContext => ({ date, sender: localDb.settings.activeProfile() ?? SELLER, templateId: 'classic_orange', roundOff: false });
