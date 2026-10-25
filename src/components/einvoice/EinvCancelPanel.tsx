import { useMemo, useState } from 'react';
import { Download, FileX } from 'lucide-react';
import type { InvoiceRecord } from '../../types/invoice';
import { getEInvoiceMeta, sanitiseFileStem, type EInvoiceMeta } from '../../lib/einvoice';
import {
  EWB_REJECT_HOURS,
  cancelPlan,
  cancelState,
  ewbCancelJson,
  irnCancelJson,
  recordCancel,
  type CancelDeadline,
  type CancelReason,
} from '../../lib/einvoice-cancel';
import { downloadText } from '../../lib/download';
import { useT } from '../../i18n';
import { ggT } from '../../i18n/areas/gst-guards';
import controls from '../../styles/controls.module.css';
import styles from '../gst-reports/gst-guards.module.css';

const REASONS: CancelReason[] = ['order_cancelled', 'data_entry', 'duplicate', 'other'];
const REASON_KEY = { order_cancelled: 'rsnOrder', data_entry: 'rsnData', duplicate: 'rsnDup', other: 'rsnOther' } as const;

function left(d: CancelDeadline): string {
  if (d.until === null || d.minutesLeft === null) return ggT('cnlUnknown');
  const at = new Date(d.until).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (!d.open) return ggT('cnlPassed', { at });
  return ggT('cnlLeft', { h: Math.floor(d.minutesLeft / 60), m: d.minutesLeft % 60, at }) + (d.approximate ? ` ${ggT('cnlApprox')}` : '');
}

/**
 * Cancel flow for a document with an IRN / e-Way Bill (8.64): prepares the IRN cancel and e-Way cancel JSON
 * together, shows the 24-hour deadlines and what to do after them, and tracks the status on `einvoice_meta`.
 */
export function EinvCancelPanel({ invoice, afterCancel }: { invoice: InvoiceRecord; afterCancel?: boolean }) {
  useT();
  const [meta, setMeta] = useState<EInvoiceMeta | undefined>(() => getEInvoiceMeta(invoice.id));
  const [now] = useState(() => new Date());
  const [reason, setReason] = useState<CancelReason>(meta?.irn_cancel?.reason ?? meta?.ewb_cancel?.reason ?? 'order_cancelled');
  const [remark, setRemark] = useState(meta?.irn_cancel?.remark ?? meta?.ewb_cancel?.remark ?? '');
  const [error, setError] = useState('');
  const plan = useMemo(() => cancelPlan(meta, now), [meta, now]);
  if (!meta || (!plan.hasIrn && !plan.hasEwb)) return null;
  const stem = sanitiseFileStem(invoice.invoice_number || invoice.id);

  const apply = (steps: ('irn' | 'ewb')[], status: 'prepared' | 'done') => {
    try {
      let m = meta;
      for (const w of steps) m = recordCancel(m, w, { status, reason, remark });
      setMeta(m);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = (which: 'irn' | 'ewb', status: 'prepared' | 'done') => apply([which], status);
  const prepare = () => {
    const steps: ('irn' | 'ewb')[] = [];
    // e-Way first: an active e-Way Bill generated with the IRN blocks the IRN cancellation.
    if (plan.hasEwb && meta.eway_no) {
      downloadText(`ewb_cancel_${stem}.json`, ewbCancelJson(meta.eway_no, reason, remark), 'application/json');
      if (meta.ewb_cancel?.status !== 'done') steps.push('ewb');
    }
    if (plan.hasIrn && meta.irn) {
      downloadText(`irn_cancel_${stem}.json`, irnCancelJson(meta.irn, reason, remark), 'application/json');
      if (meta.irn_cancel?.status !== 'done') steps.push('irn');
    }
    if (steps.length) apply(steps, 'prepared');
  };
  const state = cancelState(meta);

  const step = (which: 'irn' | 'ewb') => {
    const c = which === 'irn' ? meta.irn_cancel : meta.ewb_cancel;
    const d = which === 'irn' ? plan.irn : plan.ewb;
    return (
      <li>
        <strong>{which === 'irn' ? 'IRN' : `e-Way Bill ${meta.eway_no}`}</strong> — {left(d)}{' '}
        <span className={c?.status === 'done' ? styles.pillOk : c ? styles.pillWarn : styles.pill}>
          {c?.status === 'done' ? ggT('stDone', { date: c.done_on ?? '' }) : c ? ggT('stPrepared') : ggT('stOpen')}
        </span>{' '}
        <label className={controls.check} style={{ display: 'inline-flex' }}>
          <input type="checkbox" checked={c?.status === 'done'} onChange={(e) => save(which, e.target.checked ? 'done' : 'prepared')} />
          <span>{ggT('cnlDoneOnPortal')}</span>
        </label>
      </li>
    );
  };

  return (
    <div className={styles.section} data-einv-cancel>
      <h3 className={styles.head}><FileX size={15} aria-hidden="true" /> {ggT('cnlTitle')}
        {state !== 'none' && <span className={state === 'done' ? styles.pillOk : styles.pillWarn}>{state === 'done' ? ggT('cnlAllDone') : ggT('cnlPending')}</span>}
      </h3>
      {afterCancel && <p className={styles.noteInfo} role="status">{ggT('cnlBooksDone')}</p>}
      <p className={controls.hint} style={{ margin: 0 }}>{ggT('cnlIntro')}{plan.ewbFirst ? ` ${ggT('cnlOrder')}` : ''}</p>
      <ul className={styles.list}>
        {plan.hasEwb && step('ewb')}
        {plan.hasIrn && step('irn')}
      </ul>
      {plan.creditNoteOnly ? (
        <p className={styles.noteBad}>{plan.hasIrn ? ggT('cnlAfterIrn') : ggT('cnlAfterEwb', { h: EWB_REJECT_HOURS })}</p>
      ) : (
        <>
          {plan.hasIrn && plan.hasEwb && plan.irn.open && !plan.ewb.open && plan.ewb.until !== null && <p className={styles.note}>{ggT('cnlEwbGone', { h: EWB_REJECT_HOURS })}</p>}
          <div className={styles.row}>
            <label className={controls.field} style={{ flex: '1 1 12rem' }}>
              <span className={controls.label}>{ggT('cnlReason')}</span>
              <select className={controls.select} value={reason} onChange={(e) => setReason(e.target.value as CancelReason)}>
                {REASONS.map((r) => <option key={r} value={r}>{ggT(REASON_KEY[r])}</option>)}
              </select>
            </label>
            <label className={controls.field} style={{ flex: '2 1 14rem' }}>
              <span className={controls.label}>{ggT('cnlRemark')}</span>
              <input className={controls.input} maxLength={50} value={remark} onChange={(e) => setRemark(e.target.value)} />
            </label>
          </div>
          <div className={styles.row}>
            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={prepare}>
              <Download size={14} aria-hidden="true" /> {plan.hasIrn && plan.hasEwb ? ggT('cnlPrepareBoth') : ggT('cnlPrepare')}
            </button>
          </div>
        </>
      )}
      <p className={controls.hint} style={{ margin: 0 }}>{ggT('cnlFoot')}</p>
      {error && <p className={controls.error} role="alert">{error}</p>}
    </div>
  );
}

export default EinvCancelPanel;
