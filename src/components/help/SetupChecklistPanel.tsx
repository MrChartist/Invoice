/** R6-A1 Help → "Setup checklist": every step for this company and role (skipped ones too) and "Un-hide card". */
import { useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { useT } from '../../i18n';
import { helpT } from '../../i18n/areas/help-r6';
import { reachT } from '../../i18n/areas/reach';
import { allSteps, loadSetupProgress, readChecklistInputs, saveSetupProgress, withSkipped } from '../../lib/checklist-steps';
import { stepLabel } from './labels';
import controls from '../../styles/controls.module.css';
import styles from './help.module.css';

export default function SetupChecklistPanel({ onNavigate }: { onNavigate: (href: string) => void }) {
  useT();
  const [{ facts, ctx }] = useState(readChecklistInputs);
  const [progress, setProgress] = useState(loadSetupProgress);
  const [error, setError] = useState('');
  const steps = allSteps(facts, ctx, progress);
  const save = (next: typeof progress) => {
    try {
      setProgress(saveSetupProgress(next));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!steps.length) return <p className={styles.muted}>{helpT('noSteps')}</p>;
  return (
    <div className={styles.stack} data-setup-panel>
      <ul className={styles.links}>
        {steps.map((s) => (
          <li key={s.key} className={styles.stepRow}>
            <button type="button" className={styles.linkBtn} onClick={() => onNavigate(s.to)} data-help-step={s.key}>
              {s.done ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
              <span className={styles.linkTitle}>{stepLabel(s)}{s.skipped ? <span className={styles.stepSkip}> · {reachT('ck.skipped')}</span> : null}</span>
            </button>
            {s.skipped ? (
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => save(withSkipped(progress, s.key, false))}>{reachT('ck.unskip')}</button>
            ) : !s.done ? (
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => save(withSkipped(progress, s.key, true))}>{reachT('ck.skip')}</button>
            ) : null}
          </li>
        ))}
      </ul>
      {progress.hidden_at && (
        <p className={styles.muted}>
          {helpT('hiddenNote')}{' '}
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => save({ skipped: progress.skipped })} data-unhide-checklist>{helpT('unhide')}</button>
        </p>
      )}
      {error && <p role="alert" className={styles.muted}>{error}</p>}
    </div>
  );
}
