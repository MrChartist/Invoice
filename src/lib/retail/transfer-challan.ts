/**
 * Delivery challan for a stock transfer between two places of business under the same GSTIN (R4-B4) — CGST Rule
 * 55(1)(c) "for reasons other than by way of supply" (own use / transfer): consignor and consignee (both the business,
 * with the dispatching and receiving premises), challan number (the STR number, ≤ 16 characters, consecutive per FY)
 * and date, HSN, description, quantity, value (at cost), tax rate shown for information only — no tax is charged on a
 * same-GSTIN movement — and the transporter details; three copies (Rule 55(2)). Pure HTML, every value escaped.
 * Working paper — verify with your CA.
 */
import type { StockTransfer } from '../../types/stock';
import type { StockItem } from '../inventory';
import { num, round2 } from '../invoice-calc';
import { lineFactor } from '../units';
import { esc } from '../voucher-print';
import { formatDate, formatMoney } from '../utils';
import { PRINT_FONT, PRINT_FONT_FACE } from '../print-fonts';

export interface TransferChallanParty {
  name: string;
  gstin?: string;
  stateCode?: string;
}

export interface TransferChallanOptions {
  company: TransferChallanParty;
  from: { name: string; address?: string };
  to: { name: string; address?: string };
  items: readonly StockItem[];
  costOf: (itemId: string) => number;
  /** Transfer request this dispatch answers. */
  requestNumber?: string;
  transport?: { mode?: string; vehicle?: string; transporter?: string; lr?: string; eway?: string };
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
  .sign { display: flex; justify-content: space-between; padding: 36px 14px 10px; font-size: 12px; }
  @media print { body { padding: 0; } }
`;

export interface ChallanRow {
  name: string;
  hsn: string;
  batch?: string;
  serials?: string[];
  qty: number;
  unit: string;
  value: number;
  rate: number;
}

/** The challan rows (base units, value at cost). Pure. */
export function challanRows(t: Pick<StockTransfer, 'lines'>, items: readonly StockItem[], costOf: (itemId: string) => number): ChallanRow[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return (t.lines ?? []).filter((l) => l.item_id && num(l.qty) > 0).map((l) => {
    const it = byId.get(l.item_id);
    const qty = Math.round(num(l.qty) * lineFactor(l) * 1000) / 1000;
    return { name: it?.name ?? 'Item', hsn: it?.hsn ?? '', ...(l.batch_no ? { batch: l.batch_no } : {}), ...(l.serials?.length ? { serials: l.serials } : {}), qty, unit: it?.unit ?? '', value: round2(qty * Math.max(num(costOf(l.item_id)), 0)), rate: num(it?.tax_rate) };
  });
}

export function transferChallanHtml(t: Pick<StockTransfer, 'transfer_number' | 'date' | 'lines' | 'notes'>, o: TransferChallanOptions): string {
  const rows = challanRows(t, o.items, o.costOf);
  const total = round2(rows.reduce((s, r) => s + r.value, 0));
  const body = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}${r.batch ? ` · batch ${esc(r.batch)}` : ''}${r.serials ? `<div style="font-size:12px;color:#555">S/N ${esc(r.serials.join(', '))}</div>` : ''}</td><td>${esc(r.hsn)}</td><td class="n">${esc(r.qty)} ${esc(r.unit)}</td><td class="n">${esc(formatMoney(r.value))}</td><td class="n">${esc(r.rate)}%</td></tr>`).join('');
  const tr = o.transport ?? {};
  const transport = [tr.mode && `Mode: ${tr.mode}`, tr.vehicle && `Vehicle: ${tr.vehicle}`, tr.transporter && `Transporter: ${tr.transporter}`, tr.lr && `LR no.: ${tr.lr}`, tr.eway && `e-Way bill: ${tr.eway}`].filter(Boolean).join(' · ');
  const party = (who: string, p: { name: string; address?: string }) => `<strong>${who}</strong><br>${esc(o.company.name)} — ${esc(p.name)}${p.address ? `<br>${esc(p.address)}` : ''}${o.company.gstin ? `<br>GSTIN: ${esc(o.company.gstin)}` : ''}${o.company.stateCode ? `<br>State code: ${esc(o.company.stateCode)}` : ''}`;
  const section = (copy: string) => `<section class="c">
  <div class="head"><div><h1>${esc(o.company.name || 'Your business')}</h1>${o.company.gstin ? `<div>GSTIN: ${esc(o.company.gstin)}</div>` : ''}</div>
  <div style="text-align:right"><div><strong>${esc(copy)}</strong></div><div>Challan no.: <strong>${esc(t.transfer_number.slice(0, 16))}</strong></div><div>Date: <strong>${esc(formatDate(t.date))}</strong></div>${o.requestNumber ? `<div>Against request: ${esc(o.requestNumber)}</div>` : ''}</div></div>
  <div class="title">Delivery challan — stock transfer (own use, same GSTIN)</div>
  <div class="grid"><div>${party('Consignor (from)', o.from)}</div><div>${party('Consignee (to)', o.to)}</div></div>
  <table><thead><tr><th>#</th><th>Description</th><th>HSN</th><th class="n">Quantity</th><th class="n">Value at cost (₹)</th><th class="n">GST rate</th></tr></thead>
  <tbody>${body}<tr class="total"><td></td><td>Total</td><td></td><td></td><td class="n">${esc(formatMoney(total))}</td><td></td></tr></tbody></table>
  ${transport ? `<div class="note">${esc(transport)}</div>` : ''}
  <div class="note">Goods moved between places of business of the same registered person (Rule 55(1)(c) CGST Rules) — not a supply; no tax is charged on this challan (rates shown for information). Value at cost. ${t.notes ? esc(t.notes) : ''} Working paper — verify with your CA.</div>
  <div class="sign"><span>Received in good condition</span><span>For ${esc(o.company.name || 'Your business')} — Authorised signatory</span></div>
</section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.transfer_number)}</title><style>${PRINT_FONT_FACE}${CSS}</style></head>
<body>${COPIES.map(section).join('\n')}</body></html>`;
}
