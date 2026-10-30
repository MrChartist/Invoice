/**
 * Composition scheme + Bill of Supply (roadmap 5.9) — the small, pure helpers shared by the editor,
 * the templates and the reports. Returns (CMP-08 / GSTR-4) live in `composition-returns.ts`.
 *
 * Law (working paper — verify with your CA):
 *  - Rule 49 CGST Rules: a Bill of Supply is issued instead of a tax invoice by a composition taxable
 *    person and by a registered person supplying exempt goods / services. No tax is charged on it.
 *  - Sec 31(3)(c) CGST Act + Rule 46A / 49: a composition dealer must not collect tax and must print
 *    "composition taxable person, not eligible to collect tax on supplies" on the bill of supply.
 *  - Sec 10(2)(c): a Sec 10(1) composition dealer cannot make inter-state outward supplies of goods;
 *    Sec 10(2A)(c): a service-provider composition dealer cannot make any inter-state outward supply.
 */

import type { DocumentType, ExemptKind, InvoiceRecord, SenderProfile } from '../types/invoice';
import { compositionRate } from './tax-rules';
import { resolveStateCode } from './india-states';

/** Sec 31(3)(c) / Rule 49 declaration, exactly as prescribed. Printed on every composition dealer's document. */
export const COMPOSITION_DECLARATION = 'Composition taxable person, not eligible to collect tax on supplies';

/** Header line some dealers print under their name (Sec 10(5) / Rule 5(1)(g): "composition taxable person"). */
export const COMPOSITION_TAG = 'Composition taxable person';

export const COMPOSITION_CATEGORY_LABELS = {
  manufacturer: 'Manufacturer (other than notified goods)',
  trader: 'Trader (goods)',
  restaurant: 'Restaurant service (not serving alcohol)',
  service: 'Service provider / mixed supplier: Sec 10(2A)',
} as const;

export const EXEMPT_KIND_LABELS: Record<ExemptKind, string> = {
  EXEMPT: 'Exempt supply',
  NIL: 'Nil-rated supply',
  NON_GST: 'Non-GST supply',
};

type SenderLike = Pick<SenderProfile, 'gst_scheme' | 'composition_category'> | null | undefined;

export function isComposition(sender: SenderLike): boolean {
  return sender?.gst_scheme === 'composition';
}

export function isBillOfSupply(docType: DocumentType | undefined): boolean {
  return docType === 'BILL_OF_SUPPLY';
}

/** A sales bill: tax invoice, invoice or bill of supply (what credit / debit notes, receivables and books treat as a sale). */
export function isSalesBill(docType: DocumentType | undefined): boolean {
  return docType === 'INVOICE' || docType === 'TAX_INVOICE' || docType === 'BILL_OF_SUPPLY';
}

/** Composition rate (%) of the sender on `date`, or null (regular profile / option not available yet). */
export function senderCompositionRate(sender: SenderLike, date?: string): number | null {
  if (!isComposition(sender)) return null;
  return compositionRate(sender?.composition_category ?? 'trader', date);
}

/**
 * The declaration a document must carry, read from the document's OWN sender snapshot (Critical Rule 3:
 * a later switch of the profile to/from composition never changes a historical document).
 *  - composition sender: the Sec 31(3)(c) wording on every sales-type document;
 *  - regular sender + Bill of Supply: none required by law (the title says it all).
 */
export function supplyDeclaration(invoice: Pick<InvoiceRecord, 'doc_type'>, sender: SenderLike): string | null {
  if (!isComposition(sender)) return null;
  const t = invoice.doc_type;
  if (t === 'QUOTATION' || t === 'PROFORMA' || t === 'DELIVERY_CHALLAN' || t === 'SALES_ORDER') return null;
  return COMPOSITION_DECLARATION;
}

/** The type a new sales document opens as for this sender (composition → Bill of Supply). */
export function defaultSalesDocType(sender: SenderLike, requested?: DocumentType): DocumentType {
  if (requested) return requested;
  return isComposition(sender) ? 'BILL_OF_SUPPLY' : 'INVOICE';
}

export interface CompositionWarning {
  code: 'TAX_INVOICE_BY_COMPOSITION' | 'INTER_STATE_GOODS' | 'BOS_TAXED_LINES' | 'RATE_UNAVAILABLE';
  message: string;
}

/** Goods line: an HSN that is not a SAC (99…). Lines with no code count as goods when the item type says so. */
function isGoodsLine(i: { hsn?: string; type?: string }): boolean {
  const code = (i.hsn ?? '').trim();
  if (code) return !code.startsWith('99');
  return /good|product/i.test(i.type ?? '');
}

/** Non-blocking editor warnings for composition dealers and Bills of Supply. */
export function compositionWarnings(
  rec: Pick<InvoiceRecord, 'doc_type' | 'place_of_supply' | 'items' | 'issue_date'> & { sender: SenderLike & Partial<SenderProfile> | null },
): CompositionWarning[] {
  const out: CompositionWarning[] = [];
  const sender = rec.sender;
  const composition = isComposition(sender);
  const sales = isSalesBill(rec.doc_type) || rec.doc_type === 'DEBIT_NOTE' || rec.doc_type === 'CREDIT_NOTE';
  if (composition && (rec.doc_type === 'TAX_INVOICE' || rec.doc_type === 'INVOICE')) {
    out.push({
      code: 'TAX_INVOICE_BY_COMPOSITION',
      message: 'This profile is under the composition scheme: issue a Bill of Supply, not a tax invoice (Sec 31(3)(c)). Composition dealers cannot collect tax.',
    });
  }
  if (composition && sales) {
    const home = resolveStateCode({ code: sender?.stateCode, gstin: sender?.companyGstin });
    const pos = (rec.place_of_supply ?? '').trim();
    const service = sender?.composition_category === 'service';
    const barred = (i: { hsn?: string; type?: string }) => service || isGoodsLine(i);
    if (home && pos && pos !== home && (rec.items ?? []).some((i) => (i.name?.trim() || Number(i.rate) > 0) && barred(i))) {
      out.push({
        code: 'INTER_STATE_GOODS',
        message: service
          ? `Place of supply (${pos}) is outside your state (${home}): a Sec 10(2A) composition dealer cannot make inter-state outward supplies (Sec 10(2A)(c)). Saving is allowed: check with your CA.`
          : `Place of supply (${pos}) is outside your state (${home}): a composition dealer cannot make inter-state outward supplies of goods (Sec 10(2)(c)). Saving is allowed: check with your CA.`,
      });
    }
    if (senderCompositionRate(sender, rec.issue_date) === null) {
      out.push({
        code: 'RATE_UNAVAILABLE',
        message: 'The composition option for service providers (Sec 10(2A)) applies from 1 April 2019; no rate is available for this date.',
      });
    }
  }
  if (!composition && isBillOfSupply(rec.doc_type) && (rec.items ?? []).some((i) => Number(i.tax_rate) > 0 && (i.name?.trim() || Number(i.rate) > 0))) {
    out.push({
      code: 'BOS_TAXED_LINES',
      message: 'Some lines carry a GST rate, but a Bill of Supply charges no tax. Use a tax invoice for taxable supplies (Rule 46); a Bill of Supply is for exempt, nil-rated or non-GST supplies only.',
    });
  }
  return out;
}
