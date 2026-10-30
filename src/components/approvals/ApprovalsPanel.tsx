import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ShieldCheck, X } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import { useCan } from '../../hooks/useCan';
import { approveDocument, pendingApprovals, readApprovalPolicy, rejectDocument, saveApprovalPolicy, type ApprovalPolicy } from '../../lib/approvals';
import { localDb } from '../../lib/localDb';
import { DOCUMENT_LABELS } from '../../types/invoice';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import { useT } from '../../i18n';
import { approvalsT } from '../../i18n/areas/extras';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import own from './approvals.module.css';
import { SelectField } from '../ui/SelectField';

// 8.44: bills, expenses and supplier payments sent for approval — own lazy chunk.
const PurchaseApprovals = lazy(() => import('./PurchaseApprovals'));

/**
 * Maker-checker (WP-9): the owner's approval queue and the policy switch. Shown on the Dashboard
 * (tiles area) to users who may approve or manage settings; clerks see how many of theirs wait.
 */
export function ApprovalsPanel({ notify }: { notify?: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  useT();
  const { can } = useCan();
  const [tick, setTick] = useState(0);
  const [policy, setPolicy] = useState<ApprovalPolicy>(readApprovalPolicy);
  const [notes, setNotes] = useState<Record<string, string>>({});
  void tick;
  const pending = pendingApprovals(localDb.invoices.getAll());
  const mayApprove = can('doc.approve');
  const mayConfigure = can('settings.manage');
  if (!mayApprove && !mayConfigure && pending.length === 0) return null;

  const run = (fn: () => void, ok: string) => {
    try {
      fn();
      notify?.(ok);
    } catch (err) {
      notify?.((err as Error).message, 'error');
    }
    setTick((t) => t + 1);
  };

  return (
    <section className={surface.card} aria-label={approvalsT('title')} data-approvals>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}><ShieldCheck size={16} /> {approvalsT('title')}</span>
        <span className={own.count}>{approvalsT('pendingCount', { n: String(pending.length) })}</span>
      </div>
      <div className={cn(surface.cardBody, own.stack)}>
        {pending.length === 0 ? (
          <p className={controls.hint}>{policy.enabled ? approvalsT('empty') : approvalsT('off')}</p>
        ) : (
          <ul className={own.list}>
            {pending.map((d) => (
              <li key={d.id} className={own.item}>
                <div>
                  <Link to={`/invoice/${d.id}`}><strong>{DOCUMENT_LABELS[d.doc_type]} {d.invoice_number}</strong></Link>
                  <span className={controls.hint}>
                    {approvalsT('line', { party: d.client?.name || '-', amount: formatCurrency(d.total, d.currency), by: d.approval?.requested_by || '-', date: formatDate(d.issue_date) })}
                  </span>
                </div>
                {mayApprove && (
                  <div className={own.actions}>
                    <input
                      className={controls.input}
                      value={notes[d.id] ?? ''}
                      onChange={(e) => setNotes({ ...notes, [d.id]: e.target.value })}
                      placeholder={approvalsT('notePlaceholder')}
                      aria-label={approvalsT('noteLabel', { number: d.invoice_number })}
                    />
                    <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => run(() => approveDocument(d.id, notes[d.id]), approvalsT('approved', { number: d.invoice_number }))}>
                      <Check size={14} /> {approvalsT('approve')}
                    </button>
                    <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => run(() => rejectDocument(d.id, notes[d.id] ?? ''), approvalsT('rejected', { number: d.invoice_number }))}>
                      <X size={14} /> {approvalsT('reject')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <Suspense fallback={null}>
          <PurchaseApprovals notify={notify} />
        </Suspense>

        {mayConfigure && (
          <details className={own.settings}>
            <summary>{approvalsT('settings')}</summary>
            <label className={controls.check}>
              <input type="checkbox" checked={policy.enabled} onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })} />
              {approvalsT('enable')}
            </label>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>{approvalsT('modeLabel')}</span>
                <SelectField className={controls.select} value={policy.mode} onChange={(e) => setPolicy({ ...policy, mode: e.target.value === 'all' ? 'all' : 'above' })}>
                  <option value="above">{approvalsT('modeAbove')}</option>
                  <option value="all">{approvalsT('modeAll')}</option>
                </SelectField>
              </label>
              {policy.mode === 'above' && (
                <label className={controls.field}>
                  <span className={controls.label}>{approvalsT('threshold')}</span>
                  <NumberInput className={cn(controls.input, controls.inputNumeric)} value={policy.threshold} onChange={(v) => setPolicy({ ...policy, threshold: v })} />
                </label>
              )}
            </div>
            <p className={controls.hint}>{approvalsT('hint')}</p>
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => run(() => saveApprovalPolicy(policy), approvalsT('savedPolicy'))}>
              {approvalsT('savePolicy')}
            </button>
          </details>
        )}
      </div>
    </section>
  );
}

/** Banner for a document waiting for (or rejected at) approval — for the editor / preview (lead wires). */
export function ApprovalBanner({ approval }: { approval?: { state: string; note?: string; requested_by?: string } }) {
  useT();
  if (!approval || approval.state === 'approved') return null;
  return (
    <p className={own.banner} role="status">
      {approval.state === 'pending' ? approvalsT('bannerPending', { by: approval.requested_by || '-' }) : approvalsT('bannerRejected', { note: approval.note || '-' })}
    </p>
  );
}
