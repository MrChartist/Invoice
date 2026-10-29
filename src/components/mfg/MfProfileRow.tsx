/**
 * MF-A5 profile row (lazy, Settings → Defaults → Payment terms, beside the Udyam number): Udyam category, "Print Udyam
 * number" and the FSSAI number — on the active sender profile, so every document snapshots them.
 */
import { useState } from 'react';
import { localDb } from '../../lib/localDb';
import { validateFssai } from '../../lib/mfg/mf-print';
import { useT } from '../../i18n';
import { defineArea } from '../../i18n/area';
import controls from '../../styles/controls.module.css';

type Cat = 'MICRO' | 'SMALL' | 'MEDIUM';

// Own strings (not the picker's area), so the picker's strings stay in the wizard / Features chunk.
const mfPickT = defineArea(
  {
    category: 'Udyam category', 'cat.MICRO': 'Micro', 'cat.SMALL': 'Small', 'cat.MEDIUM': 'Medium', printUdyam: 'Print Udyam number on documents', fssai: 'FSSAI licence no. (14 digits)', save: 'Save', profileSaved: 'Saved on the business profile.',
    profileHint: 'With a category, documents print "Udyam: … (Micro)" under the GSTIN, and micro / small sellers print the 45-day MSMED clause to GSTIN buyers (verify, MF22). FSSAI prints under the GSTIN (MF13).',
  } as const,
  {
    category: 'उद्यम श्रेणी', 'cat.MICRO': 'सूक्ष्म', 'cat.SMALL': 'लघु', 'cat.MEDIUM': 'मध्यम', printUdyam: 'दस्तावेज़ों पर उद्यम नंबर छापें', fssai: 'FSSAI लाइसेंस नं. (14 अंक)', save: 'सहेजें', profileSaved: 'बिज़नेस प्रोफ़ाइल पर सहेजा गया।',
    profileHint: 'श्रेणी चुनने पर दस्तावेज़ों पर GSTIN के नीचे "Udyam: … (Micro)" छपता है, और सूक्ष्म / लघु विक्रेता GSTIN वाले ख़रीदार को 45 दिन का MSMED खंड छापते हैं (जाँचें, MF22)। FSSAI GSTIN के नीचे छपता है (MF13)।',
  },
);

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
          <option value="">-</option>
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
