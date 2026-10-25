/**
 * "Set-off & payment" tab of the GST reports page (WP-6, P0-6): liability vs ITC vs cash for the GSTR-3B period,
 * the set-off journal (posted through `saveVoucher`) and the PMT-06 challan list. Lazy-loaded.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { AlertTriangle, BookCheck, Plus, Trash2 } from 'lucide-react';
import type { Gstr3bReport, ReportPeriod } from '../../lib/gst-reports';
import { periodLabel, periodRange } from '../../lib/gst-reports';
import {
  GST_HEADS,
  GST_HEAD_LABELS,
  carryForwardFor,
  cashLedgerBalance,
  challanFromPlan,
  creditLedgerBalance,
  deleteSetOff,
  loadGstChallans,
  loadSetOffs,
  periodPaymentStatus,
  planSetOff,
  setOffFor,
  sumHeads,
  threeBDue,
  type ChallanAmounts,
} from '../../lib/gst-setoff';
import { cashLedgerDetail, detailByHead, loadPmt09, loadRefunds } from '../../lib/gst-cash-refunds';
import { GST_SETOFF_RULES, todayIso } from '../../lib/tax-rules';
import { localDb } from '../../lib/localDb';
import type { FilerFrequency } from '../../lib/compliance';
import { formatDate, formatMoney } from '../../lib/utils';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import local from './gst-reports.module.css';
import styles from './gst-setoff.module.css';
import { useT } from '../../i18n';
import { soT } from '../../i18n/areas/gst-setoff';
import { ChallanList } from './ChallanList';
import { o7T } from '../../i18n/areas/gst-tds-7o';

const SetOffDialog = lazy(() => import('./SetOffDialog'));

export interface SetOffPanelProps {
  report: Gstr3bReport;
  period: ReportPeriod;
  gstin: string;
  stateCode: string;
  /** Preceding-FY aggregate turnover (₹), for the late-fee cap. */
  turnover: number;
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

const m = (n: number) => formatMoney(n);

export function SetOffPanel({ report, period, gstin, stateCode, turnover, notify }: SetOffPanelProps) {
  useT();
  const [frequency, setFrequency] = useState<FilerFrequency>(() => {
    const f = localDb.settings.get().gst_filing_frequency;
    return f === 'qrmp' ? 'qrmp' : 'monthly';
  });
  const due = useMemo(() => threeBDue(period, frequency, stateCode), [period, frequency, stateCode]);
  const today = todayIso();
  const [paidOn, setPaidOn] = useState<string>('');
  const effectivePaidOn = paidOn || (due.due && today > due.due ? today : due.due || today);
  const [withInterest, setWithInterest] = useState(true);
  const [withFee, setWithFee] = useState(true);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [challanSeed, setChallanSeed] = useState<{ amounts: ChallanAmounts; periodKey: string } | null>(null);

  const [withCarry, setWithCarry] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` re-reads the tables after a change
  const challans = useMemo(() => loadGstChallans(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setoffs = useMemo(() => loadSetOffs(), [version]);
  // 7O (7.91): unutilised ITC of the last posted set-off joins this period's credit.
  const carry = useMemo(() => carryForwardFor(setoffs, periodRange(period).from, gstin), [setoffs, period, gstin]);
  const plan = useMemo(
    () => planSetOff(report, { period, due: due.form === 'GSTR3B' ? due.due : '', paidOn: effectivePaidOn, turnover, includeInterest: withInterest, includeLateFee: withFee, ...(withCarry ? { openingItc: carry.heads } : {}) }),
    [report, period, due, effectivePaidOn, turnover, withInterest, withFee, withCarry, carry],
  );
  const record = setOffFor(setoffs, plan.periodKey, gstin);
  const credit = creditLedgerBalance(setoffs, gstin);
  const status = periodPaymentStatus(plan, challans, setoffs, gstin);
  // 7R (7.121): PMT-09 transfers move money between heads and filed cash refunds take it out.
  const transfers = loadPmt09();
  const refunds = loadRefunds();
  const balance = transfers.length || refunds.length ? detailByHead(cashLedgerDetail(challans, setoffs, transfers, refunds)) : cashLedgerBalance(challans, setoffs);
  const balanceForPeriod = transfers.length || refunds.length ? detailByHead(cashLedgerDetail(challans, setoffs.filter((r) => r !== record), transfers, refunds)) : cashLedgerBalance(challans, setoffs.filter((r) => r !== record));
  const label = periodLabel(period);
  const isFy = period.kind === 'fy';
  const oldOrder = plan.from < '2019-03-29';

  const refresh = () => setVersion((v) => v + 1);

  const rows = GST_HEADS.map((h) => ({
    h,
    liability: plan.liability[h],
    rc: plan.rcLiability[h],
    opening: plan.itcOpening?.[h] ?? 0,
    itc: plan.itcAvailable[h],
    used: plan.itcUsed[h],
    carry: plan.itcCarry[h],
    cash: plan.cashTax[h],
    interest: plan.interest[h],
    fee: plan.lateFee[h],
    total: plan.totalCash[h],
    balance: balanceForPeriod[h],
  }));
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0);

  const doDelete = () => {
    if (!record) return;
    try {
      deleteSetOff(record.id);
      notify(soT('deleted'), 'success');
      refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  return (
    <div className={local.tabBody} style={{ padding: 0 }} data-gst-setoff>
      <div className={`${surface.card} ${local.disclaimer}`} role="note">
        <AlertTriangle size={16} aria-hidden style={{ flexShrink: 0, color: 'var(--warning)' }} />
        <span>{soT('disclaimer')}</span>
      </div>

      {isFy ? (
        <p className={surface.sectionNote}>{soT('fyNotAllowed')}</p>
      ) : (
        <>
          <div className={styles.bar}>
            <label>
              {soT('frequency')}
              <select className={controls.select} value={frequency} onChange={(e) => setFrequency(e.target.value as FilerFrequency)} disabled={period.kind === 'quarter'}>
                <option value="monthly">{soT('freqMonthly')}</option>
                <option value="qrmp">{soT('freqQrmp')}</option>
              </select>
            </label>
            <label>
              {soT('paidOn')}
              <input type="date" className={controls.input} value={effectivePaidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </label>
            <div className={styles.checks}>
              <label className={controls.check}>
                <input type="checkbox" checked={withInterest} onChange={(e) => setWithInterest(e.target.checked)} /> {soT('inclInterest')}
              </label>
              <label className={controls.check}>
                <input type="checkbox" checked={withFee} onChange={(e) => setWithFee(e.target.checked)} /> {soT('inclLateFee')}
              </label>
              <label className={controls.check}>
                <input type="checkbox" checked={withCarry} onChange={(e) => setWithCarry(e.target.checked)} /> {o7T('inclCarry')}
              </label>
            </div>
            {due.due && <span className={styles.muted}>{soT('dueOn', { form: due.form === 'PMT06' ? 'PMT-06' : 'GSTR-3B', date: formatDate(due.due) })}</span>}
          </div>
          <p className={styles.muted}>{soT('turnoverHint')}</p>

          <div className={surface.statGrid}>
            <Stat label={soT('statToPay')} value={m(status.toPay)} hint={soT('statToPayHint')} />
            <Stat label={soT('statDeposited')} value={m(status.deposited)} hint={soT('statDepositedHint', { n: challans.filter((c) => c.period_key === plan.periodKey && c.deposited_on).length, pending: status.pendingChallans })} />
            <Stat label={soT('statBalance')} value={m(sumHeads(balance))} hint={soT('statBalanceHint')} />
            <Stat label={soT('statShortfall')} value={m(sumHeads(status.shortfall))} hint={soT('statShortfallHint')} />
            <Stat label={o7T('statCredit')} value={m(sumHeads(credit))} hint={o7T('statCreditHint')} />
            <Stat label={soT('statPosted')} value={record ? '✓' : '—'} hint={record ? soT('statPostedYes', { number: record.voucher_number, date: formatDate(record.date) }) : soT('statPostedNo')} />
          </div>

          {plan.daysLate > 0 && <div className={styles.warn} role="status"><AlertTriangle size={16} aria-hidden /> {soT('wDaysLate', { days: plan.daysLate })}</div>}
          {plan.warnings.filter((w) => w !== 'NOT_A_3B_PERIOD' && w !== 'NEGATIVE_NET_ITC').map((w) => (
            <div key={w} className={styles.warn} role="status">
              <AlertTriangle size={16} aria-hidden /> {soT(`w${w}` as 'wRULE_86B')}
            </div>
          ))}
          {plan.itcNegative && (
            <div className={styles.warn} role="status" data-negative-itc>
              <AlertTriangle size={16} aria-hidden /> {o7T('wNegativeItc', { amount: m(sumHeads(plan.itcNegative)) })}
            </div>
          )}
          {withCarry && carry.fromKey && (
            <p className={styles.muted} data-itc-carry>
              {o7T('carryFrom', { period: carry.fromKey, amount: m(sumHeads(carry.heads)) })}
              {carry.notes.includes('CARRY_GAP') && ` ${o7T('carryGap')}`}
              {carry.notes.includes('CARRY_UNKNOWN') && ` ${o7T('carryUnknown')}`}
            </p>
          )}

          <div className={styles.scroll}>
            <table className={styles.grid} aria-label={soT('capHeads')}>
              <thead>
                <tr>
                  <th scope="col">{soT('colHead')}</th>
                  <th scope="col">{soT('colLiability')}</th>
                  <th scope="col">{soT('colRcm')}</th>
                  <th scope="col">{o7T('colOpening')}</th>
                  <th scope="col">{soT('colItc')}</th>
                  <th scope="col">{soT('colItcUsed')}</th>
                  <th scope="col">{soT('colCarry')}</th>
                  <th scope="col">{soT('colCash')}</th>
                  <th scope="col">{soT('colInterest')}</th>
                  <th scope="col">{soT('colLateFee')}</th>
                  <th scope="col">{soT('colTotal')}</th>
                  <th scope="col">{soT('colBalance')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.h}>
                    <th scope="row">{GST_HEAD_LABELS[r.h]}</th>
                    <td>{m(r.liability)}</td>
                    <td>{m(r.rc)}</td>
                    <td>{m(r.opening)}</td>
                    <td className={r.itc < 0 ? styles.bad : undefined}>{m(r.itc)}</td>
                    <td>{m(r.used)}</td>
                    <td>{m(r.carry)}</td>
                    <td>{m(r.cash)}</td>
                    <td>{m(r.interest)}</td>
                    <td>{m(r.fee)}</td>
                    <td><strong>{m(r.total)}</strong></td>
                    <td className={r.balance >= r.total ? styles.ok : styles.bad}>{m(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{soT('chTotal')}</td>
                  {(['liability', 'rc', 'opening', 'itc', 'used', 'carry', 'cash', 'interest', 'fee', 'total', 'balance'] as const).map((k) => (
                    <td key={k}>{m(Math.round(sum(k) * 100) / 100)}</td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          <h3 className={local.tbHeading}>{soT('matrixTitle')}</h3>
          <div className={styles.scroll}>
            <table className={styles.grid} aria-label={soT('matrixTitle')}>
              <thead>
                <tr>
                  <th scope="col">{soT('colHead')}</th>
                  {GST_HEADS.map((h) => <th key={h} scope="col">{GST_HEAD_LABELS[h]}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr><th scope="row">{soT('matrixFrom', { head: 'IGST' })}</th><td>{m(plan.itcMatrix.igst.igst)}</td><td>{m(plan.itcMatrix.igst.cgst)}</td><td>{m(plan.itcMatrix.igst.sgst)}</td><td>—</td></tr>
                <tr><th scope="row">{soT('matrixFrom', { head: 'CGST' })}</th><td>{m(plan.itcMatrix.cgst.igst)}</td><td>{m(plan.itcMatrix.cgst.cgst)}</td><td>—</td><td>—</td></tr>
                <tr><th scope="row">{soT('matrixFrom', { head: 'SGST' })}</th><td>{m(plan.itcMatrix.sgst.igst)}</td><td>—</td><td>{m(plan.itcMatrix.sgst.sgst)}</td><td>—</td></tr>
                <tr><th scope="row">{soT('matrixFrom', { head: 'Cess' })}</th><td>—</td><td>—</td><td>—</td><td>{m(plan.itcMatrix.cess.cess)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className={styles.muted}>
            {oldOrder
              ? soT('orderOld', { source: [...GST_SETOFF_RULES].reverse().find((r) => r.from <= plan.from)?.source ?? '' })
              : soT('orderRule88A')}
          </p>

          <div className={styles.actions}>
            <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={() => setDialog(true)} disabled={plan.warnings.includes('NOTHING_TO_SET_OFF')}>
              <BookCheck size={14} aria-hidden /> {record ? soT('repost') : soT('post')}
            </button>
            {record && (
              <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => setConfirmDel(true)}>
                <Trash2 size={14} aria-hidden /> {soT('deleteSetoff')}
              </button>
            )}
            {sumHeads(status.shortfall) > 0 && (
              <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`}
                onClick={() => setChallanSeed({ amounts: challanFromPlan(plan, balanceForPeriod), periodKey: plan.periodKey })}>
                <Plus size={14} aria-hidden /> {soT('challanFromPlan')}
              </button>
            )}
          </div>
        </>
      )}

      <ChallanList
        challans={challans}
        gstin={gstin}
        defaultPeriodKey={isFy ? '' : plan.periodKey}
        seed={challanSeed}
        onSeedUsed={() => setChallanSeed(null)}
        onChanged={refresh}
        notify={notify}
      />

      {dialog && (
        <Suspense fallback={null}>
          <SetOffDialog
            plan={plan}
            periodText={label}
            gstin={gstin}
            defaultDate={record?.date ?? effectivePaidOn}
            onClose={() => setDialog(false)}
            onPosted={(n) => {
              setDialog(false);
              notify(soT('posted', { number: n }), 'success');
              refresh();
            }}
            notify={notify}
          />
        </Suspense>
      )}
      <ConfirmDialog
        open={confirmDel}
        title={soT('deleteSetoff')}
        message={soT('confirmDelete', { number: record?.voucher_number ?? '' })}
        confirmLabel={soT('remove')}
        destructive
        onConfirm={() => {
          setConfirmDel(false);
          doDelete();
        }}
        onClose={() => setConfirmDel(false)}
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className={surface.stat}>
      <div className={surface.statTop}><span className={surface.statLabel}>{label}</span></div>
      <div className={surface.statValue}>{value}</div>
      <div className={surface.statHint}>{hint}</div>
    </div>
  );
}

export default SetOffPanel;
