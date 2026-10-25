import { useEffect, useRef, useState } from 'react';
import { Copy, Minus, Plus } from 'lucide-react';
import { defaultCopies, resolveCopies, toggleCopy, type CopySetting, type SupplyNature } from '../../lib/print-copies';
import type { PreprintedPrefs } from '../../lib/design-prefs';
import { printT } from '../../i18n/areas/printing';
import controls from '../../styles/controls.module.css';
import styles from './InvoicePreview.module.css';

interface Props {
  setting: CopySetting;
  nature: SupplyNature;
  onChange: (next: CopySetting) => void;
  preprinted: PreprintedPrefs;
  onPreprinted: (next: PreprintedPrefs) => void;
  /** Persist both as the sender profile's default; returns false when storage refused. */
  onSaveDefault: () => boolean;
}

/** "Copies" button + panel in the preview toolbar (P0-9 copies, P2 pre-printed stationery). */
export function PrintOptions({ setting, nature, onChange, preprinted, onPreprinted, onSaveDefault }: Props) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<'' | 'ok' | 'fail'>('');
  const wrap = useRef<HTMLDivElement>(null);
  const kinds = resolveCopies(setting, nature);
  const count = Math.max(1, kinds.length);
  const extras = kinds.filter((k) => k === 'extra').length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const check = (kind: 'original' | 'duplicate' | 'triplicate') => (
    <label className={controls.check}>
      <input type="checkbox" checked={kinds.includes(kind)} onChange={(e) => onChange(toggleCopy(setting, kind, e.target.checked, nature))} />
      {printT(kind)}
    </label>
  );

  return (
    <div className={styles.optsWrap} ref={wrap}>
      <button
        type="button"
        className={controls.btnOutline}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        title={printT('printOptions')}
      >
        <Copy size={16} /> <span>{count === 1 ? printT('copiesSingle') : printT('copiesSummary', { n: count })}</span>
      </button>
      {open && (
        <div className={styles.optsPanel} role="dialog" aria-label={printT('printOptions')}>
          <fieldset className={styles.optsGroup}>
            <legend className={controls.label}>{printT('copies')}</legend>
            <div className={styles.optsRow}>
              <button type="button" className={setting === 'single' ? controls.btnPrimary : controls.btnOutline} aria-pressed={setting === 'single'} onClick={() => onChange('single')}>
                {printT('single')}
              </button>
              <button type="button" className={setting === 'auto' ? controls.btnPrimary : controls.btnOutline} aria-pressed={setting === 'auto'} onClick={() => onChange('auto')} title={printT('rule48Hint')}>
                {printT('rule48')} ({defaultCopies(nature).length})
              </button>
            </div>
            {check('original')}
            {check('duplicate')}
            {check('triplicate')}
            <div className={styles.optsRow}>
              <span>{printT('extra')}: {extras}</span>
              <button type="button" className={controls.btnIcon} aria-label={printT('removeExtra')} disabled={extras === 0} onClick={() => onChange(toggleCopy(setting, 'extra', false, nature))}>
                <Minus size={14} />
              </button>
              <button type="button" className={controls.btnIcon} aria-label={printT('addExtra')} disabled={kinds.length >= 6} onClick={() => onChange(toggleCopy(setting, 'extra', true, nature))}>
                <Plus size={14} />
              </button>
            </div>
            <p className={controls.hint}>{printT('jobNote')}</p>
          </fieldset>
          <fieldset className={styles.optsGroup}>
            <legend className={controls.label}>{printT('preprinted')}</legend>
            <label className={controls.check}>
              <input type="checkbox" checked={preprinted.on} onChange={(e) => onPreprinted({ ...preprinted, on: e.target.checked })} />
              {printT('preprinted')}
            </label>
            <p className={controls.hint}>{printT('preprintedHint')}</p>
            {preprinted.on && (
              <div className={styles.optsRow}>
                <label className={controls.field}>
                  <span className={controls.label}>{printT('topMm')}</span>
                  <input className={controls.input} type="number" min={0} max={120} value={preprinted.top_mm} onChange={(e) => onPreprinted({ ...preprinted, top_mm: Math.min(120, Math.max(0, Number(e.target.value) || 0)) })} />
                </label>
                <label className={controls.field}>
                  <span className={controls.label}>{printT('leftMm')}</span>
                  <input className={controls.input} type="number" min={-20} max={40} value={preprinted.left_mm} onChange={(e) => onPreprinted({ ...preprinted, left_mm: Math.min(40, Math.max(-20, Number(e.target.value) || 0)) })} />
                </label>
              </div>
            )}
          </fieldset>
          <button type="button" className={controls.btnGhost} onClick={() => setSaved(onSaveDefault() ? 'ok' : 'fail')}>
            {printT('saveDefault')}
          </button>
          {saved && <p className={controls.hint} role="status">{saved === 'ok' ? printT('savedDefault') : printT('saveFailed')}</p>}
        </div>
      )}
    </div>
  );
}
