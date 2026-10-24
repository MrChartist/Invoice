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
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import settings from '../settings/Settings.module.css';
import styles from './custom-fields.module.css';

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
  const [defs, setDefs] = useState<CustomFieldDef[]>(() => customFieldsDb.all());
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<CustomFieldDef | null>(null);

  const reload = () => setDefs(customFieldsDb.all());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const saved = customFieldsDb.save(draft);
      notify(draft.id ? `"${saved.label}" updated` : `"${saved.label}" added`);
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
            <ListPlus size={16} /> {draft.id ? 'Edit custom field' : 'Add a custom field'}
          </span>
        </div>
        <div className={surface.cardBody}>
          <p className={surface.sectionNote}>
            Extra fields such as Vehicle no., Batch, Customer code or Project. Printable document fields appear in a
            "Details" box on every template; printable item fields print under the line. A saved invoice keeps the
            label it was saved with, so renaming a field later never changes old invoices.
          </p>
          <form className={styles.form} onSubmit={submit}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="cf-label">Label</label>
              <input id="cf-label" className={controls.input} value={draft.label} maxLength={MAX_LABEL_LENGTH}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} placeholder="e.g. Vehicle no." />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="cf-type">Type</label>
              <select id="cf-type" className={controls.select} value={draft.type}
                onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as CustomFieldType }))}>
                {TYPES.map((t) => <option key={t} value={t}>{CUSTOM_FIELD_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="cf-scope">Applies to</label>
              <select id="cf-scope" className={controls.select} value={draft.applies_to}
                onChange={(e) => setDraft((d) => ({ ...d, applies_to: e.target.value as CustomFieldScope }))}>
                {SCOPES.map((s) => <option key={s} value={s}>{CUSTOM_FIELD_SCOPE_LABELS[s]}</option>)}
              </select>
            </div>
            <label className={controls.check}>
              <input type="checkbox" checked={draft.print} onChange={(e) => setDraft((d) => ({ ...d, print: e.target.checked }))} />
              Print on invoices
            </label>
            <div className={styles.formActions}>
              <button type="submit" className={controls.btnPrimary}>{draft.id ? 'Save field' : 'Add field'}</button>
              {draft.id && (
                <button type="button" className={controls.btnOutline} onClick={() => { setDraft(BLANK); setError(''); }}>Cancel</button>
              )}
            </div>
          </form>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span>Your fields</span>
          <span className={styles.rowMeta}>{defs.length} defined</span>
        </div>
        <div className={surface.cardBody}>
          {defs.length === 0 ? (
            <p className={surface.sectionNote}>No custom fields yet.</p>
          ) : (
            <ul className={styles.list} aria-label="Custom fields">
              {defs.map((d, i) => (
                <li key={d.id} className={styles.row}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowLabel}>
                      {d.label} {d.print && <Printer size={12} aria-label="(printed)" />}
                    </span>
                    <span className={styles.rowMeta}>
                      {CUSTOM_FIELD_TYPE_LABELS[d.type]} · {CUSTOM_FIELD_SCOPE_LABELS[d.applies_to]}
                      {d.print ? ' · printed' : ' · internal'}
                    </span>
                  </span>
                  <span className={styles.rowActions}>
                    <button type="button" className={controls.btnIcon} disabled={i === 0} aria-label={`Move ${d.label} up`}
                      onClick={() => { customFieldsDb.move(d.id, -1); reload(); }}><ArrowUp size={15} /></button>
                    <button type="button" className={controls.btnIcon} disabled={i === defs.length - 1} aria-label={`Move ${d.label} down`}
                      onClick={() => { customFieldsDb.move(d.id, 1); reload(); }}><ArrowDown size={15} /></button>
                    <button type="button" className={controls.btnIcon} aria-label={`Edit ${d.label}`}
                      onClick={() => { setDraft({ id: d.id, label: d.label, type: d.type, applies_to: d.applies_to, print: d.print }); setError(''); }}>
                      <Pencil size={15} />
                    </button>
                    <button type="button" className={controls.btnIcon} aria-label={`Delete ${d.label}`} onClick={() => setDeleting(d)}>
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
        title={`Delete "${deleting?.label ?? ''}"?`}
        message="New documents and forms will no longer show this field. Invoices already saved keep printing the value they were saved with; values stored on clients, vendors or items are kept but hidden."
        confirmLabel="Delete field"
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            customFieldsDb.remove(deleting.id);
            notify(`"${deleting.label}" deleted`);
            if (draft.id === deleting.id) setDraft(BLANK);
          }
          setDeleting(null);
          reload();
        }}
      />
    </div>
  );
}
