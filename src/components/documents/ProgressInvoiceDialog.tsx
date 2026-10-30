import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import type { InvoiceRecord } from '../../types/invoice';
import type { ProgressBasis } from '../../types/sales-r2';
import { createProgressInvoice, progressSummary } from '../../lib/progress-billing';
import { localDb } from '../../lib/localDb';
import { readLinks } from '../../lib/documents';
import { localDayOf } from '../../lib/dates';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { s2T } from '../../i18n/areas/sales-r2';
import controls from '../../styles/controls.module.css';
import styles from './sales-r2.module.css';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

/**
 * R2-B2: raise the next stage invoice of a quotation / sales order — by % of the whole, by an amount
 * (before GST) or by % per line, optionally against a milestone of the plan. Billing beyond 100% needs
 * an explicit tick and a reason. The invoice date is the user's (time of supply — verify with your CA).
 */
export function ProgressInvoiceDialog({ source, onClose, onCreated }: { source: InvoiceRecord; onClose: () => void; onCreated: (rec: InvoiceRecord) => void }) {
  useT(); // re-render on a language switch (5.4)
  const summary = useMemo(() => progressSummary(source, localDb.invoices.getAll(), readLinks()), [source]);
  const open = (source.milestones ?? []).filter((m) => !m.invoice_id || !summary.stages.some((s) => s.id === m.invoice_id));
  const [basis, setBasis] = useState<ProgressBasis>('percent');
  const [value, setValue] = useState('');
  const [milestone, setMilestone] = useState('');
  const [lines, setLines] = useState<Record<string, string>>({});
  const [allowOver, setAllowOver] = useState(false);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(() => {
    const m = open[0]?.expected_date;
    const today = localDayOf(new Date());
    return m && m <= today ? m : today;
  });
  const [error, setError] = useState('');
  const cur = source.currency || 'INR';

  const submit = () => {
    setError('');
    try {
      const linePercents = Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, Number(v) || 0]));
      const rec = createProgressInvoice(source, {
        basis, value: Number(value) || 0, linePercents, ...(milestone ? { milestoneId: milestone } : {}), allowOver, overReason: reason,
      }, date);
      onCreated(rec);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={s2T('p.title')}
      subtitle={s2T('p.subtitle', { number: source.invoice_number })}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{s2T('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={submit} data-progress-create>{s2T('p.create')}</button>
        </>
      }
    >
      <div className={styles.stack}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {open.length > 0 && (
          <label className={controls.field}>
            <span className={controls.label}>{s2T('p.milestone')}</span>
            <SelectField className={controls.select} value={milestone} onChange={(e) => {
              setMilestone(e.target.value);
              const m = open.find((x) => x.id === e.target.value);
              if (m?.expected_date) setDate(m.expected_date);
            }}>
              <option value="">{s2T('p.noMilestone')}</option>
              {open.map((m) => <option key={m.id} value={m.id}>{m.name} : {m.percent}%</option>)}
            </SelectField>
          </label>
        )}
        {!milestone && (
          <>
            <div className={controls.segment} role="radiogroup" aria-label={s2T('p.title')}>
              {([['percent', s2T('p.byPercent')], ['amount', s2T('p.byAmount')], ['lines', s2T('p.byLines')]] as [ProgressBasis, string][]).map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={basis === k} className={basis === k ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setBasis(k)}>{label}</button>
              ))}
            </div>
            {basis !== 'lines' ? (
              <label className={controls.field}>
                <span className={controls.label}>{basis === 'percent' ? s2T('p.percent') : s2T('p.amount')}</span>
                <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} data-progress-value autoFocus />
              </label>
            ) : (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>{s2T('item')}</th><th className={styles.num}>{s2T('qty')}</th><th className={styles.num}>{s2T('p.quoted')}</th><th className={styles.num}>{s2T('p.invoiced')}</th><th className={styles.num}>{s2T('p.percent')}</th></tr>
                  </thead>
                  <tbody>
                    {summary.lines.map((l) => (
                      <tr key={l.line.id}>
                        <td>{l.line.name}</td>
                        <td className={styles.num}>{l.quotedQty} {l.line.unit ?? ''}</td>
                        <td className={styles.num}>{formatCurrency(l.quotedValue, cur)}</td>
                        <td className={styles.num}>{s2T('p.billed', { pct: `${Math.round(l.fraction * 10000) / 100}%` })}</td>
                        <td className={styles.num}>
                          <input className={`${controls.input} ${controls.inputNumeric} ${styles.cellInput}`} inputMode="decimal" value={lines[l.line.id] ?? ''}
                            onChange={(e) => setLines({ ...lines, [l.line.id]: e.target.value.replace(/[^0-9.]/g, '') })} aria-label={`${s2T('p.percent')} ${l.line.name}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <p className={styles.muted}>{s2T('p.complete', { pct: summary.percent })} · {s2T('p.remaining')} {formatCurrency(summary.remaining, cur)}</p>
        <label className={controls.field}>
          <span className={controls.label}>{s2T('p.invoiceDate')}</span>
          <DateField className={controls.input} value={date} onChange={(e) => setDate(e.target.value || localDayOf(new Date()))} />
        </label>
        <label className={controls.check}>
          <input type="checkbox" checked={allowOver} onChange={(e) => setAllowOver(e.target.checked)} /> {s2T('p.allowOver')}
        </label>
        {allowOver && (
          <label className={controls.field}>
            <span className={controls.label}>{s2T('p.overReason')}</span>
            <input className={controls.input} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        )}
        <p className={styles.muted}>{s2T('p.tos')}</p>
      </div>
    </Modal>
  );
}
