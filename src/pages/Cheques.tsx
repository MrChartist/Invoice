import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, CalendarClock, Download, Pencil, Printer, Trash2, Wallet } from 'lucide-react';
import {
  STATUS_LABELS,
  chequeSummary,
  chequesCsv,
  deleteCheque,
  filterCheques,
  loadCheques,
  nextStatuses,
  type ChequeFilter,
} from '../lib/cheques';
import { isPostDated, validUntil } from '../lib/cheque-reminders';
import { localDb } from '../lib/localDb';
import { purchasesDb } from '../lib/purchases';
import { downloadText } from '../lib/download';
import { formatDate, formatMoney, todayInput } from '../lib/utils';
import type { Cheque, ChequeDirection, ChequeStatus } from '../types/cheques';
import { PageHeader } from '../components/ui/PageHeader';
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

const ACTION_LABELS: Partial<Record<ChequeStatus, string>> = {
  deposited: 'Deposit',
  presented: 'Presented',
  cleared: 'Clear',
  bounced: 'Bounced',
  cancelled: 'Cancel',
};

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
  const bouncedParties = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of all) if (c.direction === 'received' && (c.bounce_count ?? 0) > 0) m.set(c.client_id || c.party_name.toLowerCase(), (m.get(c.client_id || c.party_name.toLowerCase()) ?? 0) + (c.bounce_count ?? 0));
    return m;
  }, [all]);
  const docLabel = useMemo(() => {
    const inv = new Map(localDb.invoices.getAll().map((i) => [i.id, i.invoice_number]));
    const bills = new Map(purchasesDb.all().map((b) => [b.id, b.bill_number || 'Bill']));
    return (c: Cheque) =>
      c.invoice_id ? { text: inv.get(c.invoice_id) ?? 'deleted invoice', to: inv.has(c.invoice_id) ? `/invoice/${c.invoice_id}` : undefined }
      : c.purchase_id ? { text: bills.get(c.purchase_id) ?? 'deleted bill', to: bills.has(c.purchase_id) ? '/expenses' : undefined }
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

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
      notify(`Cheque ${c.number} deleted`);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <div className={surface.page}>
      <PageHeader
        title="Cheques"
        subtitle="Cheques received and issued, post-dated cheque reminders, bounces — and printing on CTS-2010 leaves."
        actions={
          <>
            <button type="button" className={controls.btnOutline} disabled={!all.length} onClick={() => downloadText(`cheque-register-${today}.csv`, chequesCsv(rows), 'text/csv')}>
              <Download size={16} /> CSV
            </button>
            <button type="button" className={controls.btnOutline} onClick={() => setForm({ open: true, direction: 'issued', cheque: null })}>
              <ArrowUpRight size={16} /> Issue cheque
            </button>
            <button type="button" className={controls.btnPrimary} onClick={() => setForm({ open: true, direction: 'received', cheque: null })}>
              <ArrowDownLeft size={16} /> Cheque received
            </button>
          </>
        }
      />

      <div className={surface.statGrid}>
        <StatCard label="In hand" icon={Wallet} value={inr(summary.inHand.amount)} hint={`${summary.inHand.count} to deposit`} />
        <StatCard label="Post-dated (PDC)" icon={CalendarClock} tone="warning" value={inr(summary.postDatedIn.amount)} hint={`${summary.postDatedIn.count} received, dated ahead`} />
        <StatCard label="In clearing" icon={Banknote} tone="brand" value={inr(summary.inClearing.amount)} hint={`${summary.inClearing.count} deposited`} />
        <StatCard label="Issued, not cleared" icon={ArrowUpRight} tone="loss" value={inr(summary.issuedOpen.amount)} hint={`${summary.issuedOpen.count} cheque${summary.issuedOpen.count === 1 ? '' : 's'}`} />
        {summary.bounced.count > 0 && <StatCard label="Bounced" icon={AlertTriangle} tone="loss" value={inr(summary.bounced.amount)} hint={`${summary.bounced.count} to follow up`} />}
      </div>

      <section className={surface.card}>
        <div className={styles.filters}>
          <div className={controls.segment} role="radiogroup" aria-label="Direction">
            {(['all', 'received', 'issued'] as const).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={direction === d} className={direction === d ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParam('dir', d === 'all' ? '' : d)}>
                {d === 'all' ? 'All' : d === 'received' ? 'Received' : 'Issued'}
              </button>
            ))}
          </div>
          <label className={controls.field}>
            <span className={controls.label}>Show</span>
            <select className={controls.select} value={status} onChange={(e) => setParam('status', e.target.value === 'open' ? '' : e.target.value)}>
              <option value="open">Open (not cleared)</option>
              <option value="pdc">Post-dated only</option>
              <option value="all">All cheques</option>
              {(['received', 'deposited', 'cleared', 'bounced', 'issued', 'presented', 'cancelled'] as ChequeStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label className={`${controls.field} ${styles.search}`}>
            <span className={controls.label}>Search</span>
            <input className={controls.input} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Number, bank or party" />
          </label>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title={all.length ? 'No cheques match' : 'No cheques yet'}
            text={all.length ? 'Change the filters to see more.' : 'Record cheques you receive (including post-dated ones) and cheques you issue. Post-dated cheques show up in the notification bell near their date.'}
          />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>Cheque register</caption>
              <thead>
                <tr>
                  <th>Cheque date</th>
                  <th>No. / bank</th>
                  <th>Party</th>
                  <th>Against</th>
                  <th className={styles.numeric}>Amount</th>
                  <th>Status</th>
                  <th className={styles.numeric}>Actions</th>
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
                        {expired && <span className={`${surface.badge} ${styles.flag}`} style={{ marginLeft: '0.375rem' }}>Expired</span>}
                        <span className={styles.sub}>{c.direction === 'received' ? 'Received' : 'Issued'} · valid till {formatDate(validUntil(c.cheque_date))}</span>
                      </td>
                      <td>
                        <span className={surface.mono}>{c.number}</span>
                        <span className={styles.sub}>{c.bank}{c.branch ? `, ${c.branch}` : ''}</span>
                      </td>
                      <td>
                        {c.party_name}
                        {bounces > 0 && <span className={`${surface.badge} ${styles.flag}`} style={{ marginLeft: '0.375rem' }} title="Cheques from this party have bounced">{bounces} bounced</span>}
                      </td>
                      <td>{doc ? (doc.to ? <Link to={doc.to}>{doc.text}</Link> : doc.text) : <span className={styles.sub}>—</span>}</td>
                      <td className={styles.numeric}>{formatMoney(c.amount)}</td>
                      <td>
                        <span className={`${surface.badge} ${STATUS_TONE[c.status]}`}>{STATUS_LABELS[c.status]}</span>
                        {c.status === 'bounced' && c.bounce_reason && <span className={styles.sub}>{c.bounce_reason}</span>}
                        {c.cleared_on && c.status === 'cleared' && <span className={styles.sub}>on {formatDate(c.cleared_on)}</span>}
                      </td>
                      <td>
                        <div className={styles.actions}>
                          {nextStatuses(c).map((to) => (
                            <button key={to} type="button" className={`${to === 'bounced' || to === 'cancelled' ? controls.btnOutline : controls.btnPrimary} ${controls.btnSm}`} onClick={() => setAction({ cheque: c, to })} aria-label={`${ACTION_LABELS[to]} cheque ${c.number}`}>
                              {ACTION_LABELS[to]}
                            </button>
                          ))}
                          {c.direction === 'issued' && c.status !== 'cancelled' && (
                            <button type="button" className={controls.btnIcon} onClick={() => setPrinting(c)} aria-label={`Print cheque ${c.number}`} title="Print cheque">
                              <Printer size={15} />
                            </button>
                          )}
                          <button type="button" className={controls.btnIcon} onClick={() => setForm({ open: true, direction: c.direction, cheque: c })} aria-label={`Edit cheque ${c.number}`} title="Edit">
                            <Pencil size={15} />
                          </button>
                          <button type="button" className={controls.btnDanger} disabled={!!(c.payment_id || c.purchase_payment_id)} onClick={() => setDeleting(c)} aria-label={`Delete cheque ${c.number}`} title="Delete">
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
          Clearing a cheque linked to an invoice records the payment there (the period lock applies); a bounce reverses it. A cheque is
          valid for 3 months from its date and cannot be deposited before it.
        </p>
      </section>

      <ChequeFormModal
        open={form.open}
        direction={form.direction}
        cheque={form.cheque}
        onClose={() => setForm((f) => ({ ...f, open: false }))}
        onSaved={(c, isNew) => {
          refresh();
          notify(isNew ? `Cheque ${c.number} saved${isPostDated(c, today) ? ' — post-dated, you will be reminded' : ''}` : `Cheque ${c.number} updated`);
        }}
      />
      <ChequeActionModal
        cheque={action?.cheque ?? null}
        to={action?.to ?? null}
        onClose={() => setAction(null)}
        onDone={(r) => {
          refresh();
          notify(`Cheque ${r.cheque.number} ${STATUS_LABELS[r.cheque.status].toLowerCase()}${r.note ? ` — ${r.note}` : ''}`);
        }}
      />
      <ChequePrintModal key={printing?.id ?? 'none'} cheque={printing} onClose={() => setPrinting(null)} />
      <ConfirmDialog
        open={!!deleting}
        title="Delete this cheque?"
        message={deleting ? `Cheque ${deleting.number} from the register. This cannot be undone.` : ''}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleting) remove(deleting);
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
      {toastNode}
    </div>
  );
}
