import { useMemo, useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { PinConfirmModal } from '../audit/PinConfirmModal';
import { localDb, type AppSettings } from '../../lib/localDb';
import { SETTINGS_OVERRIDE, grantOverride, hasOverride, normalizeLockDate, prettyDay } from '../../lib/period-lock';
import { lockPresets } from '../../lib/lock-presets';
import { todayInput } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../audit/audit.module.css';

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

/** Settings → Defaults: "Lock books up to" with quick presets. Lifting the lock needs the PIN. */
export function LockBooksCard({ settings, onChange }: Props) {
  const today = todayInput();
  const presets = useMemo(() => lockPresets(today), [today]);
  const draft = normalizeLockDate(settings.lock_until);
  const saved = normalizeLockDate(localDb.settings.get().lock_until);
  const [pending, setPending] = useState<string | null>(null); // a loosening waiting for the PIN

  const apply = (next: string) => {
    const clean = normalizeLockDate(next);
    // Moving the lock earlier (or removing it) is the dangerous direction: it needs the PIN.
    const loosening = saved !== '' && (clean === '' || clean < saved);
    if (loosening && !hasOverride(SETTINGS_OVERRIDE)) {
      setPending(clean);
      return;
    }
    onChange({ lock_until: clean || undefined });
  };

  const future = draft !== '' && draft > today;
  const unsaved = draft !== saved;

  return (
    <section className={surface.card}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}>
          <Lock size={16} aria-hidden="true" /> Lock books
        </span>
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote}>
          Once a month is filed, lock it. Documents dated on or before the lock date can no longer be created, edited, cancelled, deleted, paid or
          have their payments removed — from any screen, import or recurring run. Lifting the lock needs your PIN and is written to the activity log.
        </p>

        <div className={`${styles.lockState} ${draft ? styles.lockStateOn : ''}`} role="status">
          {draft ? <Lock size={16} aria-hidden="true" /> : <LockOpen size={16} aria-hidden="true" />}
          <span>
            {draft ? (
              <>
                Books locked up to <strong>{prettyDay(draft)}</strong>
                {unsaved && ' — not saved yet'}
              </>
            ) : (
              <>
                Books are open{unsaved && ' — lock removal not saved yet'}.
              </>
            )}
          </span>
        </div>

        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>Lock books up to</span>
            <input className={controls.input} type="date" value={draft} onChange={(e) => apply(e.target.value)} />
            <span className={controls.hint}>The date itself is locked too.</span>
          </label>
        </div>

        <div>
          <span className={controls.label} style={{ display: 'block', marginBottom: '0.4rem' }}>
            Quick presets
          </span>
          <div className={styles.presets}>
            {presets.map((p) => (
              <button key={p.id} type="button" className={styles.presetBtn} onClick={() => apply(p.date)}>
                <strong>{p.label}</strong>
                <small>
                  {prettyDay(p.date)} · {p.hint}
                </small>
              </button>
            ))}
            {draft && (
              <button type="button" className={styles.presetBtn} onClick={() => apply('')}>
                <strong>Remove lock</strong>
                <small>Needs your PIN</small>
              </button>
            )}
          </div>
        </div>

        {future && (
          <p className={controls.error} role="alert">
            {prettyDay(draft)} is in the future: every document up to then, including new ones dated today, would become read-only.
          </p>
        )}
      </div>

      <PinConfirmModal
        open={pending !== null}
        title={pending ? 'Move the lock earlier' : 'Remove the lock'}
        message={
          pending
            ? `Documents dated ${prettyDay(pending)} to ${prettyDay(saved)} will become editable again. Enter your PIN to continue; this is recorded in the activity log.`
            : 'Every locked document becomes editable again. Enter your PIN to continue; this is recorded in the activity log.'
        }
        confirmLabel="Confirm"
        onClose={() => setPending(null)}
        onSubmit={async (pin) => {
          const ok = await grantOverride(pin, { scope: SETTINGS_OVERRIDE });
          if (ok && pending !== null) onChange({ lock_until: pending || undefined });
          return ok;
        }}
      />
    </section>
  );
}
