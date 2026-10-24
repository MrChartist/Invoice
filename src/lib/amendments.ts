/**
 * GSTR-1 amendments (roadmap 5.9).
 *
 * Model: an amendment is an edit OF THE SAME RECORD, marked as such. Before the first change the record
 * gets `amends` with a frozen copy of the document exactly as it was reported (`original`). From then on:
 *  - the GSTR-1 of the original period keeps reporting that frozen copy (it never changes — `asFiled` in
 *    gst-reports), and
 *  - the GSTR-1 of the period the amendment is made in (`amended_on`) reports the edited record in
 *    B2BA / B2CLA / CDNRA / CDNURA / B2CSA with the original number and date, and GSTR-3B of that period
 *    takes the difference.
 * Payments, credit-note links, receivables and books keep pointing at the one record, so nothing is
 * double counted. The period lock still applies: a locked document must be unlocked with the PIN first,
 * and every change is in the audit log.
 *
 * When does an edit need to be an amendment? Once the return the document went into is filed: a GSTR-1
 * (or IFF) "filed" mark in the compliance tracker for its month / quarter, or — as a proxy — the document
 * date being inside the locked period.
 *
 * Re-amending keeps the very first original (the original period never changes) and moves `amended_on`:
 * the earlier amendment period then shows the latest revision — a known limit. Working paper; verify with
 * your CA before filing.
 */

import type { AmendmentInfo, InvoiceRecord, SenderProfile } from '../types/invoice';
import type { FiledReturn } from './compliance';

/** Document types GSTR-1 has amendment tables for. A Bill of Supply (Table 8) and composition documents have none. */
const AMENDABLE = new Set(['INVOICE', 'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']);

const pad = (n: number) => String(n).padStart(2, '0');

function fyQuarter(iso: string): { fyStart: number; q: number; lastMonth: number; lastYear: number } {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const fyStart = m >= 4 ? y : y - 1;
  const q = Math.floor(((m - 4 + 12) % 12) / 3) + 1;
  const lastMonthRaw = 4 + q * 3 - 1; // 6, 9, 12, 15
  const lastMonth = ((lastMonthRaw - 1) % 12) + 1;
  return { fyStart, q, lastMonth, lastYear: lastMonthRaw > 12 ? fyStart + 1 : fyStart };
}

/** GSTN return period (MMYYYY) of `iso` for a monthly filer, or of its quarter for a QRMP filer. */
export function returnPeriodOf(iso: string, quarterly = false): string {
  const d = String(iso).slice(0, 10);
  if (!quarterly) return `${d.slice(5, 7)}${d.slice(0, 4)}`;
  const f = fyQuarter(d);
  return `${pad(f.lastMonth)}${f.lastYear}`;
}

export interface AmendCheck {
  /** Edits to this document belong in an amendment. */
  needed: boolean;
  /** Why (`filed` mark found, or the date is locked). */
  reason: 'filed' | 'locked' | null;
  /** Return period (MMYYYY) the original was reported in. */
  period: string;
}

export interface AmendContext {
  filed?: readonly FiledReturn[];
  lockUntil?: string;
}

export function canAmend(rec: Pick<InvoiceRecord, 'doc_type' | 'status' | 'sender'>): boolean {
  if (!AMENDABLE.has(rec.doc_type)) return false;
  if (rec.status === 'Draft' || rec.status === 'Cancelled') return false;
  return rec.sender?.gst_scheme !== 'composition';
}

/** Pure: has the return this document was reported in been filed (or its period locked)? */
export function amendmentCheck(rec: Pick<InvoiceRecord, 'issue_date' | 'sender' | 'amends'>, ctx: AmendContext = {}): AmendCheck {
  // An amended document is checked against its ORIGINAL date (that is the return it sits in).
  const d = String(rec.amends?.original_date ?? rec.issue_date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { needed: false, reason: null, period: '' };
  const gstin = (rec.sender?.companyGstin ?? '').trim().toUpperCase();
  const monthKey = d.slice(0, 7);
  const f = fyQuarter(d);
  const quarterKey = `${f.fyStart}-Q${f.q}`;
  const mark = (ctx.filed ?? []).find(
    (x) =>
      x &&
      (x.form === 'GSTR1' || x.form === 'IFF') &&
      (x.period_key === monthKey || x.period_key === quarterKey) &&
      (!x.gstin || !gstin || x.gstin.toUpperCase() === gstin),
  );
  if (mark) return { needed: true, reason: 'filed', period: returnPeriodOf(d, mark.period_key === quarterKey) };
  if (ctx.lockUntil && d <= ctx.lockUntil) return { needed: true, reason: 'locked', period: returnPeriodOf(d) };
  return { needed: false, reason: null, period: returnPeriodOf(d) };
}

/** The sender as GST reporting needs it: identity only (the full snapshot with images stays on the record). */
function gstIdentity(s: SenderProfile | null): SenderProfile | null {
  if (!s) return null;
  return {
    companyName: s.companyName,
    companyGstin: s.companyGstin,
    stateCode: s.stateCode,
    ...(s.gst_scheme ? { gst_scheme: s.gst_scheme } : {}),
  } as SenderProfile;
}

/** Pure: the amendment marker for `rec` amended on `today` (keeps the first original on a re-amendment). */
export function buildAmendment(rec: InvoiceRecord, today: string, opts: { period?: string; reason?: string } = {}): AmendmentInfo {
  const prev = rec.amends;
  if (prev?.original) {
    return { ...prev, amended_on: today, ...(opts.reason?.trim() ? { reason: opts.reason.trim() } : {}) };
  }
  const { amends: _drop, ...rest } = rec;
  void _drop;
  const original = { ...rest, sender: gstIdentity(rec.sender), items: (rec.items ?? []).map((i) => ({ ...i })), client: { ...rec.client } };
  return {
    original_number: rec.invoice_number,
    original_date: String(rec.issue_date).slice(0, 10),
    period: opts.period || returnPeriodOf(String(rec.issue_date)),
    amended_on: today,
    ...(opts.reason?.trim() ? { reason: opts.reason.trim() } : {}),
    original,
  };
}

/** A short line for the editor / document chain. */
export function amendmentLabel(a: AmendmentInfo | undefined): string {
  if (!a) return '';
  const p = a.period ? ` (return period ${a.period.slice(0, 2)}/${a.period.slice(2)})` : '';
  return `Amends ${a.original_number} dated ${a.original_date}${p}; reported as an amendment in the return for ${a.amended_on.slice(0, 7)}.`;
}
