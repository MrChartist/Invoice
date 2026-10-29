import { useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { deleteStructure, loadEmployees, loadGroups, loadPayHeads, loadStructures, saveStructure } from '../../lib/payroll/store';
import { formatDate, todayInput } from '../../lib/utils';
import type { SalaryStructure } from '../../types/payroll';
import { payrollT as pT } from '../../i18n/areas/payroll';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';
import { gridKeyDown, inr, parseAmount } from './shared';

interface Props {
  version: number;
  refresh: () => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

type Draft = { id?: string; effective_from: string; amounts: Record<string, string> };

const toDraft = (s: SalaryStructure): Draft => ({ id: s.id, effective_from: s.effective_from, amounts: Object.fromEntries(s.lines.map((l) => [l.pay_head_id, String(l.amount)])) });

export function StructuresTab({ version, refresh, notify }: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const employees = useMemo(() => loadEmployees(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => loadGroups(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const heads = useMemo(() => loadPayHeads().filter((h) => h.active && !h.statutory).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const structures = useMemo(() => loadStructures(), [version]);
  const [owner, setOwner] = useState(() => (employees[0] ? `e:${employees[0].id}` : groups[0] ? `g:${groups[0].id}` : ''));
  const [draft, setDraft] = useState<Draft | null>(null);

  const [kind, ownerId] = owner.split(':') as ['e' | 'g', string];
  const mine = structures
    .filter((s) => (kind === 'e' ? s.employee_id === ownerId : s.group_id === ownerId))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const current = draft ?? (mine[0] ? toDraft(mine[0]) : null);
  const emp = kind === 'e' ? employees.find((e) => e.id === ownerId) : undefined;
  const inheritsGroup = emp?.group_id && !mine.length ? groups.find((g) => g.id === emp.group_id) : undefined;

  const monthly = current
    ? heads.filter((h) => h.kind === 'earning' && (h.calc === 'attendance' || h.calc === 'flat')).reduce((s, h) => s + (parseAmount(current.amounts[h.id] ?? '') ?? 0), 0)
    : 0;

  const save = () => {
    if (!current) return;
    try {
      saveStructure({
        id: current.id,
        ...(kind === 'e' ? { employee_id: ownerId } : { group_id: ownerId }),
        effective_from: current.effective_from,
        lines: heads.filter((h) => (current.amounts[h.id] ?? '').trim() !== '').map((h) => ({ pay_head_id: h.id, amount: parseAmount(current.amounts[h.id]) ?? 0 })),
      });
      setDraft(null);
      refresh();
      notify(pT('structures.saved'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  if (!employees.length && !groups.length) return <section className={surface.card}><div className={surface.cardBody}><p className={styles.note}>{pT('structures.needEmployee')}</p></div></section>;

  return (
    <section className={surface.card}>
      <div className={styles.toolbar}>
        <label className={controls.field}>
          <span className={controls.label}>{pT('structures.for')}</span>
          <select className={controls.select} value={owner} onChange={(e) => { setOwner(e.target.value); setDraft(null); }}>
            <optgroup label={pT('tabs.employees')}>
              {employees.map((e) => <option key={e.id} value={`e:${e.id}`}>{e.code} · {e.name}</option>)}
            </optgroup>
            {groups.length > 0 && (
              <optgroup label={pT('groups.title')}>
                {groups.map((g) => <option key={g.id} value={`g:${g.id}`}>{pT('structures.group', { name: g.name })}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        {mine.length > 0 && (
          <label className={controls.field}>
            <span className={controls.label}>{pT('structures.history')}</span>
            <select className={controls.select} value={current?.id ?? ''} onChange={(e) => { const s = mine.find((x) => x.id === e.target.value); setDraft(s ? toDraft(s) : null); }}>
              {mine.map((s) => <option key={s.id} value={s.id}>{pT('structures.from', { date: formatDate(s.effective_from) })}</option>)}
              {current && !current.id && <option value="">{pT('structures.newFrom', { date: current.effective_from })}</option>}
            </select>
          </label>
        )}
        <button type="button" className={controls.btnOutline} onClick={() => setDraft({ effective_from: todayInput(), amounts: current ? { ...current.amounts } : {} })}>
          <Plus size={15} /> {mine.length ? pT('structures.revise') : pT('structures.create')}
        </button>
      </div>
      <div className={surface.cardBody}>
        {inheritsGroup && <p className={styles.note}>{pT('structures.inherits', { name: inheritsGroup.name })}</p>}
        {!current ? (
          <p className={styles.note}>{pT('structures.none')}</p>
        ) : (
          <>
            <label className={controls.field} style={{ maxWidth: '14rem' }}>
              <span className={controls.label}>{pT('structures.effective')}</span>
              <input className={controls.input} type="date" value={current.effective_from} onChange={(e) => setDraft({ ...current, effective_from: e.target.value })} />
            </label>
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <caption className={surface.srOnly}>{pT('structures.title')}</caption>
                <thead>
                  <tr>
                    <th>{pT('heads.payHead')}</th>
                    <th>{pT('heads.type')}</th>
                    <th className={styles.num}>{pT('structures.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {heads.map((h, i) => (
                    <tr key={h.id}>
                      <td>{h.name}</td>
                      <td className={styles.sub}>
                        {h.calc === 'percent' ? pT('structures.pctHint', { pct: h.percent ?? 0 }) : h.calc === 'production' ? pT('structures.rateHint') : h.calc === 'attendance' ? pT('structures.attHint') : h.calc === 'user' ? pT('structures.userHint') : h.calc === 'computed' ? pT('calc.computed') : pT('calc.flat')}
                      </td>
                      <td className={styles.num}>
                        <input
                          className={`${controls.inputNumeric} ${styles.cell}`}
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          data-row={i}
                          data-col="amt"
                          aria-label={pT('structures.amountFor', { name: h.name })}
                          placeholder={h.calc === 'percent' || h.calc === 'computed' ? pT('structures.include') : '-'}
                          value={current.amounts[h.id] ?? ''}
                          onKeyDown={gridKeyDown}
                          onChange={(e) => setDraft({ ...current, amounts: { ...current.amounts, [h.id]: e.target.value } })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>{pT('structures.monthlyFixed')}</td>
                    <td className={styles.num}>{inr(monthly)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className={styles.note}>{pT('structures.hint')}</p>
            <div className={styles.inline}>
              <button type="button" className={controls.btnPrimary} onClick={save}>
                <Save size={15} /> {pT('structures.save')}
              </button>
              {current.id && (
                <button
                  type="button"
                  className={controls.btnOutline}
                  onClick={() => {
                    try {
                      deleteStructure(current.id!);
                      setDraft(null);
                      refresh();
                      notify(pT('structures.deleted'));
                    } catch (err) {
                      notify((err as Error).message, 'error');
                    }
                  }}
                >
                  <Trash2 size={15} /> {pT('delete')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
