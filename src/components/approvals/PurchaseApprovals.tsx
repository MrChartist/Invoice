/**
 * Approvals tile, purchase side (8.44): bills / expenses and supplier payments a clerk sent for
 * approval, the owner's approve / reject (with a reason), the decision history and the thresholds.
 * Lazy part of ApprovalsPanel.
 */
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useCan } from '../../hooks/useCan';
import { approveBill, approvePayment, pendingBillApprovals, pendingPaymentRequests, purchaseApprovalHistory, rejectBill, rejectPayment, savePurchaseApprovalPolicy } from '../../lib/purchase-approvals';
import { readPurchaseApprovalPolicy, type PurchaseApprovalPolicy } from '../../lib/purchase-approval-gate';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import { NumberInput } from '../ui/NumberInput';
import { useT } from '../../i18n';
import { capT } from '../../i18n/areas/capture';
import controls from '../../styles/controls.module.css';
import own from './approvals.module.css';

export default function PurchaseApprovals({ notify }: { notify?: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  useT();
  const { can } = useCan();
  const [tick, setTick] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [policy, setPolicy] = useState<PurchaseApprovalPolicy>(readPurchaseApprovalPolicy);
  void tick;
  const bills = pendingBillApprovals();
  const pays = pendingPaymentRequests();
  const history = purchaseApprovalHistory(8);
  const mayApprove = can('doc.approve');
  const mayConfigure = can('settings.manage');
  if (!mayApprove && !mayConfigure && !bills.length && !pays.length) return null;

  const run = (fn: () => void, ok: string) => {
    try {
      fn();
      notify?.(ok);
    } catch (err) {
      notify?.((err as Error).message, 'error');
    }
    setTick((t) => t + 1);
  };
  const noteBox = (id: string, label: string) => (
    <input className={controls.input} value={notes[id] ?? ''} onChange={(e) => setNotes({ ...notes, [id]: e.target.value })} placeholder={capT('reasonPh')} aria-label={label} />
  );

  return (
    <div className={own.stack} data-purchase-approvals>
      <strong>{capT('apTitle', { n: bills.length + pays.length })}</strong>
      {bills.length + pays.length === 0 && <p className={controls.hint}>{policy.bills || policy.payments ? capT('apEmpty') : capT('apOff')}</p>}
      {(bills.length > 0 || pays.length > 0) && (
        <ul className={own.list}>
          {bills.map((d) => (
            <li key={d.id} className={own.item}>
              <div>
                <strong>{d.kind === 'EXPENSE' ? capT('kindExpense') : capT('kindBill')} {d.bill_number || '-'} · {d.vendor_name || '-'}</strong>
                <span className={controls.hint}>{capT('apLine', { amount: formatCurrency(d.total), by: d.draft.approval?.requested_by || '-', date: formatDate(d.date) })}</span>
              </div>
              {mayApprove && (
                <div className={own.actions}>
                  {noteBox(d.id, capT('reasonFor', { what: d.bill_number || d.vendor_name }))}
                  <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => run(() => approveBill(d.id, notes[d.id]), capT('apApproved'))}><Check size={14} /> {capT('approve')}</button>
                  <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => run(() => rejectBill(d.id, notes[d.id] ?? ''), capT('apRejected'))}><X size={14} /> {capT('reject')}</button>
                </div>
              )}
            </li>
          ))}
          {pays.map((p) => (
            <li key={p.id} className={own.item}>
              <div>
                <strong>{capT('payTo', { vendor: p.vendor_name || '-', no: p.bill_number || '-' })}</strong>
                <span className={controls.hint}>{capT('apLine', { amount: formatCurrency(p.amount), by: p.requested_by || '-', date: formatDate(p.date) })} · {p.method}</span>
              </div>
              {mayApprove && (
                <div className={own.actions}>
                  {noteBox(p.id, capT('reasonFor', { what: p.bill_number || p.vendor_name }))}
                  <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => run(() => approvePayment(p.id, notes[p.id]), capT('apPaid'))}><Check size={14} /> {capT('approve')}</button>
                  <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => run(() => rejectPayment(p.id, notes[p.id] ?? ''), capT('apRejected'))}><X size={14} /> {capT('reject')}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <details className={own.settings}>
          <summary>{capT('apHistory')}</summary>
          <ul className={own.list}>
            {history.map((h) => (
              <li key={h.id} className={own.item}>
                <span>{h.decision === 'approved' ? '✓' : '✗'} {capT(h.doc_type === 'PAYMENT' ? 'hPay' : 'hBill')} {h.doc_number || '-'} · {formatCurrency(h.amount)} · {h.decided_by} · {formatDate(h.decided_at.slice(0, 10))}{h.note ? `: ${h.note}` : ''}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {mayConfigure && (
        <details className={own.settings}>
          <summary>{capT('apSettings')}</summary>
          <label className={controls.check}><input type="checkbox" checked={policy.bills} onChange={(e) => setPolicy({ ...policy, bills: e.target.checked })} /> {capT('apBills')}</label>
          {policy.bills && (
            <label className={controls.field}><span className={controls.label}>{capT('apAbove')}</span>
              <NumberInput className={cn(controls.input, controls.inputNumeric)} value={policy.billAbove} onChange={(v) => setPolicy({ ...policy, billAbove: v })} />
            </label>
          )}
          <label className={controls.check}><input type="checkbox" checked={policy.payments} onChange={(e) => setPolicy({ ...policy, payments: e.target.checked })} /> {capT('apPayments')}</label>
          {policy.payments && (
            <label className={controls.field}><span className={controls.label}>{capT('apAbove')}</span>
              <NumberInput className={cn(controls.input, controls.inputNumeric)} value={policy.paymentAbove} onChange={(v) => setPolicy({ ...policy, paymentAbove: v })} />
            </label>
          )}
          <p className={controls.hint}>{capT('apHint')}</p>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => run(() => savePurchaseApprovalPolicy(policy), capT('apSaved'))}>{capT('apSave')}</button>
        </details>
      )}
    </div>
  );
}
