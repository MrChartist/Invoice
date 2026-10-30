import { useMemo, useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { PinConfirmModal } from '../audit/PinConfirmModal';
import { localDb, type AppSettings } from '../../lib/localDb';
import { SETTINGS_OVERRIDE, grantOverride, hasOverride, normalizeLockDate, prettyDay } from '../../lib/period-lock';
import { lockPresets } from '../../lib/lock-presets';
import { todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { setT } from '../../i18n/areas/settings';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../audit/audit.module.css';
import { libMsg } from '../../i18n/lib-msg';
import { DateField } from '../ui/DateField';

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

/** Settings → Defaults: "Lock books up to" with quick presets. Lifting the lock needs the PIN. */
export function LockBooksCard({ settings, onChange }: Props) {
  useT(); // re-render on a language switch (5.4)
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
          <Lock size={16} aria-hidden="true" /> {setT('lockBooks')}
        </span>
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote}>
          {setT('lockNote')}
        </p>

        <div className={`${styles.lockState} ${draft ? styles.lockStateOn : ''}`} role="status">
          {draft ? <Lock size={16} aria-hidden="true" /> : <LockOpen size={16} aria-hidden="true" />}
          <span>
            {draft ? (
              <>
                {setT('lockedUpTo')} <strong>{prettyDay(draft)}</strong>
                {unsaved && setT('notSavedYet')}
              </>
            ) : (
              <>
                {setT('booksOpen')}{unsaved && setT('removalNotSaved')}.
              </>
            )}
          </span>
        </div>

        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{setT('lockUpTo')}</span>
            <DateField className={controls.input} value={draft} onChange={(e) => apply(e.target.value)} />
            <span className={controls.hint}>{setT('lockDateHint')}</span>
          </label>
        </div>

        <div>
          <span className={controls.label} style={{ display: 'block', marginBottom: '0.4rem' }}>
            {setT('presets')}
          </span>
          <div className={styles.presets}>
            {presets.map((p) => (
              <button key={p.id} type="button" className={styles.presetBtn} onClick={() => apply(p.date)}>
                <strong>{libMsg(p.label)}</strong>
                <small>
                  {prettyDay(p.date)} · {libMsg(p.hint)}
                </small>
              </button>
            ))}
            {draft && (
              <button type="button" className={styles.presetBtn} onClick={() => apply('')}>
                <strong>{setT('removeLock')}</strong>
                <small>{setT('needsPin')}</small>
              </button>
            )}
          </div>
        </div>

        {future && (
          <p className={controls.error} role="alert">
            {setT('lockFuture', { date: prettyDay(draft) })}
          </p>
        )}
      </div>

      <PinConfirmModal
        open={pending !== null}
        title={pending ? setT('moveEarlier') : setT('removeLockTitle')}
        message={
          pending
            ? setT('moveEarlierMsg', { from: prettyDay(pending), to: prettyDay(saved) })
            : setT('removeLockMsg')
        }
        confirmLabel={setT('confirm')}
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
