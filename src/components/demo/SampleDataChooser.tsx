import { useState } from 'react';
import { FlaskConical, Store, Trash2 } from 'lucide-react';
import { companiesSupported } from '../../lib/companies';
import { localDb } from '../../lib/localDb';
import { demoProfileFor, demoStatus, removeDemoData } from '../../lib/demo-data';
import { reloadAfterFlush } from '../../lib/storage';
import { isDemoCompanyOpen, startDemoCompany } from '../onboarding/demo-company';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useT } from '../../i18n';
import { discoverT } from '../../i18n/areas/discover-r6';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

/**
 * R6-B4 "Try with sample data" — one path for the Dashboard and Settings → Data (the wizard uses the same
 * `startDemoCompany`): samples always go to the separate, resettable Demo company, shaped like this company's business
 * (counter, services, trading, transport or works). Sample rows are never added to a real company. A company that
 * still holds samples from an earlier version can remove them here. `variant="card"` for Settings, inline otherwise.
 */
export function SampleDataChooser({ variant = 'inline' }: { variant?: 'inline' | 'card' }) {
  useT();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [legacy, setLegacy] = useState(() => !isDemoCompanyOpen() && demoStatus().loaded);
  const supported = companiesSupported();
  const profile = demoProfileFor(localDb.settings.get());

  const open = () => {
    setBusy(true);
    if (!startDemoCompany()) setBusy(false);
  };
  const remove = () => {
    setConfirm(false);
    removeDemoData();
    setLegacy(false);
    reloadAfterFlush();
  };

  const body = (
    <>
      <p className={surface.sectionNote}>{discoverT('sampleText')}</p>
      {supported ? (
        <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className={controls.btnOutline} onClick={open} disabled={busy} data-sample-demo>
            <Store size={16} aria-hidden="true" /> {busy ? discoverT('sampleBusy') : discoverT('sampleDemo')}
          </button>
          <span className={controls.hint}>{discoverT('sampleDemoHint', { profile: discoverT(`profile.${profile}`) })}</span>
        </div>
      ) : (
        <p className={controls.hint} role="note">{discoverT('sampleNoCompanies')}</p>
      )}
      {legacy && (
        <p className={controls.hint}>
          {discoverT('sampleInThis')}{' '}
          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setConfirm(true)}>
            <Trash2 size={14} aria-hidden="true" /> {discoverT('sampleRemove')}
          </button>
        </p>
      )}
      <ConfirmDialog
        open={confirm}
        destructive
        title={discoverT('sampleRemove')}
        message={discoverT('sampleInThis')}
        confirmLabel={discoverT('sampleRemove')}
        onConfirm={remove}
        onClose={() => setConfirm(false)}
      />
    </>
  );

  if (variant === 'card') {
    return (
      <section className={surface.card} data-testid="sample-data-card">
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <FlaskConical size={16} aria-hidden="true" /> {discoverT('sampleTitle')}
          </span>
        </div>
        <div className={surface.cardBody}>{body}</div>
      </section>
    );
  }
  return <div data-sample-chooser>{body}</div>;
}

export default SampleDataChooser;
