/**
 * R7-B5 OTA tagging at check-out (F10, D8). A booking from an OTA (operator GSTIN checked by `checkEcoGstin`):
 *  - hotel registered (the sender profile has a GSTIN, voluntary registration included — D8) → `eco_gstin` +
 *    `TCS_52`, normal tax (GSTR-1 Table 14(a), the existing path);
 *  - hotel NOT registered → `PAY_9_5`, tax 0, value only, with the note "GST payable by the e-commerce operator u/s
 *    9(5)" (Table 14(b) / 3B 3.1.1(ii) for a registered supplier; nothing for an unregistered one).
 * OTA-collect bookings also carry 194-O (rate from the existing date-keyed table: 0.1% from 1 Oct 2024) as the TDS the
 * operator deducts, so the TDS register / 26AS reconciler expects it. Working paper — verify with your CA.
 */
import type { InvoiceRecord, SenderProfile } from '../../types/invoice';
import type { Reservation } from '../../types/hotel-r7';
import { checkEcoGstin } from '../eco';
import { ecoTcsRate, tdsSections } from '../tax-rules';
import { round2 } from '../invoice-calc';

export const NOTE_9_5 = 'GST payable by the e-commerce operator u/s 9(5).';

export const isRegistered = (s: Pick<SenderProfile, 'companyGstin'> | null | undefined): boolean => !!s?.companyGstin?.trim();

/** 194-O rate on a day (existing rows). */
export const rate194o = (day: string): number => tdsSections(day).find((s) => s.section === '194O')?.rate ?? 0;

/** ECO / TDS fields an OTA booking's invoice carries (empty for a direct booking or a bad operator GSTIN). */
export function otaTags(res: Pick<Reservation, 'source' | 'ota'> | undefined, sender: Pick<SenderProfile, 'companyGstin'> | null, day: string): Partial<InvoiceRecord> {
  const o = res?.source === 'ota' ? res.ota : undefined;
  const gstin = (o?.gstin ?? '').trim().toUpperCase();
  if (!o || !checkEcoGstin(gstin).valid) return {};
  const out: Partial<InvoiceRecord> = { eco_gstin: gstin, eco_section: isRegistered(sender) ? 'TCS_52' : 'PAY_9_5' };
  if (o.collect === 'ota_collect' && rate194o(day) > 0) Object.assign(out, { tds_enabled: true, tds_section: '194O', tds_rate: rate194o(day) });
  return out;
}

/** TCS u/s 52 the operator keeps on an invoice (0 under Sec 9(5)): taxable value × the rate on its date. */
export const otaTcs = (inv: Pick<InvoiceRecord, 'eco_section' | 'taxable_value' | 'issue_date'>): number =>
  inv.eco_section === 'PAY_9_5' ? 0 : round2((inv.taxable_value * ecoTcsRate(inv.issue_date)) / 100);
