/**
 * Printable delivery challan for goods sent to a job worker (CGST Rule 55(1)(c), Sec 143; Phase 7M): consignor
 * and consignee with GSTIN, challan number (≤ 16 characters, consecutive per FY) and date, HSN, description,
 * quantity, taxable value, rate / amount of tax (shown for information — no tax is charged on a job-work
 * challan), place of supply when inter-state, signature; three copies (Rule 55(2)). Pure HTML; every value escaped.
 */

import type { MaterialOut } from '../types/job-work';
import type { StockItem } from './inventory';
import { num, round2 } from './invoice-calc';
import { esc } from './voucher-print';
import { formatDate, formatMoney } from './utils';
import { returnDeadline } from './job-work';
import { PRINT_FONT, PRINT_FONT_FACE } from './print-fonts';

export interface ChallanCompany {
  name: string;
  address?: string;
  gstin?: string;
  stateCode?: string;
}

const COPIES = ['Original for consignee', 'Duplicate for transporter', 'Triplicate for consignor'];

const CSS = `
  body { font-family: ${PRINT_FONT}; color: #111; margin: 0; padding: 24px; }
  .c { max-width: 760px; margin: 0 auto 28px; border: 1px solid #222; break-after: page; page-break-after: always; }
  .c:last-child { break-after: auto; page-break-after: auto; }
  .head { display: flex; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #222; font-size: 12px; }
  .head h1 { margin: 0 0 4px; font-size: 17px; }
  .title { text-align: center; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 6px; border-bottom: 1px solid #222; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #222; font-size: 12px; }
  .grid div { padding: 8px 14px; }
  .grid div:first-child { border-right: 1px solid #222; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 5px 8px; text-align: left; border-bottom: 1px solid #ccc; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #222; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 600; border-top: 1px solid #222; }
  .note { padding: 8px 14px; font-size: 12px; border-top: 1px solid #222; }
  .sign { display: flex; justify-content: flex-end; padding: 36px 14px 10px; font-size: 12px; }
  @media print { body { padding: 0; } }
`;

/** The challan as a complete print document (three copies). */
export function materialOutChallanHtml(o: MaterialOut, items: readonly StockItem[], company: ChallanCompany): string {
  const byId = new Map(items.map((i) => [i.id, i]));
  const theirState = (o.party_state_code || (o.party_gstin ?? '').slice(0, 2)).trim();
  const inter = !!theirState && !!company.stateCode && theirState !== company.stateCode;
  let totalValue = 0;
  let totalTax = 0;
  const rows = (o.lines ?? []).filter((l) => l.item_id && num(l.qty) > 0).map((l, i) => {
    const it = byId.get(l.item_id);
    const value = round2(num(l.qty) * num(l.rate));
    const rate = num(l.tax_rate ?? it?.tax_rate);
    const tax = round2((value * rate) / 100);
    totalValue += value;
    totalTax += tax;
    const due = returnDeadline(o.date, l.goods_kind, o.extended_until);
    return `<tr><td>${i + 1}</td><td>${esc(it?.name ?? 'Item')}${l.batch_no ? ` · batch ${esc(l.batch_no)}` : ''}<div style="font-size:12px;color:#555">${esc(l.goods_kind === 'capital_goods' ? 'Capital goods' : l.goods_kind === 'mould_tool' ? 'Mould / die / jig / tool' : 'Inputs')}${due ? ` · return by ${esc(formatDate(due))}` : ''}</div></td>` +
      `<td>${esc(l.hsn ?? it?.hsn ?? '')}</td><td class="n">${esc(num(l.qty))} ${esc(l.unit || it?.unit || '')}</td>` +
      `<td class="n">${esc(formatMoney(value))}</td><td class="n">${esc(rate)}%</td><td class="n">${esc(formatMoney(tax))}</td></tr>`;
  }).join('');
  const section = (copy: string) => `<section class="c">
  <div class="head"><div><h1>${esc(company.name || 'Your business')}</h1>${company.address ? `<div>${esc(company.address)}</div>` : ''}${company.gstin ? `<div>GSTIN: ${esc(company.gstin)}</div>` : ''}</div>
  <div style="text-align:right"><div><strong>${esc(copy)}</strong></div><div>Challan no.: <strong>${esc(o.number)}</strong></div><div>Date: <strong>${esc(formatDate(o.date))}</strong></div></div></div>
  <div class="title">Delivery challan: goods sent for job work</div>
  <div class="grid"><div><strong>Consignee (job worker)</strong><br>${esc(o.party_name)}${o.party_gstin ? `<br>GSTIN: ${esc(o.party_gstin)}` : ''}${theirState ? `<br>State code: ${esc(theirState)}` : ''}</div>
  <div>${o.process ? `<strong>Nature of job work:</strong> ${esc(o.process)}<br>` : ''}${inter ? `<strong>Place of supply:</strong> ${esc(theirState)} (inter-State)<br>` : ''}${o.eway_bill_no ? `<strong>e-Way bill:</strong> ${esc(o.eway_bill_no)}` : ''}</div></div>
  <table><thead><tr><th>#</th><th>Description</th><th>HSN</th><th class="n">Quantity</th><th class="n">Taxable value (₹)</th><th class="n">Rate</th><th class="n">${inter ? 'IGST' : 'CGST + SGST'} (₹)</th></tr></thead>
  <tbody>${rows}<tr class="total"><td></td><td>Total</td><td></td><td></td><td class="n">${esc(formatMoney(round2(totalValue)))}</td><td></td><td class="n">${esc(formatMoney(round2(totalTax)))}</td></tr></tbody></table>
  <div class="note">Goods sent for job work under Section 143 of the CGST Act and Rule 55: not a supply; no tax is charged on this challan (tax shown for information). Inputs are to be returned within one year and capital goods within three years of this date. ${o.narration ? esc(o.narration) : ''}</div>
  <div class="sign">For ${esc(company.name || 'Your business')}: Authorised signatory</div>
</section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.number)}</title><style>${PRINT_FONT_FACE}${CSS}</style></head>
<body>${COPIES.map(section).join('\n')}</body></html>`;
}
