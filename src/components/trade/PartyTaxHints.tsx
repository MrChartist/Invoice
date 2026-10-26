/** TR-C2 statutory prompt (one lazy chunk per mount, so each host page preloads only what it needs). Working paper — verify with your CA. */
import { useState } from 'react';
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-r8c';
import { formatCurrency } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { getIndianFY } from '../../lib/invoice-number';
import { isRevenueDoc } from '../../lib/stats';
import { tdsThreshold } from '../../lib/tds-rules';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { customer194qDue, presetOfLabel, tcs1fWarning } from '../../lib/trade/tr-statutory';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';

export default function PartyTaxHints() {
  useT();
  const s = useInvoiceStore((x) => x);
  const client = s.client?.id ? localDb.clients.getById(s.client.id) : undefined;
  const [, bump] = useState(0);
  const preset = s.tcs_enabled ? presetOfLabel(s.tcs_label, s.issue_date) : undefined;
  const values = (s.totals?.lines ?? []).map((l) => l.taxable);
  const warn = tcs1fWarning(preset, values);
  const limit = tdsThreshold('194Q', s.issue_date)?.aggregate ?? 0;
  // Only for a customer marked "deducts 194Q": our FY sales to it so far plus this document.
  const from = `${getIndianFY(s.issue_date).startYear}-04-01`;
  const fySales = client?.deducts_194q
    ? localDb.invoices.getAll().filter((r) => r.client?.id === client.id && r.id !== s.id && isRevenueDoc(r) && r.issue_date >= from && r.issue_date <= s.issue_date).reduce((t, r) => t + (Number(r.taxable_value) || 0), 0) + (Number(s.totals?.taxable_value) || 0)
    : 0;
  if (!client) return null;
  const setFlag = (patch: Partial<typeof client>) => {
    try {
      localDb.clients.upsert({ ...client, ...patch });
      bump((n) => n + 1);
    } catch {
      /* viewers cannot change clients */
    }
  };
  return (
    <div className={own.stack} data-party-tax-hints>
      {s.tcs_enabled && (
        <label className={controls.check}>
          <input type="checkbox" checked={!!client.tcs_declaration} onChange={(e) => setFlag({ tcs_declaration: e.target.checked ? { on: s.issue_date } : undefined })} /> {trT('tcsDecl')}
        </label>
      )}
      {warn && <p className={own.notice} role="note">{trT('tcs1fWarn')}</p>}
      <label className={controls.check}>
        <input type="checkbox" checked={!!client.deducts_194q} onChange={(e) => setFlag({ deducts_194q: e.target.checked || undefined })} /> {trT('deducts194q')}
      </label>
      {client.deducts_194q && customer194qDue(fySales, limit) && <p className={own.notice} role="note">{trT('deducts194qDue', { limit: formatCurrency(limit) })}</p>}
    </div>
  );
}
