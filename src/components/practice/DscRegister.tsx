import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DSC_ROLES, dscDb, dscStatus, daysToExpiry, type DscRole, type DscRow } from '../../lib/dsc-register';
import { todayIso } from '../../lib/tax-rules';
import { formatDate } from '../../lib/utils';
import { useT } from '../../i18n';
import { dkT } from '../../i18n/areas/desks-r3';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './practice.module.css';

const BLANK: Partial<DscRow> = { holder: '', role: 'director', dsc_class: 'Class 3', token: '', issuer: '', valid_from: '', valid_to: '' };
const TONE = { expired: styles.bad, urgent: styles.bad, soon: styles.warn, ok: styles.ok } as const;

/** R3-C6 DSC register of the open company (company data; bell warns 30 / 7 days before expiry). */
export function DscRegister({ onChanged }: { onChanged?: () => void }) {
  useT();
  const [rows, setRows] = useState<DscRow[]>(() => dscDb.all());
  const [draft, setDraft] = useState<Partial<DscRow>>(BLANK);
  const [error, setError] = useState('');
  const today = todayIso();
  const reload = () => {
    setRows(dscDb.all());
    onChanged?.();
  };
  const save = () => {
    try {
      dscDb.save(draft);
      setDraft(BLANK);
      setError('');
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const field = (k: keyof DscRow, label: string, type = 'text') => (
    <label className={controls.field}>
      <span className={controls.label}>{label}</span>
      <input className={controls.input} type={type} value={String(draft[k] ?? '')} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} data-dsc-field={k} />
    </label>
  );
  return (
    <section className={styles.section} data-dsc-register>
      <h3 className={styles.head}>{dkT('dsc.title')}</h3>
      <p className={styles.note}>{dkT('dsc.intro')}</p>
      {rows.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{dkT('dsc.holder')}</th>
                <th scope="col">{dkT('dsc.role')}</th>
                <th scope="col">{dkT('dsc.class')}</th>
                <th scope="col">{dkT('dsc.token')}</th>
                <th scope="col">{dkT('dsc.validTo')}</th>
                <th scope="col"><span className={surface.srOnly}>{dkT('remove')}</span></th>
              </tr>
            </thead>
            <tbody>
              {[...rows].sort((a, b) => a.valid_to.localeCompare(b.valid_to)).map((r) => {
                const st = dscStatus(r, today);
                const d = daysToExpiry(r, today);
                return (
                  <tr key={r.id}>
                    <td>{r.holder}</td>
                    <td>{dkT(`dsc.r.${r.role}` as const)}</td>
                    <td>{r.dsc_class ?? '—'}</td>
                    <td>{[r.token, r.issuer].filter(Boolean).join(' · ') || '—'}</td>
                    <td className={TONE[st]}>{formatDate(r.valid_to)} <span className={styles.note}>{d < 0 ? dkT('dsc.expiredAgo', { n: -d }) : dkT('dsc.daysLeft', { n: d })}</span></td>
                    <td><button type="button" className={controls.btnIcon} aria-label={dkT('remove')} onClick={() => { dscDb.remove(r.id); reload(); }}><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.grid}>
        {field('holder', dkT('dsc.holder'))}
        <label className={controls.field}>
          <span className={controls.label}>{dkT('dsc.role')}</span>
          <select className={controls.select} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as DscRole })}>
            {DSC_ROLES.map((r) => <option key={r} value={r}>{dkT(`dsc.r.${r}` as const)}</option>)}
          </select>
        </label>
        {field('dsc_class', dkT('dsc.class'))}
        {field('token', dkT('dsc.token'))}
        {field('issuer', dkT('dsc.issuer'))}
        {field('valid_from', dkT('dsc.validFrom'), 'date')}
        {field('valid_to', dkT('dsc.validTo'), 'date')}
      </div>
      {error && <p className={controls.error} role="alert">{error}</p>}
      <div className={styles.row}>
        <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={save} data-dsc-save>{dkT('dsc.add')}</button>
      </div>
    </section>
  );
}
