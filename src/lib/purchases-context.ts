/** Browser-side context for purchases: which state the business trades from. */

import { localDb } from './localDb';

export interface BusinessContext {
  stateCode: string;
  hasGstin: boolean;
}

/** State code of the active sender profile (explicit, else from its GSTIN); '' when unknown. */
export function businessContext(): BusinessContext {
  const profile = localDb.settings.activeProfile();
  const gstin = profile?.companyGstin?.trim() ?? '';
  return {
    stateCode: profile?.stateCode || gstin.slice(0, 2) || '',
    hasGstin: gstin.length === 15,
  };
}
