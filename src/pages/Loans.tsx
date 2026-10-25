import { useMemo, useState } from 'react';
import { Download, HandCoins, Plus, Trash2, Undo2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../components/ui/useToast';
import {
  deleteLoan,
  deleteLoanPayment,
  loadLoans,
  loanStatement,
  payEmi,
  postDisbursement,
  saveLoan,
  type BusinessLoan,
} from '../lib/loans';
import { A, chartOf, loadUserAccounts } from '../lib/ledger/accounts';
import { isCashOrBankLedger } from '../lib/bank-ledgers';
import { toCsv } from '../lib/csv';
import { downloadText } from '../lib/download';
import { useCan } from '../hooks/useCan';
import { formatCurrency, formatDate, todayInput } from '../lib/utils';
import { useT } from '../i18n';
import { loansT } from '../i18n/areas/loans';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from '../components/settings/ShopModePanel.module.css';

interface Draft {
  lender: string;
  principal: string;
  rate: string;
  tenure: string;
  date: string;
  firstEmi: string;
  payFrom: string;
  notes: string;
}

const blank = (): Draft => ({ lender: '', principal: '', rate: '', tenure: '12', date: todayInput(), firstEmi: todayInput(), payFrom: A.bank, notes: '' });

/** Loans & EMI tracker (8H): business loans, their schedule, EMI payments and statement. */
export function Loans() {
  useT();
  const { notify, toastNode } = useToast();
  const { can } = useCan();
  const editable = can('books.edit');
  const [tick, setTick] = useState(0);
  const loans = useMemo(() => loadLoans(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const today = todayInput();
  const cashBank = useMemo(() => chartOf(loadUserAccounts()).filter((a) => isCashOrBankLedger(a)), []);
  const refresh = () => setTick((n) => n + 1);
  const run = (fn: () => string) => {
    try {
      notify(fn());
    } catch (err) {
      notify((err as Error).message, 'error');
    }
    refresh();
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    run(() => {
      const l = saveLoan({
        lender: draft.lender,
        principal: Number(draft.principal),
        rate: Number(draft.rate),
        tenure_months: Number(draft.tenure),
        date: draft.date,
        first_emi: draft.firstEmi,
        pay_from: draft.payFrom,
        notes: draft.notes.trim() || undefined,
      });
      setDraft(null);
      setOpenId(l.id);
      return loansT('saved', { number: l.number });
    });
  };

  const statementCsv = (loan: BusinessLoan) => {
    const st = loanStatement(loan, today);
    const paid = new Map(loan.payments.map((p) => [p.n, p]));
    const rows: unknown[][] = [[loansT('colN'), loansT('colDate'), loansT('colOpening'), loansT('colEmi'), loansT('colInterest'), loansT('colPrincipal'), loansT('colClosing'), loansT('colStatus')]];
    for (const r of st.schedule) rows.push([r.n, r.date, r.opening, r.emi, r.interest, r.principal, r.closing, paid.get(r.n)?.voucher_number ?? '']);
    for (const p of loan.payments.filter((x) => x.n === 0)) rows.push(['prepayment', p.date, '', p.principal + p.interest, p.interest, p.principal, '', p.voucher_number]);
    downloadText(`${loan.number.replace(/\//g, '-')}-statement.csv`, toCsv(rows), 'text/csv');
  };

  return (
    <div className={surface.page}>
      <PageHeader
        title={loansT('title')}
        subtitle={loansT('subtitle')}
        actions={editable && !draft ? <button type="button" className={controls.btnPrimary} onClick={() => setDraft(blank())}><Plus size={16} /> {loansT('add')}</button> : undefined}
      />

      {draft && (
        <section className={surface.card}>
          <form className={surface.cardBody} onSubmit={save} aria-label={loansT('add')}>
            <div className={controls.row3}>
              <label className={controls.field}><span className={controls.label}>{loansT('lender')}</span><input className={controls.input} autoFocus value={draft.lender} onChange={(e) => setDraft({ ...draft, lender: e.target.value })} /></label>
              <label className={controls.field}><span className={controls.label}>{loansT('principal')}</span><input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={draft.principal} onChange={(e) => setDraft({ ...draft, principal: e.target.value })} /></label>
              <label className={controls.field}><span className={controls.label}>{loansT('rate')}</span><input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} /></label>
            </div>
            <div className={controls.row3}>
              <label className={controls.field}><span className={controls.label}>{loansT('tenure')}</span><input className={`${controls.input} ${controls.inputNumeric}`} inputMode="numeric" value={draft.tenure} onChange={(e) => setDraft({ ...draft, tenure: e.target.value })} /></label>
              <label className={controls.field}><span className={controls.label}>{loansT('date')}</span><input className={controls.input} type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
              <label className={controls.field}><span className={controls.label}>{loansT('firstEmi')}</span><input className={controls.input} type="date" value={draft.firstEmi} onChange={(e) => setDraft({ ...draft, firstEmi: e.target.value })} /></label>
            </div>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>{loansT('payFrom')}</span>
                <select className={controls.select} value={draft.payFrom} onChange={(e) => setDraft({ ...draft, payFrom: e.target.value })}>
                  {cashBank.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label className={controls.field}><span className={controls.label}>{loansT('notes')}</span><input className={controls.input} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
            </div>
            <div className={styles.actions}>
              <button type="submit" className={controls.btnPrimary}>{loansT('save')}</button>
              <button type="button" className={controls.btnGhost} onClick={() => setDraft(null)}>{loansT('cancel')}</button>
            </div>
          </form>
        </section>
      )}

      {loans.length === 0 && !draft && <EmptyState icon={HandCoins} title={loansT('title')} text={loansT('empty')} />}

      {loans.map((loan) => {
        const st = loanStatement(loan, today);
        const open = openId === loan.id;
        const paid = new Map(loan.payments.filter((p) => p.n > 0).map((p) => [p.n, p]));
        return (
          <section key={loan.id} className={surface.card} data-loan={loan.number}>
            <div className={surface.cardHead}>
              <button type="button" className={controls.btnGhost} aria-expanded={open} onClick={() => setOpenId(open ? null : loan.id)}>
                <HandCoins size={16} aria-hidden="true" /> {loan.lender} · {loan.number}
              </button>
              <span className={controls.hint}>
                {loansT('emi')} {formatCurrency(st.emi)} · {loansT('outstanding')} {formatCurrency(st.outstanding)} ·{' '}
                {loan.closed ? loansT('closed') : st.next ? loansT('nextEmi', { n: st.next.n, date: formatDate(st.next.date) }) : loansT('allPaid')}
                {st.overdue.length > 0 && <> · <strong>{loansT('overdueN', { n: st.overdue.length })}</strong></>}
              </span>
            </div>
            {open && (
              <div className={surface.cardBody}>
                <p className={controls.hint}>
                  {loansT('totalInterest')} {formatCurrency(st.totalInterest)} · {loansT('interestPaid')} {formatCurrency(st.paidInterest)}
                </p>
                <div className={styles.actions}>
                  {editable && !loan.disbursal_voucher_id && (
                    <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => run(() => (postDisbursement(loan.id), loansT('disbursed')))}>{loansT('disburse')}</button>
                  )}
                  <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => statementCsv(loan)}><Download size={14} /> {loansT('statement')}</button>
                  {editable && loan.payments.length === 0 && (
                    <button type="button" className={controls.btnDanger} onClick={() => run(() => (deleteLoan(loan.id), loansT('delete')))} aria-label={loansT('delete')}><Trash2 size={16} /></button>
                  )}
                </div>
                <table className={surface.table} aria-label={loansT('schedule')}>
                  <thead>
                    <tr>
                      <th>{loansT('colN')}</th><th>{loansT('colDate')}</th><th>{loansT('colOpening')}</th><th>{loansT('colEmi')}</th>
                      <th>{loansT('colInterest')}</th><th>{loansT('colPrincipal')}</th><th>{loansT('colClosing')}</th><th>{loansT('colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.schedule.map((r) => {
                      const p = paid.get(r.n);
                      return (
                        <tr key={r.n}>
                          <td>{r.n}</td><td>{formatDate(r.date)}</td><td>{formatCurrency(r.opening)}</td><td>{formatCurrency(r.emi)}</td>
                          <td>{formatCurrency(r.interest)}</td><td>{formatCurrency(r.principal)}</td><td>{formatCurrency(r.closing)}</td>
                          <td>
                            {p ? (
                              <>
                                {loansT('paid', { voucher: p.voucher_number })}{' '}
                                {editable && <button type="button" className={controls.btnIcon} aria-label={loansT('undo')} onClick={() => run(() => (deleteLoanPayment(loan.id, p.id), loansT('undo')))}><Undo2 size={14} /></button>}
                              </>
                            ) : editable && st.next?.n === r.n ? (
                              <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => run(() => loansT('emiPaid', { n: r.n, voucher: payEmi(loan.id, r.n).voucher_number }))}>{loansT('pay')}</button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className={controls.hint}>{loansT('note')}</p>
              </div>
            )}
          </section>
        );
      })}
      {toastNode}
    </div>
  );
}
