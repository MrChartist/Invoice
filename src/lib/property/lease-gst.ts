/**
 * R5-C5 GST class of a lease, by unit use × landlord / tenant registration × date (`LEASE_GST_RULES`) — working paper,
 * verify with your CA (§7 Q12):
 *  - landlord not registered → plain rent bill (no GST); a registered tenant of a commercial unit pays RCM under
 *    entry 5AB from 10 Oct 2024 (not a composition tenant from 16 Jan 2025) — noted on screen;
 *  - dwelling to a registered tenant using it for business → tax invoice under reverse charge (from 18 Jul 2022);
 *  - dwelling otherwise → exempt: a Bill of Supply or no document, as the user picks;
 *  - commercial / other (landlord registered) → tax invoice, SAC 997212 at the date-keyed rate.
 */
import type { DocumentType } from '../../types/invoice';
import type { LeaseGstClass, UnitUse } from '../../types/institutions-r5';
import { LEASE_GST_RULES, ruleAt } from '../r5c-rules';

export interface LeaseGstInput {
  use: UnitUse;
  landlordRegistered: boolean;
  tenantRegistered: boolean;
  tenantBusinessUse?: boolean;
  tenantComposition?: boolean;
  /** For an exempt dwelling: issue a Bill of Supply (true) or nothing. */
  exemptBos?: boolean;
  date: string;
}

export interface LeaseGst {
  cls: LeaseGstClass;
  rate: number;
  sac: string;
  /** Screen note: the tenant's RCM under entry 5AB / on a dwelling. */
  note: '' | 'rcm5ab' | 'rcmDwelling';
}

export function leaseGstClass(i: LeaseGstInput): LeaseGst {
  const r = ruleAt(LEASE_GST_RULES, i.date);
  const base = { rate: 0, sac: r.sac, note: '' as LeaseGst['note'] };
  if (!i.landlordRegistered) {
    const rcm = i.use !== 'residential_dwelling' && i.tenantRegistered && r.unregCommercialRcm && !(i.tenantComposition && r.compositionTenantExcluded);
    return { ...base, cls: 'unregistered', note: rcm ? 'rcm5ab' : '' };
  }
  if (i.use === 'residential_dwelling') {
    if (i.tenantRegistered && i.tenantBusinessUse && r.dwellingRcm) return { ...base, cls: 'rcm', rate: r.commercialRate, note: 'rcmDwelling' };
    return { ...base, cls: i.exemptBos ? 'exempt_bos' : 'exempt_none' };
  }
  return { ...base, cls: 'taxable', rate: r.commercialRate };
}

/** The document a class bills with (null = no document: rent receipts are recorded by hand). */
export function leaseDocType(cls: LeaseGstClass): { doc: DocumentType; reverse: boolean; gst: boolean } | null {
  if (cls === 'exempt_none') return null;
  if (cls === 'exempt_bos') return { doc: 'BILL_OF_SUPPLY', reverse: false, gst: false };
  if (cls === 'unregistered') return { doc: 'INVOICE', reverse: false, gst: false };
  return { doc: 'TAX_INVOICE', reverse: cls === 'rcm', gst: true };
}
