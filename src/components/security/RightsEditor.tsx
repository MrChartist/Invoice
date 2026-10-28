import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { POS_CASHIER, RIGHT_DOCS, RIGHT_OPS, cleanRights, setUserRights, type RightDoc, type RightOp, type UserRights } from '../../lib/user-rights';
import { useT } from '../../i18n';
import { rightsT } from '../../i18n/areas/rights';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

interface Props {
  user: { id: string; name: string; rights?: UserRights };
  onClose: (saved: boolean) => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

/** Owner-only editor of one clerk / viewer's finer rights (8H). Saved on the device-local user record; audited. */
export function RightsEditor({ user, onClose, notify }: Props) {
  useT();
  const [r, setR] = useState<UserRights>(() => user.rights ?? {});
  const allowed = (d: RightDoc, op: RightOp) => r.docs?.[d]?.[op] !== false;
  const flip = (d: RightDoc, op: RightOp) => {
    const docs = { ...(r.docs ?? {}) };
    const row = { ...(docs[d] ?? {}) };
    if (allowed(d, op)) row[op] = false;
    else delete row[op];
    docs[d] = row;
    setR({ ...r, docs, preset: 'custom' });
  };
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const save = () => {
    try {
      setUserRights(user.id, cleanRights(r));
      notify(rightsT('saved', { name: user.name }));
      onClose(true);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <Modal
      open
      onClose={() => onClose(false)}
      size="md"
      title={rightsT('title', { name: user.name })}
      footer={
        <>
          <button type="button" className={controls.btnGhost} onClick={() => setR({})}>{rightsT('clear')}</button>
          <button type="button" className={controls.btnOutline} onClick={() => setR(POS_CASHIER)}>{rightsT('preset')}</button>
          <button type="button" className={controls.btnPrimary} onClick={save}>{rightsT('save')}</button>
        </>
      }
    >
      <p className={controls.hint}>{rightsT('note')}</p>
      <table className={surface.table}>
        <thead>
          <tr>
            <th />
            {RIGHT_OPS.map((op) => <th key={op}>{rightsT(`op.${op}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          {RIGHT_DOCS.map((d) => (
            <tr key={d}>
              <td>{rightsT(`doc.${d}`)}</td>
              {RIGHT_OPS.map((op) => (
                <td key={op}>
                  <input type="checkbox" checked={allowed(d, op)} onChange={() => flip(d, op)} aria-label={`${rightsT(`doc.${d}`)}: ${rightsT(`op.${op}`)}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={controls.row}>
        <label className={controls.field}>
          <span className={controls.label}>{rightsT('backDays')}</span>
          <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="numeric" value={r.back_days ?? ''} onChange={(e) => setR({ ...r, back_days: num(e.target.value) })} />
          <span className={controls.hint}>{rightsT('backDaysHint')}</span>
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{rightsT('discountCap')}</span>
          <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={r.discount_cap ?? ''} onChange={(e) => setR({ ...r, discount_cap: num(e.target.value) })} />
          <span className={controls.hint}>{rightsT('discountHint')}</span>
        </label>
      </div>
      <label className={controls.check}>
        <input type="checkbox" checked={!!r.pos_only} onChange={(e) => setR({ ...r, pos_only: e.target.checked || undefined })} /> {rightsT('posOnly')}
      </label>
    </Modal>
  );
}
