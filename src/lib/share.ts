/**
 * Share-link builders. Everything here is pure string work — nothing is sent
 * by the app; we only produce `wa.me`, `mailto:`, `sms:`, `tel:` and `upi://`
 * links that the user's own device then opens.
 */

import type { InvoiceRecord } from '../types/invoice';
import { DOCUMENT_LABELS } from '../types/invoice';
import { formatCurrency, formatDate } from './utils';

/** Encoded-URL budget. WhatsApp/browsers cope with ~2k; stay well inside. */
export const MAX_URL_LENGTH = 1900;

/* ── Phone numbers ────────────────────────────────────────────── */

/**
 * Normalise a phone number to digits-only international form (no "+"), as
 * `wa.me` requires. Returns null when it cannot be a plausible number.
 *   "98765 43210" -> "919876543210"      "+91 98765-43210" -> "919876543210"
 *   "09876543210" -> "919876543210"      "0091 98765 43210" -> "919876543210"
 *   "+1 415 555 0100" -> "14155550100"
 */
export function normalizePhone(raw: string | undefined | null, defaultCountryCode = '91'): string | null {
  if (!raw) return null;
  const text = String(raw).trim();
  const explicitIntl = text.startsWith('+');
  let digits = text.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('00')) digits = digits.slice(2); // 0091… dialling prefix
  else if (!explicitIntl && digits.startsWith('0')) digits = digits.replace(/^0+/, ''); // trunk 0

  if (!digits) return null;
  if (digits.length === 10 && !explicitIntl) return defaultCountryCode + digits;
  if (explicitIntl || digits.length > 10) {
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }
  return null; // 1–9 digits without a country code: not dialable
}

/** Human display, e.g. "+91 98765 43210" for Indian numbers. */
export function formatPhoneDisplay(raw: string | undefined | null): string {
  const n = normalizePhone(raw);
  if (!n) return raw?.trim() ?? '';
  if (n.startsWith('91') && n.length === 12) return `+91 ${n.slice(2, 7)} ${n.slice(7)}`;
  return `+${n}`;
}

/* ── Length safety ────────────────────────────────────────────── */

/**
 * Trim `text` so its URL-encoded length is <= maxEncoded, cutting at a line or
 * word boundary and appending an ellipsis. Never splits a surrogate pair.
 */
export function truncateForUrl(text: string, maxEncoded: number): string {
  if (encodeURIComponent(text).length <= maxEncoded) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (encodeURIComponent(chars.slice(0, mid).join('') + '…').length <= maxEncoded) lo = mid;
    else hi = mid - 1;
  }
  let cut = chars.slice(0, lo).join('');
  const boundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
  if (boundary > cut.length * 0.6) cut = cut.slice(0, boundary);
  return cut.trimEnd() + '…';
}

/* ── Link builders ────────────────────────────────────────────── */

export function whatsappLink(phone: string | undefined | null, text: string): string {
  const base = 'https://wa.me/' + (normalizePhone(phone) ?? '');
  const budget = MAX_URL_LENGTH - base.length - '?text='.length;
  return `${base}?text=${encodeURIComponent(truncateForUrl(text, budget))}`;
}

export interface MailtoOptions {
  to?: string;
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  body?: string;
}

function emailList(v: string | string[] | undefined): string[] {
  const list = Array.isArray(v) ? v : (v ?? '').split(/[;,]/);
  return list.map((s) => s.trim()).filter((s) => /^[^\s@,;<>]+@[^\s@,;<>]+$/.test(s));
}

export function isValidEmail(v: string | undefined | null): boolean {
  return !!v && emailList(v).length > 0;
}

function encodeAddresses(list: string[]): string {
  return list.map((a) => encodeURIComponent(a).replace(/%40/g, '@')).join(',');
}

/** mailto: with RFC 6068 CRLF line breaks (%0D%0A) so every client keeps paragraphs. */
export function mailtoLink(opts: MailtoOptions): string {
  const head = `mailto:${encodeAddresses(emailList(opts.to))}`;
  const params: string[] = [];
  const cc = emailList(opts.cc);
  const bcc = emailList(opts.bcc);
  if (cc.length) params.push(`cc=${encodeURIComponent(cc.join(',')).replace(/%2C/gi, ',')}`);
  if (bcc.length) params.push(`bcc=${encodeURIComponent(bcc.join(',')).replace(/%2C/gi, ',')}`);
  if (opts.subject) params.push(`subject=${encodeURIComponent(opts.subject)}`);
  if (opts.body) {
    const used = head.length + params.join('&').length + 12;
    const limit = Math.max(200, MAX_URL_LENGTH - used);
    const source = opts.body.replace(/\r?\n/g, '\n');
    // CRLF costs 3 extra encoded chars per line: shrink the budget until it fits.
    let budget = limit;
    let encoded = '';
    for (let i = 0; i < 12; i++) {
      encoded = encodeURIComponent(truncateForUrl(source, budget)).replace(/%0A/g, '%0D%0A');
      if (encoded.length <= limit) break;
      budget -= encoded.length - limit + 3;
    }
    params.push(`body=${encoded}`);
  }
  return params.length ? `${head}?${params.join('&')}` : head;
}

export function smsLink(phone: string | undefined | null, body: string): string {
  const n = normalizePhone(phone);
  return `sms:${n ? '+' + n : ''}?body=${encodeURIComponent(truncateForUrl(body, 700))}`;
}

export function telLink(phone: string | undefined | null): string | null {
  const n = normalizePhone(phone);
  return n ? `tel:+${n}` : null;
}

/* ── UPI ──────────────────────────────────────────────────────── */

export interface UpiOptions {
  /** Payee VPA, e.g. name@bank */
  pa: string;
  /** Payee name */
  pn?: string;
  amount?: number;
  /** Transaction note — typically the invoice number */
  note?: string;
  /** Transaction reference (kept short; many apps cap at 35 chars) */
  tr?: string;
}

export function isValidUpiId(v: string | undefined | null): boolean {
  return !!v && /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/.test(v.trim());
}

function upiEncode(v: string): string {
  // UPI apps want %20 for spaces and strict percent-encoding of the rest.
  return encodeURIComponent(v).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** `upi://pay?...` deep link, or null if the VPA is not valid. */
export function upiLink(opts: UpiOptions): string | null {
  const pa = (opts.pa ?? '').trim();
  if (!isValidUpiId(pa)) return null;
  const parts = [`pa=${pa}`];
  if (opts.pn?.trim()) parts.push(`pn=${upiEncode(opts.pn.trim().slice(0, 60))}`);
  if (typeof opts.amount === 'number' && Number.isFinite(opts.amount) && opts.amount > 0) {
    parts.push(`am=${(Math.round(opts.amount * 100) / 100).toFixed(2)}`);
  }
  parts.push('cu=INR');
  if (opts.note?.trim()) parts.push(`tn=${upiEncode(opts.note.trim().slice(0, 80))}`);
  if (opts.tr?.trim()) parts.push(`tr=${upiEncode(opts.tr.trim().slice(0, 35))}`);
  return `upi://pay?${parts.join('&')}`;
}

/** Payment link for an invoice's outstanding balance (INR only). */
export function invoiceUpiLink(invoice: InvoiceRecord): string | null {
  const s = invoice.sender;
  if (!s?.upiId || (invoice.currency || 'INR').toUpperCase() !== 'INR') return null;
  return upiLink({
    pa: s.upiId,
    pn: s.companyName,
    amount: invoice.balance_due > 0 ? invoice.balance_due : invoice.total,
    note: `Payment for ${invoice.invoice_number}`,
  });
}

/* ── Plain-text summary ───────────────────────────────────────── */

export function invoiceSummaryText(invoice: InvoiceRecord): string {
  const cur = invoice.currency || 'INR';
  const label = DOCUMENT_LABELS[invoice.doc_type] ?? 'Invoice';
  const items = invoice.items ?? [];
  const lines: string[] = [];
  lines.push(`*${label} ${invoice.invoice_number}*`);
  if (invoice.sender?.companyName) lines.push(`From: ${invoice.sender.companyName}`);
  if (invoice.client?.name) lines.push(`To: ${invoice.client.name}`);
  lines.push(`Date: ${formatDate(invoice.issue_date)}`);
  if (invoice.due_date) lines.push(`Due: ${formatDate(invoice.due_date)}`);
  lines.push('');
  for (const item of items.slice(0, 8)) lines.push(`- ${item.name} x ${item.quantity}`);
  if (items.length > 8) lines.push(`- …and ${items.length - 8} more`);
  lines.push('');
  lines.push(`Total: ${formatCurrency(invoice.total, cur)}`);
  if ((invoice.amount_paid ?? 0) > 0) lines.push(`Paid: ${formatCurrency(invoice.amount_paid, cur)}`);
  if (invoice.balance_due > 0) lines.push(`Balance due: ${formatCurrency(invoice.balance_due, cur)}`);
  const s = invoice.sender;
  if (s?.upiId && invoice.balance_due > 0) lines.push(`UPI: ${s.upiId}`);
  if (s?.companyName) lines.push('', `Thank you, ${s.companyName}`);
  return lines.join('\n');
}
