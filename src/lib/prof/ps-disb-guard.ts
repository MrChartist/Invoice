/**
 * R14 PS-B1 legacy check (GST guards, lazy): invoices issued before the pure-agent fix carry their Rule 33 reimbursements
 * as 0 % lines without the pure-agent key, so GSTR-1 still reports them as nil-rated (Table 8 / HSN). They are never
 * rewritten (Critical Rule 3); this lists them per document so the CA can decide on an amendment (PS3).
 */
import type { InvoiceRecord } from '../../types/invoice';
import { isLegacyPureAgentLine } from './ps-disb';

export function psExceptions(inv: InvoiceRecord): { code: 'PS_PURE_AGENT_OLD'; vars: Record<string, string | number> }[] {
  const old = (inv.items ?? []).filter(isLegacyPureAgentLine);
  return old.length ? [{ code: 'PS_PURE_AGENT_OLD', vars: { n: old.length } }] : [];
}
