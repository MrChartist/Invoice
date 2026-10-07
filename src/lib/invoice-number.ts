/**
 * Indian Financial Year (1 Apr → 31 Mar) document numbering.
 *
 * Format: `<PREFIX>/FY<yy-yy>/<0001>` e.g. `INV/FY25-26/0007`.
 * DO NOT switch to calendar-year numbering — regression-tested.
 *
 * The sequence is derived from the highest number already issued in that
 * series, not from a row count: deleting an invoice must never make the next
 * one reuse a number that has already gone out to a client.
 */

import { DOCUMENT_CODES, type DocumentType } from '../types/invoice';

export interface FinancialYear {
  /** "25-26" */
  label: string;
  startYear: number;
  endYear: number;
}

/**
 * A bare `YYYY-MM-DD` is a calendar day, not a UTC instant — `new Date('2026-04-01')`
 * is midnight UTC, which is still 31 March in the Americas and would file a 1 April
 * invoice under the previous financial year. Parse it as a local date instead.
 */
function parseDay(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(dateStr);
}

export function getIndianFY(dateStr?: string): FinancialYear {
  const d = dateStr ? parseDay(dateStr) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const month = safe.getMonth(); // 0-indexed, April = 3
  const year = safe.getFullYear();
  const startYear = month >= 3 ? year : year - 1;
  return {
    label: `${startYear.toString().slice(2)}-${(startYear + 1).toString().slice(2)}`,
    startYear,
    endYear: startYear + 1,
  };
}

/** Inclusive start / exclusive end of an FY, for report filtering. */
export function fyBounds(fy: FinancialYear): { start: Date; end: Date } {
  return { start: new Date(fy.startYear, 3, 1), end: new Date(fy.endYear, 3, 1) };
}

export function isInFY(dateStr: string | undefined, fyLabel: string): boolean {
  if (!dateStr) return false;
  return getIndianFY(dateStr).label === fyLabel;
}

/**
 * Quotations, credit notes and challans always get their own series code so a
 * quote and an invoice can never collide. A custom prefix only overrides the
 * invoice series.
 */
export function resolvePrefix(docType: DocumentType = 'INVOICE', customPrefix?: string): string {
  const clean = (customPrefix ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const isInvoice = docType === 'INVOICE' || docType === 'TAX_INVOICE';
  if (isInvoice && clean) return clean;
  return DOCUMENT_CODES[docType] ?? 'INV';
}

export function buildInvoiceNumber(prefix: string, fyLabel: string, seq: number): string {
  return `${prefix}/FY${fyLabel}/${seq.toString().padStart(4, '0')}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Highest sequence already used in `<prefix>/FY<label>/…`, or 0 if none. */
export function highestSequence(existingNumbers: string[], prefix: string, fyLabel: string): number {
  const re = new RegExp(`^${escapeRegExp(prefix)}/FY${escapeRegExp(fyLabel)}/(\\d+)$`, 'i');
  let max = 0;
  for (const raw of existingNumbers) {
    const match = re.exec((raw ?? '').trim());
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

export interface NextNumberOptions {
  existingNumbers: string[];
  dateStr?: string;
  docType?: DocumentType;
  customPrefix?: string;
}

/** Pure next-number generator. Storage-free so it can be unit-tested. */
export function nextInvoiceNumber(opts: NextNumberOptions): string {
  const fy = getIndianFY(opts.dateStr);
  const prefix = resolvePrefix(opts.docType ?? 'INVOICE', opts.customPrefix);
  const seq = highestSequence(opts.existingNumbers ?? [], prefix, fy.label) + 1;
  return buildInvoiceNumber(prefix, fy.label, seq);
}
