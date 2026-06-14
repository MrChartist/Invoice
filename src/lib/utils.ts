import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDate(date: string | Date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(date));
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export function currencySymbol(currency: string = 'INR'): string {
  return CURRENCY_SYMBOLS[currency] || currency;
}

export function formatCurrency(amount: number, currency: string = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ─── Amount in Words (Indian system) ────────────────────────
const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigit(n: number): string {
  if (n < 20) return ones[n];
  return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
}

function threeDigit(n: number): string {
  if (n === 0) return '';
  if (n < 100) return twoDigit(n);
  return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoDigit(n % 100) : '');
}

export function amountInWords(amount: number, currency: string = 'INR'): string {
  if (amount === 0) return 'Zero';
  const n = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - n) * 100);

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = n % 1000;

  let words = '';
  if (crore) words += threeDigit(crore) + ' Crore ';
  if (lakh) words += twoDigit(lakh) + ' Lakh ';
  if (thousand) words += twoDigit(thousand) + ' Thousand ';
  if (hundred) words += threeDigit(hundred);

  words = words.trim();
  const units: Record<string, { major: string; minor: string }> = {
    INR: { major: 'Rupees', minor: 'Paise' },
    USD: { major: 'Dollars', minor: 'Cents' },
    EUR: { major: 'Euros', minor: 'Cents' },
    GBP: { major: 'Pounds', minor: 'Pence' },
  };
  const unit = units[currency] || { major: currency, minor: 'Cents' };
  const suffix = paise > 0 ? ` and ${twoDigit(paise)} ${unit.minor}` : '';
  return `${unit.major} ${words}${suffix} Only`;
}

// ─── Invoice status helpers ─────────────────────────────────
export type InvoiceStatus = 'Draft' | 'Sent' | 'Paid' | 'Overdue' | 'Partially Paid';

/** Amount actually received for an invoice (from recorded payments, or full total if marked Paid). */
export function amountReceived(inv: { amount_paid?: number; status?: string; total?: number }): number {
  if (typeof inv.amount_paid === 'number') return inv.amount_paid;
  return inv.status === 'Paid' ? (inv.total || 0) : 0;
}

/**
 * Returns the status to display, auto-flagging unpaid invoices whose due date
 * has passed as "Overdue" without mutating stored data.
 */
export function effectiveStatus(inv: { status?: string; due_date?: string }): InvoiceStatus {
  const status = (inv?.status as InvoiceStatus) || 'Draft';
  if (status === 'Sent' && inv.due_date) {
    const due = new Date(inv.due_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (due < today) return 'Overdue';
  }
  return status;
}
