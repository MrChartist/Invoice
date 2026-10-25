import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { useInstallPrompt } from '../../lib/pwa';
import { readRaw, writeRaw } from '../../lib/storage';
import { useT } from '../../i18n';
import { pwaT } from '../../i18n/areas/pwa';
import controls from '../../styles/controls.module.css';
import styles from './Pwa.module.css';

const DISMISS_KEY = 'mrchartist_inv_install_dismissed';

function wasDismissed(): boolean {
  try {
    return readRaw(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export interface InstallPromptProps {
  /**
   * 'banner' (default): floating dismissible card.
   * 'button': a compact button for the sidebar / topbar (renders nothing when not installable).
   */
  variant?: 'banner' | 'button';
}

export function InstallPrompt({ variant = 'banner' }: InstallPromptProps) {
  useT(); // re-render on a language switch (5.4)
  const { canInstall, showIosHint, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [iosOpen, setIosOpen] = useState(false);

  if (!canInstall && !showIosHint) return null;

  if (variant === 'button') {
    return (
      <>
        <button
          type="button"
          className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`}
          onClick={() => (canInstall ? void install() : setIosOpen((v) => !v))}
          aria-expanded={showIosHint ? iosOpen : undefined}
        >
          <Download size={14} aria-hidden="true" /> {pwaT('installApp')}
        </button>
        {iosOpen && showIosHint && (
          <p className={styles.desc} role="note">
            {pwaT('iosTap')} <Share size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> {pwaT('iosShareThen')}{' '}
            <strong>{pwaT('addHome')}</strong>.
          </p>
        )}
      </>
    );
  }

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      writeRaw(DISMISS_KEY, '1');
    } catch {
      /* session-only dismissal is fine */
    }
  };

  return (
    <div className={styles.dock}>
      <section className={styles.banner} role="region" aria-label={pwaT('installApp')}>
        <span className={styles.icon} aria-hidden="true">
          {canInstall ? <Download size={16} /> : <Share size={16} />}
        </span>
        <div className={styles.text}>
          <p className={styles.title}>{pwaT('installTitle')}</p>
          {canInstall ? (
            <>
              <p className={styles.desc}>{pwaT('installDesc')}</p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
                  onClick={async () => {
                    const outcome = await install();
                    if (outcome === 'dismissed') dismiss();
                  }}
                >
                  {pwaT('install')}
                </button>
                <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={dismiss}>
                  {pwaT('notNow')}
                </button>
              </div>
            </>
          ) : (
            <p className={styles.desc}>
              {pwaT('iosTap')} <Share size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> {pwaT('iosShareSafari')}{' '}
              <strong>{pwaT('addHome')}</strong> {pwaT('addHomeTail')}
            </p>
          )}
        </div>
        <button type="button" className={styles.close} onClick={dismiss} aria-label={pwaT('dismissInstall')}>
          <X size={16} />
        </button>
      </section>
    </div>
  );
}
