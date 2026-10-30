import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, CalendarClock, Download, Pencil, Printer, Trash2, Wallet } from 'lucide-react';
import {
  chequeSummary,
  chequesCsv,
  deleteCheque,
  filterCheques,
  loadCheques,
  linkedPaymentMissing,
  nextStatuses,
  type ChequeFilter,
} from '../lib/cheques';
import { isPostDated, validUntil } from '../lib/cheque-reminders';
import { localDb } from '../lib/localDb';
import { purchasesDb } from '../lib/purchases';
import { downloadText } from '../lib/download';
import { formatDate, formatMoney, todayInput } from '../lib/utils';
import type { Cheque, ChequeDirection, ChequeStatus } from '../types/cheques';
import { Page } from '../components/ui/Page';
import { StatCard } from '../components/ui/StatCard';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { ChequeFormModal } from '../components/cheques/ChequeFormModal';
import { ChequeActionModal } from '../components/cheques/ChequeActionModal';
import { ChequePrintModal } from '../components/cheques/ChequePrintModal';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from '../components/cheques/Cheques.module.css';
import { useT } from '../i18n';
import { chqT } from '../i18n/areas/cheques';

const actionLabel = (s: ChequeStatus): string =>
  s === 'deposited' || s === 'presented' || s === 'cleared' || s === 'bounced' || s === 'cancelled' ? chqT(`act.${s}`) : chqT(`st.${s}`);

const STATUS_TONE: Record<ChequeStatus, string> = {
  received: surface.badgeSent,
  issued: surface.badgeSent,
  deposited: surface.badgePartial,
  presented: surface.badgePartial,
  cleared: surface.badgePaid,
  bounced: surface.badgeOverdue,
  cancelled: surface.badgeCancelled,
};

const inr = (n: number) => `₹${formatMoney(n)}`;

/** Cheque register & PDC tracking, cheque printing (roadmap 6.26). */
export function Cheques() {
  const { lang } = useT(); // re-render on a language switch (5.4); `docLabel` depends on it (QA19 U4)
  const [params, setParams] = useSearchParams();
  const dirParam = params.get('dir');
  const direction: ChequeDirection | 'all' = dirParam === 'received' || dirParam === 'issued' ? dirParam : 'all';
  const status = (params.get('status') ?? 'open') as ChequeFilter['status'];
  const [query, setQuery] = useState('');
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState<{ open: boolean; direction: ChequeDirection; cheque: Cheque | null }>({ open: false, direction: 'received', cheque: null });
  const [action, setAction] = useState<{ cheque: Cheque; to: ChequeStatus } | null>(null);
  const [printing, setPrinting] = useState<Cheque | null>(null);
  const [deleting, setDeleting] = useState<Cheque | null>(null);
  const { notify, toastNode } = useToast();
  const today = todayInput();

  useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => loadCheques(), [version]);
  const rows = useMemo(() => filterCheques(all, { direction, status, query }, today), [all, direction, status, query, today]);
  const summary = useMemo(() => chequeSummary(all, today), [all, today]);
  // Cheques whose recorded payment was deleted with its invoice / bill: shown, and editable / deletable again.
  const missing = useMemo(() => new Set(all.filter((c) => (c.payment_id || c.purchase_payment_id) && linkedPaymentMissing(c)).map((c) => c.id)), [all]);
  const bouncedParties = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of all) if (c.direction === 'received' && (c.bounce_count ?? 0) > 0) m.set(c.client_id || c.party_name.toLowerCase(), (m.get(c.client_id || c.party_name.toLowerCase()) ?? 0) + (c.bounce_count ?? 0));
    return m;
  }, [all]);
  const docLabel = useMemo(() => {
    const inv = new Map(localDb.invoices.getAll().map((i) => [i.id, i.invoice_number]));
    const bills = new Map(purchasesDb.all().map((b) => [b.id, b.bill_number || chqT('billWord')]));
    return (c: Cheque) =>
      c.invoice_id ? { text: inv.get(c.invoice_id) ?? chqT('deletedInvoice'), to: inv.has(c.invoice_id) ? `/invoice/${c.invoice_id}` : undefined }
      : c.purchase_id ? { text: bills.get(c.purchase_id) ?? chqT('deletedBill'), to: bills.has(c.purchase_id) ? '/expenses' : undefined }
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, lang]);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const refresh = () => setVersion((v) => v + 1);

  const remove = (c: Cheque) => {
    try {
      deleteCheque(c.id);
      refresh();
      notify(chqT('deleted', { number: c.number }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <Page
      title={chqT('title')}
      subtitle={chqT('subtitle')}
      actions={
        <>
          <button type="button" className={controls.btnOutline} disabled={!all.length} onClick={() => downloadText(`cheque-register-${today}.csv`, chequesCsv(rows), 'text/csv')}>
            <Download size={16} /> CSV
          </button>
          <button type="button" className={controls.btnOutline} onClick={() => setForm({ open: true, direction: 'issued', cheque: null })}>
            <ArrowUpRight size={16} /> {chqT('issue')}
          </button>
          <button type="button" className={controls.btnPrimary} onClick={() => setForm({ open: true, direction: 'received', cheque: null })}>
            <ArrowDownLeft size={16} /> {chqT('receivedBtn')}
          </button>
        </>
      }
    >

      <div className={surface.statGrid}>
        <StatCard label={chqT('inHand')} icon={Wallet} value={inr(summary.inHand.amount)} hint={chqT('toDeposit', { n: summary.inHand.count })} />
        <StatCard label={chqT('pdc')} icon={CalendarClock} tone="warning" value={inr(summary.postDatedIn.amount)} hint={chqT('pdcHint', { n: summary.postDatedIn.count })} />
        <StatCard label={chqT('inClearing')} icon={Banknote} tone="brand" value={inr(summary.inClearing.amount)} hint={chqT('nDeposited', { n: summary.inClearing.count })} />
        <StatCard label={chqT('issuedOpen')} icon={ArrowUpRight} tone="loss" value={inr(summary.issuedOpen.amount)} hint={summary.issuedOpen.count === 1 ? chqT('nChequesOne') : chqT('nChequesMany', { n: summary.issuedOpen.count })} />
        {summary.bounced.count > 0 && <StatCard label={chqT('bounced')} icon={AlertTriangle} tone="loss" value={inr(summary.bounced.amount)} hint={chqT('followUp', { n: summary.bounced.count })} />}
      </div>

      <section className={surface.card}>
        <div className={styles.filters}>
          <div className={controls.segment} role="radiogroup" aria-label={chqT('direction')}>
            {(['all', 'received', 'issued'] as const).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={direction === d} className={direction === d ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParam('dir', d === 'all' ? '' : d)}>
                {d === 'all' ? chqT('all') : d === 'received' ? chqT('received') : chqT('issued')}
              </button>
            ))}
          </div>
          <label className={controls.field}>
            <span className={controls.label}>{chqT('show')}</span>
            <select className={controls.select} value={status} onChange={(e) => setParam('status', e.target.value === 'open' ? '' : e.target.value)}>
              <option value="open">{chqT('open')}</option>
              <option value="pdc">{chqT('pdcOnly')}</option>
              <option value="all">{chqT('allCheques')}</option>
              {(['received', 'deposited', 'cleared', 'bounced', 'issued', 'presented', 'cancelled'] as ChequeStatus[]).map((s) => (
                <option key={s} value={s}>{chqT(`st.${s}`)}</option>
              ))}
            </select>
          </label>
          <label className={`${controls.field} ${styles.search}`}>
            <span className={controls.label}>{chqT('search')}</span>
            <input className={controls.input} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={chqT('searchPh')} />
          </label>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title={all.length ? chqT('noMatch') : chqT('none')}
            text={all.length ? chqT('noMatchText') : chqT('noneText')}
          />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{chqT('caption')}</caption>
              <thead>
                <tr>
                  <th>{chqT('chequeDate')}</th>
                  <th>{chqT('noBank')}</th>
                  <th>{chqT('party')}</th>
                  <th>{chqT('against')}</th>
                  <th className={styles.numeric}>{chqT('amount')}</th>
                  <th>{chqT('status')}</th>
                  <th className={styles.numeric}>{chqT('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const pdc = isPostDated(c, today) && (c.status === 'received' || c.status === 'issued');
                  const doc = docLabel(c);
                  const bounces = c.direction === 'received' ? bouncedParties.get(c.client_id || c.party_name.toLowerCase()) ?? 0 : 0;
                  const expired = c.status === 'received' && validUntil(c.cheque_date) < today;
                  return (
                    <tr key={c.id}>
                      <td>
                        {formatDate(c.cheque_date)}
                        {pdc && <span className={`${surface.badge} ${styles.pdc}`} style={{ marginLeft: '0.375rem' }}>PDC</span>}
                        {expired && <span className={`${surface.badge} ${styles.flag}`} style={{ marginLeft: '0.375rem' }}>{chqT('expired')}</span>}
                        <span className={styles.sub}>{chqT('validTill', { dir: c.direction === 'received' ? chqT('received') : chqT('issued'), date: formatDate(validUntil(c.cheque_date)) })}</span>
                      </td>
                      <td>
                        <span className={surface.mono}>{c.number}</span>
                        <span className={styles.sub}>{c.bank}{c.branch ? `, ${c.branch}` : ''}</span>
                      </td>
                      <td>
                        {c.party_name}
                        {bounces > 0 && <span className={`${surface.badge} ${styles.flag}`} style={{ marginLeft: '0.375rem' }} title={chqT('partyBounced')}>{chqT('nBounced', { n: bounces })}</span>}
                      </td>
                      <td>{doc ? (doc.to ? <Link to={doc.to}>{doc.text}</Link> : doc.text) : <span className={styles.sub}>-</span>}</td>
                      <td className={styles.numeric}>{formatMoney(c.amount)}</td>
                      <td>
                        <span className={`${surface.badge} ${STATUS_TONE[c.status]}`}>{chqT(`st.${c.status}`)}</span>
                        {c.status === 'bounced' && c.bounce_reason && <span className={styles.sub}>{c.bounce_reason}</span>}
                        {c.cleared_on && c.status === 'cleared' && <span className={styles.sub}>{chqT('clearedOn', { date: formatDate(c.cleared_on) })}</span>}
                        {missing.has(c.id) && <span className={styles.sub} role="note">Linked payment no longer exists (its document was deleted)</span>}
                      </td>
                      <td>
                        <div className={styles.actions}>
                          {nextStatuses(c).map((to) => (
                            <button key={to} type="button" className={`${to === 'bounced' || to === 'cancelled' ? controls.btnOutline : controls.btnPrimary} ${controls.btnSm}`} onClick={() => setAction({ cheque: c, to })} aria-label={chqT('actionAria', { action: actionLabel(to), number: c.number })}>
                              {actionLabel(to)}
                            </button>
                          ))}
                          {c.direction === 'issued' && c.status !== 'cancelled' && (
                            <button type="button" className={controls.btnIcon} onClick={() => setPrinting(c)} aria-label={chqT('printOf', { number: c.number })} title={chqT('printCheque')}>
                              <Printer size={15} />
                            </button>
                          )}
                          <button type="button" className={controls.btnIcon} onClick={() => setForm({ open: true, direction: c.direction, cheque: c })} aria-label={chqT('editOf', { number: c.number })} title={chqT('edit')}>
                            <Pencil size={15} />
                          </button>
                          <button type="button" className={controls.btnDanger} disabled={!!(c.payment_id || c.purchase_payment_id) && !missing.has(c.id)} onClick={() => setDeleting(c)} aria-label={chqT('deleteOf', { number: c.number })} title={chqT('delete')}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.note}>
          {chqT('note')}
        </p>
      </section>

      <ChequeFormModal
        open={form.open}
        direction={form.direction}
        cheque={form.cheque}
        onClose={() => setForm((f) => ({ ...f, open: false }))}
        onSaved={(c, isNew) => {
          refresh();
          notify(isNew ? chqT(isPostDated(c, today) ? 'savedPdc' : 'saved', { number: c.number }) : chqT('updated', { number: c.number }));
        }}
      />
      <ChequeActionModal
        cheque={action?.cheque ?? null}
        to={action?.to ?? null}
        onClose={() => setAction(null)}
        onDone={(r) => {
          refresh();
          notify(chqT('moved', { number: r.cheque.number, status: chqT(`st.${r.cheque.status}`).toLowerCase() }) + (r.note ? `: ${r.note}` : ''));
        }}
      />
      <ChequePrintModal key={printing?.id ?? 'none'} cheque={printing} onClose={() => setPrinting(null)} />
      <ConfirmDialog
        open={!!deleting}
        title={chqT('delTitle')}
        message={deleting ? chqT('delMsg', { number: deleting.number }) : ''}
        confirmLabel={chqT('delete')}
        destructive
        onConfirm={() => {
          if (deleting) remove(deleting);
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
      {toastNode}
    </Page>
  );
}
