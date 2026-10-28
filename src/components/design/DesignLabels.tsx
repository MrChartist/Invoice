/**
 * Design Studio additions (R2-C5): label overrides per profile / per document type, a title suffix,
 * and "Suggest accent from logo" (sampled on a canvas on this device — `src/lib/logo-colour.ts`).
 */
import { useId, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { LABEL_DOC_TYPES, LABEL_KEYS, sanitizeLabels, type DesignPrefs, type LabelOverrides, type OverridableLabel } from '../../lib/design-prefs';
import { suggestAccentsFromImage, type AccentSuggestion } from '../../lib/logo-colour';
import { DOCUMENT_LABELS, type DocumentType } from '../../types/invoice';
import { defaultLabel } from '../templates/labels';
import { useT } from '../../i18n';
import { dlT } from '../../i18n/areas/design-r2';
import { cn } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import styles from './DesignPanel.module.css';

const COMMON: readonly OverridableLabel[] = ['desc', 'hsn', 'qty', 'rate', 'amount', 'billTo', 'shipTo', 'issueDate', 'dueDate', 'invoiceNo', 'poRef', 'total', 'balanceDue', 'notes', 'terms', 'signatory'];

export function DesignLabels({ design, onChange }: { design: DesignPrefs; onChange: (patch: Partial<DesignPrefs>) => void }) {
  useT();
  const uid = useId();
  const [scope, setScope] = useState<'' | DocumentType>('');
  const [all, setAll] = useState(false);
  const current: LabelOverrides = (scope ? design.labels_by_type?.[scope] : design.labels) ?? {};
  const keys = all ? LABEL_KEYS : COMMON;

  const setLabel = (key: OverridableLabel, value: string) => {
    const next = { ...current, [key]: value };
    if (!value) delete next[key];
    if (!scope) onChange({ labels: sanitizeLabels(next) });
    else {
      const byType = { ...(design.labels_by_type ?? {}) };
      const clean = sanitizeLabels(next);
      if (clean) byType[scope] = clean;
      else delete byType[scope];
      onChange({ labels_by_type: Object.keys(byType).length ? byType : undefined });
    }
  };
  const clearScope = () => {
    if (!scope) onChange({ labels: undefined });
    else {
      const byType = { ...(design.labels_by_type ?? {}) };
      delete byType[scope];
      onChange({ labels_by_type: Object.keys(byType).length ? byType : undefined });
    }
  };
  const setSuffix = (value: string) => {
    if (!scope) return;
    const next = { ...(design.title_suffix ?? {}), [scope]: value };
    if (!value.trim()) delete next[scope];
    onChange({ title_suffix: Object.keys(next).length ? next : undefined });
  };

  return (
    <div className={controls.field} data-design-labels>
      <p className={controls.hint}>{dlT('labelsHint')}</p>
      <div className={styles.grid2}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-scope`}>{dlT('scope')}</label>
          <select id={`${uid}-scope`} className={controls.select} value={scope} onChange={(e) => setScope(e.target.value as '' | DocumentType)}>
            <option value="">{dlT('allDocs')}</option>
            {LABEL_DOC_TYPES.map((d) => <option key={d} value={d}>{DOCUMENT_LABELS[d]}</option>)}
          </select>
        </div>
        {scope && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-suffix`}>{dlT('titleSuffix')}</label>
            <input
              id={`${uid}-suffix`}
              className={controls.input}
              maxLength={60}
              value={design.title_suffix?.[scope] ?? ''}
              placeholder={dlT('titleSuffixPh')}
              onChange={(e) => setSuffix(e.target.value)}
            />
            <span className={controls.hint}>{dlT('titleSuffixHint', { title: DOCUMENT_LABELS[scope] })}</span>
          </div>
        )}
      </div>
      <div className={styles.grid2}>
        {keys.map((k) => (
          <label key={k} className={controls.field}>
            <span className={controls.label}>{defaultLabel(k)}</span>
            <input
              className={controls.input}
              maxLength={40}
              value={current[k] ?? ''}
              placeholder={(scope && design.labels?.[k]) || defaultLabel(k)}
              aria-label={dlT('labelAria', { name: defaultLabel(k) })}
              data-label-key={k}
              onChange={(e) => setLabel(k, e.target.value)}
            />
          </label>
        ))}
      </div>
      <div className={styles.swatches}>
        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setAll((v) => !v)}>
          {all ? dlT('showCommon') : dlT('showAll')}
        </button>
        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={clearScope} disabled={!Object.keys(current).length}>
          {dlT('clear')}
        </button>
      </div>
    </div>
  );
}

/** "Suggest from logo": three swatches derived from the logo's dominant colours. */
export function LogoAccentSuggest({ logo, onPick, active }: { logo?: string; onPick: (hex: string) => void; active?: string }) {
  useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [swatches, setSwatches] = useState<AccentSuggestion[]>([]);
  const run = async () => {
    setMsg('');
    if (!logo) {
      setMsg(dlT('noLogo'));
      return;
    }
    setBusy(true);
    try {
      const found = await suggestAccentsFromImage(logo);
      setSwatches(found);
      if (!found.length) setMsg(dlT('noColour'));
    } catch {
      setMsg(dlT('logoFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.swatches} data-logo-accent>
      <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => void run()} disabled={busy}>
        <Wand2 size={14} aria-hidden /> {busy ? dlT('suggesting') : dlT('suggest')}
      </button>
      {swatches.length > 0 && <span className={controls.hint}>{dlT('suggested')}</span>}
      {swatches.map((s) => (
        <button
          key={s.hex}
          type="button"
          className={active === s.hex ? styles.swatchActive : styles.swatch}
          style={{ background: s.hex }}
          title={s.hex}
          aria-label={dlT('suggestAria', { hex: s.hex })}
          aria-pressed={active === s.hex}
          data-suggested-accent={s.hex}
          onClick={() => onPick(s.hex)}
        />
      ))}
      {msg && <span className={controls.hint} role="status">{msg}</span>}
    </div>
  );
}
