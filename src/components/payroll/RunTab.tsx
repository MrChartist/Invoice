import { useMemo, useState } from 'react';
import { CheckCircle2, FileText, IndianRupee, Lock, Printer, RefreshCw, Trash2, Unlock, Users, Wallet } from 'lucide-react';
import {
  autoFillRun,
  deleteRun,
  finalizeRun,
  loadRuns,
  reopenRun,
  runTotals,
  setRunOverride,
  updateRunDate,
} from '../../lib/payroll/store';
import { monthLabel, payslipHtml } from '../../lib/payroll/reports';
import { amountInWords } from '../../lib/amount-in-words';
import { formatDate } from '../../lib/utils';
import type { PayrollRun, PayslipLine } from '../../types/payroll';
import { StatCard } from '../ui/StatCard';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { openPrintable } from '../advances/print';
import { payrollT as pT } from '../../i18n/areas/payroll';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';
import { gridKeyDown, inr, parseAmount } from './shared';

interface Props {
  month: string;
  version: number;
  refresh: () => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

type Col = { id: string; name: string };

function columns(lines: PayslipLine[], pick: (l: PayslipLine) => { pay_head_id: string; name: string }[]): Col[] {
  const m = new Map<string, string>();
  for (const l of lines) for (const x of pick(l)) if (!m.has(x.pay_head_id)) m.set(x.pay_head_id, x.name);
  return [...m.entries()].map(([id, name]) => ({ id, name }));
}

export function RunTab({ month, version, refresh, notify }: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useMemo(() => loadRuns().find((r) => r.month === month) ?? null, [month, version]);
  const [skipped, setSkipped] = useState<{ month: string; list: string[] }>({ month, list: [] });
  const [slip, setSlip] = useState<PayslipLine | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const draft = run?.status === 'draft';

  const act = (fn: () => void, ok?: string) => {
    try {
      fn();
      refresh();
      if (ok) notify(ok);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const autofill = () =>
    act(() => {
      const r = autoFillRun(month);
      setSkipped({ month, list: r.skipped });
      notify(pT('run.filled', { n: r.run.lines.length }));
    });

  const commit = (r: PayrollRun, l: PayslipLine, headId: string, current: number, text: string) => {
    const v = parseAmount(text);
    if (v === null && l.overrides?.[headId] === undefined) return;
    if (v !== null && Math.abs(v - current) < 0.005) return;
    act(() => setRunOverride(r.id, l.employee_id, headId, v));
  };

  const earnCols = run ? columns(run.lines, (l) => l.earnings) : [];
  const dedCols = run ? columns(run.lines, (l) => l.deductions) : [];
  const t = run ? runTotals(run) : null;
  const skippedList = skipped.month === month ? skipped.list : [];
  const warnings = run ? run.lines.flatMap((l) => l.warnings ?? []) : [];

  const cell = (r: PayrollRun, l: PayslipLine, row: number, col: Col, list: PayslipLine['earnings']) => {
    const amount = list.find((x) => x.pay_head_id === col.id)?.amount ?? 0;
    if (!draft) return <td key={col.id} className={styles.num}>{amount ? inr(amount) : '—'}</td>;
    const overridden = l.overrides?.[col.id] !== undefined;
    return (
      <td key={col.id} className={styles.num}>
        <input
          key={`${col.id}-${amount}`}
          className={`${controls.inputNumeric} ${styles.cell} ${overridden ? styles.overridden : ''}`}
          type="number"
          step="0.01"
          inputMode="decimal"
          data-row={row}
          data-col={col.id}
          aria-label={`${col.name} · ${l.name}`}
          title={overridden ? pT('run.overridden') : undefined}
          defaultValue={amount ? String(amount) : ''}
          onKeyDown={gridKeyDown}
          onBlur={(e) => commit(r, l, col.id, amount, e.target.value)}
        />
      </td>
    );
  };

  return (
    <div className={styles.stack}>
      <section className={`${surface.card} no-print`}>
        <div className={styles.toolbar}>
          <div>
            <h2 className={styles.h2}>{pT('run.title', { month: monthLabel(month) })}</h2>
            <p className={styles.note}>
              {!run ? pT('run.notStarted') : run.status === 'final' ? pT('run.finalNote', { number: run.number, date: formatDate(run.date) }) : pT('run.draftNote')}
            </p>
          </div>
          <div className={styles.inline}>
            {(!run || draft) && (
              <button type="button" className={controls.btnOutline} onClick={autofill}>
                <RefreshCw size={15} /> {run ? pT('run.recompute') : pT('run.autofill')}
              </button>
            )}
            {run && draft && (
              <>
                <label className={controls.field}>
                  <span className={controls.label}>{pT('run.date')}</span>
                  <input className={controls.input} type="date" value={run.date} onChange={(e) => act(() => updateRunDate(run.id, e.target.value))} />
                </label>
                <button type="button" className={controls.btnPrimary} onClick={() => act(() => { const f = finalizeRun(run.id); notify(pT('run.finalized', { number: f.number })); })}>
                  <Lock size={15} /> {pT('run.finalize')}
                </button>
                <button type="button" className={controls.btnDanger} aria-label={pT('run.deleteDraft')} title={pT('run.deleteDraft')} onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={15} />
                </button>
              </>
            )}
            {run?.status === 'final' && (
              <button type="button" className={controls.btnOutline} onClick={() => act(() => reopenRun(run.id), pT('run.reopened'))}>
                <Unlock size={15} /> {pT('run.reopen')}
              </button>
            )}
          </div>
        </div>
      </section>

      {t && (
        <div className={surface.statGrid}>
          <StatCard label={pT('run.employees')} icon={Users} value={t.employees} />
          <StatCard label={pT('run.gross')} icon={IndianRupee} value={inr(t.gross)} />
          <StatCard label={pT('run.deductions')} icon={FileText} tone="warning" value={inr(t.deductions)} hint={pT('run.dedHint', { pf: inr(t.pf_ee), tds: inr(t.tds) })} />
          <StatCard label={pT('run.net')} icon={Wallet} tone="brand" value={inr(t.net)} />
          <StatCard label={pT('run.employer')} icon={CheckCircle2} tone="loss" value={inr(t.pf_er + t.pf_admin + t.esi_er)} hint={pT('run.ctc', { amount: inr(t.gross + t.pf_er + t.pf_admin + t.esi_er) })} />
        </div>
      )}

      {(skippedList.length > 0 || warnings.length > 0) && (
        <section className={surface.card}>
          <div className={surface.cardBody}>
            <ul className={styles.warnings}>
              {skippedList.map((s) => <li key={s}>{pT('run.skipped', { reason: s })}</li>)}
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </div>
        </section>
      )}

      <section className={surface.card}>
        {!run ? (
          <EmptyState icon={Wallet} title={pT('run.emptyTitle')} text={pT('run.emptyText')} />
        ) : (
          <div className={surface.tableWrap}>
            <table className={`${surface.table} ${styles.grid}`}>
              <caption className={surface.srOnly}>{pT('run.gridCaption', { month: monthLabel(month) })}</caption>
              <thead>
                <tr>
                  <th>{pT('f.name')}</th>
                  <th className={styles.num}>{pT('att.paid')}</th>
                  {earnCols.map((c) => <th key={c.id} className={styles.num}>{c.name}</th>)}
                  <th className={styles.num}>{pT('run.gross')}</th>
                  {dedCols.map((c) => <th key={c.id} className={styles.num}>{c.name}</th>)}
                  <th className={styles.num}>{pT('run.net')}</th>
                  <th className={styles.num}>{pT('run.payslip')}</th>
                </tr>
              </thead>
              <tbody>
                {run.lines.map((l, i) => (
                  <tr key={l.employee_id}>
                    <td>
                      {l.name}
                      <span className={styles.sub}>{l.code}{l.esi_covered ? ' · ESI' : ''}</span>
                    </td>
                    <td className={styles.num}>{l.payable_days}/{l.days_in_month}</td>
                    {earnCols.map((c) => cell(run, l, i, c, l.earnings))}
                    <td className={`${styles.num} ${styles.strong}`}>{inr(l.gross)}</td>
                    {dedCols.map((c) => cell(run, l, i, c, l.deductions))}
                    <td className={`${styles.num} ${styles.strong}`}>{inr(l.net)}</td>
                    <td className={styles.num}>
                      <button type="button" className={controls.btnIcon} aria-label={pT('run.viewSlip', { name: l.name })} title={pT('run.payslip')} onClick={() => setSlip(l)}>
                        <FileText size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {t && (
                <tfoot>
                  <tr>
                    <td colSpan={2 + earnCols.length}>{pT('total')}</td>
                    <td className={styles.num}>{inr(t.gross)}</td>
                    <td colSpan={dedCols.length} className={styles.num}>{inr(t.deductions)}</td>
                    <td className={styles.num}>{inr(t.net)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {draft && <p className={styles.note}>{pT('run.gridHint')}</p>}
      </section>

      {slip && run && (
        <Modal
          open
          onClose={() => setSlip(null)}
          size="md"
          title={pT('slip.title', { name: slip.name, month: monthLabel(run.month) })}
          footer={
            <>
              <button type="button" className={controls.btnGhost} onClick={() => setSlip(null)}>{pT('close')}</button>
              <button type="button" className={controls.btnPrimary} onClick={() => openPrintable(payslipHtml(run, slip), `payslip-${slip.code}-${run.month}`)}>
                <Printer size={15} /> {pT('slip.print')}
              </button>
            </>
          }
        >
          <div className={styles.slip}>
            <table className={surface.table}>
              <thead><tr><th>{pT('slip.earnings')}</th><th className={styles.num}>{pT('structures.amount')}</th></tr></thead>
              <tbody>{slip.earnings.map((x) => <tr key={x.pay_head_id}><td>{x.name}</td><td className={styles.num}>{inr(x.amount)}</td></tr>)}</tbody>
              <tfoot><tr><td>{pT('run.gross')}</td><td className={styles.num}>{inr(slip.gross)}</td></tr></tfoot>
            </table>
            <table className={surface.table}>
              <thead><tr><th>{pT('slip.deductions')}</th><th className={styles.num}>{pT('structures.amount')}</th></tr></thead>
              <tbody>{slip.deductions.map((x) => <tr key={x.pay_head_id}><td>{x.name}</td><td className={styles.num}>{inr(x.amount)}</td></tr>)}</tbody>
              <tfoot><tr><td>{pT('run.deductions')}</td><td className={styles.num}>{inr(slip.total_deductions)}</td></tr></tfoot>
            </table>
          </div>
          <p className={styles.netPay}>{pT('slip.net', { amount: inr(slip.net) })}</p>
          <p className={styles.note}>{amountInWords(Math.max(0, slip.net), 'INR')}</p>
          {slip.tds_working && (
            <p className={styles.note}>
              {pT('slip.tdsWorking', { income: inr(slip.tds_working.annual_income), tax: inr(slip.tds_working.annual_tax), before: inr(slip.tds_working.deducted_before), months: slip.tds_working.months_left })}
            </p>
          )}
        </Modal>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={pT('run.deleteDraft')}
        message={pT('run.deleteText', { month: monthLabel(month) })}
        confirmLabel={pT('delete')}
        destructive
        onConfirm={() => {
          if (run) act(() => deleteRun(run.id), pT('run.deleted'));
          setConfirmDelete(false);
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
