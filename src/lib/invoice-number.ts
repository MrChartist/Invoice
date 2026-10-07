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

import { DOCUMENT_CODES, DOCUMENT_LABELS, type DocumentType } from '../types/invoice';
import { parseDay as parseDayShared } from './dates';

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
  return parseDayShared(dateStr);
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
  const existing = opts.existingNumbers ?? [];
  const taken = new Set(existing.map(numberKey));
  let seq = highestSequence(existing, prefix, fy.label) + 1;
  // Belt and braces: never hand out a number that is already in use (GST rule 46).
  while (taken.has(numberKey(buildInvoiceNumber(prefix, fy.label, seq)))) seq++;
  return buildInvoiceNumber(prefix, fy.label, seq);
}

/* ── Uniqueness (GST Rule 46: a consecutive, unique serial number) ─────────── */

export interface ParsedNumber {
  prefix: string;
  /** "25-26" */
  fy: string;
  seq: number;
}

const NUMBER_RE = /^([A-Z0-9-]+)\/FY(\d{2}-\d{2})\/(\d+)$/;

/** Splits `INV/FY25-26/0007`; null for numbers typed in some other shape. */
export function parseDocNumber(raw: string | undefined | null): ParsedNumber | null {
  const m = NUMBER_RE.exec((raw ?? '').replace(/\s+/g, '').toUpperCase());
  if (!m) return null;
  const seq = parseInt(m[3], 10);
  return Number.isFinite(seq) ? { prefix: m[1], fy: m[2], seq } : null;
}

/**
 * Canonical comparison key: case-, space- and zero-padding-insensitive, so
 * `inv / fy25-26 / 0007` and `INV/FY25-26/7` are the same number.
 */
export function numberKey(raw: string | undefined | null): string {
  const parsed = parseDocNumber(raw);
  if (parsed) return `${parsed.prefix}/FY${parsed.fy}/${parsed.seq}`;
  return (raw ?? '').replace(/\s+/g, '').toUpperCase();
}

export interface NumberedDoc {
  id: string;
  invoice_number: string;
  doc_type?: DocumentType;
  issue_date?: string;
  client?: { name?: string };
}

/** The OTHER document already using `candidate`, if any. `selfId` is the document being edited. */
export function findNumberClash<T extends NumberedDoc>(
  docs: T[],
  candidate: string,
  selfId?: string,
): T | undefined {
  const key = numberKey(candidate);
  if (!key) return undefined;
  return docs.find((d) => d.id !== selfId && numberKey(d.invoice_number) === key);
}

export class DuplicateNumberError extends Error {
  readonly code = 'DUPLICATE_NUMBER';
  readonly number: string;
  readonly clash: NumberedDoc;
  constructor(number: string, clash: NumberedDoc) {
    const what = clash.doc_type ? DOCUMENT_LABELS[clash.doc_type] : 'document';
    const who = clash.client?.name ? ` for ${clash.client.name}` : '';
    super(
      `Number ${number.trim()} is already used by ${what.toLowerCase()} ${clash.invoice_number}${who}. ` +
        'Every document needs its own serial number (GST Rule 46) — pick another or leave it blank to number automatically.',
    );
    this.name = 'DuplicateNumberError';
    this.number = number;
    this.clash = clash;
  }
}

/* ── Series gaps ───────────────────────────────────────────────── */

export interface SeriesGap {
  prefix: string;
  fy: string;
  /** Highest sequence issued in this series. */
  highest: number;
  /** Sequences from 1..highest that are not in use (capped at `MAX_LISTED_GAPS`). */
  missing: number[];
  /** Exact count of missing sequences (may exceed `missing.length`). */
  missingCount: number;
  /** The same, formatted as full document numbers. */
  missingNumbers: string[];
}

export const MAX_LISTED_GAPS = 25;

function gapFor(prefix: string, fy: string, used: Set<number>, upTo: number): SeriesGap {
  const missing: number[] = [];
  // Counting is O(used): holes = upTo - |used ∩ [1, upTo]|.
  let inRange = 0;
  for (const n of used) if (n >= 1 && n <= upTo) inRange++;
  const count = upTo - inRange;
  for (let n = 1; n <= upTo && missing.length < MAX_LISTED_GAPS && missing.length < count; n++) {
    if (!used.has(n)) missing.push(n);
  }
  return {
    prefix,
    fy,
    highest: upTo,
    missing,
    missingCount: count,
    missingNumbers: missing.map((n) => buildInvoiceNumber(prefix, fy, n)),
  };
}

/**
 * Gaps in each series (prefix × FY) found in `numbers`. Pass `fyLabel` ("25-26")
 * to look at one financial year — read-only helper for the GST
 * "documents issued" summary. Series with no gap are omitted.
 */
export function seriesGaps(numbers: string[], fyLabel?: string): SeriesGap[] {
  const groups = new Map<string, { prefix: string; fy: string; used: Set<number> }>();
  for (const raw of numbers) {
    const p = parseDocNumber(raw);
    if (!p || (fyLabel && p.fy !== fyLabel)) continue;
    const key = `${p.prefix}|${p.fy}`;
    const g = groups.get(key) ?? { prefix: p.prefix, fy: p.fy, used: new Set<number>() };
    g.used.add(p.seq);
    groups.set(key, g);
  }
  const out: SeriesGap[] = [];
  for (const g of groups.values()) {
    const highest = Math.max(...g.used);
    const gap = gapFor(g.prefix, g.fy, g.used, highest);
    if (gap.missingCount > 0) out.push(gap);
  }
  return out.sort((a, b) => a.fy.localeCompare(b.fy) || a.prefix.localeCompare(b.prefix));
}

/**
 * If `candidate` skips ahead of the series (e.g. typing 0010 when 0007 is the
 * highest), the numbers that would be left unused; otherwise null.
 */
export function gapsIfIssued(numbers: string[], candidate: string): SeriesGap | null {
  const p = parseDocNumber(candidate);
  if (!p) return null;
  let prevHighest = 0;
  for (const raw of numbers) {
    const q = parseDocNumber(raw);
    if (!q || q.prefix !== p.prefix || q.fy !== p.fy) continue;
    if (q.seq === p.seq) return null; // taken — a duplicate, not a gap
    if (q.seq > prevHighest) prevHighest = q.seq;
  }
  // Filling an old hole, or simply the next number: nothing is skipped.
  if (p.seq <= prevHighest + 1) return null;
  const total = p.seq - 1 - prevHighest;
  const missing: number[] = [];
  for (let n = prevHighest + 1; n < p.seq && missing.length < MAX_LISTED_GAPS; n++) missing.push(n);
  return {
    prefix: p.prefix,
    fy: p.fy,
    highest: p.seq,
    missing,
    missingCount: total,
    missingNumbers: missing.map((n) => buildInvoiceNumber(p.prefix, p.fy, n)),
  };
}
