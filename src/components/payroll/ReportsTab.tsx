import { useMemo, useState } from 'react';
import { Download, Save } from 'lucide-react';
import { loadAttendance, loadAttendanceTypes, loadEmployees, loadPayrollSettings, loadRuns, savePayrollSettings } from '../../lib/payroll/store';
import {
  WORKING_PAPER,
  attendanceRegisterRows,
  bankAdviceRows,
  esiRows,
  form16PartBRows,
  form24QAnnexure1Rows,
  form24QAnnexure2Rows,
  paySheetRows,
  pfEcrRows,
  pfEcrText,
  ptRegisterRows,
} from '../../lib/payroll/reports';
import { daysInMonth, fyStartOfMonth } from '../../lib/payroll/statutory';
import { arrearsRegisterRows, pfLateRows } from '../../lib/payroll/depth-reports';
import { loadArrears, loadPerquisites } from '../../lib/payroll/depth-records';
import { loadPayrollPayments } from '../../lib/payroll/records';
import { arrearEcrChecks, arrearEcrLines, arrearEcrRows, arrearEcrText, perqStatementRows, s17viiRows, tds201Rows } from '../../lib/payroll/followups';
import { todayInput } from '../../lib/utils';
import { downloadText } from '../../lib/download';
import { payrollT as pT } from '../../i18n/areas/payroll';
import { ita25T, ita25Words } from '../../i18n/areas/ita2025';
import { formText, fyStart as fyFirstDay, ITA2025_FROM } from '../../lib/ita2025';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';
import { exportRows, type Rows } from './shared';
import { SelectField } from '../ui/SelectField';

interface Props {
  month: string;
  version: number;
  refresh: () => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

export function ReportsTab({ month, version, refresh, notify }: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runs = useMemo(() => loadRuns(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const employees = useMemo(() => loadEmployees(), [version]);
  const run = runs.find((r) => r.month === month);
  const fyStart = Number(fyStartOfMonth(month).slice(0, 4));
  const fyLabel = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(1);
  const [empId, setEmpId] = useState('');
  const [reg, setReg] = useState(() => loadPayrollSettings());

  const out = (base: string, rows: Rows, sheet: string) => (
    <span className={styles.inline}>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void exportRows(base, rows, 'csv', sheet)}><Download size={14} /> CSV</button>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void exportRows(base, rows, 'xlsx', sheet)}><Download size={14} /> Excel</button>
    </span>
  );
  const fyRuns = runs.filter((r) => r.status === 'final' && fyStartOfMonth(r.month) === `${fyStart}-04-01`);
  const emp = employees.find((e) => e.id === (empId || employees[0]?.id));

  const item = (title: string, hint: string, actions: React.ReactNode) => (
    <li className={styles.report}>
      <div><strong>{title}</strong><span className={styles.sub}>{hint}</span></div>
      {actions}
    </li>
  );
  const noRun = <span className={styles.sub}>{pT('rep.noRun')}</span>;

  return (
    <div className={styles.stack}>
      <section className={surface.card}>
        <div className={surface.cardBody}>
          <h2 className={styles.h2}>{pT('rep.monthly', { month })}</h2>
          <ul className={styles.reports}>
            {item(pT('rep.paySheet'), pT('rep.paySheetHint'), run ? out(`pay-sheet-${month}`, paySheetRows(run), 'Pay sheet') : noRun)}
            {item(pT('rep.bank'), pT('rep.bankHint'), run ? out(`salary-bank-advice-${month}`, bankAdviceRows(run), 'Bank advice') : noRun)}
            {item(
              pT('rep.attendance'),
              pT('rep.attendanceHint'),
              out(`attendance-${month}`, attendanceRegisterRows(month, employees, loadAttendance(), loadAttendanceTypes(), daysInMonth(month)), 'Attendance'),
            )}
            {item(
              pT('rep.ecr'),
              pT('rep.ecrHint'),
              run ? (
                <span className={styles.inline}>
                  <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => downloadText(`ECR-${month}.txt`, pfEcrText(run), 'text/plain')}><Download size={14} /> ECR .txt</button>
                  {out(`pf-working-${month}`, pfEcrRows(run), 'PF')}
                </span>
              ) : noRun,
            )}
            {(() => {
              const lines = arrearEcrLines(loadArrears(), employees, month);
              return item(
                pT('rep.arrearEcr'),
                pT('rep.arrearEcrHint'),
                lines.length ? (
                  <span className={styles.inline}>
                    <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => downloadText(`ECR-arrear-${month}.txt`, arrearEcrText(lines), 'text/plain')}><Download size={14} /> ECR .txt</button>
                    {out(`pf-arrear-working-${month}`, arrearEcrRows(lines, month), 'PF arrears')}
                    {(() => {
                      const n = arrearEcrChecks(lines, month).length;
                      return n ? <span className={styles.sub}>{pT('rep.arrearEcrChecks', { n })}</span> : null;
                    })()}
                  </span>
                ) : <span className={styles.sub}>{pT('rep.noArrears')}</span>,
              );
            })()}
            {item(pT('rep.esi'), pT('rep.esiHint'), run ? out(`esi-${month}`, esiRows(run), 'ESI') : noRun)}
            {item(pT('rep.pt'), pT('rep.ptHint'), run ? out(`pt-register-${month}`, ptRegisterRows([run]), 'PT') : noRun)}
          </ul>
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardBody}>
          <h2 className={styles.h2}>{pT('rep.annual', { fy: fyLabel })}</h2>
          <ul className={styles.reports}>
            {item(
              fyFirstDay(fyStart) >= ITA2025_FROM ? ita25T('annex1', { form: formText('24Q', fyFirstDay(fyStart), ita25Words()) }) : pT('rep.q24'),
              pT('rep.q24Hint'),
              <span className={styles.inline}>
                <SelectField className={controls.select} aria-label={pT('rep.quarter')} value={quarter} onChange={(e) => setQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)}>
                  {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
                </SelectField>
                {out(`form24Q-annexure1-FY${fyLabel}-Q${quarter}`, form24QAnnexure1Rows(fyRuns, fyStart, quarter), '24Q Annexure I')}
              </span>,
            )}
            {item(fyFirstDay(fyStart) >= ITA2025_FROM ? ita25T('annex2', { form: formText('24Q', fyFirstDay(fyStart), ita25Words()) }) : pT('rep.ann2'), pT('rep.ann2Hint'), out(`form24Q-annexure2-FY${fyLabel}`, form24QAnnexure2Rows(fyRuns, employees, fyStart), '24Q Annexure II'))}
            {item(pT('rep.ptYear'), pT('rep.ptHint'), out(`pt-register-FY${fyLabel}`, ptRegisterRows(fyRuns), 'PT'))}
            {item(pT('rep.pfLate'), pT('rep.pfLateHint'), out(`pf-late-estimate-FY${fyLabel}`, pfLateRows(fyRuns, loadPayrollPayments(), fyStart, todayInput()), 'PF late'))}
            {item(pT('rep.tds201'), pT('rep.tds201Hint'), out(`tds-201-1A-FY${fyLabel}`, tds201Rows(fyRuns, loadPayrollPayments(), fyStart, todayInput()), '201(1A)'))}
            {item(pT('rep.s17vii'), pT('rep.s17viiHint'), out(`s17-2-vii-FY${fyLabel}`, s17viiRows(fyRuns, employees, fyStart), '17(2)(vii)'))}
            {item(pT('rep.arrears'), pT('rep.arrearsHint'), out(`arrears-FY${fyLabel}`, arrearsRegisterRows(loadArrears().filter((r) => fyStartOfMonth(r.pay_month) === `${fyStart}-04-01`), employees), 'Arrears'))}
            {item(
              fyFirstDay(fyStart) >= ITA2025_FROM ? ita25T('partB', { form: formText('16', fyFirstDay(fyStart), ita25Words()) }) : pT('rep.f16'),
              pT('rep.f16Hint'),
              emp ? (
                <span className={styles.inline}>
                  <SelectField className={controls.select} aria-label={pT('rep.employee')} value={emp.id} onChange={(e) => setEmpId(e.target.value)}>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
                  </SelectField>
                  {out(`form16-partB-${emp.code}-FY${fyLabel}`, form16PartBRows(fyRuns, emp, fyStart), 'Form 16 Part B')}
                </span>
              ) : noRun,
            )}
            {emp && item(
              pT('rep.f12ba', { form: formText('12BA', fyFirstDay(fyStart), ita25Words()) }),
              pT('rep.f12baHint'),
              out(`perquisites-${emp.code}-FY${fyLabel}`, perqStatementRows(fyRuns, loadPerquisites(), emp, fyStart, formText('12BA', fyFirstDay(fyStart))), 'Perquisites'),
            )}
          </ul>
          <p className={styles.note}>{WORKING_PAPER}</p>
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardBody}>
          <h2 className={styles.h2}>{pT('reg.title')}</h2>
          <div className={styles.formGrid}>
            <label className={controls.field}>
              <span className={controls.label}>{pT('reg.pf')}</span>
              <input className={controls.inputMono} value={reg.pf_code ?? ''} onChange={(e) => setReg({ ...reg, pf_code: e.target.value })} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('reg.esi')}</span>
              <input className={controls.inputMono} value={reg.esi_code ?? ''} onChange={(e) => setReg({ ...reg, esi_code: e.target.value })} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('reg.tan')}</span>
              <input className={controls.inputMono} value={reg.tan ?? ''} onChange={(e) => setReg({ ...reg, tan: e.target.value })} />
            </label>
          </div>
          <button
            type="button"
            className={controls.btnOutline}
            onClick={() => {
              try {
                savePayrollSettings(reg);
                refresh();
                notify(pT('reg.saved'));
              } catch (err) {
                notify((err as Error).message, 'error');
              }
            }}
          >
            <Save size={15} /> {pT('reg.save')}
          </button>
        </div>
      </section>
    </div>
  );
}
