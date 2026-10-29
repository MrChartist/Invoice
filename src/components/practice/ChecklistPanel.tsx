import { useMemo, useState } from 'react';
import { checklistDb, monthChecklist, progress } from '../../lib/client-checklist';
import { currentActor } from '../../lib/access';
import { todayIso } from '../../lib/tax-rules';
import { useT } from '../../i18n';
import { dkT } from '../../i18n/areas/desks-r3';
import { checklistLabel } from '../../i18n/areas/desks-checklist';
import controls from '../../styles/controls.module.css';
import styles from './practice.module.css';

/** R3-C6 monthly client checklist of the open company: tick per month; unticked items carry over. */
export function ChecklistPanel({ onChanged }: { onChanged?: () => void }) {
  useT();
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const template = useMemo(() => checklistDb.template(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState(() => template.join('\n'));
  const [asDefault, setAsDefault] = useState(false);
  const list = useMemo(() => monthChecklist(checklistDb.months(), month, template), [month, template, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = progress(list);
  const changed = () => {
    setTick((t) => t + 1);
    onChanged?.();
  };
  return (
    <section className={styles.section} data-client-checklist>
      <h3 className={styles.head}>{dkT('ck.title')} <span className={styles.note}>{dkT('ck.progress', { done: p.done, total: p.total })}</span></h3>
      <div className={styles.row}>
        <label className={controls.field}>
          <span className={controls.label}>{dkT('ck.month')}</span>
          <input className={controls.input} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => { setDraft(template.join('\n')); setEditing((v) => !v); }}>{dkT('ck.editTemplate')}</button>
      </div>
      <ul className={styles.list}>
        {list.items.map((i) => (
          <li key={i.id} className={styles.item}>
            <label className={controls.check}>
              <input type="checkbox" checked={!!i.done_at} onChange={() => { checklistDb.toggle(month, i.id, currentActor()?.name ?? ''); changed(); }} data-check-item={i.id} />
              {checklistLabel(i.label)}
            </label>
            {i.carried && <span className={styles.flag}>{dkT('ck.carried', { month: i.carried })}</span>}
          </li>
        ))}
      </ul>
      {editing && (
        <div className={styles.stack}>
          <label className={controls.field}>
            <span className={controls.label}>{dkT('ck.templateLabel')}</span>
            <textarea className={controls.textarea} rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </label>
          <label className={controls.check}>
            <input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} /> {dkT('ck.deviceDefault')}
          </label>
          <div className={styles.row}>
            <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => { checklistDb.setTemplate(draft.split('\n'), asDefault); setEditing(false); changed(); }}>{dkT('save')}</button>
            <span className={styles.note}>{dkT('ck.templateNote')}</span>
          </div>
        </div>
      )}
    </section>
  );
}
