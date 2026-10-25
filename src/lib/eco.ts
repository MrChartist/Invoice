/**
 * Supplies made through an e-commerce operator (ECO) — Sec 52 (TCS) and Sec 9(5) (operator pays the tax).
 *
 * Data: two additive fields on the document, `eco_gstin` (the operator's GSTIN) and `eco_section`
 * (`TCS_52` default / `PAY_9_5`). Reporting (src/lib/gst-reports.ts):
 *  - TCS_52: the supplier pays the tax as usual; the document stays in B2B / B2CL / B2CS with the operator's
 *    GSTIN (`etin`, B2CS type "E") and is totalled per operator in GSTR-1 Table 14(a).
 *  - PAY_9_5: the operator is the person liable (restaurant service, passenger transport, accommodation,
 *    housekeeping … notified u/s 9(5)); the supplier charges no tax and reports only the value — GSTR-1
 *    Table 14(b) and GSTR-3B 3.1.1(ii), never 3.1(a) / (c).
 * Pure (no storage, no DOM). Working paper — verify with your CA.
 */

import type { EcoSection, InvoiceRecord } from '../types/invoice';
import { gstinChecksumChar } from './gstin';
import { COMPOSITION_ECO_GOODS_FROM } from './tax-rules';

/** A regular GSTIN has `Z` as 14th character; a Sec 52 TCS registration has `C`. */
const ECO_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][ZC][0-9A-Z]$/;

export const ECO_SECTION_LABELS: Record<EcoSection, string> = {
  TCS_52: 'Operator collects TCS (Sec 52)',
  PAY_9_5: 'Operator pays the GST (Sec 9(5))',
};

export interface EcoGstinCheck {
  valid: boolean;
  message?: string;
  /** True when the 14th character is `C` (a TCS registration under Sec 52). */
  tcsRegistration?: boolean;
}

/** Validates an operator GSTIN: 15 characters, state + PAN shape, `Z` or `C` in place 14, mod-36 checksum. */
export function checkEcoGstin(raw?: string): EcoGstinCheck {
  const g = (raw ?? '').trim().toUpperCase();
  if (!g) return { valid: false, message: 'e-commerce operator GSTIN is empty' };
  if (g.length !== 15) return { valid: false, message: 'e-commerce operator GSTIN must be exactly 15 characters' };
  if (!ECO_SHAPE.test(g)) return { valid: false, message: 'e-commerce operator GSTIN format looks wrong (expected 07AAAAA0000A1C5 or …1Z5)' };
  if (gstinChecksumChar(g.slice(0, 14)) !== g[14]) return { valid: false, message: 'e-commerce operator GSTIN checksum digit does not match' };
  return { valid: true, tcsRegistration: g[13] === 'C' };
}

export interface EcoInfo {
  gstin: string;
  section: EcoSection;
}

/** The operator a document was supplied through, or null for a direct sale. */
export function ecoOf(rec: Pick<InvoiceRecord, 'eco_gstin' | 'eco_section'> | null | undefined): EcoInfo | null {
  const gstin = String(rec?.eco_gstin ?? '').trim().toUpperCase();
  if (!gstin) return null;
  return { gstin, section: rec?.eco_section === 'PAY_9_5' ? 'PAY_9_5' : 'TCS_52' };
}

export interface EcoWarning {
  code: string;
  message: string;
}

/** Non-blocking editor notes for the operator fields of a document. */
export function ecoWarnings(
  rec: Pick<InvoiceRecord, 'eco_gstin' | 'eco_section' | 'issue_date' | 'sender' | 'items' | 'gst_mode' | 'doc_type'>,
): EcoWarning[] {
  const eco = ecoOf(rec);
  if (!eco) return [];
  const out: EcoWarning[] = [];
  const chk = checkEcoGstin(eco.gstin);
  if (!chk.valid) out.push({ code: 'ECO_GSTIN_INVALID', message: `${chk.message}.` });
  else if (eco.section === 'TCS_52' && !chk.tcsRegistration) {
    out.push({ code: 'ECO_NOT_TCS', message: 'An operator collecting TCS under Sec 52 normally has a separate TCS GSTIN with “C” as the 14th character. Check the GSTIN on the operator’s GSTR-8 / statement.' });
  }
  const taxed = (rec.items ?? []).some((i) => Number(i?.tax_rate) > 0) && rec.gst_mode !== 'NONE';
  if (eco.section === 'PAY_9_5' && taxed && rec.doc_type !== 'BILL_OF_SUPPLY') {
    out.push({ code: 'ECO_95_TAXED', message: 'Under Sec 9(5) the operator pays the GST, so the supplier should not charge it. Tax on this document is not reported as your liability (only the value goes to GSTR-1 Table 14(b) / GSTR-3B 3.1.1(ii)).' });
  }
  if (rec.sender?.gst_scheme === 'composition' && eco.section === 'TCS_52') {
    const date = String(rec.issue_date ?? '').slice(0, 10);
    const goods = (rec.items ?? []).some((i) => i?.type !== 'service' && !String(i?.hsn ?? '').startsWith('99'));
    if (!goods || date < COMPOSITION_ECO_GOODS_FROM) {
      out.push({
        code: 'ECO_COMPOSITION',
        message: goods
          ? 'Before 1 Oct 2023 a composition dealer could not supply goods through an operator that collects TCS (Sec 10(2)(d)). Check with your CA.'
          : 'A composition dealer may not supply services through an operator that collects TCS (Sec 10(2)(d) / 10(2A)). Check with your CA.',
      });
    }
  }
  return out;
}
