/**
 * CN-A1 (PENDING #22): the construction settings switches the profile writes (RA paper style, M-book column, government,
 * certificate and its text, sign-off boxes, deviation %, supply + installation caution, photo pages, manpower preset,
 * labour hold %) — one lazy form under the construction picker in Settings → Features. Owner only; Works views stay with
 * the profile.
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { cnSetT } from '../../i18n/areas/construction-r11-settings';
import { constructionFormPatch, readConstructionSettings, saveConstructionSettings, type ConstructionForm } from '../../lib/construction/cn-settings';
import type { RaPaperStyle } from '../../types/construction-r11';
import controls from '../../styles/controls.module.css';

const toForm = (): ConstructionForm => {
  const s = readConstructionSettings();
  return {
    ra_paper: s.ra_paper ?? 'standard', mb_column: !!s.mb_column, government: !!s.government, certificate: s.certificate !== false,
    certificate_text: s.certificate_text ?? '', signoff_boxes: !!s.signoff_boxes, deviation_pct: s.deviation_pct === undefined ? '' : String(s.deviation_pct),
    split_caution: !!s.split_caution, photo_pages: !!s.photo_pages, manpower_preset: !!s.manpower_preset,
    labour_withhold_pct: s.labour_withhold_pct === undefined ? '' : String(s.labour_withhold_pct),
  };
};

export default function ConstructionSettingsForm({ disabled, onSaved }: { disabled?: boolean; onSaved?: (msg: string) => void }) {
  useT();
  const [f, setF] = useState<ConstructionForm>(toForm);
  const [msg, setMsg] = useState('');
  const set = (p: Partial<ConstructionForm>) => setF((x) => ({ ...x, ...p }));
  const check = (k: 'mb_column' | 'government' | 'certificate' | 'signoff_boxes' | 'split_caution' | 'photo_pages' | 'manpower_preset', label: string) => (
    <label className={controls.check}><input type="checkbox" checked={f[k]} disabled={disabled} onChange={(e) => set({ [k]: e.target.checked })} data-cn-setting={k} /> {label}</label>
  );
  const save = () => {
    try {
      saveConstructionSettings(constructionFormPatch(f));
      setF(toForm());
      setMsg(cnSetT('saved'));
      onSaved?.(cnSetT('saved'));
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  return (
    <details data-construction-settings>
      <summary className={controls.label}>{cnSetT('title')}</summary>
      <p className={controls.hint}>{cnSetT('hint')}</p>
      <label className={controls.field}>
        <span className={controls.label}>{cnSetT('paper')}</span>
        <select className={controls.select} value={f.ra_paper} disabled={disabled} onChange={(e) => set({ ra_paper: e.target.value as RaPaperStyle })} data-cn-setting="ra_paper">
          {(['standard', 'pwd', 'summary'] as const).map((p) => <option key={p} value={p}>{cnSetT(`paper.${p}`)}</option>)}
        </select>
      </label>
      {check('mb_column', cnSetT('mb'))}
      {check('government', cnSetT('government'))}
      {check('certificate', cnSetT('certificate'))}
      {f.certificate && (
        <label className={controls.field}>
          <span className={controls.label}>{cnSetT('certText')}</span>
          <textarea className={controls.textarea} rows={3} maxLength={600} value={f.certificate_text} disabled={disabled} onChange={(e) => set({ certificate_text: e.target.value })} />
        </label>
      )}
      {check('signoff_boxes', cnSetT('boxes'))}
      <div className={controls.row}>
        <label className={controls.field}>
          <span className={controls.label}>{cnSetT('deviation')}</span>
          <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={f.deviation_pct} disabled={disabled} onChange={(e) => set({ deviation_pct: e.target.value })} data-cn-setting="deviation_pct" />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{cnSetT('withhold')}</span>
          <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={f.labour_withhold_pct} disabled={disabled} onChange={(e) => set({ labour_withhold_pct: e.target.value })} />
        </label>
      </div>
      {check('split_caution', cnSetT('split'))}
      {check('photo_pages', cnSetT('photos'))}
      {check('manpower_preset', cnSetT('manpower'))}
      <div>
        <button type="button" className={controls.btnPrimary} disabled={disabled} onClick={save} data-cn-settings-save>{cnSetT('save')}</button>
        {msg && <span className={controls.hint} role="status"> {msg}</span>}
      </div>
    </details>
  );
}
