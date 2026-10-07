import { useMemo, useState } from 'react';
import { Palette, Save } from 'lucide-react';
import { DesignPanel } from './DesignPanel';
import { DEFAULT_TEMPLATE_ID, TEMPLATES, templateById } from '../templates/registry';
import { GLOBAL_PROFILE_ID, resetDesign, resolve, saveDesign, type DesignPrefs } from '../../lib/design-prefs';
import { localDb } from '../../lib/localDb';
import { readRaw, SINGLETON_KEYS } from '../../lib/storage';
import { cn } from '../../lib/utils';
import { useToast } from '../ui/useToast';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';

/**
 * Route-level page for the Design Studio: pick a scope (every profile, or one
 * sender profile), tune the design, watch the live preview, save.
 */
export function DesignStudio() {
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
      notify(scope === GLOBAL_PROFILE_ID ? 'Default design saved' : 'Profile design saved');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save the design', 'error');
    }
  };

  const reset = () => {
    try {
      if (scope !== GLOBAL_PROFILE_ID) resetDesign(scope);
      else resetDesign(GLOBAL_PROFILE_ID);
      setDesign(resolve(scope));
      setDirty(false);
      notify('Design reset to defaults', 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not reset the design', 'error');
    }
  };

  return (
    <div className={surface.page}>
      <div className={surface.pageHead}>
        <div>
          <h1 className={surface.pageTitle}>
            <Palette size={22} aria-hidden="true" /> Design Studio
          </h1>
          <p className={surface.pageSubtitle}>
            Colours, fonts, columns, paper size and stamps for every invoice you issue.
          </p>
        </div>
        <div className={surface.pageActions}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="ds-scope">Applies to</label>
            <select id="ds-scope" className={controls.select} value={scope} onChange={(e) => changeScope(e.target.value)}>
              <option value={GLOBAL_PROFILE_ID}>All profiles (default)</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.companyName || 'Untitled profile'}
                </option>
              ))}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="ds-template">Preview template</label>
            <select id="ds-template" className={controls.select} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className={cn(controls.btn, controls.btnPrimary)} onClick={save} disabled={!dirty}>
            <Save size={15} aria-hidden="true" /> Save design
          </button>
        </div>
      </div>

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
    </div>
  );
}
