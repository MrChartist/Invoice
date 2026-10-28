/**
 * R16-D3 (CN-A leftover): GST-guard class-rate notice for works-contract invoices — a line whose typed rate differs from
 * its class (`boq_terms.cn.lines[id].cls`, else the catalogue row's `cn_class`) on the document date. Soft notice; the
 * typed rate is kept. Lazy: loaded by `gst-guards.ts` for construction companies only. Verify with your CA (CN1).
 */
import type { InvoiceRecord } from '../../types/invoice';
import { classRate, rateDiffers } from './cn-tax';

export function cnExceptions(inv: InvoiceRecord): { code: 'CN_CLASS_RATE'; vars: Record<string, string | number> }[] {
  const lines = inv.boq_terms?.cn?.lines ?? {};
  const out: { code: 'CN_CLASS_RATE'; vars: Record<string, string | number> }[] = [];
  for (const it of inv.items ?? []) {
    const cls = lines[it?.id]?.cls ?? it?.cn_class;
    const rate = Number(it?.tax_rate) || 0;
    if (rateDiffers(rate, cls, inv.issue_date)) out.push({ code: 'CN_CLASS_RATE', vars: { name: it.name, rate, want: classRate(cls, inv.issue_date)?.rate ?? '' } });
  }
  return out;
}
