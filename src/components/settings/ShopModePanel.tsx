import { Store } from 'lucide-react';
import type { AppSettings } from '../../lib/localDb';
import { ALL_MODULES, type BusinessType, type ModuleId } from '../../lib/shop-mode';
import { BUSINESS_TYPES, applyBusinessType, isBusinessType } from '../../lib/shop-presets';
import { useT } from '../../i18n';
import { reachT } from '../../i18n/areas/reach';
import { PACK_IDS, activePacks, type PackId } from '../../lib/industry-packs';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './ShopModePanel.module.css';

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

/**
 * Settings → Defaults → Shop mode (8H): the business type and the modules the sidebar / Dashboard
 * tiles show for this company. Saved with the page's Save bar. "Show all features" clears the filter.
 */
export function ShopModePanel({ settings, onChange }: Props) {
  useT(); // re-render on a language switch
  const all = !Array.isArray(settings.modules);
  const on = new Set<ModuleId>(all ? ALL_MODULES : settings.modules);
  const toggle = (m: ModuleId) => {
    const next = on.has(m) ? [...on].filter((x) => x !== m) : [...on, m];
    onChange({ modules: ALL_MODULES.filter((x) => next.includes(x)) });
  };
  // R5-A1: industry packs — an explicit list once the user ticks a box (absent = follow the business type).
  const packs = activePacks(settings);
  const togglePack = (p: PackId) => onChange({ industry_packs: PACK_IDS.filter((x) => (x === p ? !packs.includes(p) : packs.includes(x))) });
  const pickType = (v: string) => {
    if (!v) return onChange({ business_type: undefined, modules: undefined });
    if (isBusinessType(v)) onChange(applyBusinessType(v as BusinessType));
  };

  return (
    <section className={surface.card} id="shop-mode" aria-labelledby="shop-mode-title">
      <div className={surface.cardHead} id="shop-mode-title">
        <Store size={16} aria-hidden="true" /> {reachT('panelTitle')}
      </div>
      <div className={surface.cardBody}>
        <p className={controls.hint}>{reachT('panelSub')}</p>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{reachT('businessType')}</span>
            <select className={controls.select} value={settings.business_type ?? ''} onChange={(e) => pickType(e.target.value)}>
              <option value="">{reachT('notSet')}</option>
              {BUSINESS_TYPES.map((b) => (
                <option key={b} value={b}>{reachT(`type.${b}`)}</option>
              ))}
            </select>
          </label>
          <div className={styles.actions}>
            {settings.business_type && settings.business_type !== 'full' && (
              <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => onChange(applyBusinessType(settings.business_type!))}>
                {reachT('applyPreset')}
              </button>
            )}
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => onChange({ modules: undefined })} disabled={all}>
              {reachT('showAll')}
            </button>
          </div>
        </div>
        <fieldset className={styles.modules}>
          <legend className={controls.label}>{reachT('modules')}</legend>
          {ALL_MODULES.map((m) => (
            <label key={m} className={controls.check}>
              <input type="checkbox" checked={on.has(m)} onChange={() => toggle(m)} /> {reachT(`mod.${m}`)}
            </label>
          ))}
        </fieldset>
        <p className={controls.hint}>{all ? reachT('showingAll') : reachT('coreNote')}</p>
        <fieldset className={styles.modules} data-industry-packs>
          <legend className={controls.label}>{reachT('packsTitle')}{Array.isArray(settings.industry_packs) ? '' : ` — ${reachT('packsFromType')}`}</legend>
          {PACK_IDS.map((p) => (
            <label key={p} className={controls.check} title={reachT(`packDesc.${p}`)}>
              <input type="checkbox" checked={packs.includes(p)} onChange={() => togglePack(p)} /> <span><strong>{reachT(`pack.${p}`)}</strong><br /><small>{reachT(`packDesc.${p}`)}</small></span>
            </label>
          ))}
        </fieldset>
        <p className={controls.hint}>{reachT('packsSub')}</p>
      </div>
    </section>
  );
}
