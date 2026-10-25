import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import type { InvoiceItem, PaymentInstalment } from '../../types/invoice';
import { instalmentStatus } from '../../lib/payment-schedule';
import { normalizeSchedule } from '../../lib/doc-snapshots';
import { depositAmount, presetSchedule, scheduleIssues, type SCHEDULE_PRESETS } from '../../lib/schedule-tools';
import { generateId } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { cn, formatCurrency, todayInput } from '../../lib/utils';
import { round2 } from '../../lib/invoice-calc';
import { NumberInput } from '../ui/NumberInput';
import { useT } from '../../i18n';
import { uxT } from '../../i18n/areas/invoicing-ux';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import ux from './ux.module.css';

const SCHEDULED_DOCS = new Set(['QUOTATION', 'PROFORMA', 'SALES_ORDER', 'INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);

/**
 * 8.100 deposits & payment schedules in the editor: instalments (% or ₹, each with a due date),
 * ready-made splits, live paid / open per instalment, and "Request deposit" — record the deposit as an
 * advance receipt voucher (Rule 50, `advances.ts`) or raise a proforma for it. Loaded lazily.
 */
export function PaymentScheduleCard({ notify }: { notify: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  useT();
  const navigate = useNavigate();
  const s = useInvoiceStore(useShallow((st) => pick(st, ['id', 'doc_type', 'issue_date', 'total', 'amount_paid', 'tds_amount', 'balance_due', 'payment_schedule', 'client', 'currency', 'invoice_number', 'place_of_supply', 'items', 'dirty', 'status', 'patch'])));
  const [deposit, setDeposit] = useState<null | { method: string; date: string }>(null);
  const rows = useMemo(() => s.payment_schedule ?? [], [s.payment_schedule]);
  const received = round2(Math.max(0, Number(s.total) - Number(s.tds_amount || 0) - Math.max(Number(s.balance_due) || 0, 0)));
  const states = useMemo(() => instalmentStatus(rows, Number(s.total) - Number(s.tds_amount || 0), received), [rows, s.total, s.tds_amount, received]);
  if (!SCHEDULED_DOCS.has(s.doc_type)) return null;

  const money = (n: number) => formatCurrency(n, s.currency);
  const set = (next: PaymentInstalment[]) => s.patch({ payment_schedule: next.length ? next : undefined });
  const update = (id: string, patch: Partial<PaymentInstalment>) => set(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const preset = (p: keyof typeof SCHEDULE_PRESETS) => set(presetSchedule(p, s.issue_date || todayInput(), [uxT('psDeposit'), uxT('psBalance'), uxT('psFinal')]));
  const add = () => set([...rows, { id: generateId(), label: rows.length ? '' : uxT('psDeposit'), due_date: s.issue_date || todayInput(), percent: rows.length ? undefined : 50, amount: rows.length ? 0 : undefined }]);
  const issues = scheduleIssues(normalizeSchedule(rows), Number(s.total) || 0);
  const dep = depositAmount(rows, Number(s.total) || 0);
  const stored = s.id ? localDb.invoices.getById(s.id) : undefined;
  const canRequest = !!stored && !s.dirty && dep > 0 && !!s.client?.name?.trim() && (s.currency || 'INR').toUpperCase() === 'INR' && can('payment.record');

  const recordDeposit = async () => {
    if (!deposit || !stored) return;
    try {
      const { saveAdvance } = await import('../../lib/advances');
      const services = (s.items as InvoiceItem[]).some((i) => String(i.type).toLowerCase() === 'service');
      const rate = Math.max(0, ...(s.items as InvoiceItem[]).map((i) => Number(i.tax_rate) || 0));
      const c = s.client;
      const adv = saveAdvance({
        date: deposit.date, method: deposit.method, amount: dep, supply: services ? 'services' : 'goods', tax_rate: rate,
        place_of_supply: s.place_of_supply || c.state_code || '',
        client: { id: c.id, name: c.name, company: c.company, gstin: c.gstin, address: c.address, state_code: c.state_code, email: c.email },
        reference: s.invoice_number, description: uxT('psDepositFor', { number: s.invoice_number }),
      });
      setDeposit(null);
      notify(uxT('psDepositDone', { number: adv.number, amount: money(dep) }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const proforma = () => {
    const st = useInvoiceStore.getState();
    const client = st.client;
    const from = st.invoice_number;
    st.newDraft('PROFORMA');
    const next = useInvoiceStore.getState();
    next.setClient(client);
    const line = { ...next.items[0], name: uxT('psDepositFor', { number: from }), quantity: 1, rate: dep, tax_rate: 0, type: 'service' };
    next.patch({ items: [line], notes: uxT('psProformaNote', { number: from }) });
    next.setGstMode('NONE');
    navigate('/invoice');
    notify(uxT('psProformaDone'), 'info');
  };

  return (
    <section className={surface.card} data-payment-schedule>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}><CalendarClock size={16} /> {uxT('psTitle')}</span>
        <span className={ux.muted}>{rows.length ? uxT('psCount', { n: rows.length }) : uxT('psNone')}</span>
      </div>
      <div className={ux.box}>
        <div className={ux.row} role="group" aria-label={uxT('psPresets')}>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => preset('deposit50')}>{uxT('ps5050')}</button>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => preset('deposit30')}>{uxT('ps3070')}</button>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => preset('thirds')}>{uxT('psThirds')}</button>
          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={add}><Plus size={14} /> {uxT('psAdd')}</button>
          {rows.length > 0 && <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => set([])}>{uxT('psClear')}</button>}
        </div>
        {rows.length > 0 && (
          <table className={ux.table}>
            <thead>
              <tr><th>{uxT('psLabel')}</th><th>{uxT('psDue')}</th><th>{uxT('psBasis')}</th><th className={ux.num}>{uxT('psAmount')}</th><th className={ux.num}>{uxT('psOpen')}</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const st = states[i];
                const pct = r.percent !== undefined;
                return (
                  <tr key={r.id}>
                    <td><input className={cn(controls.input, ux.grow)} value={r.label ?? ''} onChange={(e) => update(r.id, { label: e.target.value })} aria-label={uxT('psLabel')} /></td>
                    <td><input type="date" className={controls.input} value={r.due_date} onChange={(e) => e.target.value && update(r.id, { due_date: e.target.value })} aria-label={uxT('psDue')} /></td>
                    <td>
                      <div className={ux.row}>
                        <div className={controls.segment}>
                          <button type="button" className={pct ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={pct} onClick={() => update(r.id, { percent: r.percent ?? 0, amount: undefined })}>%</button>
                          <button type="button" className={!pct ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={!pct} onClick={() => update(r.id, { amount: st?.amount ?? 0, percent: undefined })}>₹</button>
                        </div>
                        <NumberInput className={cn(controls.input, controls.inputNumeric, ux.narrow)} value={pct ? (r.percent ?? 0) : (r.amount ?? 0)} onChange={(n) => update(r.id, pct ? { percent: n } : { amount: n })} aria-label={uxT('psValue')} />
                      </div>
                    </td>
                    <td className={ux.num}>{money(st?.amount ?? 0)}</td>
                    <td className={ux.num}>{st && st.open <= 0.004 ? <span className={ux.chipGood}>{uxT('psPaid')}</span> : money(st?.open ?? 0)}</td>
                    <td><button type="button" className={controls.btnIcon} onClick={() => set(rows.filter((x) => x.id !== r.id))} aria-label={uxT('psRemove')}><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {issues.includes('pct') && <p className={ux.warn} role="alert">{uxT('psPctOver')}</p>}
        {issues.includes('over') && <p className={ux.warn} role="alert">{uxT('psOver')}</p>}
        {issues.includes('under') && <p className={ux.muted}>{uxT('psUnder')}</p>}
        {dep > 0 && s.doc_type !== 'PROFORMA' && (
          <div className={ux.row}>
            <strong>{uxT('psRequest', { amount: money(dep) })}</strong>
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={!canRequest} onClick={() => setDeposit({ method: 'UPI', date: todayInput() })} title={canRequest ? undefined : uxT('psSaveFirst')}>
              {uxT('psRecord')}
            </button>
            {s.doc_type === 'QUOTATION' || s.doc_type === 'SALES_ORDER' ? (
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={!stored || s.dirty} onClick={proforma}>{uxT('psProforma')}</button>
            ) : null}
          </div>
        )}
        {deposit && (
          <div className={ux.row}>
            <label className={controls.field}>
              <span className={controls.label}>{uxT('psDate')}</span>
              <input type="date" className={controls.input} value={deposit.date} max={todayInput()} onChange={(e) => setDeposit({ ...deposit, date: e.target.value })} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{uxT('psMethod')}</span>
              <select className={controls.select} value={deposit.method} onChange={(e) => setDeposit({ ...deposit, method: e.target.value })}>
                {['UPI', 'Cash', 'Bank Transfer', 'Cheque', 'Card'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={recordDeposit}>{uxT('psSaveVoucher')}</button>
            <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setDeposit(null)}>{uxT('cancel')}</button>
          </div>
        )}
        <p className={ux.muted}>{uxT('psHint')}</p>
      </div>
    </section>
  );
}

export default PaymentScheduleCard;
