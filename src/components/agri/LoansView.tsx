/** AG-D3 loans against stored lots (also an FPO's member loans): give, repay interest first, statement, undo, delete. */
import { useMemo, useState } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { todayInput } from '../../lib/utils';
import { loadLots, lotBalance } from '../../lib/agri/ag-cold-lots';
import { deleteLoan, giveLoan, interestStatement, loadLoans, loanState, ltvWarning, overdueLoans, repayLoan, undoRepayment } from '../../lib/agri/ag-loans';
import { NumberInput } from '../ui/NumberInput';
import { F, Sel, Tbl } from './agd-kit';
import { btn, clientOpts, fmt, useRun, wrap, type Done } from './agd-ui';
import controls from '../../styles/controls.module.css';

const BY = (): [string, string][] => [['bank', agdT('bank')], ['cash', agdT('cash')]];

export default function LoansView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const day = todayInput();
  const loans = useMemo(() => { void tick; return loadLoans(); }, [tick]);
  const lots = useMemo(() => { void tick; return loadLots(); }, [tick]);
  const clients = clientOpts();
  const [f, setF] = useState({ date: day, borrower_id: '', lot_ids: [] as string[], principal: 0, rate_pct: 12, due_date: '', max_ltv_pct: 70, bag_rate: 0, by: 'bank' as 'bank' | 'cash' });
  const [r, setR] = useState({ loan: '', date: day, amount: 0, by: 'bank' as 'bank' | 'cash' });
  const [show, setShow] = useState('');
  const mine = lots.filter((l) => l.depositor_id === f.borrower_id && lotBalance(l) > 0);
  const warn = ltvWarning(f.principal, mine.filter((l) => f.lot_ids.includes(l.id)).reduce((t, l) => t + lotBalance(l), 0), f.bag_rate, f.max_ltv_pct);
  const over = new Set(overdueLoans(loans, day).map((l) => l.id));
  const shown = loans.find((l) => l.id === show);
  return (
    <>
      <div style={wrap}>
        <F label={agdT('date')}><input type="date" className={controls.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></F>
        <F label={agdT('borrower')}><Sel value={f.borrower_id} onChange={(v) => setF({ ...f, borrower_id: v, lot_ids: [] })} opts={clients} blank="—" data-agd="borrower" /></F>
        <F label={agdT('principal')} w={120}><NumberInput className={controls.input} value={f.principal} onChange={(v) => setF({ ...f, principal: v })} data-agd="principal" /></F>
        <F label={agdT('ratePa')} w={90}><NumberInput className={controls.input} value={f.rate_pct} onChange={(v) => setF({ ...f, rate_pct: v })} /></F>
        <F label={agdT('dueDate')}><input type="date" className={controls.input} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></F>
        <F label={agdT('maxLtv')} w={90}><NumberInput className={controls.input} value={f.max_ltv_pct} onChange={(v) => setF({ ...f, max_ltv_pct: v })} /></F>
        <F label={agdT('bagRate')} w={110}><NumberInput className={controls.input} value={f.bag_rate} onChange={(v) => setF({ ...f, bag_rate: v })} /></F>
        <F label={agdT('paidBy')}><Sel value={f.by} onChange={(v) => setF({ ...f, by: v as 'bank' | 'cash' })} opts={BY()} /></F>
      </div>
      <div style={wrap}>
        {mine.map((l) => <label key={l.id}><input type="checkbox" checked={f.lot_ids.includes(l.id)} onChange={(e) => setF({ ...f, lot_ids: e.target.checked ? [...f.lot_ids, l.id] : f.lot_ids.filter((x) => x !== l.id) })} data-agd-loan-lot /> {l.number} ({lotBalance(l)})</label>)}
        <button type="button" className={controls.btnPrimary} onClick={() => run(() => agdT('loanSaved', { n: giveLoan({ ...f, borrower_name: clients.find((c) => c[0] === f.borrower_id)?.[1] ?? '', disbursed_by: f.by }).number }))} data-agd-give-loan>{agdT('giveLoan')}</button>
      </div>
      {warn && <p className={controls.hint} role="alert">{warn}</p>}
      <Tbl
        head={[agdT('loan'), agdT('date'), agdT('borrower'), agdT('principal'), agdT('outstanding'), agdT('interest'), agdT('dueDate'), '']}
        flag={loans.map((l) => over.has(l.id))}
        rows={loans.map((l) => { const s = loanState(l, day); return [<button key="n" type="button" className={controls.btnGhost} onClick={() => setShow(l.id)}>{l.number}</button>, l.date, l.borrower_name, fmt(l.principal), fmt(s.principal), fmt(s.interest), l.due_date ?? '', l.status === 'closed' ? agdT('closed') :
          <span key="a" style={{ display: 'flex', gap: 4 }}>
            {!!l.repayments.length && <button type="button" className={btn} aria-label={agdT('undo')} onClick={() => run(() => { undoRepayment(l.id); return agdT('deleted'); })}><Undo2 size={14} aria-hidden="true" /></button>}
            {!l.repayments.length && <button type="button" className={btn} aria-label={agdT('delete')} onClick={() => run(() => { deleteLoan(l.id); return agdT('deleted'); })}><Trash2 size={14} aria-hidden="true" /></button>}
          </span>]; })}
      />
      <h3>{agdT('repay')}</h3>
      <div style={wrap}>
        <F label={agdT('loan')}><Sel value={r.loan} onChange={(v) => setR({ ...r, loan: v, amount: loans.find((l) => l.id === v) ? loanState(loans.find((l) => l.id === v)!, r.date).total : 0 })} opts={loans.filter((l) => l.status === 'open').map((l) => [l.id, `${l.number} · ${l.borrower_name}`])} blank="—" data-agd="repay-loan" /></F>
        <F label={agdT('date')}><input type="date" className={controls.input} value={r.date} onChange={(e) => setR({ ...r, date: e.target.value })} /></F>
        <F label={agdT('amount')} w={120}><NumberInput className={controls.input} value={r.amount} onChange={(v) => setR({ ...r, amount: v })} /></F>
        <F label={agdT('paidBy')}><Sel value={r.by} onChange={(v) => setR({ ...r, by: v as 'bank' | 'cash' })} opts={BY()} /></F>
        <button type="button" className={btn} onClick={() => run(() => { const l = repayLoan(r.loan, r); return agdT(l.status === 'closed' ? 'loanClosed' : 'repaid', { n: l.number }); })} data-agd-repay>{agdT('repay')}</button>
      </div>
      {shown && <Tbl head={[agdT('date'), '', agdT('days'), agdT('interest'), agdT('paid'), agdT('outstanding')]} rows={interestStatement(shown, day).map((x) => [x.date, x.what, x.days, fmt(x.interest), fmt(x.paid), fmt(x.principal)])} />}
      <p className={controls.hint}>{agdT('loanNote')}</p>
    </>
  );
}
