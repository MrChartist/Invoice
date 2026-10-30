import { useState } from 'react';
import { ArrowDown, ArrowUp, ListPlus, Pencil, Printer, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { customFieldsDb, MAX_LABEL_LENGTH, type CustomFieldDef } from '../../lib/custom-fields';
import {
  CUSTOM_FIELD_SCOPE_LABELS,
  CUSTOM_FIELD_TYPE_LABELS,
  type CustomFieldScope,
  type CustomFieldType,
} from '../../types/custom-fields';
import { useT } from '../../i18n';
import { fldT } from '../../i18n/areas/fields';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import settings from '../settings/Settings.module.css';
import styles from './custom-fields.module.css';
import { SelectField } from '../ui/SelectField';

interface Props {
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

interface Draft {
  id?: string;
  label: string;
  type: CustomFieldType;
  applies_to: CustomFieldScope;
  print: boolean;
}

const BLANK: Draft = { label: '', type: 'text', applies_to: 'document', print: false };
const SCOPES = Object.keys(CUSTOM_FIELD_SCOPE_LABELS) as CustomFieldScope[];
const TYPES = Object.keys(CUSTOM_FIELD_TYPE_LABELS) as CustomFieldType[];

/** Settings → Custom fields (6.23): define fields for documents, items and parties. */
export function CustomFieldsPanel({ notify }: Props) {
  useT(); // re-render on a language switch (5.4)
  const [defs, setDefs] = useState<CustomFieldDef[]>(() => customFieldsDb.all());
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<CustomFieldDef | null>(null);

  const reload = () => setDefs(customFieldsDb.all());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const saved = customFieldsDb.save(draft);
      notify(draft.id ? fldT('updated', { label: saved.label }) : fldT('added', { label: saved.label }));
      setDraft(BLANK);
      setError('');
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className={settings.editor}>
      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <ListPlus size={16} /> {draft.id ? fldT('editField') : fldT('addField')}
          </span>
        </div>
        <div className={surface.cardBody}>
          <p className={surface.sectionNote}>
            {fldT('intro')}
          </p>
          <form className={styles.form} onSubmit={submit}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="cf-label">{fldT('label')}</label>
              <input id="cf-label" className={controls.input} value={draft.label} maxLength={MAX_LABEL_LENGTH}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} placeholder={fldT('labelPh')} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="cf-type">{fldT('type')}</label>
              <SelectField id="cf-type" className={controls.select} value={draft.type}
                onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as CustomFieldType }))}>
                {TYPES.map((t) => <option key={t} value={t}>{fldT(`type.${t}`)}</option>)}
              </SelectField>
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="cf-scope">{fldT('appliesTo')}</label>
              <SelectField id="cf-scope" className={controls.select} value={draft.applies_to}
                onChange={(e) => setDraft((d) => ({ ...d, applies_to: e.target.value as CustomFieldScope }))}>
                {SCOPES.map((s) => <option key={s} value={s}>{fldT(`scope.${s}`)}</option>)}
              </SelectField>
            </div>
            <label className={controls.check}>
              <input type="checkbox" checked={draft.print} onChange={(e) => setDraft((d) => ({ ...d, print: e.target.checked }))} />
              {fldT('printOn')}
            </label>
            <div className={styles.formActions}>
              <button type="submit" className={controls.btnPrimary}>{draft.id ? fldT('saveField') : fldT('addFieldBtn')}</button>
              {draft.id && (
                <button type="button" className={controls.btnOutline} onClick={() => { setDraft(BLANK); setError(''); }}>{fldT('cancel')}</button>
              )}
            </div>
          </form>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span>{fldT('yourFields')}</span>
          <span className={styles.rowMeta}>{fldT('nDefined', { n: defs.length })}</span>
        </div>
        <div className={surface.cardBody}>
          {defs.length === 0 ? (
            <p className={surface.sectionNote}>{fldT('noFields')}</p>
          ) : (
            <ul className={styles.list} aria-label={fldT('fieldsAria')}>
              {defs.map((d, i) => (
                <li key={d.id} className={styles.row}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowLabel}>
                      {d.label} {d.print && <Printer size={12} aria-label={fldT('printed')} />}
                    </span>
                    <span className={styles.rowMeta}>
                      {fldT(`type.${d.type}`)} · {fldT(`scope.${d.applies_to}`)}
                      {d.print ? fldT('printedTag') : fldT('internalTag')}
                    </span>
                  </span>
                  <span className={styles.rowActions}>
                    <button type="button" className={controls.btnIcon} disabled={i === 0} aria-label={fldT('moveUp', { label: d.label })}
                      onClick={() => { customFieldsDb.move(d.id, -1); reload(); }}><ArrowUp size={15} /></button>
                    <button type="button" className={controls.btnIcon} disabled={i === defs.length - 1} aria-label={fldT('moveDown', { label: d.label })}
                      onClick={() => { customFieldsDb.move(d.id, 1); reload(); }}><ArrowDown size={15} /></button>
                    <button type="button" className={controls.btnIcon} aria-label={fldT('edit', { label: d.label })}
                      onClick={() => { setDraft({ id: d.id, label: d.label, type: d.type, applies_to: d.applies_to, print: d.print }); setError(''); }}>
                      <Pencil size={15} />
                    </button>
                    <button type="button" className={controls.btnIcon} aria-label={fldT('delete', { label: d.label })} onClick={() => setDeleting(d)}>
                      <Trash2 size={15} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={!!deleting}
        destructive
        title={fldT('deleteTitle', { label: deleting?.label ?? '' })}
        message={fldT('deleteMsg')}
        confirmLabel={fldT('deleteBtn')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            customFieldsDb.remove(deleting.id);
            notify(fldT('deleted', { label: deleting.label }));
            if (draft.id === deleting.id) setDraft(BLANK);
          }
          setDeleting(null);
          reload();
        }}
      />
    </div>
  );
}
