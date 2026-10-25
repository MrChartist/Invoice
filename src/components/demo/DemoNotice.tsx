import { reloadAfterFlush } from '../../lib/storage';
import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { demoStatus, removeDemoData } from '../../lib/demo-data';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import controls from '../../styles/controls.module.css';
import styles from './demo.module.css';
import { useT } from '../../i18n';
import { demoT } from '../../i18n/areas/demo';

/**
 * Banner for the Dashboard (and anywhere else): "You are looking at sample data".
 * Renders nothing when no demo rows exist. `compact` gives a small "Demo data" pill.
 */
export function DemoNotice({ compact, onRemoved }: { compact?: boolean; onRemoved?: () => void }) {
  useT(); // re-render on a language switch (5.4)
  const [status, setStatus] = useState(() => demoStatus());
  const [confirm, setConfirm] = useState(false);
  if (!status.loaded) return null;

  const remove = () => {
    setConfirm(false);
    removeDemoData();
    setStatus(demoStatus());
    if (onRemoved) onRemoved();
    else reloadAfterFlush();
  };

  if (compact) {
    return (
      <span className={styles.pill} title={demoT('pillTitle')}>
        <FlaskConical size={12} aria-hidden="true" /> {demoT('demo')}
      </span>
    );
  }
  return (
    <div className={styles.banner} role="status" data-testid="demo-notice">
      <FlaskConical size={18} aria-hidden="true" className={styles.icon} />
      <div className={styles.text}>
        <strong>{demoT('demo')}</strong>
        <span>
          {demoT('text', { n: status.counts.invoices })}
        </span>
      </div>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setConfirm(true)}>
        {demoT('remove')}
      </button>
      <ConfirmDialog
        open={confirm}
        destructive
        title={demoT('confirmTitle')}
        message={demoT('confirmMsg')}
        confirmLabel={demoT('remove')}
        onConfirm={remove}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}
