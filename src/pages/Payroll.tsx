import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { useToast } from '../components/ui/useToast';
import { EmployeesTab } from '../components/payroll/EmployeesTab';
import { PayHeadsTab } from '../components/payroll/PayHeadsTab';
import { StructuresTab } from '../components/payroll/StructuresTab';
import { AttendanceTab } from '../components/payroll/AttendanceTab';
import { RunTab } from '../components/payroll/RunTab';
import { PaymentsTab } from '../components/payroll/PaymentsTab';
import { ReportsTab } from '../components/payroll/ReportsTab';
import { thisMonth } from '../components/payroll/shared';
import { useT } from '../i18n';
import { payrollT as pT } from '../i18n/areas/payroll';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from '../components/payroll/Payroll.module.css';

const TABS = ['employees', 'heads', 'structures', 'attendance', 'run', 'payments', 'reports'] as const;
type Tab = (typeof TABS)[number];
const TAB_KEY = {
  employees: 'tabs.employees',
  heads: 'tabs.heads',
  structures: 'tabs.structures',
  attendance: 'tabs.attendance',
  run: 'tabs.run',
  payments: 'tabs.payments',
  reports: 'tabs.reports',
} as const;
const MONTH_TABS: readonly Tab[] = ['attendance', 'run', 'payments', 'reports'];

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
    <div className={surface.page}>
      <PageHeader
        title={pT('title')}
        subtitle={pT('subtitle')}
        actions={
          MONTH_TABS.includes(tab) ? (
            <label className={controls.field}>
              <span className={controls.label}>{pT('month')}</span>
              <input className={controls.input} type="month" value={month} onChange={(e) => e.target.value && set('month', e.target.value)} />
            </label>
          ) : undefined
        }
      />
      <div className={styles.tabs} role="tablist" aria-label={pT('title')}>
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => set('tab', t)}>
            {pT(TAB_KEY[t])}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'employees' && <EmployeesTab {...common} />}
        {tab === 'heads' && <PayHeadsTab {...common} />}
        {tab === 'structures' && <StructuresTab {...common} />}
        {tab === 'attendance' && <AttendanceTab month={month} {...common} />}
        {tab === 'run' && <RunTab month={month} {...common} />}
        {tab === 'payments' && <PaymentsTab month={month} {...common} />}
        {tab === 'reports' && <ReportsTab month={month} {...common} />}
      </div>
      <p className={styles.note}>{pT('footer')}</p>
      {toastNode}
    </div>
  );
}
