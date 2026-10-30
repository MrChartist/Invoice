import { useMemo, useState } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import { AGING_BUCKETS, type ReceivablesReport } from '../../lib/receivables';
import { cn, formatCurrency } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { BulkCollectDialog } from './BulkCollectDialog';
import { useT } from '../../i18n';
import { uxT } from '../../i18n/areas/invoicing-ux';
import controls from '../../styles/controls.module.css';
import ux from './ux.module.css';
import { SelectField } from '../ui/SelectField';

/**
 * 8.106 bulk actions on the Receivables ageing list: filter open bills by ageing bucket, tick the ones
 * to act on, then bulk remind (WhatsApp, logged) or bulk write-off (confirmed, audited).
 */
export function ReceivablesBulk({ report, invoices, onClose, onDone }: { report: ReceivablesReport; invoices: InvoiceRecord[]; onClose: () => void; onDone: (m: string) => void }) {
  useT();
  const [bucket, setBucket] = useState<string>('overdue');
  const byId = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);
  const bills = useMemo(
    () => report.parties.flatMap((p) => p.bills.map((b) => ({ ...b, party: p.name }))).filter((b) => byId.has(b.invoiceId) && (bucket === 'all' || (bucket === 'overdue' ? b.daysOverdue > 0 : b.bucket === bucket))),
    [report, byId, bucket],
  );
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(bills.map((b) => b.invoiceId));
  const [mode, setMode] = useState<'remind' | 'writeoff' | null>(null);
  const selected = bills.filter((b) => chosen.has(b.invoiceId)).map((b) => byId.get(b.invoiceId)!);

  if (mode) return <BulkCollectDialog mode={mode} invoices={selected} onClose={() => setMode(null)} onDone={(m) => { onDone(m); onClose(); }} />;

  return (
    <Modal
      open
      onClose={onClose}
      title={uxT('bkTitle')}
      size="lg"
      footer={
        <>
          <button type="button" className={controls.btnOutline} disabled={!selected.length} onClick={() => setMode('remind')}>{uxT('bkRemind')}</button>
          <button type="button" className={controls.btnDanger} disabled={!selected.length} onClick={() => setMode('writeoff')}>{uxT('bkWriteOff')}</button>
        </>
      }
    >
      <div className={ux.sheet} data-receivables-bulk>
        <label className={controls.field}>
          <span className={controls.label}>{uxT('bkBucket')}</span>
          <SelectField className={controls.select} value={bucket} onChange={(e) => { setBucket(e.target.value); setPicked(null); }}>
            <option value="overdue">{uxT('bkOverdue')}</option>
            <option value="all">{uxT('bkAll')}</option>
            {AGING_BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
          </SelectField>
        </label>
        <table className={ux.table}>
          <thead><tr><th /><th>{uxT('bkBill')}</th><th>{uxT('bkParty')}</th><th className={ux.num}>{uxT('bkDays')}</th><th className={ux.num}>{uxT('bkOpen')}</th></tr></thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.invoiceId}>
                <td><input type="checkbox" checked={chosen.has(b.invoiceId)} aria-label={b.number} onChange={() => { const n = new Set(chosen); if (n.has(b.invoiceId)) n.delete(b.invoiceId); else n.add(b.invoiceId); setPicked(n); }} /></td>
                <td>{b.number}</td>
                <td>{b.party}</td>
                <td className={ux.num}>{b.daysOverdue}</td>
                <td className={cn(ux.num)}>{formatCurrency(b.outstanding, 'INR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!bills.length && <p className={ux.muted}>{uxT('bkNothing')}</p>}
      </div>
    </Modal>
  );
}

export default ReceivablesBulk;
