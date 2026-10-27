/**
 * AG-A3 hook loaded by `gst-guards.ts` (one dynamic import, agri companies only): the soft "rate differs from the
 * class (AGn)" notice on lines that carry an agri class. C's pre-packaged 25 kg rule plugs into this same check.
 * Working paper — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import { caOfClass, classRate } from './ag-tax';

export function agExceptions(inv: InvoiceRecord): { code: 'AG_CLASS_RATE'; vars: Record<string, string | number> }[] {
  const out: { code: 'AG_CLASS_RATE'; vars: Record<string, string | number> }[] = [];
  for (const l of inv.items ?? []) {
    const c = l?.ag_class ? classRate(l.ag_class, inv.issue_date) : null;
    if (c && (Number(l.tax_rate) || 0) !== c.rate) out.push({ code: 'AG_CLASS_RATE', vars: { name: l.name, rate: Number(l.tax_rate) || 0, want: c.rate, ca: caOfClass(l.ag_class!) } });
  }
  return out;
}
