/** AG-D3 loans against stored lots (also an FPO's member loans): give, repay interest first, statement, undo, delete. */
import { useMemo, useState } from 'react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { todayInput } from '../../lib/utils';
import { loadLots, lotBalance } from '../../lib/agri/ag-cold-lots';
import { deleteLoan, giveLoan, loadLoans, loanState, ltvWarning, overdueLoans, repayLoan, undoRepayment } from '../../lib/agri/ag-loans';
import { B, Form, Hint, Tbl } from './agd-kit';
import { clientOpts, fmt, useRun, wrap, type Done } from './agd-ui';
import controls from '../../styles/controls.module.css';

export default function LoansView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const day = todayInput();
  const loans = useMemo(() => { void tick; return loadLoans(); }, [tick]);
  const lots = useMemo(() => { void tick; return loadLots(); }, [tick]);
  const clients = clientOpts();
  const by = [['bank', agdT('bank')], ['cash', agdT('cash')]] as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [f, setF] = useState<Record<string, any>>({ date: day, rate_pct: 12, max_ltv_pct: 70, disbursed_by: 'bank', lot_ids: [] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [r, setR] = useState<Record<string, any>>({ date: day, by: 'bank' });
  const mine = lots.filter((l) => l.depositor_id === f.borrower_id && lotBalance(l) > 0);
  const warn = ltvWarning(f.principal, mine.filter((l) => f.lot_ids.includes(l.id)).reduce((t, l) => t + lotBalance(l), 0), f.bag_rate, f.max_ltv_pct);
  const over = new Set(overdueLoans(loans, day).map((l) => l.id));
  const repayFor = (v: typeof r) => setR(v.loan !== r.loan ? { ...v, amount: loanState(loans.find((l) => l.id === v.loan)!, v.date).total } : v);
  return (
    <>
      <Form v={f} set={(v) => setF(v.borrower_id !== f.borrower_id ? { ...v, lot_ids: [] } : v)} f={[['date', 'date', 'd'], ['borrower_id', 'borrower', clients], ['principal', 'principal', 'n', 120], ['rate_pct', 'ratePa', 'n', 90], ['due_date', 'dueDate', 'd'], ['max_ltv_pct', 'maxLtv', 'n', 90], ['bag_rate', 'bagRate', 'n', 110], ['disbursed_by', 'paidBy', by]]} />
      <div style={wrap}>
        {mine.map((l) => <label key={l.id}><input type="checkbox" checked={f.lot_ids.includes(l.id)} onChange={(e) => setF({ ...f, lot_ids: e.target.checked ? [...f.lot_ids, l.id] : f.lot_ids.filter((x: string) => x !== l.id) })} data-agd-loan-lot /> {l.number} ({lotBalance(l)})</label>)}
        <B p k="giveLoan" on={() => run(() => agdT('loanSaved', { n: giveLoan({ ...f, borrower_name: clients.find((c) => c[0] === f.borrower_id)?.[1] ?? '' } as never).number }))} data-agd-b="give-loan" />
      </div>
      {warn && <p className={controls.hint} role="alert">{warn}</p>}
      <Tbl
        head={['loan', 'date', 'borrower', 'principal', 'outstanding', 'interest', 'dueDate', '']}
        flag={loans.map((l) => over.has(l.id))}
        rows={loans.map((l) => { const s = loanState(l, day); return [l.number, l.date, l.borrower_name, fmt(l.principal), fmt(s.principal), fmt(s.interest), l.due_date ?? '', l.status === 'closed' ? agdT('closed') : l.repayments.length
          ? <B key="u" k="undo" on={() => run(() => { undoRepayment(l.id); return agdT('deleted'); })} />
          : <B key="d" k="delete" on={() => run(() => { deleteLoan(l.id); return agdT('deleted'); })} />]; })}
      />
      <h3>{agdT('repay')}</h3>
      <Form v={r} set={repayFor} f={[['loan', 'loan', loans.filter((l) => l.status === 'open').map((l) => [l.id, `${l.number} · ${l.borrower_name}`] as const)], ['date', 'date', 'd'], ['amount', 'amount', 'n', 120], ['by', 'paidBy', by]]}>
        <B k="repay" on={() => run(() => { const l = repayLoan(r.loan, r as never); return agdT(l.status === 'closed' ? 'loanClosed' : 'repaid', { n: l.number }); })} data-agd-b="repay" />
      </Form>
      <Hint k="loanNote" />
    </>
  );
}
