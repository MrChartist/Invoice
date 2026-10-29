/**
 * CN-C2 / C5 print papers (script-free HTML for `printHtmlDocument`): the allotment letter / booking receipt (project,
 * RERA no., unit, carpet area, cost sheet with pass-through heads apart, payment plan, the RERA collection account,
 * terms from settings) and the cancellation statement (with the Circular 188/20/2022-GST note when GST stays paid).
 */
import type { PaymentPlan, RealtyBooking, RealtyProject, RealtyUnit } from '../../types/construction-r11';
import type { BankAccount } from '../bank-accounts';
import { esc } from '../voucher-print';
import { formatCurrency, formatDate } from '../utils';
import { agreementValue, passThroughTotal } from './cn-bookings';
import { PRINT_FONT, PRINT_FONT_FACE } from '../print-fonts';

const m = (n: number) => esc(formatCurrency(n));
const CSS = `body{font:13px/1.45 ${PRINT_FONT};color:#111;margin:24px}h1{font-size:18px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin:10px 0}td,th{border:1px solid #999;padding:4px 6px;text-align:left}td.n,th.n{text-align:right}.note{font-size:12px;color:#555}`;
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_FONT_FACE}${CSS}</style></head><body>${body}<p class="note">Working paper — verify with your CA.</p></body></html>`;

export function allotmentHtml(b: RealtyBooking, u: RealtyUnit | undefined, p: RealtyProject | undefined, plan: PaymentPlan | undefined, acc: BankAccount | undefined, company: string, terms = ''): string {
  const heads = (pass: boolean) => b.cost_sheet.filter((h) => h.pass_through === pass && h.amount).map((h) => `<tr><td>${esc(h.head)}</td><td class="n">${m(h.amount)}</td></tr>`).join('');
  return page(`Allotment letter ${b.number}`, `<h1>${esc(company)}</h1><h2>Allotment letter / booking receipt — ${esc(b.number)}</h2>
<p>Date: ${esc(formatDate(b.date))}<br>Allottee: <strong>${esc(b.client_name)}</strong>${b.co_applicants ? ` with ${esc(b.co_applicants)}` : ''}</p>
<p>Project: <strong>${esc(p?.name ?? '')}</strong>${p?.rera_no ? ` · RERA registration no. ${esc(p.rera_no)}` : ''}<br>Unit ${esc(u?.unit_no ?? '')}, floor ${u?.floor ?? ''} · carpet area ${u?.carpet_sqm ?? ''} sq m</p>
<table><tr><th>Cost sheet</th><th class="n">₹</th></tr>${heads(false)}<tr><th>Agreement value</th><th class="n">${m(agreementValue(b.cost_sheet))}</th></tr></table>
${passThroughTotal(b.cost_sheet) ? `<table><tr><th>Collected as pure agent (not part of the value; no GST)</th><th class="n">₹</th></tr>${heads(true)}</table>` : ''}
${plan ? `<table><tr><th>Payment plan: ${esc(plan.name)}</th><th class="n">%</th><th class="n">₹</th></tr>${plan.stages.map((s) => `<tr><td>${esc(s.label)}</td><td class="n">${s.pct}</td><td class="n">${m((b.agreement_value * s.pct) / 100)}</td></tr>`).join('')}</table>` : ''}
${acc ? `<p>Pay only to: <strong>${esc(acc.name)}</strong>${acc.account_no ? ` · A/c ${esc(acc.account_no)}` : ''}${acc.ifsc ? ` · IFSC ${esc(acc.ifsc)}` : ''} (RERA collection account).</p>` : ''}
<p>GST is charged on each demand at the rate in force on its date (land deemed one-third). ${terms ? esc(terms) : ''}</p>`);
}

export function cancellationHtml(b: RealtyBooking, company: string): string {
  const c = b.cancellation;
  if (!c) return '';
  return page(`Cancellation ${b.number}`, `<h1>${esc(company)}</h1><h2>Cancellation of booking ${esc(b.number)} — ${esc(b.client_name)}</h2>
<p>Date: ${esc(formatDate(c.date))} · Reason: ${esc(c.reason)}</p>
<table><tr><td>Amount received</td><td class="n">${m(c.received)}</td></tr><tr><td>Less: forfeiture</td><td class="n">${m(c.forfeiture)}</td></tr><tr><td>Less: GST paid on demands past the Sec 34 time limit</td><td class="n">${m(c.tax_retained)}</td></tr><tr><th>Refund</th><th class="n">${m(c.refund)}</th></tr></table>
${c.tax_retained > 0 ? `<p>GST collected ${m(c.tax_retained)} may be claimed by the buyer as a refund (Circular 188/20/2022-GST).</p>` : '<p>GST on the demands is reversed by credit notes (Sec 34).</p>'}`);
}
