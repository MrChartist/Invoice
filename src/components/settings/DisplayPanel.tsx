/**
 * Settings → Security & device → Display (R2-C6): text size, contrast, motion, link underline,
 * tap targets, focus ring. Device-local (`src/lib/display-prefs.ts`); applied at once.
 */
import { useState } from 'react';
import { Accessibility, RotateCcw } from 'lucide-react';
import {
  DEFAULT_DISPLAY_PREFS,
  TEXT_SCALES,
  applyDisplayPrefs,
  loadDisplayPrefs,
  saveDisplayPrefs,
  type DisplayPrefs,
  type MotionPref,
} from '../../lib/display-prefs';
import { useT } from '../../i18n';
import { dispT } from '../../i18n/areas/display-r2';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

export function DisplayPanel() {
  useT();
  const [prefs, setPrefs] = useState<DisplayPrefs>(() => loadDisplayPrefs());
  const update = (patch: Partial<DisplayPrefs>) => {
    const next = saveDisplayPrefs({ ...prefs, ...patch });
    applyDisplayPrefs(next);
    setPrefs(next);
  };
  const motions: { value: MotionPref; label: string }[] = [
    { value: 'system', label: dispT('motionSystem') },
    { value: 'reduce', label: dispT('motionReduce') },
    { value: 'full', label: dispT('motionFull') },
  ];
  return (
    <section className={surface.card} aria-labelledby="display-prefs-title" data-display-prefs>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon} id="display-prefs-title">
          <Accessibility size={16} aria-hidden /> {dispT('title')}
        </span>
      </div>
      <div className={surface.cardBody}>
        <p className={controls.hint}>{dispT('note')}</p>
        <div className={controls.field}>
          <span className={controls.label} id="display-text-size">{dispT('textSize')}</span>
          <div className={controls.segment} role="radiogroup" aria-labelledby="display-text-size">
            {TEXT_SCALES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={prefs.text_scale === s}
                aria-label={dispT('textSizeAria', { pct: s })}
                data-text-scale={s}
                className={prefs.text_scale === s ? controls.segmentBtnActive : controls.segmentBtn}
                onClick={() => update({ text_scale: s })}
              >
                {s}%
              </button>
            ))}
          </div>
        </div>
        <div className={controls.field}>
          <span className={controls.label} id="display-motion">{dispT('motion')}</span>
          <div className={controls.segment} role="radiogroup" aria-labelledby="display-motion">
            {motions.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={prefs.motion === m.value}
                className={prefs.motion === m.value ? controls.segmentBtnActive : controls.segmentBtn}
                onClick={() => update({ motion: m.value })}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <label className={controls.check}>
          <input type="checkbox" checked={prefs.high_contrast} onChange={(e) => update({ high_contrast: e.target.checked })} />
          {dispT('contrast')} <span className={controls.hint}>{dispT('contrastHint')}</span>
        </label>
        <label className={controls.check}>
          <input type="checkbox" checked={prefs.underline_links} onChange={(e) => update({ underline_links: e.target.checked })} />
          {dispT('underline')}
        </label>
        <label className={controls.check}>
          <input type="checkbox" checked={prefs.large_targets} onChange={(e) => update({ large_targets: e.target.checked })} />
          {dispT('targets')} <span className={controls.hint}>{dispT('targetsHint')}</span>
        </label>
        <label className={controls.check}>
          <input type="checkbox" checked={prefs.focus_always} onChange={(e) => update({ focus_always: e.target.checked })} />
          {dispT('focus')}
        </label>
        <div>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => update({ ...DEFAULT_DISPLAY_PREFS })}>
            <RotateCcw size={14} aria-hidden /> {dispT('reset')}
          </button>
        </div>
      </div>
    </section>
  );
}

export default DisplayPanel;
