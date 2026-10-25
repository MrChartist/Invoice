import { lazy, Suspense, useDeferredValue, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { pick } from '../../store/pick';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { ForexFields } from './ForexFields';
import { TransportFields } from './TransportFields';
import { CostCentreSelect } from '../cost-centres/CostCentreSelect';
import { useCostCentres } from '../cost-centres/useCostCentres';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { STATUS_OPTIONS } from '../../lib/invoice-status';
import { addDaysInput, CURRENCIES, cn } from '../../lib/utils';
import { dueAfterIssueChange } from '../../lib/dates';
import { DOCUMENT_LABELS, type DocumentType, type InvoiceStatus } from '../../types/invoice';
import { useT } from '../../i18n';
import '../../i18n/en-pages'; // page strings (5.4)
import { docLabel, statusLabel } from '../../i18n/labels';
import { khataT } from '../../i18n/areas/khata';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../../pages/InvoiceCreator.module.css';

// WP-9: branch picker, loaded only once a branch exists (single-location users never download it).
const BranchSelect = lazy(() => import('../branches/BranchSelect').then((m) => ({ default: m.BranchSelect })));

const DOC_TYPES = Object.keys(DOCUMENT_LABELS) as DocumentType[];
const DUE_PRESETS = [0, 7, 15, 30, 45];

interface Props {
  editing: boolean;
  /** Bumps after each save so the number checks re-read storage. */
  saveTick: number;
}

/** "1 · Document": type, number (with the GST Rule 46 uniqueness/gap check), dates, currency, status. */
export function DocumentMetaCard({ editing, saveTick }: Props) {
  const { t } = useT();
  const s = useInvoiceStore(
    useShallow((st) => pick(st, ['balance_due', 'branch_id', 'cost_centre_id', 'currency', 'doc_type', 'due_date', 'id', 'invoice_number', 'issue_date', 'patch', 'po_number', 'reverse_charge', 'sender', 'setCurrency', 'setDates', 'setDocType', 'setInvoiceNumber', 'setReverseCharge', 'setStatus', 'status'])),
  );

  const nextNumber = useMemo(
    () => (s.invoice_number ? '' : localDb.invoices.nextNumber(s.issue_date, s.doc_type, s.sender?.invoicePrefix || undefined)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.invoice_number, s.issue_date, s.doc_type, s.sender?.invoicePrefix, s.id],
  );

  // GST Rule 46: live uniqueness check of a hand-typed number (deferred so typing stays snappy).
  const typedNumber = useDeferredValue(s.invoice_number);
  const numberCheck = useMemo(
    () => (typedNumber.trim() ? localDb.invoices.checkNumber(typedNumber, s.id || undefined) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typedNumber, s.id, saveTick],
  );
  const numberTaken = numberCheck && !numberCheck.ok ? numberCheck.clash : undefined;
  const centres = useCostCentres();
  const hasBranches = useMemo(() => {
    try {
      return getTable('branches').length > 0;
    } catch {
      return false;
    }
  }, []);

  return (
    <section className={surface.card}>
      <div className={surface.cardHead}>{t('meta.card')}</div>
      <div className={surface.cardBody}>
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>{t('meta.type')}</span>
            <select className={controls.select} value={s.doc_type} onChange={(e) => s.setDocType(e.target.value as DocumentType)} disabled={editing && Boolean(s.invoice_number)}>
              {DOC_TYPES.map((d) => (
                <option key={d} value={d}>
                  {docLabel(d)}
                </option>
              ))}
            </select>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{t('meta.number')}</span>
            <input
              className={`${controls.input} ${controls.inputMono}`}
              style={{ textTransform: 'none' }}
              value={s.invoice_number}
              onChange={(e) => s.setInvoiceNumber(e.target.value)}
              placeholder={nextNumber || t('meta.auto')}
              aria-invalid={numberTaken ? true : undefined}
              aria-describedby="number-hint"
            />
            <span id="number-hint" aria-live="polite">
              {numberTaken ? (
                <span className={cn(styles.numberHint, styles.numberBad)}>
                  <AlertTriangle size={13} aria-hidden="true" />
                  <span>
                    {t('meta.numberTaken', { number: numberTaken.invoice_number, client: numberTaken.client?.name ? ` (${numberTaken.client.name})` : '' })}
                  </span>
                </span>
              ) : numberCheck?.gap ? (
                <span className={cn(styles.numberHint, styles.numberGap)}>
                  <AlertTriangle size={13} aria-hidden="true" />
                  <span>
                    {t('meta.numberGap', {
                      numbers:
                        numberCheck.gap.missingCount > 3
                          ? t('editor.andMore', { list: numberCheck.gap.missingNumbers.slice(0, 3).join(', '), n: numberCheck.gap.missingCount - 3 })
                          : numberCheck.gap.missingNumbers.slice(0, 3).join(', '),
                    })}
                  </span>
                </span>
              ) : !editing ? (
                <span className={controls.hint}>{t('meta.blankAuto')}</span>
              ) : null}
            </span>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{t('meta.poRef')}</span>
            <input className={controls.input} value={s.po_number ?? ''} onChange={(e) => s.patch({ po_number: e.target.value })} placeholder={t('common.optional')} />
          </label>
        </div>
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>{t('meta.issueDate')}</span>
            <input className={controls.input} type="date" value={s.issue_date} onChange={(e) => s.setDates(e.target.value, dueAfterIssueChange(s.issue_date, s.due_date, e.target.value))} />
          </label>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="due-date">{s.doc_type === 'SALES_ORDER' ? t('meta.deliveryBy') : t('meta.dueDate')}</label>
            <input id="due-date" className={controls.input} type="date" value={s.due_date} min={s.issue_date} onChange={(e) => s.setDates(s.issue_date, e.target.value)} />
            {/* 8.6: an unpaid bill with no credit period nudges for a due date (ageing / reminders use it). */}
            {(s.doc_type === 'INVOICE' || s.doc_type === 'TAX_INVOICE' || s.doc_type === 'BILL_OF_SUPPLY') &&
              s.status !== 'Paid' && s.status !== 'Cancelled' && (Number(s.balance_due) || 0) > 0.004 &&
              (!s.due_date || s.due_date <= s.issue_date) && (
                <span className={controls.hint} role="note" data-due-nudge>{khataT('dueNudge')}</span>
              )}
            <div className={styles.chips}>
              {DUE_PRESETS.map((d) => (
                <button key={d} type="button" aria-label={d === 0 ? t('meta.dueOnReceipt') : t('meta.dueInDays', { n: d })} className={styles.chip} onClick={() => s.setDates(s.issue_date, addDaysInput(d, s.issue_date))}>
                  {d === 0 ? t('meta.now') : t('meta.daysShort', { n: d })}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.pair}>
            <label className={controls.field}>
              <span className={controls.label}>{t('meta.currency')}</span>
              <select className={controls.select} value={s.currency} onChange={(e) => s.setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.symbol} {c.code}
                  </option>
                ))}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{t('meta.status')}</span>
              <select className={controls.select} value={s.status === 'Overdue' ? 'Sent' : s.status} onChange={(e) => s.setStatus(e.target.value as InvoiceStatus)}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o} value={o}>{statusLabel(o)}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <label className={controls.check}>
          <input type="checkbox" checked={s.reverse_charge} onChange={(e) => s.setReverseCharge(e.target.checked)} />
          {t('meta.reverseCharge')}
        </label>
        <CostCentreSelect
          id="doc-cost-centre"
          label={t('meta.costCentre')}
          centres={centres}
          value={s.cost_centre_id}
          onChange={(v) => s.patch({ cost_centre_id: v })}
          hint={t('meta.costCentreHint')}
        />
        {hasBranches && (
          <Suspense fallback={null}>
            <BranchSelect id="doc-branch" value={s.branch_id} onChange={(v) => s.patch({ branch_id: v })} />
          </Suspense>
        )}
        <ForexFields />
        <TransportFields />
      </div>
    </section>
  );
}
