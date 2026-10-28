/**
 * Printable vouchers (P1-15): journal, contra, payment and receipt entries — and any automatic
 * voucher of the ledger — in the Tally voucher-print style: company header, voucher type, number
 * and date, Dr / Cr particulars ("By" / "To"), narration, amount in words and the
 * "Prepared by / Checked by / Authorised signatory" boxes.
 *
 * Pure: builds a complete, script-free HTML document (inline styles, every value escaped) that
 * opens in a plain print window under the app's CSP, like receipts and cheque prints.
 */

import { amountInWords } from './amount-in-words';
import { formatDate, formatMoney } from './utils';
import { escHtml as esc } from './html-esc';

export interface VoucherPrintLine {
  account: string;
  party?: string;
  /** Integer paise; exactly one of dr / cr is > 0. */
  dr: number;
  cr: number;
}

export interface VoucherPrintModel {
  company: { name: string; address?: string; gstin?: string };
  /** "Journal", "Payment", "Sales" … */
  typeLabel: string;
  number: string;
  /** Local day YYYY-MM-DD. */
  date: string;
  narration: string;
  party?: string;
  lines: VoucherPrintLine[];
}

export interface VoucherSource {
  kind: string;
  number: string;
  date: string;
  narration: string;
  party?: string;
  lines: readonly { account: string; dr: number; cr: number; party?: string }[];
}

/** Map a ledger / manual voucher to the print model, naming accounts through `accountName`. */
export function buildVoucherPrint(
  v: VoucherSource,
  accountName: (id: string) => string,
  company: VoucherPrintModel['company'],
): VoucherPrintModel {
  // Tally prints the debits first ("By"), then the credits ("To").
  const lines = [...v.lines]
    .map((l) => ({ account: accountName(l.account) || l.account, party: l.party, dr: Math.max(0, Math.round(l.dr || 0)), cr: Math.max(0, Math.round(l.cr || 0)) }))
    .sort((a, b) => Number(b.dr > 0) - Number(a.dr > 0));
  return { company, typeLabel: v.kind, number: v.number, date: v.date, narration: v.narration, party: v.party || undefined, lines };
}

/** Σ debits = Σ credits for a balanced voucher, in paise. */
export function voucherAmount(lines: readonly VoucherPrintLine[]): { dr: number; cr: number } {
  return lines.reduce((t, l) => ({ dr: t.dr + l.dr, cr: t.cr + l.cr }), { dr: 0, cr: 0 });
}

export { esc };

const money = (paise: number) => esc(formatMoney(paise / 100));

const VOUCHER_CSS = `
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; margin: 0; padding: 28px; }
  .v { max-width: 720px; margin: 0 auto 32px; border: 1px solid #222; padding: 0; break-after: page; page-break-after: always; }
  .v:last-child { break-after: auto; page-break-after: auto; }
  .head { text-align: center; padding: 14px 16px 10px; border-bottom: 1px solid #222; }
  .head h1 { margin: 0; font-size: 18px; }
  .head .sub { font-size: 12px; color: #444; white-space: pre-line; }
  .title { text-align: center; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; padding: 6px; border-bottom: 1px solid #222; }
  .meta { display: flex; justify-content: space-between; padding: 8px 14px; font-size: 13px; border-bottom: 1px solid #222; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 6px 14px; text-align: left; vertical-align: top; }
  th { border-bottom: 1px solid #222; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; width: 120px; }
  .party { font-size: 11px; color: #555; }
  tr.total td { border-top: 1px solid #222; font-weight: 700; }
  .narr, .words { padding: 8px 14px; font-size: 12px; border-top: 1px solid #222; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid #222; font-size: 12px; }
  .sign div { padding: 44px 10px 8px; text-align: center; border-right: 1px solid #222; }
  .sign div:last-child { border-right: 0; }
  .note { max-width: 720px; margin: 0 auto; font-size: 10px; color: #777; }
  @media print { body { padding: 0; } .note { display: none; } }
`;

/** One voucher as an HTML fragment (`<section>`); every value escaped. */
export function voucherSection(m: VoucherPrintModel): string {
  const total = voucherAmount(m.lines);
  const rows = m.lines
    .map(
      (l) => `<tr><td>${l.dr > 0 ? 'By' : 'To'} ${esc(l.account)}${l.party ? `<div class="party">${esc(l.party)}</div>` : ''}</td>` +
        `<td class="n">${l.dr > 0 ? money(l.dr) : ''}</td><td class="n">${l.cr > 0 ? money(l.cr) : ''}</td></tr>`,
    )
    .join('');
  const sub = [m.company.address, m.company.gstin ? `GSTIN: ${m.company.gstin}` : ''].filter(Boolean).join('\n');
  return `<section class="v">
  <div class="head"><h1>${esc(m.company.name || 'Your business')}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
  <div class="title">${esc(m.typeLabel)} Voucher</div>
  <div class="meta"><span>No.: <strong>${esc(m.number || '—')}</strong></span><span>Dated: <strong>${esc(formatDate(m.date))}</strong></span></div>
  ${m.party ? `<div class="meta"><span>Party: <strong>${esc(m.party)}</strong></span></div>` : ''}
  <table><thead><tr><th>Particulars</th><th class="n">Debit (₹)</th><th class="n">Credit (₹)</th></tr></thead>
  <tbody>${rows}<tr class="total"><td>Total</td><td class="n">${money(total.dr)}</td><td class="n">${money(total.cr)}</td></tr></tbody></table>
  ${m.narration ? `<div class="narr"><strong>Narration:</strong> ${esc(m.narration)}</div>` : ''}
  <div class="words"><strong>Amount (in words):</strong> ${esc(amountInWords(total.dr / 100))}</div>
  <div class="sign"><div>Prepared by</div><div>Checked by</div><div>Authorised signatory</div></div>
</section>`;
}

/** A complete print document holding one or more vouchers (one per page). */
export function voucherHtml(models: readonly VoucherPrintModel[], title = 'Voucher'): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${VOUCHER_CSS}</style></head>
<body>
${models.map(voucherSection).join('\n')}
<p class="note">Printed on the issuer's device. Working paper — verify with your CA.</p>
</body></html>`;
}

/**
 * Open script-free HTML in a new window and print it; when pop-ups are blocked the HTML is
 * handed to `fallback` (normally a download). Browser-only.
 */
export function printHtmlDocument(html: string, fallback: (html: string) => void): boolean {
  const w = window.open('', '_blank');
  if (!w) {
    fallback(html);
    return false;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
  return true;
}
