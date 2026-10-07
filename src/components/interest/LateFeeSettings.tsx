import { useState } from 'react';
import { Percent } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import {
  INTEREST_DISCLAIMER,
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

const MODES: { id: LateFeeMode; label: string }[] = [
  { id: 'annual', label: 'Per year' },
  { id: 'monthly_flat', label: 'Per month' },
];

/** Settings card for late-payment interest. Saves on every change to `mrchartist_inv_late_fee`. */
export function LateFeeSettings({ profileId, profileName, onSaved }: LateFeeSettingsProps) {
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
          <Percent size={16} /> Late-payment interest
        </span>
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote}>
          Shows how much interest an overdue invoice has built up, using the rate <strong>you</strong> enter here, which
          should match the terms you agreed with your customer. Nothing is added to an invoice unless you click to add it.
        </p>

        {profileId && (
          <label className={controls.check}>
            <input type="checkbox" checked={override} onChange={(e) => toggleOverride(e.target.checked)} />
            <span>Use a different rule for {profileName || 'this profile'}</span>
          </label>
        )}

        <label className={controls.check}>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <span>Show accrued interest on overdue invoices</span>
        </label>

        <div className={locked ? styles.dim : undefined} aria-disabled={locked}>
          <div className={controls.field}>
            <span className={controls.label}>Rate is charged</span>
            <div className={controls.segment} role="radiogroup" aria-label="Interest basis" style={{ alignSelf: 'flex-start' }}>
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
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.settingsGrid} style={{ marginTop: '0.75rem' }}>
            <label className={controls.field}>
              <span className={controls.label}>Rate from your terms</span>
              <span className={styles.suffix}>
                <NumberInput
                  className={`${controls.input} ${controls.inputNumeric}`}
                  value={cfg.rate}
                  disabled={locked}
                  placeholder="e.g. as agreed"
                  aria-label="Interest rate in percent"
                  onChange={(rate) => update({ rate })}
                />
                <span>{cfg.mode === 'annual' ? '% a year' : '% a month'}</span>
              </span>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>Grace period</span>
              <span className={styles.suffix}>
                <NumberInput
                  className={`${controls.input} ${controls.inputNumeric}`}
                  value={cfg.grace_days}
                  disabled={locked}
                  aria-label="Grace days"
                  onChange={(grace_days) => update({ grace_days })}
                />
                <span>days free</span>
              </span>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>Stop at (optional)</span>
              <span className={styles.suffix}>
                <NumberInput
                  className={`${controls.input} ${controls.inputNumeric}`}
                  value={cfg.cap_percent ?? 0}
                  disabled={locked}
                  placeholder="no cap"
                  aria-label="Cap as percent of invoice"
                  onChange={(cap_percent) => update({ cap_percent: cap_percent > 0 ? cap_percent : undefined })}
                />
                <span>% of invoice</span>
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
            <span>Interest on interest (only if your terms say so)</span>
          </label>
        </div>

        {cfg.enabled && cfg.rate > 0 ? (
          <div className={styles.example} data-testid="late-fee-example">
            <strong>Example:</strong> a {formatCurrency(10000)} invoice paid 30 days late works out to{' '}
            <strong>{formatCurrency(sample.amount)}</strong> ({describeBasis(cfg)}).
          </div>
        ) : cfg.enabled ? (
          <p className={styles.warn}>Enter the rate from your own terms. No rate is assumed, so nothing is shown until you do.</p>
        ) : null}

        <p className={surface.sectionNote}>{INTEREST_DISCLAIMER}</p>
      </div>
    </section>
  );
}
