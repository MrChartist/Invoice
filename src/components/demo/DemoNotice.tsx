import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { demoStatus, removeDemoData } from '../../lib/demo-data';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import controls from '../../styles/controls.module.css';
import styles from './demo.module.css';

/**
 * Banner for the Dashboard (and anywhere else): "You are looking at sample data".
 * Renders nothing when no demo rows exist. `compact` gives a small "Demo data" pill.
 */
export function DemoNotice({ compact, onRemoved }: { compact?: boolean; onRemoved?: () => void }) {
  const [status, setStatus] = useState(() => demoStatus());
  const [confirm, setConfirm] = useState(false);
  if (!status.loaded) return null;

  const remove = () => {
    setConfirm(false);
    removeDemoData();
    setStatus(demoStatus());
    if (onRemoved) onRemoved();
    else window.location.reload();
  };

  if (compact) {
    return (
      <span className={styles.pill} title="Sample records are on this device. Remove them in Settings, Data.">
        <FlaskConical size={12} aria-hidden="true" /> Demo data
      </span>
    );
  }
  return (
    <div className={styles.banner} role="status" data-testid="demo-notice">
      <FlaskConical size={18} aria-hidden="true" className={styles.icon} />
      <div className={styles.text}>
        <strong>Demo data</strong>
        <span>
          You are looking at a fictional business ({status.counts.invoices} sample invoices). Nothing here is real.
        </span>
      </div>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setConfirm(true)}>
        Remove sample data
      </button>
      <ConfirmDialog
        open={confirm}
        destructive
        title="Remove sample data?"
        message="This deletes the sample records only. Anything you created yourself is kept."
        confirmLabel="Remove sample data"
        onConfirm={remove}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}
