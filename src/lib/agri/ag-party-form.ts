/**
 * PENDING #18: the "Farmer" section of the vendor / client form. Turns the typed fields into the party patch: a farmer
 * gets a cleaned `ag` (Aadhaar last four only) and, as a vendor, `principal_kind: 'agriculturist'` — the same fields
 * Farm → Farmers writes (`farmerVendor`). Unticking removes `ag` (and the agriculturist kind it set). Pure.
 */
import type { AgParty } from '../../types/agri-r12';
import type { PrincipalKind } from '../../types/trade-r8';
import { cleanParty } from './ag-farmers';

export type FarmerFields = Pick<AgParty, 'code' | 'village' | 'member_no' | 'aadhaar_last4' | 'kcc_no' | 'upi'> & { member?: boolean };

export interface FarmerPatch {
  ag?: AgParty;
  principal_kind?: PrincipalKind;
}

/**
 * The patch for the party (`on` = "This party is a farmer"). `prev` is the party as stored (its other `ag` fields — centre,
 * bank, crops … — are kept). Returns the problem text instead when a field is wrong.
 */
export function farmerPatch(on: boolean, fields: FarmerFields, prev: { ag?: AgParty; principal_kind?: PrincipalKind }, side: 'vendor' | 'client'): { patch: FarmerPatch; problem: string } {
  if (!on) {
    const patch: FarmerPatch = { ag: undefined };
    if (side === 'vendor') patch.principal_kind = prev.principal_kind === 'agriculturist' ? undefined : prev.principal_kind;
    return { patch, problem: '' };
  }
  try {
    const ag = cleanParty({ ...prev.ag, ...fields });
    return { patch: side === 'vendor' ? { ag, principal_kind: 'agriculturist' } : { ag }, problem: '' };
  } catch (e) {
    return { patch: {}, problem: (e as Error).message };
  }
}
