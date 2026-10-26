import { useState } from 'react';
import { Modal } from '../ui/Modal';
import type { ModifierGroup } from '../../types/restaurant';
import { validatePicks, type Picks } from '../../lib/restaurant/modifiers';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { rT } from '../../i18n/areas/restaurant';
import controls from '../../styles/controls.module.css';
import styles from './restaurant.module.css';

export interface ModifierPickerProps {
  name: string;
  groups: readonly ModifierGroup[];
  onClose: () => void;
  onPick: (picks: Picks) => void;
}

/** Compact picker for an item's modifier groups (R3-A4); required groups block adding. */
export function ModifierPicker({ name, groups, onClose, onPick }: ModifierPickerProps) {
  useT();
  const [picks, setPicks] = useState<Picks>({});
  const errors = validatePicks(groups, picks);
  const toggle = (g: ModifierGroup, id: string) =>
    setPicks((cur) => {
      const now = cur[g.id] ?? [];
      const single = Math.floor(g.max) === 1;
      const next = now.includes(id) ? now.filter((x) => x !== id) : single ? [id] : [...now, id];
      return { ...cur, [g.id]: next };
    });
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={rT('modTitle', { name })}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{rT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} disabled={errors.length > 0} onClick={() => onPick(picks)} data-mod-add>{rT('modAdd')}</button>
        </>
      }
    >
      <div className={styles.settingsGrid}>
        {groups.map((g) => (
          <fieldset key={g.id} className={styles.groupCard}>
            <legend className={controls.label}>
              {g.name} {g.min > 0 && <span className={styles.chip}>{rT('modReq')}</span>} {g.max > 1 && <span className={styles.small}>{rT('modUpTo', { n: g.max })}</span>}
            </legend>
            {g.options.map((o) => (
              <label key={o.id} className={controls.check}>
                <input type={Math.floor(g.max) === 1 ? 'radio' : 'checkbox'} name={`mod-${g.id}`} checked={(picks[g.id] ?? []).includes(o.id)} onChange={() => toggle(g, o.id)} />
                {o.name}{o.price > 0 ? ` +${formatCurrency(o.price)}` : ''}
              </label>
            ))}
          </fieldset>
        ))}
        {errors.length > 0 && <p className={styles.warn} role="status">{errors[0]}</p>}
      </div>
    </Modal>
  );
}
