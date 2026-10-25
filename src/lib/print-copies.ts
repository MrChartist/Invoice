/**
 * Multiple copies of one document in one print job / PDF (P0-9).
 *
 * CGST Rule 48(4): a tax invoice for GOODS is prepared in triplicate —
 *   "ORIGINAL FOR RECIPIENT", "DUPLICATE FOR TRANSPORTER", "TRIPLICATE FOR SUPPLIER";
 * Rule 48(5): for SERVICES in duplicate — "ORIGINAL FOR RECIPIENT", "DUPLICATE FOR SUPPLIER".
 * Rule 49 (bill of supply) applies the same mutatis mutandis. Rule 55(2) (delivery challan):
 *   "ORIGINAL FOR CONSIGNEE", "DUPLICATE FOR TRANSPORTER", "TRIPLICATE FOR CONSIGNER".
 * Non-tax documents (quotation, proforma, sales order) print plain "Original / Duplicate …".
 *
 * Pure logic, no React. The design preference `copies` stores a `CopySetting`; absent means
 * "single" — one paper, no banner — so every existing document prints exactly as before.
 */

import type { DocumentType, InvoiceItem, InvoiceRecord } from '../types/invoice';

export type CopyKind = 'original' | 'duplicate' | 'triplicate' | 'extra';
export const COPY_KINDS: readonly CopyKind[] = ['original', 'duplicate', 'triplicate', 'extra'];

/** 'single' = one paper without a banner (legacy); 'auto' = Rule 48 set for the supply; or an explicit list. */
export type CopySetting = 'single' | 'auto' | CopyKind[];

export type SupplyNature = 'goods' | 'services';

/** Most copies one job may hold (an "extra" copy can repeat). */
export const MAX_COPIES = 6;

const GOODS_TYPE = /goods|product|stock/i;

/** Goods when any line is goods (by type, or an HSN that is not a 99xx SAC); challans always move goods. */
export function supplyNature(invoice: Pick<InvoiceRecord, 'doc_type'> & { items?: readonly Pick<InvoiceItem, 'type' | 'hsn'>[] }): SupplyNature {
  if (invoice.doc_type === 'DELIVERY_CHALLAN') return 'goods';
  const goods = (invoice.items ?? []).some((i) => {
    if (GOODS_TYPE.test(String(i.type ?? ''))) return true;
    const hsn = String(i.hsn ?? '').trim();
    return hsn !== '' && !/^99/.test(hsn);
  });
  return goods ? 'goods' : 'services';
}

/** The Rule 48 default set: goods → 3 copies, services → 2. */
export function defaultCopies(nature: SupplyNature): CopyKind[] {
  return nature === 'goods' ? ['original', 'duplicate', 'triplicate'] : ['original', 'duplicate'];
}

/** Coerce anything stored into a valid setting (unknown → 'single'). */
export function sanitizeCopies(value: unknown): CopySetting {
  if (value === 'auto' || value === 'single') return value;
  if (!Array.isArray(value)) return 'single';
  const list = value.filter((v): v is CopyKind => (COPY_KINDS as readonly string[]).includes(v as string));
  // Original / duplicate / triplicate at most once each, in their natural order; extras after.
  const named = (['original', 'duplicate', 'triplicate'] as const).filter((k) => list.includes(k));
  const extras = list.filter((k) => k === 'extra');
  const out = [...named, ...extras].slice(0, MAX_COPIES);
  return out.length ? out : 'single';
}

/** The copies to render for one document. `[]` = a single paper with no banner. */
export function resolveCopies(setting: CopySetting | undefined, nature: SupplyNature): CopyKind[] {
  const s = sanitizeCopies(setting);
  if (s === 'single') return [];
  if (s === 'auto') return defaultCopies(nature);
  return s;
}

const TAX_DOCS: readonly DocumentType[] = ['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'CREDIT_NOTE', 'DEBIT_NOTE'];

/** Printed banner text for one copy (statutory English wording, never translated). */
export function copyLabel(kind: CopyKind, ctx: { nature: SupplyNature; docType: DocumentType }): string {
  if (kind === 'extra') return 'Extra Copy';
  if (ctx.docType === 'DELIVERY_CHALLAN') {
    return { original: 'Original for Consignee', duplicate: 'Duplicate for Transporter', triplicate: 'Triplicate for Consigner' }[kind];
  }
  if (!TAX_DOCS.includes(ctx.docType)) {
    return { original: 'Original', duplicate: 'Duplicate', triplicate: 'Triplicate' }[kind];
  }
  if (ctx.nature === 'goods') {
    return { original: 'Original for Recipient', duplicate: 'Duplicate for Transporter', triplicate: 'Triplicate for Supplier' }[kind];
  }
  // Rule 48(5): services are issued in duplicate; a third copy is an office copy.
  return { original: 'Original for Recipient', duplicate: 'Duplicate for Supplier', triplicate: 'Triplicate' }[kind];
}

export interface PrintCopy {
  kind: CopyKind;
  /** Banner text; '' for the legacy single paper. */
  label: string;
  /** Stable React key ('extra-2' for the second extra). */
  key: string;
}

/**
 * The papers to render for a document and a setting: one entry per copy, or a single
 * banner-less entry when the setting is 'single'.
 */
export function printCopies(invoice: Pick<InvoiceRecord, 'doc_type'> & { items?: readonly Pick<InvoiceItem, 'type' | 'hsn'>[] }, setting: CopySetting | undefined): PrintCopy[] {
  const nature = supplyNature(invoice);
  const kinds = resolveCopies(setting, nature);
  if (kinds.length === 0) return [{ kind: 'original', label: '', key: 'single' }];
  let extra = 0;
  return kinds.map((kind) => ({
    kind,
    label: copyLabel(kind, { nature, docType: invoice.doc_type }),
    key: kind === 'extra' ? `extra-${++extra}` : kind,
  }));
}

/** Toggle one copy kind in a setting, keeping the canonical order ('extra' adds / removes one). */
export function toggleCopy(setting: CopySetting, kind: CopyKind, on: boolean, nature: SupplyNature): CopySetting {
  const current = resolveCopies(setting, nature);
  let next: CopyKind[];
  if (kind === 'extra') {
    next = on ? [...current, 'extra'] : (() => {
      const i = current.lastIndexOf('extra');
      return i < 0 ? current : [...current.slice(0, i), ...current.slice(i + 1)];
    })();
  } else {
    next = on ? [...current, kind] : current.filter((k) => k !== kind);
  }
  return sanitizeCopies(next);
}
