/**
 * 8D (8.63) — vendor follow-up from the GSTR-2B matcher (Clear pattern) and the 2B ITC pushed to the GSTR-3B view.
 *
 *  - `followUps(match)` groups the discrepancies per supplier GSTIN: bills in the books that the supplier has not
 *    reported (missing in 2B — ITC at risk under Sec 16(2)(aa)), value / tax / head / date / number differences, and
 *    documents in 2B that are not in the books.
 *  - `followUpText` writes the note sent through WhatsApp (`wa.me`), e-mail (`mailto:`) or printed to PDF; the app only
 *    builds the link, it never sends anything.
 *  - Table `gst_followups`: one row per period × supplier GSTIN with the day it was followed up and the channel.
 *  - Table `gstr2b_itc`: the 2B effect (`itcEffect`) pushed for a period × GSTIN so the GSTR-3B tab can show Table 4
 *    as per books next to "as per 2B match". Working paper — verify with your CA.
 */

import type { BookBill, Gstr2bLine, Heads3, ItcEffect, MatchDiff, MatchResult } from './gstr2b';
import { getTable, setTable } from './storage';
import { escHtml as esc } from './html-esc';
import { PRINT_FONT, PRINT_FONT_FACE } from './print-fonts';

const r2 = (n: number) => Math.round(n * 100) / 100;
const taxOf = (h: { igst: number; cgst: number; sgst: number }) => r2(h.igst + h.cgst + h.sgst);

export type FollowUpKind = 'not_in_2b' | 'mismatch' | 'missing_in_books';

export interface FollowUpItem {
  kind: FollowUpKind;
  number: string;
  date: string;
  /** Books figures (absent for "missing in books"). */
  booksTaxable?: number;
  booksTax?: number;
  /** 2B figures (absent for "not in 2B"). */
  g2bTaxable?: number;
  g2bTax?: number;
  diffs: MatchDiff[];
}

export interface FollowUp {
  ctin: string;
  name: string;
  items: FollowUpItem[];
  /** Books tax at risk (not in 2B + shortfall on mismatches). */
  taxAtRisk: number;
}

const item = (kind: FollowUpKind, line: Gstr2bLine | undefined, bill: BookBill | undefined, diffs: MatchDiff[]): FollowUpItem => ({
  kind,
  number: bill?.number || line?.number || '',
  date: bill?.date || line?.date || '',
  ...(bill ? { booksTaxable: r2(bill.taxable), booksTax: r2(bill.tax) } : {}),
  ...(line ? { g2bTaxable: r2(line.taxable), g2bTax: taxOf(line) } : {}),
  diffs,
});

/** Per-supplier discrepancy lists from a 2B match (imports of goods and ISD lines are left out). */
export function followUps(match: Pick<MatchResult, 'rows'>): FollowUp[] {
  const by = new Map<string, FollowUp>();
  for (const r of match.rows) {
    const kind: FollowUpKind | null = r.cls === 'not_in_2b' ? 'not_in_2b' : r.cls === 'mismatch' ? 'mismatch' : r.cls === 'missing_in_books' ? 'missing_in_books' : null;
    if (!kind) continue;
    if (r.line && (r.line.section === 'IMPG' || r.line.section === 'ISD')) continue;
    if (!r.line && r.bill?.importType === 'GOODS') continue;
    const ctin = (r.line?.ctin || r.bill?.gstin || '').toUpperCase();
    if (!ctin) continue;
    let f = by.get(ctin);
    if (!f) by.set(ctin, (f = { ctin, name: r.line?.tradeName || r.bill?.partyName || '', items: [], taxAtRisk: 0 }));
    if (!f.name) f.name = r.line?.tradeName || r.bill?.partyName || '';
    const it = item(kind, r.line, r.bill, r.diffs);
    f.items.push(it);
    if (kind === 'not_in_2b') f.taxAtRisk = r2(f.taxAtRisk + (it.booksTax ?? 0));
    if (kind === 'mismatch') f.taxAtRisk = r2(f.taxAtRisk + Math.max(0, (it.booksTax ?? 0) - (it.g2bTax ?? 0)));
  }
  const order: Record<FollowUpKind, number> = { not_in_2b: 0, mismatch: 1, missing_in_books: 2 };
  for (const f of by.values()) f.items.sort((a, b) => order[a.kind] - order[b.kind] || a.date.localeCompare(b.date));
  return [...by.values()].sort((a, b) => b.taxAtRisk - a.taxAtRisk || a.name.localeCompare(b.name));
}

/** Labels for the note, supplied by the caller (the UI passes the active language). */
export interface FollowUpWords {
  greeting: (name: string) => string;
  intro: (period: string, gstin: string) => string;
  notIn2b: string;
  mismatch: string;
  missingInBooks: string;
  books: string;
  in2b: string;
  taxable: string;
  tax: string;
  diffs: Record<MatchDiff, string>;
  closing: string;
}

const money = (n: number | undefined) => (n === undefined ? '-' : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** Plain-text discrepancy note for one supplier. */
export function followUpText(f: FollowUp, period: string, ourGstin: string, w: FollowUpWords, ourName = ''): string {
  const lines: string[] = [w.greeting(f.name || f.ctin), '', w.intro(period, ourGstin)];
  const section = (kind: FollowUpKind, title: string) => {
    const list = f.items.filter((i) => i.kind === kind);
    if (!list.length) return;
    lines.push('', title);
    list.forEach((i, n) => {
      const parts = [`${n + 1}. ${i.number || '-'}${i.date ? ` (${i.date.split('-').reverse().join('-')})` : ''}`];
      if (i.booksTax !== undefined) parts.push(`${w.books}: ${w.taxable} ${money(i.booksTaxable)}, ${w.tax} ${money(i.booksTax)}`);
      if (i.g2bTax !== undefined) parts.push(`${w.in2b}: ${w.taxable} ${money(i.g2bTaxable)}, ${w.tax} ${money(i.g2bTax)}`);
      if (i.diffs.length) parts.push(i.diffs.map((d) => w.diffs[d]).join(', '));
      lines.push(parts.join(' — '));
    });
  };
  section('not_in_2b', w.notIn2b);
  section('mismatch', w.mismatch);
  section('missing_in_books', w.missingInBooks);
  lines.push('', w.closing);
  if (ourName) lines.push(ourName);
  return lines.join('\n');
}


/** Printable HTML (browser "Save as PDF") for one supplier's note. */
export function followUpHtml(title: string, text: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_FONT_FACE}body{font:14px/1.5 ${PRINT_FONT};margin:32px;color:#111}pre{white-space:pre-wrap;font:inherit}</style></head><body><h1 style="font-size:18px">${esc(title)}</h1><pre>${esc(text)}</pre></body></html>`;
}

/* ── follow-up marks ── */

export const FOLLOWUPS_TABLE = 'gst_followups';
export type FollowUpChannel = 'whatsapp' | 'email' | 'pdf' | 'other';

export interface FollowUpMark {
  /** `${period}|${ctin}` */
  id: string;
  /** 2B period, MMYYYY. */
  period: string;
  ctin: string;
  followed_on: string;
  channel: FollowUpChannel;
  /** Discrepancies listed when the note was sent. */
  items: number;
  tax_at_risk: number;
  updated_at: string;
}

export const followUpId = (period: string, ctin: string) => `${period}|${ctin.toUpperCase()}`;
export const loadFollowUps = (): FollowUpMark[] => getTable<FollowUpMark>(FOLLOWUPS_TABLE).filter((r) => r && typeof r.id === 'string');

/** Pure: the table with one supplier marked followed up (or the mark removed when `on` is null). */
export function setFollowUp(rows: readonly FollowUpMark[], period: string, f: Pick<FollowUp, 'ctin' | 'items' | 'taxAtRisk'>, on: string | null, channel: FollowUpChannel = 'other', now = new Date()): FollowUpMark[] {
  const id = followUpId(period, f.ctin);
  const rest = rows.filter((r) => r.id !== id);
  if (!on) return rest;
  return [...rest, { id, period, ctin: f.ctin.toUpperCase(), followed_on: on.slice(0, 10), channel, items: f.items.length, tax_at_risk: f.taxAtRisk, updated_at: now.toISOString() }];
}

export function markFollowUp(period: string, f: Pick<FollowUp, 'ctin' | 'items' | 'taxAtRisk'>, on: string | null, channel?: FollowUpChannel): FollowUpMark[] {
  const next = setFollowUp(loadFollowUps(), period, f, on, channel);
  setTable(FOLLOWUPS_TABLE, next);
  return next;
}

/* ── 2B ITC pushed to the GSTR-3B view ── */

export const ITC_2B_TABLE = 'gstr2b_itc';

export interface Itc2bPush {
  /** `${period}|${gstin}` */
  id: string;
  period: string;
  gstin: string;
  books: Heads3;
  restricted: Heads3;
  atRisk: Heads3;
  per2b: Heads3;
  pushed_at: string;
}

export function pushItc(period: string, gstin: string, e: Pick<ItcEffect, 'books' | 'restricted' | 'atRisk' | 'per2b'>, now = new Date()): Itc2bPush {
  const row: Itc2bPush = { id: `${period}|${gstin.trim().toUpperCase()}`, period, gstin: gstin.trim().toUpperCase(), books: e.books, restricted: e.restricted, atRisk: e.atRisk, per2b: e.per2b, pushed_at: now.toISOString() };
  setTable(ITC_2B_TABLE, [...getTable<Itc2bPush>(ITC_2B_TABLE).filter((r) => r?.id !== row.id), row]);
  return row;
}

/** The pushed 2B ITC for a period (exact GSTIN first, then one pushed for "all profiles"). */
export function pushedItc(period: string, gstin: string): Itc2bPush | null {
  const rows = getTable<Itc2bPush>(ITC_2B_TABLE);
  const g = gstin.trim().toUpperCase();
  return rows.find((r) => r?.id === `${period}|${g}`) ?? rows.find((r) => r?.id === `${period}|`) ?? null;
}
