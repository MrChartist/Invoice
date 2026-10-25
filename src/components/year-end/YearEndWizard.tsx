/**
 * "Start new year" (WP-7, P1-20). Lazy: load with
 *   const YearEndWizard = lazy(() => import('../year-end/YearEndWizard').then((m) => ({ default: m.YearEndWizard })));
 * The checklist from `year-end.ts`, with the actions each step needs.
 */
import { useMemo, useState } from 'react';
import { CalendarCheck, Download, Lock, Plus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useCan } from '../../hooks/useCan';
import { useT } from '../../i18n';
import { migT } from '../../i18n/areas/migration';
import { isoDay } from '../../lib/dates';
import { downloadText } from '../../lib/download';
import { fyStartYearOf } from '../../lib/books';
import { groupOf } from '../../lib/ledger/accounts';
import { rupeesToPaise } from '../../lib/ledger/vouchers';
import { carryForward, carryForwardCsv, fyEndOf, fyId, type YearEndStepId } from '../../lib/year-end';
import { loadYearEnd, lockYear, postClosingStock, postProvisions, saveYearEndMark } from '../../lib/year-end-store';
import controls from '../../styles/controls.module.css';
import styles from '../import/TallyImport.module.css';

export interface YearEndWizardProps {
  open: boolean;
  onClose: () => void;
  notify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const rs = (p: number) => `₹${(Math.abs(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function YearEndWizard({ open, onClose, notify }: YearEndWizardProps) {
  useT();
  const { can } = useCan();
  const today = isoDay(new Date());
  const current = fyStartYearOf(today);
  // Default: the year that ended most recently (April–September usually closes last year).
  const [fy, setFy] = useState(() => (Number(today.slice(5, 7)) <= 9 ? current - 1 : current));
  const [version, setVersion] = useState(0);
  const [showIssues, setShowIssues] = useState(false);
  const [stockValue, setStockValue] = useState('');
  const [prov, setProv] = useState<Array<{ account_id: string; amount: string }>>([{ account_id: '', amount: '' }]);
  const [reverse, setReverse] = useState(true);
  const [error, setError] = useState('');

  const state = useMemo(() => {
    void version;
    return open ? loadYearEnd(fy) : null;
  }, [fy, version, open]);

  const refresh = () => setVersion((v) => v + 1);
  const act = (fn: () => string | void) => {
    setError('');
    try {
      const msg = fn();
      if (msg) notify?.(msg, 'success');
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const expenseAccounts = state ? state.ledger.accounts.filter((a) => groupOf(a.group).nature === 'expense') : [];
  const carry = state ? carryForward(state.ledger, fy) : null;
  const mark = (id: YearEndStepId) => act(() => void saveYearEndMark(fy, id));

  const actions = (id: YearEndStepId, amount?: number) => {
    switch (id) {
      case 'integrity':
        return state && state.integrity.issues.length > 0 ? (
          <>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setShowIssues((s) => !s)}>{migT('showIssues', { n: state.integrity.issues.length })}</button>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => mark('integrity')}>{migT('markReviewed')}</button>
            {showIssues && (
              <ul className={styles.list}>
                {state.integrity.issues.map((i, n) => <li key={n} className={i.severity === 'error' ? styles.badText : undefined}>{i.message}</li>)}
              </ul>
            )}
          </>
        ) : null;
      case 'closing_stock':
        return (
          <div className={styles.inline}>
            <label className={controls.field}>
              <span className={controls.label}>{migT('stockValue')}</span>
              <input className={controls.input} inputMode="decimal" value={stockValue} placeholder={amount ? (amount / 100).toFixed(2) : '0.00'} onChange={(e) => setStockValue(e.target.value)} />
            </label>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`}
              onClick={() => act(() => migT('posted', { number: postClosingStock(fy, stockValue ? rupeesToPaise(stockValue) : amount ?? 0, true).number }))}>
              {migT('postStock')}
            </button>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => mark('closing_stock')}>{migT('markReviewed')}</button>
            <span className={styles.muted}>{migT('stockHint')}</span>
          </div>
        );
      case 'provisions':
        return (
          <div className={styles.stack}>
            {prov.map((p, i) => (
              <div key={i} className={styles.inline}>
                <label className={controls.field}>
                  <span className={controls.label}>{migT('provAccount')}</span>
                  <select className={controls.select} value={p.account_id} onChange={(e) => setProv(prov.map((x, n) => (n === i ? { ...x, account_id: e.target.value } : x)))}>
                    <option value="">—</option>
                    {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </select>
                </label>
                <label className={controls.field}>
                  <span className={controls.label}>{migT('provAmount')}</span>
                  <input className={controls.input} inputMode="decimal" value={p.amount} onChange={(e) => setProv(prov.map((x, n) => (n === i ? { ...x, amount: e.target.value } : x)))} />
                </label>
              </div>
            ))}
            <div className={styles.inline}>
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setProv([...prov, { account_id: '', amount: '' }])}><Plus size={14} aria-hidden="true" /> {migT('addLine')}</button>
              <label className={controls.check}><input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} /> {migT('reverseNextDay')}</label>
              <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`}
                disabled={!prov.some((p) => p.account_id && rupeesToPaise(p.amount) > 0)}
                onClick={() => act(() => {
                  const v = postProvisions(fy, prov.filter((p) => p.account_id && rupeesToPaise(p.amount) > 0).map((p) => ({ account_id: p.account_id, amount: rupeesToPaise(p.amount) })), reverse);
                  setProv([{ account_id: '', amount: '' }]);
                  return migT('posted', { number: v.number });
                })}>
                {migT('postProvisions')}
              </button>
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => mark('provisions')}>{migT('markReviewed')}</button>
            </div>
          </div>
        );
      case 'opening_bills':
        return <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => mark('opening_bills')}>{migT('markReviewed')}</button>;
      case 'lock':
        return can('settings.manage') ? (
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => act(() => migT('locked', { date: lockYear(fy) }))}>
            <Lock size={14} aria-hidden="true" /> {migT('lockNow', { fy: fyId(fy), date: fyEndOf(fy) })}
          </button>
        ) : <span className={styles.muted}>{migT('lockOwner')}</span>;
      case 'carry_forward':
        return carry ? (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>{migT('colLedger')}</th><th className={styles.num}>Dr</th><th className={styles.num}>Cr</th></tr></thead>
                <tbody>
                  {carry.rows.map((r) => (
                    <tr key={r.account.id}><td>{r.account.code} · {r.account.name}</td><td className={styles.num}>{r.balance > 0 ? rs(r.balance) : ''}</td><td className={styles.num}>{r.balance < 0 ? rs(r.balance) : ''}</td></tr>
                  ))}
                  <tr><td><strong>Total</strong></td><td className={styles.num}><strong>{rs(carry.dr)}</strong></td><td className={styles.num}><strong>{rs(carry.cr)}</strong></td></tr>
                </tbody>
              </table>
            </div>
            <p className={styles.muted}>{migT('carryProfit', { label: carry.profit >= 0 ? migT('profit') : migT('loss'), amount: rs(carry.profit) })}</p>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => {
              downloadText(`opening-balances-${fyId(fy + 1)}.csv`, '﻿' + carryForwardCsv(carry, fy), 'text/csv');
              mark('carry_forward');
            }}>
              <Download size={14} aria-hidden="true" /> {migT('downloadCsv')}
            </button>
          </>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="xl" title={<><CalendarCheck size={18} aria-hidden="true" /> {migT('yeTitle')}</>} subtitle={migT('yeSubtitle', { fy: fyId(fy) })}
      footer={<div className={styles.footer}><button type="button" className={`${controls.btnPrimary} ${controls.btn}`} onClick={onClose}>{migT('close')}</button></div>}>
      <div className={styles.stack}>
        <label className={controls.field} style={{ maxWidth: '14rem' }}>
          <span className={controls.label}>{migT('yeYear')}</span>
          <select className={controls.select} value={fy} onChange={(e) => setFy(Number(e.target.value))}>
            {[current, current - 1, current - 2, current - 3].map((y) => <option key={y} value={y}>{fyId(y)}</option>)}
          </select>
        </label>
        {error && <p className={styles.errBox} role="alert">{error}</p>}
        {state?.steps.map((s, i) => (
          <section key={s.id} className={styles.step} aria-label={migT(`s_${s.id}`)}>
            <div className={styles.stepHead}>
              <span className={styles.stepTitle}>{i + 1}. {migT(`s_${s.id}`)}</span>
              <span className={s.status === 'done' ? styles.chipOk : s.status === 'warn' ? styles.chipBad : styles.chipWarn}>
                {migT(s.status === 'done' ? 'stDone' : s.status === 'warn' ? 'stWarn' : 'stTodo')}
              </span>
            </div>
            <ul className={styles.facts}>{s.facts.map((f) => <li key={f}>{f}</li>)}</ul>
            {actions(s.id, s.amount)}
          </section>
        ))}
        <p className={styles.muted}>{migT('caNote')}</p>
      </div>
    </Modal>
  );
}
