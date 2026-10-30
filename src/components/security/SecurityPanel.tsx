import { useState } from 'react';
import { Info, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { ChangePinModal } from './ChangePinModal';
import { EncryptedBackup } from './EncryptedBackup';
import { VaultPanel } from './VaultPanel';
import { UsersPanel } from './UsersPanel';
import { useCan } from '../../hooks/useCan';
import { IDLE_CHOICES, getIdleTimeout, logout, setIdleTimeout } from '../../lib/auth';
import { daysSinceBackup, getLastBackup } from '../../lib/backup';
import { useT } from '../../i18n';
import { secT } from '../../i18n/areas/security';
import { roleLabel } from '../../i18n/labels';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Security.module.css';
import { SelectField } from '../ui/SelectField';

interface Props {
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  /** Called after "Lock now" has cleared the session — typically `() => setAuthed(false)`. */
  onLock?: () => void;
}

function idleLabel(minutes: number): string {
  if (minutes === 0) return secT('never');
  if (minutes < 60) return secT(minutes === 1 ? 'minuteOne' : 'minuteMany', { n: minutes });
  return secT(minutes === 60 ? 'hourOne' : 'hourMany', { n: minutes / 60 });
}

/**
 * Settings → Security: PIN, auto-lock, users, vault mode and encrypted backups. A clerk or viewer
 * (6.21) sees only their own PIN, "Lock now" and what their role allows.
 */
export function SecurityPanel({ notify, onLock }: Props) {
  useT(); // re-render on a language switch (5.4)
  const [pinOpen, setPinOpen] = useState(false);
  const [idle, setIdle] = useState(getIdleTimeout);
  const { can, role, actor } = useCan();
  const manage = can('security.manage');

  const last = getLastBackup();
  const days = daysSinceBackup();

  return (
    <div className={styles.panel}>
      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <KeyRound size={16} /> {secT('pinAutoLock')}
          </span>
        </div>
        <div className={surface.cardBody}>
          <div className={styles.rowBetween}>
            <div className={styles.rowText}>
              <strong>{manage ? secT('pin') : actor ? secT('yourPinNamed', { name: actor.name }) : secT('yourPin')}</strong>
              <span>{secT('pinStored')}</span>
            </div>
            <button type="button" className={controls.btnOutline} onClick={() => setPinOpen(true)}>
              <KeyRound size={16} /> {secT('changePin')}
            </button>
          </div>

          {manage && (
          <>
          <hr className={styles.divider} />

          <div className={styles.rowBetween}>
            <div className={styles.rowText}>
              <strong>{secT('lockAfter')}</strong>
              <span>{secT('lockAfterText')}</span>
            </div>
            <div className={`${controls.field} ${styles.selectWrap}`}>
              <SelectField
                className={controls.select}
                aria-label={secT('autoLockAria')}
                value={idle}
                onChange={(e) => {
                  const minutes = Number(e.target.value);
                  setIdleTimeout(minutes);
                  setIdle(minutes);
                  notify(minutes === 0 ? secT('autoLockOff') : secT('autoLockAfter', { time: idleLabel(minutes) }));
                }}
              >
                {IDLE_CHOICES.map((m) => (
                  <option key={m} value={m}>{idleLabel(m)}</option>
                ))}
              </SelectField>
            </div>
          </div>
          </>
          )}

          <hr className={styles.divider} />

          <div className={styles.rowBetween}>
            <div className={styles.rowText}>
              <strong>{secT('lockNow')}</strong>
              <span>{secT('lockNowText')}</span>
            </div>
            <button
              type="button"
              className={controls.btnOutline}
              onClick={() => {
                logout();
                if (onLock) onLock();
                else window.location.reload();
              }}
            >
              <Lock size={16} /> {secT('lockNow')}
            </button>
          </div>
        </div>
      </section>

      {!manage && (
        <section className={surface.card}>
          <div className={surface.cardHead}>
            <span className={surface.cardHeadIcon}>
              <ShieldCheck size={16} /> {secT('yourRole', { role: roleLabel(role) })}
            </span>
          </div>
          <div className={surface.cardBody}>
            <p className={surface.sectionNote}>{secT(`hint.${role}`)}</p>
            <div className={styles.note} role="note">
              <Info size={16} aria-hidden="true" />
              <span>{secT('ownerManages')}</span>
            </div>
          </div>
        </section>
      )}

      {manage && <UsersPanel notify={notify} />}

      {manage && <VaultPanel notify={notify} />}

      {can('data.backup') && (
      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <ShieldCheck size={16} /> {secT('encryptedBackup')}
          </span>
          {last ? (
            <span className={days !== null && days > 30 ? styles.badgeWarn : styles.badgeOk}>
              {days === 0 ? secT('lastBackupToday') : secT(days === 1 ? 'lastBackupOne' : 'lastBackupMany', { n: days ?? 0 })}
            </span>
          ) : (
            <span className={styles.badgeWarn}>{secT('noBackup')}</span>
          )}
        </div>
        <div className={surface.cardBody}>
          <EncryptedBackup notify={notify} />
        </div>
      </section>
      )}

      <ChangePinModal open={pinOpen} onClose={() => setPinOpen(false)} onChanged={() => notify(secT('pinChanged'))} />
    </div>
  );
}
