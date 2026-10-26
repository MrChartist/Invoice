/**
 * R5-B1: the printed consignment note — a self-contained, script-free HTML page (like `rcmDocsHtml`) with three copies
 * (Consignor / Consignee / Driver-office), the person liable to pay GST, the GTA option line and the declaration.
 * Printed through `printHtmlDocument`; shared as text through Web Share / wa.me. Working paper — verify with your CA.
 */
import type { ConsignmentNote } from '../../types/transport-works-r5';
import { esc } from '../voucher-print';
import { freightOf } from './consignment-notes';
import { optionFor, optionLine } from './gta-option';
import type { GtaOptionRow } from '../../types/transport-works-r5';

export const LR_COPIES = ['Consignor copy', 'Consignee copy', 'Driver / office copy'] as const;

export interface LrPrintParty {
  name: string;
  gstin?: string;
  address?: string;
}

export interface LrPrintContext {
  company: { name: string; address?: string; gstin?: string };
  consignor: LrPrintParty;
  consignee: LrPrintParty;
  billingParty?: LrPrintParty;
  options?: readonly GtaOptionRow[];
}

const money = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PAY: Record<ConsignmentNote['payment_basis'], string> = { paid: 'Paid (consignor pays at booking)', to_pay: 'To pay (consignee pays at delivery)', tbb: 'To be billed' };

export function liableText(lr: Pick<ConsignmentNote, 'liable'>): string {
  return lr.liable === 'recipient' ? 'Recipient of the service (reverse charge)' : 'Goods transport agency (forward charge)';
}

const party = (label: string, p: LrPrintParty | undefined) =>
  p ? `<td><strong>${esc(label)}</strong><br>${esc(p.name)}${p.gstin ? `<br>GSTIN: ${esc(p.gstin)}` : ''}${p.address ? `<br><small>${esc(p.address)}</small>` : ''}</td>` : '<td></td>';

function copy(lr: ConsignmentNote, ctx: LrPrintContext, label: string): string {
  const f = freightOf(lr);
  const goods = lr.lines
    .map((l) => `<tr><td>${esc(l.description)}</td><td class="n">${esc(l.packages)}</td><td>${esc(l.packing ?? '')}</td><td class="n">${esc(l.actual_weight ?? '')}</td><td class="n">${esc(l.charged_weight ?? '')}</td><td class="n">${l.value ? money(l.value) : ''}</td></tr>`)
    .join('');
  const option = optionFor(lr.date, ctx.options);
  return `<section class="lr">
  <div class="head"><h1>${esc(ctx.company.name || 'Goods transport agency')}</h1><div class="sub">${esc([ctx.company.address, ctx.company.gstin ? `GSTIN: ${ctx.company.gstin}` : ''].filter(Boolean).join(' · '))}</div></div>
  <div class="title">Consignment note — ${esc(label)}</div>
  <div class="meta"><span>LR no.: <strong>${esc(lr.number)}</strong></span><span>Date: <strong>${esc(lr.date)}</strong></span><span>Vehicle: <strong>${esc(lr.vehicle_no || '—')}</strong></span></div>
  <div class="meta"><span>From: <strong>${esc(lr.from.place)}</strong> (${esc(lr.from.state)})</span><span>To: <strong>${esc(lr.to.place)}</strong> (${esc(lr.to.state)})</span>${lr.driver ? `<span>Driver: ${esc(lr.driver)}</span>` : ''}</div>
  <table class="parties"><tr>${party('Consignor', ctx.consignor)}${party('Consignee', ctx.consignee)}${party('Billing party', ctx.billingParty)}</tr></table>
  <table><thead><tr><th>Goods</th><th class="n">Pkgs</th><th>Packing</th><th class="n">Actual kg</th><th class="n">Charged kg</th><th class="n">Value ₹</th></tr></thead><tbody>${goods}</tbody></table>
  <div class="meta"><span>Invoice no(s).: ${esc(lr.invoice_nos || '—')}</span><span>E-way bill no(s).: ${esc(lr.eway_nos || '—')}</span></div>
  <div class="meta"><span>Freight: ₹${money(f.freight)}</span><span>Charges: ₹${money(round(f.charges + f.ownLine))}</span><span>Total: <strong>₹${money(f.total)}</strong></span><span>${esc(PAY[lr.payment_basis])}</span></div>
  <div class="liable"><strong>Person liable to pay GST:</strong> ${esc(liableText(lr))}${lr.liable_override_reason ? ` (${esc(lr.liable_override_reason)})` : ''}<br><small>${esc(optionLine(option, lr.date))}</small></div>
  <div class="decl">We have received the goods described above in apparent good order and condition for carriage, subject to the conditions overleaf. The goods transport agency is not responsible for leakage, breakage or damage due to the nature of the goods or their packing.</div>
  <div class="sign"><div>Consignor’s signature</div><div>For the transport agency</div></div>
</section>`;
}

const round = (n: number) => Math.round(n * 100) / 100;

const CSS = `body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;margin:0;padding:20px}
.lr{max-width:760px;margin:0 auto 24px;border:1px solid #222;break-after:page;page-break-after:always}.lr:last-of-type{break-after:auto}
.head{text-align:center;padding:10px;border-bottom:1px solid #222}.head h1{margin:0;font-size:18px}.sub{font-size:12px;color:#444}
.title{text-align:center;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:5px;border-bottom:1px solid #222}
.meta{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;padding:6px 12px;font-size:13px;border-bottom:1px solid #222}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:5px 10px;text-align:left;vertical-align:top;border-bottom:1px solid #ddd}
td.n,th.n{text-align:right}.parties td{width:33%;border-right:1px solid #ddd}.liable,.decl{padding:8px 12px;font-size:12px;border-top:1px solid #222}
.sign{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #222;font-size:12px}.sign div{padding:40px 10px 8px;text-align:center}
.note{max-width:760px;margin:0 auto;font-size:10px;color:#777}@media print{body{padding:0}.note{display:none}}`;

/** The full print page: three copies of one LR. */
export function lrHtml(lr: ConsignmentNote, ctx: LrPrintContext): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(lr.number)}</title><style>${CSS}</style></head><body>
${LR_COPIES.map((c) => copy(lr, ctx, c)).join('\n')}
<p class="note">Printed on the issuer's device. Working paper — verify the consignment-note contents with your CA.</p></body></html>`;
}

/** Short text for Web Share / WhatsApp. */
export function lrShareText(lr: ConsignmentNote, ctx: Pick<LrPrintContext, 'company' | 'consignee'>): string {
  const f = freightOf(lr);
  return `${ctx.company.name}: LR ${lr.number} dated ${lr.date}, ${lr.from.place} → ${lr.to.place}, ${lr.lines.reduce((s, l) => s + l.packages, 0)} pkgs for ${ctx.consignee.name}. Vehicle ${lr.vehicle_no || '—'}. Freight ₹${money(f.total)} (${PAY[lr.payment_basis]}). GST payable by: ${liableText(lr)}.`;
}
