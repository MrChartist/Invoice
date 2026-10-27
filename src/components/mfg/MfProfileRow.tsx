/**
 * MF-A5 profile row (lazy, Settings → Defaults → Payment terms, beside the Udyam number): Udyam category, "Print Udyam
 * number" and the FSSAI number — on the active sender profile, so every document snapshots them.
 */
import { useState } from 'react';
import { localDb } from '../../lib/localDb';
import { validateFssai } from '../../lib/mfg/mf-print';
import { useT } from '../../i18n';
import { mfPickT } from '../../i18n/areas/mfg-r13a-pick';
import controls from '../../styles/controls.module.css';

type Cat = 'MICRO' | 'SMALL' | 'MEDIUM';

export default function MfProfileRow({ notify }: { notify: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  useT();
  const p = localDb.settings.activeProfile();
  const [cat, setCat] = useState<string>(p?.msme_category ?? '');
  const [print, setPrint] = useState(p?.udyam_print !== false);
  const [fssai, setFssai] = useState(p?.fssai_no ?? '');
  const save = () => {
    const bad = validateFssai(fssai);
    if (bad) return notify(bad, 'error');
    const s = localDb.settings.get();
    try {
      localDb.settings.save({ ...s, profiles: s.profiles.map((x) => (x.id === s.activeProfileId ? { ...x, msme_category: (cat || undefined) as Cat | undefined, udyam_print: print ? undefined : false, fssai_no: fssai.replace(/\s+/g, '') || undefined } : x)) });
      notify(mfPickT('profileSaved'));
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }} data-mf-profile>
      <label className={controls.field}>
        <span className={controls.label}>{mfPickT('category')}</span>
        <select className={controls.select} value={cat} onChange={(e) => setCat(e.target.value)} data-mf-category>
          <option value="">—</option>
          {(['MICRO', 'SMALL', 'MEDIUM'] as const).map((c) => <option key={c} value={c}>{mfPickT(`cat.${c}`)}</option>)}
        </select>
      </label>
      <label className={controls.check}><input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} /> {mfPickT('printUdyam')}</label>
      <label className={controls.field}>
        <span className={controls.label}>{mfPickT('fssai')}</span>
        <input className={`${controls.input} ${controls.inputMono}`} value={fssai} inputMode="numeric" maxLength={16} onChange={(e) => setFssai(e.target.value)} data-mf-fssai />
      </label>
      <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={save} data-mf-profile-save>{mfPickT('save')}</button>
      <span className={controls.hint}>{mfPickT('profileHint')}</span>
    </div>
  );
}
