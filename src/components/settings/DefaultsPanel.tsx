import { CURRENCIES } from '../../lib/utils';
import { GST_SLABS } from '../../types/invoice';
import type { AppSettings } from '../../lib/localDb';
import { useTheme } from '../../hooks/useTheme';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Settings.module.css';

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

export function DefaultsPanel({ settings, onChange }: Props) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={styles.editor}>
      <section className={surface.card}>
        <div className={surface.cardHead}>New document defaults</div>
        <div className={surface.cardBody}>
          <div className={controls.row3}>
            <label className={controls.field}>
              <span className={controls.label}>Currency</span>
              <select className={controls.select} value={settings.defaultCurrency} onChange={(e) => onChange({ defaultCurrency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.symbol} {c.code} — {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>Default GST rate</span>
              <select className={controls.select} value={settings.defaultTaxRate} onChange={(e) => onChange({ defaultTaxRate: Number(e.target.value) })}>
                {GST_SLABS.map((r) => (
                  <option key={r} value={r}>
                    {r === 0 ? '0% / exempt' : `${r}%`}
                  </option>
                ))}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>Payment due in (days)</span>
              <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min={0} max={365} value={settings.defaultDueDays} onChange={(e) => onChange({ defaultDueDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} />
            </label>
          </div>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>Default number prefix</span>
              <input className={`${controls.input} ${controls.inputMono}`} maxLength={8} value={settings.invoicePrefix} onChange={(e) => onChange({ invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="INV" />
              <span className={controls.hint}>A profile can override this. Numbering restarts every 1 April.</span>
            </label>
            <label className={`${controls.check} ${controls.field}`} style={{ justifyContent: 'flex-end' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" checked={settings.roundOff} onChange={(e) => onChange({ roundOff: e.target.checked })} />
                Round the total to the nearest rupee
              </span>
            </label>
          </div>
          <label className={controls.field}>
            <span className={controls.label}>Default terms &amp; conditions</span>
            <textarea className={controls.textarea} rows={3} value={settings.defaultTerms} onChange={(e) => onChange({ defaultTerms: e.target.value })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Default note (printed above the terms)</span>
            <textarea className={controls.textarea} rows={2} value={settings.defaultNotes} onChange={(e) => onChange({ defaultNotes: e.target.value })} placeholder="e.g. Thank you for your business." />
          </label>
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardHead}>Appearance</div>
        <div className={surface.cardBody}>
          <div className={controls.segment} role="radiogroup" aria-label="Theme" style={{ alignSelf: 'flex-start' }}>
            {(['light', 'dark'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTheme(t)}>
                {t === 'light' ? 'Paper (light)' : 'Void (dark)'}
              </button>
            ))}
          </div>
          <p className={surface.sectionNote}>Applies instantly and is remembered on this device. Invoices always print on white paper.</p>
        </div>
      </section>
    </div>
  );
}
