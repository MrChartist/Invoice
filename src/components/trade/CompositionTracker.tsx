/** TR-C2 statutory prompt (one lazy chunk per mount, so each host page preloads only what it needs). Working paper — verify with your CA. */
import { useMemo } from 'react';
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-r8c';
import { formatCurrency } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { getIndianFY } from '../../lib/invoice-number';
import { isRevenueDoc } from '../../lib/stats';
import { isNonGstFinancialNote } from '../../lib/financial-note';
import { documentTurnover } from '../../lib/composition-returns';
import { compositionTracker, SPECIAL_CATEGORY_STATES } from '../../lib/trade/tr-statutory';
import type { InvoiceRecord } from '../../types/invoice';
import own from '../distribution/dist.module.css';

export default function CompositionTracker({ invoices, stateCode, today }: { invoices: readonly InvoiceRecord[]; stateCode?: string; today: string }) {
  useT();
  const profile = localDb.settings.activeProfile();
  const fy = getIndianFY(today);
  const turnover = useMemo(() => {
    const from = `${fy.startYear}-04-01`;
    let t = 0;
    for (const r of invoices) {
      const d = String(r.issue_date).slice(0, 10);
      if (d < from || d > today || isNonGstFinancialNote(r)) continue;
      if (isRevenueDoc(r) || (r.doc_type === 'CREDIT_NOTE' && r.status !== 'Draft' && r.status !== 'Cancelled')) t += documentTurnover(r).value;
    }
    return Math.round(t * 100) / 100;
  }, [invoices, today, fy.startYear]);
  if (profile?.gst_scheme !== 'composition') return null;
  const c = compositionTracker(turnover, today, SPECIAL_CATEGORY_STATES.has(stateCode ?? ''));
  return (
    <div className={c.level === 'ok' ? own.muted : `${own.notice}${c.level === 'red' ? ` ${own.danger}` : ''}`} data-composition-tracker={c.level}>
      <strong>{trT('compTitle')}</strong>{' '}
      {trT('compText', { turnover: formatCurrency(turnover), limit: formatCurrency(c.limit), pct: `${Math.round(c.share * 100)}%` })}{' '}
      {c.level === 'amber' && trT('compAmber')}
      {c.level === 'red' && trT('compRed', { n: c.optOutDays })}
    </div>
  );
}
