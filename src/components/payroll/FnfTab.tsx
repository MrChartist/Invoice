import { useMemo, useState } from 'react';
import { BookCheck, FileText, Pencil, Plus, Save, Trash2, UserMinus } from 'lucide-react';
import { loadEmployees, loadPayHeads, loadRuns, loadStructures } from '../../lib/payroll/store';
import { deleteFnf, loadFnf, loadLeaveEntries, loadLeaveTypes, loadLoans, postProvisionJournal, saveFnf, type FnfInput } from '../../lib/payroll/depth-store';
import { encashableBalance, fnfWorking } from '../../lib/payroll/depth';
import { fnfStatementHtml, gratuityProvisionRows } from '../../lib/payroll/depth-reports';
import { monthLabel } from '../../lib/payroll/reports';
import { lastDayOfMonth } from '../../lib/payroll/statutory';
import { formatDate } from '../../lib/utils';
import type { Employee, FnfReason, FnfSettlement } from '../../types/payroll';
import { EmptyState } from '../ui/EmptyState';
import { openPrintable } from '../advances/print';
import { payrollT as pT } from '../../i18n/areas/payroll';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';
import { Out } from './Out';
import { inr, parseAmount, runAction, type TabProps } from './shared';

const REASONS: FnfReason[] = ['resignation', 'retirement', 'termination', 'death'];
const REASON_KEY = { resignation: 'fnf.r.resignation', retirement: 'fnf.r.retirement', termination: 'fnf.r.termination', death: 'fnf.r.death' } as const;
const NOTICE_KEY = { none: 'fnf.n.none', recover: 'fnf.n.recover', pay: 'fnf.n.pay' } as const;

type Draft = Omit<FnfInput, 'notice_amount' | 'leave_amount' | 'gratuity_amount' | 'notice_days' | 'leave_days'> & { notice_days: string; leave_days: string; notice_amount: string; leave_amount: string; gratuity_amount: string };

const toDraft = (f: FnfSettlement | null, e: Employee | undefined, month: string, balance: number): Draft => ({
  ...(f ? { id: f.id } : {}),
  employee_id: f?.employee_id ?? e?.id ?? '',
  reason: f?.reason ?? 'resignation',
  pay_month: f?.pay_month ?? (e?.dol && e.dol.slice(0, 7) > month ? e.dol.slice(0, 7) : month),
  notice_mode: f?.notice_mode ?? 'none',
  notice_days: String(f?.notice_days ?? ''),
  notice_amount: f?.notice_amount !== undefined ? String(f.notice_amount) : '',
  leave_days: String(f?.leave_days ?? balance),
  leave_amount: f?.leave_amount !== undefined ? String(f.leave_amount) : '',
  gratuity_amount: f?.gratuity_amount !== undefined ? String(f.gratuity_amount) : '',
  recover_loans: f?.recover_loans ?? true,
  other: f?.other ?? [],
  ...(f?.note ? { note: f.note } : {}),
});

/** Full & final settlement (7P) and the gratuity provision working. */
export function FnfTab({ month, version, refresh, notify }: TabProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const employees = useMemo(() => loadEmployees(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const settlements = useMemo(() => loadFnf(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ctx = useMemo(() => ({ structures: loadStructures(), heads: loadPayHeads(), runs: loadRuns(), loans: loadLoans(), leaveTypes: loadLeaveTypes(), leaveEntries: loadLeaveEntries() }), [version]);
  const leavers = employees.filter((e) => e.dol);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [asOf, setAsOf] = useState(lastDayOfMonth(month));
  const [journal, setJournal] = useState('');
  const name = new Map(employees.map((e) => [e.id, `${e.code} · ${e.name}`]));
  const grat = gratuityProvisionRows(employees, ctx.structures, ctx.heads, asOf);

  const startFor = (e: Employee | undefined, f: FnfSettlement | null = null) =>
    setDraft(toDraft(f, e, month, e?.dol ? encashableBalance(e, e.dol.slice(0, 7), ctx.leaveTypes, ctx.leaveEntries) : 0));
  const num = (v: string) => parseAmount(v) ?? undefined;
  const toInput = (d: Draft): FnfInput => ({
    ...(d.id ? { id: d.id } : {}),
    employee_id: d.employee_id,
    reason: d.reason,
    pay_month: d.pay_month,
    notice_mode: d.notice_mode,
    notice_days: num(d.notice_days) ?? 0,
    ...(num(d.notice_amount) !== undefined ? { notice_amount: num(d.notice_amount) } : {}),
    leave_days: num(d.leave_days) ?? 0,
    ...(num(d.leave_amount) !== undefined ? { leave_amount: num(d.leave_amount) } : {}),
    ...(num(d.gratuity_amount) !== undefined ? { gratuity_amount: num(d.gratuity_amount) } : {}),
    recover_loans: d.recover_loans,
    other: d.other.filter((o) => o.name.trim() && o.amount > 0),
    ...(d.note?.trim() ? { note: d.note.trim() } : {}),
  });
  const draftEmp = draft ? employees.find((e) => e.id === draft.employee_id) : undefined;
  let working: ReturnType<typeof fnfWorking> | null = null;
  if (draft && draftEmp?.dol) {
    try {
      working = fnfWorking({ ...toInput(draft), id: draft.id ?? 'draft', number: '', created_at: '' }, draftEmp, ctx);
    } catch {
      working = null;
    }
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((p) => (p ? { ...p, [k]: v } : p));

  const statement = (f: FnfSettlement) => {
    const e = employees.find((x) => x.id === f.employee_id);
    if (!e) return;
    const run = ctx.runs.find((r) => r.month === f.pay_month) ?? null;
    const line = run?.lines.find((l) => l.employee_id === e.id) ?? null;
    openPrintable(fnfStatementHtml(f, e, fnfWorking(f, e, ctx), line, run, run?.company), `full-and-final-${e.code}`);
  };
  const status = (f: FnfSettlement) => {
    const run = ctx.runs.find((r) => r.month === f.pay_month);
    if (!run || !run.lines.some((l) => l.employee_id === f.employee_id)) return pT('fnf.st.none');
    return run.status === 'final' ? pT('fnf.st.final', { number: run.number }) : pT('fnf.st.draft');
  };

  return (
    <div className={styles.stack}>
      <section className={surface.card}>
        <div className={styles.toolbar}>
          <div>
            <h2 className={styles.h2}>{pT('fnf.title')}</h2>
            <p className={styles.note}>{pT('fnf.hint')}</p>
          </div>
          {!draft && leavers.length > 0 && (
            <button type="button" className={controls.btnPrimary} onClick={() => startFor(leavers[0])}><Plus size={15} /> {pT('fnf.new')}</button>
          )}
        </div>
        {leavers.length === 0 && !draft && <EmptyState icon={UserMinus} title={pT('fnf.noLeavers')} text={pT('fnf.noLeaversText')} />}
        {draft && (
          <div className={surface.cardBody}>
            <div className={styles.formGrid}>
              <label className={controls.field}>
                <span className={controls.label}>{pT('rep.employee')}</span>
                <select className={controls.select} value={draft.employee_id} disabled={!!draft.id} onChange={(e) => startFor(employees.find((x) => x.id === e.target.value))}>
                  {leavers.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name} ({formatDate(e.dol!)})</option>)}
                </select>
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{pT('fnf.reason')}</span>
                <select className={controls.select} value={draft.reason} onChange={(e) => set('reason', e.target.value as FnfReason)}>
                  {REASONS.map((r) => <option key={r} value={r}>{pT(REASON_KEY[r])}</option>)}
                </select>
              </label>
              <label className={controls.field}><span className={controls.label}>{pT('fnf.payMonth')}</span><input className={controls.input} type="month" value={draft.pay_month} onChange={(e) => set('pay_month', e.target.value)} /></label>
              <label className={controls.field}>
                <span className={controls.label}>{pT('fnf.notice')}</span>
                <select className={controls.select} value={draft.notice_mode} onChange={(e) => set('notice_mode', e.target.value as Draft['notice_mode'])}>
                  {(['none', 'recover', 'pay'] as const).map((n) => <option key={n} value={n}>{pT(NOTICE_KEY[n])}</option>)}
                </select>
              </label>
              {draft.notice_mode !== 'none' && (
                <>
                  <label className={controls.field}><span className={controls.label}>{pT('fnf.noticeDays')}</span><input className={controls.inputNumeric} type="number" min="0" step="1" value={draft.notice_days} onChange={(e) => set('notice_days', e.target.value)} /></label>
                  <label className={controls.field}><span className={controls.label}>{pT('fnf.noticeAmount')}</span><input className={controls.inputNumeric} type="number" min="0" step="0.01" value={draft.notice_amount} placeholder={working ? String(working.notice.amount) : ''} onChange={(e) => set('notice_amount', e.target.value)} /></label>
                </>
              )}
              <label className={controls.field}>
                <span className={controls.label}>{pT('fnf.leaveDays')}</span>
                <input className={controls.inputNumeric} type="number" min="0" step="0.5" value={draft.leave_days} onChange={(e) => set('leave_days', e.target.value)} />
                {working && <span className={controls.hint}>{pT('fnf.leaveBalance', { days: working.leave.balance })}</span>}
              </label>
              <label className={controls.field}><span className={controls.label}>{pT('fnf.leaveAmount')}</span><input className={controls.inputNumeric} type="number" min="0" step="0.01" value={draft.leave_amount} placeholder={working ? String(working.leave.amount) : ''} onChange={(e) => set('leave_amount', e.target.value)} /></label>
              <label className={controls.field}>
                <span className={controls.label}>{pT('fnf.gratuity')}</span>
                <input className={controls.inputNumeric} type="number" min="0" step="0.01" value={draft.gratuity_amount} placeholder={working ? String(working.gratuity.amount) : ''} onChange={(e) => set('gratuity_amount', e.target.value)} />
                {working && <span className={controls.hint}>{pT('fnf.gratuityAuto', { amount: inr(working.gratuity.amount), years: working.gratuity.service.gratuity_years })}</span>}
              </label>
              <label className={controls.field}><span className={controls.label}>{pT('fnf.note')}</span><input className={controls.input} value={draft.note ?? ''} onChange={(e) => set('note', e.target.value)} /></label>
            </div>
            <div className={styles.checks}>
              <label className={controls.check}><input type="checkbox" checked={draft.recover_loans} onChange={(e) => set('recover_loans', e.target.checked)} /> {pT('fnf.recoverLoans')}</label>
            </div>
            <fieldset className={styles.fieldset}>
              <legend>{pT('fnf.other')}</legend>
              {draft.other.map((o, i) => (
                <div key={i} className={styles.inline}>
                  <input className={controls.input} aria-label={pT('ext.desc')} value={o.name} onChange={(e) => set('other', draft.other.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <select className={controls.select} aria-label={pT('ext.kind')} value={o.kind} onChange={(e) => set('other', draft.other.map((x, j) => (j === i ? { ...x, kind: e.target.value as 'earning' | 'deduction' } : x)))}>
                    <option value="earning">{pT('ext.earning')}</option>
                    <option value="deduction">{pT('ext.deduction')}</option>
                  </select>
                  <input className={controls.inputNumeric} type="number" min="0" step="0.01" aria-label={pT('loan.amount')} value={o.amount || ''} onChange={(e) => set('other', draft.other.map((x, j) => (j === i ? { ...x, amount: parseAmount(e.target.value) ?? 0 } : x)))} />
                  <button type="button" className={controls.btnIcon} aria-label={pT('delete')} onClick={() => set('other', draft.other.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                </div>
              ))}
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => set('other', [...draft.other, { name: '', kind: 'earning', amount: 0 }])}><Plus size={14} /> {pT('fnf.addOther')}</button>
            </fieldset>
            {working && (
              <ul className={styles.chips}>
                <li className={styles.chip}>{pT('fnf.w.service', { y: working.gratuity.service.years, m: working.gratuity.service.months, d: working.gratuity.service.days })}</li>
                <li className={styles.chip}>{pT('fnf.w.basic', { amount: inr(working.basic_da) })}</li>
                <li className={styles.chip}>{pT('fnf.w.gratuity', { amount: inr(working.gratuity.paid), exempt: inr(working.gratuity.exempt) })}</li>
                <li className={styles.chip}>{pT('fnf.w.leave', { amount: inr(working.leave.amount), exempt: inr(working.leave.exempt) })}</li>
                {working.notice.mode !== 'none' && <li className={styles.chip}>{pT(working.notice.mode === 'recover' ? 'fnf.w.noticeRecover' : 'fnf.w.noticePay', { amount: inr(working.notice.amount) })}</li>}
                {working.loans.map((l) => <li key={l.loan_id} className={styles.chip}>{pT('fnf.w.loan', { number: l.number, amount: inr(l.outstanding + l.interest) })}</li>)}
                {!working.gratuity.eligible && <li className={styles.chip}>{pT(working.gratuity.borderline ? 'fnf.w.borderline' : 'fnf.w.notEligible')}</li>}
              </ul>
            )}
            <div className={styles.inline}>
              <button type="button" className={controls.btnPrimary} onClick={() => runAction(() => { saveFnf(toInput(draft)); setDraft(null); }, refresh, notify, pT('fnf.saved'))}><Save size={15} /> {pT('fnf.save')}</button>
              <button type="button" className={controls.btnGhost} onClick={() => setDraft(null)}>{pT('cancel')}</button>
            </div>
            <p className={styles.note}>{pT('fnf.runHint')}</p>
          </div>
        )}
        {settlements.length > 0 && (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{pT('fnf.list')}</caption>
              <thead><tr><th>{pT('ppay.number')}</th><th>{pT('rep.employee')}</th><th>{pT('fnf.reason')}</th><th>{pT('fnf.payMonth')}</th><th>{pT('f.status')}</th><th /></tr></thead>
              <tbody>
                {settlements.map((f) => (
                  <tr key={f.id}>
                    <td className={surface.mono}>{f.number}</td>
                    <td>{name.get(f.employee_id) ?? ''}</td>
                    <td>{pT(REASON_KEY[f.reason])}</td>
                    <td>{monthLabel(f.pay_month)}</td>
                    <td>{status(f)}</td>
                    <td>
                      <span className={styles.rowActions}>
                        <button type="button" className={controls.btnIcon} aria-label={pT('fnf.statement', { number: f.number })} title={pT('fnf.statement', { number: f.number })} onClick={() => statement(f)}><FileText size={15} /></button>
                        <button type="button" className={controls.btnIcon} aria-label={pT('edit')} title={pT('edit')} onClick={() => startFor(employees.find((e) => e.id === f.employee_id), f)}><Pencil size={15} /></button>
                        <button type="button" className={controls.btnDanger} aria-label={pT('fnf.delete', { number: f.number })} title={pT('fnf.delete', { number: f.number })} onClick={() => runAction(() => deleteFnf(f.id), refresh, notify, pT('fnf.deleted'))}><Trash2 size={15} /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={surface.card}>
        <div className={surface.cardBody}>
          <div className={styles.toolbar}>
            <h2 className={styles.h2}>{pT('grat.title')}</h2>
            <Out base={`gratuity-provision-${asOf}`} rows={() => grat.rows} sheet="Gratuity" />
          </div>
          <div className={styles.formGrid}>
            <label className={controls.field}><span className={controls.label}>{pT('grat.asOf')}</span><input className={controls.input} type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} /></label>
          </div>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{pT('grat.title')}</caption>
              <thead><tr><th>{pT('rep.employee')}</th><th>{pT('f.doj')}</th><th className={styles.num}>{pT('grat.years')}</th><th className={styles.num}>{pT('grat.basic')}</th><th className={styles.num}>{pT('grat.accrued')}</th><th>{pT('grat.eligible')}</th></tr></thead>
              <tbody>
                {grat.rows.slice(1, -3).map((r) => (
                  <tr key={String(r[0])}>
                    <td>{r[0]}</td><td>{r[1]}</td><td className={styles.num}>{r[3]}</td><td className={styles.num}>{inr(Number(r[4]))}</td><td className={styles.num}>{inr(Number(r[5]))}</td><td>{r[6]}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4}>{pT('total')}</td><td className={styles.num}>{inr(grat.total)}</td><td /></tr></tfoot>
            </table>
          </div>
          <div className={styles.inline}>
            <label className={controls.field}>
              <span className={controls.label}>{pT('grat.journalAmount')}</span>
              <input className={controls.inputNumeric} type="number" step="0.01" value={journal} placeholder={String(grat.total)} onChange={(e) => setJournal(e.target.value)} />
            </label>
            <button type="button" className={controls.btnOutline} disabled={!(parseAmount(journal) ?? grat.total)} onClick={() => runAction(() => { const v = postProvisionJournal('gratuity', asOf, parseAmount(journal) ?? grat.total); setJournal(''); notify(pT('ext.provisionDone', { number: v.number })); }, refresh, notify)}>
              <BookCheck size={15} /> {pT('grat.post')}
            </button>
          </div>
          <p className={styles.note}>{pT('grat.hint')}</p>
        </div>
      </section>
    </div>
  );
}
