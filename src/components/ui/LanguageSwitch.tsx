import { useState } from 'react';
import { Languages } from 'lucide-react';
import { LANGUAGES, isLang, setLanguage, useT } from '../../i18n';
import { cn } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import styles from './LanguageSwitch.module.css';

/**
 * Interface language picker (5.4). The accessible name is bilingual on purpose, so it can be
 * found whichever language is showing. The choice is saved on this device only.
 */
export function LanguageSwitch({ className, compact }: { className?: string; compact?: boolean }) {
  const { lang } = useT();
  const [busy, setBusy] = useState(false);
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
          void setLanguage(next)
            .catch(() => undefined)
            .finally(() => setBusy(false));
        }}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.native}
          </option>
        ))}
      </select>
    </label>
  );
}
