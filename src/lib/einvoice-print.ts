/**
 * What to print on a paper invoice from the IRP details stored by the
 * e-Invoice module (`einvoice_meta`). Pure, so it is unit-tested without a DOM.
 *
 * Rules:
 *  - nothing stored (or only blanks)  -> `null`: the invoice prints exactly as before;
 *  - IRN / Ack are printed as text, the signed QR only when the portal returned one
 *    and it fits in a QR code;
 *  - an e-Way bill number alone (goods moved on a non-e-invoice) still prints its line.
 */

import { DB_PREFIX, readRaw } from './storage';
import type { EInvoiceMeta } from './einvoice';
import type { PaperKind } from './design-prefs';

export interface IrnPrintModel {
  irn?: string;
  ackNo?: string;
  ackDate?: string;
  /** Signed QR payload, present only when it can be encoded. */
  qr?: string;
  ewayNo?: string;
  ewayValidUpto?: string;
}

/** QR byte-mode capacity at the lowest error-correction level is 2953; stay under it. */
export const MAX_SIGNED_QR_BYTES = 2900;

function clean(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s || undefined;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Decide what to print. `null` means "print nothing and leave the layout alone". */
export function buildIrnPrint(meta: Partial<EInvoiceMeta> | null | undefined): IrnPrintModel | null {
  if (!meta) return null;
  const irn = clean(meta.irn);
  const ackNo = clean(meta.ack_no);
  const ackDate = clean(meta.ack_date);
  const ewayNo = clean(meta.eway_no);
  const ewayValidUpto = clean(meta.eway_valid_upto);
  // The QR payload is a JWT: never collapse its characters, only trim the ends.
  const rawQr = typeof meta.signed_qr === 'string' ? meta.signed_qr.trim() : '';
  const qr = rawQr && byteLength(rawQr) <= MAX_SIGNED_QR_BYTES ? rawQr : undefined;

  if (!irn && !ackNo && !ackDate && !qr && !ewayNo) return null;
  const out: IrnPrintModel = {};
  if (irn) out.irn = irn;
  if (ackNo) out.ackNo = ackNo;
  if (ackDate) out.ackDate = ackDate;
  if (qr) out.qr = qr;
  if (ewayNo) {
    out.ewayNo = ewayNo;
    if (ewayValidUpto) out.ewayValidUpto = ewayValidUpto;
  }
  return out;
}

/**
 * Edge of the signed QR in CSS px. The payload is dense (~1.2 kB), so it needs
 * roughly 1.2 px/module to survive a 300 dpi print; sizes are chosen per paper.
 */
export function irnQrSize(paper: PaperKind | undefined): number {
  switch (paper) {
    case 'thermal80':
      return 150;
    case 'A5':
      return 88;
    default:
      return 100;
  }
}

/* ── Lookup (cached on the raw table string, so re-renders stay cheap) ─── */

let cacheRaw: string | null | undefined;
let cacheRows: EInvoiceMeta[] = [];

/**
 * IRP details for a saved invoice. `undefined` for unsaved invoices (no id)
 * or when nothing was recorded. Safe to call on every render.
 */
export function resolveEInvoiceMeta(invoiceId: string | undefined | null): EInvoiceMeta | undefined {
  if (!invoiceId) return undefined;
  const raw = readRaw(`${DB_PREFIX}einvoice_meta`);
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      cacheRows = Array.isArray(parsed) ? (parsed as EInvoiceMeta[]) : [];
    } catch {
      cacheRows = [];
    }
  }
  return cacheRows.find((m) => m.invoice_id === invoiceId);
}
