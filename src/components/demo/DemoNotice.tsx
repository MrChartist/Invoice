import { reloadAfterFlush } from '../../lib/storage';
import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { demoStatus, removeDemoData } from '../../lib/demo-data';
import { switchCompany } from '../../lib/companies';
import { companyToReturnTo, isDemoCompanyOpen, resetDemoSamples, useDemoPending } from '../onboarding/demo-company';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import controls from '../../styles/controls.module.css';
import styles from './demo.module.css';
import { useT } from '../../i18n';
import { demoT } from '../../i18n/areas/demo';
import { discoverT } from '../../i18n/areas/discover-r6';

/**
 * Banner for the Dashboard (and anywhere else): "You are looking at sample data".
 * R6-B4: in the Demo company it says the company is a sample, offers the way back to the user's own company and
 * "Reset samples" (rebuilt with today's dates); it also finishes a pending "Try with sample data" when the Demo
 * company already existed (the wizard does it for a new one). In any other company it is the old banner for sample
 * rows loaded by an earlier version, with "Remove". Renders nothing when there is no sample row. `compact` gives a
 * small "Demo data" pill.
 */
export function DemoNotice({ compact, onRemoved }: { compact?: boolean; onRemoved?: () => void }) {
  useT(); // re-render on a language switch (5.4)
  useDemoPending(() => undefined);
  const [status, setStatus] = useState(() => demoStatus());
  const [confirm, setConfirm] = useState<'remove' | 'reset' | null>(null);
  const [busy, setBusy] = useState(false);
  const inDemo = isDemoCompanyOpen();
  if (!status.loaded && !inDemo) return null;

  const remove = () => {
    setConfirm(null);
    removeDemoData();
    setStatus(demoStatus());
    if (onRemoved) onRemoved();
    else reloadAfterFlush();
  };
  const reset = () => {
    setConfirm(null);
    setBusy(true);
    void resetDemoSamples().then(reloadAfterFlush, () => setBusy(false));
  };

  if (compact) {
    return (
      <span className={styles.pill} title={demoT('pillTitle')}>
        <FlaskConical size={12} aria-hidden="true" /> {demoT('demo')}
      </span>
    );
  }
  if (inDemo) {
    const own = companyToReturnTo(); // QA7: the company the user came from
    return (
      <div className={styles.banner} role="status" data-testid="demo-notice" data-demo-company>
        <FlaskConical size={18} aria-hidden="true" className={styles.icon} />
        <div className={styles.text}>
          <strong>{discoverT('bannerTitle')}</strong>
          {status.loaded && <span>{demoT('text', { n: status.counts.invoices })}</span>}
        </div>
        {own && (
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => switchCompany(own.id)}>
            {discoverT('bannerSwitch', { name: own.name || discoverT('bannerMine') })}
          </button>
        )}
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setConfirm('reset')} disabled={busy}>
          {discoverT('bannerReset')}
        </button>
        <ConfirmDialog
          open={confirm === 'reset'}
          title={discoverT('resetTitle')}
          message={discoverT('resetMsg')}
          confirmLabel={discoverT('bannerReset')}
          onConfirm={reset}
          onClose={() => setConfirm(null)}
        />
      </div>
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
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setConfirm('remove')}>
        {demoT('remove')}
      </button>
      <ConfirmDialog
        open={confirm === 'remove'}
        destructive
        title={demoT('confirmTitle')}
        message={demoT('confirmMsg')}
        confirmLabel={demoT('remove')}
        onConfirm={remove}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
