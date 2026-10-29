/**
 * "Confirmation of Accounts" letter (P1-6 print part): for one party and a period, the balance
 * as it stands in our books (opening, debits, credits, closing) and the bills still open on the
 * closing date, with the usual request to confirm or point out differences. Tally prints the
 * same letter from Display → Statements of Accounts → Confirmation of Accounts.
 *
 * Pure: the model is computed from the receivables ledger (`buildLedger`), the HTML is script-free
 * and fully escaped, one letter per page, so many letters print in one job.
 */

import type { Client, SenderProfile } from '../types/invoice';
import { buildLedger, closingInWords, type PartyReceivable } from './receivables';
import { round2 } from './invoice-calc';
import { formatDate, formatMoney } from './utils';
import { esc } from './voucher-print';
import { PRINT_FONT, PRINT_FONT_FACE } from './print-fonts';

export interface LetterBill {
  number: string;
  date: string;
  amount: number;
  /** Outstanding on the closing date (receipts dated after it are not counted). */
  outstanding: number;
}

export interface ConfirmationLetter {
  party: string;
  partyAddress: string;
  partyGstin: string;
  from: string;
  to: string;
  opening: number;
  totalDebit: number;
  totalCredit: number;
  /** Positive = the party owes us (Dr); negative = we owe the party (Cr). */
  closing: number;
  closingWords: string;
  bills: LetterBill[];
  /** Σ open bills on the closing date. */
  billsTotal: number;
  /** billsTotal − closing: advances, credit notes and on-account receipts not set against a bill. */
  unadjusted: number;
  currency: string;
}

/** Open bills on `to` from the ledger entries: bill amount less receipts against it dated up to `to`. */
export function billsOnDate(party: Pick<PartyReceivable, 'entries'>, to: string): LetterBill[] {
  const bills = new Map<string, LetterBill>();
  for (const e of party.entries) {
    if (to && e.date > to) continue;
    if (e.kind === 'invoice' && e.invoiceId) bills.set(e.invoiceId, { number: e.ref, date: e.date, amount: e.debit, outstanding: e.debit });
  }
  for (const e of party.entries) {
    if (to && e.date > to) continue;
    if (e.kind === 'payment' && e.invoiceId && bills.has(e.invoiceId)) {
      const b = bills.get(e.invoiceId) as LetterBill;
      b.outstanding = round2(b.outstanding - e.credit);
    }
  }
  return [...bills.values()]
    .filter((b) => b.outstanding > 0.004)
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

export function buildConfirmationLetter(party: PartyReceivable, from: string, to: string, opts: { client?: Client; currency?: string } = {}): ConfirmationLetter {
  const ledger = buildLedger(party, from, to);
  const bills = billsOnDate(party, to);
  const billsTotal = round2(bills.reduce((s, b) => s + b.outstanding, 0));
  const c = opts.client;
  const currency = opts.currency ?? 'INR';
  return {
    party: party.name,
    partyAddress: [c?.company, c?.address, [c?.city, c?.zip].filter(Boolean).join(' '), c?.state].filter(Boolean).join('\n'),
    partyGstin: c?.gstin ?? '',
    from,
    to,
    opening: ledger.opening,
    totalDebit: ledger.totalDebit,
    totalCredit: ledger.totalCredit,
    closing: ledger.closing,
    closingWords: closingInWords(ledger.closing, currency),
    bills,
    billsTotal,
    unadjusted: round2(billsTotal - ledger.closing),
    currency,
  };
}

function drCr(n: number, currency: string): string {
  if (Math.abs(n) < 0.005) return formatMoney(0, currency);
  return `${formatMoney(Math.abs(n), currency)} ${n > 0 ? 'Dr' : 'Cr'}`;
}

const LETTER_CSS = `
  body { font-family: ${PRINT_FONT}; color: #111; margin: 0; padding: 32px; font-size: 13px; line-height: 1.5; }
  .l { max-width: 720px; margin: 0 auto 40px; break-after: page; page-break-after: always; }
  .l:last-of-type { break-after: auto; page-break-after: auto; }
  .head { text-align: center; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 16px; }
  .head h1 { margin: 0; font-size: 18px; }
  .head div { font-size: 12px; color: #444; white-space: pre-line; }
  .row { display: flex; justify-content: space-between; gap: 16px; }
  .to { white-space: pre-line; }
  h2 { font-size: 14px; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th, td { border: 1px solid #999; padding: 5px 8px; text-align: left; }
  th { background: #f2f2f2; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 600; }
  .sign { display: flex; justify-content: space-between; margin-top: 48px; gap: 24px; }
  .sign div { flex: 1; border-top: 1px solid #111; padding-top: 6px; font-size: 12px; }
  .note { font-size: 12px; color: #777; margin-top: 20px; }
  @media print { body { padding: 0; } }
`;

/** One letter as an HTML fragment; every value is escaped. */
export function letterSection(l: ConfirmationLetter, sender: Pick<SenderProfile, 'companyName' | 'companyAddress' | 'companyGstin' | 'pan'> | null, today: string): string {
  const m = (n: number) => esc(formatMoney(n, l.currency));
  const period = `${l.from ? formatDate(l.from) : 'the beginning'} to ${l.to ? formatDate(l.to) : formatDate(today)}`;
  const company = sender?.companyName || 'Your business';
  const sub = [sender?.companyAddress, sender?.companyGstin ? `GSTIN: ${sender.companyGstin}` : '', sender?.pan ? `PAN: ${sender.pan}` : ''].filter(Boolean).join('\n');
  const bills = l.bills.length
    ? `<h2>Bills outstanding as on ${esc(formatDate(l.to || today))}</h2>
<table><thead><tr><th>Bill no.</th><th>Date</th><th class="n">Bill amount</th><th class="n">Outstanding</th></tr></thead><tbody>
${l.bills.map((b) => `<tr><td>${esc(b.number)}</td><td>${esc(formatDate(b.date))}</td><td class="n">${m(b.amount)}</td><td class="n">${m(b.outstanding)}</td></tr>`).join('')}
<tr class="total"><td colspan="3">Total of open bills</td><td class="n">${m(l.billsTotal)}</td></tr>
${Math.abs(l.unadjusted) > 0.004 ? `<tr><td colspan="3">Less: advances / credit notes / on-account receipts not set against a bill</td><td class="n">${m(l.unadjusted)}</td></tr>` : ''}
<tr class="total"><td colspan="3">Closing balance</td><td class="n">${esc(drCr(l.closing, l.currency))}</td></tr>
</tbody></table>`
    : '';
  return `<section class="l">
<div class="head"><h1>${esc(company)}</h1>${sub ? `<div>${esc(sub)}</div>` : ''}</div>
<div class="row"><div class="to">To,<br><strong>${esc(l.party)}</strong>${l.partyAddress ? `<br>${esc(l.partyAddress)}` : ''}${l.partyGstin ? `<br>GSTIN: ${esc(l.partyGstin)}` : ''}</div>
<div>Date: ${esc(formatDate(today))}</div></div>
<h2>Sub: Confirmation of accounts for the period ${esc(period)}</h2>
<p>Dear Sir / Madam,</p>
<p>Given below are the details of your account as standing in our books for the above period. Kindly confirm the
balance by signing and returning a copy of this letter, or let us know of any difference with a copy of your ledger
so that it can be reconciled. If we do not hear from you within 15 days, the balance will be taken as confirmed.</p>
<table><thead><tr><th>Particulars</th><th class="n">Amount</th></tr></thead><tbody>
<tr><td>Opening balance${l.from ? ` as on ${esc(formatDate(l.from))}` : ''}</td><td class="n">${esc(drCr(l.opening, l.currency))}</td></tr>
<tr><td>Add: bills / debits during the period</td><td class="n">${m(l.totalDebit)}</td></tr>
<tr><td>Less: receipts / credits during the period</td><td class="n">${m(l.totalCredit)}</td></tr>
<tr class="total"><td>Closing balance as on ${esc(formatDate(l.to || today))}</td><td class="n">${esc(drCr(l.closing, l.currency))}</td></tr>
</tbody></table>
<p><strong>Closing balance in words:</strong> ${esc(l.closingWords)}</p>
${bills}
<div class="sign"><div>For ${esc(company)}<br><br>Authorised signatory</div><div>Confirmed: for ${esc(l.party)}<br><br>Signature, seal &amp; PAN</div></div>
<p class="note">Dr = the party owes us; Cr = we owe the party. Working paper — verify with your CA.</p>
</section>`;
}

/** A complete print document with one letter per page. */
export function confirmationLettersHtml(letters: readonly ConfirmationLetter[], sender: Parameters<typeof letterSection>[1], today: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Confirmation of accounts</title>
<style>${PRINT_FONT_FACE}${LETTER_CSS}</style></head>
<body>
${letters.map((l) => letterSection(l, sender, today)).join('\n')}
</body></html>`;
}
