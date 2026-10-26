import type { Retainer, RetainerReportRow } from '../../lib/retainers';
import { esc } from '../../lib/voucher-print';
import { formatCurrency } from '../../lib/utils';

const CSS = `body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;margin:0;padding:28px}
.r{max-width:820px;margin:0 auto}h1{font-size:18px;margin:0}h2{font-size:15px;margin:12px 0 4px}.sub{font-size:12px;color:#444;white-space:pre-line}
table{width:100%;border-collapse:collapse;font-size:12px;margin-top:12px}th,td{padding:5px 8px;border-bottom:1px solid #ccc;text-align:left}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}.note{font-size:10px;color:#666;margin-top:14px}@media print{body{padding:0}}`;

/** Statement-style retainer report as a script-free print document (the voucher-print path). */
export function retainerReportHtml(r: Retainer, rows: readonly RetainerReportRow[], company: { name: string; address?: string; gstin?: string }): string {
  const sub = [company.address, company.gstin ? `GSTIN: ${company.gstin}` : ''].filter(Boolean).join('\n');
  const body = rows.map((x) => `<tr><td>${esc(x.label)}</td><td>${esc(x.fee_invoice || '—')}</td><td class="n">${x.allowance_h}</td><td class="n">${x.used_h}</td><td class="n">${x.remaining_h}</td><td class="n">${x.rolled_h}</td><td class="n">${x.forfeited_h}</td><td class="n">${x.overage_h}</td><td class="n">${esc(formatCurrency(x.overage_invoiced))}</td><td>${esc(x.state)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Retainer report</title><style>${CSS}</style></head><body><div class="r">
<h1>${esc(company.name || 'Your business')}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
<h2>Retainer statement — ${esc(r.client_name ?? '')}</h2>
<div class="sub">${esc(`${r.hours_per_period} h per ${r.period} · fee ${formatCurrency(r.fee)} · from ${r.start}${r.rollover_cap ? ` · roll over up to ${r.rollover_cap} h` : ''}`)}</div>
<table><thead><tr><th>Period</th><th>Fee invoice</th><th class="n">Allowance (h)</th><th class="n">Used (h)</th><th class="n">Remaining (h)</th><th class="n">Rolled over (h)</th><th class="n">Forfeited (h)</th><th class="n">Overage (h)</th><th class="n">Overage invoiced</th><th>Status</th></tr></thead><tbody>${body}</tbody></table>
<p class="note">Hours are billed hours after the billing step. GST on the fee invoice follows its own issue date; time of supply for periodic services is a statutory point. Working paper — verify with your CA.</p>
</div></body></html>`;
}

