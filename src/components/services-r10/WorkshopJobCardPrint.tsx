/**
 * SV-D1 prints from their own window (script-free, part of the workshop desk chunk): the job card (vehicle / appliance,
 * odometer, fuel, customer voice, inspection, promised time, the terms from `workshop_settings.terms` and the customer's
 * signature line) and the gate pass on delivery.
 */
import type { ServiceJob } from '../../types/retail-r9';
import type { ServiceAsset } from '../../types/services-r10';
import { wsT } from '../../i18n/areas/services-r10d';
import { escHtml as esc } from '../../lib/html-esc';
import { PRINT_FONT, PRINT_FONT_FACE, printWhenReady } from '../../lib/print-fonts';


export function printWorkshop(kind: 'card' | 'gate', j: ServiceJob, a: ServiceAsset | undefined, shop: string, terms = ''): void {
  const rows: [string, unknown][] = kind === 'gate'
    ? [[wsT('asset'), `${a?.reg_no ?? a?.serial ?? ''} ${j.asset.model}`], [wsT('owner_name'), j.customer], [wsT('odoOut'), j.odometer_out], [wsT('bill'), j.invoice_number]]
    : [
      [wsT('asset'), `${a?.reg_no ?? a?.serial ?? ''} ${j.asset.model}`], [wsT('owner_name'), `${j.customer} ${j.phone ?? ''}`], [wsT('odometer'), j.odometer_in], [wsT('fuel'), j.fuel],
      [wsT('complaints'), (j.complaints ?? [j.complaint]).join('; ')], [wsT('checklist'), j.checklist?.join(', ')], [wsT('promised'), j.promised?.replace('T', ' ')], [wsT('site'), j.site],
    ];
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(j.number)}</title><style>${PRINT_FONT_FACE}body{font:12px ${PRINT_FONT};color:black;max-width:180mm}th{text-align:left;vertical-align:top;padding-right:8px}.s{margin-top:40px;border-top:1px solid black;width:60mm}</style></head><body><h3>${esc(shop)}</h3><h2>${esc(wsT(kind === 'gate' ? 'gate' : 'print'))} ${esc(j.number)}</h2><p>${esc(j.date)}</p><table>${rows.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table><p>${esc(kind === 'gate' ? wsT('gateNote') : terms)}</p><p class="s">${esc(wsT('sign'))}</p></body></html>`);
  w.document.close();
  printWhenReady(w);
}
