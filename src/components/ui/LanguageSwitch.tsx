import { useState } from 'react';
import { Languages } from 'lucide-react';
import { LANGUAGES, LANG_PACK_OFFLINE, isLang, setLanguage, useT } from '../../i18n';
import { cn } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import styles from './LanguageSwitch.module.css';

/**
 * Interface language picker (5.4). The accessible name is bilingual on purpose, so it can be
 * found whichever language is showing. The choice is saved on this device only.
 * R16-A1: a language other than English is a pack downloaded on the first online switch; offline without it the
 * picker says so (English + Hindi, whichever language is showing) and the interface stays as it was.
 */
export function LanguageSwitch({ className, compact }: { className?: string; compact?: boolean }) {
  const { lang } = useT();
  const [busy, setBusy] = useState(false);
  const [needsOnline, setNeedsOnline] = useState<string | null>(null);
  return (
    <label className={cn(styles.wrap, className)}>
      <Languages size={16} aria-hidden="true" className={styles.icon} />
      <select
        className={cn(controls.select, styles.select, compact && styles.compact)}
        aria-label="Language / भाषा"
        value={lang}
        disabled={busy}
        onChange={(e) => {
          const next = e.target.value;
          if (!isLang(next)) return;
          setBusy(true);
          setNeedsOnline(null);
          void setLanguage(next)
            .catch((err: unknown) => {
              if (err instanceof Error && err.message === LANG_PACK_OFFLINE) setNeedsOnline(next === 'hi' ? 'Hindi' : LANGUAGES.find((l) => l.code === next)?.native ?? next);
            })
            .finally(() => setBusy(false));
        }}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.native}
          </option>
        ))}
      </select>
      {needsOnline && (
        <span role="alert" className={styles.offline} data-lang-offline>
          {needsOnline} needs one online visit to download — connect to the internet and try again.{' '}
          <span lang="hi">यह भाषा एक बार इंटरनेट से डाउनलोड होगी — जुड़कर फिर चुनें।</span>
        </span>
      )}
    </label>
  );
}
