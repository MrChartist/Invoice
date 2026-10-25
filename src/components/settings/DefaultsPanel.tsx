import { CURRENCIES } from '../../lib/utils';
import { GST_SLABS } from '../../types/invoice';
import type { AppSettings } from '../../lib/localDb';
import { useTheme } from '../../hooks/useTheme';
import { LockBooksCard } from './LockBooksCard';
import { useT } from '../../i18n';
import { setT } from '../../i18n/areas/settings';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Settings.module.css';

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

export function DefaultsPanel({ settings, onChange }: Props) {
  useT(); // re-render on a language switch (5.4)
  const { theme, setTheme } = useTheme();

  return (
    <div className={styles.editor}>
      <section className={surface.card}>
        <div className={surface.cardHead}>{setT('docDefaults')}</div>
        <div className={surface.cardBody}>
          <div className={controls.row3}>
            <label className={controls.field}>
              <span className={controls.label}>{setT('currency')}</span>
              <select className={controls.select} value={settings.defaultCurrency} onChange={(e) => onChange({ defaultCurrency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.symbol} {c.code} — {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{setT('defaultGst')}</span>
              <select className={controls.select} value={settings.defaultTaxRate} onChange={(e) => onChange({ defaultTaxRate: Number(e.target.value) })}>
                {GST_SLABS.map((r) => (
                  <option key={r} value={r}>
                    {r === 0 ? setT('exempt') : `${r}%`}
                  </option>
                ))}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{setT('dueDays')}</span>
              <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min={0} max={365} value={settings.defaultDueDays} onChange={(e) => onChange({ defaultDueDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} />
            </label>
          </div>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>{setT('defaultPrefix')}</span>
              <input className={`${controls.input} ${controls.inputMono}`} maxLength={8} value={settings.invoicePrefix} onChange={(e) => onChange({ invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="INV" />
              <span className={controls.hint}>{setT('prefixHint')}</span>
            </label>
          </div>
          <label className={controls.check}>
            <input type="checkbox" checked={settings.roundOff} onChange={(e) => onChange({ roundOff: e.target.checked })} />
            <span>{setT('roundOff')}</span>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{setT('defaultTerms')}</span>
            <textarea className={controls.textarea} rows={3} value={settings.defaultTerms} onChange={(e) => onChange({ defaultTerms: e.target.value })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{setT('defaultNote')}</span>
            <textarea className={controls.textarea} rows={2} value={settings.defaultNotes} onChange={(e) => onChange({ defaultNotes: e.target.value })} placeholder={setT('defaultNotePh')} />
          </label>
        </div>
      </section>

      <LockBooksCard settings={settings} onChange={onChange} />

      <section className={surface.card}>
        <div className={surface.cardHead}>{setT('appearance')}</div>
        <div className={surface.cardBody}>
          <div className={controls.segment} role="radiogroup" aria-label={setT('theme')} style={{ alignSelf: 'flex-start' }}>
            {(['light', 'dark'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTheme(t)}>
                {t === 'light' ? setT('light') : setT('dark')}
              </button>
            ))}
          </div>
          <p className={surface.sectionNote}>{setT('themeNote')}</p>
        </div>
      </section>
    </div>
  );
}
