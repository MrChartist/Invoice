import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, HandCoins, Pencil, Plus, Printer, Trash2, Undo2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { EmptyState } from '../ui/EmptyState';
import {
  AdvanceError,
  advanceRows,
  advanceVoucherHtml,
  advancesCsv,
  deleteAdvance,
  deleteRefund,
  loadAdvances,
  refundAdvance,
  refundVoucherHtml,
  samePartyAs,
  type AdvanceRow,
} from '../../lib/advances';
import { advanceMovements } from '../../lib/advance-tax';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import type { AdvanceRecord, AdvanceRefund } from '../../types/advances';
import { downloadTextFile } from '../receivables/exportUtils';
import { AdvanceFormModal } from './AdvanceFormModal';
import { ApplyAdvancePanel } from './ApplyAdvancePanel';
import { openPrintable } from './print';
import surface from '../../styles/surface.module.css';
import { BankAccountSelect } from '../bank/BankAccountSelect';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { rcvT, refLabel } from '../../i18n/areas/receivables';
import { methodLabel } from '../../i18n/labels';
import { areaNodes } from '../../i18n/areas/nodes';
import styles from './advances.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

export interface AdvancesTabProps {
  /** Optional party filter (client id or "name:<lowercased>"), as the statements tab uses. */
  partyKey?: string;
  notify: (message: string, tone?: 'success' | 'error') => void;
  /** Called after any change so the page can refresh its own figures. */
  onChanged: () => void;
}

const money = (n: number) => formatCurrency(n, 'INR');
const METHODS = ['Bank transfer', 'UPI', 'Cash', 'Cheque', 'Other'];

/** Advance receipts register (5.3): record, print, apply to invoices, refund. */
export default function AdvancesTab({ partyKey = '', notify, onChanged }: AdvancesTabProps) {
  useT(); // re-render on a language switch (5.4)
  const [version, setVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => ({ advances: loadAdvances(), payments: localDb.payments.getAll(), invoices: localDb.invoices.getAll() }), [version]);
  const [showAll, setShowAll] = useState(false);
  const party = partyKey.startsWith('name:') ? { name: partyKey.slice(5) } : partyKey ? { id: partyKey } : null;
  const rows = useMemo(() => {
    const all = advanceRows(data.advances, data.payments, data.invoices);
    return all.filter((r) => (!party || samePartyAs(r.advance.client, party.id ? { id: party.id } : { name: party.name })) && (showAll || r.balance.open > 0.004 || r.advance.date >= daysAgo(90)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, partyKey, showAll]);
  const totals = useMemo(() => rows.reduce((t, r) => ({ amount: t.amount + r.balance.amount, open: t.open + r.balance.open }), { amount: 0, open: 0 }), [rows]);

  const [editing, setEditing] = useState<AdvanceRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [applying, setApplying] = useState<AdvanceRecord | null>(null);
  const [refunding, setRefunding] = useState<AdvanceRow | null>(null);

  // Local roles (6.21): a viewer sees and prints, but cannot record, apply or refund.
  const canEdit = can('payment.record');

  const changed = (message?: string) => {
    setVersion((v) => v + 1);
    onChanged();
    if (message) notify(message);
  };

  const remove = (a: AdvanceRecord) => {
    if (!window.confirm(rcvT('confirmDelete', { number: a.number }))) return;
    try {
      deleteAdvance(a.id);
      changed(rcvT('deleted', { number: a.number }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const removeRefund = (a: AdvanceRecord, r: AdvanceRefund) => {
    if (!window.confirm(rcvT('confirmRemoveRefund', { number: r.number }))) return;
    try {
      deleteRefund(a.id, r.id);
      changed(rcvT('refundRemoved', { number: r.number }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const printRefund = (a: AdvanceRecord, r: AdvanceRefund) => {
    const m = advanceMovements([a], data.payments, data.invoices).find((x) => x.kind === 'refunded' && x.sourceId === r.id);
    openPrintable(refundVoucherHtml(a, r, m ?? undefined), r.number);
  };

  return (
    <div className={surface.card}>
      <div className={surface.cardHead}>
        <div className={styles.toolbar} style={{ width: '100%' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>{rcvT('advTitle')}</h2>
          <div className={styles.toolbarActions}>
            <label className={controls.check}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> {rcvT('showSettled')}
            </label>
            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} disabled={!rows.length}
              onClick={() => downloadTextFile(`Advances_${todayInput()}.csv`, advancesCsv(rows))}>
              <Download size={14} aria-hidden="true" /> CSV
            </button>
            {canEdit && (
              <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Plus size={14} aria-hidden="true" /> {rcvT('recordAdvance')}
              </button>
            )}
          </div>
        </div>
      </div>
      <p className={styles.note}>
        {areaNodes(rcvT('advNote'), { amount: <strong>{money(totals.open)}</strong> })}
        {' '}<Link to="/gst-reports?tab=at">{rcvT('advTable11')}</Link>
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={HandCoins} title={rcvT('noAdvances')} text={rcvT('noAdvancesText')} />
      ) : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <caption className={surface.srOnly}>{rcvT('advCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{rcvT('voucher')}</th>
                <th scope="col">{rcvT('client')}</th>
                <th scope="col" className={styles.numeric}>{rcvT('received')}</th>
                <th scope="col" className={styles.numeric}>{rcvT('gst')}</th>
                <th scope="col" className={styles.numeric}>{rcvT('adjRefunded')}</th>
                <th scope="col" className={styles.numeric}>{rcvT('unadjusted')}</th>
                <th scope="col"><span className={surface.srOnly}>{rcvT('actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const a = r.advance;
                const b = r.balance;
                const tax = a.tax.igst + a.tax.cgst + a.tax.sgst;
                const frozen = !canEdit || b.adjusted > 0 || b.refunded > 0;
                const movable = canEdit && b.open > 0.004;
                return (
                  <Fragment key={a.id}>
                    <tr>
                      <td>
                        <strong className={surface.mono}>{a.number}</strong>
                        <span className={styles.sub}>{formatDate(a.date)} · {methodLabel(a.method)}{a.reference ? ` · ${a.reference}` : ''}</span>
                      </td>
                      <td>
                        {a.client.company || a.client.name}
                        <span className={styles.sub}>{a.supply === 'goods' ? rcvT('goods') : rcvT('services')} · {a.tax_rate}% · {rcvT('pos', { code: a.place_of_supply })}</span>
                      </td>
                      <td className={styles.numeric}>{money(a.amount)}</td>
                      <td className={styles.numeric}>{a.tax.applies ? money(tax) : '-'}</td>
                      <td className={styles.numeric}>{b.adjusted + b.refunded > 0 ? money(b.adjusted + b.refunded) : '-'}</td>
                      <td className={`${styles.numeric} ${b.open > 0.004 ? styles.open : ''}`}>{money(b.open)}</td>
                      <td>
                        <div className={styles.actions}>
                          <button type="button" className={controls.btnIcon} title={rcvT('printVoucher')} aria-label={rcvT('printVoucherOf', { number: a.number })} onClick={() => openPrintable(advanceVoucherHtml(a), a.number)}>
                            <Printer size={15} />
                          </button>
                          {movable && (
                            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} aria-label={rcvT('applyOf', { number: a.number })} onClick={() => setApplying(a)}>
                              {rcvT('apply')}
                            </button>
                          )}
                          {movable && (
                            <button type="button" className={controls.btnIcon} title={rcvT('refund')} aria-label={rcvT('refundOf', { number: a.number })} onClick={() => setRefunding(r)}>
                              <Undo2 size={15} />
                            </button>
                          )}
                          {!frozen && (
                            <button type="button" className={controls.btnIcon} title={rcvT('edit')} aria-label={rcvT('editOf', { number: a.number })} onClick={() => { setEditing(a); setFormOpen(true); }}>
                              <Pencil size={15} />
                            </button>
                          )}
                          {!frozen && (
                            <button type="button" className={controls.btnDanger} title={rcvT('delete')} aria-label={rcvT('deleteOf', { number: a.number })} onClick={() => remove(a)}>
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {(r.adjustments.length > 0 || (a.refunds ?? []).length > 0) && (
                      <tr>
                        <td colSpan={7}>
                          {r.adjustments.map(({ payment, invoiceNumber }) => (
                            <span key={payment.id} className={styles.sub}>
                              {areaNodes(rcvT('adjustedAgainst', { date: formatDate(payment.date), amount: money(payment.amount) }), {
                                link: <Link to={`/invoice/${payment.invoice_id}`}>{invoiceNumber || rcvT('invoiceLower')}</Link>,
                              })}
                            </span>
                          ))}
                          {(a.refunds ?? []).map((rf) => (
                            <span key={rf.id} className={styles.sub}>
                              {rcvT('refundedLine', { date: formatDate(rf.date), amount: money(rf.amount), number: rf.number })}{' '}
                              <button type="button" className={controls.btnGhost} onClick={() => printRefund(a, rf)}>{rcvT('printRefund')}</button>
                              {canEdit && <button type="button" className={controls.btnGhost} onClick={() => removeRefund(a, rf)}>{rcvT('remove')}</button>}
                            </span>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AdvanceFormModal open={formOpen} advance={editing} onClose={() => setFormOpen(false)}
        onSaved={(a, isNew) => changed(rcvT(isNew ? 'recorded' : 'updated', { number: a.number }))} />

      {applying && (
        <Modal open onClose={() => setApplying(null)} size="md" title={rcvT('applyTitle', { number: applying.number })} subtitle={rcvT('applySub', { client: applying.client.company || applying.client.name })}
          footer={<button type="button" className={controls.btnOutline} onClick={() => setApplying(null)}>{rcvT('close')}</button>}>
          <ApplyAdvancePanel advance={applying} version={version} bare onApplied={(msg) => { setApplying(null); changed(msg); }} />
        </Modal>
      )}

      {refunding && <RefundModal row={refunding} onClose={() => setRefunding(null)} onDone={(msg) => { setRefunding(null); changed(msg); }} />}
    </div>
  );
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function RefundModal({ row, onClose, onDone }: { row: AdvanceRow; onClose: () => void; onDone: (message: string) => void }) {
  const a = row.advance;
  const [amount, setAmount] = useState(String(row.balance.open));
  const [date, setDate] = useState(todayInput());
  const [method, setMethod] = useState(METHODS[0]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = refundAdvance(a.id, { amount: Number(amount), date, method, reference, bankAccountId: bankAccountId || undefined });
      onDone(rcvT('refunded', { amount: money(r.amount), number: r.number }));
    } catch (err) {
      setError(err instanceof AdvanceError ? err.message : (err as Error).message);
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={rcvT('refundTitle', { number: a.number })} subtitle={rcvT('refundSub')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{rcvT('cancel')}</button>
          <button type="submit" form="refund-form" className={controls.btnPrimary}>{rcvT('recordRefund')}</button>
        </>
      }>
      <form id="refund-form" onSubmit={submit} noValidate className={styles.form}>
        {error && <p className={controls.error} role="alert">{error}</p>}
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{rcvT('amountRs')}</span>
            <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{rcvT('date')}</span>
            <DateField className={controls.input} value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{rcvT('method')}</span>
            <SelectField className={controls.select} value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
            </SelectField>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{rcvT('optional', { label: refLabel(method) })}</span>
            <input className={controls.input} value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
        </div>
        <BankAccountSelect id="advrf-bank-account" label={rcvT('paidFrom')} method={method} value={bankAccountId} onChange={setBankAccountId} />
        <span className={controls.hint}>{rcvT('refundHint', { amount: money(row.balance.open) })}</span>
      </form>
    </Modal>
  );
}
