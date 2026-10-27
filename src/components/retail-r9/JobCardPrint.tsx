/**
 * RT-D4 job card / delivery receipt: an 80 mm script-free print (customer copy + shop copy), from its own window like
 * the alteration slip. Part of the devices desk chunk.
 */
import type { ServiceJob } from '../../types/retail-r9';
import { rtdT } from '../../i18n/areas/retail-r9d';
import { formatCurrency, formatDate } from '../../lib/utils';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** The rows of the card (shared by both copies). */
export function jobRows(j: ServiceJob): [string, string][] {
  return [
    [rtdT('customer'), [j.customer, j.phone].filter(Boolean).join(' · ')],
    [rtdT('model'), [j.asset.model, j.asset.serial ?? j.asset.reg_no].filter(Boolean).join(' · ')],
    [rtdT('complaint'), j.complaint],
    ...(j.accessories ? [[rtdT('accessories'), j.accessories] as [string, string]] : []),
    ...(j.condition ? [[rtdT('condition'), j.condition] as [string, string]] : []),
    [rtdT('estimate'), formatCurrency(j.estimate)],
    ...(j.due ? [[rtdT('due'), formatDate(j.due)] as [string, string]] : []),
    [rtdT('status'), rtdT(`s.${j.status}`)],
  ];
}

export function printJobCard(j: ServiceJob, shop: string): void {
  const copy = (title: string) => `<section><h1>${esc(shop)}</h1><h2>${esc(title)}</h2><p class="n">${esc(j.number)} · ${esc(formatDate(j.date))}</p><table>${jobRows(j).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></section>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(j.number)}</title><style>@page{size:80mm auto;margin:3mm}body{font:12px system-ui,sans-serif;color:black;margin:0;width:74mm}h1{font-size:14px;margin:0}h2{font-size:15px;margin:4px 0}.n{font-family:monospace}table{width:100%;border-collapse:collapse}th{text-align:left;padding:1px 4px 1px 0;vertical-align:top;width:35%}.cut{border-top:1px dashed black;margin:8px 0}</style></head><body>${copy(rtdT('print'))}<p>${esc(rtdT('cardNote'))}</p><div class="cut"></div>${copy(rtdT('print'))}</body></html>`);
  w.document.close();
  w.print();
}
