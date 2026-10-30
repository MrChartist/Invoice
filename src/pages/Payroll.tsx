import { Suspense, lazy, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Page } from '../components/ui/Page';
import { useToast } from '../components/ui/useToast';
import { EmployeesTab } from '../components/payroll/EmployeesTab';
import { PayHeadsTab } from '../components/payroll/PayHeadsTab';
import { StructuresTab } from '../components/payroll/StructuresTab';
import { AttendanceTab } from '../components/payroll/AttendanceTab';
import { RunTab } from '../components/payroll/RunTab';
import { PaymentsTab } from '../components/payroll/PaymentsTab';
import { ReportsTab } from '../components/payroll/ReportsTab';
import { thisMonth } from '../components/payroll/shared';

// 7P tabs load on first use (arrears, loans, leave, reimbursements / perquisites / bonus, F&F + gratuity).
const ArrearsTab = lazy(() => import('../components/payroll/ArrearsTab').then((m) => ({ default: m.ArrearsTab })));
const LoansTab = lazy(() => import('../components/payroll/LoansTab').then((m) => ({ default: m.LoansTab })));
const LeaveTab = lazy(() => import('../components/payroll/LeaveTab').then((m) => ({ default: m.LeaveTab })));
const ExtrasTab = lazy(() => import('../components/payroll/ExtrasTab').then((m) => ({ default: m.ExtrasTab })));
const FnfTab = lazy(() => import('../components/payroll/FnfTab').then((m) => ({ default: m.FnfTab })));
// 7T: relief u/s 89 (Form 10E), Rule 3 perquisite valuation, actuarial valuations, PT option, payroll access.
const MoreTab = lazy(() => import('../components/payroll/MoreTab').then((m) => ({ default: m.MoreTab })));
// R6-A3 / A6: "About this tab" strip and the one-time tip (lazy).
const AboutStrip = lazy(() => import('../components/help/AboutStrip'));
const ScreenTip = lazy(() => import('../components/help/ScreenTip'));
import { useT } from '../i18n';
import { payrollT as pT } from '../i18n/areas/payroll';
import controls from '../styles/controls.module.css';
import styles from '../components/payroll/Payroll.module.css';
import { PAYROLL_TABS, type PayrollTab } from './page-tabs'; import { DateField } from '../components/ui/DateField';
// R6-B1

const TABS = PAYROLL_TABS; // R6-B1: list in payroll-tabs.ts
type Tab = PayrollTab;
const TAB_KEY = {
  employees: 'tabs.employees',
  heads: 'tabs.heads',
  structures: 'tabs.structures',
  attendance: 'tabs.attendance',
  run: 'tabs.run',
  payments: 'tabs.payments',
  reports: 'tabs.reports',
  leave: 'tabs.leave',
  arrears: 'tabs.arrears',
  extras: 'tabs.extras',
  loans: 'tabs.loans',
  fnf: 'tabs.fnf',
  more: 'tabs.more',
} as const;
const MONTH_TABS: readonly Tab[] = ['attendance', 'leave', 'run', 'arrears', 'extras', 'loans', 'payments', 'fnf', 'reports', 'more'];

/** Payroll (Phase 7, Tally parity): masters, attendance, monthly run, payments and statutory working papers. */
export function Payroll() {
  useT(); // re-render on a language switch
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'employees';
  const monthParam = params.get('month') ?? '';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : thisMonth();
  const [version, setVersion] = useState(0);
  const { notify, toastNode } = useToast();
  const refresh = () => setVersion((v) => v + 1);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };
  const common = { version, refresh, notify };

  return (
    <Page
      title={pT('title')}
      subtitle={pT('subtitle')}
      actions={
        MONTH_TABS.includes(tab) ? (
          <label className={controls.field}>
            <span className={controls.label}>{pT('month')}</span>
            <DateField className={controls.input} mode="month" value={month} onChange={(e) => e.target.value && set('month', e.target.value)} />
          </label>
        ) : undefined
      }
      notices={<Suspense fallback={null}><ScreenTip id="payroll" /></Suspense>}
    >
      <div className={styles.tabs} role="tablist" aria-label={pT('title')}>
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => set('tab', t)}>
            {pT(TAB_KEY[t])}
          </button>
        ))}
      </div>
      <Suspense fallback={null}><AboutStrip /></Suspense>
      <div role="tabpanel">
        {tab === 'employees' && <EmployeesTab {...common} />}
        {tab === 'heads' && <PayHeadsTab {...common} />}
        {tab === 'structures' && <StructuresTab {...common} />}
        {tab === 'attendance' && <AttendanceTab month={month} {...common} />}
        {tab === 'run' && <RunTab month={month} {...common} />}
        {tab === 'payments' && <PaymentsTab month={month} {...common} />}
        {tab === 'reports' && <ReportsTab month={month} {...common} />}
        <Suspense fallback={<p className={styles.note}>{pT('loading')}</p>}>
          {tab === 'leave' && <LeaveTab month={month} {...common} />}
          {tab === 'arrears' && <ArrearsTab month={month} {...common} />}
          {tab === 'extras' && <ExtrasTab month={month} {...common} />}
          {tab === 'loans' && <LoansTab month={month} {...common} />}
          {tab === 'fnf' && <FnfTab month={month} {...common} />}
          {tab === 'more' && <MoreTab month={month} {...common} />}
        </Suspense>
      </div>
      <p className={styles.note}>{pT('footer')}</p>
      {toastNode}
    </Page>
  );
}
