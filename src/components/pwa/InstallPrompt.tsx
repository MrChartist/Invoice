import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { useInstallPrompt } from '../../lib/pwa';
import controls from '../../styles/controls.module.css';
import styles from './Pwa.module.css';

const DISMISS_KEY = 'mrchartist_inv_install_dismissed';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
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
          <Download size={14} aria-hidden="true" /> Install app
        </button>
        {iosOpen && showIosHint && (
          <p className={styles.desc} role="note">
            Tap <Share size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> Share, then{' '}
            <strong>Add to Home Screen</strong>.
          </p>
        )}
      </>
    );
  }

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* session-only dismissal is fine */
    }
  };

  return (
    <div className={styles.dock}>
      <section className={styles.banner} role="region" aria-label="Install app">
        <span className={styles.icon} aria-hidden="true">
          {canInstall ? <Download size={16} /> : <Share size={16} />}
        </span>
        <div className={styles.text}>
          <p className={styles.title}>Install Mr. Chartist Invoice</p>
          {canInstall ? (
            <>
              <p className={styles.desc}>Works fully offline, opens in its own window and keeps your data on this device.</p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
                  onClick={async () => {
                    const outcome = await install();
                    if (outcome === 'dismissed') dismiss();
                  }}
                >
                  Install
                </button>
                <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={dismiss}>
                  Not now
                </button>
              </div>
            </>
          ) : (
            <p className={styles.desc}>
              Tap <Share size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> Share in Safari, then{' '}
              <strong>Add to Home Screen</strong> to use it like an app, offline.
            </p>
          )}
        </div>
        <button type="button" className={styles.close} onClick={dismiss} aria-label="Dismiss install prompt">
          <X size={16} />
        </button>
      </section>
    </div>
  );
}
