import { useMemo, useState } from 'react';
import { Palette, Save } from 'lucide-react';
import { DesignPanel } from './DesignPanel';
import { DEFAULT_TEMPLATE_ID, TEMPLATES, templateById } from '../templates/registry';
import { GLOBAL_PROFILE_ID, resetDesign, resolve, saveDesign, type DesignPrefs } from '../../lib/design-prefs';
import { localDb } from '../../lib/localDb';
import { readRaw, SINGLETON_KEYS } from '../../lib/storage';
import { cn } from '../../lib/utils';
import { useToast } from '../ui/useToast';
import { useT } from '../../i18n';
import { desT } from '../../i18n/areas/design';
import { Page } from '../ui/Page';
import controls from '../../styles/controls.module.css';

/**
 * Route-level page for the Design Studio: pick a scope (every profile, or one
 * sender profile), tune the design, watch the live preview, save.
 */
export function DesignStudio() {
  useT(); // re-render on a language switch (5.4)
  const { notify, toastNode } = useToast();
  const profiles = useMemo(() => {
    try {
      return localDb.settings.get().profiles.filter((p) => p.id);
    } catch {
      return [];
    }
  }, []);
  const [scope, setScope] = useState<string>(GLOBAL_PROFILE_ID);
  const [design, setDesign] = useState<DesignPrefs>(() => resolve(GLOBAL_PROFILE_ID));
  const [templateId, setTemplateId] = useState(() => {
    const stored = readRaw(SINGLETON_KEYS.template);
    return TEMPLATES.some((t) => t.id === stored) ? (stored as string) : DEFAULT_TEMPLATE_ID;
  });
  const [dirty, setDirty] = useState(false);

  const changeScope = (id: string) => {
    setScope(id);
    setDesign(resolve(id));
    setDirty(false);
  };

  const save = () => {
    try {
      const saved = saveDesign({ ...design, profile_id: scope });
      setDesign(saved);
      setDirty(false);
      notify(scope === GLOBAL_PROFILE_ID ? desT('defaultSaved') : desT('profileSaved'));
    } catch (err) {
      notify(err instanceof Error ? err.message : desT('saveFail'), 'error');
    }
  };

  const reset = () => {
    try {
      if (scope !== GLOBAL_PROFILE_ID) resetDesign(scope);
      else resetDesign(GLOBAL_PROFILE_ID);
      setDesign(resolve(scope));
      setDirty(false);
      notify(desT('resetDone'), 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : desT('resetFail'), 'error');
    }
  };

  return (
    <Page
      title={
        <>
          <Palette size={22} aria-hidden="true" /> {desT('title')}
        </>
      }
      subtitle={desT('subtitle')}
      actions={
        <>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="ds-scope">{desT('appliesTo')}</label>
            <select id="ds-scope" className={controls.select} value={scope} onChange={(e) => changeScope(e.target.value)}>
              <option value={GLOBAL_PROFILE_ID}>{desT('allProfiles')}</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.companyName || desT('untitled')}
                </option>
              ))}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="ds-template">{desT('previewTemplate')}</label>
            <select id="ds-template" className={controls.select} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className={cn(controls.btn, controls.btnPrimary)} onClick={save} disabled={!dirty}>
            <Save size={15} aria-hidden="true" /> {desT('saveDesign')}
          </button>
        </>
      }
    >

      <DesignPanel
        profileId={scope}
        value={design}
        onChange={(next) => {
          setDesign(next);
          setDirty(true);
        }}
        onReset={reset}
        accent={templateById(templateId).accent}
        templateId={templateId}
      />
      {toastNode}
    </Page>
  );
}
