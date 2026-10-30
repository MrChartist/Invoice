import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import {
  deleteEmployee,
  deleteGroup,
  loadEmployees,
  loadGroups,
  saveEmployee,
  saveGroup,
  validateEmployee,
  type EmployeeInput,
} from '../../lib/payroll/store';
import { PT_STATES } from '../../lib/payroll-rules';
import { loadCostCentres } from '../../lib/cost-centres';
import { INDIAN_STATES } from '../../lib/india-states';
import { formatDate } from '../../lib/utils';
import type { Employee } from '../../types/payroll';
import { Modal } from '../ui/Modal';
import { EmptyState } from '../ui/EmptyState';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { payrollT as pT } from '../../i18n/areas/payroll';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';

interface Props {
  version: number;
  refresh: () => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

const blank = (code: string): EmployeeInput => ({ code, name: '', tax_regime: 'new', pf: true, esi: true, pt: true, active: true });

function nextCode(list: readonly Employee[]): string {
  const n = list.reduce((m, e) => Math.max(m, Number(/(\d+)$/.exec(e.code)?.[1] ?? 0)), 0) + 1;
  return `E${String(n).padStart(3, '0')}`;
}

export function EmployeesTab({ version, refresh, notify }: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const employees = useMemo(() => loadEmployees(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => loadGroups(), [version]);
  const centres = useMemo(() => loadCostCentres(), []);
  const [editing, setEditing] = useState<EmployeeInput | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [groupName, setGroupName] = useState('');

  const act = (fn: () => void, ok: string) => {
    try {
      fn();
      refresh();
      notify(ok);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <div className={styles.stack}>
      <section className={surface.card}>
        <div className={styles.toolbar}>
          <h2 className={styles.h2}>{pT('employees.title')}</h2>
          <button type="button" className={controls.btnPrimary} onClick={() => setEditing(blank(nextCode(employees)))}>
            <Plus size={16} /> {pT('employees.add')}
          </button>
        </div>
        {employees.length === 0 ? (
          <EmptyState icon={UserRound} title={pT('employees.emptyTitle')} text={pT('employees.emptyText')} />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{pT('employees.title')}</caption>
              <thead>
                <tr>
                  <th>{pT('f.code')}</th>
                  <th>{pT('f.name')}</th>
                  <th>{pT('f.designation')}</th>
                  <th>{pT('f.department')}</th>
                  <th>{pT('f.state')}</th>
                  <th>{pT('f.regime')}</th>
                  <th>{pT('f.doj')}</th>
                  <th>{pT('f.status')}</th>
                  <th className={styles.num}>{pT('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className={surface.mono}>{e.code}</td>
                    <td>{e.name}</td>
                    <td>{e.designation ?? ''}</td>
                    <td>{centres.find((c) => c.id === e.cost_centre_id)?.name ?? ''}</td>
                    <td>{PT_STATES[e.state ?? ''] ?? INDIAN_STATES.find((s) => s.code === e.state)?.name ?? ''}</td>
                    <td>{e.tax_regime === 'old' ? pT('regime.old') : pT('regime.new')}</td>
                    <td>{e.doj ? formatDate(e.doj) : ''}</td>
                    <td>
                      <span className={`${surface.badge} ${e.active && !e.dol ? surface.badgePaid : surface.badgeCancelled}`}>
                        {e.dol ? pT('status.left') : e.active ? pT('status.active') : pT('status.inactive')}
                      </span>
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <button type="button" className={controls.btnIcon} aria-label={pT('employees.edit', { name: e.name })} title={pT('edit')} onClick={() => setEditing({ ...e })}>
                          <Pencil size={15} />
                        </button>
                        <button type="button" className={controls.btnDanger} aria-label={pT('employees.delete', { name: e.name })} title={pT('delete')} onClick={() => setDeleting(e)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
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
          <h2 className={styles.h2}>{pT('groups.title')}</h2>
          <p className={styles.note}>{pT('groups.hint')}</p>
          <ul className={styles.chips}>
            {groups.map((g) => (
              <li key={g.id} className={styles.chip}>
                {g.name}
                <button type="button" className={controls.btnIcon} aria-label={pT('groups.delete', { name: g.name })} onClick={() => act(() => deleteGroup(g.id), pT('groups.deleted'))}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
          <form
            className={styles.inline}
            onSubmit={(ev) => {
              ev.preventDefault();
              act(() => saveGroup({ name: groupName }), pT('groups.added'));
              setGroupName('');
            }}
          >
            <label className={controls.field}>
              <span className={controls.label}>{pT('groups.new')}</span>
              <input className={controls.input} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={pT('groups.placeholder')} />
            </label>
            <button type="submit" className={controls.btnOutline} disabled={!groupName.trim()}>
              <Plus size={15} /> {pT('groups.addBtn')}
            </button>
          </form>
        </div>
      </section>

      {editing && (
        <EmployeeModal
          initial={editing}
          employees={employees}
          groups={groups}
          centres={centres}
          onClose={() => setEditing(null)}
          onSave={(input) => {
            try {
              const row = saveEmployee(input);
              setEditing(null);
              refresh();
              notify(pT('employees.saved', { name: row.name }));
            } catch (err) {
              notify((err as Error).message, 'error');
            }
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={pT('employees.deleteTitle')}
        message={deleting ? pT('employees.deleteText', { name: deleting.name }) : ''}
        confirmLabel={pT('delete')}
        destructive
        onConfirm={() => {
          if (deleting) act(() => deleteEmployee(deleting.id), pT('employees.deleted'));
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function EmployeeModal({
  initial,
  employees,
  groups,
  centres,
  onClose,
  onSave,
}: {
  initial: EmployeeInput;
  employees: Employee[];
  groups: { id: string; name: string }[];
  centres: { id: string; name: string }[];
  onClose: () => void;
  onSave: (e: EmployeeInput) => void;
}) {
  const [f, setF] = useState<EmployeeInput>(initial);
  const [tried, setTried] = useState(false);
  const errors = validateEmployee(f, employees);
  const set = <K extends keyof EmployeeInput>(k: K, v: EmployeeInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const text = (k: 'code' | 'name' | 'designation' | 'pan' | 'uan' | 'esi_no' | 'bank_name' | 'bank_account' | 'bank_ifsc', label: string, extra: { required?: boolean; mono?: boolean } = {}) => (
    <label className={controls.field}>
      <span className={controls.label}>{label}{extra.required ? ' *' : ''}</span>
      <input className={extra.mono ? controls.inputMono : controls.input} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  const money = (k: 'tax_deductions' | 'hra_exemption' | 'other_income' | 'prev_salary' | 'prev_tds', label: string) => (
    <label className={controls.field}>
      <span className={controls.label}>{label}</span>
      <input className={controls.inputNumeric} type="number" min="0" step="1" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value === '' ? undefined : Number(e.target.value))} />
    </label>
  );
  const check = (k: 'pf' | 'esi' | 'pt' | 'active' | 'pf_on_actual' | 'eps_excluded', label: string) => (
    <label className={controls.check}>
      <input type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked)} /> {label}
    </label>
  );
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={initial.id ? pT('employees.editTitle') : pT('employees.addTitle')}
      footer={
        <>
          <button type="button" className={controls.btnGhost} onClick={onClose}>{pT('cancel')}</button>
          <button
            type="button"
            className={controls.btnPrimary}
            onClick={() => {
              setTried(true);
              if (!errors.length) onSave(f);
            }}
          >
            {pT('employees.saveBtn')}
          </button>
        </>
      }
    >
      <div className={styles.formGrid}>
        {text('code', pT('f.code'), { required: true, mono: true })}
        {text('name', pT('f.name'), { required: true })}
        {text('designation', pT('f.designation'))}
        <label className={controls.field}>
          <span className={controls.label}>{pT('f.department')}</span>
          <select className={controls.select} value={f.cost_centre_id ?? ''} onChange={(e) => set('cost_centre_id', e.target.value || undefined)}>
            <option value="">-</option>
            {centres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{pT('f.group')}</span>
          <select className={controls.select} value={f.group_id ?? ''} onChange={(e) => set('group_id', e.target.value || undefined)}>
            <option value="">-</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{pT('f.gender')}</span>
          <select className={controls.select} value={f.gender ?? ''} onChange={(e) => set('gender', (e.target.value || undefined) as EmployeeInput['gender'])}>
            <option value="">-</option>
            <option value="M">{pT('gender.m')}</option>
            <option value="F">{pT('gender.f')}</option>
            <option value="O">{pT('gender.o')}</option>
          </select>
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{pT('f.doj')}</span>
          <input className={controls.input} type="date" value={f.doj ?? ''} onChange={(e) => set('doj', e.target.value || undefined)} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{pT('f.dol')}</span>
          <input className={controls.input} type="date" value={f.dol ?? ''} onChange={(e) => set('dol', e.target.value || undefined)} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{pT('f.dob')}</span>
          <input className={controls.input} type="date" value={f.dob ?? ''} onChange={(e) => set('dob', e.target.value || undefined)} />
          <span className={controls.hint}>{pT('f.dobHint')}</span>
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{pT('f.noticeDays')}</span>
          <input className={controls.inputNumeric} type="number" min="0" step="1" value={f.notice_days ?? ''} onChange={(e) => set('notice_days', e.target.value ? Number(e.target.value) : undefined)} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{pT('f.state')}</span>
          <select className={controls.select} value={f.state ?? ''} onChange={(e) => set('state', e.target.value || undefined)}>
            <option value="">-</option>
            {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}{PT_STATES[s.code] ? ' · PT' : ''}</option>)}
          </select>
        </label>
        {text('pan', pT('f.pan'), { mono: true })}
        {text('uan', pT('f.uan'), { mono: true })}
        {text('esi_no', pT('f.esiNo'), { mono: true })}
        {text('bank_name', pT('f.bankName'))}
        {text('bank_account', pT('f.bankAccount'), { mono: true })}
        {text('bank_ifsc', pT('f.ifsc'), { mono: true })}
      </div>
      <h3 className={styles.h3}>{pT('employees.statutory')}</h3>
      <div className={styles.checks}>
        {check('pf', pT('f.pf'))}
        {check('pf_on_actual', pT('f.pfActual'))}
        {check('eps_excluded', pT('f.epsExcluded'))}
        {check('esi', pT('f.esi'))}
        {check('pt', pT('f.pt'))}
        {check('active', pT('f.active'))}
      </div>
      <h3 className={styles.h3}>{pT('employees.tax')}</h3>
      <div className={styles.formGrid}>
        <label className={controls.field}>
          <span className={controls.label}>{pT('f.regime')}</span>
          <select className={controls.select} value={f.tax_regime} onChange={(e) => set('tax_regime', e.target.value === 'old' ? 'old' : 'new')}>
            <option value="new">{pT('regime.new')}</option>
            <option value="old">{pT('regime.old')}</option>
          </select>
        </label>
        {money('tax_deductions', pT('f.deductions'))}
        {money('hra_exemption', pT('f.hra'))}
        {money('other_income', pT('f.otherIncome'))}
        {money('prev_salary', pT('f.prevSalary'))}
        {money('prev_tds', pT('f.prevTds'))}
      </div>
      <p className={styles.note}>{pT('employees.taxHint')}</p>
      {tried && errors.length > 0 && <p className={controls.error} role="alert">{errors[0]}</p>}
    </Modal>
  );
}
