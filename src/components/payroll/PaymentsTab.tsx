import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  PAYMENT_LABELS,
  deletePayrollPayment,
  loadPayrollPayments,
  loadRuns,
  payableBalances,
  recordPayrollPayment,
} from '../../lib/payroll/store';
import { chartOf, loadUserAccounts } from '../../lib/ledger/accounts';
import { formatDate, todayInput } from '../../lib/utils';
import type { PayrollPaymentKind } from '../../types/payroll';
import { payrollT as pT } from '../../i18n/areas/payroll';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';
import { inr, parseAmount } from './shared';

interface Props {
  month: string;
  version: number;
  refresh: () => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

const KIND_KEY = { salary: 'ppay.salary', pf: 'ppay.pf', esi: 'ppay.esi', pt: 'ppay.pt', tds: 'ppay.tds' } as const;

export function PaymentsTab({ month, version, refresh, notify }: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runs = useMemo(() => loadRuns(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const payments = useMemo(() => loadPayrollPayments().sort((a, b) => b.date.localeCompare(a.date)), [version]);
  const cashBank = useMemo(() => chartOf(loadUserAccounts()).filter((a) => a.group === 'CASH_BANK'), []);
  const balances = payableBalances(runs, payments);
  const finals = runs.filter((r) => r.status === 'final').sort((a, b) => b.month.localeCompare(a.month));
  const [kind, setKind] = useState<PayrollPaymentKind>('salary');
  const [date, setDate] = useState(todayInput());
  const [amount, setAmount] = useState('');
  const [paidFrom, setPaidFrom] = useState('bank');
  const [runId, setRunId] = useState('');
  const [period, setPeriod] = useState(month);
  const [reference, setReference] = useState('');

  const submit = () => {
    try {
      const run = runId || finals[0]?.id || '';
      const p = recordPayrollPayment({
        kind,
        date,
        amount: parseAmount(amount) ?? 0,
        paid_from: paidFrom,
        ...(kind === 'salary' && run ? { run_id: run } : {}),
        ...(kind !== 'salary' && period ? { period } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      setAmount('');
      setReference('');
      refresh();
      notify(pT('ppay.saved', { number: p.number }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <div className={styles.stack}>
      <section className={surface.card}>
        <div className={surface.cardBody}>
          <h2 className={styles.h2}>{pT('ppay.outstanding')}</h2>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{pT('ppay.outstanding')}</caption>
              <thead><tr><th>{pT('ppay.kind')}</th><th className={styles.num}>{pT('ppay.due')}</th><th className={styles.num}>{pT('ppay.paid')}</th><th className={styles.num}>{pT('ppay.balance')}</th><th /></tr></thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.kind}>
                    <td>{pT(KIND_KEY[b.kind])}</td>
                    <td className={styles.num}>{inr(b.due)}</td>
                    <td className={styles.num}>{inr(b.paid)}</td>
                    <td className={`${styles.num} ${styles.strong}`}>{inr(b.balance)}</td>
                    <td className={styles.num}>
                      {b.balance > 0 && (
                        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => { setKind(b.kind); setAmount(String(b.balance)); }}>
                          {pT('ppay.payThis')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardBody}>
          <h2 className={styles.h2}>{pT('ppay.record')}</h2>
          <div className={styles.formGrid}>
            <label className={controls.field}>
              <span className={controls.label}>{pT('ppay.kind')}</span>
              <select className={controls.select} value={kind} onChange={(e) => setKind(e.target.value as PayrollPaymentKind)}>
                {(Object.keys(KIND_KEY) as PayrollPaymentKind[]).map((k) => <option key={k} value={k}>{pT(KIND_KEY[k])}</option>)}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('ppay.date')}</span>
              <input className={controls.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('ppay.amount')}</span>
              <input className={controls.inputNumeric} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('ppay.from')}</span>
              <select className={controls.select} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}>
                {cashBank.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {kind === 'salary' ? (
              <label className={controls.field}>
                <span className={controls.label}>{pT('ppay.run')}</span>
                <select className={controls.select} value={runId} onChange={(e) => setRunId(e.target.value)}>
                  {finals.map((r) => <option key={r.id} value={r.id}>{r.number} · {r.month}</option>)}
                </select>
              </label>
            ) : (
              <label className={controls.field}>
                <span className={controls.label}>{pT('ppay.period')}</span>
                <input className={controls.input} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
              </label>
            )}
            <label className={controls.field}>
              <span className={controls.label}>{pT('ppay.reference')}</span>
              <input className={controls.input} value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
          </div>
          <button type="button" className={controls.btnPrimary} onClick={submit}>
            <Plus size={15} /> {pT('ppay.recordBtn')}
          </button>
          <p className={styles.note}>{pT('ppay.hint')}</p>
        </div>
      </section>

      {payments.length > 0 && (
        <section className={surface.card}>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{pT('ppay.list')}</caption>
              <thead><tr><th>{pT('ppay.date')}</th><th>{pT('ppay.number')}</th><th>{pT('ppay.kind')}</th><th>{pT('ppay.reference')}</th><th className={styles.num}>{pT('ppay.amount')}</th><th /></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.date)}</td>
                    <td className={surface.mono}>{p.number}</td>
                    <td>{PAYMENT_LABELS[p.kind]}{p.period ? ` · ${p.period}` : ''}</td>
                    <td>{p.reference ?? ''}</td>
                    <td className={styles.num}>{inr(p.amount)}</td>
                    <td className={styles.num}>
                      <button
                        type="button"
                        className={controls.btnDanger}
                        aria-label={pT('ppay.delete', { number: p.number })}
                        onClick={() => {
                          try {
                            deletePayrollPayment(p.id);
                            refresh();
                            notify(pT('ppay.deleted'));
                          } catch (err) {
                            notify((err as Error).message, 'error');
                          }
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
