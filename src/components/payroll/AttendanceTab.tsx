import { useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { loadAttendance, loadAttendanceTypes, loadEmployees, saveAttendance } from '../../lib/payroll/store';
import { daysEmployed } from '../../lib/payroll/compute';
import { OT_HOURS_TYPE } from '../../types/payroll';
import { payrollT as pT } from '../../i18n/areas/payroll';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';
import { gridKeyDown, parseAmount } from './shared';

interface Props {
  month: string;
  version: number;
  refresh: () => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

type Cells = Record<string, Record<string, string>>;

export function AttendanceTab({ month, version, refresh, notify }: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const employees = useMemo(() => loadEmployees().filter((e) => daysEmployed(e, month) > 0 && (e.active || e.dol)), [version, month]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const types = useMemo(() => loadAttendanceTypes(), [version]);
  const cols = [{ id: 'lop', label: pT('att.lop') }, { id: OT_HOURS_TYPE, label: pT('att.otHours') }, ...types.map((t) => ({ id: t.id, label: `${t.name} (${t.unit})` }))];
  const initial = useMemo<Cells>(() => {
    const rows = loadAttendance().filter((a) => a.month === month);
    return Object.fromEntries(
      rows.map((a) => [a.employee_id, { lop: a.lop ? String(a.lop) : '', ...Object.fromEntries(Object.entries(a.units ?? {}).map(([k, v]) => [k, String(v)])) }]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, version]);
  const [edits, setEdits] = useState<{ month: string; cells: Cells }>({ month, cells: {} });
  const cells: Cells = edits.month === month ? { ...initial, ...edits.cells } : initial;
  const dirty = edits.month === month && Object.keys(edits.cells).length > 0;

  const setCell = (emp: string, col: string, v: string) =>
    setEdits((p) => {
      const base = p.month === month ? p.cells : {};
      return { month, cells: { ...base, [emp]: { ...(cells[emp] ?? {}), [col]: v } } };
    });

  const save = () => {
    try {
      saveAttendance(
        month,
        employees.map((e) => {
          const c = cells[e.id] ?? {};
          const units: Record<string, number> = {};
          for (const col of cols) if (col.id !== 'lop') units[col.id] = parseAmount(c[col.id] ?? '') ?? 0;
          return { employee_id: e.id, lop: parseAmount(c.lop ?? '') ?? 0, units };
        }),
      );
      setEdits({ month, cells: {} });
      refresh();
      notify(pT('att.saved'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <section className={surface.card}>
      <div className={styles.toolbar}>
        <h2 className={styles.h2}>{pT('att.title')}</h2>
        <button type="button" className={controls.btnPrimary} onClick={save} disabled={!employees.length}>
          <Save size={15} /> {pT('att.save')}
        </button>
      </div>
      {employees.length === 0 ? (
        <div className={surface.cardBody}><p className={styles.note}>{pT('att.none')}</p></div>
      ) : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <caption className={surface.srOnly}>{pT('att.title')}</caption>
            <thead>
              <tr>
                <th>{pT('f.code')}</th>
                <th>{pT('f.name')}</th>
                <th className={styles.num}>{pT('att.days')}</th>
                {cols.map((c) => <th key={c.id} className={styles.num}>{c.label}</th>)}
                <th className={styles.num}>{pT('att.paid')}</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e, r) => {
                const days = daysEmployed(e, month);
                const lop = parseAmount(cells[e.id]?.lop ?? '') ?? 0;
                return (
                  <tr key={e.id}>
                    <td className={surface.mono}>{e.code}</td>
                    <td>{e.name}</td>
                    <td className={styles.num}>{days}</td>
                    {cols.map((c) => (
                      <td key={c.id} className={styles.num}>
                        <input
                          className={`${controls.inputNumeric} ${styles.cell}`}
                          type="number"
                          min="0"
                          step="0.5"
                          inputMode="decimal"
                          data-row={r}
                          data-col={c.id}
                          aria-label={`${c.label} · ${e.name}`}
                          value={cells[e.id]?.[c.id] ?? ''}
                          onKeyDown={gridKeyDown}
                          onChange={(ev) => setCell(e.id, c.id, ev.target.value)}
                        />
                      </td>
                    ))}
                    <td className={styles.num}>{Math.max(0, days - lop)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.note}>{dirty ? pT('att.unsaved') : pT('att.hint')}</p>
    </section>
  );
}
