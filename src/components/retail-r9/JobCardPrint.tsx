/** RT-D4 job card / delivery receipt: an 80 mm script-free print from its own window (part of the devices desk chunk). */
import type { ServiceJob } from '../../types/retail-r9';
import { rtdT } from '../../i18n/areas/retail-r9d';
import { formatCurrency } from '../../lib/utils';
import { escHtml as esc } from '../../lib/html-esc';


export function printJobCard(j: ServiceJob, shop: string): void {
  const rows: [string, unknown][] = [
    [rtdT('customer'), `${j.customer} ${j.phone ?? ''}`], [rtdT('model'), `${j.asset.model} ${j.asset.serial ?? j.asset.reg_no ?? ''}`], [rtdT('complaint'), j.complaint],
    [rtdT('accessories'), j.accessories], [rtdT('estimate'), formatCurrency(j.estimate)], [rtdT('due'), j.due], [rtdT('status'), rtdT(`s.${j.status}`)],
  ];
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(j.number)}</title><style>@page{size:80mm auto;margin:3mm}body{font:12px system-ui,sans-serif;color:black;width:74mm}th{text-align:left;vertical-align:top}</style></head><body><h3>${esc(shop)}</h3><h2>${esc(rtdT('print'))} ${esc(j.number)}</h2><p>${esc(j.date)}</p><table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table><p>${esc(rtdT('cardNote'))}</p></body></html>`);
  w.document.close();
  w.print();
}
