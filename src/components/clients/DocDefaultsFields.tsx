import { useState } from 'react';
import type { DocDefaults } from '../../types/service-r3';
import { normalizeDocDefaults } from '../../lib/party-defaults';
import { TEMPLATES } from '../templates/registry';
import { CURRENCIES } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { svcT } from '../../i18n/areas/service-r3';

/**
 * R3-B5: the party's document defaults in the client form (collapsed until opened or set). Emits the
 * cleaned value, or undefined when nothing is set (so clearing the fields clears the stored defaults).
 */
export default function DocDefaultsFields({ value, onChange }: { value?: DocDefaults; onChange: (v: DocDefaults | undefined) => void }) {
  useT();
  const [open, setOpen] = useState(() => !!normalizeDocDefaults(value));
  const v = value ?? {};
  const set = <K extends keyof DocDefaults>(k: K, val: DocDefaults[K]) => {
    const next = { ...v, [k]: val } as Record<string, unknown>;
    if (val === undefined || val === '' || val === false) delete next[k];
    onChange(Object.keys(next).length ? (next as DocDefaults) : undefined);
  };
  return (
    <fieldset className={controls.field} style={{ border: 0, padding: 0, margin: 0 }} data-doc-defaults>
      <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {svcT('docDefaults')}
      </button>
      {open && (
        <>
          <span className={controls.hint}>{svcT('docDefaultsHint')}</span>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>{svcT('ddTemplate')}</span>
              <select className={controls.select} value={v.template_id ?? ''} onChange={(e) => set('template_id', e.target.value || undefined)} data-dd-template>
                <option value="">{svcT('ddTemplateNone')}</option>
                {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{svcT('ddCurrency')}</span>
              <select className={controls.select} value={v.currency ?? ''} onChange={(e) => set('currency', e.target.value || undefined)} data-dd-currency>
                <option value="">{svcT('ddCurrencyNone')}</option>
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
              </select>
            </label>
          </div>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>{svcT('ddDiscount')}</span>
              <input type="number" min={0} max={100} step="0.01" className={controls.input} value={v.discount_percent ?? ''}
                onChange={(e) => set('discount_percent', Number(e.target.value) > 0 ? Math.min(Number(e.target.value), 100) : undefined)} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{svcT('ddRate')}</span>
              <input type="number" min={0} step="0.01" className={controls.input} value={v.hourly_rate ?? ''}
                onChange={(e) => set('hourly_rate', Number(e.target.value) > 0 ? Number(e.target.value) : undefined)} data-dd-rate />
            </label>
          </div>
          <label className={controls.field}>
            <span className={controls.label}>{svcT('ddNotes')}</span>
            <textarea className={controls.textarea} rows={2} value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value || undefined)} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{svcT('ddTerms')}</span>
            <textarea className={controls.textarea} rows={2} value={v.terms ?? ''} onChange={(e) => set('terms', e.target.value || undefined)} />
          </label>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>{svcT('ddPrintLang')}</span>
              <select className={controls.select} value={v.print_lang ?? ''} onChange={(e) => set('print_lang', (e.target.value || undefined) as DocDefaults['print_lang'])}>
                <option value="">{svcT('ddLangDefault')}</option>
                <option value="en">{svcT('ddLangEn')}</option>
                <option value="hi">{svcT('ddLangHi')}</option>
              </select>
            </label>
            <label className={controls.check}>
              <input type="checkbox" checked={!!v.annexure} onChange={(e) => set('annexure', e.target.checked || undefined)} data-dd-annexure />
              {svcT('ddAnnexure')}
            </label>
          </div>
        </>
      )}
    </fieldset>
  );
}
