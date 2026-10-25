/**
 * Post-save "Send to customer" message (8G, 8.105): the document summary plus the party's whole
 * balance and the next instalment due, so one WhatsApp / e-mail answers "how much do I owe you?".
 * Pure: amounts come from the documents.
 */

import type { InvoiceRecord } from '../types/invoice';
import { invoiceSummaryText } from './share';
import { receivableBalance } from './rcm';
import { round2 } from './invoice-calc';
import { openInstalments } from './payment-schedule';
import { formatCurrency, formatDate } from './utils';

const OPEN_DOCS = new Set(['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY']);
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Everything the party still owes on issued rupee documents (all bills, this one included). */
export function partyOutstanding(invoices: readonly InvoiceRecord[], party: { id?: string; name?: string } | undefined): { total: number; bills: number } {
  let total = 0;
  let bills = 0;
  if (!party) return { total, bills };
  for (const inv of invoices) {
    if (!inv || !OPEN_DOCS.has(inv.doc_type) || inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    if ((inv.currency || 'INR').toUpperCase() !== 'INR') continue;
    const same = party.id && inv.client?.id ? party.id === inv.client.id : !!norm(party.name) && norm(party.name) === norm(inv.client?.name);
    if (!same) continue;
    const b = receivableBalance(inv);
    if (b > 0.004) {
      total = round2(total + b);
      bills++;
    }
  }
  return { total, bills };
}

export function sendMessage(inv: InvoiceRecord, outstanding: { total: number; bills: number }): string {
  const lines = [invoiceSummaryText(inv)];
  const next = openInstalments(inv)[0];
  if (next) lines.push('', `Next instalment: ${formatCurrency(next.open, inv.currency)} due ${formatDate(next.instalment.due_date)}${next.instalment.label ? ` (${next.instalment.label})` : ''}`);
  if (outstanding.bills > 1 || (outstanding.bills === 1 && round2(outstanding.total) !== round2(Math.max(receivableBalance(inv), 0)))) {
    lines.push('', `Total outstanding on your account: ${formatCurrency(outstanding.total, 'INR')} (${outstanding.bills} bill${outstanding.bills === 1 ? '' : 's'})`);
  }
  return lines.join('\n');
}

/** WhatsApp text: summary + balance / outstanding / next instalment + the UPI pay link (A1). */
export function sheetMessage(text: string, upi: string | null): string {
  return upi ? `${text}\n\nPay by UPI: ${upi}` : text;
}
