import { useState } from 'react';
import { Percent } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import {
  clearProfileLateFee,
  computeInterest,
  describeBasis,
  getLateFeeConfig,
  hasProfileLateFee,
  saveLateFeeConfig,
  type LateFeeConfig,
  type LateFeeMode,
} from '../../lib/interest';
import { formatCurrency } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './interest.module.css';
import { useT } from '../../i18n';
import { intT } from '../../i18n/areas/interest';
import { nodes } from '../../i18n/areas/nodes';

export interface LateFeeSettingsProps {
  /**
   * Sender profile id. Omit to edit the default for every profile; pass one to offer a
   * "different rule for this profile" override that falls back to the default when off.
   */
  profileId?: string | null;
  profileName?: string;
  /** Called after every save (e.g. to toast or refresh). */
  onSaved?: (config: LateFeeConfig) => void;
}

const MODES = [
  { id: 'annual', label: 'perYear' },
  { id: 'monthly_flat', label: 'perMonth' },
] as const satisfies ReadonlyArray<{ id: LateFeeMode; label: string }>;

/** Settings card for late-payment interest. Saves on every change to `mrchartist_inv_late_fee`. */
export function LateFeeSettings({ profileId, profileName, onSaved }: LateFeeSettingsProps) {
  useT();
  const [override, setOverride] = useState(() => (profileId ? hasProfileLateFee(profileId) : false));
  const [cfg, setCfg] = useState<LateFeeConfig>(() => getLateFeeConfig(profileId));

  const update = (patch: Partial<LateFeeConfig>) => {
    const next = { ...cfg, ...patch };
    // cap 0 / empty means "no cap"
    if (!next.cap_percent) delete next.cap_percent;
    if (!next.compounding) delete next.compounding;
    const saved = saveLateFeeConfig(next, profileId && override ? profileId : null);
    setCfg(saved);
    onSaved?.(saved);
  };

  const toggleOverride = (on: boolean) => {
    if (!profileId) return;
    setOverride(on);
    if (on) {
      const saved = saveLateFeeConfig(cfg, profileId);
      setCfg(saved);
    } else {
      clearProfileLateFee(profileId);
      setCfg(getLateFeeConfig(profileId));
    }
  };

  const locked = !cfg.enabled;
  const sample = computeInterest(
    { doc_type: 'TAX_INVOICE', status: 'Sent', due_date: '2026-01-01', total: 10000 },
    cfg,
    '2026-01-31',
  );

  return (
    <section className={surface.card}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}>
          <Percent size={16} /> {intT('title')}
        </span>
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote}>
          {nodes(intT('intro'), { you: <strong>{intT('you')}</strong> })}
        </p>

        {profileId && (
          <label className={controls.check}>
            <input type="checkbox" checked={override} onChange={(e) => toggleOverride(e.target.checked)} />
            <span>{intT('differentRule', { name: profileName || intT('thisProfile') })}</span>
          </label>
        )}

        <label className={controls.check}>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <span>{intT('showAccrued')}</span>
        </label>

        <div className={locked ? styles.dim : undefined} aria-disabled={locked}>
          <div className={controls.field}>
            <span className={controls.label}>{intT('rateCharged')}</span>
            <div className={controls.segment} role="radiogroup" aria-label={intT('basisAria')} style={{ alignSelf: 'flex-start' }}>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={cfg.mode === m.id}
                  disabled={locked}
                  className={cfg.mode === m.id ? controls.segmentBtnActive : controls.segmentBtn}
                  onClick={() => update({ mode: m.id })}
                >
                  {intT(m.label)}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.settingsGrid} style={{ marginTop: '0.75rem' }}>
            <label className={controls.field}>
              <span className={controls.label}>{intT('rateFromTerms')}</span>
              <span className={styles.suffix}>
                <NumberInput
                  className={`${controls.input} ${controls.inputNumeric}`}
                  value={cfg.rate}
                  disabled={locked}
                  placeholder={intT('ratePh')}
                  aria-label={intT('rateAria')}
                  onChange={(rate) => update({ rate })}
                />
                <span>{cfg.mode === 'annual' ? intT('pctYear') : intT('pctMonth')}</span>
              </span>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{intT('grace')}</span>
              <span className={styles.suffix}>
                <NumberInput
                  className={`${controls.input} ${controls.inputNumeric}`}
                  value={cfg.grace_days}
                  disabled={locked}
                  aria-label={intT('graceAria')}
                  onChange={(grace_days) => update({ grace_days })}
                />
                <span>{intT('daysFree')}</span>
              </span>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{intT('stopAt')}</span>
              <span className={styles.suffix}>
                <NumberInput
                  className={`${controls.input} ${controls.inputNumeric}`}
                  value={cfg.cap_percent ?? 0}
                  disabled={locked}
                  placeholder={intT('noCap')}
                  aria-label={intT('capAria')}
                  onChange={(cap_percent) => update({ cap_percent: cap_percent > 0 ? cap_percent : undefined })}
                />
                <span>{intT('pctInvoice')}</span>
              </span>
            </label>
          </div>

          <label className={controls.check} style={{ marginTop: '0.75rem' }}>
            <input
              type="checkbox"
              checked={!!cfg.compounding}
              disabled={locked}
              onChange={(e) => update({ compounding: e.target.checked })}
            />
            <span>{intT('compounding')}</span>
          </label>
        </div>

        {cfg.enabled && cfg.rate > 0 ? (
          <div className={styles.example} data-testid="late-fee-example">
            <strong>{intT('exampleLabel')}</strong>{' '}
            {nodes(intT('example'), { invoice: formatCurrency(10000), amount: <strong>{formatCurrency(sample.amount)}</strong>, basis: describeBasis(cfg) })}
          </div>
        ) : cfg.enabled ? (
          <p className={styles.warn}>{intT('enterRate')}</p>
        ) : null}

        <p className={surface.sectionNote}>{intT('disclaimer')}</p>
      </div>
    </section>
  );
}
