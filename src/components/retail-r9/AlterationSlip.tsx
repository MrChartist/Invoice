/**
 * RT-C3 alteration slip: an 80 mm (fits A6) script-free print with the token, the customer copy and the shop copy, and
 * an on-screen preview of the same text. Printed from its own window like the delivery run sheet.
 */
import { Printer } from 'lucide-react';
import type { AlterationJob } from '../../types/retail-r9';
import { rtcT } from '../../i18n/areas/retail-r9c';
import { formatCurrency, formatDate } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** The lines of one copy (shared by the print and the preview). */
function slipLines(job: AlterationJob): [string, string][] {
  return [
    [rtcT('customer'), [job.customer, job.phone].filter(Boolean).join(' · ')],
    [rtcT('garment'), job.garment],
    ...(job.notes ? [[rtcT('notes'), job.notes] as [string, string]] : []),
    [rtcT('due'), formatDate(job.due)],
    [rtcT('charge').replace(/ \(.*\)/, ''), job.charge > 0 ? formatCurrency(job.charge) : rtcT('free')],
  ];
}

const token = (job: AlterationJob) => job.number.split('/').pop() ?? job.number;

/** The printable slip: customer copy, a cut line, the shop copy (with the tailor). */
export function slipHtml(job: AlterationJob, shop: string): string {
  const copy = (title: string, extra: [string, string][]) =>
    `<section><h1>${esc(shop)}</h1><h2>${esc(title)} · ${esc(rtcT('token'))} ${esc(token(job))}</h2><p class="n">${esc(job.number)} · ${esc(formatDate(job.date))}</p><table>${[...slipLines(job), ...extra].map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(job.number)}</title><style>@page{size:80mm auto;margin:3mm}body{font:12px system-ui,sans-serif;color:black;margin:0;width:74mm}h1{font-size:14px;margin:0}h2{font-size:16px;margin:4px 0}p{margin:2px 0}.n{font-family:monospace}table{width:100%;border-collapse:collapse}th{text-align:left;font-weight:600;padding:1px 4px 1px 0;vertical-align:top;width:35%}td{padding:1px 0}.cut{border-top:1px dashed black;margin:8px 0}</style></head><body>${copy(rtcT('customerCopy'), [])}<p>${esc(rtcT('slipNote'))}</p><div class="cut"></div>${copy(rtcT('shopCopy'), job.tailor_name ? [[rtcT('tailor'), job.tailor_name]] : [])}</body></html>`;
}

export function printSlip(job: AlterationJob, shop: string): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(slipHtml(job, shop));
  w.document.close();
  w.print();
}

/** On-screen slip with a Print button. */
export default function AlterationSlip({ job, shop }: { job: AlterationJob; shop: string }) {
  return (
    <div className={surface.panelDashed} data-alt-slip={job.number} style={{ maxWidth: 340 }}>
      <strong>{rtcT('token')} {token(job)}</strong> · <span className={surface.mono}>{job.number}</span>
      <table className={surface.table}><tbody>{slipLines(job).map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => printSlip(job, shop)} data-alt-print><Printer size={14} aria-hidden="true" /> {rtcT('print')}</button>
    </div>
  );
}
