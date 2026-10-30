import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  deleteAttendanceType,
  deletePayHead,
  loadAttendanceTypes,
  loadPayHeads,
  saveAttendanceType,
  savePayHead,
  validatePayHead,
  type PayHeadInput,
} from '../../lib/payroll/store';
import { defaultAccount } from '../../lib/payroll/compute';
import { chartOf, groupOf, loadUserAccounts } from '../../lib/ledger/accounts';
import { OT_HOURS_TYPE, type PayHead, type PayHeadCalc, type PayHeadKind } from '../../types/payroll';
import { Modal } from '../ui/Modal';
import { payrollT as pT } from '../../i18n/areas/payroll';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Payroll.module.css';
import { SelectField } from '../ui/SelectField';

interface Props {
  version: number;
  refresh: () => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

const KIND_KEY = { earning: 'kind.earning', deduction: 'kind.deduction', employer: 'kind.employer' } as const;
const CALC_KEY = { flat: 'calc.flat', attendance: 'calc.attendance', percent: 'calc.percent', production: 'calc.production', computed: 'calc.computed', user: 'calc.user' } as const;

export function PayHeadsTab({ version, refresh, notify }: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const heads = useMemo(() => loadPayHeads(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const types = useMemo(() => loadAttendanceTypes(), [version]);
  const chart = useMemo(() => chartOf(loadUserAccounts()), []);
  const [editing, setEditing] = useState<PayHeadInput | null>(null);
  const [typeName, setTypeName] = useState('');
  const [typeUnit, setTypeUnit] = useState('');

  const act = (fn: () => void, ok: string) => {
    try {
      fn();
      refresh();
      notify(ok);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const unitName = (id?: string) => (id === OT_HOURS_TYPE ? pT('att.ot') : types.find((t) => t.id === id)?.name ?? '');
  const sorted = [...heads].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));

  return (
    <div className={styles.stack}>
      <section className={surface.card}>
        <div className={styles.toolbar}>
          <h2 className={styles.h2}>{pT('heads.title')}</h2>
          <button type="button" className={controls.btnPrimary} onClick={() => setEditing({ name: '', kind: 'earning', calc: 'attendance', active: true, order: 10 })}>
            <Plus size={16} /> {pT('heads.add')}
          </button>
        </div>
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <caption className={surface.srOnly}>{pT('heads.title')}</caption>
            <thead>
              <tr>
                <th>{pT('f.name')}</th>
                <th>{pT('heads.type')}</th>
                <th>{pT('heads.calc')}</th>
                <th>{pT('heads.account')}</th>
                <th>{pT('heads.flags')}</th>
                <th className={styles.num}>{pT('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => {
                const acc = chart.find((a) => a.id === (h.account_id || defaultAccount(h)));
                return (
                  <tr key={h.id} className={h.active ? undefined : styles.muted}>
                    <td>{h.name}{!h.active && <span className={styles.sub}>{pT('status.inactive')}</span>}</td>
                    <td>{pT(KIND_KEY[h.kind])}</td>
                    <td>
                      {h.statutory ? pT('calc.statutory') : pT(CALC_KEY[h.calc])}
                      {h.calc === 'percent' && <span className={styles.sub}>{h.percent}% · {(h.base_heads ?? []).map((id) => heads.find((x) => x.id === id)?.name).filter(Boolean).join(' + ')}</span>}
                      {h.calc === 'production' && <span className={styles.sub}>{unitName(h.unit_type)}</span>}
                    </td>
                    <td>{acc ? `${acc.code} ${acc.name}` : h.account_id}</td>
                    <td className={styles.sub}>{[h.pf_wage && pT('f.pfWage'), h.kind === 'earning' && h.esi_wage !== false && pT('f.esiWage'), h.kind === 'earning' && h.taxable === false && pT('f.exempt')].filter(Boolean).join(' · ')}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <button type="button" className={controls.btnIcon} aria-label={pT('heads.edit', { name: h.name })} title={pT('edit')} onClick={() => setEditing({ ...h })}>
                          <Pencil size={15} />
                        </button>
                        {!h.statutory && (
                          <button type="button" className={controls.btnDanger} aria-label={pT('heads.delete', { name: h.name })} title={pT('delete')} onClick={() => act(() => deletePayHead(h.id), pT('heads.deleted'))}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>{pT('heads.hint')}</p>
      </section>

      <section className={surface.card}>
        <div className={surface.cardBody}>
          <h2 className={styles.h2}>{pT('types.title')}</h2>
          <p className={styles.note}>{pT('types.hint')}</p>
          <ul className={styles.chips}>
            <li className={styles.chip}>{pT('att.ot')} ({pT('att.hours')})</li>
            {types.map((t) => (
              <li key={t.id} className={styles.chip}>
                {t.name} ({t.unit})
                <button type="button" className={controls.btnIcon} aria-label={pT('types.delete', { name: t.name })} onClick={() => act(() => deleteAttendanceType(t.id), pT('types.deleted'))}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
          <form
            className={styles.inline}
            onSubmit={(e) => {
              e.preventDefault();
              act(() => saveAttendanceType({ name: typeName, unit: typeUnit }), pT('types.added'));
              setTypeName('');
              setTypeUnit('');
            }}
          >
            <label className={controls.field}>
              <span className={controls.label}>{pT('types.name')}</span>
              <input className={controls.input} value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder={pT('types.placeholder')} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{pT('types.unit')}</span>
              <input className={controls.input} value={typeUnit} onChange={(e) => setTypeUnit(e.target.value)} placeholder="pcs" />
            </label>
            <button type="submit" className={controls.btnOutline} disabled={!typeName.trim()}>
              <Plus size={15} /> {pT('types.addBtn')}
            </button>
          </form>
        </div>
      </section>

      {editing && (
        <PayHeadModal
          initial={editing}
          heads={heads}
          types={types}
          chart={chart}
          onClose={() => setEditing(null)}
          onSave={(input) => {
            try {
              const row = savePayHead(input);
              setEditing(null);
              refresh();
              notify(pT('heads.saved', { name: row.name }));
            } catch (err) {
              notify((err as Error).message, 'error');
            }
          }}
        />
      )}
    </div>
  );
}

function PayHeadModal({
  initial,
  heads,
  types,
  chart,
  onClose,
  onSave,
}: {
  initial: PayHeadInput;
  heads: PayHead[];
  types: { id: string; name: string }[];
  chart: ReturnType<typeof chartOf>;
  onClose: () => void;
  onSave: (h: PayHeadInput) => void;
}) {
  const [f, setF] = useState<PayHeadInput>(initial);
  const [tried, setTried] = useState(false);
  const errors = validatePayHead(f, heads);
  const set = <K extends keyof PayHeadInput>(k: K, v: PayHeadInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const statutory = !!f.statutory;
  const accounts = chart.filter((a) => {
    const n = groupOf(a.group).nature;
    return f.kind === 'deduction' ? n === 'liability' || n === 'asset' : n === 'expense';
  });
  const slabText = (f.slabs ?? []).map((s) => `${s.up_to ?? ''}:${s.value}${s.percent ? '%' : ''}`).join('\n');
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={initial.id ? pT('heads.editTitle') : pT('heads.addTitle')}
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
            {pT('heads.saveBtn')}
          </button>
        </>
      }
    >
      <div className={styles.formGrid}>
        <label className={controls.field}>
          <span className={controls.label}>{pT('f.name')} *</span>
          <input className={controls.input} value={f.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{pT('heads.type')}</span>
          <SelectField className={controls.select} value={f.kind} disabled={statutory} onChange={(e) => set('kind', e.target.value as PayHeadKind)}>
            {(['earning', 'deduction', 'employer'] as const).map((k) => <option key={k} value={k}>{pT(KIND_KEY[k])}</option>)}
          </SelectField>
        </label>
        {!statutory && (
          <label className={controls.field}>
            <span className={controls.label}>{pT('heads.calc')}</span>
            <SelectField className={controls.select} value={f.calc} onChange={(e) => set('calc', e.target.value as PayHeadCalc)}>
              {(['attendance', 'flat', 'percent', 'production', 'computed', 'user'] as const).map((c) => <option key={c} value={c}>{pT(CALC_KEY[c])}</option>)}
            </SelectField>
          </label>
        )}
        <label className={controls.field}>
          <span className={controls.label}>{pT('heads.account')}</span>
          <SelectField className={controls.select} value={f.account_id ?? ''} onChange={(e) => set('account_id', e.target.value || undefined)}>
            <option value="">{pT('heads.defaultAccount')}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </SelectField>
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{pT('heads.order')}</span>
          <input className={controls.inputNumeric} type="number" value={f.order ?? 0} onChange={(e) => set('order', Number(e.target.value))} />
        </label>
        {f.calc === 'percent' && !statutory && (
          <label className={controls.field}>
            <span className={controls.label}>{pT('heads.percent')}</span>
            <input className={controls.inputNumeric} type="number" min="0" step="0.01" value={f.percent ?? ''} onChange={(e) => set('percent', Number(e.target.value))} />
          </label>
        )}
        {f.calc === 'production' && !statutory && (
          <label className={controls.field}>
            <span className={controls.label}>{pT('heads.unitType')}</span>
            <SelectField className={controls.select} value={f.unit_type ?? ''} onChange={(e) => set('unit_type', e.target.value || undefined)}>
              <option value="">-</option>
              <option value={OT_HOURS_TYPE}>{pT('att.ot')}</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </SelectField>
          </label>
        )}
      </div>
      {(f.calc === 'percent' || f.calc === 'computed') && !statutory && (
        <fieldset className={styles.fieldset}>
          <legend className={controls.label}>{pT('heads.base')}</legend>
          <div className={styles.checks}>
            {heads.filter((h) => h.id !== f.id && h.kind === 'earning').map((h) => (
              <label key={h.id} className={controls.check}>
                <input
                  type="checkbox"
                  checked={(f.base_heads ?? []).includes(h.id)}
                  onChange={(e) => set('base_heads', e.target.checked ? [...(f.base_heads ?? []), h.id] : (f.base_heads ?? []).filter((x) => x !== h.id))}
                />{' '}
                {h.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {f.calc === 'computed' && !statutory && (
        <label className={controls.field}>
          <span className={controls.label}>{pT('heads.slabs')}</span>
          <textarea
            className={controls.textarea}
            rows={4}
            defaultValue={slabText}
            onBlur={(e) =>
              set(
                'slabs',
                e.target.value.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => {
                  const [up, val] = x.split(':');
                  const pct = (val ?? '').trim().endsWith('%');
                  return { up_to: up.trim() === '' ? null : Number(up), value: Number((val ?? '0').replace('%', '')), ...(pct ? { percent: true } : {}) };
                }),
              )
            }
          />
          <span className={controls.hint}>{pT('heads.slabsHint')}</span>
        </label>
      )}
      {f.kind === 'earning' && (
        <div className={styles.checks}>
          <label className={controls.check}><input type="checkbox" checked={!!f.pf_wage} onChange={(e) => set('pf_wage', e.target.checked)} /> {pT('f.pfWage')}</label>
          <label className={controls.check}><input type="checkbox" checked={f.esi_wage !== false} onChange={(e) => set('esi_wage', e.target.checked)} /> {pT('f.esiWage')}</label>
          <label className={controls.check}><input type="checkbox" checked={f.taxable !== false} onChange={(e) => set('taxable', e.target.checked)} /> {pT('f.taxable')}</label>
        </div>
      )}
      {f.kind === 'employer' && !f.statutory && (
        <div className={styles.checks}>
          <label className={controls.check}><input type="checkbox" checked={!!f.nps} onChange={(e) => set('nps', e.target.checked)} /> {pT('f.nps')}</label>
          <label className={controls.check}><input type="checkbox" checked={!!f.superannuation} onChange={(e) => set('superannuation', e.target.checked)} /> {pT('f.super')}</label>
        </div>
      )}
      <label className={controls.check}><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> {pT('f.active')}</label>
      {statutory && <p className={styles.note}>{pT('heads.statutoryHint')}</p>}
      {tried && errors.length > 0 && <p className={controls.error} role="alert">{errors[0]}</p>}
    </Modal>
  );
}
