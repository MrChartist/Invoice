/**
 * Printable A4 packing list (R2-C4): a complete, script-free HTML document (every value escaped, inline
 * styles only) that opens in a plain print window under the app's CSP, like the voucher print.
 * The accent comes from the Design Studio (`accent` hex, sanitised); everything else is ink on white.
 */

import type { PackingList } from '../types/books-r2';
import { contrastText, sanitizeHex } from './design-prefs';
import { boxRange, packageFigures, packingTotals } from './packing';
import { esc } from './voucher-print';
import { formatDate } from './utils';

export interface PackingPrintCompany {
  name: string;
  address?: string;
  gstin?: string;
}

const kg = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const cbm = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** R4-C1: the export fields a packing list shows from its source invoice (read only; no packing-list schema change). */
export function packingExportMeta(inv: { port_of_loading?: string; port_of_discharge?: string; country_of_destination?: string; marks_numbers?: string } | null | undefined): [string, string][] {
  if (!inv) return [];
  const rows: [string, string | undefined][] = [['Port of loading', inv.port_of_loading], ['Port of discharge', inv.port_of_discharge], ['Final destination', inv.country_of_destination], ['Marks & nos.', inv.marks_numbers]];
  return rows.filter((r): r is [string, string] => !!r[1]?.trim());
}

export function packingListHtml(pl: PackingList, company: PackingPrintCompany, accent?: string, extraMeta: readonly [string, string][] = []): string {
  const colour = sanitizeHex(accent) ?? '#1a4d94';
  const byId = new Map(pl.lines.map((l) => [l.line_id, l]));
  const t = packingTotals(pl.packages, pl.lines);
  const pkgRows = pl.packages
    .map((p) => {
      const f = packageFigures(p, pl.lines);
      const contents = p.contents
        .map((c) => {
          const l = byId.get(c.line_id);
          return `<div>${esc(l?.name ?? c.line_id)} — ${esc(qty(c.qty))}${l?.unit ? ` ${esc(l.unit)}` : ''}</div>`;
        })
        .join('');
      const dims = p.length_cm || p.breadth_cm || p.height_cm ? `${esc(p.length_cm)} × ${esc(p.breadth_cm)} × ${esc(p.height_cm)}` : '—';
      return `<tr><td>${esc(boxRange(p))}</td><td>${esc(p.type_name)}${p.count > 1 ? ` × ${esc(p.count)}` : ''}</td><td>${dims}</td><td>${esc(p.marks ?? '')}</td><td>${contents}</td>` +
        `<td class="n">${esc(kg(f.net_kg))}</td><td class="n">${esc(kg(f.gross_kg))}</td><td class="n">${esc(cbm(f.cbm))}</td></tr>`;
    })
    .join('');
  const lineRows = pl.lines
    .map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.hsn ?? '')}</td><td class="n">${esc(qty(l.quantity))} ${esc(l.unit ?? '')}</td><td class="n">${l.net_kg ? esc(kg(l.net_kg * l.quantity * (l.unit_factor ?? 1))) : '—'}</td></tr>`)
    .join('');
  const sub = [company.address, company.gstin ? `GSTIN: ${company.gstin}` : ''].filter(Boolean).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`Packing list ${pl.number}`)}</title>
<style>
  @page { size: 210mm 297mm; margin: 12mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; margin: 0; padding: 24px; font-size: 12px; }
  .sheet { max-width: 780px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 3px solid ${colour}; padding-bottom: 10px; }
  .head h1 { margin: 0; font-size: 18px; }
  .sub { white-space: pre-line; color: #444; }
  .title { color: ${colour}; font-size: 20px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; text-align: right; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin: 12px 0; }
  .meta b { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #bbb; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: ${colour}; color: ${contrastText(colour)}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { font-weight: 700; border-top: 2px solid #222; }
  h2 { font-size: 12px; margin: 16px 0 0; text-transform: uppercase; letter-spacing: 0.06em; color: ${colour}; }
  .sign { margin-top: 36px; display: flex; justify-content: flex-end; }
  .sign div { border-top: 1px solid #222; padding-top: 4px; min-width: 200px; text-align: center; }
  .note { color: #777; font-size: 10px; margin-top: 12px; }
  @media print { body { padding: 0; } }
</style></head>
<body><div class="sheet">
  <div class="head"><div><h1>${esc(company.name || 'Your business')}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
  <div class="title">Packing list<div class="sub">${esc(pl.number)}</div></div></div>
  <div class="meta">
    <div><b>Date</b>${esc(formatDate(pl.date))}</div>
    <div><b>Against</b>${esc(pl.source.number)} (${esc(pl.source.kind === 'challan' ? 'Delivery challan' : 'Invoice')})</div>
    <div><b>Consignee</b>${esc(pl.party || '—')}</div>
    <div><b>Ship to</b>${esc(pl.ship_to || '—')}</div>
    ${extraMeta.map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join('')}
  </div>
  <table><thead><tr><th>Box no.</th><th>Package</th><th>L × B × H (cm)</th><th>Marks &amp; numbers</th><th>Contents (each)</th><th class="n">Net kg</th><th class="n">Gross kg</th><th class="n">CBM</th></tr></thead>
  <tbody>${pkgRows}
  <tr class="total"><td colspan="5">Total: ${esc(t.packages)} package(s)</td><td class="n">${esc(kg(t.net_kg))}</td><td class="n">${esc(kg(t.gross_kg))}</td><td class="n">${esc(cbm(t.cbm))}</td></tr></tbody></table>
  <p class="note">Weights per package are for one package of the row; totals count every package.</p>
  <h2>Goods</h2>
  <table><thead><tr><th>Item</th><th>HSN</th><th class="n">Quantity</th><th class="n">Net kg</th></tr></thead><tbody>${lineRows}</tbody></table>
  ${pl.notes ? `<p>${esc(pl.notes)}</p>` : ''}
  <div class="sign"><div>Authorised signatory</div></div>
</div></body></html>`;
}
